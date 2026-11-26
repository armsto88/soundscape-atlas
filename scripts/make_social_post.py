#!/usr/bin/env python3
"""Make a short vertical video of one published moment, for social media.

    python3 scripts/make_social_post.py AU_NSW_BOOMERANG_FALLS_20240823_0600 --start 06:06:21 --number 1
    python3 scripts/make_social_post.py AU_NSW_BOOMERANG_FALLS_20240823_0600            # the liveliest 45 s
    python3 scripts/make_social_post.py AU_NSW_BOOMERANG_FALLS_20240823_0600 --stills   # three pictures first

The video follows the weekly post Tom approved on 24 Nov 2026 (the "Weekly
session post" mockup): 1080x1920, 30 frames a second, H.264 with AAC sound,
and it works muted. It opens on the place, the time and the map; the
spectrogram scrolls under a red playhead; whenever BirdNET is sure of a call
(as sure as the website's "now calling": 70 %, or checked by ear) the species
and its plate show as "Now calling"; the last seconds are an end card that
sends people to the whole session. Next to the video it writes the caption
(for Instagram, and with a direct link for Bluesky and Mastodon) and a cover
picture. --stills writes three frames instead, to check the look quickly.

Only published hours can be used. Everything comes from the public website
data (website/api) and the public audio on R2, so the video shows nothing the
site does not (sensitive species are left out there already). Possible human
voices were listened to when the hour was published; when the archive drive is
connected the script also checks BirdNET's voice scores for the clip and stops
if there are any (--voices-checked once you have listened to them).

The direct link opens the place at that hour with the player at the clip's
first second (&t=, see website/js/site.js).

Needs ffmpeg and Google Chrome or Chromium (headless; --chrome to choose). The
maps come from the local map files in .maptiles (scripts/build_map_tiles.py).
The hour's audio is downloaded once into .cache/social/. Output goes to
social/ (ignored by git).
"""

from __future__ import annotations

import argparse
import base64
import fcntl
import functools
import json
import math
import os
import re
import select
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from preview_site import Handler as PreviewHandler  # noqa: E402
from solar import sun_day  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
WEBSITE = REPO / "website"
DATA = WEBSITE / "api" / "data.json"
TEMPLATE = REPO / "scripts" / "social"
MAPTILES = REPO / ".maptiles"
CACHE = REPO / ".cache" / "social"
OUT = REPO / "social"
SITE_URL = "https://soundscapeatlas.com"
DOMAIN = "soundscapeatlas.com"

WIDTH, HEIGHT, FPS = 1080, 1920, 30
DEFAULT_LENGTH = 45
DEFAULT_ZOOM = 24            # spectrogram pixels per second: 45 s across the frame
BAND_HEIGHT = 316            # the spectrogram band in post.html
TOP_HZ = 12000               # as the website's strips (make_spectrograms.py)
SAMPLE_RATE = 2 * TOP_HZ
N_FFT = 1024
# Spectrogram tone, in dB above each frequency's background (its 25th percentile
# over the strip): the hiss, the stream and any steady hum stay paper, calls stand
# out. FLOOR dB above the background is still paper, INK and louder is full ink,
# with a power curve between. (The website's strips use a fixed curve instead.)
BACKGROUND_PERCENTILE, FLOOR_DB, INK_DB, TONE_POWER, INK_GREY = 25, 5.0, 25.0, 1.4, 42
PAPER_0 = (254, 253, 250)

NOW_CONFIDENT = 0.7          # as website/js/player.js: "now calling" needs this score, or a check by ear
MIN_CALLS = 3                # as website/js/data.js: a species counts in a session after 3 calls
VOICE_MIN_CONFIDENCE = 0.25  # as publish_session.py
INTRO_SEC = 3.0              # the opening panel ("Headphones on") stays at least this long
HOLD_SEC = 3.5               # a species stays on screen at least this long
SWITCH_SEC = 8.0             # after this, another calling species may take over
END_CARD_SEC = 4.0
FADE_IN_SEC = 0.3
FADE_OUT_SEC = 2.5
TARGET_LUFS = -16.0
MAX_TRUE_PEAK = -1.0
LIMIT_DB = 6.0               # the limiter may take up to this much off the loudest peaks

COUNTRY_NAMES = {"AU": "Australia", "DE": "Germany"}  # as website/js/data.js
STATE_NAMES = {
    "AU": {"NSW": "New South Wales", "QLD": "Queensland", "VIC": "Victoria", "TAS": "Tasmania", "SA": "South Australia",
           "WA": "Western Australia", "NT": "Northern Territory", "ACT": "Australian Capital Territory"},
    "DE": {"BW": "Baden-Württemberg", "SL": "Saarland", "BY": "Bavaria", "RP": "Rhineland-Palatinate", "HE": "Hesse",
           "NW": "North Rhine-Westphalia"},
}
BIRDNET_CREDIT = ("Species identified by BirdNET+ V3.0 (Cornell Lab of Ornithology and Chemnitz University of "
                  "Technology); may contain errors.")
MAP_CREDIT = "Map © OpenStreetMap, Protomaps, Mapterhorn."


class Stop(Exception):
    """A problem that ends the run with an explanation."""


# ---- the moment ------------------------------------------------------------------

def parse_local(text: str) -> datetime:
    return datetime.fromisoformat(text)


