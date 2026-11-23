// "Most often heard here": an even grid of plates, each with a ring showing
// the species' share of calls. Birds first, then frogs in their own row.

import { el, plural } from "./util.js";

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

function tile(sp, total) {
  const share = total ? sp.calls / total : 0;
  const pctText = share >= 0.01 ? `${Math.round(share * 100)}%` : "<1%";
  const art = sp.image
    ? el("img", { src: sp.image, alt: "", loading: "lazy" })
    : el("span", { class: "ph", title: sp.frog ? "No illustration yet" : "No plate yet", html: PLACEHOLDER });
  const ring = el("div", { class: "ring" }, art);
  ring.style.setProperty("--p", String(Math.max(0.6, share * 100))); // custom properties need setProperty
  return el("li", { class: "tile" },
    ring,
    el("b", {}, sp.name, sp.checked ? el("i", { class: "tick", title: "Checked by ear" }, " ✓") : null),
    el("span", {}, `${pctText} of ${sp.frog ? "frog " : ""}calls`));
}

function grid(list) {
  const total = list.reduce((n, s) => n + s.calls, 0);
  const ul = el("ul", { class: "tiles" }, list.slice(0, SHOW_FIRST).map((s) => tile(s, total)));
  if (list.length <= SHOW_FIRST) return [ul];
  const rest = list.slice(SHOW_FIRST);
  const btn = el("button", { class: "btn", type: "button", onclick: () => {
    ul.append(...rest.map((s) => tile(s, total)));
    btn.remove();
  } }, `Show all ${plural(list.length, "species", "species")}`);
  return [ul, btn];
}

export function renderSpecies(site) {
  if (!site.species.length) return null;
  const birdsWithPlates = site.birds.filter((s) => s.image).length;
  return el("section", { class: "site-species" },
    site.birds.length ? [el("h2", {}, "Most often heard here"), grid(site.birds)] : null,
    site.frogs.length ? [el("h3", { class: "row-label" }, "Frogs heard here"), grid(site.frogs)] : null,
    el("p", { class: "credit" },
      "Rings show each species' share of the calls detected here. ",
      "Bird plates: hand-cut 1800s plates by Gould and others, from ",
      el("a", { href: "https://github.com/arnegiacomo/fugleramme" }, "Fugleramme"), " (CC BY-SA 4.0, ", el("a", { href: "art/birds/CREDITS.md" }, "credits"), "). ",
      "Frogs: drawn in the same style from photos (CC BY-SA 4.0, ", el("a", { href: "art/frogs/CREDITS.md" }, "credits"), "). ",
      birdsWithPlates < site.birds.length ? `${plural(site.birds.length - birdsWithPlates, "bird")} still without a plate.` : ""));
}
