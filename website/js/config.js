// Where the site finds things that live outside website/.

const LOCAL = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);

// The base map: one PMTiles file built by scripts/build_map_tiles.py. The local
// preview (scripts/preview_site.py) serves it from .maptiles/ at /map/; the public
// site reads it from the R2 bucket.
export const MAP_URL = LOCAL
  ? new URL("map/soundscape-map.pmtiles", document.baseURI).href
  : "https://media.soundscapeatlas.com/map/soundscape-map.pmtiles";

// The relief: Mapterhorn's terrain for the same areas, from the same script.
export const TERRAIN_URL = LOCAL
  ? new URL("map/soundscape-terrain.pmtiles", document.baseURI).href
  : "https://media.soundscapeatlas.com/map/soundscape-terrain.pmtiles";
