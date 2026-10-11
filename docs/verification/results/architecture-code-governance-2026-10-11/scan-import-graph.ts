#!/usr/bin/env bun
/** Read-only AST census using the same resolver as the repository's gates. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
const root = resolve(process.argv.find(a => a.startsWith('--root='))?.slice(7) ?? '.')
const output = resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? '.cache/governance-2026-10-11/import-graph.json')
const { scanImportGraph, packageNameOf } = await import(resolve(root, 'scripts/lib/import-graph.ts'))
const owner = (file: string) => relative(root, file).replaceAll('\\', '/').match(/^(?:apps|packages)\/[^/]+/)?.[0]
const nameOf = (file: string) => relative(root, file).replaceAll('\\', '/')
const members = new Map<string, any>()
const externalImports = new Map<string, Set<string>>()
const imports: any[] = [], functions: any[] = [], classes: any[] = [], opaque: any[] = []
const nodeCounts = new Map<string, Record<string, number>>()
const config = JSON.parse(readFileSync(resolve(root, 'apps/webui/tsconfig.json'), 'utf8'))
const aliases = Object.entries(config.compilerOptions.paths)
  .filter(([k, v]) => k !== '*' && k.endsWith('*') && typeof (v as any)[0] === 'string' && !k.startsWith('@phaneris/'))
  .map(([k, v]) => ({ prefix: k.slice(0, -1), directory: resolve(root, 'apps/webui', (v as any)[0].replace(/\*$/, '')) }))
const scan = scanImportGraph(root, {
  onModuleStart(ctx: any) {
    const pkgDir = owner(ctx.file)
    if (pkgDir && !members.has(pkgDir)) members.set(pkgDir, JSON.parse(readFileSync(resolve(root, pkgDir, 'package.json'), 'utf8')))
    nodeCounts.set(ctx.name, { anyKeywords: 0, asAny: 0, exportDeclarations: 0 })
  },
  onImport(ctx: any, node: any, specifier: string, target: string | undefined) {
    const typeOnly = node.importKind === 'type' || node.exportKind === 'type'
      || (node.type === 'ImportDeclaration' && node.specifiers.length > 0 && node.specifiers.every((s: any) => s.importKind === 'type'))
      || node.type === 'TSImportType'
    imports.push({ file: ctx.name, line: node.loc?.start.line, specifier, target: target ? nameOf(target) : undefined, typeOnly })
    const pkgDir = owner(ctx.file)
    if (pkgDir && !target && !specifier.startsWith('.') && !specifier.startsWith('@/') && !specifier.startsWith('@webui/') && !specifier.startsWith('@config/')) {
      if (!externalImports.has(pkgDir)) externalImports.set(pkgDir, new Set())
      externalImports.get(pkgDir)!.add(packageNameOf(specifier))
    }
  },
  onOpaqueImport(ctx: any, node: any) { opaque.push({ file: ctx.name, line: node.loc?.start.line }) },
  onNode(ctx: any, node: any) {
    const counts = nodeCounts.get(ctx.name)!
    if (node.type === 'TSAnyKeyword') counts.anyKeywords++
    if (node.type === 'TSAsExpression' && node.typeAnnotation?.type === 'TSAnyKeyword') counts.asAny++
    if (['ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration'].includes(node.type)) counts.exportDeclarations++
    if (['FunctionDeclaration', 'ClassMethod', 'ClassPrivateMethod', 'ArrowFunctionExpression', 'FunctionExpression', 'ObjectMethod'].includes(node.type) && node.body && node.loc) {
      functions.push({ file: ctx.name, line: node.loc.start.line, name: node.id?.name ?? node.key?.name ?? '<anonymous>', kind: node.type, lines: node.loc.end.line - node.loc.start.line + 1 })
    }
    if (node.type === 'ClassDeclaration') classes.push({ file: ctx.name, line: node.loc?.start.line, name: node.id?.name, methods: node.body.body.filter((n: any) => /Method$/.test(n.type)).length, fields: node.body.body.filter((n: any) => /Property$/.test(n.type)).length })
  },
}, { aliases })
function components(nodes: string[], adjacency: Map<string, Set<string>>) {
  let next = 0
  const ids = new Map<string, number>(), lows = new Map<string, number>(), stack: string[] = [], inStack = new Set<string>(), result: string[][] = []
  const visit = (v: string) => {
    ids.set(v, next); lows.set(v, next++); stack.push(v); inStack.add(v)
    for (const w of adjacency.get(v) ?? []) {
      if (!ids.has(w)) { visit(w); lows.set(v, Math.min(lows.get(v)!, lows.get(w)!)) }
      else if (inStack.has(w)) lows.set(v, Math.min(lows.get(v)!, ids.get(w)!))
    }
    if (lows.get(v) === ids.get(v)) {
      const part: string[] = []; let w: string
      do { w = stack.pop()!; inStack.delete(w); part.push(w) } while (w !== v)
      if (part.length > 1) result.push(part.sort())
    }
  }
  for (const node of nodes) if (!ids.has(node)) visit(node)
  return result.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!))
}
const fileGraph = new Map<string, Set<string>>(), runtimeFileGraph = new Map<string, Set<string>>(), packageGraph = new Map<string, Set<string>>()
const packageEdges = new Map<string, any>()
for (const item of imports) if (item.target) {
  if (!fileGraph.has(item.file)) fileGraph.set(item.file, new Set())
  fileGraph.get(item.file)!.add(item.target)
  if (!item.typeOnly) { if (!runtimeFileGraph.has(item.file)) runtimeFileGraph.set(item.file, new Set()); runtimeFileGraph.get(item.file)!.add(item.target) }
  const from = item.file.match(/^(?:apps|packages)\/[^/]+/)?.[0], to = item.target.match(/^(?:apps|packages)\/[^/]+/)?.[0]
  if (from && to && from !== to) {
    const key = `${from} -> ${to}`
    if (!packageEdges.has(key)) packageEdges.set(key, { from, to, totalSites: 0, valueSites: 0, sample: [] })
    const edge = packageEdges.get(key); edge.totalSites++; if (!item.typeOnly) edge.valueSites++
    if (edge.sample.length < 5) edge.sample.push({ file: item.file, line: item.line, specifier: item.specifier, typeOnly: item.typeOnly })
    if (!packageGraph.has(from)) packageGraph.set(from, new Set()); packageGraph.get(from)!.add(to)
  }
}
const incoming = new Map<string, Set<string>>()
for (const [from, targets] of fileGraph) for (const to of targets) { if (!incoming.has(to)) incoming.set(to, new Set()); incoming.get(to)!.add(from) }
const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const rootDependencies = new Set([...Object.keys(rootPkg.dependencies ?? {}), ...Object.keys(rootPkg.devDependencies ?? {}), ...Object.keys(rootPkg.optionalDependencies ?? {})])
const rootOnlyImportCandidates: any[] = []
for (const [pkgDir, names] of externalImports) {
  const pkg = members.get(pkgDir)
  const declared = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(k => Object.keys(pkg[k] ?? {})))
  for (const name of names) if (!declared.has(name) && rootDependencies.has(name)) rootOnlyImportCandidates.push({ package: pkgDir, dependency: name })
}
const report = {
  schemaVersion: 1,
  baseHead: Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe' }).stdout.toString().trim(),
  scope: 'Existing gate resolver; apps/*/src + packages/*/src, literal imports/exports/require plus recursively resolved targets; tests/fixtures excluded by that resolver.',
  limitations: ['Type-only imports are excluded from the value graph; TS compiler may also erase value imports used only as types.', 'Cycle candidates include barrel re-exports; they require manual triage.', 'Browser aliases follow the architecture gate; per-app aliases and conditional exports are not fully modeled.', 'Root-only import candidates are ownership evidence, not proof that a package fails to build.', 'No dead-code claim is made from a module having zero incoming edges.'],
  scannedModules: scan.scannedFiles,
  literalImportSites: imports.length,
  resolvedLocalImportSites: imports.filter(i => i.target).length,
  opaqueImportSites: opaque,
  packageEdges: [...packageEdges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  packageCycleCandidates: components([...members.keys()], packageGraph),
  fileCycleCandidates: components(scan.files.map(nameOf), fileGraph),
  valueFileCycleCandidates: components(scan.files.map(nameOf), runtimeFileGraph),
  mostImportedModules: [...incoming].map(([file, from]) => ({ file, incomingModules: from.size })).sort((a, b) => b.incomingModules - a.incomingModules).slice(0, 40),
  largestFunctions: functions.sort((a, b) => b.lines - a.lines).slice(0, 50),
  largestClasses: classes.sort((a, b) => b.methods - a.methods).slice(0, 20),
  typingTotals: [...nodeCounts.values()].reduce((a, n) => ({ anyKeywords: a.anyKeywords + n.anyKeywords, asAny: a.asAny + n.asAny, exportDeclarations: a.exportDeclarations + n.exportDeclarations }), { anyKeywords: 0, asAny: 0, exportDeclarations: 0 }),
  typingHotspots: [...nodeCounts].map(([file, counts]) => ({ file, ...counts })).filter(n => n.anyKeywords > 0).sort((a, b) => b.anyKeywords - a.anyKeywords).slice(0, 30),
  rootOnlyImportCandidates: rootOnlyImportCandidates.sort((a, b) => a.package.localeCompare(b.package) || a.dependency.localeCompare(b.dependency)),
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ modules: report.scannedModules, imports: imports.length, resolved: report.resolvedLocalImportSites, packageEdges: report.packageEdges.length, packageCycles: report.packageCycleCandidates, fileCycleCandidates: report.fileCycleCandidates.length, valueCycleCandidates: report.valueFileCycleCandidates.length, typing: report.typingTotals, rootOnlyImportCandidates: rootOnlyImportCandidates.length }))
