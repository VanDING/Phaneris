/**
 * Run redesign fixture.
 *
 * Mounts the real Run panel (`TrajectoryPanel` → `TrajectoryView` → the three
 * redesigned views) over deterministic session evidence, with no server, model
 * or credentials. The provider-shaped evidence (request ordinals, prompt
 * snapshots, request manifests, assistant timing, decision records) is written
 * by hand so every number on screen can be asserted from the fixture itself.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { Message } from '@phaneris/core/types'
import type { SessionDecisionItem, SessionDecisionReport, SessionDecisionTotals } from '@phaneris/shared/decisions/session'
import { decisionOutcome } from '@phaneris/shared/decisions/session'
import { AppShellProvider } from '@/context/AppShellContext'
import { NavigationContext } from '@/context/NavigationContext'
import { TrajectoryPanel } from '@/components/content-panels/TrajectoryPanel'
import { activateForegroundSessionAtom, setPrimarySurfaceRouteAtom } from '@/atoms/workbench'
import { replaceLoadedSessionAtom } from '@/atoms/sessions'
import { DEFAULT_THEME_FILE } from '@phaneris/shared/config/theme'
import { ThemeProvider } from '@/context/ThemeContext'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import '@/index.css'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') === 'dark' ? 'dark' : 'light'
const failSession = params.get('fail') === '1'

await i18next.init({
  lng: params.get('lang') ?? 'en',
  keySeparator: false,
  interpolation: { escapeValue: false },
  resources: { en: { translation: en }, 'zh-Hans': { translation: zh } },
})

const START = 1_790_000_000_000
const at = (seconds: number) => START + seconds * 1000
const sessionId = 'run-main'
const emptySessionId = 'run-empty'
const failingSessionId = 'run-error'

function usage(input: number, cacheRead: number, output: number, cost: number) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    reasoning: Math.round(output * 0.2),
    totalTokens: input + cacheRead + output,
    cost: { input: cost * 0.6, output: cost * 0.4, cacheRead: 0, cacheWrite: 0, total: cost },
  }
}

function metrics(requestStartMs: number, firstOutputMs: number, durationMs: number, outputTokens: number, timingVersion: 2 | null = 2) {
  if (timingVersion === null) return legacyMetrics()
  return modernMetrics(requestStartMs, firstOutputMs, durationMs, outputTokens)
}

function legacyMetrics() {
  // Pre-v2 records: epoch times only, so no comparable TTFT or rate exists.
  return {
    timingRecorded: true,
    stepStartTime: null,
    firstTokenTime: null,
    completedTime: null,
    usageProvided: true,
    outputTokens: null,
  }
}

function modernMetrics(requestStartMs: number, firstOutputMs: number, durationMs: number, outputTokens: number) {
  return {
    timingVersion: 2 as const,
    timingSource: 'pi_provider_callbacks' as const,
    timingRecorded: true,
    stepStartTime: requestStartMs,
    firstTokenTime: requestStartMs + firstOutputMs,
    firstOutputTime: requestStartMs + firstOutputMs,
    firstTextTime: requestStartMs + firstOutputMs,
    completedTime: requestStartMs + firstOutputMs + durationMs,
    requestDurationMs: firstOutputMs + durationMs,
    firstOutputLatencyMs: firstOutputMs,
    firstTextLatencyMs: firstOutputMs,
    generationDurationMs: durationMs,
    usageProvided: true,
    outputTokens,
  }
}

const TOOL_DEFINITIONS = [
  { name: 'read', description: 'Read a file from the workspace, returning its text content.', hash: 'schema-read', schemaChars: 1480 },
  { name: 'shell', description: 'Run a command in the session working directory.', hash: 'schema-shell', schemaChars: 1310 },
  { name: 'rg', description: 'Search workspace files with a regular expression.', hash: 'schema-rg', schemaChars: 980 },
  { name: 'edit', description: 'Replace an exact string in a file.', hash: 'schema-edit', schemaChars: 1120 },
]

function manifest(requestOrdinal: number, _systemChars: number) {
  return {
    version: 1 as const,
    capturedAt: at(requestOrdinal * 12),
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    // Character counts sized like a real request: the provider input is tens of
    // thousands of tokens, and the manifest is the measured composition source.
    system: { hash: `system-${requestOrdinal}`, chars: 24_000 },
    messages: [
      { role: 'user', hash: 'u1', chars: 4_200 + requestOrdinal * 30 },
      { role: 'assistant', hash: 'a1', chars: 38_000 + requestOrdinal * 260 },
      { role: 'toolResult', hash: 't1', chars: 120_000 + requestOrdinal * 2_000 },
      { role: 'user', hash: 'u2', chars: 2_600 + requestOrdinal * 12 },
      { role: 'toolResult', hash: 't2', chars: 40_000 + requestOrdinal * 120 },
    ],
    tools: TOOL_DEFINITIONS,
  }
}

const PROMPT_V1 = 'You are Phaneris, a local-first agent workspace.\n\n# Execution contract\nFollow the current user request until the authorized work is complete.\nPreserve unrelated local changes.\nDistinguish observed evidence from inference.\n\n# Workspace\nWorking directory: E:\\Phaneris\nPermission mode: Guarded'
const PROMPT_V2 = `${PROMPT_V1}\n\n# Session rules\nReport timing evidence before proposing a fix.`
const PROMPT_V3 = `${PROMPT_V2}\n\n# Review note\nThe user reviews the run view before further edits.`

const TURNS: Record<string, number> = {
  u1: 1, a1: 1, t1: 1, t2: 1, a2: 1, t3: 1, a3: 1,
  u2: 2, a4: 2, t4: 2, a5: 2,
  u3: 3, a6: 3, t5: 3, a7: 3, t6: 3, a8: 3, 'compact-1': 3,
  u4: 4, a9: 4, t7: 4, t8: 4, a10: 4,
  u5: 5, a11: 5, t9: 5, a12: 5, 'status-1': 5,
}
const turnIdOf = (id: string) => `turn-${TURNS[id] ?? 1}`

const user = (id: string, seconds: number, content: string, attachments?: Message['attachments']): Message => ({
  id, role: 'user', content, timestamp: at(seconds), turnId: turnIdOf(id), ...(attachments ? { attachments } : {}),
})
const assistant = (id: string, seconds: number, requestSeq: number, prompt: string, content: string, input: number, cacheRead: number, outputTokens: number, cost: number, withManifest = true, timing = true): Message => ({
  id,
  role: 'assistant',
  content,
  timestamp: at(seconds),
  turnId: turnIdOf(id),
  requestSeq,
  promptSnapshot: prompt,
  ...(withManifest ? { contextSnapshot: manifest(requestSeq, prompt.length) } : {}),
  usage: usage(input, cacheRead, outputTokens, cost),
  assistantMetrics: metrics(at(seconds) - 700, 700 + (requestSeq % 4) * 90, 1200 + requestSeq * 60, outputTokens, timing ? 2 : null),
})
const tool = (id: string, seconds: number, name: string, input: Record<string, unknown>, result: string, options: { isError?: boolean; duration?: number } = {}): Message => ({
  id,
  role: 'tool',
  content: result,
  timestamp: at(seconds),
  turnId: turnIdOf(id),
  toolName: name,
  toolDisplayName: name,
  toolUseId: `call-${id}`,
  toolInput: input,
  toolResult: result,
  toolStatus: options.isError ? 'error' : 'completed',
  toolDuration: options.duration ?? 120,
  isError: options.isError,
})

const longResult = (name: string, lines: number) => Array.from({ length: lines }, (_, index) => `${index + 1}  ${name} line ${index + 1}: recorded evidence retained for inspection.`).join('\n')

const messages: Message[] = [
  user('u1', 0, '定位会话启动到首段可见输出之间的延迟，先确认采集、传输与展示的实际边界。', [
    { id: 'att-1', type: 'image', name: 'startup-timeline.png', mimeType: 'image/png', size: 128_000, storedPath: 'E:\\Phaneris\\artifacts\\startup-timeline.png' },
  ]),
  assistant('a1', 6, 1, PROMPT_V1, '先检查传输事件与首段内容的处理路径，确认哪一段没有留下时间点。', 52_000, 3_000, 540, 0.0012),
  tool('t1', 12, 'read', { path: 'packages/server-core/src/sessions/SessionManager.ts', offset: 4280, limit: 80 }, longResult('SessionManager.ts', 84), { duration: 240 }),
  tool('t2', 20, 'rg', { pattern: 'response-buffer|firstOutputTime', path: 'packages/ui/src' }, longResult('response-buffer', 26), { duration: 90 }),
  assistant('a2', 28, 2, PROMPT_V1, '缓冲层在首段内容到达前先等待合并，需要确认它是否阻塞了首段可见输出。', 56_000, 3_200, 620, 0.0013),
  tool('t3', 35, 'read', { path: 'packages/shared/src/agent/backend/pi/event-adapter.ts' }, longResult('event-adapter.ts', 62), { duration: 180 }),
  assistant('a3', 43, 3, PROMPT_V1, '事件适配层按段派发，客户端侧存在合并等待。先保留现有缓冲策略，再验证恢复时序。', 61_000, 3_400, 710, 0.0015),
  user('u2', 52, '保留已有改动，暂时不要推送或重启应用。'),
  assistant('a4', 60, 4, PROMPT_V1, '收到。只读取证据，不修改、不推送。', 66_000, 3_600, 480, 0.0011, false, false),
  tool('t4', 68, 'shell', { command: 'bun run typecheck:all' }, 'typecheck:all completed\n@phaneris/shared: passed\n@phaneris/ui: passed\nexit code 0', { duration: 2_800 }),
  assistant('a5', 78, 5, PROMPT_V2, '类型检查通过。接下来检查缓冲策略本身，而不是等待时间更长的持久化路径。', 70_000, 3_800, 660, 0.0014),
  user('u3', 88, '继续，检查 response buffer 的交付时序，并记录缓存读写。'),
  assistant('a6', 96, 6, PROMPT_V2, '缓存读写发生在持久化之前，首段内容不应等待它完成。', 73_000, 4_000, 700, 0.0016),
  tool('t5', 104, 'read', { path: 'packages/ui/src/components/chat/response-buffering.ts' }, longResult('response-buffering.ts', 48), { duration: 160 }),
  assistant('a7', 112, 7, PROMPT_V2, '缓冲策略只影响合并窗口，不影响首输出采集。继续核对已加载技能与规范约束。', 76_000, 4_200, 620, 0.0014),
  tool('t6', 121, 'read', { path: '.agents/skills/frontend-design/SKILL.md' }, '# Frontend design\n\nRead the hierarchy, motion intent and contrast floors before changing the Run views.', { duration: 210 }),
  assistant('a8', 130, 8, PROMPT_V2, '界面规范要求运行状态集中在顶栏，并保留空状态与历史缺口的说明。', 80_000, 4_400, 640, 0.0015),
  {
    id: 'compact-1',
    role: 'info',
    infoLevel: 'success',
    content: '上下文压缩完成，回收 51,400 tokens。',
    timestamp: at(138),
    turnId: turnIdOf('compact-1'),
    statusType: 'compaction_complete',
    compaction: { reason: 'threshold' },
  },
  user('u4', 146, '压缩后继续定位首输出延迟，说明哪些数据没有采集。'),
  assistant('a9', 154, 9, PROMPT_V2, '压缩没有改变首输出时刻的采集路径，历史样本中的缺口仍然保留。', 30_000, 2_000, 700, 0.0016),
  tool('t7', 162, 'rg', { pattern: 'firstOutputTime', path: 'packages/core' }, longResult('firstOutput', 18), { duration: 80 }),
  tool('t8', 168, 'read', { path: 'packages/ui/src/components/chat/first-output.ts' }, 'ENOENT: no such file or directory', { isError: true, duration: 60 }),
  assistant('a10', 176, 10, PROMPT_V2, '读取失败属于路径错误，不影响已采集的计时证据；在下一次读取中修正路径。', 33_000, 2_100, 660, 0.0015),
  user('u5', 186, '总结目前证据与下一步，同时给出首输出延迟的中位数。'),
  assistant('a11', 194, 11, PROMPT_V3, '证据表明采集端完整，等待集中在合并窗口；下一步验证窗口与流结束的边界。', 36_000, 2_200, 720, 0.0017),
  tool('t9', 202, 'read', { path: 'packages/core/src/utils/assistant-timing.ts' }, longResult('assistant-timing.ts', 32), { duration: 110 }),
  assistant('a12', 210, 12, PROMPT_V3, '中位数需要按有效样本计算，缺失样本不能按零处理。相关结论保留在诊断卡片中。', 39_000, 2_300, 780, 0.0018),
  {
    id: 'status-1',
    role: 'status',
    content: '正在检查持久化队列。',
    timestamp: at(218),
    turnId: turnIdOf('status-1'),
    statusType: 'compacting',
  },
]

const tokenUsage = {
  inputTokens: 710_200,
  outputTokens: 8_230,
  totalTokens: 718_430,
  costUsd: 0.0176,
  contextTokens: 41_300,
  contextWindow: 128_000,
  unknownCostRequests: 1,
  estimatedCostRequests: 0,
}

const session = {
  id: sessionId,
  workspaceId: 'fixture',
  workspaceName: 'Phaneris',
  name: '优化会话启动延迟',
  preview: '定位会话启动到首段可见输出之间的延迟。',
  messages,
  isProcessing: false,
  sessionStatus: 'completed',
  model: 'deepseek-flash',
  permissionMode: 'guarded',
  workingDirectory: 'E:\\Phaneris',
  createdAt: at(0),
  lastMessageAt: at(218),
  messageCount: messages.length,
  tokenUsage,
  lastFullUsage: undefined,
  supportsBranching: true,
  sessionFolderPath: '/fixture/run-main',
} as never

const emptySession = {
  ...(session as Record<string, unknown>),
  id: emptySessionId,
  name: '空白会话',
  preview: '',
  messages: [],
  messageCount: 0,
  tokenUsage: undefined,
} as never

/* ── decision evidence ───────────────────────────────────────────────────── */

