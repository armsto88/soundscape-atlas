// The atlas: the map, and beside it the places as an accordion
// (country › state › area › site). Opening a section flies the map to it,
// closing it zooms back out a level. Clicking a place shows a small card.
// The places are a layer of the map, so their labels make room for each other.

import { el, append, plural, fmtInt, humanize, fmtDay, fmtClock } from "./util.js";
import { LngLatBounds, Marker, NavigationControl, ScaleControl } from "../vendor/maplibre-gl.mjs";
import { createMap, tokens, FONTS } from "./map.js";
import { quickListen } from "./data.js";

const PILL_RADIUS_PX = 44; // a group's sites closer than this on screen collapse into one pill
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';
const PLACE_LAYERS = ["places-label", "places-dot", "places-ring"];

export function render(main, model, params, ctx) {
  const index = el("nav", { class: "atlas-index", "aria-label": "Places" });
  const mapEl = el("div", { class: "atlas-map", "aria-label": "Map of recording places" });
  const card = el("div", { class: "site-card", hidden: true });
  main.append(el("section", { class: "atlas" }, index, el("div", { class: "atlas-mapwrap" }, mapEl, card)));

  const map = createMap(mapEl);
  map.addControl(new NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

  const boundsOf = (sites) => sites.reduce((b, s) => b.extend([s.longitude, s.latitude]), new LngLatBounds());
  const allBounds = boundsOf(model.publishedSites);
  const fly = (bounds) => {
    if (bounds.isEmpty()) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    if (sw.lng === ne.lng && sw.lat === ne.lat) map.flyTo({ center: bounds.getCenter(), zoom: 10, duration: 800 });
    else map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 800 });
  };

  // ---- the places layer ------------------------------------------------------
  let ready = false;
  let selected = null;
  let hovered = null;
  const setState = (id, state) => { if (ready && id) map.setFeatureState({ source: "places", id }, state); };
  const select = (id) => {
    setState(selected, { selected: false });
    selected = id;
    setState(selected, { selected: true });
  };

  // ---- the card ------------------------------------------------------------
  const rowsBySite = new Map();
  let cardPlay = null; // { button, site } for the card's play button, if it has one
  const playingHere = (site) => ctx.player.isPlaying && ctx.player.segment && ctx.player.segment.site === site;
  const showCardPlay = () => {
    if (!cardPlay) return;
    const on = playingHere(cardPlay.site);
    cardPlay.button.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    cardPlay.button.setAttribute("aria-label", on ? "Pause" : `Listen: ${cardPlay.label}`);
  };
  // one tap to hear a place: its featured hour, or its liveliest dawn from before sunrise
  const listenRow = (site) => {
    const quick = quickListen(site);
    if (!quick) return null;
    const label = quick.kind === "dawn" ? "Dawn chorus" : humanize(quick.seg.period) || "Listen";
    const button = el("button", { class: "card-play", type: "button", onclick: () => {
      if (playingHere(site)) ctx.player.pause();
      else if (ctx.player.segment && ctx.player.segment.site === site) ctx.player.play(); // paused here: carry on
      else ctx.player.load(quick.seg, { autoplay: true, at: quick.at });
    } });
    cardPlay = { button, site, label };
    showCardPlay();
    return el("div", { class: "card-listen" }, button,
      el("div", { class: "card-listen-text" }, el("b", {}, label), el("span", {}, `${fmtDay(quick.moment, { weekday: false })}, from ${fmtClock(quick.moment)}`)));
  };
  const openCard = (site) => {
    card.innerHTML = "";
    cardPlay = null;
    const facts = [humanize(site.habitat), humanize(site.biome), site.elevation_m ? `${site.elevation_m} m` : ""].filter(Boolean).join(" · ");
    const heard = site.species.length ? ` · ${plural(site.species.length, "species")}` : "";
    append(card, [
      el("button", { class: "site-card-close", type: "button", "aria-label": "Close", onclick: closeCard }, "×"),
      el("p", { class: "eyebrow" }, [site.locality, site.area || site.state].filter(Boolean).join(" · ")),
      el("h2", {}, site.site_name),
      facts ? el("p", { class: "muted card-facts" }, facts) : null,
      el("p", { class: "muted" }, `${plural(site.sessions.length, "session")} · ${plural(site.hours, "hour")}${heard}`),
      site.description ? el("p", { class: "card-desc" }, site.description) : null,
      site.public_location_precision !== "exact" ? el("p", { class: "note card-desc" }, "Shown at an approximate location.") : null,
      el("div", { class: "card-foot" }, listenRow(site), el("a", { class: "card-open", href: `#/site/${encodeURIComponent(site.id)}` }, "Open site →")),
    ]);
    card.hidden = false;
    select(site.id);
    for (const [id, row] of rowsBySite) row.classList.toggle("selected", id === site.id);
    ctx.state.atlasSelected = site.id;
  };
  function closeCard() {
    card.hidden = true;
    select(null);
    for (const row of rowsBySite.values()) row.classList.remove("selected");
    ctx.state.atlasSelected = null;
  }

  // ---- the accordion -------------------------------------------------------
  const open = ctx.state.atlasOpen || (ctx.state.atlasOpen = new Set(model.tree.map((c) => `c:${c.name}`)));
  const sectionEls = new Map(); // key -> { node, wrap, button, parentKey }

  const siteRow = (site) => {
    const row = el("button", { class: "acc-site", type: "button", onclick: () => {
      map.flyTo({ center: [site.longitude, site.latitude], zoom: Math.max(map.getZoom(), 10), duration: 800 });
      openCard(site);
    } }, el("span", {}, site.site_name), el("small", {}, `${plural(site.sessions.length, "session")} · ${fmtInt(site.hours)} h`));
    rowsBySite.set(site.id, row);
    return el("li", {}, row);
  };

  const section = (node, key, parentKey, depth) => {
    const body = el("div", { class: "acc-body" });
    const isOpen = open.has(key);
    const button = el("button", {
      class: `acc-head depth-${depth}`,
      type: "button",
      "aria-expanded": String(isOpen),
      onclick: () => toggle(key),
    },
      el("span", { class: "acc-chevron", "aria-hidden": "true" }),
      el("span", { class: "acc-name" }, node.name),
      el("small", {}, `${plural(node.sites.length, "place")} · ${fmtInt(node.hours)} h`));
    const wrap = el("div", { class: `acc-section depth-${depth}${isOpen ? " open" : ""}` }, button, body);
    if (node.children && node.children.length) {
      for (const child of node.children) body.append(section(child, `${key}/${child.kind[0]}:${child.name}`, key, depth + 1));
    }
    const leaves = node.kind === "area" ? node.sites : node.direct || [];
    if (leaves.length) body.append(el("ul", { class: "acc-sites" }, leaves.map(siteRow)));
    body.hidden = !isOpen;
    sectionEls.set(key, { node, wrap, button, body, parentKey });
    return wrap;
  };

  function setOpen(key, value) {
    const s = sectionEls.get(key);
    if (!s) return;
    if (value) open.add(key);
    else open.delete(key);
    s.wrap.classList.toggle("open", value);
    s.button.setAttribute("aria-expanded", String(value));
    s.body.hidden = !value;
  }
  function toggle(key) {
    const s = sectionEls.get(key);
    const opening = !open.has(key);
    setOpen(key, opening);
    if (opening) fly(boundsOf(s.node.sites));
    else {
      // close everything below it too, and step the map back out a level
      for (const k of [...open]) if (k.startsWith(`${key}/`)) setOpen(k, false);
      const parent = s.parentKey && sectionEls.get(s.parentKey);
      fly(parent ? boundsOf(parent.node.sites) : allBounds);
    }
  }
  // open the sections above a place, e.g. when it is clicked on the map
  function reveal(site) {
    for (const [key, s] of sectionEls) if (s.node.sites.includes(site) && !open.has(key)) setOpen(key, true);
    rowsBySite.get(site.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  for (const country of model.tree) index.append(section(country, `c:${country.name}`, null, 0));
  if (!model.tree.length) {
    index.append(el("p", { class: "atlas-empty" }, "No recordings are published yet. The first places will appear here soon."));
  }

  // ---- one pill per area (or state), or the places themselves ----------------
  const groups = new Map();
  for (const site of model.publishedSites) {
    const key = `${site.country}|${site.state}|${site.area}`;
    if (!groups.has(key)) groups.set(key, { name: site.area || site.state, sites: [] });
    groups.get(key).sites.push(site);
  }
  const entries = [];
  for (const group of groups.values()) {
    const bounds = boundsOf(group.sites);
    const hours = group.sites.reduce((n, s) => n + s.hours, 0);
    const pillEl = el("div", { class: "region-marker" },
      el("span", { class: "region-pill", title: group.name }, el("b", {}, group.name), el("small", {}, `${plural(group.sites.length, "place")} · ${fmtInt(hours)} h`)));
    pillEl.addEventListener("click", () => {
      reveal(group.sites[0]);
      fly(bounds);
    });
    entries.push({ group, pill: new Marker({ element: pillEl, anchor: "center" }).setLngLat(bounds.getCenter()), collapsed: null });
  }
  const placesData = () => ({
    type: "FeatureCollection",
    features: entries.filter((e) => !e.collapsed).flatMap((e) => e.group.sites.map((site) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [site.longitude, site.latitude] },
      properties: { id: site.id, name: site.site_name, approx: site.public_location_precision !== "exact" },
    }))),
  });
  const updatePills = () => {
    let changed = false;
    for (const entry of entries) {
      let collapse = false;
      if (entry.group.sites.length > 1) {
        const px = entry.group.sites.map((s) => map.project([s.longitude, s.latitude]));
        const cx = px.reduce((n, p) => n + p.x, 0) / px.length;
        const cy = px.reduce((n, p) => n + p.y, 0) / px.length;
        collapse = Math.max(...px.map((p) => Math.hypot(p.x - cx, p.y - cy))) < PILL_RADIUS_PX;
      }
      if (entry.collapsed === collapse) continue;
      entry.collapsed = collapse;
      changed = true;
      if (collapse) entry.pill.addTo(map);
      else entry.pill.remove();
    }
    if (changed && ready) map.getSource("places").setData(placesData());
  };

  map.on("load", () => {
    const t = tokens();
    const hot = ["any", ["boolean", ["feature-state", "selected"], false], ["boolean", ["feature-state", "hover"], false]];
    map.addSource("places", { type: "geojson", data: placesData(), promoteId: "id" });
    // an ink edge, then the dot with a paper rim; approximate places are an open ochre ring
    map.addLayer({ id: "places-ring", type: "circle", source: "places", paint: {
      "circle-radius": 10, "circle-color": t.ink, "circle-opacity": ["case", ["get", "approx"], 0, 1],
    } });
    map.addLayer({ id: "places-dot", type: "circle", source: "places", paint: {
      "circle-radius": ["case", ["get", "approx"], 8, 6.5],
      "circle-color": ["case", ["get", "approx"], "rgba(0, 0, 0, 0)", ["boolean", ["feature-state", "selected"], false], t.ink, t.ochre],
      "circle-stroke-width": ["case", ["get", "approx"], 2, 2.5],
      "circle-stroke-color": ["case", ["get", "approx"], t.ochre, t.paper],
    } });
    map.addLayer({ id: "places-label", type: "symbol", source: "places", layout: {
      "text-field": ["get", "name"], "text-font": [FONTS.bold], "text-size": 12.5,
      "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 1.15, "text-justify": "auto",
    }, paint: {
      "text-color": ["case", hot, t.paper, t.ink],
      "text-halo-color": ["case", hot, t.ink, t.paper],
      "text-halo-width": ["case", hot, 3, 1.6],
    } });
    ready = true;
    setState(selected, { selected: true });
    updatePills();
  });

  map.on("click", (event) => {
    if (event.originalEvent.target.closest?.(".region-marker")) return;
    const hit = ready && map.queryRenderedFeatures(event.point, { layers: PLACE_LAYERS })[0];
    const site = hit && model.sites.get(hit.properties.id);
    if (!site) return closeCard();
    reveal(site);
    openCard(site);
  });
  map.on("mousemove", (event) => {
    const hit = ready && map.queryRenderedFeatures(event.point, { layers: PLACE_LAYERS })[0];
    const id = hit ? hit.properties.id : null;
    if (id === hovered) return;
    setState(hovered, { hover: false });
    hovered = id;
    setState(hovered, { hover: true });
    map.getCanvas().style.cursor = id ? "pointer" : "";
  });

  const saved = ctx.state.atlasView;
  if (saved) map.jumpTo(saved);
  else if (!allBounds.isEmpty()) map.fitBounds(allBounds, { padding: 50, duration: 0 });
  map.on("moveend", () => {
    ctx.state.atlasView = { center: map.getCenter().toArray(), zoom: map.getZoom() };
    updatePills();
  });

  // ---- the place that is playing breathes ------------------------------------
  const pulse = new Marker({ element: el("div", { class: "place-pulse", "aria-hidden": "true" }), anchor: "center" });
  let pulsing = null;
  const onPlayer = () => {
    showCardPlay();
    const site = ctx.player.isPlaying && ctx.player.segment ? ctx.player.segment.site : null;
    if (site === pulsing) return;
    pulsing = site;
    if (site) pulse.setLngLat([site.longitude, site.latitude]).addTo(map);
    else pulse.remove();
  };
  ctx.player.addEventListener("state", onPlayer);
  onPlayer();

  const focus = params && params.focus ? model.sites.get(params.focus) : ctx.state.atlasSelected && model.sites.get(ctx.state.atlasSelected);
  if (focus) {
    if (params && params.focus && !saved) map.jumpTo({ center: [focus.longitude, focus.latitude], zoom: 10 });
    reveal(focus);
    openCard(focus);
  }

  return {
    destroy() {
      ctx.player.removeEventListener("state", onPlayer);
      map.remove();
    },
  };
}
