import { safeFetch, fetchBoth, REDDIT_BASE, ARCTIC, LIMIT } from "./api";
import { downloadFile, normalizeUsername } from "./utils";
import { getSavedUsernames } from "./profileData.js";
import { useI18n, LANGS, LOCALES, setLang, relTime, tN } from "./i18n.js";

import { useState, useCallback, useEffect, useMemo, Component, memo, useRef, lazy, Suspense, useDeferredValue } from "react";
import { createPortal } from "react-dom";

const NO_DECORATION = { textDecoration: 'none' };
const STROKE_TRANSITION = { transition: "stroke 150ms" };
const FLEX_1 = { flex: "1 1 0" };
const closeOnEscape = e => { if (e.key === "Escape") e.currentTarget.removeAttribute("open"); };

// ─── Helpers ───────

function tJsx(tFn, key, vars) {
  const raw = tFn(key);
  if (!vars) return raw;
  const names = Object.keys(vars).join('|');
  const parts = raw.split(new RegExp(`\\{(${names})\\}`, 'g'));
  return parts.map((part, i) => i % 2 === 0 ? part : vars[part]);
}

function fullTimestamp(utc, lang) {
  // Reddit created_utc is UTC seconds; rendered in the viewer's local timezone
  // and in the active UI language's date order (day/month vary per locale).
  return new Date(utc * 1000).toLocaleString(LOCALES[lang] || "en", {
    dateStyle: "medium",
    timeStyle: "long"
  });
}

// Relative date ("3d ago", locale-aware) with the exact time in a hover
// tooltip. Uses the portal-based HoverHint so the tooltip paints above ALL
// card content — an in-card absolute tooltip sits inside the timestamp link's
// z-10 stacking context, and later same-z siblings (the title) paint over it.
const HoverTime = memo(function HoverTime({
  utc
}) {
  const { lang } = useI18n();
  return <HoverHint className="inline-block" hint={fullTimestamp(utc, lang)}>
            {relTime(utc, lang)}
        </HoverHint>;
});

// Wraps a component and shows a hint that follows the cursor. Uses a
// fixed-position tooltip so it appears instantly at the pointer and isn't
// clipped by the card's overflow-hidden.
export const HoverHint = memo(function HoverHint({
  hint,
  className = "",
  children
}) {
  const [pos, setPos] = useState(null);
  const rafRef = useRef(null);
  const track = useCallback(e => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      setPos({ x: vw ? Math.min(e.clientX + 14, vw - 180) : e.clientX + 14, y: e.clientY + 14 });
    });
  }, []);
  const leave = useCallback(() => { setPos(null); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } }, []);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
  return <div className={className} onMouseEnter={track} onMouseMove={track} onMouseLeave={leave}>
            {children}
            {pos && createPortal(
                <span className="pointer-events-none fixed z-[100] whitespace-nowrap rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] px-2 py-1 text-[11px] text-[color:var(--text)] shadow-lg shadow-black/40" style={{ left: pos.x, top: pos.y }}>
                    {hint}
                </span>,
                document.body
            )}
        </div>;
});

function fmtNum(n) {
  if (n == null) return null;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}



// Client-side keyword filter across the loaded page. Searches the visible text
// fields + subreddit + author so investigators can narrow 100 cards without
// re-hitting the archives. Case-insensitive substring match keeps it cheap.
function matchKeyword(item, kw, type) {
  if (!kw) return true;
  const k = kw.toLowerCase();
  const fields = [
    type === "posts" ? item.title : item.body,
    type === "posts" ? item.selftext : item.body,
    item.subreddit,
    item.subreddit_name_prefixed,
    item.permalink,
    item.link_flair_text,
    item.author_flair_text
  ];
  return fields.some(f => typeof f === "string" && f.toLowerCase().includes(k));
}

