#!/usr/bin/env bun
/**
 * Architecture gate.
 *
 * Rules that no single package can enforce about the repository as a whole,
 * evaluated over the resolved import graph in `./lib/import-graph.ts`:
 *
 *   1. `webui-unshimmed-node`     — the modules `apps/webui` actually bundles must
 *      not reach a Node builtin or Electron-only package that its Vite config does
 *      not explicitly shim. WebUI compiles the Electron renderer's source
 *      (`apps/webui/tsconfig.json` includes it), so a new `node:*` import there
 *      resolves silently today and breaks the browser build much later.
 *   2. `undeclared-subpath-import` — a cross-package import must go through the
 *      exported surface the target package declares. Undeclared subpaths work only
 *      because Bun hoists and tsconfig aliases paper over them, so `package.json`
 *      stops describing the real runtime graph and an upstream upgrade's blast
 *      radius cannot be assessed.
 *
 * Both rules report against a checked-in baseline, the way `audit:dependencies`
 * does: green on today's known set, failing on anything new. Pay an entry down by
 * declaring the export or shimming the module; never add an entry to make a build
 * pass.
 *
 * Every rule reports how many items it inspected, and a rule that inspected
 * nothing fails — a typo in a path or a directory that stops being walked must
 * not read as "no violations".
 *
 * Usage:
 *   bun run scripts/check-architecture.ts
 *   bun run scripts/check-architecture.ts --update
 *   bun run scripts/check-architecture.ts --output=<path>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { packageNameOf, scanImportGraph, type ResolutionAlias } from './lib/import-graph'

const root = resolve(process.argv.find(arg => arg.startsWith('--repository='))?.slice(13) ?? resolve(import.meta.dir, '..'))
const update = process.argv.includes('--update')
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const pathName = (file: string) => relative(root, file).replaceAll('\\', '/')

const BASELINE = join(import.meta.dir, 'architecture-baseline.json')
const WEBUI_ENTRY = join(root, 'apps/webui/src/main.tsx')
const WEBUI_TSCONFIG = join(root, 'apps/webui/tsconfig.json')
const WEBUI_VITE_CONFIG = join(root, 'apps/webui/vite.config.ts')

const RULES = ['webui-unshimmed-node', 'undeclared-subpath-import'] as const
type Rule = typeof RULES[number]

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])
/** Browser-hostile packages WebUI must shim rather than bundle (subpaths included). */
const ELECTRON_ONLY = ['electron', 'electron-log', '@sentry/electron', 'open', 'ws', 'original-fs']
const isElectronOnly = (specifier: string) => ELECTRON_ONLY.some(name => specifier === name || specifier.startsWith(`${name}/`))

const failures: string[] = []
const inspected: Record<Rule, number> = { 'webui-unshimmed-node': 0, 'undeclared-subpath-import': 0 }
const fail = (message: string) => { failures.push(message) }

/**
 * The specifiers WebUI shims, read from its own Vite config so the gate follows
 * the build rather than a copy of it. Two shapes exist there: explicit
 * `'spec': resolve(..., 'src/shims/...')` entries, and one array of Node
 * builtins all mapped to the same `node-builtins` shim.
 */
