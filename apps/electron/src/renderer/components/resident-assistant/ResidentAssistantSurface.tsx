import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'motion/react'
import { useAtom, useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { PortalStackProvider } from '@phaneris/ui/context'
import { PreviewHeaderIconButton } from '@phaneris/ui'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { StoplightProvider } from '@/context/StoplightContext'
import { primarySurfaceAtom, primarySessionIdAtom } from '@/atoms/workbench'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { navigate } from '@/lib/navigate'
import { isMac, isWindows, isWebUI } from '@/lib/platform'
import ChatPage from '@/pages/ChatPage'
import { PANEL_EDGE_INSET } from '../app-shell/panel-constants'
import { residentNavigationAtom, residentOriginAtom, residentReturnFocusAtom } from './resident-navigation'

/** A focused assistant view; the previous workspace stays mounted for restoration. */
export function ResidentAssistantSurface() {
  const { t } = useTranslation()
  const parent = useAppShellContext()
  const store = useStore()
  const [presentation, setPresentation] = useAtom(residentNavigationAtom)
  const origin = useAtomValue(residentOriginAtom)
  const primary = useAtomValue(primarySurfaceAtom)
  const primaryId = useAtomValue(primarySessionIdAtom)
  const metadata = useAtomValue(sessionMetaMapAtom)
  const surface = React.useRef<HTMLElement>(null)
  const reduce = React.useSyncExternalStore(React.useCallback(onChange => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, []), () => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const layer = 'calc(var(--z-panel) + 1)'
  const open = !!presentation?.open && presentation.workspaceId === parent.activeWorkspaceId
  const primaryMeta = primaryId ? metadata.get(primaryId) : undefined

  React.useLayoutEffect(() => {
    // A navigation can close before the first commit, leaving no exit to finish.
    if (!open && presentation?.closing && !surface.current) setPresentation(current => current && !current.open ? { ...current, closing: false } : current)
  }, [open, presentation?.closing, setPresentation])

  React.useEffect(() => {
    if (primaryMeta?.sessionKind === 'resident_assistant' && primaryMeta.workspaceId === parent.activeWorkspaceId) navigate(primary.route)
  }, [primaryMeta?.sessionKind, primaryMeta?.workspaceId, parent.activeWorkspaceId, primary.route])
  React.useEffect(() => {
    if (presentation && presentation.workspaceId !== parent.activeWorkspaceId) setPresentation(null)
  }, [presentation, parent.activeWorkspaceId, setPresentation])

  const close = React.useCallback(() => {
    setPresentation(current => current ? { ...current, open: false, closing: true, returnFocus: true } : null)
  }, [setPresentation])
  const context = React.useMemo(() => ({
    ...parent,
    residentAssistantPresentation: true,
    isFocusedPanel: open,
    leadingAction: undefined,
    trailingAction: <PreviewHeaderIconButton tooltip={t('common.close')} aria-label={t('common.close')} data-testid="resident-close" onClick={close}><X className="size-4" /></PreviewHeaderIconButton>,
    expandButton: undefined,
    chatDisplayRef: undefined,
    sessionListSearchQuery: undefined,
    isSearchModeActive: false,
    onChatMatchInfoChange: undefined,
  }), [parent, open, close, t])
  if (!presentation || presentation.workspaceId !== parent.activeWorkspaceId) return null
  const rootStyle = getComputedStyle(document.documentElement)
  const topbarHeight = parseFloat(rootStyle.getPropertyValue('--topbar-height'))
  const inset = parent.isCompactMode ? 0 : PANEL_EDGE_INSET
  const expandedClip = `inset(0px 0px 0px 0px round ${rootStyle.getPropertyValue('--shape-xl').trim()})`
  const clip = `inset(0px ${Math.max(0, window.innerWidth - inset - origin.left - origin.width)}px ${Math.max(0, window.innerHeight - topbarHeight - inset - origin.height)}px ${Math.max(0, origin.left - inset)}px round 8px)`
  return <DialogPrimitive.Root modal={false} open={open} onOpenChange={next => { if (!next) close() }}>
    <DialogPrimitive.Portal forceMount>
      <AnimatePresence onExitComplete={() => setPresentation(current => current && !current.open ? { ...current, closing: false } : current)}>
        {open && <DialogPrimitive.Content forceMount asChild aria-describedby={undefined}
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (store.get(residentNavigationAtom)?.returnFocus) store.set(residentReturnFocusAtom, value => value + 1)
          }} onInteractOutside={event => event.preventDefault()}>
          <motion.section ref={surface} key={`${presentation.workspaceId}:${presentation.sessionId}`} id="resident-assistant-surface" className="resident-surface"
            data-testid="resident-assistant-surface" data-resident-route={presentation.route} data-shell-platform={isWebUI ? 'browser' : isMac ? 'macos' : isWindows ? 'windows' : 'linux'}
            style={{ zIndex: layer, '--resident-surface-inset': `${inset}px` } as React.CSSProperties}
            initial={{ clipPath: clip, opacity: 0 }} animate={{ clipPath: expandedClip, opacity: 1 }}
            exit={{ clipPath: clip, opacity: 0, transition: { clipPath: { duration: reduce ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }, opacity: { duration: reduce ? 0 : 0.1, delay: reduce ? 0 : 0.22 } } }}
            transition={{ clipPath: { duration: reduce ? 0 : 0.44, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: reduce ? 0 : 0.1 } }}>
            <DialogPrimitive.Title asChild><span className="sr-only">Phaneris</span></DialogPrimitive.Title>
            <PortalStackProvider layer={layer}>
                <StoplightProvider value={false}>
                  <AppShellProvider value={context}>
                    <motion.div className="resident-surface-chat @container/panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.1 } }} transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : 0.1 }}>
                      <ChatPage sessionId={presentation.sessionId} />
                    </motion.div>
                  </AppShellProvider>
                </StoplightProvider>
            </PortalStackProvider>
          </motion.section>
        </DialogPrimitive.Content>}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
