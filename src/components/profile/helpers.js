import { fmtNum } from "../../utils.js";

export { fmtNum };

export function getDays(locale) {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2000, 0, 2 + i)).slice(0, 3));
}

export const levels = [0.4, 0.6, 0.8, 1.0];

export function cleanDimensionLabel(label) {
  if (!label) return '';
  let clean = String(label).replace(/\s*\([^)]*\)/g, '').trim();
  if (clean.length > 18 && clean.includes('/')) {
    clean = clean.split('/')[0].trim();
  }
  return clean;
}
