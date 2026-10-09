/**
 * Tone markers: sarcasm and mocking register.
 *
 * These are *uncertainty* signals, not position signals. They are used to
 * widen a reported standard error and to flag a category as possibly
 * non-literal — never to reverse the sign of a coded position. A heuristic
 * able to flip an answer is a heuristic that produces nonsense answers.
 */

const RHETORICAL = /\b(?:yeah,? right|oh sure|what could possibly go wrong|because that always works|nice try|good luck with that)\b/i;
const MOCKING_CAPS = /(?:[a-z][A-Z][a-z][A-Z]|[A-Z][a-z][A-Z][a-z]){2,}/;
const CAP_TRANSITIONS = /[a-z][A-Z]|[A-Z][a-z]/g;

/**
 * @param {string} rawText
 * @param {string} [snippet]
 * @returns {{sarcastic: boolean, strength: 'none'|'weak'|'strong'}}
 */
export function detectSarcasm(rawText, snippet) {
  const combined = `${rawText || ""} ${snippet || ""}`;
  if (!combined.trim()) return { sarcastic: false, strength: "none" };

  // Explicit markers stand on their own.
  if (/(?:^|\s)\/s(?:arcasm)?(?:\s|$|[.!?,;])/i.test(combined)) return { sarcastic: true, strength: "strong" };
  if (/\((?:sarcasm|!|\?!)\)/i.test(combined) || /\?\?!/.test(combined)) return { sarcastic: true, strength: "strong" };
  if (MOCKING_CAPS.test(combined)) return { sarcastic: true, strength: "strong" };

  // Rhetorical put-downs need corroboration. On their own these words are
  // ordinary English, so a bare "surely" or "totally" must not count. The
  // comma matters: "yeah right, X" is the canonical sarcastic construction.
  if (RHETORICAL.test(combined) && (/[!?"',;]/.test(combined) || /\b(?:genius|brave|smart)\b/i.test(combined))) {
    return { sarcastic: true, strength: "strong" };
  }

  // Ordinary camelCase / acronym text with light punctuation is only weak
  // evidence — enough to flag uncertainty, never enough to dismiss.
  if ((combined.match(CAP_TRANSITIONS) || []).length >= 4 && /[!?"']/.test(combined)) {
    return { sarcastic: true, strength: "weak" };
  }

  return { sarcastic: false, strength: "none" };
}

/** Boolean convenience wrapper for callers that only need a yes/no. */
export function isSarcastic(rawText, snippet) {
  return detectSarcasm(rawText, snippet).sarcastic;
}

/** Per-item shortcut used while coding. */
export function detectSarcasmMarkers(rawText) {
  return detectSarcasm(rawText, "").sarcastic;
}
