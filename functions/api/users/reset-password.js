/**
 * POST /api/users/reset-password
 *
 * Admin-only manual reset endpoint.
 *
 * Auth:
 *   Header: x-admin-key: <ADMIN_RESET_KEY>
 *
 * Body:
 *   { "name": "alice", "new_password": "new-secret" }
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

  const expectedAdminKey = typeof env.ADMIN_RESET_KEY === "string" ? env.ADMIN_RESET_KEY : "";
  if (!expectedAdminKey) {
    return jsonResponse({ error: "ADMIN_RESET_KEY is not configured" }, 503);
  }

  const providedAdminKey = request.headers.get("x-admin-key") || "";
  if (!providedAdminKey || providedAdminKey !== expectedAdminKey) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const newPassword = typeof body?.new_password === "string" ? body.new_password : "";

  if (!name || name.length > 100) {
    return jsonResponse({ error: "name is required (string, max 100 chars)" }, 400);
  }
  if (!newPassword || newPassword.length < 6 || newPassword.length > 200) {
    return jsonResponse({ error: "new_password is required (6-200 chars)" }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT name FROM users WHERE name = ?"
  ).bind(name).first();

  if (!existing) {
    return jsonResponse({ error: "User not found" }, 404);
  }

  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);

  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, password_salt = ? WHERE name = ?"
  ).bind(hash, salt, name).run();

  return jsonResponse({ reset: true, name });
}
