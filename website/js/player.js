// One audio element for the whole app and the persistent bar at the bottom.
// Screens never touch the <audio> directly: they call load/toggle/seek and
// listen for "change" (a different hour) and "state" (playing, paused, time,
// error). `calling` lists the species calling at the playhead (sure ones only),
// from the hour's detections.
//
// The bar shows the recording's own clock, the bird calling now, and a thin
// sound-level line. On phones it also carries a strip of the whole session
// (the place page's chart in small): tap or drag along it to move through the
// session; its title and clock open Now Playing (js/nowplaying.js). The level needs Web Audio, which needs the audio fetched
// with CORS: that is done only for audio from this site or our R2 domain (both
// send the headers). Audio from anywhere else plays on a fresh element without
// the level, because routed through Web Audio it would play silent.
//
// The level is drawn only where the bar shows it: wide screens with a mouse.
// Phones play the plain element. On iPhones and iPads, sound routed through
// Web Audio counts as "ambient": the silent switch mutes it and it stops when
// the screen locks (WebKit bug 252746). A plain <audio> plays on through both.
//
// The lock screen and Control Center get the place, the hour, a plate and
// play/pause, scrubbing and previous/next hour (the Media Session API). iOS
// shows either ±10 s buttons or previous/next, never both; we want the hours.

import { el, fmtDay, fmtClock, humanize, clamp, plural, isPhone } from "./util.js";
import { loadDetections, quickListen } from "./data.js";
import { createListeningTracker } from "./analytics.js";
import { createSessionChart } from "./sessionchart.js";

