import { spawn } from 'node:child_process'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = resolvePath(fileURLToPath(import.meta.url), '../../..')
process.chdir(ROOT)

/**
 * Dialog footer spacing verification — real dialogs, real layout, real browser.
 *
 * The cancel/confirm pair in every confirmation dialog is spaced by a single
 * `gap-2` on `<DialogFooter>`. A call-site override such as `sm:gap-0` wins from
 * 40rem up (a `sm:` variant beats a bare `gap-*`, and every desktop window is
 * wider than 40rem), which collapses the row into touching buttons. Nothing but
 * a laid-out browser can see that: the classes typecheck, lint and mount fine.
 *
 * Every runtime assertion below therefore runs against real product components
 * in a real browser, driven through the renderer dev server and the probe in
 * `apps/electron/src/renderer/playground/probes/dialog-footer-probe.tsx`:
 *
 *   1. each dialog's own footer buttons are measured as boxes — the gap between
 *      adjacent buttons must be the designed `gap-2` (half a root em, read from
 *      the page), at desktop and at phone width;
 *   2. the row/column direction of the footer is asserted per width, so spacing
 *      the buttons by breaking the layout is not a pass;
 *   3. the server-requested confirmations (delete-session, logout) are replayed
 *      with the payload the main process relays, and the button that answers
 *      "delete" must still return index 1 to main.
 *
 * A static pass over every `<DialogFooter>` call site in the renderer runs first,
 * so dialogs this probe cannot mount are still covered.
 *
 * Usage (starts its own dev server and browser):
 *   node scripts/verification/dialog-footer-spacing.mjs
 *
 * Reuse a running dev server and/or browser (needed where process spawning or
 * browser IPC is restricted):
 *   node scripts/verification/dialog-footer-spacing.mjs --base http://localhost:5173 --cdp http://127.0.0.1:9222
 *
 * Screenshots and the JSON result are written to docs/verification/results/.
 * Exits 1 when any check fails.
 */

const argv = process.argv.slice(2)
const argValue = (name) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const LABEL = argValue('--label') ?? 'run'
const PORT = argValue('--port') ?? '5173'
// `localhost`, not `127.0.0.1`: Vite binds the name it is given, and on Windows
// that resolves to ::1, where the IPv4 literal is refused.
const BASE = argValue('--base') ?? `http://localhost:${PORT}`
const CDP = argValue('--cdp')
/** Skip the browser pass — the call-site scan alone, for machines without one. */
const STATIC_ONLY = argv.includes('--static-only')

/**
 * The designed distance between the footer buttons: Tailwind `gap-2`, i.e. half
 * a root em. It is deliberately not a pixel constant — this app sets
 * `--font-size-base: 15px`, so the same `gap-2` is 7.5px here and 8px at the
 * browser default. The expected value is therefore read from the page's own root
 * font size, which still collapses to 0 when a `gap-0` override wins.
 */
const EXPECTED_GAP_REM = 0.5
/** Sub-pixel slack for fractional device pixels. */
const GAP_TOLERANCE_PX = 0.5

/** Desktop first (where the reported bug lived), then phone width. */
const VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 800, flexDirection: 'row' },
  { id: 'phone', width: 420, height: 780, flexDirection: 'column-reverse' },
]

/** Server-requested dialogs: the commit button must keep answering index 1. */
const CONFIRM_BRIDGE_SCENARIOS = ['delete-session', 'logout']

const outputDir = join('docs', 'verification', 'results')
const results = {
  date: new Date().toISOString().slice(0, 10),
  label: LABEL,
  base: BASE,
  browser: null,
  expectedGapRem: EXPECTED_GAP_REM,
  checks: [],
  callSites: [],
  measurements: [],
}

await mkdir(outputDir, { recursive: true })

/** Records one check, swallowing its failure into the report. */
async function check(name, observation, run) {
  const record = { name, observation, status: 'pass', detail: null }
  try {
    await run()
  } catch (error) {
    record.status = 'fail'
    record.detail = error instanceof Error ? error.message : String(error)
  }
  results.checks.push(record)
  console.log(
    `${record.status === 'pass' ? 'PASS' : 'FAIL'}  ${name}${record.detail ? ` — ${record.detail}` : ''}`,
  )
  return record.status === 'pass'
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// ---------------------------------------------------------------------------
// Static coverage of every DialogFooter call site
// ---------------------------------------------------------------------------

const SCAN_ROOTS = ['apps/electron/src', 'packages/ui/src']
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'release', 'out', 'build', '.vite'])

