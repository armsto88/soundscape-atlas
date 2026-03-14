# Copilot Instructions — Soundscape Atlas

This repository contains the infrastructure for **Soundscape Atlas**, an interactive map-based platform for exploring long-form environmental soundscape recordings.

## Core Principles

Prioritize:

- simple architecture
- low hosting cost
- reproducible pipelines
- long-term data integrity

Avoid unnecessary frameworks and complex infrastructure.

---

## Audio Architecture

Three audio tiers exist:

### Raw recordings
- 96 kHz stereo WAV
- stored locally only
- never uploaded to cloud

### Working files
- 48 kHz WAV
- split into 1-hour segments

### Listening copies
- stereo Opus (~128 kbps)
- ~58 MB per hour
- stored in Cloudflare R2
- streamed by the website

---

## Metadata System

Metadata is stored as CSV files in `/metadata`.

Tables:

- `sites.csv`
- `sessions.csv`
- `segments.csv`
- `birdnet_detections.csv`

Each table should remain:

- human readable
- easy to version control
- convertible to SQL later

---

## File Naming Convention

Audio files follow:

SITEID_YYYYMMDD_HHMM.ext

Examples:

AU_NSW_IMBOTA_20240814_0530.wav  
AU_NSW_IMBOTA_20240814_0600.opus

---

## Cloud Infrastructure

Hosting:

- Cloudflare Pages (website)
- Cloudflare R2 (audio storage)

Never store large audio files in Git.

---

## Preferred Tools

- Python for processing scripts
- Bash for automation
- FFmpeg for audio conversion
- rclone for R2 uploads
- Leaflet or Mapbox for mapping

---

## Development Focus

Focus on:

- metadata processing
- audio pipeline scripts
- interactive map UI
- efficient audio streaming
