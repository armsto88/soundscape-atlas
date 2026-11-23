# Metadata schema

The archive's metadata is four CSV files (UTF-8, header row first) kept on the
archive drive, in the folder named by `SOUNDSCAPE_METADATA_DIR`. Empty templates
are in `metadata_template/`. `scripts/validate_metadata.py` checks that the columns below exist and
that the IDs link up. What reaches the public website is described in
[metadata_template/README.md](../metadata_template/README.md).

IDs follow `SITEID_YYYYMMDD_HHMM`, the site ID plus a start time on the
recorder's local clock (for example `AU_NSW_IMBOTA_20240413_1715`).

## sites.csv: one row per recording location (written by hand)

| column | meaning |
|---|---|
| `site_id` | Unique ID, e.g. `AU_NSW_IMBOTA` (country_region_place, capitals and underscores) |
| `site_name` | Display name, e.g. `Imbota Creek` |
| `country_code`, `region_code`, `locality` | ISO country code, state/region, nearest locality |
| `latitude`, `longitude` | Decimal degrees, as precise as known (published rounded, see below) |
| `elevation_m` | Metres above sea level |
| `habitat`, `biome` | Short lower-case terms, e.g. `riparian_forest`, `temperate` |
| `public_location_precision` | `exact`, `rounded` (about 1 km, the default) or `coarse` (about 10 km) |
| `description` | Public free text, so keep exact places out of it for sensitive sites |
| `is_sensitive` | `true` caps the published location at `coarse` and rounds the elevation |
| `area` | Optional. A named area within the state, e.g. `Northern Rivers`, used to group places on the website (country › state › area › site). Published as written |

## sessions.csv: one row per continuous recording (written by `ingest_recordings.py process`)

| column | meaning |
|---|---|
| `session_id` | `SITEID_YYYYMMDD_HHMM` of the recording's start |
| `site_id` | Links to `sites.csv` |
| `raw_file_name` | Raw file name(s), `;`-separated when the recorder split the recording |
| `start_datetime_local`, `end_datetime_local` | ISO date-times on the local clock |
| `timezone` | IANA name, e.g. `Australia/Sydney`; needed for sunrise/sunset |
| `recorder`, `microphones` | Equipment |
| `sample_rate_hz`, `bit_depth`, `channels` | Raw audio format |
| `weather_notes`, `field_notes` | Public free text |
| `operator`, `copyright_owner`, `license` | Recordist and rights (`all_rights_reserved` by default) |

## segments.csv: one row per clock-aligned hour (written by `ingest_recordings.py process`)

| column | meaning |
|---|---|
| `segment_id` | `SITEID_YYYYMMDD_HHMM` of the segment's start |
| `session_id`, `site_id` | Links to `sessions.csv` and `sites.csv` |
| `segment_start_local`, `segment_end_local` | ISO date-times; partial first/last hours are shorter |
| `local_date`, `local_hour`, `year`, `month`, `season` | Derived from the start (seasons are meteorological and hemisphere-aware) |
| `listening_opus_path` | Path of the Opus listening copy relative to the archive root, also its R2 object key |
| `public_url` | Set by `upload_to_r2.py` once the audio is in the bucket; empty means not playable yet |
| `published` | `true` to show the segment on the website (starts as `false`) |
| `featured` | `true` to prefer it when a site is clicked |
| `sound_quality`, `wind_level`, `rain_present`, `water_present`, `anthropogenic_noise` | Optional listening notes |
| `notes` | Public free text |

## birdnet_detections.csv: one row per detection (written by `import_birdnet.py`)

| column | meaning |
|---|---|
| `detection_id` | Stable ID: segment, start time (tenths of a second) and a species hash |
| `segment_id` | Links to `segments.csv` |
| `common_name`, `scientific_name` | As reported by BirdNET |
| `start_sec`, `end_sec` | Seconds from the segment start |
| `confidence` | 0 to 1 |
| `model` | e.g. `BirdNET 2.4` |
| `review_status` | `unreviewed`, or a value you set (kept across re-imports). `review_birdnet.py apply` sets `confirmed` / `rejected`; rejected detections are never published, confirmed ones show as checked by ear |
| `taxon_group` | BirdNET+ V3 taxon group (`Aves`, `Amphibia`, ...), blank for older results; the website labels frogs |

## D1 database (website accounts)

`schema/d1_*.sql` define the Cloudflare D1 tables behind sign-in, likes and
comments: `users`, `sessions`, `likes`, `comments`. Apply them in the order
listed in `wrangler.toml`.
