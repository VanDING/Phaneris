import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, CircleAlert, CircleCheck, CircleDashed, Clock3, ListChecks, Pause, Play, RefreshCw, XOctagon } from 'lucide-react'
import type { TaskProjectionView, TaskStage } from '@phaneris/session-tools-core/task-delegation-contracts'
import { PreviewHeaderIconButton } from '@phaneris/ui'
import { Button } from '@/components/ui/button'
import { useAssistantTasks } from './useAssistantTasks'

/** Stage → stable visual family. Never invented; the Host supplies the stage. */
function stageIcon(stage: TaskStage) {
  if (stage === 'accepted') return CircleCheck
  if (stage === 'cancelled' || stage === 'failed') return XOctagon
  if (stage === 'needs_user' || stage === 'rework') return CircleAlert
  if (stage === 'running' || stage === 'queued' || stage === 'stopping') return Clock3
  if (stage === 'paused') return Pause
  return CircleDashed
}

export function ResidentTasksPanel({ workspaceId, onClose }: { workspaceId: string; onClose?(): void }) {
  const { t } = useTranslation()
  const data = useAssistantTasks(workspaceId)
  const [detailId, setDetailId] = React.useState<string>()
  const detail = data.page.items.find(item => item.task.id === detailId)
  return <>
    {detail ? <ResidentTaskFacts task={detail} onBack={() => setDetailId(undefined)} onChanged={() => void data.refresh()} />
      : <>
        <div className="resident-section-heading">
          <span className="text-meta text-text-secondary" role="status">{t('residentAssistant.tasks.loadedCount', { count: data.page.total })}</span>
          <PreviewHeaderIconButton tooltip={t('residentAssistant.refresh')} aria-label={t('residentAssistant.refresh')} disabled={data.loading || !data.connected} onClick={() => void data.refresh()}><RefreshCw className="size-4" /></PreviewHeaderIconButton>
        </div>
        {data.error && <p role="alert" className="resident-panel-notice text-label text-destructive-text">{data.error}</p>}
        <section data-testid="resident-section-tasks" aria-busy={data.loading}>
          {data.page.items.map(item => {
            const StageIcon = stageIcon(item.stage)
            return <article key={item.task.id} className="resident-work-row" data-testid="resident-task" data-task-stage={item.stage}
              data-definition-version={item.definitionVersion}>
              <button className="craft-control resident-work-entry" onClick={() => setDetailId(item.task.id)}>
                <StageIcon className="resident-work-glyph size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium truncate" title={item.task.title}>{item.task.title}</span>
                  <span className="resident-work-state text-meta" data-activity={item.stage}>
                    {t(`residentAssistant.tasks.stage.${item.stage}`)} · {t('residentAssistant.tasks.version', { version: item.definitionVersion })}
                    {item.definitionAheadOfExecution && item.executedVersion !== undefined
                      ? ` · ${t('residentAssistant.tasks.pendingVersion', { version: item.definitionVersion, executed: item.executedVersion })}` : ''}
                  </span>
                </span>
                <ChevronRight className="size-3.5 text-text-secondary shrink-0" aria-hidden="true" />
              </button>
              {item.ready && !item.ready.ready && <p className="resident-work-reason text-meta text-text-secondary line-clamp-2">
                {t('residentAssistant.tasks.notReady', { missing: item.ready.missing.join(', ') })}</p>}
            </article>
          })}
          {!data.page.items.length && <div className="resident-panel-empty text-label text-text-secondary">
            <ListChecks className="size-4 shrink-0" aria-hidden="true" />
            <span>{t(data.loading ? 'residentAssistant.loading' : 'residentAssistant.tasks.empty')}</span></div>}
        </section>
      </>}
    {!detail && <footer className="resident-panel-footer text-micro text-text-secondary" role="status">
      {!data.connected ? t('residentAssistant.panel.offline') : data.updatedAt ? t('residentAssistant.panel.updated', { time: new Date(data.updatedAt).toLocaleTimeString() }) : t('residentAssistant.loading')}
    </footer>}
    {onClose && <Button size="sm" variant="ghost" onClick={onClose}>{t('common.close')}</Button>}
  </>
}

/**
 * Everything the Host actually recorded about one delegation: the definition
 * version, each requirement's own version and state, every submitted change and
 * the assignment history. Missing evidence is shown as missing, not smoothed over.
 */
