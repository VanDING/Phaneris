import { describe, it, expect } from 'bun:test';
import { buildOAuthDeeplinkUrl, type OAuthSessionContext } from '../types';
import { DEEPLINK_SCHEME } from '../../identity.generated.ts';

/**
 * The default-scheme fixtures used to pass the UPSTREAM brand (`craftagents`)
 * while asserting the product's scheme, so four cases failed after the rename.
 * They now take the scheme from the generated identity contract: this suite
 * tests what the helper does with a scheme, and `identity:check` owns whether
 * the product's scheme is correct — restating the brand here would be a second
 * place to update on every rename, which is what the identity module forbids.
 */
const PRODUCT_SCHEME = DEEPLINK_SCHEME;

describe('buildOAuthDeeplinkUrl', () => {
  it('returns deeplink URL when sessionId and deeplinkScheme are provided', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260209-swift-river',
      deeplinkScheme: PRODUCT_SCHEME,
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe(`${PRODUCT_SCHEME}://allSessions/session/260209-swift-river`);
  });

  it('returns undefined when sessionId is missing', () => {
    const ctx: OAuthSessionContext = {
      deeplinkScheme: PRODUCT_SCHEME,
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when deeplinkScheme is missing', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260209-swift-river',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when context is undefined', () => {
    expect(buildOAuthDeeplinkUrl(undefined)).toBeUndefined();
  });

  it('returns undefined when context is empty object', () => {
    expect(buildOAuthDeeplinkUrl({})).toBeUndefined();
  });

  it('uses custom deeplink scheme for multi-instance', () => {
    const ctx: OAuthSessionContext = {
      sessionId: 'test-session',
      deeplinkScheme: 'craftagents1',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe('craftagents1://allSessions/session/test-session');
  });

  // Edge cases for session IDs with special characters
  it('handles session ID with special characters (hyphens and numbers)', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260209-swift-river-42',
      deeplinkScheme: PRODUCT_SCHEME,
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe(`${PRODUCT_SCHEME}://allSessions/session/260209-swift-river-42`);
  });

  it('handles session ID with URL-unsafe characters', () => {
    const ctx: OAuthSessionContext = {
      sessionId: 'session/with spaces&special=chars',
      deeplinkScheme: PRODUCT_SCHEME,
    };
    // The function does not encode - it passes through as-is
    expect(buildOAuthDeeplinkUrl(ctx)).toBe(`${PRODUCT_SCHEME}://allSessions/session/session/with spaces&special=chars`);
  });

  it('returns undefined when sessionId is empty string', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '',
      deeplinkScheme: PRODUCT_SCHEME,
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when deeplinkScheme is empty string', () => {
    const ctx: OAuthSessionContext = {
      sessionId: 'test-session',
      deeplinkScheme: '',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('returns undefined when both are empty strings', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '',
      deeplinkScheme: '',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBeUndefined();
  });

  it('constructs correct URL format for instance 2', () => {
    const ctx: OAuthSessionContext = {
      sessionId: '260111-bold-moon',
      deeplinkScheme: 'craftagents2',
    };
    expect(buildOAuthDeeplinkUrl(ctx)).toBe('craftagents2://allSessions/session/260111-bold-moon');
  });
});
