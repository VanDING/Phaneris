#!/usr/bin/env bun
/**
 * PDF-01..PDF-05 acceptance for the shipped PDF tool.
 *
 * Runs `apps/electron/resources/scripts/pdf_tool.py` exactly the way the app
 * does — `uv run --python 3.12.15 --quiet <script> COMMAND ...` through the uv
 * binary bundled at `apps/electron/resources/bin/<platform>/` — against the
 * bounded fixtures built by `scripts/verification/upgrade-0153-pdf-fixtures.ts`.
 *
 * Usage:
 *   bun run scripts/verification/upgrade-0153-pdf-workflow.ts [--output-dir=<dir>]
 *
 * Fixtures (see `<fixtures>/manifest.json` for sha256, byte size and how each
 * one was built):
 *   normal.pdf     3 pages of selectable text, one marker per page, US Letter
 *   encrypted.pdf  the same graph, password protected (user/owner: user/owner)
 *   form.pdf       a real AcroForm with the text fields `full_name` and `email`
 *   truncated.pdf  normal.pdf cut at 60%, inside an unterminated stream
 *   cyclic.pdf     a page tree whose root /Pages node is its own descendant
 *
 * Scenes assert, they do not observe: every expectation is recorded with its
 * outcome, the workflow runs all five scenes before reporting, and each scene
 * keeps the exact argv, exit code, stdout/stderr and elapsed time of every
 * command it issued in `normal.json`, `encrypted.json`, `forms.json`,
 * `damaged.json`, `cyclic.json` and `summary.json`.
 *
 * Boundedness: each command runs under a 90 s hard timeout; the acceptance
 * bounds asserted below are 60 s. A timed-out command is killed together with
 * its process tree (the uv parent and the Python child) so a hang cannot leak a
 * spinning interpreter.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
const fixturesDir = join(root, '.cache/upgrade-20261018/pdf-fixtures')
const toolScript = join(root, 'apps/electron/resources/scripts/pdf_tool.py')
const toolPython = '3.12.15'
/** Acceptance bound demanded by the scene list. */
const BOUND_MS = 60_000
/** Hard kill, deliberately looser than BOUND_MS so a hang reports as a timeout. */
const HARD_TIMEOUT_MS = 90_000
const TRUNCATE = 4_000

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const normalize = (text: string) => text.replaceAll('\r\n', '\n')
const ms = (value: number) => `${value} ms`

/** uv, preferring the binary this repo ships over whatever is on PATH. */
function resolveUv(): string {
  const platformKey = `${process.platform}-${process.arch}`
  const packaged = join(root, 'apps/electron/resources/bin', platformKey, process.platform === 'win32' ? 'uv.exe' : 'uv')
  if (existsSync(packaged)) return packaged
  return process.platform === 'win32' ? 'uv.exe' : 'uv'
}
const uv = resolveUv()
const uvVersion = spawnSync(uv, ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? null
const uvSha256 = createHash('sha256').update(readFileSync(uv)).digest('hex')

const toolArgv = (command: string[]) => [uv, 'run', '--python', toolPython, '--quiet', toolScript, ...command]
const probeArgv = (script: string, target: string) => [uv, 'run', '--offline', '--python', toolPython, '--quiet', script, target]

// --- evidence shapes ---------------------------------------------------------

interface Assertion { name: string; passed: boolean; detail?: string }
interface Step {
  label: string
  argv: string[]
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  elapsedMs: number
  stdout: string
  stdoutBytes: number
  stdoutTruncated: boolean
  stderr: string
  stderrBytes: number
  stderrTruncated: boolean
}
interface ToolInfo {
  file: string
  encrypted: boolean
  pages: number | null
  note?: string
  metadata?: Record<string, string | null>
  page_size?: { width: number; height: number; width_inches: number; height_inches: number }
  form_fields?: { name: string; type: string; value: string }[]
}
interface PageSection { page: number; body: string }

const clipped = (text: string) => (text.length <= TRUNCATE
  ? { text, truncated: false }
  : { text: `${text.slice(0, TRUNCATE)}\n… [${text.length - TRUNCATE} of ${text.length} characters omitted]`, truncated: true })

/** Kill a hung command and its children, so a timeout cannot orphan Python. */
function killTree(pid: number | undefined) {
  if (!pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 15_000 })
  else {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
  }
}

/** Split `--- Page n ---` output into sections, keeping the marker order. */
function pageSections(stdout: string): PageSection[] {
  const sections: PageSection[] = []
  let current: PageSection | undefined
  for (const line of normalize(stdout).split('\n')) {
    const marker = /^--- Page (\d+) ---$/.exec(line.trim())
    if (marker) {
      current = { page: Number(marker[1]), body: '' }
      sections.push(current)
    } else if (current) current.body += `${line}\n`
  }
  return sections
}

class Scene {
  readonly steps: Step[] = []
  readonly assertions: Assertion[] = []
  readonly observations: Record<string, unknown> = {}
  readonly cwd: string
  readonly tmp: string
  subject?: { name: string; path: string; sha256: string; bytes: number }
  error: string | undefined

