/**
 * GET /api/auth/check — whether forms must pass the Turnstile check, and the
 * site key the browser needs to show it: { site_key: "..." } or { site_key: null }.
 * See functions/_lib/turnstile.js.
 */

import { handle, jsonResponse } from "../../_lib/auth.js";
import { turnstileSiteKey } from "../../_lib/turnstile.js";

export const onRequestGet = handle(async ({ env }) => jsonResponse({ site_key: turnstileSiteKey(env) }));
