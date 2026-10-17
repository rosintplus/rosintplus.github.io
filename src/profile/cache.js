/** Profile persistence: memory cache, IndexedDB, and saved-users store. */
import { emptyStats } from "./stats.js";

export const DB_NAME = "rosint-db";
export const DB_VERSION = 2;
export const STORE_NAME = "profiles";
export const LS_SAVED_KEY = "rosint_saved_users";

let dbPromise = null;

export const memoryCache = new Map();
export const MAX_CACHE_SIZE = 100;

/** Bounded in-memory profile cache insert. */
export function cacheSet(key, value) {
  if (memoryCache.size >= MAX_CACHE_SIZE) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(key, value);
}

export function getSavedFromLS() {
  try {
    const raw = localStorage.getItem(LS_SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(u => typeof u === "string");
  } catch {
    return [];
  }
}

export function setSavedInLS(username, saved) {
  try {
    const current = new Set(getSavedFromLS().map(u => u.toLowerCase()));
    if (saved) {
      current.add(username.toLowerCase());
    } else {
      current.delete(username.toLowerCase());
    }
    localStorage.setItem(LS_SAVED_KEY, JSON.stringify(Array.from(current)));
  } catch {
    /* storage unavailable */
  }
}

export function migrateIfNeeded(profile) {
  if (!profile || typeof profile !== "object") return null;
  profile.stats = profile.stats || emptyStats();
  profile.stats.subredditCounts = profile.stats.subredditCounts || {};
  // Coerce subreddit counts to finite numbers (legacy/corrupt values → 0).
  for (const k of Object.keys(profile.stats.subredditCounts)) {
    const v = Number(profile.stats.subredditCounts[k]);
    profile.stats.subredditCounts[k] = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  }
  const heat = profile.stats.heatmap;
  const validHeat = Array.isArray(heat) && heat.length === 7 && heat.every(row =>
    Array.isArray(row) && row.length === 24 && row.every(v => typeof v === "number" && Number.isFinite(v))
  );
  if (!validHeat) {
    profile.stats.heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  } else {
    // Clamp negatives/fractional/huge (display can't render them).
    for (const row of profile.stats.heatmap) {
      for (let i = 0; i < row.length; i++) {
        const v = Number(row[i]);
        row[i] = !Number.isFinite(v) || v <= 0 ? 0 : Math.min(1e6, Math.floor(v));
      }
    }
  }
  profile.stats.wordFreqs = profile.stats.wordFreqs || { posts: {}, comments: {} };
  profile.stats.wordFreqs.posts = profile.stats.wordFreqs.posts || {};
  profile.stats.wordFreqs.comments = profile.stats.wordFreqs.comments || {};
  // Normalize legacy per-word numbers {hello: 3} → {hello: {total: 3, items: 1}}.
  for (const t of ["posts", "comments"]) {
    const bucket = profile.stats.wordFreqs[t];
    for (const w of Object.keys(bucket)) {
      const v = bucket[w];
      if (typeof v === "number") {
        bucket[w] = { total: Number.isFinite(v) && v > 0 ? Math.floor(v) : 0, items: v > 0 ? 1 : 0 };
      } else if (v && typeof v === "object") {
        const total = Number(v.total);
        const items = Number(v.items);
        bucket[w] = {
          total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
          items: Number.isFinite(items) && items > 0 ? Math.floor(items) : 0,
        };
      } else {
        delete bucket[w];
      }
    }
  }
  profile.stats.sampleItems = Array.isArray(profile.stats.sampleItems)
    ? profile.stats.sampleItems.filter(s => s && typeof s === "object" && (s.id || s.body || s.selftext || s.title))
    : [];
  const totals = profile.totals || {};
  profile.totals = {
    posts: Number.isFinite(Number(totals.posts)) && totals.posts > 0 ? Math.floor(totals.posts) : 0,
    comments: Number.isFinite(Number(totals.comments)) && totals.comments > 0 ? Math.floor(totals.comments) : 0,
  };
  const crawled = profile.itemsCrawled || {};
  profile.itemsCrawled = {
    posts: Number.isFinite(Number(crawled.posts)) && crawled.posts > 0 ? Math.floor(crawled.posts) : 0,
    comments: Number.isFinite(Number(crawled.comments)) && crawled.comments > 0 ? Math.floor(crawled.comments) : 0,
  };
  profile.maxCreatedUtc = profile.maxCreatedUtc || 0;
  profile.fetchedAt = profile.fetchedAt || 0;
  profile.saved = !!profile.saved;
  return profile;
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "username" });
      }
    };
  });
  return dbPromise;
}

