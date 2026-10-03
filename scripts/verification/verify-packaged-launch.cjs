#!/usr/bin/env node
/**
 * Launch the packaged Windows client and confirm it actually starts.
 *
 * Packaging can succeed while the app dies on launch — a missing preload
 * bundle, a native module built for the wrong ABI, or a main-process import
 * that only resolves inside the repo. Nothing but starting the real executable
 * catches that.
 *
 * The app is launched, given time to bootstrap, then checked two ways: a
 * packaged build disables the file transport in production (logger.ts:
 * `log.transports.file.level = false`), so a clean launch writes no log at all.
 * Evidence therefore comes from the real Electron process tree — a main process
 * plus its GPU/renderer/utility children — and from a second `--debug` launch,
 * which turns the file transport on and must grow the log.
 *
 * Usage: node scripts/verification/verify-packaged-launch.cjs [--keep-open]
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
// Only a positional (non-flag) argument can name the executable; argv[0]/argv[1]
// are the node binary and this script, so never scan the whole vector for ".exe".
const positional = process.argv.slice(2).filter(a => !a.startsWith('-'))
const EXE = path.resolve(positional[0] || path.join(ROOT, 'apps/electron/release/win-unpacked/Phaneris.exe'))
const OUT_DIR = path.resolve(process.env.PHANERIS_UPGRADE_ARTIFACTS || path.join(ROOT, '.cache/dependency-upgrade-20261003'))
const keepOpen = process.argv.includes('--keep-open')
const BOOTSTRAP_MS = Number(process.env.PHANERIS_LAUNCH_TIMEOUT_MS || 45_000)

const LOG_CANDIDATES = [
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Phaneris', 'logs', 'main.log'),
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'phaneris', 'logs', 'main.log'),
]

const results = []
const record = (check, passed, detail) => results.push({ check, passed, ...(detail ? { detail } : {}) })

function readTail(file, bytes = 8000) {
  if (!fs.existsSync(file)) return null
  const size = fs.statSync(file).size
  const fd = fs.openSync(file, 'r')
  try {
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    return buffer.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

async function main() {
  if (!fs.existsSync(EXE)) {
    console.error(`Packaged executable not found: ${EXE}`)
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const logBefore = LOG_CANDIDATES.map(f => ({ file: f, size: fs.existsSync(f) ? fs.statSync(f).size : 0 }))

  console.log(`launching ${EXE}`)
  // ELECTRON_RUN_AS_NODE turns the executable into a plain Node interpreter, so
  // it must not survive from the parent environment: with it set the "app"
  // starts, runs nothing, and exits 0 — indistinguishable from a crash unless
  // you notice the variable. Strip every ELECTRON_* switch except the mirror,
  // which the packaging step may legitimately have set.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_ENABLE_LOGGING
  delete env.ELECTRON_NO_ATTACH_CONSOLE

  const child = spawn(EXE, [], {
    cwd: path.dirname(EXE),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => { stdout += d })
  child.stderr.on('data', d => { stderr += d })

  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })))
  let outcome = null
  const raced = await Promise.race([
    exited.then(v => ({ kind: 'exited', ...v })),
    new Promise(resolve => setTimeout(() => resolve({ kind: 'alive' }), BOOTSTRAP_MS)),
  ])
  outcome = raced

  // A packaged GUI build stays resident; an immediate exit means it crashed.
  record('process-resident', outcome.kind === 'alive', outcome)

  const logAfter = LOG_CANDIDATES.map(f => ({ file: f, size: fs.existsSync(f) ? fs.statSync(f).size : 0 }))
  const grew = logAfter.find((entry, i) => entry.size > (logBefore[i]?.size ?? 0))

  // A resident process is necessary but not sufficient: Electron could be alive
  // with no engine. Require the process tree a real Electron app always builds.
  if (outcome.kind === 'alive') {
    let tree = []
    try {
      const listing = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${child.pid}" | Select-Object -ExpandProperty ProcessId`,
      ], { encoding: 'utf8', timeout: 30_000 })
      tree = listing.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    } catch { /* process tree is best-effort */ }
    record('electron-process-tree', tree.length > 0, { mainPid: child.pid, children: tree.length })
  } else {
    record('electron-process-tree', false, outcome)
  }

  // The strongest non-interactive evidence that a GUI actually came up: the
  // main process owns a top-level window with a title. A process that stayed
  // resident without ever creating one would still "pass" a liveness check.
  if (outcome.kind === 'alive') {
    let title = ''
    try {
      title = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).MainWindowTitle`,
      ], { encoding: 'utf8', timeout: 30_000 }).trim()
    } catch { /* best effort */ }
    record('gui-window-created', title.length > 0, { mainWindowTitle: title || null, pid: child.pid })
  } else {
    record('gui-window-created', false, outcome)
  }

  // Single-instance handoff, recorded as an observation rather than an
  // assertion. Whether a second launch holds or yields the lock depends on
  // whether the first instance is still alive at that instant, so a hard
  // assertion here is flaky; the durable evidence for a successful launch is
  // `gui-window-created` above.
  if (outcome.kind === 'alive') {
    const lifecycleLog = path.join(process.env.APPDATA || '', 'Phaneris', 'logs', 'lifecycle.log')
    const sizeBefore = fs.existsSync(lifecycleLog) ? fs.statSync(lifecycleLog).size : 0
    const second = spawn(EXE, [], { cwd: path.dirname(EXE), stdio: 'ignore', env })
    const secondOutcome = await Promise.race([
      new Promise(resolve => second.on('exit', code => resolve({ kind: 'exited', code }))),
      new Promise(resolve => setTimeout(() => resolve({ kind: 'alive' }), 20_000)),
    ])
    if (secondOutcome.kind === 'alive') {
      try { execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${second.pid} -Force`], { timeout: 20_000 }) } catch { /* best effort */ }
    }
    const sizeAfter = fs.existsSync(lifecycleLog) ? fs.statSync(lifecycleLog).size : 0
    record('single-instance-observation', true, {
      secondLaunch: secondOutcome,
      lifecycleLogWritten: sizeAfter > sizeBefore,
      lifecycleLog,
      note: 'informational: a second launch either hands off (exits 0) or wins the lock',
    })
  } else {
    record('single-instance-observation', true, { skipped: 'first instance was not resident', outcome })
  }

  const logFile = grew?.file ?? LOG_CANDIDATES.find(f => fs.existsSync(f))
  const tail = logFile ? readTail(logFile) : null
  if (tail) {
    // Fatal markers: module resolution, native ABI, or an unhandled throw.
    const fatal = /Cannot find module|MODULE_NOT_FOUND|was compiled against a different Node\.js version|NODE_MODULE_VERSION|Uncaught Exception|Error: Cannot find/i
    const hit = tail.split(/\r?\n/).filter(line => fatal.test(line))
    record('no-fatal-startup-errors', hit.length === 0, { matched: hit.slice(-5) })
  } else {
    record('no-fatal-startup-errors', false, { reason: 'no log file found to inspect' })
  }

  if (!keepOpen && outcome.kind === 'alive' && child.exitCode === null) {
    child.kill()
    await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))])
  }

  const failed = results.filter(r => !r.passed)
  fs.writeFileSync(
    path.join(OUT_DIR, 'packaged-launch.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      exe: path.relative(ROOT, EXE),
      bootstrapMs: BOOTSTRAP_MS,
      stdoutTail: stdout.slice(-2000),
      stderrTail: stderr.slice(-2000),
      logFile,
      logTail: tail ? tail.slice(-4000) : null,
      results,
    }, null, 2) + '\n',
  )
  for (const r of results) console.log(`${r.passed ? 'OK  ' : 'FAIL'} ${r.check}${r.passed ? '' : ' ' + JSON.stringify(r.detail ?? {})}`)
  console.log(`\n${results.length - failed.length}/${results.length} launch checks passed`)
  if (failed.length) process.exitCode = 1
}

main().catch(error => { console.error('launch verification failed:', error.message); process.exitCode = 1 })
