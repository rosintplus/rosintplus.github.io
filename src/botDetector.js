/**
 * Calibrated Probabilistic Reddit Bot & Automation Classifier.
 *
 * Implements multi-signal Bayesian evaluation for:
 * 1. Karma-Farming Repost Bots:
 *    - Detects accounts targeting exclusively viral default subreddits (aww, pics, memes, etc.)
 *    - Identifies stolen 1st-person OC titles (e.g. "my late dog", "after 5 years of sobriety") with 0 author replies.
 *    - Flags zero-width space Unicode evasion (\u200B) used to bypass Reddit duplicate-title filters.
 * 2. Comment-Stealing Copycat Bots:
 *    - Flags accounts with zero human conversational markers (no "lol", "thanks", "yeah", "?", emojis, quotes).
 *    - Identifies uniform paragraph lengths scraped from top comments.
 * 3. Diurnal Activity & Shannon Entropy:
 *    - Measures 24-hour activity entropy H(X) and detects 24/7 continuous scripts with no human sleep lull.
 * 4. Submission Diversity & Spam Patterns:
 *    - Differentiates standard human cross-posting from automated link farms and carpet-bombing.
 * 5. Linguistic AI / Bot Notices:
 *    - Identifies bot disclaimers and synthetic LLM generation markers.
 * 6. Organic Longevity & Karma:
 *    - Credits established human lifespan and mature conversational karma.
 */

