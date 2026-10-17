/** Low-level API client: cache, retry, and safe fetch. */
// ─── API Config ───────────────────────────────────────────────────────────────
export const ARCTIC = "https://arctic-shift.photon-reddit.com";

export const PULLPUSH = "https://api.pullpush.io";

export const REDDIT_BASE = "https://www.reddit.com";

export const LIMIT = 100;

// sort: "desc" (Newest) or "asc" (Oldest). Arctic Shift orders the page
// server-side, so "Oldest" must be sent as sort=asc and paged *forward*
// (after-cursor) — reversing a desc page only flips the current 100 rows.

// Total per-request timeout (AbortSignal.timeout). Bounds hung archive
// requests so a slow PullPush can't stall time-to-first-result forever.
export const FETCH_TIMEOUT_MS = 10000;
// Successful cache TTL. Fresh hits return without network (StrictMode-safe).
export const CACHE_TTL_MS = 5 * 60 * 1000;
// Max retries per request (1 retry = 2 attempts total). Capped to avoid retry storms.
export const MAX_RETRIES = 1;

// ─── PullPush circuit breaker ─────────────────────────────────────────────
// PullPush rate-limits aggressively (HTTP 429, ~3.9s+ per call). Retrying into
// a 429 only extends the limit, and every refresh fans out 2 first-page calls
// plus up to 16 background-crawl pages at the same host. On the first PullPush
// 429, skip PullPush session-wide for ~60s (callers get cached/empty fast via
// Arctic instead). There is deliberately NO retry on 429.
export const PULLPUSH_BREAKER_MS = 60 * 1000;

let pullpushBlockedUntil = 0;

function isPullPushUrl(url) {
  try {
    return new URL(String(url)).hostname === "api.pullpush.io";
  } catch {
    return false;
  }
}

function tripPullPushBreaker() {
  pullpushBlockedUntil = Date.now() + PULLPUSH_BREAKER_MS;
}

/** True while the PullPush breaker is open (PullPush calls should be skipped). */
export function isPullPushBlocked(now = Date.now()) {
  return now < pullpushBlockedUntil;
}

/** Test/debug helper: breaker expiry timestamp (ms since epoch). */
export function getPullPushBlockedUntil() {
  return pullpushBlockedUntil;
}

/** Test/debug helper: close the breaker immediately. */
export function resetPullPushBreaker() {
  pullpushBlockedUntil = 0;
}

// ─── Helpers ───────

// FETCH_CACHE stores the in-flight promise (not just the resolved value), so
// two identical concurrent calls — e.g. ParentChain recursion racing a tab
// fetch — share one network request and one await. The TTL only applies to
// successful non-empty results; empty/error/aborted results are evicted.
// Entries are { ts, promise, controller, settled } — controller aborts the
// underlying network only when all attached callers have aborted (or timeout).
export const FETCH_CACHE = new Map();
export const MAX_CACHE = 200;

// Tracks stale-while-revalidate background refreshes so a burst of identical
// stale hits kicks exactly one revalidation instead of N (retry-storm guard).
const REVALIDATING = new Set();

export const sleep = ms => new Promise(r => setTimeout(r, ms));

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function toTimeoutSignal(ms) {
  try {
    if (typeof AbortSignal.timeout === "function") {
      return { signal: AbortSignal.timeout(ms), cleanup: () => {} };
    }
  } catch { /* fall through to manual */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch { /* noop */ } }, ms);
  return { signal: ctrl.signal, cleanup: () => { try { clearTimeout(timer); } catch { /* noop */ } } };
}

function combineSignals(outer, timeoutMs) {
  const { signal: timeoutSignal, cleanup: clearTimeoutFallback } = toTimeoutSignal(timeoutMs);
  if (!outer) return { signal: timeoutSignal, cleanup: clearTimeoutFallback };
  if (outer.aborted) {
    try { clearTimeoutFallback(); } catch { /* noop */ }
    return { signal: outer, cleanup: () => {} };
  }
  try {
    if (typeof AbortSignal.any === "function") {
      return { signal: AbortSignal.any([outer, timeoutSignal]), cleanup: clearTimeoutFallback };
    }
  } catch { /* fall through to manual */ }
  const ctrl = new AbortController();
  const onOuter = () => { try { ctrl.abort(); } catch { /* noop */ } };
  const onTimeout = () => { try { ctrl.abort(); } catch { /* noop */ } };
  outer.addEventListener("abort", onOuter, { once: true });
  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  return {
    signal: ctrl.signal,
    cleanup: () => {
      try { outer.removeEventListener("abort", onOuter); } catch { /* noop */ }
      try { timeoutSignal.removeEventListener("abort", onTimeout); } catch { /* noop */ }
      try { clearTimeoutFallback(); } catch { /* noop */ }
    },
  };
}

export function sleepAbortable(ms, signal) {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ }
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Race a shared promise against a caller's AbortSignal without aborting the
 * underlying network for other sharers. Caller gets { aborted: true } fast;
 * the shared fetch continues (bounded by FETCH_TIMEOUT_MS) for cache warming.
 */
