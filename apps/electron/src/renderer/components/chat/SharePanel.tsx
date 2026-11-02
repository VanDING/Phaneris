import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Copy, Download, LoaderCircle, Send } from 'lucide-react'
import { Markdown, PreviewHeaderIconButton } from '@phaneris/ui'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ShareMessage } from '@/lib/share-messages'
import { SHARE_IMAGE } from '../../../shared/share-image'
import { blobBase64, paginateShareContent, renderSharePng, settleShareContent, ShareImageError } from '@/lib/share-image-renderer'
import { ShareTemplate, type ShareTemplateLabels } from './ShareTemplate'

const errorKeys = {
  resource: 'chat.imageShare.resource', tooLong: 'chat.imageShare.tooLong',
  tooMany: 'chat.imageShare.tooMany', encode: 'chat.imageShare.encode',
} as const
const layoutKeys = { auto: 'chat.imageShare.auto', long: 'chat.imageShare.long' } as const

function PagePreview({ page, index, total }: { page: HTMLElement; index: number; total: number }) {
  const container = React.useRef<HTMLDivElement>(null)
  const host = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)
  const height = Number(page.dataset.shareHeight)
  React.useLayoutEffect(() => {
    host.current!.append(page)
    const observer = new ResizeObserver(() => {
      const next = Math.min(1, container.current!.clientWidth / SHARE_IMAGE.cssWidth)
      page.dataset.previewScale = String(next)
      setScale(next)
    })
    observer.observe(container.current!)
    return () => { observer.disconnect(); page.remove() }
  }, [page])
  return (
    <div ref={container} className="w-full max-w-[720px]" data-share-preview-index={index}>
      <div className="flex justify-between mb-2 text-meta text-text-secondary">
        <span>{index + 1} / {total}</span><span>{SHARE_IMAGE.outputWidth} × {Math.ceil(height * SHARE_IMAGE.scale)} px</span>
      </div>
      <div style={{ height: height * scale }}>
        <div ref={host} className="share-page-preview" style={{ width: SHARE_IMAGE.cssWidth, transform: 'scale(' + scale + ')', transformOrigin: 'top left' }} />
      </div>
    </div>
  )
}

