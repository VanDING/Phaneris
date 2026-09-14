#!/usr/bin/env bun
/**
 * identity-core.ts — load, validate and render the Phaneris product identity.
 *
 * `phaneris.identity.json` at the repository root is the single source of truth
 * for every product identifier. This module is the only place that knows how to
 * turn it into code or config, so `scripts/generate-identity.ts` (writer) and
 * `scripts/check-identity.ts` (drift gate) can never disagree.
 *
 * Adding a new identifier means: extend the JSON, extend `scripts/identity.schema.json`,
 * extend the validator below, then regenerate. Never hardcode the value in a
 * consumer — import the generated module instead.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..');
export const IDENTITY_PATH = join(ROOT, 'phaneris.identity.json');
export const SCHEMA_PATH = join(ROOT, 'scripts', 'identity.schema.json');
export const GENERATED_TS_PATH = join(ROOT, 'packages', 'shared', 'src', 'identity.generated.ts');
export const GENERATED_BUILDER_PATH = join(ROOT, 'apps', 'electron', 'identity.generated.yml');

export interface Identity {
  product: {
    name: string;
    fullName: string;
    slug: string;
    description: string;
    appId: string;
    scheme: string;
  };
  packaging: {
    publisher: string;
    copyright: string;
    artifactName: string;
  };
  packages: { root: string; scope: string };
  cli: { name: string; docShorthand: string };
  runtime: {
    dataDirName: string;
    userDataDirName: string;
    envPrefix: string;
    previewSuffix: string;
  };
  repository: { url: string; plannedUrl: string; renamePerformed: boolean };
  services: {
    docsUrl: string | null;
    viewerUrl: string | null;
    updateFeedUrl: string | null;
    oauthRelayUrl: string | null;
    pagesShareApiUrl: string | null;
    supportUrl: string | null;
    telemetry: { enabled: boolean; dsn: string | null };
  };
  legacy: {
    note: string;
    dataDirName: string;
    userDataDirName: string;
    scheme: string;
    envPrefix: string;
    appId: string;
    packageScope: string;
  };
}

class IdentityError extends Error {}

const fail = (message: string): never => {
  throw new IdentityError(message);
};

const assertObject = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
};

const assertExactKeys = (value: Record<string, unknown>, path: string, keys: string[]): void => {
  const allowed = new Set([...keys, '$schema']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key} is not a recognised field`);
  }
  for (const key of keys) {
    if (!(key in value)) fail(`${path}.${key} is required`);
  }
};

const assertString = (value: unknown, path: string, pattern?: RegExp): string => {
  if (typeof value !== 'string' || value.length === 0) fail(`${path} must be a non-empty string`);
  if (pattern && !pattern.test(value)) {
    fail(`${path} = ${JSON.stringify(value)} does not match ${pattern}`);
  }
  return value;
};

const assertBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean`);
  return value;
};

const assertNullableUrl = (value: unknown, path: string): string | null => {
  if (value === null) return null;
  return assertString(value, path, /^https:\/\//);
};

/**
 * Validate the raw JSON. Deliberately strict and hand-written rather than
 * schema-library driven: the identity is small, every error message names the
 * exact JSON path, and the repo stays free of a build-time schema dependency.
 * `scripts/identity.schema.json` carries the same contract for editor support.
 */
