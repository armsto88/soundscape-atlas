#!/usr/bin/env python3
"""Build the website's published data from the metadata CSV files.

Writes two kinds of file next to --output:

  data.json                         index: published segments, plus each site,
                                    session and species stored once; each
                                    segment lists the species heard in it, for
                                    the species search and the session charts
  detections/<SITE>/<SEGMENT>.json  one file per segment with detections,
                                    loaded by the site when that segment is opened;
                                    back-to-back detections of a species are merged
                                    into calling bouts, rejected ones are left out,
                                    and so are species listed in
                                    out_of_range_species.csv for the site's country

Keeping detections out of the index keeps it small: one file of everything
grows past Cloudflare Pages' 25 MiB per-file limit after a few weeks of audio.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path
from datetime import datetime
from typing import Dict, List, NamedTuple, Optional, Tuple

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from solar import segment_sun

# Solar noon more than this far from 12:00 on the local clock almost always
# means the session's timezone is wrong (real offsets reach about 3 hours).
MAX_PLAUSIBLE_NOON_OFFSET_HOURS = 3.5

# Decimal places published per sites.csv public_location_precision value.
# 2 dp is about 1.1 km north-south, 1 dp about 11 km (less east-west away from
# the equator). None publishes the coordinates as entered.
LOCATION_DECIMALS = {"exact": None, "rounded": 2, "coarse": 1}
PRECISION_NAMES = {None: "exact", 2: "rounded", 1: "coarse"}
DEFAULT_PRECISION = "rounded"
SENSITIVE_DECIMALS = 1  # sensitive sites are never more precise than "coarse"
# How far each published precision blurs a place, compared with a sensitive list's
# generalisation: 2 decimals is about 1 km, 1 decimal about 11 km.
PRECISION_KM = {"exact": 0.0, "rounded": 1.0, "coarse": 10.0}
SENSITIVE_ELEVATION_STEP_M = 100

DETECTIONS_DIR_NAME = "detections"
# Detections of one species less than this far apart are shown as one calling
# bout (BirdNET scores 3 s chunks, so a long call is many back-to-back rows).
BOUT_GAP_SEC = 3.0
# The activity curve on a site's page counts detections per bin of this many seconds.
ACTIVITY_BIN_SEC = 300
# Species whose exact place the search must not show (written by fetch_sensitive_species.py).
SENSITIVE_SPECIES_CSV = Path(__file__).resolve().parent / "sensitive_species.csv"
# Species BirdNET named in a country where they do not live, so misidentifications:
# left out there like detections rejected by ear.
OUT_OF_RANGE_CSV = Path(__file__).resolve().parent / "out_of_range_species.csv"
# IDs become file names, so they must not contain path separators or "..".
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")

# Cloudflare Pages limits, warned about before a deploy would fail.
PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024
PAGES_MAX_FILES = 20_000


class PublicLocation(NamedTuple):
    latitude: str
    longitude: str
    elevation_m: str
    precision: str
    is_sensitive: bool


def read_csv(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def to_bool(value: str) -> bool:
    return str(value).strip().lower() == "true"


def is_safe_id(value: str) -> bool:
    return bool(SAFE_ID.match(value or "")) and ".." not in value


def split_published(segments: List[dict]) -> Tuple[List[dict], List[dict], List[Tuple[str, str]]]:
    """Return (published, unpublished, unrecognised values).

    Only an explicit "true" publishes a segment. Anything else, including blanks
    and typos, stays private; unrecognised values are reported so they can be fixed.
    """
    published, unpublished, unrecognised = [], [], []
    for segment in segments:
        raw = str(segment.get("published") or "").strip()
        if raw.lower() not in ("true", "false", ""):
            unrecognised.append((segment.get("segment_id", ""), raw))
        (published if raw.lower() == "true" else unpublished).append(segment)
    return published, unpublished, unrecognised


def support_link(site: dict) -> dict:
    """The optional support_name/support_url/support_note columns, only with an https link."""
    name = (site.get("support_name") or "").strip()
    url = (site.get("support_url") or "").strip()
    if not name or not url.startswith("https://"):
        return {}
    return {"support": {"name": name, "url": url, "note": (site.get("support_note") or "").strip()}}


def public_location(site: dict) -> Tuple[PublicLocation, List[str]]:
    """Coordinates and elevation as they may be published for a site.

    Unrecognised values fall back to the more private option and are reported.
    """
    warnings: List[str] = []

    precision = str(site.get("public_location_precision") or "").strip().lower() or DEFAULT_PRECISION
    if precision not in LOCATION_DECIMALS:
        warnings.append(
            f"public_location_precision={precision!r} is not exact/rounded/coarse; publishing as coarse"
        )
        precision = "coarse"

    sensitive_raw = str(site.get("is_sensitive") or "").strip().lower()
    if sensitive_raw not in ("true", "false", ""):
        warnings.append(f"is_sensitive={sensitive_raw!r} is not true/false; treating the site as sensitive")
    is_sensitive = sensitive_raw not in ("false", "")

    decimals = LOCATION_DECIMALS[precision]
    if is_sensitive:
        decimals = SENSITIVE_DECIMALS if decimals is None else min(decimals, SENSITIVE_DECIMALS)

    def coordinate(name: str) -> str:
        raw = str(site.get(name) or "").strip()
        try:
            value = float(raw)
        except ValueError:
            warnings.append(f"{name}={raw!r} is not a number; site will not appear on the map")
            return ""
        return raw if decimals is None else f"{round(value, decimals):.{decimals}f}"

    latitude = coordinate("latitude")
    longitude = coordinate("longitude")

    elevation = str(site.get("elevation_m") or "").strip()
    if is_sensitive and elevation:
        try:
            step = SENSITIVE_ELEVATION_STEP_M
            elevation = str(int(round(float(elevation) / step) * step))
        except ValueError:
            elevation = ""

    location = PublicLocation(latitude, longitude, elevation, PRECISION_NAMES[decimals], is_sensitive)
    return location, warnings


def parse_seconds(value) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def merge_bouts(rows: List[dict]) -> List[dict]:
    """Join back-to-back detections of one species into calling bouts.

    A bout keeps the first detection's ID, spans all its detections, carries
    the best confidence and the number of detections (n), and counts as
    checked by ear when any of its detections was confirmed.
    """
    by_species: Dict[str, List[Tuple[float, float, dict]]] = defaultdict(list)
    for row in rows:
        start = parse_seconds(row.get("start_sec"))
        if start is None:
            continue
        end = parse_seconds(row.get("end_sec"))
        key = (row.get("scientific_name") or row.get("common_name") or "").strip().lower()
        by_species[key].append((start, end if end is not None and end > start else start, row))

    bouts: List[dict] = []
    for items in by_species.values():
        items.sort(key=lambda item: item[0])
        bout: Optional[dict] = None
        best = -1.0
        for start, end, row in items:
            confidence = parse_seconds(row.get("confidence")) or 0.0
            confirmed = (row.get("review_status") or "").strip().lower() == "confirmed"
            if bout is not None and start <= bout["end_sec"] + BOUT_GAP_SEC:
                bout["end_sec"] = max(bout["end_sec"], end)
                bout["n"] += 1
                if confidence > best:
                    best, bout["confidence"] = confidence, row.get("confidence")
                if confirmed:
                    bout["review_status"] = "confirmed"
                continue
            best = confidence
            bout = {
                "detection_id": row.get("detection_id"),
                "common_name": row.get("common_name"),
                "scientific_name": row.get("scientific_name"),
                "group": row.get("taxon_group") or "",
                "start_sec": start,
                "end_sec": end,
                "confidence": row.get("confidence"),
                "n": 1,
                "model": row.get("model"),
                "review_status": "confirmed" if confirmed else "unreviewed",
            }
            bouts.append(bout)
    bouts.sort(key=lambda item: (item["start_sec"], item["common_name"] or ""))
    return bouts


def activity_bins(segment: dict, rows: List[dict]) -> List[int]:
    """Detections per ACTIVITY_BIN_SEC from the segment's start, for the activity curve."""
    try:
        start = datetime.fromisoformat(str(segment.get("segment_start_local") or ""))
        end = datetime.fromisoformat(str(segment.get("segment_end_local") or ""))
        duration = max(1.0, (end - start).total_seconds())
    except ValueError:
        duration = 3600.0
    bins = [0] * max(1, math.ceil(duration / ACTIVITY_BIN_SEC))
    for row in rows:
        second = parse_seconds(row.get("start_sec"))
        if second is not None:
            bins[min(len(bins) - 1, max(0, int(second // ACTIVITY_BIN_SEC)))] += 1
    return bins


def segment_species(rows: List[dict], species_index: Dict[str, int], last_bin: int) -> List[list]:
    """The species heard in a segment, most calls first, each as
    [species id, calls, clearest call (second), its confidence, 5-minute bins with calls, checked by ear (0/1)].

    Bins count ACTIVITY_BIN_SEC from the segment's start, like `activity`. The site
    adds these up per session and place for the species search and the session charts.
    """
    found: Dict[str, dict] = {}
    for row in rows:
        name = (row.get("common_name") or "Unknown").strip()
        second = parse_seconds(row.get("start_sec"))
        confidence = parse_seconds(row.get("confidence")) or 0.0
        entry = found.setdefault(name, {"calls": 0, "best": None, "confidence": -1.0, "bins": set(), "checked": 0})
        entry["calls"] += 1
        if second is not None:
            entry["bins"].add(min(last_bin, max(0, int(second // ACTIVITY_BIN_SEC))))
            if confidence > entry["confidence"] or (confidence == entry["confidence"] and second < entry["best"]):
                entry["confidence"], entry["best"] = confidence, second
        if (row.get("review_status") or "").strip().lower() == "confirmed":
            entry["checked"] = 1
    heard = [
        [species_index[name], entry["calls"], round(entry["best"] or 0.0, 1), round(max(0.0, entry["confidence"]), 2),
         sorted(entry["bins"]), entry["checked"]]
        for name, entry in found.items()
    ]
    heard.sort(key=lambda item: (-item[1], item[0]))
    return heard


def name_key(value: str) -> str:
    """A species name for matching: lower case, letters and single spaces only."""
    value = (value or "").lower().replace("-", " ").replace("treefrog", "tree frog")
    return " ".join(re.sub(r"[^a-z ]", " ", value).split())


def generalisation_km(value: str) -> float:
    """A sensitive list's generalisation as km: "10km" -> 10, "WITHHOLD" -> inf
    (never shown); unknown or blank counts as 10 km, the lists' usual blur."""
    text = (value or "").strip().lower()
    if text == "withhold":
        return math.inf
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*km", text)
    return float(match.group(1)) if match else 10.0


def load_sensitive_species(path: Path) -> Tuple[Dict[str, Dict[str, float]], Dict[str, Dict[str, float]]]:
    """Each listed species, by scientific and by common name: {name key: {where: km}},
    where is a country ("AU") or country-state ("AU-NSW") and km the list's blur there."""
    by_scientific: Dict[str, Dict[str, float]] = defaultdict(dict)
    by_common: Dict[str, Dict[str, float]] = defaultdict(dict)
    if not path.is_file():
        print(f"warning: {path} not found; species on sensitive lists will be published like any other", file=sys.stderr)
        return by_scientific, by_common
    for row in read_csv(path):
        where = (row.get("applies_in") or "").strip()
        if not where:
            continue
        km = generalisation_km(row.get("generalisation", ""))
        for table, key in ((by_scientific, name_key(row.get("scientific_name", ""))), (by_common, name_key(row.get("common_name", "")))):
            if key:
                table[key][where] = max(km, table[key].get(where, 0.0))
    return by_scientific, by_common


def load_out_of_range(path: Path) -> Dict[str, set]:
    """{name key: country codes}: each species in out_of_range_species.csv, by
    scientific and by common name, with the countries where it does not live."""
    countries: Dict[str, set] = defaultdict(set)
    if not path.is_file():
        print(f"warning: {path} not found; no species are left out as misidentifications", file=sys.stderr)
        return countries
    for row in read_csv(path):
        where = set((row.get("not_in") or "").upper().split())
        for key in (name_key(row.get("scientific_name", "")), name_key(row.get("common_name", ""))):
            if key and where:
                countries[key] |= where
    return countries


def sensitive_km(scientific: str, common: str, site: dict, lists: Tuple[dict, dict]) -> Optional[float]:
    """How far a species' records must be blurred at this site under the sensitive
    lists (the strictest list that applies), or None when no list applies."""
    by_scientific, by_common = lists
    wheres = {str(site.get("country_code") or "").strip()}
    wheres.add(f"{site.get('country_code', '')}-{site.get('region_code', '')}".strip())
    found = [km for table, key in ((by_scientific, name_key(scientific)), (by_common, name_key(common)))
             for where, km in table.get(key, {}).items() if where in wheres]
    return max(found) if found else None


def public_window(session: dict) -> Tuple[Optional[datetime], Optional[datetime]]:
    """The published part of a session: sessions.csv public_start_local / public_end_local.

    Blank means from the recording's start / to its end. scripts/publish_session.py
    sets them (--start/--end) and cuts the public audio to match.
    """
    window = []
    for key in ("public_start_local", "public_end_local"):
        value = str(session.get(key) or "").strip()
        try:
            window.append(datetime.fromisoformat(value) if value else None)
        except ValueError:
            print(f"warning: sessions.csv {session.get('session_id')}: {key}={value!r} is not a date and time; ignored",
                  file=sys.stderr)
            window.append(None)
    return window[0], window[1]


def cut_to_window(segment: dict, window: Tuple[Optional[datetime], Optional[datetime]]) -> Tuple[Optional[dict], float, float]:
    """(the segment as published, seconds cut from its start, published length).

    None when the window leaves nothing of it. A cut segment is a copy with the
    published start and end, so the timeline matches its cut audio.
    """
    try:
        start = datetime.fromisoformat(str(segment.get("segment_start_local") or ""))
        end = datetime.fromisoformat(str(segment.get("segment_end_local") or ""))
    except ValueError:
        return segment, 0.0, 0.0
    new_start = max(start, window[0]) if window[0] else start
    new_end = min(end, window[1]) if window[1] else end
    if new_end <= new_start:
        return None, 0.0, 0.0
    if (new_start, new_end) == (start, end):
        return segment, 0.0, (end - start).total_seconds()
    cut = dict(segment, segment_start_local=new_start.isoformat(), segment_end_local=new_end.isoformat())
    return cut, (new_start - start).total_seconds(), (new_end - new_start).total_seconds()


def segment_sun_info(segment: dict, location: PublicLocation, session: dict) -> Tuple[Optional[dict], str]:
    """Time-of-day period and that day's sunrise/sunset for a segment.

    Returns (info, "") or (None, reason). Uses the *published* coordinates, so
    these values reveal nothing more precise about a site than the map shows.
    """
    timezone_name = str(session.get("timezone") or "").strip()
    if not timezone_name:
        return None, "the session has no timezone"
    try:
        tz = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return None, f"unknown timezone {timezone_name!r} (on Windows: pip install tzdata)"
    try:
        latitude = float(location.latitude)
        longitude = float(location.longitude)
    except ValueError:
        return None, "the site has no usable coordinates"
    try:
        start = datetime.fromisoformat(str(segment.get("segment_start_local") or ""))
        end = datetime.fromisoformat(str(segment.get("segment_end_local") or ""))
    except ValueError:
        return None, "segment start/end times are not ISO dates"
    # Times are meant to be local clock times; accept ones written with an offset.
    if start.tzinfo is not None:
        start = start.astimezone(tz).replace(tzinfo=None)
    if end.tzinfo is not None:
        end = end.astimezone(tz).replace(tzinfo=None)
    return segment_sun(start, end, latitude, longitude, tz), ""


def build_outputs(metadata_dir: Path, segments: List[dict], sensitive_path: Path = SENSITIVE_SPECIES_CSV,
                  out_of_range_path: Path = OUT_OF_RANGE_CSV) -> Tuple[dict, Dict[str, dict]]:
    """Return (index payload, {relative detections path: detections payload})."""
    sites = read_csv(metadata_dir / "sites.csv")
    sessions = read_csv(metadata_dir / "sessions.csv")
    detections = read_csv(metadata_dir / "birdnet_detections.csv")

    sessions_by_id = {s["session_id"]: s for s in sessions}
    sites_by_id = {s["site_id"]: s for s in sites}

    locations: Dict[str, PublicLocation] = {}
    for site in sites:
        location, warnings = public_location(site)
        locations[site["site_id"]] = location
        for warning in warnings:
            print(f"warning: sites.csv {site['site_id']}: {warning}", file=sys.stderr)
    no_location = PublicLocation("", "", "", "coarse", True)

    # Only the published part of each session: hours outside it are left out,
    # and hours it cuts start or end with their cut audio.
    windows = {session_id: public_window(session) for session_id, session in sessions_by_id.items()}
    cuts: Dict[str, Tuple[float, float]] = {}  # segment_id -> (seconds cut from the start, published length)
    windowed = []
    for segment in segments:
        window = windows.get(segment.get("session_id", ""), (None, None))
        if window == (None, None):
            windowed.append(segment)
            continue
        cut, offset, length = cut_to_window(segment, window)
        if cut is None:
            continue
        if cut is not segment:
            cuts[segment["segment_id"]] = (offset, length)
        windowed.append(cut)
    segments = windowed

    published_ids = {segment["segment_id"] for segment in segments}
    site_of = {segment["segment_id"]: segment.get("site_id", "") for segment in segments}
    # A species on a sensitive list (fetch_sensitive_species.py) is left out of a
    # place entirely when the place is published more precisely than the list's
    # blur allows: not in its species, lanes, counts or activity curve. Its calls
    # stay in the audio, unnamed.
    sensitive_lists = load_sensitive_species(sensitive_path)
    blur_cache: Dict[Tuple[str, str], bool] = {}
    withheld: Counter = Counter()

    def withhold(detection: dict, site_id: str) -> bool:
        common = (detection.get("common_name") or "").strip()
        key = (common, site_id)
        if key not in blur_cache:
            need = sensitive_km(detection.get("scientific_name") or "", common, sites_by_id.get(site_id, {}), sensitive_lists)
            have = PRECISION_KM.get(locations.get(site_id, no_location).precision, 0.0)
            blur_cache[key] = need is not None and have < need
        return blur_cache[key]

    # A species that does not live in the site's country is a misidentification.
    out_of_range_lists = load_out_of_range(out_of_range_path)
    misidentified: Counter = Counter()

    def out_of_range(detection: dict, site_id: str) -> bool:
        country = str(sites_by_id.get(site_id, {}).get("country_code") or "").strip().upper()
        return any(country in out_of_range_lists.get(name_key(detection.get(field) or ""), ())
                   for field in ("scientific_name", "common_name"))

    detections_by_segment: Dict[str, List[dict]] = defaultdict(list)
    for detection in detections:
        segment_id = detection.get("segment_id", "")
        # Detections rejected by ear are never published.
        if segment_id not in published_ids or (detection.get("review_status") or "").strip().lower() == "rejected":
            continue
        if out_of_range(detection, site_of.get(segment_id, "")):
            misidentified[(site_of.get(segment_id, ""), (detection.get("common_name") or "").strip())] += 1
            continue
        if withhold(detection, site_of.get(segment_id, "")):
            withheld[(site_of.get(segment_id, ""), (detection.get("common_name") or "").strip())] += 1
            continue
        if segment_id in cuts:
            # Keep calls inside the published part, timed from its start.
            offset, length = cuts[segment_id]
            start, end = parse_seconds(detection.get("start_sec")), parse_seconds(detection.get("end_sec"))
            if start is None or end is None or start < offset or end > offset + length:
                continue
            detection = dict(detection, start_sec=f"{start - offset:.2f}", end_sec=f"{end - offset:.2f}")
        detections_by_segment[segment_id].append(detection)

    # Every species heard in a published segment, stored once; segments refer to
    # them by position. A species on a sensitive list (fetch_sensitive_species.py)
    # carries the countries and states where search shows only the area it was heard in.
    species_info: Dict[str, dict] = {}
    for rows in detections_by_segment.values():
        for detection in rows:
            name = (detection.get("common_name") or "Unknown").strip()
            info = species_info.setdefault(name, {"name": name, "scientific": "", "group": ""})
            info["scientific"] = info["scientific"] or (detection.get("scientific_name") or "").strip()
            info["group"] = info["group"] or (detection.get("taxon_group") or "").strip()
    species_names = sorted(species_info, key=str.casefold)
    species_index = {name: index for index, name in enumerate(species_names)}
    for (site_id, name), count in sorted(withheld.items()):
        precision = locations.get(site_id, no_location).precision
        print(f"note: left out {count} detection(s) of {name} at {site_id} (sensitive list; the place is published as {precision})",
              file=sys.stderr)
    for (site_id, name), count in sorted(misidentified.items()):
        print(f"note: left out {count} detection(s) of {name} at {site_id} (out_of_range_species.csv)", file=sys.stderr)
    # What remains of a listed species is at places published coarsely enough; the
    # search still names only their area.
    sensitive_by_scientific, sensitive_by_common = sensitive_lists
    species_list = []
    for name in species_names:
        info = dict(species_info[name])
        where = set(sensitive_by_scientific.get(name_key(info["scientific"]), {})) | set(sensitive_by_common.get(name_key(name), {}))
        if where:
            info["area_only_in"] = sorted(where)
            print(f"note: species search shows only the area for {name} in {', '.join(sorted(where))} (sensitive list)", file=sys.stderr)
        species_list.append(info)

    index_sites: Dict[str, dict] = {}
    index_sessions: Dict[str, dict] = {}
    index_segments: List[dict] = []
    detection_files: Dict[str, dict] = {}

    site_species: Dict[str, Dict[str, dict]] = defaultdict(dict)
    suspect_sites = set()
    for segment in segments:
        segment_id = segment["segment_id"]
        site_id = segment.get("site_id", "")
        session_id = segment.get("session_id", "")

        if site_id not in index_sites:
            site = sites_by_id.get(site_id, {})
            location = locations.get(site_id, no_location)
            index_sites[site_id] = {
                "site_name": site.get("site_name"),
                "latitude": location.latitude,
                "longitude": location.longitude,
                "country_code": site.get("country_code"),
                "region_code": site.get("region_code"),
                "area": (site.get("area") or "").strip(),
                "locality": site.get("locality"),
                "elevation_m": location.elevation_m,
                "habitat": site.get("habitat"),
                "biome": site.get("biome"),
                "public_location_precision": location.precision,
                "description": site.get("description"),
                "is_sensitive": location.is_sensitive,
                # optional: a local conservation group's own donation page ("support this place")
                **support_link(site),
            }

        if session_id not in index_sessions:
            session = sessions_by_id.get(session_id, {})
            window_start, window_end = windows.get(session_id, (None, None))
            index_sessions[session_id] = {
                # The whole recording's span (less any cut ends), so a site page can show
                # unpublished hours as gaps.
                "start_local": window_start.isoformat() if window_start else session.get("start_datetime_local"),
                "end_local": window_end.isoformat() if window_end else session.get("end_datetime_local"),
                "timezone": session.get("timezone"),
                "recorder": session.get("recorder"),
                "microphones": session.get("microphones"),
                "sample_rate_hz": session.get("sample_rate_hz"),
                "bit_depth": session.get("bit_depth"),
                "channels": session.get("channels"),
                "weather_notes": session.get("weather_notes"),
                "field_notes": session.get("field_notes"),
                "operator": session.get("operator"),
                "copyright_owner": session.get("copyright_owner"),
                "license": session.get("license"),
            }

        sun, problem = segment_sun_info(segment, locations.get(site_id, no_location), sessions_by_id.get(session_id, {}))
        if site_id not in suspect_sites:
            timezone_name = sessions_by_id.get(session_id, {}).get("timezone")
            if problem:
                suspect_sites.add(site_id)
                print(
                    f"warning: {site_id} (e.g. segment {segment_id}): no time of day, {problem}; "
                    "the site falls back to clock hours",
                    file=sys.stderr,
                )
            elif abs(sun["noon_offset_hours"]) > MAX_PLAUSIBLE_NOON_OFFSET_HOURS:
                suspect_sites.add(site_id)
                print(
                    f"warning: {site_id} (e.g. session {session_id}): the sun is highest "
                    f"{sun['noon_offset_hours']:+.1f} h from 12:00 in {timezone_name!r}; check the timezone",
                    file=sys.stderr,
                )

        rows = detections_by_segment[segment_id]
        counts = Counter((row.get("common_name") or "Unknown").strip() for row in rows)
        group_of = {(row.get("common_name") or "Unknown").strip(): row.get("taxon_group") or "" for row in rows}
        checked = {(row.get("common_name") or "Unknown").strip() for row in rows
                   if (row.get("review_status") or "").strip().lower() == "confirmed"}
        top_species = [{"name": name, "count": count, "group": group_of.get(name, ""), "checked": name in checked}
                       for name, count in counts.most_common(6)]
        activity = activity_bins(segment, rows)
        for row in rows:
            name = (row.get("common_name") or "Unknown").strip()
            entry = site_species[site_id].setdefault(name, {
                "name": name,
                "scientific": (row.get("scientific_name") or "").strip(),
                "group": row.get("taxon_group") or "",
                "calls": 0,
                "hours": set(),
                "checked": False,
            })
            entry["calls"] += 1
            entry["hours"].add(segment_id)
            entry["checked"] = entry["checked"] or (row.get("review_status") or "").strip().lower() == "confirmed"

        detections_url = ""
        if rows:
            if is_safe_id(site_id) and is_safe_id(segment_id):
                relative = f"{DETECTIONS_DIR_NAME}/{site_id}/{segment_id}.json"
                segment_detections = merge_bouts(rows)
                detection_files[relative] = {"segment_id": segment_id, "detections": segment_detections}
                detections_url = relative
            else:
                print(
                    f"warning: {site_id}/{segment_id} is not a safe file name; its detections are not published",
                    file=sys.stderr,
                )

        listening_opus_path = segment.get("listening_opus_path")
        spectrogram_image_url = ""
        if listening_opus_path and listening_opus_path.lower().endswith(".opus"):
            spectrogram_image_url = listening_opus_path[:-5] + ".png"

        index_segments.append(
            {
                "segment_id": segment_id,
                "session_id": session_id,
                "site_id": site_id,
                "segment_start_local": segment.get("segment_start_local"),
                "segment_end_local": segment.get("segment_end_local"),
                "local_date": segment.get("local_date"),
                "local_hour": segment.get("local_hour"),
                "season": segment.get("season"),
                "sound_quality": segment.get("sound_quality"),
                "wind_level": segment.get("wind_level"),
                "rain_present": to_bool(segment.get("rain_present", "false")),
                "water_present": to_bool(segment.get("water_present", "false")),
                "anthropogenic_noise": segment.get("anthropogenic_noise"),
                "featured": to_bool(segment.get("featured", "false")),
                "notes": segment.get("notes"),
                "listening_opus_path": listening_opus_path,
                "spectrogram_image_url": spectrogram_image_url,
                "public_url": segment.get("public_url"),
                "detection_count": len(rows),
                "activity": activity,
                "top_species": top_species,
                "species": segment_species(rows, species_index, len(activity) - 1),
                "detections_url": detections_url,
                "period": sun["period"] if sun else "",
                "sunrise": sun["sunrise"] if sun else "",
                "sunset": sun["sunset"] if sun else "",
            }
        )

    # Each site's species across its published hours: calls are detections,
    # hours the number of published hours the species was detected in.
    for site_id, entries in site_species.items():
        index_sites[site_id]["species"] = sorted(
            ({**entry, "hours": len(entry["hours"])} for entry in entries.values()),
            key=lambda entry: (-entry["calls"], entry["name"].casefold()),
        )

    # Totals describe only what is published, so hidden recordings are not
    # revealed through the counts either.
    index = {
        "format": 3,
        "sites_count": len(index_sites),
        "sessions_count": len(index_sessions),
        "segments_count": len(index_segments),
        "detections_count": sum(s["detection_count"] for s in index_segments),
        "species": species_list,
        "sites": index_sites,
        "sessions": index_sessions,
        "segments": index_segments,
    }
    return index, detection_files


def to_json_lines(payload: dict) -> str:
    """JSON with one list item or mapping entry per line.

    Far smaller than indented JSON, and a git diff still shows one changed line
    per changed segment, site or detection.
    """

    def compact(value) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    keys = list(payload)
    lines = ["{"]
    for position, key in enumerate(keys):
        value = payload[key]
        comma = "," if position < len(keys) - 1 else ""
        if isinstance(value, list) and value:
            body = ",\n".join(f"    {compact(item)}" for item in value)
            lines.append(f"  {compact(key)}: [\n{body}\n  ]{comma}")
        elif isinstance(value, dict) and value:
            body = ",\n".join(f"    {compact(k)}: {compact(v)}" for k, v in value.items())
            lines.append(f"  {compact(key)}: {{\n{body}\n  }}{comma}")
        else:
            lines.append(f"  {compact(key)}: {compact(value)}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)


def replace_detections_dir(target: Path, files: Dict[str, dict]) -> int:
    """Write all detection files to a fresh directory, then swap it in.

    The whole directory is replaced so files for segments that were unpublished
    or removed since the last build cannot linger. Returns total bytes written.
    """
    staging = target.with_name(target.name + ".new")
    previous = target.with_name(target.name + ".old")
    for leftover in (staging, previous):
        if leftover.exists():
            shutil.rmtree(leftover)

    total = 0
    staging.mkdir(parents=True)
    for relative, payload in files.items():
        path = staging / Path(relative).relative_to(DETECTIONS_DIR_NAME)
        path.parent.mkdir(parents=True, exist_ok=True)
        text = to_json_lines(payload)
        path.write_text(text, encoding="utf-8", newline="\n")
        total += len(text.encode("utf-8"))

    if target.exists():
        target.rename(previous)
    staging.rename(target)
    if previous.exists():
        shutil.rmtree(previous)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the website's published data")
    parser.add_argument("--metadata-dir", default=os.environ.get("SOUNDSCAPE_METADATA_DIR", "").strip(),
                        help="metadata folder on the archive drive (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--output", default="website/api/data.json", help="index file; detections/ is written beside it")
    parser.add_argument("--sensitive-species", type=Path, default=SENSITIVE_SPECIES_CSV,
                        help="species whose place the search hides (default: scripts/sensitive_species.csv)")
    parser.add_argument("--out-of-range-species", type=Path, default=OUT_OF_RANGE_CSV,
                        help="species left out as misidentifications where they do not live (default: scripts/out_of_range_species.csv)")
    args = parser.parse_args()
    if not args.metadata_dir:
        print(
            "Set SOUNDSCAPE_METADATA_DIR (or pass --metadata-dir) to the metadata folder on the archive drive.",
            file=sys.stderr,
        )
        return 2

    metadata_dir = Path(args.metadata_dir).expanduser()
    output_path = Path(args.output)

    published, unpublished, unrecognised = split_published(read_csv(metadata_dir / "segments.csv"))
    for segment_id, value in unrecognised:
        print(
            f"warning: segments.csv {segment_id}: published={value!r} is not true/false; treated as unpublished",
            file=sys.stderr,
        )

    index, detection_files = build_outputs(metadata_dir, published, args.sensitive_species, args.out_of_range_species)

    detections_bytes = replace_detections_dir(output_path.parent / DETECTIONS_DIR_NAME, detection_files)
    index_text = to_json_lines(index)
    write_text_atomic(output_path, index_text)
    index_bytes = len(index_text.encode("utf-8"))

    print(
        f"Wrote {output_path} ({index_bytes / 1024:.0f} KiB) with {index['segments_count']} published "
        f"segment(s); {len(unpublished)} unpublished segment(s) left out."
    )
    print(
        f"Wrote {len(detection_files)} detection file(s) to {output_path.parent / DETECTIONS_DIR_NAME} "
        f"({detections_bytes / 1024 / 1024:.1f} MiB)."
    )

    if index_bytes > PAGES_MAX_FILE_BYTES * 0.8:
        print(
            f"warning: {output_path} is {index_bytes / 1024 / 1024:.1f} MiB; Cloudflare Pages rejects files over 25 MiB",
            file=sys.stderr,
        )
    if len(detection_files) > PAGES_MAX_FILES * 0.75:
        print(
            f"warning: {len(detection_files)} detection files; Cloudflare Pages allows about "
            f"{PAGES_MAX_FILES:,} files per site, so detection files should move to R2 soon",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
