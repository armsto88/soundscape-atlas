# Soundscape Atlas

A map-based listening archive for long-form environmental recordings. Pick a
place on the map, see each recording session as a chart of activity through the
night with sunset and sunrise marked, and listen from any moment, with the
BirdNET species detections of each hour laid out beneath.

- **Website**: static HTML/JS (Leaflet) on Cloudflare Pages, in `website/`; see
  [docs/website.md](docs/website.md)
- **Listening library and session comments**: Cloudflare Pages Functions + D1,
  in `functions/`
- **Audio**: Opus listening copies in a public Cloudflare R2 bucket
- **Metadata**: CSV files on the archive drive (never in this repo), built into `website/api/`

## Repository layout

```
metadata_template/  empty CSV templates; the real metadata lives on the archive drive
scripts/    ingest_recordings.py   raw WAVs -> hourly segments, Opus + working WAVs
            run_birdnet.py         BirdNET+ V3 on the working WAVs, per session
            import_birdnet.py      BirdNET results -> detections CSV
            review_birdnet.py      check detections by ear -> review status, thresholds
            compute_indices.py     acoustic indices per minute (ACI, ADI, BI, NDSI, H, ...)
            publish_session.py     publish one session in one go (steps 3-5 below)
            upload_to_r2.py        published Opus copies and spectrograms -> R2, sets public_url
            setup_r2_remote.sh     one-time rclone setup for the R2 bucket
            build_web_metadata.py  CSVs -> website/api/data.json + detections/
            validate_metadata.py   column and ID checks
            solar.py               sunrise/sunset and time of day
            make_spectrograms.py   one spectrogram PNG per hour, for the hour timeline
            make_frog_plate.py     plate-style frog images from photos (needs OpenCV)
            fetch_bird_plates.py   1800s bird plates from Fugleramme for the species shown
            fetch_sensitive_species.py  official sensitive-species lists -> sensitive_species.csv (kept out of precise places)
            preview_site.py        local preview on the real metadata, nothing written to website/
            make_social_post.py    a published moment -> 9:16 video + caption for social media (frames: scripts/social/)
website/    index.html, styles.css, js/ (modules), art/ (plates), api/ (generated)
functions/  /api/* endpoints; shared helpers in functions/_lib/
schema/     metadata_schema.md (CSV columns), d1_*.sql (database)
docs/       archive_structure.md (archive layout and the full workflow), website.md
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
3. Set `published=true` on segments to make them public, draw their
   spectrograms with `make_spectrograms.py` and work out their acoustic indices
   with `compute_indices.py`.
4. `upload_to_r2.py` to put their audio and spectrograms in R2.
5. `validate_metadata.py`, `build_web_metadata.py`, `fetch_weather.py`, `fetch_bird_plates.py`,
   check with `preview_site.py --published-only`, then commit and push.

`publish_session.py <SESSION_ID> [--start 15:38] [--except 02:00]` does steps 3
to 5 for one session, after showing each hour's calls and possible voices and
asking. It also makes the public copy of each hour (low cut at 100 Hz, cut
ends, 10 s fades).

Only published segments reach the website, and site coordinates are rounded
as configured. See [metadata_template/README.md](metadata_template/README.md).

## Local development

Needs Python 3.9+ and ffmpeg/ffprobe for the scripts. Node.js is only needed
for Wrangler.

```
python3 scripts/preview_site.py --archive-root /media/tom/archive/soundscape_atlas
npx wrangler pages dev website                    # the published data, with the API (local D1)
```

`preview_site.py` builds test data from the metadata folder into `.preview/`
(ignored by git) and serves the site on http://127.0.0.1:8790/ with it, so the
whole archive can be browsed before anything is public.

For the local D1 database, apply the `schema/d1_*.sql` files with
`--local` as listed in `wrangler.toml`. The same commands are VS Code tasks.

## Deploying

Cloudflare Pages serves `website/` and `functions/`. The first time: create
the D1 database and apply the schema files, and set the `ADMIN_RESET_KEY`
secret (both in `wrangler.toml`). Then set up the R2 bucket
([docs/archive_structure.md](docs/archive_structure.md#one-time-r2-setup)).
For the listening library and administration, apply `schema/d1_library.sql`,
`schema/d1_admin.sql` and `schema/d1_comment_times.sql` in that order before
deploying the website changes. Apply `d1_comment_times.sql` once per database.
See [Administration](docs/website.md#administration) to grant access to an
existing account.
The bot check on the account and comment forms needs its site key (in
`wrangler.toml`) and the `TURNSTILE_SECRET_KEY` Pages secret (see
[the bot check](docs/website.md#the-bot-check-cloudflare-turnstile)); without
the secret the forms work unchecked.

Never commit audio or ingest manifests; `.gitignore` covers both.
