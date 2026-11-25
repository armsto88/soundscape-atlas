// One audio element for the whole app and the persistent bar at the bottom.
// Screens never touch the <audio> directly: they call load/toggle/seek and
// listen for "change" (a different hour) and "state" (playing, paused, time,
// error). `calling` lists the species calling at the playhead (sure ones only),
// from the hour's detections.
//
// The bar shows the recording's own clock, the bird calling now, and a thin
// sound-level line. The level needs Web Audio, which needs the audio fetched
// with CORS: that is done only for audio from this site or our R2 domain (both
// send the headers). Audio from anywhere else plays on a fresh element without
// the level, because routed through Web Audio it would play silent.

import { el, fmtDay, fmtClock, humanize, clamp } from "./util.js";
import { loadDetections } from "./data.js";
import { createListeningTracker } from "./analytics.js";

const NOW_CONFIDENT = 0.7; // "now calling" shows checked calls and ones at least this sure
const CORS_HOSTS = ["media.soundscapeatlas.com"];
const analysable = (url) => {
  try {
    const u = new URL(url, document.baseURI);
    return u.origin === location.origin || CORS_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h2.5v14H5zm14 0v14L8.5 12z"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 5H19v14h-2.5zM5 5l10.5 7L5 19z"/></svg>';

class Player extends EventTarget {
  constructor() {
    super();
    this.listening = createListeningTracker();
    this.audio = this.createAudio();
    this.segment = null;
    this.error = "";
    this.pendingSeek = null;
    this.wanted = false; // the listener pressed play (survives hour changes)
    this.dom = null;
    this.container = null;
    this.calls = [];    // the hour's detections, once loaded
    this.calling = [];  // detections at the playhead
    this.graph = null;  // Web Audio analyser for the level line
    this.level = 0;
    this.raf = 0;

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
    this.calling = this.callsAt(this.currentTime);
    this.dispatchEvent(new CustomEvent("state"));
    this.renderBar();
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
      if (err && err.name === "NotAllowedError") {
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
  }
  toggle() {
    if (!this.segment) return;
    if (this.isPlaying) this.pause();
    else this.play();
  }
  seek(seconds) {
    if (!this.segment) return;
    const d = this.duration;
    this.audio.currentTime = clamp(seconds, 0, d ? d - 0.25 : 0);
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
    if (this.graph || !this.audio.crossOrigin) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      const ctx = new Context();
      const source = ctx.createMediaElementSource(this.audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      this.graph = { ctx, analyser, samples: new Float32Array(analyser.fftSize) };
    } catch {
      this.graph = null;
    }
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
    d.play = el("button", { class: "player-play", type: "button", "aria-label": "Play", html: ICON_PLAY, onclick: () => this.toggle() });
    d.title = el("div", { class: "player-title" });
    d.nowArt = el("span", { class: "player-now-art" });
    d.nowName = el("span", { class: "player-now-name" });
    d.now = el("div", { class: "player-now", "aria-hidden": "true" }, d.nowArt, d.nowName);
    d.clock = el("span", { class: "player-clock" });
    d.levelFill = el("i");
    d.level = el("span", { class: "player-level", "aria-hidden": "true", hidden: true }, d.levelFill);
    d.time = el("div", { class: "player-time" }, d.clock, d.level);
    d.prev = el("button", { class: "player-skip", type: "button", "aria-label": "Previous hour", html: ICON_PREV, onclick: () => this.prev() && this.load(this.prev(), { autoplay: this.isPlaying || this.wanted }) });
    d.next = el("button", { class: "player-skip", type: "button", "aria-label": "Next hour", html: ICON_NEXT, onclick: () => this.next() && this.load(this.next(), { autoplay: this.isPlaying || this.wanted }) });
    d.msg = el("div", { class: "player-msg", hidden: true });
    d.retry = el("button", { class: "linklike", type: "button", onclick: () => this.retry() }, "Try again");
    d.progress = el("div", { class: "player-progress" });
    d.track = el("div", {
      class: "player-track",
      role: "slider",
      tabindex: "0",
      "aria-label": "Position in the hour",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
      onclick: (event) => {
        const r = d.track.getBoundingClientRect();
        this.seek(((event.clientX - r.left) / r.width) * this.duration);
      },
    }, d.progress);
    d.bar = el("div", { class: "player", "data-state": "idle" },
      d.track,
      el("div", { class: "player-row" }, d.play, d.title, d.now, d.msg, d.time, el("div", { class: "player-nav" }, d.prev, d.next)));
    container.append(this.audio, d.bar);
    this.container = container;
    this.dom = d;
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
    d.play.disabled = !seg || !seg.public_url;
    d.prev.disabled = !this.prev();
    d.next.disabled = !this.next();

    d.title.innerHTML = "";
    d.clock.innerHTML = "";
    if (!seg) {
      d.title.append(el("span", { class: "player-hint" }, "Choose a place on the map and press ▶ to listen."));
    } else {
      const when = `${fmtDay(seg.start)}${seg.period ? ` · ${humanize(seg.period).toLowerCase()}` : ""}`;
      // a problem replaces the date line, so the place's name always stays in view
      d.title.append(
        el("a", { href: `#/site/${encodeURIComponent(seg.site.id)}?at=${encodeURIComponent(seg.segment_id)}`, class: "player-link" },
          el("strong", {}, seg.site.site_name || seg.site_id),
          this.error ? el("span", { class: "player-error" }, this.error) : el("span", {}, when)));
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
    const frac = this.duration ? this.currentTime / this.duration : 0;
    d.progress.style.width = `${(frac * 100).toFixed(3)}%`;
    d.track.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  }
}

export const player = new Player();
