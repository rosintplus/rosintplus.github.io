import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { fetchBoth } from "../api.js";
import { readPersistentFirstPage } from "../api/persistentCache.js";

export function cursorFromData(data) {
  if (!data || data.length === 0) return null;
  return {
    firstUtc: data[0].created_utc,
    firstId: data[0].id,
    lastUtc: data[data.length - 1].created_utc,
    lastId: data[data.length - 1].id
  };
}

export function forwardPagination(entry, sort) {
  if (!entry) return {};
  return sort === "asc"
    ? { after: entry.lastUtc, afterId: entry.lastId }
    : { before: entry.lastUtc, beforeId: entry.lastId };
}

function stableKey(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableKey(value[k])}`).join(",")}}`;
}

function requestKey(username, type, pagination, filters, sort, mode, bypassCache) {
  return stableKey({ username, type, pagination, filters, sort, mode, bypassCache });
}

export function usePaginatedFetch(type) {
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [arcticDown, setArcticDown] = useState(false);
  const [pullpushDown, setPullpushDown] = useState(false);
  const doneRef = useRef(false);
  const fetchIdRef = useRef(0);
  const abortRef = useRef(null);
  const cursorRef = useRef(null);
  const storedSortRef = useRef("desc");
  const storedFiltersRef = useRef({});
  const storedModeRef = useRef("username");

  const storedUserRef = useRef("");
  // Dedupe concurrent identical requests within this hook instance. The
  // module-level fetchBoth single-flight covers cross-instance (StrictMode)
  // sharing; this ref avoids abort-and-restart churn for same-tick duplicates
  // (e.g. filter effect firing twice with identical params).
  const inFlightRef = useRef(null);

  const _fetch = useCallback(async (username, pagination, filters, {
    bypassCache = false,
    sort = "desc",
    mode = "username",
    suppressError = false
  } = {}) => {
    const key = requestKey(username, type, pagination, filters, sort, mode, bypassCache);
    const inFlight = inFlightRef.current;
    if (inFlight && inFlight.key === key && !bypassCache) {
      // Identical request already in flight — share it instead of aborting
      // and restarting (saves a full Arctic+PullPush fan-out).
      return inFlight.promise;
    }
    const fetchId = ++fetchIdRef.current;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    if (!suppressError) setError(null);
    const promise = (async () => {
      try {
        const {
          items: data,
          sources: srcs,
          arcticDown: down,
          pullpushDown: ppDown,
          done: streamDone
        } = await fetchBoth(username, type, pagination, filters, {
          bypassCache,
          signal: ctrl.signal,
          sort,
          mode,
        });
        if (fetchId !== fetchIdRef.current) return null;
        // Aborted sharer responses never reach here (fetchBoth rejects with
        // AbortError on caller abort, handled below). Only live results update.
        setSources(srcs);
        setArcticDown(down);
        setPullpushDown(ppDown);
        return { data, done: streamDone };
      } catch (err) {
        if (err?.name === "AbortError" || fetchId !== fetchIdRef.current) return null;
        if (!suppressError) setError(err?.message ?? "Network error");
        return { data: [], done: true };
      } finally {
        if (fetchId === fetchIdRef.current) setLoading(false);
        if (inFlightRef.current?.fetchId === fetchId) inFlightRef.current = null;
      }
    })();
    inFlightRef.current = { key, promise, fetchId, controller: ctrl };
    return promise;
  }, [type]);
  const reset = useCallback(async (username, filters, {
    bypassCache = false,
    sort = "desc",
    mode = "username"
  } = {}) => {
    storedUserRef.current = username;
    storedFiltersRef.current = filters;
    storedSortRef.current = sort;
    storedModeRef.current = mode;
    setDone(false);
    doneRef.current = false;
    const pag = {};
    if (filters.dateFrom != null) pag.after = filters.dateFrom;
    if (filters.dateTo != null) pag.before = filters.dateTo;
    if (!bypassCache) {
      // Stale-while-revalidate: paint the persistent first-page cache instantly
      // (refresh loses the in-memory cache), then revalidate in background.
      // reset() resolves with the cached items so the caller clears skeletons
      // immediately; the fresh network result updates state when it lands.
      // No extra fan-out: the background fetch IS the normal first-page fetch.
      let hit = null;
      try {
        hit = readPersistentFirstPage(username, type, pag, filters, sort, mode);
      } catch { hit = null; }
      if (hit && Array.isArray(hit.items) && hit.items.length > 0) {
        setItems(hit.items);
        setSources(Array.isArray(hit.sources) ? hit.sources : []);
        setArcticDown(!!hit.arcticDown);
        setPullpushDown(!!hit.pullpushDown);
        setError(null);
        setLoading(false);
        cursorRef.current = cursorFromData(hit.items);
        setDone(!!hit.done);
        doneRef.current = !!hit.done;
        // Background revalidation: force fresh network (also refreshes the
        // persistent entry via runFetchBoth). Abort/single-flight semantics
        // are preserved — _fetch owns fetchId/abort, stale results are dropped.
        _fetch(username, pag, filters, { bypassCache: true, sort, mode }).then(r => {
          if (!r) return;
          setItems(r.data);
          cursorRef.current = cursorFromData(r.data);
          setDone(r.done);
          doneRef.current = r.done;
        });
        return hit.items;
      }
    }
    const result = await _fetch(username, pag, filters, { bypassCache, sort, mode });
    if (result === null) return [];
    const { data, done: streamDone } = result;
    setItems(data);
    cursorRef.current = cursorFromData(data);
    setDone(streamDone);
    doneRef.current = streamDone;
    return data;
  }, [_fetch, type]);
  const loadMore = useCallback(async username => {
    const targetUser = username || storedUserRef.current;
    if (!targetUser || !cursorRef.current || doneRef.current) return;
    const result = await _fetch(targetUser, forwardPagination(cursorRef.current, storedSortRef.current), storedFiltersRef.current, {
      sort: storedSortRef.current,
      mode: storedModeRef.current,
      suppressError: true
    });
    if (result === null) return;
    const { data, done: streamDone } = result;
    if (data.length > 0) {
      const newCursor = cursorFromData(data);
      if (cursorRef.current && newCursor?.lastId === cursorRef.current.lastId) {
        setDone(true);
        doneRef.current = true;
        return;
      }
      cursorRef.current = newCursor;
      setItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...data.filter(i => i.id && !seen.has(i.id))];
      });
    }
    if (streamDone || data.length === 0) { setDone(true); doneRef.current = true; }
  }, [_fetch]);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);
  return useMemo(() => ({
    items,
    sources,
    loading,
    error,
    done,
    arcticDown,
    pullpushDown,
    reset,
    loadMore
  }), [items, sources, loading, error, done, arcticDown, pullpushDown, reset, loadMore]);
}
