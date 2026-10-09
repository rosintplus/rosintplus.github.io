/**
 * Profile data barrel.
 *
 * Re-exports the stats primitives and the persistence layer so consumers can
 * import from one place. The heavy lifting lives in:
 *   - ./profile/stats.js — emptyStats / processItem / mergeStats
 *   - ./profile/cache.js — IndexedDB + localStorage persistence for saved profiles
 *
 * Note: the background deep crawl is NOT here. It lives in App.jsx, which owns
 * the AbortController, progress batching and crawl budget for the active view.
 * Stats for that crawl are computed with processItem/mergeStats from here.
 */

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
