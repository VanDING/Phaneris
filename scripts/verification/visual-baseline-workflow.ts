/**
 * W4① — visual regression baselines.
 *
 * Six cells (theme × mode × density) of one stable component page. `--update`
 * writes the committed baselines; the default mode compares against them and
 * reports every cell whose bytes moved.
 *
 * Why byte comparison instead of a pixel-diff truth: a screenshot baseline that
 * silently tolerates "1% difference" hides exactly the regressions this wave
 * cares about (a 0.5px font change, a hue drifting back to a palette colour, an
 * icon stroke moving by 0.15). A byte diff is either identical or it is not, and
 * an intentional change is a one-command re-freeze that shows up in review as a
 * new PNG. The workflow is deliberately *not* wired into `lint`: baselines are
 * platform-dependent (font rasterisation differs by OS), so it runs on a fixed
 * machine and its artifact records which one.
 *
 * Usage:
 *   bun run test:visual-baselines --update     # freeze the baseline (commit the PNGs)
 *   bun run test:visual-baselines              # compare; exits 1 on any drift
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { VerificationRun } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

/** The smallest matrix that still covers colour, weight, shape and type:
 *  the two shipped light palettes, one dark mode, and both densities. */
const CELLS = [
  { id: 'default-light-comfortable', theme: 'default', mode: 'light', density: 'comfortable' },
  { id: 'default-dark-comfortable', theme: 'default', mode: 'dark', density: 'comfortable' },
  { id: 'default-light-compact', theme: 'default', mode: 'light', density: 'compact' },
  { id: 'ink-light-comfortable', theme: 'ink', mode: 'light', density: 'comfortable' },
  { id: 'geek-dark-comfortable', theme: 'geek', mode: 'dark', density: 'comfortable' },
  { id: 'cyberpunk-dark-comfortable', theme: 'cyberpunk-2077', mode: 'dark', density: 'comfortable' },
] as const

const BASELINE_ROOT = 'docs/verification/visual-baselines'

// `--update` is this workflow's own flag, so the run is constructed directly:
// `verificationWorkflow` validates arguments before the body can register any.
const run = new VerificationRun('visual-baselines')
run.checkArguments(['--update'])
let runFailure: unknown
try {
  await execute(run)
} catch (error) {
  runFailure = error
} finally {
  run.finish(runFailure)
}

