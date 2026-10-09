/**
 * Backwards-compatible re-export shim for the dictionary.
 *
 * The content-analysis dictionary lives in `./dictionary.js` (structured as
 * Laver & Garry (2000) categories) and its estimator in `./textscore.js`.
 * New code should import from those directly.
 */
export { CATEGORIES, DIMENSIONS, DIMENSION_LABELS, DISAGREEMENT_WORDS, NEGATION_CUES, QUESTION_CUES } from "./dictionary.js";

import { CATEGORIES } from "./dictionary.js";

/**
 * Legacy shape: flat list of { pattern, topic, stance, polarity, econ, soc,
 * gov, searchKw }. Derived from the categories so old callers keep working.
 */
export const PROPOSITION_PATTERNS = CATEGORIES.flatMap((cat) =>
  cat.patterns.map((pattern) => ({
    pattern,
    topic: cat.topic,
    stance: cat.stance,
    polarity: polarityOf(cat),
    econ: (cat.dims?.econ || 0) * 6,
    soc: (cat.dims?.soc || 0) * 6,
    gov: (cat.dims?.gov || 0) * 6,
    searchKw: cat.searchKw,
  })),
);

function polarityOf(cat) {
  const d = cat.dims || {};
  if (!Object.keys(d).length) return "Neutral";
  const first = Object.values(d)[0];
  return first > 0 ? "Supports" : "Opposes";
}
