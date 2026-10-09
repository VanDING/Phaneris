/**
 * Large tool results via the decision model (feature toggle `largeResults`).
 *
 * A tool result too large for the context is always saved to a file. When the agent
 * stated what it is after (`_intent`), the result is split into parts (the items of
 * its main JSON array, otherwise paragraphs and lines) and the model judges, part by
 * part, which ones the intent needs (`relevance.ts`). The agent then gets those parts
 * and the saved file instead of a multi-second summary. No answer, too few parts,
 * nothing relevant or nearly everything relevant: summarize as before. The follow-up
 * records only an exact-path access attempt. Neither access nor absence of
 * access is evidence of answer quality or filtering accuracy.
 */

import { normalize } from 'node:path'
import { LARGE_RESULT_MAX_TEXT_CHARS, LARGE_RESULT_FILTER_DEADLINE_MS, type LargeResultFilter } from '@phaneris/shared/utils'
import type { DecisionResult } from '@phaneris/shared/decisions'
import { openDecisionPoint, recordDecisionFollowUp, recordDecisionOutcome, type DecisionPointDeps } from './decision-point'
import { scoreRelevance } from './relevance'

/** P(needed) at or above which a part is kept. */
export const LARGE_RESULT_KEEP_AT = 0.5
/** Target part size for text, in characters. */
export const LARGE_RESULT_PART_CHARS = 1_500
/**
 * JSON items are judged one by one (relevant items are often spread through a list, so
 * groups would all look relevant); only items shorter than this are grouped.
 */
export const LARGE_RESULT_ITEM_CHARS = 300
/** A single item or line longer than this is cut, so one part never fills a call. */
const MAX_PIECE_CHARS = 12_000
/** Fewer parts than this: nothing worth filtering. */
export const LARGE_RESULT_MIN_PARTS = 4
/** More than this share of the parts relevant: filtering would not help. */
export const LARGE_RESULT_MAX_KEPT_SHARE = 0.9

const chunk = (text: string, size: number): string[] => {
  if (text.length <= size) return [text]
  const pieces: string[] = []
  for (let start = 0; start < text.length; start += size) pieces.push(text.slice(start, start + size))
  return pieces
}

/** Consecutive pieces joined into parts of about `partChars`. */
function group(pieces: readonly string[], partChars: number): string[] {
  const parts: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + 1 + piece.length > partChars) {
      parts.push(current)
      current = ''
    }
    current = current ? `${current}\n${piece}` : piece
  }
  if (current) parts.push(current)
  return parts
}

/** The items of the largest array in a JSON result (itself or up to two levels down) and the rest of it. */
function splitJsonArray(text: string): { header: string; items: string[] } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (Array.isArray(parsed)) return { header: '', items: parsed.map(item => JSON.stringify(item)) }
  if (!parsed || typeof parsed !== 'object') return null
  let best: { parent: Record<string, unknown>; key: string; size: number } | null = null
  const visit = (node: Record<string, unknown>, depth: number) => {
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        const size = JSON.stringify(value).length
        if (!best || size > best.size) best = { parent: node, key, size }
      } else if (value && typeof value === 'object' && depth < 2) {
        visit(value as Record<string, unknown>, depth + 1)
      }
    }
  }
  visit(parsed as Record<string, unknown>, 0)
  const found = best as { parent: Record<string, unknown>; key: string; size: number } | null
  // Not array-shaped: the array is not most of the result.
  if (!found || found.size < text.length / 2) return null
  const items = (found.parent[found.key] as unknown[]).map(item => JSON.stringify(item))
  found.parent[found.key] = `[${items.length} items, the relevant ones follow]`
  return { header: JSON.stringify(parsed), items }
}

/**
 * Split a result into parts: the items of a JSON list, or text cut into about `partChars`
 * (a markdown heading always starts a new part, so a section is never hidden in its
 * neighbour). The first part (the rest of a JSON object around its list, or the start of
 * a text) is always kept.
 */
export function splitLargeResult(text: string, partChars: number = LARGE_RESULT_PART_CHARS): string[] {
  const json = splitJsonArray(text)
  if (json) {
    const items = group(json.items.flatMap(item => chunk(item, MAX_PIECE_CHARS)), LARGE_RESULT_ITEM_CHARS)
    return json.header ? [json.header, ...items] : items
  }
  return text.split(/\n(?=#{1,6} )/).flatMap(section => group(
    section
      .split(/\n\s*\n/)
      .flatMap(paragraph => (paragraph.length <= partChars ? [paragraph] : paragraph.split('\n')))
      .flatMap(line => chunk(line, MAX_PIECE_CHARS)),
    partChars,
  ))
}

export type LargeResultChoice = { kept: number[] } | { reason: 'none_relevant' | 'nearly_all_relevant' | 'over_budget' }

/**
 * The first part plus the parts at or above `LARGE_RESULT_KEEP_AT`, in their original
 * order; over `budgetChars`, the most relevant ones that fit. A reason instead when
 * filtering would not help.
 */
export function chooseRelevantParts(parts: readonly string[], scores: readonly number[], budgetChars: number, render: (kept: number[]) => string = kept => formatExcerpt(parts, kept)): LargeResultChoice {
  const relevant = scores
    .map((score, index) => ({ score, index }))
    .filter(({ score, index }) => index > 0 && score >= LARGE_RESULT_KEEP_AT)
  if (relevant.length === 0) return { reason: 'none_relevant' }
  if (relevant.length > LARGE_RESULT_MAX_KEPT_SHARE * (parts.length - 1)) return { reason: 'nearly_all_relevant' }
  const kept = [0]
  if (render(kept).length > budgetChars) return { reason: 'over_budget' }
  for (const { index } of relevant.sort((a, b) => b.score - a.score)) {
    if (render([...kept, index].sort((a, b) => a - b)).length > budgetChars) continue
    kept.push(index)
  }
  if (kept.length === 1) return { reason: 'over_budget' }
  return { kept: kept.sort((a, b) => a - b) }
}

