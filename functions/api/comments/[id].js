/**
 * DELETE /api/comments/:id — delete a comment (owner only)
 *
 * Body: { "user": "<signed-in username>" }
 * The user field is checked against the stored comment owner before deletion.
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const id = String(params.id ?? "").trim();

  if (!id) {
    return jsonResponse({ error: "Comment id is required" }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { user } = body ?? {};
  if (!user || typeof user !== "string") {
    return jsonResponse({ error: "user is required" }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT user FROM comments WHERE id = ?"
  ).bind(id).first();

  if (!existing) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  if (existing.user !== user) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();

  return jsonResponse({ deleted: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
