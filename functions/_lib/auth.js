/**
 * Shared helpers for the Pages Functions: JSON responses, password hashing and
 * cookie-based sessions. This module exports no request handlers, so it does
 * not become a route.
 *
 * Sessions: sign-in creates a random token, sent to the browser in an HttpOnly,
 * Secure, SameSite=Lax cookie. Only the token's SHA-256 hash is stored in D1,
 * so a database leak does not expose live sessions. Every endpoint that acts on
 * behalf of a user reads the user from this cookie, never from the request body.
 */

export const SESSION_COOKIE = "sa_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // Workers' maximum

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Wrap a handler so unexpected errors become JSON 500s instead of HTML pages. */
export function handle(fn) {
  return async (context) => {
    try {
      return await fn(context);
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: "Server error" }, 500);
    }
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function generateSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}

/** Constant-time string comparison, so timing does not leak how much matched. */
export function safeEqual(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return "";
}

function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedSessionCookie() {
  return sessionCookie("", 0);
}

/** Create a session for `userName`; returns the Set-Cookie header value. */
export async function createSession(env, userName) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now.toISOString()).run();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_name, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(await sha256Hex(token), userName, now.toISOString(), expires.toISOString()).run();
  return sessionCookie(token, SESSION_DAYS * 24 * 60 * 60);
}

/** The signed-in user's name, or null. */
export async function getSessionUser(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }
  const row = await env.DB.prepare(
    "SELECT user_name, expires_at FROM sessions WHERE token_hash = ?"
  ).bind(await sha256Hex(token)).first();
  if (!row || row.expires_at < new Date().toISOString()) {
    return null;
  }
  return row.user_name;
}

export async function endSession(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (/^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
}

export async function endAllSessionsFor(env, userName) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_name = ?").bind(userName).run();
}

export function notSignedIn() {
  return jsonResponse({ error: "Sign in required" }, 401);
}
