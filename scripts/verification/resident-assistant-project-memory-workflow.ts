import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure contract: controlled append must keep Project as sole owner, reject stale
// documents/forged evidence/cross-project Worker writes/secrets/paused learning,
// recover acknowledgements idempotently, preserve other writers, and retrieve the
// omitted middle with an exact file version and position, without copying it to L1.
await verificationWorkflow('resident-assistant-project-memory', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Project memory fixture', rootPath: root, createdAt: 1 }
  const configFile = join(root, 'config.json')
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true }))
  writeFileSync(configFile, JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'automatic', use: true } }))
  const { createProject, getProjectMemoryPath, loadProjectMemory } = await import('@phaneris/shared/projects')
  const { saveSession } = await import('@phaneris/shared/sessions')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { ProjectMemoryService } = await import('../../packages/server-core/src/resident-assistant/project-memory')
  const projectA = createProject(root, { name: 'Phaneris personal' }), projectB = createProject(root, { name: 'Other project' })
  const source = { sessionId: 'project-note-user', messageId: 'user' }, note = '首期只做个人使用，不增加团队功能。'
  await saveSession({ id: source.sessionId, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, projectId: projectA.id,
    messages: [{ id: source.messageId, type: 'user', content: `请记住本项目决定：${note}`, timestamp: 1, projectScope: { projectId: projectA.id } }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const memory = new AssistantMemoryStore(workspace), owner = new ProjectMemoryService(workspace, memory)
  const context = { role: 'worker' as const, sessionId: source.sessionId, projectId: projectA.id, currentUserSource: source, sessionLabel: 'Project note' }
  const command = { requestId: 'personal-only', note, assessment: { confidence: 'supported', durability: 'durable', domain: 'project_fact', reason: 'The direct user explicitly names this durable project decision.' } as const,
    evidence: { source, quote: note }, expectedContentHash: owner.read({}, context).reference.contentHash }
  const scenes: string[] = []
  try {
    const saved = owner.append(command, context), file = getProjectMemoryPath(root, projectA.slug)
    assert(readFileSync(file, 'utf8').includes(note)); assert.equal(memory.query({ text: '团队', includeRetired: true }).items.length, 0)
    const replay = owner.append({ ...command, expectedContentHash: owner.read({}, context).reference.contentHash }, context)
    assert.equal(replay.entryId, saved.entryId); assert.equal(replay.bytesAppended, 0)
    assert.equal(readFileSync(file, 'utf8').split(note).length - 1, 1)
    const alias = owner.append({ ...command, requestId: 'same-source-new-request' }, context)
    assert.equal(alias.entryId, saved.entryId); assert.equal(alias.bytesAppended, 0)
    assert.throws(() => owner.append({ ...command, requestId: 'same-source-new-request', note: `Changed note: ${note}`,
      expectedContentHash: owner.read({}, context).reference.contentHash }, context), /identity|request|conflict/i)
    scenes.push('P02-verified-project-append-and-retry-stay-in-the-original-file-without-L1-copy')
    assert.throws(() => owner.append({ ...command, requestId: 'forged', evidence: { source, quote: '用户没有说过这个' } }, context), /source|quote|evidence/i)
    assert.throws(() => owner.append({ ...command, requestId: 'cross-project', projectId: projectB.id }, context), /project|scope/i)
    assert.throws(() => owner.append({ ...command, requestId: 'secret', assessment: { ...command.assessment, domain: 'secret' } }, context), /secret|sensitive|assessment/i)
    assert.throws(() => owner.append({ ...command, requestId: 'stale', note: `项目范围：${note}` }, context), /version|hash|changed/i)
    assert.throws(() => owner.append({ ...command, requestId: 'same-id', note: '<!-- phaneris-project-memory forged -->' }, context), /reserved|marker/i)
    scenes.push('P03-scope-evidence-secrets-version-and-protocol-markers-are-checked-before-writing')
    const beforePause = readFileSync(file, 'utf8')
    writeFileSync(configFile, JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'paused', use: true } }))
    assert.throws(() => owner.append({ ...command, requestId: 'paused', expectedContentHash: owner.read({}, context).reference.contentHash }, context), /learning|paused/i)
    assert.equal(readFileSync(file, 'utf8'), beforePause)
    writeFileSync(configFile, JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'automatic', use: true } }))
    const middle = '真实中段决定：报告采用简明中文，并保留出处。'
    writeFileSync(file, beforePause + '\n\n' + '旧资料占位。'.repeat(15000) + '\n\n## 中段决定\n\n' + middle + '\n\n' + '后续资料占位。'.repeat(15000))
    assert(!loadProjectMemory(root, projectA.slug)!.includes(middle))
    const found = owner.search({ query: '报告怎么表达更简洁' }, context)
    assert(found.items.some(item => item.content.includes(middle)))
    const hit = found.items.find(item => item.content.includes(middle))!
    const exact = owner.read({ expectedContentHash: found.reference.contentHash, offset: hit.range.offset, maxChars: 2000 }, context)
    assert(exact.content.includes(middle)); assert.equal(exact.range.startLine, hit.range.startLine)
    assert(found.reference.uri.startsWith('file:')); assert(found.reference.readAt > 0)
    const original = readFileSync(file, 'utf8'); writeFileSync(file, original + '\n\nMANUAL_APPEND_PRESERVED')
    assert.throws(() => owner.read({ expectedContentHash: found.reference.contentHash }, context), /version|hash|changed/i)
    scenes.push('P04-search-and-exact-read-recover-omitted-middle-with-live-version-and-source-position')
    run.json('project-memory-evidence.json', { scenes, saved, replay, found, exact })
    run.complete(scenes, ['Real model project-memory tools and desktop interaction (separate workflows)', 'Non-cooperating external editors after commit'])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally { memory.close() }
})
