/** HE15–HE16 declared before changing preflight scheduling. Real file effects. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('harness-execution-readiness', async evidence => {
  const { ToolExecutionScheduler, toolExecutionResources } = await import('../../packages/pi-agent-server/src/tool-execution-scheduler')
  const root = join(evidence.directory, 'files'); mkdirSync(root)
  const a = join(root, 'a.txt'), b = join(root, 'b.txt')
  writeFileSync(a, 'old'); writeFileSync(b, 'independent')
  const scheduler = new ToolExecutionScheduler(), approval = Promise.withResolvers<void>()
  const log: string[] = []
  const write = scheduler.run(toolExecutionResources('write', { path: a }, root), undefined,
    async () => { writeFileSync(a, 'approved'); log.push('write') }, async () => { log.push('approval'); await approval.promise })
  const dependent = scheduler.run(toolExecutionResources('read', { path: a }, root), undefined,
    async () => { log.push('dependent'); return readFileSync(a, 'utf8') })
  const independent = scheduler.run(toolExecutionResources('read', { path: b }, root), undefined,
    async () => { log.push('independent'); return readFileSync(b, 'utf8') })
  assert.equal(await independent, 'independent')
  assert(log.includes('approval')); assert(!log.includes('write')); assert(!log.includes('dependent'))
  approval.resolve(); await write; assert.equal(await dependent, 'approved')
  const abort = new AbortController(), held = Promise.withResolvers<void>()
  let executed = false, preparedAfterStop = false
  const cancelled = scheduler.run(toolExecutionResources('write', { path: a }, root), abort.signal,
    async () => { executed = true }, async () => { preparedAfterStop = true; await held.promise })
  abort.abort(new Error('fixture stop'))
  await assert.rejects(cancelled, /fixture stop/)
  held.resolve(); await Bun.sleep(5); assert(!executed); assert(!preparedAfterStop)
  const { ResultBudget } = await import('../../packages/pi-agent-server/src/request-capacity')
  const results = new ResultBudget(['outer', 'writer'], 8000), nestedGate = Promise.withResolvers<void>()
  const outer = scheduler.run([], undefined, async () => {
    await nestedGate.promise
    await scheduler.run(toolExecutionResources('read', { path: b }, root), undefined, async () => readFileSync(b, 'utf8'))
    return results.project('outer', async () => ({ content: [{ type: 'text', text: 'outer complete' }] }))
  })
  const writer = scheduler.run(toolExecutionResources('write', { path: b }, root), undefined, async () => {
    writeFileSync(b, 'updated'); nestedGate.resolve(); await Bun.sleep(5)
    return results.project('writer', async () => ({ content: [{ type: 'text', text: 'writer complete' }] }))
  })
  const finished = await Promise.race([Promise.all([outer, writer]).then(() => true), Bun.sleep(300).then(() => false)])
  if (!finished) { results.finish('outer'); await Promise.all([outer, writer]) }
  assert(finished, 'Result projection must not deadlock nested tools behind another effect lock')
  const checks = ['HE15 independent reads proceed during approval while dependent effects retain order', 'HE16 stop during approval never starts an effect',
    'HE11 nested tool effects and result allocation cannot form a waiting cycle']
  evidence.json('execution-readiness.json', { checks, log, current: readFileSync(a, 'utf8'), executed })
  evidence.complete(checks, ['External service effects', 'Live model quality'])
  console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
})
