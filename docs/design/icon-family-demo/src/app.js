/* Phaneris icon-family demo — rendering + interaction. */
(function () {
  'use strict'

  var D = window.DEMO
  var FAMILIES = ['a', 'b', 'c']
  var PREFIX = { a: 'line-md', b: 'ci', c: 'mi' }
  var LUCIDE_ROOT_ATTRS = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  var SPINNER = 'svg-spinners:blocks-wave'

  var FAMILY_INFO = {
    a: { title: 'A · Line MD', tag: '描线动画 · 最轻', blurb: '线条最轻，绝大多数图形自带描线动画；偏界面骨架，数据与业务图形很少。' },
    b: { title: 'B · Coolicons', tag: '覆盖最全 · 中性', blurb: '24 网格 2 描边圆端点。终端、地球、拼图、键盘、打印机等都是原生，覆盖最完整。' },
    c: { title: 'C · Mono Icons', tag: '填充轮廓 · 紧凑', blurb: '用填充路径构成轮廓，小尺寸最扎实；总量只有 180 个，业务图形折中最多。' },
  }

  var $ = function (sel, root) { return (root || document).querySelector(sel) }
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // ------------------------------------------------------------------ icons
  /** One registry for UI families and file themes alike. */
  var ICON_SETS = {}
  Object.keys(D.sets).forEach(function (prefix) { ICON_SETS[prefix] = D.sets[prefix] })
  Object.keys(D.fileSets).forEach(function (key) {
    var theme = D.files.themes[key]
    ICON_SETS[theme ? theme.prefix : key] = D.fileSets[key]
  })

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
      return '<span class="ic ' + (cls || '') + '" style="' + box + '" title="' +
        esc(prefix + ':' + name + ' 未取到') + '"></span>'
    }
    var w = entry.w || set.width || 24
    var h = entry.h || set.height || 24
    var l = entry.l || 0
    var t = entry.t || 0
    var body = uniquify(entry.b, 'i' + (++uid))
    var root = prefix === 'lucide' ? LUCIDE_ROOT_ATTRS : ''
    return '<span class="ic ' + (cls || '') + '" style="' + box + '"' + (title ? ' title="' + esc(title) + '"' : '') +
      '><svg viewBox="' + l + ' ' + t + ' ' + w + ' ' + h + '" width="' + size + '" height="' + size + '"' + root +
      ' aria-hidden="true">' + body + '</svg></span>'
  }

  function purposeIcon(purpose, family, size) {
    if (purpose.spinner) {
      var parts = purpose.spinner.split(':')
      return icon(parts[0], parts[1], size, purpose.spinner === SPINNER ? 'wave' : '')
    }
    return icon(PREFIX[family], purpose[family], size)
  }

  /** Hover-replay for SMIL-animated icons: resetting the SVG timeline replays the drawing. */
  function bindReplay(root, enabled) {
    $$('.ic svg', root).forEach(function (svg) {
      if (!svg.querySelector('animate')) return
      svg.setCurrentTime(0)
      svg.addEventListener('mouseenter', function () {
        if (state.replay) svg.setCurrentTime(0)
      })
    })
  }

  function qualityOf(purpose, family) {
    return (purpose.q && purpose.q[family]) || 'native'
  }

  var QUALITY_LABEL = { native: '原生', approx: '近似', reuse: '复用' }
  function qualityChip(kind) {
    return '<span class="chip ' + kind + '">' + QUALITY_LABEL[kind] + '</span>'
  }

  // ------------------------------------------------------------------ stats
  var byId = {}
  D.purposes.forEach(function (p) { byId[p.id] = p })

  function setStats(prefix) {
    var set = ICON_SETS[prefix]
    var names = Object.keys(set.icons)
    var animated = 0
    var colored = 0
    for (var i = 0; i < names.length; i++) {
      var body = set.icons[names[i]].b
      if (body.indexOf('<animate') >= 0) animated++
      if (/#[0-9a-fA-F]{6}/.test(body)) colored++
    }
    return { total: D.setMeta[prefix].total || names.length, fetched: names.length, animated: animated, colored: colored }
  }

  var STATS = {}
  STATS.lucide = setStats('lucide')
  FAMILIES.forEach(function (k) { STATS[k] = setStats(PREFIX[k]) })

  function familyCoverage(family) {
    var native = 0, approx = 0, reuse = 0
    D.purposes.forEach(function (p) {
      if (p.spinner) return
      var q = qualityOf(p, family)
      if (q === 'native') native++
      else if (q === 'approx') approx++
      else reuse++
    })
    return { native: native, approx: approx, reuse: reuse, total: native + approx + reuse }
  }

  // ------------------------------------------------------------------ state
  var state = {
    family: 'a',
    replay: true,
    collapsed: {},
    fileTheme: 'current',
    fileSize: 18,
    fileFamily: 'b',
    gallery: { family: 'a', q: '', cat: 'all', size: 32, page: 1 },
    matrix: { q: '', group: 'all', quality: 'all', size: 20 },
    workbench: { family: 'b', size: 16, panel: 'files' },
  }

  // ------------------------------------------------------------------ hero
  function renderHero() {
    $('#hero-components').textContent = String(D.survey.distinctComponents - 1)
    $('#hero-purposes').textContent = String(D.purposes.length)
    $('#hero-files').textContent = String(D.files.kinds.length)
    var rows = [
      ['三套候选 + 当前基线', '4 套'],
      ['语义用途', D.purposes.length + ' 个'],
      ['Lucide 组件落位', D.validation.mapping.placed + ' / ' + D.validation.mapping.surveyed],
      ['文件类型', D.files.kinds.length + ' 类'],
      ['源码扫描', D.survey.filesWithLucideImport + ' 文件 / ' + D.survey.totalNamedImports + ' 次导入'],
      ['图标总量', STATS.a.total + ' / ' + STATS.b.total + ' / ' + STATS.c.total],
    ]
    $('#hero-stats').innerHTML = rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'
    }).join('')
    $('#built-at').textContent = '演示页生成于 ' + new Date(D.builtAt).toLocaleString('zh-CN') + '；数据一次性内联，可离线打开。'
  }

  // ------------------------------------------------------------------ family cards
  function renderFamilyCards() {
    var samples = ['sessions', 'folder', 'settings', 'search', 'success', 'terminal', 'image', 'clock']
    $('#family-cards').innerHTML = FAMILIES.map(function (family) {
      var prefix = PREFIX[family]
      var meta = D.setMeta[prefix]
      var stat = STATS[family]
      var cov = familyCoverage(family)
      var pct = function (n) { return Math.round((n / cov.total) * 100) }
      return '' +
        '<article class="family-card">' +
          '<header><h3>' + esc(FAMILY_INFO[family].title) + '</h3><span class="badge badge-quiet">' + esc(FAMILY_INFO[family].tag) + '</span></header>' +
          '<p class="sub">' + esc(FAMILY_INFO[family].blurb) + '</p>' +
          '<div class="family-samples">' + samples.map(function (id) {
            var p = byId[id]
            return p ? purposeIcon(p, family, 22) : ''
          }).join('') + '</div>' +
          '<div class="coverage-bar" title="原生 ' + cov.native + ' / 近似 ' + cov.approx + ' / 复用 ' + cov.reuse + '">' +
            '<i class="native" style="width:' + pct(cov.native) + '%"></i>' +
            '<i class="approx" style="width:' + pct(cov.approx) + '%"></i>' +
            '<i class="reuse" style="width:' + pct(cov.reuse) + '%"></i>' +
          '</div>' +
          '<div class="legend">' +
            '<span><i class="dot native"></i>原生 <b>' + cov.native + '</b></span>' +
            '<span><i class="dot approx"></i>近似 <b>' + cov.approx + '</b></span>' +
            '<span><i class="dot reuse"></i>复用 <b>' + cov.reuse + '</b></span>' +
            '<span>原生率 <b>' + pct(cov.native) + '%</b></span>' +
          '</div>' +
          '<div class="family-facts">' +
            '<div><span>官方名称</span><span>' + esc(meta.officialName || prefix) + '</span></div>' +
            '<div><span>图标总数</span><span>' + stat.total + '</span></div>' +
            '<div><span>本次内联</span><span>' + stat.fetched + '</span></div>' +
            '<div><span>网格</span><span>' + (meta.height || 24) + ' px</span></div>' +
            '<div><span>含动画</span><span>' + stat.animated + '</span></div>' +
            '<div><span>原生分类</span><span>' + (meta.categories.length || '—') + '</span></div>' +
            '<div><span>作者</span><span>' + esc(meta.author || '—') + '</span></div>' +
            '<div><span>许可</span><span>' + esc(meta.license || '—') + '</span></div>' +
          '</div>' +
        '</article>'
    }).join('')

    // Matrix controls
    var groupSel = $('#matrix-group')
    groupSel.innerHTML = '<option value="all">全部区域</option>' + D.groups.map(function (g) {
      return '<option value="' + g.id + '">' + esc(g.title) + '</option>'
    }).join('')
  }

  // ------------------------------------------------------------------ matrix
  function matrixRows() {
    var q = state.matrix.q.trim().toLowerCase()
    return D.purposes.filter(function (p) {
      if (state.matrix.group !== 'all' && p.group !== state.matrix.group) return false
      if (state.matrix.quality !== 'all') {
        if (state.matrix.quality === 'approx') {
          if (!FAMILIES.some(function (f) { return qualityOf(p, f) === 'approx' })) return false
        } else if (qualityOf(p, state.matrix.quality) !== 'approx') return false
      }
      if (!q) return true
      var hay = [p.label, p.id, p.current, p.note, p.a, p.b, p.c].concat(p.lucide || []).join(' ').toLowerCase()
      return hay.indexOf(q) >= 0
    })
  }

  function renderMatrix() {
    var size = state.matrix.size
    $('#matrix-head').innerHTML = '<tr>' +
      '<th>用途</th><th>当前基线</th>' +
      FAMILIES.map(function (f) { return '<th>' + esc(FAMILY_INFO[f].title) + '</th>' }).join('') +
      '<th>取向说明</th></tr>'

    var rows = matrixRows()
    $('#matrix-body').innerHTML = rows.map(function (p) {
      var baseline = p.spinner
        ? '<span class="baseline">自绘 Spinner（16×16 圆环 + 弧）</span>'
        : '<span class="cell-icon">' + icon('lucide', kebabOf(p.current), size) +
          '<span class="name">' + esc(p.current || '—') + '<em>' + ((p.lucide || []).length) + ' 个组件</em></span></span>'
      var cells = FAMILIES.map(function (f) {
        var q = qualityOf(p, f)
        var alt = p.alt && p.alt[f]
        return '<td><div class="cell-icon">' + purposeIcon(p, f, size) +
          '<span class="name">' + esc(p[f] || '') + '<em>' + esc(PREFIX[f]) + '</em></span>' +
          qualityChip(q) + '</div>' +
          (alt ? '<div class="alt-row">' + icon(PREFIX[f], alt, Math.max(12, size - 4)) + '<span>' + esc(alt) + '</span></div>' : '') +
          '</td>'
      }).join('')
      return '<tr' + (p.spinner ? ' class="is-spinner"' : '') + '>' +
        '<td class="purpose"><b>' + esc(p.label) + '</b><code>' + esc(p.id) + '</code></td>' +
        '<td>' + baseline + '</td>' + cells +
        '<td class="note">' + esc(p.note) + '</td>' +
        '</tr>'
    }).join('')

    $('#matrix-count').textContent = '显示 ' + rows.length + ' / ' + D.purposes.length + ' 个用途；尺寸 ' + size + ' px。'
  }

  function kebabOf(component) {
    return String(component || '')
      .replace(/（.*$/, '')
      .trim()
      .replace(/Icon$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .replace(/([A-Za-z])([0-9])/g, '$1-$2')
      .toLowerCase()
  }

  // ------------------------------------------------------------------ verify
  function renderVerify() {
    var s = D.validation.mapping
    var shared = {}
    var checkedNames = D.purposes.length * 3
    D.purposes.forEach(function (p) { if (p.alt) checkedNames += Object.keys(p.alt).length })
    Object.keys(D.files.themes).forEach(function (key) {
      var names = D.fileSets[key].icons
      var uses = {}
      D.files.kinds.forEach(function (kind) {
        var name = kind[key]
        if (name && names[name]) uses[name] = (uses[name] || 0) + 1
      })
      shared[key] = Object.keys(uses).filter(function (name) { return uses[name] > 1 }).length
      checkedNames += D.files.kinds.length
    })
    var cards = [
      { h: 'Lucide 组件落位', big: s.placed + ' / ' + s.surveyed, p: '来自 apps、packages 下 ' + D.survey.filesWithLucideImport + ' 个含 lucide-react 导入的文件（' + D.survey.totalNamedImports + ' 次命名导入），去重后全部归入语义用途。' },
      { h: '语义用途', big: String(D.purposes.length), p: '分成 ' + D.groups.length + ' 个区域；每个用途都给出三套候选图形与取舍说明。' },
      { h: '图标名核验', big: String(checkedNames), p: '构建时逐个校验：用途的三套图形名、第二形态名、文件类型名与兜底图形名都必须在对应图标集里真实存在，否则构建直接失败。' },
      { h: '文件类型覆盖', big: D.files.kinds.length + ' 类', p: '未识别的类型由兜底图形接管。一个图形被多个类型共用的情况：VSCode Icons ' + shared.vscode + ' 处、Material ' + shared.material + ' 处（例如 Material 的 CSV 与 Excel 共用表格图形），逐条标在下方表格里。' },
      { h: '整套规模', big: STATS.a.total + ' / ' + STATS.b.total + ' / ' + STATS.c.total, p: 'Line MD / Coolicons / Mono Icons 的图标总量，全部内联在本页，可在“整套浏览”里逐个查看。' },
      { h: '动画占比', big: STATS.a.animated + ' / ' + STATS.a.fetched, p: 'Line MD 中带 SMIL 描线动画的图形数量；Coolicons 与 Mono Icons 没有动画。' },
    ]
    $('#verify-grid').innerHTML = cards.map(function (c) {
      return '<div class="verify-card"><h3>' + esc(c.h) + '</h3><div class="big">' + esc(c.big) + '</div><p>' + esc(c.p) + '</p></div>'
    }).join('')
  }

  // ------------------------------------------------------------------ gallery
  var PAGE_SIZE = 60
  function galleryNames() {
    var prefix = PREFIX[state.gallery.family]
    var meta = D.setMeta[prefix]
    var names = Object.keys(ICON_SETS[prefix].icons)
    var q = state.gallery.q.trim().toLowerCase()
    if (q) names = names.filter(function (n) { return n.toLowerCase().indexOf(q) >= 0 })
    if (state.gallery.cat !== 'all') names = names.filter(function (n) { return meta.categoryNames[n] === state.gallery.cat })
    return names.sort()
  }

  function renderGalleryControls() {
    $('#gallery-family').innerHTML = FAMILIES.map(function (f) {
      return '<button type="button" data-family="' + f + '" aria-pressed="' + (state.gallery.family === f) + '">' +
        esc(FAMILY_INFO[f].title.split(' · ')[1]) + '</button>'
    }).join('')
    var prefix = PREFIX[state.gallery.family]
    var cats = D.setMeta[prefix].categories
    $('#gallery-category-wrap').style.display = cats.length ? '' : 'none'
    $('#gallery-category').innerHTML = '<option value="all">全部分类</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.gallery.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'
    }).join('')
  }

  function renderGallery() {
    renderGalleryControls()
    var prefix = PREFIX[state.gallery.family]
    var names = galleryNames()
    var pages = Math.max(1, Math.ceil(names.length / PAGE_SIZE))
    if (state.gallery.page > pages) state.gallery.page = pages
    var start = (state.gallery.page - 1) * PAGE_SIZE
    var slice = names.slice(start, start + PAGE_SIZE)
    var size = state.gallery.size

    $('#gallery-grid').innerHTML = slice.map(function (name) {
      return '<div class="icon-tile" title="' + esc(prefix + ':' + name) + '">' +
        icon(prefix, name, size) + '<span>' + esc(name) + '</span></div>'
    }).join('')

    $('#gallery-count').textContent = esc(D.setMeta[prefix].title) + '：共 ' + names.length + ' 个图形，第 ' +
      state.gallery.page + ' / ' + pages + ' 页。' +
      (prefix === 'line-md' ? ' 悬停任意图形可重放描线动画。' : '')

    var buttons = []
    buttons.push('<button type="button" data-page="1"' + (state.gallery.page === 1 ? ' disabled' : '') + '>首页</button>')
    buttons.push('<button type="button" data-page="' + (state.gallery.page - 1) + '"' + (state.gallery.page === 1 ? ' disabled' : '') + '>上一页</button>')
    var from = Math.max(1, state.gallery.page - 3)
    var to = Math.min(pages, from + 6)
    for (var i = from; i <= to; i++) {
      buttons.push('<button type="button" data-page="' + i + '"' + (i === state.gallery.page ? ' aria-current="true"' : '') + '>' + i + '</button>')
    }
    buttons.push('<button type="button" data-page="' + (state.gallery.page + 1) + '"' + (state.gallery.page === pages ? ' disabled' : '') + '>下一页</button>')
    buttons.push('<button type="button" data-page="' + pages + '"' + (state.gallery.page === pages ? ' disabled' : '') + '>末页</button>')
    $('#gallery-pager').innerHTML = buttons.join('')

    bindReplay($('#gallery-grid'))
  }

  // ------------------------------------------------------------------ workbench
  function sideItem(purposeId, label, family, size, extra) {
    var p = byId[purposeId]
    return '<div class="side-item' + (extra && extra.active ? ' is-active' : '') + '">' +
      (p ? purposeIcon(p, family, size) : '') + '<span>' + esc(label) + '</span>' +
      (extra && extra.count ? '<span class="count">' + esc(extra.count) + '</span>' : '') + '</div>'
  }

  function launcher(purposeId, label, family, size, kind) {
    var p = byId[purposeId]
    return '<span class="launcher-wrap"><span class="launcher ' + (kind || '') + '" title="' + esc(label) + '">' +
      (p ? purposeIcon(p, family, size) : '') + '</span>' +
      (kind === 'is-open' ? '<span class="tabdot"></span>' : '') + '</span>'
  }

  function toolRow(purposeId, text, tail, family, size) {
    var p = byId[purposeId]
    return '<div class="tool-row">' + (p ? purposeIcon(p, family, size) : '') + '<span>' + esc(text) + '</span>' +
      '<span class="tail">' + esc(tail) + '</span></div>'
  }

  function renderWorkbench() {
    var family = state.workbench.family
    var size = state.workbench.size
    var small = Math.max(12, size - 2)

    $('#workbench-family').innerHTML = FAMILIES.map(function (f) {
      return '<button type="button" data-family="' + f + '" aria-pressed="' + (family === f) + '">' +
        esc(FAMILY_INFO[f].title.split(' · ')[1]) + '</button>'
    }).join('')

    var top = '' +
      '<div class="app-top">' +
        launcher('newSession', '新对话', family, size) +
        launcher('sessions', '会话', family, size, 'is-focused') +
        launcher('kanban', '看板', family, size) +
        launcher('calendar', '日历', family, size) +
        launcher('gantt', '甘特图', family, size) +
        '<span class="separator"></span>' +
        launcher('filesPanel', '文件', family, size, 'is-open') +
        launcher('trajectory', '运行', family, size) +
        launcher('terminal', '终端', family, size) +
        '<span class="separator"></span>' +
        launcher('browser', '浏览器', family, size) +
        launcher('help', '帮助', family, size) +
        '<span class="spacer"></span>' +
        launcher('visibility', '显示', family, size) +
        launcher('settings', '设置', family, size) +
      '</div>'

    var side = '' +
      '<div class="side">' +
        sideItem('workspace', 'Phaneris', family, size, { count: '3' }) +
        '<div class="side-group">会话</div>' +
        sideItem('sessions', '全部会话', family, size, { active: true, count: '18' }) +
        sideItem('labels', '已标记', family, size, { count: '4' }) +
        sideItem('archive', '已归档', family, size) +
        '<div class="side-group">资源</div>' +
        sideItem('projects', '项目', family, size, { count: '5' }) +
        sideItem('pages', '页面', family, size, { count: '7' }) +
        sideItem('sources', '来源', family, size, { count: '2' }) +
        sideItem('skills', '技能', family, size, { count: '12' }) +
        sideItem('plugins', '插件', family, size, { count: '3' }) +
        sideItem('automations', '自动化', family, size, { count: '6' }) +
        '<div class="side-foot">' +
          sideItem('settings', '设置', family, size) +
          sideItem('help', '帮助', family, size) +
        '</div>' +
      '</div>'

    var thread = '' +
      '<div class="thread">' +
        '<div class="msg-user">把图标体系换掉，顺便看看文件图标能不能做成彩色的。</div>' +
        '<div class="turn">' +
          '<div class="turn-head">' + icon('lucide', 'chevron-down', small) +
            purposeIcon(byId.thinking, family, small) +
            '<span>Phaneris</span><span class="badge badge-quiet">运行中</span></div>' +
          '<div class="turn-body">' +
            toolRow('search', '搜索 图标集', '12 处', family, small) +
            toolRow('document', '读取 icon-mapping.json', '1.2 KB', family, small) +
            toolRow('code', '编辑 App.tsx', '+8 −3', family, small) +
            toolRow('terminal', 'bun run verify', '退出码 0', family, small) +
            '<div class="processing">' + purposeIcon(byId.thinking, family, size) +
              '<span>思考中...</span><span class="elapsed">7s</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="composer">' +
          '<span class="icon-btn">' + purposeIcon(byId.attach, family, size) + '</span>' +
          '<span class="icon-btn">' + purposeIcon(byId.image, family, size) + '</span>' +
          '<span class="placeholder">继续描述你的需求…</span>' +
          '<span class="icon-btn">' + purposeIcon(byId.keyboard, family, size) + '</span>' +
          '<span class="icon-btn primary">' + purposeIcon(byId.send, family, size) + '</span>' +
        '</div>' +
      '</div>'

    var right
    if (state.workbench.panel === 'files') {
      right = '<div class="right">' +
        '<div class="right-head">' + purposeIcon(byId.filesPanel, family, small) + '<span>文件</span>' +
          '<span style="margin-left:auto">' + purposeIcon(byId.more, family, small) + '</span></div>' +
        '<div class="mini-tree">' + miniTree(size) + '</div></div>'
    } else {
      right = '<div class="right">' +
        '<div class="right-head">' + purposeIcon(byId.trajectory, family, small) + '<span>运行</span>' +
          '<span style="margin-left:auto">' + purposeIcon(byId.refresh, family, small) + '</span></div>' +
        '<div class="traj">' +
          trajRow('搜索', '搜索图标集 · 12 处命中', 'ok') +
          trajRow('读取', 'icon-mapping.json', 'ok') +
          trajRow('编辑', 'App.tsx', 'run') +
          trajRow('校验', '类型检查 · 等待中', 'warn') +
        '</div></div>'
    }

    $('#app-frame').innerHTML = top +
      '<div class="app-body' + (state.workbench.panel === 'none' ? ' no-right' : '') + '">' + side + thread + right + '</div>'

    $('#workbench-note').textContent = '当前：' + FAMILY_INFO[family].title + '，界面尺寸 ' + size +
      ' px。文件面板使用彩色文件主题，与界面图标互不影响；思考中固定为 blocks-wave。'

    bindReplay($('#app-frame'))
  }

  function trajRow(label, text, kind) {
    return '<div class="traj-row"><span>' + esc(label) + '</span><span class="traj-bar ' + kind + '">' + esc(text) + '</span></div>'
  }

  function miniTree(size) {
    var rows = []
    var walk = function (nodes, depth) {
      nodes.slice(0, depth === 0 ? 8 : 4).forEach(function (node) {
        var isDir = node.children !== undefined
        rows.push('<div class="mini-row" style="padding-left:' + (6 + depth * 12) + 'px">' +
          fileIcon(node, size, 'vscode') + '<span class="name">' + esc(node.name) + '</span>' +
          (isDir ? '<span class="tail">' + (node.children.length || '') + '</span>' : '') + '</div>')
        if (isDir && node.open) walk(node.children, depth + 1)
      })
    }
    walk(D.files.tree, 0)
    return rows.join('')
  }

  // ------------------------------------------------------------------ files
  function lucideBaselineFor(kind, node) {
    if (node && node.children !== undefined) return kind === 'folderOpen' && false ? 'folder-open' : 'folder'
    var ext = String(node && node.name || '').split('.').pop().toLowerCase()
    if (['md', 'markdown'].indexOf(ext) >= 0) return 'file-text'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].indexOf(ext) >= 0) return 'image'
    if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs'].indexOf(ext) >= 0) return 'file-code'
    return 'file'
  }

  function fileIcon(node, size, theme) {
    var kind = node.kind
    if (theme === 'current') return icon('lucide', lucideBaselineFor(kind, node), size)
    var prefix = D.files.themes[theme].prefix
    var name = null
    for (var i = 0; i < D.files.kinds.length; i++) if (D.files.kinds[i].id === kind) { name = D.files.kinds[i][theme]; break }
    var set = D.fileSets[theme]
    if (!name || !set.icons[name]) {
      var fb = D.files.themes[theme].fallback
      name = node.children !== undefined ? fb.folder : fb.file
    }
    return icon(prefix, name, size)
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
        html += '<div class="tree-row' + (isDir ? ' is-dir' : '') + (theme === 'current' ? ' mono' : '') +
          '" style="padding-left:' + (6 + depth * 14) + 'px" data-path="' + esc(key) + '"' + (isDir ? ' data-dir="1"' : '') + '>' +
          '<span class="caret">' + (isDir ? (open ? '▾' : '▸') : '') + '</span>' +
          fileIcon(node, size, theme) +
          '<span class="name">' + esc(node.name) + '</span>' +
          '<span class="size">' + (isDir ? node.children.length + ' 项' : fileSize(node.name)) + '</span>' +
          '</div>'
        if (isDir && open) walk(node.children, depth + 1, key)
      })
    }
    walk(D.files.tree, 0, '')
    $('#file-tree').innerHTML = html
  }

  function fileSize(name) {
    var h = 0
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997
    var kb = 1 + (h % 240)
    return kb >= 1000 ? (kb / 1000).toFixed(1) + ' MB' : kb + ' KB'
  }

  function renderFiles() {
    var themes = [['current', '当前单色'], ['vscode', 'VSCode Icons'], ['material', 'Material Icon Theme']]
    $('#file-theme').innerHTML = themes.map(function (t) {
      return '<button type="button" data-theme="' + t[0] + '" aria-pressed="' + (state.fileTheme === t[0]) + '">' + esc(t[1]) + '</button>'
    }).join('')

    var badge = {
      current: '当前实现：6 个单色图形',
      vscode: 'VSCode Icons · ' + (D.setMeta['vscode-icons'].license || 'MIT'),
      material: 'Material Icon Theme · ' + (D.setMeta['material-icon-theme'].license || 'MIT'),
    }
    $('#file-theme-badge').textContent = badge[state.fileTheme]

    renderFileTree()

    var notes = {
      current: '<h3>现在的做法</h3><p>文件树只按四种情况换图形：目录、Markdown、图片、代码，其余一律通用文档；颜色全部继承前景色。</p>' +
        '<p>结果就是：<code>.ts</code> 和 <code>.json</code> 长得一样，<code>.zip</code>、<code>.pdf</code>、<code>.xlsx</code> 也是同一个文档图形。</p>',
      vscode: '<h3>VSCode Icons</h3><p>1693 个图形，编辑器里最常见的一套彩色文件主题。类型识别最细：<code>bun.lock</code>、<code>bunfig.toml</code>、<code>Dockerfile.server</code>、<code>tsconfig.*</code> 都有专用图形，目录还按名称着色（src、docs、test…）。</p>' +
        '<p>代价是配色最花：同屏可能出现七八种颜色，需要控制目录着色的使用范围。</p>',
      material: '<h3>Material Icon Theme</h3><p>906 个图形，几何感更强、配色更克制，目录图标更扁平。整套体量约为 VSCode 主题的一半。</p>' +
        '<p>缺口也比较明确：没有 Excel/CSV 专用图形、没有文件夹开合两态、没有 .txt 专用图形——都由兜底图形接管。</p>',
    }
    $('#file-note').innerHTML = notes[state.fileTheme]

    $('#type-body').innerHTML = D.files.kinds.map(function (kind) {
      var sample = { name: sampleNameFor(kind), kind: kind.id, children: kind.rule && kind.rule.dir ? [] : undefined }
      var cells = ['vscode', 'material'].map(function (key) {
        var name = kind[key]
        var ok = name && D.fileSets[key].icons[name]
        return '<td>' + (ok ? icon(D.files.themes[key].prefix, name, 20) : '') +
          '<span class="names">' + esc(name || '') + '</span>' +
          (ok ? '' : '<div class="missing">用兜底图形</div>') + '</td>'
      }).join('')
      return '<tr><td>' + esc(kind.label) + '</td>' +
        '<td>' + icon('lucide', lucideBaselineFor(kind.id, sample), 20) + '</td>' + cells +
        '<td class="names">' + esc(kind.note || '') + '</td></tr>'
    }).join('')

    bindReplay($('#file-tree'))
  }

  function sampleNameFor(kind) {
    var rule = kind.rule || {}
    if (rule.name && rule.name.length) return rule.name[0]
    if (rule.prefix && rule.prefix.length) return rule.prefix[0] + (rule.prefix[0].indexOf('.') === 0 ? '' : '.example')
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
        '<h3>新方案：svg-spinners:blocks-wave</h3>' +
        '<p class="muted">四格方块错峰起跳，24 网格，用 currentColor 填充；SMIL 驱动，动画随图形一起内联，无额外依赖。</p>' +
        '<div class="sizes">' + sizes.map(function (s) {
          return '<figure><span class="stage">' + icon('svg-spinners', 'blocks-wave', s, 'wave') + '</span><figcaption>' + s + 'px</figcaption></figure>'
        }).join('') + '</div>' +
      '</div>'

    var family = state.workbench.family
    var processing =
      '<div class="compare-card"><h3>对话流状态行</h3>' +
      '<p class="muted">位于回合头部，与耗时并排。</p>' +
      '<div class="processing">' + icon('svg-spinners', 'blocks-wave', 13) + '<span>思考中...</span><span class="elapsed">7s</span></div>' +
      '<div class="processing">' + baselineSpinner(13) + '<span>思考中...</span><span class="elapsed">7s（现状）</span></div>' +
      '</div>' +
      '<div class="compare-card"><h3>工作台标签</h3>' +
      '<p class="muted">面板加载时替换标签左侧图形。</p>' +
      '<div class="tool-row">' + icon('svg-spinners', 'blocks-wave', 14) + '<span>文件</span><span class="tail">载入中</span></div>' +
      '<div class="tool-row">' + purposeIcon(byId.filesPanel, family, 14) + '<span>文件</span><span class="tail">已就绪</span></div>' +
      '</div>' +
      '<div class="compare-card"><h3>工具执行行</h3>' +
      '<p class="muted">工具运行中与完成后的图形对照。</p>' +
      '<div class="tool-row">' + icon('svg-spinners', 'blocks-wave', 14) + '<span>bun run verify</span><span class="tail">执行中</span></div>' +
      '<div class="tool-row">' + purposeIcon(byId.success, family, 14) + '<span>bun run verify</span><span class="tail">退出码 0</span></div>' +
      '</div>'
    $('#spinner-context').innerHTML = processing

    var cards = [
      { h: '图形来源', rows: [['图标名', SPINNER], ['图标集', 'svg-spinners（46 个加载动效）'], ['作者', 'Utkarsh Verma'], ['许可', 'MIT']] },
      { h: '实现机制', rows: [['动画方式', 'SMIL <animate>（x/y 位移 + begin 链式衔接）'], ['依赖', '无：SVG body 内联即可播放'], ['重复 ID', '同页多次使用需重命名 <animate> 的 id 与 begin 引用'], ['尺寸', '24 网格，10–24 px 均清晰']] },
      { h: '需要处理的点', rows: [['尺寸下限', '上方六个尺码里，10 / 12 / 14 px 的四格基本糊成一块，16 px 起才能看清错峰跳动。当前状态行是 text-[10px] 的 Spinner（1em = 10 px）装在 12×12 容器里，换用时必须同时放大容器，否则等于换了一个方块。'], ['减少动效', 'SMIL 不受 prefers-reduced-motion 影响，需在代码里调用 pauseAnimations() 或改渲染静态图形'], ['深色模式', 'currentColor 填充，自动跟随主题，深色下无需额外处理'], ['重复使用', '同一页多次出现时需重命名 <animate> 的 id 与 begin 引用，本页渲染时已做处理']] },
    ]
    $('#spinner-spec').innerHTML = cards.map(function (c) {
      return '<div class="spec-card"><h3>' + esc(c.h) + '</h3><dl>' + c.rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'
      }).join('') + '</dl></div>'
    }).join('')

    bindReplay($('#panel-thinking'))
  }

  // ------------------------------------------------------------------ plan
  function renderPlan() {
    var covA = familyCoverage('a'), covB = familyCoverage('b'), covC = familyCoverage('c')
    var pct = function (c) { return Math.round((c.native / c.total) * 100) + '%' }
    $('#recommend').innerHTML = '' +
      '<div class="pick">' +
        '<span class="label">界面图标建议</span>' +
        '<h3>B · Coolicons</h3>' +
        '<p class="muted">覆盖最完整、语义折中最少的一套：92 个用途里 ' + covB.native + ' 个原生对应（' + pct(covB) + '），终端、地球、拼图、键盘、打印机、二维码、圆柱数据源都是原生图形，正是 Line MD 与 Mono 缺的部分。</p>' +
        '<ul>' +
          '<li><b>文件图标</b>单独用 VSCode Icons 彩色主题，两件事互不牵制。</li>' +
          '<li><b>思考中</b>统一换成 <code>svg-spinners:blocks-wave</code>。</li>' +
          '<li>若更看重动效与轻盈感，选 A · Line MD，但要接受约 ' + covA.approx + ' 处近似（数据、图表、终端、看板）。</li>' +
          '<li>若更看重小尺寸下的扎实感，选 C · Mono Icons，但它只有 180 个图形，业务图形近似最多（' + covC.approx + ' 处）。</li>' +
        '</ul>' +
      '</div>' +
      '<div class="pick">' +
        '<span class="label">另一条路线</span>' +
        '<h3>分而治之</h3>' +
        '<p class="muted">界面图标与文件图标本来就是两层，可以分别选：</p>' +
        '<ul>' +
          '<li>界面：Coolicons（中性、齐全）或 Line MD（轻、有动效）</li>' +
          '<li>文件：VSCode Icons 彩色主题（1693 图形，类型识别最细）</li>' +
          '<li>加载：svg-spinners，除思考中外还有 46 个可选动效</li>' +
        '</ul>' +
        '<p class="muted">本页的“工作台实景”就是这条路线：界面用 Coolicons，文件面板已经换成彩色主题。</p>' +
      '</div>'

    var rows = [
      ['A · Line MD', STATS.a.total + ' 个（' + STATS.a.animated + ' 个带动画）', pct(covA), '描线动画、线条最轻、社交与文件类齐全', '无图表 / 数据库 / 终端 / 锁 / 时钟 / 代码符号；' + covA.approx + ' 处近似', 'MIT'],
      ['B · Coolicons', STATS.b.total + ' 个', pct(covB), '覆盖最全、24 网格 2 描边圆端点、工具类图形齐全', '无解锁 / 钥匙 / Wi-Fi / 机器人；' + covB.approx + ' 处近似', 'CC BY 4.0'],
      ['C · Mono Icons', STATS.c.total + ' 个', pct(covC), '填充轮廓、小尺寸最扎实、看板与数据库原生', '无终端 / 代码 / 拼图 / 地球 / 灯泡；' + covC.approx + ' 处近似', 'MIT'],
    ]
    $('#plan-table').innerHTML = '<tr><th>候选</th><th>规模</th><th>原生对应率</th><th>强项</th><th>弱项</th><th>许可</th></tr>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (cell, i) {
          return '<td' + (i === 1 || i === 2 ? ' class="num"' : '') + '>' + esc(cell) + '</td>'
        }).join('') + '</tr>'
      }).join('')

    $('#scope-grid').innerHTML = '' +
      '<div><h3>替换范围</h3>' +
        '<p>' + D.survey.filesWithLucideImport + ' 个生产文件、' + D.survey.totalNamedImports + ' 次命名导入，去重后 ' + D.survey.distinctComponents + ' 个 Lucide 组件，全部归入本页 ' + D.purposes.length + ' 个语义用途。</p>' +
        '<p>桌面 renderer、共享 UI 包、查看器与复用 renderer 的 WebUI 都在范围内。品牌标识与业务状态色不随图标体系改变。</p></div>' +
      '<div><h3>建议顺序</h3><ol>' +
        '<li>先定语义用途表（本页矩阵即初稿），再动代码。</li>' +
        '<li>建立统一的语义图标入口，解除对 <code>LucideIcon</code> 类型的依赖。</li>' +
        '<li>按区域迁移：导航 → 顶栏 → 工作台 → 设置 → 共享组件。</li>' +
        '<li>文件类型解析器独立接入，与界面图标解耦。</li>' +
        '<li>在 14 / 16 / 18 / 20 px 四种真实尺寸下逐屏核对。</li></ol></div>' +
      '<div><h3>风险</h3><ul>' +
        '<li><b>近似映射</b>：甘特图、差异对比、音视频、JSON 花括号三套都没有，需要业务上确认可接受的替代图形。</li>' +
        '<li><b>动画可访问性</b>：blocks-wave 用 SMIL，CSS 的减少动效开关管不到它，需要在代码里处理。</li>' +
        '<li><b>尺寸</b>：思考中当前是 10 px 图形，blocks-wave 要到 16 px 才看得清，换用时容器需要一起放大。</li>' +
        '<li><b>同形冲突</b>：Coolicons 的 <code>columns</code> 同时是看板与分栏，<code>table</code> 与看板邻近；靠位置与激活态区分。</li>' +
        '<li><b>目录着色</b>：彩色文件主题若给目录按名着色，长列表会显得花，建议只给 src / docs / test 一类关键目录上色。</li></ul></div>' +
      '<div><h3>本轮交付边界</h3>' +
        '<p>只新增本演示页与构建脚本，没有改动应用源码、依赖或图标入口。</p>' +
        '<p>所有图标数据在构建时抓取并内联，页面可离线双击打开；构建脚本会校验每个图标名与 Lucide 组件落位。</p></div>'

    var licenses = []
    FAMILIES.forEach(function (f) {
      var meta = D.setMeta[PREFIX[f]]
      licenses.push({ b: meta.title, t: meta.author + ' · ' + meta.license, u: meta.licenseUrl })
    })
    Object.keys(D.files.themes).forEach(function (key) {
      var meta = D.files.themes[key].meta || {}
      licenses.push({ b: meta.title || key, t: [meta.author, meta.license].filter(Boolean).join(' · '), u: meta.licenseUrl })
    })
    var spinnerMeta = D.setMeta['svg-spinners']
    licenses.push({ b: 'svg-spinners', t: (spinnerMeta.author || 'Utkarsh Verma') + ' · ' + spinnerMeta.license, u: spinnerMeta.licenseUrl })
    licenses.push({ b: 'Lucide', t: 'Lucide Contributors · ISC', u: D.setMeta.lucide.licenseUrl })

    $('#license-grid').innerHTML = licenses.map(function (l) {
      return '<div class="license-card"><b>' + esc(l.b) + '</b>' + esc(l.t) +
        (l.u ? '<div><a href="' + esc(l.u) + '" target="_blank" rel="noreferrer">许可原文</a></div>' : '') + '</div>'
    }).join('')
  }

  // ------------------------------------------------------------------ wiring
  function switchPanel(name) {
    $$('.tab').forEach(function (tab) { tab.setAttribute('aria-selected', String(tab.dataset.panel === name)) })
    $$('.panel').forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + name })
    if (name === 'gallery') renderGallery()
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

    $('#matrix-search').addEventListener('input', function () { state.matrix.q = this.value; renderMatrix() })
    $('#matrix-group').addEventListener('change', function () { state.matrix.group = this.value; renderMatrix() })
    $('#matrix-quality').addEventListener('change', function () { state.matrix.quality = this.value; renderMatrix() })
    $('#matrix-size').addEventListener('change', function () { state.matrix.size = Number(this.value); renderMatrix() })

    $('#gallery-search').addEventListener('input', function () { state.gallery.q = this.value; state.gallery.page = 1; renderGallery() })
    $('#gallery-category').addEventListener('change', function () { state.gallery.cat = this.value; state.gallery.page = 1; renderGallery() })
    $('#gallery-size').addEventListener('change', function () { state.gallery.size = Number(this.value); renderGallery() })
    $('#gallery-animate').addEventListener('change', function () { state.replay = this.checked })
    $('#gallery-family').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-family]')
      if (!button) return
      state.gallery.family = button.dataset.family
      state.gallery.cat = 'all'
      state.gallery.page = 1
      renderGallery()
    })
    $('#gallery-pager').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-page]')
      if (!button || button.disabled) return
      state.gallery.page = Number(button.dataset.page)
      renderGallery()
      $('#gallery-grid').scrollIntoView({ block: 'start', behavior: 'smooth' })
    })

    $('#workbench-family').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-family]')
      if (!button) return
      state.workbench.family = button.dataset.family
      renderWorkbench()
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
      var all = Object.keys(state.collapsed).length > 0
      state.collapsed = {}
      if (!all) {
        var walk = function (nodes, path) {
          nodes.forEach(function (node) {
            if (node.children === undefined) return
            var key = path + '/' + node.name
            if (!node.open) state.collapsed[key] = true
            walk(node.children, key)
          })
        }
        walk(D.files.tree, '')
      }
      renderFileTree()
      bindReplay($('#file-tree'))
    })
    $('#file-tree').addEventListener('click', function (event) {
      var row = event.target.closest('.tree-row[data-dir]')
      if (!row) return
      var key = row.dataset.path
      if (state.collapsed[key]) delete state.collapsed[key]
      else state.collapsed[key] = true
      renderFileTree()
      bindReplay($('#file-tree'))
    })
  }

  // ------------------------------------------------------------------ boot
  renderHero()
  renderFamilyCards()
  renderMatrix()
  renderVerify()
  renderGallery()
  renderWorkbench()
  renderFiles()
  renderThinking()
  renderPlan()
  wire()
  bindReplay(document)
})()
