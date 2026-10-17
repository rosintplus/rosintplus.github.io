/**
 * Post-build step: emit the static 404 and privacy pages.
 *
 * Both are client-rendered routes in the SPA, so they ship the same
 * index.html bundle. To avoid duplicate SEO metadata (crawlers treat two
 * pages with identical title/description/canonical as one), each copy gets
 * its own title, description, canonical URL, Open Graph / Twitter tags and
 * JSON-LD name/url.
 *
 * Lives in a file rather than an inline `node -e` one-liner: the inline form
 * was unrunnable under PowerShell (escaped-quote parsing) and unreviewable.
 *
 * Run automatically by `npm run build` after `vite build`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = path.join(root, "dist", "index.html");

const SITE = "https://rosintplus.github.io/";
const JSONLD_DESCRIPTIONS = [
  "Search any Reddit username to find deleted posts, removed comments, and private profiles. Free, open-source, no login required.",
  "Open-source Reddit intelligence tool for viewing deleted posts, removed comments, and private profiles.",
];

const PAGES = {
  "404.html": {
    title: "Rosint+ — Page not found",
    desc: "Page not found. Return to Rosint+ to search deleted Reddit posts, removed comments and private profiles.",
    canonical: `${SITE}404.html`,
  },
  "privacy.html": {
    title: "Rosint+ — Privacy & Removal Requests",
    desc: "Rosint+ privacy: no backend, no accounts, no cookies, no tracking. How removal requests work and who to contact.",
    canonical: `${SITE}privacy.html`,
  },
};

/** Replace the first match of a pattern, or throw — a silent no-op would ship duplicate meta. */
function replaceOnce(html, pattern, replacement, label, file) {
  if (!pattern.test(html)) throw new Error(`postbuild: ${label} not found in ${file}`);
  return html.replace(pattern, replacement);
}

const src = readFileSync(distIndex, "utf8");

for (const [file, page] of Object.entries(PAGES)) {
  let html = src;
  const attr = (name, value) => `${name}="${value}"`;

  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${page.title}</title>`, "<title>", file);
  html = replaceOnce(html, /<meta name="description" content="[^"]*"/, `<meta name="description" content="${page.desc}"`, "description", file);
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${page.canonical}"`, "canonical", file);
  html = replaceOnce(html, /<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${page.title}"`, "og:title", file);
  html = replaceOnce(html, /<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${page.desc}"`, "og:description", file);
  html = replaceOnce(html, /<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${page.canonical}"`, "og:url", file);
  html = replaceOnce(html, /<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${page.title}"`, "twitter:title", file);
  html = replaceOnce(html, /<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${page.desc}"`, "twitter:description", file);
  // JSON-LD: only the WebApplication block's name/url become page-specific;
  // the author/Organization blocks keep the site identity.
  html = replaceOnce(html, /"url": "https:\/\/rosintplus\.github\.io\/"/, `"url": "${page.canonical}"`, "JSON-LD url", file);
  html = replaceOnce(html, /"name": "Rosint\+"/, `"name": ${JSON.stringify(page.title)}`, "JSON-LD name", file);
  for (const description of JSONLD_DESCRIPTIONS) {
    html = html.split(`"description": ${JSON.stringify(description)}`).join(`"description": ${JSON.stringify(page.desc)}`);
  }

  const out = path.join(root, "dist", file);
  writeFileSync(out, html);
  console.log(`postbuild: wrote dist/${file} (${attr("canonical", page.canonical)})`);
}