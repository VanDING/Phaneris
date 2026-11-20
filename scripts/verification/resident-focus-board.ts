import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser, gotoWithRetry } from './workflow-browser'

/**
 * The assistant's work board, as implemented.
 *
 * Every claim the redesign makes is measured on the shipped component and its
 * CSS, not on a mock: the gauge carries one equal-height bar per task (not a
 * fixed 18-slot meter), a bar's state is in its fill, the record types at body
 * scale rather than as a panel heading, the peek keeps two columns, and the dock
 * is a right-anchored floating panel stacked top to bottom.
 */

/** A Host projection shaped like session-tools-core's TaskProjectionView. */
function projection(index: number, stage: string, title: string) {
  return {
    task: {
      id: `task-${index}`, goalId: 'goal', title, scopeIn: [`scope-in-${index}`], scopeOut: ['scope-out'],
      acceptance: [{ id: `criterion-${index}`, statement: `Criterion ${index} must hold` }],
      dependsOn: [], definitionVersion: 2, createdAt: 1, updatedAt: 1,
    },
    goal: { id: 'goal', title: `Goal ${index}`, successCriteria: [], createdAt: 1, updatedAt: 1 },
    requirements: [{
      id: `requirement-${index}`, taskId: `task-${index}`, version: 2, scope: 'goal', state: 'active', createdAt: 1,
      statement: `Requirement ${index} is the sentence a reader has to judge.`,
    }],
    activeRequirements: [], changes: [],
    assignments: [{
      id: `assignment-${index}`, taskId: `task-${index}`, definitionVersion: 2, requirementIds: [],
      state: 'running', sessionId: `session-${index}`, createdAt: 1, updatedAt: 1,
    }],
    stage, definitionVersion: 2, definitionAheadOfExecution: false,
  }
}

const items = [
  projection(0, 'needs_user', 'Lumen activity window: keep 7 days or unify on 30'),
  projection(1, 'candidate_result', 'Q4 weekly review: keep both windows on the difference page'),
  projection(2, 'running', 'Unify the Atlas and Lumen metric windows'),
  projection(3, 'queued', 'Review the Q4 comparison table'),
  projection(4, 'ready', 'Check the source-citation retention policy'),
]

