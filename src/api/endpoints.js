/** Reddit archive endpoints built on top of the low-level client. */
import { ARCTIC, PULLPUSH, LIMIT, safeFetch, sleep, isPullPushBlocked } from "./client.js";
import { writePersistentFirstPage } from "./persistentCache.js";

export function buildUrls(username, type, pagination = {}, dateFilters = {}, { sort = "desc", mode = "username" } = {}) {
  const target = mode === "subreddit" ? `subreddit=${encodeURIComponent(username)}` : `author=${encodeURIComponent(username)}`;
  const base = [`limit=${LIMIT}`, `sort=${sort}`, target];
  if (dateFilters.subreddit && mode !== "subreddit") {
    base.push(`subreddit=${encodeURIComponent(dateFilters.subreddit)}`);
  }

  // OSINT content filters — server-side keyword search (much faster than
  // client filtering 100 rows). Only added when the user fills the field.
  if (type === "posts") {
    if (dateFilters.query) base.push(`query=${encodeURIComponent(dateFilters.query)}`);
    else {
      if (dateFilters.title) base.push(`title=${encodeURIComponent(dateFilters.title)}`);
      if (dateFilters.selftext) base.push(`selftext=${encodeURIComponent(dateFilters.selftext)}`);
    }
    if (dateFilters.url) base.push(`url=${encodeURIComponent(dateFilters.url)}`);
    if (dateFilters.link_flair_text) base.push(`link_flair_text=${encodeURIComponent(dateFilters.link_flair_text)}`);
    if (dateFilters.author_flair_text) base.push(`author_flair_text=${encodeURIComponent(dateFilters.author_flair_text)}`);
  }
  if (type === "comments" && dateFilters.body) {
    base.push(`body=${encodeURIComponent(dateFilters.body)}`);
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
  // NOTE: Arctic Shift rejects before_id/after_id with HTTP 400 (verified),
  // so pagination is timestamp-only. Same-second ties at a page boundary are
  // handled client-side by deduping on id (see callers). PullPush honors
  // `before`/`after` epoch timestamps.
  const qs = base.join("&");
  return {
    arctic: type === "posts" ? `${ARCTIC}/api/posts/search?${qs}` : `${ARCTIC}/api/comments/search?${qs}`,
    pullpush: type === "posts" ? `${PULLPUSH}/reddit/search/submission/?test&${qs}` : `${PULLPUSH}/reddit/search/comment/?test&${qs}`
  };
}

// ─── fetchBoth single-flight dedupe ─────────────────────────────────────────
// Concurrent identical fetchBoth calls (StrictMode double-mount, posts+comments
// racing, rapid filter commits) share one underlying Arctic+PullPush fan-out
// instead of doubling network. Abort is per-caller: a caller abort rejects
// only that caller's view with AbortError; the shared fetch continues
// (bounded by safeFetch timeouts) while other sharers remain, and aborts its
// network only when all sharers have aborted.
export const FETCH_BOTH_INFLIGHT = new Map();

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function fetchBothKey(username, type, pagination, dateFilters, sort, mode) {
  return stableStringify({ username, type, pagination, dateFilters, sort, mode });
}

function sleepAbortable(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return sleep(ms);
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

function timeoutMarker(ms, internalSignal) {
  return sleepAbortable(ms, internalSignal).then(() => ({ timeout: true, data: [], ok: false }));
}

function raceFetchBoth(promise, callerSignal) {
  if (!callerSignal) return promise;
  if (callerSignal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    callerSignal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      v => {
        try { callerSignal.removeEventListener("abort", onAbort); } catch { /* noop */ }
        if (callerSignal.aborted) reject(new DOMException("Aborted", "AbortError"));
        else resolve(v);
      },
      e => {
        try { callerSignal.removeEventListener("abort", onAbort); } catch { /* noop */ }
        reject(e);
      },
    );
  });
}

function linkFetchBothCaller(entry, callerSignal) {
  if (!callerSignal || entry.settled || !entry.controller) return;
  if (callerSignal.aborted) {
    entry.waiters -= 1;
    if (entry.waiters <= 0 && !entry.settled) {
      try { entry.controller.abort(); } catch { /* noop */ }
    }
    return;
  }
  const onAbort = () => {
    entry.waiters -= 1;
    if (entry.waiters <= 0 && !entry.settled) {
      try { entry.controller.abort(); } catch { /* noop */ }
    }
  };
  callerSignal.addEventListener("abort", onAbort, { once: true });
  entry.promise.then(
    () => { try { callerSignal.removeEventListener("abort", onAbort); } catch { /* noop */ } },
    () => { try { callerSignal.removeEventListener("abort", onAbort); } catch { /* noop */ } },
  );
}

