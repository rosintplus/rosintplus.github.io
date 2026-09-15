import { memo, useCallback } from "react";
import { useI18n } from "../i18n.js";

export const EmptyState = memo(function EmptyState({
  tab,
  hasFilters,
  query,
  mode = "username",
  onSwitchTab,
  onClearFilters,
  deletedOnly,
  nsfwOnly,
  keyword
}) {
  const { t } = useI18n();
  const otherTab = tab === "posts" ? "comments" : "posts";
  const tabWord = tab === "posts" ? t("postsWord") : t("commentsWord");
  const otherTabWord = otherTab === "posts" ? t("postsWord") : t("commentsWord");
  return <div className="text-center py-16 text-[color:var(--text-muted)]">
            <p className="text-sm mb-2">{keyword ? t("emptyKeyword", { tab: tabWord, keyword }) : deletedOnly ? t("emptyDeleted", { tab: tabWord }) : nsfwOnly ? t("emptyNsfw", { tab: tabWord }) : mode === "subreddit" ? t("emptyNoneSub", { tab: tabWord }) : t("emptyNone", { tab: tabWord })}</p>
            <p className="text-[12px] text-[color:var(--text-muted)] mb-4">{t("emptyHint")}</p>
            <div className="flex flex-col items-center gap-2 text-[12px]">
                <button type="button" onClick={onSwitchTab} className="text-[color:var(--accent-text)] hover:underline">
                    {t("switchTo", { tab: otherTabWord })}
                </button>
                {hasFilters && <button type="button" onClick={onClearFilters} className="text-[color:var(--accent-text)] hover:underline">
                        {t("clearRetry")}
                    </button>}
                <a href={mode === "subreddit" ? `https://www.reddit.com/r/${encodeURIComponent(query)}` : `https://www.reddit.com/search/?q=author%3A%22${encodeURIComponent(query)}%22&type=${tab}`} target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent-text)] hover:underline">
                    {t("searchDirectly")}
                </a>
            </div>
        </div>;
});

export const ErrorState = memo(function ErrorState({
  message,
  onRetry
}) {
  const { t } = useI18n();
  return <div className="text-center py-16">
            <p className="text-sm text-red-400 mb-1">{message}</p>
            <p className="text-[11px] text-[color:var(--text-muted)] mb-3">{t("errorHint")}</p>
            {onRetry && <button type="button" onClick={onRetry} className="text-[12px] text-[color:var(--accent-text)] hover:underline">
                    {t("tryAgain")}
                </button>}
            </div>;
});

export const TabBtn = memo(function TabBtn({
  label,
  count,
  countIsPlus,
  active,
  tab,
  onSelect
}) {
  const handleClick = useCallback(() => onSelect(tab), [onSelect, tab]);
  return <button onClick={handleClick} role="tab" aria-selected={active} className={`group/tab relative flex-1 flex items-center justify-center px-2.5 py-2.5 text-[15px] sm:px-4 sm:py-2.5 sm:text-sm font-medium transition-colors ${active ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"}`}>
            {label}
            {(count != null && count !== 0) && <span className={`ml-1.5 text-[13px] px-2 py-0.5 sm:text-[13px] sm:px-2 rounded-full transition-colors ${active ? "bg-[color:var(--accent)] text-[color:var(--bg)] font-bold" : "bg-[color:var(--border)] text-[color:var(--text-muted)] group-hover/tab:bg-[color:var(--border-hover)] group-hover/tab:text-[color:var(--text)]"}`}>
                    {countIsPlus ? `${count}+` : count}
                </span>}
            {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[color:var(--accent)] rounded-t" />}
        </button>;
});
