/**
 * Run → Context.
 *
 * One request at a time: the request history card selects it, the trend shows
 * the whole run, and the fold browser lists every category the request carried.
 * Categories contain compact rows; only the selected row renders its content.
 * A single system prompt reads directly, without a redundant item disclosure.
 *
 * Values keep the two accounting rules from the projection: provider input is a
 * measurement; category and item token counts are estimates. Where the provider
 * total was not recorded the view says so instead of deriving one.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText, Layers, Zap } from 'lucide-react'
import type { TrajectorySnapshot } from './trajectory-contract'
import {
  contextTotal,
  deriveRequestContextEvents,
  deriveRequestContexts,
  CONTEXT_CATEGORY_ORDER,
  requestContextDelta,
  type TrajectoryContextItem,
} from './trajectory-context'
import { buildTrendBars, categoryColor, categoryLabelKey, formatDelta, formatExactTokens, formatTokens, trendAxisMaximum } from './run-model'
import { RunTrendChart, trendValueLabel } from './RunCharts'
import { ContextEntry } from './RunContextEntry'
import { contextItemChanges, type ContextContentMode, type ContextReadItem } from './RunContextChanges'
import { RunContextList } from './RunContextList'
import css from './run-view.module.css'

export interface RunContextViewProps {
  snapshot: TrajectorySnapshot
  focusedRequestSeq?: number
  /** Category to reveal when another Run view links here. */
  focusCategory?: string
  onRequestFocus?: (requestSeq: number) => void
  onOpenChat?: (messageId: string) => void
  onOpenFile?: (path: string) => void
}

const MAX_TREND_BARS = 72
const MAX_ITEMS_PER_CATEGORY = 50