export function fetchBoth(username, type, pagination = {}, dateFilters = {}, {
  bypassCache = false,
  signal,
  sort = "desc",
  mode = "username"
} = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (bypassCache) {
    return runFetchBoth(username, type, pagination, dateFilters, { bypassCache: true, signal, sort, mode });
  }
  const key = fetchBothKey(username, type, pagination, dateFilters, sort, mode);
  const existing = FETCH_BOTH_INFLIGHT.get(key);
  if (existing && !existing.settled) {
    existing.waiters += 1;
    linkFetchBothCaller(existing, signal);
    return raceFetchBoth(existing.promise, signal);
  }
  const controller = new AbortController();
  const entry = { promise: null, controller, waiters: 1, settled: false };
  // Underlying fan-out uses the shared internal signal so one caller's abort
  // doesn't cancel network other sharers still need. Abort propagates to
  // network only when every sharer has aborted (or timeout bounds it).
  const execution = runFetchBoth(username, type, pagination, dateFilters, {
    bypassCache: false,
    signal: controller.signal,
    sort,
    mode,
  }).then(
    res => {
      entry.settled = true;
      if (FETCH_BOTH_INFLIGHT.get(key) === entry) FETCH_BOTH_INFLIGHT.delete(key);
      return res;
    },
    err => {
      entry.settled = true;
      if (FETCH_BOTH_INFLIGHT.get(key) === entry) FETCH_BOTH_INFLIGHT.delete(key);
      throw err;
    },
  );
  entry.promise = execution;
  FETCH_BOTH_INFLIGHT.set(key, entry);
  linkFetchBothCaller(entry, signal);
  return raceFetchBoth(execution, signal);
}

async function runFetchBoth(username, type, pagination = {}, dateFilters = {}, {
  bypassCache = false,
  signal,
  sort = "desc",
  mode = "username"
} = {}) {
  const {
    arctic,
    pullpush
  } = buildUrls(username, type, pagination, dateFilters, { sort, mode });
  // Arctic-first fast path: start both, but return Arctic quickly if it has data.
  // PullPush is often slower (and sometimes empty); waiting for it blocks
  // time-to-first-result. We race Arctic vs PullPush with a short timeout.
  // Open PullPush breaker: don't even start the request — resolve empty fast
  // and let Arctic serve the page (safeFetch would short-circuit anyway).
  const pullpushBlocked = isPullPushBlocked();
  const arcticPromise = safeFetch(arctic, { bypassCache, signal });
  const pullpushPromise = pullpushBlocked
    ? Promise.resolve({ data: [], ok: false, blocked: true })
    : safeFetch(pullpush, { bypassCache, signal });
  const arcticRes = await arcticPromise;
  let pullpushRes;
  if (arcticRes.ok && arcticRes.data.length >= LIMIT) {
    // Arctic has a full page — PullPush unlikely to add new items, don't block.
    // Race PullPush with a short timeout; if it wins, merge, otherwise return Arctic.
    pullpushRes = await Promise.race([
      pullpushPromise,
      timeoutMarker(280, signal)
    ]);
    if (pullpushRes.timeout) {
      // Let PullPush finish in background for cache warming, but don't block
      pullpushPromise.then(() => {
        // Warm cache already via safeFetch; nothing to do
      }).catch(() => {});
      pullpushRes = { data: [], ok: false };
    }
  } else if (arcticRes.ok && arcticRes.data.length > 0) {
    // Arctic has some data — give PullPush a short window to contribute
    pullpushRes = await Promise.race([
      pullpushPromise,
      timeoutMarker(350, signal)
    ]);
    if (pullpushRes.timeout) {
      pullpushPromise.then(() => {}).catch(() => {});
      pullpushRes = { data: [], ok: false };
    }
  } else {
    // Arctic empty/failed — must wait for PullPush
    pullpushRes = await pullpushPromise;
  }
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
  // Only mark pagination done when both sources actually answered.
  // A timeout/failure (ok:false) means the tail is unknown — keep Load More enabled.
  // (A breaker-skipped PullPush also leaves the tail unknown.)
  const bothOk = arcticRes.ok && pullpushRes.ok;
  const out = {
    items: result,
    sources,
    arcticDown: !arcticRes.ok,
    pullpushDown: !pullpushRes.ok,
    done: bothOk && arcticRes.data.length < LIMIT && pullpushRes.data.length < LIMIT
  };
  // Persist first-page results (refresh paints instantly from localStorage;
  // the hook revalidates in background). Best-effort, never throws.
  // Skip when the caller aborted — partial merges must not poison the cache.
  if (!signal?.aborted) {
    try {
      writePersistentFirstPage(username, type, pagination, dateFilters, sort, mode, out);
    } catch { /* best-effort */ }
  }
  return out;
}

