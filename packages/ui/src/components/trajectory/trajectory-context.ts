import type { Message } from '@phaneris/core/types'
import type { TrajectorySnapshot } from './trajectory-contract'
import { attributeContextTokens } from './trajectory-context-accounting'

/**
 * Context categories the Run view reports.
 *
 * Seven content categories plus an unattributed metering remainder, so the composition answers
 * "what occupies the context" instead of collapsing everything into one
 * "tools" bucket:
 *   · system    — the captured system prompt (exact text + manifest chars)
 *   · schemas   — registered tool definitions from the request manifest
 *   · user      — user message text (attachments stay inside their message)
 *   · inject    — runtime-injected status/info/plan records
 *   · skill     — SKILL.md content the model read through a tool call
 *   · assistant — assistant responses and commentary
 *   · tool      — tool calls and their results
 *
 * `schemas` and `tool` used to share one category even though the manifest
 * records definitions separately from results. `skill` is derived only from a
 * recorded read of a `SKILL.md` file; nothing is inferred from a name alone.
 */
export type TrajectoryContextCategory = 'system' | 'schemas' | 'user' | 'inject' | 'skill' | 'assistant' | 'tool' | 'unknown'

export interface TrajectoryContextItem {
  id: string
  category: TrajectoryContextCategory
  /** Data-derived title; empty when the view composes one from the category. */
  label: string
  /** Secondary source descriptor (file basename, tool name, prompt version). */
  source?: string
  content: string
  /** Request-time semantic fingerprint, when captured separately from retained text. */
  contentHash?: string
  chars: number
  estimatedTokens: number
  imageCount?: number
  messageId?: string
  callId?: string
  filePath?: string
  /** Tool records keep their recorded outcome for the reader's fact row. */
  toolName?: string
  toolArguments?: Record<string, unknown>
  toolResult?: string
  timestamp?: number
  toolStatus?: 'succeeded' | 'failed'
  durationSeconds?: number
  /** 1-based request ordinal that first included this item. */
  introducedSeq?: number
  /** Prompt version for the system-prompt item. */
  promptVersion?: number
}

export interface TrajectoryContextGroup {
  category: TrajectoryContextCategory
  items: readonly TrajectoryContextItem[]
  chars: number
  /** Independent text estimate; never rescaled to provider input. */
  estimatedTokens: number
  /** Metered-total attribution; null means insufficient evidence to classify. */
  attributedTokens?: number | null
  /** Images are counted separately; input deltas may constrain their category's cost. */
  imageCount: number
  /** Share of attributed input, or of text estimates when metering is missing. */
  share: number
}

export interface TrajectoryRequestContext {
  /** Assistant message identity; stable even when provider sequence restarts. */
  id: string
  /** Stable 1-based display order in the persisted message stream. */
  requestSeq: number
  /** Provider/runtime sequence retained for diagnostics. */
  sourceRequestSeq: number
  promptVersion: number
  /** Exact provider input tokens when recorded; category values remain estimates. */
  inputTokens?: number
  /** Provider cache reads; cache writes are input, but are not cache hits. */
  cacheReadTokens?: number
  groups: readonly TrajectoryContextGroup[]
  totalChars: number
  estimatedTokens: number
  captured: boolean
  provider?: string
  model?: string
}

export interface TrajectoryContextGrowthBucket {
  id: string
  startSeq: number
  endSeq: number
  /** Request represented by the peak value, used for drill-down. */
  requestSeq: number
  value: number
}

export type TrajectoryContextEventKind = 'compaction' | 'prompt'

export interface TrajectoryContextEvent {
  kind: TrajectoryContextEventKind
  /** Request the change is first observable in. */
  requestSeq: number
  /** Net token change at that request, when both totals are known. */
  deltaTokens?: number
}

export const CONTEXT_CATEGORY_ORDER: readonly TrajectoryContextCategory[] = [
  'system', 'schemas', 'user', 'inject', 'skill', 'assistant', 'tool', 'unknown',
]

export function contextGroupTokens(group: TrajectoryContextGroup): number | undefined {
  return group.attributedTokens === null ? undefined : group.attributedTokens ?? group.estimatedTokens
}

function tokenEstimate(content: string): number {
  return content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4))
}

function charsToTokens(chars: number): number {
  return chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 4))
}

function safeJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** The skill mechanism reads `SKILL.md`; an unrelated file named by the call is not skill content. */
function skillPath(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (!toolInput) return undefined
  for (const key of ['path', 'file_path', 'filePath']) {
    const value = toolInput[key]
    if (typeof value === 'string' && /(^|[\\/])SKILL\.md$/i.test(value)) return value
  }
  return undefined
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function toolCallSummary(message: Message): string {
  const input = message.toolInput
  if (!input) return ''
  const preferred = ['path', 'file_path', 'filePath', 'command', 'pattern', 'query', 'url', 'description']
  for (const key of preferred) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim().split('\n')[0]!.slice(0, 72)
  }
  return ''
}

function firstLine(content: string, maximum = 88): string {
  const line = content.split('\n').find(entry => entry.trim())?.trim() ?? ''
  return line.length > maximum ? `${line.slice(0, maximum - 1)}…` : line
}

function item(category: TrajectoryContextCategory, message: Message, label: string, content: string): TrajectoryContextItem {
  const filePath = message.badges?.find(badge => badge.filePath)?.filePath
    ?? message.attachments?.[0]?.storedPath
  return {
    id: `${category}:${message.id}`,
    category,
    label,
    content,
    chars: content.length,
    estimatedTokens: tokenEstimate(content),
    messageId: message.id,
    timestamp: message.timestamp,
    callId: message.toolUseId,
    filePath,
  }
}

function messageItems(message: Message): TrajectoryContextItem[] {
  switch (message.role) {
    case 'user': {
      // Attachments belong to the user message that carried them: they were sent
      // as part of it, and the manifest cannot separate their bytes afterwards.
      const attachments = (message.attachments ?? []).map(attachment => (
        `[attachment] ${attachment.name} · ${attachment.mimeType} · ${attachment.size} bytes`
      ))
      const content = [message.content, ...attachments].filter(Boolean).join('\n')
      return [item('user', message, firstLine(message.content), content)]
    }
    case 'assistant': {
      const blocks = message.outputBlocks?.filter(block => block.type === 'text' || block.type === 'thinking') ?? []
      const parts = blocks.map(block => block.content)
      if (!blocks.some(block => block.type === 'text') && message.content) parts.push(message.content)
      const content = parts.join('\n\n')
      return [item('assistant', message, firstLine(message.content || content), content)]
    }
    case 'tool': {
      const skill = skillPath(message.toolInput)
      const input = safeJson(message.toolInput)
      const result = message.toolResult ?? message.content
      const content = [input, result].filter(Boolean).join('\n\n')
      const entry = item(skill ? 'skill' : 'tool', message, '', content)
      entry.toolName = message.toolName
      entry.toolArguments = message.toolInput
      entry.toolResult = result
      entry.toolStatus = message.isError || message.toolStatus === 'error' ? 'failed'
        : message.toolStatus === 'completed' ? 'succeeded' : undefined
      entry.durationSeconds = message.toolDuration === undefined ? undefined : message.toolDuration / 1000
      if (skill) {
        entry.filePath = skill
        entry.source = basename(skill)
      } else {
        const summary = toolCallSummary(message)
        if (summary) entry.source = basename(summary)
      }
      entry.label = [message.toolName ?? message.toolDisplayName ?? 'Tool', entry.source].filter(Boolean).join(' · ')
      return [entry]
    }
    case 'error':
      return [item('inject', message, message.errorTitle ?? firstLine(message.content), message.content)]
    default:
      return [item('inject', message, message.statusType ?? message.role, message.content)]
  }
}

/**
 * Reconstruct the observable request context from persisted session evidence.
 *
 * Metering and content are independent. New manifests count semantic text and
 * images separately. Legacy manifests serialized entire messages, including
 * binary encodings and metadata, so only their retained text is safe to estimate.
 * No category or retained item is normalized to a request's measured input.
 * Retained output and input increments constrain attribution; uncertainty stays
 * in a visible remainder rather than changing unrelated categories.
 */
