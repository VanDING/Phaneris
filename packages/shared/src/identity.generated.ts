// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source of truth: phaneris.identity.json (repository root)
// Regenerate:      bun run identity:generate
// Verify:          bun run identity:check
//
// Every product identifier the runtime needs is declared here exactly once, so
// that no module restates a brand string, app id, scheme or directory name.

/** Formal product name — packaged app name, window titles, OS application identity. */
export const PRODUCT_NAME = 'Phaneris';
/** Long form for prose (about page, installer copy, README). Never used for file or bundle names. */
export const PRODUCT_FULL_NAME = 'Phaneris Agent';
/** Lowercase machine slug for directories, cache keys and lock names. */
export const PRODUCT_SLUG = 'phaneris';
/** One-line product description for manifests and installer metadata. */
export const PRODUCT_DESCRIPTION = 'Local AI workspace with durable, inspectable execution';

/** FROZEN. OS-level application identity (macOS bundle id, Windows AUMID/uninstall key). */
export const APP_ID = 'io.github.vanding.phaneris';
/** FROZEN. Deep-link URL scheme. The upstream scheme is never claimed. */
export const DEEPLINK_SCHEME = 'phaneris';
// Derived deep-link forms (`phaneris:` for URL.protocol comparisons, `phaneris://`
// for prefix checks) live in ./identity.ts, which applies the development-only
// PHANERIS_DEEPLINK_SCHEME override. Do not derive them here: a second,
// override-blind copy is how the registrar and the parser drift apart.

/** electron-builder artifactName template, shared with the scripts that locate built installers. */
export const ARTIFACT_NAME_TEMPLATE = 'Phaneris-${version}-${os}-${arch}.${ext}';
/** Signing/publisher identity shown by installers. */
export const PUBLISHER = 'VanDING';
/** Copyright line for installers and the about page (maintainer + upstream attribution). */
export const COPYRIGHT = 'Copyright © 2026 VanDING. Based on Craft Agents, Copyright © 2026 Craft Docs Ltd.';

/** Root workspace package name. */
export const PACKAGE_NAME = 'phaneris';
/** Internal npm scope for workspace packages. */
export const PACKAGE_SCOPE = '@phaneris';

/** Installed CLI binary name. */
export const CLI_NAME = 'phaneris';
/** Documentation-only shorthand. Never installed as a second binary. */
export const CLI_SHORT_NAME = 'phan';

/** FROZEN. Directory under the user home holding all application-owned data. */
export const DATA_DIR_NAME = '.phaneris';
/** FROZEN. Explicit Electron userData directory name. */
export const USER_DATA_DIR_NAME = 'Phaneris';
/** Prefix for every environment variable the product reads. */
export const ENV_PREFIX = 'PHANERIS_';
/** Suffix required on app id, scheme, data directory and update cache for a preview channel. */
export const PREVIEW_SUFFIX = 'preview';

/** Repository URL that is true today. */
export const REPOSITORY_URL = 'https://github.com/VanDING/Phaneris';
/** Intended repository URL — only claim it once `REPOSITORY_RENAME_PERFORMED` is true. */
export const REPOSITORY_PLANNED_URL = 'https://github.com/VanDING/Phaneris';
/** Whether the remote repository rename has actually been executed. */
export const REPOSITORY_RENAME_PERFORMED = true;

/**
 * Maintainer-owned service endpoints. `null` means the service is not ready:
 * the matching product surface must show an explicit unavailable state and must
 * never fall back to an upstream endpoint.
 */
export const SERVICE_URLS = {
  docs: null,
  viewer: null,
  updateFeed: null,
  oauthRelay: null,
  pagesShareApi: null,
  support: null,
} as const;

/** Telemetry is off unless a maintainer-owned destination is explicitly configured. */
export const TELEMETRY_ENABLED = false;
/** Telemetry DSN — `null` while telemetry is disabled. Never an upstream DSN. */
export const TELEMETRY_DSN = null;

/**
 * Upstream identifiers, retained as READ-ONLY compatibility inputs for the data
 * import path and for deprecation diagnostics. The product never becomes them,
 * never writes to them, and never inherits credentials, data directories or
 * update feeds from them.
 */
export const LEGACY_IDENTITY = {
  dataDirName: '.craft-agent',
  userDataDirName: 'Craft Agents',
  scheme: 'craftagents',
  envPrefix: 'CRAFT_',
  appId: 'com.lukilabs.craft-agent',
  packageScope: '@craft-agent',
} as const;
