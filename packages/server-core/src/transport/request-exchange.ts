import type { MessageEnvelope, RpcResult } from '@phaneris/shared/protocol'
import { serializeEnvelope } from './codec'

export function createRpcMessageId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Browser preloads may run before a secure navigation enables randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface PendingRequest {
  channel: string
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

/** Exchange on an established connection; never reconnects or retries effects. */
export class RpcRequestExchange {
  private pending = new Map<string, PendingRequest>()
  get pendingCount(): number { return this.pending.size }

  request<Channel extends string>(channel: Channel, args: unknown[], options: {
    timeoutMs: number
    write(wire: string, envelope: MessageEnvelope): void
  }): Promise<RpcResult<Channel>> {
    return new Promise<unknown>((resolve, reject) => {
      const id = createRpcMessageId()
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timeout: ${channel} (${options.timeoutMs}ms)`))
      }, options.timeoutMs)
      this.pending.set(id, { channel, resolve, reject, timeout })
      const envelope: MessageEnvelope = { id, type: 'request', channel, args }
      try { options.write(serializeEnvelope(envelope), envelope) }
      catch (error) {
        this.pending.delete(id)
        clearTimeout(timeout)
        reject(error instanceof Error ? error : new Error('Failed to write request'))
      }
    }) as Promise<RpcResult<Channel>>
  }

  accept(envelope: MessageEnvelope): boolean {
    if (envelope.type !== 'response') return false
    const request = this.pending.get(envelope.id)
    if (!request) return false
    this.pending.delete(envelope.id)
    clearTimeout(request.timeout)
    if (envelope.error) {
      const error = Object.assign(new Error(envelope.error.message), { code: envelope.error.code, data: envelope.error.data })
      request.reject(error)
    } else request.resolve(envelope.result)
    return true
  }

  disconnect(reason: Error | ((channel: string) => Error)): void {
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const request of requests) {
      clearTimeout(request.timeout)
      request.reject(typeof reason === 'function' ? reason(request.channel) : reason)
    }
  }
}
