import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

// Isolated browser probes, not a claim that the running product was tested.
const browser = await chromium.launch({ headless: true, ...(process.env.MOTION_AUDIT_BROWSER ? { executablePath: process.env.MOTION_AUDIT_BROWSER } : {}) })
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  const results = []
  for (const path of ['apps/electron/src/renderer/index.html', 'apps/webui/src/index.html']) {
    const html = readFileSync(path, 'utf8')
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1]
    await page.setContent(`<style>${style}</style><div id="_loader"><svg viewBox="0 0 24 24"><path d="M0 0L24 24"/></svg></div>`)
    results.push({ probe: 'pre-react-loader-reduced-motion', path, observed: await page.locator('svg').evaluate(el => ({ matchesReduce: matchMedia('(prefers-reduced-motion: reduce)').matches, animationName: getComputedStyle(el).animationName, animationDuration: getComputedStyle(el).animationDuration, iterationCount: getComputedStyle(el).animationIterationCount })) })
  }
  const css = readFileSync('packages/ui/src/styles/motion.css', 'utf8')
  await page.setContent(`<style>${css}#pane {height:100px;overflow:auto}#content {height:2000px}</style><div id="pane"><div id="content"></div></div>`)
  const observed = await page.locator('#pane').evaluate(async el => {
    const before = { matchesReduce: matchMedia('(prefers-reduced-motion: reduce)').matches, scrollBehavior: getComputedStyle(el).scrollBehavior }
    el.scrollTo({ top: 1500, behavior: 'smooth' })
    const immediate = el.scrollTop
    const samples = []
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      samples.push(el.scrollTop)
    }
    return { ...before, immediate, intermediate: [...new Set(samples)].filter(y => y > 0 && y < 1500), final: el.scrollTop }
  })
  results.push({ probe: 'explicit-smooth-scroll-under-global-reduced-css', observed })
  writeFileSync('plans/motion-audit-probes.json', JSON.stringify({ date: '2026-09-21', browser: await browser.version(), scope: 'Isolated Chromium fixtures using current repository HTML/CSS; not full application E2E.', results }, null, 2) + '\n')
  console.log(JSON.stringify(results))
} finally {
  await browser.close()
}
