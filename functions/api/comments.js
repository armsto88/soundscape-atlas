/**
 * GET  /api/comments?segment_id=X — public: all comments on a segment
 * GET  /api/comments?mine=1        — the signed-in user's comments (for My Library)
 * POST /api/comments               — { segment_id, text, sec, turnstile } as the signed-in user
 *                                    (turnstile: the bot check's token, when switched on)
 * Use session_id for session comments, with an optional segment_id and sec to mark a moment.
 */

import { getSessionUser, handle, jsonResponse, notSignedIn, readJson } from "../_lib/auth.js";
import { isPublishedRecording, publishedRecordings, RECORDING_ID } from "../_lib/recordings.js";
import { checkTurnstile } from "../_lib/turnstile.js";

const MAX_TEXT = 2000;
const COLUMNS = "id, segment_id, user, text, sec, created_at";
const SESSION_COLUMNS = "id, session_id, segment_id, user, text, sec, created_at";

function wallTime(iso) {
  return Date.parse(String(iso).slice(0, 19).replace(" ", "T") + "Z");
}

export const onRequestGet = handle(async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  const segmentId = url.searchParams.get("segment_id");

  if (sessionId !== null) {
    if (!RECORDING_ID.test(sessionId)) return jsonResponse({ error: "A session ID is required" }, 400);
    if (!await isPublishedRecording(context, "session_id", sessionId)) return jsonResponse({ error: "Session not found" }, 404);
    const { results } = await env.DB.prepare(
      `SELECT ${SESSION_COLUMNS} FROM session_comments WHERE session_id = ? ORDER BY created_at DESC LIMIT 50`
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
  const blocked = await checkTurnstile(request, env, body.turnstile, "comment");
  if (blocked) {
    return blocked;
  }

  const cleanText = text.trim().slice(0, MAX_TEXT);
  const secNum = Number.isFinite(Number(sec)) ? Math.max(0, Number(sec)) : 0;
  const id = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  if (sessionId !== undefined) {
    const segments = (await publishedRecordings(context)).filter((row) => row.session_id === sessionId);
    if (!segments.length) return jsonResponse({ error: "Session not found" }, 404);
    const timed = segmentId !== undefined || sec !== undefined;
    if (timed) {
      const segment = segments.find((row) => row.segment_id === segmentId);
      const duration = segment && (wallTime(segment.segment_end_local) - wallTime(segment.segment_start_local)) / 1000;
      if (!segment || !Number.isFinite(sec) || sec < 0 || !(sec < duration)) {
        return jsonResponse({ error: "Choose a time within a published hour of this session." }, 400);
      }
    }
    const comment = { id, session_id: sessionId, segment_id: timed ? segmentId : null,
      user, text: cleanText, sec: timed ? sec : null, created_at: createdAt };
    await env.DB.prepare(
      `INSERT INTO session_comments (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, sessionId, comment.segment_id, user, cleanText, comment.sec, createdAt).run();
    return jsonResponse(comment, 201);
  }

  await env.DB.prepare(
    "INSERT INTO comments (id, segment_id, user, text, sec, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, segmentId, user, cleanText, secNum, createdAt).run();

  return jsonResponse({ id, segment_id: segmentId, user, text: cleanText, sec: secNum, created_at: createdAt }, 201);
});
