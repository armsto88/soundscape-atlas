#!/usr/bin/env python3
"""Draw the link-preview image (og:image) for the website: website/assets/social.png.

1200 x 630 px on the site's paper: the contour mark, the name, one line of text
and, optionally, the spectrogram strip of one hour with its place and time.
Only a published hour may be used, because the image is public; pass
--allow-unpublished to override that on purpose.

    python3 scripts/make_social_image.py
    python3 scripts/make_social_image.py --archive-root /media/tom/archive/soundscape_atlas \\
        --segment AU_NSW_BOOMERANG_FALLS_20240823_0600

The strip comes from the PNG beside the hour's Opus file (make_spectrograms.py).
The page is drawn by headless Chrome, which also fetches Fraunces and Inter from
Google Fonts while it renders; the finished PNG has no outside references.
"""

from __future__ import annotations

import argparse
import csv
import html
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MARK = REPO / "website" / "assets" / "mark.svg"
OUTPUT = REPO / "website" / "assets" / "social.png"
TAGLINE = "A listening archive of dusk-till-dawn field recordings."
WIDTH, HEIGHT = 1200, 630

PAGE = """<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=Inter:wght@400&display=swap">
<style>
  html, body {{ margin: 0; width: {w}px; height: {h}px; overflow: hidden; background: #fcfaf5; color: #2a2a26; }}
  body {{ display: grid; grid-template-rows: 1fr auto; font-family: Inter, system-ui, sans-serif; }}
  .top {{ padding: 0 80px 6px; display: flex; flex-direction: column; justify-content: center; gap: 26px; }}
  .brand {{ display: flex; align-items: center; gap: 28px; }}
  .brand img {{ width: 120px; height: 120px; }}
  .brand b {{ font-family: Fraunces, Georgia, serif; font-weight: 500; font-size: 88px; letter-spacing: -0.015em; line-height: 1; }}
  .tag {{ margin: 0; font-size: 32px; line-height: 1.35; color: #5c5a52; max-width: 820px; }}
  .strip {{ position: relative; height: 170px; border-top: 1px solid #e0d9cb; background: #fefdfa; }}
  .strip img {{ display: block; width: 100%; height: 100%; object-fit: cover; object-position: 0 40%; mix-blend-mode: multiply; }}
  .strip span {{ position: absolute; right: 22px; bottom: 14px; font-size: 18px; color: #5c5a52;
                 background: rgba(252, 250, 245, 0.88); padding: 3px 10px; border-radius: 6px; }}
</style></head>
<body>
  <div class="top">
    <div class="brand"><img src="mark.svg" alt=""><b>Soundscape Atlas</b></div>
    <p class="tag">{tagline}</p>
  </div>
  {strip}
</body></html>
"""


def find_chrome(given: str | None) -> str:
    for name in ([given] if given else []) + ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]:
        path = shutil.which(name) if name else None
        if path:
            return path
    sys.exit("Chrome or Chromium not found; pass --chrome PATH")


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def strip_for(segment_id: str, metadata_dir: Path, archive_root: Path, allow_unpublished: bool) -> tuple[Path, str]:
    segment = next((r for r in read_csv(metadata_dir / "segments.csv") if r["segment_id"] == segment_id), None)
    if segment is None:
        sys.exit(f"{segment_id} is not in {metadata_dir / 'segments.csv'}")
    if segment.get("published", "").strip().lower() != "true" and not allow_unpublished:
        sys.exit(f"{segment_id} is not published; the image is public. Pass --allow-unpublished to use it anyway.")
    opus = segment.get("listening_opus_path") or ""
    png = (archive_root / opus).with_suffix(".png") if opus else None
    if not png or not png.is_file():
        sys.exit(f"no spectrogram for {segment_id}; run make_spectrograms.py first")
    site = next((r for r in read_csv(metadata_dir / "sites.csv") if r["site_id"] == segment["site_id"]), {})
    start = datetime.fromisoformat(segment["segment_start_local"])
    caption = f"{site.get('site_name') or segment['site_id']} · {start.day} {start:%b %Y, %H:%M}"
    return png, caption


def main() -> int:
    parser = argparse.ArgumentParser(description="Draw website/assets/social.png")
    parser.add_argument("--segment", help="hour whose spectrogram strip runs along the bottom (optional)")
    parser.add_argument("--archive-root", help="archive folder that holds audio/listening_opus/ (needed with --segment)")
    parser.add_argument("--metadata-dir", default=os.environ.get("SOUNDSCAPE_METADATA_DIR"), help="metadata folder (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--allow-unpublished", action="store_true", help="use an hour that is not published")
    parser.add_argument("--output", default=str(OUTPUT), help=f"where to write the PNG (default {OUTPUT.relative_to(REPO)})")
    parser.add_argument("--chrome", help="Chrome or Chromium binary (default: found on PATH)")
    args = parser.parse_args()

    strip_html = ""
    with tempfile.TemporaryDirectory(prefix="soundscape-social-") as tmp:
        tmp_dir = Path(tmp)
        shutil.copy(MARK, tmp_dir / "mark.svg")
        if args.segment:
            if not args.archive_root:
                sys.exit("--segment needs --archive-root")
            metadata_dir = Path(args.metadata_dir) if args.metadata_dir else Path(args.archive_root) / "metadata"
            png, caption = strip_for(args.segment, metadata_dir, Path(args.archive_root), args.allow_unpublished)
            shutil.copy(png, tmp_dir / "strip.png")
            strip_html = f'<div class="strip"><img src="strip.png" alt=""><span>{html.escape(caption)}</span></div>'
        page = tmp_dir / "social.html"
        page.write_text(PAGE.format(w=WIDTH, h=HEIGHT, tagline=html.escape(TAGLINE), strip=strip_html), encoding="utf-8")
        shot = tmp_dir / "social.png"
        command = [find_chrome(args.chrome), "--headless=new", f"--user-data-dir={tmp_dir / 'profile'}", "--no-first-run",
                   "--hide-scrollbars", f"--window-size={WIDTH},{HEIGHT}", "--force-device-scale-factor=1",
                   "--virtual-time-budget=10000", f"--screenshot={shot}", page.as_uri()]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0 or not shot.is_file():
            sys.exit(f"Chrome did not write the image:\n{result.stderr.strip()}")
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(shot, args.output)
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
