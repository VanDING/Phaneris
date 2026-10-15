/** Production components in actual Electron; no browser-driver transport or external accounts. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { BrowserPaneManager } from '../../../apps/electron/src/main/browser-pane-manager'
const url = process.env.PHANERIS_VERIFY_URL!, output = process.env.PHANERIS_VERIFY_OUTPUT!
writeFileSync(join(output,'renderer-boot.json'),JSON.stringify({argv:process.argv,url}))
app.setPath('userData',join(output,'renderer-profile'))
app.commandLine.appendSwitch('disable-background-timer-throttling')
const checks: string[] = [], errors: string[] = []
const progress = (stage: string) => writeFileSync(join(output,'progress.json'),JSON.stringify({stage}))
process.on('uncaughtException',error=>{writeFileSync(join(output,'upstream-015-renderer.json'),JSON.stringify({checks,errors,error:String(error),stack:error.stack}));app.exit(1)})
let manager: BrowserPaneManager | undefined
;(async () => {
  await app.whenReady()
  progress('electron-ready')
  const m = manager = new BrowserPaneManager(), id = m.createInstance('renderer-015',{show:false})
  progress('browser-instance-created')
  m.getInstance(id)!.pageView.webContents.on('console-message',details => {if(details.level==='error') errors.push(details.message)})
  const evaluate = (expression: string) => m.evaluate(id,expression)
  const wait = async (expression: string) => {
    const deadline = Date.now()+30_000
    while(!await evaluate(expression)) {assert(Date.now()<deadline,`Did not reach ${expression}`);await new Promise(resolve=>setTimeout(resolve,30))}
  }
  const click = async (name: string) => {
    const node = (await m.getAccessibilitySnapshot(id)).nodes.find(node=>node.role==='button' && node.name===name)
    assert(node,`Missing actual button: ${name}`); await m.clickElement(id,node.ref)
  }
  await m.navigate(id,url!)
  progress('fixture-navigated')
  await wait('!!document.querySelector("#credentials input") && !!document.querySelector("#composer [contenteditable=true]")')
  progress('production-components-mounted')
  await evaluate('document.querySelector("#credentials input").focus()')
  await m.typeText(id,'valid-synthetic-credential')
  await click('Cancel')
  assert.deepEqual(await evaluate('window.upstream015.responses'),[{type:'credential',cancelled:true}])
  checks.push('U15-03-real-credential-cancel-never-submits-valid-form')
  await evaluate(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(12*1024*1024)],'oversize.bin',{type:'application/octet-stream'}));const input=document.querySelector('#composer input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await wait('document.body.innerText.includes("oversize.bin")')
  assert.equal(await evaluate('window.upstream015.state().attachments.length'),0)
  assert.equal(await evaluate('window.upstream015.state().draft'),'Retained draft')
  checks.push('U15-03-single-file-preflight-retains-draft')
  await evaluate(`window.upstream015.seed(['one','two'].map(name=>({name:name+'.bin',path:name+'.bin',type:'unknown',mimeType:'application/octet-stream',size:6*1024*1024,base64:''})))`)
  await wait('document.body.innerText.includes("one.bin")')
  await click('Send message')
  await wait('document.body.innerText.includes("Attachments are too large to send together")')
  assert.deepEqual(await evaluate('({count:window.upstream015.submitted.length,draft:window.upstream015.state().draft,files:window.upstream015.state().attachments.length})'),{count:0,draft:'Retained draft',files:2})
  checks.push('U15-03-total-preflight-keeps-text-and-all-attachments')
  await evaluate(`window.upstream015.seed([{name:'text.txt',path:'text.txt',type:'text',mimeType:'text/plain',size:8*1024*1024,text:'a'.repeat(8*1024*1024),base64:'YQ=='.repeat(3*1024*1024)}])`)
  await wait('document.body.innerText.includes("text.txt")')
  await click('Send message')
  assert.equal(await evaluate('window.upstream015.submitted.length'),0)
  assert.equal(await evaluate('window.upstream015.state().draft'),'Retained draft')
  checks.push('U15-03-serialized-text-plus-base64-cannot-exceed-message')
  await evaluate(`window.upstream015.seed([{name:'small.txt',path:'small.txt',type:'text',mimeType:'text/plain',size:5,text:'hello'}])`)
  await wait('document.body.innerText.includes("small.txt")')
  await click('Send message')
  await wait('window.upstream015.submitted.length===1')
  assert.equal(await evaluate('window.upstream015.state().draft'),'')
  checks.push('U15-03-valid-message-still-submits-and-clears-draft')
  assert.deepEqual(errors,[])
  writeFileSync(join(output!,'forms.png'),(await m.screenshot(id,{format:'png'})).imageBuffer)
  checks.push('U15-27-real-production-components-have-no-page-errors')
})().then(()=>{
  writeFileSync(join(output!,'upstream-015-renderer.json'),JSON.stringify({checks,errors,scope:'Actual Electron/CDP and production React components; synthetic host callbacks only'},null,2));app.exit(0)
},error=>{
  writeFileSync(join(output!,'upstream-015-renderer.json'),JSON.stringify({checks,errors,error:String(error),stack:error.stack},null,2));app.exit(1)
}).finally(()=>manager?.destroyAll())
