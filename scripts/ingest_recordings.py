#!/usr/bin/env python3
"""Ingest field recordings into the Soundscape Atlas archive.

Two steps, with a human check in between:

  scan     Probe raw WAV files (BWF timestamps via ffprobe), rejoin files the
           recorder split mid-recording (e.g. at the 4 GB WAV limit), and write
           one row per continuous recording to a manifest CSV.

  process  For every manifest row that has a site_id, cut clock-aligned hourly
           segments (05:30 start -> 05:30-06:00, 06:00-07:00, ...), write 48 kHz
           working WAVs and Opus listening copies, and append rows to
           sessions.csv and segments.csv in the metadata folder.

Recordings are identified by the BWF originator reference stored inside each
file, not by their path. After moving or renaming files, re-run `scan`: paths
in the manifest are updated and everything you filled in is kept.

Keep the manifest out of the (public) repository: folder names and paths can
reveal private locations.

Example:
  python3 scripts/ingest_recordings.py scan \\
      --raw-dir /media/USER/archive/Recordings/RAW \\
      --manifest /media/USER/archive/soundscape_atlas/ingest_manifest.csv \\
      --timezone Australia/Sydney

  # Edit the manifest: fill site_id (sites must exist in sites.csv),
  # check timezone, channels and clock_offset_minutes.

  python3 scripts/ingest_recordings.py process \\
      --manifest /media/USER/archive/soundscape_atlas/ingest_manifest.csv \\
      --archive-root /media/USER/archive/soundscape_atlas \\
      --operator "Your Name" --dry-run

Requires Python 3.9+ and ffmpeg/ffprobe (with libopus) on PATH.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from datetime import time as dtime
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SCRIPT_DIR = Path(__file__).resolve().parent
# The master metadata lives on the archive drive, never in this public repo.
METADATA_DIR_ENV = "SOUNDSCAPE_METADATA_DIR"


def default_metadata_dir() -> str:
    return os.environ.get(METADATA_DIR_ENV, "").strip()


def require_metadata_dir(value: str) -> Path:
    """The metadata folder to use, or exit with an explanation."""
    if not value:
        print(
            f"Set {METADATA_DIR_ENV} (or pass --metadata-dir) to the metadata folder on the archive drive.\n"
            "The repository only holds empty templates in metadata_template/.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    path = Path(value).expanduser()
    if not (path / "segments.csv").exists():
        print(f"No segments.csv in {path}. To start, copy the files from metadata_template/ there.", file=sys.stderr)
        raise SystemExit(2)
    return path

# Columns you edit by hand. `scan` never overwrites them once a row exists.
USER_COLUMNS = [
    "site_id",
    "timezone",
    "clock_offset_minutes",
    "channels",
    "microphones",
    "notes",
]
# Columns `scan` refreshes from the files on every run.
DETECTED_COLUMNS = [
    "recorder_start_local",
    "recorder_end_local",
    "duration_hours",
    "file_count",
    "sample_rate_hz",
    "bit_depth",
    "source_channels",
    "recorder",
    "timing",
    "folder",
    "files",
]
MANIFEST_COLUMNS = ["source_key", *USER_COLUMNS, *DETECTED_COLUMNS, "status"]

FILE_SEPARATOR = "|"
PROJECT_NAME_RE = re.compile(r"^(?P<site>.+)_(?P<date>\d{8})_(?P<hm>\d{4})$")
SKIP_DIR_NAMES = {"$RECYCLE.BIN", "System Volume Information", "lost+found"}
WAV_CODECS = {"pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le"}

# How far apart (seconds) the end of one file and the start of the next may be
# for them to count as one continuous recording, by timestamp precision.
JOIN_TOLERANCE = {"bwf": 0.5, "bwf-coarse": 5.0, "filename": 90.0}


class IngestError(Exception):
    pass


# --------------------------------------------------------------------------
# Probing raw files
# --------------------------------------------------------------------------


@dataclass
class RawFile:
    path: Path
    start: datetime  # recorder clock, local time of the first sample
    samples: int
    sample_rate: int
    channels: int
    codec: str
    bit_depth: int
    recorder: str  # display name, serial number removed
    recorder_id: str  # used only to decide which files may be joined
    key: str  # stable identity that survives moves/renames
    timing: str  # "bwf" | "bwf-coarse" | "filename"
    site_hint: str = ""  # site id parsed from a project-style filename

    @property
    def duration(self) -> float:
        return self.samples / self.sample_rate

    @property
    def end(self) -> datetime:
        return self.start + timedelta(seconds=self.duration)


def run_ffprobe(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", "-select_streams", "a:0", str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        message = result.stderr.strip().replace(f"{path}: ", "")
        raise IngestError(message or "ffprobe failed")
    return json.loads(result.stdout or "{}")


def parse_bwf_date(value: str) -> Optional[date]:
    match = re.search(r"(\d{4})\D(\d{1,2})\D(\d{1,2})", value or "")
    if not match:
        return None
    try:
        return date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def parse_bwf_time(value: str) -> Optional[dtime]:
    match = re.search(r"(\d{1,2})\D(\d{2})\D(\d{2})", value or "")
    if not match:
        return None
    try:
        return dtime(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def bwf_start(tags: Dict[str, str], sample_rate: int) -> Tuple[Optional[datetime], str]:
    """Start time of the first sample from BWF metadata.

    The origination date/time is only second-precise and on some recorders is
    written a few seconds after recording starts. time_reference (samples since
    midnight) is sample-accurate when the recorder runs time-of-day timecode, so
    it is preferred whenever it agrees with the origination time.
    """
    day = parse_bwf_date(tags.get("date", ""))
    clock = parse_bwf_time(tags.get("creation_time", ""))
    if day is None or clock is None:
        return None, ""
    origin = datetime.combine(day, clock)

    try:
        reference = int(tags.get("time_reference", ""))
    except ValueError:
        reference = -1
    if reference > 0 and sample_rate > 0:
        since_midnight = timedelta(seconds=reference / sample_rate)
        # The timecode may belong to the day before/after the origination date
        # when a recording starts near midnight.
        candidates = [
            datetime.combine(day + timedelta(days=shift), dtime()) + since_midnight
            for shift in (-1, 0, 1)
        ]
        best = min(candidates, key=lambda candidate: abs(candidate - origin))
        if abs(best - origin) <= timedelta(hours=1):
            return best, "bwf"
    return origin, "bwf-coarse"


def clean_recorder_name(encoded_by: str) -> str:
    name = re.sub(r"^SoundDev:\s*", "Sound Devices ", (encoded_by or "").strip())
    tokens = name.split()
    # Drop a trailing serial number such as "TH07211392".
    if len(tokens) > 1 and re.fullmatch(r"[A-Z]{0,4}\d{5,}", tokens[-1]):
        tokens = tokens[:-1]
    return " ".join(tokens)


def probe_file(path: Path) -> RawFile:
    info = run_ffprobe(path)
    streams = info.get("streams") or []
    if not streams:
        raise IngestError("no audio stream")
    stream = streams[0]
    fmt = info.get("format") or {}
    tags = {str(k).lower(): str(v) for k, v in (fmt.get("tags") or {}).items()}

    sample_rate = int(stream.get("sample_rate") or 0)
    if sample_rate <= 0:
        raise IngestError("unknown sample rate")
    if stream.get("time_base") == f"1/{sample_rate}" and stream.get("duration_ts"):
        samples = int(stream["duration_ts"])
    else:
        samples = round(float(stream.get("duration") or fmt.get("duration") or 0) * sample_rate)
    if samples <= 0:
        raise IngestError("empty or unreadable audio")

    start, timing = bwf_start(tags, sample_rate)
    site_hint = ""
    name_match = PROJECT_NAME_RE.match(path.stem)
    if name_match:
        site_hint = name_match["site"]
        if start is None:
            start = datetime.strptime(name_match["date"] + name_match["hm"], "%Y%m%d%H%M")
            timing = "filename"
    if start is None:
        raise IngestError(
            "no BWF timestamp, and the filename does not follow SITEID_YYYYMMDD_HHMM"
        )

    encoded_by = tags.get("encoded_by", "")
    reference = tags.get("originator_reference", "").strip()
    return RawFile(
        path=path,
        start=start,
        samples=samples,
        sample_rate=sample_rate,
        channels=int(stream.get("channels") or 0),
        codec=str(stream.get("codec_name") or ""),
        bit_depth=int(stream.get("bits_per_raw_sample") or stream.get("bits_per_sample") or 0),
        recorder=clean_recorder_name(encoded_by),
        recorder_id=encoded_by.strip() or f"folder:{path.parent}",
        key=reference or f"{path.name}@{start:%Y%m%dT%H%M%S}",
        timing=timing,
        site_hint=site_hint,
    )


def join_tolerance(a: RawFile, b: RawFile) -> float:
    return max(JOIN_TOLERANCE[a.timing], JOIN_TOLERANCE[b.timing])


def continues(previous: RawFile, following: RawFile) -> bool:
    if (
        previous.recorder_id != following.recorder_id
        or previous.sample_rate != following.sample_rate
        or previous.channels != following.channels
        or previous.codec != following.codec
    ):
        return False
    gap = (following.start - previous.end).total_seconds()
    return abs(gap) <= join_tolerance(previous, following)


def group_sessions(files: Sequence[RawFile]) -> List[List[RawFile]]:
    sessions: List[List[RawFile]] = []
    for item in sorted(files, key=lambda f: (f.recorder_id, f.start)):
        if sessions and continues(sessions[-1][-1], item):
            sessions[-1].append(item)
        else:
            sessions.append([item])
    sessions.sort(key=lambda group: group[0].start)
    return sessions


def find_wavs(raw_dir: Path) -> List[Path]:
    found = []
    for root, dirs, names in os.walk(raw_dir):
        dirs[:] = sorted(
            d for d in dirs if not d.startswith(".") and d not in SKIP_DIR_NAMES
        )
        for name in sorted(names):
            # "._name" files are macOS metadata stubs, not audio.
            if name.lower().endswith(".wav") and not name.startswith("._"):
                found.append(Path(root) / name)
    return found


# --------------------------------------------------------------------------
# CSV helpers
# --------------------------------------------------------------------------


def read_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def detect_line_ending(path: Path) -> str:
    """Keep a file's existing line endings so git diffs show only real changes."""
    try:
        with path.open("rb") as handle:
            return "\r\n" if b"\r\n" in handle.read(65536) else "\n"
    except FileNotFoundError:
        return "\n"