const NOW_CONFIDENT = 0.7; // "now calling" shows checked calls and ones at least this sure
const METER_MEDIA = "(min-width: 861px) and (hover: hover) and (pointer: fine)"; // where the bar shows the level line
const CORS_HOSTS = ["media.soundscapeatlas.com"];
const analysable = (url) => {
  try {
    const u = new URL(url, document.baseURI);
    return u.origin === location.origin || CORS_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

// The plate that stands for an hour (lock screen, the bar on phones): the hour's
// most-heard species that has art, else the place's most-heard one with art.
// Returns { name, image } or null.
export function hourPlate(seg) {
  if (!seg) return null;
  const withArt = (seg.site?.species || []).filter((s) => s.image);
  const byName = new Map(withArt.map((s) => [s.name, s]));
  const top = seg.top_species.map((s) => s && byName.get(s.name)).find(Boolean) || withArt[0];
  return top ? { name: top.name, image: top.image } : null;
}

// What the bar offers before anything has played (wide screens; on phones the
// idle bar is hidden): a place's best moment, the same one its ▶ plays, or an
// hour that is open on the page. { seg, at, text }; Play or Space starts it.
export function placeSuggestion(site) {
  const quick = site && quickListen(site);
  if (!quick) return null;
  const label = quick.kind === "dawn" ? "Dawn chorus" : humanize(quick.seg.period) || "Listen";
  return { seg: quick.seg, at: quick.at, text: `${label} · ${fmtDay(quick.moment, { weekday: false })}, from ${fmtClock(quick.moment)}` };
}
export function hourSuggestion(seg) {
  if (!seg || !seg.public_url) return null;
  return { seg, at: null, text: `${fmtClock(seg.start)}–${fmtClock(seg.end)} · ${fmtDay(seg.start)}${seg.period ? ` · ${humanize(seg.period).toLowerCase()}` : ""}` };
}

// the sleep timer's choices: minutes, or "hour" to stop when this hour ends
export const SLEEP_CHOICES = [15, 30, 60, "hour"];
const FADE_SEC = 8; // the sound fades over the last seconds (where the browser lets a page set the volume)

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h2.5v14H5zm14 0v14L8.5 12z"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 5H19v14h-2.5zM5 5l10.5 7L5 19z"/></svg>';

// The sleep timer's button and its menu of choices: a moon, with the minutes
// left beside it while the timer runs. The bar has one; on phones the hour in
// detail has another. `label` is the button's text while no timer runs;
// `below` opens the menu under the button instead of above it.
export function createSleepControl(player, { label = "", below = false } = {}) {
  const text = el("span", { class: "player-sleep-label" });
  const button = el("button", { class: "player-sleep", type: "button", "aria-haspopup": "true", "aria-expanded": "false", html: ICON_MOON, onclick: () => setOpen(menu.hidden) });
  button.append(text);
  const heading = el("p", {}, "Stop playing after");
  const choose = (choice) => {
    player.setSleep(choice);
    setOpen(false);
  };
  const menu = el("div", { class: `player-sleep-menu${below ? " below" : ""}`, role: "group", "aria-label": "Stop playing after", hidden: true },
    heading,
    ...SLEEP_CHOICES.map((choice) => el("button", { class: "player-sleep-choice", type: "button", "data-choice": String(choice), "aria-pressed": "false", onclick: () => choose(choice) },
      choice === "hour" ? "The end of this hour" : `${choice} minutes`)),
    el("button", { class: "player-sleep-choice", type: "button", "data-choice": "off", "aria-pressed": "true", onclick: () => choose(null) }, "Off"));
  const wrap = el("div", { class: "player-sleep-wrap" }, button, menu);
  const setOpen = (open) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  const onDocumentClick = (event) => {
    if (!wrap.contains(event.target)) setOpen(false);
  };
  document.addEventListener("click", onDocumentClick);
  wrap.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  let shown = null;
  const render = () => {
    const sleep = player.sleep;
    const left = !sleep ? "" : sleep.hour ? "end of hour" : `${Math.max(1, player.sleepLeft)} min`;
    if (shown === left) return;
    shown = left;
    text.textContent = left || label;
    const title = !sleep ? "Sleep timer" : sleep.hour ? "Sleep timer: stops when this hour ends" : `Sleep timer: stops in ${left}`;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.classList.toggle("on", Boolean(sleep));
    heading.textContent = !sleep ? "Stop playing after" : sleep.hour ? "Stops when this hour ends" : `Stops in ${plural(Math.max(1, player.sleepLeft), "minute")}`;
    const current = !sleep ? "off" : sleep.hour ? "hour" : String(sleep.minutes);
    for (const b of menu.querySelectorAll("[data-choice]")) b.setAttribute("aria-pressed", String(b.dataset.choice === current));
  };
  player.addEventListener("state", render);
  render();
  return {
    el: wrap,
    destroy() {
      player.removeEventListener("state", render);
      document.removeEventListener("click", onDocumentClick);
    },
  };
}
const SPEAKER = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>';
const ICON_VOL = `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>`;
const ICON_VOL_LOW = `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}<path d="M15.5 9a4 4 0 0 1 0 6"/></svg>`;
const ICON_MUTED = `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}<path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`;

// The volume slider runs 0..2: up to 1 it turns the recording down (squared, so
// its middle sounds like the middle); above 1 it boosts, up to BOOST_DB at 2.
// A boost needs Web Audio (wide screens with a mouse, where the level meter is).
// Up to 100% the sound goes straight out, untouched; above it, it goes through
// a soft clipper that leaves everything below -6 dBFS as it is and rounds the
// peaks a boost pushes towards full scale, so they don't crackle. Below -6 dBFS
// the two paths are the same, so crossing 100% makes no jump.
const BOOST_DB = 12;
const HEADROOM = 10 ** ((BOOST_DB + 1) / 20); // the clipper's input range, in full scales
const canBoost = () => Boolean((window.AudioContext || window.webkitAudioContext) && window.matchMedia?.(METER_MEDIA).matches);
function softClipCurve() {
  const n = 8192;
  const knee = 0.5; // -6 dBFS
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * HEADROOM; // the sample value this point stands for
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return curve;
}

// the listener's volume, kept in this browser
const readStore = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStore = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a private window: the volume lasts until the page closes
  }
};

