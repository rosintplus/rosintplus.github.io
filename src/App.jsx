import { safeFetch, REDDIT_BASE, ARCTIC, LIMIT } from "./api/client.js";
import { fetchBoth, fetchPostById, fetchCommentById, fetchCommentsForPost } from "./api/endpoints.js";
import { sleepAbortable } from "./api/client.js";
import { serializeCsv } from "./csv.js";
import { failureMessageKey, archiveFailureSummary } from "./archiveErrors.js";
import { downloadFile, normalizeUsername, normalizeSubreddit, parsePostInput, fmtNum, isValidDateString, parseLocalDayStartSec, parseLocalDayEndSec, sanitizeFilenameSegment, safeHttpUrl } from "./utils";
import { emptyStats, processItem } from "./profile/stats.js";
import { useI18n, LOCALES, LANGS, setLang, getLang } from "./i18n.js";
import { closeOnEscape } from "./constants.js";

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, lazy, Suspense, useDeferredValue } from "react";

import { Logo } from "./components/Logo.jsx";
import { HoverHint, HoverTime } from "./components/HoverHint.jsx";
import { IconExternal, IconSpinner, IconDownload, IconActivity, IconGitHub } from "./components/icons.jsx";
import { CopyButton } from "./components/CopyButton.jsx";
import { CardBoundary, PostCard, CommentCard, BADGE, isPost, itemType, getStatus, getPostThumbnail } from "./components/cards.jsx";
import { EmptyState, ErrorState, TabBtn } from "./components/states.jsx";
import { ThemeSwitcher } from "./components/ThemeSwitcher.jsx";
import { ModeSelector } from "./components/ModeSelector.jsx";
import { SearchBar } from "./components/SearchBar.jsx";
import { SearchFilters } from "./components/SearchFilters.jsx";
import { usePaginatedFetch } from "./hooks/usePaginatedFetch.js";
import { NO_DECORATION, tJsx, matchKeyword } from "./constants.js";

// Preserved public exports (previously defined in App.jsx).
export { HoverHint } from "./components/HoverHint.jsx";
export { HighlightText } from "./components/cards.jsx";
export { IconInfo } from "./components/icons.jsx";

const TABS = ["all", "posts", "comments"];

// Render budget for the result list. Previously 100 cards mounted at once
// (each with HighlightText regex, HoverHint portals, thumbnails, badges);
// 30 keeps first paint fast and Load More reveals the rest progressively.
const PAGE_SIZE = 30;

const AccountProfile = lazy(() => import('./components/profile/AccountProfile.jsx'));
const ProfileSummary = lazy(() => import('./components/profile/ProfileSummary.jsx'));