def clip_start_from(text: str, hour_start: datetime, duration: float) -> float:
    """--start as seconds into the hour: a clock time (06:06:21, 06:06) or seconds (381)."""
    if re.fullmatch(r"\d+(\.\d+)?", text):
        return float(text)
    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?", text)
    if not match:
        raise Stop(f"--start {text}: give a clock time like 06:06:21, or seconds into the hour")
    hour, minute, second = int(match.group(1)), int(match.group(2)), float(match.group(3) or 0)
    for day in (0, 1):
        moment = datetime.combine(hour_start.date() + timedelta(days=day), datetime.min.time()) \
            + timedelta(hours=hour, minutes=minute, seconds=second)
        offset = (moment - hour_start).total_seconds()
        if 0 <= offset < duration:
            return offset
    end = hour_start + timedelta(seconds=duration)
    raise Stop(f"--start {text} is not inside this hour ({hour_start:%H:%M:%S} to {end:%H:%M:%S})")


def fmt_minutes(minutes: float) -> str:
    total = int(round(abs(minutes)))
    hours, rest = divmod(total, 60)
    if not hours:
        return f"{rest} min"
    return f"{hours} h {rest} min" if rest else f"{hours} h"


def sun_moment(moment: datetime, lat: float, lon: float, tz: ZoneInfo) -> Tuple[str, str]:
    """('Dawn chorus, 4 min before sunrise', 'dawn') for a local moment."""
    days = [sun_day(moment.date() + timedelta(days=d), lat, lon, tz) for d in (-1, 0, 1)]
    rises = [d.sunrise for d in days if d.sunrise]
    sets = [d.sunset for d in days if d.sunset]
    if not rises or not sets:
        return ("", "day")
    rise = min(rises, key=lambda t: abs((moment - t).total_seconds()))
    set_ = min(sets, key=lambda t: abs((moment - t).total_seconds()))
    to_rise = (moment - rise).total_seconds() / 60
    to_set = (moment - set_).total_seconds() / 60
    if -90 <= to_rise < 0:
        return (f"Dawn chorus, {fmt_minutes(to_rise)} before sunrise", "dawn")
    if 0 <= to_rise < 45:
        return (f"Dawn chorus, {fmt_minutes(to_rise)} after sunrise", "sunrise")
    if -60 <= to_set < 0:
        return (f"Evening, {fmt_minutes(to_set)} before sunset", "evening")
    if 0 <= to_set < 90:
        return (f"Dusk, {fmt_minutes(to_set)} after sunset", "dusk")
    next_rise = min((t for t in rises if t > moment), default=None)
    last_set = max((t for t in sets if t < moment), default=None)
    if next_rise and last_set and last_set > max((t for t in rises if t < moment), default=datetime.min):
        before = (next_rise - moment).total_seconds() / 60
        after = (moment - last_set).total_seconds() / 60
        return ((f"Night, {fmt_minutes(before)} before sunrise" if before < after
                 else f"Night, {fmt_minutes(after)} after sunset"), "night")
    return ("Morning" if moment.hour < 12 else "Afternoon", "day")


def tagline_for(habitat: str, kind: str, to_sunrise_text: str) -> str:
    noun = (habitat or "forest").replace("_", " ")
    return {
        "dawn": f"The {noun} just before sunrise" if "before sunrise" in to_sunrise_text else f"The {noun} at dawn",
        "sunrise": f"The {noun} at sunrise",
        "evening": f"The {noun} towards evening",
        "dusk": f"The {noun} at dusk",
        "night": f"The {noun} at night",
    }.get(kind, f"The {noun} by day")


def weather_line(session_id: str, moment: datetime) -> str:
    """'15 °C · overcast · light breeze', in the words of website/js/weather.js."""
    path = WEBSITE / "api" / "weather" / f"{session_id}.json"
    if not path.is_file():
        return ""
    w = json.loads(path.read_text())
    at = {name: i for i, name in enumerate(w["fields"])}
    hours = [(parse_local(h[at["time"]]), h) for h in w["hours"]]
    if not hours:
        return ""
    t, h = min(hours, key=lambda pair: abs((pair[0] - moment).total_seconds()))
    if abs((t - moment).total_seconds()) > 2 * 3600:
        return ""
    cloud, wind, rain = h[at["cloud_cover"]], h[at["wind_speed_10m"]], h[at["precipitation"]] or 0
    cloud_word = "clear" if cloud < 25 else "partly cloudy" if cloud < 70 else "overcast"
    wind_word = ("still" if wind < 6 else "light breeze" if wind < 12 else "breezy" if wind < 20
                 else "windy" if wind < 30 else "strong wind")
    parts = [f"{round(h[at['temperature_2m']])} °C", cloud_word, wind_word]
    if rain >= 0.2:
        parts.append(f"rain {rain:.1f} mm")
    return " · ".join(parts)


def long_date(day: datetime) -> str:
    return f"{day:%A} {day.day} {day:%B} {day.year}"


def fmt_span(a: datetime, b: datetime) -> str:
    """As fmtSpan in website/js/util.js."""
    if a.date() == b.date():
        return f"{a:%a} {a.day} {a:%b} {a.year}, {a:%H:%M} → {b:%H:%M}"
    if a.year == b.year:
        return f"{a:%a} {a.day} {a:%b} {a:%H:%M} → {b:%a} {b.day} {b:%b} {b:%H:%M}, {b.year}"
    return f"{a:%a} {a.day} {a:%b} {a.year} {a:%H:%M} → {b:%a} {b.day} {b:%b} {b.year} {b:%H:%M}"


# ---- species ------------------------------------------------------------------------

