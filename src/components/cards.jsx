/* eslint-disable react-refresh/only-export-components -- shared module: cards + status/thumbnail helpers (by design) */
import { memo, useState, useMemo, useCallback, useEffect, useRef, Component } from "react";
import { safeFetch, ARCTIC, REDDIT_BASE } from "../api/client.js";
import { useI18n, tN, translations, en, getLang, subscribe, LOCALES } from "../i18n.js";
import { fmtNum } from "../utils.js";
import { STROKE_TRANSITION } from "../constants.js";
import { HoverHint, HoverTime } from "./HoverHint.jsx";
import { IconArrowUp, IconComment, IconExternal, IconSpinner } from "./icons.jsx";
import { CopyButton } from "./CopyButton.jsx";

// Cache compiled highlight regexes per search term. Without this, rendering
// N cards recompiles the same pattern N times per keystroke (plus N splits).
// Single-entry cache covers the common case (one shared highlightTerm);
// small Map covers transitions (typing a→ab keeps both while deferred lags).
const _hlCache = new Map();
// Max highlight/keyword input: longer input returns no-filter, preventing a
// giant-RegExp self-DoS (KB-long pattern tested per item per keystroke).
const HIGHLIGHT_MAX_LEN = 200;
function getCachedHighlightRegexes(highlight) {
  const raw = typeof highlight === "string" ? highlight.trim() : "";
  if (!raw) return { splitRe: null, testRe: null };
  if (raw.length > HIGHLIGHT_MAX_LEN) return { splitRe: null, testRe: null };
  const cached = _hlCache.get(raw);
  if (cached) return cached;
  const clean = raw.replace(/^(?:r\/|u\/)/i, "").replace(/^["']|["']$/g, "");
  let entry = { splitRe: null, testRe: null };
  if (clean) {
    try {
      const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = /^\w+$/.test(clean) ? `\\b(${escaped})\\b` : `(${escaped})`;
      entry = {
        splitRe: new RegExp(pattern, "gi"),
        // Non-global test regex: global /g .test() is stateful via lastIndex and skips matches.
        testRe: new RegExp(`^(?:${pattern})$`, "i"),
      };
    } catch {
      entry = { splitRe: null, testRe: null };
    }
  }
  _hlCache.set(raw, entry);
  if (_hlCache.size > 20) {
    const oldest = _hlCache.keys().next().value;
    _hlCache.delete(oldest);
  }
  return entry;
}

// Cache thumbnail URL resolution per post id. getPostThumbnail walks
// preview/media_metadata objects; with stable ids this avoids redoing that
// property walk on every parent re-render.
const _thumbCache = new Map();
function getCachedPostThumbnail(post) {
  const key = post?.id || post?.permalink || post?.url;
  if (!key) return getPostThumbnail(post);
  const cached = _thumbCache.get(key);
  if (cached !== undefined) return cached;
  const thumb = getPostThumbnail(post);
  _thumbCache.set(key, thumb);
  if (_thumbCache.size > 300) {
    const oldest = _thumbCache.keys().next().value;
    _thumbCache.delete(oldest);
  }
  return thumb;
}

export const HighlightText = memo(function HighlightText({ text, highlight }) {
  const parts = useMemo(() => {
    if (!text || typeof text !== "string") return null;
    const { splitRe, testRe } = getCachedHighlightRegexes(highlight);
    if (!splitRe) return [text];
    // Reused global regex: reset lastIndex — split/exec advance it.
    splitRe.lastIndex = 0;
    let split;
    try {
      split = text.split(splitRe);
    } catch {
      return [text];
    }
    if (split.length === 1) return [text];
    if (!testRe) return split;
    return split.map((part, i) => ({ part, hit: testRe.test(part), i }));
  }, [text, highlight]);

  if (!parts) return null;
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return parts.map((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry.hit) return entry.part;
    return (
      <mark
        key={entry.i}
        className="bg-[color:var(--warn)]/30 text-[color:var(--text)] font-semibold rounded px-0.5"
      >
        {entry.part}
      </mark>
    );
  });
});

export function isSafeHttpUrl(value) {
  if (typeof value !== "string") return false;
  // Validate the trimmed copy: leading/trailing whitespace (incl. \n) must
  // not smuggle a non-http scheme past the protocol check.
  const s = value.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Callers must render the trimmed copy, not the original: isSafeHttpUrl()
// validates s = value.trim(), so return that trimmed string here.
export function safeHttpUrlTrimmed(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return isSafeHttpUrl(s) ? s : null;
}

// Reddit permalinks are server-encoded paths (e.g. "/r/pics/comments/abc/x/").
// Only accept root-relative paths; anything else (javascript:, data:, absolute
// URLs, backslashes, spaces) falls back to a constructed encoded URL.
// Blocklist also rejects C0 controls + DEL + ZWSP/ZWNJ/ZWJ/bidi isolates +
// BOM, which can smuggle breaks or spoofed text into hrefs.
// NOTE: "//evil.com" stays same-origin — `${REDDIT_BASE}//evil.com` resolves
// to https://www.reddit.com//evil.com (a same-origin path), not a host swap.
function safePermalinkUrl(permalink, fallback) {
  // eslint-disable-next-line no-control-regex -- intentional control + invisible-char blocklist
  const BLOCKED = /[\s\\<>"\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
  if (typeof permalink === "string" && permalink.startsWith("/") && !BLOCKED.test(permalink)) {
    return `${REDDIT_BASE}${permalink}`;
  }
  return fallback;
}

// Archive (Arctic Shift) IDs are bare base36 alphanumerics. Validate before
// interpolating into API URLs — a raw id containing &/?# would inject extra
// query params. Returns true only for /^[A-Za-z0-9]+$/.
function isBareArchiveId(v) {
  return typeof v === "string" && /^[A-Za-z0-9]+$/.test(v);
}

function isPrefixedArchiveId(v, prefix) {
  return typeof v === "string" && v.startsWith(prefix) && isBareArchiveId(v.slice(prefix.length));
}

function subNameOf(item) {
  const prefixed = typeof item?.subreddit_name_prefixed === "string" ? item.subreddit_name_prefixed.replace(/^r\//i, "") : "";
  const bare = typeof item?.subreddit === "string" ? item.subreddit : "";
  return prefixed || bare || "";
}

function subredditHref(item) {
  return `${REDDIT_BASE}/r/${encodeURIComponent(subNameOf(item))}`;
}

export function getPostThumbnail(post) {
  try {
    if (post.preview?.images?.length) {
      const img = post.preview.images[0];
      // Prefer a small resolution for the 70x52 list thumb — full source can be MBs.
      const small = img.resolutions?.[0]?.url || img.resolutions?.[Math.min(1, (img.resolutions?.length || 1) - 1)]?.url;
      const src = small || img.source?.url;
      if (src) {
        const decoded = src.replace(/&amp;/g, "&");
        const safe = safeHttpUrlTrimmed(decoded);
        if (safe) return safe;
      }
    }
  } catch {/* ignore */}
  try {
    if (post.media_metadata) {
      const first = Object.values(post.media_metadata)[0];
      if (first?.s?.u) {
        const decoded = first.s.u.replace(/&amp;/g, "&");
        const safe = safeHttpUrlTrimmed(decoded);
        if (safe) return safe;
      }
    }
  } catch {/* ignore */}
  const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "avif"];
  if (post.url) {
    const raw = String(post.url);
    const clean = raw.split(/[?#]/)[0];
    if (clean && imageExts.includes(clean.split(".").pop()?.toLowerCase())) {
      const safe = safeHttpUrlTrimmed(raw);
      if (safe) return safe;
    }
  }
  return null;
}

export function getCommentImage(comment) {
  try {
    if (comment.media_metadata) {
      const first = Object.values(comment.media_metadata)[0];
      if (first?.s?.u) {
        const decoded = first.s.u.replace(/&amp;/g, "&");
        const safe = safeHttpUrlTrimmed(decoded);
        if (safe) return safe;
      }
    }
  } catch {/* ignore */}
  return null;
}

function tItemUndisplayable() {
  const lang = getLang();
  return translations[lang]?.itemUndisplayable ?? en.itemUndisplayable ?? "This item couldn't be displayed.";
}

export class CardBoundary extends Component {
  state = {
    failed: false,
    prevChildren: undefined
  };
  static getDerivedStateFromError() {
    return {
      failed: true
    };
  }
  static getDerivedStateFromProps(nextProps, prevState) {
    // Only retry after a failure when the child identity itself changes —
    // resetting on any props update re-renders a broken child in a loop.
    if (nextProps.children !== prevState.prevChildren) {
      return { failed: false, prevChildren: nextProps.children };
    }
    return null;
  }
  componentDidCatch() {/* swallow — bad record, nothing to recover */}
  componentDidMount() {
    // Class components can't use the useI18n hook; subscribe directly so a
    // language switch re-renders the fallback text via the module accessor.
    this._unsub = subscribe(() => this.forceUpdate());
  }
  componentWillUnmount() {
    this._unsub?.();
  }
  render() {
    if (this.state.failed) {
      return <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded px-3 py-2.5 text-[12px] text-[color:var(--text-muted)] italic">
                    {tItemUndisplayable()}
                </div>;
    }
    return this.props.children;
  }
}

export function isPost(item) {
  return Object.hasOwn(item, 'title');
}

export function itemType(item) {
  return isPost(item) ? "posts" : "comments";
}

export function getStatus(item, type) {
  const t = type === "all" ? itemType(item) : type;
  const text = t === "posts" ? item.selftext : item.body;
  return {
    removed: text === "[removed]" || t === "posts" && !!item.removed_by_category,
    deleted: text === "[deleted]" || item.author === "[deleted]"
  };
}

export function statusBorderBase({
  removed,
  deleted
}) {
  if (removed) return "border-[color:var(--status-removed)]";
  if (deleted) return "border-[color:var(--status-deleted)]";
  return "border-[color:var(--border-hover)]";
}

export function statusBorderHover({
  removed,
  deleted
}) {
  if (removed) return "hover:border-[color:var(--status-removed)]/50";
  if (deleted) return "hover:border-[color:var(--status-deleted)]/50";
  return "hover:border-[color:var(--text-muted)]";
}

export function statusBorder(status) {
  return `${statusBorderBase(status)} ${statusBorderHover(status)}`;
}

// Single badge base for every status badge: rounded (not rounded-full —
// rounded-full is reserved for flairs/counts), px-1.5 py-0.5, uppercase with
// tracking. All status badges pair it with brightness-75 dark:brightness-125
// (spoiler included) so badge luminance follows the app theme.
export const BADGE = "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide leading-none";

export const StatusBadges = memo(function StatusBadges({
  item,
  type
}) {
  const { t } = useI18n();
  const {
    removed,
    deleted
  } = getStatus(item, type);
  const dist = item.distinguished;
  if (!removed && !deleted && !item.over_18 && !item.spoiler && dist !== "admin" && dist !== "moderator") {
    return null;
  }
  return <>
            {removed && <span className={`${BADGE} text-[color:var(--status-removed)] brightness-75 dark:brightness-125 bg-[color:var(--status-removed)]/10 border border-[color:var(--status-removed)]/20`}>{t("badgeRemoved")}</span>}
            {deleted && <span className={`${BADGE} text-[color:var(--status-deleted)] brightness-75 dark:brightness-125 bg-[color:var(--status-deleted)]/10 border border-[color:var(--status-deleted)]/20`}>{t("badgeDeleted")}</span>}
            {item.over_18 && <span className={`${BADGE} text-[color:var(--accent)] brightness-75 dark:brightness-125 bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20`}>{t("badgeNsfw")}</span>}
            {item.spoiler && <span className={`${BADGE} bg-[color:var(--border)] text-[color:var(--text)] border border-[color:var(--border)] brightness-75 dark:brightness-125`}>{t("badgeSpoiler")}</span>}
            {dist === "admin" && <span className={`${BADGE} text-[color:var(--status-admin)] brightness-75 dark:brightness-125 bg-[color:var(--status-admin)]/10 border border-[color:var(--status-admin)]/20`}>{t("badgeAdmin")}</span>}
            {dist === "moderator" && <span className={`${BADGE} text-[color:var(--status-mod)] brightness-75 dark:brightness-125 bg-[color:var(--status-mod)]/10 border border-[color:var(--status-mod)]/20`}>{t("badgeMod")}</span>}
        </>;
});

export const PostCard = memo(function PostCard({
  post,
  embedded = false,
  highlightTerm = ""
}) {
  const { t, lang } = useI18n();
  const locale = LOCALES[lang] || "en";
  const [userBodyOpen, setUserBodyOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [moreCommentsCount, setMoreComments] = useState(null);
  const commentsAbortRef = useRef(null);
  const thumb = useMemo(() => getCachedPostThumbnail(post), [post]);
  // Image load/error state is keyed by URL, not reset in an effect: a reset
  // effect would also run on React's mount->remount cycle and could wipe a
  // "loaded" flag *after* the image had already loaded, hiding it permanently.
  // Deriving from the current thumb means a new post simply starts unloaded.
  const [loadedThumb, setLoadedThumb] = useState(null);
  const [erroredThumb, setErroredThumb] = useState(null);
  const onThumbLoad = useCallback(() => setLoadedThumb(thumb), [thumb]);
  const onThumbError = useCallback(() => setErroredThumb(thumb), [thumb]);
  const imgLoaded = loadedThumb === thumb && thumb != null;
  const imgError = erroredThumb === thumb && thumb != null;
  const postUrl = useMemo(() => safePermalinkUrl(post.permalink, post.subreddit && post.id ? `${REDDIT_BASE}/r/${encodeURIComponent(String(post.subreddit))}/comments/${encodeURIComponent(String(post.id))}` : REDDIT_BASE), [post]);
  const hasBody = useMemo(() => post.selftext && post.selftext !== "[deleted]" && post.selftext !== "[removed]", [post]);
  const status = useMemo(() => getStatus(post, "posts"), [post]);

  const hasMatchInBody = useMemo(() => {
    if (!hasBody || !highlightTerm) return false;
    const clean = highlightTerm.trim().toLowerCase().replace(/^(?:r\/|u\/)/i, "").replace(/^["']|["']$/g, "");
    return clean ? (post.selftext || "").toLowerCase().includes(clean) : false;
  }, [hasBody, highlightTerm, post.selftext]);

  const bodyOpen = userBodyOpen || hasMatchInBody;

  useEffect(() => () => { if (commentsAbortRef.current) commentsAbortRef.current.abort(); }, []);
  const handleLoadComments = useCallback(async () => {
    if (commentsLoading) return;
    // Validate archive id before interpolating — skip fetch when invalid.
    if (!isBareArchiveId(post.id)) return;
    if (commentsAbortRef.current) commentsAbortRef.current.abort();
    const ctrl = new AbortController();
    commentsAbortRef.current = ctrl;
    setCommentsLoading(true);
    try {
      const res = await safeFetch(`${ARCTIC}/api/comments/tree?link_id=t3_${encodeURIComponent(post.id)}&limit=25`, { signal: ctrl.signal });
      const data = res.data || [];
      const list = [];
      let more = null;
      for (const item of data) {
        if (item.kind === "t1") list.push(item.data);else if (item.kind === "more") more = item.data?.count ?? null;
      }
      setComments(list);
      setMoreComments(more);
    } catch {
      setComments([]);
    }
    setCommentsLoading(false);
  }, [commentsLoading, post.id]);
  const copyText = useCallback(() => {
    const flag = status.removed ? " [removed]" : status.deleted ? " [deleted]" : "";
    // Clipboard/copy stays locale-less by design: ISO timestamp + raw
    // fmtNum (no locale) keep pasted text machine-readable across locales.
    const ts = post.created_utc != null ? new Date(post.created_utc * 1000).toISOString() : "";
    return [
      post.title,
      `u/${post.author} · ${post.subreddit_name_prefixed || `r/${post.subreddit}`} · ${ts} · ${fmtNum(post.score)} pts${flag}`,
      postUrl,
      post.selftext ? `\n${post.selftext}` : "",
    ].filter(Boolean).join("\n");
  }, [post, status, postUrl]);
return <>
            <div className={`bg-[color:var(--bg-elevated)] border ${statusBorder(status)} rounded overflow-hidden transition-all duration-150 hover:shadow-lg group`}>
                <div className="flex">
                    <div className="flex flex-col items-center justify-start gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                        <IconArrowUp />
                        <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(post.score, locale)}</span>
                    </div>
                    <div className="flex-1 p-3 min-w-0 relative">
                        <div className="flex gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-muted)] mb-1.5 flex-wrap">
                                    <a href={subredditHref(post)} target="_blank" rel="noopener noreferrer" className="relative z-10 font-medium text-[color:var(--text)] hover:underline">
                                        {post.subreddit_name_prefixed || `r/${post.subreddit}`}
                                    </a>
                                    <span>·</span>
                                    <a href={postUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 hover:underline">
                                        <HoverTime utc={post.created_utc} />
                                    </a>
                                    <StatusBadges item={post} type="posts" />
                                    {post.link_flair_text && <>
                                            <span>·</span>
                                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[color:var(--border)] text-[color:var(--text)] border border-[color:var(--border-hover)]">
                                            {post.link_flair_text}
                                        </span>
                                        </>}
                                </div>
                                <div className="relative z-10">
                                    <p className="text-sm font-medium text-[color:var(--text)] leading-snug mb-1.5 transition-colors break-words">
                                        <HighlightText text={post.title} highlight={highlightTerm} />
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] text-[color:var(--text-muted)] mt-1">
                                    <button onClick={e => {
                    e.preventDefault();
                    if (!comments) handleLoadComments();
                  }} disabled={commentsLoading} className="relative z-10 flex items-center gap-1 hover:text-[color:var(--text)] transition-colors disabled:opacity-50 cursor-pointer">
                                        <IconComment />{embedded ? tN(t, "commentsCount", post.num_comments ?? 0, lang) : tN(t, "showCommentsCount", post.num_comments ?? 0, lang)}
                                    </button>
                                    <a href={postUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 flex items-center gap-1 text-[color:var(--accent-text)] hover:underline truncate max-w-[200px]">
                                        <IconExternal /><span className="truncate">{post.domain || post.subreddit_name_prefixed || `r/${post.subreddit}`}</span>
                                    </a>
                                    {hasBody && <button aria-label={bodyOpen ? t("hideBody") : t("showBody")} aria-expanded={bodyOpen} onClick={e => {
                    e.preventDefault();
                    setUserBodyOpen(o => !o);
                  }} className="relative z-10 flex items-center gap-1 text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors">
                                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${bodyOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                                {bodyOpen ? t("hideBody") : t("showBody")}
                                            </button>}
                                    <div className="relative z-10">
                                      <CopyButton getText={copyText} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col items-end justify-between gap-1 flex-shrink-0 self-stretch relative z-10">
                                {thumb && isSafeHttpUrl(thumb) && !imgError && <HoverHint hint={t("openImage")} className="self-end">
                                    <button type="button" aria-label={t("openImage")} onClick={e => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (isSafeHttpUrl(thumb)) window.open(thumb, "_blank", "noopener,noreferrer");
                                    }} className={`relative flex items-center justify-center w-[70px] h-[52px] rounded overflow-hidden bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] cursor-zoom-in transition-opacity ${imgLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                                        <img src={thumb} alt="" width="70" height="52" className={`absolute inset-0 w-full h-full object-cover aspect-[70/52] transition-opacity ${imgLoaded ? 'opacity-100' : 'opacity-0'}`} loading="lazy" decoding="async" onLoad={onThumbLoad} onError={onThumbError} />
                                    </button>
                                </HoverHint>}
                            </div>
                        </div>
                    </div>
                </div>

                {hasBody && bodyOpen && <div className="border-t border-[color:var(--border)] px-4 pt-3 pb-3 ml-[44px]">
                        <p className="text-[12px] text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words">
                            <HighlightText text={post.selftext} highlight={highlightTerm} />
                        </p>
                    </div>}

                {!embedded && (commentsLoading || comments !== null) && <div className="border-t border-[color:var(--border)]">
                        {commentsLoading ? <div className="flex items-center gap-2 px-3 py-3 text-[color:var(--text-muted)]">
                                <IconSpinner />
                                <span className="text-[11px]">{t("loadingLower")}</span>
                            </div> : comments.length === 0 ? <p className="text-[11px] text-[color:var(--text-muted)] italic px-3 py-2">{t("noReplies")}</p> : <div className="flex flex-col gap-0">
                                <div className="px-3 py-1.5 text-[11px] text-[color:var(--text-muted)]">
                                    {tN(t, "commentsCount", comments.length, lang)}
                                    {moreCommentsCount > 0 ? ` · ${t("moreNotShown", { n: fmtNum(moreCommentsCount, locale) })}` : ""}
                                </div>
                                <div className="flex flex-col gap-2 px-3 pb-3">
                                    {comments.map(c => <CommentCard key={c.id} comment={c} skipPostLoad={true} highlightTerm={highlightTerm} />)}
                                </div>
                            </div>}
                    </div>}
            </div>
        </>;
});

export const ParentChain = memo(function ParentChain({
  parentId,
  depth = 0
}) {
  const { t, lang } = useI18n();
  const locale = LOCALES[lang] || "en";
  const [comment, setComment] = useState(null);
  const [loading, setLoading] = useState(false);
  const parentAbortRef = useRef(null);
  useEffect(() => () => { if (parentAbortRef.current) parentAbortRef.current.abort(); }, []);
  // Strict prefixed-id gate: bare part must be alphanumerics only, otherwise
  // the value is never interpolated into the ids= query.
  if (!isPrefixedArchiveId(parentId, "t1_")) return null;
  if (depth >= 8) return <div className="border-b border-[color:var(--border)] px-3 py-1.5">
            <span className="text-[11px] text-[color:var(--text-faint)]">…</span>
        </div>;
  async function handleLoad() {
    if (loading || comment) return;
    if (!isPrefixedArchiveId(parentId, "t1_")) return;
    if (parentAbortRef.current) parentAbortRef.current.abort();
    const ctrl = new AbortController();
    parentAbortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await safeFetch(`${ARCTIC}/api/comments/ids?ids=${encodeURIComponent(parentId)}`, { signal: ctrl.signal });
      if (res.data?.[0]) setComment(res.data[0]);
    } catch {/* ignore */}
    setLoading(false);
  }
  return <div className="border-b border-[color:var(--border)]">
            {comment && <ParentChain parentId={comment.parent_id} depth={depth + 1} />}

            {comment ? (
    <div className="flex opacity-80">
                    <div className="w-5 bg-[color:var(--bg)] flex-shrink-0" />
                    <div className="flex flex-col items-center justify-start gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                        <IconArrowUp />
                        <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(comment.score, locale)}</span>
                    </div>
                    <div className="flex-1 px-3 py-2.5 min-w-0">
                        <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-muted)] mb-1 flex-wrap">
                            <a href={subredditHref(comment)} target="_blank" rel="noopener noreferrer" className="font-medium text-[color:var(--text)] hover:underline">
                                {comment.subreddit_name_prefixed || `r/${comment.subreddit}`}
                            </a>
                            <span>{t("by")}</span>
                            <a href={`${REDDIT_BASE}/u/${encodeURIComponent(String(comment.author ?? ""))}`} target="_blank" rel="noopener noreferrer" className="text-[color:var(--text)] hover:underline">
                                u/{comment.author}
                            </a>
                            <span>·</span>
                            <HoverTime utc={comment.created_utc} />
                        </div>
                        <p className="text-sm text-[color:var(--text-muted)] leading-relaxed line-clamp-3 whitespace-pre-wrap break-words">
                            {comment.body || t("noContent")}
                        </p>
                    </div>
                </div>) : (<div className="px-3 py-1.5">
                    <button onClick={handleLoad} disabled={loading} className="flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--border)] rounded px-2 py-0.5 transition-all disabled:opacity-50">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                        {loading ? t("loadingLower") : t("loadParent")}
                    </button>
                </div>)}
        </div>;
});

export const CommentCard = memo(function CommentCard({
  comment,
  isNested = false,
  skipPostLoad = false,
  highlightTerm = ""
}) {
  const { t, lang } = useI18n();
  const locale = LOCALES[lang] || "en";
  const [collapsed, setCollapsed] = useState(false);
  const [lineHovered, setLineHovered] = useState(false);
  // URL-keyed image state (see PostCard): deriving from the current `img`
  // avoids a reset effect wiping a loaded flag after the image decoded.
  const [loadedImg, setLoadedImg] = useState(null);
  const [erroredImg, setErroredImg] = useState(null);
  const [post, setPost] = useState(null);
  const [replies, setReplies] = useState(null);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [moreCount, setMoreCount] = useState(null);
  const repliesAbortRef = useRef(null);
  useEffect(() => () => { if (repliesAbortRef.current) repliesAbortRef.current.abort(); }, []);
  const threadId = isPrefixedArchiveId(comment.link_id, "t3_") ? comment.link_id.slice(3) : null;
  const url = useMemo(() => safePermalinkUrl(comment.permalink, null), [comment]);
  const threadUrl = useMemo(() => threadId && isBareArchiveId(threadId) ? `${REDDIT_BASE}/comments/${encodeURIComponent(threadId)}` : url, [threadId, url]);
  const img = useMemo(() => getCommentImage(comment), [comment]);
  const imgLoaded = loadedImg === img && img != null;
  const imgError = erroredImg === img && img != null;
  const onImgLoad = useCallback(() => setLoadedImg(img), [img]);
  const onImgError = useCallback(() => setErroredImg(img), [img]);
  const status = useMemo(() => getStatus(comment, "comments"), [comment]);
  const toggleCollapsed = useCallback(() => setCollapsed(o => !o), []);
  const onLineEnter = useCallback(() => setLineHovered(true), []);
  const onLineLeave = useCallback(() => setLineHovered(false), []);
  useEffect(() => {
    if (!threadId || !isBareArchiveId(threadId) || isNested || skipPostLoad) return;
    const ctrl = new AbortController();
    safeFetch(`${ARCTIC}/api/posts/ids?ids=${encodeURIComponent(threadId)}`, { signal: ctrl.signal }).then(res => {
      if (res.data?.[0]) setPost(res.data[0]);
    }).catch(() => {});
    return () => ctrl.abort();
  }, [threadId, isNested, skipPostLoad]);
  const handleLoadReplies = useCallback(async () => {
    if (!comment.link_id || !comment.id || repliesLoading) return;
    if (!isPrefixedArchiveId(comment.link_id, "t3_") || !isBareArchiveId(comment.id)) return;
    if (repliesAbortRef.current) repliesAbortRef.current.abort();
    const ctrl = new AbortController();
    repliesAbortRef.current = ctrl;
    setRepliesLoading(true);
    try {
      const res = await safeFetch(`${ARCTIC}/api/comments/tree?link_id=${encodeURIComponent(comment.link_id)}&parent_id=t1_${encodeURIComponent(comment.id)}&limit=25`, { signal: ctrl.signal });
      const data = res.data || [];
      const parentItem = data.find(item => item.kind === "t1" && item.data?.id === comment.id);
      const childObjs = parentItem?.data?.replies?.data?.children || [];
      const children = [];
      let more = null;
      for (const c of childObjs) {
        if (c.kind === "t1") children.push(c.data);else if (c.kind === "more") more = c.data?.count ?? null;
      }
      setReplies(children);
      setMoreCount(more);
    } catch {
      setReplies([]);
    }
    setRepliesLoading(false);
  }, [comment.link_id, comment.id, repliesLoading]);
  const copyText = useCallback(() => {
    const flag = status.removed ? " [removed]" : status.deleted ? " [deleted]" : "";
    // Clipboard/copy stays locale-less by design: ISO timestamp + raw
    // fmtNum (no locale) keep pasted text machine-readable across locales.
    const ts = comment.created_utc != null ? new Date(comment.created_utc * 1000).toISOString() : "";
    return [
      `Comment on: ${comment.link_title || "Post"}`,
      `u/${comment.author} · ${comment.subreddit_name_prefixed || `r/${comment.subreddit}`} · ${ts} · ${fmtNum(comment.score)} pts${flag}`,
      url,
      comment.body ? `\n${comment.body}` : "",
    ].filter(Boolean).join("\n");
  }, [comment, status, url]);
  // Cards use bg-elevated; nested replies keep bg so the thread hierarchy
  // reads against the elevated parent card (documented bg exception).
  return <div className={`${isNested ? "bg-[color:var(--bg)]" : "bg-[color:var(--bg-elevated)]"} border ${statusBorderBase(status)} rounded overflow-hidden transition-all duration-150 ${!isNested ? `${statusBorderHover(status)} hover:shadow-lg` : ""}`}>

            {post && <div className="border-b border-[color:var(--border-hover)]">
                    <PostCard post={post} embedded={true} highlightTerm={highlightTerm} />
                </div>}

            {!isNested && <ParentChain parentId={comment.parent_id} />}

            <div className="flex">
                <button aria-label={collapsed ? t("expandComment") : t("collapseComment")} aria-expanded={!collapsed} onClick={toggleCollapsed} onMouseEnter={onLineEnter} onMouseLeave={onLineLeave} className="relative flex-shrink-0 w-5 bg-[color:var(--bg)] transition-colors">
                    <svg className="absolute inset-x-0 top-0 w-full" style={{ height: collapsed ? 'calc(100% - 8px)' : '100%' }} fill="none">
                        <line x1="10.75" y1="8" x2="10.75" y2="100%"
                            stroke={collapsed ? "var(--accent)" : lineHovered ? "var(--text-muted)" : "var(--border-hover)"}
                            strokeWidth="2" strokeLinecap="round"
                            style={STROKE_TRANSITION} />
                    </svg>
                </button>

                <div className="flex flex-col items-center justify-start gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                    <IconArrowUp />
                    <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(comment.score, locale)}</span>
                </div>

                <div className="flex-1 p-3 min-w-0 relative">
                    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-0" aria-hidden="true" tabIndex={-1} />}
                    <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-muted)] mb-1.5 flex-wrap">
                        <a href={subredditHref(comment)} target="_blank" rel="noopener noreferrer" className="relative z-10 font-medium text-[color:var(--text)] hover:underline">
                            {comment.subreddit_name_prefixed || `r/${comment.subreddit}`}
                        </a>
                        <span>{t("by")}</span>
                        <a href={`${REDDIT_BASE}/u/${encodeURIComponent(String(comment.author ?? ""))}`} target="_blank" rel="noopener noreferrer" className="relative z-10 text-[color:var(--text)] hover:underline">
                            u/{comment.author}
                        </a>
                        <span>·</span>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="relative z-10 hover:underline">
                            <HoverTime utc={comment.created_utc} />
                        </a>
                        <StatusBadges item={comment} type="comments" />
                        <span>·</span>
                        <a href={threadUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 text-[color:var(--accent-text)] hover:underline flex items-center gap-0.5">
                            {t("viewThread")} <IconExternal />
                        </a>
                        <span>·</span>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="relative z-10 text-[color:var(--accent-text)] hover:underline flex items-center gap-0.5">
                            {t("viewComment")} <IconExternal />
                        </a>
                        <span>·</span>
                        <div className="relative z-10">
                        <CopyButton getText={copyText} />
                        </div>
                    </div>

                    {!collapsed && <>
                            {status.removed || status.deleted ? <p className="text-sm text-[color:var(--text-muted)] italic leading-relaxed relative z-10">
                                    {status.removed ? t("removedText") : t("deletedText")}
                                </p> : <p className="text-sm text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words relative z-10">
                                    <HighlightText text={comment.body || t("noContent")} highlight={highlightTerm} />
                                </p>}
                            {img && isSafeHttpUrl(img) && <HoverHint hint={t("openImage")} className="inline-block mt-2 relative z-10">
                                    <a href={img} target="_blank" rel="noopener noreferrer" aria-label={t("openImage")} className={`relative flex items-center justify-center w-24 h-16 rounded overflow-hidden bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] cursor-zoom-in transition-opacity ${imgError || imgLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                                        <img src={img} alt="" width="96" height="64" className={`absolute inset-0 w-full h-full object-cover transition-opacity ${imgError ? 'opacity-0' : 'opacity-100'}`} loading="lazy" onLoad={onImgLoad} onError={onImgError} />
                                        {imgError && <IconExternal className="w-4 h-4 text-[color:var(--text-muted)] opacity-50 pointer-events-none" />}
                                    </a>
                                </HoverHint>}
                        </>}
                </div>
            </div>

            {!collapsed && <>
                    {!replies && <div className="flex items-center py-1.5" style={{
        paddingLeft: 9
      }}>
                            <button aria-label={t("collapseComment")} onClick={toggleCollapsed} onMouseEnter={onLineEnter} onMouseLeave={onLineLeave} className="flex-shrink-0 -mt-[14px] bg-transparent border-0 p-0 cursor-pointer">
                                <svg width="22" height="32" viewBox="0 0 22 32" fill="none" className="overflow-visible">
                                    {/* Horizontal run extends past the viewBox (overflow-visible) so it
                                        passes under the circle button — its opaque bg masks the excess,
                                        guaranteeing the line always meets the ring with no seam. */}
                                    <path d="M 1 0 L 1 16 Q 1 23 8 23 L 28 23" stroke={lineHovered ? "var(--text-muted)" : "var(--border-hover)"} strokeWidth={2} fill="none" style={STROKE_TRANSITION} />
                                </svg>
                            </button>
                            <button onClick={handleLoadReplies} disabled={repliesLoading} aria-label={t("loadReplies")} className="relative w-[18px] h-[18px] rounded-full border-2 border-[color:var(--border)] bg-[color:var(--bg)] flex items-center justify-center text-[color:var(--text-muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--text)] transition-all disabled:opacity-40 flex-shrink-0 -ml-[1px]">
                                {repliesLoading ? <span className="text-[9px] leading-none">…</span> : <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                        <line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                        <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>}
                            </button>
                        </div>}

                    {replies && <div className="flex" style={{
        paddingLeft: 9
      }}>
                            <div className="flex-shrink-0 w-5 relative" style={{
          marginTop: -14
        }}>
                                <div className="absolute" style={{
            left: 0,
            top: 0,
            bottom: 0,
            width: "1.5px",
            background: "var(--border-hover)"
          }} />
                            </div>
                            <div className="flex-1 min-w-0">
                                {replies.length > 0 ? <div className="flex flex-col gap-2 py-1.5 pr-2">
                                        {replies.map(reply => <div key={reply.id} className="flex items-start">
                                                <svg width="14" height="44" viewBox="0 0 14 44" fill="none" className="flex-shrink-0 self-start" style={{
                marginTop: 19,
                marginLeft: -20,
                color: "var(--border-hover)"
              }}>
                                                    <path d="M 1 0 Q 1 7 8 7 L 14 7" stroke="currentColor" strokeWidth={2} fill="none" />
                                                </svg>
                                                <div className="flex-1 min-w-0">
                                                    <CommentCard comment={reply} isNested={true} highlightTerm={highlightTerm} />
                                                </div>
                                            </div>)}
                                    </div> : <div className="flex items-center py-2">
                                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0" style={{
              marginLeft: -20,
              color: "var(--border-hover)"
            }}>
                                            <path d="M 1 0 Q 1 7 8 7 L 14 7" stroke="currentColor" strokeWidth={2} fill="none" />
                                        </svg>
<p className="text-[11px] text-[color:var(--text-muted)] italic">{t("noReplies")}</p>
</div>}
                                {moreCount > 0 && <p className="text-[11px] text-[color:var(--text-muted)] pl-1 pb-2">{tN(t, "moreReplies", moreCount, lang)}</p>}
                            </div>
                        </div>}
                </>}
        </div>;
});
