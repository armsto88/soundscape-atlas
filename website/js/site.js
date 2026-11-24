// A place: what and where it is, then one chart per recording session. Click
// a chart to listen from that moment; the hour you are in opens in detail
// under its chart, and follows the playback from hour to hour.

import { el, plural, humanize, fmtSpan, fmtDuration, hideTip } from "./util.js";
import { createSessionChart, sessionSummary } from "./sessionchart.js";
import { createDetail } from "./detail.js";
import { renderSpecies } from "./species.js";
import { renderNotes } from "./notes.js";
import { supportBlock } from "./support.js";
import { createMap, tokens } from "./map.js";
import { Marker } from "../vendor/maplibre-gl.mjs";

// a circle of radius metres around a place, as a GeoJSON polygon
function circle(lon, lat, metres) {
  const ring = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([lon + (metres * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (metres * Math.sin(a)) / 110540]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

export function render(main, model, params, ctx) {
  const site = model.sites.get(params.id);
  if (!site) {
    main.append(el("section", { class: "page" }, el("p", { class: "back" }, el("a", { href: "#/" }, "← Atlas")), el("h1", {}, "Place not found")));
    return {};
  }
  const player = ctx.player;

  // ---- header ----------------------------------------------------------------
  const facts = [humanize(site.habitat), humanize(site.biome), site.elevation_m ? `${site.elevation_m} m above sea level` : ""].filter(Boolean);
  const insetEl = el("div", { class: "inset-map", "aria-hidden": "true" });
  const head = el("header", { class: "site-head" },
    el("div", {},
      el("p", { class: "back" }, el("a", { href: `#/?focus=${encodeURIComponent(site.id)}` }, "← Atlas")),
      el("p", { class: "eyebrow" }, [site.locality, site.area, site.state, site.country].filter(Boolean).join(" · ")),
      el("h1", {}, site.site_name),
      el("p", { class: "facts" }, facts.join(" · ")),
      site.description ? el("p", { class: "lede" }, site.description) : null,
      supportBlock(site),
      site.public_location_precision !== "exact" ? el("p", { class: "note" }, "The map shows an approximate location to protect the site.") : null,
      el("p", { class: "muted" }, `${plural(site.sessions.length, "session")} · ${plural(site.hours, "hour")}` +
        (site.species.length ? ` · ${plural(site.species.length, "species", "species")} heard so far` : " · species not yet identified"))),
    insetEl);

  // ---- sessions --------------------------------------------------------------
  const blocks = new Map(); // session -> { chart, slot }
  let active = null;        // the hour shown in detail
  let detail = null;
  let detailSession = null;

  const select = (seg, { play = false, at = null, reveal = true } = {}) => {
    // Update the page first: starting the player announces the new hour, which
    // calls back into select() and must find the page already showing it.
    if (active !== seg) {
      active = seg;
      if (detailSession !== seg.session) {
        if (detail) {
          detail.destroy();
          detail.el.remove();
        }
        detail = createDetail(ctx, { onSelect: (s) => select(s) });
        detailSession = seg.session;
        blocks.get(seg.session).slot.append(detail.el);
        // when it opens low on the screen, bring the chart and its detail up together
        if (reveal) requestAnimationFrame(() => {
          if (detail.el.getBoundingClientRect().top > window.innerHeight * 0.55) {
            blocks.get(seg.session).slot.parentElement.scrollIntoView({ block: "start", behavior: "smooth" });
          }
        });
      }
      detail.show(seg);
      for (const [session, b] of blocks) b.chart.setSelected(session === seg.session ? seg : null);
      ctx.replace(`#/site/${encodeURIComponent(site.id)}?at=${encodeURIComponent(seg.segment_id)}`);
    }
    if (play) player.load(seg, { autoplay: true, at });
    else if (player.segment && player.segment.session === seg.session && player.segment !== seg && (player.isPlaying || player.wanted)) {
      player.load(seg, { autoplay: true }); // moving the window while listening moves the listening too
    }
  };

  const sessionsEl = el("section", { class: "sessions" },
    el("h2", {}, "Sessions"),
    el("p", { class: "muted hint" }, "Click anywhere on a chart to listen from that moment. The hour you're in opens below the chart: drag its highlighted window, or use the arrows, to move through the session."));
  for (const session of site.sessions) {
    const chart = createSessionChart(session, {
      maxRate: site.maxRate,
      onSeek: (seg, at) => select(seg, { play: true, at }),
      onSelect: (seg) => select(seg),
    });
    const slot = el("div", { class: "detail-slot" });
    sessionsEl.append(el("article", { class: "session" },
      el("header", { class: "session-head" },
        el("h3", {}, fmtSpan(session.start, session.end)),
        el("span", { class: "muted" }, `${fmtDuration(session.end - session.start)} · ${humanize(session.season)} · ${sessionSummary(session)}`)),
      chart.el,
      renderNotes(session, { onPlay: (seg, at) => select(seg, { play: true, at }) }),
      slot));
    blocks.set(session, { chart, slot });
  }

  main.append(el("article", { class: "page site" }, head, sessionsEl, renderSpecies(site)));

  // ---- the inset map -------------------------------------------------------------
  const approx = site.public_location_precision !== "exact";
  const inset = createMap(insetEl, { interactive: false, center: [site.longitude, site.latitude], zoom: approx ? 8 : 10 });
  inset.on("load", () => {
    const t = tokens();
    if (approx) {
      inset.addSource("spot", { type: "geojson", data: circle(site.longitude, site.latitude, site.public_location_precision === "coarse" ? 6000 : 700) });
      inset.addLayer({ id: "spot-fill", type: "fill", source: "spot", paint: { "fill-color": t.ochre, "fill-opacity": 0.12 } });
      inset.addLayer({ id: "spot-edge", type: "line", source: "spot", paint: { "line-color": t.ochre, "line-width": 1.5, "line-dasharray": [3, 3] } });
    } else {
      inset.addSource("spot", { type: "geojson", data: { type: "Point", coordinates: [site.longitude, site.latitude] } });
      inset.addLayer({ id: "spot", type: "circle", source: "spot", paint: { "circle-radius": 7, "circle-color": t.ochre, "circle-stroke-color": t.ink, "circle-stroke-width": 1.5 } });
    }
  });

  // ---- follow the player -----------------------------------------------------------
  // while this place is playing, its spot on the inset map breathes
  const pulse = new Marker({ element: el("div", { class: "place-pulse", "aria-hidden": "true" }), anchor: "center" }).setLngLat([site.longitude, site.latitude]);
  let pulsing = false;
  const onState = () => {
    const moment = player.segment && player.segment.site === site ? player.moment : null;
    for (const [session, b] of blocks) b.chart.setPlayhead(player.segment && player.segment.session === session ? moment : null);
    const playingHere = player.isPlaying && player.segment && player.segment.site === site;
    if (playingHere !== pulsing) {
      pulsing = playingHere;
      if (pulsing) pulse.addTo(inset);
      else pulse.remove();
    }
  };
  const onChange = (event) => {
    if (event.detail.site === site) select(event.detail, { reveal: false });
  };
  player.addEventListener("state", onState);
  player.addEventListener("change", onChange);

  // open on the hour in the address, or on the hour already playing here
  const playingHere = player.segment && player.segment.site === site && (player.isPlaying || player.wanted);
  const start = (params.at && model.segmentsById.get(params.at)) || (playingHere ? player.segment : null);
  if (start && start.site === site) {
    select(start, { reveal: false });
    // after the inset map and fonts have settled, so the jump lands where it should
    setTimeout(() => blocks.get(start.session).slot.parentElement.scrollIntoView({ block: "start" }), 150);
  }
  onState();

  return {
    destroy() {
      player.removeEventListener("state", onState);
      player.removeEventListener("change", onChange);
      if (detail) detail.destroy();
      inset.remove();
      hideTip();
    },
  };
}
