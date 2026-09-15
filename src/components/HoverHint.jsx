/* eslint-disable react-refresh/only-export-components -- shared module: components + fullTimestamp helper (by design) */
import { useState, useCallback, useEffect, memo, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { useI18n, LOCALES, relTime } from "../i18n.js";

export function fullTimestamp(utc, lang) {
  if (utc == null || isNaN(utc)) return "";
  return new Date(utc * 1000).toLocaleString(LOCALES[lang] || "en", {
    dateStyle: "medium",
    timeStyle: "long"
  });
}

export const HoverTime = memo(function HoverTime({
  utc
}) {
  const { lang } = useI18n();
  return <HoverHint className="inline-block" hint={fullTimestamp(utc, lang)}>
            {relTime(utc, lang)}
        </HoverHint>;
});

export const HoverHint = memo(function HoverHint({
  hint,
  className = "",
  children
}) {
  const [pos, setPos] = useState(null);
  const rafRef = useRef(null);
  const lastEvRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, []);
  const track = useCallback(e => {
    lastEvRef.current = e;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      const ev = lastEvRef.current;
      rafRef.current = null;
      if (!ev || !mountedRef.current) return;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      setPos({ x: vw ? Math.min(ev.clientX + 14, vw - 180) : ev.clientX + 14, y: ev.clientY + 14 });
    });
  }, []);
  const leave = useCallback(() => {
    lastEvRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (mountedRef.current) setPos(null);
  }, []);
  // Safety: if mouse leaves window, tooltip would otherwise get stuck.
  // Listeners exist only while a tooltip is visible (pos != null), so 100s
  // of mounted instances cost zero window listeners at rest. Scroll uses
  // passive capture to avoid blocking scroll on long result lists.
  useEffect(() => {
    if (!pos) return;
    const onWinLeave = () => leave();
    const onScroll = () => leave();
    window.addEventListener("mouseleave", onWinLeave);
    window.addEventListener("blur", onWinLeave);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("mouseleave", onWinLeave);
      window.removeEventListener("blur", onWinLeave);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [pos, leave]);
  const hintId = useId();
  const showAtAnchor = useCallback((e) => {
    try {
      const r = e.currentTarget?.getBoundingClientRect?.();
      if (r) {
        setPos({ x: Math.min(r.left, (window.innerWidth || 0) - 180), y: r.bottom + 6 });
        return;
      }
    } catch { /* ignore */ }
    setPos({ x: 16, y: 16 });
  }, []);
  return <div className={className} tabIndex={0} role="button" aria-describedby={pos ? hintId : undefined} onMouseEnter={track} onMouseMove={track} onMouseLeave={leave} onPointerLeave={leave} onMouseOut={leave} onFocus={showAtAnchor} onBlur={leave} onClick={showAtAnchor} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") showAtAnchor(e); if (e.key === "Escape") leave(); }}>
            {children}
            {pos && createPortal(
                <span id={hintId} role="tooltip" className="pointer-events-none fixed z-[100] whitespace-nowrap rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] px-2 py-1 text-[11px] text-[color:var(--text)] shadow-lg shadow-black/40" style={{ left: pos.x, top: pos.y }}>
                    {hint}
                </span>,
                document.body
            )}
        </div>;
});
