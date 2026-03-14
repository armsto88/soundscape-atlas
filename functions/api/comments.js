/**
 * GET  /api/comments?segment_id=X  — list all comments for a segment
 * GET  /api/comments?user=X        — list all comments by a user (for My Library)
 * POST /api/comments               — create a new comment
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const segmentId = url.searchParams.get("segment_id");
  const user = url.searchParams.get("user");

  if (!segmentId && !user) {
    return jsonResponse({ error: "segment_id or user query parameter required" }, 400);
  }

  let stmt;
  if (segmentId) {
    stmt = env.DB.prepare(
      "SELECT id, segment_id, user, text, sec, created_at FROM comments WHERE segment_id = ? ORDER BY sec ASC"
    ).bind(segmentId);
  } else {
    stmt = env.DB.prepare(
      "SELECT id, segment_id, user, text, sec, created_at FROM comments WHERE user = ? ORDER BY created_at DESC"
    ).bind(user);
  }

  const { results } = await stmt.all();
  return jsonResponse(results);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { segment_id, user, text, sec } = body ?? {};

  if (!segment_id || typeof segment_id !== "string" || segment_id.length > 200) {
    return jsonResponse({ error: "segment_id is required (string, max 200 chars)" }, 400);
  }
  if (!user || typeof user !== "string" || user.length > 100) {
    return jsonResponse({ error: "user is required (string, max 100 chars)" }, 400);
  }
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return jsonResponse({ error: "text is required and must not be empty" }, 400);
  }

  const cleanText = text.trim().slice(0, 2000);
  const secNum = Number.isFinite(Number(sec)) ? Math.max(0, Number(sec)) : 0;
  const id = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const created_at = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO comments (id, segment_id, user, text, sec, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, String(segment_id), String(user), cleanText, secNum, created_at).run();

  return jsonResponse({ id, segment_id, user, text: cleanText, sec: secNum, created_at }, 201);
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
