#!/usr/bin/env python3
"""Run BirdNET+ V3 on the working WAVs, one recording (session) at a time.

Uses the BirdNET team's birdnet-V3.0-dev checkout (analyze.py and its .venv,
see https://github.com/birdnet-team/birdnet-V3.0-dev). Each session is analysed
with its site's latitude/longitude and the week of its start date, so the
Geomodel drops species that do not occur there at that time of year.

Output: <archive-root>/birdnet/<SITE_ID>/<SESSION_ID>.BirdNET.results.csv,
ready for import_birdnet.py, with a taxon_group column added (Aves, Amphibia,
...) so the import can use another threshold for frogs. Sessions with an existing result are skipped, so
an interrupted run can simply be started again.

Classes: the taxon groups given with --groups (default birds and frogs), plus
Human and the noise classes (engine, aircraft, ...). import_birdnet.py drops
those again, but uses Human to list hours with possible voices to check.

Example:
  python3 scripts/run_birdnet.py --archive-root /media/USER/archive/soundscape_atlas \
      --only AU_NSW_BOOMERANG_FALLS --dry-run
"""

from __future__ import annotations

import argparse
import csv
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
from ingest_recordings import default_metadata_dir, read_csv, require_metadata_dir  # noqa: E402

LABELS = "models/BirdNET+_V3.0_Global_12K_Labels.csv"
# Kept in every run so import_birdnet.py can flag voices and noise.
ALWAYS_GROUPS = {"Anthropogenic", "Geophony", "Music"}
ALWAYS_SPECIES = {"Homo sapiens"}


def geomodel_week(day: datetime) -> int:
    """BirdNET week: 1-48, four per month."""
    return (day.month - 1) * 4 + min(4, (day.day - 1) // 7 + 1)


def add_taxon_group(path: Path, group_of: dict) -> None:
    """Add a taxon_group column, so the import can treat frogs differently from birds."""
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    if not rows or "taxon_group" in rows[0]:
        return
    sci = rows[0].index("scientific_name")
    rows = [rows[0] + ["taxon_group"]] + [row + [group_of.get(row[sci], "")] for row in rows[1:] if row]
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run BirdNET+ V3 on the working WAVs, per session.",
        epilog=__doc__.split("\n", 1)[1],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--archive-root", required=True, type=Path)
    parser.add_argument("--metadata-dir", default=default_metadata_dir(),
                        help="metadata folder (default: $SOUNDSCAPE_METADATA_DIR)")
    parser.add_argument("--birdnet-dir", type=Path, default=Path.home() / "birdnet-v3",
                        help="birdnet-V3.0-dev checkout with a .venv (default: ~/birdnet-v3)")
    parser.add_argument("--only", help="one site_id or session_id")
    parser.add_argument("--groups", nargs="+", default=["Aves", "Amphibia"],
                        help="taxon groups to report (default: Aves Amphibia)")
    parser.add_argument("--min-conf", type=float, default=0.25,
                        help="lowest score written (default 0.25; filter harder at import)")
    parser.add_argument("--threads", type=int, help="CPU threads (default: all)")
    parser.add_argument("--overwrite", action="store_true", help="re-run sessions that have results")
    parser.add_argument("--dry-run", action="store_true", help="show the plan; run nothing")
    args = parser.parse_args()

    metadata_dir = require_metadata_dir(args.metadata_dir)
    python = args.birdnet_dir / ".venv" / "bin" / "python"
    analyze = args.birdnet_dir / "analyze.py"
    labels_path = args.birdnet_dir / LABELS
    if not python.exists() or not analyze.exists():
        print(f"BirdNET V3 not found in {args.birdnet_dir} (need analyze.py and .venv).", file=sys.stderr)
        return 2

    _, sites = read_csv(metadata_dir / "sites.csv")
    _, sessions = read_csv(metadata_dir / "sessions.csv")
    _, segments = read_csv(metadata_dir / "segments.csv")
    site_by_id = {row["site_id"]: row for row in sites}
    segments_by_session = defaultdict(list)
    for row in segments:
        segments_by_session[row["session_id"]].append(row)

    selected = [s for s in sessions if not args.only or args.only in (s["site_id"], s["session_id"])]
    if not selected:
        print(f"No sessions match {args.only!r}.", file=sys.stderr)
        return 2

    species_file = None
    if not args.dry_run:
        if not labels_path.exists():
            print(f"Labels not found: {labels_path} (run analyze.py once to download the model).", file=sys.stderr)
            return 2
        with labels_path.open(encoding="utf-8", newline="") as handle:
            group_of = {r["scientific_name"]: r["taxon_group"] for r in csv.DictReader(handle)}
        keep = sorted(name for name, group in group_of.items()
                      if group in set(args.groups) | ALWAYS_GROUPS or name in ALWAYS_SPECIES)
        species_file = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8")
        species_file.write("\n".join(keep) + "\n")
        species_file.close()

    plan = []
    for session in selected:
        site = site_by_id.get(session["site_id"])
        if site is None:
            print(f"  skip {session['session_id']}: site {session['site_id']} not in sites.csv")
            continue
        out = args.archive_root / "birdnet" / session["site_id"] / f"{session['session_id']}.BirdNET.results.csv"
        wavs = [args.archive_root / "audio" / "working_wav" / row["site_id"] / f"{row['segment_id']}.wav"
                for row in sorted(segments_by_session[session["session_id"]], key=lambda r: r["segment_start_local"])]
        missing = [w for w in wavs if not w.exists()]
        week = geomodel_week(datetime.fromisoformat(session["start_datetime_local"]))
        status = "done" if out.exists() and not args.overwrite else "missing WAVs" if missing or not wavs else "to do"
        print(f"  {session['session_id']}  {len(wavs)} hour(s), week {week}  {status}"
              + (f" ({len(missing)} of {len(wavs)} missing)" if missing else ""))
        if status == "to do":
            plan.append((session, site, week, wavs, out))

    hours = sum(len(p[3]) for p in plan)
    print(f"\n{len(plan)} session(s), {hours} hour(s) to analyse.")
    if args.dry_run or not plan:
        return 0

    started = time.time()
    failed = 0
    for index, (session, site, week, wavs, out) in enumerate(plan, 1):
        out.parent.mkdir(parents=True, exist_ok=True)
        part = out.with_name(out.name + ".part")
        cmd = [str(python), str(analyze), *map(str, wavs), "-o", str(part),
               "--lat", site["latitude"], "--lon", site["longitude"], "--week", str(week),
               "--species", species_file.name, "--min-conf", str(args.min_conf)]
        if args.threads:
            cmd += ["--threads", str(args.threads)]
        t = time.time()
        print(f"[{index}/{len(plan)}] {session['session_id']} ({len(wavs)} h) ...", end=" ", flush=True)
        result = subprocess.run(cmd, cwd=args.birdnet_dir, capture_output=True, text=True)
        if result.returncode != 0 or "skipped" in result.stdout:
            failed += 1
            part.unlink(missing_ok=True)
            print("FAILED")
            print((result.stdout + result.stderr).strip()[-2000:])
            continue
        add_taxon_group(part, group_of)
        part.replace(out)
        print(f"ok ({(time.time() - t) / 60:.1f} min)")

    Path(species_file.name).unlink(missing_ok=True)
    print(f"\nDone in {(time.time() - started) / 60:.1f} min, {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
