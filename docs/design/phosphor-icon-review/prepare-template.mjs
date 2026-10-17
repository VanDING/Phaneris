// Reuse the previous review's layout without modifying that review or the app.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = path.dirname(fileURLToPath(import.meta.url))
let html = fs.readFileSync(path.join(directory,'../remix-icon-review/template.html'),'utf8')
function change(before,after) {
  if (!html.includes(before)) throw new Error('Missing replacement: '+before.slice(0,90))
  html = html.replaceAll(before,after)
}
function section(pattern,value,label) {
  if (!pattern.test(html)) throw new Error('Missing section '+label)
  html = html.replace(pattern,()=>value)
}
change('Remix Icon','Phosphor')
html = html.replaceAll('Remix','Phosphor')
change('Phaneris · Phosphor 候选演示','Phaneris · Phosphor 三套候选')
change('<span class="pill">图标选型</span>','<span class="pill">Phosphor 选型</span>')
change('同一界面，三种图标表达。','Phosphor，三种图标表达。')
change('当前使用 Lucide React。下面用 Phosphor 的不同造型与线面策略，比较导航、对话、文件和设置中的实际观感。','新一轮比较 Light、Regular、Duotone：先看导航造型，再放回工作台判断。当前 Lucide 保留作参照，界面配色与布局保持一致。')
for (const [key,title,description] of [['a','P1 · 轻线','Light · 简洁造型'],['b','P2 · 标准','Regular · 均衡轮廓'],['c','P3 · 柔面','Duotone · 淡底层次']]) {
  section(new RegExp('<button class="variant" data-variant="'+key+'"[\\s\\S]*?<\\/button>'),`<button class="variant" data-variant="${key}" aria-pressed="${key==='b'}"><div><span class="variant-title">${title}</span><p>${description}</p></div><span class="variant-icons" aria-hidden="true"></span></button>`,key)
}
change('A · 严谨线性','P1 · 轻线')
change('B · 清晰层级','P2 · 标准')
change('C · 饱满识别','P3 · 柔面')
change('  <div class="workspace-toolbar">','  <details class="sampler" open><summary>三套导航样张 <span>固定 32 px，点击标题可收起</span></summary><div class="sampler-grid" id="sampler-grid"></div></details>\n  <div class="workspace-toolbar">')
change('    @media(prefers-reduced-motion:reduce)',`    .sampler{margin-top:20px;padding:0 0 16px;border-bottom:1px solid var(--line)}.sampler summary{cursor:pointer;font-weight:600;font-size:13px;padding:4px 0 13px;user-select:none}.sampler summary span{font-size:11px;font-weight:400;color:var(--muted);margin-left:12px}.sampler summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.sampler-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.sample{min-width:0}.sample-title{display:flex;gap:8px;align-items:center;font-size:12px;margin-bottom:12px}.sample-title span{font-size:11px;font-weight:400;color:var(--muted)}.sample-icons{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:3px}.sample-icon{display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;min-width:0;color:var(--muted);font-size:11px;line-height:1.5;overflow-wrap:anywhere}.sample-icon span{white-space:nowrap}.sampler .icon{width:32px;height:32px;color:var(--fg)}.matrix .glyph-detail{min-height:36px}.weight-name{color:var(--muted);font-size:11px}.matrix .glyph-detail .icon{width:calc(var(--icon-size) * 1.5);height:calc(var(--icon-size) * 1.5)}@media(max-width:1200px){.sampler-grid{grid-template-columns:1fr;gap:18px}.sample-title{margin-bottom:8px}}@media(max-width:480px){.sampler summary span{display:block;margin-left:15px;margin-top:4px}.sampler .icon{width:28px;height:28px}.sampler summary span::after{content:"；窄屏样张为 28 px"}}\n    @media(prefers-reduced-motion:reduce)`)
section(/<p class="matrix-intro" id="matrix-count"><\/p><p class="matrix-intro">[\s\S]*?<\/p>/,'<p class="matrix-intro" id="matrix-count"></p><p class="matrix-intro">每项展示原始图形和实际 weight。P1 全部 Light，P2 全部 Regular；P3 的导航、文件与设置使用 Duotone，基础操作使用 Regular。三套均通过现有背景标记选中，不切换成 Fill。这 63 项用于选型，尚非全部 197 个组件的迁移映射。</p>','matrix note')
section(/<li>Phosphor 的 Line[\s\S]*?<\/li>/,'<li>Phosphor 原生支持 Thin、Light、Regular、Bold、Fill、Duotone 六种 weight。本轮使用三种，按原始 256×256 网格缩放；应使用 weight 校准重量，不直接套用现有 <code>--icon-stroke-width</code>。</li>','stroke note')
section(/<div class="note-block"><h3>候选边界<\/h3>[\s\S]*?<\/div>/,'<div class="note-block"><h3>本轮候选</h3><p>P1 用 Light 与简洁隐喻，P2 用 Regular 与常规隐喻，P3 用 Duotone 及部分更具象的形状。基础操作始终保留清楚的轮廓。Duotone 的淡底沿用原始 SVG 的 20% 透明层，继承同一个前景色，未额外引入彩色。</p></div>','candidate boundary')
section(/<div class="note-block"><h3>资产来源<\/h3>[\s\S]*?<\/div>/,'<div class="note-block"><h3>资产来源</h3><p>本演示固定使用官方 <code>@phosphor-icons/core 2.1.1</code> 的原始 SVG。图标名称与 weight 可在「图标对照」查看。来源与 React 用法见 <a href="https://github.com/phosphor-icons/react" target="_blank" rel="noreferrer">官方 React 仓库</a>，资源包遵循 <a href="https://github.com/phosphor-icons/core/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT 协议</a>。Phaneris 自有标识与用户图标保留。</p></div>','asset source')
section(/const recipes=\{[\s\S]*?\n\};/,`const recipes={
  current:{title:'当前 · Lucide',weight:'现有描边 1.65',description:'当前库与自定义圆角按钮作为参照。状态与品牌图形保持原样。',strength:'现有工作台的实际图标语言。',tradeoff:'可直接比较 Phosphor 的造型、比例和视觉重量。'},
  a:{title:'P1 · 轻线',weight:'Light',description:'全部使用原生 Light。对话保留收件箱，标签、文件夹、侧栏使用更简洁的形状，自动化用流程箭头。',strength:'轮廓轻，空白更多，适合希望界面安静的选择。',tradeoff:'14–16 px 下线条会偏轻；建议同时观察 18 px 与深色模式。'},
  b:{title:'P2 · 标准',weight:'Regular',description:'全部使用原生 Regular。对话用双气泡，项目用文件夹，页面用浏览器窗口，自动化用树状结构。',strength:'轮廓和细节较均衡，是判断 Phosphor 原生观感的基准。',tradeoff:'密集场景更稳妥，但个性弱于 Duotone；树形图需要结合自动化文字理解。'},
  c:{title:'P3 · 柔面',weight:'Duotone / Regular',description:'导航、文件和设置用原生 Duotone；基础操作保留 Regular。淡底与轮廓使用同一个前景色。',strength:'通过 20% 透明底层增加体积和层次，轮廓仍清楚。',tradeoff:'小尺寸中淡底可能不明显；堆叠、魔棒、四方格等隐喻比前两套变化更大。'}
};`,'recipes')
section(/^function iconName\(.*$/m,`function iconName(key,recipe=variant,active=false){const def=DATA.mapping[key];return recipe==='current'?def.current:def.glyphs[recipe][active?1:0]}`,'iconName')
section(/^function glyph\(.*$/m,"function glyph(key,recipe=variant,active=false,extra=''){const name=iconName(key,recipe,active),prefix=recipe==='current'?'lc-':'ph-',box=recipe==='current'?24:256;return `<svg class=\"icon ${extra}\" viewBox=\"0 0 ${box} ${box}\" aria-hidden=\"true\" data-glyph=\"${safe(name)}\"><use href=\"#${safe(prefix+name)}\"></use></svg>`}",'glyph')
section(/^function renderNotes\(.*$/m,"function renderNotes(){const recipe=recipes[variant];document.querySelector('#recipe-notes').innerHTML=`<div><h2>${recipe.title}</h2><p class=\"description\">${recipe.description}</p></div><div class=\"note-block\"><h3>${recipe.weight}</h3><div class=\"pair\"><span>常态</span><span class=\"pair-example\">${glyph('sessions',variant,false)}</span></div><div class=\"pair\"><span>选中</span><span class=\"pair-example active\">${glyph('sessions',variant,true)}</span></div><p>选中时保持图形，通过既有背景和文字表达当前位置。</p></div><div class=\"note-block\"><h3>取舍</h3><p>${recipe.strength}</p><p style=\"margin-top:8px\">${recipe.tradeoff}</p></div>`;document.querySelector('#review-status').textContent=`正在预览 ${recipe.title} · 尚未实施`}",'notes')
section(/^function renderMatrix\(.*$/m,"function renderMatrix(){const query=document.querySelector('#icon-search').value.toLowerCase().trim(),group=document.querySelector('#group-filter').value;const rows=Object.values(DATA.mapping).filter(def=>(group==='all'||def.group===group)&&(!query||[def.label,def.current,def.a,def.b,def.c,def.group,...Object.values(def.weights)].join(' ').toLowerCase().includes(query)));document.querySelector('#matrix-body').innerHTML=rows.map(def=>`<tr><td>${def.label}<p class=\"row-caption\">${def.group}</p></td>${['current','a','b','c'].map(recipe=>`<td class=\"${variant===recipe?'active-col':''}\"><div class=\"glyph-detail\">${glyph(def.key,recipe,false)}</div><code>${safe(recipe==='current'?def.current:def[recipe])}</code><span class=\"weight-name\">${recipe==='current'?'1.65 描边':def.weights[recipe]}</span></td>`).join('')}</tr>`).join('')||'<tr><td colspan=\"5\" class=\"empty\">没有匹配项，请调整名称或区域。</td></tr>';document.querySelector('#matrix-count').textContent=`显示 ${rows.length} 项 / 共 ${Object.keys(DATA.mapping).length} 项代表性用途。`;document.querySelectorAll('[data-column]').forEach(th=>th.classList.toggle('active-col',th.dataset.column===variant))}",'matrix')
const sampler = "function renderSampler(){document.querySelector('#sampler-grid').innerHTML=['a','b','c'].map(recipe=>`<div class=\"sample\"><h3 class=\"sample-title\">${recipes[recipe].title}<span>${recipe==='a'?'Light':recipe==='b'?'Regular':'Duotone'}</span></h3><div class=\"sample-icons\">${navItems.map(key=>`<div class=\"sample-icon\">${glyph(key,recipe)}<span>${DATA.mapping[key].label}</span></div>`).join('')}</div></div>`).join('')}\n"
change('function renderVariants()',sampler+'function renderVariants()')
change('renderVariants();renderApp();renderNotes();renderMatrix();','renderSampler();renderVariants();renderApp();renderNotes();renderMatrix();')
change('href="#ri-moon-line"','href="#ph-moon-regular"')
change("#ri-${dark?'sun':'moon'}-line","#ph-${dark?'sun':'moon'}-regular")
if (/Remix|remixicon|ri-\$|#ri-/.test(html)) throw new Error('Stale Remix references')
fs.writeFileSync(path.join(directory,'template.html'),html)
console.log('Phosphor template prepared. Previous Remix demo retained.')
