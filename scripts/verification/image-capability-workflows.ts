/** Image provider, projection, and Artifact workflow against a local provider only. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-images-'))
const configRoot = join(fixture, 'config'), workspaceRoot = join(fixture, 'workspace')
mkdirSync(join(configRoot, 'permissions'), { recursive: true }); mkdirSync(workspaceRoot, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot; process.env.NODE_ENV = 'test'
const workspace = { id: 'fixture', name: 'Fixture', rootPath: workspaceRoot, createdAt: Date.now() }
writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id }))
const image = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#3485a8' } }).png().toBuffer()
let requests = 0, corrupt = false, delayed = false
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  requests++; const body = await req.json() as any
  assert(body.modalities.includes('image')); assert.equal(body.messages[0].content[0].text, 'Fixture image')
  if (delayed) await Bun.sleep(2000)
  return Response.json({ id: `fixture-${requests}`, choices: [{ message: { content: 'Fixture response', images: [{ image_url: { url: `data:image/png;base64,${(corrupt ? Buffer.from('invalid image') : image).toString('base64')}` } }] } }], usage: { prompt_tokens: 10, completion_tokens: 20 } })
} })
const records: any[] = []
async function check(id: string, fn: () => any) { try { records.push({ id, pass: true, observation: await fn() }) } catch (e) { records.push({ id, pass: false, error: String(e) }) } }
const generation = await import('../../packages/server-core/src/services/image-generation.ts')
try {
  await check('Pi image model uses native adapter; invalid output and unsupported options fail explicitly', async () => {
    const config = { provider: 'openrouter' as const, apiKey: 'fixture', baseUrl: api.url.href }
    const result = await generation.generateImage(config, { prompt: 'Fixture image' })
    assert(result.bytes.equals(image)); assert.equal(result.provider, 'openrouter'); assert.equal(result.costStatus, 'estimated')
    const count = requests
    await assert.rejects(generation.generateImage(config, { prompt: 'Fixture image', background: 'transparent' }), /does not support/)
    assert.equal(requests, count)
    corrupt = true; await assert.rejects(generation.generateImage(config, { prompt: 'Fixture image' }), /format|payload/); corrupt = false
    return { provider: result.provider, model: result.model, requests, costStatus: result.costStatus }
  })
  await check('Model projection resizes copies and enforces image counts without altering original bytes', async () => {
    const { setImageProcessor } = await import('../../packages/server-core/src/services/image-utils.ts')
    setImageProcessor({ async getMetadata(buffer) { const m = await sharp(buffer).metadata(); return m.width && m.height ? { width: m.width, height: m.height } : null },
      async process(buffer, options) { let s = sharp(buffer); if (options?.resize) s = s.resize({ ...options.resize, fit: options.fit ?? 'inside', withoutEnlargement: true }); return options?.format === 'jpeg' ? s.jpeg({ quality: options.quality }).toBuffer() : s.png().toBuffer() } })
    const { prepareAttachmentsForModelInput } = await import('../../packages/server-core/src/sessions/model-image-input.ts')
    const originalPath = join(fixture, 'original.png'); writeFileSync(originalPath, image)
    const attachment = { type: 'image' as const, path: originalPath, storedPath: originalPath, name: 'original.png', mimeType: 'image/png', base64: image.toString('base64'), size: image.length }
    const limits = { images: { maxPerMessage: 1, maxPerRequest: 1, resize: { maxWidth: 64, maxHeight: 64, maxBytes: 50000 } } }
    const prepared = await prepareAttachmentsForModelInput([attachment], null, 'fixture', { inputLimits: limits })
    const resized = await sharp(Buffer.from(prepared.attachments![0]!.base64!, 'base64')).metadata()
    assert(resized.width! <= 64 && resized.height! <= 64); assert.equal(attachment.base64, image.toString('base64')); assert(readFileSync(originalPath).equals(image))
    await assert.rejects(prepareAttachmentsForModelInput([attachment, attachment], null, 'fixture', { inputLimits: limits }), /image.*limit|limit.*image/i)
    return { width: resized.width, height: resized.height, originalBytes: image.length }
  })
  await check('Explicit image-history recovery creates a linked text-only session and leaves evidence intact', async () => {
    const host = await import('../../packages/server-core/src/sessions/SessionManager.ts')
    const storage = await import('../../packages/shared/src/sessions/storage.ts')
    const manager = new host.SessionManager() as any
    const stored = await storage.createSession(workspaceRoot, { name: 'Original' })
    const source = host.createManagedSession(stored, workspace as any, { messagesLoaded: true }) as any
    source.messages = [{ id: 'user', role: 'user', timestamp: 1, content: 'Describe this picture', attachments: [{ id: 'image', type: 'image', name: 'original.png', mimeType: 'image/png', storedPath: join(fixture, 'original.png') }] }, { id: 'assistant', role: 'assistant', timestamp: 2, content: 'Recorded observation' }]
    manager.sessions.set(source.id, source); manager.eventSink = () => {}
    const before = JSON.stringify(source.messages)
    try {
      const recovered = await manager.recoverImageContext(source.id)
      const child = await manager.getSession(recovered.sessionId)
      assert.equal(child.parentSessionId, source.id); assert(!child.sdkSessionId)
      assert(child.messages[0].content.includes('Recorded observation')); assert(!child.messages[0].attachments?.length)
      assert.equal(JSON.stringify(source.messages), before)
      return { sourceId: source.id, childId: child.id, textOnly: true }
    } finally { manager.cleanup() }
  })
  await check('Paid image outcomes retain observed usage on invalid data and record cancellation independently', async () => {
    const { DurableRuntimeCoordinator } = await import('../../packages/server-core/src/durable-runtime/coordinator.ts')
    const { auxiliaryModelEffect } = await import('../../packages/server-core/src/services/auxiliary-model-effect.ts')
    const runtime = new DurableRuntimeCoordinator(), sessionId = 'image-accounting'
    const config = { provider: 'openrouter' as const, apiKey: 'fixture', baseUrl: api.url.href }
    const request = { prompt: 'Fixture image' }
    const identity = { workspaceRoot, sessionId, purpose: 'image_generation' as const, provider: 'openrouter', model: 'google/gemini-2.5-flash-image', request }
    try {
      corrupt = true
      await assert.rejects(auxiliaryModelEffect(runtime, identity, () => generation.generateImage(config, request), () => {}))
      corrupt = false; delayed = true
      const controller = new AbortController(), before = requests
      const pending = auxiliaryModelEffect(runtime, { ...identity, signal: controller.signal }, () => generation.generateImage({ ...config, signal: controller.signal }, request), () => {})
      while (requests === before) await Bun.sleep(10)
      controller.abort(); await assert.rejects(pending)
      const events = runtime.storeFor(workspaceRoot).listEvents({ sessionId, afterSeq: 0, limit: 100 })
      const outcomes = events.filter((e: any) => e.type === 'model_outcome_committed')
      assert.equal(outcomes.length, 2)
      assert.equal(outcomes[1]!.payload.stopReason, 'aborted')
      const usage = runtime.storeFor(workspaceRoot).listUsage({ sessionId })
      assert.equal(usage[0]!.inputTokens, 10); assert.equal(usage[0]!.outputTokens, 20)
      assert.equal(usage[1]!.costUsd, undefined); assert.equal(usage[1]!.payload.costSource, 'unknown')
      assert.equal(runtime.getCanonicalModelContext(workspaceRoot, sessionId).items.length, 0)
      return { outcomes: outcomes.length, invalidOutputUsage: usage[0], cancelled: true }
    } finally { runtime.closeAll(); delayed = false; corrupt = false }
  })
  await check('Generated image remains a reviewed Artifact until explicit acceptance', async () => {
    const { createArtifactDraft, submitArtifact, acceptArtifact, reviseArtifact, discardArtifact } = await import('../../packages/shared/src/artifacts/index.ts')
    const { existsSync } = await import('node:fs')
    const scope = { workspaceRootPath: workspaceRoot, workspaceId: 'fixture' }, sourcePath = join(workspaceRoot, 'generated.png')
    const draft = createArtifactDraft(scope, { sessionId: 'image-artifact', kind: 'image', sourcePath, initialBase64: image.toString('base64') })
    const ready = submitArtifact(scope, draft.artifact.id, { expectedRevision: draft.artifact.draftRevision! })
    assert.equal(ready.artifact.status, 'ready'); assert(!existsSync(sourcePath))
    const accepted = acceptArtifact(scope, draft.artifact.id)
    assert(accepted.accepted); assert(readFileSync(sourcePath).equals(image))
    const discarded = createArtifactDraft(scope, { sessionId: 'image-artifact', kind: 'image', sourcePath: 'discarded.png', initialBase64: image.toString('base64') })
    submitArtifact(scope, discarded.artifact.id, { expectedRevision: discarded.artifact.draftRevision! })
    reviseArtifact(scope, discarded.artifact.id); discardArtifact(scope, discarded.artifact.id)
    assert(!existsSync(join(workspaceRoot, 'discarded.png')))
    assert(readFileSync(sourcePath).equals(image))
    return { artifactId: draft.artifact.id, reviewBeforeMaterialize: true }
  })
} finally {
  api.stop(true)
  const output = join(root, '.cache/capability-integration/images.json')
  writeFileSync(output, JSON.stringify({ fixture, records }, null, 2)); console.log(JSON.stringify({ output, records }))
}
process.exit(records.every(r => r.pass) ? 0 : 1)
