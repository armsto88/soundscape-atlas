// A place: what and where it is, then one chart per recording session. Click
// a chart to listen from that moment; the hour you are in opens in detail
// under its chart, and follows the playback from hour to hour.
//
// A species can be picked (the search in the header, a plate, or ?species= from
// the atlas): each chart then gets a lane marking when it called, sessions
// without it fade back, and the hour in detail opens on its lane.
//
// Phones: the name, then three tabs, one shown at a time: Listen (the sessions,
// the hour, its moments and comments), Heard here (the plates) and About (the
// description, care for the place, the map).

import { el, plural, humanize, fmtSpan, fmtDuration, fmtClock, fmtDay, fmtInt, hideTip, info, isPhone } from "./util.js";
import { createSessionChart, sessionSummary } from "./sessionchart.js";
import { createDetail } from "./detail.js";
import { renderSpecies } from "./species.js";
import { findSpecies, quickListen } from "./data.js";
import { createSpeciesSearch, lensCard } from "./search.js";
import { renderNotes } from "./notes.js";
import { createSaveControl } from "./library.js";
import { sessionComments } from "./comments.js";
import { supportBlock } from "./support.js";
import { createMap, tokens } from "./map.js";
import { Marker } from "../vendor/maplibre-gl.mjs";
import { placeSuggestion, hourSuggestion } from "./player.js";

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';

