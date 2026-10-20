/**
 * Fixture bundle host (Node) — builds one verification fixture page with the
 * app's own Vite config and writes the result to a directory.
 *
 * Why a build and not a dev server: driving a Vite dev server from the same Bun
 * process as Playwright deadlocks here (the dependency scan never finishes while
 * the driver owns the event loop), and hosting the dev server in a child process
 * does not answer requests either. A one-shot build runs in its own process with
 * no browser in it, and the workflow then serves plain files.
 *
 * Usage: node scripts/verification/fixture-bundle-host.mjs <runDir> <entryFile.tsx>
 * Prints one JSON line: {"dir":"<runDir>/bundle"}
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const [runDirectory, entryFile] = process.argv.slice(2)
if (!runDirectory || !entryFile) {
  console.error('usage: fixture-bundle-host.mjs <runDir> <entryFile.tsx>')
  process.exit(2)
}
const root = resolve(here, '../..')
const outDir = join(resolve(runDirectory), 'bundle')
mkdirSync(outDir, { recursive: true })
const page = join(resolve(runDirectory), 'index.html')
writeFileSync(page,
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/${entryFile.replaceAll('\\', '/')}"></script></body></html>`)

await build({
  configFile: resolve(root, 'apps/electron/vite.config.ts'),
  root,
  base: './',
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    // The fixture page is a single entry; the app's chunking/asset limits do not
    // apply to it and must not fail the build.
    chunkSizeWarningLimit: 100_000,
    rollupOptions: { input: page, output: { entryFileNames: 'fixture.js', chunkFileNames: 'chunk-[name].js', assetFileNames: '[name][extname]' } },
  },
})
/** Vite emits an HTML entry at its path relative to the project root, so the
 *  emitted page can sit several directories deep inside the output directory. */
function findHtml(directory, depth = 0) {
  if (depth > 6) return undefined
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isFile() && entry.name.endsWith('.html')) return full
    if (entry.isDirectory()) {
      const found = findHtml(full, depth + 1)
      if (found) return found
    }
  }
  return undefined
}
const html = findHtml(outDir)
if (!html) {
  console.error(`fixture build produced no html under ${outDir}`)
  process.exit(3)
}
console.log(JSON.stringify({ dir: outDir, html }))
process.exit(0)
