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

// Cheap single-regex prefilter covering every disclaimer above (each one
// contains bot, beep, boop or automat). Rejects non-candidates before the
// 8-pattern find runs.
const BOT_DISCLAIMER_PREFILTER = /bot|beep|boop|automat/i;

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
 * @returns {{ kind: string, detail: string, detailKey: string, detailParams: object }|null} Disclosure finding or null.
 */
function matchDisclaimer(text) {
  if (!text || text === '[deleted]' || text === '[removed]') return null;
  if (!BOT_DISCLAIMER_PREFILTER.test(text)) return null;
  const pattern = BOT_DISCLAIMER_PATTERNS.find(p => p.test(text));
  if (!pattern) return null;
  const match = text.match(pattern)?.[0];
  if (match) {
    return { kind: 'text', detail: `Discloses automation in its own content${match ? `: "${match}"` : ''}`, detailKey: 'botDetailText', detailParams: { match } };
  }
  return { kind: 'text', detail: `Discloses automation in its own content`, detailKey: 'botDetailTextBare', detailParams: {} };
}

function findDisclosure(username, posts, comments) {
  if (BOT_NAME_REGEX.test(username)) {
    return { kind: 'handle', detail: `Handle follows the bot naming convention ("${username}")`, detailKey: 'botDetailHandle', detailParams: { username } };
  }
  for (const c of comments) {
    const hit = matchDisclaimer(c?.body);
    if (hit) return hit;
  }
  for (const p of posts) {
    const title = p?.title || '';
    const selftext = p?.selftext || '';
    if (!title && !selftext) continue;
    // Avoid the combined template allocation until the cheap prefilter hits
    // on one side; matchDisclaimer re-checks the combined text so a match
    // spanning the title/selftext boundary still reports.
    if (!BOT_DISCLAIMER_PREFILTER.test(title) && !BOT_DISCLAIMER_PREFILTER.test(selftext)) continue;
    const hit = matchDisclaimer(`${title}\n${selftext}`.trim());
    if (hit) return hit;
  }
  return null;
}

// Groups items that share the same key; only repeats (2+) are returned.
// displayFn provides the original-casing text for the evidence sample — the
// grouping key is normalised (lowercased) for matching, but the sample shown
// to the user preserves the author's own casing.
function duplicateGroups(items, keyFn, displayFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, items: [], display: displayFn ? (displayFn(item) || key) : key });
    map.get(key).items.push(item);
  }
  const groups = [];
  for (const { key, items, display } of map.values()) {
    if (items.length >= 2) groups.push({ key, items, display: display ?? key });
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

export const BOT_VERDICT_KEYS = {
  'No Duplicates': 'botVerdictNoDuplicates',
  'Disclosed Automation': 'botVerdictDisclosed',
  'Repost Pattern': 'botVerdictRepost',
  'Duplicate Posts': 'botVerdictDuplicates',
};

export const BOT_EVIDENCE_LABEL_KEYS = {
  media: 'botEvidenceMedia',
  title: 'botEvidenceTitles',
  comment: 'botEvidenceComments',
};

function toEvidence(label, labelKey, kind, groups) {
  return groups.slice(0, MAX_GROUPS).map(group => {
    const raw = group.display ?? group.key;
    return {
      kind,
      label,
      labelKey,
      count: group.items.length,
      subs: subList(group.items),
      sample: raw.length > 80 ? `${raw.slice(0, 80)}…` : raw,
      posts: group.items.slice(0, 6).map(p => ({
        id: p.id,
        permalink: p.permalink,
        subreddit: p.subreddit || (p.subreddit_name_prefixed ? String(p.subreddit_name_prefixed).replace(/^r\//, '') : undefined),
        link_id: p.link_id || p.linkId || undefined,
      })),
    };
  });
}

/**
 * Assess bot likelihood from already-loaded profile history (no network).
 * @param {{ username?: string, posts?: Array, comments?: Array }} args - Profile history.
 * @returns {{ verdict: string, verdictKey: string, riskLevel: string, flags: string[], flagKeys: Array, evidence: Array, metrics: object }} Bot assessment.
 */
export function evaluateBotLikelihood({
  username = '',
  posts = [],
  comments = [],
} = {}) {
  return evaluateBotLikelihoodUncached({ username, posts, comments });
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
  const normalizeMediaUrl = u => {
    try {
      const noFrag = String(u || "").split("#")[0];
      const noQuery = noFrag.split("?")[0];
      let out = noQuery.trim().replace(/\/+$/, "");
      out = out.replace(/^http:/i, "https:");
      return out.toLowerCase();
    } catch {
      return String(u || "").toLowerCase();
    }
  };
  const mediaGroups = duplicateGroups(
    ownPosts.filter(p => p?.url && MEDIA_URL_REGEX.test(p.url)),
    p => normalizeMediaUrl(p.url),
    p => (p.url || '')
  );
  const titleGroups = duplicateGroups(
    ownPosts,
    p => (norm(p.title).length >= MIN_TITLE_CHARS ? norm(p.title) : ''),
    p => (p.title || '')
  );
  const bodyGroups = duplicateGroups(
    uniqueComments.filter(c => c?.body && c.body !== '[deleted]' && c.body !== '[removed]'),
    c => (norm(c.body).length >= MIN_COMMENT_CHARS ? norm(c.body) : ''),
    c => (c.body || '')
  );

  const evidence = [
    ...toEvidence('Duplicate media', 'botEvidenceMedia', 'media', mediaGroups),
    ...toEvidence('Duplicate titles', 'botEvidenceTitles', 'title', titleGroups),
    ...toEvidence('Duplicate comments', 'botEvidenceComments', 'comment', bodyGroups),
  ].sort((a, b) => b.count - a.count);

  // Count repeated items once even when both their title and media match.
  // Posts and comments have independent Reddit ID namespaces.
  const repeatedItems = new Set();
  for (const [kind, groups] of [['post', mediaGroups], ['post', titleGroups], ['comment', bodyGroups]]) {
    for (const group of groups) {
      for (const item of group.items.slice(1)) repeatedItems.add(`${kind}:${item.id}`);
    }
  }

  const flags = disclosure ? [`Bot disclosure: ${disclosure.detail}`] : [];
  const flagKeys = disclosure
    ? [{
        key: 'botFlagDisclosure',
        params: { detail: disclosure.detail },
        detailKey: disclosure.detailKey,
        detailParams: disclosure.detailParams || {},
      }]
    : [];

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
  let verdictKey = 'botVerdictNoDuplicates';
  let riskLevel = 'low';
  if (disclosure) {
    verdict = 'Disclosed Automation';
    verdictKey = 'botVerdictDisclosed';
    riskLevel = 'high';
  } else if (maxCopies >= 5 || (maxMedia >= 3 && maxTitle >= 3)) {
    verdict = 'Repost Pattern';
    verdictKey = 'botVerdictRepost';
    riskLevel = 'high';
  } else if (hasGroups) {
    verdict = 'Duplicate Posts';
    verdictKey = 'botVerdictDuplicates';
    riskLevel = 'medium';
  }

  return {
    verdict,
    verdictKey,
    riskLevel,
    flags,
    flagKeys,
    evidence,
    metrics: {
      loadedPosts: uniquePosts.length,
      loadedComments: uniqueComments.length,
      duplicateGroups: mediaGroups.length + titleGroups.length + bodyGroups.length,
      duplicateItems: repeatedItems.size,
      maxCopies,
      disclosed: !!disclosure,
    },
  };
}
