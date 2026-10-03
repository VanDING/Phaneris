#!/usr/bin/env bun
/**
 * check-python-runtime-pin.ts — the Python tool runtime is pinned in three
 * places, and they must agree.
 *
 * The PEP 723 tool scripts run through `uv run --python <version>`. That version
 * decides which CPython patch every user's document tools execute on, and it
 * appears in:
 *
 *   1. `TOOL_PYTHON_VERSION` in packages/session-tools-core — what the app
 *      passes when it resolves the Python runtime itself.
 *   2. apps/electron/resources/bin/*{,.cmd} — the direct-invocation wrappers.
 *   3. `UV_VERSION` in scripts/build/common.ts — the uv that interprets the
 *      request, plus the binary actually checked in under resources/bin.
 *
 * Why an exact patch rather than `3.12`: uv prefers an already-installed
 * managed interpreter over a newer download. A machine that once cached
 * cpython-3.12.12 keeps running 3.12.12 forever, because `--python 3.12` is
 * satisfied by it — so a plain minor-version request silently ages out of the
 * security baseline. An exact patch either matches the cached interpreter or
 * downloads it. This check exists so that guarantee cannot rot unnoticed.
 *
 * Usage:
 *   bun run scripts/check-python-runtime-pin.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UV_VERSION } from './build/common';
import { TOOL_PYTHON_VERSION } from '../packages/session-tools-core/src/runtime/resolve-script-runtime';

const ROOT = join(import.meta.dir, '..');
const BIN_DIR = join(ROOT, 'apps', 'electron', 'resources', 'bin');
const RESOLVER = join(ROOT, 'packages', 'session-tools-core', 'src', 'runtime', 'resolve-script-runtime.ts');

/** An exact patch, never a bare minor (`3.12`) or a range. */
const EXACT_PATCH = /^\d+\.\d+\.\d+$/;

const failures: string[] = [];

if (!EXACT_PATCH.test(TOOL_PYTHON_VERSION)) {
  failures.push(
    `TOOL_PYTHON_VERSION is "${TOOL_PYTHON_VERSION}" but must be an exact patch ` +
      `(e.g. 3.12.15) so uv cannot keep serving a stale cached interpreter.`,
  );
}

// The resolver must route every python3 branch through the constant.
const resolverSource = readFileSync(RESOLVER, 'utf8');
if (/'--python',\s*'/.test(resolverSource)) {
  failures.push(
    `${RESOLVER} still contains a literal --python version; use TOOL_PYTHON_VERSION.`,
  );
}

// Every wrapper that invokes uv must request exactly that patch.
const WRAPPER_PATTERN = /--python\s+(\S+)/g;
const wrappers = existsSync(BIN_DIR)
  ? readdirSync(BIN_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort()
  : [];

let wrappersChecked = 0;
for (const name of wrappers) {
  const source = readFileSync(join(BIN_DIR, name), 'utf8');
  for (const match of source.matchAll(WRAPPER_PATTERN)) {
    wrappersChecked += 1;
    if (match[1] !== TOOL_PYTHON_VERSION) {
      failures.push(
        `apps/electron/resources/bin/${name} requests --python ${match[1]}, ` +
          `but TOOL_PYTHON_VERSION is ${TOOL_PYTHON_VERSION}.`,
      );
    }
  }
}
if (wrappersChecked === 0) {
  failures.push(`No uv wrapper under ${BIN_DIR} pins a --python version; the check would be vacuous.`);
}

// The bundled binary must be the uv the release build declares, for every
// platform whose binary is checked in.
const stamped: string[] = [];
for (const entry of existsSync(join(BIN_DIR)) ? readdirSync(BIN_DIR, { withFileTypes: true }) : []) {
  if (!entry.isDirectory()) continue;
  const stamp = join(BIN_DIR, entry.name, 'uv.exe.version');
  const posixStamp = join(BIN_DIR, entry.name, 'uv.version');
  const stampPath = existsSync(stamp) ? stamp : existsSync(posixStamp) ? posixStamp : null;
  if (!stampPath) continue;
  const version = readFileSync(stampPath, 'utf8').trim();
  stamped.push(`${entry.name}=${version}`);
  if (version !== UV_VERSION) {
    failures.push(
      `Bundled uv for ${entry.name} is ${version} (${stampPath}), ` +
        `but scripts/build/common.ts declares ${UV_VERSION}. Re-run the build download step.`,
    );
  }
}
if (stamped.length === 0) {
  failures.push(`No bundled uv version stamp found under ${BIN_DIR}; the check would be vacuous.`);
}

if (failures.length > 0) {
  console.error('Python runtime pin check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Python runtime pin OK: tools run CPython ${TOOL_PYTHON_VERSION} via uv ${UV_VERSION} ` +
    `(${wrappersChecked} wrapper invocation(s); bundled ${stamped.join(', ')}).`,
);
