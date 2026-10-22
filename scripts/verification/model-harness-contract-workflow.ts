/** Contract integration scenarios declared before production changes. No live services or model calls. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { verificationWorkflow } from './verification-artifacts'
import { shouldAllowToolInMode } from '../../packages/shared/src/agent/mode-manager'
import { shouldPromptInAskMode } from '../../packages/shared/src/agent/core/pre-tool-use'
import { getToolDefsAsJsonSchema } from '../../packages/session-tools-core/src/tool-defs'
import { handleSubmitPlan } from '../../packages/session-tools-core/src/handlers/submit-plan'
import { handleSourceOAuthTrigger } from '../../packages/session-tools-core/src/handlers/source-oauth'
import type { SessionToolContext } from '../../packages/session-tools-core/src/context'
import { SourceManager } from '../../packages/shared/src/agent/core/source-manager'
import { PrerequisiteManager } from '../../packages/shared/src/agent/core/prerequisite-manager'
import { createSessionAgentCallbacks } from '../../packages/server-core/src/sessions/agent-product-callbacks'
import { formatPluginContextBlock } from '../../packages/shared/src/plugins/plugin-context'

await verificationWorkflow('model-harness-contract', async evidence => {
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-harness-'))
  const plan = join(fixture, 'plan.md')
  writeFileSync(plan, '# Plan\n\nProduce a verifiable research document.\n')
  const fs = { exists: () => true, readFile: () => '# Plan\nResearch document' }
  const permissionManager = { isCommandWhitelisted: () => false, getBaseCommand: (s: string) => s,
    extractDomainFromNetworkCommand: () => null, isDangerousCommand: () => false, isDomainWhitelisted: () => false }
  const results: Array<{ id: string; passed: boolean; error?: string }> = []
  const scenario = async (id: string, run: () => unknown) => {
    try { await run(); results.push({ id, passed: true }) }
    catch (error) { results.push({ id, passed: false, error: String(error) }) }
  }
  for (const name of ['mcp__session__web_search', 'mcp__session__web_fetch']) {
    await scenario(`explore:${name}`, () => assert.equal(shouldAllowToolInMode(name, {}, 'safe').allowed, true))
    await scenario(`ask:${name}`, () => assert.equal(shouldPromptInAskMode(name, {}, permissionManager, { workspaceRootPath: fixture } as never), null))
  }
  await scenario('unknown-tool-is-not-silently-safe', () => assert.equal(shouldAllowToolInMode('unregistered_harness_fixture', {}, 'safe').allowed, false))
  await scenario('source-suffix-does-not-inherit-internal-permission', () => assert.equal(shouldAllowToolInMode('mcp__fixture__SubmitPlan', {}, 'safe').allowed, false))
  await scenario('source-browser-suffix-does-not-inherit-internal-permission', () => assert.equal(shouldAllowToolInMode('mcp__fixture__browser_tool', {}, 'safe').allowed, false))
  await scenario('llm-schema-only-advertises-supported-arguments', () => {
    const schema = getToolDefsAsJsonSchema().find(t => t.name.endsWith('call_llm'))!.inputSchema
    assert(!('thinking' in (schema.properties as object)))
    assert(!('thinkingBudget' in (schema.properties as object)))
  })
  await scenario('submit-plan-waits-for-host', async () => {
    let acknowledge!: () => void
    let settled = false
    const ctx = { fs, callbacks: { onPlanSubmitted: () => new Promise<void>(resolve => { acknowledge = resolve }) } } as unknown as SessionToolContext
    const pending = handleSubmitPlan(ctx, { planPath: plan }).then(result => { settled = true; return result })
    await new Promise(resolve => setTimeout(resolve, 5))
    const premature = settled
    acknowledge()
    const result = await pending
    assert.equal(premature, false)
    assert.equal(result.isError, false)
    assert.equal((result as any).continuation, 'await_user')
  })
  await scenario('submit-plan-host-failure-is-tool-error', async () => {
    const ctx = { fs, callbacks: { onPlanSubmitted: () => { throw new Error('Host cannot display plan') } } } as unknown as SessionToolContext
    const result = await handleSubmitPlan(ctx, { planPath: plan })
    assert.equal(result.isError, true)
    assert.match(result.content[0]!.text, /Host cannot display plan/)
    assert.notEqual((result as any).continuation, 'await_user')
  })
  const source = { id: 'fixture', slug: 'fixture', name: 'Fixture', type: 'mcp', provider: 'fixture', enabled: true,
    isAuthenticated: true, mcp: { authType: 'oauth', url: 'https://fixture.invalid' } }
  await scenario('silent-oauth-continues-without-ui', async () => {
    let ui = 0
    const ctx = { sessionId: 'fixture', workspacePath: fixture, loadSourceConfig: () => source,
      credentialManager: { refresh: async () => 'fixture-token' }, callbacks: { onAuthRequest: () => { ui++ } } } as unknown as SessionToolContext
    const result = await handleSourceOAuthTrigger(ctx, { sourceSlug: 'fixture' })
    assert.equal(result.isError, false)
    assert.equal(ui, 0)
    assert.notEqual((result as any).continuation, 'await_user')
  })
  await scenario('interactive-oauth-reports-ui-wait', async () => {
    let ui = 0
    const ctx = { sessionId: 'fixture', workspacePath: fixture, loadSourceConfig: () => ({ ...source, isAuthenticated: false }),
      callbacks: { onAuthRequest: () => { ui++ } } } as unknown as SessionToolContext
    const result = await handleSourceOAuthTrigger(ctx, { sourceSlug: 'fixture' })
    assert.equal(ui, 1)
    assert.equal((result as any).continuation, 'await_user')
  })
  await scenario('multilingual-discovery-and-loaded-tools', async () => {
    const { createPhanerisToolSearch } = await import('../../packages/pi-agent-server/src/tool-discovery')
    let active = ['read']
    const tools = [{ name: 'mcp__fixture__search_documents', description: 'Search documents 搜索知识库文档', parameters: { type: 'object' }, exposure: 'deferred' }]
    const search = createPhanerisToolSearch({ getAllTools: () => tools, getActiveTools: () => active,
      setActiveTools: (names: string[]) => { active = names } } as never)
    const call = (query: string) => search.execute('fixture', { query }, undefined, undefined, {} as never)
    const first = await call('搜索知识库文档')
    assert.match(JSON.stringify(first), /mcp__fixture__search_documents/)
    assert(active.includes(tools[0]!.name))
    const second = await call('search documents')
    assert.match(JSON.stringify(second), /already_available/)
    const catalog = await call('')
    assert.match(JSON.stringify(catalog), /mcp__fixture__search_documents/)
  })
  await scenario('source-format-is-observational-and-latest-state-is-authoritative', () => {
    const sources = new SourceManager()
    sources.setAllSources([{ config: { ...source, tagline: 'Research fixture' }, folderPath: fixture, guide: null } as never])
    sources.updateActiveState(['fixture'], [], ['fixture'])
    const first = sources.formatSourceState()
    assert.equal(sources.formatSourceState(), first, 'Formatting must not acknowledge delivery')
    assert.match(first, /latest|current snapshot/i)
  })
  await scenario('partial-skill-read-does-not-clear-prerequisite', () => {
    const manager = new PrerequisiteManager({ workspaceRootPath: fixture })
    const path = join(fixture, 'SKILL.md')
    manager.registerSkillPrerequisites([path])
    manager.trackReadTool({ file_path: path, offset: 20, limit: 10 })
    assert.equal(manager.hasRead(path), false)
  })
  await scenario('sdk-truncated-skill-read-does-not-clear-prerequisite', () => {
    const manager = new PrerequisiteManager({ workspaceRootPath: fixture })
    const path = join(fixture, 'large-SKILL.md')
    manager.registerSkillPrerequisites([path])
    manager.trackReadTool({ file_path: path }, '[Showing lines 1-2000 of 3000. Use offset=2001 to continue.]')
    assert.equal(manager.hasRead(path), false)
  })
  await scenario('skill-catalog-invalidates-on-watcher-event', async () => {
    const { loadAllSkills } = await import('../../packages/shared/src/skills/storage')
    const { ConfigWatcher } = await import('../../packages/shared/src/config/watcher')
    const directory = join(fixture, 'skills', 'harness-fixture')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'SKILL.md')
    writeFileSync(path, '---\nname: harness-fixture\ndescription: First description\n---\nInstructions')
    assert.equal(loadAllSkills(fixture).find(s => s.slug === 'harness-fixture')?.metadata.description, 'First description')
    writeFileSync(path, '---\nname: harness-fixture\ndescription: Updated description\n---\nInstructions')
    const watcher = new ConfigWatcher(fixture, {})
    ;(watcher as any).handleSkillChange('harness-fixture')
    assert.equal(loadAllSkills(fixture).find(s => s.slug === 'harness-fixture')?.metadata.description, 'Updated description')
  })
  await scenario('plan-approval-binds-rendered-version-and-rejects-stale-path', async () => {
    const { buildPlanApproval } = await import('../../packages/server-core/src/sessions/plan-approval')
    const message = { id: 'plan-fixture', role: 'plan', planPath: plan, content: 'Only create a research document.' }
    const approval = buildPlanApproval([message], plan)
    assert.match(approval, /plan-fixture/)
    assert.match(approval, /sha256/)
    assert.match(approval, /Only create a research document/)
    assert.throws(() => buildPlanApproval([message], join(fixture, 'other-plan.md')))
    assert.throws(() => buildPlanApproval([message], plan, 'stale-rendered-message'))
    assert.throws(() => buildPlanApproval([], plan))
  })
  await scenario('recovery-retains-original-goal-and-accepted-scope', () => {
    const messages = [{ role: 'user', content: 'Research and produce a sourced Chinese report.' },
      { role: 'user', content: 'Plan approved, please execute the accepted scope below.\nAccepted plan message: p1\nContent sha256: fixture\n' + 'accepted scope '.repeat(200) },
      ...Array.from({ length: 10 }, (_, i) => ({ role: 'assistant', content: `Progress ${i}` }))]
    const callbacks = createSessionAgentCallbacks({ read: () => ({ id: 'fixture', messages }) } as never)
    const recovery = callbacks.getRecoveryMessages!()
    assert(recovery.some(message => message.content === messages[0]!.content))
    assert(recovery.some(message => message.content.includes('Content sha256: fixture') && (message as any).preserveContent))
  })
  await scenario('plugin-context-declares-version-and-authority', () => {
    const text = formatPluginContextBlock({ name: 'fixture', manifest: { name: 'fixture', version: '1.2.3' },
      workspaceRootPath: fixture, path: fixture, resources: { skills: [] }, promptFragment: 'Write clear research.', warnings: [] } as never)
    assert.match(text, /1\.2\.3/)
    assert.match(text, /permission|authorization/i)
    assert.match(text, /scope|task/i)
  })
  await scenario('prompt-language-uses-persisted-preference-before-i18n-hydration', () => {
    const config = join(fixture, 'language-config')
    mkdirSync(config)
    writeFileSync(join(config, 'preferences.json'), JSON.stringify({ uiLanguage: 'zh-Hans' }))
    const module = pathToFileURL(join(import.meta.dir, '../../packages/shared/src/config/preferences.ts')).href
    const child = spawnSync(process.execPath, ['-e', `const p = await import(${JSON.stringify(module)}); console.log(p.formatPreferencesForPrompt())`], {
      env: { ...process.env, PHANERIS_CONFIG_DIR: config }, encoding: 'utf8', timeout: 30000,
    })
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stdout, /中文/)
  })
  mkdirSync(join(fixture, 'artifacts'), { recursive: true })
  evidence.json('scenarios.json', { fixture, scope: 'Real permission functions and session handlers; synthetic host and tool catalog; no model inference', results })
  console.log(JSON.stringify({ output: evidence.directory, results }))
  assert.equal(results.filter(r => !r.passed).length, 0, 'Harness contract scenarios failed (see scenarios.json)')
  evidence.complete(results.map(r => r.id), ['live model quality', 'native browser UI', 'external OAuth', 'Linux isolation', 'conflicting side effects'])
})
