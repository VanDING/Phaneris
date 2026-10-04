/** Browser workflow for the real production editor: text, undo, fallback, source preservation. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as artifacts from '../../packages/shared/src/artifacts/index.ts'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { COMPLEX_MARKDOWN } from './fixtures/markdown-corpus'
const root = resolve(import.meta.dir, '../..'), output = resolve(root, '.cache/capability-integration')
const fixture = mkdtempSync(resolve(tmpdir(), 'phaneris-artifact-browser-'))
const scope = { workspaceRootPath: fixture, workspaceId: 'fixture' }
const operations: any[] = []
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, 'editor.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/markdown-artifact-editor.tsx"></script></body></html>')
const fixtureHandler = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk
    const { method, args = [] } = JSON.parse(body)
    let result: unknown
    switch (method) {
      case 'create': {
        const sourcePath = resolve(fixture, `${args[0]}.md`)
        writeFileSync(sourcePath, args[0] === 'mixed' ? COMPLEX_MARKDOWN : '# Fixture\n\nOriginal **bold** text.\n')
        result = artifacts.createArtifactDraft(scope, { sessionId: 'fixture', kind: 'text', sourcePath }); break
      }
      case 'list': result = artifacts.listArtifacts(scope); break
      case 'get': result = artifacts.getArtifact(scope, args[0]); break
      case 'acquire': result = artifacts.acquireArtifactLease(scope, args[0], 'user'); break
      case 'release': result = artifacts.releaseArtifactLease(scope, args[0], args[1]); break
      case 'apply': result = artifacts.applyArtifactDraft(scope, args[0], args[1]); break
      case 'submit': result = artifacts.submitArtifact(scope, args[0], { expectedRevision: args[1], leaseId: args[2] }); break
      case 'accept': result = artifacts.acceptArtifact(scope, args[0]); break
      case 'read': {
        const path = resolve(args[0]); assert(path.startsWith(fixture + '\\') || path.startsWith(fixture + '/'))
        result = readFileSync(path, 'utf8'); break
      }
      case 'external-checkout': {
        const artifact = artifacts.getArtifact(scope, args[0]); writeFileSync(artifact.editablePath!, 'External checkout edit'); result = true; break
      }
      case 'external-source': {
        const artifact = artifacts.getArtifact(scope, args[0]); writeFileSync(artifact.artifact.sourcePath, 'External source edit'); result = true; break
      }
      default: throw new Error(`Unknown fixture method ${method}`)
    }
    operations.push({ method, pass: true }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result }))
  } catch (error) { res.statusCode = 409; res.end(JSON.stringify({ error: String(error) })) }
}
const server = await createServer({ configFile: resolve(root, 'apps/electron/vite.config.ts'), root,
  plugins: [{ name: 'artifact-fixture', configureServer(server) { server.middlewares.use('/__artifact-fixture', fixtureHandler) } }],
  server: { host: '127.0.0.1', port: 5198, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) })
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const records: any[] = [], errors: string[] = []
page.on('pageerror', e => errors.push(e.message))
async function check(id: string, fn: () => Promise<void>) {
  try { await fn(); records.push({ id, pass: true }) } catch (e) { records.push({ id, pass: false, error: String(e) }) }
}
try {
  await page.goto('http://127.0.0.1:5198/.cache/capability-integration/editor.html', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await check('Visual editing changes the controlled document and undo restores it', async () => {
    const editable = page.locator('.tiptap[contenteditable="true"]')
    await editable.waitFor({ timeout: 90000 }); await editable.click(); await page.keyboard.press('Control+End')
    await page.keyboard.type(' Added')
    assert((await page.locator('#output').innerText()).includes('Added'))
    await page.keyboard.press('Control+z')
    assert(!(await page.locator('#output').innerText()).includes('Added'))
  })
  await check('Complex markdown switches to source while preserving comments and tables', async () => {
    await page.locator('#complex').click()
    const source = page.locator('[data-testid="artifact-source-editor"]')
    await source.waitFor(); assert((await source.inputValue()).includes('<!-- preserve comment -->'))
    assert((await source.inputValue()).includes('| 1 | 2 |'))
    assert((await page.locator('#output').innerText()).includes('<!-- preserve comment -->'))
  })
  await check('Real workbench saves Chinese text, submits the immutable revision and explicitly accepts it', async () => {
    await page.locator('#workbench').click()
    await page.locator('[data-testid="artifact-edit"]').click()
    const editable = page.locator('.tiptap[contenteditable="true"]')
    await editable.waitFor({ timeout: 90000 }); await editable.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' 中文草稿')
    await page.locator('[data-testid="artifact-save"]').click()
    await page.waitForFunction(() => !(document.querySelector('[data-testid="artifact-save"]') as HTMLButtonElement)?.disabled)
    const saved: any = await page.evaluate(async () => (window as any).artifactFixture('get', [(window as any).artifactId]))
    assert(readFileSync(saved.editablePath, 'utf8').includes('中文草稿'))
    assert(!readFileSync(saved.artifact.sourcePath, 'utf8').includes('中文草稿'))
    await page.locator('[data-testid="artifact-submit"]').click()
    await page.locator('[data-testid="artifact-accept"]').waitFor()
    const ready: any = await page.evaluate(async () => (window as any).artifactFixture('get', [(window as any).artifactId]))
    assert.equal(ready.artifact.status, 'ready'); assert.equal(ready.editablePath, null)
    await page.locator('[data-testid="artifact-accept"]').click()
    await page.getByText('accepted', { exact: true }).waitFor()
    assert(readFileSync(ready.artifact.sourcePath, 'utf8').includes('中文草稿'))
  })
  await check('Mixed formulas, Mermaid, tasks, links, images and comments survive the full revision flow', async () => {
    await page.locator('#mixed').click(); await page.getByText('mixed.md', { exact: true }).waitFor()
    await page.locator('[data-testid="artifact-edit"]').click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const source = page.locator('[data-testid="artifact-source-editor"]'); await source.waitFor()
    assert.equal(await source.inputValue(), COMPLEX_MARKDOWN)
    const updated = COMPLEX_MARKDOWN + '\n补充审阅记录。\n'
    await source.fill(updated); await page.locator('[data-testid="artifact-save"]').click()
    await page.waitForFunction(() => !(document.querySelector('[data-testid="artifact-save"]') as HTMLButtonElement)?.disabled)
    const saved: any = await page.evaluate(async () => (window as any).artifactFixture('get', [(window as any).artifactId]))
    assert.equal(readFileSync(saved.editablePath, 'utf8'), updated)
    await page.locator('[data-testid="artifact-submit"]').click(); await page.locator('[data-testid="artifact-accept"]').waitFor()
    await page.locator('[data-testid="artifact-accept"]').click(); await page.getByText('accepted', { exact: true }).waitFor()
    assert.equal(readFileSync(saved.artifact.sourcePath, 'utf8'), updated)
    writeFileSync(resolve(output, 'mixed-markdown-accepted.md'), updated)
  })
  await check('CAS save failure preserves the local draft; source conflict never overwrites external bytes', async () => {
    await page.locator('#conflict').click(); await page.getByText('conflict.md', { exact: true }).waitFor()
    await page.locator('[data-testid="artifact-edit"]').click()
    const editable = page.locator('.tiptap[contenteditable="true"]'); await editable.waitFor(); await editable.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' Local draft')
    await page.evaluate(async () => (window as any).artifactFixture('external-checkout', [(window as any).artifactId]))
    await page.locator('[data-testid="artifact-save"]').click(); await page.getByText(/Artifact revision conflict/).waitFor()
    assert((await editable.innerText()).includes('Local draft'))
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.locator('[data-testid="artifact-edit"]').click(); await page.locator('[data-testid="artifact-submit"]').click()
    await page.locator('[data-testid="artifact-accept"]').waitFor()
    await page.evaluate(async () => (window as any).artifactFixture('external-source', [(window as any).artifactId]))
    await page.locator('[data-testid="artifact-accept"]').click()
    await page.getByText('conflict', { exact: true }).waitFor()
    const conflicted: any = await page.evaluate(async () => (window as any).artifactFixture('get', [(window as any).artifactId]))
    assert.equal(readFileSync(conflicted.artifact.sourcePath, 'utf8'), 'External source edit')
    assert(existsSync(conflicted.activePath))
  })
  await page.screenshot({ path: resolve(output, 'markdown-editor.png'), fullPage: true })
} finally {
  await browser.close(); await server.close()
  writeFileSync(resolve(output, 'markdown-editor.json'), JSON.stringify({ fixture, records, errors, operations }, null, 2))
}
console.log(JSON.stringify({ output, records, errors })); process.exit(records.every(r => r.pass) && !errors.length ? 0 : 1)
