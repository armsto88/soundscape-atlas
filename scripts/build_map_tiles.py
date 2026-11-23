#!/usr/bin/env python3
"""Build the website's map and relief: two PMTiles files cut for the areas
around our places.

- the map: OpenStreetMap data from Protomaps' daily world build
  (.maptiles/soundscape-map.pmtiles; © OpenStreetMap contributors, ODbL)
- the relief: Mapterhorn's terrain, zoom 0-12 (.maptiles/soundscape-terrain.pmtiles;
  each elevation source keeps its own licence, listed at mapterhorn.com/attribution)

Each is three layers, merged into one archive:

    zoom 0-6    the whole world, for the zoomed-out atlas (terrain: 0-5)
    zoom 7-10   wide areas, about 100 km around each region of places
    zoom 11-14  close-ups, about 30 km around each group of places (terrain: 11-12)

Above the top zoom the map enlarges the finest detail. Groups come from sites.csv:
places within 60 km of each other share a close-up, places within 300 km share
a wide area, so a new place is covered by re-running the script.

    python3 scripts/build_map_tiles.py --metadata-dir /media/tom/archive/soundscape_atlas/metadata --dry-run
    python3 scripts/build_map_tiles.py --metadata-dir /media/tom/archive/soundscape_atlas/metadata
    python3 scripts/build_map_tiles.py --metadata-dir ... --only terrain

Needs the pmtiles tool (github.com/protomaps/go-pmtiles) on PATH. .maptiles/ is
ignored by git; both files go to the R2 bucket under map/. The site credits
OpenStreetMap, Protomaps and Mapterhorn.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUTPUT = REPO / ".maptiles" / "soundscape-map.pmtiles"
TERRAIN_OUTPUT = REPO / ".maptiles" / "soundscape-terrain.pmtiles"
BUILDS = "https://build.protomaps.com/{}.pmtiles"
# Mapterhorn's terrain (terrarium-encoded WebP, 512 px), zoom 0-12. No licence of its
# own; each source keeps its own, and https://mapterhorn.com/attribution lists them.
TERRAIN = "https://download.mapterhorn.com/planet.pmtiles"

# (link distance between places, margin around the group, zoom range)
CLOSE = (60, 30, (11, 14))
WIDE = (300, 100, (7, 10))
WORLD_MAXZOOM = 6
# the terrain only needs to shade: less zoom for the world and the close-ups
TERRAIN_WORLD_MAXZOOM = 5
TERRAIN_CLOSE_MAXZOOM = 12


def km(a, b):
    """great-circle distance between two (lon, lat) points"""
    (lon1, lat1), (lon2, lat2) = [(math.radians(x), math.radians(y)) for x, y in (a, b)]
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def groups(points, link_km):
    """single-linkage groups: a point joins a group when it is within link_km of any member"""
    out = []
    for p in points:
        near = [g for g in out if any(km(p, q) <= link_km for q in g)]
        merged = [p] + [q for g in near for q in g]
        out = [g for g in out if g not in near] + [merged]
    return out


def boxes(points, link_km, margin_km):
    polys = []
    for g in groups(points, link_km):
        lat0 = sum(p[1] for p in g) / len(g)
        dlat = margin_km / 111.0
        dlon = margin_km / (111.0 * max(0.2, math.cos(math.radians(lat0))))
        w, e = min(p[0] for p in g) - dlon, max(p[0] for p in g) + dlon
        s, n = max(-85, min(p[1] for p in g) - dlat), min(85, max(p[1] for p in g) + dlat)
        polys.append(([[[w, s], [e, s], [e, n], [w, n], [w, s]]], len(g)))
    return polys


def latest_build() -> str:
    for back in range(0, 10):
        day = (date.today() - timedelta(days=back)).strftime("%Y%m%d")
        request = urllib.request.Request(BUILDS.format(day), method="HEAD")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status == 200:
                    return day
        except Exception:
            continue
    sys.exit("no Protomaps build found for the last 10 days; pass --build YYYYMMDD")


def run(args: list[str]) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"{' '.join(args[:2])} failed:\n{result.stderr.strip()}")
    return result.stderr + result.stdout


def build_archive(source: str, points, world_maxzoom: int, close_maxzoom: int, output: Path, dry_run: bool) -> None:
    """cut the world, wide and close-up levels from a remote archive and merge them into one file"""
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="map-parts-", dir=output.parent) as tmp:
        parts = []
        jobs = [("world", ["--bbox=-180,-85,180,85", "--minzoom=0", f"--maxzoom={world_maxzoom}"])]
        for name, (link, margin, (z0, z1)) in (("wide", WIDE), ("close", (CLOSE[0], CLOSE[1], (CLOSE[2][0], close_maxzoom)))):
            polys = boxes(points, link, margin)
            region = Path(tmp) / f"{name}.geojson"
            region.write_text(json.dumps({"type": "MultiPolygon", "coordinates": [p for p, _ in polys]}))
            print(f"  {name}: {len(polys)} area(s) of {', '.join(str(n) for _, n in polys)} place(s), zoom {z0}-{z1}")
            jobs.append((name, [f"--region={region}", f"--minzoom={z0}", f"--maxzoom={z1}"]))
        for name, extra in jobs:
            part = Path(tmp) / f"{name}.pmtiles"
            log = run(["pmtiles", "extract", source, str(part), *extra] + (["--dry-run"] if dry_run else []))
            size = next((line.split("archive size of ")[-1] for line in log.splitlines() if "archive size of" in line), "?")
            print(f"  {name}: {size}")
            parts.append(str(part))
        if dry_run:
            return
        run(["pmtiles", "merge", *parts, str(output)])
    run(["pmtiles", "verify", str(output)])
    print(f"wrote {output} ({output.stat().st_size / 1e6:.0f} MB), verified")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the website's map and terrain tiles")
    parser.add_argument("--metadata-dir", default=os.environ.get("SOUNDSCAPE_METADATA_DIR"), help="folder with sites.csv (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--only", choices=["map", "terrain"], help="build just one of the two files")
    parser.add_argument("--build", help="Protomaps build date YYYYMMDD (default: the latest)")
    parser.add_argument("--dry-run", action="store_true", help="only report the sizes")
    args = parser.parse_args()
    if not args.metadata_dir:
        sys.exit("pass --metadata-dir or set SOUNDSCAPE_METADATA_DIR")
    if not shutil.which("pmtiles"):
        sys.exit("the pmtiles tool is not on PATH (github.com/protomaps/go-pmtiles)")

    with open(Path(args.metadata_dir) / "sites.csv", newline="", encoding="utf-8") as handle:
        points = [(float(r["longitude"]), float(r["latitude"])) for r in csv.DictReader(handle) if r.get("latitude") and r.get("longitude")]
    if args.only != "terrain":
        build = args.build or latest_build()
        print(f"Map: {len(points)} places, Protomaps build {build}")
        build_archive(BUILDS.format(build), points, WORLD_MAXZOOM, CLOSE[2][1], OUTPUT, args.dry_run)
    if args.only != "map":
        print(f"Terrain: {len(points)} places, Mapterhorn")
        build_archive(TERRAIN, points, TERRAIN_WORLD_MAXZOOM, TERRAIN_CLOSE_MAXZOOM, TERRAIN_OUTPUT, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
