import { el, fmtClock, fmtDay, fmtSpan } from "./util.js";
import { createBotCheck } from "./botcheck.js";
import { themeControl } from "./theme.js";

let accountRequest;
let userRequest;
const fields = { hour: "segment_id", session: "session_id" };

export async function requestApi(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (response.ok && data !== null) return data;
  throw Object.assign(new Error(data?.error || "The account service is unavailable."), { status: response.status });
}

function showAccountStatus(user) {
  const badge = document.getElementById("account-status");
  if (!badge) return;
  badge.textContent = user ? `Signed in as ${user.name}` : "Signed out";
  document.getElementById("account-sign-in").hidden = Boolean(user);
  document.getElementById("account-admin").hidden = !user?.is_admin;
  document.getElementById("account-sign-out").hidden = !user;
}

function resetAccount(user) {
  accountRequest = undefined;
  userRequest = user ? undefined : Promise.resolve(null);
  showAccountStatus(user);
}

export function currentUser() {
  if (!userRequest) {
    const request = requestApi("auth/me").catch((error) => {
      if (error.status === 401) return null;
      if (userRequest === request) userRequest = undefined;
      throw error;
    }).then((user) => {
      if (userRequest === request) showAccountStatus(user);
      return user;
    });
    userRequest = request;
  }
  return userRequest;
}

async function signOut() {
  await requestApi("auth/logout", { method: "POST" });
  resetAccount(null);
}