def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def plate_credits() -> Dict[str, Dict[str, str]]:
    """Artist and source of each plate, from website/art/*/CREDITS.md."""
    credits: Dict[str, Dict[str, str]] = {}
    for kind in ("birds", "frogs"):
        path = WEBSITE / "art" / kind / "CREDITS.md"
        if not path.is_file():
            continue
        header: List[str] = []
        source = "Fugleramme" if kind == "birds" else "Soundscape Atlas"
        for line in path.read_text().splitlines():
            if line.startswith("## Cut for this site"):
                source = "Soundscape Atlas"
            if not line.startswith("|") or line.startswith("|---"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells[0] == "File":
                header = cells
                continue
            row = dict(zip(header, cells))
            artist = (row.get("Plate by") or row.get("Plate") or "").split(",")[0]
            artist = artist.replace(" and collaborators", "").strip()
            credits[f"{kind}/{row.get('File', '').removesuffix('.webp')}"] = {"artist": artist, "source": source}
    return credits


def plate_for(scientific: str, group: str, manifest: Dict[str, List[str]]) -> Optional[str]:
    kind = "frogs" if group == "Amphibia" else "birds"
    key = slug(scientific)
    return f"{kind}/{key}" if key in manifest.get(kind, []) else None


def load_detections(segment: dict) -> List[dict]:
    url = segment.get("detections_url")
    if not url:
        return []
    raw = json.loads((WEBSITE / "api" / url).read_text())
    out = []
    for d in raw.get("detections", []):
        confidence = float(d.get("confidence") or 0)
        checked = d.get("review_status") == "confirmed"
        end = d.get("end_sec")
        out.append({
            "name": d["common_name"], "scientific": d.get("scientific_name", ""), "group": d.get("group", ""),
            "start": float(d["start_sec"]), "end": float(end) if end is not None else float(d["start_sec"]) + 3,
            "confidence": confidence, "checked": checked, "sure": checked or confidence >= NOW_CONFIDENT,
        })
    return out


def liveliest_start(sure: List[dict], duration: float, length: float) -> float:
    """The clip start whose middle part (between the opening and the end card) has the most sure calls."""
    best, best_score = 0.0, -1.0
    last = max(0.0, duration - length)
    step = 1.0
    start = 0.0
    while start <= last + 1e-9:
        a, b = start + INTRO_SEC, start + length - END_CARD_SEC
        inside = [d for d in sure if d["start"] >= a and d["end"] <= b]
        score = 3 * len({d["name"] for d in inside}) + len(inside)
        if score > best_score:
            best, best_score = start, score
        start += step
    return best


def merge(spans: List[Tuple[float, float]]) -> List[List[float]]:
    out: List[List[float]] = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1] + 0.5:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def plan_panels(sure: List[dict], clip_start: float, length: float, end_from: float) -> List[dict]:
    """Which panel shows when: the opening, then the species calling (clip seconds)."""
    spans: Dict[str, List[Tuple[float, float, float]]] = defaultdict(list)
    for d in sure:
        a = d["start"] - 0.3 - clip_start  # as player.js callsAt
        b = d["end"] + 0.6 - clip_start
        if b >= 0 and a <= end_from:
            spans[d["name"]].append((max(0.0, a), min(length, b), d["confidence"]))
    shown: List[Tuple[float, Optional[str]]] = [(0.0, None)]
    current: Optional[str] = None
    since = 0.0
    step = 0.1
    for i in range(int(round(INTRO_SEC / step)), int(end_from / step)):
        t = i * step
        calling = {name: max(c for a, b, c in ss if a <= t <= b)
                   for name, ss in spans.items() if any(a <= t <= b for a, b, _ in ss)}
        others = {name: c for name, c in calling.items() if name != current}
        if not others:
            continue
        held = t - since
        if current is None or (current not in calling and held >= HOLD_SEC) or held >= SWITCH_SEC:
            current = max(others, key=others.get)
            since = t
            shown.append((round(t, 2), current))
    panels = []
    for i, (t, name) in enumerate(shown):
        to = shown[i + 1][0] if i + 1 < len(shown) else length
        panel = {"from": t, "to": to, "name": name}
        if name:
            panel["calling"] = merge([(a, b) for a, b, _ in spans[name]])
        panels.append(panel)
    return panels


# ---- audio ------------------------------------------------------------------------

