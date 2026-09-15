export const NO_DECORATION = { textDecoration: 'none' };
export const STROKE_TRANSITION = { transition: "stroke 150ms" };
// Shared hover treatment for inline metadata links — mirrors the header
// buttons (bg-elevated wash + text-colored result + color transition).
export const LINK_PILL = "rounded px-1 -mx-1 transition-colors hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]";
export const FLEX_1 = { flex: "1 1 0" };
export const closeOnEscape = e => { if (e.key === "Escape") e.currentTarget.removeAttribute("open"); };
export const closeAllMenus = () => { document.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open')); };
export const closeOtherMenus = (self) => { document.querySelectorAll('details[open]').forEach(d => { if (d !== self) d.removeAttribute('open'); }); };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function readStoredList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (!Array.isArray(value)) throw new Error("stored value is not a list");
    return value.filter(value => typeof value === "string").slice(0, 5);
  } catch {
    try { localStorage.removeItem(key); } catch { /* storage may be unavailable */ }
    return [];
  }
}

export function tJsx(tFn, key, vars) {
  const raw = tFn(key);
  if (!vars) return raw;
  const names = Object.keys(vars).join('|');
  const parts = raw.split(new RegExp(`\\{(${names})\\}`, 'g'));
  return parts.map((part, i) => i % 2 === 0 ? part : vars[part]);
}

export function matchKeyword(item, kw, type) {
  const m = getKeywordMatcher(kw);
  if (!m || m.kind === "none" || (m.kind === "text" && !m.regex)) return true;
  if (m.kind === "sub") return (item.subreddit || "").toLowerCase() === m.value;
  if (m.kind === "user") return (item.author || "").toLowerCase() === m.value;
  const fields = [
    type === "posts" ? item.title : item.body,
    type === "posts" ? item.selftext : item.body,
    item.subreddit,
    item.subreddit_name_prefixed,
    item.link_flair_text,
    item.author_flair_text
  ];
  return fields.some(f => typeof f === "string" && m.regex.test(f));
}

// Precompiled keyword matcher. matchKeyword() is called once per item per
// filter pass, so compiling a RegExp per item (O(n) compiles per keystroke)
// is the dominant cost on large histories. Cache the last matcher and reuse
// the single compiled regex for the whole pass.
let _kwCacheRaw = null;
let _kwCacheMatcher = null;

export function getKeywordMatcher(kw) {
  const raw = typeof kw === "string" ? kw.trim() : "";
  if (!raw) return null;
  if (raw === _kwCacheRaw) return _kwCacheMatcher;
  const matcher = buildKeywordMatcher(raw);
  _kwCacheRaw = raw;
  _kwCacheMatcher = matcher;
  return matcher;
}

function buildKeywordMatcher(raw) {
  // Strict subreddit filter when query is formatted as "r/subname" or "/r/subname"
  if (/^(?:\/?r\/)/i.test(raw)) {
    const subClean = raw.replace(/^(?:\/?r\/)/i, "").toLowerCase();
    return { kind: "sub", value: subClean, regex: null };
  }

  // Strict author filter when query is formatted as "u/username" or "/u/username"
  if (/^(?:\/?u\/)/i.test(raw)) {
    const userClean = raw.replace(/^(?:\/?u\/)/i, "").toLowerCase();
    return { kind: "user", value: userClean, regex: null };
  }

  const clean = raw.replace(/^["']|["']$/g, "");
  if (!clean) return null;

  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const regex = /^\w+$/.test(clean) ? new RegExp(`\\b${escaped}\\b`, "i") : new RegExp(escaped, "i");
    return { kind: "text", value: clean, regex };
  } catch {
    return { kind: "none", value: clean, regex: null };
  }
}

// Re-exported from utils so consumers can import it from constants as well.
export { fmtNum } from "./utils.js";
