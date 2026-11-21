# Metadata tables

- `sites.csv` — one row per recording location
- `sessions.csv` — one row per original long-form recording session
- `segments.csv` — one row per 1-hour listening segment
- `birdnet_detections.csv` — one row per species detection within a segment

## What gets published

`scripts/build_web_metadata.py` builds the public `website/api/data.json`:

- Only segments with `published=true` are included, along with their detections.
  New segments from the ingest script start as `false`.
- Site coordinates follow `public_location_precision`:

  | value | published as |
  |---|---|
  | `exact` | as entered |
  | `rounded` (default when blank) | 2 decimals, about 1 km |
  | `coarse` | 1 decimal, about 11 km |

- `is_sensitive=true` caps a site at `coarse` whatever its precision, and rounds
  its elevation to the nearest 100 m.
- Unrecognised values fall back to the more private option and print a warning.
- Free text (`site_name`, `locality`, `description`, notes) is published as
  written, so keep exact place names out of it for sensitive sites.
