import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TaskRunner, type ConductorSessionHost } from '../../packages/server-core/src/tasks/TaskRunner'
import { parseTaskSpec, saveTaskSpec, appendRunLog, readRunLog, type TaskSpec } from '../../packages/shared/src/tasks'
import type { CreateSessionOptions } from '../../packages/shared/src/protocol'
import type { SessionCompletionEvent } from '../../packages/server-core/src/domain/session-completion'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('task-permission', async run => {
  const records: Array<{ id: string; pass: boolean; error?: string }> = []
  const parse = (raw: unknown): TaskSpec => { const result = parseTaskSpec(raw); assert(result.success); return result.data }
  const tick = () => new Promise(resolve => setTimeout(resolve, 10))
  const scenes = async (id: string, execute: () => Promise<void>) => {
    try { await execute(); records.push({ id, pass: true }) }
    catch (error) { records.push({ id, pass: false, error: String(error) }) }
  }
  function fixture(id: string) {
    const workspace = join(run.directory, 'fixtures', id)
    mkdirSync(workspace, { recursive: true })
    const created: CreateSessionOptions[] = []
    const listeners = new Set<(event: SessionCompletionEvent) => void>()
    const host: ConductorSessionHost = {
      async createSession(_workspace, options) {
        created.push(options)
        writeFileSync(join(workspace, `created-${options.name}.json`), JSON.stringify(options))
        return { id: `session-${options.name}` }
      },
      async sendMessage() {}, async setSessionStatus() {}, async setKanbanColumn() {},
      async setTaskNodeCount() {}, async cancelProcessing() {},
      onSessionComplete(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      getSessionFinalText() { return undefined }, getSessionWorkingDirectory() { return workspace },
    }
    const runner = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: workspace })
    return { workspace, created, runner, complete(node: string) {
      for (const listener of [...listeners]) listener({ workspaceId: 'fixture', sessionId: `session-${node}`, reason: 'complete', finalText: 'done' })
    } }
  }
  await scenes('R01-omitted-refuses-before-dispatch', async () => {
    const f = fixture('omitted')
    saveTaskSpec(f.workspace, parse({ id: 'task', title: 'Task', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }))
    try { assert.throws(() => f.runner.run('task', { runId: 'run' }), /permissionMode/); assert.equal(f.created.length, 0); assert.equal(readRunLog(f.workspace, 'task', 'run').length, 0) }
    finally { await f.runner.stop('task', 'run') }
  })
  await scenes('R01-partial-refuses-entire-task', async () => {
    const f = fixture('partial')
    saveTaskSpec(f.workspace, parse({ id: 'task', title: 'Task', goal: 'g', nodes: [{ id: 'a', prompt: 'a', permissionMode: 'safe' }, { id: 'b', prompt: 'b' }] }))
    try { assert.throws(() => f.runner.run('task', { runId: 'run' }), /b.*permissionMode|permissionMode.*b/); await tick(); assert.equal(f.created.length, 0) }
    finally { await f.runner.stop('task', 'run') }
  })
  for (const mode of ['safe', 'ask', 'guarded', 'allow-all'] as const) await scenes(`R01-explicit-${mode}`, async () => {
    const f = fixture(mode)
    saveTaskSpec(f.workspace, parse({ id: 'task', title: 'Task', goal: 'g', defaults: { permissionMode: mode }, nodes: [{ id: 'a', prompt: 'a' }] }))
    try {
      f.runner.run('task', { runId: 'run', verifyOnComplete: false }); await tick()
      assert.equal(f.created[0]?.permissionMode, mode)
      assert(existsSync(join(f.workspace, 'created-a.json')))
      f.complete('a'); await tick(); assert.equal(f.runner.getRunState('task', 'run')?.status, 'completed')
    } finally { await f.runner.stop('task', 'run') }
  })
  await scenes('R01-node-overrides-default', async () => {
    const f = fixture('override')
    saveTaskSpec(f.workspace, parse({ id: 'task', title: 'Task', goal: 'g', defaults: { permissionMode: 'allow-all' }, nodes: [{ id: 'a', prompt: 'a', permissionMode: 'safe', file_scope: { read: ['.'], write: [] } }, { id: 'b', prompt: 'b', file_scope: { read: ['.'], write: [] } }] }))
    try {
      f.runner.run('task', { runId: 'run', verifyOnComplete: false }); await tick()
      assert.equal(f.created.find(option => option.name === 'a')?.permissionMode, 'safe')
      assert.equal(f.created.find(option => option.name === 'b')?.permissionMode, 'allow-all')
    } finally { await f.runner.stop('task', 'run') }
  })
  await scenes('R01-every-node-can-declare-without-default', async () => {
    const f = fixture('nodes')
    saveTaskSpec(f.workspace, parse({ id: 'task', title: 'Task', goal: 'g', nodes: [{ id: 'a', prompt: 'a', permissionMode: 'safe' }] }))
    try { f.runner.run('task', { runId: 'run', verifyOnComplete: false }); await tick(); assert.equal(f.created[0]?.permissionMode, 'safe') }
    finally { await f.runner.stop('task', 'run') }
  })
  await scenes('R01-legacy-resume-refuses-without-rewrite', async () => {
    const f = fixture('resume')
    const spec = parse({ id: 'task', title: 'Task', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] })
    saveTaskSpec(f.workspace, spec)
    appendRunLog(f.workspace, 'task', 'run', { kind: 'run-started', taskId: 'task', runId: 'run', t: new Date().toISOString() })
    assert.throws(() => f.runner.resume('task', 'run'), /permissionMode/)
    assert.equal(f.created.length, 0)
    assert.equal(readRunLog(f.workspace, 'task', 'run').length, 1)
    assert.equal(spec.defaults, undefined)
  })
  run.json('scenes.json', records)
  const passed = records.filter(record => record.pass).map(record => record.id)
  if (passed.length) run.complete(passed, ['Actual provider/native policy checks are covered by the separate managed Pi capability workflows', 'Signing, physical devices and other operating systems'])
  assert(records.every(record => record.pass), JSON.stringify(records.filter(record => !record.pass)))
})
