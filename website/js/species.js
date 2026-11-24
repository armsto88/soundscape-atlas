// "Most often heard here": an even grid of plates, each with a ring showing
// the species' share of calls. Birds first, then frogs in their own row.
// With a species search on the page, each plate is also a button that picks
// its species.

import { el, plural, info } from "./util.js";

const SHOW_FIRST = 12;
const PLACEHOLDER = `<svg viewBox="0 0 100 100" class="placeholder" aria-hidden="true">
  <line x1="16" y1="84" x2="86" y2="84" />
  <g class="ph-fill">
    <ellipse cx="48" cy="58" rx="25" ry="15" transform="rotate(-18 48 58)" />
    <circle cx="70" cy="40" r="10.5" />
    <polygon points="79,37 90,40 79,43" />
    <polygon points="28,64 8,75 12,67 5,62 26,58" />
  </g>
  <line x1="46" y1="71" x2="44" y2="84" /><line x1="54" y1="70" x2="56" y2="84" />
</svg>`;

// A species' plate in a small round frame, or the placeholder bird.
export function speciesThumb(sp, cls = "") {
  return el("span", { class: `thumb ${cls}`.trim() },
    sp.image ? el("img", { src: sp.image, alt: "", loading: "lazy" })
      : el("span", { class: "ph", role: "img", "aria-label": sp.frog ? "No illustration yet" : "No plate yet", html: PLACEHOLDER }));
}

// opts.find(sp): the searchable species for a plate (or nothing); opts.picked():
// the species picked now; opts.onPick(species) when a plate is pressed.
function tile(sp, total, opts) {
  const share = total ? sp.calls / total : 0;
  const pctText = share >= 0.01 ? `${Math.round(share * 100)}%` : "<1%";
  const art = sp.image
    ? el("img", { src: sp.image, alt: "", loading: "lazy" })
    : el("span", { class: "ph", role: "img", "aria-label": sp.frog ? "No illustration yet" : "No plate yet", html: PLACEHOLDER });
  const ring = el("div", { class: "ring" }, art);
  ring.style.setProperty("--p", String(Math.max(0.6, share * 100))); // custom properties need setProperty
  const body = [
    ring,
    el("b", {}, sp.name, sp.checked ? el("i", { class: "tick", role: "img", "aria-label": "checked by ear" }, " ✓") : null),
    el("span", {}, `${pctText} of ${sp.frog ? "frog " : ""}calls`),
  ];
  const target = opts.onPick && opts.find ? opts.find(sp) : null;
  if (!target) return el("li", { class: "tile" }, body);
  return el("li", { class: "tile" }, el("button", {
    class: "tile-btn",
    type: "button",
    "data-name": target.name,
    "aria-pressed": String(opts.picked() === target),
    onclick: () => opts.onPick(target),
  }, body));
}

function grid(list, opts) {
  const total = list.reduce((n, s) => n + s.calls, 0);
  const ul = el("ul", { class: "tiles" }, list.slice(0, SHOW_FIRST).map((s) => tile(s, total, opts)));
  if (list.length <= SHOW_FIRST) return [ul];
  const rest = list.slice(SHOW_FIRST);
  const btn = el("button", { class: "btn", type: "button", onclick: () => {
    ul.append(...rest.map((s) => tile(s, total, opts)));
    btn.remove();
  } }, `Show all ${plural(list.length, "species", "species")}`);
  return [ul, btn];
}

export function renderSpecies(site, opts = {}) {
  if (!site.species.length) return null;
  const birdsWithPlates = site.birds.filter((s) => s.image).length;
  const help = info("the species here",
    el("p", {}, "Every species BirdNET found in the published hours here, most calls first. The ring around each picture shows that species' share of all the calls detected here; ✓ means some of its calls were checked by ear."),
    opts.onPick ? el("p", {}, "Press a picture to follow that species through the sessions above: each chart gets a lane marking when it called.") : null);
  return el("section", { class: "site-species" },
    site.birds.length ? [el("h2", {}, "Most often heard here", help.button), help.panel, grid(site.birds, opts)] : null,
    site.frogs.length ? [el("h3", { class: "row-label" }, "Frogs heard here"), grid(site.frogs, opts)] : null,
    el("p", { class: "credit" },
      "Bird plates: hand-cut 1800s plates by Gould and others, from ",
      el("a", { href: "https://github.com/arnegiacomo/fugleramme" }, "Fugleramme"), " or cut for this site in the same way (CC BY-SA 4.0, ", el("a", { href: "art/birds/CREDITS.md" }, "credits"), "). ",
      "Frogs: drawn in the same style from photos (CC BY-SA 4.0, ", el("a", { href: "art/frogs/CREDITS.md" }, "credits"), "). ",
      birdsWithPlates < site.birds.length ? `${plural(site.birds.length - birdsWithPlates, "bird")} still without a plate.` : ""));
}
