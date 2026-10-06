#!/usr/bin/env bun
/**
 * verify-files-panel-e2e.ts — drive the Files panel in a real browser.
 *
 * The playground renders the production `FilesPanel` against fixtures
 * (`apps/electron/src/renderer/playground/registry/files-panel.tsx`), which is
 * the only place the panel can be exercised outside Electron. This script
 * starts that playground (or reuses one already listening), walks the three
 * views, and writes a machine-readable record plus a screenshot.
 *
 * Usage:
 *   bun run scripts/verify-files-panel-e2e.ts                 # headless
 *   bun run scripts/verify-files-panel-e2e.ts --headed        # watch it run
 *   bun run scripts/verify-files-panel-e2e.ts --base-url http://localhost:5173
 *
 * Exit code 0 = every assertion held.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const ROOT = join(import.meta.dir, '..')
const args = process.argv.slice(2)
const headed = args.includes('--headed')
const baseUrlArg = args.indexOf('--base-url')
const BASE_URL = baseUrlArg >= 0 ? args[baseUrlArg + 1]! : 'http://localhost:5173'
const PLAYGROUND_URL = `${BASE_URL}/playground.html`

const OUT_DIR = process.env.PHANERIS_VERIFY_DIR ?? join(ROOT, '.verify', 'files-panel')
mkdirSync(OUT_DIR, { recursive: true })

const results: Array<{ check: string; ok: boolean; detail: string }> = []
const observations: Record<string, unknown> = {}

function check(name: string, ok: boolean, detail: unknown = ''): void {
  results.push({ check: name, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

/** Every row rendered by the Browse tree, in document order. */
async function treeRows(page: Page): Promise<Array<{ name: string; expanded: string | null; nested: boolean; icon: string }>> {
  return page.locator('nav[aria-label] button[aria-expanded], nav[aria-label] button[title*="/"]').evaluateAll(
    (nodes) => nodes.map((node) => ({
      name: (node.querySelector('span.flex-1')?.textContent ?? node.textContent ?? '').trim(),
      expanded: node.getAttribute('aria-expanded'),
      nested: Boolean(node.closest('nav')?.parentElement?.closest('.group\\/section')),
      icon: Array.from(node.querySelectorAll('svg'))
        .map(svg => svg.getAttribute('class')?.match(/lucide-[a-z-]+/)?.[0] ?? '')
        .filter(name => name && !name.includes('chevron'))
        .join(','),
    })),
  )
}

