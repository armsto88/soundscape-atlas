// "Heard here": an even grid of plates, each with a ring showing
// the species' share of calls. Birds first, then frogs in their own row.
// With a species search on the page, each plate is also a button that picks
// its species.

import { el, plural, info, isPhone } from "./util.js";

const SHOW_FIRST = 12;
const ICON_ENLARGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/></svg>';
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
function tile(sp, total, opts, enlarge) {
  const share = total ? sp.calls / total : 0;
  const pctText = share >= 0.01 ? `${Math.round(share * 100)}%` : "<1%";
  const art = sp.image
    ? el("img", { src: sp.image, alt: "", loading: "lazy" })
    : el("span", { class: "ph", role: "img", "aria-label": sp.frog ? "No illustration yet" : "No plate yet", html: PLACEHOLDER });
  const ring = el("span", { class: "ring" }, art);
  ring.style.setProperty("--p", String(Math.max(0.6, share * 100))); // custom properties need setProperty
  const body = [
    ring,
    el("b", {}, sp.name, sp.checked ? el("i", { class: "tick", role: "img", "aria-label": "checked by ear" }, " ✓") : null),
    el("span", {}, `${pctText} of ${sp.frog ? "frog " : ""}calls`),
  ];
  const target = opts.onPick && opts.find ? opts.find(sp) : null;
  // Phones: one press on a plate opens it large, with what can be done with the
  // species there; no row of Enlarge buttons.
  if (isPhone()) {
    return el("li", { class: "tile" }, el("button", {
      class: "tile-btn", type: "button", "aria-haspopup": "dialog", "data-name": target ? target.name : sp.name,
      "aria-current": String(Boolean(target) && opts.picked() === target),
      onclick: () => enlarge(sp, target),
    }, body));
  }
  const pick = target ? el("button", {
    class: "tile-btn",
    type: "button",
    "data-name": target.name,
    "aria-current": String(opts.picked() === target),
    onclick: () => opts.onPick(target),
  }, body) : el("div", { class: "tile-info" }, body);
  // with a mouse, a magnifier on the plate that shows on hover or focus; on a
  // touch screen, the word under it (styles.css)
  return el("li", { class: "tile" }, pick, sp.image ? el("button", {
    class: "plate-enlarge btn", type: "button", "aria-haspopup": "dialog",
    "aria-label": `Enlarge illustration of ${sp.name}`, title: "Enlarge", onclick: () => enlarge(sp),
  }, el("span", { class: "plate-enlarge-icon", html: ICON_ENLARGE }), el("span", { class: "plate-enlarge-text" }, "Enlarge")) : null);
}

function grid(list, opts, enlarge) {
  const total = list.reduce((n, s) => n + s.calls, 0);
  const makeTile = (s) => tile(s, total, opts, enlarge);
  const ul = el("ul", { class: "tiles" }, list.slice(0, SHOW_FIRST).map(makeTile));
  if (list.length <= SHOW_FIRST) return [ul];
  const rest = list.slice(SHOW_FIRST);
  const btn = el("button", { class: "btn", type: "button", onclick: () => {
    ul.append(...rest.map(makeTile));
    btn.remove();
  } }, `Show all ${plural(list.length, "species", "species")}`);
  return [ul, btn];
}

export function renderSpecies(site, opts = {}) {
  if (!site.species.length) return null;
  const birdsWithPlates = site.birds.filter((s) => s.image).length;
  const plateTitle = el("h3", { id: "plate-title" });
  const plateSub = el("p", { class: "plate-sub muted" });
  const plate = el("img");
  const plateActions = el("div", { class: "plate-actions" });
  const dialog = el("dialog", { class: "plate-dialog", "aria-labelledby": plateTitle.id },
    plateTitle, plateSub, plate, plateActions,
    el("button", { class: "btn", type: "button", autofocus: true, onclick: () => dialog.close() }, "Close"));
  // target: the species as the place page can follow it (phones show what to do with it)
  const enlarge = (sp, target = null) => {
    plateTitle.textContent = sp.name;
    plateSub.textContent = [sp.scientific, `${plural(sp.calls, "call")} here`].filter(Boolean).join(" · ");
    plateSub.hidden = !target && !isPhone();
    plate.hidden = !sp.image;
    if (sp.image) {
      plate.alt = `Illustration of ${sp.name}`;
      plate.src = sp.image;
    }
    plateActions.replaceChildren(...(target ? [
      el("button", { class: "btn btn-primary", type: "button", onclick: () => {
        dialog.close();
        opts.onPick(target);
      } }, "Follow it in the sessions"),
      el("a", { class: "btn", href: `#/?species=${encodeURIComponent(target.key)}`, onclick: () => dialog.close() }, "Where else it was heard"),
    ] : []));
    dialog.showModal();
  };
  const help = info("the species here",
    el("p", {}, "Every species BirdNET found in the published hours here, most calls first. The ring around each picture shows that species' share of all the calls detected here; ✓ means some of its calls were checked by ear."),
    opts.onPick ? el("p", {}, "Press a picture to jump to a matching session. Each chart marks when the species called.") : null);
  return el("section", { class: "site-species" },
    el("h2", {}, "Heard here", help.button), help.panel,
    site.birds.length ? grid(site.birds, opts, enlarge) : null,
    site.frogs.length ? [el("h3", { class: "row-label" }, "Frogs heard here"), grid(site.frogs, opts, enlarge)] : null,
    dialog,
    el("p", { class: "credit" },
      "Bird plates: hand-cut 1800s plates by Gould and others, from ",
      el("a", { href: "https://github.com/arnegiacomo/fugleramme" }, "Fugleramme"), " or cut for this site in the same way (CC BY-SA 4.0, ", el("a", { href: "art/birds/CREDITS.md" }, "credits"), "). ",
      "Frogs: watercolour illustrations made for this site (", el("a", { href: "art/frogs/CREDITS.md" }, "credits"), "). ",
      birdsWithPlates < site.birds.length ? `${plural(site.birds.length - birdsWithPlates, "bird")} still without a plate.` : ""));
}
