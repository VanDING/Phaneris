#!/usr/bin/env bun
/**
 * Resolved import graph shared by the architecture gates.
 *
 * The graph is built from the repository root: every `packages/<name>/src` and
 * `apps/<name>/src` tree is walked, then each module's literal module references
 * (static import/export, `import type`, dynamic `import()`, `require()`) are
 * resolved and appended to the same worklist. Traversal is depth-first and
 * interleaved — a module's newly resolved targets are queued while that module
 * is still being visited — because the gates' violation ordering depends on it.
 *
 * `scripts/check-runtime-boundary.ts` and `scripts/check-architecture.ts` share
 * this module so both judge the same graph. Changing resolution here changes
 * both gates at once; that is the point.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parse } from '@babel/parser'
import type { Node } from '@babel/types'

export interface ImportEdge { target: string; line: number }

export interface Violation { file: string; line: number; rule: string; detail: string }

export interface WorkspacePackage {
  name: string
  directory: string
  /** Declared `exports` map, falling back to `{ '.': main }` exactly as published. */
  exports: Record<string, string>
}

/** A specifier prefix (including its trailing slash) and the directory it resolves against. */
export interface ResolutionAlias { prefix: string; directory: string }

export interface ScanContext {
  readonly file: string
  /** Repository-relative path with forward slashes. */
  readonly name: string
  readonly code: string
  readonly graph: Map<string, ImportEdge[]>
  readonly packages: Map<string, WorkspacePackage>
  readonly pathName: (file: string) => string
  readonly resolveModule: (file: string, specifier: string) => string | undefined
  report(node: Node, rule: string, detail: string): void
}

export interface ScanHooks {
  /** Called once per module, before any node of it is visited. */
  onModuleStart?(ctx: ScanContext): void
  /** A literal module reference: static import/export, `import type`, dynamic `import()`, `require()`. */
  onImport?(ctx: ScanContext, node: Node, specifier: string, target: string | undefined): void
  /** A dynamic import whose specifier is not a string literal, so it cannot be resolved. */
  onOpaqueImport?(ctx: ScanContext, node: Node): void
  /** Every node, visited after the import branch — preserving violation order within a module. */
  onNode?(ctx: ScanContext, node: Node): void
}

export interface ScanOptions {
  /**
   * Extra specifier aliases, applied before package resolution. Callers that
   * pass none keep the historical `@/` behaviour exactly, so adding an alias
   * for one gate cannot move another gate's graph.
   */
  aliases?: ResolutionAlias[]
}

export interface ScanResult {
  root: string
  /** Every visited module, in discovery order (starts with the walked roots). */
  files: string[]
  graph: Map<string, ImportEdge[]>
  violations: Violation[]
  scannedFiles: number
}

