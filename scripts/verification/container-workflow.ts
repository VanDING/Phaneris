/** D01/D02: fresh production image, authenticated RPC and real Pi subprocess in Linux. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { verificationWorkflow } from './verification-artifacts'
import { deadline, testSecret } from './fixtures/governance-process-support'

await verificationWorkflow('container', async run => {
  const root = resolve(import.meta.dir, '../..'), name = `phaneris-verification-${Date.now()}`, image = `${name}:local`
  const commands: { args: string[]; code: number; elapsedMs: number }[] = []
  const command = async (args: string[], log: string, maximum = 30_000) => {
    const started = Date.now(), child = Bun.spawn(['docker', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), maximum)
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      writeFileSync(join(run.directory, `${log}.log`), stdout + stderr)
      commands.push({ args, code, elapsedMs: Date.now() - started })
      assert.equal(code, 0, `${log}: ${stderr.slice(-2000)}`)
      return stdout.trim()
    } finally { clearTimeout(timer) }
  }
  // Failure here is an unavailable environment, never a successful container test.
  await command(['info', '--format', '{{.OSType}}'], 'daemon')
  const checks: string[] = []
  let started = false, built = false, client: WsRpcClient | undefined
  const cleanup: unknown[] = []
  try {
    await command(['build', '--pull', '--no-cache', '-f', 'Dockerfile.server', '-t', image, '.'], 'image-build', 30 * 60_000)
    built = true
    checks.push('fresh-image-frozen-patched-install-and-common-runtime-build')
    await command(['run', '-d', '--name', name, '-p', '127.0.0.1::9100', '-e', `PHANERIS_SERVER_TOKEN=${testSecret}`,
      '-e', 'PHANERIS_DISABLE_MESSAGING=1', '-e', 'PHANERIS_CONFIG_DIR=/tmp/governance-config', image], 'container-start')
    started = true
    const mapping = await command(['port', name, '9100/tcp'], 'port')
    const url = `ws://${mapping.split('\n')[0]}`
    const readyBy = Date.now() + 20_000
    for (;;) {
      if (Date.now() >= readyBy) throw new Error('Container did not accept an authenticated RPC connection')
        client = new WsRpcClient(url, { token: testSecret, autoReconnect: false, connectTimeout: 2000 })
        client.connect()
        while (['connecting', 'reconnecting'].includes(client.getConnectionState().status)) await Bun.sleep(20)
        if (client.isConnected) break
        client.destroy(); await Bun.sleep(100)
    }
    assert(client)
    assert(Array.isArray(await client.invoke('workspaces:get')))
    const versions = await client.invoke('system:versions')
    assert(versions.node)
    checks.push('production-image-authenticated-rpc')
    assert((await fetch(url.replace('ws:', 'http:'))).ok)
    checks.push('production-image-serves-built-webui')
    await command(['exec', name, 'mkdir', '-p', '/tmp/governance-workspace/sessions/fixture'], 'pi-workspace')
    const pi = spawn('docker', ['exec', '-i', name, 'bun', 'packages/pi-agent-server/dist/index.js'], { stdio: 'pipe' })
    const messages: Record<string, unknown>[] = [], exited = new Promise<number | null>(resolve => pi.once('exit', resolve))
    let buffered = '', stderr = ''
    pi.stdout.on('data', data => {
      buffered += String(data)
      while (buffered.includes('\n')) { const end = buffered.indexOf('\n'), line = buffered.slice(0, end); buffered = buffered.slice(end + 1); if (line.trim()) messages.push(JSON.parse(line)) }
    })
    pi.stderr.on('data', data => { stderr += String(data) })
    const send = (message: unknown) => pi.stdin.write(JSON.stringify(message) + '\n')
    const wait = async (type: string) => deadline((async () => {
      for (;;) {
        const message = messages.find(row => row.type === type)
        if (message) return message
        if (pi.exitCode !== null) throw new Error(stderr.slice(-1500))
        await Bun.sleep(10)
      }
    })(), 25_000)
    try {
      send({ type: 'init', apiKey: 'fixture', model: 'pi/fixture', cwd: '/tmp/governance-workspace', thinkingLevel: 'off',
        workspaceRootPath: '/tmp/governance-workspace', sessionId: 'fixture', sessionPath: '/tmp/governance-workspace/sessions/fixture',
        workingDirectory: '/tmp/governance-workspace', plansFolderPath: '/tmp/governance-workspace/sessions/fixture/plans',
        providerType: 'pi_compat', authType: 'api_key', baseUrl: 'http://127.0.0.1:1/v1',
        customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] })
      await wait('ready'); send({ type: 'ensure_session_ready', id: 'container-ready' })
      assert.equal(typeof (await wait('ensure_session_ready_result')).sessionId, 'string')
      pi.stdin.end(); assert.equal(await deadline(exited), 0)
      checks.push('production-image-real-pi-sdk-and-pipe-shutdown')
      run.json('pi-protocol.json', { messages: messages.map(({ callbackToken: _secret, ...message }) => message), stderr })
    } finally { if (pi.exitCode === null) { pi.kill('SIGKILL'); await exited } }
    client.destroy()
    await command(['stop', '--time', '15', name], 'container-stop')
    const state = JSON.parse(await command(['inspect', '--format', '{{json .State}}', name], 'container-state')) as { ExitCode: number }
    const logs = await command(['logs', name], 'container-output')
    assert.equal(state.ExitCode, 0, logs.slice(-5000))
    checks.push('production-image-bounded-clean-shutdown')
    assert(!logs.includes(testSecret))
    run.json('container.json', { checks, commands, versions, state })
    run.complete(checks, ['signed native installers', 'live external providers'])
  } finally {
    client?.destroy()
    if (started) try { await command(['logs', name], 'container-output') } catch (error) { cleanup.push(error) }
    if (started) try { await command(['rm', '-f', name], 'container-remove') } catch (error) { cleanup.push(error) }
    if (built) try { await command(['image', 'rm', image], 'image-remove') } catch (error) { cleanup.push(error) }
    if (cleanup.length) {
      run.json('cleanup-errors.json', cleanup.map(error => String(error)))
    }
  }
  if (cleanup.length) throw new AggregateError(cleanup, 'Container cleanup failed')
})
