# The website

A static site in `website/`, served by Cloudflare Pages: plain ES modules, no
build step, a "field notebook" look (paper, ink, Fraunces and Inter) and our own
map drawn by MapLibre. Everything it loads comes from the site itself or the R2
bucket: no CDNs, no Google Fonts, no third-party tiles. It reads
`website/api/data.json` and one detections file per hour, built by
`scripts/build_web_metadata.py`; audio, spectrograms and the map file come from
the R2 bucket.

## Screens

- **Atlas** (`#/`): the map, with named areas at low zoom and labelled places
  when zoomed in, and the places as an accordion (country › state › area ›
  place). Opening a section flies the map there; closing it zooms back out a
  level. Clicking a place shows a small card with a play button and "Open
  site". The play button plays the place's hour without leaving the map, the
  same for every visit: an hour marked `featured` in segments.csv (from its
  start); otherwise the session of the liveliest dawn hour (most detections),
  from half an hour before its dawn chorus is at its fullest (the same moment
  the session notes show; half an hour before sunrise if there's no real
  chorus); otherwise the liveliest hour from its busiest five minutes
  (`quickListen()` and `chorusPeak()` in `js/data.js`).
- **Place** (`#/site/<site_id>?at=<segment_id>`): description and inset map,
  then one chart per recording session. Each chart spans the session from its
  first to its last second, with the start and end labelled, night shaded,
  sunset and sunrise marked, unpublished hours hatched, and an activity curve
  of detections per five minutes. Click anywhere to listen from that moment.
  Under each chart, **session notes** (`js/notes.js`): first bird of the
  morning, dawn and evening chorus at their fullest, voices in the night, the
  quietest stretch, most heard birds and the frogs, each moment playable;
  written from sure detections only (checked by ear or at least 70%), loaded
  when the session scrolls into view.
  The hour you are in opens below the chart: the spectrogram strip and one lane
  per species, with the species list, zoom, a confident-only filter and the
  recording notes under "More". Drag the highlighted window or use the arrows
  to move through the session; during playback the window follows.
  Below the sessions, "Most often heard here": an even grid of plates, each
  with a ring for its share of the calls, birds first, then frogs.
- **About** (`#/about`).

