#!/usr/bin/env python3
"""Publish one recording session on the website, in one go.

    python3 scripts/publish_session.py AU_NSW_BOOMERANG_FALLS_20240822_1533 --dry-run
    python3 scripts/publish_session.py AU_NSW_BOOMERANG_FALLS_20240822_1533 --start 15:38
    python3 scripts/publish_session.py AU_NSW_BOOMERANG_FALLS_20240822_1533 --except 02:00 --end 10:40
    python3 scripts/publish_session.py AU_NSW_BOOMERANG_FALLS_20240822_1533 --no-upload    # try it locally first
    python3 scripts/publish_session.py AU_NSW_BOOMERANG_FALLS_20240822_1533 --unpublish

It first shows every hour of the session with its BirdNET calls, any possible
human voices and how its audio will be edited, and asks before changing
anything. Then it:

  1. marks the session's hours in segments.csv, and the cut ends (--start,
     --end) in sessions.csv,
  2. makes the public copy of each published hour from its lossless working
     WAV: low cut at 100 Hz, the cut ends removed, 10 s fades where the
     published audio starts and stops (the recording's ends and either side of
     a held-back hour), Opus 128k, and its spectrogram strip
     (audio/public_opus/; hours already made the same way are skipped),
  3. works out the acoustic indices for the session's hours (compute_indices.py;
     kept in the metadata, not shown on the site yet),
  4. checks the metadata (validate_metadata.py),
  5. uploads the public copies and spectrograms to R2 (upload_to_r2.py),
  6. rebuilds website/api, the weather and any missing bird plates,
  7. serves the preview of exactly what will be public (preview_site.py
     --published-only), until you press Ctrl+C.

Nothing is public on the website until you commit and push website/; the
command prints the exact git commands. (Uploaded audio can be fetched from the
bucket by anyone who guesses its address, so only hours you mean to publish are
uploaded.)

Choosing what is published:
  --except HOUR   holds an hour back: its start time as listed (15:00, or 15:33,
                  or just 15), a date and time (2024-08-22 15:00) when a session
                  runs over 24 hours, or a segment ID; commas separate several.
  --include HOUR  publishes a held-back hour again.
  --start TIME    cuts the recording before this local time (15:38, or
                  2024-08-22 15:38); --end TIME cuts it after. "none" removes a cut.
The first run publishes every hour but the --except ones. Later runs remember
the held-back hours and the cuts, so only name what changes.

Hours with possible human voices (inside the published part) must be listened
to first: hold them back, cut them, or confirm you checked them (asked, or
--voices-checked with --yes).

--no-upload does steps 1 to 4 and the preview only: website/ and the bucket are
left alone. --unpublish sets every hour of the session back to unpublished, then
removes its files from the bucket (upload_to_r2.py --prune asks first) and
rebuilds website/api.

The archive root defaults to the folder above the metadata folder; the bucket
to $R2_REMOTE or r2:soundscape-atlas-audio at $R2_PUBLIC_BASE_URL or
https://media.soundscapeatlas.com.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
import compute_indices  # noqa: E402
from import_birdnet import HUMAN_VOICE_CLASSES, parse_results  # noqa: E402
from ingest_recordings import (  # noqa: E402
    IngestError, default_metadata_dir, read_csv, require_metadata_dir, run_ffprobe, write_csv_atomic,
)
from make_spectrograms import DEFAULT_SIZE, render  # noqa: E402
from upload_to_r2 import public_copy  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
WEBSITE_DATA = REPO / "website" / "api" / "data.json"
WEBSITE_ART = REPO / "website" / "art"
DEFAULT_REMOTE = "r2:soundscape-atlas-audio"
DEFAULT_PUBLIC_URL = "https://media.soundscapeatlas.com"
VOICE_MIN_CONFIDENCE = 0.25  # as import_birdnet.py: a possible voice is a privacy check
WINDOW_COLUMNS = ["public_start_local", "public_end_local"]

# The public copy of each hour. Changing any of these makes the next run redo every hour.
LOW_CUT_HZ = 100           # two 12 dB/octave high-pass stages: 24 dB/octave, -6 dB at 100 Hz
FADE_SEC = 10
OPUS_BITRATE = "128k"      # as the listening copies (ingest_recordings.py)
MASTER_JOBS = 4
MASTER_TAG = "soundscape_master"  # Opus comment recording how a copy was made


class Stop(Exception):
    """A problem that ends the run with an explanation."""


@dataclass
class Edit:
    """How one published hour's public copy is made."""
    cut_from: float   # seconds into the hour where the public copy starts
    length: float     # seconds of the hour in the public copy
    fade_in: bool
    fade_out: bool

    def recipe(self) -> str:
        return (f"v1; low cut {LOW_CUT_HZ} Hz 24 dB/oct; from {self.cut_from:.3f} s; length {self.length:.3f} s; "
                f"fade in {FADE_SEC if self.fade_in else 0} s; fade out {FADE_SEC if self.fade_out else 0} s; "
                f"opus {OPUS_BITRATE}")


