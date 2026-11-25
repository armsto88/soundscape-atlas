/**
 * Favourites for the signed-in user (from the session cookie).
 *
 * GET    /api/likes  — [{ segment_id, created_at }]
 * POST   /api/likes  — { segment_id }  add a like
 * DELETE /api/likes  — { segment_id }  remove a like
 * Use ?scope=session to list session favourites, and session_id to save or remove one.
 */

import { getSessionUser, handle, jsonResponse, notSignedIn, readJson } from "../_lib/auth.js";
import { isPublishedRecording, RECORDING_ID } from "../_lib/recordings.js";

const HOUR = { table: "likes", field: "segment_id" };
const SESSION = { table: "session_favorites", field: "session_id" };

async function recordingFrom(request) {
  const body = await readJson(request);
  const scope = body?.session_id !== undefined ? SESSION : HOUR;
  const id = body?.[scope.field];
  return typeof id === "string" && RECORDING_ID.test(id) ? { ...scope, id } : null;
}

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }
  const { table, field } = new URL(request.url).searchParams.get("scope") === "session" ? SESSION : HOUR;
  const { results } = await env.DB.prepare(
    `SELECT ${field}, created_at FROM ${table} WHERE user_name = ? ORDER BY created_at DESC`
  ).bind(user).all();
  return jsonResponse(results);
});

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }
  const recording = await recordingFrom(request);
  if (!recording) return jsonResponse({ error: "A recording ID is required" }, 400);
  const { table, field, id } = recording;
  if (!await isPublishedRecording(context, field, id)) return jsonResponse({ error: "Recording not found" }, 404);
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ${table} (user_name, ${field}, created_at) VALUES (?, ?, ?)`
  ).bind(user, id, createdAt).run();
  return jsonResponse({ [field]: id, created_at: createdAt });
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return notSignedIn();
  }
  const recording = await recordingFrom(request);
  if (!recording) return jsonResponse({ error: "A recording ID is required" }, 400);
  const { table, field, id } = recording;
  await env.DB.prepare(`DELETE FROM ${table} WHERE user_name = ? AND ${field} = ?`).bind(user, id).run();
  return jsonResponse({ deleted: true });
});
