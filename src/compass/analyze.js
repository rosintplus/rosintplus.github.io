/**
 * Political position evaluation.
 *
 * Two *independent* estimators run over the same account and are combined
 * meta-analytically:
 *
 *   1. Text side — Laver & Garry (2000) pro/con balance over a dictionary of
 *      political categories (see dictionary.js / textscore.js). Positions are
 *      the relative balance of text units coding each pole of a dimension,
 *      bounded in ±10 by construction, with a binomial standard error.
 *
 *   2. Community side — ideal-point estimation (Poole & Rosenthal 1985;
 *      Barberá 2015) over the participation distribution across subreddits of
 *      known position (see community.js). Also yields a standard error.
 *
 * The two are combined by inverse-variance weighting (Cochran; Hedges &
 * Olkin), the standard way to pool independent estimates of one quantity.
 * Every reported score therefore travels with an uncertainty, and the
 * *label* for a dimension is withheld whenever the 95% confidence interval
 * includes zero. A thin or contradictory history reads as "centre /
 * uncertain" instead of landing on an extreme — you cannot be extreme and
 * uncertain at the same time.
 *
 * Heuristics (negation scope, arguing-against-a-community, sarcasm markers)
 * only ever damp or discount evidence. They never flip a sign. A heuristic
 * able to invert an answer is a heuristic that produces nonsense answers.
 */

import { scoreText, politicalText } from "./textscore.js";
import { estimateFromCommunities } from "./community.js";
import { CATEGORIES } from "./dictionary.js";

// ─── Tunables ────────────────────────────────────────────────────────────────

// A reading requires at least this much pooled evidence mass before any
// position is reported at all.
const MIN_TOTAL_EVIDENCE = 6;

// The 95% confidence interval is estimate ± 1.96 SE. If it contains zero,
// the dimension is reported as centre / uncertain.
const Z95 = 1.96;

// Quadrant hysteresis. A label must be this far from the centre to *enter* a
// quadrant, and stays put until the reading falls back inside EXIT. Without
// this a borderline account flip-flops between labels as items trickle in.
const ENTER = 2.8;
const EXIT = 1.6;

// ─── Quadrants ──────────────────────────────────────────────────────────────

const QUADRANT_LABELS = {
  "auth-left": "Authoritarian Left (Auth-Left)",
  "auth-right": "Authoritarian Right (Auth-Right)",
  "auth-center": "Authoritarian Center (Auth-Center)",
  "lib-left": "Libertarian Left (Lib-Left)",
  "lib-right": "Libertarian Right (Lib-Right)",
  "lib-center": "Libertarian Center (Lib-Center)",
  "left-center": "Left-Center (Social Democrat / Left)",
  "right-center": "Right-Center (Fiscal Conservative / Center-Right)",
  center: "Centrist / Moderate",
};

// i18n keys mirroring QUADRANT_LABELS plus the cross-ideological label.
// English strings stay verbatim above; labelKey travels alongside label.
export const QUADRANT_LABEL_KEYS = {
  "auth-left": "compassQuadAuthLeft",
  "auth-right": "compassQuadAuthRight",
  "auth-center": "compassQuadAuthCenter",
  "lib-left": "compassQuadLibLeft",
  "lib-right": "compassQuadLibRight",
  "lib-center": "compassQuadLibCenter",
  "left-center": "compassQuadLeftCenter",
  "right-center": "compassQuadRightCenter",
  center: "compassQuadCenter",
  cross: "compassQuadCross",
};

/**
 * Classify a (econ, gov) reading into one of nine quadrants.
 *
 * When `prevQuadrant` is supplied the result is hysteretic: the previous
 * quadrant is retained until the reading clearly leaves it, so a borderline
 * account keeps a stable label instead of oscillating.
 *
 * @returns {{quadrant: string, label: string, labelKey: string, held: boolean}}
 */
