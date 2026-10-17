// Build a compact, readable name index for each family so the semantic mapping
// can be written against real icon names.
import { readFile, writeFile } from 'node:fs/promises'

const ASSETS = new URL('./assets/', import.meta.url)
const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))

const VARIANT = /(-transition|-loop|-twotone|-filled|-alt|-off|-outline|-sharp|-round)$/

function columns(names, perLine = 5) {
  const lines = []
  const width = Math.max(0, ...names.map((n) => n.length)) + 1
  for (let i = 0; i < names.length; i += perLine) {
    lines.push(names.slice(i, i + perLine).map((n) => n.padEnd(width)).join('').trimEnd())
  }
  return lines.join('\n')
}

const mode = process.argv[2] ?? 'index'
const query = process.argv.slice(3)

const sets = ['line-md', 'ci', 'mi', 'svg-spinners', 'vscode-icons', 'material-icon-theme']
const all = {}
for (const prefix of sets) {
  all[prefix] = Object.keys((await readJson(`icons-${prefix}.json`)).icons)
}

if (mode === 'index') {
  const out = []
  for (const prefix of sets) {
    const names = all[prefix].slice().sort()
    const base = names.filter((n) => !VARIANT.test(n))
    const variants = names.filter((n) => VARIANT.test(n))
    out.push(`### ${prefix}  total=${names.length} base=${base.length} variant=${variants.length}`)
    await writeFile(new URL(`names-${prefix}-base.txt`, ASSETS), columns(base, prefix === 'line-md' ? 6 : 5))
    await writeFile(new URL(`names-${prefix}-variant.txt`, ASSETS), columns(variants, 5))
    out.push(`--- ${prefix} base names ---`)
    out.push(columns(base, prefix === 'line-md' ? 6 : 5))
    if (variants.length) {
      out.push(`--- ${prefix} variant names (${variants.length}) ---`)
      out.push(columns(variants, 5))
    }
    out.push('')
  }
  const text = out.join('\n')
  await writeFile(new URL('name-index.txt', ASSETS), text)
  console.log(`written assets/name-index.txt (${text.length} bytes)`)
}

if (mode === 'find') {
  const scoped = sets.includes(query[0]) ? [query[0]] : sets
  const patterns = sets.includes(query[0]) ? query.slice(1) : query
  for (const prefix of scoped) {
    const hits = all[prefix].filter((n) => patterns.some((q) => new RegExp(q, 'i').test(n))).sort()
    console.log(`\n### ${prefix} (${hits.length})`)
    console.log(columns(hits.slice(0, 240), 5))
  }
}

if (mode === 'has') {
  for (const prefix of sets) {
    const found = query.filter((q) => all[prefix].includes(q))
    const missing = query.filter((q) => !all[prefix].includes(q))
    console.log(`\n### ${prefix}  found=${found.length}/${query.length}`)
    console.log('  found: ' + found.join(' '))
    console.log('  missing: ' + missing.join(' '))
  }
}
