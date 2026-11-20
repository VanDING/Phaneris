/**
 * 助手 Focus 面板优化 · 评审稿自检
 * ---------------------------------------------------------------------------
 * 先量数字，再对数字下判断。这次改版声称的每一点都有对应测量：
 *
 *   1. 档位条一根 = 一个任务：条的数目 = 任务数目（不再固定 18）
 *   2. 条即切换器：点第 N 根条，聚焦的就是第 N 个任务
 *   3. 条形状读得出状态：高度按 needs/active/idle/settled 分级
 *   4. 记录卡片最大 14px（现状 16px 标题 + 一片 10px）
 *   5. 两个承载面：peek 两栏 / dock 纵向单栏、紧贴右侧、占满高度
 *   6. 没有标题切换条（现状的 .focus-segments 已合并进档位条）
 *
 *   node docs/prototypes/resident-focus-panel-redesign-2026-11-20/verify.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const index = pathToFileURL(resolve(here, 'index.html')).href
const shots = resolve(here, 'verification')
mkdirSync(shots, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: process.env.PHANERIS_CHROMIUM || undefined })
const results = []
const measurements = []
const errors = []

function record(name, pass, detail) {
  results.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  → ${JSON.stringify(detail).slice(0, 250)}`}`)
}

async function open(params, viewport = { width: 1440, height: 980 }) {
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(5000)
  /* 面板宽度有过渡动画。评审要量的是静止状态，不能量到中间帧。 */
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push({ params, message: error.message }))
  page.on('console', message => { if (message.type() === 'error') errors.push({ params, message: message.text() }) })
  await page.goto(`${index}?${new URLSearchParams(params)}`, { waitUntil: 'load' })
  await page.waitForTimeout(80)
  return page
}

async function check(name, fn) {
  try {
    const value = await fn()
    const ok = value === true || (value && typeof value === 'object' && value.ok === true)
    record(name, ok, typeof value === 'boolean' ? undefined : value)
  } catch (error) {
    record(name, false, String(error).slice(0, 200))
  }
}

async function measure(page, surface, version) {
  return page.evaluate(({ surface, version }) => {
    const host = document.querySelector('#host')
    const panel = host.querySelector('.panel')
    if (!panel) return { error: 'no panel' }
    const round = value => Math.round(value)
    const box = node => (node ? node.getBoundingClientRect() : null)

    const hostBox = box(host)
    const panelBox = box(panel)
    const bars = [...panel.querySelectorAll('.bar')]
    const record = panel.querySelector('.record, .dock-scroll')
    const stageBox = box(document.querySelector('#stage'))

    /* 「变形」的判据是内层横向滚动：正文被裁是某个容器在偷偷横滚。 */
    const ALLOWED_X = new Set(['gauge-set', 'cur-segments'])
    const horizontalScrollers = [...panel.querySelectorAll('*')].filter(node => {
      if (!['auto', 'scroll'].includes(getComputedStyle(node).overflowX)) return false
      if (ALLOWED_X.has(node.className)) return false
      return node.scrollWidth > node.clientWidth + 1
    }).map(node => ({ cls: typeof node.className === 'string' ? node.className : node.tagName }))

    const insideScroller = node => {
      for (let parent = node.parentElement; parent && parent !== panel; parent = parent.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) return true
      }
      return false
    }
    const escaped = [...panel.querySelectorAll('*')].filter(node => {
      const rect = node.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return false
      if (insideScroller(node)) return false
      if (!stageBox) return false
      return rect.left < stageBox.left - 1 || rect.right > stageBox.right + 1
    }).map(node => ({
      cls: typeof node.className === 'string' ? node.className : node.tagName,
      overflowPx: round(Math.max(stageBox.left - node.getBoundingClientRect().left, node.getBoundingClientRect().right - stageBox.right)),
    })).slice(0, 6)

    /* 记录卡片里的字号：只量真正的阅读内容，不量徽标与计数。 */
    const bodySelector = version === 'current'
      ? '.cur-facts dd, .cur-version-text, .cur-title'
      : '.title, .req-text, .crit-text, .asked, .kv dd'
    const bodySizes = [...panel.querySelectorAll(bodySelector)].map(node => parseFloat(getComputedStyle(node).fontSize))
    const tiers = new Set([...panel.querySelectorAll('*')]
      .map(node => parseFloat(getComputedStyle(node).fontSize))
      .filter(size => Number.isFinite(size) && size > 0)
      .map(size => Math.round(size)))

    return {
      surface: host.dataset.surface,
      hostWidth: round(hostBox.width),
      hostHeight: round(hostBox.height),
      /* peek 是浮层、dock 贴右：两者都必须落在舞台内 */
      frameHeight: stageBox ? round(stageBox.height) : null,
      gapRightOfStage: stageBox ? round(stageBox.right - panelBox.right) : null,
      gapLeftOfStage: stageBox ? round(panelBox.left - stageBox.left) : null,
      bars: bars.length,
      barHeights: bars.map(bar => round(bar.getBoundingClientRect().height)),
      barTones: bars.map(bar => bar.dataset.tone),
      gaugeWidth: round(box(panel.querySelector('.gauge-set'))?.width ?? 0),
      gaugeHeight: round(box(panel.querySelector('.gauge'))?.height ?? 0),
      recordHeight: round(record?.getBoundingClientRect().height ?? 0),
      titleSwitchRows: panel.querySelectorAll('.seg, .cur-segment').length,
      bodyMaxSize: bodySizes.length ? Math.max(...bodySizes) : null,
      bodyMinSize: bodySizes.length ? Math.min(...bodySizes) : null,
      tiers: [...tiers].sort((a, b) => a - b),
      horizontalScrollers,
      escaped,
    }
  }, { surface, version })
}

