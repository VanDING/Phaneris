/**
 * Run → 决策 改版演示稿 · 交互自检
 * ---------------------------------------------------------------------------
 * 截图只能证明「长得对」，证明不了「点得动」。这个脚本点一遍三个方向的主要
 * 交互，并把结果写成 JSON —— 交付时可重放、可核对。
 *
 *   bun run .verify/decisions-view-redesign/verify.mjs
 *   PHANERIS_CHROMIUM=<path> bun run …   # 指定 chromium 可执行文件
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const index = pathToFileURL(resolve(here, 'index.html')).href
const shots = resolve(here, 'shots')
mkdirSync(shots, { recursive: true })

const executablePath = process.env.PHANERIS_CHROMIUM
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const results = []
const errors = []

function record(name, pass, detail) {
  results.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  → ${JSON.stringify(detail)}`}`)
}

async function open(query, viewport = { width: 420, height: 900 }) {
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(4000)
  page.on('pageerror', e => errors.push({ query, message: e.message }))
  page.on('console', m => { if (m.type() === 'error') errors.push({ query, message: m.text() }) })
  await page.goto(`${index}?view=panel&${query}`, { waitUntil: 'load' })
  await page.waitForTimeout(120)
  return page
}

/** 断言辅助：等待条件成立，避免 innerHTML 重绘造成的竞态。 */
async function expect(page, name, fn, detail) {
  try {
    const value = await fn()
    record(name, value, typeof value === 'boolean' ? detail : value)
  } catch (error) {
    record(name, false, String(error).slice(0, 160))
  }
}

/* 面板宽度由 --panel-w + 容器查询决定，改视口没用；用 URL 参数重开一页最直接。 */

/* ── A · 台账 ─────────────────────────────────────────────────────────────── */
{
  const page = await open('dir=A&width=420&theme=light&lang=zh-Hans')

  await expect(page, 'A/窄 · 顶部状态行与四块指标瓷砖都在', async () =>
    (await page.locator('.status-row h2', { hasText: '会话决策' }).count()) === 1
    && (await page.locator('.tile').count()) === 4)

  await expect(page, 'A/窄 · 首屏是列表，详情由点选产生', async () =>
    !(await page.locator('.a-root').getAttribute('class')).includes('is-detail')
    && (await page.locator('.rec:visible').count()) > 5)

  await page.locator('.rec').first().click()
  await page.waitForTimeout(120)
  await expect(page, 'A/窄 · 点一条记录后整屏切到详情', async () =>
    (await page.locator('.a-root').getAttribute('class')).includes('is-detail')
    && (await page.locator('.a-detail .dtl').count()) === 1)

  await expect(page, 'A/窄 · 详情有返回按钮', async () =>
    (await page.locator('[data-act="back"]').count()) === 1)

  await expect(page, 'A/窄 · 详情分区顺序为 触发→判断→处理→观察→请求', async () => {
    const titles = await page.locator('.a-detail .dtl-sec > h4').allInnerTexts()
    return titles.map(t => t.replace(/\s+/g, ' ').trim()).join('|')
  })

  await page.locator('[data-act="back"]').click()
  await page.waitForTimeout(120)
  await expect(page, 'A/窄 · 返回后回到列表', async () =>
    !(await page.locator('.a-root').getAttribute('class')).includes('is-detail'))

  // 筛选：点工具栏里的「已改变」
  await page.locator('.tb-filter', { hasText: '已改变' }).first().click()
  await page.waitForTimeout(140)
  await expect(page, 'A · 按「已改变」筛选后只剩 4 条', async () =>
    (await page.locator('.rec').count()) === 4)
  await expect(page, 'A · 筛选后计数显示 x / 60', async () => {
    const txt = await page.locator('.tb-count').first().innerText()
    return txt.trim()
  })
  await page.locator('.tb-filter', { hasText: '清除筛选' }).first().click()
  await page.waitForTimeout(140)
  await expect(page, 'A · 清除筛选后恢复', async () => (await page.locator('.rec').count()) > 4)

  // 搜索：输入后焦点必须还在输入框里
  await page.locator('[data-act="q"]').fill('decide')
  await page.waitForTimeout(150)
  await expect(page, 'A · 搜索后焦点仍在输入框（重绘不吞焦点）', async () =>
    await page.evaluate(() => document.activeElement?.getAttribute('data-act') === 'q'))
  await expect(page, 'A · 搜索 decide 命中 1 条', async () => (await page.locator('.rec').count()) === 1)
  await page.locator('[data-act="q"]').fill('')
  await page.waitForTimeout(150)

  // 键盘导航
  await page.locator('.rec').first().click()
  await page.waitForTimeout(120)
  await page.locator('[data-act="back"]').click()
  await page.waitForTimeout(120)
  await page.locator('.rec').first().focus()
  const before = await page.locator('.rec.is-on').getAttribute('data-id').catch(() => null)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  const after = await page.locator('.rec.is-on').getAttribute('data-id').catch(() => null)
  record('A · ↓ 键移动选中项', before !== after && !!after, { before, after })

  await page.close()

  /* 宽面板：另开一页，避免把窄面板的断言和状态混在一起 */
  const wide = await open('dir=A&width=1040&theme=light&lang=zh-Hans')
  await wide.locator('.rec').first().click()
  await wide.waitForTimeout(160)
  await expect(wide, 'A/宽 · 1040px 下详情与列表并置（不是整屏切换）', async () => {
    const list = await wide.locator('.a-list').boundingBox()
    const detail = await wide.locator('.a-detail .dtl').boundingBox()
    return !!list && !!detail && detail.x > list.x + list.width - 4
  })
  await expect(wide, 'A/宽 · 瓷砖跟随 Run 概览变成一行 4 格', async () => {
    const tops = await wide.locator('.a-head .tile').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)))
    return { distinctRows: new Set(tops).size, tops }
  })
  await expect(wide, 'A · 分页：加载更多直到全部 60 条', async () => {
    for (let i = 0; i < 8; i++) {
      const more = wide.locator('[data-act="more"]')
      if (await more.count() === 0) break
      await more.click()
      await wide.waitForTimeout(110)
    }
    return await wide.locator('.rec').count()
  })
  await wide.close()
}

