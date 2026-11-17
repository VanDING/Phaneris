/**
 * Transport-layer interfaces for the WS-based RPC.
 */

import type { PushTarget, RpcResult, RpcArguments, RpcMethodArguments, RPC_INPUT_CONTRACTS } from '@phaneris/shared/protocol'

export interface RequestContext {
  clientId: string
  workspaceId: string | null
  webContentsId: number | null
}

/** Registration erases each handler tuple; untrusted inputs are checked before dispatch. */
export type HandlerFn<Result = unknown> = { handle(ctx: RequestContext, ...args: unknown[]): Promise<Result> | Result }['handle']
export type RpcCallback = { receive(...args: unknown[]): void }['receive']
export type CapabilityHandler = { handle(...args: unknown[]): Promise<unknown> | unknown }['handle']

/** Known ports retain argument/result types until the transport erasure boundary. */
export type RegisteredHandler<Channel extends string> = Channel extends keyof typeof RPC_INPUT_CONTRACTS | keyof RpcMethodArguments
  ? (ctx: RequestContext, ...args: RpcArguments<Channel>) => Promise<RpcResult<Channel>> | RpcResult<Channel>
  : HandlerFn<RpcResult<Channel>>

export interface RpcServer {
  handle<Channel extends string>(channel: Channel, handler: RegisteredHandler<NoInfer<Channel>>): void
  push(channel: string, target: PushTarget, ...args: unknown[]): void
  invokeClient(clientId: string, channel: string, ...args: unknown[]): Promise<unknown>
  updateClientWorkspace?(clientId: string, workspaceId: string): void

  /** Whether a connected client advertised the given capability on handshake. */
  hasClientCapability(clientId: string, capability: string): boolean

  /** Connected clients (optionally narrowed by workspaceId) that advertised the capability. */
  findClientsWithCapability(capability: string, opts?: { workspaceId?: string }): string[]
}

export interface RpcClient {
  invoke<Channel extends string>(channel: Channel, ...args: unknown[]): Promise<RpcResult<Channel>>
  on(channel: string, callback: RpcCallback): () => void
  handleCapability(channel: string, handler: CapabilityHandler): void
}

export type EventSink = (channel: string, target: PushTarget, ...args: unknown[]) => void
