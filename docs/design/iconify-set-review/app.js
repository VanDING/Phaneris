const state={variant:'a',panel:'workspace',nav:'sessions',primary:'sessions',wb:{items:['files'],active:'files',open:true,pinned:new Set(),expanded:false},browser:false,browserPopup:false,browserCaption:'创建窗口',help:false,fileColor:true,fileQuery:'',selectedFile:'package.json',expanded:new Set(),doc:null}
const navKeys=['sessions','labels','sources','skills','plugins','projects','pages','automations']
const primaryKinds=['sessions','kanban','calendar','gantt']
const contextKinds=['files','trajectory','terminal']
const toolbarByAction=Object.fromEntries(DATA.toolbar.map(item=>[item.action,item]))
const candidates=DATA.candidates
const helpItems=[['sources','数据源'],['skills','技能'],['success','任务状态'],['permissions','权限'],['automations','自动化'],['message','消息平台'],['external','全部文档']]
const behavior={newSession:'在当前对话旁新建对话；本页以新的示例标题表示。',sessions:'返回主对话视图。',kanban:'打开项目看板主视图。',calendar:'打开项目日历主视图。',gantt:'打开项目甘特图主视图。',files:'创建或激活文件工作台标签。',trajectory:'创建或激活运行轨迹标签。',terminal:'创建或激活终端标签。',browser:'聚焦或创建独立浏览器；Shift／Alt 点击表示新窗口。',help:'打开帮助菜单，包含七个文档入口。'}
let newSessionCount=0
const safe=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
function glyph(key,variant=state.variant,extra=''){
  const def=DATA.mapping[key]
  if(!def)throw new Error('Unknown semantic icon: '+key)
  const id=def.ids[variant],[width,height]=def.boxes[variant]
  return `<svg class="icon ${extra}" viewBox="0 0 ${width} ${height}" aria-hidden="true" data-glyph="${safe(id)}"><use href="#${safe(id)}"></use></svg>`
}
function oldGlyph(key){return glyph(key,'current')}
function statusGlyph(id){return `<svg class="state state-${id}" viewBox="0 0 24 24" aria-hidden="true"><use href="#state-${id}"></use></svg>`}
function brand(){return `<img src="${DATA.brand}" alt="">`}
function resolveFile(name){
  const lower=name.toLowerCase(),ext=lower.split('.').pop()
  let id=null,reason='未知类型回退'
  if(/^dockerfile(?:\.|$)/.test(lower)||lower==='.dockerignore'){id='_docker';reason='文件名规则：Docker'}
  else if(/^\.git(?:ignore|attributes|modules|config|keep)$/.test(lower)){id='_git';reason='文件名规则：Git'}
  else if(/^eslint\.config\.(?:mjs|cjs|js|ts)$/.test(lower)||/^\.eslintrc/.test(lower)){id='_eslint';reason='文件名规则：ESLint'}
  else if(/^bun\.lockb?$/.test(lower)){id='_lock';reason='Bun 锁文件：通用锁字形回退'}
  else if(lower==='bunfig.toml'){id='_config';reason='Bun 配置：通用配置字形回退'}
  else if(['license','notice'].includes(lower)||/^\.env(?:\.|$)/.test(lower)){id='_default';reason='无明确类型标记：中性文件'}
  else if(['md','markdown'].includes(ext)){id='_markdown';reason='扩展名识别语言：markdown'}
  else{
    const exact=Object.entries(DATA.seti.fileNames).find(([key])=>key.toLowerCase()===lower)
    if(exact){id=exact[1];reason='文件名精确匹配'}
    if(!id){const matches=Object.keys(DATA.seti.fileExtensions).filter(key=>lower.endsWith('.'+key)).sort((a,b)=>b.length-a.length);if(matches.length){id=DATA.seti.fileExtensions[matches[0]];reason='扩展名匹配：'+matches[0]}}
    if(!id){const languages={md:'markdown',markdown:'markdown',json:'json',jsonc:'jsonc',jsonl:'jsonl',ts:'typescript',tsx:'typescriptreact',js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascriptreact',css:'css',html:'html',py:'python',rs:'rust',go:'go',yaml:'yaml',yml:'yaml',toml:'properties'};if(languages[ext]){id=DATA.seti.languageIds[languages[ext]];reason='扩展名识别语言：'+languages[ext]}}
  }
  id=id||DATA.seti.file
  const lightId=DATA.seti.iconDefinitions[id+'_light']?id+'_light':id
  const def=DATA.seti.iconDefinitions[id],light=DATA.seti.iconDefinitions[lightId]
  if(!def)throw new Error('Unknown Seti definition: '+id)
  const palette={_git:['#d45d42','#ed9278'],_markdown:['#238951','#83c668'],_json:['#cb6628','#f1a56a'],_docker:['#287fa5','#6bb5d0'],_eslint:['#7c62aa','#b29ad4'],_lock:['#8766ac','#b99bcf']}
  const colors=palette[id]||[light.fontColor,def.fontColor]
  return {id,lightId,character:String.fromCodePoint(parseInt(def.fontCharacter.slice(1),16)),lightColor:colors[0],darkColor:colors[1],reason,neutral:id==='_default'}
}
function fileIcon(name){
  if(!state.fileColor)return glyph('document',state.variant,'mono-file')
  const info=resolveFile(name)
  if(info.neutral)return `<span class="file-generic" aria-hidden="true" data-file-icon="_default">${glyph('file')}</span>`
  if(info.id==='_markdown')return `<svg class="file-type-svg" viewBox="0 0 256 256" fill="currentColor" style="--file-light:${info.lightColor};--file-dark:${info.darkColor}" aria-hidden="true" data-file-icon="_markdown"><use href="#file-markdown"></use></svg>`
  return `<span class="file-icon ${info.neutral?'neutral':''}" style="--file-light:${info.neutral?'var(--muted)':info.lightColor};--file-dark:${info.neutral?'var(--muted)':info.darkColor}" aria-hidden="true" data-file-icon="${safe(info.id)}">${info.character}</span>`
}
function toolState(action){
  if(primaryKinds.includes(action))return state.primary===action&&state.nav==='sessions'?'focused':'closed'
  if(contextKinds.includes(action)){if(!state.wb.items.includes(action))return 'closed';if(!state.wb.open)return 'background';return state.wb.active===action?'focused':'open'}
  if(action==='browser')return state.browser?'open':'closed'
  if(action==='help')return state.help?'focused':'closed'
  return 'closed'
}
function launchers(){return DATA.toolbar.map((item,index)=>`${index===5?'<span class="launcher-divider" aria-hidden="true"></span>':''}<button class="launcher ${toolState(item.action)}" data-launch="${item.action}" aria-label="${item.label}" title="${item.label}" data-tool-state="${toolState(item.action)}">${glyph(item.key)}</button>`).join('')}
function renderSelectors(){
  document.querySelectorAll('[data-variant]').forEach(button=>{const variant=button.dataset.variant;button.setAttribute('aria-pressed',String(variant===state.variant));button.querySelector('.variant-icons').innerHTML=['sessions','skills','automations'].map(key=>glyph(key,variant)).join('')})
  document.querySelector('#candidate-note').textContent=candidates[state.variant].note
  document.querySelector('#review-status').textContent=candidates[state.variant].title+' · 尚未实施'
}
function setPanel(panel){
  state.panel=panel
  document.querySelectorAll('[data-panel]').forEach(button=>{const active=button.dataset.panel===panel;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1})
  document.querySelectorAll('.content-panel').forEach(el=>el.hidden=el.id!=='panel-'+panel)
  if(panel==='choices'){renderChoices();renderMappings()}
  if(panel==='toolbar')renderToolbarReview()
  if(panel==='files')renderFileDemo()
}
function selectedNav(){return primaryKinds.includes(state.primary)&&state.primary!=='sessions'?'projects':state.nav}
function renderNav(){return `<button class="new-session" data-launch="newSession" title="新建对话">${glyph('new')}<span>新建对话</span></button>${navKeys.map((key,index)=>`${index===2?'<div class="nav-divider"></div>':''}<button class="nav-item ${selectedNav()===key?'selected':''}" data-nav="${key}" aria-label="${DATA.mapping[key].label}" title="${DATA.mapping[key].label}">${glyph(key)}<span>${DATA.mapping[key].label}</span></button>`).join('')}<div class="nav-footer"><button class="nav-item ${state.nav==='settings'?'selected':''}" data-nav="settings" title="设置" aria-label="设置">${glyph('settings')}<span>设置</span></button><div class="profile"><span class="profile-name"><span class="avatar">V</span>Van</span>${glyph('down')}</div></div>`}
function sessionList(){return `<div class="list-heading">所有对话 ${glyph('filter')}</div><div class="group-heading">${glyph('down')}待办</div><div class="session-row selected">${statusGlyph('todo')}<span class="label">Iconify 图标选型</span></div><div class="session-row">${statusGlyph('in-progress')}<span class="label">整理项目文档</span></div><div class="group-heading">${glyph('down')}已完成</div><div class="session-row">${statusGlyph('done')}<span class="label">导航方案初选</span></div>`}
function chat(){return `<div class="user-message">从 Iconify 中选择三套完整图标，比较导航、右上角功能和文件主题。</div><div class="assistant-label">${brand()}<span>Phaneris</span></div><p class="response-text">本轮分开比较界面图形和文件类型图形。右上角十个入口可点击，文件、运行轨迹和终端可保留为工作台标签。</p><div class="result-file">${fileIcon('Iconify图标选型.md')}<div class="file-detail"><span>Iconify图标选型.md</span><small>演示产物</small></div><span class="file-actions">${glyph('copy')}${glyph('external')}</span></div><div class="result-file">${fileIcon('icon-mapping.json')}<div class="file-detail"><span>icon-mapping.json</span><small>类型图形可独立切换彩色</small></div><span class="file-actions">${glyph('download')}</span></div><div class="message-actions"><span>${glyph('copy')}复制</span><span>${glyph('edit')}编辑</span><span>${glyph('more')}</span></div>`}
function kanban(){return `<div class="kanban-grid">${[['todo','待办',['选择界面图标路线','确认文件主题']],['in-progress','进行中',['比较顶栏全部入口']],['done','已完成',['保留任务状态语义']]].map(([id,title,tasks])=>`<div class="kanban-column"><h3>${statusGlyph(id)}${title}</h3>${tasks.map(task=>`<div class="task-card">${task}<small>图标演示项目</small></div>`).join('')}</div>`).join('')}</div>`}
function calendar(){const blanks=3;return `<div class="calendar-head"><strong>2026 年 10 月</strong><span class="micro-icons">${glyph('left')}${glyph('right')}</span></div><div class="calendar-grid">${['一','二','三','四','五','六','日'].map(day=>`<div class="calendar-cell day-name">${day}</div>`).join('')}${Array.from({length:35},(_,i)=>{const day=i-blanks+1;return `<div class="calendar-cell ${day===15?'today':''}">${day>0&&day<=31?day:''}${day===15?'<div class="calendar-event">图标选型</div>':''}</div>`}).join('')}</div>`}
function gantt(){return `<div class="gantt-grid"><div>图标演示项目</div>${[12,13,14,15,16,17,18].map(day=>`<div>${day} 日</div>`).join('')}${[['主要图标取舍',1,3],['顶栏全功能',3,5],['文件主题',4,7]].map(([title,start,end])=>`<div>${title}</div><div class="gantt-track"><span class="gantt-bar" style="grid-column:${start} / ${end}"></span></div>`).join('')}</div><p class="muted" style="margin-top:15px;font-size:11px">时间段为示例，只用于查看甘特图入口及布局。</p>`}
function settings(){return `<div class="settings-content"><div class="settings-menu">${[['general','通用'],['ai','AI'],['appearance','外观'],['input','输入'],['permissions','权限'],['server','服务器'],['account','个人偏好']].map(([key,label])=>`<div class="settings-nav ${key==='appearance'?'active':''}">${glyph(key)}${label}</div>`).join('')}</div><div class="settings-detail"><h3>外观</h3>${[['monitor','跟随系统'],['sun','浅色主题'],['moon','深色主题'],['input','输入设置'],['permissions','权限设置']].map(([key,label])=>`<div class="setting-row"><span class="setting-row-title">${glyph(key)}${label}</span><span class="setting-value">${glyph('down')}</span></div>`).join('')}</div></div>`}
function centerContent(){
  if(state.doc)return `<div class="assistant-label">${glyph(state.doc[0])}${state.doc[1]}</div><p class="response-text">此处演示帮助菜单的图标与入口位置。真实应用会打开对应文档。</p>`
  if(state.nav==='settings')return settings()
  if(state.nav!=='sessions')return `<p class="muted">示例内容，比较图标造型与导航状态。</p>${[1,2,3].map(i=>`<div class="catalog-row">${glyph(state.nav)}<div><h3>${DATA.mapping[state.nav].label}示例 ${i}</h3><small>图标选型预览</small></div><span class="catalog-actions">${glyph('edit')}${glyph('more')}</span></div>`).join('')}`
  return state.primary==='kanban'?kanban():state.primary==='calendar'?calendar():state.primary==='gantt'?gantt():chat()
}
function centerTitle(){if(state.doc)return '帮助 · '+state.doc[1];if(state.nav!=='sessions')return DATA.mapping[state.nav]?.label||'设置';return {sessions:newSessionCount?'新的示例对话 '+newSessionCount:'Iconify 图标选型',kanban:'项目 · 看板',calendar:'项目 · 日历',gantt:'项目 · 甘特图'}[state.primary]}
function fileRows(query='',inWorkbench=false){
  const filtered=DATA.fileSamples.filter(name=>name.toLowerCase().includes(query.toLowerCase()))
  let html=''
  if(!query){html+=DATA.folders.map(name=>`<button class="file-list-row dir" data-directory="${name}" title="${name}">${glyph(state.expanded.has(name)?'down':'right')}<span class="filename">${name}</span></button>${state.expanded.has(name)?`<button class="file-list-row indented" data-file="README.md">${fileIcon('README.md')}<span class="filename">README.md</span></button>`:''}`).join('')}
  html+=filtered.map(name=>`<button class="file-list-row ${state.selectedFile===name?'selected':''}" data-file="${safe(name)}" title="${safe(name)}">${fileIcon(name)}<span class="filename">${safe(name)}</span></button>`).join('')
  return html||'<p class="empty">没有匹配文件</p>'
}
function contextBody(){
  if(state.wb.active==='files')return `<div class="file-mode-switch"><span>${state.fileColor?'Seti 彩色类型':'单色类型'}</span><button data-toggle-files>切换</button></div><label class="file-filter">${glyph('search')}<input id="wb-file-search" value="${safe(state.fileQuery)}" type="search" placeholder="筛选文件…" aria-label="筛选工作台文件"></label><div id="wb-file-list">${fileRows(state.fileQuery,true)}</div><div class="inline-file-preview" id="wb-file-preview">${safe(state.selectedFile)}<br>文件预览示意</div>`
  if(state.wb.active==='trajectory')return `<h3 style="font-size:12px;padding:3px">运行轨迹</h3><p class="muted" style="font-size:11px;padding:3px">示例运行，用于图标及状态展示。</p>${[['check','核对整套图标','已完成'],['check','生成三套完整候选','已完成'],['clock','等待选型','待用户选择']].map(([key,title,sub])=>`<div class="timeline-step">${glyph(key)}<div>${title}<small>${sub}</small></div></div>`).join('')}`
  return `<div class="terminal-content">PowerShell\nPS E:\\Phaneris&gt;\n\n<span class="muted">终端布局示例。\n本页没有执行命令。</span></div>`
}
function helpPopover(){if(!state.help)return '';return `<div class="mock-popover" id="help-menu" aria-label="帮助文档菜单">${helpItems.map(([key,label],index)=>`${index===6?'<div class="nav-divider"></div>':''}<button class="help-item" data-help="${index}">${glyph(key)}${label}<span class="external-mark">${glyph('external')}</span></button>`).join('')}</div>`}
function browserPopover(){if(!state.browserPopup)return '';return `<div class="mock-popover browser-window" id="browser-preview" aria-label="浏览器窗口示意"><div class="browser-window-bar">${glyph('globe')}浏览器 · ${state.browserCaption}示意<button class="wb-action" data-browser-close aria-label="关闭浏览器示意">${glyph('close')}</button></div><div class="browser-address">${glyph('left')}${glyph('right')}${glyph('refresh')}<span>phaneris.local / 示例页面</span></div><div class="browser-window-content"><div class="brand">${brand()}Phaneris</div><p>真实应用在独立窗口中打开浏览器。此处展示图标与存在状态。</p></div></div>`}
function workbenchActions(){const pinned=state.wb.pinned.has(state.wb.active);return `<button class="wb-action ${pinned?'is-pinned':''}" data-wb-pin aria-pressed="${pinned}" aria-label="${pinned?'取消固定':'固定当前会话'}" title="${pinned?'取消固定':'固定当前会话'}">${glyph(pinned?'unpin':'pin')}</button><button class="wb-action" data-wb-expand aria-label="${state.wb.expanded?'还原工作台':'放大工作台'}" title="${state.wb.expanded?'还原工作台':'放大工作台'}">${glyph(state.wb.expanded?'restore':'maximize')}</button><button class="wb-action" data-wb-collapse aria-label="收起工作台" title="收起工作台">${glyph('right')}</button><button class="wb-action" data-wb-close aria-label="关闭当前工作台标签" title="关闭当前标签">${glyph('close')}</button>`}
function renderApp(){
  const showList=state.nav==='sessions'&&state.primary==='sessions'
  document.querySelector('#mock-app').className='app full-app'+(state.wb.open?' has-workbench':'')+(showList?'':' no-list')+(state.wb.expanded?' is-expanded':'')
  document.querySelector('#mock-app').innerHTML=`<div class="app-topbar"><div class="topbar-left">${glyph('sidebar')}<span class="brand">${brand()}<span>Phaneris</span></span>${glyph('filter')}${glyph('left')}${glyph('right')}<span>Work ${glyph('down')}</span></div>${state.browser?`<span class="browser-badge">${glyph('globe')}示例页面</span>`:''}<div class="topbar-launchers" aria-label="完整右上角工具栏">${launchers()}</div></div><div class="app-body"><nav class="app-nav" aria-label="工作台导航">${renderNav()}</nav><div class="session-list">${sessionList()}</div><div class="center"><div class="conversation-header"><span>${safe(centerTitle())}</span><span class="micro-icons">${glyph('search')}${glyph('more')}</span></div><div class="center-body">${centerContent()}</div>${state.nav==='sessions'&&state.primary==='sessions'&&!state.doc?`<div class="composer"><div class="composer-placeholder">输入消息，或添加附件…</div><div class="composer-bottom">${glyph('attach')}${glyph('add')}<span class="composer-model">默认模型 ${glyph('down')}</span><span class="send-icon">${glyph('send')}</span></div></div>`:''}</div><aside class="workbench" aria-label="上下文工作台"><div class="wb-header"><div class="wb-tabs">${state.wb.items.map(action=>`<button class="wb-tab ${action===state.wb.active?'active':''}" data-launch="${action}">${glyph(toolbarByAction[action].key)}${toolbarByAction[action].label}</button>`).join('')}</div>${workbenchActions()}</div><div class="wb-body">${state.wb.items.length?contextBody():''}</div></aside></div>${helpPopover()}${browserPopover()}`
  document.querySelector('#demo-status').textContent=`主视图：${toolbarByAction[state.primary]?.label||'对话'}；工作台：${state.wb.open?toolbarByAction[state.wb.active]?.label||'无':state.wb.items.length?'已收起，保留 '+state.wb.items.length+' 个标签':'未打开'}。`
}
function launch(action,event={}){
  state.help=action==='help'?!state.help:false
  if(action==='newSession'){newSessionCount++;state.primary='sessions';state.nav='sessions';state.doc=null}
  else if(primaryKinds.includes(action)){state.primary=action;state.nav='sessions';state.doc=null}
  else if(contextKinds.includes(action)){if(!state.wb.items.includes(action))state.wb.items.push(action);state.wb.active=action;state.wb.open=true}
  else if(action==='browser'){state.browserCaption=event.shiftKey||event.altKey?'新建窗口':state.browser?'聚焦窗口':'创建窗口';state.browser=true;state.browserPopup=true}
  if(primaryKinds.includes(action)||action==='newSession')state.wb.expanded=false
  setPanel('workspace');renderApp()
}
function renderFamilySheet(){document.querySelector('#family-sheet').innerHTML=['a','b','c'].map(variant=>'<div class="family-row"><div class="family-name">'+safe(candidates[variant].title)+'<small>'+safe(candidates[variant].short)+'</small></div><div class="family-samples">'+Object.keys(DATA.mainRoles).map(key=>'<span class="family-item" title="'+safe(DATA.mapping[key].label)+'">'+glyph(key,variant)+'<small>'+safe(DATA.mapping[key].label)+'</small></span>').join('')+'</div><button class="quiet-button family-open" data-preview-variant="'+variant+'" aria-label="预览'+safe(candidates[variant].title)+'"><div><span>预览整套</span></div><span class="variant-icons" hidden></span></button></div>').join('')}
function renderChoices(){document.querySelector('#choice-body').innerHTML=Object.entries(DATA.mainRoles).map(([key,old])=>{const def=DATA.mapping[key];return `<tr><td>${def.label}</td><td>${oldGlyph(key)}<code>${old.name}</code></td>${['a','b','c'].map(variant=>`<td class="${state.variant===variant?'chosen':''}">${glyph(key,variant)}<code>${safe(def.names[variant])}</code></td>`).join('')}<td class="note-cell">${safe(def.note)}</td></tr>`}).join('')}
function renderMappings(){const query=document.querySelector('#icon-search').value.toLowerCase().trim(),group=document.querySelector('#group-filter').value;const defs=Object.values(DATA.mapping).filter(def=>!DATA.mainRoles[def.key]&&(group==='all'||def.group===group)&&(!query||[def.label,...Object.values(def.names)].join(' ').toLowerCase().includes(query)));document.querySelector('#mapping-body').innerHTML=defs.map(def=>`<tr><td>${def.label}</td>${['current','a','b','c'].map(variant=>`<td><div class="glyph-detail">${glyph(def.key,variant)}</div><code>${safe(def.names[variant])}</code></td>`).join('')}</tr>`).join('')||'<tr><td colspan="5" class="empty">没有匹配图标</td></tr>'}
function renderToolbarReview(){
  document.querySelector('#toolbar-body').innerHTML=DATA.toolbar.map(item=>`<tr><td>${item.label}</td>${['current','a','b','c'].map(variant=>`<td>${glyph(item.key,variant)}<code>${safe(DATA.mapping[item.key].names[variant])}</code></td>`).join('')}<td class="action-cell">${behavior[item.action]}<button class="try-button" data-launch="${item.action}">查看${item.label}演示 ${glyph('external')}</button></td></tr>`).join('')
  document.querySelector('#toolbar-states').innerHTML=[['closed','未打开'],['open','已打开'],['focused','当前聚焦'],['background','收起后保留']].map(([value,label])=>`<div class="state-example"><span class="launcher ${value}" data-example-state="${value}">${glyph('filesPanel')}</span>${label}</div>`).join('')
}
function renderFileInspector(){const info=resolveFile(state.selectedFile);document.querySelector('#file-inspector').innerHTML=`<div class="file-inspector-title">${fileIcon(state.selectedFile)}<code>${safe(state.selectedFile)}</code></div><div class="inspector-rule"><span>识别方式</span><span>${safe(info.reason)}</span><span>类型字形</span><code>${safe(info.id)}</code><span>界面图标</span><span>${candidates[state.variant].title}</span><span>文件主题</span><span>${state.fileColor?'Seti 彩色':'所选界面库的单色文档'}</span></div>`}
function renderFileDemo(){document.querySelector('#file-mode-label').textContent=state.fileColor?'彩色类型':'单色类型';document.querySelector('#file-search-icon').innerHTML=glyph('search');document.querySelector('#file-demo-list').innerHTML=fileRows(document.querySelector('#file-search').value);renderFileInspector()}
function refresh(){renderSelectors();renderApp();if(state.panel==='choices'){renderChoices();renderMappings()}if(state.panel==='toolbar')renderToolbarReview();if(state.panel==='files')renderFileDemo()}
function toggleFileColor(){state.fileColor=!state.fileColor;document.querySelector('#file-color').checked=state.fileColor;refresh()}
document.addEventListener('click',event=>{
  const candidate=event.target.closest('[data-variant],[data-preview-variant]');if(candidate){state.variant=candidate.dataset.variant||candidate.dataset.previewVariant;refresh();return}
  const panel=event.target.closest('[data-panel]');if(panel){setPanel(panel.dataset.panel);return}
  const launcher=event.target.closest('[data-launch]');if(launcher){launch(launcher.dataset.launch,event);return}
  const nav=event.target.closest('[data-nav]');if(nav){state.nav=nav.dataset.nav;state.primary='sessions';state.doc=null;state.help=false;renderApp();return}
  if(event.target.closest('[data-wb-pin]')){state.wb.pinned.has(state.wb.active)?state.wb.pinned.delete(state.wb.active):state.wb.pinned.add(state.wb.active);renderApp();return}
  if(event.target.closest('[data-wb-expand]')){state.wb.expanded=!state.wb.expanded;renderApp();return}
  if(event.target.closest('[data-wb-collapse]')){state.wb.open=false;state.wb.expanded=false;renderApp();return}
  if(event.target.closest('[data-wb-close]')){state.wb.pinned.delete(state.wb.active);state.wb.items=state.wb.items.filter(item=>item!==state.wb.active);state.wb.active=state.wb.items.at(-1)||null;state.wb.open=state.wb.items.length>0;state.wb.expanded=false;renderApp();return}
  if(event.target.closest('[data-toggle-files]')){toggleFileColor();return}
  const file=event.target.closest('[data-file]');if(file){state.selectedFile=file.dataset.file;if(state.panel==='files')renderFileDemo();else{document.querySelectorAll('.file-list-row[data-file]').forEach(row=>row.classList.toggle('selected',row.dataset.file===state.selectedFile));const preview=document.querySelector('#wb-file-preview');if(preview)preview.textContent=state.selectedFile+' · 文件预览示意'}return}
  const folder=event.target.closest('[data-directory]');if(folder){const name=folder.dataset.directory;state.expanded.has(name)?state.expanded.delete(name):state.expanded.add(name);state.panel==='files'?renderFileDemo():renderApp();return}
  const help=event.target.closest('[data-help]');if(help){state.doc=helpItems[Number(help.dataset.help)];state.help=false;renderApp();return}
  if(event.target.closest('[data-browser-close]')){state.browserPopup=false;state.browser=false;renderApp()}
})
document.querySelector('#file-color').addEventListener('change',event=>{state.fileColor=event.target.checked;refresh()})
document.querySelector('#theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('#theme-toggle').textContent=dark?'切换浅色':'切换深色'})
document.querySelector('#icon-size').addEventListener('change',event=>document.documentElement.style.setProperty('--icon-size',event.target.value+'px'))
document.querySelector('#file-search').addEventListener('input',renderFileDemo)
document.querySelector('#icon-search').addEventListener('input',renderMappings)
document.querySelector('#group-filter').addEventListener('change',renderMappings)
document.addEventListener('input',event=>{if(event.target.id==='wb-file-search'){state.fileQuery=event.target.value;document.querySelector('#wb-file-list').innerHTML=fileRows(state.fileQuery,true)}})
document.querySelector('[role=tablist]').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=[...event.currentTarget.querySelectorAll('[role=tab]')],index=tabs.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus()})
document.querySelector('#state-strip').innerHTML=[['backlog','待规划'],['todo','待办'],['in-progress','进行中'],['needs-review','待审阅'],['done','已完成'],['cancelled','已取消']].map(([id,label])=>`<span class="state-item">${statusGlyph(id)}${label}</span>`).join('')
renderSelectors();renderFamilySheet();renderApp();renderChoices();renderMappings();renderToolbarReview();renderFileDemo()