def write_csv_atomic(path: Path, header: Sequence[str], rows: Sequence[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line_ending = detect_line_ending(path)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(header), extrasaction="ignore", lineterminator=line_ending)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp, path)


def split_files(cell: str) -> List[Path]:
    return [Path(part) for part in (cell or "").split(FILE_SEPARATOR) if part]


# --------------------------------------------------------------------------
# scan
# --------------------------------------------------------------------------


def describe_session(group: List[RawFile], raw_dir: Path) -> Dict[str, str]:
    first, last = group[0], group[-1]
    total = sum(f.samples for f in group) / first.sample_rate
    folders = []
    for f in group:
        try:
            folder = str(f.path.parent.relative_to(raw_dir))
        except ValueError:
            folder = str(f.path.parent)
        if folder not in folders:
            folders.append(folder)
    return {
        "source_key": first.key,
        "recorder_start_local": first.start.isoformat(timespec="seconds"),
        "recorder_end_local": (first.start + timedelta(seconds=total)).isoformat(timespec="seconds"),
        "duration_hours": f"{total / 3600:.2f}",
        "file_count": str(len(group)),
        "sample_rate_hz": str(first.sample_rate),
        "bit_depth": str(first.bit_depth or ""),
        "source_channels": str(first.channels),
        "recorder": first.recorder,
        "timing": first.timing if all(f.timing == first.timing for f in group) else "mixed",
        "folder": " + ".join(folders),
        "files": FILE_SEPARATOR.join(str(f.path) for f in group),
    }


