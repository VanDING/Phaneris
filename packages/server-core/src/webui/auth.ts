/**
 * Web UI session authentication.
 *
 * Cookie-based JWT session auth for the browser-served web UI.
 * - Login: verify password → issue signed JWT → set HttpOnly cookie
 * - Validation: check cookie on every HTTP request + WebSocket upgrade
 * - Rate limiting: per-IP brute-force protection on /api/auth
 */

import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// JWT helpers (via jose library)
// ---------------------------------------------------------------------------

const JWT_EXPIRY_SECONDS = 86_400 // 24 hours

export interface JwtPayload {
  sub: string
  iat: number
  exp: number
  /** Unique token id — lets logout revoke this specific session server-side. */
  jti?: string
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const builder = new SignJWT({ sub: payload.sub } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
  if (payload.jti) builder.setJti(payload.jti)
  return builder.sign(key)
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    // Signature verification is not session authorization; the handler owns revocations.
    if (payload.sub !== 'webui' || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null
    return {
      sub: payload.sub as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      ...(typeof payload.jti === 'string' ? { jti: payload.jti } : {}),
    }
  } catch {
    return null
  }
}

export async function createSessionToken(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({ sub: 'webui', iat: now, exp: now + JWT_EXPIRY_SECONDS, jti: randomUUID() }, secret)
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'phaneris_session'
/**
 * Pre-rename cookie name. Still accepted on read: the rename must not sign every
 * existing session out. Writing uses the new name only, so old cookies age out
 * with their own 24h expiry.
 */
const LEGACY_SESSION_COOKIE_NAME = 'craft_session'

export function buildSessionCookie(jwt: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${JWT_EXPIRY_SECONDS}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildLogoutCookie(secure = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function extractSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const pair of cookieHeader.split(';')) {
    const [name, ...rest] = pair.trim().split('=')
    if (name === SESSION_COOKIE_NAME || name === LEGACY_SESSION_COOKIE_NAME) return rest.join('=')
  }
  return null
}

// ---------------------------------------------------------------------------
// Rate limiter (per-IP + global, sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  failures: number
  windowStart: number
}

/**
 * Failed-authentication limiter.
 *
 * Only failures consume budget. The previous `check(ip)` incremented a global
 * counter on *every* call — including successful logins — so 21 unauthenticated
 * `POST /api/auth` requests in a minute returned 429 to everyone, legitimate
 * users included. Authentication decisions and budget accounting are now
 * separate: ask with `canAttempt`, then report with `recordFailure` /
 * `recordSuccess`.
 */
export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>()
  private readonly maxAttempts: number
  private readonly windowMs: number
  /**
   * Backstop for a deployment behind a trusted proxy, where per-IP keys can be
   * spoofed via forwarded headers. It counts failures only, so ordinary use
   * cannot trip it.
   */
  private readonly maxGlobalAttempts: number
  private globalFailures = 0
  private globalWindowStart = Date.now()

  constructor(maxAttempts = 5, windowMs = 60_000, maxGlobalAttempts = 20) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
    this.maxGlobalAttempts = maxGlobalAttempts
  }

  /** Read-only: may this attempt proceed? Consumes nothing, so it is safe to call before hashing. */
  canAttempt(ip: string): boolean {
    const now = Date.now()
    if (now - this.globalWindowStart > this.windowMs) {
      this.globalFailures = 0
      this.globalWindowStart = now
    }
    if (this.globalFailures >= this.maxGlobalAttempts) return false
    const entry = this.entries.get(ip)
    if (!entry || now - entry.windowStart > this.windowMs) return true
    return entry.failures < this.maxAttempts
  }

  /** Record one failed authentication against both budgets. */
  recordFailure(ip: string): void {
    const now = Date.now()
    if (now - this.globalWindowStart > this.windowMs) {
      this.globalFailures = 0
      this.globalWindowStart = now
    }
    this.globalFailures++

    const entry = this.entries.get(ip)
    if (!entry || now - entry.windowStart > this.windowMs) {
      this.entries.set(ip, { failures: 1, windowStart: now })
      return
    }
    entry.failures++
  }

  /** A correct password clears that client's failure record. */
  recordSuccess(ip: string): void {
    this.entries.delete(ip)
  }

  /** Periodic cleanup of stale entries (call on a timer). */
  cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.entries) {
      if (now - entry.windowStart > this.windowMs * 2) {
        this.entries.delete(ip)
      }
    }
  }
}
