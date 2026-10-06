/**
 * Files panel in the actual packaged app.
 *
 * `scripts/verify-files-panel-e2e.ts` proves the panel against fixtures in the
 * playground; this proves the same panel inside the shipped bundle — the real
 * main process, the real preload, the real renderer build, a real session
 * directory on disk and a disposable profile.
 *
 * What it can and cannot see: the renderer build either contains the new Files
 * views or it does not, and a stale bundle is exactly the failure this catches.
 * Session transcripts are deliberately NOT seeded: a session snapshot is
 * server-authored (snapshot-encoded messages behind a versioned header), and a
 * hand-written JSONL is rejected as incomplete. The assertions therefore stay
 * on what a packaged bundle alone can prove — the new views exist, resolve
 * their localized labels, and Browse reads the real work folder off disk.
 *
 * Usage:
 *   bun run scripts/verification/files-panel-packaged-workflow.ts \
 *     --app="$PWD/apps/electron/release/mac/Phaneris.app" \
 *     --output="$PWD/.verify/files-panel-packaged"
 */

import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const root = resolve(import.meta.dir, '../..')
const arg = (name: string): string | undefined => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const output = resolve(arg('output') ?? join(root, '.verify/files-panel-packaged'))
mkdirSync(output, { recursive: true })

const app = resolve(arg('app') ?? join(root, 'apps/electron/release/mac/Phaneris.app'))
const fixture = mkdtempSync(join(output, 'profile-'))
const workspace = join(fixture, 'workspace')
const workingDirectory = join(fixture, 'work')
mkdirSync(workspace, { recursive: true })
mkdirSync(workingDirectory, { recursive: true })

// A work folder with real contents, so Browse has a tree rather than an empty
// state (the tree is read from disk by the real main process).
writeFileSync(join(workingDirectory, 'README.md'), '# Packaged fixture\n')
mkdirSync(join(workingDirectory, 'src'), { recursive: true })
writeFileSync(join(workingDirectory, 'src', 'index.ts'), 'export const answer = 42\n')

process.env.PHANERIS_CONFIG_DIR = fixture

const { createSession } = await import('../../packages/shared/src/sessions/storage')
const session = await createSession(workspace, {
  name: 'Files panel fixture',
  workingDirectory,
  permissionMode: 'ask',
})

// No provider is needed: every assertion below is renderer-only and never
// sends a message. `setupDeferred` keeps onboarding out of the way.
writeFileSync(join(workspace, 'config.json'), JSON.stringify({
  id: 'packaged-files',
  name: 'Packaged Files',
  defaults: { permissionMode: 'ask' },
}))
writeFileSync(join(fixture, 'config.json'), JSON.stringify({
  setupDeferred: true,
  workspaces: [{ id: 'packaged-files', name: 'Packaged Files', rootPath: workspace, createdAt: Date.now() }],
  activeWorkspaceId: 'packaged-files',
  activeSessionId: session.id,
  colorTheme: 'default',
  themeMode: 'light',
}))

const records: Array<{ id: string; pass: boolean; error?: string }> = []
const pageErrors: string[] = []
async function check(id: string, action: () => Promise<void>) {
  try {
    await action()
    records.push({ id, pass: true })
  } catch (error) {
    records.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) })
  }
}

const env: NodeJS.ProcessEnv = { ...process.env, PHANERIS_CONFIG_DIR: fixture, PHANERIS_WORKSPACE_ID: 'packaged-files' }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

