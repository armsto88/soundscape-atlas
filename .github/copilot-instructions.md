# Copilot Instructions — Soundscape Atlas

An interactive, map-based archive of long-form environmental soundscape
recordings. See README.md and docs/archive_structure.md for the full picture.

## Core principles

- Simple architecture, low hosting cost, reproducible pipelines, long-term data integrity
- No frameworks or build step for the website; Python standard library for scripts
- Privacy by default: only `published=true` segments and rounded coordinates go public

## Audio

- Raw recordings: Sound Devices MixPre-6 II BWF files (`MixPre-NNN.WAV`), 48 kHz / 24-bit,
  1–3 channels, split by the recorder at ~4 GB. Stored locally only; never uploaded.
- Working copies: 48 kHz stereo WAV, one per clock-aligned hour (`audio/working_wav/`), used for BirdNET.
- Listening copies: Opus 128k constrained VBR stereo (~58 MB/h), uploaded to Cloudflare R2.
- Never store audio files in git.

## IDs and segments

- IDs: `SITEID_YYYYMMDD_HHMM` (recorder local clock), e.g. `AU_NSW_IMBOTA_20240413_1715`.
- Segments are clock-aligned: a 17:15 start gives 17:15–18:00, then 18:00–19:00, ...

## Metadata

CSV files in `metadata/` (sites, sessions, segments, birdnet_detections), documented in
`schema/metadata_schema.md`. Keep them human-readable; preserve each file's line endings.

## Scripts

`ingest_recordings.py` (scan → manifest → process), `import_birdnet.py`, `upload_to_r2.py` (rclone),
`build_web_metadata.py` (writes `website/api/data.json` + per-segment detection files),
`validate_metadata.py`, `solar.py`.

## Hosting

- Cloudflare Pages: `website/` (static) and `functions/` (API).
- Cloudflare D1: users, cookie sessions, likes, comments. Endpoints take the user from the
  session cookie, never from the request body.
- Cloudflare R2: public bucket for Opus listening copies; the site plays `public_url`.