def is_true(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() == "true"


def start_of(segment: Dict[str, str]) -> datetime:
    return datetime.fromisoformat(segment["segment_start_local"])


def end_of(segment: Dict[str, str]) -> datetime:
    return datetime.fromisoformat(segment["segment_end_local"])


def hour_label(segment: Dict[str, str]) -> str:
    return start_of(segment).strftime("%a %d %b %H:%M")


def match_hours(option: str, values: Sequence[str], segments: List[Dict[str, str]]) -> List[str]:
    """Segment IDs named by --except/--include values; raises Stop on anything unclear."""
    chosen: List[str] = []
    for value in (part.strip() for item in values for part in item.split(",")):
        if not value:
            continue
        if any(segment["segment_id"] == value for segment in segments):
            chosen.append(value)
            continue
        match = re.fullmatch(r"(?:(\d{4}-\d{2}-\d{2})[ T])?(\d{1,2})(?::(\d{2}))?", value)
        if not match:
            raise Stop(f"{option} {value!r}: use a time like 15:00, a date and time like 2024-08-22 15:00, or a segment ID")
        date, hour, minute = match.group(1), int(match.group(2)), match.group(3)
        found = []
        for segment in segments:
            start = start_of(segment)
            if start.hour != hour or (date and start.date().isoformat() != date):
                continue
            # 15:33 must be the hour that starts then; 15 or 15:00 is the hour of 15:00-16:00
            if minute is not None and minute != "00" and start.minute != int(minute):
                continue
            found.append(segment["segment_id"])
        if not found:
            raise Stop(f"{option} {value}: no hour of this session starts then")
        if len(found) > 1:
            raise Stop(f"{option} {value}: more than one hour matches; add the date, e.g. "
                       f"{option} '{start_of(segments[0]).date()} {value}'")
        chosen.extend(found)
    return chosen


def parse_moment(option: str, value: str, first: datetime, last: datetime) -> Optional[datetime]:
    """--start/--end: HH:MM[:SS] within the recording, or a date and time; 'none' removes the cut."""
    if value.strip().lower() in ("none", ""):
        return None
    match = re.fullmatch(r"(?:(\d{4}-\d{2}-\d{2})[ T])?(\d{1,2}):(\d{2})(?::(\d{2}))?", value.strip())
    if not match:
        raise Stop(f"{option} {value!r}: use a local time like 15:38, or a date and time like 2024-08-22 15:38")
    clock = time(int(match.group(2)), int(match.group(3)), int(match.group(4) or 0))
    if match.group(1):
        candidates = [datetime.combine(datetime.fromisoformat(match.group(1)).date(), clock)]
    else:
        days = (last.date() - first.date()).days
        candidates = [datetime.combine(first.date() + timedelta(days=d), clock) for d in range(days + 1)]
    inside = [moment for moment in candidates if first < moment < last]
    if not inside:
        raise Stop(f"{option} {value}: not within the recording ({first:%d %b %H:%M:%S} to {last:%d %b %H:%M:%S})")
    if len(inside) > 1:
        raise Stop(f"{option} {value}: the recording passes that time more than once; add the date")
    return inside[0]


def possible_voices(archive_root: Path, session: Dict[str, str], starts: Dict[str, datetime],
                    window: Tuple[Optional[datetime], Optional[datetime]]) -> Dict[str, float]:
    """Highest human-voice score per segment, inside the published part, from the raw BirdNET output."""
    path = archive_root / "birdnet" / session["site_id"] / f"{session['session_id']}.BirdNET.results.csv"
    if not path.is_file():
        raise Stop(
            f"BirdNET has not been run on this session yet ({path.name} is missing), so possible voices "
            "cannot be checked. Run scripts/run_birdnet.py and import_birdnet.py first."
        )
    detections, problem = parse_results(path)
    if problem:
        raise Stop(f"Could not read {path}: {problem}")
    voices: Dict[str, float] = {}
    for detection in detections:
        if detection.common.strip().lower() not in HUMAN_VOICE_CLASSES or detection.confidence < VOICE_MIN_CONFIDENCE:
            continue
        start = starts.get(detection.segment_id)
        if start is None:
            continue
        begins, ends = start + timedelta(seconds=detection.start), start + timedelta(seconds=detection.end)
        if (window[0] and ends <= window[0]) or (window[1] and begins >= window[1]):
            continue  # in a part that is cut
        voices[detection.segment_id] = max(voices.get(detection.segment_id, 0.0), detection.confidence)
    return voices


def plan_edits(segments: List[Dict[str, str]], wanted: Dict[str, bool],
               window: Tuple[Optional[datetime], Optional[datetime]]) -> Dict[str, Edit]:
    """The public copy of each published hour: cut ends, and fades where published audio starts or stops."""
    edits: Dict[str, Edit] = {}
    for i, segment in enumerate(segments):
        if not wanted[segment["segment_id"]]:
            continue
        start, end = start_of(segment), end_of(segment)
        public_start = max(start, window[0]) if window[0] else start
        public_end = min(end, window[1]) if window[1] else end
        before = i > 0 and wanted[segments[i - 1]["segment_id"]] and public_start == start
        after = i + 1 < len(segments) and wanted[segments[i + 1]["segment_id"]] and public_end == end
        edits[segment["segment_id"]] = Edit(
            cut_from=(public_start - start).total_seconds(),
            length=(public_end - public_start).total_seconds(),
            fade_in=not before,
            fade_out=not after,
        )
    return edits


def edit_label(segment: Dict[str, str], edit: Optional[Edit]) -> str:
    if edit is None:
        return ""
    parts = []
    if edit.cut_from > 0:
        parts.append(f"from {start_of(segment) + timedelta(seconds=edit.cut_from):%H:%M:%S}")
    if edit.cut_from + edit.length < (end_of(segment) - start_of(segment)).total_seconds() - 0.5:
        parts.append(f"to {start_of(segment) + timedelta(seconds=edit.cut_from + edit.length):%H:%M:%S}")
    if edit.fade_in:
        parts.append("fade in")
    if edit.fade_out:
        parts.append("fade out")
    return ", ".join(parts)


def master_tag(path: Path) -> str:
    """The recipe stored in a public copy, or '' if there is none."""
    if not path.is_file():
        return ""
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json", str(path)],
                            capture_output=True, text=True)
    if result.returncode != 0:
        return ""
    data = json.loads(result.stdout or "{}")
    for tags in [data.get("format", {}).get("tags", {})] + [s.get("tags", {}) for s in data.get("streams", [])]:
        for key, value in tags.items():
            if key.lower() == MASTER_TAG:
                return value
    return ""


