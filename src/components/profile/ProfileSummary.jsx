import { memo, useMemo, useState } from 'react';
import { REDDIT_BASE } from '../../api/client.js';
import { useI18n, LOCALES } from '../../i18n.js';
import { evaluateBotLikelihood } from '../../botDetector.js';
import { fmtNum } from '../../utils.js';

const RISK_TEXT = {
  high: 'text-[color:var(--danger)] font-bold',
  medium: 'text-[color:var(--warn)] font-semibold',
  low: 'text-[color:var(--text)]',
};

/**
 * Always-visible profile summary: item/karma/subs KPIs plus the bot check.
 * Runs entirely on already-loaded history, so results appear immediately and
 * no lookup can be rate limited.
 */
const ProfileSummary = memo(function ProfileSummary({
  username,
  posts = [],
  comments = [],
  userMeta = null,
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);

  const analysis = useMemo(
    () => evaluateBotLikelihood({ username, posts, comments }),
    [username, posts, comments]
  );

  const kpi = useMemo(() => {
    const postsCount = (typeof userMeta?.num_posts === 'number' && userMeta.num_posts > 0)
      ? userMeta.num_posts
      : posts.length;
    const commentsCount = (typeof userMeta?.num_comments === 'number' && userMeta.num_comments > 0)
      ? userMeta.num_comments
      : comments.length;
    let earliest = userMeta?.earliest_post_at || userMeta?.earliest_comment_at || null;
    let karma = userMeta?.total_karma;
    if ((!earliest || karma == null) && (posts.length || comments.length)) {
      let minUtc = earliest;
      let sumKarma = 0;
      for (const p of posts) {
        if (p.score) sumKarma += p.score;
        if (p.created_utc && (!minUtc || p.created_utc < minUtc)) minUtc = p.created_utc;
      }
      for (const c of comments) {
        if (c.score) sumKarma += c.score;
        if (c.created_utc && (!minUtc || c.created_utc < minUtc)) minUtc = c.created_utc;
      }
      earliest = minUtc;
      if (karma == null) karma = sumKarma;
    }
    return {
      posts: fmtNum(postsCount, LOCALES[lang] || "en"),
      comments: fmtNum(commentsCount, LOCALES[lang] || "en"),
      karma: fmtNum(karma ?? 0, LOCALES[lang] || "en"),
      // Raw archive totals, for the "scanned X of Y" scope label. The bot
      // analysis runs on a bounded sample of the history, and the label has
      // to say so — otherwise it reads the same for every large account.
      totalPosts: postsCount,
      totalComments: commentsCount,
      activeSince: earliest ? new Date(earliest * 1000).toLocaleDateString(LOCALES[lang] || "en", { month: "short", year: "numeric" }) : "—",
    };
  }, [posts, comments, userMeta, lang]);

  if (!posts.length && !comments.length) return null;

  const tx = (key, fallback) => {
    if (!key) return fallback;
    const s = t(key);
    return s === key ? fallback : s;
  };

  return <div className="flex flex-col gap-2 mb-3">
            <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg px-2 sm:px-3 py-2.5 sm:py-3 grid grid-cols-5 divide-x divide-[color:var(--border)]">
                <div className="min-w-0 text-center px-1">
                    <div className="text-[15px] sm:text-[18px] font-bold leading-none text-[color:var(--text)] truncate">{kpi.posts}</div>
                    <div className="text-[9.5px] sm:text-[11px] leading-none mt-1 truncate">
                        <span className="text-[color:var(--text-muted)]">{t("postsWord")}</span>
                    </div>
                </div>

                <div className="min-w-0 text-center px-1">
                    <div className="text-[15px] sm:text-[18px] font-bold leading-none text-[color:var(--text)] truncate">{kpi.comments}</div>
                    <div className="text-[9.5px] sm:text-[11px] leading-none mt-1 truncate">
                        <span className="text-[color:var(--text-muted)]">{t("commentsWord")}</span>
                    </div>
                </div>

                <div
                    onClick={() => setOpen(o => !o)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    aria-label={t("apDuplicatesToggle")}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
                    title={t("apDuplicatesHint")}
                    className="min-w-0 text-center px-1 cursor-pointer hover:bg-[color:var(--border)]/20 transition-colors rounded"
                >
                    <div className={`text-[15px] sm:text-[18px] font-bold leading-none truncate whitespace-nowrap ${RISK_TEXT[analysis.riskLevel] || RISK_TEXT.low}`}>
                        {fmtNum(analysis.metrics.duplicateItems, LOCALES[lang] || "en")}
                    </div>
                    <div className="text-[9.5px] sm:text-[11px] leading-none mt-1 truncate">
                        <span className="text-[color:var(--text-muted)]">{t("apDuplicates")}</span>
                    </div>
                </div>

                <div className="min-w-0 text-center px-1">
                    <div className="text-[14px] sm:text-[18px] font-bold leading-none text-[color:var(--text)] truncate">{kpi.activeSince}</div>
                    <div className="text-[9.5px] sm:text-[11px] leading-none mt-1 truncate">
                        <span className="text-[color:var(--text-muted)]">{t("apActiveSince")}</span>
                    </div>
                </div>

                <div className="min-w-0 text-center px-1">
                    <div className="text-[15px] sm:text-[18px] font-bold leading-none text-[color:var(--text)] truncate">{kpi.karma}</div>
                    <div className="text-[9.5px] sm:text-[11px] leading-none mt-1 truncate">
                        <span className="text-[color:var(--text-muted)]">{t("apKarma")}</span>
                    </div>
                </div>
            </div>

            {open && <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg p-3 text-xs flex flex-col gap-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] pb-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="font-semibold text-sm">{t("apDuplicatesTitle")}</span>
                            <span className={`text-[10px] font-semibold ${RISK_TEXT[analysis.riskLevel] || RISK_TEXT.low}`}>
                                {tx(analysis.verdictKey, analysis.verdict)}
                            </span>
                            <span className="text-[10px] text-[color:var(--text-faint)]">
                                {(() => {
                                    const scanned = analysis.metrics.loadedPosts + analysis.metrics.loadedComments;
                                    const total = (kpi.totalPosts || 0) + (kpi.totalComments || 0);
                                    const fmt = n => { try { return Number(n).toLocaleString(LOCALES[lang] || "en"); } catch { return String(n); } };
                                    // The scan runs on a bounded sample. When the archive holds
                                    // more than that, say "of N" so the figure is not mistaken
                                    // for the whole history.
                                    if (total > scanned) return t("apBotScannedOf", { scanned: fmt(scanned), total: fmt(total) });
                                    return t("apBotScanned", { posts: fmt(analysis.metrics.loadedPosts), comments: fmt(analysis.metrics.loadedComments) });
                                })()}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] text-xs px-1 cursor-pointer"
                        >
                            ×
                        </button>
                    </div>
                    <p className="text-[11px] text-[color:var(--text-muted)]">{t("apDuplicatesNote")}</p>

                    {analysis.flags.length > 0 && (
                        <div className="flex flex-col gap-1 bg-[color:var(--warn)]/10 border border-[color:var(--warn)]/20 rounded p-2 text-[11px] text-[color:var(--warn)]">
                            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                                {(analysis.flagKeys?.length ? analysis.flagKeys.map(f => {
                                    const detailText = tx(f.detailKey, f.params?.detail);
                                    const s = t(f.key, { detail: detailText });
                                    return s === f.key ? f.params?.detail : s;
                                }) : analysis.flags).map((flag, idx) => <li key={idx}>{flag}</li>)}
                            </ul>
                        </div>
                    )}

                    {analysis.evidence.length > 0 ? (
                        <ul className="flex flex-col gap-1.5 text-[11px] text-[color:var(--danger)]">
                            {analysis.evidence.map((e, i) => {
                                const label = tx(e.labelKey, e.label);
                                const line = t("botEvidenceCount", { count: e.count, label });
                                return (
                                <li key={i} className="flex flex-wrap items-center gap-1">
                                    <span className="font-semibold whitespace-nowrap">{line === "botEvidenceCount" ? `${e.count}× ${label}` : line}</span>
                                    {e.subs && <span className="text-[color:var(--text-faint)]">{e.subs}</span>}
                                    {e.sample && <span className="opacity-80 break-all">· {e.sample}</span>}
                                    {e.posts?.length > 0 && <span className="flex items-center gap-1">
                                        {e.posts.map(p => {
                                            let href = null;
                                            if (p.permalink) {
                                                href = `${REDDIT_BASE}${p.permalink}`;
                                            } else if (e.kind === 'comment') {
                                                const sub = p.subreddit;
                                                const rawLink = p.link_id || p.linkId;
                                                const linkId = rawLink ? String(rawLink).replace(/^t3_/, '') : null;
                                                href = (sub && linkId && p.id) ? `${REDDIT_BASE}/r/${sub}/comments/${linkId}/_/${p.id}` : null;
                                            } else {
                                                href = p.id ? `${REDDIT_BASE}/comments/${p.id}` : null;
                                            }
                                            return href ? (
                                                <a key={p.id} className="underline" href={href} target="_blank" rel="noopener noreferrer">{p.id}</a>
                                            ) : (
                                                <span key={p.id}>{p.id}</span>
                                            );
                                        })}
                                    </span>}
                                </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p className="text-[11px] text-[color:var(--text-muted)]">
                            {t("botNoDuplicates")}
                        </p>
                    )}
                </div>}
        </div>;
});

export default ProfileSummary;
