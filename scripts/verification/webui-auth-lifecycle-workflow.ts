/** A01–A11: actual standalone server processes, HTTP/WS and SQLite lock/restart. */
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { SignJWT } from 'jose'
import WebSocket from 'ws'
import { PROTOCOL_VERSION } from '@phaneris/shared/protocol'
import { spawnServer } from '../../apps/cli/src/server-spawner'
import { verificationWorkflow } from './verification-artifacts'
import { assertNoSecret, deadline, handshake, repository, seedServer, startProcess, testSecret, type RunningProcess } from './fixtures/governance-process-support'

await verificationWorkflow('webui-auth-lifecycle', async evidence => {
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-auth-lifecycle-'))
  const alpha = seedServer(join(fixture, 'alpha')), beta = seedServer(join(fixture, 'beta'))
  const children: RunningProcess[] = [], checks: { id: string; passed: true }[] = []
  const cookies: string[] = []
  const start = async (config = alpha, extra: Record<string, string> = {}) => {
    const child = await startProcess({ ...config, extra }); children.push(child); return child
  }
  const record = (id: string) => { checks.push({ id, passed: true }) }
  const http = (child: RunningProcess) => child.url.replace(/^ws/, 'http')
  const login = async (child: RunningProcess, headers: Record<string, string> = {}) => {
    const response = await fetch(`${http(child)}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ password: testSecret }) })
    assert.equal(response.status, 200)
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    cookies.push(cookie.split('=')[1]!); return cookie
  }
  const status = async (child: RunningProcess, cookie: string) => (await fetch(`${http(child)}/api/config`, { headers: { cookie } })).status
  const logout = (child: RunningProcess, cookie: string) => fetch(`${http(child)}/api/auth/logout`, { method: 'POST', headers: { cookie } })
  let lock: Database | undefined
  try {
    let server = await start()
    const revoked = await login(server), live = await login(server)
    assert.equal((await logout(server, revoked)).status, 204)
    assert.equal(await status(server, revoked), 401)
    await server.stop('SIGKILL')
    server = await start()
    assert.equal(await status(server, revoked), 401, 'Logout must survive a real process kill/restart')
    assert.equal(await status(server, live), 200)
    assert(!(await handshake(server.url, { cookie: revoked, origin: http(server) })).accepted)
    record('A01-logout-kill-restart')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const last = revoked.at(-1)!
    const variant = revoked.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1]
    assert.notEqual(variant, revoked)
    assert.deepEqual(Buffer.from(variant.split('.').at(-1)!, 'base64url'), Buffer.from(revoked.split('.').at(-1)!, 'base64url'))
    assert.equal(await status(server, variant), 401, 'Equivalent JWT signature spellings cannot bypass logout')
    record('A12-canonical-token-replay')

    const shared = await startProcess({ ...alpha, entry: join(import.meta.dir, 'fixtures/webui-auth-peer.ts'),
      extra: { GOVERNANCE_REVOCATIONS: join(alpha.config, 'security/webui-auth.sqlite') } })
    children.push(shared)
    const sharedCookie = await login(shared)
    assert.equal((await logout(server, sharedCookie)).status, 204)
    assert.equal(await status(shared, sharedCookie), 401)
    record('A02-shared-process-revocation')
    const isolated = await start(beta)
    assert.equal(await status(isolated, revoked), 200)
    record('A03-config-directory-isolation')
    const legacy = new SignJWT({ sub: 'webui' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    const legacyCookie = `craft_session=${await legacy.sign(new TextEncoder().encode(testSecret))}`
    cookies.push(legacyCookie.split('=')[1]!)
    assert.equal(await status(server, legacyCookie), 200)
    assert.equal((await logout(server, legacyCookie)).status, 204)
    await server.stop('SIGKILL'); server = await start()
    assert.equal(await status(server, legacyCookie), 401)
    assert.equal(await status(server, live.replace('phaneris_session=', 'craft_session=')), 200)
    record('A04-legacy-cookie-without-jti')

    for (const origin of ['https://attacker.example', '', 'null', 'http://[invalid', `${http(server)}/path`]) {
      assert(!(await handshake(server.url, { cookie: live, ...(origin ? { origin } : {}) })).accepted, `Invalid cookie origin accepted: ${origin}`)
    }
    assert((await handshake(server.url, { cookie: live, origin: http(server) })).accepted)
    assert((await handshake(server.url, {}, testSecret)).accepted)
    record('A07-cookie-origin-and-bearer')
    const trusted = await start(seedServer(join(fixture, 'trusted')), { PHANERIS_TRUSTED_PROXIES: '127.0.0.1', PHANERIS_WEBUI_ALLOWED_ORIGINS: 'https://explicit.example:9443' })
    const trustedCookie = await login(trusted)
    const proxyHeaders = { cookie: trustedCookie, origin: 'https://proxy.example', 'x-forwarded-host': 'proxy.example', 'x-forwarded-proto': 'https' }
    assert((await handshake(trusted.url, proxyHeaders)).accepted)
    assert(!(await handshake(isolated.url, proxyHeaders)).accepted)
    assert((await handshake(trusted.url, { cookie: trustedCookie, origin: 'https://explicit.example:9443' })).accepted)
    assert(!(await handshake(trusted.url, { cookie: trustedCookie, origin: 'https://explicit.example:9444' })).accepted)
    const proxyConfig = await fetch(`${http(trusted)}/api/config`, { headers: proxyHeaders })
    assert.equal((await proxyConfig.json() as { wsUrl: string }).wsUrl, `ws://proxy.example:${new URL(trusted.url).port}`)
    const directConfig = await fetch(`${http(isolated)}/api/config`, { headers: proxyHeaders })
    assert.equal((await directConfig.json() as { wsUrl: string }).wsUrl, isolated.url)
    const secureCookie = await fetch(`${http(trusted)}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json', ...proxyHeaders }, body: JSON.stringify({ password: testSecret }) })
    assert(secureCookie.headers.get('set-cookie')?.includes('Secure'))
    record('A08-explicit-origin-trusted-proxy')
    record('A13-ephemeral-ws-address')
    const socketCookie = await login(server)
    const socket = new WebSocket(server.url, { headers: { cookie: socketCookie, origin: http(server) } })
    const nextMessage = () => deadline(new Promise<{ type: string; error?: { code: string } }>((resolveMessage, reject) => {
      socket.once('message', data => resolveMessage(JSON.parse(data.toString())))
      socket.once('error', reject)
    }), 5000)
    try {
      await deadline(new Promise<void>((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject) }))
      const ack = nextMessage()
      socket.send(JSON.stringify({ id: 'existing-socket', type: 'handshake', protocolVersion: PROTOCOL_VERSION }))
      assert.equal((await ack).type, 'handshake_ack')
      assert.equal((await logout(server, socketCookie)).status, 204)
      const response = nextMessage()
      socket.send(JSON.stringify({ id: 'after-logout', type: 'request', channel: 'server:getStatus', args: [] }))
      assert.equal((await response).error?.code, 'AUTH_FAILED')
    } finally { socket.terminate() }
    record('A14-existing-socket-revocation')

    const bad = async (child: RunningProcess, ip: string) => (await fetch(`${http(child)}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ password: 'incorrect' }) })).status
    for (let i = 0; i < 5; i++) assert.equal(await bad(trusted, '192.0.2.10'), 401)
    assert.equal(await bad(trusted, '192.0.2.10'), 429)
    await login(trusted, { 'x-forwarded-for': '192.0.2.11' })
    for (let i = 0; i < 15; i++) assert.equal(await bad(trusted, `192.0.2.${20 + i}`), 401)
    assert.equal(await bad(trusted, '192.0.2.99'), 429)
    for (let i = 0; i < 5; i++) assert.equal(await bad(isolated, `198.51.100.${i}`), 401)
    assert.equal(await bad(isolated, '198.51.100.99'), 429)
    record('A09-actual-proxy-failure-budgets')

    const chunkedStatus = await deadline(new Promise<number>((resolveStatus, reject) => {
      const req = request(`${http(server)}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
        res.resume(); res.on('end', () => resolveStatus(res.statusCode ?? 0))
      })
      req.on('error', reject)
      for (let i = 0; i < 20; i++) req.write(Buffer.alloc(16 * 1024, 32))
      req.end()
    }))
    assert.equal(chunkedStatus, 413)
    await login(server)
    record('A10-chunked-request-ceiling')

    const pending = await login(server)
    lock = new Database(join(alpha.config, 'security/webui-auth.sqlite'))
    lock.exec('BEGIN IMMEDIATE')
    const failedLogout = await logout(server, pending)
    assert.equal(failedLogout.status, 503)
    assert.equal(failedLogout.headers.get('set-cookie'), null)
    assert.equal(await status(server, live), 503)
    assert((await handshake(server.url, {}, testSecret)).accepted)
    lock.exec('ROLLBACK'); lock.close(); lock = undefined
    await server.stop('SIGKILL'); server = await start()
    assert.equal(await status(server, revoked), 401)
    assert.equal(await status(server, pending), 200, 'Uncommitted logout must be explicitly retried')
    assert.equal((await logout(server, pending)).status, 204)
    record('A05-storage-failure-no-false-logout')
    const corrupt = seedServer(join(fixture, 'corrupt'))
    mkdirSync(join(corrupt.config, 'security'))
    const corruptFile = join(corrupt.config, 'security/webui-auth.sqlite')
    writeFileSync(corruptFile, 'corrupt-revocations-must-be-preserved')
    const rejected = await startProcess({ ...corrupt, ready: false }); children.push(rejected)
    assert.notEqual(await deadline(rejected.exited), 0)
    assert(!rejected.url)
    assert.equal(readFileSync(corruptFile, 'utf8'), 'corrupt-revocations-must-be-preserved')
    record('A06-corrupt-store-startup-fails')

    const cliConfig = seedServer(join(fixture, 'cli'))
    const cli = await deadline(spawnServer({ quiet: true, env: {
      PHANERIS_CONFIG_DIR: cliConfig.config, PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_PRINT_SERVER_TOKEN: '0',
      PHANERIS_BUNDLED_ASSETS_ROOT: join(repository, 'apps/electron'), PHANERIS_WEBUI_DIR: '',
    } }))
    try { assert((await handshake(cli.url, {}, cli.token)).accepted) } finally { await cli.stop() }
    assertNoSecret(children, [testSecret, ...cookies])
    record('A11-server-cli-token-private')
    evidence.complete(checks.map(check => check.id), ['native Windows/Linux', 'real remote TLS proxy', 'signed installer', 'native browser cookie/SameSite policy'])
  } finally {
    if (lock) { lock.exec('ROLLBACK'); lock.close() }
    await Promise.allSettled(children.map(child => child.stop('SIGKILL')))
    assertNoSecret(children, [testSecret, ...cookies])
    const dbPath = join(alpha.config, 'security/webui-auth.sqlite')
    let rows: unknown[] = []
    // A pre-storage implementation failure must retain its original assertion.
    if (existsSync(dbPath)) {
      const db = new Database(dbPath)
      rows = db.query('SELECT scope,token_hash,expires_at FROM session_revocations').all()
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close()
      copyFileSync(dbPath, join(evidence.directory, 'session-revocations.sqlite'))
    }
    evidence.json('webui-auth-lifecycle.json', { fixture, checks, revocationRecords: rows, processes: children.map(child => ({ pid: child.process.pid, exitCode: child.process.exitCode, signal: child.process.signalCode })) })
    children.forEach((child, index) => writeFileSync(join(evidence.directory, `server-${index}.log`), `${child.stdout()}\n${child.stderr()}`))
  }
})
