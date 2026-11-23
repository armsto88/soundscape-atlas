// The atlas: the map, and beside it the places as an accordion
// (country › state › area › site). Opening a section flies the map to it,
// closing it zooms back out a level. Clicking a place shows a small card.

import { el, append, plural, fmtInt, humanize, escapeHtml } from "./util.js";

const TOPO_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";
const TOPO_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS";
const PILL_RADIUS_PX = 44; // a group's sites closer than this on screen collapse into one pill

export function render(main, model, params, ctx) {
  const index = el("nav", { class: "atlas-index", "aria-label": "Places" });
  const mapEl = el("div", { class: "atlas-map", "aria-label": "Map of recording places" });
  const card = el("div", { class: "site-card", hidden: true });
  main.append(el("section", { class: "atlas" }, index, el("div", { class: "atlas-mapwrap" }, mapEl, card)));

  const map = L.map(mapEl, { zoomControl: true, worldCopyJump: true });
  L.control.scale({ imperial: false }).addTo(map);
  L.tileLayer(TOPO_URL, { maxZoom: 17, attribution: TOPO_ATTRIBUTION }).addTo(map);

  const allBounds = L.latLngBounds(model.publishedSites.map((s) => [s.latitude, s.longitude]));
  const boundsOf = (sites) => L.latLngBounds(sites.map((s) => [s.latitude, s.longitude]));
  const fly = (bounds) => {
    if (!bounds.isValid()) return;
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) map.flyTo(bounds.getCenter(), 11, { duration: 0.8 });
    else map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 12, duration: 0.8 });
  };

  // ---- the card ------------------------------------------------------------
  const markersBySite = new Map();
  const rowsBySite = new Map();
  const openCard = (site) => {
    card.innerHTML = "";
    const facts = [humanize(site.habitat), humanize(site.biome), site.elevation_m ? `${site.elevation_m} m` : ""].filter(Boolean).join(" · ");
    const heard = site.species.length ? ` · ${plural(site.species.length, "species")}` : "";
    append(card, [
      el("button", { class: "site-card-close", type: "button", "aria-label": "Close", onclick: closeCard }, "×"),
      el("p", { class: "eyebrow" }, [site.locality, site.area || site.state].filter(Boolean).join(" · ")),
      el("h2", {}, site.site_name),
      facts ? el("p", { class: "muted" }, facts) : null,
      el("p", { class: "muted" }, `${plural(site.sessions.length, "session")} · ${plural(site.hours, "hour")}${heard}`),
      site.description ? el("p", {}, site.description) : null,
      site.public_location_precision !== "exact" ? el("p", { class: "note" }, "Shown at an approximate location.") : null,
      el("div", { class: "actions" }, el("a", { class: "btn btn-primary", href: `#/site/${encodeURIComponent(site.id)}` }, "Open site")),
    ]);
    card.hidden = false;
    for (const [id, marker] of markersBySite) marker.getElement()?.classList.toggle("selected", id === site.id);
    for (const [id, row] of rowsBySite) row.classList.toggle("selected", id === site.id);
    ctx.state.atlasSelected = site.id;
  };
  function closeCard() {
    card.hidden = true;
    for (const marker of markersBySite.values()) marker.getElement()?.classList.remove("selected");
    for (const row of rowsBySite.values()) row.classList.remove("selected");
    ctx.state.atlasSelected = null;
  }
  map.on("click", closeCard);

  // ---- the accordion -------------------------------------------------------
  const open = ctx.state.atlasOpen || (ctx.state.atlasOpen = new Set(model.tree.map((c) => `c:${c.name}`)));
  const sectionEls = new Map(); // key -> { node, wrap, button, parentKey }

  const siteRow = (site) => {
    const row = el("button", { class: "acc-site", type: "button", onclick: () => {
      map.flyTo([site.latitude, site.longitude], Math.max(map.getZoom(), 11), { duration: 0.8 });
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
  // open the sections above a place, e.g. when its marker is clicked
  function reveal(site) {
    for (const [key, s] of sectionEls) if (s.node.sites.includes(site) && !open.has(key)) setOpen(key, true);
    rowsBySite.get(site.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  for (const country of model.tree) index.append(section(country, `c:${country.name}`, null, 0));
  if (!model.tree.length) {
    index.append(el("p", { class: "atlas-empty" }, "No recordings are published yet. The first places will appear here soon."));
  }

  // ---- map markers: one pill per area (or state), or the places themselves ----
  const groups = new Map();
  for (const site of model.publishedSites) {
    const key = `${site.country}|${site.state}|${site.area}`;
    if (!groups.has(key)) groups.set(key, { name: site.area || site.state, sites: [] });
    groups.get(key).sites.push(site);
  }
  const layers = [];
  for (const group of groups.values()) {
    const siteLayer = L.layerGroup();
    for (const site of group.sites) {
      const approx = site.public_location_precision !== "exact";
      const marker = L.marker([site.latitude, site.longitude], {
        icon: L.divIcon({
          className: "site-marker",
          html: `<span class="site-dot${approx ? " approx" : ""}"></span><span class="site-label">${escapeHtml(site.site_name)}</span>`,
          iconSize: null,
          iconAnchor: [9, 9],
        }),
        title: site.site_name,
        keyboard: true,
      });
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        reveal(site);
        openCard(site);
      });
      marker.addTo(siteLayer);
      markersBySite.set(site.id, marker);
    }
    const bounds = boundsOf(group.sites);
    const hours = group.sites.reduce((n, s) => n + s.hours, 0);
    const pill = L.marker(bounds.getCenter(), {
      icon: L.divIcon({
        className: "region-marker",
        html: `<span class="region-pill"><b>${escapeHtml(group.name)}</b><small>${plural(group.sites.length, "place")} · ${fmtInt(hours)} h</small></span>`,
        iconSize: null,
      }),
      zIndexOffset: 1000,
      title: group.name,
    });
    pill.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      reveal(group.sites[0]);
      fly(bounds);
    });
    layers.push({ points: group.sites.map((s) => [s.latitude, s.longitude]), pill, siteLayer, showing: null });
  }
  const updateLayers = () => {
    for (const entry of layers) {
      let collapse = false;
      if (entry.points.length > 1) {
        const px = entry.points.map((p) => map.latLngToLayerPoint(p));
        const cx = px.reduce((s, p) => s + p.x, 0) / px.length;
        const cy = px.reduce((s, p) => s + p.y, 0) / px.length;
        collapse = Math.max(...px.map((p) => Math.hypot(p.x - cx, p.y - cy))) < PILL_RADIUS_PX;
      }
      const want = collapse ? "pill" : "sites";
      if (entry.showing === want) continue;
      entry.showing = want;
      map.removeLayer(collapse ? entry.siteLayer : entry.pill);
      (collapse ? entry.pill : entry.siteLayer).addTo(map);
    }
  };

  const saved = ctx.state.atlasView;
  if (saved) map.setView(saved.center, saved.zoom);
  else if (allBounds.isValid()) map.fitBounds(allBounds, { padding: [50, 50] });
  else map.setView([0, 0], 2);
  updateLayers();
  map.on("zoomend moveend", () => {
    ctx.state.atlasView = { center: map.getCenter(), zoom: map.getZoom() };
    updateLayers();
  });

  const focus = params && params.focus ? model.sites.get(params.focus) : ctx.state.atlasSelected && model.sites.get(ctx.state.atlasSelected);
  if (focus) {
    if (params && params.focus && !saved) map.setView([focus.latitude, focus.longitude], 11);
    reveal(focus);
    openCard(focus);
  }

  return { destroy: () => map.remove() };
}
