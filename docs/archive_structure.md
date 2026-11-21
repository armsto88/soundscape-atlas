# Archive structure and ingest

## Audio tiers

| Tier | Where | Format | Uploaded |
|---|---|---|---|
| Raw | original recorder files, anywhere on the archive drive | as recorded (e.g. MixPre: 48 kHz / 24-bit / 2–3 ch BWF) | never |
| Working | `<archive-root>/audio/working_wav/<SITE_ID>/<SEGMENT_ID>.wav` | 48 kHz stereo, source bit depth, one clock hour | never |
| Listening | `<archive-root>/audio/listening_opus/<SITE_ID>/<SEGMENT_ID>.opus` | Opus 128k constrained VBR, stereo (~58 MB/h) | to R2, same relative path |

`listening_opus_path` in `segments.csv` is the path relative to `<archive-root>`,
so the R2 object key can mirror it.

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

   ```
   python3 scripts/ingest_recordings.py scan \
       --raw-dir <raw folder> --manifest <archive-root>/ingest_manifest.csv \
       --timezone Australia/Sydney
   ```

2. **Edit the manifest** (spreadsheet or text editor):
   - `site_id`: must exist in `metadata/sites.csv`. Leave blank to skip a row.
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
