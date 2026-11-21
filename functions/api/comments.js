/**
 * GET  /api/comments?segment_id=X — public: all comments on a segment
 * GET  /api/comments?mine=1        — the signed-in user's comments (for My Library)
 * POST /api/comments               — { segment_id, text, sec } as the signed-in user
 */

import { getSessionUser, handle, jsonResponse, notSignedIn, readJson } from "../_lib/auth.js";

const SEGMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const MAX_TEXT = 2000;
const COLUMNS = "id, segment_id, user, text, sec, created_at";

export const onRequestGet = handle(async ({ request, env }) => {
  const url = new URL(request.url);
  const segmentId = url.searchParams.get("segment_id");

  if (segmentId) {
    const { results } = await env.DB.prepare(
      `SELECT ${COLUMNS} FROM comments WHERE segment_id = ? ORDER BY sec ASC`
    ).bind(segmentId).all();
    return jsonResponse(results);
  }

  if (url.searchParams.get("mine")) {
    const user = await getSessionUser(request, env);
    if (!user) {
      return notSignedIn();
    }
    const { results } = await env.DB.prepare(
      `SELECT ${COLUMNS} FROM comments WHERE user = ? ORDER BY created_at DESC`
    ).bind(user).all();
    return jsonResponse(results);
  }

  return jsonResponse({ error: "segment_id or mine=1 is required" }, 400);
});

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }

  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const { segment_id: segmentId, text, sec } = body;

  if (typeof segmentId !== "string" || !SEGMENT_ID_PATTERN.test(segmentId)) {
    return jsonResponse({ error: "segment_id is required" }, 400);
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return jsonResponse({ error: "Comment text is required" }, 400);
  }

  const cleanText = text.trim().slice(0, MAX_TEXT);
  const secNum = Number.isFinite(Number(sec)) ? Math.max(0, Number(sec)) : 0;
  const id = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO comments (id, segment_id, user, text, sec, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, segmentId, user, cleanText, secNum, createdAt).run();

  return jsonResponse({ id, segment_id: segmentId, user, text: cleanText, sec: secNum, created_at: createdAt }, 201);
});
