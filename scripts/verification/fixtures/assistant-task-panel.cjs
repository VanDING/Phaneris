const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { _electron } = require('playwright')
const { firstBusinessWindow } = require('./electron-windows.cjs')

/**
 * The assistant work board in the shipped application, on both surfaces it
 * appears: the titlebar peek and the panel inside the assistant's own view.
 *
 * The records were written by the Host store before launch, so a passing
 * assertion means a user would see these facts, not a fixture's copy of them.
 */
;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '0',
    PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const app = await _electron.launch({ ...(fixture.executable ? { executablePath: fixture.executable } : {}),
    args: [...(fixture.executable ? [] : [join(fixture.root, 'apps/electron')]), `--user-data-dir=${join(fixture.config, 'electron-profile')}`],
    cwd: fixture.root, env, timeout: 90_000 })
  const scenes = [], errors = []
  const page = await firstBusinessWindow(app, { timeout: 90_000 })
  page.on('pageerror', error => errors.push(error.message))
  await page.context().tracing.start({ screenshots: true, snapshots: true })
  const window = await app.browserWindow(page)
  try {
    await window.evaluate(window => { window.webContents.setBackgroundThrottling(false); window.setContentSize(1280, 900) })
    await page.waitForFunction(() => document.documentElement.dataset.themeStatus === 'ready')

    // ── Surface 1: the peek that opens on hover over the assistant's slot ──
    // Close the assistant view first if the restored route opened it: the peek
    // belongs to the ordinary workspace, and the surface covers the titlebar.
    const surface = page.getByTestId('resident-assistant-surface')
    if (await surface.count()) {
      await page.getByTestId('resident-close').click()
      await surface.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {})
      await page.mouse.move(0, 400)
      await page.waitForTimeout(400)
    }
    // The island's look is the product's own and is not under test here; what
    // is tested is that resting on it shows the board.
    await page.getByTestId('resident-brand-entry').hover()
    const peek = page.getByTestId('resident-snapshot')
    await peek.waitFor({ state: 'visible', timeout: 30_000 })
    const peekBoard = peek.getByTestId('resident-peek-board')
    await peekBoard.waitFor({ timeout: 30_000 })
    await peekBoard.getByTestId('focus-board').waitFor({ timeout: 30_000 })
    // One bar per task in play. The count follows the task count, so assert it
    // against the projections the board actually rendered, not against a fixed
    // capacity: the previous 18 fixed seats were the bug this replaces.
    const peekBars = await peekBoard.getByTestId('focus-bar').count()
    assert(peekBars >= 5, `the peek must show a bar per live task, saw ${peekBars}`)
    // No second task switcher: the title strip that competed with the meter is gone.
    assert.equal(await peekBoard.getByTestId('focus-segment').count(), 0,
      'a title strip must not compete with the gauge for the same row')
    // The capacity figures are the Host's scheduling record, so assert the
    // shape, not a run's numbers.
    const peekStrip = await peekBoard.getByTestId('focus-capacity').textContent()
    assert(/运行 \d+ \/ \d+/.test(peekStrip ?? ''), `the peek states capacity as running/capacity: "${peekStrip}"`)
    const figures = (peekStrip ?? '').match(/(\d+) \/ (\d+)/).slice(1, 3)
    const runningText = figures[0], capacityText = figures[1]
    assert(Number(runningText) <= Number(capacityText), 'running never exceeds capacity')
    // A bar carries its state as a fill, not only as a colour.
    const barTones = await peekBoard.getByTestId('focus-bar').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('data-tone')))
    assert(barTones.every(tone => typeof tone === 'string' && tone.length > 0),
      'every bar must state its tone, otherwise the fill means nothing')
    assert(new Set(barTones).size >= 2, `the sample data must show more than one bar state, saw ${[...new Set(barTones)].join(',')}`)
    await page.screenshot({ path: join(fixture.output, 'board-peek.png') })
    scenes.push('FB01-titlebar-peek-shows-the-board-with-a-segment-per-live-task')

    // Choosing a segment changes the record beside it.
    const firstTitle = await peekBoard.locator('.focus-title').textContent()
    // The peek is a hover surface, so a real pointer click can race the collapse
    // that moving to the button triggers. Activate the control the way a user's
    // keyboard would, which is the same handler without the hover race.
    await peekBoard.getByTestId('focus-bar').nth(1).evaluate(node => node.click())
    await page.waitForFunction(() => {
      const titles = [...document.querySelectorAll('[data-testid="resident-peek-board"] .focus-title')]
      return titles.length === 1
    }, undefined, { timeout: 10_000 })
    const secondTitle = await peekBoard.locator('.focus-title').textContent()
    assert.notEqual(secondTitle, firstTitle, `a segment must switch the record (both showed "${firstTitle}")`)
    scenes.push('FB02-each-segment-switches-the-record')

    // ── Surface 2: the panel inside the assistant's own view ──────────────
    await page.mouse.move(0, 400)
    await page.keyboard.press('Escape')
    await page.getByTestId('resident-brand-entry').click()
    const assistant = page.locator('[data-session-kind="resident_assistant"]')
    await assistant.waitFor({ state: 'visible', timeout: 60_000 })
    await page.getByTestId('resident-details-trigger').click()
    const panel = page.getByTestId('resident-work-panel')
    await panel.waitFor({ state: 'visible', timeout: 60_000 })
    const board = panel.getByTestId('focus-board')
    await board.waitFor({ timeout: 30_000 })

    // The panel is a floating surface anchored to the RIGHT edge: inset on all
    // four sides, narrower than the view, and not a full-height drawer.
    const geometry = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="resident-work-panel"]')
      const surface = document.querySelector('#resident-assistant-surface')
      if (!sheet || !surface) return null
      const box = sheet.getBoundingClientRect(), host = surface.getBoundingClientRect()
      return { top: Math.round(box.top - host.top), bottom: Math.round(host.bottom - box.bottom),
        right: Math.round(host.right - box.right), left: Math.round(box.left - host.left),
        width: Math.round(box.width), hostWidth: Math.round(host.width),
        height: Math.round(box.height), hostHeight: Math.round(host.height),
        parent: sheet.parentElement?.className ?? 'none',
        position: getComputedStyle(sheet).position, zIndex: getComputedStyle(sheet).zIndex }
    })
    writeFileSync(join(fixture.output, 'board-geometry.json'), JSON.stringify(geometry, null, 2))
    assert(geometry, 'the panel and its host surface must both exist')
    assert(geometry.right > 0 && geometry.right <= 24, `the panel must sit inset from the right edge (right=${geometry.right})`)
    assert(geometry.left > geometry.right * 4, `the panel is anchored right, not centred (left=${geometry.left}, right=${geometry.right})`)
    assert(geometry.bottom > 0, `the panel must leave a bottom margin (bottom=${geometry.bottom})`)
    assert(geometry.width < geometry.hostWidth * 0.6, `the panel is a sidebar, not the full view (width=${geometry.width})`)

    const panelBars = await board.getByTestId('focus-bar').count()
    assert(panelBars >= 5, `the panel must show the same bars, saw ${panelBars}`)
    assert.equal(await board.getByTestId('focus-capacity').count(), 1, 'the panel states capacity once')
    assert.equal(await board.getByTestId('focus-segment').count(), 0, 'the panel has no title strip either')
    // One column, top to bottom: the record precedes the rail, which precedes
    // the actions. A second column would squeeze every line in this width.
    const stacking = await board.evaluate(node => {
      const scroll = node.querySelector('[data-testid="focus-record"]')?.getBoundingClientRect()
      const rail = node.querySelector('.focus-rail')?.getBoundingClientRect()
      const actions = node.querySelector('[data-testid="focus-actions"]')?.getBoundingClientRect()
      if (!scroll || !rail || !actions) return null
      return { recordAboveRail: scroll.bottom <= rail.top + 2, railAboveActions: rail.bottom <= actions.top + 2,
        columns: new Set([scroll.x, rail.x].map(value => Math.round(value))).size }
    })
    writeFileSync(join(fixture.output, 'board-stacking.json'), JSON.stringify(stacking, null, 2))
    assert(stacking, 'the dock must render a record, a rail and an action group')
    assert.equal(stacking.recordAboveRail, true, 'the dock stacks record → rail')
    assert.equal(stacking.railAboveActions, true, 'the dock stacks rail → actions')
    assert.equal(stacking.columns, 1, 'the dock is one column, not two')

    // The rail exists, lists work in flight, and pins deliverables to its bottom.
    const rail = await page.evaluate(() => {
      const railNode = document.querySelector('[data-testid="focus-board"] .focus-rail')
      const delivered = document.querySelector('[data-testid="focus-delivered"]')
      if (!railNode || !delivered) return null
      const railBox = railNode.getBoundingClientRect(), deliveredBox = delivered.getBoundingClientRect()
      return { rows: railNode.querySelectorAll('[data-testid="focus-rail-row"]').length,
        files: document.querySelectorAll('[data-testid="focus-delivered-file"]').length,
        deliveredAtBottom: Math.abs(deliveredBox.bottom - railBox.bottom) <= 2 }
    })
    assert(rail, 'the board must have a rail with a delivered block')
    assert.equal(rail.deliveredAtBottom, true, 'deliverables must sit at the rail\'s bottom edge')
    writeFileSync(join(fixture.output, 'board-rail.json'), JSON.stringify(rail, null, 2))
    await page.screenshot({ path: join(fixture.output, 'board-panel.png') })
    scenes.push('FB03-assistant-view-anchors-the-board-to-the-right-as-a-floating-panel')
    scenes.push('FB04-rail-lists-work-in-flight-and-pins-deliverables-to-its-bottom')

    // The action group follows the stage: an accepted or terminated task
    // offers nothing, a candidate result offers the acceptance decision.
    const actions = []
    for (let index = 0; index < panelBars; index++) {
      await board.getByTestId('focus-bar').nth(index).click()
      await page.waitForTimeout(60)
      actions.push(await board.evaluate(node => ({
        stage: node.querySelector('.focus-state')?.getAttribute('data-state'),
        labels: [...node.querySelectorAll('.focus-actions button')].map(button => button.textContent?.trim()),
        accept: !!node.querySelector('[data-testid="focus-accept"]'),
        pause: !!node.querySelector('[data-testid="focus-pause"]'),
        terminate: !!node.querySelector('[data-testid="focus-terminate"]'),
      })))
    }
    writeFileSync(join(fixture.output, 'board-actions.json'), JSON.stringify(actions, null, 2))
    for (const entry of actions) {
      // A finished run offers acceptance; nothing finished offers execution controls.
      if (entry.accept) assert.equal(entry.pause, false, `a result to judge must not offer pause (${entry.stage})`)
      if (entry.pause) assert.equal(entry.accept, false, `a live task must not offer acceptance (${entry.stage})`)
    }
    assert(actions.some(entry => entry.accept), 'at least one task offers the acceptance decision')
    scenes.push('FB04-actions-follow-the-recorded-stage')

    const unnamed = await board.evaluate(node => [...node.querySelectorAll('button')]
      .filter(button => !(button.getAttribute('aria-label') ?? button.textContent ?? '').trim()).length)
    assert.equal(unnamed, 0, 'every control has an accessible name')
    assert.deepEqual(errors, [])
    writeFileSync(join(fixture.output, 'board-evidence.json'), JSON.stringify({ scenes, errors, actions }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(fixture.output, 'board-failure.png'), timeout: 5000 }).catch(() => {})
    writeFileSync(join(fixture.output, 'board-debug.json'), JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      peek: !!document.querySelector('[data-testid="resident-snapshot"]'),
      board: document.querySelectorAll('[data-testid="focus-board"]').length,
      bars: document.querySelectorAll('[data-testid="focus-bar"]').length,
      segments: document.querySelectorAll('[data-testid="focus-segment"]').length,
      panel: !!document.querySelector('[data-testid="resident-work-panel"]'),
      surface: !!document.querySelector('[data-session-kind="resident_assistant"]'),
      body: document.body.innerText.slice(0, 900),
    })).catch(() => ({})), null, 2))
    throw error
  } finally {
    await page.context().tracing.stop({ path: join(fixture.output, 'board-trace.zip') }).catch(() => {})
    await app.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