export default function SharePanel({ sessionId, title, messages, initialMessageId, onClose }: {
  sessionId: string
  title: string
  messages: readonly ShareMessage[]
  initialMessageId?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = React.useState(() => new Set(initialMessageId ? [initialMessageId] : []))
  const [phase, setPhase] = React.useState<'select' | 'preview'>('select')
  const [layout, setLayout] = React.useState<'auto' | 'long'>('auto')
  const [visibleCount, setVisibleCount] = React.useState(() =>
    initialMessageId ? Math.max(30, messages.length - messages.findIndex(message => message.id === initialMessageId)) : 30)
  const [pages, setPages] = React.useState<HTMLElement[]>([])
  const [busy, setBusy] = React.useState<'layout' | 'copy' | 'save' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const source = React.useRef<HTMLElement>(null)
  const mount = React.useRef<HTMLDivElement>(null)
  const stage = React.useRef<HTMLDivElement>(null)
  const back = React.useRef<HTMLButtonElement>(null)
  const cache = React.useRef(new Map<number, Promise<Blob>>())
  const resources = React.useRef(new Map<string, Promise<string>>())
  const alive = React.useRef(true)
  const selectedMessages = React.useMemo(() => messages.filter(message => selected.has(message.id)), [messages, selected])
  const labels = React.useMemo<ShareTemplateLabels>(() => ({
    excerpt: t('chat.imageShare.excerpt'),
    selected: t('chat.imageShare.selected', { count: selected.size }),
    question: t('chat.imageShare.question'),
    answer: t('chat.imageShare.answer'),
    omitted: t('chat.imageShare.omitted'),
  }), [t, selected.size])

  React.useEffect(() => {
    const images = cache.current
    const assets = resources.current
    alive.current = true
    return () => { alive.current = false; images.clear(); assets.clear() }
  }, [])
  React.useEffect(() => {
    back.current?.focus({ preventScroll: true })
    if (phase === 'select' && initialMessageId) {
      document.querySelector('[data-share-select-id="' + CSS.escape(initialMessageId) + '"]')?.scrollIntoView({ block: 'start' })
    }
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
      const prepared = paginateShareContent(source.current!, mount.current!, layout, t('chat.imageShare.continued'))
      prepared.forEach(page => { page.dataset.shareHeight = String(Math.ceil(page.getBoundingClientRect().height)) })
      setPages(prepared)
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      console.error('[share-images] Preview failed', reason)
      setError(t(reason instanceof ShareImageError ? errorKeys[reason.reason] : 'chat.imageShare.resource'))
    }).finally(() => { if (!controller.signal.aborted) setBusy(null) })
    return () => { controller.abort(); images.clear() }
  }, [phase, selectedMessages, layout, labels, t, revision])

  const changeSelection = (id: string, checked: boolean) => setSelected(previous => {
    const next = new Set(previous)
    if (checked) next.add(id)
    else next.delete(id)
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
  return (
    <section className="absolute inset-0 z-dropdown bg-background flex flex-col min-h-0" aria-label={t('chat.imageShare.share')}>
      <header className="craft-panel-header flex items-center gap-3 px-4 shrink-0">
        <PreviewHeaderIconButton ref={back} disabled={exporting} tooltip={t('chat.imageShare.back')} aria-label={t('chat.imageShare.back')}
          onClick={() => phase === 'preview' ? setPhase('select') : onClose()}><ArrowLeft className="w-4 h-4" /></PreviewHeaderIconButton>
        <h1 className="flex-1 text-body font-semibold">{t(phase === 'select' ? 'chat.imageShare.select' : 'chat.imageShare.preview')}</h1>
        {phase === 'select' ? <>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(messages.map(message => message.id)))}>{t('chat.imageShare.all')}</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{t('chat.imageShare.clear')}</Button>
        </> : <>
          <Button size="sm" variant="outline" disabled={!!busy || !pages.length} onClick={() => { void exportImages('copy') }}>
            <Copy className="w-4 h-4" />{t('chat.imageShare.copy')}
          </Button>
          <Button size="sm" disabled={!!busy || !pages.length} onClick={() => { void exportImages('save') }}>
            {busy === 'save' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{t('chat.imageShare.save')}
          </Button>
        </>}
      </header>
      {phase === 'select' ? <>
        <div className="px-5 py-3 border-y border-border/50 text-label text-text-secondary bg-muted/40">{t('chat.imageShare.selectHint')}</div>
        <div className="flex-1 min-h-0 overflow-auto px-6 py-6">
          <div className="max-w-[850px] mx-auto space-y-7">
            {messages.length > visibleCount && <Button variant="ghost" onClick={() => setVisibleCount(count => count + 30)}>{t('chat.imageShare.older')}</Button>}
            {messages.slice(-visibleCount).map(message => (
              <div key={message.id} className="flex gap-4 items-start" data-share-select-id={message.id}>
                <input type="checkbox" className="craft-control mt-4 shrink-0 accent-accent w-4 h-4" checked={selected.has(message.id)}
                  aria-label={t(message.role === 'user' ? 'chat.imageShare.question' : 'chat.imageShare.answer') + ': ' + message.content.slice(0, 80)}
                  onChange={event => changeSelection(message.id, event.target.checked)} />
                <article className={'share-select-message flex-1 min-w-0 p-5 rounded-shape-lg border ' + (selected.has(message.id) ? 'border-accent/50 bg-accent/3' : 'border-border bg-background')}>
                  <div className="text-meta text-text-secondary mb-3">{t(message.role === 'user' ? 'chat.imageShare.question' : 'chat.imageShare.answer')}</div>
                  <Markdown mode="minimal" onUrlClick={() => {}} onFileClick={() => {}}>{message.content}</Markdown>
                </article>
              </div>
            ))}
          </div>
        </div>
        <footer className="flex justify-between items-center gap-4 border-t border-border px-6 py-4">
          <span className="text-label" aria-live="polite">{labels.selected}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>{t('chat.imageShare.cancel')}</Button>
            <Button disabled={!selected.size} onClick={() => setPhase('preview')}><Send className="w-4 h-4" />{t('chat.imageShare.preview')}</Button>
          </div>
        </footer>
      </> : <div className="flex-1 min-h-0 flex">
        <aside className="w-56 shrink-0 p-5 border-r border-border overflow-auto">
          <fieldset disabled={exporting} className="space-y-3">
            <legend className="text-label font-semibold mb-3">{t('chat.imageShare.layout')}</legend>
            {(['auto', 'long'] as const).map(value => (
              <label key={value} className="flex items-start gap-2 rounded-shape-md border border-border p-3 cursor-pointer has-[:checked]:border-accent/50">
                <input type="radio" name={'share-layout-' + sessionId} className="craft-control mt-0.5 accent-accent" checked={layout === value} onChange={() => setLayout(value)} />
                <span className="text-label">{t(layoutKeys[value])}</span>
              </label>
            ))}
          </fieldset>
          <div className="mt-6 pt-5 border-t border-border text-label space-y-3 text-text-secondary">
            <p>{labels.selected}</p><p>{t('chat.imageShare.imageCount', { count: pages.length })}</p>
            <p>{SHARE_IMAGE.outputWidth} px · PNG</p>
            <p className="leading-relaxed">{t('chat.imageShare.storageHint')}</p>
          </div>
        </aside>
        <div ref={stage} className="share-preview-stage flex-1 min-w-0 overflow-auto p-6">
          {busy === 'layout' && <p className="flex justify-center gap-2 text-label text-text-secondary"><LoaderCircle className="w-4 h-4 animate-spin" />{t('chat.imageShare.preparing')}</p>}
          {error && <div className="mx-auto max-w-[720px] p-4 mb-4 bg-background text-body" role="alert">
            <p>{error}</p><Button variant="ghost" className="mt-2" onClick={() => setRevision(value => value + 1)}>{t('chat.imageShare.retry')}</Button>
          </div>}
          <div className="flex flex-col items-center gap-7">
            {pages.map((page, index) => <PagePreview key={index + ':' + revision + ':' + layout} page={page} index={index} total={pages.length} />)}
          </div>
        </div>
        <div className="share-measurer" aria-hidden="true">
          <ShareTemplate ref={source} title={title} messages={selectedMessages} labels={labels} />
          <div ref={mount} />
        </div>
      </div>}
    </section>
  )
}
