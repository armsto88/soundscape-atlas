// Loads the published index (api/data.json) and turns it into the model the
// screens use: places (sites) grouped country › state › area, each with its
// recording sessions, each with its published hours (segments). Detections are
// loaded per hour on demand and cached on the segment.

import { HOUR, MINUTE, parseLocal, dateAt, slug } from "./util.js";

export const COUNTRY_NAMES = { AU: "Australia", DE: "Germany" };
export const STATE_NAMES = {
  AU: { NSW: "New South Wales", QLD: "Queensland", VIC: "Victoria", TAS: "Tasmania", SA: "South Australia", WA: "Western Australia", NT: "Northern Territory", ACT: "Australian Capital Territory" },
  DE: { BW: "Baden-Württemberg", SL: "Saarland", BY: "Bavaria", RP: "Rhineland-Palatinate", HE: "Hesse", NW: "North Rhine-Westphalia" },
};
export const ACTIVITY_BIN_SEC = 300;

// Until sites.csv has an area for every place, these keep the list tidy.
function fallbackArea(site) {
  if (site.country_code === "AU" && site.region_code === "NSW") return Number(site.latitude) < -30 ? "New England" : "Northern Rivers";
  if (site.country_code === "AU" && site.region_code === "QLD") return "Sunshine Coast";
  if (site.country_code === "DE" && site.region_code === "BW") return "Black Forest";
  return "";
}

export const isFrog = (group) => /amphibia/i.test(String(group || ""));

