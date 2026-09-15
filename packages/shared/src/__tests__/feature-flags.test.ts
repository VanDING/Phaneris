import { describe, it, expect, afterEach } from 'bun:test';
import {
  isDevRuntime,
  isDeveloperFeedbackEnabled,
  isCraftAgentsCliEnabled,
  isEmbeddedServerEnabled,
  isPagesSharingEnabled,
  isSessionSharingEnabled,
} from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  PHANERIS_DEBUG: process.env.PHANERIS_DEBUG,
  PHANERIS_FEATURE_DEVELOPER_FEEDBACK: process.env.PHANERIS_FEATURE_DEVELOPER_FEEDBACK,
  PHANERIS_FEATURE_AGENTS_CLI: process.env.PHANERIS_FEATURE_AGENTS_CLI,
  PHANERIS_FEATURE_EMBEDDED_SERVER: process.env.PHANERIS_FEATURE_EMBEDDED_SERVER,
  PHANERIS_FEATURE_PAGES_SHARING: process.env.PHANERIS_FEATURE_PAGES_SHARING,
  PHANERIS_FEATURE_SESSION_SHARING: process.env.PHANERIS_FEATURE_SESSION_SHARING,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.PHANERIS_DEBUG === undefined) delete process.env.PHANERIS_DEBUG;
  else process.env.PHANERIS_DEBUG = ORIGINAL_ENV.PHANERIS_DEBUG;

  if (ORIGINAL_ENV.PHANERIS_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.PHANERIS_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.PHANERIS_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.PHANERIS_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.PHANERIS_FEATURE_AGENTS_CLI === undefined) delete process.env.PHANERIS_FEATURE_AGENTS_CLI;
  else process.env.PHANERIS_FEATURE_AGENTS_CLI = ORIGINAL_ENV.PHANERIS_FEATURE_AGENTS_CLI;

  if (ORIGINAL_ENV.PHANERIS_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.PHANERIS_FEATURE_EMBEDDED_SERVER;
  else process.env.PHANERIS_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.PHANERIS_FEATURE_EMBEDDED_SERVER;

  if (ORIGINAL_ENV.PHANERIS_FEATURE_PAGES_SHARING === undefined) delete process.env.PHANERIS_FEATURE_PAGES_SHARING;
  else process.env.PHANERIS_FEATURE_PAGES_SHARING = ORIGINAL_ENV.PHANERIS_FEATURE_PAGES_SHARING;

  if (ORIGINAL_ENV.PHANERIS_FEATURE_SESSION_SHARING === undefined) delete process.env.PHANERIS_FEATURE_SESSION_SHARING;
  else process.env.PHANERIS_FEATURE_SESSION_SHARING = ORIGINAL_ENV.PHANERIS_FEATURE_SESSION_SHARING;
});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PHANERIS_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for PHANERIS_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.PHANERIS_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.PHANERIS_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PHANERIS_DEBUG;
    process.env.PHANERIS_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.PHANERIS_DEBUG = '1';
    delete process.env.PHANERIS_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled defaults to false when no override is set', () => {
    delete process.env.PHANERIS_FEATURE_AGENTS_CLI;

    expect(isCraftAgentsCliEnabled()).toBe(false);
  });

  it('isCraftAgentsCliEnabled honors explicit override true', () => {
    process.env.PHANERIS_FEATURE_AGENTS_CLI = '1';

    expect(isCraftAgentsCliEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled honors explicit override false', () => {
    process.env.PHANERIS_FEATURE_AGENTS_CLI = '0';

    expect(isCraftAgentsCliEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled defaults to false when no override is set', () => {
    delete process.env.PHANERIS_FEATURE_EMBEDDED_SERVER;

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled honors explicit override true', () => {
    process.env.PHANERIS_FEATURE_EMBEDDED_SERVER = '1';

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override false', () => {
    process.env.PHANERIS_FEATURE_EMBEDDED_SERVER = '0';

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  // Sharing sends user content to services we do not own, so "off unless asked
  // for" is the contract these two guard — not merely the current setting.
  it('isPagesSharingEnabled defaults to disabled', () => {
    delete process.env.PHANERIS_FEATURE_PAGES_SHARING;

    expect(isPagesSharingEnabled()).toBe(false);
  });

  it('isPagesSharingEnabled honors an explicit opt-in', () => {
    process.env.PHANERIS_FEATURE_PAGES_SHARING = '1';

    expect(isPagesSharingEnabled()).toBe(true);
  });

  it('isPagesSharingEnabled honors an explicit opt-out', () => {
    process.env.PHANERIS_FEATURE_PAGES_SHARING = '0';

    expect(isPagesSharingEnabled()).toBe(false);
  });

  it('isSessionSharingEnabled defaults to disabled', () => {
    delete process.env.PHANERIS_FEATURE_SESSION_SHARING;

    expect(isSessionSharingEnabled()).toBe(false);
  });

  it('isSessionSharingEnabled honors an explicit opt-in', () => {
    process.env.PHANERIS_FEATURE_SESSION_SHARING = '1';

    expect(isSessionSharingEnabled()).toBe(true);
  });

  it('isSessionSharingEnabled honors an explicit opt-out', () => {
    process.env.PHANERIS_FEATURE_SESSION_SHARING = '0';

    expect(isSessionSharingEnabled()).toBe(false);
  });
});
