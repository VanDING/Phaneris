/** Full production main/preload/renderer, disposable local session, no provider request. */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-image-sharing-client', async run => {
  const config = join(run.directory, 'profile'), workspace = join(run.directory, 'workspace')
  mkdirSync(config); mkdirSync(workspace)
  process.env.PHANERIS_CONFIG_DIR = config
  const { createSession, loadSession, saveSession } = await import('../../packages/shared/src/sessions/storage')
  const session = await createSession(workspace, { name: 'Native share acceptance', permissionMode: 'ask' })
  await saveSession({ ...loadSession(workspace, session.id)!, messages: [
    ...Array.from({ length: 30 }, (_, index) => ({ id: 'history-' + index, type: index % 2 ? 'assistant' as const : 'user' as const, timestamp: index + 10, content: index === 0 ? 'HISTORY-FIRST' : '历史内容 ' + index })),
    { id: 'q1', type: 'user', timestamp: 100, content: '请整理可分享的内容。' },
    { id: 'a1', type: 'assistant', timestamp: 101, content: '## 原生客户端分享\n\n中文和 English 均保留。\n\n| 项目 | 结果 |\n|---|---|\n| Local export | 完整 |\n\nNATIVE-SHARE-END' },
  ] })
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'share-native', name: 'Share acceptance', defaults: { permissionMode: 'ask' } }))
  writeFileSync(join(config, 'config.json'), JSON.stringify({ setupDeferred: true, workspaces: [
    { id: 'share-native', name: 'Share acceptance', rootPath: workspace, createdAt: 1 },
  ], activeWorkspaceId: 'share-native', activeSessionId: session.id, themeMode: 'light', colorTheme: 'default' }))
  const fixture = join(run.directory, 'client-fixture.json')
  writeFileSync(fixture, JSON.stringify({ root: resolve(import.meta.dir, '../..'), output: run.directory, config, workspace, session: session.id, eligibleCount: 32 }))
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/session-image-sharing-client.cjs'), fixture], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 120_000)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'process.log'), stdout + stderr)
    assert.equal(code, 0, stderr.slice(-3000) + stdout.slice(-1000))
    const report = JSON.parse(readFileSync(join(run.directory, 'client-results.json'), 'utf8')) as { checks: string[] }
    run.complete(report.checks, ['macOS/Linux native execution', 'Signed installer'])
    console.log(JSON.stringify({ output: run.directory, passed: report.checks.length }))
  } finally { clearTimeout(timer) }
})
