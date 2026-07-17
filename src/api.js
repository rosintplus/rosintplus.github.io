// ─── API Config ───────────────────────────────────────────────────────────────
export const ARCTIC = "https://arctic-shift.photon-reddit.com";

const PULLPUSH = "https://api.pullpush.io";

export const REDDIT_BASE = "https://www.reddit.com";

export const LIMIT = 100;
// Strip anything users paste around a username: @, leading slashes, full
// reddit URLs, and u/ /u/ user/ prefixes. Returns the bare username.

// sort: "desc" (Newest) or "asc" (Oldest). Arctic Shift orders the page
// server-side, so "Oldest" must be sent as sort=asc and paged *forward*
// (after-cursor) — reversing a desc page only flips the current 100 rows.
function buildUrls(username, type, pagination = {}, dateFilters = {}, { sort = "desc" } = {}) {
  const base = [`limit=${LIMIT}`, `sort=${sort}`, `author=${encodeURIComponent(username)}`];
  if (dateFilters.subreddit) {
    base.push(`subreddit=${encodeURIComponent(dateFilters.subreddit)}`);
  }

  // NSFW is a post-only field; Arctic Shift honors over_18 server-side.
  if (type === "posts" && dateFilters.over18 != null) {
    base.push(`over_18=${dateFilters.over18}`);
  }
  if (pagination.before != null) {
    base.push(`before=${pagination.before}`);
  } else if (dateFilters.dateTo) {
    base.push(`before=${dateFilters.dateTo}`);
  }
  if (pagination.after != null) {
    base.push(`after=${pagination.after}`);
  } else if (dateFilters.dateFrom) {
    base.push(`after=${dateFilters.dateFrom}`);
  }
  // Stable secondary cursor so a created_utc tie at a page boundary doesn't
  // skip or repeat rows. Arctic Shift honors before_id/after_id; PullPush
  // ignores unknown params, so it's a safe progressive enhancement.
  if (pagination.beforeId) base.push(`before_id=${encodeURIComponent(pagination.beforeId)}`);
  if (pagination.afterId) base.push(`after_id=${encodeURIComponent(pagination.afterId)}`);
  const qs = base.join("&");
  return {
    arctic: type === "posts" ? `${ARCTIC}/api/posts/search?${qs}` : `${ARCTIC}/api/comments/search?${qs}`,
    pullpush: type === "posts" ? `${PULLPUSH}/reddit/search/submission/?test&${qs}` : `${PULLPUSH}/reddit/search/comment/?test&${qs}`
  };
}

// ─── Helpers ───────

// FETCH_CACHE stores the in-flight promise (not just the resolved value), so
// two identical concurrent calls — e.g. ParentChain recursion racing a tab
// fetch — share one network request and one await. The 5-minute TTL only
// applies to successful results; empty/error results are evicted below.
const FETCH_CACHE = new Map();
const MAX_CACHE = 200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One immediate retry with short backoff. Transient rate-limits (429/5xx) and
// flaky network hiccups are the common cause of the "archive unavailable"
// screen; a single retry clears most of them without hammering the server.
async function fetchWithRetry(url, {
  signal,
  retries = 1
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json"
        },
        signal
      });
      if (!res.ok) {
        // Retry server/rate-limit errors once; client 4xx (besides 429) won't
        // improve on a retry, so don't bother.
        if (attempt < retries && (res.status === 429 || res.status >= 500)) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        return {
          data: [],
          ok: false
        };
      }
      const json = await res.json();
      return {
        data: json?.data ?? [],
        ok: true
      };
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastErr = err;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }
  return {
    data: [],
    ok: false,
    err: lastErr
  };
}

export function safeFetch(url, {
  bypassCache = false,
  signal,
  retries = 1
} = {}) {
  if (!bypassCache) {
    const cached = FETCH_CACHE.get(url);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      // The cached promise may belong to a caller that aborted it (e.g.
      // StrictMode's double-mount aborts the first mount's request). That
      // abort isn't ours — if our signal is still live, refetch instead of
      // inheriting the aborted result and painting a false outage screen.
      return cached.promise.then(res => {
        if (signal?.aborted) return { data: [], ok: false, aborted: true };
        return res.aborted && !signal?.aborted
          ? safeFetch(url, { bypassCache: true, signal, retries })
          : res;
      });
    }
  }
  const promise = fetchWithRetry(url, {
    signal,
    retries
  }).then(res => {
    if (!res || !res.ok || res.data.length === 0) {
      FETCH_CACHE.delete(url);
    }
    return {
      data: res?.data ?? [],
      ok: !!res?.ok
    };
  }).catch(err => {
    FETCH_CACHE.delete(url);
    if (err?.name === "AbortError") return {
      data: [],
      ok: false,
      aborted: true
    };
    return {
      data: [],
      ok: false
    };
  });
  FETCH_CACHE.set(url, {
    ts: Date.now(),
    promise
  });
  if (FETCH_CACHE.size > MAX_CACHE) {
    const oldest = FETCH_CACHE.keys().next().value;
    if (oldest) FETCH_CACHE.delete(oldest);
  }
  return promise;
}


export async function fetchBoth(username, type, pagination = {}, dateFilters = {}, {
  bypassCache = false,
  signal,
  sort = "desc",
} = {}) {
  const {
    arctic,
    pullpush
  } = buildUrls(username, type, pagination, dateFilters, { sort });
  const [arcticRes, pullpushRes] = await Promise.all([safeFetch(arctic, {
    bypassCache,
    signal
  }), safeFetch(pullpush, {
    bypassCache,
    signal
  })]);
  const seen = new Set();
  const merged = [];
  const sources = [];
  if (arcticRes.ok && arcticRes.data.length > 0) sources.push("Arctic Shift");
  if (pullpushRes.ok && pullpushRes.data.length > 0) sources.push("PullPush");
  [...arcticRes.data, ...pullpushRes.data].forEach(item => {
    if (!item || !item.id) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  });

  // PullPush ignores the over_18 param, so filter NSFW client-side (posts only;
  // comments have no over_18 field). Arctic results already match — harmless here.
  let result = merged;
  if (type === "posts" && dateFilters.over18 === false) {
    // Guard over_18 shape: Arctic uses a boolean, PullPush sometimes null/missing.
    result = result.filter(p => p.over_18 !== true);
  }
  // Respect the server/requested sort rather than forcing desc — Oldest must
  // actually page into older history, not just flip the current page.
  result.sort((a, b) => sort === "asc" ? a.created_utc - b.created_utc : b.created_utc - a.created_utc);
  return {
    items: result,
    sources,
    arcticDown: !arcticRes.ok,
    pullpushDown: !pullpushRes.ok,
    done: arcticRes.data.length < LIMIT && pullpushRes.data.length < LIMIT
  };
}
