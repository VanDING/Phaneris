'use strict';

// Design fixture only. No application APIs, credentials, or live session data.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  activity:'M3 12h4l3-8 4 16 3-8h4', chevron:'m9 5 7 7-7 7', left:'m14 6-6 6 6 6', right:'m10 6 6 6-6 6',
  arrow:'M5 12h14m-5-5 5 5-5 5', external:'M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon:'M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10', x:'m6 6 12 12M6 18 18 6',
  search:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15m5.5 13 5 5',
  alert:'m12 3 10 18H2L12 3m0 6v5m0 3v.1', check:'m5 12 4 4L19 6', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 2',
  copy:'M8 8h12v12H8V8m8-4H4v12',
  document:'M14 2H5v20h14V7l-5-5m0 0v6h5M8 12h8m-8 4h6', filter:'M3 4h18l-7 8v7l-4 2v-9L3 4',
  compress:'m3 3 6 6M3 9h6V3m12 18-6-6m0 6v-6h6', spark:'m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3',
  turn:'M8 5H5v8h13m-5-5 5 5-5 5', layers:'m12 3 10 5-10 5L2 8l10-5M2 12l10 5 10-5M2 16l10 5 10-5',
  refresh:'M20 8a8 8 0 1 0 0 8M20 3v5h-5', wrench:'M14 5a5 5 0 0 0-6 6l-5 5a2.8 2.8 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-3-3 2-4',
  coins:'M12 3c-5 0-8 2-8 4s3 4 8 4 8-2 8-4-3-4-8-4M4 7v5c0 2 3 4 8 4s8-2 8-4V7M4 12v5c0 2 3 4 8 4s8-2 8-4v-5'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.document}"/></svg>`;
