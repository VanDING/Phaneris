/** Repeatable local capability workflows; each stage leaves its own inspectable artifact. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dir, '../..'), output = resolve(root, '.cache/capability-integration')
mkdirSync(output, { recursive: true })
const stages = [
  ['pi-build', ['run', '--cwd', 'packages/pi-agent-server', 'build']],
  ['sdk-tools', ['scripts/verification/capability-integration-workflows.ts']],
  ['input-reception-ui', ['scripts/verification/input-reception-workflow.ts']],
  ['native-mcp-source', ['scripts/verification/native-mcp-source-workflow.ts']],
  ['decisions-governance', ['scripts/verification/decision-governance-workflows.ts']],
  ['decision-features', ['scripts/verification/decision-feature-workflow.ts']],
  ['classifier-comparison', ['scripts/verification/classifier-comparison-workflow.ts']],
  ['task-governance', ['scripts/verification/task-governance-workflow.ts']],
  ['images', ['scripts/verification/image-capability-workflows.ts']],
  ['markdown-workbench', ['scripts/verification/markdown-artifact-workflow.ts']],
  ['adoption-audit', ['scripts/verification/capability-adoption-audit.ts']],
  ['production-webui-build', ['run', 'webui:build']],
  ['production-workbench-smoke', ['scripts/performance/run.ts', '--smoke', '--skip-build', '--output=.cache/capability-integration/performance-capabilities.json']],
] as const
const records = []
for (const [name, args] of stages) {
  const started = Date.now(), child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe', env: process.env })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  writeFileSync(resolve(output, `${name}.log`), stdout + stderr)
  records.push({ name, pass: code === 0, elapsedMs: Date.now() - started, exitCode: code })
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name}`)
}
const commit = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.toString().trim()
const diff = Bun.spawnSync(['git', 'diff', 'HEAD'], { cwd: root }).stdout
const sourceHash = createHash('sha256')
const files = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).stdout.toString().split('\0').filter(Boolean).sort()
for (const file of files) { sourceHash.update(file); sourceHash.update(readFileSync(resolve(root, file))) }
writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ createdAt: new Date().toISOString(), commit,
  trackedDiffSha256: createHash('sha256').update(diff).digest('hex'),
  workingTreeSha256: sourceHash.digest('hex'),
  piBundleSha256: createHash('sha256').update(readFileSync(resolve(root, 'packages/pi-agent-server/dist/bundle.js'))).digest('hex'),
  records, excluded: ['Live paid calls are opt-in scripts with separate reports', 'OAuth', 'signed installers', 'installation/update', 'other operating systems', 'native migration performance beyond one loopback Source'] }, null, 2))
process.exit(records.every(record => record.pass) ? 0 : 1)