export async function fetchPostById(postId, { signal } = {}) {
  const id = String(postId || "").replace(/^t3_/i, "").trim();
  if (!id) return { post: null, sources: [], arcticDown: false, pullpushDown: false };
  const arcticUrl = `${ARCTIC}/api/posts/ids?ids=${encodeURIComponent(id)}`;
  // Start all fetches in parallel for fastest path
  const arcticPromise = safeFetch(arcticUrl, { signal });
  const ppPromise = safeFetch(`${PULLPUSH}/reddit/search/submission/?test&ids=${encodeURIComponent(id)}&limit=5`, { signal }).then(r => {
    if (r.ok && r.data.length) {
      const hit = r.data.find(x => x.id === id);
      return hit ? { ok: true, data: [hit] } : r;
    }
    return r;
  }).catch(() => ({ ok: false, data: [] }));
  const altPromise = safeFetch(`${PULLPUSH}/reddit/search/submission/?test&q=id:${encodeURIComponent(id)}&limit=5`, { signal }).catch(() => ({ ok: false, data: [] }));
  const arcticRes = await arcticPromise;
  if (arcticRes.ok && arcticRes.data?.[0]) {
    return { post: arcticRes.data[0], sources: ["Arctic Shift"], arcticDown: false, pullpushDown: false };
  }
  // Arctic miss — race the two PullPush paths with a short timeout
  const ppRes = await Promise.race([
    ppPromise,
    timeoutMarker(400, signal)
  ]);
  if (!ppRes.timeout && ppRes.ok && ppRes.data?.[0]) {
    const hit = ppRes.data.find(x => x.id === id) || ppRes.data[0];
    if (hit) return { post: hit, sources: ["PullPush"], arcticDown: !arcticRes.ok, pullpushDown: false };
  }
  const altRes = await Promise.race([
    altPromise,
    timeoutMarker(300, signal)
  ]);
  if (!altRes.timeout && altRes.ok && altRes.data?.length) {
    const hit = altRes.data.find(x => x.id === id) || altRes.data[0];
    if (hit) return { post: hit, sources: ["PullPush"], arcticDown: !arcticRes.ok, pullpushDown: !ppRes.ok };
  }
  // Fallback: bounded wait (2s) so a hung PullPush can't hang the view forever.
  const bounded = (p) => Promise.race([p.catch(() => ({ ok: false, data: [] })), timeoutMarker(2000, signal)]);
  const finalPp = ppRes.timeout ? await bounded(ppPromise) : ppRes;
  if (finalPp.ok && finalPp.data?.[0]) {
    const hit = finalPp.data.find(x => x.id === id) || finalPp.data[0];
    if (hit) return { post: hit, sources: ["PullPush"], arcticDown: !arcticRes.ok, pullpushDown: false };
  }
  const finalAlt = altRes.timeout ? await bounded(altPromise) : altRes;
  if (finalAlt.ok && finalAlt.data?.length) {
    const hit = finalAlt.data.find(x => x.id === id) || finalAlt.data[0];
    if (hit) return { post: hit, sources: ["PullPush"], arcticDown: !arcticRes.ok, pullpushDown: false };
  }
  return { post: null, sources: [], arcticDown: !arcticRes.ok, pullpushDown: !finalPp.ok };
}

