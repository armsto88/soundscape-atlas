#!/usr/bin/env python3
"""Build website-ready JSON payload from metadata CSV files."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Tuple


def read_csv(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def to_bool(value: str) -> bool:
    return str(value).strip().lower() == "true"


def split_published(segments: List[dict]) -> Tuple[List[dict], List[dict], List[Tuple[str, str]]]:
    """Return (published, unpublished, unrecognised values).

    Only an explicit "true" publishes a segment. Anything else, including blanks
    and typos, stays private; unrecognised values are reported so they can be fixed.
    """
    published, unpublished, unrecognised = [], [], []
    for segment in segments:
        raw = str(segment.get("published") or "").strip()
        if raw.lower() not in ("true", "false", ""):
            unrecognised.append((segment.get("segment_id", ""), raw))
        (published if raw.lower() == "true" else unpublished).append(segment)
    return published, unpublished, unrecognised


def build_payload(metadata_dir: Path, segments: List[dict]) -> dict:
    sites = read_csv(metadata_dir / "sites.csv")
    sessions = read_csv(metadata_dir / "sessions.csv")
    detections = read_csv(metadata_dir / "birdnet_detections.csv")

    sessions_by_id = {s["session_id"]: s for s in sessions}
    sites_by_id = {s["site_id"]: s for s in sites}

    detections_by_segment: Dict[str, List[dict]] = defaultdict(list)
    species_count_by_segment: Dict[str, Counter] = defaultdict(Counter)
    for detection in detections:
        segment_id = detection.get("segment_id", "")
        detections_by_segment[segment_id].append(detection)
        common_name = (detection.get("common_name") or "Unknown").strip()
        species_count_by_segment[segment_id][common_name] += 1

    web_segments = []
    for segment in segments:
        segment_id = segment["segment_id"]
        session = sessions_by_id.get(segment.get("session_id", ""), {})
        site = sites_by_id.get(segment.get("site_id", ""), {})

        top_species = [
            {"name": name, "count": count}
            for name, count in species_count_by_segment[segment_id].most_common(6)
        ]

        segment_detections = []
        for detection in detections_by_segment[segment_id]:
            start_sec_raw = detection.get("start_sec")
            end_sec_raw = detection.get("end_sec")
            try:
                start_sec = float(start_sec_raw) if start_sec_raw not in (None, "") else None
            except ValueError:
                start_sec = None
            try:
                end_sec = float(end_sec_raw) if end_sec_raw not in (None, "") else None
            except ValueError:
                end_sec = None

            segment_detections.append(
                {
                    "detection_id": detection.get("detection_id"),
                    "common_name": detection.get("common_name"),
                    "scientific_name": detection.get("scientific_name"),
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "confidence": detection.get("confidence"),
                    "model": detection.get("model"),
                    "review_status": detection.get("review_status"),
                }
            )

        segment_detections.sort(
            key=lambda item: item["start_sec"] if item["start_sec"] is not None else -1
        )

        listening_opus_path = segment.get("listening_opus_path")
        spectrogram_image_url = ""
        if listening_opus_path and listening_opus_path.lower().endswith(".opus"):
            spectrogram_image_url = listening_opus_path[:-5] + ".png"

        web_segments.append(
            {
                "segment_id": segment_id,
                "session_id": segment.get("session_id"),
                "site_id": segment.get("site_id"),
                "site_name": site.get("site_name"),
                "latitude": site.get("latitude"),
                "longitude": site.get("longitude"),
                "segment_start_local": segment.get("segment_start_local"),
                "segment_end_local": segment.get("segment_end_local"),
                "local_date": segment.get("local_date"),
                "local_hour": segment.get("local_hour"),
                "season": segment.get("season"),
                "sound_quality": segment.get("sound_quality"),
                "wind_level": segment.get("wind_level"),
                "rain_present": to_bool(segment.get("rain_present", "false")),
                "water_present": to_bool(segment.get("water_present", "false")),
                "anthropogenic_noise": segment.get("anthropogenic_noise"),
                "published": to_bool(segment.get("published", "false")),
                "featured": to_bool(segment.get("featured", "false")),
                "notes": segment.get("notes"),
                "listening_opus_path": listening_opus_path,
                "spectrogram_image_url": spectrogram_image_url,
                "public_url": segment.get("public_url"),
                "session": {
                    "timezone": session.get("timezone"),
                    "recorder": session.get("recorder"),
                    "microphones": session.get("microphones"),
                    "sample_rate_hz": session.get("sample_rate_hz"),
                    "bit_depth": session.get("bit_depth"),
                    "channels": session.get("channels"),
                    "weather_notes": session.get("weather_notes"),
                    "field_notes": session.get("field_notes"),
                    "operator": session.get("operator"),
                    "copyright_owner": session.get("copyright_owner"),
                    "license": session.get("license"),
                },
                "site": {
                    "country_code": site.get("country_code"),
                    "region_code": site.get("region_code"),
                    "locality": site.get("locality"),
                    "elevation_m": site.get("elevation_m"),
                    "habitat": site.get("habitat"),
                    "biome": site.get("biome"),
                    "public_location_precision": site.get("public_location_precision"),
                    "description": site.get("description"),
                    "is_sensitive": to_bool(site.get("is_sensitive", "false")),
                },
                "detection_count": len(detections_by_segment[segment_id]),
                "top_species": top_species,
                "detections": segment_detections,
            }
        )

    # Totals describe only what is published, so hidden recordings are not
    # revealed through the counts either.
    return {
        "generated_from": str(metadata_dir),
        "sites_count": len({s["site_id"] for s in web_segments}),
        "sessions_count": len({s["session_id"] for s in web_segments}),
        "segments_count": len(web_segments),
        "detections_count": sum(s["detection_count"] for s in web_segments),
        "segments": web_segments,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build website metadata JSON")
    parser.add_argument("--metadata-dir", default="metadata")
    parser.add_argument("--output", default="website/api/data.json")
    args = parser.parse_args()

    metadata_dir = Path(args.metadata_dir)
    output_path = Path(args.output)

    published, unpublished, unrecognised = split_published(read_csv(metadata_dir / "segments.csv"))
    for segment_id, value in unrecognised:
        print(
            f"warning: segments.csv {segment_id}: published={value!r} is not true/false; treated as unpublished",
            file=sys.stderr,
        )

    payload = build_payload(metadata_dir, published)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8", newline="") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")

    print(
        f"Wrote {output_path} with {payload['segments_count']} published segment(s); "
        f"{len(unpublished)} unpublished segment(s) left out."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