def cmd_scan(args: argparse.Namespace) -> int:
    raw_dir = Path(args.raw_dir).expanduser().resolve()
    manifest_path = Path(args.manifest).expanduser()
    if not raw_dir.is_dir():
        print(f"Raw directory not found: {raw_dir}", file=sys.stderr)
        return 2
    if args.timezone:
        try:
            ZoneInfo(args.timezone)
        except ZoneInfoNotFoundError:
            print(f"Unknown timezone: {args.timezone}", file=sys.stderr)
            return 2

    paths = find_wavs(raw_dir)
    print(f"Probing {len(paths)} WAV file(s) under {raw_dir} ...")
    probed: List[RawFile] = []
    failures: List[Tuple[Path, str]] = []
    for path in paths:
        try:
            probed.append(probe_file(path))
        except (IngestError, ValueError, json.JSONDecodeError) as exc:
            failures.append((path, str(exc)))

    sessions = group_sessions(probed)

    existing_rows: List[Dict[str, str]] = []
    if manifest_path.exists():
        _, existing_rows = read_csv(manifest_path)
    by_key = {row.get("source_key", ""): row for row in existing_rows}

    seen_keys = set()
    scanned_rows: List[Dict[str, str]] = []
    new_count = moved_count = 0
    for group in sessions:
        detected = describe_session(group, raw_dir)
        key = detected["source_key"]
        if key in seen_keys:
            # Two recordings share a BWF reference (a recorder that does not
            # make them unique): tell them apart by start time instead of
            # letting the second overwrite the first.
            key = f"{key}@{group[0].start:%Y%m%dT%H%M%S}"
            detected["source_key"] = key
            print(f"warning: {group[0].path.name} repeats another recording's BWF reference; keyed as {key}")
        seen_keys.add(key)
        row = by_key.get(key)
        if row is None:
            row = {column: "" for column in MANIFEST_COLUMNS}
            row["timezone"] = args.timezone or ""
            row["clock_offset_minutes"] = "0"
            row["channels"] = "1,2" if group[0].channels >= 2 else "1"
            row["site_id"] = group[0].site_hint
            row["status"] = "new"
            existing_rows.append(row)
            by_key[key] = row
            new_count += 1
        elif row.get("files") and row["files"] != detected["files"]:
            moved_count += 1
            if row.get("status", "").startswith("not found"):
                row["status"] = "found again"
        row.update(detected)
        scanned_rows.append(row)

    # Rows whose files lived under this raw dir but were not seen this time.
    missing_count = 0
    for row in existing_rows:
        if row.get("source_key") in seen_keys:
            continue
        files = split_files(row.get("files", ""))
        if files and all(str(f).startswith(str(raw_dir)) for f in files):
            if not all(f.exists() for f in files):
                row["status"] = "not found in last scan"
                missing_count += 1

    existing_rows.sort(key=lambda row: row.get("recorder_start_local", ""))
    write_csv_atomic(manifest_path, MANIFEST_COLUMNS, existing_rows)

    print()
    print(f"{'start (recorder clock)':<21} {'hours':>6} {'files':>5} {'ch':>3}  {'timing':<10} {'site_id':<18} folder")
    for row in scanned_rows:
        print(
            f"{row['recorder_start_local']:<21} {row['duration_hours']:>6} {row['file_count']:>5} "
            f"{row['source_channels']:>3}  {row['timing']:<10} {row['site_id'] or '-':<18} {row['folder']}"
        )
    total_hours = sum(float(row["duration_hours"]) for row in scanned_rows)
    print()
    print(
        f"{len(probed)} file(s) -> {len(sessions)} recording(s), {total_hours:.1f} h total. "
        f"{new_count} new, {moved_count} with updated paths, {missing_count} missing."
    )
    for path, reason in failures:
        print(f"  skipped {path}: {reason}")
    print(f"Manifest: {manifest_path}")
    print("Next: fill site_id (and check timezone / channels / clock_offset_minutes), then run `process`.")
    return 0


