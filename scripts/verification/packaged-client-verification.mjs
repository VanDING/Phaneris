/**
 * Packaged-client verification.
 *
 * Inspects the artifacts `apps/electron/scripts/build-dmg.sh` (macOS) and
 * `apps/electron/scripts/build-win.ps1` (Windows) produce and asserts the things
 * that silently go wrong in an Electron package: an identity that drifted from
 * `phaneris.identity.json`, a resource that only exists in the dev tree (this
 * repo has been bitten twice — `resources/bin` + `resources/scripts` trapped
 * inside app.asar, and the WhatsApp worker staged at a path the runtime never
 * resolves), a wrong architecture, or a version that no longer matches
 * package.json.
 *
 * Read-only: it never modifies the build output. Results are written to
 * docs/verification/results/packaged-client-verification.json (macOS) or
 * docs/verification/results/packaged-client-verification-win.json (Windows) — one artifact per
 * platform, so a Windows run cannot erase the recorded macOS evidence.
 *
 * The deep-link scheme is asserted on macOS only: there it lives in Info.plist
 * inside the bundle. On Windows electron-builder writes the scheme into the
 * registry from the installer, so it is verifiable only after installing —
 * that check belongs to an install-time test, not to this read-only pass.
 *
 * Usage:
 *   node scripts/verification/packaged-client-verification.mjs [--arch=x64] [--expect-signed]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// `import.meta.dir` is Bun-only; this file runs under Node like the other
// scripts/verification/*.mjs verification scripts.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(ROOT)
const ELECTRON_DIR = join(ROOT, 'apps', 'electron')
const RELEASE_DIR = join(ELECTRON_DIR, 'release')
const isWindows = process.platform === 'win32'
// `darwin` keeps the historical filename; other platforms get their own artifact
// so one platform's run never overwrites another's evidence.
const ARTIFACT_SUFFIX = { win32: '-win' }[process.platform] ?? ''
const OUTPUT = join(ROOT, 'docs/verification/results', `packaged-client-verification${ARTIFACT_SUFFIX}.json`)

const argArch = process.argv.find((a) => a.startsWith('--arch='))?.slice('--arch='.length) ?? 'x64'
const expectSigned = process.argv.includes('--expect-signed')
const unpackedOnly = process.argv.includes('--unpacked-only')

const identity = JSON.parse(readFileSync(join(ROOT, 'phaneris.identity.json'), 'utf8'))
const electronPkg = JSON.parse(readFileSync(join(ELECTRON_DIR, 'package.json'), 'utf8'))
const expectedVersion = electronPkg.version

const results = { date: new Date().toISOString(), arch: argArch, expected: {}, checks: [] }
results.scope = unpackedOnly ? 'unpacked resources and runtime; installer not verified' : 'full packaged artifacts'
function check(name, observation, run) {
  const record = { name, observation, status: 'pass', detail: null }
  try {
    run()
  } catch (error) {
    record.status = 'fail'
    record.detail = error instanceof Error ? error.message : String(error)
  }
  results.checks.push(record)
  console.log(`${record.status === 'pass' ? 'PASS' : 'FAIL'}  ${name}${record.detail ? ` — ${record.detail}` : ''}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
/** Reads a key from an Info.plist without assuming plutil output shape. */
function plistValue(plistPath, key) {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plistPath], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

results.expected = {
  version: expectedVersion,
  appId: identity.product.appId,
  productName: identity.product.name,
  scheme: identity.product.scheme,
  arch: argArch,
}

/** Shared by both platforms: asar must stay off so child processes can execute resources. */
function assertResourcesOutsideAsar(resourcesDir, required) {
  const asar = join(resourcesDir, 'app.asar')
  assert(!existsSync(asar), 'app.asar exists — asar must stay disabled so child processes can execute resources')
  const missing = required.filter(([, path]) => !existsSync(path)).map(([label, path]) => `${label} (${path})`)
  assert(missing.length === 0, `missing resources:\n    ${missing.join('\n    ')}`)
  results.resources = required.map(([label]) => label)
}

function verifyNoLegacyBridge(resourcesDir) {
  const candidates = [
    join(resourcesDir, 'bridge-mcp-server', 'index.js'),
    join(resourcesDir, 'resources', 'bridge-mcp-server', 'index.js'),
    join(resourcesDir, 'app', 'resources', 'bridge-mcp-server', 'index.js'),
    join(resourcesDir, 'app', 'dist', 'resources', 'bridge-mcp-server', 'index.js'),
  ]
  check('legacy bridge bundle is absent', candidates, () => {
    const present = candidates.filter((path) => existsSync(path))
    assert(present.length === 0, `obsolete bridge still packaged: ${present.join(', ')}`)
    results.legacyBridgeBundle = 'absent'
  })
}

