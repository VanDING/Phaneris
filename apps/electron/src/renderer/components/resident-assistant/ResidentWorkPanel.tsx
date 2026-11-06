import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Check, ChevronRight, CircleAlert, CircleStop, Clock3, ListChecks, RefreshCw, Search, X } from 'lucide-react'
import { PreviewHeaderIconButton, useInitialFocus } from '@phaneris/ui'
import type { ResolvedArtifact } from '@phaneris/shared/artifacts'
import type { TaskOutputReference } from '@phaneris/session-tools-core/task-result-contracts'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { Button } from '@/components/ui/button'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { FileTypeIcon } from '@/components/icons/FileTypeIcon'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { navigate, routes } from '@/lib/navigate'
import { residentNavigationAtom } from './resident-navigation'
import { ResidentMessaging } from './ResidentMessaging'
import { ResidentTaskDetail, workActivity } from './ResidentTaskDetail'
import { useResidentPanel, type ResidentWorkView } from './useResidentPanel'

export function ResidentWorkPanel({ workspaceId, sessionId, onClose, onPreview }: {
  workspaceId: string; sessionId: string; onClose(): void; onPreview(artifact: ResolvedArtifact): void
}) {
  const { t, i18n } = useTranslation()
  const [view, setView] = React.useState<ResidentWorkView>('current')
  const [search, setSearch] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [detailId, setDetailId] = React.useState<string>()
  const [actionError, setActionError] = React.useState<string>()
  const scroll = React.useRef<HTMLDivElement>(null)
  const positions = React.useRef<Record<string, number>>({})
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const data = useResidentPanel(workspaceId, view, query)
  const metadata = useAtomValue(sessionMetaMapAtom)
  const { pendingPermissions, pendingCredentials, pendingQuestions } = useAppShellContext()
  const presentation = useSetAtom(residentNavigationAtom)
  const closeFocus = useInitialFocus<HTMLButtonElement>()
  const related = new Set([sessionId])
  for (const session of metadata.values()) if (session.workspaceId === workspaceId && session.parentSessionId === sessionId) related.add(session.id)
  const needsDecision = [...related].filter(id => pendingPermissions.get(id)?.length || pendingCredentials.get(id)?.length || pendingQuestions.get(id)?.length)
  React.useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  React.useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = detailId ? 0 : positions.current[view] ?? 0 }, [view, detailId])
  const openSession = (id: string) => {
    presentation(current => current ? { ...current, open: false, closing: true, returnFocus: false } : null)
    navigate(routes.view.allSessions(id))
  }
  const showDetail = (id: string) => {
    positions.current[view] = scroll.current?.scrollTop ?? 0
    returnFocus.current = document.activeElement as HTMLElement
    setDetailId(id)
  }
  const back = () => {
    setDetailId(undefined)
    requestAnimationFrame(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) })
  }
  const switchView = (next: ResidentWorkView) => {
    if (!detailId) positions.current[view] = scroll.current?.scrollTop ?? 0
    setDetailId(undefined); setSearch(''); setQuery(''); setView(next)
  }
  const preview = async (output: TaskOutputReference) => {
    const result = await Promise.allSettled([window.electronAPI.getArtifact(workspaceId, output.artifactId, output.revision)])
    if (result[0].status === 'fulfilled') { setActionError(undefined); onPreview(result[0].value) }
    else setActionError(String(result[0].reason))
  }
  const outputs = data.page.deliverables ?? []
  const groups = [...new Set(outputs.map(output => output.delegationId))]
  const loaded = view === 'deliverables' ? outputs.length : data.page.items.length
  return <>
    <PanelHeader headingLevel={2} title={t('residentAssistant.panel.title')} titleContent={<span id="resident-work-panel-title">{t('residentAssistant.panel.title')}</span>}
      titleAlignment="start" className="resident-panel-chrome" compensateForStoplight={false} actionCount={1}
      actions={<PreviewHeaderIconButton tooltip={t('residentAssistant.refresh')} aria-label={t('residentAssistant.refresh')} disabled={data.loading || !data.connected} onClick={() => void data.refresh()}><RefreshCw className="size-4" /></PreviewHeaderIconButton>}
      trailingAction={<PreviewHeaderIconButton ref={closeFocus} tooltip={t('common.close')} aria-label={t('common.close')} onClick={onClose}><X className="size-4" /></PreviewHeaderIconButton>} />
    <SegmentedTabs className="resident-panel-tabs" ariaLabel={t('residentAssistant.panel.views')} value={view} onChange={switchView}
      items={(['current', 'deliverables', 'history'] as const).map(id => ({ id, label: t(`residentAssistant.panel.view.${id}`) }))} />
    {!detailId && view !== 'current' && <label className="resident-panel-search"><Search className="size-3.5 text-text-secondary" aria-hidden="true" />
      <input className="craft-field" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('residentAssistant.panel.search')} aria-label={t('residentAssistant.panel.search')} /></label>}
    <div ref={scroll} className="resident-panel-scroll text-body">
      {actionError && <p role="alert" className="resident-panel-notice text-label text-destructive-text">{actionError}</p>}
      {detailId ? <ResidentTaskDetail key={detailId} workspaceId={workspaceId} id={detailId} connected={data.connected} assistantBusy={!!metadata.get(sessionId)?.isProcessing}
        onBack={back} onSession={openSession} onPreview={preview} onChanged={() => void data.refresh('background')}
        onRetry={work => window.electronAPI.sendMessage(sessionId, t('residentAssistant.panel.recoveryMessage', { title: work.title ?? t('residentAssistant.panel.untitled'), id: work.id, sessionId: work.sessionId }))} /> : <>
        {view === 'current' && !!needsDecision.length && <section className="resident-pending-requests" data-testid="resident-section-attention">
          {needsDecision.map(id => <button key={id} className="craft-control resident-panel-row text-left" onClick={() => openSession(id)}>
            <CircleAlert className="size-4 text-info" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{metadata.get(id)?.name ?? t('residentAssistant.title')}</span>
            <span className="text-label text-info-text">{t('residentAssistant.panel.handleDecision')}</span><ArrowUpRight className="size-3.5" aria-hidden="true" /></button>)}
        </section>}
        {data.error && <p role="alert" className="resident-panel-notice text-label text-destructive-text">{data.error}</p>}
        {data.hasUpdates && <Button size="sm" variant="ghost" onClick={() => void data.refresh()}>{t('residentAssistant.panel.newUpdates')}</Button>}
        <section data-testid={view === 'deliverables' ? 'resident-section-artifacts' : 'resident-section-work'} aria-busy={data.loading}>
          <div className="resident-section-heading"><span className="text-meta text-text-secondary" role="status">{t('residentAssistant.panel.loadedCount', { count: loaded, total: data.page.total ?? loaded })}</span></div>
          {view !== 'deliverables' && data.page.items.map(work => {
            const phase = workActivity(work)
            const StateIcon = phase === 'completed' ? Check : phase === 'failed' || phase === 'waiting' ? CircleAlert : phase === 'cancelled' ? CircleStop : Clock3
            return <article key={work.id} className="resident-work-row" data-testid="resident-work" data-work-state={work.state} data-phase={phase}>
              <button className="craft-control resident-work-entry" onClick={() => showDetail(work.id)}>
                <StateIcon className="resident-work-glyph size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-body font-medium truncate" title={work.title}>{work.title ?? metadata.get(work.sessionId ?? '')?.name ?? t('residentAssistant.panel.untitled')}</span>
                <span className="resident-work-state text-meta" data-activity={phase}>{t(`residentAssistant.panel.activity.${phase}`)}</span></span>
                <ChevronRight className="size-3.5 text-text-secondary shrink-0" aria-hidden="true" />
              </button>
              {work.error && <p className="resident-work-reason text-meta text-text-secondary line-clamp-2">{work.error}</p>}
              {work.waitingFor && <p className="resident-work-reason text-meta text-text-secondary line-clamp-2">{t(`residentAssistant.panel.blocker.${work.waitingFor.reason}`)}</p>}
            </article>
          })}
          {view === 'deliverables' && groups.map(id => <article key={id} className="resident-delivery-group">
            <button className="craft-control resident-panel-link text-label text-text-secondary" onClick={() => showDetail(id)}>{outputs.find(output => output.delegationId === id)!.taskTitle}</button>
            {outputs.filter(output => output.delegationId === id).map(output => <React.Fragment key={output.id}>
              <button data-testid="resident-artifact" className="craft-control resident-panel-row resident-artifact-row text-left" onClick={() => void preview(output)}>
                <FileTypeIcon name={output.sourcePath} /><span className="min-w-0 flex-1"><span className="block text-body font-medium truncate" title={output.title}>{output.title}</span>
                  <span className="text-meta text-text-secondary tabular-nums">{output.size < 1024 ? output.size + ' B' : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(output.size / 1024) + ' KB'}</span></span>
                <ArrowUpRight className="resident-open-indicator size-3.5 text-text-secondary" aria-hidden="true" /></button>
              {!!output.supporting.length && <details className="resident-work-disclosure text-label"><summary className="craft-control resident-panel-summary">{t('residentAssistant.panel.supporting', { count: output.supporting.length })}</summary>
                {output.supporting.map(item => <button key={item.key} className="craft-control resident-panel-row text-left" onClick={() => void preview(item)}>{item.title}<ArrowUpRight className="size-3.5" /></button>)}</details>}
            </React.Fragment>)}
          </article>)}
          {!loaded && <div className="resident-panel-empty text-label text-text-secondary"><ListChecks className="size-4 shrink-0" aria-hidden="true" /><span>{t(data.loading ? 'residentAssistant.loading' : view === 'deliverables' ? 'residentAssistant.panel.noArtifacts' : view === 'history' ? 'residentAssistant.panel.noHistory' : 'residentAssistant.panel.noWork')}</span></div>}
          {data.page.searchCoverage && data.page.searchCoverage.indexed < data.page.searchCoverage.total && <p role="status" className="text-meta text-text-secondary">{t('residentAssistant.panel.indexing')}</p>}
          {data.page.nextCursor && <Button size="sm" variant="ghost" className="resident-load-more" disabled={data.loading || !data.connected} onClick={() => void data.refresh('more')}>{t('residentAssistant.panel.loadMore')}</Button>}
        </section>
        {view === 'current' && !!data.recent.length && <section className="resident-panel-section resident-recent-results">
          <h3 className="text-label font-medium mt-3 mb-1">{t('residentAssistant.panel.recent')}</h3>
          {data.recent.map(work => <button key={work.id} data-testid="resident-recent" className="craft-control resident-panel-row text-left" onClick={() => showDetail(work.id)}>
            <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-label">{work.title ?? t('residentAssistant.panel.untitled')}</span><ChevronRight className="size-3.5 shrink-0 text-text-secondary" /></button>)}
        </section>}
      </>}
    </div>
    <ResidentMessaging sessionId={sessionId} config={data.messaging} bindings={data.bindings} connected={data.connected} unavailable={!!data.messagingError} onChanged={() => void data.refreshMessaging()} />
    <footer className="resident-panel-footer text-micro text-text-secondary" role="status">{!data.connected ? t('residentAssistant.panel.offline') : data.updatedAt ? t('residentAssistant.panel.updated', { time: new Date(data.updatedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) }) : t('residentAssistant.loading')}</footer>
  </>
}

