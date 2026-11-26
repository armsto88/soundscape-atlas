// Light, dark ("night paper") or the phone's own setting (Auto). The choice is
// kept in this browser only; a line in index.html applies it before the page
// draws, so a dark choice never flashes light.

import { el } from "./util.js";

const KEY = "theme";
const CHOICES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];

export function currentTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function setTheme(choice) {
  try {
    if (choice === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // private window: the choice lasts until the page closes
  }
  if (choice === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  window.dispatchEvent(new CustomEvent("themechange"));
}

// fn() when the colours in use change: a choice here, or the phone going dark at night
export function onThemeChange(fn) {
  window.addEventListener("themechange", fn);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme() === "auto") fn();
  });
}

// Auto · Light · Dark, as one segmented control
export function themeControl() {
  const group = el("div", { class: "seg-group theme-choice", role: "group", "aria-label": "Appearance" });
  const paint = () => {
    for (const b of group.children) {
      const on = b.dataset.choice === currentTheme();
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };
  for (const [choice, label] of CHOICES) {
    group.append(el("button", { class: "seg-btn", type: "button", "data-choice": choice, onclick: () => setTheme(choice) }, label));
  }
  window.addEventListener("themechange", paint);
  paint();
  return group;
}
