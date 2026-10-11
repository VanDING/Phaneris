#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkEnvironment, root, run } from './check-environment'
import { criticalTestGroups, criticalWorkflows } from './critical-scenarios'
import { VerificationRun, verifyVerificationDirectory } from './verification/verification-artifacts'

const args = process.argv.slice(2)
const repositoryArgument = args.find(arg => arg.startsWith('--repository='))?.slice('--repository='.length)
if (repositoryArgument && !args.includes('--preflight')) throw new Error('--repository is only supported for read-only preflight')
const checkedRoot = repositoryArgument ? resolve(repositoryArgument) : root
const missing = [
  ...criticalWorkflows.map(scene => resolve(checkedRoot, scene.entry)),
  ...criticalTestGroups.flatMap(([cwd, files]) => files.map(file => resolve(checkedRoot, cwd, file))),
].filter(file => !existsSync(file))
if (missing.length) throw new Error(`Missing critical scenario entries:\n${missing.join('\n')}`)
if (args.includes('--preflight')) {
  console.log(`Critical preflight OK: ${criticalWorkflows.length} workflows and ${criticalTestGroups.length} package groups`)
} else {
  const evidence = new VerificationRun('critical', args)
  let failure: unknown
  const completed: string[] = []
  try {
    evidence.checkArguments()
    checkEnvironment()
    await run(['run', 'build:runtime'], root, { logFile: join(evidence.directory, 'runtime-build.log') })
    for (const gate of ['runtime-boundary', 'architecture', 'automation-events']) {
      await run(['run', `scripts/check-${gate}.ts`], root, { logFile: join(evidence.directory, `${gate}.log`) })
    }
    for (const scene of criticalWorkflows) {
      const directory = join(evidence.directory, scene.id)
      await run(['run', scene.entry, `--output-dir=${directory}`], root, { logFile: join(evidence.directory, `${scene.id}.log`) })
      verifyVerificationDirectory(directory, { workflow: scene.id, minimum: scene.minimum, required: scene.required })
      completed.push(scene.id)
    }
    // Separate package processes preserve Bun mock isolation. No provider credentials required.
    for (const [cwd, files] of criticalTestGroups) {
      const isolated = files.filter(file => file.includes('.isolated.'))
      const shared = files.filter(file => !file.includes('.isolated.'))
      const groupCwd = resolve(root, cwd)
      if (shared.length) await run(['test', ...shared.map(file => './' + file)], groupCwd, { logFile: join(evidence.directory, `${cwd.replaceAll('/', '-')}-tests.log`), minimumTests: 1 })
      for (const file of isolated) await run(['test', './' + file], groupCwd, { logFile: join(evidence.directory, `${cwd.replaceAll('/', '-')}-${file.replaceAll('/', '-')}.log`), minimumTests: 1 })
      completed.push(`tests:${cwd}`)
    }
    evidence.complete(completed)
  } catch (error) { failure = error }
  evidence.json('critical.json', { workflows: criticalWorkflows, groups: criticalTestGroups, completed })
  evidence.finish(failure)
  console.log(JSON.stringify({ passed: completed.length, output: join(evidence.directory, 'critical.json') }))
}
