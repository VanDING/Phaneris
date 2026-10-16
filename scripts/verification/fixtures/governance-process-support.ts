import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { PROTOCOL_VERSION } from '@phaneris/shared/protocol'

export const repository = resolve(import.meta.dir, '../../..')
export const testSecret = 'governance-only-server-secret-never-a-real-credential'
export async function deadline<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Verification deadline exceeded (${ms}ms)`)), ms)
  })]) } finally { clearTimeout(timer) }
}
export function seedServer(directory: string) {
  const config = join(directory, 'config'), webui = join(directory, 'webui')
  mkdirSync(config, { recursive: true }); mkdirSync(webui, { recursive: true })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null }))
  writeFileSync(join(webui, 'index.html'), '<!doctype html><title>Governance fixture</title>')
  writeFileSync(join(webui, 'login.html'), '<!doctype html><title>Login fixture</title>')
  return { config, webui }
}
export interface RunningProcess {
  process: ChildProcessWithoutNullStreams; url: string; stdout: () => string; stderr: () => string
  exited: Promise<number | null>; stop: (signal?: NodeJS.Signals) => Promise<number | null>
}
export async function startProcess(options: {
  config: string; webui?: string; extra?: Record<string, string>; entry?: string; ready?: boolean
}): Promise<RunningProcess> {
  const child = spawn(process.execPath, ['--preload', join(import.meta.dir, 'governance-process-faults.ts'),
    options.entry ?? join(repository, 'packages/server/src/index.ts')], {
    cwd: repository, stdio: 'pipe', env: { ...process.env,
      PHANERIS_CONFIG_DIR: options.config, PHANERIS_SERVER_TOKEN: testSecret,
      PHANERIS_RPC_HOST: '127.0.0.1', PHANERIS_RPC_PORT: '0', PHANERIS_HEALTH_PORT: '0',
      PHANERIS_DISABLE_MESSAGING: '1', PHANERIS_PRINT_SERVER_TOKEN: '0',
      PHANERIS_BUNDLED_ASSETS_ROOT: join(repository, 'apps/electron'),
      PHANERIS_WEBUI_DIR: options.webui ?? '', PHANERIS_WEBUI_PASSWORD: testSecret,
      PHANERIS_TRUSTED_PROXIES: '', PHANERIS_WEBUI_ALLOWED_ORIGINS: '',
      ...options.extra,
    },
  })
  let stdout = '', stderr = '', url = ''
  const ready = Promise.withResolvers<void>()
  const exited = new Promise<number | null>((resolveExit, reject) => {
    child.on('error', reject)
    // close follows exit and pipe draining; assertions must see the final diagnostics.
    child.on('close', code => { resolveExit(code); if (!url) ready.reject(new Error(`Child exited before ready (${code}): ${stderr.slice(-1500)}`)) })
  })
  // The exit promise is also used by intentionally failing startup scenarios.
  void ready.promise.catch(() => {})
  child.stdout.on('data', data => {
    stdout += data.toString()
    const match = stdout.match(/PHANERIS_SERVER_URL=(ws[s]?:\/\/[^\s]+)/)
    if (match) { url = match[1]!; ready.resolve() }
  })
  child.stderr.on('data', data => { stderr += data.toString() })
  const result: RunningProcess = { process: child, get url() { return url }, stdout: () => stdout, stderr: () => stderr, exited,
    stop: async (signal = 'SIGTERM') => {
      if (child.exitCode === null && child.signalCode === null) {
        // Windows kill(SIGTERM) terminates immediately instead of delivering a
        // signal. The test-only preload dispatches the same shutdown handler.
        if (process.platform === 'win32' && signal === 'SIGTERM') child.stdin.write('{"governanceStop":true}\n')
        else child.kill(signal)
      }
      return deadline(exited, 15_000)
    } }
  if (options.ready !== false) {
    try { await deadline(ready.promise) } catch (error) { await result.stop('SIGKILL'); throw error }
  }
  return result
}
export async function handshake(url: string, headers: Record<string, string> = {}, token?: string) {
  return deadline(new Promise<{ accepted: boolean; code: string | null }>((resolveResult, reject) => {
    const ws = new WebSocket(url, { headers })
    ws.on('error', reject)
    ws.on('open', () => ws.send(JSON.stringify({ id: 'governance-handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION, token })))
    let code: string | null = null
    ws.on('message', data => {
      const message = JSON.parse(data.toString()) as { type: string; error?: { code?: string } }
      if (message.type === 'handshake_ack') { ws.close(); resolveResult({ accepted: true, code: null }) }
      if (message.type === 'error') code = message.error?.code ?? null
    })
    ws.on('close', () => resolveResult({ accepted: false, code }))
  }), 5000)
}
export function assertNoSecret(processes: RunningProcess[], secrets = [testSecret]) {
  for (const child of processes) for (const secret of secrets) {
    assert(!`${child.stdout()}${child.stderr()}`.includes(secret), 'Server diagnostics must not contain authentication secrets')
  }
}
