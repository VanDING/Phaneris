import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskProjectionView, TaskStage } from '@phaneris/session-tools-core/task-delegation-contracts'
import type { ResolvedArtifact } from '@phaneris/shared/artifacts'
import { useAssistantTasks } from './useAssistantTasks'
import { actionsFor, initialFocus, segmentsFor, type FocusAction } from './focus-board'
import './focus-board.css'

/** Stage name as the product already words it; no parallel vocabulary. */
const STAGE_KEY: Record<TaskStage, string> = {
  intake: 'residentAssistant.tasks.stage.intake',
  ready: 'residentAssistant.tasks.stage.ready',
  queued: 'residentAssistant.tasks.stage.queued',
  running: 'residentAssistant.tasks.stage.running',
  stopping: 'residentAssistant.tasks.stage.stopping',
  paused: 'residentAssistant.tasks.stage.paused',
  candidate_result: 'residentAssistant.tasks.stage.candidate_result',
  needs_user: 'residentAssistant.tasks.stage.needs_user',
  accepted: 'residentAssistant.tasks.stage.accepted',
  rework: 'residentAssistant.tasks.stage.rework',
  failed: 'residentAssistant.tasks.stage.failed',
  cancelled: 'residentAssistant.tasks.stage.cancelled',
}

export interface FocusBoardProps {
  workspaceId: string
  /** Deliverables are read from the same bounded page the panel already loads. */
  deliverables?: ReadonlyArray<{ id: string; title: string; sourcePath: string; revision: string; artifactId: string }>
  onPreview?(artifact: ResolvedArtifact): void
  onOpenTask?(taskId: string): void
}

/**
 * The assistant's work board.
 *
 * Two surfaces render this one component so they cannot drift: the peek that
 * opens when the pointer rests on the assistant's slot in the titlebar, and
 * the panel inside the assistant's own view. It reads Host projections and
 * sends Host commands; it never derives stage, acceptance or progress.
 */
