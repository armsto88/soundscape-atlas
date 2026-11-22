// Loads the published index (api/data.json) and turns it into the model the
// screens use: places (sites), each with nights (recording sessions), each
// with hours (segments). Nothing here is fetched twice; detections are loaded
// per hour on demand and cached on the segment.

import { HOUR, parseLocal, dateAt, startOfDay } from "./util.js";

export const COUNTRY_NAMES = { AU: "Australia", DE: "Germany" };

// Region names are only a display grouping for the atlas. A region column in
// sites.csv would replace this rule.
export function regionOf(site) {
  const country = site.country_code;
  const region = site.region_code;
  if (country === "AU" && region === "NSW") return Number(site.latitude) < -30 ? "New England" : "Northern Rivers";
  if (country === "AU" && region === "QLD") return "Sunshine Coast";
  if (country === "DE" && region === "SL") return "Saarland";
  if (country === "DE" && region === "BW") return "Black Forest";
  return [region, COUNTRY_NAMES[country] || country].filter(Boolean).join(", ");
}

export async function loadModel(url = "api/data.json") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return buildModel(await response.json());
}

export function buildModel(raw) {
  const sites = new Map();
  for (const [id, site] of Object.entries(raw.sites || {})) {
    sites.set(id, {
      ...site,
      id,
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
      region: regionOf(site),
      country: COUNTRY_NAMES[site.country_code] || site.country_code || "",
      nights: [],
      segments: [],
    });
  }

  const segments = [];
  for (const row of raw.segments || []) {
    const site = sites.get(row.site_id);
    const start = parseLocal(row.segment_start_local);
    const end = parseLocal(row.segment_end_local);
    if (!site || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    segments.push({
      ...row,
      site,
      start,
      end,
      durationSec: (end - start) / 1000,
      detection_count: Number(row.detection_count) || 0,
      top_species: Array.isArray(row.top_species) ? row.top_species : [],
      spectrogram_url: row.public_url ? String(row.public_url).replace(/\.opus(\?.*)?$/i, ".png") : "",
      detections: null,
    });
  }
  segments.sort((a, b) => a.start - b.start || a.segment_id.localeCompare(b.segment_id));
  const segmentsById = new Map(segments.map((s) => [s.segment_id, s]));

  const nightsById = new Map();
  for (const seg of segments) {
    let night = nightsById.get(seg.session_id);
    if (!night) {
      night = { id: seg.session_id, site: seg.site, session: (raw.sessions || {})[seg.session_id] || {}, segments: [] };
      nightsById.set(seg.session_id, night);
      seg.site.nights.push(night);
    }
    night.segments.push(seg);
    seg.night = night;
    seg.site.segments.push(seg);
  }
  const nights = [...nightsById.values()];
  for (const night of nights) finishNight(night);

  for (const site of sites.values()) {
    site.nights.sort((a, b) => b.start - a.start);
    site.hours = site.segments.length;
    site.detections = site.segments.reduce((n, s) => n + s.detection_count, 0);
    site.maxCount = Math.max(1, ...site.segments.map((s) => s.detection_count));
    site.topSpecies = aggregateSpecies(site.segments);
    site.hasDetections = site.detections > 0;
  }

  const publishedSites = [...sites.values()]
    .filter((s) => s.segments.length > 0)
    .sort((a, b) => String(a.site_name).localeCompare(String(b.site_name)));

  const regions = new Map();
  for (const site of publishedSites) {
    let region = regions.get(site.region);
    if (!region) {
      region = { name: site.region, country: site.country, sites: [], hours: 0, nights: 0 };
      regions.set(site.region, region);
    }
    region.sites.push(site);
    region.hours += site.hours;
    region.nights += site.nights.length;
  }
  const countries = [];
  for (const region of regions.values()) {
    let country = countries.find((c) => c.name === region.country);
    if (!country) {
      country = { name: region.country, regions: [] };
      countries.push(country);
    }
    country.regions.push(region);
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));
  for (const country of countries) country.regions.sort((a, b) => a.name.localeCompare(b.name));

  return {
    raw,
    sites,
    publishedSites,
    segments,
    segmentsById,
    nights,
    regions,
    countries,
    species: raw.species || [],
    totals: {
      sites: publishedSites.length,
      nights: nights.length,
      hours: segments.length,
      detections: segments.reduce((n, s) => n + s.detection_count, 0),
    },
  };
}

