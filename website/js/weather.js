// The weather during a session, in words: from the hourly Open-Meteo archive
// that scripts/fetch_weather.py stores per session (api/weather/<id>.json),
// plus the moon's phase, worked out here. Times are the place's local clock.

import { parseLocal, HOUR } from "./util.js";

export function loadWeather(session) {
  if (!session.weatherTask) {
    session.weatherTask = fetch(`api/weather/${encodeURIComponent(session.id)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => {
        if (!w) return null;
        const at = (name) => w.fields.indexOf(name);
        return w.hours.map((h) => ({
          t: parseLocal(h[0]), temp: h[at("temperature_2m")], rain: h[at("precipitation")] || 0,
          cloud: h[at("cloud_cover")], wind: h[at("wind_speed_10m")],
        }));
      })
      .catch(() => null)
      .then((hours) => (session.weather = hours));
  }
  return session.weatherTask;
}

const cloudWord = (pct) => (pct < 25 ? "clear" : pct < 70 ? "partly cloudy" : "overcast");
const windWord = (kmh) => (kmh < 6 ? "still" : kmh < 12 ? "light breeze" : kmh < 20 ? "breezy" : kmh < 30 ? "windy" : "strong wind");
const rainWords = (mm) => (mm < 0.2 ? "dry" : mm < 2 ? `light rain, ${mm.toFixed(1)} mm` : `rain, ${Math.round(mm)} mm`);
const degrees = (c) => `${Math.round(c)} °C`;
const mean = (list, key) => list.reduce((n, h) => n + h[key], 0) / list.length;
const nearest = (hours, t) => hours.reduce((best, h) => (Math.abs(h.t - t) < Math.abs(best.t - t) ? h : best));

// "Clear, still · 17 °C at dusk, 15 °C at dawn · dry · moon 79%, waning"
export function sessionWeather(session) {
  const hours = session.weather;
  if (!hours || !hours.length) return "";
  const within = hours.filter((h) => h.t >= session.start - HOUR && h.t <= session.end);
  if (!within.length) return "";
  const sunset = session.sunsets.find((t) => t >= session.start && t <= session.end);
  const sunrise = session.sunrises.find((t) => t >= session.start && t <= session.end);
  const night = within.filter((h) => (!sunset || h.t >= sunset) && (!sunrise || h.t <= sunrise));
  const sky = night.length ? night : within;
  const temps = sunset && sunrise
    ? `${degrees(nearest(within, sunset).temp)} at dusk, ${degrees(nearest(within, sunrise).temp)} at dawn`
    : sunset ? `${degrees(nearest(within, sunset).temp)} at dusk`
    : sunrise ? `${degrees(nearest(within, sunrise).temp)} at dawn`
    : `${degrees(Math.min(...within.map((h) => h.temp)))}–${degrees(Math.max(...within.map((h) => h.temp)))}`;
  const rain = within.reduce((n, h) => n + h.rain, 0);
  const condition = `${cloudWord(mean(sky, "cloud"))}, ${windWord(mean(sky, "wind"))}`;
  const middle = sunset && sunrise ? (sunset + sunrise) / 2 : (session.start + session.end) / 2;
  return [condition[0].toUpperCase() + condition.slice(1), temps, rainWords(rain), moon(middle)].join(" · ");
}

// one hour: "15 °C · overcast · light breeze" (and its rain, if any)
export function hourWeather(seg) {
  const hours = seg.session.weather;
  if (!hours || !hours.length) return "";
  const h = nearest(hours, seg.start + Math.min(seg.durationSec * 500, HOUR / 2));
  if (Math.abs(h.t - seg.start) > 2 * HOUR) return "";
  return [degrees(h.temp), cloudWord(h.cloud), windWord(h.wind), h.rain >= 0.2 ? `rain ${h.rain.toFixed(1)} mm` : ""].filter(Boolean).join(" · ");
}

// The moon's phase at a moment (from a new moon on 6 Jan 2000, 18:14 UTC; the
// place's time zone shifts this by a few percent at most).
export function moon(t) {
  const phase = ((((t - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000) / 29.530588853) % 1 + 1) % 1;
  const lit = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);
  if (lit <= 2) return "new moon";
  if (lit >= 98) return "full moon";
  return `moon ${lit}%, ${phase < 0.5 ? "waxing" : "waning"}`;
}
