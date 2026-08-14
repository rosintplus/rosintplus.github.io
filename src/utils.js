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

// ─── API Config ───────────────────────────────────────────────────────────────

export // Strip anything users paste around a username: @, leading slashes, full
// reddit URLs, and u/ /u/ user/ prefixes. Returns the bare username.
function normalizeUsername(input) {
  let s = String(input || "").trim();
  // Full URL → keep only the path after the domain
  s = s.replace(/^https?:\/\/(www\.|old\.|new\.)?reddit\.com/i, "");
  // Leading slashes, then optional u/ /user/ prefix, then a leading @
  s = s.replace(/^\/+/, "").replace(/^(u|user)\//i, "").replace(/^@/, "");
  // Drop any trailing slash / query / whitespace
  s = s.replace(/[/?#].*$/, "").trim();
  return s;
}

// Strip anything users paste around a subreddit name: r/ /r/ prefixes, full
// reddit URLs, and trailing paths. Returns the bare subreddit name.
export function normalizeSubreddit(input) {
  let s = String(input || "").trim();
  s = s.replace(/^https?:\/\/(www\.|old\.|new\.)?reddit\.com/i, "");
  s = s.replace(/^\/+/, "");
  s = s.replace(/^r\//i, "");
  s = s.replace(/[/?#].*$/, "").trim();
  return s;
}