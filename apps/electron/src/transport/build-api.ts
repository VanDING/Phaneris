/**
 * Build the client API proxy.
 *
 * Replaces the 329-line preload. The ElectronAPI TypeScript interface still
 * enforces types at compile time — this proxy provides runtime dispatch.
 */

import type { RpcClient } from '@phaneris/server-core/transport'
import { readSessionSnapshot } from '@phaneris/server-core/transport/session-read-client'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import type { ElectronAPI } from '../shared/types'

// ---------------------------------------------------------------------------
// Channel map entry
// ---------------------------------------------------------------------------

export type ChannelMapEntry =
  | { type: 'invoke'; channel: string; transform?: (result: unknown) => unknown }
  | { type: 'listener'; channel: string }

export type ChannelMap = Record<string, ChannelMapEntry>

// ---------------------------------------------------------------------------
// Proxy builder
// ---------------------------------------------------------------------------

export function buildClientApi(
  client: RpcClient,
  channelMap: ChannelMap,
  isChannelAvailable?: (channel: string) => boolean,
): ElectronAPI {
  const api: Record<string, unknown> = {}
  const nested: Record<string, Record<string, unknown>> = {}

  for (const [key, entry] of Object.entries(channelMap)) {
    let fn: (...a: unknown[]) => unknown
    if (entry.type === 'listener') {
      fn = (...args: unknown[]) => {
        const cb = args[0]
        if (typeof cb !== 'function') throw new TypeError(`Listener ${key} requires a callback`)
        return client.on(entry.channel, cb as import('@phaneris/server-core/transport').RpcCallback)
      }
    } else if (entry.channel === RPC_CHANNELS.sessions.GET_MESSAGES) {
      fn = (...args: unknown[]) => {
        if (typeof args[0] !== 'string') throw new TypeError('Session id must be a string')
        return readSessionSnapshot(client, args[0], isChannelAvailable)
      }
    } else if (entry.transform) {
      const t = entry.transform
      fn = async (...args: unknown[]) => t(await client.invoke(entry.channel, ...args))
    } else {
      fn = (...args: unknown[]) => client.invoke(entry.channel, ...args)
    }

    // Dotted keys like "browserPane.create" become nested: api.browserPane.create
    const dotIdx = key.indexOf('.')
    if (dotIdx !== -1) {
      const ns = key.slice(0, dotIdx)
      const method = key.slice(dotIdx + 1)
      if (!nested[ns]) nested[ns] = {}
      nested[ns][method] = fn
    } else {
      api[key] = fn
    }
  }

  // Attach nested namespaces as plain objects
  for (const [ns, methods] of Object.entries(nested)) {
    api[ns] = methods
  }

  // Expose channel availability check for GUI-aware code
  api.isChannelAvailable = isChannelAvailable ?? (() => true)

  return api as unknown as ElectronAPI
}
