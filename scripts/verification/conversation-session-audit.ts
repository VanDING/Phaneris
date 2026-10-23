/** Read-only, content-free session forensics. No provider calls or live DB writes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { verificationWorkflow } from './verification-artifacts'

const selected = process.env.PHANERIS_AUDIT_SESSIONS?.split(',') ?? ['261022-young-jasmine', '261022-silent-cloud', '261022-misty-horse', '261022-frosty-creek']
const parse = (file: string): any[] => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const percentile = (values: number[], fraction: number) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]! : null
const difference = (end: number | null | undefined, start: number | null | undefined) => end != null && start != null ? end - start : null

await verificationWorkflow('conversation-session-audit', async evidence => {
  assert(process.env.PHANERIS_AUDIT_WORKSPACE, 'Set PHANERIS_AUDIT_WORKSPACE to the workspace to inspect')
  const workspace = resolve(process.env.PHANERIS_AUDIT_WORKSPACE), database = join(workspace, 'runtime/runtime.db')
  const db = new Database(database, { readonly: true })
  const identities: any[] = []
  const recordFile = (file: string) => {
    const bytes = readFileSync(file)
    identities.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    return parse(file)
  }
  try {
    const ids = readdirSync(join(workspace, 'sessions')).filter(id => id.startsWith(process.env.PHANERIS_AUDIT_PREFIX ?? '261022-'))
    const summaries = ids.map(id => {
      const root = join(workspace, 'sessions', id), canonicalFile = join(root, 'session.jsonl')
      if (!existsSync(canonicalFile)) return null
      const rows = recordFile(canonicalFile), meta = rows[0], user = rows.find(row => row.type === 'user')
      const sdkRoot = join(root, '.pi-sessions'), sdkRows = existsSync(sdkRoot) ? readdirSync(sdkRoot)
        .filter(file => file.endsWith('.jsonl')).flatMap(file => recordFile(join(sdkRoot, file))) : []
      // Only selected scalar metadata and request observations leave SQLite.
      // The session_id index bounds every query; no full live-database scan/hash.
      const events = db.query(`SELECT seq,event_type AS type,created_at AS at,
        json_extract(payload_json,'$.runOperationId') AS run,
        json_extract(payload_json,'$.model') AS model,
        json_extract(payload_json,'$.provider') AS provider,
        json_extract(payload_json,'$.stopReason') AS stopReason,
        json_extract(payload_json,'$.requestObservation') AS observation,
        json_extract(payload_json,'$.event') AS event,
        json_extract(payload_json,'$.data.requestedThinkingLevel') AS requestedThinkingLevel,
        json_extract(payload_json,'$.data.providerThinkingLevel') AS providerThinkingLevel
        FROM runtime_events WHERE session_id=? AND event_type IN
        ('model_dispatch_committed','model_outcome_committed','sdk_observation','tool_dispatch_committed','decision_observed') ORDER BY seq`).all(id) as any[]
      const dispatch = events.find(row => row.type === 'model_dispatch_committed' && row.run?.startsWith('run_'))
      if (!dispatch) return null
      const outcome = events.find(row => row.type === 'model_outcome_committed' && row.run === dispatch.run)
      const observation = outcome?.observation ? JSON.parse(outcome.observation) : null
      const payloadAt = observation?.payloads?.[0]?.capturedAt
      const sdk = sdkRows.filter(row => row.message?.role === 'assistant').map(row => row.message)
        .find(message => message.assistantMetrics?.stepStartTime >= dispatch.at)
      const mainMessages = rows.filter(row => row.type === 'assistant')
      const canonical = mainMessages.find(row => row.assistantMetrics?.stepStartTime >= dispatch.at)
      const metrics = sdk?.assistantMetrics ?? canonical?.assistantMetrics ?? null
      const response = events.find(row => row.event === 'assistant_response_observation' && row.run === dispatch.run)
      const first = {
        admittedAt: user?.timestamp ?? null, admission: user?.inputReception?.disposition ?? null,
        dispatchAt: dispatch.at, provider: dispatch.provider, model: dispatch.model,
        requestedThinkingLevel: response?.requestedThinkingLevel ?? null,
        localToDispatchMs: difference(dispatch.at, user?.timestamp), payloadAt: payloadAt ?? null,
        payloadBytes: observation?.payloads?.[0]?.bytes ?? null,
        responseHeadersAfterPayloadMs: difference(observation?.responses?.[0]?.capturedAt, payloadAt),
        httpStatus: observation?.responses?.[0]?.status ?? null,
        payloadCallbackCount: observation?.payloadCallbackCount ?? null, responseCallbackCount: observation?.responseCallbackCount ?? null,
        requestedOptions: observation?.requestedOptions ?? null,
        stopReason: sdk?.stopReason ?? outcome?.stopReason ?? null, metrics,
        admittedToFirstOutputMs: difference(metrics?.firstOutputTime, user?.timestamp),
        admittedToFirstTextMs: difference(metrics?.firstTextTime, user?.timestamp),
        admittedToCompletedMs: difference(metrics?.completedTime, user?.timestamp),
        thinkingCharacters: sdk?.content?.filter((block: any) => block.type === 'thinking').reduce((sum: number, block: any) => sum + (block.thinking?.length ?? 0), 0) ?? null,
        toolDispatchesInRun: events.filter(row => row.type === 'tool_dispatch_committed' && row.at >= dispatch.at && row.at <= (outcome?.at ?? dispatch.at)).length,
        usage: sdk?.usage ?? canonical?.usage ?? null,
        systemCharacters: canonical?.contextSnapshot?.system?.chars ?? null,
        toolCount: canonical?.contextSnapshot?.tools?.length ?? null,
        promptCharacters: typeof canonical?.promptSnapshot === 'string' ? canonical.promptSnapshot.length : null,
      }
      const timed = mainMessages.filter(row => row.assistantMetrics?.timingRecorded && Number.isFinite(row.assistantMetrics?.firstOutputLatencyMs))
      const samples = timed.map(row => ({ requestSeq: row.requestSeq, metrics: row.assistantMetrics, usage: row.usage }))
      const ttfo = samples.map(row => row.metrics.firstOutputLatencyMs as number), p50 = percentile(ttfo, 0.5)
      const utility = events.filter(row => row.run?.startsWith('utility:') && row.type !== 'sdk_observation')
        .map(row => ({ type: row.type, at: row.at, model: row.model, provider: row.provider, stopReason: row.stopReason, scope: row.run.includes(':decision:') ? 'decision' : 'mini' }))
      const lifecycle = selected.includes(id) ? {
        userAdmissions: rows.filter(row => row.type === 'user').map(row => ({ at: row.timestamp, reception: row.inputReception?.disposition })),
        sdkRequests: sdkRows.filter(row => row.message?.role === 'assistant').map(row => {
          const message = row.message
          const errorKind = !message.errorMessage ? undefined : /unsettled tool operation/.test(message.errorMessage) ? 'unsettled_tool_operation'
            : /abort/i.test(message.errorMessage) ? 'aborted' : 'other_error'
          return { provider: message.provider, model: message.model, stopReason: message.stopReason, errorKind,
            metrics: message.assistantMetrics, usage: message.usage,
            thinkingCharacters: message.content?.filter((block: any) => block.type === 'thinking').reduce((sum: number, block: any) => sum + (block.thinking?.length ?? 0), 0),
            toolNames: message.content?.filter((block: any) => block.type === 'toolCall').map((block: any) => block.name) }
        }),
        activeOperations: db.query('SELECT operation_id,kind,phase,created_at,updated_at FROM operations WHERE session_id=? ORDER BY updated_at').all(id),
        pendingTools: db.query(`SELECT operation_id,run_operation_id,tool_name,recovery_mode,status,prepared_at,settled_at FROM tool_operations
          WHERE status='effect_pending' AND operation_id IN (SELECT json_extract(payload_json,'$.operationId') FROM runtime_events WHERE session_id=? AND event_type='tool_dispatch_committed')`).all(id),
        mainRequestObservations: events.filter(row => row.type === 'model_outcome_committed' && row.run?.startsWith('run_'))
          .map(row => ({ at: row.at, provider: row.provider, model: row.model, run: row.run, observation: row.observation ? JSON.parse(row.observation) : null })),
      } : undefined
      return { id, configuration: { model: meta.model, connection: meta.llmConnection, thinkingLevel: meta.thinkingLevel, permissionMode: meta.permissionMode,
        enabledSourceCount: meta.enabledSourceSlugs?.length ?? 0 }, first,
        sessionTiming: { count: samples.length, p50, p95: percentile(ttfo, 0.95), min: percentile(ttfo, 0.00001), max: percentile(ttfo, 1),
          medianRequest: samples.find(row => row.metrics.firstOutputLatencyMs === p50) ?? null },
        ...(selected.includes(id) ? { utility, requestSamples: samples, lifecycle, decisionEvents: events.filter(row => row.type === 'decision_observed').length } : {}) }
    }).filter((row): row is NonNullable<typeof row> => row !== null)
    assert(selected.every(id => summaries.some(row => row.id === id)), 'All selected cases must be present')
    const providers = [...new Set(summaries.map(row => row.first.provider))].map(provider => {
      const cases = summaries.filter(row => row.first.provider === provider)
      const values = (key: 'localToDispatchMs' | 'responseHeadersAfterPayloadMs') => cases.map(row => row.first[key]).filter((x): x is number => typeof x === 'number')
      const output = cases.map(row => row.first.metrics?.firstOutputLatencyMs).filter((x): x is number => typeof x === 'number')
      return { provider, count: cases.length, medianLocalMs: percentile(values('localToDispatchMs'), 0.5),
        medianHeadersMs: percentile(values('responseHeadersAfterPayloadMs'), 0.5), medianFirstOutputMs: percentile(output, 0.5) }
    })
    evidence.json('audit.json', { capturedAt: new Date().toISOString(), scope: 'Observational historical cohort; not a controlled provider or client benchmark',
      database: { path: database, bytes: statSync(database).size, access: 'readonly; indexed per-session queries' },
      selected: summaries.filter(row => selected.includes(row.id)), cohort: summaries.map(({ utility: _u, requestSamples: _s, ...row }) => row), providers })
    evidence.json('source-identities.json', identities)
    evidence.complete(['reported cases reconstructed', 'first request separated from session percentile', 'same-day first-request cohort', 'read-only content-free export'],
      ['Live controlled comparisons', 'Historical socket connect/DNS timings', 'Renderer receipt timestamps', 'Historical raw request bodies/headers'])
    console.log(JSON.stringify({ output: evidence.directory, providers, cases: summaries.filter(row => selected.includes(row.id)).map(row => ({ id: row.id, first: row.first, sessionTiming: row.sessionTiming })) }))
  } finally { db.close() }
})