class Player extends EventTarget {
  constructor() {
    super();
    this.listening = createListeningTracker();
    // Volume: the listener's slider (wide screens; phones use their own buttons,
    // and iOS ignores a page's volume), times the sleep timer's fade
    const stored = Number(readStore("volume"));
    this.userVolume = readStore("volume") !== null && Number.isFinite(stored) ? clamp(stored, 0, 2) : 1;
    this.muted = readStore("muted") === "1";
    this.fade = 1;
    this.graph = null;
    this.audio = this.createAudio();
    this.segment = null;
    this.error = "";
    this.pendingSeek = null;
    this.wanted = false; // the listener pressed play (survives hour changes)
    this.suggestion = null; // what Play starts while nothing is loaded (suggest())
    this.dom = null;
    this.container = null;
    this.calls = [];    // the hour's detections, once loaded
    this.calling = [];  // detections at the playhead
    this.callingArt = null; // the place's entry, with a plate, for the bird calling now
    this.lastHeard = null; // the latest species with a plate heard calling in this hour (see bird)
    this.strip = null;  // phones: the session's chart in the bar
    this.graph = null;  // Web Audio analyser for the level line
    this.level = 0;
    this.raf = 0;
    this.sleep = null;  // { until: ms } or { hour: true }: when to stop
    this.sleepTimer = 0;

    // If Web Audio is used after all (an iPad with a trackpad), ask Safari to
    // treat it as playback, not ambient sound. Safari 16.4 and later only.
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {
      // not settable here
    }
    this.setMediaHandlers();

    document.addEventListener("keydown", (event) => {
      const t = event.target;
      if (t instanceof Element && t.closest("dialog[open], summary")) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (event.code === "Space" && !(t && t.tagName === "BUTTON")) {
        event.preventDefault();
        this.toggle();
      } else if (event.key === "ArrowLeft" && !event.altKey) {
        event.preventDefault();
        this.seek(this.currentTime - 10);
      } else if (event.key === "ArrowRight" && !event.altKey) {
        event.preventDefault();
        this.seek(this.currentTime + 10);
      }
    });
  }

  // Attached to the document and loaded by setting src only: a detached
  // element, or an extra load() call, left Chrome stuck at 0:00 with play()
  // pending forever (seen on 22 Nov 2026 with a local Range-capable server).
  createAudio() {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.hidden = true;
    try {
      a.volume = clamp(this.effectiveVolume(), 0, 1); // a fresh element (each hour) keeps the listener's volume
    } catch {
      // read-only here
    }
    const emit = () => this.emitState();
    for (const name of ["play", "pause", "playing", "waiting", "timeupdate", "durationchange", "ended", "emptied"]) {
      a.addEventListener(name, emit);
    }
    a.addEventListener("loadedmetadata", () => {
      if (this.pendingSeek !== null) {
        a.currentTime = Math.min(this.pendingSeek, Math.max(0, (a.duration || this.pendingSeek + 1) - 0.25));
        this.pendingSeek = null;
      }
    });
    a.addEventListener("error", () => {
      if (a !== this.audio) return;
      this.listening.finish();
      this.error = "Couldn't load the audio for this hour.";
      this.emitState();
    });
    a.addEventListener("ended", () => {
      if (a !== this.audio) return;
      this.listening.interrupt();
      if (this.sleep && this.sleep.hour) {
        this.setSleep(null); // the sleep timer said: stop with this hour
        this.wanted = false;
        this.listening.finish();
        this.emitState();
        return;
      }
      const next = this.next();
      if (next) this.load(next, { autoplay: true });
      else this.listening.finish();
    });
    a.addEventListener("playing", () => {
      if (a !== this.audio || a.paused) return;
      this.startMeter();
      if (this.segment) this.listening.playing(this.segment.session);
      if (a.seeking) this.listening.interrupt();
    });
    for (const name of ["waiting", "seeking"]) a.addEventListener(name, () => {
      if (a === this.audio) this.listening.interrupt();
    });
    a.addEventListener("seeked", () => {
      if (a === this.audio && !a.paused && !a.ended && a.readyState >= a.HAVE_FUTURE_DATA) this.listening.resume();
    });
    a.addEventListener("pause", () => {
      if (a === this.audio && a.paused && !a.ended) this.listening.finish();
    });
    for (const name of ["pause", "ended", "emptied"]) a.addEventListener(name, () => this.stopMeter());
    for (const name of ["durationchange", "play", "pause", "seeked", "ratechange", "emptied"]) a.addEventListener(name, () => {
      if (a === this.audio) this.syncMediaSession();
    });
    // handlers set before the page became "now playing" can be ignored on iOS: set them again
    a.addEventListener("playing", () => {
      if (a === this.audio) this.setMediaHandlers();
    });
    if (this.container) this.container.prepend(a);
    return a;
  }

  // Swap in a fresh element (without Web Audio) for audio we may not analyse.
  replaceAudio() {
    this.stopMeter();
    this.audio.pause();
    this.audio.remove();
    if (this.graph) this.graph.ctx.close().catch(() => {});
    this.graph = null;
    this.audio = this.createAudio();
  }