def make_public_copy(wav: Path, opus: Path, segment_id: str, edit: Edit) -> Tuple[Path, float, str]:
    """Encode one hour's public copy and draw its spectrogram. Returns (opus, seconds, error)."""
    started = datetime.now()
    filters = [f"highpass=f={LOW_CUT_HZ}:poles=2", f"highpass=f={LOW_CUT_HZ}:poles=2"]
    fade = min(FADE_SEC, edit.length / 2)
    if edit.fade_in:
        filters.append(f"afade=t=in:st=0:d={fade:.3f}")
    if edit.fade_out:
        filters.append(f"afade=t=out:st={edit.length - fade:.3f}:d={fade:.3f}")
    opus.parent.mkdir(parents=True, exist_ok=True)
    tmp = opus.with_name(opus.name + ".part")
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        "-ss", f"{edit.cut_from:.6f}", "-t", f"{edit.length:.6f}", "-i", str(wav),
        "-af", ",".join(filters), "-map_metadata", "-1",
        "-c:a", "libopus", "-b:a", OPUS_BITRATE, "-vbr", "constrained", "-application", "audio",
        "-metadata", f"title={segment_id}", "-metadata", f"{MASTER_TAG}={edit.recipe()}",
        "-f", "opus", str(tmp),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        tmp.unlink(missing_ok=True)
        return opus, 0.0, result.stderr.strip() or f"ffmpeg exit {result.returncode}"
    os.replace(tmp, opus)
    _, _, error = render(opus, opus.with_suffix(".png"), DEFAULT_SIZE)
    return opus, (datetime.now() - started).total_seconds(), error and f"spectrogram: {error}"


def run_script(name: str, *args: str) -> int:
    print(f"\n$ {name} {' '.join(args)}", flush=True)
    return subprocess.run([sys.executable, str(SCRIPTS / name), *args]).returncode


