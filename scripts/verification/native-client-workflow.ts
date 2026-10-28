#!/usr/bin/env bun
/** U01-U03: actual local native Electron, with the same domain fixture as the browser workflow. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { verificationWorkflow } from './verification-artifacts'
import { seedConversationFixture, verifyConversationDurability } from './fixtures/conversation-model'

await verificationWorkflow('native-client', async run => {
  const config = mkdtempSync(join(tmpdir(), 'phaneris-native-profile-')), original = join(run.directory, 'workspace'), secondWorkspace = join(run.directory, 'second-workspace')
  let workspace = original
  for (const dir of [config, workspace, secondWorkspace]) mkdirSync(dir, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  const conversation = await seedConversationFixture(config, workspace)
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [
    { id: 'fixture', name: 'Governance workspace', rootPath: workspace, createdAt: 1 },
    { id: 'second', name: 'Second workspace', rootPath: secondWorkspace, createdAt: 2 },
  ], activeWorkspaceId: 'fixture', setupDeferred: true, llmConnections: [conversation.connection], defaultLlmConnection: 'fixture' }))
  const { createSession, loadSession, saveSession } = await import('../../packages/shared/src/sessions/storage')
  const session = await createSession(workspace, { name: 'Governance session' })
  const other = await createSession(workspace, { name: 'Other governance session' })
  await createSession(secondWorkspace, { name: 'Second workspace session' })
  const longSession = loadSession(workspace, session.id)!
  longSession.messages = Array.from({ length: 160 }, (_, index) => ({ id: `history-${index}`, type: index % 2 ? 'assistant' as const : 'user' as const, timestamp: index + 1, content: `Synthetic retained conversation ${index}. Reviewable long-session material.` }))
  await saveSession(longSession)
  const packageRoot = join(run.directory, 'incoming', 'native-readiness')
  mkdirSync(join(packageRoot, 'skills', 'native-guide'), { recursive: true })
  const { PLUGIN_MANIFEST_SCHEMA, analyzePluginInstall, installPlugin } = await import('../../packages/shared/src/plugins')
  writeFileSync(join(packageRoot, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'native-readiness', description: 'Native readiness acceptance fixture' }))
  writeFileSync(join(packageRoot, 'skills', 'native-guide', 'SKILL.md'), '---\nname: native-guide\ndescription: Materialized guide fixture\n---\nNative guide body\n')
  writeFileSync(join(packageRoot, 'mcp.json'), JSON.stringify({ mcpServers: { 'native-command': { type: 'stdio', command: './bin/fixture-server' }, 'native-remote': { type: 'streamable-http', url: 'https://example.invalid/mcp' } } }))
  installPlugin(workspace, analyzePluginInstall(workspace, packageRoot))
  const { createArtifactDraft } = await import('../../packages/shared/src/artifacts')
  const artifact = createArtifactDraft({ workspaceId: 'fixture', workspaceRootPath: workspace, contentRootPath: workspace }, { sessionId: session.id, sourcePath: 'restored-report.txt', kind: 'text', initialText: 'Restored draft checkout' })
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const runtime = createDurableRuntime()
  runtime.commands.acceptRun({ workspaceRootPath: workspace, sessionId: session.id, operationId: 'native-recovery-run', turnId: 'recovery', userMessageId: 'recovery', userMessage: 'Synthetic unknown effect' })
  const unknown = await runtime.effects.prepareTool(workspace, { sessionId: session.id, runOperationId: 'native-recovery-run', providerToolCallId: 'unknown', toolName: 'Write', args: { path: 'must-not-replay.txt' } })
  await runtime.close()
  const { createWorkspaceBackup, verifyWorkspaceBackup, restoreWorkspaceBackup } = await import('../../packages/server-core/src/services/workspace-backup')
  const backup = join(run.directory, 'backup'), restored = join(run.directory, 'restored')
  const manifest = createWorkspaceBackup(original, backup); assert(verifyWorkspaceBackup(backup).ok)
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const originalHashes = Object.fromEntries(manifest.files.map(file => [file.path, hash(join(original, file.path))]))
  restoreWorkspaceBackup(backup, restored); workspace = restored; conversation.relocate(restored)
  const storedConfig = JSON.parse(readFileSync(join(config, 'config.json'), 'utf8')); storedConfig.workspaces[0].rootPath = restored; writeFileSync(join(config, 'config.json'), JSON.stringify(storedConfig))
  run.json('recovery-before-start.json', { manifest, originalHashes, artifactId: artifact.artifact.id, toolOperationId: unknown.operationId })
  const executablePath = process.env.PHANERIS_VERIFY_ELECTRON_EXECUTABLE
  const appRoot = executablePath ? join(dirname(executablePath), 'resources/app') : resolve('apps/electron')
  const resources = executablePath ? join(dirname(executablePath), 'resources') : resolve('apps/electron/resources')
  const renderer = join(appRoot, 'dist/renderer')
  const builds = [join(appRoot, 'dist/main.cjs'), join(appRoot, 'dist/bootstrap-preload.cjs'), join(appRoot, 'dist/interceptor.cjs'),
    join(resources, 'pi-agent-server/index.js'), join(resources, 'pi-agent-server/bundle.js'), `${renderer}/index.html`,
    ...readdirSync(resolve(renderer), { recursive: true, encoding: 'utf8' }).map(file => file.toString()).filter(file => /\.(?:js|css|wasm)$/.test(file)).map(file => `${renderer}/${file.replaceAll('\\', '/')}`)]
  run.json('build-hashes.json', Object.fromEntries(builds.map(file => [file, hash(resolve(file))])))
  const fixture = join(run.directory, 'native-fixture.json')
  writeFileSync(fixture, JSON.stringify({ root: resolve(import.meta.dir, '../..'), output: run.directory, config, session: session.id, other: other.id,
    executablePath, connectionProbe: { provider: conversation.connection.providerType, apiKey: 'governance-fixture-only-api-key',
      baseUrl: conversation.connection.baseUrl, model: conversation.connection.defaultModel, customEndpoint: conversation.connection.customEndpoint }, recovery: { workspace, artifactId: artifact.artifact.id, toolOperationId: unknown.operationId },
    conversation: { name: conversation.name, session: conversation.session, filePath: conversation.filePath, planPath: conversation.planPath } }))
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/native-client.cjs'), fixture], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 300_000)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'native-process.log'), stdout + stderr)
    assert.equal(exitCode, 0, stderr.slice(-4000))
    const report = JSON.parse(readFileSync(join(run.directory, 'native-client.json'), 'utf8')) as { checks: string[] }
    assert(report.checks.length >= 20, 'Native acceptance must execute every required scene')
    await verifyConversationDurability(workspace, conversation.session, run.directory, 'electron')
    const provider = conversation.report()
    assert.equal(provider.requests.filter(request => request.mode === 'permission' && !request.toolResult).length, 1)
    assert.equal(provider.requests.filter(request => request.mode === 'plan' && !request.toolResult).length, 1)
    assert.equal(provider.requests.filter(request => request.mode === 'cancel').length, 1)
    run.json('conversation-provider.json', provider)
    for (const file of manifest.files) assert.equal(hash(join(original, file.path)), originalHashes[file.path], `Original workspace changed: ${file.path}`)
    run.complete([...report.checks, 'original-workspace-remains-unchanged-after-native-recovery'], ['signed installers and other operating systems', 'live external provider/OAuth', 'physical mobile touch'])
  } finally { clearTimeout(timer); conversation.stop(); rmSync(config, { recursive: true, force: true }) }
})
