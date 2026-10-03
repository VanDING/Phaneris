#!/usr/bin/env node
/**
 * Server end-to-end reachability check against a running instance.
 *
 * Verifies the transport layer that the dependency upgrades touch: the HTTP
 * surface that serves the built WebUI, and the `ws` authenticated RPC upgrade.
 * No credentials or model requests.
 *
 * Usage: node scripts/verification/verify-server-e2e.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const OUT_DIR = path.resolve(process.env.PHANERIS_UPGRADE_ARTIFACTS || path.join(ROOT, '.cache/dependency-upgrade-20261003'))
const PORT = Number(process.env.PHANERIS_RPC_PORT || 9311)
const HOST = process.env.PHANERIS_RPC_HOST || '127.0.0.1'
const TOKEN = process.env.PHANERIS_SERVER_TOKEN

const results = []
const record = (check, passed, detail) => results.push({ check, passed, ...(detail ? { detail } : {}) })

const PROTOCOL_VERSION = '1.0'

/**
 * The server accepts the WebSocket upgrade and authenticates in-band: the client
 * sends a `handshake` frame and waits for `handshake_ack`. An unauthenticated
 * socket is therefore expected to *open* and then be refused — asserting a
 * rejected upgrade would test something the server never promised.
 */
function handshake(token) {
  return new Promise(resolve => {
    const frames = []
    let settled = false
    const socket = new WebSocket(`ws://${HOST}:${PORT}/`)
    const finish = value => {
      if (settled) return
      settled = true
      try { socket.close() } catch { /* already closed */ }
      resolve({ ...value, frames })
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: `e2e-${Date.now()}`,
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        token,
      }))
    })
    socket.addEventListener('message', event => {
      let frame
      try { frame = JSON.parse(String(event.data)) } catch { return }
      frames.push(frame.type ?? frame)
      if (frame.type === 'handshake_ack') finish({ acked: true })
      else if (frame.type === 'error') finish({ acked: false, error: frame.error?.message })
    })
    socket.addEventListener('error', () => finish({ acked: false, error: 'socket error' }))
    socket.addEventListener('close', event => finish({ acked: false, code: event.code }))
    setTimeout(() => finish({ acked: false, timedOut: true }), 15_000).unref()
  })
}

async function main() {
  if (!TOKEN) throw new Error('PHANERIS_SERVER_TOKEN is required')

  // 1. Unauthenticated requests are gated behind the login page.
  const login = await fetch(`http://${HOST}:${PORT}/`)
  const loginHtml = await login.text()
  record('login-gate-served', login.status === 200 && /id="login-form"/.test(loginHtml), {
    status: login.status,
    bytes: loginHtml.length,
    title: (loginHtml.match(/<title>([^<]*)<\/title>/) || [])[1],
  })

  // 2. Wrong password must be refused.
  const badLogin = await fetch(`http://${HOST}:${PORT}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-token-that-is-long-enough' }),
  })
  record('wrong-password-refused', !badLogin.ok, { status: badLogin.status })

  // 3. The real token authenticates and the built WebUI is then served — this
  //    is the path the audit's container checklist calls "WebUI + auth".
  const goodLogin = await fetch(`http://${HOST}:${PORT}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: TOKEN }),
  })
  const cookie = goodLogin.headers.getSetCookie?.() ?? []
  record('valid-password-accepted', goodLogin.ok && cookie.length > 0, {
    status: goodLogin.status,
    cookies: cookie.map(c => c.split('=')[0]),
  })

  if (goodLogin.ok) {
    const app = await fetch(`http://${HOST}:${PORT}/`, {
      headers: { cookie: cookie.map(c => c.split(';')[0]).join('; ') },
    })
    const appHtml = await app.text()
    record('authenticated-webui-served', app.status === 200 && /<div id="root">/.test(appHtml), {
      status: app.status,
      bytes: appHtml.length,
      title: (appHtml.match(/<title>([^<]*)<\/title>/) || [])[1],
      assets: (appHtml.match(/assets\/[A-Za-z0-9_.-]+\.js/g) || []).slice(0, 4),
    })
  } else {
    record('authenticated-webui-served', false, { reason: 'no session cookie issued' })
  }

  // 4. A wrong token must be refused over the RPC socket.
  const wrong = await handshake('wrong-token-that-is-long-enough')
  record('wrong-token-refused', wrong.acked === false, wrong)

  // 5. The real token completes the RPC handshake, proving the upgraded `ws`
  //    transport and the RPC framing both work against this build.
  const valid = await handshake(TOKEN)
  record('valid-token-handshake', valid.acked === true, valid)

  const failed = results.filter(r => !r.passed)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, 'server-e2e.json'),
    JSON.stringify({ node: process.version, endpoint: `ws://${HOST}:${PORT}`, results }, null, 2) + '\n',
  )
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }))
  if (failed.length) process.exitCode = 1
}

main().catch(error => { console.error('server e2e failed:', error.message); process.exitCode = 1 })