const decisionItems: SessionDecisionItem[] = [
  {
    id: 'dec_006', feature: 'guardedMode', startedAt: at(60), updatedAt: at(61),
    source: { turnId: 'turn-2', messageId: 'a4' },
    attempts: [{ id: 'attempt-1', provider: 'openrouter', model: 'inception/mercury-decide', sent: true, status: 'timeout', costUsd: undefined, costUnavailableReason: 'request_failed', deadlineMs: 2_000, latencyMs: 2_004, latencyScope: 'request_failure' }],
    recommendation: { action: 'prompt', changed: false, detail: {} },
    application: { action: 'allow', status: 'fallback', changed: false, reason: 'deadline' },
    observations: [],
  },
  {
    id: 'dec_005', feature: 'turnOutcome', startedAt: at(78), updatedAt: at(79),
    source: { turnId: 'turn-2', messageId: 'a5' },
    attempts: [{ id: 'attempt-2', provider: 'openrouter', model: 'inception/mercury-decide', sent: true, status: 'succeeded', costUsd: 0.0003, costSource: 'provider_reported', latencyMs: 286, deadlineMs: 2_000, inputTokens: 846, outputTokens: 82 }],
    recommendation: { action: 'status:needs-review', changed: true, detail: { confidence: 0.82 } },
    application: { action: 'status:needs-review', status: 'applied', changed: true, detail: { statusReason: 'confirmed' } },
    observations: [{ result: 'none_used', detail: { messageCount: 2 } }],
  },
  {
    id: 'dec_004', feature: 'largeResults', startedAt: at(96), updatedAt: at(97),
    source: { turnId: 'turn-3', messageId: 'a6' },
    attempts: [{ id: 'attempt-3', provider: 'openrouter', model: 'inception/mercury-decide', sent: true, status: 'succeeded', costUsd: 0.0002, costSource: 'provider_reported', latencyMs: 241, deadlineMs: 2_000, inputTokens: 720, outputTokens: 60 }],
    recommendation: { action: 'keep', changed: false, detail: {} },
    application: { action: 'keep', status: 'unchanged', changed: false },
    observations: [],
  },
  {
    id: 'dec_003', feature: 'semanticLabels', startedAt: at(130), updatedAt: at(131),
    source: { turnId: 'turn-3', messageId: 'a8' },
    attempts: [{ id: 'attempt-4', provider: 'openrouter', model: 'inception/mercury-decide', sent: true, status: 'succeeded', costUsd: undefined, costSource: 'unknown', latencyMs: 302, deadlineMs: 2_000, inputTokens: 690, outputTokens: 51 }],
    recommendation: { action: 'labels', changed: true, detail: { labels: ['performance'] } },
    application: { action: 'labels', status: 'applied', changed: true },
    observations: [],
  },
  {
    id: 'dec_002', feature: 'suggestions', startedAt: at(154), updatedAt: at(155),
    source: { turnId: 'turn-4', messageId: 'a9' },
    attempts: [{ id: 'attempt-5', provider: 'openrouter', model: 'inception/mercury-decide', sent: true, status: 'succeeded', costUsd: 0.0001, costSource: 'provider_reported', latencyMs: 198, deadlineMs: 2_000, inputTokens: 480, outputTokens: 33 }],
    recommendation: { action: 'hint_injected', changed: false, detail: {} },
    application: { action: 'skip', status: 'discarded', changed: false },
    observations: [],
  },
  {
    id: 'dec_001', feature: 'taskVerdicts', startedAt: at(194), updatedAt: at(195),
    source: { turnId: 'turn-5', messageId: 'a11' },
    attempts: [{ id: 'attempt-6', provider: 'openrouter', model: 'inception/mercury-decide', sent: true, status: 'succeeded', costUsd: 0.0004, costSource: 'provider_reported', latencyMs: 310, deadlineMs: 2_000, inputTokens: 610, outputTokens: 44 }],
    recommendation: { action: 'verdict', changed: false, detail: { verdict: 'pass' } },
    observations: [],
  },
  {
    id: 'dec_000', feature: 'guardedMode', startedAt: at(202), updatedAt: at(203),
    source: { turnId: 'turn-5', messageId: 'a12' },
    attempts: [{ id: 'attempt-7', provider: 'openrouter', model: 'inception/mercury-decide', sent: true, status: 'failed', costUsd: undefined, costUnavailableReason: 'request_failed', latencyMs: 120, deadlineMs: 2_000 }],
    observations: [],
  },
]

