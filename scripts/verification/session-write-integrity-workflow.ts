import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { SessionPersistenceQueue } from '../../packages/shared/src/sessions/persistence-queue'
import { serializeSession } from '@phaneris/shared/sessions'
import { verificationWorkflow } from './verification-artifacts'

// Fixed before the temp-file change: independent owners must not publish a
// mixed or truncated transcript, even if a concurrent header edit is rejected.
// Include a serial control, eight large races and exclusion of retained temp
// evidence from portable exports; existing fault/retry scenarios remain intact.
await verificationWorkflow('session-write-integrity', async run => {
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const body = Buffer.from(JSON.stringify({ id: 'message', type: 'user', content: 'x'.repeat(16 * 1024 * 1024), timestamp: 1 }) + '\n')
  const expected = hash(body), checks: string[] = [], failures: unknown[] = [], observations: unknown[] = []
  for (let index = -1; index < 8; index++) {
    const root = join(run.directory, String(index)), session = join(root, 'sessions/race'); mkdirSync(session, { recursive: true })
    const file = join(session, 'session.jsonl')
    writeFileSync(file, Buffer.concat([Buffer.from(JSON.stringify({ id: 'race', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, messageCount: 1 }) + '\n'), body]))
    const a = new SessionPersistenceQueue(), b = new SessionPersistenceQueue()
    const first = a.patchHeader(root, 'race', { name: 'First title' }, () => {})
    const results = index < 0 ? [await first] : await Promise.allSettled([first, b.patchHeader(root, 'race', { workerPermissionMode: 'ask' }, () => {})])
    const bytes = readFileSync(file), actual = hash(bytes.subarray(bytes.indexOf(10) + 1))
    observations.push({ index, expected, actual, results: results.map(value => value && value.status === 'rejected' ? String(value.reason) : 'fulfilled') })
    const id = index < 0 ? 'serial-control-preserves-every-body-byte' : `independent-header-writers-${index}`
    try { assert.equal(actual, expected); JSON.parse(bytes.subarray(0, bytes.indexOf(10)).toString()); checks.push(id) }
    catch (error) { failures.push({ id, error: String(error) }) }
    if (index === -1) {
      mkdirSync(join(session, 'tmp'), { recursive: true }); writeFileSync(join(session, 'tmp/retained-failed-product.jsonl'), 'Private uncommitted fixture bytes')
      const exported = serializeSession(root, 'race'); assert(exported)
      assert(!exported.files.some(file => file.relativePath.startsWith('tmp/'))); checks.push('retained-transaction-files-never-enter-portable-exports')
    }
  }
  run.json('scenarios.json', { checks, failures, observations }); assert.equal(failures.length, 0, JSON.stringify(failures))
  run.complete(checks, ['Independent real persistence queues with 16 MiB encoded rows on Windows.', 'Does not claim a distributed multi-Host metadata transaction or native POSIX durability.'])
})