def fetch_audio(url: str, segment_id: str) -> Path:
    """The hour's public Opus copy, downloaded once (again only if it changed on the bucket)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{segment_id}.opus"
    tag_file = path.with_suffix(".etag")
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "soundscape-atlas-social"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            etag = response.headers.get("ETag", "")
    except OSError as error:
        if path.is_file():
            print(f"  could not reach {url} ({error}); using the copy downloaded before")
            return path
        raise Stop(f"Could not reach the hour's audio at {url}: {error}")
    if path.is_file() and tag_file.is_file() and tag_file.read_text() == etag:
        return path
    print(f"  downloading the hour's audio from {url}")
    tmp = path.with_suffix(".part")
    request = urllib.request.Request(url, headers={"User-Agent": "soundscape-atlas-social"})
    with urllib.request.urlopen(request, timeout=60) as response, open(tmp, "wb") as handle:
        shutil.copyfileobj(response, handle, 1 << 20)
    os.replace(tmp, path)
    tag_file.write_text(etag)
    return path


def run(cmd: List[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise Stop(f"{cmd[0]} failed: {result.stderr.decode(errors='replace').strip()[-800:]}")
    return result


def decode(path: Path, start: float, duration: float) -> np.ndarray:
    out = run(["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
               "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]).stdout
    return np.frombuffer(out, dtype=np.float32)


def spectrogram(samples: np.ndarray, px_per_sec: float, columns: int) -> Image.Image:
    """A sharp spectrogram strip, 0-12 kHz, dark marks multiplied onto the paper (an RGB picture)."""
    hop = max(1, min(240, int(SAMPLE_RATE / px_per_sec / 2)))
    window = np.hanning(N_FFT).astype(np.float32)
    padded = np.concatenate([np.zeros(N_FFT // 2, np.float32), samples, np.zeros(N_FFT // 2, np.float32)])
    n_frames = max(1, 1 + (len(padded) - N_FFT) // hop)
    frames_db = np.empty((n_frames, N_FFT // 2 + 1), np.float32)
    scale = window.sum() / 2  # a full-scale sine reads 0 dB
    for first in range(0, n_frames, 4096):
        count = min(4096, n_frames - first)
        idx = (first + np.arange(count))[:, None] * hop + np.arange(N_FFT)[None, :]
        magnitude = np.abs(np.fft.rfft(padded[idx] * window, axis=1)) / scale
        frames_db[first:first + count] = 20 * np.log10(magnitude + 1e-9)
    # loudest frame in each pixel column, so short calls stay sharp
    column_of = np.minimum((np.arange(n_frames) * hop / SAMPLE_RATE * px_per_sec).astype(int), columns - 1)
    starts = np.flatnonzero(np.r_[True, column_of[1:] != column_of[:-1]])
    reduced = np.maximum.reduceat(frames_db, starts, axis=0)
    full = np.full((columns, frames_db.shape[1]), -200.0, np.float32)
    full[column_of[starts]] = reduced
    image = np.asarray(Image.fromarray(full.T[::-1].copy(), mode="F").resize((columns, BAND_HEIGHT), Image.BOX))
    background = np.percentile(image, BACKGROUND_PERCENTILE, axis=1, keepdims=True)
    level = np.clip((image - background - FLOOR_DB) / (INK_DB - FLOOR_DB), 0, 1) ** TONE_POWER
    grey = 1 - (1 - INK_GREY / 255) * level
    rgb = (np.array(PAPER_0, np.float32)[None, None, :] * grey[:, :, None]).round().astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def loudness(path: Path, start: float, length: float) -> Tuple[float, float]:
    """Integrated loudness (LUFS) and true peak (dBTP) of the clip."""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-ss", f"{start:.3f}", "-t", f"{length:.3f}",
                          "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    integrated = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", err)
    peak = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", err)
    if not integrated or not peak:
        raise Stop("Could not measure the clip's loudness with ffmpeg")
    value = lambda s: float("-inf") if s == "-inf" else float(s)  # noqa: E731
    return value(integrated[-1]), value(peak[-1])


def encode_audio(path: Path, start: float, length: float, gain: float, out: Path) -> None:
    """The clip's sound: the gain, a limiter at the ceiling for the few peaks it lifts above it, and fades."""
    fade_out = max(0.0, length - FADE_OUT_SEC)
    ceiling = 10 ** ((MAX_TRUE_PEAK - 0.5) / 20)  # sample peaks, so a little under the true-peak ceiling
    run(["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{length:.3f}",
         "-i", str(path), "-af",
         f"volume={gain:.2f}dB,alimiter=limit={ceiling:.4f}:attack=2:release=80:level=disabled,"
         f"afade=t=in:st=0:d={FADE_IN_SEC},afade=t=out:st={fade_out:.3f}:d={FADE_OUT_SEC}",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", str(out)])


def check_voices(archive_root: Optional[Path], segment: dict, clip_start: float, length: float) -> Optional[List[str]]:
    """Possible human voices in the clip from the raw BirdNET output, or None when it can't be read."""
    if archive_root is None:
        return None
    path = archive_root / "birdnet" / segment["site_id"] / f"{segment['session_id']}.BirdNET.results.csv"
    if not path.is_file():
        return None
    from import_birdnet import HUMAN_VOICE_CLASSES, parse_results
    detections, problem = parse_results(path)
    if problem:
        raise Stop(f"Could not read {path}: {problem}")
    # raw times count from the working hour's start, named in the segment ID (to the minute)
    match = re.search(r"_(\d{8})_(\d{4})$", segment["segment_id"])
    raw_start = datetime.strptime("".join(match.groups()), "%Y%m%d%H%M") if match else None
    public_start = parse_local(segment["segment_start_local"])
    shift = (public_start - raw_start).total_seconds() if raw_start else 0.0
    a, b = clip_start + shift - 10, clip_start + shift + length + 10  # ten seconds' margin
    found = []
    for d in detections:
        if (d.segment_id == segment["segment_id"] and d.common.strip().lower() in HUMAN_VOICE_CLASSES
                and d.confidence >= VOICE_MIN_CONFIDENCE and d.end > a and d.start < b):
            found.append(f"{d.common} {d.confidence:.0%} at {(public_start + timedelta(seconds=d.start - shift)):%H:%M:%S}")
    return found


# ---- headless Chrome, over its debugging pipe ---------------------------------------

class Chrome:
    """Just enough of the Chrome DevTools Protocol, spoken over --remote-debugging-pipe."""

    def __init__(self, binary: str):
        self.profile = tempfile.mkdtemp(prefix="social-chrome-")
        to_chrome, self.writer = os.pipe()
        self.reader, from_chrome = os.pipe()

        def child() -> None:  # Chrome reads commands on fd 3 and answers on fd 4
            a = fcntl.fcntl(to_chrome, fcntl.F_DUPFD, 10)
            b = fcntl.fcntl(from_chrome, fcntl.F_DUPFD, 10)
            os.dup2(a, 3)
            os.dup2(b, 4)

        self.proc = subprocess.Popen(
            [binary, "--headless=new", "--remote-debugging-pipe", f"--user-data-dir={self.profile}",
             "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio",
             "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
             "--force-color-profile=srgb", f"--window-size={WIDTH},{HEIGHT}", "about:blank"],
            preexec_fn=child, close_fds=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.close(to_chrome)
        os.close(from_chrome)
        self.buffer = bytearray()
        self.next_id = 0
        self.errors: List[str] = []

    def _message(self, timeout: float) -> dict:
        deadline = time.time() + timeout
        while True:
            end = self.buffer.find(b"\0")
            if end >= 0:
                raw = bytes(self.buffer[:end])
                del self.buffer[:end + 1]
                return json.loads(raw)
            left = deadline - time.time()
            if left <= 0 or not select.select([self.reader], [], [], left)[0]:
                raise Stop("Chrome stopped answering")
            chunk = os.read(self.reader, 1 << 20)
            if not chunk:
                raise Stop("Chrome closed unexpectedly")
            self.buffer += chunk

    def _event(self, message: dict) -> None:
        method, params = message.get("method"), message.get("params", {})
        if method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails", {})
            self.errors.append(details.get("exception", {}).get("description") or details.get("text", "error"))
        elif method == "Runtime.consoleAPICalled" and params.get("type") == "error":
            self.errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in params.get("args", [])))

    def send(self, method: str, params: Optional[dict] = None, session: Optional[str] = None, timeout: float = 120) -> dict:
        self.next_id += 1
        message = {"id": self.next_id, "method": method, "params": params or {}}
        if session:
            message["sessionId"] = session
        data = json.dumps(message).encode() + b"\0"
        while data:
            data = data[os.write(self.writer, data):]
        while True:
            reply = self._message(timeout)
            if reply.get("id") == message["id"]:
                if "error" in reply:
                    raise Stop(f"Chrome could not do {method}: {reply['error'].get('message')}")
                return reply.get("result", {})
            self._event(reply)

    def page(self, width: int, height: int) -> str:
        target = self.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        session = self.send("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        self.send("Emulation.setDeviceMetricsOverride",
                  {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False}, session)
        self.send("Runtime.enable", {}, session)
        self.send("Page.enable", {}, session)
        return session

    def evaluate(self, session: str, expression: str, wait: bool = False, timeout: float = 120):
        result = self.send("Runtime.evaluate", {"expression": expression, "awaitPromise": wait, "returnByValue": True},
                           session, timeout)
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            raise Stop("The page failed: " + (details.get("exception", {}).get("description") or details.get("text", "")))
        return result.get("result", {}).get("value")

    def open(self, session: str, url: str, timeout: float = 90):
        """Load a page and wait for its window.ready promise."""
        self.send("Page.navigate", {"url": url}, session)
        deadline = time.time() + timeout
        check = f"location.href === {json.dumps(url)} && typeof window.ready !== 'undefined'"
        while not self.evaluate(session, check):
            if time.time() > deadline:
                raise Stop(f"{url} did not load")
            time.sleep(0.1)
        try:
            return self.evaluate(session, "window.ready", wait=True, timeout=timeout)
        except Stop as error:
            raise Stop(f"{error}{' (' + '; '.join(self.errors) + ')' if self.errors else ''}") from None

    def screenshot(self, session: str, fmt: str = "png", clip: Optional[dict] = None) -> bytes:
        params: dict = {"format": fmt, "optimizeForSpeed": True}
        if fmt == "jpeg":
            params["quality"] = 94
        if clip:
            params["clip"] = {**clip, "scale": 1}
        return base64.b64decode(self.send("Page.captureScreenshot", params, session)["data"])

    def close(self) -> None:
        try:
            self.send("Browser.close", timeout=5)
        except Stop:
            pass
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        for fd in (self.reader, self.writer):
            try:
                os.close(fd)
            except OSError:
                pass
        shutil.rmtree(self.profile, ignore_errors=True)


def find_chrome(choice: Optional[str]) -> str:
    for name in ([choice] if choice else ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]):
        path = shutil.which(name) if name else None
        if path:
            return path
    raise Stop("Google Chrome or Chromium is needed (or name it with --chrome)")


