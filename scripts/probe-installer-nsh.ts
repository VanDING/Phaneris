#!/usr/bin/env bun
/**
 * Compile the installer's NSIS half without packaging anything.
 *
 * `apps/electron/installer/probe.nsi` expands the same page macros
 * electron-builder's templates would, so a mistake in the page plumbing or a
 * `File` source that does not resolve shows up here in about a second instead of
 * after a five-minute packaging run. It is the cheapest feedback loop for
 * installer work, and it is not part of any release artefact.
 *
 * The one thing it cannot know is where electron-builder cached its NSIS plugin
 * bundle (nsis7z, StdUtils, UAC, ...) — that path is per-machine under
 * %LOCALAPPDATA% — so this script finds it and hands it to makensis as a define.
 * It also generates the same two custom-message includes electron-builder does,
 * using electron-builder's own generator, because the install-mode page renders
 * strings from them and a missing key is a fatal warning.
 *
 * Needs `apps/electron/installer-ui/windowframe.dll` to exist, because the script
 * `File`s it: run `bun run installer:plugin`, which compiles it on its own in a
 * few seconds.
 *
 * Usage: bun run scripts/probe-installer-nsh.ts
 */
import { existsSync, mkdtempSync, readdirSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const INSTALLER_DIR = join(ROOT, 'apps/electron/installer')
const UI_DIR = join(ROOT, 'apps/electron/installer-ui')
const CACHE = join(process.env.LOCALAPPDATA ?? '', 'electron-builder/Cache')

function fail(message: string): never {
  console.error(`probe: ${message}`)
  process.exit(1)
}

// Newest nsis build wins; electron-builder keeps several around.
const nsisRoot = join(CACHE, 'nsis')
if (!existsSync(nsisRoot)) fail(`no NSIS cache under ${nsisRoot}; run an electron-builder Windows build once`)
const makensis = readdirSync(nsisRoot)
  .map((name) => join(nsisRoot, name, 'makensis.exe'))
  .filter(existsSync)
  .sort()
  .pop()
if (!makensis) fail(`makensis.exe not found under ${nsisRoot}`)

// nsis-resources holds the plugin bundle; each extraction gets a random suffix.
const resourcesRoot = join(CACHE, 'nsis-resources-3.4.1')
if (!existsSync(resourcesRoot)) fail(`no nsis-resources cache under ${resourcesRoot}`)
const pluginDir = readdirSync(resourcesRoot)
  .map((name) => join(resourcesRoot, name, 'plugins/x86-unicode'))
  .filter(existsSync)
  .sort()
  .pop()
if (!pluginDir) fail(`no x86-unicode plugin dir under ${resourcesRoot}`)

// The script `File`s the plugin, so it must exist even though the probe never
// runs it. It is NOT stubbed: a text file named windowframe.dll compiles fine and
// then ships inside the installer, where NSIS cannot load it -- a failure that
// would only appear on a user's machine. `bun run installer:plugin` builds the
// real thing in a few seconds.
const dll = join(UI_DIR, 'windowframe.dll')
if (!existsSync(dll)) {
  fail(`${dll} does not exist; run "bun run installer:plugin" first`)
}

console.log(`probe: makensis    ${makensis}`)
console.log(`probe: plugin dir  ${pluginDir}`)

/**
 * Generate electron-builder's custom-message includes with electron-builder's
 * own generator.
 *
 * The real build calls `addCustomMessageFileInclude` twice, from the script
 * header, and the files it writes are a flat table of
 * `LangString <key> <lcid> "..."` lines. assistedMessages is not optional:
 * electron-builder's install-mode page function renders
 * `$(chooseInstallationOptions)` and the rest, and makensis fails the whole
 * compile with warning 6040 -- fatal under -WX -- for the first key it cannot
 * find. Hand-copying the table here would be a stub that drifts the moment
 * electron-builder's yml changes, so the generator is called instead; the only
 * thing this file supplies is the `getTempFile` method it asks a packager for.
 *
 * `installerLanguages` mirrors apps/electron/electron-builder.yml. A mismatch
 * would change which language ids the table carries, not whether the keys exist.
 */
async function generateCustomMessages(): Promise<string> {
  const require = createRequire(import.meta.url)
  // By absolute path: app-builder-lib's package "exports" map does not publish
  // these deep module paths, and the probe is not the place to depend on that.
  const nsisLang = require(join(ROOT, 'node_modules/app-builder-lib/out/targets/nsis/nsisLang.js'))
  const outDir = mkdtempSync(join(tmpdir(), 'phaneris-probe-'))
  const written: string[] = []
  const generator = { include: (file: string) => written.push(file) }
  // The generator asks for "messages.nsh" both times, so a naive implementation
  // would have the second file overwrite the first. electron-builder's real
  // getTempFile mints a unique name; this one has to as well.
  let minted = 0
  const packager = { getTempFile: async (name: string) => join(outDir, `${minted++}-${name}`) }
  const languages = new nsisLang.LangConfigurator({ installerLanguages: ['en_US', 'zh_CN'] })

  for (const input of ['messages.yml', 'assistedMessages.yml']) {
    await nsisLang.addCustomMessageFileInclude(input, packager, generator, languages)
    const generated = written[written.length - 1]
    if (!generated) fail(`electron-builder generated no file for ${input}`)
    // Renamed after its source so probe.nsi can include it by a stable name
    // rather than by a counter.
    renameSync(generated, join(outDir, input.replace('.yml', '.nsh')))
  }
  console.log(`probe: messages    ${outDir}`)
  return outDir
}

const messagesDir = await generateCustomMessages()
// A native UI fixture: real pages and plugin, no application installation.
const preview = process.argv.includes('--preview')

const result = spawnSync(
  makensis,
  [
    '/V2',
    // -WX is the point of the probe, not decoration: electron-builder runs
    // makensis with it, so a warning here is a failed packaging run there. A
    // probe without it passes on scripts the real build rejects.
    '-WX',
    // electron-builder also passes /NOCD and this charset.
    '/NOCD',
    ...(preview ? ['-DPHANERIS_UI_PREVIEW'] : []),
    `-DPHANERIS_NSIS_PLUGIN_DIR=${pluginDir}`,
    `-DPHANERIS_NSIS_MESSAGES_DIR=${messagesDir}`,
    'probe.nsi',
  ],
  {
    cwd: INSTALLER_DIR,
    stdio: 'inherit',
    // makensis is a console program; without this Windows gives it its own
    // console window, which reads as the screen flashing on every probe run.
    windowsHide: true,
  },
)

if (result.status !== 0) {
  fail(`makensis exited ${result.status}; the installer scripts did not compile`)
}
console.log('probe: installer scripts compile cleanly')

// Second pass. electron-builder compiles the script again with BUILD_UNINSTALLER
// for the uninstaller, and that pass is where installer-only functions become
// unreferenced -- NSIS reports each one as warning 6010, fatal under -WX. The
// two passes diverge enough that passing the first proves nothing about this one.
console.log('probe: uninstaller pass (BUILD_UNINSTALLER)')
const uninstaller = spawnSync(
  makensis,
  [
    '/V2',
    '-WX',
    '/NOCD',
    '-DBUILD_UNINSTALLER',
    `-DPHANERIS_NSIS_PLUGIN_DIR=${pluginDir}`,
    `-DPHANERIS_NSIS_MESSAGES_DIR=${messagesDir}`,
    'probe.nsi',
  ],
  { cwd: INSTALLER_DIR, stdio: 'inherit', windowsHide: true },
)

if (uninstaller.status !== 0) {
  fail(`makensis exited ${uninstaller.status} on the uninstaller pass`)
}
console.log('probe: both passes compile cleanly')
