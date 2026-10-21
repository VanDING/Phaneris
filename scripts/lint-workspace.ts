#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { ESLint } from 'eslint'
import { VerificationRun } from './verification/verification-artifacts'

const root = resolve(import.meta.dir, '..')
interface Debt { file: string; rule: string; message: string; count: number; reason: string; owner: string }
const args = process.argv.slice(2)
const baselineArgument = args.find(arg => arg.startsWith('--baseline='))
const baselineFile = baselineArgument ? resolve(baselineArgument.slice('--baseline='.length)) : join(root, 'scripts/lint-warning-baseline.json')
const evidence = new VerificationRun('lint-workspace', args)
let failure: unknown
try {
    const prune = args.includes('--prune')
  evidence.checkArguments([...(baselineArgument ? [baselineArgument] : []), ...(prune ? ['--prune'] : [])])
  const coverage = JSON.parse(readFileSync(join(root, 'scripts/quality-coverage.json'), 'utf8')) as { members: Record<string, unknown> }
  const configured = ['apps/electron', 'packages/shared', 'packages/ui']
  const results: ESLint.LintResult[] = []
  for (const member of configured) {
    const eslint = new ESLint({ cwd: join(root, member) })
    results.push(...await eslint.lintFiles(['src/**/*.{ts,tsx}']))
  }
  const generic = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.config.mjs') })
  results.push(...await generic.lintFiles([
    ...Object.keys(coverage.members).filter(member => !configured.includes(member)).map(member => `${member}/src/**/*.{ts,tsx}`),
    'scripts/**/*.{ts,mjs,cjs}', 'apps/electron/scripts/**/*.{ts,mjs,cjs}',
  ]))
  assert(results.length > 0, 'No files linted')
  evidence.json('lint.json', results)
  const errors = results.flatMap(result => result.messages.filter(message => message.severity === 2)
    .map(message => `${relative(root, result.filePath)}:${message.line} ${message.ruleId}: ${message.message}`))
  assert.equal(errors.length, 0, errors.join('\n'))
  const current = new Map<string, Debt>()
  for (const result of results) for (const message of result.messages.filter(message => message.severity === 1)) {
    const file = relative(root, result.filePath).replaceAll('\\', '/'), rule = message.ruleId ?? 'unused-eslint-disable'
    const key = JSON.stringify([file, rule, message.message])
    const entry = current.get(key)
    if (entry) entry.count++
    else current.set(key, { file, rule, message: message.message, count: 1,
      reason: rule === 'react-hooks/exhaustive-deps' ? 'Existing hook lifecycle debt; verify subscription/cancellation E2E before changing dependencies (G7).'
        : rule === 'phaneris/no-localstorage' ? 'Existing persistence ownership debt; migrate through the client platform boundary (G7).'
        : rule === 'no-async-promise-executor' ? 'Existing async failure ownership needs failure-first lifecycle verification (G2c/G6).'
        : 'Existing unused suppression; remove when maintaining this file (G1).',
      owner: file.startsWith('scripts/') ? 'verification/tooling' : file.split('/').slice(0, 2).join('/'),
    })
  }
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as { entries: Debt[] }
  const registered = new Map<string, Debt>()
  for (const entry of baseline.entries) {
    assert(entry.reason && entry.owner && entry.count > 0, 'Warning debt requires a reason, owner and positive count')
    const key = JSON.stringify([entry.file, entry.rule, entry.message])
    assert(!registered.has(key), `Duplicate warning allowance: ${entry.file}`)
    registered.set(key, entry)
  }
  const changes: string[] = []
  for (const [key, entry] of current) {
    const allowance = registered.get(key)
    if (!allowance || entry.count > allowance.count) changes.push(`New warning: ${entry.file} ${entry.rule}: ${entry.message}`)
  }
  for (const [key, entry] of registered) {
    if ((current.get(key)?.count ?? 0) < entry.count) changes.push(`Retire stale warning allowance: ${entry.file} ${entry.rule}`)
  }
  // `--prune` is the retirement path for the message above: drop the allowances
  // that no longer fire and keep the rest byte-identical, so paying down warning
  // debt is one supported command (mirroring `check-visual-contracts --prune`)
  // instead of a hand-edit of a 500-line JSON file.
  if (prune) {
    const kept = baseline.entries.filter(entry => (current.get(JSON.stringify([entry.file, entry.rule, entry.message]))?.count ?? 0) >= entry.count)
    const writeFileSync = (await import('node:fs')).writeFileSync
    writeFileSync(baselineFile, JSON.stringify({ ...baseline, entries: kept }, null, 2) + '\n')
    console.log(`Warning baseline pruned: ${baseline.entries.length - kept.length} stale retired, ${kept.length} entries.`)
    changes.length = 0
  }
  assert.equal(changes.length, 0, changes.join('\n'))
  evidence.complete([...Object.keys(coverage.members).map(member => `lint:${member}`), 'lint:tooling'])
  console.log(`Workspace lint OK: ${results.length} files, ${[...current.values()].reduce((total, entry) => total + entry.count, 0)} registered warnings`)
} catch (error) { failure = error }
evidence.finish(failure)