// "22–23 Aug 2024", a session's days in few words (phones)
function shortSpan(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (fmtDay(start) === fmtDay(end)) return fmtDay(start, { weekday: false });
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return `${fmtDay(start, { weekday: false, month: !sameMonth, year: !sameYear })}–${fmtDay(end, { weekday: false })}`;
}

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
  const phone = isPhone();
  let picked = (params.species && model.speciesByKey.get(params.species)) || null; // the species followed through the sessions

  // ---- header ----------------------------------------------------------------
  const facts = [humanize(site.habitat), humanize(site.biome), site.elevation_m ? `${site.elevation_m} m above sea level` : ""].filter(Boolean);
  const insetEl = el("div", { class: "inset-map", "aria-hidden": "true" });
  const backHref = () => `#/?focus=${encodeURIComponent(site.id)}${picked ? `&species=${encodeURIComponent(picked.key)}` : ""}`;
  // phones: the way back is the place line above the name
  const backLink = phone
    ? el("a", { class: "back-eyebrow", href: backHref(), "aria-label": "Back to the atlas" }, `‹ ${[site.locality, site.area || site.state].filter(Boolean).join(" · ")}`)
    : el("a", { href: backHref() }, "← Atlas");
  const heardHere = [...site.heard.values()];
  const find = heardHere.length ? createSpeciesSearch({
    id: "site-find",
    label: "Find a species heard here",
    source: (text) => ({
      items: findSpecies(heardHere.map((p) => p.sp), text)
        .sort((a, b) => a.score - b.score || site.heard.get(b.sp).calls - site.heard.get(a.sp).calls)
        .map(({ sp }) => {
          const p = site.heard.get(sp);
          return { sp, meta: plural(p.calls, "call") + (site.sessions.length > 1 ? ` · ${p.sessions.length} of ${site.sessions.length} sessions` : "") };
        }),
      empty: "Not heard here by that name.",
    }),
    onPick: (sp) => setPicked(sp),
  }) : null;
  // Listening first: one press plays the place's best moment, the same one its
  // card on the atlas plays (featured hour, else the liveliest dawn chorus).
  const quick = quickListen(site);
  const listenIcon = el("span", { class: "site-listen-icon", html: ICON_PLAY });
  const listenLabel = quick ? (quick.kind === "dawn" ? "Dawn chorus" : humanize(quick.seg.period) || "Listen") : "";
  // It does what it says: from anywhere else, even elsewhere in this place, it goes
  // to that moment; only while that moment is what's playing does it pause or carry on.
  const atQuick = () => Boolean(quick) && player.segment === quick.seg && player.moment >= quick.moment - 60_000;
  const listen = quick ? el("button", {
    class: "site-listen", type: "button",
    onclick: () => {
      if (atQuick()) player.toggle();
      else select(quick.seg, { play: true, at: quick.at, reveal: false });
    },
  }, listenIcon, el("span", { class: "site-listen-text" },
    el("b", {}, listenLabel),
    el("small", {}, `${fmtDay(quick.moment, { weekday: false })}, from ${fmtClock(quick.moment)}`))) : null;
  const showListen = () => {
    if (!listen) return;
    // phones: gone while this place plays (the bar and the hour have Pause)
    listen.hidden = phone && Boolean(player.segment) && player.segment.site === site && player.isPlaying;
    const here = atQuick();
    const playing = here && player.isPlaying;
    const icon = playing ? ICON_PAUSE : ICON_PLAY;
    if (listenIcon.innerHTML !== icon) listenIcon.innerHTML = icon; // this runs on every tick of the player
    listen.setAttribute("aria-label", playing ? "Pause" : here ? `Carry on: ${listenLabel}` : `Listen: ${listenLabel}`);
  };
  const counts = el("p", { class: "muted site-counts" }, `${plural(site.sessions.length, "session")} · ${plural(site.hours, "hour")}` +
    (phone ? " recorded" : site.species.length ? ` · ${plural(site.species.length, "species", "species")} heard so far` : " · species not yet identified"));
  const about = [
    site.description ? el("p", { class: "lede" }, site.description) : null,
    supportBlock(site),
    site.public_location_precision !== "exact" ? el("p", { class: "note" }, "The map shows an approximate location to protect the site.") : null,
    counts,
  ];
  // Phones: the place line (the way back), the name, one line of facts and
  // Play; the tabs below. Plates pick species under Heard here.
  const head = phone
    ? el("header", { class: "site-head" }, el("div", {},
      backLink,
      el("h1", {}, site.site_name),
      el("p", { class: "facts" }, [humanize(site.habitat), site.elevation_m ? `${fmtInt(site.elevation_m)} m` : "",
        site.species.length ? plural(site.species.length, "species", "species") : ""].filter(Boolean).join(" · ")),
      listen))
    // Wide screens: what the place is on the left; the map, the counts and the
    // species search beside it, so the first session comes up sooner.
    : el("header", { class: "site-head" },
      el("div", {},
        el("p", { class: "back" }, backLink),
        el("p", { class: "eyebrow" }, [site.locality, site.area, site.state, site.country].filter(Boolean).join(" · ")),
        el("h1", {}, site.site_name),
        el("p", { class: "facts" }, facts.join(" · ")),
        listen,
        about.slice(0, -1)),
      el("div", { class: "site-aside" },
        insetEl,
        counts,
        find ? el("div", { class: "site-find" }, find.el) : null));
  const aboutEl = phone ? el("section", { class: "site-about" }, el("h2", {}, "About this place"), about, insetEl) : null;
  const lensBar = el("div", { class: "site-lens", hidden: true });

  // ---- sessions --------------------------------------------------------------
  const blocks = new Map(); // session -> { chart, slot, article, lensText }
  let active = null;        // the hour shown in detail
  let detail = null;
  let detailSession = null;
  let initialReveal = 0;
  const address = () => {
    const query = new URLSearchParams();
    if (active) query.set("at", active.segment_id);
    if (picked) query.set("species", picked.key);
    const text = query.toString();
    return `#/site/${encodeURIComponent(site.id)}${text ? `?${text}` : ""}`;
  };

  const select = (seg, { play = false, at = null, reveal = true, followPlayback = true } = {}) => {
    // Update the page first: starting the player announces the new hour, which
    // calls back into select() and must find the page already showing it.
    if (active !== seg) {
      active = seg;
      if (detailSession !== seg.session) {
        if (detail) {
          detail.destroy();
          detail.el.remove();
        }
        detail = createDetail(ctx, {
          onSelect: (s) => select(s),
          onCommentTime: (s, sec) => blocks.get(s.session).comments.at(s, sec),
          focusName: () => (picked ? picked.name : null),
        });
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
      ctx.replace(address());
      ctx.suggest(hourSuggestion(seg) || placeSuggestion(site)); // the idle bar's Play: the hour on screen
    }
    if (play) player.load(seg, { autoplay: true, at });
    else if (followPlayback && player.segment && player.segment.session === seg.session && player.segment !== seg && (player.isPlaying || player.wanted)) {
      player.load(seg, { autoplay: true }); // moving the window while listening moves the listening too
    }
  };

  const help = info("the session charts",
    el("p", {}, "Each chart is one recording session, from its first to its last second. Night is shaded, with sunset and sunrise marked, and the curve shows how many BirdNET detections there are in every five minutes. Hatched stretches were recorded but are not published."),
    el("p", {}, "Click anywhere on a chart to listen from that moment. The hour you're in opens below the chart: drag its highlighted window, or use the arrows, to move through the session. Under the hour, the session notes pick out moments worth hearing."));
  const sessionsEl = el("section", { class: "sessions" },
    phone ? null : [el("h2", {}, "Sessions", help.button), help.panel]); // phones: the Listen tab says it
  for (const session of site.sessions) {
    const chart = createSessionChart(session, {
      maxRate: site.maxRate,
      onSeek: (seg, at) => select(seg, { play: true, at }),
      onSelect: (seg) => select(seg),
    });
    const comments = sessionComments(session, {
      onPlay: (seg, at) => select(seg, { play: true, at }),
      onMarks: chart.setCommentMarks,
    });
    const slot = el("div", { class: "detail-slot" });
    const lensText = el("p", { class: "sc-lens-text", hidden: true });
    const save = createSaveControl("session");
    save.show(session.id);
    const titleId = `session-title-${session.id}`;
    const article = el("article", { class: "session", tabindex: "-1", "aria-labelledby": titleId },
      el("header", { class: "session-head" },
        el("div", { class: "session-heading" },
          el("h3", { id: titleId }, phone ? shortSpan(session.start, session.end) : fmtSpan(session.start, session.end)),
          el("span", { class: "muted" }, phone ? `${fmtDuration(session.end - session.start)} · ${humanize(session.season).toLowerCase()}`
            : `${fmtDuration(session.end - session.start)} · ${humanize(session.season)} · ${sessionSummary(session)}`)),
        save.el),
      chart.el,
      lensText, // the species picked, in this session
      slot, // the hour in detail, right under its chart
      renderNotes(session, { onPlay: (seg, at) => select(seg, { play: true, at }) }),
      comments.el);
    sessionsEl.append(article);
    blocks.set(session, { chart, slot, article, lensText, comments });
  }

  const speciesEl = renderSpecies(site, {
    find: (s) => {
      const sp = model.speciesByName.get(s.name);
      return site.heard.has(sp) ? sp : null;
    },
    picked: () => picked,
    onPick: (sp) => {
      clearTimeout(initialReveal);
      if (tabs) tabs.show("listen"); // phones: the sessions are under Listen
      if (picked !== sp) setPicked(sp);
      const current = active?.session;
      const match = current?.heard.has(sp) ? current : site.heard.get(sp).sessions[0].session;
      if (!active?.heard.some((entry) => entry.sp === sp)) {
        select(match.heard.get(sp).best.seg, { reveal: false, followPlayback: false });
      }
      const article = blocks.get(match).article;
      requestAnimationFrame(() => {
        if (!article.isConnected) return;
        article.focus({ preventScroll: true });
        article.scrollIntoView({ block: "start", behavior: "instant" });
      });
    },
  });
  // phones: the charts explained once, at the end of Listen, instead of ⓘ buttons
  const howTo = phone ? el("details", { class: "howto" }, el("summary", {}, "How to read this page"),
    el("p", {}, "Each chart is one recording session, from its first to its last second. Night is shaded, with sunset and sunrise marked, and the curve shows how many BirdNET detections there are in every five minutes. Hatched stretches were recorded but are not published. Tap anywhere on a chart to listen from that moment."),
    el("p", {}, "Under the chart is the hour you are in: its spectrogram (time runs left to right, pitch rises from 0 to 12 kHz, louder is darker) and a lane for each species with its calls. Swipe sideways or use the arrows to move through the hours, and tap a mark to hear that call."),
    el("p", {}, "The moments are picked from the detections checked by ear or at least 70% sure: the first bird of the morning, the dawn and evening choruses at their fullest, voices in the night, and the quietest stretch. ▶ plays from just before each one."),
    el("p", {}, "Species are named automatically by BirdNET+ V3.0 (Cornell Lab of Ornithology and Chemnitz University of Technology) and may contain errors.")) : null;
  let tabs = null; // phones: Listen, Heard here, About
  if (phone) {
    tabs = createTabs([
      { key: "listen", label: "Listen", panel: [lensBar, sessionsEl, howTo] },
      speciesEl ? { key: "species", label: "Heard here", panel: [speciesEl] } : null,
      { key: "about", label: "About", panel: [aboutEl] },
    ].filter(Boolean), {
      id: site.id,
      onShow: (key) => {
        ctx.state.siteTab = { id: site.id, tab: key };
        if (key === "about") requestAnimationFrame(() => inset.resize()); // the map was drawn while hidden
      },
    });
    main.append(el("article", { class: "page site" }, head, tabs.bar, tabs.panels));
  } else {
    main.append(el("article", { class: "page site" }, head, lensBar, sessionsEl, speciesEl, aboutEl));
  }

  // ---- the species picked ------------------------------------------------------------
  function renderLensBar() {
    lensBar.innerHTML = "";
    lensBar.hidden = !picked;
    if (!picked) return;
    const here = site.heard.get(picked);
    const text = here
      ? `Heard in ${here.sessions.length} of ${plural(site.sessions.length, "session")} here, ${plural(here.calls, "call")} in ${plural(here.hours, "hour")}. Each chart below marks when it called.`
      : "Not heard in the published hours here.";
    lensBar.append(lensCard(picked, {
      onClear: () => setPicked(null),
      children: [
        el("p", { class: "lens-text" }, text),
        el("p", { class: "lens-text" }, el("a", { href: `#/?species=${encodeURIComponent(picked.key)}` }, "Where else it was heard →")),
      ],
    }));
  }
  function renderSessionsLens() {
    for (const [session, b] of blocks) {
      const e = picked ? session.heard.get(picked) : null;
      b.article.classList.toggle("lens-off", Boolean(picked) && !e);
      b.chart.setLens(picked ? (e ? { marks: e.marks, best: e.best.t, name: picked.name } : { none: true }) : null);
      b.lensText.innerHTML = "";
      b.lensText.hidden = !picked;
      if (!picked) continue;
      if (!e) {
        b.lensText.append(el("span", {}, el("b", {}, picked.name), " was not heard in this session."));
        continue;
      }
      const from = e.marks[0][0];
      const to = e.marks[e.marks.length - 1][1];
      // (native append would write a missing button as the text "null")
      b.lensText.append(...[
        el("span", {}, el("b", {}, picked.name), `: ${plural(e.calls, "call")} in ${plural(e.hours, "hour")}, between about ${fmtClock(from)} and ${fmtClock(to)}`),
        e.best.seg.public_url ? el("button", {
          class: "lens-call", type: "button",
          onclick: () => select(e.best.seg, { play: true, at: Math.max(0, e.best.sec - 3) }),
        }, el("span", { class: "lens-call-icon", html: ICON_PLAY, "aria-hidden": "true" }), `Clearest call, ${fmtClock(e.best.t)}`) : null,
      ].filter(Boolean));
    }
  }
  function setPicked(sp) {
    picked = sp;
    ctx.replace(address());
    backLink.href = backHref();
    renderLensBar();
    renderSessionsLens();
    for (const b of speciesEl ? speciesEl.querySelectorAll(".tile-btn") : []) b.setAttribute("aria-current", String(Boolean(picked) && b.dataset.name === picked.name));
    if (detail) detail.setFocus(picked ? picked.name : null);
  }
  renderLensBar();
  renderSessionsLens();

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
    showListen();
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
  // the player bar's title, pressed on this page: bring the playing hour into view
  const onReveal = (event) => {
    const seg = event.detail;
    if (!seg || seg.site !== site) return;
    clearTimeout(initialReveal);
    select(seg, { reveal: false });
    blocks.get(seg.session).article.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  player.addEventListener("state", onState);
  player.addEventListener("change", onChange);
  player.addEventListener("reveal", onReveal);

  // open on the hour in the address, or on the hour already playing here
  const playingHere = player.segment && player.segment.site === site && (player.isPlaying || player.wanted);
  const start = (params.at && model.segmentsById.get(params.at)) || (playingHere ? player.segment : null);
  if (start && start.site === site) {
    select(start, { reveal: false });
    // a shared moment (&t=<seconds into the hour>, as social posts link): the
    // player waits there, paused, since browsers only start sound on a press
    const t = Number(params.t);
    if (params.at && Number.isFinite(t) && t > 0 && start.public_url && !(player.segment === start && player.isPlaying)) {
      player.load(start, { at: t });
    }
    // after the inset map and fonts have settled, so the jump lands where it should
    initialReveal = setTimeout(() => blocks.get(start.session).article.scrollIntoView({ block: "start" }), 150);
  }
  if (!active) ctx.suggest(placeSuggestion(site)); // the idle bar's Play: this place's best moment
  if (tabs) {
    // an hour or a species in the address is under Listen; otherwise the tab last open here
    const last = ctx.state.siteTab && ctx.state.siteTab.id === site.id ? ctx.state.siteTab.tab : null;
    tabs.show(params.at || params.species || !last ? "listen" : last);
  }
  onState();

  return {
    destroy() {
      clearTimeout(initialReveal);
      player.removeEventListener("state", onState);
      player.removeEventListener("change", onChange);
      player.removeEventListener("reveal", onReveal);
      if (detail) detail.destroy();
      inset.remove();
      hideTip();
    },
  };
}

// Phones: a row of tabs over panels, one panel shown at a time.
// items: [{ key, label, panel: [elements] }]
function createTabs(items, { id, onShow }) {
  const uid = id.replace(/[^A-Za-z0-9]/g, "");
  const buttons = new Map();
  const panels = new Map();
  for (const item of items) {
    const panel = el("div", { class: "site-panel", role: "tabpanel", id: `panel-${uid}-${item.key}`, "aria-labelledby": `tab-${uid}-${item.key}`, hidden: true }, item.panel);
    const button = el("button", {
      class: "site-tab", type: "button", role: "tab", id: `tab-${uid}-${item.key}`,
      "aria-controls": panel.id, "aria-selected": "false", tabindex: "-1",
      onclick: () => api.show(item.key, { scroll: true }),
    }, item.label);
    buttons.set(item.key, button);
    panels.set(item.key, panel);
  }
  const bar = el("div", { class: "site-tabs", role: "tablist" }, [...buttons.values()]);
  // arrow keys move between the tabs
  bar.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const keys = [...buttons.keys()];
    const i = keys.findIndex((k) => buttons.get(k) === document.activeElement);
    if (i < 0) return;
    const next = keys[(i + (event.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
    api.show(next);
    buttons.get(next).focus();
  });
  let current = null;
  const api = {
    bar,
    panels: [...panels.values()],
    get current() { return current; },
    show(key, { scroll = false } = {}) {
      if (!panels.has(key)) key = items[0].key;
      current = key;
      for (const [k, button] of buttons) {
        button.setAttribute("aria-selected", String(k === key));
        button.tabIndex = k === key ? 0 : -1;
        panels.get(k).hidden = k !== key;
      }
      // a tab pressed further down the page: start the new one at its top
      if (scroll && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: "start" });
      onShow(key);
    },
  };
  return api;
}
