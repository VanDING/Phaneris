/** CO-11: real unpacked app, production staging, foreign cwd and native lifecycle. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { copyPiAgentServer } from '../build/common'
import { verificationWorkflow, verifyVerificationDirectory } from './verification-artifacts'

await verificationWorkflow('upgrade-0153-packaged', async run => {
  assert.equal(process.platform, 'win32', 'Windows unpacked acceptance requires win32')
  const root = resolve(import.meta.dir, '../..')
  const electron = join(root, 'apps/electron')
  const release = join(electron, 'release')
  const originalRelease = existsSync(release) ? readdirSync(release).sort() : []
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const commands: unknown[] = []
  async function command(name: string, args: string[], cwd: string, env = process.env, timeoutMs = 900_000) {
    const started = Date.now()
    const child = Bun.spawn(args, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => {
      Bun.spawnSync(['taskkill', '/PID', String(child.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' })
    }, timeoutMs)
    try {
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      writeFileSync(join(run.directory, `${name}.log`), out + err)
      commands.push({ name, args, code, elapsedMs: Date.now() - started, logSha256: hash(join(run.directory, `${name}.log`)) })
      assert.equal(code, 0, `${name}: ${(out + err).slice(-4000)}`)
    } finally { clearTimeout(timer) }
  }
  // The same production helper used by release builds; does not install koffi
  // just to satisfy a stale trustedDependencies entry when it has no consumer.
  copyPiAgentServer({ platform: 'win32', arch: 'x64', upload: false, uploadLatest: false, uploadScript: false, rootDir: root, electronDir: electron })
  const packageDirectory = join(run.directory, 'package')
  const env = { ...process.env, PATH: `${process.env.PATH};C:\\Program Files\\Git\\usr\\bin` }
  await command('package', ['bun', 'run', 'electron-builder', '--config', 'electron-builder.yml', '--dir', `--config.directories.output=${packageDirectory}`], electron, env)
  const unpackedDirectory = mkdtempSync(join(tmpdir(), 'phaneris-0153-unpacked-'))
  assert(!unpackedDirectory.toLowerCase().startsWith(root.toLowerCase()), 'the entire app must be outside the checkout, not only its cwd')
  cpSync(join(packageDirectory, 'win-unpacked'), unpackedDirectory, { recursive: true })
  const executable = join(unpackedDirectory, 'Phaneris.exe')
  assert(existsSync(executable))
  assert.equal(hash(executable), hash(join(packageDirectory, 'win-unpacked/Phaneris.exe')))
  const appRoot = join(unpackedDirectory, 'resources/app')
  const packaged = ['dist/main.cjs', 'dist/bootstrap-preload.cjs', 'resources/pi-agent-server/index.js', 'resources/pi-agent-server/bundle.js']
  const packagedPath = (file: string) => file.startsWith('resources/pi-agent-server/')
    ? join(unpackedDirectory, file) : join(appRoot, file)
  for (const file of packaged) assert.equal(hash(packagedPath(file)), hash(join(electron, file)), `packaged ${file} must be the current build`)
  const nativeDirectory = join(run.directory, 'native')
  await command('native-attachments', ['bun', 'run', 'scripts/verification/upgrade-0153-native-attachments-workflow.ts', `--output-dir=${nativeDirectory}`], root,
    { ...env, PHANERIS_NATIVE_EXECUTABLE: executable }, 360_000)
  const native = verifyVerificationDirectory(nativeDirectory, { workflow: 'upgrade-0153-native-attachments', minimum: 7, required: ['native-attachments.json', 'native-pty.json', 'provider-requests.json', 'trace.zip'] })
  const reopenDirectory = join(run.directory, 'reopen')
  await command('windows-reopen', ['bun', 'run', 'scripts/verification/windows-reopen-workflow.ts', `--output-dir=${reopenDirectory}`], root,
    { ...env, PHANERIS_REOPEN_EXECUTABLE: executable }, 360_000)
  const reopen = verifyVerificationDirectory(reopenDirectory, { workflow: 'windows-reopen', minimum: 6, required: ['windows-reopen.json', 'built-main.json'] })
  assert.deepEqual(existsSync(release) ? readdirSync(release).sort() : [], originalRelease)
  run.json('packaged.json', { executable, packageDirectory, unpackedDirectory, commands,
    currentBuilds: Object.fromEntries(packaged.map(file => [file, hash(packagedPath(file))])),
    attachmentScenes: native.sceneIds, reopenScenes: reopen.sceneIds,
    reachability: { koffi: { installed: existsSync(join(root, 'node_modules/koffi/package.json')), note: 'Not in the frozen dependency graph; production copyPiAgentServer was invoked, no new dependency added.' },
      sharp: { desktopConsumer: false, consumer: 'packages/server-core/src/runtime/platform-headless.ts; headless artifact requires darwin/linux' } },
    releaseUnchanged: originalRelease })
  run.complete(['production-staging-and-current-build-hashes', 'real-unpacked-main-preload-renderer-attachments-from-foreign-cwd',
    'packaged-native-reopen-and-lifecycle', 'existing-release-directory-preserved'], ['signing/installer execution', 'macOS/Linux', 'headless artifact and sharp runtime on its supported OS'])
})