  get isPlaying() {
    return Boolean(this.segment) && !this.audio.paused && !this.audio.ended;
  }
  get currentTime() {
    return this.audio.currentTime || 0;
  }
  // The wall-clock moment being played (ms, site's local clock), or null.
  get moment() {
    return this.segment ? this.segment.start + this.currentTime * 1000 : null;
  }
  get duration() {
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.segment ? this.segment.durationSec : 0;
  }

  emitState() {
    this.checkSleep();
    this.calling = this.callsAt(this.currentTime);
    this.callingArt = this.segment ? this.calling.map((d) => this.artOf(d.common_name)).find(Boolean) || null : null;
    if (this.callingArt) this.lastHeard = this.callingArt;
    this.dispatchEvent(new CustomEvent("state"));
    this.renderBar();
  }

  // the place's species entry with a plate, by name
  artOf(name) {
    return this.segment?.site?.species?.find((s) => s.name === name && s.image) || null;
  }
  // The bird to show for the hour: the one calling now (with a plate), else the
  // last one heard in this hour, else the hour's own plate (as on the lock
  // screen). { name, image, kind: "calling" | "heard" | "hour" } or null.
  get bird() {
    if (!this.segment) return null;
    if (this.callingArt) return { name: this.callingArt.name, image: this.callingArt.image, kind: "calling" };
    if (this.lastHeard) return { name: this.lastHeard.name, image: this.lastHeard.image, kind: "heard" };
    const plate = hourPlate(this.segment);
    return plate ? { ...plate, kind: "hour" } : null;
  }

  // sure detections whose call spans this second of the hour, most certain first
  callsAt(t) {
    if (!this.segment || !this.calls.length) return [];
    const best = new Map();
    for (const d of this.calls) {
      if (!d.checked && d.confidence < NOW_CONFIDENT) continue;
      const end = Number.isFinite(d.end_sec) ? d.end_sec : d.start_sec + 3;
      if (t < d.start_sec - 0.3 || t > end + 0.6) continue;
      const seen = best.get(d.common_name);
      if (!seen || d.confidence > seen.confidence) best.set(d.common_name, d);
    }
    return [...best.values()].sort((a, b) => b.confidence - a.confidence);
  }

  // Load an hour, optionally starting `at` a number of seconds into it.
  load(segment, { autoplay = false, at = null } = {}) {
    if (!segment) return;
    if (this.segment === segment) {
      if (at !== null) this.seek(at);
      if (autoplay) this.play();
      return;
    }
    this.listening.interrupt();
    if (!autoplay || !segment.public_url || this.segment?.session !== segment.session) this.listening.finish();
    this.segment = segment;
    this.error = "";
    this.pendingSeek = at !== null && at > 0 ? at : null;
    this.calls = [];
    this.lastHeard = null;
    loadDetections(segment).then((list) => {
      if (this.segment !== segment) return;
      this.calls = list;
      this.emitState();
    }).catch(() => {});
    const cors = Boolean(segment.public_url) && analysable(segment.public_url);
    if (this.graph && !cors) this.replaceAudio();
    this.audio.pause();
    if (cors) this.audio.crossOrigin = "anonymous";
    else this.audio.removeAttribute("crossorigin");
    if (segment.public_url) {
      this.audio.src = segment.public_url;
    } else {
      this.audio.removeAttribute("src");
      this.audio.load();
      this.error = "No audio has been published for this hour yet.";
    }
    this.dispatchEvent(new CustomEvent("change", { detail: segment }));
    this.setMediaMetadata();
    if (autoplay && segment.public_url) this.play();
    this.emitState();
  }

  play() {
    if (!this.segment || !this.segment.public_url) return;
    this.wanted = true;
    this.error = "";
    this.ensureGraph();
    if (this.graph && this.graph.ctx.state === "suspended") this.graph.ctx.resume().catch(() => {});
    const { audio, segment } = this;
    audio.play().catch((err) => {
      if (audio === this.audio && segment === this.segment && audio.paused) this.listening.finish();
      if (err && err.name === "AbortError") {
        // interrupted by a pause or another hour before it started: not a failure
      } else if (err && err.name === "NotAllowedError") {
        this.error = "Press play to start listening.";
      } else if (!this.audio.error) {
        this.error = "Playback could not start.";
      }
      this.emitState();
    });
  }
  pause() {
    this.wanted = false;
    this.listening.finish();
    this.audio.pause();
    if (this.sleep) this.setSleep(null); // a timer outlives no pause: it would fire on the next play
  }
  toggle() {
    if (!this.segment) {
      const s = this.suggestion;
      if (s) this.load(s.seg, { autoplay: true, at: s.at });
      return;
    }
    if (this.isPlaying) this.pause();
    else this.play();
  }
  // what the idle bar offers (null: nothing); ignored once an hour is loaded
  suggest(suggestion) {
    if (this.suggestion === suggestion) return;
    this.suggestion = suggestion && suggestion.seg && suggestion.seg.public_url ? suggestion : null;
    if (!this.segment) this.renderBar();
  }
  seek(seconds) {
    if (!this.segment) return;
    const d = this.duration;
    this.audio.currentTime = clamp(seconds, 0, d ? d - 0.25 : 0);
    this.lastHeard = null; // heard later in the hour, perhaps: not "last heard" from here
    this.emitState();
  }
  retry() {
    if (!this.segment) return;
    const seg = this.segment;
    this.segment = null;
    this.load(seg, { autoplay: true });
  }

