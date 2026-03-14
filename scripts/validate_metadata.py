#!/usr/bin/env python3
"""Validate Soundscape Atlas metadata CSV files.

Checks performed:
1) Required columns exist for each table.
2) Foreign key references are not broken.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Sequence, Set, Tuple


TABLE_FILES = {
    "sites": "sites.csv",
    "sessions": "sessions.csv",
    "segments": "segments.csv",
    "birdnet_detections": "birdnet_detections.csv",
}


REQUIRED_COLUMNS = {
    "sites": [
        "site_id",
        "site_name",
        "country_code",
        "region_code",
        "locality",
        "latitude",
        "longitude",
        "elevation_m",
        "habitat",
        "biome",
        "public_location_precision",
        "description",
        "is_sensitive",
    ],
    "sessions": [
        "session_id",
        "site_id",
        "raw_file_name",
        "start_datetime_local",
        "end_datetime_local",
        "timezone",
        "recorder",
        "microphones",
        "sample_rate_hz",
        "bit_depth",
        "channels",
        "weather_notes",
        "field_notes",
        "operator",
        "copyright_owner",
        "license",
    ],
    "segments": [
        "segment_id",
        "session_id",
        "site_id",
        "segment_start_local",
        "segment_end_local",
        "local_date",
        "local_hour",
        "year",
        "month",
        "season",
        "listening_opus_path",
        "public_url",
        "published",
        "featured",
        "sound_quality",
        "wind_level",
        "rain_present",
        "water_present",
        "anthropogenic_noise",
        "notes",
    ],
    "birdnet_detections": [
        "detection_id",
        "segment_id",
        "common_name",
        "scientific_name",
        "start_sec",
        "end_sec",
        "confidence",
        "model",
        "review_status",
    ],
}


def read_csv_rows(path: Path) -> Tuple[List[str], List[Tuple[int, Dict[str, str]]]]:
    """Return CSV header and rows with source line numbers."""
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        header = reader.fieldnames or []
        rows: List[Tuple[int, Dict[str, str]]] = []
        for line_number, row in enumerate(reader, start=2):
            rows.append((line_number, row))
    return header, rows


def find_missing_columns(header: Sequence[str], required: Sequence[str]) -> List[str]:
    existing = set(header)
    return [column for column in required if column not in existing]


def is_blank(value: str | None) -> bool:
    return value is None or value.strip() == ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Soundscape Atlas metadata CSVs")
    parser.add_argument(
        "--metadata-dir",
        default="metadata",
        help="Directory containing sites.csv, sessions.csv, segments.csv, birdnet_detections.csv",
    )
    args = parser.parse_args()

    metadata_dir = Path(args.metadata_dir)
    errors: List[str] = []

    loaded_headers: Dict[str, List[str]] = {}
    loaded_rows: Dict[str, List[Tuple[int, Dict[str, str]]]] = {}

    for table_name, filename in TABLE_FILES.items():
        csv_path = metadata_dir / filename
        if not csv_path.exists():
            errors.append(f"missing file: {csv_path}")
            continue

        try:
            header, rows = read_csv_rows(csv_path)
        except Exception as exc:  # pragma: no cover
            errors.append(f"failed to read {csv_path}: {exc}")
            continue

        missing_columns = find_missing_columns(header, REQUIRED_COLUMNS[table_name])
        if missing_columns:
            errors.append(
                f"{filename}: missing required columns: {', '.join(missing_columns)}"
            )

        loaded_headers[table_name] = header
        loaded_rows[table_name] = rows

    # Stop here if required files/columns are not in place.
    if errors:
        print("Metadata validation failed.")
        for error in errors:
            print(f"- {error}")
        return 1

    site_ids: Set[str] = {
        row["site_id"].strip()
        for _, row in loaded_rows["sites"]
        if not is_blank(row.get("site_id"))
    }

    session_ids: Set[str] = {
        row["session_id"].strip()
        for _, row in loaded_rows["sessions"]
        if not is_blank(row.get("session_id"))
    }
    session_to_site: Dict[str, str] = {
        row["session_id"].strip(): row["site_id"].strip()
        for _, row in loaded_rows["sessions"]
        if not is_blank(row.get("session_id")) and not is_blank(row.get("site_id"))
    }

    segment_ids: Set[str] = {
        row["segment_id"].strip()
        for _, row in loaded_rows["segments"]
        if not is_blank(row.get("segment_id"))
    }

    for line_number, row in loaded_rows["sessions"]:
        session_id = (row.get("session_id") or "").strip()
        site_id = (row.get("site_id") or "").strip()
        if is_blank(site_id):
            errors.append(f"sessions.csv:{line_number}: blank site_id for session_id={session_id}")
        elif site_id not in site_ids:
            errors.append(
                f"sessions.csv:{line_number}: site_id={site_id} not found in sites.csv"
            )

    for line_number, row in loaded_rows["segments"]:
        segment_id = (row.get("segment_id") or "").strip()
        session_id = (row.get("session_id") or "").strip()
        site_id = (row.get("site_id") or "").strip()

        if is_blank(session_id):
            errors.append(
                f"segments.csv:{line_number}: blank session_id for segment_id={segment_id}"
            )
        elif session_id not in session_ids:
            errors.append(
                f"segments.csv:{line_number}: session_id={session_id} not found in sessions.csv"
            )

        if is_blank(site_id):
            errors.append(f"segments.csv:{line_number}: blank site_id for segment_id={segment_id}")
        elif site_id not in site_ids:
            errors.append(
                f"segments.csv:{line_number}: site_id={site_id} not found in sites.csv"
            )

        if session_id in session_to_site and not is_blank(site_id):
            expected_site = session_to_site[session_id]
            if site_id != expected_site:
                errors.append(
                    "segments.csv:"
                    f"{line_number}: site_id={site_id} does not match "
                    f"session_id={session_id} site_id={expected_site}"
                )

    for line_number, row in loaded_rows["birdnet_detections"]:
        detection_id = (row.get("detection_id") or "").strip()
        segment_id = (row.get("segment_id") or "").strip()
        if is_blank(segment_id):
            errors.append(
                "birdnet_detections.csv:"
                f"{line_number}: blank segment_id for detection_id={detection_id}"
            )
        elif segment_id not in segment_ids:
            errors.append(
                "birdnet_detections.csv:"
                f"{line_number}: segment_id={segment_id} not found in segments.csv"
            )

    if errors:
        print("Metadata validation failed.")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Metadata validation passed: required columns and foreign keys are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
