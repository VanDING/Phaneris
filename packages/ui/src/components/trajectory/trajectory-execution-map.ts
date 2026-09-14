import type { Message } from '@phaneris/core/types'
import type { TrajectorySnapshot } from './trajectory-contract'
import { selectTrajectorySessionFamily, type TrajectorySessionMap } from './trajectory-session-map'

export type ExecutionKind = 'session' | 'turn' | 'behavior' | 'request' | 'tool' | 'compaction' | 'event'
export type ExecutionBehavior = 'read' | 'write' | 'execute' | 'delegate' | 'response' | 'context' | 'other' | 'sessions'
export type ExecutionStatus = 'running' | 'pending' | 'background' | 'error' | 'completed' | 'unknown'
export interface ExecutionNode {
  id: string
  kind: ExecutionKind
  behavior?: ExecutionBehavior
  title: string
  toolName?: string
  preview: string
  sessionId: string
  turn: number | null
  requestSeq?: number
  messageId?: string
  callId?: string
  parentId?: string
  /** Exact display section; unlike turn=null this distinguishes compaction boundaries. */
  scopeId?: string
  status: ExecutionStatus
  /** Only provider-reported model usage is counted; tools never receive a share. */
  ownTokens: number | null
  interval?: [number, number]
  measurable: boolean
  background: boolean
  unresolvedParent: boolean
  children: string[]
  summary: ExecutionSummary
}
export interface ExecutionSummary {
  tools: number
  requests: number
  errors: number
  active: number
  background: number
  compactions: number
  tokens: number | null
  /** Union of measured execution intervals, not the sum of nested/parallel spans. */
  measuredMs: number | null
  unmeasured: number
}
export interface ExecutionGraph {
  nodes: ExecutionNode[]
  edges: { id: string; from: string; to: string; kind: 'contains' | 'call' | 'branch' | 'subtask' }[]
  rootId: string
  currentId: string
}
export interface ExecutionMapNode extends ExecutionNode {
  x: number; y: number; width: number; height: number
}
export interface ExecutionMapLayout {
  nodes: ExecutionMapNode[]
  edges: ExecutionGraph['edges']
  width: number
  height: number
}

const emptySummary = (): ExecutionSummary => ({ tools: 0, requests: 0, errors: 0, active: 0, background: 0, compactions: 0, tokens: null, measuredMs: null, unmeasured: 0 })
const clean = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 180)
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function intervalOf(message: Message): [number, number] | undefined {
  if (message.role === 'assistant') {
    const metrics = message.assistantMetrics
    if (valid(metrics?.stepStartTime) && valid(metrics?.completedTime) && metrics.completedTime >= metrics.stepStartTime) {
      return [metrics.stepStartTime, metrics.completedTime]
    }
  } else if (message.role === 'tool' && valid(message.toolDuration) && valid(message.timestamp)) {
    return [message.timestamp, message.timestamp + message.toolDuration]
  }
  return undefined
}

function statusOf(message: Message, isProcessing: boolean): ExecutionStatus {
  if (message.isError || message.role === 'error' || message.infoLevel === 'error' || message.toolStatus === 'error' || message.compaction?.errorMessage) return 'error'
  if (message.toolStatus === 'completed') return 'completed'
  if (message.toolStatus === 'backgrounded') return 'background'
  if (message.toolStatus === 'executing') return isProcessing || message.isBackground ? 'running' : 'unknown'
  if (message.toolStatus === 'pending' || message.isQueued) return 'pending'
  if (message.isStreaming || message.isPending || message.statusType === 'compacting') return isProcessing ? 'running' : 'unknown'
  if (message.role === 'assistant' || message.compaction && !message.compaction.aborted) return 'completed'
  return 'unknown'
}