export function deriveRequestContexts(snapshot: TrajectorySnapshot): readonly TrajectoryRequestContext[] {
  const contexts: TrajectoryRequestContext[] = []
  const accumulated: TrajectoryContextItem[] = []
  const promptVersions = new Map<string, number>()
  let requestOrdinal = 0
  let previousRequest: Message | undefined

  for (const message of snapshot.messages) {
    if (message.role === 'assistant' && message.requestSeq !== undefined) {
      requestOrdinal += 1
      const prompt = snapshot.prompts.get(requestOrdinal) ?? message.promptSnapshot ?? ''
      let promptVersion = promptVersions.get(prompt)
      if (promptVersion === undefined) {
        promptVersion = promptVersions.size + 1
        promptVersions.set(prompt, promptVersion)
      }
      const systemItem: TrajectoryContextItem = {
        id: `system:${message.id}`,
        category: 'system',
        label: '',
        content: prompt,
        chars: prompt.length,
        estimatedTokens: tokenEstimate(prompt),
        introducedSeq: requestOrdinal,
        promptVersion,
      }
      const manifest = message.contextSnapshot
      const registeredTools: TrajectoryContextItem[] = (manifest?.tools ?? []).map((tool, index) => {
        const description = tool.description ?? ''
        return {
          id: `tool-definition:${message.id}:${index}`,
          category: 'schemas',
          label: tool.name,
          content: description,
          contentHash: tool.hash,
          chars: tool.schemaChars + description.length,
          estimatedTokens: charsToTokens(tool.schemaChars + description.length),
          introducedSeq: requestOrdinal,
        }
      })
      const hasContentMetrics = manifest?.system.textChars !== undefined && manifest.messages.every(entry => entry.content !== undefined)
      const observedCalls = new Map(manifest?.messages.filter(entry => entry.toolCallId && entry.content)
        .map(entry => [entry.toolCallId, entry.content!]))
      const toolCalls = hasContentMetrics ? manifest.messages.flatMap(entry => entry.content?.toolCalls ?? []) : []
      const argumentsByCall = new Map(toolCalls.map(call => [call.id, call]))
      const retained = accumulated.map(entry => {
        const observed = entry.callId ? observedCalls.get(entry.callId) : undefined
        const args = entry.callId ? argumentsByCall.get(entry.callId) : undefined
        return observed ? { ...entry, contentHash: `${observed.hash}:${args?.hash ?? ''}`,
          estimatedTokens: charsToTokens(observed.textChars) + charsToTokens(args?.textChars ?? 0), imageCount: observed.imageCount } : entry
      })
      const allItems = [systemItem, ...registeredTools, ...retained]
      const callCategories = new Map(retained.filter(entry => entry.callId).map(entry => [entry.callId, entry.category]))
      const observedCategory = (entry: NonNullable<Message['contextSnapshot']>['messages'][number]): TrajectoryContextCategory | undefined => {
        if (entry.role === 'user' || entry.role === 'assistant') return entry.role
        if (['tool', 'toolResult', 'tool_result'].includes(entry.role)) return entry.toolCallId ? callCategories.get(entry.toolCallId) ?? 'tool' : 'tool'
        return undefined
      }
      const measured = message.usage ? message.usage.input + message.usage.cacheRead + message.usage.cacheWrite : undefined
      const inputTokens = measured !== undefined && Number.isFinite(measured) && measured >= 0 ? Math.round(measured) : undefined
      const groups = CONTEXT_CATEGORY_ORDER.map(category => {
        const items = allItems.filter(entry => entry.category === category)
        const itemChars = items.reduce((sum, entry) => sum + entry.chars, 0)
        const observed = hasContentMetrics && !['system', 'schemas', 'inject'].includes(category)
          ? manifest.messages.filter(entry => observedCategory(entry) === category) : undefined
        const calls = toolCalls.filter(call => (callCategories.get(call.id) ?? 'tool') === category)
        const argumentChars = calls.reduce((sum, call) => sum + call.textChars, 0)
        const chars = category === 'system'
          ? manifest?.system.textChars ?? itemChars
          : observed ? observed.reduce((sum, entry) => sum + entry.content!.textChars, argumentChars) : itemChars
        return {
          category,
          items,
          chars,
          estimatedTokens: observed ? observed.reduce((sum, entry) => sum + charsToTokens(entry.content!.textChars), calls.reduce((sum, call) => sum + charsToTokens(call.textChars), 0))
            : category === 'system' ? charsToTokens(chars) : items.reduce((sum, entry) => sum + entry.estimatedTokens, 0),
          imageCount: observed ? observed.reduce((sum, entry) => sum + entry.content!.imageCount, 0)
            : items.reduce((sum, entry) => sum + (entry.imageCount ?? 0), 0),
          share: 0,
        }
      }).filter(group => group.items.length > 0 || group.chars > 0 || group.imageCount > 0)
      const estimated = groups.reduce((sum, group) => sum + group.estimatedTokens, 0)
      const context: TrajectoryRequestContext = {
        id: message.id,
        requestSeq: requestOrdinal,
        sourceRequestSeq: message.requestSeq,
        promptVersion,
        inputTokens,
        cacheReadTokens: message.usage?.cacheRead,
        groups: groups.map(group => ({ ...group, share: estimated > 0 ? group.estimatedTokens / estimated : 0 })),
        totalChars: groups.reduce((sum, group) => sum + group.chars, 0),
        estimatedTokens: estimated,
        captured: manifest !== undefined,
        provider: manifest?.provider,
        model: manifest?.model,
      }
      context.groups = attributeContextTokens(context, contexts.at(-1), message, previousRequest)
      contexts.push(context)
      previousRequest = message
    }
    // The message lands after this request's snapshot, so it first becomes
    // visible in the request that follows (ordinal + 1).
    accumulated.push(...messageItems(message).map(entry => ({
      ...entry,
      introducedSeq: entry.introducedSeq ?? requestOrdinal + 1,
    })))
  }
  return contexts
}

