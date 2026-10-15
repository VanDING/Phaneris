/** Real production controls: calendar, file tree, sidebar and session dropdown. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('ui-refinements', async run => {
  console.log(`UI verification artifacts: ${run.directory}`)
  const root = resolve(import.meta.dir, '../..')
  const prefix = '/' + run.directory.slice(root.length + 1).replaceAll('\\', '/')
  const assetFolder = join(root, 'apps/electron/dist/renderer/assets')
  const css = readdirSync(assetFolder).find(name => /^renderer-.*\.css$/.test(name))
  assert(css, 'Build the production renderer before running this workflow')
  run.json('production-css.json', { file: css, sha256: createHash('sha256').update(readFileSync(join(assetFolder, css))).digest('hex') })
  writeFileSync(join(run.directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/apps/electron/dist/renderer/assets/${css}"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/ui-refinements.tsx"></script></body></html>`)
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/ui-refinements.cjs'), JSON.stringify({
    root, prefix,
    output: run.directory, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
  })], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 600_000)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'browser.log'), stdout + stderr)
    assert.equal(code, 0, (stdout + stderr).slice(-6000))
    const report = JSON.parse(readFileSync(join(run.directory, 'ui-refinements.json'), 'utf8')) as { checks: string[] }
    const iconFolder = join(root, 'apps/electron/src/renderer/assets/file-icons')
    const svgs = readdirSync(iconFolder).filter(name => name.endsWith('.svg'))
    for (const file of svgs) assert(!/<script|<foreignObject|(?:href|url)\s*\(?\s*['"]?https?:/i.test(readFileSync(join(iconFolder, file), 'utf8')), file)
    run.complete([...report.checks, 'bundled-inert-svg-assets'], ['Signed installer and physical displays are outside this browser rendering workflow.'])
    console.log(stdout.trim())
  } finally { clearTimeout(timer) }
})
