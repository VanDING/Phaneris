#!/usr/bin/env bun
/**
 * Runtime acceptance for the 2026-10-18 Pi upgrade, driven end to end.
 *
 * Every scene runs the *shipping* stack:
 *   - the real subprocess: `packages/pi-agent-server/dist/index.js`
 *   - the real host client: `packages/shared/src/agent/pi-agent.ts` (`PiAgent`)
 *   - a real loopback `Bun.serve` OpenAI chat-completions SSE provider on 127.0.0.1
 *
 * Nothing is mocked between the host and the model boundary: the assertions read
 * the JSONL rows the subprocess actually emitted, the events the host actually
 * adapted, and the request bodies the provider actually received.
 *
 *   PC-01  a mid-session model switch reaches the wire
 *   PC-02  malformed tool arguments are bounded, not fatal
 *   PC-03  a hard abort mid-stream leaves no orphan process
 *   PC-04  transient provider errors: SDK retry recovers / exhaustion is one error
 *   PC-05  the per-model output cap follows the selected model, compaction included
 *
 * Usage: bun run scripts/verification/upgrade-0153-pi-runtime-workflow.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
const evidence = new VerificationRun('upgrade-0153-pi-runtime')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const scenes: string[] = []
let failure: unknown

// --- models under test -------------------------------------------------------
// Two custom-endpoint models with deliberately different output caps AND
// different context windows, so a subprocess-reported window identifies which
// model the child actually resolved.
const MODEL_A = { id: 'fixture-a', contextWindow: 200_000, maxTokens: 16_384 }
const MODEL_B = { id: 'fixture-b', contextWindow: 131_072, maxTokens: 4_096 }
const CUSTOM_MODELS = [MODEL_A, MODEL_B]
const CUSTOM_ENDPOINT = { api: 'openai-completions' }
/** Small reported usage: never crosses the auto-compaction threshold. */
const PROMPT_TOKENS = 900
const COMPLETION_TOKENS = 12
/** Non-empty `messagesToSummarize` needs > keepRecentTokens (20 000) of history. */
const BULK_CHARS = 132_000

interface ProviderRequest {
  seq: number
  scene: string
  kind: 'chat' | 'compaction'
  at: number
  path: string
  status: number
  model?: string
  maxTokensField: 'max_tokens' | 'max_completion_tokens' | null
  maxTokens?: number
  messageCount: number
  roles: string[]
  toolCount: number
  toolNames: string[]
  bytes: number
  sha256: string
  contains: Record<string, boolean>
  toolMessages?: string[]
  chosenTool?: string
  malformedArguments?: string
  stalled?: boolean
}

type Outcome = 'passed' | 'failed'

const requests: ProviderRequest[] = []
const stalls: Array<{ close(): void }> = []

