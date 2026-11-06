import { createHash } from 'node:crypto'
import { loadSource, isSourceUsable } from '../sources/index'
import { loadSourcePermissionsConfig } from './permissions-config'
import { canonicalJson } from '../durable-runtime/identity'
import { z } from 'zod'
import type { KnowledgeMaterialReference } from '@phaneris/core/types'

const returnedText = z.object({ type: z.string(), text: z.string().optional() }).passthrough()
const toolResult = z.object({ content: z.union([z.string(), z.array(returnedText)]).optional(), contentBlocks: z.array(returnedText).optional() }).passthrough()
const readEnvelope = z.object({ reference: z.object({ sourceSlug: z.string(), sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough(), content: z.string() }).passthrough()

/** Called only with committed T2 outcomes and their Host-attributed operation/arguments. */
export function knowledgeFromToolOutcome(name: string, args: Record<string, unknown>, result: unknown): KnowledgeMaterialReference[] {
  const slug = name === 'mcp__session__source_read_resource' && typeof args.sourceSlug === 'string' ? args.sourceSlug : name.match(/^mcp__([a-z0-9-]+)__/i)?.[1]
  if (!slug || slug === 'session') return []
  const parsed = toolResult.safeParse(result)
  const texts = typeof result === 'string' ? [result] : parsed.success ? [
    ...(typeof parsed.data.content === 'string' ? [parsed.data.content] : parsed.data.content?.flatMap(block => block.type === 'text' && block.text ? [block.text] : []) ?? []),
    ...parsed.data.contentBlocks?.flatMap(block => block.type === 'text' && block.text ? [block.text] : []) ?? [],
  ] : []
  for (const text of texts) {
    let raw: unknown
    try { raw = JSON.parse(text) } catch { continue }
    const envelope = readEnvelope.safeParse(raw)
    if (envelope.success && envelope.data.reference.sourceSlug === slug
      && createHash('sha256').update(envelope.data.content).digest('hex') === envelope.data.reference.resultHash) {
      return [{ sourceSlug: slug, version: envelope.data.reference.sourceVersion }]
    }
  }
  return []
}

/** Connection/policy identity only. Never exposes credentials or invents a remote document revision. */
export function knowledgeSourceVersion(root: string, slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid knowledge source identity')
  const source = loadSource(root, slug)
  if (!source || !isSourceUsable(source)) throw new Error('Knowledge source is unavailable, disabled or unauthenticated; this is not a no-match result')
  const { id, type, provider, enabled, isAuthenticated, mcp, api, local, pluginRoot } = source.config
  return createHash('sha256').update(canonicalJson({ id, type, provider, enabled, isAuthenticated, mcp, api, local, pluginRoot,
    permissions: loadSourcePermissionsConfig(root, slug) })).digest('hex')
}

export function knowledgeReadReference(input: { sourceSlug: string; sourceVersion: string; content: string; title: string; uri?: string }) {
  return { sourceSlug: input.sourceSlug, sourceVersion: input.sourceVersion, title: input.title, uri: input.uri ?? null, readAt: Date.now(),
    resultHash: createHash('sha256').update(input.content).digest('hex'), freshness: 'observed_snapshot' as const,
    versionScope: 'Returned representation only; re-read the original source to verify remote updates.',
    coverage: 'This result only; linked documents and omitted content have not been read.' }
}
