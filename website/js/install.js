// Getting Soundscape Atlas onto the Home Screen, where it opens full screen
// like an app (manifest.webmanifest). No browser on iPhone lets a page do this
// itself (Safari has neither beforeinstallprompt nor navigator.install), so:
//
//   Android (Chrome, Edge, Samsung Internet): our own Install button opens the
//     browser's install prompt (beforeinstallprompt), when the browser offers it;
//   iPhone and iPad: the steps through the Share menu;
//   in-app browsers (Instagram, Facebook, TikTok...): they cannot add to the Home
//     Screen at all, so the steps to open the page in the real browser first.
//
// Phones get a small card once, at a good moment: after a minute of listening,
// or a little while into a later visit; never on the first screen, never in the
// Home Screen app itself. "Not now" keeps it away for 30 days. Library always
// has the way in (installSection).

import { el, isPhone } from "./util.js";

const KEY = "install-hint"; // localStorage: time the card was last dismissed, or "added"
const VISITS = "visits";
const QUIET_DAYS = 30;
const LISTEN_MS = 60_000;     // a minute of listening...
const LATER_VISIT_MS = 20_000; // ...or this long into a second visit

const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5H6.5v10h11v-10h-2"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r="0.9" class="dot"/><circle cx="12" cy="12" r="0.9" class="dot"/><circle cx="16" cy="12" r="0.9" class="dot"/></svg>';
const ICON_ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';

let deferred = null; // the browser's install prompt, kept until our button asks for it
const listeners = new Set();
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // our own button asks, at the listener's moment
  deferred = event;
  listeners.forEach((fn) => fn());
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  store(KEY, "added");
  listeners.forEach((fn) => fn());
});

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private window: the card may come back next time
  }
}

// already opened from the Home Screen
export const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// which instructions apply here
export function platform() {
  const ua = navigator.userAgent;
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Pinterest|Line\//i.exec(ua);
  if (inApp) {
    const name = /Instagram/i.test(inApp[0]) ? "Instagram" : /FB/i.test(inApp[0]) ? "Facebook" : /TikTok|musical|Bytedance/i.test(inApp[0]) ? "TikTok"
      : /Snapchat/i.test(inApp[0]) ? "Snapchat" : /LinkedIn/i.test(inApp[0]) ? "LinkedIn" : /Pinterest/i.test(inApp[0]) ? "Pinterest" : "this app";
    return { kind: "inapp", app: name, ios: /iPhone|iPad|iPod/.test(ua) };
  }
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return { kind: "ios" };
  if (/Android/i.test(ua)) return { kind: "android" };
  return { kind: "desktop", safari: /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua) };
}

// "accepted", "dismissed", or "failed" when the browser would not show it
// (it must come straight from a tap, and each prompt can be shown only once)
async function promptInstall() {
  const event = deferred;
  try {
    await event.prompt();
  } catch {
    return "failed";
  }
  deferred = null;
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") store(KEY, "added");
  listeners.forEach((fn) => fn());
  return outcome;
}

// ---- the steps, for this phone ------------------------------------------------

const step = (icon, ...text) => el("li", {}, icon ? el("span", { class: "install-icon", html: icon }) : null, el("span", {}, ...text));

function steps() {
  const p = platform();
  if (p.kind === "inapp") {
    const copy = el("button", { class: "btn", type: "button", onclick: async () => {
      try {
        await navigator.clipboard.writeText(`${location.origin}/`);
        copy.textContent = "Link copied";
      } catch {
        copy.textContent = `${location.host}`;
      }
    } }, "Copy link");
    return [
      el("p", {}, `${p.app}'s own browser can't add pages to the Home Screen. Open this page in ${p.ios ? "Safari" : "your browser"} first:`),
      el("ol", { class: "install-steps" },
        step(ICON_MORE, `Tap `, el("b", {}, "⋯"), ` at the top or bottom of ${p.app}'s browser.`),
        step(null, "Choose ", el("b", {}, p.ios ? "Open in external browser" : "Open in browser"), ", or copy the link and paste it into ", p.ios ? "Safari" : "your browser", "."),
        step(ICON_ADD, "Then come back here to add it to your Home Screen.")),
      el("div", { class: "install-actions" }, copy),
    ];
  }
  if (p.kind === "ios") {
    return [
      el("ol", { class: "install-steps" },
        step(ICON_SHARE, "Tap the ", el("b", {}, "Share"), " button in Safari's bar. If you only see ", el("b", {}, "⋯"), ", tap that first, then Share."),
        step(ICON_ADD, "Scroll down and tap ", el("b", {}, "Add to Home Screen"), ". (Not in the list? Tap ", el("b", {}, "View More"), ".)"),
        step(null, "Tap ", el("b", {}, "Add"), ". It opens full screen, like an app, and keeps playing with the screen locked.")),
    ];
  }
  if (p.kind === "android") {
    return [
      el("ol", { class: "install-steps" },
        step(null, "Open the browser's menu: ", el("b", {}, "⋮"), " at the top right."),
        step(ICON_ADD, "Tap ", el("b", {}, "Add to Home screen"), " or ", el("b", {}, "Install app"), "."),
        step(null, "Tap ", el("b", {}, "Install"), ". It opens full screen, like an app.")),
    ];
  }
  return [el("p", {}, p.safari
    ? "In Safari on a Mac: File › Add to Dock."
    : "In Chrome or Edge: the install button at the right of the address bar, or the browser's menu › Install.")];
}

