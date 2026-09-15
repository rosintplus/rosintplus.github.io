import { memo, useState, useCallback, useEffect, useRef } from "react";
import { useI18n } from "../i18n.js";
import { IconCopy } from "./icons.jsx";

export const CopyButton = memo(function CopyButton({ getText }) {
  const [done, setDone] = useState(false);
  const timerRef = useRef(null);
  const { t } = useI18n();
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const copy = useCallback(async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      try {
        ta.select();
        document.execCommand("copy");
      } catch {
        return;
      } finally {
        document.body.removeChild(ta);
      }
    }
    setDone(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; setDone(false); }, 1200);
  }, [getText]);
  return <button onClick={copy} aria-label={done ? t("copied") : t("copyAria")} title={t("copyTitle")} className={`flex items-center gap-1 transition-colors ${done ? "text-[color:var(--accent)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}`}>
            <IconCopy />{done && <span className="text-[10px]">{t("copied")}</span>}
        </button>;
});

export default CopyButton;