function getPostThumbnail(post) {
  try {
    if (post.preview?.images?.length) {
      const src = post.preview.images[0].source?.url;
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

function getCommentImage(comment) {
  try {
    if (comment.media_metadata) {
      const first = Object.values(comment.media_metadata)[0];
      if (first?.s?.u) return first.s.u.replace(/&amp;/g, "&");
    }
  } catch {/* ignore */}
  return null;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconSearch = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
    </svg>;

const IconArrowUp = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
    </svg>;

const IconComment = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
    </svg>;

const IconExternal = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>;

const IconSpinner = () => <span className="w-5 h-5 inline-block flex-shrink-0 rounded-full border-[3px] border-[color:var(--border)] border-t-[color:var(--accent)] animate-spin" aria-hidden="true"></span>;

const IconCopy = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
</svg>;

const IconDownload = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11" />
    </svg>;

const IconActivity = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 12h-4l-3 9L9 3l-3 9H2" />
</svg>;

const IconCalendar = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
</svg>;

export const IconInfo = ({ className = "w-3.5 h-3.5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// One-click copy of permalink + timestamp + subreddit + body so an investigator
// can paste a reproducible snapshot into their notes. Archived content can
// vanish, and a bare permalink doesn't capture what was there when they saw it.
const CopyButton = memo(function CopyButton({ getText }) {
  const [done, setDone] = useState(false);
  const { t } = useI18n();
  const copy = useCallback(async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      try {
        ta.select();
        document.execCommand("copy");
      } catch {
        return;
      } finally {
        document.body.removeChild(ta);
      }
    }
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  }, [getText]);
  return <button onClick={copy} aria-label={done ? t("copied") : t("copyAria")} title={t("copyTitle")} className={`flex items-center gap-1 transition-colors ${done ? "text-[color:var(--accent)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"}`}>
            <IconCopy />{done && <span className="text-[10px]">{t("copied")}</span>}
        </button>;
});

const IconPalette = ({ className = "w-3.5 h-3.5" }) => <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>;
const IconMoon = ({ className = "w-3.5 h-3.5" }) => <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>;
const IconSun = ({ className = "w-3.5 h-3.5" }) => <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>;
const IconMonitor = ({ className = "w-3.5 h-3.5" }) => <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>;
const IconGlobe = ({ className = "w-3.5 h-3.5" }) => <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>;

// ─── Error Boundary ───────────────────────────────────────────────────────────
// Wraps each result card so one malformed archive record (e.g. a comment with a
// numeric parent_id) can't crash the whole page — it renders a fallback instead.

class CardBoundary extends Component {
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

// ─── Status badges ────────────────────────────────────────────────────────────
// The reason people use an archive: seeing at a glance whether content was
// removed by a moderator vs deleted by its author, plus NSFW / distinguished
// (admin, mod) markers. Drives both the badge row and the card's border tint.

function isPost(item) {
  return Object.hasOwn(item, 'title');
}

function itemType(item) {
  return isPost(item) ? "posts" : "comments";
}

function getStatus(item, type) {
  const t = type === "all" ? itemType(item) : type;
  const text = t === "posts" ? item.selftext : item.body;
  return {
    removed: text === "[removed]" || t === "posts" && !!item.removed_by_category,
    deleted: text === "[deleted]" || item.author === "[deleted]"
  };
}

// Border color for a card, tinted red when mod-removed and amber when
// author-deleted so scanning a long list surfaces the interesting rows.
function statusBorderBase({
  removed,
  deleted
}) {
  if (removed) return "border-[color:var(--status-removed)]";
  if (deleted) return "border-[color:var(--status-deleted)]";
  return "border-[color:var(--border-hover)]";
}

function statusBorderHover({
  removed,
  deleted
}) {
  if (removed) return "hover:border-[color:var(--status-removed)]/50";
  if (deleted) return "hover:border-[color:var(--status-deleted)]/50";
  return "hover:border-[color:var(--text-muted)]";
}

function statusBorder(status) {
  return `${statusBorderBase(status)} ${statusBorderHover(status)}`;
}

const BADGE = "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide leading-none";

const StatusBadges = memo(function StatusBadges({
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
            {removed && <span className={`${BADGE} text-[color:var(--status-removed)] bg-[color:var(--status-removed)]/10 border border-[color:var(--status-removed)]/20`}>{t("badgeRemoved")}</span>}
            {deleted && <span className={`${BADGE} text-[color:var(--status-deleted)] bg-[color:var(--status-deleted)]/10 border border-[color:var(--status-deleted)]/20`}>{t("badgeDeleted")}</span>}
            {item.over_18 && <span className={`${BADGE} text-[color:var(--accent)] bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20`}>NSFW</span>}
            {item.spoiler && <span className={`${BADGE} bg-[color:var(--border)] text-[color:var(--text)] border border-[color:var(--border)]`}>{t("badgeSpoiler")}</span>}
            {dist === "admin" && <span className={`${BADGE} text-[color:var(--status-mod)] bg-[color:var(--status-mod)]/10 border border-[color:var(--status-mod)]/20`}>Admin</span>}
            {dist === "moderator" && <span className={`${BADGE} text-[color:var(--accent-text)] bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20`}>Mod</span>}
        </>;
});

// ─── Post Card ────────────────────────────────────────────────────────────────

const PostCard = memo(function PostCard({
  post,
  embedded = false
}) {
  const { t } = useI18n();
  const [bodyOpen, setBodyOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [moreCommentsCount, setMoreComments] = useState(null);
  const [imgError, setImgError] = useState(false);
  const commentsAbortRef = useRef(null);
  const thumb = useMemo(() => getPostThumbnail(post), [post]);
  const postUrl = post.permalink ? `${REDDIT_BASE}${post.permalink}` : `${REDDIT_BASE}/r/${post.subreddit}/comments/${post.id}`;
  const hasBody = useMemo(() => post.selftext && post.selftext !== "[deleted]" && post.selftext !== "[removed]", [post]);
  const status = useMemo(() => getStatus(post, "posts"), [post]);
  useEffect(() => () => { if (commentsAbortRef.current) commentsAbortRef.current.abort(); }, []);
  async function handleLoadComments() {
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
  }
  const copyText = useCallback(() => {
    const flag = status.removed ? " [removed]" : status.deleted ? " [deleted]" : "";
    return [
      post.title,
      `u/${post.author} · ${post.subreddit_name_prefixed || `r/${post.subreddit}`} · ${new Date(post.created_utc * 1000).toISOString()} · ${fmtNum(post.score)} pts${flag}`,
      postUrl,
      post.selftext ? `\n${post.selftext}` : "",
    ].filter(Boolean).join("\n");
  }, [post, status, postUrl]);
return <>
            <div className={`bg-[color:var(--bg-elevated)] border ${statusBorder(status)} rounded overflow-hidden transition-all duration-150 hover:shadow-lg group`}>
                <div className="flex">
                    <div className="flex flex-col items-center justify-start gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                        <IconArrowUp />
                        <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(post.score)}</span>
                    </div>
                    <div className="flex-1 p-3 min-w-0 relative">
                        <a href={postUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-0" aria-hidden="true" tabIndex={-1} />
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
                                <a href={postUrl} target="_blank" rel="noopener noreferrer" className="block relative z-10">
                                    <p className="text-sm font-medium text-[color:var(--text)] leading-snug mb-1.5 transition-colors break-words">
                                        {post.title}
                                    </p>
                                </a>
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] text-[color:var(--text-muted)] mt-1">
                                    <button onClick={e => {
                    e.preventDefault();
                    if (!comments) handleLoadComments();
                  }} disabled={commentsLoading} className="relative z-10 flex items-center gap-1 hover:text-[color:var(--accent)] transition-colors disabled:opacity-50 cursor-pointer">
                                        <IconComment />{embedded ? t("commentsCount", { n: fmtNum(post.num_comments) }) : t("showCommentsCount", { n: fmtNum(post.num_comments) })}
                                    </button>
                                    {post.domain && !post.is_self && <a href={post.url || postUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 flex items-center gap-1 text-[color:var(--accent-text)] hover:underline truncate max-w-[200px]">
                                        <IconExternal /><span className="truncate">{post.domain}</span>
                                    </a>}
                                    {hasBody && <button aria-label={bodyOpen ? "Hide post body" : "Show post body"} onClick={e => {
                    e.preventDefault();
                    setBodyOpen(o => !o);
                  }} className="relative z-10 flex items-center gap-1 text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors">
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
                                {thumb && <HoverHint hint={t("openImage")} className="self-end">
                                    <div role="button" tabIndex={0} onClick={e => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        window.open(thumb, "_blank", "noopener,noreferrer");
                                    }} className="relative flex items-center justify-center w-[70px] h-[52px] rounded overflow-hidden bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] cursor-zoom-in">
                                        <img src={thumb} alt={`${post.title}`} width="70" height="52" className={`absolute inset-0 w-full h-full object-cover transition-opacity ${imgError ? 'opacity-0' : 'opacity-100'}`} loading="lazy" onError={() => setImgError(true)} />
                                        {imgError && <IconExternal className="w-4 h-4 text-[color:var(--text-muted)] opacity-50 pointer-events-none" />}
                                    </div>
                                </HoverHint>}
                            </div>
                        </div>
                    </div>
                </div>

                {hasBody && bodyOpen && <div className="border-t border-[color:var(--border)] px-4 pt-3 pb-3 ml-[44px]">
                        <p className="text-[12px] text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words">
                            {post.selftext}
                        </p>
                    </div>}

                {/* ── Loaded comments — merged inside the post card ── */}
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
                                    {comments.map(c => <CommentCard key={c.id} comment={c} skipPostLoad={true} />)}
                                </div>
                            </div>}
                    </div>}
            </div>
        </>;
});

// ─── Parent Chain ─────────────────────────────────────────────────────────────
// Recursively loads and displays parent comments above the main comment.
// Each level shows a "load parent comment" button; once fetched, that parent's
// own parent chain is rendered above it (same pattern as the reference site).

const ParentChain = memo(function ParentChain({
  parentId
}) {
  const { t } = useI18n();
  const [comment, setComment] = useState(null);
  const [loading, setLoading] = useState(false);
  const parentAbortRef = useRef(null);
  useEffect(() => () => { if (parentAbortRef.current) parentAbortRef.current.abort(); }, []);
  if (typeof parentId !== "string" || !parentId.startsWith("t1_")) return null;
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
            {/* Recurse: if this parent also has a parent comment, show its chain above */}
            {comment && <ParentChain parentId={comment.parent_id} />}

            {comment ? (/* Loaded parent — rendered as a dimmed summary row */
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
                </div>) : (/* Not yet loaded — show button */
    <div className="px-3 py-1.5">
                    <button onClick={handleLoad} disabled={loading} className="flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--border)] rounded px-2 py-0.5 transition-all disabled:opacity-50">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                        {loading ? t("loadingLower") : t("loadParent")}
                    </button>
                </div>)}
        </div>;
});

// ─── Comment Card ─────────────────────────────────────────────────────────────

const CommentCard = memo(function CommentCard({
  comment,
  isNested = false,
  skipPostLoad = false
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
  const url = `${REDDIT_BASE}${comment.permalink}`;
  const threadUrl = threadId ? `${REDDIT_BASE}/comments/${threadId}` : url;
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
  async function handleLoadReplies() {
    if (!comment.link_id || repliesLoading) return;
    if (repliesAbortRef.current) repliesAbortRef.current.abort();
    const ctrl = new AbortController();
    repliesAbortRef.current = ctrl;
    setRepliesLoading(true);
    try {
      const res = await safeFetch(`${ARCTIC}/api/comments/tree?link_id=${comment.link_id}&parent_id=t1_${comment.id}&limit=25`, { signal: ctrl.signal });
      const data = res.data || [];
      // The response contains the parent comment at the top level;
      // its direct children are nested in replies.data.children
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
  }
  const copyText = useCallback(() => {
    const flag = status.removed ? " [removed]" : status.deleted ? " [deleted]" : "";
    return [
      `Comment on: ${comment.link_title || "Post"}`,
      `u/${comment.author} · ${comment.subreddit_name_prefixed || `r/${comment.subreddit}`} · ${new Date(comment.created_utc * 1000).toISOString()} · ${fmtNum(comment.score)} pts${flag}`,
      url,
      comment.body ? `\n${comment.body}` : "",
    ].filter(Boolean).join("\n");
  }, [comment, status, url]);
  return <div className={`bg-[color:var(--bg)] border ${statusBorderBase(status)} rounded overflow-hidden transition-all duration-150 ${!isNested ? `${statusBorderHover(status)} hover:shadow-lg` : ""}`}>

            {/* ── Parent post shown after auto-loading ── */}
            {post && <div className="border-b border-[color:var(--border-hover)]">
                    <PostCard post={post} embedded={true} />
                </div>}

            {/* ── Parent comment chain (top-level cards only) ── */}
            {!isNested && <ParentChain parentId={comment.parent_id} />}

            {/* ── Comment row ── */}
            <div className="flex">
                {/* Collapse line */}
                <button aria-label={collapsed ? "Expand comment" : "Collapse comment"} onClick={toggleCollapsed} onMouseEnter={onLineEnter} onMouseLeave={onLineLeave} className="relative flex-shrink-0 w-5 bg-[color:var(--bg)] transition-colors">
                    <svg className="absolute inset-x-0 top-0 w-full" style={{ height: collapsed ? 'calc(100% - 8px)' : '100%' }} fill="none">
                        <line x1="10.75" y1="8" x2="10.75" y2="100%"
                            stroke={collapsed ? "var(--accent)" : lineHovered ? "var(--text-muted)" : "var(--border-hover)"}
                            strokeWidth="2" strokeLinecap="round"
                            style={STROKE_TRANSITION} />
                    </svg>
                </button>

                {/* Score */}
                <div className="flex flex-col items-center justify-start gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                    <IconArrowUp />
                    <span className="text-[11px] font-bold text-[color:var(--text)] leading-none">{fmtNum(comment.score)}</span>
                </div>

                {/* Content */}
                <div className="flex-1 p-3 min-w-0 relative">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-0" aria-hidden="true" tabIndex={-1} />
                    {/* Header — always visible */}
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

                    {/* Body — hidden when collapsed */}
                    {!collapsed && <>
                            {status.removed || status.deleted ? <p className="text-sm text-[color:var(--text-muted)] italic leading-relaxed relative z-10">
                                    {status.removed ? t("removedText") : t("deletedText")}
                                </p> : <p className="text-sm text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words relative z-10">
                                    {comment.body || t("noContent")}
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

            {/* ── Replies section ── */}
            {!collapsed && <>
                    {/* + / - button with curved connector — shown before replies load */}
                    {!replies && <div className="flex items-center py-1.5" style={{
        paddingLeft: 9
      }}>
                            {/* SVG curve — clickable, glows on hover, collapses comment */}
                            <button aria-label="Collapse comment" onClick={toggleCollapsed} onMouseEnter={onLineEnter} onMouseLeave={onLineLeave} className="flex-shrink-0 -mt-[14px] bg-transparent border-0 p-0 cursor-pointer">
                                <svg width="22" height="32" viewBox="0 0 22 32" fill="none" className="overflow-visible">
                                    {/* Horizontal run extends past the viewBox (overflow-visible) so it
                                        passes under the circle button — its opaque bg masks the excess,
                                        guaranteeing the line always meets the ring with no seam. */}
                                    <path d="M 1 0 L 1 16 Q 1 23 8 23 L 28 23" stroke={lineHovered ? "var(--text-muted)" : "var(--border-hover)"} strokeWidth={2} fill="none" style={STROKE_TRANSITION} />
                                </svg>
                            </button>
                            {/* ⊕ circle button */}
                            <button onClick={handleLoadReplies} disabled={repliesLoading} aria-label="Load replies" className="relative w-[18px] h-[18px] rounded-full border-2 border-[color:var(--border)] bg-[color:var(--bg)] flex items-center justify-center text-[color:var(--text-muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-all disabled:opacity-40 flex-shrink-0 -ml-[1px]">
                                {repliesLoading ? <span className="text-[9px] leading-none">…</span> : <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                        <line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                        <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>}
                            </button>
                        </div>}

                    {/* Loaded replies — SVG curve connector into each reply */}
                    {replies && <div className="flex" style={{
        paddingLeft: 9
      }}>
                            {/* Single vertical line connecting down from parent collapse line */}
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
                            {/* Replies column */}
                            <div className="flex-1 min-w-0">
                                {replies.length > 0 ? <div className="flex flex-col gap-1.5 py-1.5 pr-2">
                                        {replies.map(reply => <div key={reply.id} className="flex items-start">
                                                {/* Short horizontal branch off the vertical line */}
                                                <svg width="14" height="44" viewBox="0 0 14 44" fill="none" className="flex-shrink-0 self-start" style={{
                marginTop: 19,
                marginLeft: -20,
                color: "var(--border-hover)"
              }}>
                                                    <path d="M 1 0 Q 1 7 8 7 L 14 7" stroke="currentColor" strokeWidth={2} fill="none" />
                                                </svg>
                                                <div className="flex-1 min-w-0">
                                                    <CommentCard comment={reply} isNested={true} />
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

// ─── Empty / Error ────────────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({
  tab,
  hasFilters,
  query,
  onSwitchTab,
  onClearFilters,
  deletedOnly,
  nsfwOnly,
  keyword
}) {
  const { t } = useI18n();
  const otherTab = tab === "posts" ? "comments" : "posts";
  const tabWord = tab === "posts" ? t("postsWord") : t("commentsWord");
  const otherTabWord = otherTab === "posts" ? t("postsWord") : t("commentsWord");
  return <div className="text-center py-16 text-[color:var(--text-muted)]">
            <p className="text-sm mb-2">{keyword ? t("emptyKeyword", { tab: tabWord, keyword }) : deletedOnly ? t("emptyDeleted", { tab: tabWord }) : nsfwOnly ? t("emptyNsfw", { tab: tabWord }) : t("emptyNone", { tab: tabWord })}</p>
            <p className="text-[12px] text-[color:var(--text-muted)] mb-4">{t("emptyHint")}</p>
            <div className="flex flex-col items-center gap-2 text-[12px]">
                <button type="button" onClick={onSwitchTab} className="text-[color:var(--accent-text)] hover:underline">
                    {t("switchTo", { tab: otherTabWord })}
                </button>
                {hasFilters && <button type="button" onClick={onClearFilters} className="text-[color:var(--accent-text)] hover:underline">
                        {t("clearRetry")}
                    </button>}
                <a href={`https://www.reddit.com/search/?q=author%3A%22${query}%22&type=${tab}`} target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent-text)] hover:underline">
                    {t("searchDirectly")}
                </a>
            </div>
        </div>;
});

const ErrorState = memo(function ErrorState({
  message,
  onRetry
}) {
  const { t } = useI18n();
  return <div className="text-center py-16">
            <p className="text-sm text-red-400 mb-1">{message}</p>
            <p className="text-[11px] text-[color:var(--text-muted)] mb-3">{t("errorHint")}</p>
            {onRetry && <button type="button" onClick={onRetry} className="text-[12px] text-[color:var(--accent-text)] hover:underline">
                    {t("tryAgain")}
                </button>}
            </div>;
});

// ─── Tab Button ───────────────────────────────────────────────────────────────

const TabBtn = memo(function TabBtn({
  label,
  count,
  countIsPlus,
  active,
  onClick
}) {
  return <button onClick={onClick} role="tab" aria-selected={active} className={`group/tab relative flex-1 flex items-center justify-center px-2.5 py-2 text-[13px] sm:px-4 sm:py-2.5 sm:text-sm font-medium transition-colors ${active ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"}`}>
            {label}
            {(count != null && count !== 0) && <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full transition-colors ${active ? "bg-[color:var(--accent)] text-[color:var(--bg)] font-bold" : "bg-[color:var(--border)] text-[color:var(--text-muted)] group-hover/tab:bg-[color:var(--accent)]/20 group-hover/tab:text-[color:var(--accent)]"}`}>
                    {countIsPlus ? `${count}+` : count}
                </span>}
            {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[color:var(--accent)] rounded-t" />}
        </button>;
});

// ─── usePaginatedFetch ────────────────────────────────────────────────────────
// Pages by created_utc keyset (Arctic Shift) with a stable id tiebreaker
// (before_id/after_id) so timestamp ties don't repeat or skip rows, plus a
// session-wide seen-Ids set that guards forward pages against duplicates.
// Pagination direction depends on sort: "desc" (Newest) pages back in time
// with a `before` cursor; "asc" (Oldest) pages forward with an `after` cursor.
// An AbortController per fetch cancels superseded network requests when the
// user types a new username mid-fetch.

function cursorFromData(data) {
  if (!data || data.length === 0) return null;
  return {
    firstUtc: data[0].created_utc,
    firstId: data[0].id,
    lastUtc: data[data.length - 1].created_utc,
    lastId: data[data.length - 1].id
  };
}

// Forward-cursor for the next page AFTER the given entry (newer for asc,
// older for desc).
function forwardPagination(entry, sort) {
  if (!entry) return {};
  return sort === "asc"
    ? { after: entry.lastUtc, afterId: entry.lastId }
    : { before: entry.lastUtc, beforeId: entry.lastId };
}

function usePaginatedFetch(type) {
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [arcticDown, setArcticDown] = useState(false);
  const [pullpushDown, setPullpushDown] = useState(false);
  const doneRef = useRef(false);
  const fetchIdRef = useRef(0);
  const abortRef = useRef(null);
  const cursorRef = useRef(null);
  const storedSortRef = useRef("desc");
  const storedFiltersRef = useRef({});

  // Runs one page fetch. Returns the rows, or null if this fetch was
  // superseded/aborted (so callers never apply stale results). Does not set
  // `items` itself — reset() replaces, loadMore() appends.
  const _fetch = useCallback(async (username, pagination, filters, {
    bypassCache = false,
    sort = "desc",
    suppressError = false
  } = {}) => {
    const fetchId = ++fetchIdRef.current;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    if (!suppressError) setError(null);
    try {
      const {
        items: data,
        sources: srcs,
        arcticDown: down,
        pullpushDown: ppDown,
        done: streamDone
      } = await fetchBoth(username, type, pagination, filters, {
        bypassCache,
        signal: ctrl.signal,
        sort,
      });
      if (fetchId !== fetchIdRef.current) return null;
      setSources(srcs);
      setArcticDown(down);
      setPullpushDown(ppDown);
      return { data, done: streamDone };
    } catch (err) {
      if (err?.name === "AbortError" || fetchId !== fetchIdRef.current) return null;
      if (!suppressError) setError(err?.message ?? "Network error");
      return { data: [], done: true };
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [type]);
  const reset = useCallback(async (username, filters, {
    bypassCache = false,
    sort = "desc"
  } = {}) => {
    storedFiltersRef.current = filters;
    storedSortRef.current = sort;
    setDone(false);
    doneRef.current = false;
    const pag = {};
    if (filters.dateFrom != null) pag.after = filters.dateFrom;
    if (filters.dateTo != null) pag.before = filters.dateTo;
    const result = await _fetch(username, pag, filters, { bypassCache, sort });
    if (result === null) return [];
    const { data, done: streamDone } = result;
    setItems(data);
    cursorRef.current = cursorFromData(data);
    setDone(streamDone);
    doneRef.current = streamDone;
    return data;
  }, [_fetch]);
  // Append the next page (older for "desc", newer for "asc") to the existing
  // list. Accumulates so the feed grows until the stream is exhausted.
  const loadMore = useCallback(async username => {
    if (!cursorRef.current || doneRef.current) return;
    const result = await _fetch(username, forwardPagination(cursorRef.current, storedSortRef.current), storedFiltersRef.current, {
      sort: storedSortRef.current,
      suppressError: true
    });
    if (result === null) return;
    const { data, done: streamDone } = result;
    if (data.length > 0) {
      const newCursor = cursorFromData(data);
      if (cursorRef.current && newCursor?.lastId === cursorRef.current.lastId) {
        setDone(true);
        doneRef.current = true;
        return;
      }
      cursorRef.current = newCursor;
      setItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...data.filter(i => i.id && !seen.has(i.id))];
      });
    }
    if (streamDone) { setDone(true); doneRef.current = true; }
  }, [_fetch]);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);
  return {
    items,
    sources,
    loading,
    error,
    done,
    arcticDown,
    pullpushDown,
    reset,
    loadMore
  };
}

// ─── Themes ───

const THEMES = {
  default: {
    dark: { bg: "#0d0d0d", accent: "#ff4500", tint: "#e6e4e1" },
    light: { bg: "#f3f4f6", accent: "#ff4500", tint: "#111827" }
  },
  nord: {
    dark: { bg: "#2e3440", accent: "#88c0d0" },
    light: { bg: "#eceff4", accent: "#5e81ac" }
  },
  catppuccin: {
    dark: { bg: "#1e1e2e", accent: "#cba6f7" },
    light: { bg: "#eff1f5", accent: "#8839ef" }
  },
  cyber: {
    dark: { bg: "#100a20", accent: "#fcee0a" },
    light: { bg: "#fcee0a", accent: "#100a20" }
  },
  mono: {
    dark: { bg: "#000000", accent: "#ffffff" },
    light: { bg: "#ffffff", accent: "#000000" }
  },
  gruvbox: {
    dark: { bg: "#282828", accent: "#ebdbb2" },
    light: { bg: "#fbf1c7", accent: "#3c3836" }
  },
  dracula: {
    dark: { bg: "#282a36", accent: "#ff79c6" },
    light: { bg: "#f8f8f2", accent: "#d0318d" }
  },
  solarized: {
    dark: { bg: "#002b36", accent: "#859900" },
    light: { bg: "#fdf6e3", accent: "#8b6e00" }
  },
  synthwave: {
    dark: { bg: "#2b213a", accent: "#f92aad" },
    light: { bg: "#f4ecf8", accent: "#f92aad" }
  }
};

// Blend two hex colors: mix(#000, #fff, 0.3) → 30% tint, 70% base
function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
}
function mix(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return rgbToHex(r1 * t + r2 * (1 - t), g1 * t + g2 * (1 - t), b1 * t + b2 * (1 - t));
}
// Precompute all derived theme values in JS, bypassing expensive CSS color-mix() calls.
function applyTheme(t, isDark) {
  const d = document.documentElement;
  d.style.setProperty("--bg", t.bg);
  d.style.setProperty("--accent", t.accent);
  d.style.setProperty("--tint", t.tint || t.accent);
  const tint = t.tint || t.accent;
  const base = isDark ? "#ffffff" : "#000000";
  const tintBase = mix(tint, base, 0.3);
  d.style.setProperty("--text-base", base);
  d.style.setProperty("--color-scheme", isDark ? "dark" : "light");
  d.style.setProperty("--accent-text", mix(tint, base, 0.7));
  d.style.setProperty("--text", tintBase);
  d.style.setProperty("--text-muted", mix(tint, mix(base, t.bg, 0.65), 0.3));
  d.style.setProperty("--text-faint", mix(tint, mix(base, t.bg, 0.45), 0.2));
  d.style.setProperty("--border", mix(tintBase, t.bg, 0.18));
  d.style.setProperty("--border-hover", mix(tintBase, t.bg, 0.28));
  d.style.setProperty("--bg-elevated", mix(tintBase, t.bg, 0.08));
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.bg);
}

const ThemeSwitcher = () => {
  const [theme, setTheme] = useState(() => localStorage.getItem("rosint-theme") || "default");
  const [colorMode, setColorMode] = useState(() => localStorage.getItem("rosint-color-mode") || "auto");

  useEffect(() => {
    let isDark = true;
    if (colorMode === "auto") {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } else {
      isDark = colorMode === "dark";
    }

    const tGroup = THEMES[theme] || THEMES.default;
    const t = isDark ? tGroup.dark : tGroup.light;

    applyTheme(t, isDark);

    localStorage.setItem("rosint-theme", theme);
    localStorage.setItem("rosint-color-mode", colorMode);
    // Cache the resolved palette so the inline script in index.html can apply
    // it before first paint (prevents a dark-theme flash on refresh).
    localStorage.setItem("rosint-resolved", JSON.stringify({ dark: tGroup.dark, light: tGroup.light, mode: colorMode }));
  }, [theme, colorMode]);

  useEffect(() => {
    if (colorMode !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e) => {
      const isDark = e.matches;
      const tGroup = THEMES[theme] || THEMES.default;
      const t = isDark ? tGroup.dark : tGroup.light;
      applyTheme(t, isDark);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme, colorMode]);

  const isDarkResolved = colorMode === "dark" || (colorMode === "auto" && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const { lang, t } = useI18n();

  return <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
            <details className="relative group/lang" onKeyDown={closeOnEscape}>
                <summary aria-label="Change language" className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-7 px-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <IconGlobe className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" />
                    <span className="hidden sm:inline text-xs text-[color:var(--text-muted)] font-medium pointer-events-none">{LANGS[lang]}</span>
                </summary>
                <div className="fixed inset-0 z-40 hidden group-open/lang:block" onClick={e => e.currentTarget.closest('details').removeAttribute('open')} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[110px] hidden group-open/lang:block">
                    {Object.entries(LANGS).map(([code, name]) => (
                        <button key={code} onClick={e => { setLang(code); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border-hover)] transition-colors">
                            <span className="text-[10px] font-bold uppercase text-[color:var(--text-faint)] w-5">{code}</span>
                            <span className={lang === code ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)]"}>{name}</span>
                        </button>
                    ))}
                </div>
            </details>

            <details className="relative group/mode" onKeyDown={closeOnEscape}>
                <summary aria-label={t("modeAuto")} className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-7 px-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    {colorMode === "dark" ? <IconMoon className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" /> : colorMode === "light" ? <IconSun className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" /> : <IconMonitor className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" />}
                    <span className="hidden sm:inline text-xs text-[color:var(--text-muted)] font-medium pointer-events-none">{colorMode === "auto" ? t("modeAuto") : colorMode === "dark" ? t("modeDark") : t("modeLight")}</span>
                </summary>
                <div className="fixed inset-0 z-40 hidden group-open/mode:block" onClick={e => e.currentTarget.closest('details').removeAttribute('open')} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[100px] hidden group-open/mode:block">
                    {["auto", "dark", "light"].map(mode => (
                        <button key={mode} onClick={e => { setColorMode(mode); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border-hover)] transition-colors">
                            {mode === "dark" ? <IconMoon className="w-3 h-3 text-[color:var(--text-muted)]" /> : mode === "light" ? <IconSun className="w-3 h-3 text-[color:var(--text-muted)]" /> : <IconMonitor className="w-3 h-3 text-[color:var(--text-muted)]" />}
                            <span className={colorMode === mode ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)]"}>{mode === "auto" ? t("modeAuto") : mode === "dark" ? t("modeDark") : t("modeLight")}</span>
                        </button>
                    ))}
                </div>
            </details>
            
            <details className="relative group/theme" onKeyDown={closeOnEscape}>
                <summary aria-label={t("themeDefault")} className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-7 px-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <IconPalette className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" />
                    <span className="w-2.5 h-2.5 rounded-full border border-[color:var(--border-hover)] pointer-events-none" style={{ background: "var(--accent)" }} />
                    <span className="hidden sm:inline text-xs text-[color:var(--text-muted)] font-medium pointer-events-none">{theme === "default" ? t("themeDefault") : theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                </summary>
                <div className="fixed inset-0 z-40 hidden group-open/theme:block" onClick={e => e.currentTarget.closest('details').removeAttribute('open')} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[130px] hidden group-open/theme:block max-h-[60vh] overflow-y-auto">
                    {Object.keys(THEMES).map(th => (
                        <button key={th} onClick={e => { setTheme(th); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border-hover)] transition-colors">
                            <span className="w-2.5 h-2.5 rounded-full border border-[color:var(--border-hover)] shrink-0" style={{ background: THEMES[th][isDarkResolved ? "dark" : "light"].accent }} />
                            <span className={theme === th ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)]"}>{th === "default" ? t("themeDefault") : th.charAt(0).toUpperCase() + th.slice(1)}</span>
                        </button>
                    ))}
                </div>
            </details>
        </div>;
};

const SearchBar = memo(function SearchBar({
  defaultQuery,
  onSearch,
  initialLoading
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(defaultQuery);
  const [recent, setRecent] = useState(() => {
    // Trim any over-long list left in storage by older versions so evicted
    // entries are truly deleted, not merely hidden.
    try {
      const stored = (JSON.parse(localStorage.getItem("rosint-recent")) || []).slice(0, 5);
      localStorage.setItem("rosint-recent", JSON.stringify(stored));
      return stored;
    }
    catch { return []; }
  });
  const [focused, setFocused] = useState(false);
  const [savedUsers, setSavedUsers] = useState([]);
  const inputRef = useRef(null);
  useEffect(() => {
    const fetchSaved = () => getSavedUsernames().then(setSavedUsers);
    fetchSaved();
    window.addEventListener('savedUsersChanged', fetchSaved);
    return () => window.removeEventListener('savedUsersChanged', fetchSaved);
  }, []);
  
  // The dropdown holds at most MAX_DROPDOWN rows. Saved profiles are pinned
  // (never evicted, never counted as recent); recents fill whatever room is
  // left, dropping the EARLIEST recent when full.
  const MAX_DROPDOWN = 5;
  const addRecent = (user) => {
    try {
      const savedSet = new Set(savedUsers.map(u => u.toLowerCase()));
      if (savedSet.has(user.toLowerCase())) return;
      const room = Math.max(0, MAX_DROPDOWN - savedUsers.length);
      const current = JSON.parse(localStorage.getItem("rosint-recent")) || [];
      const next = [user, ...current.filter(u => u !== user && !savedSet.has(u.toLowerCase()))].slice(0, room);
      localStorage.setItem("rosint-recent", JSON.stringify(next));
      setRecent(next);
    } catch (e) {
      console.error(e);
    }
  };

  const removeRecent = (e, user) => {
    e.stopPropagation();
    try {
      const current = JSON.parse(localStorage.getItem("rosint-recent")) || [];
      const next = current.filter(u => u !== user);
      localStorage.setItem("rosint-recent", JSON.stringify(next));
      setRecent(next);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSubmit = e => {
    if (e) e.preventDefault();
    const user = username.trim();
    if (!user) return;
    const normalized = normalizeUsername(user);
    if (!normalized) return;
    addRecent(normalized);
    inputRef.current?.blur();
    onSearch(normalized);
  };

  const handleRecentClick = (user) => {
    const normalized = normalizeUsername(user);
    if (!normalized) return;
    setUsername(normalized);
    addRecent(normalized);
    setFocused(false);
    onSearch(normalized);
  };

  const filteredSaved = useMemo(() => savedUsers.filter(r => r.toLowerCase().includes(username.trim().toLowerCase())), [savedUsers, username]);
  const maxDropdown = MAX_DROPDOWN;
  const filteredRecent = useMemo(() => {
    const room = Math.max(0, maxDropdown - filteredSaved.length);
    const savedLower = new Set(savedUsers.map(s => s.toLowerCase()));
    return recent.filter(r => r.toLowerCase().includes(username.trim().toLowerCase()) && !savedLower.has(r.toLowerCase())).slice(0, room);
  }, [recent, savedUsers, username, maxDropdown, filteredSaved.length]);

  return <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative" style={FLEX_1} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
                <span className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] text-sm font-medium">u/</span>
                <input ref={inputRef} aria-label="Search user" type="text" value={username} onChange={e => setUsername(e.target.value)} onFocus={() => setFocused(true)} placeholder={t("searchPlaceholder")} name="search_query_osint" id="search_query_osint" autoComplete="off" data-bwignore="true" data-lpignore="true" data-1p-ignore="true" spellCheck="false" className="w-full bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-[32px] pr-10 py-2.5 text-sm text-[color:var(--text)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)] transition-colors" onClick={() => setFocused(true)} onKeyDown={e => { if (e.key === "Escape") { setFocused(false); inputRef.current?.blur(); } }} />
                {username && (
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setUsername(""); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--accent-text)] transition-colors p-1" aria-label="Clear search">
                        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                )}
                
                {focused && (filteredRecent.length > 0 || filteredSaved.length > 0) && (
                  <div onMouseDown={e => e.preventDefault()} className="absolute top-full left-0 right-0 mt-1 bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded-md shadow-lg overflow-hidden z-50">
                    {filteredSaved.length > 0 && (
                      <>
                        <div className="px-4 py-3 text-[12px] font-medium text-[color:var(--text-muted)]">{t("savedProfiles")}</div>
                        {filteredSaved.map(r => (
                          <button type="button" key={r} onClick={() => handleRecentClick(r)} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--bg-elevated)] cursor-pointer group transition-colors">
                            <svg className="w-[18px] h-[18px] text-[color:var(--text-muted)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                            <span className="text-[14px] font-medium text-[color:var(--text)] truncate">{r}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {filteredRecent.length > 0 && (
                      <>
                        <div className="px-4 py-3 text-[12px] font-medium text-[color:var(--text-muted)]">{t("recent")}</div>
                        {filteredRecent.map(r => (
                          <div key={r} className="flex items-center hover:bg-[color:var(--bg-elevated)] group transition-colors">
                            <button type="button" onClick={() => handleRecentClick(r)} className="flex items-center gap-3 flex-1 min-w-0 text-left px-4 py-2.5 cursor-pointer">
                              <svg className="w-[18px] h-[18px] text-[color:var(--text-muted)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              <span className="text-[14px] font-medium text-[color:var(--text)] truncate">{r}</span>
                            </button>
                            <button type="button" onClick={(e) => removeRecent(e, r)} className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors p-1 mr-3 flex-shrink-0" aria-label={`Remove ${r} from recent searches`}>
                              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
            </div>
            <button type="submit" disabled={!username.trim() || initialLoading} className="flex items-center justify-center bg-[color:var(--accent)] text-[color:var(--bg)] border border-[color:var(--accent)] [&:not(:disabled)]:hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--text-base))] disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm px-5 py-2.5 rounded transition-all flex-shrink-0 leading-none">
                <span className="inline-flex items-center justify-center w-5 h-5 -mt-[1px]">
                    {initialLoading ? <span className="w-5 h-5 inline-block flex-shrink-0 rounded-full border-[3px] border-[color:color-mix(in_srgb,var(--bg)_35%,transparent)] border-t-[color:var(--bg)] animate-spin" aria-hidden="true"></span> : <IconSearch />}
                </span>
            </button>
        </form>;
});

const TABS = ["all", "posts", "comments"];

const AccountProfile = lazy(() => import('./AccountProfile.jsx'));

export default function App() {
  // Hydrate shareable permalink params (?u, ?tab, ?from, ?to, ?sub, ?sort)
  // before any fetch fires so a pasted link reproduces the exact filtered view.
  const [initialParams] = useState(() => Object.fromEntries(new URLSearchParams(window.location.search)));
  // If the page loads with ?u=<user>, render the results layout on the very
  // first paint. Otherwise the app would flash the centered hero, then flip to
  // searched=true once the restore effect fires — a visible page-flash + a
  // search-bar jump from center to top.
  const [initialUser] = useState(() => normalizeUsername(initialParams.u) || "");
  const { t, lang } = useI18n();
  const [query, setQuery] = useState(initialUser);
  const [activeTab, setActiveTab] = useState(initialParams.tab === "comments" ? "comments" : initialParams.tab === "posts" ? "posts" : "all");
  const [searched, setSearched] = useState(!!initialUser);
  const [initialLoading, setInitialLoading] = useState(!!initialUser);
  const [dateFrom, setDateFrom] = useState(initialParams.from ?? "");
  const [dateTo, setDateTo] = useState(initialParams.to ?? "");
  const [showDates, setShowDates] = useState(false);
  const [subreddit, setSubreddit] = useState(initialParams.sub ? String(initialParams.sub).replace(/^r\//, "") : "");
  const [showNsfw, setShowNsfw] = useState(true); // checked = show NSFW (no filter); unchecked = exclude NSFW
  const [appliedSubreddit, setAppliedSubreddit] = useState("");
  const [sortOrder, setSortOrder] = useState(initialParams.sort === "asc" ? "asc" : "desc");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [deletedOnly, setDeletedOnly] = useState(initialParams.deleted === "1");
  const [nsfwOnly, setNsfwOnly] = useState(initialParams.nsfw === "1");
  const [showProfile, setShowProfile] = useState(initialParams.stats === "1");
  const [keyword, setKeyword] = useState("");
  const searchIdRef = useRef(0);
  const deferredKeyword = useDeferredValue(keyword);
  const [userMeta, setUserMeta] = useState(null);
  // Shorten the keyword placeholder on narrow screens where the full hint clips.
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const h = e => setIsNarrow(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // ?dino in the URL forces the maintenance screen (which hosts the dino game)
  // so it can be tested without waiting for a real Arctic Shift outage.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Enable the hero→results collapse transition only after first paint, so the
  // search bar doesn't animate into place (slide up) on initial page load.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const posts = usePaginatedFetch("posts");
  const comments = usePaginatedFetch("comments");
  const arcticIsDown = posts.arcticDown || comments.arcticDown;
  const bothSourcesFailed = (posts.arcticDown && comments.arcticDown) && (posts.pullpushDown && comments.pullpushDown);

  const filteredItems = useMemo(() => {
    const items = activeTab === "all" ? [...posts.items, ...comments.items] : activeTab === "posts" ? posts.items : comments.items;
    return items.filter(item => {
      const type = activeTab === "all" ? itemType(item) : activeTab;
      if (deletedOnly) {
        const s = getStatus(item, type);
        if (!s.removed && !s.deleted) return false;
      }
      if (nsfwOnly && !item.over_18) return false;
      if (!matchKeyword(item, deferredKeyword, type)) return false;
      return true;
    }).sort((a, b) => sortOrder === "desc" ? b.created_utc - a.created_utc : a.created_utc - b.created_utc);
  }, [activeTab, posts.items, comments.items, deletedOnly, nsfwOnly, deferredKeyword, sortOrder]);
  const [visibleCount, setVisibleCount] = useState(Infinity);
  const prevFilteredLenRef = useRef(0);
  useEffect(() => {
    const prevLen = prevFilteredLenRef.current;
    prevFilteredLenRef.current = filteredItems.length;
    if (prevLen === 0 && filteredItems.length > 0) {
      setVisibleCount(100);
    } else if (filteredItems.length > prevLen) {
      setVisibleCount(c => Math.max(c, filteredItems.length));
    } else if (filteredItems.length < prevLen) {
      setVisibleCount(c => Math.min(c, filteredItems.length));
    }
  }, [filteredItems]);

  const isOutageTakeover = bothSourcesFailed && posts.items.length === 0 && comments.items.length === 0;
  useEffect(() => {
    document.title = "Rosint+";
  }, []);
  // Archive-wide totals for tab badges + summary. Shares the same URL as
  // UserSummary so safeFetch's in-flight cache dedupes both into one request.
  useEffect(() => {
    if (!query) {
      setUserMeta(null);
      return;
    }
    let cancelled = false;
    safeFetch(`${ARCTIC}/api/users/search?author=${encodeURIComponent(query)}&limit=1`).then(res => {
      if (cancelled) return;
      setUserMeta(res.data?.[0]?._meta ?? null);
    });
    return () => { cancelled = true; };
  }, [query]);
  const buildFilters = useCallback(() => {
    const f = {};
    if (dateFrom) f.dateFrom = Math.floor(new Date(dateFrom).getTime() / 1000);
    if (dateTo) f.dateTo = Math.floor(new Date(dateTo).getTime() / 1000) + 86399;
    if (subreddit.trim()) f.subreddit = subreddit.trim();
    if (!showNsfw) f.over18 = false;
    return f;
  }, [dateFrom, dateTo, subreddit, showNsfw]);
  const hasFilters = dateFrom || dateTo || subreddit.trim() || !showNsfw;
  // Keep the URL in sync with the shareable view state so findings are
  // reproducible/tab-restoreable: ?u ?tab ?from ?to ?sub ?sort. replaceState
  // (not push) so swapping tabs/filters doesn't pollute browser history.
  useEffect(() => {
    if (!searched || !query) return;
    const url = new URL(window.location.href);
    url.searchParams.set("u", query);
    // Only write non-default state so the shared URL stays minimal
    // (?u=name); defaults are implied when the params are absent.
    if (activeTab !== "all") url.searchParams.set("tab", activeTab);
    else url.searchParams.delete("tab");
    if (sortOrder !== "desc") url.searchParams.set("sort", sortOrder);
    else url.searchParams.delete("sort");
    if (subreddit.trim()) url.searchParams.set("sub", subreddit.trim());
    else url.searchParams.delete("sub");
    if (dateFrom) url.searchParams.set("from", dateFrom);
    else url.searchParams.delete("from");
    if (dateTo) url.searchParams.set("to", dateTo);
    else url.searchParams.delete("to");
    if (deletedOnly) url.searchParams.set("deleted", "1");
    else url.searchParams.delete("deleted");
    if (nsfwOnly) url.searchParams.set("nsfw", "1");
    else url.searchParams.delete("nsfw");
    if (showProfile) url.searchParams.set("stats", "1");
    else url.searchParams.delete("stats");
    window.history.replaceState({}, "", url);
  }, [searched, query, activeTab, subreddit, dateFrom, dateTo, sortOrder, deletedOnly, nsfwOnly, showProfile]);
  const {
    reset: resetPosts
  } = posts;
  const {
    reset: resetComments
  } = comments;
  const searchUser = useCallback(async (rawUser, {
    push = true
  } = {}) => {
    const user = normalizeUsername(rawUser);
    if (!user) return;
    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.set("u", user);
      window.history.pushState({}, "", url);
    }
    const searchId = ++searchIdRef.current;
    setQuery(user);
    setSearched(true);
    setInitialLoading(true);
    const filters = buildFilters();
    const postsPromise = resetPosts(user, filters, { sort: sortOrder });
    const commentsPromise = resetComments(user, filters, { sort: sortOrder });
    postsPromise.then(() => { if (searchId === searchIdRef.current) setInitialLoading(false); });
    await Promise.all([postsPromise, commentsPromise]);
    if (searchId !== searchIdRef.current) return;
    setAppliedSubreddit(subreddit.trim());
  }, [buildFilters, resetPosts, resetComments, subreddit, sortOrder]);
  useEffect(() => {
    if (searched && query && !initialLoading) {
      searchUser(query, {
        push: false
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, showNsfw, sortOrder, searchUser]);
  useEffect(() => {
    const u = normalizeUsername(new URLSearchParams(window.location.search).get("u"));
    if (u) searchUser(u, {
      push: false
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const u = normalizeUsername(new URLSearchParams(window.location.search).get("u"));
      if (u) {
        searchUser(u, {
          push: false
        });
      } else {
        setSearched(false);
        setQuery("");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [searchUser]);
  const handleRetry = useCallback(async () => {
    if (!query) return;
    setInitialLoading(true);
    const filters = buildFilters();
    await Promise.all([resetPosts(query, filters, {
      bypassCache: true, sort: sortOrder
    }), resetComments(query, filters, {
      bypassCache: true, sort: sortOrder
    })]);
    setInitialLoading(false);
  }, [query, buildFilters, resetPosts, resetComments, sortOrder]);
  const clearFilters = useCallback(async () => {
    setDateFrom("");
    setDateTo("");
    setSubreddit("");
    setShowNsfw(true);
    setNsfwOnly(false);
    setAppliedSubreddit("");
    if (!query) return;
    setInitialLoading(true);
    await Promise.all([resetPosts(query, {}, { sort: sortOrder }), resetComments(query, {}, { sort: sortOrder })]);
    setInitialLoading(false);
  }, [query, resetPosts, resetComments, sortOrder]);

  const firstSeenTs = useMemo(() => userMeta ? Math.min(...[userMeta.earliest_post_at, userMeta.earliest_comment_at].filter(Boolean)) : null, [userMeta]);
  const firstSeen = useMemo(() => Number.isFinite(firstSeenTs) ? new Date(firstSeenTs * 1000).toLocaleDateString(LOCALES[lang] || "en", { month: "short", year: "numeric" }) : null, [firstSeenTs, lang]);

  const active = useMemo(() => activeTab === "posts" ? posts : activeTab === "comments" ? comments : { loading: posts.loading || comments.loading, error: posts.error || comments.error, done: posts.done && comments.done }, [activeTab, posts, comments]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- active.items is undefined for "all" tab
  const activeItemCount = useMemo(() => activeTab === "all" ? posts.items.length + comments.items.length : active.items.length, [activeTab, posts.items.length, comments.items.length]);
  const allSources = useMemo(() => [...new Set([...posts.sources, ...comments.sources])], [posts.sources, comments.sources]);
  const activeHasMore = useMemo(() => activeTab === "all" ? (!posts.done || !comments.done) : !active.done, [activeTab, posts.done, comments.done, active.done]);
  const loadMoreActive = () => {
    if (activeTab === "all") {
      if (!posts.done) posts.loadMore(query);
      if (!comments.done) comments.loadMore(query);
    } else {
      active.loadMore(query);
    }
  };
  const handleWordClick = useCallback((word) => setKeyword(word), []);
  const pathname = window.location.pathname;
  const isPrivacyPage = pathname.endsWith('/privacy.html') || pathname.endsWith('/privacy');
  const is404Page = pathname.endsWith('/404.html') || (pathname !== "/" && !isPrivacyPage && !pathname.includes('index.html'));

  if (isPrivacyPage) {
    return (
      <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--text)] relative">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[color:var(--accent)] focus:text-[color:var(--bg)] focus:rounded focus:text-sm focus:font-bold focus:outline-none">Skip to content</a>
        <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-[color:var(--bg)] border-b border-[color:var(--border)]">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                        <span className="text-[1.25em]">r</span>OSINT+
                    </a>
                    <a href="/privacy.html" className="bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] px-2.5 h-7 transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center text-[13px] font-medium whitespace-nowrap"style={NO_DECORATION}>
                    {t("privacy")}
                </a>
            </div>
            <ThemeSwitcher />
        </header>
        <main className="max-w-3xl mx-auto px-4 pt-24 pb-20">
          <h1 className="text-4xl font-semibold mb-8 text-[color:var(--text)] leading-tight">{t("pvTitleA")} <span className="text-[color:var(--accent)]">{t("pvTitleB")}</span></h1>

          <div className="text-[color:var(--text-muted)] text-[16px] leading-relaxed flex flex-col gap-4">
              <p>{t("pvIntro")}</p>

              <p><strong className="text-[color:var(--text)]">{t("pvSearchLabel")}</strong> {tJsx(t, "pvSearchBody", { arctic: <a key="a" href="https://arctic-shift.photon-reddit.com" target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">Arctic Shift</a>, pullpush: <a key="p" href="https://pullpush.io" target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">PullPush</a> })}</p>

              <p><strong className="text-[color:var(--text)]">{t("pvDataLabel")}</strong> {t("pvDataBody")}</p>

              <div className="border border-[color:var(--border)] p-4 mt-4 bg-[color:var(--bg-elevated)]">
                  <strong className="text-[color:var(--text)]">{t("pvRemovalLabel")}</strong> {tJsx(t, "pvRemovalBody", { pullpushLink: <a key="pp" href="https://removals.pullpush.io/" target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">{t("pvPullpushRemovals")}</a>, arcticLink: <a key="as" href="https://docs.google.com/forms/d/e/1FAIpQLSfzkmE8Bg6K_xii7aRm66ljzvo2tR59lTsdJ99acW4WX786Vw/viewform?usp=sf_link" target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">{t("pvArcticRemovals")}</a> })}
              </div>
          </div>
        </main>
      </div>
    );
  }

  if (is404Page) {
      return (
      <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--text)] relative flex flex-col items-center justify-center text-center">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[color:var(--accent)] focus:text-[color:var(--bg)] focus:rounded focus:text-sm focus:font-bold focus:outline-none">Skip to content</a>
        <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-[color:var(--bg)] border-b border-[color:var(--border)]">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                    <span className="text-[1.25em]">r</span>OSINT+
                </a>
                <a href="/privacy.html" className="bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] px-2.5 h-7 transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center text-[13px] font-medium whitespace-nowrap"style={NO_DECORATION}>
                    {t("privacy")}
                </a>
            </div>
            <ThemeSwitcher />
        </header>
        <h1 className="text-6xl font-bold mb-4 text-[color:var(--text)]">404</h1>
        <p className="text-lg text-[color:var(--text-muted)] mb-8">{t("notFoundText")}</p>
        <a href="/" className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] text-[color:var(--accent-text)] px-4 py-2 rounded-md hover:border-[color:var(--accent)] transition-colors font-medium">{t("returnHome")}</a>
      </div>
      );
  }

  return <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--text)] relative flex flex-col">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[color:var(--accent)] focus:text-[color:var(--bg)] focus:rounded focus:text-sm focus:font-bold focus:outline-none">Skip to content</a>
            <header className={`${scrolled ? "" : "header-top"} fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-[color:var(--bg)] border-b border-[color:var(--border)]`}>
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                    <span className="text-[1.25em]">r</span>OSINT+
                </a>
                <a href="/privacy.html" className="bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] px-2.5 h-7 transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center text-[13px] font-medium whitespace-nowrap"style={NO_DECORATION}>
                    {t("privacy")}
                </a>
                </div>
                <ThemeSwitcher />
            </header>

            <main id="main-content" className="flex-1 flex flex-col pt-12">
                {arcticIsDown && !bannerDismissed && <div className="bg-[color:var(--border)] border-b border-[color:var(--border-hover)] px-4 py-2 flex items-center justify-between gap-3">
                        <p className="text-[12px] text-[color:var(--accent-text)]">
                            <span className="font-semibold">{t("bannerTitle")}</span>
                            {" "}{t("bannerBody")}
                        </p>
                        <button onClick={() => setBannerDismissed(true)} aria-label="Dismiss" className="text-[color:var(--text-muted)] hover:text-[color:var(--accent)] flex-shrink-0 transition-colors text-lg leading-none">
                            ×
                        </button>
                    </div>}
                <div className={`w-full max-w-3xl mx-auto px-3 sm:px-4 ${mounted ? "transition-all duration-300" : ""} ${searched ? "pt-6" : "flex-1 flex flex-col pt-[10vh] sm:pt-[14vh] pb-[10vh] sm:pb-[15vh]"}`}>
                    {!searched && (
                        <div className="text-center mb-8">
                            <h1 className="text-[9rem] sm:text-[16rem] font-bold text-[color:var(--text)] tracking-tight leading-none select-none ml-16 sm:ml-24" style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
                                <svg className="inline-block align-middle overflow-visible w-auto h-[1em]" viewBox="0 0 180 120" fill="none" style={{ fontFamily: 'inherit', fontWeight: 'inherit', letterSpacing: '-0.025em' }}>
                                    <text x="10" y="98" fontSize="98" fill="currentColor">r<tspan fill="var(--accent)" dx="12" dy="9" fontSize="98">+</tspan></text>
                                </svg>
                            </h1>
                            <p className="text-sm sm:text-base text-[color:var(--text-muted)] mt-6 leading-relaxed max-w-xl mx-auto">
                                {t("tagline")}
                            </p>
                        </div>
                    )}
                    <div className="relative mx-auto w-full flex-shrink-0" style={{
          maxWidth: searched ? '100%' : '690px'
        }}>
                        
                        <SearchBar defaultQuery={query} onSearch={searchUser} initialLoading={initialLoading} />
                    </div>

                    {!searched && <div className="flex flex-wrap items-center gap-2 mt-3 mx-auto w-full flex-shrink-0" style={{
          maxWidth: '690px'
        }}>
                            <button type="button" onClick={() => setShowAdvancedFilters(f => !f)} className="flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors">
                                {t("advancedFilters")}
                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${showAdvancedFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showAdvancedFilters && <div className="w-full flex flex-col gap-2 mt-1 items-start">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[11px] text-[color:var(--text-muted)]">{t("from")}</span>
                                        <input aria-label="Date from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7  text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors block" />
                                        <span className="text-[11px] text-[color:var(--text-muted)]">{t("to")}</span>
                                        <input aria-label="Date to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7  text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors block" />
                                        <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <span className="text-[11px] text-[color:var(--text-muted)]">{t("in")}</span>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] text-sm font-medium select-none">r/</span>
                                            <input aria-label="Filter by subreddit" type="text" value={subreddit} onChange={e => setSubreddit(e.target.value.replace(/^r\//, ""))} onKeyDown={e => {
                    if (e.key === 'Enter' && searched && query && !initialLoading) {
                      searchUser(query, {
                        push: false
                      });
                    }
                  }} onBlur={() => {
                    if (searched && query && !initialLoading) {
                      searchUser(query, {
                        push: false
                      });
                    }
                  }} placeholder={t("subredditPlaceholder")} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-8 pr-3 py-1 text-[12px] text-[color:var(--text)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)] transition-colors" />
                                        </div>
                                        </div>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                            <input type="checkbox" checked={deletedOnly} onChange={e => setDeletedOnly(e.target.checked)} className="w-3.5 h-3.5 accent-[color:var(--accent)] cursor-pointer" />
                                            <span className="text-[11px] text-[color:var(--text-muted)]">{t("deletedOnly")}</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                            <input type="checkbox" checked={showNsfw} onChange={e => setShowNsfw(e.target.checked)} className="w-3.5 h-3.5 accent-[color:var(--accent)] cursor-pointer" />
                                            <span className="text-[11px] text-[color:var(--text-muted)]">{t("showNsfw")}</span>
                                        </label>
                                    </div>
                                </div>}
                        </div>}
                </div>

                {searched && isOutageTakeover && <div className="max-w-md mx-auto px-4 mt-12 pb-16">
                        <div className="border border-[color:var(--border-hover)] bg-[color:var(--bg)] rounded-xl px-7 pt-10 pb-5 text-center shadow-lg shadow-black/30">
                            <p className="text-[color:var(--text)] text-lg font-semibold mb-2">
                                {t("outageTitle")}
                            </p>
                            <p className="text-[color:var(--text)] text-sm leading-relaxed">
                                {t("outageBody")}
                            </p>
                                                    </div>
                    </div>}

                {searched && !isOutageTakeover && <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 mt-6 pb-16">
                        {!initialLoading && <div className="mb-4">
                                <div className="flex flex-row items-start justify-between gap-3">
                                    <div role="status" className="text-[12px] text-[color:var(--text-muted)] min-w-0 sm:mr-4">
                                        <p className="leading-relaxed">
                                            {t("resultsFor")} <span className="text-[color:var(--accent-text)] font-medium">u/{query}</span>
                                            {allSources.length > 0 && <> · {allSources.map((src, i) => {
                      const url = src === "Arctic Shift" ? "https://github.com/ArthurHeitmann/arctic_shift" : "https://pullpush.io/";
                      return <span key={src}>
                                                            {i > 0 && <span className="text-[color:var(--text-muted)]"> + </span>}
                                                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent-text)] hover:underline transition-colors">
                                                                {src}
                                                            </a>
                                                        </span>;
                    })}</>}
                                            {userMeta?.total_karma != null && <> · <span className="text-[color:var(--text)] font-medium">{fmtNum(userMeta.total_karma)}</span> {t("karma")}</>}
                                            {firstSeen && <> · {t("since")} <span className="text-[color:var(--text)] font-medium">{firstSeen}</span></>}
                                            {appliedSubreddit && <> · {t("in")} <span className="text-[color:var(--accent-text)] font-medium">r/{appliedSubreddit}</span></>}
                                        </p>
                                    </div>
                                    <div className="relative flex items-center gap-2 sm:ml-auto flex-shrink-0">
                                        <button onClick={() => setShowDates(d => !d)} disabled={initialLoading} className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${dateFrom || dateTo ? "bg-[color:var(--accent)]/10 hover:bg-[color:var(--accent)]/20 text-[color:var(--accent)] border border-[color:var(--accent)]" : "bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]"}`} aria-label={t("filterByDate")} title={t("filterByDate")}>
                                            <IconCalendar />
                                        </button>
                                        {showDates && <>
                                            <div className="fixed inset-0 z-20" onClick={() => setShowDates(false)} aria-hidden="true" />
                                            <div className="absolute right-0 top-full mt-2 z-30 flex items-center gap-2 p-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[11px] font-medium text-[color:var(--text-muted)]">{t("from")}</span>
                                                    <input aria-label="Date from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors block" />
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[11px] font-medium text-[color:var(--text-muted)]">{t("to")}</span>
                                                    <input aria-label="Date to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors block" />
                                                </div>
                                                <button onClick={clearFilters} disabled={initialLoading || (!dateFrom && !dateTo)} className="px-3 h-7 text-[11px] font-medium text-[color:var(--text-muted)] enabled:hover:text-[color:var(--accent)] border border-[color:var(--border-hover)] enabled:hover:border-[color:var(--text-muted)] disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors">
                                                    {t("clear")}
                                                </button>
                                            </div>
                                        </>}
                                    </div>
                                </div>
                            </div>}

                        {initialLoading && <div className="mb-4" aria-hidden="true">
                                <div className="flex flex-row items-center justify-between gap-3">
                                    <div className="skeleton h-3.5 w-80 max-w-[75%] rounded-sm"></div>
                                    <div className="skeleton w-7 h-7 rounded flex-shrink-0"></div>
                                </div>
                            </div>}

                        {/* key remounts the card per user so stale stats never flash */}
                        {!initialLoading && showProfile && <Suspense fallback={
  <div className="flex flex-col gap-4 mb-4 mt-4 select-none">
    <div className="flex flex-col md:flex-row gap-4">
      <div className="flex-1 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm skeleton-card">
        <div className="skeleton h-4 w-28 rounded-sm mb-3"></div>
        <div className="skeleton h-24 w-full rounded"></div>
      </div>
      <div className="flex-[2] bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm skeleton-card">
        <div className="skeleton h-4 w-24 rounded-sm mb-3"></div>
        <div className="skeleton h-24 w-full rounded"></div>
      </div>
    </div>
    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm skeleton-card">
      <div className="skeleton h-4 w-32 rounded-sm mb-3"></div>
      <div className="skeleton h-12 w-full rounded"></div>
    </div>
  </div>
}>
                            <AccountProfile query={query} activeTab={activeTab} onWordClick={handleWordClick} />
                        </Suspense>}

                        {searched && <h2 className="sr-only">{t("resultsFor")} u/{query}</h2>}
                        <div className="flex items-stretch border-b border-[color:var(--border)] mb-4" role="tablist" aria-label={t("tabAll")}>
                                {TABS.map(tab => {
                  let liveCount, metaCount, countToDisplay, isPlus;
                  if (tab === "all") {
                    liveCount = posts.items.length + comments.items.length;
                    const mp = userMeta?.num_posts, mc = userMeta?.num_comments;
                    metaCount = typeof mp === "number" && typeof mc === "number" ? mp + mc : undefined;
                    countToDisplay = typeof metaCount === "number" ? fmtNum(metaCount) : liveCount;
                    isPlus = typeof metaCount !== "number" && liveCount >= LIMIT;
                  } else {
                    liveCount = tab === "posts" ? posts.items.length : comments.items.length;
                    metaCount = tab === "posts" ? userMeta?.num_posts : userMeta?.num_comments;
                    countToDisplay = typeof metaCount === "number" ? fmtNum(metaCount) : liveCount;
                    isPlus = typeof metaCount !== "number" && liveCount >= LIMIT;
                  }
                  const tabLabel = tab === "all" ? t("tabAll") : tab === "posts" ? t("tabPosts") : t("tabComments");
                  return <TabBtn key={tab} label={tabLabel} count={countToDisplay} countIsPlus={isPlus} active={activeTab === tab} onClick={() => setActiveTab(tab)} />;
                })}
                        </div>

                        {initialLoading ? <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:justify-between" aria-hidden="true">
                                <div className="skeleton h-4 w-28 rounded-sm flex-shrink-0"></div>
                                <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-start sm:justify-end">
                                    <div className="skeleton h-7 w-[92px] rounded"></div>
                                    <div className="skeleton h-7 w-[78px] rounded"></div>
                                    <div className="skeleton h-7 w-[72px] rounded"></div>
                                    <div className="w-px h-5 bg-[color:var(--border)] hidden sm:block" />
                                    <div className="skeleton h-7 w-[62px] rounded"></div>
                                    <div className="skeleton h-7 w-[74px] rounded"></div>
                                </div>
                            </div> : <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:justify-between">
                                <HoverHint hint={t("searchOnRedditHint")} className="flex-shrink-0">
                                    <a href={`https://www.reddit.com/search/?q=author%3A%22${query}%22`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent-text)] transition-colors leading-relaxed">
                                        <IconExternal /> {t("searchOnReddit")}
                                    </a>
                                </HoverHint>

                                <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-start sm:justify-end">
                                    <div className="flex items-center gap-2">
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded px-2 h-7 bg-[color:var(--bg)] transition-colors flex-shrink-0">
                                            <input type="checkbox" checked={deletedOnly} onChange={e => setDeletedOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)] cursor-pointer" />
                                            <span className="text-[11px] whitespace-nowrap">{t("deletedOnly")}</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded px-2 h-7 bg-[color:var(--bg)] transition-colors flex-shrink-0">
                                            <input type="checkbox" checked={nsfwOnly} onChange={e => setNsfwOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)] cursor-pointer" />
                                            <span className="text-[11px] whitespace-nowrap">{t("nsfwOnly")}</span>
                                        </label>
                                        <details className="relative group/sort flex-shrink-0" onKeyDown={closeOnEscape}>
                                            <summary aria-label={t("newest")} className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-7 px-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                                                <span className="text-[11px] pointer-events-none">{sortOrder === "desc" ? t("newest") : t("oldest")}</span><svg className="w-3 h-3 text-[color:var(--text-muted)] pointer-events-none opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                            </summary>
                                            <div className="fixed inset-0 z-40 hidden group-open/sort:block" onClick={e => e.currentTarget.closest('details').removeAttribute('open')} aria-hidden="true" />
                                            <div className="absolute right-0 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[90px] hidden group-open/sort:block">
                                                <button onClick={e => { setSortOrder("desc"); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[color:var(--border-hover)] transition-colors">
                                                    <span className={sortOrder === "desc" ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}>{t("newest")}</span>
                                                </button>
                                                <button onClick={e => { setSortOrder("asc"); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[color:var(--border-hover)] transition-colors">
                                                    <span className={sortOrder === "asc" ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}>{t("oldest")}</span>
                                                </button>
                                            </div>
                                        </details>
                                    </div>
                                    <div className="w-px h-5 bg-[color:var(--border)] hidden sm:block" />
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setShowProfile(p => !p)} className={`flex items-center gap-1.5 px-2.5 h-7 transition-colors flex-shrink-0 border rounded outline-none cursor-pointer select-none ${showProfile ? "bg-[color:var(--bg-elevated)] text-[color:var(--text)] border-[color:var(--text-muted)]" : "bg-[color:var(--bg)] text-[color:var(--text-muted)] border-[color:var(--border-hover)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] hover:border-[color:var(--text-muted)]"}`}>
                                            <IconActivity />
                                            <span className="text-[11px] whitespace-nowrap">{t("stats")}</span>
                                        </button>
                                        <details className="relative group/export" onKeyDown={closeOnEscape}>
                                            <summary aria-label="Export" className="flex items-center gap-1.5 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] px-2.5 h-7 transition-colors border border-[color:var(--border-hover)] rounded text-[11px] whitespace-nowrap cursor-pointer list-none [&::-webkit-details-marker]:hidden outline-none">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 9l7 7 7-7" /></svg>
                                                Export
                                            </summary>
                                            <div className="fixed inset-0 z-40 hidden group-open/export:block" onClick={e => e.currentTarget.closest('details').removeAttribute('open')} aria-hidden="true" />
                                            <div className="absolute right-0 top-full mt-1 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[100px] hidden group-open/export:block">
                                                <button onClick={e => {
                                                    const cols = ["id", "type", "created_utc", "subreddit", "author", "score", "permalink", "text", "removed", "deleted"];
                                                    const csv = [cols.join(",")].concat(filteredItems.map(item => {
                                                        const type = activeTab === "all" ? itemType(item) : activeTab;
                                                        const status = getStatus(item, type);
                                                        const text = isPost(item) ? item.title : item.body;
                                                        const vals = [item.id, isPost(item) ? "post" : "comment", item.created_utc, item.subreddit, item.author, item.score || 0, item.permalink, text ? `"${text.replace(/"/g, '""').replace(/\n/g, " ")}"` : "", status.removed, status.deleted];
                                                        return vals.join(",");
                                                    })).join("\n");
                                                    downloadFile(`rosint_${query}_${activeTab}.csv`, csv, "text/csv");
                                                    e.currentTarget.closest('details').removeAttribute('open');
                                                }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border-hover)] transition-colors">
                                                    <IconDownload />
                                                    CSV
                                                </button>
                                                <button onClick={e => {
                                                    downloadFile(`rosint_${query}_${activeTab}.json`, JSON.stringify(filteredItems, null, 2), "application/json");
                                                    e.currentTarget.closest('details').removeAttribute('open');
                                                }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border-hover)] transition-colors">
                                                    <IconDownload />
                                                    JSON
                                                </button>
                                            </div>
                                        </details>
                                    </div>
                                </div>
                            </div>}

                        {initialLoading ? <div className="relative mb-3">
                                <div className="w-full h-[33px] rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] flex items-center gap-2 pl-3 pr-3">
                                    <div className="skeleton w-3.5 h-3.5 rounded-full flex-shrink-0"></div>
                                    <div className="skeleton h-2.5 w-48 max-w-[70%] rounded-sm"></div>
                                </div>
                            </div> : (activeItemCount > 0) && <div className="relative mb-3">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
                                </span>
                                <input aria-label={t("filterPlaceholderShort")} type="text" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={isNarrow ? t("filterPlaceholderShort") : t("filterPlaceholder")} className="w-full bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-9 pr-3 py-1.5 text-[12px] text-[color:var(--text)] placeholder-[color:var(--text-faint)] focus:outline-none focus:border-[color:var(--accent)] transition-colors" />
                                {keyword && <button onClick={() => setKeyword("")} aria-label="Clear keyword filter" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--accent-text)] leading-none"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
                            </div>}

                        {initialLoading || (active.loading && activeItemCount === 0) ? <div aria-busy="true" aria-label={t("loading")} className="w-full flex flex-col items-stretch gap-2 py-2">
                                {[...Array(6)].map((_, i) => <div key={i} aria-hidden="true" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                        <div className="flex w-full">
                                            <div className="flex flex-col items-center justify-start gap-1.5 px-2.5 py-3 bg-[color:var(--bg)] min-w-[40px]">
                                                <div className="skeleton w-3.5 h-3.5 rounded-sm"></div>
                                                <div className="skeleton w-5 h-2.5 rounded-sm"></div>
                                            </div>
                                            <div className="flex-1 p-3 min-w-0">
                                                <div className="skeleton h-2.5 w-24 mb-2.5 rounded-sm"></div>
                                                <div className="skeleton h-4 w-11/12 mb-2 rounded-sm"></div>
                                                <div className="skeleton h-3 w-2/5 rounded-sm"></div>
                                            </div>
                                        </div>
                                    </div>)}
                                <div className="flex items-center justify-center gap-2 text-[color:var(--text-muted)] pt-2">
                                    <IconSpinner />
                                    <span className="text-[11px]">{t("fetching")}</span>
                                </div>
                            </div> : filteredItems.length === 0 ? active.error ? <ErrorState message={active.error} onRetry={handleRetry} /> : <EmptyState tab={activeTab} hasFilters={!!hasFilters} query={query} onSwitchTab={() => setActiveTab(activeTab === "posts" ? "comments" : "posts")} onClearFilters={clearFilters} deletedOnly={deletedOnly} nsfwOnly={nsfwOnly} keyword={keyword} /> : <>
                                <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-2">
                                    {filteredItems.slice(0, visibleCount).map(item => isPost(item)
                                      ? <CardBoundary key={`p-${item.id}`}><div className="cv-auto"><PostCard post={item} /></div></CardBoundary>
                                      : <CardBoundary key={`c-${item.id}`}><div className="cv-auto"><CommentCard comment={item} /></div></CardBoundary>
                                    )}
                                </div>
                                {activeHasMore && <div className="flex justify-center mt-6">
                                    <button type="button" onClick={loadMoreActive} disabled={active.loading} aria-label="Load more results" className="flex items-center gap-2 px-6 h-10 rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] text-[color:var(--text)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium">
                                        {active.loading ? <><IconSpinner /> {t("loading")}</> : t("loadMore")}
                                    </button>
                                </div>}
                            </>}
                    </div>}
            </main>

            <footer className="relative bottom-0 left-0 right-0 z-10 py-2 bg-[color:var(--bg)] border-t border-[color:var(--border)]" style={{
      paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))'
    }}>
                    <p className="text-[11px] text-[color:var(--text-faint)] leading-relaxed text-center">
                        {t("footerNoCookies")}
                        <span className="mx-2 opacity-50">•</span>
                        {tJsx(t, "footerFork", { link: <a key="l" href="https://rosint.dev" target="_blank" rel="noopener noreferrer" className="text-[color:var(--text-faint)] hover:underline transition-colors">rosint.dev</a> })}
                        <span className="mx-2 opacity-50">•</span>
                        {tJsx(t, "footerUsing", { arctic: <a key="a" href="https://arctic-shift.photon-reddit.com" target="_blank" rel="noopener noreferrer" className="text-[color:var(--text-faint)] hover:underline transition-colors">Arctic Shift</a>, pullpush: <a key="p" href="https://pullpush.io/" target="_blank" rel="noopener noreferrer" className="text-[color:var(--text-faint)] hover:underline transition-colors">PullPush</a> })}
                    </p>
                </footer>
        </div>;
}
