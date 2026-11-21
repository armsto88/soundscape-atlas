/**
 * POST /api/users — sign in or create an account; starts a session cookie.
 *
 * Body: { "name": "Alice", "password": "secret", "mode": "signin" | "register" }
 *
 * signin:   200 on success, 401 wrong password, 404 no such user,
 *           409 account has no password yet (admin reset needed)
 * register: 201 on success, 409 name taken (case-insensitive)
 *
 * Passwords are hashed with PBKDF2-SHA-256 via the Web Crypto API.
 */

import {
  createSession,
  generateSalt,
  handle,
  hashPassword,
  jsonResponse,
  readJson,
  safeEqual,
} from "../_lib/auth.js";

const NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,40}$/;
const MIN_NEW_PASSWORD = 8;
const MAX_PASSWORD = 200;

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const mode = body.mode === "register" ? "register" : "signin";

  if (!NAME_PATTERN.test(name)) {
    return jsonResponse({ error: "Usernames are 1 to 40 characters." }, 400);
  }
  if (!password || password.length > MAX_PASSWORD) {
    return jsonResponse({ error: "Enter your password." }, 400);
  }

  if (mode === "register") {
    if (password.length < MIN_NEW_PASSWORD) {
      return jsonResponse({ error: `Passwords need at least ${MIN_NEW_PASSWORD} characters.` }, 400);
    }
    const taken = await env.DB.prepare("SELECT name FROM users WHERE name = ? COLLATE NOCASE")
      .bind(name)
      .first();
    if (taken) {
      return jsonResponse({ error: "That username is taken." }, 409);
    }
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO users (name, created_at, password_hash, password_salt) VALUES (?, ?, ?, ?)"
    ).bind(name, createdAt, hash, salt).run();
    const cookie = await createSession(env, name);
    return jsonResponse({ name, created_at: createdAt }, 201, { "Set-Cookie": cookie });
  }

  // Sign in: exact name first, then a unique case-insensitive match.
  let user = await env.DB.prepare(
    "SELECT name, created_at, password_hash, password_salt FROM users WHERE name = ?"
  ).bind(name).first();
  if (!user) {
    const { results } = await env.DB.prepare(
      "SELECT name, created_at, password_hash, password_salt FROM users WHERE name = ? COLLATE NOCASE"
    ).bind(name).all();
    if (results.length === 1) {
      user = results[0];
    }
  }

  if (!user) {
    return jsonResponse({ error: "No account with that username." }, 404);
  }
  if (!user.password_hash || !user.password_salt) {
    // Accounts from before passwords existed used to be claimable by anyone.
    return jsonResponse({ error: "This account has no password yet. Ask the site owner to set one." }, 409);
  }

  const hash = await hashPassword(password, user.password_salt);
  if (!safeEqual(hash, user.password_hash)) {
    return jsonResponse({ error: "Wrong password." }, 401);
  }

  const cookie = await createSession(env, user.name);
  return jsonResponse({ name: user.name, created_at: user.created_at }, 200, { "Set-Cookie": cookie });
});
