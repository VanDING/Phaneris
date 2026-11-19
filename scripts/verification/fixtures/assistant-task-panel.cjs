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
    const peekSegments = await peekBoard.getByTestId('focus-segment').count()
    assert(peekSegments >= 5, `the peek must show a segment per live task, saw ${peekSegments}`)
    // The capacity strip spans the column and is the switcher. Its figures are
    // the Host's scheduling record, so assert the shape, not a run's numbers.
    //
    // Two shapes are correct, and which one appears is the workspace's own state:
    //   "运行 N / M"  a declared ceiling (assistantTasks.concurrency)
    //   "运行 N"      no declared ceiling — the default, and it must not invent one
    const peekStrip = (await peekBoard.getByTestId('focus-capacity').textContent()) ?? ''
    assert(/运行 \d+( \/ \d+)?/.test(peekStrip), `the peek states capacity as running[/capacity]: "${peekStrip}"`)
    const figures = peekStrip.match(/(\d+)( \/ (\d+))?/)
    const runningText = figures[1], capacityText = figures[3]
    const seats = await peekBoard.locator('.focus-seat').count()
    if (capacityText === undefined) {
      // No ceiling: one seat per running task, and no free-slot claim.
      assert.equal(seats, Number(runningText), `with no ceiling the meter shows one seat per running task (${seats} vs ${runningText})`)
    } else {
      assert.equal(seats, Number(capacityText), `the meter shows one seat per capacity slot (${seats} vs ${capacityText})`)
      assert(Number(runningText) <= Number(capacityText), 'running never exceeds capacity')
    }
    await page.screenshot({ path: join(fixture.output, 'board-peek.png') })
    scenes.push('FB01-titlebar-peek-shows-the-board-with-a-segment-per-live-task')

    // Choosing a segment changes the record beside it.
    const firstTitle = await peekBoard.locator('.focus-title').textContent()
    await peekBoard.getByTestId('focus-segment').nth(1).click()
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

    // The board is a sheet from the top of the view, not a floating card
    // anchored to the corner control: its top edge sits at the view's top and
    // it is horizontally centred, which is what "from the top" means here.
    const geometry = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="resident-work-panel"]')
      const surface = document.querySelector('#resident-assistant-surface')
      if (!sheet || !surface) return null
      const box = sheet.getBoundingClientRect(), host = surface.getBoundingClientRect()
      return { top: Math.round(box.top - host.top), centre: Math.round(box.left + box.width / 2),
        hostCentre: Math.round(host.left + host.width / 2), width: Math.round(box.width), hostWidth: Math.round(host.width),
        sheetTop: Math.round(box.top), hostTop: Math.round(host.top), parent: sheet.parentElement?.className ?? 'none',
        position: getComputedStyle(sheet).position, zIndex: getComputedStyle(sheet).zIndex }
    })
    writeFileSync(join(fixture.output, 'board-geometry.json'), JSON.stringify(geometry, null, 2))
    assert(geometry, 'the panel and its host surface must both exist')
    assert(geometry.top <= 24, `the board must open from the top of the view (top=${geometry.top})`)
    assert(Math.abs(geometry.centre - geometry.hostCentre) <= 2, 'the board must be centred on the view')

    const panelSegments = await board.getByTestId('focus-segment').count()
    assert(panelSegments >= 5, `the panel must show the same segments, saw ${panelSegments}`)
    assert.equal(await board.getByTestId('focus-capacity').count(), 1, 'the panel states capacity once')
    // No title above the strip: the strip is the first element of the left column.
    const stripFirst = await board.evaluate(node => node.querySelector('.focus-left')?.firstElementChild?.className ?? '')
    assert(stripFirst.includes('focus-strip'), `the strip must lead the column, saw "${stripFirst}"`)

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
    scenes.push('FB03-assistant-view-opens-the-board-from-the-top')
    scenes.push('FB04-rail-lists-work-in-flight-and-pins-deliverables-to-its-bottom')

    // The action group follows the stage: an accepted or terminated task
    // offers nothing, a candidate result offers the acceptance decision.
    const actions = []
    for (let index = 0; index < panelSegments; index++) {
      await board.getByTestId('focus-segment').nth(index).click()
      await page.waitForTimeout(60)
      actions.push(await board.evaluate(node => ({
        stage: node.querySelector('.focus-stage')?.getAttribute('data-stage'),
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