function ResidentTaskFacts({ task, onBack, onChanged }: { task: TaskProjectionView; onBack(): void; onChanged(): void }) {
  const { t } = useTranslation()
  const control = (action: 'pause' | 'resume' | 'terminate') => window.electronAPI.controlAssistantTasks(task.task.id, { requestId: `card:${action}:${task.task.id}:${task.definitionVersion}`, taskIds: [task.task.id], action }).then(onChanged)
  return <div data-testid="resident-task-facts" data-task-id={task.task.id}>
    <div className="resident-section-heading">
      <Button size="sm" variant="ghost" onClick={onBack}>{t('residentAssistant.backToWork')}</Button>
      <span className="text-meta text-text-secondary">{t(`residentAssistant.tasks.stage.${task.stage}`)}</span>
    </div>
    <dl className="resident-peek-rows">
      <div><dt>{t('residentAssistant.tasks.goal')}</dt><dd>{task.goal.title}</dd></div>
      <div><dt>{t('residentAssistant.tasks.version', { version: task.definitionVersion })}</dt><dd>{task.task.deliverable ?? ''}</dd></div>
      <div><dt>{t('residentAssistant.tasks.scope')}</dt><dd>{[...task.task.scopeIn, ...task.task.scopeOut.map(item => `−${item}`)].join('; ')}</dd></div>
      <div><dt>{t('residentAssistant.tasks.acceptance')}</dt><dd>{task.task.acceptance.map(item => item.statement).join('; ')}</dd></div>
    </dl>
    <section aria-label={t('residentAssistant.tasks.requirements')}>
      <h3 className="text-label font-medium mt-3 mb-1">{t('residentAssistant.tasks.requirements')}</h3>
      {task.requirements.map(requirement => <article key={requirement.id} className="resident-work-row" data-testid="resident-requirement"
        data-requirement-state={requirement.state} data-requirement-version={requirement.version}>
        <span className="text-meta text-text-secondary tabular-nums">v{requirement.version} · {requirement.state}</span>
        <span className="block text-body">{requirement.statement}</span>
        {requirement.supersedes && <span className="text-micro text-text-secondary">{t('residentAssistant.tasks.supersedes', { id: requirement.supersedes })}</span>}
      </article>)}
      {!task.requirements.length && <p className="text-label text-text-secondary">{t('residentAssistant.tasks.noRequirements')}</p>}
    </section>
    <section aria-label={t('residentAssistant.tasks.changes')}>
      <h3 className="text-label font-medium mt-3 mb-1">{t('residentAssistant.tasks.changes')}</h3>
      {task.changes.map(change => <article key={change.id} className="resident-work-row" data-testid="resident-change">
        <span className="text-meta text-text-secondary tabular-nums">{new Date(change.createdAt).toLocaleString()} · v{change.producedVersion}</span>
        <span className="block text-body">{change.items.map(item => `${item.action} v${item.version}`).join(', ')}</span>
      </article>)}
      {!task.changes.length && <p className="text-label text-text-secondary">{t('residentAssistant.tasks.noChanges')}</p>}
    </section>
    <section aria-label={t('residentAssistant.tasks.assignments')}>
      <h3 className="text-label font-medium mt-3 mb-1">{t('residentAssistant.tasks.assignments')}</h3>
      {task.assignments.map(assignment => <article key={assignment.id} className="resident-work-row" data-testid="resident-assignment" data-assignment-state={assignment.state}>
        <span className="text-meta text-text-secondary tabular-nums">v{assignment.definitionVersion} · {assignment.state}{assignment.sessionId ? ` · ${assignment.sessionId}` : ''}</span>
      </article>)}
      {!task.assignments.length && <p className="text-label text-text-secondary">{t('residentAssistant.tasks.noAssignments')}</p>}
    </section>
    {task.verification && <section aria-label={t('residentAssistant.tasks.verification')}>
      <h3 className="text-label font-medium mt-3 mb-1">{t('residentAssistant.tasks.verification')}</h3>
      <p className="text-body">{task.verification.verdict} · v{task.verification.definitionVersion}</p>
      {task.verification.results.map(result => <p key={result.criterionId} className="text-label text-text-secondary">
        {result.criterionId}: {result.outcome}{result.evidence ? ` — ${result.evidence}` : ''}</p>)}
    </section>}
    <div className="resident-panel-notice">
      <Button size="sm" variant="ghost" onClick={() => void control('pause')}><Pause className="size-3.5" />{t('residentAssistant.tasks.pause')}</Button>
      <Button size="sm" variant="ghost" onClick={() => void control('resume')}><Play className="size-3.5" />{t('residentAssistant.tasks.resume')}</Button>
      <Button size="sm" variant="ghost" onClick={() => void control('terminate')}><XOctagon className="size-3.5" />{t('residentAssistant.tasks.terminate')}</Button>
      <Button size="sm" variant="ghost" onClick={onChanged}><RefreshCw className="size-3.5" />{t('residentAssistant.refresh')}</Button>
    </div>
  </div>
}
