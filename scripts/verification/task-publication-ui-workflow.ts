import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { startProcess, testSecret } from './fixtures/governance-process-support'
import { gotoWithRetry, launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'

declare global { interface Window { publicationToasts: string[] } }

// Actual production entry: board New Task -> TaskEditor -> WS publisher. A
// response fails after commit; retry must keep its id and one card. Fail-soft
// setup warnings must remain visible when the editor successfully closes.
await verificationWorkflow('task-publication-ui', async run => {
  const root = resolve(import.meta.dir, '../..'), config = join(run.directory, 'config'); mkdirSync(config, { recursive: true })
  const build = Bun.spawn([process.execPath, 'run', 'webui:build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
  writeFileSync(join(run.directory, 'build.log'), stdout + stderr); assert.equal(code, 0)
  const child = await startProcess({ config, entry: join(import.meta.dir, 'fixtures/planning-performance-server.ts'), extra: { PHANERIS_C02_SIZE: '10', PHANERIS_PUBLICATION_UI: '1' } })
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage(), errors: string[] = [], base = child.url.replace(/^ws/, 'http'), checks: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await context.addInitScript(() => {
      localStorage.setItem('i18nextLng', 'en'); window.publicationToasts = []
      const seen = new Set<string>()
      new MutationObserver(() => { for (const element of document.querySelectorAll('[data-sonner-toast]')) {
        const text = element.textContent ?? ''; if (text && !seen.has(text)) { seen.add(text); window.publicationToasts.push(text) }
      } }).observe(document, { childList: true, subtree: true, characterData: true })
    })
    assert((await context.request.post(base + '/api/auth', { data: { password: testSecret } })).ok())
    await gotoWithRetry(page, base + '/?route=kanban')
    await waitForBrowserCondition(page, async () => Boolean(window.electronAPI) && (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    await page.getByTestId('app-splash').waitFor({ state: 'hidden', timeout: 60_000 })
    await page.getByRole('button', { name: 'New Task', exact: true }).first().click()
    const editor = page.locator('[data-task-editor-overlay]')
    await editor.getByPlaceholder('Name this task…', { exact: true }).fill('Publication UI canary')
    await editor.getByPlaceholder('Describe the goal…', { exact: true }).fill('Create once without model execution')
    await editor.getByRole('button', { name: 'Add subtask', exact: true }).first().click()
    await editor.getByPlaceholder('Subtask title…', { exact: true }).fill('Only subtask')
    await editor.getByPlaceholder('Prompt — what this node should do. Reference an upstream output with ${nodes.<id>.output}.', { exact: true }).fill('Do not run in this workflow')
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    await page.getByText('Fixture response lost after committed publication', { exact: false }).first().waitFor()
    checks.push('real-editor-retains-input-after-postcommit-response-failure')
    // The retry button sits under the top-right toast; moving off it lets the
    // normal toast lifetime resume rather than keeping it hovered forever.
    await page.mouse.move(10, 950)
    await page.getByText('Fixture response lost after committed publication', { exact: false }).first().waitFor({ state: 'hidden', timeout: 20_000 })
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
    const response = await fetch(base + '/__planning', { method: 'POST', headers: { authorization: `Bearer ${testSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'metrics' }) })
    const facts = await response.json() as { taskPublications: Array<{ operationId: string; yaml: string }>; taskCards: Array<{ name: string; isProcessing: boolean; id: string }> }
    run.json('publication-facts.json', facts)
    assert.equal(facts.taskPublications.length, 2)
    assert(facts.taskPublications[0]!.operationId); assert.equal(facts.taskPublications[0]!.operationId, facts.taskPublications[1]!.operationId)
    assert.equal(facts.taskPublications[0]!.yaml, facts.taskPublications[1]!.yaml)
    assert.equal(facts.taskCards.filter(card => card.name === 'Publication UI canary').length, 1)
    assert(facts.taskCards.every(card => !card.isProcessing)); checks.push('editor-retry-keeps-operation-id-and-one-nonrunning-card')
    await page.getByText('The reserved Task label could not be applied.', { exact: false }).first().waitFor({ timeout: 10_000 })
    checks.push('fail-soft-publication-warning-remains-visible-after-close')
    await page.mouse.move(10, 950)
    await page.getByText('The reserved Task label could not be applied.', { exact: false }).first().waitFor({ state: 'hidden', timeout: 20_000 })
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route: 'kanban' } })))
    await page.getByRole('button', { name: 'New Task', exact: true }).first().click()
    await editor.getByRole('button', { name: 'Generate', exact: true }).click()
    await editor.getByPlaceholder('Describe the goal…', { exact: true }).fill('Generate a local draft for retry verification')
    await editor.getByRole('button', { name: 'Generate plan', exact: true }).click()
    await editor.getByPlaceholder('Name this task…', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[placeholder="Name this task…"]')?.value === 'Publication run canary')
    await editor.getByRole('button', { name: 'Create & Run', exact: true }).click()
    await page.getByText('Fixture run refused before execution', { exact: false }).first().waitFor()
    await page.mouse.move(10, 950)
    await page.locator('[data-sonner-toast][data-visible="true"]').first().waitFor({ state: 'hidden', timeout: 20_000 })
    await editor.getByRole('button', { name: 'Create & Run', exact: true }).click()
    await page.getByText('Fixture run refused before execution', { exact: false }).first().waitFor()
    const runResponse = await fetch(base + '/__planning', { method: 'POST', headers: { authorization: `Bearer ${testSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'metrics' }) })
    const runFacts = await runResponse.json() as typeof facts
    run.json('publication-run-retry.json', runFacts)
    assert.equal(runFacts.taskCards.filter(card => card.name === 'Publication run canary').length, 1)
    assert.equal(runFacts.taskPublications.at(-1)?.operationId, runFacts.taskPublications.at(-2)?.operationId)
    checks.push('adopted-draft-keeps-one-card-and-operation-after-run-refusal')
    await page.mouse.move(10, 950)
    await page.locator('[data-sonner-toast][data-visible="true"]').first().waitFor({ state: 'hidden', timeout: 20_000 })
    await editor.getByPlaceholder('Name this task…', { exact: true }).fill('Publication run revised')
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
    const revisedResponse = await fetch(base + '/__planning', { method: 'POST', headers: { authorization: `Bearer ${testSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'metrics' }) })
    const revised = await revisedResponse.json() as typeof facts
    run.json('publication-revised.json', revised)
    const revisedCard = revised.taskCards.find(card => card.name === 'Publication run revised')
    assert.equal(revisedCard?.id, runFacts.taskCards.find(card => card.name === 'Publication run canary')?.id)
    assert.equal(JSON.parse(revised.taskPublications.at(-1)!.yaml).id, 'publication-run-canary')
    assert.notEqual(revised.taskPublications.at(-1)!.operationId, revised.taskPublications.at(-2)!.operationId)
    assert.equal(revised.taskCards.length, 2)
    checks.push('editing-after-run-refusal-keeps-original-slug-and-card-with-new-intent-id')
    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(run.directory, 'publication-success.png') }); run.complete(checks, ['Production local WebUI/WS/Host; create only, no paid model or external account.'])
  } finally {
    await page.screenshot({ path: join(run.directory, 'publication-final.png') }).catch(() => {})
    run.json('browser-final.json', { errors, checks, toasts: await page.evaluate(() => window.publicationToasts).catch(() => []), url: page.url(), body: await page.locator('body').innerText().catch(() => '') })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') })
    writeFileSync(join(run.directory, 'server.log'), child.stdout() + child.stderr())
    await context.close(); await launched.close(); await child.stop()
  }
})
