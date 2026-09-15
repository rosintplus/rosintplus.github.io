/** Persistent (localStorage) cache for fetchBoth first-page results.
 *
 * FETCH_CACHE in client.js is in-memory only, so a full page refresh loses it
 * and every ?u=<name> load pays Arctic (~1.8s) + PullPush (~3.9s) again. This
 * module adds an L2 localStorage cache keyed by username/type/sort/mode (plus
 * the deterministic first-page filters/pagination) with a ~5min TTL, so a
 * refresh paints instantly from cache while the normal network fetch
 * revalidates in the background (see usePaginatedFetch reset()).
 *
 * Only first-page results are cached: deep-crawl pages (cursor `before` beyond
 * the filter's dateTo, or beforeId/afterId cursors) are unbounded and must not
 * fill localStorage. Only successful non-empty results are stored, mirroring
 * the safeFetch memory-cache policy.
 */

export const PERSIST_TTL_MS = 5 * 60 * 1000;
export const PERSIST_MAX_ENTRIES = 40;

const LS_PREFIX = "rosint:fetchBoth:v1:";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** True when pagination is the first page (no deep-crawl cursor). */
export function isFirstPage(pagination = {}, dateFilters = {}) {
  const p = pagination || {};
  const f = dateFilters || {};
  if (p.beforeId != null || p.afterId != null) return false;
  const beforeOk = p.before == null || (f.dateTo != null && p.before === f.dateTo);
  const afterOk = p.after == null || (f.dateFrom != null && p.after === f.dateFrom);
  return beforeOk && afterOk;
}

export function persistentKey(username, type, pagination = {}, dateFilters = {}, sort = "desc", mode = "username") {
  return LS_PREFIX + stableStringify({
    u: String(username || "").toLowerCase(),
    t: type,
    s: sort || "desc",
    m: mode || "username",
    f: dateFilters || {},
    p: pagination || {},
  });
}

function ls() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch { /* storage unavailable */ }
  return null;
}

function ourKeys(store) {
  const out = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(LS_PREFIX)) out.push(k);
    }
  } catch { /* ignore */ }
  return out;
}

function keyTs(store, key) {
  try {
    const raw = store.getItem(key);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return typeof parsed?.ts === "number" ? parsed.ts : 0;
  } catch {
    return 0;
  }
}

/** Evict oldest entries until at most `keep` of our keys remain. */
function evictToKeep(store, keep) {
  const keys = ourKeys(store);
  if (keys.length <= keep) return;
  keys.sort((a, b) => keyTs(store, a) - keyTs(store, b));
  const excess = keys.length - keep;
  for (let i = 0; i < excess; i++) {
    try { store.removeItem(keys[i]); } catch { /* ignore */ }
  }
}

/** Read a fresh first-page result, or null on miss/stale/corrupt. Sync. */
export function readPersistentFirstPage(username, type, pagination = {}, dateFilters = {}, sort = "desc", mode = "username") {
  try {
    const store = ls();
    if (!store || !username || !type) return null;
    if (!isFirstPage(pagination, dateFilters)) return null;
    const key = persistentKey(username, type, pagination, dateFilters, sort, mode);
    const raw = store.getItem(key);
    if (!raw) return null;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try { store.removeItem(key); } catch { /* ignore */ }
      return null;
    }
    if (!parsed || typeof parsed.ts !== "number" || !parsed.result) return null;
    if (Date.now() - parsed.ts > PERSIST_TTL_MS) {
      try { store.removeItem(key); } catch { /* ignore */ }
      return null;
    }
    if (!Array.isArray(parsed.result.items)) return null;
    return parsed.result;
  } catch {
    return null;
  }
}

/** Write a first-page result. No-op for deep pages, empty results, or no storage. */
export function writePersistentFirstPage(username, type, pagination = {}, dateFilters = {}, sort = "desc", mode = "username", result) {
  try {
    const store = ls();
    if (!store || !username || !type) return;
    if (!isFirstPage(pagination, dateFilters)) return;
    if (!result || !Array.isArray(result.items) || result.items.length === 0) return;
    const key = persistentKey(username, type, pagination, dateFilters, sort, mode);
    const entry = JSON.stringify({
      ts: Date.now(),
      result: {
        items: result.items,
        sources: result.sources || [],
        arcticDown: !!result.arcticDown,
        pullpushDown: !!result.pullpushDown,
        done: !!result.done,
      },
    });
    try {
      store.setItem(key, entry);
    } catch {
      // Quota exceeded — drop oldest entries (keep room for this write) and retry once.
      try {
        evictToKeep(store, PERSIST_MAX_ENTRIES - 1);
        store.setItem(key, entry);
      } catch { /* storage full/unavailable — caching is best-effort */ }
      return;
    }
    try {
      evictToKeep(store, PERSIST_MAX_ENTRIES);
    } catch { /* ignore */ }
  } catch { /* caching is best-effort */ }
}

/** Test/debug helper: drop all fetchBoth persistent entries. */
export function clearPersistentSearchCache() {
  try {
    const store = ls();
    if (!store) return;
    for (const k of ourKeys(store)) {
      try { store.removeItem(k); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
