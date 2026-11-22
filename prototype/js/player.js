// One audio element for the whole app and the persistent bar at the bottom.
// Screens never touch the <audio> directly: they call load/toggle/seek and
// listen for "change" (a different hour) and "state" (playing, paused, time,
// error). The element has no crossorigin attribute, so audio can come from
// any host without CORS rules.

import { el, fmtTime, fmtDay, fmtClock, humanize, clamp } from "./util.js";

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h2.5v14H5zm14 0v14L8.5 12z"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 5H19v14h-2.5zM5 5l10.5 7L5 19z"/></svg>';

class Player extends EventTarget {
  constructor() {
    super();
    // Attached to the document and loaded by setting src only: a detached
    // element, or an extra load() call, left Chrome stuck at 0:00 with play()
    // pending forever (seen on 22 Nov 2026 with a local Range-capable server).
    this.audio = document.createElement("audio");
    this.audio.preload = "metadata";
    this.audio.hidden = true;
    this.segment = null;
    this.error = "";
    this.wanted = false; // the listener pressed play (survives hour changes)
    this.dom = null;

    const a = this.audio;
    const emit = () => this.emitState();
    for (const name of ["play", "pause", "playing", "waiting", "timeupdate", "durationchange", "ended", "emptied"]) {
      a.addEventListener(name, emit);
    }
    a.addEventListener("error", () => {
      this.error = "Couldn't load the audio for this hour.";
      this.emitState();
    });
    a.addEventListener("ended", () => {
      if (this.next()) this.load(this.next(), { autoplay: true });
    });

    document.addEventListener("keydown", (event) => {
      const t = event.target;
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

  get isPlaying() {
    return Boolean(this.segment) && !this.audio.paused && !this.audio.ended;
  }
  get currentTime() {
    return this.audio.currentTime || 0;
  }
  get duration() {
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.segment ? this.segment.durationSec : 0;
  }

  emitState() {
    this.dispatchEvent(new CustomEvent("state"));
    this.renderBar();
  }

  load(segment, { autoplay = false } = {}) {
    if (!segment) return;
    if (this.segment === segment) {
      if (autoplay) this.play();
      return;
    }
    this.segment = segment;
    this.error = "";
    this.audio.pause();
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
    this.audio.play().catch((err) => {
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

  neighbour(step) {
    if (!this.segment || !this.segment.night) return null;
    const list = this.segment.night.segments;
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
    d.time = el("div", { class: "player-time" }, "");
    d.prev = el("button", { class: "player-skip", type: "button", "aria-label": "Previous hour", title: "Previous hour", html: ICON_PREV, onclick: () => this.prev() && this.load(this.prev(), { autoplay: this.isPlaying || this.wanted }) });
    d.next = el("button", { class: "player-skip", type: "button", "aria-label": "Next hour", title: "Next hour", html: ICON_NEXT, onclick: () => this.next() && this.load(this.next(), { autoplay: this.isPlaying || this.wanted }) });
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
      el("div", { class: "player-row" }, d.play, d.title, d.msg, d.time, el("div", { class: "player-nav" }, d.prev, d.next)));
    container.append(this.audio, d.bar);
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
    if (!seg) {
      d.title.append(el("span", { class: "player-hint" }, "Choose a place on the atlas, then an hour of the night."));
      d.time.textContent = "";
    } else {
      const when = `${fmtDay(seg.start, { year: false })} · ${fmtClock(seg.start)}–${fmtClock(seg.end)}${seg.period ? ` · ${humanize(seg.period).toLowerCase()}` : ""}`;
      d.title.append(
        el("a", { href: `#/hour/${encodeURIComponent(seg.segment_id)}`, class: "player-link" },
          el("strong", {}, seg.site.site_name || seg.site_id), el("span", {}, when)));
      d.time.textContent = `${fmtTime(this.currentTime)} / ${fmtTime(this.duration)}`;
    }
    d.msg.hidden = !this.error;
    d.msg.innerHTML = "";
    if (this.error) {
      d.msg.append(this.error, " ");
      if (this.audio.error) d.msg.append(d.retry);
    }
    const frac = this.duration ? this.currentTime / this.duration : 0;
    d.progress.style.width = `${(frac * 100).toFixed(3)}%`;
    d.track.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  }
}

export const player = new Player();