function summarizeExecutionTree(node: ExecutionNode, byId: ReadonlyMap<string, ExecutionNode>): [number, number][] {
  const intervals: [number, number][] = node.interval ? [node.interval] : []
  const summary = emptySummary()
  summary.tools = Number(node.kind === 'tool')
  summary.requests = Number(node.kind === 'request')
  summary.errors = Number(node.status === 'error')
  summary.active = Number(node.kind !== 'session' && node.kind !== 'behavior' && (node.status === 'running' || node.status === 'pending' || node.status === 'background'))
  summary.background = Number(node.background)
  summary.compactions = Number(node.kind === 'compaction')
  summary.tokens = node.ownTokens
  summary.unmeasured = Number(node.measurable && !node.interval)
  for (const id of node.children) {
    const child = byId.get(id)!
    intervals.push(...summarizeExecutionTree(child, byId))
    for (const key of ['tools', 'requests', 'errors', 'active', 'background', 'compactions', 'unmeasured'] as const) summary[key] += child.summary[key]
    if (child.summary.tokens !== null) summary.tokens = (summary.tokens ?? 0) + child.summary.tokens
  }
  intervals.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const interval of intervals) {
    const last = merged[merged.length - 1]
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
    else merged.push([...interval])
  }
  summary.measuredMs = merged.length ? merged.reduce((sum, [start, end]) => sum + end - start, 0) : null
  node.summary = summary
  return merged
}

