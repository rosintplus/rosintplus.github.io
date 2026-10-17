/**
 * Text-side position estimator.
 *
 * Follows the "reader updating" rule of
 *   Laver, M. & Garry, J. (2000) "Estimating Policy Positions from Political
 *   Texts", British Journal of Political Science 30(4): 611-632:
 *
 *     U(PC) = (PC_pro - PC_con) / (PC_pro + PC_con)
 *
 * i.e. a policy position is the *relative balance* of text units coding for
 * each pole of a dimension. The estimate is bounded in [-1, +1] by
 * construction, is defined for a single text (which matters here: we score one
 * profile at a time), and carries a binomial standard error.
 *
 * Rescaling onto the reference metric uses the robust transformation of
 *   Martin, L. W. & Vanberg, G. (2007) "A Robust Transformation Procedure for
 *   Interpreting Political Text", Political Analysis 16(1): 98-110
 * rather than the original Laver-Benoit-Garry (2003) transformation. The LBG
 * transformation standardises against the dispersion of the *virgin* texts and
 * therefore cannot be computed for a single virgin text (its SD is undefined),
 * and does not recover the reference scores. MV rescales linearly between the
 * two extreme reference points, recovers them exactly, and is invariant to
 * which virgin texts happen to be in the sample.
 *
 * All constants live in dictionary.js; nothing here does I/O.
 */

import {
  CATEGORIES,
  DIMENSIONS,
  DIMENSION_LABELS,
  NEGATION_CUES,
  QUESTION_CUES,
} from "./dictionary.js";
import { detectSarcasmMarkers } from "./tone.js";

// ─── Tunables (documented so every number has a reason) ──────────────────────

// How far a negation cue reaches, in tokens. Short scope on purpose: English
// negation rarely travels further than a few words, and an over-long window
// silently flips unrelated clauses.
const NEGATION_SCOPE = 5;

