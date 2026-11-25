import { recordingLink, requestApi } from "./library.js";
import { el, fmtTime } from "./util.js";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function dateLabel(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : dateFormat.format(date);
}

export function renderAdmin(main, model) {
  const status = el("p", { role: "status" }, "Loading accounts…");
  const picker = el("select", { "aria-labelledby": "admin-account-label" });
  const label = el("label", {}, el("span", { id: "admin-account-label" }, "Account"), picker);
  const controls = el("div", { class: "account-form", hidden: true }, label);
  const details = el("div");
  main.append(el("article", { class: "page prose" },
    el("p", { class: "back" }, el("a", { href: "#/library" }, "← My library")),
    el("h1", {}, "Administration"), controls, status, details));

  function section(title, rows, scope, comments = false) {
    const field = scope === "hour" ? "segment_id" : "session_id";
    return el("section", {}, el("h3", {}, title), rows.length ? el("ul", { class: "comment-list" }, rows.map((row) => {
      const link = recordLink(row, scope, field);
      return el("li", {}, link,
        comments && row.segment_id && Number.isFinite(row.sec) ? ` · ${fmtTime(row.sec)} into the hour` : null,
        el("div", { class: "muted" }, el("time", { datetime: row.created_at }, dateLabel(row.created_at))),
        comments ? el("p", {}, row.text) : null);
    })) : el("p", { class: "muted" }, "None yet."));
  }

  function recordLink(row, scope, field) {
    if (scope === "session" && row.segment_id) {
      const hour = recordingLink(model, "hour", row.segment_id);
      if (hour) return hour;
    }
    return recordingLink(model, scope, row[field]) || el("span", {}, row[field]);
  }

  let selection = 0;
  async function loadAccount() {
    const request = ++selection;
    status.textContent = "Loading account…";
    details.replaceChildren();
    try {
      const data = await requestApi(`admin/accounts?name=${encodeURIComponent(picker.value)}`);
      if (request !== selection) return;
      status.textContent = "";
      details.replaceChildren(el("h2", {}, data.user.name),
        el("p", { class: "muted" }, `Joined ${dateLabel(data.user.created_at)}${data.user.is_admin ? " · Administrator" : ""}`),
        section("Saved sessions", data.sessions, "session"),
        section("Saved hours", data.hours, "hour"),
        section("Session comments", data.session_comments, "session", true),
        section("Hour comments", data.hour_comments, "hour", true));
    } catch (error) {
      if (request === selection) status.textContent = error.message;
    }
  }

  picker.addEventListener("change", loadAccount);
  requestApi("admin/accounts").then((accounts) => {
    if (!accounts.length) {
      status.textContent = "No accounts yet.";
      return;
    }
    picker.append(...accounts.map(({ name }) => el("option", { value: name }, name)));
    controls.hidden = false;
    loadAccount();
  }).catch((error) => {
    status.textContent = error.message;
  });
}