  constructor(readonly id: string, readonly title: string, runDirectory: string) {
    this.cwd = join(runDirectory, 'sandbox', id.toLowerCase(), 'cwd')
    this.tmp = join(runDirectory, 'sandbox', id.toLowerCase(), 'tmp')
    mkdirSync(this.cwd, { recursive: true })
    mkdirSync(this.tmp, { recursive: true })
  }

  /** Register the fixture under test so its identity lands in the scene evidence. */
  useFixture<T extends { name: string; path: string; sha256: string; bytes: number }>(entry: T) {
    this.subject = { name: entry.name, path: relative(root, entry.path).replaceAll('\\', '/'), sha256: entry.sha256, bytes: entry.bytes }
    return entry
  }

  /** Record one expectation; a failure is kept, never thrown, so the scene finishes its story. */
  expect(name: string, check: () => void) {
    try {
      check()
      this.assertions.push({ name, passed: true })
    } catch (error) {
      this.assertions.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Run one command in the scene sandbox: redirected TEMP/TMP, dedicated cwd, hard timeout. */
  async step(label: string, argv: string[], timeoutMs = HARD_TIMEOUT_MS): Promise<Step> {
    const env = { ...process.env, TEMP: this.tmp, TMP: this.tmp, TMPDIR: this.tmp }
    const started = Date.now()
    const proc = Bun.spawn(argv, { cwd: this.cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; killTree(proc.pid) }, timeoutMs)
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    clearTimeout(timer)
    const elapsedMs = Date.now() - started
    const out = clipped(normalize(stdout))
    const err = clipped(normalize(stderr))
    const step: Step = {
      label, argv, exitCode, signal: proc.signalCode == null ? null : String(proc.signalCode), timedOut, elapsedMs,
      stdout: out.text, stdoutBytes: stdout.length, stdoutTruncated: out.truncated,
      stderr: err.text, stderrBytes: stderr.length, stderrTruncated: err.truncated,
    }
    this.steps.push(step)
    return step
  }

  /** Files the tool left in the redirected TEMP directory (uv keeps its own lock file). */
  tempLeftovers() {
    return readdirSync(this.tmp).filter(name => !/^uv-[0-9a-f]+\.lock$/.test(name))
  }

  get failed() { return this.assertions.filter(assertion => !assertion.passed) }
  get status() { return this.error || this.failed.length ? 'failed' : 'passed' }
}

const infoOf = (step: Step): ToolInfo | undefined => {
  try { return JSON.parse(step.stdout) as ToolInfo } catch { return undefined }
}
/** stderr lines that are the tool's documented failure channel. */
const errorLines = (step: Step) => normalize(step.stderr).split('\n').filter(line => line.startsWith('Error: '))

// --- fixtures ----------------------------------------------------------------

interface FixtureEntry {
  bytes: number
  sha256: string
  markers?: string[]
  label?: string
  rootCount?: number
  cycle?: string[]
  insideUnterminatedStream?: boolean
  [key: string]: unknown
}
let fixtures: Record<string, FixtureEntry> = {}
let fixtureGenerator = ''

/** Fixtures are committed alongside the workflow but live in `.cache`; fail loudly with the command to rebuild them. */
function loadFixtureManifest() {
  const manifestPath = join(fixturesDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`No PDF fixtures at ${relative(root, fixturesDir).replaceAll('\\', '/')} — build them first: bun run scripts/verification/upgrade-0153-pdf-fixtures.ts`)
  }
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { generator: string; fixtures: Record<string, FixtureEntry> }
  fixtures = parsed.fixtures
  fixtureGenerator = parsed.generator
  for (const name of Object.keys(fixtures)) {
    if (!existsSync(join(fixturesDir, name))) throw new Error(`Fixture ${name} is listed in manifest.json but missing from ${relative(root, fixturesDir).replaceAll('\\', '/')}`)
  }
}
const fixtureEntry = (name: string) => {
  const entry = fixtures[name]
  assert(entry, `Fixture ${name} is missing from the generator manifest`)
  return entry
}
const fixture = (name: string) => {
  const path = join(fixturesDir, name)
  return { name, path, manifest: fixtureEntry(name), sha256: sha256(path), bytes: readFileSync(path).byteLength }
}
const FORM_PAYLOAD = { full_name: 'Ada Lovelace', email: 'ada@example.com' }
/** One evidence file per scene, named after what it proves. */
const EVIDENCE_FILE: Record<string, string> = {
  'PDF-01': 'normal.json',
  'PDF-02': 'encrypted.json',
  'PDF-03': 'forms.json',
  'PDF-04': 'damaged.json',
  'PDF-05': 'cyclic.json',
  'PDF-06': 'render-resources.json',
}

/** Replays one pypdf call from the tool's own pinned dependency set, so the
 * tool's opaque `Error: {str(e)}` line can be attributed to a real class. */
const LIBRARY_PROBE = `# /// script
# requires-python = ">=3.12"
# dependencies = ["pypdf==6.21.1"]
# ///
"""Attribute pdf_tool.py's stderr line to the pypdf exception behind it."""
import json
import sys

from pypdf import PdfReader

path = sys.argv[1]
try:
    reader = PdfReader(path)
    print(json.dumps({"outcome": "ok", "pages": len(reader.pages), "encrypted": reader.is_encrypted}))
except Exception as error:  # noqa: BLE001 - the point is to report whatever pypdf raises
    print(json.dumps({
        "outcome": "error",
        "class": type(error).__module__ + "." + type(error).__name__,
        "message": str(error),
    }))
`

// --- workflow ----------------------------------------------------------------

const run = new VerificationRun('upgrade-0153-pdf')
const sceneIds: string[] = []
const summaries: Record<string, unknown>[] = []
const untested = [
  'pdf_tool commands other than info/extract/fill-form/to-image (merge, split, rotate, reorder, duplicate, watermark, compress, crop, resize, flatten, header-footer, encrypt, decrypt, redact, sanitize, from-image, to-docx, to-pptx)',
  'decrypt with the correct password — the encrypted fixture is only ever read without one',
  'the -o/--output form of info and extract (both are driven through stdout)',
  'platforms other than the recorded one: fixtures are generated and driven on win32-x64 with CPython 3.12.15',
  'the packaged Electron app shell (the same bundled uv and script argv the .cmd wrapper forwards are used directly)',
  'untrusted or hostile PDFs beyond these five bounded fixtures (no decompression bombs, no documents larger than a few pages)',
]

let failure: unknown
try {
  run.checkArguments()
  loadFixtureManifest()

  const scenes: { scene: Scene; body: (scene: Scene) => Promise<void> }[] = []
  const scene = (id: string, title: string, body: (scene: Scene) => Promise<void>) => {
    scenes.push({ scene: new Scene(id, title, run.directory), body })
  }

  // --- PDF-01: a normal, text-bearing PDF ------------------------------------
  scene('PDF-01', 'normal PDF: info reports the document, extract returns selectable text', async scene => {
    const normal = scene.useFixture(fixture('normal.pdf'))
    const markers = fixtureEntry('normal.pdf').markers!
    scene.expect('fixture bytes match the committed generator manifest', () => {
      assert.equal(normal.sha256, normal.manifest.sha256, 'normal.pdf sha256 drifted from the generator manifest')
      assert.equal(normal.bytes, normal.manifest.bytes)
    })

    const infoStep = await scene.step('info normal.pdf', toolArgv(['info', normal.path]))
    scene.expect('info exits 0', () => assert.equal(infoStep.exitCode, 0, `exit ${infoStep.exitCode}, stderr: ${infoStep.stderr}`))
    const info = infoOf(infoStep)
    scene.expect('info writes one JSON object to stdout', () => assert.ok(info, `stdout was not JSON: ${infoStep.stdout.slice(0, 200)}`))
    scene.expect('info reports encrypted=false and exactly 3 pages', () => {
      assert.equal(info?.encrypted, false)
      assert.equal(info?.pages, 3)
    })
    scene.expect('info reports the US Letter page size (612x792pt, 8.5x11in)', () => {
      assert.equal(info?.page_size?.width, 612)
      assert.equal(info?.page_size?.height, 792)
      assert.equal(info?.page_size?.width_inches, 8.5)
      assert.equal(info?.page_size?.height_inches, 11)
    })
    scene.expect('info exposes the fixture /Info dictionary', () => {
      assert.equal(info?.metadata?.title, 'Phaneris PDF verification fixture F1')
      assert.equal(info?.metadata?.author, 'verification')
    })

    const extractStep = await scene.step('extract normal.pdf', toolArgv(['extract', normal.path]))
    scene.expect('extract exits 0 with an empty stderr', () => {
      assert.equal(extractStep.exitCode, 0, `exit ${extractStep.exitCode}, stderr: ${extractStep.stderr}`)
      assert.equal(normalize(extractStep.stderr), '')
    })
    const sections = pageSections(extractStep.stdout)
    scene.expect('extract emits --- Page 1..3 --- separators in order', () => {
      assert.deepEqual(sections.map(section => section.page), [1, 2, 3])
    })
    scene.expect('each page section carries exactly its own unique marker', () => {
      assert.equal(sections.length, 3)
      sections.forEach((section, index) => {
        assert.ok(section.body.includes(markers[index]!), `page ${index + 1} is missing ${markers[index]}`)
        for (const other of markers) {
          if (other !== markers[index]) assert.ok(!section.body.includes(other), `page ${index + 1} leaked ${other}`)
        }
      })
    })

    const pageTwo = await scene.step('extract normal.pdf --pages 2', toolArgv(['extract', normal.path, '--pages', '2']))
    scene.expect('--pages 2 exits 0', () => assert.equal(pageTwo.exitCode, 0, `exit ${pageTwo.exitCode}, stderr: ${pageTwo.stderr}`))
    const pageTwoSections = pageSections(pageTwo.stdout)
    scene.expect('--pages 2 extracts page 2 alone', () => {
      assert.deepEqual(pageTwoSections.map(section => section.page), [2])
      assert.ok(pageTwoSections[0]!.body.includes(markers[1]!), 'page 2 text is missing from the --pages 2 output')
    })
    scene.expect('--pages 2 does not leak pages 1 or 3', () => {
      assert.ok(!pageTwo.stdout.includes(markers[0]!), 'page 1 marker leaked into the --pages 2 output')
      assert.ok(!pageTwo.stdout.includes(markers[2]!), 'page 3 marker leaked into the --pages 2 output')
    })

    scene.observations.extractPageSize = normal.manifest.pageSize
    scene.observations.markerOrder = markers
  })

  // --- PDF-02: an encrypted PDF ----------------------------------------------
  scene('PDF-02', 'encrypted PDF: info stays readable, extract fails closed', async scene => {
    const encrypted = scene.useFixture(fixture('encrypted.pdf'))
    scene.expect('fixture bytes match the committed generator manifest', () => {
      assert.equal(encrypted.sha256, encrypted.manifest.sha256)
      assert.equal(encrypted.bytes, encrypted.manifest.bytes)
    })

    const infoStep = await scene.step('info encrypted.pdf', toolArgv(['info', encrypted.path]))
    scene.expect('info exits 0 on an encrypted PDF', () => assert.equal(infoStep.exitCode, 0, `exit ${infoStep.exitCode}, stderr: ${infoStep.stderr}`))
    const info = infoOf(infoStep)
    scene.expect('info reports encrypted=true, pages=null and the documented note', () => {
      assert.ok(info, `stdout was not JSON: ${infoStep.stdout.slice(0, 200)}`)
      assert.equal(info?.encrypted, true)
      assert.equal(info?.pages, null)
      assert.equal(info?.note, 'PDF is encrypted. Decrypt to view full metadata.')
    })
    scene.expect('encrypted info carries no metadata or page size', () => {
      assert.equal(info?.metadata, undefined)
      assert.equal(info?.page_size, undefined)
    })

    const extractStep = await scene.step('extract encrypted.pdf', toolArgv(['extract', encrypted.path]))
    scene.expect('extract fails closed with exit code 1', () => {
      assert.equal(extractStep.exitCode, 1, `expected exit 1, got ${extractStep.exitCode}`)
      assert.equal(extractStep.signal, null)
      assert.equal(extractStep.timedOut, false)
    })
    scene.expect('extract writes exactly one Error: line and nothing on stdout', () => {
      assert.equal(normalize(extractStep.stdout), '')
      assert.deepEqual(errorLines(extractStep), ['Error: Failed to load document (PDFium: Incorrect password error).'])
      assert.equal(normalize(extractStep.stderr).trimEnd().split('\n').length, 1, `stderr was not a single line: ${JSON.stringify(extractStep.stderr)}`)
    })
    scene.expect('extract reports no Python traceback', () => {
      assert.ok(!extractStep.stderr.includes('Traceback (most recent call last)'))
    })
    scene.expect(`extract is bounded (${ms(extractStep.elapsedMs)} < ${ms(BOUND_MS)})`, () => {
      assert.ok(extractStep.elapsedMs < BOUND_MS)
    })
    scene.expect('the tool left no temp files behind', () => assert.deepEqual(scene.tempLeftovers(), []))

    scene.observations.failureMessage = errorLines(extractStep)[0]
    scene.observations.elapsedMs = { info: infoStep.elapsedMs, extract: extractStep.elapsedMs }
  })

  // --- PDF-03: a real AcroForm ------------------------------------------------
  scene('PDF-03', 'AcroForm PDF: info lists the fields, fill-form writes them without corrupting the file', async scene => {
    const form = scene.useFixture(fixture('form.pdf'))
    scene.expect('fixture bytes match the committed generator manifest', () => {
      assert.equal(form.sha256, form.manifest.sha256)
      assert.equal(form.bytes, form.manifest.bytes)
    })

    const infoStep = await scene.step('info form.pdf', toolArgv(['info', form.path]))
    scene.expect('info exits 0', () => assert.equal(infoStep.exitCode, 0, `exit ${infoStep.exitCode}, stderr: ${infoStep.stderr}`))
    const info = infoOf(infoStep)
    scene.expect('info lists the two real text fields with their types', () => {
      assert.ok(info?.form_fields, 'form_fields is missing from info output')
      const fields = Object.fromEntries(info!.form_fields!.map(field => [field.name, field.type]))
      assert.deepEqual(fields, { full_name: '/Tx', email: '/Tx' })
    })
    scene.expect('the fields start empty and the document is not encrypted', () => {
      assert.equal(info?.encrypted, false)
      assert.equal(info?.pages, 1)
      assert.deepEqual(info?.form_fields?.map(field => field.value), ['', ''])
    })

    const output = join(scene.cwd, 'filled.pdf')
    const fillStep = await scene.step('fill-form form.pdf', toolArgv(['fill-form', form.path, '--data', JSON.stringify(FORM_PAYLOAD), '-o', output]))
    scene.expect('fill-form exits 0 and echoes the written path on stderr', () => {
      assert.equal(fillStep.exitCode, 0, `exit ${fillStep.exitCode}, stderr: ${fillStep.stderr}`)
      assert.equal(normalize(fillStep.stdout), '')
      assert.deepEqual(normalize(fillStep.stderr).trimEnd().split('\n'), [`PDF written to ${output}`])
      assert.ok(existsSync(output), 'fill-form did not write its output file')
    })

    const filledInfoStep = await scene.step('info filled.pdf', toolArgv(['info', output]))
    scene.expect('the filled output re-reads as a valid PDF with the same page', () => {
      assert.equal(filledInfoStep.exitCode, 0, `exit ${filledInfoStep.exitCode}, stderr: ${filledInfoStep.stderr}`)
      const filled = infoOf(filledInfoStep)
      assert.equal(filled?.encrypted, false)
      assert.equal(filled?.pages, 1)
      assert.equal(filled?.page_size?.width, 612)
      assert.equal(filled?.page_size?.height, 792)
    })
    scene.expect('info on the output shows the filled field values', () => {
      const filled = infoOf(filledInfoStep)
      assert.ok(filled?.form_fields, 'form_fields disappeared from the filled output')
      assert.deepEqual(
        Object.fromEntries(filled!.form_fields!.map(field => [field.name, field.value])),
        FORM_PAYLOAD,
      )
      assert.deepEqual(filled!.form_fields!.map(field => field.type), ['/Tx', '/Tx'])
    })

    const filledExtract = await scene.step('extract filled.pdf', toolArgv(['extract', output]))
    scene.expect('the filled output is still readable by the renderer (not corrupted)', () => {
      assert.equal(filledExtract.exitCode, 0, `exit ${filledExtract.exitCode}, stderr: ${filledExtract.stderr}`)
      assert.ok(filledExtract.stdout.includes(fixtureEntry('form.pdf').label!), 'the page text vanished from the filled output')
      assert.deepEqual(pageSections(filledExtract.stdout).map(section => section.page), [1])
    })
    scene.expect('fill-form left no temp files behind', () => assert.deepEqual(scene.tempLeftovers(), []))
    scene.expect('fill-form changed the document bytes', () => {
      assert.notEqual(sha256(output), form.sha256)
      assert.ok(readFileSync(output).byteLength > 0)
    })
    scene.expect('the input fixture is untouched', () => assert.equal(sha256(form.path), form.manifest.sha256))

    scene.observations.payload = FORM_PAYLOAD
    scene.observations.inputFields = info?.form_fields
    scene.observations.output = { path: relative(run.directory, output).replaceAll('\\', '/'), bytes: readFileSync(output).byteLength, sha256: sha256(output) }
  })

  // --- PDF-04: a damaged PDF ---------------------------------------------------
  scene('PDF-04', 'damaged PDF: info and extract fail with the documented error, bounded and clean', async scene => {
    const truncated = scene.useFixture(fixture('truncated.pdf'))
    scene.expect('fixture bytes match the committed generator manifest', () => {
      assert.equal(truncated.sha256, truncated.manifest.sha256)
      assert.equal(truncated.bytes, truncated.manifest.bytes)
    })
    scene.expect('the fixture really is cut inside an unterminated content stream', () => {
      assert.equal(truncated.manifest.insideUnterminatedStream, true)
      const bytes = readFileSync(truncated.path)
      assert.ok(!bytes.includes(Buffer.from('%%EOF')), 'truncated.pdf must not carry a trailer')
      assert.ok(!bytes.includes(Buffer.from('endstream', 'latin1')) || bytes.lastIndexOf('stream') > bytes.lastIndexOf('endstream'), 'truncated.pdf must end inside a stream')
    })

    // Observed on the pinned tool: pypdf cannot rebuild the xref, so `info` fails
    // with PdfStreamError("Stream has ended unexpectedly"); pdfium refuses the
    // file outright. Both are the documented `Error: …` + exit 1 channel.
    const infoStep = await scene.step('info truncated.pdf', toolArgv(['info', truncated.path]))
    scene.expect('info exits 1 without a signal or a timeout', () => {
      assert.equal(infoStep.exitCode, 1, `expected exit 1, got ${infoStep.exitCode} (signal ${infoStep.signal})`)
      assert.equal(infoStep.signal, null)
      assert.equal(infoStep.timedOut, false)
    })
    scene.expect('info ends with the documented Error: line', () => {
      assert.equal(normalize(infoStep.stdout), '')
      assert.deepEqual(errorLines(infoStep), ['Error: Stream has ended unexpectedly'])
    })
    scene.expect('info reports no Python traceback', () => {
      assert.ok(!infoStep.stderr.includes('Traceback (most recent call last)'))
    })
    scene.expect(`info is bounded (${ms(infoStep.elapsedMs)} < ${ms(BOUND_MS)})`, () => {
      assert.ok(infoStep.elapsedMs < BOUND_MS)
    })

    const extractStep = await scene.step('extract truncated.pdf', toolArgv(['extract', truncated.path]))
    scene.expect('extract exits 1 without a signal or a timeout', () => {
      assert.equal(extractStep.exitCode, 1, `expected exit 1, got ${extractStep.exitCode} (signal ${extractStep.signal})`)
      assert.equal(extractStep.signal, null)
      assert.equal(extractStep.timedOut, false)
    })
    scene.expect('extract fails with a single Error: line and no traceback', () => {
      assert.equal(normalize(extractStep.stdout), '')
      assert.deepEqual(errorLines(extractStep), ['Error: Failed to load document (PDFium: Data format error).'])
      assert.equal(normalize(extractStep.stderr).trimEnd().split('\n').length, 1, `stderr was not a single line: ${JSON.stringify(extractStep.stderr)}`)
      assert.ok(!extractStep.stderr.includes('Traceback (most recent call last)'))
    })
    scene.expect(`extract is bounded (${ms(extractStep.elapsedMs)} < ${ms(BOUND_MS)})`, () => {
      assert.ok(extractStep.elapsedMs < BOUND_MS)
    })
    scene.expect('neither command left temp files behind', () => assert.deepEqual(scene.tempLeftovers(), []))
    scene.expect('the damaged fixture was not modified', () => assert.equal(sha256(truncated.path), truncated.manifest.sha256))

    // Attribute the opaque stderr line to a real exception class.
    const probeFile = join(scene.cwd, 'pypdf-probe.py')
    writeFileSync(probeFile, LIBRARY_PROBE)
    const probeStep = await scene.step('pypdf probe truncated.pdf', probeArgv(probeFile, truncated.path))
    const probe = (() => { try { return JSON.parse(probeStep.stdout) as { outcome: string; class?: string; message?: string } } catch { return undefined } })()
    scene.expect('the documented Error: line is pypdf\'s own exception message', () => {
      assert.equal(probeStep.exitCode, 0, `probe exit ${probeStep.exitCode}: ${probeStep.stderr}`)
      assert.equal(probe?.outcome, 'error')
      assert.equal(probe?.class, 'pypdf.errors.PdfStreamError')
      assert.equal(`Error: ${probe?.message}`, errorLines(infoStep)[0])
    })

    scene.observations.outcomes = {
      info: { exitCode: infoStep.exitCode, stderr: normalize(infoStep.stderr), elapsedMs: infoStep.elapsedMs },
      extract: { exitCode: extractStep.exitCode, stderr: normalize(extractStep.stderr), elapsedMs: extractStep.elapsedMs },
    }
    scene.observations.pypdfException = { class: probe?.class, message: probe?.message }
    // Keep raw stderr as evidence. Product logging suppresses only expected
    // pypdf repair warnings; documented errors and nonzero exit remain.
    scene.observations.extraStderrLines = normalize(infoStep.stderr).split('\n').filter(line => line && !line.startsWith('Error: '))
    scene.expect('the product CLI emits only its documented error lines on damaged input', () => {
      for (const step of [infoStep, extractStep]) {
        assert.deepEqual(normalize(step.stderr).split('\n').filter(line => line && !line.startsWith('Error: ')), [])
        assert.ok(errorLines(step).length > 0, 'the actual PDF error remains visible')
      }
    })
  })

  // --- PDF-05: a cyclic page tree ---------------------------------------------
  scene('PDF-05', 'cyclic page tree: both commands terminate inside the hard bound', async scene => {
    const cyclic = scene.useFixture(fixture('cyclic.pdf'))
    const markers = fixtureEntry('cyclic.pdf').markers!
    const rootCount = fixtureEntry('cyclic.pdf').rootCount!
    scene.expect('fixture bytes match the committed generator manifest', () => {
      assert.equal(cyclic.sha256, cyclic.manifest.sha256)
      assert.equal(cyclic.bytes, cyclic.manifest.bytes)
    })
    scene.expect('the fixture really contains the 2 -> 6 -> 2 cycle', () => {
      assert.deepEqual(cyclic.manifest.cycle, ['2 0 R', '6 0 R', '2 0 R'])
      const text = readFileSync(cyclic.path).toString('latin1')
      assert.ok(text.includes('/Type /Pages /Kids [3 0 R 6 0 R] /Count 4'))
      assert.ok(text.includes('/Type /Pages /Parent 2 0 R /Kids [3 0 R 2 0 R 7 0 R] /Count 3'))
    })

    // Observed on the pinned tool: pypdf's page-tree flattening raises instead of
    // recursing; pdfium instead trusts the root /Count and stops after that many
    // pages. Both terminate — the process neither spins nor blows the stack.
    const infoStep = await scene.step('info cyclic.pdf', toolArgv(['info', cyclic.path]))
    scene.expect('info terminates with exit 1, no signal, no timeout', () => {
      assert.equal(infoStep.exitCode, 1, `expected exit 1, got ${infoStep.exitCode} (signal ${infoStep.signal})`)
      assert.equal(infoStep.signal, null)
      assert.equal(infoStep.timedOut, false)
      assert.ok(infoStep.exitCode! <= 1, 'a process exit code above 1 is an abnormal crash')
    })
    scene.expect(`info is bounded (${ms(infoStep.elapsedMs)} < ${ms(BOUND_MS)})`, () => {
      assert.ok(infoStep.elapsedMs < BOUND_MS)
    })
    scene.expect('info fails with the bounded cyclic-page error, not a stack overflow', () => {
      assert.equal(normalize(infoStep.stdout), '')
      assert.deepEqual(errorLines(infoStep), ['Error: Detected cyclic page references.'])
      assert.ok(!infoStep.stderr.includes('Traceback (most recent call last)'))
      assert.ok(!/RecursionError|maximum recursion depth/i.test(infoStep.stderr))
    })

    const extractStep = await scene.step('extract cyclic.pdf', toolArgv(['extract', cyclic.path]))
    scene.expect('extract terminates with exit 0, no signal, no timeout', () => {
      assert.equal(extractStep.exitCode, 0, `exit ${extractStep.exitCode} (signal ${extractStep.signal}), stderr: ${extractStep.stderr}`)
      assert.equal(extractStep.signal, null)
      assert.equal(extractStep.timedOut, false)
      assert.ok(extractStep.exitCode! <= 1)
    })
    scene.expect(`extract is bounded (${ms(extractStep.elapsedMs)} < ${ms(BOUND_MS)})`, () => {
      assert.ok(extractStep.elapsedMs < BOUND_MS)
    })
    const sections = pageSections(extractStep.stdout)
    scene.expect('extract returns a bounded, contiguous page count — never an endless walk', () => {
      assert.ok(sections.length > 0, 'extract returned no pages at all')
      assert.equal(sections.length, rootCount, 'pdfium follows the root /Count for a cyclic tree')
      assert.ok(sections.length <= 32, `page count ${sections.length} is not bounded`)
      assert.deepEqual(sections.map(section => section.page), Array.from({ length: sections.length }, (_, index) => index + 1))
    })
    scene.expect('every returned page resolves to the shared, twice-referenced page', () => {
      for (const section of sections) assert.ok(section.body.includes(markers[0]!), `page ${section.page} did not render the shared page content`)
    })
    scene.expect('extract never reaches the page behind the cycle', () => {
      assert.ok(!extractStep.stdout.includes(markers[1]!), 'the traversal escaped the cycle')
    })
    scene.expect('the cyclic fixture was not modified', () => assert.equal(sha256(cyclic.path), cyclic.manifest.sha256))
    scene.expect('no temp files were left behind', () => assert.deepEqual(scene.tempLeftovers(), []))

    const probeFile = join(scene.cwd, 'pypdf-probe.py')
    writeFileSync(probeFile, LIBRARY_PROBE)
    const probeStep = await scene.step('pypdf probe cyclic.pdf', probeArgv(probeFile, cyclic.path))
    const probe = (() => { try { return JSON.parse(probeStep.stdout) as { outcome: string; class?: string; message?: string } } catch { return undefined } })()
    scene.expect('info\'s error line is pypdf\'s own PdfReadError message', () => {
      assert.equal(probeStep.exitCode, 0, `probe exit ${probeStep.exitCode}: ${probeStep.stderr}`)
      assert.equal(probe?.outcome, 'error')
      assert.equal(probe?.class, 'pypdf.errors.PdfReadError')
      assert.equal(`Error: ${probe?.message}`, errorLines(infoStep)[0])
    })
    scene.expect('the pypdf probe itself is bounded too', () => assert.ok(probeStep.elapsedMs < BOUND_MS))

    scene.observations.outcomes = {
      info: { exitCode: infoStep.exitCode, stderr: normalize(infoStep.stderr), elapsedMs: infoStep.elapsedMs, kind: 'bounded error' },
      extract: { exitCode: extractStep.exitCode, pages: sections.length, elapsedMs: extractStep.elapsedMs, kind: 'bounded page count' },
    }
    scene.observations.pypdfException = { class: probe?.class, message: probe?.message }
    scene.observations.sharedPageMarker = markers[0]
    scene.observations.unreachedMarker = markers[1]
    scene.observations.rootCount = rootCount
  })

  scene('PDF-06', 'real rendering and repeated calls release native PDF resources', async scene => {
    const normal = scene.useFixture(fixture('normal.pdf'))
    const output = join(scene.cwd, 'rendered')
    const rendered = await scene.step('to-image normal.pdf --pages 2 --dpi 72', toolArgv(['to-image', normal.path, '--pages', '2', '--dpi', '72', '-o', output]))
    scene.expect('the actual CLI renders the selected page successfully', () => assert.equal(rendered.exitCode, 0, rendered.stderr))
    const sharp = (await import('sharp')).default
    const image = join(output, 'page_2.png')
    const metadata = await sharp(image).metadata()
    scene.expect('rendered PNG has the original page dimensions at 72 DPI', () => {
      assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 612); assert.equal(metadata.height, 792)
      assert.deepEqual(readdirSync(output), ['page_2.png'])
    })
    scene.observations.rendered = { sha256: sha256(image), width: metadata.width, height: metadata.height }
    const pixels = await sharp(image).stats()
    scene.expect('the page contains rendered content rather than a blank bitmap', () => assert(pixels.channels.some(channel => channel.stdev > 1)))
    const probeFile = join(scene.cwd, 'resource-probe.py')
    writeFileSync(probeFile, `# /// script
# dependencies = ["pypdf==6.21.1", "pypdfium2==5.14.0", "click==8.5.0", "Pillow==12.3.0"]
# ///
import importlib.util, json, sys
from click.testing import CliRunner
import pypdfium2 as pdfium
objects = []
for cls in [pdfium.PdfDocument, pdfium.PdfPage, pdfium.PdfTextPage, pdfium.PdfBitmap]:
    original = cls.__init__
    def tracked(self, *args, _original=original, **kwargs):
        _original(self, *args, **kwargs)
        objects.append(self)
    cls.__init__ = tracked
spec = importlib.util.spec_from_file_location("pdf_tool", ${JSON.stringify(toolScript)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
runner = CliRunner()
for i in range(3):
    for args in [["extract", sys.argv[1]], ["to-image", sys.argv[1], "--pages", "1", "--dpi", "72", "-o", "probe-output"], ["to-image", sys.argv[1], "--pages", "999", "-o", "invalid-output"]]:
        result = runner.invoke(module.cli, args)
        assert result.exit_code == (1 if "999" in args else 0), result.output
        leaked = [type(item).__name__ for item in objects if item.raw is not None]
        assert not leaked, f"Native resources remain open after {args[0]}: {leaked}"
print(json.dumps({"calls": 9, "objects": len(objects), "all_closed": True}))
`)
    const environment = await scene.step('locate the tool script environment', [uv, 'python', 'find', '--script', toolScript])
    assert.equal(environment.exitCode, 0, environment.stderr)
    const probe = await scene.step('repeat real CLI callbacks and inspect native handles', [environment.stdout.trim(), probeFile, normal.path])
    scene.expect('success and exception paths close every document/page/text/bitmap handle', () => {
      assert.equal(probe.exitCode, 0, probe.stderr)
      const report = JSON.parse(probe.stdout)
      assert.equal(report.calls, 9); assert.equal(report.all_closed, true); assert(report.objects > 12)
      scene.observations.resources = report
    })
  })

