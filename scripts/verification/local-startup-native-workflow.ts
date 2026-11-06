/** LS12/LS22/LS24: actual built main, preload, renderer and cold history. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('local-startup-native', async run => {
  const root = resolve(import.meta.dir, '../..'), config = join(run.directory, 'config'), workspace = join(run.directory, 'workspace')
  process.env.PHANERIS_CONFIG_DIR = config
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { writeSessionJsonl } = await import('../../packages/shared/src/sessions/jsonl')
  const { ensureDefaultIconFiles } = await import('../../packages/shared/src/statuses/storage')
  createWorkspaceAtPath(workspace, 'Startup acceptance'); ensureDefaultIconFiles(workspace)
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'fixture', slug: 'fixture', name: 'Startup acceptance', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'fixture', activeSessionId: null, setupDeferred: true, llmConnections: [],
  }))
  const histories = Array.from({ length: 640 }, (_, index) => `cold-history-${index}`)
  for (const [index, id] of histories.entries()) {
    const directory = join(workspace, 'sessions', id); mkdirSync(directory, { recursive: true })
    writeSessionJsonl(join(directory, 'session.jsonl'), { id, workspaceRootPath: workspace, name: `Completed history ${index}`,
      createdAt: 1, lastUsedAt: index + 1, sessionStatus: 'done', permissionMode: 'ask', messages: [],
      tokenUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, contextTokens: 100, costUsd: 0.01 } })
  }
  const executablePath = process.env.PHANERIS_VERIFY_ELECTRON_EXECUTABLE
  const appRoot = executablePath ? join(dirname(executablePath), 'resources/app') : join(root, 'apps/electron')
  const files = ['dist/main.cjs', 'dist/bootstrap-preload.cjs', 'dist/renderer/index.html',
    ...readdirSync(join(appRoot, 'dist/renderer/assets')).filter(file => /\.(js|css)$/.test(file)).map(file => `dist/renderer/assets/${file}`)]
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const builds = Object.fromEntries(files.map(file => [file, hash(join(appRoot, file))]))
  if (executablePath) for (const file of files) assert.equal(builds[file], hash(join(root, 'apps/electron', file)), `packaged ${file} is current`)
  run.json('build-hashes.json', { executablePath, appRoot, builds })
  const fixture = join(run.directory, 'fixture.json')
  writeFileSync(fixture, JSON.stringify({ root, output: run.directory, config, workspace, histories, executablePath }))
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/local-startup-native.cjs'), fixture], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 120_000)
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'native-process.log'), out + err)
    assert.equal(code, 0, (out + err).slice(-4000))
    const result = JSON.parse(readFileSync(join(run.directory, 'local-startup-native.json'), 'utf8')) as { checks: string[] }
    run.complete(result.checks, ['Signed installer installation', 'Original personal profile', 'Other operating systems'])
    console.log(JSON.stringify({ passed: result.checks.length, output: run.directory }))
  } finally { clearTimeout(timer) }
})
