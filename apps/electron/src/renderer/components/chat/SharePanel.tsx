import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, Check, Copy, Download, X } from 'lucide-react'
import { PreviewHeaderIconButton, useInitialFocus } from '@phaneris/ui'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import type { ShareMessage } from '@/lib/share-messages'
import { SHARE_IMAGE, resolveSharePage, type ShareInclude, type ShareOptions, type ShareRatio, type ShareOrientation } from '../../../shared/share-image'
import { blobBase64, composeSharePages, paginateShareContent, renderSharePng, settleShareContent, ShareImageError } from '@/lib/share-image-renderer'
import { ShareTemplate, type ShareTemplateLabels } from './ShareTemplate'

const errorKeys = { resource: 'chat.imageShare.resource', tooLong: 'chat.imageShare.tooLong', tooMany: 'chat.imageShare.tooMany', encode: 'chat.imageShare.encode' } as const
const RATIO_ITEMS: ReadonlyArray<{ id: ShareRatio; label: string }> = [
  { id: 'a4', label: 'A4' }, { id: '3:4', label: '3:4' }, { id: '9:16', label: '9:16' }, { id: '1:1', label: '1:1' },
]
const ORIENTATION_ITEMS: ReadonlyArray<{ id: ShareOrientation; labelKey: string }> = [
  { id: 'portrait', labelKey: 'chat.imageShare.portrait' }, { id: 'landscape', labelKey: 'chat.imageShare.landscape' },
]
const INCLUDE_ITEMS: ReadonlyArray<{ id: keyof ShareInclude; labelKey: string }> = [
  { id: 'time', labelKey: 'chat.imageShare.timestamp' }, { id: 'date', labelKey: 'chat.imageShare.date' },
  { id: 'page', labelKey: 'chat.imageShare.pageNumber' }, { id: 'model', labelKey: 'chat.imageShare.model' },
]

function ImagePreview({ image, pageWidth, actualSize }: { image: HTMLElement; pageWidth: number; actualSize: boolean }) {
  const viewport = React.useRef<HTMLDivElement>(null)
  const host = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)
  const width = Number(image.dataset.shareWidth), height = Number(image.dataset.shareHeight)
  React.useLayoutEffect(() => {
    host.current!.append(image)
    const resize = () => {
      const next = actualSize ? SHARE_IMAGE.scale : Math.min(1, Math.max(1, viewport.current!.clientWidth - 40) / pageWidth)
      image.dataset.previewScale = String(next)
      setScale(next)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(viewport.current!)
    return () => { observer.disconnect(); image.remove() }
  }, [image, pageWidth, actualSize])
  return <div ref={viewport} className="share-preview-stage" data-share-preview-index="0">
    <div className="share-preview-canvas" style={{ width: width * scale, height: height * scale }}>
      <div ref={host} className="share-page-preview" style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  </div>
}

