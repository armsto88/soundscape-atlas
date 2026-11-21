/**
 * Likes for the signed-in user (from the session cookie).
 *
 * GET    /api/likes  — [{ segment_id, created_at }]
 * POST   /api/likes  — { segment_id }  add a like
 * DELETE /api/likes  — { segment_id }  remove a like
 */

import { getSessionUser, handle, jsonResponse, notSignedIn, readJson } from "../_lib/auth.js";

const SEGMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

async function segmentIdFrom(request) {
  const body = await readJson(request);
  const segmentId = typeof body?.segment_id === "string" ? body.segment_id : "";
  return SEGMENT_ID_PATTERN.test(segmentId) ? segmentId : null;
}

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }
  const { results } = await env.DB.prepare(
    "SELECT segment_id, created_at FROM likes WHERE user_name = ? ORDER BY created_at DESC"
  ).bind(user).all();
  return jsonResponse(results);
});

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }
  const segmentId = await segmentIdFrom(request);
  if (!segmentId) {
    return jsonResponse({ error: "segment_id is required" }, 400);
  }
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO likes (user_name, segment_id, created_at) VALUES (?, ?, ?)"
  ).bind(user, segmentId, createdAt).run();
  return jsonResponse({ segment_id: segmentId, created_at: createdAt });
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }
  const segmentId = await segmentIdFrom(request);
  if (!segmentId) {
    return jsonResponse({ error: "segment_id is required" }, 400);
  }
  await env.DB.prepare("DELETE FROM likes WHERE user_name = ? AND segment_id = ?").bind(user, segmentId).run();
  return jsonResponse({ deleted: true });
});