export function classifyQuadrant(econ, gov, { prevQuadrant = null, hasLeftSignals = false, hasRightSignals = false } = {}) {
  const inQuadrant = (q) => {
    switch (q) {
      case "auth-left": return econ < -EXIT && gov > EXIT;
      case "auth-right": return econ > EXIT && gov > EXIT;
      case "lib-left": return econ < -EXIT && gov < -EXIT;
      case "lib-right": return econ > EXIT && gov < -EXIT;
      case "auth-center": return Math.abs(econ) <= EXIT && gov > EXIT;
      case "lib-center": return Math.abs(econ) <= EXIT && gov < -EXIT;
      case "left-center": return econ < -EXIT && Math.abs(gov) <= EXIT;
      case "right-center": return econ > EXIT && Math.abs(gov) <= EXIT;
      case "center": return Math.abs(econ) <= EXIT && Math.abs(gov) <= EXIT;
      default: return false;
    }
  };

  const fresh = () => {
    const eOut = Math.abs(econ) > ENTER;
    const gOut = Math.abs(gov) > ENTER;
    if (eOut && gOut) {
      if (econ < 0) return gov > 0 ? "auth-left" : "lib-left";
      return gov > 0 ? "auth-right" : "lib-right";
    }
    if (gOut) return gov > 0 ? "auth-center" : "lib-center";
    if (eOut) return econ < 0 ? "left-center" : "right-center";
    if (hasLeftSignals && hasRightSignals) return "cross";
    return "center";
  };

  if (prevQuadrant && prevQuadrant !== "cross" && inQuadrant(prevQuadrant)) {
    return { quadrant: prevQuadrant, label: QUADRANT_LABELS[prevQuadrant] || QUADRANT_LABELS.center, labelKey: QUADRANT_LABEL_KEYS[prevQuadrant] || QUADRANT_LABEL_KEYS.center, held: true };
  }
  const quadrant = fresh();
  if (quadrant === "cross") {
    return { quadrant, label: "Cross-Ideological / Mixed Discussion", labelKey: QUADRANT_LABEL_KEYS.cross, held: false };
  }
  return { quadrant, label: QUADRANT_LABELS[quadrant] || QUADRANT_LABELS.center, labelKey: QUADRANT_LABEL_KEYS[quadrant] || QUADRANT_LABEL_KEYS.center, held: false };
}

/** Legacy string-only entry point (no hysteresis). */
export function getIdeologicalArchetype(econ, gov, opts = {}) {
  return classifyQuadrant(econ, gov, opts).label;
}

export function getDimensionLabels(econ, soc, gov) {
  const econLabel = econ <= -6.0 ? "Socialist / Democratic Left" : econ <= -2.0 ? "Social Market / Mixed Left" : econ <= 2.0 ? "Centrist / Mixed Economy" : econ <= 6.0 ? "Fiscal Conservative / Pro-Market" : "Laissez-Faire Free Market";
  const socLabel = soc <= -4.0 ? "Progressive / Secular" : soc <= 2.0 ? "Pluralist / Moderate" : "Traditional / Social Conservative";
  const govLabel = gov <= -4.0 ? "Civil Libertarian / Anti-Authoritarian" : gov <= 2.0 ? "Balanced Governance" : "Statist / Law & Order";
  return { econLabel, socLabel, govLabel };
}

// Key-returning parallel to getDimensionLabels — thresholds mirror it exactly.
export function getDimensionLabelKeys(econ, soc, gov) {
  const econKey = econ <= -6.0 ? "compassEconSocialist" : econ <= -2.0 ? "compassEconMixedLeft" : econ <= 2.0 ? "compassEconCentrist" : econ <= 6.0 ? "compassEconProMarket" : "compassEconLaissez";
  const socKey = soc <= -4.0 ? "compassSocProgressive" : soc <= 2.0 ? "compassSocModerate" : "compassSocTraditional";
  const govKey = gov <= -4.0 ? "compassGovLibertarian" : gov <= 2.0 ? "compassGovBalanced" : "compassGovStatist";
  return { econKey, socKey, govKey };
}

