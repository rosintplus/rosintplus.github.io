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
    return raw ? JSON.parse(raw) : [];
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
  if (!Array.isArray(profile.stats.heatmap) || profile.stats.heatmap.length !== 7) {
    profile.stats.heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  }
  profile.stats.wordFreqs = profile.stats.wordFreqs || { posts: {}, comments: {} };
  profile.stats.wordFreqs.posts = profile.stats.wordFreqs.posts || {};
  profile.stats.wordFreqs.comments = profile.stats.wordFreqs.comments || {};
  profile.stats.sampleItems = profile.stats.sampleItems || [];
  profile.totals = profile.totals || { posts: 0, comments: 0 };
  profile.itemsCrawled = profile.itemsCrawled || { posts: 0, comments: 0 };
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
  const normalized = username.toLowerCase();
  if (memoryCache.has(normalized)) {
    return cloneProfile(memoryCache.get(normalized));
  }
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(normalized);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? cloneProfile(result) : null);
      };
    });
  } catch (e) {
    console.warn("IndexedDB read error:", e);
    return null;
  }
}

export async function saveCachedProfile(profile) {
  try {
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
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(username.toLowerCase());
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
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
  const lsList = getSavedFromLS();
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => resolve(lsList);
      request.onsuccess = () => {
        const results = request.result || [];
        const idbSaved = results.filter(r => r && r.saved).map(r => r.username);
        const union = Array.from(new Set([...idbSaved, ...lsList]));
        resolve(union);
      };
    });
  } catch {
    return lsList;
  }
}