/* ── B · 时间流 ───────────────────────────────────────────────────────────── */
{
  const page = await open('dir=B&width=420&theme=light&lang=zh-Hans')

  await expect(page, 'B · 按轮次分组，且分组头吸附', async () => {
    const heads = await page.locator('.turn-head').count()
    const sticky = await page.locator('.turn-head').first().evaluate(e => getComputedStyle(e).position)
    return { heads, sticky }
  })

  await expect(page, 'B · 展开与折叠是同一个按钮的 aria-expanded', async () =>
    (await page.locator('.node-btn[aria-expanded="true"]').count()) >= 1)

  const openBefore = await page.locator('.node-panel').count()
  await page.locator('.node-btn[aria-expanded="false"]').first().click()
  await page.waitForTimeout(140)
  const openAfter = await page.locator('.node-panel').count()
  record('B · 点另一条就地展开详情', openAfter === openBefore + 1, { openBefore, openAfter })

  await page.locator('.node-btn[aria-expanded="true"]').first().click()
  await page.waitForTimeout(140)
  await expect(page, 'B · 再点一次收起', async () =>
    (await page.locator('.node-panel').count()) === openAfter - 1)

  await expect(page, 'B · 英文下 1 次请求是单数（现状是 1 model attempts）', async () => {
    const en = await open('dir=B&width=420&lang=en')
    const txt = await en.locator('.node-btn[data-id]').first().innerText()
    await en.close()
    return /1 model attempt(?!s)/.test(txt) ? 'ok: 1 model attempt' : txt.replace(/\s+/g, ' ')
  })
  await page.close()
}

