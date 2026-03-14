/**
 * GET  /api/likes?user=X         — list all liked segment_ids for a user
 * POST /api/likes                — add a like  { user_name, segment_id }
 * DELETE /api/likes              — remove a like { user_name, segment_id }
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = new URL(request.url).searchParams.get("user");

  if (!user) {
    return jsonResponse({ error: "user query parameter required" }, 400);
  }

  const { results } = await env.DB.prepare(
    "SELECT segment_id, created_at FROM likes WHERE user_name = ? ORDER BY created_at DESC"
  ).bind(user).all();

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

  const { user_name, segment_id } = body ?? {};
  if (!user_name || typeof user_name !== "string" || user_name.length > 100) {
    return jsonResponse({ error: "user_name is required (string, max 100 chars)" }, 400);
  }
  if (!segment_id || typeof segment_id !== "string" || segment_id.length > 200) {
    return jsonResponse({ error: "segment_id is required (string, max 200 chars)" }, 400);
  }

  const created_at = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO likes (user_name, segment_id, created_at) VALUES (?, ?, ?)"
  ).bind(user_name, segment_id, created_at).run();

  return jsonResponse({ user_name, segment_id, created_at });
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { user_name, segment_id } = body ?? {};
  if (!user_name || typeof user_name !== "string") {
    return jsonResponse({ error: "user_name is required" }, 400);
  }
  if (!segment_id || typeof segment_id !== "string") {
    return jsonResponse({ error: "segment_id is required" }, 400);
  }

  await env.DB.prepare(
    "DELETE FROM likes WHERE user_name = ? AND segment_id = ?"
  ).bind(user_name, segment_id).run();

  return jsonResponse({ deleted: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
