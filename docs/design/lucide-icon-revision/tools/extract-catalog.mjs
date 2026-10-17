// Build a local catalogue of the installed lucide-react: canonical icon bodies
// plus the alias map (v1 keeps old names like CheckCircle2 → circle-check).
import { readdir, readFile, writeFile } from 'node:fs/promises'

const ICONS = new URL('../../../../node_modules/lucide-react/dist/esm/icons/', import.meta.url)
const ASSETS = new URL('../assets/', import.meta.url)

const files = (await readdir(ICONS)).filter((name) => name.endsWith('.mjs') && !name.endsWith('.map'))

/** Read `const __iconData = {...}` with a brace-matching scanner. */
function readIconData(text) {
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

const canonical = {}
const aliases = {}
const failed = []

for (const file of files) {
  const name = file.replace(/\.mjs$/, '')
  const text = await readFile(new URL(file, ICONS), 'utf8')
  const reexport = text.match(/export \{ default \} from '\.\/(.+?)\.mjs'/)
  if (reexport) {
    aliases[name] = reexport[1]
    continue
  }
  const data = readIconData(text)
  if (!data) {
    failed.push(name)
    continue
  }
  canonical[name] = { body: toBody(data.node), size: data.size ?? 24 }
}

// Resolve alias chains so every alias points at the final canonical name.
function resolve(name, seen = new Set()) {
  if (canonical[name]) return name
  const next = aliases[name]
  if (!next || seen.has(name)) return null
  seen.add(name)
  return resolve(next, seen)
}

const aliasMap = {}
for (const name of Object.keys(aliases)) {
  const target = resolve(name)
  if (target) aliasMap[name] = target
  else failed.push(`${name} (unresolved alias)`)
}

await writeFile(new URL('lucide-catalog.json', ASSETS), JSON.stringify({ canonical, aliases: aliasMap }))
console.log(JSON.stringify({
  files: files.length,
  canonical: Object.keys(canonical).length,
  aliases: Object.keys(aliasMap).length,
  failed: failed.length,
}, null, 2))

// Show the alias relations for the components the app actually imports.
const survey = JSON.parse(await readFile(new URL('lucide-usage.json', ASSETS), 'utf8'))
const components = Object.keys(survey.components).filter((n) => n !== 'LucideIcon')
const kebab = (n) => n.replace(/Icon$/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .replace(/([A-Za-z])([0-9])/g, '$1-$2')
  .toLowerCase()

const renamed = components.filter((c) => aliasMap[kebab(c)]).map((c) => `${c} → ${aliasMap[kebab(c)]}`)
console.log(`\n导入的组件里使用旧名的有 ${renamed.length} 个:\n` + renamed.join('\n'))
if (failed.length) console.log('\n未解析:\n' + failed.join('\n'))
