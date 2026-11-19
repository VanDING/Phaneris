import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * The real-model entry replay, in the shipped application.
 *
 * Two environment facts decide whether it runs, and both are reported rather
 * than worked around:
 *
 *  - The credential vault is sealed with an OS key (safeStorage / DPAPI) bound
 *    to the current user, not to a directory. Only the application decrypts it,
 *    so the replay launches the app; copying the vault into an isolated config
 *    root is enough, because DPAPI answers for this user.
 *  - The shipped app takes a single-instance lock, so it can only run while the
 *    user's own copy is closed. That case is reported as blocked, with the
 *    assertions it would make and how to re-run.
 *
 * The workspace is throwaway and the user's configuration is only read: it is
 * copied into an isolated root, never edited in place.
 */

const REAL_CONFIG = join(homedir(), '.phaneris')

/** Whether another instance of the shipped app currently holds the lock. */
function runningInstances(): string[] {
  try {
    // The packaged app runs as Phaneris.exe; a development launch runs as
    // electron.exe. Both take the same lock, so both must be counted or the
    // check passes and the launch then dies with "Second instance handed off".
    const names = ['Phaneris.exe', 'electron.exe']
    return names.flatMap(name => {
      try {
        const output = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
        return output.split('\n').map(line => line.trim()).filter(line => line.startsWith(`"${name}"`))
      } catch { return [] }
    })
  } catch { return [] }
}

await verificationWorkflow('assistant-task-live-model', async run => {
  assert(existsSync(join(REAL_CONFIG, 'config.json')), `A real connection configuration is required at ${REAL_CONFIG}`)
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = join(run.directory, 'config'), root = join(config, 'live-model')
  mkdirSync(root, { recursive: true })

  const installed = JSON.parse(readFileSync(join(REAL_CONFIG, 'config.json'), 'utf8')) as {
    llmConnections: Array<{ slug: string; defaultModel?: string }>
    defaultLlmConnection?: string
  }
  const connection = installed.llmConnections.find(item => item.slug === installed.defaultLlmConnection) ?? installed.llmConnections[0]
  assert(connection, 'The installed configuration has no LLM connection to replay against')

  const running = runningInstances()
  if (running.length) {
    run.json('blocked.json', {
      reason: 'the shipped application is already running and holds the single-instance lock',
      runningInstances: running.length,
      howToRun: 'quit the Phaneris application, then re-run this workflow',
      connection: connection.slug,
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

  // An isolated config root: only the workspace, the connection list and the
  // credential are taken from the installation. The user's config is untouched.
  const workspace = { id: 'live-model', name: 'Live model', rootPath: root, createdAt: 1 }
  writeFileSync(join(config, 'config.json'), JSON.stringify({
    workspaces: [workspace], activeWorkspaceId: 'live-model', setupDeferred: true,
    defaultLlmConnection: connection.slug, llmConnections: installed.llmConnections,
    appearance: { mode: 'light', colorTheme: 'default', font: 'inter' },
  }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace,
    defaults: { permissionMode: 'guarded', defaultLlmConnection: connection.slug, model: connection.defaultModel, workingDirectory: 'none' } }))
  for (const file of ['credentials.enc', 'credentials.key', 'credentials.json'])
    if (existsSync(join(REAL_CONFIG, file))) copyFileSync(join(REAL_CONFIG, file), join(config, file))
  // safeStorage keeps its own master key in the Chromium user-data directory's
  // `Local State`, not in the config root. Decrypting the vault needs that file:
  // without it the app falls back to machine-id derivation and logs "Error while
  // decrypting the ciphertext". With PHANERIS_CONFIG_DIR set, the app pins
  // userData to `<config>/user-data`, so that is where the file must go.
  const realUserData = process.env.APPDATA ? join(process.env.APPDATA, 'Phaneris') : undefined
  const userData = join(config, 'user-data')
  if (realUserData && existsSync(join(realUserData, 'Local State'))) {
    mkdirSync(userData, { recursive: true })
    copyFileSync(join(realUserData, 'Local State'), join(userData, 'Local State'))
  }

  const input = join(run.directory, 'input.json')
  writeFileSync(input, JSON.stringify({ root: resolve('.'), config, output: run.directory,
    workspaceId: 'live-model', executable: process.env.PHANERIS_VERIFICATION_EXECUTABLE }))
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
