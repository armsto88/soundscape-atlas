/**
 * GET /api/auth/me — the signed-in user, from the session cookie.
 * 200 { name, created_at } or 401.
 */

import { getSessionUser, handle, jsonResponse, notSignedIn } from "../../_lib/auth.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const name = await getSessionUser(request, env);
  if (!name) {
    return notSignedIn();
  }
  const user = await env.DB.prepare("SELECT name, created_at FROM users WHERE name = ?").bind(name).first();
  if (!user) {
    return notSignedIn();
  }
  return jsonResponse({ name: user.name, created_at: user.created_at });
});
