/** Runtime checks at the untrusted RPC boundary. Unknown fields are retained for minor-version compatibility. */
import { z } from 'zod'
import { RPC_CHANNELS as c } from './channels'
import type { SendMessageOptions, FileAttachment, CredentialResponse } from './dto'
import { LlmConnectionSchema } from '../config/schemas'

const text = z.string()
const id = text.min(1)
const object = z.record(z.string(), z.unknown())
const strings = z.array(text)
const attachment: z.ZodType<FileAttachment> = z.object({
  type: z.enum(['image', 'text', 'pdf', 'office', 'audio', 'unknown']), path: text, name: text,
  mimeType: text, size: z.number().nonnegative(), base64: text.optional(), text: text.optional(),
  thumbnailBase64: text.optional(),
}).passthrough()
const sendOptions: z.ZodType<SendMessageOptions> = z.object({
  skillSlugs: strings.optional(), optimisticMessageId: text.optional(), hidden: z.boolean().optional(),
}).passthrough()
const credential: z.ZodType<CredentialResponse> = z.object({
  type: z.literal('credential'), cancelled: z.boolean(), value: text.optional(), username: text.optional(),
  password: text.optional(), headers: z.record(z.string(), text).optional(),
}).passthrough()
const scope = z.enum(['session', 'working']).optional()
// Extra positional fields remain readable by older/newer minor clients. Each known field is checked.
const tuple = (...items: z.ZodType[]) => {
  const checked = items.map(item => item.isOptional() ? item.nullable() : item)
  return (checked.length ? z.tuple(checked as [z.ZodType, ...z.ZodType[]]) : z.tuple([])).rest(z.unknown())
}
export const RPC_INPUT_CONTRACTS: Readonly<Record<string, z.ZodType<unknown[]>>> = {
  [c.sessions.SEND_MESSAGE]: tuple(id, text, z.array(attachment).optional(), z.array(object).optional(), sendOptions.optional()),
  [c.sessions.CREATE]: tuple(id, object.optional()),
  [c.sessions.DELETE]: tuple(id),
  [c.sessions.CANCEL]: tuple(id, z.boolean().optional()),
  [c.sessions.KILL_SHELL]: tuple(id, id),
  [c.sessions.RESPOND_TO_PERMISSION]: tuple(id, id, z.boolean(), z.boolean()),
  [c.sessions.RESPOND_TO_CREDENTIAL]: tuple(id, id, credential),
  [c.sessions.RESPOND_TO_ASK_USER]: tuple(id, id, object),
  [c.sessions.COMMAND]: tuple(id, object),
  [c.sessions.GET_MESSAGES]: tuple(id),
  [c.sessions.READ_MESSAGES]: tuple(id, object.optional()),
  [c.sessions.CLOSE_MESSAGES_READ]: tuple(id, id),
  [c.sessions.GET_RECOVERY_EVIDENCE]: tuple(id, id.optional()),
  [c.sessions.RECONCILE_TOOL]: tuple(id, id, object),
  [c.sessions.QUERY_RECONCILE_TOOL]: tuple(id, id),
  [c.sessions.RECONCILE_MODEL]: tuple(id, object),
  [c.sessions.GET_FILES]: tuple(id, scope),
  [c.sessions.WATCH_FILES]: tuple(id, scope),
  [c.sessions.UNWATCH_FILES]: tuple(scope),
  [c.sessions.GET_NOTES]: tuple(id),
  [c.sessions.SET_NOTES]: tuple(id, text),
  [c.sessions.EXPORT]: tuple(id),
  [c.sessions.IMPORT]: tuple(id, z.unknown(), z.enum(['move', 'fork'])),
  [c.sessions.EXPORT_REMOTE_TRANSFER]: tuple(id),
  [c.sessions.IMPORT_REMOTE_TRANSFER]: tuple(id, object),
  [c.file.RESOLVE]: tuple(text, id.optional(), text.optional()),
  [c.file.READ]: tuple(text),
  [c.file.READ_DATA_URL]: tuple(text),
  [c.file.READ_PREVIEW_DATA_URL]: tuple(text, z.number().positive().optional()),
  [c.file.READ_BINARY]: tuple(text),
  [c.file.OPEN_DIALOG]: tuple(),
  [c.file.READ_ATTACHMENT]: tuple(text),
  [c.file.READ_USER_ATTACHMENT]: tuple(text),
  [c.file.STORE_ATTACHMENT]: tuple(id, attachment),
  [c.file.GENERATE_THUMBNAIL]: tuple(text, text),
  [c.plugins.LIST]: tuple(id),
  [c.plugins.ANALYZE_INSTALL]: tuple(id, text),
  [c.plugins.INSTALL]: tuple(id, text),
  [c.plugins.ANALYZE_UNINSTALL]: tuple(id, id),
  [c.plugins.UNINSTALL]: tuple(id, id),
  [c.credentials.HEALTH_CHECK]: tuple(),
  [c.transfer.START]: tuple(z.object({ totalBytes: z.number().int().nonnegative(), chunkCount: z.number().int().positive(),
    channel: id, args: z.array(z.unknown()), largeArgIndex: z.number().int().nonnegative(), checksum: text.optional() }).passthrough()),
  [c.transfer.CHUNK]: tuple(z.object({ transferId: id, index: z.number().int().nonnegative(), data: text.min(1) }).passthrough()),
  [c.transfer.COMMIT]: tuple(z.object({ transferId: id }).passthrough()),
  [c.transfer.ABORT]: tuple(z.object({ transferId: id }).passthrough()),
  [c.sources.SAVE_CREDENTIALS]: tuple(id, id, text),
  [c.sources.START_OAUTH]: tuple(),
  [c.llmConnections.SAVE]: tuple(LlmConnectionSchema),
  [c.llmConnections.GET_API_KEY]: tuple(id),
  [c.llmConnections.DELETE]: tuple(id),
  [c.llmConnections.SET_DEFAULT]: tuple(id),
}

export function validateRpcArguments(channel: string, args: unknown): unknown[] {
  if (!Array.isArray(args)) throw new Error(`Invalid RPC arguments for ${channel}: expected array`)
  const contract = RPC_INPUT_CONTRACTS[channel]
  if (contract) {
    const result = contract.safeParse(args)
    if (!result.success) throw new Error(`Invalid RPC arguments for ${channel}: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  }
  // Validate without stripping fields, coercing values or replacing existing domain validation.
  return args
}
