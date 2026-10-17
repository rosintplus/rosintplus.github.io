import { useRef } from 'react';
import { useI18n } from '../i18n.js';

export function SearchFilters({
  mode,
  dateFrom, dateTo, setDateFrom, setDateTo,
  subreddit, setSubreddit,
  urlQuery, setUrlQuery,
  deletedOnly, setDeletedOnly,
  showNsfw, setShowNsfw,
  showSpoilers, setShowSpoilers,
  onCommit, onClear,
}) {
  const { t } = useI18n();
  const focusValRef = useRef(null);
  const trackFocus = e => { focusValRef.current = e.target.value; };
  const commitOnBlur = e => { if (e.target.value !== focusValRef.current) onCommit(); };
  const inputClass = 'w-full min-w-0 h-8 rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] px-2 text-[11px] text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]';
  const labelClass = 'flex min-w-0 flex-col gap-2 text-[11px] text-[color:var(--text-muted)]';
  const toggleFilters = [
    { label: t('deletedOnly'), checked: deletedOnly, setChecked: setDeletedOnly },
    { label: t('showNsfw'), checked: showNsfw, setChecked: setShowNsfw },
    { label: t('showSpoilers'), hint: t('spoilersHint'), checked: showSpoilers, setChecked: setShowSpoilers },
  ];
  const commitOnEnter = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onCommit();
  };
  const gridCols = mode === 'username' ? 'sm:grid-cols-4' : 'sm:grid-cols-3';
  return <div id="home-search-filters" className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border border-[color:var(--border-hover)] bg-[color:var(--bg-elevated)] p-3 shadow-sm">
    <div className={`grid grid-cols-1 ${gridCols} gap-2`}>
      <label className={labelClass}>
        {t('from')}
        <input type="date" max={dateTo || undefined} value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputClass} />
      </label>
      <label className={labelClass}>
        {t('to')}
        <input type="date" min={dateFrom || undefined} value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputClass} />
      </label>
      {mode === 'username' && (
        <label className={labelClass}>
          {t('modeSubreddit')}
          <input type="text" value={subreddit} onChange={e => setSubreddit(e.target.value.replace(/^r\//i, ''))} onFocus={trackFocus} onBlur={commitOnBlur} onKeyDown={commitOnEnter} placeholder="r/…" className={inputClass} />
        </label>
      )}
      <label className={`${mode === 'subreddit' ? 'sm:col-span-1' : ''} ${labelClass}`}>
        {t('externalLink')}
        <input type="text" value={urlQuery} onChange={e => setUrlQuery(e.target.value)} onFocus={trackFocus} onBlur={commitOnBlur} onKeyDown={commitOnEnter} placeholder={t("externalLinkPlaceholder")} title={t('urlPrefixHint')} className={inputClass} />
      </label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[color:var(--border)] pt-2 text-[11px] text-[color:var(--text-muted)]">
      {toggleFilters.map(({ label, hint, checked, setChecked }) => <label key={label} title={hint} className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--accent)]" />
        {label}
      </label>)}
      <button type="button" onClick={onClear} className="ml-auto text-[color:var(--accent-text)] hover:underline">{t('clear')}</button>
    </div>
  </div>;
}