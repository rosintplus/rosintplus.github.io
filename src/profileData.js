import { safeFetch, ARCTIC } from "./api";

const DB_NAME = "rosint-db";
const DB_VERSION = 2;
const STORE_NAME = "profiles";
const LS_SAVED_KEY = "rosint_saved_users";

const memoryCache = new Map();
const MAX_CACHE_SIZE = 100;

function cacheSet(key, value) {
  if (memoryCache.size >= MAX_CACHE_SIZE) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(key, value);
}

// ─── LocalStorage Fallback Helper ────────────────────────────────────────────

function getSavedFromLS() {
  try {
    const raw = localStorage.getItem(LS_SAVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setSavedInLS(username, saved) {
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

// ─── Stopwords ───────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','a','an','and','or','but','to','of','in','on','at','for','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','shall','can','not',
  'no','nor','so','yet','both','either','neither','that','this','these',
  'those','i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','what','which','who','just','get',
  'got','like','also','even','than','then','when','there','all','more','one',
  'out','up','if','by','as','from','about','into','through','after','over',
  'its','re','im','ive','dont','doesnt','didnt','isnt','cant','wont','wasnt',
  'how','any','some','much','very','really','know','think','want','see','go',
  // URL / image junk
  'png','https','amp','redd','preview','width','format','auto','webp',
  'http','www','com','org','jpg','jpeg','gif','svg','html','css',
]);

// ─── Stats helpers ───────────────────────────────────────────────────────────

function emptyStats() {
  return {
    subredditCounts: {},
    heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
    wordFreqs: { posts: {}, comments: {} },
    sampleItems: [],
  };
}

function processItem(stats, item, isComment) {
  const sub = item.subreddit || item.subreddit_name_prefixed?.replace(/^r\//, "") || "unknown";
  stats.subredditCounts[sub] = (stats.subredditCounts[sub] || 0) + 1;

  if (item.created_utc) {
    const d = new Date(item.created_utc * 1000);
    stats.heatmap[d.getUTCDay()][d.getUTCHours()]++;
  }

  const text = isComment ? (item.body || "") : (item.selftext || item.title || "");
  if (text && text !== "[deleted]" && text !== "[removed]") {
    if (!stats.sampleItems) stats.sampleItems = [];
    if (stats.sampleItems.length < 1000) {
      stats.sampleItems.push({
        subreddit: sub,
        body: isComment ? item.body : (item.selftext || item.title || ""),
        title: item.title || "",
        score: item.score || 0
      });
    }

    const words = text.toLowerCase().replace(/[''']/g, "").split(/[^a-z]+/);
    const bucket = isComment ? stats.wordFreqs.comments : stats.wordFreqs.posts;
    const seen = new Set();
    for (const w of words) {
      if (w.length < 3 || STOPWORDS.has(w)) continue;
      if (!bucket[w]) bucket[w] = { total: 0, items: 0 };
      bucket[w].total++;
      if (!seen.has(w)) {
        seen.add(w);
        bucket[w].items++;
      }
    }
  }
}

function mergeStats(target, source) {
  for (const [sub, count] of Object.entries(source.subredditCounts)) {
    target.subredditCounts[sub] = (target.subredditCounts[sub] || 0) + count;
  }
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 24; c++) {
      target.heatmap[r][c] += source.heatmap[r][c];
    }
  }
  for (const type of ["posts", "comments"]) {
    for (const [word, counts] of Object.entries(source.wordFreqs[type])) {
      if (!target.wordFreqs[type][word]) target.wordFreqs[type][word] = { total: 0, items: 0 };
      target.wordFreqs[type][word].total += counts.total;
      target.wordFreqs[type][word].items += counts.items;
    }
  }
  if (source.sampleItems && Array.isArray(source.sampleItems)) {
    if (!target.sampleItems) target.sampleItems = [];
    if (target.sampleItems.length < 1000) {
      target.sampleItems = target.sampleItems.concat(source.sampleItems).slice(0, 1000);
    }
  }
}

export { emptyStats, processItem, mergeStats, STOPWORDS };

// ─── IndexedDB ───────────────────────────────────────────────────────────────

let dbPromise = null;

function migrateIfNeeded(profile) {
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

function openDB() {
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

export async function getCachedProfile(username) {
  if (!username) return null;
  const normalized = username.toLowerCase();
  if (memoryCache.has(normalized)) {
    return migrateIfNeeded(memoryCache.get(normalized));
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
        resolve(result ? migrateIfNeeded(result) : null);
      };
    });
  } catch (e) {
    console.warn("IndexedDB read error:", e);
    return null;
  }
}

async function saveCachedProfile(profile) {
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

// ─── Crawl engine ────────────────────────────────────────────────────────────

let currentCrawl = null;

export async function getProfileData(username, onProgress, forceUpdate = false) {
  if (!username) return null;
  const normalized = username.toLowerCase();

  if (currentCrawl) {
    if (currentCrawl.username === normalized && !forceUpdate) {
      if (onProgress) currentCrawl.listeners.push(onProgress);
      return currentCrawl.promise;
    } else {
      currentCrawl.controller.abort();
    }
  }

  const controller = new AbortController();
  const TIMEOUT_MS = 30000;
  let timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const armTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  };
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
            cacheSet(normalized, cached);
            return cached;
          }
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
      armTimeout();

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
        let itemCount = 0;
        let before = null;
        let beforeId = null;
        let hitMaxUtc = false;
        let latestUtc = 0;

        while (!hitMaxUtc) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

          const endpoint = type === "posts" ? "posts" : "comments";
          let url = `${ARCTIC}/api/${endpoint}/search?author=${encodeURIComponent(normalized)}&limit=100`;
          if (before != null) url += `&before=${before}`;
          if (beforeId) url += `&before_id=${encodeURIComponent(beforeId)}`;

          const res = await safeFetch(url, { signal });
          if (signal?.aborted || res.aborted) throw new DOMException("Aborted", "AbortError");
          armTimeout();

          if (!res.ok) {
            profile.partial = true;
            break;
          }

          for (const item of res.data) {
            if (item.created_utc <= maxCreatedUtc) {
              hitMaxUtc = true;
              break;
            }
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
          before = last.created_utc;
          beforeId = last.id;
          await new Promise(r => setTimeout(r, 500));
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
