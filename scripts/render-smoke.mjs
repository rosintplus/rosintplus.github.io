/**
 * Headless render smoke test.
 *
 * Renders the real App (and the lazy-loaded profile panels) through Vite's SSR
 * module loader with minimal DOM shims, so render-time errors surface here
 * instead of as a blank page in the browser.
 */
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

// ── Minimal DOM shims, installed before any app module is evaluated ──
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
// Node 24 defines navigator as a getter-only global, so override it.
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'en-US' },
  configurable: true,
  writable: true,
});
const noop = () => {};
const fakeStyle = { cssText: '', setProperty: noop, getPropertyValue: () => '' };
globalThis.document = {
  documentElement: { style: fakeStyle, lang: 'en' },
  body: { appendChild: noop, removeChild: noop },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, click: noop, setAttribute: noop }),
  addEventListener: noop,
  removeEventListener: noop,
  title: '',
};
globalThis.window = globalThis;
globalThis.location = {
  search: '', pathname: '/', href: 'http://localhost/', origin: 'http://localhost',
  hash: '', host: 'localhost', hostname: 'localhost', protocol: 'http:',
  assign: noop, replace: noop, reload: noop,
};
globalThis.history = { pushState: noop, replaceState: noop, back: noop, forward: noop, go: noop };
globalThis.scrollY = 0;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener: noop,
  removeEventListener: noop,
  addListener: noop,
  removeListener: noop,
});
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.requestIdleCallback = () => 0;
globalThis.cancelIdleCallback = noop;
globalThis.indexedDB = undefined;
globalThis.fetch = async () => ({
  ok: false,
  status: 503,
  json: async () => ({ data: [] }),
});

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  resolve: {
    alias: {
      // Only app modules go through Vite here (react-dom/server stays a real
      // Node CJS require), so this alias is scoped to the app under test.
      'react': new URL('./_react-ssr-shim.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    },
  },
});

const failures = [];
const ok = [];

async function render(label, modPath, exportName, props) {
  try {
    const mod = await vite.ssrLoadModule(modPath);
    const Comp = exportName ? mod[exportName] : mod.default;
    if (typeof Comp !== 'function' && typeof Comp !== 'object') {
      failures.push(`${label}: export is not a component (${typeof Comp})`);
      return;
    }
    const html = renderToString(React.createElement(Comp, props));
    ok.push(`${label}: rendered ${html.length} bytes`);
  } catch (err) {
    failures.push(`${label}: ${err?.message ?? err}`);
  }
}

const posts = [
  { id: 'p1', subreddit: 'socialism', title: 'universal healthcare is a human right', selftext: '', created_utc: 1700000000, author: 'x' },
  { id: 'p2', subreddit: 'progressive', title: 'tax the rich and cancel student debt', selftext: '', created_utc: 1700000001, author: 'x' },
];
const comments = [
  { id: 'c1', subreddit: 'socialdemocracy', body: 'progressive taxation and strong unions protect working families', created_utc: 1700000002, author: 'x' },
  { id: 'c2', subreddit: 'ClimateAction', body: 'climate change is real, we need renewable energy and the green new deal', created_utc: 1700000003, author: 'x' },
];
const stats = {
  subredditCounts: { socialism: 12, progressive: 6, socialdemocracy: 8, ClimateAction: 4 },
  heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
  wordFreqs: { posts: { healthcare: 3 }, comments: { unions: 2 } },
  sampleItems: [],
};

await render('App (idle)', '/src/App.jsx');
await render('ProfileSummary', '/src/components/profile/ProfileSummary.jsx', 'default', {
  username: 'testuser', posts, comments,
  userMeta: { num_posts: 40, num_comments: 90, total_karma: 120, earliest_post_at: 1600000000 },
});
await render('AccountProfile', '/src/components/profile/AccountProfile.jsx', 'default', {
  query: 'testuser',
  activeTab: 'all',
  onWordClick: noop,
  stats,
  userMeta: { num_posts: 40, num_comments: 90, total_karma: 120, earliest_post_at: 1600000000 },
  loadedCount: 4,
  crawledCount: 0,
  isCrawling: false,
  onRefresh: noop,
  onStopCrawl: noop,
  posts,
  comments,
});

await vite.close();

console.log('\n=== headless render ===');
for (const o of ok) console.log(`  PASS  ${o}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\n  ${ok.length} rendered, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
