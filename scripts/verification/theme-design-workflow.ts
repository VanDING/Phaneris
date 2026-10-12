/** TC12 / TC13: identical real content, explicit candidates; current defaults are 28/840. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { BUILTIN_THEMES } from '../../packages/shared/src/config/theme'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'
import { warmThemePage } from './fixtures/warm-theme-page'
await verificationWorkflow('theme-design', async run => {
  const root = resolve(import.meta.dir, '../..'), fixture = join(root, 'scripts/verification/fixtures/theme-roles.tsx')
  run.json('source-hashes.json', { fixture: createHash('sha256').update(readFileSync(fixture)).digest('hex') })
  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'fixture.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/scripts/verification/fixtures/theme-roles.tsx"></script>')
  writeFileSync(join(run.directory, 'host.css'), `@import "${relative(run.directory, join(root, 'apps/electron/src/renderer/index.css')).replaceAll('\\', '/')}";\n@source "${fixture.replaceAll('\\', '/')}";`)
  const launched = await launchWorkflowBrowser(), server = await createServer({ configFile: join(root, 'apps/electron/vite.config.ts'), root,
    optimizeDeps: { entries: [fixture], include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'], exclude: ['pdfjs-dist/build/pdf.worker.min.mjs?url'] }, server: { host: '127.0.0.1', port: 0, open: false } })
  await server.listen(); const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage()
  const checks: string[] = [], samples: { id: string; file: string; group: string; geometry: unknown }[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); await context.tracing.start({ screenshots: true, snapshots: true })
  const scenes = [{ theme: 'default', mode: 'light' as const }, { theme: 'default', mode: 'dark' as const }, { theme: 'ink', mode: 'light' as const }]
  const open = async (compact = false, collapsed = false) => {
    await page.goto(`${base}${prefix}/fixture.html?css=${encodeURIComponent(`${prefix}/host.css`)}&compact=${compact}&collapsed=${collapsed}`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.locator('[data-roles-ready]').waitFor()
  }
  async function scene(id: string, group: string, theme: string, mode: 'light' | 'dark', row = 28, width = 840, material = 'current', fontSize = '15px') {
    await page.evaluate(({ id, theme, mode, fontSize }) => window.themeRoles.choose(id, mode, { ...theme, fontSize }), { id, theme: BUILTIN_THEMES[theme]!, mode, fontSize })
    await page.waitForFunction(id => document.documentElement.dataset.theme === id && document.documentElement.dataset.themeStatus === 'ready', id)
    await page.evaluate(({ row, width, material }) => {
      document.documentElement.style.setProperty('--sidebar-row-height', `${row}px`); document.documentElement.style.setProperty('--reading-width', `${width}px`)
      let style = document.getElementById('comparison-material') as HTMLStyleElement | null
      if (!style) { style = document.createElement('style'); style.id = 'comparison-material'; document.head.append(style) }
      style.textContent = material === 'strong' ? '.craft-settings-card { box-shadow: var(--shadow-strong); }' : ''
    }, { row, width, material })
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
    await page.evaluate(() => document.querySelector('main')!.scrollTo(0, 0))
    const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: [...document.querySelectorAll('[data-testid="review-sidebar"] button')].map(element => ({ height: element.getBoundingClientRect().height, title: element.getAttribute('title') })),
      column: document.querySelector('[data-testid="transcript-column"]')!.getBoundingClientRect().width,
      ui: getComputedStyle(document.querySelector('[data-testid="ui-text"]')!).fontSize, reading: getComputedStyle(document.querySelector('[data-testid="reading-text"]')!).fontSize }))
    assert(geometry.overflow <= 1); const file = `${id}.png`; await page.screenshot({ path: join(run.directory, file), fullPage: true })
    samples.push({ id, file, group, geometry }); checks.push(id)
  }
  try {
    run.json('preparation.json', await warmThemePage(context, `${base}${prefix}/fixture.html?css=${encodeURIComponent(`${prefix}/host.css`)}`, '[data-roles-ready]'))
    for (const { theme, mode } of scenes) {
      for (const collapsed of [false, true]) { await open(false, collapsed); for (const row of [40, 34, 32, 28]) await scene(`rows-${theme}-${mode}-${row}-${collapsed ? 'collapsed' : 'expanded'}`, '导航密度', theme, mode, row) }
      await open(); for (const width of [840, 768]) await scene(`width-${theme}-${mode}-${width}`, '阅读列', theme, mode, 28, width)
      for (const material of ['current', 'strong']) await scene(`material-${theme}-${mode}-${material}`, '材质与高程', theme, mode, 28, 840, material)
      await page.setViewportSize({ width: 640, height: 1000 }); await scene(`text-200-${theme}-${mode}`, '200% 文字与窄屏', theme, mode, 28, 840, 'current', '30px')
      await page.setViewportSize({ width: 390, height: 1000 }); await open(true); await scene(`compact-${theme}-${mode}`, '紧凑输入', theme, mode)
      await page.setViewportSize({ width: 1280, height: 1000 })
    }
    assert.deepEqual(errors, [])
    run.json('theme-design.json', { checks, samples, errors, browser: launched.browser.version(), decision: 'Default navigation is now 28px and the reading width remains 840px. Default light uses neutral borders and soft elevation; shell-visual verifies the real native shell, while these candidates remain comparison evidence.' })
    const options = samples.map(value => `<option value="${value.file}">${value.group} · ${value.id}</option>`).join('')
    writeFileSync(join(run.directory, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>主题参数对照</title><style>body{font:14px system-ui;margin:24px;color:#20232c;background:#fafafa}select{padding:8px;max-width:100%}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #ddd}@media(max-width:768px){.pair{grid-template-columns:1fr}}</style><h1>主题参数对照</h1><p>真实组件、相同中文内容。当前默认导航 28px、阅读列 840px，浅色边界与高程已微调；其他候选供审阅。200% 文字缩放与 Chromium 浏览器缩放分别验收。</p><div class="pair"><div><select>${options}</select><img alt="左侧对照"></div><div><select>${options}</select><img alt="右侧对照"></div></div><script>document.querySelectorAll('select').forEach((s,i)=>{s.selectedIndex=i?2:0;const update=()=>s.nextElementSibling.src=s.value;s.onchange=update;update()})</script>`)
    run.complete(checks, ['Real browser zoom is asserted by theme-native', 'OS materials and physical touch are separate runs'])
  } finally { await context.tracing.stop({ path: join(run.directory, 'trace.zip') }); await context.close(); await server.close(); await launched.close() }
})