function verifyMac() {
  const dmgName = `Phaneris-${expectedVersion}-mac-${argArch}.dmg`
  const dmgPath = join(RELEASE_DIR, dmgName)
  const appPath = join(RELEASE_DIR, `mac${argArch === 'arm64' ? '-arm64' : ''}`, `${identity.product.name}.app`)
  const resourcesDir = join(appPath, 'Contents', 'Resources')
  verifyNoLegacyBridge(resourcesDir)

  // ---------------------------------------------------------------- artifacts ---
  check('DMG exists with the expected versioned name', dmgName, () => {
    assert(existsSync(dmgPath), `missing ${dmgPath}`)
    const size = statSync(dmgPath).size
    // A wrong or truncated package is usually far smaller; the real one is ~200 MB.
    assert(size > 100 * 1024 * 1024, `DMG is only ${(size / 1e6).toFixed(1)} MB — likely truncated`)
    results.dmg = { path: dmgPath, bytes: size }
  })

  check('unpacked .app exists', appPath, () => {
    assert(existsSync(appPath), `missing ${appPath}`)
    results.app = appPath
  })

  // ----------------------------------------------------------------- identity ---
  check('bundle identity matches phaneris.identity.json', 'CFBundleIdentifier / name / version', () => {
    const plist = join(appPath, 'Contents', 'Info.plist')
    assert(existsSync(plist), `missing ${plist}`)
    const bundleId = plistValue(plist, 'CFBundleIdentifier')
    const version = plistValue(plist, 'CFBundleShortVersionString')
    const name = plistValue(plist, 'CFBundleName')
    assert(bundleId === identity.product.appId, `CFBundleIdentifier is "${bundleId}", expected "${identity.product.appId}"`)
    assert(version === expectedVersion, `CFBundleShortVersionString is "${version}", expected "${expectedVersion}"`)
    assert(name === identity.product.name, `CFBundleName is "${name}", expected "${identity.product.name}"`)
    results.identity = { bundleId, version, name }
  })

  check('registers the product deep-link scheme', `${identity.product.scheme}://`, () => {
    const plist = join(appPath, 'Contents', 'Info.plist')
    const types = execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' })
    const parsed = JSON.parse(types)
    const schemes = (parsed.CFBundleURLTypes ?? []).flatMap((entry) => entry.CFBundleURLSchemes ?? [])
    assert(
      schemes.includes(identity.product.scheme),
      `CFBundleURLSchemes is ${JSON.stringify(schemes)}, expected to include "${identity.product.scheme}"`,
    )
    // The upstream scheme must never be claimed by this product.
    assert(!schemes.includes('craftagents'), 'the upstream scheme must not be registered')
    results.schemes = schemes
  })

  // ---------------------------------------------------------------- integrity ---
  check('main binary is the expected architecture', argArch, () => {
    const binary = join(appPath, 'Contents', 'MacOS', identity.product.name)
    assert(existsSync(binary), `missing executable ${binary}`)
    const info = execFileSync('file', ['-b', binary], { encoding: 'utf8' }).trim()
    const wanted = argArch === 'arm64' ? 'arm64' : 'x86_64'
    assert(info.includes(wanted), `binary is "${info}", expected ${wanted}`)
    results.binary = info
  })

  check('code signature state', expectSigned ? 'signed' : 'unsigned (no certs available)', () => {
    let output
    try {
      output = execFileSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    const signed = /Authority=/.test(output)
    if (expectSigned) {
      assert(signed, `expected a signed bundle; codesign reported: ${output.trim().slice(0, 200)}`)
    } else {
      assert(!signed, `bundle is signed (${output.split('\n').find((l) => l.includes('Authority='))?.trim()}) but this run expected an unsigned local build`)
    }
    results.signature = signed ? 'signed' : 'unsigned'
  })

  // ---------------------------------------------------------------- resources ---
  check('runtime resources are outside asar and present', 'bun, ripgrep, doc tools, subprocess workers', () => {
    assertResourcesOutsideAsar(resourcesDir, [
      ['bundled bun runtime', join(resourcesDir, 'app', 'vendor', 'bun', 'bun')],
      ['pi agent server', join(resourcesDir, 'pi-agent-server')],
      ['codemode worker', join(resourcesDir, 'pi-agent-server', 'worker.js')],
      ['codemode WASM', join(resourcesDir, 'pi-agent-server', 'node_modules', 'quickjs-wasi', 'quickjs.wasm')],
      ['whatsapp worker', join(resourcesDir, 'messaging-whatsapp-worker', 'worker.cjs')],
      ['cli document tools (bin)', join(resourcesDir, 'app', 'resources', 'bin')],
      ['cli document tools (scripts)', join(resourcesDir, 'app', 'resources', 'scripts')],
      ['node-pty native module', join(resourcesDir, 'app', 'node_modules', 'node-pty')],
    ])
  })

  check('ripgrep ships for the packaged architecture', `@vscode/ripgrep-darwin-${argArch}`, () => {
    const dir = join(resourcesDir, 'app', 'node_modules', '@vscode')
    assert(existsSync(dir), `missing ${dir}`)
    const entries = readdirSync(dir)
    assert(entries.includes('ripgrep'), `@vscode/ripgrep missing (found: ${entries.join(', ')})`)
    const platformPkg = `ripgrep-darwin-${argArch}`
    assert(entries.includes(platformPkg), `${platformPkg} missing (found: ${entries.join(', ')})`)
    results.ripgrep = entries
  })

  check('renderer bundle shipped', 'index.html present under dist/renderer', () => {
    const index = join(resourcesDir, 'app', 'dist', 'renderer', 'index.html')
    assert(existsSync(index), `missing ${index}`)
    // Source maps are excluded on purpose; shipping them inflates the package.
    const maps = readdirSync(join(resourcesDir, 'app', 'dist', 'renderer')).filter((f) => f.endsWith('.map'))
    results.renderer = { index: true, sourceMaps: maps.length }
  })
}

/**
 * Runs a PowerShell snippet and returns its trimmed stdout ('' when it printed nothing).
 *
 * The encoding line is load-bearing: Windows PowerShell writes piped stdout as
 * GBK on a zh-CN system, so a Unicode product name or an error message would
 * reach the JSON artifact as mojibake.
 */
function powershell(script) {
  return execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`],
    { encoding: 'utf8' },
  ).trim()
}

/**
 * Machine type from the PE header. Read directly instead of shelling out: Windows
 * has no `file(1)`, and the optional-data directory is stable across PE32+.
 */
function peMachine(path) {
  const buf = readFileSync(path)
  assert(buf.length > 0x40, 'file is too small to be a PE image')
  const peOffset = buf.readUInt32LE(0x3c)
  assert(buf.readUInt32LE(peOffset) === 0x00004550, 'missing PE signature')
  return { 0x8664: 'x64', 0xaa64: 'arm64', 0x014c: 'x86' }[buf.readUInt16LE(peOffset + 4)] ?? 'unknown'
}

/**
 * Embedded-signature state from the PE security directory. Windows has no
 * `codesign`, and `Get-AuthenticodeSignature` (Microsoft.PowerShell.Security) is
 * not loadable in every environment — it failed on the machine this was written
 * on — so read the certificate table directly: an image carries an Authenticode
 * signature exactly when its security data directory is non-empty. Chain
 * validation is out of scope; this answers "was a certificate applied to this
 * build at all", which is what `--expect-signed` gates.
 */
function peSignatureState(path) {
  const buf = readFileSync(path)
  const optionalHeader = buf.readUInt32LE(0x3c) + 24
  assert(buf.readUInt16LE(optionalHeader) === 0x20b, 'not a PE32+ image')
  // Data directories start 112 bytes into the optional header; security is entry 4.
  const certTableSize = buf.readUInt32LE(optionalHeader + 112 + 4 * 8 + 4)
  return certTableSize > 0 ? 'signed' : 'unsigned'
}

function verifyWindows() {
  const installerName = `Phaneris-${expectedVersion}-win-${argArch}.exe`
  const installerPath = join(RELEASE_DIR, installerName)
  const appPath = join(RELEASE_DIR, 'win-unpacked')
  const exePath = join(appPath, `${identity.product.name}.exe`)
  const resourcesDir = join(appPath, 'resources')
  verifyNoLegacyBridge(resourcesDir)

  // ---------------------------------------------------------------- artifacts ---
  if (!unpackedOnly) check('NSIS installer exists with the expected versioned name', installerName, () => {
    assert(existsSync(installerPath), `missing ${installerPath}`)
    const size = statSync(installerPath).size
    // The bundle carries bun + uv + ripgrep; a wrong or truncated build is far smaller.
    assert(size > 100 * 1024 * 1024, `installer is only ${(size / 1e6).toFixed(1)} MB — likely truncated`)
    results.installer = { path: installerPath, bytes: size }
  })

  check('unpacked win-unpacked tree exists', appPath, () => {
    assert(existsSync(appPath), `missing ${appPath}`)
    assert(existsSync(exePath), `missing ${exePath}`)
    results.app = appPath
  })

  // ----------------------------------------------------------------- identity ---
  check('bundle identity matches phaneris.identity.json', 'VERSIONINFO / packaged package.json version', () => {
    assert(existsSync(exePath), `missing executable ${exePath}`)
    // Windows has no Info.plist: the identity the OS and Add/Remove Programs show
    // is the executable's VERSIONINFO, written by electron-builder from the same
    // generated identity file. CompanyName comes from apps/electron/package.json
    // author.name, which check-identity.ts pins to packaging.companyName.
    const raw = powershell(
      `$i = (Get-Item -LiteralPath '${exePath}').VersionInfo; "$($i.ProductName)|$($i.CompanyName)|$($i.FileVersion)|$($i.FileDescription)"`,
    )
    const [productName, companyName, fileVersion, fileDescription] = raw.split('|')
    const packagedPkg = JSON.parse(readFileSync(join(resourcesDir, 'app', 'package.json'), 'utf8'))
    assert(productName === identity.product.name, `VERSIONINFO ProductName is "${productName}", expected "${identity.product.name}"`)
    assert(companyName === identity.packaging.companyName, `VERSIONINFO CompanyName is "${companyName}", expected "${identity.packaging.companyName}"`)
    assert(packagedPkg.version === expectedVersion, `packaged package.json version is "${packagedPkg.version}", expected "${expectedVersion}"`)
    results.identity = { productName, companyName, version: packagedPkg.version, fileVersion, fileDescription }
  })

  // ---------------------------------------------------------------- integrity ---
  check('main binary is the expected architecture', argArch, () => {
    assert(existsSync(exePath), `missing executable ${exePath}`)
    const machine = peMachine(exePath)
    assert(machine === argArch, `PE machine type is "${machine}", expected "${argArch}"`)
    results.binary = `PE machine ${machine}`
  })

  check('code signature state', expectSigned ? 'signed' : 'unsigned (no certs available)', () => {
    const state = peSignatureState(exePath)
    if (expectSigned) {
      assert(state === 'signed', 'expected an Authenticode signature, but the PE security directory is empty')
    } else {
      assert(state === 'unsigned', 'executable carries an Authenticode signature but this run expected an unsigned local build')
    }
    results.signature = state
  })

  // ---------------------------------------------------------------- resources ---
  check('runtime resources are outside asar and present', 'bun, ripgrep, doc tools, subprocess workers', () => {
    assertResourcesOutsideAsar(resourcesDir, [
      ['bundled bun runtime', join(resourcesDir, 'app', 'vendor', 'bun', 'bun.exe')],
      ['pi agent server', join(resourcesDir, 'pi-agent-server')],
      ['codemode worker', join(resourcesDir, 'pi-agent-server', 'worker.js')],
      ['codemode WASM', join(resourcesDir, 'pi-agent-server', 'node_modules', 'quickjs-wasi', 'quickjs.wasm')],
      ['whatsapp worker', join(resourcesDir, 'messaging-whatsapp-worker', 'worker.cjs')],
      ['cli document tools (bin)', join(resourcesDir, 'app', 'resources', 'bin')],
      ['cli document tools (scripts)', join(resourcesDir, 'app', 'resources', 'scripts')],
      ['node-pty native module', join(resourcesDir, 'app', 'node_modules', 'node-pty')],
    ])
  })

  check('ripgrep ships for the packaged architecture', `@vscode/ripgrep-win32-${argArch}`, () => {
    const dir = join(resourcesDir, 'app', 'node_modules', '@vscode')
    assert(existsSync(dir), `missing ${dir}`)
    const entries = readdirSync(dir)
    assert(entries.includes('ripgrep'), `@vscode/ripgrep missing (found: ${entries.join(', ')})`)
    const platformPkg = `ripgrep-win32-${argArch}`
    assert(entries.includes(platformPkg), `${platformPkg} missing (found: ${entries.join(', ')})`)
    // The wrapper in @vscode/ripgrep holds no binary; the runtime resolves rg.exe
    // from the platform package, so a staged package without the binary still fails.
    assert(existsSync(join(dir, platformPkg, 'bin', 'rg.exe')), `${platformPkg}/bin/rg.exe missing`)
    results.ripgrep = entries
  })

  check('renderer bundle shipped', 'index.html present under dist/renderer', () => {
    const rendererDir = join(resourcesDir, 'app', 'dist', 'renderer')
    assert(existsSync(join(rendererDir, 'index.html')), `missing ${join(rendererDir, 'index.html')}`)
    // Source maps are excluded on purpose; shipping them inflates the package.
    const maps = readdirSync(rendererDir).filter((f) => f.endsWith('.map'))
    results.renderer = { index: true, sourceMaps: maps.length }
  })
}

if (isWindows) {
  verifyWindows()
} else {
  verifyMac()
}

const failed = results.checks.filter((entry) => entry.status === 'fail')
mkdirSync(join(ROOT, 'docs/verification/results'), { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify(results, null, 2)}\n`)
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed — wrote ${OUTPUT}`)
process.exit(failed.length ? 1 : 0)
