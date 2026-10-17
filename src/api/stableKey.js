/** Shared deterministic key serializer for cache / single-flight keys.
 *
 * Canonical rules (used by persistentKey, fetchBothKey, and requestKey):
 * - Object keys are sorted, so key order never affects the output.
 * - Arrays keep element order (order is semantically significant).
 * - `undefined` object props are skipped, mirroring JSON.stringify.
 *   In arrays, `undefined`/functions/symbols become `null`, also mirroring
 *   JSON.stringify ([undefined] -> "[null]").
 * - Date instances serialize to ISO strings (JSON.stringify(Date) equivalent).
 * - Numbers vs strings are NOT coerced: 1 and "1" produce different keys
 *   (`1` vs `"1"`). Callers must not rely on cross-type equality; this is
 *   intentional so a numeric epoch and its string form never collide.
 */

export function stableStringify(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(v => stableStringify(v) ?? "null").join(",")}]`;
  const keys = Object.keys(value)
    .filter(k => value[k] !== undefined && typeof value[k] !== "function" && typeof value[k] !== "symbol")
    .sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k]) ?? "null"}`).join(",")}}`;
}
