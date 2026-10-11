#!/usr/bin/env bun
/** U01-U03: actual local native Electron, with the same domain fixture as the browser workflow. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { seedConversationFixture, verifyConversationDurability } from './fixtures/conversation-model'

await verificationWorkflow('native-client', async run => {
  const config = mkdtempSync(join(tmpdir(), 'phaneris-native-profile-')), workspace = join(run.directory, 'workspace'), secondWorkspace = join(run.directory, 'second-workspace')
  for (const dir of [config, workspace, secondWorkspace]) mkdirSync(dir, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  const conversation = await seedConversationFixture(config, workspace)
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [
    { id: 'fixture', name: 'Governance workspace', rootPath: workspace, createdAt: 1 },
    { id: 'second', name: 'Second workspace', rootPath: secondWorkspace, createdAt: 2 },
  ], activeWorkspaceId: 'fixture', setupDeferred: true, llmConnections: [conversation.connection], defaultLlmConnection: 'fixture' }))
  const { createSession } = await import('../../packages/shared/src/sessions/storage')
  const session = await createSession(workspace, { name: 'Governance session' })
  const other = await createSession(workspace, { name: 'Other governance session' })
  await createSession(secondWorkspace, { name: 'Second workspace session' })
  const fixture = join(run.directory, 'native-fixture.json')
  writeFileSync(fixture, JSON.stringify({ root: resolve(import.meta.dir, '../..'), output: run.directory, config, session: session.id, other: other.id,
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
    run.complete(report.checks, ['signed installers and native Windows/Linux', 'live external provider/OAuth'])
  } finally { clearTimeout(timer); conversation.stop(); rmSync(config, { recursive: true, force: true }) }
})
