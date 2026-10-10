#!/usr/bin/env bun
/** F02/F03/F04: actual process termination at committed protocol barriers. No session application. */
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { createDurableRuntime, type RuntimeDriver } from '../../packages/server-core/src/durable-runtime'
import { runtimeBoundaryEvidence } from './runtime-boundary-evidence'

const [mode, workspace, phase] = process.argv.slice(2)
const sessionId = 'crash-session', runId = 'crash-run'
if (mode === '--execute') {
  const runtime = createDurableRuntime()
  const handle = runtime.execution.begin({ sessionId, workspaceRootPath: workspace! })
  runtime.execution.accept(handle, { operationId: runId, userMessageId: 'crash-input', userMessage: 'one external effect' })
  const model = phase!.startsWith('model'), point = phase!.replace(/^(tool|model)-/, '')
  if (point === 't1-failure') {
    const sql = new Database(join(workspace!, 'runtime/runtime.db'))
    sql.exec("CREATE TRIGGER fail_t1 BEFORE INSERT ON runtime_events WHEN NEW.event_type IN ('tool_dispatch_committed', 'model_dispatch_committed') BEGIN SELECT RAISE(ABORT, 'injected T1 failure'); END")
    sql.close()
  }
  const driver: RuntimeDriver = {
    async *run() {
      const identity = { sessionId, turnId: 'crash-input', runOperationId: runId }
      try {
        if (model) {
          const request = { ...identity, providerRequestId: 'request-1', provider: 'loopback', model: 'fixture', canonicalRequestHash: 'fixture-request' }
          const prepared = await runtime.effects.prepareModel(workspace!, request)
          if (point !== 'after-t1') {
            appendFileSync(join(workspace!, 'effect-marker.txt'), `${prepared.operationId}\n`, { flush: true })
            if (point === 'after-t2') await runtime.effects.commitModelOutcome(workspace!, { ...request,
              operationId: prepared.operationId, stopReason: 'stop', content: [{ type: 'text', text: 'committed answer' }], text: 'committed answer',
              usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.1 } })
          }
        } else {
          const request = { ...identity, providerToolCallId: 'call-1', toolName: 'external_write', args: { path: 'marker.txt' } }
          const prepared = await runtime.effects.prepareTool(workspace!, request)
          if (point !== 'after-t1') {
            appendFileSync(join(workspace!, 'effect-marker.txt'), `${prepared.operationId}\n`, { flush: true })
            if (point === 'after-t2') await runtime.effects.commitToolOutcome(workspace!, { ...request,
              operationId: prepared.operationId, canonicalArgsHash: prepared.canonicalArgsHash, result: { receipt: 'accepted' }, isError: false })
          }
        }
      } catch (error) { if (point !== 't1-failure') throw error }
      process.stdout.write(JSON.stringify({ barrier: phase, pid: process.pid }) + '\n')
      // The parent kills this process before Host completion/notification.
      setInterval(() => {}, 60_000)
      await new Promise<void>(() => {})
      yield { type: 'complete' }
    }, stop() {}, dispose() {},
  }
  runtime.execution.installDriver(sessionId, driver)
  await runtime.execution.drive(handle, driver, {})
} else if (mode === '--recover') {
  const runtime = createDurableRuntime()
  const report = runtime.admin.recoverWorkspace(workspace!)
  const result = { report, events: runtime.queries.events(workspace!, { sessionId }), operations: runtime.queries.operations(workspace!), usage: runtime.queries.usage(workspace!) }
  await runtime.close()
  console.log(JSON.stringify(result))
} else {
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-runtime-crash-'))
  const output = resolve(import.meta.dir, '../../docs/verification/results/durable-runtime-boundary')
  mkdirSync(output, { recursive: true })
  const cases: unknown[] = []
  for (const kind of ['tool', 'model']) for (const point of ['t1-failure', 'after-t1', 'after-effect', 'after-t2']) {
    const phase = `${kind}-${point}`, workspace = join(fixture, phase)
    mkdirSync(workspace, { recursive: true })
    const child = Bun.spawn([process.execPath, import.meta.path, '--execute', workspace, phase], { stdout: 'pipe', stderr: 'pipe' })
    const reader = child.stdout.getReader(), decoder = new TextDecoder()
    let barrier = ''
    const timeout = setTimeout(() => child.kill(), 20_000)
    try {
      while (!barrier.includes('\n')) { const next = await reader.read(); if (next.done) break; barrier += decoder.decode(next.value) }
      assert.equal(JSON.parse(barrier).barrier, phase, 'Crash barrier must be acknowledged before killing')
      child.kill(9)
      const exitCode = await child.exited
      assert.notEqual(exitCode, 0, 'The execution process must actually be terminated')
      const recoveryResults = []
      for (let repeat = 0; repeat < 2; repeat++) {
        const recovering = Bun.spawn([process.execPath, import.meta.path, '--recover', workspace], { stdout: 'pipe', stderr: 'pipe' })
        const text = await new Response(recovering.stdout).text(), errors = await new Response(recovering.stderr).text()
        assert.equal(await recovering.exited, 0, errors)
        recoveryResults.push(JSON.parse(text))
      }
      const markers = existsSync(join(workspace, 'effect-marker.txt')) ? readFileSync(join(workspace, 'effect-marker.txt'), 'utf8').trim().split('\n') : []
      assert.equal(markers.length, ['after-effect', 'after-t2'].includes(point) ? 1 : 0)
      const [first, second] = recoveryResults
      assert.deepEqual(second.events, first.events, 'Repeated restart must neither replay nor re-account')
      assert.deepEqual(second.usage, first.usage)
      if (['after-t1', 'after-effect'].includes(point)) assert.equal(first.operations[0]?.phase, 'recovery_parked')
      else { assert.equal(first.operations.length, 0); assert.ok(first.events.some((e: any) => e.type === 'operation_terminal')) }
      if (kind === 'model' && point === 'after-t2') assert.equal(first.usage.length, 1)
      const runtime = createDurableRuntime()
      const backup = runtime.admin.backupDatabase(workspace, join(workspace, 'snapshot.db'))
      const database = join(output, `crash-${phase}.db`)
      writeFileSync(database, readFileSync(backup)); await runtime.close()
      cases.push({ phase, barrier: JSON.parse(barrier), exitCode, externalCalls: markers.length, markers, recoveryResults,
        database: { path: database, sha256: createHash('sha256').update(readFileSync(database)).digest('hex') } })
    } finally { clearTimeout(timeout); child.kill(); reader.releaseLock() }
  }
  writeFileSync(join(output, 'crash.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(),
    ...runtimeBoundaryEvidence('bun run scripts/verification/durable-runtime-crash-workflow.ts', fixture), cases }, null, 2) + '\n')
  console.log(JSON.stringify({ passed: cases.length, output: join(output, 'crash.json') }))
}
