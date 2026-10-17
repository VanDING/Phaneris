// Fetch author/license metadata for the used icon sets.
// The per-collection endpoint omits license fields, so use /collections once.
import { writeFile } from 'node:fs/promises'

const ASSETS = new URL('./assets/', import.meta.url)
const WANTED = ['line-md', 'ci', 'mi', 'svg-spinners', 'vscode-icons', 'material-icon-theme', 'lucide']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchCollections(attempt = 0) {
  const res = await fetch('https://api.iconify.design/collections', { headers: { 'user-agent': 'phaneris-icon-demo/1.0' } })
  if (!res.ok) {
    if (attempt >= 6) throw new Error(`${res.status} /collections`)
    await sleep(6000 * (attempt + 1))
    return fetchCollections(attempt + 1)
  }
  return res.json()
}

const all = await fetchCollections()
const picked = {}
for (const prefix of WANTED) {
  const entry = all[prefix]
  if (!entry) continue
  picked[prefix] = {
    name: entry.name,
    total: entry.total,
    author: entry.author?.name ?? '',
    authorUrl: entry.author?.url ?? '',
    license: entry.license?.title ?? '',
    licenseSpdx: entry.license?.spdx ?? '',
    licenseUrl: entry.license?.url ?? '',
    category: entry.category ?? '',
  }
}
await writeFile(new URL('set-licenses.json', ASSETS), JSON.stringify(picked, null, 2))
console.log(JSON.stringify(picked, null, 2))
