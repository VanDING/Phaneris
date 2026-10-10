/** B0: real production settlement/SQLite and task evidence seams; no provider requests. */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { Database } from 'bun:sqlite'

const root = resolve(import.meta.dir, '../..')
const sourceRoot = resolve(process.argv.find(arg => arg.startsWith('--repository='))?.slice(13) ?? root)
const baselineSha = 'dbd32f60b5d90e20b1bc2b231035baf6b171ddc2'
if (!existsSync(join(sourceRoot, 'packages/server-core/src/durable-runtime/task-node-reconciliation.ts'))) {
  throw new Error(`This is a historical baseline runner. Supply --repository=<export of ${baselineSha}>; use the acceptance workflows for the current implementation.`)
}
const sourceManifest = execFileSync('git', ['ls-tree', '-r', '--format=%(objectname) %(path)', baselineSha], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(line => / packages\/(server-core|shared|core)\/src\//.test(line)).map(line => {
    const [objectId, path] = line.split(' '), bytes = readFileSync(join(sourceRoot, path!))
    const actual = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
    assert.equal(actual, objectId, `Baseline source differs from frozen Git blob: ${path}`)
    return { path, gitBlob: objectId, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? join(root, 'docs/verification/results/durable-runtime-boundary/baseline.json'))
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-runtime-boundary-baseline-'))
process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
process.env.NODE_ENV = 'test'
mkdirSync(process.env.PHANERIS_CONFIG_DIR, { recursive: true })
const workspace = { id: 'baseline', name: 'Baseline', rootPath: join(fixture, 'workspace'), createdAt: Date.now() }
mkdirSync(workspace.rootPath, { recursive: true })
writeFileSync(join(process.env.PHANERIS_CONFIG_DIR, 'config.json'), JSON.stringify({ workspaces: [workspace], llmConnections: [], decisionLayer: { enabled: false } }))
const { SessionManager, createManagedSession } = await import(pathToFileURL(join(sourceRoot, 'packages/server-core/src/sessions/SessionManager.ts')).href)
const { createSession, saveSession } = await import(pathToFileURL(join(sourceRoot, 'packages/shared/src/sessions/storage.ts')).href)
const { createTaskNodeReconciliationAdapter } = await import(pathToFileURL(join(sourceRoot, 'packages/server-core/src/durable-runtime/task-node-reconciliation.ts')).href)
const manager = new SessionManager()
// Inspect production seams; only browser/provider transport is absent in this baseline.
const seam = manager as any
const observed: unknown[] = []
manager.onSessionComplete(event => observed.push(event))
const stored = await createSession(workspace.rootPath, { name: 'Settlement evidence' })
const session = createManagedSession(stored, workspace, { messagesLoaded: true })
seam.sessions.set(session.id, session)
session.isProcessing = true
session.messages.push({ id: 'input', role: 'user', content: 'fixture', timestamp: 1 },
  { id: 'reply', role: 'assistant', content: 'fixture response', timestamp: 2 })
const runtime = seam.durableRuntime
runtime.acceptRun({ workspaceRootPath: workspace.rootPath, sessionId: session.id, turnId: 'input', operationId: 'baseline-run', userMessageId: 'input', userMessage: 'fixture' })
session.activeDurableRunOperationId = 'baseline-run'
await runtime.prepareTool(workspace.rootPath, { sessionId: session.id, turnId: 'input', runOperationId: 'baseline-run', providerToolCallId: 'effect', toolName: 'Write', args: { path: 'fixture.txt' } })
await seam.onProcessingStopped(session.id, 'complete')
const parked = runtime.storeFor(workspace.rootPath).getOperation('baseline-run')
assert.equal(parked.phase, 'recovery_parked')
const emptyRegistry = createTaskNodeReconciliationAdapter(() => [], async () => {})
const missingChild = await emptyRegistry.queryExternal({ operationId: 'dispatch', idempotencyKey: 'dispatch', args: { taskSlug: 'fixture', runId: 'run', nodeId: 'node' } })
// F07: real transaction failure with a queued next input; suppress provider work only.
const failedStored = await createSession(workspace.rootPath, { name: 'Failed settlement' })
const failedSession = createManagedSession(failedStored, workspace, { messagesLoaded: true })
seam.sessions.set(failedSession.id, failedSession)
failedSession.isProcessing = true
failedSession.activeDurableRunOperationId = 'failed-baseline'
runtime.acceptRun({ workspaceRootPath: workspace.rootPath, sessionId: failedSession.id, turnId: 'failure-input', operationId: 'failed-baseline', userMessageId: 'failure-input', userMessage: 'fixture' })
failedSession.messageQueue.push({ messageId: 'queued', message: 'next turn' })
const sql = new Database(join(workspace.rootPath, 'runtime/runtime.db'))
sql.exec("CREATE TRIGGER fail_terminal BEFORE INSERT ON runtime_events WHEN NEW.event_type='operation_terminal' BEGIN SELECT RAISE(ABORT, 'baseline failure'); END")
let queueAdvanced = 0
seam.processNextQueuedMessage = () => { queueAdvanced++ }
await seam.onProcessingStopped(failedSession.id, 'complete')
sql.exec('DROP TRIGGER fail_terminal'); sql.close()
const failedSettlement = { activeRunOperationId: failedSession.activeDurableRunOperationId, queueAdvanced }
// F09: restore a compatibility queued input whose delivery receipt is explicitly unknown.
const queuedStored = await createSession(workspace.rootPath, { name: 'Ambiguous delivery' })
await saveSession({ ...queuedStored, messages: [{ id: 'unknown-input', type: 'user', content: 'do not repeat implicitly', timestamp: 1,
  isQueued: true, inputReception: { disposition: 'unknown' } }] })
const recoveredSession = createManagedSession(queuedStored, workspace, { messagesLoaded: false })
seam.sessions.set(recoveredSession.id, recoveredSession)
await seam.ensureMessagesLoaded(recoveredSession)
const ambiguousRecovery = { queuedInputIds: recoveredSession.messageQueue.map((item: any) => item.messageId) }
const events = runtime.storeFor(workspace.rootPath).listAllEvents({ sessionId: session.id })
await manager.flushAllSessions()
runtime.backupDatabase(workspace.rootPath, join(fixture, 'runtime.db'))
await manager.cleanup()
mkdirSync(dirname(output), { recursive: true })
const database = join(dirname(output), 'baseline-reproduced.db')
writeFileSync(database, readFileSync(join(fixture, 'runtime.db')))
const data = { schemaVersion: 2, generatedAt: new Date().toISOString(), baselineSha, sourceRoot, sourceManifest,
  sourceFingerprint: createHash('sha256').update(JSON.stringify(sourceManifest)).digest('hex'),
  dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
  command: `bun run scripts/verification/durable-runtime-boundary-baseline.ts --repository=${sourceRoot}`, fixture, runtime: { bun: Bun.version, executable: process.execPath, platform: process.platform },
  scope: 'Production SessionManager stop/completion and task reconciliation paths, real SQLite; no model or external tool implementation invoked.',
  checks: [
    { id: 'F06', status: 'observed', parkedState: parked, completionEvents: observed, conforms: !(observed as Array<{ reason: string }>).some(event => event.reason === 'complete') },
    { id: 'F13', status: 'observed', emptyRegistryVerdict: missingChild, conforms: missingChild.decision !== 'definitely_not_executed' },
    { id: 'F07', status: 'observed', failedSettlement, conforms: queueAdvanced === 0 },
    { id: 'F09', status: 'observed', ambiguousRecovery, conforms: ambiguousRecovery.queuedInputIds.length === 0 },
  ], events, database: { path: database, sha256: createHash('sha256').update(readFileSync(database)).digest('hex') } }
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(data, null, 2) + '\n')
console.log(JSON.stringify({ output, checks: data.checks.map(({ id, conforms }) => ({ id, conforms })) }))
