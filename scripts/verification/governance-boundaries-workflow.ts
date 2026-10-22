import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts.ts'

await verificationWorkflow('governance-boundaries', async run => {
  run.checkArguments()
  const fixture = join(run.directory, 'fixture')
  mkdirSync(join(fixture, 'apps'), { recursive: true })
  const put = (file: string, text: string) => { const path = join(fixture, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  put('package.json', JSON.stringify({ dependencies: { zod: 'fixture' } }))
  put('packages/shared/package.json', JSON.stringify({ name: '@phaneris/shared', exports: { './protocol': './src/protocol/index.ts', './config/schemas': './src/config/schemas.ts', './config/paths': './src/config/paths.ts' }, dependencies: { zod: 'fixture' } }))
  put('packages/core/package.json', JSON.stringify({ name: '@phaneris/core', exports: { './types': './src/types.ts' } }))
  put('packages/core/src/types.ts', 'export const value = 1; export type Value = {}\n')
  put('packages/shared/src/protocol/index.ts', 'export const value = 1\n')
  put('packages/shared/src/config/schemas.ts', 'export const schema = 1\n')
  put('packages/shared/src/config/source-validation.ts', 'export const validation = 1\n')
  put('packages/shared/src/config/connection-normalize.ts', 'export const normalize = 1\n')
  put('packages/shared/src/config/persisted-types.ts', "import type { Value } from '../../../core/src/types.ts'; export type Config = Value\n")
  put('packages/shared/src/agent/permissions-validation.ts', 'export const permissions = true\n')
  put('packages/shared/src/agent/mcp-tool-names.ts', 'export const readOnlyName = true\n')
  put('packages/shared/src/agent/browser-tool-effects.ts', 'export const browserEffect = true\n')
  put('packages/shared/src/config/repository.ts', "declare function atomicWriteFileSync(path: string): void; const CONFIG_FILE='config.json'; atomicWriteFileSync(CONFIG_FILE)\n")
  put('packages/shared/src/config/paths.ts', "export const CONFIG_FILE='config.json'; export const CONFIG_DIR='/fixture'; export const getConfigPath=()=>CONFIG_FILE\n")
  put('packages/server-core/package.json', JSON.stringify({ name: '@phaneris/server-core' }))
  for (const owner of ['agent-assembly', 'agent-product-context', 'agent-product-callbacks', 'source-resources', 'product-repository']) {
    put(`packages/server-core/src/sessions/${owner}.ts`, 'export const owner=true\n')
  }
  put('packages/server-core/src/sessions/SessionManager.ts', 'export class SessionManager {}\n')
  put('packages/server-core/src/sessions/helper.ts', "export * from './SessionManager'\n")
  const invoke = async () => {
    const child = Bun.spawn([process.execPath, 'scripts/check-governance-boundaries.ts', `--repository=${fixture}`], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, log: out + err }
  }
  const clean = await invoke()
  assert.equal(clean.code, 0, clean.log)
  const results: unknown[] = [clean]
  const scenes = ['valid-boundaries']
  for (const [name, path, bad, good] of [
    ['pure-io', 'packages/shared/src/config/schemas.ts', "import 'node:fs'; export const schema=1", 'export const schema=1'],
    ['protocol-relative', 'packages/shared/src/protocol/index.ts', "import '../config/repository.ts'; export const value=1", 'export const value=1'],
    ['protocol-barrel', 'packages/shared/src/protocol/index.ts', "export * from '../config/barrel.ts'", 'export const value=1'],
    ['domain-compatibility-loop', 'packages/shared/src/config/appearance.ts', "import './storage.ts'", 'export const appearance=1'],
    ['second-writer', 'packages/shared/src/config/appearance.ts', "declare function atomicWriteFileSync(path: string):void; const CONFIG_FILE='config.json'; atomicWriteFileSync(CONFIG_FILE)", 'export const appearance=1'],
    ['outside-unlink', 'packages/server-core/src/logout.ts', "import { CONFIG_FILE } from '../../shared/src/config/paths'; import { unlink } from 'node:fs/promises'; unlink(CONFIG_FILE)", 'export const logout=true'],
    ['aliased-unlink', 'packages/shared/src/config/appearance.ts', "import { CONFIG_FILE as rootPath } from './paths'; import { unlinkSync as remove } from 'node:fs'; const alias=rootPath; remove(alias)", 'export const appearance=1'],
    ['joined-root-unlink', 'packages/shared/src/config/appearance.ts', "import { CONFIG_DIR } from './paths'; import { join } from 'node:path'; import * as fs from 'node:fs'; const alias=join(CONFIG_DIR, 'config.json'); fs.rmSync(alias)", 'export const appearance=1'],
    ['path-function-unlink', 'packages/shared/src/config/appearance.ts', "import { getConfigPath } from './paths'; import { unlinkSync } from 'node:fs'; unlinkSync(getConfigPath())", 'export const appearance=1'],
    ...['agent-assembly', 'source-resources', 'product-repository', 'agent-product-context', 'agent-product-callbacks'].map(owner =>
      [`${owner}-transitive-manager`, `packages/server-core/src/sessions/${owner}.ts`, "export * from './helper'", 'export const owner=true']),
    ['boundary-any', 'apps/cli/src/client.ts', 'export function invoke(value: any) { return value }', 'export function invoke(value: unknown) { return value }'],
    ['root-borrow', 'packages/shared/src/config/appearance.ts', "import 'zod'; export const appearance=1", 'export const appearance=1'],
  ]) {
    put('packages/shared/src/config/barrel.ts', "export * from './repository.ts'")
    put('packages/shared/src/config/storage.ts', "export * from './repository.ts'")
    if (name === 'root-borrow') put('packages/shared/package.json', JSON.stringify({ name: '@phaneris/shared', exports: { './protocol': './src/protocol/index.ts', './config/schemas': './src/config/schemas.ts', './config/paths': './src/config/paths.ts' } }))
    put(path!, bad!)
    const result = await invoke()
    assert.notEqual(result.code, 0, `${name}: ${result.log}`)
    results.push({ name, ...result }); scenes.push(name!)
    put(path!, good!)
  }
  run.json('governance-boundaries.json', { scenes, results })
  run.complete(scenes)
})