// ─── Item pooling (dedupe) ──────────────────────────────────────────────────
//
/**
 * Pool items from the three sources without double-counting.
 *
 * Items reach the engine from the active search results and the background
 * crawl (both carry an id) and from `stats.sampleItems` (built by
 * processItem(), which retains both the id and kind). Samples with IDs are
 * pooled by identity; legacy samples without IDs are pooled by full content.
 * Distinct items stay distinct even when they happen to share text.
 *
 * The correct rule: the id-bearing streams are the authority and are pooled
 * by kind and id. A sample is admitted only if its identity (or, for a legacy
 * sample, its content) is not already represented.
 */
function contentKey(item) {
  const raw = politicalText(item);
  const sub = (item?.subreddit || "").toLowerCase();
  return JSON.stringify([sub, raw]);
}

function identityKey(item, kind) {
  return item?.id ? `${kind || item.kind || (item.body ? "t1" : "t3")}:${item.id}` : null;
}

function poolItems(stats, posts, comments) {
  const out = [];
  const seenIds = new Set();
  const seenContent = new Set();

  const push = (item, kind) => {
    out.push(item);
    const id = identityKey(item, kind);
    if (id) seenIds.add(id);
    seenContent.add(contentKey(item));
  };

  for (const [kind, list] of [["t1", comments || []], ["t3", posts || []]]) {
    for (const item of list) {
      if (!item) continue;
      if (item.id) {
        const id = identityKey(item, kind);
        if (seenIds.has(id)) continue;
      } else if (seenContent.has(contentKey(item))) {
        continue;
      }
      push(item, kind);
    }
  }

  for (const item of stats?.sampleItems || []) {
    if (!item) continue;
    const id = identityKey(item);
    if (id ? seenIds.has(id) : seenContent.has(contentKey(item))) continue;
    push(item);
  }

  return out;
}

// ─── Cache ──────────────────────────────────────────────────────────────────
//
// The engine runs on every crawl flush and on every parent re-render, so
// results are memoised. The key must cover *everything the engine reads*:
// item identity AND item content, plus the subreddit counts and the
// sampleItems the crawl feeds in. A key that omits sampleItems returns a
// stale reading when only those change.

const compassCache = new Map();
const COMPASS_CACHE_MAX = 30;

function hashStrings(parts) {
  let h = 0;
  h = (Math.imul(h, 31) + parts.length) | 0;
  for (const s of parts) {
    for (let j = 0; j < s.length; j++) h = (Math.imul(h, 31) + s.charCodeAt(j)) | 0;
    h = (Math.imul(h, 31) + 0x9e3779b9) | 0;
  }
  return (h >>> 0).toString(36);
}

// Bounded per-item content fingerprint for the cache key. Hashing full bodies
// every flush is O(total chars); instead hash id + length + first/last 200
// chars. Length catches insertions/deletions, the edge hashes catch an edit
// buried past character 200 while keeping per-flush work O(items), not O(chars).
const CACHE_FINGERPRINT_EDGE = 200;

function contentFingerprint(raw) {
  const text = String(raw || "");
  const len = text.length;
  if (len <= CACHE_FINGERPRINT_EDGE * 2) return `${len}:${hashStrings([text])}`;
  return `${len}:${hashStrings([`${text.slice(0, CACHE_FINGERPRINT_EDGE)}\0${text.slice(len - CACHE_FINGERPRINT_EDGE)}`])}`;
}