export default function SharePanel({ sessionId, title, messages, modelName, createdAt, options, onOptionsChange, onBack, onClose }: {
  sessionId: string; title: string; messages: readonly ShareMessage[]; modelName?: string; createdAt?: number
  options: ShareOptions; onOptionsChange: (options: ShareOptions) => void; onBack: () => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const { layout, ratio, orientation, include } = options
  const [preview, setPreview] = React.useState<{ image: HTMLElement; data: string; pageCount: number } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [failedAction, setFailedAction] = React.useState<'copy' | 'save' | null>(null)
  const [revision, setRevision] = React.useState(0)
  const [actualSize, setActualSize] = React.useState(false)
  const source = React.useRef<HTMLElement>(null), mount = React.useRef<HTMLDivElement>(null)
  const back = useInitialFocus<HTMLButtonElement>()
  const panel = React.useRef<HTMLElement>(null)
  const resources = React.useRef(new Map<string, Promise<string>>())
  const alive = React.useRef(true), operation = React.useRef(false)
  const labels = React.useMemo<ShareTemplateLabels>(() => ({
    excerpt: t('chat.imageShare.excerpt'), question: t('chat.imageShare.question'), answer: t('chat.imageShare.answer'),
    omitted: count => t('chat.imageShare.omittedCount', { count }), exportedBy: t('chat.imageShare.exportedBy'),
  }), [t])
  const pageSpec = React.useMemo(() => resolveSharePage({ layout, ratio, orientation }), [layout, ratio, orientation])
  const date = React.useMemo(() => {
    const value = new Date(createdAt ?? Date.now())
    return Number.isFinite(value.getTime()) ? `${value.getFullYear()}.${String(value.getMonth() + 1).padStart(2, '0')}.${String(value.getDate()).padStart(2, '0')}` : ''
  }, [createdAt])
  const single = layout === 'long'
  React.useEffect(() => {
    const node = panel.current!
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && !busy) { event.preventDefault(); event.stopPropagation(); onBack() }
    }
    node.addEventListener('keydown', escape)
    return () => node.removeEventListener('keydown', escape)
  }, [busy, onBack])

  React.useEffect(() => {
    const assets = resources.current
    alive.current = true
    return () => { alive.current = false; assets.clear() }
  }, [])
  React.useEffect(() => {
    const controller = new AbortController(), target = mount.current!
    setPreview(null); setError(null); setFailedAction(null)
    void settleShareContent(source.current!, controller.signal).then(async () => {
      if (controller.signal.aborted) return
      const pages = paginateShareContent(source.current!, target, pageSpec, t('chat.imageShare.continued'))
      const image = composeSharePages(pages, target)
      const data = await blobBase64(await renderSharePng(image, resources.current))
      if (!controller.signal.aborted) setPreview({ image, data, pageCount: pages.length })
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      console.error('[share-images] Preview failed', reason)
      setError(t(reason instanceof ShareImageError ? errorKeys[reason.reason] : 'chat.imageShare.resource'))
    })
    return () => { controller.abort(); target.replaceChildren() }
  }, [messages, pageSpec, include, labels, modelName, date, t, revision])

  const exportImage = async (action: 'copy' | 'save') => {
    if (operation.current || !preview) return
    operation.current = true; setBusy(true); setError(null); setFailedAction(null)
    const run = async () => {
      if (action === 'copy') {
        await window.electronAPI.shareImages!.copy(preview.data)
        if (alive.current) toast.success(t('chat.imageShare.copied'))
      } else {
        const result = await window.electronAPI.shareImages!.save({ sessionId, images: [preview.data] })
        if (alive.current) toast.success(t('chat.imageShare.saved'), {
          action: { label: t('chat.imageShare.showFile'), onClick: () => { void window.electronAPI.showInFolder(result.paths[0]!) } },
        })
      }
    }
    await run().catch((reason: unknown) => {
      if (!alive.current) return
      console.error('[share-images] Export failed', reason)
      setFailedAction(action); setError(t(action === 'copy' ? 'chat.imageShare.copyFailed' : 'chat.imageShare.saveFailed'))
    }).finally(() => { operation.current = false; if (alive.current) setBusy(false) })
  }
  const outputWidth = preview ? Number(preview.image.dataset.shareWidth) * SHARE_IMAGE.scale : 0
  const outputHeight = preview ? Number(preview.image.dataset.shareHeight) * SHARE_IMAGE.scale : 0
  const outputSummary = single ? t('chat.imageShare.imageCount', { count: 1 }) : t('chat.imageShare.stitched', { count: preview?.pageCount ?? 0 })

  return <section ref={panel} className="share-panel absolute inset-0 z-dropdown bg-background flex flex-col min-h-0" aria-label={t('chat.imageShare.share')}>
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
      <PreviewHeaderIconButton ref={back} disabled={busy} tooltip={t('chat.imageShare.back')} aria-label={t('chat.imageShare.back')} onClick={onBack}><ArrowLeft className="w-4 h-4" /></PreviewHeaderIconButton>
      <h2 className="text-body font-semibold">{t('chat.imageShare.preview')}</h2>
      <span className="min-w-0 truncate text-meta text-text-secondary">{title}</span>
      <div className="ml-auto"><PreviewHeaderIconButton disabled={busy} tooltip={t('common.close')} aria-label={t('common.close')} onClick={onClose}><X className="w-4 h-4" /></PreviewHeaderIconButton></div>
    </header>
    <div className="share-workspace">
      <aside className="share-settings" inert={busy || undefined}>
        <h3 className="text-label font-semibold">{t('chat.imageShare.settings')}</h3>
        <section className="share-setting-section">
          <div className="share-setting-label">{t('chat.imageShare.outputMode')}</div>
          <div className="share-mode-tabs rounded-md border border-border bg-secondary p-0.5">
            <SegmentedTabs appearance="segment" ariaLabel={t('chat.imageShare.outputMode')}
              items={[{ id: 'auto', label: t('chat.imageShare.split') }, { id: 'long', label: t('chat.imageShare.single') }]}
              value={layout} onChange={value => onOptionsChange({ ...options, layout: value })} className="w-full" />
          </div>
          <p className="share-setting-hint">{t(single ? 'chat.imageShare.singleHint' : 'chat.imageShare.splitHint')}</p>
        </section>
        <section className="share-setting-section">
          <div className="share-setting-label">{t('chat.imageShare.pageRatio')}</div>
          <div className="share-setting-grid">{RATIO_ITEMS.map(item => <Button key={item.id} variant="outline" size="sm" className="share-tile"
            aria-pressed={ratio === item.id} disabled={single} onClick={() => onOptionsChange({ ...options, ratio: item.id })}>
            <span className="share-ratio-shape" data-ratio={item.id} aria-hidden="true" /><span>{item.label}</span><Check className="share-tile-check w-3 h-3" />
          </Button>)}</div>
        </section>
        <section className="share-setting-section">
          <div className="share-setting-label">{t('chat.imageShare.pageDirection')}</div>
          <div className="share-setting-grid">{ORIENTATION_ITEMS.map(item => <Button key={item.id} variant="outline" size="sm" className="share-tile"
            aria-pressed={orientation === item.id} disabled={single} onClick={() => onOptionsChange({ ...options, orientation: item.id })}>
            <span className="share-orient-shape" data-orientation={item.id} aria-hidden="true" /><span>{t(item.labelKey)}</span><Check className="share-tile-check w-3 h-3" />
          </Button>)}</div>
        </section>
        <section className="share-setting-section">
          <div className="share-setting-label">{t('chat.imageShare.metadata')}</div>
          <div className="share-setting-grid">{INCLUDE_ITEMS.map(item => <Button key={item.id} variant="outline" size="sm" className="share-tile"
            aria-pressed={include[item.id]} onClick={() => onOptionsChange({ ...options, include: { ...include, [item.id]: !include[item.id] } })}>
            <span>{t(item.labelKey)}</span><Check className="share-tile-check w-3 h-3" />
          </Button>)}</div>
        </section>
      </aside>
      <div className="share-preview-column" aria-busy={!preview && !error}>
        <div className="share-preview-toolbar">
          <span className="text-meta text-text-secondary tabular-nums">{t('chat.imageShare.selected', { count: messages.length })}</span>
          <SegmentedTabs appearance="segment" ariaLabel={t('chat.imageShare.zoom')}
            items={[{ id: 'fit', label: t('chat.imageShare.fitPage') }, { id: 'actual', label: t('chat.imageShare.actualSize') }]}
            value={actualSize ? 'actual' : 'fit'} onChange={value => setActualSize(value === 'actual')} />
        </div>
        {error && <div className="share-error text-destructive-text" role="alert"><AlertTriangle className="w-4 h-4 shrink-0" />
          <div><p>{error}</p><Button variant="ghost" size="sm" onClick={() => {
            if (failedAction) void exportImage(failedAction)
            else setRevision(value => value + 1)
          }}>{t('chat.imageShare.retry')}</Button></div></div>}
        {preview ? <ImagePreview image={preview.image} pageWidth={pageSpec.width} actualSize={actualSize} /> : <div className="share-preview-stage flex-1" />}
      </div>
    </div>
    <footer className="share-export-bar">
      <div className="share-output-stat">{preview && <span>{outputSummary} · {outputWidth} × {outputHeight} px · PNG</span>}<p>{t('chat.imageShare.storageHint')}</p></div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy || !preview} onClick={() => { void exportImage('copy') }}><Copy className="w-4 h-4" />{t('chat.imageShare.copy')}</Button>
        <Button size="sm" disabled={busy || !preview} onClick={() => { void exportImage('save') }}><Download className="w-4 h-4" />{t('chat.imageShare.save')}</Button>
      </div>
    </footer>
    <div className="share-measurer" aria-hidden="true">
      <ShareTemplate ref={source} title={title} messages={messages} labels={labels} page={pageSpec} include={include} modelName={modelName} date={date} />
      <div ref={mount} />
    </div>
  </section>
}
