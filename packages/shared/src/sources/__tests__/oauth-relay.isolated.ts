import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { isOAuthRelayState } from '../../auth/oauth-relay.ts';
import { SourceCredentialManager } from '../credential-manager.ts';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

function createApiSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      slug: 'gmail-test',
      name: 'Gmail Test',
      type: 'api',
      provider: 'google',
      enabled: true,
      api: {
        baseUrl: 'https://gmail.googleapis.com/',
        authType: 'bearer',
        googleService: 'gmail',
        googleOAuthClientId: 'test-client-id',
        googleOAuthClientSecret: 'test-client-secret',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/gmail-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

function createMcpSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-mcp-id',
      slug: 'mcp-test',
      name: 'MCP Test',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'http',
        url: 'https://example.com/mcp',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/mcp-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

describe('SourceCredentialManager.prepareOAuth relay wrapping', () => {
  const credManager = new SourceCredentialManager();

  beforeEach(() => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(Response.json({
          authorization_endpoint: 'https://example.com/oauth/authorize',
          token_endpoint: 'https://example.com/oauth/token',
        }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as unknown as typeof fetch;
  });

  it('uses the direct WebUI callback when no owned relay is configured', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
    });

    expect(result.redirectUri).not.toContain('thecraftagents.com');
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(result.redirectUri);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(false);
    expect({ returnTo: result.redirectUri, innerState: outerState }).toEqual({
      returnTo: 'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
      innerState: result.state,
    });
  });

  it('uses the local desktop callback when no owned relay is configured', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    expect(result.redirectUri).not.toContain('thecraftagents.com');
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(result.redirectUri);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(false);
    expect({ returnTo: result.redirectUri, innerState: outerState }).toEqual({
      returnTo: 'http://localhost:6477/callback',
      innerState: result.state,
    });
  });

  it('passes the direct callback into MCP discovery', async () => {
    const result = await credManager.prepareOAuth(createMcpSource(), {
      callbackUrl: 'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
    });

    expect(result.redirectUri).not.toContain('thecraftagents.com');

    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://example.com/oauth/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(result.redirectUri);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(false);
    expect({ returnTo: result.redirectUri, innerState: outerState }).toEqual({
      returnTo: 'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
      innerState: result.state,
    });
  });
});
