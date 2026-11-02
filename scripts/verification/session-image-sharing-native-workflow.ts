import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-image-sharing-native', async run => {
  const native = join(run.directory, 'native-app'); mkdirSync(native)
  const output = await Bun.build({
    entrypoints: [resolve(import.meta.dir, 'fixtures/session-image-sharing-native.ts')],
    target: 'node', format: 'cjs', outdir: native, naming: 'main.cjs', external: ['electron'],
  })
  assert(output.success, output.logs.join('\n'))
  writeFileSync(join(native, 'preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('nativeShare',{copy:v=>ipcRenderer.invoke('__shareImage:copy',v),save:v=>ipcRenderer.invoke('__shareImage:save',v),font:v=>ipcRenderer.invoke('__shareImage:font',v)});")
  const require = createRequire(import.meta.url)
  const executable = require('electron') as string
  const env: NodeJS.ProcessEnv = { ...process.env, SHARE_VERIFY_DIRECTORY: run.directory }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
  const child = spawnSync(executable, [join(native, 'main.cjs'), '--disable-gpu'], { env, encoding: 'utf8', timeout: 60_000, windowsHide: true })
  run.json('process.json', { status: child.status, error: child.error?.message, stdout: child.stdout, stderr: child.stderr })
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(readFileSync(join(run.directory, 'native-results.json'), 'utf8')) as { checks: { id: string; passed: boolean }[] }
  assert(result.checks.every(check => check.passed))
  run.complete(result.checks.map(check => check.id), ['macOS/Linux native execution', 'Full production host boot', 'Signed installer'])
  console.log(JSON.stringify({ output: run.directory, passed: result.checks.length }))
})
