/**
 * Packaged-client verification.
 *
 * Inspects the artifacts `apps/electron/scripts/build-dmg.sh` produces and asserts
 * the things that silently go wrong in an Electron package: an identity that
 * drifted from `phaneris.identity.json`, a resource that only exists in the dev
 * tree (this repo has been bitten twice — `resources/bin` + `resources/scripts`
 * trapped inside app.asar, and the WhatsApp worker staged at a path the runtime
 * never resolves), a wrong architecture, or a version that no longer matches
 * package.json.
 *
 * Read-only: it never modifies the build output. Results are written to
 * plans/packaged-client-verification.json.
 *
 * Usage:
 *   node plans/packaged-client-verification.mjs [--arch=x64] [--expect-signed]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// `import.meta.dir` is Bun-only; this file runs under Node like the other
// plans/*.mjs verification scripts.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_DIR = join(ROOT, 'apps', 'electron')
const RELEASE_DIR = join(ELECTRON_DIR, 'release')
const OUTPUT = join(ROOT, 'plans', 'packaged-client-verification.json')

const argArch = process.argv.find((a) => a.startsWith('--arch='))?.slice('--arch='.length) ?? 'x64'
const expectSigned = process.argv.includes('--expect-signed')

const identity = JSON.parse(readFileSync(join(ROOT, 'phaneris.identity.json'), 'utf8'))
const electronPkg = JSON.parse(readFileSync(join(ELECTRON_DIR, 'package.json'), 'utf8'))
const expectedVersion = electronPkg.version

const results = { date: new Date().toISOString(), arch: argArch, expected: {}, checks: [] }
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

const dmgName = `Phaneris-${expectedVersion}-mac-${argArch}.dmg`
const dmgPath = join(RELEASE_DIR, dmgName)
const appPath = join(RELEASE_DIR, `mac${argArch === 'arm64' ? '-arm64' : ''}`, `${identity.product.name}.app`)
const resourcesDir = join(appPath, 'Contents', 'Resources')

// ------------------------------------------------------------------ artifacts ---
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

// ------------------------------------------------------------------- identity ---
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

// ------------------------------------------------------------------ integrity ---
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

// ------------------------------------------------------------------ resources ---
check('runtime resources are outside asar and present', 'bun, ripgrep, doc tools, subprocess workers', () => {
  // asar:false is load-bearing: child processes cannot execute files inside asar.
  const asar = join(resourcesDir, 'app.asar')
  assert(!existsSync(asar), 'app.asar exists — asar must stay disabled so child processes can execute resources')

  const required = [
    ['bundled bun runtime', join(resourcesDir, 'app', 'vendor', 'bun', 'bun')],
    ['pi agent server', join(resourcesDir, 'pi-agent-server')],
    ['whatsapp worker', join(resourcesDir, 'messaging-whatsapp-worker', 'worker.cjs')],
    ['cli document tools (bin)', join(resourcesDir, 'app', 'resources', 'bin')],
    ['cli document tools (scripts)', join(resourcesDir, 'app', 'resources', 'scripts')],
    ['node-pty native module', join(resourcesDir, 'app', 'node_modules', 'node-pty')],
  ]
  const missing = required.filter(([, path]) => !existsSync(path)).map(([label, path]) => `${label} (${path})`)
  assert(missing.length === 0, `missing resources:\n    ${missing.join('\n    ')}`)
  results.resources = required.map(([label]) => label)
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

const failed = results.checks.filter((entry) => entry.status === 'fail')
mkdirSync(join(ROOT, 'plans'), { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify(results, null, 2)}\n`)
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed — wrote ${OUTPUT}`)
process.exit(failed.length ? 1 : 0)
