/**
 * GET /api/profile/:name
 *
 * Public: { name, created_at, comment_count }.
 * The user's likes are included only when they are the one asking.
 */

import { getSessionUser, handle, jsonResponse } from "../../_lib/auth.js";

export const onRequestGet = handle(async ({ request, env, params }) => {
  const name = String(params.name ?? "").trim();
  if (!name) {
    return jsonResponse({ error: "name is required" }, 400);
  }

  const user = await env.DB.prepare("SELECT name, created_at FROM users WHERE name = ?").bind(name).first();
  if (!user) {
    return jsonResponse({ error: "User not found" }, 404);
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM comments WHERE user = ?").bind(name).first();
  const profile = { name: user.name, created_at: user.created_at, comment_count: count?.count ?? 0 };

  if ((await getSessionUser(request, env)) === user.name) {
    const { results } = await env.DB.prepare(
      "SELECT segment_id, created_at FROM likes WHERE user_name = ? ORDER BY created_at DESC"
    ).bind(name).all();
    profile.likes = results;
  }

  return jsonResponse(profile);
});
