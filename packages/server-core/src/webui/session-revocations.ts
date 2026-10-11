import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openSqliteDatabase, type SqliteDatabase } from '../runtime/sqlite'
import type { JwtPayload } from './auth'

export class AuthStorageFailure extends Error {
  constructor(cause: unknown) { super('WebUI authentication storage unavailable', { cause }); this.name = 'AuthStorageFailure' }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
// JWS permits equivalent base64url signature spellings in some decoders.
const tokenDigest = (token: string) => digest(token.split('.').map(part => Buffer.from(part, 'base64url').toString('base64url')).join('.'))

/** Persistent authority shared by all HTTP/WS cookie checks for this handler. */
export class SessionRevocations {
  private readonly db: SqliteDatabase
  private readonly scope: string
  private failure?: AuthStorageFailure
  constructor(path: string, secret: string) {
    this.scope = digest(secret)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = openSqliteDatabase(path)
    try {
      chmodSync(path, 0o600)
      this.db.exec(`PRAGMA busy_timeout=250; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS session_revocations (
          scope TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
          PRIMARY KEY (scope, token_hash)
        );`)
    } catch (error) { this.db.close(); throw new AuthStorageFailure(error) }
  }
  private access<T>(action: () => T): T {
    if (this.failure) throw this.failure
    try { return action() } catch (error) { this.failure = new AuthStorageFailure(error); throw this.failure }
  }
  checkAvailable(): void { this.access(() => this.db.prepare('SELECT 1').get()) }
  isRevoked(token: string): boolean {
    return this.access(() => !!this.db.prepare('SELECT 1 FROM session_revocations WHERE scope=? AND token_hash=?')
      .get(this.scope, tokenDigest(token)))
  }
  revoke(token: string, payload: JwtPayload): void {
    this.access(() => this.db.transaction(() => {
      this.db.prepare('DELETE FROM session_revocations WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000))
      this.db.prepare('INSERT OR REPLACE INTO session_revocations (scope,token_hash,expires_at) VALUES (?,?,?)')
        .run(this.scope, tokenDigest(token), payload.exp)
    })())
  }
  close(): void { this.db.close() }
}
