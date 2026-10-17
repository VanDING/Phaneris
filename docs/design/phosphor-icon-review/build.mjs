import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as lucide from 'lucide-react'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const roots = ['apps/electron/src/renderer','packages/ui/src','apps/viewer/src','apps/webui/src']
const entries = []
function walk(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative),{withFileTypes:true})) {
    const file = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (!['node_modules','dist','build'].includes(entry.name)) walk(file)
      continue
    }
    if (!/\.(tsx?|jsx?)$/.test(file)) continue
    const production = !/\/(playground|__tests__|fixtures)\/|\.(test|spec)\./.test(file)
    const icons = []
    for (const match of read(file).matchAll(/\bimport\s+(type\s+)?\{([^}]+)\}\s+from\s*['"]lucide-react['"]/g)) {
      if (match[1]) continue
      for (const specifier of match[2].split(',')) {
        const clean = specifier.replace(/\/\/[^\r\n]*/g,'').trim()
        if (!clean || /^type\s/.test(clean)) continue
        const [name,local = name] = clean.split(/\s+as\s+/)
        icons.push({name:name.trim(),local:local.trim()})
      }
    }
    if (icons.length) entries.push({file,production,icons})
  }
}
roots.forEach(walk)
const production = entries.filter(entry => entry.production)
const names = [...new Set(production.flatMap(entry => entry.icons.map(icon => icon.name)))].sort()
const components = new Map()
for (const name of names) {
  if (!lucide[name]) throw new Error(`Unknown Lucide export: ${name}`)
  if (!components.has(lucide[name])) components.set(lucide[name],[])
  components.get(lucide[name]).push(name)
}
const summary = {
  files:production.length,
  imports:production.reduce((sum,entry) => sum+entry.icons.length,0),
  exportedNames:names.length,
  distinctComponents:components.size,
  playgroundFiles:entries.filter(entry => !entry.production && entry.file.includes('/playground/')).length,
  byScope:Object.fromEntries(roots.map((prefix,index) => {
    const files = production.filter(entry => entry.file.startsWith(prefix+'/'))
    return [['desktop','shared','viewer','webui'][index],{files:files.length,imports:files.reduce((sum,entry) => sum+entry.icons.length,0)}]
  })),
}

