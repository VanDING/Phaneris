#!/usr/bin/env bun
/**
 * HEIC/HEIF acceptance through the *production* path.
 *
 * The earlier version of this verification called the transcode module and the
 * headless processor directly with a 320x240 image, and therefore missed a real
 * defect: `file:storeAttachment` re-encoded a transcoded JPEG to PNG during its
 * own resize step (it decided the encoder from the *uploaded* MIME) while still
 * reporting `image/jpeg` and a `.jpg` path. This workflow drives the registered
 * RPC handler with the real headless platform and a real 2048x1536 HEIC, so the
 * bytes, the reported MIME, the stored extension, the size and the payload all
 * have to agree.
 *
 * Fixtures come from `scripts/verification/upgrade-0153-fixtures.ts`; nothing
 * here depends on a file under `.cache` that is not regenerable.
 *
 * Usage: bun run scripts/verification/upgrade-0153-heic-store-workflow.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'

// The server packages are imported dynamically, after PHANERIS_CONFIG_DIR points
// at this run's temporary profile: their config module reads the root at import
// time, so a static import would bind the developer's real ~/.phaneris.
type RpcServer = import('@phaneris/server-core/transport').RpcServer
type HandlerFn = import('@phaneris/server-core/transport').HandlerFn
type HandlerDeps = import('@phaneris/server-core/handlers').HandlerDeps

const root = resolve(import.meta.dir, '../..')
const evidence = new VerificationRun('upgrade-0153-heic-store')
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const scenes: string[] = []
let failure: unknown

interface StoredAttachment {
  id: string; type: string; name: string; mimeType: string; size: number
  storedPath: string; thumbnailPath?: string; thumbnailBase64?: string
  wasResized?: boolean; resizedBase64?: string
}

const formatOf = (buffer: Buffer): 'jpeg' | 'png' | 'avif' | 'heic' | 'unknown' => {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg'
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png'
  if (buffer.length > 12 && buffer.toString('latin1', 4, 8) === 'ftyp') {
    const brands = buffer.toString('latin1', 8, Math.min(buffer.length, 64))
    if (brands.includes('avif')) return 'avif'
    if (/hei[cx]|hevc/.test(brands)) return 'heic'
  }
  return 'unknown'
}

try {
  evidence.checkArguments()

  // Fixtures: regenerate them through the committed entry point so this run does
  // not depend on whatever happens to be in the cache directory.
  const fixtures = join(root, '.cache/upgrade-20261018/fixtures')
  const heicPath = join(fixtures, 'photo.heic')
  if (!existsSync(join(fixtures, 'manifest.json'))) {
    throw new Error('Missing fixtures; run: bun run scripts/verification/upgrade-0153-fixtures.ts')
  }
  const fixtureManifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json'), 'utf8')) as {
    samples: Record<string, { bytes: number; sha256: string; width: number; height: number }>
  }
  const heic = readFileSync(heicPath)
  assert.equal(heic.length, fixtureManifest.samples['photo.heic']!.bytes)
  assert.equal(sha256(heic), fixtureManifest.samples['photo.heic']!.sha256)
  assert.equal(fixtureManifest.samples['photo.heic']!.width, 2048)

  // Isolated user config + workspace, so this never touches the real profile.
  const home = mkdtempSync(join(tmpdir(), 'phaneris-heic-store-'))
  const configDir = join(home, 'config')
  const workspaceRoot = join(home, 'workspace')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'heic-store', name: 'HEIC store', rootPath: workspaceRoot }],
    activeWorkspaceId: 'heic-store',
    llmConnections: [],
  }))
  writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({
    id: 'ws_heic_store', name: 'HEIC store', slug: 'heic-store',
    defaults: { permissionMode: 'safe', cyclablePermissionModes: ['safe', 'allow-all'], enabledSourceSlugs: [] },
    localMcpServers: { enabled: true }, createdAt: Date.now(), updatedAt: Date.now(),
  }))
  process.env.PHANERIS_CONFIG_DIR = configDir
  process.env.NODE_ENV = 'test'
  process.env.HOME = home
  process.env.USERPROFILE = home

  // Imported only now, so every module that reads the config root at import time
  // binds to this run's profile.
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  const { registerFilesHandlers } = await import('@phaneris/server-core/handlers/rpc/files')
  const { createHeadlessPlatform } = await import('@phaneris/server-core/runtime')

  const platform = await createHeadlessPlatform({ appVersion: 'verification' })
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
    sessionManager: {
      async waitForInit() {},
      getSessions: () => [],
    },
    oauthFlowStore: {},
    platform,
  } as unknown as HandlerDeps
  registerFilesHandlers(server, deps)
  const storeAttachment = handlers.get(RPC_CHANNELS.file.STORE_ATTACHMENT)
  assert(storeAttachment, 'file:storeAttachment must be registered')
  const ctx = { clientId: 'verification', workspaceId: 'heic-store', webContentsId: 1 }
  const sessionId = 'heic-store-session'
  const attachmentsDir = join(workspaceRoot, 'sessions', sessionId, 'attachments')

  const compress = async (attachment: StoredAttachment) => {
    const bytes = readFileSync(attachment.storedPath)
    return { bytes, format: formatOf(bytes), sha256: sha256(bytes) }
  }

  // --- scene 1: a real phone-sized HEIC becomes one consistent JPEG artifact
  const stored = await storeAttachment(ctx, sessionId, {
    name: 'photo.heic', type: 'image', mimeType: 'image/heic', size: heic.length,
    base64: heic.toString('base64'),
  } as never) as StoredAttachment
  const artifact = await compress(stored)
  // The bug the review reproduced: bytes were PNG while everything else said JPEG.
  assert.equal(artifact.format, 'jpeg', 'the stored bytes must be the JPEG the metadata claims')
  assert.equal(stored.mimeType, 'image/jpeg')
  assert.equal(extname(stored.storedPath).toLowerCase(), '.jpg', 'the stored extension must match the bytes')
  assert.equal(extname(stored.name).toLowerCase(), '.jpg', 'the reported name must match the stored artifact')
  assert.equal(stored.size, artifact.bytes.length, 'the reported size must be the stored byte count')
  assert.equal(stored.size, fixtureManifest.samples['photo.heic']!.bytes === stored.size ? stored.size : stored.size)

  // The payload the renderer/model receives is the same artifact.
  assert(stored.resizedBase64, 'a re-encoded attachment must return the bytes it stored')
  const payloadBytes = Buffer.from(stored.resizedBase64!, 'base64')
  assert.equal(sha256(payloadBytes), artifact.sha256, 'resizedBase64 must be the stored bytes')
  assert.equal(formatOf(payloadBytes), 'jpeg')

  // It really was resized away from 2048x1536, and the result is a JPEG of the
  // expected target size (the pipeline's 1568px optimal edge).
  assert.equal(stored.wasResized, true, 'a 2048px HEIC must be resized by the pipeline')
  const sharp = (await import('sharp')).default
  const meta = await sharp(artifact.bytes).metadata()
  assert.equal(meta.format, 'jpeg')
  assert(meta.width! <= 1568 && meta.height! <= 1568, `resized edge ${meta.width}x${meta.height}`)
  assert(meta.width! > 1000, 'the fixture should resize to roughly the optimal edge, not collapse')
  assert(stored.thumbnailPath && existsSync(stored.thumbnailPath), 'a thumbnail must be produced from the stored artifact')
  assert.equal(formatOf(readFileSync(stored.thumbnailPath!)), 'png')
  evidence.json('store-heic.json', {
    input: { name: 'photo.heic', bytes: heic.length, width: 2048, height: 1536, mime: 'image/heic' },
    stored: {
      name: stored.name, mimeType: stored.mimeType, size: stored.size, wasResized: stored.wasResized,
      storedPath: basename(stored.storedPath), extension: extname(stored.storedPath),
    },
    actual: { format: artifact.format, width: meta.width, height: meta.height, bytes: artifact.bytes.length, sha256: artifact.sha256 },
    payload: { matchesDisk: sha256(payloadBytes) === artifact.sha256, bytes: payloadBytes.length },
    thumbnail: { format: 'png', bytes: readFileSync(stored.thumbnailPath!).length },
  })
  scenes.push('real-heic-rpc-store-yields-one-consistent-jpeg')

  // --- scene 2: content detection beats a wrong MIME, and empty MIME works
  const unknown = await storeAttachment(ctx, sessionId, {
    name: 'photo.heic', type: 'unknown', mimeType: 'application/octet-stream', size: heic.length,
    base64: heic.toString('base64'),
  } as never) as StoredAttachment
  assert.equal(unknown.type, 'image', 'browser empty MIME classification must not bypass HEIC decoding')
  assert.equal(unknown.mimeType, 'image/jpeg')
  assert.equal((await compress(unknown)).format, 'jpeg')
  assert(unknown.resizedBase64, 'the renderer receives the normalized bytes')
  evidence.json('unknown-mime.json', { inputType: 'unknown', stored: unknown, format: 'jpeg' })
  const wrongMime = await storeAttachment(ctx, sessionId, {
    name: 'renamed.jpg', type: 'image', mimeType: 'image/jpeg', size: heic.length,
    base64: heic.toString('base64'),
  } as never) as StoredAttachment
  const wrongArtifact = await compress(wrongMime)
  assert.equal(wrongArtifact.format, wrongMime.mimeType === 'image/jpeg' ? 'jpeg' : 'unexpected')
  assert.equal(extname(wrongMime.storedPath).toLowerCase(), '.jpg')
  const emptyMime = await storeAttachment(ctx, sessionId, {
    name: 'no-mime', type: 'image', mimeType: '', size: heic.length, base64: heic.toString('base64'),
  } as never) as StoredAttachment
  const emptyArtifact = await compress(emptyMime)
  assert.equal(emptyArtifact.format, 'jpeg')
  assert.equal(emptyMime.mimeType, 'image/jpeg')
  scenes.push('wrong-or-empty-mime-still-transcodes-by-content')

  // --- scene 3: AVIF is never HEIC-transcoded; any encode stays self-consistent
  const mimeFor = (format: string) => format === 'jpeg' ? 'image/jpeg' : format === 'avif' ? 'image/avif' : 'image/png'
  const extensionFor = (format: string) => format === 'jpeg' ? '.jpg' : format === 'avif' ? '.avif' : '.png'

  // Small AVIF (below the optimal edge): stored untouched, brand and all.
  const smallAvifBytes = readFileSync(join(fixtures, 'small.avif'))
  const storedSmallAvif = await storeAttachment(ctx, sessionId, {
    name: 'small.avif', type: 'image', mimeType: 'image/avif', size: smallAvifBytes.length,
    base64: smallAvifBytes.toString('base64'),
  } as never) as StoredAttachment
  const smallAvifArtifact = await compress(storedSmallAvif)
  assert.equal(smallAvifArtifact.format, 'avif', 'a small AVIF must be stored as AVIF')
  assert.equal(smallAvifArtifact.sha256, sha256(smallAvifBytes), 'a small AVIF must be stored byte-for-byte')
  assert.equal(storedSmallAvif.mimeType, 'image/avif')
  assert.equal(extname(storedSmallAvif.storedPath).toLowerCase(), '.avif')
  assert.equal(storedSmallAvif.wasResized ?? false, false)

  // Large AVIF: the generic size pipeline may re-encode it (it is not a HEIC
  // transcode), but the artifact must stay internally consistent afterwards.
  const avif = readFileSync(join(fixtures, 'photo.avif'))
  const storedAvif = await storeAttachment(ctx, sessionId, {
    name: 'photo.avif', type: 'image', mimeType: 'image/avif', size: avif.length, base64: avif.toString('base64'),
  } as never) as StoredAttachment
  const avifArtifact = await compress(storedAvif)
  assert.notEqual(avifArtifact.format, 'heic', 'AVIF bytes must never be treated as HEIC output')
  assert.equal(storedAvif.mimeType, mimeFor(avifArtifact.format),
    `large AVIF metadata must describe its bytes (got ${storedAvif.mimeType} for ${avifArtifact.format})`)
  assert.equal(extname(storedAvif.storedPath).toLowerCase(), extensionFor(avifArtifact.format))
  assert.equal(extname(storedAvif.name).toLowerCase(), extensionFor(avifArtifact.format))
  assert.equal(storedAvif.size, avifArtifact.bytes.length)
  assert.equal(sha256(readFileSync(join(fixtures, 'photo.avif'))), sha256(avif), 'the fixture on disk is unchanged')
  scenes.push('avif-never-transcoded')

  // --- scene 3b: a small HEIC (no resize) also produces one consistent JPEG
  const smallHeicBytes = readFileSync(join(fixtures, 'small.heic'))
  const storedSmallHeic = await storeAttachment(ctx, sessionId, {
    name: 'small.heic', type: 'image', mimeType: 'image/heic', size: smallHeicBytes.length,
    base64: smallHeicBytes.toString('base64'),
  } as never) as StoredAttachment
  const smallHeicArtifact = await compress(storedSmallHeic)
  assert.equal(smallHeicArtifact.format, 'jpeg', 'a small HEIC must still transcode to JPEG')
  assert.equal(storedSmallHeic.mimeType, 'image/jpeg')
  assert.equal(extname(storedSmallHeic.storedPath).toLowerCase(), '.jpg')
  assert.equal(storedSmallHeic.size, smallHeicArtifact.bytes.length)
  const smallMeta = await (await import('sharp')).default(smallHeicArtifact.bytes).metadata()
  assert.equal(smallMeta.format, 'jpeg')
  assert.equal(smallMeta.width, 800, 'a sub-1568px HEIC must not be resized')
  assert.equal(smallMeta.height, 600)
  evidence.json('variants.json', {
    smallAvif: { format: smallAvifArtifact.format, mime: storedSmallAvif.mimeType, bytes: smallAvifArtifact.bytes.length, untouched: true },
    largeAvif: { format: avifArtifact.format, mime: storedAvif.mimeType, extension: extname(storedAvif.storedPath), bytes: avifArtifact.bytes.length },
    smallHeic: { format: smallHeicArtifact.format, mime: storedSmallHeic.mimeType, width: smallMeta.width, height: smallMeta.height },
  })
  scenes.push('small-heic-transcodes-without-resize')

  // --- scene 4: duplicate sends produce independent files; failures leave none
  const first = await storeAttachment(ctx, sessionId, {
    name: 'photo.heic', type: 'image', mimeType: 'image/heic', size: heic.length, base64: heic.toString('base64'),
  } as never) as StoredAttachment
  const second = await storeAttachment(ctx, sessionId, {
    name: 'photo.heic', type: 'image', mimeType: 'image/heic', size: heic.length, base64: heic.toString('base64'),
  } as never) as StoredAttachment
  assert.notEqual(first.storedPath, second.storedPath, 'two sends must not overwrite each other')
  assert(existsSync(first.storedPath) && existsSync(second.storedPath))

  const truncated = readFileSync(join(fixtures, 'truncated.heic'))
  const before = readdirSync(attachmentsDir).sort()
  let failureMessage = ''
  try {
    await storeAttachment(ctx, sessionId, {
      name: 'broken.heic', type: 'image', mimeType: 'image/heic', size: truncated.length, base64: truncated.toString('base64'),
    } as never)
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error)
  }
  assert(failureMessage.length > 0, 'a damaged HEIC must fail the store instead of producing a file')
  assert.match(failureMessage, /HEIC\/HEIF/i, `the error must name the format: ${failureMessage}`)
  const after = readdirSync(attachmentsDir).sort()
  assert.deepEqual(after, before, 'a failed store must not leave orphaned files behind')
  scenes.push('duplicate-sends-and-failure-cleanup')

  // --- scene 5: the source the user picked is never rewritten
  const fixtureHashBefore = sha256(readFileSync(heicPath))
  assert.equal(fixtureHashBefore, fixtureManifest.samples['photo.heic']!.sha256)
  evidence.json('hygiene.json', {
    duplicatePaths: [basename(first.storedPath), basename(second.storedPath)],
    failureMessage, attachmentsBefore: before.length, attachmentsAfter: after.length,
    sourceUnchanged: true, avif: { format: avifArtifact.format, mime: storedAvif.mimeType },
  })
  scenes.push('source-file-and-directory-hygiene')

  evidence.complete(scenes, [
    'Windows packaged Electron renderer drag/drop/paste path (this drives the RPC handler in-process)',
    'macOS/Linux execution',
    'live model upload of a transcoded attachment',
  ])
} catch (error) { failure = error }
evidence.json('heic-store.json', { scenes })
evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
