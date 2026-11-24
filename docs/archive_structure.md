# Archive structure and ingest

## Audio tiers

| Tier | Where | Format | Uploaded |
|---|---|---|---|
| Raw | original recorder files, anywhere on the archive drive | as recorded (e.g. MixPre: 48 kHz / 24-bit / 2–3 ch BWF) | never |
| Working | `<archive-root>/audio/working_wav/<SITE_ID>/<SEGMENT_ID>.wav` | 48 kHz stereo, source bit depth, one clock hour | never |
| Listening | `<archive-root>/audio/listening_opus/<SITE_ID>/<SEGMENT_ID>.opus` | Opus 128k constrained VBR, stereo (~58 MB/h) | to R2, same relative path |

`listening_opus_path` in `segments.csv` is the path relative to `<archive-root>`,
so the R2 object key can mirror it.

The metadata lives on the drive as well, never in the public repository:

```
<archive-root>/
  metadata/             sites, sessions, segments, birdnet_detections (CSV)
  ingest_manifest.csv   one row per raw recording
  audio/                working_wav/, listening_opus/
  birdnet/              BirdNET-Analyzer output
```

Start `metadata/` from the repository's `metadata_template/`, and set
`SOUNDSCAPE_METADATA_DIR=<archive-root>/metadata` in `~/.profile`. Every
script reads it, and refuses to run without it. Keep `metadata/` under its own
version control (e.g. `git init` there, local or a private remote) and in the
drive's backups.

## Segments

Segments are clock-aligned. A recording from 17:15:28 to 08:03:00 becomes
`…_1715` (17:15:28–18:00), `…_1800`, …, `…_0800` (08:00–08:03).
Partial segments shorter than 60 s are dropped (`--min-segment-seconds`).

IDs follow `SITEID_YYYYMMDD_HHMM` (segment start, recorder clock). The session ID
uses the same pattern for the recording's start.

## Ingest workflow

`scripts/ingest_recordings.py` needs Python 3.9+ and ffmpeg/ffprobe with libopus.

1. **Scan** the raw folder. This reads BWF timestamps, rejoins files the recorder
   split at the 4 GB limit, and writes one manifest row per continuous recording.
   Where a Pro Tools copy has cut the BWF date short (`2023-09-2`), the date is
   taken from the Sound Devices iXML `FILE_UID`; files with neither are skipped.

   ```
   python3 scripts/ingest_recordings.py scan \
       --raw-dir <raw folder> --manifest <archive-root>/ingest_manifest.csv \
       --timezone Australia/Sydney
   ```

2. **Edit the manifest** (spreadsheet or text editor):
   - `site_id`: must exist in `sites.csv`. Leave blank to skip a row.
   - `timezone`: IANA name of the site's timezone.
   - `channels`: which source channels form the stereo pair (`1,2`), or a single
     channel to duplicate (`3`).
   - `clock_offset_minutes`: correction if the recorder clock was wrong
     (e.g. `-1440` for a recording dated one day late, or `-600` for a clock
     left on another timezone).
   - `microphones`, `notes`: free text. `notes` stays in the manifest only.

3. **Dry run, then process.**

   ```
   python3 scripts/ingest_recordings.py process \
       --manifest <archive-root>/ingest_manifest.csv \
       --archive-root <archive-root> --operator "Name" --dry-run
   ```

   Drop `--dry-run` to encode. Re-running is safe: finished segments are skipped
   and CSV rows are never duplicated. New segments are added with
   `published=false`.

4. Run `scripts/validate_metadata.py` (process does this automatically) and
   `scripts/build_web_metadata.py`.

## Species detections (BirdNET)