def ask(question: str) -> bool:
    try:
        return input(f"{question} [y/N] ").strip().lower() in ("y", "yes")
    except EOFError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Publish one recording session on the website",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("\n\n", 1)[1],
    )
    parser.add_argument("session_id", help="e.g. AU_NSW_BOOMERANG_FALLS_20240822_1533")
    parser.add_argument("--except", dest="held_back", action="append", default=[], metavar="HOUR",
                        help="hold an hour back (repeatable, or comma-separated)")
    parser.add_argument("--include", action="append", default=[], metavar="HOUR", help="publish a held-back hour again")
    parser.add_argument("--start", metavar="TIME", help="cut the recording before this local time ('none' removes the cut)")
    parser.add_argument("--end", metavar="TIME", help="cut the recording after this local time ('none' removes the cut)")
    parser.add_argument("--unpublish", action="store_true", help="take the whole session off the website")
    parser.add_argument("--no-upload", action="store_true", help="leave the bucket and website/ alone (local try-out)")
    parser.add_argument("--no-preview", action="store_true", help="do not start the preview at the end")
    parser.add_argument("--dry-run", action="store_true", help="show the plan; change nothing")
    parser.add_argument("--yes", action="store_true", help="do not ask before publishing")
    parser.add_argument("--voices-checked", action="store_true", help="with --yes: you have listened to the hours with possible voices")
    parser.add_argument("--metadata-dir", default=default_metadata_dir(), help="metadata folder (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--archive-root", help="archive folder (default: the folder above the metadata folder)")
    parser.add_argument("--remote", default=os.environ.get("R2_REMOTE") or DEFAULT_REMOTE)
    parser.add_argument("--public-base-url", default=os.environ.get("R2_PUBLIC_BASE_URL") or DEFAULT_PUBLIC_URL)
    args = parser.parse_args()

    try:
        return publish(args)
    except Stop as stop:
        print(f"\nStopped: {stop}", file=sys.stderr)
        return 1


