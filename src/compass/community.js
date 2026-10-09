/**
 * Community-footprint position estimator.
 *
 * A user's distribution of activity across subreddits is treated the way
 * political science treats a roll-call record or a follow graph: each
 * community has a known position, and the user's ideal point is estimated
 * from their pattern of participation. This is the standard ideal-point
 * framing (Poole & Rosenthal 1985, NOMINATE; Barberá 2015,
 * "Birds of the Same Feather Tweet Together", AJPS 59(2): 766-783) applied to
 * community participation rather than votes or follows.
 *
 * With known community positions on the reference metric, the maximum-
 * likelihood ideal point under a simple proximity model is the participation-
 * weighted mean of community positions — which is also the Wordscores
 * (Laver, Benoit & Garry 2003) virgin-text estimator for a single document.
 * The two agree, so no rescaling is required: the map already lives on the
 * reference metric (econ / soc / gov in ±10).
 *
 * Uncertainty is the standard error of that weighted mean, so a user who
 * posts in one community is reported as *uncertain* rather than as extreme.
 *
 * Combining this estimate with the independent text estimate is a standard
 * inverse-variance (Cochran / Hedges-Olkin) meta-analytic combination — see
 * analyze.js.
 */

import { SUBREDDIT_POLITICAL_MAP } from "./map.js";
import { DISAGREEMENT_WORDS as DISAGREEMENT_LEXICON } from "./dictionary.js";

// ─── Tunables ────────────────────────────────────────────────────────────────

// Per-community participation ceiling. Log-damped so one enormous subreddit
// cannot dominate the ideal point purely on volume. This is the same
// frequency-damping used in the Waller & Anderson (2024, ACM WWW) community-
// weighting approach the previous engine adopted.
const PARTICIPATION_DAMPING = Math.log1p;

// An individual community may not contribute more than this share of the
// total evidence mass, however large its raw count.
const COMMUNITY_WEIGHT_CAP = 0.5;

// Words-in-context that indicate the user is arguing *against* the community.
// Such participation is evidence about the community, not about the user's
// own position, so it raises uncertainty rather than shifting the estimate.
const DISAGREE_MIN_COUNT = 3;
const DISAGREE_MIN_CHARS = 80;
const DISAGREE_DENSITY_PER_500 = 2.0;
// Arguing against a community reduces the weight it carries as evidence of
// the user's own position. It never flips it — a heuristic that can invert an
// answer produces nonsense answers.
const DISAGREE_WEIGHT_FACTOR = 0.35;

// Minimum participation mass before a community-based position is reported.
const MIN_COMMUNITY_UNITS = 6;

// The map's coordinates are hand-assigned and are therefore themselves only
// precise to about ±2 on the ±10 scale. Propagating that floor keeps the
// standard error finite and honest even when every observation sits in one
// community (where the observed between-community spread is zero by
// construction and would otherwise imply perfect confidence).
const MAP_POSITION_UNCERTAINTY = 2.0;

/**
 * Heuristic position for a subreddit not in the reference map.
 *
 * Kept deliberately narrow: it fires only on unambiguous name fragments, and
 * anti-sub markers suppress it so "anti-X" communities do not inherit the
 * ideology of the thing they oppose. Returns null when there is no defensible
 * reading — an unknown community should say so, not guess.
 */
export function resolveSubredditPosition(lower) {
  const mapped = SUBREDDIT_POLITICAL_MAP[lower];
  if (mapped) return mapped;

  const isAntiSub = /(?:anti|fuck|against|virus|666|gret|watch|impeach|exposed|critic|cult|hate)/i.test(lower);

  if (lower.includes("conserv") && !isAntiSub) return { econ: 6.5, soc: 5.5, gov: 5.0, weight: 0.8, side: "right" };
  if ((lower.includes("republican") || lower.includes("trump") || lower.includes("maga")) && !isAntiSub) return { econ: 7.0, soc: 6.5, gov: 6.0, weight: 0.85, side: "right" };
  if (isAntiSub && (lower.includes("trump") || lower.includes("maga") || lower.includes("altright") || lower.includes("nazi") || lower.includes("conserv"))) return { econ: -5.0, soc: -6.0, gov: -5.0, weight: 0.8, side: "left" };
  if (lower.includes("socialis") || lower.includes("communis") || lower.includes("marx")) return { econ: -8.0, soc: 2.0, gov: 4.0, weight: 0.85, side: "left" };
  if (lower.includes("anarch")) return { econ: -7.5, soc: -8.5, gov: -9.0, weight: 0.85, side: "left" };
  if (lower.includes("libertarian")) return { econ: 7.0, soc: -3.5, gov: -8.0, weight: 0.85, side: "right" };
  if (lower.includes("democrat") || lower.includes("liberal") || lower.includes("progressive")) return { econ: -5.0, soc: -5.5, gov: -4.5, weight: 0.8, side: "left" };
  if (lower.includes("atheis")) return { econ: -3.5, soc: -7.5, gov: -6.0, weight: 0.8, side: "left" };
  return null;
}

