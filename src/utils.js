/**
 * Trigger a client-side file download.
 * @param {string} filename - Suggested download name.
 * @param {string} text - File contents.
 * @param {string} mime - MIME type for the blob.
 */
export function downloadFile(filename, text, mime) {
  const blob = new Blob([text], {
    type: mime
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Strip anything users paste around a username: @, leading slashes, full
 * reddit URLs, and u/ /u/ user/ prefixes. Returns the bare username.
 * @param {unknown} input - Raw user input.
 * @returns {string} Bare username.
 */
export function normalizeUsername(input) {
  let s = String(input || "").trim();
  // Full URL → keep only the path after the domain
  s = s.replace(/^https?:\/\/([a-z0-9-]+\.)?reddit\.com/i, "");
  // Leading slashes, then optional u/ /user/ / r/ prefix, then a leading @
  s = s.replace(/^\/+/, "").replace(/^(u|user|r)\//i, "").replace(/^@/, "");
  // Drop any trailing slash / query / whitespace
  s = s.replace(/[/?#].*$/, "").trim();
  return s;
}

// Strip anything users paste around a subreddit name: r/ /r/ prefixes, full
// reddit URLs, and trailing paths. Returns the bare subreddit name.
/**
 * Normalize a subreddit input to its bare name.
 * @param {unknown} input - Raw user input.
 * @returns {string} Bare subreddit name.
 */
export function normalizeSubreddit(input) {
  let s = String(input || "").trim();
  s = s.replace(/^https?:\/\/([a-z0-9-]+\.)?reddit\.com/i, "");
  s = s.replace(/^\/+/, "");
  s = s.replace(/^r\//i, "");
  s = s.replace(/[/?#].*$/, "").trim();
  return s;
}

// Detect a pasted Reddit post/comment URL or bare ID. Returns the post's
// base36 ID (and optional comment ID) or null if the input looks like a
// plain username/subreddit. Bare 5-10 char IDs are intentionally NOT
// treated as posts — only explicit URLs / t3_ / redd.it forms are.
/**
 * Detect a Reddit post/comment reference in free-form input.
 * @param {unknown} input - Raw user input.
 * @returns {{ postId: string, commentId: string|null, kind: string }|null} Parsed IDs or null.
 */
export function parsePostInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  // t3_ prefix is unambiguous
  const t3 = s.match(/^t3_([a-z0-9]{5,10})$/);
  if (t3) return { postId: t3[1], commentId: null, kind: "post" };
  const t1 = s.match(/^t1_([a-z0-9]{5,10})$/);
  if (t1) return { postId: null, commentId: t1[1], kind: "comment" };
  const path = s.split(/[?#]/, 1)[0];
  // redd.it short link
  const short = path.match(/(?:https?:\/\/)?(?:www\.)?redd\.it\/([a-z0-9]{5,10})(?:\/([a-z0-9]{5,10}))?/);
  if (short) return { postId: short[1], commentId: short[2] || null, kind: short[2] ? "comment" : "post" };
  // Any URL or path containing /comments/<id>
  const m = path.match(/\/comments\/([a-z0-9]{5,10})(?:\/[^/]*\/([a-z0-9]{5,10}))?/);
  if (m) return { postId: m[1], commentId: m[2] || null, kind: m[2] ? "comment" : "post" };
  // Full reddit.com URL that is at least .../r/<sub>/comments/... — already handled,
  // but also handle old/new/sh.reddit. The /comments/ branch above covers them
  // after we strip the domain.
  return null;
}

/**
 * Check whether free-form input references a Reddit post/comment.
 * @param {unknown} input - Raw user input.
 * @returns {boolean} True when input parses as a post/comment reference.
 */
export function isPostInput(input) {
  return parsePostInput(input) != null;
}

/**
 * Validate a YYYY-MM-DD calendar-day string (from <input type="date"> or
 * ?from/?to). Invalid strings must be treated as "" (no filter) and dropped
 * from the URL — never passed to Date (which would yield NaN bounds).
 * @param {unknown} s - Candidate date string.
 * @returns {boolean} True when s is a real calendar day.
 */
export function isValidDateString(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * LOCAL calendar-day bounds for <input type="date"> values.
 * Both the client filter and the server epoch use new Date(y, m-1, d)
 * (local midnight), NOT `new Date("YYYY-MM-DDT00:00:00Z")` (UTC midnight):
 * the UTC pin shifted day filters by the viewer's timezone offset.
 * @param {string} s - Validated YYYY-MM-DD string.
 * @returns {number|null} Start-of-day epoch seconds, or null when invalid.
 */
export function parseLocalDayStartSec(s) {
  if (!isValidDateString(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

/**
 * LOCAL end-of-day bound (23:59:59 local) for the same basis as start.
 * @param {string} s - Validated YYYY-MM-DD string.
 * @returns {number|null} End-of-day epoch seconds, or null when invalid.
 */
export function parseLocalDayEndSec(s) {
  if (!isValidDateString(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000);
}

/**
 * Sanitize one CSV/JSON export filename segment (query/tab).
 * Strips Windows-forbidden chars + controls, trims to 60 chars.
 * @param {unknown} s - Raw segment.
 * @returns {string} Safe segment, or "export" fallback.
 */
export function sanitizeFilenameSegment(s) {
  // eslint-disable-next-line no-control-regex -- stripping C0 controls requires matching them
  const clean = String(s ?? "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim().slice(0, 60);
  return clean || "export";
}

/**
 * Allow only http(s) URLs for rendering (href/src). Returns the original
 * string when it parses with an http/https scheme, else null (caller omits
 * the href or hides the img).
 * @param {unknown} href - Candidate URL.
 * @returns {string|null} Safe URL or null.
 */
export function safeHttpUrl(href) {
  if (typeof href !== "string" || !href) return null;
  try {
    const u = new URL(href, "https://localhost");
    if ((u.protocol === "http:" || u.protocol === "https:") && /^https?:\/\//i.test(href.trim())) return href;
    return null;
  } catch {
    return null;
  }
}

/**
 * Format a count compactly (1.2k / 3.4M), locale-aware when possible.
 * @param {number|null|undefined} n - Number to format.
 * @param {string} [locale] - Optional BCP-47 locale.
 * @returns {string|null} Formatted number.
 */
export function fmtNum(n, locale) {
  if (n == null) return null;
  try {
    if (locale) {
      const nf = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
      return nf.format(n);
    }
  } catch { /* fall through to manual */ }
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