export function mountAccountMenu(onSignOut) {
  const menu = document.getElementById("account-menu");
  if (!menu) return;
  const summary = menu.querySelector("summary");
  const button = document.getElementById("account-sign-out");
  const error = document.getElementById("account-menu-error");
  menu.querySelector(".account-panel").append(el("div", { class: "account-theme" }, el("span", { class: "muted" }, "Appearance"), themeControl()));
  currentUser().catch(() => {
    document.getElementById("account-status").textContent = "Account status unavailable";
    document.getElementById("account-sign-in").hidden = false;
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) menu.open = false;
  });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      summary.focus();
    }
  });
  window.addEventListener("hashchange", () => { menu.open = false; });
  button.addEventListener("click", async () => {
    button.disabled = true;
    error.textContent = "";
    try {
      await signOut();
      menu.open = false;
      summary.focus();
      onSignOut();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

export function account() {
  if (!accountRequest) {
    const request = currentUser().then(async (user) => {
      if (!user) return null;
      const [hours, sessions] = await Promise.all([requestApi("likes"), requestApi("likes?scope=session")]);
      return { user, hour: new Set(hours.map((h) => h.segment_id)), session: new Set(sessions.map((s) => s.session_id)) };
    }).catch((error) => {
      if (accountRequest === request) {
        if (error.status === 401) resetAccount(null);
        else accountRequest = undefined;
      }
      if (error.status === 401) return null;
      throw error;
    });
    accountRequest = request;
  }
  return accountRequest;
}

export function libraryHref() {
  const from = location.hash;
  return from.startsWith("#/site/") ? `#/library?from=${encodeURIComponent(from)}` : "#/library";
}

export function recordingLink(model, scope, id) {
  const record = scope === "hour" ? model.segmentsById.get(id) : model.sessionsById.get(id);
  if (!record) return null;
  const hour = scope === "hour" ? record : record.segments[0];
  const label = scope === "hour" ? `${fmtDay(hour.start)}, ${fmtClock(hour.start)}` : fmtSpan(record.start, record.end);
  return el("a", { href: `#/site/${encodeURIComponent(hour.site.id)}?at=${encodeURIComponent(hour.segment_id)}` },
    `${hour.site.site_name} · ${label}`);
}

async function setSaved(library, scope, id, save) {
  await requestApi("likes", { method: save ? "POST" : "DELETE", body: { [fields[scope]]: id } });
  if (save) library[scope].add(id);
  else library[scope].delete(id);
}

export function createSaveControl(scope) {
  let id = null;
  let library = null;
  let pending = false;
  const status = el("span", { class: "account-error", role: "status" });
  const label = `Save ${scope}`;
  const text = el("span", {}, label);
  const button = el("button", { class: "btn recording-save", type: "button", "aria-label": label, "aria-pressed": "false", onclick: toggle },
    el("span", { class: "bookmark-icon", "aria-hidden": "true" }), text);
  const root = el("div", { class: "save-control", hidden: true }, button, status);

  function render() {
    const saved = Boolean(library?.[scope].has(id));
    text.textContent = saved ? `Saved ${scope}` : label;
    button.disabled = pending;
    button.setAttribute("aria-pressed", String(saved));
  }

  async function show(nextId) {
    id = nextId;
    root.hidden = !nextId;
    status.textContent = "";
    render();
    if (!nextId) return;
    try {
      library = await account();
      render();
    } catch {
      // The button can retry the account request when pressed.
    }
  }

  async function toggle() {
    const target = id;
    if (!target || pending) return;
    pending = true;
    status.textContent = "";
    render();
    const request = account();
    try {
      library = await request;
      if (!library) {
        location.hash = libraryHref();
        return;
      }
      await setSaved(library, scope, target, !library[scope].has(target));
    } catch (error) {
      if (error.status === 401) {
        if (accountRequest === request) resetAccount(null);
        location.hash = libraryHref();
      } else {
        status.textContent = error.message;
      }
    } finally {
      pending = false;
      render();
    }
  }

  return { el: root, show };
}

export function renderLibrary(main, model, params) {
  const back = params.from?.startsWith("#/site/") ? el("a", { href: params.from }, "← Back to recording") : null;
  const status = el("p", { class: "account-error", role: "status" });
  const content = el("div", {}, el("p", { class: "muted" }, "Loading your library…"));
  // on phones the tab bar has no About or account menu: both live here
  const more = el("section", { class: "library-more" },
    el("h2", {}, "Appearance"),
    themeControl(),
    el("p", { class: "library-about" }, el("a", { href: "#/about" }, "About Soundscape Atlas"), " · recordings, plates, credits"));
  const root = el("article", { class: "page prose library" }, back ? el("p", { class: "back" }, back) : null,
    el("h1", {}, "My library"), status, content, more);
  main.append(root);

  function showForm() {
    const name = el("input", { required: true, name: "username", autocomplete: "username", maxlength: "100" });
    const password = el("input", { required: true, name: "password", type: "password", autocomplete: "current-password", maxlength: "200" });
    const signIn = el("button", { class: "btn btn-primary", type: "submit", value: "signin" }, "Sign in");
    const register = el("button", { class: "btn", type: "submit", value: "register" }, "Create account");
    const check = createBotCheck("account");
    const form = el("form", { class: "account-form", onsubmit: async (event) => {
      event.preventDefault();
      signIn.disabled = register.disabled = true;
      status.textContent = "";
      let signedIn = false;
      try {
        const turnstile = await check.token();
        const user = await requestApi("users", { method: "POST", body: { name: name.value, password: password.value, mode: event.submitter?.value, turnstile } });
        signedIn = true;
        check.remove();
        resetAccount(user);
        await load();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        signIn.disabled = register.disabled = false;
        if (!signedIn) check.reset(); // each check is good for one try
      }
    } }, el("label", {}, "Username", name), el("label", {}, "Password", password),
    el("p", { class: "muted" }, "New accounts need a password of at least eight characters."),
    check.el,
    el("div", { class: "actions" }, signIn, register));
    content.replaceChildren(el("p", {}, "Sign in to save recording hours and sessions and leave comments. Saved recordings are visible to you and site administrators."), form);
  }

  function savedList(library, scope) {
    const heading = scope === "hour" ? "Saved hours" : "Saved sessions";
    const list = el("ul", { class: "library-list" });
    const empty = el("p", { class: "muted", hidden: Boolean(library[scope].size) }, `Your saved ${scope}s will appear here.`);
    for (const id of library[scope]) {
      const link = recordingLink(model, scope, id) || el("span", { class: "muted" }, "Recording unavailable");
      const remove = el("button", { class: "btn save-btn", type: "button", "aria-label": `Remove ${link.textContent}`, onclick: async () => {
        remove.disabled = true;
        status.textContent = "";
        try {
          await setSaved(library, scope, id, false);
          row.remove();
          empty.hidden = Boolean(list.children.length);
        } catch (error) {
          status.textContent = error.message;
          remove.disabled = false;
        }
      } }, "Remove");
      const row = el("li", {}, link, remove);
      list.append(row);
    }
    return el("section", {}, el("h2", {}, heading), list, empty);
  }

  async function load() {
    try {
      const library = await account();
      if (!library) return showForm();
      const logout = el("button", { class: "btn", type: "button", onclick: async () => {
        logout.disabled = true;
        status.textContent = "";
        try {
          await signOut();
          showForm();
        } catch (error) {
          status.textContent = error.message;
          logout.disabled = false;
        }
      } }, "Sign out");
      const adminLink = library.user.is_admin ? el("a", { class: "btn", href: "#/admin" }, "Administration") : null;
      content.replaceChildren(el("div", { class: "library-account" }, el("b", {}, library.user.name), adminLink, logout),
        savedList(library, "session"), savedList(library, "hour"));
    } catch (error) {
      status.textContent = error.message;
      content.replaceChildren(el("button", { class: "btn", type: "button", onclick: () => { status.textContent = ""; load(); } }, "Try again"));
    }
  }
  load();
}
