#!/usr/bin/env bun
/** Real authenticated RPC and filesystem fixtures; no user workspace is touched. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Failure contract fixed before implementation: traversal, directory/file links,
// dangling links, invalid SVG/raster, failed conversion/publication, a parent or
// destination swapped during conversion, nested icon names, concurrent writes.
await verificationWorkflow('workspace-image', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { registerWorkspaceCoreHandlers } = await import('../../packages/server-core/src/handlers/rpc/workspace')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const workspace = { id: 'images', slug: 'images', name: 'Images', rootPath: join(run.directory, 'workspace'), createdAt: 1 }
  createWorkspaceAtPath(workspace.rootPath, workspace.name)
  saveConfig({ workspaces: [workspace], activeWorkspaceId: workspace.id, activeSessionId: null })
  const outside = join(run.directory, 'outside')
  mkdirSync(outside)
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>'
  const raster = await sharp({ create: { width: 512, height: 128, channels: 4, background: '#445566' } }).png().toBuffer()
  const platform = createHeadlessPlatform()
  const originalProcessor = platform.imageProcessor
  const token = crypto.randomUUID()
  const disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  registerWorkspaceCoreHandlers(server, { platform, sessionManager: {} } as HandlerDeps)
  await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: workspace.id })
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
    finally { platform.imageProcessor = originalProcessor }
  }
  const write = (path: string, content: string | Buffer = svg, mime = 'image/svg+xml') =>
    client.invoke(c.workspace.WRITE_IMAGE, workspace.id, path, Buffer.from(content).toString('base64'), mime)
  const read = (path: string) => client.invoke(c.workspace.READ_IMAGE, workspace.id, path)
  try {
    await client.connect()
    await scene('missing-image-is-null', async () => { assert.equal(await read('./missing.svg'), null) })
    await scene('svg-and-binary-roundtrip', async () => {
      await write('./roundtrip.svg')
      assert.equal(await read('./roundtrip.svg'), svg)
      await write('./roundtrip.png', raster, 'image/png')
      const value = await read('./roundtrip.png')
      assert.equal(typeof value, 'string')
      assert(String(value).startsWith('data:image/png;base64,'))
      const metadata = await sharp(readFileSync(join(workspace.rootPath, 'roundtrip.png'))).metadata()
      assert.equal(metadata.width, 256)
      assert.equal(metadata.height, 64)
    })
    await scene('traversal-and-unsupported-extension-rejected', async () => {
      await assert.rejects(read('../outside/secret.svg'))
      await assert.rejects(write('../outside/secret.svg'))
      await assert.rejects(write('./payload.txt'))
    })
    await scene('junction-read-and-write-rejected', async () => {
      symlinkSync(outside, join(workspace.rootPath, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
      writeFileSync(join(outside, 'secret.svg'), svg)
      await assert.rejects(read('linked/secret.svg'))
      await assert.rejects(write('linked/secret.svg', '<svg/>'))
      assert.equal(readFileSync(join(outside, 'secret.svg'), 'utf8'), svg)
    })
    await scene('dangling-junction-rejected', async () => {
      const missing = join(run.directory, 'not-created')
      symlinkSync(missing, join(workspace.rootPath, 'dangling'), process.platform === 'win32' ? 'junction' : 'dir')
      await assert.rejects(read('dangling/icon.svg'))
      await assert.rejects(write('dangling/icon.svg'))
      assert(!existsSync(missing))
    })
    await scene('rejected-svg-preserves-old-icon', async () => {
      writeFileSync(join(workspace.rootPath, 'icon.png'), raster)
      await assert.rejects(write('./icon.svg', '<svg><script/></svg>'), /Invalid SVG/)
      assert.deepEqual(readFileSync(join(workspace.rootPath, 'icon.png')), raster)
    })
    await scene('invalid-raster-preserves-old-icon', async () => {
      writeFileSync(join(workspace.rootPath, 'icon.svg'), svg)
      await assert.rejects(write('./icon.jpg', 'not an image', 'image/jpeg'), /[Ii]nvalid.*image/)
      assert.equal(readFileSync(join(workspace.rootPath, 'icon.svg'), 'utf8'), svg)
    })
    await scene('conversion-failure-preserves-old-icon', async () => {
      writeFileSync(join(workspace.rootPath, 'icon.svg'), svg)
      platform.imageProcessor = { ...originalProcessor, process: async () => { throw new Error('injected conversion failure') } }
      await assert.rejects(write('./icon.jpg', raster, 'image/jpeg'), /conversion failure/)
      assert.equal(readFileSync(join(workspace.rootPath, 'icon.svg'), 'utf8'), svg)
    })
    await scene('publication-failure-preserves-other-formats', async () => {
      const parent = join(workspace.rootPath, 'blocked')
      mkdirSync(join(parent, 'icon.svg'), { recursive: true })
      writeFileSync(join(parent, 'icon.png'), raster)
      await assert.rejects(write('blocked/icon.svg'))
      assert.deepEqual(readFileSync(join(parent, 'icon.png')), raster)
    })
    await scene('nested-icon-does-not-clean-root', async () => {
      mkdirSync(join(workspace.rootPath, 'nested'))
      writeFileSync(join(workspace.rootPath, 'icon.png'), raster)
      await write('nested/icon.svg')
      assert.deepEqual(readFileSync(join(workspace.rootPath, 'icon.png')), raster)
      assert.equal(await read('nested/icon.svg'), svg)
    })
    await scene('root-icon-replaces-known-formats-only', async () => {
      writeFileSync(join(workspace.rootPath, 'icon.png'), raster)
      writeFileSync(join(workspace.rootPath, 'icon.notes'), 'keep')
      await write('./icon.svg')
      assert(!existsSync(join(workspace.rootPath, 'icon.png')))
      assert.equal(readFileSync(join(workspace.rootPath, 'icon.notes'), 'utf8'), 'keep')
      assert.equal(await read('./icon.svg'), svg)
    })
    await scene('parent-swap-during-conversion-rejected', async () => {
      const parent = join(workspace.rootPath, 'swap')
      mkdirSync(parent)
      platform.imageProcessor = { ...originalProcessor, process: async (...args) => {
        renameSync(parent, join(workspace.rootPath, 'retired-swap'))
        symlinkSync(outside, parent, process.platform === 'win32' ? 'junction' : 'dir')
        return originalProcessor.process(...args)
      } }
      await assert.rejects(write('swap/converted.png', raster, 'image/png'))
      assert(!existsSync(join(outside, 'converted.png')))
    })
    await scene('destination-swap-during-conversion-rejected', async () => {
      const parent = join(workspace.rootPath, 'destination-swap')
      mkdirSync(parent)
      platform.imageProcessor = { ...originalProcessor, process: async (...args) => {
        symlinkSync(outside, join(parent, 'converted.png'), process.platform === 'win32' ? 'junction' : 'dir')
        return originalProcessor.process(...args)
      } }
      await assert.rejects(write('destination-swap/converted.png', raster, 'image/png'))
    })
    await scene('concurrent-replacements-are-complete', async () => {
      await Promise.all([write('concurrent.svg', svg), write('concurrent.svg', '<svg/>')])
      assert([svg, '<svg/>'].includes(String(await read('concurrent.svg'))))
    })
    run.json('scenarios.json', { checks, failures })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['POSIX symlinks and macOS native image processing require their respective platforms',
      'Untrusted local processes racing individual synchronous filesystem syscalls are outside this RPC workflow'])
  } finally {
    client.destroy()
    await disconnected.promise
    server.close()
  }
})
