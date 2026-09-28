/**
 * Slack OAuth flow using Slack's OAuth 2.0 v2
 *
 * This module handles the complete Slack OAuth flow for USER authentication:
 * 1. Opens browser for Slack consent screen
 * 2. Receives authorization code via local callback server
 * 3. Exchanges code for user access token
 * 4. Returns tokens and workspace info
 *
 * Uses user_scope (not scope) to authenticate as the user, not as a bot.
 * This allows posting messages as the authenticated user.
 */

import { URL } from 'url';
import { randomBytes } from 'crypto';
import { openUrl } from '../utils/open-url.ts';
import { createCallbackServer, type AppType } from './callback-server.ts';
import type { SlackService } from '../sources/types.ts';
import { type OAuthSessionContext, buildOAuthDeeplinkUrl } from './types.ts';
import type { PreparedOAuthFlow, OAuthExchangeParams, OAuthExchangeResult } from './oauth-flow-types.ts';
import { getSlackRelayCallbackUrl } from './oauth-relay.ts';

// Re-export for convenience
export type { SlackService } from '../sources/types.ts';

// Slack OAuth configuration - must be set via environment variables
// These are baked into the build at compile time
const SLACK_CLIENT_ID = process.env.SLACK_OAUTH_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_OAUTH_CLIENT_SECRET || '';

// Slack OAuth endpoints
const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

/**
 * Port of a desktop callback target the owned relay can serve, or undefined.
 *
 * The Slack app registers the relay's Slack route
 * (`<relay>/auth/slack/callback?port=N`), which forwards to
 * `http://localhost:<port>/callback`, so the target must be a loopback URL with
 * an explicit port and exactly that path. Anything else — WebUI HTTPS
 * callbacks, other callback paths — is not served by that route and must keep
 * using the generic relay callback (or the direct URL when no relay exists).
 */
export function loopbackCallbackPort(returnTo: string | undefined): number | undefined {
  if (!returnTo) return undefined;
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return undefined;
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'http:' || !loopback || url.pathname !== '/callback' || !url.port) return undefined;
  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
}

/**
 * Fail-closed error for a desktop Slack flow on an install with no owned relay.
 *
 * Slack only accepts HTTPS redirect URIs, and the desktop callback server is
 * plain HTTP on a scanned loopback port, so handing that URL to Slack fails
 * before the consent screen with nothing actionable in the logs. This fork
 * never falls back to an upstream hosted relay, so the two real remedies are
 * spelled out instead.
 */
function slackRelayRequiredError(port: number, cause?: unknown): Error {
  const desktopCallback = `http://localhost:${port}/callback`;
  return new Error(
    `Slack sign-in requires an HTTPS redirect URL, but this install has no OAuth relay configured, so the desktop ` +
      `callback (${desktopCallback}) cannot reach Slack. Fix it either way:\n` +
      `  (a) Owned relay (supported path): set "services.oauthRelayUrl" in phaneris.identity.json, run ` +
      '`bun run identity:generate`, then add `<relay>/auth/slack/callback` to the Slack app\'s Redirect URLs. ' +
      `Phaneris then sends Slack that HTTPS route, which forwards to ${desktopCallback}.\n` +
      `  (b) Direct callback: add the exact URL ${desktopCallback} to the Slack app's Redirect URLs and pin the ` +
      `callback port so the URL stops changing. Whether Slack accepts a plain-http localhost redirect URL is ` +
      `unverified for this fork, so (a) is the supported path.`,
    { cause },
  );
}

/**
 * Predefined USER scope sets for common Slack services
 * These are user scopes (user_scope), not bot scopes (scope)
 * User scopes allow acting as the authenticated user
 */
export const SLACK_SERVICE_SCOPES: Record<SlackService, string[]> = {
  messaging: ['chat:write'],
  channels: ['channels:read', 'channels:history', 'groups:read', 'groups:history'],
  users: ['users:read', 'users:read.email'],
  files: ['files:read', 'files:write'],
  full: [
    'chat:write',
    'channels:read',
    'channels:history',
    'groups:read',
    'groups:history',
    'users:read',
    'users:read.email',
    'files:read',
    'files:write',
    'reactions:read',
    'reactions:write',
    'im:read',
    'im:history',
    'im:write',
    'mpim:read',
    'mpim:history',
    'search:read',
  ],
};

/**
 * Options for starting Slack OAuth flow
 */