  // ---- the level line ---------------------------------------------------------

  // Web Audio, set up on the first play (browsers only allow it after a click)
  ensureGraph() {
    if (this.graph || !this.audio.crossOrigin || !window.matchMedia?.(METER_MEDIA).matches) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      const ctx = new Context();
      const source = ctx.createMediaElementSource(this.audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      // the meter reads the recording itself; the listener's volume comes after it,
      // then straight out (dry, up to 100%) or through the soft clipper (wet, a boost),
      // scaled down into the clipper curve's -1..1 range
      const gain = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      wet.gain.value = 0;
      const scale = ctx.createGain();
      scale.gain.value = 1 / HEADROOM;
      const clipper = ctx.createWaveShaper();
      clipper.curve = softClipCurve();
      clipper.oversample = "2x"; // the rounded peaks without aliasing
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(dry);
      dry.connect(ctx.destination);
      gain.connect(scale);
      scale.connect(clipper);
      clipper.connect(wet);
      wet.connect(ctx.destination);
      this.graph = { ctx, analyser, gain, dry, wet, samples: new Float32Array(analyser.fftSize) };
    } catch {
      this.graph = null;
    }
    this.applyVolume();
    if (this.dom) this.dom.level.hidden = !this.graph;
  }
  startMeter() {
    if (this.raf || !this.graph || !this.dom) return;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const { analyser, samples } = this.graph;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const db = 10 * Math.log10(sum / samples.length + 1e-12); // loudness, dB below full scale
      const target = clamp((db + 70) / 50, 0, 1);                // field recordings sit around -70 to -20 dB
      this.level = target > this.level ? target : this.level * 0.9 + target * 0.1; // quick to rise, slow to fall
      this.dom.levelFill.style.transform = `scaleX(${this.level.toFixed(3)})`;
    };
    this.raf = requestAnimationFrame(tick);
  }
  stopMeter() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.level = 0;
    if (this.dom) this.dom.levelFill.style.transform = "scaleX(0)";
  }

  // ---- the sleep timer ---------------------------------------------------------
  // Checked on every player event (timeupdate fires a few times a second while
  // playing, also with the screen locked) and by a timeout as a back-up.

  setSleep(choice) {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = 0;
    this.setVolume(1);
    if (choice === "hour") this.sleep = { hour: true };
    else if (Number.isFinite(choice) && choice > 0) {
      const until = Date.now() + choice * 60_000;
      this.sleep = { until, minutes: choice };
      this.sleepTimer = setTimeout(() => this.checkSleep(), choice * 60_000 + 50);
    } else this.sleep = null;
    this.dispatchEvent(new CustomEvent("state"));
  }
  // minutes left on the timer (rounded up), or null
  get sleepLeft() {
    if (!this.sleep || !this.sleep.until) return null;
    return Math.max(0, Math.ceil((this.sleep.until - Date.now()) / 60_000));
  }
  checkSleep() {
    if (!this.sleep || !this.sleep.until) return;
    const left = (this.sleep.until - Date.now()) / 1000;
    if (left <= 0) {
      this.pause(); // pausing ends the timer and puts the volume back, after the sound has stopped
      return;
    }
    this.setVolume(left < FADE_SEC ? left / FADE_SEC : 1);
  }
  // the sleep timer's fade (0..1); iOS keeps the volume with the listener, and ignores this
  setVolume(v) {
    this.fade = clamp(v, 0, 1);
    this.applyVolume();
  }
  // the slider (0..2, see BOOST_DB) as a gain, times the sleep timer's fade
  effectiveVolume() {
    if (this.muted) return 0;
    const s = this.userVolume;
    return (s <= 1 ? s ** 2 : 10 ** (((s - 1) * BOOST_DB) / 20)) * this.fade;
  }
  applyVolume() {
    const v = this.effectiveVolume();
    if (this.graph) {
      const { ctx, gain, dry, wet } = this.graph;
      const boosting = v > 1;
      gain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      dry.gain.setTargetAtTime(boosting ? 0 : 1, ctx.currentTime, 0.02);
      wet.gain.setTargetAtTime(boosting ? 1 : 0, ctx.currentTime, 0.02);
    }
    const element = this.graph ? 1 : Math.min(1, v); // with Web Audio the gain node does it; without, no boost
    try {
      if (Math.abs(this.audio.volume - element) > 0.001) this.audio.volume = clamp(element, 0, 1);
    } catch {
      // read-only here
    }
  }
  setUserVolume(v) {
    let s = clamp(v, 0, canBoost() ? 2 : 1);
    if (Math.abs(s - 1) < 0.04) s = 1; // the recording's own level is easy to land on
    this.userVolume = s;
    if (this.userVolume > 0) this.muted = false; // moving the slider up unmutes
    writeStore("volume", String(Math.round(this.userVolume * 100) / 100));
    writeStore("muted", this.muted ? "1" : "0");
    this.applyVolume();
    this.renderVolume();
  }
  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted && this.userVolume === 0) this.userVolume = 0.5; // unmuting a slider at zero
    writeStore("muted", this.muted ? "1" : "0");
    writeStore("volume", String(this.userVolume));
    this.applyVolume();
    this.renderVolume();
  }
  renderVolume() {
    const d = this.dom;
    if (!d || !d.volume) return;
    const max = canBoost() ? 2 : 1;
    if (d.volume.max !== String(max)) d.volume.max = String(max);
    const shown = this.muted ? 0 : Math.min(this.userVolume, max);
    if (Math.abs(Number(d.volume.value) - shown) > 0.001) d.volume.value = String(shown);
    const text = shown <= 1 ? `${Math.round(shown * 100)}%` : `+${((shown - 1) * BOOST_DB).toFixed(1)} dB above the recording`;
    d.volume.setAttribute("aria-valuetext", text);
    d.volume.title = shown <= 1 ? `Volume ${text}` : `Volume: ${text}`;
    d.vol.classList.toggle("boosted", shown > 1);
    const icon = shown === 0 ? ICON_MUTED : shown < 0.5 ? ICON_VOL_LOW : ICON_VOL;
    if (d.mute.innerHTML !== icon) d.mute.innerHTML = icon;
    const label = this.muted ? "Unmute" : "Mute";
    d.mute.setAttribute("aria-label", label);
    d.mute.title = label;
  }

  // ---- the lock screen and Control Center ------------------------------------

  setMediaHandlers() {
    const session = navigator.mediaSession;
    if (!session) return;
    const skip = (step) => {
      const seg = this.neighbour(step);
      if (seg) this.load(seg, { autoplay: true });
    };
    const handlers = {
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.pause(),
      seekto: (event) => {
        if (Number.isFinite(event.seekTime)) this.seek(event.seekTime);
      },
      previoustrack: () => skip(-1),
      nexttrack: () => skip(1),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // this browser doesn't offer that button
      }
    }
  }
  // The place as the title, the day and hour under it, and a plate as the
  // artwork: the hour's most-heard species that has one, else the place's.
  setMediaMetadata() {
    const session = navigator.mediaSession;
    if (!session || typeof MediaMetadata === "undefined") return;
    const seg = this.segment;
    if (!seg) {
      session.metadata = null;
      return;
    }
    const image = hourPlate(seg)?.image;
    const artwork = image
      ? [{ src: new URL(image, document.baseURI).href }]
      : [{ src: new URL("assets/apple-touch-icon.png", document.baseURI).href, sizes: "180x180", type: "image/png" }];
    try {
      session.metadata = new MediaMetadata({
        title: seg.site.site_name || seg.site_id,
        artist: `${fmtDay(seg.start)} · ${fmtClock(seg.start)}${seg.period ? ` · ${humanize(seg.period).toLowerCase()}` : ""}`,
        album: "Soundscape Atlas",
        artwork,
      });
    } catch {
      // an old browser without artwork support
    }
  }
  syncMediaSession() {
    const session = navigator.mediaSession;
    if (!session) return;
    session.playbackState = !this.segment ? "none" : this.isPlaying ? "playing" : "paused";
    const d = this.audio.duration;
    if (!session.setPositionState || !this.segment || !Number.isFinite(d) || d <= 0) return;
    try {
      session.setPositionState({ duration: d, playbackRate: this.audio.playbackRate || 1, position: clamp(this.audio.currentTime || 0, 0, d) });
    } catch {
      // a position the browser refuses (mid-load): the next event sets it again
    }
  }

  neighbour(step) {
    if (!this.segment || !this.segment.session) return null;
    const list = this.segment.session.segments;
    const i = list.indexOf(this.segment);
    return list[i + step] || null;
  }
  next() {
    return this.neighbour(1);
  }
  prev() {
    return this.neighbour(-1);
  }

  // ---- the bar -------------------------------------------------------------

  mount(container) {
    const d = {};
    d.play = el("button", { class: "player-play", type: "button", "aria-label": "Play", title: "Play or pause (Space)", html: ICON_PLAY, onclick: () => this.toggle() });
    d.title = el("div", { class: "player-title" });
    d.nowArt = el("span", { class: "player-now-art" });
    d.nowName = el("span", { class: "player-now-name" });
    d.now = el("div", { class: "player-now", "aria-hidden": "true" }, d.nowArt, d.nowName);
    d.clock = el("span", { class: "player-clock" });
    d.levelFill = el("i");
    d.level = el("span", { class: "player-level", "aria-hidden": "true", hidden: true }, d.levelFill);
    d.time = el("div", { class: "player-time" }, d.clock, d.level);
    d.prev = el("button", { class: "player-skip", type: "button", "aria-label": "Previous hour", title: "Previous hour", html: ICON_PREV, onclick: () => this.prev() && this.load(this.prev(), { autoplay: this.isPlaying || this.wanted }) });
    d.next = el("button", { class: "player-skip", type: "button", "aria-label": "Next hour", title: "Next hour", html: ICON_NEXT, onclick: () => this.next() && this.load(this.next(), { autoplay: this.isPlaying || this.wanted }) });
    // the sleep timer: a moon, with the minutes left beside it while it runs
    d.sleepWrap = createSleepControl(this).el;
    // phones: the session's chart in small, across the top of the bar
    d.strip = el("div", { class: "player-strip" });
    // the volume (wide screens with a mouse): mute, and a slider
    d.mute = el("button", { class: "player-mute", type: "button", onclick: () => this.toggleMute() });
    // 0..1 turns down, 1..2 boosts (where Web Audio can); a tick marks the recording's own level
    d.volume = el("input", {
      class: "player-volume", type: "range", min: "0", max: "2", step: "0.01", "aria-label": "Volume", title: "Volume",
      list: "player-volume-marks",
      oninput: (event) => this.setUserVolume(Number(event.target.value)),
    });
    d.vol = el("div", { class: "player-vol" }, d.mute, d.volume,
      el("datalist", { id: "player-volume-marks" }, el("option", { value: "1" })));
    d.msg = el("div", { class: "player-msg", hidden: true });
    d.retry = el("button", { class: "linklike", type: "button", onclick: () => this.retry() }, "Try again");
    d.progress = el("div", { class: "player-progress" });
    d.track = el("div", {
      class: "player-track",
      role: "slider",
      tabindex: "0",
      "aria-label": "Position in the hour",
      title: "Position in the hour (← and → move 10 seconds)",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
      onclick: (event) => {
        const r = d.track.getBoundingClientRect();
        this.seek(((event.clientX - r.left) / r.width) * this.duration);
      },
    }, d.progress);
    d.bar = el("div", { class: "player", "data-state": "idle" },
      d.strip,
      d.track,
      el("div", { class: "player-row" }, d.play, d.title, d.now, d.msg, d.time, d.vol, d.sleepWrap, el("div", { class: "player-nav" }, d.prev, d.next)));
    // The title opens the place page at the hour (on phones it opens Now Playing,
    // js/nowplaying.js). Already on that place's page, it brings the playing
    // session into view instead (the address would not change).
    d.title.addEventListener("click", (event) => {
      const seg = this.segment;
      if (!seg || isPhone() || !(event.target instanceof Element) || !event.target.closest(".player-link")) return;
      const here = `#/site/${encodeURIComponent(seg.site.id)}`;
      if (location.hash === here || location.hash.startsWith(`${here}?`)) {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent("reveal", { detail: seg }));
      }
    });
    container.append(this.audio, d.bar);
    this.container = container;
    this.dom = d;
    this.renderVolume();
    this.renderBar();
  }

  renderBar() {
    const d = this.dom;
    if (!d) return;
    const seg = this.segment;
    const playing = this.isPlaying;
    let state = "idle";
    if (seg) state = this.error ? "error" : playing ? "playing" : "paused";
    d.bar.dataset.state = state;
    d.play.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    d.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    d.play.disabled = seg ? !seg.public_url : !this.suggestion;
    d.bar.toggleAttribute("data-suggest", !seg && Boolean(this.suggestion));
    d.prev.disabled = !this.prev();
    d.next.disabled = !this.next();

    d.title.innerHTML = "";
    d.clock.innerHTML = "";
    if (!seg && this.suggestion) {
      const s = this.suggestion;
      d.play.setAttribute("aria-label", `Play: ${s.seg.site.site_name}, ${s.text}`);
      d.title.append(
        el("a", { href: `#/site/${encodeURIComponent(s.seg.site.id)}?at=${encodeURIComponent(s.seg.segment_id)}`, class: "player-link" },
          el("strong", {}, s.seg.site.site_name || s.seg.site_id),
          el("span", {}, s.text)));
    } else if (!seg) {
      d.title.append(el("span", { class: "player-hint" }, "Press ▶ on a place or an hour to listen."));
    } else {
      const when = `${fmtDay(seg.start)}${seg.period ? ` · ${humanize(seg.period).toLowerCase()}` : ""}`;
      // Phones: the bird of the moment replaces the date line once one has
      // called (ochre while it calls). A problem replaces either, so the
      // place's name always stays in view.
      const bird = this.bird;
      const heard = !this.error && bird && bird.kind !== "hour" ? bird : null;
      d.title.append(
        el("a", { href: `#/site/${encodeURIComponent(seg.site.id)}?at=${encodeURIComponent(seg.segment_id)}`, class: "player-link" },
          el("strong", {}, seg.site.site_name || seg.site_id),
          this.error ? el("span", { class: "player-error" }, this.error) : el("span", { class: heard ? "player-when has-bird" : "player-when" }, when),
          heard ? el("span", { class: `player-bird${heard.kind === "calling" ? " calling" : ""}` }, heard.name) : null));
      // the recording's own clock: the time of day at the place, as it was
      const moment = this.moment;
      const seconds = String(new Date(moment).getUTCSeconds()).padStart(2, "0");
      d.clock.append(fmtClock(moment), el("small", {}, `:${seconds}`));
    }

    // the bird calling now: shown while a sure call is under the playhead, faded otherwise
    const call = seg && this.calling[0];
    if (call && d.now.dataset.name !== call.common_name) {
      d.now.dataset.name = call.common_name;
      d.nowName.textContent = call.common_name;
      const image = seg.site?.species?.find((s) => s.name === call.common_name)?.image;
      d.nowArt.innerHTML = "";
      if (image) d.nowArt.append(el("img", { src: image, alt: "" }));
      d.nowArt.hidden = !image;
    }
    d.now.classList.toggle("on", Boolean(call));
    d.msg.hidden = !(seg && this.error && this.audio.error);
    d.msg.innerHTML = "";
    if (!d.msg.hidden) d.msg.append(d.retry);

    // phones: the session strip
    if (seg && isPhone()) {
      if (!this.strip || this.strip.session !== seg.session) {
        const chart = createSessionChart(seg.session, {
          maxRate: seg.site.maxRate,
          onSeek: (s, at) => this.load(s, { autoplay: true, at }),
          onSelect: (s) => this.load(s, { autoplay: this.isPlaying || this.wanted }),
        });
        this.strip = { session: seg.session, chart, seg: null };
        d.strip.replaceChildren(chart.el);
      }
      if (this.strip.seg !== seg) {
        this.strip.seg = seg;
        this.strip.chart.setSelected(seg);
      }
      this.strip.chart.setPlayhead(this.moment);
    }
    const frac = this.duration ? this.currentTime / this.duration : 0;
    d.progress.style.width = `${(frac * 100).toFixed(3)}%`;
    d.track.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  }
}

export const player = new Player();
