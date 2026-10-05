/** Build a standalone probe and run it with the real packaged Electron executable. */
import { build } from 'esbuild'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..')
const output = join(root, '.cache/ai-settings-refinement')
mkdirSync(output, { recursive: true })
const fixture = mkdtempSync(join(output, 'runtime-'))
const app = process.argv.find(arg => arg.startsWith('--app='))?.slice(6) ?? '/Applications/Phaneris.app'
const executable = process.platform === 'darwin' ? join(app, 'Contents/MacOS/Phaneris') : app
const resources = process.platform === 'darwin' ? join(app, 'Contents/Resources/app') : resolve(app, '../resources/app')
if (!existsSync(executable)) throw new Error(`Packaged app executable missing: ${executable}`)
const probe = join(fixture, 'probe.cjs')
await build({ entryPoints: [join(root, 'scripts/verification/runtime-refinement-probe.ts')], outfile: probe, bundle: true, platform: 'node', format: 'cjs', target: 'node24' })
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PHANERIS_IS_PACKAGED: '1', PHANERIS_RESOURCES_BASE: resources,
  PHANERIS_ELECTRON_EXECUTABLE: executable, PHANERIS_CONFIG_DIR: join(fixture, 'config'), PHANERIS_SCRIPT_RUNTIME_DIR: join(fixture, 'runtimes'),
  PHANERIS_VERIFICATION_FIXTURE: fixture, OPENAI_API_KEY: 'verification-secret-must-be-stripped' }
delete env.PHANERIS_UV; delete env.PHANERIS_NODE; delete env.PHANERIS_BUN; delete env.UV_OFFLINE
const child = Bun.spawn([executable, probe], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
writeFileSync(join(fixture, 'host.log'), stdout + stderr)
const report = existsSync(join(fixture, 'runtime.json')) ? JSON.parse(readFileSync(join(fixture, 'runtime.json'), 'utf8')) : { records: [], error: stderr }
writeFileSync(join(output, 'runtime-latest.json'), JSON.stringify({ app, code, ...report }, null, 2))
console.log(JSON.stringify({ app, code, fixture, passed: report.records.filter((r: { pass: boolean }) => r.pass).length, total: report.records.length, stderr }))
process.exit(code)
