#!/usr/bin/env python3
"""Fetch the weather during each recording session, for the website.

For every session in the website's data.json this asks Open-Meteo's historical
archive (ERA5 reanalysis, hourly, about 25 km grid) for temperature, rain,
cloud, wind and humidity over the session, and writes one small file per
session next to data.json:

    api/weather/<session_id>.json

The place's coordinates are rounded to 0.1 degree (about 10 km) before they
are sent, so exact locations never leave this machine; the grid is coarser
than that anyway. Answers are cached in .cache/weather/ (ignored by git), so
rebuilding the data asks again only for new sessions.

    python3 scripts/fetch_weather.py --data website/api/data.json
    python3 scripts/fetch_weather.py --data .preview/api/data.json

Weather data by Open-Meteo.com (https://open-meteo.com), CC BY 4.0; their free
API is for non-commercial use. The site credits it on the About page.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / ".cache" / "weather"
API = "https://archive-api.open-meteo.com/v1/archive"
FIELDS = ["temperature_2m", "precipitation", "cloud_cover", "wind_speed_10m", "relative_humidity_2m", "weather_code"]
USER_AGENT = "soundscape-atlas/1.0 (weather for recording sessions)"


def fetch(lat: float, lon: float, start: str, end: str, timezone: str) -> dict:
    key = f"{lat:.1f}_{lon:.1f}_{start}_{end}_{timezone.replace('/', '-')}"
    cached = CACHE / f"{key}.json"
    if cached.is_file():
        return json.loads(cached.read_text(encoding="utf-8"))
    query = urllib.parse.urlencode({
        "latitude": f"{lat:.1f}", "longitude": f"{lon:.1f}", "start_date": start, "end_date": end,
        "hourly": ",".join(FIELDS), "timezone": timezone,
    })
    request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.loads(response.read())
    if "hourly" not in data:
        raise RuntimeError(data.get("reason") or "no hourly data")
    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(0.5)  # be gentle with a free service
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the weather for each session in data.json")
    parser.add_argument("--data", required=True, help="the website's data.json")
    parser.add_argument("--out", help="output folder (default: weather/ next to data.json)")
    args = parser.parse_args()

    data_path = Path(args.data)
    data = json.loads(data_path.read_text(encoding="utf-8"))
    out = Path(args.out) if args.out else data_path.parent / "weather"
    out.mkdir(parents=True, exist_ok=True)
    sites = data.get("sites") or {}
    sessions = data.get("sessions") or {}
    segments = data.get("segments") or []
    segments = segments if isinstance(segments, list) else list(segments.values())
    site_of = {s["session_id"]: s["site_id"] for s in segments}

    written = failed = 0
    for session_id, meta in sorted(sessions.items()):
        site = sites.get(site_of.get(session_id, ""))
        if not site or not meta.get("start_local") or not meta.get("end_local"):
            continue
        start = datetime.fromisoformat(meta["start_local"])
        end = datetime.fromisoformat(meta["end_local"])
        timezone = meta.get("timezone") or "auto"
        lat, lon = round(float(site["latitude"]), 1), round(float(site["longitude"]), 1)
        try:
            raw = fetch(lat, lon, start.date().isoformat(), end.date().isoformat(), timezone)
        except Exception as exc:  # keep going: one failed session should not stop the rest
            print(f"  {session_id}: {exc}", file=sys.stderr)
            failed += 1
            continue
        hourly = raw["hourly"]
        lo, hi = start - timedelta(hours=1), end + timedelta(hours=1)
        hours = [
            [t] + [hourly[f][i] for f in FIELDS]
            for i, t in enumerate(hourly["time"])
            if lo <= datetime.fromisoformat(t) <= hi
        ]
        (out / f"{session_id}.json").write_text(json.dumps({
            "source": "Open-Meteo.com, ERA5 reanalysis", "licence": "CC BY 4.0",
            "grid": [lat, lon], "fields": ["time"] + FIELDS, "hours": hours,
        }, separators=(",", ":")), encoding="utf-8")
        written += 1
    print(f"weather for {written} session(s) in {out}" + (f", {failed} failed" if failed else ""))
    return 1 if failed and not written else 0


if __name__ == "__main__":
    sys.exit(main())
