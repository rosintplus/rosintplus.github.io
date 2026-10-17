import { memo, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { HoverHint } from '../HoverHint.jsx';
import { IconInfo } from '../icons.jsx';
import { REDDIT_BASE } from '../../api/client.js';
import { fetchSubredditInteractions } from '../../api/endpoints.js';
import { useI18n, LOCALES } from '../../i18n.js';
import { toggleProfileSaved, getSavedUsernames } from '../../profile/cache.js';
import { evaluatePoliticalCompass, classifyQuadrant } from '../../politicalCompass.js';
import { getDays, levels, cleanDimensionLabel } from './helpers.js';
import { getArchetypeColorClass, getPolarityColorClass, weightedCache } from './archetype.js';
import { fmtNum } from '../../utils.js';

// Memoized heatmap cell: the 7×24 grid mounts 168 HoverHint instances. Without
// memo, every parent render (crawl progress, AI status) re-renders all 168
// cells + tooltips. Props are primitives, so memo skips unchanged cells.
const HeatCell = memo(function HeatCell({ count, maxCount, hint }) {
  const intensity = count === 0 ? 0 : levels[Math.min(3, Math.floor((count / maxCount) * 4))];
  return <HoverHint hint={hint} className="w-full h-full min-h-[12px] flex">
    <div role="img" aria-label={hint} className="rounded-sm w-full h-full" style={{
      backgroundColor: count === 0 ? 'var(--border)' : 'var(--accent)',
      opacity: count === 0 ? 0.2 : intensity
    }}></div>
  </HoverHint>;
});

// Isolated heat grid: parent AccountProfile re-renders on every crawl
// progress tick (crawledCount/loadedCount/isCrawling), but this memo child
// only re-renders when the heatmap data itself changes. Combined with the
// memoized HeatCell above (primitive props only), unchanged cells skip
// reconciliation entirely during crawl ticks.
// Locale-neutral: apHeatCell hour/n stay raw ints (axis coordinates, not
// display numbers) — intentionally not fmtNum.
const ActivityHeatmap = memo(function ActivityHeatmap({ matrix, maxCount, days, t }) {
  return (
    <div className="min-w-0 w-full overflow-x-auto">
      <div className="grid grid-cols-[30px_repeat(24,_1fr)] gap-0.5 mb-1 text-[9px] text-[color:var(--text-muted)] text-center">
        <div></div>
        {[...Array(24)].map((_, i) => <div key={i}>{i % 4 === 0 ? i : ''}</div>)}
      </div>
      {matrix.map((row, r) => <div key={r} className="grid grid-cols-[30px_repeat(24,_1fr)] gap-0.5 mb-0.5">
        <div className="text-[10px] text-[color:var(--text-muted)] pr-2 text-right leading-relaxed">{days[r]}</div>
        {row.map((count, c) => <HeatCell key={c} count={count} maxCount={maxCount} hint={t("apHeatCell", { day: days[r], hour: c, n: count })} />)}
      </div>)}
    </div>
  );
});

const AccountProfile = memo(function AccountProfile({
  query,
  activeTab,
  onWordClick,
  stats,
  userMeta,
  loadedCount,
  crawledCount = 0,
  crawlCapped = false,
  isCrawling,
  onRefresh,
  onStopCrawl,
  posts = [],
  comments = [],
}) {
  const { t, lang } = useI18n();
  const fmtN = n => { try { return Number(n).toLocaleString(LOCALES[lang] || "en"); } catch { return String(n); } };
  const fmtSigned = n => {
    const v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    const mag = fmtN(Math.abs(v));
    if (v > 0) return `+${mag}`;
    if (v < 0) return `-${mag}`;
    return mag;
  };
  const tx = (key, fallback) => {
    if (!key) return fallback;
    const s = t(key);
    return s === key ? fallback : s;
  };
  const days = useMemo(() => getDays(LOCALES[lang] || "en"), [lang]);
  const [isSaved, setIsSaved] = useState(false);
  const [showCompassSignals, setShowCompassSignals] = useState(false);
  const [showStancesDrawer, setShowStancesDrawer] = useState(false);

  useEffect(() => {
    if (!query) return;
    const checkSaved = () => {
      getSavedUsernames()
        .then(keys => setIsSaved(Array.isArray(keys) && keys.some(k => String(k).toLowerCase() === String(query).toLowerCase())))
        .catch(() => setIsSaved(false));
    };
    checkSaved();
    window.addEventListener('savedUsersChanged', checkSaved);
    return () => window.removeEventListener('savedUsersChanged', checkSaved);
  }, [query]);

  // Archive-wide total, or null when the users endpoint has not answered (or
  // failed). null means "unknown" — never treat it as equal to what is loaded.
  const archiveTotal = (typeof userMeta?.num_posts === 'number' && typeof userMeta?.num_comments === 'number')
    ? (userMeta.num_posts + userMeta.num_comments)
    : null;

  const effectiveUserMeta = useMemo(() => {
    if (userMeta) return userMeta;
    let minUtc = null;
    let sumKarma = 0;
    for (const p of posts) {
      if (p.score) sumKarma += p.score;
      if (p.created_utc && (!minUtc || p.created_utc < minUtc)) minUtc = p.created_utc;
    }
    for (const c of comments) {
      if (c.score) sumKarma += c.score;
      if (c.created_utc && (!minUtc || c.created_utc < minUtc)) minUtc = c.created_utc;
    }
    return {
      num_posts: posts.length,
      num_comments: comments.length,
      total_karma: sumKarma,
      earliest_post_at: minUtc,
      earliest_comment_at: minUtc,
    };
  }, [userMeta, posts, comments]);

  const handleToggleSave = useCallback(async () => {
    const newState = !isSaved;
    setIsSaved(newState);
    try {
      await toggleProfileSaved(query, newState, stats, {
        posts: effectiveUserMeta?.num_posts ?? posts.length,
        comments: effectiveUserMeta?.num_comments ?? comments.length,
      });
    } catch (err) {
      console.error("Save error:", err);
      setIsSaved(!newState);
    }
  }, [query, isSaved, stats, effectiveUserMeta, posts.length, comments.length]);

  const [weightedSubs, setWeightedSubs] = useState(() => weightedCache.get(query?.toLowerCase() || "") || null);
  useEffect(() => {
    if (!query) { setWeightedSubs(null); return; }
    const key = query.toLowerCase();
    if (weightedCache.has(key)) {
      setWeightedSubs(weightedCache.get(key));
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    fetchSubredditInteractions(query, { signal: ctrl.signal }).then(res => {
      if (cancelled) return;
      const list = (res.data || [])
        .map(r => [r.subreddit || r.target || r.name, r.count ?? r.interactions ?? 0])
        .filter(([name, c]) => name && c > 0)
        .slice(0, 8);
      const val = list.length ? list : null;
      if (val) weightedCache.set(key, val);
      else weightedCache.delete(key);
      setWeightedSubs(val);
    }).catch(() => {
      if (!cancelled) {
        // Don't poison cache with permanent null — allow retry on next mount.
        weightedCache.delete(key);
        setWeightedSubs(null);
      }
    }).finally(() => clearTimeout(t));
    return () => { cancelled = true; ctrl.abort(); clearTimeout(t); };
  }, [query]);

  const topSubreddits = useMemo(() => {
    if (weightedSubs && weightedSubs.length) {
      const max = weightedSubs[0][1] || 1;
      return { list: weightedSubs, max, isWeighted: true };
    }
    if (!stats?.subredditCounts) return { list: [], max: 1, isWeighted: false };
    const counts = stats.subredditCounts;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = sorted.length > 0 ? sorted[0][1] : 1;
    return { list: sorted, max, isWeighted: false };
  }, [stats, weightedSubs]);

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
    if (hourTotals.reduce((a, b) => a + b, 0) === 0) return null;
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
    // Locale-neutral: apTzHint hour/offset stay raw (UTC hour + +/-offset —
    // axis values, not display numbers) — intentionally not fmtNum.
    return t("apTzHint", { hour: peakHour, offset: `${estOffset >= 0 ? '+' : ''}${estOffset}` });
  }, [stats, t]);

  const commonWords = useMemo(() => {
    if (!stats?.wordFreqs) return { list: [], maxN: 1 };
    const totalOf = v => (typeof v === 'object' && v !== null ? (v.total ?? 0) : (Number(v) || 0));

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
          const cTotal = typeof counts === 'object' && counts !== null ? (counts.total ?? 0) : (Number(counts) || 0);
          const cItems = typeof counts === 'object' && counts !== null ? (counts.items ?? cTotal) : (Number(counts) || 0);
          freqs[word].total += cTotal;
          freqs[word].items += cItems;
        }
      }
    }

    const sorted = Object.entries(freqs)
      .sort((a, b) => totalOf(b[1]) - totalOf(a[1]))
      .slice(0, 20);
    const maxN = sorted.length > 0 ? (totalOf(sorted[0][1]) || 1) : 1;
    return { list: sorted.map(([word, counts]) => [word, totalOf(counts)]), maxN };
  }, [stats, activeTab]);

  const hasItems = (posts?.length || 0) > 0 || (comments?.length || 0) > 0 || Object.keys(stats?.subredditCounts || {}).length > 0;

  // The compass is computed by a deterministic local engine (see
  // politicalCompass.js): Laver & Garry (2000) pro/con balance over a
  // content-analysis dictionary, pooled meta-analytically with a
  // Poole-Rosenthal ideal point from the community footprint. No model, no
  // API, no key — it runs entirely in this browser.
  const compassResult = useMemo(() => {
    if (!query || !hasItems) return null;
    try {
      return evaluatePoliticalCompass({ stats: stats || {}, posts: posts || [], comments: comments || [] });
    } catch {
      return null;
    }
  }, [query, hasItems, stats, posts, comments]);

  // Quadrant hysteresis. The reading legitimately moves while the background
  // crawl is adding items; holding the previous quadrant (until the reading
  // clearly leaves it) stops the badge flip-flopping between two labels.
  //
  // The held value lives in a ref that is updated in an effect, never during
  // render: mutating a ref inside useMemo is a side effect, and React may
  // re-run or discard memo factories (StrictMode double-invokes them).
  const lastQuadrantRef = useRef(null);
  const compassAnalysis = useMemo(() => {
    const subFootprint = () => Object.entries(stats?.subredditCounts || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sub, count]) => ({ sub, count, econ: 0, soc: 0, gov: 0, weight: count }));

    if (compassResult) {
      // Hysteresis: hold the previous quadrant unless the reading has clearly
      // left it. The ref is only *read* here; it is written by the effect
      // below, so this factory stays pure.
      const classified = classifyQuadrant(compassResult.econ, compassResult.gov, {
        prevQuadrant: lastQuadrantRef.current
      });

      const noSignalArchetypeKey = isCrawling ? "compassCrawling" : "compassConfNoSignal";
      return {
        hasSignal: compassResult.hasSignal,
        econ: compassResult.econ,
        soc: compassResult.soc,
        gov: compassResult.gov,
        x: Math.max(-1, Math.min(1, compassResult.econ / 10)),
        y: Math.max(-1, Math.min(1, compassResult.gov / 10)),
        archetype: compassResult.hasSignal
          ? classified.label
          : (isCrawling ? "Crawling items..." : "Insufficient signal"),
        archetypeKey: compassResult.hasSignal
          ? classified.labelKey
          : noSignalArchetypeKey,
        quadrant: classified.quadrant,
        heldQuadrant: classified.held,
        confidence: compassResult.confidence,
        confidenceKey: compassResult.confidenceKey,
        summary: null,
        evidence: compassResult.evidence,
        dimensions: compassResult.dimensions,
        detectedPositions: compassResult.detectedPositions,
        topSubSignals: compassResult.topSubSignals?.length ? compassResult.topSubSignals : subFootprint(),
        // While crawling the evidence base is still growing, so the reading
        // is marked provisional rather than silently changing underfoot.
        provisional: isCrawling
      };
    }

    return {
      hasSignal: false,
      econ: 0, soc: 0, gov: 0, x: 0, y: 0,
      archetype: isCrawling ? "Crawling items..." : "Gathering evidence",
      archetypeKey: isCrawling ? "compassCrawling" : "compassGathering",
      quadrant: 'center',
      heldQuadrant: false,
      confidence: isCrawling ? "Collecting user history" : "Gathering evidence",
      confidenceKey: isCrawling ? "compassCollecting" : "compassGathering",
      summary: null,
      evidence: null,
      dimensions: null,
      detectedPositions: [],
      topSubSignals: subFootprint(),
      provisional: isCrawling
    };
  }, [compassResult, stats, isCrawling]);

  // Record the quadrant actually displayed so the next render can hold it.
  // Runs after commit, not during render.
  useEffect(() => {
    if (compassAnalysis.heldQuadrant !== undefined && compassAnalysis.quadrant && compassAnalysis.quadrant !== 'center') {
      lastQuadrantRef.current = compassAnalysis.quadrant;
    }
  }, [compassAnalysis.quadrant, compassAnalysis.heldQuadrant]);

  // Reset hysteresis when the subject changes.
  useEffect(() => { lastQuadrantRef.current = null; }, [query]);

  if (!stats && (!posts || posts.length === 0) && (!comments || comments.length === 0)) {
    return (
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg p-6 text-center text-xs text-[color:var(--text-muted)] mt-4">
        {t("apLoadingProfile")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 mb-4 mt-4 text-[color:var(--text)]">
      {/* Metadata & Actions Header Bar */}
      <div className="text-[11px] sm:text-xs text-[color:var(--text-muted)] font-medium px-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
        <span title={crawlCapped ? t("apCrawlSampleHint") : undefined}>
          {(() => {
            const fmt = n => { try { return Number(n).toLocaleString(LOCALES[lang] || "en"); } catch { return String(n); } };
            // Always show a denominator: the archive total when it is known,
            // otherwise the largest count we have actually seen.
            const total = Math.max(loadedCount, archiveTotal || 0, (posts?.length || 0) + (comments?.length || 0));
            const complete = total > 0 && loadedCount >= total;
            if (crawlCapped && !complete && !isCrawling) return t("apBasedOnSample", { loaded: fmt(loadedCount), total: fmt(total) });
            return t("apBasedOnTotal", { loaded: fmt(loadedCount), total: fmt(total) });
          })()}
        </span>
        {isCrawling && (
          <span role="status" className="text-[color:var(--accent-text)] italic flex items-center gap-1">
            <span>· {t("apUpdating")}</span>
            {onStopCrawl && (
              <button
                type="button"
                onClick={onStopCrawl}
                className="text-[10px] text-[color:var(--danger)] font-semibold px-1.5 py-0.5 rounded bg-[color:var(--danger)]/10 border border-[color:var(--danger)]/20 hover:bg-[color:var(--danger)]/20 transition-colors cursor-pointer not-italic ml-1"
                title={t("apStopCrawlTitle")}
              >
                {t("apStopCrawl")}
              </button>
            )}
          </span>
        )}
        <span>&middot;</span>
        <button
          onClick={onRefresh}
          disabled={isCrawling}
          aria-label={isCrawling ? t("apUpdating") : t("apRefreshTitle")}
          className={`text-[color:var(--text-muted)] hover:text-[color:var(--accent)] transition-colors p-1 -m-1 cursor-pointer ${isCrawling ? 'animate-spin cursor-default opacity-50' : ''}`}
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
          className={`flex items-center gap-1 transition-colors px-1.5 py-0.5 -mx-1.5 rounded cursor-pointer ${isSaved ? 'text-[color:var(--warn)] hover:text-[color:var(--warn)] bg-[color:var(--warn)]/10' : 'text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--accent)]/10'}`}
          title={isSaved ? t("apSavedTitle") : t("apSaveTitle")}
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0" stroke="currentColor" strokeWidth="1.5" fill={isSaved ? "currentColor" : "none"} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
          <span className="text-[10px] uppercase font-bold leading-none translate-y-[0.5px]">{isSaved ? t("apSaved") : t("apSave")}</span>
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg px-4 py-3 shadow-sm">
            <h3 className="text-sm font-semibold text-[color:var(--text)] mb-3 flex items-center gap-1.5">{t("apTopSubs")}</h3>
            <div className="flex flex-col gap-1.5">
                {topSubreddits.list.map(([sub, count]) => <div key={sub} className="relative flex items-center justify-between text-[12px] h-6 z-0">
                        <div className="absolute left-0 top-0 bottom-0 bg-[color:var(--accent)] opacity-20 rounded-sm -z-10" style={{
        width: `${count / topSubreddits.max * 100}%`
      }}></div>
                        <a href={`${REDDIT_BASE}/r/${sub}`} target="_blank" rel="noopener noreferrer" className="font-medium text-[color:var(--text)] hover:underline pl-1.5 truncate">
                            r/{sub}
                        </a>
                        <span className="text-[color:var(--text-muted)] font-medium pr-1.5">{fmtNum(count, LOCALES[lang] || "en")}</span>
                    </div>)}
            </div>
        </div>
        
        <div className="flex-[2] bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg px-4 py-3 shadow-sm overflow-x-auto">
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
            <ActivityHeatmap matrix={heatmapData.matrix} maxCount={heatmapData.maxCount} days={days} t={t} />
        </div>
      </div>

      {/* Common words */}
      {commonWords.list.length > 0 && (
        <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-[color:var(--text)]">{t("apCommonWords")}</h3>
              <HoverHint hint={t("apCountsFrom", { tab: activeTab === 'comments' ? t("commentsWord") : activeTab === 'posts' ? t("postsWord") : `${t("postsWord")} + ${t("commentsWord")}` })}>
                <div className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors cursor-help flex items-center justify-center translate-y-[1px]">
                  <IconInfo />
                </div>
              </HoverHint>
            </div>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
            {commonWords.list.map(([word, n]) => {
              const fontSize = Math.round(11 + (n / commonWords.maxN) * 8);
              return (
                <HoverHint key={word} hint={t("apWordTotal", { n })}>
                  <button
                    type="button"
                    onClick={() => onWordClick?.(word)}
                    className="text-[color:var(--text)] hover:text-[color:var(--accent-text)] hover:underline transition-colors cursor-pointer leading-tight bg-transparent border-none p-0"
                    style={{
                      fontSize: `${fontSize}px`,
                      fontWeight: fontSize > 14 ? 600 : 400
                    }}
                  >
                    {word}
                  </button>
                </HoverHint>
              );
            })}
          </div>
        </div>
      )}

      {/* Political Compass Card */}
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg p-3 sm:p-4 shadow-sm flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)]/60 pb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <div className="flex items-center gap-1 shrink-0">
              <h3 className="text-sm font-semibold tracking-wide text-[color:var(--text)]">{t("apPoliticalCompass")}</h3>
              <HoverHint hint={t("apCompassHint")}>
                <div className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors cursor-help flex items-center justify-center">
                  <IconInfo />
                </div>
              </HoverHint>
            </div>

            {compassAnalysis.archetype && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase truncate max-w-[200px] ${getArchetypeColorClass(compassAnalysis.archetype)}`}>
                {tx(compassAnalysis.archetypeKey, compassAnalysis.archetype)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {compassAnalysis.hasSignal && (compassAnalysis.econ !== 0 || compassAnalysis.gov !== 0) ? (
              <>
                <span className="text-[10px] sm:text-[10.5px] font-mono text-[color:var(--text-muted)]">
                  {/* Locale-neutral: apEconGov signed decimals stay via fmtSigned (grouped, not compact) — axis values, not display counts. */}
                  {t("apEconGov", {
                    econ: fmtSigned(compassAnalysis.econ),
                    gov: fmtSigned(compassAnalysis.gov),
                  })}
                </span>
                {compassAnalysis.provisional && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[color:var(--bg)] text-[color:var(--text-faint)] border border-[color:var(--border)]">
                    {t("apCompassProvisional")}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[10px] sm:text-[10.5px] text-[color:var(--text-muted)] italic">
                {isCrawling ? t("apCrawling") : t("apCompassNoReading")}
              </span>
            )}

          </div>
        </div>

        {/* Clear Crawling Status / Live Progress Banner */}
        {isCrawling && (
          <div role="status" className="flex items-center justify-between bg-[color:var(--bg)] border border-[color:var(--border)] rounded-md p-2.5 text-xs text-[color:var(--text-muted)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-[color:var(--accent)] animate-ping shrink-0"></span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold text-[color:var(--text)] truncate">{t("apCrawlingHistory")}</span>
                <span className="text-[10.5px] text-[color:var(--text-faint)] truncate">
                  {t("apLoaded", { n: (() => { try { return (loadedCount || 0).toLocaleString(LOCALES[lang] || "en"); } catch { return String(loadedCount || 0); } })() })} ({crawledCount > 0 ? t("apBackgroundItems", { n: (() => { try { return crawledCount.toLocaleString(LOCALES[lang] || "en"); } catch { return String(crawledCount); } })() }) : t("apFetchingBatches")})
                </span>
              </div>
            </div>
            {onStopCrawl && (
              <button
                type="button"
                onClick={onStopCrawl}
                className="px-2 py-1 rounded bg-[color:var(--bg-elevated)] hover:bg-[color:var(--danger)]/15 border border-[color:var(--border)] hover:border-[color:var(--danger)]/30 text-[11px] font-semibold text-[color:var(--danger)] transition-colors cursor-pointer shrink-0 ml-2"
                title={t("apStopCrawlTitle")}
              >
                × {t("apStopCrawl")}
              </button>
            )}
          </div>
        )}




        {!compassAnalysis.hasSignal && !isCrawling && (
          <div className="flex flex-col gap-1.5 py-0.5">
            <div className="text-[11.5px] text-[color:var(--text-muted)] leading-relaxed">
              {t("apNoFootprintBody")}
            </div>
            {compassAnalysis.evidence && (
              <div className="font-mono text-[10.5px] text-[color:var(--text-faint)]">
                {t("apCompassNoSignalWhy", {
                  items: (() => { try { return (loadedCount || 0).toLocaleString(LOCALES[lang] || "en"); } catch { return String(loadedCount || 0); } })(),
                  topics: compassAnalysis.evidence.distinctTopics || 0,
                  subs: (compassAnalysis.topSubSignals || []).length,
                })}
              </div>
            )}
          </div>
        )}


        {/* Method + evidence basis. Shown for the local engine so the reading
            is never presented without how much evidence stands behind it. */}
        {compassAnalysis.hasSignal && compassAnalysis.evidence && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-[color:var(--text-faint)] px-0.5">
            <span className="font-semibold uppercase tracking-wider">{t("apCompassMethod")}</span>
            <span aria-hidden="true">·</span>
            <span>{tx(compassAnalysis.confidenceKey, compassAnalysis.confidence)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              {t("apCompassEvidence", {
                weight: fmtN(compassAnalysis.evidence.totalWeight),
                topics: fmtN(compassAnalysis.evidence.distinctTopics),
                subs: fmtN(compassAnalysis.evidence.communityWeight > 0 ? Math.max(1, (compassAnalysis.topSubSignals || []).length) : 0),
                reliability: fmtN(compassAnalysis.evidence.reliability),
              })}
            </span>
            {compassAnalysis.evidence.se && (
              <span className="font-mono" title={t("apCompassMethodNote")}>
                {t("apCompassSe", {
                  e: fmtN(compassAnalysis.evidence.se.econ ?? 0),
                  s: fmtN(compassAnalysis.evidence.se.soc ?? 0),
                  g: fmtN(compassAnalysis.evidence.se.gov ?? 0),
                })}
              </span>
            )}
          </div>
        )}

        {compassAnalysis.hasSignal ? (
          <div className="flex flex-col gap-4">
            {/* Grid & Multi-Axis Dimension Meters in 2-Column Responsive Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
              {/* Left Column: Crisp Compass Grid stretched to full height */}
              <div className="relative w-full max-w-[280px] mx-auto md:max-w-none h-full min-h-[220px] aspect-square md:aspect-auto bg-[color:var(--bg)] border border-[color:var(--border)] rounded-lg overflow-hidden select-none">
                {/* 4 Quadrants with Authentic Compass Colors */}
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 pointer-events-none">
                  <div className="border-r border-b border-[color:var(--border)] bg-[color:var(--quad-auth-left)]/15 relative p-2 sm:p-2.5 flex items-start justify-start">
                    <span className="text-[9px] sm:text-[9.5px] font-bold text-[color:var(--quad-auth-left)] uppercase tracking-wider">{t("compassGridAuthLeft")}</span>
                  </div>
                  <div className="border-b border-[color:var(--border)] bg-[color:var(--quad-auth-right)]/15 relative p-2 sm:p-2.5 flex items-start justify-end">
                    <span className="text-[9px] sm:text-[9.5px] font-bold text-[color:var(--quad-auth-right)] uppercase tracking-wider">{t("compassGridAuthRight")}</span>
                  </div>
                  <div className="border-r border-[color:var(--border)] bg-[color:var(--quad-lib-left)]/15 relative p-2 sm:p-2.5 flex items-end justify-start">
                    <span className="text-[9px] sm:text-[9.5px] font-bold text-[color:var(--quad-lib-left)] uppercase tracking-wider">{t("compassGridLibLeft")}</span>
                  </div>
                  <div className="bg-[color:var(--quad-lib-right)]/15 relative p-2 sm:p-2.5 flex items-end justify-end">
                    <span className="text-[9px] sm:text-[9.5px] font-bold text-[color:var(--quad-lib-right)] uppercase tracking-wider">{t("compassGridLibRight")}</span>
                  </div>
                </div>

                {/* Static Pinpoint Indicator */}
                <div
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all duration-700 ease-out flex items-center justify-center"
                  style={{
                    left: `${50 + (compassAnalysis.x * 43)}%`,
                    top: `${50 - (compassAnalysis.y * 43)}%`,
                  }}
                >
                  <div className="relative flex items-center justify-center">
                    <span className="w-3.5 h-3.5 rounded-full bg-[color:var(--bg)] border-2 border-[color:var(--text-muted)] shadow-lg shadow-black/60"></span>
                  </div>
                </div>
              </div>

              {/* Right Column: Multi-Axis Dimension Spectrums stretched to full height */}
              <div className="flex flex-col justify-between gap-3 sm:gap-3.5 bg-[color:var(--bg)] border border-[color:var(--border)] rounded-lg p-3 sm:p-3.5 h-full">
                <span className="text-[11px] font-semibold text-[color:var(--text)] uppercase tracking-wider">
                  {t("apDimensions")}
                </span>

                {/* 1. Economic Spectrum */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] sm:text-[11.5px]">
                    <span className="text-[color:var(--text-muted)] font-medium shrink-0">{t("apEconomy")}</span>
                    <span className="font-semibold text-[color:var(--info)] text-right">{cleanDimensionLabel(tx(compassAnalysis.dimensions?.econ?.labelKey, compassAnalysis.dimensions?.econ?.label))}</span>
                  </div>
                  <div className="relative h-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 bg-[color:var(--info)] rounded-full transition-all duration-500 shadow-sm"
                      style={{
                        left: `${Math.min(50, 50 + (compassAnalysis.econ * 5))}%`,
                        width: `${Math.max(4, Math.abs(compassAnalysis.econ * 5))}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[8.5px] sm:text-[9.5px] text-[color:var(--text-faint)]">
                    <span>{t("apEconLeft")}</span>
                    <span>{t("apEconMid")}</span>
                    <span>{t("apEconRight")}</span>
                  </div>
                </div>

                {/* 2. Social & Cultural Spectrum */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] sm:text-[11.5px]">
                    <span className="text-[color:var(--text-muted)] font-medium shrink-0">{t("apSocial")}</span>
                    <span className="font-semibold text-[color:var(--success)] text-right">{cleanDimensionLabel(tx(compassAnalysis.dimensions?.soc?.labelKey, compassAnalysis.dimensions?.soc?.label))}</span>
                  </div>
                  <div className="relative h-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 bg-[color:var(--success)] rounded-full transition-all duration-500 shadow-sm"
                      style={{
                        left: `${Math.min(50, 50 + (compassAnalysis.soc * 5))}%`,
                        width: `${Math.max(4, Math.abs(compassAnalysis.soc * 5))}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[8.5px] sm:text-[9.5px] text-[color:var(--text-faint)]">
                    <span>{t("apSocLeft")}</span>
                    <span>{t("apSocMid")}</span>
                    <span>{t("apSocRight")}</span>
                  </div>
                </div>

                {/* 3. Governance & Authority Spectrum */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] sm:text-[11.5px]">
                    <span className="text-[color:var(--text-muted)] font-medium shrink-0">{t("apGovernance")}</span>
                    <span className="font-semibold text-[color:var(--auth-center)] text-right">{cleanDimensionLabel(tx(compassAnalysis.dimensions?.gov?.labelKey, compassAnalysis.dimensions?.gov?.label))}</span>
                  </div>
                  <div className="relative h-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 bg-[color:var(--auth-center)] rounded-full transition-all duration-500 shadow-sm"
                      style={{
                        left: `${Math.min(50, 50 + (compassAnalysis.gov * 5))}%`,
                        width: `${Math.max(4, Math.abs(compassAnalysis.gov * 5))}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[8.5px] sm:text-[9.5px] text-[color:var(--text-faint)]">
                    <span>{t("apGovLeft")}</span>
                    <span>{t("apGovMid")}</span>
                    <span>{t("apGovRight")}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tracked Political Positions & Viewpoint Assertions Drawer */}
            {compassAnalysis.detectedPositions?.length > 0 && (
              <div className="border-t border-[color:var(--border)]/60 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStancesDrawer(p => !p)}
                  className="text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--text)] flex items-center justify-between w-full font-medium cursor-pointer"
                >
                  <span>{t("apTracked", { n: compassAnalysis.detectedPositions.length })}</span>
                  <span className="text-[10px] text-[color:var(--accent-text)]">{showStancesDrawer ? t("apHide") : t("apShow")}</span>
                </button>

                {showStancesDrawer && (
                  <div className="mt-2 flex flex-col gap-2.5 bg-[color:var(--bg)] border border-[color:var(--border)] rounded-lg p-3">
                    <div className="text-[10px] text-[color:var(--text-faint)]">{t("apExtractedFrom")}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {compassAnalysis.detectedPositions.map((pos, idx) => (
                        <div key={idx} className="flex flex-col gap-1.5 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-md p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[color:var(--text-muted)] text-[11px] uppercase tracking-wide">{pos.topic}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${getPolarityColorClass(pos.polarity)}`}>
                              {pos.polarityKeys?.length ? pos.polarityKeys.map((k, i) => tx(k, String(pos.polarity || '').split(" · ")[i] || k)).join(" · ") : pos.polarity}
                            </span>
                          </div>
                          <div className="font-semibold text-[color:var(--text)] text-[13px] leading-snug">{pos.stance}</div>
                          {pos.snippet && (
                            <div className="text-[12px] italic text-[color:var(--text-muted)] leading-relaxed bg-[color:var(--bg)] border border-[color:var(--border)]/60 rounded p-2 mt-0.5">
                              {pos.snippet}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Contributing Subreddits Drawer */}
            {compassAnalysis.topSubSignals.length > 0 && (
              <div className="border-t border-[color:var(--border)]/60 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCompassSignals(p => !p)}
                  className="text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--text)] flex items-center justify-between w-full font-medium"
                >
                  <span>{t("apSubFootprint", { n: compassAnalysis.topSubSignals.length })}</span>
                  <span className="text-[10px] text-[color:var(--accent-text)]">{showCompassSignals ? t("apHide") : t("apShow")}</span>
                </button>

                {showCompassSignals && (
                  <div className="mt-2 flex flex-col gap-2 text-[11px] bg-[color:var(--bg)] border border-[color:var(--border)] rounded p-2.5">
                    <div className="text-[10px] uppercase font-bold text-[color:var(--text-faint)] mb-1">{t("apSubFilterHint")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {compassAnalysis.topSubSignals.map(s => (
                        <button
                          key={s.sub}
                          type="button"
                          onClick={() => onWordClick?.(`r/${s.sub}`)}
                          title={t("apFilterFeed", { sub: s.sub })}
                          className="px-2 py-1 rounded bg-[color:var(--bg-elevated)] border border-[color:var(--border)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent-text)] text-[10px] transition-colors cursor-pointer flex items-center gap-1.5"
                        >
                          <span className="font-medium">r/{s.sub}</span>
                          <span className="text-[color:var(--text-muted)]">({fmtNum(s.count, LOCALES[lang] || "en")})</span>
                          {s.interactionTag && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-[color:var(--warn)]/20 text-[color:var(--warn)] border border-[color:var(--warn)]/30">
                              {s.interactionTag}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default AccountProfile;
