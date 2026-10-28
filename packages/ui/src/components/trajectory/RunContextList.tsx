/** Compact category rows; only the selected row mounts its retained content. */
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { ContextReadItem } from './RunContextChanges'
import { formatTokens } from './run-model'
import css from './run-view.module.css'

function previewOf(item: ContextReadItem): string {
  for (const key of ['description', 'command', 'path', 'file_path', 'filePath', 'pattern', 'query', 'url']) {
    const value = item.toolArguments?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim().split('\n')[0]!
  }
  return item.label || item.content.replace(/\s+/g, ' ').slice(0, 160)
}

export function RunContextList({ items, limit, openId, onOpenChange, onLoadMore, renderItem }: {
  items: readonly ContextReadItem[]
  limit: number
  openId?: string
  onOpenChange: (id: string | undefined) => void
  onLoadMore: () => void
  renderItem: (item: ContextReadItem) => ReactNode
}) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return [...items].reverse().filter(item => !needle ||
      [item.label, item.source, item.toolName, item.content].some(value => value?.toLocaleLowerCase().includes(needle)))
  }, [items, query])
  const time = useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }), [i18n.resolvedLanguage])
  const visible = matches.slice(0, limit)
  return (
    <div className={css.contextRows}>
      {items.length > 1 && <div className={css.contextRowsToolbar}>
        <input type="search" className={`${css.contextRowsSearch} craft-field-input`} aria-label={t('run.context.filterEntries')} placeholder={t('run.context.filterEntries')} value={query} onChange={event => setQuery(event.target.value)} />
        <span className={css.contextRowsCount}>{t('run.context.filterMatches', { shown: visible.length, total: matches.length })}</span>
      </div>}
      {visible.map(item => {
        const open = openId === item.id
        const preview = previewOf(item)
        const bodyId = `${id}-${item.id}`
        return (
          <div key={item.id} className={css.contextRowItem} data-context-item={item.id} data-open={open} data-change={item.change}>
            <button type="button" className={`${css.contextRow} craft-control`} data-context-row aria-expanded={open} aria-controls={bodyId} onClick={() => onOpenChange(open ? undefined : item.id)}>
              <ChevronRight className={css.contextRowChevron} />
              {item.toolStatus === 'failed' && <i className={css.contextRowFailure} aria-label={t('run.context.toolFailed')} />}
              {item.toolName && <span className={css.contextRowTag}>{item.toolName}</span>}
              <span className={css.contextRowPreview} title={preview}>{preview}</span>
              {item.change && <span className={`${css.contextChangeTag} ${item.change === 'removed' ? css.changeNegative : css.changePositive}`}>{t(`run.context.change.${item.change}`)}</span>}
              {item.timestamp !== undefined && <time className={css.contextRowTime} dateTime={new Date(item.timestamp).toISOString()}>{time.format(item.timestamp)}</time>}
              <span className={css.entryTokens} data-context-item-tokens={item.estimatedTokens}>≈{formatTokens(item.estimatedTokens)}</span>
            </button>
            {open && <div id={bodyId} className={css.contextRowDetails}>{renderItem(item)}</div>}
          </div>
        )
      })}
      {matches.length === 0 && <p className={css.foldCategoryNote}>{t('run.context.noMatchingEntries')}</p>}
      {matches.length > visible.length && <div className={css.loadMoreRow}>
        <span className={css.miniNote}>{t('run.context.olderItemsOmitted', { count: matches.length - visible.length })}</span>
        <button type="button" className={`${css.outlineButton} craft-control`} onClick={onLoadMore}>{t('run.context.loadMore')}</button>
      </div>}
    </div>
  )
}