export function FocusBoard({ workspaceId, deliverables = [], onPreview, onOpenTask }: FocusBoardProps) {
  const { t } = useTranslation()
  const { page, scheduling, deliverables: delivered, loading, error, refresh } = useAssistantTasks(workspaceId)
  const [selected, setSelected] = React.useState<string>()
  const [busy, setBusy] = React.useState(false)
  const items = page.items

  // Follow the data: keep the selection when it still exists, otherwise open
  // on the task that most needs the user (one rule, in focus-board.ts).
  React.useEffect(() => {
    if (!items.length) { setSelected(undefined); return }
    setSelected(current => current && items.some(item => item.task.id === current) ? current : initialFocus(items))
  }, [items])

  const projection = items.find(item => item.task.id === selected)
  const segments = segmentsFor(items)
  const actions = projection ? actionsFor(projection) : []
  // Capacity is the Host's own scheduling record, not a count recomputed here.
  // `null` means the workspace sets no ceiling, so the strip must not draw a
  // ceiling of its own: it reports how many are running and says so plainly.
  const occupied = scheduling?.occupied ?? items.filter(item => ['running', 'stopping'].includes(item.stage)).length
  const capacity = scheduling?.capacity ?? null

  const control = (action: FocusAction) => {
    if (!projection || busy) return
    setBusy(true)
    const command = action === 'accept' || action === 'rework'
      ? window.electronAPI.verifyAssistantTask(workspaceId, {
        requestId: `board:${action}:${projection.task.id}:${projection.definitionVersion}`,
        taskId: projection.task.id,
        verdict: action === 'accept' ? 'accepted' : 'rework',
        results: projection.task.acceptance.map(criterion => ({ criterionId: criterion.id, outcome: 'undecided' as const })),
      })
      : window.electronAPI.controlAssistantTasks(workspaceId, {
        requestId: `board:${action}:${projection.task.id}:${projection.definitionVersion}`,
        taskIds: [projection.task.id], action,
      })
    void Promise.resolve(command).then(() => refresh()).finally(() => setBusy(false))
  }

  const openArtifact = (artifactId: string, revision: string) => {
    if (!onPreview) return
    void window.electronAPI.getArtifact(workspaceId, artifactId, revision)
      .then(artifact => onPreview(artifact))
      .catch(() => { /* a missing revision is reported by the panel's own error line */ })
  }

  return <div className="focus-board" data-testid="focus-board">
    <div className="focus-left">
      {/* The capacity strip spans this column and is the task switcher. No title. */}
      <div className="focus-strip" role="tablist" aria-label={t('residentAssistant.board.switchTask')}>
        <span className="focus-readout">
          <span className="focus-seats" aria-hidden="true">
            {/* One seat per running task. A declared ceiling also shows its free
                slots; with no ceiling there are no free slots to draw. Nothing
                is drawn when nothing runs, so the meter never implies occupancy. */}
            {Array.from({ length: capacity === null ? occupied : Math.max(capacity, occupied) }, (_, index) =>
              <span key={index} className="focus-seat" data-on={index < occupied} />)}
          </span>
          <span className="focus-count" data-testid="focus-capacity">
            {capacity === null
              ? t('residentAssistant.board.running', { occupied })
              : t('residentAssistant.board.capacity', { occupied, capacity: Math.max(capacity, occupied, 1) })}
          </span>
        </span>
        <div className="focus-segments">
          {segments.map(segment => <button key={segment.taskId} type="button" role="tab" className="craft-control focus-segment"
            data-testid="focus-segment" data-task={segment.taskId} data-stage={segment.stage}
            aria-selected={segment.taskId === selected}
            onClick={() => setSelected(segment.taskId)}>
            <span className="focus-segment-dot" aria-hidden="true" />
            <span className="focus-segment-title">{segment.title}</span>
          </button>)}
        </div>
        <button type="button" className="craft-icon-button focus-refresh" aria-label={t('residentAssistant.refresh')}
          disabled={loading} onClick={() => void refresh()}>↻</button>
      </div>

      {error && <p role="alert" className="focus-error text-label">{error}</p>}
      {!error && !projection && <p className="focus-empty text-label">
        {t(loading ? 'residentAssistant.loading' : 'residentAssistant.tasks.empty')}</p>}

      {projection && <div className="focus-surface">
        <div className="focus-record">
          <div className="focus-heading">
            <h2 className="focus-title">{projection.task.title}</h2>
            <span className="focus-stage" data-stage={projection.stage}>{t(STAGE_KEY[projection.stage])}</span>
          </div>

          {/* The Host's own definition: goal, scope, deliverable, criteria. */}
          <h3 className="focus-label">{t('residentAssistant.board.definition')}</h3>
          <dl className="focus-facts">
            <dt>{t('residentAssistant.tasks.goal')}</dt><dd>{projection.goal.title}</dd>
            <dt>{t('residentAssistant.tasks.scope')}</dt>
            <dd>{[...projection.task.scopeIn, ...projection.task.scopeOut.map(item => `−${item}`)].join('；') || '—'}</dd>
            {projection.task.deliverable && <><dt>{t('residentAssistant.board.deliverable')}</dt><dd>{projection.task.deliverable}</dd></>}
          </dl>

          {/* Requirement versions: a correction appends, and the old one stays readable. */}
          <h3 className="focus-label">{t('residentAssistant.tasks.requirements')}</h3>
          {projection.requirements.length
            ? <div className="focus-versions">
              {projection.requirements.map(requirement => <div key={requirement.id} className="focus-version"
                data-state={requirement.state}>
                <span className="focus-version-tag">v{requirement.version}</span>
                <span className="focus-version-text">{requirement.statement}</span>
                <span className="focus-version-state">{t(`residentAssistant.board.requirement.${requirement.state}`)}</span>
              </div>)}
            </div>
            : <p className="focus-none text-label">{t('residentAssistant.tasks.noRequirements')}</p>}

          {/* Assignments: which Session ran which version, and how it ended. */}
          <h3 className="focus-label">{t('residentAssistant.tasks.assignments')}</h3>
          {projection.assignments.length
            ? <div className="focus-assignments">
              {projection.assignments.map(assignment => <div key={assignment.id} className="focus-assignment">
                <span className="focus-version-tag">v{assignment.definitionVersion}</span>
                <span className="focus-assignment-session">{assignment.sessionId ?? '—'}</span>
                <span className="focus-version-state">{t(`residentAssistant.board.assignment.${assignment.state}`)}</span>
              </div>)}
            </div>
            : <p className="focus-none text-label">{t('residentAssistant.tasks.noAssignments')}</p>}

          {/* Criteria with their recorded outcome, when a decision was recorded. */}
          {projection.task.acceptance.length > 0 && <>
            <h3 className="focus-label">{t('residentAssistant.tasks.acceptance')}</h3>
            <ol className="focus-criteria">
              {projection.task.acceptance.map(criterion => {
                const result = projection.verification?.results.find(item => item.criterionId === criterion.id)
                return <li key={criterion.id} className="focus-criterion" data-outcome={result?.outcome ?? 'pending'}>
                  <span className="focus-criterion-text">{criterion.statement}</span>
                  <span className="focus-version-state">{t(`residentAssistant.board.outcome.${result?.outcome ?? 'pending'}`)}</span>
                </li>
              })}
            </ol>
          </>}
        </div>

        {/* Action group follows the stage: an action the Host would refuse is not shown. */}
        <div className="focus-actions">
          {actions.includes('accept') && <button type="button" className="craft-control focus-primary"
            data-testid="focus-accept" disabled={busy} onClick={() => control('accept')}>
            {t('residentAssistant.board.accept')}</button>}
          {actions.includes('rework') && <button type="button" className="craft-control focus-secondary"
            data-testid="focus-rework" disabled={busy} onClick={() => control('rework')}>
            {t('residentAssistant.board.rework')}</button>}
          {actions.includes('pause') && <button type="button" className="craft-control focus-secondary"
            data-testid="focus-pause" disabled={busy} onClick={() => control('pause')}>
            {t('residentAssistant.tasks.pause')}</button>}
          {actions.includes('resume') && <button type="button" className="craft-control focus-secondary"
            data-testid="focus-resume" disabled={busy} onClick={() => control('resume')}>
            {t('residentAssistant.tasks.resume')}</button>}
          {actions.includes('terminate') && <button type="button" className="craft-control focus-secondary focus-danger"
            data-testid="focus-terminate" disabled={busy} onClick={() => control('terminate')}>
            {t('residentAssistant.tasks.terminate')}</button>}
          {!actions.length && <span className="focus-none text-label">{t(`residentAssistant.tasks.stage.${projection.stage}`)}</span>}
          {onOpenTask && <button type="button" className="craft-control focus-text-action"
            onClick={() => onOpenTask(projection.task.id)}>{t('residentAssistant.board.openTask')}</button>}
        </div>
      </div>}
    </div>

    {/* The rail: work in flight, and what was delivered, at the bottom. */}
    <aside className="focus-rail" aria-label={t('residentAssistant.board.rail')}>
      <section className="focus-rail-block focus-rail-grow">
        <h3 className="focus-rail-head">{t('residentAssistant.board.inFlight')}<span className="focus-rail-count num">{segments.length}</span></h3>
        <div className="focus-rail-list">
          {segments.length
            ? segments.map(segment => <button key={segment.taskId} type="button"
              className="craft-control focus-rail-row" data-testid="focus-rail-row" data-stage={segment.stage}
              aria-current={segment.taskId === selected ? "true" : undefined} onClick={() => setSelected(segment.taskId)}>
              <span className="focus-rail-dot" data-stage={segment.stage} aria-hidden="true" />
              <span className="focus-rail-title">{segment.title}</span>
              <span className="focus-rail-state">{t(STAGE_KEY[segment.stage])}</span>
            </button>)
            : <p className="focus-none text-label">{t('residentAssistant.tasks.empty')}</p>}
        </div>
      </section>

      <section className="focus-rail-block focus-rail-delivered" data-testid="focus-delivered">
        <h3 className="focus-rail-head">{t('residentAssistant.board.deliverables')}<span className="focus-rail-count num">{delivered.length}</span></h3>
        {delivered.length
          ? delivered.slice(0, 5).map(output => <button key={output.id} type="button"
            className="craft-control focus-rail-file" data-testid="focus-delivered-file"
            onClick={() => openArtifact(output.artifactId, output.revision)}>
            <span className="focus-rail-file-name">{output.title}</span>
          </button>)
          : <p className="focus-none text-label">{t('residentAssistant.panel.noArtifacts')}</p>}
      </section>
    </aside>
  </div>
}
