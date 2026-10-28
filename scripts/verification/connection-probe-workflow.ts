/** M0 matrix: real disposable connection probes must own an existing cwd,
 * retain the subprocess path, isolate concurrent keys and release resources. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verificationWorkflow } from './verification-artifacts'
import type { BackendHostRuntimeContext } from '../../packages/shared/src/agent/backend/types'

await verificationWorkflow('connection-probe', async evidence => {
  const config = join(evidence.directory, 'config'), home = join(evidence.directory, 'home')
  mkdirSync(config); mkdirSync(home)
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.USERPROFILE = home
  process.env.NODE_ENV = 'test'
  const { testBackendConnection } = await import('../../packages/shared/src/agent/backend/factory')
  const { getCredentialManager } = await import('../../packages/shared/src/credentials')
  const { getLlmConnections } = await import('../../packages/shared/src/config/connections')
  const prefix = 'phaneris-connection-', before = new Set(readdirSync(tmpdir()))
  const active = () => readdirSync(tmpdir()).filter(name => name.startsWith(prefix) && !before.has(name))
  const requests: Array<{ key: string; probe: string; credentialPresent: boolean; model: unknown; directories: string[]; sdk: boolean }> = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 30, async fetch(request) {
    const body = await request.json() as Record<string, unknown>, key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
    const probe = new URL(request.url).pathname.split('/')[1]!
    const credentialRows = await getCredentialManager().list({ type: 'llm_api_key' })
    const keys = await Promise.all(credentialRows.filter(row => row.connectionSlug?.startsWith('__test-')).map(row => getCredentialManager().getLlmApiKey(row.connectionSlug!)))
    const credentialPresent = keys.includes(probe)
    const directories = active()
    const sdk = directories.some(name => {
      const sessions = join(tmpdir(), name, 'sessions')
      return existsSync(sessions) && readdirSync(sessions).some(id => existsSync(join(sessions, id, '.pi-agent')))
    })
    requests.push({ key, probe, credentialPresent, model: body.model, directories, sdk })
    if (probe === 'bad-key') return Response.json({ error: { message: 'invalid API key' } }, { status: 401 })
    if (probe === 'slow-key') {
      return new Response(new ReadableStream({ start(controller) {
        request.signal.addEventListener('abort', () => { try { controller.close() } catch {} }, { once: true })
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } } : {}) })}\n\n`
    return new Response(chunk({ role: 'assistant', content: 'ok' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const resources = process.env.PHANERIS_VERIFY_PI_RESOURCES
  const hostRuntime: BackendHostRuntimeContext = resources ? { appRootPath: join(resources, 'app'), resourcesPath: resources, isPackaged: true }
    : { appRootPath: resolve('.'), isPackaged: false, nodeRuntimePath: process.execPath }
  const args = { provider: 'pi' as const, model: 'pi/fixture', baseUrl: api.url.href, hostRuntime, timeoutMs: 10000,
    connection: { providerType: 'pi_compat' as const, customEndpoint: { api: 'openai-completions' as const } } }
  const probe = (apiKey: string, extra: Partial<typeof args> = {}) => testBackendConnection({ ...args, apiKey, baseUrl: `${api.url.href}${apiKey}/`, ...extra })
  const scenes: string[] = [], results: unknown[] = []
  const checkClean = async () => {
    assert.deepEqual(active(), [], 'Probe must release every directory it created')
    assert(!(await getCredentialManager().list({ type: 'llm_api_key' })).some(row => row.connectionSlug?.startsWith('__test-')))
    assert.deepEqual(getLlmConnections(), [])
    assert(!existsSync(join(home, 'sessions')), 'Connection validation must not create sessions in the home directory')
  }
  try {
    const success = await probe('good-key')
    results.push(success); evidence.json('progress.json', { requests, results })
    assert(success.success, success.error)
    assert(requests.some(request => request.sdk && request.model === 'fixture'))
    await checkClean(); scenes.push('real-Pi-test-uses-owned-cwd-and-cleans-success')
    const parallel = await Promise.all(['parallel-a', 'parallel-b'].map(apiKey => probe(apiKey)))
    assert(parallel.every(result => result.success), JSON.stringify(parallel))
    assert(requests.some(request => request.probe === 'parallel-a' && request.credentialPresent)); assert(requests.some(request => request.probe === 'parallel-b' && request.credentialPresent))
    await checkClean(); scenes.push('concurrent-probes-isolate-credentials-and-directories')
    const bad = await probe('bad-key')
    assert.equal(bad.success, false); await checkClean(); results.push(bad)
    scenes.push('provider-rejection-remains-failure-and-cleans-resources')
    const slow = await probe('slow-key', { timeoutMs: 3000 })
    assert.equal(slow.success, false); assert.match(slow.error!, /timed out/i); await checkClean(); results.push(slow)
    scenes.push('timeout-releases-subprocess-directory-and-key')
    const broken = await probe('good-key', { hostRuntime: { ...hostRuntime, nodeRuntimePath: join(evidence.directory, 'missing-bun.exe') } })
    assert.equal(broken.success, false); assert.match(broken.error!, /ENOENT/); await checkClean(); results.push(broken)
    scenes.push('broken-runtime-is-not-hidden-by-a-successful-HTTP-endpoint')
    evidence.complete(scenes, ['Live provider credentials', 'Native non-Windows execution'])
  } finally { evidence.json('probe.json', { requests, results, remainingDirectories: active(), hostRuntime }); api.stop(true) }
  console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
})
