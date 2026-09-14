import * as React from 'react'
import type { Message, PiUsage } from '@craft-agent/core/types'
import { TrajectoryView, buildTrajectorySnapshot } from '@craft-agent/ui'
import type { ComponentEntry } from './types'

const usage: PiUsage = { input: 1200, output: 250, cacheRead: 300, cacheWrite: 0, totalTokens: 1750, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const message = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({ id, role, content: id, timestamp: 1000, turnId: 'one', ...extra })
const messages: Message[] = [
  message('question', 'user', { content: 'Inspect the project and verify the changes' }),
  message('request-one', 'assistant', { content: 'Inspecting source files', requestSeq: 1, usage, outputBlocks: [{ type: 'tool_call', callId: 'read' }] }),
  message('read', 'tool', { toolName: 'Read', toolUseId: 'read', toolIntent: 'Inspect the implementation', toolStatus: 'completed', toolDuration: 340 }),
  message('compaction', 'info', { turnId: undefined, content: 'Context compacted', compaction: { reason: 'threshold' } }),
  message('question-two', 'user', { turnId: 'two', content: 'Run the focused checks' }),
  message('request-two', 'assistant', { turnId: 'two', content: 'Checking behavior and layout', requestSeq: 2, usage, outputBlocks: [{ type: 'tool_call', callId: 'task' }, { type: 'tool_call', callId: 'shell' }], timestamp: 2000, assistantMetrics: { timingRecorded: true, stepStartTime: 2000, firstTokenTime: 2300, completedTime: 2700, usageProvided: true, outputTokens: 250 } }),
  message('task', 'tool', { turnId: 'two', toolName: 'Task', toolUseId: 'task', toolIntent: 'Validate the renderer', toolStatus: 'backgrounded', isBackground: true, taskId: 'background-check', timestamp: 2800 }),
  message('test', 'tool', { turnId: 'two', toolName: 'Test', toolUseId: 'test', parentToolUseId: 'task', toolIntent: 'Check narrow panel rendering', toolStatus: 'error', isError: true, toolDuration: 450, timestamp: 3000 }),
  message('shell', 'tool', { turnId: 'two', toolName: 'Shell', toolUseId: 'shell', toolIntent: 'Run focused type checks', toolStatus: 'executing', timestamp: 3500 }),
]

function ExecutionMapSample() {
  const [opened, setOpened] = React.useState('')
  const snapshot = React.useMemo(() => buildTrajectorySnapshot({ messages }), [])
  return <div data-testid="execution-map-sample" className="h-full min-h-0 w-full">
    <TrajectoryView snapshot={snapshot} isProcessing sessionMap={{ currentSessionId: 'sample', sessions: [
      { id: 'sample', title: 'Implementation review', isProcessing: true },
      { id: 'branch', title: 'Follow-up session', branchFromSessionId: 'sample', branchFromMessageId: 'request-one' },
    ] }} onOpenSession={setOpened} />
    <output className="sr-only">{opened}</output>
  </div>
}

export const executionMapComponents: ComponentEntry[] = [{
  id: 'execution-map', name: 'Run execution map', category: 'Chat',
  description: 'Synthetic execution evidence: nested tools, background work, compaction, errors and linked sessions.',
  component: ExecutionMapSample, props: [], layout: 'full', previewOverflow: 'hidden',
}]
