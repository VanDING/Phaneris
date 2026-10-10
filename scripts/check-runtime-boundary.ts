#!/usr/bin/env bun
/**
 * Durable Runtime boundary rules.
 *
 * Resolution and traversal live in `./lib/import-graph.ts`, shared with
 * `./check-architecture.ts`; this file owns only the runtime-boundary rules.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { memberName, pathNameFor, scanImportGraph } from './lib/import-graph'

const root = resolve(process.argv.find(arg => arg.startsWith('--repository='))?.slice(13) ?? resolve(import.meta.dir, '..'))
const baseline = process.argv.includes('--baseline')
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const pathName = pathNameFor(root)

const internal = (file: string) => pathName(file).includes('/server-core/src/durable-runtime/')
const forbiddenProduct = (file: string) => /\/(sessions|tasks|decisions|agent|runtime-adapters|handlers|transport|bootstrap)\//.test(pathName(file)) || pathName(file).startsWith('apps/')
const privateObjects = new Set(['DurableRuntimeCoordinator', 'DurableRuntimeStore', 'DurableProjectionRunner'])
const owned = new Set(['agent', 'isProcessing', 'stopRequested', 'processingGeneration', 'activeDurableRunOperationId', 'messageQueue'])

// Per-module state, refreshed in onModuleStart so the per-node hooks stay cheap.
let runtime = false, kernelOrHost = false, sessionManager = false

const scan = scanImportGraph(root, {
  onModuleStart: (ctx) => {
    runtime = internal(ctx.file)
    kernelOrHost = runtime && !/\/api\//.test(ctx.name) && !ctx.name.endsWith('/index.ts')
    sessionManager = ctx.name.endsWith('/sessions/SessionManager.ts')
  },
  onImport: (ctx, node, specifier, target) => {
    const { name } = ctx
    if (runtime && !target && specifier.startsWith('.') && !/\.json$/.test(specifier)) ctx.report(node, 'runtime-resolved-dependencies', specifier)
    if (kernelOrHost && (/(?:\/|^)(sessions|tasks|decisions|agent|runtime-adapters|handlers|transport|bootstrap)(?:\/|$)|pi-agent/.test(specifier) || (target && forbiddenProduct(target)))) ctx.report(node, 'runtime-no-product-import', specifier)
    if (!runtime && target && internal(target) && !pathName(target).endsWith('/durable-runtime/index.ts')) ctx.report(node, 'public-api-only', specifier)
    if (kernelOrHost && /@phaneris\/core(?:\/types)?$/.test(specifier)) ctx.report(node, 'kernel-no-client-type', specifier)
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration') && node.specifiers) for (const element of node.specifiers) {
      const original = element.type === 'ImportSpecifier' ? element.imported : element.type === 'ExportSpecifier' ? element.local : undefined
      if ((!runtime || (runtime && name.endsWith('/durable-runtime/index.ts'))) && original?.type === 'Identifier' && privateObjects.has(original.name)) ctx.report(element, 'no-private-object-export', original.name)
    }
    if (runtime && name.endsWith('/durable-runtime/index.ts') && node.type === 'ExportAllDeclaration') ctx.report(node, 'explicit-public-exports', specifier)
  },
  onOpaqueImport: (ctx, node) => {
    if (kernelOrHost && (node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee.type === 'Import'))) ctx.report(node, 'runtime-static-dependencies', 'Non-literal dynamic import cannot be audited')
  },
  onNode: (ctx, node) => {
    const { code } = ctx
    if (kernelOrHost && node.type === 'Identifier' && ['ManagedSession', 'SessionManager', 'PiAgent', 'TaskRunner'].includes(node.name)) ctx.report(node, 'runtime-no-product-object', node.name)
    if (!runtime && node.type === 'CallExpression' && memberName(node.callee) === 'storeFor') ctx.report(node, 'no-store-capability', code.slice(node.callee.start!, node.callee.end!))
    if (sessionManager && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && ['chat', 'redirect', 'redirectConfirmed', 'forceAbort', 'interruptForHandoff', 'disposeForRestart'].includes(memberName(node.callee) ?? '')) ctx.report(node, 'host-owns-execution', code.slice(node.callee.start!, node.callee.end!))
    if (sessionManager && node.type === 'AssignmentExpression' && owned.has(memberName(node.left) ?? '')) ctx.report(node, 'host-owns-state', code.slice(node.left.start!, node.left.end!))
    if (sessionManager && (node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete')) && owned.has(memberName(node.argument) ?? '')) ctx.report(node, 'host-owns-state', code.slice(node.argument.start!, node.argument.end!))
    if (sessionManager && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(memberName(node.callee) ?? '')
      && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression') && memberName(node.callee.object) === 'messageQueue') ctx.report(node, 'host-owns-queue', code.slice(node.callee.start!, node.callee.end!))
    if (sessionManager && node.type === 'TSInterfaceDeclaration' && node.id.name === 'ManagedSession') for (const field of node.body.body) {
      if (field.type === 'TSPropertySignature' && field.key.type === 'Identifier' && owned.has(field.key.name)) ctx.report(field, 'no-second-run-state', field.key.name)
    }
  },
})

const { files, graph, violations } = scan
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
