#!/usr/bin/env python3
"""Check BirdNET detections by ear, then turn the checks into review statuses
and per-species confidence thresholds.

Two kinds of check, on a local web page (serve):

  * Species sample: for each species, a random sample of detections spread
    over the score range, taken from the raw BirdNET results (so also below
    the import threshold). Scores are hidden while you listen. From the
    right/wrong marks, apply estimates how often BirdNET is right at each score
    (logistic regression on the logit of the score) and sets each species'
    threshold where it is right --target of the time (default 90%), following
    Wood & Kahl (2024), "Guidelines for appropriate use of BirdNET scores and
    other detector outputs", Journal of Ornithology.
  * Hour check: for each published hour (or the hours given with --hours),
    each species' best imported detection in that hour. Right confirms that
    species in that hour, wrong rejects it.

Marks are saved as you click, in <metadata>/birdnet_reviews.csv.

  serve   start the page on http://127.0.0.1:8765 (this computer only)
  apply   set review_status in birdnet_detections.csv (confirmed / rejected)
          and write species_thresholds.csv to the metadata folder; then
          re-import with import_birdnet.py --species-thresholds to use them.
          A threshold of 1.00 hides the species.

Examples:
  python3 scripts/review_birdnet.py serve --archive-root /media/USER/archive/soundscape_atlas \\
      --only AU_NSW_BOOMERANG_FALLS --top 10
  python3 scripts/review_birdnet.py apply --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import subprocess
import sys
import threading
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional, Tuple

sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
from ingest_recordings import default_metadata_dir, read_csv, require_metadata_dir, write_csv_atomic  # noqa: E402
from import_birdnet import (  # noqa: E402
    NO_DETECTION_CLASSES, NON_BIRD_CLASSES, find_result_files, parse_results, species_key,
)

REVIEWS = "birdnet_reviews.csv"
THRESHOLDS = "species_thresholds.csv"
REVIEW_FIELDS = ["item_id", "kind", "segment_id", "scientific_name", "common_name", "taxon_group",
                 "start_sec", "end_sec", "confidence", "verdict", "reviewed_at"]
THRESHOLD_FIELDS = ["scientific_name", "common_name", "threshold", "target_precision", "method",
                    "n_reviewed", "n_right", "updated"]
VERDICTS = ("right", "wrong", "unsure")
STATUS = {"right": "confirmed", "wrong": "rejected"}
BANDS = [(0.25, 0.5), (0.5, 0.75), (0.75, 0.9), (0.9, 1.01)]
PAD = 1.0  # seconds of context either side of the detection


# --- items -----------------------------------------------------------------

def clip_key(segment_id: str, start: float, end: float) -> str:
    return hashlib.sha1(f"{segment_id}:{start:.2f}:{end:.2f}".encode()).hexdigest()[:16]


def make_item(kind: str, det: dict, segments: Dict[str, dict], sites: Dict[str, dict], count: int = 0) -> dict:
    seg = segments[det["segment_id"]]
    key = species_key(det["common"], det["scientific"])
    item_id = (f"sample:{det['segment_id']}:{key}:{int(round(det['start'] * 10))}" if kind == "sample"
               else f"hour:{det['segment_id']}:{key}")
    clip_from = max(0.0, det["start"] - PAD)
    length = det["end"] + PAD - clip_from
    try:
        when = datetime.fromisoformat(seg["segment_start_local"]) + timedelta(seconds=det["start"])
        label = when.strftime("%Y-%m-%d %H:%M:%S")
        hour = datetime.fromisoformat(seg["segment_start_local"]).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        label, hour = f"{det['start']:.0f} s", det["segment_id"]
    return {
        "id": item_id, "kind": kind, "segment_id": det["segment_id"], "species_key": key,
        "scientific": det["scientific"], "common": det["common"], "group": det.get("group", ""),
        "start": det["start"], "end": det["end"], "confidence": det["confidence"], "count": count,
        "clip": clip_key(det["segment_id"], det["start"], det["end"]),
        "clip_from": clip_from, "clip_length": length,
        "win_from": (det["start"] - clip_from) / length, "win_to": (det["end"] - clip_from) / length,
        "site": sites.get(seg["site_id"], {}).get("site_name", seg["site_id"]), "time": label, "hour": hour,
    }


def sample_items(results: List[Path], segments, sites, only, top, species_filter, per_species, min_conf, seed):
    by_species: Dict[str, List[dict]] = defaultdict(list)
    for path in find_result_files(results):
        detections, problem = parse_results(path)
        if problem:
            continue
        for d in detections:
            name = d.common.strip().lower()
            seg = segments.get(d.segment_id)
            if (name in NON_BIRD_CLASSES or name in NO_DETECTION_CLASSES or seg is None
                    or d.confidence < min_conf or (only and only not in (seg["site_id"], seg["session_id"]))):
                continue
            by_species[species_key(d.common, d.scientific)].append({
                "segment_id": d.segment_id, "common": d.common, "scientific": d.scientific,
                "start": d.start, "end": d.end, "confidence": d.confidence, "group": d.group})
    order = sorted(by_species, key=lambda k: -len(by_species[k]))
    if species_filter:
        wanted = {s.strip().lower() for s in species_filter}
        order = [k for k in order if k in wanted or by_species[k][0]["common"].strip().lower() in wanted]
    if top:
        order = order[:top]
    per_band = max(1, per_species // len(BANDS))
    items = []
    for key in order:
        rng = random.Random(f"{seed}:{key}")  # the same sample every time for the same results
        picked = []
        for lo, hi in BANDS:
            inband = sorted((d for d in by_species[key] if lo <= d["confidence"] < hi),
                            key=lambda d: (d["segment_id"], d["start"]))
            picked += rng.sample(inband, min(per_band, len(inband)))
        rng.shuffle(picked)
        items += [make_item("sample", d, segments, sites) for d in picked]
    return items


def hour_items(metadata_dir: Path, segments, sites, only, hours):
    _, rows = read_csv(metadata_dir / "birdnet_detections.csv")
    if hours:
        chosen = set(hours)
    else:
        chosen = {s for s, row in segments.items() if row.get("published", "").strip().lower() == "true"}
    chosen = {s for s in chosen if s in segments and (not only or only in (segments[s]["site_id"], segments[s]["session_id"]))}
    best: Dict[Tuple[str, str], dict] = {}
    count: Counter = Counter()
    for row in rows:
        if row["segment_id"] not in chosen:
            continue
        try:
            det = {"segment_id": row["segment_id"], "common": row["common_name"], "scientific": row["scientific_name"],
                   "start": float(row["start_sec"]), "end": float(row["end_sec"]), "confidence": float(row["confidence"])}
        except ValueError:
            continue
        key = (row["segment_id"], species_key(det["common"], det["scientific"]))
        count[key] += 1
        if key not in best or det["confidence"] > best[key]["confidence"]:
            best[key] = det
    ordered = sorted(best.items(), key=lambda kv: (kv[0][0], -kv[1]["confidence"]))
    return [make_item("hour", det, segments, sites, count[key]) for key, det in ordered]


# --- serving ---------------------------------------------------------------

def spectrogram_image(ffmpeg_input: List[str], out: Path, sr: int = 32000, top_hz: int = 12000) -> bool:
    """Draw a clip's spectrogram (0-12 kHz) with numpy/matplotlib; False if they are missing."""
    try:
        import numpy as np
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False
    pcm = subprocess.run(ffmpeg_input + ["-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(pcm, dtype=np.float32)
    n, hop = 1024, 256
    if x.size < n:
        return False
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    power = np.abs(np.fft.rfft(frames, axis=1)[:, : int(top_hz * n / sr)]) ** 2
    db = 10 * np.log10(power.T + 1e-12)
    vmax = float(np.percentile(db, 99.8))
    plt.imsave(out, db, cmap="magma", vmin=vmax - 60, vmax=vmax, origin="lower", pil_kwargs={"quality": 85})
    return True


class Review:
    def __init__(self, archive_root: Path, metadata_dir: Path, items: List[dict], segments: Dict[str, dict]):
        self.archive_root = archive_root
        self.path = metadata_dir / REVIEWS
        self.items = {item["id"]: item for item in items}
        self.clips = {item["clip"]: item for item in items}
        self.segments = segments
        self.cache = archive_root / "birdnet" / "review_clips"
        self.lock = threading.Lock()
        # Separate queues, so a clip you press play on never waits behind spectrograms.
        self.ffmpeg = {"mp3": threading.Semaphore(2), "jpg": threading.Semaphore(3)}
        self.reviews: Dict[str, dict] = {}
        if self.path.exists():
            _, rows = read_csv(self.path)
            self.reviews = {row["item_id"]: row for row in rows}

    def source(self, segment_id: str) -> Optional[Path]:
        seg = self.segments[segment_id]
        wav = self.archive_root / "audio" / "working_wav" / seg["site_id"] / f"{segment_id}.wav"
        if wav.exists():
            return wav
        opus = self.archive_root / seg.get("listening_opus_path", "")
        return opus if seg.get("listening_opus_path") and opus.exists() else None

    def clip(self, key: str, ext: str) -> Optional[Path]:
        item = self.clips.get(key)
        if item is None:
            return None
        out = self.cache / f"{key}.{ext}"
        if out.exists():
            return out
        src = self.source(item["segment_id"])
        if src is None:
            return None
        self.cache.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(f"{key}.{threading.get_ident()}.tmp.{ext}")
        cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
               "-ss", f"{item['clip_from']:.3f}", "-t", f"{item['clip_length']:.3f}", "-i", str(src)]
        with self.ffmpeg[ext]:
            if ext == "mp3":
                ok = subprocess.run(cmd + ["-c:a", "libmp3lame", "-b:a", "128k", str(tmp)]).returncode == 0
            else:
                ok = spectrogram_image(cmd, tmp) or subprocess.run(cmd + [
                    "-lavfi", "aformat=channel_layouts=mono,showspectrumpic=s=1024x512:legend=0:color=magma"
                    ":stop=12000:drange=70,scale=640:200", "-frames:v", "1", str(tmp)]).returncode == 0
            ok = ok and tmp.exists()
        if not ok:
            tmp.unlink(missing_ok=True)
            return None
        tmp.replace(out)
        return out

    def mark(self, item_id: str, verdict: str) -> bool:
        item = self.items.get(item_id)
        if item is None or verdict not in VERDICTS + ("",):
            return False
        with self.lock:
            if verdict:
                self.reviews[item_id] = {
                    "item_id": item_id, "kind": item["kind"], "segment_id": item["segment_id"],
                    "scientific_name": item["scientific"], "common_name": item["common"],
                    "taxon_group": item["group"], "start_sec": f"{item['start']:.2f}", "end_sec": f"{item['end']:.2f}",
                    "confidence": f"{item['confidence']:.4f}", "verdict": verdict,
                    "reviewed_at": datetime.now().isoformat(timespec="seconds"),
                }
            else:
                self.reviews.pop(item_id, None)
            write_csv_atomic(self.path, REVIEW_FIELDS, sorted(self.reviews.values(), key=lambda r: r["item_id"]))
        return True

    def payload(self) -> dict:
        public = ("id", "kind", "segment_id", "species_key", "scientific", "common", "group", "count",
                  "clip", "win_from", "win_to", "site", "time", "hour")
        items = [{k: item[k] for k in public} for item in self.items.values()]
        return {
            "sample": [i for i in items if i["kind"] == "sample"],
            "hours": [i for i in items if i["kind"] == "hour"],
            "verdicts": {k: r["verdict"] for k, r in self.reviews.items() if k in self.items},
            "reviews_file": str(self.path),
        }


def make_handler(review: Review):
    class Handler(BaseHTTPRequestHandler):
        def send(self, code: int, body: bytes, kind: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store" if kind.startswith(("application", "text")) else "max-age=86400")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/":
                self.send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
            elif self.path == "/api/items":
                self.send(200, json.dumps(review.payload()).encode("utf-8"), "application/json")
            elif self.path.startswith("/clip/") and self.path.count(".") == 1:
                key, ext = self.path[len("/clip/"):].split(".")
                path = review.clip(key, ext) if ext in ("mp3", "jpg") else None
                if path is None:
                    self.send(404, b"not found", "text/plain")
                else:
                    self.send(200, path.read_bytes(), "audio/mpeg" if ext == "mp3" else "image/jpeg")
            else:
                self.send(404, b"not found", "text/plain")

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/api/verdict":
                self.send(404, b"not found", "text/plain")
                return
            try:
                data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                ok = review.mark(str(data.get("id", "")), str(data.get("verdict", "")))
            except (ValueError, OSError):
                ok = False
            self.send(200 if ok else 400, json.dumps({"ok": ok}).encode(), "application/json")

        def log_message(self, *args) -> None:
            pass

    return Handler


def cmd_serve(args) -> int:
    metadata_dir = require_metadata_dir(args.metadata_dir)
    _, seg_rows = read_csv(metadata_dir / "segments.csv")
    _, site_rows = read_csv(metadata_dir / "sites.csv")
    segments = {row["segment_id"]: row for row in seg_rows}
    sites = {row["site_id"]: row for row in site_rows}
    results = [Path(p).expanduser() for p in args.results] or [args.archive_root / "birdnet"]
    items = sample_items(results, segments, sites, args.only, args.top, args.species, args.per_species,
                         args.min_conf, args.seed)
    items += hour_items(metadata_dir, segments, sites, args.only, args.hours)
    if not items:
        print("Nothing to review: no BirdNET results or hours match.", file=sys.stderr)
        return 2
    review = Review(args.archive_root, metadata_dir, items, segments)
    n_sample = sum(1 for i in items if i["kind"] == "sample")
    print(f"{n_sample} sample clip(s) for {len({i['species_key'] for i in items if i['kind'] == 'sample'})} species, "
          f"{len(items) - n_sample} hour check(s). Marks go to {review.path}")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(review))
    print(f"Open http://127.0.0.1:{args.port}/ (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


# --- applying ----------------------------------------------------------------

def fit_logistic(xs: List[float], ys: List[int], ridge: float = 0.1) -> Tuple[float, float]:
    """Intercept and slope of P(right) = 1 / (1 + exp(-(a + b x))), Newton's method."""
    a = b = 0.0
    for _ in range(100):
        ga = gb = haa = hab = hbb = 0.0
        for x, y in zip(xs, ys):
            p = 1 / (1 + math.exp(-max(-30.0, min(30.0, a + b * x))))
            w = p * (1 - p)
            ga += y - p
            gb += (y - p) * x
            haa += w
            hab += w * x
            hbb += w * x * x
        gb -= ridge * b
        hbb += ridge
        det = haa * hbb - hab * hab
        if det <= 1e-12:
            break
        da = (hbb * ga - hab * gb) / det
        db = (haa * gb - hab * ga) / det
        a, b = a + da, b + db
        if abs(da) + abs(db) < 1e-9:
            break
    return a, b


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def species_threshold(obs: List[Tuple[float, bool]], target: float, min_reviews: int) -> Tuple[Optional[float], str]:
    n, n_right = len(obs), sum(1 for _, right in obs if right)
    lowest = min(conf for conf, _ in obs)
    if n < min_reviews:
        return None, f"too few checks (need {min_reviews})"
    if n_right == n:
        return lowest, "all right"
    if n_right == 0:
        return 1.0, "all wrong (hidden)"
    a, b = fit_logistic([logit(c) for c, _ in obs], [int(r) for _, r in obs])
    if b <= 0:
        return (lowest, "no trend, precise enough") if n_right / n >= target else (1.0, "no trend (hidden)")
    score = 1 / (1 + math.exp(-((logit(target) - a) / b)))
    return min(1.0, max(lowest, score)), "logistic"


def cmd_apply(args) -> int:
    metadata_dir = require_metadata_dir(args.metadata_dir)
    reviews_path = metadata_dir / REVIEWS
    if not reviews_path.exists():
        print(f"No checks yet ({reviews_path} does not exist).", file=sys.stderr)
        return 2
    _, reviews = read_csv(reviews_path)
    det_path = metadata_dir / "birdnet_detections.csv"
    header, rows = read_csv(det_path)

    # 1. review_status: a check of one detection wins over a check of the hour.
    det_verdict, hour_verdict = {}, {}
    for r in reviews:
        key = species_key(r["common_name"], r["scientific_name"])
        if r["kind"] == "sample":
            det_verdict[(r["segment_id"], key, int(round(float(r["start_sec"]) * 10)))] = r["verdict"]
        else:
            hour_verdict[(r["segment_id"], key)] = r["verdict"]
    changes: Counter = Counter()
    for row in rows:
        key = species_key(row["common_name"], row["scientific_name"])
        verdict = det_verdict.get((row["segment_id"], key, int(round(float(row["start_sec"] or 0) * 10))))
        if verdict not in STATUS:
            verdict = hour_verdict.get((row["segment_id"], key))
        if verdict in STATUS and row.get("review_status") != STATUS[verdict]:
            row["review_status"] = STATUS[verdict]
            changes[STATUS[verdict]] += 1

    # 2. species thresholds from the sample checks.
    obs: Dict[str, List[Tuple[float, bool]]] = defaultdict(list)
    names: Dict[str, Tuple[str, str]] = {}
    for r in reviews:
        if r["kind"] == "sample" and r["verdict"] in STATUS:
            key = species_key(r["common_name"], r["scientific_name"])
            obs[key].append((float(r["confidence"]), r["verdict"] == "right"))
            names[key] = (r["scientific_name"], r["common_name"])
    today = datetime.now().date().isoformat()
    threshold_rows = []
    print(f"Species thresholds (BirdNET right {args.target:.0%} of the time):")
    for key in sorted(obs, key=lambda k: names[k][1]):
        threshold, method = species_threshold(obs[key], args.target, args.min_reviews)
        n_right = sum(1 for _, right in obs[key] if right)
        shown = f"{threshold:.2f}" if threshold is not None else "-"
        print(f"  {names[key][1][:30]:30s} {n_right:3d}/{len(obs[key]):<3d} right  threshold {shown:>4s}  ({method})")
        threshold_rows.append({
            "scientific_name": names[key][0], "common_name": names[key][1],
            "threshold": "" if threshold is None else f"{threshold:.2f}", "target_precision": f"{args.target:.2f}",
            "method": method, "n_reviewed": str(len(obs[key])), "n_right": str(n_right), "updated": today})
    if not threshold_rows:
        print("  none yet (no species-sample checks)")

    mode = "DRY RUN - nothing written" if args.dry_run else "Written"
    print(f"\n{mode}: review_status {dict(changes) or 'unchanged'} in {det_path.name}; "
          f"{sum(1 for r in threshold_rows if r['threshold'])} species threshold(s) in {THRESHOLDS}")
    if not args.dry_run:
        if changes:
            write_csv_atomic(det_path, header, rows)
        if threshold_rows:
            write_csv_atomic(metadata_dir / THRESHOLDS, THRESHOLD_FIELDS, threshold_rows)
        print("Next: re-import with --species-thresholds to use the thresholds, then validate and build.")
    return 0


# --- page --------------------------------------------------------------------

PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BirdNET check</title><link rel="icon" href="data:,">
<style>
:root{--bg:#fafaf7;--fg:#1d1d1b;--muted:#6b6b66;--line:#deded8;--card:#fff;--cur:#1f5f8b;--ok:#2e7d32;--bad:#c62828;--unsure:#a35f00}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecece8;--muted:#a3a39c;--line:#34342f;--card:#1f1f1d;--cur:#7fb6dd;--ok:#66bb6a;--bad:#ef5350;--unsure:#ffb74d}}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:0 16px 40px}
header{position:sticky;top:0;z-index:3;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0}
h1{font-size:18px;margin:0 0 6px} .muted{color:var(--muted)} .small{font-size:13px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:3px 10px;cursor:pointer}
button.tab.on{background:var(--fg);color:var(--bg)}
.group{margin-top:18px} .group h2{font-size:16px;margin:0 0 6px} .group h2 i{font-weight:normal;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.clip{background:var(--card);border:2px solid var(--line);border-radius:8px;padding:6px}
.clip.cur{border-color:var(--cur)} .clip.right{border-color:var(--ok)} .clip.wrong{border-color:var(--bad)} .clip.unsure{border-color:var(--unsure)}
.spec{position:relative;background:#000;border-radius:4px;overflow:hidden;aspect-ratio:16/5}
.spec img{width:100%;height:100%;display:block;object-fit:fill}
.win{position:absolute;top:0;bottom:0;border-left:1px dashed #fff;border-right:1px dashed #fff}
.head{position:absolute;top:0;bottom:0;width:2px;background:#fff;display:none;pointer-events:none}
.spec{cursor:pointer} button.play{min-width:64px}
.btns{display:flex;gap:6px;margin-top:6px}
.btns button.right.on{background:var(--ok);border-color:var(--ok);color:#fff}
.btns button.wrong.on{background:var(--bad);border-color:var(--bad);color:#fff}
.btns button.unsure.on{background:var(--unsure);border-color:var(--unsure);color:#fff}
#status.err{color:var(--bad);font-weight:600}
kbd{border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:12px}
</style></head><body><main>
<header>
<h1>BirdNET check</h1>
<div class="tabs"><button class="tab" data-tab="sample">Species sample</button><button class="tab" data-tab="hours">Hour check</button>
<label class="small"><input type="checkbox" id="autoplay" checked> play next automatically</label>
<span class="small muted" id="progress"></span> <span class="small" id="status"></span></div>
<div class="small muted" id="help" style="margin-top:4px"></div>
</header>
<div id="list"></div>
<script>
const HELP = {
  sample: "Is this species calling between the dashed lines? Scores are hidden on purpose.",
  hours: "Is this species really in this hour? One check per species and hour; right shows it, wrong hides it.",
};
const KEYS = " Keys: <kbd>space</kbd> play/pause, <kbd>1</kbd> right, <kbd>2</kbd> wrong, <kbd>3</kbd> unsure, <kbd>&darr;</kbd>/<kbd>&uarr;</kbd> next/previous.";
let D = null, verdicts = {}, tab = "sample", order = [], cur = -1;
const started = Date.now(); let markedNow = 0;
const $ = (s, el = document) => el.querySelector(s);
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c])); }

function render() {
  document.querySelectorAll(".tab").forEach(b => { b.classList.toggle("on", b.dataset.tab === tab);
    const n = D[b.dataset.tab].length; b.textContent = (b.dataset.tab === "sample" ? "Species sample" : "Hour check") + ` (${n})`; });
  $("#help").innerHTML = esc(HELP[tab]) + KEYS;
  const items = D[tab], list = $("#list"); list.innerHTML = "";
  if (!items.length) { list.innerHTML = `<p class="muted">Nothing here.${tab === "hours" ? " No published hours yet (or start with --hours)." : ""}</p>`; }
  const groups = new Map();
  for (const it of items) { const g = tab === "sample" ? it.species_key : it.segment_id; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); }
  order = [];
  for (const [g, its] of groups) {
    const div = document.createElement("div"); div.className = "group";
    const f = its[0];
    div.innerHTML = tab === "sample" ? `<h2>${esc(f.common)} <i>${esc(f.scientific)}</i> <span class="small muted" data-count></span></h2>`
                                     : `<h2>${esc(f.site)} · ${esc(f.hour)} <span class="small muted" data-count></span></h2>`;
    const grid = document.createElement("div"); grid.className = "grid";
    for (const it of its) {
      const el = document.createElement("div"); el.className = "clip"; el.dataset.id = it.id;
      const label = tab === "sample" ? `${esc(it.site)} · ${esc(it.time)}` : `<b>${esc(it.common)}</b> · ${it.count}× this hour`;
      el.innerHTML = `<div class="spec"><img loading="lazy" src="/clip/${it.clip}.jpg" alt=""><span class="win" style="left:${it.win_from * 100}%;width:${(it.win_to - it.win_from) * 100}%"></span><span class="head"></span></div>
        <div class="small muted" style="margin-top:4px">${label}</div>
        <div class="btns"><button class="play">&#9654; play</button><button class="right">right</button><button class="wrong">wrong</button><button class="unsure">unsure</button></div>`;
      for (const v of ["right", "wrong", "unsure"]) $("button." + v, el).onclick = () => { select(order.indexOf(it.id), false); mark(it.id, v); };
      $("button.play", el).onclick = () => { select(order.indexOf(it.id), false); toggle(it.id); };
      $(".spec", el).onclick = e => { const r = e.currentTarget.getBoundingClientRect(); select(order.indexOf(it.id), false); play(it.id, (e.clientX - r.left) / r.width); };
      grid.append(el); order.push(it.id);
    }
    div.append(grid); list.append(div);
  }
  order.forEach(paint);  // after the cards are on the page, so checked ones show their colour
  counts(); cur = -1; select(order.findIndex(id => !verdicts[id]), false, false);
}
function card(id) { return document.querySelector(`.clip[data-id="${CSS.escape(id)}"]`); }
function paint(id) {
  const el = card(id); if (!el) return; const v = verdicts[id];
  el.classList.remove("right", "wrong", "unsure"); if (v) el.classList.add(v);
  el.querySelectorAll(".btns button").forEach(b => b.classList.toggle("on", b.className.split(" ")[0] === v));
}
function counts() {
  const items = D[tab], done = items.filter(i => verdicts[i.id]).length;
  const mins = (Date.now() - started) / 60000;
  $("#progress").textContent = `${done} of ${items.length} checked` + (markedNow ? ` · ${markedNow} this session in ${mins.toFixed(0)} min` : "");
  document.querySelectorAll(".group").forEach(g => { const ids = [...g.querySelectorAll(".clip")].map(c => c.dataset.id);
    $("[data-count]", g).textContent = `${ids.filter(id => verdicts[id]).length}/${ids.length}`; });
}
function select(i, autoplay, scroll = true) {
  if (i < 0 || i >= order.length) return;
  if (cur >= 0 && card(order[cur])) card(order[cur]).classList.remove("cur");
  cur = i; const el = card(order[cur]); el.classList.add("cur");
  if (scroll) el.scrollIntoView({block: "center", behavior: "smooth"});
  if (autoplay) play(order[cur], 0);
}
// One shared player: browsers refuse to create more than a few dozen media players per page.
const player = new Audio(); player.preload = "auto"; let playing = null;
const itemById = id => D[tab].find(i => i.id === id);
function play(id, fraction) {
  const it = itemById(id); if (!it) return;
  if (playing !== id) { setButtons(playing, false); playing = id; player.src = `/clip/${it.clip}.mp3`; }
  const seek = () => { if (fraction != null && player.duration) player.currentTime = fraction * player.duration; player.play().catch(err => status("could not play: " + err.message, true)); };
  if (player.readyState >= 1) seek(); else player.addEventListener("loadedmetadata", seek, {once: true});
}
function toggle(id) { if (playing === id && !player.paused) player.pause(); else play(id, playing === id ? null : 0); }
function setButtons(id, on) { const el = id && card(id); if (!el) return; $("button.play", el).innerHTML = on ? "&#10074;&#10074; pause" : "&#9654; play"; $(".head", el).style.display = on ? "block" : "none"; }
player.addEventListener("play", () => setButtons(playing, true));
player.addEventListener("pause", () => setButtons(playing, false));
player.addEventListener("ended", () => setButtons(playing, false));
player.addEventListener("error", () => status("could not load this clip", true));
(function head() { const el = playing && card(playing);
  if (el && player.duration) $(".head", el).style.left = (100 * player.currentTime / player.duration) + "%";
  requestAnimationFrame(head); })();
function status(text, err) { $("#status").textContent = text; $("#status").className = err ? "small err" : "small muted"; }
async function mark(id, v) {
  const next = verdicts[id] === v ? "" : v;
  try {
    const r = await fetch("/api/verdict", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id, verdict: next})});
    if (!r.ok) throw new Error(r.status);
    if (next) { verdicts[id] = next; markedNow++; } else delete verdicts[id];
    status("saved");
  } catch (e) { status("NOT SAVED - is the server still running?", true); return; }
  paint(id); counts();
  if (next) { const n = order.findIndex((x, j) => j > cur && !verdicts[x]); if (n >= 0) select(n, $("#autoplay").checked); }
}
document.addEventListener("keydown", e => {
  if (!D || e.target.closest("input,select,textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  const id = order[cur];
  if (e.key === " ") { e.preventDefault(); if (id) toggle(id); }
  else if (e.key === "1" && id) mark(id, "right");
  else if (e.key === "2" && id) mark(id, "wrong");
  else if (e.key === "3" && id) mark(id, "unsure");
  else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); select(cur + 1, false); }
  else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); select(cur - 1, false); }
});
document.querySelectorAll(".tab").forEach(b => b.onclick = () => { player.pause(); playing = null; tab = b.dataset.tab; render(); });
fetch("/api/items").then(r => r.json()).then(d => { D = d; verdicts = d.verdicts; if (!D.sample.length && D.hours.length) tab = "hours"; render(); });
</script></main></body></html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check BirdNET detections by ear; turn the checks into review statuses and thresholds.",
        epilog=__doc__.split("\n", 1)[1], formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="start the listening page")
    serve.add_argument("--archive-root", required=True, type=Path)
    serve.add_argument("--metadata-dir", default=default_metadata_dir())
    serve.add_argument("--results", action="append", default=[],
                       help="BirdNET result folder(s) (default: <archive-root>/birdnet)")
    serve.add_argument("--only", help="one site_id or session_id")
    serve.add_argument("--top", type=int, default=0, help="only the N species with the most detections")
    serve.add_argument("--species", action="append", default=[], help="only this species (scientific or common name)")
    serve.add_argument("--per-species", type=int, default=20, help="sample clips per species (default 20)")
    serve.add_argument("--min-conf", type=float, default=0.25, help="lowest score to sample (default 0.25)")
    serve.add_argument("--hours", nargs="+", default=[], help="segment IDs for the hour check (default: published)")
    serve.add_argument("--seed", default="soundscape-atlas", help="random seed for the sample")
    serve.add_argument("--port", type=int, default=8765)

    apply = sub.add_parser("apply", help="write review_status and species thresholds")
    apply.add_argument("--metadata-dir", default=default_metadata_dir())
    apply.add_argument("--target", type=float, default=0.9, help="share of detections that must be right (default 0.9)")
    apply.add_argument("--min-reviews", type=int, default=10, help="right/wrong checks needed per species (default 10)")
    apply.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()
    return cmd_serve(args) if args.command == "serve" else cmd_apply(args)


if __name__ == "__main__":
    raise SystemExit(main())