function finishNight(night) {
  const segs = night.segments;
  segs.sort((a, b) => a.start - b.start);
  night.start = segs[0].start;
  night.end = segs[segs.length - 1].end;
  night.hours = segs.length;
  night.detections = segs.reduce((n, s) => n + s.detection_count, 0);
  night.maxCount = Math.max(1, ...segs.map((s) => s.detection_count));
  night.season = segs[0].season || "";
  night.hasDetections = night.detections > 0;
  night.topSpecies = aggregateSpecies(segs);

  // Every night is drawn on the same noon-to-noon axis, stretched if a
  // recording runs past it, so dusk, night and dawn line up across nights.
  const noon = startOfDay(night.start) + 12 * HOUR;
  night.axisStart = Math.min(noon, night.start);
  night.axisEnd = Math.max(noon + 24 * HOUR, night.end);

  // Sun times come with each hour (one pair per local date). Days with no
  // recorded hour are filled from the neighbouring day, a few minutes off at most.
  const sunByDate = new Map();
  for (const seg of segs) {
    if (seg.local_date && !sunByDate.has(seg.local_date)) {
      sunByDate.set(seg.local_date, { sunrise: dateAt(seg.local_date, seg.sunrise), sunset: dateAt(seg.local_date, seg.sunset) });
    }
  }
  const sunrises = [];
  const sunsets = [];
  for (const key of [...sunByDate.keys()].sort()) {
    const sun = sunByDate.get(key);
    if (Number.isFinite(sun.sunrise)) sunrises.push(sun.sunrise);
    if (Number.isFinite(sun.sunset)) sunsets.push(sun.sunset);
  }
  const lo = night.axisStart - HOUR;
  const hi = night.axisEnd + HOUR;
  for (const list of [sunrises, sunsets]) {
    if (!list.length) continue;
    if (list[list.length - 1] + 24 * HOUR <= hi) list.push(list[list.length - 1] + 24 * HOUR);
    if (list[0] - 24 * HOUR >= lo) list.unshift(list[0] - 24 * HOUR);
  }
  night.sunrises = sunrises.filter((t) => t >= lo && t <= hi);
  night.sunsets = sunsets.filter((t) => t >= lo && t <= hi);

  // Night bands run from each sunset to the next sunrise, clipped to the axis.
  const events = [
    ...night.sunsets.map((t) => ({ t, kind: "set" })),
    ...night.sunrises.map((t) => ({ t, kind: "rise" })),
  ].sort((a, b) => a.t - b.t);
  const bands = [];
  let open = events.length && events[0].kind === "rise" ? night.axisStart : null;
  for (const event of events) {
    if (event.kind === "set") open = event.t;
    else if (open !== null) {
      bands.push([open, event.t]);
      open = null;
    }
  }
  if (open !== null) bands.push([open, night.axisEnd]);
  night.nightBands = bands
    .map(([a, b]) => [Math.max(a, night.axisStart), Math.min(b, night.axisEnd)])
    .filter(([a, b]) => b > a);
  night.dawns = night.sunrises.map((t) => [t - HOUR, t + HOUR]);
  night.dusks = night.sunsets.map((t) => [t - HOUR, t + HOUR]);
}

// Sums the per-hour species counts. The index only carries each hour's top
// species, so this is a good approximation rather than an exact total.
export function aggregateSpecies(segments) {
  const map = new Map();
  for (const seg of segments) {
    for (const sp of seg.top_species || []) {
      const entry = map.get(sp.name) || { name: sp.name, count: 0, group: sp.group || "", checked: false };
      entry.count += Number(sp.count) || 0;
      entry.checked = entry.checked || Boolean(sp.checked);
      map.set(sp.name, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const isFrog = (group) => /amphibia/i.test(String(group || ""));

// The hour a place opens with: a featured hour, else the dawn with the most
// detections, else the first hour of the newest night.
export function listenHour(site) {
  const playable = site.segments.filter((s) => s.public_url);
  if (!playable.length) return null;
  const featured = playable.find((s) => s.featured);
  if (featured) return featured;
  const dawns = playable.filter((s) => s.period === "dawn");
  const best = (list) => list.reduce((a, b) => (b.detection_count > a.detection_count ? b : a), list[0]);
  if (dawns.length) return best(dawns);
  const newest = site.nights[0];
  return newest ? newest.segments.find((s) => s.public_url) || playable[0] : playable[0];
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
        const list = (data.detections || [])
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
        seg.detections = list;
        return list;
      })
      .catch((err) => {
        pending.delete(seg.segment_id);
        throw err;
      });
    pending.set(seg.segment_id, task);
  }
  return pending.get(seg.segment_id);
}
