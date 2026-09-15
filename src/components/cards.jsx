/* eslint-disable react-refresh/only-export-components -- shared module: cards + status/thumbnail helpers (by design) */
import { memo, useState, useMemo, useCallback, useEffect, useRef, Component } from "react";
import { safeFetch, ARCTIC, REDDIT_BASE } from "../api.js";
import { useI18n, tN } from "../i18n.js";
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
function getCachedHighlightRegexes(highlight) {
  const raw = typeof highlight === "string" ? highlight.trim() : "";
  if (!raw) return { splitRe: null, testRe: null };
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
        className="bg-amber-400/30 text-[color:var(--text)] font-semibold rounded-[2px] px-0.5"
      >
        {entry.part}
      </mark>
    );
  });
});

export function getPostThumbnail(post) {
  try {
    if (post.preview?.images?.length) {
      const img = post.preview.images[0];
      // Prefer a small resolution for the 70x52 list thumb — full source can be MBs.
      const small = img.resolutions?.[0]?.url || img.resolutions?.[Math.min(1, (img.resolutions?.length || 1) - 1)]?.url;
      const src = small || img.source?.url;
      if (src) return src.replace(/&amp;/g, "&");
    }
  } catch {/* ignore */}
  try {
    if (post.media_metadata) {
      const first = Object.values(post.media_metadata)[0];
      if (first?.s?.u) return first.s.u.replace(/&amp;/g, "&");
    }
  } catch {/* ignore */}
  const imageExts = ["jpg", "jpeg", "png", "gif"];
  if (post.url && imageExts.includes(post.url.split(".").pop()?.toLowerCase())) return post.url;
  return null;
}

export function getCommentImage(comment) {
  try {
    if (comment.media_metadata) {
      const first = Object.values(comment.media_metadata)[0];
      if (first?.s?.u) return first.s.u.replace(/&amp;/g, "&");
    }
  } catch {/* ignore */}
  return null;
}

export class CardBoundary extends Component {
  state = {
    failed: false
  };
  static getDerivedStateFromError() {
    return {
      failed: true
    };
  }
  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.failed) return { failed: false };
    return null;
  }
  componentDidCatch() {/* swallow — bad record, nothing to recover */}
  render() {
    if (this.state.failed) {
      return <div className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-3 py-2.5 text-[12px] text-[color:var(--text-muted)] italic">
                    This item couldn't be displayed.
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
            {item.over_18 && <span className={`${BADGE} text-[color:var(--accent)] brightness-75 dark:brightness-125 bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20`}>NSFW</span>}
            {item.spoiler && <span className={`${BADGE} bg-[color:var(--border)] text-[color:var(--text)] border border-[color:var(--border)]`}>{t("badgeSpoiler")}</span>}
            {dist === "admin" && <span className={`${BADGE} text-[color:var(--status-mod)] brightness-75 dark:brightness-125 bg-[color:var(--status-mod)]/10 border border-[color:var(--status-mod)]/20`}>Admin</span>}
            {dist === "moderator" && <span className={`${BADGE} text-[color:var(--accent-text)] brightness-90 dark:brightness-125 bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20`}>Mod</span>}
        </>;
});

