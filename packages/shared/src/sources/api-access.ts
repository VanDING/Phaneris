import type { LoadedSource } from './types'
import type { SourceCredentialManager } from './credential-manager'
import { getSourceServerBuilder, type ResolvedApiAccess } from './server-builder'
import { createTokenGetter, type TokenRefreshManager } from './token-refresh-manager'
import { hasRenewEndpoint, isApiOAuthProvider } from './types'

/** API credential policy; MCP connection credentials remain a separate boundary. */
export function createApiSourceAccess(owners: {
  credentials: Pick<SourceCredentialManager, 'getApiCredential'>
  refresh: Pick<TokenRefreshManager, 'ensureFreshToken'>
}) {
  return {
    forApi(source: LoadedSource, policy: { usage: 'pages' | 'session' }): ResolvedApiAccess {
      if (source.config.type !== 'api' || !source.config.api) throw new Error(`API source not found: ${source.config.slug}`)
      const api = source.config.api
      const config = getSourceServerBuilder().buildApiConfig(source)
      // Explicit public always wins, including stale provider/renew metadata.
      if (api.authType === 'none') return { config, credential: '', available: true }
      if (isApiOAuthProvider(source.config.provider) || api.authType === 'oauth' || hasRenewEndpoint(source)) {
        const needsAuthentication = ['google', 'slack'].includes(source.config.provider) || api.authType === 'oauth'
        return { config, credential: createTokenGetter(owners.refresh, source),
          available: !needsAuthentication || !!source.config.isAuthenticated }
      }
      // D03: old Pages treated missing authType as public; session API tools
      // lazily read the vault. Preserve both policies without upgrading Pages.
      if (!api.authType && policy.usage === 'pages') return { config, credential: '', available: true }
      return { config, credential: () => owners.credentials.getApiCredential(source), available: true }
    },
  }
}
