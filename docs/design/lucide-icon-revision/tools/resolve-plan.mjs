/**
 * Resolve the revision plan against the real icon data and the reviewed usage.
 * Exported for the build; run directly for a printable report.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { purposes as base, groups as baseGroups } from './purposes.mjs'
import { recommend, also, why, regroup, extraPurposes, extraGroups } from './plan.mjs'
import { verdicts } from './verdicts.mjs'

const ASSETS = new URL('../assets/', import.meta.url)
const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))

export const kebab = (name) => name
  .replace(/Icon$/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .replace(/([A-Za-z])([0-9])/g, '$1-$2')
  .toLowerCase()

const AREA_ORDER = { production: 0, iconTable: 1, playground: 2 }

export async function resolvePlan() {
  const catalog = await readJson('lucide-catalog.json')
  const survey = await readJson('lucide-usage.json')
  const usage = await readJson('usage-annotated.json')
  const problems = []

  const canonicalOf = (component) => {
    const key = kebab(component)
    if (catalog.canonical[key]) return key
    if (catalog.aliases[key]) return catalog.aliases[key]
    return null
  }
  const countOf = (component) => survey.components[component] ?? 0

  const purposes = [...base.map((p) => ({ ...p, lucide: [...p.lucide] })), ...extraPurposes.map((p) => ({ ...p, lucide: [] }))]
  const byId = new Map(purposes.map((p) => [p.id, p]))

  // 1. Move components that were grouped into the wrong purpose.
  for (const [component, target] of Object.entries(regroup)) {
    const owner = purposes.find((p) => p.lucide.includes(component))
    if (!owner) { problems.push(`regroup: 找不到组件 ${component}`); continue }
    if (!byId.has(target)) { problems.push(`regroup: 目标用途 ${target} 不存在`); continue }
    owner.lucide = owner.lucide.filter((c) => c !== component)
    byId.get(target).lucide.push(component)
  }

  // 1b. Reviewed moves: a glyph that belongs to a different purpose entirely.
  //     Done before analysis so the glyph shows up in its real home.
  for (const [purposeId, rules] of Object.entries(verdicts)) {
    for (const [glyph, rule] of Object.entries(rules)) {
      if (rule[0] !== 'move') continue
      const target = rule[1]
      const source = byId.get(purposeId)
      if (!source) { problems.push(`move: 用途 ${purposeId} 不存在`); continue }
      if (!byId.has(target)) { problems.push(`move: 目标用途 ${target} 不存在`); continue }
      const moved = source.lucide.filter((component) => canonicalOf(component) === glyph)
      if (!moved.length) { problems.push(`move: ${purposeId} 里找不到图形 ${glyph}`); continue }
      source.lucide = source.lucide.filter((component) => !moved.includes(component))
      byId.get(target).lucide.push(...moved)
    }
  }

  const groups = [...baseGroups, ...extraGroups]
  const resolved = []
  const newPurposes = new Map() // 用途名 -> { icon, group, from, evidence }
  const usedVerdictKeys = new Set()

  for (const purpose of purposes) {
    if (!groups.some((g) => g.id === purpose.group)) problems.push(`${purpose.id}: 分区 ${purpose.group} 不存在`)

    if (purpose.spinner) {
      resolved.push({
        id: purpose.id, group: purpose.group, label: purpose.label, current: purpose.current,
        note: purpose.note, spinner: purpose.spinner, totalImports: 0, glyphs: [], distinctGlyphs: 0,
        recommended: purpose.spinner, action: 'external', renamed: false, also: [], dropped: [],
        why: purpose.note ?? '',
      })
      continue
    }

    // Group the purpose's components by the glyph they actually render, and
    // attach the reviewed identity of each glyph.
    const glyphs = new Map()
    for (const component of purpose.lucide) {
      const glyph = canonicalOf(component)
      if (!glyph) { problems.push(`${purpose.id}: 本地 lucide 包里找不到组件 ${component}`); continue }
      if (!glyphs.has(glyph)) glyphs.set(glyph, { glyph, count: 0, components: [], aliases: [], sites: [] })
      const entry = glyphs.get(glyph)
      entry.count += countOf(component)
      entry.components.push(component)
      if (kebab(component) !== glyph) entry.aliases.push(component)
      for (const site of usage.sites[component] ?? []) entry.sites.push({ ...site, component })
    }
    for (const entry of glyphs.values()) {
      const counts = { production: 0, playground: 0, iconTable: 0 }
      for (const site of entry.sites) counts[site.area] = (counts[site.area] ?? 0) + 1
      entry.counts = counts
      entry.files = [...new Set(entry.sites.filter((s) => s.area === 'production').map((s) => s.file))]
    }
    const list = [...glyphs.values()].sort((a, b) => b.count - a.count || a.glyph.localeCompare(b.glyph))

    // Recommendation: explicit, else the glyph with the most production sites.
    const currentGlyph = purpose.current ? canonicalOf(purpose.current.replace(/（.*$/, '').trim()) : null
    const byProduction = [...list].sort((a, b) => (b.counts.production - a.counts.production) || (b.count - a.count) || a.glyph.localeCompare(b.glyph))
    let recommended = recommend[purpose.id]
    let recommendationNote = ''
    if (!recommended) {
      const tied = byProduction.filter((entry) => entry.counts.production === byProduction[0]?.counts.production)
      recommended = (tied.find((entry) => entry.glyph === currentGlyph) ?? byProduction[0])?.glyph ?? null
    }
    if (!recommended) problems.push(`${purpose.id}: 定不出主图形`)
    else if (!catalog.canonical[recommended]) problems.push(`${purpose.id}: 主图形 ${recommended} 不在本地 lucide 包里`)

    for (const extra of also[purpose.id] ?? []) {
      if (!catalog.canonical[extra.icon]) problems.push(`${purpose.id}: 第二图形 ${extra.icon} 不在本地 lucide 包里`)
    }

    // 2. Apply the reviewed verdict to every glyph that is not the recommendation.
    const reviewed = []
    for (const entry of list) {
      if (entry.glyph === recommended) {
        reviewed.push({ ...entry, verdict: 'recommended', use: '', evidence: '' })
        continue
      }
      const rule = verdicts[purpose.id]?.[entry.glyph]
      if (!rule) {
        problems.push(`${purpose.id}: 图形 ${entry.glyph} 缺少复核判定（verdicts.mjs），不能默认它是冗余`)
        reviewed.push({ ...entry, verdict: 'unreviewed', use: '', evidence: '' })
        continue
      }
      usedVerdictKeys.add(`${purpose.id}/${entry.glyph}`)
      const [kind, a, b] = rule
      if (kind === 'redundant' && a && a !== recommended) {
        problems.push(`${purpose.id}: ${entry.glyph} 判定为收敛到 ${a}，但该用途主图形是 ${recommended}`)
      }
      if (kind === 'replace' && a !== recommended) {
        problems.push(`${purpose.id}: ${entry.glyph} 判定为换用 ${a}，但该用途主图形是 ${recommended}`)
      }
      if (kind === 'move' && !base.some((p) => p.id === a)) problems.push(`${purpose.id}: ${entry.glyph} 要归入的用途 ${a} 不存在`)
      if (kind === 'new') {
        const name = a
        if (!name) problems.push(`${purpose.id}: ${entry.glyph} 判定为独立用途但没写用途名`)
        else {
          if (!newPurposes.has(name)) newPurposes.set(name, { name, icon: entry.glyph, group: purpose.group, from: purpose.id, evidence: b ?? '', count: entry.count, components: entry.components })
          else if (newPurposes.get(name).icon !== entry.glyph) problems.push(`新用途「${name}」出现了两个图形：${newPurposes.get(name).icon} 与 ${entry.glyph}`)
        }
      }
      reviewed.push({ ...entry, verdict: kind, use: kind === 'new' ? a : (a ?? ''), evidence: kind === 'new' ? (b ?? '') : (a ?? '') })
    }

    // 3. What actually stays in this purpose.
    const members = reviewed.filter((entry) => ['recommended', 'paired', 'uncertain', 'redundant', 'replace'].includes(entry.verdict))
    const redundant = reviewed.filter((entry) => entry.verdict === 'redundant')
    const replaced = reviewed.filter((entry) => entry.verdict === 'replace')
    const distinct = reviewed.filter((entry) => entry.verdict === 'new' || entry.verdict === 'move')
    const demoOnly = reviewed.filter((entry) => entry.verdict === 'demo')
    const uncertain = reviewed.filter((entry) => entry.verdict === 'uncertain')

    let action
    if (!list.length) action = 'new'
    else if (!members.length) action = recommend[purpose.id] ? 'replace' : 'dissolved'
    else if (replaced.length) action = 'replace'
    else if (redundant.length) action = 'merge'
    else if (distinct.length) action = 'split'
    else action = 'keep'
    if (action === 'keep' && members.length === 1 && members[0].aliases.length === members[0].components.length) action = 'rename'

    const dropped = redundant
    if (usedVerdictKeys.size && (action === 'merge') && !why[purpose.id]) {
      problems.push(`${purpose.id}: 判定为收敛，但 plan.mjs 里没写收敛理由`)
    }

    for (const extra of reviewed) {
      if (extra.verdict === 'unreviewed') problems.push(`${purpose.id}/${extra.glyph}: 未复核`)
    }

    resolved.push({
      id: purpose.id,
      group: purpose.group,
      label: purpose.label,
      current: purpose.current,
      note: purpose.note,
      totalImports: list.reduce((sum, entry) => sum + entry.count, 0),
      glyphs: reviewed,
      distinctGlyphs: list.length,
      productionGlyphs: list.filter((entry) => entry.counts.production > 0).length,
      recommended,
      recommendationNote,
      action,
      renamed: reviewed.some((entry) => entry.verdict === 'recommended' && entry.aliases.length > 0),
      also: also[purpose.id] ?? [],
      dropped,
      redundant: redundant.map((entry) => entry.glyph),
      splitOut: distinct.map((entry) => ({ glyph: entry.glyph, verdict: entry.verdict, target: entry.use, evidence: entry.evidence })),
      demoOnly: demoOnly.map((entry) => entry.glyph),
      uncertain: uncertain.map((entry) => ({ glyph: entry.glyph, note: entry.evidence })),
      why: why[purpose.id] ?? '',
    })
  }

  // 4. Verdicts that reference something that does not exist.
  //    'move' entries are consumed by the move pass above, so skip them here.
  for (const [purposeId, rules] of Object.entries(verdicts)) {
    for (const [glyph, rule] of Object.entries(rules)) {
      if (rule[0] === 'move') continue
      if (!usedVerdictKeys.has(`${purposeId}/${glyph}`)) problems.push(`verdicts.mjs 里的 ${purposeId}/${glyph} 与实际图形对不上`)
    }
  }

  // 5. New purposes discovered by the review.
  const createdPurposes = [...newPurposes.values()].map((entry) => ({
    id: `new-${entry.icon}`,
    group: entry.group,
    label: entry.name,
    current: '',
    note: `复核后从「${base.find((p) => p.id === entry.from)?.label ?? entry.from}」拆出：${entry.evidence}`,
    totalImports: entry.count,
    glyphs: [],
    distinctGlyphs: 1,
    productionGlyphs: 1,
    recommended: entry.icon,
    recommendationNote: '',
    action: 'new-purpose',
    renamed: false,
    also: [],
    dropped: [],
    redundant: [],
    splitOut: [],
    demoOnly: [],
    uncertain: [],
    why: entry.evidence,
    from: entry.from,
  }))

  const all = [...resolved, ...createdPurposes]

  // 6. Every surveyed component must land in exactly one purpose.
  const placed = new Map()
  for (const purpose of purposes) {
    for (const component of purpose.lucide) {
      if (placed.has(component)) problems.push(`${component} 同时归入 ${placed.get(component)} 与 ${purpose.id}`)
      placed.set(component, purpose.id)
    }
  }
  const surveyed = Object.keys(survey.components).filter((n) => n !== 'LucideIcon')
  for (const component of surveyed) if (!placed.has(component)) problems.push(`Lucide 组件 ${component} 未归入任何用途`)

  const survivors = all.filter((p) => p.action !== 'dissolved' && p.action !== 'external')
  const recommendedIcons = new Set(survivors.map((p) => p.recommended))
  const verdictCounts = {}
  for (const purpose of all) {
    for (const glyph of purpose.glyphs ?? []) verdictCounts[glyph.verdict] = (verdictCounts[glyph.verdict] ?? 0) + 1
  }

  const totals = {
    components: surveyed.length,
    aliasRenames: surveyed.filter((component) => Boolean(catalog.aliases[kebab(component)])).length,
    glyphsBefore: new Set(all.flatMap((p) => (p.glyphs ?? []).map((g) => g.glyph))).size,
    purposesBefore: base.length + extraPurposes.length,
    purposesAfter: survivors.length,
    newPurposes: createdPurposes.length,
    dissolvedPurposes: all.filter((p) => p.action === 'dissolved').length,
    recommendedIconsAfter: recommendedIcons.size,
    redundant: all.reduce((n, p) => n + (p.redundant?.length ?? 0), 0),
    splitOut: all.reduce((n, p) => n + (p.splitOut?.length ?? 0), 0),
    demoOnly: new Set(all.flatMap((p) => p.demoOnly ?? [])).size,
    uncertain: all.reduce((n, p) => n + (p.uncertain?.length ?? 0), 0),
    paired: all.reduce((n, p) => n + (p.glyphs ?? []).filter((g) => g.verdict === 'paired').length, 0),
    verdicts: verdictCounts,
    actions: {
      keep: all.filter((p) => p.action === 'keep').length,
      rename: all.filter((p) => p.action === 'rename').length,
      merge: all.filter((p) => p.action === 'merge').length,
      split: all.filter((p) => p.action === 'split').length,
      new: all.filter((p) => p.action === 'new').length,
      newPurpose: createdPurposes.length,
      dissolved: all.filter((p) => p.action === 'dissolved').length,
      external: all.filter((p) => p.action === 'external').length,
    },
  }

  return { groups, purposes: all, totals, problems }
}

if (import.meta.main) {
  const plan = await resolvePlan()
  await writeFile(new URL('plan.json', ASSETS), JSON.stringify(plan, null, 2))
  console.log(JSON.stringify(plan.totals, null, 2))
  console.log('\n收敛（真冗余）：')
  for (const purpose of plan.purposes.filter((p) => p.action === 'merge')) {
    console.log(`  ${purpose.label}: ${purpose.redundant.join(', ')} → ${purpose.recommended}`)
  }
  console.log('\n拆分出的新用途：')
  for (const purpose of plan.purposes.filter((p) => p.action === 'new-purpose')) {
    console.log(`  ${purpose.label} ← ${purpose.recommended}（来自 ${purpose.from}）`)
  }
  console.log('\n待确认：')
  for (const purpose of plan.purposes.filter((p) => p.uncertain?.length)) {
    for (const entry of purpose.uncertain) console.log(`  ${purpose.label}/${entry.glyph}: ${entry.note}`)
  }
  if (plan.problems.length) {
    console.error(`\n方案校验未通过（${plan.problems.length} 项）：\n` + plan.problems.join('\n'))
    process.exit(1)
  }
  console.log('\n方案校验通过：图标名全部存在，217 个组件全部落位，每个非建议图形都有复核判定。')
}
