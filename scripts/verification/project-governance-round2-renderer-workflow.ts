import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('project-governance-round2-renderer', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'profile')
  mkdirSync(process.env.PHANERIS_CONFIG_DIR, { recursive: true })
  const root = join(import.meta.dir, '../..')
  await build({ entryPoints: [join(import.meta.dir, 'fixtures/governance-round2-hooks.tsx')], outfile: join(run.directory, 'hooks.js'),
    bundle: true, platform: 'browser', format: 'esm', target: 'esnext', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': join(root, 'apps/electron/src/renderer') } })
  const host = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/hooks.js' ? new Response(Bun.file(join(run.directory, 'hooks.js')))
      : new Response('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/hooks.js"></script>', { headers: { 'content-type': 'text/html' } })
  } })
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
  const checks: Array<{ id: string; pass: boolean; state?: unknown; error?: string }> = []
  const context = await browser.newContext()
  await context.tracing.start({ screenshots: true, snapshots: true })
  const frames = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const read = (page: Page) => page.evaluate(() => (window as any).audit.state) as Promise<Record<string, any>>
  const check = async (id: string, fn: (page: Page) => Promise<void>, rpcUrl?: string) => {
    const page = await context.newPage()
    try {
      if (rpcUrl) await page.addInitScript(url => { (window as any).__R2_RPC_URL = url }, rpcUrl)
      await page.goto(`http://127.0.0.1:${host.port}`)
      if (!rpcUrl) await page.waitForFunction(() => (window as any).audit?.pending().length === 3)
      await fn(page); checks.push({ id, pass: true, state: await read(page) })
    } catch (error) { checks.push({ id, pass: false, state: await read(page).catch(() => null), error: String(error) }) }
    finally { await page.screenshot({ path: join(run.directory, id + '.png') }); await page.close(); run.json('checks.json', checks) }
  }
  const assertMarker = async (page: Page, marker: string) => {
    await frames(page)
    const state = await read(page)
    for (const kind of ['pages', 'projects', 'automations']) {
      assert.deepEqual(state[kind], [marker], kind); assert.deepEqual(state.atoms[kind], [marker], kind + ' atom')
    }
  }
  try {
    for (const reject of [false, true]) await check(reject ? 'F02-old-workspace-error' : 'F01-old-workspace-success', async page => {
      await page.evaluate(() => (window as any).audit.select('B'))
      await page.waitForFunction(() => (window as any).audit.pending().filter((p: any) => p.ws === 'B').length === 3)
      await page.evaluate(() => (window as any).audit.settle('B', 'B-current'))
      await assertMarker(page, 'B-current')
      await page.evaluate(reject => (window as any).audit.settle('A', 'A-stale', reject), reject)
      await assertMarker(page, 'B-current')
    })
    await check('F03-same-workspace-newest-refresh', async page => {
      await page.evaluate(() => (window as any).audit.refresh())
      await page.waitForFunction(() => (window as any).audit.pending().length === 6)
      await page.evaluate(() => (window as any).audit.settle('A', 'newest', false, true))
      await assertMarker(page, 'newest')
      await page.evaluate(() => (window as any).audit.settle('A', 'stale'))
      await assertMarker(page, 'newest')
    })
    await check('F04-push-invalidates-old-read', async page => {
      await page.evaluate(() => (window as any).audit.push('A', 'push-new'))
      await page.waitForFunction(() => (window as any).audit.state.pages[0] === 'push-new')
      await page.evaluate(() => (window as any).audit.settle('A', 'read-old')); await frames(page)
      const state = await read(page)
      for (const kind of ['pages', 'projects']) { assert.deepEqual(state[kind], ['push-new']); assert.deepEqual(state.atoms[kind], ['push-new']) }
    })
    await check('F05-clear-workspace', async page => {
      await page.evaluate(() => (window as any).audit.settle('A', 'loaded')); await assertMarker(page, 'loaded')
      await page.evaluate(() => (window as any).audit.select(null)); await frames(page)
      const state = await read(page)
      for (const kind of ['pages', 'projects', 'automations']) { assert.deepEqual(state[kind], []); assert.deepEqual(state.atoms[kind], []) }
    })
    await check('F06-unmount-old-request-cannot-pollute-shared-atoms', async page => {
      await page.evaluate(() => (window as any).audit.unmount()); await frames(page)
      await page.evaluate(() => (window as any).audit.mount('B'))
      await page.waitForFunction(() => (window as any).audit.pending().filter((p: any) => p.ws === 'B').length === 3)
      await page.evaluate(() => (window as any).audit.settle('B', 'B-current')); await assertMarker(page, 'B-current')
      await page.evaluate(() => (window as any).audit.settle('A', 'unmounted-A')); await assertMarker(page, 'B-current')
    })
    await check('F07-pages-id-slug-notification-refetch', async page => {
      await page.evaluate(() => (window as any).audit.settle('A', 'loaded')); await assertMarker(page, 'loaded')
      await page.evaluate(() => (window as any).audit.push('config-id', 'not-directly-used'))
      await page.waitForFunction(() => (window as any).audit.pending().some((p: any) => p.kind === 'pages'))
      await page.evaluate(() => (window as any).audit.settle('A', 'refetched')); await frames(page)
      assert.deepEqual((await read(page)).pages, ['refetched'])
    })

    const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
    const { registerPagesHandlers } = await import('../../packages/server-core/src/handlers/rpc/pages')
    const { registerProjectsHandlers } = await import('../../packages/server-core/src/handlers/rpc/projects')
    const { registerAutomationsHandlers } = await import('../../packages/server-core/src/handlers/rpc/automations')
    const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
    const { createPage } = await import('../../packages/shared/src/pages/storage')
    const { createProject } = await import('../../packages/shared/src/projects/storage')
    const workspaces = ['a', 'b'].map(id => ({ id, name: id, rootPath: join(run.directory, id), createdAt: 1 }))
    for (const ws of workspaces) {
      createPage(ws.rootPath, { name: ws.id }); createProject(ws.rootPath, { name: ws.id })
      writeFileSync(join(ws.rootPath, 'automations.json'), JSON.stringify({ version: 2, automations: { SessionStart: [{ id: ws.id, name: ws.id, actions: [{ type: 'prompt', prompt: 'synthetic' }] }] } }))
    }
    writeFileSync(join(process.env.PHANERIS_CONFIG_DIR, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'a', llmConnections: [], setupDeferred: true }))
    const platform = createHeadlessPlatform(); platform.logger = { info() {}, debug() {}, warn() {}, error() {} }
    const rpc = new WsRpcServer({ port: 0 })
    const deps = { platform, sessionManager: { notifyConfigFileChange() {}, enqueuePageThumbnail() {} } } as unknown as Parameters<typeof registerPagesHandlers>[1]
    registerPagesHandlers(rpc, deps); registerProjectsHandlers(rpc, deps); registerAutomationsHandlers(rpc, deps); await rpc.listen()
    try {
      await check('F08-production-hooks-real-rpc-read-and-push', async page => {
        await page.waitForFunction(() => (window as any).audit?.state.automations[0] === 'a')
        await assertMarker(page, 'a')
        await page.evaluate(() => (window as any).audit.createRpcPage('rpc-push'))
        await page.waitForFunction(() => (window as any).audit.state.pages.some((name: string) => name === 'rpc-push'))
        assert((await read(page)).atoms.pages.includes('rpc-push'))
        await page.evaluate(() => (window as any).audit.select('b'))
        await page.waitForFunction(() => (window as any).audit.state.automations[0] === 'b'); await assertMarker(page, 'b')
      }, `ws://127.0.0.1:${rpc.port}`)
    } finally { rpc.close() }
  } finally { await context.tracing.stop({ path: join(run.directory, 'renderer-trace.zip') }); await browser.close(); host.stop(true) }
  run.json('checks.json', checks); run.json('browser.json', { version: browser.version(), productionReact: true, realRpc: true })
  assert(checks.every(c => c.pass), JSON.stringify(checks.filter(c => !c.pass)))
  run.complete(checks.map(c => c.id), ['Physical mobile/IME', 'Other browsers/OS', 'Full production AppShell styling'])
})
