import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import type { AssistantWork, AssistantWorkExecution } from '@phaneris/session-tools-core/delegation-contracts'
import type { TaskOutputReference } from '@phaneris/session-tools-core/task-result-contracts'
import { Button } from '@/components/ui/button'
import { WorkerManagement } from './WorkerManagement'
import { SessionOriginals } from './SessionOriginals'

export function workActivity(work: AssistantWork): NonNullable<AssistantWorkExecution['activity']> {
  return work.execution?.activity ?? ({ accepted: 'queued', preparing: 'queued', submitting: 'requesting', submitted: 'requesting',
    result_ready: 'completed', needs_attention: 'waiting', failed: 'failed', cancel_requested: 'waiting', cancelled: 'cancelled', pause_requested: 'waiting', paused: 'waiting' } as const)[work.state]
}

export function ResidentTaskDetail({ workspaceId, id, connected, assistantBusy, onBack, onSession, onPreview, onChanged, onRetry }: {
  workspaceId: string; id: string; connected: boolean; assistantBusy: boolean; onBack(): void; onSession(id: string): void
  onPreview(output: TaskOutputReference): Promise<void>; onChanged(): void
  onRetry(work: AssistantWork): Promise<void>
}) {
  const { t } = useTranslation()
  const [work, setWork] = React.useState<AssistantWork>()
  const [error, setError] = React.useState<string>()
  const [busy, setBusy] = React.useState(false)
  const originalsSessionId = work?.execution?.continuationSessionId ?? work?.sessionId
  const generation = React.useRef(0)
  const invalidate = React.useCallback(() => { generation.current++ }, [])
  const [processFiles, setProcessFiles] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listArtifacts>>>()
  React.useEffect(() => {
    let active = true, reading = false
    const read = async () => {
      if (!connected || reading) return
      reading = true
      const token = generation.current
      const result = await Promise.allSettled([window.electronAPI.getAssistantWork(workspaceId, { id })])
      if (active && token === generation.current) {
        if (result[0].status === 'fulfilled') { setWork(result[0].value.items[0]); setError(result[0].value.items.length ? undefined : t('residentAssistant.panel.unavailable')) }
        else setError(String(result[0].reason))
      }
      reading = false
    }
    void read()
    const timer = window.setInterval(() => { if (!document.hidden) void read() }, 3000)
    return () => { active = false; invalidate(); clearInterval(timer) }
  }, [workspaceId, id, connected, t, invalidate])
  const action = async (run: () => Promise<unknown>) => {
    invalidate()
    setBusy(true); setError(undefined)
    const result = await Promise.allSettled([Promise.resolve().then(run)])
    if (result[0].status === 'rejected') setError(String(result[0].reason))
    setBusy(false); onChanged()
  }
  return <section data-testid="resident-task-detail" className="resident-task-detail">
    <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="size-3.5" />{t('residentAssistant.panel.back')}</Button>
    {error && <p role="alert" className="resident-panel-notice text-label text-destructive-text">{error}</p>}
    {!work && !error && <p role="status" className="resident-panel-empty text-label">{t('residentAssistant.loading')}</p>}
    {work && <>
      <h3 className="text-body font-medium break-words mt-3">{work.title ?? t('residentAssistant.panel.untitled')}</h3>
      <p className="resident-work-state text-label mt-1" data-activity={workActivity(work)}>{t(work.state === 'paused' || work.state === 'pause_requested' ? `residentAssistant.control.${work.state}` : `residentAssistant.panel.activity.${workActivity(work)}`)}</p>
      {work.error && <p className="resident-panel-notice text-label text-destructive-text">{work.error}</p>}
      {work.waitingFor && <p className="resident-panel-notice text-label text-text-secondary">{t(`residentAssistant.panel.blocker.${work.waitingFor.reason}`)}</p>}
      {work.result && <WorkResult workspaceId={workspaceId} {...work.result} />}
      {work.execution?.followUp && <p className="text-meta text-text-secondary mt-3">{t(work.execution.followUp.isProcessing ? 'residentAssistant.panel.followUpRunning'
        : work.execution.followUp.result ? 'residentAssistant.panel.followUpReady' : 'residentAssistant.panel.followUp')}</p>}
      {work.execution?.followUp?.result && <WorkResult workspaceId={workspaceId} {...work.execution.followUp.result} label={t('residentAssistant.panel.reviewFollowUp')} />}
      {work.execution?.error && <details className="resident-work-disclosure text-label"><summary className="craft-control resident-panel-summary">{t('residentAssistant.panel.errorDetails')}</summary><p className="resident-result-text text-label">{work.execution.error.summary}</p></details>}
      {work.outputManifest && <details className="resident-work-disclosure text-label"><summary className="craft-control resident-panel-summary">{t('residentAssistant.panel.outputManifest', { count: work.outputManifest.outputs.length })}</summary>
        <p className="resident-result-text">{work.outputManifest.summary}</p>
        {work.outputManifest.outputs.map(output => <div key={output.key}>
          <button className="craft-control resident-panel-row text-left" onClick={() => void action(() => onPreview(output))}>
            <span className="min-w-0 flex-1 break-words">{output.title}<span className="block text-meta text-text-secondary">{t(`residentAssistant.panel.outputRole.${output.role}`)}</span></span><ArrowUpRight className="size-3.5" /></button>
          {output.role !== 'intermediate' && work.outputManifest!.selectedKeys?.includes(output.key) && <Button size="sm" variant="ghost" disabled={busy || !connected}
            onClick={() => void action(async () => {
              const manifest = await window.electronAPI.setAssistantOutputVisibility(workspaceId, { delegationId: id, expectedRevision: work.outputManifest!.revision, key: output.key, visible: !!output.hidden })
              setWork(current => current ? { ...current, outputManifest: manifest } : current)
            })}>{t(output.hidden ? 'residentAssistant.panel.restoreOutput' : 'residentAssistant.panel.hideOutput')}</Button>}
        </div>)}
      </details>}
      {work.sessionId && <details className="resident-work-disclosure text-label" onToggle={event => {
        if (event.currentTarget.open && !processFiles) void action(async () => setProcessFiles(await window.electronAPI.listArtifacts(workspaceId, { sessionId: work.sessionId })))
      }}><summary className="craft-control resident-panel-summary">{t('residentAssistant.panel.processFiles')}</summary>
        {processFiles?.map(({ artifact }) => <p className="resident-result-text" key={artifact.id}>{artifact.title}</p>)}
      </details>}
      {work.effectiveConfig && <details className="resident-work-disclosure text-label"><summary className="craft-control resident-panel-summary">{t('residentAssistant.panel.taskDetails')}</summary>
        <dl className="resident-execution-config">{Object.entries(work.effectiveConfig).map(([key, value]) => <div key={key}><dt className="text-text-secondary">{key}</dt><dd className="break-words">{Array.isArray(value) ? value.join(', ') || '—' : String(value ?? '—')}</dd></div>)}</dl>
        {work.adjustments?.map(reason => <p key={reason} className="text-label text-text-secondary break-words">{reason}</p>)}
        <p className="text-meta text-text-secondary tabular-nums">{t('residentAssistant.panel.duration', { seconds: Math.max(0, Math.round((work.updatedAt - work.createdAt) / 1000)) })}</p>
      </details>}
      {originalsSessionId && <SessionOriginals key={originalsSessionId} workspaceId={workspaceId} sessionId={originalsSessionId} connected={connected} />}
      <WorkerManagement key={work.id} workspaceId={workspaceId} work={work} connected={connected} onChange={updated => { invalidate(); setWork(updated); onChanged() }} />
      <div className="resident-work-actions mt-4">
        {work.sessionId && <Button size="sm" variant="outline" onClick={() => onSession(work.sessionId!)}>{t('residentAssistant.panel.openTask')}<ArrowUpRight className="size-3.5" /></Button>}
        {['accepted', 'preparing', 'submitting', 'submitted', 'needs_attention', 'paused', 'pause_requested'].includes(work.state) && <Button size="sm" variant="ghost" disabled={busy || !connected} onClick={() => void action(() => window.electronAPI.cancelAssistantWork(workspaceId, id))}>{t('residentAssistant.panel.stop')}</Button>}
        {work.sessionId && work.state === 'cancelled' && !work.execution?.followUp && <Button size="sm" variant="ghost" disabled={busy || !connected || assistantBusy}
          onClick={() => void action(() => onRetry(work))}>{t('residentAssistant.panel.retry')}</Button>}
      </div>
    </>}
  </section>
}

