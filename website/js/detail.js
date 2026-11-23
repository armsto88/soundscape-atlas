// The hour in detail, shown under a session's chart: big arrows to step
// through the session's hours, the spectrogram strip and one lane per species
// with its calls. Species list, zoom, the confident-only filter and the
// recording notes sit in a collapsed "More" section.

import { el, pct, fmtClock, fmtTime, fmtInt, plural, humanize, showTip, hideTip, clamp } from "./util.js";
import { loadDetections } from "./data.js";

const MAX_LANES = 8;
const CONFIDENT = 0.9;
const KHZ_TOP = 12;
export const BIRDNET_CREDIT = "Species identified automatically by BirdNET+ V3.0 (Cornell Lab of Ornithology and Chemnitz University of Technology). May contain errors.";

export function createDetail(ctx, { onSelect }) {
  const player = ctx.player;
  let seg = null;
  let zoom = 1;
  let focus = null;
  let detections = [];

  // ---- header: arrows, title, play ------------------------------------------
  const prevBtn = el("button", { class: "arrow-btn", type: "button", onclick: () => step(-1) });
  const nextBtn = el("button", { class: "arrow-btn", type: "button", onclick: () => step(1) });
  const title = el("h4", { class: "detail-title" });
  const sub = el("p", { class: "detail-sub muted" });
  const playBtn = el("button", { class: "btn btn-primary", type: "button", onclick: () => {
    if (!seg) return;
    if (player.segment === seg) player.toggle();
    else player.load(seg, { autoplay: true });
  } });
  const head = el("div", { class: "detail-head" }, prevBtn, el("div", { class: "detail-heading" }, title, sub), playBtn, nextBtn);

  // ---- timeline ----------------------------------------------------------------
  const left = el("div", { class: "tl-left" });
  const inner = el("div", { class: "tl-inner" });
  const scroll = el("div", { class: "tl-scroll" }, inner);
  const tl = el("div", { class: "tl" }, left, scroll);
  const specAxis = el("div", { class: "spec-axis" });
  for (let k = 2; k <= KHZ_TOP; k += 2) specAxis.append(el("span", { style: { top: pct(KHZ_TOP - k, KHZ_TOP) } }, `${k} kHz`));
  const specNote = el("div", { class: "spec-note", hidden: true }, "No spectrogram image for this hour yet.");
  const spec = el("div", { class: "tl-spec" }, specNote);
  const lanesLeft = el("div", { class: "lanes-left" });
  const lanesRight = el("div", { class: "lanes-right" });
  const axis = el("div", { class: "tl-axis" });
  const playhead = el("div", { class: "playhead", hidden: true });
  left.append(specAxis, lanesLeft, el("div", { class: "tl-axis-left" }));
  inner.append(spec, lanesRight, axis, playhead);
  const lanesNote = el("p", { class: "lanes-note muted", hidden: true });

  inner.addEventListener("click", (event) => {
    if (!seg || event.target.closest(".mark")) return;
    const r = inner.getBoundingClientRect();
    player.load(seg, { autoplay: true, at: clamp((event.clientX - r.left) / r.width, 0, 1) * seg.durationSec });
  });

  // ---- more ----------------------------------------------------------------------
  const zoomBtns = [1, 2, 4, 8].map((z) => el("button", { class: `seg-btn${z === 1 ? " active" : ""}`, type: "button", onclick: () => setZoom(z) }, `${z}×`));
  const confidentOnly = el("input", { type: "checkbox", onchange: () => renderLanes() });
  const speciesList = el("ul", { class: "species" });
  const notes = el("dl", { class: "notes" });
  const more = el("details", { class: "more" },
    el("summary", {}, "More: all species, zoom, filter, recording notes"),
    el("div", { class: "more-body" },
      el("div", { class: "more-controls" },
        el("div", { class: "seg-group", role: "group", "aria-label": "Zoom" }, zoomBtns),
        el("label", { class: "check" }, confidentOnly, ` Only confident detections (${Math.round(CONFIDENT * 100)}% or checked by ear)`),
        el("span", { class: "legend muted" }, el("i", { class: "swatch" }), " BirdNET  ", el("i", { class: "swatch checked" }), " checked by ear")),
      el("div", { class: "more-cols" },
        el("div", {}, el("h5", {}, "All species this hour"), speciesList),
        el("div", {}, el("h5", {}, "About the recording"), notes)),
      el("p", { class: "credit" }, BIRDNET_CREDIT)));

  const root = el("div", { class: "detail" }, head, tl, lanesNote, more);

  function setZoom(z) {
    const r = scroll.getBoundingClientRect();
    const centre = (scroll.scrollLeft + r.width / 2) / inner.getBoundingClientRect().width;
    zoom = z;
    inner.style.width = `${z * 100}%`;
    zoomBtns.forEach((b, i) => b.classList.toggle("active", [1, 2, 4, 8][i] === z));
    scroll.scrollLeft = centre * inner.getBoundingClientRect().width - r.width / 2;
  }

  function step(dir) {
    if (!seg) return;
    const list = seg.session.segments;
    const next = list[list.indexOf(seg) + dir];
    if (next) onSelect(next);
  }

  function renderLanes() {
    lanesLeft.innerHTML = "";
    lanesRight.innerHTML = "";
    speciesList.innerHTML = "";
    const visible = detections.filter((d) => !confidentOnly.checked || d.checked || d.confidence >= CONFIDENT);
    const counts = new Map();
    for (const d of visible) {
      const e = counts.get(d.common_name) || { name: d.common_name, calls: 0, bouts: 0, checked: 0, frog: d.frog };
      e.calls += d.n;
      e.bouts += 1;
      if (d.checked) e.checked += 1;
      counts.set(d.common_name, e);
    }
    const ranked = [...counts.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
    if (focus && !counts.has(focus)) focus = null;
    tl.classList.toggle("has-focus", Boolean(focus));
    lanesNote.hidden = true;
    if (!detections.length || !visible.length) {
      lanesNote.hidden = false;
      lanesNote.textContent = !seg.detections_url ? "Species have not been identified for this hour yet."
        : !detections.length ? "No detections in this hour." : "Nothing passes the confident filter in this hour.";
      sub.textContent = subText(0);
      return;
    }
    const named = ranked.slice(0, ranked.length > MAX_LANES ? MAX_LANES - 1 : ranked.length);
    const laneOf = new Map(named.map((s, i) => [s.name, i]));
    const others = ranked.slice(named.length);
    const rows = named.map((s) => ({ label: s.name, frog: s.frog, calls: s.calls, name: s.name }));
    if (others.length) rows.push({ label: plural(others.length, "other species", "other species"), calls: others.reduce((n, s) => n + s.calls, 0), other: true });
    for (const row of rows) {
      lanesLeft.append(el("button", { class: `lane-name${row.other ? " other" : ""}${focus === row.name ? " focus" : ""}`, type: "button", onclick: () => setFocus(row.other ? null : row.name) },
        el("span", {}, row.label, row.frog ? el("small", {}, "frog") : null), el("b", {}, fmtInt(row.calls))));
      lanesRight.append(el("div", { class: "lane-track" }));
    }
    const tracks = lanesRight.children;
    const duration = seg.durationSec;
    for (const d of visible) {
      const track = tracks[laneOf.has(d.common_name) ? laneOf.get(d.common_name) : named.length];
      if (!track) continue;
      const start = clamp(d.start_sec, 0, duration);
      const end = clamp(Number.isFinite(d.end_sec) ? d.end_sec : start + 3, start, duration);
      const label = `${d.common_name}${d.frog ? " (frog)" : ""} · ${fmtTime(start)}${end - start > 3.5 ? `–${fmtTime(end)}` : ""} · ${d.n > 1 ? `${d.n} calls, best ` : ""}${Math.round(d.confidence * 100)}% · ${d.checked ? "checked by ear" : "BirdNET, not checked"}`;
      track.append(el("button", {
        class: `mark${d.checked ? " checked" : ""}${focus === d.common_name ? " focus" : ""}`,
        type: "button",
        tabindex: "-1",
        "aria-label": label,
        style: { left: pct(start, duration), width: `max(2px, ${pct(end - start, duration)})`, opacity: String(0.35 + 0.65 * d.confidence) },
        onclick: (event) => {
          event.stopPropagation();
          player.load(seg, { autoplay: true, at: Math.max(0, start - 2) });
        },
        onmouseenter: (event) => showTip(label, event.currentTarget),
        onmouseleave: hideTip,
      }));
    }
    for (const s of ranked) {
      speciesList.append(el("li", {}, el("button", { class: `species-row${focus === s.name ? " focus" : ""}`, type: "button", onclick: () => setFocus(s.name) },
        el("span", {}, s.name, s.frog ? el("small", {}, " frog") : null, s.checked ? el("i", { class: "tick", title: "Checked by ear" }, " ✓") : null),
        el("span", { class: "species-count" }, fmtInt(s.calls)))));
    }
    sub.textContent = subText(ranked.length);
  }
  function setFocus(name) {
    focus = focus === name ? null : name;
    renderLanes();
  }
  function subText(nSpecies) {
    const sun = seg.period === "dawn" && seg.sunrise ? `sunrise ${seg.sunrise}` : seg.period === "dusk" && seg.sunset ? `sunset ${seg.sunset}` : "";
    return [humanize(seg.period), sun, seg.detections_url ? plural(nSpecies, "species", "species") : ""].filter(Boolean).join(" · ");
  }

  function onState() {
    if (!seg) return;
    const mine = player.segment === seg;
    playBtn.textContent = mine && player.isPlaying ? "Pause" : "Play this hour";
    playBtn.disabled = !seg.public_url;
    playhead.hidden = !mine;
    if (!mine) return;
    const frac = seg.durationSec ? clamp(player.currentTime / seg.durationSec, 0, 1) : 0;
    playhead.style.left = `${(frac * 100).toFixed(3)}%`;
    if (zoom > 1 && player.isPlaying) {
      const xPx = frac * inner.getBoundingClientRect().width;
      if (xPx < scroll.scrollLeft || xPx > scroll.scrollLeft + scroll.clientWidth * 0.9) scroll.scrollLeft = Math.max(0, xPx - scroll.clientWidth * 0.2);
    }
  }
  player.addEventListener("state", onState);

  return {
    el: root,
    show(next) {
      if (seg === next) return;
      seg = next;
      focus = null;
      const list = seg.session.segments;
      const i = list.indexOf(seg);
      const prev = list[i - 1];
      const after = list[i + 1];
      prevBtn.disabled = !prev;
      nextBtn.disabled = !after;
      prevBtn.innerHTML = "";
      nextBtn.innerHTML = "";
      prevBtn.append(el("span", { class: "arrow" }, "‹"), el("span", {}, prev ? fmtClock(prev.start) : "start"));
      nextBtn.append(el("span", {}, after ? fmtClock(after.start) : "end"), el("span", { class: "arrow" }, "›"));
      prevBtn.setAttribute("aria-label", prev ? `Previous hour, ${fmtClock(prev.start)}` : "No earlier hour");
      nextBtn.setAttribute("aria-label", after ? `Next hour, ${fmtClock(after.start)}` : "No later hour");
      title.textContent = `${fmtClock(seg.start)}–${fmtClock(seg.end)}`;
      sub.textContent = subText(0);

      spec.querySelector("img")?.remove();
      specNote.hidden = true;
      if (seg.spectrogram_url) {
        const img = el("img", { src: seg.spectrogram_url, alt: "Spectrogram of the hour, 0 to 12 kHz", draggable: "false" });
        img.addEventListener("error", () => { img.remove(); specNote.hidden = false; });
        spec.prepend(img);
      } else specNote.hidden = false;

      axis.innerHTML = "";
      const dur = seg.durationSec;
      const narrow = (inner.clientWidth || 800) < 520;
      const tickStep = dur > 1800 ? (narrow ? 1200 : 600) : dur > 600 ? (narrow ? 600 : 300) : 60;
      for (let s = 0; s <= dur; s += tickStep) axis.append(el("span", { style: { left: pct(s, dur) } }, fmtClock(seg.start + s * 1000)));

      const session = seg.session.meta || {};
      const rows = [["Recorder", session.recorder], ["Microphones", session.microphones], ["Recordist", session.operator], ["Licence", humanize(session.license)],
        ["Weather", session.weather_notes], ["Field notes", session.field_notes], ["Notes", seg.notes], ["Recording", seg.segment_id]].filter(([, v]) => v && String(v).trim());
      notes.innerHTML = "";
      for (const [k, v] of rows) notes.append(el("dt", {}, k), el("dd", {}, v));

      detections = [];
      renderLanes();
      lanesNote.hidden = false;
      lanesNote.textContent = seg.detections_url ? "Loading detections…" : "Species have not been identified for this hour yet.";
      const current = seg;
      loadDetections(seg).then((list) => {
        if (seg !== current) return;
        detections = list;
        renderLanes();
      }).catch(() => {
        if (seg === current) lanesNote.textContent = "Could not load the detections for this hour.";
      });
      onState();
    },
    destroy() {
      player.removeEventListener("state", onState);
      hideTip();
    },
  };
}