def publish(args: argparse.Namespace) -> int:
    metadata_dir = require_metadata_dir(args.metadata_dir).resolve()
    archive_root = Path(args.archive_root).expanduser().resolve() if args.archive_root else metadata_dir.parent
    if not (archive_root / "audio" / "listening_opus").is_dir():
        raise Stop(f"{archive_root} has no audio/listening_opus folder; is the archive drive connected? (or pass --archive-root)")

    sessions_header, sessions = read_csv(metadata_dir / "sessions.csv")
    session = next((row for row in sessions if row["session_id"] == args.session_id), None)
    if session is None:
        close = [row["session_id"] for row in sessions if args.session_id.lower() in row["session_id"].lower()]
        raise Stop(f"no session {args.session_id!r} in sessions.csv" + (f"; did you mean: {', '.join(close[:5])}" if close else ""))
    _, sites = read_csv(metadata_dir / "sites.csv")
    site_name = next((row["site_name"] for row in sites if row["site_id"] == session["site_id"]), session["site_id"])

    segments_header, all_segments = read_csv(metadata_dir / "segments.csv")
    segments = sorted((row for row in all_segments if row["session_id"] == args.session_id), key=start_of)
    if not segments:
        raise Stop(f"{args.session_id} has no hours in segments.csv; has it been processed?")
    first, last = start_of(segments[0]), end_of(segments[-1])

    # ---- the cut ends: remembered in sessions.csv, changed by --start/--end
    window: List[Optional[datetime]] = []
    for column, option, value in zip(WINDOW_COLUMNS, ("--start", "--end"), (args.start, args.end)):
        if value is not None:
            window.append(parse_moment(option, value, first, last))
        else:
            stored = str(session.get(column) or "").strip()
            window.append(datetime.fromisoformat(stored) if stored else None)
    if window[0] and window[1] and window[0] >= window[1]:
        raise Stop("--start must be before --end")
    window_tuple = (window[0], window[1])

    # ---- which hours: the first run publishes all but --except; later runs remember
    held_back = set(match_hours("--except", args.held_back, segments))
    included = set(match_hours("--include", args.include, segments))
    if held_back & included:
        raise Stop("an hour is named in both --except and --include")
    already = any(is_true(segment["published"]) for segment in segments)
    wanted: Dict[str, bool] = {}
    cut_away = set()
    for segment in segments:
        segment_id = segment["segment_id"]
        outside = (window[0] and end_of(segment) <= window[0]) or (window[1] and start_of(segment) >= window[1])
        if outside:
            cut_away.add(segment_id)
        wanted[segment_id] = (
            not args.unpublish and not outside and segment_id not in held_back
            and (segment_id in included or not already or is_true(segment["published"]))
        )
    edits = plan_edits(segments, wanted, window_tuple)

    starts = {segment["segment_id"]: start_of(segment) for segment in segments}
    voices = {} if args.unpublish else possible_voices(archive_root, session, starts, window_tuple)
    _, detections = read_csv(metadata_dir / "birdnet_detections.csv")
    calls = Counter(
        row["segment_id"] for row in detections
        if row["segment_id"] in starts and (row.get("review_status") or "").strip().lower() != "rejected"
    )
    if not args.unpublish and not calls:
        raise Stop("no BirdNET detections are imported for this session yet; run scripts/import_birdnet.py first")

    wavs = {segment["segment_id"]: compute_indices.wav_path(archive_root, segment) for segment in segments}
    missing = [segment_id for segment_id in edits if not wavs[segment_id].is_file()]
    if missing:
        raise Stop(f"no working WAV for {', '.join(missing)}; the public copies are made from them")

    # The CSV clock is rounded to seconds. With no end cut, fade to the last sample of the WAV.
    tail_id = segments[-1]["segment_id"]
    if window[1] is None and tail_id in edits:
        tail = edits[tail_id]
        try:
            duration = float(run_ffprobe(wavs[tail_id])["format"]["duration"])
        except (IngestError, KeyError, TypeError, ValueError) as exc:
            raise Stop(f"could not read the duration of {wavs[tail_id].name}") from exc
        tail.length = duration - tail.cut_from
        if not 0 < tail.length < float("inf"):
            raise Stop(f"invalid duration for {wavs[tail_id].name}")

    # ---- the plan
    print(f"\n{site_name}  ({session['site_id']})")
    print(f"{first:%a %d %b %Y %H:%M} to {last:%a %d %b %H:%M}, {len(segments)} hours")
    if window[0] or window[1]:
        print(f"Published part: {window[0] or first:%a %d %b %H:%M:%S} to {window[1] or last:%a %d %b %H:%M:%S}")
    print(f"\n  {'Hour':<17}{'Calls':>7}   {'Possible voice':<16}{'Will be':<12}Audio")
    for segment in segments:
        segment_id = segment["segment_id"]
        voice = f"voice {voices[segment_id]:.0%}" if segment_id in voices else ""
        state = "published" if wanted[segment_id] else "cut" if segment_id in cut_away else "held back"
        change = "" if wanted[segment_id] == is_true(segment["published"]) else " *"
        print(f"  {hour_label(segment):<17}{calls.get(segment_id, 0):>7}   {voice:<16}{state + change:<12}"
              f"{edit_label(segment, edits.get(segment_id))}")
    publishing = [segment for segment in segments if wanted[segment["segment_id"]]]
    print(f"\n{len(publishing)} of {len(segments)} hours will be published (* = changes)."
          + ("" if args.unpublish else f" Every published hour gets a low cut at {LOW_CUT_HZ} Hz; "
                                       f"fades are {FADE_SEC} s."))

    voiced = [segment for segment in publishing if segment["segment_id"] in voices]
    if voiced:
        print(f"\nPossible human voices in {len(voiced)} hour(s) you are publishing: "
              + ", ".join(hour_label(segment) for segment in voiced))
        print("Listen to them first; to hold them back, add for example --except "
              + ",".join(start_of(segment).strftime("%H:%M") for segment in voiced))

    if args.dry_run:
        print("\nDry run: nothing changed.")
        return 0
    if args.yes:
        if voiced and not args.voices_checked:
            raise Stop("hours with possible voices are included; listen first, then add --voices-checked (or hold them back)")
    else:
        if voiced and not ask("Have you listened to the hours with possible voices, and are they fine to publish?"):
            raise Stop("hold those hours back with --except, or listen to them first")
        verb = "Take this session off the website" if args.unpublish else f"Publish these {len(publishing)} hours"
        if not ask(f"{verb}?"):
            print("Nothing changed.")
            return 0

    # ---- 1. published flags and cut ends
    changed = 0
    for segment in segments:
        value = "true" if wanted[segment["segment_id"]] else "false"
        if segment["published"] != value:
            segment["published"] = value
            changed += 1
    if changed:
        write_csv_atomic(metadata_dir / "segments.csv", segments_header, all_segments)
    window_values = [moment.isoformat() if moment else "" for moment in window]
    if [str(session.get(column) or "").strip() for column in WINDOW_COLUMNS] != window_values:
        for column in WINDOW_COLUMNS:
            if column not in sessions_header:
                sessions_header.append(column)
        session.update(zip(WINDOW_COLUMNS, window_values))
        write_csv_atomic(metadata_dir / "sessions.csv", sessions_header, sessions)
        print(f"\n1. segments.csv: {changed} hour(s) changed; sessions.csv: cut ends saved.")
    else:
        print(f"\n1. segments.csv: {changed} hour(s) changed.")

    if not args.unpublish:
        # ---- 2. public copies
        todo = []
        for segment in publishing:
            segment_id = segment["segment_id"]
            opus = archive_root / public_copy(segment["listening_opus_path"])
            if master_tag(opus) != edits[segment_id].recipe() or not opus.with_suffix(".png").is_file():
                todo.append((wavs[segment_id], opus, segment_id, edits[segment_id]))
        print(f"2. Public copies: {len(todo)} to make, {len(publishing) - len(todo)} already made this way "
              f"(about a minute each, {MASTER_JOBS} at a time).", flush=True)
        with ThreadPoolExecutor(max_workers=MASTER_JOBS) as pool:
            for i, (opus, seconds, error) in enumerate(pool.map(lambda job: make_public_copy(*job), todo), 1):
                if error:
                    raise Stop(f"could not make {opus.name}: {error}")
                print(f"   [{i}/{len(todo)}] {opus.name} ({seconds:.0f} s)", flush=True)

        # ---- 3. indices (not on the site yet, so a failure only warns)
        print("3. ", end="", flush=True)
        failed = compute_indices.run(archive_root, metadata_dir, segments, log=lambda line: print(line, flush=True))
        if failed:
            print(f"   warning: indices failed for {failed} hour(s); publishing goes on (re-run compute_indices.py later)")

    # ---- 4. check
    if run_script("validate_metadata.py", "--metadata-dir", str(metadata_dir)) != 0:
        raise Stop("the metadata check failed (see above); nothing was uploaded")

    if not args.no_upload:
        # ---- 5. bucket
        upload_args = ["--archive-root", str(archive_root), "--metadata-dir", str(metadata_dir),
                       "--remote", args.remote, "--public-base-url", args.public_base_url]
        if args.unpublish:
            upload_args.append("--prune")
        if run_script("upload_to_r2.py", *upload_args) != 0:
            raise Stop("the upload did not finish (see above); website/ was not rebuilt. Run the same command again.")

        # ---- 6. website data
        if run_script("build_web_metadata.py", "--metadata-dir", str(metadata_dir), "--output", str(WEBSITE_DATA)) != 0:
            raise Stop("building website/api failed (see above)")
        if run_script("fetch_weather.py", "--data", str(WEBSITE_DATA)) != 0:
            print("warning: the weather is missing for some sessions (see above); re-run fetch_weather.py later")
        if not args.unpublish and run_script("fetch_bird_plates.py", "--data", str(WEBSITE_DATA), "--art", str(WEBSITE_ART)) != 0:
            print("warning: some bird plates could not be fetched (see above)")

    # ---- what next
    what = "Unpublish" if args.unpublish else "Publish"
    date = f"{first:%d %b %Y}".lstrip("0")
    print("\n" + "-" * 72)
    if args.no_upload and args.unpublish:
        print("The hours are marked unpublished in the metadata; the bucket and website/ were not touched.")
    elif args.no_upload:
        print("Tried locally: the published flags, cut ends, public copies and indices are made, but nothing")
        print("was uploaded and website/ is unchanged. When you are happy, run the same command without --no-upload.")
        print(f"To undo instead: python3 scripts/publish_session.py {args.session_id} --unpublish --no-upload")
    else:
        print("When the preview looks right, make it live (pushing the website deploys it):\n")
        print(f"  cd {metadata_dir} && git add -A && git commit -m \"{what} {args.session_id}\" && git push")
        print(f"  cd {REPO} && git add website/ && git commit -m \"Website: {what.lower()} {site_name}, {date}\" && git push")
    print("-" * 72, flush=True)

    # ---- 7. preview
    if args.no_preview:
        return 0
    print("\nStarting the preview of exactly what will be public; press Ctrl+C to stop it.", flush=True)
    try:
        run_script("preview_site.py", "--metadata-dir", str(metadata_dir), "--archive-root", str(archive_root), "--published-only")
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
