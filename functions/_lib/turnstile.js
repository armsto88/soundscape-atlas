/**
 * Cloudflare Turnstile: the check that someone creating an account, signing in
 * or posting a comment is a person, not a bot.
 *
 * The browser shows the widget (website/js/botcheck.js), which gives it a
 * one-use token; the request sends it as `turnstile` in its JSON body and the
 * server confirms it with Cloudflare (siteverify) before doing anything else.
 *
 * It is switched on by two settings of the Pages project, both needed:
 *   TURNSTILE_SITE_KEY    (a variable; public, the browser gets it from /api/auth/check)
 *   TURNSTILE_SECRET_KEY  (a secret)
 * With either missing, there is no widget and no check, so a half-done setup
 * can never lock people out.
 *
 * This module exports no request handlers, so it does not become a route.
 */

import { jsonResponse } from "./auth.js";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN = 2048;

export function turnstileSiteKey(env) {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

/**
 * null when the request may go ahead, otherwise the response to send back.
 * `action` is the name the widget was given ("account" or "comment"), so a
 * token solved for one form cannot be spent on another.
 */
export async function checkTurnstile(request, env, token, action) {
  if (!turnstileSiteKey(env)) {
    return null;
  }
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN) {
    return jsonResponse({ error: "Please wait for the check that you're not a robot, then try again." }, 403);
  }
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) {
    form.append("remoteip", ip);
  }
  let outcome;
  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body: form });
    outcome = await response.json();
  } catch (error) {
    console.error("Turnstile siteverify failed", error);
    return jsonResponse({ error: "The check that you're not a robot could not be confirmed. Try again." }, 503);
  }
  if (!outcome?.success) {
    console.warn("Turnstile rejected a token", JSON.stringify(outcome?.["error-codes"] || []));
    return jsonResponse({ error: "The check that you're not a robot failed or ran out of time. Try again." }, 403);
  }
  // Cloudflare's test keys answer without an action; real ones echo the widget's.
  if (action && outcome.action && outcome.action !== action) {
    return jsonResponse({ error: "The check that you're not a robot was for another form. Try again." }, 403);
  }
  return null;
}