# --------------------------------------------------------------------------
# process
# --------------------------------------------------------------------------


@dataclass
class Segment:
    segment_id: str
    start: datetime
    end: datetime
    offset: float  # seconds into the joined recording
    length: float


def plan_segments(site_id: str, start: datetime, duration: float, min_seconds: float) -> Tuple[List[Segment], int]:
    """Clock-aligned hourly segments; returns (segments, number too short to keep)."""
    end = start + timedelta(seconds=duration)
    segments: List[Segment] = []
    too_short = 0
    cursor = start
    while cursor < end:
        next_hour = cursor.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        segment_end = min(next_hour, end)
        length = (segment_end - cursor).total_seconds()
        if length >= min_seconds:
            segments.append(
                Segment(
                    segment_id=f"{site_id}_{cursor:%Y%m%d_%H%M}",
                    start=cursor,
                    end=segment_end,
                    offset=(cursor - start).total_seconds(),
                    length=length,
                )
            )
        else:
            too_short += 1
        cursor = segment_end
    return segments, too_short


def season_for(month: int, latitude: Optional[float]) -> str:
    northern = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
                6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn", 11: "autumn"}
    opposite = {"winter": "summer", "summer": "winter", "spring": "autumn", "autumn": "spring"}
    if latitude is None:
        return ""
    season = northern[month]
    return opposite[season] if latitude < 0 else season


