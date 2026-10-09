import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the real network composition with controlled response timing.
const requests = [];
globalThis.fetch = (url, { signal } = {}) => new Promise((resolve, reject) => {
  const request = { url, aborted: false, resolve: () => resolve({ ok: true, status: 200, json: async () => ({ data: [{ id: 'live', created_utc: 100 }] }) }) };
  requests.push(request);
  const abort = () => { request.aborted = true; reject(new DOMException('Aborted', 'AbortError')); };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
});
const { fetchBoth, sourceFailure } = await import('../src/api/endpoints.js');
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const first = new AbortController();
const aborted = fetchBoth('replacement', 'comments', {}, {}, { signal: first.signal }).catch(e => e.name);
first.abort();
const replacement = fetchBoth('replacement', 'comments', {}, {}, { signal: new AbortController().signal });
await tick();
assert.equal(requests.length, 2);
assert.ok(requests.every(r => !r.aborted));
requests.forEach(r => r.resolve());
assert.equal(await aborted, 'AbortError');
assert.equal((await replacement).items[0].id, 'live');
console.log('PASS immediate replacement shares a live request');

requests.length = 0;
const lone = new AbortController();
const cancelled = fetchBoth('lone', 'posts', {}, {}, { signal: lone.signal }).catch(e => e.name);
lone.abort();
await tick();
assert.ok(requests.every(r => r.aborted));
const delayedReplacement = fetchBoth('lone', 'posts');
await tick();
const liveRequests = requests.filter(r => !r.aborted);
assert.equal(liveRequests.length, 2);
liveRequests.forEach(r => r.resolve());
assert.equal(await cancelled, 'AbortError');
assert.equal((await delayedReplacement).items[0].id, 'live');
console.log('PASS replacement after cancellation starts fresh requests');

globalThis.fetch = async url => ({ ok: false, status: url.includes('pullpush.io') ? 429 : 522 });
const unavailable = await fetchBoth('diagnostics', 'posts');
assert.deepEqual(unavailable.sourceErrors.arctic, { reason: 'http', status: 522 });
assert.deepEqual(unavailable.sourceErrors.pullpush, { reason: 'rateLimited', status: 429 });
const blocked = await fetchBoth('diagnostics-next', 'comments');
assert.deepEqual(blocked.sourceErrors.pullpush, { reason: 'rateLimited', status: 429 });
assert.deepEqual(sourceFailure({ ok: false, timeout: true }), { reason: 'timeout' });
console.log('PASS upstream HTTP errors, rate limits, and timeouts retain their diagnosis');

const { safeFetch } = await import('../src/api/client.js');
globalThis.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
assert.deepEqual(sourceFailure(await safeFetch('https://example.test/timeout-diagnostics')), { reason: 'timeout' });
console.log('PASS timeout exceptions are reported as timeouts without retrying');

// A minimal hook runner keeps tests dependency-free. Only React scheduling
// and the network boundary are replaced; the hook implementation is loaded intact.
const slots = [];
let slot = 0;
let cleanup;
const pending = [];
globalThis.__searchHookTest = {
  useState(initial) {
    const index = slot++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useRef(initial) {
    const index = slot++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useCallback: fn => fn,
  useMemo: fn => fn(),
  useEffect: effect => { cleanup = effect(); },
  fetchBoth: (user, type, pagination, filters, { signal }) => new Promise((resolve, reject) => {
    pending.push({ user, resolve });
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }),
};
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const reactStub = moduleUrl('export const {useState,useRef,useCallback,useMemo,useEffect}=globalThis.__searchHookTest;');
const apiStub = moduleUrl('export const {fetchBoth}=globalThis.__searchHookTest;');
const cacheStub = moduleUrl('export const readPersistentFirstPage=()=>null;');
const source = (await readFile(new URL('../src/hooks/usePaginatedFetch.js', import.meta.url), 'utf8'))
  .replace('"react"', JSON.stringify(reactStub))
  .replace('"../api.js"', JSON.stringify(apiStub))
  .replace('"../api/persistentCache.js"', JSON.stringify(cacheStub));
const { usePaginatedFetch } = await import(moduleUrl(source));
const render = () => { slot = 0; return usePaginatedFetch('comments'); };
const result = id => ({ items: [{ id, created_utc: 100 }], sources: ['test'], arcticDown: false, pullpushDown: false, done: false });
let hook = render();
const alice = hook.reset('alice', {});
pending.at(-1).resolve(result('alice-comment'));
await alice;
hook = render();
assert.equal(hook.items[0].id, 'alice-comment');
const bob = hook.reset('bob', {});
hook = render();
assert.deepEqual(hook.items, []);
assert.deepEqual(hook.sources, []);
assert.equal(hook.loading, true);
await hook.loadMore('bob');
assert.equal(pending.length, 2, 'old account cursor must not be used');
pending.at(-1).resolve(result('bob-comment'));
await bob;
assert.equal(render().items[0].id, 'bob-comment');
console.log('PASS account change clears results, sources, and pagination before response');

const subreddit = render().reset('bob', {}, { mode: 'subreddit' });
assert.deepEqual(render().items, []);
pending.at(-1).resolve(result('subreddit-comment'));
await subreddit;
console.log('PASS mode change clears results even for an identical query');

const superseded = render().reset('old', {});
const newest = render().reset('new', {});
pending.at(-1).resolve(result('new-comment'));
await Promise.all([superseded, newest]);
assert.equal(render().items[0].id, 'new-comment');
console.log('PASS superseded request cannot overwrite the new account');

const unmounted = render().reset('remount', {});
cleanup();
const remounted = render().reset('remount', {});
pending.at(-1).resolve(result('remount-comment'));
await Promise.all([unmounted, remounted]);
assert.equal(render().items[0].id, 'remount-comment');
console.log('PASS remounted hook does not reuse an aborted local request');
delete globalThis.__searchHookTest;
