// Extract the CURRENT baseline icons straight from the installed lucide-react
// package (v1.51.0), so the demo shows the real thing instead of a lookalike.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { purposes } from './mapping.mjs'

const ICONS = new URL('../../../../node_modules/lucide-react/dist/esm/icons/', import.meta.url)
const ASSETS = new URL('./assets/', import.meta.url)

const kebab = (name) => name
  .replace(/Icon$/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .replace(/([A-Za-z])([0-9])/g, '$1-$2')
  .toLowerCase()

/** Read `const __iconData = {...}` from a module, following re-export aliases. */
async function loadIconData(file) {
  let text = await readFile(file, 'utf8').catch(() => null)
  if (text == null) return null
  const alias = text.match(/export \{ default \} from '\.\/(.+?)\.mjs'/)
  if (alias) return loadIconData(new URL(`./${alias[1]}.mjs`, ICONS))

  const marker = 'const __iconData = '
  const at = text.indexOf(marker)
  if (at < 0) return null
  const start = text.indexOf('{', at)
  let depth = 0
  let inString = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') inString = ch
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(JSON.stringify(new Function(`return ${text.slice(start, i + 1)}`)()))
    }
  }
  return null
}

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function toBody(node) {
  return node.map(([tag, attrs]) => {
    const pairs = Object.entries(attrs)
      .filter(([key]) => key !== 'key')
      .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
      .join(' ')
    return `<${tag} ${pairs}/>`
  }).join('')
}

const wanted = new Map() // kebab name -> component names that need it
const add = (component) => {
  const clean = component.replace(/（.*$/, '').trim()
  if (!/^[A-Za-z0-9]+$/.test(clean)) return
  const name = kebab(clean)
  if (!wanted.has(name)) wanted.set(name, [])
  wanted.get(name).push(clean)
}

for (const purpose of purposes) if (purpose.current) add(purpose.current)
// The six shapes the current file tree actually renders (session-file-tree.tsx).
for (const component of ['Folder', 'FolderOpen', 'FileText', 'Image', 'FileCode', 'File']) add(component)

const icons = {}
const missing = []
for (const [name, components] of wanted) {
  const data = await loadIconData(new URL(`./${name}.mjs`, ICONS))
  if (!data) {
    missing.push(`${name}  ← ${components.join(', ')}`)
    continue
  }
  icons[name] = { b: toBody(data.node), size: data.size ?? 24 }
}
await writeFile(new URL('icons-lucide.json', ASSETS), JSON.stringify({ prefix: 'lucide', width: 24, height: 24, icons }))

console.log(JSON.stringify({ requested: wanted.size, extracted: Object.keys(icons).length, missing: missing.length }, null, 2))
if (missing.length) console.log('\n本地包中找不到的组件:\n' + missing.join('\n'))
