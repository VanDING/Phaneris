import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {candidates,rows,notes} from './selection.mjs'

const directory=path.dirname(fileURLToPath(import.meta.url))
const read=file=>fs.readFileSync(path.join(directory,file),'utf8')
const sha=text=>crypto.createHash('sha256').update(text).digest('hex')
const base=JSON.parse(read('assets/base-data.json'))
const selected=JSON.parse(read('assets/selected-icons.json'))
const mapping={},symbols=[],included=[],ids=new Set()
for(const [key,...names] of rows){
  if(!base.mapping[key]||mapping[key])throw Error('Invalid or duplicate role: '+key)
  const original=base.mapping[key]
  const def={key,label:original.label,group:original.group,current:original.current,note:notes[key],ids:{current:original.id},names:{current:original.current},boxes:{current:[24,24]}}
  for(const [index,variant] of ['a','b','c'].entries()){
    const candidate=candidates[variant],name=names[index]+candidate.suffix
    const icon=selected[candidate.prefix].icons[name]
    if(!icon)throw Error('Missing selected icon: '+candidate.prefix+':'+name)
    const id=candidate.prefix+'-'+name
    def.ids[variant]=id;def.names[variant]=name;def.boxes[variant]=[icon.width,icon.height]
    if(!ids.has(id)){
      // The original Iconify body and native grid are preserved. Internal ids,
      // if present, are namespaced without changing visible geometry.
      const localIds=[...icon.body.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1])
      let body=icon.body
      for(const local of localIds)body=body.replaceAll('id="'+local+'"','id="'+id+'-'+local+'"').replaceAll('url(#'+local+')','url(#'+id+'-'+local+')').replaceAll('href="#'+local+'"','href="#'+id+'-'+local+'"')
      if(/<(?:script|foreignObject)\b|\bon\w+=|(?:href|src)="https?:/i.test(body))throw Error('Unexpected active SVG content')
      symbols.push(`<symbol id="${id}" viewBox="0 0 ${icon.width} ${icon.height}" fill="currentColor">${body}</symbol>`)
      included.push({id,prefix:candidate.prefix,name,width:icon.width,height:icon.height,bodySha256:sha(icon.body)})
      ids.add(id)
    }
  }
  mapping[key]=def
}
if(Object.keys(mapping).length!==Object.keys(base.mapping).length)throw Error('Incomplete semantic coverage')
const mainRoles=Object.fromEntries(base.navKeys.map(key=>[key,{name:mapping[key].current}]))
const data={...base,mapping,mainRoles,candidates}
const baseline=read('assets/baseline.svg').replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'')
const html=read('template.html')
  .replace('<!-- THIRD_PARTY_NOTICES -->','<!--\n'+read('THIRD-PARTY-NOTICES.txt').replaceAll('--','—')+'\n-->')
  .replace('/* INLINE_STYLES */',read('styles.css')+'\n'+read('review.css'))
  .replace('<!-- INLINE_SYMBOLS -->','<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden">'+baseline+symbols.join('')+'</svg>')
  .replace('/* INLINE_DATA */','const DATA='+JSON.stringify(data)+';')
  .replace('/* INLINE_APP */',read('app.js'))
  .replaceAll('@@BRAND@@',base.brand)
fs.writeFileSync(path.join(directory,'index.html'),html)
const manifest={date:'2026-10-15',mode:'Standalone demonstration only',scope:base.summary,candidates,mapping,toolbar:base.toolbar,sources:Object.fromEntries(Object.entries(selected).map(([key,value])=>[key,value.source])),included,exceptions:['Phaneris and provider/brand marks','Six existing business status icons','Independent Seti file theme and Markdown mark'],maintenance:{iconPark:'Author repository archived on 2025-12-08; https://github.com/bytedance/IconPark'},semanticCaveats:{solar:['Gantt uses align-left horizontal bars as an approximation','Pin/unpin share pin; active state and action label disambiguate','File changes uses file-pen rather than a dedicated diff glyph'],fluent:['Terminal uses code-block as a code-window approximation','Loading uses arrow-clockwise-dashes without animation in this sample','File changes uses document-landscape-split as a comparison approximation'],iconPark:['Gantt uses timeline rather than duration bars','Pin/unpin share pushpin; active state and action label disambiguate','File changes uses file-conversion as a provisional approximation']}}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({file:path.join(directory,'index.html'),roles:Object.keys(mapping).length,candidates:3,toolbarActions:base.toolbar.length,included:included.length,bytes:Buffer.byteLength(html)},null,2))
