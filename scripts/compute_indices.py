#!/usr/bin/env python3
"""Acoustic indices for every minute of each processed hour.

Ecoacoustic indices sum up a minute of sound in a few numbers: how varied, busy
and bird-like it is. They are kept with the metadata so the website can later
describe each place's sound (how strong the dawn chorus is, insect nights, quiet
hours) and compare places. Nothing is published by this script.

Source: each hour's lossless working WAV (audio/working_wav/<SITE>/<segment_id>.wav),
mixed to mono. The Opus listening copies are not used, because lossy coding
removes quiet detail that some indices respond to. Hours without a working WAV
are skipped and listed.

Only complete clock minutes are used (an hour that starts at 15:33:46 gives
15:34:00 onwards), so every value covers exactly 60 s and minutes line up
across recordings.

Output: <metadata>/acoustic_indices.csv, one row per minute (columns in HEADER).
Re-running skips hours that already have rows; --force works them out again and
replaces their rows. Rows of other hours are kept.

    python3 scripts/compute_indices.py --archive-root /media/tom/archive/soundscape_atlas --dry-run
    python3 scripts/compute_indices.py --archive-root ... --only AU_NSW_BOOMERANG_FALLS
    python3 scripts/compute_indices.py --archive-root ... --session AU_NSW_BOOMERANG_FALLS_20240822_1533

The indices, with the default settings of the R package soundecology
(Villanueva-Rivera & Pijanowski) and seewave (Sueur). Absolute values can
differ a little from other software, so compare them within the atlas:

  aci       Acoustic Complexity Index (Pieretti et al. 2011). Spectrogram with a
            512-point Hann window, no overlap, 0 Hz to Nyquist. For each
            frequency bin and each 5 s step: the summed change in amplitude
            between neighbouring frames divided by the summed amplitude; summed
            over steps and bins. Higher = more rapidly changing sound (birdsong);
            steady noise (rain, wind, insects' drone) scores low.
  adi       Acoustic Diversity Index (Villanueva-Rivera et al. 2011). 10 Hz
            spectrogram in dB relative to the minute's loudest cell; for each
            1 kHz band from 0 to 10 kHz, the share of cells above -50 dB; Shannon
            entropy (natural log) of those shares. Higher = sound spread over
            more bands.
  aei       Acoustic Evenness Index: Gini coefficient of the same shares.
            Higher = sound concentrated in few bands.
  bi        Bioacoustic Index (Boelman et al. 2007). Mean spectrum (power mean
            of the 512-point spectrogram, in dB); area above its minimum between
            2 and 8 kHz: sum of (level - minimum level) x (bins per Hz).
            Higher = louder bird band.
  ndsi      Normalised Difference Soundscape Index (Kasten et al. 2012). Welch
            spectrum (1024 points); (B - A) / (B + A) with A the power from 1 to
            2 kHz (engines, traffic) and B from 2 to 11 kHz. -1 to 1; higher =
            more biophony than anthropophony.
  h         Acoustic Entropy (Sueur et al. 2008): temporal entropy of the
            Hilbert amplitude envelope times spectral entropy of the mean
            512-point spectrum, both normalised. 0 (one pure tone or a single
            click) to 1 (even noise).
  rms_dbfs  RMS level in dB relative to digital full scale. Not calibrated and
            recorder gain differs between sessions, so compare it within a
            session only.

Requires ffmpeg and ffprobe on PATH, numpy and scipy.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np
from scipy import fft, signal

sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
from ingest_recordings import default_metadata_dir, read_csv, require_metadata_dir, write_csv_atomic  # noqa: E402

WORKING_DIR = Path("audio", "working_wav")
OUTPUT_NAME = "acoustic_indices.csv"
HEADER = ["segment_id", "minute_start_local", "aci", "adi", "aei", "bi", "ndsi", "h", "rms_dbfs"]
FORMATS = {"aci": "{:.2f}", "adi": "{:.4f}", "aei": "{:.4f}", "bi": "{:.3f}", "ndsi": "{:.4f}", "h": "{:.4f}", "rms_dbfs": "{:.2f}"}
MINUTE = 60

SPEC_WINDOW = 512          # ACI, BI and the spectral part of H
ACI_STEP_SEC = 5
ADI_HZ_PER_BIN = 10
ADI_BAND_HZ = 1000
ADI_MAX_HZ = 10000
ADI_DB_THRESHOLD = -50.0
BI_BAND = (2000, 8000)
NDSI_WINDOW = 1024
NDSI_ANTHRO = (1000, 2000)
NDSI_BIO = (2000, 11000)


# ---------------------------------------------------------------- the indices

def magnitude_spectrogram(x: np.ndarray, size: int) -> np.ndarray:
    """|STFT|, Hann window, no overlap: frames x bins, from DC up to (not including) Nyquist."""
    count = len(x) // size
    frames = x[: count * size].reshape(count, size) * signal.get_window("hann", size).astype(np.float32)
    return np.abs(fft.rfft(frames, axis=1))[:, : size // 2]


def normalised_entropy(values: np.ndarray) -> Optional[float]:
    total = float(values.sum())
    if total <= 0 or len(values) < 2:
        return None
    p = values[values > 0] / total
    return float(-(p * np.log(p)).sum() / np.log(len(values)))


def gini(values: np.ndarray) -> float:
    """As ineq::Gini in R (no small-sample correction)."""
    x = np.sort(values)
    n = len(x)
    if n == 0 or x.sum() <= 0:
        return 0.0
    return float((2 * (np.arange(1, n + 1) * x).sum() / x.sum() - (n + 1)) / n)


def aci(spec: np.ndarray, sample_rate: int) -> float:
    per_step = int(ACI_STEP_SEC / (SPEC_WINDOW / sample_rate))
    total = 0.0
    for step in range(spec.shape[0] // per_step):
        block = spec[step * per_step:(step + 1) * per_step].astype(np.float64)
        change = np.abs(np.diff(block, axis=0)).sum(axis=0)
        amount = block.sum(axis=0)
        total += float(np.divide(change, amount, out=np.zeros_like(change), where=amount > 0).sum())
    return total


def adi_aei(x: np.ndarray, sample_rate: int) -> Tuple[Optional[float], Optional[float]]:
    size = sample_rate // ADI_HZ_PER_BIN
    spec = magnitude_spectrogram(x, size)
    loudest = float(spec.max()) if spec.size else 0.0
    if loudest <= 0:
        return None, None
    # above -50 dB re the loudest cell, i.e. amplitude above loudest * 10^(-50/20)
    floor = loudest * 10 ** (ADI_DB_THRESHOLD / 20)
    hz_per_bin = sample_rate / size
    shares = []
    for low in range(0, ADI_MAX_HZ, ADI_BAND_HZ):
        band = spec[:, int(round(low / hz_per_bin)):int(round((low + ADI_BAND_HZ) / hz_per_bin))]
        shares.append(float((band > floor).mean()) if band.size else 0.0)
    shares_array = np.array(shares)
    if shares_array.sum() <= 0:
        return 0.0, 0.0
    p = shares_array[shares_array > 0] / shares_array.sum()
    return float(-(p * np.log(p)).sum()), gini(shares_array)


def bi(spec: np.ndarray, sample_rate: int) -> Optional[float]:
    power = (spec.astype(np.float64) ** 2).mean(axis=0)
    loudest = float(power.max())
    if loudest <= 0:
        return None
    level = 10 * np.log10(np.maximum(power, loudest * 1e-30) / loudest)
    bins = spec.shape[1]
    freqs = np.arange(bins) * (sample_rate / SPEC_WINDOW)
    band = level[(freqs >= BI_BAND[0]) & (freqs <= BI_BAND[1])]
    if band.size == 0:
        return None
    return float(((band - band.min()) * (bins / (sample_rate / 2))).sum())


def ndsi(x: np.ndarray, sample_rate: int) -> Optional[float]:
    freqs, psd = signal.welch(x, fs=sample_rate, nperseg=NDSI_WINDOW)
    anthro = float(psd[(freqs >= NDSI_ANTHRO[0]) & (freqs < NDSI_ANTHRO[1])].sum())
    bio = float(psd[(freqs >= NDSI_BIO[0]) & (freqs < NDSI_BIO[1])].sum())
    if anthro + bio <= 0:
        return None
    return (bio - anthro) / (bio + anthro)


def acoustic_entropy(x: np.ndarray, spec: np.ndarray) -> Optional[float]:
    temporal = normalised_entropy(np.abs(signal.hilbert(x)))
    spectral = normalised_entropy(spec.astype(np.float64).mean(axis=0))
    if temporal is None or spectral is None:
        return None
    return temporal * spectral


def minute_indices(x: np.ndarray, sample_rate: int) -> Dict[str, Optional[float]]:
    """All indices for one minute of mono audio (float, -1 to 1)."""
    mean_square = float(np.mean(x.astype(np.float64) ** 2))
    if mean_square <= 0:  # digital silence: nothing to measure
        return {key: None for key in FORMATS}
    spec = magnitude_spectrogram(x, SPEC_WINDOW)
    adi_value, aei_value = adi_aei(x, sample_rate)
    return {
        "aci": aci(spec, sample_rate),
        "adi": adi_value,
        "aei": aei_value,
        "bi": bi(spec, sample_rate),
        "ndsi": ndsi(x, sample_rate),
        "h": acoustic_entropy(x, spec),
        "rms_dbfs": 10 * np.log10(mean_square),
    }


# ---------------------------------------------------------------- audio

def probe(path: Path) -> Tuple[int, int]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels",
         "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"ffprobe exit {result.returncode}")
    stream = json.loads(result.stdout)["streams"][0]
    return int(stream["sample_rate"]), int(stream["channels"])


def mono_filter(channels: int) -> List[str]:
    if channels <= 1:
        return []
    gain = 1 / channels
    return ["-af", "pan=mono|c0=" + "+".join(f"{gain:.6f}*c{i}" for i in range(channels))]


def wav_path(archive_root: Path, segment: Dict[str, str]) -> Path:
    return archive_root / WORKING_DIR / segment["site_id"] / f"{segment['segment_id']}.wav"


def segment_rows(archive_root: Path, segment: Dict[str, str]) -> List[Dict[str, str]]:
    """Index rows for every complete clock minute of one hour."""
    wav = wav_path(archive_root, segment)
    start = datetime.fromisoformat(segment["segment_start_local"]).replace(microsecond=0)
    offset = (MINUTE - start.second) % MINUTE
    sample_rate, channels = probe(wav)
    minute_bytes = MINUTE * sample_rate * 4
    rows: List[Dict[str, str]] = []
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-i", str(wav), *mono_filter(channels),
             "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
            stdout=subprocess.PIPE, stderr=errors, bufsize=1 << 20,
        )
        assert process.stdout is not None
        try:
            process.stdout.read(offset * sample_rate * 4)
            minute = 0
            while True:
                chunk = process.stdout.read(minute_bytes)
                if len(chunk) < minute_bytes:
                    break
                values = minute_indices(np.frombuffer(chunk, dtype="<f4"), sample_rate)
                row = {
                    "segment_id": segment["segment_id"],
                    "minute_start_local": (start + timedelta(seconds=offset + minute * MINUTE)).isoformat(),
                }
                for key, fmt in FORMATS.items():
                    row[key] = "" if values[key] is None else fmt.format(values[key])
                rows.append(row)
                minute += 1
        finally:
            process.stdout.close()
            code = process.wait()
        if code != 0:
            errors.seek(0)
            raise RuntimeError(errors.read().decode("utf-8", "replace").strip() or f"ffmpeg exit {code}")
    return rows


# ---------------------------------------------------------------- running

def run(
    archive_root: Path,
    metadata_dir: Path,
    segments: Iterable[Dict[str, str]],
    jobs: int = 2,
    force: bool = False,
    dry_run: bool = False,
    log: Callable[[str], None] = print,
) -> int:
    """Work out the indices for these hours and merge them into acoustic_indices.csv.

    Returns the number of hours that failed. The CSV is rewritten after each hour,
    so an interrupted run keeps what it finished.
    """
    path = metadata_dir / OUTPUT_NAME
    existing = read_csv(path)[1] if path.exists() else []
    done = {row["segment_id"] for row in existing}

    todo, missing, skipped = [], [], 0
    for segment in segments:
        if segment["segment_id"] in done and not force:
            skipped += 1
        elif not wav_path(archive_root, segment).is_file():
            missing.append(segment["segment_id"])
        else:
            todo.append(segment)
    log(f"Indices: {len(todo)} hour(s) to work out, {skipped} already done"
        + (f", {len(missing)} without a working WAV (skipped)" if missing else ""))
    for segment_id in missing[:10]:
        log(f"  no working WAV: {segment_id}")
    if dry_run or not todo:
        return 0

    rows_by_segment = {}
    for row in existing:
        rows_by_segment.setdefault(row["segment_id"], []).append(row)

    def save() -> None:
        rows = [row for segment_id in sorted(rows_by_segment) for row in rows_by_segment[segment_id]]
        write_csv_atomic(path, HEADER, rows)

    failed = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        futures = {pool.submit(segment_rows, archive_root, segment): (segment, time.time()) for segment in todo}
        for i, future in enumerate(as_completed(futures), 1):
            segment, _ = futures[future]
            try:
                rows = future.result()
            except Exception as exc:  # one bad file must not stop the rest
                failed += 1
                log(f"  [{i}/{len(todo)}] FAILED {segment['segment_id']}: {exc}")
                continue
            rows_by_segment[segment["segment_id"]] = rows
            save()
            log(f"  [{i}/{len(todo)}] {segment['segment_id']}: {len(rows)} minute(s)")
    log(f"Indices done in {(time.time() - started) / 60:.1f} min, {failed} error(s); written to {path}")
    return failed


def main() -> int:
    parser = argparse.ArgumentParser(description="Acoustic indices per minute, from the working WAVs")
    parser.add_argument("--archive-root", required=True, help="archive folder that holds audio/working_wav/")
    parser.add_argument("--metadata-dir", default=default_metadata_dir(), help="metadata folder (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--only", action="append", default=[], metavar="SITE_ID", help="limit to a site (repeatable)")
    parser.add_argument("--session", action="append", default=[], metavar="SESSION_ID", help="limit to a session (repeatable)")
    parser.add_argument("--segment", action="append", default=[], metavar="SEGMENT_ID", help="limit to one hour (repeatable)")
    parser.add_argument("--jobs", type=int, default=2, help="hours worked on at once (default 2)")
    parser.add_argument("--force", action="store_true", help="work out hours that already have rows again")
    parser.add_argument("--dry-run", action="store_true", help="list what would be done")
    args = parser.parse_args()

    metadata_dir = require_metadata_dir(args.metadata_dir)
    archive_root = Path(args.archive_root).expanduser()
    if not (archive_root / WORKING_DIR).is_dir():
        print(f"error: {archive_root / WORKING_DIR} does not exist", file=sys.stderr)
        return 1
    _, segments = read_csv(metadata_dir / "segments.csv")
    chosen = [
        segment for segment in segments
        if (not args.only or segment["site_id"] in args.only)
        and (not args.session or segment["session_id"] in args.session)
        and (not args.segment or segment["segment_id"] in args.segment)
    ]
    if not chosen:
        print("No hours match.", file=sys.stderr)
        return 1
    failed = run(archive_root, metadata_dir, chosen, jobs=args.jobs, force=args.force, dry_run=args.dry_run)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