export function cloneProfile(p) {
  if (!p) return p;
  try {
    if (typeof structuredClone === "function") return migrateIfNeeded(structuredClone(p));
  } catch { /* fall through */ }
  try {
    return migrateIfNeeded(JSON.parse(JSON.stringify(p)));
  } catch {
    return migrateIfNeeded(p);
  }
}

export async function getCachedProfile(username) {
  if (!username) return null;
  const normalized = String(username).toLowerCase();
  if (memoryCache.has(normalized)) {
    return cloneProfile(memoryCache.get(normalized));
  }
  const getOne = (db, key) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
  try {
    const db = await openDB();
    let result = await getOne(db, normalized);
    if (!result && username !== normalized) {
      try {
        result = await getOne(db, username);
      } catch {
        result = null;
      }
    }
    if (!result) {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const all = await new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result || []);
        });
        result = all.find(r => r && typeof r.username === "string" && r.username.toLowerCase() === normalized) || null;
      } catch {
        result = null;
      }
    }
    return result ? cloneProfile(result) : null;
  } catch (e) {
    console.warn("IndexedDB read error:", e);
    return null;
  }
}

export async function saveCachedProfile(profile) {
  try {
    if (profile && typeof profile.username === "string") {
      profile.username = profile.username.toLowerCase();
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(profile);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (e) {
    console.warn("IndexedDB write error:", e);
  }
}

export async function deleteCachedProfile(username) {
  if (!username) return;
  const normalized = String(username).toLowerCase();
  try {
    const db = await openDB();
    const deleteOne = (key) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
    await deleteOne(normalized);
    if (username !== normalized) {
      try {
        await deleteOne(username);
      } catch {
        /* legacy exact-case miss is fine */
      }
    }
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const all = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result || []);
      });
      const strays = all
        .filter(r => r && typeof r.username === "string" && r.username.toLowerCase() === normalized && r.username !== normalized)
        .map(r => r.username);
      for (const key of strays) {
        try {
          await deleteOne(key);
        } catch {
          /* best-effort legacy cleanup */
        }
      }
    } catch {
      /* scan unavailable */
    }
  } catch (e) {
    console.warn("IndexedDB delete error:", e);
  }
}

export async function toggleProfileSaved(username, saved, currentStats = null, currentTotals = null) {
  if (!username) return;
  const normalized = username.toLowerCase();
  setSavedInLS(normalized, saved);

  let profile = memoryCache.get(normalized);
  if (!profile) {
    profile = await getCachedProfile(normalized);
  }
  if (!profile) {
    profile = {
      username: normalized,
      stats: currentStats || emptyStats(),
      totals: currentTotals || { posts: 0, comments: 0 },
      itemsCrawled: { posts: currentTotals?.posts || 0, comments: currentTotals?.comments || 0 },
      maxCreatedUtc: 0,
      fetchedAt: Date.now(),
    };
  } else {
    if (currentStats) profile.stats = currentStats;
    if (currentTotals) {
      profile.totals = currentTotals;
      profile.itemsCrawled = { posts: currentTotals.posts || 0, comments: currentTotals.comments || 0 };
    }
  }

  profile.username = normalized;
  profile.saved = saved;
  profile.fetchedAt = Date.now();

  try {
    await saveCachedProfile(profile);
  } catch (e) {
    console.warn("Could not save to IndexedDB, fallback LS active:", e);
  }

  cacheSet(normalized, profile);
  window.dispatchEvent(new CustomEvent('savedUsersChanged'));
}

export async function getSavedUsernames() {
  const rawList = getSavedFromLS();
  const lsList = Array.isArray(rawList) ? rawList.filter(u => typeof u === "string") : [];
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => resolve(lsList);
      request.onsuccess = () => {
        const results = request.result || [];
        const idbSaved = results.filter(r => r && r.saved).map(r => String(r.username || "").toLowerCase()).filter(Boolean);
        const lsLower = lsList.map(u => String(u || "").toLowerCase()).filter(Boolean);
        const union = Array.from(new Set([...idbSaved, ...lsLower]));
        resolve(union);
      };
    });
  } catch {
    return Array.isArray(lsList) ? lsList : [];
  }
}
