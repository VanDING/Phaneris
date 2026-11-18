import * as React from 'react'
import { createPortal } from 'react-dom'
import { atom, useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, X } from 'lucide-react'
import { PreviewHeaderIconButton } from '@phaneris/ui'
import type { ResolvedArtifact } from '@phaneris/shared/artifacts'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { FocusBoard } from './FocusBoard'
import { residentNavigationAtom } from './resident-navigation'
import './resident-assistant.css'

const panelPreferences = atom<Record<string, { open: boolean }>>({})
const FilePreview = React.lazy(() => import('@/components/content-panels/FilePreviewContent').then(module => ({ default: module.FilePreviewContent })))

/**
 * The work board inside the assistant's own view.
 *
 * It opens as a sheet from the top of the view, not as a floating card anchored
 * to the corner control: the board is the view's own content, and a popover
 * would put it behind a button and over the conversation at the same time. The
 * sheet renders the same `FocusBoard` the titlebar peek renders, so the two
 * surfaces cannot drift. The trigger in the header is unchanged.
 */
export function ResidentAssistantControls({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { t } = useTranslation()
  const [preferences, setPreferences] = useAtom(panelPreferences)
  const presentation = useAtomValue(residentNavigationAtom)
  const visible = presentation?.workspaceId !== workspaceId || presentation.open
  const open = (preferences[workspaceId]?.open ?? false) && visible
  const [preview, setPreview] = React.useState<ResolvedArtifact>()
  const trigger = React.useRef<HTMLButtonElement>(null)
  const sheet = React.useRef<HTMLElement>(null)
  // The trigger lives in the chat header, so rendering the sheet in place would
  // position it against that 66px-wide action cluster — a floating card, which
  // is exactly what this is not. It portals into the assistant surface instead,
  // which is the box the sheet belongs to.
  const [host, setHost] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    if (open) setHost(document.getElementById('resident-assistant-surface'))
  }, [open])
  const setOpen = (value: boolean) => setPreferences(current => ({ ...current, [workspaceId]: { open: value } }))
  const close = React.useCallback(() => {
    setOpen(false)
    // Return focus to the control that opened it, once the sheet is gone.
    requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }) })
  }, [workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !preview) { event.preventDefault(); close() } }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, preview, close])
  return <>
    <PreviewHeaderIconButton ref={trigger} data-testid="resident-details-trigger"
      tooltip={t('residentAssistant.details')} aria-label={t('residentAssistant.details')} aria-pressed={open}
      onClick={() => (open ? close() : setOpen(true))}><MoreHorizontal className="size-4" /></PreviewHeaderIconButton>
    {open && host && createPortal(<>
      <div className="resident-sheet-scrim" data-testid="resident-work-scrim" aria-hidden="true" onClick={() => { if (!preview) close() }} />
      <section ref={sheet} id="resident-work-panel" data-testid="resident-work-panel" role="dialog" aria-modal="false"
        aria-labelledby="resident-work-panel-title" className="resident-top-sheet">
        <span id="resident-work-panel-title" className="sr-only">{t('residentAssistant.panel.title')}</span>
        <PreviewHeaderIconButton data-testid="resident-board-close" tooltip={t('common.close')} aria-label={t('common.close')}
          className="resident-board-close" onClick={close}><X className="size-4" /></PreviewHeaderIconButton>
        <FocusBoard workspaceId={workspaceId} onPreview={setPreview} />
      </section>
    </>, host)}
    <Dialog open={!!preview && visible} onOpenChange={next => { if (!next) setPreview(undefined) }}>
      <DialogContent className="resident-deliverable-preview sm:max-w-5xl" data-testid="resident-deliverable-preview">
        <DialogHeader><DialogTitle>{preview?.artifact.title}</DialogTitle><DialogDescription>{t('residentAssistant.panel.previewHint')}</DialogDescription></DialogHeader>
        {preview && <React.Suspense fallback={<p role="status">{t('residentAssistant.loading')}</p>}><FilePreview filePath={preview.activePath ?? preview.artifact.sourcePath} mimeType={preview.artifact.mimeType}
          fileSize={preview.artifact.revisions.find(revision => revision.id === (preview.viewedRevision ?? preview.artifact.draftRevision ?? preview.artifact.currentRevision))?.size} /></React.Suspense>}
      </DialogContent>
    </Dialog>
  </>
}
