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

  const existing = await env.DB.prepare("SELECT user FROM comments WHERE id = ?").bind(id).first();
  if (!existing) {
    return jsonResponse({ error: "Not found" }, 404);
  }
  if (existing.user !== user) {
    return jsonResponse({ error: "You can only delete your own comments" }, 403);
  }

  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return jsonResponse({ deleted: true });
});
