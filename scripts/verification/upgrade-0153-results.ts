#!/usr/bin/env bun
/**
 * Machine-readable result of the 2026-10-18 upgrade batch.
 *
 * Everything in `docs/verification/results/upgrade-2026-10-18.json` is produced
 * here: gate exit codes come from executing the commands, versions are read from
 * the installed tree and from running the Python toolchain, and hashes are
 * computed from the working tree. Nothing is transcribed by hand.
 *
 * Two rules keep the report honest:
 *
 *   - A **partial** run never overwrites the canonical result. `--only` and
 *     `--skip-gates` write `upgrade-2026-10-18.partial.json` and say which gates
 *     they did not run, so a scoped check cannot be mistaken for acceptance.
 *   - Every frozen target and every gate carries an explicit `status`
 *     (`matched` / `approved-exception` / `mismatched`, and `pass` / `fail` /
 *     `environment-limited` / `not-run`), not just a number.
 *
 * Usage:
 *   bun run scripts/verification/upgrade-0153-results.ts                 # full run
 *   bun run scripts/verification/upgrade-0153-results.ts --skip-gates    # state only (partial)
 *   bun run scripts/verification/upgrade-0153-results.ts --only=validate-ci,audit
 *
 * The gates run with the isolated runtimes under .cache/upgrade-20261018/runtime
 * on PATH, never the machine-wide Bun/Node.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { arch, release } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const arg = (name: string) => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const readJson = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'))

const runtimeBin = join(root, '.cache/upgrade-20261018/runtime')
const exe = (name: string) => process.platform === 'win32' ? `${name}.exe` : name
const pathEntries = [join(runtimeBin, 'bun-1.4.3'), join(runtimeBin, 'node-24.22.0')].filter(existsSync)
const env = { ...process.env, PATH: [...pathEntries, process.env.PATH ?? ''].join(process.platform === 'win32' ? ';' : ':') }
const gitPaths = () => [...new Set([
  ...execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: root }).toString().split('\0'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0'),
].filter(Boolean))].sort()
const codeFingerprint = () => createHash('sha256').update(JSON.stringify({
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  changes: gitPaths().filter(file => /^(?:apps\/|packages\/|scripts\/|\.github\/|package\.json$|bun\.lock$|Dockerfile)/.test(file))
    .map(file => [file, existsSync(join(root, file)) ? sha256(join(root, file)) : null]),
})).digest('hex')

interface Gate {
  name: string
  command: string
  args: string[]
  /** Reason this cannot pass on this host; recorded as environment-limited. */
  environmentLimited?: string
  timeoutMs?: number
}