// Known boilerplate bot disclaimers & auto-moderation phrases
const BOT_DISCLAIMER_PATTERNS = [
  /i am a bot(?:,| and)? this action was performed automatically/i,
  /beep(?: |-)?boop/i,
  /beep, i'm a bot/i,
  /this is an automated (?:response|message|action)/i,
  /i'm an automated bot/i,
  /please contact the moderators of this subreddit/i,
  /action was performed automatically/i,
  /remindme!/i,
  /submission statement:/i,
  /transcription:\s*\[/i,
  /converter bot/i,
  /download link:\s*https?:\/\//i,
  /haiku bot/i,
  /gif search bot/i,
];

// Classic LLM signature intros, transitions, and hedging patterns
const LLM_PHRASES = [
  /as an ai language model/i,
  /as an ai(?:,)?/i,
  /as an artificial intelligence/i,
  /i don't have personal (?:opinions|feelings|experiences)/i,
  /certainly(?:!|,)\s+(?:here(?:'s| is)|below is)/i,
  /here are (?:a few|some) (?:key )?(?:points|things to consider|reasons|tips)/i,
  /let's break this down/i,
  /it's important to (?:note|remember|consider) that/i,
  /it is worth noting that/i,
  /in conclusion(?:,|:)?/i,
  /to summarize(?:,|:)?/i,
  /in summary(?:,|:)?/i,
  /hope this helps(?:!|\.)/i,
  /feel free to ask if you have (?:any )?(?:further )?questions/i,
  /on the one hand.*on the other hand/is,
  /while there are valid arguments on both sides/i,
];

const LLM_LEXICON = new Set([
  'delve', 'delving', 'tapestry', 'testament', 'multifaceted', 'fostering',
  'crucial', 'vital', 'landscape', 'beacon', 'paramount', 'pivotal', 'nuanced',
  'imperative', 'realm', 'intertwined', 'underscore', 'underscores', 'meticulous'
]);

// Top Viral Karma-Farming Target Subreddits frequently targeted by Repost Bots
const KARMA_FARM_SUBREDDITS = new Set([
  'aww', 'pics', 'funny', 'gifs', 'memes', 'mildlyinteresting', 'askreddit',
  'wholesomememes', 'mademesmile', 'interestingasfuck', 'damnthatsinteresting',
  'nextfuckinglevel', 'me_irl', 'meirl', 'facepalm', 'therewasanattempt',
  'rarepuppers', 'oddlysatisfying', 'gaming', 'beamazed', 'todayilearned',
  'holup', 'unexpected', 'mildlyinfuriating', 'nonononoyes', 'maybemaybemaybe',
  'animalsbeingderps', 'animalsbeingbros', 'cats', 'dogs', 'eyebleach',
  'dankmemes', 'showerthoughts', 'tifu', 'natureismetal', 'idiotsincars',
  'instant_regret', 'wtf', 'blackmagicfuckery', 'clevercomebacks', 'whitepeopletwitter'
]);

// Sentimental 1st-person OC patterns frequently stolen by Repost Bots
const STOLEN_OC_TITLE_PATTERNS = [
  /\bmy (?:late )?(?:dog|cat|puppy|kitten|grandpa|granddad|grandfather|grandma|grandmother|dad|father|mom|mother|wife|husband|son|daughter)\b/i,
  /\b(?:i (?:painted|drew|made|built|crafted|carved|knit|crocheted|baked|cooked|found|rescued|woodworked))\b/i,
  /\b(?:after \d+ (?:years|months) of (?:depression|sobriety|being sober|struggling)|finally (?:bought|got|finished|achieved|graduated))\b/i,
  /\b(?:found this (?:little )?(?:guy|fella|dude|kitten|puppy) in my (?:backyard|garden|garage|driveway|porch))\b/i,
  /\b(?:my first time (?:painting|drawing|making|trying)|thought i'd share my)\b/i
];

// Natural human conversational markers
const HUMAN_CONVERSATIONAL_TOKENS = new Set([
  'lol', 'lmao', 'haha', 'hahaha', 'thanks', 'thx', 'true', 'yeah', 'yep', 'nope',
  'same', 'ikr', 'imo', 'imho', 'tbh', 'agree', 'exactly', 'fair', 'wdym', 'nah',
  'bro', 'dude', 'mate', 'oof', 'smh', 'afaik', 'idk', 'omg', 'rip', 'congrats'
]);

const AUTO_GEN_NAME_REGEX = /^[A-Za-z]{2,18}[-_]?[A-Za-z]{2,18}[-_]?[0-9]{2,6}$/i;
const AUTO_GEN_NAME_REGEX_COMPACT = /^[A-Za-z]{2,18}[0-9]{4,7}$/;
const BOT_NAME_REGEX = /(?:^auto_|_bot$|bot$|_automod|transcriber|helperbot|bot_)/i;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u00AD\u2060]/;

/**
 * 1. Diurnal Activity & Shannon Entropy Analysis
 */
function analyzeCircadianEntropy(heatmap) {
  if (!heatmap || !Array.isArray(heatmap) || heatmap.length !== 7) {
    return {
      entropy: 3.5,
      quietest6hRatio: 0.05,
      is24x7: false,
      hasHumanSleepGap: true,
      totalItems: 0,
      detail: 'Paced activity volume'
    };
  }

  const hourTotals = Array(24).fill(0);
  let totalItems = 0;

  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 24; c++) {
      const val = heatmap[r]?.[c] || 0;
      hourTotals[c] += val;
      totalItems += val;
    }
  }

  if (totalItems < 20) {
    return {
      entropy: 3.5,
      quietest6hRatio: 0.05,
      is24x7: false,
      hasHumanSleepGap: true,
      totalItems,
      detail: 'Paced activity volume'
    };
  }

  const smoothedTotal = totalItems + 24;
  let entropy = 0;
  for (let h = 0; h < 24; h++) {
    const p = (hourTotals[h] + 1) / smoothedTotal;
    entropy -= p * Math.log2(p);
  }

  let min6hSum = Infinity;
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      sum += hourTotals[(start + i) % 24];
    }
    if (sum < min6hSum) min6hSum = sum;
  }

  const quietest6hRatio = min6hSum / totalItems;
  const is24x7 = entropy > 4.45 && quietest6hRatio > 0.14 && totalItems > 40;
  const hasHumanSleepGap = quietest6hRatio <= 0.08 || entropy <= 4.18;

  return {
    entropy: Math.round(entropy * 100) / 100,
    quietest6hRatio: Math.round(quietest6hRatio * 1000) / 10,
    is24x7,
    hasHumanSleepGap,
    totalItems,
    detail: is24x7
      ? `Entropy: ${entropy.toFixed(2)} bits (Uniform 24/7 activity without quiet periods)`
      : `Entropy: ${entropy.toFixed(2)} bits (${(quietest6hRatio * 100).toFixed(1)}% in quietest 6h lull)`
  };
}

