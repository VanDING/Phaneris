#!/usr/bin/env bun
/**
 * Mutation evidence for the theme-declaration invariant and the architecture gate.
 *
 * For each mutation: apply a reversible edit, run the gate, record whether the
 * gate reacted as required, then restore the file byte-for-byte. The run fails if
 * any mutation does not produce the required outcome, or if the working tree is
 * not identical before and after.
 *
 * A gate is only worth having if a deliberate violation makes it fail; a mutation
 * that expects the gate to stay green (CRLF handling, intra-package relative
 * imports) is evidence against over-broad rules.
 *
 * Usage:
 *   bun run scripts/verification/theme-architecture-gate-mutations.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const OUT = join(root, 'docs/verification/results/theme-architecture-gate')

interface Mutation {
  id: string
  rule: string
  /** What the violation is, in the failure matrix's terms. */
  failureMode: string
  file: string
  apply: (original: string) => string
  command: string[]
  expect: 'fail' | 'pass'
  /** Must appear in the gate output, so "it failed" cannot mean "it crashed randomly". */
  expectPattern: RegExp
}

const themeTest = ['bun', 'test', './src/config/__tests__/theme.test.ts']
const themeTestCwd = join(root, 'packages/shared')
const archGate = ['bun', 'run', 'scripts/check-architecture.ts']

const replaceOnce = (source: string, find: string, replacement: string) => {
  const index = source.indexOf(find)
  if (index === -1) throw new Error(`mutation target not found: ${JSON.stringify(find.slice(0, 60))}`)
  return source.slice(0, index) + replacement + source.slice(index + find.length)
}

const DEFAULT_THEME_JSON = 'apps/electron/resources/themes/default.json'
const TYPOGRAPHY_CSS = 'packages/ui/src/styles/typography.css'
const ELECTRON_CSS = 'apps/electron/src/renderer/index.css'
const WEBUI_ENTRY = 'apps/webui/src/main.tsx'

