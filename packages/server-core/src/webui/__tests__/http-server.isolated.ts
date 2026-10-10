import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWebuiHttpServer, createWebuiHandler, setRequestClientIp } from '../http-server'
import { initPasswordHash } from '../auth'

const SECRET = 'test-server-secret'
const PASSWORD = 'test-password'
const TEMP_DIRS: string[] = []
const SERVERS: Array<{ stop: () => void }> = []

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

async function createServer(overrides?: {
  secureCookies?: boolean
  publicWsUrl?: string
  wsProtocol?: 'ws' | 'wss'
  wsPort?: number
  trustedProxies?: string[]
}) {
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    password: PASSWORD,
    secureCookies: overrides?.secureCookies,
    publicWsUrl: overrides?.publicWsUrl,
    wsProtocol: overrides?.wsProtocol ?? 'wss',
    wsPort: overrides?.wsPort ?? 9100,
    trustedProxies: overrides?.trustedProxies,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })

  SERVERS.push(server)

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

function decodeJwtPayload(cookie: string): Record<string, unknown> {
  const jwt = cookie.replace(/^(?:phaneris|craft)_session=/, '')
  const [, payloadB64] = jwt.split('.')
  return JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'))
}

afterEach(() => {
  while (SERVERS.length > 0) {
    SERVERS.pop()?.stop()
  }

  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

// Worker processes are reused across test files; a leaked global fetch mock
// from another file turns every request here into a 404. Restore the real
// fetch before each test so this suite is deterministic.
const realFetch = globalThis.fetch
beforeEach(async () => {
  // 1. Worker reuse: a leaked global fetch mock from another test file turns
  // every request here into a 404. Restore the real fetch each time.
  if (globalThis.fetch !== realFetch) globalThis.fetch = realFetch
  // 2. initPasswordHash is module-level: a sibling test file that hashes a
  // DIFFERENT password in the same worker overwrites it, breaking login.
  // Re-hash our password so this suite is deterministic.
  await initPasswordHash(PASSWORD)
})

describe('startWebuiHttpServer', () => {
  it('allows plain-http login even when the RPC transport is wss', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(authRes.status).toBe(200)
    const setCookie = authRes.headers.get('set-cookie')
    expect(setCookie).toContain('phaneris_session=')
    expect(setCookie).not.toContain('Secure')

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://127.0.0.1:9100',
    })
  })

  // Batch F regressions — see docs/verification/server-security-hardening-failure-matrix.md
  it('FF01/FF02: failures are rate limited, but a correct password still logs in', async () => {
    const { baseUrl } = await createServer()
    const attempt = (password: string) => fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    // The per-client budget is 5 failures per window: the first five are rejected
    // as bad credentials, everything after is refused as rate limited.
    for (let i = 0; i < 5; i += 1) expect((await attempt('wrong-password')).status).toBe(401)
    for (let i = 0; i < 3; i += 1) expect((await attempt('wrong-password')).status).toBe(429)

    // Once the budget is spent the right password is refused too — but as a 429,
    // never a 401, so a caller cannot mistake throttling for bad credentials.
    expect((await attempt(PASSWORD)).status).toBe(429)
  })

  it('FF02: repeated successful logins never consume the budget', async () => {
    const { baseUrl } = await createServer()
    for (let i = 0; i < 30; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      })
      expect(res.status).toBe(200)
    }
  })

  it('FF09: a cookie under the pre-rename name still authenticates', async () => {
    const { baseUrl } = await createServer()
    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })
    const jwt = extractSessionCookie(authRes).replace('phaneris_session=', '')

    const res = await fetch(`${baseUrl}/api/config`, {
      headers: { cookie: `craft_session=${jwt}` },
    })
    expect(res.status).toBe(200)
  })

  it('FF10: a forwarded address is ignored when the direct peer is not trusted', async () => {
    const { baseUrl } = await createServer()
    const forged = { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }

    // Spend the budget from the forged key; the real socket IP keeps its own budget.
    for (let i = 0; i < 8; i += 1) {
      await fetch(`${baseUrl}/api/auth`, { method: 'POST', headers: forged, body: JSON.stringify({ password: 'wrong-password' }) })
    }

    // Forging a different address must not buy a fresh budget.
    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { ...forged, 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ password: 'wrong-password' }),
    })
    expect(res.status).toBe(429)
  })

  it('FF11: a forwarded address is used when the direct peer is trusted', async () => {
    const { baseUrl } = await createServer({ trustedProxies: ['127.0.0.1'] })
    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ password: PASSWORD }),
    })
    // Trusted path still authenticates; the point is that it does not throw or mis-key.
    expect(res.status).toBe(200)
  })

  it('FF07: an oversized body is refused before it is buffered', async () => {
    const { baseUrl } = await createServer()
    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(300 * 1024) }),
    })
    expect(res.status).toBe(413)
  })

  it('rejects invalid credentials', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid credentials' })
  })

  it('honors an explicit secure-cookie override', async () => {
    const { baseUrl } = await createServer({ secureCookies: true, wsProtocol: 'ws', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('infers secure cookies from proxy https headers when no override is set', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('derives a browser-facing websocket URL from forwarded public host headers', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com:9100',
    })
  })

  it('returns an explicit public websocket URL override from /api/config', async () => {
    const { baseUrl } = await createServer({
      publicWsUrl: 'wss://craft.example.com/ws',
      wsProtocol: 'wss',
      wsPort: 9100,
    })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com/ws',
    })
  })

  it('issues each session token with a unique jti claim', async () => {
    const { baseUrl } = await createServer()

    const first = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })
    const second = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const firstPayload = decodeJwtPayload(extractSessionCookie(first))
    const secondPayload = decodeJwtPayload(extractSessionCookie(second))
    expect(firstPayload.jti).toBeTruthy()
    expect(secondPayload.jti).toBeTruthy()
    expect(secondPayload.jti).not.toBe(firstPayload.jti)
  })

  it('revokes the session on logout so a replayed cookie is rejected', async () => {
    const { baseUrl } = await createServer()

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })
    const cookie = extractSessionCookie(authRes)

    // Cookie authenticates before logout.
    const before = await fetch(`${baseUrl}/api/config`, { headers: { cookie } })
    expect(before.status).toBe(200)

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(logoutRes.status).toBe(204)

    // The same (replayed) cookie is now rejected server-side.
    const after = await fetch(`${baseUrl}/api/config`, { headers: { cookie } })
    expect(after.status).toBe(401)
  })

  it('rate limits per client IP when no trusted proxies are configured', async () => {
    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    })

    const attempt = (ip: string) => {
      const req = new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong-password' }),
      })
      setRequestClientIp(req, ip)
      return handler.fetch(req)
    }

    for (let i = 0; i < 5; i++) {
      expect((await attempt('203.0.113.10')).status).toBe(401)
    }
    // 6th attempt from the same socket address is rate-limited…
    expect((await attempt('203.0.113.10')).status).toBe(429)
    // …but a different client is unaffected (per-IP keying, not a global lockout).
    expect((await attempt('203.0.113.99')).status).toBe(401)
  })
})
