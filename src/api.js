/**
 * Backwards-compatible re-export shim for the API layer.
 * New code should import from `./api/client.js` (cache/fetch primitives)
 * or `./api/endpoints.js` (Reddit archive endpoints) directly.
 */
export {
  ARCTIC,
  PULLPUSH,
  REDDIT_BASE,
  LIMIT,
  FETCH_CACHE,
  MAX_CACHE,
  FETCH_TIMEOUT_MS,
  CACHE_TTL_MS,
  MAX_RETRIES,
  PULLPUSH_BREAKER_MS,
  sleep,
  fetchWithRetry,
  safeFetch,
  shareWithAbort,
  isPullPushBlocked,
  getPullPushBlockedUntil,
  resetPullPushBreaker,
} from "./api/client.js";
export {
  PERSIST_TTL_MS,
  PERSIST_MAX_ENTRIES,
  isFirstPage,
  persistentKey,
  readPersistentFirstPage,
  writePersistentFirstPage,
  clearPersistentSearchCache,
} from "./api/persistentCache.js";
export {
  buildUrls,
  fetchBoth,
  FETCH_BOTH_INFLIGHT,
  fetchPostById,
  fetchCommentsForPost,
  fetchUserInteractions,
  fetchSubredditInteractions,
  fetchFlairAggregation,
  fetchShortLinks,
  fetchSubredditMeta,
  fetchSubredditWikis,
  fetchTimeSeries,
} from "./api/endpoints.js";
