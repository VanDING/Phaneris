/**
 * Regression matrix declared before the fix: skill/source advice must not expose
 * model instructions, tags or local paths; every UI locale must translate it;
 * no/uncertain picks stay silent; advice never enters the model or activates a source.
 * Exercises the real SessionManager, decision HTTP endpoint and renderer projection.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('suggestion-advice', async evidence => {
  const config = join(evidence.directory, 'config'), rootPath = join(evidence.directory, 'workspace')
  const skillPath = join(rootPath, 'skills', 'research'), sourcePath = join(rootPath, 'sources', 'filesystem')
  for (const path of [config, skillPath, sourcePath]) mkdirSync(path, { recursive: true })
  writeFileSync(join(skillPath, 'SKILL.md'), '---\nname: Research\ndescription: Research reports\n---\nRead evidence.')
  writeFileSync(join(sourcePath, 'config.json'), JSON.stringify({ id: 'filesystem', slug: 'filesystem', name: 'Filesystem',
    type: 'local', provider: 'filesystem', enabled: true, local: { path: rootPath } }))
  writeFileSync(join(sourcePath, 'guide.md'), 'Read project files.')
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.NODE_ENV = 'test'
  let choice = 'skill:research', confidence = .99, requests = 0
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any
    requests++
    return Response.json({ model: body.model, answers: { needed: { type: 'choice', choice, confidence,
      probabilities: { none: choice === 'none' ? confidence : 1 - confidence, [choice]: confidence } } },
      usage: { input_tokens: 7, output_tokens: 3 } })
  } })
  const workspace = { id: 'advice', name: 'Advice', rootPath, createdAt: 1 }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id,
    llmConnections: [], decisionLayer: { enabled: true, provider: 'custom', baseUrl: api.url.href, model: 'fixture',
      features: { suggestions: true, adaptiveThinking: false } } }))
  const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createSession } = await import('../../packages/shared/src/sessions/storage')
  const { setPersistedUiLanguage } = await import('../../packages/shared/src/config/preferences')
  const { SUPPORTED_LANGUAGE_CODES } = await import('../../packages/shared/src/i18n')
  const { handleInfo } = await import('../../apps/electron/src/renderer/event-processor/handlers/session')
  const { createEmptySession } = await import('../../apps/electron/src/renderer/event-processor/helpers')
  const manager = new SessionManager() as any
  const stored = await createSession(rootPath, { name: 'Advice fixture' })
  const managed = createManagedSession(stored, workspace as never, { messagesLoaded: true }) as any
  manager.registerManagedSession(managed)
  const events: any[] = [], checks: string[] = [], advice: Array<{ language: string; choice: string; content: string }> = []
  manager.eventSink = (_channel: unknown, _target: unknown, event: any) => events.push(event)
  const handle = manager.durableRuntime.execution.begin({ sessionId: stored.id, workspaceRootPath: rootPath })
  manager.durableRuntime.execution.accept(handle, { operationId: 'advice-run', userMessageId: 'original', userMessage: 'Research project files' })
  managed.messages.push({ id: 'original', role: 'user', content: 'Research project files', timestamp: 1 })
  const runDecision = async () => {
    const result = await manager.startPreTurnDecisions(managed, 'Research project files')
    assert.equal(result.suggestionHint, null)
    for (let i = 0; i < 300 && managed.preTurnDecisionAbort; i++) await Bun.sleep(10)
    assert.equal(managed.preTurnDecisionAbort, undefined, 'Decision must settle')
    assert.equal(managed.turnSuggestionHint, null)
    assert.deepEqual(managed.enabledSourceSlugs ?? [], [])
    assert.equal(managed.messages.length, 1)
    assert.equal(managed.messages[0].content, 'Research project files')
  }
  try {
    for (const language of SUPPORTED_LANGUAGE_CODES) {
      setPersistedUiLanguage(language)
      for (const picked of ['skill:research', 'source:filesystem']) {
        choice = picked
        const before = events.length
        await runDecision()
        const emitted = events.slice(before).filter(event => event.type === 'info')
        assert.equal(emitted.length, 1, `${language}/${choice} should emit one UI notice`)
        const state = handleInfo({ session: createEmptySession(stored.id, workspace.id), streaming: null }, emitted[0]).state
        const message = state.session.messages.at(-1)!
        assert.equal(message.role, 'info')
        assert.equal(message.infoLevel, 'info')
        assert(message.content.includes(picked.startsWith('skill:') ? 'Research' : 'Filesystem'))
        assert(!/system-reminder|decision model|source_test|guide\.md|SKILL\.md|slug:|chat\.|[<>]|[\\/]/i.test(message.content), message.content)
        const expected = language === 'en'
          ? picked.startsWith('skill:') ? 'Suggested skill: Research. Type @ to select it.' : 'Suggested source: Filesystem. Select it from the sources menu to use it.'
          : language === 'zh-Hans'
            ? picked.startsWith('skill:') ? '推荐技能：Research。可输入 @ 选择使用。' : '推荐数据源：Filesystem。可从数据源菜单中选择使用。'
            : null
        if (expected) assert.equal(message.content, expected)
        if (language !== 'en') assert(!message.content.startsWith('Suggested '), 'Must not fall back to English')
        advice.push({ language, choice, content: message.content })
        checks.push(`${language}/${choice}: localized UI advice without internal instructions`)
      }
    }
    for (const scenario of [{ pick: 'none', certainty: .99 }, { pick: 'source:filesystem', certainty: .5 }]) {
      choice = scenario.pick; confidence = scenario.certainty
      const before = events.length
      await runDecision()
      assert(!events.slice(before).some(event => event.type === 'info'))
      checks.push(`${choice}/${confidence}: no confident recommendation stays silent`)
    }
    evidence.json('advice.json', { checks, requests, advice })
    evidence.complete(checks, ['live model recommendation quality', 'native UI layout', 'packaged client'])
    console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
  } finally {
    await manager.cleanup()
    const { getDecisionRecorder } = await import('../../packages/shared/src/decisions')
    await getDecisionRecorder().flush()
    api.stop(true)
  }
})
