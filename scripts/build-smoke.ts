#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyServerDistribution } from './verification/server-distribution'
import { checkEnvironment, root, run } from './check-environment'
import { verificationWorkflow } from './verification/verification-artifacts'

await verificationWorkflow('build-smoke', async evidence => {
const completed: string[] = []
checkEnvironment()
// Real production bundlers, without signing, publishing, OAuth or model requests.
for (const script of [
  'electron:build:main', 'electron:build:preload', 'electron:build:renderer',
  'webui:build', 'viewer:build',
]) {
  await run(['run', script], root, { logFile: join(evidence.directory, `${script.replaceAll(':', '-')}.log`) })
  completed.push(script)
}

// Exercise the actual server distribution assembly, then resolve its imports
// outside the source tree. Native runtime downloads/installers are release checks.
const cache = tmpdir()
mkdirSync(cache, { recursive: true })
const outside = mkdtempSync(join(cache, 'phaneris-distribution-'))
const output = join(outside, 'distribution')
try {
  await run(['run', 'scripts/build-server.ts', '--skip-download', '--output=' + output], root, { logFile: join(evidence.directory, 'server-assembly.log') })
  const entry = join(output, 'packages/server/src/index.ts')
  if (!existsSync(entry)) throw new Error(`Missing assembled server entry: ${entry}`)
  const child = Bun.spawn([process.execPath, 'run', entry, '--generate-token'], {
    cwd: output, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, PHANERIS_CONFIG_DIR: join(output, 'config') },
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  if (code !== 0 || !/^[a-zA-Z0-9_-]{32,}\s*$/.test(stdout)) {
    throw new Error(`Server distribution import smoke failed (${code}): ${stderr.slice(-2000)}`)
  }
  evidence.json('server-import.json', { exitCode: code, generatedTokenFormatValid: true, stderr, assembly: output })
  completed.push('server-distribution-import')
  completed.push(...await verifyServerDistribution(output, outside, evidence))
  console.log('Server distribution entry point resolved successfully.')
} finally {
  rmSync(outside, { recursive: true, force: true })
}
evidence.json('build-smoke.json', { completed, nativeRuntimeDownloads: false })
evidence.complete(completed, ['clean runtime download/cache', 'signed installers', 'native Windows/Linux execution', 'live providers'])
console.log(JSON.stringify({ passed: completed.length, output: join(evidence.directory, 'build-smoke.json') }))
})
