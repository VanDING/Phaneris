import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveDeepSeek } from './live-deepseek'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-work-continuity-live', async run => {
  const live = await liveDeepSeek(run.directory, { slug: process.env.PHANERIS_CONTINUITY_LIVE_CONNECTION ?? 'pi-api-key-3',
    model: process.env.PHANERIS_CONTINUITY_LIVE_MODEL ?? 'deepseek/deepseek-v4.1-flash', limits: { maxRequests: 48, maxInputBytes: 4 * 1024 * 1024 } })
  const requests: unknown[] = []
  const inFlight = new Set<Promise<Response>>()
  const proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, fetch(request) {
    const pending = (async () => {
      const body = await request.json()
      requests.push(body)
      writeFileSync(join(run.directory, 'provider-requests.json'), JSON.stringify(requests, null, 2))
      const response = await live.request(body, 'resident-continuity-synthetic-real-inference', 1600)
      // Complete provider accounting before returning the SSE payload. Native
      // Pi still consumes the real events; this is not a streaming latency test.
      return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers })
    })()
    inFlight.add(pending)
    void pending.finally(() => inFlight.delete(pending)).catch(() => {})
    return pending
  } })
  try {
    const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-work-continuity-live.ts', run.directory, proxy.url.href, live.connection.model],
      { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 600000)
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(timer); writeFileSync(join(run.directory, 'host.log'), out + err)
    assert.equal(code, 0, (out + err).slice(-6500))
    const result = JSON.parse(readFileSync(join(run.directory, 'live-evidence.json'), 'utf8')) as { scenes: string[] }
    run.complete(result.scenes, ['Production assistant recovery', 'Signed installer and production migration'])
  } finally { proxy.stop(true); await Promise.allSettled([...inFlight]) }
})
