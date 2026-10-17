// Audit the current Lucide usage: how many distinct glyphs hide behind the
// imported component names, and where one purpose carries several glyphs.
import { readFile, writeFile } from 'node:fs/promises'
import { purposes, groups } from './purposes.mjs'

const ASSETS = new URL('../assets/', import.meta.url)
const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))

const catalog = await readJson('lucide-catalog.json')
const survey = await readJson('lucide-usage.json')

const kebab = (name) => name
  .replace(/Icon$/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .replace(/([A-Za-z])([0-9])/g, '$1-$2')
  .toLowerCase()

const countOf = (component) => survey.components[component] ?? 0
const canonicalOf = (component) => {
  const key = kebab(component)
  return catalog.aliases[key] ?? (catalog.canonical[key] ? key : null)
}

const glyphUse = new Map() // canonical glyph -> { components: [], count, purposes: Set }
const audit = []

for (const purpose of purposes) {
  const glyphs = new Map()
  for (const component of purpose.lucide) {
    const glyph = canonicalOf(component)
    if (!glyph) continue
    if (!glyphs.has(glyph)) glyphs.set(glyph, { glyph, count: 0, components: [], aliases: [] })
    const entry = glyphs.get(glyph)
    entry.count += countOf(component)
    entry.components.push(component)
    if (kebab(component) !== glyph) entry.aliases.push(component)
    if (!glyphUse.has(glyph)) glyphUse.set(glyph, { glyph, components: [], count: 0, purposes: new Set() })
    const shared = glyphUse.get(glyph)
    shared.components.push(component)
    shared.count += countOf(component)
    shared.purposes.add(purpose.id)
  }
  const list = [...glyphs.values()].sort((a, b) => b.count - a.count || a.glyph.localeCompare(b.glyph))
  audit.push({
    id: purpose.id,
    group: purpose.group,
    label: purpose.label,
    current: purpose.current,
    note: purpose.note,
    totalImports: list.reduce((sum, entry) => sum + entry.count, 0),
    glyphs: list,
    distinctGlyphs: list.length,
  })
}

const aliasRenames = []
for (const purpose of purposes) {
  for (const component of purpose.lucide) {
    const key = kebab(component)
    if (catalog.aliases[key]) aliasRenames.push({ component, canonical: catalog.aliases[key], purpose: purpose.id, count: countOf(component) })
  }
}

const overlapping = [...glyphUse.values()].filter((entry) => entry.purposes.size > 1)
  .map((entry) => ({ glyph: entry.glyph, purposes: [...entry.purposes], components: entry.components, count: entry.count }))
  .sort((a, b) => b.count - a.count)

const payload = {
  generatedFrom: 'tools/purposes.mjs + assets/lucide-usage.json + assets/lucide-catalog.json',
  totals: {
    components: purposes.reduce((n, p) => n + p.lucide.length, 0),
    distinctGlyphs: glyphUse.size,
    aliasRenames: aliasRenames.length,
    purposes: purposes.length,
    conflictingPurposes: audit.filter((p) => p.distinctGlyphs > 1).length,
    catalogCanonical: Object.keys(catalog.canonical).length,
    catalogAliases: Object.keys(catalog.aliases).length,
  },
  purposes: audit,
  aliasRenames: aliasRenames.sort((a, b) => b.count - a.count || a.component.localeCompare(b.component)),
  overlapping,
}

await writeFile(new URL('audit.json', ASSETS), JSON.stringify(payload, null, 2))

console.log(JSON.stringify(payload.totals, null, 2))
console.log('\n一个用途里有多于一个不同图形的：')
for (const purpose of audit.filter((p) => p.distinctGlyphs > 1).sort((a, b) => b.distinctGlyphs - a.distinctGlyphs)) {
  console.log(`  ${purpose.label} (${purpose.id}) ${purpose.distinctGlyphs} 个图形: ` +
    purpose.glyphs.map((g) => `${g.glyph}×${g.count}${g.aliases.length ? '(旧名 ' + g.aliases.join(',') + ')' : ''}`).join(' | '))
}
console.log('\n同一个图形被多个用途引用的：')
for (const entry of overlapping) console.log(`  ${entry.glyph} → ${entry.purposes.join(', ')}`)
