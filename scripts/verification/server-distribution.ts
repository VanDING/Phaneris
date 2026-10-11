/** D02: actual assembled entry, off-tree working directory, RPC and absent-resource canaries. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { deadline, testSecret } from './fixtures/governance-process-support'
import type { VerificationRun } from './verification-artifacts'

export async function verifyServerDistribution(output: string, outside: string, evidence: VerificationRun): Promise<string[]> {
  const config = join(outside, 'config')
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, setupDeferred: true }))
  const checks: string[] = []
  const launch = () => {
    const child = spawn(join(output, 'bin/phaneris-server'), [], { cwd: outside, stdio: 'pipe', env: {
      PATH: process.env.PATH, HOME: outside, USERPROFILE: outside,
      PHANERIS_CONFIG_DIR: config, PHANERIS_SERVER_TOKEN: testSecret,
      PHANERIS_RPC_HOST: '127.0.0.1', PHANERIS_RPC_PORT: '0', PHANERIS_HEALTH_PORT: '0',
      PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_TELEMETRY_ENABLED: '0',
    } })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += String(data) })
    child.stderr.on('data', data => { stderr += String(data) })
    const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    return { child, exited, stdout: () => stdout, stderr: () => stderr }
  }
  for (const [id, resource] of [['pi', 'resources/pi-agent-server/index.js'], ['pi-bundle', 'resources/pi-agent-server/bundle.js'],
    ['pi-worker', 'resources/pi-agent-server/worker.js'], ['wasm', 'resources/pi-agent-server/node_modules/quickjs-wasi/quickjs.wasm'],
    ['worker', 'packages/messaging-whatsapp-worker/dist/worker.cjs']] as const) {
    const path = join(output, resource)
    renameSync(path, path + '.missing')
    const running = launch()
    try {
      const code = await deadline(running.exited, 8000).catch(error => {
        evidence.json(`missing-${id}.json`, { code: running.child.exitCode, stderr: running.stderr(), stdout: running.stdout(), listening: /PHANERIS_SERVER_URL=/.test(running.stdout()) })
        throw error
      })
      evidence.json(`missing-${id}.json`, { code, stderr: running.stderr(), listening: /PHANERIS_SERVER_URL=/.test(running.stdout()) })
      assert.notEqual(code, 0, 'Incomplete distribution must fail startup')
      assert.match(running.stderr(), /Missing production runtime resource/)
      assert(!running.stdout().includes('PHANERIS_SERVER_URL='), 'No RPC listener may accept work with missing runtime resources')
      checks.push(`missing-${id}-fails-before-listen`)
    } finally {
      if (running.child.exitCode === null) { running.child.kill('SIGKILL'); await running.exited }
      renameSync(path + '.missing', path)
    }
  }
  const running = launch()
  let client: WsRpcClient | undefined
  try {
    const url = await deadline((async () => {
      for (;;) {
        const value = running.stdout().match(/PHANERIS_SERVER_URL=(ws:\/\/[^\s]+)/)?.[1]
        if (value) return value
        if (running.child.exitCode !== null) throw new Error(running.stderr().slice(-2500))
        await Bun.sleep(20)
      }
    })(), 20_000)
    client = new WsRpcClient(url, { token: testSecret, autoReconnect: false })
    await client.connect()
    assert.deepEqual(await client.invoke('workspaces:get'), [])
    assert.equal((await client.invoke('system:versions')).node, process.versions.node)
    checks.push('off-tree-production-wrapper-boot-and-authenticated-rpc')
    assert(!running.stdout().includes(testSecret) && !running.stderr().includes(testSecret))
    client.destroy(); running.child.kill('SIGTERM')
    assert.equal(await deadline(running.exited, 15_000), 0)
    checks.push('production-wrapper-bounded-clean-shutdown')
    evidence.json('server-production.json', { checks, stdout: running.stdout(), stderr: running.stderr(), assembly: output, workingDirectory: outside })
  } finally {
    client?.destroy()
    if (running.child.exitCode === null) { running.child.kill('SIGKILL'); await running.exited }
  }
  const packagedOutput = join(evidence.directory, 'packaged-pi')
  const repo = join(import.meta.dir, '../..')
  const pi = Bun.spawn([process.execPath, join(repo, 'scripts/verification/durable-runtime-pi-workflow.ts'), `--output-dir=${packagedOutput}`], {
    cwd: outside, env: { ...process.env, PHANERIS_VERIFY_PI_DISTRIBUTION: output }, stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => pi.kill(), 60_000)
  let result: [number, string, string]
  try { result = await Promise.all([pi.exited, new Response(pi.stdout).text(), new Response(pi.stderr).text()]) }
  finally { clearTimeout(timer); if (pi.exitCode === null) { pi.kill(); await pi.exited } }
  const [code, stdout, stderr] = result
  writeFileSync(join(evidence.directory, 'packaged-pi.log'), stdout + stderr)
  assert.equal(code, 0, stderr.slice(-3000))
  const manifest = JSON.parse(readFileSync(join(packagedOutput, 'manifest.json'), 'utf8')) as { passed: number; exitCode: number }
  assert.equal(manifest.exitCode, 0); assert.equal(manifest.passed, 6)
  checks.push('off-tree-production-pi-host-effect-and-tool-parity')
  return checks
}
