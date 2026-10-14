import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { TaskRunner, type ConductorSessionHost } from '../../packages/server-core/src/tasks/TaskRunner'
import { parseTaskSpec, saveTaskSpec } from '../../packages/shared/src/tasks'
import type { SessionCompletionEvent } from '../../packages/server-core/src/domain/session-completion'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('task-file-scope', async run => {
  const checks: string[] = [], tick = () => new Promise(resolve => setTimeout(resolve, 15))
  const scope = (write: string[], read: string[] = []) => ({ write, read })
  async function scene(id: string, left: unknown, right: unknown, expected: number, alias = false) {
    const workspace = join(run.directory, id); mkdirSync(join(workspace, 'real'), { recursive: true })
    if (alias) symlinkSync(join(workspace, 'real'), join(workspace, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    const listeners = new Set<(event: SessionCompletionEvent) => void>(), created: string[] = []
    const host: ConductorSessionHost = {
      async createSession(_ws, options) { created.push(options.name!); return { id: options.name! } }, async sendMessage() {}, async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
      getSessionWorkingDirectory() { return workspace }, getSessionFinalText() { return 'done' }, onSessionComplete(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    }
    const spec = parseTaskSpec({ id: 'task', title: 'Scope', goal: 'Scope', cwd: workspace, defaults: { permissionMode: 'safe' }, nodes: [{ id: 'a', prompt: 'A', file_scope: left }, { id: 'b', prompt: 'B', file_scope: right }] }); assert(spec.success)
    saveTaskSpec(workspace, spec.data); const runner = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: workspace })
    try {
      runner.run('task', { runId: 'run', verifyOnComplete: false }); await tick(); assert.equal(created.length, expected, id)
      for (const listener of [...listeners]) listener({ workspaceId: 'fixture', sessionId: 'a', reason: 'complete', finalText: 'done' })
      await tick(); assert.equal(created.length, 2, 'A completed lease must release B')
      for (const listener of [...listeners]) listener({ workspaceId: 'fixture', sessionId: 'b', reason: 'complete', finalText: 'done' })
      checks.push(id)
    } finally { await runner.stop('task', 'run') }
  }
  await scene('undeclared-serializes', undefined, undefined, 1)
  await scene('same-path-serializes', scope(['same.txt']), scope(['same.txt']), 1)
  await scene('ancestor-path-serializes', scope(['real']), scope(['real/new/file.txt']), 1)
  await scene('read-write-serializes', scope(['real']), scope([], ['real/file']), 1)
  await scene('case-alias-serializes', scope(['real/FILE.txt']), scope(['real/file.txt']), process.platform === 'win32' ? 1 : 2)
  await scene('junction-alias-serializes', scope(['real/new/file']), scope(['alias/new/file']), 1, true)
  await scene('readers-parallel', scope([], ['.']), scope([], ['.']), 2)
  await scene('disjoint-writes-parallel', scope(['a.txt']), scope(['b.txt']), 2)
  for (const outcome of ['failed', 'cancelled'] as const) {
    const ws = join(run.directory, `cross-run-${outcome}`); mkdirSync(ws)
    const callbacks = new Set<(event: SessionCompletionEvent) => void>(), created: string[] = []
    const host: ConductorSessionHost = { async createSession(_id, options) { created.push(options.name!); return { id: options.name! } }, async sendMessage() {}, async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {}, getSessionWorkingDirectory() { return ws }, getSessionFinalText() { return 'done' }, onSessionComplete(fn) { callbacks.add(fn); return () => callbacks.delete(fn) } }
    for (const id of ['one', 'two']) { const spec = parseTaskSpec({ id, title: id, goal: id, cwd: ws, defaults: { permissionMode: 'safe' }, nodes: [{ id, prompt: id }] }); assert(spec.success); saveTaskSpec(ws, spec.data) }
    const one = new TaskRunner({ host, workspaceRoot: ws, workspaceId: 'fixture' }), two = new TaskRunner({ host, workspaceRoot: ws, workspaceId: 'fixture' })
    try {
      one.run('one', { runId: 'one', verifyOnComplete: false }); two.run('two', { runId: 'two', verifyOnComplete: false }); await tick(); assert.deepEqual(created, ['one'])
      if (outcome === 'cancelled') await one.stop('one', 'one')
      else for (const cb of [...callbacks]) cb({ workspaceId: 'fixture', sessionId: 'one', reason: 'error', finalText: '' })
      await tick(); assert.deepEqual(created, ['one', 'two']); checks.push(`cross-run-${outcome}-releases`)
    } finally { await one.stop('one', 'one'); await two.stop('two', 'two') }
  }
  const workspace = join(run.directory, 'resume'); mkdirSync(workspace)
  const listeners = new Set<(event: SessionCompletionEvent) => void>(), created: string[] = []
  const host: ConductorSessionHost = { async createSession(_ws, options) { created.push(options.name!); return { id: options.name! } }, async sendMessage() {}, async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {}, getSessionWorkingDirectory() { return workspace }, getSessionFinalText() { return 'done' }, onSessionComplete(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const parsed = parseTaskSpec({ id: 'task', title: 'Freeze', goal: 'Freeze', cwd: workspace, max_parallel: 1, defaults: { permissionMode: 'safe' }, nodes: [{ id: 'a', prompt: 'A', file_scope: scope(['a']) }, { id: 'b', prompt: 'B', file_scope: scope(['b']) }] }); assert(parsed.success)
  saveTaskSpec(workspace, parsed.data)
  const first = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: workspace }), second = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: workspace })
  try {
    first.run('task', { runId: 'run', verifyOnComplete: false }); await tick(); first.pause('task', 'run')
    for (const listener of [...listeners]) listener({ workspaceId: 'fixture', sessionId: 'a', reason: 'complete', finalText: 'done' }); await tick()
    parsed.data.nodes[1]!.file_scope = scope(['different']); saveTaskSpec(workspace, parsed.data)
    assert.throws(() => second.resume('task', 'run'), /scope|declaration|cwd/i); assert.deepEqual(created, ['a']); checks.push('restart-cannot-change-declarations')
  } finally { await first.stop('task', 'run'); await second.stop('task', 'run') }
  run.json('task-file-scope.json', { checks }); run.complete(checks, ['Scope declarations coordinate TaskRunner nodes; they are not an OS sandbox and cannot constrain an agent that violates its declaration.'])
})
