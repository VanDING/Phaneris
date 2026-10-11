#!/usr/bin/env bun
/** Runtime SCCs, including relative imports and barrels, with exact reviewed edge ownership. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { scanImportGraph } from './lib/import-graph'

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const root = resolve(arg('repository') ?? resolve(import.meta.dir, '..'))
const name = (file: string) => relative(root, file).replaceAll('\\', '/')
const webConfig = resolve(root, 'apps/webui/tsconfig.json')
const paths = existsSync(webConfig) ? (JSON.parse(readFileSync(webConfig, 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } }).compilerOptions.paths : {}
const aliases = Object.entries(paths).filter(([key]) => key.endsWith('*') && key !== '*' && !key.startsWith('@phaneris/'))
  .map(([key, values]) => ({ prefix: key.slice(0, -1), directory: resolve(root, 'apps/webui', values[0]!.replace(/\*$/, '')) }))
const scan = scanImportGraph(root, {}, { aliases })
assert(scan.scannedFiles > 0, 'No modules scanned for cycles')
const adjacency = new Map([...scan.graph].map(([from, edges]) => [name(from), edges.filter(edge => !edge.typeOnly).map(edge => name(edge.target))]))
let counter = 0
const indexes = new Map<string, number>(), lows = new Map<string, number>(), stack: string[] = [], active = new Set<string>()
const components: string[][] = []
function visit(file: string): void {
  const index = counter++; indexes.set(file, index); lows.set(file, index); stack.push(file); active.add(file)
  for (const target of adjacency.get(file) ?? []) {
    if (!indexes.has(target)) { visit(target); lows.set(file, Math.min(lows.get(file)!, lows.get(target)!)) }
    else if (active.has(target)) lows.set(file, Math.min(lows.get(file)!, indexes.get(target)!))
  }
  if (lows.get(file) !== index) return
  const members: string[] = []
  let member: string
  do { member = stack.pop()!; active.delete(member); members.push(member) } while (member !== file)
  if (members.length > 1 || adjacency.get(file)?.includes(file)) components.push(members.sort())
}
for (const file of adjacency.keys()) if (!indexes.has(file)) visit(file)
const cycles = components.map(members => {
  const included = new Set(members)
  const edges = members.flatMap(from => [...new Set(adjacency.get(from) ?? [])].filter(to => included.has(to)).map(to => ({ from, to })))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { members, edges }
}).sort((a, b) => JSON.stringify(a.members).localeCompare(JSON.stringify(b.members)))
interface Allowance { members: string[]; edges: { from: string; to: string }[]; owner: string; reason: string }
const baseline = JSON.parse(readFileSync(resolve(arg('baseline') ?? resolve(import.meta.dir, 'cycle-ownership.json')), 'utf8')) as { allowed: Allowance[] }
const used = new Set<number>(), failures: string[] = []
for (const allowance of baseline.allowed) assert(allowance.owner?.trim() && allowance.reason?.trim(), 'Cycle allowance needs owner and verified reason')
for (const cycle of cycles) {
  const index = baseline.allowed.findIndex(allowance => JSON.stringify(allowance.members) === JSON.stringify(cycle.members)
    && JSON.stringify(allowance.edges) === JSON.stringify(cycle.edges))
  if (index < 0) failures.push(`New runtime cycle or changed edges: ${cycle.members.join(' -> ')}`)
  else used.add(index)
}
baseline.allowed.forEach((allowance, index) => { if (!used.has(index)) failures.push(`Retire stale cycle allowance: ${allowance.members.join(', ')}`) })
const report = { scanned: scan.scannedFiles, cycles, failures }
if (arg('output')) writeFileSync(resolve(arg('output')!), JSON.stringify(report, null, 2) + '\n')
assert.equal(failures.length, 0, failures.join('\n'))
console.log(`Runtime cycles OK: ${scan.scannedFiles} modules; ${cycles.length} exact reviewed compositions; new/changed/stale edges fail`)
