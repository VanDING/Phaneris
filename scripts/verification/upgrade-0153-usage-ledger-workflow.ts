#!/usr/bin/env bun
/**
 * Per-request usage-ledger reconciliation acceptance (2026-10-18 dependency batch).
 *
 * Every scene drives the real Pi subprocess end to end: real `PiAgent` host →
 * real `@earendil-works/pi-coding-agent` session → real `streamSimple` →
 * loopback OpenAI chat-completions SSE fixture → real `wrapDurableModelStream` →
 * real `commitModelOutcome` → real SQLite `usage_ledger`.
 *
 *   L1  a successful call is recorded exactly once with the provider's real numbers
 *   L2  a call whose first provider request fails retryably is accounted from the
 *       attempt that actually succeeded, and the unbilled request leaves no row
 *   L3  replaying the committed outcome through the production commit path does not
 *       double count
 *   F1  what the SDK *agent-level* auto-retry records for an unbilled failed attempt:
 *       this pins shipping behaviour and is reported as a defect (see `defect` in
 *       summary.json) — it is recorded evidence, not an accepted property.
 *
 * Facts this file builds on (verified by reading the sources):
 *   - ledger table/PK `packages/server-core/src/durable-runtime/store.ts:793-806`, row
 *     type `:60-71`, idempotent writer `appendUsage` `:996-1022` (conflicting replay
 *     throws `:1001`), read-back `store.listUsage` `:575-592`.
 *   - producer `coordinator.ts:809-906` `commitModelOutcome`:
 *     `usageId = model:{runOperationId}:{providerRequestId}` `:850`, usage row `:849-860`,
 *     `usage_committed` event `:888-899`, replay short-circuits on the outcome event `:814-815`.
 *   - values originate in the Pi subprocess: `packages/pi-agent-server/src/index.ts:1009-1019`
 *     (`costUsd: message.usage.cost.total`, `payload.costSource:'pi_sdk_estimate'`),
 *     committed on `done` AND `error` by `packages/pi-agent-server/src/durable-model-stream.ts:47-56`;
 *     a thrown stream commits nothing `:57-67`; abort-before-dispatch commits a known zero `:32-45`.
 *   - each SDK auto-retry uses a NEW `providerRequestId` (`index.ts:80-83`) → its own row.
 *   - read back via `runtime.queries.usage(workspace, { sessionId | operationId })`
 *     (`api/runtime.ts:63`), parity detector `model-usage-audit.ts:5-63` attached to the
 *     `agent_settled` sdk_observation at `coordinator.ts:688-700`.
 *   - retry classification: `packages/pi-agent-server/src/session-settings.ts:32-54`
 *     (provider level 408/409/429/5xx), enforced by
 *     `node_modules/@earendil-works/pi-ai/dist/utils/provider-retry.js:9-21`.
 *
 * No user credentials, no live provider, no third-party egress: the only network
 * endpoint is the loopback SSE fixture started below.
 *
 * Usage: bun run scripts/verification/upgrade-0153-usage-ledger-workflow.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { projectDurableUsage } from '../../packages/server-core/src/runtime-adapters/session-projection'
import { VerificationRun } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
const evidence = new VerificationRun('upgrade-0153-usage-ledger')
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const scenes: string[] = []
// Reproducible known issues: recorded with evidence, never counted as passes.
const knownIssues: { id: string; status: string; summary: string; evidence: string }[] = []
let failure: unknown

/** USD per 1M tokens, exactly as configured on the fixture connection's model entry. */
const COST_RATES = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
const derived = (prompt: number, completion: number) =>
  (prompt * COST_RATES.input + completion * COST_RATES.output) / 1_000_000