/** A `gap-0` / `gap-x-0` / `space-x-0` utility in the footer's own class list. */
const COLLAPSING_UTILITY = /(?:^|\s)(?:[a-z0-9-]+:)?(?:gap(?:-[xy])?|space-[xy])-0(?=\s|$)/

function collectSourceFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      collectSourceFiles(join(dir, entry.name), out)
    } else if (/\.(tsx|jsx)$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
}

function scanFooterCallSites() {
  const files = []
  for (const root of SCAN_ROOTS) {
    try {
      if (statSync(root).isDirectory()) collectSourceFiles(root, files)
    } catch {
      // Scan root is absent in this checkout.
    }
  }

  const callSites = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/<DialogFooter\b[^>]*>/g)) {
      const className = match[0].match(/className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/)
      const value = className ? (className[1] ?? className[2] ?? className[3] ?? '') : ''
      callSites.push({
        file: relative(ROOT, file).split(sep).join('/'),
        line: source.slice(0, match.index).split('\n').length,
        className: value,
        collapsesGap: COLLAPSING_UTILITY.test(value),
      })
    }
  }
  return callSites
}

results.callSites = scanFooterCallSites()
const collapsing = results.callSites.filter((site) => site.collapsesGap)
await check(
  'no DialogFooter call site collapses the footer gap',
  `${results.callSites.length} call site(s) scanned for a gap-0 override: ${
    collapsing.map((site) => `${site.file}:${site.line}`).join(', ') || 'none found'
  }`,
  () => {
    assert(
      collapsing.length === 0,
      `gap-collapsing override at ${collapsing
        .map((site) => `${site.file}:${site.line} (class="${site.className}")`)
        .join('; ')}`,
    )
  },
)

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

let server = null
let serverLog = null
/** Set once the run has asked the server to stop, so its exit is not reported as a crash. */
let stoppingServer = false

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Starts the renderer dev server.
 *
 * Vite runs as a single Node process (not through a package-manager shim) so
 * that the run can kill exactly what it started: an intermediate `bun run` would
 * survive the kill as an orphan holding the port.
 */