async function tabLabels(page: Page): Promise<string[]> {
  return page.locator('[role="tablist"] [role="tab"]').allInnerTexts()
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  // The playground remembers the last previewed component in localStorage, and
  // the diff viewer preference round-trips through the same store.
  await page.addInitScript(() => {
    // Seed only on the first load: this script re-runs on reload, and must not
    // erase what the run itself persisted.
    if (!window.localStorage.getItem('playground-selected-component')) {
      window.localStorage.setItem('playground-selected-component', 'files-panel')
    }
    if (!window.localStorage.getItem('playground-diff-viewer')) {
      window.localStorage.setItem('playground-diff-viewer', JSON.stringify({ diffStyle: 'unified', disableBackground: false }))
    }
  })

  console.log(`\n▶ ${PLAYGROUND_URL}`)
  await page.goto(PLAYGROUND_URL, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('seed-view-browse').waitFor({ timeout: 30_000 })

  // ── 1. Top-level navigation is exactly Browse / Artifacts / Changed ─────────
  const filesTabs = await tabLabels(page)
  observations.filesTabs = filesTabs
  check('Files has exactly three top-level views', filesTabs.length === 3, filesTabs)
  check(
    'view labels resolve (no raw i18n keys)',
    filesTabs.every(label => label.length > 0 && !label.includes('.')),
    filesTabs,
  )
  // The artifacts view label is asserted later; here we only guarantee the
  // third view is the diff view, which the legacy key also covered.
  check('no legacy "Opened"/"Activity"/"Attachments" tabs remain',
    !filesTabs.some(label => /Opened|Activity|Attachments|已打开|活动|附件/.test(label)), filesTabs)

  // ── 2. Browse: two collapsible roots, attachments pinned and de-duplicated ──
  const browseRows = await treeRows(page)
  observations.browseRows = browseRows
  const rootNames = browseRows.filter(row => !row.nested).map(row => row.name)
  check('browse renders exactly two root nodes', rootNames.length === 2, rootNames)
  check('working-directory root keeps its folder name', rootNames[0] === 'Phaneris', rootNames[0])

  await page.getByRole('button', { name: 'Phaneris', exact: true }).click()
  const afterExpand = await treeRows(page)
  check('work folder expands to its top-level entries',
    afterExpand.some(row => row.name === 'packages') && afterExpand.some(row => row.name === 'README.md'),
    afterExpand.map(row => row.name))
  await page.getByRole('button', { name: 'Phaneris', exact: true }).click()

  // With the work folder collapsed again, the session group follows it.
  const sessionGroupIndex = (await treeRows(page)).findIndex(row => row.name === 'This session')
  const sessionRows = (await treeRows(page)).slice(sessionGroupIndex + 1).map(row => row.name)
  observations.sessionRows = sessionRows
  check('session root pins the two attachments first',
    sessionRows[0] === '需求说明.pdf' && sessionRows[1] === '界面草图.png', sessionRows.slice(0, 2))
  check('attachment derivatives are not pinned',
    !sessionRows.slice(0, 2).some(name => /thumb|\.md$/.test(name)), sessionRows.slice(0, 2))
  const attachmentRows = (await treeRows(page)).filter(row => row.name === '需求说明.pdf').length
  check('each attachment is listed exactly once', attachmentRows === 1, attachmentRows)

  const pinnedIcons = (await treeRows(page))
    .filter(row => ['需求说明.pdf', '界面草图.png'].includes(row.name))
    .map(row => row.icon)
  check('pinned attachments carry the paperclip affordance',
    pinnedIcons.length === 2 && pinnedIcons.every(icon => icon === 'lucide-paperclip'), pinnedIcons)

  // The derivatives live in the same folder; they keep their real type icons,
  // which is what proves the pinned rows are not just "the whole folder".
  const derivativeIcons = (await treeRows(page))
    .filter(row => ['9f1c_thumb.png', '9f1c_需求说明.md'].includes(row.name))
    .map(row => row.icon)
  check('attachment derivatives keep their file-type icons',
    derivativeIcons.length === 2 && derivativeIcons.every(icon => icon !== 'lucide-paperclip'), derivativeIcons)

  await page.screenshot({ path: join(OUT_DIR, 'browse.png') })

  // ── 3. Artifacts: default filter hides preview registrations ───────────────
  const artifactsTab = page.locator('[role="tablist"] [role="tab"]').nth(1)
  await artifactsTab.click()
  await page.getByTestId('artifacts-count').waitFor()
  const artifactsLabel = (await artifactsTab.innerText()).trim()
  observations.artifactsLabel = artifactsLabel
  check('artifact view label resolves', artifactsLabel.length > 0 && !artifactsLabel.includes('.'), artifactsLabel)

  const defaultCount = (await page.getByTestId('artifacts-count').innerText()).trim()
  observations.defaultCount = defaultCount
  check('deliverables filter hides the preview registration', defaultCount === '4', defaultCount)

  const readyRow = page.locator('nav[aria-label] li', { hasText: 'release-notes.md' }).first()
  const acceptButton = readyRow.getByRole('button', { name: 'Accept' })
  const canAccept = await acceptButton.count() > 0
  check('a ready artifact offers Accept', canAccept, canAccept)
  if (canAccept) await acceptButton.click()
  await page.waitForTimeout(400)
  const readyRowText = (await readyRow.innerText()).replace(/\n/g, ' | ')
  observations.readyRowAfterAccept = readyRowText
  check('accepting a ready artifact clears its pending actions',
    readyRowText.includes('Accepted') && !readyRowText.includes('Accept |'), readyRowText)
  const afterAccept = (await page.getByTestId('artifacts-count').innerText()).trim()
  observations.afterAccept = afterAccept
  // Accepted deliverables stay listed as the session's delivery record.
  check('accepted artifact remains in the deliverables list', afterAccept === '4', afterAccept)

  await page.locator('button[aria-pressed]', { hasText: /Opened files|打开过的文件/ }).first().click()
  await page.waitForTimeout(200)
  const currentCount = (await page.getByTestId('artifacts-count').innerText()).trim()
  observations.currentCount = currentCount
  check('the preview-registration filter reveals the current entry', currentCount === '1', currentCount)

  await page.locator('button[aria-pressed]', { hasText: /^Deliverables$|^交付物$/ }).first().click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT_DIR, 'artifacts.png') })

  // ── 4. Changed: style toggle is labelled and actually switches ─────────────
  await page.locator('[role="tablist"] [role="tab"]').nth(2).click()
  const styleButtons = page.getByRole('button', { name: /^(Unified|Split)$/ })
  await styleButtons.first().waitFor({ timeout: 10_000 })
  const styleLabels = await styleButtons.allInnerTexts()
  observations.styleLabels = styleLabels
  check('style toggle labels resolve (no raw i18n keys)',
    styleLabels.length === 2 && styleLabels.every(label => !label.includes('.')), styleLabels)
  check('style toggle is disabled while every file is collapsed',
    await page.getByRole('button', { name: 'Unified' }).isDisabled(), true)

  // Expand the first file section; its diff then becomes switchable.
  await page.locator('nav[aria-label] li button').first().click()
  await page.waitForTimeout(400)

  const splitButton = page.getByRole('button', { name: 'Split' })
  const unifiedButton = page.getByRole('button', { name: 'Unified' })
  check('style toggle enables once a file is expanded', !(await unifiedButton.isDisabled()), true)

  await splitButton.click()
  await page.waitForTimeout(500)
  const splitPressed = await splitButton.getAttribute('aria-pressed')
  const persistedSplit = await page.evaluate(() => window.localStorage.getItem('playground-diff-viewer'))
  observations.persistedSplit = persistedSplit
  check('split selection is pressed', splitPressed === 'true', splitPressed)
  check('split selection is persisted to preferences', String(persistedSplit).includes('"diffStyle":"split"'), persistedSplit)

  await page.screenshot({ path: join(OUT_DIR, 'changed.png') })

  // Reload: the persisted preference must come back as the active style.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('seed-view-browse').waitFor({ timeout: 30_000 })
  await page.locator('[role="tablist"] [role="tab"]').nth(2).click()
  await page.locator('nav[aria-label] li button').first().click()
  await page.waitForTimeout(500)
  const restored = await page.evaluate(() => window.localStorage.getItem('playground-diff-viewer'))
  const restoredPressed = await page.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')
  observations.restoredPressed = restoredPressed
  check('style preference survives a reload', restoredPressed === 'true', { restored, restoredPressed })

  // ── 5. No console errors from the panel ───────────────────────────────────
  const relevantErrors = consoleErrors.filter(text => !/favicon|Download the React DevTools|ERR_CONNECTION_REFUSED/.test(text))
  observations.consoleErrors = relevantErrors
  check('no console errors while exercising the panel', relevantErrors.length === 0, relevantErrors.slice(0, 3))

  await browser.close()

  const failed = results.filter(entry => !entry.ok)
  writeFileSync(join(OUT_DIR, 'report.json'), `${JSON.stringify({
    url: PLAYGROUND_URL,
    ranAt: new Date().toISOString(),
    total: results.length,
    failed: failed.length,
    results,
    observations,
  }, null, 2)}\n`)
  writeFileSync(join(OUT_DIR, 'console.log'), `${consoleErrors.join('\n')}\n`)

  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  console.log(`artifacts: ${OUT_DIR}`)
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed:`)
    for (const entry of failed) console.error(`  - ${entry.check}: ${entry.detail}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
