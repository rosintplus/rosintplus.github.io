/**
 * Backwards-compatible re-export shim for the compass engine.
 * New code should import from `./compass/map.js`, `./compass/patterns.js`,
 * or `./compass/analyze.js` directly.
 */
export { SUBREDDIT_POLITICAL_MAP } from "./compass/map.js";
export { PROPOSITION_PATTERNS, DISAGREEMENT_WORDS } from "./compass/patterns.js";
export {
  sanitizeTextForPoliticalAnalysis,
  getIdeologicalArchetype,
  getDimensionLabels,
  isSarcastic,
  evaluatePoliticalCompass,
} from "./compass/analyze.js";
