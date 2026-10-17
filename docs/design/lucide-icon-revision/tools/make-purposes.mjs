// One-shot: transform the three-family mapping into a purpose table for the
// Lucide revision (id / group / label / current / lucide[] / note only).
import { readFile, writeFile } from 'node:fs/promises'
import { purposes as source, groups } from '../../icon-family-demo/tools/mapping.mjs'

const clean = source.map((p) => ({
  id: p.id,
  group: p.group,
  label: p.label,
  current: p.current,
  lucide: p.lucide ?? [],
  ...(p.spinner ? { spinner: p.spinner } : {}),
  note: p.note,
}))

const banner = `/**
 * 语义用途表：应用当前用到的 Lucide 组件按用途归组。
 * 由三套选型演示的映射表转换而来，只保留用途、现状组件与说明；
 * 建议图形与变更判定见 plan.mjs。
 */

export const groups = ${JSON.stringify(groups, null, 2)}

export const purposes = ${JSON.stringify(clean, null, 2)}
`
await writeFile(new URL('./purposes.mjs', import.meta.url), banner)
console.log(JSON.stringify({ groups: groups.length, purposes: clean.length, components: clean.reduce((n, p) => n + p.lucide.length, 0) }, null, 2))
