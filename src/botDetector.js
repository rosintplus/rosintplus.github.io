/**
 * Local bot-pattern assessment.
 *
 * Every finding is computed from data the app has already loaded for the
 * profile — no extra network requests, so nothing here can be rate limited.
 * Two kinds of evidence are reported:
 *
 * 1. Explicit disclosure — a handle or message that follows Reddit's bot
 *    conventions (bottiquette). A direct statement, not an inference.
 * 2. Duplicate publishing inside the account's own history — the classic
 *    karma-farm/repost signature: the same media link, the same title, or the
 *    same comment body published over and over. Each group links to the posts.
 *
 * Items are de-duplicated by id first (the app can hold the same post in both
 * the loaded list and the crawl buffer), and native crossposts are excluded —
 * Reddit crossposting is a built-in feature, not duplication.
 */

// Explicit automation notices. These are the phrasings bots use to disclose
// themselves; a match is the account telling you what it is.
const BOT_DISCLAIMER_PATTERNS = [
  /i am a bot(?:,| and)? this action was performed automatically/i,
  /beep(?: |-)?boop/i,
  /beep, i'm a bot/i,
  /this is an automated (?:response|message|action)/i,
  /i'm an automated bot/i,
  /action was performed automatically/i,
  /i'm a bot\b/i,
  /this bot (?:was|is) (?:made|created|running)/i,
];

// Community naming convention: bots identify themselves in the handle.
const BOT_NAME_REGEX = /(?:^auto_|[_-]bot$|^bot(?:[_-]|$)|_automod|transcriber|helperbot|bot_)/i;

// Repost bots recycle media. Same-article link repeats are common among humans,
// so duplicate-link detection stays on media hosts.
const MEDIA_URL_REGEX = /^https?:\/\/(?:i\.redd\.it|v\.redd\.it|preview\.redd\.it|i\.imgur\.com|m\.imgur\.com|imgur\.com|i\.gyazo\.com|media\.giphy\.com|i\.giphy\.com|gfycat\.com|redgifs\.com)\//i;

const MIN_TITLE_CHARS = 15;
const MIN_COMMENT_CHARS = 40;
const MAX_GROUPS = 6;

const norm = text => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
const isCrosspost = p => p?.crosspost_parent != null || p?.crosspost_parent_id != null;

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Find the first bot-disclosure match inside a text blob.
 * @param {string} text - Text to scan.
 * @returns {{ kind: string, detail: string }|null} Disclosure finding or null.
 */
function matchDisclaimer(text) {
  if (!text || text === '[deleted]' || text === '[removed]') return null;
  const pattern = BOT_DISCLAIMER_PATTERNS.find(p => p.test(text));
  if (!pattern) return null;
  const match = text.match(pattern)?.[0];
  return { kind: 'text', detail: `Discloses automation in its own content${match ? `: "${match}"` : ''}` };
}

function findDisclosure(username, posts, comments) {
  if (BOT_NAME_REGEX.test(username)) {
    return { kind: 'handle', detail: `Handle follows the bot naming convention ("${username}")` };
  }
  for (const c of comments.slice(0, 50)) {
    const hit = matchDisclaimer(c?.body);
    if (hit) return hit;
  }
  for (const p of posts.slice(0, 30)) {
    const hit = matchDisclaimer(`${p?.title || ''}\n${p?.selftext || ''}`.trim());
    if (hit) return hit;
  }
  return null;
}

// Groups items that share the same key; only repeats (2+) are returned.
function duplicateGroups(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  const groups = [];
  for (const [key, list] of map) {
    if (list.length >= 2) groups.push({ key, items: list });
  }
  groups.sort((a, b) => b.items.length - a.items.length);
  return groups;
}

function subList(items, max = 5) {
  const subs = [];
  for (const item of items) {
    const sub = item.subreddit_name_prefixed || (item.subreddit ? `r/${item.subreddit}` : '');
    if (sub && !subs.includes(sub)) subs.push(sub);
    if (subs.length >= max) break;
  }
  return subs.join(', ');
}

function toEvidence(label, kind, groups) {
  return groups.slice(0, MAX_GROUPS).map(group => ({
    kind,
    label,
    count: group.items.length,
    subs: subList(group.items),
    sample: group.key.length > 80 ? `${group.key.slice(0, 80)}…` : group.key,
    posts: group.items.slice(0, 6).map(p => ({ id: p.id, permalink: p.permalink })),
  }));
}

