# Website redesign prototype

A working prototype of the redesigned Soundscape Atlas website, built on the
real metadata. It is a separate folder so the current `website/` is untouched;
once the design is settled it replaces `website/` (the `functions/` API and
`website/api/` build stay as they are).

## Run it

Needs the archive drive mounted and `SOUNDSCAPE_METADATA_DIR` set.

```
python3 prototype/build_test_data.py --archive-root /media/tom/archive/soundscape_atlas
python3 prototype/serve.py        # then open http://127.0.0.1:8790/
```

`build_test_data.py` treats every processed hour as published, so the whole
archive can be browsed before anything is public. Add `--published-only` to
preview the real selection. It writes `prototype/api/` and links
`prototype/audio` to the archive; both are ignored by git.

Spectrogram strips (the timeline background of an hour) come from
`scripts/make_spectrograms.py`, one PNG next to each Opus file. Hours without
one show a plain timeline.

## What it is

Three screens and a player that keeps playing while you move between them:

- **Atlas** (`#/`): map with named regions, labelled site markers when zoomed
  in, an index list, and a site card with a listen button.
- **Place** (`#/site/<site_id>`): description, inset map, one strip per
  recorded night on a noon-to-noon axis with the night shaded, hour bars sized
  by detections, most-heard species.
- **Hour** (`#/hour/<segment_id>`): spectrogram strip, one lane per species
  with calling bouts (checked by ear in green), species list, zoom, a
  confident-only filter, notes about the recording.

Plain ES modules, no build step, Leaflet from a CDN, Esri topographic tiles.
No accounts, likes or comments: those come back later as species validation.

## Not in the prototype yet

- Species index across the atlas (where and when a species was heard).
- Region names are derived in `js/data.js`; a `region` column in `sites.csv`
  would replace that.
- `upload_to_r2.py` only uploads Opus files; the spectrogram PNGs need the same.
- Site photos: there is no slot yet because there are no photos.
- The index carries only each hour's top species, so per-night and per-site
  species counts are approximate. Per-site summaries at build time would fix it.