1. Run BirdNET+ V3 on the working WAVs with `scripts/run_birdnet.py` (dry run
   first). It needs a checkout of
   [birdnet-V3.0-dev](https://github.com/birdnet-team/birdnet-V3.0-dev) with
   its `.venv` (default `~/birdnet-v3`). Each session is analysed with its
   site's latitude/longitude and the week of its start date, for birds and
   frogs by default (`--groups`), and results go to
   `<archive-root>/birdnet/<SITE_ID>/<SESSION_ID>.BirdNET.results.csv`.
   Finished sessions are skipped, so a stopped run can be restarted.

   ```
   python3 scripts/run_birdnet.py --archive-root <archive-root> --only <SITE_ID> --dry-run
   ```

   Results from BirdNET-Analyzer (Raven tables or CSV) can be imported too.
   The working WAVs are named by segment ID, so each result maps to its
   segment and times are relative to the segment start.
2. Import (dry run first):

   ```
   python3 scripts/import_birdnet.py --results <archive-root>/birdnet \
       --model "BirdNET+ V3.0.1" --min-confidence 0.75 \
       --group-min-confidence Amphibia=0.5 --dry-run
   ```

   - Detections below `--min-confidence` (default 0.25) are dropped. The
     website shows every imported detection, with an option to show only
     confident ones (90% or more, or checked by ear).
     A higher threshold keeps `birdnet_detections.csv` smaller in git.
     Keeping BirdNET's own output at 0.25 means the threshold can be changed
     later with a re-import instead of a new BirdNET run.
   - `--group-min-confidence` sets another threshold for one taxon group:
     BirdNET scores frogs lower than birds, so frogs use 0.5. It needs the
     `taxon_group` column that `run_birdnet.py` adds to its results.
   - Human and noise classes (human voice, engine, dog, aircraft, ...) are
     dropped unless `--keep-non-birds` is given; frogs and other animals are
     kept. Segments with possible human voices (25% or more) are listed so you
     can listen before publishing them.
   - Re-importing a segment replaces its detections. Detection IDs stay the
     same, and `review_status` values you set by hand are kept.
3. Check the detections by ear with `scripts/review_birdnet.py serve` (a page
   on http://127.0.0.1:8765, this computer only; marks are saved in
   `birdnet_reviews.csv` in the metadata folder):
   - **Species sample**: about 20 random detections per species, spread over
     the score range and with the scores hidden. `review_birdnet.py apply`
     then sets each species' threshold where BirdNET is right 90% of the time
     (`--target`), in `species_thresholds.csv`; re-import with
     `--species-thresholds <metadata>/species_thresholds.csv` to use them.
     More checks per species give a steadier threshold.
   - **Hour check**: each species' best detection in each published hour
     (or `--hours`). `apply` sets `review_status` to confirmed or rejected
     for that species in that hour.

   ```
   python3 scripts/review_birdnet.py serve --archive-root <archive-root> --top 20
   python3 scripts/review_birdnet.py apply --dry-run
   ```
4. Rebuild with `scripts/build_web_metadata.py`.

## Publishing audio to R2

1. Mark the segments to publish: set `published=true` in `segments.csv`.
2. Draw their spectrograms, if not done yet (about a minute per hour; existing
   images are kept):

   ```
   python3 scripts/make_spectrograms.py --archive-root <archive-root> --only <SITE_ID> --dry-run
   ```
3. Upload them (dry run first):

   ```
   python3 scripts/upload_to_r2.py --archive-root <archive-root> \
       --remote r2:<bucket> --public-base-url https://<bucket public URL> --dry-run
   ```

   Only published segments are uploaded, each to the same path as its
   `listening_opus_path`, with its spectrogram beside it when there is one. The script then checks the bucket and sets
   `public_url` for exactly the published segments it holds. It clears
   `public_url` for the rest, but leaves hand-entered URLs that point elsewhere
   alone. Objects for segments that are no longer published are listed;
   `--prune` deletes them after asking. `R2_REMOTE` and `R2_PUBLIC_BASE_URL`
   can replace the two flags.
4. Rebuild with `scripts/build_web_metadata.py`, then add the weather for any
   new session: `python3 scripts/fetch_weather.py --data website/api/data.json`
   (writes `website/api/weather/`; only rounded coordinates are sent).
5. Fetch bird plates for any newly published species:
   `python3 scripts/fetch_bird_plates.py --data website/api/data.json --art website/art`.
   Species without a plate are listed in `website/art/birds/CREDITS.md`, and
   frogs come from `scripts/make_frog_plate.py` (see [website.md](website.md)).
6. Preview with `python3 scripts/preview_site.py --archive-root <archive-root> --published-only`,
   then commit and push `website/`.

### One-time R2 setup

- Create the bucket and give it public access, through a custom domain or the
  r2.dev URL. That public URL is `--public-base-url`.
- Create an R2 API token with **Object Read & Write** on that bucket, then
  `sudo apt install rclone` and run `bash scripts/setup_r2_remote.sh`. It asks
  for the access key, secret (hidden) and S3 endpoint, creates the rclone
  remote `r2` and checks the connection. The keys stay in rclone's config,
  never in this repository or your shell history.
- Optionally add `export R2_REMOTE=r2:<bucket>` and
  `export R2_PUBLIC_BASE_URL=<public URL>` to `~/.bashrc`, so `upload_to_r2.py`
  needs no flags.
- No CORS rule is needed: the website plays audio and shows spectrograms
  without one. The bucket's existing rule does no harm.

- After the first upload, open a segment and check that the player shows its
  length. A blank or infinite duration means range requests are not being
  served, and seeking will not work.

## Reorganising the drive

Recordings are identified by the BWF originator reference inside each file, not
by path. After moving or renaming raw files, run `scan` again: paths are updated
and everything filled in by hand is kept. Rows whose files disappeared are marked
`not found in last scan`.

## Rules of thumb

- Two recorders at one site at the same time need **separate site IDs**
  (e.g. `…_DAM_A`, `…_DAM_B`). Otherwise their segment IDs collide, and the
  ingest refuses the second recording.
- Keep the manifest on the archive drive, not in this public repository. Raw
  folder names can contain private locations.
