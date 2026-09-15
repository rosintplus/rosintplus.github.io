import { memo, useState, useEffect } from "react";
import { THEMES, applyTheme, safeGet, safeSet } from "../theme.js";
import { closeOnEscape, closeAllMenus, closeOtherMenus } from "../constants.js";
import { IconGlobe, IconMoon, IconSun, IconMonitor, IconPalette } from "./icons.jsx";
import { LANGS, setLang, useI18n } from "../i18n.js";

export const ThemeSwitcher = memo(() => {
  const [theme, setTheme] = useState(() => safeGet("rosint-theme", "default"));
  const [colorMode, setColorMode] = useState(() => safeGet("rosint-color-mode", "auto"));

  useEffect(() => {
    let isDark = true;
    if (colorMode === "auto") {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } else {
      isDark = colorMode === "dark";
    }

    const tGroup = THEMES[theme] || THEMES.default;
    const t = isDark ? tGroup.dark : tGroup.light;

    applyTheme(t, isDark);

    safeSet("rosint-theme", theme);
    safeSet("rosint-color-mode", colorMode);
    try {
      localStorage.setItem("rosint-resolved", JSON.stringify({ dark: tGroup.dark, light: tGroup.light, mode: colorMode }));
    } catch {
      /* ignore */
    }
  }, [theme, colorMode]);

  useEffect(() => {
    if (colorMode !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e) => {
      const isDark = e.matches;
      const tGroup = THEMES[theme] || THEMES.default;
      const t = isDark ? tGroup.dark : tGroup.light;
      applyTheme(t, isDark);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme, colorMode]);

  const isDarkResolved = colorMode === "dark" || (colorMode === "auto" && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const { lang, t } = useI18n();

  return <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
            <details className="relative group/lang" onKeyDown={closeOnEscape}>
                <summary aria-label="Change language" onClick={e => closeOtherMenus(e.currentTarget.closest('details'))} className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] relative z-50 rounded h-9 px-3 sm:h-8 sm:px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <IconGlobe className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" />
                    <span className="hidden sm:inline text-xs text-[color:var(--text-muted)] font-medium pointer-events-none">{LANGS[lang]}</span>
                </summary>
                <div className="fixed inset-0 z-40 hidden group-open/lang:block" onClick={closeAllMenus} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[110px] hidden group-open/lang:block">
                    {Object.entries(LANGS).map(([code, name]) => (
                        <button key={code} onClick={e => { setLang(code); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border)] transition-colors">
                            <span className="text-[10px] font-bold uppercase text-[color:var(--text-faint)] w-5">{code}</span>
                            <span className={lang === code ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)]"}>{name}</span>
                        </button>
                    ))}
                </div>
            </details>

            <details className="relative group/mode" onKeyDown={closeOnEscape}>
                <summary aria-label={t("modeAuto")} onClick={e => closeOtherMenus(e.currentTarget.closest('details'))} className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] relative z-50 rounded h-9 px-3 sm:h-8 sm:px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    {colorMode === "dark" ? <IconMoon className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" /> : colorMode === "light" ? <IconSun className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" /> : <IconMonitor className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" />}
                    <span className="hidden sm:inline text-xs text-[color:var(--text-muted)] font-medium pointer-events-none">{colorMode === "auto" ? t("modeAuto") : colorMode === "dark" ? t("modeDark") : t("modeLight")}</span>
                </summary>
                <div className="fixed inset-0 z-40 hidden group-open/mode:block" onClick={closeAllMenus} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[100px] hidden group-open/mode:block">
                    {["auto", "dark", "light"].map(mode => (
                        <button key={mode} onClick={e => { setColorMode(mode); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border)] transition-colors">
                            {mode === "dark" ? <IconMoon className="w-3 h-3 text-[color:var(--text-muted)]" /> : mode === "light" ? <IconSun className="w-3 h-3 text-[color:var(--text-muted)]" /> : <IconMonitor className="w-3 h-3 text-[color:var(--text-muted)]" />}
                            <span className={colorMode === mode ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)]"}>{mode === "auto" ? t("modeAuto") : mode === "dark" ? t("modeDark") : t("modeLight")}</span>
                        </button>
                    ))}
                </div>
            </details>
            
            <details className="relative group/theme" onKeyDown={closeOnEscape}>
                <summary aria-label={t("themeDefault")} onClick={e => closeOtherMenus(e.currentTarget.closest('details'))} className="flex items-center gap-1.5 bg-[color:var(--bg)] border border-[color:var(--border-hover)] text-[color:var(--text-muted)] hover:border-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text)] relative z-50 rounded h-9 px-3 sm:h-8 sm:px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <IconPalette className="w-3.5 h-3.5 text-[color:var(--text-muted)] pointer-events-none" />
                    <span className="w-2.5 h-2.5 rounded-full border border-[color:var(--border-hover)] pointer-events-none" style={{ background: "var(--accent)" }} />
                    <span className="hidden sm:inline text-xs text-[color:var(--text-muted)] font-medium pointer-events-none">{theme === "default" ? t("themeDefault") : theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                </summary>
                <div className="fixed inset-0 z-40 hidden group-open/theme:block" onClick={closeAllMenus} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-hover)] rounded-md shadow-xl overflow-hidden z-50 min-w-[130px] hidden group-open/theme:block max-h-[60vh] overflow-y-auto">
                    {Object.keys(THEMES).map(th => (
                        <button key={th} onClick={e => { setTheme(th); e.currentTarget.closest('details').removeAttribute('open'); }} className="w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 hover:bg-[color:var(--border)] transition-colors">
                            <span className="w-2.5 h-2.5 rounded-full border border-[color:var(--border-hover)] shrink-0" style={{ background: THEMES[th][isDarkResolved ? "dark" : "light"].accent }} />
                            <span className={theme === th ? "text-[color:var(--text)] font-medium" : "text-[color:var(--text-muted)]"}>{th === "default" ? t("themeDefault") : th.charAt(0).toUpperCase() + th.slice(1)}</span>
                        </button>
                    ))}
                </div>
            </details>
        </div>;
});

export default ThemeSwitcher;
