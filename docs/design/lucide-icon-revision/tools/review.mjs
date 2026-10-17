/**
 * Print the usage evidence for one or more purposes, so "same meaning,
 * different glyph" can be judged from real call sites instead of assumption.
 */
import { readFile } from 'node:fs/promises'

const ASSETS = new URL('../assets/', import.meta.url)
const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))

const usage = await readJson('usage-annotated.json').catch(() => readJson('usage-sites.json'))
const plan = await readJson('plan.json')

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const brief = process.argv.includes('--brief')
const onlyProduction = process.argv.includes('--production')
const purposes = plan.purposes.filter((p) => (wanted.length ? wanted.includes(p.id) : p.distinctGlyphs > 1))

const shorten = (path) => path
  .replace(/^apps\//, '')
  .replace(/^packages\//, '')
  .replace('electron/src/renderer/', '')

const basename = (path) => path.split('/').pop()

/** Pull the i18n keys / labels out of a snippet to name the action. */
function labelsOf(snippet) {
  const keys = [...snippet.matchAll(/t\(\s*'([^']+)'/g)].map((m) => m[1])
  const literals = [...snippet.matchAll(/(?:label|title|aria-label)="([^"]{2,24})"/g)].map((m) => m[1])
  return [...keys, ...literals].slice(0, 2).join(' ')
}

if (brief) {
  for (const purpose of purposes) {
    const conflicts = purpose.glyphs.filter((g) => (onlyProduction ? (g.counts?.production ?? 0) > 0 : true))
    if (!onlyProduction && conflicts.length < 2) continue
    console.log(`\n${purpose.label} (${purpose.id})  建议=${purpose.recommended} [${purpose.action}]`)
    for (const glyph of conflicts) {
      const sites = glyph.components.flatMap((component) => (usage.sites[component] ?? []).map((s) => ({ ...s, component })))
      const prod = sites.filter((s) => s.area === 'production')
      const demo = sites.length - prod.length
      const files = prod.map((s) => `${basename(s.file)}${labelsOf(s.snippet) ? '→' + labelsOf(s.snippet) : ''}`)
      const uniq = [...new Set(files)]
      console.log(`   ${glyph.glyph === purpose.recommended ? '*' : ' '} ${glyph.glyph.padEnd(28)} 生产${String(prod.length).padStart(2)}${demo ? '/其他' + demo : '  '}  ${uniq.slice(0, 5).join(' · ')}${uniq.length > 5 ? ' …+' + (uniq.length - 5) : ''}`)
    }
  }
} else {
  for (const purpose of purposes) {
    console.log(`\n########## ${purpose.label} (${purpose.id}) — ${purpose.distinctGlyphs} 个图形 / ${purpose.totalImports} 次导入`)
    console.log(`建议：${purpose.recommended}（${purpose.action}）`)
    const filesByGlyph = new Map()
    for (const glyph of purpose.glyphs) {
      const components = glyph.components
      const sites = components.flatMap((component) => (usage.sites[component] ?? []).map((s) => ({ ...s, component })))
      const files = new Set(sites.map((s) => s.file))
      filesByGlyph.set(glyph.glyph, files)
      console.log(`\n  [${glyph.glyph}]${glyph.glyph === purpose.recommended ? '  ← 建议' : ''}  组件 ${components.join(', ')}  导入 ${glyph.count} 次  调用点 ${sites.length} 处  文件 ${files.size} 个`)
      for (const site of sites.slice(0, 6)) {
        console.log(`    ${shorten(site.file)}:${site.line}  ${site.snippet}`)
      }
      if (sites.length > 6) console.log(`    …另有 ${sites.length - 6} 处`)
    }
    // Files shared by several glyphs of this purpose = same place, different icon.
    const seen = new Map()
    for (const [glyph, files] of filesByGlyph) {
      for (const file of files) {
        if (!seen.has(file)) seen.set(file, [])
        seen.get(file).push(glyph)
      }
    }
    const shared = [...seen.entries()].filter(([, glyphs]) => glyphs.length > 1)
    if (shared.length) {
      console.log('\n  同一个文件里出现多个图形（同处不同图标）：')
      for (const [file, glyphs] of shared) console.log(`    ${shorten(file)}  ← ${glyphs.join(', ')}`)
    }
  }
}
