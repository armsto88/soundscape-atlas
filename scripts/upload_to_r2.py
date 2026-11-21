#!/usr/bin/env python3
"""Upload published listening copies to Cloudflare R2 with rclone.

Only segments with published=true in metadata/segments.csv are uploaded. A
publicly served bucket makes every object reachable by anyone who guesses its
name, and segment IDs are easy to guess.

Object keys mirror listening_opus_path, e.g.
  audio/listening_opus/AU_NSW_IMBOTA/AU_NSW_IMBOTA_20240413_1715.opus

After uploading, the script lists what is actually in the bucket and sets
public_url in segments.csv for exactly those published segments; it clears
public_url for everything else. URLs you entered by hand that point somewhere
other than --public-base-url are left alone. Rebuild website/api/data.json
afterwards.

Objects for segments that are no longer published are listed as stale;
--prune deletes them (after confirmation). Nothing outside
audio/listening_opus/ in the bucket is ever touched.

One-time setup (credentials stay in rclone's config, never in this repo):
  sudo apt install rclone
  rclone config
    new remote, e.g. "r2"; Storage: s3; provider: Cloudflare;
    access key + secret from an R2 API token with Object Read & Write on the bucket;
    endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  The bucket needs public access (custom domain or r2.dev) and a CORS rule
  allowing GET from the website, because the player loads audio with
  crossorigin="anonymous".

Example:
  python3 scripts/upload_to_r2.py \\
      --archive-root /media/USER/archive/soundscape_atlas \\
      --remote r2:soundscape-audio \\
      --public-base-url https://audio.example.org --dry-run
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Dict, List, Set
from urllib.parse import quote

sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
from ingest_recordings import DEFAULT_METADATA_DIR, read_csv, write_csv_atomic  # noqa: E402

AUDIO_PREFIX = "audio/listening_opus/"
UPLOAD_HEADERS = [
    "Content-Type: audio/ogg",
    "Cache-Control: public, max-age=86400",
]
PREVIEW_LIMIT = 20


class UploadError(Exception):
    pass


def is_safe_key(key: str) -> bool:
    path = PurePosixPath(key)
    return (
        key.startswith(AUDIO_PREFIX)
        and key.endswith(".opus")
        and "\\" not in key
        and not path.is_absolute()
        and ".." not in path.parts
    )


def run_rclone(args: List[str], capture: bool = False) -> subprocess.CompletedProcess:
    sys.stdout.flush()  # keep our output in order with rclone's
    return subprocess.run(["rclone", *args], text=True, capture_output=capture)


def list_remote_audio(destination: str) -> Set[str]:
    """Keys under audio/listening_opus/ currently in the bucket."""
    result = run_rclone(["lsf", "-R", "--files-only", f"{destination}/{AUDIO_PREFIX.rstrip('/')}"], capture=True)
    if result.returncode != 0:
        if "directory not found" in result.stderr.lower():
            return set()
        raise UploadError(f"could not list {destination}: {result.stderr.strip()}")
    return {AUDIO_PREFIX + line.strip() for line in result.stdout.splitlines() if line.strip()}


def preview(title: str, items: List[str]) -> None:
    if not items:
        return
    print(f"{title} ({len(items)}):")
    for item in items[:PREVIEW_LIMIT]:
        print(f"  {item}")
    if len(items) > PREVIEW_LIMIT:
        print(f"  ... and {len(items) - PREVIEW_LIMIT} more")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Upload published listening copies to Cloudflare R2 with rclone.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("One-time setup", 1)[1] if "One-time setup" in __doc__ else None,
    )
    parser.add_argument("--archive-root", required=True, help="folder that contains audio/listening_opus/")
    parser.add_argument("--remote", default=os.environ.get("R2_REMOTE", ""),
                        help="rclone remote and bucket, e.g. r2:soundscape-audio (or set R2_REMOTE)")
    parser.add_argument("--public-base-url", default=os.environ.get("R2_PUBLIC_BASE_URL", ""),
                        help="public URL of the bucket, e.g. https://audio.example.org (or set R2_PUBLIC_BASE_URL)")
    parser.add_argument("--metadata-dir", default=str(DEFAULT_METADATA_DIR))
    parser.add_argument("--transfers", type=int, default=4, help="parallel uploads (default 4)")
    parser.add_argument("--prune", action="store_true", help="delete bucket objects for segments that are not published")
    parser.add_argument("--yes", action="store_true", help="do not ask before pruning")
    parser.add_argument("--dry-run", action="store_true", help="show what would happen; change nothing")
    args = parser.parse_args()

    archive_root = Path(args.archive_root).expanduser()
    segments_path = Path(args.metadata_dir).expanduser() / "segments.csv"

    remote_name, _, bucket = args.remote.partition(":")
    bucket = bucket.strip("/")
    if not remote_name or not bucket:
        print("--remote must look like REMOTE:BUCKET, e.g. r2:soundscape-audio", file=sys.stderr)
        return 2
    destination = f"{remote_name}:{bucket}"

    base_url = args.public_base_url.strip()
    if not base_url.startswith(("https://", "http://")):
        print("--public-base-url must be the bucket's public URL, e.g. https://audio.example.org", file=sys.stderr)
        return 2
    base_url = base_url.rstrip("/") + "/"

    if shutil.which("rclone") is None:
        print("rclone is not installed. Install it with: sudo apt install rclone", file=sys.stderr)
        return 2
    if not archive_root.is_dir():
        print(f"Archive root not found: {archive_root}", file=sys.stderr)
        return 2

    header, rows = read_csv(segments_path)

    published_keys: Dict[str, str] = {}  # segment_id -> key
    to_upload: List[str] = []
    missing_local: List[str] = []
    bad_paths: List[str] = []
    for row in rows:
        if str(row.get("published") or "").strip().lower() != "true":
            continue
        key = str(row.get("listening_opus_path") or "").strip()
        if not is_safe_key(key):
            bad_paths.append(f"{row.get('segment_id')}: {key!r}")
            continue
        published_keys[row["segment_id"]] = key
        if (archive_root / key).is_file():
            to_upload.append(key)
        else:
            missing_local.append(key)

    mode = "DRY RUN - nothing will change" if args.dry_run else "Uploading"
    print(f"{mode}: {len(to_upload)} published listening cop{'y' if len(to_upload) == 1 else 'ies'} "
          f"from {archive_root} to {destination}")
    preview("Published but not found locally", missing_local)
    preview("Published with an unusable listening_opus_path (skipped)", bad_paths)

    copy_failed = False
    with tempfile.TemporaryDirectory(prefix="r2_upload_") as tmp:
        if to_upload:
            upload_list = Path(tmp) / "upload.txt"
            upload_list.write_text("\n".join(to_upload) + "\n", encoding="utf-8")
            command = [
                "copy", str(archive_root), destination,
                "--files-from", str(upload_list),
                "--s3-no-check-bucket",
                "--transfers", str(max(1, args.transfers)),
                "--stats-one-line", "--stats", "30s", "-v",
            ]
            for value in UPLOAD_HEADERS:
                command += ["--header-upload", value]
            if args.dry_run:
                command.append("--dry-run")
            print()
            copy_failed = run_rclone(command).returncode != 0
            if copy_failed:
                print("\nrclone reported errors; public URLs are set only for files that are in the bucket.",
                      file=sys.stderr)

        try:
            in_bucket = list_remote_audio(destination)
        except UploadError as exc:
            print(exc, file=sys.stderr)
            return 1
        if args.dry_run:
            in_bucket |= set(to_upload)  # what the bucket would hold after a real run

        wanted = set(published_keys.values())
        stale = sorted(in_bucket - wanted)
        print()
        preview("In the bucket but not published (stale)", stale)

        if stale and args.prune:
            proceed = args.dry_run or args.yes
            if not proceed:
                answer = input(f"Delete these {len(stale)} object(s) from {destination}? [y/N] ")
                proceed = answer.strip().lower() in ("y", "yes")
            if proceed:
                prune_list = Path(tmp) / "prune.txt"
                prune_list.write_text("\n".join(stale) + "\n", encoding="utf-8")
                command = ["delete", destination, "--files-from", str(prune_list), "-v"]
                if args.dry_run:
                    command.append("--dry-run")
                if run_rclone(command).returncode != 0:
                    print("rclone could not delete every stale object; re-run to retry.", file=sys.stderr)
                elif not args.dry_run:
                    in_bucket -= set(stale)
            else:
                print("Prune cancelled.")
        elif stale:
            print("Run again with --prune to delete them.")

    # Point public_url at the bucket for exactly the published segments it holds.
    changed = 0
    left_alone: List[str] = []
    for row in rows:
        current = str(row.get("public_url") or "").strip()
        if current and not current.startswith(base_url):
            left_alone.append(row.get("segment_id", ""))
            continue
        key = published_keys.get(row.get("segment_id", ""))
        target = base_url + quote(key) if key and key in in_bucket else ""
        if current != target:
            row["public_url"] = target
            changed += 1

    available = sum(1 for key in published_keys.values() if key in in_bucket)
    unavailable = len(published_keys) - available
    print()
    print(f"{available} published segment(s) {'would be' if args.dry_run else 'are'} playable from R2"
          + (f"; {unavailable} not in the bucket" if unavailable else "") + ".")
    if left_alone:
        print(f"Left {len(left_alone)} hand-entered public_url value(s) pointing elsewhere unchanged.")

    if args.dry_run:
        print(f"public_url would change for {changed} segment(s) in {segments_path}.")
    elif changed:
        write_csv_atomic(segments_path, header, rows)
        print(f"Updated public_url for {changed} segment(s) in {segments_path}.")
        print("Next: python3 scripts/build_web_metadata.py")
    else:
        print("segments.csv already up to date.")

    return 1 if copy_failed or unavailable else 0


if __name__ == "__main__":
    sys.exit(main())