const SURFACES = ['peek', 'dock']
const SCENARIOS = ['ready', 'one', 'long', 'overflow', 'many']

/* ═══ 1 · 测量矩阵 ════════════════════════════════════════════════ */
for (const surface of SURFACES) {
  for (const scenario of SCENARIOS) {
    for (const version of ['current', 'optimized']) {
      const page = await open({ surface, version, state: scenario, lang: 'zh' })
      const facts = await measure(page, surface, version)
      measurements.push({ surface, scenario, version, ...facts })
      await page.screenshot({ path: resolve(shots, `${version}-${surface}-${scenario}.png`) })
      await page.close()
    }
  }
}

const fact = (surface, scenario, version) =>
  measurements.find(item => item.surface === surface && item.scenario === scenario && item.version === version)

/* ═══ 2 · 条数 = 任务数（不再固定 18）═════════════════════════════ */
for (const surface of SURFACES) {
  await check(`${surface} · 5 个任务 → 5 根条`, () => ({
    ok: fact(surface, 'ready', 'optimized').bars === 5,
    bars: fact(surface, 'ready', 'optimized').bars,
  }))
  await check(`${surface} · 1 个任务 → 1 根条（不再画 18 个空槽）`, () => ({
    ok: fact(surface, 'one', 'optimized').bars === 1,
    bars: fact(surface, 'one', 'optimized').bars,
  }))
  await check(`${surface} · 19 个任务 → 19 根条`, () => ({
    ok: fact(surface, 'many', 'optimized').bars === 19,
    bars: fact(surface, 'many', 'optimized').bars,
  }))
  await check(`${surface} · 现状仍是固定 18 个方块`, () => ({
    ok: fact(surface, 'one', 'current').gaugeWidth === fact(surface, 'ready', 'current').gaugeWidth,
    one: fact(surface, 'one', 'current').gaugeWidth,
    ready: fact(surface, 'ready', 'current').gaugeWidth,
  }))
}

/* ═══ 3 · 没有标题切换条，档位条就是切换器 ═══════════════════════ */
for (const surface of SURFACES) {
  await check(`${surface} · 优化后没有第二套标题切换条`, () => {
    const geo = fact(surface, 'ready', 'optimized')
    return { ok: geo.titleSwitchRows === 0, rows: geo.titleSwitchRows }
  })
  await check(`${surface} · 现状有第二套标题切换条`, () => ({
    ok: fact(surface, 'ready', 'current').titleSwitchRows > 0,
    rows: fact(surface, 'ready', 'current').titleSwitchRows,
  }))
  await check(`${surface} · 点第 N 根条就聚焦第 N 个任务`, async () => {
    const page = await open({ surface, version: 'optimized', state: 'ready', lang: 'zh' })
    const before = await page.locator('#host .gauge-name').innerText()
    const bars = page.locator('#host .bar')
    const target = (await bars.count()) - 1
    await bars.nth(target).click()
    await page.waitForTimeout(90)
    const after = await page.locator('#host .gauge-name').innerText()
    const current = await page.locator('#host .bar[aria-current="true"]').getAttribute('data-task')
    const expected = await bars.nth(target).getAttribute('data-task')
    await page.close()
    return { ok: before !== after && current === expected, before, after, current, expected }
  })
}

