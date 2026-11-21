/**
 * POST /api/auth/logout — end the current session and clear its cookie.
 */

import { clearedSessionCookie, endSession, handle, jsonResponse } from "../../_lib/auth.js";

export const onRequestPost = handle(async ({ request, env }) => {
  await endSession(request, env);
  return jsonResponse({ signed_out: true }, 200, { "Set-Cookie": clearedSessionCookie() });
});