/** Extract the specifier of any module-reference node, if it is a string literal. */
export function moduleSpecifier(node: Node): string | undefined {
  const source = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' ? node.source
    : node.type === 'ImportExpression' ? node.source
    : node.type === 'TSImportType' ? node.argument
    : node.type === 'CallExpression' && (node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require')) ? node.arguments[0]
    : undefined
  return source?.type === 'StringLiteral' ? source.value : undefined
}

/** True for a dynamic import / `require()` node, whether or not it is resolvable. */
export function isModuleRequest(node: Node): boolean {
  return node.type === 'ImportExpression'
    || (node.type === 'CallExpression' && (node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require')))
}

/** The workspace package a specifier belongs to, if any (`@scope/name` or `name`). */
export function packageNameOf(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

/** Repository-relative, forward-slash path helper bound to a root. */
export function pathNameFor(root: string): (file: string) => string {
  return (file) => relative(root, file).replaceAll('\\', '/')
}

const SKIP_DIRECTORIES = ['__tests__', 'node_modules', 'dist', 'fixtures']

export function scanImportGraph(root: string, hooks: ScanHooks = {}, options: ScanOptions = {}): ScanResult {
  const files: string[] = []
  const violations: Violation[] = []
  const graph = new Map<string, ImportEdge[]>()
  const pathName = pathNameFor(root)
  const aliases = options.aliases ?? []

  function walk(directory: string) {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { if (!SKIP_DIRECTORIES.includes(entry.name)) walk(path) }
      else if (/\.(?:[cm]?js|jsx|tsx?)$/.test(entry.name) && !/\.(test|isolated)\.[cm]?[jt]sx?$|fixture\.[jt]s$/.test(entry.name)) files.push(path)
    }
  }

  const packages = new Map<string, WorkspacePackage>()
  for (const parent of ['packages', 'apps']) for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(root, parent, entry.name), metadata = join(directory, 'package.json')
    if (existsSync(metadata)) { const pkg = JSON.parse(readFileSync(metadata, 'utf8')); packages.set(pkg.name, { name: pkg.name, directory, exports: pkg.exports ?? { '.': pkg.main } }) }
    walk(join(directory, 'src'))
  }

  function sourceFile(path: string): string | undefined {
    for (const candidate of [path, path.replace(/\.js$/, '.ts'), path.replace(/\.js$/, '.tsx'), `${path}.ts`, `${path}.tsx`, `${path}.js`, join(path, 'index.ts'), join(path, 'index.js')])
      if (existsSync(candidate) && /\.(?:[cm]?js|jsx|tsx?)$/.test(candidate)) return resolve(candidate)
  }

  function resolveModule(file: string, specifier: string): string | undefined {
    if (specifier.startsWith('.')) return sourceFile(resolve(dirname(file), specifier))
    for (const alias of aliases) if (specifier.startsWith(alias.prefix)) return sourceFile(join(alias.directory, specifier.slice(alias.prefix.length)))
    if (specifier.startsWith('@/')) {
      const match = pathName(file).match(/^(apps|packages)\/([^/]+)\/src\//)
      if (match) return sourceFile(join(root, match[1]!, match[2]!, 'src', ...(match[2] === 'electron' ? ['renderer'] : []), specifier.slice(2)))
    }
    const pkg = packages.get(packageNameOf(specifier))
    if (!pkg) return
    const key = specifier === pkg.name ? '.' : `.${specifier.slice(pkg.name.length)}`
    let target = pkg.exports[key]
    if (!target) for (const [pattern, value] of Object.entries(pkg.exports)) {
      const [prefix, suffix] = pattern.split('*')
      if (typeof value === 'string' && pattern.includes('*') && key.startsWith(prefix!) && key.endsWith(suffix!)) { target = value.replace('*', key.slice(prefix!.length, suffix ? -suffix.length : undefined)); break }
    }
    if (typeof target === 'string') return sourceFile(resolve(pkg.directory, target))
  }

  const parsedFiles = new Set(files)
  for (const file of files) {
    const name = pathName(file), code = readFileSync(file, 'utf8')
    const source = parse(code, { sourceType: 'unambiguous', plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? ['jsx' as const] : [])] })
    const ctx: ScanContext = {
      file, name, code, graph, packages, pathName, resolveModule,
      report: (node, rule, detail) => violations.push({ file: name, line: node.loc?.start.line ?? 0, rule, detail }),
    }
    const edges: ImportEdge[] = []; graph.set(file, edges)
    hooks.onModuleStart?.(ctx)

    function visit(node: Node) {
      const specifier = moduleSpecifier(node)
      if (specifier !== undefined) {
        const target = resolveModule(file, specifier)
        if (target) {
          edges.push({ target, line: node.loc?.start.line ?? 0 })
          if (!parsedFiles.has(target)) { parsedFiles.add(target); files.push(target) }
        }
        hooks.onImport?.(ctx, node, specifier, target)
      } else if (isModuleRequest(node)) {
        hooks.onOpaqueImport?.(ctx, node)
      }
      hooks.onNode?.(ctx, node)
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') visit(child) }
        else if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') visit(value as Node)
      }
    }
    visit(source)
  }

  return { root, files, graph, violations, scannedFiles: files.length }
}

/** Member name of a (possibly optional) member expression, for `x.foo` / `x['foo']`. */
export function memberName(node: Node | undefined): string | undefined {
  return node && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    ? node.property.type === 'Identifier' && !node.computed ? node.property.name : node.property.type === 'StringLiteral' ? node.property.value : undefined
    : undefined
}
