import { memo, useState, useMemo, useEffect, useRef } from "react";
import { readStoredList, FLEX_1 } from "../constants.js";
import { normalizeUsername, normalizeSubreddit } from "../utils.js";
import { getSavedUsernames } from "../profileData.js";
import { IconSearch } from "./icons.jsx";
import { useI18n } from "../i18n.js";

export const SearchBar = memo(function SearchBar({
  defaultQuery,
  onSearch,
  initialLoading,
  mode = "username"
}) {
  const { t } = useI18n();
  const RECENT_KEYS = { username: "rosint-recent", subreddit: "rosint-recent-subs", post: "rosint-recent-posts" };
  const loadRecent = readStoredList;
  const [recentMap, setRecentMap] = useState(() => ({
    username: loadRecent("rosint-recent"),
    subreddit: loadRecent("rosint-recent-subs"),
    post: loadRecent("rosint-recent-posts")
  }));
  const recent = useMemo(() => recentMap[mode] || [], [recentMap, mode]);
  const setRecent = list => setRecentMap(m => ({ ...m, [mode]: list }));
  const [username, setUsername] = useState(defaultQuery);
  const [focused, setFocused] = useState(false);
  const [savedUsers, setSavedUsers] = useState([]);
  const inputRef = useRef(null);
  useEffect(() => {
    const fetchSaved = () => getSavedUsernames().then(setSavedUsers);
    fetchSaved();
    window.addEventListener('savedUsersChanged', fetchSaved);
    window.addEventListener('storage', fetchSaved);
    return () => {
      window.removeEventListener('savedUsersChanged', fetchSaved);
      window.removeEventListener('storage', fetchSaved);
    };
  }, []);
  
  const MAX_DROPDOWN = 5;
  const addRecent = (user) => {
    try {
      const savedSet = new Set(savedUsers.map(u => u.toLowerCase()));
      if (savedSet.has(user.toLowerCase())) return;
      const room = Math.max(0, MAX_DROPDOWN - savedUsers.length);
      const current = readStoredList(RECENT_KEYS[mode]);
      const next = [user, ...current.filter(u => u !== user && !savedSet.has(u.toLowerCase()))].slice(0, room);
      localStorage.setItem(RECENT_KEYS[mode], JSON.stringify(next));
      setRecent(next);
    } catch (e) {
      console.error(e);
    }
  };

  const removeRecent = (e, user) => {
    e.stopPropagation();
    try {
      const current = readStoredList(RECENT_KEYS[mode]);
      const next = current.filter(u => u !== user);
      localStorage.setItem(RECENT_KEYS[mode], JSON.stringify(next));
      setRecent(next);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSubmit = e => {
    if (e) e.preventDefault();
    const user = username.trim();
    if (!user) return;
    if (mode === "post") {
      const raw = user;
      addRecent(raw);
      inputRef.current?.blur();
      onSearch(raw);
      return;
    }
    const normalized = mode === "subreddit" ? normalizeSubreddit(user) : normalizeUsername(user);
    if (!normalized) return;
    addRecent(normalized);
    inputRef.current?.blur();
    onSearch(normalized);
  };

  const handleRecentClick = (user) => {
    if (mode === "post") {
      setUsername(user);
      addRecent(user);
      setFocused(false);
      onSearch(user);
      return;
    }
    const normalized = mode === "subreddit" ? normalizeSubreddit(user) : normalizeUsername(user);
    if (!normalized) return;
    setUsername(normalized);
    addRecent(normalized);
    setFocused(false);
    onSearch(normalized);
  };

  const filteredSaved = useMemo(() => savedUsers.filter(r => r.toLowerCase().includes(username.trim().toLowerCase())), [savedUsers, username]);
  const maxDropdown = MAX_DROPDOWN;
  const filteredRecent = useMemo(() => {
    const room = Math.max(0, maxDropdown - filteredSaved.length);
    const savedLower = new Set(savedUsers.map(s => s.toLowerCase()));
    return recent.filter(r => r.toLowerCase().includes(username.trim().toLowerCase()) && !savedLower.has(r.toLowerCase())).slice(0, room);
  }, [recent, savedUsers, username, maxDropdown, filteredSaved.length]);

  return <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative" style={FLEX_1} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
                {mode !== "post" && <span className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] text-sm font-medium">{mode === "subreddit" ? "r/" : "u/"}</span>}
                <input ref={inputRef} aria-label="Search user" type="text" value={username} onChange={e => setUsername(e.target.value)} onFocus={() => setFocused(true)} placeholder={mode === "subreddit" ? t("subredditPlaceholder") : mode === "post" ? t("searchPlaceholderPost") : t("searchPlaceholder")} name="search_query_osint" id="search_query_osint" autoComplete="off" data-bwignore="true" data-lpignore="true" data-1p-ignore="true" spellCheck="false" className={`w-full bg-[color-mix(in_srgb,var(--bg-elevated)_50%,var(--bg))] border border-[color:var(--border-hover)] rounded py-2.5 text-sm text-[color:var(--text)] placeholder-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)] transition-colors ${mode === "post" ? "pl-4 pr-10" : "pl-[32px] pr-10"}`} onClick={() => setFocused(true)} onKeyDown={e => { if (e.key === "Escape") { setFocused(false); inputRef.current?.blur(); } }} />
                {username && (
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setUsername(""); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--accent-text)] transition-colors p-1" aria-label="Clear search">
                        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                )}
                
                {focused && (filteredRecent.length > 0 || filteredSaved.length > 0) && (
                  <div onMouseDown={e => e.preventDefault()} className="absolute top-full left-0 right-0 mt-1 bg-[color:var(--bg)] border border-[color:var(--border-hover)] rounded-md shadow-lg overflow-hidden z-50">
                    {mode === "username" && filteredSaved.length > 0 && (
                      <>
                        <div className="px-4 py-3 text-[12px] font-medium text-[color:var(--text-muted)]">{t("savedProfiles")}</div>
                        {filteredSaved.map(r => (
                          <button type="button" key={r} onClick={() => handleRecentClick(r)} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--bg-elevated)] cursor-pointer group transition-colors">
                            <svg className="w-[18px] h-[18px] text-[color:var(--text-muted)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                            <span className="text-[14px] font-medium text-[color:var(--text)] truncate">{r}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {filteredRecent.length > 0 && (
                      <>
                        <div className="px-4 py-3 text-[12px] font-medium text-[color:var(--text-muted)]">{t("recent")}</div>
                        {filteredRecent.map(r => (
                          <div key={r} className="flex items-center hover:bg-[color:var(--bg-elevated)] group transition-colors">
                            <button type="button" onClick={() => handleRecentClick(r)} className="flex items-center gap-3 flex-1 min-w-0 text-left px-4 py-2.5 cursor-pointer">
                              <svg className="w-[18px] h-[18px] text-[color:var(--text-muted)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              <span className="text-[14px] font-medium text-[color:var(--text)] truncate">{r}</span>
                            </button>
                            <button type="button" onClick={(e) => removeRecent(e, r)} className="text-[color:var(--text-muted)] hover:text-[color:var(--text)] transition-colors p-1 mr-3 flex-shrink-0" aria-label={`Remove ${r} from recent searches`}>
                              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
            </div>
                <button type="submit" disabled={!username.trim() || initialLoading} className="flex items-center justify-center bg-[color:var(--accent)] text-[color:var(--bg)] border border-[color:var(--accent)] [&:not(:disabled)]:hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--text-base))] disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm px-5 py-2.5 rounded transition-all flex-shrink-0 leading-none">
                <span className="inline-flex items-center justify-center w-5 h-5 -mt-[1px]">
                    {initialLoading ? <span className="w-5 h-5 inline-block flex-shrink-0 rounded-full border-[3px] border-[color:color-mix(in_srgb,var(--bg)_35%,transparent)] border-t-[color:var(--bg)] animate-spin" aria-hidden="true"></span> : <IconSearch />}
                </span>
            </button>
        </form>;
});

export default SearchBar;
