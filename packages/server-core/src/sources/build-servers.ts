/**
 * Source → server-config builder, shared by session startup and the pages
 * action executor.
 *
 * Turns LoadedSources into connectable MCP / in-process API server configs
 * with credentials resolved at build time and refresh wired for OAuth /
 * renew-endpoint sources. Extracted verbatim from SessionManager so pages
 * (which have no session) reuse the exact same credential path — one
 * implementation, no drift.
 */

import { createScopedLogger, CONSOLE_LOGGER, type Logger } from '@phaneris/server-core/runtime'
import {
  getSourceCredentialManager,
  getSourceServerBuilder,
  hasRenewEndpoint,
  SERVER_BUILD_ERRORS,
  TokenRefreshManager,
  createApiSourceAccess,
  type LoadedSource,
  type SourceWithCredential,
  type SummarizeCallback,
} from '@phaneris/shared/sources'
import { perf } from '@phaneris/shared/utils'

const defaultLog = createScopedLogger(CONSOLE_LOGGER, 'sources')

export async function buildServersFromSources(
  sources: LoadedSource[],
  sessionPath?: string,
  tokenRefreshManager?: TokenRefreshManager,
  summarize?: SummarizeCallback,
  log: Logger = defaultLog
) {
  const span = perf.span('sources.buildServers', { count: sources.length })
  const credManager = getSourceCredentialManager()
  const serverBuilder = getSourceServerBuilder()

  // Load credentials for all sources
  const sourcesWithCreds: SourceWithCredential[] = await Promise.all(
    sources.map(async (source) => ({
      source,
      token: source.config.type === 'mcp' ? await credManager.getToken(source) : undefined,
      credential: source.config.type === 'mcp' ? await credManager.getApiCredential(source) : undefined,
    }))
  )
  span.mark('credentials.loaded')

  const access = createApiSourceAccess({ credentials: credManager,
    refresh: tokenRefreshManager ?? new TokenRefreshManager(credManager, { log: msg => log.debug(msg) }) })
  const result = await serverBuilder.buildWithAccess(sourcesWithCreds, access, { sessionPath, summarize })
  span.mark('servers.built')
  span.setMetadata('mcpCount', Object.keys(result.mcpServers).length)
  span.setMetadata('apiCount', Object.keys(result.apiServers).length)

  // Update source configs for auth errors so UI reflects actual state.
  // Re-classify AUTH_REQUIRED → TOKEN_EXPIRED when the credential is merely
  // expired-but-refreshable; in that case the refresh cycle handles recovery
  // and we must NOT prematurely mark the source as needing re-auth (#710).
  for (const error of result.errors) {
    if (error.error !== SERVER_BUILD_ERRORS.AUTH_REQUIRED) continue
    const source = sources.find(s => s.config.slug === error.sourceSlug)
    if (!source) continue

    const cred = await credManager.load(source)
    const isExpiredRefreshable =
      cred &&
      (credManager.isExpired(cred) || credManager.needsRefresh(cred)) &&
      (cred.refreshToken || hasRenewEndpoint(source))

    if (isExpiredRefreshable) {
      error.error = SERVER_BUILD_ERRORS.TOKEN_EXPIRED
      log.debug(`Source ${error.sourceSlug}: TOKEN_EXPIRED — refresh cycle will handle`)
      continue
    }

    credManager.markSourceNeedsReauth(source, 'Token missing or expired')
    log.info(`Marked source ${error.sourceSlug} as needing re-auth`)
  }

  span.end()
  return result
}