function summarize(items: SessionDecisionItem[]): SessionDecisionTotals {
  const totals: SessionDecisionTotals = {
    legacyCalls: 0, points: 0, requests: 0, changed: 0, unchanged: 0, fallback: 0, discarded: 0,
    unconfirmed: 0, failures: 0, cancelled: 0, knownCostUsd: 0, knownCostRequests: 0,
    unknownCostRequests: 0, inputTokens: 0, outputTokens: 0,
  }
  for (const item of items) {
    if (item.legacy) totals.legacyCalls += item.attempts.length
    else {
      totals.points += 1
      totals[decisionOutcome(item)] += 1
    }
    totals.requests += item.attempts.filter(attempt => attempt.sent).length
    totals.failures += item.attempts.filter(attempt => attempt.status === 'failed' || attempt.status === 'timeout').length
    totals.cancelled += item.attempts.filter(attempt => attempt.status === 'cancelled').length
    for (const attempt of item.attempts) {
      if (attempt.costUsd === undefined) totals.unknownCostRequests += 1
      else { totals.knownCostUsd += attempt.costUsd; totals.knownCostRequests += 1 }
      totals.inputTokens += attempt.inputTokens ?? 0
      totals.outputTokens += attempt.outputTokens ?? 0
    }
  }
  return totals
}

