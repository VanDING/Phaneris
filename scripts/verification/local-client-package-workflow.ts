/** Verify actual local macOS installers against the already exercised application. */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { DEFAULT_THEME_FILE } from '../../packages/shared/src/config/theme'

const root = resolve(import.meta.dir, '../..')
const argument = process.argv.find(arg => arg.startsWith('--release='))?.slice(10)
if (!argument) throw new Error('Usage: bun run scripts/verification/local-client-package-workflow.ts --release=/absolute/output/path')
const release = resolve(argument), app = join(release, 'mac/Phaneris.app')
const output = join(release, 'verification')
mkdirSync(output, { recursive: true })
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string
const dmg = join(release, `Phaneris-${version}-mac-x64.dmg`)
const zip = join(release, `Phaneris-${version}-mac-x64.zip`)
const records: Array<{ id: string; pass: boolean; observation?: unknown; error?: string }> = []
const hashes: Record<string, string> = {}
async function check(id: string, action: () => Promise<unknown> | unknown) {
  try { records.push({ id, pass: true, observation: await action() }) }
  catch (error) { records.push({ id, pass: false, error: String(error) }) }
}
function command(args: string[]) {
  const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
  assert.equal(result.exitCode, 0, `${args[0]}: ${result.stderr.toString().slice(-2000)}`)
  return result.stdout
}
async function sha256(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const resources = 'Contents/Resources/app/dist/resources/themes/default.json'
const rendererFiles = ['Contents/Resources/app/dist/renderer/index.html', ...readdirSync(join(app, 'Contents/Resources/app/dist/renderer/assets'))
  .filter(name => name.endsWith('.css')).map(name => `Contents/Resources/app/dist/renderer/assets/${name}`)]
await check('Application identity, version and x64 architecture match this local build', () => {
  const info = JSON.parse(command(['plutil', '-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]).toString())
  assert.equal(info.CFBundleShortVersionString, version)
  assert.equal(info.CFBundleIdentifier, 'io.github.vanding.phaneris')
  const architectures = command(['file', join(app, 'Contents/MacOS/Phaneris'), join(app, 'Contents/Resources/app/vendor/bun/bun')]).toString()
  assert(architectures.split('\n').filter(Boolean).every(line => line.includes('x86_64')))
  assert.deepEqual(JSON.parse(readFileSync(join(app, resources), 'utf8')), DEFAULT_THEME_FILE)
  return { version, bundleId: info.CFBundleIdentifier, architectures }
})
await check('Packaged application contains the current main, preload and renderer build', async () => {
  const files = ['main.cjs', 'bootstrap-preload.cjs', 'browser-toolbar-preload.cjs', 'interceptor.cjs', 'renderer/index.html']
  const walk = (directory: string, prefix: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(directory, entry.name), `${prefix}/${entry.name}`) : [`${prefix}/${entry.name}`])
  // electron-builder intentionally excludes source maps from distributed artifacts.
  files.push(...walk(join(root, 'apps/electron/dist/renderer/assets'), 'renderer/assets').filter(path => !path.endsWith('.map')))
  for (const path of files) {
    assert.equal(await sha256(join(app, 'Contents/Resources/app/dist', path)), await sha256(join(root, 'apps/electron/dist', path)), path)
  }
  return { matchedBuildFiles: files.length }
})
await check('ZIP archive is complete and contains the tested theme and compiled main process', async () => {
  assert(existsSync(zip))
  const integrity = command(['unzip', '-t', zip]).toString().trim().split('\n').at(-1)
  assert.deepEqual(JSON.parse(command(['unzip', '-p', zip, `Phaneris.app/${resources}`]).toString()), DEFAULT_THEME_FILE)
  const zippedMain = command(['unzip', '-p', zip, 'Phaneris.app/Contents/Resources/app/dist/main.cjs'])
  assert.equal(createHash('sha256').update(zippedMain).digest('hex'), await sha256(join(app, 'Contents/Resources/app/dist/main.cjs')))
  for (const path of rendererFiles) {
    const contents = command(['unzip', '-p', zip, `Phaneris.app/${path}`])
    assert.equal(createHash('sha256').update(contents).digest('hex'), await sha256(join(app, path)), path)
  }
  hashes[basename(zip)] = await sha256(zip)
  return { integrity, sha256: hashes[basename(zip)] }
})
await check('DMG verifies, mounts read-only and contains the tested application', async () => {
  assert(existsSync(dmg))
  command(['hdiutil', 'verify', dmg])
  const mount = mkdtempSync(join(output, 'dmg-mount-'))
  let mounted = false
  try {
    command(['hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]); mounted = true
    const mountedApp = join(mount, 'Phaneris.app')
    assert(existsSync(join(mount, 'Applications')))
    assert.deepEqual(JSON.parse(readFileSync(join(mountedApp, resources), 'utf8')), DEFAULT_THEME_FILE)
    for (const path of ['Contents/Info.plist', 'Contents/MacOS/Phaneris', 'Contents/Resources/app/dist/main.cjs',
      'Contents/Resources/app/dist/bootstrap-preload.cjs', 'Contents/Resources/app/resources/bin/darwin-x64/uv', ...rendererFiles])
      assert.equal(await sha256(join(mountedApp, path)), await sha256(join(app, path)), path)
  } finally { if (mounted) command(['hdiutil', 'detach', mount]) }
  hashes[basename(dmg)] = await sha256(dmg)
  return { readOnlyMount: true, sha256: hashes[basename(dmg)] }
})
writeFileSync(join(release, 'SHA256SUMS.txt'), Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}`).join('\n') + '\n')
writeFileSync(join(output, 'installers.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), version, app, release, records, hashes }, null, 2))
console.log(JSON.stringify({ records, hashes })); process.exit(records.every(record => record.pass) ? 0 : 1)
