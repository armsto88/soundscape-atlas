# Soundscape Atlas — Project Context

## Overview

Soundscape Atlas is a long-term ecological archive and interactive listening platform for exploring environmental soundscape recordings.

The project focuses on:

- multi-year field recordings
- long-form natural soundscapes
- interactive exploration via maps
- low-cost infrastructure
- reproducible data workflows

The platform will allow users to explore soundscapes across time and geography while preserving a high-quality master archive of recordings.

---

# Core Design Principles

Development decisions should prioritize:

- simplicity
- long-term maintainability
- low infrastructure cost
- reproducibility
- transparent metadata
- data integrity

Avoid unnecessary frameworks or complex infrastructure.

---

# System Architecture

The system consists of three layers.

## 1. Local Archive (Master Storage)

All original recordings are stored locally on external storage.

Archive tiers:

### Raw recordings
- 96 kHz stereo WAV
- original field recordings
- never uploaded to cloud storage

### Working recordings
- converted to 48 kHz stereo WAV
- split into 1-hour chunks
- used for analysis and processing

### Listening copies
- compressed stereo Opus (~128 kbps)
- approximately 58 MB per hour
- uploaded to cloud storage

---

## 2. Cloud Infrastructure

Public listening copies are stored in:

Cloudflare R2

Characteristics:

- S3-compatible object storage
- zero egress fees
- optimized for public audio streaming
- only compressed listening copies stored

Website hosting:

Cloudflare Pages

The website loads metadata and audio URLs from R2.

---

## 3. Website Layer

The website provides:

- an interactive map interface
- streaming playback of long soundscapes
- browsing by location
- browsing by time
- species detection overlays
- associated photographs

The website should remain static-first with minimal backend logic.

---

# Repository Structure
soundscape-atlas/

metadata/
sites.csv
sessions.csv
segments.csv
birdnet_detections.csv

schema/
metadata_schema.md

scripts/
chunk_audio.sh
convert_to_opus.sh
upload_to_r2.sh

website/
map/
player/
api/

docs/
archive_structure.md
copilot_context.md

README.md


---

# Metadata System

Metadata is stored as CSV files.

Advantages:

- human readable
- version controlled
- portable
- easily migrated to SQL later
- simple to edit

---

# Metadata Tables

## sites.csv

Defines recording locations.

Fields:
site_id
site_name
country_code
region_code
latitude
longitude
habitat
description


Example site IDs:
AU_NSW_IMBOTA
DE_BW_DREISAM


---

## sessions.csv

One row per recording session.

Fields:
session_id
site_id
start_datetime_local
end_datetime_local
recorder
microphones
sample_rate_hz
bit_depth
channels


Example session ID:
AU_NSW_IMBOTA_20240814_0530


---

## segments.csv

One row per 1-hour audio segment.

Segment ID example:
AU_NSW_IMBOTA_20240814_0600

Fields:
segment_id
session_id
site_id
segment_start_local
segment_end_local
local_hour
listening_opus_path
public_url
published
notes


Segments are the primary unit used by the website.

---

## birdnet_detections.csv

Stores species detections produced by BirdNET.

Fields:
detection_id
segment_id
common_name
scientific_name
start_sec
end_sec
confidence
model
review_status

One segment may contain many detections.

---

# Audio File Naming Convention

Audio files must follow this naming structure:

SITEID_YYYYMMDD_HHMM.ext

Examples:

Raw recording:

AU_NSW_IMBOTA_20240814_0530.wav

Hourly listening segment:

AU_NSW_IMBOTA_20240814_0600.opus

This ensures filenames can be parsed automatically.

---

# Audio Pipeline

The audio processing workflow is:

Raw recording (96kHz WAV)
        ↓
Convert to 48kHz WAV
        ↓
Split into 1-hour segments
        ↓
Convert to Opus listening copies
        ↓
Upload to Cloudflare R2

Tools used:

- FFmpeg
- Python or Bash scripts
- rclone for R2 uploads

---

# Website Goals

The Soundscape Atlas website should allow users to:

- explore recordings on a map
- listen to full one-hour soundscapes
- compare the same location across years
- explore recordings by time of day
- view associated photos
- see species detections within recordings

User experience should emphasize:

- immersive listening
- calm, minimal design
- intuitive navigation
- fast audio streaming

---

# Development Guidelines

When generating code:

Prefer:

- simple scripts
- minimal dependencies
- portable formats
- reproducible pipelines

Avoid:

- storing audio files in Git
- large frameworks early
- unnecessary infrastructure complexity

---

# Tools and Languages

Expected development tools:

- Python
- Bash
- JavaScript / TypeScript
- Leaflet or Mapbox
- FFmpeg
- rclone

---

# Priority Development Tasks

1. audio processing pipeline
2. metadata validation scripts
3. automated R2 upload workflow
4. interactive map UI
5. long-form audio player
6. species detection integration

---

# Long-Term Vision

Soundscape Atlas is intended to become a global listening archive of natural environments.

The system should remain capable of scaling to:

- thousands of recordings
- hundreds of locations
- many years of observations

while remaining simple and affordable to maintain.

Design decisions should prioritize longevity and clarity over rapid feature growth.