function WorkResult({ workspaceId, sessionId, messageId, label }: { workspaceId: string; sessionId: string; messageId: string; label?: string }) {
  const { t } = useTranslation()
  const [result, setResult] = React.useState<string>()
  const [error, setError] = React.useState<string>()
  const [loading, setLoading] = React.useState(false)
  const generation = React.useRef(0)
  const invalidate = React.useCallback(() => { generation.current++ }, [])
  React.useEffect(() => {
    setResult(undefined); setError(undefined); setLoading(false)
    const off = window.electronAPI.onAssistantMemoryChanged(event => { if (event.workspaceId === workspaceId) { generation.current++; setResult(undefined); setError(undefined); setLoading(false) } })
    return () => { invalidate(); off() }
  }, [workspaceId, sessionId, messageId, invalidate])
  const read = async () => {
    const token = ++generation.current
    setLoading(true); setError(undefined)
    const source = await Promise.allSettled([window.electronAPI.readAssistantMemorySource(workspaceId, { sessionId, messageId })])
    if (token !== generation.current) return
    if (source[0].status === 'fulfilled') setResult(source[0].value.content)
    else setError(String(source[0].reason))
    setLoading(false)
  }
  return <details className="resident-work-disclosure text-label" onToggle={event => { if (event.currentTarget.open && result === undefined && !loading) void read() }}>
    <summary className="craft-control resident-panel-summary">{label ?? t('residentAssistant.readResult')}</summary>
    {loading && <p role="status">{t('residentAssistant.loading')}</p>}
    {error && <p role="alert" className="text-destructive-text break-words">{error}</p>}
    {result && <p className="resident-result-text text-label">{result}</p>}
  </details>
}
