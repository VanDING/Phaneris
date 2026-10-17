/**
 * Mapping validation shared by the CLI and the build.
 * Both checks return human-readable problem strings; an empty list means the
 * mapping only references icon names that really exist in the fetched sets.
 */
import { readFile } from 'node:fs/promises'
import { purposes, groups } from './mapping.mjs'
import { kinds, themes } from './files.mjs'

const ASSETS = new URL('./assets/', import.meta.url)
const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))

const FAMILIES = { a: 'line-md', b: 'ci', c: 'mi' }
const tokens = (name) => name.split(/[-_ ]|(?=[A-Z])/).map((t) => t.toLowerCase()).filter(Boolean)

function suggester(names) {
  return (name) => {
    const want = new Set(tokens(name))
    return [...names]
      .map((candidate) => {
        const have = new Set(tokens(candidate))
        let score = 0
        for (const token of want) if (have.has(token)) score += token.length
        if (candidate.startsWith(name)) score += 4
        return { candidate, score }
      })
      .filter((entry) => entry.score > 2)
      .sort((x, y) => y.score - x.score || x.candidate.localeCompare(y.candidate))
      .slice(0, 5)
      .map((entry) => entry.candidate)
  }
}

/** Every candidate icon name must exist; every Lucide component must be placed exactly once. */
export async function validateMapping() {
  const names = {}
  for (const [key, prefix] of Object.entries(FAMILIES)) {
    names[key] = new Set(Object.keys((await readJson(`icons-${prefix}.json`)).icons))
  }
  const spinnerNames = new Set(Object.keys((await readJson('icons-svg-spinners.json')).icons))
  const survey = await readJson('lucide-usage.json')
  const surveyed = new Set(Object.keys(survey.components).filter((n) => n !== 'LucideIcon'))

  const problems = []
  const placed = new Map()
  const quality = { a: {}, b: {}, c: {} }
  for (const key of ['a', 'b', 'c']) quality[key] = { native: 0, approx: 0, reuse: 0 }

  for (const purpose of purposes) {
    for (const component of purpose.lucide ?? []) {
      if (!surveyed.has(component)) problems.push(`${purpose.id}: “${component}” 不是本仓库实际导入的 Lucide 组件`)
      else if (placed.has(component)) problems.push(`${component} 被重复归入 ${placed.get(component)} 与 ${purpose.id}`)
      else placed.set(component, purpose.id)
    }
    if (purpose.spinner) {
      if (!spinnerNames.has(purpose.spinner.split(':')[1])) problems.push(`${purpose.id}: 找不到 ${purpose.spinner}`)
      continue
    }
    for (const family of ['a', 'b', 'c']) {
      const icon = purpose[family]
      if (!icon) {
        problems.push(`${purpose.id}: 缺少 ${family} 套图形`)
        continue
      }
      if (!names[family].has(icon)) {
        problems.push(`${purpose.id} [${FAMILIES[family]}]: 不存在 “${icon}” → 可选：${suggester(names[family])(icon).join(' | ')}`)
      }
      const alt = purpose.alt?.[family]
      if (alt && !names[family].has(alt)) {
        problems.push(`${purpose.id} alt [${FAMILIES[family]}]: 不存在 “${alt}” → 可选：${suggester(names[family])(alt).join(' | ')}`)
      }
      quality[family][purpose.q?.[family] ?? 'native']++
    }
  }

  for (const component of surveyed) {
    if (!placed.has(component)) problems.push(`Lucide 组件 “${component}” 未归入任何用途`)
  }

  return {
    problems,
    stats: {
      purposes: purposes.length,
      groups: groups.length,
      surveyed: surveyed.size,
      placed: placed.size,
      quality,
      nativeShare: Object.fromEntries(Object.entries(quality).map(([key, value]) => [key, value.native / (purposes.length - 1)])),
    },
  }
}

/** File-theme names must exist, including the fallbacks. */
export async function validateFiles() {
  const problems = []
  const raw = {}
  for (const [key, theme] of Object.entries(themes)) {
    raw[key] = new Set(Object.keys((await readJson(`icons-${theme.prefix}.json`)).icons))
  }
  for (const kind of kinds) {
    for (const key of Object.keys(themes)) {
      const icon = kind[key]
      if (!icon) continue
      if (!raw[key].has(icon)) problems.push(`${kind.id} [${key}]: 不存在 “${icon}” → 可选：${suggester(raw[key])(icon).join(' | ')}`)
    }
  }
  for (const [key, theme] of Object.entries(themes)) {
    for (const [slot, icon] of Object.entries(theme.fallback)) {
      if (!raw[key].has(icon)) problems.push(`兜底图形 ${slot} [${key}]: 不存在 “${icon}” → 可选：${suggester(raw[key])(icon).join(' | ')}`)
    }
  }
  return { problems, stats: { kinds: kinds.length, themes: Object.fromEntries(Object.entries(themes).map(([key, theme]) => [key, theme.prefix])) } }
}

// CLI: print both reports and exit non-zero when something is off.
if (import.meta.main) {
  const mapping = await validateMapping()
  const files = await validateFiles()
  const problems = [...mapping.problems, ...files.problems]
  console.log(JSON.stringify({ mapping: mapping.stats, files: files.stats, problems }, null, 2))
  if (problems.length) {
    console.error(`\n校验未通过，共 ${problems.length} 项：\n` + problems.join('\n'))
    process.exit(1)
  }
  console.log('\n校验通过：图标名全部存在，Lucide 组件全部落位。')
}
