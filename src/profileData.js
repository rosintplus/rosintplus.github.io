/** Profile data facade: crawl engine over modular cache + stats stores. */
import { safeFetch, ARCTIC } from "./api/client.js";
import { emptyStats, processItem, mergeStats } from "./profile/stats.js";
import {
  memoryCache,
  cacheSet,
  cloneProfile,
  getCachedProfile,
  saveCachedProfile,
} from "./profile/cache.js";

export { STOPWORDS, emptyStats, processItem, mergeStats } from "./profile/stats.js";
export {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  LS_SAVED_KEY,
  memoryCache,
  MAX_CACHE_SIZE,
  cacheSet,
  getSavedFromLS,
  setSavedInLS,
  migrateIfNeeded,
  openDB,
  cloneProfile,
  getCachedProfile,
  saveCachedProfile,
  deleteCachedProfile,
  toggleProfileSaved,
  getSavedUsernames,
} from "./profile/cache.js";

let currentCrawl = null;

// Crawl bounds: full-history crawls can page unboundedly on prolific accounts
// (100/page with 500ms gaps = minutes of fan-out + retries). Cap pages/items
// per type and bound the whole crawl with an absolute timeout so background
// work stays cancellable and never becomes a retry storm.
export const MAX_CRAWL_PAGES = 10;
export const MAX_CRAWL_ITEMS = 1000;
export const CRAWL_TIMEOUT_MS = 30000;
export const CRAWL_PAGE_DELAY_MS = 500;

function sleepAbortable(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return new Promise(r => setTimeout(r, ms));
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
}