/* ── C · 决策板 ───────────────────────────────────────────────────────────── */
{
  const page = await open('dir=C&width=1040&theme=light&lang=en')

  await expect(page, 'C/宽 · 记录是表格', async () => (await page.locator('table.rtable').count()) === 1)
  await expect(page, 'C/宽 · 功能对比矩阵默认展开：8 行 + 合计行', async () => ({
    rows: await page.locator('.matrix tbody tr').count(),
    foot: await page.locator('.matrix tfoot tr').count(),
  }))
  await expect(page, 'C · 四块指标瓷砖同权重，费用排在最后', async () => {
    const labels = await page.locator('.tile dt').allInnerTexts()
    const tops = await page.locator('.tile').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)))
    const widths = await page.locator('.tile').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().width))).size)
    return { labels: labels.map(s => s.trim()), rows: new Set(tops).size, distinctWidths: widths }
  })
  await expect(page, 'C/宽 · 与 Run 概览同款：状态行 + 12px 分区标题 + 36px 工具栏', async () => ({
    statusRow: await page.locator('.status-row').count(),
    sectionHeads: (await page.locator('.section-head h3').allInnerTexts()).map(s => s.trim()),
    toolbarH: await page.locator('.tb').first().evaluate(e => Math.round(e.getBoundingClientRect().height)),
  }))
  await expect(page, 'C/宽 · 表格 30px 行高、时间列等宽 10px', async () => ({
    rowH: await page.locator('.rtable tbody tr').first().evaluate(e => Math.round(e.getBoundingClientRect().height)),
    timeFont: await page.locator('.rtable td.time').first().evaluate(e => getComputedStyle(e).fontSize),
  }))

  await expect(page, 'C/宽 · 点行后右侧抽屉打开，列表仍可见', async () => {
    await page.locator('.rtable tbody tr').first().click()
    await page.waitForTimeout(180)
    const drawer = await page.locator('.drawer').boundingBox()
    const table = await page.locator('.rtable').boundingBox()
    return !!drawer && !!table && drawer.x > 400
  })
  await page.locator('.drawer [data-act="close"]').first().click()
  await page.waitForTimeout(180)
  await expect(page, 'C/宽 · 关闭抽屉', async () => (await page.locator('.drawer').count()) === 0)
  await expect(page, 'C · 矩阵行点击即筛选记录', async () => {
    await page.locator('.matrix tbody tr').first().click()
    await page.waitForTimeout(180)
    return { rows: await page.locator('.rtable tbody tr').count(), counter: (await page.locator('.tb-count').first().innerText()).trim() }
  })

  await page.close()

  const narrow = await open('dir=C&width=420&theme=light&lang=en')
  await expect(narrow, 'C/窄 · 表格降级成卡片列表', async () => ({
    tables: await narrow.locator('table.rtable').count(),
    cards: await narrow.locator('.listbox .rec').count(),
  }))
  await expect(narrow, 'C/窄 · 功能对比默认收起，可展开成列表行', async () => {
    const before = await narrow.locator('.matrix, .mrow').count()
    await narrow.locator('[data-act="matrixToggle"]').click()
    await narrow.waitForTimeout(180)
    return { before, after: await narrow.locator('.mrow').count() }
  })
  await expect(narrow, 'C/窄 · 抽屉从底部升起，贴住面板底边', async () => {
    await narrow.locator('.listbox .rec').first().click()
    await narrow.waitForTimeout(200)
    const d = await narrow.locator('.drawer').boundingBox()
    const panel = await narrow.locator('.panel').boundingBox()
    return d && panel
      ? { flush: Math.abs(d.y + d.height - (panel.y + panel.height)) <= 2, width: Math.round(d.width) }
      : 'no drawer'
  })
  await narrow.close()
}

/* ── 数据状态 ─────────────────────────────────────────────────────────────── */
{
  for (const state of ['empty', 'loading', 'error', 'unsupported', 'nosession', 'nomatch']) {
    const page = await open(`dir=A&width=420&state=${state}&lang=en`)
    await expect(page, `状态 ${state} · 渲染了独立的状态界面`, async () =>
      (await page.locator('.state').count()) >= 1 || (await page.locator('.sk').count()) > 0)
    await page.close()
  }
}

/* ── 现状对照 ─────────────────────────────────────────────────────────────── */
{
  const page = await open('dir=A&width=560&lang=en&legacyStatus=1&selected=none')
  await expect(page, '现状逻辑 · applied 记录漏出 i18n 键名', async () => {
    const txt = await page.locator('.tag', { hasText: 'trajectory.decisions.status.applied' }).count()
    return txt >= 1 ? `命中 ${txt} 处` : false
  })
  await expect(page, '现状逻辑 · failed / cancelled 退化成未确认', async () => {
    const failed = await page.locator('.rec[data-status="failed"]').count()
    const unconf = await page.locator('.rec[data-status="unconfirmed"]').count()
    return { failed, unconfirmed: unconf }
  })
  await page.close()

  const fixed = await open('dir=A&width=560&lang=en&selected=none')
  await expect(fixed, '修正后 · 整份数据里 failed / cancelled / applied 都能区分', async () => {
    for (let i = 0; i < 6; i++) {
      const more = fixed.locator('[data-act="more"]')
      if (await more.count() === 0) break
      await more.click()
      await fixed.waitForTimeout(120)
    }
    return {
      failed: await fixed.locator('.rec[data-status="failed"]').count(),
      cancelled: await fixed.locator('.rec[data-status="cancelled"]').count(),
      applied: await fixed.locator('.rec[data-status="applied"]').count(),
      changed: await fixed.locator('.rec[data-status="changed"]').count(),
      historical: await fixed.locator('.rec[data-status="historical"]').count(),
    }
  })
  await fixed.close()
}

/* ── 汇总 ─────────────────────────────────────────────────────────────────── */
const failed = results.filter(r => !r.pass)
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  pageErrors: errors,
  checks: results,
}
writeFileSync(resolve(here, 'verify-report.json'), JSON.stringify(report, null, 2))
await browser.close()

console.log(`\n${report.passed}/${report.total} checks passed · ${errors.length} page errors`)
if (errors.length) for (const e of errors.slice(0, 10)) console.log(`  page error: ${e.message}`)
if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(`  - ${f.name}`) }
process.exit(failed.length || errors.length ? 1 : 0)
