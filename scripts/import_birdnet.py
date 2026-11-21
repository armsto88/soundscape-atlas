#!/usr/bin/env python3
"""Import BirdNET-Analyzer results into birdnet_detections.csv (metadata folder).

Run BirdNET-Analyzer on the working WAVs written by ingest_recordings.py
(<archive-root>/audio/working_wav/<SITE>/<SEGMENT_ID>.wav). Each file is one
segment named by its segment ID, so detections map to segments directly and
their times are already relative to the segment start. Running it per site
with that site's --lat/--lon lets BirdNET filter unlikely species.

Supported BirdNET output (columns are matched by name, so versions differ
gracefully):
  * Raven selection tables (*.BirdNET.selection.table.txt), per file or the
    combined table with "Begin Path" and "File Offset (s)" columns
  * CSV results (*.BirdNET.results.csv)
  * Kaleidoscope CSV (BirdNET_Kaleidoscope.csv)

Importing results for a segment replaces that segment's detections; other
segments are untouched. Detection IDs are stable, and review_status values
you set by hand are kept for detections that are still present.

Non-bird classes (human voice, engine, dog, noise, ...) are left out unless
--keep-non-birds is given. Segments with possible human voices are listed so
they can be checked before publishing.

Example:
  python3 scripts/import_birdnet.py --results /media/USER/archive/soundscape_atlas/birdnet --dry-run
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PureWindowsPath
from typing import Dict, Iterable, List, Optional, Tuple

sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
from ingest_recordings import default_metadata_dir, read_csv, require_metadata_dir, write_csv_atomic  # noqa: E402

RESULT_SUFFIXES = (".txt", ".csv", ".tsv")
DEFAULT_MIN_CONFIDENCE = 0.25

# BirdNET's non-bird classes (common name, lower case).
NON_BIRD_CLASSES = {
    "human vocal", "human non-vocal", "human whistle", "engine", "dog", "gun",
    "power tools", "siren", "fireworks", "noise", "environmental",
}
HUMAN_VOICE_CLASSES = {"human vocal", "human whistle"}
# BirdNET writes a "nocall" placeholder row for files with no detections.
NO_DETECTION_CLASSES = {"nocall", "no call"}

# Column name aliases, compared lower-case without surrounding spaces.
COLUMNS = {
    "start": ("begin time (s)", "start (s)", "start", "offset", "start_time"),
    "end": ("end time (s)", "end (s)", "end", "end_time"),
    "duration": ("duration",),
    "file_offset": ("file offset (s)",),
    "common": ("common name", "common_name", "common"),
    "scientific": ("scientific name", "scientific_name", "scientific"),
    "confidence": ("confidence",),
    "file": ("begin path", "begin file", "file", "in file", "filepath", "path"),
}


@dataclass
class Detection:
    segment_id: str
    common: str
    scientific: str
    start: float
    end: float
    confidence: float
    source: Path


def read_table(path: Path) -> Tuple[List[str], List[List[str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        delimiter = "\t" if sample.count("\t") > sample.count(",") else ","
        rows = list(csv.reader(handle, delimiter=delimiter))
    if not rows:
        return [], []
    return [cell.strip().lower() for cell in rows[0]], rows[1:]


def column_index(header: List[str], key: str) -> Optional[int]:
    for alias in COLUMNS[key]:
        if alias in header:
            return header.index(alias)
    return None


def segment_id_from_path(value: str) -> str:
    """Segment ID from an audio path or a BirdNET result file name."""
    name = PureWindowsPath(value).name if "\\" in value else Path(value).name
    name = re.split(r"\.BirdNET", name, maxsplit=1, flags=re.IGNORECASE)[0]
    return name.rsplit(".", 1)[0] if re.search(r"\.(wav|flac|mp3|opus|ogg|m4a)$", name, re.IGNORECASE) else name


def parse_results(path: Path) -> Tuple[List[Detection], Optional[str]]:
    """Detections from one BirdNET result file, or (empty, reason) if unsupported."""
    header, rows = read_table(path)
    if not header:
        return [], "empty file"
    index = {key: column_index(header, key) for key in COLUMNS}
    if index["confidence"] is None or index["start"] is None or (index["common"] is None and index["scientific"] is None):
        return [], "not a BirdNET results table"
    if index["end"] is None and index["duration"] is None:
        return [], "no end time column"

    # Kaleidoscope splits the audio file name across FOLDER and IN FILE.
    file_from_name = segment_id_from_path(path.name)
    detections: List[Detection] = []
    for row in rows:
        if not row or all(not cell.strip() for cell in row):
            continue

        def cell(key: str) -> str:
            i = index[key]
            return row[i].strip() if i is not None and i < len(row) else ""

        try:
            begin = float(cell("start"))
            end = float(cell("end")) if index["end"] is not None else begin + float(cell("duration"))
            confidence = float(cell("confidence"))
        except ValueError:
            continue
        if cell("file_offset"):
            # Combined Raven tables: Begin/End are cumulative across files.
            try:
                offset = float(cell("file_offset"))
                end = offset + (end - begin)
                begin = offset
            except ValueError:
                pass
        if confidence > 1:  # some exports use percent
            confidence /= 100

        segment_id = segment_id_from_path(cell("file")) if cell("file") else file_from_name
        common = cell("common")
        scientific = cell("scientific")
        if "_" in common and not scientific:
            # Some outputs use BirdNET's "Scientific name_Common name" labels.
            scientific, common = common.split("_", 1)
        detections.append(Detection(segment_id, common or scientific, scientific, begin, end, confidence, path))
    return detections, None


def find_result_files(paths: Iterable[Path]) -> List[Path]:
    files: List[Path] = []
    for path in paths:
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(
                p for p in sorted(path.rglob("*"))
                if p.is_file() and p.suffix.lower() in RESULT_SUFFIXES and not p.name.startswith(("._", "."))
                and "birdnet" in p.name.lower() and "params" not in p.name.lower()
            )
    return files


def segment_length(row: Dict[str, str]) -> Optional[float]:
    try:
        start = datetime.fromisoformat(row.get("segment_start_local", ""))
        end = datetime.fromisoformat(row.get("segment_end_local", ""))
    except ValueError:
        return None
    seconds = (end - start).total_seconds()
    return seconds if seconds > 0 else None


def species_key(common: str, scientific: str) -> str:
    return (scientific or common).strip().lower()


def detection_id(segment_id: str, start: float, key: str) -> str:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:6]
    return f"{segment_id}_{int(round(start * 10)):05d}_{digest}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import BirdNET-Analyzer results into birdnet_detections.csv.",
        epilog=__doc__.split("\n", 1)[1],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--results", action="append", required=True,
                        help="BirdNET result file or folder (searched recursively); repeatable")
    parser.add_argument("--metadata-dir", default=default_metadata_dir(),
                        help="metadata folder (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE,
                        help=f"drop detections below this (0-1, default {DEFAULT_MIN_CONFIDENCE})")
    parser.add_argument("--model", default="BirdNET", help='stored in the model column, e.g. "BirdNET 2.4"')
    parser.add_argument("--keep-non-birds", action="store_true", help="also import human, engine, dog, noise, ...")
    parser.add_argument("--dry-run", action="store_true", help="report only; write nothing")
    args = parser.parse_args()

    metadata_dir = require_metadata_dir(args.metadata_dir)
    detections_path = metadata_dir / "birdnet_detections.csv"
    _, segment_rows = read_csv(metadata_dir / "segments.csv")
    header, existing_rows = read_csv(detections_path)
    segments = {row["segment_id"]: row for row in segment_rows}

    files = find_result_files(Path(p).expanduser() for p in args.results)
    if not files:
        print("No BirdNET result files found (names must contain 'BirdNET').", file=sys.stderr)
        return 2

    stats = Counter()
    unsupported: List[Tuple[Path, str]] = []
    unknown_segments: Counter = Counter()
    human_voice: Dict[str, float] = {}
    by_segment: Dict[str, Dict[Tuple[str, int], Detection]] = defaultdict(dict)

    parsed: List[Detection] = []
    # Every segment that appears in the results counts as analysed, even when
    # none of its detections survive the filters: its old detections are replaced.
    analysed: set = set()
    for path in files:
        detections, problem = parse_results(path)
        if problem:
            unsupported.append((path, problem))
            continue
        stats["files"] += 1
        file_segment = segment_id_from_path(path.name)
        if file_segment in segments:
            analysed.add(file_segment)
        analysed.update(det.segment_id for det in detections if det.segment_id in segments)
        parsed.extend(detections)

    # Raven tables carry no scientific names: fill them from any result or
    # existing row that pairs the same common name with one.
    scientific_by_common = {
        row.get("common_name", "").strip().lower(): row.get("scientific_name", "").strip()
        for row in existing_rows
        if row.get("common_name") and row.get("scientific_name")
    }
    scientific_by_common.update(
        {det.common.strip().lower(): det.scientific for det in parsed if det.common and det.scientific}
    )
    for det in parsed:
        if not det.scientific:
            det.scientific = scientific_by_common.get(det.common.strip().lower(), "")

    if parsed:
        for det in parsed:
            stats["read"] += 1
            name = det.common.strip().lower()
            if name in NO_DETECTION_CLASSES:
                stats["nocall"] += 1
                continue
            if name in HUMAN_VOICE_CLASSES and det.confidence >= args.min_confidence:
                human_voice[det.segment_id] = max(human_voice.get(det.segment_id, 0), det.confidence)
            if det.segment_id not in segments:
                unknown_segments[det.segment_id] += 1
                continue
            if name in NON_BIRD_CLASSES and not args.keep_non_birds:
                stats["non_bird"] += 1
                continue
            if det.confidence < args.min_confidence:
                stats["below_threshold"] += 1
                continue
            length = segment_length(segments[det.segment_id])
            if det.start < 0 or (length is not None and det.start > length + 1):
                stats["out_of_range"] += 1
                continue
            if length is not None:
                det.end = min(det.end, length)
            # One detection per species and start time (keep the most confident).
            key = (species_key(det.common, det.scientific), int(round(det.start * 10)))
            previous = by_segment[det.segment_id].get(key)
            if previous is None or det.confidence > previous.confidence:
                if previous is not None:
                    stats["duplicates"] += 1
                by_segment[det.segment_id][key] = det
            else:
                stats["duplicates"] += 1

    # Keep detection IDs and hand-set review status for detections that remain.
    # Matched on scientific *or* common name, so an earlier import that lacked
    # scientific names still lines up.
    kept_review = {}
    for row in existing_rows:
        try:
            tenths = int(round(float(row.get("start_sec") or "nan") * 10))
        except ValueError:
            continue
        kept = (row.get("detection_id", ""), row.get("review_status", "") or "unreviewed")
        for name in (row.get("scientific_name", ""), row.get("common_name", "")):
            if name.strip():
                kept_review.setdefault((row.get("segment_id", ""), name.strip().lower(), tenths), kept)

    imported_segments = analysed
    new_rows: List[Dict[str, str]] = []
    species_totals: Counter = Counter()
    for segment_id, detections in by_segment.items():
        for (key, tenths), det in sorted(detections.items(), key=lambda item: (item[1].start, item[0][0])):
            previous_id, review = (
                kept_review.get((segment_id, det.scientific.strip().lower(), tenths))
                or kept_review.get((segment_id, det.common.strip().lower(), tenths))
                or ("", "unreviewed")
            )
            new_rows.append({
                "detection_id": previous_id or detection_id(segment_id, det.start, key),
                "segment_id": segment_id,
                "common_name": det.common,
                "scientific_name": det.scientific,
                "start_sec": f"{det.start:.1f}",
                "end_sec": f"{det.end:.1f}",
                "confidence": f"{det.confidence:.4f}".rstrip("0").rstrip("."),
                "model": args.model,
                "review_status": review,
            })
            species_totals[det.common] += 1

    replaced = [row for row in existing_rows if row.get("segment_id") in imported_segments]
    untouched = [row for row in existing_rows if row.get("segment_id") not in imported_segments]
    output_rows = untouched + new_rows
    output_rows.sort(key=lambda row: (row.get("segment_id", ""), float(row.get("start_sec") or 0)))

    mode = "DRY RUN - nothing written" if args.dry_run else "Imported"
    print(f"{mode}: {stats['files']} result file(s), {stats['read']} detection(s) read.")
    print(f"  {len(imported_segments)} segment(s) analysed; kept {len(new_rows)} detection(s) in {len(by_segment)} of them, "
          f"replacing {len(replaced)} existing row(s)")
    print(f"  dropped: {stats['below_threshold']} below {args.min_confidence:.0%} confidence, "
          f"{stats['non_bird']} non-bird, {stats['duplicates']} duplicate, {stats['out_of_range']} outside the segment, "
          f"{stats['nocall']} 'nocall' placeholder")
    if species_totals:
        top = ", ".join(f"{name} ({count})" for name, count in species_totals.most_common(8))
        print(f"  most detected: {top}")
    if unknown_segments:
        print(f"  {sum(unknown_segments.values())} detection(s) for {len(unknown_segments)} file(s) that are not "
              f"segments in segments.csv, e.g. {', '.join(list(unknown_segments)[:3])}")
        print("    (run BirdNET on the working WAVs from ingest_recordings.py, which are named by segment ID)")
    for path, problem in unsupported:
        print(f"  skipped {path.name}: {problem}")
    if human_voice:
        print(f"\nPossible human voices in {len(human_voice)} segment(s); listen before publishing them:")
        for segment_id, confidence in sorted(human_voice.items(), key=lambda item: -item[1])[:20]:
            published = segments.get(segment_id, {}).get("published", "").strip().lower() == "true"
            print(f"  {segment_id}  {confidence:.0%}{'  (already published)' if published else ''}")

    if args.dry_run:
        return 0
    write_csv_atomic(detections_path, header, output_rows)
    print(f"\nWrote {detections_path} ({len(output_rows)} detection(s) in total).")
    print("Next: python3 scripts/validate_metadata.py && python3 scripts/build_web_metadata.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
