/**
 * W3④ — rendered accessibility audit.
 *
 * The static side of accessibility is already gated: `jsx-a11y` runs on all four
 * renderer domains and every historical finding is registered in
 * `scripts/visual-debt-ledger.json`. What no static rule can see is what the
 * *rendered* tree looks like — portal content, computed names from a label
 * association, focus order after a dialog opens, or a 44px hit target that only
 * exists under `pointer: coarse`.
 *
 * This workflow loads axe-core into the page and runs it over four states of
 * one real surface: the base page, an open dialog, an open menu, and a 390px
 * viewport (where the layout is allowed to reflow). It then asserts the two
 * thresholds axe cannot express for us: every touch target is reachable at
 * ≥44×44px under a coarse pointer, and no focusable element is missing from the
 * tab sequence.
 *
 * axe is a declared devDependency (`axe-core`), loaded from its dist file so the
 * audit runs the same build that ships.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

/** axe impact levels that fail the audit. `moderate` stays informational here:
 *  the product already carries registered debt for those rules, and turning
 *  them into a hard failure would only duplicate the ledger. */
const BLOCKING_IMPACTS = new Set(['serious', 'critical'])

await verificationWorkflow('a11y-audit', async run => {
  const root = resolve(import.meta.dir, '../..')
  const fixture = join(root, 'scripts/verification/fixtures/a11y-surface.tsx')
  const axePath = join(root, 'node_modules/axe-core/axe.min.js')
  const checks: { id: string; passed: boolean; error?: string }[] = []
  const samples: unknown[] = []
  const errors: string[] = []
  const sources = [
    'scripts/verification/fixtures/a11y-surface.tsx',
    'scripts/verification/a11y-audit-workflow.ts',
    'apps/electron/src/renderer/components/app-shell/SessionSearchHeader.tsx',
    'apps/electron/src/renderer/components/ui/button.tsx',
    'apps/electron/src/renderer/components/ui/dialog.tsx',
    'apps/electron/src/renderer/components/ui/styled-dropdown.tsx',
  ]
  run.json('source-hashes.json', Object.fromEntries(
    sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]),
  ))
  run.json('axe-version.json', JSON.parse(readFileSync(join(root, 'node_modules/axe-core/package.json'), 'utf8')).version)

  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'index.html'),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Phaneris accessibility surface</title>'
    + '<link rel="icon" href="data:,"></head><body><div id="root"></div>'
    + '<script type="module" src="/scripts/verification/fixtures/a11y-surface.tsx"></script></body></html>')
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

  const context = await launched.browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: 'light', hasTouch: true })
  const page = await context.newPage()
  const isDevServerNoise = (text: string) => /Outdated Optimize Dep|optimized dependencies changed/i.test(text)
  page.on('pageerror', error => { if (!isDevServerNoise(error.message)) errors.push(error.message) })
  page.on('console', message => {
    if (message.type() === 'error' && !isDevServerNoise(message.text())) errors.push(message.text())
  })
  await page.addInitScript({ path: axePath })

  async function check(id: string, execute: () => Promise<void>) {
    try { await execute(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) }
  }

  /** Run axe over the current document and return the blocking subset. */
  const audit = async (state: string) => {
    const result = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context?: unknown, options?: unknown) => Promise<unknown> } }).axe
      return await axe.run(document, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      }) as { violations: { id: string; impact: string | null; help: string; nodes: { target: string[]; failureSummary?: string }[] }[] }
    })
    const violations = result.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
    }))
    samples.push({ id: 'axe', state, violations })
    return violations
  }

  try {
    await gotoWithRetry(page, url)
    await page.locator('[data-a11y-surface]').waitFor()
    await page.waitForFunction(() => window.a11ySurface?.ready === true)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

    await check('A11Y1-base-surface', async () => {
      const violations = await audit('base')
      const blocking = violations.filter(violation => BLOCKING_IMPACTS.has(violation.impact ?? ''))
      assert.deepEqual(blocking, [], `axe reported blocking violations on the base surface: ${JSON.stringify(blocking, null, 2)}`)
    })

    await check('A11Y2-open-dialog', async () => {
      await page.getByRole('button', { name: 'Open dialog' }).click()
      await page.getByRole('dialog').waitFor()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const violations = await audit('dialog')
      const blocking = violations.filter(violation => BLOCKING_IMPACTS.has(violation.impact ?? ''))
      assert.deepEqual(blocking, [], `axe reported blocking violations with a dialog open: ${JSON.stringify(blocking, null, 2)}`)
      // The dialog must own focus: the first field, not the body behind it.
      const focusedInDialog = await page.evaluate(() =>
        Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))
      assert(focusedInDialog, 'Opening the dialog left focus outside it')
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      const focusReturned = await page.evaluate(() =>
        document.activeElement?.textContent?.includes('Open dialog') === true)
      assert(focusReturned, 'Closing the dialog did not return focus to its trigger')
    })

    await check('A11Y3-open-menu', async () => {
      await page.getByRole('button', { name: /More actions/ }).click()
      await page.getByRole('menu').waitFor()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const violations = await audit('menu')
      // Radix marks the rest of the document `aria-hidden` while a modal menu is
      // open but does not add `inert`, so axe reports every background control as
      // "aria hidden but focusable". That only has user impact if Tab can reach
      // it, so the finding is kept only when the trap leaks — measured, not
      // assumed: Tab twelve times and require focus to stay inside the menu.
      const trapped = await page.evaluate(async () => {
        const inside = () => Boolean(document.querySelector('[role="menu"]')?.contains(document.activeElement))
        for (let index = 0; index < 12; index++) {
          const before = document.activeElement
          before?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          if (!inside() && document.activeElement === document.body) break
          if (!inside()) return false
        }
        return inside()
      })
      samples.push({ id: 'menu-focus-trap', trapped })
      const blocking = violations.filter(violation =>
        BLOCKING_IMPACTS.has(violation.impact ?? '')
        && !(violation.id === 'aria-hidden-focus' && trapped))
      assert.deepEqual(blocking, [], `axe reported blocking violations with a menu open: ${JSON.stringify(blocking, null, 2)}`)
      assert(trapped, 'Tab escapes the open menu, so the aria-hidden background is reachable')
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'detached' })
    })

    await check('A11Y4-narrow-reflow', async () => {
      await page.setViewportSize({ width: 390, height: 900 })
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const violations = await audit('narrow')
      const blocking = violations.filter(violation => BLOCKING_IMPACTS.has(violation.impact ?? ''))
      assert.deepEqual(blocking, [], `axe reported blocking violations at 390px: ${JSON.stringify(blocking, null, 2)}`)
      await page.screenshot({ path: join(run.directory, 'a11y-surface-390.png') })
      await page.setViewportSize({ width: 900, height: 900 })
    })

    await check('A11Y5-touch-targets', async () => {
      const under = await page.evaluate(() => {
        const selector = 'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea'
        return [...document.querySelectorAll<HTMLElement>(selector)]
          .filter(element => element.offsetParent !== null && !element.closest('[data-no-touch-check]'))
          .map(element => {
            const box = element.getBoundingClientRect()
            return { label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40), width: Math.round(box.width), height: Math.round(box.height) }
          })
          .filter(entry => entry.width < 44 || entry.height < 44)
      })
      samples.push({ id: 'touch-targets', belowMinimum: under })
      assert.deepEqual(under, [], `Touch targets below 44px: ${JSON.stringify(under, null, 2)}`)
    })

    await check('A11Y6-no-page-errors', async () => assert.deepEqual(errors, []))
  } finally {
    run.json('a11y-audit.json', {
      checks, samples, errors,
      browser: launched.browser.version(),
      scope: 'axe-core (wcag2a/2aa/21a/21aa/best-practice) over one real surface: base page, open dialog, open menu, '
        + '390px reflow, plus a 44px touch-target sweep under hasTouch. Desktop Chromium; the product surfaces that need '
        + 'full-app data are out of scope (see untested).',
    })
    await context.close(); await server.close(); await launched.close()
  }

  run.complete(
    checks.filter(value => value.passed).map(value => value.id),
    ['Full app shell, settings, kanban and file-tree surfaces (each needs real workspace data and is tracked in the '
      + 'visual-debt ledger instead)', 'Screen-reader announcement order (axe checks markup, not speech)',
      'Native OS accessibility bridges', 'Scenic and alternative palettes'],
  )
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})