/** Keep only factual parent/call relationships. Ordering is never a dependency edge. */
export function buildExecutionGraph(snapshot: TrajectorySnapshot, sessionMap: TrajectorySessionMap, isProcessing = false): ExecutionGraph {
  const sessionId = sessionMap.currentSessionId
  const rootId = `session:${sessionId}`
  const nodes: ExecutionNode[] = []
  const byId = new Map<string, ExecutionNode>()
  const edges: ExecutionGraph['edges'] = []
  const add = (input: Partial<ExecutionNode> & Pick<ExecutionNode, 'id' | 'kind'>) => {
    const node: ExecutionNode = { title: '', preview: '', sessionId, turn: null, status: 'unknown', ownTokens: null, measurable: false, background: false, unresolvedParent: false, children: [], summary: emptySummary(), ...input }
    nodes.push(node)
    byId.set(node.id, node)
    return node
  }
  const currentSession = sessionMap.sessions.find(session => session.id === sessionId)
  add({ id: rootId, kind: 'session', title: currentSession?.title ?? '', preview: currentSession?.preview ?? '', status: isProcessing ? 'running' : 'unknown' })
  const requestByMessage = new Map<string, { seq: number; turn: number | null }>()
  for (const entry of snapshot.contributions) {
    if (entry.kind === 'request-header') requestByMessage.set(entry.requestId, { seq: entry.requestSeq, turn: entry.turn })
  }
  const turns = new Map<string, ExecutionNode>()
  const calls = new Map<string, ExecutionNode>()
  const messages = new Map<string, ExecutionNode>()
  const requestedParents = new Map<string, string>()
  const callOwners = new Map<string, string>()
  let betweenId = ''
  let previousTurn: number | null | undefined
  for (const entry of snapshot.contributions) {
    if (!('message' in entry)) continue
    const message = entry.message
    if (messages.has(message.id)) continue
    const turn = entry.turn
    // Each contiguous between-turn section gets its own stable anchor.
    if (turn === null && previousTurn !== null) betweenId = message.id
    previousTurn = turn
    const turnKey = turn === null ? `between:${betweenId}` : `turn:${message.turnId ?? turn}`
    let container = turns.get(turnKey)
    if (!container) {
      container = add({ id: `${sessionId}:${turnKey}`, kind: 'turn', turn, parentId: rootId })
      turns.set(turnKey, container)
    }
    if (message.role === 'user' && !message.hidden) {
      if (!container.messageId) {
        container.title = clean(message.content)
        container.messageId = message.id
      }
      continue
    }
    // Normal informational text stays in the ledger; structural lifecycle events remain visible.
    const isEvent = message.role !== 'assistant' && message.role !== 'tool' && !message.compaction
    if (isEvent && !message.isError && message.role !== 'error' && message.infoLevel !== 'error' && message.statusType !== 'compacting' && message.role !== 'auth-request') continue
    const kind: ExecutionKind = message.compaction || message.statusType === 'compacting' ? 'compaction' : message.role === 'assistant' ? 'request' : message.role === 'tool' ? 'tool' : 'event'
    const request = requestByMessage.get(message.id)
    const node = add({
      id: `${sessionId}:message:${message.id}`, kind, turn, parentId: container.id, scopeId: container.id,
      title: kind === 'tool' ? message.toolDisplayName ?? message.toolName ?? '' : '',
      toolName: message.toolName,
      preview: clean(message.toolIntent || message.content || message.toolResult || ''),
      messageId: message.id, callId: message.toolUseId, requestSeq: request?.seq,
      status: statusOf(message, isProcessing), interval: intervalOf(message),
      measurable: kind === 'tool' || kind === 'request',
      ownTokens: kind === 'request' && valid(message.usage?.totalTokens) ? message.usage.totalTokens : null,
      background: !!(message.isBackground || message.taskId || message.shellId || message.toolStatus === 'backgrounded'),
    })
    messages.set(message.id, node)
    if (message.toolUseId) calls.set(message.toolUseId, node)
    if (message.parentToolUseId) requestedParents.set(node.id, message.parentToolUseId)
    if (kind === 'request') {
      for (const block of message.outputBlocks ?? []) {
        if (block.callId) callOwners.set(block.callId, node.id)
      }
    }
  }
  // Resolve after reading the whole stream: nested results and request owners can arrive later.
  for (const node of nodes) {
    const parentCall = requestedParents.get(node.id)
    const owner = parentCall ? calls.get(parentCall)?.id : node.callId ? callOwners.get(node.callId) : undefined
    if (owner && owner !== node.id) node.parentId = owner
    else if (parentCall) node.unresolvedParent = true
  }
  // Corrupt/partial historical ancestry must never hide records or create a layout cycle.
  for (const node of nodes) {
    const seen = new Set([node.id])
    let parent = node.parentId
    while (parent) {
      if (seen.has(parent)) {
        node.parentId = node.scopeId ?? rootId
        node.unresolvedParent = true
        break
      }
      seen.add(parent)
      parent = byId.get(parent)?.parentId
    }
  }
  for (const node of nodes) {
    if (!node.parentId) continue
    byId.get(node.parentId)?.children.push(node.id)
    edges.push({ id: `${node.parentId}->${node.id}`, from: node.parentId, to: node.id, kind: byId.get(node.parentId)?.kind === 'tool' || byId.get(node.parentId)?.kind === 'request' ? 'call' : 'contains' })
  }
  // Related sessions are entry points, not invented execution internals or wait edges.
  const family = selectTrajectorySessionFamily(sessionId, sessionMap.sessions)
  for (const session of family) {
    if (session.id === sessionId) continue
    add({ id: `session:${session.id}`, kind: 'session', sessionId: session.id, title: session.title, preview: session.preview ?? '', status: session.isProcessing ? 'running' : 'unknown' })
  }
  for (const session of family) {
    const parent = session.branchFromSessionId ?? session.parentSessionId
    if (!parent || !byId.has(`session:${parent}`)) continue
    const from = parent === sessionId && session.branchFromMessageId ? messages.get(session.branchFromMessageId)?.id ?? rootId : `session:${parent}`
    const to = `session:${session.id}`
    edges.push({ id: `${from}->${to}`, from, to, kind: session.branchFromSessionId ? 'branch' : 'subtask' })
  }
  summarizeExecutionTree(byId.get(rootId)!, byId)
  const execution = nodes.filter(node => node.kind !== 'session' && node.kind !== 'turn')
  const active = [...execution].reverse().find(node => node.status === 'running' || node.status === 'pending')
    ?? [...execution].reverse().find(node => node.status === 'background')
  const currentId = active?.id ?? execution[execution.length - 1]?.id ?? [...turns.values()].at(-1)?.id ?? rootId
  return { nodes, edges, rootId, currentId }
}

