#!/usr/bin/env node
/**
 * Seed @electron/get's artifact cache for an offline/reachable-mirror build.
 *
 * electron-builder's packing step injects a non-proprietary FFMPEG dll by
 * downloading `ffmpeg-v<electron>-<platform>-<arch>.zip` through @electron/get.
 * It does not forward the `electronDownload` mirror for that call, so the URL
 * resolves to github.com/electron/electron/releases/download — unreachable from
 * this network, where the download stalls for the full 10-minute request
 * timeout and packaging fails after Electron itself already downloaded fine.
 *
 * @electron/get keys its cache by SHA-256 of the resolved directory URL and
 * validates the artifact against `SHASUMS256.txt` fetched from the same
 * directory — on every build, even on a cache hit, unless inline checksums are
 * supplied. electron-builder supplies them when a `SHASUMS256.txt-<version>` is
 * seeded at the cache root (its documented air-gapped contract). So a complete
 * seed is:
 *
 *   <cacheRoot>/SHASUMS256.txt-<version>              inline checksums, offline validation
 *   <cacheRoot>/<sha256(github dir url)>/<file>.zip    the artifacts themselves
 *
 * Run before packaging when the build network cannot reach GitHub releases:
 *   node scripts/verification/seed-electron-artifacts.cjs
 *
 * Flags:
 *   --platform=<name> --arch=<name> --version=<ver> --mirror=<url> --check
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')

function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const VERSION = arg('version', process.env.PHANERIS_ELECTRON_VERSION || '44.5.1')
const PLATFORM = arg('platform', 'win32')
const ARCH = arg('arch', 'x64')
const MIRROR = arg('mirror', process.env.PHANERIS_ELECTRON_MIRROR || 'https://registry.npmmirror.com/-/binary/electron/')
const GITHUB = 'https://github.com/electron/electron/releases/download/'
const checkOnly = process.argv.includes('--check')

const cacheRoot =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches', 'electron')
    : process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache')
      : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'electron')

/** Mirrors @electron/get's Cache.getCacheDirectory exactly. */
function cacheKey(downloadUrl) {
  const parsed = new URL(downloadUrl)
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = path.posix.dirname(parsed.pathname)
  return crypto.createHash('sha256').update(parsed.toString()).digest('hex')
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function download(url, destination) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destination))
}

async function main() {
  console.log(`Seeding @electron/get cache for electron ${VERSION} (${PLATFORM}-${ARCH})`)
  console.log(`  cacheRoot: ${cacheRoot}`)
  console.log(`  mirror:    ${MIRROR}`)

  const artifacts = ['ffmpeg', 'electron'].map(name => {
    const file = `${name}-v${VERSION}-${PLATFORM}-${ARCH}.zip`
    // electron-builder resolves these through the GitHub URL because it does not
    // forward a mirror, so the cache key must be the GitHub-derived one.
    //
    // @electron/get inserts a `v` between the base and the version
    // (artifact-utils.ts: `path = mirrorVar('customDir', opts, details.version)`
    // where details.version came from normalizeVersion), so the real URL is
    // .../download/v<version>/<file>, NOT .../download/<version>/<file>. Using
    // the un-prefixed path seeds a directory nothing ever reads.
    const githubUrl = `${GITHUB}v${VERSION}/${file}`
    return { name, file, githubUrl, key: cacheKey(githubUrl), target: path.join(cacheRoot, cacheKey(githubUrl), file) }
  })

  if (checkOnly) {
    let ok = true
    for (const a of artifacts) {
      const present = fs.existsSync(a.target)
      console.log(`  ${present ? 'OK  ' : 'MISS'} ${a.name}: ${a.target}`)
      if (!present) ok = false
    }
    const shasums = path.join(cacheRoot, `SHASUMS256.txt-${VERSION}`)
    const hasShasums = fs.existsSync(shasums)
    console.log(`  ${hasShasums ? 'OK  ' : 'MISS'} SHASUMS256.txt-${VERSION}: ${shasums}`)
    if (!hasShasums) ok = false
    if (!ok) process.exitCode = 1
    return
  }

  const shasumsPath = path.join(cacheRoot, `SHASUMS256.txt-${VERSION}`)
  if (!fs.existsSync(shasumsPath)) {
    console.log(`  fetching SHASUMS256.txt-${VERSION} from the mirror`)
    await download(`${MIRROR}${VERSION}/SHASUMS256.txt`, shasumsPath)
  }
  const shasums = fs.readFileSync(shasumsPath, 'utf8')

  for (const artifact of artifacts) {
    if (fs.existsSync(artifact.target)) {
      console.log(`  ${artifact.name}: already seeded`)
      continue
    }
    const mirrorUrl = `${MIRROR}${VERSION}/${artifact.file}`
    console.log(`  ${artifact.name}: downloading ${mirrorUrl}`)
    await download(mirrorUrl, artifact.target)

    // The mirror copy must match the checksum electron-builder will validate
    // against, otherwise the seeded cache is worse than a failed download.
    const expected = new RegExp(`^([a-f0-9]{64})\\s+\\*?${artifact.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(shasums)
    if (!expected) {
      console.error(`  ${artifact.name}: no SHASUMS entry for ${artifact.file}`)
      process.exitCode = 1
      return
    }
    const actual = await sha256(artifact.target)
    if (actual !== expected[1]) {
      fs.rmSync(artifact.target, { force: true })
      console.error(`  ${artifact.name}: checksum mismatch\n    expected ${expected[1]}\n    actual   ${actual}`)
      process.exitCode = 1
      return
    }
    console.log(`  ${artifact.name}: verified sha256 ${actual}`)
  }

  console.log('\nSeeded. electron-builder can now resolve both artifacts without GitHub.')
}

main().catch(error => {
  console.error('seed failed:', error.message)
  process.exitCode = 1
})
