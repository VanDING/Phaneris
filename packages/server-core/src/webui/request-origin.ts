import type { IncomingMessage } from 'node:http'

const normalizeIp = (ip: string) => ip.startsWith('::ffff:') ? ip.slice(7) : ip
export function isTrustedProxy(peer: string, proxies: readonly string[] = []): boolean {
  return proxies.some(proxy => normalizeIp(proxy) === normalizeIp(peer))
}

/** Accept an origin, not a URL with a hidden path, credential or fragment. */
export function parseWebuiOrigin(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !/^https?:\/\/[^/]+\/?$/.test(value)) {
    throw new Error('Expected an HTTP(S) origin without a path, credentials, query or fragment')
  }
  return url.origin
}

export function cookieOriginAllowed(req: IncomingMessage, allowed: readonly string[], proxies: readonly string[]): boolean {
  const origin = req.headers.origin
  if (!origin) return false
  try {
    const canonical = parseWebuiOrigin(origin)
    if (allowed.includes(canonical)) return true
    const trusted = isTrustedProxy(req.socket.remoteAddress ?? '', proxies)
    const first = (name: string) => {
      const value = req.headers[name]
      return typeof value === 'string' ? value.split(',')[0]?.trim() : undefined
    }
    const forwarded = trusted ? first('forwarded') : undefined
    const field = (name: string) => forwarded?.match(new RegExp(`(?:^|;)\\s*${name}="?([^;,"]+)"?`, 'i'))?.[1]
    const encrypted = 'encrypted' in req.socket && req.socket.encrypted
    const proto = trusted ? first('x-forwarded-proto') ?? field('proto') ?? (encrypted ? 'https' : 'http') : encrypted ? 'https' : 'http'
    const host = trusted ? first('x-forwarded-host') ?? field('host') ?? req.headers.host : req.headers.host
    return !!host && canonical === parseWebuiOrigin(`${proto}://${host}`)
  } catch { return false }
}
