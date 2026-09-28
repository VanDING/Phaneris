/**
 * Slack desktop OAuth on this fork: owned-relay routing and fail-closed.
 *
 * Upstream #1068 was "desktop Slack flows were handed the generic OAuth relay
 * callback, which the Slack app does not have registered, so Slack refused
 * before consent". This fork has the mirror-image defect and no upstream hosted
 * relay to fall back to (`SERVICE_URLS.oauthRelay` is null by policy), so:
 *
 *   - a desktop flow (loopback `http://localhost:<port>/callback`) must be sent
 *     to `<owned relay>/auth/slack/callback?port=N` and must NOT be wrapped in
 *     the generic `state` envelope, because that relay route forwards Slack's
 *     own state untouched;
 *   - a WebUI HTTPS callback keeps the generic envelope, which only the generic
 *     relay callback can unwrap;
 *   - with no owned relay configured, the loopback flow must fail closed with
 *     an actionable error instead of handing Slack a redirect_uri it rejects.
 *
 * `auth/oauth-relay.ts` reads `SERVICE_URLS.oauthRelay` at module load, so the
 * "owned relay configured" half needs `identity.generated.ts` mocked and every
 * module that already captured the relay base re-imported under a
 * cache-busting specifier. Bun module mocks are process-global and patch the
 * already-imported module in place, so the two states cannot coexist: the
 * shipped-default (no relay) state is asserted FIRST, from modules imported
 * before any mock is registered, and the mocks go up only in the
 * relay-configured describe. That ordering is load-bearing — this is a
 * `.isolated.ts` file so the root test script also gives it its own process.
 */

// Slack reads its client id at module load, so the environment must be set
// before anything imports the Slack module — hence the dynamic imports below.
process.env.SLACK_OAUTH_CLIENT_ID = 'slack-test-client';
process.env.SLACK_OAUTH_CLIENT_SECRET = 'slack-test-secret';

import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

/** Stand-in for a maintainer-owned relay configured in phaneris.identity.json. */
const TEST_RELAY = 'https://relay.phaneris.test';
const RELAY_SLACK_CALLBACK = `${TEST_RELAY}/auth/slack/callback`;
const RELAY_GENERIC_CALLBACK = `${TEST_RELAY}/auth/callback`;
const WEBUI_CALLBACK = 'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback';
/** The upstream hosted relay; this fork must never fall back to it. */
const UPSTREAM_RELAY_HOST = 'thecraftagents.com';

// Cache-busting specifiers: a query string gives a fresh module instance whose
// own imports still resolve through the registry (so they pick up the mocks).
// Written as variables because TS cannot resolve query-suffixed specifiers.
const RELAY_MODULE = '../../auth/oauth-relay.ts';
const SLACK_MODULE = '../../auth/slack-oauth.ts';
const RELAY_MODULE_CONFIGURED = '../../auth/oauth-relay.ts?owned-relay';
const SLACK_MODULE_CONFIGURED = '../../auth/slack-oauth.ts?owned-relay';
const CREDENTIAL_MANAGER_CONFIGURED = '../credential-manager.ts?owned-relay';

