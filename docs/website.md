# The website

A static site in `website/`, served by Cloudflare Pages: plain ES modules, no
build step, Leaflet from a CDN, Esri topographic tiles and a "field notebook"
look (warm paper, ink, Fraunces and Inter). It reads `website/api/data.json`
and one detections file per hour, built by `scripts/build_web_metadata.py`;
audio and spectrograms come from the R2 bucket.

## Screens

- **Atlas** (`#/`): the map, with named areas at low zoom and labelled places
  when zoomed in, and the places as an accordion (country › state › area ›
  place). Opening a section flies the map there; closing it zooms back out a
  level. Clicking a place shows a small card with an "Open site" button.
- **Place** (`#/site/<site_id>?at=<segment_id>`): description and inset map,
  then one chart per recording session. Each chart spans the session from its
  first to its last second, with the start and end labelled, night shaded,
  sunset and sunrise marked, unpublished hours hatched, and an activity curve
  of detections per five minutes. Click anywhere to listen from that moment.
  The hour you are in opens below the chart: the spectrogram strip and one lane
  per species, with the species list, zoom, a confident-only filter and the
  recording notes under "More". Drag the highlighted window or use the arrows
  to move through the session; during playback the window follows.
  Below the sessions, "Most often heard here": an even grid of plates, each
  with a ring for its share of the calls, birds first, then frogs.
- **About** (`#/about`).

The player bar at the bottom keeps playing while you move around, and moves on
to the next published hour of the session by itself. Old `#/hour/<segment_id>`
links, and `?segment=<id>` links from the previous site, open the place at
that hour.

Accounts, likes and comments are parked: `functions/` still holds their API,
but the site does not use it. They come back as species validation (votes on
detections) later.

## Files

```
website/index.html      page shell: top bar, main, player
website/styles.css      all styles
website/js/app.js       routing (#/, #/site/..., #/about)
website/js/data.js      data.json -> places, sessions, hours, species
website/js/atlas.js     map and place accordion
website/js/site.js      place page
website/js/sessionchart.js   one session's chart and its hour window
website/js/detail.js    the hour in detail
website/js/species.js   plate grid with rings
website/js/player.js    the audio element and the player bar
website/art/            bird plates, frog plates, manifest.json
```

The audio element has no `crossorigin` attribute, so audio plays from any host
without CORS rules.

## Data the site needs from the build

Beyond each hour's basics, `build_web_metadata.py` writes:

- each session's `start_local` and `end_local`, so the chart spans the whole
  recording and unpublished hours show as gaps;
- each hour's `activity`, detections per five minutes, for the curve;
- each place's `area` (the optional `area` column in sites.csv; until it is
  filled in, `js/data.js` derives areas for the current regions) and a
  `species` summary with scientific names, for the plate grid.

## Species images

- **Birds**: hand-cut 1800s plates from [Fugleramme](https://github.com/arnegiacomo/fugleramme)
  (CC BY-SA 4.0), fetched for the species in data.json by
  `scripts/fetch_bird_plates.py`, which pins a Fugleramme commit, writes
  `website/art/birds/CREDITS.md` and `website/art/manifest.json`, and lists
  the birds still without a plate. Those show a quiet placeholder.
- **Frogs**: no old plates exist for most, so `scripts/make_frog_plate.py`
  renders them in the same style from openly licensed photos. Each frog's
  source, licence, crop and hand-drawn outline is in `scripts/frog_plates.json`;
  the output is CC BY-SA 4.0 with the photographers credited in
  `website/art/frogs/CREDITS.md`. It needs OpenCV (see the script's header).
  After adding a frog, re-run `fetch_bird_plates.py` so the manifest lists it.

Files are named by the scientific name BirdNET+ V3 reports, e.g.
`crinia-signifera.webp`.

## Preview

```
python3 scripts/preview_site.py --archive-root /media/tom/archive/soundscape_atlas
```

Builds test data from the metadata folder into `.preview/` (ignored by git)
and serves `website/` on http://127.0.0.1:8790/ with that data and the
archive's audio laid over it. By default every processed hour is shown;
`--published-only` shows exactly what will be public. `website/api` is never
written, so unpublished hours cannot reach the public repository.

## Still to do

- Fill in the `area` column in sites.csv (the Saarland places have no area yet).
- Plates for the birds that have none (cut from Gould's *Birds of Australia*,
  following Fugleramme's guide), and a frog entry for each new frog.
- Spectrograms for the hours not drawn yet (`scripts/make_spectrograms.py`).
- A species index across the atlas: where and when a species was heard.
- A slot for a site photo once there are photos.
