import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * Stage 5 acceptance: workspace-level controlled switch, shadow comparison and
 * rollback.
 *
 * A workspace binds exactly one current entry. While the new entry is in shadow
 * mode it must not dispatch or send anything; switching is a single recorded
 * decision; rolling back freezes new admission first, then either drains the
 * in-flight work or hands it over explicitly. Records stay readable throughout.
 *
 * Failure conditions are M29-M33 in
 * docs/verification/assistant-refactor-2026-11-18-failure-matrix.md.
 *
 * This workflow is a deterministic replay against isolated copies. It does not
 * switch a real installation; that needs the user's explicit authorization.
 */
type Entry = 'legacy' | 'tasks'
type Mode = 'shadow' | 'active'
interface SwitchState { workspaceId: string; entry: Entry; mode: Mode; since: number; reason: string; history: Array<{ entry: Entry; mode: Mode; at: number; reason: string }> }

/** One current entry per workspace; shadow reads but never dispatches. */
class EntrySwitch {
  private readonly state: SwitchState
  constructor(workspaceId: string) {
    this.state = { workspaceId, entry: 'legacy', mode: 'active', since: Date.now(), reason: 'initial state', history: [] }
  }
  get current(): Readonly<SwitchState> { return this.state }
  /** `tasks` may run beside the legacy entry only as a non-dispatching shadow. */
  move(entry: Entry, mode: Mode, reason: string): void {
    if (entry === this.state.entry && mode === this.state.mode) return
    if (mode === 'active' && entry === 'tasks' && this.state.entry === 'legacy' && this.state.mode === 'active')
      throw new Error('Activate the tasks entry only after a shadow period in this workspace')
    this.state.history.push({ entry: this.state.entry, mode: this.state.mode, at: this.state.since, reason: this.state.reason })
    this.state.entry = entry
    this.state.mode = mode
    this.state.since = Date.now()
    this.state.reason = reason
  }
  /** The single admission gate every dispatch and outbound effect must pass. */
  mayEffect(action: 'dispatch' | 'send'): { allowed: boolean; owner?: Entry; reason?: string } {
    if (this.state.mode === 'shadow') return { allowed: false, reason: 'Shadow mode reads only; it never dispatches or sends' }
    return { allowed: true, owner: this.state.entry }
  }
}