def parse_channels(spec: str, source_channels: int) -> List[int]:
    try:
        picked = [int(part) for part in (spec or "").replace(" ", "").split(",") if part]
    except ValueError:
        raise IngestError(f"channels must look like '1,2' or '3', got {spec!r}")
    if not 1 <= len(picked) <= 2 or any(not 1 <= c <= source_channels for c in picked):
        raise IngestError(f"channels {spec!r} is not valid for a {source_channels}-channel recording")
    return picked


def pan_filter(channels: List[int]) -> str:
    left = channels[0] - 1
    right = channels[-1] - 1  # a single channel is duplicated to both sides
    return f"pan=stereo|c0=c{left}|c1=c{right}"


def concat_list(files: Sequence[RawFile], directory: Path) -> Path:
    list_path = directory / "inputs.txt"
    lines = []
    for f in files:
        escaped = str(f.path).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    list_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return list_path


def encode_segment(
    files: Sequence[RawFile],
    list_path: Optional[Path],
    segment: Segment,
    channels: List[int],
    working_path: Optional[Path],
    opus_path: Path,
    opus_bitrate: str,
) -> None:
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        "-ss", f"{segment.offset:.6f}", "-t", f"{segment.length:.6f}",
    ]
    if list_path is not None:
        cmd += ["-f", "concat", "-safe", "0", "-i", str(list_path)]
    else:
        cmd += ["-i", str(files[0].path)]

    graph = f"[0:a]{pan_filter(channels)},aresample=48000"
    graph += ",asplit=2[w][o]" if working_path else "[o]"
    cmd += ["-filter_complex", graph]

    parts: List[Tuple[Path, Path]] = []
    if working_path:
        codec = files[0].codec if files[0].codec in WAV_CODECS else "pcm_s24le"
        working_tmp = working_path.with_name(working_path.name + ".part")
        cmd += ["-map", "[w]", "-map_metadata", "-1", "-c:a", codec, "-f", "wav", str(working_tmp)]
        parts.append((working_tmp, working_path))
    opus_tmp = opus_path.with_name(opus_path.name + ".part")
    cmd += [
        "-map", "[o]", "-map_metadata", "-1",
        # Constrained VBR: unconstrained VBR overshoots ~50% on broadband
        # ambience (water, wind), giving ~88 MB/h instead of ~58 MB/h at 128k.
        "-c:a", "libopus", "-b:a", opus_bitrate, "-vbr", "constrained", "-application", "audio",
        "-metadata", f"title={segment.segment_id}",
        "-f", "opus", str(opus_tmp),
    ]
    parts.append((opus_tmp, opus_path))

    for _, final in parts:
        final.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise IngestError(result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "ffmpeg failed")
        for tmp, final in parts:
            os.replace(tmp, final)
    finally:
        for tmp, _ in parts:
            if tmp.exists():
                tmp.unlink()


