import { el, fmtClock, fmtDay, fmtSpan } from "./util.js";

let accountRequest;
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

export function account() {
  accountRequest ??= requestApi("auth/me").then(async (user) => {
    const [hours, sessions] = await Promise.all([requestApi("likes"), requestApi("likes?scope=session")]);
    return { user, hour: new Set(hours.map((h) => h.segment_id)), session: new Set(sessions.map((s) => s.session_id)) };
  }).catch((error) => {
    if (error.status === 401) return null;
    accountRequest = undefined;
    throw error;
  });
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
  const button = el("button", { class: "btn save-btn", type: "button", "aria-label": label, "aria-pressed": "false", onclick: toggle }, label);
  const root = el("div", { class: "save-control", hidden: true }, button, status);

  function render() {
    const saved = Boolean(library?.[scope].has(id));
    button.textContent = saved ? `✓ Saved ${scope}` : label;
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
    try {
      library = await account();
      if (!library) {
        location.hash = libraryHref();
        return;
      }
      await setSaved(library, scope, target, !library[scope].has(target));
    } catch (error) {
      if (error.status === 401) {
        accountRequest = undefined;
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
  const root = el("article", { class: "page prose library" }, back ? el("p", { class: "back" }, back) : null,
    el("h1", {}, "My library"), status, content);
  main.append(root);

  function showForm() {
    const name = el("input", { required: true, name: "username", autocomplete: "username", maxlength: "100" });
    const password = el("input", { required: true, name: "password", type: "password", autocomplete: "current-password", maxlength: "200" });
    const signIn = el("button", { class: "btn btn-primary", type: "submit", value: "signin" }, "Sign in");
    const register = el("button", { class: "btn", type: "submit", value: "register" }, "Create account");
    const form = el("form", { class: "account-form", onsubmit: async (event) => {
      event.preventDefault();
      signIn.disabled = register.disabled = true;
      status.textContent = "";
      try {
        await requestApi("users", { method: "POST", body: { name: name.value, password: password.value, mode: event.submitter?.value } });
        accountRequest = undefined;
        await load();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        signIn.disabled = register.disabled = false;
      }
    } }, el("label", {}, "Username", name), el("label", {}, "Password", password),
    el("p", { class: "muted" }, "New accounts need a password of at least eight characters."),
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
      const signOut = el("button", { class: "btn", type: "button", onclick: async () => {
        signOut.disabled = true;
        status.textContent = "";
        try {
          await requestApi("auth/logout", { method: "POST" });
          accountRequest = undefined;
          showForm();
        } catch (error) {
          status.textContent = error.message;
          signOut.disabled = false;
        }
      } }, "Sign out");
      const adminLink = library.user.is_admin ? el("a", { class: "btn", href: "#/admin" }, "Administration") : null;
      content.replaceChildren(el("div", { class: "library-account" }, el("b", {}, library.user.name), adminLink, signOut),
        savedList(library, "session"), savedList(library, "hour"));
    } catch (error) {
      status.textContent = error.message;
      content.replaceChildren(el("button", { class: "btn", type: "button", onclick: () => { status.textContent = ""; load(); } }, "Try again"));
    }
  }
  load();
}
