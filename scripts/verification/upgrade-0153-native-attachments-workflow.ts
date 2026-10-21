/** CO-01/02/11: actual Electron renderer → preload → RPC → processor → provider. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('upgrade-0153-native-attachments', async run => {
  const root = resolve(import.meta.dir, '../..')
  const executable = process.env.PHANERIS_NATIVE_EXECUTABLE
  const profile = mkdtempSync(join(tmpdir(), 'phaneris-native-attachments-'))
  const workspace = join(profile, 'workspace')
  mkdirSync(workspace)
  process.env.PHANERIS_CONFIG_DIR = profile
  const requests: unknown[] = []
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ data: [{ id: 'fixture', object: 'model' }] })
    const body = await request.json()
    requests.push(body)
    run.json('provider-requests.json', requests)
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'native-attachment', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } } : {}) })}\n\n`
    return new Response(chunk({ role: 'assistant', content: 'NATIVE_ATTACHMENT_DONE' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  writeFileSync(join(profile, 'config.json'), JSON.stringify({ setupDeferred: true,
    workspaces: [{ id: 'attachments', name: 'Attachment acceptance', rootPath: workspace, createdAt: 1 }], activeWorkspaceId: 'attachments',
    defaultLlmConnection: 'fixture', llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
      baseUrl: new URL('v1', provider.url).href, customEndpoint: { api: 'openai-completions', supportsImages: true }, defaultModel: 'pi/fixture',
      models: [{ id: 'fixture', name: 'Fixture', provider: 'pi', supportsImages: true, contextWindow: 128000, maxTokens: 4096 }] }] }))
  const { getCredentialManager } = await import('../../packages/shared/src/credentials')
  await getCredentialManager().setLlmApiKey('fixture', 'native-loopback-only')
  const { createSession } = await import('../../packages/shared/src/sessions/storage')
  const session = await createSession(workspace, { name: 'Attachment session', model: 'pi/fixture', llmConnection: 'fixture' })
  const fixture = join(run.directory, 'fixture.json')
  writeFileSync(fixture, JSON.stringify({ root, executable, cwd: executable ? profile : root, config: profile, output: run.directory,
    session: session.id, workspace, heic: join(root, '.cache/upgrade-20261018/fixtures/small.heic'), photo: join(root, '.cache/upgrade-20261018/fixtures/photo.heic'), broken: join(root, '.cache/upgrade-20261018/fixtures/truncated.heic') }))
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/native-attachments.cjs'), fixture], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 300_000)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'native.log'), stdout + stderr)
    assert.equal(code, 0, (stdout + stderr).slice(-5000))
    const report = JSON.parse(readFileSync(join(run.directory, 'native-attachments.json'), 'utf8')) as { checks: string[]; stores: any[]; sends: any[] }
    assert.equal(report.checks.length, 7)
    const imageRequests = requests.filter((request: any) => JSON.stringify(request.messages).includes('image_url'))
    assert.equal(imageRequests.length, 4, 'three ingress paths and the pending-draft turn must each reach the real provider once')
    for (const request of imageRequests) {
      assert(JSON.stringify(request).includes('data:image/jpeg;base64,/9j/'), 'the provider must receive actual normalized JPEG bytes')
      assert(!JSON.stringify(request).includes('data:image/heic;'))
    }
    assert.equal(report.sends.length, 4, 'the damaged attachment must not dispatch a text-only request')
    for (const call of report.sends) {
      const attachment = call[2][0]
      assert.equal(attachment.type, 'image'); assert.equal(attachment.mimeType, 'image/jpeg')
      assert(attachment.name.endsWith('.jpg')); assert.equal(attachment.size, Buffer.from(attachment.base64, 'base64').length)
    }
    run.complete(report.checks, [executable ? 'unsigned Windows unpacked only' : 'development Electron; packaged run requires PHANERIS_NATIVE_EXECUTABLE', 'macOS/Linux', 'physical OS clipboard and Explorer drag gesture (real DOM File/clipboard events exercised)'])
  } finally { clearTimeout(timer); provider.stop(true) }
})
