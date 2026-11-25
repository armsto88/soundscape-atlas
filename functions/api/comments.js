/**
 * GET  /api/comments?segment_id=X — public: all comments on a segment
 * GET  /api/comments?mine=1        — the signed-in user's comments (for My Library)
 * POST /api/comments               — { segment_id, text, sec } as the signed-in user
 * Use session_id to read or post comments on a recording session.
 */

import { getSessionUser, handle, jsonResponse, notSignedIn, readJson } from "../_lib/auth.js";
import { isPublishedRecording, RECORDING_ID } from "../_lib/recordings.js";

const MAX_TEXT = 2000;
const COLUMNS = "id, segment_id, user, text, sec, created_at";

export const onRequestGet = handle(async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  const segmentId = url.searchParams.get("segment_id");

  if (sessionId !== null) {
    if (!RECORDING_ID.test(sessionId)) return jsonResponse({ error: "A session ID is required" }, 400);
    if (!await isPublishedRecording(context, "session_id", sessionId)) return jsonResponse({ error: "Session not found" }, 404);
    const { results } = await env.DB.prepare(
      "SELECT id, session_id, user, text, created_at FROM session_comments WHERE session_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(sessionId).all();
    return jsonResponse(results);
  }

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

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }

  const body = await readJson(request);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const { segment_id: segmentId, session_id: sessionId, text, sec } = body;

  const idField = sessionId !== undefined ? "session_id" : "segment_id";
  const recordingId = body[idField];
  if (typeof recordingId !== "string" || !RECORDING_ID.test(recordingId)) {
    return jsonResponse({ error: "A recording ID is required" }, 400);
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return jsonResponse({ error: "Comment text is required" }, 400);
  }

  const cleanText = text.trim().slice(0, MAX_TEXT);
  const secNum = Number.isFinite(Number(sec)) ? Math.max(0, Number(sec)) : 0;
  const id = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  if (sessionId !== undefined) {
    if (!await isPublishedRecording(context, idField, recordingId)) return jsonResponse({ error: "Session not found" }, 404);
    await env.DB.prepare(
      "INSERT INTO session_comments (id, session_id, user, text, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, sessionId, user, cleanText, createdAt).run();
    return jsonResponse({ id, session_id: sessionId, user, text: cleanText, created_at: createdAt }, 201);
  }

  await env.DB.prepare(
    "INSERT INTO comments (id, segment_id, user, text, sec, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, segmentId, user, cleanText, secNum, createdAt).run();

  return jsonResponse({ id, segment_id: segmentId, user, text: cleanText, sec: secNum, created_at: createdAt }, 201);
});
