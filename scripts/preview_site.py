#!/usr/bin/env python3
"""Preview the website locally on the real metadata, before anything is public.

Builds test data from the metadata folder into .preview/api (ignored by git) and
serves website/ with three folders laid over it:

    /api/...    from .preview/api, instead of website/api (the published data)
    /audio/...  from <archive-root>/audio, so hours play and spectrograms show
                (an hour's mastered public copy from publish_session.py first)
    /map/...    from .maptiles, the base map (scripts/build_map_tiles.py)

website/api is never written, so unpublished hours cannot end up in the public
repository. By default every processed hour is treated as published (every
segment whose Opus file exists); --published-only uses the real published
flags, which previews exactly what the public site will show once uploaded.
The metadata folder itself is never changed.

    python3 scripts/preview_site.py --archive-root /media/tom/archive/soundscape_atlas
    python3 scripts/preview_site.py --archive-root ... --published-only
    python3 scripts/preview_site.py --no-build            # serve the last build again

Then open http://127.0.0.1:8790/. Without the archive drive the site still
works, but nothing plays.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEBSITE = REPO / "website"
PREVIEW = REPO / ".preview"
AUDIO_PREFIX = "audio/"


def build(metadata_dir: Path, archive_root: Path | None, published_only: bool) -> None:
    have_audio = bool(archive_root and (archive_root / "audio").is_dir())
    if not have_audio:
        print("warning: the archive audio folder is not available; the preview will not play anything", file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(prefix="soundscape-preview-") as tmp:
        tmp_dir = Path(tmp)
        for name in metadata_dir.glob("*.csv"):
            shutil.copy(name, tmp_dir / name.name)
        segments_path = tmp_dir / "segments.csv"
        with segments_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            rows = list(reader)
            fieldnames = reader.fieldnames
        shown = 0
        for row in rows:
            relative = row.get("listening_opus_path") or ""
            # Without the drive, every hour with a listening copy counts as processed.
            processed = bool(relative) and (not have_audio or (archive_root / relative).is_file())
            if not published_only and processed:
                row["published"] = "true"
            if row.get("published", "").strip().lower() == "true" and processed and relative.startswith(AUDIO_PREFIX):
                row["public_url"] = relative  # served from /audio/ below
                shown += 1
        with segments_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{shown} hours in the preview", flush=True)

        api = PREVIEW / "api"
        if api.exists():
            shutil.rmtree(api)
        api.mkdir(parents=True)
        subprocess.run(
            [sys.executable, str(REPO / "scripts" / "build_web_metadata.py"), "--metadata-dir", str(tmp_dir), "--output", str(api / "data.json")],
            check=True,
        )
        # the weather for each session (cached in .cache/weather; without a network
        # the preview simply shows no weather for sessions not fetched before)
        result = subprocess.run([sys.executable, str(REPO / "scripts" / "fetch_weather.py"), "--data", str(api / "data.json")])
        if result.returncode != 0:
            print("warning: no weather for some sessions (see above)", file=sys.stderr, flush=True)


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    archive_audio: Path | None = None

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/api/"):
            return str(PREVIEW / "api" / os.path.normpath(clean[len("/api/"):]).lstrip("./"))
        if clean.startswith("/audio/") and self.archive_audio:
            relative = os.path.normpath(clean[len("/audio/"):]).lstrip("./")
            # The mastered public copy (publish_session.py) when there is one, as upload_to_r2.py sends.
            if relative.startswith("listening_opus/"):
                mastered = self.archive_audio / "public_opus" / relative[len("listening_opus/"):]
                if mastered.is_file():
                    return str(mastered)
            return str(self.archive_audio / relative)
        if clean.startswith("/map/"):
            return str(REPO / ".maptiles" / os.path.normpath(clean[len("/map/"):]).lstrip("./"))
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # Range requests, so hour-long files can be sought (http.server lacks them).
    def send_head(self):
        path = self.translate_path(self.path)
        if ".." in Path(path).parts:
            self.send_error(404)
            return None
        range_header = self.headers.get("Range")
        if not range_header or not os.path.isfile(path):
            return super().send_head()
        match = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
        size = os.path.getsize(path)
        if not match or (not match.group(1) and not match.group(2)):
            return super().send_head()
        if match.group(1):
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
        else:
            start, end = max(0, size - int(match.group(2))), size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        handle = open(path, "rb")
        handle.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return handle

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(1 << 16, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self._remaining = None

    def log_message(self, fmt, *args):
        if "/audio/" in self.path or "/map/" in self.path:
            return
        super().log_message(fmt, *args)


Handler.extensions_map.update({".opus": "audio/ogg", ".json": "application/json", ".js": "text/javascript", ".webp": "image/webp", ".mjs": "text/javascript", ".woff2": "font/woff2", ".pmtiles": "application/octet-stream"})


def main() -> int:
    parser = argparse.ArgumentParser(description="Preview the website locally on the real metadata")
    parser.add_argument("--metadata-dir", default=os.environ.get("SOUNDSCAPE_METADATA_DIR"), help="metadata folder (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--archive-root", help="archive folder that holds audio/listening_opus/")
    parser.add_argument("--published-only", action="store_true", help="keep the real published flags")
    parser.add_argument("--no-build", action="store_true", help="serve the last build without rebuilding")
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()

    archive_root = Path(args.archive_root).expanduser() if args.archive_root else None
    if not args.no_build:
        if not args.metadata_dir:
            print("Set SOUNDSCAPE_METADATA_DIR or pass --metadata-dir (or use --no-build)", file=sys.stderr)
            return 2
        build(Path(args.metadata_dir), archive_root, args.published_only)
    elif not (PREVIEW / "api" / "data.json").is_file():
        print("No earlier build in .preview/api; run without --no-build first", file=sys.stderr)
        return 2

    if archive_root and (archive_root / "audio").is_dir():
        Handler.archive_audio = (archive_root / "audio").resolve()
    handler = lambda *a, **k: Handler(*a, directory=str(WEBSITE), **k)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Preview at http://127.0.0.1:{args.port}/  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