export async function getProfileData(username, onProgress, forceUpdate = false) {
  if (!username) return null;
  const normalized = username.toLowerCase();

  if (currentCrawl) {
    if (currentCrawl.username === normalized && !forceUpdate) {
      if (onProgress) currentCrawl.listeners.push(onProgress);
      return currentCrawl.promise;
    } else {
      try { currentCrawl.controller.abort(); } catch { /* noop */ }
    }
  }

  const controller = new AbortController();
  // Absolute timeout (not sliding): the crawl must end even when pages keep
  // arriving fast. Per-request timeouts are handled inside safeFetch (~10s).
  const timeoutId = setTimeout(() => { try { controller.abort(); } catch { /* noop */ } }, CRAWL_TIMEOUT_MS);
  const listeners = onProgress ? [onProgress] : [];
  let cachedProfile = null;

  const promise = (async () => {
    try {
      const signal = controller.signal;
      let cached = null;
      let maxCreatedUtc = 0;

      if (!forceUpdate) {
        cached = await getCachedProfile(normalized);
        cachedProfile = cached;
        if (cached && !cached.partial) {
          const age = Date.now() - cached.fetchedAt;
          if (age < 7 * 24 * 60 * 60 * 1000) {
            cacheSet(normalized, cloneProfile(cached));
            return cloneProfile(cached);
          }
          // Stale cache: full refresh below with maxCreatedUtc=0, so drop the
          // old snapshot for merge purposes (else old+new double-count).
          // Keep cachedProfile for error fallback.
          cached = null;
        }
      } else {
        cached = await getCachedProfile(normalized);
        cachedProfile = cached;
        if (cached && !cached.partial) {
          maxCreatedUtc = cached.maxCreatedUtc || 0;
        } else {
          cached = null;
        }
      }

      // Fetch user meta for totals
      const metaUrl = `${ARCTIC}/api/users/search?author=${encodeURIComponent(normalized)}&limit=1`;
      const metaRes = await safeFetch(metaUrl, { signal });
      if (signal?.aborted || metaRes.aborted) throw new DOMException("Aborted", "AbortError");

      const meta = metaRes.data?.[0]?._meta || { num_posts: 0, num_comments: 0 };
      const totals = { posts: meta.num_posts || 0, comments: meta.num_comments || 0 };

      const profile = {
        username: normalized,
        stats: emptyStats(),
        totals,
        itemsCrawled: { posts: 0, comments: 0 },
        maxCreatedUtc: 0,
        fetchedAt: Date.now(),
      };

      let loadedTotal = cached ? (cached.itemsCrawled.posts + cached.itemsCrawled.comments) : 0;
      const overallTotal = totals.posts + totals.comments;

      for (const listener of listeners) {
        listener({ loaded: loadedTotal, total: Math.max(loadedTotal, overallTotal) });
      }

      async function fetchAndProcess(type) {
        const isComment = type === "comments";
        const localStats = emptyStats();
        const seenIds = new Set();
        let itemCount = 0;
        let before = null;
        let hitMaxUtc = false;
        let latestUtc = 0;
        let pages = 0;

        while (!hitMaxUtc) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          // Capped: stop paging after MAX_CRAWL_PAGES / MAX_CRAWL_ITEMS so a
          // prolific history can't stall search with unbounded fan-out.
          // Partial flag tells callers the tail is unknown (same as on error).
          if (pages >= MAX_CRAWL_PAGES || itemCount >= MAX_CRAWL_ITEMS) {
            profile.partial = true;
            break;
          }

          const endpoint = type === "posts" ? "posts" : "comments";
          let url = `${ARCTIC}/api/${endpoint}/search?author=${encodeURIComponent(normalized)}&limit=100`;
          // Timestamp-only cursor: Arctic rejects before_id with HTTP 400.
          if (before != null) url += `&before=${before}`;

          const res = await safeFetch(url, { signal });
          if (signal?.aborted || res.aborted) throw new DOMException("Aborted", "AbortError");
          pages += 1;

          if (!res.ok) {
            profile.partial = true;
            break;
          }

          for (const item of res.data) {
            if (!item || !item.id) continue;
            if (item.created_utc <= maxCreatedUtc) {
              hitMaxUtc = true;
              break;
            }
            if (seenIds.has(item.id)) continue;
            seenIds.add(item.id);
            processItem(localStats, item, isComment);
            itemCount++;
            loadedTotal++;
            if (item.created_utc > latestUtc) latestUtc = item.created_utc;
          }

          for (const listener of listeners) {
            listener({ loaded: loadedTotal, total: Math.max(loadedTotal, overallTotal) });
          }

          if (res.data.length < 100) break;
          const last = res.data[res.data.length - 1];
          // Stall guard: if the cursor didn't advance (repeated page), step the
          // timestamp back 1s to force progress instead of looping forever.
          before = (last.created_utc === before) ? before - 1 : last.created_utc;
          await sleepAbortable(CRAWL_PAGE_DELAY_MS, signal);
        }

        return { stats: localStats, itemCount, latestUtc };
      }

      const [postsResult, commentsResult] = await Promise.all([fetchAndProcess("posts"), fetchAndProcess("comments")]);

      // Build final stats
      mergeStats(profile.stats, postsResult.stats);
      mergeStats(profile.stats, commentsResult.stats);

      profile.itemsCrawled.posts = postsResult.itemCount;
      profile.itemsCrawled.comments = commentsResult.itemCount;
      profile.maxCreatedUtc = Math.max(postsResult.latestUtc, commentsResult.latestUtc);

      // Merge with cached data if incremental update
      if (cached) {
        mergeStats(profile.stats, cached.stats);
        profile.itemsCrawled.posts += cached.itemsCrawled.posts;
        profile.itemsCrawled.comments += cached.itemsCrawled.comments;
        profile.maxCreatedUtc = Math.max(profile.maxCreatedUtc, cached.maxCreatedUtc || 0);
        profile.totals.posts = Math.max(totals.posts, profile.itemsCrawled.posts);
        profile.totals.comments = Math.max(totals.comments, profile.itemsCrawled.comments);
      }

      profile.saved = cached ? cached.saved : false;

      if (!profile.partial) {
        if (profile.saved) {
          await saveCachedProfile(profile);
          memoryCache.delete(normalized);
        } else {
          cacheSet(normalized, profile);
        }
      }
      return profile;

    } catch (err) {
      if (err?.name === "AbortError") throw err;
      if (cachedProfile) return { ...cachedProfile, partial: true };
      return { partial: true, stats: emptyStats(), totals: { posts: 0, comments: 0 }, itemsCrawled: { posts: 0, comments: 0 } };
    } finally {
      clearTimeout(timeoutId);
      if (currentCrawl?.controller === controller) {
        currentCrawl = null;
      }
    }
  })();

  currentCrawl = { username: normalized, promise, controller, listeners };
  return promise;
}
