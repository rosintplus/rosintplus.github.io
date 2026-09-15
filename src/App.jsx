import { safeFetch, fetchBoth, REDDIT_BASE, ARCTIC, LIMIT, fetchPostById, fetchCommentsForPost } from "./api";
import { downloadFile, normalizeUsername, normalizeSubreddit, parsePostInput, fmtNum } from "./utils";
import { emptyStats, processItem } from "./profileData.js";
import { useI18n } from "./i18n.js";

import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense, useDeferredValue } from "react";

import { Logo } from "./components/Logo.jsx";
import { HoverHint, HoverTime } from "./components/HoverHint.jsx";
import { IconExternal, IconSpinner, IconDownload, IconActivity, IconCalendar, IconGitHub } from "./components/icons.jsx";
import { CopyButton } from "./components/CopyButton.jsx";
import { CardBoundary, PostCard, CommentCard, isPost, itemType, getStatus, getPostThumbnail } from "./components/cards.jsx";
import { EmptyState, ErrorState, TabBtn } from "./components/states.jsx";
import { ThemeSwitcher } from "./components/ThemeSwitcher.jsx";
import { ModeSelector } from "./components/ModeSelector.jsx";
import { SearchBar } from "./components/SearchBar.jsx";
import { usePaginatedFetch } from "./hooks/usePaginatedFetch.js";
import { NO_DECORATION, closeOnEscape, sleep, tJsx, matchKeyword } from "./constants.js";

// Preserved public exports (previously defined in App.jsx).
export { HoverHint } from "./components/HoverHint.jsx";
export { HighlightText } from "./components/cards.jsx";
export { IconInfo } from "./components/icons.jsx";

const TABS = ["all", "posts", "comments"];

// Render budget for the result list. Previously 100 cards mounted at once
// (each with HighlightText regex, HoverHint portals, thumbnails, badges);
// 30 keeps first paint fast and Load More reveals the rest progressively.
const PAGE_SIZE = 30;

