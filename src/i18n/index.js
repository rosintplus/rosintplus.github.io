import { useSyncExternalStore, useCallback } from "react";
import translations, { en, localeLoaders } from "./translations.js";

// ─── Languages ────────────────────────────────────────────────────────────────
// UI translations for the 7 languages the app's audience uses.
// Keys mirror the English catalog below; en is the source of truth and the
// fallback for any missing key. Translations were machine-generated and then
// QA-checked (placeholder preservation, gender agreement, UI length).
// Only the active language is loaded: en ships in the initial bundle and the
// other six are fetched on demand via dynamic import() (see translations.js),
// falling back to English until the requested locale arrives.

export const LANGS = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  el: "Ελληνικά",
  ja: "日本語",
  zh: "中文",
};

// BCP-47 locales for date/number formatting — Intl handles each language's
// date order (day-before-month etc.) and month names natively.
export const LOCALES = {
  en: "en",
  es: "es",
  fr: "fr",
  de: "de",
  el: "el",
  ja: "ja",
  zh: "zh-CN",
};

// Relative time ("30d ago" / "vor 30 Tagen" / "30日前") via the built-in
// Intl.RelativeTimeFormat — no translation catalog needed. Formatters are
// cached per locale; utc is in seconds.
const RTF_CACHE = new Map();
const PR_CACHE = new Map();

// Plural-aware translation helper. Convention: keys use CLDR suffixes
// (One, Many, Other, Few, Two). Falls back Many → Other → baseKey.
export function tN(t, baseKey, count, lang) {
  const locale = LOCALES[lang] || "en";
  let pr = PR_CACHE.get(locale);
  if (!pr) {
    pr = new Intl.PluralRules(locale);
    PR_CACHE.set(locale, pr);
  }
  const rule = pr.select(count);
  const ruleKey = `${baseKey}${rule.charAt(0).toUpperCase() + rule.slice(1)}`;
  let s = t(ruleKey);
  if (s === ruleKey) s = t(`${baseKey}Many`);
  if (s === `${baseKey}Many`) s = t(`${baseKey}Other`);
  let formatted = count;
  try {
    formatted = new Intl.NumberFormat(locale).format(count);
  } catch { /* ignore */ }
  return s.replace("{n}", formatted);
}

export function relTime(utcSeconds, lang) {
  const locale = LOCALES[lang] || "en";
  let rtf = RTF_CACHE.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "narrow" });
    RTF_CACHE.set(locale, rtf);
  }
  const s = Math.floor(Date.now() / 1000 - utcSeconds);
  if (s < 60) return rtf.format(-Math.max(s, 0), "second");
  const m = Math.floor(s / 60);
  if (m < 60) return rtf.format(-m, "minute");
  const h = Math.floor(m / 60);
  if (h < 24) return rtf.format(-h, "hour");
  const d = Math.floor(h / 24);
  if (d < 365) return rtf.format(-d, "day");
  return rtf.format(-Math.floor(d / 365), "year");
}


// ─── Store ────────────────────────────────────────────────────────────────────
// Tiny module-level store (no context provider needed): components subscribe
// via useSyncExternalStore, so a language change re-renders exactly the
// components that call useI18n().
//
// Non-English locales load asynchronously after the initial render; lookups
// fall back to English until the requested catalog arrives, then subscribers
// are notified so the UI swaps to the real strings with no reload.

let lang = (() => {
  try {
    const stored = localStorage.getItem("rosint-lang");
    if (LANGS[stored]) return stored;
  } catch {/* ignore */}
  const browser = (navigator.language || "").slice(0, 2);
  if (LANGS[browser]) return browser;
  return "en";
})();
document.documentElement.lang = lang;

export const listeners = new Set();
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Bump on every language switch and on every locale arrival so subscribers
// re-render even when the language tag itself is unchanged (async load).
let version = 0;
function notify() {
  version += 1;
  listeners.forEach((fn) => fn());
}

const pendingLoads = new Map();
function ensureLocale(code) {
  if (!LANGS[code] || translations[code] || pendingLoads.has(code)) return;
  const loader = localeLoaders[code];
  if (!loader) return;
  const p = loader().then(
    (mod) => {
      translations[code] = mod.default || mod;
      pendingLoads.delete(code);
      notify();
    },
    () => {
      // Offline / chunk failed: stay on the English fallback; a later
      // ensureLocale call (next setLang) retries the fetch.
      pendingLoads.delete(code);
    }
  );
  pendingLoads.set(code, p);
}

// Kick off the initial locale fetch (no-op for English).
ensureLocale(lang);

export const getLang = () => lang;
// Snapshot includes load state so the async locale arrival re-renders
// subscribers waiting on the English fallback.
const getI18nSnapshot = () => `${lang}:${translations[lang] ? "ready" : "loading"}:${version}`;

export function setLang(next) {
  if (!LANGS[next] || next === lang) return;
  lang = next;
  try {
    localStorage.setItem("rosint-lang", next);
  } catch {/* ignore */}
  document.documentElement.lang = next;
  ensureLocale(next);
  notify();
}

export function useI18n() {
  const snapshot = useSyncExternalStore(subscribe, getI18nSnapshot);
  const current = snapshot.split(":")[0];
  const t = useCallback((key, vars) => {
    let s = translations[current]?.[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    }
    return s;
  // Note: `translations` is a module-level mutable registry read fresh on each
  // call, so [current] suffices — the snapshot subscription above already
  // re-renders this component when the async locale chunk arrives.
  }, [current]);
  return { lang: current, t };
}

export { translations, en };
