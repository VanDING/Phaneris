import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { startProcess, testSecret, deadline, type RunningProcess } from './fixtures/governance-process-support'
import { CliRpcClient } from '../../apps/cli/src/client'
import { RPC_CHANNELS as c, type TaskCreateResult, type Session } from '../../packages/shared/src/protocol'

// Failure matrix fixed before recovery implementation: crash after a fresh
// Session / after planning, lost ack retry, concurrent identical requests,
// different slugs for one target, disk replacement failure, and an external
// spec edit while publication is awaiting Session creation.
await verificationWorkflow('task-publication-recovery', async run => {
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = [], observations: unknown[] = []
  const children: Array<{ process: RunningProcess; client: CliRpcClient; label: string }> = []
  const spec = (id: string, title = id) => ({ id, title, goal: 'No execution', nodes: [{ id: 'main', prompt: 'No execution' }] })
  async function start(config: string, label: string, fault = '', slug = '') {
    const child = await startProcess({ config, entry: join(import.meta.dir, 'fixtures/task-publication-server.ts'),
      extra: { PHANERIS_PUBLICATION_FAULT: fault, PHANERIS_PUBLICATION_SLUG: slug } })
    const client = new CliRpcClient(child.url, { token: testSecret, workspaceId: 'publication' }); await client.connect()
    const entry = { process: child, client, label }; children.push(entry); return entry
  }
  const facts = (child: Awaited<ReturnType<typeof start>>) => child.client.invoke('publication:facts') as Promise<{ sessions: Session[]; specs: { id: string; title: string }[] }>
  const publish = (child: Awaited<ReturnType<typeof start>>, slug: string, extra: object = {}) => child.client.invoke(c.tasks.CREATE, 'publication', { yaml: JSON.stringify(spec(slug)), ...extra }) as Promise<TaskCreateResult>
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) }
  }
  try {
    for (const fault of ['created', 'planned'] as const) await scene(`${fault}-crash-recovers-before-retry-with-one-identity`, async () => {
      const config = join(run.directory, fault), slug = `crash-${fault}`, first = await start(config, `${fault}-first`, fault, slug)
      const input = { planning: { progress: 25, statusId: 'done', dueAt: '2026-11-20' } }
      await assert.rejects(publish(first, slug, input)); await deadline(first.process.exited)
      const restarted = await start(config, `${fault}-restart`), before = await facts(restarted)
      const cards = before.sessions.filter(session => session.taskSlug === slug)
      assert.equal(cards.length, 1); assert.equal(cards[0]?.progress, 25); assert.equal(cards[0]?.sessionStatus, 'done')
      const retried = await publish(restarted, slug, input), after = await facts(restarted)
      assert.equal(retried.orchestratorSessionId, cards[0]!.id)
      assert.equal(after.sessions.filter(session => session.taskSlug === slug).length, 1)
      observations.push({ fault, before, after, retried })
    })
    await scene('parallel-identical-legacy-publications-share-one-card', async () => {
      const child = await start(join(run.directory, 'parallel'), 'parallel')
      const [a, b] = await Promise.all([publish(child, 'same-slug'), publish(child, 'same-slug')])
      assert.equal(a.orchestratorSessionId, b.orchestratorSessionId)
      assert.equal((await facts(child)).sessions.filter(session => session.taskSlug === 'same-slug').length, 1)
    })
    await scene('different-slugs-cannot-capture-one-target', async () => {
      const child = await start(join(run.directory, 'target'), 'target')
      const initial = await publish(child, 'original')
      const results = await Promise.allSettled(['replacement-a', 'replacement-b'].map(slug => publish(child, slug, { attachToExistingSession: initial.orchestratorSessionId })))
      assert(results.every(result => result.status === 'rejected'))
      assert.deepEqual((await facts(child)).specs.map(value => value.id), ['original'])
    })
    await scene('completed-retry-preserves-a-later-user-title', async () => {
      const child = await start(join(run.directory, 'completed'), 'completed')
      const first = await publish(child, 'completed')
      await child.client.invoke('publication:rename', first.orchestratorSessionId, 'Later user title')
      const retry = await publish(child, 'completed')
      assert.equal(retry.orchestratorSessionId, first.orchestratorSessionId)
      assert.equal((await facts(child)).sessions.find(session => session.id === first.orchestratorSessionId)?.name, 'Later user title')
    })
    await scene('external-spec-edit-is-retained-and-blocks-recovery-overwrite', async () => {
      const config = join(run.directory, 'external'), slug = 'external-edit', child = await start(config, 'external', 'hold-created', slug)
      const request = publish(child, slug); void request.catch(() => {})
      const until = Date.now() + 15_000
      while (!existsSync(join(config, 'fault-held'))) { assert(Date.now() < until, 'Creation did not reach the hold'); await Bun.sleep(20) }
      const file = join(config, 'workspace/tasks', slug, 'task.yaml'), edited = JSON.stringify(spec(slug, 'External user edit'))
      writeFileSync(file, edited); writeFileSync(join(config, 'fault-release'), 'release')
      await assert.rejects(request, /changed|conflict|publication/i)
      await assert.rejects(publish(child, slug), /changed|conflict|publication/i)
      assert.equal(readFileSync(file, 'utf8'), edited)
      assert.equal((await facts(child)).sessions.filter(session => session.taskSlug === slug).length, 1)
    })
    await scene('successful-receipt-includes-durable-source-selection', async () => {
      const config = join(run.directory, 'sources-receipt'), slug = 'sources-receipt', child = await start(config, 'sources-receipt-first', 'receipt', slug)
      await assert.rejects(publish(child, slug, { yaml: JSON.stringify({ ...spec(slug), sources: ['publication-source'] }) })); await deadline(child.process.exited)
      const restarted = await start(config, 'sources-receipt-restart')
      const card = (await facts(restarted)).sessions.find(session => session.taskSlug === slug)
      assert.deepEqual(card?.enabledSourceSlugs, ['publication-source'])
    })
    await scene('recovery-preserves-a-later-user-source-selection-with-warning', async () => {
      const config = join(run.directory, 'sources-operator'), slug = 'sources-operator', child = await start(config, 'sources-operator-first', 'planned', slug)
      const input = { yaml: JSON.stringify({ ...spec(slug), sources: ['publication-source'] }), planning: { progress: 1 } }
      await assert.rejects(publish(child, slug, input)); await deadline(child.process.exited)
      const directory = join(config, 'workspace/sessions')
      const file = readdirSync(directory).map(id => join(directory, id, 'session.jsonl')).find(file => existsSync(file))!
      const bytes = readFileSync(file), newline = bytes.indexOf(10), header = JSON.parse(bytes.subarray(0, newline).toString())
      writeFileSync(file, Buffer.concat([Buffer.from(JSON.stringify({ ...header, enabledSourceSlugs: ['operator-source'] }) + '\n'), bytes.subarray(newline + 1)]))
      const restarted = await start(config, 'sources-operator-restart'), retry = await publish(restarted, slug, input)
      const card = (await facts(restarted)).sessions.find(session => session.taskSlug === slug)
      assert.deepEqual(card?.enabledSourceSlugs, ['operator-source'])
      assert(retry.warnings?.some(warning => /source/i.test(warning)))
    })
    await scene('two-hosts-cannot-publish-through-one-held-workspace', async () => {
      const config = join(run.directory, 'two-hosts'), slug = 'two-hosts'
      const first = await start(config, 'two-hosts-first', 'hold-created', slug)
      const request = publish(first, slug); void request.catch(() => {})
      const until = Date.now() + 15_000
      while (!existsSync(join(config, 'fault-held'))) { assert(Date.now() < until, 'First Host did not hold publication'); await Bun.sleep(20) }
      const second = await start(config, 'two-hosts-second')
      try { await assert.rejects(publish(second, slug), /locked|busy|publication/i) }
      finally { writeFileSync(join(config, 'fault-release'), 'release') }
      const completed = await request, retry = await publish(second, slug)
      assert.equal(retry.orchestratorSessionId, completed.orchestratorSessionId)
      assert.equal((await facts(second)).sessions.filter(session => session.taskSlug === slug).length, 1)
    })
    await scene('spec-replacement-failure-has-no-card-and-can-retry', async () => {
      const config = join(run.directory, 'write-failure'), child = await start(config, 'write-failure'), slug = 'write-failure'
      const folder = join(config, 'workspace/tasks', slug), file = join(folder, 'task.yaml'); mkdirSync(file, { recursive: true })
      await assert.rejects(publish(child, slug))
      // Remove only the empty, fixture-created obstruction inside this run.
      rmdirSync(file)
      assert.equal((await facts(child)).sessions.filter(session => session.taskSlug === slug).length, 0)
      const retry = await publish(child, slug); assert(retry.orchestratorSessionId)
      assert.equal((await facts(child)).sessions.filter(session => session.taskSlug === slug).length, 1)
    })
    run.json('scenarios.json', { checks, failures, observations }); assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Local subprocess restart and real authenticated WS/JSONL on Windows; no native macOS/Linux power-loss simulation.'])
  } finally {
    for (const child of children) {
      child.client.destroy(); await child.process.stop()
      writeFileSync(join(run.directory, child.label + '.log'), child.process.stdout() + child.process.stderr())
    }
  }
})