let dialog = null;
// The steps in a sheet; where the browser offers its own prompt, one button.
export async function showInstall() {
  if (deferred && platform().kind !== "inapp" && (await promptInstall()) !== "failed") return;
  if (!dialog) {
    dialog = el("dialog", { class: "install-dialog", "aria-labelledby": "install-title" });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close(); // a tap outside the sheet
    });
    document.body.append(dialog);
  }
  dialog.replaceChildren(
    el("img", { class: "install-app-icon", src: "assets/icon-192.png", alt: "", width: "56", height: "56" }),
    el("h2", { id: "install-title" }, "Add to your Home Screen"),
    el("p", { class: "muted" }, "Soundscape Atlas then opens from its own icon, full screen, without the browser around it."),
    ...steps(),
    el("button", { class: "btn btn-primary install-done", type: "button", onclick: () => dialog.close() }, "Done"));
  dialog.showModal();
}

// ---- Library: the way in that is always there (phones and tablets) ---------------

export function installSection() {
  if (platform().kind === "desktop") return null; // no Home Screen on a computer
  const body = el("div", {});
  const section = el("section", { class: "install-section" }, el("h2", {}, "On your Home Screen"), body);
  const paint = () => {
    if (isInstalled()) {
      body.replaceChildren(el("p", { class: "muted" }, "You're using Soundscape Atlas from your Home Screen."));
      return;
    }
    body.replaceChildren(
      el("p", { class: "muted" }, "Keep it as an app: it opens full screen from its own icon."),
      el("button", { class: "btn", type: "button", onclick: showInstall }, deferred && platform().kind !== "inapp" ? "Install the app" : "Add to Home Screen"));
  };
  listeners.add(paint);
  paint();
  return section;
}

// ---- the card, once, at a good moment -------------------------------------------

export function offerInstall(player) {
  if (isInstalled() || platform().kind === "desktop") return;
  const visits = (Number(read(VISITS)) || 0) + 1;
  store(VISITS, String(visits));
  const last = read(KEY);
  if (last === "added" || (last && Date.now() - Number(last) < QUIET_DAYS * 86_400_000)) return;

  let shown = false;
  let card = null;
  const show = () => {
    if (shown || !isPhone() || document.querySelector("dialog[open]")) return;
    shown = true;
    card = el("aside", { class: "install-card", "aria-label": "Add to Home Screen" },
      el("img", { src: "assets/icon-192.png", alt: "", width: "40", height: "40" }),
      el("p", {}, el("b", {}, "Keep it on your Home Screen"), el("span", {}, "Opens full screen, like an app.")),
      el("button", { class: "btn btn-primary", type: "button", onclick: () => {
        dismiss();
        showInstall();
      } }, deferred && platform().kind !== "inapp" ? "Install" : "Show me how"),
      el("button", { class: "install-close", type: "button", "aria-label": "Not now", onclick: dismiss }, "×"));
    document.body.append(card);
  };
  const dismiss = () => {
    store(KEY, String(Date.now()));
    card?.remove();
  };

  // a minute of listening
  let listened = 0;
  let since = 0;
  player.addEventListener("state", () => {
    const now = performance.now();
    if (player.isPlaying) {
      if (since) listened += now - since;
      since = now;
      if (listened >= LISTEN_MS) show();
    } else since = 0;
  });
  // or a while into a later visit
  if (visits >= 2) setTimeout(show, LATER_VISIT_MS);
}
