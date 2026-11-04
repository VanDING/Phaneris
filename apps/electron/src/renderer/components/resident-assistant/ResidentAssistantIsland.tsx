import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useStore } from 'jotai'
import { ChevronDown, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { addSessionAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { useTheme } from '@/context/ThemeContext'
import { navigate, routes } from '@/lib/navigate'
import { ResidentPixelField } from './ResidentPixelField'
import { residentNavigationAtom, residentOriginAtom, residentReturnFocusAtom } from './resident-navigation'
import { useResidentSnapshot } from './useResidentSnapshot'
import './resident-assistant.css'

export function ResidentAssistantIsland() {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  const store = useStore()
  const [expanded, setExpanded] = React.useState(false)
  const [hovered, setHovered] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const snapshot = useResidentSnapshot(expanded)
  const presentation = useAtomValue(residentNavigationAtom)
  const surfaceOpen = !!presentation?.open && presentation.workspaceId === snapshot.workspaceId
  const returnFocus = useAtomValue(residentReturnFocusAtom)
  const button = React.useRef<HTMLButtonElement>(null)
  const card = React.useRef<HTMLDivElement>(null)
  const intent = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const close = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const opening = React.useRef(false)
  const suppressFocusPeek = React.useRef(false)
  const returnFocusOnClose = React.useRef(false)
  const latestWorkspace = React.useRef(snapshot.workspaceId)
  latestWorkspace.current = snapshot.workspaceId
  const peekId = React.useId()
  const titleId = React.useId()

  const dismiss = React.useCallback(() => {
    clearTimeout(intent.current)
    clearTimeout(close.current)
    setExpanded(false)
  }, [])
  const reveal = (delay: number) => {
    if (surfaceOpen) return
    clearTimeout(close.current)
    clearTimeout(intent.current)
    intent.current = setTimeout(() => setExpanded(true), delay)
  }
  const leave = (next: EventTarget | null) => {
    clearTimeout(intent.current)
    if (next instanceof Node && (button.current?.contains(next) || card.current?.contains(next))) return
    clearTimeout(close.current)
    close.current = setTimeout(() => {
      if (button.current === document.activeElement || card.current?.contains(document.activeElement)) return
      setExpanded(false)
    }, 180)
  }

  React.useEffect(() => {
    dismiss()
    setHovered(false)
    return () => { clearTimeout(intent.current); clearTimeout(close.current) }
  }, [snapshot.workspaceId, dismiss])

  React.useEffect(() => {
    if (!returnFocus) return
    const frame = requestAnimationFrame(() => {
      suppressFocusPeek.current = true
      button.current?.focus({ preventScroll: true })
      suppressFocusPeek.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [returnFocus])
  React.useLayoutEffect(() => {
    const trigger = button.current
    if (!trigger) return
    const measure = () => {
      const { left, top, width, height } = trigger.getBoundingClientRect()
      store.set(residentOriginAtom, { left, top, width, height })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(trigger)
    window.addEventListener('resize', measure)
    measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [store])

  async function open() {
    if (!snapshot.workspaceId || opening.current) return
    const presentation = store.get(residentNavigationAtom)
    if (presentation?.open && presentation.workspaceId === snapshot.workspaceId) {
      dismiss()
      store.set(residentNavigationAtom, { ...presentation, open: false, closing: true, returnFocus: true })
      return
    }
    if (!snapshot.connected) return
    opening.current = true
    setBusy(true)
    dismiss()
    const workspaceId = snapshot.workspaceId
    try {
      const session = await window.electronAPI.getResidentAssistant(workspaceId)
      if (latestWorkspace.current !== workspaceId) return
      if (!store.get(sessionMetaMapAtom).has(session.id)) store.set(addSessionAtom, session)
      navigate(routes.view.allSessions(session.id))
    } catch (error) { toast.error(t('residentAssistant.openError'), { description: String(error) }) }
    finally { opening.current = false; setBusy(false) }
  }

  const status = t(`residentAssistant.status.${snapshot.status}`)
  const pending = t('residentAssistant.pendingCount', { count: snapshot.pendingCount })
  return <Popover open={expanded} onOpenChange={open => { if (!open) dismiss() }}>
    <div className="resident-entry titlebar-no-drag" data-resident-mode={isDark ? 'dark' : 'light'} data-peeking={expanded || hovered}>
      <PopoverAnchor asChild>
        <button ref={button} type="button" className="craft-control resident-island" data-testid="resident-brand-entry"
          aria-label={`${t(surfaceOpen ? 'residentAssistant.backToWork' : 'residentAssistant.open')} · ${status} · ${pending}`} aria-busy={busy}
          aria-disabled={!snapshot.workspaceId || (!snapshot.connected && !surfaceOpen) || busy} aria-haspopup="dialog" aria-expanded={expanded || surfaceOpen} aria-controls={surfaceOpen ? 'resident-assistant-surface' : expanded ? peekId : undefined}
          onClick={() => void open()}
          onPointerEnter={event => { if (event.pointerType !== 'touch') { setHovered(true); reveal(120) } }}
          onPointerLeave={event => { setHovered(false); leave(event.relatedTarget) }}
          onPointerDown={() => clearTimeout(intent.current)}
          onFocus={event => { if (!suppressFocusPeek.current && event.currentTarget.matches(':focus-visible')) reveal(0) }}
          onBlur={event => leave(event.relatedTarget)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              dismiss()
              if (surfaceOpen) store.set(residentNavigationAtom, current => current ? { ...current, open: false, closing: true, returnFocus: true } : null)
            }
            if (event.key === 'Tab' && !event.shiftKey && expanded) {
              const action = card.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
              if (action) { event.preventDefault(); action.focus() }
            }
          }}>
          <ResidentPixelField isDark={isDark} lifted={expanded || hovered} />
          <span className="resident-island-copy">
            <span className="resident-island-name text-label font-semibold">Phaneris<span className="resident-online" aria-hidden="true" /></span>
            <span className="resident-island-status text-meta">{busy ? t('residentAssistant.loading') : status}</span>
          </span>
          <span className="resident-island-pending text-micro tabular-nums" data-pending={snapshot.pendingCount > 0}>
            <span className="resident-pending-label">{t('residentAssistant.pending')}</span><b>{snapshot.pendingCount}</b>
          </span>
          <ChevronDown className="resident-chevron size-3" aria-hidden="true" />
        </button>
      </PopoverAnchor>
    </div>
    <PopoverContent ref={card} id={peekId} aria-labelledby={titleId} data-testid="resident-snapshot" data-resident-mode={isDark ? 'dark' : 'light'}
      className="resident-peek" sideOffset={12} collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => {
        event.preventDefault()
        if (returnFocusOnClose.current) {
          store.set(residentReturnFocusAtom, value => value + 1)
          returnFocusOnClose.current = false
        }
      }} onEscapeKeyDown={() => { returnFocusOnClose.current = !!card.current?.contains(document.activeElement); dismiss() }}
      onInteractOutside={event => { if (event.target instanceof Node && button.current?.contains(event.target)) event.preventDefault() }}
      onPointerEnter={() => { clearTimeout(intent.current); clearTimeout(close.current) }} onPointerLeave={event => leave(event.relatedTarget)}
      onKeyDown={event => { if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); button.current?.focus() } }}
      onFocusCapture={() => clearTimeout(close.current)} onBlurCapture={event => leave(event.relatedTarget)}>
      <div className="resident-peek-heading">
        <div><h2 id={titleId} className="text-reading font-semibold">{t('residentAssistant.title')}</h2><p className="text-meta text-text-secondary">{status}</p></div>
        <span className="text-meta tabular-nums text-info-text">{pending}</span>
      </div>
      <dl className="resident-peek-rows text-label">
        <div><dt>{t('residentAssistant.currentWork')}</dt><dd data-testid="resident-current-work">{snapshot.loading ? t('residentAssistant.loading') : snapshot.error ? t('residentAssistant.status.unavailable') : snapshot.current ?? t('residentAssistant.noCurrentWork')}</dd></div>
        <div><dt>{t('residentAssistant.recentDelivery')}</dt><dd data-testid="resident-recent-delivery">{snapshot.loading ? t('residentAssistant.loading') : snapshot.error ? t('residentAssistant.status.unavailable') : snapshot.recent ?? t('residentAssistant.noWork')}</dd></div>
      </dl>
      <button type="button" className="craft-control resident-peek-open text-label" onClick={() => void open()} disabled={!snapshot.workspaceId || !snapshot.connected || busy}>
        {t('residentAssistant.openConversation')}<ArrowRight className="size-3.5" aria-hidden="true" />
      </button>
    </PopoverContent>
  </Popover>
}
