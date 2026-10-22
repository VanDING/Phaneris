/** Real Electron Workbench motion, with per-frame geometry and screenshots. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('workbench-motion', async run => {
  const root = resolve(import.meta.dir, '../..')
  const config = mkdtempSync(join(tmpdir(), 'phaneris-workbench-motion-'))
  const workspace = join(config, 'workspace')
  mkdirSync(workspace)
  process.env.PHANERIS_CONFIG_DIR = config
  writeFileSync(join(config, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'fixture', name: 'Motion verification', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'fixture', setupDeferred: true, llmConnections: [],
    appearance: { mode: 'light', colorTheme: 'default', font: 'inter' },
  }))
  const { createSession, saveSession } = await import('../../packages/shared/src/sessions/storage')
  const names = ['Workbench motion', 'Second conversation', 'Third conversation']
  for (const name of names) {
    const session = await createSession(workspace, { name, sessionStatus: 'todo' })
    await saveSession({ ...session, messages: [
      { id: 'user', type: 'user', timestamp: 1, content: 'Check the Workbench boundary while opening and closing.' },
      { id: 'assistant', type: 'assistant', timestamp: 2, content: 'The conversation keeps its reading position while Files, Run and Terminal open beside it.' },
    ], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  }
  const fixture = join(run.directory, 'fixture.json')
  writeFileSync(fixture, JSON.stringify({ root, config, output: run.directory, names,
    baseline: process.env.PHANERIS_MOTION_BASELINE === '1' }))
  run.json('build-hashes.json', Object.fromEntries([
    'apps/electron/dist/main.cjs', 'apps/electron/dist/bootstrap-preload.cjs', 'apps/electron/dist/renderer/index.html',
  ].map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')])))
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/workbench-motion.cjs'), fixture],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 180_000)
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'process.log'), out + err)
    assert.equal(code, 0, (out + err).slice(-6000))
    const report = JSON.parse(readFileSync(join(run.directory, 'workbench-motion.json'), 'utf8')) as { checks: string[] }
    run.complete(report.checks, ['Physical touch hardware', 'macOS/Linux native compositor'])
  } finally { clearTimeout(timer) }
})