/**
 * Keep long context histories within a bounded chart while retaining peaks.
 * Buckets are distributed evenly so both ends of the run remain represented.
 */
export function bucketRequestContexts(
  contexts: readonly TrajectoryRequestContext[],
  maxBuckets = 72,
): readonly TrajectoryContextGrowthBucket[] {
  if (contexts.length === 0 || maxBuckets <= 0) return []
  const bucketCount = Math.min(contexts.length, Math.floor(maxBuckets))
  return Array.from({ length: bucketCount }, (_, bucketIndex) => {
    const startIndex = Math.floor((bucketIndex * contexts.length) / bucketCount)
    const endIndex = Math.floor(((bucketIndex + 1) * contexts.length) / bucketCount)
    const entries = contexts.slice(startIndex, endIndex)
    const peak = entries.reduce((selected, context) => {
      const value = context.inputTokens ?? context.estimatedTokens
      const selectedValue = selected.inputTokens ?? selected.estimatedTokens
      return value >= selectedValue ? context : selected
    })
    const first = entries[0]!
    const last = entries[entries.length - 1]!
    return {
      id: `${first.id}:${last.id}`,
      startSeq: first.requestSeq,
      endSeq: last.requestSeq,
      requestSeq: peak.requestSeq,
      value: peak.inputTokens ?? peak.estimatedTokens,
    }
  })
}

export function requestContextDelta(
  current: TrajectoryRequestContext,
  previous: TrajectoryRequestContext | undefined,
): number | undefined {
  if (!previous) return undefined
  if ((current.inputTokens === undefined) !== (previous.inputTokens === undefined)) return undefined
  const currentValue = current.inputTokens ?? current.estimatedTokens
  const previousValue = previous.inputTokens ?? previous.estimatedTokens
  return currentValue - previousValue
}

export function contextTotal(context: TrajectoryRequestContext): number {
  return context.inputTokens ?? context.estimatedTokens
}

export function findContextItem(context: TrajectoryRequestContext, itemId: string): TrajectoryContextItem | undefined {
  for (const group of context.groups) {
    const found = group.items.find(entry => entry.id === itemId)
    if (found) return found
  }
  return undefined
}

/**
 * Compactions and prompt-version changes, mapped to the request where the change
 * first becomes visible. A compaction is attributed to the request that follows
 * it; the last request is used when the compaction has no successor yet.
 */
export function deriveRequestContextEvents(
  snapshot: TrajectorySnapshot,
  contexts: readonly TrajectoryRequestContext[],
): readonly TrajectoryContextEvent[] {
  if (contexts.length === 0) return []
  const events: TrajectoryContextEvent[] = []
  const requestAt = new Map<string, number>()
  let ordinal = 0
  for (const message of snapshot.messages) {
    if (message.role === 'assistant' && message.requestSeq !== undefined) ordinal += 1
    requestAt.set(message.id, ordinal)
  }
  const deltaAt = (requestSeq: number) => {
    const index = contexts.findIndex(context => context.requestSeq === requestSeq)
    const previous = index > 0 ? contexts[index - 1] : undefined
    const current = contexts[index]
    if (!current) return undefined
    return requestContextDelta(current, previous)
  }
  for (const contribution of snapshot.contributions) {
    if (contribution.kind !== 'compaction') continue
    const before = requestAt.get(contribution.message.id) ?? contexts.length
    const requestSeq = Math.min(contexts.length, Math.max(1, before + 1))
    events.push({ kind: 'compaction', requestSeq, deltaTokens: deltaAt(requestSeq) })
  }
  for (let index = 1; index < contexts.length; index += 1) {
    if (contexts[index]!.promptVersion !== contexts[index - 1]!.promptVersion) {
      events.push({ kind: 'prompt', requestSeq: contexts[index]!.requestSeq })
    }
  }
  return events.sort((a, b) => a.requestSeq - b.requestSeq)
}
