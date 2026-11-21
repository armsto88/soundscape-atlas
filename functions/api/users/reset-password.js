/**
 * POST /api/users/reset-password — admin-only manual password reset.
 *
 * Header: x-admin-key: <ADMIN_RESET_KEY>
 * Body:   { "name": "alice", "new_password": "new-secret" }
 *
 * Signs the user out everywhere.
 */

import {
  endAllSessionsFor,
  generateSalt,
  handle,
  hashPassword,
  jsonResponse,
  readJson,
  safeEqual,
} from "../../_lib/auth.js";

export const onRequestPost = handle(async ({ request, env }) => {
  const expectedKey = typeof env.ADMIN_RESET_KEY === "string" ? env.ADMIN_RESET_KEY : "";
  if (!expectedKey) {
    return jsonResponse({ error: "ADMIN_RESET_KEY is not configured" }, 503);
  }
  const providedKey = request.headers.get("x-admin-key") || "";
  if (!providedKey || !safeEqual(providedKey, expectedKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  if (!name || name.length > 100) {
    return jsonResponse({ error: "name is required" }, 400);
  }
  if (newPassword.length < 8 || newPassword.length > 200) {
    return jsonResponse({ error: "new_password must be 8 to 200 characters" }, 400);
  }

  const existing = await env.DB.prepare("SELECT name FROM users WHERE name = ?").bind(name).first();
  if (!existing) {
    return jsonResponse({ error: "User not found" }, 404);
  }

  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE name = ?")
    .bind(hash, salt, name)
    .run();
  await endAllSessionsFor(env, name);

  return jsonResponse({ reset: true, name });
});