export function shareWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve({ data: [], ok: false, aborted: true });
  return new Promise(resolve => {
    const onAbort = () => resolve({ data: [], ok: false, aborted: true });
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      res => {
        try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ }
        if (signal.aborted) resolve({ data: [], ok: false, aborted: true });
        else resolve(res);
      },
      err => {
        try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ }
        if (signal.aborted || err?.name === "AbortError") {
          resolve({ data: [], ok: false, aborted: true });
        } else {
          resolve({ data: [], ok: false });
        }
      },
    );
  });
}

// One immediate retry with short backoff. Transient 5xx and flaky network
// hiccups are the common cause of the "archive unavailable" screen; a single
// retry clears most of them without hammering the server.
// Capped: retries clamped to MAX_RETRIES, total bounded by timeoutMs, no retry
// on abort/timeout, abort-aware backoff. There is NO retry on HTTP 429 —
// retrying into a rate limit extends it (PullPush trips the circuit breaker).
export async function fetchWithRetry(url, {
  signal,
  retries = 1,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  const cappedRetries = Math.max(0, Math.min(retries, MAX_RETRIES));
  const { signal: combined, cleanup } = combineSignals(signal, timeoutMs);
  try {
    let lastErr;
    for (let attempt = 0; attempt <= cappedRetries; attempt++) {
      if (combined?.aborted) throw abortError();
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json"
          },
          signal: combined,
        });
        if (!res.ok) {
          // PullPush 429: open the session-wide breaker, never retry.
          if (res.status === 429 && isPullPushUrl(url)) {
            tripPullPushBreaker();
            return {
              data: [],
              ok: false,
              status: res.status,
            };
          }
          // Retry server errors (and Arctic 429s) once; other client 4xx won't
          // improve on a retry, so don't bother.
          if (attempt < cappedRetries && (res.status === 429 || res.status >= 500)) {
            await sleepAbortable(250 * (attempt + 1), combined);
            continue;
          }
          return {
            data: [],
            ok: false,
            status: res.status,
          };
        }
        let json;
        try {
          json = await res.json();
        } catch (err) {
          if (err?.name === "SyntaxError") return { data: [], ok: false, invalidResponse: true };
          throw err;
        }
        if (!Array.isArray(json?.data)) return { data: [], ok: false, invalidResponse: true };
        return {
          data: json?.data ?? [],
          ok: true
        };
      } catch (err) {
        if (err?.name === "AbortError" || err?.name === "TimeoutError") throw err;
        lastErr = err;
        if (attempt < cappedRetries) {
          await sleepAbortable(250 * (attempt + 1), combined);
          continue;
        }
      }
    }
    return {
      data: [],
      ok: false,
      err: lastErr
    };
  } finally {
    try { cleanup(); } catch { /* noop */ }
  }
}

function evictIfOurs(url, promise) {
  try {
    if (FETCH_CACHE.get(url)?.promise === promise) FETCH_CACHE.delete(url);
  } catch { /* noop */ }
}

function setCache(url, entry) {
  FETCH_CACHE.set(url, entry);
  if (FETCH_CACHE.size > MAX_CACHE) {
    const oldest = FETCH_CACHE.keys().next().value;
    if (oldest) FETCH_CACHE.delete(oldest);
  }
}

