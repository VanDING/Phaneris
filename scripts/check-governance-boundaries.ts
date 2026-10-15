#!/usr/bin/env bun
/** Resolved graph rules: pure contracts, single config writer, domain direction and direct dependency ownership. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative, resolve } from 'node:path'
import type { Node } from '@babel/types'
import { isTypeOnlyReference, memberName, packageNameOf, scanImportGraph } from './lib/import-graph'

const repository = resolve(process.argv.find(arg => arg.startsWith('--repository='))?.slice(13) ?? resolve(import.meta.dir, '..'))
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const name = (file: string) => relative(repository, file).replaceAll('\\', '/')
const owner = (file: string) => name(file).match(/^(?:packages|apps)\/[^/]+/)?.[0]
const builtins = new Set(builtinModules.flatMap(value => [value, `node:${value}`]))
const failures: string[] = []
const runtime = new Map<string, Set<string>>()
const external = new Map<string, Set<string>>()
const references: { from: string; to?: string; specifier: string; typeOnly: boolean }[] = []
const typedBoundaries = /^(?:apps\/cli\/src\/(?:client|index)\.ts|apps\/electron\/src\/(?:preload\/bootstrap\.ts|transport\/)|packages\/server-core\/src\/transport\/)/
const piValuePorts = new Set(['agent/context-policy', 'config/pi-provider-compat', 'utils/large-response', 'sessions/paths',
  'agent/llm-tool', 'agent/backend/pi/constants', 'config/models', 'config/llm-connections', 'decisions/types',
  // Dependency-free sanitizer shared by the SDK journal and immutable host facts.
  'utils/browser-input-privacy'])
const definitions = new Map<string, Map<string, Node>>()
const importedNames = new Map<string, Map<string, string>>()
const calls: { file: string; node: Extract<Node, { type: 'CallExpression' }> }[] = []
const mutations: { file: string; line?: number; operation: string }[] = []
const assemblyRoots = ['agent-assembly', 'agent-product-context', 'agent-product-callbacks', 'source-resources', 'product-repository']
  .map(owner => `packages/server-core/src/sessions/${owner}.ts`)
const scan = scanImportGraph(repository, {
  onModuleStart(ctx) {
    const file = name(ctx.file)
    definitions.set(file, new Map()); importedNames.set(file, new Map())
    if (/packages\/pi-agent-server\/src\/(?:index|session-event-adapter)\.ts$/.test(file)
      && /\bdurableTool(?:Commits|Batches)\b/.test(ctx.code)) failures.push(`${file}: tool accounting must use its private state owner`)
  },
  onImport(ctx, node, specifier, target) {
    const typeOnly = isTypeOnlyReference(node)
    const from = name(ctx.file), to = target ? name(target) : undefined
    references.push({ from, to, specifier, typeOnly })
    if (node.type === 'ImportDeclaration') for (const item of node.specifiers) {
      if (item.type === 'ImportSpecifier') importedNames.get(from)!.set(item.local.name,
        item.imported.type === 'Identifier' ? item.imported.name : item.imported.value)
    }
    if (from.startsWith('packages/pi-agent-server/src/') && to?.startsWith('packages/shared/src/')) {
      if (!specifier.startsWith('@phaneris/shared/')) failures.push(`${from}: Pi requires a declared shared public port, received ${specifier}`)
      if (!typeOnly && !piValuePorts.has(specifier.slice('@phaneris/shared/'.length))) failures.push(`${from}: unreviewed Pi shared value port ${specifier}`)
    }
    if (!typeOnly) {
      if (target) { if (!runtime.has(from)) runtime.set(from, new Set()); runtime.get(from)!.add(to!) }
      else { if (!external.has(from)) external.set(from, new Set()); external.get(from)!.add(specifier) }
    }
    if (from.startsWith('packages/shared/src/config/') && !/\/(?:index|storage)\.ts$/.test(from)
      && to && /packages\/shared\/src\/config\/(?:index|storage)\.ts$/.test(to)) failures.push(`${from}: config domain imports compatibility facade ${to}`)
    if (from.startsWith('packages/server-core/src/sessions/agent-assembly') && to
      && (/\/SessionManager\.ts$/.test(to) || /durable-runtime\/(?:host|store|coordinator|internal)/.test(to))) failures.push(`${from}: assembly reverses ownership through ${to}`)
    const fromOwner = owner(ctx.file), toOwner = target ? owner(target) : undefined
    if (fromOwner?.startsWith('packages/') && toOwner?.startsWith('apps/')) failures.push(`${from}: service/package imports application ${to}`)
    // Resolve relative imports as well as named imports. App source sharing is handled by browser closure rules.
    if (target && fromOwner && toOwner && fromOwner !== toOwner && toOwner.startsWith('packages/')) {
      const metadata = JSON.parse(readFileSync(join(repository, toOwner, 'package.json'), 'utf8')) as { exports?: Record<string, string>; main?: string }
      const exports = Object.values(metadata.exports ?? (metadata.main ? { '.': metadata.main } : {}))
      if (!exports.some(path => resolve(repository, toOwner, path) === target)) failures.push(`${from}: cross-package target has no public export (${specifier} -> ${to})`)
    }
    if (!target && fromOwner && !specifier.startsWith('.') && !specifier.startsWith('@/') && !specifier.startsWith('@config/')
      && !specifier.startsWith('@webui/') && !builtins.has(specifier)) {
      const metadata = JSON.parse(readFileSync(join(repository, fromOwner, 'package.json'), 'utf8')) as Record<string, Record<string, unknown>>
      const dependency = packageNameOf(specifier)
      if (typeOnly && ['dependencies', 'devDependencies'].some(field => metadata[field]?.[`@types/${dependency.replace('@', '').replace('/', '__')}`])) return
      if (!['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(field => metadata[field]?.[dependency])) failures.push(`${fromOwner}: undeclared direct dependency ${dependency} (${from})`)
    }
  },
  onNode(ctx, node) {
    if (name(ctx.file) === 'packages/pi-agent-server/src/session-event-adapter.ts' && node.type === 'TSTypeReference'
      && node.typeName.type === 'Identifier' && node.typeName.name === 'Map') failures.push(`${name(ctx.file)}: mutable Map ports bypass state owners`)
    if (typedBoundaries.test(name(ctx.file)) && node.type === 'TSAnyKeyword') failures.push(`${name(ctx.file)}:${node.loc?.start.line}: boundary any must be unknown plus validation or a shared DTO`)
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) definitions.get(name(ctx.file))!.set(node.id.name, node.init)
    if (node.type === 'CallExpression') calls.push({ file: name(ctx.file), node })
  },
})
function operation(file: string, node: Node): string | undefined {
  return node.type === 'Identifier' ? importedNames.get(file)?.get(node.name) ?? node.name : memberName(node)
}
function rootConfigPath(file: string, node: Node | undefined, seen = new Set<string>()): boolean {
  if (!node) return false
  if (node.type === 'Identifier') {
    if ((importedNames.get(file)?.get(node.name) ?? node.name) === 'CONFIG_FILE') return true
    if (seen.has(node.name)) return false
    seen.add(node.name)
    return rootConfigPath(file, definitions.get(file)?.get(node.name), seen)
  }
  if (memberName(node) === 'CONFIG_FILE') return true
  if (node.type === 'CallExpression') {
    if (operation(file, node.callee) === 'getConfigPath') return true
    if (['join', 'resolve'].includes(operation(file, node.callee) ?? '') && node.arguments.some(arg => arg.type === 'StringLiteral' && arg.value === 'config.json')) {
      return node.arguments.some(arg => arg.type === 'Identifier' && (importedNames.get(file)?.get(arg.name) ?? arg.name) === 'CONFIG_DIR')
    }
  }
  return false
}
const io = new Set(['atomicWriteFileSync', 'writeFileSync', 'writeFile', 'appendFile', 'appendFileSync', 'rm', 'rmSync', 'unlink', 'unlinkSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync'])
for (const { file, node } of calls) {
  const method = operation(file, node.callee)
  if (!method || !io.has(method)) continue
  const args = /^(?:copyFile|rename)/.test(method) ? node.arguments.slice(0, 2) : node.arguments.slice(0, 1)
  if (!args.some(arg => rootConfigPath(file, arg))) continue
  mutations.push({ file, line: node.loc?.start.line, operation: method })
  if (file !== 'packages/shared/src/config/repository.ts') failures.push(`${file}:${node.loc?.start.line}: config.json ${method} bypasses repository owner`)
}
const writes = new Set(mutations.filter(row => /write|append/i.test(row.operation)).map(row => row.file)).size
const pure = ['schemas', 'persisted-types', 'connection-normalize', 'source-validation'].map(domain => `packages/shared/src/config/${domain}.ts`)
const roots = [...pure, 'packages/shared/src/protocol/index.ts', 'packages/shared/src/agent/permissions-validation.ts']
const closures: Record<string, string[]> = {}
for (const root of roots) {
  if (!existsSync(join(repository, root))) { failures.push(`Missing required pure entry ${root}`); continue }
  const seen = new Set<string>(), queue = [root]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of external.get(file) ?? []) {
      if (builtins.has(specifier) || ['electron', 'open', 'ws', '@sentry/electron'].includes(packageNameOf(specifier))) failures.push(`${root}: pure closure reaches ${specifier} via ${file}`)
    }
    if (/\/config\/(?:storage|repository|migrations|appearance|connections|workspace-selection|index)\.ts$/.test(file)
      || /\/(?:credentials|sessions|sources|plugins)\/(?:index|storage|manager)\.ts$/.test(file)
      || /\/agent\/(?:pi-agent|base-agent|index)\.ts$/.test(file)) failures.push(`${root}: pure contract reaches host implementation ${file}`)
    queue.push(...runtime.get(file) ?? [])
  }
  closures[root] = [...seen].sort()
}
for (const root of assemblyRoots) {
  if (!existsSync(join(repository, root))) { failures.push(`Missing required session owner ${root}`); continue }
  const seen = new Set<string>(), queue = [root]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (/\/SessionManager\.ts$/.test(file) || /durable-runtime\/(?:host|store|coordinator|internal)(?:\/|\.)/.test(file)) {
      failures.push(`${root}: session owner reverses ownership through ${file}`)
    }
    // Traverse all local references, including type and barrel aliases.
    queue.push(...(scan.graph.get(join(repository, file)) ?? []).map(edge => name(edge.target)))
  }
  closures[root] = [...seen].sort()
}
if (scan.scannedFiles < 2 || references.length === 0) failures.push('Boundary scan is empty')
if (writes !== 1) failures.push(`Expected exactly one config.json writer, found ${writes}`)
const report = { schemaVersion: 2, scannedFiles: scan.scannedFiles, references: references.length, configWriters: writes, mutations, closures,
  failures: [...new Set(failures)].sort() }
if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n')
if (report.failures.length) { console.error(report.failures.join('\n')); process.exitCode = 1 }
else console.log(`Governance boundaries OK: ${scan.scannedFiles} modules; ${references.length} references; ${roots.length} pure entries; one config writer`)
