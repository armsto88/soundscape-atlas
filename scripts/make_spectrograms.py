#!/usr/bin/env python3
"""Draw one spectrogram image per hour, next to its Opus listening copy.

The website shows the image as the timeline background of an hour, so it is a
long, thin strip: 3600 px wide (one pixel per second), 0 to 12 kHz, dark marks
on a light background (greyscale PNG). It is made from the Opus copy, so it can
be run for any processed hour, before or after BirdNET.

    python3 scripts/make_spectrograms.py --archive-root /media/tom/archive/soundscape_atlas --dry-run
    python3 scripts/make_spectrograms.py --archive-root /media/tom/archive/soundscape_atlas --only AU_NSW_BOOMERANG_FALLS

Existing images are kept unless --force is given. About a minute of one CPU
core per hour; --jobs runs several hours at once. upload_to_r2.py does not yet
copy the images to the bucket.

Requires ffmpeg on PATH.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

LISTENING_DIR = Path("audio", "listening_opus")
DEFAULT_SIZE = "3600x200"
TOP_HZ = 12000


def ffmpeg_filter(size: str) -> str:
    return (
        "aformat=channel_layouts=mono,"
        f"showspectrumpic=s={size}:mode=combined:color=intensity:scale=log:fscale=lin:"
        f"stop={TOP_HZ}:legend=0:drange=80:limit=0,"
        "format=gray,negate"
    )


def render(opus: Path, png: Path, size: str) -> tuple[Path, float, str]:
    tmp = png.with_suffix(".png.tmp")
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        "-threads", "2", "-i", str(opus),
        "-lavfi", ffmpeg_filter(size),
        "-f", "image2", "-c:v", "png", str(tmp),
    ]
    started = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        if tmp.exists():
            tmp.unlink()
        return png, time.time() - started, result.stderr.strip() or f"ffmpeg exit {result.returncode}"
    os.replace(tmp, png)
    return png, time.time() - started, ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Spectrogram strips for the website")
    parser.add_argument("--archive-root", required=True, help="archive folder that holds audio/listening_opus/")
    parser.add_argument("--only", action="append", default=[], metavar="SITE_ID", help="limit to a site (repeatable)")
    parser.add_argument("--size", default=DEFAULT_SIZE, help=f"image size WxH (default {DEFAULT_SIZE})")
    parser.add_argument("--jobs", type=int, default=1, help="hours rendered at once (default 1)")
    parser.add_argument("--force", action="store_true", help="redo existing images")
    parser.add_argument("--dry-run", action="store_true", help="list what would be done")
    args = parser.parse_args()

    root = Path(args.archive_root) / LISTENING_DIR
    if not root.is_dir():
        print(f"error: {root} does not exist", file=sys.stderr)
        return 1

    todo = []
    skipped = 0
    for opus in sorted(root.glob("*/*.opus")):
        if args.only and opus.parent.name not in args.only:
            continue
        png = opus.with_suffix(".png")
        if png.exists() and not args.force:
            skipped += 1
            continue
        todo.append((opus, png))

    print(f"{len(todo)} hour(s) to render, {skipped} already done")
    if args.dry_run:
        for opus, png in todo:
            print(f"  {png.relative_to(args.archive_root)}")
        return 0

    errors = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for i, (png, seconds, error) in enumerate(pool.map(lambda pair: render(pair[0], pair[1], args.size), todo), 1):
            if error:
                errors += 1
                print(f"[{i}/{len(todo)}] FAILED {png.name}: {error}", file=sys.stderr)
            else:
                print(f"[{i}/{len(todo)}] {png.name} ({seconds:.0f} s)")
    print(f"done in {(time.time() - started) / 60:.1f} min, {errors} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
