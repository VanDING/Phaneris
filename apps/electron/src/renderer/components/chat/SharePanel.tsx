import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Copy, Download, LoaderCircle } from 'lucide-react'
import { Markdown, PreviewHeaderIconButton, useInitialFocus } from '@phaneris/ui'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import type { ShareMessage } from '@/lib/share-messages'
import {
  SHARE_IMAGE,
  resolveSharePage,
  type ShareInclude,
  type ShareLayout,
  type ShareOrientation,
  type ShareRatio,
} from '../../../shared/share-image'
import { blobBase64, paginateShareContent, renderSharePng, settleShareContent, ShareImageError } from '@/lib/share-image-renderer'
import { ShareTemplate, type ShareTemplateLabels } from './ShareTemplate'

const errorKeys = {
  resource: 'chat.imageShare.resource', tooLong: 'chat.imageShare.tooLong',
  tooMany: 'chat.imageShare.tooMany', encode: 'chat.imageShare.encode',
} as const
const layoutKeys = { auto: 'chat.imageShare.split', long: 'chat.imageShare.single' } as const

const RATIO_ITEMS: ReadonlyArray<{ id: ShareRatio; label: string }> = [
  { id: 'a4', label: 'A4' },
  { id: '3:4', label: '3:4' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' },
]
const ORIENTATION_ITEMS: ReadonlyArray<{ id: ShareOrientation; labelKey: string }> = [
  { id: 'portrait', labelKey: 'chat.imageShare.portrait' },
  { id: 'landscape', labelKey: 'chat.imageShare.landscape' },
]
const INCLUDE_ITEMS: ReadonlyArray<{ id: keyof ShareInclude; labelKey: string }> = [
  { id: 'time', labelKey: 'chat.imageShare.timestamp' },
  { id: 'date', labelKey: 'chat.imageShare.date' },
  { id: 'page', labelKey: 'chat.imageShare.pageNumber' },
  { id: 'model', labelKey: 'chat.imageShare.model' },
]

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? timeFormatter.format(date) : ''
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime())
    ? `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
    : ''
}

function summarizeMessage(content: string, t: (key: string, options?: Record<string, unknown>) => string): { text: string; needsExpand: boolean } {
  const headings = (content.match(/^#{1,6}\s/gm) ?? []).length
  const tableLines = (content.match(/^\s*\|.*\|\s*$/gm) ?? []).length
  const tables = Math.max(0, tableLines - 2)
  const listItems = (content.match(/^\s*(?:[-*+]|\d+\.)\s/gm) ?? []).length
  const codeBlocks = Math.floor((content.match(/^```/gm) ?? []).length / 2)
  const parts: string[] = []
  if (tables > 0) parts.push(t('chat.imageShare.containsTable', { count: tables }))
  if (listItems > 0) parts.push(t('chat.imageShare.containsList', { count: listItems }))
  if (codeBlocks > 0) parts.push(t('chat.imageShare.containsCode', { count: codeBlocks }))
  if (headings > 0) parts.push(t('chat.imageShare.containsHeadings', { count: headings }))
  return {
    text: parts.join(' · '),
    needsExpand: content.length > 180 || tables > 0 || listItems > 0 || codeBlocks > 0 || headings > 0,
  }
}

function PagePreview({ page, index, total }: { page: HTMLElement; index: number; total: number }) {
  const container = React.useRef<HTMLDivElement>(null)
  const host = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)
  const pageWidth = Number(page.dataset.shareWidth) || SHARE_IMAGE.cssWidth
  const height = Number(page.dataset.shareHeight) || 0
  const outputWidth = Math.ceil(pageWidth * SHARE_IMAGE.scale)
  const outputHeight = Math.ceil(height * SHARE_IMAGE.scale)
  React.useLayoutEffect(() => {
    host.current!.append(page)
    const observer = new ResizeObserver(() => {
      const next = Math.min(1, container.current!.clientWidth / pageWidth)
      page.dataset.previewScale = String(next)
      setScale(next)
    })
    observer.observe(container.current!)
    return () => { observer.disconnect(); page.remove() }
  }, [page, pageWidth])
  return (
    <div ref={container} className="w-full" style={{ maxWidth: pageWidth }} data-share-preview-index={index}>
      <div className="flex justify-between mb-2 text-meta text-text-secondary tabular-nums">
        <span>{index + 1} / {total}</span><span>{outputWidth} × {outputHeight} px</span>
      </div>
      <div style={{ height: height * scale }}>
        <div ref={host} className="share-page-preview" style={{ width: pageWidth, transform: 'scale(' + scale + ')', transformOrigin: 'top left' }} />
      </div>
    </div>
  )
}

