# Soundscape Atlas

A map-based listening archive for long-form environmental recordings. Pick a
site on the map and listen to hour-long soundscapes, with BirdNET species
detections on a timeline and dawn and dusk following the local sunrise and sunset.

- **Website**: static HTML/JS (Leaflet) on Cloudflare Pages, in `website/`
- **Accounts, likes, comments**: Cloudflare Pages Functions + D1, in `functions/`
- **Audio**: Opus listening copies in a public Cloudflare R2 bucket
- **Metadata**: CSV files on the archive drive (never in this repo), built into `website/api/`

## Repository layout

```
metadata_template/  empty CSV templates; the real metadata lives on the archive drive
scripts/    ingest_recordings.py   raw WAVs -> hourly segments, Opus + working WAVs
            run_birdnet.py         BirdNET+ V3 on the working WAVs, per session
            import_birdnet.py      BirdNET results -> detections CSV
            review_birdnet.py      check detections by ear -> review status, thresholds
            upload_to_r2.py        published Opus copies -> R2, sets public_url
            setup_r2_remote.sh     one-time rclone setup for the R2 bucket
            build_web_metadata.py  CSVs -> website/api/data.json + detections/
            validate_metadata.py   column and ID checks
            solar.py               sunrise/sunset and time of day
website/    index.html, app.js, styles.css, api/ (generated)
functions/  /api/* endpoints; shared helpers in functions/_lib/
schema/     metadata_schema.md (CSV columns), d1_*.sql (database)
docs/       archive_structure.md (archive layout and the full workflow)
```

## From recordings to the website

The full workflow is in [docs/archive_structure.md](docs/archive_structure.md).
In short:

0. Once: copy `metadata_template/*.csv` to a metadata folder on the archive
   drive and set `SOUNDSCAPE_METADATA_DIR` to it (see
   [metadata_template/README.md](metadata_template/README.md)).
1. `ingest_recordings.py scan` a folder of raw recordings, fill `site_id` and
   `timezone` in the manifest, then `ingest_recordings.py process`.
2. `run_birdnet.py` (BirdNET+ V3) on the working WAVs, then `import_birdnet.py`.
3. Set `published=true` on segments to make them public.
4. `upload_to_r2.py` to put their audio in R2.
5. `validate_metadata.py`, `build_web_metadata.py`, then commit and push.

Only published segments reach the website, and site coordinates are rounded
as configured. See [metadata_template/README.md](metadata_template/README.md).

## Local development

Needs Python 3.9+ and ffmpeg/ffprobe for the scripts. Node.js is only needed
for Wrangler.

```
python3 -m http.server 8787 --directory website   # map and player, no accounts
npx wrangler pages dev website                    # with accounts (local D1)
```

For the local D1 database, apply the `schema/d1_*.sql` files with
`--local` as listed in `wrangler.toml`. The same commands are VS Code tasks.

## Deploying

Cloudflare Pages serves `website/` and `functions/`. The first time: create
the D1 database and apply the schema files, and set the `ADMIN_RESET_KEY`
secret (both in `wrangler.toml`). Then set up the R2 bucket
([docs/archive_structure.md](docs/archive_structure.md#one-time-r2-setup)).

Never commit audio or ingest manifests; `.gitignore` covers both.