  const failures: string[] = []
  for (const { scene, body } of scenes) {
    try {
      await body(scene)
    } catch (error) {
      scene.error = error instanceof Error ? error.message : String(error)
    }
    if (!scene.error && scene.failed.length) {
      scene.error = `${scene.failed.length} assertion(s) failed: ${scene.failed.map(assertion => `${assertion.name} — ${assertion.detail}`).join('; ')}`
    }
    const record = {
      scene: scene.id, title: scene.title, status: scene.status, fixture: scene.subject,
      fixtureSandbox: { cwd: relative(run.directory, scene.cwd).replaceAll('\\', '/'), tmp: relative(run.directory, scene.tmp).replaceAll('\\', '/') },
      steps: scene.steps, assertions: scene.assertions, observations: scene.observations,
      error: scene.error,
    }
    run.json(EVIDENCE_FILE[scene.id]!, record)
    summaries.push(record)
    if (scene.status === 'passed') sceneIds.push(scene.id)
    else failures.push(`${scene.id}: ${scene.error}`)
  }

  // Every fixture must still hash to what the generator produced.
  const fixtureChecks = Object.keys(fixtures).map(name => ({
    name, expected: fixtures[name]!.sha256, actual: sha256(join(fixturesDir, name)),
  }))

  run.json('summary.json', {
    schemaVersion: 1,
    workflow: 'upgrade-0153-pdf',
    passed: sceneIds.length,
    failed: failures,
    scenes: summaries.map(summary => ({ scene: summary.scene, title: summary.title, status: summary.status, steps: (summary.steps as Step[]).length })),
    tool: {
      script: relative(root, toolScript).replaceAll('\\', '/'),
      python: toolPython,
      argvPrefix: [uv, 'run', '--python', toolPython, '--quiet', relative(root, toolScript).replaceAll('\\', '/')],
      commandTemplate: 'uv run --python 3.12.15 --quiet apps/electron/resources/scripts/pdf_tool.py COMMAND [OPTIONS]',
    },
    runtime: { uv, uvVersion, uvSha256 },
    fixtures: {
      dir: relative(root, fixturesDir).replaceAll('\\', '/'),
      generator: fixtureGenerator,
      manifest: relative(root, join(fixturesDir, 'manifest.json')).replaceAll('\\', '/'),
      files: fixtureChecks,
    },
    bounds: { acceptanceMs: BOUND_MS, hardTimeoutMs: HARD_TIMEOUT_MS, redirectsTemp: true },
    untested,
  })

  if (sceneIds.length) run.complete(sceneIds, untested)
  if (failures.length) throw new Error(`${failures.length} scene(s) failed: ${failures.join(' | ')}`)
  if (!sceneIds.length) throw new Error('No scene executed')
} catch (error) {
  failure = error
}

try {
  run.finish(failure)
} finally {
  console.log(JSON.stringify({ passed: sceneIds.length, output: run.directory }))
}
