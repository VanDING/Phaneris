import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import type { Session } from '@phaneris/shared/protocol'
import type { WorkItem } from '@phaneris/shared/work-items'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser, gotoWithRetry } from './workflow-browser'

/** Render real Host projections in the production Board container. Transport
 * is frozen at this checkpoint; no second projection algorithm in the fixture. */
export async function verifyTaskBoard(directory: string, data: { sessions: Session[]; items: WorkItem[] }): Promise<string[]> {
  const bundle = await buildFixturePage({ runDirectory: directory, entry: resolve(import.meta.dir, 'fixtures/resident-assistant-tasks-board.tsx') })
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(value => { window.taskBoardData = value }, data)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await gotoWithRetry(page, bundle.url)
    await page.getByText('Board parent', { exact: true }).waitFor()
    await page.getByText('board-blocker', { exact: true }).waitFor()
    assert.equal(await page.getByText('Legacy assistant work', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Legacy handoff continuation', { exact: true }).count(), 0)
    // The tile keeps only layout: its activation surface is a real <button> with
    // no explicit role="button" (adding one produced axe nested-interactive
    // failures), and the status/subtask controls are siblings of that button. So
    // anchor on the tile root, not on any single role.
    const parent = page.getByText('Board parent', { exact: true }).locator('xpath=ancestor::*[@data-testid="kanban-tile"][1]')
    await parent.getByRole('button', { name: 'Subtasks', exact: true }).click()
    const queued = parent.getByRole('button', { name: /Saved queued child/ })
    await queued.waitFor()
    assert.equal(await queued.locator('[aria-label="Pending"]').count(), 1, 'Saved delegated input must render pending')
    assert.equal(await queued.locator('[aria-label="Done"]').count(), 0)
    assert.equal(await page.getByText('Saved queued child', { exact: true }).count(), 1, 'Ordinary child stays within its parent card')
    const search = page.getByRole('searchbox')
    await search.fill('Ordinary child')
    await page.getByText('Board parent', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(await page.getByText('Ordinary child', { exact: true }).count(), 0, 'Search cannot promote an archived ordinary parent child')
    await search.fill('')
    await page.getByText('Board parent', { exact: true }).waitFor()
    for (const mode of ['light', 'dark'] as const) {
      await page.evaluate(value => window.taskBoardTheme(value), mode)
      await page.locator(`[data-mode="${mode}"][data-ready="true"]`).waitFor()
      await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
      await page.screenshot({ path: join(directory, `board-${mode}.png`), fullPage: true })
    }
    assert.deepEqual(errors, [])
    return ['TM03-legacy-handoff-does-not-create-a-board-card', 'TM05-production-board-renders-saved-input-as-pending', 'TM02-board-search-preserves-ordinary-child-nesting']
  } finally {
    await context.tracing.stop({ path: join(directory, 'board-trace.zip') })
    await context.close(); await launched.close(); await bundle.close()
  }
}
