import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskProjectionView, TaskStage } from '@phaneris/session-tools-core/task-delegation-contracts'
import { DEFAULT_ASSISTANT_TASK_CONCURRENCY } from '@phaneris/session-tools-core/delegation-contracts'
import type { ResolvedArtifact } from '@phaneris/shared/artifacts'
import type { TaskDeliverable } from '@phaneris/session-tools-core/task-result-contracts'
import { useAssistantTasks } from './useAssistantTasks'
import { actionsFor, askedReasonOf, focusToneOf, initialFocus, segmentsFor, type FocusAction } from './focus-board'
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

/**
 * Where the board is being drawn.
 *
 * `peek` is the popover that opens from the assistant's slot in the titlebar;
 * `dock` is the panel inside the assistant's own view. They render the same
 * facts from one component, but the peek is a wide card and the dock is a tall
 * narrow panel anchored to the right edge — so the dock stacks its content
 * instead of splitting it into columns.
 */
export type FocusSurface = 'peek' | 'dock'

export interface FocusBoardProps {
  workspaceId: string
  /** Which composition to draw. Both surfaces share every rule below it. */
  surface?: FocusSurface
  onPreview?(artifact: ResolvedArtifact): void
  onOpenTask?(taskId: string): void
}

/** A deliverable, as both surfaces list it. */
function deliveredFiles(deliverables: readonly TaskDeliverable[]): readonly TaskDeliverable[] {
  return deliverables.slice(0, 5)
}

/**
 * The assistant's work board.
 *
 * Two surfaces render this one component so they cannot drift: the peek that
 * opens when the pointer rests on the assistant's slot in the titlebar, and
 * the panel inside the assistant's own view. It reads Host projections and
 * sends Host commands; it never derives stage, acceptance or progress.
 *
 * The gauge row is the task switcher: one bar per task in play, the bar count
 * follows the task count, and a bar's fill carries its state. The task *title*
 * strip the previous version rendered beside the capacity meter is gone — the
 * two were both task switchers and competed for the same width, which is how
 * the title strip ended up 0px wide on a 389px panel.
 */
