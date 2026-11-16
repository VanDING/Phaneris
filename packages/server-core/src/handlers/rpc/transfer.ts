import { validateRpcArguments } from '@phaneris/shared/protocol';
/**
 * Chunked Transfer RPC Handlers
 *
 * Enables large-payload RPC calls (e.g. sessions:import, resources:import)
 * to be split across multiple small WebSocket messages. This works behind
 * proxies and tunnels (Cloudflare, nginx) that have message-size limits.
 *
 * Protocol:
 *   1. transfer:start  → allocate temp dir, return transferId
 *   2. transfer:chunk  → write one chunk to temp file (repeat N times)
 *   3. transfer:commit → reassemble, execute deferred RPC, clean up
 *   4. transfer:abort  → best-effort cleanup after client-side failure/cancel
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodedError, RPC_CHANNELS } from '@phaneris/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'

interface TransferState {
  id: string
  dir: string
  ownerClientId: string
  totalBytes: number
  chunkCount: number
  chunks: Map<number, { hash: string; bytes: number; write: Promise<void> }>
  phase: 'receiving' | 'committing' | 'completed' | 'aborting'
  commit?: Promise<unknown>
  /** Decoded bytes accumulated so far (M-10 cap enforcement). */
  receivedBytes: number
  channel: string
  args: unknown[]
  largeArgIndex: number
  checksum?: string
  timer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_TRANSFER_TTL_MS = 5 * 60 * 1000

/**
 * M-10: hard caps for chunked transfers so a malicious/buggy client cannot
 * exhaust disk or memory. COMMIT loads every chunk file into memory for
 * reassembly, so both the total payload size and the chunk count are bounded.
 */
const MAX_TRANSFER_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_TRANSFER_CHUNK_COUNT = 2000

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.transfer.START,
  RPC_CHANNELS.transfer.CHUNK,
  RPC_CHANNELS.transfer.COMMIT,
  RPC_CHANNELS.transfer.ABORT,
] as const

const activeTransfers = new Map<string, TransferState>()
const transferableHandlers = new Map<string, HandlerFn>()

