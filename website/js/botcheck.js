// The check that someone using the account or comment form is a person, not a
// bot: Cloudflare Turnstile (see functions/_lib/turnstile.js). It is on only
// when the site's settings switch it on (GET /api/auth/check gives the key),
// and Cloudflare's script is loaded only once such a form is on screen, so the
// rest of the site never contacts challenges.cloudflare.com.
//
//   const check = createBotCheck("account");   // the action the server expects
//   form.append(check.el);
//   body.turnstile = await check.token();      // undefined when the check is off
//   check.reset();                             // after every attempt: tokens are single-use

import { el } from "./util.js";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=soundscapeBotCheckLoaded";
const WAIT_MS = 20000;

let keyRequest;
let scriptRequest;

function siteKey() {
  if (!keyRequest) {
    keyRequest = fetch("/api/auth/check", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { site_key: null }))
      .then((c) => c.site_key || null)
      .catch(() => {
        keyRequest = undefined; // ask again next time
        return null;
      });
  }
  return keyRequest;
}

function loadScript() {
  if (!scriptRequest) {
    scriptRequest = new Promise((resolve, reject) => {
      window.soundscapeBotCheckLoaded = () => resolve(window.turnstile);
      const script = el("script", { src: SCRIPT, async: true });
      script.addEventListener("error", () => {
        scriptRequest = undefined;
        script.remove();
        reject(new Error("The check that you're not a robot could not be loaded. Try again."));
      });
      document.head.append(script);
    });
  }
  return scriptRequest;
}

export function createBotCheck(action) {
  const box = el("div", { class: "bot-check-widget" });
  const note = el("p", { class: "muted bot-check-note", hidden: true },
    "Cloudflare Turnstile checks this form for bots.");
  const root = el("div", { class: "bot-check" }, box, note);
  let turnstile = null;
  let widget = null;
  let current = "";
  let waiting = [];
  let failure = null;

  const settle = () => {
    for (const w of waiting) w();
    waiting = [];
  };

  const ready = siteKey().then(async (key) => {
    if (!key) return false;
    note.hidden = false;
    try {
      turnstile = await loadScript();
    } catch (error) {
      failure = error;
      return true;
    }
    widget = turnstile.render(box, {
      sitekey: key,
      action,
      theme: "light",
      size: "flexible",
      appearance: "interaction-only", // shown only if Cloudflare needs a click
      "refresh-expired": "auto",
      callback: (token) => {
        current = token;
        failure = null;
        settle();
      },
      "expired-callback": () => {
        current = "";
      },
      "error-callback": () => {
        current = "";
        failure = new Error("The check that you're not a robot did not work. Reload the page and try again.");
        settle();
        return true; // handled here
      },
    });
    return true;
  });

  return {
    el: root,
    // the token to send, waiting for the widget if it is still working; undefined when the check is off
    async token() {
      if (!(await ready)) return undefined;
      if (failure) throw failure;
      if (!current) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, WAIT_MS);
          waiting.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      if (failure) throw failure;
      if (!current) throw new Error("Please complete the check that you're not a robot, then try again.");
      return current;
    },
    reset() {
      current = "";
      if (turnstile && widget !== null) turnstile.reset(widget);
    },
    remove() {
      if (turnstile && widget !== null) turnstile.remove(widget);
      widget = null;
    },
  };
}
