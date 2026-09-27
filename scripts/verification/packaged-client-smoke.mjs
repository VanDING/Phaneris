/**
 * Packaged-client launch smoke test.
 *
 * The artifact checks in `packaged-client-verification.mjs` prove the bundle is
 * built correctly; this proves it RUNS. An Electron package can pass every
 * structural check and still die on launch — a missing native module, a resource
 * staged at a path the runtime never resolves, a preload that throws — and the
 * failure is invisible until someone double-clicks it.
 *
 * It launches the packaged binary directly (not via `open`/`start`, which
 * detach), against a scratch data root, watches it for a grace period, and
 * asserts:
 *   - the main process is still alive (no crash-on-boot),
 *   - Chromium spawned renderer/GPU helpers, which only happens once a window
 *     actually loads,
 *   - the runtime created its userData directory,
 *   - first-run initialization wrote the app-level config.json — the one signal
 *     that the app's own main code ran (see the marker comment below),
 *   - nothing fatal reached stdout/stderr.
 *
 * The process is always terminated and the scratch root deleted, so this never
 * leaves the app running or the machine's real data touched.
 *
 * Results are written per platform — docs/verification/results/packaged-client-smoke.json (macOS) or
 * docs/verification/results/packaged-client-smoke-win.json (Windows) — so one platform's run never
 * overwrites another's evidence.
 *
 * Usage:
 *   node scripts/verification/packaged-client-smoke.mjs [--grace=25000] [--arch=x64]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, openSync, closeSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(ROOT)
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const arch = arg('arch', 'x64')
const graceMs = Number(arg('grace', '25000'))
const isWindows = process.platform === 'win32'
const ARTIFACT_SUFFIX = { win32: '-win' }[process.platform] ?? ''
const outputPath = join(ROOT, 'docs/verification/results', `packaged-client-smoke${ARTIFACT_SUFFIX}.json`)

const identity = JSON.parse(readFileSync(join(ROOT, 'phaneris.identity.json'), 'utf8'))
/**
 * Marker that the app's OWN main code ran, as opposed to Electron merely staying
 * alive with an error window: with `dist/main.cjs` deleted the app still starts,
 * still spawns renderer helpers and still creates its userData directory, so
 * process counts and directory existence cannot tell the two apart.
 *
 * It is the app-level `config.json` inside an EMPTY data root created for this
 * launch and deleted afterwards (`<ENV_PREFIX>CONFIG_DIR`, the documented
 * multi-instance switch — see packages/shared/src/config/paths.ts). Pointing at
 * the machine's real data root instead is wrong twice over: every config.json
 * write in this codebase is conditional on stored data being missing or changed
 * (the saveConfig callers in config/storage.ts), so a launch that finds a
 * healthy config legitimately leaves the file untouched — the first version of
 * this smoke only advanced because that machine happened to hold stale data —
 * and it cannot run twice against the same state. With an empty root, first-run
 * initialization MUST write config.json.
 */
const bootRootDir = mkdtempSync(join(tmpdir(), 'phaneris-smoke-'))
const bootMarker = join(bootRootDir, 'config.json')
const statMtime = (path) => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

const appPath = isWindows
  ? join(ROOT, 'apps', 'electron', 'release', 'win-unpacked')
  : join(ROOT, 'apps', 'electron', 'release', `mac${arch === 'arm64' ? '-arm64' : ''}`, `${identity.product.name}.app`)
const binary = isWindows
  ? join(appPath, `${identity.product.name}.exe`)
  : join(appPath, 'Contents', 'MacOS', identity.product.name)
const userDataDir = isWindows
  ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), identity.runtime.userDataDirName)
  : join(homedir(), 'Library', 'Application Support', identity.runtime.userDataDirName)

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
  const buildHint = isWindows
    ? 'powershell -ExecutionPolicy Bypass -File apps/electron/scripts/build-win.ps1'
    : `bash apps/electron/scripts/build-dmg.sh ${arch}`
  console.error(`packaged binary not found: ${binary}\nBuild it first: ${buildHint}`)
  process.exit(2)
}

const bootMarkerBefore = statMtime(bootMarker)
const logFile = join(ROOT, '.cache', 'verification', `packaged-client-smoke${ARTIFACT_SUFFIX}.log`)
mkdirSync(join(ROOT, '.cache', 'verification'), { recursive: true })
const fd = openSync(logFile, 'w')
const child = spawn(binary, [], {
  // `open`/`start` would detach and hide the exit code; running the executable
  // directly keeps the process handle and its stdio.
  stdio: ['ignore', fd, fd],
  detached: false,
  env: { ...process.env, [`${identity.runtime.envPrefix}CONFIG_DIR`]: bootRootDir },
})
closeSync(fd)