const mutations: Mutation[] = [
  {
    id: 'FA01', rule: 'theme-resource-parity', failureMode: 'Only the canonical snapshot or only the bundled resource changes',
    file: DEFAULT_THEME_JSON,
    apply: source => replaceOnce(source, 'Inter Variable', 'Inter'),
    command: themeTest, expect: 'fail', expectPattern: /keeps the bundled default resource synchronized/,
  },
  {
    id: 'FA02', rule: 'theme-resource-parity', failureMode: 'The bundled resource is unreadable rather than merely divergent',
    file: DEFAULT_THEME_JSON,
    apply: () => 'not json at all\n',
    command: themeTest, expect: 'fail', expectPattern: /theme\.test\.ts/,
  },
  {
    id: 'FA03', rule: 'typography-single-source', failureMode: 'typography.css and DEFAULT_THEME drift apart',
    file: TYPOGRAPHY_CSS,
    apply: source => replaceOnce(source, '"Segoe UI Variable Text", "Inter Variable"', '"Segoe UI Variable Text"'),
    command: themeTest, expect: 'fail', expectPattern: /typography and material tokens synchronized/,
  },
  {
    id: 'FA05', rule: 'static-css-parity', failureMode: 'A non-font token drifts between DEFAULT_THEME and the static CSS',
    file: ELECTRON_CSS,
    apply: source => replaceOnce(source, '  --accent: oklch(0.488 0.275 280.3);', '  --accent: oklch(0.5 0.275 280.3);'),
    command: themeTest, expect: 'fail', expectPattern: /typography and material tokens synchronized/,
  },
  {
    id: 'FA06', rule: 'typography-single-source', failureMode: 'A font token is duplicated into an app stylesheet, creating a second static source',
    file: ELECTRON_CSS,
    apply: source => replaceOnce(source, ':root {\n', ':root {\n  --font-sans: red;\n'),
    command: themeTest, expect: 'fail', expectPattern: /typography and material tokens synchronized/,
  },
  {
    id: 'FA04', rule: 'typography-single-source', failureMode: 'Reformatting whitespace only must not be treated as drift',
    file: TYPOGRAPHY_CSS,
    apply: source => replaceOnce(source, '--font-sans: -apple-system, BlinkMacSystemFont,', '--font-sans:   -apple-system,    BlinkMacSystemFont,'),
    command: themeTest, expect: 'pass', expectPattern: /0 fail/,
  },
  {
    id: 'FA08a', rule: 'data-font-overrides', failureMode: 'The inter override stops routing Han through the bundled face',
    file: ELECTRON_CSS,
    apply: source => replaceOnce(
      source,
      'html[data-font="inter"] {\n  --font-sans: "Inter Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, var(--font-cjk), sans-serif;',
      'html[data-font="inter"] {\n  --font-sans: "Inter Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    ),
    command: themeTest, expect: 'fail', expectPattern: /typography and material tokens synchronized/,
  },
  {
    id: 'FA08b', rule: 'data-font-overrides', failureMode: 'The system override stops being native-only and gains the bundled Han face',
    file: ELECTRON_CSS,
    apply: source => replaceOnce(source, '--font-sans: system-ui, -apple-system,', '--font-sans: var(--font-cjk), system-ui, -apple-system,'),
    command: themeTest, expect: 'fail', expectPattern: /typography and material tokens synchronized/,
  },
  {
    id: 'FA09', rule: 'theme-resource-parity', failureMode: 'A non-default built-in drifts from its canonical definition',
    file: 'apps/electron/resources/themes/geek.json',
    apply: source => replaceOnce(source, 'Cascadia Code', 'Cascadia Code Mutated'),
    command: themeTest, expect: 'fail', expectPattern: /bundles exactly the four canonical/,
  },
  {
    id: 'FA12', rule: 'crlf-tolerance', failureMode: 'A CRLF checkout must not break the CSS block parsing',
    file: ELECTRON_CSS,
    apply: source => source.replace(/\n/g, '\r\n'),
    command: themeTest, expect: 'pass', expectPattern: /0 fail/,
  },
  {
    id: 'FB01', rule: 'webui-unshimmed-node', failureMode: 'WebUI-reachable code gains a Node builtin import with no shim',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nimport 'node:readline';\n`,
    command: archGate, expect: 'fail', expectPattern: /webui-unshimmed-node.*node:readline/,
  },
  {
    id: 'FB02a', rule: 'webui-unshimmed-node', failureMode: 'The violation arrives as a dynamic import, not a static one',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nexport async function __probe() { return import('node:readline') }\n`,
    command: archGate, expect: 'fail', expectPattern: /webui-unshimmed-node.*node:readline/,
  },
  {
    id: 'FB02b', rule: 'webui-unshimmed-node', failureMode: 'The violation is only re-exported through a barrel',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nexport * from 'node:readline';\n`,
    command: archGate, expect: 'fail', expectPattern: /webui-unshimmed-node.*node:readline/,
  },
  {
    id: 'FB02c', rule: 'webui-unshimmed-node', failureMode: 'The violation is type-only, which a text search would miss',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nimport type { Interface as __Probe } from 'node:readline';\nexport type __ProbeAlias = __Probe;\n`,
    command: archGate, expect: 'fail', expectPattern: /webui-unshimmed-node.*node:readline/,
  },
  {
    id: 'FB03', rule: 'webui-unshimmed-node', failureMode: 'A shimmed builtin must not be reported (no over-broad rule)',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nimport { join as __join } from 'node:path';\nvoid __join;\n`,
    command: archGate, expect: 'pass', expectPattern: /"failures": \[\]/,
  },
  {
    id: 'FB05', rule: 'no-cross-package-deep-import', failureMode: 'Intra-package relative imports must not be reported',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nimport './responsive';\n`,
    command: archGate, expect: 'pass', expectPattern: /"failures": \[\]/,
  },
  {
    id: 'FB06', rule: 'no-cross-package-deep-import', failureMode: 'A package with no exports map is imported by subpath',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nimport '@phaneris/viewer/__probe__';\n`,
    command: archGate, expect: 'fail', expectPattern: /undeclared-subpath-import.*@phaneris\/viewer\/__probe__/,
  },
  {
    id: 'FB07', rule: 'no-cross-package-deep-import', failureMode: 'A new undeclared cross-package subpath import appears',
    file: WEBUI_ENTRY,
    apply: source => `${source}\nimport '@phaneris/shared/__probe__';\n`,
    command: archGate, expect: 'fail', expectPattern: /undeclared-subpath-import.*@phaneris\/shared\/__probe__/,
  },
  {
    id: 'FB08', rule: 'zero-scan-guard', failureMode: 'The rule inspects nothing and would otherwise report a vacuous pass',
    file: WEBUI_ENTRY,
    apply: () => '',
    command: archGate, expect: 'fail', expectPattern: /inspected 1 module/,
  },
]

const run = (command: string[], cwd: string) => {
  const proc = Bun.spawnSync({ cmd: command, cwd, stdout: 'pipe', stderr: 'pipe' })
  // Bun writes test results to stderr; capture both streams on success and on
  // failure, or a passing mutation looks like a silent gate.
  return { code: proc.exitCode ?? 1, output: `${proc.stdout.toString()}${proc.stderr.toString()}` }
}

const statusOf = () => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
const before = statusOf()

const results: Array<Record<string, unknown>> = []
let failed = false
for (const mutation of mutations) {
  const absolute = join(root, mutation.file)
  const original = readFileSync(absolute, 'utf8')
  let applied: string
  try {
    applied = mutation.apply(original)
  } catch (error) {
    results.push({ id: mutation.id, rule: mutation.rule, outcome: 'mutation-not-applicable', error: (error as Error).message })
    failed = true
    continue
  }
  if (applied === original) {
    results.push({ id: mutation.id, rule: mutation.rule, outcome: 'mutation-was-a-no-op' })
    failed = true
    continue
  }
  writeFileSync(absolute, applied)
  const { code, output } = run(mutation.command, mutation.command === themeTest ? themeTestCwd : root)
  writeFileSync(absolute, original)
  const reacted = mutation.expect === 'fail' ? code !== 0 : code === 0
  const matched = mutation.expectPattern.test(output)
  const restored = readFileSync(absolute, 'utf8') === original
  const outcome = reacted && matched && restored ? 'as-required' : 'WRONG'
  if (outcome === 'WRONG') failed = true
  results.push({
    id: mutation.id,
    rule: mutation.rule,
    failureMode: mutation.failureMode,
    file: mutation.file,
    expect: mutation.expect,
    gateExit: code,
    matchedExpectedMessage: matched,
    restoredByteForByte: restored,
    outcome,
    outputExcerpt: output.split('\n').filter(line => mutation.expectPattern.test(line)).slice(0, 2).join('\n').slice(0, 400),
  })
}

const after = statusOf()
const treeUnchanged = before === after
if (!treeUnchanged) failed = true

mkdirSync(OUT, { recursive: true })
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  command: 'bun run scripts/verification/theme-architecture-gate-mutations.ts',
  mutations: results.length,
  asRequired: results.filter(r => r.outcome === 'as-required').length,
  workingTreeUnchanged: treeUnchanged,
  results,
}
writeFileSync(join(OUT, 'gate-mutations.json'), JSON.stringify(report, null, 2) + '\n')
const notAsRequired = results.filter(r => r.outcome !== 'as-required')
console.log(JSON.stringify({
  mutations: report.mutations,
  asRequired: report.asRequired,
  workingTreeUnchanged: treeUnchanged,
  notAsRequired: notAsRequired.map(r => ({ id: r.id, outcome: r.outcome, error: r.error })),
}, null, 2))
if (failed) process.exitCode = 1
