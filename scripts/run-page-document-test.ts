/** Run after electron:build:renderer; checks the built CSP in real Chromium. */
import { build } from 'esbuild'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const temporary = mkdtempSync(join(tmpdir(), 'craft-page-document-test-'))
const entry = join(temporary, 'smoke.cjs')
const resultPath = join(temporary, 'result.json')
await build({
  entryPoints: ['scripts/test-page-document-electron.ts'], outfile: entry,
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
})
const electron = resolve('node_modules/electron/dist', readFileSync('node_modules/electron/path.txt', 'utf8').trim())
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(electron, [entry, resultPath], { windowsHide: true, timeout: 40_000, env, encoding: 'utf8' })
let report: { ok?: boolean; checks?: string[]; error?: string }
try { report = JSON.parse(readFileSync(resultPath, 'utf8')) } catch {
  throw new Error(`Electron test did not produce a report: ${result.error ?? result.stderr}`)
}
console.log(JSON.stringify(report, null, 2))
if (result.status !== 0 || !report.ok) {
  console.error(result.stderr)
  process.exit(1)
}
