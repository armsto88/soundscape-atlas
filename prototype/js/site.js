// A place: what and where it is, and one strip per recorded night on a shared
// noon-to-noon axis. Each hour is a bar you can play; bar height is the
// number of detections in that hour.

import { el, pct, plural, fmtInt, fmtDay, fmtClock, humanize, showTip, hideTip, HOUR } from "./util.js";
import { listenHour } from "./data.js";

const TOPO_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";

export function render(main, model, params, ctx) {
  const site = model.sites.get(params.id);
  if (!site) {
    main.append(el("section", { class: "page" }, el("p", { class: "back" }, el("a", { href: "#/" }, "← Atlas")), el("h1", {}, "Place not found")));
    return {};
  }

  const hour = listenHour(site);
  const facts = [humanize(site.habitat), humanize(site.biome), site.elevation_m ? `${site.elevation_m} m above sea level` : ""].filter(Boolean);
  const place = [site.locality, site.region, site.country].filter(Boolean).join(" · ");

  const insetEl = el("div", { class: "inset-map", "aria-hidden": "true" });
  const head = el("header", { class: "site-head" },
    el("div", {},
      el("p", { class: "back" }, el("a", { href: `#/?focus=${encodeURIComponent(site.id)}` }, "← Atlas")),
      el("p", { class: "eyebrow" }, place),
      el("h1", {}, site.site_name),
      el("p", { class: "facts" }, facts.join(" · ")),
      site.description ? el("p", { class: "lede" }, site.description) : null,
      site.public_location_precision !== "exact"
        ? el("p", { class: "note" }, "The map shows an approximate location to protect the site.")
        : null,
      el("p", { class: "muted" },
        `${plural(site.nights.length, "night")} · ${plural(site.hours, "hour")}` +
        (site.hasDetections ? ` · ${plural(site.topSpecies.length, "species")} heard so far` : " · species not yet identified")),
      hour
        ? el("div", { class: "actions" },
          el("button", { class: "btn btn-primary", type: "button", onclick: () => {
            ctx.player.load(hour, { autoplay: true });
            ctx.navigate(`#/hour/${encodeURIComponent(hour.segment_id)}`);
          } }, hour.period === "dawn" ? "Listen to the dawn" : "Listen"))
        : null),
    insetEl);

  const nightsEl = el("section", { class: "nights" },
    el("h2", {}, "Nights"),
    el("p", { class: "muted" }, "Each strip runs from noon to noon. The shaded band is the night, from sunset to sunrise. Tap an hour to listen."));
  const unsubscribe = [];
  for (const night of site.nights) nightsEl.append(nightStrip(night, site, ctx, unsubscribe));

  const speciesEl = site.hasDetections
    ? el("section", { class: "site-species" },
      el("h2", {}, "Most often heard here"),
      el("ul", { class: "chips" }, site.topSpecies.slice(0, 12).map((sp) =>
        el("li", { class: "chip" }, sp.name, sp.group && /amphibia/i.test(sp.group) ? el("small", {}, "frog") : null, el("b", {}, fmtInt(sp.count))))),
      el("p", { class: "credit" }, CREDIT))
    : null;

  main.append(el("article", { class: "page site" }, head, nightsEl, speciesEl));

  const inset = L.map(insetEl, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: false });
  L.tileLayer(TOPO_URL, { maxZoom: 17 }).addTo(inset);
  const approx = site.public_location_precision !== "exact";
  inset.setView([site.latitude, site.longitude], approx ? 9 : 11);
  if (approx) L.circle([site.latitude, site.longitude], { radius: site.public_location_precision === "coarse" ? 6000 : 700, color: "#c2913d", weight: 1.5, dashArray: "4 4", fillOpacity: 0.12 }).addTo(inset);
  else L.circleMarker([site.latitude, site.longitude], { radius: 7, color: "#2a2a26", weight: 1.5, fillColor: "#c2913d", fillOpacity: 1 }).addTo(inset);

  return {
    destroy() {
      inset.remove();
      for (const off of unsubscribe) off();
      hideTip();
    },
  };
}

export const CREDIT = "Species identified automatically by BirdNET+ V3.0 (Cornell Lab of Ornithology and Chemnitz University of Technology). May contain errors.";

