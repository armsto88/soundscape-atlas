#!/usr/bin/env python3
"""Fetch hand-cut 1800s bird plates for the species the website shows.

The plates come from Fugleramme's "classic" set
(https://github.com/arnegiacomo/fugleramme), cut from public-domain plates by
Gould, the von Wright brothers, Audubon and others, and shared under
CC BY-SA 4.0. This script reads the species in the website's data.json, finds
each bird's plate by scientific name (through Fugleramme's BirdNET alias map),
saves a small WebP per species, and writes CREDITS.md with each plate's source.
Birds without a plate are listed, so they can be cut later. Plates cut for
this site in the same style (scripts/bird_plates.json, which records the scan
and how each was cut) are kept, never replaced by a download, and credited in
their own section. It also writes manifest.json, listing the bird and frog
images that exist, for the website.

    python3 scripts/fetch_bird_plates.py --data prototype/api/data.json --art prototype/art

Needs Pillow. Re-running fetches only what is missing (--force redoes all).
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

REPO = "arnegiacomo/fugleramme"
DEFAULT_REF = "a7848e0d9e673a06c4465ec304b7ee3e5147281e"  # pinned so credits stay accurate (24 Nov 2026: +6 Australian birds)
ART = "assets/artwork/classic"
OWN_PLATES = Path(__file__).with_name("bird_plates.json")  # plates cut for this site
USER_AGENT = "soundscape-atlas-art/1.0"
SOURCE_NAMES = {
    "gould": "John Gould and collaborators",
    "vonwright": "the von Wright brothers, Svenska Fåglar",
    "audubon": "John James Audubon, The Birds of America",
    "fuertes": "Louis Agassiz Fuertes",
    "dresser": "H. E. Dresser, A History of the Birds of Europe",
    "dekay": "James E. De Kay",
    "wilson": "Alexander Wilson, American Ornithology",
    "keulemans": "J. G. Keulemans",
    "gronvold": "Henrik Grønvold",
    "pretre": "Jean-Gabriel Prêtre",
}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def raw(ref: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{REPO}/{ref}/{path}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch Fugleramme bird plates for the website's species")
    parser.add_argument("--data", required=True, help="the website's data.json (with per-site species)")
    parser.add_argument("--art", required=True, help="art folder; plates go into <art>/birds")
    parser.add_argument("--ref", default=DEFAULT_REF, help="Fugleramme commit to take plates from")
    parser.add_argument("--max-size", type=int, default=480, help="longest side in pixels (default 480)")
    parser.add_argument("--force", action="store_true", help="fetch plates that already exist again")
    args = parser.parse_args()

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    birds = {}
    for site in data.get("sites", {}).values():
        for sp in site.get("species", []):
            if sp.get("scientific") and "amphibia" not in (sp.get("group") or "").lower():
                birds.setdefault(slug(sp["scientific"]), sp)
    if not birds:
        print("No species with scientific names in data.json; rebuild it with build_web_metadata.py first.", file=sys.stderr)
        return 1

    manifest = json.loads(get(raw(args.ref, f"{ART}/manifest.json")))
    aliases = json.loads(get(raw(args.ref, "assets/birdnet_aliases.json")))
    plates: dict[str, list[str]] = {}
    for path in sorted(manifest):
        stem = re.sub(r"-\d+$", "", Path(path).stem)
        plates.setdefault(stem, []).append(path)

    art = Path(args.art)
    out_dir = art / "birds"
    out_dir.mkdir(parents=True, exist_ok=True)
    own_plates = {k: v for k, v in json.loads(OWN_PLATES.read_text(encoding="utf-8")).items() if not k.startswith("_")} \
        if OWN_PLATES.exists() else {}
    found, own, missing = [], [], []
    for key, sp in sorted(birds.items()):
        entry = own_plates.get(sp["scientific"])
        if entry and (out_dir / f"{key}.webp").exists():
            # cut for this site (scripts/bird_plates.json): never replaced by a download
            own.append((key, sp, entry))
            print(f"{key + '.webp':40} {sp['name']} (cut for this site)")
            continue
        if entry:
            print(f"warning: {sp['name']} is in {OWN_PLATES.name} but {key}.webp is missing", file=sys.stderr)
        names = [key] + ([slug(aliases[sp["scientific"]])] if sp["scientific"] in aliases else [])
        path = next((plates[n][0] for n in names if n in plates), None)
        if not path:
            missing.append(sp)
            continue
        dest = out_dir / f"{key}.webp"
        if args.force or not dest.exists():
            image = Image.open(io.BytesIO(get(raw(args.ref, f"{ART}/{path}")))).convert("RGBA")
            image.thumbnail((args.max_size, args.max_size), Image.LANCZOS)
            image.save(dest, "WEBP", quality=86, method=6)
            time.sleep(0.3)
        meta = manifest[path]
        found.append((key, sp, meta))
        print(f"{dest.name:40} {sp['name']} ({meta.get('source')})")
    # every plate cut for this site is in the folder, shown yet or not, so credit them all
    credited = {key for key, _, _ in own}
    for scientific, entry in sorted(own_plates.items()):
        key = slug(scientific)
        if key not in credited and (out_dir / f"{key}.webp").exists():
            own.append((key, {"name": entry.get("name", scientific), "scientific": scientific}, entry))

    lines = [
        "# Bird plates",
        "",
        f"Hand-cut 1800s plates from [Fugleramme](https://github.com/{REPO}/tree/{args.ref}/{ART})",
        "(classic style), digitally restored and edited by its contributors and shared under",
        "[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Resized for this site.",
        "Each original plate is public domain or openly licensed; see Fugleramme's",
        f"[ATTRIBUTION.md](https://github.com/{REPO}/blob/{args.ref}/{ART}/ATTRIBUTION.md).",
        "",
        "| File | Species | Plate by | Original scan |",
        "|---|---|---|---|",
    ]
    rows = {}
    for key, sp, meta in found:
        source = SOURCE_NAMES.get(meta.get("source", ""), meta.get("source", ""))
        rows[f"{key}.webp"] = f"| {key}.webp | {sp['name']} (*{sp['scientific']}*) | {source} | [link]({meta.get('url', '')}) |"
    # a plate stays in the folder when its bird is no longer shown (a session held back or
    # unpublished): keep its earlier credit while the file is there
    own_files = {f"{key}.webp" for key, _, _ in own}
    if (out_dir / "CREDITS.md").exists():
        for line in (out_dir / "CREDITS.md").read_text(encoding="utf-8").split("## Cut for this site")[0].splitlines():
            match = re.match(r"\| ([a-z0-9-]+\.webp) \|", line)
            if match and match.group(1) not in rows and match.group(1) not in own_files and (out_dir / match.group(1)).exists():
                rows[match.group(1)] = line
    lines += [rows[name] for name in sorted(rows)]
    if own:
        lines += [
            "",
            "## Cut for this site",
            "",
            "Cut from public-domain scans in the same style, with Fugleramme's plate-review tools",
            "(`tools/platereview`), and shared under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).",
            "How each was cut is recorded in `scripts/bird_plates.json`.",
            "",
            "| File | Species | Plate | Original scan |",
            "|---|---|---|---|",
        ]
        for key, sp, entry in own:
            plate = entry.get("work") or SOURCE_NAMES.get(entry.get("source", ""), entry.get("source", ""))
            note = f" ({entry['scan_note']})" if entry.get("scan_note") else ""
            lines.append(f"| {key}.webp | {sp['name']} (*{sp['scientific']}*) | {plate} | [link]({entry.get('scan', '')}){note} |")
    if missing:
        lines += ["", "## Still without a plate", ""]
        lines += [f"- {sp['name']} (*{sp['scientific']}*)" for sp in sorted(missing, key=lambda s: s["name"])]
    (out_dir / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    index = {
        "birds": sorted(p.stem for p in out_dir.glob("*.webp")),
        "frogs": sorted(p.stem for p in (art / "frogs").glob("*.webp")),
    }
    (art / "manifest.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    print(f"{len(found)} plates from Fugleramme, {len(own)} cut for this site, {len(missing)} birds without one; {art / 'manifest.json'} lists {len(index['birds'])} birds, {len(index['frogs'])} frogs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