export function parseIdentity(raw: unknown): Identity {
  const root = assertObject(raw, '<root>');
  assertExactKeys(root, '<root>', [
    'product',
    'packaging',
    'packages',
    'cli',
    'runtime',
    'repository',
    'services',
    'legacy',
  ]);

  const product = assertObject(root.product, 'product');
  assertExactKeys(product, 'product', ['name', 'fullName', 'slug', 'description', 'appId', 'scheme']);

  const packaging = assertObject(root.packaging, 'packaging');
  assertExactKeys(packaging, 'packaging', ['publisher', 'copyright', 'artifactName']);

  const packages = assertObject(root.packages, 'packages');
  assertExactKeys(packages, 'packages', ['root', 'scope']);

  const cli = assertObject(root.cli, 'cli');
  assertExactKeys(cli, 'cli', ['name', 'docShorthand']);

  const runtime = assertObject(root.runtime, 'runtime');
  assertExactKeys(runtime, 'runtime', ['dataDirName', 'userDataDirName', 'envPrefix', 'previewSuffix']);

  const repository = assertObject(root.repository, 'repository');
  assertExactKeys(repository, 'repository', ['url', 'plannedUrl', 'renamePerformed']);

  const services = assertObject(root.services, 'services');
  assertExactKeys(services, 'services', [
    'docsUrl',
    'viewerUrl',
    'updateFeedUrl',
    'oauthRelayUrl',
    'pagesShareApiUrl',
    'supportUrl',
    'telemetry',
  ]);

  const telemetry = assertObject(services.telemetry, 'services.telemetry');
  assertExactKeys(telemetry, 'services.telemetry', ['enabled', 'dsn']);

  const legacy = assertObject(root.legacy, 'legacy');
  assertExactKeys(legacy, 'legacy', [
    'note',
    'dataDirName',
    'userDataDirName',
    'scheme',
    'envPrefix',
    'appId',
    'packageScope',
  ]);

  const identity: Identity = {
    product: {
      name: assertString(product.name, 'product.name'),
      fullName: assertString(product.fullName, 'product.fullName'),
      slug: assertString(product.slug, 'product.slug', /^[a-z][a-z0-9-]*$/),
      description: assertString(product.description, 'product.description'),
      appId: assertString(product.appId, 'product.appId', /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/),
      scheme: assertString(product.scheme, 'product.scheme', /^[a-z][a-z0-9+.-]*$/),
    },
    packaging: {
      publisher: assertString(packaging.publisher, 'packaging.publisher'),
      copyright: assertString(packaging.copyright, 'packaging.copyright'),
      artifactName: assertString(packaging.artifactName, 'packaging.artifactName', /\$\{version\}/),
    },
    packages: {
      root: assertString(packages.root, 'packages.root', /^[a-z][a-z0-9-]*$/),
      scope: assertString(packages.scope, 'packages.scope', /^@[a-z][a-z0-9-]*$/),
    },
    cli: {
      name: assertString(cli.name, 'cli.name', /^[a-z][a-z0-9-]*$/),
      docShorthand: assertString(cli.docShorthand, 'cli.docShorthand'),
    },
    runtime: {
      dataDirName: assertString(runtime.dataDirName, 'runtime.dataDirName', /^\.[a-z][a-z0-9-]*$/),
      userDataDirName: assertString(runtime.userDataDirName, 'runtime.userDataDirName'),
      envPrefix: assertString(runtime.envPrefix, 'runtime.envPrefix', /^[A-Z][A-Z0-9_]*_$/),
      previewSuffix: assertString(runtime.previewSuffix, 'runtime.previewSuffix', /^[a-z][a-z0-9-]*$/),
    },
    repository: {
      url: assertString(repository.url, 'repository.url', /^https:\/\//),
      plannedUrl: assertString(repository.plannedUrl, 'repository.plannedUrl', /^https:\/\//),
      renamePerformed: assertBoolean(repository.renamePerformed, 'repository.renamePerformed'),
    },
    services: {
      docsUrl: assertNullableUrl(services.docsUrl, 'services.docsUrl'),
      viewerUrl: assertNullableUrl(services.viewerUrl, 'services.viewerUrl'),
      updateFeedUrl: assertNullableUrl(services.updateFeedUrl, 'services.updateFeedUrl'),
      oauthRelayUrl: assertNullableUrl(services.oauthRelayUrl, 'services.oauthRelayUrl'),
      pagesShareApiUrl: assertNullableUrl(services.pagesShareApiUrl, 'services.pagesShareApiUrl'),
      supportUrl: assertNullableUrl(services.supportUrl, 'services.supportUrl'),
      telemetry: {
        enabled: assertBoolean(telemetry.enabled, 'services.telemetry.enabled'),
        dsn: assertNullableUrl(telemetry.dsn, 'services.telemetry.dsn'),
      },
    },
    legacy: {
      note: assertString(legacy.note, 'legacy.note'),
      dataDirName: assertString(legacy.dataDirName, 'legacy.dataDirName'),
      userDataDirName: assertString(legacy.userDataDirName, 'legacy.userDataDirName'),
      scheme: assertString(legacy.scheme, 'legacy.scheme'),
      envPrefix: assertString(legacy.envPrefix, 'legacy.envPrefix'),
      appId: assertString(legacy.appId, 'legacy.appId'),
      packageScope: assertString(legacy.packageScope, 'legacy.packageScope'),
    },
  };

  // Cross-field invariants. These are the "frozen identity" rules: the whole
  // point of the config is that the new product can never alias the old one.
  const collisions: Array<[string, string, string]> = [
    ['product.appId', identity.product.appId, identity.legacy.appId],
    ['product.scheme', identity.product.scheme, identity.legacy.scheme],
    ['runtime.dataDirName', identity.runtime.dataDirName, identity.legacy.dataDirName],
    ['runtime.userDataDirName', identity.runtime.userDataDirName, identity.legacy.userDataDirName],
    ['runtime.envPrefix', identity.runtime.envPrefix, identity.legacy.envPrefix],
    ['packages.scope', identity.packages.scope, identity.legacy.packageScope],
  ];
  for (const [key, value, legacyValue] of collisions) {
    if (value === legacyValue) {
      fail(`${key} must differ from the upstream identifier — the new identity cannot alias the old one`);
    }
  }
  if (!identity.services.telemetry.enabled && identity.services.telemetry.dsn !== null) {
    fail('services.telemetry.dsn must be null while services.telemetry.enabled is false');
  }

  return identity;
}

export function loadIdentity(): Identity {
  let raw: string;
  try {
    raw = readFileSync(IDENTITY_PATH, 'utf-8');
  } catch {
    fail(`cannot read ${IDENTITY_PATH}`);
  }
  try {
    return parseIdentity(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`is not valid JSON: ${error.message}`);
    throw error;
  }
}

const tsString = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const yamlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const GENERATED_BANNER = (comment: string): string =>
  [
    `${comment} GENERATED FILE — DO NOT EDIT BY HAND.`,
    `${comment}`,
    `${comment} Source of truth: phaneris.identity.json (repository root)`,
    `${comment} Regenerate:      bun run identity:generate`,
    `${comment} Verify:          bun run identity:check`,
  ].join('\n');

/** Render `packages/shared/src/identity.generated.ts`. */
export function renderIdentityModule(identity: Identity): string {
  const { product, packaging, packages, cli, runtime, repository, services, legacy } = identity;
  const nullable = (value: string | null): string => (value === null ? 'null' : tsString(value));

  return `${GENERATED_BANNER('//')}
//
// Every product identifier the runtime needs is declared here exactly once, so
// that no module restates a brand string, app id, scheme or directory name.

/** Formal product name — packaged app name, window titles, OS application identity. */
export const PRODUCT_NAME = ${tsString(product.name)};
/** Long form for prose (about page, installer copy, README). Never used for file or bundle names. */
export const PRODUCT_FULL_NAME = ${tsString(product.fullName)};
/** Lowercase machine slug for directories, cache keys and lock names. */
export const PRODUCT_SLUG = ${tsString(product.slug)};
/** One-line product description for manifests and installer metadata. */
export const PRODUCT_DESCRIPTION = ${tsString(product.description)};

/** FROZEN. OS-level application identity (macOS bundle id, Windows AUMID/uninstall key). */
export const APP_ID = ${tsString(product.appId)};
/** FROZEN. Deep-link URL scheme. The upstream scheme is never claimed. */
export const DEEPLINK_SCHEME = ${tsString(product.scheme)};
/** Ready-made prefix for building deep links: \`\${DEEPLINK_SCHEME_PREFIX}settings\`. */
export const DEEPLINK_SCHEME_PREFIX = \`\${DEEPLINK_SCHEME}://\`;

/** electron-builder artifactName template, shared with the scripts that locate built installers. */
export const ARTIFACT_NAME_TEMPLATE = ${tsString(packaging.artifactName)};
/** Signing/publisher identity shown by installers. */
export const PUBLISHER = ${tsString(packaging.publisher)};
/** Copyright line for installers and the about page (maintainer + upstream attribution). */
export const COPYRIGHT = ${tsString(packaging.copyright)};

/** Root workspace package name. */
export const PACKAGE_NAME = ${tsString(packages.root)};
/** Internal npm scope for workspace packages. */
export const PACKAGE_SCOPE = ${tsString(packages.scope)};

/** Installed CLI binary name. */
export const CLI_NAME = ${tsString(cli.name)};
/** Documentation-only shorthand. Never installed as a second binary. */
export const CLI_SHORT_NAME = ${tsString(cli.docShorthand)};

/** FROZEN. Directory under the user home holding all application-owned data. */
export const DATA_DIR_NAME = ${tsString(runtime.dataDirName)};
/** FROZEN. Explicit Electron userData directory name. */
export const USER_DATA_DIR_NAME = ${tsString(runtime.userDataDirName)};
/** Prefix for every environment variable the product reads. */
export const ENV_PREFIX = ${tsString(runtime.envPrefix)};
/** Suffix required on app id, scheme, data directory and update cache for a preview channel. */
export const PREVIEW_SUFFIX = ${tsString(runtime.previewSuffix)};

/** Repository URL that is true today. */
export const REPOSITORY_URL = ${tsString(repository.url)};
/** Intended repository URL — only claim it once \`REPOSITORY_RENAME_PERFORMED\` is true. */
export const REPOSITORY_PLANNED_URL = ${tsString(repository.plannedUrl)};
/** Whether the remote repository rename has actually been executed. */
export const REPOSITORY_RENAME_PERFORMED = ${repository.renamePerformed ? 'true' : 'false'};

/**
 * Maintainer-owned service endpoints. \`null\` means the service is not ready:
 * the matching product surface must show an explicit unavailable state and must
 * never fall back to an upstream endpoint.
 */
export const SERVICE_URLS = {
  docs: ${nullable(services.docsUrl)},
  viewer: ${nullable(services.viewerUrl)},
  updateFeed: ${nullable(services.updateFeedUrl)},
  oauthRelay: ${nullable(services.oauthRelayUrl)},
  pagesShareApi: ${nullable(services.pagesShareApiUrl)},
  support: ${nullable(services.supportUrl)},
} as const;

/** Telemetry is off unless a maintainer-owned destination is explicitly configured. */
export const TELEMETRY_ENABLED = ${services.telemetry.enabled ? 'true' : 'false'};
/** Telemetry DSN — \`null\` while telemetry is disabled. Never an upstream DSN. */
export const TELEMETRY_DSN = ${nullable(services.telemetry.dsn)};

/**
 * Upstream identifiers, retained as READ-ONLY compatibility inputs for the data
 * import path and for deprecation diagnostics. The product never becomes them,
 * never writes to them, and never inherits credentials, data directories or
 * update feeds from them.
 */
export const LEGACY_IDENTITY = {
  dataDirName: ${tsString(legacy.dataDirName)},
  userDataDirName: ${tsString(legacy.userDataDirName)},
  scheme: ${tsString(legacy.scheme)},
  envPrefix: ${tsString(legacy.envPrefix)},
  appId: ${tsString(legacy.appId)},
  packageScope: ${tsString(legacy.packageScope)},
} as const;
`;
}

/** Render `apps/electron/identity.generated.yml`, consumed via `extends` in electron-builder.yml. */
export function renderBuilderIdentity(identity: Identity): string {
  const { product, packaging } = identity;
  return `${GENERATED_BANNER('#')}
#
# Pulled in by apps/electron/electron-builder.yml via \`extends\`. The identity
# keys live ONLY here, so electron-builder's merge order can never change the
# packaged application identity.

appId: ${yamlString(product.appId)}
productName: ${yamlString(product.name)}
copyright: ${yamlString(packaging.copyright)}
artifactName: ${yamlString(packaging.artifactName)}
`;
}

export interface GeneratedArtifact {
  path: string;
  render: (identity: Identity) => string;
}

export const ARTIFACTS: GeneratedArtifact[] = [
  { path: GENERATED_TS_PATH, render: renderIdentityModule },
  { path: GENERATED_BUILDER_PATH, render: renderBuilderIdentity },
];

/** All generated files, rendered from the current identity. */
export function buildArtifacts(identity: Identity): Array<{ path: string; content: string }> {
  return ARTIFACTS.map((artifact) => ({ path: artifact.path, content: artifact.render(identity) }));
}

export { IdentityError };