const features = ['guardedMode', 'turnOutcome', 'largeResults', 'semanticLabels', 'suggestions', 'taskVerdicts'] as const
const report: SessionDecisionReport = {
  schemaVersion: 1,
  sessionId,
  workspaceId: 'fixture',
  revision: 3,
  enabled: true,
  coverage: 'recorded',
  totals: summarize(decisionItems),
  features: features.map(feature => ({ feature, totals: summarize(decisionItems.filter(item => item.feature === feature)) })),
  items: decisionItems,
  turnIds: [...new Set(decisionItems.flatMap(item => item.source?.turnId ? [item.source.turnId] : []))],
  reliability: {
    schemaVersion: 1,
    state: 'available',
    sessionId,
    scope: 'retained-session-runtime-facts',
    asOf: at(218),
    lastSeq: 412,
    terminal: { completed: 12, failed: 1 },
    unsettled: { count: 0, toolCount: 0, modelCount: 0, oldestAgeMs: null, operationIds: [] },
    knownCostUsd: 0.0011,
    unknownCostRequests: 1,
    userAcceptance: 'unknown',
    taskBudgets: [{ taskSlug: 'run-view', runId: 'run-1', limit: 120_000, used: 80_090 }],
    observations: { pollingCandidates: 0, sdkRetries: 0, compactions: 1, recoveries: 0 },
    signals: [{ kind: 'repeated-action', toolName: 'read', count: 3, operationIds: ['call-t1', 'call-t3', 'call-t5'], firstSeq: 12, lastSeq: 202 }],
  },
}

