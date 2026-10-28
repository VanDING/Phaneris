/** Capture → session codec → production Run UI, including legacy image-heavy requests. */
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { normalizeContext, type Model } from '@earendil-works/pi-ai'
import type { Message } from '@phaneris/core/types'
import { SnapshotDecoder, SnapshotEncoder } from '@phaneris/core/utils'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readSessionJsonl } from '../../packages/shared/src/sessions/jsonl'
import { prepareRequestDiagnostics } from '../../packages/pi-agent-server/src/request-diagnostics'
import { buildTrajectorySnapshot } from '../../packages/ui/src/components/trajectory/trajectory-snapshot'
import { deriveRequestContexts, contextGroupTokens } from '../../packages/ui/src/components/trajectory/trajectory-context'
import { buildTrendBars } from '../../packages/ui/src/components/trajectory/run-model'
import { contextItemChanges } from '../../packages/ui/src/components/trajectory/RunContextChanges'
import { buildFixturePage } from './fixture-bundle'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

const active = (page: Page) => page.locator('[role="tabpanel"]:not([hidden])')
const metering = (input: number) => ({ input, cacheRead: 0, cacheWrite: 0, output: 10, totalTokens: input + 10,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
const model = { provider: 'openai', id: 'vision-test', contextWindow: 128_000, maxTokens: 4096, input: ['text', 'image'] } as Model<'openai-completions'>
const tool = { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
const capture = (imageChars: number, timestamp = 1) => prepareRequestDiagnostics(model, normalizeContext({
  systemPrompt: 'Stable system prompt', tools: [tool], messages: [
    { role: 'user', content: 'Inspect the image', timestamp },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'read-image', name: 'read', arguments: { path: 'page.png' } }],
      api: 'openai-completions', provider: 'openai', model: model.id, usage: metering(timestamp), stopReason: 'toolUse', timestamp },
    { role: 'toolResult', toolCallId: 'read-image', toolName: 'read', content: [
      { type: 'text', text: 'Image loaded' }, { type: 'image', data: 'a'.repeat(imageChars), mimeType: 'image/png' },
    ], isError: false, timestamp },
  ],
})).contextSnapshot

function roundtrip(messages: Message[]): Message[] {
  const encoder = new SnapshotEncoder(json => createHash('sha256').update(json).digest('hex'))
  const decoder = new SnapshotDecoder()
  return messages.map(message => decoder.decode<Message>(JSON.parse(JSON.stringify(encoder.encode(message)))))
}
const projection = (messages: Message[]) => deriveRequestContexts(buildTrajectorySnapshot({ messages }))