const omitted = (count: number) => `[… ${count} part${count === 1 ? '' : 's'} left out, see the saved file …]`

/** The kept parts in order, with each gap marked. */
export function formatExcerpt(parts: readonly string[], kept: readonly number[]): string {
  const lines: string[] = []
  let next = 0
  for (const index of kept) {
    if (index > next) lines.push(omitted(index - next))
    lines.push(parts[index]!)
    next = index + 1
  }
  if (next < parts.length) lines.push(omitted(parts.length - next))
  return lines.join('\n')
}

/** Filtered results per session whose saved file the agent has not opened yet. */
const openExcerpts = new Map<string, { result: DecisionResult; filePath: string }[]>()
const canonicalPath = (path: string) => {
  const normalized = normalize(path.replaceAll('\\', '/')).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Host filter for `setLargeResultFilter`. Never throws. */
export function buildLargeResultFilter(deps: DecisionPointDeps & { totalDeadlineMs?: number } = {}): LargeResultFilter {
  return async ({ text, context, budgetChars, filePath, sessionId, signal }) => {
    if (!context.intent?.trim() || text.length > LARGE_RESULT_MAX_TEXT_CHARS || !Number.isFinite(budgetChars) || budgetChars < 1 || signal?.aborted) return null
    const abort = new AbortController()
    const cancel = () => abort.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, Math.min(LARGE_RESULT_FILTER_DEADLINE_MS, Math.max(1, deps.totalDeadlineMs ?? LARGE_RESULT_FILTER_DEADLINE_MS)))
    const operation = async () => {
      const parts = splitLargeResult(text)
      if (parts.length < LARGE_RESULT_MIN_PARTS) return null
      const decide = await openDecisionPoint({ ...deps, feature: 'largeResults', record: 'large_results', sessionId })
      if (!decide || abort.signal.aborted) return null
      const scored = await scoreRelevance(decide, context.intent!, parts, { tool: context.toolName }, abort.signal)
      if (!scored || abort.signal.aborted) return null
      const render = (kept: number[]) => `[Relevant excerpt: ${kept.length}/${parts.length} parts; other parts omitted]\nFull result: ${filePath}\nUse the full file when more context is needed.\n\n${formatExcerpt(parts, kept)}`
      const choice = chooseRelevantParts(parts, scored.scores, budgetChars, render)
      // One outcome per result, on its first call.
      const first = scored.results[0]
      if ('reason' in choice) {
        recordDecisionOutcome(first, { action: 'summarize', changed: false, detail: { reason: choice.reason, total: parts.length } })
        return null
      }
      recordDecisionOutcome(first, { action: 'filter', changed: true, detail: { kept: choice.kept.length, total: parts.length } })
      if (sessionId && first) {
        // Bound runtime-only tracking even for sessions without a normal turn completion.
        if (!openExcerpts.has(sessionId) && openExcerpts.size >= 256) finishLargeResultExcerpts(openExcerpts.keys().next().value!)
        const tracked = openExcerpts.get(sessionId) ?? []
        if (tracked.length >= 128) recordDecisionFollowUp(tracked.shift()!.result, { result: 'observation_limit' })
        openExcerpts.set(sessionId, [...tracked, { result: first, filePath: canonicalPath(filePath) }])
      }
      return { text: render(choice.kept), kept: choice.kept.length, total: parts.length }
    }
    let onAbort: (() => void) | undefined
    try {
      return await Promise.race([operation(), new Promise<null>(resolve => {
        onAbort = () => resolve(null)
        abort.signal.addEventListener('abort', onAbort, { once: true })
        if (abort.signal.aborted) resolve(null)
      })])
    } catch (error) {
      deps.log?.(`[decision:large_results] filter failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      if (onAbort) abort.signal.removeEventListener('abort', onAbort)
      abort.abort()
    }
  }
}

/** Exact path in a tool argument is an attempt, never proof of a successful read. */
export function noteLargeResultFileUse(sessionId: string, input: unknown): void {
  const open = openExcerpts.get(sessionId)
  if (!open || !input) return
  const paths: string[] = []
  const collect = (value: unknown, depth: number) => {
    if (depth > 8) return
    if (typeof value === 'string') paths.push(canonicalPath(value))
    else if (Array.isArray(value)) value.forEach(item => collect(item, depth + 1))
    else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, depth + 1))
  }
  collect(input, 0)
  const unread = open.filter(excerpt => {
    if (!paths.includes(excerpt.filePath)) return true
    recordDecisionFollowUp(excerpt.result, { result: 'file_access_attempted' })
    return false
  })
  if (unread.length > 0) openExcerpts.set(sessionId, unread)
  else openExcerpts.delete(sessionId)
}

/** The request is over: unobserved access is recorded without implying answer quality. */
export function finishLargeResultExcerpts(sessionId: string): void {
  for (const excerpt of openExcerpts.get(sessionId) ?? []) recordDecisionFollowUp(excerpt.result, { result: 'no_file_access_observed' })
  openExcerpts.delete(sessionId)
}
