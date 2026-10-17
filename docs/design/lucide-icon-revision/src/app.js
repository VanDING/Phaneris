/* Phaneris Lucide icon revision — rendering + interaction. */
(function () {
  'use strict'

  var D = window.DEMO
  var SPINNER = 'svg-spinners:blocks-wave'

  var $ = function (sel, root) { return (root || document).querySelector(sel) }
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // ------------------------------------------------------------------ icons
  var ICON_SETS = {
    lucide: { width: 24, height: 24, icons: D.catalog.canonical },
  }
  Object.keys(D.icons).forEach(function (prefix) {
    ICON_SETS[prefix] = { width: D.icons[prefix].width, height: D.icons[prefix].height, icons: D.icons[prefix].icons }
  })
  var LUCIDE_ROOT = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

  var uid = 0
  function uniquify(body, suffix) {
    var ids = []
    var re = /\sid="([^"]+)"/g
    var m
    while ((m = re.exec(body))) ids.push(m[1])
    var out = body
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i]
      out = out.split('id="' + id + '"').join('id="' + id + '-' + suffix + '"')
      out = out.split('#' + id).join('#' + id + '-' + suffix)
      out = out.split('"' + id + '.').join('"' + id + '-' + suffix + '.')
      out = out.split(';' + id + '.').join(';' + id + '-' + suffix + '.')
    }
    return out
  }

  function icon(prefix, name, size, cls, title) {
    var set = ICON_SETS[prefix]
    var entry = set && set.icons ? set.icons[name] : null
    var box = 'width:' + size + 'px;height:' + size + 'px'
    if (!entry) {
      return '<span class="ic ' + (cls || '') + '" style="' + box + '" title="' + esc(prefix + ':' + name + ' 不可用') + '"></span>'
    }
    var w = entry.w || set.width || 24
    var h = entry.h || set.height || 24
    var l = entry.l || 0
    var t = entry.t || 0
    var body = uniquify(entry.b, 'i' + (++uid))
    var root = prefix === 'lucide' ? LUCIDE_ROOT : ''
    return '<span class="ic ' + (cls || '') + '" style="' + box + '"' + (title ? ' title="' + esc(title) + '"' : '') +
      '><svg viewBox="' + l + ' ' + t + ' ' + w + ' ' + h + '" width="' + size + '" height="' + size + '"' + root +
      ' aria-hidden="true">' + body + '</svg></span>'
  }

  var kebab = function (name) {
    return String(name || '')
      .replace(/（.*$/, '')
      .trim()
      .replace(/Icon$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .replace(/([A-Za-z])([0-9])/g, '$1-$2')
      .toLowerCase()
  }

  function canonicalName(component) {
    var key = kebab(component)
    if (D.catalog.canonical[key]) return key
    return D.catalog.aliases[key] || null
  }

  /** The icon a purpose renders today (first current component), for the 现状 column. */
  function currentIconName(purpose) {
    if (isSpinner(purpose)) return null
    return canonicalName(purpose.current)
  }

  var byId = {}
  D.purposes.forEach(function (p) { byId[p.id] = p })

  var state = {
    plan: { q: '', group: 'all', action: 'all', verdict: 'all', size: 22 },
    overrides: {},
    picker: null,
    pickerQuery: '',
    fileTheme: 'current',
    fileSize: 18,
    collapsed: { '/node_modules': true, '/dist': true, '/.github': true, '/apps/viewer': true, '/packages/ui': true, '/packages/shared': true, '/tests': true },
    workbench: { size: 16, panel: 'files' },
  }

  function recommendationOf(purpose) {
    return state.overrides[purpose.id] || purpose.recommended
  }

  /** Purposes whose icon is an external animation (blocks-wave) rather than a Lucide glyph. */
  function isSpinner(purpose) {
    return Boolean(purpose.spinner) || purpose.action === 'external'
  }

  /**
   * Icon for a UI slot. On the 现状 side the purpose's glyphs are cycled through
   * so the mock shows the real inconsistency; the 建议 side always uses the
   * recommendation.
   */
  var spread = 0
  function iconFor(purposeId, variant, size) {
    var purpose = byId[purposeId]
    if (!purpose) return ''
    if (isSpinner(purpose)) return icon('svg-spinners', 'blocks-wave', size)
    var name
    if (variant === 'next') {
      name = recommendationOf(purpose)
    } else {
      name = currentIconName(purpose)
      if (purpose.glyphs.length > 1) {
        name = purpose.glyphs[spread % purpose.glyphs.length].glyph
        spread++
      }
    }
    if (!name) return icon('svg-spinners', 'blocks-wave', size)
    if (name.indexOf(':') > 0) {
      var parts = name.split(':')
      return icon(parts[0], parts[1], size)
    }
    return icon('lucide', name, size)
  }

  function bindReplay(root) {
    $$('.ic svg', root).forEach(function (svg) {
      if (!svg.querySelector('animate')) return
      svg.setCurrentTime(0)
      svg.addEventListener('mouseenter', function () { svg.setCurrentTime(0) })
    })
  }

  var ACTION_LABEL = {
    keep: '保持不变', rename: '改规范名', merge: '收敛重复', replace: '换更贴切', split: '拆分用途',
    new: '新增', 'new-purpose': '独立用途', external: '外部动效', dissolved: '拆空',
  }
  var VERDICT_LABEL = {
    recommended: '主图形', redundant: '真冗余', replace: '换更贴切', new: '独立用途', move: '归入他处',
    paired: '成对状态', demo: '演示未用', uncertain: '待确认', unreviewed: '未复核',
  }

  // ------------------------------------------------------------------ hero
  function renderHero() {
    var t = D.totals
    $('#hero-alias').textContent = String(t.aliasRenames)
    var rows = [
      ['导入的 Lucide 组件', t.components + ' 个'],
      ['实际渲染的图形', t.glyphsBefore + ' 个'],
      ['复核后：真冗余', t.redundant + ' 个'],
      ['复核后：语义不同', t.splitOut + ' 个'],
      ['生产未使用', t.demoOnly + ' 个'],
      ['修正后用途数', t.purposesAfter + ' 个'],
    ]
    $('#hero-stats').innerHTML = rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'
    }).join('')
    $('#built-at').textContent = '演示页生成于 ' + new Date(D.builtAt).toLocaleString('zh-CN') +
      '；图标图形取自本仓库安装的 lucide-react v1.51.0（' + Object.keys(D.catalog.canonical).length + ' 个正式图形 + ' +
      Object.keys(D.catalog.aliases).length + ' 个旧名别名）。'
  }

  // ------------------------------------------------------------------ audit
  function statCards(target, cards) {
    $(target).innerHTML = cards.map(function (c) {
      return '<div class="stat-card"><h3>' + esc(c.h) + '</h3><div class="big">' + esc(c.big) + '</div><p>' + esc(c.p) + '</p></div>'
    }).join('')
  }

  function renderAudit() {
    var t = D.totals
    statCards('#audit-stats', [
      { h: '真冗余（可收敛）', big: String(t.redundant), p: '同一语义、同一角色，只是图形不同。这是唯一该被"收回"的部分：' +
        D.purposes.filter(function (p) { return p.action === 'merge' }).map(function (p) { return p.label + '（' + p.redundant.join('、') + '）' }).join('；') + '。' },
      { h: '语义确实不同', big: String(t.splitOut), p: '这些图形出现在不同场景、承担不同职责，不该合并。是我上一版用途表把它们塞进了同一个用途，需要各自独立成用途。' },
      { h: '生产未使用', big: String(t.demoOnly), p: '只出现在 playground、演示稿与集中图标表里，生产界面从不渲染。不影响线上，但要和真实图标分开算。' },
      { h: '成对状态', big: String(t.paired), p: '同一控件的两种状态（显示/隐藏、标记/取消、启用/停用），必须一起保留，不能"收敛"成一个。' },
      { h: '待确认', big: String(t.uncertain), p: '证据不足以判定，需要产品拍板：' + D.purposes.flatMap(function (p) { return (p.uncertain || []).map(function (u) { return p.label + '/' + u.glyph }) }).join('、') + '。' },
      { h: '需要改规范名', big: String(t.aliasRenames), p: '这些导入走的是 v1 废弃别名，改名不改视觉，应该跟上。' },
    ])

    $('#audit-method').innerHTML = '判定方法：先把 262 个导入文件里每个组件的实际渲染位置抓出来（共 952 处调用点），' +
      '按所在区域分成<b>生产代码</b>、<b>演示稿</b>（playground/demos/fixtures）、<b>图标表</b>（menu-icons.ts 这类只做映射的文件），' +
      '再逐条读调用点上下文，给每个图形判定身份。任何一个非建议图形没有判定，构建都会失败。'

    var rows = []
    D.purposes.forEach(function (p) {
      if (isSpinner(p) || !p.glyphs.length) return
      p.glyphs.forEach(function (g, index) {
        var production = (g.counts && g.counts.production) || 0
        var verdict = g.verdict || 'recommended'
        var evidence = verdict === 'new' || verdict === 'move'
          ? (g.use ? '→ ' + g.use + '：' : '') + (g.evidence || '')
          : (g.evidence || '')
        rows.push('<tr>' +
          '<td class="purpose">' + (index === 0 ? '<b>' + esc(p.label) + '</b><code>' + esc(p.id) + '</code>' : '') + '</td>' +
          '<td><span class="cell-icon">' + icon('lucide', g.glyph, 18) + '<span class="name">' + esc(g.glyph) +
            (g.aliases.length ? '<em>旧名 ' + esc(g.aliases.join(', ')) + '</em>' : '') + '</span></span></td>' +
          '<td class="num">' + production + (g.counts && (g.counts.playground || g.counts.iconTable)
            ? ' <span class="muted">+' + ((g.counts.playground || 0) + (g.counts.iconTable || 0)) + '</span>' : '') + '</td>' +
          '<td><span class="chip verdict-' + verdict + '">' + esc(VERDICT_LABEL[verdict] || verdict) + '</span></td>' +
          '<td class="note">' + esc(evidence) + '</td></tr>')
      })
    })
    $('#audit-verdicts').innerHTML = rows.join('')

    $('#audit-alias').innerHTML = D.aliasRenames.map(function (entry) {
      return '<tr><td><code>' + esc(entry.component) + '</code></td>' +
        '<td><code class="is-new">' + esc(entry.canonical) + '</code></td>' +
        '<td>' + esc((byId[entry.purpose] || {}).label || entry.purpose) + '</td>' +
        '<td class="num">' + entry.count + '</td></tr>'
    }).join('')
  }

  // ------------------------------------------------------------------ plan
  function planRows() {
    var q = state.plan.q.trim().toLowerCase()
    return D.purposes.filter(function (p) {
      if (state.plan.group !== 'all' && p.group !== state.plan.group) return false
      if (state.plan.action === 'change' && (p.action === 'keep' || p.action === 'external')) return false
      if (state.plan.action !== 'all' && state.plan.action !== 'change' && p.action !== state.plan.action) return false
      if (state.plan.verdict !== 'all' && !(p.glyphs || []).some(function (g) { return g.verdict === state.plan.verdict })) return false
      if (!q) return true
      var hay = [p.label, p.id, recommendationOf(p), p.why].concat((p.glyphs || []).map(function (g) { return g.glyph })).join(' ').toLowerCase()
      return hay.indexOf(q) >= 0
    })
  }

  function renderPlan() {
    var groupSel = $('#plan-group')
    if (!groupSel.options.length) {
      groupSel.innerHTML = '<option value="all">全部区域</option>' + D.groups.map(function (g) {
        return '<option value="' + g.id + '">' + esc(g.title) + '</option>'
      }).join('')
    }

    var size = state.plan.size
    var rows = planRows()
    $('#plan-body').innerHTML = rows.map(function (p) {
      var current = isSpinner(p)
        ? '<span class="cell-icon">' + icon('svg-spinners', 'blocks-wave', size) + '<span class="name">自绘 Spinner<em>现状</em></span></span>'
        : (p.action === 'new-purpose' && !p.glyphs.length
          ? '<span class="muted">由「' + esc((byId[p.from] || {}).label || p.from || '') + '」拆出</span>'
          : '<div class="glyph-list">' + p.glyphs.map(function (g) {
              var verdict = g.verdict || 'recommended'
              var title = VERDICT_LABEL[verdict] + (g.use ? '：' + g.use : '') + (g.evidence ? '（' + g.evidence + '）' : '')
              return '<span class="glyph-chip verdict-' + verdict + (g.glyph === recommendationOf(p) ? ' is-picked' : '') + '" title="' + esc(title) + '">' +
                icon('lucide', g.glyph, size) + '<code>' + esc(g.glyph) + '</code>' +
                '<b>生产' + ((g.counts && g.counts.production) || 0) + '</b></span>'
            }).join('') + '</div>')

      var recommended
      if (isSpinner(p)) {
        recommended = '<span class="cell-icon">' + icon('svg-spinners', 'blocks-wave', size) +
          '<span class="name">svg-spinners:blocks-wave<em>外部动效</em></span></span>'
      } else {
        var name = recommendationOf(p)
        recommended = '<span class="cell-icon">' + icon('lucide', name, size) +
          '<span class="name">' + esc(name) + '<em>' + (p.action === 'new-purpose' ? '新用途' : 'lucide') + '</em></span></span>' +
          (state.overrides[p.id] ? '<div class="override-note">已改为你的选择（原建议 ' + esc(p.recommended) + '）</div>' : '')
      }

      var keep = (p.glyphs || []).filter(function (g) { return g.verdict === 'paired' || g.verdict === 'uncertain' || g.verdict === 'replace' })
      var extras = keep.length
        ? '<div class="glyph-list">' + keep.map(function (g) {
            return '<span class="glyph-chip"><span class="ic-slot">' + icon('lucide', g.glyph, Math.max(14, size - 4)) + '</span>' +
              '<code>' + esc(g.glyph) + '</code><i>' + esc(VERDICT_LABEL[g.verdict]) + '</i></span>'
          }).join('') + '</div>'
        : ((p.also && p.also.length)
          ? '<div class="glyph-list">' + p.also.map(function (e) {
              return '<span class="glyph-chip"><span class="ic-slot">' + icon('lucide', e.icon, Math.max(14, size - 4)) + '</span>' +
                '<code>' + esc(e.icon) + '</code><i>' + esc(e.when) + '</i></span>'
            }).join('') + '</div>'
          : '<span class="muted">—</span>')

      var split = (p.splitOut || []).length
        ? '<div class="drop-note">拆出 ' + p.splitOut.length + ' 个用途</div>' : ''
      var demo = (p.demoOnly || []).length
        ? '<div class="drop-note">演示未用 ' + p.demoOnly.length + ' 个</div>' : ''

      return '<tr data-purpose="' + esc(p.id) + '">' +
        '<td class="purpose"><b>' + esc(p.label) + '</b><code>' + esc(p.id) + '</code></td>' +
        '<td>' + current + '</td>' +
        '<td>' + recommended + '</td>' +
        '<td>' + extras + '</td>' +
        '<td><span class="chip action-' + p.action + '">' + esc(ACTION_LABEL[p.action] || p.action) + '</span>' +
          (p.renamed ? '<div class="rename-note">含旧名</div>' : '') +
          (p.dropped && p.dropped.length ? '<div class="drop-note">收敛 ' + p.dropped.length + ' 个</div>' : '') +
          split + demo + '</td>' +
        '<td class="note">' + esc(p.why || p.note || '') + '</td>' +
        '<td>' + (isSpinner(p) ? '' : '<button class="btn btn-small" data-pick="' + esc(p.id) + '" type="button">换</button>') + '</td>' +
        '</tr>' + (state.picker === p.id ? pickerRow(p) : '')
    }).join('')

    $('#plan-count').textContent = '显示 ' + rows.length + ' / ' + D.purposes.length + ' 行（' +
      D.totals.purposesBefore + ' 个原用途 + ' + D.totals.newPurposes + ' 个复核拆出的新用途）；' +
      '真冗余 ' + D.totals.redundant + ' 个、语义不同 ' + D.totals.splitOut + ' 个、生产未使用 ' + D.totals.demoOnly + ' 个。'
    bindReplay($('#plan-body'))
  }

  function pickerRow(purpose) {
    var query = state.pickerQuery
    var names = Object.keys(D.catalog.canonical)
    var filtered = query
      ? names.filter(function (n) { return n.indexOf(query) >= 0 }).sort()
      : suggestFor(purpose)
    return '<tr class="picker-row" data-purpose="' + esc(purpose.id) + '"><td colspan="7">' +
      '<div class="picker">' +
        '<div class="picker-head">' +
          '<b>为「' + esc(purpose.label) + '」挑一个图形</b>' +
          '<input class="picker-search" type="search" placeholder="搜索 ' + names.length + ' 个 lucide 图形，例如 file / chart / arrow" value="' + esc(query) + '">' +
          '<span class="muted">当前建议：<code>' + esc(purpose.recommended) + '</code></span>' +
          '<button class="btn btn-small" data-pick-close="1" type="button">关闭</button>' +
        '</div>' +
        '<div class="icon-grid picker-grid">' + filtered.slice(0, 120).map(function (name) {
          return '<button class="icon-tile' + (name === purpose.recommended ? ' is-current' : '') + '" data-pick-icon="' + esc(name) + '" type="button" title="' + esc(name) + '">' +
            icon('lucide', name, 24) + '<span>' + esc(name) + '</span></button>'
        }).join('') + '</div>' +
        (filtered.length > 120 ? '<p class="muted">只显示前 120 个结果，输入关键词缩小范围。</p>' : '') +
      '</div></td></tr>'
  }

  /** Default candidate list: icons sharing a word with the recommended one. */
  function suggestFor(purpose) {
    var words = String(recommendationOf(purpose)).split('-').filter(function (w) { return w.length > 2 })
    var names = Object.keys(D.catalog.canonical)
    var scored = names.map(function (name) {
      var score = 0
      words.forEach(function (w) { if (name.indexOf(w) >= 0) score += w.length })
      return { name: name, score: score }
    }).filter(function (entry) { return entry.score > 0 })
      .sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name) })
      .map(function (entry) { return entry.name })
    if (scored.indexOf(purpose.recommended) < 0) scored.unshift(purpose.recommended)
    return scored
  }

  function renderDraft() {
    var ids = Object.keys(state.overrides)
    var bar = $('#draft-bar')
    bar.hidden = ids.length === 0
    $('#draft-count').textContent = ids.length + ' 项'
    $('#draft-list').innerHTML = ids.map(function (id) {
      var purpose = byId[id]
      return '<span class="draft-item">' + icon('lucide', state.overrides[id], 16) +
        '<code>' + esc(id) + '</code><span class="muted">' + esc(purpose ? purpose.label : '') + '</span>' +
        '<code class="is-new">' + esc(state.overrides[id]) + '</code>' +
        '<button class="draft-remove" data-remove="' + esc(id) + '" type="button" aria-label="移除">×</button></span>'
    }).join('')
  }

  function draftJson() {
    var payload = {}
    Object.keys(state.overrides).forEach(function (id) {
      payload[id] = { label: (byId[id] || {}).label, was: (byId[id] || {}).recommended, now: state.overrides[id] }
    })
    return JSON.stringify(payload, null, 2)
  }

  // ------------------------------------------------------------------ workbench
  function sideItem(purposeId, label, variant, size, extra) {
    return '<div class="side-item' + (extra && extra.active ? ' is-active' : '') + '">' +
      iconFor(purposeId, variant, size) + '<span>' + esc(label) + '</span>' +
      (extra && extra.count ? '<span class="count">' + esc(extra.count) + '</span>' : '') + '</div>'
  }

  function launcher(purposeId, label, variant, size, kind) {
    return '<span class="launcher-wrap"><span class="launcher ' + (kind || '') + '" title="' + esc(label) + '">' +
      iconFor(purposeId, variant, size) + '</span>' +
      (kind === 'is-open' ? '<span class="tabdot"></span>' : '') + '</span>'
  }

  function toolRow(purposeId, text, tail, variant, size) {
    return '<div class="tool-row">' + iconFor(purposeId, variant, size) + '<span>' + esc(text) + '</span>' +
      '<span class="tail">' + esc(tail) + '</span></div>'
  }

  function miniTree(size, rows) {
    var html = ''
    var walk = function (nodes, depth) {
      nodes.slice(0, depth === 0 ? 8 : 4).forEach(function (node) {
        var isDir = node.children !== undefined
        html += '<div class="mini-row" style="padding-left:' + (6 + depth * 12) + 'px">' +
          fileIconFor(node, size, 'vscode') + '<span class="name">' + esc(node.name) + '</span>' +
          (isDir ? '<span class="tail">' + (node.children.length || '') + '</span>' : '') + '</div>'
        if (isDir && node.open) walk(node.children, depth + 1)
      })
    }
    walk(D.fileTree, 0)
    return html
  }

  function trajRow(label, text, kind) {
    return '<div class="traj-row"><span>' + esc(label) + '</span><span class="traj-bar ' + kind + '">' + esc(text) + '</span></div>'
  }

  function renderApp(variant, size, panel) {
    var top = '' +
      '<div class="app-top">' +
        launcher('newSession', '新对话', variant, size) +
        launcher('sessions', '会话', variant, size, 'is-focused') +
        launcher('kanban', '看板', variant, size) +
        launcher('calendar', '日历', variant, size) +
        launcher('gantt', '甘特图', variant, size) +
        '<span class="separator"></span>' +
        launcher('filesPanel', '文件', variant, size, 'is-open') +
        launcher('trajectory', '运行', variant, size) +
        launcher('terminal', '终端', variant, size) +
        '<span class="separator"></span>' +
        launcher('browser', '浏览器', variant, size) +
        launcher('help', '帮助', variant, size) +
        '<span class="spacer"></span>' +
        launcher('visibility', '显示', variant, size) +
        launcher('settings', '设置', variant, size) +
      '</div>'

    var side = '' +
      '<div class="side">' +
        sideItem('workspace', 'Phaneris', variant, size, { count: '3' }) +
        '<div class="side-group">会话</div>' +
        sideItem('sessions', '全部会话', variant, size, { active: true, count: '18' }) +
        sideItem('labels', '已标记', variant, size, { count: '4' }) +
        sideItem('archive', '已归档', variant, size) +
        '<div class="side-group">资源</div>' +
        sideItem('projects', '项目', variant, size, { count: '5' }) +
        sideItem('pages', '页面', variant, size, { count: '7' }) +
        sideItem('sources', '来源', variant, size, { count: '2' }) +
        sideItem('skills', '技能', variant, size, { count: '12' }) +
        sideItem('plugins', '插件', variant, size, { count: '3' }) +
        sideItem('automations', '自动化', variant, size, { count: '6' }) +
        '<div class="side-foot">' +
          sideItem('settings', '设置', variant, size) +
          sideItem('help', '帮助', variant, size) +
        '</div>' +
      '</div>'

    var thread = '' +
      '<div class="thread">' +
        '<div class="msg-user">把图标按用途收敛一下，文件图标换成彩色的。</div>' +
        '<div class="turn">' +
          '<div class="turn-head">' + icon('lucide', 'chevron-down', Math.max(12, size - 2)) +
            iconFor('thinking', variant, Math.max(12, size - 2)) +
            '<span>Phaneris</span><span class="badge badge-quiet">运行中</span></div>' +
          '<div class="turn-body">' +
            toolRow('search', '搜索 图标用法', '12 处', variant, Math.max(12, size - 2)) +
            toolRow('filesPanel', '读取 icon-usage.json', '1.2 KB', variant, Math.max(12, size - 2)) +
            toolRow('edit', '编辑 App.tsx', '+8 −3', variant, Math.max(12, size - 2)) +
            toolRow('terminal', 'bun run verify', '退出码 0', variant, Math.max(12, size - 2)) +
            '<div class="processing">' + iconFor('thinking', variant, size) +
              '<span>思考中...</span><span class="elapsed">7s</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="composer">' +
          '<span class="icon-btn">' + iconFor('attach', variant, size) + '</span>' +
          '<span class="icon-btn">' + iconFor('image', variant, size) + '</span>' +
          '<span class="placeholder">继续描述你的需求…</span>' +
          '<span class="icon-btn">' + iconFor('keyboard', variant, size) + '</span>' +
          '<span class="icon-btn primary">' + iconFor('send', variant, size) + '</span>' +
        '</div>' +
      '</div>'

    var right
    if (panel === 'files') {
      right = '<div class="right">' +
        '<div class="right-head">' + iconFor('filesPanel', variant, Math.max(12, size - 2)) + '<span>文件</span>' +
          '<span style="margin-left:auto">' + iconFor('more', variant, Math.max(12, size - 2)) + '</span></div>' +
        '<div class="mini-tree">' + miniTree(size) + '</div></div>'
    } else {
      right = '<div class="right">' +
        '<div class="right-head">' + iconFor('trajectory', variant, Math.max(12, size - 2)) + '<span>运行</span>' +
          '<span style="margin-left:auto">' + iconFor('refresh', variant, Math.max(12, size - 2)) + '</span></div>' +
        '<div class="traj">' +
          trajRow('搜索', '搜索图标用法 · 12 处命中', 'ok') +
          trajRow('读取', 'icon-usage.json', 'ok') +
          trajRow('编辑', 'App.tsx', 'run') +
          trajRow('校验', '类型检查 · 等待中', 'warn') +
        '</div></div>'
    }

    return top + '<div class="app-body">' + side + thread + right + '</div>'
  }

  function renderWorkbench() {
    var size = state.workbench.size
    spread = 0
    $('#app-current').innerHTML = renderApp('current', size, state.workbench.panel)
    spread = 0
    $('#app-next').innerHTML = renderApp('next', size, state.workbench.panel)
    var changed = D.purposes.filter(function (p) { return p.action !== 'keep' && p.action !== 'external' }).length
    $('#workbench-note').textContent = '界面尺寸 ' + size + ' px。现状一侧按该用途实际用到的多个图形轮换显示，' +
      '用来呈现"同一语义几个图形"的现状；建议一侧统一为主图形。两侧思考中都是 blocks-wave，右侧文件面板都是 VSCode Icons 彩色主题；' +
      '共 ' + changed + ' 个用途发生变化。'
    bindReplay($('#panel-workspace'))
  }

  // ------------------------------------------------------------------ files
  function lucideBaselineFor(node) {
    if (node.children !== undefined) return 'folder'
    var ext = String(node.name || '').split('.').pop().toLowerCase()
    if (['md', 'markdown'].indexOf(ext) >= 0) return 'file-text'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].indexOf(ext) >= 0) return 'image'
    if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs'].indexOf(ext) >= 0) return 'file-code'
    return 'file'
  }

  function fileIconFor(node, size, theme) {
    if (theme === 'current') return icon('lucide', lucideBaselineFor(node), size)
    var kind = null
    for (var i = 0; i < D.fileKinds.length; i++) if (D.fileKinds[i].id === node.kind) { kind = D.fileKinds[i]; break }
    var name = kind && kind.vscode
    var set = ICON_SETS['vscode-icons']
    if (!name || !set.icons[name]) name = node.children !== undefined ? D.vscodeFallback.folder : D.vscodeFallback.file
    return icon('vscode-icons', name, size)
  }

  function fileSize(name) {
    var h = 0
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997
    var kb = 1 + (h % 240)
    return kb >= 1000 ? (kb / 1000).toFixed(1) + ' MB' : kb + ' KB'
  }

  function renderFileTree() {
    var theme = state.fileTheme
    var size = state.fileSize
    var html = ''
    var walk = function (nodes, depth, path) {
      nodes.forEach(function (node) {
        var isDir = node.children !== undefined
        var key = path + '/' + node.name
        var open = isDir && !state.collapsed[key]
        html += '<div class="tree-row' + (isDir ? ' is-dir' : '') + '" style="padding-left:' + (6 + depth * 14) + 'px"' +
          ' data-path="' + esc(key) + '"' + (isDir ? ' data-dir="1"' : '') + '>' +
          '<span class="caret">' + (isDir ? (open ? '▾' : '▸') : '') + '</span>' +
          fileIconFor(node, size, theme) +
          '<span class="name">' + esc(node.name) + '</span>' +
          '<span class="size">' + (isDir ? node.children.length + ' 项' : fileSize(node.name)) + '</span>' +
          '</div>'
        if (isDir && open) walk(node.children, depth + 1, key)
      })
    }
    walk(D.fileTree, 0, '')
    $('#file-tree').innerHTML = html
  }

  function renderFiles() {
    var options = [['current', '当前单色'], ['vscode', 'VSCode Icons']]
    $('#file-theme').innerHTML = options.map(function (o) {
      return '<button type="button" data-theme="' + o[0] + '" aria-pressed="' + (state.fileTheme === o[0]) + '">' + esc(o[1]) + '</button>'
    }).join('')

    var meta = D.icons['vscode-icons'].meta
    $('#file-theme-badge').textContent = state.fileTheme === 'current'
      ? '当前实现：6 个单色图形'
      : 'VSCode Icons · ' + (meta.license || 'MIT')

    renderFileTree()

    $('#file-note').innerHTML = state.fileTheme === 'current'
      ? '<h3>现在的做法</h3><p>文件树只按四种情况换图形：目录、Markdown、图片、代码，其余一律通用文档，颜色继承前景色。</p>' +
        '<p>结果是 <code>.ts</code> 与 <code>.json</code> 长得一样，<code>.zip</code>、<code>.pdf</code>、<code>.xlsx</code> 也是同一个文档图形。</p>' +
        '<p class="muted">对应源码：<code>session-file-tree.tsx</code> 的 <code>getFileIcon()</code>，只有 6 个分支。</p>'
      : '<h3>VSCode Icons</h3><p>' + meta.total + ' 个图形，编辑器里最常见的一套彩色文件主题。类型识别最细：' +
        '<code>bun.lock</code>、<code>bunfig.toml</code>、<code>Dockerfile.server</code>、<code>tsconfig.*</code> 都有专用图形，目录还能按名称着色。</p>' +
        '<p>本页内联了映射用到的 ' + Object.keys(D.icons['vscode-icons'].icons).length + ' 个图形；' +
        '未识别的类型由兜底图形接管。</p>'

    var shared = {}
    D.fileKinds.forEach(function (kind) {
      var name = kind.vscode
      shared[name] = (shared[name] || 0) + 1
    })
    $('#type-body').innerHTML = D.fileKinds.map(function (kind) {
      var sample = { name: sampleNameFor(kind), kind: kind.id, children: kind.rule && kind.rule.dir ? [] : undefined }
      var name = kind.vscode
      var ok = name && ICON_SETS['vscode-icons'].icons[name]
      return '<tr><td>' + esc(kind.label) + '</td>' +
        '<td>' + icon('lucide', lucideBaselineFor(sample), 20) + '</td>' +
        '<td>' + (ok ? icon('vscode-icons', name, 20) : '') + '<span class="names">' + esc(name || '') + '</span>' +
          (ok ? '' : '<div class="missing">用兜底图形</div>') +
          (ok && shared[name] > 1 ? '<div class="missing">与 ' + (shared[name] - 1) + ' 个类型共用</div>' : '') + '</td>' +
        '<td class="names">' + esc(kind.note || '') + '</td></tr>'
    }).join('')

    bindReplay($('#file-tree'))
  }

  function sampleNameFor(kind) {
    var rule = kind.rule || {}
    if (rule.name && rule.name.length) return rule.name[0]
    if (rule.prefix && rule.prefix.length) return rule.prefix[0]
    if (rule.ext && rule.ext.length) return kind.id + '.' + rule.ext[0]
    return kind.id
  }

  // ------------------------------------------------------------------ thinking
  var BASELINE_SPINNER =
    '<span class="baseline-spinner" style="width:%SIZE%px;height:%SIZE%px">' +
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.75" opacity="0.2"></circle>' +
    '<path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"></path>' +
    '</svg></span>'

  function baselineSpinner(size) { return BASELINE_SPINNER.split('%SIZE%').join(String(size)) }

  function renderThinking() {
    var sizes = [10, 12, 14, 16, 20, 24]
    $('#spinner-compare').innerHTML = '' +
      '<div class="compare-card">' +
        '<h3>现在：自绘 Spinner</h3>' +
        '<p class="muted">16×16 圆环 + 四分之一弧，900ms 匀速旋转，颜色继承前景色；开启“减少动效”时停转但仍可见。</p>' +
        '<div class="sizes">' + sizes.map(function (s) {
          return '<figure><span class="stage">' + baselineSpinner(s) + '</span><figcaption>' + s + 'px</figcaption></figure>'
        }).join('') + '</div>' +
      '</div>' +
      '<div class="compare-card is-new">' +
        '<h3>替换为 svg-spinners:blocks-wave</h3>' +
        '<p class="muted">四格方块错峰起跳，24 网格，currentColor 填充；SMIL 驱动，无额外依赖。</p>' +
        '<div class="sizes">' + sizes.map(function (s) {
          return '<figure><span class="stage">' + icon('svg-spinners', 'blocks-wave', s) + '</span><figcaption>' + s + 'px</figcaption></figure>'
        }).join('') + '</div>' +
      '</div>'

    $('#spinner-context').innerHTML = '' +
      '<div class="compare-card"><h3>对话流状态行</h3><p class="muted">位于回合头部，与耗时并排。</p>' +
        '<div class="processing">' + icon('svg-spinners', 'blocks-wave', 16) + '<span>思考中...</span><span class="elapsed">7s</span></div>' +
        '<div class="processing">' + icon('svg-spinners', 'blocks-wave', 13) + '<span>思考中...</span><span class="elapsed">13 px（过密）</span></div>' +
        '<div class="processing">' + baselineSpinner(10) + '<span>思考中...</span><span class="elapsed">现状 10 px</span></div>' +
      '</div>' +
      '<div class="compare-card"><h3>工作台标签</h3><p class="muted">面板加载时替换标签左侧图形。</p>' +
        '<div class="tool-row">' + icon('svg-spinners', 'blocks-wave', 14) + '<span>文件</span><span class="tail">载入中</span></div>' +
        '<div class="tool-row">' + iconFor('filesPanel', 'next', 14) + '<span>文件</span><span class="tail">已就绪</span></div>' +
      '</div>' +
      '<div class="compare-card"><h3>工具执行行</h3><p class="muted">运行中与完成后的对照。</p>' +
        '<div class="tool-row">' + icon('svg-spinners', 'blocks-wave', 14) + '<span>bun run verify</span><span class="tail">执行中</span></div>' +
        '<div class="tool-row">' + iconFor('success', 'next', 14) + '<span>bun run verify</span><span class="tail">退出码 0</span></div>' +
      '</div>'

    $('#spinner-spec').innerHTML = [
      { h: '图形来源', rows: [['图标名', SPINNER], ['图标集', 'svg-spinners（46 个加载动效）'], ['作者', 'Utkarsh Verma'], ['许可', 'MIT']] },
      { h: '尺寸下限', rows: [['可见错峰', '≥ 16 px（10/12/14 px 四格会糊成一块）'], ['当前实现', 'text-[10px] 的 Spinner，容器 w-3 h-3（12 px）'], ['结论', '容器需一并放大到 16 px']] },
      { h: '可访问性', rows: [['问题', 'SMIL 动画不受 prefers-reduced-motion 影响'], ['处理', '在组件里读 useReducedMotion()，命中时 pauseAnimations() 或改渲染静态图形'], ['占位', '方形占位，避免切换时布局跳动']] },
    ].map(function (c) {
      return '<div class="spec-card"><h3>' + esc(c.h) + '</h3><dl>' + c.rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'
      }).join('') + '</dl></div>'
    }).join('')

    $('#spinner-code').innerHTML = codeBlock('思考中组件：替换后的最小实现', [
      'import blocksWave from \'@iconify-icons/svg-spinners/blocks-wave\'',
      '',
      'export function ThinkingIndicator({ label, elapsed }: Props) {',
      '  const ref = useRef<SVGSVGElement>(null)',
      '  const reduce = useReducedMotion()',
      '',
      '  useEffect(() => {',
      '    // SMIL ignores prefers-reduced-motion, so stop it explicitly.',
      '    if (reduce) ref.current?.pauseAnimations()',
      '    else ref.current?.unpauseAnimations()',
      '  }, [reduce])',
      '',
      '  return (',
      '    <div className="flex items-center gap-2 px-3 py-1 text-[13px] text-muted-foreground">',
      '      {/* 16px 容器，替换原先 w-3 h-3 的 10px Spinner */}',
      '      <span className="inline-flex size-4 shrink-0 items-center justify-center" role="status" aria-label={t(\'common.loading\')}>',
      '        <InlineIcon icon={blocksWave} ref={ref} width={16} height={16} />',
      '      </span>',
      '      <span className="whitespace-nowrap">{label}</span>',
      '      {elapsed >= 1 && <span className="tabular-nums text-muted-foreground/60 ml-1">{elapsed}s</span>}',
      '    </div>',
      '  )',
      '}',
    ])
  }

  function codeBlock(title, lines) {
    return '<div class="code-head">' + esc(title) + '</div><pre>' + esc(lines.join('\n')) + '</pre>'
  }

  // ------------------------------------------------------------------ ship
  function renderShip() {
    var t = D.totals
    var mergePurposes = D.purposes.filter(function (p) { return p.action === 'merge' })
    var redundantList = mergePurposes.map(function (p) { return p.label + '：' + p.redundant.join('、') + ' → ' + p.recommended }).join('；')
    statCards('#ship-stats', [
      { h: '真需要收敛的', big: t.redundant + ' 个图形', p: '分布在 ' + mergePurposes.length + ' 个用途：' + redundantList + '。' },
      { h: '换更贴切的', big: t.verdicts.replace + ' 个', p: '看板 columns-3 → square-kanban、表格 table-2 → table：同一语义，Lucide 里有更准的图形。' },
      { h: '用途表修正', big: t.purposesBefore + ' → ' + t.purposesAfter, p: '复核拆出 ' + t.newPurposes + ' 个真实用途。这不是"多此一举"：把不同语义合在一个用途里，才会得出"同义不同形"的错误结论。' },
      { h: '改名不改视觉', big: String(t.aliasRenames), p: '24 个旧名别名换 v1 规范名，渲染结果完全一致，可以独立提交。' },
    ])

    $('#ship-scope').innerHTML = '' +
      '<div><h3>建议顺序</h3><ol>' +
        '<li><b>先落地已确认的两项</b>：文件树接 VSCode Icons（独立于界面图标），思考中换 blocks-wave（含容器放大到 16 px 与减少动效处理）。</li>' +
        '<li><b>再统一命名</b>：24 个旧名别名换规范名，零视觉变化，可单独一个 PR。</li>' +
        '<li><b>然后只收敛真冗余</b>：' + t.redundant + ' 个图形，逐个改到本用途主图形上。</li>' +
        '<li><b>再按复核结果拆用途</b>：把 ' + t.splitOut + ' 个"其实语义不同"的图形各自归位，同步建语义图标表。</li>' +
        '<li><b>最后清理演示用法</b>：' + t.demoOnly + ' 个只在 playground / 图标表里出现的图形，决定保留、删除还是标注。</li>' +
        '<li>在 14 / 16 / 18 / 20 px 四种尺寸下逐屏核对，重点看顶栏与工具行。</li></ol></div>' +
      '<div><h3>风险与注意</h3><ul>' +
        '<li><b>不要把"数字好看"当目标</b>：上一版按"一个用途一个图标"去算，得出 206 → 92，代价是把语义不同的图形强行合并。真正的收益是 ' + t.redundant + ' 个收敛 + 用途表修正。</li>' +
        '<li><b>拆用途要一次到位</b>：' + t.newPurposes + ' 个新用途必须在语义图标表里显式登记，否则很快又会被合并回错误的桶里。</li>' +
        '<li><b>成对状态不能省</b>：' + t.paired + ' 个成对图形（显示/隐藏、标记/取消、启用/停用）必须成对保留。</li>' +
        '<li><b>占位图形</b>：Circle 一族是指示点与骨架占位，不属于语义图标，单独成组管理。</li>' +
        '<li><b>待产品确认</b>：' + t.uncertain + ' 项——错误提示的两种图形（circle-alert / circle-x）与邮件已读未读的图形分配。</li></ul></div>' +
      '<div><h3>不建议做的</h3><ul>' +
        '<li>不要为了减少图形数量，把"语义不同但在同一屏出现"的图形合并。</li>' +
        '<li>不要在业务组件里继续 import 具体图标组件名——这正是 206 个图形的来源。</li>' +
        '<li>不要把演示稿（playground）里的用法当成产品决策依据，它们不进生产。</li>' +
        '<li>不要给文件类型继续加 UI 图标分支，那属于彩色文件主题的职责。</li></ul></div>'

    $('#ship-code').innerHTML = codeBlock('src/components/icons/semantic-icons.ts（骨架）', [
      'import {',
      '  MessageSquare, SquareKanban, CalendarDays, SquareChartGantt, FolderTree,',
      '  Activity, SquareTerminal, Globe, CircleQuestionMark, SquarePen,',
      '  // …每个用途只留一个主图形',
      '} from \'lucide-react\'',
      '',
      '/** 语义图标表：业务代码只认 key，不认组件名。 */',
      'export const icons = {',
      '  sessions: MessageSquare,',
      '  kanban: SquareKanban,',
      '  calendar: CalendarDays,',
      '  gantt: SquareChartGantt,',
      '  files: FolderTree,',
      '  trajectory: Activity,',
      '  terminal: SquareTerminal,',
      '  browser: Globe,',
      '  help: CircleQuestionMark,',
      '  newSession: SquarePen,',
      '  // …共 ' + D.totals.purposesAfter + ' 个用途，逐条对应复核结论',
      '} as const',
      '',
      'export type SemanticIcon = keyof typeof icons',
      '',
      '/** 组件里这样用： */',
      'export function NavIcon({ name, className }: { name: SemanticIcon; className?: string }) {',
      '  const Icon = icons[name]',
      '  return <Icon className={className} aria-hidden />',
      '}',
    ])

    var acceptance = [
      { h: '机制', rows: [['语义入口', '业务代码不再出现 lucide 组件名'], ['校验', '构建时校验图标表覆盖 ' + D.totals.purposesAfter + ' 个用途，缺失即失败'], ['复核留痕', '每个图形在图标表里带判定与依据，防止再次被错误合并']] },
      { h: '视觉', rows: [['尺寸', '14 / 16 / 18 / 20 px 四档逐屏核对'], ['换图形', D.totals.verdicts.replace + ' 处（看板、表格）需产品确认'], ['状态色', '成功/警告/错误仍靠颜色与图形双重表达']] },
      { h: '文件与加载', rows: [['文件图标', 'VSCode Icons，独立解析器'], ['思考中', 'blocks-wave，容器 16 px'], ['减少动效', 'pauseAnimations() 或静态图形']] },
      { h: '复核闭环', rows: [['触发条件', '新图标上线、语义变更、跨区域复用'], ['方法', '用 tools/review.mjs 拉调用点证据，再更新 verdicts.mjs'], ['门槛', '任何非主图形没有判定，resolve-plan 直接失败']] },
    ]
    $('#ship-acceptance').innerHTML = acceptance.map(function (c) {
      return '<div><h3>' + esc(c.h) + '</h3><dl class="spec-dl">' + c.rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'
      }).join('') + '</dl></div>'
    }).join('')

    var licenses = [
      { b: 'Lucide（界面图标）', t: D.licenses.lucide.author + ' · ' + D.licenses.lucide.license, u: D.licenses.lucide.licenseUrl },
      { b: 'VSCode Icons（文件图标）', t: D.licenses['vscode-icons'].author + ' · ' + D.licenses['vscode-icons'].license, u: D.licenses['vscode-icons'].licenseUrl },
      { b: 'SVG Spinners（思考中）', t: D.licenses['svg-spinners'].author + ' · ' + D.licenses['svg-spinners'].license, u: D.licenses['svg-spinners'].licenseUrl },
    ]
    $('#license-grid').innerHTML = licenses.map(function (l) {
      return '<div class="license-card"><b>' + esc(l.b) + '</b>' + esc(l.t) +
        (l.u ? '<div><a href="' + esc(l.u) + '" target="_blank" rel="noreferrer">许可原文</a></div>' : '') + '</div>'
    }).join('')
  }

  // ------------------------------------------------------------------ wiring
  function switchPanel(name) {
    $$('.tab').forEach(function (tab) { tab.setAttribute('aria-selected', String(tab.dataset.panel === name)) })
    $$('.panel').forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + name })
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true }, function () { return false })
    }
    var area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    var ok = false
    try { ok = document.execCommand('copy') } catch (error) { ok = false }
    document.body.removeChild(area)
    return Promise.resolve(ok)
  }

  function wire() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchPanel(tab.dataset.panel) })
    })

    $('#theme-toggle').addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark'
      document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark')
      this.textContent = dark ? '切换深色' : '切换浅色'
    })

    $('#plan-search').addEventListener('input', function () { state.plan.q = this.value; renderPlan() })
    $('#plan-group').addEventListener('change', function () { state.plan.group = this.value; renderPlan() })
    $('#plan-action').addEventListener('change', function () { state.plan.action = this.value; renderPlan() })
    $('#plan-verdict').addEventListener('change', function () { state.plan.verdict = this.value; renderPlan() })
    $('#plan-size').addEventListener('change', function () { state.plan.size = Number(this.value); renderPlan() })

    $('#plan-body').addEventListener('click', function (event) {
      var pick = event.target.closest('button[data-pick]')
      if (pick) {
        var id = pick.dataset.pick
        state.picker = state.picker === id ? null : id
        state.pickerQuery = ''
        renderPlan()
        var input = $('.picker-search')
        if (input) input.focus()
        return
      }
      var chosen = event.target.closest('button[data-pick-icon]')
      if (chosen) {
        var row = chosen.closest('tr[data-purpose]')
        state.overrides[row.dataset.purpose] = chosen.dataset.pickIcon
        renderPlan()
        renderDraft()
        renderWorkbench()
        return
      }
      if (event.target.closest('button[data-pick-close]')) {
        state.picker = null
        renderPlan()
      }
    })

    $('#plan-body').addEventListener('input', function (event) {
      if (!event.target.classList.contains('picker-search')) return
      state.pickerQuery = event.target.value.trim().toLowerCase()
      var row = event.target.closest('tr[data-purpose]')
      renderPlan()
      var next = $('.picker-search')
      if (next) {
        next.focus()
        next.setSelectionRange(next.value.length, next.value.length)
      }
    })

    $('#draft-bar').addEventListener('click', function (event) {
      var remove = event.target.closest('button[data-remove]')
      if (remove) {
        delete state.overrides[remove.dataset.remove]
        renderPlan()
        renderDraft()
        renderWorkbench()
      }
    })
    $('#draft-clear').addEventListener('click', function () {
      state.overrides = {}
      renderPlan()
      renderDraft()
      renderWorkbench()
    })
    $('#draft-copy').addEventListener('click', function () {
      var button = this
      copyText(draftJson()).then(function (ok) {
        button.textContent = ok ? '已复制' : '复制失败'
        setTimeout(function () { button.textContent = '复制 JSON' }, 1600)
      })
    })

    $('#workbench-size').addEventListener('change', function () { state.workbench.size = Number(this.value); renderWorkbench() })
    $('#workbench-panel').addEventListener('change', function () { state.workbench.panel = this.value; renderWorkbench() })

    $('#file-theme').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-theme]')
      if (!button) return
      state.fileTheme = button.dataset.theme
      renderFiles()
    })
    $('#file-size').addEventListener('change', function () { state.fileSize = Number(this.value); renderFiles() })
    $('#file-collapse').addEventListener('click', function () {
      var collapsed = Object.keys(state.collapsed).length > 0
      state.collapsed = {}
      if (!collapsed) {
        var walk = function (nodes, path) {
          nodes.forEach(function (node) {
            if (node.children === undefined) return
            var key = path + '/' + node.name
            if (!node.open) state.collapsed[key] = true
            walk(node.children, key)
          })
        }
        walk(D.fileTree, '')
      }
      renderFileTree()
      bindReplay($('#file-tree'))
    })
    $('#file-tree').addEventListener('click', function (event) {
      var row = event.target.closest('.tree-row[data-dir]')
      if (!row) return
      if (state.collapsed[row.dataset.path]) delete state.collapsed[row.dataset.path]
      else state.collapsed[row.dataset.path] = true
      renderFileTree()
      bindReplay($('#file-tree'))
    })
  }

  // ------------------------------------------------------------------ boot
  renderHero()
  renderAudit()
  renderPlan()
  renderDraft()
  renderWorkbench()
  renderFiles()
  renderThinking()
  renderShip()
  wire()
  bindReplay(document)
})()
