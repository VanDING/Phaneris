/** Real Electron shell, disposable profile, repeatable visual evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { DEFAULT_THEME_FILE } from '../../packages/shared/src/config/theme'

await verificationWorkflow('shell-visual', async run => {
  const root = resolve(import.meta.dir, '../..')
  const config = mkdtempSync(join(tmpdir(), 'phaneris-shell-visual-'))
  const workspace = join(config, 'workspace')
  mkdirSync(workspace)
  mkdirSync(join(config, 'themes'))
  writeFileSync(join(config, 'themes', 'startup-small.json'), JSON.stringify({ ...DEFAULT_THEME_FILE, name: 'Startup compact', fontSize: '13px' }))
  process.env.PHANERIS_CONFIG_DIR = config
  writeFileSync(join(config, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'fixture', name: 'UI 审阅', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'fixture', setupDeferred: true, llmConnections: [],
    appearance: { mode: 'light', colorTheme: 'default', font: 'inter' },
  }))
  const { createSession, saveSession } = await import('../../packages/shared/src/sessions/storage')
  const session = await createSession(workspace, { name: '主题与前端视觉审阅', sessionStatus: 'todo' })
  await saveSession({ ...session, messages: [
    { id: 'visual-user', type: 'user', timestamp: 1, content: '请检查侧栏、面板边界和内容对齐。' },
    { id: 'visual-assistant', type: 'assistant', timestamp: 2,
      content: '界面调整保留主题语义和中文阅读尺度。\n\n| 检查项 | 目标 |\n| --- | --- |\n| 顶部对齐 | 三列共用首行 |\n| 导航密度 | 更紧凑的行与图标栏 |\n| 面板边界 | 中性细边与轻阴影 |\n| 平台圆角 | macOS 与 Windows 分别适配 |\n\n侧栏折叠后，头像和设置仍可操作。' },
  ], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  await createSession(workspace, { name: '长中文标题：跨平台圆角与主题材质验证', sessionStatus: 'needs-review' })
  const input = join(run.directory, 'fixture.json')
  writeFileSync(input, JSON.stringify({ root, config, output: run.directory, name: session.name, baseline: process.env.PHANERIS_VISUAL_BASELINE === '1' }))
  const hashes: Record<string, string> = {}
  for (const file of ['apps/electron/dist/main.cjs', 'apps/electron/dist/bootstrap-preload.cjs', 'apps/electron/dist/renderer/index.html'])
    hashes[file] = createHash('sha256').update(readFileSync(join(root, file))).digest('hex')
  run.json('build-hashes.json', hashes)
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/shell-visual.cjs'), input], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 300_000)
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'process.log'), out + err)
    assert.equal(code, 0, (out + err).slice(-6000))
    const report = JSON.parse(readFileSync(join(run.directory, 'shell-visual.json'), 'utf8')) as { checks: string[]; baseline: boolean }
    run.complete(report.checks, [
      ...(report.baseline ? ['Baseline records observations; proposed targets are not accepted'] : []),
      'Windows native compositor: platform policy simulated in the macOS renderer',
      'Signed installer, native Linux, physical touch hardware',
    ])
  } finally { clearTimeout(timer); rmSync(config, { recursive: true, force: true }) }
})