/**
 * 2. Lexical Redundancy & Pairwise Jaccard Character 3-Gram Similarity
 */
function analyzeTextRedundancy(posts = [], comments = []) {
  const sampleTexts = [];

  for (const c of (comments || []).slice(0, 50)) {
    if (c.body && c.body.length > 25 && c.body !== '[deleted]' && c.body !== '[removed]') {
      sampleTexts.push(c.body.toLowerCase());
    }
  }
  for (const p of (posts || []).slice(0, 30)) {
    if (p.selftext && p.selftext.length > 30 && p.selftext !== '[deleted]' && p.selftext !== '[removed]') {
      sampleTexts.push(p.selftext.toLowerCase());
    }
  }

  if (sampleTexts.length < 4) {
    return {
      meanSimilarity: 0.02,
      exactDuplicates: 0,
      isHighRedundancy: false,
      detail: 'Original, non-repeating prose'
    };
  }

  const nGramSets = sampleTexts.map(text => {
    const clean = text.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');
    const set = new Set();
    for (let i = 0; i <= clean.length - 3; i++) {
      set.add(clean.slice(i, i + 3));
    }
    return set;
  });

  let totalSim = 0;
  let comparisons = 0;
  let exactDuplicates = 0;
  let highSimPairs = 0;

  for (let i = 0; i < nGramSets.length; i++) {
    for (let j = i + 1; j < nGramSets.length; j++) {
      const setA = nGramSets[i];
      const setB = nGramSets[j];
      if (setA.size === 0 || setB.size === 0) continue;

      let inter = 0;
      for (const item of setA) {
        if (setB.has(item)) inter++;
      }
      const union = setA.size + setB.size - inter;
      const jaccard = union > 0 ? inter / union : 0;

      totalSim += jaccard;
      comparisons++;

      if (jaccard >= 0.95) exactDuplicates++;
      else if (jaccard >= 0.65) highSimPairs++;
    }
  }

  const meanSimilarity = comparisons > 0 ? totalSim / comparisons : 0;
  const isHighRedundancy = exactDuplicates >= 3 || (highSimPairs >= 5 && meanSimilarity > 0.40);

  return {
    meanSimilarity: Math.round(meanSimilarity * 1000) / 10,
    exactDuplicates,
    highSimPairs,
    isHighRedundancy,
    detail: isHighRedundancy
      ? `High redundancy: ${exactDuplicates} exact / ${highSimPairs} template duplicates`
      : `${(meanSimilarity * 100).toFixed(1)}% pairwise similarity (Organic variation)`
  };
}

/**
 * 3. Submission Diversity & Cross-Posting Pattern
 */