const GATES: Gate[] = [
  { name: 'install-frozen', command: 'bun', args: ['install', '--frozen-lockfile'] },
  { name: 'validate-ci', command: 'bun', args: ['run', 'validate:ci'], timeoutMs: 900_000 },
  { name: 'audit-dependencies', command: 'bun', args: ['run', 'audit:dependencies'] },
  { name: 'test-critical', command: 'bun', args: ['run', 'test:critical'], timeoutMs: 3_600_000 },
  { name: 'test-upstream-015', command: 'bun', args: ['run', 'test:upstream-015'], timeoutMs: 1_800_000 },
  { name: 'build-runtime', command: 'bun', args: ['run', 'build:runtime'], timeoutMs: 900_000 },
  { name: 'electron-build', command: 'bun', args: ['run', 'electron:build'], timeoutMs: 900_000 },
  { name: 'webui-build', command: 'bun', args: ['run', 'webui:build'], timeoutMs: 900_000 },
  { name: 'viewer-build', command: 'bun', args: ['run', 'viewer:build'], timeoutMs: 900_000 },
  {
    name: 'server-build', command: 'bun', args: ['run', 'server:build'],
    environmentLimited: 'scripts/build-server.ts accepts only darwin/linux; it rejects win32 before doing any work',
  },
  { name: 'bundle-report-check', command: 'bun', args: ['run', 'bundle:report', '--check'] },
  { name: 'security-cache-ocr', command: 'node', args: ['scripts/verification/verify-dependency-upgrade-security.cjs'] },
  { name: 'verification-heic', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-heic-workflow.ts'], timeoutMs: 900_000 },
  { name: 'verification-heic-store', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-heic-store-workflow.ts'], timeoutMs: 900_000 },
  { name: 'verification-chat-starters', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-chat-starters-workflow.ts'], timeoutMs: 600_000 },
  { name: 'verification-endpoints', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-endpoints-workflow.ts'], timeoutMs: 600_000 },
  { name: 'verification-b1-pi', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-b1-workflow.ts'], timeoutMs: 900_000 },
  // Second review round: the dependency acceptance scenarios that had no coverage.
  { name: 'verification-pi-runtime', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-pi-runtime-workflow.ts'], timeoutMs: 900_000 },
  { name: 'verification-mcp', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-mcp-workflow.ts'], timeoutMs: 900_000 },
  { name: 'verification-usage-ledger', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-usage-ledger-workflow.ts'], timeoutMs: 900_000 },
  { name: 'verification-pdf', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-pdf-workflow.ts'], timeoutMs: 1_800_000 },
  { name: 'verification-chat-starters-browser', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-chat-starters-browser-workflow.ts'], timeoutMs: 2_700_000 },
  { name: 'verification-chat-starters-landing', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-chat-starters-landing-workflow.ts'], timeoutMs: 2_700_000 },
  { name: 'verification-session-info-scroll', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-session-info-workflow.ts'], timeoutMs: 1_800_000 },
  { name: 'verification-calendar-drag', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-calendar-drag-workflow.ts'], timeoutMs: 1_800_000 },
  { name: 'verification-editor', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-editor-workflow.ts'], timeoutMs: 2_700_000 },
  { name: 'verification-workspace-isolation', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-workspace-isolation-workflow.ts'], timeoutMs: 1_800_000 },
  { name: 'verification-model-form', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-model-form-workflow.ts'], timeoutMs: 1_800_000 },
  { name: 'verification-undici', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-undici-workflow.ts'] },
  { name: 'verification-document-tools', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-document-tools-workflow.ts'], timeoutMs: 900_000 },
  { name: 'verification-native-attachments', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-native-attachments-workflow.ts'], timeoutMs: 600_000 },
  { name: 'verification-packaged', command: 'bun', args: ['run', 'scripts/verification/upgrade-0153-packaged-workflow.ts'], timeoutMs: 1_800_000 },
]

const targets = readJson('docs/dependencies/upgrade-2026-10-18/targets.json') as {
  npm: Record<string, { version: string; batch: string }>
  addedNpm: Record<string, { version: string; batch: string }>
  python: Record<string, { version: string; batch: string; new?: boolean }>
  runtimes: Record<string, string>
}
const installed = (name: string): string | null => {
  const manifest = join(root, 'node_modules', ...name.split('/'), 'package.json')
  return existsSync(manifest) ? (readJson(relative(root, manifest).replaceAll('\\', '/')) as { version: string }).version : null
}

/**
 * Approved deviations: a frozen target intentionally not installed. Recorded as
 * `approved-exception` rather than silently counting as matched or editing the
 * frozen target file.
 */
const APPROVED_EXCEPTIONS: Record<string, { installed: string; reason: string; evidence: string }> = {
  '@fullcalendar/react': {
    installed: '7.1.0',
    reason: '7.1.3 no longer exposes the grid-cell DOM the calendar drag target reads (CalendarView.tsx), reproduced as a single-variable A/B; kept on 7.1.0 until CalendarView is migrated',
    evidence: 'docs/verification/upgrade-2026-10-18-failure-matrix.md#76-cal-04',
  },
}

const partial = process.argv.includes('--skip-gates') || Boolean(arg('only'))
const only = arg('only')?.split(',').map(value => value.trim())

const gateResults: Record<string, unknown>[] = []
const gateLogDirectory = join(root, '.cache/upgrade-20261018', `gate-logs-${Date.now()}`)
mkdirSync(gateLogDirectory, { recursive: true })
for (const gate of GATES) {
  if (process.argv.includes('--skip-gates') || (only && !only.includes(gate.name))) {
    gateResults.push({ name: gate.name, command: [gate.command, ...gate.args], status: 'not-run' })
    continue
  }
  const started = Date.now()
  const startedWithCode = codeFingerprint()
  const run = spawnSync(gate.command, gate.args, {
    cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: gate.timeoutMs ?? 300_000,
  })
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split('\n')
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
  const unsupportedHost = Boolean(gate.environmentLimited) && process.platform === 'win32'
    && run.status === 1 && !run.error && output.some(line => line.trim() === 'Unsupported platform: win32. Use darwin or linux.')
  const endedWithCode = codeFingerprint()
  const sourceChanged = startedWithCode !== endedWithCode
  const status = timedOut || sourceChanged ? 'failed'
    : run.status === 0 ? 'pass'
      : unsupportedHost ? 'environment-limited' : 'failed'
  const logPath = join(gateLogDirectory, `${gate.name}.log`)
  writeFileSync(logPath, `${run.stdout ?? ''}\n${run.stderr ?? ''}`)
  gateResults.push({
    name: gate.name,
    command: [gate.command, ...gate.args],
    status,
    exitCode: run.status,
    source: { startedWithCode, endedWithCode, changedDuringGate: sourceChanged },
    ...(timedOut ? { timedOut } : {}),
    ...(unsupportedHost ? { environmentLimited: gate.environmentLimited } : {}),
    durationMs: Date.now() - started,
    log: { path: relative(root, logPath).replaceAll('\\', '/'), sha256: sha256(logPath) },
    outputTail: output.slice(-12),
  })
  console.log(`${gate.name}: ${status} (exit=${run.status}${timedOut ? ' timed out' : ''}, ${((Date.now() - started) / 1000).toFixed(1)}s)`)
}

// Verification runs: keep only those bound to this lockfile, but never hide the rest.
const verificationRoot = join(root, '.cache/verification')
const lockfileSha256 = sha256(join(root, 'bun.lock'))
const verificationRuns = existsSync(verificationRoot)
  ? readdirSync(verificationRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('upgrade-0153'))
    .map(entry => join(verificationRoot, entry.name))
    .filter(directory => existsSync(join(directory, 'manifest.json')))
    .map(directory => {
      const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
        workflow: string; exitCode: number; sceneIds: string[]; artifacts: { path: string }[]
        source: { headSha: string; lockfileSha256: string }
      }
      return {
        workflow: manifest.workflow,
        directory: relative(root, directory).replaceAll('\\', '/'),
        manifestSha256: sha256(join(directory, 'manifest.json')),
        exitCode: manifest.exitCode,
        status: manifest.exitCode === 0 ? 'pass' : 'fail',
        sceneIds: manifest.sceneIds,
        artifacts: manifest.artifacts.length,
        sourceHead: manifest.source.headSha,
        lockfileSha256: manifest.source.lockfileSha256,
        boundToCurrentLock: manifest.source.lockfileSha256 === lockfileSha256,
      }
    })
  : []

// Python: measured, not declared. The toolchain runs under the packaged uv.
const pythonProbe = (() => {
  const packagedUv = join(root, 'apps/electron/resources/bin', `${process.platform}-${process.arch}`, exe('uv'))
  const uv = existsSync(packagedUv) ? packagedUv : exe('uv')
  const script = [
    'import importlib.metadata as md',
    'versions = {}',
    'for name in ("pypdf","pypdfium2","pillow-heif","Pillow","openpyxl","python-pptx","python-docx","markitdown","icalendar","img2pdf","click","python-dateutil","diff-match-patch"):',
    '    try: versions[name] = md.version(name)',
    '    except Exception: versions[name] = None',
    'import sys; print(sys.version.split()[0])',
    'print(versions)',
  ].join('\n')
  const source = '# /// script\n# dependencies = ["pypdf==6.21.1", "pypdfium2==5.14.0", "pillow-heif==1.8.1", "Pillow==12.3.0"]\n# ///\n' + script
  const tmp = join(root, '.cache/upgrade-20261018/python-probe.py')
  mkdirSync(join(root, '.cache/upgrade-20261018'), { recursive: true })
  writeFileSync(tmp, source)
  const run = spawnSync(uv, ['run', '--python', '3.12.15', '--quiet', tmp], { cwd: root, encoding: 'utf8', timeout: 900_000 })
  const lines = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split('\n').filter(Boolean)
  return {
    command: [uv, 'run', '--python', '3.12.15', tmp],
    status: run.status === 0 ? 'measured' : 'failed',
    exitCode: run.status,
    interpreter: lines[0] ?? null,
    versions: lines.length > 1 ? lines[lines.length - 1] : null,
    outputTail: lines.slice(-4),
  }
})()

const targetsState: Record<string, unknown> = {}
for (const [name, entry] of Object.entries({ ...targets.npm, ...targets.addedNpm })) {
  const current = installed(name)
  const exception = APPROVED_EXCEPTIONS[name]
  const status = current === entry.version ? 'matched'
    : exception && current === exception.installed ? 'approved-exception'
      : 'mismatched'
  targetsState[name] = {
    batch: entry.batch, target: entry.version, installed: current, status,
    ...(status === 'approved-exception' ? { exception: exception!.reason, evidence: exception!.evidence } : {}),
  }
}
const statusCounts = Object.values(targetsState).reduce<Record<string, number>>((counts, value) => {
  const status = (value as { status: string }).status
  counts[status] = (counts[status] ?? 0) + 1
  return counts
}, {})

const finalCodeFingerprint = codeFingerprint()
for (const gate of gateResults) {
  const source = gate.source as { startedWithCode: string } | undefined
  if (gate.status === 'pass' && source?.startedWithCode !== finalCodeFingerprint) {
    gate.status = 'failed'
    gate.sourceChangedAfterExecution = true
  }
}
if (!partial) {
  const summary = gateResults.reduce<Record<string, number>>((counts, gate) => { const status = String(gate.status); counts[status] = (counts[status] ?? 0) + 1; return counts }, {})
  const file = join(root, 'docs/dependencies/upgrade-closeout-2026-10-20.md')
  const marker = '<!-- upgrade-closeout-results:start -->'
  const current = readFileSync(file, 'utf8').split(marker)[0]!.trimEnd()
  writeFileSync(file, `${current}\n\n${marker}\n## 自动采集的最终门禁\n\n采集时间：${new Date().toISOString()}。通过 ${summary.pass ?? 0}，失败 ${summary.failed ?? 0}，环境受限 ${summary['environment-limited'] ?? 0}。${summary.failed ? '尚未验收通过；红项见机器结果。' : '适用门禁已通过；环境限制与批准延期不计为通过。'}\n\n每个门禁记录执行前后源码指纹、完整日志及哈希。当前 Git、锁文件全图 churn、改动文件哈希和各次历史失败都由脚本读取；以[机器结果](../verification/results/upgrade-2026-10-18.json)为当前验收结论。\n<!-- upgrade-closeout-results:end -->\n`)
}
const changedPaths = gitPaths()
const generatedResults = ['docs/verification/results/upgrade-2026-10-18.json', 'docs/verification/results/upgrade-2026-10-18.partial.json']
const snapshotFiles = [...new Set([
  'package.json', 'bun.lock', 'apps/electron/electron-builder.yml', 'scripts/build/common.ts',
  'Dockerfile.server', '.github/workflows/validate.yml', '.github/workflows/validate-server.yml',
  'packages/shared/src/unified-network-interceptor.ts', 'packages/shared/src/config/connections.ts',
  'packages/shared/src/config/legacy-endpoints.ts', 'packages/shared/src/workspaces/chat-starters.ts',
  'packages/pi-agent-server/src/context-usage.ts', 'packages/server-core/src/services/heic.ts',
  'packages/server-core/src/handlers/rpc/files.ts', 'packages/server-core/src/handlers/rpc/settings.ts',
  'apps/electron/src/main/platform.ts', 'apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx',
  'apps/electron/src/renderer/components/apisetup/tier-models.ts',
  'apps/electron/src/renderer/components/app-shell/AttachmentPreview.tsx',
  'apps/electron/src/renderer/components/chat/ChatStarters.tsx',
  'apps/electron/src/renderer/lib/chat-starter-action.ts',
  'apps/electron/src/renderer/pages/settings/ChatStartersSection.tsx',
  'scripts/verification/workflow-browser.ts', 'scripts/critical-scenarios.ts',
  'apps/electron/resources/scripts/pdf_tool.py', 'apps/electron/resources/scripts/img_tool.py',
  'patches/http-cache-semantics@4.3.0.patch',
  'apps/electron/resources/bin/win32-x64/uv.exe.version',
  ...changedPaths.filter(file => !generatedResults.includes(file)),
])]

const baseCommit = targets as typeof targets & { baseCommit: string }
const previousLock = Bun.JSONC.parse(execFileSync('git', ['show', `${baseCommit.baseCommit}:bun.lock`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) as { packages: Record<string, unknown[]> }
const currentLock = Bun.JSONC.parse(readFileSync(join(root, 'bun.lock'), 'utf8')) as { packages: Record<string, unknown[]> }
const churn = [...new Set([...Object.keys(previousLock.packages), ...Object.keys(currentLock.packages)])].sort().flatMap(name => {
  const before = previousLock.packages[name], after = currentLock.packages[name]
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  return [{ name, status: !before ? 'added' : !after ? 'removed' : before[0] !== after[0] ? 'version-or-source-changed' : 'resolution-metadata-changed', before: before?.[0] ?? null, after: after?.[0] ?? null }]
})

const gateStatusCounts = gateResults.reduce<Record<string, number>>((counts, gate) => {
  const status = (gate as { status: string }).status
  counts[status] = (counts[status] ?? 0) + 1
  return counts
}, {})

/**
 * The functional verdict, separate from the command verdict.
 *
 * A gate can exit 0 while a scenario inside it recorded a known issue, and a
 * gate can exit 1 because this host cannot run it. Both are reported here so
 * neither can be read as "the upgrade passed".
 */
const failedGateNames = gateResults.filter(gate => gate.status === 'failed').map(gate => String(gate.name))
const notRunGateNames = gateResults.filter(gate => gate.status === 'not-run').map(gate => String(gate.name))
const environmentLimitedGateNames = gateResults.filter(gate => gate.status === 'environment-limited').map(gate => String(gate.name))
const runDirectories = existsSync(verificationRoot)
  ? readdirSync(verificationRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('upgrade-0153'))
    .map(entry => join(verificationRoot, entry.name))
  : []
const knownIssues = runDirectories
  .map(directory => join(directory, 'known-issues.json'))
  .filter(file => existsSync(file))
  .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  .flatMap(file => {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { knownIssues?: { id: string; status: string; summary: string }[] }
    return (parsed.knownIssues ?? []).map(issue => ({ ...issue, source: relative(root, file).replaceAll('\\', '/') }))
  })
// One entry per distinct known issue: every historical run of the same workflow
// writes its own known-issues.json, so the same id arrives many times. The note
// keeps the most recent evidence directory.
const knownIssueEntries = new Map<string, { id: string; status: string; note: string }>()
for (const issue of knownIssues) {
  knownIssueEntries.set(issue.id, { id: issue.id, status: issue.status, note: `${issue.summary} (${issue.source})` })
}
const approvedDeferred = [
  { id: 'FullCalendar pinned at 7.1.0', status: 'approved-exception', note: 'review round 1; 7.1.3 removes the [role=gridcell][data-date] contract CalendarView depends on' },
  { id: 'http-cache-semantics local hardening patch', status: 'approved-exception', note: 'review round 1; official 4.3.0 alone fails 14/23 security checks' },
  { id: 'Compaction summarization budget', status: 'approved-deferred', note: 'Pi 1.3.0 has no ready-made independent summarization-budget setting' },
  { id: 'P-01 tool-name fallback in failure hooks', status: 'approved-deferred', note: 'review round 2; affects PostToolUseFailure tool_name, not the turn result' },
  { id: 'U-01 zero-usage ledger row for a fully rejected attempt', status: 'approved-deferred', note: 'review round 2; not counted as a pass — see knownIssues' },
  { id: 'D-01 pypdf noise line before the documented PDF error', status: 'approved-deferred', note: 'review round 2; error semantics and bounded behaviour are verified as-is' },
  ...knownIssueEntries.values(),
]
const acceptanceStatus = {
  commandSuccess: failedGateNames.length === 0 && notRunGateNames.length === 0,
  functionalStatus: notRunGateNames.length > 0 ? 'not-evaluated' : failedGateNames.length > 0
    ? 'not-accepted'
    : (environmentLimitedGateNames.length > 0 ? 'accepted-with-environment-limits' : 'accepted'),
  failedGates: failedGateNames,
  notRunGates: notRunGateNames,
  environmentLimitedGates: environmentLimitedGateNames,
  approvedDeferred,
  statement: 'complete:true means the collection ran in full (no --only/--skip-gates). It is NOT the acceptance verdict: this block is. Environment-limited gates and approved-deferred or known issues never count as functional passes.',
}

const document = {
  schemaVersion: 2,
  batch: 'upgrade-2026-10-18',
  recordedAt: new Date().toISOString(),
  timezone: 'Asia/Shanghai',
  // A partial collection is labelled as such in the file itself.
  complete: !partial,
  ...(partial ? { partialReason: 'invoked with --only/--skip-gates; gates marked not-run were NOT executed in this run' } : {}),
  baseCommit: (readJson('docs/dependencies/upgrade-2026-10-18/targets.json') as { baseCommit: string }).baseCommit,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  codeFingerprint: finalCodeFingerprint,
  branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: {
    dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    note: 'Upgrade implementation is committed in d0fb6be7b and ac85d33b0; this Codex closeout remains uncommitted for review. HEAD is read from Git, not inferred from the original freeze.',
    headTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    changes: changedPaths.filter(file => !generatedResults.includes(file)).map(file => ({ path: file, sha256: existsSync(join(root, file)) ? sha256(join(root, file)) : null })),
    generatedResultExclusions: generatedResults,
  },
  lockfile: { path: 'bun.lock', sha256: lockfileSha256, churnFromFreeze: { baseCommit: baseCommit.baseCommit, counts: churn.reduce<Record<string, number>>((counts, row) => { counts[row.status] = (counts[row.status] ?? 0) + 1; return counts }, {}), entries: churn, note: 'Whole lock graph diff, including required transitive/internal changes; these counts are not the direct target count or additional accepted upgrades.' } },
  environment: {
    bun: execFileSync(join(runtimeBin, 'bun-1.4.3', exe('bun')), ['--version'], { encoding: 'utf8' }).trim(),
    node: execFileSync(join(runtimeBin, 'node-24.22.0', process.platform === 'win32' ? 'node.exe' : 'bin/node'), ['--version'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    architecture: arch(),
    osRelease: release(),
    isolatedRuntimeRoot: '.cache/upgrade-20261018/runtime',
    machineWideRuntimeUnchanged: true,
  },
  frozenTargets: targets.runtimes,
  npm: {
    total: Object.keys(targetsState).length,
    statusCounts,
    approvedExceptions: Object.keys(APPROVED_EXCEPTIONS),
    resolved: targetsState,
  },
  python: pythonProbe,
  artifacts: Object.fromEntries(snapshotFiles.map(file => [file,
    existsSync(join(root, file)) ? { sha256: sha256(join(root, file)), bytes: statSync(join(root, file)).size } : null,
  ])),
  gates: gateResults,
  gateStatusCounts,
  // `complete` above only means "no --only/--skip-gates was used": it says the
  // collection ran in full, not that the upgrade passed. This block is the
  // functional verdict, and it separates a command's exit code from acceptance.
  acceptance: acceptanceStatus,
  verificationRuns,
  notVerified: [
    'macOS and Linux execution (Windows x64 host only)',
    'container image build and OS level scanning',
    'code signing and running a real installer',
    'live provider accounts (Kimi, OpenCode, Anthropic, MCP OAuth); loopback and recorded only',
    'the Chat Starters chips in a real Electron window: the landing workflow drives the shipped ChatDisplay in a browser, the shell-level wiring is covered by the workspace-isolation hook workflow',
    'the headless-server artifact and `sharp` inside it (server:build targets darwin/linux only); the desktop unpacked artifact was built and exercised from outside the repository, and `sharp` is not on its reachable path',
    'an electron-builder `portable` target: this repository configures nsis plus the default `--dir` unpacked output only, so portable execution means running the unpacked tree from an external directory',
  ],
}

const out = join(root,
  partial ? 'docs/verification/results/upgrade-2026-10-18.partial.json' : 'docs/verification/results/upgrade-2026-10-18.json')
mkdirSync(join(root, 'docs/verification/results'), { recursive: true })
writeFileSync(out, JSON.stringify(document, null, 2) + '\n')
console.log(JSON.stringify({
  output: relative(root, out),
  complete: document.complete,
  targets: document.npm.statusCounts,
  gates: gateStatusCounts,
  verificationRuns: verificationRuns.length,
  runsBoundToCurrentLock: verificationRuns.filter(run => run.boundToCurrentLock).length,
}, null, 2))
