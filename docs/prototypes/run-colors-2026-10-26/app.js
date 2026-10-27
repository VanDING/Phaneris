/* Standalone design review: palettes and short-history layouts are proposals only. */
const categories = [
  ['system','System prompt','系统提示'], ['schemas','Tool definitions','工具定义'],
  ['user','User messages','用户消息'], ['inject','Injected context','注入上下文'],
  ['skill','Skill content','技能内容'], ['assistant','Assistant replies','助手回复'], ['tool','Tool results','工具结果'],
];
const palettes = {
  a: { name:'A · 清透原色', subtitle:'接近原版，色相分开', description:'保留原版的清晰和活力。系统提示改为紫色，技能改为粉色，注入内容用蓝灰，让蓝色只属于助手回复、金色只属于工具定义。',
    light:['#9568E3','#DDA129','#63B375','#8F9EB7','#E479AB','#4C96E0','#28B2A4'],
    dark:['#B99AEF','#ECC16A','#8AD498','#AEBBD1','#F0A1CA','#82B8EF','#65D5C6'] },
  b: { name:'B · 柔和粉彩', subtitle:'更轻、更柔，降低大面积压迫感', description:'以薰衣草、奶油金、鼠尾草和浅蓝构成轻柔的色组。工具结果占比很大时，整体不会被一块高饱和颜色占据。',
    light:['#AC97D1','#D8B771','#91B89D','#A5A7B9','#D996B2','#8DA9D8','#78B9B2'],
    dark:['#BCACDD','#E3C88E','#A8CCB1','#BABCCD','#E4B0C8','#A5BFE8','#94CEC6'] },
  c: { name:'C · 经典图表', subtitle:'适中饱和度，偏数据可视化', description:'参考成熟统计图表的色彩关系，蓝、绿、金、紫保持明确身份。降低荧光感，同时保留长历史细柱的辨识度。',
    light:['#A477B4','#E3A34D','#70A46B','#939AA6','#D0788D','#5888BA','#62ACA9'],
    dark:['#BD94CA','#EBC083','#95BF90','#B2B9C6','#E1A1B1','#87ACD2','#8CC9C4'] },
  original: { name:'原版 · 对照', subtitle:'当前截图中的分类色', description:'保留原始色板作为对照：系统与助手同属蓝色系，工具定义与技能同属橙色系。可独立切换布局，看清颜色与柱宽各自的影响。',
    light:['#6366F1','#F59E0B','#22C55E','#A855F7','#F97316','#3B82F6','#14B8A6'],
    dark:['#6366F1','#F59E0B','#22C55E','#A855F7','#F97316','#3B82F6','#14B8A6'] },
};
const state={ palette:'a', mode:'light', count:5, layout:'spaced', width:'wide', view:'overview', selected:5, previous:'a' };
const $=selector=>document.querySelector(selector);
const fmt=value=>value>=1e6?`${(value/1e6).toFixed(1)}M`:value>=1000?`${(value/1000).toFixed(1).replace(/\.0$/,'')}K`:String(Math.round(value));
const color=index=>`--cat:var(--cat-${categories[index][0]})`;
const dot=index=>`<i class="dot" style="${color(index)}"></i>`;
const totals=()=>state.count<=12?Array.from({length:state.count},(_,i)=>[31200,44200,68500,69100,69600][Math.min(i,4)]+Math.max(0,i-4)*980):Array.from({length:state.count},(_,i)=>12000+i/(state.count-1)*172900);
const shares=index=>state.count<=12?[.12,.35,.018,.001,.025,.40+Math.min(index,4)*.008,.086-Math.min(index,4)*.008]:[.003,.004,.002,.001,.008,.17-(index/state.count)*.148,.812+(index/state.count)*.148];
const legend=()=>`<div class="legend">${categories.map((category,index)=>`<span>${dot(index)}${category[1]}</span>`).join('')}</div>`;
function chart(context=false) {
  const values=totals(), count=Math.min(state.count,72), maximum=state.count<=12?80000:240000;
  const bars=Array.from({length:count},(_,i)=>{
    const start=Math.floor(i*state.count/count), end=Math.max(start+1,Math.floor((i+1)*state.count/count));
    return {start:start+1,end,value:Math.max(...values.slice(start,end)),seq:end};
  });
  const stride=Math.max(1,Math.ceil(count/7));
  return `<div class="trend" data-few="${count<=12}" data-layout="${state.layout}" style="--count:${count}">
    <div class="chart-y">${[1,.75,.5,.25,0].map(r=>`<span>${fmt(maximum*r)}</span>`).join('')}</div>
    <div class="plot"><div class="gridlines">${Array.from({length:5},()=>'<i></i>').join('')}</div>
      <div class="columns">${bars.map(bar=>`<button class="column" data-request="${bar.seq}" aria-label="Request ${bar.seq}: ${fmt(bar.value)} tokens" aria-pressed="${state.selected>=bar.start&&state.selected<=bar.end}" title="Request ${bar.start===bar.end?bar.seq:`${bar.start}–${bar.end}`} · ${fmt(bar.value)} tokens"><span class="bar" style="--bar-height:${bar.value/maximum*100}%">${shares(bar.seq-1).map((share,index)=>`<i style="${color(index)};height:${share*100}%"></i>`).join('')}</span></button>`).join('')}</div>
      <div class="axis">${bars.map((bar,index)=>(count<=8||index===0||index===count-1||index%stride===0)?`<span style="grid-column:${index+1}">${index===0?bar.start:bar.end}</span>`:'').join('')}</div>
    </div></div>
    <div class="selection"><span><strong>${context?`${fmt(values[state.selected-1])} tokens`:`Request #${state.selected}`}</strong>${context?'<span class="captured">Captured request</span>':`<span>${fmt(values[state.selected-1])} tokens</span>`}<span class="muted">${context?'vs previous +500':`Turn ${state.selected*2-1}`}</span></span><span class="muted">input ${values[state.selected-1].toLocaleString('en-US')}<span>Cache hit ${state.count>12?'99.9':'97.8'}%</span></span></div>`;
}
function occupancy() {
  const total=totals().at(-1), split=shares(state.count-1), window=state.count>12?1e6:128000;
  return `<section class="paper"><div class="paper-head"><h2>Current occupancy</h2><small>#${state.count} / ${fmt(window)} window</small></div><div class="occupancy"><div class="capacity"><strong>${fmt(total)}</strong><span>/ ${fmt(window)} tokens</span></div><div class="composition">${split.map((share,index)=>`<i style="${color(index)};width:${share*total/window*100}%"></i>`).join('')}</div><div class="capacity-axis"><span>Used ${fmt(total)}</span><span>Free ${fmt(window-total)}</span></div><div class="category-list">${categories.map((category,index)=>`<div>${dot(index)}<span>${category[1]}</span><span class="value">≈${fmt(total*split[index])}</span></div>`).join('')}</div></div><p class="footnote">Total uses provider metering; category values are estimates.</p></section>`;
}
function mapping() {
  return `<section class="paper secondary-card"><div class="paper-head"><h2>同一套分类色，贯穿三个视图</h2></div><div class="mapping">${categories.map((category,index)=>`<div><i class="mapping-color" style="${color(index)}"></i><strong>${category[2]}</strong><small>${category[1]}</small></div>`).join('')}</div></section>`;
}
function overview() {
  return `<div class="view-inner"><div class="overview-grid"><section class="paper"><div class="paper-head"><h2>Context evolution <small>Requests: ${state.count}</small></h2><button class="text-link" data-go="context">Inspect context →</button></div>${legend()}${chart()}<p class="footnote">Categories are estimates; the request total uses provider input when recorded.</p></section>${occupancy()}</div>${mapping()}</div>`;
}
function context() {
  const total=totals()[state.selected-1], split=shares(state.selected-1);
  return `<div class="view-inner"><section class="paper context-history"><div class="paper-head"><h2>Request history <select class="request-picker" aria-label="选择请求">${Array.from({length:state.count},(_,i)=>`<option value="${i+1}" ${state.selected===i+1?'selected':''}>Request #${i+1} / ${state.count}${i+1===state.count?' · Latest':''}</option>`).join('')}</select></h2><div class="segmented"><button aria-pressed="true">Cumulative composition</button><button aria-pressed="false" disabled title="本演示比较累计组成的配色与布局">Net change</button></div></div>${chart(true)}</section><section class="paper secondary-card"><div class="paper-head"><h2>Request content</h2><small>Compared with request #${Math.max(1,state.selected-1)}</small></div><div class="context-body"><div class="request-line"><strong>Request #${state.selected}${state.selected===state.count?' · latest':''}</strong><span>input ${total.toLocaleString('en-US')}</span><span>custom-endpoint · deepseek-flash</span></div><div class="composition">${split.map((share,index)=>`<i style="${color(index)};width:${share*100}%"></i>`).join('')}</div><div class="folds">${categories.map((category,index)=>`<details><summary>${dot(index)}<span>${category[1]}</span><small>Items: ${[1,40,3,2,1,state.selected-1,state.selected*2][index]}</small><span class="value">≈${fmt(total*split[index])}</span><span class="share">${(split[index]*100).toFixed(1)}%</span></summary><p>该分类使用${category[2]}的专属颜色，示例内容仅用于演示折叠和分类对应关系。</p></details>`).join('')}</div><p class="footnote">Category tokens are estimates allocated within provider input. Retained previews may differ from the request.</p></div></section></div>`;
}
function trajectory() {
  const rows=[
    [2,'User','检查请求上下文中的 token 统计，并统一 Run 视图的分类配色。','',1],
    [0,'System','System prompt · Request #1','',1],
    [5,'Message','先核对供应商 input 与缓存读取，再检查图表和分类明细。','',1],
    [6,'Tool','Read File: request-diagnostics.ts','→ Read recorded model context and provider usage.',2],
    [6,'Tool','Read File: .agents/skills/design/SKILL.md','→ Loaded visual and interaction guidance.',2],
    [0,'System','System prompt · Request #2','',3],
    [5,'Message','请求总量使用供应商计量，分类保留估算说明。','',3],
    [3,'Context','Injected context · Workspace configuration updated','',3],
    [6,'Tool','Run Command: typecheck','→ Type checking completed successfully.',4],
    [0,'System','System prompt · Request #3','',5],
    [5,'Message','接下来比较短历史的柱宽，以及三个视图的颜色对应。','',5],
    [6,'Tool','Read File: missing-file.ts','→ ENOENT: no such file or directory',6,true],
    [2,'User','配色先看方案，确认后再实施。','',7],
    [0,'System','System prompt · Request #4','',7],
    [5,'Message','已准备三套方案，可以切换浅色、深色与请求数量。','',7],
    [6,'Tool','Render preview: Run palette options','→ Standalone HTML preview ready.',8],
    [0,'System','System prompt · Request #5','',9],
    [5,'Message','同一组分类色应用于图例、堆叠柱和轨迹标签。','',9],
  ];
  const lanes=[[2,0,0,0,3,0,2,0],[5,5,5,5,5,5,5,5],[6,6,6,6,6,6,6,6]];
  return `<div class="trajectory-toolbar"><span>Duration</span><span>Turns</span><span>Calls</span><strong>All</strong><span>Conversation</span><span>Tools</span><span>Errors</span></div><div class="trajectory-strip"><div class="lane-names"><span>Input</span><span>Model</span><span>Tools</span></div><div class="lanes">${lanes.map((lane,laneIndex)=>`<div class="lane">${Array.from({length:40},(_,i)=>`<i style="${color(lane[i%lane.length])};left:${i/40*99}%;${laneIndex===2&&i===25?'background:var(--danger)':''}"></i>`).join('')}</div>`).join('')}</div></div><div class="trajectory-rows">${rows.map(([category,label,text,detail,turn,error],index)=>`<div class="trajectory-row" data-error="${!!error}" style="${color(category)}"><span class="turn">${index===0||turn!==rows[index-1][4]?`Turn ${turn}`:''}</span><span class="badge">${label}</span><span class="trajectory-text">${text}${detail?`<small>${detail}</small>`:''}</span><span class="trajectory-time">${category===6?'120ms':''}</span></div>`).join('')}</div>`;
}
function render() {
  document.documentElement.dataset.mode=state.mode;
  for(const key of ["mode","count","layout","width"])document.getElementById(key).value=String(state[key]);
  const palette=palettes[state.palette], colors=palette[state.mode];
  categories.forEach((category,index)=>document.documentElement.style.setProperty(`--cat-${category[0]}`,colors[index]));
  $('.palette-options').innerHTML=Object.entries(palettes).map(([key,value])=>`<button class="palette-option" type="button" data-palette="${key}" aria-pressed="${key===state.palette}"><strong>${value.name}</strong><span class="palette-subtitle">${value.subtitle}</span><span class="swatches">${value[state.mode].map(color=>`<i style="background:${color}"></i>`).join('')}</span></button>`).join('');
  $('#scheme-name').textContent=palette.name;
  $('#scheme-description').textContent=palette.description;
  $('#current-label').textContent=`${palette.name} · ${state.mode==='light'?'浅色':'深色'} · ${state.count} 次请求`;
  $('.workspace').dataset.width=state.width;
  $('.run-scope').textContent=`Requests: ${state.count}`;
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.view===state.view)));
  $('#view').innerHTML=state.view==='overview'?overview():state.view==='context'?context():trajectory();
  const notes={spaced:'等距细柱：单柱最高宽度 32px，保留完整时间轴。请求少时不再拉成色块；长历史自动恢复连续的细柱密度。',compact:'紧凑靠左：请求少时固定 32px 柱宽、20px 间距。右侧保留空白，适合嵌在窄面板里的短历史。',fill:'均分填充：原版对照。每次请求铺满自身槽位，少量请求会形成连续的大面积色块。'};
  $('#layout-note').textContent=notes[state.layout];
  $('.category-reference').innerHTML=categories.map((category,index)=>`<div><i style="${color(index)}"></i><strong>${category[2]}</strong><span>${colors[index]}</span></div>`).join('');
  $('#compare').textContent=state.palette==='original'?'返回刚才方案':'与原版对照';
  const params=new URLSearchParams({palette:state.palette,mode:state.mode,count:String(state.count),layout:state.layout,view:state.view,width:state.width});
  history.replaceState(null,'',`${location.pathname}?${params}`);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button)return;
  if(button.dataset.palette){state.palette=button.dataset.palette;if(state.palette!=='original')state.previous=state.palette;render();}
  if(button.dataset.view){state.view=button.dataset.view;render();}
  if(button.dataset.go){state.view=button.dataset.go;render();}
  if(button.dataset.request){state.selected=Number(button.dataset.request);render();}
  if(button.id==='compare'){state.palette=state.palette==='original'?state.previous:'original';render();}
});
document.addEventListener('change',event=>{
  const {id,value}=event.target;
  if(id==='mode')state.mode=value;
  if(id==='count'){state.count=Number(value);state.selected=state.count;}
  if(id==='layout')state.layout=value;
  if(id==='width')state.width=value;
  if(event.target.classList.contains('request-picker'))state.selected=Number(value);
  render();
});
const params=new URLSearchParams(location.search);
for(const key of ['palette','mode','layout','view','width'])if(params.has(key))state[key]=params.get(key);
if(!palettes[state.palette])state.palette='a';
if(!['light','dark'].includes(state.mode))state.mode='light';
if([3,5,12,113,300].includes(Number(params.get('count'))))state.count=Number(params.get('count'));
state.selected=state.count;
render();
window.runDesignReview={state,palettes,categories};