function cacheItemFingerprint(item, kind) {
  const raw = politicalText(item);
  const sub = (item?.subreddit || "").toLowerCase();
  const id = identityKey(item, kind) || "";
  return `${id}|${sub}|${contentFingerprint(raw)}`;
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
  // Include sampleItems identity in the key: they are engine input and are
  // NOT derivable from the subreddit counts or the id lists.
  const sampleIds = (stats?.sampleItems || []).map((s) => cacheItemFingerprint(s));
  return [
    `subs${subKeys.length}:${(h >>> 0).toString(36)}`,
    `p${(posts || []).length}:${hashStrings((posts || []).map((i) => cacheItemFingerprint(i, "t3")))}`,
    `c${(comments || []).length}:${hashStrings((comments || []).map((i) => cacheItemFingerprint(i, "t1")))}`,
    `s${sampleIds.length}:${hashStrings(sampleIds)}`,
  ].join("|");
}

// Sarcasm / quotation markers live in ./tone.js and are re-exported here for
// compatibility. They are uncertainty signals: they widen a standard error,
// never flip a direction.
export { detectSarcasm, isSarcastic } from "./tone.js";
import { detectSarcasm } from "./tone.js";
/** Legacy escape hatch used by older callers. */
export function sanitizeTextForPoliticalAnalysis(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  let text = rawText;
  text = text.replace(/^[ \t]*>.*$/gm, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, " $1 ");
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/(?:\/?r\/|\/?u\/)[A-Za-z0-9_]+/gi, " ");
  return text;
}

// ─── Pooling the two estimators ─────────────────────────────────────────────

// Inverse-variance weights are 1/SE^2, so an SE near zero yields an
// astronomical weight (SE=1e-6 -> w=1e12) that lets one estimator hijack the
// pooled reading. Clamp finite SEs to [MIN_SE_FOR_WEIGHT, MAX_SE_FOR_WEIGHT]
// before weighting: typical SEs (2..5) are untouched, while a spuriously tiny
// SE contributes at most 1/0.5^2 = 4.0 weight and a huge SE contributes ~0.
const MIN_SE_FOR_WEIGHT = 0.5;
const MAX_SE_FOR_WEIGHT = 20;
function clampSEForWeight(se) {
  if (!Number.isFinite(se)) return se;
  return Math.min(MAX_SE_FOR_WEIGHT, Math.max(MIN_SE_FOR_WEIGHT, se));
}

/**
 * Inverse-variance (Cochran) combination of two independent estimates.
 * An estimate with infinite standard error contributes zero weight.
 */
export function combine(textEst, commEst) {
  // Keep full precision for weighting; display rounding happens in callers
  // via clampScore / Math.round. Finite SEs are clamped (see above) so a
  // spuriously zero SE (e.g. from rounding upstream) becomes a bounded
  // weight instead of hijacking the pool; infinite SE still gets zero weight.
  const seText = clampSEForWeight(textEst.se);
  const seComm = clampSEForWeight(commEst.se);
  const wText = Number.isFinite(seText) && seText > 0 ? 1 / (seText ** 2) : 0;
  const wComm = Number.isFinite(seComm) && seComm > 0 ? 1 / (seComm ** 2) : 0;
  const wSum = wText + wComm;
  if (wSum <= 0) {
    return { score: 0, se: Number.POSITIVE_INFINITY, weight: 0, textWeight: 0, commWeight: 0 };
  }
  const score = (wText * textEst.score + wComm * commEst.score) / wSum;
  return {
    score,
    se: 1 / Math.sqrt(wSum),
    weight: wSum,
    textWeight: wText,
    commWeight: wComm,
  };
}

// Prior standard deviation of a position on the ±10 scale. Used for
// empirical-Bayes shrinkage: score_shrunk = score * tau^2 / (tau^2 + se^2).
// This is what makes "extreme and uncertain" impossible — as the standard
// error grows the estimate is pulled to the centre, so a thin history cannot
// look confident.
const PRIOR_SD = 5;
const PRIOR_VAR = PRIOR_SD * PRIOR_SD;

function shrink(score, se) {
  if (!Number.isFinite(se)) return 0;
  return score * (PRIOR_VAR / (PRIOR_VAR + se * se));
}