await verificationWorkflow('resident-focus-board', async run => {
  const bundle = await buildFixturePage({ runDirectory: run.directory, entry: resolve(import.meta.dir, 'fixtures/resident-focus-board.tsx') })
  const launched = await launchWorkflowBrowser()
  const context = await launched.browser.newContext({ viewport: { width: 1100, height: 820 } })
  const page = await context.newPage()
  const errors: string[] = []
  const scenes: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(value => { window.focusBoardData = value }, {
    items,
    deliverables: [{
      id: 'deliverable-0', key: 'final', role: 'final', artifactId: 'artifact-0', revision: 'v2',
      title: 'Q4 weekly draft', sourcePath: 'q4.md', mimeType: 'text/markdown', size: 3800,
      manifestRevision: 2, delegationId: 'delegation-0', taskTitle: items[0].task.title, createdAt: 2,
      result: { sessionId: 'session-0', messageId: 'message-0' }, supporting: [],
    }],
    scheduling: { occupied: 1, capacity: 18, queued: 2, paused: 0 },
  })
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await gotoWithRetry(page, bundle.url)
    await page.getByTestId('focus-board').waitFor()
    await page.getByTestId('focus-bars').waitFor()

    /* ── the gauge: one bar per task, equal height, state in the fill ── */
    const gauge = await page.evaluate(() => {
      const bars = [...document.querySelectorAll('[data-testid="focus-bar"]')]
      const boxes = bars.map(bar => bar.getBoundingClientRect())
      const tones = bars.map(bar => bar.getAttribute('data-tone'))
      return {
        count: bars.length,
        heightKinds: [...new Set(boxes.map(box => Math.round(box.height)))],
        height: Math.round(boxes[0]?.height ?? 0),
        tones,
        uniqueTones: [...new Set(tones)].length,
        selected: bars.filter(bar => bar.getAttribute('aria-current') === 'true').length,
        labels: bars.map(bar => bar.getAttribute('aria-label')),
        gaugeHeight: Math.round(document.querySelector('.focus-gauge')!.getBoundingClientRect().height),
        titleStrip: document.querySelectorAll('[data-testid="focus-segment"]').length,
      }
    })
    assert.equal(gauge.count, items.length, `one bar per task (expected ${items.length}, saw ${gauge.count})`)
    assert.equal(gauge.heightKinds.length, 1, `every bar has the same height, saw ${gauge.heightKinds.join('/')}`)
    assert(gauge.height <= 12, `a bar is a tick, not a card (height=${gauge.height})`)
    assert(gauge.gaugeHeight <= 24, `the gauge row stays one line (height=${gauge.gaugeHeight})`)
    assert(gauge.uniqueTones >= 3, `bar fills differentiate states, saw ${gauge.tones.join(',')}`)
    assert(gauge.selected <= 1, `at most one bar is the selection, saw ${gauge.selected}`)
    assert(gauge.labels.every(label => typeof label === 'string' && label.includes(' · ')), 'every bar is named task · state')
    assert.equal(gauge.titleStrip, 0, 'no second title switcher competes with the gauge')
    scenes.push('FB01-the-gauge-is-one-equal-height-bar-per-task')

    /* ── clicking a bar focuses that task ─────────────────────────────── */
    const before = await page.locator('.focus-title').textContent()
    await page.getByTestId('focus-bar').nth(1).click()
    await page.waitForTimeout(60)
    const after = await page.locator('.focus-title').textContent()
    assert.notEqual(after, before, `a bar switches the record (both showed "${before}")`)
    scenes.push('FB02-a-bar-is-the-task-switcher')

    /* ── the record types at body scale, not as a panel heading ──────── */
    const type = await page.evaluate(() => {
      const sizes = [...document.querySelectorAll('.focus-title, .focus-version-text, .focus-criterion-text, .focus-asked, .focus-facts dd')]
        .map(node => parseFloat(getComputedStyle(node).fontSize))
      return { min: Math.min(...sizes), max: Math.max(...sizes) }
    })
    assert(type.max <= 14, `the record never exceeds text-reading (max=${type.max}px)`)
    assert(type.min >= 12, `body copy stays legible for CJK (min=${type.min}px)`)
    scenes.push('FB03-the-record-types-at-body-scale')

    /* ── peek: two columns, no sideways scroll ──────────────────────── */
    const peek = await page.evaluate(() => {
      const record = document.querySelector('[data-testid="focus-record"]')!.getBoundingClientRect()
      const rail = document.querySelector('.focus-rail')!.getBoundingClientRect()
      const scrollers = [...document.querySelectorAll('.focus-board *')].filter(node =>
        ['auto', 'scroll'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 1)
      return {
        surface: document.querySelector('[data-testid="focus-board"]')!.getAttribute('data-surface'),
        columns: new Set([Math.round(record.x), Math.round(rail.x)]).size,
        railBeside: rail.left >= record.right - 1,
        sideways: scrollers.map(node => node.className).filter(name => name !== 'focus-bars'),
      }
    })
    assert.equal(peek.surface, 'peek')
    assert.equal(peek.columns, 2, 'the peek keeps two columns')
    assert.equal(peek.railBeside, true, 'the peek places the rail beside the record')
    assert.deepEqual(peek.sideways, [], 'nothing except the gauge scrolls sideways')
    await page.screenshot({ path: join(run.directory, 'focus-board-peek.png') })
    scenes.push('FB04-the-peek-keeps-two-columns')

    /* ── dock: a right-anchored floating panel, stacked ─────────────── */
    await page.evaluate(() => window.focusBoardSurface('dock'))
    await page.waitForTimeout(150)
    const dock = await page.evaluate(() => {
      const board = document.querySelector('[data-testid="focus-board"]')!
      const wrap = board.parentElement!.getBoundingClientRect()
      const record = document.querySelector('[data-testid="focus-record"]')!.getBoundingClientRect()
      const rail = document.querySelector('.focus-rail')!.getBoundingClientRect()
      const actions = document.querySelector('[data-testid="focus-actions"]')!.getBoundingClientRect()
      const bars = [...document.querySelectorAll('[data-testid="focus-bar"]')].map(bar => bar.getBoundingClientRect())
      return {
        surface: board.getAttribute('data-surface'),
        width: Math.round(wrap.width),
        columns: new Set([Math.round(record.x), Math.round(rail.x), Math.round(actions.x)]).size,
        recordAboveRail: record.bottom <= rail.top + 2,
        railAboveActions: rail.bottom <= actions.top + 2,
        barsFit: bars.every(box => box.right <= record.right + 1),
        barsEqualHeight: new Set(bars.map(box => Math.round(box.height))).size === 1,
        inFlightVisible: (() => {
          const list = document.querySelector('.focus-rail-grow')
          return !!list && list.getClientRects().length > 0 && getComputedStyle(list).display !== 'none'
        })(),
        inFlightRows: document.querySelectorAll('[data-testid="focus-rail-row"]').length,
        actionsVisible: actions.height > 0 && actions.bottom <= window.innerHeight + 1,
      }
    })
    assert.equal(dock.surface, 'dock')
    assert.equal(dock.width, 384, `the dock is a sidebar, not the full view (width=${dock.width})`)
    assert.equal(dock.columns, 1, 'the dock stacks in one column')
    assert.equal(dock.recordAboveRail, true, 'the dock stacks record → rail')
    assert.equal(dock.railAboveActions, true, 'the dock stacks rail → actions')
    assert.equal(dock.barsFit, true, 'every bar stays inside the record column')
    assert.equal(dock.barsEqualHeight, true, 'the gauge stays equal height in the dock too')
    // The in-flight list is how a reader switches task without the gauge, so it
    // must not be hidden to save space — that was a real defect this catches.
    assert.equal(dock.inFlightVisible, true, 'the dock keeps its in-flight list')
    assert(dock.inFlightRows > 1, `the dock lists the live tasks (rows=${dock.inFlightRows})`)
    assert.equal(dock.actionsVisible, true, 'the action group stays visible at the bottom')
    await page.screenshot({ path: join(run.directory, 'focus-board-dock.png') })
    scenes.push('FB05-the-dock-stacks-as-a-right-anchored-panel')

    assert.deepEqual(errors, [])
    run.json('focus-board-evidence.json', { scenes, gauge, type, peek, dock, errors })
    run.complete(scenes, ['Real Host projections (this fixture renders the contracts directly)', 'Permission and acceptance flows beyond the recorded projection'])
  } finally {
    await context.tracing.stop({ path: join(run.directory, 'focus-board-trace.zip') }).catch(() => {})
    await context.close()
    await launched.close()
    await bundle.close()
  }
})