function analyzeSubmissionDiversity(posts = [], totalComments = 0, postsPerDay = 1) {
  const titleMap = new Map();
  let duplicateSameSub = 0;
  let maxCrossPostSubs = 0;

  for (const p of (posts || [])) {
    const title = (p.title || '').trim().toLowerCase();
    const sub = (p.subreddit || '').toLowerCase();
    if (title.length > 10) {
      if (!titleMap.has(title)) {
        titleMap.set(title, new Map());
      }
      const subCounts = titleMap.get(title);
      const cur = subCounts.get(sub) || 0;
      subCounts.set(sub, cur + 1);
      if (cur >= 2) duplicateSameSub++;
    }
  }

  for (const subCounts of titleMap.values()) {
    const totalSubs = subCounts.size;
    if (totalSubs > maxCrossPostSubs) maxCrossPostSubs = totalSubs;
  }

  const isHighVolumeSubmissions = (posts?.length || 0) > 30;
  const isLowCommentRatio = totalComments < 5 && isHighVolumeSubmissions;
  
  const isCarpetSpam = (maxCrossPostSubs >= 8 && isLowCommentRatio) || (maxCrossPostSubs >= 6 && postsPerDay > 25) || duplicateSameSub >= 3;
  const isLegitCrossPost = maxCrossPostSubs >= 2 && !isCarpetSpam;

  return {
    isCarpetSpam,
    isLegitCrossPost,
    maxCrossPostSubs,
    duplicateSameSub,
    detail: isCarpetSpam
      ? `Automated carpet-bombing: identical submission pushed across ${maxCrossPostSubs} subreddits`
      : isLegitCrossPost
        ? `Cross-posting across ${maxCrossPostSubs} subreddits (Normal community sharing)`
        : 'Individual distinct submissions'
  };
}

/**
 * 4. Repost Karma-Farming Subreddit Concentration Analysis
 */
function analyzeKarmaFarmPattern(stats = {}, posts = [], comments = []) {
  const subCounts = stats?.subredditCounts || {};
  let karmaSubItems = 0;
  let totalTrackedItems = 0;

  for (const [sub, count] of Object.entries(subCounts)) {
    totalTrackedItems += count;
    if (KARMA_FARM_SUBREDDITS.has(sub.toLowerCase())) {
      karmaSubItems += count;
    }
  }

  const karmaFarmRatio = totalTrackedItems > 0 ? (karmaSubItems / totalTrackedItems) : 0;
  const postCount = posts.length || 0;
  const commentCount = comments.length || 0;

  // Stolen 1st-Person OC Titles Detection
  let stolenOcTitleCount = 0;
  for (const p of posts) {
    const title = p.title || '';
    for (const pat of STOLEN_OC_TITLE_PATTERNS) {
      if (pat.test(title)) {
        stolenOcTitleCount++;
        break;
      }
    }
  }

  // Zero-width space evasion check
  let zeroWidthEvasion = false;
  for (const p of posts) {
    if (ZERO_WIDTH_REGEX.test(p.title || '')) {
      zeroWidthEvasion = true;
      break;
    }
  }

  // A classic repost bot: >80% viral karma subs, almost all posts, 0-2 comments, or multiple 1st-person OC titles
  const isRepostFarmer = (
    (karmaFarmRatio >= 0.85 && postCount >= 6 && commentCount <= 2) ||
    (stolenOcTitleCount >= 2 && commentCount <= 2 && karmaFarmRatio >= 0.70) ||
    (zeroWidthEvasion && postCount >= 3)
  );

  return {
    karmaFarmRatio: Math.round(karmaFarmRatio * 100),
    stolenOcTitleCount,
    zeroWidthEvasion,
    isRepostFarmer,
    detail: isRepostFarmer
      ? `Karma-farming footprint: ${Math.round(karmaFarmRatio * 100)}% submissions in top viral repost hubs with near-zero comment replies`
      : `${Math.round(karmaFarmRatio * 100)}% viral hub activity (Standard mix)`
  };
}

/**
 * 5. Comment-Stealing & Conversational Naturalness Analysis
 */