function nightStrip(night, site, ctx, unsubscribe) {
  const span = night.axisEnd - night.axisStart;
  const x = (t) => pct(t - night.axisStart, span);
  const w = (a, b) => pct(b - a, span);
  const sameDay = fmtDay(night.start) === fmtDay(night.end);
  const dates = sameDay ? fmtDay(night.start) : `${fmtDay(night.start, { year: false })} → ${fmtDay(night.end)}`;

  const layers = el("div", { class: "strip-layers" });
  for (const [a, b] of night.nightBands) layers.append(el("div", { class: "strip-night", style: { left: x(a), width: w(a, b) } }));
  for (const [a, b] of [...night.dusks, ...night.dawns]) {
    const lo = Math.max(a, night.axisStart);
    const hi = Math.min(b, night.axisEnd);
    if (hi > lo) layers.append(el("div", { class: "strip-twilight", style: { left: x(lo), width: w(lo, hi) } }));
  }
  const suns = el("div", { class: "strip-suns" });
  for (const t of night.sunsets) if (t >= night.axisStart && t <= night.axisEnd) suns.append(el("span", { class: "strip-sun", style: { left: x(t) } }, `sunset ${fmtClock(t)}`));
  for (const t of night.sunrises) if (t >= night.axisStart && t <= night.axisEnd) suns.append(el("span", { class: "strip-sun", style: { left: x(t) } }, `sunrise ${fmtClock(t)}`));

  const bars = el("div", { class: "strip-bars" });
  const barBySegment = new Map();
  for (const seg of night.segments) {
    const height = night.hasDetections ? Math.max(6, Math.round((seg.detection_count / site.maxCount) * 100)) : 14;
    const label = `${fmtClock(seg.start)}–${fmtClock(seg.end)} · ${humanize(seg.period).toLowerCase() || "hour"}` +
      (night.hasDetections ? ` · ${plural(seg.detection_count, "detection")}` : "") +
      (seg.top_species.length ? ` · ${seg.top_species.slice(0, 3).map((s) => s.name).join(", ")}` : "") +
      (seg.public_url ? "" : " · audio not published");
    const bar = el("button", {
      class: `bar${night.hasDetections ? "" : " quiet"}${seg.public_url ? "" : " silent"}`,
      type: "button",
      style: { left: x(seg.start), width: `calc(${w(seg.start, seg.end)} - 1px)`, height: `${height}%` },
      "aria-label": label,
      onclick: () => {
        ctx.player.load(seg, { autoplay: true });
        ctx.navigate(`#/hour/${encodeURIComponent(seg.segment_id)}`);
      },
      onmouseenter: (event) => showTip(label, event.currentTarget),
      onmouseleave: hideTip,
      onfocus: (event) => showTip(label, event.currentTarget),
      onblur: hideTip,
    });
    barBySegment.set(seg, bar);
    bars.append(bar);
  }

  const ticks = el("div", { class: "strip-ticks" });
  const firstTick = Math.ceil(night.axisStart / (3 * HOUR)) * 3 * HOUR;
  for (let t = firstTick; t <= night.axisEnd; t += 3 * HOUR) ticks.append(el("span", { class: "tick", style: { left: x(t) } }, fmtClock(t)));

  const markPlaying = () => {
    const current = ctx.player.segment;
    for (const [seg, bar] of barBySegment) bar.classList.toggle("playing", seg === current);
  };
  ctx.player.addEventListener("change", markPlaying);
  unsubscribe.push(() => ctx.player.removeEventListener("change", markPlaying));
  markPlaying();

  const summary = [humanize(night.season), plural(night.hours, "hour")];
  if (night.hasDetections) summary.push(`${plural(night.detections, "detection")} of ${plural(night.topSpecies.length, "species")}`);
  else summary.push("species not yet identified");

  return el("section", { class: "night" },
    el("div", { class: "night-title" }, el("h3", {}, dates), el("span", { class: "muted" }, summary.join(" · "))),
    el("div", { class: "strip" }, layers, suns, bars),
    ticks,
    night.hasDetections ? el("p", { class: "night-species muted" }, "Most heard: ", night.topSpecies.slice(0, 5).map((s) => s.name).join(", ")) : null);
}
