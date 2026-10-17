/**
 * Browser verification of the standalone demo, not application tests.
 * Failure cases: script errors; missing/empty SVGs; external dependencies;
 * broken candidate/theme/scene/size switches; incorrect selected-state shapes;
 * broken filtering/empty results; keyboard tab navigation; page overflow.
 * Artifacts: verification.json plus desktop/dark/mobile screenshots.
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const directory = path.dirname(fileURLToPath(import.meta.url))
const artifacts = path.join(directory, 'verification')
fs.mkdirSync(artifacts, { recursive: true })
const errors = []
const externalRequests = []
const checks = []
const channel = process.env.PHANERIS_TEST_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined)
const browser = await chromium.launch({ headless:true, channel })
try {
  const page = await browser.newPage({ viewport:{width:1536,height:1080}, deviceScaleFactor:1, reducedMotion:'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()) })
  const loaded = await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  assert(loaded?.ok(), 'HTML file loads')
  await page.locator('#mock-app svg use').first().waitFor()
  async function check(name, callback) { await callback(); checks.push(name) }
  await check('SVG references resolve and all symbols have painted geometry',async()=>{
    const inspection=await page.evaluate(()=>{
      const references=[...document.querySelectorAll('use')].map(use=>use.getAttribute('href'))
      const missing=references.filter(ref=>!document.getElementById(ref.slice(1)))
      const duplicateIds=[...document.querySelectorAll('[id]')].map(el=>el.id).filter((id,index,all)=>all.indexOf(id)!==index)
      const empty=[...document.querySelectorAll('svg.icon')].filter(svg=>svg.getClientRects().length).filter(svg=>{const box=svg.getBBox();return !box.width||!box.height}).map(svg=>svg.dataset.glyph)
      return {missing,duplicateIds,empty}
    })
    assert.deepEqual(inspection,{missing:[],duplicateIds:[],empty:[]})
  })
  for (const variant of ['current','a','b','c']) {
    await check(`Candidate ${variant}: all scenes and navigation`,async()=>{
      await page.locator(`[data-variant="${variant}"]`).click()
      assert.equal(await page.locator(`[data-variant="${variant}"]`).getAttribute('aria-pressed'),'true')
      for (const scene of ['files','settings','chat']) {
        await page.locator(`[data-scene="${scene}"]`).click()
        assert.equal(await page.locator(`[data-scene="${scene}"]`).getAttribute('aria-selected'),'true')
      }
      for (const nav of ['labels','sources','skills','plugins','pages','automations','sessions']) {
        await page.locator(`.nav-item[data-nav="${nav}"]`).click()
        assert(await page.locator(`.nav-item[data-nav="${nav}"]`).evaluate(el=>el.classList.contains('selected')))
      }
      await page.screenshot({path:path.join(artifacts,`${variant}-light.png`),fullPage:true})
    })
  }
  await check('B navigation uses line normally and fill when selected',async()=>{
    await page.locator('[data-variant="b"]').click()
    assert.equal(await page.locator('.nav-item[data-nav="sessions"] svg').getAttribute('data-glyph'),'chat-3-fill')
    assert.equal(await page.locator('.nav-item[data-nav="projects"] svg').getAttribute('data-glyph'),'folder-chart-line')
    await page.locator('.nav-item[data-nav="projects"]').click()
    assert.equal(await page.locator('.nav-item[data-nav="projects"] svg').getAttribute('data-glyph'),'folder-chart-fill')
    await page.locator('[data-scene="chat"]').click()
  })
  await check('Theme toggles in both directions',async()=>{
    await page.locator('#theme-toggle').click()
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark')
    await page.screenshot({path:path.join(artifacts,'b-dark.png'),fullPage:true})
    await page.locator('#theme-toggle').click()
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light')
  })
  await check('Size selector changes rendered size without missing icons',async()=>{
    for (const size of ['14','16','18','20','24']) {
      await page.locator('#icon-size').selectOption(size)
      assert.equal(await page.locator('.nav-item svg').first().evaluate(svg=>svg.getBoundingClientRect().width),Number(size))
    }
    await page.locator('#icon-size').selectOption('18')
  })
  await check('Matrix contains 63 mappings, supports search/filter and empty state',async()=>{
    await page.locator('[data-panel="matrix"]').click()
    assert.equal(await page.locator('#matrix-body tr').count(),63)
    await page.locator('#group-filter').selectOption({label:'导航'})
    assert.equal(await page.locator('#matrix-body tr').count(),9)
    await page.locator('#group-filter').selectOption('all')
    await page.locator('#icon-search').fill('puzzle')
    assert.equal(await page.locator('#matrix-body tr').count(),1)
    await page.locator('#icon-search').fill('unmatched-invalid-name')
    assert.equal(await page.locator('#matrix-body .empty').count(),1)
    await page.locator('#icon-search').fill('')
    await page.locator('#group-filter').selectOption({label:'导航'})
    await page.screenshot({path:path.join(artifacts,'navigation-matrix.png'),fullPage:true})
    await page.locator('#group-filter').selectOption('all')
  })
  await check('Scope report and keyboard tab navigation',async()=>{
    await page.locator('[data-panel="scope"]').click()
    assert(await page.locator('#panel-scope').isVisible())
    await page.locator('[data-panel="scope"]').focus()
    await page.keyboard.press('Home')
    assert(await page.locator('#panel-preview').isVisible())
    await page.locator('[data-scene="chat"]').focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.locator('[data-scene="files"]').getAttribute('aria-selected'),'true')
    await page.locator('[data-scene="chat"]').click()
  })
  const widths=[1536,1024,760,390]
  for (const width of widths) await check(`No page overflow at ${width}px`,async()=>{
    await page.setViewportSize({width,height:width<600?844:1080})
    for (const panel of ['preview','matrix','scope']) {
      await page.locator(`[data-panel="${panel}"]`).click()
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${panel} overflows at ${width}px`)
    }
    await page.locator('[data-panel="preview"]').click()
  })
  await page.screenshot({path:path.join(artifacts,'b-mobile.png'),fullPage:true})
  await check('No runtime errors and no external requests',async()=>{
    assert.deepEqual(errors,[])
    assert.deepEqual(externalRequests,[])
  })
  const report={passed:true,checks,errors,externalRequests,viewports:widths,artifacts:fs.readdirSync(artifacts).filter(name=>name.endsWith('.png')),browser:browser.version(),channel}
  fs.writeFileSync(path.join(artifacts,'verification.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
} catch (error) {
  fs.writeFileSync(path.join(artifacts,'verification.json'),JSON.stringify({passed:false,checks,errors,externalRequests,failure:String(error)},null,2)+'\n')
  throw error
} finally { await browser.close() }