export interface SlackOAuthOptions {
  /** Slack service to authenticate (uses predefined scopes) */
  service?: SlackService;
  /** Custom user scopes (overrides service scopes if provided) */
  userScopes?: string[];
  /** App type for callback server styling */
  appType?: AppType;
  /** Session context for building deeplink back to chat after OAuth */
  sessionContext?: OAuthSessionContext;
}

/**
 * Result of Slack OAuth flow
 */
export interface SlackOAuthResult {
  success: boolean;
  /** User access token (xoxp-...) for acting as the user */
  accessToken?: string;
  /** Refresh token for token rotation (if enabled in Slack app settings) */
  refreshToken?: string;
  /** Token expiration timestamp (ms) - only if token rotation is enabled */
  expiresAt?: number;
  /** Slack workspace ID */
  teamId?: string;
  /** Slack workspace name */
  teamName?: string;
  /** Authenticated user ID */
  userId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Generate random state for CSRF protection
 */
function generateState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Exchange authorization code for tokens
 * Slack uses HTTP Basic auth for token exchange
 */
async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  teamId: string;
  teamName: string;
  userId: string;
}> {
  // Use HTTP Basic auth as recommended by Slack
  const authHeader = Buffer.from(`${SLACK_CLIENT_ID}:${SLACK_CLIENT_SECRET}`).toString('base64');

  const params = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${authHeader}`,
    },
    body: params.toString(),
  });

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    // For user tokens, these come from authed_user
    authed_user?: {
      id: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    team?: { id: string; name: string };
  };

  if (!data.ok) {
    throw new Error(`Slack token exchange failed: ${data.error || 'Unknown error'}`);
  }

  // User token is in authed_user.access_token
  if (!data.authed_user?.access_token) {
    throw new Error('No user access token received. Make sure user_scope is set in the OAuth request.');
  }

  return {
    accessToken: data.authed_user.access_token,
    refreshToken: data.authed_user.refresh_token,
    expiresIn: data.authed_user.expires_in,
    teamId: data.team?.id || '',
    teamName: data.team?.name || '',
    userId: data.authed_user.id,
  };
}

/**
 * Refresh Slack access token using refresh token
 * Note: Token rotation must be enabled in Slack app settings for refresh tokens
 */
export async function refreshSlackToken(
  refreshToken: string,
  clientId?: string
): Promise<{ accessToken: string; expiresAt?: number }> {
  const authHeader = Buffer.from(
    `${clientId || SLACK_CLIENT_ID}:${SLACK_CLIENT_SECRET}`
  ).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${authHeader}`,
    },
    body: params.toString(),
  });

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    expires_in?: number;
  };

  if (!data.ok) {
    throw new Error(`Failed to refresh Slack token: ${data.error}`);
  }

  return {
    accessToken: data.access_token!,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Check if Slack OAuth is configured (client ID and secret are set)
 */
export function isSlackOAuthConfigured(): boolean {
  return Boolean(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET);
}

/**
 * Get user scopes for a Slack service or use custom scopes
 */
export function getSlackScopes(options: SlackOAuthOptions): string[] {
  // Custom scopes take precedence
  if (options.userScopes && options.userScopes.length > 0) {
    return options.userScopes;
  }

  // Use predefined service scopes
  if (options.service && options.service in SLACK_SERVICE_SCOPES) {
    return SLACK_SERVICE_SCOPES[options.service];
  }

  // Default to full workspace scopes
  return SLACK_SERVICE_SCOPES.full;
}

/**
 * Options for preparing a Slack OAuth flow (server-side, no browser interaction)
 */
export interface PrepareSlackOAuthOptions {
  service?: SlackService;
  userScopes?: string[];
  /** Port for the local callback server (Electron). One of callbackPort or callbackUrl required. */
  callbackPort?: number;
  /** Full callback URL (WebUI). Takes precedence over callbackPort. */
  callbackUrl?: string;
}

/**
 * Prepare a Slack OAuth flow without starting a callback server or opening a browser.
 * Returns everything needed to construct the auth URL and later exchange the code.
 *
 * Slack requires HTTPS redirect URIs, so a desktop flow's loopback HTTP callback
 * travels through the owned relay's registered Slack route
 * (`<relay>/auth/slack/callback?port=N`) instead of being handed to Slack, which
 * rejects a redirect_uri its app has not registered.
 */
export function prepareSlackOAuth(options: PrepareSlackOAuthOptions): PreparedOAuthFlow {
  if (!isSlackOAuthConfigured()) {
    throw new Error(
      'Slack OAuth not configured. Set SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_CLIENT_SECRET environment variables.'
    );
  }

  const userScopes = getSlackScopes(options);
  const state = generateState();

  // A callback URL wins over a bare port, matching the previous precedence, but a
  // loopback HTTP target is the desktop callback server: Slack can only reach it
  // through the relay's Slack route — never through the generic relay callback,
  // which the Slack app does not have registered (upstream #1068). With no owned
  // relay the flow fails closed with the two supported remedies.
  const desktopPort = options.callbackUrl
    ? loopbackCallbackPort(options.callbackUrl)
    : options.callbackPort;

  let redirectUri: string;
  if (desktopPort !== undefined) {
    try {
      redirectUri = getSlackRelayCallbackUrl(desktopPort);
    } catch (error) {
      // The only way that call fails is a missing owned relay.
      throw slackRelayRequiredError(desktopPort, error);
    }
  } else {
    redirectUri = options.callbackUrl
      ?? getSlackRelayCallbackUrl(options.callbackPort!);
  }

  const authUrl = new URL(SLACK_AUTH_URL);
  authUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('user_scope', userScopes.join(','));

  return {
    authUrl: authUrl.toString(),
    state,
    codeVerifier: '',  // Slack doesn't use PKCE
    tokenEndpoint: SLACK_TOKEN_URL,
    clientId: SLACK_CLIENT_ID,
    clientSecret: SLACK_CLIENT_SECRET,
    redirectUri,
    provider: 'slack',
  };
}

/**
 * Exchange a Slack authorization code for tokens (server-side).
 * Slack uses HTTP Basic auth (client_id:client_secret) for token exchange.
 */
export async function exchangeSlackOAuth(params: OAuthExchangeParams): Promise<OAuthExchangeResult> {
  try {
    const tokens = await exchangeCodeForTokens(params.code, params.redirectUri);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      email: tokens.teamName,  // Use teamName as the identifier
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Slack OAuth exchange failed',
    };
  }
}

