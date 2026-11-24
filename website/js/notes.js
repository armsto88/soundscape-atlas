// Session notes: a few lines under a session's chart, written from its BirdNET
// detections, each a moment you can play. Only sure detections count (checked
// by ear, or at least 70% confident); the lanes still show everything.
//
//   First bird of the morning   the earliest sure bird call around dawn, leaving
//                               out species that also called in the dead of night
//   Dawn / evening chorus       the busiest five minutes around sunrise / sunset
//   In the night                the species heard between an hour after sunset
//                               and 90 minutes before sunrise, each at its first call
//   Quietest                    the longest stretch of near silence (30 min or more)
//   Most heard / Frogs          by number of sure calls
//
// The session's detection files load when its notes scroll into view.

import { el, fmtClock, plural, HOUR, MINUTE } from "./util.js";
import { loadDetections, segmentAt, chorusPeak, ACTIVITY_BIN_SEC } from "./data.js";
import { loadWeather, sessionWeather } from "./weather.js";
import { hasSupport, supportText } from "./support.js";

const SURE = 0.7;
const BIN = ACTIVITY_BIN_SEC * 1000;
const QUIET_PER_BIN = 1;        // at most this many detections in five minutes counts as quiet
const QUIET_MIN = 30 * MINUTE;  // shortest quiet stretch worth a note

export function renderNotes(session, { onPlay }) {
  const root = el("section", { class: "notes-block", "aria-label": "Session notes", hidden: true });
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    const birds = session.hasDetections ? sessionNotes(session).catch(() => null) : Promise.resolve(null);
    Promise.all([birds, loadWeather(session)]).then(([notes]) => fill(root, notes, sessionWeather(session), onPlay, session.site));
  };
  if ("IntersectionObserver" in window) {
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        watch.disconnect();
        start();
      }
    }, { rootMargin: "400px 0px" });
    // observe once it is in the page
    requestAnimationFrame(() => watch.observe(root.parentElement || root));
  } else {
    start();
  }
  return root;
}

