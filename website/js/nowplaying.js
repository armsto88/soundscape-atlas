// Now Playing, on phones: tapping the player bar opens a full-screen view of
// what is playing, as in a podcast app. The plate of the bird calling now (else
// the last one heard, else the hour's most-heard one: player.bird, as in the
// bar), the place and the hour, the whole session as a
// chart to tap or scrub through, large controls and a sleep timer. It closes
// with the chevron, a swipe down, Escape, or by going to another page.
//
// It does not add a history entry for Back: the router reads the address on
// every hash change, and hours moving on (history.replaceState) would leave a
// stale entry behind that re-renders the page when Back is pressed.
//
// On wider screens the bar's title stays a link to the place page.

import { el, fmtDay, fmtClock, humanize, plural, isPhone } from "./util.js";
import { createSessionChart } from "./sessionchart.js";
import { SLEEP_CHOICES } from "./player.js";

const stroke = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const solid = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="${d}"/></svg>`;
const ICON = {
  down: stroke("M6 9l6 6 6-6"),
  back: stroke("M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4"),
  ahead: stroke("M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"),
  moon: stroke("M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"),
  play: solid("M7 4.5v15l12-7.5z"),
  pause: solid("M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"),
  prev: solid("M5 5h2.5v14H5zm14 0v14L8.5 12z"),
  next: solid("M16.5 5H19v14h-2.5zM5 5l10.5 7L5 19z"),
};
const CLOSE_MS = 220;

export function mountNowPlaying(player) {
  let dialog = null;
  let d = null;
  let chart = null;
  let chartSession = null;
  let shown = {}; // what is on screen, to touch the page only when it changes

  // the bar's plate, title and clock open the view on phones (the play button, the
  // session strip and the sleep timer keep their jobs)
  document.addEventListener("click", (event) => {
    const hit = event.target instanceof Element && event.target.closest(".player-art, .player-title, .player-time");
    if (!hit || !player.segment || !isPhone()) return;
    event.preventDefault();
    open();
  });
  // a real page change (a link, or Back) closes it
  window.addEventListener("hashchange", () => {
    if (dialog && dialog.open) close();
  });

  function build() {
    d = {};
    d.close = el("button", { class: "np-icon", type: "button", "aria-label": "Close", html: ICON.down, onclick: () => close() });
    d.place = el("a", { class: "np-place", href: "#/", onclick: () => close() }, "Open place");
    d.img = el("img", { alt: "" });
    d.ring = el("div", { class: "np-ring" }, d.img);
    d.caption = el("p", { class: "np-caption" });
    d.top = el("div", { class: "np-top" },
      el("span", { class: "np-grab", "aria-hidden": "true" }),
      el("header", { class: "np-head" }, d.close, el("span", { class: "np-label" }, "Now playing"), d.place),
      d.ring, d.caption);
    d.title = el("h2", { class: "np-title" });
    d.when = el("p", { class: "np-when" });
    d.chart = el("div", { class: "np-chart" });
    d.clock = el("span", { class: "np-clock" });
    d.hour = el("span", { class: "np-hour" });
    const skip = (step) => {
      const seg = player.neighbour(step);
      if (seg) player.load(seg, { autoplay: player.isPlaying || player.wanted });
    };
    d.back = el("button", { class: "np-icon np-jump", type: "button", "aria-label": "Back 15 seconds", html: `${ICON.back}<small>15</small>`, onclick: () => player.seek(player.currentTime - 15) });
    d.prev = el("button", { class: "np-icon", type: "button", "aria-label": "Previous hour", html: ICON.prev, onclick: () => skip(-1) });
    d.play = el("button", { class: "np-play", type: "button", onclick: () => player.toggle() });
    d.next = el("button", { class: "np-icon", type: "button", "aria-label": "Next hour", html: ICON.next, onclick: () => skip(1) });
    d.ahead = el("button", { class: "np-icon np-jump", type: "button", "aria-label": "Forward 30 seconds", html: `${ICON.ahead}<small>30</small>`, onclick: () => player.seek(player.currentTime + 30) });
    d.msg = el("p", { class: "np-msg", role: "status" });
    d.sleep = el("button", { class: "np-chip", type: "button", "aria-expanded": "false", onclick: () => toggleMenu() });
    d.menu = el("div", { class: "np-sleep-menu", role: "group", "aria-label": "Stop playing after", hidden: true },
      ...SLEEP_CHOICES.map((choice) => el("button", {
        class: "np-chip", type: "button", "data-choice": String(choice),
        onclick: () => {
          player.setSleep(choice);
          toggleMenu(false);
        },
      }, choice === "hour" ? "End of this hour" : `${choice} min`)),
      el("button", { class: "np-chip", type: "button", "data-choice": "off", onclick: () => {
        player.setSleep(null);
        toggleMenu(false);
      } }, "Off"));
    dialog = el("dialog", { class: "np", "aria-label": "Now playing" },
      d.top,
      el("div", { class: "np-body" },
        d.title, d.when, d.chart,
        el("div", { class: "np-time" }, d.clock, d.hour),
        el("div", { class: "np-controls" }, d.back, d.prev, d.play, d.next, d.ahead),
        d.msg,
        el("div", { class: "np-extra" }, d.sleep, d.menu)));
    // Escape: close the same way as the chevron
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("close", () => {
      dialog.classList.remove("closing");
      dialog.style.transform = "";
      toggleMenu(false);
    });
    dragToClose(d.top);
    document.body.append(dialog);
    player.addEventListener("state", () => dialog.open && render());
    player.addEventListener("change", () => dialog.open && render());
  }

  function open() {
    if (!dialog) build();
    if (dialog.open) return;
    shown = {};
    render();
    dialog.showModal();
  }
  function close() {
    if (!dialog || !dialog.open || dialog.classList.contains("closing")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    dialog.style.transform = "";
    dialog.classList.add("closing"); // slides down from wherever a drag left it
    setTimeout(() => dialog.close(), CLOSE_MS);
  }

  // drag the top of the view down to close it, as with a sheet
  function dragToClose(zone) {
    let y0 = null;
    let dy = 0;
    let t0 = 0;
    zone.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || event.target.closest("button, a")) return;
      y0 = event.clientY;
      dy = 0;
      t0 = performance.now();
      zone.setPointerCapture(event.pointerId);
      dialog.classList.add("dragging");
    });
    zone.addEventListener("pointermove", (event) => {
      if (y0 === null) return;
      dy = Math.max(0, event.clientY - y0);
      dialog.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (y0 === null) return;
      y0 = null;
      const quick = dy > 30 && dy / Math.max(1, performance.now() - t0) > 0.6; // a flick
      dialog.classList.remove("dragging");
      if (dy > 110 || quick) close();
      else dialog.style.transform = "";
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  function toggleMenu(force) {
    if (!d) return;
    const openMenu = force === undefined ? d.menu.hidden : force;
    d.menu.hidden = !openMenu;
    d.sleep.setAttribute("aria-expanded", String(openMenu));
    if (openMenu) d.menu.scrollIntoView({ block: "nearest", behavior: "smooth" }); // on a small screen it opens below the edge
  }

  function render() {
    const seg = player.segment;
    if (!seg) return;
    const site = seg.site;

    // the session's chart, made again only when the session changes
    if (chartSession !== seg.session) {
      chartSession = seg.session;
      chart = createSessionChart(seg.session, {
        maxRate: site.maxRate,
        onSeek: (s, at) => player.load(s, { autoplay: true, at }),
        onSelect: (s) => {
          if (s !== player.segment) player.load(s, { autoplay: player.isPlaying || player.wanted });
        },
      });
      d.chart.replaceChildren(chart.el);
    }
    chart.setSelected(seg);
    chart.setPlayhead(player.moment);

    // the bird calling now, else the last one heard, else the hour's own plate
    const bird = player.bird;
    const image = bird ? bird.image : "assets/mark.svg";
    if (shown.image !== image) {
      shown.image = image;
      d.img.src = image;
    }
    d.ring.classList.toggle("calling", Boolean(bird && bird.kind === "calling"));
    const caption = bird ? `${bird.kind}:${bird.name}` : "";
    if (shown.caption !== caption) {
      shown.caption = caption;
      d.caption.replaceChildren(...(!bird ? [] : bird.kind === "calling" ? [el("i", {}, "Calling now"), ` · ${bird.name}`]
        : bird.kind === "heard" ? [`Last heard · ${bird.name}`] : [`Most heard this hour · ${bird.name}`]));
    }

    if (shown.seg !== seg) {
      shown.seg = seg;
      d.title.textContent = site.site_name || seg.site_id;
      const heard = seg.heard.length ? ` · ${plural(seg.heard.length, "species", "species")} this hour` : "";
      d.when.textContent = `${fmtDay(seg.start)}${seg.period ? ` · ${humanize(seg.period).toLowerCase()}` : ""}${heard}`;
      d.hour.textContent = `${fmtClock(seg.start)}–${fmtClock(seg.end)}`;
      d.place.href = `#/site/${encodeURIComponent(site.id)}?at=${encodeURIComponent(seg.segment_id)}`;
      d.prev.disabled = !player.prev();
      d.next.disabled = !player.next();
    }

    const moment = player.moment;
    const seconds = String(new Date(moment).getUTCSeconds()).padStart(2, "0");
    d.clock.replaceChildren(fmtClock(moment), el("small", {}, `:${seconds}`));

    const playing = player.isPlaying;
    if (shown.playing !== playing) {
      shown.playing = playing;
      d.play.innerHTML = playing ? ICON.pause : ICON.play;
      d.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    d.play.disabled = !seg.public_url;
    d.msg.textContent = player.error || "";
    d.msg.hidden = !player.error;

    // the sleep timer
    const sleep = player.sleep;
    const left = player.sleepLeft;
    const label = !sleep ? "Sleep timer" : sleep.hour ? "Stops when this hour ends" : `Stops in ${plural(Math.max(1, left), "minute")}`;
    if (shown.sleep !== label) {
      shown.sleep = label;
      d.sleep.innerHTML = ICON.moon;
      d.sleep.append(label);
      d.sleep.classList.toggle("on", Boolean(sleep));
      const current = !sleep ? "off" : sleep.hour ? "hour" : String(sleep.minutes);
      for (const b of d.menu.querySelectorAll("[data-choice]")) b.setAttribute("aria-pressed", String(b.dataset.choice === current));
    }
  }
}