const AccountProfile = lazy(() => import('./AccountProfile.jsx'));
const ProfileSummary = lazy(() => import('./ProfileSummary.jsx'));

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
  const [initialMode] = useState(() => {
    if (_initialPostParsed) return "post";
    return initialParams.mode === "subreddit" || (!initialParams.u && initialParams.sub) ? "subreddit" : "username";
  });
  const [initialUser] = useState(() => {
    if (initialMode === "post") return _initialPostRaw || "";
    return initialMode === "subreddit" ? normalizeSubreddit(initialParams.sub) : normalizeUsername(initialParams.u) || "";
  });
  const initialPostRaw = _initialPostRaw;
  const { t } = useI18n();
  const [mode, setMode] = useState(initialMode);
  const modeRef = useRef(initialMode);
  const [query, setQuery] = useState(initialPostId ? initialPostRaw : initialUser);
  const [activeTab, setActiveTab] = useState(initialParams.tab === "comments" ? "comments" : initialParams.tab === "posts" ? "posts" : "all");
  const handleTabSelect = useCallback((tab) => setActiveTab(tab), []);
  const handleSwitchTab = useCallback(() => setActiveTab(prev => prev === "posts" ? "comments" : "posts"), []);
  const [searched, setSearched] = useState(!!initialUser || !!initialPostId);
  const [initialLoading, setInitialLoading] = useState(!!initialUser || !!initialPostId);
  const [postId, setPostId] = useState(initialPostId);
  const [postMode, setPostMode] = useState(!!initialPostId);
  const [postData, setPostData] = useState(null);
  const [postComments, setPostComments] = useState([]);
  const [postSources, setPostSources] = useState([]);
  const [postLoading, setPostLoading] = useState(!!initialPostId);
  const [postError, setPostError] = useState(null);
  const postIdRef = useRef(initialPostId);
  const [dateFrom, setDateFrom] = useState(initialParams.from ?? "");
  const [dateTo, setDateTo] = useState(initialParams.to ?? "");
  const [showDates, setShowDates] = useState(false);
  const [subreddit, setSubreddit] = useState(initialMode === "username" && initialParams.sub ? String(initialParams.sub).replace(/^r\//, "") : "");
  const [urlQuery, setUrlQuery] = useState(initialParams.url || "");
  const [showNsfw, setShowNsfw] = useState(true); // checked = show NSFW (no filter); unchecked = exclude NSFW
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
  // Enable the hero→results collapse transition only after first paint, so the
  // search bar doesn't animate into place (slide up) on initial page load.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
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
    const fromTs = dateFrom ? Math.floor(new Date(`${dateFrom}T00:00:00`).getTime() / 1000) : null;
    const toTs = dateTo ? Math.floor(new Date(`${dateTo}T23:59:59`).getTime() / 1000) : null;
    return items.filter(item => {
      if (fromTs != null && item.created_utc < fromTs) return false;
      if (toTs != null && item.created_utc > toTs) return false;
      const type = activeTab === "all" ? itemType(item) : activeTab;
      if (deletedOnly) {
        const s = getStatus(item, type);
        if (!s.removed && !s.deleted) return false;
      }
      if (nsfwOnly && !item.over_18) return false;
      if (!matchKeyword(item, deferredKeyword, type)) return false;
      return true;
    }).sort((a, b) => sortOrder === "desc" ? b.created_utc - a.created_utc : a.created_utc - b.created_utc);
  }, [activeTab, posts.items, comments.items, deletedOnly, nsfwOnly, deferredKeyword, sortOrder, dateFrom, dateTo]);

  const [bgStatsVersion, setBgStatsVersion] = useState(0);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawledCount, setCrawledCount] = useState(0);
  const [crawlKey, setCrawlKey] = useState(0);
  const bgStatsRef = useRef(null);
  const bgCrawlRef = useRef(null);
  const crawlItemsRef = useRef(0);
  const crawledTotalRef = useRef(0);
  const crawlProcessedRef = useRef(new Set());
  const crawledPostsRef = useRef([]);
  const crawledCommentsRef = useRef([]);
  const lastCrawlQueryRef = useRef(null);
  // Explicit Refresh (profile "Refresh" button) requests the full deep crawl;
  // auto-crawl after paint stays shallow (fewer pages, deferred, gentler gaps).
  const fullCrawlRef = useRef(false);

  const handleRefreshCrawl = useCallback(() => {
    bgStatsRef.current = null;
    lastCrawlQueryRef.current = null;
    fullCrawlRef.current = true;
    setIsCrawling(true);
    setCrawledCount(0);
    setCrawlKey(k => k + 1);
  }, []);

  const handleStopCrawl = useCallback(() => {
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
    crawlItemsRef.current = 0;
    crawledTotalRef.current = 0;
    crawlProcessedRef.current = new Set();
    crawledPostsRef.current = [];
    crawledCommentsRef.current = [];

    const controller = new AbortController();
    bgCrawlRef.current = controller;
    // Explicit Refresh gets the full deep crawl; auto-crawl stays shallow so a
    // refresh never hammers the rate-limited archives behind first paint.
    const isFullCrawl = fullCrawlRef.current;
    fullCrawlRef.current = false;
    // Bounded background crawl: cap pages so prolific histories can't page
    // unboundedly, and cap wall-clock time so a slow archive can't stall the
    // tab forever. Abort stops new pages immediately (sleep is abort-aware).
    const MAX_BG_PAGES = isFullCrawl ? 8 : 3;
    const CRAWL_TIMEOUT_MS = 30000;
    const CRAWL_SLEEP_MS = 800;
    const crawlTimeoutId = setTimeout(() => { try { controller.abort(); } catch { /* noop */ } }, CRAWL_TIMEOUT_MS);
    const sleepAbortable = (ms, signal) => {
      if (ms <= 0) return Promise.resolve();
      if (!signal) return sleep(CRAWL_SLEEP_MS);
      if (signal.aborted) return Promise.resolve();
      return new Promise(resolve => {
        const t = setTimeout(() => {
          try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ }
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(t);
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    };

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
      lastFlush = Date.now();
      pendingFlush = false;
      if (controller.signal.aborted) return;
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
      const seen = new Set();
      for (const item of posts.items) seen.add(item.id);
      for (const item of comments.items) seen.add(item.id);

      const crawlStats = emptyStats();
      bgStatsRef.current = crawlStats;

      async function crawlType(type) {
        const isComment = type === "comments";
        let before = null;
        let lastId = null;
        let pages = 0;

        // Seed cursor with oldest item from initial page to start deep paging immediately
        const initialList = isComment ? comments.items : posts.items;
        if (initialList && initialList.length > 0) {
          const oldest = initialList[initialList.length - 1];
          if (oldest?.created_utc) {
            before = oldest.created_utc;
            lastId = oldest.id;
          }
        }

        while (!controller.signal.aborted) {
          if (pages >= MAX_BG_PAGES) break;
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

          if (controller.signal.aborted || !result?.items || result.items.length === 0) break;

          let anyNew = false;
          for (const item of result.items) {
            crawledTotalRef.current++;
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            crawlProcessedRef.current.add(item.id);
            crawlItemsRef.current++;
            anyNew = true;
            processItem(crawlStats, item, isComment);

            if (isComment && crawledCommentsRef.current.length < 150) {
              crawledCommentsRef.current.push(item);
            } else if (!isComment && crawledPostsRef.current.length < 100) {
              crawledPostsRef.current.push(item);
            }
          }

          // Single version bump per page (not per item), throttled above.
          if (anyNew) {
            scheduleCrawlFlush();
          }

          const last = result.items[result.items.length - 1];
          if (!last || result.items.length < LIMIT) break;
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
        if (err?.name !== "AbortError") console.error("Background crawl error:", err);
      } finally {
        clearTimeout(crawlTimeoutId);
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        // Final flush so the UI settles on exact totals even when the last
        // page arrived inside the throttle window.
        if (pendingFlush && !controller.signal.aborted) {
          setCrawledCount(crawlItemsRef.current);
          setBgStatsVersion(v => v + 1);
          pendingFlush = false;
        }
        setIsCrawling(false);
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
      if (processed?.has(item.id)) continue;
      processItem(stats, item, false);
    }
    for (const item of comments.items) {
      if (processed?.has(item.id)) continue;
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
    }

    return stats;
  }, [posts.items, comments.items, bgStatsVersion]);

  const loadedCount = useMemo(() => {
    const loaded = posts.items.length + comments.items.length;
    if (bgStatsVersion === 0) return loaded;
    const processed = crawlProcessedRef.current;
    let overlap = 0;
    for (const item of posts.items) {
      if (processed.has(item.id)) overlap++;
    }
    for (const item of comments.items) {
      if (processed.has(item.id)) overlap++;
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
    const arr = crawledLen === 0 ? posts.items : [...posts.items, ...crawledPostsRef.current];
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
    const arr = crawledLen === 0 ? comments.items : [...comments.items, ...crawledCommentsRef.current];
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
  }, [query, activeTab, deferredKeyword, sortOrder, dateFrom, dateTo, deletedOnly, nsfwOnly]);

  // Memoized render window: avoids re-slicing/mapping 100s of items on every
  // keystroke or unrelated parent render (e.g. crawl progress ticks).
  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );

  const isOutageTakeover = bothSourcesFailed && posts.items.length === 0 && comments.items.length === 0;
  useEffect(() => {
    document.title = "Rosint+";
  }, []);
  // Archive-wide totals for tab badges + summary. Shares the same URL as
  // UserSummary so safeFetch's in-flight cache dedupes both into one request.
  useEffect(() => {
    if (!query || mode === "subreddit") {
      setUserMeta(null);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    safeFetch(`${ARCTIC}/api/users/search?author=${encodeURIComponent(query)}&limit=1`, { signal: ctrl.signal }).then(res => {
      if (cancelled) return;
      setUserMeta(res.data?.[0]?._meta ?? null);
    }).catch(() => {});
    return () => { cancelled = true; ctrl.abort(); };
  }, [query, mode]);
  const buildFilters = useCallback((searchMode = mode) => {
    const f = {};
    if (dateFrom) f.dateFrom = Math.floor(new Date(dateFrom).getTime() / 1000);
    if (dateTo) f.dateTo = Math.floor(new Date(dateTo).getTime() / 1000) + 86399;
    if (subreddit.trim() && searchMode !== "subreddit") f.subreddit = subreddit.trim();
    if (!showNsfw) f.over18 = false;
    if (urlQuery.trim()) f.url = urlQuery.trim();
    return f;
  }, [dateFrom, dateTo, subreddit, showNsfw, mode, urlQuery]);
  const hasFilters = dateFrom || dateTo || (mode === "username" && subreddit.trim()) || !showNsfw || urlQuery.trim();
  const clearPostMode = useCallback(() => {
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
  }, []);
  // Keep the URL in sync with the shareable view state so findings are
  // reproducible/tab-restoreable: ?u ?tab ?from ?to ?sub ?sort. replaceState
  // (not push) so swapping tabs/filters doesn't pollute browser history.
  useEffect(() => {
    if (!searched || !query) return;
    if (postMode) {
      const url = new URL(window.location.href);
      if (postId) {
        url.searchParams.set("post", postId);
        url.searchParams.delete("u");
        url.searchParams.delete("sub");
        url.searchParams.delete("mode");
      }
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
      if (subreddit.trim()) url.searchParams.set("sub", subreddit.trim());
      else url.searchParams.delete("sub");
    }
    // Only write non-default state so the shared URL stays minimal
    // (?u=name); defaults are implied when the params are absent.
    if (activeTab !== "all") url.searchParams.set("tab", activeTab);
    else url.searchParams.delete("tab");
    if (sortOrder !== "desc") url.searchParams.set("sort", sortOrder);
    else url.searchParams.delete("sort");
    if (dateFrom) url.searchParams.set("from", dateFrom);
    else url.searchParams.delete("from");
    if (dateTo) url.searchParams.set("to", dateTo);
    else url.searchParams.delete("to");
    if (deletedOnly) url.searchParams.set("deleted", "1");
    else url.searchParams.delete("deleted");
    if (nsfwOnly) url.searchParams.set("nsfw", "1");
    else url.searchParams.delete("nsfw");
    if (urlQuery.trim()) url.searchParams.set("url", urlQuery.trim());
    else url.searchParams.delete("url");
    if (showProfile) url.searchParams.set("stats", "1");
    else url.searchParams.delete("stats");
    window.history.replaceState({}, "", url);
  }, [searched, query, mode, activeTab, subreddit, dateFrom, dateTo, sortOrder, deletedOnly, nsfwOnly, showProfile, postMode, postId, urlQuery]);
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
      return;
    }
    const id = parsed.postId;
    const searchId = ++searchIdRef.current;
    setPostId(id);
    postIdRef.current = id;
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
      url.searchParams.set("post", id);
      url.searchParams.delete("u");
      url.searchParams.delete("sub");
      url.searchParams.delete("mode");
      url.searchParams.delete("tab");
      window.history.pushState({}, "", url);
    }
    // Stream: show post as soon as it arrives, don't wait for comments
    const postPromise = fetchPostById(id).then(postRes => {
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
    const commentsPromise = fetchCommentsForPost(id, { limit: 100 }).then(commentsRes => {
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
    }
  }, [t]);
  const searchUser = useCallback(async (rawUser, {
    push = true,
    silent = false
  } = {}) => {
    if (modeRef.current === "post") {
      return searchPost(rawUser, { push });
    }
    // exiting post mode for a normal user/subreddit search
    if (postMode) {
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
      window.history.replaceState({}, "", url);
    }
    const m = modeRef.current;
    const user = m === "subreddit" ? normalizeSubreddit(rawUser) : normalizeUsername(rawUser);
    if (!user) return;
    const searchId = ++searchIdRef.current;
    setQuery(user);
    setSearched(true);
    if (m === "username") {
      setIsCrawling(true);
      setCrawledCount(0);
      bgStatsRef.current = null;
      lastCrawlQueryRef.current = null;
      setCrawlKey(k => k + 1);
    }
    if (!silent) setInitialLoading(true);
    const filters = buildFilters(m);
    let doneCount = 0;
    const maybeDone = () => {
      doneCount++;
      if (doneCount === 1 && !silent && searchId === searchIdRef.current) {
        // First of posts/comments has landed — show results immediately
        // instead of waiting for the slower type. No UI change, just faster paint.
        setInitialLoading(false);
      }
    };
    const postsPromise = resetPosts(user, filters, { sort: sortOrder, mode: m }).then(r => {
      if (searchId === searchIdRef.current) maybeDone();
      return r;
    });
    const commentsPromise = resetComments(user, filters, { sort: sortOrder, mode: m }).then(r => {
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
      }
      window.history.pushState({}, "", url);
    }
    if (!silent) setInitialLoading(false);
  }, [buildFilters, resetPosts, resetComments, sortOrder, postMode, searchPost]);
  const searchUserRef = useRef(searchUser);
  searchUserRef.current = searchUser;
  const handleModeChange = useCallback(nextMode => {
    if (nextMode === modeRef.current) return;
    modeRef.current = nextMode;
    setMode(nextMode);
    if (nextMode === "post") {
      if (postMode) {
        clearPostMode();
      }
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
    const rawPost = p.get("post") || p.get("p") || p.get("postId") || p.get("id") || "";
    const parsed = parsePostInput(rawPost) || (rawPost && /^[a-z0-9]{5,10}$/i.test(rawPost.trim()) ? { postId: rawPost.trim().replace(/^t3_/i, "").toLowerCase(), commentId: null } : null);
    if (parsed?.postId) {
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
      push: false
    });
    else if (s) searchUser(s, {
      push: false
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      const rawPost = p.get("post") || p.get("p") || p.get("postId") || p.get("id") || "";
      const parsed = parsePostInput(rawPost) || (rawPost && /^[a-z0-9]{5,10}$/i.test(rawPost.trim()) ? { postId: rawPost.trim().replace(/^t3_/i, "").toLowerCase() } : null);
      if (parsed?.postId) {
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
      const u = normalizeUsername(p.get("u"));
      const s = normalizeSubreddit(p.get("sub"));
      if (u) {
        searchUser(u, {
          push: false
        });
      } else if (s) {
        searchUser(s, {
          push: false
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
    if (postMode && postId) {
      await searchPost(postId, { push: false });
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
  }, [query, buildFilters, resetPosts, resetComments, sortOrder, postMode, postId, searchPost]);
  const clearFilters = useCallback(async () => {
    setDateFrom("");
    setDateTo("");
    setSubreddit("");
    setUrlQuery("");
    setShowNsfw(true);
    setNsfwOnly(false);
    if (postMode && postId) {
      await searchPost(postId, { push: false });
      return;
    }
    if (!query) return;
    setInitialLoading(true);
    const m = modeRef.current;
    await Promise.all([resetPosts(query, {}, { sort: sortOrder, mode: m }), resetComments(query, {}, { sort: sortOrder, mode: m })]);
    setInitialLoading(false);
  }, [query, resetPosts, resetComments, sortOrder, postMode, postId, searchPost]);

  const active = useMemo(() => activeTab === "posts" ? posts : activeTab === "comments" ? comments : { loading: posts.loading || comments.loading, error: posts.error || comments.error, done: posts.done && comments.done }, [activeTab, posts, comments]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- active.items is undefined for "all" tab
  const activeItemCount = useMemo(() => activeTab === "all" ? posts.items.length + comments.items.length : active.items.length, [activeTab, posts.items.length, comments.items.length]);
  const activeHasMore = useMemo(() => {
    if (visibleCount < filteredItems.length) return true;
    return activeTab === "all" ? (!posts.done || !comments.done) : !active.done;
  }, [visibleCount, filteredItems.length, activeTab, posts.done, comments.done, active.done]);

  const loadMoreActive = useCallback(() => {
    if (visibleCount < filteredItems.length) {
      setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredItems.length));
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
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[color:var(--accent)] focus:text-[color:var(--bg)] focus:rounded focus:text-sm focus:font-bold focus:outline-none">Skip to content</a>
        <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-[color:var(--bg)] border-b border-[color:var(--border)]">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                        <Logo />
                    </a>
                <a href="https://github.com/rosintplus/rosintplus.github.io" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" className="w-9 h-9 sm:h-8 sm:w-8 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center justify-center flex-shrink-0"style={NO_DECORATION}>
                    <IconGitHub className="w-4 h-4" />
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
        <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-[color:var(--bg)] border-b border-[color:var(--border)]">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                    <Logo />
                </a>
                <a href="https://github.com/rosintplus/rosintplus.github.io" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" className="w-9 h-9 sm:h-8 sm:w-8 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center justify-center flex-shrink-0"style={NO_DECORATION}>
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
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
            <header className={`${scrolled ? "" : "header-top"} fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-[color:var(--bg)] border-b border-[color:var(--border)]`}>
                <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <a href="/" className="text-[color:var(--text)] hover:text-[color:var(--accent)] transition-colors font-bold text-base sm:text-lg leading-none whitespace-nowrap"style={NO_DECORATION}>
                    <Logo />
                </a>
                <a href="https://github.com/rosintplus/rosintplus.github.io" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" className="w-9 h-9 sm:h-8 sm:w-8 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors border border-[color:var(--border-hover)] hover:border-[color:var(--text-muted)] rounded flex items-center justify-center flex-shrink-0"style={NO_DECORATION}>
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
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
                        <button onClick={() => setBannerDismissed(true)} aria-label="Dismiss" className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] flex-shrink-0 transition-colors text-lg leading-none">
                            ×
                        </button>
                    </div>}
                <div className={`w-full max-w-3xl mx-auto px-3 sm:px-4 ${mounted ? "transition-all duration-300" : ""} ${searched ? "pt-6" : "flex-1 flex flex-col justify-center"}`}>
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
                    <div className="relative mx-auto w-full flex-shrink-0" style={{
          maxWidth: searched ? '100%' : '690px'
        }}>
                        
                        <SearchBar defaultQuery={query} onSearch={searchUser} initialLoading={initialLoading} mode={mode} />
                    </div>

                    {!searched && <div className="relative flex flex-col gap-2 mt-3 mx-auto w-full flex-shrink-0" style={{
          maxWidth: '690px'
        }}>
                            <div className="flex items-center justify-between gap-2 w-full min-w-0">
                            <button type="button" onClick={() => setShowAdvancedFilters(f => !f)} className="flex items-center gap-1.5 h-[30px] px-3 text-[12px] text-[color:var(--text-muted)] border border-[color:var(--border-hover)] bg-[color:var(--bg)] rounded hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                {t("advancedFilters")}
                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${showAdvancedFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <div className="ml-auto flex-shrink-0"><ModeSelector mode={mode} onModeChange={handleModeChange} /></div>
                            </div>
                            {showAdvancedFilters && <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded-md shadow-xl shadow-black/40 px-3 py-2.5 flex flex-col gap-2.5">
                                    <div className="flex flex-wrap items-center gap-2 w-full">
                                        <span className="text-[11px] text-[color:var(--text-muted)]">{t("from")}</span>
                                        <input aria-label="Date from" type="date" max={dateTo || undefined} value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-8 text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors" />
                                        <span className="text-[11px] text-[color:var(--text-muted)]">{t("to")}</span>
                                        <input aria-label="Date to" type="date" min={dateFrom || undefined} value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-8 text-[12px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] transition-colors" />
                                        {mode === "username" && <><span className="text-[11px] text-[color:var(--text-muted)]">{t("in")}</span>
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
                  }} placeholder={t("subredditPlaceholder")} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-8 pr-3 h-8 text-[12px] text-[color:var(--text)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)] transition-colors min-w-[120px] max-w-[240px] flex-1" />
                                        </div></>}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 w-full">
                                        <span className="text-[11px] text-[color:var(--text-muted)] whitespace-nowrap">{t("externalLink")}</span>
                                        <input aria-label="External link URL contains" type="text" value={urlQuery} onChange={e => setUrlQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && searched && query && !initialLoading) searchUser(query, { push: false }); }} onBlur={() => { if (searched && query && !initialLoading && urlQuery.trim()) searchUser(query, { push: false }); }} placeholder={t("externalLinkPlaceholder")} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-8 text-[12px] text-[color:var(--text)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)] transition-colors min-w-[160px] flex-1" />
                                        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input type="checkbox" checked={deletedOnly} onChange={e => setDeletedOnly(e.target.checked)} className="w-3.5 h-3.5 accent-[color:var(--accent)] cursor-pointer" />
                                                <span className="text-[11px] text-[color:var(--text-muted)] whitespace-nowrap">{t("deletedOnly")}</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input type="checkbox" checked={showNsfw} onChange={e => setShowNsfw(e.target.checked)} className="w-3.5 h-3.5 accent-[color:var(--accent)] cursor-pointer" />
                                                <span className="text-[11px] text-[color:var(--text-muted)] whitespace-nowrap">{t("showNsfw")}</span>
                                            </label>
                                        </div>
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

                {searched && !isOutageTakeover && <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 mt-3 pb-16">

                        {/* KPI summary + bot check live outside the Stats panel so they are always visible */}
                        {mode === "username" && !initialLoading && <Suspense fallback={null}>
                            <ProfileSummary
                              username={query}
                              posts={allPosts}
                              comments={allComments}
                              userMeta={userMeta}
                            />
                        </Suspense>}

                        {/* key remounts the card per user so stale stats never flash */}
                        {!initialLoading && showProfile && mode === "username" && <Suspense fallback={
  <div className="flex flex-col gap-4 mb-4 mt-4 select-none animate-pulse">
    {/* KPI Stats Bar */}
    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg h-16 w-full"></div>

    {/* Top Row: Subreddits & Activity Heatmap */}
    <div className="flex flex-col md:flex-row gap-4">
      <div className="flex-1 bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg h-[260px]"></div>
      <div className="flex-[2] bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg h-[260px]"></div>
    </div>

    {/* Common Words */}
    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg h-20 w-full"></div>

    {/* Political Compass Card */}
    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border)] rounded-lg h-[340px] w-full"></div>
  </div>
}>
                            <AccountProfile
                              query={query}
                              activeTab={activeTab}
                              onWordClick={handleWordClick}
                              stats={profileStats}
                              userMeta={userMeta}
                              loadedCount={loadedCount}
                              crawledCount={crawledCount}
                              isCrawling={isCrawling}
                              onRefresh={handleRefreshCrawl}
                              onStopCrawl={handleStopCrawl}
                              posts={allPosts}
                              comments={allComments}
                            />
                        </Suspense>}

                        {searched && <h2 className="sr-only">{postMode ? `${t("postViewTitle")} ${postId || ""}`.trim() : `${t("resultsFor")} ${mode === "subreddit" ? "r/" : "u/"}{query}`}</h2>}
                        {postMode ? (
                          <div className="w-full">
                            <div className="flex items-center gap-2 mb-4">
                              <button onClick={() => { clearPostMode(); setSearched(false); setQuery(""); }} className="flex items-center gap-1.5 px-3 h-8 border border-[color:var(--border-hover)] rounded bg-[color:var(--bg)] text-[11px] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                                {t("returnHome")}
                              </button>
                              <span className="text-[11px] text-[color:var(--text-faint)] truncate">{postId ? `t3_${postId}` : ""} {postSources.length ? `· ${postSources.join(" + ")}` : ""}</span>
                            </div>
                            {postLoading ? (
                              <div aria-busy="true" className="w-full flex flex-col gap-3 py-2">
                                <div className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                  <div className="flex w-full">
                                    <div className="flex flex-col items-center gap-1.5 px-2.5 py-3 bg-[color:var(--bg)] min-w-[40px]">
                                      <div className="skeleton w-3.5 h-3.5 rounded-sm"></div>
                                      <div className="skeleton w-5 h-2.5 rounded-sm"></div>
                                    </div>
                                    <div className="flex-1 p-3">
                                      <div className="skeleton h-2.5 w-24 mb-2.5 rounded-sm"></div>
                                      <div className="skeleton h-5 w-11/12 mb-2 rounded-sm"></div>
                                      <div className="skeleton h-3 w-2/5 rounded-sm"></div>
                                    </div>
                                  </div>
                                </div>
                                {[0, 1].map(i => (
                                  <div key={i} className="w-full bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                    <div className="flex w-full">
                                      <div className="flex flex-col items-center gap-1.5 px-2 py-3 bg-[color:var(--bg)] min-w-[40px]">
                                        <div className="skeleton w-3.5 h-3.5 rounded-sm"></div>
                                      </div>
                                      <div className="flex-1 p-3">
                                        <div className="skeleton h-2.5 w-32 mb-2 rounded-sm"></div>
                                        <div className="skeleton h-3 w-full mb-1.5 rounded-sm"></div>
                                        <div className="skeleton h-3 w-3/5 rounded-sm"></div>
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
                              <ErrorState message={postError} onRetry={() => searchPost(postId, { push: false })} />
                            ) : postData ? (
                              <div className="flex flex-col gap-4">
                                <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded overflow-hidden">
                                  <div className="px-3 py-2 border-b border-[color:var(--border)] flex flex-nowrap items-center gap-2 text-[11px] text-[color:var(--text-muted)] whitespace-nowrap">
                                    <a href={`${REDDIT_BASE}/r/${postData.subreddit}`} target="_blank" rel="noopener noreferrer" className="font-medium rounded px-1 -mx-1 transition-colors hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]">r/{postData.subreddit}</a>
                                    <span>·</span>
                                    <a href={`${REDDIT_BASE}/u/${postData.author}`} target="_blank" rel="noopener noreferrer" className="rounded px-1 -mx-1 transition-colors hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]">{t("postAuthor")} u/{postData.author}</a>
                                    <span>·</span>
                                    <HoverTime utc={postData.created_utc} />
                                    <span>·</span>
                                    <span className="text-[color:var(--text)] font-medium">{fmtNum(postData.score)}</span>
                                    {postData.upvote_ratio != null && (
                                      <>
                                        <span>·</span>
                                        <span>{t("postUpvoteRatio").replace("{pct}", Math.round(postData.upvote_ratio * 100))}</span>
                                      </>
                                    )}
                                    <span className="ml-auto flex items-center gap-1.5">
                                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[color:var(--border)] text-[color:var(--text-muted)]">
                                        {postData.over_18 ? "NSFW" : postData.spoiler ? t("badgeSpoiler") : postData.distinguished === "moderator" ? "Mod" : postData.distinguished === "admin" ? "Admin" : t("postOriginal")}
                                      </span>
                                      <CopyButton getText={() => {
                                        const flag = postData.removed_by_category ? " [removed]" : postData.author === "[deleted]" ? " [deleted]" : "";
                                        const ts = postData.created_utc ? new Date(postData.created_utc * 1000).toISOString() : "";
                                        return [postData.title, `u/${postData.author} · r/${postData.subreddit} · ${ts} · ${fmtNum(postData.score)} pts${flag}`, `${REDDIT_BASE}${postData.permalink || ""}`, postData.selftext ? `\n${postData.selftext}` : postData.url || ""].filter(Boolean).join("\n");
                                      }} />
                                    </span>
                                  </div>
                                  <div className="p-3">
                                    <h2 className="text-base font-semibold text-[color:var(--text)] leading-snug mb-2 break-words">{postData.title || t("noContent")}</h2>
                                    {postData.selftext ? (
                                      <p className="text-[13px] text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words">{postData.selftext}</p>
                                    ) : postData.url ? (
                                      <a href={postData.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[color:var(--accent-text)] hover:underline break-words inline-flex items-center gap-1">
                                        {postData.url} <IconExternal />
                                      </a>
                                    ) : null}
                                    {(() => {
                                      const thumb = getPostThumbnail(postData);
                                      return thumb ? (
                                        <div className="mt-3">
                                          <a href={thumb} target="_blank" rel="noopener noreferrer" className="inline-flex rounded overflow-hidden border border-[color:var(--border-hover)]">
                                            <img src={thumb} alt={t("openImage")} className="max-w-full max-h-[400px] object-contain" loading="lazy" />
                                          </a>
                                        </div>
                                      ) : null;
                                    })()}
                                  </div>
                                </div>
                                <div>
                                  <h3 className="text-[13px] font-semibold text-[color:var(--text)] mb-2 flex items-center gap-2">
                                    {t("postCommentsTitle")} <span className="text-[11px] font-normal text-[color:var(--text-muted)]">{fmtNum(Math.max(postComments.length, postData.num_comments ?? 0))} {t("commentsWord")}</span>
                                  </h3>
                                  {postComments.length === 0 ? (
                                    <p className="text-[11px] text-[color:var(--text-muted)] italic border border-[color:var(--border-hover)] rounded px-3 py-3 bg-[color:var(--bg)]">{t("postNoComments")}</p>
                                  ) : (
                                    <div className="flex flex-col gap-2">
                                      {postComments.map(c => <CommentCard key={c.id} comment={c} skipPostLoad={true} highlightTerm={deferredKeyword} />)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                        <>
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
                  return <TabBtn key={tab} label={tabLabel} count={countToDisplay} countIsPlus={isPlus} active={activeTab === tab} tab={tab} onSelect={handleTabSelect} />;
                })}
                        </div>

                        {!initialLoading && <div className="flex flex-nowrap items-center gap-1.5 mb-3 overflow-x-auto">
                            <div className="relative flex-shrink-0">
                                <div className="flex items-center gap-1.5">
                                    <input aria-label="Date from" type="date" max={dateTo || undefined} value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-8 text-[11px] text-[color:var(--text)] cursor-pointer" />
                                    <input aria-label="Date to" type="date" min={dateFrom || undefined} value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-8 text-[11px] text-[color:var(--text)] cursor-pointer" />
                                </div>
                                <button type="button" aria-hidden="true" tabIndex={-1} className="hidden">
                                    <IconCalendar />
                                </button>
                                {showDates && <>
                                    <div className="fixed inset-0 z-20" onClick={() => setShowDates(false)} aria-hidden="true" />
                                    <div className="absolute right-0 top-full mt-2 z-30 flex items-center gap-2 p-2 whitespace-nowrap bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl">
                                        <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">{t("from")}
                                            <input aria-label="Date from" type="date" max={dateTo || undefined} value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 text-[12px] text-[color:var(--text)]" />
                                        </label>
                                        <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">{t("to")}
                                            <input aria-label="Date to" type="date" min={dateFrom || undefined} value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded px-2 h-7 text-[12px] text-[color:var(--text)]" />
                                        </label>
                                        <button onClick={clearFilters} disabled={!dateFrom && !dateTo} className="px-2 h-7 text-[11px] border border-[color:var(--border-hover)] rounded disabled:opacity-50">{t("clear")}</button>
                                    </div>
                                </>}
                            </div>
                            <label className="flex items-center gap-1.5 flex-shrink-0 px-2 h-8 border border-[color:var(--border-hover)] rounded text-[11px] text-[color:var(--text-muted)] whitespace-nowrap cursor-pointer hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                <input type="checkbox" checked={deletedOnly} onChange={e => setDeletedOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)]" /> {t("deletedOnly").replace(/\s+only$/i, "")}
                            </label>
                            <label className="flex items-center gap-1.5 flex-shrink-0 px-2 h-8 border border-[color:var(--border-hover)] rounded text-[11px] text-[color:var(--text-muted)] whitespace-nowrap cursor-pointer hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] transition-colors">
                                <input type="checkbox" checked={nsfwOnly} onChange={e => setNsfwOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)]" /> {t("nsfwOnly").replace(/\s+only$/i, "")}
                            </label>
                            {mode === "username" && <button onClick={() => setShowProfile(value => !value)} className={`flex items-center gap-1.5 flex-shrink-0 px-2.5 h-8 border rounded text-[11px] cursor-pointer transition-colors ${showProfile ? "bg-[color:var(--bg-elevated)] text-[color:var(--text)] border-[color:var(--text-muted)]" : "border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)]"}`}><IconActivity />{t("stats")}</button>}
                            <div className="relative flex flex-shrink-0 items-stretch rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] p-0.5 select-none" role="radiogroup" aria-label="Sort order">
                                <button onClick={() => setSortOrder("desc")} role="radio" aria-checked={sortOrder === "desc"} className={`px-3 h-7 text-[11px] rounded transition-colors cursor-pointer ${sortOrder === "desc" ? "border border-[color:var(--border-hover)] bg-[color:var(--bg-elevated)] text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}`}>{t("newest")}</button>
                                <button onClick={() => setSortOrder("asc")} role="radio" aria-checked={sortOrder === "asc"} className={`px-3 h-7 text-[11px] rounded transition-colors cursor-pointer ${sortOrder === "asc" ? "border border-[color:var(--border-hover)] bg-[color:var(--bg-elevated)] text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}`}>{t("oldest")}</button>
                            </div>
                            <div className="flex flex-shrink-0 items-stretch rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] overflow-hidden select-none">
                            <button onClick={() => {
                                const cols = ["id", "type", "created_utc", "subreddit", "author", "score", "permalink", "text"];
                                const csv = [cols.join(",")].concat(filteredItems.map(item => {
                                    const text = isPost(item) ? item.title : item.body;
                                    return [item.id, isPost(item) ? "post" : "comment", item.created_utc, item.subreddit, item.author, item.score || 0, item.permalink, text ? `"${text.replace(/"/g, '""').replace(/\n/g, " ")}"` : ""].join(",");
                                })).join("\n");
                                downloadFile(`rosint_${query}_${activeTab}.csv`, csv, "text/csv");
                            }} className="px-3 h-8 text-[11px] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] cursor-pointer">CSV</button>
                            <div className="w-px self-stretch bg-[color:var(--border-hover)]" aria-hidden="true" />
                            <button onClick={() => downloadFile(`rosint_${query}_${activeTab}.json`, JSON.stringify(filteredItems, null, 2), "application/json")} className="px-3 h-8 text-[11px] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] cursor-pointer">JSON</button>
                            </div>
                        </div>}

                        {initialLoading ? <div className="mb-3 flex flex-nowrap items-center gap-1.5 overflow-hidden" aria-hidden="true">
                                <div className="skeleton h-8 w-[116px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[116px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[84px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[78px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[73px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[118px] rounded flex-shrink-0"></div>
                                <div className="skeleton h-8 w-[95px] rounded flex-shrink-0"></div>
                            </div> : <>
                                <div className="hidden grid-cols-3 gap-1 mb-1.5">
                                    <HoverHint hint={t("searchOnRedditHint")}>
                                        <a href={mode === "subreddit" ? `https://www.reddit.com/r/${encodeURIComponent(query)}` : `https://www.reddit.com/search/?q=author%3A%22${encodeURIComponent(query)}%22`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 w-full min-w-0 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent-text)] transition-colors h-8 border border-[color:var(--border-hover)] rounded">
                                            <IconExternal /> {t("searchOnReddit")}
                                        </a>
                                    </HoverHint>
                                    <label className="flex items-center justify-center gap-1.5 flex-1 min-w-0 cursor-pointer select-none border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-8 bg-[color:var(--bg)] transition-colors">
                                        <input type="checkbox" checked={deletedOnly} onChange={e => setDeletedOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)] cursor-pointer" />
                                        <span className="text-[11px] whitespace-nowrap">{t("deletedOnly")}</span>
                                    </label>
                                    <label className="flex items-center justify-center gap-1.5 flex-1 min-w-0 cursor-pointer select-none border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-8 bg-[color:var(--bg)] transition-colors">
                                        <input type="checkbox" checked={nsfwOnly} onChange={e => setNsfwOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)] cursor-pointer" />
                                        <span className="text-[11px] whitespace-nowrap">{t("nsfwOnly")}</span>
                                    </label>
                                </div>
                                <div className="hidden gap-1 mb-3">
                                    <details className="hidden relative group/sort flex-1" onKeyDown={closeOnEscape}>
                                        <summary aria-label={t("newest")} className="flex items-center justify-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-8 px-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                                            <span className="text-[11px] pointer-events-none">{sortOrder === "desc" ? t("newest") : t("oldest")}</span><svg className="w-3 h-3 text-[color:var(--text-muted)] pointer-events-none opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </summary>
                                        <div className="fixed inset-0 z-40 hidden group-open/sort:block" onClick={e => e.currentTarget.closest('details').removeAttribute('open')} aria-hidden="true" />
                                        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[90px] hidden group-open/sort:block">
                                            <button onClick={e => { setSortOrder("desc"); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[color:var(--border)] transition-colors">
                                                <span className={sortOrder === "desc" ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}>{t("newest")}</span>
                                            </button>
                                            <button onClick={e => { setSortOrder("asc"); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[color:var(--border)] transition-colors">
                                                <span className={sortOrder === "asc" ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}>{t("oldest")}</span>
                                            </button>
                                        </div>
                                    </details>
                                    {mode === "username" && <button onClick={() => setShowProfile(p => !p)} className={`flex items-center justify-center gap-1.5 flex-1 px-2.5 h-8 transition-colors border rounded outline-none cursor-pointer select-none ${showProfile ? "bg-[color:var(--bg-elevated)] text-[color:var(--text)] border-[color:var(--text-muted)]" : "bg-[color:var(--bg)] text-[color:var(--text-muted)] border-[color:var(--border-hover)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] hover:border-[color:var(--text-muted)]"}`}>
                                        <IconActivity />
                                        <span className="text-[11px] whitespace-nowrap">{t("stats")}</span>
                                    </button>}
                                    <details className="hidden relative group/export flex-1" onKeyDown={closeOnEscape}>
                                        <summary aria-label="Export" className="flex items-center justify-center gap-1.5 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] hover:border-[color:var(--text-muted)] h-8 transition-colors border border-[color:var(--border-hover)] rounded text-[11px] whitespace-nowrap cursor-pointer list-none [&::-webkit-details-marker]:hidden outline-none">
                                            <svg className="w-3 h-3 text-[color:var(--text-muted)] pointer-events-none opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
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
                                            }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border)] transition-colors">
                                                <IconDownload />
                                                CSV
                                            </button>
                                            <button onClick={e => {
                                                downloadFile(`rosint_${query}_${activeTab}.json`, JSON.stringify(filteredItems, null, 2), "application/json");
                                                e.currentTarget.closest('details').removeAttribute('open');
                                            }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border)] transition-colors">
                                                <IconDownload />
                                                JSON
                                            </button>
                                        </div>
                                    </details>
                                </div>
                                <div className="hidden flex-wrap items-center gap-x-1 gap-y-1.5 mb-3 justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <HoverHint hint={t("searchOnRedditHint")}>
                                            <a href={mode === "subreddit" ? `https://www.reddit.com/r/${encodeURIComponent(query)}` : `https://www.reddit.com/search/?q=author%3A%22${encodeURIComponent(query)}%22`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent-text)] transition-colors leading-relaxed">
                                                <IconExternal /> {t("searchOnReddit")}
                                            </a>
                                        </HoverHint>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded px-2 h-8 bg-[color:var(--bg)] transition-colors">
                                            <input type="checkbox" checked={deletedOnly} onChange={e => setDeletedOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)] cursor-pointer" />
                                            <span className="text-[11px] whitespace-nowrap">{t("deletedOnly")}</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded px-2 h-8 bg-[color:var(--bg)] transition-colors">
                                            <input type="checkbox" checked={nsfwOnly} onChange={e => setNsfwOnly(e.target.checked)} className="w-3 h-3 accent-[color:var(--accent)] cursor-pointer" />
                                            <span className="text-[11px] whitespace-nowrap">{t("nsfwOnly")}</span>
                                        </label>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <details className="hidden relative group/sort" onKeyDown={closeOnEscape}>
                                            <summary aria-label={t("newest")} className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] rounded h-8 px-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                                                <span className="text-[11px] pointer-events-none">{sortOrder === "desc" ? t("newest") : t("oldest")}</span><svg className="w-3 h-3 text-[color:var(--text-muted)] pointer-events-none opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                            </summary>
                                            <div className="fixed inset-0 z-40 hidden group-open/sort:block" onClick={e => e.currentTarget.closest('details').removeAttribute('open')} aria-hidden="true" />
                                            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[90px] hidden group-open/sort:block">
                                                <button onClick={e => { setSortOrder("desc"); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[color:var(--border)] transition-colors">
                                                    <span className={sortOrder === "desc" ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}>{t("newest")}</span>
                                                </button>
                                                <button onClick={e => { setSortOrder("asc"); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[color:var(--border)] transition-colors">
                                                    <span className={sortOrder === "asc" ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}>{t("oldest")}</span>
                                                </button>
                                            </div>
                                        </details>
                                        {mode === "username" && <button onClick={() => setShowProfile(p => !p)} className={`flex items-center gap-1.5 px-2.5 h-8 transition-colors border rounded outline-none cursor-pointer select-none ${showProfile ? "bg-[color:var(--bg-elevated)] text-[color:var(--text)] border-[color:var(--text-muted)]" : "bg-[color:var(--bg)] text-[color:var(--text-muted)] border-[color:var(--border-hover)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] hover:border-[color:var(--text-muted)]"}`}>
                                            <IconActivity />
                                            <span className="text-[11px] whitespace-nowrap">{t("stats")}</span>
                                        </button>}
                                        <details className="hidden relative group/export" onKeyDown={closeOnEscape}>
                                            <summary aria-label="Export" className="flex items-center gap-1.5 bg-[color:var(--bg)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] hover:border-[color:var(--text-muted)] px-2.5 h-8 transition-colors border border-[color:var(--border-hover)] rounded text-[11px] whitespace-nowrap cursor-pointer list-none [&::-webkit-details-marker]:hidden outline-none">
                                                <svg className="w-3 h-3 text-[color:var(--text-muted)] pointer-events-none opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
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
                                                }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border)] transition-colors">
                                                    <IconDownload />
                                                    CSV
                                                </button>
                                                <button onClick={e => {
                                                    downloadFile(`rosint_${query}_${activeTab}.json`, JSON.stringify(filteredItems, null, 2), "application/json");
                                                    e.currentTarget.closest('details').removeAttribute('open');
                                                }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border)] transition-colors">
                                                    <IconDownload />
                                                    JSON
                                                </button>
                                            </div>
                                        </details>
                                    </div>
                                </div>
                            </>}

                        {initialLoading ? <div className="relative mb-3">
                                <div className="w-full h-[42px] sm:h-[33px] rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] flex items-center gap-2 pl-3 pr-3">
                                    <div className="skeleton w-3.5 h-3.5 rounded-full flex-shrink-0"></div>
                                    <div className="skeleton h-2.5 w-48 max-w-[70%] rounded-sm"></div>
                                </div>
                            </div> : (activeItemCount > 0) && <div className="relative mb-3">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
                                </span>
                                <input aria-label={t("filterPlaceholderShort")} type="text" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={isNarrow ? t("filterPlaceholderShort") : t("filterPlaceholder")} className="w-full bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded pl-9 pr-3 py-2.5 text-[13px] sm:py-1.5 sm:text-[12px] text-[color:var(--text)] placeholder-[color:var(--text-faint)] focus:outline-none focus:border-[color:var(--accent)] transition-colors" />
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
                            </div> : filteredItems.length === 0 ? active.error ? <ErrorState message={active.error} onRetry={handleRetry} /> : <EmptyState tab={activeTab} hasFilters={!!hasFilters} query={query} mode={mode} onSwitchTab={handleSwitchTab} onClearFilters={clearFilters} deletedOnly={deletedOnly} nsfwOnly={nsfwOnly} keyword={keyword} /> : <>
                                <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-2">
                                    {visibleItems.map(item => isPost(item)
                                      ? <CardBoundary key={`p-${item.id}`}><div className="cv-auto"><PostCard post={item} highlightTerm={deferredKeyword} /></div></CardBoundary>
                                      : <CardBoundary key={`c-${item.id}`}><div className="cv-auto"><CommentCard comment={item} highlightTerm={deferredKeyword} /></div></CardBoundary>
                                    )}
                                </div>
                                {activeHasMore && <div className="flex justify-center mt-6">
                                    <button type="button" onClick={loadMoreActive} disabled={active.loading} aria-label="Load more results" className="flex items-center gap-2 px-6 h-10 rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] text-[color:var(--text)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium">
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
