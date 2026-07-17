import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import { HoverHint, IconInfo } from './App.jsx';
import { REDDIT_BASE } from './api.js';
import { useI18n, LOCALES } from './i18n.js';
import { toggleProfileSaved, getSavedUsernames } from './profileData.js';

function getDays(locale) {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2000, 0, 2 + i)).slice(0, 3));
}
const levels = [0.4, 0.6, 0.8, 1.0];

const AccountProfile = memo(function AccountProfile({
  query,
  activeTab,
  onWordClick,
  stats,
  userMeta,
  isCrawling,
  onRefresh,
}) {
  const { t, lang } = useI18n();
  const days = useMemo(() => getDays(LOCALES[lang] || "en"), [lang]);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (!query) return;
    const checkSaved = () => {
      getSavedUsernames()
        .then(keys => setIsSaved(keys.includes(query.toLowerCase())))
        .catch(() => setIsSaved(false));
    };
    checkSaved();
    window.addEventListener('savedUsersChanged', checkSaved);
    return () => window.removeEventListener('savedUsersChanged', checkSaved);
  }, [query]);

  const handleToggleSave = useCallback(async () => {
    const newState = !isSaved;
    setIsSaved(newState);
    try {
      await toggleProfileSaved(query, newState);
    } catch {
      setIsSaved(!newState);
    }
  }, [query, isSaved]);

  const totalItems = typeof userMeta?.num_posts === 'number' && typeof userMeta?.num_comments === 'number'
    ? userMeta.num_posts + userMeta.num_comments
    : 0;

  if (!stats || totalItems === 0) return null;

  const topSubreddits = useMemo(() => {
    if (!stats?.subredditCounts) return { list: [], max: 1 };
    const counts = stats.subredditCounts;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = sorted.length > 0 ? sorted[0][1] : 1;
    return { list: sorted, max };
  }, [stats]);

  const heatmapData = useMemo(() => {
    if (!stats?.heatmap) return { matrix: [], maxCount: 1 };
    const matrix = stats.heatmap;
    let max = 0;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 24; c++) {
        if (matrix[r][c] > max) max = matrix[r][c];
      }
    }
    return { matrix, maxCount: max || 1 };
  }, [stats]);

  const tzHint = useMemo(() => {
    if (!stats?.heatmap) return null;
    const matrix = stats.heatmap;
    const hourTotals = Array(24).fill(0);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 24; c++) {
        hourTotals[c] += matrix[r][c];
      }
    }
    let minSum = Infinity;
    let quietestStart = 0;
    for (let start = 0; start < 24; start++) {
      let sum = 0;
      for (let i = 0; i < 8; i++) {
        sum += hourTotals[(start + i) % 24];
      }
      if (sum < minSum) {
        minSum = sum;
        quietestStart = start;
      }
    }
    let offset = -0.5 - quietestStart;
    if (offset < -12) offset += 24;
    if (offset > 14) offset -= 24;
    const estOffset = Math.round(offset);
    const peakHour = (quietestStart + 16) % 24;
    return t("apTzHint", { hour: peakHour, offset: `${estOffset >= 0 ? '+' : ''}${estOffset}` });
  }, [stats, t]);

  const commonWords = useMemo(() => {
    if (!stats?.wordFreqs) return { list: [], maxN: 1 };

    let freqs;
    if (activeTab === 'posts') {
      freqs = stats.wordFreqs.posts || {};
    } else if (activeTab === 'comments') {
      freqs = stats.wordFreqs.comments || {};
    } else {
      freqs = {};
      for (const type of ['posts', 'comments']) {
        const wf = stats.wordFreqs[type] || {};
        for (const [word, counts] of Object.entries(wf)) {
          if (!freqs[word]) freqs[word] = { total: 0, items: 0 };
          freqs[word].total += counts.total;
          freqs[word].items += counts.items;
        }
      }
    }

    const key = 'total';
    const sorted = Object.entries(freqs)
      .sort((a, b) => b[1][key] - a[1][key])
      .slice(0, 20);
    const maxN = sorted.length > 0 ? sorted[0][1][key] : 1;
    return { list: sorted.map(([word, counts]) => [word, counts[key]]), maxN };
  }, [stats, activeTab]);

  return (
    <div className="flex flex-col gap-4 mb-4 mt-4">
      <div className="text-xs text-[color:var(--text-muted)] font-medium px-1 flex items-center gap-2 h-5">
        <span>{t("apBasedOn", { n: totalItems.toLocaleString() })}</span>
        {isCrawling && <span className="text-[color:var(--accent-text)] italic">· {t("apUpdating")}</span>}
        <span>&middot;</span>
        <button
          onClick={onRefresh}
          disabled={isCrawling}
          className={`text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors p-1 -m-1 ${isCrawling ? 'animate-spin cursor-default opacity-50' : ''}`}
          title={isCrawling ? t("apUpdating") : t("apRefreshTitle")}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6"></path>
            <path d="M1 20v-6h6"></path>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
        <span>&middot;</span>
        <button
          onClick={handleToggleSave}
          className={`flex items-center gap-1 transition-colors px-1.5 py-0.5 -mx-1.5 rounded ${isSaved ? 'text-amber-500 hover:text-amber-600 bg-amber-500/10' : 'text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--accent)]/10'}`}
          title={isSaved ? t("apSavedTitle") : t("apSaveTitle")}
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0" stroke="currentColor" strokeWidth="1.5" fill={isSaved ? "currentColor" : "none"} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
          <span className="text-[10px] uppercase font-bold leading-none translate-y-[0.5px]">{isSaved ? t("apSaved") : t("apSave")}</span>
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm">
            <h3 className="text-sm font-semibold text-[color:var(--text)] mb-3">{t("apTopSubs")}</h3>
            <div className="flex flex-col gap-1.5">
                {topSubreddits.list.map(([sub, count]) => <div key={sub} className="relative flex items-center justify-between text-[12px] h-6 z-0">
                        <div className="absolute left-0 top-0 bottom-0 bg-[color:var(--accent)] opacity-20 rounded-sm -z-10" style={{
        width: `${count / topSubreddits.max * 100}%`
      }}></div>
                        <a href={`${REDDIT_BASE}/r/${sub}`} target="_blank" rel="noopener noreferrer" className="font-medium text-[color:var(--text)] hover:underline pl-1.5 truncate">
                            r/{sub}
                        </a>
                        <span className="text-[color:var(--text-muted)] font-medium pr-1.5">{count}</span>
                    </div>)}
            </div>
        </div>
        
        <div className="flex-[2] bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-[color:var(--text)]">{t("apActivity")}</h3>
                    <HoverHint hint={
                        <div className="flex items-center gap-1.5 text-[9px] font-medium text-[color:var(--text-muted)]">
                            <span>{t("apLess")}</span>
                            <div className="flex gap-0.5">
                                <div className="w-2.5 h-2.5 rounded-sm bg-[color:var(--border)] opacity-30" />
                                <div className="w-2.5 h-2.5 rounded-sm bg-[color:var(--accent)] opacity-40" />
                                <div className="w-2.5 h-2.5 rounded-sm bg-[color:var(--accent)] opacity-60" />
                                <div className="w-2.5 h-2.5 rounded-sm bg-[color:var(--accent)] opacity-80" />
                                <div className="w-2.5 h-2.5 rounded-sm bg-[color:var(--accent)] opacity-100" />
                            </div>
                            <span>{t("apMore")}</span>
                        </div>
                    }>
                        <div className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors cursor-help flex items-center justify-center translate-y-[1px]">
                            <IconInfo />
                        </div>
                    </HoverHint>
                </div>
                {tzHint && <span className="text-[10px] text-[color:var(--text-muted)] italic">{tzHint}</span>}
            </div>
            <div className="min-w-[400px]">
                <div className="grid grid-cols-[30px_repeat(24,_1fr)] gap-0.5 mb-1 text-[9px] text-[color:var(--text-muted)] text-center">
                    <div></div>
                    {[...Array(24)].map((_, i) => <div key={i}>{i % 4 === 0 ? i : ''}</div>)}
                </div>
                {heatmapData.matrix.map((row, r) => <div key={r} className="grid grid-cols-[30px_repeat(24,_1fr)] gap-0.5 mb-0.5">
                        <div className="text-[10px] text-[color:var(--text-muted)] pr-2 text-right leading-relaxed">{days[r]}</div>
                        {row.map((count, c) => {
        const intensity = count === 0 ? 0 : levels[Math.min(3, Math.floor((count / heatmapData.maxCount) * 4))];
        return <HoverHint key={c} hint={t("apHeatCell", { day: days[r], hour: c, n: count })} className="w-full h-full min-h-[12px] flex">
                                <div className="rounded-sm w-full h-full" style={{
          backgroundColor: count === 0 ? 'var(--border)' : 'var(--accent)',
          opacity: count === 0 ? 0.2 : intensity
        }}></div>
                            </HoverHint>;
      })}
                    </div>)}
            </div>
        </div>
      </div>

      {commonWords.list.length > 0 && (
        <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-[color:var(--text)]">{t("apCommonWords")}</h3>
              <HoverHint hint={t("apCountsFrom", { tab: activeTab })}>
                <div className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors cursor-help flex items-center justify-center translate-y-[1px]">
                  <IconInfo />
                </div>
              </HoverHint>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-2 leading-none">
            {commonWords.list.map(([word, n]) => (
              <HoverHint key={word} hint={t("apWordTotal", { n })}>
                <button
                  type="button"
                  onClick={() => onWordClick?.(word)}
                  className="text-[color:var(--accent-text)] hover:text-[color:var(--text)] hover:underline transition-colors cursor-pointer bg-transparent border-none p-0 leading-none"
                  style={{ fontSize: `${11 + (n / commonWords.maxN) * 8}px` }}
                >
                  {word}
                </button>
              </HoverHint>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default AccountProfile;
