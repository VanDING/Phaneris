import * as React from 'react'
import { atom, useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Layers, MoreHorizontal } from 'lucide-react'
import { PreviewHeaderIconButton } from '@phaneris/ui'
import type { ResolvedArtifact } from '@phaneris/shared/artifacts'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ResidentWorkPanel } from './ResidentWorkPanel'
import { residentNavigationAtom } from './resident-navigation'
import './resident-assistant.css'

const panelPreferences = atom<Record<string, { open: boolean; width: number }>>({})
const FilePreview = React.lazy(() => import('@/components/content-panels/FilePreviewContent').then(module => ({ default: module.FilePreviewContent })))
const ContextDetails = React.lazy(() => import('./ResidentAssistantDetails').then(module => ({ default: module.ResidentAssistantDetails })))

/** Presentation is workspace-local; the owning assistant page controls its lifetime. */
export function ResidentAssistantControls({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { t } = useTranslation()
  const [preferences, setPreferences] = useAtom(panelPreferences)
  const presentation = useAtomValue(residentNavigationAtom)
  const visible = presentation?.workspaceId !== workspaceId || presentation.open
  const preference = preferences[workspaceId] ?? { open: false, width: 384 }
  const [preview, setPreview] = React.useState<ResolvedArtifact>()
  const [contextOpen, setContextOpen] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{ x: number; width: number } | undefined>(undefined)
  const change = (patch: Partial<typeof preference>) => setPreferences(current => ({ ...current, [workspaceId]: { ...(current[workspaceId] ?? preference), ...patch } }))
  const resize = (width: number) => change({ width: Math.min(640, Math.max(320, width)) })
  return <>
    <Popover open={contextOpen && visible} onOpenChange={setContextOpen} modal={false}>
      <PopoverTrigger asChild><PreviewHeaderIconButton data-testid="resident-context-trigger" tooltip={t('residentAssistant.contextInspector')} aria-label={t('residentAssistant.contextInspector')} aria-pressed={contextOpen}>
        <Layers className="size-4" />
      </PreviewHeaderIconButton></PopoverTrigger>
      <PopoverContent data-testid="resident-context-inspector" className="resident-context-inspector shadow-middle" align="end" side="bottom" sideOffset={8} collisionPadding={12}
        onFocusOutside={event => event.preventDefault()}>
        <h2 className="text-title font-medium">{t('residentAssistant.contextInspector')}</h2>
        <React.Suspense fallback={<p role="status">{t('residentAssistant.loading')}</p>}><ContextDetails workspaceId={workspaceId} detail="context" /></React.Suspense>
      </PopoverContent>
    </Popover>
    <Popover open={preference.open && visible} onOpenChange={open => { if (!preview) change({ open }) }} modal={false}>
      <PopoverTrigger asChild><PreviewHeaderIconButton ref={trigger} data-testid="resident-details-trigger"
        tooltip={t('residentAssistant.details')} aria-label={t('residentAssistant.details')} aria-pressed={preference.open}><MoreHorizontal className="size-4" /></PreviewHeaderIconButton></PopoverTrigger>
      <PopoverContent data-testid="resident-work-panel" aria-labelledby="resident-work-panel-title" className="resident-work-panel p-0 shadow-middle" align="end" side="bottom" sideOffset={8} collisionPadding={12}
        style={{ width: preference.width }} onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (preview) event.preventDefault() }}
        onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus() }}>
        <button type="button" aria-label={t('residentAssistant.panel.resize')} aria-keyshortcuts="ArrowLeft ArrowRight"
          className="craft-control resident-panel-resize" onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(preference.width + (event.key === 'ArrowLeft' ? 16 : -16)) }
            if (event.key === 'Home') { event.preventDefault(); resize(320) }
            if (event.key === 'End') { event.preventDefault(); resize(640) }
          }} onPointerDown={event => { drag.current = { x: event.clientX, width: preference.width }; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX) }}
          onPointerUp={event => { drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { drag.current = undefined }} onClick={event => { if (event.detail === 0) resize(preference.width === 384 ? 480 : 384) }} />
        <ResidentWorkPanel key={workspaceId} workspaceId={workspaceId} sessionId={sessionId} onClose={() => change({ open: false })} onPreview={setPreview} />
      </PopoverContent>
    </Popover>
    <Dialog open={!!preview && visible} onOpenChange={open => { if (!open) setPreview(undefined) }}>
      <DialogContent className="resident-deliverable-preview sm:max-w-5xl" data-testid="resident-deliverable-preview">
        <DialogHeader><DialogTitle>{preview?.artifact.title}</DialogTitle><DialogDescription>{t('residentAssistant.panel.previewHint')}</DialogDescription></DialogHeader>
        {preview && <React.Suspense fallback={<p role="status">{t('residentAssistant.loading')}</p>}><FilePreview filePath={preview.activePath ?? preview.artifact.sourcePath} mimeType={preview.artifact.mimeType}
          fileSize={preview.artifact.revisions.find(revision => revision.id === (preview.viewedRevision ?? preview.artifact.draftRevision ?? preview.artifact.currentRevision))?.size} /></React.Suspense>}
      </DialogContent>
    </Dialog>
  </>
}
