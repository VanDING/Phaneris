import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { TaskSpecSchema, serializeTaskYaml, taskYamlPath } from '@phaneris/shared/tasks'
import { atomicWriteFileSync } from '@phaneris/shared/utils/files'
import type { SessionPlanningFields } from '@phaneris/shared/sessions'
export interface PreparedTaskPlanning {
  patch: Partial<SessionPlanningFields> & { parentSessionId?: string }
  statusId?: string
}
import { acquireWriterLease } from '../runtime/writer-lease'

const text = z.string(), optionalText = text.nullable().optional()
const planningPatch = z.object({
  description: optionalText, acceptanceCriteria: optionalText, startAt: optionalText, dueAt: optionalText,
  progress: z.number().nullable().optional(), dependencySessionIds: z.array(text).optional(),
  isMilestone: z.boolean().nullable().optional(), parentSessionId: optionalText,
})
const journalSchema = z.object({
  version: z.literal(1), id: text.regex(/^[a-f0-9-]{32,64}$/), workspaceId: text.min(1),
  intentHash: text, source: z.enum(['rpc', 'capture']), createdAt: z.number(),
  spec: TaskSpecSchema, target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('fresh') }),
    z.object({ kind: z.literal('attach'), sessionId: text.min(1) }), z.object({ kind: z.literal('draft'), sessionId: text.min(1) })]),
  resolvedTarget: z.discriminatedUnion('kind', [z.object({ kind: z.literal('fresh') }),
    z.object({ kind: z.literal('attach'), sessionId: text.min(1) }), z.object({ kind: z.literal('draft'), sessionId: text.min(1) })]),
  prepared: z.object({ patch: planningPatch, statusId: text.optional() }).optional(),
  // Baselines are compared only; they never become mutations or authority.
  baseline: z.record(text, z.unknown()), diskBaseline: z.record(text, z.unknown()).optional(), desired: z.record(text, z.unknown()),
  previousSpecHash: text.nullable(), specHash: text,
  stage: z.enum(['prepared', 'spec_written', 'bound', 'planned', 'complete']), sessionId: text.optional(),
  result: z.object({ slug: text, orchestratorSessionId: text, taskLabelId: text.optional(), warnings: z.array(text) }).optional(),
})
export type PublicationRecord = z.infer<typeof journalSchema>
export const publicationHash = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex')
export const publicationSpecHash = (spec: PublicationRecord['spec']): string => publicationHash(serializeTaskYaml(spec))
export function currentSpecHash(root: string, slug: string): string | null {
  const file = taskYamlPath(root, slug)
  if (!existsSync(file)) return null
  if (!statSync(file).isFile()) throw new Error(`Task publication destination is not a file: ${slug}`)
  return publicationHash(readFileSync(file))
}
export function writePublicationRecord(root: string, record: PublicationRecord): void {
  const directory = join(root, 'tasks', '.publications'); mkdirSync(directory, { recursive: true })
  atomicWriteFileSync(join(directory, record.id + '.json'), JSON.stringify(record) + '\n', { mode: 0o600 })
}
export function readPublicationRecords(root: string, workspaceId: string): PublicationRecord[] {
  const directory = join(root, 'tasks', '.publications')
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter(file => file.endsWith('.json')).map(file => {
    const record = journalSchema.parse(JSON.parse(readFileSync(join(directory, file), 'utf8')))
    if (record.workspaceId !== workspaceId || file !== record.id + '.json' || record.specHash !== publicationSpecHash(record.spec)) {
      throw new Error(`Task publication record identity or digest mismatch: ${file}`)
    }
    if (record.stage === 'complete' && !record.result) throw new Error(`Task publication has no completion receipt: ${file}`)
    return record
  }).sort((a, b) => a.createdAt - b.createdAt)
}
export function encodePreparedPlanning(planning: PreparedTaskPlanning | undefined): PublicationRecord['prepared'] {
  return planning && { statusId: planning.statusId, patch: Object.fromEntries(Object.entries(planning.patch).map(([key, value]) => [key, value ?? null])) }
}
export function decodePreparedPlanning(prepared: PublicationRecord['prepared']): PreparedTaskPlanning | undefined {
  return prepared && { statusId: prepared.statusId, patch: Object.fromEntries(Object.entries(prepared.patch).map(([key, value]) => [key, value === null ? undefined : value])) as PreparedTaskPlanning['patch'] }
}

/** A separate, data-free SQLite transaction holds only this domain's OS lock.
 * The runtime adapter supports Bun and Electron; process death releases the
 * lock without stale-PID reclamation or blocking the execution database. */
export async function withPublicationWriter<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const directory = join(root, 'tasks', '.publications'); mkdirSync(directory, { recursive: true })
  const release = acquireWriterLease(join(directory, 'writer.sqlite'))
  try { return await operation() } finally { release() }
}
