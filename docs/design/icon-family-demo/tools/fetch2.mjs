// Fetch real icon bodies from the Iconify API in batches and record exact sizes.
import { readFile, writeFile } from 'node:fs/promises'

const ASSETS = new URL('./assets/', import.meta.url)
const API = 'https://api.iconify.design'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(path, attempt = 0) {
  const url = `${API}${path}`
  const res = await fetch(url, { headers: { 'user-agent': 'phaneris-icon-demo/1.0' } })
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`${res.status} ${url}`)
    await sleep(1200 * (attempt + 1))
    return getJson(path, attempt + 1)
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))

function namesOf(collection) {
  const names = new Set()
  for (const list of Object.values(collection.categories ?? {})) for (const n of list) names.add(n)
  for (const n of collection.uncategorized ?? []) names.add(n)
  return [...names]
}

async function fetchCollection(prefix) {
  const data = await getJson(`/collection?prefix=${prefix}`)
  await writeFile(new URL(`collection-${prefix}.json`, ASSETS), JSON.stringify(data))
  return data
}

async function fetchAllIcons(prefix) {
  const collection = await readJson(`collection-${prefix}.json`)
  const names = namesOf(collection)
  const merged = { prefix, icons: {} }
  const batchSize = 120
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize)
    const data = await getJson(`/${prefix}.json?icons=${batch.join(',')}`)
    Object.assign(merged.icons, data.icons ?? {})
    merged.width ??= data.width
    merged.height ??= data.height
    await sleep(120)
  }
  const text = JSON.stringify(merged)
  await writeFile(new URL(`icons-${prefix}.json`, ASSETS), text)
  return { prefix, requested: names.length, received: Object.keys(merged.icons).length, bytes: text.length }
}

const report = {}
for (const prefix of ['file-icons', 'seti', 'catppuccin-icons', 'devicon']) {
  try {
    report[prefix] = { collection: (await fetchCollection(prefix)).total }
  } catch (error) {
    report[prefix] = { error: String(error.message ?? error) }
  }
}

for (const prefix of ['line-md', 'ci', 'mi', 'svg-spinners', 'vscode-icons', 'material-icon-theme']) {
  try {
    report[prefix] = { ...(report[prefix] ?? {}), ...(await fetchAllIcons(prefix)) }
  } catch (error) {
    report[prefix] = { ...(report[prefix] ?? {}), error: String(error.message ?? error) }
  }
}

await writeFile(new URL('fetch-summary.json', ASSETS), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
