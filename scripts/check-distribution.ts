#!/usr/bin/env bun
/** Reproducible manifest/install/build inputs shared by image, server and desktop. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(process.argv.find(arg => arg.startsWith('--repository='))?.slice(13) ?? resolve(import.meta.dir, '..'))
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  packageManager: string; workspaces: string[]; patchedDependencies: Record<string, string>; scripts: Record<string, string>
}
const docker = readFileSync(join(root, 'Dockerfile.server'), 'utf8')
const bun = metadata.packageManager.replace(/^bun@/, '')
const failures: string[] = []
const members = metadata.workspaces.flatMap(pattern => [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root })]
  .map(path => path.replaceAll('\\', '/').slice(0, -'/package.json'.length))).sort()
if (members.length === 0) failures.push('Distribution workspace scan is empty')
if (!docker.includes(`FROM oven/bun:${bun}-slim`)) failures.push(`Docker Bun must match packageManager ${bun}`)
if (!docker.includes('python3 make g++') || docker.indexOf('python3 make g++') > docker.indexOf('RUN bun install --frozen-lockfile')) failures.push('Native node-pty builds require Python, make and a C++ compiler before install')
if (!docker.includes('ENTRYPOINT ["bun", "packages/server/src/index.ts"]')) failures.push('Container PID 1 must run the service directly to receive shutdown signals')
const install = docker.indexOf('RUN bun install --frozen-lockfile'), patches = docker.indexOf('COPY patches/ patches/')
if (install < 0 || patches < 0 || patches > install) failures.push('All patches must be copied before frozen install')
for (const member of members) {
  const manifest = `${member}/package.json`
  if (!existsSync(join(root, manifest))) failures.push(`Missing workspace manifest: ${manifest}`)
  if (docker.indexOf(`COPY ${manifest} ${member}/`) < 0 || docker.indexOf(`COPY ${manifest} ${member}/`) > install) failures.push(`Workspace install input missing: ${manifest}`)
}
if (metadata.scripts['build:runtime'] !== 'bun run server:build:subprocess && bun run build:wa-worker') failures.push('Pi/worker build command must remain shared')
if (!docker.includes('RUN bun run build:runtime')) failures.push('Docker must use the shared Pi/worker build command')
if (!docker.includes('ENV PHANERIS_IS_PACKAGED=true')) failures.push('Docker must validate production resources before listening')
if (!docker.includes('cp -R packages/pi-agent-server/dist/. apps/electron/resources/pi-agent-server/')) failures.push('Docker must stage the complete Pi production resources')
const serverBuild = readFileSync(join(root, 'scripts/build-server.ts'), 'utf8')
const desktopBuild = readFileSync(join(root, 'scripts/electron-build-main.ts'), 'utf8')
const runtimeConstants = readFileSync(join(root, 'scripts/build/common.ts'), 'utf8')
if (!serverBuild.includes("FROM oven/bun:${BUN_VERSION.replace('bun-v', '')}-slim")) failures.push('Standalone Docker must use the shared Bun pin')
if (!runtimeConstants.includes("BUN_VERSION = `bun-v${rootPackage.packageManager.split('@')[1]}`")
  && !runtimeConstants.includes(`BUN_VERSION = "bun-v${bun}"`) && !runtimeConstants.includes(`BUN_VERSION = 'bun-v${bun}'`)) failures.push('Runtime Bun pin must match packageManager')
if (!desktopBuild.includes('cmd: ["bun", "run", "build:wa-worker"]')) failures.push('Desktop must use the shared worker build command')
if (!metadata.scripts['server:prod']?.startsWith('bun run build:runtime &&')) failures.push('Standalone server must use the shared runtime build')
const ignored = readFileSync(join(root, '.dockerignore'), 'utf8')
if (!ignored.split('\n').includes('.cache/')) failures.push('Verification caches must not enter the production image')
const files = ['package.json', 'bun.lock', 'bunfig.toml', 'Dockerfile.server', '.dockerignore',
  'scripts/build-server.ts', 'scripts/electron-build-main.ts', 'scripts/build/common.ts',
  ...members.map(member => `${member}/package.json`), ...Object.values(metadata.patchedDependencies)]
const inputs = files.map(path => {
  if (!existsSync(join(root, path))) { failures.push(`Missing distribution input: ${path}`); return { path, sha256: null } }
  return { path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }
})
const report = { schemaVersion: 1, bun, workspaces: members.length, patches: Object.keys(metadata.patchedDependencies).length,
  commands: { runtime: metadata.scripts['build:runtime'], server: metadata.scripts['server:prod'], desktop: metadata.scripts['electron:build'], webui: metadata.scripts['webui:build'] }, inputs, failures }
if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n')
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
else console.log(`Distribution inputs OK: Bun ${bun}; ${report.workspaces} workspaces; ${report.patches} patches before install`)
