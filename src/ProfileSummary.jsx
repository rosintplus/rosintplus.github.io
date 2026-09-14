import { memo, useMemo, useState } from 'react';
import { REDDIT_BASE } from './api.js';
import { useI18n, LOCALES } from './i18n.js';
import { evaluateBotLikelihood } from './botDetector.js';

function fmtNum(n, locale) {
  if (n == null) return null;
  try {
    if (locale) {
      const nf = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
      return nf.format(n);
    }
  } catch { /* fall through */ }
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const RISK_BADGE = {
  high: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30',
  medium: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30',
  low: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
};

const RISK_TEXT = {
  high: 'text-rose-700 dark:text-rose-300 font-bold',
  medium: 'text-amber-700 dark:text-amber-300 font-semibold',
  low: 'text-[color:var(--text)]',
};

// Short, number-free verdict text for the compact KPI cell.
const VERDICT_SHORT = {
  'Disclosed Automation': 'disclosed bot',
  'Repost Pattern': 'repost pattern',
  'Duplicate Posts': 'duplicate posts',
  'No Duplicates': 'no duplicates',
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
      activeSince: earliest ? new Date(earliest * 1000).toLocaleDateString(LOCALES[lang] || "en", { month: "short", year: "numeric" }) : "—",
    };
  }, [posts, comments, userMeta, lang]);

  if (!posts.length && !comments.length) return null;

  const shortVerdict = VERDICT_SHORT[analysis.verdict] || analysis.verdict.toLowerCase();

  return <div className="flex flex-col gap-2 mb-4">
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
                    aria-label={t("apBotToggle")}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
                    title={t("apBotBreakdown")}
                    className="min-w-0 text-center px-1 cursor-pointer hover:bg-[color:var(--border)]/20 transition-colors rounded py-0.5"
                >
                    <div className={`text-[11px] sm:text-[12px] leading-tight ${RISK_TEXT[analysis.riskLevel] || RISK_TEXT.low}`}>
                        {shortVerdict}
                    </div>
                    <div className="text-[9.5px] sm:text-[11px] leading-none mt-1 truncate">
                        <span className="text-[color:var(--text-muted)]">{t("apBotCheck")}</span>
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
                    <div className="flex items-center justify-between border-b border-[color:var(--border)] pb-2">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{t("apBotBreakdownTitle")}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${RISK_BADGE[analysis.riskLevel] || RISK_BADGE.low}`}>
                                {analysis.verdict}
                            </span>
                            <span className="text-[10px] text-[color:var(--text-faint)]">
                                {analysis.metrics.loadedPosts} posts · {analysis.metrics.loadedComments} comments scanned
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] text-xs px-1 cursor-pointer"
                        >
                            ✕
                        </button>
                    </div>

                    {analysis.flags.length > 0 && (
                        <div className="flex flex-col gap-1 bg-amber-500/10 border border-amber-500/20 rounded p-2 text-[11px] text-amber-700 dark:text-amber-300">
                            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                                {analysis.flags.map((flag, idx) => <li key={idx}>{flag}</li>)}
                            </ul>
                        </div>
                    )}

                    {analysis.evidence.length > 0 ? (
                        <ul className="flex flex-col gap-1.5 text-[11px] text-rose-700 dark:text-rose-300">
                            {analysis.evidence.map((e, i) => (
                                <li key={i} className="flex flex-wrap items-center gap-1">
                                    <span className="font-semibold whitespace-nowrap">{e.count}× {e.label.toLowerCase()}</span>
                                    {e.subs && <span className="text-[color:var(--text-faint)]">{e.subs}</span>}
                                    {e.sample && <span className="opacity-80 break-all">· {e.sample}</span>}
                                    {e.posts?.length > 0 && <span className="flex items-center gap-1">
                                        {e.posts.map(p => (
                                            <a key={p.id} className="underline" href={p.permalink ? `${REDDIT_BASE}${p.permalink}` : `${REDDIT_BASE}/comments/${p.id}`} target="_blank" rel="noopener noreferrer">{p.id}</a>
                                        ))}
                                    </span>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-[11px] text-[color:var(--text-muted)]">
                            No duplicated media, titles or comments in the loaded history.
                        </p>
                    )}
                </div>}
        </div>;
});

export default ProfileSummary;