function queryReport(query: { feature?: string; status?: string } | undefined): SessionDecisionReport {
  if (!query?.feature && !query?.status) return report
  const items = decisionItems.filter(item => {
    if (query.feature && item.feature !== query.feature) return false
    if (query.status === 'failed') return item.attempts.some(attempt => attempt.status === 'failed' || attempt.status === 'timeout')
    if (query.status) return !item.legacy && decisionOutcome(item) === query.status
    return true
  })
  return { ...report, items, totals: summarize(items) }
}

/* ── long history ────────────────────────────────────────────────────────── */

const longSessionId = 'run-long'
const longMessages: Message[] = []
for (let index = 0; index < 300; index += 1) {
  if (index === 150) longMessages.push({
    id: 'long-compaction', role: 'info', content: 'History compacted', timestamp: at(index * 4 - 1),
    statusType: 'compaction_complete', compaction: { reason: 'threshold' },
  })
  longMessages.push({
    id: `lu-${index}`,
    role: 'user',
    content: `Request ${index + 1}: keep inspecting the recorded timing evidence.`,
    timestamp: at(index * 4),
    turnId: `long-turn-${index}`,
  })
  longMessages.push(assistant(`la-${index}`, index * 4 + 2, index + 1, index < 150 ? PROMPT_V2 : PROMPT_V3,
    `Recorded answer ${index + 1} for the long-history acceptance case.`,
    (index < 150 ? 20_000 : 4_000) + index * 40, 2_000, 300, 0.0004, index % 5 !== 0, index % 7 !== 0))
}
const longSession = {
  ...(session as Record<string, unknown>),
  id: longSessionId,
  name: '长历史会话',
  messages: longMessages,
  messageCount: longMessages.length,
  tokenUsage: { ...tokenUsage, contextTokens: 33_000 },
} as never