export function FocusBoard({ workspaceId, surface = 'peek', onPreview, onOpenTask }: FocusBoardProps) {
  const { t } = useTranslation()
  const { page, scheduling, deliverables, loading, error, refresh } = useAssistantTasks(workspaceId)
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
  // Capacity is the Host's own scheduling record, not a count recomputed here:
  // the board and the scheduler must answer "how many can run" with one number.
  const occupied = scheduling?.occupied ?? items.filter(item => ['running', 'stopping'].includes(item.stage)).length
  const capacity = scheduling?.capacity ?? DEFAULT_ASSISTANT_TASK_CONCURRENCY
  const reason = projection ? askedReasonOf(projection) : undefined

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

  const record = projection && <div className="focus-scroll" data-testid="focus-record">
    <div className="focus-heading">
      <h2 className="focus-title">{projection.task.title}</h2>
      <div className="focus-heading-meta">
        <span className="focus-state" data-state={projection.stage} data-tone={focusToneOf(projection.stage)}>
          {t(STAGE_KEY[projection.stage])}
        </span>
        <span className="focus-file-tag" data-testid="focus-version">v{projection.definitionVersion}</span>
        {projection.executedVersion !== undefined && projection.executedVersion !== projection.definitionVersion &&
          <span className="focus-file-tag" data-testid="focus-executed">v{projection.executedVersion}</span>}
        <span className="focus-ago">{t('residentAssistant.panel.updated', { time: new Date(projection.task.updatedAt).toLocaleTimeString() })}</span>
      </div>
    </div>

    {/* Why the task is waiting for the user — the first question a reader has. */}
    {reason
      ? <div className="focus-asked" data-testid="focus-asked">
        <span className="focus-asked-label">{t('residentAssistant.board.asked.label')}</span>
        {reason}
      </div>
      : <div className="focus-asked" data-testid="focus-asked" data-recorded="false">
        <span className="focus-asked-label">{t('residentAssistant.board.asked.label')}</span>
        {t('residentAssistant.board.asked.unknown')}
      </div>}

    {/* Requirement versions: a correction appends, and the old one stays readable. */}
    <h3 className="focus-label">{t('residentAssistant.tasks.requirements')}<span>{projection.requirements.length}</span></h3>
    {projection.requirements.length
      ? <div className="focus-versions">
        {projection.requirements.map(requirement => <div key={requirement.id} className="focus-version" data-state={requirement.state}>
          <span className="focus-version-tag">v{requirement.version}</span>
          <span className="focus-version-body">
            <span className="focus-version-text">{requirement.statement}</span>
            <span className="focus-version-note">{t(`residentAssistant.board.requirement.${requirement.state}`)}</span>
          </span>
        </div>)}
      </div>
      : <p className="focus-none">{t('residentAssistant.tasks.noRequirements')}</p>}

    {/* The Host's own definition: goal, scope, deliverable. */}
    <h3 className="focus-label">{t('residentAssistant.board.definition')}</h3>
    <dl className="focus-facts">
      <dt>{t('residentAssistant.tasks.goal')}</dt><dd>{projection.goal.title}</dd>
      <dt>{t('residentAssistant.tasks.scope')}</dt>
      <dd>{[...projection.task.scopeIn, ...projection.task.scopeOut.map(item => `−${item}`)].join('；') || '—'}</dd>
      {projection.task.deliverable && <><dt>{t('residentAssistant.board.deliverable')}</dt><dd>{projection.task.deliverable}</dd></>}
    </dl>

    {/* Criteria with their recorded outcome, when a decision was recorded. */}
    {projection.task.acceptance.length > 0 && <>
      <h3 className="focus-label">{t('residentAssistant.tasks.acceptance')}<span>{projection.task.acceptance.length}</span></h3>
      <ol className="focus-criteria">
        {projection.task.acceptance.map(criterion => {
          const result = projection.verification?.results.find(item => item.criterionId === criterion.id)
          return <li key={criterion.id} className="focus-criterion" data-outcome={result?.outcome ?? 'pending'}>
            <span className="focus-criterion-glyph" aria-hidden="true">
              {result?.outcome === 'met' ? '✓' : result?.outcome === 'gap' ? '!' : '·'}
            </span>
            <span className="focus-criterion-text">{criterion.statement}</span>
            <span className="focus-criterion-state">{t(`residentAssistant.board.outcome.${result?.outcome ?? 'pending'}`)}</span>
          </li>
        })}
      </ol>
    </>}

    {/* Assignments: which Session ran which version, and how it ended. */}
    <h3 className="focus-label">{t('residentAssistant.tasks.assignments')}<span>{projection.assignments.length}</span></h3>
    {projection.assignments.length
      ? <div className="focus-assignments">
        {projection.assignments.map(assignment => <div key={assignment.id} className="focus-assignment">
          <span className="focus-version-tag">v{assignment.definitionVersion}</span>
          <span className="focus-assignment-session">{assignment.sessionId ?? '—'}</span>
          <span className="focus-assignment-state">{t(`residentAssistant.board.assignment.${assignment.state}`)}</span>
        </div>)}
      </div>
      : <p className="focus-none">{t('residentAssistant.tasks.noAssignments')}</p>}
  </div>

  const actionsBar = <div className="focus-actions" data-testid="focus-actions">
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
    {!actions.length && projection && <span className="focus-none">{t(STAGE_KEY[projection.stage])}</span>}
    {onOpenTask && projection && <button type="button" className="craft-control focus-text-action"
      onClick={() => onOpenTask(projection.task.id)}>{t('residentAssistant.board.openTask')}</button>}
  </div>

  const rail = <aside className="focus-rail" aria-label={t('residentAssistant.board.rail')}>
    <section className="focus-rail-block focus-rail-grow" data-testid="focus-rail">
      <h3 className="focus-rail-head">
        {t('residentAssistant.board.inFlight')}
        <span className="focus-rail-count num">{segments.length}</span>
      </h3>
      <div className="focus-rail-list">
        {segments.length
          ? segments.map(segment => <button key={segment.taskId} type="button"
            className="craft-control focus-rail-row" data-testid="focus-rail-row" data-stage={segment.stage}
            aria-current={segment.taskId === selected ? 'true' : undefined}
            onClick={() => setSelected(segment.taskId)}>
            <span className="focus-rail-dot" data-tone={focusToneOf(segment.stage)} aria-hidden="true" />
            <span className="focus-rail-body">
              <span className="focus-rail-title">{segment.title}</span>
              <span className="focus-rail-state">{t(STAGE_KEY[segment.stage])}</span>
            </span>
          </button>)
          : <p className="focus-none">{t('residentAssistant.tasks.empty')}</p>}
      </div>
    </section>

    <section className="focus-rail-block focus-rail-delivered" data-testid="focus-delivered">
      <h3 className="focus-rail-head">
        {t('residentAssistant.board.deliverables')}
        <span className="focus-rail-count num">{deliverables.length}</span>
      </h3>
      {deliverables.length
        ? deliveredFiles(deliverables).map(output => <button key={output.id} type="button"
          className="craft-control focus-file" data-testid="focus-delivered-file"
          aria-label={`${t('residentAssistant.board.deliverablesHint')}： ${output.title}`}
          onClick={() => openArtifact(output.artifactId, output.revision)}>
          <span className="focus-file-name">{output.title}</span>
          <span className="focus-file-tag">{output.revision}</span>
        </button>)
        : <p className="focus-none">{t('residentAssistant.panel.noArtifacts')}</p>}
    </section>
  </aside>

  return <div className="focus-board" data-testid="focus-board" data-surface={surface}
    aria-label={t(`residentAssistant.board.surface.${surface}`)}>
    {/* The gauge is the switcher: one bar per task in play, fill carries state. */}
    <div className="focus-gauge">
      <div className="focus-bars" role="group" data-testid="focus-bars" aria-label={t('residentAssistant.board.switchTask')}>
        {segments.map(segment => <button key={segment.taskId} type="button"
          className="craft-control focus-bar" data-testid="focus-bar" data-task={segment.taskId} data-stage={segment.stage}
          data-tone={focusToneOf(segment.stage)}
          aria-current={segment.taskId === selected ? 'true' : undefined}
          aria-label={t('residentAssistant.board.bar', { title: segment.title, stage: t(STAGE_KEY[segment.stage]) })}
          onClick={() => setSelected(segment.taskId)} />)}
      </div>
      <div className="focus-gauge-legend" aria-hidden="true">
        <span><i data-tone="needs" />{t(STAGE_KEY.needs_user)}</span>
        <span><i data-tone="active" />{t(STAGE_KEY.running)}</span>
        <span data-kind="extra"><i data-tone="idle" />{t(STAGE_KEY.queued)}</span>
      </div>
    </div>

    {/* The bars only carry fills, so the selected task's own name and state
        live here in words. This is the last chrome row before the content. */}
    <div className="focus-gauge-caption" data-testid="focus-caption">
      <span className="focus-state focus-gauge-state" data-state={projection?.stage ?? 'intake'}
        data-tone={projection ? focusToneOf(projection.stage) : 'idle'}>
        {projection ? t(STAGE_KEY[projection.stage]) : t('residentAssistant.tasks.empty')}
      </span>
      <span className="focus-gauge-name">{projection?.task.title ?? ''}</span>
      <span className="focus-gauge-count">{t('residentAssistant.board.taskCount', { count: segments.length })}</span>
      <span className="focus-gauge-count" data-testid="focus-capacity">
        {t('residentAssistant.board.capacity', { occupied, capacity: Math.max(capacity, occupied) })}
      </span>
      <button type="button" className="craft-control focus-text-action" aria-label={t('residentAssistant.refresh')}
        disabled={loading} onClick={() => void refresh()}>↻</button>
    </div>

    {error && <p role="alert" className="focus-error">{error}</p>}
    {!error && !projection && <p className="focus-empty">
      {t(loading ? 'residentAssistant.loading' : 'residentAssistant.tasks.empty')}</p>}

    {!error && projection && <>
      <div className="focus-body" data-surface={surface}>
        {surface === 'peek'
          ? <div className="focus-left">{record}{actionsBar}</div>
          : <>{record}{rail}{actionsBar}</>}
        {surface === 'peek' ? rail : null}
      </div>
    </>}
  </div>
}
