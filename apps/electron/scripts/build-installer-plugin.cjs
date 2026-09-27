#!/usr/bin/env node
/**
 * Compile the installer's NSIS plugin on its own: `bun run installer:plugin`.
 *
 * `apps/electron/installer/window-frame.cpp` is normally built by
 * electron-builder's `beforeBuild` hook, which means every C++ edit costs a full
 * packaging run to test. This is the same build without the packaging, so the
 * compile-and-inspect loop for the plugin is seconds long and `dumpbin
 * /exports` can be pointed at the result.
 *
 * It shares one implementation with the hook rather than duplicating the MSVC
 * invocation: see scripts/prepare-windows-installer.cjs.
 *
 * Usage: bun run installer:plugin
 */
const { buildInstallerPlugin, DLL } = require('./prepare-windows-installer.cjs')

try {
  buildInstallerPlugin({ quiet: true })
  console.log(`  • installer skin: ${DLL}`)
} catch (error) {
  console.error(`installer:plugin: ${error.message}`)
  process.exit(1)
}
