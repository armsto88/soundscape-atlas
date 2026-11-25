// The atlas: the map, and beside it the places as an accordion
// (country › state › area › site). Opening a section flies the map to it,
// closing it zooms back out a level. Clicking a place shows a small card.
// The places are a layer of the map, so their labels make room for each other.
//
// Above the places, a search for a bird or frog: picking one replaces the
// accordion with the places and sessions it was heard in (?species= in the
// address), dims the other places and rings each place by how many of its
// hours had the species.

import { el, append, plural, fmtInt, humanize, fmtDay, fmtClock, info, svg } from "./util.js";
import { LngLatBounds, Marker, NavigationControl, ScaleControl } from "../vendor/maplibre-gl.mjs";
import { createMap, tokens, mix, FONTS } from "./map.js";
import { quickListen, speciesPlaces, findSpecies, callingHours, mostlyWhen, MIN_CALLS } from "./data.js";
import { hasSupport, supportLink } from "./support.js";
import { createSpeciesSearch, lensCard, whenStrip } from "./search.js";

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
  const fly = (bounds, duration = 800) => {
    if (bounds.isEmpty()) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    if (sw.lng === ne.lng && sw.lat === ne.lat) map.flyTo({ center: bounds.getCenter(), zoom: 10, duration });
    else map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration });
  };
  let picked = (params && params.species && model.speciesByKey.get(params.species)) || null; // the species searched for

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
  let cardSite = null;
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
    cardSite = site;
    const facts = [humanize(site.habitat), humanize(site.biome), site.elevation_m ? `${site.elevation_m} m` : ""].filter(Boolean).join(" · ");
    const heard = site.species.length ? ` · ${plural(site.species.length, "species")}` : "";
    // the species searched for, here (not where only its area may be named)
    const here = picked && site.heard.get(picked);
    const listed = here && here.counts && !here.areaOnly;
    const openHref = `#/site/${encodeURIComponent(site.id)}${listed ? `?species=${encodeURIComponent(picked.key)}` : ""}`;
    append(card, [
      el("button", { class: "site-card-close", type: "button", "aria-label": "Close", onclick: closeCard }, "×"),
      el("p", { class: "eyebrow" }, [site.locality, site.area || site.state].filter(Boolean).join(" · ")),
      el("h2", {}, site.site_name),
      facts ? el("p", { class: "muted card-facts" }, facts) : null,
      el("p", { class: "muted" }, `${plural(site.sessions.length, "session")} · ${plural(site.hours, "hour")}${heard}`),
      listed ? el("p", { class: "card-species" }, el("b", {}, picked.name), ` here: ${plural(here.calls, "call")} in ${here.hours} of ${plural(site.hours, "hour")}`) : null,
      site.description ? el("p", { class: "card-desc" }, site.description) : null,
      hasSupport(site) ? el("p", { class: "card-desc card-support" }, supportLink(site, `Support ${site.support.name}`)) : null,
      site.public_location_precision !== "exact" ? el("p", { class: "note card-desc" }, "Shown at an approximate location.") : null,
      el("div", { class: "card-foot" }, listenRow(site), el("a", { class: "card-open", href: openHref }, "Open site →")),
    ]);
    card.hidden = false;
    select(site.id);
    for (const [id, row] of rowsBySite) row.classList.toggle("selected", id === site.id);
    for (const b of lensEl.querySelectorAll(".lens-place-name")) b.classList.toggle("selected", b.dataset.site === site.id);
    ctx.state.atlasSelected = site.id;
  };
  function closeCard() {
    card.hidden = true;
    cardSite = null;
    select(null);
    for (const row of rowsBySite.values()) row.classList.remove("selected");
    for (const b of lensEl.querySelectorAll(".lens-place-name")) b.classList.remove("selected");
    ctx.state.atlasSelected = null;
  }

  // ---- the species search ----------------------------------------------------
  // A place is listed for a species once it has MIN_CALLS calls there (or one
  // checked by ear). For a species on a sensitive list, only the areas are named.
  const findWrap = el("div", { class: "atlas-find" });
  const lensEl = el("div", { class: "lens-results", hidden: true });
  const accEl = el("div", { class: "acc" });
  index.append(findWrap, lensEl, accEl);
  const searchable = model.species.filter((sp) => speciesPlaces(sp).length > 0);
  const sessionsIn = (places) => places.reduce((n, p) => n + p.sessions.length, 0);
  if (searchable.length) {
    const search = createSpeciesSearch({
      id: "atlas-find",
      label: "Find a bird or frog",
      source: (text) => ({
        items: findSpecies(searchable, text)
          .map((x) => ({ ...x, places: speciesPlaces(x.sp) }))
          .sort((a, b) => a.score - b.score || b.places.length - a.places.length || a.sp.name.localeCompare(b.sp.name))
          .map((x) => ({
            sp: x.sp,
            meta: x.places.every((p) => p.areaOnly) ? plural(sessionsIn(x.places), "session") : `${plural(x.places.length, "place")} · ${plural(sessionsIn(x.places), "session")}`,
          })),
        empty: "Not heard in the recordings published so far.",
      }),
      onPick: (sp) => pick(sp),
    });
    findWrap.append(search.el);
  }

  function pick(sp) {
    picked = sp;
    ctx.replace(sp ? `#/?species=${encodeURIComponent(sp.key)}` : "#/");
    renderLens();
    applyLens();
    if (cardSite) openCard(cardSite);
    if (!sp) return;
    index.scrollTop = 0;
    const around = lensSites(sp);
    if (around.length) fly(boundsOf(around));
  }
  // Where a species on a sensitive list may be named: its area if the area has more
  // than one published place, else its state, else its country; a region holding
  // a single place would name the place. null: too few places to name anything.
  function safeRegion(site) {
    const pub = model.publishedSites;
    const inArea = site.area ? pub.filter((s) => s.country === site.country && s.state === site.state && s.area === site.area) : [];
    if (inArea.length > 1) return { name: site.area, sites: inArea };
    const inState = pub.filter((s) => s.country === site.country && s.state === site.state);
    if (inState.length > 1) return { name: site.state, sites: inState };
    const inCountry = pub.filter((s) => s.country === site.country);
    return inCountry.length > 1 ? { name: site.country, sites: inCountry } : null;
  }

  // the places to show the map around: where the species is listed, or else its regions
  function lensSites(sp) {
    const places = speciesPlaces(sp);
    const shown = places.filter((p) => !p.areaOnly).map((p) => p.site);
    if (shown.length) return shown;
    const around = new Set();
    for (const p of places) for (const s of safeRegion(p.site)?.sites || []) around.add(s);
    return [...around];
  }

  // places grouped as in the accordion: an area, or a state for places without one
  function byArea(places) {
    const groups = [];
    for (const country of model.tree) {
      for (const state of country.children) {
        const inState = places.filter((p) => p.site.country === country.name && p.site.state === state.name);
        const direct = inState.filter((p) => !p.site.area);
        if (direct.length) groups.push({ name: state.name, places: direct });
        for (const area of state.children) {
          const inArea = inState.filter((p) => p.site.area === area.name);
          if (inArea.length) groups.push({ name: area.name, places: inArea });
        }
      }
    }
    return groups;
  }

  function nightsOf(session) {
    const out = [];
    session.sky.forEach((ev, i) => {
      if (!ev.set) return;
      const rise = session.sky.slice(i + 1).find((x) => !x.set);
      const a = Math.max(session.start, ev.t);
      const b = Math.min(session.end, rise ? rise.t : session.end);
      if (b > a) out.push([a, b]);
    });
    return out;
  }
  // the session from start to end, night shaded, with a mark where the species called
  function sessionStrip(e) {
    const s = e.session;
    const span = s.end - s.start;
    const X = (t) => ((t - s.start) / span) * 300;
    const strip = svg("svg", { class: "lens-strip", viewBox: "0 0 300 8", preserveAspectRatio: "none", "aria-hidden": "true" });
    strip.append(svg("rect", { class: "bg", x: "0", y: "0", width: "300", height: "8" }));
    for (const [a, b] of nightsOf(s)) strip.append(svg("rect", { class: "night", x: X(a).toFixed(2), y: "0", width: (X(b) - X(a)).toFixed(2), height: "8" }));
    for (const [a, b] of e.marks) strip.append(svg("rect", { class: "mark", x: X(a).toFixed(2), y: "0", width: Math.max(1.2, X(b) - X(a)).toFixed(2), height: "8" }));
    return strip;
  }

  function sessionRow(site, e) {
    const day = fmtDay(e.session.start, { weekday: false });
    const href = `#/site/${encodeURIComponent(site.id)}?species=${encodeURIComponent(picked.key)}&at=${encodeURIComponent(e.best.seg.segment_id)}`;
    return el("li", { class: "lens-session" },
      el("a", { class: "lens-open", href, "aria-label": `${day}: ${plural(e.calls, "call")} in ${plural(e.hours, "hour")}. Open this session` },
        el("span", { class: "lens-line" }, el("span", {}, day), el("span", {}, `${plural(e.calls, "call")} · ${e.hours} h`)),
        sessionStrip(e)),
      e.best.seg.public_url ? el("button", {
        class: "lens-play", type: "button", html: ICON_PLAY,
        "aria-label": `Play the clearest call on ${day}, at ${fmtClock(e.best.t)}`,
        onclick: () => ctx.player.load(e.best.seg, { autoplay: true, at: Math.max(0, e.best.sec - 3) }),
      }) : null);
  }

  function placeBlock(p) {
    const site = p.site;
    const without = site.sessions.length - p.sessions.length;
    return el("div", { class: "lens-place" },
      el("div", { class: "lens-place-head" },
        el("button", { class: `lens-place-name${cardSite === site ? " selected" : ""}`, type: "button", "data-site": site.id, onclick: () => {
          map.flyTo({ center: [site.longitude, site.latitude], zoom: Math.max(map.getZoom(), 10), duration: 800 });
          openCard(site);
        } }, site.site_name),
        el("small", {}, `${plural(p.calls, "call")} · ${p.hours} of ${site.hours} h`)),
      el("ul", { class: "lens-sessions" }, p.sessions.map((e) => sessionRow(site, e))),
      without > 0 ? el("p", { class: "lens-note" }, `Not heard in ${plural(without, "other session")} here.`) : null);
  }

  function renderLens() {
    accEl.hidden = Boolean(picked);
    lensEl.hidden = !picked;
    lensEl.innerHTML = "";
    if (!picked) return;
    const places = speciesPlaces(picked);
    const shown = places.filter((p) => !p.areaOnly);
    const hidden = places.filter((p) => p.areaOnly);
    const counts = callingHours(places.flatMap((p) => p.sessions));
    const when = mostlyWhen(counts);
    const help = info("the species search",
      el("p", {}, `A place is listed when BirdNET found at least ${MIN_CALLS} calls of the species there, or one was checked by ear. BirdNET names species automatically and can be wrong.`),
      el("p", {}, "The ring around a place on the map shows how many of its published hours had the species. Each session's strip runs from its start to its end, with night shaded and a mark wherever the species called; ▶ plays its clearest call."),
      el("p", {}, "Species on a sensitive-species list (kept by the NSW and Queensland governments and by BirdLife Australia) are left out wherever a place is mapped more precisely than the list allows; elsewhere only the wider region is named, to protect their nests and roosts."));
    const summary = shown.length ? `Heard at ${plural(shown.length, "place")}, in ${plural(sessionsIn(shown), "session")}`
      : hidden.length ? `Heard in ${plural(sessionsIn(hidden), "session")}`
      : "Not heard often enough at any place to list it.";
    lensEl.append(lensCard(picked, {
      onClear: () => pick(null),
      children: [
        el("p", { class: "lens-text" }, summary, when ? ` · ${when}` : "", " ", help.button),
        help.panel,
        when ? whenStrip(counts, `When it called, by hour of the day: ${when}`) : null,
      ],
    }));
    for (const group of byArea(shown)) lensEl.append(el("section", { class: "lens-area" }, el("h3", {}, group.name), group.places.map(placeBlock)));
    if (hidden.length) {
      const regions = new Map(); // region name ("" when none may be named) -> sessions
      for (const p of hidden) {
        const name = safeRegion(p.site)?.name || "";
        regions.set(name, (regions.get(name) || 0) + p.sessions.length);
      }
      lensEl.append(el("section", { class: "lens-protected" },
        el("p", {}, "This species is on a sensitive-species list, so the places where it was heard are not shown, only the wider region."),
        el("ul", {}, [...regions].map(([name, n]) => el("li", {}, name ? el("b", {}, name) : "A region not named", ` · ${plural(n, "session")}`)))));
    }
  }

  // the map's side of it: dim the places without the species, ring the others
  function applyLens() {
    const lit = new Map();
    if (picked) for (const p of speciesPlaces(picked)) if (!p.areaOnly) lit.set(p.site.id, p.hours / Math.max(1, p.site.hours));
    for (const entry of entries) entry.pill.getElement().classList.toggle("dim", Boolean(picked) && !entry.group.sites.some((s) => lit.has(s.id)));
    for (const site of model.publishedSites) setState(site.id, { dim: Boolean(picked) && !lit.has(site.id), lit: lit.has(site.id), share: lit.get(site.id) || 0 });
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
    const row = picked ? lensEl.querySelector(`.lens-place-name[data-site="${CSS.escape(site.id)}"]`) : rowsBySite.get(site.id);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  for (const country of model.tree) accEl.append(section(country, `c:${country.name}`, null, 0));
  if (!model.tree.length) {
    accEl.append(el("p", { class: "atlas-empty" }, "No recordings are published yet. The first places will appear here soon."));
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
      el("span", { class: "region-pill" }, el("b", {}, group.name), el("small", {}, `${plural(group.sites.length, "place")} · ${fmtInt(hours)} h`)));
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
    if (changed && ready) {
      map.getSource("places").setData(placesData());
      applyLens();
    }
  };

  map.on("load", () => {
    const t = tokens();
    const hot = ["any", ["boolean", ["feature-state", "selected"], false], ["boolean", ["feature-state", "hover"], false]];
    // with a species searched for: places without it are dimmed, places with it ringed
    const dim = ["boolean", ["feature-state", "dim"], false];
    const lit = ["boolean", ["feature-state", "lit"], false];
    map.addSource("places", { type: "geojson", data: placesData(), promoteId: "id" });
    map.addLayer({ id: "places-share", type: "circle", source: "places", paint: {
      "circle-radius": ["+", 11, ["*", 22, ["sqrt", ["number", ["feature-state", "share"], 0]]]],
      "circle-color": t.ochre, "circle-opacity": ["case", lit, 0.22, 0],
      "circle-stroke-width": 1.2, "circle-stroke-color": t["ochre-deep"], "circle-stroke-opacity": ["case", lit, 0.8, 0],
    } });
    // An ink edge, then the dot with a paper rim; approximate places are an open ochre ring.
    // The place picked turns deep ochre inside a soft ochre disc, and its name is marked
    // as with a highlighter (ochre, like every selection on the site; the text stays ink).
    const sel = ["boolean", ["feature-state", "selected"], false];
    const hover = ["boolean", ["feature-state", "hover"], false];
    map.addLayer({ id: "places-ring", type: "circle", source: "places", paint: {
      "circle-radius": ["case", sel, 15, 10],
      "circle-color": ["case", sel, t.ochre, t.ink],
      "circle-opacity": ["case", sel, 0.3, ["any", ["get", "approx"], dim], 0, 1],
    } });
    map.addLayer({ id: "places-dot", type: "circle", source: "places", paint: {
      "circle-radius": ["case", sel, ["case", ["get", "approx"], 8.5, 7.5], dim, 4.5, ["get", "approx"], 8, 6.5],
      "circle-color": ["case", ["get", "approx"], "rgba(0, 0, 0, 0)", sel, t["ochre-deep"], dim, t.paper, t.ochre],
      "circle-stroke-width": ["case", sel, 2.5, dim, 1.3, ["get", "approx"], 2, 2.5],
      "circle-stroke-color": ["case", ["all", sel, ["get", "approx"]], t["ochre-deep"], sel, t.paper, dim, t["ink-3"], ["get", "approx"], t.ochre, t.paper],
    } });
    map.addLayer({ id: "places-label", type: "symbol", source: "places", layout: {
      "text-field": ["get", "name"], "text-font": [FONTS.bold], "text-size": 12.5,
      "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 1.15, "text-justify": "auto",
    }, paint: {
      "text-color": t.ink,
      "text-halo-color": ["case", sel, mix(t.ochre, t.paper, 0.5), hover, mix(t.ochre, t.paper, 0.25), t.paper],
      "text-halo-width": ["case", hot, 3, 1.6],
      "text-halo-blur": ["case", hot, 0.5, 0],
      "text-opacity": ["case", hot, 1, dim, 0.5, 1],
    } });
    ready = true;
    setState(selected, { selected: true });
    updatePills();
    applyLens();
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
  // leaving the map ends the hover, or the label would stay highlighted like a selection
  map.on("mouseout", () => {
    setState(hovered, { hover: false });
    hovered = null;
    map.getCanvas().style.cursor = "";
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

  // a species in the address: show it, and the map around where it was heard
  if (picked) {
    renderLens();
    applyLens();
    if (!saved && !(params && params.focus)) {
      const around = lensSites(picked);
      if (around.length) fly(boundsOf(around), 0);
    }
  }

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
