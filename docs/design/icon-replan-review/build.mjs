import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as lucide from 'lucide-react'

const directory=path.dirname(fileURLToPath(import.meta.url))
const root=path.resolve(directory,'../../..')
const previous=JSON.parse(fs.readFileSync(path.join(directory,'../phosphor-icon-review/inventory.json'),'utf8'))
const remixPrevious=JSON.parse(fs.readFileSync(path.join(directory,'../remix-icon-review/inventory.json'),'utf8'))
const remixData=JSON.parse(fs.readFileSync(path.join(directory,'../remix-icon-review/index.html'),'utf8').match(/const DATA = (.*?);\n/)[1])
const mapping=Object.fromEntries(Object.values(previous.mapping).map(def=>[def.key,{
  key:def.key,label:def.label,group:def.group,current:def.current,
  p1:def.a,lucide:def.current,remix:remixData.mapping[def.key].a,
}]))
const changes={
  sessions:['chat-circle','MessageCircle','chat-3','收件箱改为圆气泡，减少方角并直接表达对话。'],
  labels:['tag','Tag','price-tag-3','保留标签隐喻，放弃原 P1 的明显箭头尖头。'],
  sources:['database','Database','database-2','去掉当前数据库旁的闪电，保留圆柱轮廓。'],
  skills:['lightbulb','Lightbulb','lightbulb','用灯泡替代锐角闪电；强调能力和想法，弱化速度含义。'],
  plugins:['puzzle-piece','Puzzle','puzzle-2','选择圆形拼接轮廓，替代当前的三角等几何形状。'],
  projects:['folder-simple','FolderClosed','folder-3','减少内部折线，保留项目文件夹的连续语义。'],
  pages:['browser','PanelTop','window-2','保留窗口外形，减少交叉分割；Lucide 沿用现有 PanelTop。'],
  automations:['arrows-clockwise','Repeat2','loop-right','用循环弧线替代尖锐流程箭头；提醒：循环不覆盖全部事件触发语义。'],
  settings:['sliders-horizontal','Settings2','equalizer','用圆形滑杆替代齿轮尖齿。'],
}
for(const [key,[p1,lucideName,remix,note]] of Object.entries(changes))Object.assign(mapping[key],{p1,lucide:lucideName,remix,note})
// This is a curated Lucide update. Unlisted roles retain their existing component.
const toolbar=[
  ['new','新建对话','newSession','SquarePenRounded','note-pencil','edit-box'],
  ['switchSessions','对话','sessions','MessageSquare','chat-circle','chat-3'],
  ['kanban','看板','kanban','Columns3','kanban','layout-column'],
  ['calendar','日历','calendar','CalendarDays','calendar-blank','calendar-2'],
  ['gantt','甘特图','gantt','GanttChartSquare','chart-bar-horizontal','bar-chart-horizontal'],
  ['filesPanel','文件','files','FolderTree','folder','folder-open'],
  ['trajectory','运行轨迹','trajectory','Activity','chart-line','pulse'],
  ['terminal','终端','terminal','SquareTerminal','terminal-window','terminal-box'],
  ['globe','浏览器','browser','Globe','globe-simple','global'],
  ['help','帮助','help','HelpCircle','question','question'],
]
for(const [key,label,action,current,p1,remix] of toolbar){
  if(!mapping[key])mapping[key]={key,label,group:'右上角',current,p1,lucide:current,remix}
  else Object.assign(mapping[key],{p1,remix})
  mapping[key].action=action
}
mapping.switchSessions.lucide='MessageCircle'
mapping.trajectory.lucide='ChartSpline'
for(const [key,label,current,p1,remix]of [
  ['unpin','取消固定','PinOff','push-pin-slash','unpin'],
  ['restore','还原面板','Minimize2','arrows-in-simple','collapse-diagonal'],
])mapping[key]={key,label,group:'操作',current,p1,lucide:current,remix}
const markup=[], included=[]
const phosAssets=path.join(os.tmpdir(),'phaneris-phosphor-core-2.1.1/package/assets/light')
const remix=fs.readFileSync(path.join(os.tmpdir(),'phaneris-remixicon-4.9.1.svg'),'utf8')
const remixSymbols=new Map([...remix.matchAll(/<symbol\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)].map(m=>[m[1],m[2]]))
const added=new Set()
function addPhosphor(name){
  const id='ph-'+name
  if(added.has(id))return id
  const file=path.join(phosAssets,name+'-light.svg')
  if(!fs.existsSync(file))throw new Error('Unknown Phosphor Light: '+name)
  const source=fs.readFileSync(file,'utf8')
  markup.push(`<symbol id="${id}" viewBox="0 0 256 256" fill="currentColor">${source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1]}</symbol>`)
  included.push({id,library:'Phosphor core 2.1.1',name,weight:'light',sha256:crypto.createHash('sha256').update(source).digest('hex')})
  added.add(id);return id
}
function addLucide(name){
  const id='lc-'+name
  if(added.has(id))return id
  let source
  if(['PanelLeftRounded','SquarePenRounded'].includes(name))source=fs.readFileSync(path.join(root,`apps/electron/src/renderer/components/icons/${name}.tsx`),'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0].replace(/\{\.\.\.props\}/g,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'').replace(/strokeWidth=/g,'stroke-width=').replace(/strokeLinecap=/g,'stroke-linecap=').replace(/strokeLinejoin=/g,'stroke-linejoin=')
  else{
    if(!lucide[name])throw new Error('Unknown installed Lucide: '+name)
    source=renderToStaticMarkup(React.createElement(lucide[name],{size:24,strokeWidth:1.65}))
  }
  source=source.replace(/stroke-width="([\d.]+)"/g,'stroke-width="var(--glyph-stroke, $1)"')
  markup.push(source.replace(/<svg\b/,`<symbol id="${id}"`).replace(/<\/svg>$/,'</symbol>'))
  added.add(id);return id
}
function addRemix(name){
  const actual=remixSymbols.has('ri-'+name)?name:remixSymbols.has('ri-'+name+'-line')?name+'-line':null
  if(!actual)throw new Error('Unknown Remix line asset: '+name)
  const id='ri-'+actual
  if(!added.has(id)){markup.push(`<symbol id="${id}" viewBox="0 0 24 24" fill="currentColor">${remixSymbols.get(id)}</symbol>`);added.add(id)}
  return id
}
for(const def of Object.values(mapping)){
  def.ids={current:addLucide(def.current),a:addPhosphor(def.p1),b:addLucide(def.lucide),c:addRemix(def.remix)}
  def.names={current:def.current,a:def.p1+' · Light',b:def.lucide,c:def.ids.c.slice(3)}
}
const oldP1={}
for(const key of Object.keys(changes))oldP1[key]={name:previous.mapping[key].a,id:addPhosphor(previous.mapping[key].a)}
// A recognizable Markdown mark is used instead of Seti's downward arrow.
// File-theme assets remain independent of the selected UI library.
const markdownAsset=path.join(os.tmpdir(),'phaneris-phosphor-core-2.1.1/package/assets/fill/markdown-logo-fill.svg')
const markdownSource=fs.readFileSync(markdownAsset,'utf8')
markup.push(`<symbol id="file-markdown" viewBox="0 0 256 256" fill="currentColor">${markdownSource.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1]}</symbol>`)
included.push({id:'file-markdown',library:'Phosphor core 2.1.1',name:'markdown-logo',weight:'fill',purpose:'File type mark',sha256:crypto.createHash('sha256').update(markdownSource).digest('hex')})
for(const m of fs.readFileSync(path.join(root,'packages/shared/src/statuses/default-icons.ts'),'utf8').matchAll(/'([^']+)': `(<svg[\s\S]*?<\/svg>)`/g))markup.push(m[2].replace('<svg ',`<symbol id="state-${m[1]}" `).replace(/<\/svg>$/,'</symbol>').replace(/stroke="white"/g,'stroke="var(--canvas)"'))
const fileCache=path.join(os.tmpdir(),'phaneris-icon-replan')
const seti=JSON.parse(fs.readFileSync(path.join(fileCache,'theme.txt'),'utf8'))
const font=fs.readFileSync(path.join(fileCache,'seti.woff'))
const brand='data:image/svg+xml;base64,'+fs.readFileSync(path.join(root,'apps/electron/resources/icon.svg')).toString('base64')
const fileSamples=['.dockerignore','.env.example','.gitattributes','.gitignore','AGENTS.md','bun.lock','bunfig.toml','CODE_OF_CONDUCT.md','CONTRIBUTING.md','Dockerfile.server','eslint.config.mjs','LICENSE','NOTICE','package.json','phaneris.identity.json','README.md','README.zh-CN.md','SECURITY.md','TRADEMARK.md','tsconfig.base.json','tsconfig.build.json','App.tsx','main.ts','theme.css','logo.svg','preview.png','report.pdf','report.docx','report.xlsx','unknown.filetype']
const folders=['.verify','analysis','apps','docs','node_modules','packages','patches','scripts']
const data={mapping,toolbar:toolbar.map(([key,label,action])=>({key,label,action})),oldP1,summary:previous.summary,brand,seti,fileSamples,folders}
let html=fs.readFileSync(path.join(directory,'template.html'),'utf8')
  .replace('/* INLINE_STYLES */',fs.readFileSync(path.join(directory,'styles.css'),'utf8')+fs.readFileSync(path.join(directory,'review.css'),'utf8')+`\n@font-face{font-family:SetiReview;src:url(data:font/woff;base64,${font.toString('base64')}) format("woff");font-style:normal;font-weight:normal;font-display:block}`)
  .replace('<!-- INLINE_SYMBOLS -->',`<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden">${markup.join('')}</svg>`)
  .replace('/* INLINE_DATA */','const DATA='+JSON.stringify(data)+';')
  .replace('/* INLINE_APP */',fs.readFileSync(path.join(directory,'app.js'),'utf8'))
  .replaceAll('@@BRAND@@',brand)
fs.writeFileSync(path.join(directory,'index.html'),html)
fs.copyFileSync(path.join(fileCache,'SETI-LICENSE.txt'),path.join(directory,'SETI-LICENSE.txt'))
fs.copyFileSync(path.join(directory,'../phosphor-icon-review/PHOSPHOR-LICENSE.txt'),path.join(directory,'PHOSPHOR-LICENSE.txt'))
const manifest={date:'2026-10-15',mode:'Demonstration only',summary:previous.summary,candidates:{a:'P1 softened · Phosphor Light',b:'L1 · curated Lucide 1.51.0',c:'R1 · curated Remix Icon 4.9.1 line'},mapping,oldP1,toolbar:data.toolbar,sources:{phosphor:'https://github.com/phosphor-icons/core',remix:remixPrevious.remix,seti:{theme:'https://raw.githubusercontent.com/microsoft/vscode/1.105.0/extensions/theme-seti/icons/vs-seti-icon-theme.json',font:'https://raw.githubusercontent.com/microsoft/vscode/1.105.0/extensions/theme-seti/icons/seti.woff',themeSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(fileCache,'theme.txt'))).digest('hex'),fontSha256:crypto.createHash('sha256').update(font).digest('hex')}},included}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({html:path.join(directory,'index.html'),roles:Object.keys(mapping).length,toolbarActions:toolbar.length,bytes:Buffer.byteLength(html),changedLucideRoles:Object.values(mapping).filter(d=>d.current!==d.lucide).map(d=>d.key)},null,2))
