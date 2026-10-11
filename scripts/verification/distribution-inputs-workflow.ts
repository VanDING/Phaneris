#!/usr/bin/env bun
/** D01/D02: real input checker must reject broken image inputs before install/build. */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('distribution-inputs', async run => {
  const metadata = JSON.parse(readFileSync('package.json', 'utf8')) as { workspaces: string[]; patchedDependencies: Record<string, string> }
  const docker = readFileSync('Dockerfile.server', 'utf8')
  const manifests = metadata.workspaces.flatMap(pattern => [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: process.cwd() })])
  const cases = [
    ['complete', docker, undefined, true],
    ['floating-bun', docker.replace(/FROM oven\/bun:[^\s]+/, 'FROM oven/bun:1.4-slim'), undefined, false],
    ['missing-patch-copy', docker.replace(/^COPY patches\/ patches\/\s*$/m, ''), undefined, false],
    ['missing-patch-file', docker, Object.values(metadata.patchedDependencies)[0], false],
    ['missing-pi-command', docker.replace('RUN bun run build:runtime', 'RUN true'), undefined, false],
    ['missing-workspace-manifest', docker.replace(/^COPY packages\/core\/package.json packages\/core\/\s*$/m, ''), undefined, false],
    ['disabled-production-mode', docker.replace('ENV PHANERIS_IS_PACKAGED=true', 'ENV PHANERIS_IS_PACKAGED=false'), undefined, false],
    ['missing-pi-staging', docker.replace('cp -R packages/pi-agent-server/dist/. apps/electron/resources/pi-agent-server/', 'true'), undefined, false],
    ['floating-standalone-bun', docker, undefined, false],
    ['desktop-worker-fork', docker, undefined, false],
  ] as const
  const records: { id: string; passed: boolean; output: string }[] = []
  for (const [id, text, missing, success] of cases) {
    const root = join(run.directory, id); mkdirSync(root, { recursive: true })
    for (const file of ['package.json', 'bun.lock', 'bunfig.toml', '.dockerignore',
      'scripts/build-server.ts', 'scripts/electron-build-main.ts', 'scripts/build/common.ts',
      ...manifests, ...Object.values(metadata.patchedDependencies)]) {
      if (file === missing) continue
      const target = join(root, file); mkdirSync(join(target, '..'), { recursive: true }); copyFileSync(file, target)
    }
    writeFileSync(join(root, 'Dockerfile.server'), text)
    if (id === 'floating-standalone-bun') {
      const path = join(root, 'scripts/build-server.ts')
      writeFileSync(path, readFileSync(path, 'utf8').replace('FROM oven/bun:${BUN_VERSION.replace(\'bun-v\', \'\')}-slim', 'FROM oven/bun:1.4-slim'))
    }
    if (id === 'desktop-worker-fork') {
      const path = join(root, 'scripts/electron-build-main.ts')
      writeFileSync(path, readFileSync(path, 'utf8').replace('"build:wa-worker"', '"esbuild"'))
    }
    const child = Bun.spawn([process.execPath, resolve('scripts/check-distribution.ts'), `--repository=${root}`], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    assert.equal(code === 0, success, `${id}: ${stderr}${stdout}`)
    records.push({ id, passed: true, output: stdout + stderr })
  }
  run.json('distribution-inputs.json', { records })
  run.complete(records.map(record => record.id), [])
})
