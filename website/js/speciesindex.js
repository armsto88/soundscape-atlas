// The Species page (#/species, a tab on phones): every bird and frog heard so
// far, most calls first, with a field that narrows the list as you type. A
// species opens on the atlas with the places it was heard at, the same view as
// picking it in the atlas search; species on a sensitive list show only areas
// there, and here their count is in sessions, as in the search.
//
// Phones: a list, a small plate on each row. Wide screens: a grid of plates,
// with All · Birds · Frogs beside the field.

import { el, plural, isPhone } from "./util.js";
import { speciesPlaces, findSpecies } from "./data.js";
import { speciesThumb } from "./species.js";

const ICON_FIND = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';

export function renderSpeciesIndex(main, model) {
  const entries = model.species
    .map((sp) => {
      const places = speciesPlaces(sp);
      return { sp, places, calls: places.reduce((n, p) => n + p.calls, 0), sessions: places.reduce((n, p) => n + p.sessions.length, 0) };
    })
    .filter((e) => e.places.length)
    .sort((a, b) => b.calls - a.calls || a.sp.name.localeCompare(b.sp.name));
  const bySp = new Map(entries.map((e) => [e.sp, e]));

  const row = (e) => el("li", {}, el("a", { class: "sp-row", href: `#/?species=${encodeURIComponent(e.sp.key)}` },
    speciesThumb(e.sp),
    el("span", { class: "sp-name" }, el("b", {}, e.sp.name), e.sp.scientific ? el("i", {}, e.sp.scientific) : null),
    el("small", { class: "sp-meta" }, e.places.every((p) => p.areaOnly)
      ? plural(e.sessions, "session")
      : `${plural(e.places.length, "place")} · ${plural(e.calls, "call")}`)));

  const wide = !isPhone();
  const meta = (e) => (e.places.every((p) => p.areaOnly) ? plural(e.sessions, "session") : `${plural(e.places.length, "place")} · ${plural(e.calls, "call")}`);
  const card = (e) => el("li", {}, el("a", { class: "sp-card", href: `#/?species=${encodeURIComponent(e.sp.key)}` },
    speciesThumb(e.sp, "sp-plate"),
    el("b", {}, e.sp.name),
    e.sp.scientific ? el("i", {}, e.sp.scientific) : null,
    el("small", {}, meta(e))));
  const listOf = (list) => (wide ? el("ul", { class: "sp-grid" }, list.map(card)) : el("ul", { class: "sp-rows" }, list.map(row)));

  const birds = entries.filter((e) => !e.sp.frog);
  const frogs = entries.filter((e) => e.sp.frog);
  let group = "all"; // wide screens: all, birds or frogs
  const shows = (e) => group === "all" || (group === "frogs") === Boolean(e.sp.frog);
  const list = el("div", { class: "sp-list" });
  const showAll = () => list.replaceChildren(
    birds.length && group !== "frogs" ? el("section", {}, el("h2", { class: "row-label" }, "Birds"), listOf(birds)) : null,
    frogs.length && group !== "birds" ? el("section", {}, el("h2", { class: "row-label" }, "Frogs"), listOf(frogs)) : null);

  const input = el("input", {
    class: "find-input", id: "species-find", type: "search", placeholder: "Find a bird or frog",
    "aria-label": "Find a bird or frog", autocomplete: "off", spellcheck: "false", enterkeyhint: "search",
    oninput: () => {
      const text = input.value.trim();
      if (!text) return showAll();
      const found = findSpecies(entries.filter(shows).map((e) => e.sp), text).sort((a, b) => a.score - b.score || bySp.get(b.sp).calls - bySp.get(a.sp).calls);
      list.replaceChildren(found.length
        ? listOf(found.map((f) => bySp.get(f.sp)))
        : el("p", { class: "muted" }, "Not heard in the recordings published so far."));
    },
  });
  const filter = wide && birds.length > 0 && frogs.length > 0 ? el("div", { class: "seg-group sp-filter", role: "group", "aria-label": "Show" },
    [["all", "All"], ["birds", "Birds"], ["frogs", "Frogs"]].map(([key, label]) => el("button", {
      class: `seg-btn${key === group ? " active" : ""}`, type: "button", "aria-pressed": String(key === group), "data-group": key,
      onclick: () => {
        group = key;
        for (const b of filter.children) {
          b.classList.toggle("active", b.dataset.group === key);
          b.setAttribute("aria-pressed", String(b.dataset.group === key));
        }
        input.dispatchEvent(new Event("input")); // the list again, with the field's text
      },
    }, label))) : null;
  showAll();
  main.append(el("article", { class: `page species-index${wide ? " wide" : ""}` },
    el("h1", {}, "Species"),
    el("p", { class: "muted" }, `${plural(birds.length, "bird")} and ${plural(frogs.length, "frog")} heard so far. Pick one to see where.`),
    el("div", { class: "sp-tools" }, el("div", { class: "find species-find" }, el("span", { class: "find-icon", html: ICON_FIND }), input), filter),
    list));
}
