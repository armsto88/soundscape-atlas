// The atlas: a map of the places, with named regions at low zoom and labelled
// site markers when a region is zoomed in, plus an index list beside it.
// Clicking a site opens a card with a listen button and a link to the place.

import { el, append, plural, fmtInt, humanize } from "./util.js";
import { listenHour } from "./data.js";

const TOPO_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";
const TOPO_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS";
const PILL_RADIUS_PX = 44; // sites closer than this collapse into their region pill

export function render(main, model, params, ctx) {
  const index = el("aside", { class: "atlas-index" });
  const mapEl = el("div", { class: "atlas-map", "aria-label": "Map of recording places" });
  const card = el("div", { class: "site-card", hidden: true });
  const mapWrap = el("div", { class: "atlas-mapwrap" }, mapEl, card);
  main.append(el("section", { class: "atlas" }, index, mapWrap));

  index.append(
    el("p", { class: "atlas-intro" },
      "Hour-long recordings of forests, wetlands and bogs, one night at a time. ",
      "Choose a place, then an hour of the night."),
    el("p", { class: "atlas-totals" },
      `${plural(model.totals.sites, "place")} · ${plural(model.totals.nights, "night")} · ${plural(model.totals.hours, "hour")} of listening`));

  const map = L.map(mapEl, { zoomControl: true, worldCopyJump: true });
  L.control.scale({ imperial: false }).addTo(map);
  L.tileLayer(TOPO_URL, { maxZoom: 17, attribution: TOPO_ATTRIBUTION }).addTo(map);

  const markersBySite = new Map();
  const regionLayers = [];

  const openCard = (site) => {
    card.innerHTML = "";
    const hour = listenHour(site);
    const facts = [humanize(site.habitat), humanize(site.biome), site.elevation_m ? `${site.elevation_m} m` : ""].filter(Boolean).join(" · ");
    append(card, [
      el("button", { class: "site-card-close", type: "button", "aria-label": "Close", onclick: closeCard }, "×"),
      el("p", { class: "eyebrow" }, [site.locality, site.region].filter(Boolean).join(" · ")),
      el("h2", {}, site.site_name),
      facts ? el("p", { class: "muted" }, facts) : null,
      el("p", { class: "muted" }, `${plural(site.nights.length, "night")} · ${plural(site.hours, "hour")}${site.hasDetections ? ` · ${plural(site.topSpecies.length, "species")} heard` : ""}`),
      site.description ? el("p", {}, site.description) : null,
      site.public_location_precision !== "exact" ? el("p", { class: "note" }, "Shown at an approximate location.") : null,
      el("div", { class: "actions" },
        hour
          ? el("button", { class: "btn btn-primary", type: "button", onclick: () => { ctx.player.load(hour, { autoplay: true }); ctx.navigate(`#/hour/${encodeURIComponent(hour.segment_id)}`); } },
            hour.period === "dawn" ? "Listen to the dawn" : "Listen")
          : null,
        el("a", { class: "btn", href: `#/site/${encodeURIComponent(site.id)}` }, "All nights →"))]);
    card.hidden = false;
    for (const [id, marker] of markersBySite) marker.getElement()?.classList.toggle("selected", id === site.id);
  };
  const closeCard = () => {
    card.hidden = true;
    for (const marker of markersBySite.values()) marker.getElement()?.classList.remove("selected");
  };
  map.on("click", closeCard);

  const allPoints = [];
  for (const country of model.countries) {
    const countryEl = el("section", { class: "index-country" }, el("h2", {}, country.name));
    for (const region of country.regions) {
      const list = el("ul", { class: "index-sites" });
      const regionEl = el("div", { class: "index-region" },
        el("h3", {}, region.name, el("small", {}, `${plural(region.sites.length, "place")} · ${fmtInt(region.hours)} h`)), list);
      countryEl.append(regionEl);

      const siteLayer = L.layerGroup();
      const points = [];
      for (const site of region.sites) {
        const latlng = [site.latitude, site.longitude];
        points.push(latlng);
        allPoints.push(latlng);
        const approx = site.public_location_precision !== "exact";
        const marker = L.marker(latlng, {
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
          openCard(site);
        });
        marker.addTo(siteLayer);
        markersBySite.set(site.id, marker);

        list.append(el("li", {},
          el("button", { class: "index-site", type: "button", onclick: () => {
            map.flyTo(latlng, Math.max(map.getZoom(), 11), { duration: 0.8 });
            openCard(site);
          } },
            el("span", {}, site.site_name),
            el("small", {}, `${plural(site.nights.length, "night")} · ${fmtInt(site.hours)} h`))));
      }
      const bounds = L.latLngBounds(points);
      const pill = L.marker(bounds.getCenter(), {
        icon: L.divIcon({
          className: "region-marker",
          html: `<span class="region-pill"><b>${escapeHtml(region.name)}</b><small>${plural(region.sites.length, "place")} · ${fmtInt(region.hours)} h</small></span>`,
          iconSize: null,
        }),
        zIndexOffset: 1000,
        title: region.name,
      });
      pill.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        map.flyToBounds(bounds, { padding: [70, 70], maxZoom: 12, duration: 0.8 });
      });
      regionLayers.push({ region, points, bounds, pill, siteLayer, showing: null });
    }
    index.append(countryEl);
  }

  // Region pill or individual markers, depending on how far apart the sites
  // are on screen at the current zoom.
  const updateLayers = () => {
    for (const entry of regionLayers) {
      let collapse = false;
      if (entry.points.length > 1) {
        const px = entry.points.map((p) => map.latLngToLayerPoint(p));
        const cx = px.reduce((s, p) => s + p.x, 0) / px.length;
        const cy = px.reduce((s, p) => s + p.y, 0) / px.length;
        const spread = Math.max(...px.map((p) => Math.hypot(p.x - cx, p.y - cy)));
        collapse = spread < PILL_RADIUS_PX;
      }
      const want = collapse ? "pill" : "sites";
      if (entry.showing === want) continue;
      entry.showing = want;
      if (collapse) {
        map.removeLayer(entry.siteLayer);
        entry.pill.addTo(map);
      } else {
        map.removeLayer(entry.pill);
        entry.siteLayer.addTo(map);
      }
    }
  };

  const saved = ctx.state.atlasView;
  if (saved) map.setView(saved.center, saved.zoom);
  else if (allPoints.length) map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
  else map.setView([0, 0], 2);
  updateLayers();
  map.on("zoomend moveend", () => {
    ctx.state.atlasView = { center: map.getCenter(), zoom: map.getZoom() };
    updateLayers();
  });
  if (params && params.focus) {
    const site = model.sites.get(params.focus);
    if (site) {
      map.setView([site.latitude, site.longitude], 11);
      openCard(site);
    }
  }

  return {
    destroy() {
      map.remove();
    },
  };
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
