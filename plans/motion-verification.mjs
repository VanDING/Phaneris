/**
 * Motion implementation verification — real components in a real browser.
 *
 * Every assertion below runs production code from the repository (shared UI
 * primitives, the real Playground entry, the real app entry HTML). Nothing here
 * asserts source text: each check observes DOM state, computed style or scroll
 * position over time.
 *
 * Usage (start the renderer dev server first):
 *   cd apps/electron && bun run dev
 *   node plans/motion-verification.mjs http://127.0.0.1:5173
 *
 * Uses the installed Edge through Playwright (no browser download) and isolated
 * storage. Results are written to plans/motion-verification-results.json.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:5173'
const outputDir = 'plans'
const results = {
  date: new Date().toISOString().slice(0, 10),
  base,
  browser: null,
  checks: [],
}

await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
})
results.browser = browser.version()

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
  console.log(`${record.status === 'pass' ? 'PASS' : 'FAIL'}  ${name}${record.detail ? ` — ${record.detail}` : ''}`)
}

/** Waits for the requested number of animation frames inside the page. */
const frames = (page, count) =>
  page.evaluate((total) => new Promise((resolve) => {
    let seen = 0
    const tick = () => {
      seen += 1
      if (seen >= total) resolve(null)
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), count)

/** Samples a value once per animation frame. */
const sample = (page, read, count) =>
  page.evaluate(async ({ source, total }) => {
    // The reader is a real function again inside the page; calling it here would
    // return a single value instead of a per-frame series.
    // eslint-disable-next-line no-new-func
    const read = new Function(`return (${source})`)()
    const values = []
    for (let index = 0; index < total; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      values.push(read())
    }
    return values
  }, { source: read.toString(), total: count })

/** Clicks through the DOM, bypassing pointer hit-testing against playground chrome. */
const clickInPage = (page, selector, { label } = {}) =>
  page.evaluate(({ selector, label }) => {
    const candidates = [...document.querySelectorAll(selector)]
    const target = label ? candidates.find((node) => node.textContent?.trim() === label) : candidates[0]
    if (!target) throw new Error(`clickInPage: no match for ${selector}${label ? ` / ${label}` : ''}`)
    target.click()
    return true
  }, { selector, label })

const openPlayground = async (page, componentId, { reducedMotion = 'no-preference' } = {}) => {
  await page.emulateMedia({ reducedMotion })
  await page.addInitScript((id) => {
    localStorage.setItem('playground-selected-component', id)
    localStorage.setItem('playground-preview-size', JSON.stringify({ width: 1100, height: 1400 }))
    localStorage.setItem('playground-variants-sidebar-open', 'true')
    localStorage.setItem('playground-motion-preference', 'system')
    // Pinned so selectors in this file do not depend on the host's locale.
    localStorage.setItem('i18nextLng', 'en')
  }, componentId)
}

try {
  // ---------------------------------------------------------------- loader ---
  // The pre-React loader renders before any bundle, so its reduced-motion
  // handling has to live in the entry HTML itself.
  for (const [label, path, reducedMotion, expectedName] of [
    ['electron', '/index.html', 'reduce', 'none'],
    ['webui', null, 'reduce', 'none'],
    ['electron (no preference)', '/index.html', 'no-preference', '_spin'],
  ]) {
    if (!path) continue
    await check(`boot loader honours reduced motion — ${label}`, `animation-name=${expectedName}`, async () => {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
      try {
        await page.emulateMedia({ reducedMotion })
        // Keep the loader on screen: block the module graph the app would load.
        await page.route('**/*.tsx', (route) => route.abort())
        await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await frames(page, 4)
        const observed = await page.evaluate(() => {
          const svg = document.querySelector('#_loader svg')
          const loader = document.querySelector('#_loader')
          if (!svg || !loader) return null
          const svgStyle = getComputedStyle(svg)
          const loaderStyle = getComputedStyle(loader)
          return {
            animationName: svgStyle.animationName,
            iterationCount: svgStyle.animationIterationCount,
            loaderAnimationName: loaderStyle.animationName,
            opacity: Number(loaderStyle.opacity),
          }
        })
        assert(observed, 'loader markup missing')
        assert.equal(observed.animationName, expectedName, `spinner animation-name was ${observed.animationName}`)
        if (expectedName === 'none') {
          assert.equal(observed.iterationCount, '1', 'reduced loader must not repeat')
          assert.equal(observed.loaderAnimationName, 'none', 'reduced loader must not fade in')
          // Without the fade there is nothing to wait for: the mark is visible
          // from the first painted frame.
          assert(observed.opacity > 0.99, `loader must be visible, opacity=${observed.opacity}`)
        } else {
          assert.equal(observed.iterationCount, 'infinite', 'default loader keeps spinning')
          assert.equal(observed.loaderAnimationName, '_fade', 'default loader still fades in')
        }
      } finally {
        await page.close()
      }
    })
  }

  // -------------------------------------------------- motion primitives -----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    try {
      await openPlayground(page, 'motion-primitives')
      await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByTestId('motion-primitives').waitFor({ timeout: 120_000 })

      // The forced switch must reach CSS as well as the Motion tree.
      await check('playground reduce switch reaches CSS and Motion', 'html[data-reduce-motion] + 1ms transitions', async () => {
        const toggle = page.getByRole('radio', { name: 'Reduced' })
        await toggle.click()
        await frames(page, 2)
        const observed = await page.evaluate(() => {
          const attribute = document.documentElement.getAttribute('data-reduce-motion')
          const probe = document.querySelector('.motion-interactive') ?? document.querySelector('.motion-content')
          const duration = probe ? getComputedStyle(probe).transitionDuration : null
          const mediaReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          return { attribute, duration, mediaReduce }
        })
        assert.equal(observed.attribute, 'true', 'html attribute not set')
        assert.equal(observed.mediaReduce, false, 'OS preference should be unset in this run')
        assert.equal(observed.duration, '0.001s', `CSS transition duration was ${observed.duration}`)
        await page.getByRole('radio', { name: 'Normal' }).click()
        await frames(page, 2)
      })

      // Inline expand: animated in both directions, inert while closing.
      await check('inline expand animates height and isolates the closing layer', 'intermediate heights + inert on exit', async () => {
        const trigger = page.getByTestId('motion-inline-expand').getByRole('button', { name: 'Collapse' })
        await trigger.click()
        const heights = await sample(page, () => {
          const layer = document.querySelector('[data-testid="motion-inline-expand"] ul')?.parentElement
          const wrapper = layer?.parentElement
          return wrapper ? Math.round(wrapper.getBoundingClientRect().height) : -1
        }, 24)
        const distinct = [...new Set(heights.filter((value) => value >= 0))]
        assert(distinct.length >= 2, `expected animated intermediate heights, saw ${distinct.join(',')}`)
        // Closing: the layer leaves the interaction tree before it finishes moving.
        const duringExit = await page.evaluate(async () => {
          const scope = document.querySelector('[data-testid="motion-inline-expand"]')
          const byLabel = (label) => [...scope.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === label)
          const settle = () => new Promise((resolve) => setTimeout(resolve, 400))
          // The previous samples left the box closed, so open it first and then
          // inspect the frame the collapse starts on.
          if (byLabel('Expand')) {
            byLabel('Expand').click()
            await settle()
          }
          byLabel('Collapse').click()
          await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
          const layer = scope.querySelector('ul')?.parentElement
          return layer ? { inert: layer.hasAttribute('inert'), hidden: layer.getAttribute('aria-hidden') } : null
        })
        assert(duringExit, 'expand layer not found')
        assert.equal(duringExit.inert, true, 'closing layer must be inert')
        assert.equal(duringExit.hidden, 'true', 'closing layer must be aria-hidden')
        await frames(page, 40)
      })

      // Rapid reversal: the burst must settle in a single, consistent state.
      await check('inline expand survives a rapid reversal burst', 'one layer, consistent end state', async () => {
        await page.getByTestId('motion-inline-expand-burst').click()
        await frames(page, 80)
        const settled = await page.evaluate(() => {
          const layers = document.querySelectorAll('[data-testid="motion-inline-expand"] ul')
          return {
            count: layers.length,
            inert: [...layers].filter((layer) => layer.parentElement?.hasAttribute('inert')).length,
          }
        })
        assert(settled.count <= 1, `orphan expand layers left behind: ${settled.count}`)
        if (settled.count === 1) assert.equal(settled.inert, 0, 'settled layer must be interactive')
      })

      // Same-level swap: new content is in the slot immediately.
      await check('same-level swap shows the new state without waiting for the old', '<50ms to visible new content', async () => {
        const observed = await page.evaluate(async () => {
          const scope = document.querySelector('[data-testid="motion-content-swap"]')
          const forward = [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Forward')
          if (!forward) throw new Error('Forward button missing')

          const started = performance.now()
          forward.click()

          let framesToContent = null
          let handoff = null
          for (let frame = 0; frame < 30 && framesToContent === null; frame += 1) {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
            const layers = [...scope.querySelectorAll('[data-content-swap]')]
            const text = scope.textContent ?? ''
            if (text.includes('Inside step 1')) {
              framesToContent = performance.now() - started
              handoff = {
                total: layers.length,
                inert: layers.filter((layer) => layer.hasAttribute('inert')).length,
                keys: layers.map((layer) => layer.getAttribute('data-content-swap')),
              }
            }
          }
          return { framesToContent, handoff }
        })
        assert(observed.framesToContent !== null, 'new content never appeared')
        assert(observed.framesToContent < 50, `new content took ${Math.round(observed.framesToContent)}ms to appear`)
        assert.equal(observed.handoff.total, 2, `expected both layers during the handoff, saw ${observed.handoff.total}`)
        assert(observed.handoff.inert >= 1, 'the outgoing layer must be inert during the handoff')
        await frames(page, 40)
        const settled = await page.locator('[data-testid="motion-content-swap"] [data-content-swap]').count()
        assert.equal(settled, 1, `swap did not collapse to one layer (${settled})`)
      })

      // Tool status handoff: the icon slot is never empty or faded during fast changes.
      await check('tool status handoff keeps the newest state fully visible', 'opacity never drops below 0.9', async () => {
        await page.getByTestId('motion-status-icon').getByRole('button', { name: 'Cycle 160ms' }).click()
        const opacities = await sample(page, () => {
          const slot = document.querySelector('[data-testid="motion-status-icon"] span.relative')
          if (!slot) return -1
          return [...slot.children].reduce((max, child) => Math.max(max, Number(getComputedStyle(child).opacity)), 0)
        }, 60)
        await page.getByTestId('motion-status-icon').getByRole('button', { name: 'Stop' }).click()
        const faded = opacities.filter((value) => value < 0.9)
        assert.equal(faded.length, 0, `icon slot faded below 0.9 on ${faded.length} frames: ${opacities.join(',')}`)
      })

      // Scroll intent: reveal animates, immediate does not.
      await check('scroll reveal is animated under normal motion', 'intermediate scroll positions', async () => {
        await page.getByTestId('motion-scroll-reveal').click()
        const positions = await sample(page, () => {
          const pane = document.querySelector('[data-testid="motion-scroll-pane"]')
          return pane ? Math.round(pane.scrollTop) : -1
        }, 20)
        const distinct = [...new Set(positions)]
        const reached = positions.at(-1) ?? 0
        assert(reached > 100, `reveal did not move the pane (last=${reached})`)
        assert(distinct.length > 2, `expected smooth intermediate positions, saw ${distinct.join(',')}`)
      })

      await check('scroll immediate never animates', 'single-frame jump', async () => {
        await page.evaluate(() => {
          const pane = document.querySelector('[data-testid="motion-scroll-pane"]')
          pane?.scrollTo({ top: 0, behavior: 'instant' })
        })
        await frames(page, 2)
        await page.getByTestId('motion-scroll-immediate').click()
        const positions = await sample(page, () => {
          const pane = document.querySelector('[data-testid="motion-scroll-pane"]')
          return pane ? Math.round(pane.scrollTop) : -1
        }, 8)
        const distinct = [...new Set(positions)]
        assert(distinct.length === 1 && distinct[0] > 100, `immediate scroll animated: ${distinct.join(',')}`)
      })

      // Reduced motion replaces the animated reveal with an instant jump.
      await check('scroll reveal jumps under reduced motion', 'instant under reduce', async () => {
        await page.getByRole('radio', { name: 'Reduced' }).click()
        await frames(page, 2)
        await page.evaluate(() => {
          const pane = document.querySelector('[data-testid="motion-scroll-pane"]')
          pane?.scrollTo({ top: 0, behavior: 'instant' })
        })
        await frames(page, 2)
        await page.getByTestId('motion-scroll-reveal').click()
        const positions = await sample(page, () => {
          const pane = document.querySelector('[data-testid="motion-scroll-pane"]')
          return pane ? Math.round(pane.scrollTop) : -1
        }, 8)
        const distinct = [...new Set(positions)]
        assert(distinct.length === 1 && distinct[0] > 100, `reduced reveal animated: ${distinct.join(',')}`)
      })

      await check('primitives raise no page errors', 'no uncaught errors', async () => {
        assert.equal(pageErrors.length, 0, pageErrors.join(' | '))
      })
    } finally {
      await page.close()
    }
  }

  // --------------------------------------------------------- calendar swap ---
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    try {
      await openPlayground(page, 'calendar-view')
      await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByText('Calendar View').first().waitFor({ timeout: 120_000 })

      await check('calendar view swap never blanks the panel and overlaps the handoff', 'no empty frame, new view <=150ms', async () => {
        const observed = await page.evaluate(async () => {
          const tab = [...document.querySelectorAll('button[aria-pressed]')]
            .find((button) => button.textContent?.trim() === 'Week')
          if (!tab) throw new Error('Week tab missing')
          const scope = tab.closest('[role="tablist"]')?.parentElement?.parentElement ?? document.body

          const started = performance.now()
          tab.click()

          const counts = []
          let framesToTwoLayers = null
          let handoff = null
          for (let frame = 0; frame < 16; frame += 1) {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
            const layers = [...scope.querySelectorAll('[data-content-swap]')]
            counts.push(layers.length)
            if (layers.length >= 2 && framesToTwoLayers === null) {
              framesToTwoLayers = performance.now() - started
              handoff = { inert: layers.filter((layer) => layer.hasAttribute('inert')).length }
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 600))
          const settled = scope.querySelectorAll('[data-content-swap]').length
          const pressed = [...document.querySelectorAll('button[aria-pressed="true"]')]
            .map((button) => button.textContent?.trim())
          return { framesToTwoLayers, handoff, settled, pressed, counts }
        })
        // A serial swap has a window with no content at all; the overlapping one
        // always keeps a layer painted.
        assert(!observed.counts.includes(0), `panel went blank during the swap: ${observed.counts.join(',')}`)
        assert(observed.framesToTwoLayers !== null, 'the incoming view never overlapped the outgoing one')
        assert(
          observed.framesToTwoLayers < 150,
          `the handoff took ${Math.round(observed.framesToTwoLayers)}ms`,
        )
        assert(observed.handoff.inert >= 1, 'the outgoing view must be inert during the handoff')
        assert.equal(observed.settled, 1, `calendar swap did not settle to one layer (${observed.settled})`)
        assert(observed.pressed.includes('Week'), `active tab was ${observed.pressed.join('/')}`)
      })
    } finally {
      await page.close()
    }
  }

  // --------------------------------------------------------- mobile menu -----
  {
    const page = await browser.newPage({ viewport: { width: 520, height: 900 } })
    try {
      await openPlayground(page, 'mobile-webui-app-menu')
      await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const trigger = page.getByRole('button', { name: 'Phaneris menu' }).first()
      await trigger.waitFor({ timeout: 120_000 })
      // The preview sits inside playground chrome, so pointer hit-testing can be
      // intercepted by the surrounding layout: click the node itself instead.
      await clickInPage(page, 'button[aria-label="Phaneris menu"]')
      await frames(page, 30)

      await check('menu sub-page pushes and marks the covered page inert', 'lower page inert, top page interactive', async () => {
        // Focus the row the way a pointer click or Enter would, so the pop has a
        // real trigger to return to (checked below).
        await page.evaluate(() => {
          const row = [...document.querySelectorAll('[data-page-present] button')]
            .find((button) => button.textContent?.trim() === 'Settings')
          if (!row) throw new Error('Settings row missing')
          row.focus()
          row.click()
        })
        await frames(page, 30)
        const observed = await page.evaluate(() => {
          const pages = [...document.querySelectorAll('[data-page-present]')]
          return pages.map((element) => ({
            depth: element.style.zIndex,
            present: element.getAttribute('data-page-present'),
            inert: element.hasAttribute('inert'),
            hidden: element.getAttribute('aria-hidden'),
          }))
        })
        assert.equal(observed.length, 2, `expected two stack pages, saw ${observed.length}`)
        const covered = observed.find((page_) => page_.inert)
        const top = observed.find((page_) => !page_.inert)
        assert(covered, 'the covered page must be inert')
        assert.equal(covered.hidden, 'true', 'the covered page must be aria-hidden')
        assert(top, 'the top page must stay interactive')
      })

      await check('menu pop plays an exit and isolates the leaving page', 'exiting page inert with presence=false', async () => {
        await clickInPage(page, 'button[aria-label="Back"]')
        await frames(page, 3)
        const duringExit = await page.evaluate(() => {
          const leaving = document.querySelector('[data-page-present="false"]')
          if (!leaving) return null
          return {
            inert: leaving.hasAttribute('inert'),
            hidden: leaving.getAttribute('aria-hidden'),
            x: getComputedStyle(leaving).transform,
          }
        })
        assert(duringExit, 'the popped page left the tree without an exit frame')
        assert.equal(duringExit.inert, true, 'the leaving page must be inert')
        assert.equal(duringExit.hidden, 'true', 'the leaving page must be aria-hidden')
        await frames(page, 60)
        const settled = await page.locator('[data-page-present="false"]').count()
        assert.equal(settled, 0, 'the leaving page never unmounted')
      })

      await check('menu pop restores focus to the opening row', 'focus back on the row', async () => {
        const focused = await page.evaluate(() => {
          const active = document.activeElement
          return {
            tag: active?.tagName ?? null,
            text: active?.textContent?.trim() ?? null,
            insideMenu: !!active?.closest('[data-page-present]'),
          }
        })
        assert.equal(focused.insideMenu, true, `focus is not in the menu: ${JSON.stringify(focused)}`)
        assert.equal(focused.text, 'Settings', `focus landed on ${focused.text}`)
      })
    } finally {
      await page.close()
    }
  }

  // ------------------------------------------- turn card disclosure (real) ---
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } })
    try {
      await openPlayground(page, 'turn-card-modes-all')
      await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.locator('[data-collapsing-region]').first().waitFor({ timeout: 120_000 })

      await check('turn card disclosure expands with every row visible inside the budget', 'all rows opaque <400ms after the click', async () => {
        const observed = await page.evaluate(async () => {
          const region = document.querySelector('[data-collapsing-region]')
          const header = region.previousElementSibling
          if (!(header instanceof HTMLElement)) throw new Error('turn header missing')
          const rowCount = () => document.querySelectorAll('[data-collapsing-region] > div > *').length

          // Collapse first so the measured run is a real reveal.
          if (rowCount() > 0) {
            header.click()
            await new Promise((resolve) => setTimeout(resolve, 600))
          }
          const started = performance.now()
          header.click()

          let allOpaqueAt = null
          for (let frame = 0; frame < 90 && allOpaqueAt === null; frame += 1) {
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
            const rows = [...document.querySelectorAll('[data-collapsing-region] > div > *')]
            if (rows.length > 0 && rows.every((row) => Number(getComputedStyle(row).opacity) > 0.9)) {
              allOpaqueAt = performance.now() - started
            }
          }
          return { allOpaqueAt, rows: rowCount() }
        })
        assert(observed.rows > 0, 'disclosure never revealed rows')
        assert(observed.allOpaqueAt !== null, 'rows never all became opaque')
        assert(observed.allOpaqueAt < 400, `rows took ${Math.round(observed.allOpaqueAt)}ms to all appear`)
      })

      await check('turn card disclosure isolates the closing list', 'inert while collapsing', async () => {
        const duringExit = await page.evaluate(async () => {
          const region = document.querySelector('[data-collapsing-region]')
          const header = region.previousElementSibling
          if (!(header instanceof HTMLElement)) throw new Error('turn header missing')
          if (document.querySelectorAll('[data-collapsing-region] > div > *').length === 0) {
            header.click()
            await new Promise((resolve) => setTimeout(resolve, 600))
          }
          header.click()
          await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
          const closing = document.querySelector('[data-collapsing-region]')
          return closing
            ? { inert: closing.hasAttribute('inert'), hidden: closing.getAttribute('aria-hidden') }
            : null
        })
        assert(duringExit, 'no collapsing layer found')
        assert.equal(duringExit.inert, true, 'the closing disclosure must be inert')
        assert.equal(duringExit.hidden, 'true', 'the closing disclosure must be aria-hidden')
      })
    } finally {
      await page.close()
    }
  }
  // ------------------------------------------------ layout share cost (V01) ---
  // Technique-level measurement for the panel-share animation (workbench open /
  // close): a flex row whose primary share animates with the same properties and
  // tokens, with text-heavy children in both panels. This is a fixture, not the
  // app: it answers "does animating this property on this kind of content cost
  // frames", which is what the risk entry asks before the app-level trace.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      const motionCss = await readFile('packages/ui/src/styles/motion.css', 'utf8')
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        body { margin: 0; font-family: system-ui; font-size: 13px; }
        #row { display: flex; height: 100vh; gap: 8px; }
        #primary { flex: 1 1 0px; min-width: 0px; overflow: hidden;
          transition-property: flex-grow, flex-basis, min-width;
          transition-duration: 280ms; transition-timing-function: cubic-bezier(0.2, 0, 0, 1); }
        #side { flex: 1 1 0px; min-width: 360px; overflow: hidden; }
        p { margin: 0 0 6px; }
      </style></head><body>
        <div id="row"><div id="primary"></div><div id="side"></div></div>
      </body></html>`)
      await page.addStyleTag({ content: motionCss })
      await page.evaluate(() => {
        const paragraph = (label) => Array.from({ length: 120 }, (_, index) =>
          `<p>${label} line ${index} — the quick brown fox jumps over the lazy dog 0123456789</p>`).join('')
        document.getElementById('primary').innerHTML = paragraph('primary')
        document.getElementById('side').innerHTML = paragraph('side')
      })

      const report = await page.evaluate(async () => {
        const primary = document.getElementById('primary')
        const frames = []
        let last = performance.now()
        let observing = true
        const tick = () => {
          const now = performance.now()
          frames.push(now - last)
          last = now
          if (observing) requestAnimationFrame(tick)
        }
        // Warm up, then animate the share the way the workbench open does.
        await new Promise((resolve) => setTimeout(resolve, 200))
        last = performance.now()
        requestAnimationFrame(tick)
        primary.style.flexGrow = '0'
        primary.style.flexBasis = '600px'
        primary.style.minWidth = '600px'
        await new Promise((resolve) => setTimeout(resolve, 450))
        observing = false
        const sorted = [...frames].sort((a, b) => a - b)
        const at = (quantile) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0
        return {
          samples: sorted.length,
          median: Math.round(at(0.5) * 10) / 10,
          p95: Math.round(at(0.95) * 10) / 10,
          worst: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
          longFrames: sorted.filter((value) => value > 32).length,
          finalWidth: Math.round(primary.getBoundingClientRect().width),
        }
      })

      results.checks.push({
        name: 'panel share animation cost (fixture)',
        observation: `median ${report.median}ms, p95 ${report.p95}ms, worst ${report.worst}ms, ${report.longFrames} frames >32ms over ${report.samples} frames`,
        status: report.longFrames <= 2 ? 'pass' : 'fail',
        detail: report.longFrames <= 2 ? null : 'layout share animation dropped multiple frames',
      })
      console.log(
        `${report.longFrames <= 2 ? 'PASS' : 'FAIL'}  panel share animation cost (fixture) — median ${report.median}ms, p95 ${report.p95}ms, worst ${report.worst}ms, long frames ${report.longFrames}, settled width ${report.finalWidth}px`,
      )
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

const failures = results.checks.filter((entry) => entry.status === 'fail')
await writeFile(
  `${outputDir}/motion-verification-results.json`,
  `${JSON.stringify(results, null, 2)}\n`,
  'utf8',
)
console.log('')
console.log(`${results.checks.length - failures.length}/${results.checks.length} checks passed`)
if (failures.length) process.exit(1)
