/**
 * Trace where every imported Lucide component is actually used.
 * For each component: the files that import it and the lines that render it,
 * so "same meaning, different glyph" claims can be checked against real code.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ASSETS = new URL('../assets/', import.meta.url)
const ROOTS = ['apps', 'packages']

const usage = new Map() // component -> [{ file, line, snippet, kind }]
let filesWithImport = 0

const IMPORT_RE = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]lucide-react['"]/gs

function cleanComponent(raw) {
  let name = raw.trim().replace(/^type\s+/, '')
  if (!name) return null
  if (/\bas\b/.test(name)) name = name.split(/\bas\b/)[0].trim()
  return /^[A-Za-z0-9_]+$/.test(name) ? name : null
}

async function walk(dir, relative) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git', 'release', '.cache'].includes(entry.name)) continue
    const childPath = join(dir, entry.name)
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walk(childPath, childRelative)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    const source = await readFile(childPath, 'utf8').catch(() => '')
    if (!source.includes('lucide-react')) continue

    const imported = new Set()
    const importRanges = []
    for (const match of source.matchAll(IMPORT_RE)) {
      importRanges.push([match.index, match.index + match[0].length])
      for (const raw of match[1].split(',')) {
        const name = cleanComponent(raw)
        if (name) imported.add(name)
      }
    }
    if (!imported.size) continue
    filesWithImport++

    const lines = source.split('\n')
    const lineStarts = []
    let offset = 0
    for (const line of lines) {
      lineStarts.push(offset)
      offset += line.length + 1
    }
    const inImportBlock = (index) => importRanges.some(([start, end]) => index >= start && index <= end)

    for (const component of imported) {
      if (component === 'LucideIcon') continue
      const re = new RegExp(`\\b${component}\\b`, 'g')
      let match
      while ((match = re.exec(source))) {
        if (inImportBlock(match.index)) continue
        let lineIndex = 0
        while (lineIndex + 1 < lineStarts.length && lineStarts[lineIndex + 1] <= match.index) lineIndex++
        const line = lines[lineIndex].trim()
        if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
        if (!usage.has(component)) usage.set(component, [])
        const sites = usage.get(component)
        const snippet = line.length > 150 ? line.slice(0, 147) + '…' : line
        if (!sites.some((s) => s.file === childRelative && s.line === lineIndex + 1)) {
          sites.push({ file: childRelative, line: lineIndex + 1, snippet })
        }
        break // one site per line is enough
      }
    }
  }
}

for (const root of ROOTS) await walk(join(ROOT, root), root)

const sites = Object.fromEntries([...usage.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])))
const payload = {
  filesWithImport,
  components: Object.keys(sites).length,
  totalSites: Object.values(sites).reduce((n, list) => n + list.length, 0),
  sites,
}
await writeFile(new URL('usage-sites.json', ASSETS), JSON.stringify(payload, null, 2))
console.log(JSON.stringify({ filesWithImport, components: payload.components, totalSites: payload.totalSites }, null, 2))
