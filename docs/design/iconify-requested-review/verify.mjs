/** Browser-only demo checks. Failure cases: missing assets/font, runtime/network
 * errors, omitted launchers, wrong view/state transitions, duplicate tabs,
 * missing color/type/fallback rules, coupled UI/file choices, layout overflow. */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const directory=path.dirname(fileURLToPath(import.meta.url)),out=path.join(directory,'verification')
fs.mkdirSync(out,{recursive:true})
const browser=await chromium.launch({headless:true,channel:process.env.PHANERIS_TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)})
const errors=[],requests=[],checks=[]
const check=async(name,callback)=>{await callback();checks.push(name)}
try{
  const page=await browser.newPage({viewport:{width:1536,height:1080},reducedMotion:'reduce'})
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())})
  await page.goto(pathToFileURL(path.join(directory,'index.html')).href)
  await page.evaluate(()=>document.fonts.ready)
  const launch=async action=>page.locator(`#mock-app .topbar-launchers [data-launch="${action}"]`).click()
  const section=async name=>page.locator(`[data-panel="${name}"]`).click()
  const candidate=async value=>page.locator(`[data-variant="${value}"]`).click()
  const screenshot=async name=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true})
  await check('All SVG references resolve; visible icons have geometry; Seti font loaded',async()=>{
    const r=await page.evaluate(()=>({missing:[...document.querySelectorAll('use')].filter(u=>!document.getElementById(u.getAttribute('href').slice(1))).length,empty:[...document.querySelectorAll('svg.icon')].filter(s=>s.getClientRects().length).filter(s=>!s.getBBox().width||!s.getBBox().height).length,font:document.fonts.check('24px SetiReview')}))
    assert.deepEqual(r,{missing:0,empty:0,font:true})
  })
  await check('All 10 launchers appear in exact source order',async()=>assert.deepEqual(await page.locator('#mock-app .topbar-launchers [data-launch]').evaluateAll(nodes=>nodes.map(n=>n.dataset.launch)),['newSession','sessions','kanban','calendar','gantt','files','trajectory','terminal','browser','help']))
  for(const value of ['a','b','c'])await check(`Candidate ${value} renders all primary and context features`,async()=>{
    await candidate(value)
    for(const action of ['kanban','calendar','gantt','sessions'])await launch(action)
    for(const action of ['files','trajectory','terminal','files'])await launch(action)
    await screenshot(`${value}-workspace`)
  })
  await candidate('a')
  await check('Three complete family/styles cover 72 semantic roles with native grids and paths',async()=>{
    assert.equal(await page.locator('.variant[data-variant]').count(),3)
    assert.equal(await page.locator('.family-row').count(),3)
    assert.equal(await page.locator('.family-item').count(),27)
    await section('choices');assert.equal(await page.locator('#choice-body tr').count(),9)
    await screenshot('main-icon-choices')
    const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'))
    assert.equal(Object.keys(manifest.mapping).length,72)
    for(const def of Object.values(manifest.mapping))for(const [variant,prefix,suffix,grid]of [['a','solar-','-linear',24],['b','fluent-','-24-regular',24],['c','icon-park-outline-','',48]]){
      assert(def.ids[variant].startsWith(prefix)&&def.ids[variant].endsWith(suffix),def.key+':'+variant)
      assert.deepEqual(def.boxes[variant],[grid,grid],def.key+':'+variant)
    }
    await page.locator('.all-mapping').evaluate(el=>el.open=true)
    assert.equal(await page.locator('#mapping-body tr').count(),63)
    const missing=await page.locator('#panel-choices svg.icon').evaluateAll(nodes=>nodes.filter(s=>!s.getBBox().width||!s.getBBox().height).map(s=>s.dataset.glyph))
    assert.deepEqual(missing,[])
    await page.locator('.all-mapping').evaluate(el=>el.open=false)
    await section('workspace')
  })
  await check('Workbench open, focused, background, closed and reuse behavior',async()=>{
    for(const action of ['files','trajectory','terminal'])await launch(action)
    assert.equal(await page.locator('.wb-tab').count(),3)
    await page.locator('[data-wb-collapse]').click()
    for(const action of ['files','trajectory','terminal'])assert.equal(await page.locator(`.topbar-launchers [data-launch="${action}"]`).getAttribute('data-tool-state'),'background')
    await launch('files');assert.equal(await page.locator('.wb-tab').count(),3)
    assert.equal(await page.locator('.topbar-launchers [data-launch="files"]').getAttribute('data-tool-state'),'focused')
    assert.equal(await page.locator('.topbar-launchers [data-launch="terminal"]').getAttribute('data-tool-state'),'open')
    await launch('terminal');await page.locator('[data-wb-close]').click()
    assert.equal(await page.locator('.topbar-launchers [data-launch="terminal"]').getAttribute('data-tool-state'),'closed')
    await launch('files')
  })
  await check('Browser presence and modifier behavior; help has seven working entries',async()=>{
    await launch('browser');assert(await page.locator('#browser-preview').isVisible())
    assert.equal(await page.locator('.topbar-launchers [data-launch="browser"]').getAttribute('data-tool-state'),'open')
    await page.locator('.topbar-launchers [data-launch="browser"]').click({modifiers:['Shift']})
    assert((await page.locator('.browser-window-bar').innerText()).includes('新建窗口'))
    await page.locator('[data-browser-close]').click()
    await launch('help');assert.equal(await page.locator('#help-menu .help-item').count(),7)
    await screenshot('help-menu')
    await page.locator('#help-menu [data-help="0"]').click()
    assert((await page.locator('.center .conversation-header').innerText()).includes('帮助 · 数据源'))
    await launch('newSession');assert((await page.locator('.center .conversation-header').innerText()).includes('新的示例对话'))
  })
  await check('Workbench per-tab pinning, expand/restore and close while expanded',async()=>{
    await launch('files');await page.locator('[data-wb-pin]').click();assert.equal(await page.locator('[data-wb-pin]').getAttribute('aria-pressed'),'true')
    await launch('trajectory');assert.equal(await page.locator('[data-wb-pin]').getAttribute('aria-pressed'),'false')
    await launch('files');assert.equal(await page.locator('[data-wb-pin]').getAttribute('aria-pressed'),'true')
    await page.locator('[data-wb-expand]').click();assert(await page.locator('#mock-app').evaluate(el=>el.classList.contains('is-expanded')))
    await page.locator('[data-wb-expand]').click();assert(!(await page.locator('#mock-app').evaluate(el=>el.classList.contains('is-expanded'))))
    await page.locator('[data-wb-expand]').click();await page.locator('[data-wb-close]').click()
    assert(!(await page.locator('#mock-app').evaluate(el=>el.classList.contains('is-expanded'))))
    await launch('files')
  })
  await check('Toolbar review includes all 10 actions and four state examples',async()=>{
    await section('toolbar');assert.equal(await page.locator('#toolbar-body tr').count(),10)
    assert.equal(await page.locator('#toolbar-states [data-example-state]').count(),4)
    await screenshot('toolbar-all-features')
    await page.locator('#toolbar-body [data-launch="gantt"]').click()
    assert(await page.locator('#panel-workspace').isVisible());assert((await page.locator('.center .conversation-header').innerText()).includes('甘特图'))
    await launch('sessions')
  })
  await check('Seti rules cover names, extensions, languages and unknown/Bun fallbacks',async()=>{
    await section('files')
    const expected={'AGENTS.md':'_markdown','README.md':'_markdown','CONTRIBUTING.md':'_markdown','package.json':'_json','.gitignore':'_git','.dockerignore':'_docker','Dockerfile.server':'_docker','eslint.config.mjs':'_eslint','main.ts':'_typescript','App.tsx':'_react','report.pdf':'_pdf','report.docx':'_word','report.xlsx':'_xls','bun.lock':'_lock','bunfig.toml':'_config','unknown.filetype':'_default'}
    for(const [name,id]of Object.entries(expected))assert.equal(await page.locator(`#file-demo-list [data-file="${name}"] [data-file-icon]`).getAttribute('data-file-icon'),id,name)
    await screenshot('colored-files-light')
    await page.locator('#file-search').fill('tsconfig')
    assert.equal(await page.locator('#file-demo-list [data-file]').count(),2)
    await page.locator('#file-search').fill('nonexistent-sample-file');assert.equal(await page.locator('#file-demo-list .empty').count(),1)
    await page.locator('#file-search').fill('');await page.locator('#file-demo-list [data-file="bun.lock"]').click()
    assert((await page.locator('#file-inspector').innerText()).includes('通用锁字形回退'))
    await page.locator('#file-demo-list [data-directory="docs"]').click();assert(await page.locator('#file-demo-list .indented').count()>0)
  })
  await check('File theme can be toggled independently of all UI families',async()=>{
    for(const value of ['a','b','c']){await candidate(value);assert.equal(await page.locator('#file-demo-list [data-file="package.json"] [data-file-icon]').getAttribute('data-file-icon'),'_json')}
    await page.locator('#file-color').uncheck();assert.equal(await page.locator('#file-demo-list .file-icon').count(),0)
    assert.equal(await page.locator('#file-demo-list [data-file-icon]').count(),0)
    await screenshot('monochrome-files')
    await page.locator('#file-color').check();await candidate('a')
    await page.locator('#theme-toggle').click();await screenshot('colored-files-dark');await page.locator('#theme-toggle').click()
  })
  await check('Workbench file filter preserves focus and root-level typed results',async()=>{
    await section('workspace');await launch('files')
    await page.locator('#wb-file-search').fill('json')
    assert(await page.locator('#wb-file-list [data-file]').count()>1)
    assert.equal(await page.locator('#wb-file-list .dir').count(),0)
    await page.locator('#wb-file-search').fill('')
  })
  await check('Dark UI, sizes and keyboard tabs',async()=>{
    await page.locator('#theme-toggle').click()
    for(const value of ['a','b','c']){await candidate(value);await screenshot(value+'-workspace-dark')}
    await candidate('a');await page.locator('#theme-toggle').click()
    for(const size of ['14','16','18','20','24']){await page.locator('#icon-size').selectOption(size);assert.equal(await page.locator('.app-nav .nav-item svg').first().evaluate(el=>el.getBoundingClientRect().width),Number(size))}
    await page.locator('#icon-size').selectOption('18')
    await page.locator('[data-panel="workspace"]').focus();await page.keyboard.press('End');assert(await page.locator('#panel-plan').isVisible())
    await page.keyboard.press('Home');assert(await page.locator('#panel-workspace').isVisible())
  })
  for(const width of [1536,1024,760,390])await check(`All sections fit ${width}px; mobile retains all launchers`,async()=>{
    await page.setViewportSize({width,height:width<600?844:1080})
    for(const panel of ['workspace','choices','toolbar','files','plan']){
      await section(panel)
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${panel} overflow at ${width}`)
    }
    await section('workspace')
    assert.equal(await page.locator('.topbar-launchers [data-launch]:visible').count(),10)
  })
  await screenshot('mobile-workspace');await section('files');await screenshot('mobile-colored-files')
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
  const report={passed:true,checks,errors,externalRequests:requests,browser:browser.version(),screenshots:fs.readdirSync(out).filter(name=>name.endsWith('.png'))}
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({passed:true,checks:checks.length,screenshots:report.screenshots.length,externalRequests:requests.length},null,2))
}catch(error){fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:false,checks,errors,externalRequests:requests,failure:String(error)},null,2)+'\n');throw error}finally{await browser.close()}
