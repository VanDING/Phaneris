/**
 * Packaged-client launch smoke test.
 *
 * The artifact checks in `packaged-client-verification.mjs` prove the bundle is
 * built correctly; this proves it RUNS. An Electron package can pass every
 * structural check and still die on launch — a missing native module, a resource
 * staged at a path the runtime never resolves, a preload that throws — and the
 * failure is invisible until someone double-clicks it.
 *
 * It launches the packaged binary directly (not via `open`, which detaches),
 * watches it for a grace period, and asserts:
 *   - the main process is still alive (no crash-on-boot),
 *   - Chromium spawned renderer/GPU helpers, which only happens once a window
 *     actually loads,
 *   - the runtime created its userData directory,
 *   - nothing fatal reached stdout/stderr.
 *
 * The process is always terminated, so this never leaves the app running.
 *
 * Usage:
 *   node plans/packaged-client-smoke.mjs [--grace=25000] [--arch=x64]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, openSync, closeSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const arch = arg('arch', 'x64')
const graceMs = Number(arg('grace', '25000'))
const outputPath = join(ROOT, 'plans', 'packaged-client-smoke.json')

const identity = JSON.parse(readFileSync(join(ROOT, 'phaneris.identity.json'), 'utf8'))
/**
 * Config the main process rewrites on every boot (read → migrate → persist).
 * Its mtime is the one signal that distinguishes "our code ran" from "Electron
 * opened an error window": with `dist/main.cjs` deleted the app still starts,
 * still spawns renderer helpers and still creates its userData directory, so
 * process counts and directory existence cannot tell the two apart. Verified
 * both ways — mtime advances on a healthy launch and does not move when the
 * entry point is missing.
 */
const bootMarker = join(homedir(), identity.runtime.dataDirName, 'config.json')
const statMtime = (path) => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}
const appPath = join(ROOT, 'apps', 'electron', 'release', `mac${arch === 'arm64' ? '-arm64' : ''}`, `${identity.product.name}.app`)
const binary = join(appPath, 'Contents', 'MacOS', identity.product.name)
const userDataDir = join(homedir(), 'Library', 'Application Support', identity.runtime.userDataDirName)

const results = { date: new Date().toISOString(), app: appPath, graceMs, checks: [] }
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
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

if (!existsSync(binary)) {
  console.error(`packaged binary not found: ${binary}\nBuild it first: bash apps/electron/scripts/build-dmg.sh ${arch}`)
  process.exit(2)
}

const bootMarkerBefore = statMtime(bootMarker)
const logFile = join(ROOT, 'plans', 'packaged-client-smoke.log')
const fd = openSync(logFile, 'w')
const child = spawn(binary, [], {
  // `open` would detach and hide the exit code; running the executable directly
  // keeps the process handle and its stdio.
  stdio: ['ignore', fd, fd],
  detached: false,
})
closeSync(fd)

/**
 * All processes living inside the bundle: the main binary plus the Chromium
 * helpers. Helpers are NOT under `Contents/MacOS/` — Electron launches them from
 * `Contents/Frameworks/<Product> Helper*.app/Contents/MacOS/…`, so a pattern that
 * only looks beside the main binary sees a single process even on a healthy boot.
 */
const bundleProcesses = () => {
  const patterns = [
    `${appPath}/Contents/MacOS/${identity.product.name}`,
    `${appPath}/Contents/Frameworks/`,
  ]
  const pids = new Set()
  for (const pattern of patterns) {
    // pgrep exits 1 when nothing matches, which execFileSync would throw on; an
    // empty list is a normal answer here.
    const probe = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
    for (const line of (probe.stdout ?? '').split('\n')) {
      const pid = line.trim()
      if (pid) pids.add(pid)
    }
  }
  return [...pids]
}

let spawnError = null
child.on('error', (error) => { spawnError = error })

await new Promise((resolvePromise) => setTimeout(resolvePromise, graceMs))

const alive = child.exitCode === null && !spawnError
const processes = alive ? bundleProcesses() : []
const output = readFileSync(logFile, 'utf8')
// Signals that indicate a real boot failure rather than ordinary chatter.
const fatalPatterns = [
  /Uncaught Exception/i,
  /Cannot find module/i,
  /MODULE_NOT_FOUND/i,
  /Failed to load resource: net::ERR_FILE_NOT_FOUND/i,
  /A JavaScript error occurred in the main process/i,
  /dyld: /i,
  /Library not loaded/i,
  /ENOENT.*Resources\//i,
]
const fatalHits = fatalPatterns.flatMap((pattern) => {
  const match = output.match(pattern)
  return match ? [`${pattern.source} → ${match[0]}`] : []
})

// Terminate before asserting so a failure never leaves the app running.
let stopped = true
if (alive) {
  child.kill('SIGTERM')
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500))
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }
  try {
    for (const pid of bundleProcesses()) process.kill(Number(pid), 'SIGKILL')
  } catch {
    // Already gone.
  }
  stopped = bundleProcesses().length === 0
}

results.exitCode = child.exitCode
results.signalCode = child.signalCode
results.processCount = processes.length
results.outputBytes = output.length

check('app launched and stayed alive without crashing', `alive for ${graceMs}ms`, () => {
  assert(!spawnError, `spawn failed: ${spawnError?.message}`)
  assert(alive, `process exited during the grace period (code=${child.exitCode}, signal=${child.signalCode})\n${output.slice(-800)}`)
})

check('Chromium spawned renderer and helper processes', `${processes.length} process(es) in the bundle`, () => {
  // A main process that never creates a window leaves exactly one process; a real
  // boot brings up renderer (and usually GPU/utility) helpers alongside it.
  assert(
    processes.length >= 2,
    `only ${processes.length} process(es) found — the window/renderer never came up\n${output.slice(-800)}`,
  )
})

check('no fatal errors on stdout/stderr', fatalHits.length ? fatalHits.join(' | ') : 'none', () => {
  assert(fatalHits.length === 0, `fatal output:\n  ${fatalHits.join('\n  ')}\n---\n${output.slice(-1200)}`)
})

check('main process booted and rewrote its config', bootMarker, () => {
  const after = statMtime(bootMarker)
  assert(existsSync(userDataDir), `missing ${userDataDir} — the main process never reached app-ready`)
  assert(
    after > bootMarkerBefore,
    `${bootMarker} was not rewritten during the launch (mtime ${bootMarkerBefore} → ${after}) — the app's own main code never ran (Electron can stay alive showing an error window)`,
  )
})

check('process was terminated cleanly after the test', 'no stray processes', () => {
  assert(stopped, 'a Phaneris process survived SIGTERM/SIGKILL')
})

const failed = results.checks.filter((entry) => entry.status === 'fail')
mkdirSync(join(ROOT, 'plans'), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`)
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed — wrote ${outputPath}`)
process.exit(failed.length ? 1 : 0)
