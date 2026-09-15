/** Context & stance-aware political position evaluation. */
import { SUBREDDIT_POLITICAL_MAP } from "./map.js";
import { PROPOSITION_PATTERNS, DISAGREEMENT_WORDS } from "./patterns.js";

export function sanitizeTextForPoliticalAnalysis(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText;
  text = text.replace(/^[ \t]*>.*$/gm, ' ');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ');
  text = text.replace(/https?:\/\/\S+/gi, ' ');
  text = text.replace(/(?:\/?r\/|\/?u\/)[A-Za-z0-9_]+/gi, ' ');
  text = text.replace(/\btraditional\s+(?:chinese|japanese|korean|art|drawing|painting|animation|media|food|recipe|dress|garb|instrument|music|dance|craft|tattoo|medicine)\b/gi, ' ');
  return text;
}

export function getIdeologicalArchetype(econ, gov, { hasLeftSignals = false, hasRightSignals = false } = {}) {
  // Quadrant is econ × gov to match the plotted grid (x=econ, y=gov) and the
  // AI prompt contract. Thresholds ±2.2 shared with getQuadrantArchetype.
  const isEconCenter = Math.abs(econ) <= 2.2;
  const isGovCenter = Math.abs(gov) <= 2.2;

  if (isEconCenter && isGovCenter) {
    if (hasLeftSignals && hasRightSignals) return 'Cross-Ideological / Mixed Discussion';
    return 'Centrist / Moderate';
  }
  if (isEconCenter && gov > 2.2) return 'Authoritarian Center (Auth-Center)';
  if (isEconCenter && gov < -2.2) return 'Libertarian Center (Lib-Center)';

  if (econ < -2.2 && isGovCenter) return 'Left-Center (Social Democrat / Left)';
  if (econ > 2.2 && isGovCenter) return 'Right-Center (Fiscal Conservative / Center-Right)';

  if (econ < -2.2 && gov > 2.2) return 'Authoritarian Left (Auth-Left)';
  if (econ > 2.2 && gov > 2.2) return 'Authoritarian Right (Auth-Right)';
  if (econ < -2.2 && gov < -2.2) return 'Libertarian Left (Lib-Left)';
  if (econ > 2.2 && gov < -2.2) return 'Libertarian Right (Lib-Right)';

  return 'Centrist / Moderate';
}

export function getDimensionLabels(econ, soc, gov) {
  const econLabel = econ <= -6.0 ? "Socialist / Democratic Left" : econ <= -2.0 ? "Social Market / Mixed Left" : econ <= 2.0 ? "Centrist / Mixed Economy" : econ <= 6.0 ? "Fiscal Conservative / Pro-Market" : "Laissez-Faire Free Market";
  const socLabel = soc <= -4.0 ? "Progressive / Secular" : soc <= 2.0 ? "Pluralist / Moderate" : "Traditional / Social Conservative";
  const govLabel = gov <= -4.0 ? "Civil Libertarian / Anti-Authoritarian" : gov <= 2.0 ? "Balanced Governance" : "Statist / Law & Order";

  return { econLabel, socLabel, govLabel };
}

