// Fetch real Iconify data for the icon-family demo. Writes raw JSON into ./assets.
import { mkdir, writeFile } from 'node:fs/promises'

const ASSETS = new URL('./assets/', import.meta.url)
await mkdir(ASSETS, { recursive: true })

const API = 'https://api.iconify.design'

async function getJson(path) {
  const url = `${API}${path}`
  const res = await fetch(url, { headers: { 'user-agent': 'phaneris-icon-demo/1.0' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function save(name, data) {
  const text = JSON.stringify(data)
  await writeFile(new URL(name, ASSETS), text)
  return text.length
}

// Candidate UI families + candidate colourful file themes.
const collections = [
  'line-md',
  'ci',
  'mi',
  'svg-spinners',
  'vscode-icons',
  'material-icon-theme',
  'file-icons',
  'seti',
  'catppuccin-icons',
  'devicon',
]

const summary = {}
for (const prefix of collections) {
  try {
    const data = await getJson(`/collection?prefix=${prefix}`)
    const bytes = await save(`collection-${prefix}.json`, data)
    const named = new Set()
    for (const list of Object.values(data.categories ?? {})) for (const n of list) named.add(n)
    for (const n of data.uncategorized ?? []) named.add(n)
    summary[prefix] = {
      ok: true,
      total: data.total,
      named: named.size,
      categories: Object.keys(data.categories ?? {}).length,
      license: data.license?.title,
      author: data.author?.name,
      bytes,
    }
  } catch (error) {
    summary[prefix] = { ok: false, error: String(error.message ?? error) }
  }
}

// Full icon bodies for the three UI candidates (whole set = "全套").
for (const prefix of ['line-md', 'ci', 'mi', 'svg-spinners']) {
  try {
    const data = await getJson(`/${prefix}.json`)
    const bytes = await save(`icons-${prefix}.json`, data)
    summary[prefix].icons = Object.keys(data.icons ?? {}).length
    summary[prefix].iconBytes = bytes
  } catch (error) {
    summary[prefix].iconError = String(error.message ?? error)
  }
}

await writeFile(new URL('fetch-summary.json', ASSETS), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