const badge = (label, tone = 'neutral') => `<span class="status ${tone}">${esc(label)}</span>`;
const k = n => Math.abs(n) >= 1e6 ? `${(n/1e6).toFixed(2)}M` : Math.abs(n) >= 1000 ? `${(n/1000).toFixed(1)}K` : n.toLocaleString('en-US');
const money = n => n == null ? '未知' : `$${n.toFixed(n < .01 ? 4 : 3)}`;
const fmt = n => n.toLocaleString('en-US');
const categories = [
  {id:'system',label:'系统提示',tokens:7420,count:1,color:'var(--system)'},
  {id:'schemas',label:'工具定义',tokens:8660,count:12,color:'var(--schemas)'},
  {id:'user',label:'用户消息',tokens:3780,count:6,color:'var(--user)'},
  {id:'inject',label:'注入上下文',tokens:7140,count:4,color:'var(--inject)'},
  {id:'skill',label:'技能内容',tokens:3220,count:2,color:'var(--skill)'},
  {id:'assistant',label:'助手回复',tokens:18900,count:24,color:'var(--assistant)'},
  {id:'tool',label:'工具结果',tokens:37280,count:37,color:'var(--tool)'}
];
const totals = [18360,22400,25800,29100,32600,36800,41600,45900,51800,59500,66200,76500,91300,109200,57800,61900,65700,69800,72400,75600,78100,81600,84200,86400];
const ttfts = [730,850,810,840,760,920,1350,null,810,870,820,790,860,910,770,820,840,950,null,780,830,790,840,860];
const requestOutputs = [540,620,780,420,880,650,960,510,730,890,1020,640,850,710,480,690,910,830,740,680,1090,860,870,770];
const requests = totals.map((total,i) => {
  const seq=i+1;
  const fixed=categories.slice(0,5).map(c=>c.tokens * (seq < 9 && c.id==='skill' ? .5 : 1));
  const base=Math.min(total*.76,fixed.reduce((a,b)=>a+b,0));
  const fixedScale=base/fixed.reduce((a,b)=>a+b,0);
  const parts=fixed.map(n=>Math.round(n*fixedScale));
  parts.push(Math.round((total-base)*.336));
  parts.push(total-parts.reduce((a,b)=>a+b,0));
  if(seq===24) categories.forEach((c,j)=>parts[j]=c.tokens);
  return {seq,total,parts,turn:Math.min(6,Math.ceil(seq/4)),ttft:ttfts[i],output:requestOutputs[i],rate:i===7||i===18?null:Math.round(47+((i*7)%32)),captured:i!==7};
});
const features = [
  {id:'all',label:'全部功能'}, {id:'risk',label:'风险评估'}, {id:'outcome',label:'会话状态'}, {id:'labels',label:'语义标签'}, {id:'result',label:'大结果筛选'}
];
const outcomeNames={changed:'实际改变',unchanged:'保持原状',fallback:'回退处理',discarded:'已丢弃',unconfirmed:'未确认'};
const outcomeTones={changed:'accent',unchanged:'neutral',fallback:'warning',discarded:'neutral',unconfirmed:'neutral'};
const decisionSeeds=[
  ['risk','fallback','权限评估超时，按 Guarded 规则处理','read · SessionManager.ts',null,1],
  ['outcome','changed','将会话标记为待检查','会话终止事件',.0003,2],
  ['risk','unchanged','允许读取本地源文件','read · event-adapter.ts',.0002,1],
  ['result','changed','保留与启动延迟相关的结果','rg · 138 行检索输出',.0004,2],
  ['labels','changed','添加「性能」与「会话」标签','用户消息 · turn_b7a8',.0002,1],
  ['risk','unchanged','读取配置未触发权限升级','read · package.json',.0002,1],
  ['outcome','discarded','较早的状态建议被新轮次取代','会话状态刷新',.0001,1],
  ['result','unchanged','保留完整工具输出','read · 89 行',.0002,1],
  ['risk','changed','为文件写入请求用户确认','write · renderer/chat.tsx',.0003,1],
  ['labels','unchanged','保留现有标签','用户消息 · turn_9c3d',.0001,1],
  ['outcome','unchanged','会话继续执行','工具执行结束',.0002,1],
  ['result','unchanged','输出规模未达到筛选阈值','rg · 26 行',.0002,1],
  ['risk','unchanged','允许检索工作区文件','rg · response-buffer',.0002,1],
  ['outcome','unconfirmed','建议已返回，尚未记录处理结果','会话状态刷新',.0001,1],
  ['labels','changed','添加「调试」标签','用户消息 · turn_60ef',.0002,1],
  ['result','unchanged','保留完整诊断输出','shell · typecheck',.0003,1],
  ['risk','unchanged','允许读取工作区说明','read · AGENTS.md',.0002,1],
  ['outcome','unchanged','维持当前执行状态','请求完成事件',.0001,1]
];
const decisions=decisionSeeds.map((a,i)=>({id:`dec_${(18-i).toString().padStart(3,'0')}`,feature:a[0],outcome:a[1],title:a[2],trigger:a[3],cost:a[4],attempts:a[5],time:`00:${(45-Math.floor(i/6)).toString().padStart(2,'0')}:${(38-i*2%60).toString().padStart(2,'0')}`,turnId:`turn_${['b7a8c2','9c3d40','60ef91'][Math.floor(i/6)]}`,requestSeq:Math.max(1,24-i)}));
const decisionCost=decisions.reduce((s,d)=>s+(d.cost||0),0);
const rateSamples=requests.filter(r=>r.rate!=null);
const weightedRate=rateSamples.reduce((s,r)=>s+r.output,0)/rateSamples.reduce((s,r)=>s+r.output/r.rate,0);
const state={tab:'overview',scenario:'complete',request:24,category:'tool',item:'tool-1',search:'',sort:'order',contentMode:'read',trendMode:'total',outcome:'all',feature:'all',decision:'dec_018',readerOpen:false,detailOpen:false,overviewRequest:24};
state.contextExpanded=new Set();
state.contextItemExpanded=new Set();
state.contextModes={};
const params=new URLSearchParams(location.search);
if(['overview','context','decisions','trajectory'].includes(params.get('tab')))state.tab=params.get('tab');
if(['complete','running','legacy','empty','error'].includes(params.get('scenario')))state.scenario=params.get('scenario');
if(params.get('theme')==='dark')document.documentElement.dataset.theme='dark';
if(params.get('width')==='panel')$('#workspace').dataset.width='panel';
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200)}
function updateUrl(){const p=new URLSearchParams({tab:state.tab,theme:document.documentElement.dataset.theme,width:$('#workspace').dataset.width,scenario:state.scenario});try{history.replaceState(null,'',`${location.pathname}?${p}`)}catch{/* A restricted file viewer may disallow replacing history; interactions still work. */}}
function currentRequest(){return requests[state.request-1]}
function setTab(tab){state.tab=tab;state.readerOpen=false;state.detailOpen=false;render();updateUrl()}
function selectRequest(seq){state.request=Math.max(1,Math.min(24,seq));state.readerOpen=false;render();updateUrl()}
function metric(label,value,note,ico){return `<div class="metric"><div class="metric-label">${icon(ico)}${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`}
function categoryKey(interactive=false){return categories.map(c=>interactive?`<button data-action="category-jump" data-value="${c.id}" title="查看${c.label}"><i class="category-dot" style="--cat:${c.color}"></i>${c.label}</button>`:`<span><i class="category-dot" style="--cat:${c.color}"></i>${c.label}</span>`).join('')}
function requestChart(scope='overview'){
  const selected=scope==='overview'?state.overviewRequest:state.request;
  const delta=scope==='context'&&state.trendMode==='delta';
  const max=delta?60000:128000;
  return `<div class="trend-chart" aria-label="${delta?'请求上下文净变化':'请求上下文累计组成'}"><div class="chart-y">${(delta?['+60K','+30K','0','−30K','−60K']:['128K','96K','64K','32K','0']).map(s=>`<span>${s}</span>`).join('')}</div><div class="plot"><div class="grid-lines"><i></i><i></i><i></i><i></i><i></i></div><div class="chart-bars">${requests.map((r,i)=>{
    const change=i?r.total-requests[i-1].total:r.total;
    const pct=r.total/max*100;
    const style=delta?`position:absolute;${change<0?'top:calc(50% - 11px)':'bottom:calc(50% + 11px)'};height:calc((100% - 22px) * ${Math.min(1,Math.abs(change)/max)/2})`:`height:${pct}%`;
    const stacks=delta?`<i style="--cat:${change<0?'var(--tool)':'var(--assistant)'};height:100%"></i>`:r.parts.map((n,j)=>`<i style="--cat:${categories[j].color};height:${n/r.total*100}%"></i>`).join('');
    return `<button class="chart-col ${r.seq===selected?'selected':''}" data-action="chart-select" data-scope="${scope}" data-value="${r.seq}" aria-label="请求 ${r.seq}，${delta?'净变化 '+(change>0?'+':'')+fmt(change):fmt(r.total)+' tokens'}" aria-pressed="${r.seq===selected}" title="请求 #${r.seq} · ${k(r.total)} tokens${r.seq===15?' · 已压缩':''}">${r.seq===15?'<span class="event-marker">压缩</span>':''}<span class="bar-stack" style="${style}">${stacks}</span><span class="x-label">${[1,4,8,12,16,20,24].includes(r.seq)?r.seq:''}</span></button>`;
  }).join('')}</div></div></div>`;
}
function overview(){
  const legacy=state.scenario==='legacy';
  const tt=ttfts.filter(v=>v!=null).sort((a,b)=>a-b);const median=(tt[10]+tt[11])/2;
  const totalTokens=totals.reduce((a,b)=>a+b,0)+requestOutputs.reduce((a,b)=>a+b,0);
  const r=requests[state.overviewRequest-1];
  return `<section class="view overview-view">
  <div class="summary-metrics">${metric('会话跨度','3m 42s','6 轮对话 · 86 条活动','clock')}${metric('首输出延迟 P50',legacy?'—':`${median} <small>ms</small>`,legacy?'历史记录未采集':`P95 950 ms · 22 / 24 样本`,'activity')}${metric('累计计量 tokens',k(totalTokens),'输入 '+k(totals.reduce((a,b)=>a+b,0))+' · 输出 '+k(requestOutputs.reduce((a,b)=>a+b,0)),'layers')}${metric('工具调用','37 <small>次</small>','1 次失败 · 后续已恢复','wrench')}${metric('已知费用','$0.1842',legacy?'费用记录不完整':'+ 2 次费用未知 · 含决策费用','coins')}</div>
  <div class="overview-grid">
    <section class="paper"><div class="paper-head"><h3>上下文演变 <span class="muted">24 次请求</span></h3><button class="text-button" data-action="open-context">检查上下文${icon('right')}</button></div><div class="chart-key">${categoryKey()}</div>${requestChart()}<div class="trend-selection"><span><strong>请求 #${r.seq}</strong><span class="num">${k(r.total)} tokens</span><span class="muted">第 ${r.turn} 轮</span></span><button class="text-button" data-action="inspect-overview">查看此请求${icon('right')}</button></div><p class="chart-footnote">分类为估算；#15 发生压缩，回收 51.4K tokens。</p></section>
    <section class="paper"><div class="paper-head"><h3>最新请求占用</h3><span class="muted">#24 / 128K 窗口</span></div><div class="composition-body"><div class="capacity-line"><strong>86.4K</strong><span>/ 128K tokens</span><span class="capacity-percent">67.5%</span></div><div class="composition-bar" aria-label="最新上下文占用 67.5%">${categories.map(c=>`<button style="--cat:${c.color};width:${c.tokens/128000*100}%" data-action="category-jump" data-value="${c.id}" title="${c.label} · 约 ${k(c.tokens)}" aria-label="查看${c.label}"></button>`).join('')}<i class="free-space"></i></div><div class="capacity-axis"><span>已用 86.4K</span><span>空余 41.6K</span></div><div class="composition-legend">${categories.map(c=>`<button class="legend-item" data-action="category-jump" data-value="${c.id}"><i class="category-dot" style="--cat:${c.color}"></i><span>${c.label}</span><span>≈${k(c.tokens)}</span></button>`).join('')}</div><p class="mini-note">总量为供应商计量；分项为上下文估算。</p></div></section>
  </div>
  <div class="overview-bottom"><section class="paper"><div class="paper-head"><h3>输出表现</h3><span class="muted">客户端观测 · ${legacy?'无有效样本':'22 / 24 有效样本'}</span></div><div class="performance-body"><div><strong>${legacy?'—':weightedRate.toFixed(1)}</strong> <span class="small muted">tokens / s · 加权平均</span></div>${legacy?'<p class="muted small" style="padding:15px 0">旧记录没有首输出时刻，无法恢复此指标。</p>':performanceChart()}<p class="mini-note">输出速率按输出 tokens / 首输出至流结束时长计算，缺失样本留空。</p></div></section>
    <section class="paper"><div class="paper-head"><h3>决策影响</h3><button class="text-button" data-tab="decisions">查看全部${icon('right')}</button></div><div class="decision-overview"><div class="decision-numbers"><strong>${legacy?'—':'18'}</strong><span>个决策事项</span><span class="muted">/ 20 次辅助请求</span><span class="spacer"></span><span class="num">${money(decisionCost)}</span></div><div class="decision-impact" aria-hidden="true"><i style="--cat:var(--accent);width:27.78%"></i><i style="--cat:var(--strong-line);width:55.56%"></i><i style="--cat:var(--schemas);width:5.55%"></i><i style="--cat:var(--line);width:11.11%"></i></div><div class="decision-summary-row"><span><i class="category-dot" style="--cat:var(--accent)"></i>5 实际改变</span><span><i class="category-dot" style="--cat:var(--strong-line)"></i>10 保持原状</span><span><i class="category-dot" style="--cat:var(--schemas)"></i>1 回退</span></div><div class="decision-highlight">${icon('alert')}<p>风险评估请求超过 2 秒时限<small>已使用既有规则处理；1 次请求费用未知</small></p><button class="text-button" data-action="open-fallback">查看${icon('right')}</button></div></div></section></div>
  <div class="overview-info-grid"><section class="paper diagnostic-card"><div class="paper-head"><h3>运行诊断与活动摘要</h3><button class="text-button" data-tab="trajectory">查看 Trajectory${icon('right')}</button></div><div class="info-card-body"><dl class="environment-grid"><div><dt>当前目标</dt><dd>定位会话启动至首段可见输出之间的延迟。</dd></div><div><dt>已执行操作</dt><dd>读取会话管理与事件适配，检索缓冲策略，运行类型检查。</dd></div><div><dt>需关注的记录</dt><dd>1 次工具读取失败；最慢工具耗时 2.8 秒。</dd></div><div><dt>已终止 / 未结算的模型请求</dt><dd>24 / 0</dd></div><div><dt>上下文事件</dt><dd>1 次压缩，1 次提示版本变更。</dd></div><div><dt>预算与重复动作</dt><dd>本示例未提供任务预算和重复动作信号。</dd></div></dl><div class="activity-label"><span>活动形态 · 86 条记录，按组覆盖</span><span>模型 / 工具 / 失败</span></div><button class="activity-shape activity-link" data-tab="trajectory" aria-label="查看活动形态对应的 Trajectory">${Array.from({length:18},(_,i)=>`<span style="background:${i===12?'var(--danger)':i%3?'var(--schemas)':'var(--assistant)'}" title="活动分组 ${i+1}"></span>`).join('')}</button><p class="mini-note">点击活动形态，进入保留的轨迹视图。</p></div></section>
  <section class="paper environment-card"><div class="paper-head"><h3>运行环境与计量口径</h3><span class="muted">本地工作区</span></div><div class="info-card-body"><dl class="environment-grid"><div><dt>主模型 / 服务</dt><dd>deepseek-flash / deepseek-official</dd></div><div><dt>权限模式</dt><dd>Guarded</dd></div><div><dt>工作目录</dt><dd class="mono">E:\\Phaneris</dd></div><div><dt>会话跨度</dt><dd>00:42:00 – 00:45:42（含请求间等待）</dd></div><div><dt>计量范围</dt><dd>累计 token 包含重复上下文；不代表当前窗口大小。</dd></div><div><dt>费用覆盖</dt><dd>已知费用含决策调用，另有 2 次请求费用未知。</dd></div></dl></div></section></div></section>`;
}
function performanceChart(){
  let segments=[],line=[];
  requests.forEach((r,i)=>{if(r.rate==null){if(line.length)segments.push(line);line=[]}else line.push(`${28+i*19},${75-(r.rate-40)*1.5}`)});if(line.length)segments.push(line);
  return `<svg class="line-chart" viewBox="0 0 480 92" preserveAspectRatio="none" role="img" aria-label="各请求平均输出速率，8 与 19 缺少计时"><path class="chart-rule" d="M28 14H475M28 44H475M28 74H475"/><text x="0" y="17">80</text><text x="0" y="47">60</text><text x="0" y="77">40</text>${segments.map(s=>`<polyline class="rate-line" points="${s.join(' ')}"/>`).join('')}<text x="26" y="91">#1</text><text x="230" y="91">#12</text><text x="453" y="91">#24</text></svg>`;
}

