// The base map: our own OpenStreetMap extract (one PMTiles file, see
// scripts/build_map_tiles.py), drawn by MapLibre in the site's colours. Every
// colour comes from the tokens in styles.css, every font from website/fonts.
//
// The file holds the world up to zoom 6, wide areas around our places at zoom
// 7-10 and close-ups at 11-14. It is read as three sources, coarse to fine, each
// drawn over the one before: where a finer one has no tiles, the coarser one
// shows through (enlarged) instead of a blank map. Labels that two sources share
// collide, and only the finer one is placed.
//
// The relief comes from a second file, Mapterhorn's terrain for the same areas,
// one hill-shade layer per level, laid between that level's land colours and its
// roads; a finer level's land covers the coarser shading, so it never doubles.

import { Map as MapLibreMap, addProtocol, AttributionControl } from "../vendor/maplibre-gl.mjs";
import { layers, namedFlavor } from "../vendor/protomaps-basemaps.mjs";
import { MAP_URL, TERRAIN_URL } from "./config.js";

const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a> · <a href="https://mapterhorn.com/attribution">Mapterhorn</a>';
// name, map zooms, terrain zooms
const LEVELS = [["world", 0, 6, 0, 5], ["wide", 7, 10, 7, 10], ["close", 11, 14, 11, 12]];
// layers that need icon images (we have none) or that our zoom range never reaches
const SKIP = new Set(["pois", "roads_shields", "roads_oneway", "address_label"]);

export const FONTS = { regular: "Inter Regular", bold: "Inter Medium", italic: "Fraunces Italic" };
const RANGES = {
  latin: ["U+0000-00FF", "U+0131", "U+0152-0153", "U+02BB-02BC", "U+02C6", "U+02DA", "U+02DC", "U+0304", "U+0308", "U+0329", "U+2000-206F", "U+20AC", "U+2122", "U+2191", "U+2193", "U+2212", "U+2215", "U+FEFF", "U+FFFD"],
  "latin-ext": ["U+0100-02BA", "U+02BD-02C5", "U+02C7-02CC", "U+02CE-02D7", "U+02DD-02FF", "U+0304", "U+0308", "U+0329", "U+1D00-1DBF", "U+1E00-1E9F", "U+1EF2-1EFF", "U+2020", "U+20A0-20AB", "U+20AD-20C4", "U+2113", "U+2C60-2C7F", "U+A720-A7FF"],
};
const face = (file) => ["latin", "latin-ext"].map((subset) => ({
  url: new URL(`fonts/${file}-${subset}.woff2`, document.baseURI).href,
  "unicode-range": RANGES[subset],
}));

let protocolReady = false;

// the colour tokens from styles.css, as #rrggbb strings
export function tokens() {
  const css = getComputedStyle(document.documentElement);
  const names = ["paper-0", "paper", "paper-2", "paper-3", "rule", "ink", "ink-2", "ink-3", "ochre", "ochre-deep", "green", "red", "slate", "dusk"];
  return Object.fromEntries(names.map((n) => [n, css.getPropertyValue(`--${n}`).trim()]));
}

// t parts of colour a over colour b (both #rrggbb)
export function mix(a, b, t) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(t * v + (1 - t) * y[i]).toString(16).padStart(2, "0")).join("");
}

