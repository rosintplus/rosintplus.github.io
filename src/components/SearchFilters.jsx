import { useI18n } from '../i18n.js';

export function SearchFilters({ mode, dateFrom, dateTo, setDateFrom, setDateTo, subreddit, setSubreddit, urlQuery, setUrlQuery, deletedOnly, setDeletedOnly, showNsfw, setShowNsfw, showSpoilers, setShowSpoilers, onCommit, onClear }) {
  const { t } = useI18n();
  const inputClass = 'w-full min-w-0 h-8 rounded border border-[color:var(--border-hover)] bg-[color:var(--bg)] px-2 text-[11px] text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]';
  const commitOnEnter = event => {
    if (event.key === 'Enter') { event.preventDefault(); onCommit(); }
  };
  return <div id="home-search-filters" className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border border-[color:var(--border-hover)] bg-[color:var(--bg-elevated)] p-3 shadow-sm shadow-black/10">
    <div className={`grid grid-cols-2 gap-2 ${mode === 'username' ? 'sm:grid-cols-[minmax(130px,0.8fr)_minmax(130px,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]' : 'sm:grid-cols-[minmax(130px,0.8fr)_minmax(130px,0.8fr)_minmax(0,1.2fr)]'}`}>
      <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[color:var(--text-muted)]">
        {t('from')}
        <input type="date" max={dateTo || undefined} value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputClass} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[color:var(--text-muted)]">
        {t('to')}
        <input type="date" min={dateFrom || undefined} value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputClass} />
      </label>
      {mode === 'username' && <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[color:var(--text-muted)]">
        {t('modeSubreddit')}
        <input type="text" value={subreddit} onChange={e => setSubreddit(e.target.value.replace(/^r\//, ''))} onBlur={onCommit} onKeyDown={commitOnEnter} placeholder="r/…" className={inputClass} />
      </label>}
      <label className={`${mode === 'subreddit' ? 'col-span-2 sm:col-span-1' : ''} flex min-w-0 flex-col gap-1 text-[11px] text-[color:var(--text-muted)]`}>
        {t('externalLink')}
        <input type="text" value={urlQuery} onChange={e => setUrlQuery(e.target.value)} onBlur={onCommit} onKeyDown={commitOnEnter} placeholder="https://…" title={t('urlPrefixHint')} className={inputClass} />
      </label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[color:var(--border)] pt-2 text-[11px] text-[color:var(--text-muted)]">
      {[[t('deletedOnly'), deletedOnly, setDeletedOnly], [t('showNsfw'), showNsfw, setShowNsfw], [t('showSpoilers'), showSpoilers, setShowSpoilers]].map(([label, checked, setChecked]) => <label key={label} className="flex items-center gap-1.5 cursor-pointer select-none">
        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--accent)]" />
        {label}
      </label>)}
      <button type="button" onClick={onClear} className="ml-auto text-[color:var(--accent-text)] hover:underline">{t('clear')}</button>
    </div>
  </div>;
}