async function execute(run: VerificationRun) {
  const root = resolve(import.meta.dir, '../..')
  const fixture = join(root, 'scripts/verification/fixtures/visual-baseline.tsx')
  const update = process.argv.includes('--update')
  const baselineDirectory = join(root, BASELINE_ROOT)
  const index = { version: 1, viewport: { width: 900, height: 760 }, cells: {} } as {
    version: 1
    viewport: { width: number; height: number }
    cells: Record<string, { png: string; sha256: string }>
  }
  const checks: { id: string; passed: boolean; error?: string }[] = []
  const samples: unknown[] = []
  const errors: string[] = []
  const sources = [
    'scripts/verification/fixtures/visual-baseline.tsx',
    'scripts/verification/visual-baseline-workflow.ts',
    'packages/ui/src/styles/theme-tokens.css',
    'packages/ui/src/styles/roles.css',
    'packages/ui/src/styles/controls.css',
    'packages/ui/src/styles/theme-adapter.css',
    'apps/electron/src/renderer/components/ui/button.tsx',
    'apps/electron/src/renderer/components/ui/input.tsx',
  ]
  run.json('source-hashes.json', Object.fromEntries(
    sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]),
  ))

  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'index.html'),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Phaneris visual baselines</title><link rel="icon" href="data:,"></head><body><div id="root"></div>'
    + '<script type="module" src="/scripts/verification/fixtures/visual-baseline.tsx"></script></body></html>')
  writeFileSync(join(run.directory, 'host.css'),
    `@import "${relative(run.directory, join(root, 'apps/electron/src/renderer/index.css')).replaceAll('\\', '/')}";\n`
    + `@source "${fixture.replaceAll('\\', '/')}";\n`)

  const launched = await launchWorkflowBrowser()
  const server = await createServer({
    configFile: join(root, 'apps/electron/vite.config.ts'),
    root,
    optimizeDeps: {
      entries: [fixture],
      include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      exclude: ['pdfjs-dist/build/pdf.worker.min.mjs?url'],
    },
    server: {
      host: '127.0.0.1', port: 0, open: false,
      watch: { ignored: ['**/runtimes/**', '**/.cache/**', '**/dist/**', `${run.directory}/**`] },
    },
  })
  await server.listen()
  const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  const url = `${base}${prefix}/index.html?css=${encodeURIComponent(`${prefix}/host.css`)}`

  // Baselines must come from the same platform they are compared on; pinning the
  // device scale factor removes one whole class of accidental drift.
  const context = await launched.browser.newContext({
    viewport: { width: 900, height: 760 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const isDevServerNoise = (text: string) => /Outdated Optimize Dep|optimized dependencies changed/i.test(text)
  page.on('pageerror', error => { if (!isDevServerNoise(error.message)) errors.push(error.message) })
  page.on('console', message => {
    if (message.type() === 'error' && !isDevServerNoise(message.text())) errors.push(message.text())
  })

  const checksList = checks
  async function check(id: string, execute: () => Promise<void>) {
    try { await execute(); checksList.push({ id, passed: true }) } catch (error) { checksList.push({ id, passed: false, error: String(error) }) }
  }
  const settle = () => page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

  try {
    await gotoWithRetry(page, url)
    await page.locator('[data-baseline-page]').waitFor()
    await page.waitForFunction(() => window.visualBaseline?.ready === true)
    await page.evaluate(() => document.fonts.ready)

    for (const cell of CELLS) {
      await page.evaluate(({ theme, mode, density }) => window.visualBaseline.apply(theme, mode, density), cell)
      // Wait for the token itself, not a fixed number of frames. A style swap
      // that lands one frame late screenshots the *previous* cell, which is
      // exactly how a baseline turns flaky from the outside.
      await page.waitForFunction(
        (density) => getComputedStyle(document.documentElement).getPropertyValue('--theme-density').trim() === density,
        cell.density,
      )
      await settle()
      await settle()
      const png = await page.screenshot({ animations: 'disabled' })
      const sha256 = createHash('sha256').update(png).digest('hex')
      const relativePng = `${BASELINE_ROOT}/${cell.id}.png`
      samples.push({ id: cell.id, sha256, bytes: png.byteLength })

      if (update) {
        const target = join(root, relativePng)
        writeFileSync(target, png)
        writeFileSync(join(run.directory, `${cell.id}.png`), png)
        index.cells[cell.id] = { png: relativePng, sha256 }
        checksList.push({ id: `VB-${cell.id}-frozen`, passed: true })
        continue
      }

      await check(`VB-${cell.id}-matches-baseline`, async () => {
        const target = join(root, relativePng)
        assert(existsSync(target), `No baseline at ${relativePng}. Run \`bun run test:visual-baselines --update\`.`)
        const expected = readFileSync(target)
        if (expected.equals(png)) return
        writeFileSync(join(run.directory, `${cell.id}.actual.png`), png)
        writeFileSync(join(run.directory, `${cell.id}.expected.png`), expected)
        const expectedSha = createHash('sha256').update(expected).digest('hex')
        assert.fail(`${cell.id} drifted (${expectedSha.slice(0, 12)} → ${sha256.slice(0, 12)}). `
          + `Compare ${cell.id}.expected.png with ${cell.id}.actual.png; re-freeze with --update if the change is intended.`)
      })
    }

    await check('VB-no-page-errors', async () => assert.deepEqual(errors, []))
  } finally {
    if (update) writeFileSync(join(baselineDirectory, 'index.json'), JSON.stringify(index, null, 2) + '\n')
    run.json('visual-baselines.json', {
      mode: update ? 'update' : 'compare',
      checks: checksList,
      samples,
      errors,
      viewport: index.viewport,
      browser: launched.browser.version(),
      platform: `${process.platform}/${process.arch}`,
      scope: 'Six stable component cells (theme × mode × density) at deviceScaleFactor 1 with reduced motion, '
        + 'animations disabled. Byte comparison, not pixel tolerance.',
    })
    await context.close(); await server.close(); await launched.close()
  }

  run.complete(
    checksList.filter(value => value.passed).map(value => value.id),
    ['Font rasterisation on another OS (baselines are only valid for the platform recorded in the manifest)',
      'The playground app shell with live data', 'Scenic backgrounds and user themes',
      'Motion (the fixture runs with reduced motion and disabled animations)'],
  )
  assert(checksList.every(value => value.passed), JSON.stringify(checksList.filter(value => !value.passed), null, 2))
}
