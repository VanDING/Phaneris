/** Native main/preload/standalone views, in an isolated configuration root. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
await verificationWorkflow('theme-native', async run => {
  const root = resolve(import.meta.dir, '../..'), config = join(run.directory, 'config'), workspace = join(run.directory, 'workspace')
  mkdirSync(config); mkdirSync(workspace)
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'fixture', name: 'Theme workspace', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'fixture', activeSessionId: null, setupDeferred: true, llmConnections: [],
    themeMode: 'light', colorTheme: 'default', themeFont: 'inter' }))
  const input = join(run.directory, 'native-fixture.json'); writeFileSync(input, JSON.stringify({ root, config, output: run.directory }))
  const hashes: Record<string, string> = {}
  for (const file of ['apps/electron/dist/main.cjs', 'apps/electron/dist/browser-toolbar-preload.cjs']) hashes[file] = createHash('sha256').update(readFileSync(join(root, file))).digest('hex')
  run.json('build-hashes.json', hashes)
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/theme-native.cjs'), input], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 300_000)
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'native-process.log'), out + err); assert.equal(code, 0, (out + err).slice(-5000))
    const report = JSON.parse(readFileSync(join(run.directory, 'theme-native.json'), 'utf8')) as { checks: string[] }
    assert(report.checks.length >= 12); run.complete(report.checks, ['Signed installer/release', 'Other OS runs are separate artifacts', 'Physical mobile keyboard'])
  } finally { clearTimeout(timer) }
})