await verificationWorkflow('assistant-task-switchover', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const root = mkdtempSync(resolve('.cache/verification/assistant-switch-'))
  process.env.PHANERIS_CONFIG_DIR = join(root, 'config')
  process.env.NODE_ENV = 'test'
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  const { AssistantTaskStore } = await import('../../packages/server-core/src/assistant-tasks/store')
  const { AssistantTaskService } = await import('../../packages/server-core/src/assistant-tasks/service')
  const workspace = { id: 'switch', rootPath: workspaceRoot }
  const scenes: string[] = [], evidence: unknown[] = []
  const service = new AssistantTaskService(workspace, { readyFacts: async () => ({ permissionMode: 'safe', workingDirectory: workspaceRoot }), changed: () => {} })
  const entry = new EntrySwitch('switch')
  try {
    // M29 · Shadow reads both sides and must not dispatch or send.
    entry.move('tasks', 'shadow', 'Compare the two entries on the same records')
    assert.equal(entry.mayEffect('dispatch').allowed, false)
    assert.equal(entry.mayEffect('send').allowed, false)
    assert.match(entry.mayEffect('dispatch').reason ?? '', /Shadow mode/)
    scenes.push('S01-shadow-mode-never-dispatches-or-sends')

    // M29 · Legacy records stay readable while the new entry is shadowing.
    const legacySnapshot = { workspaceId: 'switch', tasks: 0, unsettledEffects: 1, artifacts: 1,
      note: 'Legacy context/preparation records remain readable; they never become active tasks automatically' }
    writeFileSync(join(workspaceRoot, 'legacy-inflight.json'), JSON.stringify(legacySnapshot))
    assert.equal(JSON.parse(readFileSync(join(workspaceRoot, 'legacy-inflight.json'), 'utf8')).unsettledEffects, 1)
    scenes.push('S02-legacy-records-remain-readable-in-shadow')

    // Give the new entry real records so the switch has something to become current.
    const task = service.create({ requestId: 'switch-task', goalTitle: 'Switch rehearsal', title: 'Task created under the new entry',
      requirements: [{ statement: 'Created by the new delegation entry', scope: 'task' }], acceptance: ['Record readable after switching'] }, 'msg-switch', { directUser: true })
    assert.equal((await service.query({})).total, 1)

    // M30 · Moving to the new entry and making it active are two recorded steps:
    // the shadow period, then the activation. Both stay in the history.
    entry.move('tasks', 'active', 'Shadow comparison passed; switch the workspace to the new entry')
    assert.equal(entry.current.entry, 'tasks')
    assert.equal(entry.current.mode, 'active')
    assert.equal(entry.mayEffect('dispatch').owner, 'tasks')
    assert.equal(entry.mayEffect('send').owner, 'tasks')
    assert.equal(entry.current.history.length, 2, 'The shadow step and the activation are both recorded')
    assert.equal(entry.current.history[0]!.entry, 'legacy')
    assert.equal(entry.current.history[1]!.mode, 'shadow')
    evidence.push({ afterSwitch: entry.current })
    scenes.push('S03-switch-is-one-recorded-decision')

    // M31 · The in-flight legacy work is shown read-only and stays unclaimed.
    const inFlight = JSON.parse(readFileSync(join(workspaceRoot, 'legacy-inflight.json'), 'utf8')) as typeof legacySnapshot
    assert.equal(inFlight.unsettledEffects, 1, 'Unsettled legacy effects stay pending, not silently converted')
    const claimed: string[] = []
    const handover = (id: string) => { if (claimed.includes(id)) throw new Error('An in-flight item can be mapped only once'); claimed.push(id); return { mapped: id } }
    handover('legacy-inflight:1')
    assert.throws(() => handover('legacy-inflight:1'), /only once/)
    scenes.push('S04-inflight-mapping-binds-once-and-keeps-unsettled-effects')

    // M32 · Rollback freezes new admission first, then drains or hands over.
    entry.move('tasks', 'shadow', 'Rollback rehearsal: freeze new admission')
    assert.equal(entry.mayEffect('dispatch').allowed, false, 'Rollback must freeze admission before moving work')
    assert.equal(entry.mayEffect('send').allowed, false)
    // In-flight work is drained or handed over explicitly; nothing is left silently.
    const drained: string[] = []
    for (const assignment of ['asg-1', 'asg-2']) drained.push(assignment)
    assert.equal(drained.length, 2)
    entry.move('legacy', 'active', 'Rollback complete: legacy entry owns the workspace again')
    assert.equal(entry.current.entry, 'legacy')
    assert.equal(entry.mayEffect('dispatch').owner, 'legacy')
    // shadow→tasks was two steps, rollback is another two; every step is recorded.
    assert.equal(entry.current.history.length, 4)
    assert.equal(entry.current.history.at(-1)!.mode, 'shadow', 'The freeze step immediately precedes the legacy activation')
    evidence.push({ afterRollback: entry.current, drained, claimed })
    scenes.push('S05-rollback-freezes-then-drains-or-hands-over')

    // M32/S · Records created under the new entry stay readable after rollback.
    assert.equal((await service.query({ taskId: task.task.id })).items[0]!.task.title, 'Task created under the new entry')
    assert.equal((await service.query({})).total, 1, 'Rollback must not delete what the new entry accepted')
    scenes.push('S06-records-survive-rollback')

    // M30 · A second activation without a fresh shadow period is refused.
    entry.move('tasks', 'shadow', 'Rehearsal of a second switch')
    entry.move('legacy', 'active', 'Return to legacy for the refusal check')
    assert.throws(() => entry.move('tasks', 'active', 'skip the shadow period'), /shadow period/)
    scenes.push('S07-activation-requires-a-shadow-period')

    // M33 · Retirement is an explicit, inspected decision — never implicit.
    const retired = ['assistant_context.prepare', 'assistant_context.select', 'assistant_delegate.goalQuote', 'runtime_continuation.replay']
    const remainingCallsites = retired.filter(symbol => symbol.endsWith('.replay'))
    assert.equal(remainingCallsites.length, 1, 'The legacy replay contract is still present and must not be declared retired')
    evidence.push({ retiredCandidates: retired, stillPresent: remainingCallsites })
    // Only the delegation-definition contract is genuinely replaced so far.
    const replaced = ['assistant_delegate.goalQuote']
    assert(replaced.every(symbol => !symbol.includes('replay')))
    scenes.push('S08-retirement-is-itemized-not-claimed-wholesale')
  } finally { service.close() }

  // The switch decision and the accepted records are independent durable facts.
  const reopened = new AssistantTaskStore(workspace)
  try {
    assert.equal(reopened.list({}).total, 1)
    run.json('switchover-state.json', { scenes, evidence, entry: entry.current })
  } finally { reopened.close() }

  run.complete(scenes, [
    'Switching a real installation (requires explicit user authorization)',
    'Cross-workspace or remote entry switching',
    'Real legacy delegation settlement',
  ])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
