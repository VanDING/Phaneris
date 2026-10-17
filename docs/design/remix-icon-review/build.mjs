import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as lucide from 'lucide-react'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const roots = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/viewer/src', 'apps/webui/src']
const entries = []
const inlineSvgFiles = []
function walk(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'build'].includes(entry.name)) walk(file)
      continue
    }
    if (!/\.(tsx?|jsx?)$/.test(file)) continue
    const source = read(file)
    const production = !/\/(playground|__tests__|fixtures)\/|\.(test|spec)\./.test(file)
    if (production && /<svg\b/.test(source)) inlineSvgFiles.push({ file, declarations: [...source.matchAll(/<svg\b/g)].length })
    const icons = []
    for (const match of source.matchAll(/\bimport\s+(type\s+)?\{([^}]+)\}\s+from\s*['"]lucide-react['"]/g)) {
      if (match[1]) continue
      for (const specifier of match[2].split(',')) {
        const clean = specifier.replace(/\/\/[^\r\n]*/g, '').trim()
        if (!clean || /^type\s/.test(clean)) continue
        const [name, local = name] = clean.split(/\s+as\s+/)
        icons.push({ name: name.trim(), local: local.trim() })
      }
    }
    if (icons.length) entries.push({ file, production, icons })
  }
}
roots.forEach(walk)
const production = entries.filter(entry => entry.production)
const names = [...new Set(production.flatMap(entry => entry.icons.map(icon => icon.name)))].sort()
const components = new Map()
for (const name of names) {
  if (!lucide[name]) throw new Error(`Missing installed Lucide export: ${name}`)
  if (!components.has(lucide[name])) components.set(lucide[name], [])
  components.get(lucide[name]).push(name)
}
const byScope = Object.fromEntries(roots.map((prefix, index) => {
  const files = production.filter(entry => entry.file.startsWith(prefix + '/'))
  return [['desktop', 'shared', 'viewer', 'webui'][index], {
    files: files.length,
    imports: files.reduce((sum, entry) => sum + entry.icons.length, 0),
    exportedNames: new Set(files.flatMap(entry => entry.icons.map(icon => icon.name))).size,
  }]
}))
const summary = {
  files: production.length,
  imports: production.reduce((sum, entry) => sum + entry.icons.length, 0),
  exportedNames: names.length,
  distinctComponents: components.size,
  playgroundFiles: entries.filter(entry => !entry.production && entry.file.includes('/playground/')).length,
  byScope,
}
const audit = {
  date: '2026-10-15',
  lucideInstalledVersion: JSON.parse(read('node_modules/lucide-react/package.json')).version,
  declaredLucideRange: JSON.parse(read('package.json')).dependencies['lucide-react'],
  method: 'Static named import declarations in the four frontend roots. Type-only imports, playground, __tests__, fixtures and *.test/spec.* are excluded from production. Import totals count file/specifiers, not JSX nodes or rendered instances. Lucide aliases are deduplicated by installed component identity.',
  summary,
  aliasGroups: [...components.values()].filter(group => group.length > 1),
  exportedNames: names,
  inlineSvgFiles,
  entries,
}

