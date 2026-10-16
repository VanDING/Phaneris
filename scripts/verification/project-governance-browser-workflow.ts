import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('project-governance-browser', async run => {
  const root = resolve(import.meta.dir, '../..')
  const { browser, close } = await launchWorkflowBrowser()
  const checks: Array<{ id: string; pass: boolean; error?: string }> = []
  const check = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push({ id, pass: true }) }
    catch (error) { checks.push({ id, pass: false, error: String(error).slice(0, 1500) }) }
    run.json('checks.json', checks)
  }
  const viewer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname
    const file = path.startsWith('/s/assets/') ? join(root, 'apps/viewer/dist', path.slice(3)) : join(root, 'apps/viewer/dist/index.html')
    return new Response(Bun.file(file))
  } })
  const fixture = (id: string) => ({ id, name: 'VERIFY_SESSION_' + id, workspaceId: 'fixture', createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'message-' + id, type: 'user', content: 'CONTENT_' + id, timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  try {
    for (const [id, status, clear] of [
      ['V01-older-success-cannot-overwrite-new-session', 200, false],
      ['V01-older-not-found-cannot-overwrite-new-session', 404, false],
      ['V02-clear-cancels-old-request-and-shows-upload', 200, true],
    ] as const) await check(id, async () => {
      const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } })
      const requested = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), completed = Promise.withResolvers<void>()
      await context.tracing.start({ screenshots: true, snapshots: true })
      try {
        const page = await context.newPage()
        await page.addInitScript(() => {
          const state = window as unknown as { governanceFetchSettled: Record<string, boolean> }
          state.governanceFetchSettled = {}
          const original = window.fetch.bind(window)
          Object.defineProperty(window, 'fetch', { configurable: true, value: async (...args: Parameters<typeof fetch>) => {
            try { return await original(...args) }
            finally { state.governanceFetchSettled[String(args[0])] = true }
          } })
        })
        await page.route('**/s/api/*', async route => {
          const name = new URL(route.request().url()).pathname.split('/').at(-1)!
          if (name === 'A') { requested.resolve(); await release.promise }
          try { await route.fulfill({ status: name === 'A' ? status : 200, json: fixture(name) }) }
          finally { if (name === 'A') completed.resolve() }
        })
        await page.goto(`http://127.0.0.1:${viewer.port}/s/A`, { waitUntil: 'domcontentloaded' })
        await requested.promise
        await page.evaluate(() => { history.pushState({}, '', '/s/B'); dispatchEvent(new PopStateEvent('popstate')) })
        await page.getByText('VERIFY_SESSION_B', { exact: true }).first().waitFor()
        if (clear) await page.getByRole('button', { name: /clear session/i }).click()
        release.resolve()
        await completed.promise
        await page.waitForFunction(() => (window as unknown as { governanceFetchSettled: Record<string, boolean> }).governanceFetchSettled['/s/api/A'])
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.equal(await page.evaluate(() => location.pathname), clear ? '/' : '/s/B')
        if (clear) {
          assert(!(await page.locator('body').innerText()).includes('VERIFY_SESSION_A'))
          assert(!(await page.locator('body').innerText()).includes('Loading session...'))
        } else {
          assert((await page.locator('header').innerText()).includes('VERIFY_SESSION_B'))
          assert((await page.locator('body').innerText()).includes('CONTENT_B'))
        }
        await page.screenshot({ path: join(run.directory, id + '.png') })
      } finally {
        release.resolve()
        await context.tracing.stop({ path: join(run.directory, id + '.trace.zip') })
        await context.close()
      }
    })

    const config = join(run.directory, 'webui-profile')
    mkdirSync(config)
    const token = 'governance-' + crypto.randomUUID(), logs: string[] = []
    const server = spawn(process.execPath, [join(root, 'scripts/performance/server.ts')], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_PERF_TOKEN: token, PHANERIS_PERF_PROFILE: 'smoke' },
    })
    const exited = new Promise(resolve => server.once('exit', resolve))
    try {
      const ready = await new Promise<{ port: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebUI fixture startup timed out')), 45000)
        createInterface({ input: server.stdout! }).on('line', line => {
          logs.push(line)
          if (line.startsWith('PERF_READY ')) { clearTimeout(timer); resolve(JSON.parse(line.slice(11))) }
        })
        createInterface({ input: server.stderr! }).on('line', line => logs.push(line))
        server.once('error', error => { clearTimeout(timer); reject(error) })
        server.once('exit', code => { clearTimeout(timer); reject(new Error('WebUI fixture exited ' + code)) })
      })
      const origin = `http://127.0.0.1:${ready.port}`
      for (const kind of ['chunk', 'render'] as const) await check('W01-' + kind + '-error-fallback-and-reload-recovery', async () => {
        const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } })
        await context.tracing.start({ screenshots: true, snapshots: true })
        try {
          assert((await context.request.post(origin + '/api/auth', { data: { password: token } })).ok())
          const page = await context.newPage(), pattern = /\/assets\/App-[^/]+\.js$/
          await page.route(pattern, route => route.fulfill(kind === 'chunk'
            ? { status: 503, body: 'Synthetic chunk failure', contentType: 'text/plain' }
            : { status: 200, body: 'export default function SyntheticRenderFailure(){throw new Error("Synthetic render failure")}', contentType: 'text/javascript' }))
          await page.goto(origin + '/?route=allSessions/session/perf-000', { waitUntil: 'domcontentloaded' })
          const reload = page.getByRole('button', { name: 'Reload', exact: true })
          await reload.waitFor({ timeout: 10000 })
          await page.screenshot({ path: join(run.directory, kind + '-fallback.png') })
          await page.unroute(pattern)
          await reload.click()
          await page.waitForFunction(() => document.body.innerText.includes('PERF_END_perf-000'), undefined, { timeout: 30000 })
          assert.equal(await page.getByRole('button', { name: 'Reload', exact: true }).count(), 0)
          await page.screenshot({ path: join(run.directory, kind + '-recovered.png') })
        } finally {
          await context.tracing.stop({ path: join(run.directory, kind + '.trace.zip') })
          await context.close()
        }
      })
    } finally { server.kill('SIGTERM'); await exited; writeFileSync(join(run.directory, 'webui-server.log'), logs.join('\n')) }
  } finally { viewer.stop(true); await close() }
  assert(checks.every(check => check.pass), JSON.stringify(checks.filter(check => !check.pass)))
  run.complete(checks.map(check => check.id), ['Native IME/touch', 'Other browsers/operating systems', 'Live provider APIs'])
})
