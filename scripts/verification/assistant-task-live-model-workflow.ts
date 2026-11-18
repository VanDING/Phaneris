import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * The real-model desktop entry, replayed against the installed DeepSeek
 * connection.
 *
 * Two environment facts decide whether it can run, and both are reported rather
 * than worked around:
 *
 *  - The credential vault is sealed with a key the Electron main process derives
 *    from the OS keychain. A headless process cannot open it, so the replay must
 *    run inside the application.
 *  - The shipped app takes a single-instance lock. If the user already has it
 *    open, a second instance hands off and exits, so the replay cannot own a
 *    window. It reports that as blocked instead of failing the suite.
 *
 * When it does run, everything asserted is the Host's record: a greeting must
 * not create a Task, and a clear delegation must produce one versioned Task
 * rather than a chain of clarifying questions. A throwaway workspace is added
 * for the run and removed afterwards; the configuration is backed up and
 * restored, and the user's own workspaces are never opened.
 */

const REAL_CONFIG = join(homedir(), '.phaneris')

/** Whether another instance of the shipped app currently holds the lock. */
function runningInstances(): string[] {
  try {
    // tasklist is present on every supported Windows install and needs no
    // elevation to list the current user's own processes.
    const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Phaneris.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    return output.split('\n').map(line => line.trim()).filter(line => line.startsWith('"Phaneris.exe"'))
  } catch { return [] }
}

await verificationWorkflow('assistant-task-live-model', async run => {
  assert(existsSync(join(REAL_CONFIG, 'config.json')), `A real connection configuration is required at ${REAL_CONFIG}`)
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = join(run.directory, 'config'), root = join(config, 'live-model')
  mkdirSync(root, { recursive: true })

  const installed = JSON.parse(readFileSync(join(REAL_CONFIG, 'config.json'), 'utf8')) as {
    llmConnections: Array<{ slug: string; defaultModel?: string }>; defaultLlmConnection?: string
  }
  const connection = installed.llmConnections.find(item => item.slug === installed.defaultLlmConnection) ?? installed.llmConnections[0]
  assert(connection, 'The installed configuration has no LLM connection to replay against')

  // The single-instance lock makes this mutually exclusive with the user's own
  // session. Report it as blocked: a suite that fails here would blame the
  // product for the user having the application open.
  const running = runningInstances()
  if (running.length) {
    run.json('blocked.json', {
      reason: 'the shipped application is already running and holds the single-instance lock',
      runningInstances: running.length,
      howToRun: 'quit the Phaneris application, then re-run this workflow',
      connection: connection.slug,
      // What the replay would assert, so the gap stays visible in the record.
      wouldAssert: [
        'a greeting creates no Task and receives a reply',
        'a clear delegation creates one Goal, one Task, one requirement version and one Change',
        'a mixed request records its change and answers its question',
      ],
    })
    console.log(JSON.stringify({ blocked: true, runningInstances: running.length,
      reason: 'quit the Phaneris application, then re-run', output: run.directory }))
    // Zero scenes, so this run cannot be mistaken for a passing verification.
    throw new Error('Real-model replay is blocked: the Phaneris application is running. Quit it and re-run.')
  }

  const input = join(run.directory, 'input.json')
  writeFileSync(input, JSON.stringify({ root: resolve('.'), config, output: run.directory,
    workspaceId: 'live-model-probe', executable: process.env.PHANERIS_VERIFICATION_EXECUTABLE }))
  const child = Bun.spawn(['node', 'scripts/verification/fixtures/assistant-task-live.mjs', input], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  writeFileSync(join(run.directory, 'native.log'), out + err)
  assert.equal(code, 0, (out + err).slice(-8000))
  const result = JSON.parse(readFileSync(join(run.directory, 'live-evidence.json'), 'utf8')) as { scenes: string[] }
  for (const shot of ['live-after-greeting.png', 'live-after-delegation.png', 'live-after-mixed.png']) {
    const file = join(run.directory, shot)
    assert(existsSync(file), `Missing ${shot}`)
    assert(readFileSync(file).byteLength > 20_000, `${shot} must contain a rendered conversation`)
  }
  run.complete(result.scenes, [
    'Model answer quality and task wording (the Host record is asserted, the prose is not)',
    'Worker execution and the delivered file (this replay covers the entry)',
    'Cost and latency of the paid endpoint',
  ])
  console.log(JSON.stringify({ passed: result.scenes.length, connection: connection.slug, output: run.directory }))
})