export function isSarcastic(rawText, snippet) {
  if (!rawText && !snippet) return false;
  const combined = `${rawText} ${snippet}`;

  // Explicit /s or /Sarcasm or (sarcasm)
  if (/(?:^|\s)\/s(?:arcasm)?(?:\s|$|[.!?,;])/i.test(combined)) return true;
  if (/\((?:sarcasm|\?!)\)/i.test(combined) || /\?!\?/i.test(combined)) return true;

  // Mocking alternating caps (e.g. "tOtAlLy gEnIuS")
  if (/(?:[a-z][A-Z][a-z][A-Z]|[A-Z][a-z][A-Z][a-z]){2,}/.test(combined)) return true;

  // Sarcastic rhetorical phrases with quotes/exclamation
  if (/\b(?:yeah right|oh sure|surely|totally|obviously|what could possibly go wrong|because that always works)\b/i.test(combined) && (/[!"]/.test(combined) || combined.toLowerCase().includes("genius"))) return true;

  return false;
}

/**
 * Main Political Compass & Propositional Stance Evaluation
 */
export function evaluatePoliticalCompass({ stats = {}, posts = [], comments = [] } = {}) {
  const cacheKey = buildCompassCacheKey(stats, posts, comments);
  const hit = compassCache.get(cacheKey);
  if (hit) return hit;
  const result = evaluatePoliticalCompassUncached({ stats, posts, comments });
  compassCache.set(cacheKey, result);
  if (compassCache.size > 30) {
    const oldest = compassCache.keys().next().value;
    compassCache.delete(oldest);
  }
  return result;
}

// Per-dataset cache keyed by item identity + subreddit counts. The local
// compass engine scans every body against dozens of proposition patterns
// (O(items × patterns)), so re-running it on every parent render (crawl
// ticks, keyword typing) is wasted work when the underlying ids are unchanged.
const compassCache = new Map();

function hashCompassIds(items) {
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

function buildCompassCacheKey(stats, posts, comments) {
  const subCounts = stats?.subredditCounts || {};
  const subKeys = Object.keys(subCounts).sort();
  let h = 0;
  for (const k of subKeys) {
    const c = subCounts[k] | 0;
    for (let j = 0; j < k.length; j++) h = (Math.imul(h, 31) + k.charCodeAt(j)) | 0;
    h = (Math.imul(h, 31) + c) | 0;
  }
  return `subs${subKeys.length}:${(h >>> 0).toString(36)}|p${posts?.length || 0}:${hashCompassIds(posts)}|c${comments?.length || 0}:${hashCompassIds(comments)}`;
}

function evaluatePoliticalCompassUncached({ stats = {}, posts = [], comments = [] } = {}) {
  let totalWeight = 0;
  let weightedEcon = 0;
  let weightedSoc = 0;
  let weightedGov = 0;

  const topSubSignals = [];
  const detectedPositions = [];
  const matchedTopicSet = new Set();

  const subCounts = stats?.subredditCounts || {};

  // 1. Stance-Aware Subreddit Context & Interaction Tone
  // Group user comments by subreddit to check if they were in agreement or debating
  const subCommentMap = new Map();
  const seenBodies = new Set();
  const pushUnique = (sub, body) => {
    const key = `${sub}::${(body || '').slice(0, 200)}`;
    if (seenBodies.has(key)) return;
    seenBodies.add(key);
    if (!subCommentMap.has(sub)) subCommentMap.set(sub, []);
    subCommentMap.get(sub).push(body || '');
  };
  for (const c of (comments || [])) {
    const sub = (c.subreddit || '').toLowerCase();
    pushUnique(sub, c.body || '');
  }
  for (const p of (posts || [])) {
    const sub = (p.subreddit || '').toLowerCase();
    pushUnique(sub, p.selftext || p.title || '');
  }
  for (const item of (stats?.sampleItems || [])) {
    const sub = (item.subreddit || '').toLowerCase();
    pushUnique(sub, item.body || '');
  }

  let leftSignalWeight = 0;
  let rightSignalWeight = 0;

  for (const [subName, count] of Object.entries(subCounts)) {
    const lower = subName.toLowerCase();
    let entry = SUBREDDIT_POLITICAL_MAP[lower];

    if (!entry) {
      const isAntiSub = /(?:anti|fuck|against|virus|666|gret|watch|impeach|exposed|critic|cult|hate)/i.test(lower);
      if (lower.includes('conserv') && !isAntiSub) entry = { econ: 6.5, soc: 5.5, gov: 5.0, weight: 0.8, side: 'right' };
      else if ((lower.includes('republican') || lower.includes('trump') || lower.includes('maga')) && !isAntiSub) entry = { econ: 7.0, soc: 6.5, gov: 6.0, weight: 0.85, side: 'right' };
      else if (isAntiSub && (lower.includes('trump') || lower.includes('maga') || lower.includes('altright') || lower.includes('nazi') || lower.includes('conserv'))) entry = { econ: -5.0, soc: -6.0, gov: -5.0, weight: 0.8, side: 'left' };
      else if (lower.includes('socialis') || lower.includes('communis') || lower.includes('marx')) entry = { econ: -8.0, soc: 2.0, gov: 4.0, weight: 0.85, side: 'left' };
      else if (lower.includes('anarch')) entry = { econ: -7.5, soc: -8.5, gov: -9.0, weight: 0.85, side: 'left' };
      else if (lower.includes('libertarian')) entry = { econ: 7.0, soc: -3.5, gov: -8.0, weight: 0.85, side: 'right' };
      else if (lower.includes('democrat') || lower.includes('liberal') || lower.includes('progressive')) entry = { econ: -5.0, soc: -5.5, gov: -4.5, weight: 0.8, side: 'left' };
      else if (lower.includes('atheis')) entry = { econ: -3.5, soc: -7.5, gov: -6.0, weight: 0.8, side: 'left' };
    }

    if (entry) {
      // Analyze user's tone inside this specific subreddit
      const userSubTexts = (subCommentMap.get(lower) || []).join(' ').toLowerCase();
      const wordsInSub = userSubTexts.split(/[^a-z0-9_-]+/);
      let disagreeCount = 0;
      for (const w of wordsInSub) {
        if (DISAGREEMENT_WORDS.has(w)) disagreeCount++;
      }

      // Only tag if user was engaged in oppositional debate / argument
      let effectiveEcon = entry.econ;
      let effectiveSoc = entry.soc;
      let effectiveGov = entry.gov ?? entry.soc;
      let interactionTag = null;

      if (disagreeCount >= 2 && userSubTexts.length > 40) {
        // Invert polarity: user is debating against the subreddit's ideology
        if (entry.side === 'right') {
          effectiveEcon = -5.0;
          effectiveSoc = -5.0;
          effectiveGov = -4.0;
          interactionTag = "Debating";
        } else if (entry.side === 'left') {
          effectiveEcon = 5.0;
          effectiveSoc = 4.0;
          effectiveGov = 3.0;
          interactionTag = "Debating";
        }
      }

      // Pre-existing standard: Log-frequency community weighting (Waller & Anderson, ACM WWW '24)
      const effectiveWeight = Math.log1p(count) * entry.weight;
      weightedEcon += effectiveEcon * effectiveWeight;
      weightedSoc += effectiveSoc * effectiveWeight;
      weightedGov += effectiveGov * effectiveWeight;
      totalWeight += effectiveWeight;

      if (effectiveEcon <= -2.0 || effectiveSoc <= -2.0) leftSignalWeight += effectiveWeight;
      if (effectiveEcon >= 2.0 || effectiveSoc >= 2.0) rightSignalWeight += effectiveWeight;

      topSubSignals.push({
        sub: subName,
        count,
        econ: effectiveEcon,
        soc: effectiveSoc,
        interactionTag,
        weight: effectiveWeight,
      });
    }
  }

  // 2. Propositional Stance & Viewpoint Extraction from Comments & Posts
  // Pool active items + all background crawled sample items, deduped by id/body
  // (sampleItems already contains these bodies — naive concat double-counts).
  const seenStanceKeys = new Set();
  const sampleItems = [];
  for (const item of [...(comments || []), ...(posts || []), ...(stats?.sampleItems || [])]) {
    const raw = item.body || item.title || item.selftext || '';
    const key = item.id ? `id:${item.id}` : `b:${(item.subreddit || '')}::${raw.slice(0, 200)}`;
    if (seenStanceKeys.has(key)) continue;
    seenStanceKeys.add(key);
    sampleItems.push(item);
  }

  for (const item of sampleItems) {
    const rawText = item.body || item.title || item.selftext || '';
    if (!rawText || rawText === '[deleted]' || rawText === '[removed]') continue;
    const text = sanitizeTextForPoliticalAnalysis(rawText);

    // Test each Propositional Stance Pattern
    for (const prop of PROPOSITION_PATTERNS) {
      const match = text.match(prop.pattern);
      if (match && match.index != null) {
        const start = Math.max(0, match.index - 70);
        const end = Math.min(text.length, match.index + match[0].length + 70);
        const snippet = text.slice(start, end).trim();

        // Check Sarcasm
        const sarcastic = isSarcastic(rawText, snippet);

        let effectiveEcon = prop.econ ?? 0;
        let effectiveSoc = prop.soc ?? 0;
        let effectiveGov = prop.gov ?? prop.soc ?? 0;
        let effectiveStance = prop.stance;
        let effectivePolarity = prop.polarity;

        if (sarcastic) {
          // Invert coords AND label: "Opposes X (Sarcastic)" with flipped
          // coords would otherwise read as far-right while saying Opposes.
          effectiveEcon = -(prop.econ ?? 0);
          effectiveSoc = -(prop.soc ?? 0);
          effectiveGov = -((prop.gov ?? prop.soc) ?? 0);
          let s = prop.stance;
          if (/^\s*Opposes\b/i.test(s)) s = s.replace(/^\s*Opposes\b/i, "Supports");
          else if (/^\s*Critical of\b/i.test(s)) s = s.replace(/^\s*Critical of\b/i, "Supports");
          else if (/^\s*Supports\b/i.test(s)) s = s.replace(/^\s*Supports\b/i, "Critical of");
          else if (/Pro-Choice/i.test(s)) s = s.replace(/Pro-Choice/i, "Pro-Life");
          else if (/Pro-Life/i.test(s)) s = s.replace(/Pro-Life/i, "Pro-Choice");
          else if (/Strong\s+Support/i.test(s)) s = s.replace(/Strong\s+Support.*?for/i, "Critical of");
          effectivePolarity = "Opposition (Sarcastic)";
          effectiveStance = `${s} (Sarcastic — interpreted as opposite)`;
        }

        const w = 4.0; // High confidence propositional assertion
        weightedEcon += effectiveEcon * w;
        weightedSoc += effectiveSoc * w;
        weightedGov += effectiveGov * w;
        totalWeight += w;

        if (effectiveEcon <= -2.0 || effectiveSoc <= -2.0) leftSignalWeight += w;
        if (effectiveEcon >= 2.0 || effectiveSoc >= 2.0) rightSignalWeight += w;

        if (!matchedTopicSet.has(prop.topic)) {
          matchedTopicSet.add(prop.topic);
          detectedPositions.push({
            topic: prop.topic,
            stance: effectiveStance,
            polarity: effectivePolarity,
            keyword: prop.searchKw,
            snippet: snippet.length > 90 ? `"...${snippet}..."` : `"${snippet}"`,
            econ: effectiveEcon,
            soc: effectiveSoc
          });
        }
      }
    }
  }

  // 3. Minimum Signal Threshold Calibration
  const hasRealSignal = totalWeight >= 2.5 || detectedPositions.length > 0;

  let econ = 0;
  let soc = 0;
  let gov = 0;
  let confidence = 'Low (Few political markers)';
  let archetype = 'Undetermined / Non-Political Activity';

  if (hasRealSignal && totalWeight > 0) {
    econ = Math.max(-10, Math.min(10, Math.round((weightedEcon / totalWeight) * 10) / 10));
    soc = Math.max(-10, Math.min(10, Math.round((weightedSoc / totalWeight) * 10) / 10));
    gov = Math.max(-10, Math.min(10, Math.round((weightedGov / totalWeight) * 10) / 10));

    if (detectedPositions.length >= 2) confidence = 'High (Multiple verified policy stances)';
    else if (detectedPositions.length === 1 && totalWeight >= 6) confidence = 'Moderate (Policy stance + community footprint)';
    else if (detectedPositions.length === 1) confidence = 'Moderate (Corroborating position statement)';
    else if (totalWeight >= 10) confidence = 'Moderate (Community participation footprint)';
    else confidence = 'Low (Emerging community activity)';

    archetype = getIdeologicalArchetype(econ, gov, {
      hasLeftSignals: leftSignalWeight >= 2.0,
      hasRightSignals: rightSignalWeight >= 2.0,
    });
  }

  const { econLabel, socLabel, govLabel } = getDimensionLabels(econ, soc, gov);

  return {
    econ,
    soc,
    gov,
    hasSignal: hasRealSignal,
    archetype,
    confidence,
    dimensions: {
      econ: { score: econ, label: hasRealSignal ? econLabel : "Non-Political" },
      soc: { score: soc, label: hasRealSignal ? socLabel : "Non-Political" },
      gov: { score: gov, label: hasRealSignal ? govLabel : "Non-Political" },
    },
    detectedPositions,
    topSubSignals: topSubSignals.sort((a, b) => b.weight - a.weight).slice(0, 6),
  };
}
