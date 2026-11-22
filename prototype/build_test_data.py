#!/usr/bin/env python3
"""Build the prototype's data from the real metadata, for local trials.

By default every processed hour is treated as published (every segment whose
Opus file exists under the archive), with audio and spectrograms served from
this folder through a symlink. The metadata folder itself is never changed:
the CSVs are copied to a temporary folder first. With --published-only the real
published flags are used instead, which previews exactly what the public site
would show.

    python3 prototype/build_test_data.py --archive-root /media/tom/archive/soundscape_atlas
    python3 prototype/serve.py
"""

import argparse
import csv
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
AUDIO_PREFIX = "audio/"


def main():
    parser = argparse.ArgumentParser(description="Build the prototype's test data")
    parser.add_argument("--metadata-dir", default=os.environ.get("SOUNDSCAPE_METADATA_DIR"), help="metadata folder (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--archive-root", required=True, help="archive folder that holds audio/listening_opus/")
    parser.add_argument("--published-only", action="store_true", help="keep the real published flags instead of publishing every processed hour")
    args = parser.parse_args()

    if not args.metadata_dir:
        sys.exit("Set SOUNDSCAPE_METADATA_DIR or pass --metadata-dir")
    metadata_dir = Path(args.metadata_dir)
    archive_root = Path(args.archive_root)
    if not (archive_root / "audio").is_dir():
        sys.exit(f"{archive_root}/audio does not exist")

    with tempfile.TemporaryDirectory(prefix="soundscape-proto-") as tmp:
        tmp_dir = Path(tmp)
        for name in metadata_dir.glob("*.csv"):
            shutil.copy(name, tmp_dir / name.name)
        segments_path = tmp_dir / "segments.csv"
        with segments_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            rows = list(reader)
            fieldnames = reader.fieldnames
        published = 0
        for row in rows:
            relative = row.get("listening_opus_path") or ""
            exists = relative and (archive_root / relative).is_file()
            if not args.published_only and exists:
                row["published"] = "true"
            if row.get("published", "").strip().lower() == "true" and exists and relative.startswith(AUDIO_PREFIX):
                row["public_url"] = relative  # served from prototype/audio -> <archive>/audio
                published += 1
        with segments_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{published} hours with audio marked as published for the prototype")

        api_dir = HERE / "api"
        api_dir.mkdir(exist_ok=True)
        subprocess.run(
            [sys.executable, str(REPO / "scripts" / "build_web_metadata.py"), "--metadata-dir", str(tmp_dir), "--output", str(api_dir / "data.json")],
            check=True,
        )

    link = HERE / "audio"
    target = archive_root / "audio"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(target, target_is_directory=True)
    print(f"audio -> {target}")
    print("Now run: python3 prototype/serve.py")


if __name__ == "__main__":
    main()
