// Inspect the fetched Iconify data: metadata, body mechanics, license fields.
import { readFile } from 'node:fs/promises'

const ASSETS = new URL('./assets/', import.meta.url)
const readJson = async (name) => JSON.parse(await readFile(new URL(name, ASSETS), 'utf8'))

for (const prefix of ['line-md', 'ci', 'mi', 'svg-spinners', 'vscode-icons', 'material-icon-theme']) {
  const col = await readJson(`collection-${prefix}.json`)
  const icons = await readJson(`icons-${prefix}.json`)
  console.log(`\n### ${prefix}`)
  console.log('meta', JSON.stringify({
    name: col.name, author: col.author, license: col.license, height: col.height, width: col.width,
    total: col.total, categories: Object.keys(col.categories ?? {}),
    iconHeight: icons.height, iconWidth: icons.width,
  }))

  let styleBlocks = 0
  let animateTags = 0
  let colored = 0
  const extraKeys = new Set()
  for (const entry of Object.values(icons.icons)) {
    const body = entry.body ?? ''
    for (const key of Object.keys(entry)) extraKeys.add(key)
    if (body.includes('<style')) styleBlocks++
    if (body.includes('<animate')) animateTags++
    if (/#[0-9a-fA-F]{3,6}|rgb\(/.test(body)) colored++
  }
  console.log('entryKeys', JSON.stringify([...extraKeys]))
  console.log('mechanics', JSON.stringify({ styleBlocks, animateTags, colored, total: Object.keys(icons.icons).length }))

  const samples = Object.keys(icons.icons).filter((n) =>
    /^(spin|loading|heart|blocks-wave|add|close|file-type-ts|typescript|typescript-icon|folder|folder-src|file-type-json|json|markdown|file-type-markdown)$/.test(n))
  for (const name of samples.slice(0, 6)) {
    console.log(`  ${name}: ${JSON.stringify(icons.icons[name]?.body ?? icons.icons[name]).slice(0, 300)}`)
  }
}
