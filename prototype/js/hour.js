// One hour: the timeline is the main content. A spectrogram strip on top,
// one lane per species underneath with its calling bouts, a playhead across
// both, and the species list beside it. Clicking anywhere on the timeline
// seeks; clicking a bout jumps to just before it.

import { el, pct, fmtDay, fmtClock, fmtTime, fmtInt, plural, humanize, showTip, hideTip, clamp } from "./util.js";
import { loadDetections } from "./data.js";
import { CREDIT } from "./site.js";

const MAX_LANES = 18;
const CONFIDENT = 0.9;
const KHZ_TOP = 12;

export function render(main, model, params, ctx) {
  const seg = model.segmentsById.get(params.id);
  if (!seg) {
    main.append(el("section", { class: "page" }, el("p", { class: "back" }, el("a", { href: "#/" }, "← Atlas")), el("h1", {}, "Hour not found")));
    return {};
  }
  const site = seg.site;
  const night = seg.night;
  const list = night.segments;
  const index = list.indexOf(seg);
  const prev = list[index - 1];
  const next = list[index + 1];
  const player = ctx.player;

  // The player follows the page: a new hour loads, and keeps playing if it was.
  if (player.segment !== seg) player.load(seg, { autoplay: player.isPlaying || player.wanted });

  const sun = [seg.sunrise ? `sunrise ${seg.sunrise}` : "", seg.sunset ? `sunset ${seg.sunset}` : ""].filter(Boolean).join(", ");
  const playBtn = el("button", { class: "btn btn-primary hour-play", type: "button", onclick: () => player.toggle() });
  const head = el("header", { class: "hour-head" },
    el("p", { class: "back" }, el("a", { href: `#/site/${encodeURIComponent(site.id)}` }, `← ${site.site_name}`)),
    el("div", { class: "hour-title" },
      el("div", {},
        el("h1", {}, `${fmtDay(seg.start)}, ${fmtClock(seg.start)}–${fmtClock(seg.end)}`),
        el("p", { class: "muted" }, [humanize(seg.period), sun, humanize(seg.season)].filter(Boolean).join(" · "))),
      el("div", { class: "hour-nav" },
        prev ? el("a", { class: "btn", href: `#/hour/${encodeURIComponent(prev.segment_id)}` }, `← ${fmtClock(prev.start)}`) : el("span", { class: "btn disabled" }, "← earlier"),
        seg.public_url ? playBtn : null,
        next ? el("a", { class: "btn", href: `#/hour/${encodeURIComponent(next.segment_id)}` }, `${fmtClock(next.start)} →`) : el("span", { class: "btn disabled" }, "later →"))));

  // ---- timeline ----------------------------------------------------------
  const duration = seg.durationSec;
  const left = el("div", { class: "tl-left" });
  const inner = el("div", { class: "tl-inner" });
  const scroll = el("div", { class: "tl-scroll" }, inner);
  const tl = el("div", { class: "tl" }, left, scroll);

  const specAxis = el("div", { class: "spec-axis" });
  for (let k = 2; k <= KHZ_TOP; k += 2) specAxis.append(el("span", { style: { top: pct(KHZ_TOP - k, KHZ_TOP) } }, `${k} kHz`));
  left.append(specAxis);
  const specNote = el("div", { class: "spec-note", hidden: true }, "No spectrogram image for this hour yet.");
  const spec = el("div", { class: "tl-spec" }, specNote);
  if (seg.spectrogram_url) {
    const img = el("img", { src: seg.spectrogram_url, alt: "Spectrogram of the hour, 0 to 12 kHz", loading: "eager", draggable: "false" });
    img.addEventListener("error", () => { img.remove(); specNote.hidden = false; });
    spec.prepend(img);
  } else specNote.hidden = false;
  inner.append(spec);

  const lanesLeft = el("div", { class: "lanes-left" });
  const lanesRight = el("div", { class: "lanes-right" });
  left.append(lanesLeft);
  inner.append(lanesRight);

  const axis = el("div", { class: "tl-axis" });
  const step = duration > 1800 ? 600 : 300;
  for (let s = 0; s <= duration; s += step) axis.append(el("span", { style: { left: pct(s, duration) } }, fmtTime(s)));
  left.append(el("div", { class: "tl-axis-left" }));
  inner.append(axis);

  const playhead = el("div", { class: "playhead", hidden: true });
  inner.append(playhead);

  inner.addEventListener("click", (event) => {
    if (event.target.closest(".mark")) return;
    const r = inner.getBoundingClientRect();
    const frac = clamp((event.clientX - r.left) / r.width, 0, 1);
    if (player.segment !== seg) player.load(seg);
    player.seek(frac * duration);
    if (!player.isPlaying) player.play();
  });

  let zoom = 1;
  const zoomBtns = [1, 2, 4, 8].map((z) => el("button", { class: `seg-btn${z === 1 ? " active" : ""}`, type: "button", onclick: () => setZoom(z) }, `${z}×`));
  const setZoom = (z) => {
    const r = scroll.getBoundingClientRect();
    const centreFrac = (scroll.scrollLeft + r.width / 2) / inner.getBoundingClientRect().width;
    zoom = z;
    inner.style.width = `${z * 100}%`;
    zoomBtns.forEach((b, i) => b.classList.toggle("active", [1, 2, 4, 8][i] === z));
    scroll.scrollLeft = centreFrac * inner.getBoundingClientRect().width - r.width / 2;
  };
  const confidentOnly = el("input", { type: "checkbox" });
  const controls = el("div", { class: "tl-controls" },
    el("div", { class: "seg-group", role: "group", "aria-label": "Zoom" }, zoomBtns),
    el("label", { class: "check" }, confidentOnly, ` Only confident detections (${Math.round(CONFIDENT * 100)}% or checked by ear)`),
    el("span", { class: "muted legend" }, el("i", { class: "swatch" }), " BirdNET ", el("i", { class: "swatch checked" }), " checked by ear"));

  // ---- species column ----------------------------------------------------
  const speciesList = el("ul", { class: "species" });
  const speciesHead = el("h2", {}, "Species in this hour");
  const speciesNote = el("p", { class: "muted" }, "Loading detections…");
  const speciesCol = el("aside", { class: "hour-species" }, speciesHead, speciesNote, speciesList, el("p", { class: "credit" }, CREDIT));

  // ---- about -------------------------------------------------------------
  const session = night.session || {};
  const rows = [
    ["Recorder", session.recorder],
    ["Microphones", session.microphones],
    ["Recordist", session.operator],
    ["Licence", humanize(session.license)],
    ["Weather", session.weather_notes],
    ["Field notes", session.field_notes],
    ["Notes", seg.notes],
    ["Sound quality", humanize(seg.sound_quality)],
    ["Wind", humanize(seg.wind_level)],
    ["Human noise", humanize(seg.anthropogenic_noise)],
  ].filter(([, v]) => v && String(v).trim());
  const about = el("section", { class: "about" },
    el("h2", {}, "About this recording"),
    el("dl", {}, rows.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    el("p", { class: "muted" }, `Recording ${seg.segment_id}`));

  main.append(el("article", { class: "page hour" }, head,
    el("div", { class: "hour-body" }, el("div", { class: "hour-main" }, controls, tl), speciesCol),
    about));

  // ---- detections --------------------------------------------------------
  let detections = [];
  let focus = null;
  const renderLanes = () => {
    lanesLeft.innerHTML = "";
    lanesRight.innerHTML = "";
    speciesList.innerHTML = "";
    const visible = detections.filter((d) => !confidentOnly.checked || d.checked || d.confidence >= CONFIDENT);
    const counts = new Map();
    for (const d of visible) {
      const entry = counts.get(d.common_name) || { name: d.common_name, calls: 0, best: 0, checked: 0, frog: d.frog, bouts: 0 };
      entry.calls += d.n;
      entry.bouts += 1;
      entry.best = Math.max(entry.best, d.confidence);
      if (d.checked) entry.checked += 1;
      counts.set(d.common_name, entry);
    }
    const ranked = [...counts.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
    if (focus && !counts.has(focus)) focus = null;
    tl.classList.toggle("has-focus", Boolean(focus));

    if (!detections.length) {
      speciesNote.textContent = seg.detections_url ? "No detections in this hour." : "Species have not been identified for this hour yet.";
      speciesNote.hidden = false;
      return;
    }
    speciesNote.hidden = true;
    if (!visible.length) {
      speciesNote.textContent = "Nothing passes the confident filter in this hour.";
      speciesNote.hidden = false;
    }

    const named = ranked.slice(0, ranked.length > MAX_LANES ? MAX_LANES - 1 : ranked.length);
    const laneOf = new Map(named.map((s, i) => [s.name, i]));
    const others = ranked.slice(named.length);
    const laneRows = named.map((s) => ({ label: s.name, frog: s.frog, calls: s.calls, name: s.name }));
    if (others.length) laneRows.push({ label: `${plural(others.length, "other species")}`, calls: others.reduce((n, s) => n + s.calls, 0), other: true });

    for (const row of laneRows) {
      const nameBtn = el("button", { class: `lane-name${row.other ? " other" : ""}${focus === row.name ? " focus" : ""}`, type: "button", onclick: () => setFocus(row.other ? null : row.name) },
        el("span", {}, row.label, row.frog ? el("small", {}, "frog") : null), el("b", {}, fmtInt(row.calls)));
      lanesLeft.append(nameBtn);
      lanesRight.append(el("div", { class: "lane-track", "data-lane": row.name || "" }));
    }
    const tracks = lanesRight.children;
    for (const d of visible) {
      const lane = laneOf.has(d.common_name) ? laneOf.get(d.common_name) : named.length;
      const track = tracks[lane];
      if (!track) continue;
      const start = clamp(d.start_sec, 0, duration);
      const end = clamp(Number.isFinite(d.end_sec) ? d.end_sec : start + 3, start, duration);
      const label = `${d.common_name}${d.frog ? " (frog)" : ""} · ${fmtTime(start)}${end - start > 3.5 ? `–${fmtTime(end)}` : ""} · ${d.n > 1 ? `${d.n} calls, best ` : ""}${Math.round(d.confidence * 100)}% · ${d.checked ? "checked by ear" : "BirdNET, not checked"}`;
      const mark = el("button", {
        class: `mark${d.checked ? " checked" : ""}${focus === d.common_name ? " focus" : ""}`,
        type: "button",
        style: { left: pct(start, duration), width: `max(2px, ${pct(end - start, duration)})`, opacity: String(0.35 + 0.65 * d.confidence) },
        "aria-label": label,
        tabindex: "-1",
        onclick: (event) => {
          event.stopPropagation();
          if (player.segment !== seg) player.load(seg);
          player.seek(Math.max(0, start - 2));
          player.play();
        },
        onmouseenter: (event) => showTip(label, event.currentTarget),
        onmouseleave: hideTip,
      });
      track.append(mark);
    }

    for (const s of ranked) {
      speciesList.append(el("li", {},
        el("button", { class: `species-row${focus === s.name ? " focus" : ""}`, type: "button", onclick: () => setFocus(s.name) },
          el("span", { class: "species-name" }, s.name, s.frog ? el("small", {}, "frog") : null, s.checked ? el("i", { class: "tick", title: "Checked by ear" }, "✓") : null),
          el("span", { class: "species-count", title: `${plural(s.bouts, "calling bout")}` }, fmtInt(s.calls)))));
    }
    speciesHead.textContent = `${plural(ranked.length, "species")} in this hour`;
  };
  const setFocus = (name) => {
    focus = focus === name ? null : name;
    renderLanes();
  };
  confidentOnly.addEventListener("change", renderLanes);

  loadDetections(seg).then((list) => {
    detections = list;
    renderLanes();
  }).catch(() => {
    speciesNote.textContent = "Could not load the detections for this hour.";
  });

  // ---- playhead ----------------------------------------------------------
  const onState = () => {
    const mine = player.segment === seg;
    playBtn.textContent = mine && player.isPlaying ? "Pause" : "Play this hour";
    playhead.hidden = !mine;
    if (!mine) return;
    const frac = duration ? clamp(player.currentTime / duration, 0, 1) : 0;
    playhead.style.left = `${(frac * 100).toFixed(3)}%`;
    if (zoom > 1 && player.isPlaying) {
      const innerW = inner.getBoundingClientRect().width;
      const x = frac * innerW;
      const viewL = scroll.scrollLeft;
      const viewW = scroll.clientWidth;
      if (x < viewL || x > viewL + viewW * 0.9) scroll.scrollLeft = Math.max(0, x - viewW * 0.2);
    }
  };
  player.addEventListener("state", onState);
  onState();

  return {
    destroy() {
      player.removeEventListener("state", onState);
      hideTip();
    },
  };
}
