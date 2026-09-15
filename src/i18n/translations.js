// Lazy locale registry — only English is bundled synchronously (it is the
// source of truth and the fallback for every missing key). The remaining six
// languages are code-split behind dynamic import() and fetched on demand, so
// the initial bundle ships just the active language instead of all seven.
//
// Use loadLocale(code) / localeLoaders from the i18n store (./index.js); the
// default-exported `translations` map starts as { en } and is filled in as
// locales load.
import en from "./locales/en.js";

const translations = {
  en,
};

// One dynamic import() per language → Vite emits one chunk per locale.
export const localeLoaders = {
  en: () => Promise.resolve({ default: en }),
  es: () => import("./locales/es.js"),
  fr: () => import("./locales/fr.js"),
  de: () => import("./locales/de.js"),
  el: () => import("./locales/el.js"),
  ja: () => import("./locales/ja.js"),
  zh: () => import("./locales/zh.js"),
};

export async function loadLocale(code) {
  if (translations[code]) return translations[code];
  const loader = localeLoaders[code];
  if (!loader) return en;
  const mod = await loader();
  translations[code] = mod.default || mod;
  return translations[code];
}

export default translations;
export { en };
