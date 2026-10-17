// Search the local lucide catalogue by name, for choosing replacement glyphs.
import { readFile } from 'node:fs/promises'

const ASSETS = new URL('../assets/', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('lucide-catalog.json', ASSETS), 'utf8'))
const names = Object.keys(catalog.canonical).sort()

const patterns = process.argv.slice(2)
if (!patterns.length) {
  console.log(`catalogue: ${names.length} canonical icons`)
  process.exit(0)
}

const columns = (list, perLine = 6) => {
  const width = Math.max(0, ...list.map((n) => n.length)) + 1
  const lines = []
  for (let i = 0; i < list.length; i += perLine) {
    lines.push(list.slice(i, i + perLine).map((n) => n.padEnd(width)).join('').trimEnd())
  }
  return lines.join('\n')
}

for (const pattern of patterns) {
  const re = new RegExp(pattern, 'i')
  const hits = names.filter((name) => re.test(name))
  console.log(`\n### ${pattern} (${hits.length})`)
  console.log(columns(hits.slice(0, 120)))
}
