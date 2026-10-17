import { memo, useRef, useState, useLayoutEffect } from "react";
import { useI18n } from "../i18n.js";

export const ModeSelector = memo(function ModeSelector({
  mode,
  onModeChange
}) {
  const { t, lang } = useI18n();
  const btnRefs = useRef({});
  // Measured synchronously before first paint (layout effect) so the sliding
  // pill and dividers are correctly sized on the very first render — no
  // width-0 flash while waiting for timers.
  const [w, setW] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const els = Object.values(btnRefs.current).filter(Boolean);
      // Tabs are pinned to the current uniform width, so offsetWidth would
      // just echo that width back and freeze it at whatever language was
      // active when it was set. Unpin for one measuring pass to read each
      // label's natural width, then restore.
      const prev = els.map(el => el.style.width);
      els.forEach(el => { el.style.width = "auto"; });
      const widths = els.map(el => el.offsetWidth || 0);
      els.forEach((el, i) => { el.style.width = prev[i]; });
      const max = Math.max(...widths, 0);
      if (max > 0) setW(max);
    };
    measure();
    // Re-measure after fonts load, since tab label widths change.
    let cancelled = false;
    if (document.fonts?.ready) document.fonts.ready.then(() => { if (!cancelled) measure(); });
    // Re-measure on viewport/container resize, not only on language change.
    window.addEventListener("resize", measure);
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      Object.values(btnRefs.current).forEach(el => { if (el) ro.observe(el); });
    }
    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [lang]);
  const modes = ["username", "subreddit", "post"];
  const activeIndex = Math.max(0, modes.indexOf(mode));
  const onTabsKeyDown = e => {
    let next = null;
    if (e.key === "ArrowRight") next = modes[(activeIndex + 1) % modes.length];
    else if (e.key === "ArrowLeft") next = modes[(activeIndex - 1 + modes.length) % modes.length];
    else if (e.key === "Home") next = modes[0];
    else if (e.key === "End") next = modes[modes.length - 1];
    if (next) {
      e.preventDefault();
      onModeChange(next);
      btnRefs.current[next]?.focus();
    }
  };
  // h-7 buttons inside p-0.5 + 1px border = the same 32px outer height as the
  // h-8 pills beside it (see the style scale in index.css).
  return <div className="relative ml-auto flex w-fit items-stretch rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] p-0.5 select-none overflow-hidden" role="radiogroup" aria-label={t("searchMode")} onKeyDown={onTabsKeyDown}>
            {w && (
              <>
                {activeIndex !== 0 && activeIndex !== 1 && <span aria-hidden="true" className="absolute top-1 bottom-1 w-px bg-[color:var(--border)] pointer-events-none transition-opacity duration-200" style={{ left: `${w + 2}px` }} />}
                {activeIndex !== 1 && activeIndex !== 2 && <span aria-hidden="true" className="absolute top-1 bottom-1 w-px bg-[color:var(--border)] pointer-events-none transition-opacity duration-200" style={{ left: `${2 * w + 2}px` }} />}
              </>
            )}
            <span aria-hidden="true" className="absolute top-0.5 bottom-0.5 left-0.5 rounded border border-[color:var(--border-hover)] bg-[color:var(--bg-elevated)] transition-transform duration-200 ease-out will-change-transform" style={{ width: w ?? 0, transform: `translate3d(${w ? activeIndex * w : 0}px,0,0)` }} />
            {modes.map(m => (
                <button key={m} ref={el => { btnRefs.current[m] = el; }} type="button" role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} onClick={() => onModeChange(m)} className={`relative z-10 flex items-center justify-center px-3 h-7 whitespace-nowrap text-[11px] font-medium rounded transition-colors ${mode === m ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}`} style={w ? { width: w } : undefined}>
                    {m === "post" ? t("modePost") : m === "subreddit" ? t("modeSubreddit") : t("modeUsername")}
                </button>
            ))}
        </div>;
});

export default ModeSelector;
