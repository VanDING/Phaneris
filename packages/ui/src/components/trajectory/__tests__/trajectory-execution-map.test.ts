import { describe, expect, it } from 'bun:test'
import type { Message, PiUsage } from '@craft-agent/core/types'
import { buildTrajectorySnapshot } from '../trajectory-snapshot'
import { buildExecutionGraph, groupExecutionByBehavior, defaultBehaviorCollapsed, layoutBehaviorGraph } from '../trajectory-execution-map'

const sessionMap = { currentSessionId: 's', sessions: [{ id: 's', title: 'Single session' }] }
const usage: PiUsage = { input: 60, output: 20, cacheRead: 10, cacheWrite: 10, totalTokens: 100, reasoning: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const msg = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({ id, role, content: id, timestamp: 1000, turnId: 't1', ...extra })
const graphOf = (messages: Message[], processing = false) => buildExecutionGraph(buildTrajectorySnapshot({ messages }), sessionMap, processing)
const nodeId = (id: string) => `s:message:${id}`

describe('execution map', () => {
  it('shows a useful single-session tree with authoritative call owners, even when tools arrive first', () => {
    const graph = graphOf([
      msg('u', 'user'),
      msg('a', 'tool', { toolUseId: 'a', toolName: 'Task', toolStatus: 'completed' }),
      msg('b', 'tool', { toolUseId: 'b', parentToolUseId: 'a', toolName: 'Read', toolStatus: 'completed' }),
      msg('r', 'assistant', { requestSeq: 1, outputBlocks: [{ type: 'tool_call', callId: 'a' }], usage }),
    ])
    expect(graph.nodes.find(node => node.id === nodeId('a'))?.parentId).toBe(nodeId('r'))
    expect(graph.nodes.find(node => node.id === nodeId('b'))?.parentId).toBe(nodeId('a'))
    expect(graph.nodes.find(node => node.id === graph.rootId)?.summary.tools).toBe(2)
    expect(layoutBehaviorGraph(groupExecutionByBehavior(graph), new Set()).nodes.filter(node => node.kind === 'tool')).toHaveLength(2)
  })

  it('does not invent dependencies or assign token usage to tools', () => {
    const graph = graphOf([msg('r', 'assistant', { requestSeq: 1, usage }), msg('a', 'tool', { toolUseId: 'a' }), msg('b', 'tool', { toolUseId: 'b' })])
    expect(graph.edges.some(edge => edge.from === nodeId('a') && edge.to === nodeId('b'))).toBe(false)
    expect(graph.nodes.find(node => node.id === nodeId('a'))?.summary.tokens).toBeNull()
    // The request header and reasoning bucket must not be counted a second time.
    expect(graph.nodes.find(node => node.id === graph.rootId)?.summary.tokens).toBe(100)
  })

  it('unions parallel and nested recorded intervals and preserves missing measurements', () => {
    const graph = graphOf([
      msg('a', 'tool', { toolUseId: 'a', toolDuration: 1000 }),
      msg('b', 'tool', { toolUseId: 'b', parentToolUseId: 'a', timestamp: 1200, toolDuration: 400 }),
      msg('c', 'tool', { toolUseId: 'c', timestamp: 1500, toolDuration: 1000 }),
      msg('unknown', 'assistant'),
    ])
    const summary = graph.nodes.find(node => node.id === graph.rootId)!.summary
    expect(summary.measuredMs).toBe(1500)
    expect(summary.unmeasured).toBe(1)
    expect(graph.nodes.find(node => node.id === nodeId('unknown'))?.summary.measuredMs).toBeNull()
  })

  it('retains failure and background summaries when a subtree is collapsed', () => {
    const graph = graphOf([
      msg('a', 'tool', { toolUseId: 'a', toolStatus: 'backgrounded', isBackground: true }),
      msg('b', 'tool', { toolUseId: 'b', parentToolUseId: 'a', toolStatus: 'error' }),
    ])
    const layout = layoutBehaviorGraph(groupExecutionByBehavior(graph), new Set([nodeId('a')]))
    expect(layout.nodes.some(node => node.id === nodeId('b'))).toBe(false)
    const parent = layout.nodes.find(node => node.id === nodeId('a'))!
    expect(parent.summary.errors).toBe(1)
    expect(parent.summary.background).toBe(1)
    expect(parent.summary.active).toBe(1)
  })

  it('keeps cross-turn children in the same task subtree with their original turn labels', () => {
    const graph = graphOf([
      msg('a', 'tool', { toolUseId: 'a', toolStatus: 'backgrounded' }),
      msg('u2', 'user', { turnId: 't2' }),
      msg('b', 'tool', { turnId: 't2', toolUseId: 'b', parentToolUseId: 'a' }),
    ])
    const layout = layoutBehaviorGraph(groupExecutionByBehavior(graph), new Set())
    const child = layout.nodes.find(node => node.id === nodeId('b'))!
    expect(child.turn).toBe(2)
    expect(child.parentId).toBe(nodeId('a'))
    expect(layout.edges.filter(edge => edge.to === child.id).map(edge => edge.from)).toEqual([nodeId('a')])
  })

  it('does not merge separate compaction boundaries into the same section', () => {
    const graph = graphOf([
      msg('r1', 'assistant'),
      msg('c1', 'info', { turnId: undefined, compaction: { reason: 'threshold' } }),
      msg('r2', 'assistant', { turnId: 't2' }),
      msg('c2', 'info', { turnId: undefined, compaction: { reason: 'overflow', errorMessage: 'failed' } }),
    ])
    const layout = layoutBehaviorGraph(groupExecutionByBehavior(graph), new Set())
    const first = layout.nodes.find(node => node.id === nodeId('c1'))!
    const second = layout.nodes.find(node => node.id === nodeId('c2'))!
    expect(second.y).toBeGreaterThan(first.y + first.height)
    expect(second.status).toBe('error')
  })

  it('recovers missing and cyclic parent calls without losing nodes', () => {
    const graph = graphOf([
      msg('a', 'tool', { toolUseId: 'a', parentToolUseId: 'b' }),
      msg('b', 'tool', { toolUseId: 'b', parentToolUseId: 'a' }),
      msg('c', 'tool', { toolUseId: 'c', parentToolUseId: 'missing' }),
    ])
    const layout = layoutBehaviorGraph(groupExecutionByBehavior(graph), new Set())
    expect(layout.nodes.filter(node => node.kind === 'tool')).toHaveLength(3)
    expect(graph.nodes.find(node => node.id === nodeId('c'))?.unresolvedParent).toBe(true)
  })

  it('preserves node identities when earlier turns are prepended', () => {
    const current = [msg('u', 'user'), msg('r', 'assistant', { requestSeq: 1 })]
    const original = graphOf(current)
    const expanded = graphOf([msg('earlier', 'assistant', { turnId: 't0' }), ...current])
    expect(expanded.nodes.some(node => node.id === original.currentId)).toBe(true)
    expect(expanded.nodes.some(node => node.id === 's:turn:t1')).toBe(true)
  })

  it('aggregates many turns into a fixed behavior overview, with no turn spine or overlapping cards', () => {
    const graph = groupExecutionByBehavior(graphOf(Array.from({ length: 25 }, (_, i) => msg(`r${i}`, 'assistant', { turnId: `t${i}`, requestSeq: i + 1 }))))
    const collapsed = defaultBehaviorCollapsed(graph)
    const overview = layoutBehaviorGraph(graph, collapsed)
    expect(overview.nodes).toHaveLength(2)
    expect(overview.nodes.some(node => node.kind === 'turn')).toBe(false)
    const layout = layoutBehaviorGraph(graph, new Set())
    for (const [i, a] of layout.nodes.entries()) {
      expect(a.x + a.width).toBeLessThanOrEqual(layout.width)
      expect(a.y + a.height).toBeLessThanOrEqual(layout.height)
      for (const b of layout.nodes.slice(i + 1)) {
        expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false)
      }
    }
  })

  it('reveals real cross-partition session links only when a related node is selected', () => {
    const graph = buildExecutionGraph(buildTrajectorySnapshot({ messages: [msg('r', 'assistant')] }), {
      currentSessionId: 's', sessions: [...sessionMap.sessions, { id: 'branch', title: 'Branch', branchFromSessionId: 's', branchFromMessageId: 'r' }],
    })
    const behavior = groupExecutionByBehavior(graph)
    expect(layoutBehaviorGraph(behavior, new Set()).edges.some(edge => edge.kind === 'branch')).toBe(false)
    expect(layoutBehaviorGraph(behavior, new Set(), 'session:branch').edges.find(edge => edge.kind === 'branch')).toMatchObject({ from: nodeId('r'), to: 'session:branch' })
  })

  it('does not report historical executing state as live after the session stops', () => {
    const graph = graphOf([msg('a', 'tool', { toolStatus: 'executing' })])
    expect(graph.nodes.find(node => node.id === nodeId('a'))?.status).toBe('unknown')
    expect(graphOf([msg('a', 'tool', { toolStatus: 'executing' })], true).nodes.find(node => node.id === nodeId('a'))?.status).toBe('running')
  })

  it('groups repeated tool behaviors across turns and keeps request usage separate from tool categories', () => {
    const graph = groupExecutionByBehavior(graphOf([
      msg('r', 'assistant', { usage, outputBlocks: [{ type: 'tool_call', callId: 'read' }, { type: 'tool_call', callId: 'edit' }] }),
      msg('read', 'tool', { toolName: 'Read', toolUseId: 'read' }),
      msg('edit', 'tool', { toolName: 'Edit', toolUseId: 'edit' }),
      msg('read2', 'tool', { turnId: 't2', toolName: 'Read', toolUseId: 'read2' }),
    ]))
    const read = graph.nodes.find(node => node.behavior === 'read')!
    expect(read.children).toEqual([nodeId('read'), nodeId('read2')])
    expect(read.summary.tokens).toBeNull()
    expect(graph.nodes.find(node => node.behavior === 'response')?.summary.tokens).toBe(100)
    expect(graph.nodes.find(node => node.id === graph.rootId)?.summary.tokens).toBe(100)
    expect(layoutBehaviorGraph(graph, new Set()).edges.some(edge => edge.from === nodeId('r'))).toBe(false)
    expect(layoutBehaviorGraph(graph, new Set(), nodeId('r')).edges.filter(edge => edge.from === nodeId('r') && edge.kind === 'call')).toHaveLength(2)
  })

  it('turn filtering keeps cross-turn ancestry without including unrelated operations', () => {
    const graph = groupExecutionByBehavior(graphOf([
      msg('task', 'tool', { toolName: 'Task', toolUseId: 'task' }),
      msg('unrelated', 'tool', { toolName: 'Read' }),
      msg('child', 'tool', { turnId: 't2', toolName: 'Shell', parentToolUseId: 'task' }),
    ]), 2)
    expect(graph.nodes.some(node => node.id === nodeId('task'))).toBe(true)
    expect(graph.nodes.some(node => node.id === nodeId('child'))).toBe(true)
    expect(graph.nodes.some(node => node.id === nodeId('unrelated'))).toBe(false)
  })

  it('locates a still-running background task after the final response and retains lifecycle errors', () => {
    const graph = graphOf([
      msg('background', 'tool', { toolStatus: 'backgrounded' }),
      msg('done', 'assistant'),
      msg('failure', 'info', { infoLevel: 'error' }),
    ])
    expect(graph.currentId).toBe(nodeId('background'))
    expect(graph.nodes.find(node => node.id === nodeId('failure'))?.status).toBe('error')
  })
})