export default function App() {
  const [initialParams] = useState(() => Object.fromEntries(new URLSearchParams(window.location.search)));
  const _initialPostRaw = initialParams.post || initialParams.p || initialParams.postId || initialParams.id || "";
  const _initialPostParsed = (() => {
    const p = parsePostInput(_initialPostRaw);
    if (p) return p;
    const bare = String(_initialPostRaw || "").trim().replace(/^t3_/i, "");
    if (/^[a-z0-9]{5,10}$/i.test(bare) && _initialPostRaw) return { postId: bare.toLowerCase(), commentId: null, kind: "post" };
    const uAsPost = parsePostInput(initialParams.u || "");
    if (uAsPost) return uAsPost;
    return null;
  })();
  const [initialPostId] = useState(() => _initialPostParsed?.postId || null);
  const [selectedCommentId, setSelectedCommentId] = useState(() => _initialPostParsed?.commentId || null);
  const [selectedComment, setSelectedComment] = useState(null);
  const [initialMode] = useState(() => {
    if (_initialPostParsed) return "post";
    return initialParams.mode === "subreddit" || (!initialParams.u && initialParams.sub) ? "subreddit" : "username";
  });
  const [initialUser] = useState(() => {
    if (initialMode === "post") return _initialPostRaw || initialParams.u || "";
    return initialMode === "subreddit" ? normalizeSubreddit(initialParams.sub) : normalizeUsername(initialParams.u) || "";
  });
  const initialPostRaw = _initialPostRaw;
  const { t, lang } = useI18n();  const [mode, setMode] = useState(initialMode);
  const modeRef = useRef(initialMode);
  const [query, setQuery] = useState(initialPostId ? (initialPostRaw || initialParams.u || "") : initialUser);
  const [activeTab, setActiveTab] = useState(initialParams.tab === "comments" ? "comments" : initialParams.tab === "posts" ? "posts" : "all");
  const handleTabSelect = useCallback((tab) => setActiveTab(tab), []);
  const handleSwitchTab = useCallback(() => setActiveTab(prev => prev === "posts" ? "comments" : "posts"), []);
  const [searched, setSearched] = useState(!!initialUser || !!initialPostId);
  const searchBarRef = useRef(null);
  const searchLayoutRef = useRef(null);
  const searchOriginRef = useRef(null);
  // Results heading target: search completion moves focus here (tabindex=-1)
  // instead of leaving focus on body after the SearchBar blur.
  const resultsHeadingRef = useRef(null);
  const focusResultsHeading = useCallback(() => {
    resultsHeadingRef.current?.focus({ preventScroll: true });
  }, []);
  const captureSearchOrigin = useCallback(() => {
    if (!searched && searchBarRef.current) {
      searchOriginRef.current = searchBarRef.current.getBoundingClientRect().top;
    }
  }, [searched]);
  useLayoutEffect(() => {
    if (!searched || searchOriginRef.current == null) return;
    const origin = searchOriginRef.current;
    searchOriginRef.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layout = searchLayoutRef.current;
    const bar = searchBarRef.current;
    if (!layout?.animate || !bar) return;
    const offset = origin - bar.getBoundingClientRect().top;
    // Translate the entire search area together. The input begins exactly
    // where it was on home; every element beneath it shares the same motion.
    const animation = layout.animate([
      { transform: `translateY(${offset}px)` },
      { transform: "translateY(0)" },
    ], { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    return () => animation.cancel();
  }, [searched]);
  const [initialLoading, setInitialLoading] = useState(!!initialUser || !!initialPostId);
  const [postId, setPostId] = useState(initialPostId);
  const [postMode, setPostMode] = useState(!!_initialPostParsed);
  const [postData, setPostData] = useState(null);
  const [postComments, setPostComments] = useState([]);
  const [postSources, setPostSources] = useState([]);
  const [postLoading, setPostLoading] = useState(!!_initialPostParsed);
  const [postError, setPostError] = useState(null);
  const postIdRef = useRef(initialPostId);
  // AbortController for the post/comment view fetches: a new searchPost run
  // aborts the prior one, and unmount aborts any in-flight fetch. searchId
  // guards stay as the source of truth for which results may commit.
  const postAbortRef = useRef(null);
  useEffect(() => () => {
    if (postAbortRef.current) postAbortRef.current.abort();
  }, []);
  const [dateFrom, setDateFrom] = useState(() => isValidDateString(initialParams.from ?? "") ? initialParams.from : "");
  const [dateTo, setDateTo] = useState(() => isValidDateString(initialParams.to ?? "") ? initialParams.to : "");
  const datesMenuRef = useRef(null);
  useEffect(() => {
    const closeDatesOutside = event => {
      const menu = datesMenuRef.current;
      if (menu?.open && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("pointerdown", closeDatesOutside);
    return () => document.removeEventListener("pointerdown", closeDatesOutside);
  }, []);
  const [subreddit, setSubreddit] = useState(initialMode === "username" && initialParams.sub ? String(initialParams.sub).replace(/^r\//i, "") : "");
  const [urlQuery, setUrlQuery] = useState(initialParams.url || "");
  const [showNsfw, setShowNsfw] = useState(initialParams.hideNsfw !== "1"); // checked = show NSFW (no filter); unchecked = exclude NSFW
  const [showSpoilers, setShowSpoilers] = useState(initialParams.hideSpoilers !== "1");
  const [sortOrder, setSortOrder] = useState(initialParams.sort === "asc" ? "asc" : "desc");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [deletedOnly, setDeletedOnly] = useState(initialParams.deleted === "1");
  const [nsfwOnly, setNsfwOnly] = useState(initialParams.nsfw === "1");
  const [showProfile, setShowProfile] = useState(initialParams.stats === "1");
  const [keyword, setKeyword] = useState("");
  const searchIdRef = useRef(0);
  // Debounced filter input: the text field stays controlled by `keyword`
  // (immediate, 60fps typing) while the expensive list filter + per-card
  // HighlightText regex only react to `deferredKeyword`. React defers that
  // update to idle time, so typing never blocks on 100s of regex tests.
  const deferredKeyword = useDeferredValue(keyword);
  const [userMeta, setUserMeta] = useState(null);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const h = e => setIsNarrow(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          setScrolled(window.scrollY > 0);
          ticking = false;
        });
      }
    };
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
    // LOCAL calendar-day bounds (see utils parseLocalDay*Sec): <input
    // type="date"> is a local day, not a UTC instant. Invalid strings yield
    // null (no filter) instead of NaN comparisons that would drop everything.
    const fromTs = parseLocalDayStartSec(dateFrom);
    const toTs = parseLocalDayEndSec(dateTo);
    return items.filter(item => {
      if (fromTs != null && item.created_utc < fromTs) return false;
      if (toTs != null && item.created_utc > toTs) return false;
      const type = activeTab === "all" ? itemType(item) : activeTab;
      if (!showSpoilers && type === "posts" && item.spoiler) return false;
      if (deletedOnly) {
        const s = getStatus(item, type);
        if (!s.removed && !s.deleted) return false;
      }
      if (nsfwOnly && !item.over_18) return false;
      if (!matchKeyword(item, deferredKeyword, type)) return false;
      return true;
    }).sort((a, b) => sortOrder === "desc" ? b.created_utc - a.created_utc : a.created_utc - b.created_utc);
  }, [activeTab, posts.items, comments.items, deletedOnly, nsfwOnly, showSpoilers, deferredKeyword, sortOrder, dateFrom, dateTo]);

  const [bgStatsVersion, setBgStatsVersion] = useState(0);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawledCount, setCrawledCount] = useState(0);
  const [crawlCapped, setCrawlCapped] = useState(false);
  const [crawlKey, setCrawlKey] = useState(0);
  const bgStatsRef = useRef(null);
  const bgCrawlRef = useRef(null);
  const crawlItemsRef = useRef(0);
  const crawlProcessedRef = useRef(new Set());
  const crawledPostsRef = useRef([]);
  const crawledCommentsRef = useRef([]);
  const lastCrawlQueryRef = useRef(null);
  // Whether the background crawl stopped on its budget/timeout rather than
  // because the archive ran out. Drives an honest "sample" label in the
  // counter — without it a capped crawl looks like one that never finishes.
  const crawlCappedRef = useRef(false);
  // Generation guard so a superseded crawl's finally can't clear a newer
  // crawl's isCrawling (Stop→Refresh race). Incremented on every new crawl
  // start and on manual Stop; the run's finally only touches state when its
  // captured gen still matches.
  const crawlGenRef = useRef(0);
  // True only when the user pressed Stop: distinguishes a manual abort
  // (must NOT set crawlCapped) from budget/timeout aborts (must set it).
  const manualStopRef = useRef(false);
  // Archive-wide item totals (from the users endpoint), used to stop the
  // crawl as soon as everything has actually been fetched.
  const expectedTotalsRef = useRef(null);
  // Explicit Refresh (profile "Refresh" button) requests the full deep crawl;
  // auto-crawl after paint is deferred and paced to keep searches responsive.
  const fullCrawlRef = useRef(false);

  const handleRefreshCrawl = useCallback(() => {
    // Invalidate any in-flight run so its finally skips (Stop→Refresh race).
    crawlGenRef.current += 1;
    manualStopRef.current = false;
    bgStatsRef.current = null;
    lastCrawlQueryRef.current = null;
    fullCrawlRef.current = true;
    setIsCrawling(true);
    setCrawledCount(0);
    setCrawlCapped(false);
    setCrawlKey(k => k + 1);
  }, []);

  const handleStopCrawl = useCallback(() => {
    // Manual Stop invalidates the run's generation so its finally skips all
    // state touches — in particular it must NOT set crawlCapped=true.
    manualStopRef.current = true;
    crawlGenRef.current += 1;
    if (bgCrawlRef.current) {
      bgCrawlRef.current.abort();
    }
    setIsCrawling(false);
  }, []);

  useEffect(() => {
    if (!showProfile || !query || mode !== "username" || initialLoading) return;
    if (lastCrawlQueryRef.current === query.toLowerCase() && bgStatsRef.current && crawlKey === 0) {
      return;
    }
    lastCrawlQueryRef.current = query.toLowerCase();
    if (bgCrawlRef.current) bgCrawlRef.current.abort();

    setIsCrawling(true);
    setCrawledCount(0);
    setCrawlCapped(false);
    crawlItemsRef.current = 0;
    crawlCappedRef.current = false;
    manualStopRef.current = false;
    const myGen = ++crawlGenRef.current;
    crawlProcessedRef.current = new Set();
    crawledPostsRef.current = [];
    crawledCommentsRef.current = [];

    const controller = new AbortController();
    bgCrawlRef.current = controller;
    // Refresh allows a larger scan; both paths pace requests and support Stop.
    const isFullCrawl = fullCrawlRef.current;
    fullCrawlRef.current = false;
    // Bounded background crawl: cap pages so prolific histories can't page
    // unboundedly, and cap wall-clock time so a slow archive can't stall the
    // tab forever. Abort stops new pages immediately (sleep is abort-aware).
    const MAX_BG_PAGES = isFullCrawl ? 200 : 100;
    const CRAWL_TIMEOUT_MS = isFullCrawl ? 300000 : 180000;
    const CRAWL_SLEEP_MS = 800;
    const crawlTimeoutId = setTimeout(() => {
      crawlCappedRef.current = true;
      controller.abort();
    }, CRAWL_TIMEOUT_MS);
    // Batched crawl progress: a version bump recomputes profileStats over the
    // growing lists + re-renders 30 cards + heat grid + compass/bot analysis.
    // Flushing at most ~1x/sec (single bump per page, coalesced across both
    // crawl lanes) keeps the identical UI live without 10s+ of jank.
    const FLUSH_INTERVAL_MS = 800;
    let lastFlush = 0;
    let flushTimer = null;
    let pendingFlush = false;
    const flushCrawlProgress = () => {
      flushTimer = null;
      // Consume the pending flag only when the flush is actually applied —
      // an aborted run leaves pendingFlush set so the finally tail can
      // still settle exact totals (when this generation is still current).
      if (controller.signal.aborted) return;
      lastFlush = Date.now();
      pendingFlush = false;
      // Single render for both counters (React batches same-tick setStates).
      setCrawledCount(crawlItemsRef.current);
      setBgStatsVersion(v => v + 1);
    };
    const scheduleCrawlFlush = () => {
      pendingFlush = true;
      const elapsed = Date.now() - lastFlush;
      if (elapsed >= FLUSH_INTERVAL_MS) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        flushCrawlProgress();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flushCrawlProgress, FLUSH_INTERVAL_MS - elapsed);
      }
    };

    const runCrawl = async () => {
      // Bare Reddit ids collide across types (a post and a comment can share
      // the same base36 id), so every crawl key is prefixed by type.
      const seen = new Set();
      for (const item of posts.items) seen.add(`p-${item.id}`);
      for (const item of comments.items) seen.add(`c-${item.id}`);

      const crawlStats = emptyStats();
      bgStatsRef.current = crawlStats;

      async function crawlType(type) {
        const isComment = type === "comments";
        let before = null;
        let lastId = null;
        let pages = 0;
        let fetched = 0;
        // Everything the archive reports for this type, if the totals arrived.
        const expected = expectedTotalsRef.current
          ? (isComment ? expectedTotalsRef.current.comments : expectedTotalsRef.current.posts)
          : null;

        // Count already loaded items, but scan from the newest archive page.
        // Search filters or Oldest sorting can make the initial page unsuitable
        // as a cursor for scanning the complete profile history.
        const initialList = isComment ? comments.items : posts.items;
        if (initialList && initialList.length > 0) {
          // The first page is already loaded, so it counts toward the total
          // we are trying to reach — otherwise the crawl never recognises
          // that the history is complete and keeps paging for nothing.
          fetched = initialList.length;
        }

        while (!controller.signal.aborted) {
          if (expected != null && fetched >= expected) break;
          // Budget exhausted: record that we stopped short of the full
          // history so the UI can say "sample" instead of looking stuck.
          if (pages >= MAX_BG_PAGES) {
            crawlCappedRef.current = true;
            break;
          }
          // Timestamp-only cursor: Arctic rejects before_id with HTTP 400.
          const pagination = before ? { before } : {};
          let result;
          try {
            result = await fetchBoth(query, type, pagination, {}, { signal: controller.signal, sort: "desc", mode });
          } catch (err) {
            if (err?.name === "AbortError") break;
            throw err;
          }
          pages += 1;

          if (controller.signal.aborted) break;
          if (!result?.items || result.items.length === 0) {
            if (!result?.done || (expected != null && fetched < expected)) crawlCappedRef.current = true;
            break;
          }

          let anyNew = false;
          const crawlPrefix = isComment ? "c-" : "p-";
          for (const item of result.items) {
            const seenKey = `${crawlPrefix}${item.id}`;
            if (seen.has(seenKey)) continue;
            seen.add(seenKey);
            crawlProcessedRef.current.add(seenKey);
            crawlItemsRef.current++;
            fetched++;
            anyNew = true;
            processItem(crawlStats, item, isComment);

            if (isComment) {
              crawledCommentsRef.current.push(item);
            } else {
              crawledPostsRef.current.push(item);
            }
          }

          // Single version bump per page (not per item), throttled above.
          if (anyNew) {
            scheduleCrawlFlush();
          }

          // The archive reports fewer items than this for the type, so there
          // is nothing left to page for. Stop instead of burning the rest of
          // the budget (and the wall clock) on empty pages.
          if (expected != null && fetched >= expected) break;

          const last = result.items[result.items.length - 1];
          if (!last || result.done) {
            if (expected != null && fetched < expected) crawlCappedRef.current = true;
            break;
          }
          if (last.id === lastId) {
            // Repeated page (cursor didn't advance) — step back 1s to force
            // progress instead of stalling. `before` strictly decreases here,
            // so this always terminates.
            before = (before ?? last.created_utc) - 1;
          } else {
            lastId = last.id;
            before = last.created_utc;
          }
          await sleepAbortable(CRAWL_SLEEP_MS, controller.signal);
        }
      }

      try {
        await Promise.all([crawlType("posts"), crawlType("comments")]);
      } catch (err) {
        if (bgCrawlRef.current === controller && myGen === crawlGenRef.current) crawlCappedRef.current = true;
        if (err?.name !== "AbortError") console.error("Background crawl error:", err);
      } finally {
        clearTimeout(crawlTimeoutId);
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        // Only the current generation may touch state: a superseded run
        // (Stop→Refresh / new search) must not clear the new crawl's
        // isCrawling or flush stale counts into it.
        const isCurrentGen = myGen === crawlGenRef.current && bgCrawlRef.current === controller && !manualStopRef.current;
        // Final flush so the UI settles on exact totals even when the last
        // page arrived inside the throttle window.
        if (pendingFlush && isCurrentGen) {
          setCrawledCount(crawlItemsRef.current);
          setBgStatsVersion(v => v + 1);
          pendingFlush = false;
        }
        if (isCurrentGen) {
          setIsCrawling(false);
          // Surface whether we stopped on budget/timeout rather than because
          // the archive ran out, so the counter can say "sample" honestly.
          // Manual Stop never sets capped (only budget/timeout do).
          setCrawlCapped(crawlCappedRef.current);
        }
      }
    };

    // Delay the auto-crawl network + processing until after first contentful
    // paint so refresh paints results first. requestIdleCallback with a 2.5s
    // timeout bounds the delay; plain timeout is the fallback. Explicit
    // Refresh (full crawl) skips the wait and starts immediately. isCrawling
    // is already true above so AI analysis stays gated until the crawl settles.
    // Abort-aware: cleanup cancels the pending start (StrictMode-safe).
    let idleId = null;
    let startTimer = null;
    let startCancelled = false;
    const startCrawl = () => {
      if (startCancelled || controller.signal.aborted) return;
      runCrawl();
    };
    if (isFullCrawl) {
      startCrawl();
    } else if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(startCrawl, { timeout: 2500 });
    } else {
      startTimer = setTimeout(startCrawl, 2500);
    }

    return () => {
      startCancelled = true;
      if (idleId != null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (startTimer) clearTimeout(startTimer);
      if (flushTimer) clearTimeout(flushTimer);
      clearTimeout(crawlTimeoutId); controller.abort(); setIsCrawling(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProfile, query, crawlKey, mode, initialLoading]);

  const profileStats = useMemo(() => {
    const stats = emptyStats();
    // Items the background crawl already counted are skipped here so they're
    // never double-counted when they later appear in the loaded tab items.
    const processed = bgStatsVersion > 0 ? crawlProcessedRef.current : null;
    for (const item of posts.items) {
      if (processed?.has(`p-${item.id}`)) continue;
      processItem(stats, item, false);
    }
    for (const item of comments.items) {
      if (processed?.has(`c-${item.id}`)) continue;
      processItem(stats, item, true);
    }

    if (bgStatsVersion > 0 && bgStatsRef.current) {
      const bg = bgStatsRef.current;
      for (const [sub, count] of Object.entries(bg.subredditCounts)) {
        stats.subredditCounts[sub] = (stats.subredditCounts[sub] || 0) + count;
      }
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 24; c++) {
          stats.heatmap[r][c] += bg.heatmap[r][c];
        }
      }
      for (const type of ["posts", "comments"]) {
        for (const [word, counts] of Object.entries(bg.wordFreqs[type])) {
          if (!stats.wordFreqs[type][word]) stats.wordFreqs[type][word] = { total: 0, items: 0 };
          stats.wordFreqs[type][word].total += counts.total;
          stats.wordFreqs[type][word].items += counts.items;
        }
      }
      // Carry the crawl's text sample across too. Dropping it silently threw
      // away most of the deep-crawl's text evidence: the compass only saw the
      // first page plus the capped in-memory item lists. The compass engine
      // dedupes these against the id-bearing streams, so merging is safe.
      // Capped to the 1000-item canonical budget (like mergeStats).
      if (bg.sampleItems?.length) {
        stats.sampleItems = (stats.sampleItems || []).concat(bg.sampleItems).slice(0, 1000);
      }
    }

    return stats;
  }, [posts.items, comments.items, bgStatsVersion]);

  const loadedCount = useMemo(() => {
    const loaded = posts.items.length + comments.items.length;
    if (bgStatsVersion === 0) return loaded;
    const processed = crawlProcessedRef.current;
    let overlap = 0;
    for (const item of posts.items) {
      if (processed.has(`p-${item.id}`)) overlap++;
    }
    for (const item of comments.items) {
      if (processed.has(`c-${item.id}`)) overlap++;
    }
    return loaded + crawlItemsRef.current - overlap;
  }, [posts.items, comments.items, bgStatsVersion]);

  // Stable combined lists: a flush triggered by the *other* lane must not
  // give this lane a fresh array identity, or AccountProfile/ProfileSummary
  // memo breaks and the heat grid + bot analysis re-render on every tick.
  // Contents are identical — only the reference is preserved when nothing
  // in this lane actually grew.
  const allPostsCacheRef = useRef({ items: null, crawledLen: -1, arr: [] });
  const allCommentsCacheRef = useRef({ items: null, crawledLen: -1, arr: [] });

  const allPosts = useMemo(() => {
    const crawledLen = crawledPostsRef.current?.length || 0;
    const prev = allPostsCacheRef.current;
    if (prev.items === posts.items && prev.crawledLen === crawledLen && prev.arr) return prev.arr;
    let arr;
    if (crawledLen === 0) {
      arr = posts.items;
    } else {
      const seen = new Set();
      for (const item of posts.items) seen.add(item.id);
      arr = [...posts.items, ...crawledPostsRef.current.filter(item => item.id && !seen.has(item.id))];
    }
    prev.items = posts.items;
    prev.crawledLen = crawledLen;
    prev.arr = arr;
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.items, bgStatsVersion]);

  const allComments = useMemo(() => {
    const crawledLen = crawledCommentsRef.current?.length || 0;
    const prev = allCommentsCacheRef.current;
    if (prev.items === comments.items && prev.crawledLen === crawledLen && prev.arr) return prev.arr;
    let arr;
    if (crawledLen === 0) {
      arr = comments.items;
    } else {
      const seen = new Set();
      for (const item of comments.items) seen.add(item.id);
      arr = [...comments.items, ...crawledCommentsRef.current.filter(item => item.id && !seen.has(item.id))];
    }
    prev.items = comments.items;
    prev.crawledLen = crawledLen;
    prev.arr = arr;
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.items, bgStatsVersion]);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Reset the render window whenever the filter identity changes (new search,
  // tab, sort, or deferred keyword). Pagination growth (posts.items) must NOT
  // reset — new pages stay behind Load More until the user reveals them.
  // `keyword` (immediate input value) is intentionally not a dep: the list
  // only reacts to `deferredKeyword`, keeping typing at 60fps.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, mode, activeTab, deferredKeyword, sortOrder, dateFrom, dateTo, deletedOnly, nsfwOnly, showNsfw, showSpoilers, subreddit, urlQuery]);

  // Memoized render window: avoids re-slicing/mapping 100s of items on every
  // keystroke or unrelated parent render (e.g. crawl progress ticks).
  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );

  const isOutageTakeover = !postMode && !initialLoading && !posts.loading && !comments.loading && bothSourcesFailed && posts.items.length === 0 && comments.items.length === 0;
  const archiveSummary = archiveFailureSummary([
    posts.sourceErrors.arctic, comments.sourceErrors.arctic,
    posts.sourceErrors.pullpush, comments.sourceErrors.pullpush,
  ]);
  useEffect(() => {
    const path = window.location.pathname;
    const privacy = path.endsWith('/privacy.html') || path.endsWith('/privacy');
    const notFound = path === '/404.html' || (path !== "/" && path !== "/index.html" && !privacy && !/^\/(assets|__vite|favicon\.ico|robots\.txt)/.test(path));
    if (privacy) document.title = `${t("privacy")} — Rosint+`;
    else if (notFound) document.title = `404 — Rosint+`;
    else if (initialLoading || posts.loading || comments.loading) document.title = `${t("loading")} — Rosint+`;
    else if (postError) document.title = `${postError} — Rosint+`;
    else if ((posts.error || comments.error) && !postMode) document.title = `${posts.error || comments.error} — Rosint+`;
    else if (!postMode && !initialLoading && !posts.loading && !comments.loading && bothSourcesFailed && posts.items.length === 0 && comments.items.length === 0) document.title = `${t("bannerTitle")} — Rosint+`;
    else if (postMode) document.title = `${postId ? `t3_${postId}` : selectedCommentId ? `t1_${selectedCommentId}` : "Post"} — Rosint+`;
    else if (searched && query) document.title = `${mode === "subreddit" ? "r/" : "u/"}${query} — Rosint+`;
    else document.title = "Rosint+";
  });
  // Archive-wide totals for tab badges + summary. Shares the same URL as
  // UserSummary so safeFetch's in-flight cache dedupes both into one request.
  useEffect(() => {
    if (!query || mode === "subreddit") {
      setUserMeta(null);
      expectedTotalsRef.current = null;
      return;
    }
    let cancelled = false;
    setUserMeta(null);
    expectedTotalsRef.current = null;
    // No AbortSignal here by choice: this request is tiny and is shared via
    // safeFetch's single-flight cache with UserSummary, so letting it run to
    // completion is cheaper than tracking cancellation. The `cancelled` guard
    // keeps state off unmounted / superseded queries.
    safeFetch(`${ARCTIC}/api/users/search?author=${encodeURIComponent(query)}&limit=1`).then(res => {
      if (cancelled) return;
      const meta = res.data?.[0]?._meta ?? null;
      setUserMeta(meta);
      expectedTotalsRef.current = meta
        ? { posts: meta.num_posts || 0, comments: meta.num_comments || 0 }
        : null;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [query, mode]);
  const buildFilters = useCallback((searchMode = mode) => {
    const f = {};
    // Same LOCAL-day basis as the client filter: invalid → no filter key.
    const fromSec = parseLocalDayStartSec(dateFrom);
    const toSec = parseLocalDayEndSec(dateTo);
    if (fromSec != null) f.dateFrom = fromSec;
    if (toSec != null) f.dateTo = toSec;
    if (subreddit.trim() && searchMode !== "subreddit") f.subreddit = subreddit.trim();
    if (!showNsfw) f.over18 = false;
    if (urlQuery.trim()) f.url = urlQuery.trim();
    return f;
  }, [dateFrom, dateTo, subreddit, showNsfw, mode, urlQuery]);
  const hasFilters = dateFrom || dateTo || (mode === "username" && subreddit.trim()) || !showNsfw || !showSpoilers || urlQuery.trim() || deletedOnly || nsfwOnly;
  const clearPostMode = useCallback(() => {
    setSelectedComment(null);
    setSelectedCommentId(null);
    setPostMode(false);
    setPostId(null);
    postIdRef.current = null;
    setPostData(null);
    setPostComments([]);
    setPostSources([]);
    setPostError(null);
    setPostLoading(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("post");
    url.searchParams.delete("p");
    url.searchParams.delete("postId");
    url.searchParams.delete("id");
    // A post opened via ?u=<post-URL> leaves the raw URL in ?u — clear it
    // too so returning home doesn't re-trigger post mode on reload.
    if (parsePostInput(url.searchParams.get("u") || "")) url.searchParams.delete("u");
    window.history.replaceState({}, "", url);
  }, []);
  // Keep the URL in sync with the shareable view state so findings are
  // reproducible/tab-restoreable: ?u ?tab ?from ?to ?sub ?sort. replaceState
  // (not push) so swapping tabs/filters doesn't pollute browser history.
  useEffect(() => {
    if (!searched || !query) return;
    if (postMode) {
      const url = new URL(window.location.href);
      if (postId || selectedCommentId) {
        url.searchParams.set("post", selectedCommentId ? `t1_${selectedCommentId}` : postId);
        url.searchParams.delete("u");
        url.searchParams.delete("sub");
        url.searchParams.delete("mode");
      }
      url.searchParams.delete("p");
      url.searchParams.delete("postId");
      url.searchParams.delete("id");
      window.history.replaceState({}, "", url);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("post");
    url.searchParams.delete("p");
    if (mode === "subreddit") {
      url.searchParams.set("sub", query);
      url.searchParams.set("mode", "subreddit");
      url.searchParams.delete("u");
    } else {
      url.searchParams.set("u", query);
      url.searchParams.delete("mode");
      // NOTE: the subreddit text filter (?sub) and external-link filter (?url)
      // are intentionally NOT synced here. Both are free-text inputs that
      // change per keystroke; they are committed to the URL only on search
      // (see searchUser's push block) so typing never rewrites the URL.
    }
    // Only write non-default state so the shared URL stays minimal
    // (?u=name); defaults are implied when the params are absent.
    if (activeTab !== "all") url.searchParams.set("tab", activeTab);
    else url.searchParams.delete("tab");
    if (sortOrder !== "desc") url.searchParams.set("sort", sortOrder);
    else url.searchParams.delete("sort");
    if (dateFrom && isValidDateString(dateFrom)) url.searchParams.set("from", dateFrom);
    else url.searchParams.delete("from");
    if (dateTo && isValidDateString(dateTo)) url.searchParams.set("to", dateTo);
    else url.searchParams.delete("to");
    if (deletedOnly) url.searchParams.set("deleted", "1");
    else url.searchParams.delete("deleted");
    if (nsfwOnly) url.searchParams.set("nsfw", "1");
    else url.searchParams.delete("nsfw");
    if (!showSpoilers) url.searchParams.set("hideSpoilers", "1");
    else url.searchParams.delete("hideSpoilers");
    if (!showNsfw) url.searchParams.set("hideNsfw", "1");
    else url.searchParams.delete("hideNsfw");
    if (showProfile) url.searchParams.set("stats", "1");
    else url.searchParams.delete("stats");
    window.history.replaceState({}, "", url);
  }, [searched, query, mode, activeTab, dateFrom, dateTo, sortOrder, deletedOnly, nsfwOnly, showNsfw, showSpoilers, showProfile, postMode, postId, selectedCommentId]);
  const {
    reset: resetPosts
  } = posts;
  const {
    reset: resetComments
  } = comments;
  const searchPost = useCallback(async (rawInput, { push = true } = {}) => {
    const parsed = parsePostInput(rawInput) || (() => {
      const bare = String(rawInput || "").trim().replace(/^t3_/i, "");
      if (/^[a-z0-9]{5,10}$/i.test(bare)) return { postId: bare.toLowerCase(), commentId: null, kind: "post" };
      return null;
    })();
    if (!parsed) {
      setPostError(t("postInvalidUrl"));
      setPostLoading(false);
      setInitialLoading(false);
      // Move focus so keyboard/SR users perceive the validation error:
      // results heading when post view exists, else the search field.
      if (resultsHeadingRef.current) focusResultsHeading();
      else searchBarRef.current?.querySelector("input")?.focus();
      return;
    }
    const id = parsed.postId;
    setSelectedCommentId(parsed.commentId);
    setSelectedComment(null);
    captureSearchOrigin();
    const searchId = ++searchIdRef.current;
    // Abort any in-flight post/comment view fetch before starting a new one.
    if (postAbortRef.current) postAbortRef.current.abort();
    const postCtrl = new AbortController();
    postAbortRef.current = postCtrl;
    const postSignal = postCtrl.signal;
    setPostId(id);
    postIdRef.current = id || `t1_${parsed.commentId}`;
    setPostMode(true);
    if (modeRef.current !== "post") {
      modeRef.current = "post";
      setMode("post");
    }
    setPostData(null);
    setPostComments([]);
    setPostSources([]);
    setPostError(null);
    setPostLoading(true);
    setSearched(true);
    setQuery(rawInput);
    setInitialLoading(true);
    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.set("post", parsed.commentId ? `t1_${parsed.commentId}` : id);
      url.searchParams.delete("u");
      url.searchParams.delete("sub");
      url.searchParams.delete("mode");
      url.searchParams.delete("tab");
      window.history.pushState({}, "", url);
    }
    if (parsed.commentId) {
      const requestId = postIdRef.current;
      const isCurrent = () => searchId === searchIdRef.current && postIdRef.current === requestId;
      try {
        const result = await fetchCommentById(parsed.commentId, { signal: postSignal });
        if (!isCurrent()) return;
        if (!result.comment) {
          setPostError(t("commentNotFound"));
          return;
        }
        setSelectedComment(result.comment);
        setPostSources(result.sources);
        setPostLoading(false);
        setInitialLoading(false);
        const parentId = String(result.comment.link_id || parsed.postId || "").replace(/^t3_/i, "");
        if (parentId) {
          setPostId(parentId);
          const parent = await fetchPostById(parentId, { signal: postSignal });
          if (!isCurrent()) return;
          setPostData(parent.post);
          setPostSources(prev => [...new Set([...prev, ...parent.sources])]);
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (isCurrent()) setPostError(err.message || t("commentNotFound"));
      } finally {
        if (isCurrent()) {
          setPostLoading(false);
          setInitialLoading(false);
          focusResultsHeading();
        }
      }
      return;
    }
    // Stream: show post as soon as it arrives, don't wait for comments
    const postPromise = fetchPostById(id, { signal: postSignal }).then(postRes => {
      if (searchId !== searchIdRef.current || postIdRef.current !== id) return;
      if (postRes.post) {
        setPostData(postRes.post);
        setPostSources(prev => {
          const s = postRes.sources || [];
          return s.length ? [...new Set([...prev, ...s])] : prev;
        });
        setPostError(null);
      } else {
        setPostError(t("postNotFound"));
        setPostData(null);
      }
      setPostLoading(false);
      setInitialLoading(false);
    }).catch(e => {
      if (e?.name !== "AbortError" && searchId === searchIdRef.current && postIdRef.current === id) {
        setPostError(e.message || t("postNotFound"));
        setPostLoading(false);
        setInitialLoading(false);
      }
    });
    const commentsPromise = fetchCommentsForPost(id, { limit: 100, signal: postSignal }).then(commentsRes => {
      if (searchId !== searchIdRef.current || postIdRef.current !== id) return;
      setPostComments(commentsRes.comments || []);
      if (commentsRes.sources?.length) {
        setPostSources(prev => [...new Set([...prev, ...commentsRes.sources])]);
      }
      setPostLoading(false);
      setInitialLoading(false);
    }).catch(() => {
      if (searchId === searchIdRef.current && postIdRef.current === id) {
        setPostLoading(false);
        setInitialLoading(false);
      }
    });
    await Promise.all([postPromise, commentsPromise]);
    if (searchId === searchIdRef.current && postIdRef.current === id) {
      setPostLoading(false);
      setInitialLoading(false);
      focusResultsHeading();
    }
  }, [t, captureSearchOrigin, focusResultsHeading]);
  const searchUser = useCallback(async (rawUser, {
    push = true,
    silent = false,
    filtersOverride = null,
    sortOverride = null,
    focusAfter = true
  } = {}) => {
    if (modeRef.current === "post") {
      return searchPost(rawUser, { push });
    }
    // exiting post mode for a normal user/subreddit search
    if (postMode) {
      setSelectedComment(null);
      setSelectedCommentId(null);
      setPostMode(false);
      setPostId(null);
      postIdRef.current = null;
      setPostData(null);
      setPostComments([]);
      setPostSources([]);
      setPostError(null);
      setPostLoading(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("post");
      url.searchParams.delete("p");
      url.searchParams.delete("postId");
      url.searchParams.delete("id");
      window.history.replaceState({}, "", url);
    }
    const m = modeRef.current;
    const user = m === "subreddit" ? normalizeSubreddit(rawUser) : normalizeUsername(rawUser);
    if (!user) return;
    captureSearchOrigin();
    const searchId = ++searchIdRef.current;
    setQuery(user);
    setSearched(true);
    // A silent re-search only retunes filters (dates/NSFW/sort) — the
    // background crawl pages the unfiltered history, so it must keep running
    // undisturbed. Only an explicit (non-silent) search resets crawl state.
    if (!silent) {
      // Invalidate the previous crawl generation so its finally skips.
      crawlGenRef.current += 1;
      manualStopRef.current = false;
      if (bgCrawlRef.current) bgCrawlRef.current.abort();
      bgCrawlRef.current = null;
      bgStatsRef.current = null;
      crawlProcessedRef.current = new Set();
      crawledPostsRef.current = [];
      crawledCommentsRef.current = [];
      crawlItemsRef.current = 0;
      setBgStatsVersion(0);
      setCrawlCapped(false);
      if (m === "username") {
        setIsCrawling(true);
        setCrawledCount(0);
        bgStatsRef.current = null;
        lastCrawlQueryRef.current = null;
        setCrawlKey(k => k + 1);
      }
    }
    if (!silent) setInitialLoading(true);
    const filters = filtersOverride ?? buildFilters(m);
    const effSort = sortOverride ?? sortOrder;
    let doneCount = 0;
    const maybeDone = () => {
      doneCount++;
      if (doneCount === 1 && !silent && searchId === searchIdRef.current) {
        // First of posts/comments has landed — show results immediately
        // instead of waiting for the slower type. No UI change, just faster paint.
        setInitialLoading(false);
      }
    };
    const postsPromise = resetPosts(user, filters, { sort: effSort, mode: m }).then(r => {
      if (searchId === searchIdRef.current) maybeDone();
      return r;
    });
    const commentsPromise = resetComments(user, filters, { sort: effSort, mode: m }).then(r => {
      if (searchId === searchIdRef.current) maybeDone();
      return r;
    });
    await Promise.all([postsPromise, commentsPromise]);
    if (searchId !== searchIdRef.current) return;
    if (push) {
      const url = new URL(window.location.href);
      if (m === "subreddit") {
        url.searchParams.set("sub", user);
        url.searchParams.set("mode", "subreddit");
        url.searchParams.delete("u");
      } else {
        url.searchParams.set("u", user);
        url.searchParams.delete("mode");
        // Commit point for the free-text filters: ?sub/?url reach the URL
        // only here (explicit search), never per keystroke from the live sync.
        if (subreddit.trim()) url.searchParams.set("sub", subreddit.trim());
        else url.searchParams.delete("sub");
      }
      if (urlQuery.trim()) url.searchParams.set("url", urlQuery.trim());
      else url.searchParams.delete("url");
      window.history.pushState({}, "", url);
    }
    if (!silent) {
      setInitialLoading(false);
      if (focusAfter) focusResultsHeading();
    }
  }, [buildFilters, resetPosts, resetComments, sortOrder, postMode, searchPost, captureSearchOrigin, subreddit, urlQuery, focusResultsHeading]);
  const searchUserRef = useRef(searchUser);
  searchUserRef.current = searchUser;
  const handleModeChange = useCallback(nextMode => {
    if (nextMode === modeRef.current) return;
    modeRef.current = nextMode;
    setMode(nextMode);
    if (nextMode === "post") {
      // Drop stale user results so old cards never show in post context,
      // and drop the user/sub URL so refresh can't resurrect the old search.
      clearPostMode();
      const url = new URL(window.location.href);
      url.searchParams.delete("u");
      url.searchParams.delete("sub");
      url.searchParams.delete("mode");
      window.history.replaceState({}, "", url);
      setSearched(false);
      setQuery("");
      return;
    }
    if (postMode) {
      clearPostMode();
      setSearched(false);
      setQuery("");
      return;
    }
    if (searched && query) searchUserRef.current(query, { push: true });
  }, [searched, query, postMode, clearPostMode]);
  // Re-search when a discrete filter control changes (dates, NSFW toggle,
  // sort). The subreddit text field is deliberately NOT here: it changes on
  // every keystroke, so it commits only on blur/Enter in its own handler.
  useEffect(() => {
    if (postMode) return;
    if (searched && query && !initialLoading) {
      searchUserRef.current(query, {
        push: false,
        silent: true
      });
    }
    // searched/query/initialLoading are deliberately NOT deps: including them
    // refires the search on every completion, re-showing skeletons forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, showNsfw, sortOrder, postMode]);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // Drop invalid ?from/?to from the URL on load (treated as no filter).
    if ((p.get("from") != null && !isValidDateString(p.get("from"))) || (p.get("to") != null && !isValidDateString(p.get("to")))) {
      const url = new URL(window.location.href);
      if (!isValidDateString(p.get("from") || "") && p.get("from") != null) url.searchParams.delete("from");
      if (!isValidDateString(p.get("to") || "") && p.get("to") != null) url.searchParams.delete("to");
      window.history.replaceState({}, "", url);
    }
    const rawPost = p.get("post") || p.get("p") || p.get("postId") || p.get("id") || "";
    const parsed = parsePostInput(rawPost) || (rawPost && /^[a-z0-9]{5,10}$/i.test(rawPost.trim()) ? { postId: rawPost.trim().replace(/^t3_/i, "").toLowerCase(), commentId: null } : null);
    if (parsed?.postId || parsed?.commentId) {
      searchPost(rawPost, { push: false });
      return;
    }
    const maybeUAsPost = parsePostInput(p.get("u") || "");
    if (maybeUAsPost) {
      searchPost(p.get("u"), { push: false });
      return;
    }
    const u = normalizeUsername(p.get("u"));
    const s = normalizeSubreddit(p.get("sub"));
    if (u) searchUser(u, {
      push: false,
      focusAfter: false
    });
    else if (s) searchUser(s, {
      push: false,
      focusAfter: false
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      const rawPost = p.get("post") || p.get("p") || p.get("postId") || p.get("id") || "";
      const parsed = parsePostInput(rawPost) || (rawPost && /^[a-z0-9]{5,10}$/i.test(rawPost.trim()) ? { postId: rawPost.trim().replace(/^t3_/i, "").toLowerCase() } : null);
      if (parsed?.postId || parsed?.commentId) {
        searchPost(rawPost, { push: false });
        return;
      }
      const maybeUAsPost = parsePostInput(p.get("u") || "");
      if (maybeUAsPost) {
        searchPost(p.get("u"), { push: false });
        return;
      }
      const nextMode = p.get("mode") === "subreddit" || (!p.get("u") && p.get("sub")) ? "subreddit" : "username";
      modeRef.current = nextMode;
      setMode(nextMode);
      // Keep UI language in sync with Back/Forward entries carrying ?lang.
      const poppedLang = p.get("lang");
      if (poppedLang && LANGS[poppedLang] && poppedLang !== getLang()) {
        setLang(poppedLang);
      } else if (!poppedLang && getLang() !== "en") {
        // No ?lang means English (setLang deletes the param for en).
        setLang("en");
      }
      // Drop invalid ?from/?to from the URL (Back/Forward to a bad share link).
      if ((p.get("from") != null && !isValidDateString(p.get("from"))) || (p.get("to") != null && !isValidDateString(p.get("to")))) {
        const cleanUrl = new URL(window.location.href);
        if (p.get("from") != null && !isValidDateString(p.get("from"))) cleanUrl.searchParams.delete("from");
        if (p.get("to") != null && !isValidDateString(p.get("to"))) cleanUrl.searchParams.delete("to");
        window.history.replaceState({}, "", cleanUrl);
      }
      // Restore the URL-synced filter state so Back/Forward reproduces the
      // shared view (mirrors the initial useState defaults from the URL).
      setActiveTab(p.get("tab") === "comments" ? "comments" : p.get("tab") === "posts" ? "posts" : "all");
      setSortOrder(p.get("sort") === "asc" ? "asc" : "desc");
      // Invalid ?from/?to → no filter (drop); valid values restore the view.
      setDateFrom(isValidDateString(p.get("from") || "") ? p.get("from") : "");
      setDateTo(isValidDateString(p.get("to") || "") ? p.get("to") : "");
      setDeletedOnly(p.get("deleted") === "1");
      setNsfwOnly(p.get("nsfw") === "1");
      setShowSpoilers(p.get("hideSpoilers") !== "1");
      setShowNsfw(p.get("hideNsfw") !== "1");
      setSubreddit(nextMode === "username" && p.get("sub") ? String(p.get("sub")).replace(/^r\//i, "") : "");
      setUrlQuery(p.get("url") || "");
      setShowProfile(p.get("stats") === "1");
      const u = normalizeUsername(p.get("u"));
      const s = normalizeSubreddit(p.get("sub"));
      // Build filters from the POPPED url (not stale state): searchUser's
      // closure still sees pre-pop subreddit/urlQuery/sortOrder.
      const poppedFrom = isValidDateString(p.get("from") || "") ? p.get("from") : "";
      const poppedTo = isValidDateString(p.get("to") || "") ? p.get("to") : "";
      const poppedSub = nextMode === "username" && p.get("sub") ? String(p.get("sub")).replace(/^r\//i, "") : "";
      const poppedUrl = p.get("url") || "";
      const poppedSort = p.get("sort") === "asc" ? "asc" : "desc";
      const popFilters = {};
      const popFromSec = parseLocalDayStartSec(poppedFrom);
      const popToSec = parseLocalDayEndSec(poppedTo);
      if (popFromSec != null) popFilters.dateFrom = popFromSec;
      if (popToSec != null) popFilters.dateTo = popToSec;
      if (poppedSub.trim() && nextMode !== "subreddit") popFilters.subreddit = poppedSub.trim();
      if ((p.get("hideNsfw") === "1")) popFilters.over18 = false;
      if (poppedUrl.trim()) popFilters.url = poppedUrl.trim();
      if (u) {
        searchUser(u, {
          push: false,
          filtersOverride: popFilters,
          sortOverride: poppedSort,
          focusAfter: true
        });
      } else if (s) {
        searchUser(s, {
          push: false,
          filtersOverride: popFilters,
          sortOverride: poppedSort,
          focusAfter: true
        });
      } else {
        setSearched(false);
        setQuery("");
        clearPostMode();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [searchUser, searchPost, clearPostMode]);
  const handleRetry = useCallback(async () => {
    if (postMode && query) {
      await searchPost(query, { push: false });
      focusResultsHeading();
      return;
    }
    if (!query) return;
    setInitialLoading(true);
    const m = modeRef.current;
    const filters = buildFilters();
    await Promise.all([resetPosts(query, filters, {
      bypassCache: true, sort: sortOrder, mode: m
    }), resetComments(query, filters, {
      bypassCache: true, sort: sortOrder, mode: m
    })]);
    setInitialLoading(false);
    focusResultsHeading();
  }, [query, buildFilters, resetPosts, resetComments, sortOrder, postMode, searchPost, focusResultsHeading]);
  const clearFilters = useCallback(async () => {
    setDateFrom("");
    setDateTo("");
    setSubreddit("");
    setUrlQuery("");
    setKeyword("");
    setShowNsfw(true);
    setShowSpoilers(true);
    setDeletedOnly(false);
    setNsfwOnly(false);
    // The live URL sync no longer manages ?sub/?url (commit-only), so drop
    // the cleared params explicitly. In subreddit mode ?sub is the query —
    // never delete it here.
    const url = new URL(window.location.href);
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    if (modeRef.current !== "subreddit") url.searchParams.delete("sub");
    url.searchParams.delete("url");
    url.searchParams.delete("deleted");
    url.searchParams.delete("nsfw");
    url.searchParams.delete("hideSpoilers");
    url.searchParams.delete("hideNsfw");
    window.history.replaceState({}, "", url);
    if (postMode && query) {
      await searchPost(query, { push: false });
      return;
    }
    if (!query) return;
    setInitialLoading(true);
    const m = modeRef.current;
    await Promise.all([resetPosts(query, {}, { sort: sortOrder, mode: m }), resetComments(query, {}, { sort: sortOrder, mode: m })]);
    setInitialLoading(false);
  }, [query, resetPosts, resetComments, sortOrder, postMode, searchPost]);

  const active = useMemo(() => activeTab === "posts" ? posts : activeTab === "comments" ? comments : { loading: posts.loading || comments.loading, error: posts.error || comments.error, done: posts.done && comments.done }, [activeTab, posts, comments]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- active.items is undefined for "all" tab
  const activeItemCount = useMemo(() => activeTab === "all" ? posts.items.length + comments.items.length : active.items.length, [activeTab, posts.items.length, comments.items.length]);
  const activeHasMore = useMemo(() => {
    if (visibleCount < filteredItems.length) return true;
    return activeTab === "all" ? (!posts.done || !comments.done) : !active.done;
  }, [visibleCount, filteredItems.length, activeTab, posts.done, comments.done, active.done]);

  const loadMoreActive = useCallback(() => {
    // Buffered items first: reveal locally with no network. Only fetch when
    // the buffer is exhausted.
    if (visibleCount < filteredItems.length) {
      setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredItems.length));
      return;
    }
    if (posts.loading || comments.loading) return;
    if (activeTab === "all") {
      if (!posts.done) posts.loadMore(query);
      if (!comments.done) comments.loadMore(query);
    } else {
      if (!active.done) active.loadMore(query);
    }
  }, [visibleCount, filteredItems.length, posts, comments, active, activeTab, query]);
  const handleWordClick = useCallback((word) => setKeyword(word), []);
  const pathname = window.location.pathname;
  const isPrivacyPage = pathname.endsWith('/privacy.html') || pathname.endsWith('/privacy');
  const is404Page = pathname === '/404.html' || (pathname !== "/" && pathname !== "/index.html" && !isPrivacyPage && !/^\/(assets|__vite|favicon\.ico|robots\.txt)/.test(pathname));

  if (isPrivacyPage) {
    return (
      <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--text)] relative">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[color:var(--accent)] focus:text-[color:var(--bg)] focus:rounded focus:text-sm focus:font-bold focus:outline-none">{t("skipToContent")}</a>
        <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-[color:var(--bg)] border-b border-[color:var(--border)]">
            <div className="flex items-center gap-2 min-w-0">
                    <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                        <Logo />
                    </a>
                <a href="https://github.com/rosintplus/rosintplus.github.io" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" className="h-8 w-8 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center justify-center flex-shrink-0"style={NO_DECORATION}>
                    <IconGitHub className="w-4 h-4" />
                </a>
                </div>
                <ThemeSwitcher />
            </header>
        <main id="main-content" className="max-w-3xl mx-auto px-4 pt-24 pb-20">
          <h1 className="text-4xl font-semibold mb-8 text-[color:var(--text)] leading-tight">{t("pvTitleA")} <span className="text-[color:var(--accent)]">{t("pvTitleB")}</span></h1>

          <div className="text-[color:var(--text-muted)] text-[16px] leading-relaxed flex flex-col gap-3">
              <p>{t("pvIntro")}</p>

              <p><strong className="text-[color:var(--text)]">{t("pvSearchLabel")}</strong> {tJsx(t, "pvSearchBody", { arctic: <a key="a" href="https://arctic-shift.photon-reddit.com" target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">Arctic Shift</a>, pullpush: <a key="p" href="https://pullpush.io" target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">PullPush</a> })}</p>

              <p><strong className="text-[color:var(--text)]">{t("pvDataLabel")}</strong> {t("pvDataBody")}</p>

              <div className="border border-[color:var(--border-hover)] rounded-lg p-4 mt-4 bg-[color:var(--bg-elevated)]">
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
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[color:var(--accent)] focus:text-[color:var(--bg)] focus:rounded focus:text-sm focus:font-bold focus:outline-none">{t("skipToContent")}</a>
        <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-[color:var(--bg)] border-b border-[color:var(--border)]">
            <div className="flex items-center gap-2 min-w-0">
                <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                    <Logo />
                </a>
                <a href="https://github.com/rosintplus/rosintplus.github.io" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" className="h-8 w-8 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center justify-center flex-shrink-0"style={NO_DECORATION}>
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                </a>
                </div>
                <ThemeSwitcher />
        </header>
        <main id="main-content" className="flex flex-col items-center justify-center text-center flex-1">
        <h1 className="text-6xl font-bold mb-4 text-[color:var(--text)]">404</h1>
        <p className="text-lg text-[color:var(--text-muted)] mb-8">{t("notFoundText")}</p>
        <a href="/" className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] text-[color:var(--accent-text)] px-4 py-2 rounded hover:border-[color:var(--accent)] transition-colors font-medium">{t("returnHome")}</a>
        </main>
      </div>
      );
  }

  return <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--text)] relative flex flex-col">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[color:var(--accent)] focus:text-[color:var(--bg)] focus:rounded focus:text-sm focus:font-bold focus:outline-none">{t("skipToContent")}</a>
            <header className={`${scrolled ? "" : "header-top"} fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-[color:var(--bg)] border-b border-[color:var(--border)]`}>
                <div className="flex items-center gap-2 min-w-0">
                <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                    <Logo />
                </a>
                <a href="https://github.com/rosintplus/rosintplus.github.io" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" className="h-8 w-8 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center justify-center flex-shrink-0"style={NO_DECORATION}>
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                </a>
                </div>
                <ThemeSwitcher />
            </header>

            <main ref={searchLayoutRef} id="main-content" className="flex-1 flex flex-col pt-12">
                {arcticIsDown && !isOutageTakeover && !bannerDismissed && <div className="bg-[color:var(--border)] border-b border-[color:var(--border-hover)] px-4 py-2 flex items-center justify-between gap-3">
                        <p className="text-[12px] text-[color:var(--accent-text)]">
                            <span className="font-semibold">{t("bannerTitle")}</span>
                            {" "}{t("bannerBody")}
                        </p>
                        <button onClick={() => setBannerDismissed(true)} aria-label={t("dismiss")} className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] flex-shrink-0 transition-colors text-lg leading-none">
                            ×
                        </button>
                    </div>}
                <div className={`w-full max-w-3xl mx-auto px-3 sm:px-4 ${searched ? "pt-6" : "flex-1 flex flex-col justify-center"}`}>
                    {!searched && (
                        <div className="text-center mb-8">
                            <h1 className="font-bold text-[color:var(--text)] tracking-tight leading-none select-none text-[clamp(2rem,14vw,5.5rem)] sm:text-[clamp(3rem,15vw,9rem)]" style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
                                <svg className="inline-block align-middle overflow-visible w-auto h-[1em]" viewBox="8 41.3 129.1 61.7" fill="none" aria-hidden="true">
                                    <path fill="currentColor" d="M36.6533203125 76.1796875 33.6865234375 58.7138671875H38.041015625Q38.806640625 46.3203125 51.0087890625 46.3203125Q58.234375 46.3203125 62.08642578125 51.6318359375Q65.9384765625 56.943359375 65.9384765625 66.9443359375H53.0185546875Q53.0185546875 62.4462890625 51.36767578125 60.484375Q49.716796875 58.5224609375 46.080078125 58.5224609375Q41.3427734375 58.5224609375 38.998046875 63.1162109375Q36.6533203125 67.7099609375 36.6533203125 76.1796875ZM13.0146484375 98.0V86.8984375H48.5205078125V98.0ZM23.7333984375 98.0V47.27734375H34.7392578125L36.6533203125 61.82421875V98.0ZM14.9287109375 58.37890625V47.27734375H34.0693359375L35.0263671875 58.37890625Z" />
                                    <path fill="var(--accent)" d="M101.720703125 97.908203125V48.23828125H114.544921875V97.908203125ZM84.20703125 79.0546875V67.091796875H132.05859375V79.0546875Z" />
                                </svg>
                            </h1>
                            <p className="text-sm sm:text-base text-[color:var(--text-muted)] mt-6 leading-relaxed max-w-xl mx-auto">
                                {t("tagline")}
                            </p>
                        </div>
                    )}
                    <div ref={searchBarRef} className="relative mx-auto w-full flex-shrink-0" style={{
          maxWidth: searched ? '100%' : '690px'
        }}>
                        
                        <SearchBar defaultQuery={query} onSearch={searchUser} initialLoading={initialLoading} mode={mode} />
                    </div>
                    {!searched && mode === "post" && postError && <div className="mx-auto w-full mt-3" style={{ maxWidth: '690px' }}>
                        <ErrorState message={postError} onRetry={() => { setPostError(null); }} />
                    </div>}

                    {!searched && <div className="relative flex flex-col gap-2 mt-3 mx-auto w-full flex-shrink-0" style={{
          maxWidth: '690px'
        }}>
                            <div className="flex items-center justify-between gap-2 w-full min-w-0">
                            {mode !== "post" && <button type="button" aria-expanded={showAdvancedFilters} aria-controls="home-search-filters" onClick={() => setShowAdvancedFilters(f => !f)} className="flex items-center gap-2 h-8 px-3 text-[12px] text-[color:var(--text-muted)] border border-[color:var(--border-hover)] bg-[color:var(--bg)] rounded hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                {t("advancedFilters")}
                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${showAdvancedFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>}
                            {/* Segmented exception: ModeSelector uses h-6 (not the h-8 pill scale) — same scale as the sort segmented control below. */}
                            <div className="ml-auto flex-shrink-0"><ModeSelector mode={mode} onModeChange={handleModeChange} /></div>
                            </div>
                            {mode !== "post" && showAdvancedFilters && <SearchFilters
                              mode={mode} dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo}
                              subreddit={subreddit} setSubreddit={setSubreddit} urlQuery={urlQuery} setUrlQuery={setUrlQuery}
                              deletedOnly={deletedOnly} setDeletedOnly={setDeletedOnly} showNsfw={showNsfw} setShowNsfw={setShowNsfw}
                              showSpoilers={showSpoilers} setShowSpoilers={setShowSpoilers}
                              onCommit={() => { if (searched && query && !initialLoading) searchUser(query, { push: false }); }}
                              onClear={clearFilters}
                            />}
                        </div>}
                </div>

                {searched && isOutageTakeover && <div className="max-w-md mx-auto px-4 mt-12 pb-16">
                        {/* Hero exception: the outage takeover keeps rounded-xl (all other cards use rounded) — see style scale in index.css. */}
                        <div className="border border-[color:var(--border-hover)] bg-[color:var(--bg-elevated)] rounded-xl px-7 pt-10 pb-5 text-center shadow-lg">
                            <p className="text-[color:var(--text)] text-lg font-semibold mb-2">
                                {t(`${archiveSummary}Title`)}
                            </p>
                            <p className="text-[color:var(--text)] text-sm leading-relaxed">
                                {t(`${archiveSummary}Body`)}
                            </p>
                            <ul className="mt-4 text-sm text-[color:var(--text-muted)] space-y-2">
                              {[["arctic", "Arctic Shift"], ["pullpush", "PullPush"]].map(([key, name]) => {
                                const postFailure = posts.sourceErrors[key];
                                const commentFailure = comments.sourceErrors[key];
                                const sameFailure = failureMessageKey(postFailure) === failureMessageKey(commentFailure) && postFailure?.status === commentFailure?.status;
                                return <li key={key}>{name}: {sameFailure
                                  ? t(failureMessageKey(postFailure), { status: postFailure?.status })
                                  : <>{t("tabPosts")}: {t(failureMessageKey(postFailure), { status: postFailure?.status })}<br />{t("tabComments")}: {t(failureMessageKey(commentFailure), { status: commentFailure?.status })}</>}</li>;
                              })}
                            </ul>
                            <div className="mt-5 flex flex-col items-center gap-3 text-sm">
                              <button type="button" onClick={handleRetry} disabled={initialLoading || posts.loading || comments.loading} className="text-[color:var(--accent-text)] hover:underline disabled:opacity-50">
                                {initialLoading || posts.loading || comments.loading ? t("loading") : t("tryAgain")}
                              </button>
                              <a href="https://status.arctic-shift.photon-reddit.com" target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent-text)] hover:underline">{t("archiveStatus")}</a>
                            </div>
                        </div>
                    </div>}

                {searched && !isOutageTakeover && <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 mt-3 pb-16">

                        {/* KPI summary + bot check live outside the Stats panel so they are always visible */}
                        {mode === "username" && !initialLoading && <Suspense fallback={null}>
                            <ProfileSummary
                              key={query.toLowerCase()}
                              username={query}
                              posts={allPosts}
                              comments={allComments}
                              userMeta={userMeta}
                            />
                        </Suspense>}

                        {/* key remounts the card per user so stale stats never flash */}
                        {!initialLoading && showProfile && mode === "username" && <Suspense fallback={
  <div className="flex flex-col gap-3 mb-4 mt-4 select-none animate-pulse">
    {/* KPI Stats Bar */}
    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-lg h-16 w-full"></div>

    {/* Top Row: Subreddits & Activity Heatmap */}
    <div className="flex flex-col md:flex-row gap-3">
      <div className="flex-1 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-lg h-[260px]"></div>
      <div className="flex-[2] bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-lg h-[260px]"></div>
    </div>

    {/* Common Words */}
    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-lg h-20 w-full"></div>

    {/* Political Compass Card */}
    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-lg h-[340px] w-full"></div>
  </div>
}>
                            <AccountProfile
                              key={query.toLowerCase()}
                              query={query}
                              activeTab={activeTab}
                              onWordClick={handleWordClick}
                              stats={profileStats}
                              userMeta={userMeta}
                              loadedCount={loadedCount}
                              crawledCount={crawledCount}
                              crawlCapped={crawlCapped}
                              isCrawling={isCrawling}
                              onRefresh={handleRefreshCrawl}
                              onStopCrawl={handleStopCrawl}
                              posts={allPosts}
                              comments={allComments}
                            />
                        </Suspense>}

                        {searched && <h2 ref={resultsHeadingRef} tabIndex={-1} className="sr-only">{postMode ? `${t("postViewTitle")} ${postId || ""}`.trim() : `${t("resultsFor")} ${mode === "subreddit" ? "r/" : "u/"}${query}`}</h2>}
                        {postMode ? (
                          <div className="w-full">
                            <div className="flex items-center gap-2 mb-4">
                              <button onClick={() => { clearPostMode(); setSearched(false); setQuery(""); }} className="flex items-center gap-2 px-3 h-8 border border-[color:var(--border-hover)] rounded bg-[color:var(--bg)] text-[11px] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                                {t("returnHome")}
                              </button>
                              <span className="text-[11px] text-[color:var(--text-faint)] truncate">{selectedCommentId ? `t1_${selectedCommentId}` : postId ? `t3_${postId}` : ""} {postSources.length ? `· ${postSources.join(" + ")}` : ""}</span>
                            </div>
                            {selectedComment && <div className="mb-4">
                              <h3 className="text-sm font-semibold mb-2">{t("selectedCommentTitle")}</h3>
                              <CommentCard comment={selectedComment} skipPostLoad={true} highlightTerm={deferredKeyword} />
                            </div>}
                            {postLoading ? (
                              <div aria-busy="true" className="w-full flex flex-col gap-3 py-2">
                                <div className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                  <div className="flex w-full">
                                    <div className="flex flex-col items-center gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                                      <div className="skeleton w-3.5 h-3.5 rounded"></div>
                                      <div className="skeleton w-5 h-2.5 rounded"></div>
                                    </div>
                                    <div className="flex-1 p-3">
                                      <div className="skeleton h-2.5 w-24 mb-2.5 rounded"></div>
                                      <div className="skeleton h-5 w-11/12 mb-2 rounded"></div>
                                      <div className="skeleton h-3 w-2/5 rounded"></div>
                                    </div>
                                  </div>
                                </div>
                                {[0, 1].map(i => (
                                  <div key={i} className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                    <div className="flex w-full">
                                      <div className="flex flex-col items-center gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                                        <div className="skeleton w-3.5 h-3.5 rounded"></div>
                                      </div>
                                      <div className="flex-1 p-3">
                                        <div className="skeleton h-2.5 w-32 mb-2 rounded"></div>
                                        <div className="skeleton h-3 w-full mb-1.5 rounded"></div>
                                        <div className="skeleton h-3 w-3/5 rounded"></div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                <div className="flex items-center justify-center gap-2 text-[color:var(--text-muted)] pt-2">
                                  <IconSpinner />
                                  <span className="text-[11px]">{t("postLoading")}</span>
                                </div>
                              </div>
                            ) : postError ? (
                              <ErrorState message={postError} onRetry={() => searchPost(query, { push: false })} />
                            ) : postData ? (
                              <div className="flex flex-col gap-3">
                                <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                  <div className="px-3 py-2 border-b border-[color:var(--border)] flex flex-nowrap items-center gap-2 text-[11px] text-[color:var(--text-muted)] whitespace-nowrap">
                                    <a href={`${REDDIT_BASE}/r/${encodeURIComponent(postData.subreddit || "")}`} target="_blank" rel="noopener noreferrer" className="font-medium rounded px-1 -mx-1 transition-colors hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]">r/{postData.subreddit}</a>
                                    <span>·</span>
                                    <a href={`${REDDIT_BASE}/u/${encodeURIComponent(postData.author || "")}`} target="_blank" rel="noopener noreferrer" className="rounded px-1 -mx-1 transition-colors hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]">{t("postAuthor")} u/{postData.author}</a>
                                    <span>·</span>
                                    <HoverTime utc={postData.created_utc} />
                                    <span>·</span>
                                    <span className="text-[color:var(--text)] font-medium">{fmtNum(postData.score, LOCALES[lang] || "en")}</span>
                                    {postData.upvote_ratio != null && (
                                      <>
                                        <span>·</span>
                                        <span>{t("postUpvoteRatio", { pct: Math.round(postData.upvote_ratio * 100) })}</span>
                                      </>
                                    )}
                                    <span className="ml-auto flex items-center gap-2">
                                      <span className={`${BADGE} bg-[color:var(--border)] text-[color:var(--text)] border border-[color:var(--border)] brightness-75 dark:brightness-125`}>
                                        {postData.over_18 ? t("badgeNsfw") : postData.spoiler ? t("badgeSpoiler") : postData.distinguished === "moderator" ? t("badgeMod") : postData.distinguished === "admin" ? t("badgeAdmin") : t("postOriginal")}
                                      </span>
                                      <CopyButton getText={() => {
                                        const flag = postData.removed_by_category ? " [removed]" : postData.author === "[deleted]" ? " [deleted]" : "";
                                        // Clipboard/copy stays locale-less by design: ISO timestamp +
                                        // raw fmtNum (no locale) keep pasted text machine-readable.
                                        const ts = postData.created_utc ? new Date(postData.created_utc * 1000).toISOString() : "";
                                        return [postData.title, `u/${postData.author} · r/${postData.subreddit} · ${ts} · ${fmtNum(postData.score)} pts${flag}`, `${REDDIT_BASE}${postData.permalink || ""}`, postData.selftext ? `\n${postData.selftext}` : postData.url || ""].filter(Boolean).join("\n");
                                      }} />
                                    </span>
                                  </div>
                                  <div className="p-3">
                                    <h2 className="text-base font-semibold text-[color:var(--text)] leading-snug mb-2 break-words">{postData.title || t("noContent")}</h2>
                                    {postData.selftext ? (
                                      <p className="text-[13px] text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words">{postData.selftext}</p>
                                    ) : (() => {
                                      const safePostUrl = safeHttpUrl(postData.url);
                                      return safePostUrl ? (
                                      <a href={safePostUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[color:var(--accent-text)] hover:underline break-words inline-flex items-center gap-1">
                                        {postData.url} <IconExternal />
                                      </a>
                                      ) : null;
                                    })()}
                                    {(() => {
                                      const thumb = getPostThumbnail(postData);
                                      const safeThumb = safeHttpUrl(thumb);
                                      return safeThumb ? (
                                        <div className="mt-3">
                                          <a href={safeThumb} target="_blank" rel="noopener noreferrer" className="inline-flex rounded overflow-hidden border border-[color:var(--border-hover)]">
                                            <img src={safeThumb} alt={t("openImage")} className="max-w-full max-h-[400px] object-contain" loading="lazy" />
                                          </a>
                                        </div>
                                      ) : null;
                                    })()}
                                  </div>
                                </div>
                                {!selectedCommentId && <div>
                                  <h3 className="text-[13px] font-semibold text-[color:var(--text)] mb-2 flex items-center gap-2">
                                    {t("postCommentsTitle")} <span className="text-[11px] font-normal text-[color:var(--text-muted)]">{fmtNum(Math.max(postComments.length, postData.num_comments ?? 0), LOCALES[lang] || "en")} {t("commentsWord")}</span>
                                  </h3>
                                  {postComments.length === 0 ? (
                                    <p className="text-[11px] text-[color:var(--text-muted)] italic border border-[color:var(--border-hover)] rounded px-3 py-3 bg-[color:var(--bg-elevated)]">{t("postNoComments")}</p>
                                  ) : (
                                    <div className="flex flex-col gap-2">
                                      {postComments.map(c => <CommentCard key={c.id} comment={c} skipPostLoad={true} highlightTerm={deferredKeyword} />)}
                                    </div>
                                  )}
                                </div>}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                        <>
                        <div className="flex items-stretch border-b border-[color:var(--border)] mb-4" role="tablist" aria-label={t("resultsFor")}>
                                {TABS.map(tab => {
                  let liveCount, metaCount, countToDisplay, isPlus;
                  if (tab === "all") {
                    liveCount = posts.items.length + comments.items.length;
                    const mp = userMeta?.num_posts, mc = userMeta?.num_comments;
                    metaCount = typeof mp === "number" && typeof mc === "number" ? mp + mc : undefined;
                    countToDisplay = typeof metaCount === "number" ? fmtNum(metaCount, LOCALES[lang] || "en") : fmtNum(liveCount, LOCALES[lang] || "en");
                    isPlus = typeof metaCount !== "number" && liveCount >= LIMIT;
                  } else {
                    liveCount = tab === "posts" ? posts.items.length : comments.items.length;
                    metaCount = tab === "posts" ? userMeta?.num_posts : userMeta?.num_comments;
                    countToDisplay = typeof metaCount === "number" ? fmtNum(metaCount, LOCALES[lang] || "en") : fmtNum(liveCount, LOCALES[lang] || "en");
                    isPlus = typeof metaCount !== "number" && liveCount >= LIMIT;
                  }
                  const tabLabel = tab === "all" ? t("tabAll") : tab === "posts" ? t("tabPosts") : t("tabComments");
                  return <TabBtn key={tab} label={tabLabel} count={countToDisplay} countIsPlus={isPlus} active={activeTab === tab} tab={tab} onSelect={handleTabSelect} />;
                })}
                        </div>

                        {/* Toolbar: ONE wrapping flow (no nested groups — nested groups
                            wrap independently and produce 4 ragged lines on phones).
                            All children are siblings at a 6px gap, so the browser packs
                            them into the fewest possible lines, and any second line starts
                            at the same left edge. Narrow screens use the short label
                            variants so the bar stays at 1-2 lines. */}
                        {!initialLoading && <div data-results-toolbar className="flex flex-wrap items-center gap-1.5 mb-3">
                            <details ref={datesMenuRef} onKeyDown={closeOnEscape} className="relative flex-shrink-0 group">
                                <summary className={`flex items-center gap-1.5 px-2 h-8 border rounded bg-[color:var(--bg)] text-[11px] cursor-pointer list-none hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors [&::-webkit-details-marker]:hidden ${dateFrom || dateTo ? "border-[color:var(--accent)] text-[color:var(--accent-text)]" : "border-[color:var(--border-hover)] text-[color:var(--text-muted)]"}`}>
                                    {t("dates")}{dateFrom || dateTo ? " •" : ""}
                                    <svg aria-hidden="true" className="w-3 h-3 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                                </summary>
                                <div className="absolute left-0 top-full z-30 mt-2 w-[280px] max-w-[calc(100vw-48px)] rounded-md border border-[color:var(--border-hover)] bg-[color:var(--bg-elevated)] p-3 shadow-xl">
                                  <div className="grid grid-cols-2 gap-2">
                                    <label className="flex min-w-0 flex-col gap-2 text-[11px] text-[color:var(--text-muted)]">{t("from")}
                                      <input aria-label={t("dateFrom")} type="date" max={dateTo || undefined} value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full min-w-0 bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-8 text-[11px] text-[color:var(--text)] cursor-pointer" />
                                    </label>
                                    <label className="flex min-w-0 flex-col gap-2 text-[11px] text-[color:var(--text-muted)]">{t("to")}
                                      <input aria-label={t("dateTo")} type="date" min={dateFrom || undefined} value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full min-w-0 bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-8 text-[11px] text-[color:var(--text)] cursor-pointer" />
                                    </label>
                                  </div>
                                  <div className="flex justify-between gap-2 mt-3 text-[11px]">
                                    <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-[color:var(--text-muted)] hover:text-[color:var(--text)]">{t("clear")}</button>
                                    <button type="button" onClick={event => event.currentTarget.closest("details").removeAttribute("open")} className="text-[color:var(--accent-text)]">{t("done")}</button>
                                  </div>
                                </div>
                            </details>
                            <label className="flex items-center gap-1.5 flex-shrink-0 px-2 h-8 border border-[color:var(--border-hover)] rounded bg-[color:var(--bg)] text-[11px] text-[color:var(--text-muted)] whitespace-nowrap cursor-pointer hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                <input type="checkbox" checked={deletedOnly} onChange={e => setDeletedOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)]" />
                                <span className="sm:hidden">{t("deletedShort")}</span><span className="hidden sm:inline">{t("deletedOnly")}</span>
                            </label>
                            <label className="flex items-center gap-1.5 flex-shrink-0 px-2 h-8 border border-[color:var(--border-hover)] rounded bg-[color:var(--bg)] text-[11px] text-[color:var(--text-muted)] whitespace-nowrap cursor-pointer hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                <input type="checkbox" checked={nsfwOnly} onChange={e => setNsfwOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)]" />
                                <span className="sm:hidden">{t("nsfwShort")}</span><span className="hidden sm:inline">{t("nsfwOnly")}</span>
                            </label>
                            <label title={t("spoilersHint")} className="flex items-center gap-1.5 flex-shrink-0 px-2 h-8 border border-[color:var(--border-hover)] rounded bg-[color:var(--bg)] text-[11px] text-[color:var(--text-muted)] whitespace-nowrap cursor-pointer hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                <input type="checkbox" title={t("spoilersHint")} checked={showSpoilers} onChange={e => setShowSpoilers(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)]" />
                                <span className="sm:hidden">{t("spoilersShort")}</span><span className="hidden sm:inline">{t("showSpoilers")}</span>
                            </label>
                            {/* Segmented control: h-7 buttons inside p-0.5 + 1px border
                                = the same 32px outer height as the h-8 pills. */}
                            <div className="relative flex flex-shrink-0 items-stretch rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] p-0.5 select-none" role="radiogroup" aria-label={t("sortOrder")} onKeyDown={e => {
                              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Home" && e.key !== "End") return;
                              e.preventDefault();
                              const next = e.key === "Home" ? "desc" : e.key === "End" ? "asc" : (sortOrder === "desc" ? "asc" : "desc");
                              setSortOrder(next);
                              // Move DOM focus to the newly-checked radio (roving tabindex
                              // has already moved on via state, same pattern as ModeSelector).
                              requestAnimationFrame(() => {
                                const group = e.currentTarget;
                                const checked = group?.querySelector('[role="radio"][aria-checked="true"]');
                                if (checked) checked.focus();
                              });
                            }}>
                                <button onClick={() => setSortOrder("desc")} role="radio" aria-checked={sortOrder === "desc"} tabIndex={sortOrder === "desc" ? 0 : -1} className={`px-2.5 h-7 text-[11px] rounded transition-colors cursor-pointer ${sortOrder === "desc" ? "bg-[color:var(--bg-elevated)] text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}`}>{t("newest")}</button>
                                <button onClick={() => setSortOrder("asc")} role="radio" aria-checked={sortOrder === "asc"} tabIndex={sortOrder === "asc" ? 0 : -1} className={`px-2.5 h-7 text-[11px] rounded transition-colors cursor-pointer ${sortOrder === "asc" ? "bg-[color:var(--bg-elevated)] text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}`}>{t("oldest")}</button>
                            </div>
                            {mode === "username" && <button onClick={() => setShowProfile(value => !value)} className={`flex items-center gap-1.5 flex-shrink-0 px-2 h-8 border rounded text-[11px] cursor-pointer transition-colors ${showProfile ? "bg-[color:var(--bg-elevated)] text-[color:var(--text)] border-[color:var(--text-muted)]" : "bg-[color:var(--bg)] border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]"}`}><IconActivity />{t("stats")}</button>}
                            <div className="flex flex-shrink-0 items-stretch rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] overflow-hidden select-none">
                            <button onClick={() => {
                                const cols = ["id", "type", "created_utc", "subreddit", "author", "score", "permalink", "text"];
                                const rows = filteredItems.map(item => {
                                    const text = isPost(item) ? item.title : item.body;
                                    return [item.id, isPost(item) ? "post" : "comment", item.created_utc, item.subreddit, item.author, item.score || 0, item.permalink, text];
                                });
                                const csv = serializeCsv([cols, ...rows]);
                                downloadFile(`rosint_${sanitizeFilenameSegment(query)}_${sanitizeFilenameSegment(activeTab)}.csv`, csv, "text/csv");
                            }} aria-label={`${t("exportLabel")} CSV`} className="px-2.5 h-8 text-[11px] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] cursor-pointer">CSV</button>
                            <div className="w-px self-stretch bg-[color:var(--border-hover)]" aria-hidden="true" />
                            <button onClick={() => downloadFile(`rosint_${sanitizeFilenameSegment(query)}_${sanitizeFilenameSegment(activeTab)}.json`, JSON.stringify(filteredItems, null, 2), "application/json")} aria-label={`${t("exportLabel")} JSON`} className="px-2.5 h-8 text-[11px] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] cursor-pointer">JSON</button>
                            </div>
                        </div>}

                        {initialLoading ? <div className="mb-3 flex flex-nowrap items-center gap-2 overflow-hidden" aria-hidden="true">
                                <div className="skeleton h-8 w-[116px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[116px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[84px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[78px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[73px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[118px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[95px] rounded flex-shrink-0"></div>
                            </div> : null}

                        {initialLoading ? <div className="relative mb-3">
                                <div className="w-full h-[42px] sm:h-[33px] rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] flex items-center gap-2 pl-3 pr-3">
                                    <div className="skeleton w-3.5 h-3.5 rounded-full flex-shrink-0"></div>
                                    <div className="skeleton h-2.5 w-48 max-w-[70%] rounded"></div>
                                </div>
                            </div> : (activeItemCount > 0) && <div className="relative mb-3">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
                                </span>
                                <input aria-label={t("filterPlaceholderShort")} type="text" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={isNarrow ? t("filterPlaceholderShort") : t("filterPlaceholder")} className="w-full bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-9 pr-3 py-2.5 text-[13px] sm:py-1.5 sm:text-[12px] text-[color:var(--text)] placeholder-[color:var(--text-faint)] focus:outline-none focus:border-[color:var(--accent)] transition-colors" />
                                {keyword && <button onClick={() => setKeyword("")} aria-label={t("clearKeyword")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--accent-text)] leading-none"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
                            </div>}

                        {initialLoading || (active.loading && activeItemCount === 0) ? <div role="status" aria-busy="true" aria-label={t("loading")} className="w-full flex flex-col items-stretch gap-2 py-2">
                                {[...Array(6)].map((_, i) => <div key={i} aria-hidden="true" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                        <div className="flex w-full">
                                            <div className="flex flex-col items-center justify-start gap-1 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                                                <div className="skeleton w-3.5 h-3.5 rounded"></div>
                                                <div className="skeleton w-5 h-2.5 rounded"></div>
                                            </div>
                                            <div className="flex-1 p-3 min-w-0">
                                                <div className="skeleton h-2.5 w-24 mb-2.5 rounded"></div>
                                                <div className="skeleton h-4 w-11/12 mb-2 rounded"></div>
                                                <div className="skeleton h-3 w-2/5 rounded"></div>
                                            </div>
                                        </div>
                                    </div>)}
                                <div className="flex items-center justify-center gap-2 text-[color:var(--text-muted)] pt-2">
                                    <IconSpinner />
                                    <span className="text-[11px]">{t("fetching")}</span>
                                </div>
                            </div> : filteredItems.length === 0 ? active.error ? <ErrorState message={active.error} onRetry={handleRetry} /> : <EmptyState tab={activeTab} hasFilters={!!hasFilters} query={query} mode={mode} onSwitchTab={handleSwitchTab} onClearFilters={clearFilters} deletedOnly={deletedOnly} nsfwOnly={nsfwOnly} keyword={keyword} /> : <>
                                <p className="sr-only" role="status">{`${activeItemCount} ${activeTab === "all" ? t("tabAll") : activeTab === "posts" ? t("tabPosts") : t("tabComments")}`}</p>
                                <div id="search-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="flex flex-col gap-2">
                                    {visibleItems.map(item => isPost(item)
                                      ? <CardBoundary key={`p-${item.id}`}><div className="cv-auto"><PostCard post={item} highlightTerm={deferredKeyword} /></div></CardBoundary>
                                      : <CardBoundary key={`c-${item.id}`}><div className="cv-auto"><CommentCard comment={item} highlightTerm={deferredKeyword} /></div></CardBoundary>
                                    )}
                                </div>
                                {activeHasMore && <div className="flex justify-center mt-6">
                                    {/* Hero exception: Load More stays h-10 (all other pill buttons use h-8) — see style scale in index.css. */}
                                    <button type="button" onClick={loadMoreActive} disabled={active.loading} aria-label={t("loadMoreResults")} className="flex items-center gap-2 px-6 h-10 rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] text-[color:var(--text)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium">
                                        {active.loading ? <><IconSpinner /> {t("loading")}</> : t("loadMore")}
                                    </button>
                                </div>}
                            </>}
                        </>
                        )}
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
                        <span className="mx-2 opacity-50">•</span>
                        <a href="/privacy.html" className="text-[color:var(--text-faint)] hover:underline transition-colors">{t("privacy")}</a>
                    </p>
                </footer>
        </div>;
}