async function sessionNotes(session) {
  const hours = session.segments.filter((s) => s.detections_url);
  const lists = await Promise.all(hours.map((seg) => loadDetections(seg).then((list) => ({ seg, list })).catch(() => ({ seg, list: [] }))));
  const calls = [];
  for (const { seg, list } of lists) {
    for (const d of list) {
      if (!d.checked && d.confidence < SURE) continue;
      calls.push({ ...d, moment: seg.start + d.start_sec * 1000 });
    }
  }
  calls.sort((a, b) => a.moment - b.moment);

  const sunrise = session.sunrises.find((t) => t >= session.start - HOUR && t <= session.end + HOUR);
  const sunset = session.sunsets.find((t) => t >= session.start - HOUR && t <= session.end + HOUR);
  const nightFrom = sunset ? sunset + HOUR : sunrise ? sunrise - 8 * HOUR : null;
  const nightTo = sunrise ? sunrise - 90 * MINUTE : null; // where "first bird of the morning" starts looking
  const inNight = (t) => nightFrom !== null && nightTo !== null && t >= nightFrom && t <= nightTo;

  const notes = { species: new Set(calls.map((c) => c.common_name)).size, lines: [] };

  // first bird of the morning
  if (sunrise) {
    const nightSpecies = new Set(calls.filter((c) => inNight(c.moment)).map((c) => c.common_name));
    const first = calls.find((c) => !c.frog && !nightSpecies.has(c.common_name) && c.moment >= sunrise - 90 * MINUTE && c.moment <= sunrise + HOUR);
    if (first) notes.lines.push({ label: "First bird of the morning", items: [{ text: first.common_name, moment: first.moment }] });
  }

  // the busiest five minutes around sunrise and sunset (shared with the atlas's play button)
  const dawn = chorusPeak(session, "dawn");
  if (dawn) notes.lines.push({ label: "Dawn chorus at its fullest", items: [{ moment: dawn.t }] });
  const evening = chorusPeak(session, "evening");
  if (evening) notes.lines.push({ label: "Evening chorus at its fullest", items: [{ moment: evening.t }] });
  const bins = [];
  for (const seg of session.segments) {
    seg.activity.forEach((count, i) => bins.push({ t: seg.start + i * BIN, count }));
  }

  // voices in the night, each at its first sure call
  const night = new Map();
  for (const c of calls) if (inNight(c.moment) && !night.has(c.common_name)) night.set(c.common_name, c);
  if (night.size) {
    notes.lines.push({ label: "In the night", items: [...night.values()].slice(0, 4).map((c) => ({ text: c.common_name, moment: c.moment })) });
  }

  // the longest near-silent stretch of published audio
  let run = null;
  let best = null;
  for (const b of bins) {
    const quiet = b.count <= QUIET_PER_BIN;
    if (quiet && run && b.t === run.to) run.to = b.t + BIN;
    else if (quiet) run = { from: b.t, to: b.t + BIN };
    else run = null;
    if (run && (!best || run.to - run.from > best.to - best.from)) best = { ...run };
  }
  if (best && best.to - best.from >= QUIET_MIN) {
    notes.lines.push({ label: "Quietest", items: [{ text: `${fmtClock(best.from)}–${fmtClock(best.to)}`, moment: best.from, timeInText: true }] });
  }

  // most heard birds, and the frogs
  const tally = (list) => {
    const m = new Map();
    for (const c of list) m.set(c.common_name, (m.get(c.common_name) || 0) + c.n);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  };
  const birds = tally(calls.filter((c) => !c.frog));
  if (birds.length) notes.lines.push({ label: "Most heard", items: birds.slice(0, 3).map((text) => ({ text })) });
  const frogs = tally(calls.filter((c) => c.frog));
  if (frogs.length) notes.lines.push({ label: frogs.length === 1 ? "Frog" : "Frogs", items: frogs.slice(0, 4).map((text) => ({ text })) });

  // play from a few seconds before each moment
  for (const line of notes.lines) {
    for (const item of line.items) {
      if (item.moment === undefined) continue;
      const t = item.moment - 5000;
      item.seg = segmentAt(session, t) || segmentAt(session, item.moment);
      if (item.seg) item.at = Math.max(0, (Math.max(t, item.seg.start) - item.seg.start) / 1000);
    }
  }
  return notes;
}

function fill(root, notes, weather, onPlay, site) {
  const lines = [...(weather ? [{ label: "Weather", items: [{ text: weather }] }] : []), ...(notes ? notes.lines : [])];
  if (!lines.length) return;
  const birds = Boolean(notes && notes.lines.length);
  const rows = lines.map((line) => [
    el("dt", {}, line.label),
    el("dd", {}, line.items.map((item, i) => [
      i ? el("span", { class: "notes-sep", "aria-hidden": "true" }, " · ") : null,
      item.seg
        ? el("button", { class: "note-play", type: "button", title: `Listen from ${fmtClock(item.moment)}`, onclick: () => onPlay(item.seg, item.at) },
          item.timeInText ? el("span", { class: "note-time" }, item.text)
            : [item.text ? `${item.text}, ` : "", el("span", { class: "note-time" }, fmtClock(item.moment))],
          el("span", { class: "note-icon", "aria-hidden": "true" }, " ▶"))
        : el("span", {}, item.text),
    ])),
  ]);
  // a way to give something back, for a listener moved by what they heard
  if (hasSupport(site)) rows.push([el("dt", {}, "Care for this place"), el("dd", {}, supportText(site))]);
  const credits = [
    birds ? "Birds and frogs from BirdNET detections that are checked by ear or at least 70% sure." : "",
    weather ? "Weather from Open-Meteo.com (ERA5 reanalysis, about 25 km grid)." : "",
  ].filter(Boolean).join(" ");
  root.append(
    el("h4", { class: "notes-title" }, "Session notes", birds ? el("small", {}, ` · ${plural(notes.species, "species", "species")} heard`) : null),
    el("dl", { class: "notes-list" }, rows),
    el("p", { class: "notes-credit" }, credits));
  root.hidden = false;
}