export function safeFetch(url, {
  bypassCache = false,
  signal,
  retries = 1,
} = {}) {
  if (signal?.aborted) return Promise.resolve({ data: [], ok: false, aborted: true });
  const cappedRetries = Math.max(0, Math.min(retries, MAX_RETRIES));

  // Fresh cache first: a fresh hit is served even while the breaker is open
  // (refresh keeps instant results). Breaker only skips network for
  // stale/miss PullPush calls.
  if (!bypassCache) {
    const cached = FETCH_CACHE.get(url);
    if (cached && !cached.controller?.signal.aborted) {
      const isFresh = Date.now() - cached.ts < CACHE_TTL_MS;
      if (isFresh) {
        // Fresh hit — share in-flight or resolved value, no new network.
        // Aborted entries are never cached (evicted on settle), so a fresh
        // hit is always usable data; StrictMode remounts reuse it instead of
        // refetching. Caller abort only affects this caller's view.
        if (cached.settled === false && cached.controller && signal) {
          linkCallerToEntry(cached, signal);
        }
        return shareWithAbort(cached.promise, signal);
      }
    }
  }
  // Open breaker: skip PullPush network entirely (return cached/empty fast)
  // instead of retrying into the rate limit. Arctic is unaffected. Fresh hits
  // already returned above, so blocked + stale/miss fails fast here.
  if (isPullPushUrl(url) && isPullPushBlocked()) {
    return Promise.resolve({ data: [], ok: false, blocked: true, status: 429 });
  }

  if (!bypassCache) {
    const cached = FETCH_CACHE.get(url);
    if (cached && !cached.controller?.signal.aborted) {
      // Stale-while-revalidate: return stale immediately for perceived speed,
      // revalidate in background (single-flight). Caller gets instant data.
      if (cached.promise && !REVALIDATING.has(url)) {
        // Respect the PullPush breaker for background refresh too: while open,
        // don't fire network that would extend the rate limit.
        if (!(isPullPushUrl(url) && isPullPushBlocked())) {
          REVALIDATING.add(url);
          // Background refresh is bounded (timeout) and never retries — stale
          // bursts must not become retry storms.
          fetchWithRetry(url, { signal: undefined, retries: 0 }).then(res => {
          const fresh = {
            data: res?.data ?? [],
            ok: !!res?.ok
          };
          // Only cache successful non-empty
          if (fresh.ok && fresh.data.length > 0) {
            setCache(url, {
              ts: Date.now(),
              promise: Promise.resolve(fresh),
              controller: null,
              settled: true,
            });
          } else {
            // Failed/empty revalidation: evict the stale entry so an outage
            // surfaces instead of serving stale forever (mirrors
            // persistentCache TTL eviction). Guarded so a newer entry that
            // landed meanwhile (e.g. bypassCache refresh) is never deleted.
            // Already-returned callers keep their stale promise reference.
            try {
              if (FETCH_CACHE.get(url)?.promise === cached.promise) FETCH_CACHE.delete(url);
            } catch { /* noop */ }
          }
        }).catch(() => {
          try {
            if (FETCH_CACHE.get(url)?.promise === cached.promise) FETCH_CACHE.delete(url);
          } catch { /* noop */ }
        }).finally(() => {
          REVALIDATING.delete(url);
        });
        }
      }
      if (cached.settled === false && cached.controller && signal) {
        linkCallerToEntry(cached, signal);
      }
      return shareWithAbort(cached.promise, signal);
    }
  }

  // Cache miss or bypass — single-flight creation is implicit: JS runs this
  // synchronously, so a second identical call in the same tick sees the entry
  // above and shares instead of starting duplicate network.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { try { controller.abort(); } catch { /* noop */ } }, FETCH_TIMEOUT_MS);
  // `waiters` counts live sharers and is incremented by linkCallerToEntry.
  // Starts at 0: a request created with no caller signal has nobody to abort
  // it and runs to its bounded timeout.
  const entry = { ts: Date.now(), promise: null, controller, settled: false, waiters: 0, abortScheduled: false };
  const underlying = fetchWithRetry(url, {
    signal: controller.signal,
    retries: cappedRetries,
  }).then(res => {
    const out = {
      data: res?.data ?? [],
      ok: !!res?.ok,
    };
    if (res?.err) out.err = res.err;
    if (res?.status) out.status = res.status;
    if (res?.invalidResponse) out.invalidResponse = true;
    entry.settled = true;
    clearTimeout(timeoutId);
    if (!out.ok || out.data.length === 0) {
      evictIfOurs(url, underlying);
    }
    return out;
  }).catch(err => {
    entry.settled = true;
    clearTimeout(timeoutId);
    evictIfOurs(url, underlying);
    if (err?.name === "AbortError" || err?.name === "TimeoutError") return {
      data: [],
      ok: false,
      aborted: true,
      timeout: !signal?.aborted,
    };
    return {
      data: [],
      ok: false
    };
  });
  entry.promise = underlying;
  // Aborted results are never left in cache (evicted above via evictIfOurs
  // when ok:false/empty, and aborted maps to ok:false). A later caller with a
  // live signal therefore never inherits a false outage — but a fresh
  // successful entry is reused without refetch.
  setCache(url, entry);
  if (signal) linkCallerToEntry(entry, signal);
  return shareWithAbort(underlying, signal);
}

function linkCallerToEntry(entry, signal) {
  if (!signal || !entry || entry.settled || !entry.controller) return;
  // This caller is now a sharer of the underlying request. `waiters` counts
  // live sharers and is incremented on every link — previously it was only
  // ever decremented, so the first caller's abort killed the shared request
  // while other callers were still waiting on it (which is how parent posts
  // and archive totals silently came back empty).
  entry.waiters += 1;
  const release = () => {
    entry.waiters -= 1;
    // Deferred, not synchronous: React StrictMode aborts the first effect's
    // signal in cleanup and re-registers a replacement in the same tick.
    // Deciding immediately would abort the shared fetch before the new caller
    // links, leaving it an aborted (empty) result. A microtask lets the
    // replacement register first; we re-check then.
    scheduleAbortIfUnshared(entry);
  };
  if (signal.aborted) {
    release();
    return;
  }
  const onAbort = () => release();
  signal.addEventListener("abort", onAbort, { once: true });
  entry.promise?.then(
    () => { try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ } },
    () => { try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ } },
  );
}

function scheduleAbortIfUnshared(entry) {
  if (!entry || entry.abortScheduled) return;
  entry.abortScheduled = true;
  queueMicrotask(() => {
    entry.abortScheduled = false;
    if (entry.waiters <= 0 && !entry.settled) {
      try { entry.controller.abort(); } catch { /* noop */ }
    }
  });
}
