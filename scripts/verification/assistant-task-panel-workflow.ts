import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * The assistant work board, rendered by the real Electron application on both
 * surfaces it appears: the peek that opens when the pointer rests on the
 * assistant's slot in the titlebar, and the panel inside the assistant's view.
 *
 * The records are written by the product's own store (`AssistantTaskStore`) into
 * a real workspace database, and the board reads them back through the real RPC
 * channel. Nothing here is a projection fixture: what is asserted is what a user
 * sees in the shipped client.
 *
 * See docs/verification/assistant-refactor-2026-11-18-failure-matrix.md (M10/M15
 * panel half, and the panel evidence stage 3 recorded as untested).
 */
await verificationWorkflow('assistant-task-panel', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Panel workspace', rootPath: root, createdAt: 1 }

  // A loopback provider so the desktop entry can create a real resident Session
  // without contacting a paid endpoint. It only ever answers with plain text.
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    // The client probes model discovery with an empty body before streaming;
    // answering that probe keeps the loopback honest instead of throwing.
    if (request.method === 'GET') return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model' }] })
    const body = await request.json().catch(() => ({ model: 'fixture' })) as { model: string }
    const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'panel-fixture', object: 'chat.completion.chunk',
      model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: 'assistant' }) + chunk({ content: 'PANEL_FIXTURE_REPLY' }) + chunk({}, 'stop') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const connection = { slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1,
    baseUrl: provider.url.href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture',
    models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test-only loopback', provider: 'pi', contextWindow: 64000,
      maxTokens: 4096, supportsThinking: false }] }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true,
    defaultLlmConnection: 'fixture', llmConnections: [connection], appearance: { mode: 'light', colorTheme: 'default', font: 'inter' } }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace,
    defaults: { permissionMode: 'guarded', defaultLlmConnection: 'fixture', model: 'fixture', workingDirectory: 'none' } }))
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')

  // The evidence each task must produce on screen. Every entry is a fact the
  // store persisted, so the panel assertion is about rendering, not derivation.
  const requirements = [
    { statement: 'Report covers market size and cost basis', scope: 'task' as const },
    { statement: 'Every figure cites its source', scope: 'task' as const },
  ]
  const { AssistantTaskStore } = await import('../../packages/server-core/src/assistant-tasks/store')
  const store = new AssistantTaskStore(workspace)
  let taskIds: string[] = []
  try {
    // 1 · intake — a definition exists before any Session does.
    const intake = store.create({ requestId: 'panel-intake', goalTitle: 'PANEL_GOAL_ELDER_CARE', title: 'PANEL_TASK_AWAITING_READY',
      scopeIn: ['four independent research briefs', 'one summary report'], scopeOut: ['paid subscriptions'],
      requirements, acceptance: ['Every brief is readable', 'The summary cites each brief'],
      deliverable: 'four briefs and one summary HTML' }, 'msg-panel-intake')

    // 2 · ready — the Host recorded a readiness verdict for the current version.
    store.applyReady({ taskId: intake.task.id, definitionVersion: intake.definitionVersion, ready: true, missing: [],
      authority: ['permissionMode: guarded', `workingDirectory: ${root}`], checkedAt: Date.now() })

    // 3 · candidate_result — a real run finished and awaits acceptance.
    const running = store.create({ requestId: 'panel-candidate', goalTitle: 'PANEL_GOAL_ELDER_CARE', title: 'PANEL_TASK_AWAITING_ACCEPTANCE',
      scopeIn: ['one brief'], requirements: [requirements[0]!], acceptance: ['The brief is readable'], deliverable: 'one brief' }, 'msg-panel-candidate')
    store.recordAssignment({ id: 'asg-panel-candidate-1', taskId: running.task.id, definitionVersion: running.definitionVersion,
      requirementIds: running.activeRequirements.map(item => item.id), state: 'completed', sessionId: 'panel-worker-candidate',
      createdAt: Date.now(), updatedAt: Date.now() })

    // 4 · version ahead of execution — "v2 recorded, v1 executing" is a legal state.
    // A newer definition must never be hidden behind the run that already started.
    const amended = store.create({ requestId: 'panel-amended', goalTitle: 'PANEL_GOAL_ELDER_CARE', title: 'PANEL_TASK_VERSION_AHEAD',
      scopeIn: ['one brief'], requirements: [{ statement: 'Use light background', scope: 'task' }], acceptance: ['The brief is readable'] }, 'msg-panel-amended')
    store.recordAssignment({ id: 'asg-panel-amended-1', taskId: amended.task.id, definitionVersion: amended.definitionVersion,
      requirementIds: amended.activeRequirements.map(item => item.id), state: 'running', sessionId: 'panel-worker-amended',
      createdAt: Date.now(), updatedAt: Date.now() })
    const corrected = store.amend({ requestId: 'panel-amended-2', taskId: amended.task.id, reason: 'PANEL_DARK_BACKGROUND',
      requirements: [{ statement: 'Use a dark background', scope: 'task', supersedes: amended.activeRequirements[0]!.id }] }, 'msg-panel-amended-2')

    // 5 · paused — explicit control outranks the running assignment.
    const paused = store.create({ requestId: 'panel-paused', goalTitle: 'PANEL_GOAL_ELDER_CARE', title: 'PANEL_TASK_PAUSED',
      scopeIn: ['one brief'], requirements: [requirements[0]!], acceptance: ['The brief is readable'] }, 'msg-panel-paused')
    store.recordAssignment({ id: 'asg-panel-paused-1', taskId: paused.task.id, definitionVersion: paused.definitionVersion,
      requirementIds: paused.activeRequirements.map(item => item.id), state: 'running', sessionId: 'panel-worker-paused',
      createdAt: Date.now(), updatedAt: Date.now() })
    store.control({ requestId: 'panel-paused-control', taskIds: [paused.task.id], action: 'pause' })

    // 6 · not ready — the panel must show the concrete missing precondition.
    const blocked = store.create({ requestId: 'panel-blocked', goalTitle: 'PANEL_GOAL_ELDER_CARE', title: 'PANEL_TASK_NOT_READY',
      scopeIn: ['one brief'], requirements: [requirements[1]!], acceptance: ['The brief is readable'] }, 'msg-panel-blocked')
    store.applyReady({ taskId: blocked.task.id, definitionVersion: blocked.definitionVersion, ready: false,
      missing: ['PANEL_MISSING_SOURCE_ACCESS'], authority: ['permissionMode: guarded'], checkedAt: Date.now() })

    // 7 · accepted — an acceptance decision bound to the version it judged.
    const accepted = store.create({ requestId: 'panel-accepted', goalTitle: 'PANEL_GOAL_ELDER_CARE', title: 'PANEL_TASK_ACCEPTED',
      scopeIn: ['one brief'], requirements: [requirements[0]!], acceptance: ['The brief is readable'] }, 'msg-panel-accepted')
    store.recordAssignment({ id: 'asg-panel-accepted-1', taskId: accepted.task.id, definitionVersion: accepted.definitionVersion,
      requirementIds: accepted.activeRequirements.map(item => item.id), state: 'completed', sessionId: 'panel-worker-accepted',
      createdAt: Date.now(), updatedAt: Date.now() })
    store.recordVerification({ requestId: 'panel-accepted-verify', taskId: accepted.task.id, verdict: 'accepted',
      results: [{ criterionId: 'ac-1', outcome: 'met', evidence: 'PANEL_EVIDENCE_READABLE' }] }, accepted.definitionVersion, 'asg-panel-accepted-1')

    taskIds = [intake.task.id, running.task.id, amended.task.id, paused.task.id, blocked.task.id, accepted.task.id]
    // Record what the store actually holds, so the browser half can prove the
    // screen matches the Host record rather than a hand-written expectation.
    run.json('task-store-records.json', { taskIds, amendedVersion: corrected.definitionVersion, supersededId: amended.activeRequirements[0]!.id })
  } finally { store.close() }

  // The resident Session must exist before the panel can be opened; the desktop
  // entry creates it through the real RPC path.
  const input = join(run.directory, 'input.json')
  writeFileSync(input, JSON.stringify({ root: resolve('.'), config, output: run.directory, workspaceId: 'alpha',
    executable: process.env.PHANERIS_VERIFICATION_EXECUTABLE }))
  const child = Bun.spawn(['node', 'scripts/verification/fixtures/assistant-task-panel.cjs', input], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  provider.stop(true)
  writeFileSync(join(run.directory, 'native.log'), out + err)
  assert.equal(code, 0, (out + err).slice(-8000))
  const result = JSON.parse(readFileSync(join(run.directory, 'board-evidence.json'), 'utf8')) as { scenes: string[] }
  for (const shot of ['board-peek.png', 'board-panel.png']) {
    const file = join(run.directory, shot)
    assert(existsSync(file), `Missing ${shot}`)
    assert(readFileSync(file).byteLength > 20_000, `${shot} must contain a rendered board`)
  }
  run.complete(result.scenes, [
    'A real model producing the delegations shown in the panel (records are written by the Host store)',
    'Physical touch hardware',
    'Signed installer distribution',
  ])
  console.log(JSON.stringify({ passed: result.scenes.length, output: run.directory }))
})