def serve(work: Path) -> Tuple[ThreadingHTTPServer, str]:
    """website/ with the post's files at /social/ and the map files at /map/."""

    class Handler(PreviewHandler):
        def translate_path(self, path):
            clean = path.split("?", 1)[0].split("#", 1)[0]
            if clean.startswith("/social/"):
                return str(work / os.path.normpath(clean[len("/social/"):]).lstrip("./"))
            if clean.startswith("/api/"):  # the published data, not the preview's
                return str(WEBSITE / "api" / os.path.normpath(clean[len("/api/"):]).lstrip("./"))
            return super().translate_path(path)

        def log_message(self, fmt, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(WEBSITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


# ---- the caption ------------------------------------------------------------------

def join_names(names: List[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def caption(site: dict, moment: datetime, kind: str, weather: str, heard: List[str], shown: List[dict],
            credits: Dict[str, Dict[str, str]], link: str, frogs: bool, birds: bool, session_word: str) -> str:
    region = site.get("region_code") or ""
    first = f"{site['site_name']}{', ' + region if region else ''} · {moment:%H:%M}, {moment.day} {moment:%B} {moment.year}"
    body = "[A line or two in your own words about this moment.]"
    if heard:
        body += f" Calling in this clip: {join_names(heard)}."
    if weather:
        words = weather.replace(" · ", ", ")
        body += " " + words[0].upper() + words[1:] + "."
    support = ""
    if site.get("support_name"):
        url = re.sub(r"^https?://(www\.)?", "", site.get("support_url", "")).rstrip("/")
        support = f"Care for this place: {site['support_name']} [@handle]{', ' + url if url else ''}"
    artists, sources, plated = [], [], set()
    for p in shown:
        c = credits.get(p.get("plate_key") or "")
        if not c or not p.get("plate_key", "").startswith("birds/"):
            continue
        plated.add(p["plate_key"])
        if c["artist"] and c["artist"] not in artists:
            artists.append(c["artist"])
        if c["source"] not in sources:
            sources.append(c["source"])
    plates = ""
    if artists:
        via = " and ".join("Fugleramme" if s == "Fugleramme" else "Soundscape Atlas" for s in sources)
        plates = f" Plate{'s' if len(plated) > 1 else ''}: {join_names(artists)}, via {via}, CC BY-SA 4.0."
    if any(p.get("plate_key", "").startswith("frogs/") for p in shown):
        plates += " Frog illustrations made for Soundscape Atlas."
    tags = ["#fieldrecording", "#soundscape"]
    tags += {"dawn": ["#dawnchorus"], "sunrise": ["#dawnchorus"], "dusk": ["#dusk"], "evening": ["#dusk"],
             "night": ["#nightsounds"]}.get(kind, [])
    if birds:
        tags.append("#birdsong")
    if frogs:
        tags.append("#frogs")
    tags.append("#naturesounds")

    def version(where: str) -> str:
        lines = [first, "", body, "", f"Hear the whole session, {session_word}: {where}"]
        if support:
            lines.append(support)
        lines += ["", BIRDNET_CREDIT + plates + " " + MAP_CREDIT, "", " ".join(tags)]
        return "\n".join(lines)

    return ("Instagram / Facebook\n--------------------\n" + version("link in bio")
            + "\n\n\nBluesky / Mastodon / YouTube\n----------------------------\n" + version(link)
            + f"\n\n\nDirect link to this moment: {link}\n")


# ---- main ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="A 9:16 video of a published moment, with its caption")
    parser.add_argument("segment", help="the hour's segment ID, e.g. AU_NSW_BOOMERANG_FALLS_20240823_0600")
    parser.add_argument("--start", help="clip start: a clock time (06:06:21) or seconds into the hour "
                                        "(default: the liveliest stretch of the hour)")
    parser.add_argument("--length", type=float, default=DEFAULT_LENGTH, help=f"seconds (default {DEFAULT_LENGTH})")
    parser.add_argument("--number", type=int, help="the post's number, shown as 'No. 01'")
    parser.add_argument("--zoom", type=float, default=DEFAULT_ZOOM,
                        help=f"spectrogram pixels per second (default {DEFAULT_ZOOM}; 6 shows 3 minutes)")
    parser.add_argument("--subtitle", help="the line under the place's name (default: the site description)")
    parser.add_argument("--moment", help="the line under the date (default: e.g. 'Dawn chorus, 4 min before sunrise')")
    parser.add_argument("--tagline", help="the opening panel's last line (default: e.g. 'The rainforest at dawn')")
    parser.add_argument("--stills", action="store_true", help="write three frames as pictures instead of the video")
    parser.add_argument("--voices-checked", action="store_true", help="you have listened to the possible voices")
    parser.add_argument("--archive-root", help="archive folder, for the voice check (default: above $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--out", default=str(OUT), help=f"output folder (default {OUT.relative_to(REPO)}/)")
    parser.add_argument("--chrome", help="Chrome or Chromium to use")
    args = parser.parse_args()

    if not 10 <= args.length <= 180:
        raise Stop("--length: between 10 and 180 seconds")
    data = json.loads(DATA.read_text())
    segment = next((s for s in data["segments"] if s["segment_id"] == args.segment), None)
    if segment is None:
        raise Stop(f"{args.segment} is not in website/api/data.json: only published hours can be posted")
    if not segment.get("public_url"):
        raise Stop(f"{args.segment} has no public audio yet")
    site = data["sites"][segment["site_id"]]
    session = data["sessions"][segment["session_id"]]
    session_segments = sorted((s for s in data["segments"] if s["session_id"] == segment["session_id"]),
                              key=lambda s: s["segment_start_local"])
    tz = ZoneInfo(session["timezone"])
    hour_start = parse_local(segment["segment_start_local"])
    duration = (parse_local(segment["segment_end_local"]) - hour_start).total_seconds()
    length = args.length
    if length > duration:
        raise Stop(f"This hour has only {duration:.0f} s of published audio")

    detections = load_detections(segment)
    sure = [d for d in detections if d["sure"]]
    clip_start = clip_start_from(args.start, hour_start, duration) if args.start else liveliest_start(sure, duration, length)
    if clip_start + length > duration + 1e-6:
        latest = hour_start + timedelta(seconds=duration - length)
        raise Stop(f"The clip would run past the end of the hour; start at {latest:%H:%M:%S} or earlier")
    moment = hour_start + timedelta(seconds=clip_start)
    clip_end = moment + timedelta(seconds=length)
    print(f"{site['site_name']}: {moment:%a %d %b %Y, %H:%M:%S} to {clip_end:%H:%M:%S} ({length:.0f} s)")

    # possible voices, when the drive is there
    archive = args.archive_root or (str(Path(os.environ["SOUNDSCAPE_METADATA_DIR"]).parent)
                                    if os.environ.get("SOUNDSCAPE_METADATA_DIR") else None)
    archive_root = Path(archive) if archive and Path(archive).is_dir() else None
    voices = check_voices(archive_root, segment, clip_start, length)
    if voices is None:
        print("  voices: not checked again (archive drive not connected); the hour was checked when it was published")
    elif voices and not args.voices_checked:
        raise Stop("BirdNET heard possible human voices in or near the clip: " + "; ".join(voices)
                   + ". Listen first; then run again with --voices-checked, or choose another start.")
    else:
        print(f"  voices: {'none' if not voices else 'listened to (--voices-checked): ' + '; '.join(voices)}")

    # species shown
    manifest = json.loads((WEBSITE / "art" / "manifest.json").read_text())
    credits = plate_credits()
    end_from = length - END_CARD_SEC
    plan = plan_panels(sure, clip_start, length, end_from)
    info = {d["name"]: d for d in detections}
    checked = {d["name"] for d in detections if d["checked"]}
    panels: List[dict] = []
    kicker = f"{length:.0f} seconds · sound on"
    when, kind = sun_moment(moment, float(site["latitude"]), float(site["longitude"]), tz)
    when = args.moment or when
    tagline = args.tagline or tagline_for(site.get("habitat", ""), kind, when)
    for p in plan:
        if p["name"] is None:
            panels.append({"kind": "intro", "from": p["from"], "to": p["to"], "kicker": kicker,
                           "title": "Headphones on", "line": tagline})
            continue
        d = info[p["name"]]
        key = plate_for(d["scientific"], d["group"], manifest)
        artist = credits.get(key or "", {}).get("artist", "")
        credit = "Identified by BirdNET" + (", checked by ear" if p["name"] in checked else "")
        if key and key.startswith("birds/") and artist:
            credit += f" · plate: {artist}"
        panels.append({"kind": "species", "from": p["from"], "to": p["to"], "name": d["name"],
                       "scientific": d["scientific"], "plate": f"art/{key}.webp" if key else None, "plate_key": key,
                       "credit": credit, "calling": p["calling"]})
    shown = [p for p in panels if p["kind"] == "species"]
    for p in shown:
        print(f"  {p['from']:5.1f} s  {p['name']}")
    if not shown:
        print("  no species BirdNET is sure of in this clip: the opening panel stays on")

    # every sure species in the clip, most calls first, for the caption
    counts: Dict[str, int] = defaultdict(int)
    for d in sure:
        if d["end"] > clip_start and d["start"] < clip_start + length:
            counts[d["name"]] += 1
    heard = sorted(counts, key=lambda n: (-counts[n], n))
    clip_groups = {info[n]["group"] for n in heard}

    # the session, for the end card
    first_start = parse_local(session_segments[0]["segment_start_local"])
    last_end = parse_local(session_segments[-1]["segment_end_local"])
    seconds = sum((parse_local(s["segment_end_local"]) - parse_local(s["segment_start_local"])).total_seconds()
                  for s in session_segments)
    totals: Dict[int, Tuple[int, bool]] = {}
    for s in session_segments:
        for entry in s.get("species", []):
            calls, was_checked = totals.get(entry[0], (0, False))
            totals[entry[0]] = (calls + entry[1], was_checked or bool(entry[5]))
    counted = [data["species"][i] for i, (calls, ok) in totals.items() if calls >= MIN_CALLS or ok]
    groups = {s.get("group") for s in counted}
    what = ("species of birds and frogs" if {"Aves", "Amphibia"} <= groups
            else "species of frogs" if groups == {"Amphibia"} else "species of birds")
    night = any(kind_ == "night" for kind_ in (sun_moment(first_start + timedelta(hours=h), float(site["latitude"]),
                                                          float(site["longitude"]), tz)[1]
                                                for h in range(int(seconds // 3600) + 1)))
    dawn = any(k in ("dawn", "sunrise") for k in (sun_moment(first_start + timedelta(minutes=m), float(site["latitude"]),
                                                             float(site["longitude"]), tz)[1]
                                                  for m in range(0, int(seconds // 60) + 1, 20)))
    session_word = "dusk till dawn" if night and dawn else "from start to finish"
    hours_text = fmt_minutes(seconds / 60)
    number = f"No. {args.number:02d}" if args.number else ""
    region = STATE_NAMES.get(site["country_code"], {}).get(site.get("region_code", ""), site.get("region_code", ""))
    country = COUNTRY_NAMES.get(site["country_code"], site["country_code"])
    if (last_end - clip_end).total_seconds() > 300:
        note = f"The clip ends at {clip_end:%H:%M}. The recording runs on until {last_end:%H:%M}."
    else:
        note = f"The clip ends at {clip_end:%H:%M}. The recording began at {first_start:%H:%M}."

    # the spectrogram: the clip, and as much on either side as the frame shows
    zoom = args.zoom
    half = WIDTH / 2 / zoom + 2
    spec_start = max(0.0, clip_start - half)
    spec_end = min(duration, clip_start + length + half)
    columns = int(round((spec_end - spec_start) * zoom))
    tick_every = 60 if zoom < 10 else 30 if zoom < 20 else 10 if zoom < 50 else 5

    link = f"{SITE_URL}/#/site/{site_id_quote(segment['site_id'])}?at={segment['segment_id']}&t={int(clip_start)}"
    out_dir = Path(args.out).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{'%02d_' % args.number if args.number else ''}{segment['site_id']}_{moment:%Y%m%d_%H%M%S}"

    chrome_binary = find_chrome(args.chrome)
    audio = fetch_audio(segment["public_url"], segment["segment_id"])
    work = Path(tempfile.mkdtemp(prefix="social-post-"))
    server = None
    chrome = None
    try:
        for file in ("post.html", "map.html"):
            shutil.copy(TEMPLATE / file, work / file)
        samples = decode(audio, spec_start, spec_end - spec_start)
        spectrogram(samples, zoom, columns).save(work / "spectrogram.png")

        post = {
            "domain": DOMAIN, "eyebrow": " · ".join(x for x in (number, region, country) if x),
            "title": site["site_name"], "subtitle": args.subtitle or site.get("description", ""),
            "clock": f"{moment:%H:%M}", "date": long_date(moment), "moment": when,
            "weather": weather_line(segment["session_id"], moment),
            "map": None, "locator": None,
            "hourStart": hour_start.hour * 3600 + hour_start.minute * 60 + hour_start.second,
            "clipStart": clip_start, "length": length,
            "spectrogram": {"src": "spectrogram.png", "start": spec_start, "width": columns, "pxPerSec": zoom,
                            "tickEvery": tick_every, "topKHz": TOP_HZ // 1000},
            "panels": [{k: v for k, v in p.items() if k != "plate_key"} for p in panels],
            "end": {"from": end_from, "eyebrow": " · ".join(x for x in (number, site["site_name"]) if x),
                    "span": fmt_span(first_start, last_end),
                    "stats": [[hours_text, f"of sound, {session_word}" if session_word == "dusk till dawn" else "of sound"],
                              [str(len(counted)), f"{what} identified"]],
                    "note": note, "support": site.get("support_name") or None},
        }

        chrome = Chrome(chrome_binary)  # before the server's thread starts (it forks)
        server, base = serve(work)

        # the maps, drawn once by the site's own map code
        if (MAPTILES / "soundscape-map.pmtiles").is_file():
            session_id = chrome.page(420, 300)
            query = (f"lat={site['latitude']}&lon={site['longitude']}&precision={site.get('public_location_precision', 'exact')}"
                     f"&country={site['country_code']}")
            chrome.open(session_id, f"{base}/social/map.html?{query}", timeout=90)
            (work / "map.png").write_bytes(chrome.screenshot(session_id, "png", {"x": 0, "y": 0, "width": 296, "height": 296}))
            (work / "locator.png").write_bytes(chrome.screenshot(session_id, "png", {"x": 320, "y": 0, "width": 92, "height": 92}))
            post["map"], post["locator"] = "map.png", "locator.png"
        else:
            print("  map files missing from .maptiles (scripts/build_map_tiles.py): the post has no map")
        (work / "post.json").write_text(json.dumps(post, ensure_ascii=False, indent=1))

        page = chrome.page(WIDTH, HEIGHT)
        chrome.open(page, f"{base}/social/post.html", timeout=60)
        first_species = shown[0]["from"] if shown else INTRO_SEC
        cover_at = min(first_species + 1.5, end_from - 0.5)

        if args.stills:
            for label, t in (("opening", min(1.5, first_species - 0.5) if shown else 1.5),
                             ("calling", cover_at), ("end", length - 0.5)):
                chrome.evaluate(page, f"window.frame({t:.3f})", wait=True)
                path = out_dir / f"{name}_{label}.png"
                path.write_bytes(chrome.screenshot(page, "png"))
                print(f"  wrote {path}")
            write_caption(out_dir, name, site, moment, kind, post["weather"], heard, panels, credits, link,
                          clip_groups, session_word)
            return 0

        integrated, peak = loudness(audio, clip_start, length)
        gain = 0.0 if math.isinf(integrated) else min(TARGET_LUFS - integrated, MAX_TRUE_PEAK - peak + LIMIT_DB)
        limited = gain - (MAX_TRUE_PEAK - peak)
        print(f"  sound: {integrated:.1f} LUFS, peak {peak:.1f} dBTP; {gain:+.1f} dB"
              f"{f' (peaks limited by up to {limited:.1f} dB)' if limited > 0.05 else ''}"
              f"{', short of ' + str(int(TARGET_LUFS)) + ' LUFS' if gain < TARGET_LUFS - integrated - 0.05 else ''}")
        encode_audio(audio, clip_start, length, gain, work / "clip.m4a")

        frames = int(round(length * FPS))
        video = out_dir / f"{name}.mp4"
        tmp_video = video.with_suffix(".part.mp4")
        encoder = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
             "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-", "-i", str(work / "clip.m4a"),
             "-map", "0:v", "-map", "1:a",
             "-vf", "scale=in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p",
             "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-r", str(FPS),
             "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
             "-c:a", "copy", "-shortest", "-movflags", "+faststart", str(tmp_video)],
            stdin=subprocess.PIPE)
        started = time.time()
        cover_frame = int(round(cover_at * FPS))
        try:
            for i in range(frames):
                chrome.evaluate(page, f"window.frame({i / FPS:.4f})", wait=True)
                jpeg = chrome.screenshot(page, "jpeg")
                encoder.stdin.write(jpeg)
                if i == cover_frame:
                    (out_dir / f"{name}_cover.jpg").write_bytes(jpeg)
                if i % FPS == 0 or i == frames - 1:
                    rate = (i + 1) / max(0.001, time.time() - started)
                    print(f"\r  frames {i + 1}/{frames} ({rate:.1f}/s)", end="", flush=True)
            encoder.stdin.close()
        except BrokenPipeError:
            pass
        print()
        if encoder.wait() != 0:
            raise Stop("ffmpeg could not encode the video")
        os.replace(tmp_video, video)
        print(f"  wrote {video} ({video.stat().st_size / 1e6:.1f} MB, {time.time() - started:.0f} s)")
        print(f"  wrote {out_dir / (name + '_cover.jpg')}")
        write_caption(out_dir, name, site, moment, kind, post["weather"], heard, panels, credits, link,
                      clip_groups, session_word)
        if chrome.errors:
            print("  page messages: " + "; ".join(chrome.errors))
        return 0
    finally:
        if server:
            server.shutdown()
        if chrome:
            chrome.close()
        shutil.rmtree(work, ignore_errors=True)


def site_id_quote(site_id: str) -> str:
    return urllib.request.quote(site_id, safe="")


def write_caption(out_dir: Path, name: str, site: dict, moment: datetime, kind: str, weather: str, heard: List[str],
                  panels: List[dict], credits: Dict[str, Dict[str, str]], link: str, groups: set, session_word: str) -> None:
    shown = [p for p in panels if p["kind"] == "species"]
    text = caption(site, moment, kind, weather, heard, shown, credits, link, frogs="Amphibia" in groups,
                   birds="Aves" in groups, session_word=session_word)
    path = out_dir / f"{name}_caption.txt"
    path.write_text(text)
    print(f"  wrote {path}")
    print(f"  link: {link}")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Stop as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