/** Classify recorded tool identities, never generated task goals or inferred dependencies. */
export function executionBehavior(node: ExecutionNode): ExecutionBehavior {
  if (node.kind === 'session') return 'sessions'
  if (node.kind === 'request') return 'response'
  if (node.kind === 'compaction' || node.kind === 'event') return 'context'
  if (node.background) return 'delegate'
  const name = (node.toolName ?? node.title).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (/(^|_)(task|agent|spawn|delegate|subagent|handoff|wait)(_|$)/.test(name)) return 'delegate'
  if (/(^|_)(read|search|find|grep|glob|list|ls|fetch|browse|web|view|inspect|query|get|open)(_|$)/.test(name)) return 'read'
  if (/(^|_)(write|edit|patch|apply_patch|create|update|insert|replace|delete|remove|save)(_|$)/.test(name)) return 'write'
  if (/(^|_)(bash|shell|exec|execute|run|terminal|test|build|python|node)(_|$)/.test(name)) return 'execute'
  return 'other'
}

/**
 * Behavior is the navigation hierarchy. Invocation edges remain separate evidence:
 * a request issuing both Read and Edit belongs to neither artificial "phase".
 * Nested task execution stays together under its actual parent tool.
 */
export function groupExecutionByBehavior(source: ExecutionGraph, turnFilter: number | null = null): ExecutionGraph {
  const sourceById = new Map(source.nodes.map(node => [node.id, node]))
  const root = { ...sourceById.get(source.rootId)!, children: [], summary: emptySummary() }
  const nodes: ExecutionNode[] = [root]
  const groups = new Map<ExecutionBehavior, ExecutionNode>()
  const selected = new Set<string>()
  for (const node of source.nodes) {
    if (node.kind === 'turn' || node.id === source.rootId) continue
    if (turnFilter === null || node.turn === turnFilter) {
      selected.add(node.id)
      // Keep the real ancestry as context when a task crosses turn boundaries.
      let parent = node.parentId ? sourceById.get(node.parentId) : undefined
      while (parent && parent.kind !== 'turn' && parent.kind !== 'session') {
        selected.add(parent.id)
        parent = parent.parentId ? sourceById.get(parent.parentId) : undefined
      }
    }
  }
  const ensureGroup = (behavior: ExecutionBehavior) => {
    let group = groups.get(behavior)
    if (!group) {
      group = { ...root, id: `${root.id}:behavior:${behavior}`, kind: 'behavior', behavior, title: '', preview: '', parentId: root.id, status: 'unknown', children: [], summary: emptySummary() }
      groups.set(behavior, group)
      nodes.push(group)
    }
    return group
  }
  for (const original of source.nodes) {
    if (!selected.has(original.id)) continue
    const node: ExecutionNode = { ...original, children: [], summary: emptySummary() }
    let ancestor = original.parentId ? sourceById.get(original.parentId) : undefined
    let insideTool = false
    while (ancestor && ancestor.kind !== 'turn' && ancestor.kind !== 'session') {
      if (ancestor.kind === 'tool') { insideTool = true; break }
      ancestor = ancestor.parentId ? sourceById.get(ancestor.parentId) : undefined
    }
    if (!insideTool || !node.parentId || !selected.has(node.parentId)) {
      node.parentId = ensureGroup(executionBehavior(node)).id
    }
    nodes.push(node)
  }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const edges: ExecutionGraph['edges'] = []
  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue
    byId.get(node.parentId)!.children.push(node.id)
    const factual = source.edges.find(edge => edge.from === node.parentId && edge.to === node.id && edge.kind === 'call')
    edges.push({ id: `${node.parentId}->${node.id}`, from: node.parentId, to: node.id, kind: factual ? 'call' : 'contains' })
  }
  // Cross-partition invocation links are revealed on selection, not woven through the overview.
  for (const edge of source.edges) {
    if (edge.kind === 'contains' || !byId.has(edge.from) || !byId.has(edge.to)) continue
    if (!edges.some(existing => existing.id === edge.id)) edges.push(edge)
  }
  const order: ExecutionBehavior[] = ['read', 'write', 'execute', 'delegate', 'response', 'context', 'other', 'sessions']
  root.children.sort((a, b) => order.indexOf(byId.get(a)!.behavior!) - order.indexOf(byId.get(b)!.behavior!))
  // Aggregate disjoint containment subtrees, independently of invocation cross-links.
  summarizeExecutionTree(root, byId)
  return { nodes, edges, rootId: root.id, currentId: selected.has(source.currentId) ? source.currentId : root.id }
}

