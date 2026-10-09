/**
 * Public entry point for the political compass engine.
 *
 * New code should import from here rather than reaching into ./compass/*.
 *
 * The compass is entirely local and deterministic. It runs no model, calls no
 * API, and needs no key:
 *
 *   - Text side: Laver & Garry (2000) pro/con balance over a political
 *     content-analysis dictionary (./compass/dictionary.js, ./compass/textscore.js).
 *   - Community side: Poole-Rosenthal / Barberá-style ideal-point estimation
 *     over the participation distribution across subreddits of known position
 *     (./compass/community.js, ./compass/map.js).
 *   - The two independent estimates are pooled by inverse-variance weighting
 *     and reported with a standard error. A dimension is labelled only when
 *     its 95% confidence interval excludes zero, so thin or contradictory
 *     evidence reads as "centre / uncertain" instead of landing on an extreme.
 */
export { SUBREDDIT_POLITICAL_MAP } from "./compass/map.js";
export { CATEGORIES, DIMENSIONS, DIMENSION_LABELS, DISAGREEMENT_WORDS, NEGATION_CUES } from "./compass/dictionary.js";
export { PROPOSITION_PATTERNS } from "./compass/patterns.js";
export {
  sanitizeTextForPoliticalAnalysis,
  evaluatePoliticalCompass,
  detectSarcasm,
  isSarcastic,
  classifyQuadrant,
  getIdeologicalArchetype,
  getDimensionLabels,
} from "./compass/analyze.js";
export { scoreText, balanceEstimate, martinVanbergTransform, normalizeForCoding, codeIdentityDeclarations } from "./compass/textscore.js";
export { estimateFromCommunities, resolveSubredditPosition } from "./compass/community.js";
