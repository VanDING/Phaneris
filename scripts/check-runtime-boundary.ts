#!/usr/bin/env bun
/** Resolved source graph, including type imports, re-exports and dynamic imports. */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parse } from '@babel/parser'
import type { Node } from '@babel/types'

const root = resolve(process.argv.find(arg => arg.startsWith('--repository='))?.slice(13) ?? resolve(import.meta.dir, '..'))
const baseline = process.argv.includes('--baseline')
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const files: string[] = []
const violations: Array<{ file: string; line: number; rule: string; detail: string }> = []
const graph = new Map<string, Array<{ target: string; line: number }>>()
const pathName = (file: string) => relative(root, file).replaceAll('\\', '/')
function walk(directory: string) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { if (!['__tests__', 'node_modules', 'dist', 'fixtures'].includes(entry.name)) walk(path) }
    else if (/\.(?:[cm]?js|jsx|tsx?)$/.test(entry.name) && !/\.(test|isolated)\.[cm]?[jt]sx?$|fixture\.[jt]s$/.test(entry.name)) files.push(path)
  }
}
const packages = new Map<string, { directory: string; exports: Record<string, string> }>()
for (const parent of ['packages', 'apps']) for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = join(root, parent, entry.name), metadata = join(directory, 'package.json')
  if (existsSync(metadata)) { const pkg = JSON.parse(readFileSync(metadata, 'utf8')); packages.set(pkg.name, { directory, exports: pkg.exports ?? { '.': pkg.main } }) }
  walk(join(directory, 'src'))
}
function sourceFile(path: string): string | undefined {
  for (const candidate of [path, path.replace(/\.js$/, '.ts'), path.replace(/\.js$/, '.tsx'), `${path}.ts`, `${path}.tsx`, `${path}.js`, join(path, 'index.ts'), join(path, 'index.js')])
    if (existsSync(candidate) && /\.(?:[cm]?js|jsx|tsx?)$/.test(candidate)) return resolve(candidate)
}
function resolveModule(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) return sourceFile(resolve(dirname(file), specifier))
  if (specifier.startsWith('@/')) {
    const match = pathName(file).match(/^(apps|packages)\/([^/]+)\/src\//)
    if (match) return sourceFile(join(root, match[1]!, match[2]!, 'src', ...(match[2] === 'electron' ? ['renderer'] : []), specifier.slice(2)))
  }
  const pkgName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
  const pkg = packages.get(pkgName)
  if (!pkg) return
  const key = specifier === pkgName ? '.' : `.${specifier.slice(pkgName.length)}`
  let target = pkg.exports[key]
  if (!target) for (const [pattern, value] of Object.entries(pkg.exports)) {
    const [prefix, suffix] = pattern.split('*')
    if (typeof value === 'string' && pattern.includes('*') && key.startsWith(prefix!) && key.endsWith(suffix!)) { target = value.replace('*', key.slice(prefix!.length, suffix ? -suffix.length : undefined)); break }
  }
  if (typeof target === 'string') return sourceFile(resolve(pkg.directory, target))
}
const internal = (file: string) => pathName(file).includes('/server-core/src/durable-runtime/')
const forbiddenProduct = (file: string) => /\/(sessions|tasks|decisions|agent|runtime-adapters|handlers|transport|bootstrap)\//.test(pathName(file)) || pathName(file).startsWith('apps/')
const privateObjects = new Set(['DurableRuntimeCoordinator', 'DurableRuntimeStore', 'DurableProjectionRunner'])
const owned = new Set(['agent', 'isProcessing', 'stopRequested', 'processingGeneration', 'activeDurableRunOperationId', 'messageQueue'])
const parsedFiles = new Set(files)
for (const file of files) {
  const name = pathName(file), code = readFileSync(file, 'utf8')
  const source = parse(code, { sourceType: 'unambiguous', plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? ['jsx' as const] : [])] })
  const runtime = internal(file), kernelOrHost = runtime && !/\/api\//.test(name) && !name.endsWith('/index.ts')
  const sessionManager = name.endsWith('/sessions/SessionManager.ts')
  const edges: Array<{ target: string; line: number }> = []; graph.set(file, edges)
  const report = (node: Node, rule: string, detail: string) => violations.push({ file: name, line: node.loc?.start.line ?? 0, rule, detail })
  const member = (node: Node | undefined) => node && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    ? node.property.type === 'Identifier' && !node.computed ? node.property.name : node.property.type === 'StringLiteral' ? node.property.value : undefined : undefined
  function visit(node: Node) {
    const module = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' ? node.source
      : node.type === 'ImportExpression' ? node.source : node.type === 'TSImportType' ? node.argument
      : node.type === 'CallExpression' && (node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require')) ? node.arguments[0] : undefined
    if (module?.type === 'StringLiteral') {
      const specifier = module.value, target = resolveModule(file, specifier)
      if (target) {
        edges.push({ target, line: node.loc?.start.line ?? 0 })
        if (!parsedFiles.has(target)) { parsedFiles.add(target); files.push(target) }
      }
      if (runtime && !target && specifier.startsWith('.') && !/\.json$/.test(specifier)) report(node, 'runtime-resolved-dependencies', specifier)
      if (kernelOrHost && (/(?:\/|^)(sessions|tasks|decisions|agent|runtime-adapters|handlers|transport|bootstrap)(?:\/|$)|pi-agent/.test(specifier) || (target && forbiddenProduct(target)))) report(node, 'runtime-no-product-import', specifier)
      if (!runtime && target && internal(target) && !pathName(target).endsWith('/durable-runtime/index.ts')) report(node, 'public-api-only', specifier)
      if (kernelOrHost && /@phaneris\/core(?:\/types)?$/.test(specifier)) report(node, 'kernel-no-client-type', specifier)
      if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration') && node.specifiers) for (const element of node.specifiers) {
        const original = element.type === 'ImportSpecifier' ? element.imported : element.type === 'ExportSpecifier' ? element.local : undefined
        if ((!runtime || (runtime && name.endsWith('/durable-runtime/index.ts'))) && original?.type === 'Identifier' && privateObjects.has(original.name)) report(element, 'no-private-object-export', original.name)
      }
      if (runtime && name.endsWith('/durable-runtime/index.ts') && node.type === 'ExportAllDeclaration') report(node, 'explicit-public-exports', specifier)
    } else if (kernelOrHost && (node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee.type === 'Import'))) report(node, 'runtime-static-dependencies', 'Non-literal dynamic import cannot be audited')
    if (kernelOrHost && node.type === 'Identifier' && ['ManagedSession', 'SessionManager', 'PiAgent', 'TaskRunner'].includes(node.name)) report(node, 'runtime-no-product-object', node.name)
    if (!runtime && node.type === 'CallExpression' && member(node.callee) === 'storeFor') report(node, 'no-store-capability', code.slice(node.callee.start!, node.callee.end!))
    if (sessionManager && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && ['chat', 'redirect', 'redirectConfirmed', 'forceAbort', 'interruptForHandoff', 'disposeForRestart'].includes(member(node.callee) ?? '')) report(node, 'host-owns-execution', code.slice(node.callee.start!, node.callee.end!))
    if (sessionManager && node.type === 'AssignmentExpression' && owned.has(member(node.left) ?? '')) report(node, 'host-owns-state', code.slice(node.left.start!, node.left.end!))
    if (sessionManager && (node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete')) && owned.has(member(node.argument) ?? '')) report(node, 'host-owns-state', code.slice(node.argument.start!, node.argument.end!))
    if (sessionManager && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(member(node.callee) ?? '')
      && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression') && member(node.callee.object) === 'messageQueue') report(node, 'host-owns-queue', code.slice(node.callee.start!, node.callee.end!))
    if (sessionManager && node.type === 'TSInterfaceDeclaration' && node.id.name === 'ManagedSession') for (const field of node.body.body) {
      if (field.type === 'TSPropertySignature' && field.key.type === 'Identifier' && owned.has(field.key.name)) report(field, 'no-second-run-state', field.key.name)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') visit(child) }
      else if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') visit(value as Node)
    }
  }
  visit(source)
}
const closures: Record<string, string[]> = {}
for (const file of files.filter(internal)) {
  const seen = new Set<string>()
  const visit = (current: string, chain: string[]) => {
    if (seen.has(current)) return
    seen.add(current)
    for (const edge of graph.get(current) ?? []) {
      if (forbiddenProduct(edge.target)) violations.push({ file: pathName(file), line: edge.line, rule: 'runtime-transitive-product-dependency', detail: [...chain, pathName(current), pathName(edge.target)].join(' -> ') })
      else visit(edge.target, [...chain, pathName(current)])
    }
  }
  visit(file, []); closures[pathName(file)] = [...seen].map(pathName).sort()
}
const result = { schemaVersion: 2, mode: baseline ? 'baseline' : 'acceptance', generatedAt: new Date().toISOString(), scannedFiles: files.length, violationCount: violations.length, violations, runtimeModuleClosures: closures }
if (outputArg) { const output = resolve(root, outputArg); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n') }
console.log(JSON.stringify({ ...result, runtimeModuleClosures: undefined }, null, 2))
if (!baseline && violations.length) process.exitCode = 1
