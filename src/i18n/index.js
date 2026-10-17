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
// (One, Many, Other, Few, Two). The raw catalog for `lang` is checked
// first so t()'s English fallback can't shadow a missing rule key; order
// is ruleKey → Many → Other → baseKey → en.
export function tN(t, baseKey, count, lang) {
  const locale = LOCALES[lang] || "en";
  let pr = PR_CACHE.get(locale);
  if (!pr) {
    pr = new Intl.PluralRules(locale);
    PR_CACHE.set(locale, pr);
  }
  const rule = pr.select(count);
  const ruleKey = `${baseKey}${rule.charAt(0).toUpperCase() + rule.slice(1)}`;
  const candidates = [ruleKey, `${baseKey}Many`, `${baseKey}Other`, baseKey];
  const catalog = translations[lang];
  const key =
    candidates.find((k) => catalog?.[k] !== undefined) ??
    candidates.find((k) => en[k] !== undefined) ??
    ruleKey;
  const s = t(key);
  let formatted = count;
  try {
    formatted = new Intl.NumberFormat(locale).format(count);
  } catch { /* ignore */ }
  return s.replace("{n}", formatted);
}

// Locale-aware number formatting for future use (counts, stats, heatmap
// labels). Falls back to a plain string when Intl is unavailable.
export function fmtNumLocale(n, lang) {
  try {
    return new Intl.NumberFormat(LOCALES[lang] || "en").format(n);
  } catch {
    return String(n);
  }
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
    const urlLang = new URLSearchParams(window.location.search).get("lang");
    if (urlLang && LANGS[urlLang]) {
      try { localStorage.setItem("rosint-lang", urlLang); } catch {/* ignore */}
      return urlLang;
    }
  } catch {/* ignore */}
  try {
    const stored = localStorage.getItem("rosint-lang");
    if (LANGS[stored]) return stored;
  } catch {/* ignore */}
  const browser = (navigator.language || "").slice(0, 2);
  if (LANGS[browser]) return browser;
  return "en";
})();
document.documentElement.lang = LOCALES[lang] || lang;

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
// Locales whose async chunk failed to load (offline / chunk error).
// Cleared on success; consulted by setLang/retrySetLang so re-selecting
// the active language retries instead of stranding the UI on English.
const failedLoads = new Set();
function ensureLocale(code) {
  if (!LANGS[code] || translations[code] || pendingLoads.has(code)) return;
  const loader = localeLoaders[code];
  if (!loader) return;
  const p = loader().then(
    (mod) => {
      translations[code] = mod.default || mod;
      pendingLoads.delete(code);
      failedLoads.delete(code);
      notify();
    },
    () => {
      // Offline / chunk failed: stay on the English fallback; a later
      // ensureLocale call (same-language setLang / retrySetLang) retries.
      pendingLoads.delete(code);
      failedLoads.add(code);
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
  if (!LANGS[next]) return;
  if (next === lang) {
    // Re-selecting the active language retries a pending/failed load
    // instead of stranding the UI on the English fallback.
    if (!translations[next]) {
      failedLoads.delete(next);
      ensureLocale(next);
      notify();
    }
    return;
  }
  lang = next;
  try {
    localStorage.setItem("rosint-lang", next);
  } catch {/* ignore */}
  try {
    const url = new URL(window.location.href);
    if (next === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", next);
    window.history.replaceState({}, "", url);
  } catch {/* ignore */}
  document.documentElement.lang = LOCALES[next] || next;
  ensureLocale(next);
  notify();
}

// Re-attempt a failed locale fetch (defaults to the active language).
// No-op when the catalog is ready or a fetch is already pending.
// Returns true when a fetch was (re)started.
export function retrySetLang(code = lang) {
  if (!LANGS[code] || translations[code] || pendingLoads.has(code)) return false;
  failedLoads.delete(code);
  ensureLocale(code);
  notify();
  return true;
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