/**
 * All processes living inside the bundle: the main binary plus the Chromium
 * helpers. On macOS the helpers are NOT under `Contents/MacOS/` — Electron
 * launches them from `Contents/Frameworks/<Product> Helper*.app/Contents/MacOS/…`,
 * so a pattern that only looks beside the main binary sees a single process even
 * on a healthy boot. On Windows Electron re-launches the same image
 * (`<Product>.exe`) from the same directory, so the executable path scopes the
 * bundle without matching an unrelated installed copy of the app.
 */
const bundleProcesses = () => {
  if (isWindows) {
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='${identity.product.name}.exe'" | ` +
      `Where-Object { $_.ExecutablePath -like '${appPath}\\*' } | ForEach-Object { $_.ProcessId }`
    const probe = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
    // A failed probe is not "no processes": reporting zero here would fail the
    // renderer check with a message that blames the app instead of the probe.
    if (probe.status !== 0) throw new Error(`process probe failed: ${(probe.stderr ?? probe.error?.message ?? '').trim().slice(0, 300)}`)
    return (probe.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  }
  const patterns = [
    `${appPath}/Contents/MacOS/${identity.product.name}`,
    `${appPath}/Contents/Frameworks/`,
  ]
  const pids = new Set()
  for (const pattern of patterns) {
    // pgrep exits 1 when nothing matches, which execFileSync would throw on; an
    // empty list is a normal answer here.
    const probe = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
    if (probe.status !== 0 && probe.status !== 1) {
      throw new Error(`process probe failed: ${(probe.stderr ?? probe.error?.message ?? '').trim().slice(0, 300)}`)
    }
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
let processes = []
let probeError = null
if (alive) {
  try {
    processes = bundleProcesses()
  } catch (error) {
    probeError = error instanceof Error ? error.message : String(error)
  }
}
const output = readFileSync(logFile, 'utf8')
// Signals that indicate a real boot failure rather than ordinary chatter.
const fatalPatterns = [
  /Uncaught Exception/i,
  /Cannot find module/i,
  /MODULE_NOT_FOUND/i,
  /Failed to load resource: net::ERR_FILE_NOT_FOUND/i,
  /A JavaScript error occurred in the main process/i,
  ...(isWindows
    ? [
        // Windows equivalent of the macOS loader errors below: a native module or
        // a spawned child that the bundle does not actually contain.
        /The specified module could not be found/i,
        /is not recognized as an internal or external command/i,
        /0xC0000005/, // access violation — the packaged binary itself faulted
      ]
    : [
        /dyld: /i,
        /Library not loaded/i,
        /ENOENT.*Resources\//i,
      ]),
]
const fatalHits = fatalPatterns.flatMap((pattern) => {
  const match = output.match(pattern)
  return match ? [`${pattern.source} → ${match[0]}`] : []
})

// Terminate before asserting so a failure never leaves the app running.
let stopped = true
let stopError = null
if (alive) {
  if (isWindows) {
    // Node's kill() maps to TerminateProcess on Windows; renderer/GPU helpers are
    // children of the main process and normally go down with it, so this only
    // mops up survivors.
    child.kill()
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500))
    try {
      for (const pid of bundleProcesses()) {
        spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' })
      }
    } catch {
      // Probe failed; the post-condition check below reports it.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  } else {
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
  }
  stopped = true
  try {
    stopped = bundleProcesses().length === 0
  } catch (error) {
    stopped = false
    stopError = error instanceof Error ? error.message : String(error)
  }
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
  assert(!probeError, probeError ?? '')
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

check('main process booted and initialized its config', bootMarker, () => {
  const after = statMtime(bootMarker)
  assert(existsSync(userDataDir), `missing ${userDataDir} — the main process never reached app-ready`)
  assert(
    after > bootMarkerBefore,
    `${bootMarker} was not written during the launch — the app's own main code never ran (Electron can stay alive showing an error window)`,
  )
})

check('process was terminated cleanly after the test', 'no stray processes', () => {
  assert(stopped, stopError ?? 'a Phaneris process survived termination')
})

// The launch ran against a scratch data root; leave the machine as it was found.
rmSync(bootRootDir, { recursive: true, force: true })

const failed = results.checks.filter((entry) => entry.status === 'fail')
mkdirSync(join(ROOT, 'docs/verification/results'), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`)
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed — wrote ${outputPath}`)
process.exit(failed.length ? 1 : 0)