// A, B and C are selection recipes inside one Remix Icon library, not separate libraries.
// The final two columns define the normal/active navigation shapes for recipe C/B.
const definitions = [
  ['sessions','所有对话','导航','Inbox','inbox-2','chat-3','chat-1'],
  ['labels','标签','导航','Tag','price-tag-3','price-tag-3','price-tag-3'],
  ['sources','数据源','导航','DatabaseZap','database-2','database-2','database'],
  ['skills','技能','导航','Zap','flashlight','flashlight','magic'],
  ['plugins','插件','导航','Shapes','shapes','puzzle-2','puzzle'],
  ['projects','项目','导航','FolderKanban','folder-3','folder-chart','folder-6'],
  ['pages','页面','导航','PanelTop','layout-top','pages','window'],
  ['automations','自动化','导航','ListTodo','list-check-2','flow-chart','calendar-check'],
  ['settings','设置','导航','Settings','settings-3','settings-3','settings-4'],
  ['new','新建对话','操作','SquarePenRounded','edit-box','chat-new','chat-new'],
  ['sidebar','侧栏','操作','PanelLeftRounded','side-bar','side-bar','side-bar'],
  ['search','搜索','操作','Search','search','search','search'],
  ['filter','筛选','操作','ListFilter','filter-3','filter-3','filter-3'],
  ['more','更多','操作','MoreHorizontal','more','more','more'],
  ['add','添加','操作','Plus','add','add','add'],
  ['close','关闭','操作','X','close','close','close'],
  ['left','后退','操作','ChevronLeft','arrow-left-s','arrow-left-s','arrow-left-s'],
  ['right','展开','操作','ChevronRight','arrow-right-s','arrow-right-s','arrow-right-s'],
  ['down','下拉','操作','ChevronDown','arrow-down-s','arrow-down-s','arrow-down-s'],
  ['copy','复制','操作','Copy','file-copy','file-copy','file-copy'],
  ['edit','编辑','操作','Pencil','edit','edit','edit'],
  ['delete','删除','操作','Trash2','delete-bin','delete-bin-6','delete-bin-6'],
  ['external','外部打开','操作','ExternalLink','external-link','external-link','external-link'],
  ['download','下载','操作','Download','download-2','download-2','download-2'],
  ['refresh','刷新','操作','RefreshCw','refresh','refresh','refresh'],
  ['pin','固定','操作','Pin','pushpin','pushpin-2','pushpin-2'],
  ['archive','归档','操作','Archive','archive','archive','archive'],
  ['attach','附件','对话','Paperclip','attachment-2','attachment-2','attachment-2'],
  ['send','发送','对话','ArrowUp','arrow-up','arrow-up','arrow-up'],
  ['message','消息','对话','MessageSquare','chat-1','chat-3','chat-1'],
  ['ai','AI 设置','设置','Sparkles','sparkling-2','sparkling-2','sparkling'],
  ['bot','智能体','对话','Bot','robot-2','ai-agent','robot-3'],
  ['terminal','终端','文件与工具','TerminalSquare','terminal-box','terminal-box','terminal-box'],
  ['code','代码','文件与工具','Code','code-s-slash','code-s-slash','code-s-slash'],
  ['file','文件','文件与工具','File','file','file','file'],
  ['document','文档','文件与工具','FileText','file-text','file-text','file-text'],
  ['folder','文件夹','文件与工具','FolderOpen','folder-open','folder-open','folder-open'],
  ['image','图片','文件与工具','Image','image','image-2','image-2'],
  ['table','表格','文件与工具','Table2','table','table','table'],
  ['json','结构数据','文件与工具','Braces','braces','braces','braces'],
  ['branch','分支','文件与工具','GitBranch','git-branch','git-branch','git-branch'],
  ['diff','文件变更','文件与工具','FileDiff','file-code','file-code','file-code'],
  ['globe','浏览器','文件与工具','Globe','global','global','global'],
  ['maximize','放大','操作','Maximize2','expand-diagonal','expand-diagonal','expand-diagonal'],
  ['appearance','外观','设置','Palette','palette','palette','palette'],
  ['input','输入','设置','Keyboard','keyboard-box','keyboard-box','keyboard-box'],
  ['workspace','工作区','设置','Building2','building-2','building-2','building-2'],
  ['permissions','权限','设置','ShieldCheck','shield-check','shield-check','shield-check'],
  ['server','服务器','设置','Server','server','server','server'],
  ['account','个人偏好','设置','UserCircle','account-circle','account-circle','account-circle'],
  ['general','通用','设置','ToggleRight','toggle','toggle','toggle'],
  ['key','凭证','设置','Key','key-2','key-2','key-2'],
  ['eye','显示','设置','Eye','eye','eye','eye'],
  ['sun','浅色','设置','Sun','sun','sun','sun'],
  ['moon','深色','设置','Moon','moon','moon','moon'],
  ['monitor','跟随系统','设置','Monitor','computer','computer','computer'],
  ['clock','定时任务','状态','Clock','time','time','time'],
  ['success','成功','状态','CheckCircle2','checkbox-circle','checkbox-circle','checkbox-circle'],
  ['warning','警告','状态','AlertTriangle','error-warning','error-warning','error-warning'],
  ['error','失败','状态','XCircle','close-circle','close-circle','close-circle'],
  ['info','信息','状态','Info','information','information','information'],
  ['check','完成勾选','状态','Check','check','check','check'],
  ['loading','载入中','状态','Loader2','loader-4','loader-4','loader-4'],
]
const mapping = Object.fromEntries(definitions.map(([key,label,group,current,a,b,c]) => [key, {key,label,group,current,a,b,c}]))
const remixUrl = 'https://cdn.jsdelivr.net/npm/remixicon@4.9.1/fonts/remixicon.symbol.svg'
const cached = path.join(os.tmpdir(), 'phaneris-remixicon-4.9.1.svg')
let remix
if (fs.existsSync(cached)) remix = fs.readFileSync(cached, 'utf8')
else {
  const response = await fetch(remixUrl)
  if (!response.ok) throw new Error(`Remix Icon download: HTTP ${response.status}`)
  remix = await response.text()
  fs.writeFileSync(cached, remix)
}
const symbols = new Map([...remix.matchAll(/<symbol\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)<\/symbol>/g)].map(match => [match[2], match[3]]))
const needed = new Set()
for (const icon of Object.values(mapping)) {
  icon.glyphs = {}
  for (const recipe of ['a','b','c']) {
    const base = icon[recipe]
    const line = symbols.has('ri-'+base+'-line') ? base+'-line' : base
    const fill = symbols.has('ri-'+base+'-fill') ? base+'-fill' : line
    const normal = icon.group === '导航' && recipe === 'c' ? fill : line
    const active = icon.group === '导航' && ['b','c'].includes(recipe) ? fill : normal
    icon.glyphs[recipe] = [normal,active]
    needed.add(normal)
    needed.add(active)
  }
}
const missing = [...needed].filter(name => !symbols.has('ri-'+name))
if (missing.length) throw new Error(`Unknown Remix names: ${missing.join(', ')}`)
const markup = []
for (const name of needed) markup.push(`<symbol id="ri-${name}" viewBox="0 0 24 24" fill="currentColor">${symbols.get('ri-'+name)}</symbol>`)
for (const name of new Set(Object.values(mapping).map(icon => icon.current))) {
  let svg
  if (['PanelLeftRounded', 'SquarePenRounded'].includes(name)) {
    svg = read(`apps/electron/src/renderer/components/icons/${name}.tsx`).match(/<svg\b[\s\S]*?<\/svg>/)[0]
      .replace(/\{\.\.\.props\}/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/strokeWidth=/g, 'stroke-width=').replace(/strokeLinecap=/g, 'stroke-linecap=').replace(/strokeLinejoin=/g, 'stroke-linejoin=')
  } else svg = renderToStaticMarkup(React.createElement(lucide[name], { size:24, strokeWidth:1.65 }))
  markup.push(svg.replace(/<svg\b/, `<symbol id="lc-${name}"`).replace(/<\/svg>$/, '</symbol>'))
}
// Keep the existing six state glyphs: replacing a library must not silently redefine workflow states.
const stateSource = read('packages/shared/src/statuses/default-icons.ts')
for (const match of stateSource.matchAll(/'([^']+)': `(<svg[\s\S]*?<\/svg>)`/g)) {
  markup.push(match[2].replace('<svg ', `<symbol id="state-${match[1]}" `).replace(/<\/svg>$/, '</symbol>').replace(/stroke="white"/g,'stroke="var(--canvas)"'))
}
const brand = 'data:image/svg+xml;base64,'+Buffer.from(read('apps/electron/resources/icon.svg')).toString('base64')
audit.remix = { version:'4.9.1', source:remixUrl, sha256:crypto.createHash('sha256').update(remix).digest('hex'), includedGlyphs:needed.size, recipes:Object.keys(mapping).length }
const template = fs.readFileSync(path.join(directory, 'template.html'), 'utf8')
const html = template.replace('<!-- INLINE_SYMBOLS -->', `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden">${markup.join('')}</svg>`)
  .replace('/* INLINE_DATA */', `const DATA = ${JSON.stringify({summary,mapping,brand,version:audit.remix.version})};`)
  .replaceAll('@@BRAND@@',brand)
  .replaceAll('@@FILE_COUNT@@',summary.files).replaceAll('@@IMPORT_COUNT@@',summary.imports).replaceAll('@@NAME_COUNT@@',summary.exportedNames).replaceAll('@@SHAPE_COUNT@@',summary.distinctComponents)
fs.writeFileSync(path.join(directory,'index.html'), html)
fs.writeFileSync(path.join(directory,'inventory.json'), JSON.stringify(audit,null,2)+'\n')
console.log(JSON.stringify({html:path.join(directory,'index.html'),summary,remix:audit.remix,bytes:Buffer.byteLength(html)},null,2))