export default function SharePanel({ sessionId, title, messages, initialMessageId, modelName, createdAt, onClose }: {
  sessionId: string
  title: string
  messages: readonly ShareMessage[]
  initialMessageId?: string
  modelName?: string
  createdAt?: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = React.useState(() => new Set(initialMessageId ? [initialMessageId] : []))
  const [phase, setPhase] = React.useState<'select' | 'preview'>('select')
  const [layout, setLayout] = React.useState<ShareLayout>('auto')
  const [ratio, setRatio] = React.useState<ShareRatio>('a4')
  const [orientation, setOrientation] = React.useState<ShareOrientation>('portrait')
  const [include, setInclude] = React.useState<ShareInclude>({ time: true, date: true, page: true, model: true })
  const [expanded, setExpanded] = React.useState(() => new Set<string>())
  const [visibleCount, setVisibleCount] = React.useState(() =>
    initialMessageId ? Math.max(30, messages.length - messages.findIndex(message => message.id === initialMessageId)) : 30)
  const [pages, setPages] = React.useState<HTMLElement[]>([])
  const [busy, setBusy] = React.useState<'layout' | 'copy' | 'save' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const source = React.useRef<HTMLElement>(null)
  const mount = React.useRef<HTMLDivElement>(null)
  const stage = React.useRef<HTMLDivElement>(null)
  const back = useInitialFocus<HTMLButtonElement>()
  const cache = React.useRef(new Map<number, Promise<Blob>>())
  const resources = React.useRef(new Map<string, Promise<string>>())
  const alive = React.useRef(true)
  const selectedMessages = React.useMemo(() => messages.filter(message => selected.has(message.id)), [messages, selected])
  const labels = React.useMemo<ShareTemplateLabels>(() => ({
    excerpt: t('chat.imageShare.excerpt'),
    question: t('chat.imageShare.question'),
    answer: t('chat.imageShare.answer'),
    omitted: (count: number) => t('chat.imageShare.omittedCount', { count }),
    exportedBy: t('chat.imageShare.exportedBy'),
  }), [t])
  const pageSpec = React.useMemo(() => resolveSharePage({ layout, ratio, orientation }), [layout, ratio, orientation])
  const date = React.useMemo(() => formatDate(createdAt ?? Date.now()), [createdAt])
  const single = layout === 'long'
  const firstPage = pages[0]
  const outputWidth = Math.ceil(Number(firstPage?.dataset.shareWidth || pageSpec.width) * SHARE_IMAGE.scale)
  const outputHeight = Math.ceil(Number(firstPage?.dataset.shareHeight || pageSpec.height) * SHARE_IMAGE.scale)

  React.useEffect(() => {
    const images = cache.current
    const assets = resources.current
    alive.current = true
    return () => { alive.current = false; images.clear(); assets.clear() }
  }, [])
  React.useEffect(() => {
    if (phase !== 'select' || !initialMessageId) return
    document.querySelector('[data-share-select-id="' + CSS.escape(initialMessageId) + '"]')?.scrollIntoView({ block: 'start' })
  }, [phase, initialMessageId])
  React.useEffect(() => {
    if (phase !== 'preview') return
    const images = cache.current
    const controller = new AbortController()
    setPages([])
    setError(null)
    setBusy('layout')
    cache.current.clear()
    void settleShareContent(source.current!, controller.signal).then(() => {
      if (controller.signal.aborted) return
      const prepared = paginateShareContent(source.current!, mount.current!, pageSpec, t('chat.imageShare.continued'))
      setPages(prepared)
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      console.error('[share-images] Preview failed', reason)
      setError(t(reason instanceof ShareImageError ? errorKeys[reason.reason] : 'chat.imageShare.resource'))
    }).finally(() => { if (!controller.signal.aborted) setBusy(null) })
    return () => { controller.abort(); images.clear() }
  }, [phase, selectedMessages, pageSpec, include, labels, modelName, date, t, revision])

  const changeSelection = (id: string, checked: boolean) => setSelected(previous => {
    const next = new Set(previous)
    if (checked) next.add(id)
    else next.delete(id)
    return next
  })
  const toggleInclude = (key: keyof ShareInclude) => setInclude(previous => ({ ...previous, [key]: !previous[key] }))
  const toggleExpanded = (id: string) => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const exportImages = async (action: 'copy' | 'save') => {
    if (busy || !pages.length) return
    setBusy(action)
    setError(null)
    const png = (index: number) => {
      let promise = cache.current.get(index)
      if (!promise) {
        promise = renderSharePng(pages[index]!, resources.current)
        cache.current.set(index, promise)
        void promise.catch(() => cache.current.delete(index))
      }
      return promise
    }
    const operation = async () => {
      if (action === 'copy') {
        const viewport = stage.current!.getBoundingClientRect()
        let index = 0
        let visibleArea = 0
        for (const element of stage.current!.querySelectorAll<HTMLElement>('[data-share-preview-index]')) {
          const rect = element.getBoundingClientRect()
          const area = Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top))
            * Math.max(0, Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left))
          if (area > visibleArea) {
            index = Number(element.dataset.sharePreviewIndex)
            visibleArea = area
          }
        }
        const data = await blobBase64(await png(index))
        if (!alive.current) return
        await window.electronAPI.shareImages!.copy(data)
        if (alive.current) toast.success(t('chat.imageShare.copied'))
      } else {
        const images: string[] = []
        for (let index = 0; index < pages.length; index++) {
          images.push(await blobBase64(await png(index)))
          if (!alive.current) return
        }
        const result = await window.electronAPI.shareImages!.save({ sessionId, images })
        if (alive.current) toast.success(t('chat.imageShare.saved'), {
          action: { label: t('chat.imageShare.showFile'), onClick: () => { void window.electronAPI.showInFolder(result.paths[0]!) } },
        })
      }
    }
    await operation().catch((reason: unknown) => {
      if (!alive.current) return
      console.error('[share-images] Export failed', reason)
      setError(t(reason instanceof ShareImageError ? errorKeys[reason.reason] : action === 'copy' ? 'chat.imageShare.copyFailed' : 'chat.imageShare.saveFailed'))
    }).finally(() => { if (alive.current) setBusy(null) })
  }
  const exporting = busy === 'copy' || busy === 'save'
  const layoutLabel = t(layoutKeys[layout])
  const ratioLabel = RATIO_ITEMS.find(item => item.id === ratio)?.label ?? 'A4'
  const orientationLabel = t(ORIENTATION_ITEMS.find(item => item.id === orientation)!.labelKey)
  const outputSummary = single ? t('chat.imageShare.imageCount', { count: pages.length || 1 }) : t('chat.imageShare.pageCount', { count: pages.length || 1 })

  return (
    <section className="absolute inset-0 z-dropdown bg-background flex flex-col min-h-0" aria-label={t('chat.imageShare.share')}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <PreviewHeaderIconButton ref={back} disabled={exporting} tooltip={t('chat.imageShare.back')} aria-label={t('chat.imageShare.back')}
          onClick={() => phase === 'preview' ? setPhase('select') : onClose()}><ArrowLeft className="w-4 h-4" /></PreviewHeaderIconButton>
        <h2 className="text-body font-semibold">{t(phase === 'select' ? 'chat.imageShare.select' : 'chat.imageShare.preview')}</h2>
        <span className="text-micro text-text-secondary tabular-nums">{phase === 'select' ? '01 / 02' : '02 / 02'}</span>
      </header>

      {phase === 'select' ? <>
        <div className="flex-1 min-h-0 overflow-auto px-5 pb-5">
          <div className="share-select-list">
            {messages.length > visibleCount && <Button variant="ghost" size="sm" className="text-label" onClick={() => setVisibleCount(count => count + 30)}>{t('chat.imageShare.older')}</Button>}
            {messages.slice(-visibleCount).map(message => {
              const summary = summarizeMessage(message.content, t)
              const expandedMessage = expanded.has(message.id)
              const clamped = summary.needsExpand && !expandedMessage
              const role = t(message.role === 'user' ? 'chat.imageShare.question' : 'chat.imageShare.answer')
              return (
                <label
                  key={message.id}
                  className="share-select-row"
                  data-share-select-id={message.id}
                  data-selected={selected.has(message.id) ? 'true' : 'false'}
                  data-clamp={clamped ? 'true' : 'false'}
                  data-expanded={expandedMessage ? 'true' : 'false'}
                >
                  <input
                    type="checkbox"
                    className="share-select-check craft-control"
                    checked={selected.has(message.id)}
                    aria-label={role + ': ' + message.content.slice(0, 80)}
                    onChange={event => changeSelection(message.id, event.target.checked)}
                  />
                  <div className="share-select-main">
                    <div className="share-select-meta">
                      <span className="share-select-role-dot" data-role={message.role} aria-hidden="true" />
                      <span className="share-select-role">{role}</span>
                      <time className="share-select-time">{formatTime(message.timestamp)}</time>
                    </div>
                    <div className="share-select-excerpt share-select-message">
                      <Markdown mode="minimal">{message.content}</Markdown>
                    </div>
                    {(summary.text || summary.needsExpand) && <div className="share-select-foot">
                      <span className="share-select-extra">{summary.text}</span>
                      {summary.needsExpand && <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="share-select-expand"
                        aria-expanded={expandedMessage}
                        onClick={event => { event.stopPropagation(); toggleExpanded(message.id) }}
                      >{expandedMessage ? t('chat.imageShare.collapse') : t('chat.imageShare.expand')}</Button>}
                    </div>}
                  </div>
                </label>
              )
            })}
          </div>
        </div>
        <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-border px-5">
          <span className="text-label font-medium tabular-nums" aria-live="polite">{t('chat.imageShare.selected', { count: selected.size })}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="text-label" onClick={() => setSelected(new Set(messages.map(message => message.id)))}>{t('chat.imageShare.all')}</Button>
            <Button variant="ghost" size="sm" className="text-label" onClick={() => setSelected(new Set())}>{t('chat.imageShare.clear')}</Button>
            <Button size="sm" className="ml-2 text-label" disabled={!selected.size} onClick={() => setPhase('preview')}>{t('chat.imageShare.preview')}<ArrowRight className="w-4 h-4" /></Button>
          </div>
        </footer>
      </> : <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0">
          <aside className="flex w-56 shrink-0 flex-col overflow-auto border-r border-border p-4">
            <h3 className="text-label font-semibold">{t('chat.imageShare.settings')}</h3>

            <section className="share-setting-section">
              <div className="share-setting-label">{t('chat.imageShare.outputMode')}</div>
              <div className="share-mode-tabs rounded-md border border-border bg-secondary p-0.5">
                <SegmentedTabs
                  appearance="segment"
                  ariaLabel={t('chat.imageShare.outputMode')}
                  items={[{ id: 'auto', label: t(layoutKeys.auto) }, { id: 'long', label: t(layoutKeys.long) }]}
                  value={layout}
                  onChange={value => setLayout(value as ShareLayout)}
                  className="w-full"
                />
              </div>
              <p className="share-setting-hint">{single ? t('chat.imageShare.singleHint') : t('chat.imageShare.splitHint')}</p>
            </section>

            <section className={'share-setting-section' + (single ? ' is-disabled' : '')}>
              <div className="share-setting-label">{t('chat.imageShare.pageRatio')}</div>
              <div className="share-setting-grid">
                {RATIO_ITEMS.map(item => (
                  <button key={item.id} type="button" className="share-tile craft-control" aria-pressed={ratio === item.id} disabled={single}
                    onClick={() => setRatio(item.id)}>
                    <span className="share-ratio-shape" data-ratio={item.id} aria-hidden="true" />
                    <span>{item.label}</span>
                    <Check className="share-tile-check w-3 h-3" />
                  </button>
                ))}
              </div>
            </section>

            <section className={'share-setting-section' + (single ? ' is-disabled' : '')}>
              <div className="share-setting-label">{t('chat.imageShare.pageDirection')}</div>
              <div className="share-setting-grid">
                {ORIENTATION_ITEMS.map(item => (
                  <button key={item.id} type="button" className="share-tile craft-control" aria-pressed={orientation === item.id} disabled={single}
                    onClick={() => setOrientation(item.id)}>
                    <span className="share-orient-shape" data-orientation={item.id} aria-hidden="true" />
                    <span>{t(item.labelKey)}</span>
                    <Check className="share-tile-check w-3 h-3" />
                  </button>
                ))}
              </div>
            </section>

            <section className="share-setting-section">
              <div className="share-setting-label">{t('chat.imageShare.metadata')}</div>
              <div className="share-setting-grid">
                {INCLUDE_ITEMS.map(item => (
                  <button key={item.id} type="button" className="share-tile craft-control" aria-pressed={include[item.id]}
                    onClick={() => toggleInclude(item.id)}>
                    <span>{t(item.labelKey)}</span>
                    <Check className="share-tile-check w-3 h-3" />
                  </button>
                ))}
              </div>
            </section>

            <div className="mt-auto border-t border-border pt-4">
              <div className="share-output-stat">{single ? layoutLabel : `${ratioLabel} · ${orientationLabel} · ${layoutLabel}`}</div>
              <div className="share-output-stat">{outputSummary} · {outputWidth} × {outputHeight} px</div>
              <div className="share-output-stat">PNG · 2×</div>
              <p className="mt-2 text-micro leading-relaxed text-text-secondary">{t('chat.imageShare.storageHint')}</p>
            </div>
          </aside>

          <div ref={stage} className="share-preview-stage flex-1 min-w-0 overflow-auto p-5">
            {busy === 'layout' && <p className="flex justify-center gap-2 py-6 text-label text-text-secondary"><LoaderCircle className="w-4 h-4 animate-spin" />{t('chat.imageShare.preparing')}</p>}
            {error && <div className="mx-auto mb-4 flex max-w-[720px] items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-body text-destructive-text" role="alert">
              <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
              <div><p>{error}</p><Button variant="ghost" size="sm" className="mt-2 text-label" onClick={() => { setError(null); setRevision(value => value + 1) }}>{t('chat.imageShare.retry')}</Button></div>
            </div>}
            <div className="flex flex-col items-center gap-6">
              {pages.map((page, index) => <PagePreview key={index + ':' + revision + ':' + layout + ':' + ratio + ':' + orientation} page={page} index={index} total={pages.length} />)}
            </div>
          </div>
        </div>

        <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-border px-5">
          <span className="share-output-stat">{outputSummary} · {outputWidth} × {outputHeight} px · PNG</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-label" disabled={!!busy || !pages.length} onClick={() => { void exportImages('copy') }}>
              <Copy className="w-4 h-4" />{single ? t('chat.imageShare.copySingle') : t('chat.imageShare.copy')}
            </Button>
            <Button size="sm" className="text-label" disabled={!!busy || !pages.length} onClick={() => { void exportImages('save') }}>
              {busy === 'save' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{t('chat.imageShare.save')}
            </Button>
          </div>
        </footer>

        <div className="share-measurer" aria-hidden="true">
          <ShareTemplate ref={source} title={title} messages={selectedMessages} labels={labels} page={pageSpec} include={include} modelName={modelName} date={date} />
          <div ref={mount} />
        </div>
      </div>}
    </section>
  )
}
