#!/usr/bin/env bun
/** P120 failure matrix: real 1.1.0 bundle/journal -> 1.2.0 Host + Pi + loopback provider. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
const args = process.argv.slice(2)
const baselineArgument = args.find(argument => argument.startsWith('--baseline-dir='))
const evidence = new VerificationRun('pi-120-upgrade')
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string) => hash(readFileSync(path))
const packageNames = ['pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-codemode', 'pi-mcp', 'pi-telemetry', 'pi-tui']
const scenes: string[] = []
let failure: unknown

try {
  evidence.checkArguments(baselineArgument ? [baselineArgument] : [])
  assert(baselineArgument, 'Pass --baseline-dir=<verified Pi 1.1.0 bundle directory with identity.json>')
  const baseline = resolve(baselineArgument.slice('--baseline-dir='.length))
  const identity = JSON.parse(readFileSync(join(baseline, 'identity.json'), 'utf8')) as {
    sdkVersions: Record<string, string>; sourceHead: string; lockfileSha256: string; artifacts: Record<string, string>
  }
  assert.equal(Object.keys(identity.sdkVersions).length, packageNames.length)
  for (const name of packageNames) assert.equal(identity.sdkVersions[name], '1.1.0')
  assert.match(identity.sourceHead, /^[a-f0-9]{40}$/)
  assert.match(identity.lockfileSha256, /^[a-f0-9]{64}$/)
  for (const name of ['index.js', 'bundle.js', 'worker.js', 'node_modules/quickjs-wasi/quickjs.wasm']) {
    assert.equal(fileHash(join(baseline, 'dist', name)), identity.artifacts[name], `Baseline artifact changed: ${name}`)
  }
  evidence.json('baseline-identity.json', identity)
  scenes.push('verified-1.1.0-baseline')

  const versions = Object.fromEntries(packageNames.map(name => [name,
    JSON.parse(readFileSync(join(root, 'node_modules/@earendil-works', name, 'package.json'), 'utf8')).version]))
  for (const name of packageNames) assert.equal(versions[name], '1.2.0', `Installed SDK version: ${name}`)
  const declarations: Record<string, Record<string, string>> = {}
  for (const path of ['package.json', 'packages/shared/package.json', 'packages/server-core/package.json', 'packages/pi-agent-server/package.json']) {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'))
    declarations[path] = Object.fromEntries(Object.entries(manifest.dependencies as Record<string, string>)
      .filter(([name]) => name.startsWith('@earendil-works/pi-')))
    for (const [name, version] of Object.entries(declarations[path])) assert.equal(version, '1.2.0', `${path}: ${name}`)
  }
  const lock = readFileSync(join(root, 'bun.lock'), 'utf8')
  const locked = Object.fromEntries([...lock.matchAll(/"(@earendil-works\/pi-[^"/]+)": \["([^"]+)"/g)]
    .map(match => [match[1], match[2]]))
  assert.equal(Object.keys(locked).length, packageNames.length)
  for (const name of packageNames) assert.equal(locked[`@earendil-works/${name}`], `@earendil-works/${name}@1.2.0`)
  for (const name of ['chord', 'pi-server', 'pi-client', 'pi-protocol']) assert(!lock.includes(`"@earendil-works/${name}":`), `Removed SDK dependency remains: ${name}`)
  const currentEntry = join(root, 'packages/pi-agent-server/dist/index.js')
  evidence.json('sdk-identity.json', { versions, declarations, locked, artifacts: Object.fromEntries(
    ['index.js', 'bundle.js', 'worker.js', 'node_modules/quickjs-wasi/quickjs.wasm'].map(name =>
      [name, fileHash(join(root, 'packages/pi-agent-server/dist', name))])) })
  scenes.push('uniform-1.2.0-sdk-graph')

  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-pi-120-history-'))
  process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
  process.env.NODE_ENV = 'test'
  const workspace = join(fixture, 'workspace')
  const requests: { before: boolean; after: boolean; compacted: boolean; systemPrompt: boolean }[] = []
  const effects: { phase: string; [key: string]: unknown }[] = []
  const checks: Record<string, unknown>[] = []
  const agents: any[] = []
  let sequence = 0
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { messages: { role: string; content: unknown }[] }
    const text = JSON.stringify(body.messages)
    const systemPrompt = body.messages.filter(message => message.role === 'system')
      .some(message => JSON.stringify(message.content).includes('PHANERIS_120_HISTORY_PROMPT'))
    requests.push({ before: text.includes('BASELINE_BEFORE_EVIDENCE'), after: text.includes('BASELINE_AFTER_EVIDENCE'),
      compacted: text.includes('COMPACTED_STATE_42'), systemPrompt })
    const event = (delta: unknown, finishReason: string | null = null) => `data: ${JSON.stringify({
      id: `history-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(finishReason ? { usage: { prompt_tokens: Math.ceil(text.length / 4), completion_tokens: 10,
        total_tokens: Math.ceil(text.length / 4) + 10 } } : {}),
    })}\n\n`
    const reply = text.includes('Preserve fixture evidence') ? 'COMPACTED_STATE_42 fixture summary' : 'NORMAL_HISTORY_REPLY fixture complete'
    return new Response(event({ role: 'assistant' }) + event({ content: reply }) + event({}, 'stop') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
  const sessionPath = (id: string) => join(workspace, 'sessions', id)
  function fileFor(id: string) {
    const directory = join(sessionPath(id), '.pi-sessions')
    const file = readdirSync(directory, { recursive: true }).find(name => String(name).endsWith('.jsonl'))
    assert(file, 'Native session file missing')
    return join(directory, String(file))
  }
  function make(id: string, entry = currentEntry, branch?: Record<string, unknown>) {
    mkdirSync(sessionPath(id), { recursive: true })
    const agent = new PiAgent({
      provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/fixture', miniModel: 'pi/fixture',
      workspace: { id: 'history', name: 'History fixture', rootPath: workspace },
      session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1, ...branch },
      isHeadless: true, contextPolicy: 'manual',
      runtime: { paths: { piServer: entry, node: process.execPath }, baseUrl: api.url.href,
        customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] },
      envOverrides: { HOME: fixture, USERPROFILE: fixture, PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, NODE_ENV: 'test' },
      beginDurableUtilityRun: () => ({ runOperationId: `utility-${++sequence}`, turnId: `utility-${sequence}` }),
      durableModelBoundary: {
        prepare: async (request: Record<string, unknown>) => {
          effects.push({ phase: 'T1', ...request })
          return { operationId: `model-${++sequence}`, idempotencyKey: `model-${sequence}`, created: true,
            status: 'prepared', committedSeq: sequence }
        },
        commitOutcome: async (request: Record<string, unknown>) => {
          effects.push({ phase: 'T2', ...request }); return { committedSeq: ++sequence }
        },
      },
    } as any) as any
    agent.wire = []
    const handle = agent.handleLine.bind(agent)
    agent.handleLine = (line: string) => { try { agent.wire.push(JSON.parse(line)) } catch {} return handle(line) }
    agents.push(agent)
    return agent
  }
  async function turn(agent: any, message: string) {
    await agent.ensureSubprocess()
    const start = agent.wire.length
    agent.send({ type: 'prompt', id: `turn-${++sequence}`, message, systemPrompt: 'PHANERIS_120_HISTORY_PROMPT',
      durableRunOperationId: `run-${sequence}` })
    const deadline = Date.now() + 30_000
    while (!agent.wire.slice(start).some((row: any) => row.type === 'event' && row.event?.type === 'agent_settled')) {
      assert(Date.now() < deadline, 'History workflow deadline')
      const errors = agent.wire.slice(start).filter((row: any) => row.type === 'error')
      assert.equal(errors.length, 0, JSON.stringify(errors))
      await Bun.sleep(10)
    }
    assert(!agent.wire.slice(start).some((row: any) => row.type === 'error'))
    assert(requests.at(-1)?.systemPrompt, 'Host system prompt did not reach the provider')
  }
  try {
    const legacy = make('parent', join(baseline, 'dist/index.js'))
    await turn(legacy, 'BASELINE_BEFORE_EVIDENCE ' + 'earlier context '.repeat(6500))
    await turn(legacy, 'BASELINE_AFTER_EVIDENCE ' + 'later context '.repeat(6500))
    const oldSessionId = legacy.piSessionId
    await legacy.disposeForRestart()
    const original = readFileSync(fileFor('parent'), 'utf8')
    const entries = original.split('\n').filter(Boolean).map(line => JSON.parse(line))
    const anchor = entries.find(entry => entry.type === 'message' && entry.message?.role === 'assistant')?.id
    assert(anchor)
    const current = make('parent')
    await turn(current, 'Resume the existing history')
    assert.equal(current.piSessionId, oldSessionId)
    assert(requests.at(-1)?.before && requests.at(-1)?.after)
    assert(readFileSync(fileFor('parent'), 'utf8').startsWith(original))
    checks.push({ id: '1.1.0-journal-resumes-in-1.2.0', oldSessionId, restoredSessionId: current.piSessionId,
      originalSha256: hash(original), anchor })
    scenes.push('1.1.0-journal-resumes-in-1.2.0')

    const parentBefore = readFileSync(fileFor('parent'))
    const branch = make('branch', currentEntry, { branchFromMessageId: 'host-fixture-anchor',
      branchFromSessionPath: sessionPath('parent'), branchFromSdkSessionId: oldSessionId, branchFromSdkTurnId: anchor })
    await branch.ensureBranchReady()
    assert.notEqual(branch.piSessionId, oldSessionId)
    await turn(branch, 'Continue from the selected earlier reply')
    assert(requests.at(-1)?.before)
    assert.equal(requests.at(-1)?.after, false)
    assert.equal(fileHash(fileFor('parent')), hash(parentBefore))
    checks.push({ id: 'branch-cutoff-and-parent-integrity', parentSha256: hash(parentBefore), branchSessionId: branch.piSessionId })
    scenes.push('branch-cutoff-and-parent-integrity')

    const beforeRequests = requests.length, beforeEffects = effects.length
    const compact = await current.requestCompact('Preserve fixture evidence')
    assert(compact.summary.includes('COMPACTED_STATE_42'))
    assert(requests.length > beforeRequests)
    for (const phase of ['T1', 'T2']) assert(effects.slice(beforeEffects).some(effect => effect.phase === phase))
    assert(readFileSync(fileFor('parent'), 'utf8').includes('"type":"compaction"'))
    const idBefore = current.piSessionId
    await current.disposeForRestart()
    const restarted = make('parent')
    await turn(restarted, 'Continue after compacting')
    assert.equal(restarted.piSessionId, idBefore)
    assert(requests.at(-1)?.compacted)
    checks.push({ id: 'manual-compaction-survives-restart', sessionId: idBefore, tokensBefore: compact.tokensBefore,
      estimatedTokensAfter: compact.estimatedTokensAfter })
    scenes.push('manual-compaction-survives-restart')
    const modelPreparations = effects.filter(effect => effect.phase === 'T1').length
    const modelOutcomes = effects.filter(effect => effect.phase === 'T2').length
    assert.equal(modelPreparations, modelOutcomes)
    assert(modelPreparations >= 6)
    scenes.push('host-prompt-and-model-boundary-parity')
    evidence.json('history.json', { scope: 'Real Pi 1.1.0 journal, Pi 1.2.0 Host/child, loopback inference',
      checks, requests, modelPreparations, modelOutcomes,
      journals: ['parent', 'branch'].map(id => ({ id, sha256: fileHash(fileFor(id)), bytes: readFileSync(fileFor(id)).byteLength })) })
    evidence.complete(scenes, ['live provider APIs', 'live OAuth network refresh', 'Linux/macOS execution', 'signed installers/release'])
  } finally {
    for (const agent of agents) { await agent.disposeForRestart(); agent.destroy() }
    api.stop(true)
  }
} catch (error) { failure = error }
evidence.json('upgrade.json', { scenes })
evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