/* ═══ 4 · 条的形状读得出状态 ══════════════════════════════════════ */
for (const surface of SURFACES) {
  await check(`${surface} · 档位条等高（不用高度差表达状态，只占一行）`, () => {
    const geo = fact(surface, 'ready', 'optimized')
    const heights = [...new Set(geo.barHeights)]
    return { ok: heights.length === 1, heights, gaugeHeight: geo.gaugeHeight }
  })
  await check(`${surface} · 档位区不超过 24px 纵向空间`, () => {
    const geo = fact(surface, 'ready', 'optimized')
    return { ok: geo.gaugeHeight <= 24, gaugeHeight: geo.gaugeHeight }
  })
  await check(`${surface} · 状态由填充/纹理区分，条数不变但底色不同`, async () => {
    const page = await open({ surface, version: 'optimized', state: 'ready', lang: 'zh' })
    const paints = await page.locator('#host .bar').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node)
      return `${style.backgroundColor}|${style.backgroundImage}`
    }))
    await page.close()
    return { ok: new Set(paints).size > 1, distinct: new Set(paints).size, paints }
  })
  await check(`${surface} · 每根条都有 任务名 · 状态 的可读标签`, async () => {
    const page = await open({ surface, version: 'optimized', state: 'ready', lang: 'zh' })
    const labels = await page.locator('#host .bar').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
    await page.close()
    return { ok: labels.length > 0 && labels.every(label => typeof label === 'string' && label.includes(' · ')), labels }
  })
}

/* ═══ 5 · 卡片字号：最大 14px，不再是 16px 标题 + 一片 10px ══════ */
{
  for (const surface of SURFACES) {
    await check(`${surface} · 记录卡片最大 14px、最小 ≥ 12px`, () => {
      const geo = fact(surface, 'long', 'optimized')
      return { ok: geo.bodyMaxSize <= 14 && geo.bodyMinSize >= 12, max: geo.bodyMaxSize, min: geo.bodyMinSize }
    })
  }
  await check('现状 · 记录正文停在 10px', () => {
    const geo = fact('peek', 'long', 'current')
    return { ok: geo.bodyMinSize === 10, min: geo.bodyMinSize }
  })
}

/* ═══ 6 · 两个承载面：同一个组件，两种排布 ═══════════════════════ */
await check('peek · 是浮层（左右都留出舞台边距）', () => {
  const geo = fact('peek', 'ready', 'optimized')
  return { ok: geo.gapLeftOfStage > 0 && geo.gapRightOfStage > 0, left: geo.gapLeftOfStage, right: geo.gapRightOfStage }
})
await check('dock · 是悬浮面板：靠右且四周留边（不是铺满）', () => {
  const geo = fact('dock', 'ready', 'optimized')
  return {
    ok: geo.gapRightOfStage > 0 && geo.gapLeftOfStage > 0
      && geo.hostHeight < geo.frameHeight && geo.hostHeight > geo.frameHeight * 0.85,
    right: geo.gapRightOfStage,
    left: geo.gapLeftOfStage,
    height: geo.hostHeight,
    frame: geo.frameHeight,
  }
})
await check('dock · 靠右：左侧空出的边距远大于右侧', () => {
  const geo = fact('dock', 'ready', 'optimized')
  return { ok: geo.gapLeftOfStage > geo.gapRightOfStage * 4, left: geo.gapLeftOfStage, right: geo.gapRightOfStage }
})
await check('dock · 纵向单栏：记录占满剩余高度且自己滚动', () => {
  const geo = fact('dock', 'ready', 'optimized')
  return { ok: geo.recordHeight > 200, recordHeight: geo.recordHeight }
})
await check('两个承载面用的是同一份记录内容', async () => {
  const read = async surface => {
    const page = await open({ surface, version: 'optimized', state: 'ready', lang: 'zh' })
    const text = await page.locator('#host .title').innerText()
    const requirements = await page.locator('#host .req').count()
    await page.close()
    return { text, requirements }
  }
  const peek = await read('peek')
  const dock = await read('dock')
  return { ok: peek.text === dock.text && peek.requirements === dock.requirements, peek, dock }
})

/* ═══ 7 · 不溢出 / 不越界 ════════════════════════════════════════ */
await check('优化后 · 所有档位下没有横向滚动或越界', () => {
  const bad = measurements.filter(item => item.version === 'optimized'
    && (item.horizontalScrollers.length > 0 || item.escaped.length > 0))
  return { ok: bad.length === 0, cases: bad.map(item => `${item.surface}/${item.scenario}`), sample: bad[0]?.horizontalScrollers }
})