/**
 * Start Slack OAuth flow for USER authentication
 *
 * Opens browser for Slack consent, handles callback, and returns user token + workspace info.
 * Uses user_scope to authenticate as the user (not a bot), allowing you to post as yourself.
 *
 * @example
 * // Authenticate with full workspace access
 * const result = await startSlackOAuth({ service: 'full' });
 *
 * @example
 * // Authenticate for messaging only
 * const result = await startSlackOAuth({ service: 'messaging' });
 *
 * @example
 * // Authenticate with custom scopes
 * const result = await startSlackOAuth({
 *   userScopes: ['chat:write', 'users:read']
 * });
 */
export async function startSlackOAuth(options: SlackOAuthOptions = {}): Promise<SlackOAuthResult> {
  try {
    // Verify OAuth credentials are configured
    if (!isSlackOAuthConfigured()) {
      return {
        success: false,
        error:
          'Slack OAuth not configured. Set SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_CLIENT_SECRET environment variables.',
      };
    }

    // Get user scopes for this request
    const userScopes = getSlackScopes(options);

    // Generate state for CSRF protection
    const state = generateState();

    // Fail before starting a listener when no owned HTTPS relay is configured.
    getSlackRelayCallbackUrl(0);
    // Start local HTTP callback server with deeplink for returning to chat session
    const appType = options.appType || 'electron';
    const deeplinkUrl = buildOAuthDeeplinkUrl(options.sessionContext);
    const callbackServer = await createCallbackServer({ appType, deeplinkUrl });

    // Extract port from local callback URL
    const localUrl = new URL(callbackServer.url);
    const port = localUrl.port;

    // Slack requires HTTPS; only use the maintainer-configured relay.
    const redirectUri = getSlackRelayCallbackUrl(port);

    // Build authorization URL
    // Use user_scope (not scope) to get a user token instead of bot token
    const authUrl = new URL(SLACK_AUTH_URL);
    authUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    // user_scope = authenticate as user, scope = install bot
    authUrl.searchParams.set('user_scope', userScopes.join(','));

    // Open browser for authorization
    await openUrl(authUrl.toString());

    // Wait for callback
    const callback = await callbackServer.promise;

    // Verify state
    if (callback.query.state !== state) {
      return {
        success: false,
        error: 'OAuth state mismatch - possible CSRF attack',
      };
    }

    // Check for error
    if (callback.query.error) {
      return {
        success: false,
        error: callback.query.error_description || callback.query.error,
      };
    }

    // Get authorization code
    const code = callback.query.code;
    if (!code) {
      return {
        success: false,
        error: 'No authorization code received',
      };
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      teamId: tokens.teamId,
      teamName: tokens.teamName,
      userId: tokens.userId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during Slack OAuth',
    };
  }
}
