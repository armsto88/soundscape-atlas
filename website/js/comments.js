import { account, libraryHref, requestApi } from "./library.js";
import { el } from "./util.js";

export function sessionComments(session) {
  const list = el("ul", { class: "comment-list" });
  const formSlot = el("div");
  const status = el("p", { class: "account-error", role: "status" });
  const empty = el("p", { class: "muted", hidden: true }, "No comments yet.");
  const path = `comments?session_id=${encodeURIComponent(session.id)}`;
  const root = el("details", { class: "session-comments" }, el("summary", {}, "Session comments"), status, formSlot, list, empty);
  let loaded = false;

  function commentRow(comment, user) {
    const remove = user?.name === comment.user ? el("button", { class: "btn save-btn", type: "button", onclick: async () => {
      remove.disabled = true;
      status.textContent = "";
      try {
        await requestApi(`comments/${encodeURIComponent(comment.id)}?scope=session`, { method: "DELETE" });
        row.remove();
        empty.hidden = Boolean(list.children.length);
      } catch (error) {
        status.textContent = error.message;
        remove.disabled = false;
      }
    } }, "Delete comment") : null;
    const row = el("li", {}, el("div", { class: "comment-author" }, el("b", {}, comment.user), remove),
      el("p", {}, comment.text));
    return row;
  }

  function commentForm(user) {
    const input = el("textarea", { name: "comment", rows: "3", maxlength: "2000", required: true });
    const send = el("button", { class: "btn btn-primary", type: "submit" }, "Post comment");
    return el("form", { class: "account-form", onsubmit: async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || send.disabled) return;
      send.disabled = input.disabled = true;
      status.textContent = "";
      try {
        const comment = await requestApi("comments", { method: "POST", body: { session_id: session.id, text } });
        list.prepend(commentRow(comment, user));
        empty.hidden = true;
        input.value = "";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        send.disabled = input.disabled = false;
      }
    } }, el("label", {}, "Public comment", input), send);
  }

  root.addEventListener("toggle", async () => {
    if (!root.open || loaded) return;
    loaded = true;
    status.textContent = "";
    try {
      const [comments, library] = await Promise.all([requestApi(path), account()]);
      const user = library?.user;
      list.replaceChildren(...comments.map((comment) => commentRow(comment, user)));
      empty.hidden = Boolean(comments.length);
      formSlot.replaceChildren(user ? commentForm(user) : el("p", {}, el("a", { href: libraryHref() }, "Sign in to comment")));
    } catch (error) {
      loaded = false;
      status.textContent = error.message;
    }
  });
  return root;
}
