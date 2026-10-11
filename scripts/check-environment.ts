#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export const root = resolve(import.meta.dir, '..')
export const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

/** Inspect literal local entry points, respecting each script's working directory. */
export function localScriptTargets(scripts: Record<string, string>, rootDir: string): string[] {
  const targets: string[] = []
  for (const command of Object.values(scripts)) {
    let cwd = rootDir
    for (const part of command.split('&&')) {
      const cd = part.trim().match(/^cd\s+([^\s]+)$/)
      if (cd) { cwd = resolve(cwd, cd[1]!); continue }
      for (const match of part.matchAll(/(?:bun run|bash|node|--config)\s+((?:\.?\.?\/)?(?:scripts|apps|packages)\/[^\s"'$]+\.(?:ts|mjs|cjs|sh))/g)) {
        targets.push(resolve(cwd, match[1]!))
      }
    }
  }
  return [...new Set(targets)]
}

export function checkEnvironment(): void {
  const required = manifest.packageManager.replace(/^bun@/, '')
  const errors: string[] = []
  if (Bun.version !== required) {
    errors.push(`Bun ${required} required; running ${Bun.version} (${process.execPath}). Use the pinned Bun in PATH; global installation is not changed.`)
  }
  const node = spawnSync('node', ['--version'], { encoding: 'utf8' })
  if (node.status !== 0) errors.push('Node.js is required for Electron build tools.')
  for (const target of localScriptTargets(manifest.scripts, root)) {
    if (!existsSync(target)) errors.push(`Missing script entry: ${target}`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(`Environment OK: Bun ${Bun.version}, Node ${node.stdout.trim()}; local script entries exist.`)
}

/** Invoke scripts using the checked runtime, including nested "bun" commands. */
export async function run(args: string[], cwd = root, options: { logFile?: string; minimumTests?: number } = {}): Promise<void> {
  console.log(`\n> ${args.join(' ')}`)
  const child = Bun.spawn([process.execPath, ...args], {
    cwd, stdout: options.logFile ? 'pipe' : 'inherit', stderr: options.logFile ? 'pipe' : 'inherit',
    env: { ...process.env, PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` },
  })
  let captured = ''
  if (options.logFile) {
    writeFileSync(options.logFile, '')
    const copy = async (stream: ReadableStream<Uint8Array>, output: NodeJS.WriteStream) => {
      const decoder = new TextDecoder()
      for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true })
        captured += text
        appendFileSync(options.logFile!, text)
        output.write(text)
      }
    }
    await Promise.all([copy(child.stdout as ReadableStream<Uint8Array>, process.stdout), copy(child.stderr as ReadableStream<Uint8Array>, process.stderr)])
  }
  const code = await child.exited
  if (code !== 0) throw new Error(`${args.join(' ')} exited with ${code}`)
  if (options.minimumTests !== undefined) {
    const passes = [...captured.matchAll(/(\d+)\s+pass\b/g)].map(match => Number(match[1]))
    if (!options.logFile || !passes.length || passes.at(-1)! < options.minimumTests) {
      throw new Error(`${args.join(' ')} did not execute at least ${options.minimumTests} passing tests`)
    }
  }
}

if (import.meta.main) checkEnvironment()

