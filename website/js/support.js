// "Care for this place": a local conservation group a listener can support,
// from the optional support_name / support_url / support_note columns in
// sites.csv. The link goes to the group's own donation page; the site never
// handles money and adds no tracking.

import { el } from "./util.js";

export function hasSupport(site) {
  const s = site && site.support;
  return Boolean(s && s.name && /^https:\/\//.test(s.url || ""));
}

// "Support their work ↗", opening the group's page in a new tab
export function supportLink(site, text = "Support their work") {
  if (!hasSupport(site)) return null;
  return el("a", { class: "support-link", href: site.support.url, target: "_blank", rel: "noopener" }, `${text} ↗`);
}

// the group and what it does, then the link: "Name. Restores rainforest … Support their work ↗"
export function supportText(site) {
  if (!hasSupport(site)) return null;
  const { name, note } = site.support;
  return [el("b", {}, name), note ? `. ${note.replace(/\.?\s*$/, ".")} ` : " ", supportLink(site)];
}

// the block on a place page, under its description
export function supportBlock(site) {
  if (!hasSupport(site)) return null;
  return el("aside", { class: "support", "aria-label": "Care for this place" },
    el("p", { class: "eyebrow" }, "Care for this place"),
    el("p", {}, supportText(site)));
}