export function RunContextView({ snapshot, focusedRequestSeq, focusCategory, onRequestFocus, onOpenChat, onOpenFile }: RunContextViewProps) {
  const { t } = useTranslation()
  const contexts = useMemo(() => deriveRequestContexts(snapshot), [snapshot])
  const events = useMemo(() => deriveRequestContextEvents(snapshot, contexts), [snapshot, contexts])
  // null follows the latest request; an explicit selection remains pinned.
  const [selectedSeq, setSelectedSeq] = useState<number | null>(() => focusedRequestSeq ?? null)
  const [trendMode, setTrendMode] = useState<'total' | 'delta'>('total')
  const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<string>>(() => new Set())
  const [visibleLimits, setVisibleLimits] = useState<Readonly<Record<string, number>>>({})
  const [openEntries, setOpenEntries] = useState<Readonly<Record<string, string | undefined>>>({})
  const [contentMode, setContentMode] = useState<ContextContentMode>('original')
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (focusedRequestSeq !== undefined && contexts.some(context => context.requestSeq === focusedRequestSeq)) {
      setSelectedSeq(focusedRequestSeq)
    }
  }, [contexts, focusedRequestSeq])

  useEffect(() => {
    if (!focusCategory) return
    setExpandedCategories(currentSet => currentSet.has(focusCategory)
      ? currentSet
      : new Set([...currentSet, focusCategory]))
  }, [focusCategory, selectedSeq])

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const selectedIndex = contexts.findIndex(context => context.requestSeq === selectedSeq)
  const index = selectedIndex < 0 ? contexts.length - 1 : selectedIndex
  const current = contexts[index]
  const previous = index > 0 ? contexts[index - 1] : undefined
  const delta = current ? requestContextDelta(current, previous) : undefined
  const latestSeq = contexts.at(-1)?.requestSeq
  const exact = current?.inputTokens !== undefined
  const bars = useMemo(() => buildTrendBars(contexts, MAX_TREND_BARS, trendMode), [contexts, trendMode])
  const axisMaximum = trendAxisMaximum(bars, trendMode)
  const compactionSeqs = useMemo(() => new Set(events.filter(event => event.kind === 'compaction').map(event => event.requestSeq)), [events])

  const selectRequest = (requestSeq: number) => {
    setSelectedSeq(requestSeq)
    onRequestFocus?.(requestSeq)
  }

  const toggleCategory = (category: string) => {
    setExpandedCategories(currentSet => {
      const next = new Set(currentSet)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const copyItem = async (item: TrajectoryContextItem, content: string) => {
    setCopyError(null)
    setCopied(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(content)
      setCopied(item.id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(null), 1600)
    } catch {
      setCopyError(item.id)
    }
  }

  if (!current) {
    return <div className={css.view}><div className={css.emptyState}><Layers /><p>{t('run.context.empty')}</p></div></div>
  }

  const mode = previous ? contentMode : 'original'
  const groups = CONTEXT_CATEGORY_ORDER.flatMap(category => {
    const active = current.groups.find(group => group.category === category)
    if (active) return [active]
    const old = mode === 'changes' ? previous?.groups.find(group => group.category === category) : undefined
    return old ? [{ ...old, items: [], chars: 0, estimatedTokens: 0, share: 0 }] : []
  })
  const renderItem = (item: ContextReadItem, embedded: boolean) => (
    <ContextEntry key={item.id} item={item} embedded={embedded}
      categoryLabel={t(categoryLabelKey(item.category))} mode={mode}
      copied={copied === item.id} copyError={copyError === item.id} previousSeq={previous?.requestSeq} requestSeq={current.requestSeq}
      onCopy={content => { void copyItem(item, content) }} onOpenChat={onOpenChat} onOpenFile={onOpenFile} />
  )

  const allExpanded = groups.length > 0 && groups.every(group => expandedCategories.has(group.category))
  const currentTotal = contextTotal(current)

  return (
    <div className={css.view}>
      <div className={css.viewInner}>
        <section className={`${css.paper} ${css.contextTrend}`} data-run-context-history>
          <div className={css.paperHead}>
            <div className={css.contextHistoryTitle}>
              <h3>{t('run.context.requestHistory')}</h3>
              <select
                className={`${css.requestPicker} craft-field-input`}
                aria-label={t('run.context.selectRequest')}
                value={current.requestSeq}
                onChange={event => selectRequest(Number(event.target.value))}
              >
                {contexts.map(context => (
                  <option key={context.id} value={context.requestSeq}>
                    {t('run.context.requestOption', { seq: context.requestSeq, total: contexts.length })}{context.requestSeq === latestSeq ? ` · ${t('run.context.latest')}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className={css.segmented} role="group" aria-label={t('run.context.trendMode')}>
              <button type="button" aria-pressed={trendMode === 'total'} onClick={() => setTrendMode('total')} className="craft-control">{t('run.context.trendTotal')}</button>
              <button type="button" aria-pressed={trendMode === 'delta'} onClick={() => setTrendMode('delta')} className="craft-control">{t('run.context.trendDelta')}</button>
            </div>
          </div>
          <RunTrendChart
            bars={bars}
            mode={trendMode}
            axisMaximum={axisMaximum}
            selectedSeq={current.requestSeq}
            markerSeqs={compactionSeqs}
            markerLabel={t('run.overview.compactedMarker')}
            label={trendMode === 'delta' ? t('run.context.trendDeltaLabel') : t('run.context.trendTotalLabel')}
            onSelect={selectRequest}
            valueLabel={bar => trendValueLabel(bar, trendMode, t('run.request'))}
          />
          <div className={css.trendSelection}>
            <span>
              <strong className={css.tabular}>{formatTokens(currentTotal)} tokens</strong>
              <span className={`${css.statusBadge} ${current.captured ? css.statusSuccess : css.statusWarning}`}>
                <span className={css.statusDot} />{current.captured ? t('run.context.captured') : t('run.context.reconstructed')}
              </span>
              <span className={css.muted}>{t('run.context.deltaFromPrevious', { delta: formatDelta(delta) })}</span>
            </span>
            <span className={css.muted}>
              {exact
                ? t('run.context.providerInput', { input: formatExactTokens(current.inputTokens) })
                : t('run.context.providerInputMissing')}
            </span>
          </div>
        </section>

        <section className={css.paper} data-run-context-browser>
          <div className={css.paperHead}>
            <h3>{t('run.context.requestContent')}</h3>
            <div className={css.foldCardActions}>
              <span>{previous ? t('run.context.comparedWith', { seq: previous.requestSeq }) : t('run.context.firstRequestNoDiff')}</span>
              <div className={css.segmented} role="group" aria-label={t('run.context.contentMode')}>
                <button type="button" className="craft-control" aria-pressed={mode === 'original'} onClick={() => setContentMode('original')}>{t('run.context.mode.raw')}</button>
                <button type="button" className="craft-control" aria-pressed={mode === 'changes'} disabled={!previous} onClick={() => setContentMode('changes')}>{t('run.context.mode.diff')}</button>
              </div>
              <button
                type="button"
                className={`${css.quietButton} craft-control`}
                onClick={() => setExpandedCategories(allExpanded ? new Set() : new Set(groups.map(group => group.category)))}
              >
                {allExpanded ? t('run.context.collapseAll') : t('run.context.expandAll')}
              </button>
            </div>
          </div>
          <div className={css.foldBrowserBody}>
            <div className={css.foldRequestLine}>
              <strong>{current.requestSeq === latestSeq && latestSeq !== undefined
                ? t('run.context.requestLatest', { seq: current.requestSeq })
                : t('run.requestNumber', { seq: current.requestSeq })}</strong>
              <span className={css.tabular}>{t('run.context.estimatedTotal', { tokens: formatTokens(current.estimatedTokens) })}</span>
              {current.provider && <span>{current.provider}{current.model ? ` · ${current.model}` : ''}</span>}
            </div>
            <div className={css.foldComposition} role="img" aria-label={t('run.context.compositionLabel', { seq: current.requestSeq })}>
              {current.groups.map(group => (
                <span
                  key={group.category}
                  style={{ '--cat': categoryColor(group.category), width: `${group.share * 100}%` } as CSSProperties}
                  title={`${t(categoryLabelKey(group.category))} · ≈${formatTokens(group.estimatedTokens)}`}
                />
              ))}
            </div>
            <div className={css.contextFolds}>
              {groups.map(group => {
                const previousGroup = previous?.groups.find(entry => entry.category === group.category)
                const items = mode === 'changes' ? contextItemChanges(group.items, previousGroup?.items ?? []) : group.items
                const countChange = previous ? group.items.length - (previousGroup?.items.length ?? 0) : 0
                const tokenChange = previous ? group.estimatedTokens - (previousGroup?.estimatedTokens ?? 0) : 0
                const open = expandedCategories.has(group.category)
                const limit = visibleLimits[group.category] ?? MAX_ITEMS_PER_CATEGORY
                // Retained entries can be previews of what the provider saw, so
                // their tokens are presented as this category's estimated split.
                const itemEstimate = group.items.reduce((sum, entry) => sum + entry.estimatedTokens, 0)
                const tokenScale = itemEstimate > 0 ? group.estimatedTokens / itemEstimate : 1
                return (
                  <details
                    key={group.category}
                    className={css.contextFold}
                    open={open}
                    data-context-category={group.category}
                    onToggle={event => {
                      const next = (event.currentTarget as HTMLDetailsElement).open
                      if (next !== open) toggleCategory(group.category)
                    }}
                  >
                    <summary>
                      <span className={css.foldRowLabel}>
                        <ChevronRight />
                        <i className={css.categoryDot} style={{ '--cat': categoryColor(group.category) } as CSSProperties} />
                        <strong>{t(categoryLabelKey(group.category))}</strong>
                        <span className={css.foldCount}>{t('run.context.itemCount', { count: group.items.length })}</span>
                        {countChange !== 0 && <ChangeChip value={countChange} />}
                      </span>
                      <span className={css.foldRowValues}>
                        {tokenChange !== 0 && <ChangeChip value={tokenChange} />}
                        <span className={css.foldTokens}>≈{formatTokens(group.estimatedTokens)}</span>
                        <span className={css.foldShare}>{(group.share * 100).toFixed(1)}%</span>
                      </span>
                    </summary>
                    {open && <div className={css.foldCategoryBody}>
                      {items.length === 0 ? <p className={css.foldCategoryNote}>{t(mode === 'changes' ? 'run.context.noContentChanges' : 'run.context.groupWithoutItems')}</p>
                        : group.category === 'system' ? items.map(item => renderItem(item, false))
                          : <RunContextList items={items} tokenScale={tokenScale} limit={limit}
                            openId={openEntries[group.category]}
                            onOpenChange={id => setOpenEntries(entries => ({ ...entries, [group.category]: id }))}
                            onLoadMore={() => setVisibleLimits(limits => ({ ...limits, [group.category]: limit + MAX_ITEMS_PER_CATEGORY }))}
                            renderItem={item => renderItem(item, true)} />}
                    </div>}
                  </details>
                )
              })}
            </div>
            <p className={css.miniNote}>{t('run.context.groupNote')}</p>
          </div>
        </section>

        {events.length > 0 && (
          <div className={css.contextEvents}>
            <strong>{t('run.context.events')}</strong>
            {events.map(event => (
              <button
                key={`${event.kind}-${event.requestSeq}`}
                type="button"
                className={`${css.eventLink} craft-control`}
                onClick={() => selectRequest(event.requestSeq)}
              >
                {event.kind === 'compaction' ? <Zap /> : <FileText />}
                {event.kind === 'compaction'
                  ? t('run.context.eventCompaction', { seq: event.requestSeq, delta: formatDelta(event.deltaTokens) })
                  : t('run.context.eventPrompt', { seq: event.requestSeq })}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ChangeChip({ value }: { value: number }) {
  return (
    <span className={`${css.changeChip} ${value > 0 ? css.changePositive : css.changeNegative}`}>
      {value > 0 ? '+' : '−'}{formatTokens(Math.abs(value))}
    </span>
  )
}
