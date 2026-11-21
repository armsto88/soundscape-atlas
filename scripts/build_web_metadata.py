#!/usr/bin/env python3
"""Build the website's published data from the metadata CSV files.

Writes two kinds of file next to --output:

  data.json                         index: published segments, plus each site,
                                    session and species name stored once
  detections/<SITE>/<SEGMENT>.json  one file per segment with detections,
                                    loaded by the site when that segment is opened

Keeping detections out of the index keeps it small: one file of everything
grows past Cloudflare Pages' 25 MiB per-file limit after a few weeks of audio.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path
from datetime import datetime
from typing import Dict, List, NamedTuple, Optional, Tuple

from solar import segment_sun

# Decimal places published per sites.csv public_location_precision value.
# 2 dp is about 1.1 km north-south, 1 dp about 11 km (less east-west away from
# the equator). None publishes the coordinates as entered.
LOCATION_DECIMALS = {"exact": None, "rounded": 2, "coarse": 1}
PRECISION_NAMES = {None: "exact", 2: "rounded", 1: "coarse"}
DEFAULT_PRECISION = "rounded"
SENSITIVE_DECIMALS = 1  # sensitive sites are never more precise than "coarse"
SENSITIVE_ELEVATION_STEP_M = 100

DETECTIONS_DIR_NAME = "detections"
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


def segment_sun_info(segment: dict, location: PublicLocation, session: dict) -> Optional[dict]:
    """Time-of-day period and that day's sunrise/sunset for a segment.

    Uses the *published* coordinates, so these values reveal nothing more
    precise about a site than the map already shows.
    """
    try:
        start = datetime.fromisoformat(str(segment.get("segment_start_local") or ""))
        end = datetime.fromisoformat(str(segment.get("segment_end_local") or ""))
        latitude = float(location.latitude)
        longitude = float(location.longitude)
    except ValueError:
        return None
    timezone_name = str(session.get("timezone") or "").strip()
    if not timezone_name:
        return None
    return segment_sun(start, end, latitude, longitude, timezone_name)


def build_outputs(metadata_dir: Path, segments: List[dict]) -> Tuple[dict, Dict[str, dict]]:
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

    published_ids = {segment["segment_id"] for segment in segments}
    detections_by_segment: Dict[str, List[dict]] = defaultdict(list)
    for detection in detections:
        segment_id = detection.get("segment_id", "")
        if segment_id in published_ids:
            detections_by_segment[segment_id].append(detection)

    species_names = sorted(
        {
            (detection.get("common_name") or "Unknown").strip()
            for rows in detections_by_segment.values()
            for detection in rows
        },
        key=str.casefold,
    )
    species_index = {name: index for index, name in enumerate(species_names)}

    index_sites: Dict[str, dict] = {}
    index_sessions: Dict[str, dict] = {}
    index_segments: List[dict] = []
    detection_files: Dict[str, dict] = {}

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
                "locality": site.get("locality"),
                "elevation_m": location.elevation_m,
                "habitat": site.get("habitat"),
                "biome": site.get("biome"),
                "public_location_precision": location.precision,
                "description": site.get("description"),
                "is_sensitive": location.is_sensitive,
            }

        if session_id not in index_sessions:
            session = sessions_by_id.get(session_id, {})
            index_sessions[session_id] = {
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

        sun = segment_sun_info(segment, locations.get(site_id, no_location), sessions_by_id.get(session_id, {}))
        if sun and sun["sunrise"] and sun["sunset"] and sun["sunrise"] > sun["sunset"] and site_id not in suspect_sites:
            # Outside the polar regions sunrise is always before sunset in local
            # time; otherwise the sessions' timezone is almost certainly wrong.
            suspect_sites.add(site_id)
            print(
                f"warning: {site_id} (e.g. session {session_id}): sunrise {sun['sunrise']} after sunset "
                f"{sun['sunset']} in {sessions_by_id.get(session_id, {}).get('timezone')!r}; check the timezone",
                file=sys.stderr,
            )

        rows = detections_by_segment[segment_id]
        counts = Counter((row.get("common_name") or "Unknown").strip() for row in rows)
        top_species = [{"name": name, "count": count} for name, count in counts.most_common(6)]

        detections_url = ""
        if rows:
            if is_safe_id(site_id) and is_safe_id(segment_id):
                relative = f"{DETECTIONS_DIR_NAME}/{site_id}/{segment_id}.json"
                segment_detections = [
                    {
                        "detection_id": row.get("detection_id"),
                        "common_name": row.get("common_name"),
                        "scientific_name": row.get("scientific_name"),
                        "start_sec": parse_seconds(row.get("start_sec")),
                        "end_sec": parse_seconds(row.get("end_sec")),
                        "confidence": row.get("confidence"),
                        "model": row.get("model"),
                        "review_status": row.get("review_status"),
                    }
                    for row in rows
                ]
                segment_detections.sort(
                    key=lambda item: item["start_sec"] if item["start_sec"] is not None else -1
                )
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
                "top_species": top_species,
                "species_ids": sorted(species_index[name] for name in counts),
                "detections_url": detections_url,
                "period": sun["period"] if sun else "",
                "sunrise": sun["sunrise"] if sun else "",
                "sunset": sun["sunset"] if sun else "",
            }
        )

    # Totals describe only what is published, so hidden recordings are not
    # revealed through the counts either.
    index = {
        "format": 2,
        "sites_count": len(index_sites),
        "sessions_count": len(index_sessions),
        "segments_count": len(index_segments),
        "detections_count": sum(s["detection_count"] for s in index_segments),
        "species": species_names,
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
    parser.add_argument("--metadata-dir", default="metadata")
    parser.add_argument("--output", default="website/api/data.json", help="index file; detections/ is written beside it")
    args = parser.parse_args()

    metadata_dir = Path(args.metadata_dir)
    output_path = Path(args.output)

    published, unpublished, unrecognised = split_published(read_csv(metadata_dir / "segments.csv"))
    for segment_id, value in unrecognised:
        print(
            f"warning: segments.csv {segment_id}: published={value!r} is not true/false; treated as unpublished",
            file=sys.stderr,
        )

    index, detection_files = build_outputs(metadata_dir, published)

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
