// One session's chart on a place page: an activity curve over the whole
// recording, from its first to its last second, with night shaded, sunset and
// sunrise marked, and unpublished stretches hatched. A highlighted window
// marks the hour shown in detail below. Click anywhere to listen from that
// moment; drag the window (or use the arrow keys) to move through the hours.

import { el, svg, pct, clamp, fmtClock, fmtDay, fmtInt, plural, showTip, hideTip, HOUR } from "./util.js";
import { segmentAt, ACTIVITY_BIN_SEC } from "./data.js";

const H = 100; // SVG units; the plot is stretched to its box

export function createSessionChart(session, { maxRate, onSeek, onSelect }) {
  const span = session.end - session.start;
  const x = (t) => (t - session.start) / span;          // 0..1
  const tAt = (frac) => session.start + clamp(frac, 0, 1) * span;
  const uid = session.id.replace(/[^A-Za-z0-9]/g, "");

  // ---- static drawing --------------------------------------------------------
  const plotSvg = svg("svg", { class: "sc-svg", viewBox: `0 0 1000 ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  const defs = svg("defs");
  const pattern = svg("pattern", { id: `hatch-${uid}`, width: "6", height: "6", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pattern.append(svg("rect", { width: "6", height: "6", class: "sc-gap-bg" }), svg("line", { x1: "0", y1: "0", x2: "0", y2: "6", class: "sc-gap-line" }));
  defs.append(pattern);
  plotSvg.append(defs);
  const rect = (a, b, cls, extra = {}) => svg("rect", { x: (x(a) * 1000).toFixed(2), y: "0", width: Math.max(0, (x(b) - x(a)) * 1000).toFixed(2), height: String(H), class: cls, ...extra });
  // the sky: one gradient, from day to dusk at sunset to night an hour later, and back at dawn.
  // It is laid out in the plot's own units, so stops outside the session still shade its edges.
  const stops = [];
  for (const { t, set } of session.sky) {
    if (set) stops.push([t - HOUR, "day"], [t, "dusk"], [t + HOUR, "night"]);
    else stops.push([t - HOUR, "night"], [t, "dusk"], [t + HOUR, "day"]);
  }
  stops.sort((p, q) => p[0] - q[0]);
  if (stops.length) {
    const t0 = stops[0][0];
    const t1 = stops[stops.length - 1][0];
    const sky = svg("linearGradient", { id: `sky-${uid}`, gradientUnits: "userSpaceOnUse", x1: (x(t0) * 1000).toFixed(2), y1: "0", x2: (x(t1) * 1000).toFixed(2), y2: "0" });
    for (const [t, kind] of stops) sky.append(svg("stop", { offset: ((t - t0) / (t1 - t0)).toFixed(5), class: `sc-sky-${kind}` }));
    defs.append(sky);
    plotSvg.append(rect(session.start, session.end, "sc-sky", { fill: `url(#sky-${uid})` }));
  }

  // activity: one closed area per run of back-to-back published hours
  const runs = [];
  for (const seg of session.segments) {
    const last = runs[runs.length - 1];
    if (last && seg.start - last[last.length - 1].end < 1000) last.push(seg);
    else runs.push([seg]);
  }
  const yOf = (v) => (H - 3 - clamp(v / maxRate, 0, 1) * (H - 12)).toFixed(2);
  for (const run of runs) {
    const pts = [];
    for (const seg of run) {
      seg.activity.forEach((count, i) => {
        const a = seg.start + i * ACTIVITY_BIN_SEC * 1000;
        const b = Math.min(seg.end, a + ACTIVITY_BIN_SEC * 1000);
        pts.push({ t: (a + b) / 2, v: count * (ACTIVITY_BIN_SEC * 1000 / Math.max(1, b - a)) });
      });
    }
    const smooth = pts.map((p, i) => ({ t: p.t, v: (2 * p.v + (pts[i - 1] || p).v + (pts[i + 1] || p).v) / 4 }));
    const x0 = (x(run[0].start) * 1000).toFixed(2);
    const x1 = (x(run[run.length - 1].end) * 1000).toFixed(2);
    let d = `M${x0},${H} L${x0},${yOf(smooth[0].v)}`;
    for (const p of smooth) d += ` L${(x(p.t) * 1000).toFixed(2)},${yOf(p.v)}`;
    d += ` L${x1},${yOf(smooth[smooth.length - 1].v)} L${x1},${H} Z`;
    plotSvg.append(svg("path", { d, class: "sc-area" }));
    plotSvg.append(svg("path", { d: d.replace(/ L[\d.]+,100 Z$/, "").replace(/^M[\d.]+,100 /, "M"), class: "sc-line" }));
  }
  for (const [a, b] of session.gaps) plotSvg.append(rect(a, b, "sc-gap", { fill: `url(#hatch-${uid})` }));

  const plot = el("div", { class: "sc-plot", tabindex: "0", role: "slider", "aria-label": "Session timeline: click to listen from a moment; arrow keys move between hours" }, plotSvg);
  for (const [a, b] of session.gaps) {
    if (x(b) - x(a) > 0.07) plot.append(el("span", { class: "sc-gap-label", style: { left: pct(x(a), 1), width: pct(x(b) - x(a), 1) } }, "not published"));
  }
  if (!session.hasDetections) plot.append(el("span", { class: "sc-empty" }, "Species not yet identified"));
  const windowEl = el("div", { class: "sc-window", hidden: true }, el("span", { class: "sc-grip", "aria-hidden": "true" }));
  const playhead = el("div", { class: "sc-playhead", hidden: true });
  const hoverLine = el("div", { class: "sc-hover", hidden: true });
  plot.append(windowEl, playhead, hoverLine);

  // sun labels above, the start and end and clock ticks below
  const suns = el("div", { class: "sc-suns" });
  for (const t of session.sunsets) if (t > session.start && t < session.end) suns.append(el("span", { class: "sc-sun", style: { left: pct(x(t), 1) } }, `☾ sunset ${fmtClock(t)}`));
  for (const t of session.sunrises) if (t > session.start && t < session.end) suns.append(el("span", { class: "sc-sun", style: { left: pct(x(t), 1) } }, `☀ sunrise ${fmtClock(t)}`));
  const ticks = el("div", { class: "sc-ticks" },
    el("span", { class: "sc-end start" }, el("b", {}, "▶ start"), ` ${fmtClock(session.start)}`),
    el("span", { class: "sc-end end" }, `${fmtClock(session.end)} `, el("b", {}, "end ■")));
  const step = span > 10 * HOUR ? 3 * HOUR : span > 4 * HOUR ? HOUR : HOUR / 2;
  for (let t = Math.ceil(session.start / step) * step; t < session.end; t += step) {
    const f = x(t);
    if (f > 0.07 && f < 0.93) ticks.append(el("span", { class: "sc-tick", style: { left: pct(f, 1) } }, fmtClock(t)));
  }

  const root = el("div", { class: "sc" }, suns, plot, ticks);

  // On narrow screens, hide clock ticks that would run into the start and end labels.
  const declutter = () => {
    const ends = [...ticks.querySelectorAll(".sc-end")].map((e) => e.getBoundingClientRect());
    for (const tick of ticks.querySelectorAll(".sc-tick")) {
      tick.style.visibility = "visible";
      const r = tick.getBoundingClientRect();
      if (ends.some((e) => r.right + 6 > e.left && r.left - 6 < e.right)) tick.style.visibility = "hidden";
    }
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(declutter).observe(ticks);

  // ---- interaction -----------------------------------------------------------
  let selected = null;
  const fracAt = (clientX) => {
    const r = plot.getBoundingClientRect();
    return (clientX - r.left) / r.width;
  };
  const nearestSegment = (t) => segmentAt(session, t) ||
    session.segments.reduce((best, s) => (Math.abs((s.start + s.end) / 2 - t) < Math.abs((best.start + best.end) / 2 - t) ? s : best), session.segments[0]);
  const placeWindow = (seg) => {
    windowEl.hidden = !seg;
    if (!seg) return;
    windowEl.style.left = pct(x(seg.start), 1);
    windowEl.style.width = pct(x(seg.end) - x(seg.start), 1);
  };

  let drag = null;
  plot.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x0: event.clientX, onWindow: windowEl.contains(event.target), moved: false, seg: selected };
    plot.setPointerCapture(event.pointerId);
  });
  plot.addEventListener("pointermove", (event) => {
    const t = tAt(fracAt(event.clientX));
    hoverLine.hidden = false;
    hoverLine.style.left = pct(x(t), 1);
    const seg = segmentAt(session, t);
    if (drag && drag.onWindow) {
      if (Math.abs(event.clientX - drag.x0) > 4) drag.moved = true;
      if (drag.moved) {
        drag.seg = nearestSegment(t);
        placeWindow(drag.seg);
        hideTip();
        return;
      }
    }
    let label;
    if (!seg) label = `${fmtClock(t)} · not published`;
    else {
      const i = Math.min(seg.activity.length - 1, Math.floor((t - seg.start) / (ACTIVITY_BIN_SEC * 1000)));
      const n = Math.round(seg.activity[i] || 0);
      const who = seg.top_species.slice(0, 3).map((s) => s.name).join(", ");
      label = `${fmtClock(t)} · ${session.hasDetections ? `${plural(n, "detection")} in these 5 min · ` : ""}click to listen from here${who ? `\nThis hour: ${who}` : ""}`;
    }
    showTip(label, hoverLine);
  });
  plot.addEventListener("pointerleave", () => {
    hoverLine.hidden = true;
    hideTip();
  });
  plot.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.onWindow && d.moved) {
      if (d.seg && d.seg !== selected) onSelect(d.seg);
      else placeWindow(selected);
      return;
    }
    const t = tAt(fracAt(event.clientX));
    const seg = segmentAt(session, t);
    if (seg) onSeek(seg, (t - seg.start) / 1000);
  });
  plot.addEventListener("keydown", (event) => {
    const list = session.segments;
    const i = selected ? list.indexOf(selected) : -1;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      const next = list[clamp(i + (event.key === "ArrowRight" ? 1 : -1), 0, list.length - 1)] || list[0];
      if (next) onSelect(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSeek(selected || list[0], 0);
    }
  });

  return {
    el: root,
    setSelected(seg) {
      selected = seg && seg.session === session ? seg : null;
      placeWindow(selected);
      root.classList.toggle("active", Boolean(selected));
    },
    setPlayhead(moment) {
      const on = moment !== null && moment >= session.start && moment <= session.end;
      playhead.hidden = !on;
      if (on) playhead.style.left = pct(x(moment), 1);
    },
  };
}

export function sessionSummary(session) {
  const parts = [fmtInt(session.hours) + (session.hours === 1 ? " hour" : " hours") + " published"];
  if (session.gaps.length) parts.push(`${plural(session.gaps.length, "gap")}`);
  parts.push(session.hasDetections ? `${plural(session.detections, "detection")}` : "species not yet identified");
  return parts.join(" · ");
}

export { fmtDay };