Phones (designed for 375 px wide, the iPhone SE): the map sits above the place
list and its card shows only the essentials; the map's credits start folded
and the scale bar is hidden. In the hour view each species lane carries its
own name across the top (no name column), and plates sit three to a row.

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
website/js/map.js       the base map: style from the colour tokens, fonts, sources
website/js/config.js    where the map file lives (local preview or R2)
website/js/site.js      place page
website/js/sessionchart.js   one session's chart and its hour window
website/js/detail.js    the hour in detail
website/js/species.js   plate grid with rings
website/js/player.js    the audio element and the player bar
website/art/            bird plates, frog plates, manifest.json
website/fonts/          Inter and Fraunces (woff2, Latin), fonts.css, licences
website/vendor/         MapLibre GL JS 6.17.0, pmtiles 4.5.0, @protomaps/basemaps 5.7.2, licences
```

While audio plays, the player bar shows the recording's own clock (the time of
day at the place), a thin sound-level line and, quietly, the bird calling now
(checked by ear or at least 70% sure, with its plate); the lanes of the species
calling take on a little ochre, and the place's dot on the atlas and inset map
breathes. The level line uses Web Audio, which needs the audio fetched with
CORS: the player does that only for audio from this site or
`media.soundscapeatlas.com` (whose bucket sends the headers). Audio from any
other host plays on a fresh element without the level line, because through
Web Audio it would play silent.

## The map

One PMTiles file of OpenStreetMap data (Protomaps' basemap), built by
`scripts/build_map_tiles.py` from Protomaps' daily world build: the world up to
zoom 6, wide areas around our places at zoom 7–10 and close-ups (about 30 km
around each group of places) at 11–14. Run it again after adding places far
from the others. It needs the `pmtiles` tool and writes
`.maptiles/soundscape-map.pmtiles` (git-ignored), which goes to the R2 bucket
as `map/soundscape-map.pmtiles`; `js/config.js` holds the public address.

`js/map.js` reads the file as three sources, coarse to fine, so a finer level
with no tiles shows the coarser one instead of a blank map. Colours come from
the tokens in `styles.css`, labels use the site's own fonts (MapLibre's
`font-faces`; no glyph server), and layers that need icon images are left out.
The places are a map layer, so their labels make room for each other.

The relief is a second file from the same script, `soundscape-terrain.pmtiles`:
Mapterhorn's terrain (zoom 0–12, terrarium WebP) for the same areas, shaded
with MapLibre's "igor" hill shade between each level's land colours and its
roads. The map must credit OpenStreetMap, Protomaps and Mapterhorn (bottom
right); the About page also names the elevation sources.

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

## Colours and brand

Every colour is a token in `styles.css` `:root`; nothing else in the site
names a colour. Each accent has one job:

- **ink**: text and data (detection marks, the activity curve);
- **ochre**: places and selection (map markers, the hour window, selected
  rows, which also get a thin ochre bar); `ochre-deep` for lines that must be
  seen (focus ring, hour-window edge);
- **green**: checked by ear, and links;
- **red**: now (the playhead, with a small cap, and the progress line), and errors;
- **slate**: night (and later the map's water); **dusk**: twilight. The chart's
  sky is one gradient from day to dusk at sunset to night an hour later.

The mark is three contour lines around an ochre dot: a hill on a map, and
sound spreading from the recorder. It sits inline in the top bar of
`index.html` (colours from the tokens). `website/assets/` holds `mark.svg`,
`favicon.svg` (a simpler two-ring version on a paper tile), `favicon-32.png`,
`apple-touch-icon.png` and `social.png`, the 1200 × 630 link-preview image,
drawn by `scripts/make_social_image.py`. That script can add one hour's
spectrogram strip (`--segment`), but only for a published hour.

Spectrogram PNGs get a fixed tone curve in `make_spectrograms.py` and are laid
over the chart paper with `mix-blend-mode: multiply`.

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
- Plates for the birds that have none, in Fugleramme's style (status 24 Nov 2026):
  - 14 of the 31 Boomerang Falls birds have no plate. Green Catbird, Mistletoebird
    and Shining Bronze Cuckoo are coming upstream (Fugleramme issue #406, a
    contributor in Sydney adding ~70 Australian birds); re-pin
    `fetch_bird_plates.py` to a newer Fugleramme commit when they land.
  - Public-domain sources found on Wikimedia Commons (BHL scans of Gould's
    *The Birds of Australia*) for Albert's Lyrebird, Australian Logrunner,
    Large-billed Scrubwren, Pacific Emerald Dove, Pale-yellow Robin, Sooty Owl,
    White-headed Pigeon, White-throated Treecreeper and Wompoo Fruit Dove;
    Russet-tailed Thrush via Keulemans' *Geocichla papuensis*; Paradise Riflebird
    still to find (probably under an older name). Internet Archive has the
    volumes at higher resolution.
  - Cut them with Fugleramme's `plate-review` skill and `tools/platereview/`
    (sparse checkout of just those; the whole repository is 1.8 GB), bird at
    least 600 px, paper halo `#F0ECE5`. Consider offering them upstream on #406.
  - When the archive drive is back, list every bird detected across all places,
    not only Boomerang Falls, and cut in order of how often we hear them.
    Australia has 735 native species; Fugleramme covers 124, ~70 more are coming.
- Redraw the frogs, and a frog entry for each new frog.
- Spectrograms for the hours not drawn yet (`scripts/make_spectrograms.py`).
- A species index across the atlas: where and when a species was heard.
- A slot for a site photo once there are photos.