function contextItems(category){
  const r=currentRequest();const catIndex=categories.findIndex(c=>c.id===category);const scale=r.parts[catIndex]/categories[catIndex].tokens;
  const base={
    system:[['系统提示 v2','Phaneris 的身份、执行约定与会话规则','runtime','system',7420]],
    schemas:[['read','读取本地文件，可处理文本与图片附件','原生工具','schema-read',1480],['shell','在当前工作目录运行命令','原生工具','schema-shell',1310],['edit','以精确文本匹配修改文件','原生工具','schema-edit',1120],['write','新建文件或写入完整内容','原生工具','schema-write',1010],['web_search','检索公开信息并返回引用','MCP · web','schema-web',980],['其他工具定义','7 项定义，共享同一版本快照','原生 / MCP','schema-other',2760]],
    user:[['本轮用户请求','继续定位会话开始后首个输出为什么延迟，先保证数据链路正确。','turn_b7a8c2','user-1',920],['上一轮补充约束','保留已有改动，暂时不要推送或重启应用。','turn_9c3d40','user-2',640],['更早的会话请求','历史请求内容与范围说明。','会话历史','user-3',2220]],
    inject:[['AGENTS.md','仓库协作约定、Git 远程规则与验证要求','项目指令','inject-1',3280],['环境上下文','工作目录、系统平台及当前会话环境','runtime','inject-2',1360],['会话延续摘要','已完成的排查与待验证的结论','会话摘要','inject-3',1710],['文件引用','当前任务附带的文件与定位信息','引用','inject-4',790]],
    skill:[['frontend-design / SKILL.md','界面设计的阅读层级、视觉方向与实现约束','本地技能','skill-1',1840],['impeccable / operate.md','操作型界面的密度、组件与状态规范','本地技能','skill-2',1380]],
    assistant:[['定位启动链路中的等待','已检查传输事件与渲染更新，接下来验证首段思考到达后的显示。','回答','assistant-1',1280],['检查 response buffer 的交付','调用 read 读取缓冲策略和事件适配。','工具调用','assistant-2',640],['启动延迟的排查思路','将供应商响应与客户端首段可见内容分开观测。','思考','assistant-3',1180],['更早的助手回复','21 条保留回复的分组，展开读取原文。','会话历史','assistant-4',15800]],
    tool:[['read · SessionManager.ts','会话管理与消息事件分发逻辑；含首段事件处理。','原生工具','tool-1',8240],['rg · response-buffer','找到 23 处匹配，集中在渲染与传输适配。','原生工具','tool-2',5280],['read · event-adapter.ts','事件类型转换、消息段识别与输出派发。','原生工具','tool-3',4960],['shell · typecheck:all','类型检查完成，进程退出码 0。','原生工具','tool-4',3610],['read · AGENTS.md','协作约定与仓库约束。','原生工具','tool-5',3280],['更早的工具结果','32 条工具调用与结果，可继续按时间查看。','会话历史','tool-6',11910]]
  };
  const entries=base[category].slice(0,Math.min(base[category].length,categoryCount(category,r)));
  const entrySum=entries.reduce((s,a)=>s+a[4],0),normalized=categories[catIndex].tokens/entrySum;
  return entries.map((a,i)=>({title:a[0],description:a[1],source:a[2],id:a[3],tokens:Math.max(1,Math.round(a[4]*scale*normalized)),intro:Math.max(1,r.seq-(i===0?0:i*2)),order:i}));
}
function categoryCount(id,r){return id==='system'?1:id==='schemas'?12:id==='user'?r.turn:id==='inject'?Math.min(4,Math.ceil(r.seq/6)):id==='skill'?(r.seq<9?1:2):id==='assistant'?r.seq:Math.ceil(37*r.seq/24)}
function context(){
  const r=currentRequest(),delta=r.total-(requests[r.seq-2]?.total||0);
  return `<section class="view context-view">
  <section class="paper context-trend"><div class="paper-head"><div class="context-history-title"><h3>请求历史</h3><select id="request-picker" class="request-picker" aria-label="选择模型请求">${requests.map(d=>`<option value="${d.seq}" ${d.seq===r.seq?'selected':''}>请求 #${d.seq} / 24${d.seq===24?' · 最新':''}</option>`).join('')}</select></div><div class="segmented" aria-label="趋势模式"><button data-action="trend-mode" data-value="total" aria-pressed="${state.trendMode==='total'}">累计组成</button><button data-action="trend-mode" data-value="delta" aria-pressed="${state.trendMode==='delta'}">净变化</button></div></div>${requestChart('context')}<div class="trend-selection"><span><strong class="num">${k(r.total)} tokens</strong>${badge(r.captured?'已记录请求':'重建快照',r.captured?'success':'warning')}<span class="muted num">比前次 ${delta>0?'+':''}${k(delta)}</span></span><span class="muted">${state.scenario==='legacy'?'供应商总量未记录':'input '+fmt(r.total)+' · output '+fmt(r.output)}</span></div></section>
  ${contextBrowser()}
  <div class="context-events"><strong>上下文事件</strong><button class="event-link" data-action="event" data-value="9">${icon('spark')}#9 载入技能 <span class="num">+3.2K</span></button><button class="event-link" data-action="event" data-value="15">${icon('compress')}#15 压缩历史 <span class="num">−51.4K</span></button><button class="event-link" data-action="event" data-value="19">${icon('document')}#19 载入项目指令</button></div></section>`;
}
function signed(n){return `${n>0?'+':''}${k(n)}`}
function changeChip(n,extra=''){return n?`<span class="change-chip ${n>0?'positive':'negative'} ${extra}">${signed(n)}</span>`:''}
function contextBrowser(){
  const r=currentRequest(),previous=requests[r.seq-2];
  const allOpen=categories.every(c=>state.contextExpanded.has(c.id));
  return `<section class="paper context-fold-browser" aria-label="请求内容浏览器"><div class="paper-head"><h3>请求内容</h3><div class="fold-card-actions"><span class="muted">${previous?'对比请求 #'+previous.seq:'首个请求'}</span><button class="quiet-button" data-action="fold-all">${allOpen?'收起分类':'展开分类'}</button></div></div><div class="fold-browser-body"><div class="fold-request-line"><strong>请求 #${r.seq}${r.seq===24?' · 最新':''}</strong><span class="muted num">估算 ≈${k(r.parts.reduce((a,b)=>a+b,0))} tokens</span></div><div class="fold-composition" role="img" aria-label="请求 ${r.seq} 的上下文组成">${categories.map((c,i)=>`<span style="background:${c.color};width:${r.parts[i]/r.total*100}%" title="${c.label} · 约 ${k(r.parts[i])}"></span>`).join('')}</div><div class="context-folds">${categories.map((c,i)=>{
    const count=categoryCount(c.id,r),countChange=previous?count-categoryCount(c.id,previous):0,tokenChange=previous?r.parts[i]-previous.parts[i]:0;
    return `<details class="context-fold" data-context-category="${c.id}" ${state.contextExpanded.has(c.id)?'open':''}><summary><span class="fold-row-label">${icon('chevron')}<i class="category-dot" style="--cat:${c.color}"></i><strong>${c.label}</strong><span class="fold-count num">${count} 项</span>${changeChip(countChange,'count-change')}</span><span class="fold-row-values">${changeChip(tokenChange)}<span class="fold-tokens num">≈${k(r.parts[i])}</span><span class="fold-share num">${(r.parts[i]/r.total*100).toFixed(1)}%</span></span></summary><div class="fold-category-body"><p class="fold-category-note">${count>contextItems(c.id).length?'示例将部分历史条目合并展示。':'按当前请求中保留的内容展示。'} 分类 token 为估算。</p>${contextItems(c.id).map(item=>contextEntry(item,c.id)).join('')}</div></details>`;
  }).join('')}</div></div></section>`;
}
function contextEntry(item,category){
  const mode=state.contextModes[item.id]||'read';
  return `<details class="context-entry" data-context-item="${item.id}" ${state.contextItemExpanded.has(item.id)?'open':''}><summary>${icon('chevron')}<span class="entry-label">${esc(item.title)}</span><span class="entry-source">${esc(item.source)}</span><span class="num entry-tokens">≈${k(item.tokens)}</span></summary><div class="fold-entry-body"><div class="fold-entry-toolbar"><span class="muted small">请求 #${item.intro} 引入 · 只读</span><div class="flex"><div class="segmented" aria-label="${esc(item.title)} 的阅读模式">${[['read','阅读'],['raw','原文'],['diff','变化']].map(([value,label])=>`<button data-action="fold-mode" data-value="${value}" data-item="${item.id}" aria-pressed="${mode===value}">${label}</button>`).join('')}</div><button class="icon-button" data-action="copy-context-item" data-category="${category}" data-item="${item.id}" aria-label="复制 ${esc(item.title)}">${icon('copy')}</button></div></div><div class="reader-content">${mode==='raw'?`<pre>${esc(rawContent(item))}</pre>`:mode==='diff'?diffContent(item):richContent(item)}</div></div></details>`;
}
function reader(item){
  const codeLike=item.id.startsWith('tool')||item.id.startsWith('schema');
  return `<div class="reader-heading"><div><button class="mobile-back" data-action="reader-back">${icon('left')}返回内容列表</button><h4>${esc(item.title)}</h4><p class="reader-subtitle">${esc(item.source)} · 请求 #${state.request} 中保留的内容</p></div><button class="icon-button" data-action="copy-content" aria-label="复制当前内容" title="复制内容">${icon('copy')}</button></div><div class="reader-toolbar"><span class="num">约 ${fmt(item.tokens)} tokens · 分类估算</span><div class="segmented" aria-label="内容阅读模式"><button data-action="content-mode" data-value="read" aria-pressed="${state.contentMode==='read'}">${codeLike?'结构':'阅读'}</button><button data-action="content-mode" data-value="raw" aria-pressed="${state.contentMode==='raw'}">原文</button><button data-action="content-mode" data-value="diff" aria-pressed="${state.contentMode==='diff'}">变化</button></div></div><div class="reader-content">${state.contentMode==='diff'?diffContent(item):state.contentMode==='raw'?`<pre>${esc(rawContent(item))}</pre>`:richContent(item)}</div><div class="reader-tagline">只读检查 · 不修改会话上下文${!currentRequest().captured?' · 内容由保留记录重建':''}</div>`;
}
function rawContent(item){
  if(item.id==='tool-1')return 'Tool: read\nStatus: succeeded\nArguments:\n{\n  "path": "packages/server-core/src/sessions/SessionManager.ts",\n  "offset": 4280,\n  "limit": 80\n}\n\nResult excerpt (design fixture):\n// 事件到达后，先更新当前消息段，再通知 renderer。\nasync function deliverEvent(event) {\n  const message = mergeContentBlock(event);\n  await publishSessionDelta(message);\n}\n\n// 保存状态不应阻塞首段内容的可见更新。\nschedulePersistence(session);\n\n[设计示例：不是该文件的实际源码，仅展示原文阅读布局。]';
  if(item.id.startsWith('schema'))return JSON.stringify({name:item.title,description:item.description,parameters:{type:'object',properties:{path:{type:'string'},offset:{type:'number'},limit:{type:'number'}},required:['path']}},null,2);
  if(item.id==='tool-4')return '$ bun run typecheck:all\n\n@phaneris/shared: typecheck passed\n@phaneris/ui: typecheck passed\n@phaneris/electron: typecheck passed\n\nProcess exited with code 0.\n[以上为原型示例输出]';
  if(item.id.startsWith('tool'))return `${item.title}\n\n${item.description}\n\npackages/ui/src/components/chat/response-buffering.ts\npackages/shared/src/agent/backend/pi/event-adapter.ts\n\n[原型中展示结果节选；实际实施应按保留内容完整读取。]`;
  if(item.id==='system')return 'You are Phaneris, a local-first agent workspace.\n\n# Execution contract\nFollow the current user request until the authorized work is complete.\nPreserve unrelated local changes.\nDistinguish observed evidence from inference.\n\n# Current workspace\nWorking directory: E:\\Phaneris\nPermission mode: Guarded\n\n[设计示例：用于检查系统提示的阅读排版。]';
  if(item.id==='inject-1')return '# Repository collaboration defaults\n\norigin is this project and the only push target.\nUse SSH for GitHub Git operations.\nDo not bypass the pre-push validation suite.\n\n# 协作原则\n中文沟通。只做被要求的事。\n数字必须有据可查，缺失信息明确保留。\n\n[设计示例节选]';
  return `${item.title}\n\n${item.description}\n\n${item.id.startsWith('user')?'先确认采集、传输、持久化与客户端展示的实际边界，再决定是否调整缓冲策略。不要把没有采集的数据视为零。':'本条目来自保留的会话记录。它在当前请求中仍然可见，可以用请求历史判断何时引入，以及是否在压缩后保留。'}\n\n[固定设计示例，非真实会话内容。]`;
}
function richContent(item){
  if(item.id==='tool-1')return `<div class="reader-facts">${badge('执行成功','success')}<span class="muted">read</span><span class="num muted">24 ms</span></div><h4>调用参数</h4><div class="code-block">path: packages/server-core/src/sessions/SessionManager.ts\noffset: 4280\nlimit: 80</div><h4>工具结果 <span class="muted small">示例节选</span></h4><pre>${esc(rawContent(item).split('Result excerpt (design fixture):\n')[1])}</pre>`;
  if(item.id.startsWith('schema'))return `<div class="reader-facts">${badge('工具定义')}<span class="source-chip">${esc(item.source)}</span></div><h4>用途</h4><p>${esc(item.description)}</p><h4>参数 Schema</h4><div class="code-block">${esc(rawContent(item))}</div><p class="small muted">工具定义与工具执行结果分别归类，便于区分固定开销与会话增长。</p>`;
  if(item.id==='tool-4')return `<div class="reader-facts">${badge('执行成功','success')}<span class="muted">退出码 0</span></div><pre>${esc(rawContent(item))}</pre>`;
  if(item.id.startsWith('tool'))return `<div class="reader-facts">${badge('执行成功','success')}<span class="muted">${esc(item.source)}</span></div><h4>返回内容</h4><pre>${esc(rawContent(item))}</pre>`;
  if(item.id==='system')return `<h4>执行约定</h4><p>完成用户当前授权的任务，保留无关的本地改动，明确区分事实、推断与未采集数据。</p><h4>当前环境</h4><div class="code-block">Workspace: E:\\Phaneris\nPermission: Guarded</div><h4>内容来源</h4><p>运行时生成的系统提示快照。不同请求可能引用不同版本。</p><p class="small muted">以上为排版示例；选择“原文”查看示例提示文本。</p>`;
  return `<h4>${esc(item.title)}</h4>${rawContent(item).split('\n\n').slice(1).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('')}`;
}
function diffContent(item){
  if(state.request===1)return '<p class="muted">这是首个请求，没有可比较的前次快照。</p>';
  if(state.request===15)return '<div class="diff-lines"><p class="removed">− 更早的会话消息与工具结果已压缩</p><p>+ 压缩后的会话延续摘要</p></div><p class="small muted">整个请求净减少 51.4K tokens。本条目若被保留，其原文仍可通过阅读模式检查。</p>';
  if(item.order===0)return `<div class="diff-lines"><p>+ #${state.request} 引入 · ${esc(item.title)}</p><p>+ 约 ${k(item.tokens)} tokens</p></div><p class="small muted">变化模式为拟议交互，实际逐项差异需要稳定条目身份与请求快照。</p>`;
  return '<div class="reader-facts">'+badge('未变化')+'</div><p>此条目在前一次请求中已存在，当前示例没有文本变化。</p>';
}

