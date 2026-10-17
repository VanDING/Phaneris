/**
 * Classify every usage site by area, then recompute the conflict picture.
 * A glyph only counts as a real conflict when it is actually rendered in
 * production UI; playground/demo code and central icon tables do not count.
 */
import { readFile, writeFile } from 'node:fs/promises'

const ASSETS = new URL('../assets/', import.meta.url)
const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))
const writeJson = async (name, data) => writeFile(new URL(name, ASSETS), JSON.stringify(data, null, 2))

const usage = await readJson('usage-sites.json')
const plan = await readJson('plan.json')

/** Icon tables map names to components; they render nothing by themselves. */
const ICON_TABLES = [/menu-icons\.ts$/, /SettingsIcons\.tsx$/, /icons\/index\.ts$/, /icon-map/i]
const PLAYGROUND = [/\/playground\//, /\/demos\//, /fixtures?\//, /audit-fixture/, /\/registry\//, /scripts\//, /docs\/verification\//]

function areaOf(file) {
  if (ICON_TABLES.some((re) => re.test(file))) return 'iconTable'
  if (PLAYGROUND.some((re) => re.test(file))) return 'playground'
  return 'production'
}

const byComponent = {}
const annotated = {}
for (const [component, sites] of Object.entries(usage.sites)) {
  const counts = { production: 0, playground: 0, iconTable: 0 }
  annotated[component] = sites.map((site) => {
    const area = areaOf(site.file)
    counts[area]++
    return { ...site, area }
  })
  byComponent[component] = counts
}

const purposes = plan.purposes.map((purpose) => {
  if (purpose.action === 'external') return purpose
  const glyphs = purpose.glyphs.map((glyph) => {
    const sites = glyph.components.flatMap((component) => (annotated[component] ?? []).map((s) => ({ ...s, component })))
    const counts = { production: 0, playground: 0, iconTable: 0 }
    const files = new Set()
    for (const site of sites) {
      counts[site.area]++
      if (site.area === 'production') files.add(site.file)
    }
    return { glyph: glyph.glyph, count: glyph.count, components: glyph.components, aliases: glyph.aliases, sites: sites.length, counts, productionFiles: [...files] }
  })
  // Real conflicts: two or more glyphs actually rendered in production UI.
  const productionGlyphs = glyphs.filter((g) => g.counts.production > 0)
  const onlyPlayground = glyphs.filter((g) => g.counts.production === 0 && g.counts.playground > 0)
  const onlyIconTable = glyphs.filter((g) => g.counts.production === 0 && g.counts.playground === 0 && g.counts.iconTable > 0)

  // Files where several glyphs of this purpose are rendered in production.
  const fileMap = new Map()
  for (const glyph of productionGlyphs) {
    for (const file of glyph.productionFiles) {
      if (!fileMap.has(file)) fileMap.set(file, [])
      fileMap.get(file).push(glyph.glyph)
    }
  }
  const sharedFiles = [...fileMap.entries()].filter(([, list]) => list.length > 1).map(([file, list]) => ({ file, glyphs: list }))

  return { ...purpose, glyphs: purpose.glyphs.map((g) => ({ ...g, ...glyphs.find((x) => x.glyph === g.glyph) })), productionGlyphs: productionGlyphs.length, onlyPlayground: onlyPlayground.map((g) => g.glyph), onlyIconTable: onlyIconTable.map((g) => g.glyph), sharedFiles }
})

const summary = {
  purposes: purposes.length,
  conflictingByGrouping: purposes.filter((p) => p.distinctGlyphs > 1).length,
  conflictingInProduction: purposes.filter((p) => p.productionGlyphs > 1).length,
  singleGlyphInProduction: purposes.filter((p) => p.productionGlyphs === 1).length,
  noProductionUse: purposes.filter((p) => p.productionGlyphs === 0).length,
  glyphsOnlyInPlayground: new Set(purposes.flatMap((p) => p.onlyPlayground ?? [])).size,
  glyphsOnlyInIconTable: new Set(purposes.flatMap((p) => p.onlyIconTable ?? [])).size,
}

await writeJson('usage-classified.json', { summary, purposes })
await writeJson('usage-annotated.json', { ...usage, sites: annotated })
console.log(JSON.stringify(summary, null, 2))

console.log('\n生产代码里仍有多个图形的用途：')
for (const purpose of purposes.filter((p) => p.productionGlyphs > 1).sort((a, b) => b.productionGlyphs - a.productionGlyphs)) {
  const list = purpose.glyphs
    .filter((g) => g.counts.production > 0)
    .map((g) => `${g.glyph}(生产${g.counts.production}${g.counts.playground ? '/演示' + g.counts.playground : ''}${g.counts.iconTable ? '/表' + g.counts.iconTable : ''})`)
    .join(' | ')
  console.log(`  ${purpose.label}(${purpose.id}) ${purpose.productionGlyphs} 个: ${list}`)
}

console.log('\n只在演示代码里出现的图形（生产未使用）：')
for (const purpose of purposes.filter((p) => (p.onlyPlayground ?? []).length)) {
  console.log(`  ${purpose.label}: ${purpose.onlyPlayground.join(', ')}`)
}
