// Dump the real lucide-react import survey to JSON so the build can verify that
// every component in the app is accounted for by the semantic mapping.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('../../../../', import.meta.url) // docs/design/icon-family-demo/tools -> repo root
const roots = ['apps', 'packages'].map((r) => new URL(r + '/', ROOT))

const usage = new Map()
const perFile = new Map()
let filesWithImport = 0

async function walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'release') continue
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) {
      await walk(child)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    const source = await readFile(child, 'utf8').catch(() => '')
    if (!source.includes('lucide-react')) continue
    const matches = source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]lucide-react['"]/gs)
    let touched = false
    for (const match of matches) {
      for (const raw of match[1].split(',')) {
        let name = raw.trim().replace(/^type\s+/, '')
        if (!name) continue
        if (/\bas\b/.test(name)) name = name.split(/\bas\b/)[0].trim()
        if (!/^[A-Za-z0-9_]+$/.test(name)) continue
        usage.set(name, (usage.get(name) ?? 0) + 1)
        touched = true
      }
    }
    if (touched) {
      filesWithImport++
      perFile.set(decodeURIComponent(child.pathname).replace(/^\//, ''), [...source.matchAll(/from\s*['"]lucide-react['"]/g)].length)
    }
  }
}

for (const root of roots) await walk(root)

const sorted = [...usage.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
const payload = {
  generatedFrom: 'apps/*, packages/* (ts/tsx)',
  filesWithLucideImport: filesWithImport,
  distinctComponents: sorted.length,
  totalNamedImports: sorted.reduce((sum, [, count]) => sum + count, 0),
  components: Object.fromEntries(sorted),
}
const out = new URL('./assets/lucide-usage.json', import.meta.url)
await writeFile(out, JSON.stringify(payload, null, 2))
console.log(JSON.stringify({ filesWithLucideImport: filesWithImport, distinctComponents: sorted.length, totalNamedImports: payload.totalNamedImports }))
