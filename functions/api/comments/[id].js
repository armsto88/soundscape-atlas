/**
 * DELETE /api/comments/:id — delete one of the signed-in user's comments.
 */

import { getSessionUser, handle, jsonResponse, notSignedIn } from "../../_lib/auth.js";

export const onRequestDelete = handle(async ({ request, env, params }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }

  const id = String(params.id ?? "").trim();
  if (!id) {
    return jsonResponse({ error: "Comment id is required" }, 400);
  }

  const table = new URL(request.url).searchParams.get("scope") === "session" ? "session_comments" : "comments";
  const existing = await env.DB.prepare(`SELECT user FROM ${table} WHERE id = ?`).bind(id).first();
  if (!existing) {
    return jsonResponse({ error: "Not found" }, 404);
  }
  if (existing.user !== user) {
    return jsonResponse({ error: "You can only delete your own comments" }, 403);
  }

  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND user = ?`).bind(id, user).run();
  return jsonResponse({ deleted: true });
});
