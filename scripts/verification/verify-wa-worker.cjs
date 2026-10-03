#!/usr/bin/env node
/**
 * WhatsApp worker end-to-end check.
 *
 * Drives the *built* worker bundle (packages/messaging-whatsapp-worker/dist/worker.cjs)
 * as a real Node subprocess, exactly as WhatsAppAdapter does, and asserts the new
 * Baileys release initialises: module graph links, exports are present, the auth
 * state store is created, and the socket factory constructs without throwing.
 *
 * Run after `bun run build:wa-worker`:
 *   node scripts/verification/verify-wa-worker.cjs
 *
 * Writes .cache/dependency-upgrade-20261003/wa-worker-e2e.json.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
const BUNDLE = path.join(ROOT, 'packages/messaging-whatsapp-worker/dist/worker.cjs')
const OUT_DIR = path.resolve(process.env.PHANERIS_UPGRADE_ARTIFACTS || path.join(ROOT, '.cache/dependency-upgrade-20261003'))

const results = []
function record(check, passed, detail) {
  results.push({ check, passed, ...(detail ? { detail } : {}) })
}

/** Collect newline-delimited JSON frames from the worker's stdout. */
function makeReader(proc) {
  const frames = []
  const waiters = []
  let buffer = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let frame
      try { frame = JSON.parse(line) } catch { continue }
      frames.push(frame)
      for (const waiter of [...waiters]) {
        if (waiter.match(frame)) {
          waiters.splice(waiters.indexOf(waiter), 1)
          waiter.resolve(frame)
        }
      }
    }
  })
  let stderr = ''
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', chunk => { stderr += chunk })
  return {
    frames,
    stderr: () => stderr,
    waitFor(match, timeoutMs) {
      const already = frames.find(match)
      if (already) return Promise.resolve(already)
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve }
        waiters.push(waiter)
        setTimeout(() => {
          const at = waiters.indexOf(waiter)
          if (at !== -1) {
            waiters.splice(at, 1)
            reject(new Error(`timeout after ${timeoutMs}ms waiting for frame`))
          }
        }, timeoutMs).unref()
      })
    },
  }
}

async function main() {
  if (!fs.existsSync(BUNDLE)) {
    console.error(`Worker bundle missing: ${BUNDLE}\nRun \`bun run build:wa-worker\` first.`)
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const authStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phaneris-wa-e2e-'))
  fs.rmSync(authStateDir, { recursive: true, force: true })
  const proc = spawn(process.execPath, [BUNDLE], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    // The worker is spawned by Electron with ELECTRON_RUN_AS_NODE; plain node is
    // the headless-server path and is what this check covers.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  })
  const reader = makeReader(proc)

  const exited = new Promise(resolve => proc.on('exit', (code, signal) => resolve({ code, signal })))

  try {
    proc.stdin.write(JSON.stringify({
      type: 'start',
      authStateDir,
      pairingMode: 'qr',
      selfChatMode: false,
    }) + '\n')

    let frame
    try {
      frame = await reader.waitFor(f => f.type === 'ready' || f.type === 'unavailable' || f.type === 'error', 120_000)
    } catch (error) {
      record('worker-reaches-ready', false, {
        error: error.message,
        stderr: reader.stderr().slice(-2000),
        frames: reader.frames,
      })
      throw error
    }

    record('worker-reaches-ready', frame.type === 'ready', {
      frame,
      stderr: reader.stderr().slice(-2000),
    })

    if (frame.type !== 'ready') throw new Error(`worker did not become ready: ${JSON.stringify(frame)}`)

    // `ready` is emitted after the Baileys module graph linked and the socket
    // factory was located. A missing export or a broken transitive module shows
    // up here as `unavailable: baileys_load_failed`.
    record('baileys-exports-present', typeof frame.buildId === 'string' && /^\d+\.\d+\.\d+/.test(frame.baileysVersion || ''), {
      buildId: frame.buildId,
      gitSha: frame.gitSha,
      baileysVersion: frame.baileysVersion,
    })

    // useMultiFileAuthState creates the directory but only persists creds.json
    // on the first creds.update, so directory creation is the observable here.
    record('auth-state-dir-created', fs.existsSync(authStateDir) && fs.statSync(authStateDir).isDirectory(), {
      authStateDir,
      entries: fs.existsSync(authStateDir) ? fs.readdirSync(authStateDir) : [],
    })

    // The strongest offline-safe signal: the socket must actually reach
    // WhatsApp and be handed a pairing payload, or fail with a classified
    // disconnect. Reaching either proves the protocol/crypto stack initialised
    // under this release, which is what the version bump risks.
    let handshake
    try {
      handshake = await reader.waitFor(
        f => f.type === 'qr' || f.type === 'disconnected' || f.type === 'unavailable',
        90_000,
      )
    } catch (error) {
      handshake = { timedOut: true, error: error.message }
    }
    const reachedServer = handshake.type === 'qr' || handshake.type === 'disconnected'
    record('whatsapp-handshake', reachedServer, {
      handshake: handshake.timedOut ? handshake : handshake.type,
      qrLength: handshake.type === 'qr' ? String(handshake.qr).length : undefined,
      reason: handshake.reason,
      stderr: reader.stderr().slice(-2000),
    })

    record('worker-stays-alive', proc.exitCode === null, { exitCode: proc.exitCode })
  } finally {
    try { proc.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch { /* already gone */ }
    const timer = setTimeout(() => proc.kill('SIGKILL'), 10_000)
    const outcome = await exited
    clearTimeout(timer)
    record('worker-exits-cleanly', outcome.code === 0, outcome)

    // No stray subprocess: the worker owns no children, so nothing to reap.
    try { fs.rmSync(authStateDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  const failed = results.filter(r => !r.passed)
  const report = {
    node: process.version,
    bundle: path.relative(ROOT, BUNDLE).replace(/\\/g, '/'),
    bundleBytes: fs.statSync(BUNDLE).size,
    results,
  }
  fs.writeFileSync(path.join(OUT_DIR, 'wa-worker-e2e.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }))
  if (failed.length) process.exitCode = 1
}

main().catch(error => {
  console.error('wa-worker e2e failed:', error.message)
  const failed = results.filter(r => !r.passed)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, 'wa-worker-e2e.json'),
    JSON.stringify({ node: process.version, results, error: error.message }, null, 2) + '\n',
  )
  if (!failed.length) console.error('(no check recorded — see stderr above)')
  process.exitCode = 1
})
