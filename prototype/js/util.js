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

// One floating tooltip for the whole page.
let tip = null;
export function showTip(text, anchor) {
  if (!tip) {
    tip = el("div", { class: "tooltip", role: "tooltip" });
    document.body.append(tip);
  }
  tip.textContent = text;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = tip.offsetWidth;
  const left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
  let top = r.top - tip.offsetHeight - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top + window.scrollY}px`;
}
export function hideTip() {
  if (tip) tip.hidden = true;
}
