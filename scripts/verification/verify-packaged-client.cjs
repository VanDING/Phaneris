#!/usr/bin/env node
/**
 * Verify a packaged Phaneris Windows client.
 *
 * Packaging succeeds even when the bundle is missing externally-spawned
 * runtimes, because those are resolved at runtime from paths inside the
 * unpacked app — a regression here is invisible until a user opens a document
 * or a terminal. So this asserts the things that actually ship:
 *
 *   - the Electron runtime version matches electron-builder.yml
 *   - the bundled bun and uv binaries exist and self-report the pinned versions
 *   - the CLI document-tool wrappers and PEP 723 scripts are on disk OUTSIDE
 *     app.asar (child processes cannot execute from inside an asar archive)
 *   - the WhatsApp worker bundle, Pi agent server and ripgrep binary are staged
 *   - the native modules Electron will actually load are present
 *
 * Usage: node scripts/verification/verify-packaged-client.cjs [releaseDir]
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
const RELEASE = path.resolve(process.argv[2] || path.join(ROOT, 'apps/electron/release'))
const UNPACKED = path.join(RELEASE, 'win-unpacked')
const RES = path.join(UNPACKED, 'resources')
const OUT_DIR = path.resolve(process.env.PHANERIS_UPGRADE_ARTIFACTS || path.join(ROOT, '.cache/dependency-upgrade-20261003'))

const results = []
const record = (check, passed, detail) => results.push({ check, passed, ...(detail ? { detail } : {}) })

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

function runVersion(exe, args = ['--version']) {
  try {
    return execFileSync(exe, args, { encoding: 'utf8', timeout: 60_000 }).trim()
  } catch (error) {
    return `ERROR: ${error.message.split('\n')[0]}`
  }
}

function main() {
  if (!fs.existsSync(UNPACKED)) {
    // An installer-only run still lets us check the artifact itself.
    const installer = fs.readdirSync(RELEASE).filter(f => f.endsWith('.exe') && !f.includes('uninstaller'))
    record('installer-built', installer.length > 0, {
      files: fs.readdirSync(RELEASE),
      bytes: installer.map(f => fs.statSync(path.join(RELEASE, f)).size),
    })
    console.error('win-unpacked is absent; only installer-level checks ran. Re-run electron-builder without clean-up to inspect contents.')
    finish()
    return
  }

  // 1. Electron runtime version baked into the bundle.
  const expectedElectron = (readIfExists(path.join(ROOT, 'apps/electron/electron-builder.yml')) ?? '')
    .match(/^electronVersion:\s*"?([^"\s]+)"?\s*$/m)?.[1]
  const mainExe = path.join(UNPACKED, 'Phaneris.exe')
  record('electron-version-pinned', expectedElectron != null, { expectedElectron })
  record('app-bundle-present', fs.existsSync(RES), { resources: RES })
  record('main-executable', fs.existsSync(mainExe), {
    bytes: fs.existsSync(mainExe) ? fs.statSync(mainExe).size : null,
  })

  // Electron's dist carries no plain `version` file, so the shipped runtime is
  // read from the executable itself below (electron-runs-as-node).

  // 2. Bundled runtimes must exist and self-report.
  const bunExe = path.join(RES, 'app', 'vendor', 'bun', 'bun.exe')
  if (fs.existsSync(bunExe)) {
    const reported = runVersion(bunExe)
    const declared = JSON.parse(readIfExists(path.join(ROOT, 'package.json'))).packageManager.split('@')[1]
    record('bundled-bun', reported === declared, { reported, declared, bytes: fs.statSync(bunExe).size })
  } else {
    record('bundled-bun', false, { path: bunExe })
  }

  const uvExe = path.join(RES, 'app', 'resources', 'bin', 'win32-x64', 'uv.exe')
  if (fs.existsSync(uvExe)) {
    const reported = runVersion(uvExe, ['-V'])
    const expectedUv = (readIfExists(path.join(ROOT, 'scripts/build/common.ts')) ?? '')
      .match(/UV_VERSION = '([^']+)'/)?.[1]
    record('bundled-uv', reported.includes(expectedUv ?? '\u0000'), { reported, expectedUv })
  } else {
    record('bundled-uv', false, { path: uvExe })
  }

  // 3. CLI tool wrappers + scripts must be real files outside app.asar.
  const binDir = path.join(RES, 'app', 'resources', 'bin')
  const scriptsDir = path.join(RES, 'app', 'resources', 'scripts')
  const wrappers = ['pdf-tool.cmd', 'xlsx-tool.cmd', 'docx-tool.cmd', 'pptx-tool.cmd', 'img-tool.cmd', 'ical-tool.cmd', 'doc-diff.cmd', 'markitdown.cmd']
  const missingWrappers = wrappers.filter(w => !fs.existsSync(path.join(binDir, w)))
  record('cli-wrappers', missingWrappers.length === 0, { missing: missingWrappers, dir: binDir })

  const scripts = fs.existsSync(scriptsDir) ? fs.readdirSync(scriptsDir).filter(f => f.endsWith('.py')) : []
  record('python-tool-scripts', scripts.length >= 8, { count: scripts.length, scripts: scripts.sort() })

  // The pinned interpreter request must survive packaging.
  const pdfWrapper = readIfExists(path.join(binDir, 'pdf-tool.cmd')) ?? ''
  const pinnedPython = pdfWrapper.match(/--python\s+(\S+)/)?.[1]
  const expectedPython = (readIfExists(path.join(ROOT, 'packages/session-tools-core/src/runtime/resolve-script-runtime.ts')) ?? '')
    .match(/TOOL_PYTHON_VERSION = '([^']+)'/)?.[1]
  record('python-pin-in-package', pinnedPython === expectedPython, { pinnedPython, expectedPython })

  // 4. Subprocess bundles.
  const waWorker = path.join(RES, 'messaging-whatsapp-worker', 'worker.cjs')
  record('whatsapp-worker', fs.existsSync(waWorker), {
    bytes: fs.existsSync(waWorker) ? fs.statSync(waWorker).size : null,
  })

  const piBundle = path.join(RES, 'pi-agent-server', 'bundle.js')
  record('pi-agent-server', fs.existsSync(piBundle), {
    bytes: fs.existsSync(piBundle) ? fs.statSync(piBundle).size : null,
  })

  const rg = path.join(RES, 'app', 'node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg.exe')
  record('ripgrep-binary', fs.existsSync(rg), { bytes: fs.existsSync(rg) ? fs.statSync(rg).size : null })

  // 5. Native modules the Electron app actually loads.
  //
  // node-pty ships through extraResources because the integrated terminal needs
  // a real PTY. `sharp` deliberately does NOT: server-core's platform.ts routes
  // Electron to nativeImage and only the headless Node server imports sharp, so
  // asserting it here would demand a binary the desktop client never loads.
  const ptyDir = path.join(RES, 'app', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64')
  const ptyFiles = fs.existsSync(ptyDir) ? fs.readdirSync(ptyDir) : []
  record('native-node-pty', ptyFiles.some(f => f.endsWith('.node')), { dir: ptyDir, files: ptyFiles.slice(0, 6) })

  const platformSource = readIfExists(path.join(ROOT, 'packages/server-core/src/runtime/platform.ts')) ?? ''
  record('sharp-not-required-by-electron', /nativeImage/.test(platformSource), {
    note: 'Electron uses nativeImage; sharp belongs to the headless server bundle only',
  })

  // The app must be launchable as Node, which also reports the shipped runtime.
  if (fs.existsSync(mainExe)) {
    try {
      const out = execFileSync(mainExe, ['-e', 'process.stdout.write(process.versions.electron + "|" + process.versions.node + "|" + process.versions.chrome)'], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      }).trim()
      const [electronVersion, nodeVersion, chromeVersion] = out.split('|')
      record('electron-runtime-version', electronVersion === expectedElectron, {
        electronVersion,
        nodeVersion,
        chromeVersion,
        configured: expectedElectron,
      })
      // The audit's runtime alignment: Electron 44.x must embed Node 24.
      record('embedded-node-24', /^24\./.test(nodeVersion ?? ''), { nodeVersion })
    } catch (error) {
      record('electron-runtime-version', false, { error: error.message.split('\n')[0] })
    }
  }

  const failed = results.filter(r => !r.passed)
  finish(failed)
}

function finish(failed = results.filter(r => !r.passed)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, 'packaged-client.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), release: path.relative(ROOT, RELEASE), results }, null, 2) + '\n',
  )
  for (const r of results) console.log(`${r.passed ? 'OK  ' : 'FAIL'} ${r.check}${r.passed ? '' : ' ' + JSON.stringify(r.detail ?? {})}`)
  console.log(`\n${results.length - failed.length}/${results.length} packaged-client checks passed`)
  if (failed.length) process.exitCode = 1
}

main()
