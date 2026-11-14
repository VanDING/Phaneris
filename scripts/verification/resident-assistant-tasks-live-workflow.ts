import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveDeepSeek } from './live-deepseek'
import { verificationWorkflow } from './verification-artifacts'

// All inference is real, including every Worker. Synthetic originals only.
await verificationWorkflow('resident-assistant-tasks-live', async run => {
  const modes = process.env.PHANERIS_064_LIVE_MODES?.split(',') ?? ['parallel', 'revision', 'continuation']
  assert(modes.every(mode => ['parallel', 'revision', 'continuation'].includes(mode)))
  const scenes: string[] = []
  for (const mode of modes) {
    const output = join(run.directory, mode); mkdirSync(output)
    const configured = process.env.PHANERIS_064_LIVE_CONNECTION && process.env.PHANERIS_064_LIVE_MODEL
      ? { slug: process.env.PHANERIS_064_LIVE_CONNECTION, model: process.env.PHANERIS_064_LIVE_MODEL,
        limits: { maxRequests: mode === 'continuation' ? 28 : 20, maxInputBytes: mode === 'continuation' ? 3145728 : 2097152 } } : undefined
    const live = await liveDeepSeek(output, configured), requests: unknown[] = [], intervals: Array<{ main: boolean; entered: number; headers?: number; finished?: number }> = []
    const release = Promise.withResolvers<void>(), reached = Promise.withResolvers<void>()
    let workers = 0, released = false
    const proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/release') { released = true; release.resolve(); return Response.json({ released }) }
      if (path === '/started') { await reached.promise; return Response.json({ workers }) }
      const body = await request.json() as any, main = JSON.stringify(body.messages).includes('resident_assistant_role')
      requests.push(body)
      const interval = { main, entered: Date.now() } as typeof intervals[number]; intervals.push(interval)
      try {
        const response = await live.request(body, `tasks-064-${mode}-${main ? 'main' : 'worker'}`, 1600)
        interval.headers = Date.now()
        if (!main) { workers++; if (workers >= (mode === 'parallel' ? 2 : 1)) reached.resolve() }
        const reader = response.body!.getReader()
        return new Response(new ReadableStream({ async pull(controller) {
          if (!main && !released) await release.promise
          const next = await reader.read()
          if (next.done) { interval.finished = Date.now(); controller.close() } else controller.enqueue(next.value)
        }, cancel: reason => reader.cancel(reason) }), { status: response.status, headers: response.headers })
      } catch (error) { return Response.json({ error: { message: error instanceof Error ? error.message : 'Live verification failed' } }, { status: 422 }) }
    } })
    try {
      const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-tasks-live.ts', output, proxy.url.href, live.connection.model, mode], { stdout: 'pipe', stderr: 'pipe' })
      const timer = setTimeout(() => child.kill(), 240000)
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); clearTimeout(timer)
      writeFileSync(join(output, 'host.log'), out + err)
      assert.equal(exit, 0, (out + err).slice(-6500))
      const evidence = JSON.parse(readFileSync(join(output, 'live-evidence.json'), 'utf8')) as { scenes: string[] }
      if (mode === 'parallel') {
        const worker = intervals.filter(item => !item.main)
        assert(worker.some((a, index) => worker.slice(index + 1).some(b => a.entered < (b.finished ?? 0) && b.entered < (a.finished ?? 0))), 'Actual real-model Worker request intervals must overlap')
        const packets = requests.filter((request: any) => !JSON.stringify(request.messages).includes('resident_assistant_role')).map((request: any) => JSON.stringify(request.messages))
        assert(packets.some(text => text.includes('AQUA_6411')) && packets.some(text => text.includes('COPPER_6422')))
        assert(packets.every(text => !(text.includes('AQUA_6411') && text.includes('COPPER_6422'))), 'Real Worker request packets must preserve exact task isolation')
      }
      scenes.push(...evidence.scenes)
    } finally {
      release.resolve(); proxy.stop(true)
      run.json(`${mode}/provider-requests.json`, requests); run.json(`${mode}/provider-intervals.json`, intervals)
      run.json(`${mode}/provider-identity.json`, { ...live.connection, scope: 'Real main and real Workers; synthetic workspace; no fixture inference', maxRequests: live.ledger.maxRequests, estimatedBudgetUsd: live.ledger.estimatedBudgetUsd })
    }
  }
  run.complete(scenes, ['Other model families', 'Real personal data', 'Signed installer distribution', 'Pinned Bun 1.4.4 (host is Bun 1.4.3)'])
})
