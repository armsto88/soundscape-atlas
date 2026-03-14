/**
 * GET /api/profile/:name
 *
 * Returns the user's profile: account info, liked segments, and comment count.
 * { name, created_at, likes: [{segment_id, created_at}], comment_count: N }
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const name = String(params.name ?? "").trim();

  if (!name) {
    return jsonResponse({ error: "name is required" }, 400);
  }

  const user = await env.DB.prepare(
    "SELECT name, created_at FROM users WHERE name = ?"
  ).bind(name).first();

  if (!user) {
    return jsonResponse({ error: "User not found" }, 404);
  }

  const [likesResult, countResult] = await Promise.all([
    env.DB.prepare(
      "SELECT segment_id, created_at FROM likes WHERE user_name = ? ORDER BY created_at DESC"
    ).bind(name).all(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM comments WHERE user = ?"
    ).bind(name).first(),
  ]);

  return jsonResponse({
    name: user.name,
    created_at: user.created_at,
    likes: likesResult.results,
    comment_count: countResult?.count ?? 0,
  });
}