async function ensureDevServer() {
  if (await reachable(`${BASE}/playground.html`)) {
    console.log(`reusing dev server at ${BASE}`)
    return
  }

  const logDir = join('.cache', 'verification')
  await mkdir(logDir, { recursive: true })
  const logPath = join(logDir, `dialog-footer-spacing-vite-${LABEL}.log`)
  serverLog = await open(logPath, 'w')

  console.log(`starting renderer dev server on ${BASE} (log: ${logPath})`)
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'dev', '--config', 'apps/electron/vite.config.ts', '--port', PORT, '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', serverLog.fd, serverLog.fd] },
  )
  server.on('error', (error) => console.error(`dev server failed to start: ${error.message}`))
  server.on('exit', (code) => {
    if (!stoppingServer && code !== 0 && code !== null) {
      console.error(`dev server exited early with code ${code}`)
    }
  })

  const deadline = Date.now() + 180_000
  for (;;) {
    if (await reachable(`${BASE}/playground.html`)) {
      console.log('dev server ready')
      return
    }
    if (Date.now() > deadline) {
      const tail = await readFile(logPath, 'utf8').catch(() => '')
      throw new Error(`dev server never served ${BASE}/playground.html; log tail:\n${tail.slice(-2000)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/** Stops the dev server and anything it started underneath it. */
function stopDevServer() {
  stoppingServer = true
  if (server && server.exitCode === null) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      server.kill('SIGTERM')
    }
  }
  serverLog?.close().catch(() => {})
}

// ---------------------------------------------------------------------------
// In-page measurement
// ---------------------------------------------------------------------------

/**
 * Measured inside the page. Adjacent buttons are compared as boxes, not as CSS
 * values: the pair can be laid out left-to-right (`sm:flex-row`) or
 * bottom-to-top (`flex-col-reverse`), so the separation is taken along whichever
 * axis actually separates them. Neither separated nor touching means overlap.
 */
function measureDialogFooter({ contentSelector, footerSelector }) {
  const dialog = document.querySelector(contentSelector)
  if (!dialog) throw new Error('no dialog on screen')
  const footer = dialog.querySelector(footerSelector)
  if (!footer) throw new Error('dialog has no footer')

  const rects = [...footer.querySelectorAll('button')]
    .map((button) => {
      const rect = button.getBoundingClientRect()
      return {
        label: (button.textContent ?? '').trim(),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    })
    .filter((rect) => rect.width > 0 && rect.height > 0)

  const pairs = []
  for (let index = 0; index < rects.length - 1; index += 1) {
    const a = rects[index]
    const b = rects[index + 1]
    const record = { from: a.label, to: b.label, gap: null, orientation: null, overlap: false }
    if (b.left - a.right >= -0.5) {
      record.gap = b.left - a.right
      record.orientation = 'horizontal'
    } else if (b.top - a.bottom >= -0.5) {
      record.gap = b.top - a.bottom
      record.orientation = 'vertical'
    } else if (a.left - b.right >= -0.5) {
      record.gap = a.left - b.right
      record.orientation = 'horizontal'
    } else if (a.top - b.bottom >= -0.5) {
      record.gap = a.top - b.bottom
      record.orientation = 'vertical'
    } else {
      record.overlap = true
    }
    pairs.push(record)
  }

  const style = getComputedStyle(footer)
  return {
    dialogTitle: (dialog.querySelector('[data-slot="dialog-title"]')?.textContent ?? '').trim(),
    buttonLabels: rects.map((rect) => rect.label),
    buttonCount: rects.length,
    flexDirection: style.flexDirection,
    columnGap: Number.parseFloat(style.columnGap) || 0,
    rowGap: Number.parseFloat(style.rowGap) || 0,
    rootFontSizePx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    pairs,
  }
}

/** `A ↔ B 8.00px, B ↔ C 8.00px` — the numbers that decide the check. */
function gapSummary(measurement) {
  return (
    measurement.pairs
      .map((pair) => `${pair.from} ↔ ${pair.to} ${pair.overlap ? 'OVERLAP' : `${pair.gap.toFixed(2)}px`}`)
      .join(', ') || 'no adjacent buttons'
  )
}

/**
 * Waits for the dialog's enter animation to finish before anything is measured.
 * A dialog caught mid-scale reports boxes that are smaller than their final
 * size, which would read as a spacing failure that is not one. The timeout keeps
 * an animation that never finishes (a spinner in the dialog body) from hanging
 * the run.
 */
async function settleDialog(page) {
  await page.evaluate(async () => {
    const dialog = document.querySelector('[data-slot="dialog-content"]')
    const animations = dialog ? dialog.getAnimations({ subtree: true }) : []
    await Promise.race([
      Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (STATIC_ONLY) {
  console.log('--static-only: skipping the mount/measure pass (no browser)')
} else {
  let browser = null
  let context = null

  try {
    await ensureDevServer()

    browser = CDP
      ? await chromium.connectOverCDP(CDP)
      : await chromium.launch({
          headless: true,
          ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
        })
    results.browser = browser.version()

    context = CDP ? browser.contexts()[0] : await browser.newContext()
    const page = await context.newPage()
    page.on('pageerror', (error) => console.error(`[page error] ${error.message}`))

    await page.goto(`${BASE}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    // Nothing in the app imports the probe: the page has to pull it in itself.
    // Vite transforms it (and its bare imports) exactly as it does app modules.
    await page.evaluate(async () => {
      await import('/playground/probes/dialog-footer-probe.tsx')
    })
    await page.waitForFunction(() => Boolean(window.__dialogFooterProbe), null, { timeout: 120_000 })

    const probe = await page.evaluate(() => ({
      scenarios: [...window.__dialogFooterProbe.scenarios],
      buttonCount: { ...window.__dialogFooterProbe.buttonCount },
    }))
    console.log(`probe scenarios: ${probe.scenarios.join(', ')}`)

    for (const scenario of probe.scenarios) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.evaluate(
          async ({ scenario }) => {
            await window.__dialogFooterProbe.unmount()
            await window.__dialogFooterProbe.mount(scenario, { language: 'zh-Hans' })
          },
          { scenario },
        )
        await settleDialog(page)

        const measurement = await page.evaluate(measureDialogFooter, {
          contentSelector: '[data-slot="dialog-content"]',
          footerSelector: '[data-slot="dialog-footer"]',
        })
        measurement.scenario = scenario
        measurement.viewport = viewport.id
        measurement.viewportWidth = viewport.width
        measurement.expectedGapPx = EXPECTED_GAP_REM * measurement.rootFontSizePx
        results.measurements.push(measurement)

        const shotPath = join(outputDir, `dialog-footer-${scenario}-${viewport.id}-${LABEL}.png`)
        await page.locator('[data-slot="dialog-content"]').first().screenshot({ path: shotPath })

        await check(
          `${scenario} @ ${viewport.id}: footer buttons separated by ${EXPECTED_GAP_REM}rem ` +
            `(${measurement.expectedGapPx.toFixed(2)}px at ${measurement.rootFontSizePx}px root)`,
          `"${measurement.dialogTitle}" — buttons "${measurement.buttonLabels.join('" | "')}", ` +
            `flex-direction ${measurement.flexDirection}, gap ${measurement.columnGap}px/${measurement.rowGap}px, ` +
            `${gapSummary(measurement)}, screenshot ${shotPath}`,
          () => {
            assert(
              measurement.buttonCount === probe.buttonCount[scenario],
              `expected ${probe.buttonCount[scenario]} buttons, saw ${measurement.buttonCount}`,
            )
            assert(
              measurement.flexDirection === viewport.flexDirection,
              `expected flex-direction ${viewport.flexDirection}, saw ${measurement.flexDirection}`,
            )
            const expectedOrientation = viewport.flexDirection === 'row' ? 'horizontal' : 'vertical'
            for (const pair of measurement.pairs) {
              assert(!pair.overlap, `"${pair.from}" and "${pair.to}" overlap`)
              assert(
                pair.orientation === expectedOrientation,
                `"${pair.from}" and "${pair.to}" are laid out ${pair.orientation}, expected ${expectedOrientation}`,
              )
              assert(
                pair.gap >= measurement.expectedGapPx - GAP_TOLERANCE_PX,
                `"${pair.from}" and "${pair.to}" are ${pair.gap.toFixed(2)}px apart, ` +
                  `expected ${measurement.expectedGapPx.toFixed(2)}px (${EXPECTED_GAP_REM}rem)`,
              )
            }
          },
        )

        if (CONFIRM_BRIDGE_SCENARIOS.includes(scenario)) {
          const commitLabel = measurement.buttonLabels.at(-1)
          await page
            .locator('[data-slot="dialog-content"] [data-slot="dialog-footer"] button')
            .last()
            .click()
          const answer = await page
            .waitForFunction(
              (id) => window.__dialogFooterProbe.responses.find((entry) => entry.id === id) ?? false,
              `probe-${scenario}`,
              { timeout: 5000 },
            )
            .then((handle) => handle.jsonValue())
            .catch(() => null)
          await check(
            `${scenario} @ ${viewport.id}: "${commitLabel}" answers main with index 1`,
            `clicked the commit button, respondConfirmDialog received ${JSON.stringify(answer)}`,
            () => {
              assert(answer !== null, 'no answer reached the confirm bridge within 5s')
              assert(answer.response === 1, `expected response 1, saw ${JSON.stringify(answer)}`)
            },
          )
        }
      }
    }

    await page.evaluate(() => window.__dialogFooterProbe.unmount())
  } catch (error) {
    // A browser pass that cannot run is a failed check, not a crash: the static
    // scan above still has to reach the report.
    results.browserError = error instanceof Error ? error.message : String(error)
    await check('every dialog mounts and is measured in a browser', 'browser pass did not complete', () => {
      throw error
    })
  } finally {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    stopDevServer()
  }
}

const failed = results.checks.filter((entry) => entry.status === 'fail')
const resultPath = join(outputDir, `dialog-footer-spacing-${LABEL}.json`)
await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`)

console.log('')
console.log(`${results.checks.length - failed.length}/${results.checks.length} checks passed`)
console.log(`result: ${resultPath}`)
if (failed.length) {
  console.error(`dialog footer spacing: ${failed.length} check(s) failed`)
  process.exit(1)
}
