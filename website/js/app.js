// Entry point: loads the index, mounts the player and routes by URL hash:
// #/ (atlas), #/site/<id>?at=<segment id> (a place, opened at an hour),
// #/about. Old #/hour/<segment id> links, and ?segment=<id> links from the
// previous site, open the place at that hour.

import { el } from "./util.js";
import { loadModel } from "./data.js";
import { player } from "./player.js";
import * as atlas from "./atlas.js";
import * as site from "./site.js";

const state = { model: null, atlasView: null, atlasOpen: null, atlasSelected: null, current: null };
const ctx = {
  player,
  state,
  navigate(hash) {
    if (location.hash !== hash) location.hash = hash;
  },
  // change the address without re-rendering (e.g. moving through hours)
  replace(hash) {
    if (location.hash !== hash) history.replaceState(null, "", hash);
  },
};

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const [name, ...rest] = path.split("/");
  const params = Object.fromEntries(new URLSearchParams(query));
  params.id = decodeURIComponent(rest.join("/"));
  return { name: name || "atlas", params };
}

function render() {
  const main = document.getElementById("main");
  const route = parseRoute();
  if (route.name === "hour" && state.model) {
    const seg = state.model.segmentsById.get(route.params.id);
    location.replace(seg ? `#/site/${encodeURIComponent(seg.site.id)}?at=${encodeURIComponent(seg.segment_id)}` : "#/");
    return;
  }
  if (state.current && state.current.destroy) state.current.destroy();
  state.current = null;
  main.innerHTML = "";
  document.body.dataset.screen = route.name;
  for (const link of document.querySelectorAll(".topbar nav a")) {
    link.classList.toggle("active", link.dataset.route === (route.name === "about" ? "about" : "atlas"));
  }
  if (!state.model) return;

  let title = "Soundscape Atlas";
  if (route.name === "site") {
    state.current = site.render(main, state.model, route.params, ctx);
    const s = state.model.sites.get(route.params.id);
    if (s) title = `${s.site_name} · Soundscape Atlas`;
    if (!route.params.at) window.scrollTo(0, 0);
  } else if (route.name === "about") {
    renderAbout(main);
    title = "About · Soundscape Atlas";
    window.scrollTo(0, 0);
  } else {
    state.current = atlas.render(main, state.model, route.params, ctx);
  }
  document.title = title;
}

function renderAbout(main) {
  main.append(el("article", { class: "page prose" },
    el("h1", {}, "About"),
    el("p", {}, "Soundscape Atlas is a listening archive of dusk-till-dawn field recordings. A recorder is left out, usually from the afternoon through the night into the next morning, in forests, wetlands and bogs in eastern Australia and south-west Germany. Each recording session is cut into clock hours, and the hours here are the ones chosen for publication."),
    el("p", {}, "The species on each hour's timeline were identified automatically by BirdNET+ V3.0 (Cornell Lab of Ornithology and Chemnitz University of Technology) and may contain errors. Species marked as checked by ear have been confirmed by a person."),
    el("p", {}, "Bird plates are hand-cut 1800s illustrations by John Gould and others, from the Fugleramme project (CC BY-SA 4.0). Frogs are drawn in the same style from openly licensed photos (CC BY-SA 4.0). ",
      el("a", { href: "art/birds/CREDITS.md" }, "Bird credits"), " · ", el("a", { href: "art/frogs/CREDITS.md" }, "Frog credits"), "."),
    el("p", {}, "Map data © ", el("a", { href: "https://www.openstreetmap.org/copyright" }, "OpenStreetMap contributors"),
      ", drawn with ", el("a", { href: "https://protomaps.com" }, "Protomaps"), " and MapLibre. Relief from ",
      el("a", { href: "https://mapterhorn.com/attribution" }, "Mapterhorn"),
      ", built from open elevation data including Geoscience Australia (CC BY 4.0), GeoBasis-DE/LVGL-SL (Saarland) and LGL Baden-Württemberg (dl-de/by-2-0). ",
      "Weather at the time of each session from ", el("a", { href: "https://open-meteo.com" }, "Open-Meteo.com"), " (ERA5 reanalysis, CC BY 4.0). ",
      "Fonts: Inter and Fraunces (SIL Open Font License)."),
    el("p", {}, "Recordings by Tom Armstrong. All rights reserved.")));
}

async function boot() {
  player.mount(document.getElementById("player"));
  window.addEventListener("hashchange", render);
  try {
    state.model = await loadModel();
  } catch (err) {
    document.getElementById("main").append(el("section", { class: "page" },
      el("h1", {}, "The atlas could not be loaded"),
      el("p", { class: "muted" }, String(err && err.message ? err.message : err))));
    return;
  }
  // Links shared from the old site (?segment=<id>) open that hour on its place page.
  const legacy = new URLSearchParams(location.search).get("segment");
  if (legacy && state.model.segmentsById.has(legacy)) {
    const seg = state.model.segmentsById.get(legacy);
    history.replaceState(null, "", `${location.pathname}#/site/${encodeURIComponent(seg.site.id)}?at=${encodeURIComponent(legacy)}`);
  }
  render();
}

boot();