function getTransferTtlMs(): number {
  const raw = Number(process.env.PHANERIS_TRANSFER_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TRANSFER_TTL_MS
}

async function cleanupTransfer(transferId: string): Promise<void> {
  const transfer = activeTransfers.get(transferId)
  if (!transfer || transfer.phase === 'committing') return
  transfer.phase = 'aborting'

  if (transfer.timer) {
    clearTimeout(transfer.timer)
    transfer.timer = null
  }
  activeTransfers.delete(transferId)
  await Promise.allSettled([...transfer.chunks.values()].map(chunk => chunk.write))
  await removeTransferFiles(transfer)
}

async function removeTransferFiles(transfer: TransferState): Promise<void> {
  try {
    if (existsSync(transfer.dir)) {
      await rm(transfer.dir, { recursive: true, force: true })
    }
  } catch {
    // Best effort cleanup
  }
}

function rescheduleTransferCleanup(transfer: TransferState): void {
  if (transfer.phase !== 'receiving' && transfer.phase !== 'completed') return
  if (transfer.timer) clearTimeout(transfer.timer)
  transfer.timer = setTimeout(() => {
    console.warn(`[Transfer:server] TTL expired for transfer ${transfer.id} — cleaning up`)
    void cleanupTransfer(transfer.id)
  }, getTransferTtlMs())
  transfer.timer.unref?.()
}

function assertTransferOwner(ctx: RequestContext, transfer: TransferState): void {
  if (ctx.clientId !== transfer.ownerClientId) {
    throw new Error('Transfer owned by different client')
  }
}

export function setTransferableHandler(channel: string, handler: HandlerFn): void {
  transferableHandlers.set(channel, handler)
}

export function __resetTransferStateForTests(): void {
  for (const transfer of activeTransfers.values()) {
    if (transfer.timer) clearTimeout(transfer.timer)
  }
  activeTransfers.clear()
  transferableHandlers.clear()
}

export function registerTransferHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.transfer.START, async (ctx, opts: {
    totalBytes: number
    chunkCount: number
    channel: string
    args: unknown[]
    largeArgIndex: number
    checksum?: string
  }) => {
    if (!opts || !Number.isInteger(opts.chunkCount) || opts.chunkCount < 1) {
      throw new Error('Invalid chunkCount')
    }
    if (!Number.isInteger(opts.totalBytes) || opts.totalBytes < 0) {
      throw new Error('Invalid totalBytes')
    }
    if (opts.totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
      throw new CodedError('TRANSFER_TOO_LARGE', `Transfer too large: ${opts.totalBytes} bytes exceeds the ${MAX_TRANSFER_TOTAL_BYTES} byte limit`)
    }
    if (opts.chunkCount > MAX_TRANSFER_CHUNK_COUNT) {
      throw new CodedError('TRANSFER_TOO_LARGE', `Too many chunks: ${opts.chunkCount} exceeds the ${MAX_TRANSFER_CHUNK_COUNT} chunk limit`)
    }
    if (!opts.channel || typeof opts.channel !== 'string') {
      throw new Error('Missing target channel')
    }
    if (!Array.isArray(opts.args)) {
      throw new Error('Missing deferred args')
    }
    if (!transferableHandlers.has(opts.channel)) {
      throw new Error(`Channel ${opts.channel} does not support chunked transfer`)
    }
    if (!Number.isInteger(opts.largeArgIndex) || opts.largeArgIndex < 0 || opts.largeArgIndex >= opts.args.length) {
      throw new Error('Invalid largeArgIndex')
    }

    const transferId = randomUUID()
    const dir = join(tmpdir(), `craft-transfer-${transferId}`)
    await mkdir(dir, { recursive: true })

    const transfer: TransferState = {
      id: transferId,
      dir,
      ownerClientId: ctx.clientId,
      totalBytes: opts.totalBytes,
      chunkCount: opts.chunkCount,
      chunks: new Map(),
      phase: 'receiving',
      receivedBytes: 0,
      channel: opts.channel,
      args: opts.args,
      largeArgIndex: opts.largeArgIndex,
      checksum: opts.checksum,
      timer: null,
    }
    activeTransfers.set(transferId, transfer)
    rescheduleTransferCleanup(transfer)

    const totalMB = (opts.totalBytes / (1024 * 1024)).toFixed(1)
    console.log(`[Transfer:server] Started transfer ${transferId}: ${opts.chunkCount} chunks, ${totalMB}MB, channel: ${opts.channel}`)

    return { transferId }
  })

  server.handle(RPC_CHANNELS.transfer.CHUNK, async (ctx, opts: {
    transferId: string
    index: number
    data: string
  }) => {
    const transfer = activeTransfers.get(opts.transferId)
    if (!transfer) {
      console.error(`[Transfer:server] Unknown transfer: ${opts.transferId}`)
      throw new Error(`Unknown transfer: ${opts.transferId}`)
    }
    assertTransferOwner(ctx, transfer)
    if (transfer.phase !== 'receiving') throw new Error('Transfer no longer accepts chunks')

    if (!Number.isInteger(opts.index) || opts.index < 0 || opts.index >= transfer.chunkCount) {
      throw new Error(`Invalid chunk index: ${opts.index}`)
    }
    if (typeof opts.data !== 'string' || opts.data.length === 0) {
      throw new Error('Missing chunk data')
    }

    // M-10: reject chunks that would push the accumulated payload past the
    // declared total (defense in depth against oversized/duplicated chunks).
    // Decoded byte count is used so legitimately base64-encoded payloads near
    // the cap are not falsely rejected (base64 expands ~4/3x vs raw bytes).
    const decoded = Buffer.from(opts.data, 'base64')
    const chunkBytes = decoded.length
    const hash = createHash('sha256').update(decoded).digest('hex')
    const previous = transfer.chunks.get(opts.index)
    if (previous) {
      if (previous.hash !== hash || previous.bytes !== chunkBytes) throw new Error(`Conflicting replay for chunk ${opts.index}`)
      await previous.write
      rescheduleTransferCleanup(transfer)
      return { received: opts.index }
    }
    if (transfer.receivedBytes + chunkBytes > transfer.totalBytes) {
      throw new CodedError(
        'TRANSFER_TOO_LARGE',
        `Chunk ${opts.index} would exceed declared total of ${transfer.totalBytes} bytes`,
      )
    }

    const chunkPath = join(transfer.dir, `chunk-${String(opts.index).padStart(6, '0')}`)
    const entry = { hash, bytes: chunkBytes, write: Promise.resolve() }
    // Reserve the index and bytes before the first asynchronous write.
    transfer.chunks.set(opts.index, entry)
    transfer.receivedBytes += chunkBytes
    entry.write = writeFile(chunkPath, opts.data, 'utf-8').catch(error => {
      transfer.chunks.delete(opts.index)
      transfer.receivedBytes -= chunkBytes
      throw error
    })
    await entry.write
    rescheduleTransferCleanup(transfer)

    if ((opts.index + 1) % 10 === 0 || opts.index === transfer.chunkCount - 1) {
      console.log(`[Transfer:server] Received chunk ${opts.index + 1}/${transfer.chunkCount} for ${transfer.id.slice(0, 8)}`)
    }

    return { received: opts.index }
  })

  server.handle(RPC_CHANNELS.transfer.COMMIT, async (ctx, opts: {
    transferId: string
  }) => {
    const transfer = activeTransfers.get(opts.transferId)
    if (!transfer) {
      console.error(`[Transfer:server] Commit failed — unknown transfer: ${opts.transferId}`)
      throw new Error(`Unknown transfer: ${opts.transferId}`)
    }
    assertTransferOwner(ctx, transfer)

    if (transfer.commit) return transfer.commit
    if (transfer.phase !== 'receiving') throw new Error('Transfer is being aborted')
    console.log(`[Transfer:server] Committing transfer ${transfer.id.slice(0, 8)}: ${transfer.chunks.size}/${transfer.chunkCount} chunks received`)

    if (transfer.chunks.size !== transfer.chunkCount) {
      const missing: number[] = []
      for (let i = 0; i < transfer.chunkCount; i++) {
        if (!transfer.chunks.has(i)) missing.push(i)
      }
      throw new Error(`Missing ${missing.length} chunk(s): [${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}]`)
    }

    transfer.phase = 'committing'
    if (transfer.timer) clearTimeout(transfer.timer)
    transfer.timer = null
    transfer.commit = (async () => {
      await Promise.all([...transfer.chunks.values()].map(chunk => chunk.write))
      const buffers: Buffer[] = []
      for (let i = 0; i < transfer.chunkCount; i++) {
        const chunkPath = join(transfer.dir, `chunk-${String(i).padStart(6, '0')}`)
        const encoded = await readFile(chunkPath, 'utf-8')
        buffers.push(Buffer.from(encoded, 'base64'))
      }
      const reassembled = Buffer.concat(buffers)

      if (reassembled.length !== transfer.totalBytes) {
        throw new Error(`Payload size mismatch: expected ${transfer.totalBytes} bytes, got ${reassembled.length}`)
      }

      if (transfer.checksum) {
        const actual = createHash('sha256').update(reassembled).digest('hex')
        if (actual !== transfer.checksum) {
          console.error(`[Transfer:server] Checksum mismatch for ${transfer.id.slice(0, 8)}: expected ${transfer.checksum.slice(0, 12)}..., got ${actual.slice(0, 12)}...`)
          throw new Error(`Checksum mismatch: expected ${transfer.checksum.slice(0, 12)}..., got ${actual.slice(0, 12)}...`)
        }
        console.log(`[Transfer:server] Checksum verified: ${actual.slice(0, 12)}...`)
      }

      let payload: unknown
      try {
        payload = JSON.parse(reassembled.toString('utf-8'))
      } catch {
        throw new Error(`Failed to parse reassembled payload (${(reassembled.length / (1024 * 1024)).toFixed(1)}MB, ${transfer.chunkCount} chunks)`)
      }

      const handler = transferableHandlers.get(transfer.channel)
      if (!handler) {
        throw new Error(`No handler for channel: ${transfer.channel}`)
      }

      const reassembledMB = (reassembled.length / (1024 * 1024)).toFixed(1)
      console.log(`[Transfer:server] Reassembled ${reassembledMB}MB payload for ${transfer.channel} — executing handler`)

      const args = [...transfer.args]
      args[transfer.largeArgIndex] = payload

      return handler(ctx, ...validateRpcArguments(transfer.channel, args))
    })().finally(async () => {
      await removeTransferFiles(transfer)
      transfer.phase = 'completed'
      transfer.args = []
      transfer.chunks.clear()
      rescheduleTransferCleanup(transfer)
    })
    return transfer.commit
  })

  server.handle(RPC_CHANNELS.transfer.ABORT, async (ctx, opts: { transferId: string }) => {
    const transfer = activeTransfers.get(opts.transferId)
    if (!transfer) {
      return { aborted: false }
    }
    assertTransferOwner(ctx, transfer)
    if (transfer.phase !== 'receiving') return { aborted: false }
    await cleanupTransfer(transfer.id)
    console.warn(`[Transfer:server] Transfer aborted by client: ${transfer.id.slice(0, 8)}`)
    return { aborted: true }
  })
}
