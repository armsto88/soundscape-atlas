/**
 * POST /api/users  — register or sign in
 *
 * Body: { "name": "Alice", "password": "secret" }
 *
 * - Username not found  → register: hash password, store, return 201
 * - Username found, no password stored yet (legacy) → adopt password, return 200
 * - Username found, password matches → return 200
 * - Username found, password wrong → return 401
 *
 * Passwords are hashed with PBKDF2-SHA-256 via the Web Crypto API.
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name || name.length > 100) {
    return jsonResponse({ error: "name is required (string, max 100 chars)" }, 400);
  }
  if (!password || password.length < 6 || password.length > 200) {
    return jsonResponse({ error: "password is required (6–200 chars)" }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT name, created_at, password_hash, password_salt FROM users WHERE name = ?"
  ).bind(name).first();

  if (!existing) {
    // New user — register.
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    const created_at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO users (name, created_at, password_hash, password_salt) VALUES (?, ?, ?, ?)"
    ).bind(name, created_at, hash, salt).run();
    return jsonResponse({ name, created_at, is_new: true }, 201);
  }

  if (!existing.password_hash || !existing.password_salt) {
    // Legacy user with no password — adopt the supplied password.
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE name = ?"
    ).bind(hash, salt, name).run();
    return jsonResponse({ name, created_at: existing.created_at, is_new: false });
  }

  // Existing user — verify password.
  const hash = await hashPassword(password, existing.password_salt);
  if (hash !== existing.password_hash) {
    return jsonResponse({ error: "Incorrect password" }, 401);
  }

  return jsonResponse({ name, created_at: existing.created_at, is_new: false });
}