function flavor(t) {
  const on = (colour, k) => mix(colour, t.paper, k); // a tint of a colour on the paper
  const road = t["paper-0"];
  const casing = t.rule;
  const highway = on(t.ochre, 0.22);
  const highwayCasing = on(t["ochre-deep"], 0.4);
  const waterInk = mix(t.ink, t.slate, 0.6);
  return {
    ...namedFlavor("light"),
    background: t.slate, earth: t.paper,
    park_a: on(t.green, 0.16), park_b: on(t.green, 0.2), wood_a: on(t.green, 0.11), wood_b: on(t.green, 0.14),
    scrub_a: on(t.green, 0.07), scrub_b: on(t.green, 0.09), pedestrian: t["paper-2"],
    hospital: t["paper-2"], industrial: t["paper-2"], school: t["paper-2"], zoo: t["paper-2"], military: t["paper-2"],
    glacier: t["paper-0"], sand: on(t.ochre, 0.1), beach: on(t.ochre, 0.12), aerodrome: t["paper-2"], runway: t["paper-3"],
    water: t.slate, pier: t["paper-3"], buildings: t["paper-3"],
    other: road, minor_service: road, minor_a: road, minor_b: road, link: road, major: road, highway,
    minor_service_casing: casing, minor_casing: casing, link_casing: casing,
    major_casing_early: casing, major_casing_late: casing, highway_casing_early: highwayCasing, highway_casing_late: highwayCasing,
    tunnel_other_casing: casing, tunnel_minor_casing: casing, tunnel_link_casing: casing, tunnel_major_casing: casing, tunnel_highway_casing: highwayCasing,
    tunnel_other: t["paper-2"], tunnel_minor: t["paper-2"], tunnel_link: t["paper-2"], tunnel_major: t["paper-2"], tunnel_highway: t["paper-2"],
    bridges_other_casing: casing, bridges_minor_casing: casing, bridges_link_casing: casing, bridges_major_casing: casing, bridges_highway_casing: highwayCasing,
    bridges_other: road, bridges_minor: road, bridges_link: road, bridges_major: road, bridges_highway: highway,
    railway: on(t["ink-3"], 0.55), boundaries: on(t["ink-3"], 0.5),
    roads_label_minor: t["ink-3"], roads_label_minor_halo: t["paper-0"], roads_label_major: t["ink-2"], roads_label_major_halo: t["paper-0"],
    ocean_label: waterInk, subplace_label: t["ink-3"], subplace_label_halo: t.paper,
    city_label: t["ink-2"], city_label_halo: t.paper, state_label: t["ink-3"], state_label_halo: t.paper, country_label: t["ink-3"],
    address_label: t["ink-3"], address_label_halo: t.paper,
    landcover: {
      forest: on(t.green, 0.09), grassland: on(t.green, 0.05), scrub: on(t.green, 0.06),
      farmland: on(t.ochre, 0.05), barren: on(t.ochre, 0.04), urban_area: t["paper-2"], glacier: t["paper-0"],
    },
    regular: FONTS.regular, bold: FONTS.bold, italic: FONTS.italic,
  };
}

// a #rrggbb colour with an alpha, for MapLibre
const rgba = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${a})`;

export function baseStyle() {
  const t = tokens();
  const f = flavor(t);
  const sources = {};
  const all = [];
  for (const [name, minzoom, maxzoom, tMin, tMax] of LEVELS) {
    sources[name] = {
      type: "vector",
      tiles: [`pmtiles://${MAP_URL}/{z}/{x}/{y}`],
      minzoom, maxzoom,
      ...(name === "world" ? { attribution: ATTRIBUTION } : {}),
    };
    sources[`terrain-${name}`] = {
      type: "raster-dem",
      tiles: [`pmtiles://${TERRAIN_URL}/{z}/{x}/{y}`],
      encoding: "terrarium", tileSize: 512, minzoom: tMin, maxzoom: tMax,
    };
    for (const layer of layers(name, f, { lang: "en" })) {
      if (SKIP.has(layer.id)) continue;
      if (layer.type === "background" && name !== "world") continue;
      const copy = { ...layer, id: `${name}-${layer.id}` };
      if (copy.layout && copy.layout["icon-image"]) {
        const { "icon-image": _, ...rest } = copy.layout; // town dots need a sprite; keep the names
        copy.layout = rest;
      }
      all.push(copy);
      if (layer.id === "water") {
        all.push({
          id: `${name}-hillshade`, type: "hillshade", source: `terrain-${name}`,
          paint: {
            "hillshade-method": "igor",
            "hillshade-shadow-color": rgba(t.ink, 0.34),
            "hillshade-highlight-color": rgba(t["paper-0"], 0.4),
            "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 12, 0.35],
          },
        });
      }
    }
  }
  return {
    version: 8,
    sources,
    "font-faces": { [FONTS.regular]: face("inter-normal"), [FONTS.bold]: face("inter-normal"), [FONTS.italic]: face("fraunces-italic") },
    layers: all,
  };
}

// a MapLibre map with our base map; extra options go to MapLibre
export function createMap(container, options = {}) {
  if (!protocolReady) {
    addProtocol("pmtiles", new window.pmtiles.Protocol().tile);
    protocolReady = true;
  }
  const map = new MapLibreMap({ container, style: baseStyle(), attributionControl: false, maxZoom: 16, ...options });
  map.addControl(new AttributionControl({ compact: true }), "bottom-right");
  return map;
}