// Suppressed-claim evidence. Quoted/quoted-block text is stripped earlier;
// anything still inside an explicit quotation is reporting someone else's
// position, not asserting one.
const QUOTE_PAIR = /["“”'‘’«»]/g;

// A per-item cap on how much any single item may contribute, so one very
// long comment cannot outvote the rest of the history. CMP-style dictionary
// coding counts *text units*; this bounds the units one item can yield.
const ITEM_UNIT_CAP = 12;

// The estimate is a ratio of counts and is therefore defined for any amount
// of text. What is *not* defined from very little text is its uncertainty,
// so we never suppress the point estimate — we widen its standard error.
// This is the prior standard deviation of a position on the ±10 scale; used
// when a single category is all the evidence there is.
const PRIOR_SD = 5;

// Each category is an independent cluster of evidence. Repeating one phrase
// 80 times is one observation of one category, not 80 independent
// observations of position, so uncertainty is clustered on distinct
// categories rather than on raw mentions.
const MIN_CLUSTERS_FOR_SPREAD = 2;

// ─── Tokenisation ────────────────────────────────────────────────────────────

/** Strip markdown links, URLs and subreddit/user mentions before counting. */
export function normalizeForCoding(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  let text = rawText;
  text = text.replace(/^[ \t]*>.*$/gm, " ");                 // quoted lines
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, " $1 ");     // [text](url)
  text = text.replace(/https?:\/\/\S+/gi, " ");              // bare URLs
  text = text.replace(/(?:\/?r\/|\/?u\/)[A-Za-z0-9_]+/gi, " ");
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, " $1 ");     // emphasis
  text = text.replace(/`[^`]*`/g, " ");                      // inline code
  return text;
}

/** Use the same author text for archive items and persisted stats samples. */
export function politicalText(item) {
  return item?.body || item?.selftext || item?.title || "";
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[''']/g, "")
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

/** Split into sentences so negation scope and question detection stay local. */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Coding ─────────────────────────────────────────────────────────────────

/**
 * Code one sentence against the dictionary.
 * @returns {number} units added
 */
function codeSentence(sentence, tokens, out, meta) {
  if (!tokens.length) return 0;
  let added = 0;
  // Questions ask about a position; they do not assert one. Dropping them is
  // standard in content analysis and removes a large false-positive source
  // ("is universal healthcare any good?").
  if (QUESTION_CUES.test(sentence.trim()) || /\?\s*$/.test(sentence.trim())) return 0;

  // Negation cue positions, for scoped flipping.
  const negAt = [];
  for (let i = 0; i < tokens.length; i++) {
    if (NEGATION_CUES.has(tokens[i])) negAt.push(i);
  }
  const isNegatedNear = (idx) =>
    negAt.some((n) => idx - n >= 0 && idx - n <= NEGATION_SCOPE);

  for (const cat of CATEGORIES) {
    if (cat.identity) continue; // handled separately, not a pole
    for (const pattern of cat.patterns) {
      const match = sentence.match(pattern);
      if (!match || match.index == null) continue;

      // Locate the match in token space for negation scoping. Approximate by
      // tokenising the leading slice; good enough for a 5-token window.
      const prefixTokens = tokenize(sentence.slice(0, match.index));
      const hitIdx = prefixTokens.length;

      const negated = isNegatedNear(hitIdx);
      // Only an avowal inverts under negation. A category that is already a
      // condemnation ("police brutality") stays what it is when negated.
      const invert = negated && cat.invertOnNegate;

      // Keep a short quote around the hit so the UI can show what was coded.
      const start = Math.max(0, match.index - 40);
      const end = Math.min(sentence.length, match.index + match[0].length + 40);
      const snippet = sentence.slice(start, end).trim();

      for (const dim of DIMENSIONS) {
        const pole = cat.dims?.[dim];
        if (!pole) continue;
        out.units.push({
          dim,
          pole: invert ? -pole : pole,
          category: cat,
          negated,
          snippet,
          sarcastic: !!meta?.sarcastic,
        });
        added++;
      }
      break; // one hit per category per sentence
    }
  }
  return added;
}

/**
 * Detect an explicit ideological self-declaration. These are the highest-
 * salience units in the dictionary: a first-person identity statement is a
 * direct report of position, not an inference from vocabulary.
 * @returns {Array<{topic: string, stance: string, pole: {econ?: number, soc?: number, gov?: number}}>}
 */

// Identity patterns precompiled once at module load. codeIdentityDeclarations
// runs once per item inside scoreText, and rebuilding a RegExp per sentence
// per pattern there is pure overhead — the dictionary is static, so the
// global-flagged copies (matchAll requires the g flag) are built a single
// time and reused. matchAll clones its argument internally and never mutates
// the shared objects' lastIndex, so reuse is deterministic.
const COMPILED_IDENTITY_PATTERNS = (CATEGORIES.find((c) => c.identity)?.patterns || []).map(
  (pattern) => new RegExp(pattern.source, `${pattern.flags.replace(/g/g, "")}g`),
);
export function codeIdentityDeclarations(rawText) {
  const out = [];
  const identity = CATEGORIES.find((c) => c.identity);
  if (!identity) return out;
  const text = normalizeForCoding(rawText).replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|(?<!\w)'[^'\n]+'(?!\w)/g, " ");
  for (const sentence of splitSentences(text)) {
    if (QUESTION_CUES.test(sentence) || /\?\s*$/.test(sentence)) continue;
    for (const pattern of COMPILED_IDENTITY_PATTERNS) {
      pattern.lastIndex = 0;
      for (const m of sentence.matchAll(pattern)) {
        const phrase = (m[0] || "").toLowerCase();
        const preceding = tokenize(sentence.slice(0, m.index)).slice(-NEGATION_SCOPE);
        if ([...preceding, ...tokenize(phrase)].some(token => NEGATION_CUES.has(token))) continue;
        // Map the declared label onto dimension poles. Labels are matched longest
        // first so "libertarian socialist" is not read as bare "libertarian".
        const table = [
          { re: /libertarian\s+(?:left|socialist)|libleft|lib[- ]?left|democratic\s+socialist|anarcho[\s-]?(?:syndicalist|communist)/i, pole: { econ: -1, soc: -1, gov: -1 }, label: "Libertarian Left" },
          { re: /socialist|anarchist/i, pole: { econ: -1, soc: -1, gov: -1 }, label: "Socialist / Anarchist" },
          { re: /authoritarian\s+left|authleft|auth[- ]?left|marxist[\s-]?leninist|tankie/i, pole: { econ: -1, soc: +1, gov: +1 }, label: "Authoritarian Left" },
          { re: /communist/i, pole: { econ: -1, soc: 0, gov: +1 }, label: "Communist" },
          { re: /libertarian\s+right|libright|lib[- ]?right|anarcho[\s-]?capitalist|ancap|objectivist/i, pole: { econ: +1, soc: -1, gov: -1 }, label: "Libertarian Right" },
          { re: /classical\s+liberal/i, pole: { econ: +1, soc: -1, gov: -1 }, label: "Classical Liberal" },
          { re: /authoritarian\s+right|authright|auth[- ]?right|fascist|monarchist|theocrat/i, pole: { econ: +1, soc: +1, gov: +1 }, label: "Authoritarian Right" },
          { re: /nationalist|paleoconservative/i, pole: { econ: +1, soc: +1, gov: +1 }, label: "Nationalist / Traditionalist" },
          { re: /social\s+democrat/i, pole: { econ: -1, soc: -1, gov: 0 }, label: "Social Democrat" },
          { re: /green/i, pole: { econ: -1, soc: -1, gov: -1 }, label: "Green" },
          { re: /neoliberal/i, pole: { econ: +1, soc: 0, gov: +1 }, label: "Neoliberal" },
          { re: /centrist|moderate/i, pole: { econ: 0, soc: 0, gov: 0 }, label: "Centrist" },
          { re: /libertarian/i, pole: { econ: +1, soc: -1, gov: -1 }, label: "Libertarian" },
        ];
        for (const row of table) {
          if (row.re.test(phrase)) {
            out.push({ topic: "Ideological Self-Identification", stance: `Self-identified as ${row.label}`, pole: row.pole, quote: m[0] });
            break;
          }
        }
      }
    }
  }
  return out;
}

// ─── Estimator ──────────────────────────────────────────────────────────────

/**
 * Laver & Garry (2000) pro/con balance for one dimension.
 *
 * Point estimate is the relative balance of coded text units, rescaled from
 * [-1,+1] to [-10,+10]. Uncertainty is *cluster-robust on categories*: each
 * distinct dictionary category is one independent cluster of evidence, so
 * repeating a single phrase does not manufacture confidence. With fewer than
 * two distinct categories there is no way to estimate spread, so the prior
 * standard deviation is used instead — the estimate is reported, just as
 * uncertain as it really is.
 *
 * @param {Array} units - coded units for a single dimension
 * @returns {{score: number, se: number, pro: number, con: number, n: number, clusters: number}}
 */
export function balanceEstimate(units) {
  let pro = 0;
  let con = 0;
  for (const u of units) {
    if (u.pole > 0) pro += u.category.weight ?? 1;
    else if (u.pole < 0) con += u.category.weight ?? 1;
  }
  const n = pro + con;
  if (n <= 0) return { score: 0, se: PRIOR_SD, pro: 0, con: 0, n: 0, clusters: 0 };

  // U(PC) = (pro - con) / (pro + con), rescaled from [-1,+1] to [-10,+10].
  const balance = (pro - con) / n;
  const score = balance * 10;

  // Cluster on distinct categories. Per-cluster balance in [-10,+10].
  const perCat = new Map();
  for (const u of units) {
    const key = u.category.topic || u.category.searchKw || "?";
    const row = perCat.get(key) || { pro: 0, con: 0 };
    const w = u.category.weight ?? 1;
    if (u.pole > 0) row.pro += w;
    else if (u.pole < 0) row.con += w;
    perCat.set(key, row);
  }
  const clusters = perCat.size;
  if (clusters < MIN_CLUSTERS_FOR_SPREAD) {
    return { score, se: PRIOR_SD, pro, con, n, clusters };
  }
  const balances = [...perCat.values()].map((r) => {
    const k = r.pro + r.con;
    return k > 0 ? ((r.pro - r.con) / k) * 10 : 0;
  });
  const mean = balances.reduce((a, b) => a + b, 0) / balances.length;
  const variance = balances.reduce((s, b) => s + (b - mean) ** 2, 0) / (balances.length - 1);
  const se = Math.sqrt(variance / balances.length);
  return { score, se: se > 0 ? se : PRIOR_SD, pro, con, n, clusters };
}

/**
 * Martin & Vanberg (2007) robust transformation.
 *
 * Maps a raw estimate from the [-10,+10] balance metric onto the reference
 * metric by linear interpolation between the two extreme reference points.
 * Recovers both endpoints exactly and needs only one virgin text.
 *
 * @param {number} raw       - raw balance estimate for the virgin text
 * @param {number} rawLow    - raw estimate of the lowest reference text
 * @param {number} rawHigh   - raw estimate of the highest reference text
 * @param {number} refLow    - known position of the lowest reference text
 * @param {number} refHigh   - known position of the highest reference text
 */
export function martinVanbergTransform(raw, rawLow, rawHigh, refLow, refHigh) {
  const denom = rawHigh - rawLow;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) {
    // Degenerate: reference texts score identically. Fall back to the raw
    // value rather than dividing by zero.
    return raw;
  }
  return refLow + ((raw - rawLow) / denom) * (refHigh - refLow);
}

/**
 * Score a set of items (one user's history) on all three dimensions.
 *
 * Items are coded *individually* so the per-item unit cap actually bounds a
 * single item rather than the whole corpus. Duplicates must already have been
 * removed by the caller (see analyze.js poolItems).
 *
 * @param {Array<{body?: string, title?: string, selftext?: string}>} items
 * @returns {{dimensions: object, units: number, identities: Array, topCategories: Array}}
 */
export function scoreText(items) {
  const collected = { units: [] };
  const identities = [];

  for (const item of items || []) {
    const raw = politicalText(item);
    if (!raw || raw === "[deleted]" || raw === "[removed]") continue;

    // Self-declared identities are direct reports of position — highest
    // salience in the dictionary.
    const declared = codeIdentityDeclarations(raw);
    for (const id of declared) identities.push(id);

    const normalized = normalizeForCoding(raw);
    const sentences = splitSentences(normalized);
    // Sarcasm markers are detected per item and recorded on its units so a
    // category can be flagged as possible sarcasm rather than silently
    // counted at face value.
    const meta = { sarcastic: detectSarcasmMarkers(raw) };
    let budget = ITEM_UNIT_CAP;
    for (const sentence of sentences) {
      if (budget <= 0) break;
      budget -= codeSentence(sentence, tokenize(sentence), collected, meta);
    }
  }

  // Identity declarations become full-weight units on each dimension named.
  for (const id of identities) {
    for (const dim of DIMENSIONS) {
      const pole = id.pole[dim];
      if (!pole) continue;
      collected.units.push({
        dim,
        pole,
        category: { weight: 1, topic: id.topic, stance: id.stance, searchKw: "identity" },
        negated: false,
        identity: true,
        snippet: id.quote || "",
        sarcastic: false,
      });
    }
  }

  const byDim = { econ: [], soc: [], gov: [] };
  for (const u of collected.units) {
    if (byDim[u.dim]) byDim[u.dim].push(u);
  }

  const dimensions = {};
  for (const dim of DIMENSIONS) {
    const est = balanceEstimate(byDim[dim]);
    const labels = DIMENSION_LABELS[dim];
    dimensions[dim] = {
      score: est.score,
      se: est.se,
      pro: est.pro,
      con: est.con,
      n: est.n,
      clusters: est.clusters,
      labelNeg: labels.neg,
      labelPos: labels.pos,
    };
  }

  // Salient categories for display, ranked by how much they moved the balance.
  const tally = new Map();
  for (const u of collected.units) {
    const key = u.category.topic;
    const row = tally.get(key) || {
      topic: key,
      stance: u.category.stance,
      keyword: u.category.searchKw,
      mentions: 0,
      dims: {},
      snippet: u.snippet || "",
      sarcasticUnits: 0,
    };
    row.mentions += 1;
    if (u.sarcastic) row.sarcasticUnits += 1;
    if (!row.snippet && u.snippet) row.snippet = u.snippet;
    for (const dim of DIMENSIONS) {
      const p = u.category.dims?.[dim];
      if (p) row.dims[dim] = (row.dims[dim] || 0) + (u.pole * (u.category.weight ?? 1));
    }
    tally.set(key, row);
  }
  const topCategories = [...tally.values()]
    .map((r) => ({
      ...r,
      magnitude: Object.values(r.dims).reduce((s, v) => s + Math.abs(v), 0),
      // Majority of this category's evidence came from items carrying sarcasm
      // markers, so its reading is treated as non-literal.
      possibleSarcasm: r.mentions > 0 && r.sarcasticUnits / r.mentions >= 0.5,
    }))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 8);

  return {
    dimensions,
    units: collected.units.length,
    identities,
    topCategories,
  };
}

export { CATEGORIES, DIMENSIONS, DIMENSION_LABELS };
