// Entry point: loads the index, mounts the player and routes between the
// three screens by URL hash: #/ (atlas), #/site/<id>, #/hour/<id>, #/about.

import { el } from "./util.js";
import { loadModel } from "./data.js";
import { player } from "./player.js";
import * as atlas from "./atlas.js";
import * as site from "./site.js";
import * as hour from "./hour.js";
import { CREDIT } from "./site.js";

const state = { model: null, atlasView: null, current: null };
const ctx = {
  player,
  state,
  navigate(hash) {
    if (location.hash !== hash) location.hash = hash;
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
  if (state.current && state.current.destroy) state.current.destroy();
  state.current = null;
  main.innerHTML = "";
  document.body.dataset.screen = route.name;
  for (const link of document.querySelectorAll(".topbar nav a")) {
    link.classList.toggle("active", link.dataset.route === route.name || (route.name !== "about" && link.dataset.route === "atlas"));
  }
  if (!state.model) return;

  let title = "Soundscape Atlas";
  switch (route.name) {
    case "site": {
      state.current = site.render(main, state.model, route.params, ctx);
      const s = state.model.sites.get(route.params.id);
      if (s) title = `${s.site_name} · Soundscape Atlas`;
      break;
    }
    case "hour": {
      state.current = hour.render(main, state.model, route.params, ctx);
      const seg = state.model.segmentsById.get(route.params.id);
      if (seg) title = `${seg.site.site_name}, ${seg.local_date} ${String(seg.segment_start_local).slice(11, 16)} · Soundscape Atlas`;
      break;
    }
    case "about":
      renderAbout(main);
      title = "About · Soundscape Atlas";
      break;
    default:
      state.current = atlas.render(main, state.model, route.params, ctx);
  }
  document.title = title;
  if (route.name !== "atlas") window.scrollTo(0, 0);
}

function renderAbout(main) {
  main.append(el("article", { class: "page prose" },
    el("h1", {}, "About"),
    el("p", {}, "Soundscape Atlas is a listening archive of long field recordings. A recorder is left out from the afternoon through the night to the next morning, in forests, wetlands and bogs in eastern Australia and south-west Germany. Each night is cut into hours, and the hours here are the ones chosen for publication."),
    el("p", {}, "The species named on each hour's timeline were found automatically. " + CREDIT + " Hours marked as checked by ear have been confirmed by a person."),
    el("p", {}, "Recordings by Tom Armstrong. All rights reserved."),
  ));
}

async function boot() {
  player.mount(document.getElementById("player"));
  player.addEventListener("change", (event) => {
    // When the player moves on to the next hour by itself, the hour page follows.
    const route = parseRoute();
    if (route.name === "hour" && route.params.id !== event.detail.segment_id) {
      ctx.navigate(`#/hour/${encodeURIComponent(event.detail.segment_id)}`);
    }
  });
  window.addEventListener("hashchange", render);
  try {
    state.model = await loadModel();
  } catch (err) {
    document.getElementById("main").append(el("section", { class: "page" },
      el("h1", {}, "The atlas could not be loaded"),
      el("p", { class: "muted" }, String(err && err.message ? err.message : err))));
    return;
  }
  render();
}

boot();
