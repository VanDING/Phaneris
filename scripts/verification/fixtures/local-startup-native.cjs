const assert = require('node:assert/strict')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { _electron } = require('playwright')
const { firstBusinessWindow } = require('./electron-windows.cjs')

;(async () => {
  const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0',
    PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL', 'PHANERIS_SERVER_URL', 'PHANERIS_SERVER_TOKEN', 'PHANERIS_HEADLESS']) delete env[key]
  const started = Date.now()
  const app = await _electron.launch({ ...(fixture.executablePath ? { executablePath: fixture.executablePath, args: [] }
    : { args: [join(fixture.root, 'apps/electron')] }), cwd: fixture.root, env, timeout: 30000 })
  const errors = [], checks = [], samples = []
  let diagnostics = '', tracing = false, page
  app.process().stderr.on('data', data => { diagnostics += data.toString() })
  // Observe actual server frames before the business window starts requesting.
  // This changes no handler/client behavior and records no message content.
  await app.evaluate(() => {
    const net = process.getBuiltinModule('net'), original = net.Socket.prototype.write
    globalThis.startupRpc = []
    net.Socket.prototype.write = function(chunk, ...args) {
      const data = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : ''
      const start = data.indexOf('{"id"')
      if (start >= 0) {
        try {
          const value = JSON.parse(data.slice(start))
          if (value.type === 'response') globalThis.startupRpc.push({ channel: value.channel, at: Date.now(), error: value.error })
        } catch { /* Non-JSON or split network frame. */ }
      }
      return original.call(this, chunk, ...args)
    }
  })
  try {
    page = await firstBusinessWindow(app, { timeout: 60000 })
    page.on('pageerror', error => errors.push(error.message))
    await page.context().tracing.start({ screenshots: true, snapshots: true }); tracing = true
    const rows = page.locator('[data-session-id^="cold-history-"]')
    await rows.first().waitFor({ state: 'attached' })
    const capture = () => page.evaluate(() => [...document.querySelectorAll('[data-session-id^="cold-history-"]')].map(row => ({
      id: row.getAttribute('data-session-id'), icon: row.querySelector('button[aria-haspopup="menu"]')?.innerHTML,
      pending: !!row.querySelector('[data-icon-state]'),
    })))
    samples.push({ phase: 'first-mounted', elapsedMs: Date.now() - started, rows: await capture() })
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('[data-session-id^="cold-history-"]')]
      return rows.length > 0 && rows.every(row => row.querySelector('button[aria-haspopup="menu"] svg path')
        && !row.querySelector('[data-icon-state]'))
    }, null, { timeout: 10000 })
    samples.push({ phase: 'first-document-settled', elapsedMs: Date.now() - started, rows: await capture() })
    assert(samples[1].rows.every(row => !row.icon.includes('lucide-circle')))
    checks.push('640-completed-sessions-show-real-status-icons-without-navigation')
    await page.screenshot({ path: join(fixture.output, 'cold-startup.png') })
    const rpc = await app.evaluate(() => globalThis.startupRpc)
    assert(rpc.some(frame => frame.channel === 'sessions:get'), 'Observation must include the initial directory request')
    const permissions = rpc.filter(frame => frame.channel === 'sessions:getPermissionModeState')
    assert(permissions.length <= 2, `Unexpected history-wide permission reconciliation: ${permissions.length}`)
    checks.push('initial-server-frames-have-no-history-wide-permission-fanout')
    assert.equal((await page.evaluate(() => window.electronAPI.getSessions())).filter(session => session.id.startsWith('cold-history-')).length, 640)
    checks.push('native-directory-retains-all-completed-history')
    await page.waitForTimeout(1600)
    assert(!existsSync(join(fixture.workspace, 'runtime/backups')))
    checks.push('native-startup-does-not-create-runtime-backups')
    assert.deepEqual(errors, [])
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath }))
    assert.equal(identity.packaged, !!fixture.executablePath)
    checks.push('verified-runtime-matches-requested-source-or-package')
    writeFileSync(join(fixture.output, 'local-startup-native.json'), JSON.stringify({ checks, samples, rpc, identity, errors }, null, 2))
  } finally {
    if (tracing) await page.context().tracing.stop({ path: join(fixture.output, 'trace.zip') })
    writeFileSync(join(fixture.output, 'main.log'), diagnostics)
    await app.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