function createSlackSource(): LoadedSource {
  return {
    config: {
      id: 'slack-id',
      slug: 'slack',
      name: 'Slack',
      type: 'api',
      provider: 'slack',
      enabled: true,
      api: {
        baseUrl: 'https://slack.com/api/',
        authType: 'oauth',
        slackService: 'messaging',
      },
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/slack',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

// --------------------------------------------------------------------------
// Shipped default: no owned relay. Imported before any mock is registered, so
// these are the real modules with `SERVICE_URLS.oauthRelay === null`.
// --------------------------------------------------------------------------
const realIdentity = await import('../../identity.generated.ts');
const realSlack = await import(SLACK_MODULE);
const realRelay = await import(RELAY_MODULE);
const { SourceCredentialManager: RelaylessManager } = await import('../credential-manager.ts');
const relaylessManager = new RelaylessManager();

describe('loopbackCallbackPort', () => {
  it('accepts the desktop callback server target', () => {
    expect(realSlack.loopbackCallbackPort('http://localhost:6477/callback')).toBe(6477);
    expect(realSlack.loopbackCallbackPort('http://127.0.0.1:8914/callback')).toBe(8914);
    expect(realSlack.loopbackCallbackPort('http://[::1]:6477/callback')).toBe(6477);
  });

  it('rejects targets the relay Slack route cannot serve', () => {
    expect(realSlack.loopbackCallbackPort(WEBUI_CALLBACK)).toBeUndefined();
    expect(realSlack.loopbackCallbackPort('http://localhost:6477/oauth/callback')).toBeUndefined();
    expect(realSlack.loopbackCallbackPort('http://localhost/callback')).toBeUndefined();
    expect(realSlack.loopbackCallbackPort('http://localhost:80/callback')).toBeUndefined();
    expect(realSlack.loopbackCallbackPort('https://localhost:6477/callback')).toBeUndefined();
    expect(realSlack.loopbackCallbackPort('not a url')).toBeUndefined();
    expect(realSlack.loopbackCallbackPort(undefined)).toBeUndefined();
  });
});

// Declared before the relay-configured describe: the mocks that describe
// registers would otherwise reach these assertions too.
describe('Slack OAuth without an owned relay', () => {
  it('fails closed on a desktop callback, naming both remedies', async () => {
    const error: Error | null = await relaylessManager
      .prepareOAuth(createSlackSource(), { callbackUrl: 'http://localhost:6477/callback' })
      .then(() => null, (caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(Error);
    const message = error!.message;
    expect(message).toContain('no OAuth relay configured');
    expect(message).toContain('http://localhost:6477/callback');
    // Remedy (a): configure the owned relay and register its Slack route.
    expect(message).toContain('services.oauthRelayUrl');
    expect(message).toContain('<relay>/auth/slack/callback');
    expect(message).toContain('Redirect URLs');
    // Remedy (b): register the exact desktop callback URL and pin the port.
    expect(message).toMatch(/pin the callback port/);
  });

  it('fails closed for a bare callback port and for direct prepareSlackOAuth calls', async () => {
    await expect(relaylessManager.prepareOAuth(createSlackSource(), { callbackPort: 6477 }))
      .rejects.toThrow(/no OAuth relay configured/);
    // prepareSlackOAuth is synchronous, so its throw is immediate.
    expect(() => realSlack.prepareSlackOAuth({ service: 'messaging', callbackPort: 6477 }))
      .toThrow(/no OAuth relay configured/);
    expect(() => realSlack.prepareSlackOAuth({ service: 'messaging', callbackUrl: 'http://127.0.0.1:8914/callback' }))
      .toThrow(/no OAuth relay configured/);
  });

  it('still uses the direct callback for WebUI HTTPS targets', async () => {
    const result = await relaylessManager.prepareOAuth(createSlackSource(), { callbackUrl: WEBUI_CALLBACK });

    expect(result.redirectUri).toBe(WEBUI_CALLBACK);
    expect(result.redirectUri).not.toContain(UPSTREAM_RELAY_HOST);
    expect(new URL(result.authUrl).searchParams.get('redirect_uri')).toBe(WEBUI_CALLBACK);
    expect(realRelay.isOAuthRelayState(result.state)).toBe(false);
  });
});

describe('Slack OAuth with an owned relay', () => {
  let configuredSlack: typeof realSlack;
  let relayManager: InstanceType<typeof RelaylessManager>;

  beforeAll(async () => {
    // Each factory must return a plain object: Bun silently keeps the real
    // module when a factory returns a module namespace, which would leave the
    // relay unconfigured and make these cases assert the fail-closed path.
    mock.module('../../identity.generated.ts', () => ({
      ...realIdentity,
      SERVICE_URLS: { ...realIdentity.SERVICE_URLS, oauthRelay: TEST_RELAY },
    }));
    const configuredRelay = await import(RELAY_MODULE_CONFIGURED);
    mock.module(RELAY_MODULE, () => ({ ...configuredRelay }));
    configuredSlack = (await import(SLACK_MODULE_CONFIGURED)) as typeof realSlack;
    mock.module(SLACK_MODULE, () => ({ ...configuredSlack }));
    const { SourceCredentialManager } = await import(CREDENTIAL_MANAGER_CONFIGURED);
    relayManager = new SourceCredentialManager();
  });

  it('derives the registered Slack relay route for a desktop callback', async () => {
    const result = await relayManager.prepareOAuth(createSlackSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    expect(result.provider).toBe('slack');
    expect(result.redirectUri).toBe(`${RELAY_SLACK_CALLBACK}?port=6477`);
    expect(result.redirectUri).not.toContain(UPSTREAM_RELAY_HOST);
  });

  it('hands Slack the relay route directly, without the generic state envelope', async () => {
    const result = await relayManager.prepareOAuth(createSlackSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(`${RELAY_SLACK_CALLBACK}?port=6477`);
    expect(authUrl.searchParams.get('client_id')).toBe('slack-test-client');
    expect(authUrl.searchParams.get('user_scope')).toBe('chat:write');
    // The relay route forwards Slack's state untouched, so the state Slack sees
    // must be the inner state itself — not the generic relay envelope.
    expect(authUrl.searchParams.get('state')).toBe(result.state);
    expect(realRelay.isOAuthRelayState(result.state)).toBe(false);
  });

  it('behaves the same when the desktop flow passes a bare callback port', async () => {
    const result = await relayManager.prepareOAuth(createSlackSource(), { callbackPort: 6480 });

    expect(result.redirectUri).toBe(`${RELAY_SLACK_CALLBACK}?port=6480`);
    expect(result.redirectUri).not.toContain(UPSTREAM_RELAY_HOST);
  });

  it('routes a loopback callback URL given straight to prepareSlackOAuth', async () => {
    const result = configuredSlack.prepareSlackOAuth({ service: 'messaging', callbackUrl: 'http://127.0.0.1:8914/callback' });

    expect(result.redirectUri).toBe(`${RELAY_SLACK_CALLBACK}?port=8914`);
    expect(realRelay.isOAuthRelayState(result.state)).toBe(false);
    expect(result.redirectUri).not.toContain(UPSTREAM_RELAY_HOST);
  });

  it('keeps the generic relay envelope for WebUI HTTPS targets', async () => {
    const result = await relayManager.prepareOAuth(createSlackSource(), { callbackUrl: WEBUI_CALLBACK });

    expect(result.redirectUri).toBe(RELAY_GENERIC_CALLBACK);
    expect(result.redirectUri).not.toContain(UPSTREAM_RELAY_HOST);

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(RELAY_GENERIC_CALLBACK);
    const outerState = authUrl.searchParams.get('state')!;
    expect(realRelay.isOAuthRelayState(outerState)).toBe(true);
    expect(realRelay.decodeOAuthRelayState(outerState)).toEqual({
      returnTo: WEBUI_CALLBACK,
      innerState: result.state,
    });
  });
});