export async function fetchCommentsForPost(postId, { signal, limit = 100 } = {}) {
  const id = String(postId || "").replace(/^t3_/i, "").trim();
  if (!id) return { comments: [], sources: [], arcticDown: false, pullpushDown: false };
  const arcticUrl = `${ARCTIC}/api/comments/tree?link_id=t3_${encodeURIComponent(id)}&limit=${limit}`;
  const pullpushUrl = `${PULLPUSH}/reddit/search/comment/?test&link_id=t3_${encodeURIComponent(id)}&limit=${limit}`;
  // Start both in parallel; Arctic tree is usually faster and richer
  const arcticPromise = safeFetch(arcticUrl, { signal });
  const ppPromise = safeFetch(pullpushUrl, { signal }).catch(() => ({ ok: false, data: [] }));
  const arcticRes = await arcticPromise;
  let comments = [];
  const sources = [];
  if (arcticRes.ok && Array.isArray(arcticRes.data)) {
    for (const item of arcticRes.data) {
      if (item?.kind === "t1" && item.data) comments.push(item.data);
    }
    if (comments.length) sources.push("Arctic Shift");
  }
  if (comments.length > 0) {
    // Have Arctic comments — return quickly, don't block on PullPush
    // Let PullPush warm cache in background
    ppPromise.then(() => {}).catch(() => {});
    return { comments, sources, arcticDown: false, pullpushDown: false };
  }
  // No Arctic comments — wait for PullPush with short timeout
  const ppRes = await Promise.race([
    ppPromise,
    timeoutMarker(350, signal)
  ]);
  if (!ppRes.timeout && ppRes.ok && ppRes.data.length) {
    return { comments: ppRes.data, sources: ["PullPush"], arcticDown: !arcticRes.ok, pullpushDown: false };
  }
  const finalPp = ppRes.timeout
    ? await Promise.race([ppPromise, timeoutMarker(2000, signal)])
    : ppRes;
  if (finalPp.ok && finalPp.data.length) {
    return { comments: finalPp.data, sources: ["PullPush"], arcticDown: !arcticRes.ok, pullpushDown: false };
  }
  return { comments: [], sources, arcticDown: !arcticRes.ok, pullpushDown: !finalPp.ok };
}

// ─── OSINT helpers (all lazy — not used on initial search) ────────────────

export async function fetchUserInteractions(author, { subreddit, after, before, min_count = 2, limit = 20, signal } = {}) {
  const qs = [`author=${encodeURIComponent(author)}`, `min_count=${min_count}`, `limit=${limit}`];
  if (subreddit) qs.push(`subreddit=${encodeURIComponent(subreddit)}`);
  if (after) qs.push(`after=${encodeURIComponent(after)}`);
  if (before) qs.push(`before=${encodeURIComponent(before)}`);
  const url = `${ARCTIC}/api/users/interactions/users?${qs.join("&")}`;
  const res = await safeFetch(url, { signal });
  return { data: res.data || [], ok: res.ok };
}

export async function fetchSubredditInteractions(author, { min_count = 2, limit = 15, signal } = {}) {
  const qs = [`author=${encodeURIComponent(author)}`, `min_count=${min_count}`, `limit=${limit}`];
  const url = `${ARCTIC}/api/users/interactions/subreddits?${qs.join("&")}`;
  const res = await safeFetch(url, { signal });
  return { data: res.data || [], ok: res.ok };
}

export async function fetchFlairAggregation(author, { signal } = {}) {
  const url = `${ARCTIC}/api/users/aggregate_flairs?author=${encodeURIComponent(author)}`;
  const res = await safeFetch(url, { signal });
  return { data: res.data || [], ok: res.ok };
}

export async function fetchShortLinks(paths, { signal } = {}) {
  const list = Array.isArray(paths) ? paths.join(",") : String(paths);
  if (!list) return { data: [], ok: false };
  const url = `${ARCTIC}/api/short_links?paths=${encodeURIComponent(list)}`;
  const res = await safeFetch(url, { signal });
  return { data: res.data || [], ok: res.ok };
}

export async function fetchSubredditMeta(subreddit, { signal } = {}) {
  const name = String(subreddit || "").replace(/^r\//i, "").trim();
  if (!name) return { meta: null, rules: [], wikis: [] };
  const [metaRes, rulesRes] = await Promise.all([
    safeFetch(`${ARCTIC}/api/subreddits/search?subreddit=${encodeURIComponent(name)}&limit=1`, { signal }),
    safeFetch(`${ARCTIC}/api/subreddits/rules?subreddits=${encodeURIComponent(name)}`, { signal })
  ]);
  return {
    meta: metaRes.data?.[0] || null,
    rules: rulesRes.data || [],
    wikis: [] // lazy: fetch wikis/list only when user expands
  };
}

export async function fetchSubredditWikis(subreddit, { signal } = {}) {
  const name = String(subreddit || "").replace(/^r\//i, "").trim();
  const res = await safeFetch(`${ARCTIC}/api/subreddits/wikis/list?subreddit=${encodeURIComponent(name)}`, { signal });
  return { data: res.data || [], ok: res.ok };
}

export async function fetchTimeSeries(key, { precision = "month", after, before, signal } = {}) {
  const qs = [`key=${encodeURIComponent(key)}`, `precision=${precision}`];
  if (after) qs.push(`after=${encodeURIComponent(after)}`);
  if (before) qs.push(`before=${encodeURIComponent(before)}`);
  const url = `${ARCTIC}/api/time_series?${qs.join("&")}`;
  const res = await safeFetch(url, { signal });
  return { data: res.data || [], ok: res.ok };
}
