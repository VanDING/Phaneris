/** Real permission pipeline + loopback decision server + isolated persisted settings. */
import { strict as assert } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..'), output = join(root, '.cache/ai-settings-refinement')
mkdirSync(output, { recursive: true })
const fixture = mkdtempSync(join(output, 'guarded-')), configRoot = join(fixture, 'config'), workspace = join(fixture, 'workspace')
mkdirSync(join(configRoot, 'permissions'), { recursive: true }); mkdirSync(workspace, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot
let failure = false, risky = false, calls = 0
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  calls++; const body = await req.json() as { questions: Record<string, unknown> }
  if (failure) return new Response('fixture unavailable', { status: 503 })
  return Response.json({ model: 'fixture', answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'noul', noul: risky && key === 'external' ? .99 : .01 }])) })
} })
writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null,
  decisionLayer: { enabled: true, provider: 'custom', baseUrl: api.url.href, model: 'fixture', features: { guardedMode: true } } }))
const modes = await import('../../packages/shared/src/agent/mode-manager')
const { PermissionManager } = await import('../../packages/shared/src/agent/core/permission-manager')
const { runPreToolUseChecks } = await import('../../packages/shared/src/agent/core/pre-tool-use')
const { applyGuardedModeCheck } = await import('../../packages/shared/src/agent/core/guarded-mode')
const { buildGuardedModeCheck } = await import('../../packages/server-core/src/decisions/guarded-mode')
const { getDecisionLayerStatus } = await import('../../packages/shared/src/decisions/status')
const { setDecisionLayerSettings } = await import('../../packages/shared/src/config/storage')
const sessionId = 'guarded-workflow'
modes.setGuardedModeActiveResolver(() => true); modes.setPermissionMode(sessionId, 'guarded')
const input = { sessionId, permissionMode: 'guarded' as const, workspaceRootPath: workspace, workspaceId: 'fixture', workingDirectory: workspace,
  activeSourceSlugs: [], allSourceSlugs: [], hasSourceActivation: false, permissionManager: new PermissionManager({ sessionId }),
  toolName: 'Bash', input: { command: 'git push origin main' } }
const records: Array<{ id: string; pass: boolean; observation?: unknown; error?: string }> = []
async function check(id: string, action: () => Promise<unknown>) {
  try { records.push({ id, pass: true, observation: await action() }) }
  catch (error) { records.push({ id, pass: false, error: String(error) }) }
}
async function policy(interactive = true) {
  return applyGuardedModeCheck(runPreToolUseChecks(input), input, buildGuardedModeCheck({ sessionId, isInteractive: () => interactive }))
}
try {
  await check('Valid low-risk verdict permits the mutation; risky verdict prompts', async () => {
    assert.equal((await policy()).type, 'allow')
    risky = true; const result = await policy(); assert.equal(result.type, 'prompt'); risky = false
    return result
  })
  await check('HTTP failure asks for confirmation instead of executing', async () => {
    failure = true; const result = await policy(); failure = false
    assert.equal(result.type, 'prompt'); assert(JSON.stringify(result).includes('unavailable'))
    return result
  })
  await check('Absent checker and malformed verdict do not authorize a mutation', async () => {
    const pre = runPreToolUseChecks(input)
    assert.equal((await applyGuardedModeCheck(pre, input, null)).type, 'prompt')
    const result = await applyGuardedModeCheck(pre, input, { isActive: () => true, check: async () => ({ risks: ['invalid'] as never[] }) })
    assert.equal(result.type, 'prompt'); return result
  })
  await check('Unattended guarded mutation blocks without making a decision request', async () => {
    const before = calls, result = await policy(false)
    assert.equal(result.type, 'block'); assert.equal(calls, before); return result
  })
  await check('Read-only commands remain available without a checker', async () => {
    const read = { ...input, input: { command: 'pwd' } }
    const result = await applyGuardedModeCheck(runPreToolUseChecks(read), read, null)
    assert.equal(result.type, 'allow'); return result
  })
  await check('Backend status validates actual configuration and credentials', async () => {
    const keys = { getDecisionApiKey: async () => null, getLlmApiKey: async () => null }
    const ready = await getDecisionLayerStatus(keys)
    assert.equal(ready.guardedMode.available, true)
    setDecisionLayerSettings({ provider: 'typesafe', connectionSlug: null })
    const missing = await getDecisionLayerStatus(keys)
    assert.equal(missing.guardedMode.available, false); assert.equal(missing.guardedMode.reason, 'unconfigured')
    setDecisionLayerSettings({ enabled: false })
    const disabled = await getDecisionLayerStatus(keys)
    assert.equal(disabled.guardedMode.reason, 'disabled')
    return { ready: ready.guardedMode, missing: missing.guardedMode, disabled: disabled.guardedMode }
  })
} finally {
  api.stop(true); modes.cleanupModeState(sessionId); modes.setGuardedModeActiveResolver(null)
  writeFileSync(join(output, 'guarded-latest.json'), JSON.stringify({ fixture, records, calls }, null, 2))
}
console.log(JSON.stringify({ fixture, passed: records.filter(record => record.pass).length, total: records.length }))
process.exit(records.every(record => record.pass) ? 0 : 1)