const reviewSession = {
  ...(session as Record<string, unknown>), id: 'run-review', name: 'Context edge cases',
  messages: [
    user('review-u1', 0, Array.from({ length: 15 }, (_, index) => `Retained paragraph ${index + 1}.`).join('\n\n')),
    assistant('review-a1', 2, 1, '# System aaa', 'First answer', 100, 0, 10, 0.001),
    user('review-u2', 3, `${'Long retained text. '.repeat(500)}\n\nEND OF RETAINED CONTENT`),
    assistant('review-a2', 4, 2, '# System bbb', 'Second answer', 200, 0, 10, 0.001),
    { ...assistant('review-a3', 6, 3, '# System bbb', 'Third answer', 300, 0, 10, 0.001), contextSnapshot: { ...manifest(3, 12), tools: TOOL_DEFINITIONS.slice(0, 3) } },
  ],
} as never

/* ── electron API stub ───────────────────────────────────────────────────── */

const scaleMessages: Message[] = Array.from({ length: 69 }, (_, index) => [
  user(`scale-u${index}`, index * 4, `Inspect recorded request ${index + 1}.`),
  assistant(`scale-a${index}`, index * 4 + 2, index + 1, PROMPT_V1, `Recorded result ${index + 1}.`, 8_000 + index * 5_000, 2_000, 100, 0.001),
]).flat()
const scaleSession = {
  ...(session as Record<string, unknown>), id: 'run-scale', name: '69 requests · 1M capacity',
  messages: scaleMessages, messageCount: scaleMessages.length,
  tokenUsage: { ...tokenUsage, contextTokens: 350_000, contextWindow: 1_000_000 },
}
const sessions: Record<string, unknown> = { [sessionId]: session, [emptySessionId]: emptySession, [longSessionId]: longSession, 'run-review': reviewSession, 'run-scale': scaleSession }
let decisionResponse: 'normal' | 'hold' | 'error' = 'normal'
const pendingDecisionRequests: Array<() => void> = []
Object.assign(window, {
  electronAPI: {
    getSessionMessages: async (id: string) => {
      if (failSession && id === failingSessionId) throw new Error('fixture: run records unavailable')
      return sessions[id] ?? null
    },
    getSessionDecisions: async (id: string, query: unknown) => {
      if (id === sessionId && Object.values(query as Record<string, unknown>).some(Boolean) && (query as { feature?: string }).feature) {
        if (decisionResponse === 'hold') await new Promise<void>(resolve => pendingDecisionRequests.push(resolve))
        if (decisionResponse === 'error') throw new Error('fixture: filtered decisions unavailable')
      }
      if (id === sessionId) return queryReport(query as { feature?: string; status?: string })
      return { ...report, sessionId: id, items: [], features: [], turnIds: [], totals: summarize([]) }
    },
    onSessionDecisionsChanged: () => () => {},
    onTransportConnectionStateChanged: () => () => {},
    listLabels: async () => [],
    onLabelsChanged: () => () => {},
    getThemePreferences: async () => ({ mode, colorTheme: 'default', font: 'theme' }),
    getWorkspaceColorTheme: async () => null,
    loadPresetTheme: async () => DEFAULT_THEME_FILE,
    getSystemTheme: async () => mode === 'dark',
    onSystemThemeChange: () => () => {},
    onThemePreferencesChange: () => () => {},
    onWorkspaceThemeChange: () => () => {},
  },
})