export async function loadModel(url = "api/data.json") {
  const [response, art] = await Promise.all([
    fetch(url, { cache: "no-store" }),
    fetch("art/manifest.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return buildModel(await response.json(), art);
}

export function buildModel(raw, art = {}) {
  const birdArt = new Set(art.birds || []);
  const frogArt = new Set(art.frogs || []);

  const sites = new Map();
  for (const [id, site] of Object.entries(raw.sites || {})) {
    const country = COUNTRY_NAMES[site.country_code] || site.country_code || "Elsewhere";
    const state = (STATE_NAMES[site.country_code] || {})[site.region_code] || site.region_code || "";
    sites.set(id, {
      ...site,
      id,
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
      country,
      state,
      area: (site.area || "").trim() || fallbackArea(site),
      sessions: [],
      segments: [],
      speciesRaw: Array.isArray(site.species) ? site.species : null,
    });
  }

  const segments = [];
  for (const row of raw.segments || []) {
    const site = sites.get(row.site_id);
    const start = parseLocal(row.segment_start_local);
    const end = parseLocal(row.segment_end_local);
    if (!site || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const durationSec = (end - start) / 1000;
    const count = Number(row.detection_count) || 0;
    let activity = Array.isArray(row.activity) && row.activity.length ? row.activity.map(Number) : null;
    if (!activity) {
      const n = Math.max(1, Math.ceil(durationSec / ACTIVITY_BIN_SEC));
      activity = Array(n).fill(count / n); // older index: spread the hour's total evenly
    }
    segments.push({
      ...row,
      site,
      start,
      end,
      durationSec,
      activity,
      detection_count: count,
      top_species: Array.isArray(row.top_species) ? row.top_species : [],
      spectrogram_url: row.public_url ? String(row.public_url).replace(/\.opus(\?.*)?$/i, ".png") : "",
      detections: null,
    });
  }
  segments.sort((a, b) => a.start - b.start || a.segment_id.localeCompare(b.segment_id));
  const segmentsById = new Map(segments.map((s) => [s.segment_id, s]));

  const sessionsById = new Map();
  for (const seg of segments) {
    let session = sessionsById.get(seg.session_id);
    if (!session) {
      session = { id: seg.session_id, site: seg.site, meta: (raw.sessions || {})[seg.session_id] || {}, segments: [] };
      sessionsById.set(seg.session_id, session);
      seg.site.sessions.push(session);
    }
    session.segments.push(seg);
    seg.session = session;
    seg.site.segments.push(seg);
  }
  const sessions = [...sessionsById.values()];
  for (const session of sessions) finishSession(session);

  for (const site of sites.values()) {
    site.sessions.sort((a, b) => b.start - a.start);
    site.hours = site.segments.length;
    site.detections = site.segments.reduce((n, s) => n + s.detection_count, 0);
    site.species = siteSpecies(site, birdArt, frogArt);
    site.birds = site.species.filter((s) => !s.frog);
    site.frogs = site.species.filter((s) => s.frog);
    // One scale per place, so its sessions can be compared by eye.
    site.maxRate = Math.max(1, ...site.segments.flatMap((s) => s.activity));
  }

  const published = [...sites.values()].filter((s) => s.segments.length > 0);
  const tree = buildTree(published);

  return {
    raw,
    sites,
    publishedSites: published,
    segments,
    segmentsById,
    sessions,
    tree,
    totals: { sites: published.length, sessions: sessions.length, hours: segments.length },
  };
}

// country › state › area › site. Sites without an area sit directly under their state.
function buildTree(sites) {
  const countries = new Map();
  for (const site of sites) {
    if (!countries.has(site.country)) countries.set(site.country, { kind: "country", name: site.country, children: new Map(), sites: [] });
    const country = countries.get(site.country);
    country.sites.push(site);
    if (!country.children.has(site.state)) country.children.set(site.state, { kind: "state", name: site.state, children: new Map(), sites: [], direct: [] });
    const state = country.children.get(site.state);
    state.sites.push(site);
    if (!site.area) {
      state.direct.push(site);
      continue;
    }
    if (!state.children.has(site.area)) state.children.set(site.area, { kind: "area", name: site.area, sites: [] });
    state.children.get(site.area).sites.push(site);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  const finish = (node) => {
    node.hours = node.sites.reduce((n, s) => n + s.hours, 0);
    node.sites.sort((a, b) => String(a.site_name).localeCompare(String(b.site_name)));
    if (node.direct) node.direct.sort((a, b) => String(a.site_name).localeCompare(String(b.site_name)));
    if (node.children) {
      node.children = [...node.children.values()].sort(byName);
      node.children.forEach(finish);
    }
    return node;
  };
  return [...countries.values()].sort(byName).map(finish);
}

function siteSpecies(site, birdArt, frogArt) {
  let list;
  if (site.speciesRaw) {
    list = site.speciesRaw.map((sp) => ({ name: sp.name, scientific: sp.scientific || "", group: sp.group || "", calls: Number(sp.calls) || 0, hours: Number(sp.hours) || 0, checked: Boolean(sp.checked) }));
  } else {
    // Older index without per-site summaries: add up each hour's top species.
    const map = new Map();
    for (const seg of site.segments) {
      for (const sp of seg.top_species) {
        const e = map.get(sp.name) || { name: sp.name, scientific: "", group: sp.group || "", calls: 0, hours: 0, checked: false };
        e.calls += Number(sp.count) || 0;
        e.hours += 1;
        e.checked = e.checked || Boolean(sp.checked);
        map.set(sp.name, e);
      }
    }
    list = [...map.values()];
  }
  for (const sp of list) {
    sp.frog = isFrog(sp.group);
    sp.key = slug(sp.scientific);
    sp.image = sp.key && (sp.frog ? frogArt.has(sp.key) && `art/frogs/${sp.key}.webp` : birdArt.has(sp.key) && `art/birds/${sp.key}.webp`) || "";
  }
  return list.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

function finishSession(session) {
  const segs = session.segments;
  segs.sort((a, b) => a.start - b.start);
  const metaStart = parseLocal(session.meta.start_local);
  const metaEnd = parseLocal(session.meta.end_local);
  session.start = Number.isFinite(metaStart) ? Math.min(metaStart, segs[0].start) : segs[0].start;
  session.end = Number.isFinite(metaEnd) ? Math.max(metaEnd, segs[segs.length - 1].end) : segs[segs.length - 1].end;
  session.hours = segs.length;
  session.detections = segs.reduce((n, s) => n + s.detection_count, 0);
  session.hasDetections = session.detections > 0;
  session.season = segs[0].season || "";

  // Stretches of the recording that are not published.
  const gaps = [];
  let cursor = session.start;
  for (const seg of segs) {
    if (seg.start - cursor > 1000) gaps.push([cursor, seg.start]);
    cursor = Math.max(cursor, seg.end);
  }
  if (session.end - cursor > 1000) gaps.push([cursor, session.end]);
  session.gaps = gaps;

  // Sun times come with each hour, one pair per local date; neighbouring days
  // fill in for dates without a published hour (a few minutes off at most).
  const sunByDate = new Map();
  for (const seg of segs) {
    if (seg.local_date && !sunByDate.has(seg.local_date)) {
      sunByDate.set(seg.local_date, { rise: dateAt(seg.local_date, seg.sunrise), set: dateAt(seg.local_date, seg.sunset) });
    }
  }
  const rises = [];
  const sets = [];
  for (const key of [...sunByDate.keys()].sort()) {
    const sun = sunByDate.get(key);
    if (Number.isFinite(sun.rise)) rises.push(sun.rise);
    if (Number.isFinite(sun.set)) sets.push(sun.set);
  }
  for (const list of [rises, sets]) {
    if (!list.length) continue;
    list.unshift(list[0] - 24 * HOUR);
    list.push(list[list.length - 1] + 24 * HOUR);
  }
  const inSpan = (t) => t >= session.start - HOUR && t <= session.end + HOUR;
  session.sunrises = rises.filter(inSpan);
  session.sunsets = sets.filter(inSpan);
  // Every sunset and sunrise within a day of the session, for the chart's sky. The nearest ones
  // count even when they fall hours outside the recording: a 19:00-05:00 session in winter is
  // night all through, although no sun event lies within it.
  const near = (t) => t >= session.start - 24 * HOUR && t <= session.end + 24 * HOUR;
  session.sky = [...sets.filter(near).map((t) => ({ t, set: true })), ...rises.filter(near).map((t) => ({ t, set: false }))]
    .sort((a, b) => a.t - b.t);
}

// The published hour that contains a moment of a session, if any.
export function segmentAt(session, t) {
  return session.segments.find((s) => t >= s.start && t < s.end) || null;
}

// The busiest five minutes around sunrise ("dawn": an hour before to two after)
// or sunset ("evening": 90 minutes before to 45 after) in a session, from the
// chart's activity; null when nothing there reaches a chorus. Used by the
// session notes and the atlas's play button.
const CHORUS_MIN = 5; // detections in five minutes
export function chorusPeak(session, which) {
  const suns = which === "dawn" ? session.sunrises : session.sunsets;
  const sun = suns.find((t) => t >= session.start - HOUR && t <= session.end + HOUR);
  if (!sun) return null;
  const [from, to] = which === "dawn" ? [sun - HOUR, sun + 2 * HOUR] : [sun - 90 * MINUTE, sun + 45 * MINUTE];
  let best = null;
  for (const seg of session.segments) {
    seg.activity.forEach((count, i) => {
      const t = seg.start + i * ACTIVITY_BIN_SEC * 1000;
      if (t >= from && t < to && (!best || count > best.count)) best = { t, count };
    });
  }
  return best && best.count >= CHORUS_MIN ? best : null;
}

// What the atlas's play button plays at a place, always the same for a place:
// - an hour marked featured in segments.csv, from its start;
// - otherwise the session of the liveliest dawn hour (most detections), from
//   half an hour before its dawn chorus is at its fullest, so the listener hears
//   the chorus build (half an hour before sunrise if it never reaches a chorus);
// - otherwise the liveliest hour, from its busiest five minutes;
// - otherwise the latest session, from half an hour before sunrise (or its start).
// Returns { seg, at (seconds into seg), moment (ms), kind } or null.
export function quickListen(site) {
  const hours = site.segments.filter((s) => s.public_url);
  if (!hours.length) return null;
  const featured = hours.find((s) => s.featured === true);
  if (featured) return { ...startFrom(featured.session, featured.start), kind: "featured" };
  const liveliest = (list) => list.reduce((a, b) => (b.detection_count > a.detection_count ? b : a));
  const busiest = (seg) => {
    const bins = seg.activity || [];
    const peak = bins.reduce((best, v, i) => (v > bins[best] ? i : best), 0);
    return seg.start + Math.max(0, peak * ACTIVITY_BIN_SEC * 1000 - 10_000);
  };
  const dawns = hours.filter((s) => s.period === "dawn" && s.detection_count > 0);
  if (dawns.length) {
    const seg = liveliest(dawns);
    const peak = chorusPeak(seg.session, "dawn");
    const sunrise = seg.session.sunrises.find((t) => t > seg.start - HOUR && t < seg.end + HOUR);
    const t = peak ? peak.t - 30 * MINUTE : sunrise ? sunrise - 30 * MINUTE : seg.start;
    return { ...startFrom(seg.session, t), kind: "dawn" };
  }
  const busy = hours.filter((s) => s.detection_count > 0);
  if (busy.length) {
    const seg = liveliest(busy);
    return { ...startFrom(seg.session, busiest(seg)), kind: "busiest" };
  }
  const session = site.sessions.find((s) => s.segments.some((x) => x.public_url));
  const sunrise = session.sunrises.find((t) => t >= session.start && t <= session.end);
  return { ...startFrom(session, sunrise ? sunrise - 30 * MINUTE : session.start), kind: sunrise ? "dawn" : "start" };
}

// the published hour holding moment t (or the next one after it), and where in it to start
function startFrom(session, t) {
  const hours = session.segments.filter((s) => s.public_url);
  const seg = hours.find((s) => t >= s.start && t < s.end) || hours.find((s) => s.start >= t) || hours[hours.length - 1];
  const moment = Math.min(Math.max(t, seg.start), seg.end);
  return { seg, at: (moment - seg.start) / 1000, moment };
}

const pending = new Map();
export function loadDetections(seg) {
  if (seg.detections) return Promise.resolve(seg.detections);
  if (!seg.detections_url) {
    seg.detections = [];
    return Promise.resolve(seg.detections);
  }
  if (!pending.has(seg.segment_id)) {
    const task = fetch(`api/${seg.detections_url}`)
      .then((r) => {
        if (!r.ok) throw new Error(`detections ${r.status}`);
        return r.json();
      })
      .then((data) => {
        seg.detections = (data.detections || [])
          .map((d) => ({
            ...d,
            start_sec: Number(d.start_sec),
            end_sec: Number(d.end_sec),
            confidence: Number(d.confidence) || 0,
            n: Number(d.n) || 1,
            checked: d.review_status === "confirmed",
            frog: isFrog(d.group),
          }))
          .filter((d) => Number.isFinite(d.start_sec));
        return seg.detections;
      })
      .catch((err) => {
        pending.delete(seg.segment_id);
        throw err;
      });
    pending.set(seg.segment_id, task);
  }
  return pending.get(seg.segment_id);
}

export { MINUTE };
