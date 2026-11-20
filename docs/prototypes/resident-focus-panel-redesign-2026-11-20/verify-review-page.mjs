/**
 * 评审页本身的可用性检查：这一份稿子交付给人看，所以「能不能点」也要验证。
 * 与 verify.mjs 分开：那里验证两个面板版本与两个承载面，这里验证评审外壳。
 */
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const index = pathToFileURL(resolve(here, 'index.html')).href
const browser = await chromium.launch({ headless: true, executablePath: process.env.PHANERIS_CHROMIUM || undefined })
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
const failures = []
page.on('pageerror', error => failures.push(`page error: ${error.message}`))

const expect = async (name, check) => {
  const value = await check()
  console.log(`${value ? 'PASS' : 'FAIL'}  ${name}`)
  if (!value) failures.push(name)
}

await page.goto(index, { waitUntil: 'load' })
await page.waitForTimeout(120)

await expect('默认落在「优化后 · 标题栏 peek」', async () => (await page.locator('#host .panel').getAttribute('data-version')) === 'optimized'
  && (await page.locator('#host .panel').getAttribute('data-surface')) === 'peek')

/* 控制栏平铺在左上角：全部可见，且都在面板之上 */
await expect('控制栏与面板同一左边界、全在左上角', async () => {
  const bar = await page.locator('.proto-bar').boundingBox()
  const panel = await page.locator('#host .panel').boundingBox()
  return !!bar && !!panel && bar.x === 0 && panel.y > bar.y + bar.height
})
await expect('右侧没有浮层入口', async () =>
  (await page.locator('.proto-bar > :not(.proto-identity):not(.proto-rows)').count()) === 0)

/* 两个承载面：结构不同，不只是尺寸不同 */
await page.locator('.proto-pill[data-surface="dock"]').click()
await page.waitForTimeout(220)
await expect('切到助手侧边栏：靠右悬浮，四周留边（不是铺满）', async () => {
  const frame = await page.locator('#stage').boundingBox()
  const panel = await page.locator('#host .panel').boundingBox()
  if (!frame || !panel) return false
  const right = frame.x + frame.width - (panel.x + panel.width)
  const left = panel.x - frame.x
  const bottom = frame.y + frame.height - (panel.y + panel.height)
  return right > 0 && left > right * 4 && bottom > 0 && panel.height < frame.height
})
await expect('侧边栏是纵向单栏（无第二栏）', async () => (await page.locator('#host .rail').count()) === 0
  && (await page.locator('#host .dock-scroll').count()) === 1)
await page.locator('.proto-pill[data-surface="peek"]').click()
await page.waitForTimeout(220)
await expect('切回标题栏 peek：浮层且有右栏产物', async () => (await page.locator('#host .rail').count()) === 1)

/* 档位条：条数随数据变化，点条即切换 */
await expect('5 个任务 → 5 根条', async () => (await page.locator('#host .bar').count()) === 5)
await page.locator('.proto-pill[data-scenario="one"]').click()
await page.waitForTimeout(120)
await expect('1 个任务 → 1 根条', async () => (await page.locator('#host .bar').count()) === 1)
await page.locator('.proto-pill[data-scenario="many"]').click()
await page.waitForTimeout(120)
await expect('18 个任务 → 18+ 根条', async () => (await page.locator('#host .bar').count()) > 18)
await expect('点最后一根条，聚焦的就是那个任务', async () => {
  const bars = page.locator('#host .bar')
  const target = (await bars.count()) - 1
  const expected = await bars.nth(target).getAttribute('data-task')
  await bars.nth(target).click()
  await page.waitForTimeout(120)
  return (await page.locator('#host .bar[aria-current="true"]').getAttribute('data-task')) === expected
})

await page.locator('.proto-pill[data-scenario="ready"]').click()
await page.waitForTimeout(120)
await page.locator('.proto-pill[data-version="current"]').click()
await page.waitForTimeout(140)
await expect('切到现状后复刻出固定 18 个方块', async () =>
  (await page.locator('#host .cur-seat').count()) === 18)
await page.locator('.proto-pill[data-version="optimized"]').click()
await page.waitForTimeout(140)
await expect('切回优化后是 5 根条', async () => (await page.locator('#host .bar').count()) === 5)

for (const state of ['long', 'overflow', 'empty', 'loading', 'error', 'offline', 'one', 'ready']) {
  await page.locator(`.proto-pill[data-scenario="${state}"]`).click()
  await page.waitForTimeout(90)
  await expect(`档位「${state}」渲染成功`, async () => (await page.locator('#host .panel').count()) === 1)
}

await page.locator('#theme-toggle').click()
await expect('切换深色', async () => (await page.locator('html').getAttribute('data-theme')) === 'dark')
await page.locator('#theme-toggle').click()

await page.locator('#lang-toggle').click()
await page.waitForTimeout(120)
await expect('切换英文', async () => (await page.locator('#host .ptitle').innerText()) === 'This task')
await page.locator('#lang-toggle').click()

await page.locator('#notes-open').click()
await page.waitForTimeout(160)
await expect('设计说明能打开', async () => page.locator('#notes').evaluate(node => node.open === true))
await page.locator('#notes-close').click()
await page.waitForTimeout(160)
await expect('设计说明能关闭', async () => page.locator('#notes').evaluate(node => node.open === false))

await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : '\n评审外壳全部通过')
process.exit(failures.length ? 1 : 0)