try {
  evidence.checkArguments()

  // ==========================================================================
  // Isolation: every run gets its own home, config root and workspace.
  // ==========================================================================
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-0153-pi-runtime-'))
  process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
  process.env.NODE_ENV = 'test'
  const workspace = join(fixture, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const sessionPath = (id: string) => join(workspace, 'sessions', id)

  const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
  const { AbortReason } = await import('../../packages/shared/src/agent/core/session-lifecycle')

  // ==========================================================================
  // The loopback provider fixture.
  //
  // Records one projection of every request body the subprocess puts on the
  // wire (model, output cap + the field production chose, message count/roles,
  // tool list, byte size and hash) plus the marker probes the scene asserts on.
  // The response is selected by the scene that is currently running.
  // ==========================================================================
  let scene = ''
  let sceneAttempt = 0
  let probes: string[] = []

  const encoder = new TextEncoder()
  const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
  const chunkFor = (record: ProviderRequest, delta: unknown, finishReason: string | null = null) => ({
    id: `fixture-${record.seq}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: record.model ?? 'fixture',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(finishReason
      ? { usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: COMPLETION_TOKENS, total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS } }
      : {}),
  })
  /** A finished stream: deltas, then a terminal `finish_reason` chunk with usage. */
  function sseResponse(
    record: ProviderRequest,
    deltas: unknown[],
    finishReason: string | null,
    options: { done?: boolean; usage?: boolean } = {},
  ) {
    const parts = deltas.map(delta => sse(chunkFor(record, delta)))
    if (finishReason) {
      parts.push(sse(chunkFor(record, {}, finishReason)))
      if (options.done !== false) parts.push('data: [DONE]\n\n')
    }
    return new Response(parts.join(''), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  }
  const textReply = (record: ProviderRequest, text: string) =>
    sseResponse(record, [{ role: 'assistant' }, { content: text }], 'stop')
  /** Provider failure bodies carry a scene-specific marker so the host-visible
   *  error text can be traced back to what the provider actually sent. */
  const FAILURE_MARKER: Record<string, string> = { 'pc-04a1': 'PC04A1_HTTP_500', 'pc-04b': 'PC04B_HTTP_500' }
  const retryable500 = () => new Response(JSON.stringify({
    error: {
      message: `${FAILURE_MARKER[scene] ?? 'FIXTURE_HTTP_500'} provider failure: upstream server error, service temporarily unavailable`,
      type: 'server_error',
      code: 'server_error',
    },
  }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  const REPLY: Record<string, string> = {
    'pc-01': 'PC_01_REPLY',
    'pc-02': 'PC02_RECOVERED_AFTER_BAD_TOOL',
    'pc-04a1': 'PC_04A1_REPLY',
    'pc-04a2': 'PC_04A2_REPLY',
    'pc-05': 'PC_05_REPLY',
  }

  const inference = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const raw = await request.text()
      let body: any = {}
      try { body = JSON.parse(raw) } catch { body = {} }
      sceneAttempt += 1

      const messages: any[] = Array.isArray(body.messages) ? body.messages : []
      const maxTokensField: ProviderRequest['maxTokensField'] = typeof body.max_tokens === 'number'
        ? 'max_tokens'
        : typeof body.max_completion_tokens === 'number' ? 'max_completion_tokens' : null
      const systemText = JSON.stringify(messages.filter((message: any) => message?.role === 'system').map((message: any) => message.content))
      // Marker probes look at the body both as sent and after JSON unescaping, so a
      // probe containing quotes ("{\"path\": ...") matches the quoted-tool-argument
      // form production actually puts on the wire.
      const unescaped = raw.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
      const probe = (needle: string) => raw.includes(needle) || unescaped.includes(needle)
      const record: ProviderRequest = {
        seq: requests.length + 1,
        scene,
        // The summarization request carries pi-coding-agent's summarization
        // system prompt (compaction/utils.js:145); nothing else does.
        kind: systemText.includes('context summarization assistant') ? 'compaction' : 'chat',
        at: Date.now(),
        path: new URL(request.url).pathname,
        status: 200,
        model: typeof body.model === 'string' ? body.model : undefined,
        maxTokensField,
        maxTokens: maxTokensField === 'max_tokens' ? body.max_tokens : maxTokensField === 'max_completion_tokens' ? body.max_completion_tokens : undefined,
        messageCount: messages.length,
        roles: messages.map((message: any) => String(message?.role)),
        toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
        toolNames: Array.isArray(body.tools) ? body.tools.map((tool: any) => String(tool?.function?.name ?? tool?.name ?? '?')) : [],
        bytes: Buffer.byteLength(raw),
        sha256: sha256(raw),
        contains: Object.fromEntries(probes.map(needle => [needle, probe(needle)])),
      }
      const toolMessages = messages
        .filter((message: any) => message?.role === 'tool')
        .map((message: any) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
      if (toolMessages.length > 0) record.toolMessages = toolMessages
      requests.push(record)

      switch (scene) {
        // PC-02: the first provider request answers with a tool call whose
        // `arguments` is not valid JSON; the follow-up request is a normal reply.
        case 'pc-02': {
          if (sceneAttempt === 1) {
            const chosen = record.toolNames.includes('Read') ? 'Read' : record.toolNames[0]
            record.chosenTool = chosen
            record.malformedArguments = '{"path": "unterminated'
            return sseResponse(record, [
              { role: 'assistant' },
              { tool_calls: [{ index: 0, id: 'call-malformed', type: 'function', function: { name: chosen, arguments: record.malformedArguments } }] },
            ], 'tool_calls')
          }
          return textReply(record, REPLY['pc-02']!)
        }
        // PC-03: a provider that streams a few deltas and then stalls forever.
        case 'pc-03': {
          record.stalled = true
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              let closed = false
              const push = (delta: unknown) => {
                if (closed) return
                try { controller.enqueue(encoder.encode(sse(chunkFor(record, delta)))) } catch { closed = true }
              }
              push({ role: 'assistant' })
              for (const text of ['PC03_PARTIAL_ALPHA ', 'PC03_PARTIAL_BETA ', 'PC03_PARTIAL_GAMMA ']) push({ content: text })
              stalls.push({
                close() {
                  if (closed) return
                  closed = true
                  try { controller.close() } catch { /* already torn down */ }
                },
              })
              // Never close: the turn stays open until the host aborts it.
            },
          })
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        }
        // PC-04(a1): two retryable HTTP 500s, then a normal reply.
        case 'pc-04a1':
          if (sceneAttempt <= 2) { record.status = 500; return retryable500() }
          return textReply(record, REPLY['pc-04a1']!)
        // PC-04(a2): a stream that fails after streaming text (no finish_reason),
        // then a normal reply on the SDK's agent-level retry.
        case 'pc-04a2':
          if (sceneAttempt === 1) {
            return sseResponse(record, [{ role: 'assistant' }, { content: 'PC04A2_PARTIAL ' }, { content: 'PC04A2_PARTIAL_MORE ' }], null, { done: false })
          }
          return textReply(record, REPLY['pc-04a2']!)
        // PC-04(b): every attempt fails with a retryable 500.
        case 'pc-04b':
          record.status = 500
          return retryable500()
        default:
          return textReply(record, REPLY[scene] ?? `${scene.toUpperCase()}_REPLY`)
      }
    },
  })
  const providerUrl = inference.url.href
  const sceneRequests = (id: string) => requests.filter(record => record.scene === id)

  // ==========================================================================
  // Process accounting: every child this workflow spawns is tracked by pid and
  // checked with both a signal-0 probe and tasklist (the Windows equivalent).
  // ==========================================================================
  interface PidRecord { scene: string; pid: number | null }

  const spawned: PidRecord[] = []
  const exits = new Map<number, { code: number | null; signal: string | null; at: number }>()
  const teardowns = new Map<number, ReturnType<typeof processState>>()

  function processState(pid: number) {
    let killProbe: string
    try { process.kill(pid, 0); killProbe = 'alive' } catch (error: any) { killProbe = String(error?.code ?? error?.message ?? 'unknown') }
    const listing = Bun.spawnSync(['tasklist', '/FI', `PID eq ${pid}`, '/NH']).stdout.toString()
    const first = listing.split('\n').map(line => line.trim()).filter(Boolean)[0] ?? ''
    return {
      pid,
      killProbe,
      tasklisted: listing.includes(String(pid)),
      image: first.split(/\s+/)[0] ?? '',
      listing: first,
      exit: exits.get(pid) ?? null,
    }
  }

  async function waitForExit(pid: number | null, timeoutMs = 20_000) {
    assert.equal(typeof pid, 'number', 'the subprocess pid must be observable')
    const deadline = Date.now() + timeoutMs
    let state = processState(pid!)
    while ((state.tasklisted || state.killProbe === 'alive') && Date.now() < deadline) {
      await Bun.sleep(50)
      state = processState(pid!)
    }
    // The 'exit' notification can trail the process table; give the child's own
    // exit code a moment to arrive so the artifact can record it.
    const exitDeadline = Date.now() + 2_000
    while (!exits.has(pid!) && Date.now() < exitDeadline) {
      await Bun.sleep(20)
      state = processState(pid!)
    }
    return state
  }

  function childPid(agent: any): number | null {
    const child = agent.subprocess
    return typeof child?.pid === 'number' ? child.pid : null
  }

  function trackChild(agent: any, id: string) {
    const pid = childPid(agent)
    spawned.push({ scene: id, pid })
    if (pid !== null) {
      agent.subprocess.once('exit', (code: number | null, signal: string | null) => {
        exits.set(pid, { code, signal, at: Date.now() })
      })
    }
    return pid
  }

  // ==========================================================================
  // Agent harness (mirrors scripts/verification/upgrade-0153-b1-workflow.ts).
  // ==========================================================================
  let sequence = 0

  function createAgent(id: string, model: string) {
    mkdirSync(sessionPath(id), { recursive: true })
    const agent = new PiAgent({
      provider: 'pi',
      providerType: 'pi_compat',
      authType: 'api_key',
      model,
      miniModel: model,
      workspace: { id: 'pi-runtime', name: 'Pi runtime fixture', rootPath: workspace },
      session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 },
      isHeadless: true,
      // Auto-compaction off: PC-05 exercises the manual path deliberately.
      contextPolicy: 'manual',
      runtime: {
        paths: { piServer: join(root, 'packages/pi-agent-server/dist/index.js'), node: process.execPath },
        baseUrl: providerUrl,
        customEndpoint: CUSTOM_ENDPOINT,
        customModels: CUSTOM_MODELS,
      },
      envOverrides: {
        HOME: fixture,
        USERPROFILE: fixture,
        PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!,
        NODE_ENV: 'test',
      },
    } as any) as any

    // Raw JSONL from the subprocess: every row is kept, unmodified.
    agent.wire = [] as any[]
    const handle = agent.handleLine.bind(agent)
    agent.handleLine = (line: string) => {
      try { agent.wire.push(JSON.parse(line)) } catch { /* invalid JSONL is not ours to assert */ }
      return handle(line)
    }
    // Outbound host→subprocess messages, projected (never the full prompt).
    agent.outbound = [] as any[]
    const send = agent.send.bind(agent)
    agent.send = (message: any) => {
      agent.outbound.push({
        type: message?.type,
        id: message?.id,
        model: message?.model,
        keys: Object.keys(message ?? {}).sort(),
        messageBytes: typeof message?.message === 'string' ? Buffer.byteLength(message.message) : undefined,
      })
      return send(message)
    }
    return agent
  }

  const wireRows = (agent: any, since = 0) => agent.wire.slice(since) as any[]
  const eventRows = (agent: any, since = 0, type?: string) =>
    wireRows(agent, since).filter(row => row.type === 'event' && (!type || row.event?.type === type))
  const outbound = (agent: any, type: string) => (agent.outbound as any[]).filter(row => row.type === type)

  async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function waitFor<T>(probe: () => T | undefined | null | false, ms: number, label: string): Promise<T> {
    const deadline = Date.now() + ms
    for (;;) {
      const value = probe()
      if (value) return value as T
      if (Date.now() > deadline) throw new Error(`Timed out after ${ms}ms waiting for ${label}`)
      await Bun.sleep(10)
    }
  }

  /** Start a real `PiAgent.chat()` turn; the generator is the production consumer. */
  function startTurn(agent: any, message: string) {
    const events: any[] = []
    const started = agent.wire.length
    const done = (async () => {
      for await (const event of agent.chat(message)) events.push(event)
    })()
    return { events, started, done }
  }

  /** Wait for the subprocess' own terminal boundary for this turn. */
  async function settleTurn(agent: any, turn: { started: number; done: Promise<void> }, label: string, timeoutMs = 90_000) {
    await withDeadline(turn.done, timeoutMs, `${label}: chat generator`)
    const settled = await waitFor(
      () => eventRows(agent, turn.started, 'agent_settled').at(-1),
      20_000,
      `${label}: agent_settled`,
    )
    assert.equal(agent.isProcessing(), false, `${label}: the host must be idle after settling`)
    return settled
  }

  const finalTexts = (events: any[]) => events.filter(event => event.type === 'text_complete' && event.isIntermediate !== true)
  const errorsOf = (events: any[]) => events.filter(event => event.type === 'error' || event.type === 'typed_error')
  const toolResultText = (result: any): string => {
    if (typeof result === 'string') return result
    const content = result?.content
    if (Array.isArray(content)) {
      return content.filter((part: any) => part?.type === 'text' && typeof part.text === 'string').map((part: any) => part.text).join('\n')
    }
    return JSON.stringify(result)
  }
  const requestView = (record: ProviderRequest) => ({
    seq: record.seq,
    scene: record.scene,
    kind: record.kind,
    at: new Date(record.at).toISOString(),
    path: record.path,
    status: record.status,
    model: record.model,
    outputCap: { field: record.maxTokensField, value: record.maxTokens },
    messageCount: record.messageCount,
    roles: record.roles,
    toolCount: record.toolCount,
    bytes: record.bytes,
    sha256: record.sha256,
    contains: record.contains,
    ...(record.toolMessages ? { toolMessages: record.toolMessages } : {}),
    ...(record.chosenTool ? { chosenTool: record.chosenTool } : {}),
    ...(record.malformedArguments ? { malformedArguments: record.malformedArguments } : {}),
  })

  /**
   * Production teardown, then prove the child is gone while its pid cannot yet
   * have been recycled: the ChildProcess exit event plus a signal-0 probe and
   * tasklist immediately after `disposeForRestart()`/`destroy()`.
   */
  async function teardown(agent: any) {
    const pid = childPid(agent)
    await agent.disposeForRestart()
    agent.destroy()
    const state = await waitForExit(pid)
    assert.ok(state.exit, `child ${pid} must report its own exit (code/signal)`)
    assert.equal(state.killProbe, 'ESRCH', `child ${pid} must not answer a signal-0 probe: ${JSON.stringify(state)}`)
    assert.equal(state.tasklisted, false, `tasklist must not list child ${pid}: ${JSON.stringify(state)}`)
    if (pid !== null) teardowns.set(pid, state)
    return state
  }

  const pidEvidence = () => spawned.map(entry => entry.pid === null
    ? { scene: entry.scene, pid: null, state: null }
    : { scene: entry.scene, ...processState(entry.pid) })

  // ==========================================================================
  // PC-01 — a mid-session model switch reaches the wire.
  // ==========================================================================
  {
    scene = 'pc-01'
    sceneAttempt = 0
    probes = ['PC_01_REPLY', 'PC01_TURN_ONE']
    const agent = createAgent('pc-01-session', `pi/${MODEL_A.id}`)
    await agent.ensureSubprocess()
    const pid = trackChild(agent, 'pc-01')
    try {
      const first = startTurn(agent, 'PC01_TURN_ONE first prompt, model A is selected')
      const firstSettled = await settleTurn(agent, first, 'pc-01 turn 1')
      const [requestA] = sceneRequests('pc-01')
      assert.equal(requestA?.model, MODEL_A.id, 'the first provider request must carry model A')
      assert.equal(requestA?.maxTokens, MODEL_A.maxTokens, 'model A must cap output at its own maxTokens')
      assert.equal(firstSettled.event.aborted, false)

      // The production runtime-config switch (the exact host→subprocess message
      // `update_runtime_config` used by SessionManager.tryRefreshAgentRuntime).
      const acknowledged = await agent.updateRuntimeConfig({
        model: `pi/${MODEL_B.id}`,
        providerType: 'pi_compat',
        authType: 'api_key',
        runtime: {
          baseUrl: providerUrl,
          customEndpoint: CUSTOM_ENDPOINT,
          customModels: CUSTOM_MODELS,
        },
      })
      assert.equal(acknowledged, true, 'the subprocess must acknowledge update_runtime_config')
      assert.equal(outbound(agent, 'update_runtime_config').length, 1)
      const configResult = await waitFor(
        () => wireRows(agent).find(row => row.type === 'update_runtime_config_result'),
        10_000,
        'update_runtime_config_result',
      )
      assert.equal(configResult.success, true, JSON.stringify(configResult))
      assert.equal(configResult.updated, true)
      // The reply carries no model string (packages/pi-agent-server/src/index.ts:1976
      // sends `{ success, updated, contextWindow }`), so the window is the
      // discriminator: only model B has 131 072.
      assert.equal(configResult.contextWindow, MODEL_B.contextWindow,
        'the acknowledged window must be model B\'s, proving the child resolved and applied it')

      const second = startTurn(agent, 'PC01_TURN_TWO second prompt after the switch')
      const secondSettled = await settleTurn(agent, second, 'pc-01 turn 2')
      const requestsAfterSwitch = sceneRequests('pc-01')
      assert.equal(requestsAfterSwitch.length, 2, 'exactly one provider request per turn')
      assert.equal(requestsAfterSwitch[1]!.model, MODEL_B.id, 'the second provider request must carry model B')
      assert.equal(requestsAfterSwitch[1]!.maxTokens, MODEL_B.maxTokens, 'the cap must follow the switched model')
      // The subprocess also re-reports occupancy at every boundary; after the
      // switch that snapshot is taken through the new model (session-event-adapter.ts:203-210).
      assert.equal(secondSettled.event.contextUsage?.contextWindow, MODEL_B.contextWindow,
        'the settled-turn context_usage must report model B\'s window')

      // The other production switch — `PiAgent.setModel()` → `set_model` — is the
      // one that reports the model *string* back to the host.
      agent.setModel(`pi/${MODEL_A.id}`)
      const setModelResult = await waitFor(
        () => wireRows(agent).find(row => row.type === 'set_model_result'),
        10_000,
        'set_model_result',
      )
      assert.equal(setModelResult.model, `pi/${MODEL_A.id}`, 'the subprocess must report the new model string')
      assert.equal(setModelResult.contextWindow, MODEL_A.contextWindow)

      const third = startTurn(agent, 'PC01_TURN_THREE back on model A')
      await settleTurn(agent, third, 'pc-01 turn 3')
      const finalRequests = sceneRequests('pc-01')
      assert.equal(finalRequests[2]!.model, MODEL_A.id,
        'the wire must follow the model the subprocess reported to the host')

      const exit = await teardown(agent)
      assert.equal(exit.killProbe, 'ESRCH', `the subprocess must be gone: ${JSON.stringify(exit)}`)
      assert.equal(exit.tasklisted, false)

      evidence.json('pi-model-switch.json', {
        scene: 'pc-01-model-switch-reaches-the-wire',
        models: { a: MODEL_A, b: MODEL_B },
        requests: finalRequests.map(requestView),
        switchMechanism: {
          method: 'PiAgent.updateRuntimeConfig() → update_runtime_config',
          hostMessage: outbound(agent, 'update_runtime_config'),
          acknowledgement: configResult,
          note: 'update_runtime_config_result carries no model string; it reports the resolved model contextWindow (pi-agent-server/src/index.ts:1975-1976).',
        },
        hostVisibleModelReport: {
          path: 'PiAgent.setModel() → set_model → set_model_result',
          row: setModelResult,
        },
        settledTurns: [
          { turn: 1, aborted: firstSettled.event.aborted, contextWindow: firstSettled.event.contextUsage?.contextWindow ?? null },
          { turn: 2, aborted: secondSettled.event.aborted, contextWindow: secondSettled.event.contextUsage?.contextWindow ?? null },
        ],
        observation: 'Every provider request in this scene used the output-cap field production picked for a loopback custom endpoint.',
        pids: pidEvidence(),
        pid,
      })
      scenes.push('pc-01-model-switch-mid-session')
    } finally {
      if (agent.subprocess) await agent.disposeForRestart().catch(() => {})
      agent.destroy()
    }
  }

  // ==========================================================================
  // PC-02 — malformed tool arguments are bounded, not fatal.
  // ==========================================================================
  {
    scene = 'pc-02'
    sceneAttempt = 0
    probes = ['PC02_RECOVERED_AFTER_BAD_TOOL', '{"path": "unterminated', 'Invalid arguments for tool']
    const agent = createAgent('pc-02-session', `pi/${MODEL_A.id}`)
    await agent.ensureSubprocess()
    const pid = trackChild(agent, 'pc-02')
    try {
      const turn = startTurn(agent, 'PC02 read a file, then answer')
      await settleTurn(agent, turn, 'pc-02 malformed-tool turn')
      const [malformed, followUp] = sceneRequests('pc-02')
      assert.ok(malformed, 'the fixture must have answered the tool call')
      assert.ok(followUp, 'the malformed call must be followed by another model request')
      assert.equal(sceneRequests('pc-02').length, 2, 'the malformed call must not spin into extra requests')
      const toolName = malformed.chosenTool!
      assert.ok(toolName, 'a tool name must have been chosen for the malformed call')
      assert.ok(malformed.toolNames.includes(toolName),
        `the malformed call must name a tool the session really exposes (${toolName})`)

      // The subprocess stayed alive: same child, and the turn reached agent_settled.
      assert.equal(childPid(agent), pid, 'the subprocess must not have restarted')

      // The bounded error, exactly as the SDK surfaced it.
      const endRow = await waitFor(
        () => eventRows(agent, turn.started, 'tool_execution_end')[0],
        10_000,
        'tool_execution_end for the malformed call',
      )
      assert.equal(endRow.event.isError, true, 'the malformed call must be an error result, not a crash')
      const bounded = toolResultText(endRow.event.result)
      assert.ok(bounded.startsWith(`Invalid arguments for tool "${toolName}": `),
        `unexpected bounded error text: ${bounded.slice(0, 200)}`)
      assert.ok(bounded.includes('Received arguments:'), 'the error must quote the malformed payload')
      assert.ok(bounded.includes(malformed.malformedArguments!), 'the error must include the exact arguments the model sent')
      assert.ok(bounded.length < 2_000, 'the bounded error must stay small')

      // The adapted host event mirrors it.
      const adapted = turn.events.filter(event => event.type === 'tool_result')
      assert.equal(adapted.length, 1, 'exactly one tool result must reach the host')
      assert.equal(adapted[0]!.isError, true)
      assert.equal(adapted[0]!.result, bounded, 'the host must see the same bounded text')

      // Observation recorded for the report: the SDK does announce the call
      // (tool_execution_start on the wire) but the host buffers every tool start
      // until a durable prepare flushes it (pi-agent.ts:1132-1135 → 1791-1799).
      // A call that fails validation never reaches that path, so the host
      // publishes the result with the fallback name and no matching start.
      const startRows = eventRows(agent, turn.started, 'tool_execution_start')
      const publishedStarts = turn.events.filter(event => event.type === 'tool_start')
      assert.equal(startRows.length, 1, 'the SDK must announce the tool call to the host')
      assert.equal(publishedStarts.length, 0, 'the unflushed start is not published as a host tool_start')
      assert.equal(adapted[0]!.toolName, 'tool',
        'without a flushed start the host falls back to the generic tool name (event-adapter.ts:863)')

      // What the model itself saw, in the very next provider request.
      const seen = followUp.toolMessages?.[0]
      assert.ok(seen, 'the follow-up request must carry the tool result back to the model')
      assert.equal(seen, bounded, 'the model must receive the bounded error text verbatim')
      assert.ok(followUp.contains[malformed.malformedArguments!] === true,
        'the raw malformed arguments must be quoted back to the model')

      // The turn still produced a normal answer, and the subprocess kept serving.
      const completed = finalTexts(turn.events)
      assert.equal(completed.length, 1)
      assert.ok(String(completed[0]!.text).includes('PC02_RECOVERED_AFTER_BAD_TOOL'))
      assert.equal(errorsOf(turn.events).length, 0, 'a malformed tool call must not become a user-visible error')
      assert.equal(wireRows(agent, turn.started).filter(row => row.type === 'error').length, 0)

      const nextTurn = startTurn(agent, 'PC02 second turn after the malformed call')
      await settleTurn(agent, nextTurn, 'pc-02 following turn')
      const pidDuringTurn = childPid(agent)
      assert.equal(pidDuringTurn, pid, 'the subprocess must still be the same live child')
      assert.equal(finalTexts(nextTurn.events).length, 1, 'the following turn must complete normally')

      const exit = await teardown(agent)
      assert.equal(exit.killProbe, 'ESRCH')

      evidence.json('pi-malformed-tools.json', {
        scene: 'pc-02-malformed-tool-arguments-are-bounded',
        requests: sceneRequests('pc-02').map(requestView),
        toolCall: { name: toolName, arguments: malformed.malformedArguments, id: 'call-malformed' },
        boundedError: { rawWireRow: endRow, hostEvent: adapted[0], modelSaw: seen, length: bounded.length },
        hostToolStart: {
          sdkAnnouncedOnWire: startRows.map(row => row.event),
          publishedAsHostToolStart: publishedStarts.length,
          hostToolResultName: adapted[0]!.toolName,
          note: 'Minor, pre-existing fidelity gap (NOT fixed by this workflow): a tool call that never reaches execute() has no durable prepare, so its buffered tool_execution_start is dropped (pi-agent.ts:1132-1135 buffers; only pi-agent.ts:1791-1799 flushes) and the host emits the error tool_result with the fallback name "tool" (event-adapter.ts:863). The PostToolUseFailure hook payload (pi-agent.ts:1471-1484) therefore also reports tool_name "tool".',
          proposedMinimalFix: 'In the tool_execution_end branch of PiAgent.handleSubprocessEvent (pi-agent.ts:1445-1450), flush and clear any entry still held in bufferedDurableToolStarts for that toolCallId before adapting the end event.',
        },
        subprocess: {
          pidBefore: pid,
          pidAfterBothTurns: pidDuringTurn,
          restarted: pidDuringTurn !== pid,
          exitAfterDispose: exit,
        },
        derivation: 'pi-ai parses a finished tool call with parseToolCallArguments (utils/json-parse.js:91-107); invalid JSON becomes argumentsError, and validateToolArguments throws "Invalid arguments for tool …" before any tool runs (utils/validation.js:280-283). The agent loop turns that throw into an immediate error tool result (agent-loop.js:481-539).',
        pids: pidEvidence(),
      })
      scenes.push('pc-02-malformed-tool-arguments')
    } finally {
      if (agent.subprocess) await agent.disposeForRestart().catch(() => {})
      agent.destroy()
    }
  }

  // ==========================================================================
  // PC-03 — a hard abort mid-stream leaves no orphan.
  // ==========================================================================
  {
    scene = 'pc-03'
    sceneAttempt = 0
    probes = ['PC03_PARTIAL_ALPHA']
    const agent = createAgent('pc-03-session', `pi/${MODEL_A.id}`)
    await agent.ensureSubprocess()
    const pid = trackChild(agent, 'pc-03')
    try {
      const turn = startTurn(agent, 'PC03 stream a few deltas, then stall')
      const delta = await waitFor(
        () => turn.events.find(event => event.type === 'text_delta' && String(event.text).includes('PC03_PARTIAL_ALPHA')),
        30_000,
        'the stalled provider to start streaming text',
      )
      assert.ok(delta, 'the provider must have streamed text before the abort')
      assert.equal(outbound(agent, 'abort').length, 0)

      // The production hard-abort path (the one SessionManager uses for a stop).
      agent.forceAbort(AbortReason.UserStop)
      assert.equal(outbound(agent, 'abort').length, 1, 'forceAbort must send the abort message to the subprocess')

      await withDeadline(turn.done, 30_000, 'pc-03: aborted chat generator')
      const settled = await waitFor(
        () => eventRows(agent, turn.started, 'agent_settled').at(-1),
        20_000,
        'pc-03: agent_settled after the abort',
      )
      // The exact terminal flag: pi-coding-agent emits agent_settled with
      // `aborted = _agentRunAbortRequested` (agent-session.js:684-692).
      assert.equal(settled.event.aborted, true, 'the SDK must report the turn as aborted')
      assert.equal(agent.isProcessing(), false)

      // No partial answer is published as a final message.
      assert.equal(finalTexts(turn.events).length, 0, 'an aborted turn must not publish a final text_complete')

      // Exactly one provider request for the aborted turn, and none afterwards.
      assert.equal(sceneRequests('pc-03').length, 1)
      const requestsAtAbort = requests.length
      await Bun.sleep(1_500)
      assert.equal(requests.length, requestsAtAbort, 'no provider request may follow the abort')

      for (const stall of stalls.splice(0)) stall.close()
      const exit = await teardown(agent)
      assert.equal(exit.killProbe, 'ESRCH', `the subprocess must exit after disposeForRestart: ${JSON.stringify(exit)}`)
      assert.equal(exit.tasklisted, false, 'tasklist must not list the child any more')
      assert.ok(exit.exit, 'the child exit must have been observed')

      evidence.json('pi-abort.json', {
        scene: 'pc-03-hard-abort-mid-stream',
        abortPath: {
          method: 'PiAgent.forceAbort(AbortReason.UserStop)',
          hostMessage: outbound(agent, 'abort'),
          subprocessHandler: 'pi-agent-server case "abort" → AgentSession.abort()',
        },
        terminalBoundary: {
          assertedEvent: 'event.agent_settled',
          assertedFlag: 'event.aborted === true',
          rawRow: settled,
          hostIsProcessing: agent.isProcessing(),
          finalTextCompletes: finalTexts(turn.events).length,
        },
        provider: {
          requests: sceneRequests('pc-03').map(requestView),
          requestsAfterAbortSettled: requests.length - requestsAtAbort,
          observationWindowMs: 1_500,
        },
        child: { pid, exit, stateAfter: processState(pid!) },
        pids: pidEvidence(),
      })
      scenes.push('pc-03-abort-mid-stream-no-orphan')
    } finally {
      for (const stall of stalls.splice(0)) stall.close()
      if (agent.subprocess) await agent.disposeForRestart().catch(() => {})
      agent.destroy()
    }
  }

  // ==========================================================================
  // PC-04(a1) — two retryable HTTP 500s are recovered before the stream starts.
  // ==========================================================================
  {
    scene = 'pc-04a1'
    sceneAttempt = 0
    probes = ['PC_04A1_REPLY']
    const agent = createAgent('pc-04a1-session', `pi/${MODEL_A.id}`)
    await agent.ensureSubprocess()
    trackChild(agent, 'pc-04a1')
    try {
      const turn = startTurn(agent, 'PC04A1 a transient provider failure')
      await settleTurn(agent, turn, 'pc-04a1', 90_000)
      const attempts = sceneRequests('pc-04a1')
      assert.equal(attempts.length, 3, 'two retryable 500s plus the recovered request')
      assert.deepEqual(attempts.map(record => record.status), [500, 500, 200])
      for (const attempt of attempts) assert.equal(attempt.model, MODEL_A.id, 'a retry must not change the model')
      // Retries happen at the provider boundary (pi-ai retryProviderRequest,
      // PHANERIS_PI_RETRY_SETTINGS.provider.maxRetries = 2), so the SDK's
      // agent-level auto_retry_* events never fire and nothing user-visible is
      // surfaced — that is production behaviour, asserted, not assumed.
      assert.equal(eventRows(agent, turn.started, 'auto_retry_start').length, 0,
        'pre-stream provider retries are silent in the SDK event stream')
      assert.equal(eventRows(agent, turn.started, 'auto_retry_end').length, 0)
      assert.equal(errorsOf(turn.events).length, 0, 'a recovered attempt must not surface an error')
      assert.equal(turn.events.filter(event => event.type === 'text_discard').length, 0,
        'nothing streamed on the failed attempts, so nothing is discarded')
      const completed = finalTexts(turn.events)
      assert.equal(completed.length, 1, 'exactly one successful settled turn')
      assert.ok(String(completed[0]!.text).includes('PC_04A1_REPLY'))
      assert.equal(eventRows(agent, turn.started, 'agent_settled').length, 1)
      assert.equal(eventRows(agent, turn.started, 'agent_settled')[0]!.event.aborted, false)

      await teardown(agent)
      evidence.json('pi-retry.json', {
        scene: 'pc-04-sdk-retry',
        providerLevel: {
          description: 'Fixture returned two HTTP 500 responses, then a normal stream. Recovered inside one SDK request chain.',
          attempts: attempts.map(requestView),
          retryPolicy: { source: 'packages/pi-agent-server/src/session-settings.ts', providerMaxRetries: 2, agentMaxRetries: 4, agentBaseDelayMs: 2_000 },
          sdkRetryEvents: { autoRetryStart: 0, autoRetryEnd: 0, textDiscard: 0 },
          productionBehaviour: 'Provider-level retries are pre-stream and silent: no auto_retry_* event is emitted because no assistant message ever failed.',
          hostOutcome: { settledTurns: 1, finalText: completed[0]!.text, errorEvents: errorsOf(turn.events).length },
        },
        pids: pidEvidence(),
      })
      scenes.push('pc-04a-transient-provider-error-recovered')
    } finally {
      if (agent.subprocess) await agent.disposeForRestart().catch(() => {})
      agent.destroy()
    }
  }

  // ==========================================================================
  // PC-04(a2) — a mid-stream failure is recovered by the SDK's agent-level retry.
  // ==========================================================================
  {
    scene = 'pc-04a2'
    sceneAttempt = 0
    probes = ['PC04A2_PARTIAL', 'PC_04A2_REPLY']
    const agent = createAgent('pc-04a2-session', `pi/${MODEL_A.id}`)
    await agent.ensureSubprocess()
    trackChild(agent, 'pc-04a2')
    try {
      const turn = startTurn(agent, 'PC04A2 a stream that dies after the first deltas')
      await settleTurn(agent, turn, 'pc-04a2', 120_000)
      const attempts = sceneRequests('pc-04a2')
      assert.equal(attempts.length, 2, 'one failed stream plus one retried stream')
      assert.deepEqual(attempts.map(record => record.status), [200, 200])
      assert.equal(attempts[1]!.contains['PC04A2_PARTIAL'], false,
        'the failed attempt must be omitted from the retried model projection')

      const retried = eventRows(agent, turn.started, 'auto_retry_start')
      assert.equal(retried.length, 1, 'the SDK agent-level retry must announce exactly one retry')
      assert.equal(retried[0]!.event.attempt, 1)
      assert.equal(retried[0]!.event.maxAttempts, 4, 'PHANERIS_PI_RETRY_SETTINGS.maxRetries')
      assert.equal(retried[0]!.event.delayMs, 2_000, 'baseDelayMs * 2^(attempt-1)')

      const discards = turn.events.filter(event => event.type === 'text_discard')
      assert.equal(discards.length, 1, 'the failed attempt must discard its streamed text exactly once')
      const deltas = turn.events.filter(event => event.type === 'text_delta')
      assert.ok(deltas.length > 0, 'the failed attempt must have streamed text to discard')
      const failedDeltas = deltas.filter(event => event.turnId === discards[0]!.turnId)
      assert.ok(failedDeltas.length > 0, 'the discard identity must own the failed attempt deltas')
      assert.ok(failedDeltas.map(event => String(event.text)).join('').includes('PC04A2_PARTIAL'))

      const completed = finalTexts(turn.events)
      assert.equal(completed.length, 1, 'exactly one answer for the recovered turn')
      assert.ok(String(completed[0]!.text).includes('PC_04A2_REPLY'))
      assert.equal(String(completed[0]!.text).includes('PC04A2_PARTIAL'), false, 'the discarded text must not be duplicated')

      const retriedEnd = eventRows(agent, turn.started, 'auto_retry_end')
      assert.equal(retriedEnd.length, 1)
      assert.equal(retriedEnd[0]!.event.success, true)
      assert.ok(turn.events.some(event => event.type === 'retry' && event.phase === 'backoff'), 'retry backoff stage')
      assert.ok(turn.events.some(event => event.type === 'retry' && event.phase === 'end'), 'retry end stage')
      assert.ok(turn.events.some(event => event.type === 'info' && String(event.message).includes('Recovered after 1 retry')))
      assert.equal(errorsOf(turn.events).length, 0, 'a recovered retry must not surface an error')
      assert.equal(wireRows(agent, turn.started).filter(row => row.type === 'error').length, 0)
      assert.equal(eventRows(agent, turn.started, 'agent_settled').length, 1)

      await teardown(agent)
      evidence.json('pi-retry-midstream.json', {
        scene: 'pc-04a2-mid-stream-failure-recovered',
        attempts: attempts.map(requestView),
        sdkRetryEvents: {
          autoRetryStart: retried.map(row => row.event),
          autoRetryEnd: retriedEnd.map(row => row.event),
          hostRetryStages: turn.events.filter(event => event.type === 'retry'),
          info: turn.events.filter(event => event.type === 'info'),
        },
        discard: {
          identity: discards[0]!.turnId,
          deltasDiscarded: failedDeltas.map(event => event.text),
          assertText: 'the final text_complete contains the retried answer only',
        },
        hostOutcome: { settledTurns: 1, finalText: completed[0]!.text, errorEvents: errorsOf(turn.events).length },
        derivation: 'A stream that ends without finish_reason throws "Stream ended without finish_reason" (pi-ai openai-completions.js:487-488) → handleRunFailure marks the assistant message stopReason "error" (pi-agent-core agent.js:364-379) → isRetryableAssistantError matches "ended without" (pi-ai utils/retry.js:76) → PiEventAdapter emits text_discard and parks the error for the retry (event-adapter.ts:594-631).',
        pids: pidEvidence(),
      })
      scenes.push('pc-04b-mid-stream-error-retried')
    } finally {
      if (agent.subprocess) await agent.disposeForRestart().catch(() => {})
      agent.destroy()
    }
  }

  // ==========================================================================
  // PC-04(b) — exhausted retries surface exactly one typed error.
  // ==========================================================================
  {
    scene = 'pc-04b'
    sceneAttempt = 0
    probes = ['PC04B']
    const agent = createAgent('pc-04b-session', `pi/${MODEL_A.id}`)
    await agent.ensureSubprocess()
    trackChild(agent, 'pc-04b')
    try {
      const started = Date.now()
      const turn = startTurn(agent, 'PC04B a provider that never recovers')
      await settleTurn(agent, turn, 'pc-04b exhausted retries', 180_000)
      const elapsedMs = Date.now() - started

      const errors = errorsOf(turn.events)
      assert.equal(errors.length, 1, `exactly one typed error must reach the host: ${JSON.stringify(errors)}`)
      assert.equal(errors[0]!.type, 'typed_error', `the production classifier must type it: ${JSON.stringify(errors[0])}`)
      // The production text is ERROR_DEFINITIONS.service_error (agent/errors.ts:413 selects
      // the code from the "500" in the raw message; the user-facing strings come from
      // the definition, the raw provider text stays on `originalError`).
      const typedError = errors[0]!.error
      assert.equal(typedError?.code, 'service_error', 'a retryable 500 is classified as service_error (agent/errors.ts:413)')
      assert.equal(typedError?.title, 'Service Error')
      assert.equal(typedError?.message, 'The AI service is temporarily unavailable. This usually resolves on its own.')
      assert.equal(typedError?.canRetry, true)
      const rawProviderText = String(typedError?.originalError ?? '')
      assert.ok(rawProviderText.length > 0, 'the raw provider failure text must be preserved on the typed error')
      assert.ok(rawProviderText.includes('PC04B_HTTP_500'),
        `the provider's own failure body must reach the host unchanged: ${rawProviderText}`)
      assert.match(rawProviderText, /50\d|server|unavailable/i,
        `the raw text must identify the provider failure: ${rawProviderText}`)
      assert.equal(turn.events.filter(event => event.type === 'complete').length, 1, 'the turn must settle exactly once')
      assert.equal(eventRows(agent, turn.started, 'agent_settled').length, 1)
      assert.equal(eventRows(agent, turn.started, 'agent_settled')[0]!.event.aborted, false)

      const retried = eventRows(agent, turn.started, 'auto_retry_start')
      assert.equal(retried.length, 4, 'exactly PHANERIS_PI_RETRY_SETTINGS.maxRetries retries')
      assert.deepEqual(retried.map(row => row.event.attempt), [1, 2, 3, 4])
      assert.deepEqual(retried.map(row => row.event.delayMs), [2_000, 4_000, 8_000, 16_000], 'exponential backoff')
      assert.deepEqual(retried.map(row => row.event.maxAttempts), [4, 4, 4, 4])

      const attempts = sceneRequests('pc-04b')
      // 5 agent attempts (initial + 4 retries) x (1 request + 2 provider retries).
      assert.equal(attempts.length, 15, 'each agent attempt must burn its own provider-retry budget')
      assert.ok(attempts.every(record => record.status === 500))
      assert.ok(attempts.every(record => record.model === MODEL_A.id))
      assert.equal(wireRows(agent, turn.started).filter(row => row.type === 'error').length, 0,
        'the subprocess must not add a second, untyped error row')

      await teardown(agent)
      evidence.json('pi-retry-exhausted.json', {
        scene: 'pc-04b-retries-exhausted-one-error',
        elapsedMs,
        typedError: errors[0],
        rawProviderTextPreserved: rawProviderText,
        fixtureFailureBody: `{"error":{"message":"PC04B_HTTP_500 provider failure: upstream server error, service temporarily unavailable","type":"server_error","code":"server_error"}}`,
        requestCount: attempts.length,
        attempts: attempts.map(requestView),
        retrySchedule: retried.map(row => row.event),
        hostOutcome: { completeEvents: turn.events.filter(event => event.type === 'complete').length, errorEvents: errors.length },
        derivation: 'agent-session.js:3061-3096 emits auto_retry_start per attempt (retryDelayMs = baseDelayMs * 2^(attempt-1), capped at maxAgentDelayMs) and refuses the 5th; agent-session.js:801-815 stamps agent_end {willRetry:false}; PiEventAdapter releases the single parked error on that boundary (event-adapter.ts:482-485) and stays quiet on the trailing auto_retry_end (event-adapter.ts:1042-1046).',
        pids: pidEvidence(),
      })
      scenes.push('pc-04c-retries-exhausted-one-typed-error')
    } finally {
      if (agent.subprocess) await agent.disposeForRestart().catch(() => {})
      agent.destroy()
    }
  }

  // ==========================================================================
  // PC-05 — the per-model output cap follows the selected model, compaction included.
  // ==========================================================================
  {
    scene = 'pc-05'
    sceneAttempt = 0
    probes = ['PC05_BULK', 'PC_05_REPLY']
    const agent = createAgent('pc-05-session', `pi/${MODEL_A.id}`)
    await agent.ensureSubprocess()
    await trackChild(agent, 'pc-05')
    try {
      // Turn 1: a small turn whose history the compaction can summarize.
      await settleTurn(agent, startTurn(agent, 'PC05 first turn under model A'), 'pc-05 turn 1')
      // Turn 2: a bulk user message. The compaction cut point walks back from the
      // tail and crosses keepRecentTokens (20 000) inside this message, so the
      // first turn becomes the summarizable history.
      await settleTurn(agent, startTurn(agent, `PC05_BULK ${'x'.repeat(BULK_CHARS)}`), 'pc-05 turn 2')
      const underA = sceneRequests('pc-05')
      assert.equal(underA.length, 2)
      for (const request of underA) {
        assert.equal(request.model, MODEL_A.id)
        assert.equal(request.maxTokens, MODEL_A.maxTokens, 'the request cap must be model A\'s maxTokens')
      }
      assert.equal(underA[0]!.maxTokensField, underA[1]!.maxTokensField,
        'production must use the same output-cap field for every request')

      // Manual compaction through the production RPC (`chatImpl`'/compact'
      // branch calls exactly this method: pi-agent.ts:2589).
      const compactA = await agent.requestCompact('PC05 compaction under model A')
      assert.equal(compactA.tokensBefore > 0, true, 'the compaction must report the size it replaced')
      const compactRowA = await waitFor(
        () => wireRows(agent).filter(row => row.type === 'compact_result').at(-1),
        10_000,
        'compact_result under model A',
      )
      assert.equal(compactRowA.success, true, JSON.stringify(compactRowA).slice(0, 400))
      const reserveA = compactRowA.result?.compactionSettings?.reserveTokens
      assert.equal(typeof reserveA, 'number', 'the subprocess must report the reserve it used')
      const summaryA = sceneRequests('pc-05').filter(request => request.kind === 'compaction')
      assert.equal(summaryA.length, 1, 'the manual compaction must issue exactly one summarization request')
      const expectedA = Math.min(Math.floor(0.8 * reserveA), MODEL_A.maxTokens)
      assert.equal(summaryA[0]!.model, MODEL_A.id)
      assert.equal(summaryA[0]!.maxTokens, expectedA,
        `the summarization cap must be min(floor(0.8*reserve), model.maxTokens) = ${expectedA}`)
      assert.notEqual(summaryA[0]!.maxTokens, MODEL_A.maxTokens,
        'a plain model cap here would prove the reserve budget was ignored')

      // Switch to model B through the production runtime update, then compact again.
      const acknowledged = await agent.updateRuntimeConfig({
        model: `pi/${MODEL_B.id}`,
        providerType: 'pi_compat',
        authType: 'api_key',
        runtime: { baseUrl: providerUrl, customEndpoint: CUSTOM_ENDPOINT, customModels: CUSTOM_MODELS },
      })
      assert.equal(acknowledged, true)

      await settleTurn(agent, startTurn(agent, 'PC05 third turn under model B'), 'pc-05 turn 3')
      await settleTurn(agent, startTurn(agent, `PC05_BULK under B ${'y'.repeat(BULK_CHARS)}`), 'pc-05 turn 4')
      const underB = sceneRequests('pc-05').filter(request => request.kind === 'chat').slice(-2)
      assert.equal(underB.length, 2)
      for (const request of underB) {
        assert.equal(request.model, MODEL_B.id, 'the requests after the switch must carry model B')
        assert.equal(request.maxTokens, MODEL_B.maxTokens, 'the request cap must be model B\'s maxTokens')
      }

      const compactB = await agent.requestCompact('PC05 compaction under model B')
      assert.equal(compactB.tokensBefore > 0, true)
      const compactRowB = await waitFor(
        () => wireRows(agent).filter(row => row.type === 'compact_result').at(-1),
        10_000,
        'compact_result under model B',
      )
      assert.equal(compactRowB.success, true, JSON.stringify(compactRowB).slice(0, 400))
      const reserveB = compactRowB.result?.compactionSettings?.reserveTokens
      assert.equal(typeof reserveB, 'number')
      const summaryRequests = sceneRequests('pc-05').filter(request => request.kind === 'compaction')
      assert.equal(summaryRequests.length, 2, 'each manual compaction issues one summarization request')
      const summaryB = summaryRequests[1]!
      const expectedB = Math.min(Math.floor(0.8 * reserveB), MODEL_B.maxTokens)
      assert.equal(summaryB.model, MODEL_B.id, 'the compaction must run on the selected model')
      assert.equal(summaryB.maxTokens, expectedB,
        `the summarization cap must follow model B: min(floor(0.8*${reserveB}), ${MODEL_B.maxTokens}) = ${expectedB}`)
      assert.equal(summaryB.maxTokens, MODEL_B.maxTokens,
        'under model B the cap binds below the reserve budget')

      await teardown(agent)
      evidence.json('pi-output-caps.json', {
        scene: 'pc-05-per-model-output-cap',
        pathExercised: 'manual compaction (PiAgent.requestCompact → compact RPC → AgentSession.compact()), not overflow auto-compaction',
        models: { a: MODEL_A, b: MODEL_B },
        outputCapField: underA[0]!.maxTokensField,
        chatRequests: sceneRequests('pc-05').filter(request => request.kind === 'chat').map(requestView),
        compactionRequests: summaryRequests.map(requestView),
        derivations: {
          chat: 'pi-ai buildBaseOptions: maxTokens = clampMaxTokensToContext(model, context, model.maxTokens) = min(model.maxTokens, contextWindow - estimatedContext - 4096) (api/simple-options.js:5-23); with these contexts the model cap binds, which is why the observed value equals maxTokens.',
          compaction: 'pi-coding-agent generateSummaryWithUsage: maxTokens = min(floor(0.8 * reserveTokens), model.maxTokens > 0 ? model.maxTokens : Infinity) (core/compaction/compaction.js:511-512). reserveTokens is read through the session\'s current model (pi-agent-server/src/context-usage.ts:24-30) and reported back in compact_result.',
          observed: {
            modelA: { reserveTokens: reserveA, modelMaxTokens: MODEL_A.maxTokens, expected: expectedA, observed: summaryA[0]!.maxTokens },
            modelB: { reserveTokens: reserveB, modelMaxTokens: MODEL_B.maxTokens, expected: expectedB, observed: summaryB.maxTokens },
          },
        },
        compactions: [
          { model: MODEL_A.id, hostRpcResult: { tokensBefore: compactA.tokensBefore, estimatedTokensAfter: compactA.estimatedTokensAfter }, subprocessRow: compactRowA },
          { model: MODEL_B.id, hostRpcResult: { tokensBefore: compactB.tokensBefore, estimatedTokensAfter: compactB.estimatedTokensAfter }, subprocessRow: compactRowB },
        ],
        pids: pidEvidence(),
      })
      scenes.push('pc-05-per-model-output-cap')
    } finally {
      if (agent.subprocess) await agent.disposeForRestart().catch(() => {})
      agent.destroy()
    }
  }

  // ==========================================================================
  // Summary: every child this workflow started must be dead.
  //
  // The authoritative proof is the ChildProcess exit event plus the clean probe
  // taken inside teardown(), immediately after disposeForRestart()/destroy().
  // Windows recycles pids (a recycled svchost.exe made a late signal-0 probe
  // report EPERM), so the late probe is only a failure when the pid is owned by
  // another bun.exe — i.e. plausibly still our child.
  // ==========================================================================
  const finalProcesses = spawned.map(entry => {
    const now = entry.pid === null ? null : processState(entry.pid)
    const atTeardown = entry.pid === null ? null : teardowns.get(entry.pid) ?? null
    const probeAlive = now !== null && (now.tasklisted || now.killProbe === 'alive')
    return {
      scene: entry.scene,
      pid: entry.pid,
      exit: entry.pid === null ? null : exits.get(entry.pid) ?? null,
      stateAtTeardown: atTeardown,
      probeAtSummary: now,
      recycledAtSummary: probeAlive && now!.image.toLowerCase() !== 'bun.exe',
      aliveAtSummary: probeAlive,
    }
  })
  for (const entry of finalProcesses) {
    if (entry.pid === null) continue
    assert.ok(entry.exit, `child ${entry.pid} from ${entry.scene} never reported an exit`)
    assert.ok(entry.stateAtTeardown, `child ${entry.pid} from ${entry.scene} was never torn down`)
    assert.equal(entry.stateAtTeardown!.killProbe, 'ESRCH', `child ${entry.pid} from ${entry.scene} was alive at teardown`)
    assert.equal(entry.stateAtTeardown!.tasklisted, false, `child ${entry.pid} from ${entry.scene} was listed at teardown`)
    // A recycled pid owned by an unrelated image is not our child; a bun.exe that
    // still answers is an orphan.
    assert.equal(entry.aliveAtSummary && !entry.recycledAtSummary, false,
      `child ${entry.pid} from ${entry.scene} still looks alive: ${JSON.stringify(entry.probeAtSummary)}`)
  }

  const untested = [
    'live provider APIs (never contacted: the model boundary is the loopback Bun.serve fixture)',
    'macOS/Linux execution (this run is Windows only)',
    'OAuth token refresh and credential rotation against a real provider',
    'provider-directed retry-after honouring (the fixture sends no retry-after header)',
    'auto-compaction-on-overflow (the manual /compact path is what PC-05 exercises)',
    'signed installers/release artifacts',
  ]

  evidence.json('summary.json', {
    workflow: 'upgrade-0153-pi-runtime',
    scenes,
    untested,
    provider: { url: providerUrl, kind: 'Bun.serve OpenAI chat-completions SSE fixture, 127.0.0.1 only' },
    models: { a: MODEL_A, b: MODEL_B },
    requests,
    processes: finalProcesses,
    workflowPid: process.pid,
    subprocessEntry: join(root, 'packages/pi-agent-server/dist/index.js'),
  })

  await inference.stop(true)
  evidence.complete(scenes, untested)
} catch (error) {
  failure = error
} finally {
  for (const stall of stalls.splice(0)) stall.close()
}

evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