def load_session_files(row: Dict[str, str]) -> List[RawFile]:
    paths = split_files(row.get("files", ""))
    if not paths:
        raise IngestError("no files listed")
    missing = [p for p in paths if not p.exists()]
    if missing:
        raise IngestError(f"file not found: {missing[0]} (moved? re-run scan)")
    files = [probe_file(p) for p in paths]
    for previous, following in zip(files, files[1:]):
        if not continues(previous, following):
            raise IngestError(f"{following.path.name} does not continue {previous.path.name}; re-run scan")
    return files


def cmd_process(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest).expanduser()
    metadata_dir = require_metadata_dir(args.metadata_dir)
    archive_root = Path(args.archive_root).expanduser()
    if not manifest_path.exists():
        print(f"Manifest not found: {manifest_path} (run scan first)", file=sys.stderr)
        return 2
    for name in ("sites.csv", "sessions.csv", "segments.csv"):
        if not (metadata_dir / name).exists():
            print(f"Missing {metadata_dir / name}", file=sys.stderr)
            return 2

    manifest_header, manifest_rows = read_csv(manifest_path)
    _, site_rows = read_csv(metadata_dir / "sites.csv")
    sessions_header, session_rows = read_csv(metadata_dir / "sessions.csv")
    segments_header, segment_rows = read_csv(metadata_dir / "segments.csv")

    sites = {row["site_id"].strip(): row for row in site_rows if row.get("site_id")}
    sessions_by_id = {row["session_id"]: row for row in session_rows}
    segment_owner = {row["segment_id"]: row["session_id"] for row in segment_rows}

    selected = [row for row in manifest_rows if row.get("site_id", "").strip()]
    if args.only:
        selected = [
            row for row in selected
            if args.only in (row.get("source_key"), row.get("site_id", "").strip())
        ]
    if not selected:
        print("No manifest rows with a site_id to process.")
        return 0

    mode = "DRY RUN - nothing will be written" if args.dry_run else "Processing"
    print(f"{mode}: {len(selected)} recording(s)\n")

    totals = {"written": 0, "existing": 0, "short": 0, "conflicts": 0, "errors": 0}
    started = time.monotonic()
    metadata_changed = False

    for row in selected:
        site_id = row["site_id"].strip()
        label = f"{site_id} / {row.get('folder', '')} ({row.get('recorder_start_local', '')})"
        try:
            site = sites.get(site_id)
            if site is None:
                raise IngestError(f"site_id {site_id} is not in sites.csv; add the site first")
            timezone = row.get("timezone", "").strip()
            if not timezone:
                raise IngestError("timezone is blank")
            try:
                ZoneInfo(timezone)
            except ZoneInfoNotFoundError:
                raise IngestError(f"unknown timezone {timezone!r}")
            try:
                offset_minutes = float(row.get("clock_offset_minutes") or 0)
            except ValueError:
                raise IngestError("clock_offset_minutes must be a number")

            files = load_session_files(row)
            channels = parse_channels(row.get("channels", ""), files[0].channels)
            start = files[0].start + timedelta(minutes=offset_minutes)
            duration = sum(f.samples for f in files) / files[0].sample_rate
            session_id = f"{site_id}_{start:%Y%m%d_%H%M}"
            raw_names = ";".join(f.path.name for f in files)

            # Same session id with a different start/end means a different
            # recording (e.g. a second recorder at the same site). Matching
            # times with different filenames is just a renamed raw file.
            existing_session = sessions_by_id.get(session_id)
            start_text = start.isoformat(timespec="seconds")
            end_text = (start + timedelta(seconds=duration)).isoformat(timespec="seconds")
            if existing_session and (
                existing_session.get("start_datetime_local") != start_text
                or existing_session.get("end_datetime_local") != end_text
            ):
                raise IngestError(
                    f"session {session_id} already exists for a different recording "
                    f"({existing_session.get('raw_file_name')}, "
                    f"{existing_session.get('start_datetime_local')} to {existing_session.get('end_datetime_local')}); "
                    "use a separate site_id per recorder position"
                )

            segments, too_short = plan_segments(site_id, start, duration, args.min_segment_seconds)
            totals["short"] += too_short
            try:
                latitude: Optional[float] = float(site.get("latitude", ""))
            except ValueError:
                latitude = None
        except IngestError as exc:
            totals["errors"] += 1
            print(f"x {label}\n    {exc}\n")
            if not args.dry_run:
                row["status"] = f"error: {exc}"
                write_csv_atomic(manifest_path, manifest_header or MANIFEST_COLUMNS, manifest_rows)
            continue

        print(f"> {session_id}  {duration / 3600:.2f} h, {len(files)} file(s), "
              f"{len(segments)} segment(s){f', {too_short} too short' if too_short else ''}  [{label}]")

        new_segment_rows: List[Dict[str, str]] = []
        written = conflicts = 0
        list_dir = tempfile.TemporaryDirectory(prefix="ingest_")
        try:
            list_path = concat_list(files, Path(list_dir.name)) if len(files) > 1 else None
            for index, segment in enumerate(segments, start=1):
                owner = segment_owner.get(segment.segment_id)
                if owner and owner != session_id:
                    conflicts += 1
                    print(f"    ! {segment.segment_id} already belongs to {owner}; skipped "
                          "(overlapping recordings at one site need separate site_ids)")
                    continue

                relative_opus = Path("audio", "listening_opus", site_id, f"{segment.segment_id}.opus")
                opus_path = archive_root / relative_opus
                working_path = (
                    None if args.no_working_wav
                    else archive_root / "audio" / "working_wav" / site_id / f"{segment.segment_id}.wav"
                )
                outputs_exist = opus_path.exists() and (working_path is None or working_path.exists())
                timing = f"{segment.start:%H:%M:%S}-{segment.end:%H:%M:%S}"

                if args.dry_run:
                    state = "exists" if outputs_exist and not args.overwrite else "encode"
                    print(f"    {segment.segment_id}  {timing}  {segment.length / 60:5.1f} min  {state}")
                elif outputs_exist and not args.overwrite:
                    totals["existing"] += 1
                else:
                    t0 = time.monotonic()
                    print(f"    [{index}/{len(segments)}] {segment.segment_id}  {timing} ...", end="", flush=True)
                    encode_segment(files, list_path, segment, channels, working_path, opus_path, args.opus_bitrate)
                    written += 1
                    print(f" ok ({time.monotonic() - t0:.0f}s)")

                if owner is None:
                    new_segment_rows.append({
                        "segment_id": segment.segment_id,
                        "session_id": session_id,
                        "site_id": site_id,
                        "segment_start_local": segment.start.isoformat(timespec="seconds"),
                        "segment_end_local": segment.end.isoformat(timespec="seconds"),
                        "local_date": segment.start.date().isoformat(),
                        "local_hour": str(segment.start.hour),
                        "year": str(segment.start.year),
                        "month": str(segment.start.month),
                        "season": season_for(segment.start.month, latitude),
                        "listening_opus_path": relative_opus.as_posix(),
                        "public_url": "",
                        "published": "false",
                        "featured": "false",
                    })
        except IngestError as exc:
            totals["errors"] += 1
            print(f"\n    x ffmpeg failed: {exc}\n")
            if not args.dry_run:
                row["status"] = f"error: {exc}"
                write_csv_atomic(manifest_path, manifest_header or MANIFEST_COLUMNS, manifest_rows)
            continue
        finally:
            list_dir.cleanup()

        totals["written"] += written
        totals["conflicts"] += conflicts
        if args.dry_run:
            print()
            continue

        kept = len(segments) - conflicts
        if kept and existing_session is None:
            session_row = {
                "session_id": session_id,
                "site_id": site_id,
                "raw_file_name": raw_names,
                "start_datetime_local": start_text,
                "end_datetime_local": end_text,
                "timezone": timezone,
                "recorder": files[0].recorder,
                "microphones": row.get("microphones", "").strip(),
                "sample_rate_hz": str(files[0].sample_rate),
                "bit_depth": str(files[0].bit_depth or ""),
                "channels": str(files[0].channels),
                "operator": args.operator,
                "copyright_owner": args.copyright_owner or args.operator,
                "license": args.license,
            }
            session_rows.append(session_row)
            sessions_by_id[session_id] = session_row
        for new_row in new_segment_rows:
            segment_rows.append(new_row)
            segment_owner[new_row["segment_id"]] = session_id
        if (kept and existing_session is None) or new_segment_rows:
            session_rows.sort(key=lambda r: r.get("session_id", ""))
            segment_rows.sort(key=lambda r: r.get("segment_id", ""))
            write_csv_atomic(metadata_dir / "sessions.csv", sessions_header, session_rows)
            write_csv_atomic(metadata_dir / "segments.csv", segments_header, segment_rows)
            metadata_changed = True

        row["status"] = (
            f"processed {datetime.now():%Y-%m-%d}: session {session_id}, {kept} segment(s)"
            + (f", {conflicts} conflict(s)" if conflicts else "")
        )
        write_csv_atomic(manifest_path, manifest_header or MANIFEST_COLUMNS, manifest_rows)
        print()

    elapsed = time.monotonic() - started
    print(
        f"Done in {elapsed / 60:.1f} min: {totals['written']} segment(s) encoded, "
        f"{totals['existing']} already present, {totals['short']} too short, "
        f"{totals['conflicts']} conflict(s), {totals['errors']} recording(s) with errors."
    )
    if metadata_changed:
        print(flush=True)
        subprocess.run(
            [sys.executable, str(SCRIPT_DIR / "validate_metadata.py"), "--metadata-dir", str(metadata_dir)]
        )
    return 1 if totals["errors"] else 0


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest field recordings into the Soundscape Atlas archive.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Example:", 1)[1] if "Example:" in __doc__ else None,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="probe raw WAVs and write/update the manifest")
    scan.add_argument("--raw-dir", required=True, help="folder to search recursively for WAV files")
    scan.add_argument("--manifest", required=True, help="manifest CSV to create or update")
    scan.add_argument("--timezone", default="", help="IANA timezone to prefill for new rows, e.g. Europe/Berlin")
    scan.set_defaults(func=cmd_scan)

    process = sub.add_parser("process", help="cut, encode and register manifest rows that have a site_id")
    process.add_argument("--manifest", required=True)
    process.add_argument("--archive-root", required=True, help="output root; audio is written under <root>/audio/")
    process.add_argument("--metadata-dir", default=default_metadata_dir(),
                         help=f"metadata folder on the archive drive (default: ${METADATA_DIR_ENV})")
    process.add_argument("--operator", default="", help="recordist name for sessions.csv")
    process.add_argument("--copyright-owner", default="", help="defaults to --operator")
    process.add_argument("--license", default="all_rights_reserved")
    process.add_argument("--opus-bitrate", default="128k")
    process.add_argument("--min-segment-seconds", type=float, default=60.0,
                         help="drop partial segments shorter than this (default 60)")
    process.add_argument("--no-working-wav", action="store_true", help="only write Opus listening copies")
    process.add_argument("--only", default="", help="process just one source_key or site_id")
    process.add_argument("--overwrite", action="store_true", help="re-encode segments whose files already exist")
    process.add_argument("--dry-run", action="store_true", help="show the plan without writing anything")
    process.set_defaults(func=cmd_process)

    args = parser.parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\nInterrupted. Finished segments are kept; re-run to continue.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