function clampScore(v) {
  return Math.max(-10, Math.min(10, Math.round(v * 10) / 10));
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function evaluatePoliticalCompass({ stats = {}, posts = [], comments = [] } = {}) {
  const cacheKey = buildCompassCacheKey(stats, posts, comments);
  const hit = compassCache.get(cacheKey);
  if (hit) return hit;
  const result = evaluatePoliticalCompassUncached({ stats, posts, comments });
  compassCache.set(cacheKey, result);
  if (compassCache.size > COMPASS_CACHE_MAX) {
    const oldest = compassCache.keys().next().value;
    if (oldest) compassCache.delete(oldest);
  }
  return result;
}

function evaluatePoliticalCompassUncached({ stats = {}, posts = [], comments = [] } = {}) {
  const items = poolItems(stats, posts, comments);

  // Group the author's own text per subreddit. Used only to detect whether
  // they are arguing against a community — never to score content.
  const textBySub = new Map();
  const liveItems = [];
  for (const item of items) {
    const raw = politicalText(item);
    if (!raw || raw === "[deleted]" || raw === "[removed]") continue;
    liveItems.push(item);
    const sub = (item.subreddit || "").toLowerCase();
    if (!textBySub.has(sub)) textBySub.set(sub, []);
    textBySub.get(sub).push(raw);
  }

  // 1. Text estimator — Laver & Garry (2000) pro/con balance.
  const text = scoreText(liveItems);

  // Sarcasm markers are evidence the surface wording may not be the author's
  // position. They widen uncertainty; they never reverse a direction.
  let sarcasmHits = 0;
  for (const item of liveItems) {
    const raw = politicalText(item);
    if (raw && detectSarcasm(raw, "").sarcastic) sarcasmHits++;
  }
  const sarcasmRate = liveItems.length > 0 ? Math.min(1, sarcasmHits / liveItems.length) : 0;
  const sarcasmInflation = 1 + sarcasmRate;

  // 2. Community estimator — Poole-Rosenthal / Barberá-style ideal point.
  const community = estimateFromCommunities(stats?.subredditCounts || {}, textBySub);

  // 3. Pool by inverse variance, per dimension, then shrink toward zero by
  //    the estimate's own uncertainty.
  const combined = {};
  for (const dim of ["econ", "soc", "gov"]) {
    const t = text.dimensions[dim] || { score: 0, se: PRIOR_SD, n: 0 };
    const c = community.dimensions[dim] || { score: 0, se: Number.POSITIVE_INFINITY, n: 0 };
    const tAdj = { score: t.score, se: Number.isFinite(t.se) ? t.se * sarcasmInflation : t.se };
    const pooled = combine(tAdj, c);
    combined[dim] = {
      ...pooled,
      display: clampScore(shrink(pooled.score, pooled.se)),
    };
  }

  const textUnits = text.units;
  const communityMass = Number.isFinite(community.units) ? community.units : 0;
  const totalEvidence = textUnits + communityMass;

  const anyFinite =
    Number.isFinite(combined.econ.se) ||
    Number.isFinite(combined.soc.se) ||
    Number.isFinite(combined.gov.se);
  const hasSignal = totalEvidence >= MIN_TOTAL_EVIDENCE && anyFinite;

  // Label a dimension only when its 95% CI excludes zero. This, together
  // with shrinkage above, is what keeps an uncertain reading from looking
  // extreme: uncertainty suppresses both the number and its label.
  // Single-sourced English + key helper: numeric branches below are the only
  // logic — labelFor delegates to it so the two can never drift apart.
  // Centre / uncertain reuses the existing apCompassUncertain key (no duplicate).
  const labelForWithKey = (est, neg, pos, keys) => {
    if (!Number.isFinite(est.se)) return { label: "Insufficient evidence", labelKey: "compassDimNoEvidence" };
    const ciLow = est.score - Z95 * est.se;
    const ciHigh = est.score + Z95 * est.se;
    if (ciLow <= 0 && ciHigh >= 0) return { label: "Centre / uncertain", labelKey: "apCompassUncertain" };
    const s = est.display;
    if (s <= -6) return { label: `${neg} (strong)`, labelKey: keys.negStrongKey };
    if (s <= -2) return { label: neg, labelKey: keys.negKey };
    if (s < 2) return { label: "Mixed / Moderate", labelKey: "compassDimMixed" };
    if (s < 6) return { label: pos, labelKey: keys.posKey };
    return { label: `${pos} (strong)`, labelKey: keys.posStrongKey };
  };
  const ECON_KEYS = { negKey: "compassDimEconLeft", negStrongKey: "compassDimEconLeftStrong", posKey: "compassDimEconRight", posStrongKey: "compassDimEconRightStrong" };
  const SOC_KEYS = { negKey: "compassDimSocLeft", negStrongKey: "compassDimSocLeftStrong", posKey: "compassDimSocRight", posStrongKey: "compassDimSocRightStrong" };
  const GOV_KEYS = { negKey: "compassDimGovLeft", negStrongKey: "compassDimGovLeftStrong", posKey: "compassDimGovRight", posStrongKey: "compassDimGovRightStrong" };

  const econ = hasSignal ? combined.econ.display : 0;
  const soc = hasSignal ? combined.soc.display : 0;
  const gov = hasSignal ? combined.gov.display : 0;

  // Directional corroboration, used only to disambiguate a genuine cross-
  // ideological history from a blank one.
  const leftHits = text.topCategories.reduce((s, r) => s + ((r.dims.econ || 0) < 0 ? 1 : 0), 0);
  const rightHits = text.topCategories.reduce((s, r) => s + ((r.dims.econ || 0) > 0 ? 1 : 0), 0);

  const classified = classifyQuadrant(econ, gov, {
    hasLeftSignals: leftHits > 0,
    hasRightSignals: rightHits > 0,
  });

  // Reliability: 1 at zero standard error, falling as uncertainty grows. The
  // UI shows this next to the reading so the evidence basis is never hidden.
  const pooledSE = [combined.econ.se, combined.soc.se, combined.gov.se].filter(Number.isFinite);
  const meanSE = pooledSE.length ? pooledSE.reduce((a, b) => a + b, 0) / pooledSE.length : Number.POSITIVE_INFINITY;
  const reliability = Number.isFinite(meanSE) ? Math.round((1 / (1 + meanSE / 3)) * 100) / 100 : 0;

  const distinctCategories = text.topCategories.length;
  const communityCount = community.communities.length;

  const confidence = !hasSignal
    ? "Insufficient signal"
    : reliability >= 0.75 && distinctCategories >= 3 && communityCount >= 2
      ? "High (convergent text and community evidence)"
      : reliability >= 0.5
        ? "Moderate (corroborated evidence)"
        : "Low (limited evidence — treat as provisional)";
  const confidenceKey = !hasSignal
    ? "compassConfNoSignal"
    : reliability >= 0.75 && distinctCategories >= 3 && communityCount >= 2
      ? "compassConfHigh"
      : reliability >= 0.5
        ? "compassConfModerate"
        : "compassConfLow";

  const econLabel = hasSignal ? labelForWithKey(combined.econ, "State / Labour", "Free Market", ECON_KEYS) : { label: "Non-Political", labelKey: "compassDimNonPolitical" };
  const socLabel = hasSignal ? labelForWithKey(combined.soc, "Progressive", "Traditional", SOC_KEYS) : { label: "Non-Political", labelKey: "compassDimNonPolitical" };
  const govLabel = hasSignal ? labelForWithKey(combined.gov, "Civil Liberty", "Authority", GOV_KEYS) : { label: "Non-Political", labelKey: "compassDimNonPolitical" };

  return {
    econ,
    soc,
    gov,
    hasSignal,
    archetype: hasSignal ? classified.label : "Undetermined / Non-Political Activity",
    archKey: hasSignal ? classified.labelKey : "compassArchUndetermined",
    quadrant: hasSignal ? classified.quadrant : "center",
    confidence,
    confidenceKey,
    evidence: {
      totalWeight: Math.round(totalEvidence * 10) / 10,
      communityWeight: Math.round(communityMass * 10) / 10,
      stanceWeight: textUnits,
      distinctTopics: distinctCategories,
      stanceDepth: text.topCategories.reduce((m, r) => Math.max(m, r.mentions || 0), 0),
      reliability,
      se: {
        econ: Number.isFinite(combined.econ.se) ? Math.round(combined.econ.se * 10) / 10 : null,
        soc: Number.isFinite(combined.soc.se) ? Math.round(combined.soc.se * 10) / 10 : null,
        gov: Number.isFinite(combined.gov.se) ? Math.round(combined.gov.se * 10) / 10 : null,
      },
      textClusters: {
        econ: text.dimensions.econ?.clusters || 0,
        soc: text.dimensions.soc?.clusters || 0,
        gov: text.dimensions.gov?.clusters || 0,
      },
      communityCount,
      method: "Laver & Garry (2000) pro/con balance + Poole-Rosenthal ideal point, inverse-variance pooled, empirical-Bayes shrunk",
    },
    dimensions: {
      econ: {
        score: econ,
        label: econLabel.label,
        labelKey: econLabel.labelKey,
        se: Number.isFinite(combined.econ.se) ? Math.round(combined.econ.se * 10) / 10 : null,
        units: text.dimensions.econ?.n || 0,
      },
      soc: {
        score: soc,
        label: socLabel.label,
        labelKey: socLabel.labelKey,
        se: Number.isFinite(combined.soc.se) ? Math.round(combined.soc.se * 10) / 10 : null,
        units: text.dimensions.soc?.n || 0,
      },
      gov: {
        score: gov,
        label: govLabel.label,
        labelKey: govLabel.labelKey,
        se: Number.isFinite(combined.gov.se) ? Math.round(combined.gov.se * 10) / 10 : null,
        units: text.dimensions.gov?.n || 0,
      },
    },
    detectedPositions: text.topCategories.map((r) => ({
      topic: r.topic,
      stance: r.stance,
      polarity: polarityLabel(r.dims),
      polarityKeys: polarityKeys(r.dims),
      keyword: r.keyword,
      snippet: r.snippet ? `"${r.snippet}"` : "",
      econ: Math.round((r.dims.econ || 0) * 10) / 10,
      soc: Math.round((r.dims.soc || 0) * 10) / 10,
      mentions: r.mentions,
      weight: r.magnitude,
      possibleSarcasm: !!r.possibleSarcasm,
    })),
    topSubSignals: community.communities,
  };
}

function polarityLabel(dims) {
  const parts = [];
  if (dims.econ) parts.push(dims.econ < 0 ? "Economic Left" : "Economic Right");
  if (dims.soc) parts.push(dims.soc < 0 ? "Progressive" : "Traditional");
  if (dims.gov) parts.push(dims.gov < 0 ? "Libertarian" : "Authoritarian");
  return parts.length ? parts.join(" · ") : "Neutral";
}

export function polarityKeys(dims) {
  const keys = [];
  if (dims.econ) keys.push(dims.econ < 0 ? "compassPolEconLeft" : "compassPolEconRight");
  if (dims.soc) keys.push(dims.soc < 0 ? "compassPolSocProg" : "compassPolSocTrad");
  if (dims.gov) keys.push(dims.gov < 0 ? "compassPolGovLib" : "compassPolGovAuth");
  return keys.length ? keys : ["compassPolNeutral"];
}

export { CATEGORIES, MIN_TOTAL_EVIDENCE };
