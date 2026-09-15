/** Profile aggregation primitives: stopwords, stats buckets, merge. */
export const STOPWORDS = new Set([
  'the','a','an','and','or','but','to','of','in','on','at','for','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','shall','can','not',
  'no','nor','so','yet','both','either','neither','that','this','these',
  'those','i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','what','which','who','just','get',
  'got','like','also','even','than','then','when','there','all','more','one',
  'out','up','if','by','as','from','about','into','through','after','over',
  'its','re','im','ive','dont','doesnt','didnt','isnt','cant','wont','wasnt',
  'how','any','some','much','very','really','know','think','want','see','go',
  // URL / image junk
  'png','https','amp','redd','preview','width','format','auto','webp',
  'http','www','com','org','jpg','jpeg','gif','svg','html','css',
]);

/** Create an empty per-profile stats bucket. */
export function emptyStats() {
  return {
    subredditCounts: {},
    heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
    wordFreqs: { posts: {}, comments: {} },
    sampleItems: [],
  };
}

/** Fold one Reddit item into a stats bucket. */
export function processItem(stats, item, isComment) {
  const sub = item.subreddit || item.subreddit_name_prefixed?.replace(/^r\//, "") || "unknown";
  stats.subredditCounts[sub] = (stats.subredditCounts[sub] || 0) + 1;

  if (item.created_utc) {
    const d = new Date(item.created_utc * 1000);
    stats.heatmap[d.getUTCDay()][d.getUTCHours()]++;
  }

  const text = isComment ? (item.body || "") : (item.selftext || item.title || "");
  if (text && text !== "[deleted]" && text !== "[removed]") {
    if (!stats.sampleItems) stats.sampleItems = [];
    if (stats.sampleItems.length < 1000) {
      stats.sampleItems.push({
        subreddit: sub,
        body: isComment ? item.body : (item.selftext || item.title || ""),
        title: item.title || "",
        score: item.score || 0
      });
    }

    const words = text.toLowerCase().replace(/[''']/g, "").split(/[^a-z]+/);
    const bucket = isComment ? stats.wordFreqs.comments : stats.wordFreqs.posts;
    const seen = new Set();
    for (const w of words) {
      if (w.length < 3 || STOPWORDS.has(w)) continue;
      if (!bucket[w]) bucket[w] = { total: 0, items: 0 };
      bucket[w].total++;
      if (!seen.has(w)) {
        seen.add(w);
        bucket[w].items++;
      }
    }
  }
}

/** Merge source stats into target stats in place. */
export function mergeStats(target, source) {
  for (const [sub, count] of Object.entries(source.subredditCounts)) {
    target.subredditCounts[sub] = (target.subredditCounts[sub] || 0) + count;
  }
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 24; c++) {
      target.heatmap[r][c] += source.heatmap[r][c];
    }
  }
  for (const type of ["posts", "comments"]) {
    for (const [word, counts] of Object.entries(source.wordFreqs[type])) {
      if (!target.wordFreqs[type][word]) target.wordFreqs[type][word] = { total: 0, items: 0 };
      target.wordFreqs[type][word].total += counts.total;
      target.wordFreqs[type][word].items += counts.items;
    }
  }
  if (source.sampleItems && Array.isArray(source.sampleItems)) {
    if (!target.sampleItems) target.sampleItems = [];
    if (target.sampleItems.length < 1000) {
      target.sampleItems = target.sampleItems.concat(source.sampleItems).slice(0, 1000);
    }
  }
}