function readWebuiShims(): Set<string> {
  const config = readFileSync(WEBUI_VITE_CONFIG, 'utf8')
  const shims = new Set<string>()
  for (const match of config.matchAll(/'([^']+)':\s*resolve\([^)]*src\/shims\//g)) shims.add(match[1]!)
  const array = config.match(/Object\.fromEntries\(\[([\s\S]*?)\]/)
  if (array) for (const match of array[1]!.matchAll(/'([^']+)'/g)) shims.add(match[1]!)
  // Canaries: a restructured Vite config must be loud, not a silent pass.
  const missing = ['fs', 'node:fs', 'ws', 'open', 'electron-log', '@sentry/electron'].filter(name => !shims.has(name))
  if (missing.length) fail(`webui shim list could not be read from vite.config.ts (missing: ${missing.join(', ')}); update this checker with the config`)
  return shims
}

/** Aliases WebUI's build actually uses, read from its tsconfig `paths`. */
function readWebuiAliases(): ResolutionAlias[] {
  const raw = readFileSync(WEBUI_TSCONFIG, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1')
  let paths: Record<string, string[]>
  try {
    paths = (JSON.parse(raw) as { compilerOptions?: { paths?: Record<string, string[]> } }).compilerOptions?.paths ?? {}
  } catch (error) {
    fail(`could not parse apps/webui/tsconfig.json paths: ${(error as Error).message}`)
    return []
  }
  return Object.entries(paths)
    .filter(([key, value]) => key !== '*' && key.length > 1 && key.endsWith('*') && typeof value?.[0] === 'string')
    .map(([key, value]) => ({ prefix: key.slice(0, -1), directory: resolve(dirname(WEBUI_TSCONFIG), value[0]!.replace(/\*$/, '')) }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
}

interface WorkspacePackage { directory: string; exports: Record<string, string> }

function readWorkspacePackages(): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>()
  for (const parent of ['packages', 'apps']) {
    let entries: string[]
    try { entries = readdirSync(join(root, parent)) } catch { continue }
    for (const name of entries) {
      const directory = join(root, parent, name), metadata = join(directory, 'package.json')
      if (!existsSync(metadata)) continue
      const pkg = JSON.parse(readFileSync(metadata, 'utf8')) as { name?: string; exports?: Record<string, string>; main?: string }
      if (!pkg.name) continue
      packages.set(pkg.name, { directory, exports: pkg.exports ?? (pkg.main ? { '.': pkg.main } : {}) })
    }
  }
  return packages
}

const webuiShims = readWebuiShims()
const webuiAliases = readWebuiAliases()
const workspacePackages = readWorkspacePackages()

/** Every literal specifier a module references, with the form that referenced it. */
const importsByFile = new Map<string, Array<{ specifier: string; dynamic: boolean }>>()
const findings: Record<Rule, Map<string, string>> = {
  'webui-unshimmed-node': new Map(),
  'undeclared-subpath-import': new Map(),
}
/**
 * Rule 1 findings are keyed per module, not per specifier: baselining
 * `node:readline` because `pi-agent.ts` imports it must not also bless a new
 * module pulling the same builtin into the browser bundle.
 */
const unshimmedSites = new Map<string, Map<string, boolean>>()

const scan = scanImportGraph(root, {
  onImport: (ctx, node, specifier, _target) => {
    const dynamic = node.type === 'ImportExpression'
      || (node.type === 'CallExpression' && node.callee.type === 'Import')
      || (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require')
    if (!importsByFile.has(ctx.file)) importsByFile.set(ctx.file, [])
    importsByFile.get(ctx.file)!.push({ specifier, dynamic })

    // Rule 2 — cross-package subpath imports must be declared by the target package.
    // A consumer's tsconfig alias is a build workaround, not a declaration, so it
    // never excuses the import; only real workspace package names are considered,
    // which is why `@/`, `@webui/` and `@config/` fall through untouched.
    if (specifier.startsWith('.')) return
    const name = packageNameOf(specifier)
    const pkg = workspacePackages.get(name)
    if (!pkg || specifier === name) return
    inspected['undeclared-subpath-import'] += 1
    const key = `.${specifier.slice(name.length)}`
    const declared = Object.keys(pkg.exports).some(pattern => {
      if (!pattern.includes('*')) return pattern === key
      const [prefix, suffix] = pattern.split('*')
      return key.startsWith(prefix!) && key.endsWith(suffix ?? '')
    })
    if (!declared) findings['undeclared-subpath-import'].set(specifier, ctx.name)
  },
}, { aliases: webuiAliases })

// The set of modules WebUI actually bundles, walked over resolved edges.
const webuiReachable = new Set<string>()
if (!existsSync(WEBUI_ENTRY)) fail(`webui entry not found: ${pathName(WEBUI_ENTRY)}`)
else {
  const queue = [WEBUI_ENTRY]
  while (queue.length) {
    const file = queue.pop()!
    if (webuiReachable.has(file)) continue
    webuiReachable.add(file)
    for (const edge of scan.graph.get(file) ?? []) queue.push(edge.target)
  }
}

// Rule 1 — no unshimmed Node/Electron-only specifier inside that closure.
for (const file of webuiReachable) for (const { specifier, dynamic } of importsByFile.get(file) ?? []) {
  const bare = specifier.startsWith('node:') ? specifier : specifier.split('/')[0]!
  if (!NODE_BUILTINS.has(specifier) && !NODE_BUILTINS.has(bare) && !isElectronOnly(specifier)) continue
  inspected['webui-unshimmed-node'] += 1
  if (webuiShims.has(specifier)) continue
  if (!unshimmedSites.has(specifier)) unshimmedSites.set(specifier, new Map())
  const sites = unshimmedSites.get(specifier)!
  // A site that appears both ways is recorded as static: the stricter form wins.
  const previous = sites.get(pathName(file))
  sites.set(pathName(file), previous === undefined ? dynamic : previous && dynamic)
}

// Zero-scan guard: a rule that inspected nothing is a broken rule, not a pass.
if (webuiReachable.size <= 1) fail(`webui-unshimmed-node inspected ${webuiReachable.size} module(s); the entry did not resolve to a real closure`)
if (inspected['undeclared-subpath-import'] === 0) fail('undeclared-subpath-import inspected 0 cross-package specifiers; the import graph is empty')
if (inspected['webui-unshimmed-node'] === 0) fail('webui-unshimmed-node inspected 0 node/electron specifiers; the closure or the builtin list is wrong')

const baseline: { $comment?: string; generatedAt?: string; allowed?: Partial<Record<Rule, Record<string, string>>> } = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : {}
const allowed = baseline.allowed ?? {}
const current: Record<Rule, Record<string, string>> = {
  'webui-unshimmed-node': Object.fromEntries([...unshimmedSites].flatMap(([specifier, sites]) =>
    [...sites].sort().map(([file, dynamic]) => [`${specifier} :: ${file}`, dynamic ? 'dynamic import' : 'static import']))),
  'undeclared-subpath-import': Object.fromEntries([...findings['undeclared-subpath-import']].sort()),
}

if (update) {
  writeFileSync(BASELINE, JSON.stringify({
    $comment: 'Known architecture-gate findings. Pay an entry down by declaring the export in the target package or shimming the module in apps/webui/vite.config.ts; never add one to make a build pass.',
    generatedAt: new Date().toISOString(),
    allowed: current,
  }, null, 2) + '\n')
  console.log(`Architecture baseline updated: ${RULES.map(rule => `${rule}=${Object.keys(current[rule]).length}`).join(', ')} -> ${pathName(BASELINE)}`)
} else {
  for (const rule of RULES) {
    for (const [key, where] of Object.entries(current[rule])) {
      if (key in (allowed[rule] ?? {})) continue
      const remedy = rule === 'webui-unshimmed-node'
        ? `shim it in apps/webui/vite.config.ts, or avoid the import in code WebUI bundles`
        : `declare it in the target package's exports`
      fail(`${rule}: "${key}" is new (${where}); ${remedy}, or record the decision with --update`)
    }
    const shrunk = Object.keys(allowed[rule] ?? {}).filter(key => !(key in current[rule]))
    if (shrunk.length) console.log(`${rule}: baseline can shrink by ${shrunk.length} (${shrunk.join(', ')})`)
  }
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scannedFiles: scan.scannedFiles,
  webuiClosureSize: webuiReachable.size,
  webuiShimCount: webuiShims.size,
  inspected,
  baselineSize: Object.fromEntries(RULES.map(rule => [rule, Object.keys(allowed[rule] ?? {}).length])),
  currentSize: Object.fromEntries(RULES.map(rule => [rule, Object.keys(current[rule]).length])),
  failures,
}
if (outputArg) { const output = resolve(root, outputArg); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n') }
console.log(JSON.stringify(result, null, 2))
if (failures.length) process.exitCode = 1