function featureLabel(id){return features.find(f=>f.id===id)?.label||id}
function filteredDecisions(){return decisions.filter(d=>(state.feature==='all'||d.feature===state.feature)&&(state.outcome==='all'||d.outcome===state.outcome))}
function decisionView(){
  const scoped=decisions.filter(d=>state.feature==='all'||d.feature===state.feature),items=filteredDecisions();
  const selected=items.find(d=>d.id===state.decision)||items[0];if(selected)state.decision=selected.id;
  return `<section class="view decision-view">
  <div class="decision-overview-grid"><section class="paper decision-results-card"><div class="paper-head"><h3>处理结果</h3><span class="muted">${featureLabel(state.feature)}</span></div><div class="decision-results-body"><div class="decision-numbers"><strong>${scoped.length}</strong><span>个事项</span><span class="muted">/ ${scoped.reduce((s,d)=>s+d.attempts,0)} 次辅助请求</span></div><div class="decision-impact" aria-label="实际处理结果分布">${Object.keys(outcomeNames).map(key=>`<i style="--cat:${decisionColor(key)};width:${scoped.filter(d=>d.outcome===key).length/Math.max(1,scoped.length)*100}%"></i>`).join('')}</div><div class="decision-result-legend">${Object.entries(outcomeNames).map(([key,label])=>`<span class="result-legend-entry"><i class="category-dot" style="--cat:${decisionColor(key)}"></i><span>${label}</span><strong class="num">${scoped.filter(d=>d.outcome===key).length}</strong></span>`).join('')}</div><div class="decision-result-cost"><span>已知辅助费用</span><span><strong class="num">${money(scoped.reduce((s,d)=>s+(d.cost||0),0))}</strong>${scoped.some(d=>d.cost==null)?`<span class="muted"> + ${scoped.filter(d=>d.cost==null).length} 次费用未知</span>`:''}</span></div><p class="mini-note">实际改变以处理记录为准；辅助费用已包含在会话总费用中。</p></div></section>
  <section class="paper decision-features-card"><div class="paper-head"><h3>功能分布</h3><span class="muted">当前会话</span></div><div class="decision-feature-table"><div class="decision-feature-columns"><span>功能</span><span>事项</span><span>改变</span><span>已知费用</span></div>${features.filter(f=>f.id!=='all').map(f=>{const ds=decisions.filter(d=>d.feature===f.id);return `<div class="decision-feature-row"><span>${f.label}</span><span class="num">${ds.length}</span><span class="num">${ds.filter(d=>d.outcome==='changed').length}</span><span class="num">${money(ds.reduce((s,d)=>s+(d.cost||0),0))}${ds.some(d=>d.cost==null)?' + ?':''}</span></div>`}).join('')}</div></section></div>
  <section class="paper decision-ledger"><div class="paper-head"><h3>决策事项 <span class="muted">${items.length} 条</span></h3><div class="decision-ledger-actions"><select id="decision-feature" aria-label="按功能筛选决策">${features.map(f=>`<option value="${f.id}" ${state.feature===f.id?'selected':''}>${f.label}</option>`).join('')}</select><select id="decision-outcome" aria-label="按实际处理结果筛选">${[['all','全部结果'],...Object.entries(outcomeNames)].map(([id,label])=>`<option value="${id}" ${state.outcome===id?'selected':''}>${label}</option>`).join('')}</select></div></div>
  <div class="decision-ledger-columns"><span>事项 / 触发</span><span>功能</span><span>实际处理</span><span>请求</span><span>已知费用</span><span>时间</span><span></span></div><div class="decision-ledger-rows">${items.length?items.map(d=>{const open=state.detailOpen&&state.decision===d.id;return `<div class="decision-ledger-item ${open?'is-open':''}"><button class="decision-ledger-row" data-action="decision-select" data-value="${d.id}" aria-expanded="${open}" aria-controls="detail-${d.id}"><span class="ledger-subject"><strong>${esc(d.title)}</strong><span>${esc(d.trigger)}</span></span><span class="ledger-feature">${featureLabel(d.feature)}</span><span class="ledger-outcome">${badge(outcomeNames[d.outcome],outcomeTones[d.outcome])}</span><span class="ledger-attempts num">${d.attempts}</span><span class="ledger-cost num">${money(d.cost)}</span><span class="ledger-time num">${d.time}</span>${icon('chevron')}</button>${open?`<article class="decision-detail" id="detail-${d.id}">${decisionDetail(d)}</article>`:''}</div>`}).join(''):'<div class="reader-empty">没有符合当前筛选的事项。<br>可在上方调整功能或处理结果。</div>'}</div></section><p class="coverage-note">范围：当前会话${state.feature!=='all'?' / '+featureLabel(state.feature):''}。结果筛选作用于事项列表；费用缺失保留为未知，未确认与已丢弃不计入实际改变。</p></section>`;
}
function decisionColor(key){return ({changed:'var(--accent)',unchanged:'var(--strong-line)',fallback:'var(--schemas)',discarded:'var(--line)',unconfirmed:'var(--muted)'})[key]}
function decisionDetail(d){
  const fallback=d.outcome==='fallback',changed=d.outcome==='changed',discard=d.outcome==='discarded',unknown=d.outcome==='unconfirmed';
  const recommendation=fallback?'未获得有效建议':d.feature==='outcome'?(changed||unknown?'建议将会话状态设为待检查':discard?'建议将会话标记为已完成':'建议维持当前执行状态'):d.feature==='labels'?(changed?'建议添加与当前任务相关的标签':'建议保留现有标签'):d.feature==='result'?(changed?'建议筛选与当前目标相关的工具结果':'建议保留完整工具结果'):changed?'建议对写入操作请求用户确认':'建议允许当前只读操作';
  const handled=fallback?'按 Guarded 既有规则处理本次权限请求。':discard?'建议到达时，新的用户轮次已经开始；该建议已丢弃。':unknown?'尚无调用方实际处理记录，当前无法确认是否生效。':changed?d.feature==='outcome'?'调用方已将会话状态更新为「待检查」。':d.feature==='labels'?'调用方已写入标签变更。':d.feature==='result'?'调用方已应用筛选后的结果。':'调用方已展示权限确认请求。':'调用方维持原有处理结果，本次判断没有改变行为。';
  const raw={id:d.id,feature:d.feature,source:{turnId:d.turnId,requestSeq:d.requestSeq},recommendation:fallback?null:{action:recommendation},application:unknown?null:{status:d.outcome,changed},attempts:d.attempts,costUsd:d.cost};
  return `<div class="decision-detail-head"><div class="flex"><h4>处理证据</h4><span class="small muted num">${d.id}</span></div></div>
  <div class="detail-body"><section class="evidence-step"><div class="evidence-label">${icon('turn')}触发来源</div><p>${esc(d.trigger)}</p><p class="detail-note">会话轮次 <code>${d.turnId}</code> · 主请求 #${d.requestSeq}</p></section>
  <section class="evidence-step"><div class="evidence-label">${icon('spark')}模型建议</div><p>${recommendation}</p>${fallback?'<p class="detail-note">辅助请求超过 2,000 ms 时限，未产生可用建议。</p>':'<p class="detail-note">建议只说明模型判断，不代表调用方已采用。</p>'}</section>
  <section class="evidence-step"><div class="evidence-label">${icon('check')}实际处理</div><p class="handling">${handled}</p><p class="detail-note">${fallback?'已记录回退路径；这不表示工具执行失败。':unknown?'后续记录到达前保留未确认状态。':discard?'未发生实际行为改变。':'依据持久化的调用方处理记录。'}</p></section>
  <details class="request-details"><summary>辅助请求与计量详情</summary><dl class="request-diagnostic"><dt>模型 / 服务</dt><dd>deepseek-flash / OpenRouter</dd><dt>请求结果</dt><dd>${fallback?'超时；回退处理':'已完成'}</dd><dt>客户端耗时</dt><dd class="num">${fallback?'2,004':'286'} ms</dd><dt>调用时限</dt><dd class="num">2,000 ms</dd><dt>输入 / 输出 tokens</dt><dd class="num">${fallback?'未完整记录':'846 / 82'}</dd><dt>已知费用</dt><dd class="num">${money(d.cost)}</dd><dt>费用来源</dt><dd>${fallback?'usage 未返回':'usage.cost'}</dd><dt>计费归属</dt><dd>已包含在会话总费用中</dd></dl><details class="raw-record"><summary>原始记录</summary><pre>${esc(JSON.stringify(raw,null,2))}</pre></details></details>
  <div class="detail-bottom"><button class="text-button" data-action="decision-context" data-value="${d.requestSeq}">查看相关上下文${icon('right')}</button></div></div>`;
}
function emptyView(){return `<div class="empty-state">${icon(state.scenario==='error'?'alert':'layers')}<h2>${state.scenario==='error'?'暂时无法加载运行记录':'会话还没有运行记录'}</h2><p>${state.scenario==='error'?'请求未能完成。已有记录不应显示为零；可以重新加载后继续检查。':'开始一次会话后，这里会显示运行概况、请求上下文与决策处理记录。'}</p><button class="outline-button" data-action="sample-recover">${icon('refresh')}${state.scenario==='error'?'重新加载示例':'查看示例会话'}</button></div>`}
function trajectoryReference(){return `<section class="view trajectory-reference-view"><div class="notice trajectory-reference-note">${icon('document')}<p>保留的 Trajectory 界面截图来自另一条历史示例会话，不与当前演示数字关联。</p></div><div class="paper trajectory-reference-frame"><img src="assets/trajectory-reference.png" alt="Phaneris 现有 Trajectory 界面截图，本轮未重设计"></div></section>`}
function legacyView(){
  const common=`<div class="notice">${icon('alert')}<p>这份历史记录的采集不完整。未采集的数据保留缺口，不推算实际处理结果。</p></div>`;
  if(state.tab==='decisions')return `<section class="view decision-view">${common}<div class="summary-metrics">${metric('历史辅助请求','20','仅请求层记录','turn')}${metric('实际改变','—','未记录实际处理','check')}${metric('回退处理','—','无法从请求结果推断','refresh')}${metric('已知辅助费用','$0.0014','另有 12 次费用未知','coins')}</div><section class="paper legacy-paper"><div class="paper-head"><h3>保留的调用记录</h3><span class="muted">示例节选 · 不计入实际改变</span></div>${['风险评估','会话状态','语义标签','大结果筛选'].map((name,i)=>`<details class="legacy-call"><summary><span>${name}</span>${badge(i===0?'请求超时':'请求完成',i===0?'warning':'neutral')}<span class="muted small">仅调用信息</span></summary><dl class="request-diagnostic"><dt>模型</dt><dd>deepseek-flash</dd><dt>费用</dt><dd>${i===0?'未知':'$0.0002'}</dd><dt>调用方处理</dt><dd>未记录</dd></dl><p class="small muted">请求完成或超时，均不能单独证明是否改变了行为。</p></details>`).join('')}</section></section>`;
  if(state.tab==='context')return `<section class="view context-view">${common}<section class="paper"><div class="paper-head"><h3>请求 #24 · 估算组成</h3><span class="muted">供应商 input 未记录</span></div><div class="chart-key">${categoryKey()}</div><div class="legacy-composition"><strong class="num">≈86.4K tokens</strong><div class="composition-bar">${categories.map(c=>`<span style="background:${c.color};width:${c.tokens/86400*100}%"></span>`).join('')}</div><p class="small muted">仅表示保留内容的估算，无法保证与当时实际发送的提示完全一致。</p></div></section><section class="paper legacy-reader"><div class="paper-head"><h3>已保留的系统提示</h3>${badge('原文可读')}</div><div class="reader-content"><pre>${esc(rawContent({id:'system'}))}</pre></div></section></section>`;
  return `<section class="view overview-view">${common}<div class="summary-metrics">${metric('会话跨度','3m 42s','根据记录起止时间','clock')}${metric('首输出延迟','—','历史未采集首输出时刻','activity')}${metric('输出速率','—','无法从总耗时恢复','layers')}${metric('工具调用','37','已保留的工具记录','wrench')}${metric('已知费用','$0.0214','部分请求费用未知','coins')}</div><section class="paper"><div class="paper-head"><h3>继续检查历史证据</h3></div><div class="legacy-links"><button class="outline-button" data-tab="context">重建上下文${icon('right')}</button><button class="outline-button" data-tab="decisions">查看历史辅助请求${icon('right')}</button></div><p class="chart-footnote">历史请求与现代决策事项分别呈现，不把未知、未采集和零混为一谈。</p></section></section>`;
}
function render(){
  $$('.run-tabs [data-tab]').forEach(b=>{const active=b.dataset.tab===state.tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1});
  $('#main-view').setAttribute('aria-labelledby',`tab-${state.tab}`);
  $('#header-status').innerHTML=state.scenario==='running'?'<i class="dot" style="color:var(--accent)"></i>运行中':state.scenario==='empty'?'等待运行':state.scenario==='error'?'记录不可用':'6 轮 · 24 次请求';
  $('#run-state').innerHTML=badge(({complete:'已完成',running:'运行中',legacy:'历史记录',empty:'等待运行',error:'记录不可用'})[state.scenario],({complete:'success',running:'accent',legacy:'neutral',empty:'neutral',error:'warning'})[state.scenario]);
  $('#scenario').value=state.scenario;
  const running=state.scenario==='running'?`<div class="running-strip">${icon('activity')}请求 #25 正在等待首输出。下方统计截至已完成的请求 #24。</div>`:'';
  $('#main-view').innerHTML=state.tab==='trajectory'?trajectoryReference():running+(['empty','error'].includes(state.scenario)?emptyView():state.scenario==='legacy'?legacyView():state.tab==='overview'?overview():state.tab==='context'?context():decisionView());
  $('#run-icon').innerHTML=icon('activity');
  $('#theme-toggle').innerHTML=icon(document.documentElement.dataset.theme==='dark'?'sun':'moon');
  $('#theme-toggle').setAttribute('aria-label',document.documentElement.dataset.theme==='dark'?'切换浅色模式':'切换深色模式');
  $$('.width-picker button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.width===$('#workspace').dataset.width)));
}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('已复制到剪贴板')}catch{toast('当前浏览器未授予剪贴板权限，可在原文中选择复制')}}
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.tab){setTab(b.dataset.tab);return}
  if(b.dataset.width){$('#workspace').dataset.width=b.dataset.width;state.readerOpen=false;state.detailOpen=false;render();updateUrl();return}
  const value=b.dataset.value;
  switch(b.dataset.action){
    case'open-context':state.request=24;setTab('context');break;
    case'inspect-overview':state.request=state.overviewRequest;setTab('context');break;
    case'open-fallback':state.feature='all';state.outcome='fallback';state.decision='dec_018';setTab('decisions');state.detailOpen=true;render();break;
    case'chart-select':if(b.dataset.scope==='overview'){state.overviewRequest=Number(value);render()}else selectRequest(Number(value));break;
    case'category-jump':state.contextExpanded.add(value);state.request=24;setTab('context');break;
    case'fold-all':{const allOpen=categories.every(c=>state.contextExpanded.has(c.id));state.contextExpanded=new Set(allOpen?[]:categories.map(c=>c.id));render();break}
    case'fold-mode':state.contextModes[b.dataset.item]=value;render();break;
    case'copy-context-item':copy(rawContent(contextItems(b.dataset.category).find(item=>item.id===b.dataset.item)));break;
    case'category-select':state.category=value;state.item='';state.search='';state.contentMode='read';state.readerOpen=false;render();break;
    case'item-select':state.item=value;state.readerOpen=true;render();break;
    case'reader-back':state.readerOpen=false;render();break;
    case'content-mode':state.contentMode=value;render();break;
    case'trend-mode':state.trendMode=value;render();break;
    case'event':state.contextExpanded.add(Number(value)===9?'skill':'inject');selectRequest(Number(value));break;
    case'decision-select':state.detailOpen=state.decision===value?!state.detailOpen:true;state.decision=value;render();break;
    case'decision-context':state.request=Number(value);state.contextExpanded.add('tool');setTab('context');break;
    case'copy-content':copy(rawContent(contextItems(state.category).find(i=>i.id===state.item)||contextItems(state.category)[0]));break;
    case'sample-recover':state.scenario='complete';render();updateUrl();break;
  }
});
document.addEventListener('change',event=>{
  if(event.target.id==='decision-feature'){state.feature=event.target.value;state.detailOpen=false;render()}
  if(event.target.id==='decision-outcome'){state.outcome=event.target.value;state.detailOpen=false;render()}
  if(event.target.id==='request-picker')selectRequest(Number(event.target.value));
  if(event.target.id==='item-sort'){state.sort=event.target.value;render()}
  if(event.target.id==='scenario'){state.scenario=event.target.value;render();updateUrl()}
});
document.addEventListener('toggle',event=>{
  const target=event.target;
  if(target.matches?.('details[data-context-category]')){target.open?state.contextExpanded.add(target.dataset.contextCategory):state.contextExpanded.delete(target.dataset.contextCategory)}
  if(target.matches?.('details[data-context-item]')){target.open?state.contextItemExpanded.add(target.dataset.contextItem):state.contextItemExpanded.delete(target.dataset.contextItem)}
},true);
document.addEventListener('input',event=>{
  if(event.target.id!=='context-search')return;
  const pos=event.target.selectionStart;state.search=event.target.value;render();const input=$('#context-search');input.focus();input.setSelectionRange(pos,pos);
});
$('.run-tabs').addEventListener('keydown',event=>{
  const tabs=$$('[data-tab]',$('.run-tabs'));const index=tabs.findIndex(t=>t===document.activeElement);if(index<0)return;
  let target;if(event.key==='ArrowRight')target=(index+1)%tabs.length;if(event.key==='ArrowLeft')target=(index+tabs.length-1)%tabs.length;if(event.key==='Home')target=0;if(event.key==='End')target=tabs.length-1;
  if(target!=null){event.preventDefault();setTab(tabs[target].dataset.tab);tabs[target].focus()}
});
$('#theme-toggle').addEventListener('click',()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';render();updateUrl()});
$('#notes-open').addEventListener('click',()=>$('#design-notes').showModal());
$('#notes-close').innerHTML=icon('x');$('#notes-close').addEventListener('click',()=>$('#design-notes').close());
$('#design-notes').addEventListener('click',event=>{if(event.target===$('#design-notes')&&event.clientX<$('#design-notes').getBoundingClientRect().left)$('#design-notes').close()});
render();