let application: Awaited<ReturnType<typeof _electron.launch>> | undefined
try {
  application = await _electron.launch({
    executablePath: join(app, 'Contents/MacOS/Phaneris'),
    args: ['--disable-gpu'],
    env,
    timeout: 60_000,
  })
  const page = await application.firstWindow()
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof (window as any).electronAPI?.getSessionFiles === 'function')
  await page.waitForTimeout(1500)

  // Open the session, then the Files workbench through the app's own route.
  await page.evaluate(sessionId => {
    window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route: `allSessions/session/${sessionId}` }, bubbles: true }))
  }, session.id)
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route: 'files' }, bubbles: true }))
  })

  // The packaged client starts in the persisted UI language (zh-Hans in this
  // profile). Assert the labels by translation key rather than by English
  // spelling, so the workflow keeps passing under any locale.
  // i18next persists the code as a bare string (no JSON quotes).
  const storedLanguage = await page.evaluate(() => window.localStorage.getItem('i18nextLng'))
  const locale = (storedLanguage ?? 'zh-Hans').replaceAll('"', '')
  const en = (await import('../../packages/shared/src/i18n/locales/en.json', { with: { type: 'json' } })).default as Record<string, string>
  const zh = (await import('../../packages/shared/src/i18n/locales/zh-Hans.json', { with: { type: 'json' } })).default as Record<string, string>
  const messages = locale.startsWith('zh') ? zh : en
  const expectLabel = (key: string): string => {
    const value = messages[key]
    assert.ok(value, `no ${locale} translation for ${key}`)
    return value
  }

  // The workbench shell renders its own tab strip; the Files sub-views are the
  // second tablist on the panel.
  const tabs = page.locator('[role="tablist"]').last().locator('[role="tab"]')
  await check('packaged app opens the Files workbench', async () => {
    await tabs.first().waitFor({ timeout: 30_000 })
  })

  await check('packaged Files panel ships the three consolidated views', async () => {
    const labels = await tabs.allInnerTexts()
    assert.deepEqual(labels, [
      expectLabel('contentPanel.files.view.browse'),
      expectLabel('contentPanel.files.view.artifacts'),
      expectLabel('contentPanel.files.view.changed'),
    ])
  })

  await check('packaged Browse renders the working directory and session roots', async () => {
    const roots = await page.locator('nav[aria-label] button[aria-expanded]').evaluateAll(nodes => nodes
      .filter(node => !node.closest('nav')?.parentElement?.closest('.group\\/section'))
      .map(node => (node.querySelector('span.flex-1')?.textContent ?? '').trim()))
    assert.equal(roots.length, 2, `expected 2 roots, saw ${JSON.stringify(roots)}`)
    assert.ok(roots.includes('work'), `working-directory root missing: ${JSON.stringify(roots)}`)
  })

  await check('packaged Browse lists real files from the work folder', async () => {
    // The working root starts expanded, so its top-level entries are visible.
    const names = await page.locator('nav[aria-label] button').evaluateAll(nodes => nodes
      .map(node => (node.querySelector('span.flex-1')?.textContent ?? '').trim()))
    assert.ok(names.includes('README.md'), `README.md not listed: ${JSON.stringify(names)}`)
    assert.ok(names.includes('src'), `src/ not listed: ${JSON.stringify(names)}`)
  })

  // Message-driven views are out of reach here on purpose: a session snapshot
  // is server-authored (snapshot-encoded messages behind a versioned header),
  // so this fixture has no transcript to diff. The diff toolbar itself is
  // covered by scripts/verify-files-panel-e2e.ts; what this workflow adds is
  // that the packaged renderer resolves the localized label for the view.
  await check('packaged Changed view renders its empty state with a resolved label', async () => {
    await tabs.nth(2).click()
    await page.waitForTimeout(1500)
    const body = await page.locator('body').innerText()
    assert.ok(body.includes(expectLabel('contentPanel.diff.noChanges')), `changed view did not render: ${body.slice(0, 200)}`)
  })

  await tabs.first().click()
  await page.screenshot({ path: join(output, 'packaged-files-browse.png') })
} catch (error) {
  records.push({ id: 'packaged app launch', pass: false, error: error instanceof Error ? error.stack : String(error) })
} finally {
  await application?.close().catch(() => {})
}

const failed = records.filter(record => !record.pass)
writeFileSync(join(output, 'packaged-files.json'), `${JSON.stringify({
  app,
  fixture,
  sessionId: session.id,
  ranAt: new Date().toISOString(),
  records,
  pageErrors,
}, null, 2)}\n`)

for (const record of records) console.log(`${record.pass ? 'PASS' : 'FAIL'}  ${record.id}${record.pass ? '' : `\n      ${record.error?.split('\n')[0]}`}`)
console.log(`\n${records.length - failed.length}/${records.length} checks passed — ${output}`)
if (pageErrors.length > 0) {
  console.log('\nrenderer page errors:')
  for (const error of pageErrors.slice(0, 5)) console.log(`  - ${error}`)
}
process.exit(failed.length > 0 || pageErrors.length > 0 ? 1 : 0)