// P1: Light with simple glyphs. P2: Regular with standard glyphs.
// P3: Duotone for navigation/entities, Regular for compact actions.
const definitions = [
  ['sessions','所有对话','导航','Inbox','tray','chats','chat-circle-dots'],
  ['labels','标签','导航','Tag','tag-simple','tag','tag'],
  ['sources','数据源','导航','DatabaseZap','database','database','stack'],
  ['skills','技能','导航','Zap','lightning','lightning','magic-wand'],
  ['plugins','插件','导航','Shapes','puzzle-piece','puzzle-piece','squares-four'],
  ['projects','项目','导航','FolderKanban','folder-simple','folder','folders'],
  ['pages','页面','导航','PanelTop','layout','browsers','files'],
  ['automations','自动化','导航','ListTodo','flow-arrow','tree-structure','flow-arrow'],
  ['settings','设置','导航','Settings','gear-six','gear','gear-six'],
  ['new','新建对话','操作','SquarePenRounded','note-pencil','note-pencil','note-pencil'],
  ['sidebar','侧栏','操作','PanelLeftRounded','sidebar-simple','sidebar','sidebar-simple'],
  ['search','搜索','操作','Search','magnifying-glass','magnifying-glass','magnifying-glass'],
  ['filter','筛选','操作','ListFilter','funnel-simple','funnel','funnel-simple'],
  ['more','更多','操作','MoreHorizontal','dots-three','dots-three','dots-three'],
  ['add','添加','操作','Plus','plus','plus','plus'],
  ['close','关闭','操作','X','x','x','x'],
  ['left','后退','操作','ChevronLeft','caret-left','caret-left','caret-left'],
  ['right','展开','操作','ChevronRight','caret-right','caret-right','caret-right'],
  ['down','下拉','操作','ChevronDown','caret-down','caret-down','caret-down'],
  ['copy','复制','操作','Copy','copy-simple','copy','copy-simple'],
  ['edit','编辑','操作','Pencil','pencil-simple','pencil','pencil-simple'],
  ['delete','删除','操作','Trash2','trash-simple','trash','trash-simple'],
  ['external','外部打开','操作','ExternalLink','arrow-square-out','arrow-square-out','arrow-square-out'],
  ['download','下载','操作','Download','download-simple','download','download-simple'],
  ['refresh','刷新','操作','RefreshCw','arrows-clockwise','arrows-clockwise','arrows-clockwise'],
  ['pin','固定','操作','Pin','push-pin-simple','push-pin','push-pin-simple'],
  ['archive','归档','操作','Archive','archive','archive','archive'],
  ['attach','附件','对话','Paperclip','paperclip','paperclip-horizontal','paperclip'],
  ['send','发送','对话','ArrowUp','arrow-up','arrow-up','arrow-up'],
  ['message','消息','对话','MessageSquare','chat','chat-text','chat-circle-dots'],
  ['ai','AI 设置','设置','Sparkles','sparkle','sparkle','sparkle'],
  ['bot','智能体','对话','Bot','robot','robot','robot'],
  ['terminal','终端','文件与工具','TerminalSquare','terminal','terminal-window','terminal-window'],
  ['code','代码','文件与工具','Code','code-simple','code','code-block'],
  ['file','文件','文件与工具','File','file','file','file'],
  ['document','文档','文件与工具','FileText','file-text','file-text','file-doc'],
  ['folder','文件夹','文件与工具','FolderOpen','folder-simple','folder-open','folder-open'],
  ['image','图片','文件与工具','Image','image','image-square','image'],
  ['table','表格','文件与工具','Table2','table','table','table'],
  ['json','结构数据','文件与工具','Braces','brackets-curly','brackets-curly','brackets-curly'],
  ['branch','分支','文件与工具','GitBranch','git-branch','git-branch','git-branch'],
  ['diff','文件变更','文件与工具','FileDiff','git-diff','git-diff','git-diff'],
  ['globe','浏览器','文件与工具','Globe','globe-simple','globe','globe-hemisphere-west'],
  ['maximize','放大','操作','Maximize2','arrows-out-simple','arrows-out','arrows-out-simple'],
  ['appearance','外观','设置','Palette','palette','palette','palette'],
  ['input','输入','设置','Keyboard','keyboard','keyboard','keyboard'],
  ['workspace','工作区','设置','Building2','buildings','building-office','buildings'],
  ['permissions','权限','设置','ShieldCheck','shield-check','shield-check','shield-check'],
  ['server','服务器','设置','Server','hard-drives','hard-drives','hard-drives'],
  ['account','个人偏好','设置','UserCircle','user-circle','user-circle','user-circle'],
  ['general','通用','设置','ToggleRight','toggle-right','toggle-right','toggle-right'],
  ['key','凭证','设置','Key','key','key','key'],
  ['eye','显示','设置','Eye','eye','eye','eye'],
  ['sun','浅色','设置','Sun','sun','sun','sun'],
  ['moon','深色','设置','Moon','moon','moon','moon'],
  ['monitor','跟随系统','设置','Monitor','desktop','desktop','desktop'],
  ['clock','定时任务','状态','Clock','clock','clock','clock'],
  ['success','成功','状态','CheckCircle2','check-circle','check-circle','check-circle'],
  ['warning','警告','状态','AlertTriangle','warning','warning','warning'],
  ['error','失败','状态','XCircle','x-circle','x-circle','x-circle'],
  ['info','信息','状态','Info','info','info','info'],
  ['check','完成勾选','状态','Check','check','check','check'],
  ['loading','载入中','状态','Loader2','spinner-gap','spinner-gap','spinner-gap'],
]
const mapping = Object.fromEntries(definitions.map(([key,label,group,current,a,b,c]) => [key,{key,label,group,current,a,b,c}]))
const packageVersion = '2.1.1'
const cache = path.join(os.tmpdir(),'phaneris-phosphor-core-'+packageVersion)
const archive = path.join(cache,'core.tgz')
const assets = path.join(cache,'package/assets')
fs.mkdirSync(cache,{recursive:true})
if (!fs.existsSync(archive)) {
  const metaResponse = await fetch(`https://registry.npmjs.org/@phosphor-icons/core/${packageVersion}`)
  if (!metaResponse.ok) throw new Error(`Phosphor metadata: ${metaResponse.status}`)
  const meta = await metaResponse.json()
  const response = await fetch(meta.dist.tarball)
  if (!response.ok) throw new Error(`Phosphor package: ${response.status}`)
  fs.writeFileSync(archive,Buffer.from(await response.arrayBuffer()))
  fs.writeFileSync(path.join(cache,'source.json'),JSON.stringify({version:meta.version,license:meta.license,source:meta.dist.tarball,integrity:meta.dist.integrity},null,2))
}
const source = JSON.parse(fs.readFileSync(path.join(cache,'source.json'),'utf8'))
const integrity = 'sha512-'+crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64')
if (integrity !== source.integrity) throw new Error('Phosphor archive integrity mismatch')
if (!fs.existsSync(assets)) execFileSync('tar',['-xf',archive,'-C',cache])
const needed = new Map()
for (const def of Object.values(mapping)) {
  def.glyphs = {}
  def.weights = {}
  for (const recipe of ['a','b','c']) {
    const weight = recipe === 'a' ? 'light' : recipe === 'b' ? 'regular' : def.group === '操作' || ['send','attach','check','loading'].includes(def.key) ? 'regular' : 'duotone'
    const name = def[recipe]
    const id = name+'-'+weight
    def.glyphs[recipe] = [id,id]
    def.weights[recipe] = weight
    needed.set(id,{name,weight})
  }
}
for (const name of ['sun','moon']) needed.set(name+'-regular',{name,weight:'regular'})
const markup = []
const included = []
for (const [id,{name,weight}] of needed) {
  const filename = name+(weight === 'regular' ? '' : '-'+weight)+'.svg'
  const file = path.join(assets,weight,filename)
  if (!fs.existsSync(file)) throw new Error(`Missing official Phosphor asset: ${weight}/${filename}`)
  const svg = fs.readFileSync(file,'utf8')
  const contents = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)[1]
  markup.push(`<symbol id="ph-${id}" viewBox="0 0 256 256" fill="currentColor">${contents}</symbol>`)
  included.push({id,name,weight,file:`assets/${weight}/${filename}`,sha256:crypto.createHash('sha256').update(svg).digest('hex')})
}
for (const name of new Set(Object.values(mapping).map(icon => icon.current))) {
  let svg
  if (['PanelLeftRounded','SquarePenRounded'].includes(name)) {
    svg = read(`apps/electron/src/renderer/components/icons/${name}.tsx`).match(/<svg\b[\s\S]*?<\/svg>/)[0]
      .replace(/\{\.\.\.props\}/g,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'').replace(/strokeWidth=/g,'stroke-width=').replace(/strokeLinecap=/g,'stroke-linecap=').replace(/strokeLinejoin=/g,'stroke-linejoin=')
  } else svg = renderToStaticMarkup(React.createElement(lucide[name],{size:24,strokeWidth:1.65}))
  markup.push(svg.replace(/<svg\b/,`<symbol id="lc-${name}"`).replace(/<\/svg>$/,'</symbol>'))
}
for (const match of read('packages/shared/src/statuses/default-icons.ts').matchAll(/'([^']+)': `(<svg[\s\S]*?<\/svg>)`/g)) {
  markup.push(match[2].replace('<svg ',`<symbol id="state-${match[1]}" `).replace(/<\/svg>$/,'</symbol>').replace(/stroke="white"/g,'stroke="var(--canvas)"'))
}
const brand = 'data:image/svg+xml;base64,'+Buffer.from(read('apps/electron/resources/icon.svg')).toString('base64')
const data = {summary,mapping,brand,version:packageVersion}
const html = fs.readFileSync(path.join(directory,'template.html'),'utf8')
  .replace('<!-- INLINE_SYMBOLS -->',`<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden">${markup.join('')}</svg>`)
  .replace('/* INLINE_DATA */',`const DATA = ${JSON.stringify(data)};`)
  .replaceAll('@@BRAND@@',brand)
  .replaceAll('@@FILE_COUNT@@',summary.files).replaceAll('@@IMPORT_COUNT@@',summary.imports).replaceAll('@@NAME_COUNT@@',summary.exportedNames).replaceAll('@@SHAPE_COUNT@@',summary.distinctComponents)
fs.writeFileSync(path.join(directory,'index.html'),html)
fs.writeFileSync(path.join(directory,'inventory.json'),JSON.stringify({date:'2026-10-15',currentLucide:'1.51.0',summary,method:'Static named imports; excludes type-only imports, playground and tests. Totals count imports, not rendered instances. Aliases deduplicated by installed component identity.',phosphor:{...source,includedGlyphs:included.length,representativeUses:definitions.length},included,mapping,entries},null,2)+'\n')
fs.copyFileSync(path.join(cache,'package/LICENSE'),path.join(directory,'PHOSPHOR-LICENSE.txt'))
console.log(JSON.stringify({html:path.join(directory,'index.html'),phosphorVersion:packageVersion,includedGlyphs:included.length,representativeUses:definitions.length,bytes:Buffer.byteLength(html),summary},null,2))