await verificationWorkflow('run-context-integrity', async run => {
  const checks: Array<{ id: string; detail: unknown }> = []
  const check = async (id: string, fn: () => unknown | Promise<unknown>) => { const detail = await fn(); checks.push({ id, detail }); console.log(`PASS ${id}`) }
  const small = capture(400), large = capture(4_000_000)
  await check('capture excludes binary and metadata from text accounting', () => {
    const a = small.messages.at(-1)!, b = large.messages.at(-1)!
    assert.equal(a.content?.textChars, 'Image loaded'.length)
    assert.equal(a.content?.imageCount, 1)
    assert.equal(b.content?.textChars, a.content?.textChars)
    assert(b.chars > a.chars * 100)
    assert.equal(small.system.textChars, 'Stable system prompt'.length)
    assert.equal(small.messages[1].content?.textChars, 0)
    assert.equal(small.messages[1].content?.toolCalls?.length, 1)
    const shifted = capture(400, 999)
    assert.deepEqual(shifted.messages.map(entry => entry.content), small.messages.map(entry => entry.content))
    return { smallSerializedChars: a.chars, largeSerializedChars: b.chars, text: a.content }
  })
  const messages = roundtrip([
    { id: 'u', role: 'user', content: 'Inspect the image', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: 'Reading', timestamp: 2, requestSeq: 1, promptSnapshot: 'Stable system prompt', contextSnapshot: small, usage: metering(10_000) },
    { id: 'image', role: 'tool', content: 'Image loaded', toolName: 'read', toolUseId: 'read-image', toolInput: { path: 'page.png' }, toolStatus: 'completed', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: 'Done', timestamp: 4, requestSeq: 2, promptSnapshot: 'Stable system prompt', contextSnapshot: large, usage: metering(11_000) },
  ])
  await check('normal session codec retains stable text metrics without allocations', () => {
    const contexts = projection(messages)
    for (const category of ['system', 'schemas', 'user', 'assistant']) {
      const groups = contexts.map(context => context.groups.find(group => group.category === category)!)
      assert.equal(groups[0]?.estimatedTokens ?? 0, groups[1]?.estimatedTokens ?? 0, category)
    }
    assert.equal(contexts[0].inputTokens, 10_000)
    assert.equal(contexts[1].inputTokens, 11_000)
    assert(contexts[1].estimatedTokens < 1000)
    assert.equal(contexts[1].groups.find(group => group.category === 'tool')?.imageCount, 1)
    return contexts.map(context => ({ input: context.inputTokens, textEstimate: context.estimatedTokens }))
  })
  const schemaChanged = roundtrip(messages.map(message => message.id === 'a2' ? { ...message,
    contextSnapshot: { ...message.contextSnapshot!, tools: message.contextSnapshot!.tools.map(entry => ({ ...entry, hash: 'different-schema-same-size' })) },
  } : message))
  await check('same-length schema edits remain visible in Changes', () => {
    const contexts = projection(schemaChanged)
    const changes = contextItemChanges(contexts[1].groups.find(group => group.category === 'schemas')!.items, contexts[0].groups.find(group => group.category === 'schemas')!.items)
    assert.equal(changes.length, 1)
    assert.equal(changes[0].change, 'modified')
    return changes.map(item => ({ label: item.label, change: item.change }))
  })
  await check('legacy output blocks retain reasoning once and mixed metering has no invented delta', () => {
    const legacy = messages.map(message => {
      const { contextSnapshot: _manifest, usage: _usage, ...retained } = message
      return message.id === 'a1' ? { ...retained, content: 'Visible text', outputBlocks: [
        { type: 'thinking' as const, index: 0, content: 'Retained reasoning' },
        { type: 'text' as const, content: 'Visible text' },
      ] } : retained
    })
    const contexts = projection(legacy)
    assert.equal(contexts[1].groups.find(group => group.category === 'assistant')!.chars, 'Retained reasoning\n\nVisible text'.length)
    const mixed = projection(messages.map(message => message.id === 'a2' ? { ...message, usage: undefined } : message))
    assert.equal(buildTrendBars(mixed, 72, 'delta')[1].change, undefined)
    return { retainedAssistantChars: contexts[1].groups.find(group => group.category === 'assistant')!.chars }
  })
  await check('metered composition conserves input and isolates uncertain attribution', () => {
    const contexts = projection(messages)
    for (const context of contexts) {
      assert.equal(context.groups.reduce((sum, group) => sum + (contextGroupTokens(group) ?? 0), 0), context.inputTokens)
      assert(context.groups.some(group => group.category === 'unknown'))
    }
    const zero = projection(messages.map(message => message.usage ? { ...message, usage: metering(0) } : message)).at(-1)!
    assert.equal(zero.inputTokens, 0)
    assert(zero.estimatedTokens > 0, 'retained estimates survive unavailable attribution')
    assert.equal(zero.groups.reduce((sum, group) => sum + (contextGroupTokens(group) ?? 0), 0), 0)
    return contexts.map(context => ({ input: context.inputTokens, attributed: context.groups.map(group => ({ category: group.category, tokens: contextGroupTokens(group) })) }))
  })
  await check('retained output constrains the next input instead of adding current output', () => {
    const user = { role: 'user' as const, content: 'Inspect the image', timestamp: 1 }
    const response = { role: 'assistant' as const, content: [
      { type: 'thinking' as const, thinking: 'Reasoning', thinkingSignature: 'reasoning_content' },
      { type: 'toolCall' as const, id: 'read-image', name: 'read', arguments: { path: 'page.png' } },
    ], api: 'openai-completions' as const, provider: 'openai', model: model.id,
      usage: { ...metering(1000), output: 150, reasoning: 100, totalTokens: 1150 }, stopReason: 'toolUse' as const, timestamp: 2 }
    const result = { role: 'toolResult' as const, toolCallId: 'read-image', toolName: 'read', content: [{ type: 'text' as const, text: 'Tool result' }], isError: false, timestamp: 3 }
    const manifest = (entries: Parameters<typeof normalizeContext>[0]['messages']) => prepareRequestDiagnostics(model,
      normalizeContext({ systemPrompt: 'Stable system prompt', tools: [tool], messages: entries })).contextSnapshot
    const evidence: Message[] = [
      { id: 'u', role: 'user', content: user.content, timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '', timestamp: 2, requestSeq: 1, usage: response.usage,
        promptSnapshot: 'Stable system prompt', contextSnapshot: manifest([user]), outputBlocks: [
          { type: 'thinking', content: 'Reasoning' }, { type: 'tool-call', callId: 'read-image', toolName: 'read', content: '{"path":"page.png"}' },
        ] },
      { id: 't', role: 'tool', content: 'Tool result', toolUseId: 'read-image', toolName: 'read', toolInput: { path: 'page.png' }, timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'Done', timestamp: 4, requestSeq: 2, usage: { ...metering(1300), output: 999 },
        promptSnapshot: 'Stable system prompt', contextSnapshot: manifest([user, response, result]) },
    ]
    const contexts = projection(roundtrip(evidence))
    const last = contexts[1]
    assert.equal(contextGroupTokens(last.groups.find(group => group.category === 'assistant')!), 100)
    assert.equal(contextGroupTokens(last.groups.find(group => group.category === 'tool')!), 200)
    assert.equal(last.inputTokens, 1300)
    assert.equal(contextGroupTokens(last.groups.find(group => group.category === 'unknown')!), contextGroupTokens(contexts[0].groups.find(group => group.category === 'unknown')!))
    const variants = [
      { id: 'metadata-only', snapshot: { ...evidence[3].contextSnapshot!, messages: evidence[3].contextSnapshot!.messages.map((entry, index) => index === 0 ? { ...entry, hash: 'different-diagnostic-metadata' } : entry) }, seq: 2, anchored: true },
      { id: 'missing-request', snapshot: evidence[3].contextSnapshot!, seq: 3, anchored: false },
      { id: 'model-changed', snapshot: { ...evidence[3].contextSnapshot!, model: 'another-model' }, seq: 2, anchored: false },
      { id: 'history-edited', snapshot: { ...evidence[3].contextSnapshot!, messages: evidence[3].contextSnapshot!.messages.map((entry, index) => index === 0 ? { ...entry, content: { ...entry.content!, hash: 'different-content' } } : entry) }, seq: 2, anchored: false },
      { id: 'reasoning-not-retained', snapshot: { ...evidence[3].contextSnapshot!, messages: evidence[3].contextSnapshot!.messages.map(entry => entry.role === 'assistant' ? { ...entry, content: { ...entry.content!, textChars: 0 } } : entry) }, seq: 2, anchored: false },
    ]
    for (const variant of variants) {
      const replay = projection(roundtrip(evidence.map(message => message.id === 'a2' ? { ...message, contextSnapshot: variant.snapshot, requestSeq: variant.seq } : message))).at(-1)!
      assert.equal(contextGroupTokens(replay.groups.find(group => group.category === 'assistant')!) === 100, variant.anchored, variant.id)
      assert.equal(replay.groups.reduce((sum, group) => sum + (contextGroupTokens(group) ?? 0), 0), 1300, variant.id)
    }
    return { input: 1300, retainedReasoning: 100, newToolInput: 200, currentOutputExcluded: 999,
      provenanceCases: variants.map(variant => ({ id: variant.id, outputAnchor: variant.anchored })) }
  })
  const server = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/run-redesign.tsx' })
  const launched = await launchWorkflowBrowser()
  const errors: string[] = []
  try {
    const page = await launched.browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    page.on('pageerror', error => errors.push(error.message))
    await gotoWithRetry(page, server.url)
    await page.waitForFunction(() => (window as unknown as { runRedesignFixture?: { ready: boolean } }).runRedesignFixture?.ready)
    const mount = async (id: string, evidence: Message[]) => {
      await page.evaluate(({ id, evidence }) => (window as unknown as { runRedesignFixture: { evidence(id: string, messages: Message[]): void } }).runRedesignFixture.evidence(id, evidence), { id, evidence })
      await page.getByRole('tab', { name: 'Context', exact: true }).click()
      await active(page).locator('[data-context-total]').waitFor()
    }
    await mount('integrity-captured', messages)
    await check('UI separates input history from text composition and content changes', async () => {
      const root = active(page)
      assert.equal(await root.locator('[data-context-total]').getAttribute('data-context-total'), '11000')
      for (const category of ['system', 'schemas', 'user']) assert.equal(await root.locator(`[data-context-category="${category}"] summary [data-context-change]`).count(), 0)
      const colors = await root.locator('[class*="barStack"] i').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
      assert(new Set(colors).size > 1, 'category colors must remain in the history bars')
      assert.equal(await root.locator('[data-provider-input-line]').count(), 0)
      const amounts = await root.locator('[data-context-category]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-context-tokens'))))
      assert.equal(amounts.reduce((sum, value) => sum + value, 0), 11_000)
      assert.match(await root.locator('[data-context-category="tool"]').innerText(), /Images: 1/)
      await page.screenshot({ path: join(run.directory, 'captured-context-light.png'), animations: 'disabled' })
      await root.getByRole('button', { name: 'Changes', exact: true }).click()
      await root.locator('[data-context-category="system"] summary').click()
      assert.match(await root.locator('[data-context-category="system"]').innerText(), /No content changes/)
      return { colors, textEstimate: projection(messages)[1].estimatedTokens }
    })
    await mount('integrity-schema', schemaChanged)
    await check('UI marks modified schema even when item count is unchanged', async () => {
      const root = active(page)
      assert.equal(await root.locator('[data-context-category="schemas"] summary [data-context-change="modified"]').count(), 1)
      await root.getByRole('button', { name: 'Changes', exact: true }).click()
      await root.locator('[data-context-category="schemas"] summary').click()
      await root.locator('[data-context-category="schemas"] [data-change="modified"]').waitFor()
      assert.equal(await root.locator('[data-context-category="schemas"] [data-change="modified"]').count(), 1)
      return 'one schema modification'
    })
    const local = process.env.PHANERIS_RUN_CONTEXT_SESSION
    if (local) await check('legacy real-session replay removes phantom deltas and image-driven collapse', async () => {
      const stored = readSessionJsonl(local)!
      assert(stored)
      const evidence = stored.messages.map(message => ({ ...message, role: message.type })) as Message[]
      const contexts = projection(evidence)
      const phantom: unknown[] = []
      for (let index = 1; index < contexts.length; index++) {
        for (const category of ['system', 'schemas', 'user']) {
          const before = contexts[index - 1].groups.find(group => group.category === category), after = contexts[index].groups.find(group => group.category === category)
          if (!contextItemChanges(after?.items ?? [], before?.items ?? []).length && before?.estimatedTokens !== after?.estimatedTokens) phantom.push({ request: index + 1, category })
          if (!contextItemChanges(after?.items ?? [], before?.items ?? []).length) assert.equal(after && contextGroupTokens(after), before && contextGroupTokens(before), `${index + 1}: ${category} attributed drift`)
        }
        const request = evidence.find(message => message.id === contexts[index].id)!
        assert.equal(contexts[index].inputTokens, request.usage!.input + request.usage!.cacheRead + request.usage!.cacheWrite)
        assert.equal(contexts[index].groups.reduce((sum, group) => sum + (contextGroupTokens(group) ?? 0), 0), contexts[index].inputTokens)
      }
      assert.deepEqual(phantom, [])
      if (contexts.length === 136) {
        assert.equal(contexts.at(-1)!.inputTokens, 211_294)
        assert.equal(contexts[37].groups.find(group => group.category === 'system')!.estimatedTokens, contexts[38].groups.find(group => group.category === 'system')!.estimatedTokens)
      }
      await mount('integrity-real', evidence)
      for (const mode of ['light', 'dark']) {
        if (mode === 'dark') { await gotoWithRetry(page, `${server.url}?mode=dark`); await mount('integrity-real-dark', evidence) }
        await page.screenshot({ path: join(run.directory, `real-context-${mode}.png`), animations: 'disabled' })
      }
      await page.getByRole('tab', { name: 'Overview', exact: true }).click()
      assert.equal(await active(page).locator('[data-run-occupancy]').getAttribute('data-context-total'), String(contexts.at(-1)!.inputTokens))
      assert(await active(page).locator('[data-context-occupancy-fill]').count() > 0)
      await page.screenshot({ path: join(run.directory, 'real-overview.png'), animations: 'disabled' })
      return { requests: contexts.length, input: contexts.at(-1)!.inputTokens, textEstimate: contexts.at(-1)!.estimatedTokens,
        attribution: contexts.at(-1)!.groups.map(group => ({ category: group.category, tokens: contextGroupTokens(group) })), phantom }
    })
    assert.deepEqual(errors, [])
    run.json('checks.json', { checks, errors })
    run.complete(checks.map(check => check.id), ['Live provider calls', 'Installed Electron renderer (production components mounted in Chromium)'])
    await page.close()
  } finally { await launched.close(); await server.close() }
})