const store = createStore()
for (const value of Object.values(sessions)) store.set(replaceLoadedSessionAtom, value as never)
store.set(setPrimarySurfaceRouteAtom, `allSessions/session/${sessionId}`)

Object.assign(window, {
  runRedesignFixture: {
    ready: true,
    evidence: (id: string, evidenceMessages: Message[], contextWindow = 1_000_000, recordedUsage?: unknown) => {
      const value = { ...(session as Record<string, unknown>), id, messages: evidenceMessages,
        messageCount: evidenceMessages.length, tokenUsage: recordedUsage ?? { ...tokenUsage, contextWindow } }
      sessions[id] = value
      store.set(replaceLoadedSessionAtom, value as never)
      store.set(setPrimarySurfaceRouteAtom, `allSessions/session/${id}`)
    },
    language: (language: string) => i18next.changeLanguage(language),
    select: (id: string) => store.set(setPrimarySurfaceRouteAtom, `allSessions/session/${id}`),
    activate: (id: string) => store.set(activateForegroundSessionAtom, id),
    processing: (value: boolean) => store.set(replaceLoadedSessionAtom, { ...(session as Record<string, unknown>), isProcessing: value } as never),
    occupancy: (contextUsage: unknown, contextWindow?: number) => store.set(replaceLoadedSessionAtom, {
      ...(session as Record<string, unknown>), tokenUsage: { ...tokenUsage, contextWindow, contextUsage },
    } as never),
    pendingDecisions: () => pendingDecisionRequests.length,
    decisionResponse: (value: typeof decisionResponse) => {
      decisionResponse = value
      if (value !== 'hold') pendingDecisionRequests.splice(0).forEach(resolve => resolve())
    },
  },
})

function App() {
  return (
    <AppShellProvider value={{
      activeWorkspaceId: 'fixture',
      workspaces: [{ id: 'fixture', name: 'Phaneris', rootPath: '/fixture' }],
      onOpenFile: () => {},
    } as never}>
      <NavigationContext.Provider value={{ navigateToSession: (id: string) => store.set(activateForegroundSessionAtom, id) } as never}>
        <div className="h-screen bg-background"><TrajectoryPanel /></div>
      </NavigationContext.Provider>
    </AppShellProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <I18nextProvider i18n={i18next}>
      <ThemeProvider defaultMode={mode}><App /></ThemeProvider>
    </I18nextProvider>
  </Provider>,
)
