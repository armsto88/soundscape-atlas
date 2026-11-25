import { getSessionUser, handle, isAdministrator, jsonResponse, notSignedIn } from "../../_lib/auth.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const actor = await getSessionUser(request, env);
  if (!actor) return notSignedIn();
  if (!await isAdministrator(env, actor)) return jsonResponse({ error: "Administrator access required." }, 403);

  const name = new URL(request.url).searchParams.get("name");
  if (name === null) {
    const { results } = await env.DB.prepare("SELECT name FROM users ORDER BY name COLLATE NOCASE, name").all();
    return jsonResponse(results);
  }
  if (!name || name.length > 100) return jsonResponse({ error: "Enter an account name." }, 400);

  const [users, hours, sessions, hourComments, sessionComments] = await env.DB.batch([
    env.DB.prepare(`SELECT name, created_at,
      EXISTS (SELECT 1 FROM administrators WHERE user_name = users.name) AS is_admin
      FROM users WHERE name = ?`).bind(name),
    env.DB.prepare("SELECT segment_id, created_at FROM likes WHERE user_name = ? ORDER BY created_at DESC").bind(name),
    env.DB.prepare("SELECT session_id, created_at FROM session_favorites WHERE user_name = ? ORDER BY created_at DESC").bind(name),
    env.DB.prepare("SELECT segment_id, text, sec, created_at FROM comments WHERE user = ? ORDER BY created_at DESC").bind(name),
    env.DB.prepare("SELECT session_id, text, created_at FROM session_comments WHERE user = ? ORDER BY created_at DESC").bind(name),
  ]);
  const row = users.results[0];
  if (!row) return jsonResponse({ error: "Account not found." }, 404);
  const user = { ...row, is_admin: Boolean(row.is_admin) };
  return jsonResponse({ user, hours: hours.results, sessions: sessions.results,
    hour_comments: hourComments.results, session_comments: sessionComments.results });
});
