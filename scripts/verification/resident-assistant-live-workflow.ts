import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveDeepSeek } from './live-deepseek'
import { verificationWorkflow } from './verification-artifacts'

// Explicit, bounded live sample. Only synthetic workspace content crosses the
// provider boundary; OS credentials stay in this read-only parent process.
await verificationWorkflow('resident-assistant-live', async run => {
  const live = await liveDeepSeek(run.directory)
  const requests: unknown[] = []
  const release = Promise.withResolvers<void>()
  let allowWorker = false
  const proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
    if (new URL(request.url).pathname === '/release-worker') { allowWorker = true; release.resolve(); return Response.json({ released: true }) }
    const body = await request.json() as { model: string; messages: Array<{ role: string; content?: unknown }> }
    requests.push(body)
    if (JSON.stringify(body).includes('resident_assistant_role')) return live.request(body, 'assistant-062-synthetic-sample', 1500)
    if (!allowWorker) await Promise.race([release.promise, new Promise<void>(resolve => {
      if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true })
    })])
    if (request.signal.aborted) return new Response(null, { status: 499 })
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'live-worker-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    return new Response(chunk({ role: 'assistant', content: 'LIVE_WORKER_FINISHED_ONCE' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  try {
    const child = Bun.spawn([process.execPath, 'run', 'scripts/verification/fixtures/resident-assistant-live.ts', run.directory, proxy.url.href, live.connection.model],
      { stdout: 'pipe', stderr: 'pipe' })
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'host.log'), out + err)
    assert.equal(exit, 0, (out + err).slice(-6000))
    const evidence = JSON.parse(readFileSync(join(run.directory, 'live-evidence.json'), 'utf8')) as { scenes: string[] }
    run.json('provider-identity.json', { ...live.connection, pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing/', scope: 'Synthetic originals and main-assistant control decisions; Worker inference uses a held loopback fixture' })
    run.complete(evidence.scenes, ['Generalization across models', 'Real personal data', 'Worker model output quality', 'Signed installer distribution'])
  } finally { release.resolve(); proxy.stop(true); run.json('provider-requests.json', requests) }
})
