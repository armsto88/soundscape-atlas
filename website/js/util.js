// Small helpers shared by the screens: DOM building, wall-clock time handling
// and formatting.
//
// Times are the site's own wall clock. The metadata gives local ISO strings
// without a zone, and they are parsed as if they were UTC, so the browser's
// zone and daylight-saving changes never shift anything on screen.

export const HOUR = 3_600_000;
export const MINUTE = 60_000;

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  return append(node, children);
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function parseLocal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(iso || ""));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

// "YYYY-MM-DD" plus "HH:MM" on that day.
export function dateAt(dayIso, hhmm) {
  const day = parseLocal(dayIso);
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
  if (!Number.isFinite(day) || !m) return NaN;
  return day + (+m[1] * 60 + +m[2]) * MINUTE;
}

export function startOfDay(ms) {
  return Math.floor(ms / (24 * HOUR)) * 24 * HOUR;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const pad = (n) => String(n).padStart(2, "0");

// The phone layout (tab bar, Now Playing, shorter place pages): the same width
// as the small-screen rules in styles.css. Pages are drawn again when it changes.
export const PHONE_MEDIA = "(max-width: 860px)";
export const isPhone = () => window.matchMedia(PHONE_MEDIA).matches;

export function fmtDay(ms, { weekday = true, month = true, year = true } = {}) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const parts = [];
  if (weekday) parts.push(DAYS[d.getUTCDay()]);
  parts.push(String(d.getUTCDate()));
  if (month) parts.push(MONTHS[d.getUTCMonth()]);
  if (year) parts.push(String(d.getUTCFullYear()));
  return parts.join(" ");
}

export function fmtClock(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Seconds into a recording: 65 -> "01:05", 3725 -> "1:02:05".
export function fmtTime(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtInt(n) {
  return (Number(n) || 0).toLocaleString("en-GB");
}

export function plural(n, one, many = `${one}s`) {
  if (many === `${one}s` && /species$/.test(one)) many = one;
  return `${fmtInt(n)} ${Number(n) === 1 ? one : many}`;
}

export function humanize(value) {
  const s = String(value || "").trim().replace(/_/g, " ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function pct(part, whole) {
  return `${((part / whole) * 100).toFixed(4)}%`;
}

// One floating readout for the whole page: a recording time, call or comment.
let tip = null;
let tipTimer = 0;
let tipAnchor = null;
export function showTip(content, anchor, { interactive = false } = {}) {
  clearTimeout(tipTimer);
  if (!tip) {
    tip = el("div", { class: "tooltip", id: "atlas-tooltip", role: "tooltip",
      onpointerenter: () => clearTimeout(tipTimer),
      onpointerleave: () => { if (tipAnchor !== document.activeElement) hideTipSoon(180); } });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && tipAnchor) hideTip();
    });
  }
  // inside an open dialog (Now Playing) the tip must live in it, or the dialog covers it
  const host = anchor.closest("dialog[open]");
  if (tip.parentElement !== (host || document.body)) (host || document.body).append(tip);
  tip.classList.toggle("tooltip-fixed", Boolean(host));
  tipAnchor?.removeAttribute("aria-describedby");
  tipAnchor = interactive ? anchor : null;
  tipAnchor?.setAttribute("aria-describedby", tip.id);
  tip.classList.toggle("tooltip-interactive", interactive);
  tip.style.maxHeight = "";
  tip.replaceChildren(content);
  tip.hidden = false;
  const r = anchor.getBoundingClientRect();
  const above = r.top - 16;
  const below = window.innerHeight - r.bottom - 16;
  const useAbove = tip.offsetHeight <= above || (interactive && above >= below);
  if (interactive) tip.style.maxHeight = `${Math.max(0, useAbove ? above : below)}px`;
  const w = tip.offsetWidth;
  const left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
  const top = useAbove ? r.top - tip.offsetHeight - 8 : r.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top + (host ? 0 : window.scrollY)}px`;
}
export function hideTip() {
  clearTimeout(tipTimer);
  tipAnchor?.removeAttribute("aria-describedby");
  tipAnchor = null;
  if (tip) tip.hidden = true;
}
// A tap has no hover to end, so a readout shown by touch stays up a moment.
export function hideTipSoon(ms = 2500) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(hideTip, ms);
}

// A small (i) button for a heading, and the help panel it opens. Explanations
// live here instead of in tooltips, so they work the same with a mouse, a
// keyboard and a finger. Put the button in or beside the heading and the panel
// where the help should appear.
let infoCount = 0;
export function info(topic, ...content) {
  const id = `info-${++infoCount}`;
  const panel = el("div", { class: "info-panel", id, hidden: true }, content);
  const button = el("button", {
    class: "info-btn", type: "button", "aria-expanded": "false", "aria-controls": id, "aria-label": `About ${topic}`,
    onclick: (event) => {
      event.stopPropagation();
      toggle(panel.hidden);
    },
  }, "i");
  const toggle = (open) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.classList.toggle("open", open);
  };
  const close = (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      toggle(false);
      button.focus();
    }
  };
  button.addEventListener("keydown", close);
  panel.addEventListener("keydown", close);
  return { button, panel };
}

// "19 h 17 min", "45 min".
export function fmtDuration(ms) {
  const minutes = Math.round(ms / MINUTE);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// A session's title: exactly when the audio starts and stops.
export function fmtSpan(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameDay = sameYear && fmtDay(start) === fmtDay(end);
  if (sameDay) return `${fmtDay(start)}, ${fmtClock(start)} → ${fmtClock(end)}`;
  if (sameYear) return `${fmtDay(start, { year: false })} ${fmtClock(start)} → ${fmtDay(end, { year: false })} ${fmtClock(end)}, ${b.getUTCFullYear()}`;
  return `${fmtDay(start)} ${fmtClock(start)} → ${fmtDay(end)} ${fmtClock(end)}`;
}

export function slug(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const SVG_NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  return node;
}
