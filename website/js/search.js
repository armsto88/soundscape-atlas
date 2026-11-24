// The species search, on the atlas and on a place page: a field that suggests
// birds and frogs as you type (plate, name, scientific name and a count), the
// card for the species picked, and a strip of the hours of the day it called.
// Arrow keys move through the suggestions, Enter picks, Escape closes.

import { el, svg } from "./util.js";
import { speciesThumb } from "./species.js";

const ICON_FIND = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
const MAX_SUGGESTIONS = 8;

// source(text) -> { items: [{ sp, meta }], empty: "shown when nothing matches" }
export function createSpeciesSearch({ id, label, source, onPick }) {
  const listId = `${id}-list`;
  const input = el("input", {
    id, class: "find-input", type: "search", autocomplete: "off", spellcheck: "false", enterkeyhint: "search",
    placeholder: label, role: "combobox", "aria-expanded": "false", "aria-controls": listId, "aria-autocomplete": "list", "aria-label": label,
  });
  const list = el("ul", { class: "find-list", id: listId, role: "listbox", "aria-label": label, hidden: true });
  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const pick = (i) => {
    const item = items[i];
    if (!item) return;
    input.value = "";
    close();
    input.blur(); // on phones, put the keyboard away
    onPick(item.sp);
  };
  const render = () => {
    if (!input.value.trim()) return close();
    const result = source(input.value);
    items = result.items.slice(0, MAX_SUGGESTIONS);
    active = Math.min(active, items.length - 1);
    list.innerHTML = "";
    items.forEach((item, i) => {
      list.append(el("li", {
        class: "find-option", role: "option", id: `${listId}-${i}`, "aria-selected": String(i === active),
        onmousedown: (event) => event.preventDefault(), // keep the focus in the field
        onclick: () => pick(i),
      }, speciesThumb(item.sp), el("span", { class: "find-name" }, el("b", {}, item.sp.name), item.sp.scientific ? el("i", {}, item.sp.scientific) : null),
      el("span", { class: "find-meta" }, item.meta)));
    });
    if (!items.length) list.append(el("li", { class: "find-empty", role: "presentation" }, result.empty || "No species by that name."));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", `${listId}-${active}`);
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  input.addEventListener("input", () => { active = -1; render(); });
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      render();
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      active = Math.max(0, active - 1);
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!list.hidden && items.length) pick(Math.max(0, active));
    } else if (event.key === "Escape") {
      if (!list.hidden) event.stopPropagation();
      close();
    }
  });

  return { el: el("div", { class: "find" }, el("span", { class: "find-icon", html: ICON_FIND }), input, list), input };
}

// The species picked: plate, names, a clear button, then lines of text and anything else.
export function lensCard(sp, { onClear, children = [] }) {
  return el("section", { class: "lens", "aria-label": `Species picked: ${sp.name}` },
    el("div", { class: "lens-top" },
      speciesThumb(sp, "lens-thumb"),
      el("div", { class: "lens-name" }, el("b", {}, sp.name), sp.scientific ? el("i", {}, sp.scientific) : null),
      el("button", { class: "lens-clear", type: "button", "aria-label": `Clear ${sp.name}`, title: "Clear", onclick: onClear }, "×")),
    children);
}

// 24 bars, midnight to midnight: in which hours of the day a species called.
export function whenStrip(counts, label) {
  const max = Math.max(1, ...counts);
  const plot = svg("svg", { viewBox: "0 0 240 24", preserveAspectRatio: "none", "aria-hidden": "true" });
  counts.forEach((v, i) => {
    if (!v) return;
    const h = Math.max(2, (v / max) * 24);
    plot.append(svg("rect", { x: String(i * 10 + 1.5), y: String(24 - h), width: "7", height: String(h) }));
  });
  return el("div", { class: "when", role: "img", "aria-label": label },
    plot, el("div", { class: "when-axis", "aria-hidden": "true" }, ["00", "06", "12", "18", "24"].map((t) => el("span", {}, t))));
}