const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${what}: expected ${expected}, received ${actual}`)

interface FixtureRequest {
  seq: number; label: string; status: number; method: string; path: string
  requestBody: unknown; requestBodyBytes: number; requestBodySha256: string
  responseUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  responseText: string | null
}

const agents = new Map<string, any>()
let runtime: ReturnType<typeof import('../../packages/server-core/src/durable-runtime/index')['createDurableRuntime']> | undefined
let provider: { url: URL; stop(closeActiveConnections?: boolean): void } | undefined
let database: Database | undefined

try {
  evidence.checkArguments()
  const distribution = join(root, 'packages/pi-agent-server/dist/index.js')
  assert(existsSync(distribution), `The real Pi subprocess build is required: ${distribution}`)

  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-0153-usage-'))
  const configRoot = join(fixture, 'config')
  process.env.PHANERIS_CONFIG_DIR = configRoot
  process.env.NODE_ENV = 'test'
  const workspace = join(fixture, 'workspace')
  mkdirSync(configRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })

  // --- the production retry policy this workflow exercises -------------------
  const { PHANERIS_PI_RETRY_SETTINGS } = await import(join(root, 'packages/pi-agent-server/src/session-settings.ts')) as
    typeof import('../../packages/pi-agent-server/src/session-settings')
  // One provider request plus `provider.maxRetries` pre-stream retries per SDK attempt
  // (pi-ai/dist/utils/provider-retry.js:76-95). Only after ALL of them fail does the SDK
  // turn the attempt into an error message and schedule an agent-level retry.
  const providerAttempts = 1 + PHANERIS_PI_RETRY_SETTINGS.provider.maxRetries

  // --- loopback provider fixture --------------------------------------------
  type PlanStep = { label: string; outcome: 'fail' | 'ok'; prompt?: number; completion?: number; text?: string }
  const PLAN: PlanStep[] = [
    { label: 'L1', outcome: 'ok', prompt: 1234, completion: 57, text: 'L1_LEDGER_ACCEPTED' },
    { label: 'L2', outcome: 'fail' },
    { label: 'L2', outcome: 'ok', prompt: 4321, completion: 89, text: 'L2_RETRY_ACCEPTED' },
    { label: 'L3', outcome: 'ok', prompt: 777, completion: 21, text: 'L3_REPLAY_ACCEPTED' },
    ...Array.from({ length: providerAttempts }, () => ({ label: 'F1', outcome: 'fail' as const })),
    { label: 'F1', outcome: 'ok', prompt: 5150, completion: 64, text: 'F1_AFTER_AGENT_RETRY' },
    // L4 runs after F1 against the same scripted server: three billed calls in one
    // session, one per run, to check request-level rows against the summary.
    { label: 'L4', outcome: 'ok', prompt: 2000, completion: 30, text: 'L4_FIRST' },
    { label: 'L4', outcome: 'ok', prompt: 2100, completion: 31, text: 'L4_SECOND' },
    { label: 'L4', outcome: 'ok', prompt: 2200, completion: 32, text: 'L4_THIRD' },
  ]
  const seen: FixtureRequest[] = []
  let served = 0, unscripted = 0
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const body = await request.json() as Record<string, unknown>
      const raw = JSON.stringify(body)
      const step = PLAN[served]
      if (!step) {
        unscripted++
        return new Response(JSON.stringify({ error: { message: 'unscripted fixture request', type: 'fixture_error' } }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'x-should-retry': 'false' } })
      }
      const record: FixtureRequest = { seq: ++served, label: step.label, status: step.outcome === 'ok' ? 200 : 503,
        method: request.method, path: new URL(request.url).pathname, requestBody: body,
        requestBodyBytes: Buffer.byteLength(raw), requestBodySha256: sha256(raw),
        responseUsage: step.outcome === 'ok'
          ? { prompt_tokens: step.prompt!, completion_tokens: step.completion!, total_tokens: step.prompt! + step.completion! }
          : null,
        responseText: step.outcome === 'ok' ? step.text! : null }
      seen.push(record)
      if (step.outcome === 'fail') {
        // 503 is retryable for `retryProviderRequest` (pi-ai/dist/utils/provider-retry.js:17-20);
        // `retry-after: 0` keeps the pre-stream backoff at zero.
        return new Response(JSON.stringify({ error: { message: 'fixture transient failure 503', type: 'server_error', code: 'fixture_503' } }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'retry-after': '0' } })
      }
      const encoder = new TextEncoder()
      const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({
        id: `fixture-${record.seq}`, object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture',
        choices: [{ index: 0, delta, finish_reason }],
        ...(finish_reason ? { usage: record.responseUsage } : {}),
      })}\n\n`
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encoder.encode(chunk({ role: 'assistant' })))
        controller.enqueue(encoder.encode(chunk({ content: step.text })))
        controller.enqueue(encoder.encode(chunk({}, 'stop')))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    },
  })
  provider = server

  // --- production stack ------------------------------------------------------
  const { assembleSessionAgent } = await import(join(root, 'packages/server-core/src/sessions/agent-assembly.ts')) as
    typeof import('../../packages/server-core/src/sessions/agent-assembly')
  const { createDurableRuntime } = await import(join(root, 'packages/server-core/src/durable-runtime/index.ts')) as
    typeof import('../../packages/server-core/src/durable-runtime')
  const { PiRuntimeDriver, bindPiRuntime } = await import(join(root, 'packages/server-core/src/runtime-adapters/pi-driver.ts')) as
    typeof import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const { auditModelUsage } = await import(join(root, 'packages/server-core/src/durable-runtime/model-usage-audit.ts')) as
    typeof import('../../packages/server-core/src/durable-runtime/model-usage-audit')

  const durable = createDurableRuntime()
  runtime = durable
  const wire = new Map<string, any[]>()
  const rows = (sessionId: string) => wire.get(sessionId) ?? []
  const ofType = (sessionId: string, type: string) => rows(sessionId).filter(row => row.type === type)
  const sdkEvents = (sessionId: string, event: string) =>
    ofType(sessionId, 'sdk_observation').map(row => row.observation).filter(item => item?.event === event)
  const operationRows = (operationId: string) => runtime!.queries.usage(workspace, { operationId })
  const sessionRows = (sessionId: string) => runtime!.queries.usage(workspace, { sessionId })
  const facts = (operationId: string) => runtime!.queries.events(workspace, { operationId })
  const factsOf = (operationId: string, type: string) => facts(operationId).filter(event => event.type === type)
  const directAudit = (operationId: string) => auditModelUsage(facts(operationId), operationRows(operationId))
  const auditShape = (audit: unknown) => audit as { scope: string; expectedRows: number; actualRows: number
    issueCount: number; issues: Array<{ identity: string; kind: string }> }
  function assertCleanAudit(audit: unknown, expected: number, what: string) {
    const shape = auditShape(audit)
    assert.equal(shape.scope, 'model_outcomes_vs_usage_ledger')
    assert.equal(shape.expectedRows, expected, `${what}: expected ${expected} committed outcome row(s)`)
    assert.equal(shape.actualRows, expected, `${what}: expected ${expected} ledger row(s)`)
    assert.equal(shape.issues.length, 0, `${what}: parity issues ${JSON.stringify(shape.issues)}`)
    for (const kind of ['duplicate', 'missing', 'mismatch', 'unexpected', 'pending_outcome', 'reconciled_without_usage'])
      assert(!shape.issues.some(issue => issue.kind === kind), `${what}: unexpected ${kind} issue`)
  }
  function assemble(sessionId: string) {
    const agent = assembleSessionAgent({
      context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
        connection: { slug: 'usage-fixture', name: 'Usage fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
          baseUrl: server.url.href, customEndpoint: { api: 'openai-completions' },
          models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback usage fixture',
            provider: 'pi', contextWindow: 128000, maxTokens: 4096, cost: { ...COST_RATES } }] } },
      hostRuntime: { appRootPath: root, isPackaged: false, nodeRuntimePath: process.execPath },
      config: { model: 'pi/fixture', miniModel: 'pi/fixture',
        workspace: { id: 'usage-ledger', slug: 'usage-ledger', createdAt: 1, name: 'Usage ledger acceptance', rootPath: workspace },
        session: { id: sessionId, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 }, isHeadless: true,
        envOverrides: { PHANERIS_CONFIG_DIR: configRoot, HOME: fixture, USERPROFILE: fixture, NODE_ENV: 'test' } },
      callbacks: {}, resources: bindPiRuntime(durable, { sessionId, workspaceRootPath: workspace }),
    }) as any
    const captured: any[] = []
    wire.set(sessionId, captured)
    const original = agent.handleLine.bind(agent)
    agent.handleLine = (line: string) => { try { captured.push(JSON.parse(line)) } catch { /* transport noise */ } return original(line) }
    return agent
  }
  const audits = new Map<string, { observationId: string; seq: number; audit: unknown }>()
  /**
   * The parity audit is only computed when an `agent_settled` observation reaches the
   * active run (coordinator.ts:688-700). The harness issues that observation at run
   * completion through the same production boundary; the subprocess does not emit one
   * for a main session in this configuration (its own observation needs the durable
   * model run scope).
   */
  function attachAuditObservation(sessionId: string, operationId: string) {
    const observationId = `usage-ledger:${operationId}:agent_settled`
    const seq = durable.effects.recordSdkObservation(workspace, { observationId, sessionId, turnId: `${operationId}-user`,
      runOperationId: operationId, event: 'agent_settled', capturedAt: Date.now(),
      data: { aborted: false, scope: 'all_sdk_session_entries', costSource: 'pi_sdk_estimate', issuer: 'workflow_run_completion' } })
    const persisted = durable.queries.events(workspace, { sessionId }).find(event => event.eventId === `${operationId}:sdk:${observationId}`)
    assert(persisted, `The agent_settled observation for ${operationId} was not persisted`)
    const audit = (persisted.payload as { modelUsageAudit?: unknown }).modelUsageAudit
    assert(audit, `The parity audit was not attached to the agent_settled observation for ${operationId}`)
    audits.set(operationId, { observationId, seq, audit })
  }
  async function turn(sessionId: string, operationId: string, prompt: string, onComplete?: () => Promise<void> | void) {
    const driver = await durable.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agents.get(sessionId)!))
    const unsubscribe = durable.execution.subscribe(sessionId, { event: async (event: any) => {
      // Observers run before the Runtime Host settles the run, so the run-scoped
      // production boundaries (prepare/commit/observe) are still reachable here.
      if (event?.type === 'complete') await onComplete?.()
    } })
    const handle = durable.execution.begin({ sessionId, workspaceRootPath: workspace })
    durable.execution.accept(handle, { operationId, userMessageId: `${operationId}-user`, userMessage: prompt })
    const result = await durable.execution.drive(handle, driver, { message: prompt, options: { inputId: `${operationId}-user` } })
    unsubscribe()
    assert.equal(result.kind, 'terminal', `Run ${operationId} did not settle as terminal: ${JSON.stringify(result)}`)
    return result
  }

  // ==========================================================================
  // L1 — a successful call is recorded exactly once with the provider's numbers
  // ==========================================================================
  const L1 = { sessionId: 'l1-success', operationId: 'l1-run', prompt: 'L1 acceptance call' }
  agents.set(L1.sessionId, assemble(L1.sessionId))
  await turn(L1.sessionId, L1.operationId, L1.prompt, () => attachAuditObservation(L1.sessionId, L1.operationId))
  {
    const operation = operationRows(L1.operationId)
    const session = sessionRows(L1.sessionId)
    const dispatch = factsOf(L1.operationId, 'model_dispatch_committed')
    const outcomes = factsOf(L1.operationId, 'model_outcome_committed')
    const usageEvents = factsOf(L1.operationId, 'usage_committed')
    const assistant = factsOf(L1.operationId, 'assistant_message_committed')
    assert.equal(operation.length, 1, 'L1: exactly one usage row for the operation')
    assert.equal(session.length, 1, 'L1: exactly one usage row for the session')
    assert.equal(dispatch.length, 1, 'L1: exactly one durable model dispatch')
    assert.equal(outcomes.length, 1, 'L1: exactly one durable model outcome')
    assert.equal(usageEvents.length, 1, 'L1: exactly one usage_committed event')
    const row = operation[0]!
    const payload = row.payload as { usage: any; costSource?: string; kind?: string; requestSeq?: number }
    assert.equal(row.usageId, `model:${L1.operationId}:1`, 'L1: usage identity is model:{run}:{providerRequestId}')
    assert.equal(row.sessionId, L1.sessionId)
    assert.equal(row.operationId, L1.operationId)
    assert.equal(row.provider, 'custom-endpoint')
    assert.equal(row.model, 'fixture')
    assert.equal(row.inputTokens, 1234, "L1: the provider's prompt_tokens are recorded verbatim")
    assert.equal(row.outputTokens, 57, "L1: the provider's completion_tokens are recorded verbatim")
    assert.equal(payload.usage.input, 1234)
    assert.equal(payload.usage.output, 57)
    assert.equal(payload.usage.totalTokens, 1291)
    assert.equal(payload.usage.cacheRead, 0)
    assert.equal(payload.usage.cacheWrite, 0)
    assert.equal(payload.costSource, 'pi_sdk_estimate', 'L1: cost provenance is the production marker, not a provider-reported cost')
    assert.equal(payload.kind, 'model_attempt')
    assert.equal(payload.requestSeq, 1)
    assert.equal((outcomes[0]!.payload as { stopReason?: string }).stopReason, 'stop')
    assert.equal((assistant[0]!.payload as { content?: string }).content, 'L1_LEDGER_ACCEPTED')
    // Cost is derived from the configured rates and the provider's token counts; the
    // fixture sent no cost object, so nothing here is provider-reported or invented.
    assert.notEqual(row.costUsd, 0, 'L1: a derivable cost must not collapse to zero')
    near(row.costUsd!, derived(1234, 57), 'L1: ledger cost from the configured rates')
    near(payload.usage.cost.total, row.costUsd!, 'L1: ledger cost equals the persisted SDK cost total')
    near(payload.usage.cost.input, 1234 * COST_RATES.input / 1e6, 'L1: input cost component')
    near(payload.usage.cost.output, 57 * COST_RATES.output / 1e6, 'L1: output cost component')
    assert.equal(payload.usage.cost.cacheRead, 0)
    assert.equal(payload.usage.cost.cacheWrite, 0)
    // The fixture's own view of the transaction.
    const requests = seen.filter(request => request.label === 'L1')
    assert.equal(requests.length, 1, 'L1: exactly one provider HTTP request')
    assert.equal(requests[0]!.status, 200)
    assert.deepEqual(Object.keys(requests[0]!.responseUsage!).sort(), ['completion_tokens', 'prompt_tokens', 'total_tokens'])
    assert.deepEqual(requests[0]!.responseUsage, { prompt_tokens: 1234, completion_tokens: 57, total_tokens: 1291 })
    assert.equal(requests[0]!.responseText, 'L1_LEDGER_ACCEPTED')
    assert.match(requests[0]!.path, /\/chat\/completions$/)
    assertCleanAudit(audits.get(L1.operationId)!.audit, 1, 'L1 attached audit')
    assertCleanAudit(directAudit(L1.operationId), 1, 'L1 direct audit')
    evidence.json('usage-success.json', { scene: 'L1', sessionId: L1.sessionId, operationId: L1.operationId,
      providerRequests: requests, configuredCostRatesPerMillionTokens: COST_RATES, expectedCostUsdFromRates: derived(1234, 57),
      attemptToRow: [{ attempt: 1, providerRequestId: '1', providerHttpRequests: [requests[0]!.seq],
        providerHttpStatuses: [requests[0]!.status], billed: true, usageId: row.usageId, recorded: true }],
      ledgerRows: operation, ledgerRowsForSession: session,
      durableEvents: { dispatch: dispatch.map(event => event.eventId), outcome: outcomes.map(event => event.eventId),
        usageCommitted: usageEvents.map(event => event.eventId), assistant: assistant.map(event => event.eventId) },
      audit: { attached: audits.get(L1.operationId), direct: directAudit(L1.operationId),
        attachment: 'durable.effects.recordSdkObservation(event agent_settled) at run completion (coordinator.ts:688-700)' },
      assertions: ['one row per operation and per session', "provider token numbers verbatim", 'cost derived from configured rates',
        'costSource pi_sdk_estimate', 'one dispatch/outcome/usage_committed fact', 'parity audit reports no issues'] })
    scenes.push('L1-success-recorded-once-with-provider-numbers')
  }

  // ==========================================================================
  // L2 — a retryable provider failure is accounted from the attempt that succeeded
  // ==========================================================================
  const L2 = { sessionId: 'l2-retry', operationId: 'l2-run', prompt: 'L2 acceptance call' }
  agents.set(L2.sessionId, assemble(L2.sessionId))
  await turn(L2.sessionId, L2.operationId, L2.prompt, () => attachAuditObservation(L2.sessionId, L2.operationId))
  {
    const requests = seen.filter(request => request.label === 'L2')
    const failed = requests.filter(request => request.status === 503)
    const billed = requests.filter(request => request.status === 200)
    const operation = operationRows(L2.operationId)
    assert.equal(requests.length, 2, 'L2: the fixture served one failed and one successful provider request')
    assert.equal(failed.length, 1, 'L2: exactly one retryable provider failure')
    assert.equal(billed.length, 1, 'L2: exactly one provider request was billed')
    assert.equal(operation.length, 1, 'L2: exactly one usage row for the operation')
    assert.equal(sessionRows(L2.sessionId).length, 1, 'L2: exactly one usage row for the session')
    assert.equal(operation.length, billed.length, 'L2: rows equal the provider requests that were actually billed')
    const row = operation[0]!
    const payload = row.payload as { usage: any; costSource?: string }
    assert.equal(row.usageId, `model:${L2.operationId}:1`)
    assert.equal(row.inputTokens, 4321, "L2: the successful attempt's prompt_tokens")
    assert.equal(row.outputTokens, 89, "L2: the successful attempt's completion_tokens")
    assert.equal(payload.usage.totalTokens, 4410)
    near(row.costUsd!, derived(4321, 89), 'L2: cost derives from the successful attempt only')
    assert.notEqual(row.costUsd, 0)
    // The rejected request never reached the ledger: the SDK retried it inside the same
    // attempt identity, so there is no row and no reconciliation verdict to record.
    const prepare = ofType(L2.sessionId, 'durable_model_prepare_request')
    const outcomes = ofType(L2.sessionId, 'durable_model_outcome_request')
    assert.equal(prepare.length, 1, 'L2: the SDK retry reused the same attempt identity')
    assert.equal(String(prepare[0]!.providerRequestId), '1')
    assert.equal(outcomes.length, 1, 'L2: one durable outcome for the retried attempt')
    assert.equal(outcomes[0]!.stopReason, 'stop')
    assert.equal(outcomes[0]!.text, 'L2_RETRY_ACCEPTED', 'L2: the accounted response is the retry that succeeded')
    assert(operation.every(candidate => !(candidate.inputTokens === 0 && candidate.outputTokens === 0 && candidate.costUsd === 0)),
      'L2: no fabricated zero-cost row exists for the unbilled provider request')
    assert.equal(factsOf(L2.operationId, 'model_recovery_decided').length, 0, 'L2: no reconciliation verdict was needed')
    assert.equal(factsOf(L2.operationId, 'usage_committed').length, 1)
    assert.equal((factsOf(L2.operationId, 'assistant_message_committed')[0]!.payload as { content?: string }).content, 'L2_RETRY_ACCEPTED')
    assertCleanAudit(audits.get(L2.operationId)!.audit, 1, 'L2 attached audit')
    assertCleanAudit(directAudit(L2.operationId), 1, 'L2 direct audit')
    evidence.json('usage-retry.json', { scene: 'L2', sessionId: L2.sessionId, operationId: L2.operationId,
      providerRequests: requests, configuredCostRatesPerMillionTokens: COST_RATES, expectedCostUsdFromRates: derived(4321, 89),
      failedAttemptAccounting: { shape: 'no_row',
        retryLayer: 'provider (pre-stream) — retryProviderRequest, 408/409/429/5xx classified retryable',
        classification: `pi-ai/dist/utils/provider-retry.js:9-21 with PHANERIS_PI_RETRY_SETTINGS.provider.maxRetries=${PHANERIS_PI_RETRY_SETTINGS.provider.maxRetries}`,
        verdictEvents: 0,
        detail: 'the 503 was retried inside the same attempt identity, so the ledger never received an unmetered placeholder message and no provider_not_billed/indeterminate verdict was involved' },
      attemptToRow: [{ attempt: 1, providerRequestId: '1', providerHttpRequests: requests.map(request => request.seq),
        providerHttpStatuses: requests.map(request => request.status), billed: true, usageId: row.usageId, recorded: true }],
      billedProviderRequests: billed.length, ledgerRows: operation, ledgerRowsForSession: sessionRows(L2.sessionId),
      audit: { attached: audits.get(L2.operationId), direct: directAudit(L2.operationId) },
      assertions: ['the row carries the successful attempt numbers', 'no fabricated zero row for the failed request',
        'rows equal billed provider requests', 'no duplicate/missing/mismatch/pending_outcome issue'] })
    scenes.push('L2-retry-accounted-from-actually-billed-attempt')
  }

  // ==========================================================================
  // L3 — replaying the committed outcome does not double count
  // ==========================================================================
  const L3 = { sessionId: 'l3-replay', operationId: 'l3-run', prompt: 'L3 acceptance call' }
  agents.set(L3.sessionId, assemble(L3.sessionId))
  let replay: any
  await turn(L3.sessionId, L3.operationId, L3.prompt, async () => {
    const prepareRequest = ofType(L3.sessionId, 'durable_model_prepare_request')[0]!
    const outcomeRequest = ofType(L3.sessionId, 'durable_model_outcome_request')[0]!
    const outcomesBefore = factsOf(L3.operationId, 'model_outcome_committed')
    const before = JSON.stringify(operationRows(L3.operationId))
    const factsBefore = facts(L3.operationId).map(event => event.eventId)
    // Re-run the same providerRequestId through the production prepare + commit path.
    const prepared = await durable.effects.prepareModel(workspace, { sessionId: L3.sessionId, runOperationId: L3.operationId,
      turnId: prepareRequest.turnId, providerRequestId: prepareRequest.providerRequestId, provider: prepareRequest.provider,
      model: prepareRequest.model, canonicalRequestHash: prepareRequest.canonicalRequestHash })
    const committed = await durable.effects.commitModelOutcome(workspace, outcomeRequest as never)
    const after = JSON.stringify(operationRows(L3.operationId))
    const factsAfter = facts(L3.operationId).map(event => event.eventId)
    replay = { replayedRequest: outcomeRequest, prepareReplay: prepared,
      originalPrepareRequest: prepareRequest, originalOutcomeEventId: outcomesBefore[0]!.eventId,
      originalCommittedSeq: outcomesBefore[0]!.seq, outcomeReplay: committed,
      rowsBefore: JSON.parse(before), rowsAfter: JSON.parse(after), rowsUnchanged: before === after,
      factsBefore: factsBefore.length, factsAfter: factsAfter.length, factsUnchanged: JSON.stringify(factsBefore) === JSON.stringify(factsAfter) }
    attachAuditObservation(L3.sessionId, L3.operationId)
  })
  {
    assert(replay, 'L3: the replay ran while the run was still open')
    const dispatch = factsOf(L3.operationId, 'model_dispatch_committed')[0]!
    const dispatchPayload = dispatch.payload as { operationId: string; canonicalRequestHash: string; providerRequestId: string }
    assert.equal(replay.originalPrepareRequest.providerRequestId, '1')
    assert.equal(dispatchPayload.providerRequestId, '1')
    assert.equal(replay.replayedRequest.canonicalRequestHash, dispatchPayload.canonicalRequestHash)
    assert.equal(replay.prepareReplay.created, false, 'L3: the replayed prepare reports an existing effect')
    assert.equal(replay.prepareReplay.status, 'outcome_committed')
    assert.equal(replay.prepareReplay.operationId, dispatchPayload.operationId, 'L3: the replay resolves the same model operation')
    assert.equal(replay.prepareReplay.idempotencyKey, dispatchPayload.operationId)
    assert.equal(replay.outcomeReplay.committedSeq, replay.originalCommittedSeq,
      'L3: the replayed commit returns the original commit, not a new one')
    assert(replay.rowsUnchanged, 'L3: the replay appended no ledger row')
    assert(replay.factsUnchanged, 'L3: the replay appended no durable fact')
    assert.equal(replay.rowsAfter.length, 1, 'L3: exactly one row after the replay')
    assert.equal(replay.rowsAfter[0].usageId, `model:${L3.operationId}:1`)
    assert.equal(replay.rowsAfter[0].inputTokens, 777)
    assert.equal(replay.rowsAfter[0].outputTokens, 21)
    assert.equal(operationRows(L3.operationId).length, 1, 'L3: exactly one row after the run settled')
    assert.equal(sessionRows(L3.sessionId).length, 1)
    assert.equal(factsOf(L3.operationId, 'usage_committed').length, 1)
    const attached = audits.get(L3.operationId)!.audit
    assertCleanAudit(attached, 1, 'L3 attached audit')
    assert(!auditShape(attached).issues.some(issue => issue.kind === 'duplicate'), 'L3: no duplicate parity issue after replay')
    assertCleanAudit(directAudit(L3.operationId), 1, 'L3 direct audit')
    evidence.json('usage-replay.json', { scene: 'L3', sessionId: L3.sessionId, operationId: L3.operationId,
      providerRequests: seen.filter(request => request.label === 'L3'), replay,
      replaySemantics: { guard: 'commitModelOutcome short-circuits on the existing outcome event (coordinator.ts:814-815)',
        secondGuard: 'appendUsage content comparison (store.ts:996-1004) is unreachable while the outcome event exists; recorded as untested' },
      ledgerRows: operationRows(L3.operationId),
      audit: { attached: audits.get(L3.operationId), direct: directAudit(L3.operationId) },
      assertions: ['prepare replay reports outcome_committed/created=false', 'commit replay returns the original committedSeq',
        'still exactly one row', 'no new durable facts', 'no duplicate parity issue'] })
    scenes.push('L3-replay-same-providerRequestId-single-row')
  }

  // ==========================================================================
  // F1 — what the SDK agent-level auto-retry records for an unbilled attempt
  //      (pins shipping behaviour; reported as a defect, not accepted)
  // ==========================================================================
  const F1 = { sessionId: 'f1-agent-retry', operationId: 'f1-run', prompt: 'F1 acceptance call' }
  agents.set(F1.sessionId, assemble(F1.sessionId))
  await turn(F1.sessionId, F1.operationId, F1.prompt, () => attachAuditObservation(F1.sessionId, F1.operationId))
  {
    const requests = seen.filter(request => request.label === 'F1')
    const failed = requests.filter(request => request.status === 503)
    const billed = requests.filter(request => request.status === 200)
    const operation = operationRows(F1.operationId)
    const prepare = ofType(F1.sessionId, 'durable_model_prepare_request')
    const outcomes = ofType(F1.sessionId, 'durable_model_outcome_request')
    const retryStart = sdkEvents(F1.sessionId, 'auto_retry_start')
    const retryEnd = sdkEvents(F1.sessionId, 'auto_retry_end')
    assert.equal(failed.length, providerAttempts, `F1: all ${providerAttempts} provider requests of the first SDK attempt failed`)
    assert.equal(billed.length, 1, 'F1: exactly one provider request was billed')
    assert.equal(retryStart.length, 1, 'F1: the SDK scheduled an agent-level retry')
    assert.equal(retryStart[0]!.data.attempt, 1)
    assert.equal(retryStart[0]!.data.maxAttempts, PHANERIS_PI_RETRY_SETTINGS.maxRetries)
    assert.equal(retryStart[0]!.data.delayMs, PHANERIS_PI_RETRY_SETTINGS.baseDelayMs)
    assert.equal(retryEnd.length, 1)
    assert.equal(retryEnd[0]!.data.success, true)
    assert.equal(prepare.length, 2, 'F1: each SDK auto-retry gets its own providerRequestId')
    assert.deepEqual(prepare.map(item => String(item.providerRequestId)), ['1', '2'])
    assert.equal(outcomes.length, 2)
    assert.deepEqual(outcomes.map(item => item.stopReason), ['error', 'stop'])
    assert.equal(operation.length, 2, 'F1: the failed attempt has its own ledger row')
    const zero = operation[0]!, real = operation[1]!
    assert.equal(zero.usageId, `model:${F1.operationId}:1`)
    assert.equal(zero.inputTokens, 0)
    assert.equal(zero.outputTokens, 0)
    assert.equal(zero.costUsd, 0)
    assert.equal((zero.payload as { costSource?: string }).costSource, 'pi_sdk_estimate')
    assert.equal((zero.payload as { assistantMetrics?: { usageProvided?: boolean } }).assistantMetrics?.usageProvided, true)
    assert.equal(real.usageId, `model:${F1.operationId}:2`)
    assert.equal(real.inputTokens, 5150)
    assert.equal(real.outputTokens, 64)
    near(real.costUsd!, derived(5150, 64), 'F1: the retried attempt carries the real cost')
    assert.equal(factsOf(F1.operationId, 'model_recovery_decided').length, 0,
      'F1: no reconciliation verdict exists for the unbilled attempt')
    // The parity detector compares the ledger with the committed outcomes, so a
    // fabricated zero row is internally consistent and invisible to it.
    assertCleanAudit(audits.get(F1.operationId)!.audit, 2, 'F1 attached audit')
    assertCleanAudit(directAudit(F1.operationId), 2, 'F1 direct audit')
    assert.equal(operation.length, billed.length + 1, 'F1: one ledger row has no billed provider request behind it')
    evidence.json('usage-agent-retry-deviation.json', { scene: 'F1', sessionId: F1.sessionId, operationId: F1.operationId,
      status: 'deviation-recorded-not-accepted', providerRequests: requests, providerAttemptsPerSdkAttempt: providerAttempts,
      retryPolicy: { agentLevelMaxRetries: PHANERIS_PI_RETRY_SETTINGS.maxRetries,
        agentLevelBaseDelayMs: PHANERIS_PI_RETRY_SETTINGS.baseDelayMs,
        providerMaxRetries: PHANERIS_PI_RETRY_SETTINGS.provider.maxRetries },
      sdkRetryEvents: { autoRetryStart: retryStart, autoRetryEnd: retryEnd },
      attemptToRow: prepare.map((item, index) => ({ attempt: index + 1, providerRequestId: String(item.providerRequestId),
        stopReason: outcomes[index]?.stopReason ?? null, usageId: operation[index]?.usageId ?? null,
        billedProviderRequests: index === 0 ? 0 : 1, recorded: Boolean(operation[index]) })),
      billedProviderRequests: billed.length, ledgerRows: operation,
      defect: {
        summary: 'An attempt whose every provider request was rejected before any response (503, never billed) is persisted as a metered zero-usage ledger row.',
        sites: ['packages/pi-agent-server/src/durable-model-stream.ts:49-54',
          'packages/pi-agent-server/src/index.ts:1009-1019',
          'packages/server-core/src/durable-runtime/coordinator.ts:849-860'],
        evidence: { ledgerRow: zero, commitRequestSeenByTheHost: outcomes[0] },
        whyTheAuditMissesIt: 'model-usage-audit.ts compares ledger rows with committed outcomes; the fabricated row matches its own outcome, so issueCount stayed 0.',
      },
      audit: { attached: audits.get(F1.operationId), direct: directAudit(F1.operationId) },
      assertions: ['agent-level retry ran with the pinned policy', 'two attempt identities, two rows',
        'the leading zero row has no billed provider request behind it (deviation)'] })
    knownIssues.push({
      id: 'F1-agent-retry-unbilled-attempt-zero-row-recorded',
      status: 'approved-deferred',
      summary: 'An attempt whose every provider request was rejected before any response is still persisted as a metered zero-usage ledger row (durable-model-stream.ts:49-54 -> index.ts:1009-1019 -> coordinator.ts:849-860).',
      evidence: 'usage-agent-retry-deviation.json',
    })
  }

  // ==========================================================================
  // L4 — three billed calls in one session: one row each, and the summary matches
  // ==========================================================================
  const L4 = { sessionId: 'l4-multicall', operations: ['l4-run-1', 'l4-run-2', 'l4-run-3'] as const,
    expected: [{ prompt: 2000, completion: 30 }, { prompt: 2100, completion: 31 }, { prompt: 2200, completion: 32 }] }
  agents.set(L4.sessionId, assemble(L4.sessionId))
  for (const [index, operationId] of L4.operations.entries()) {
    await turn(L4.sessionId, operationId, `L4 acceptance call ${index + 1}`, () => attachAuditObservation(L4.sessionId, operationId))
    const rows = operationRows(operationId)
    assert.equal(rows.length, 1, `L4: call ${index + 1} must record exactly one usage row`)
    assert.match(rows[0]!.usageId, new RegExp(`^model:${operationId}:\\d+$`),
      `L4: call ${index + 1} keeps its own usage identity (providerRequestId counts per session, so its suffix grows)`)
    assert.equal(rows[0]!.inputTokens, L4.expected[index]!.prompt, `L4: call ${index + 1} records the provider's prompt tokens`)
    assert.equal(rows[0]!.outputTokens, L4.expected[index]!.completion, `L4: call ${index + 1} records the provider's completion tokens`)
    assertCleanAudit(audits.get(operationId)!.audit, 1, `L4 call ${index + 1} audit`)
  }
  {
    const session = sessionRows(L4.sessionId)
    assert.equal(session.length, 3, 'L4: three billed calls produce exactly three rows — none dropped, none doubled')
    assert.equal(new Set(session.map(row => row.usageId)).size, 3, 'L4: every row has a distinct usage identity')
    const sum = (pick: (row: typeof session[number]) => number) => session.reduce((total, row) => total + pick(row), 0)
    const expectedInput = L4.expected.reduce((total, entry) => total + entry.prompt, 0)
    const expectedOutput = L4.expected.reduce((total, entry) => total + entry.completion, 0)
    assert.equal(sum(row => row.inputTokens ?? 0), expectedInput, 'L4: the session total equals the sum of the provider numbers')
    assert.equal(sum(row => row.outputTokens ?? 0), expectedOutput, 'L4: the session output total equals the sum of the provider numbers')
    // Request level detail and the summary must agree. The summary the app shows
    // is the durable projection of these same rows, so comparing them catches a
    // dropped or double-counted row that per-operation assertions alone would miss.
    const projection = projectDurableUsage(session as never)
    assert.equal(projection.inputTokens, expectedInput, 'L4: the projected summary input tokens equal the ledger sum')
    assert.equal(projection.outputTokens, expectedOutput, 'L4: the projected summary output tokens equal the ledger sum')
    assert.equal(projection.attempts, 3, 'L4: the projected summary counts three attempts')
    evidence.json('usage-multicall.json', { scene: 'L4', sessionId: L4.sessionId, operations: L4.operations,
      ledgerRows: session, providerRequests: seen.filter(request => request.label === 'L4'),
      expected: { inputTokens: expectedInput, outputTokens: expectedOutput, requests: 3 },
      projected: { inputTokens: projection.inputTokens, outputTokens: projection.outputTokens, attempts: projection.attempts },
      audits: L4.operations.map(operationId => ({ operationId, audit: audits.get(operationId)!.audit })) })
    scenes.push('L4-multi-call-session-rows-and-summary-reconcile')
  }

  // --- database-level evidence and summary -----------------------------------
  assert.equal(served, PLAN.length, 'the fixture served exactly the scripted plan')
  assert.equal(unscripted, 0, 'no provider request escaped the scripted plan')
  const backup = durable.admin.backupDatabase(workspace, join(workspace, 'usage-ledger-backup.db'))
  const databasePath = join(evidence.directory, 'usage-ledger.db')
  writeFileSync(databasePath, readFileSync(backup))
  const db = new Database(databasePath, { readonly: true })
  database = db
  const count = (sql: string, ...params: string[]) => (db.query(sql).get(...params) as { n: number }).n
  const duplicateIdentities = db.query('SELECT usage_id, COUNT(*) AS n FROM usage_ledger GROUP BY usage_id HAVING n > 1').all()
  const schema = (db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usage_ledger'").get() as { sql: string }).sql
  assert.match(schema, /usage_id TEXT PRIMARY KEY/, 'the ledger schema keys rows by usage identity')
  const primaryKey = (db.query('PRAGMA table_info(usage_ledger)').all() as Array<{ name: string; pk: number }>)
    .filter(column => column.pk > 0).map(column => column.name)
  assert.deepEqual(primaryKey, ['usage_id'], 'the ledger enforces exactly one row per usage identity')
  for (const operationId of [L1.operationId, L2.operationId, L3.operationId])
    assert.equal(count('SELECT COUNT(*) AS n FROM usage_ledger WHERE usage_id = ?', `model:${operationId}:1`), 1,
      `one persisted row for model:${operationId}:1`)
  for (const [sessionId, expected] of [[L1.sessionId, 1], [L2.sessionId, 1], [L3.sessionId, 1], [F1.sessionId, 2]] as const)
    assert.equal(count('SELECT COUNT(*) AS n FROM usage_ledger WHERE session_id = ?', sessionId), expected)
  assert.deepEqual(duplicateIdentities, [], 'no duplicate usage identities exist in the ledger')
  const databaseSha256 = sha256(readFileSync(databasePath))

  evidence.json('summary.json', {
    schemaVersion: 1, workflow: 'upgrade-0153-usage-ledger', generatedAt: new Date().toISOString(),
    scope: 'Real Pi subprocess + real durable runtime/SQLite + loopback OpenAI chat-completions SSE fixture; no live provider, no credentials',
    fixtureDirectory: fixture, workspace, costRatesPerMillionTokens: COST_RATES,
    retryPolicy: { providerMaxRetries: PHANERIS_PI_RETRY_SETTINGS.provider.maxRetries,
      agentMaxRetries: PHANERIS_PI_RETRY_SETTINGS.maxRetries, agentBaseDelayMs: PHANERIS_PI_RETRY_SETTINGS.baseDelayMs },
    providerRequests: seen.map(request => ({ seq: request.seq, label: request.label, status: request.status, path: request.path,
      requestBodyBytes: request.requestBodyBytes, requestBodySha256: request.requestBodySha256, responseUsage: request.responseUsage })),
    ledgers: { [L1.sessionId]: sessionRows(L1.sessionId), [L2.sessionId]: sessionRows(L2.sessionId),
      [L3.sessionId]: sessionRows(L3.sessionId), [F1.sessionId]: sessionRows(F1.sessionId) },
    audits: Object.fromEntries(audits),
    database: { path: databasePath, sha256: databaseSha256, schema, primaryKey, duplicateIdentities,
      rowsPerSession: { [L1.sessionId]: 1, [L2.sessionId]: 1, [L3.sessionId]: 1, [F1.sessionId]: 2 } },
    sceneResults: scenes.map(scene => ({ scene, status: scene.startsWith('F1-')
      ? 'records a known deviation (see summary.defect); NOT an accepted property' : 'verified' })),
    defect: {
      id: 'usage-ledger-unmetered-failure-recorded-as-zero',
      status: 'reported-not-fixed',
      summary: 'A model attempt whose provider requests were all rejected before any response (503, never billed) is written to usage_ledger as a metered zero row (0 input, 0 output, $0, costSource pi_sdk_estimate) with no reconciliation verdict, so the ledger cannot distinguish "not billed" from "billed zero".',
      sites: ['packages/pi-agent-server/src/durable-model-stream.ts:49-54',
        'packages/pi-agent-server/src/index.ts:1009-1019',
        'packages/server-core/src/durable-runtime/coordinator.ts:849-860'],
      evidence: 'usage-agent-retry-deviation.json (scene F1: 3 x 503 then success -> row model:f1-run:1 = 0/0/$0 alongside model:f1-run:2 = 5150/64)',
      whyTheAuditMissesIt: 'model-usage-audit.ts:5-63 compares ledger rows with committed outcomes and never asks whether a failed outcome carried metered usage; expected/actual stayed 2/2 with issueCount 0.',
      proposedMinimalFix: 'In packages/pi-agent-server/src/index.ts:1009-1019 omit `usage` when the committed message proves nothing was metered (stopReason === "error" && message.usage.totalTokens === 0 && message.content.length === 0). commitModelOutcome already handles an absent usage by committing the outcome fact with no ledger row (coordinator.ts:849-860), which keeps dispatch/outcome parity (no pending_outcome) while removing the fabricated charge. Alternative site: the same condition gated in durable-model-stream.ts:49-54.',
      affectedProperty: 'docs/verification/upgrade-2026-10-19-review.md:72 — a failed retry must be accounted from actual usage, not uniformly zero-cost.',
    },
    limitations: ['the agent_settled observation used for the audit attachment is issued by the workflow at run completion; the subprocess does not emit one for a main session in this harness configuration',
      'the conflicting-content branch of appendUsage (store.ts:1000-1002) is unreachable while the outcome event exists'],
  })

  // The parity audit probe above is the correctness surface; the divergence it
  // exposes stays a recorded known issue. It is deliberately NOT part of the
  // passed scene set: a reproducible defect must never be counted as a pass.
  evidence.json('known-issues.json', { knownIssues })
  evidence.complete(scenes, [
    'live provider APIs and real provider billing statements (loopback fixture only)',
    'macOS/Linux execution',
    'signed installer/release',
    'provider-reported cost objects (the OpenAI-completions adapter prices locally from configured rates)',
    'cache-read/cache-write and cost-tier pricing paths (the fixture reports no cache tokens; the rates have no tiers)',
    'abort-before-dispatch known-zero accounting and thrown-stream pending semantics (durable-model-stream.ts:32-45, :57-67)',
    'recovery_parked reconciliation verdicts (provider_not_billed / billed_response_unavailable / manual_abandon)',
    'the conflicting-content branch of appendUsage (store.ts:1000-1002)',
    'within-turn tool-loop accounting (multiple provider requests inside ONE run): this workflow prices one request per run; the multi-request turn is exercised by upgrade-0153-pi-runtime (PC-01/PC-04/PC-05) and durable-runtime-boundary',
    'session branching attribution: covered by the registered session-branch and durable-runtime-boundary runs, not re-derived here',
    'cache warming as a separate ledger fact: the fixture reports no cache tokens, so warming is not asserted here',
    ...knownIssues.map(issue => `${issue.id}: ${issue.status} — ${issue.summary}`),
  ])
} catch (error) {
  failure = error
} finally {
  for (const agent of agents.values()) {
    try { await agent.disposeForRestart?.() } catch { /* teardown only */ }
    try { agent.destroy?.() } catch { /* teardown only */ }
  }
  try { database?.close() } catch { /* teardown only */ }
  try { await runtime?.close() } catch { /* teardown only */ }
  try { provider?.stop(true) } catch { /* teardown only */ }
}
evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
