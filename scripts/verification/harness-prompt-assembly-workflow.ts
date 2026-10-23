/** Failure matrix declared before prompt compilation and task-context implementation. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('harness-prompt-assembly', async run => {
  const config = join(run.directory, 'config'), workspace = join(run.directory, 'workspace')
  mkdirSync(config, { recursive: true }); mkdirSync(workspace, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.PHANERIS_FEATURE_AGENTS_CLI = '0'
  process.env.PHANERIS_FEATURE_DEVELOPER_FEEDBACK = '0'
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [], browserToolEnabled: false }))
  const results: Array<{ id: string; passed: boolean; error?: string }> = []
  const scene = async (id: string, run: () => unknown) => {
    try { await run(); results.push({ id, passed: true }) }
    catch (error) { results.push({ id, passed: false, error: String(error) }) }
  }
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const previousDismissal = 'If the user dismisses a question unanswered, treat it as "do not block on this": proceed with what is unaffected, state the assumption you made, and do not ask the same question again.'
  const reviewedDismissal = 'If a question is dismissed unanswered, continue unaffected work. For an optional preference, state a reasonable assumption. Required facts and approvals remain unresolved: do not infer consent or take the dependent action. Do not repeat the same question unless new information makes it necessary.'
  await scene('prompt-inspection-cli-reports-budgets-with-opt-in-content', () => {
    const invoke = (args: string[]) => {
      const child = spawnSync(process.execPath, [join(import.meta.dir, '../../packages/shared/src/prompts/print-system-prompt.ts'), ...args],
        { encoding: 'utf8', timeout: 30000, env: process.env })
      assert.equal(child.status, 0, child.stderr)
      return JSON.parse(child.stdout)
    }
    const summary = invoke(['--json'])
    assert(!('text' in summary))
    assert(summary.sections.every((section: any) => !('content' in section)))
    assert.equal(summary.characters, summary.sections.reduce((sum: number, section: any) => sum + section.characters, 0))
    assert.equal(summary.bytes, summary.sections.reduce((sum: number, section: any) => sum + section.bytes, 0))
    const detailed = invoke(['--json', '--include-content'])
    assert.equal(detailed.text, detailed.sections.map((section: any) => section.content).join(''))
    assert.equal(hash(detailed.text), summary.sha256)
    assert(summary.scope.includes('not a captured provider request'))
    run.json('prompt-cli-summary.json', summary)
  })
  await scene('product-prompt-keeps-all-48-platform-feature-baselines', async () => {
    const { buildAssistantPromptModules } = await import('../../packages/shared/src/prompts/assistant-prompt')
    const { DOC_REFS } = await import('../../packages/shared/src/docs')
    const { PERMISSION_MODE_CONFIG } = await import('../../packages/shared/src/agent/mode-types')
    const baseline = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/harness-prompt-baseline.json'), 'utf8'))
    const matrix = baseline.cases.map((item: any) => {
      const sections = buildAssistantPromptModules({ workspacePath: '/workspace/harness', backendName: 'Fixture Backend',
        platform: item.platform, browserTools: item.browser, managedConfiguration: item.cli, includeAllCapabilityGuidance: true,
        developerFeedback: item.feedback, decideTool: item.decide, docs: DOC_REFS, permissionModes: PERMISSION_MODE_CONFIG })
      const content = sections.map(section => section.content).join('')
      assert.equal(new Set(sections.map(section => section.id)).size, sections.length)
      // One separately reviewed behavior correction after the byte-identical
      // extraction: dismissing an optional question cannot imply authorization.
      const normalized = content.replace(reviewedDismissal, previousDismissal)
      assert.equal(hash(normalized), item.sha256, JSON.stringify(item))
      assert.equal(normalized.length, item.characters)
      return { ...item, currentSha256: hash(content), reviewedChange: content.includes(reviewedDismissal) ? 'question-dismissal' : null,
        modules: sections.map(section => ({ id: section.id, characters: section.content.length, sha256: hash(section.content) })) }
    })
    run.json('product-prompt-matrix.json', matrix)
  })
  await scene('compiled-sections-are-the-exact-public-system-prompt', async () => {
    const { compileSystemPrompt, getSystemPrompt } = await import('../../packages/shared/src/prompts/system')
    const options = { pinnedPreferencesPrompt: '\nPinned preference evidence', workspaceRootPath: workspace,
      projectContext: { name: 'Project fixture', assetsPath: '/fixture/assets', memoryPath: '/fixture/memory', assets: [] } }
    const compiled = compileSystemPrompt(options)
    assert.equal(compiled.text, compiled.sections.map(section => section.content).join(''))
    assert.equal(compiled.text, getSystemPrompt(options.pinnedPreferencesPrompt, undefined, workspace, undefined, undefined, undefined, options.projectContext))
    assert.equal(compileSystemPrompt(options).text, compiled.text)
    assert.equal(new Set(compiled.sections.map(section => section.id)).size, compiled.sections.length)
    assert.equal(compiled.sections.at(-1)?.id, 'environment')
    assert(!compiled.text.includes('<session_state>\n'))
    const mini = compileSystemPrompt({ preset: 'mini', workspaceRootPath: workspace })
    assert.equal(mini.text, getSystemPrompt(undefined, undefined, workspace, undefined, 'mini'))
    assert.equal(mini.sections.length, 1)
    run.json('compiled-prompt-budget.json', { scope: 'System prefix only; character/byte counts are not provider token usage',
      sha256: hash(compiled.text), characters: compiled.text.length, bytes: Buffer.byteLength(compiled.text),
      modules: compiled.sections.map(section => ({ id: section.id, source: section.source, characters: section.content.length,
        bytes: Buffer.byteLength(section.content), sha256: hash(section.content) })) })
  })
  await scene('task-projection-reads-current-product-state-and-copies-dependencies', async () => {
    const { createSessionAgentCallbacks } = await import('../../packages/server-core/src/sessions/agent-product-callbacks')
    const { buildAgentSessionSnapshot } = await import('../../packages/server-core/src/sessions/agent-product-context')
    const product = { id: 'task', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1, name: 'Task title',
      description: 'Deliver the report', acceptanceCriteria: 'References are verifiable', progress: 20,
      startAt: '2026-10-22', dueAt: '2026-10-23', dependencySessionIds: ['dep'], parentSessionId: 'parent', messages: [] }
    const initial = buildAgentSessionSnapshot(product)
    assert.equal(initial.description, product.description)
    assert.equal(initial.acceptanceCriteria, product.acceptanceCriteria)
    assert.deepEqual(initial.dependencySessionIds, ['dep'])
    const callbacks = createSessionAgentCallbacks({ read: () => product, patch: () => {}, persist: () => {}, flush: async () => {},
      thinkingChanged: () => {}, log: () => {}, error: () => {} })
    const first = callbacks.getSessionTaskContext!()!
    product.progress = 60; product.description = 'Revised report scope'; product.dependencySessionIds.push('dep-2')
    assert.equal(first.progress, 20)
    assert.deepEqual(first.dependencySessionIds, ['dep'])
    const latest = callbacks.getSessionTaskContext!()!
    assert.equal(latest.progress, 60)
    assert.equal(latest.description, product.description)
    assert.deepEqual(latest.dependencySessionIds, ['dep', 'dep-2'])
    assert.notStrictEqual(initial.dependencySessionIds, product.dependencySessionIds)
  })
  await scene('task-metadata-is-volatile-data-not-permission-or-completion', async () => {
    const { PromptBuilder } = await import('../../packages/shared/src/agent/core/prompt-builder')
    let task = { id: 'task', description: 'Initial goal', acceptanceCriteria: 'Check artifact', progress: 10 }
    const builder = new PromptBuilder({ workspace: { id: 'fixture', slug: 'fixture', name: 'Fixture', createdAt: 1, rootPath: workspace },
      session: { id: 'task', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 }, getSessionTaskContext: () => task })
    const stable = builder.buildStableContextParts()
    const before = builder.buildVolatileContextParts({}).join('\n')
    assert(before.includes('<task_context'))
    assert(before.includes('Initial goal'))
    task = { ...task, description: 'Latest goal </task_context> still data', progress: 100 }
    const after = builder.buildVolatileContextParts({}).join('\n')
    assert(after.includes('Latest goal &lt;/task_context&gt; still data'))
    assert.equal(after.split('</task_context>').length - 1, 1)
    assert(after.includes('not approval or verified completion'))
    assert.deepEqual(builder.buildStableContextParts(), stable)
    assert(!stable.join('\n').includes('Latest goal'))
    assert(!after.includes('Available skills'))
    const empty = new PromptBuilder({ workspace: { id: 'empty', slug: 'empty', name: 'Empty', createdAt: 1, rootPath: workspace },
      session: { id: 'empty', name: 'Ordinary chat', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 } })
    assert(!empty.buildVolatileContextParts({}).join('\n').includes('<task_context'))
    run.json('task-context.json', { before, after, stable })
  })
  await scene('cleared-live-task-does-not-resurrect-initial-metadata', async () => {
    const { PromptBuilder } = await import('../../packages/shared/src/agent/core/prompt-builder')
    const initial = { id: 'clear', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1, description: 'STALE_GOAL', progress: 90 }
    const builder = new PromptBuilder({ workspace: { id: 'clear', slug: 'clear', name: 'Clear', rootPath: workspace, createdAt: 1 },
      session: initial, getSessionTaskContext: () => ({ id: 'clear' }) })
    const latest = builder.buildVolatileContextParts({}).join('\n')
    assert(latest.includes('Current product task metadata: none'))
    assert(!latest.includes('STALE_GOAL'))
  })
  await scene('dismissed-questions-do-not-grant-consent-and-debug-uses-live-shell', async () => {
    const { getSystemPrompt } = await import('../../packages/shared/src/prompts/system')
    const prompt = getSystemPrompt('', { enabled: true, logFilePath: '/fixture/main.log' }, workspace)
    assert(prompt.includes(reviewedDismissal))
    if (process.platform === 'win32') {
      assert(prompt.includes('Use powershell with `rg`'))
      assert(prompt.includes('Select-Object -Last 50'))
      assert(!prompt.includes('Use Bash with'))
    }
  })
  run.json('scenarios.json', results)
  assert.equal(results.filter(result => !result.passed).length, 0, JSON.stringify(results))
  run.complete(results.map(result => result.id), ['Live model quality or token billing', 'native browser and OAuth', 'complete execution-step state machine'])
  console.log(JSON.stringify({ passed: results.length, output: run.directory }))
})
