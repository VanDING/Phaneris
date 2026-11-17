import type { RpcServer } from './types'
import { RPC_CHANNELS as c } from '@phaneris/shared/protocol'

/** Compile-only acceptance cases. This function is never called. */
export function registrationContract(server: RpcServer): void {
  const register = server.handle
  register(c.workItems.DELETE, async (_ctx, workspaceId: string, itemId: string) => { void workspaceId; void itemId })
  register(c.residentAssistant.GET, (_ctx, workspaceId: string) => ({ id: workspaceId, workspaceId, name: 'Resident', workspaceName: 'Workspace', messages: [], lastMessageAt: 1, isProcessing: false }))
  register('extension:opaque', (_ctx, value: unknown) => value)
  // @ts-expect-error a known id argument is a string
  register(c.workItems.DELETE, (_ctx, workspaceId: number, itemId: string) => { void workspaceId; void itemId })
  // @ts-expect-error a void result port cannot silently accept a legacy boolean
  register(c.workItems.DELETE, async () => true)
  // @ts-expect-error known results cannot drift to a different DTO
  register(c.residentAssistant.GET, () => ({ wrong: true }))
  // @ts-expect-error schema inference must preserve the required string
  register(c.sessions.GET_MESSAGES, (_ctx, sessionId: number) => { void sessionId; return null })
  // @ts-expect-error the accepted receipt has a literal true and a message id
  register(c.sessions.SEND_MESSAGE, () => ({ accepted: false, messageId: 'bad' }))
  // @ts-expect-error Pages must retain its actual content reply shape
  register(c.pages.GET_CONTENT, () => 'html')
}