/**
 * Assess bot likelihood from already-loaded profile history (no network).
 * @param {{ username?: string, posts?: Array, comments?: Array }} args - Profile history.
 * @returns {{ verdict: string, riskLevel: string, flags: string[], evidence: Array, metrics: object }} Bot assessment.
 */
export function evaluateBotLikelihood({
  username = '',
  posts = [],
  comments = [],
} = {}) {
  const cacheKey = buildBotCacheKey(username, posts, comments);
  const hit = botCache.get(cacheKey);
  if (hit) return hit;
  const result = evaluateBotLikelihoodUncached({ username, posts, comments });
  botCache.set(cacheKey, result);
  if (botCache.size > 30) {
    const oldest = botCache.keys().next().value;
    botCache.delete(oldest);
  }
  return result;
}

// Per-profile result cache keyed by item identity. ProfileSummary memoizes
// on array identity, but the crawl creates new array wrappers on every batch
// (and keyword typing re-renders parents), so without this the O(n) duplicate
// grouping would rerun far more often than the data actually changes.
const botCache = new Map();

function hashItemIds(items) {
  let h = 0;
  const n = items?.length || 0;
  h = (Math.imul(h, 31) + n) | 0;
  for (let i = 0; i < n; i++) {
    const s = items[i]?.id || "";
    for (let j = 0; j < s.length; j++) {
      h = (Math.imul(h, 31) + s.charCodeAt(j)) | 0;
    }
    h = (Math.imul(h, 31) + 0x9e3779b9) | 0;
  }
  return (h >>> 0).toString(36);
}

function buildBotCacheKey(username, posts, comments) {
  return `${String(username || "").toLowerCase()}|p${posts?.length || 0}:${hashItemIds(posts)}|c${comments?.length || 0}:${hashItemIds(comments)}`;
}

function evaluateBotLikelihoodUncached({
  username = '',
  posts = [],
  comments = [],
} = {}) {
  const uniquePosts = dedupeById(posts);
  const uniqueComments = dedupeById(comments);
  const disclosure = findDisclosure(username, uniquePosts, uniqueComments);

  // Native crossposts are a Reddit feature, not duplication.
  const ownPosts = uniquePosts.filter(p => !isCrosspost(p));
  const mediaGroups = duplicateGroups(
    ownPosts.filter(p => p?.url && MEDIA_URL_REGEX.test(p.url)),
    p => p.url.split('?')[0]
  );
  const titleGroups = duplicateGroups(
    ownPosts,
    p => (norm(p.title).length >= MIN_TITLE_CHARS ? norm(p.title) : '')
  );
  const bodyGroups = duplicateGroups(
    uniqueComments.filter(c => c?.body && c.body !== '[deleted]' && c.body !== '[removed]'),
    c => (norm(c.body).length >= MIN_COMMENT_CHARS ? norm(c.body) : '')
  );

  const evidence = [
    ...toEvidence('Duplicate media', 'media', mediaGroups),
    ...toEvidence('Duplicate titles', 'title', titleGroups),
    ...toEvidence('Duplicate comments', 'comment', bodyGroups),
  ].sort((a, b) => b.count - a.count);

  const flags = disclosure ? [`Bot disclosure: ${disclosure.detail}`] : [];

  const maxCopies = Math.max(
    mediaGroups[0]?.items.length || 0,
    titleGroups[0]?.items.length || 0,
    bodyGroups[0]?.items.length || 0
  );
  const maxMedia = mediaGroups[0]?.items.length || 0;
  const maxTitle = titleGroups[0]?.items.length || 0;
  const hasGroups = mediaGroups.length + titleGroups.length + bodyGroups.length > 0;

  // "Repost pattern" needs the strong signature: very heavy repetition, or
  // both media and title recycling at scale. A single repeated item is common
  // human behaviour (re-sharing your own content) and stays at medium.
  let verdict = 'No Duplicates';
  let riskLevel = 'low';
  if (disclosure) {
    verdict = 'Disclosed Automation';
    riskLevel = 'high';
  } else if (maxCopies >= 5 || (maxMedia >= 3 && maxTitle >= 3)) {
    verdict = 'Repost Pattern';
    riskLevel = 'high';
  } else if (hasGroups) {
    verdict = 'Duplicate Posts';
    riskLevel = 'medium';
  }

  return {
    verdict,
    riskLevel,
    flags,
    evidence,
    metrics: {
      loadedPosts: uniquePosts.length,
      loadedComments: uniqueComments.length,
      duplicateGroups: mediaGroups.length + titleGroups.length + bodyGroups.length,
      maxCopies,
      disclosed: !!disclosure,
    },
  };
}
