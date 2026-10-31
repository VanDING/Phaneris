#!/usr/bin/env bun
/** D01: separate Git checkout, empty Bun cache, frozen patched dependencies and real runtime builds. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('clean-install', async run => {
  const root = resolve(import.meta.dir, '../..'), directory = mkdtempSync(join(tmpdir(), 'phaneris-clean-install-'))
  const checkout = join(directory, 'repository'), cache = join(directory, 'empty-cache')
  mkdirSync(cache)
  const git = (args: string[]) => {
    const child = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(child.exitCode, 0, child.stderr.toString().slice(-2000)); return child.stdout.toString()
  }
  git(['clone', '--local', '--no-hardlinks', root, checkout])
  // Preserve the user's index. Reproduce the working source in the independent checkout.
  const files = git(['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  for (const file of files) {
    const target = join(checkout, file)
    if (!existsSync(join(root, file))) { rmSync(target, { force: true }); continue }
    mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(root, file), target)
  }
  const hash = (file: string) => createHash('sha256').update(readFileSync(join(checkout, file))).digest('hex')
  const before = { manifest: hash('package.json'), lock: hash('bun.lock'), linker: hash('bunfig.toml') }
  const commands: { args: string[]; exitCode: number; elapsedMs: number }[] = []
  const execute = async (args: string[], log: string, installCache: string, expected: number | 'failure') => {
    const started = Date.now()
    const child = Bun.spawn([process.execPath, ...args], { cwd: checkout, env: { ...process.env, BUN_INSTALL_CACHE_DIR: installCache }, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 20 * 60_000)
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      writeFileSync(join(run.directory, `${log}.log`), stdout + stderr)
      commands.push({ args, exitCode, elapsedMs: Date.now() - started })
      if (expected === 'failure') {
        assert.notEqual(exitCode, 0, 'A missing required patch must fail a real frozen install')
        assert.match(stdout + stderr, /patch|ENOENT/i)
      } else assert.equal(exitCode, expected, stderr.slice(-4000))
    } finally { clearTimeout(timer) }
  }
  try {
    const metadata = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')) as { patchedDependencies: Record<string, string> }
    const patch = join(checkout, Object.values(metadata.patchedDependencies)[0]!)
    renameSync(patch, patch + '.absent')
    try { await execute(['install', '--frozen-lockfile'], 'missing-patch', join(directory, 'negative-cache'), 'failure') }
    finally { renameSync(patch + '.absent', patch) }
    // The negative install may have extracted partial packages before failing.
    // The positive run must have neither installed modules nor a populated cache.
    rmSync(join(checkout, 'node_modules'), { recursive: true, force: true })
    for (const file of files.filter(file => /^(apps|packages)\/[^/]+\/package\.json$/.test(file))) {
      rmSync(join(checkout, dirname(file), 'node_modules'), { recursive: true, force: true })
    }
    await execute(['install', '--frozen-lockfile'], 'install', cache, 0)
    await execute(['run', 'check:docs'], 'docs-clean-checkout', cache, 0)
    await execute(['run', 'build:runtime'], 'runtime-build', cache, 0)
    await execute(['run', 'electron:build:main'], 'desktop-main-build', cache, 0)
  assert.equal(hash('bun.lock'), before.lock, 'Frozen install may not rewrite the lock')
  const resources = ['packages/pi-agent-server/dist/index.js', 'packages/pi-agent-server/dist/bundle.js',
    'packages/messaging-whatsapp-worker/dist/worker.cjs', 'apps/electron/dist/main.cjs'].map(path => ({ path, sha256: hash(path) }))
  run.json('clean-install.json', { directory, checkout, cache, cacheInitiallyEmpty: true, before, commands, resources,
    baseHead: git(['rev-parse', 'HEAD']).trim(), sourceFiles: files.length })
  run.complete(['real frozen install rejects an absent patch', 'independent checkout and empty cache', 'documentation resolves without local verification cache', 'frozen install preserves lock', 'real Pi and worker build from clean dependencies', 'desktop main builds without undeclared optional S3 SDK'],
    ['container Linux runtime', 'signed native installers'])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
