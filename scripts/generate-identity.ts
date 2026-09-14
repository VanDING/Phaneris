#!/usr/bin/env bun
/**
 * generate-identity.ts — render the Phaneris product identity into code and config.
 *
 * Reads `phaneris.identity.json` (single source of truth) and writes:
 *
 *   packages/shared/src/identity.generated.ts   runtime constants for every product surface
 *   apps/electron/identity.generated.yml        electron-builder identity, pulled in via `extends`
 *
 * Both outputs are committed. Run `bun run identity:check` in CI to prove they
 * are in sync — a stale generated file is a rebrand bug, not a formatting nit.
 *
 * Usage:
 *   bun run identity:generate
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import { ROOT, buildArtifacts, loadIdentity, IdentityError } from './identity-core.ts';

try {
  const identity = loadIdentity();
  const artifacts = buildArtifacts(identity);

  for (const artifact of artifacts) {
    mkdirSync(dirname(artifact.path), { recursive: true });
    writeFileSync(artifact.path, artifact.content, 'utf-8');
    console.log(
      `wrote ${relative(ROOT, artifact.path).replace(/\\/g, '/')} (${artifact.content.length} bytes)`,
    );
  }

  console.log(`identity OK: ${identity.product.name} (${identity.product.appId}, ${identity.product.scheme}://)`);
} catch (error) {
  if (error instanceof IdentityError) {
    console.error(`identity generation failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
