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
function buildUrls(username, type, pagination = {}, dateFilters = {}, { sort = "desc", mode = "username" } = {}) {
  const target = mode === "subreddit" ? `subreddit=${encodeURIComponent(username)}` : `author=${encodeURIComponent(username)}`;
  const base = [`limit=${LIMIT}`, `sort=${sort}`, target];
  if (dateFilters.subreddit && mode !== "subreddit") {
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
  mode = "username"
} = {}) {
  const {
    arctic,
    pullpush
  } = buildUrls(username, type, pagination, dateFilters, { sort, mode });
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

export async function fetchPostById(postId, { signal } = {}) {
  const id = String(postId || "").replace(/^t3_/i, "").trim();
  if (!id) return { post: null, sources: [], arcticDown: false, pullpushDown: false };
  const arcticUrl = `${ARCTIC}/api/posts/ids?ids=${encodeURIComponent(id)}`;
  const pullpushUrl = `${PULLPUSH}/reddit/search/submission/?test&ids=${encodeURIComponent(id)}`;
  // Arctic's /ids prefers bare id; PullPush search-by-ids is not standard, so we fall
  // back to a submission search filtered by id client-side.
  const [arcticRes, ppRes] = await Promise.all([
    safeFetch(arcticUrl, { signal }),
    safeFetch(`${PULLPUSH}/reddit/search/submission/?test&ids=${encodeURIComponent(id)}&limit=5`, { signal }).then(r => {
      // PullPush /ids is unreliable; try id search and filter
      if (r.ok && r.data.length) {
        const hit = r.data.find(x => x.id === id);
        return hit ? { ok: true, data: [hit] } : r;
      }
      return r;
    }).catch(() => ({ ok: false, data: [] }))
  ]);
  let post = arcticRes.data?.[0] || null;
  const sources = [];
  if (arcticRes.ok && post) sources.push("Arctic Shift");
  if (!post && ppRes.ok && ppRes.data?.[0]) {
    // PullPush shape is already a submission; normalize id
    post = ppRes.data.find(x => x.id === id) || ppRes.data[0];
    if (post) sources.push("PullPush");
  }
  // Fallback: try PullPush id-specific endpoint via submission search by id via arctic's other route
  if (!post) {
    const alt = await safeFetch(`${PULLPUSH}/reddit/search/submission/?test&q=id:${encodeURIComponent(id)}&limit=5`, { signal }).catch(() => ({ ok: false, data: [] }));
    if (alt.ok && alt.data?.length) {
      const hit = alt.data.find(x => x.id === id) || alt.data[0];
      if (hit) { post = hit; if (!sources.includes("PullPush")) sources.push("PullPush"); }
    }
  }
  return { post, sources, arcticDown: !arcticRes.ok, pullpushDown: !ppRes.ok };
}

export async function fetchCommentsForPost(postId, { signal, limit = 100 } = {}) {
  const id = String(postId || "").replace(/^t3_/i, "").trim();
  if (!id) return { comments: [], sources: [], arcticDown: false, pullpushDown: false };
  const arcticUrl = `${ARCTIC}/api/comments/tree?link_id=t3_${encodeURIComponent(id)}&limit=${limit}`;
  const arcticRes = await safeFetch(arcticUrl, { signal });
  let comments = [];
  const sources = [];
  if (arcticRes.ok && Array.isArray(arcticRes.data)) {
    for (const item of arcticRes.data) {
      if (item?.kind === "t1" && item.data) comments.push(item.data);
    }
    if (comments.length) sources.push("Arctic Shift");
  }
  if (comments.length === 0) {
    const ppRes = await safeFetch(`${PULLPUSH}/reddit/search/comment/?test&link_id=t3_${encodeURIComponent(id)}&limit=${limit}`, { signal }).catch(() => ({ ok: false, data: [] }));
    if (ppRes.ok && ppRes.data.length) {
      comments = ppRes.data;
      sources.push("PullPush");
      return { comments, sources, arcticDown: !arcticRes.ok, pullpushDown: !ppRes.ok };
    }
  }
  return { comments, sources, arcticDown: !arcticRes.ok, pullpushDown: false };
}
