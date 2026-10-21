#!/usr/bin/env bun
/**
 * File-size ratchet for the known god files.
 *
 * Extracting a giant component is a sequence of small, reviewable cuts; nothing
 * in the existing gates notices when the next feature adds 200 lines back. This
 * gate pins the current size of each file that is still over the threshold and
 * fails when one grows. Lowering a budget is a one-line edit — the direction of
 * travel is the only rule.
 *
 * Not a style rule: lines are a proxy for "how much has to be understood at
 * once", which is exactly what the audit's maintainability finding measured.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const budgetPath = join(root, 'scripts/file-size-budget.json')

interface BudgetFile { path: string; maxLines: number; note?: string }
interface Budget { threshold: number; files: BudgetFile[] }

const budget = JSON.parse(readFileSync(budgetPath, 'utf8')) as Budget

const countLines = (path: string): number => {
  const text = readFileSync(join(root, path), 'utf8')
  // A trailing newline is not a line of its own.
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

const failures: string[] = []
const slack: string[] = []

for (const file of budget.files) {
  const lines = countLines(file.path)
  if (lines > file.maxLines) {
    failures.push(`${file.path}: ${lines} lines, budget ${file.maxLines} (+${lines - file.maxLines})`)
  } else if (lines < file.maxLines) {
    slack.push(`${file.path}: ${lines} lines, budget ${file.maxLines} — tighten to ${lines}`)
  }
}

// A file that grows past the threshold without a budget is the case this gate
// exists for: it becomes a god file silently.
const registered = new Set(budget.files.map(file => file.path))
const unregistered = (process.argv.slice(2).includes('--scan')
  ? (JSON.parse(readFileSync(join(root, '.cache/oversized-files.json'), 'utf8')) as string[])
  : []).filter(path => !registered.has(path))

if (unregistered.length > 0) {
  failures.push(`files over ${budget.threshold} lines without a budget: ${unregistered.join(', ')}`)
}

for (const line of slack) console.log(`can tighten — ${line}`)

if (failures.length > 0) {
  console.error('File-size ratchet failures:\n' + failures.map(line => `- ${line}`).join('\n'))
  process.exit(1)
}

console.log(`File-size ratchet OK: ${budget.files.length} files within budget (threshold ${budget.threshold} lines).`)