function analyzeConversationalNaturalness(comments = []) {
  if (!comments || comments.length < 5) {
    return {
      isCommentStealer: false,
      conversationalDensity: 0.5,
      detail: 'Insufficient comment volume'
    };
  }

  let conversationalCount = 0;
  let totalLength = 0;
  const lengths = [];

  for (const c of comments.slice(0, 30)) {
    const body = (c.body || '').trim();
    if (!body || body === '[deleted]' || body === '[removed]') continue;

    const words = body.toLowerCase().split(/[^a-z0-9_']+/).filter(Boolean);
    lengths.push(words.length);
    totalLength += words.length;

    // Check conversational markers
    const hasToken = words.some(w => HUMAN_CONVERSATIONAL_TOKENS.has(w));
    const hasPunctuation = /[?!]/.test(body) || body.startsWith('>') || /https?:\/\//.test(body);

    if (hasToken || hasPunctuation) {
      conversationalCount++;
    }
  }

  const sampleSize = lengths.length;
  if (sampleSize < 5) {
    return { isCommentStealer: false, conversationalDensity: 0.5, detail: 'Organic replies' };
  }

  const conversationalDensity = conversationalCount / sampleSize;
  const avgWords = totalLength / sampleSize;

  // Stolen comments are almost exclusively disconnected 15-40 word paragraphs with 0 human tokens
  const isCommentStealer = conversationalDensity <= 0.05 && avgWords >= 12 && sampleSize >= 8;

  return {
    isCommentStealer,
    conversationalDensity: Math.round(conversationalDensity * 100),
    detail: isCommentStealer
      ? 'Non-conversational disconnected paragraphs (Copied top-comment signature)'
      : 'Natural human conversational replies'
  };
}

/**
 * 6. Linguistic & LLM Pattern Recognition
 */
function analyzeLinguisticPatterns(posts = [], comments = [], wordFreqs = {}) {
  let llmPhraseMatches = 0;
  let botDisclaimerMatches = 0;
  const detectedPhrases = [];

  const textSample = [];
  for (const c of (comments || []).slice(0, 50)) {
    if (c.body && c.body !== '[deleted]' && c.body !== '[removed]') textSample.push(c.body);
  }
  for (const p of (posts || []).slice(0, 30)) {
    const txt = `${p.title || ''}\n${p.selftext || ''}`.trim();
    if (txt) textSample.push(txt);
  }

  for (const text of textSample) {
    for (const pattern of BOT_DISCLAIMER_PATTERNS) {
      if (pattern.test(text)) {
        botDisclaimerMatches++;
        if (!detectedPhrases.includes('Bot disclaimer notice')) detectedPhrases.push('Bot disclaimer notice');
      }
    }
    for (const pattern of LLM_PHRASES) {
      if (pattern.test(text)) {
        llmPhraseMatches++;
        const match = text.match(pattern)?.[0];
        if (match && detectedPhrases.length < 3 && !detectedPhrases.includes(`"${match}"`)) {
          detectedPhrases.push(`"${match}"`);
        }
      }
    }
  }

  let llmWordCount = 0;
  let totalWords = 0;
  for (const type of ['posts', 'comments']) {
    const wf = wordFreqs?.[type] || {};
    for (const [w, cnt] of Object.entries(wf)) {
      const c = typeof cnt === 'object' ? (cnt.total || 0) : (cnt || 0);
      totalWords += c;
      if (LLM_LEXICON.has(w.toLowerCase())) llmWordCount += c;
    }
  }

  const llmWordDensity = totalWords > 50 ? (llmWordCount / totalWords) : 0;
  const hasLlmMarkers = llmPhraseMatches >= 2 || (llmPhraseMatches >= 1 && llmWordDensity > 0.035);

  return {
    botDisclaimerMatches,
    llmPhraseMatches,
    llmWordDensity: Math.round(llmWordDensity * 1000) / 10,
    hasLlmMarkers,
    detectedPhrases,
    detail: botDisclaimerMatches > 0
      ? 'Automated bot disclaimer detected'
      : hasLlmMarkers
        ? `AI prose markers (${detectedPhrases.join(', ')})`
        : 'Natural conversational prose'
  };
}

/**
 * Main Evaluation Engine - Smooth Probabilistic Model
 */
export function evaluateBotLikelihood({
  username = '',
  userMeta = {},
  stats = {},
  posts = [],
  comments = []
} = {}) {
  const signals = [];
  const flags = [];
  const humanTrustFactors = [];

  const totalPosts = userMeta?.num_posts ?? posts.length ?? 0;
  const totalComments = userMeta?.num_comments ?? comments.length ?? 0;
  const totalItems = totalPosts + totalComments;
  const totalKarma = userMeta?.total_karma ?? 0;

  const earliest = userMeta?.earliest_post_at || userMeta?.earliest_comment_at;
  const nowSec = Date.now() / 1000;
  const daysActive = earliest ? Math.max(1, Math.floor((nowSec - earliest) / 86400)) : 30;
  const postsPerDay = totalItems / daysActive;

  // Log-odds accumulator for logistic probability calculation
  let logOdds = -2.8; // Baseline prior: random Reddit account has low bot prior (~5%)

  // 1. Circadian Entropy Signal
  const circadian = analyzeCircadianEntropy(stats?.heatmap);
  if (circadian.is24x7) {
    logOdds += 3.2;
    flags.push('24/7 automated activity: continuous hourly posting without circadian sleep troughs');
    signals.push({
      id: 'circadian',
      label: 'Activity Distribution',
      value: '24/7 Uniform (No Sleep)',
      status: 'bot',
      detail: circadian.detail,
    });
  } else if (circadian.hasHumanSleepGap) {
    logOdds -= 1.2;
    humanTrustFactors.push(`Verified Circadian Sleep Lull (${circadian.quietest6hRatio}% in quietest 6h)`);
    signals.push({
      id: 'circadian',
      label: 'Activity Distribution',
      value: 'Circadian Sleep Cycle',
      status: 'human',
      detail: circadian.detail,
    });
  } else {
    signals.push({
      id: 'circadian',
      label: 'Activity Distribution',
      value: 'Standard Schedule',
      status: 'neutral',
      detail: circadian.detail,
    });
  }

  // 2. Lexical Redundancy Signal
  const redundancy = analyzeTextRedundancy(posts, comments);
  if (redundancy.isHighRedundancy) {
    logOdds += 2.8;
    flags.push('High text repetition: repetitive template copying across separate threads');
    signals.push({
      id: 'redundancy',
      label: 'Content Redundancy',
      value: `${redundancy.meanSimilarity}% Similar (Template Pattern)`,
      status: 'bot',
      detail: redundancy.detail,
    });
  } else {
    logOdds -= 0.8;
    if (totalItems >= 10) {
      humanTrustFactors.push(`Organic prose variation (${redundancy.meanSimilarity}% pairwise similarity)`);
    }
    signals.push({
      id: 'redundancy',
      label: 'Content Originality',
      value: `${redundancy.meanSimilarity}% Similarity (Unique)`,
      status: 'human',
      detail: redundancy.detail,
    });
  }

  // 3. Submission Diversity Signal
  const diversity = analyzeSubmissionDiversity(posts, totalComments, postsPerDay);
  if (diversity.isCarpetSpam) {
    logOdds += 2.6;
    flags.push(`Carpet-bomb spamming: duplicate submissions across ${diversity.maxCrossPostSubs} subreddits`);
    signals.push({
      id: 'diversity',
      label: 'Submission Pattern',
      value: 'Carpet-Bombing Spam',
      status: 'bot',
      detail: diversity.detail,
    });
  } else if (diversity.isLegitCrossPost) {
    signals.push({
      id: 'diversity',
      label: 'Submission Pattern',
      value: `Cross-Posting (${diversity.maxCrossPostSubs} subs)`,
      status: 'human',
      detail: diversity.detail,
    });
  } else {
    signals.push({
      id: 'diversity',
      label: 'Submission Pattern',
      value: 'Original Submissions',
      status: 'human',
      detail: diversity.detail,
    });
  }

  // 4. Repost Karma-Farming & Stolen OC Pattern
  const karmaFarm = analyzeKarmaFarmPattern(stats, posts, comments);
  if (karmaFarm.isRepostFarmer) {
    const repostWeight = karmaFarm.zeroWidthEvasion ? 4.5 : (karmaFarm.stolenOcTitleCount >= 2 ? 3.8 : 3.0);
    logOdds += repostWeight;
    flags.push(`Karma-farming repost bot: ${karmaFarm.karmaFarmRatio}% submissions targeting default viral hubs with zero community engagement`);
    if (karmaFarm.zeroWidthEvasion) {
      flags.push('Zero-width character evasion: hidden Unicode spaces in titles to bypass duplicate detection');
    }
    signals.push({
      id: 'karmaFarm',
      label: 'Community Footprint',
      value: 'Karma-Farm Repost Signature',
      status: 'bot',
      detail: karmaFarm.detail,
    });
  } else if (karmaFarm.karmaFarmRatio <= 40 && totalItems >= 10) {
    logOdds -= 0.8;
    humanTrustFactors.push(`Diverse community engagement (${100 - karmaFarm.karmaFarmRatio}% niche subreddits)`);
    signals.push({
      id: 'karmaFarm',
      label: 'Community Footprint',
      value: 'Diverse Niche Communities',
      status: 'human',
      detail: karmaFarm.detail,
    });
  }

  // 5. Comment-Stealing & Conversational Naturalness
  const conversation = analyzeConversationalNaturalness(comments);
  if (conversation.isCommentStealer) {
    logOdds += 3.2;
    flags.push('Comment-stealing signature: disconnected paragraphs with zero conversational acknowledgments');
    signals.push({
      id: 'conversation',
      label: 'Conversational Style',
      value: 'Copied Top-Comment Signature',
      status: 'bot',
      detail: conversation.detail,
    });
  }

  // 6. Linguistic Style Signal
  const linguistic = analyzeLinguisticPatterns(posts, comments, stats?.wordFreqs);
  const isExplicitBotName = BOT_NAME_REGEX.test(username);

  if (linguistic.botDisclaimerMatches > 0 || isExplicitBotName) {
    logOdds += 5.0;
    flags.push(isExplicitBotName ? 'Explicit bot naming convention' : 'Automated bot disclaimer detected in message body');
    signals.push({
      id: 'linguistic',
      label: 'Linguistic Notice',
      value: isExplicitBotName ? 'Bot Handle Match' : 'Bot Disclaimer Found',
      status: 'bot',
      detail: linguistic.detail,
    });
  } else if (linguistic.hasLlmMarkers) {
    const llmWeight = linguistic.llmPhraseMatches >= 2 ? 3.6 : 2.2;
    logOdds += llmWeight;
    flags.push('Synthetic / LLM phrasing markers detected in responses');
    signals.push({
      id: 'linguistic',
      label: 'Linguistic Style',
      value: linguistic.llmPhraseMatches >= 2 ? 'Synthetic AI Phrasing' : 'LLM Phrasing Markers',
      status: linguistic.llmPhraseMatches >= 2 ? 'bot' : 'warning',
      detail: linguistic.detail,
    });
  } else {
    logOdds -= 0.6;
    signals.push({
      id: 'linguistic',
      label: 'Linguistic Style',
      value: 'Organic Conversational',
      status: 'human',
      detail: linguistic.detail,
    });
  }

  // 7. Compound Auto-Generated Username Risk
  const isAutoGenName = AUTO_GEN_NAME_REGEX.test(username) || AUTO_GEN_NAME_REGEX_COMPACT.test(username);
  if (isAutoGenName && (karmaFarm.isRepostFarmer || circadian.is24x7)) {
    logOdds += 2.0;
    flags.push('Compound risk: Auto-generated Reddit handle operating in automated repost farm');
  }

  // 8. Interaction Depth (Comments vs Submissions)
  const commentRatio = totalItems > 0 ? (totalComments / totalItems) : 0.5;
  if (totalItems >= 15 && totalComments === 0 && totalPosts >= 15) {
    logOdds += 2.2;
    flags.push('One-way submission bot: 100% link/post submissions with 0 comment engagement');
    signals.push({
      id: 'interaction',
      label: 'Interaction Balance',
      value: '100% Post Submissions',
      status: 'warning',
      detail: 'Pure one-way link broadcasting without conversational replies',
    });
  } else if (commentRatio >= 0.25) {
    logOdds -= 1.0;
    humanTrustFactors.push(`Active conversational interaction (${Math.round(commentRatio * 100)}% comments)`);
    signals.push({
      id: 'interaction',
      label: 'Interaction Balance',
      value: `${Math.round(commentRatio * 100)}% Comments / ${Math.round((1 - commentRatio) * 100)}% Posts`,
      status: 'human',
      detail: 'Healthy conversational engagement',
    });
  } else {
    signals.push({
      id: 'interaction',
      label: 'Interaction Balance',
      value: `${Math.round(commentRatio * 100)}% Comments / ${Math.round((1 - commentRatio) * 100)}% Posts`,
      status: 'neutral',
      detail: 'Predominantly submission-focused activity',
    });
  }

  // 9. Activity Velocity Cadence
  if (postsPerDay > 45 && totalItems > 80) {
    logOdds += 2.2;
    flags.push(`Extreme velocity: ${postsPerDay.toFixed(1)} items/day`);
    signals.push({
      id: 'velocity',
      label: 'Posting Velocity',
      value: `${postsPerDay.toFixed(1)} items / day (Extreme)`,
      status: 'bot',
      detail: 'Inhuman volume of continuous daily submissions',
    });
  } else {
    logOdds -= 0.6;
    signals.push({
      id: 'velocity',
      label: 'Posting Velocity',
      value: `${postsPerDay.toFixed(1)} items / day`,
      status: 'human',
      detail: 'Normal human activity pace',
    });
  }

  // 10. Longevity & Organic Karma
  if (totalKarma > 10000 && daysActive > 180 && !karmaFarm.isRepostFarmer) {
    logOdds -= 1.4;
    humanTrustFactors.push(`Established account longevity (${totalKarma.toLocaleString()} organic karma)`);
  } else if (totalKarma > 2000 && daysActive > 60 && !karmaFarm.isRepostFarmer) {
    logOdds -= 0.7;
    humanTrustFactors.push(`Verified karma accumulation (${totalKarma.toLocaleString()} karma)`);
  }

  // Logistic Sigmoid Mapping: P(bot) in [1%, 99%]
  const rawProb = 100 / (1 + Math.exp(-logOdds));
  let finalScore = Math.min(99, Math.max(1, Math.round(rawProb)));

  let verdict = 'Likely Human';
  let riskLevel = 'low';

  if (finalScore >= 70) {
    verdict = 'Likely Automated Bot';
    riskLevel = 'high';
  } else if (finalScore >= 35) {
    verdict = 'Moderate / Mixed Signals';
    riskLevel = 'medium';
  } else if (finalScore >= 15) {
    verdict = 'Low Bot Risk';
    riskLevel = 'low';
  } else {
    verdict = 'Very Likely Human';
    riskLevel = 'low';
  }

  return {
    score: finalScore,
    verdict,
    riskLevel,
    signals,
    flags,
    humanTrustFactors,
    metrics: {
      entropy: circadian.entropy,
      postsPerDay: postsPerDay.toFixed(1),
      daysActive,
      totalItems,
      totalKarma,
      is24x7: circadian.is24x7,
      meanSimilarity: redundancy.meanSimilarity,
      karmaFarmRatio: karmaFarm.karmaFarmRatio,
    }
  };
}