/* ═══ 8 · 键盘与焦点 ═════════════════════════════════════════════ */
for (const surface of SURFACES) {
  const page = await open({ surface, version: 'optimized', state: 'ready', lang: 'zh' })
  await page.locator('#host .bar').first().focus()
  const before = await page.evaluate(() => document.activeElement?.dataset?.task ?? null)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(60)
  const after = await page.evaluate(() => document.activeElement?.dataset?.task ?? null)
  await check(`${surface} · → 键在档位条之间移动焦点`, () => ({ ok: before && after && before !== after, before, after }))
  await check(`${surface} · 选中后焦点没掉回 body`, async () => {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(70)
    return page.evaluate(() => {
      const active = document.activeElement
      if (!active || active === document.body) return { ok: false, reason: 'focus on body' }
      return { ok: true, tag: active.tagName, act: active.dataset?.act ?? null }
    })
  })
  await page.close()
}

/* ═══ 9 · 动作跟随状态 ═══════════════════════════════════════════ */
for (const surface of SURFACES) {
  const accept = await open({ surface, version: 'optimized', state: 'ready', lang: 'zh', select: 'tsk_3b90' })
  await check(`${surface} · 待验收任务给出验收与返工`, async () => ({
    ok: (await accept.locator('#host [data-testid="focus-accept"]:visible').count()) > 0
      && (await accept.locator('#host [data-testid="focus-rework"]:visible').count()) > 0,
  }))
  await accept.close()

  const needs = await open({ surface, version: 'optimized', state: 'ready', lang: 'zh', select: 'tsk_7f21' })
  await check(`${surface} · 需要你决定的任务只给执行控制`, async () => ({
    ok: (await needs.locator('#host [data-testid="focus-accept"]:visible').count()) === 0
      && (await needs.locator('#host [data-testid="focus-terminate"]:visible').count()) > 0,
  }))
  await needs.close()
}

/* ═══ 10 · 状态面与主题 ══════════════════════════════════════════ */
for (const surface of SURFACES) {
  for (const status of ['empty', 'loading', 'error', 'offline']) {
    const page = await open({ surface, version: 'optimized', state: status, lang: 'zh' })
    const facts = await measure(page, surface, 'optimized')
    await check(`${surface}/${status} · 状态面完整且不溢出`, () => ({
      ok: facts.escaped.length === 0 && facts.horizontalScrollers.length === 0,
      escaped: facts.escaped,
    }))
    await page.screenshot({ path: resolve(shots, `state-${surface}-${status}.png`) })
    await page.close()
  }
  for (const [theme, lang] of [['dark', 'zh'], ['light', 'en'], ['dark', 'en']]) {
    const page = await open({ surface, version: 'optimized', theme, lang, state: 'long' })
    const facts = await measure(page, surface, 'optimized')
    await check(`${surface}/${theme}/${lang} · 不溢出`, () => ({
      ok: facts.escaped.length === 0 && facts.horizontalScrollers.length === 0,
      escaped: facts.escaped,
      horizontalScrollers: facts.horizontalScrollers,
    }))
    await page.screenshot({ path: resolve(shots, `theme-${surface}-${theme}-${lang}.png`) })
    await page.close()
  }
}

/* ═══ 汇总 ═══════════════════════════════════════════════════════ */
const failed = results.filter(item => !item.pass)
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  pageErrors: errors,
  measurements,
  checks: results,
}
writeFileSync(resolve(shots, 'report.json'), JSON.stringify(report, null, 2))
await browser.close()

console.log('\n测量矩阵（档位条 vs 任务数）:')
for (const surface of SURFACES) {
  for (const scenario of SCENARIOS) {
    const before = fact(surface, scenario, 'current')
    const after = fact(surface, scenario, 'optimized')
    console.log(`  ${surface.padEnd(5)} ${scenario.padEnd(9)}`
      + ` 条数 ${String(before.bars).padStart(2)}→${String(after.bars).padEnd(2)}`
      + ` 档位区 ${String(after.gaugeHeight).padStart(2)}px`
      + ` 记录 ${String(before.recordHeight).padStart(3)}→${String(after.recordHeight).padEnd(3)}`
      + ` 字号 ${String(before.bodyMinSize).padStart(3)}–${String(before.bodyMaxSize).padEnd(3)}→${String(after.bodyMinSize).padStart(2)}–${after.bodyMaxSize}`)
  }
}

console.log(`\n${report.passed}/${report.total} checks passed · ${errors.length} page errors`)
if (errors.length) for (const error of errors.slice(0, 10)) console.log(`  page error: ${error.message}`)
if (failed.length) {
  console.log('\nFAILED:')
  for (const item of failed) console.log(`  - ${item.name}  ${JSON.stringify(item.detail ?? '').slice(0, 220)}`)
}
process.exit(failed.length || errors.length ? 1 : 0)
