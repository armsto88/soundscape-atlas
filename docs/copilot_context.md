# Soundscape Atlas — Project Context

## Overview

Soundscape Atlas is a long-term ecological archive and listening platform for
long-form environmental recordings. Listeners explore sites on a map, play
hour-long soundscapes, and see BirdNET species detections on a timeline.

Priorities: simplicity, long-term maintainability, low infrastructure cost,
reproducibility, transparent metadata, data integrity, and privacy for
sensitive sites. Design rule: audio first, data second.

## Architecture

### Local archive (master storage, external drive)

- **Raw**: original recorder files (Sound Devices MixPre-6 II, BWF WAV, 48 kHz / 24-bit,
  1–3 channels, split at ~4 GB). Never uploaded.
- **Working**: 48 kHz stereo WAV per clock-aligned hour, for analysis (BirdNET).
- **Listening**: Opus 128k (~58 MB/h) per hour, uploaded to R2.

Layout and workflow: `docs/archive_structure.md`.

### Cloud

- **Cloudflare Pages** serves `website/` and runs `functions/` (the API).
- **Cloudflare D1** stores accounts, sessions, likes and comments.
- **Cloudflare R2** serves the published listening copies (zero egress fees).

### Website

Static HTML/CSS/JS with Leaflet, no build step:

- one marker per site; clicking a site plays a recording and lists its segments
- bottom player dock with a species-row detection timeline and comments
- filters: season, time of day (from each site's sunrise/sunset), clock hours, species
- optional accounts (cookie sessions) for a personal library and timeline comments

## Data flow

```
raw WAVs ─ ingest_recordings.py ─> segments + working WAVs + Opus
working WAVs ─ BirdNET-Analyzer ─ import_birdnet.py ─> birdnet_detections.csv
published Opus ─ upload_to_r2.py ─> R2 (sets public_url)
metadata/*.csv ─ build_web_metadata.py ─> website/api/data.json + detections/
```

Only segments with `published=true` reach the website; coordinates are rounded
according to `public_location_precision` / `is_sensitive`.

## Metadata

`metadata/sites.csv`, `sessions.csv`, `segments.csv`, `birdnet_detections.csv`,
documented column by column in `schema/metadata_schema.md`.

IDs follow `SITEID_YYYYMMDD_HHMM` on the recorder's local clock, e.g.
`AU_NSW_IMBOTA_20240413_1715`; site IDs look like `AU_NSW_IMBOTA` or `DE_BW_DREISAM`.

## Development guidelines

Prefer simple scripts, minimal dependencies, portable formats and reproducible
pipelines. Avoid storing audio in git, large frameworks and unnecessary
infrastructure. Python for processing, plain JavaScript for the website,
FFmpeg for audio, rclone for R2.

## Long-term vision

A global listening archive of natural environments: thousands of recordings,
hundreds of sites and many years of observations, while staying simple and
affordable to maintain. Ideas for later: `docs/soundscape_future_ideas.md`.
