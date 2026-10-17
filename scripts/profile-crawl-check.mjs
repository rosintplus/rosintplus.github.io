import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Execute the actual crawl effect with deterministic archive pages and clocks.
// Only its network, scheduling, and React state boundaries are replaced.
const source = (await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const start = source.indexOf('  useEffect(() => {\n    if (!showProfile');
const end = source.indexOf('  }, [showProfile, query, crawlKey, mode, initialLoading]);', start);
assert.ok(start >= 0 && end > start, 'Profile crawl effect must be located');
const body = source.slice(start + '  useEffect(() => {'.length, end);
const ref = current => ({ current });

async function scan({ oldest = false, fail = false, full = false, timeout = false, stop = false } = {}) {
  const history = Array.from({ length: 3117 }, (_, index) => ({ id: `c${index}`, created_utc: 10000 - index }));
  const initial = oldest ? history.slice(-100) : history.slice(0, 100);
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  let idleStart;
  let deadline;
  let extra = 0;
  let capped = false;
  let pages = 0;
  const processed = new Set();
  const dependencies = {
    showProfile: true, query: 'fixture', mode: 'username', initialLoading: false, crawlKey: 0,
    posts: { items: [] }, comments: { items: initial },
    lastCrawlQueryRef: ref(null), bgStatsRef: ref(null), bgCrawlRef: ref(null),
    crawlItemsRef: ref(0), crawlCappedRef: ref(false), crawlProcessedRef: ref(new Set()),
    crawledPostsRef: ref([]), crawledCommentsRef: ref([]), fullCrawlRef: ref(full),
    crawlGenRef: ref(0), manualStopRef: ref(false),
    expectedTotalsRef: ref({ posts: 0, comments: history.length }),
    setIsCrawling(value) { if (!value) finish(); },
    setCrawledCount(value) { extra = value; },
    setCrawlCapped(value) { capped = value; }, setBgStatsVersion() {},
    emptyStats: () => ({}), processItem: (_stats, item) => processed.add(item.id),
    sleepAbortable: async () => { if (timeout && pages === 3) deadline(); },
    fetchBoth: async (_query, type, pagination) => {
      assert.equal(type, 'comments', 'Known-empty post stream should not be fetched');
      pages++;
      if (stop && pages === 3) {
        // Simulate the Stop button: abort the shared crawl controller mid-scan.
        // Abort during the 3rd fetch so the 2nd page is already processed
        // (the post-abort break discards the in-flight page). The crawl must
        // stop with partial progress and must NOT mark capped/incomplete.
        try { dependencies.bgCrawlRef.current?.abort(); } catch { /* noop */ }
      }
      if (fail && pages > 1) return { items: [], done: false };
      const eligible = history.filter(item => pagination.before == null || item.created_utc < pagination.before);
      return { items: eligible.slice(0, 100), done: eligible.length <= 100 };
    },
    window: {
      requestIdleCallback(callback) { idleStart = callback; return 1; },
      cancelIdleCallback() {},
    },
    // Keep long safety/flush timers inert; pagination and final flush still run.
    setTimeout: (callback, delay) => { if (delay >= 180000) deadline = callback; return 1; },
    clearTimeout() {}, AbortController, Date, console,
  };
  const names = Object.keys(dependencies);
  const runEffect = new Function(...names, body);
  const cleanup = runEffect(...names.map(name => dependencies[name]));
  if (idleStart) idleStart();
  await finished;
  assert.equal(extra, processed.size, 'Final progress must include all processed items');
  cleanup();
  return { total: initial.length + extra, capped, pages, retained: dependencies.crawledCommentsRef.current.length };
}

for (const options of [{}, { oldest: true }, { full: true }]) {
  const result = await scan(options);
  assert.equal(result.total, 3117, 'Scan must progress beyond 800 and cover the known history');
  assert.equal(result.capped, false);
  assert.equal(result.retained, 3017, 'Duplicate analysis must receive the full crawled history');
  assert.ok(result.pages > 8);
}
const interrupted = await scan({ fail: true });
assert.equal(interrupted.total, 100);
assert.equal(interrupted.capped, true, 'Archive failures must mark the scan as incomplete');
const timedOut = await scan({ timeout: true });
assert.equal(timedOut.total, 300, 'Timeout must retain the most recent page in progress');
assert.equal(timedOut.capped, true);
console.log('PASS full profile crawl, Oldest initial page, refresh, archive failure, and timeout progress');

const stopped = await scan({ stop: true });
assert.ok(stopped.total > 100 && stopped.total < 3117, 'Stop must retain partial progress without completing');
assert.ok(stopped.pages <= 3, 'Stop must halt paging immediately');
assert.equal(stopped.capped, false, 'Manual Stop must not set crawlCapped');
console.log('PASS manual Stop retains partial progress without marking capped');
