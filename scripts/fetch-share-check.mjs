/**
 * Regression: safeFetch must not abort a SHARED request while other callers
 * are still waiting on it.
 *
 * The old implementation only ever decremented `entry.waiters`, so the first
 * caller's abort killed the underlying fetch even though a second caller was
 * about to attach. React StrictMode hits exactly this: effect -> cleanup
 * (abort) -> effect again in the same tick. The second caller then inherited
 * an aborted (empty) result, which is why the parent post on a comment card
 * and the archive-wide item totals silently came back empty.
 *
 * Run with `node scripts/fetch-share-check.mjs`.
 */

const calls = [];
let pending = null;

globalThis.fetch = (url, opts = {}) => {
  calls.push({ url, aborted: false });
  const entry = { url };
  return new Promise((resolve, reject) => {
    entry.resolve = (body) => resolve({
      ok: true,
      status: 200,
      json: async () => body,
    });
    entry.reject = reject;
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        entry.aborted = true;
        calls[calls.length - 1].aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }
    pending = entry;
  });
};

const { safeFetch } = await import('../src/api/client.js');

const pass = [], fail = [];
const check = (ok, label) => { (ok ? pass : fail).push(label); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const URL_ = 'https://example.test/api/posts/ids?ids=abc';
// safeFetch caches by URL, so each scenario needs its own URL or it would
// reuse the previous scenario's entry and never touch the network.
const URL_B = 'https://example.test/api/posts/ids?ids=bbb';
const URL_C = 'https://example.test/api/posts/ids?ids=ccc';

console.log('\n=== A. StrictMode: abort + immediate re-register in one tick ===');
{
  const ctrl1 = new AbortController();
  const p1 = safeFetch(URL_, { signal: ctrl1.signal });

  // React StrictMode cleanup: the first effect's signal aborts...
  ctrl1.abort();
  // ...and the replacement effect links a new caller in the same tick.
  const ctrl2 = new AbortController();
  const p2 = safeFetch(URL_, { signal: ctrl2.signal });

  // Let the deferred abort decision run before resolving.
  await Promise.resolve();
  await Promise.resolve();

  const body = { data: [{ id: 'abc', title: 'Parent Post Title' }] };
  pending.resolve(body);

  const r2 = await p2;
  check(calls.length === 1, 'second caller shared the first request (no refetch)');
  check(!calls[0].aborted, 'shared request was NOT aborted by the first caller');
  check(r2.ok && r2.data?.[0]?.title === 'Parent Post Title', 'second caller received the real payload');

  const r1 = await p1;
  check(r1.aborted === true || r1.ok === true, 'first caller still settles (aborted or resolved)');
}

console.log('\n=== B. lone caller abort does still cancel its own request ===');
{
  calls.length = 0;
  const ctrl = new AbortController();
  const p = safeFetch(URL_B, { signal: ctrl.signal });
  ctrl.abort();
  await Promise.resolve();
  await Promise.resolve();
  const r = await p;
  check(calls.length === 1 && calls[0].aborted === true, 'a lone aborter cancels the underlying fetch');
  check(r.aborted === true, 'the lone caller sees an aborted result');
}

console.log('\n=== C. request with no caller signal is never aborted ===');
{
  calls.length = 0;
  const p = safeFetch(URL_C);
  await Promise.resolve();
  await Promise.resolve();
  pending.resolve({ data: [{ id: 'x' }] });
  const r = await p;
  check(calls.length === 1 && !calls[0].aborted, 'signal-less request runs to completion');
  check(r.ok === true && r.data.length === 1, 'signal-less caller gets the payload');
}

console.log('\n' + '='.repeat(52));
console.log(`  ${pass.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.log('  FAILED:');
  for (const f of fail) console.log(`    - ${f}`);
  process.exitCode = 1;
}