/** Start with the behavior overview; explicit user expansion reveals concrete operations. */
export function defaultBehaviorCollapsed(graph: ExecutionGraph): Set<string> {
  return new Set(graph.nodes.filter(node => node.kind === 'behavior' || node.children.length > 0 && node.id !== graph.rootId).map(node => node.id))
}

/** Balanced two-sided behavior map, with no chronological spine or turn-sized bands. */
export function layoutBehaviorGraph(graph: ExecutionGraph, collapsed: ReadonlySet<string>, selectedId?: string | null): ExecutionMapLayout {
  const width = 264, height = 124, stepX = 336, stepY = 152, pad = 48
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const root = byId.get(graph.rootId)!
  const size = new Map<string, number>()
  const measure = (id: string): number => {
    const node = byId.get(id)!
    const children = collapsed.has(id) ? [] : node.children
    const span = Math.max(stepY, children.reduce((sum, child) => sum + measure(child), 0))
    size.set(id, span)
    return span
  }
  measure(root.id)
  const branches = collapsed.has(root.id) ? [] : root.children
  const left: string[] = [], right: string[] = []
  let leftSize = 0, rightSize = 0
  for (const id of branches) {
    // Stable category sides; expansion never moves a category across the session.
    const behavior = byId.get(id)!.behavior
    if (behavior === 'read' || behavior === 'response' || behavior === 'context' || behavior === 'other') { left.push(id); leftSize += size.get(id)! }
    else { right.push(id); rightSize += size.get(id)! }
  }
  const canvasHeight = Math.max(stepY, leftSize, rightSize) + pad * 2
  const nodes: ExecutionMapNode[] = []
  const place = (id: string, depth: number, top: number, side: number) => {
    const node = byId.get(id)!, span = size.get(id)!
    nodes.push({ ...node, x: depth * stepX * side, y: top + (span - height) / 2, width, height })
    if (collapsed.has(id)) return
    let y = top
    for (const child of node.children) { place(child, depth + 1, y, side); y += size.get(child)! }
  }
  nodes.push({ ...root, x: 0, y: (canvasHeight - height) / 2, width, height })
  for (const [ids, side, total] of [[left, -1, leftSize], [right, 1, rightSize]] as const) {
    let y = (canvasHeight - total) / 2
    for (const id of ids) { place(id, 1, y, side); y += size.get(id)! }
  }
  const minX = Math.min(...nodes.map(node => node.x))
  for (const node of nodes) node.x += pad - minX
  const visible = new Set(nodes.map(node => node.id))
  const edges = graph.edges.filter(edge => visible.has(edge.from) && visible.has(edge.to) && (
    byId.get(edge.to)?.parentId === edge.from || edge.from === selectedId || edge.to === selectedId
  ))
  return { nodes, edges, width: Math.max(...nodes.map(node => node.x + width)) + pad, height: canvasHeight }
}