export const PostCard = memo(function PostCard({
  post,
  embedded = false,
  highlightTerm = ""
}) {
  const { t } = useI18n();
  const [userBodyOpen, setUserBodyOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [moreCommentsCount, setMoreComments] = useState(null);
  const [imgError, setImgError] = useState(false);
  const commentsAbortRef = useRef(null);
  const thumb = useMemo(() => getCachedPostThumbnail(post), [post]);
  const postUrl = useMemo(() => post.permalink ? `${REDDIT_BASE}${post.permalink}` : `${REDDIT_BASE}/r/${post.subreddit}/comments/${post.id}`, [post]);
  const hasBody = useMemo(() => post.selftext && post.selftext !== "[deleted]" && post.selftext !== "[removed]", [post]);
  const status = useMemo(() => getStatus(post, "posts"), [post]);

  const hasMatchInBody = useMemo(() => {
    if (!hasBody || !highlightTerm) return false;
    const clean = highlightTerm.trim().toLowerCase().replace(/^(?:r\/|u\/)/i, "").replace(/^["']|["']$/g, "");
    return clean ? (post.selftext || "").toLowerCase().includes(clean) : false;
  }, [hasBody, highlightTerm, post.selftext]);

  const bodyOpen = userBodyOpen || hasMatchInBody;

  // Tap on the card toggles the body instead of opening the permalink.
  // Clicks that land on real links/buttons keep their own behavior.
  const handleCardClick = useCallback(e => {
    if (e.target.closest("a, button, [role='button']")) return;
    if (hasBody) setUserBodyOpen(o => !o);
  }, [hasBody]);
  useEffect(() => () => { if (commentsAbortRef.current) commentsAbortRef.current.abort(); }, []);
  useEffect(() => { setImgError(false); }, [post]);
  const handleLoadComments = useCallback(async () => {
    if (commentsLoading) return;
    if (commentsAbortRef.current) commentsAbortRef.current.abort();
    const ctrl = new AbortController();
    commentsAbortRef.current = ctrl;
    setCommentsLoading(true);
    try {
      const res = await safeFetch(`${ARCTIC}/api/comments/tree?link_id=t3_${post.id}&limit=25`, { signal: ctrl.signal });
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
    const ts = post.created_utc != null ? new Date(post.created_utc * 1000).toISOString() : "";
    return [
      post.title,
      `u/${post.author} · ${post.subreddit_name_prefixed || `r/${post.subreddit}`} · ${ts} · ${fmtNum(post.score)} pts${flag}`,
      postUrl,
      post.selftext ? `\n${post.selftext}` : "",
    ].filter(Boolean).join("\n");
  }, [post, status, postUrl]);
return <>
            <div onClick={handleCardClick} role={hasBody ? "button" : undefined} tabIndex={hasBody ? 0 : undefined} aria-expanded={hasBody ? bodyOpen : undefined} onKeyDown={hasBody ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setUserBodyOpen(o => !o); } }) : undefined} className={`bg-[color:var(--bg-elevated)] border ${statusBorder(status)} rounded overflow-hidden transition-all duration-150 hover:shadow-lg group ${hasBody ? "cursor-pointer" : ""}`}>
                <div className="flex">
                    <div className="flex flex-col items-center justify-start gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                        <IconArrowUp />
                        <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(post.score)}</span>
                    </div>
                    <div className="flex-1 p-3 min-w-0 relative">
                        <div className="flex gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mb-1.5 flex-wrap">
                                    <a href={`${REDDIT_BASE}/${post.subreddit_name_prefixed || `r/${post.subreddit}`}`} target="_blank" rel="noopener noreferrer" className="relative z-10 font-medium text-[color:var(--text)] hover:underline">
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
                                        <IconComment />{embedded ? t("commentsCount", { n: fmtNum(post.num_comments) }) : t("showCommentsCount", { n: fmtNum(post.num_comments) })}
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
                                {thumb && !imgError && <HoverHint hint={t("openImage")} className="self-end">
                                    <div role="button" tabIndex={0} onClick={e => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        window.open(thumb, "_blank", "noopener,noreferrer");
                                    }} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window.open(thumb, "_blank", "noopener,noreferrer"); } }} className="relative flex items-center justify-center w-[70px] h-[52px] rounded overflow-hidden bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] cursor-zoom-in">
                                        <img src={thumb} alt="" width="70" height="52" className="absolute inset-0 w-full h-full object-cover aspect-[70/52]" loading="lazy" decoding="async" onError={() => setImgError(true)} />
                                    </div>
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
                                    {t("commentsCount", { n: comments.length })}
                                    {moreCommentsCount > 0 ? ` · ${t("moreNotShown", { n: moreCommentsCount })}` : ""}
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
  const { t } = useI18n();
  const [comment, setComment] = useState(null);
  const [loading, setLoading] = useState(false);
  const parentAbortRef = useRef(null);
  useEffect(() => () => { if (parentAbortRef.current) parentAbortRef.current.abort(); }, []);
  if (typeof parentId !== "string" || !parentId.startsWith("t1_")) return null;
  if (depth >= 8) return <div className="border-b border-[color:var(--border)] px-3 py-1.5">
            <span className="text-[11px] text-[color:var(--text-faint)]">…</span>
        </div>;
  async function handleLoad() {
    if (loading || comment) return;
    if (parentAbortRef.current) parentAbortRef.current.abort();
    const ctrl = new AbortController();
    parentAbortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await safeFetch(`${ARCTIC}/api/comments/ids?ids=${parentId}`, { signal: ctrl.signal });
      if (res.data?.[0]) setComment(res.data[0]);
    } catch {/* ignore */}
    setLoading(false);
  }
  return <div className="border-b border-[color:var(--border)]">
            {comment && <ParentChain parentId={comment.parent_id} depth={depth + 1} />}

            {comment ? (
    <div className="flex opacity-80">
                    <div className="w-5 bg-[color:var(--bg)] flex-shrink-0" />
                    <div className="flex flex-col items-center justify-start gap-1 px-2.5 py-2.5 bg-[color:var(--bg)] min-w-[44px]">
                        <IconArrowUp />
                        <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(comment.score)}</span>
                    </div>
                    <div className="flex-1 px-3 py-2.5 min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mb-1 flex-wrap">
                            <a href={`${REDDIT_BASE}/r/${comment.subreddit}`} target="_blank" rel="noopener noreferrer" className="font-medium text-[color:var(--text)] hover:underline">
                                {comment.subreddit_name_prefixed || `r/${comment.subreddit}`}
                            </a>
                            <span>{t("by")}</span>
                            <a href={`${REDDIT_BASE}/u/${comment.author}`} target="_blank" rel="noopener noreferrer" className="text-[color:var(--text)] hover:underline">
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
  const [collapsed, setCollapsed] = useState(false);
  const [lineHovered, setLineHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [post, setPost] = useState(null);
  const [replies, setReplies] = useState(null);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [moreCount, setMoreCount] = useState(null);
  const repliesAbortRef = useRef(null);
  useEffect(() => () => { if (repliesAbortRef.current) repliesAbortRef.current.abort(); }, []);
  const threadId = comment.link_id?.replace(/^t3_/, "");
  const url = useMemo(() => `${REDDIT_BASE}${comment.permalink}`, [comment]);
  const threadUrl = useMemo(() => threadId ? `${REDDIT_BASE}/comments/${threadId}` : url, [threadId, url]);
  const img = useMemo(() => getCommentImage(comment), [comment]);
  const status = useMemo(() => getStatus(comment, "comments"), [comment]);
  const toggleCollapsed = useCallback(() => setCollapsed(o => !o), []);
  const onLineEnter = useCallback(() => setLineHovered(true), []);
  const onLineLeave = useCallback(() => setLineHovered(false), []);
  const onImgError = useCallback(() => setImgError(true), []);
  useEffect(() => {
    if (!threadId || isNested || skipPostLoad) return;
    const ctrl = new AbortController();
    safeFetch(`${ARCTIC}/api/posts/ids?ids=${threadId}`, { signal: ctrl.signal }).then(res => {
      if (res.data?.[0]) setPost(res.data[0]);
    }).catch(() => {});
    return () => ctrl.abort();
  }, [threadId, isNested, skipPostLoad]);
  const handleLoadReplies = useCallback(async () => {
    if (!comment.link_id || repliesLoading) return;
    if (repliesAbortRef.current) repliesAbortRef.current.abort();
    const ctrl = new AbortController();
    repliesAbortRef.current = ctrl;
    setRepliesLoading(true);
    try {
      const res = await safeFetch(`${ARCTIC}/api/comments/tree?link_id=${comment.link_id}&parent_id=t1_${comment.id}&limit=25`, { signal: ctrl.signal });
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
    const ts = comment.created_utc != null ? new Date(comment.created_utc * 1000).toISOString() : "";
    return [
      `Comment on: ${comment.link_title || "Post"}`,
      `u/${comment.author} · ${comment.subreddit_name_prefixed || `r/${comment.subreddit}`} · ${ts} · ${fmtNum(comment.score)} pts${flag}`,
      url,
      comment.body ? `\n${comment.body}` : "",
    ].filter(Boolean).join("\n");
  }, [comment, status, url]);
  return <div className={`bg-[color:var(--bg)] border ${statusBorderBase(status)} rounded overflow-hidden transition-all duration-150 ${!isNested ? `${statusBorderHover(status)} hover:shadow-lg` : ""}`}>

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
                    <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(comment.score)}</span>
                </div>

                <div className="flex-1 p-3 min-w-0 relative">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-0" aria-hidden="true" tabIndex={-1} />
                    <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mb-1.5 flex-wrap">
                        <a href={`${REDDIT_BASE}/r/${comment.subreddit}`} target="_blank" rel="noopener noreferrer" className="relative z-10 font-medium text-[color:var(--text)] hover:underline">
                            {comment.subreddit_name_prefixed || `r/${comment.subreddit}`}
                        </a>
                        <span>{t("by")}</span>
                        <a href={`${REDDIT_BASE}/u/${comment.author}`} target="_blank" rel="noopener noreferrer" className="relative z-10 text-[color:var(--text)] hover:underline">
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
                            {img && <HoverHint hint={t("openImage")} className="inline-block mt-2 relative z-10">
                                    <a href={img} target="_blank" rel="noopener noreferrer" className="relative flex items-center justify-center w-24 h-16 rounded overflow-hidden bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] cursor-zoom-in">
                                        <img src={img} alt={t("openImage")} width="96" height="64" className={`absolute inset-0 w-full h-full object-cover transition-opacity ${imgError ? 'opacity-0' : 'opacity-100'}`} loading="lazy" onError={onImgError} />
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
                                {replies.length > 0 ? <div className="flex flex-col gap-1.5 py-1.5 pr-2">
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