function disagreementRate(userTexts) {
  const joined = userTexts.join(" ").toLowerCase();
  if (!joined || joined.length < DISAGREE_MIN_CHARS) return 0;
  const words = joined.split(/[^a-z0-9_-]+/).filter(Boolean);
  if (!words.length) return 0;
  let hits = 0;
  for (const w of words) {
    // Imported lazily to keep this module free of dictionary coupling at
    // load time; the set is small and static.
    if (DISAGREEMENT_LEXICON.has(w)) hits++;
  }
  const per500 = (hits / words.length) * 500;
  if (hits < DISAGREE_MIN_COUNT) return 0;
  return per500 >= DISAGREE_DENSITY_PER_500 ? 1 : 0;
}

/**
 * Estimate an ideal point from community participation.
 *
 * @param {Object} subredditCounts - { [subreddit]: count }
 * @param {Map<string, string[]>} textBySub - user's own text per subreddit,
 *        used only to detect arguing-against, never to score content
 * @returns {{dimensions: object, communities: Array, units: number, dominatedBy: string|null}}
 */
export function estimateFromCommunities(subredditCounts, textBySub) {
  const rows = [];
  for (const [subName, count] of Object.entries(subredditCounts || {})) {
    if (!count || count <= 0) continue;
    const lower = subName.toLowerCase();
    const entry = resolveSubredditPosition(lower);
    if (!entry) continue;

    const texts = textBySub?.get(lower) || [];
    const debating = disagreementRate(texts) > 0;

    // Volume-damped participation. A community the user argues in carries
    // less evidence about the user's own position; it is not inverted.
    const base = PARTICIPATION_DAMPING(count) * (entry.weight ?? 0.7);
    const mass = base * (debating ? DISAGREE_WEIGHT_FACTOR : 1);
    if (mass <= 0) continue;

    rows.push({
      sub: subName,
      count,
      econ: entry.econ ?? 0,
      soc: entry.soc ?? 0,
      gov: entry.gov ?? entry.soc ?? 0,
      mass,
      debating,
    });
  }

  if (!rows.length) {
    return {
      dimensions: emptyDimResult(),
      communities: [],
      units: 0,
      dominatedBy: null,
    };
  }

  const totalMass = rows.reduce((s, r) => s + r.mass, 0);

  // Cap any single community's share of the evidence mass.
  const cap = totalMass * COMMUNITY_WEIGHT_CAP;
  for (const r of rows) if (r.mass > cap) r.mass = cap;
  const cappedTotal = rows.reduce((s, r) => s + r.mass, 0);

  const dimensions = {};
  for (const dim of ["econ", "soc", "gov"]) {
    // Participation-weighted mean of known community positions = the
    // maximum-likelihood ideal point on the reference metric.
    let sum = 0;
    for (const r of rows) sum += r[dim] * r.mass;
    const estimate = cappedTotal > 0 ? sum / cappedTotal : 0;

    // Standard error of a weighted mean: sd of the community positions under
    // the participation distribution, divided by sqrt of effective N.
    let varSum = 0;
    for (const r of rows) varSum += r.mass * (r[dim] - estimate) ** 2;
    const sd = cappedTotal > 0 ? Math.sqrt(varSum / cappedTotal) : 0;
    // Effective N is the number of independent communities, not raw items —
    // 200 comments in one subreddit are not 200 independent observations of
    // position.
    const nEff = rows.length;
    // Total uncertainty = sampling variance of the ideal point PLUS the
    // map's own positional uncertainty. The floor matters: with one
    // community the observed spread is zero by construction, and without the
    // floor that would imply perfect confidence in a hand-assigned number.
    const samplingVar = nEff > 1 ? (sd * sd) / nEff : 0;
    const se = Math.sqrt(samplingVar + MAP_POSITION_UNCERTAINTY ** 2);

    dimensions[dim] = {
      score: Math.round(estimate * 10) / 10,
      se: Math.round(se * 10) / 10,
      n: nEff,
    };
  }

  const topCommunities = rows
    .slice()
    .sort((a, b) => b.mass - a.mass)
    .slice(0, 6)
    .map((r) => ({
      sub: r.sub,
      count: r.count,
      econ: r.econ,
      soc: r.soc,
      gov: r.gov,
      weight: Math.round(r.mass * 10) / 10,
      interactionTag: r.debating ? "Debating" : null,
    }));

  return {
    dimensions,
    communities: topCommunities,
    units: cappedTotal,
    dominatedBy: topCommunities[0]?.sub ?? null,
    enough: cappedTotal >= MIN_COMMUNITY_UNITS,
  };
}

function emptyDimResult() {
  return {
    econ: { score: 0, se: Number.POSITIVE_INFINITY, n: 0 },
    soc: { score: 0, se: Number.POSITIVE_INFINITY, n: 0 },
    gov: { score: 0, se: Number.POSITIVE_INFINITY, n: 0 },
  };
}

export { MIN_COMMUNITY_UNITS };
