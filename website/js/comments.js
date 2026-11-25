import { currentUser, libraryHref, requestApi } from "./library.js";
import { clamp, el } from "./util.js";

const postedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const recordingClock = (seg, sec) => new Date(seg.start + sec * 1000).toISOString().slice(11, 19);

export function sessionComments(session, { onPlay, onMarks }) {
  const list = el("ul", { class: "comment-list" });
  const formSlot = el("div");
  const status = el("p", { class: "account-error", role: "status" });
  const empty = el("p", { class: "muted", hidden: true }, "No comments yet.");
  const path = `comments?session_id=${encodeURIComponent(session.id)}`;
  const root = el("details", { class: "session-comments" }, el("summary", {}, "Session comments"), status, formSlot, list, empty);
  const segments = new Map(session.segments.map((seg) => [seg.segment_id, seg]));
  const marks = new Map();
  let loading;
  let anchor = null;
  const range = el("input", { type: "range", min: "0", step: "1", oninput: updateTime });
  const clock = el("b", { class: "comment-clock" });
  const timing = el("div", { class: "comment-timing", hidden: true },
    el("label", {}, el("span", {}, "Recording time ", clock), range),
    el("button", { class: "btn save-btn", type: "button", onclick: () => setTime(null) }, "Remove time"));

  function updateTime() {
    const time = recordingClock(anchor, Number(range.value));
    clock.textContent = time;
    range.setAttribute("aria-valuetext", time);
  }

  function setTime(seg, sec = 0) {
    anchor = seg;
    timing.hidden = !seg;
    if (!seg) return;
    const lastSecond = Math.max(0, Math.ceil(seg.durationSec) - 1);
    range.max = String(lastSecond);
    range.value = String(clamp(Math.floor(sec), 0, lastSecond));
    updateTime();
  }

  function reveal(target) {
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  }

  function commentRow(comment, user) {
    const remove = user?.name === comment.user ? el("button", { class: "btn save-btn", type: "button", onclick: async () => {
      remove.disabled = true;
      status.textContent = "";
      try {
        await requestApi(`comments/${encodeURIComponent(comment.id)}?scope=session`, { method: "DELETE" });
        row.remove();
        marks.delete(comment.id);
        onMarks([...marks.values()]);
        empty.hidden = Boolean(list.children.length);
      } catch (error) {
        status.textContent = error.message;
        remove.disabled = false;
      }
    } }, "Delete comment") : null;
    const seg = segments.get(comment.segment_id);
    const timed = seg && Number.isFinite(comment.sec) && comment.sec >= 0 && comment.sec < seg.durationSec;
    const time = timed ? recordingClock(seg, comment.sec) : null;
    const listen = time && (seg.public_url ? el("button", { class: "btn save-btn comment-time", type: "button",
      "aria-label": `Play from ${time}`, onclick: () => onPlay(seg, comment.sec) }, `▶ ${time}`) : el("span", {}, time));
    const posted = new Date(comment.created_at);
    const date = Number.isNaN(posted.getTime()) ? null : el("time", { datetime: comment.created_at, class: "comment-date" }, postedDate.format(posted));
    const row = el("li", { tabindex: "-1" }, el("div", { class: "comment-author" }, el("b", {}, comment.user), date, listen, remove),
      el("p", {}, comment.text));
    if (timed) marks.set(comment.id, {
      moment: seg.start + comment.sec * 1000,
      label: `Comment by ${comment.user} at ${time}`,
      preview: el("div", { class: "comment-preview" },
        el("div", { class: "comment-preview-meta" }, el("b", {}, comment.user), el("span", {}, time)),
        el("p", {}, comment.text)),
      open() {
        root.open = true;
        reveal(row);
      },
    });
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
        const time = anchor ? { segment_id: anchor.segment_id, sec: Number(range.value) } : {};
        const comment = await requestApi("comments", { method: "POST", body: { session_id: session.id, text, ...time } });
        list.prepend(commentRow(comment, user));
        onMarks([...marks.values()]);
        empty.hidden = true;
        input.value = "";
        setTime(null);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        send.disabled = input.disabled = false;
      }
    } }, timing, el("label", {}, "Public comment", input), send);
  }

  function load() {
    if (loading) return loading;
    status.textContent = "";
    loading = Promise.all([requestApi(path), currentUser()]).then(([comments, user]) => {
      list.replaceChildren(...comments.map((comment) => commentRow(comment, user)));
      onMarks([...marks.values()]);
      empty.hidden = Boolean(comments.length);
      formSlot.replaceChildren(user ? commentForm(user) : el("p", {}, el("a", { href: libraryHref() }, "Sign in to comment")));
    }).catch((error) => {
      loading = undefined;
      status.textContent = error.message;
    });
    return loading;
  }

  root.addEventListener("toggle", () => {
    if (root.open) load();
  });
  load();
  return {
    el: root,
    async at(seg, sec) {
      setTime(seg, sec);
      root.open = true;
      await load();
      reveal(formSlot.querySelector("textarea, a"));
    },
  };
}
