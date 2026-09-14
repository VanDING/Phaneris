/** Bundle with esbuild (external: electron), then run with the repository Electron binary. */
import { app, BrowserWindow, protocol } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { pageDocuments, registerPageDocumentHandler, observePageDocumentOwner } from '../apps/electron/src/main/page-document-protocol'
import { buildThumbnailHostHtml } from '../apps/electron/src/main/page-thumbnail-host'

protocol.registerSchemesAsPrivileged([{ scheme: 'craft-page', privileges: { standard: true, secure: true } }])
app.disableHardwareAcceleration()
const output = process.argv[2]
app.setPath('userData', resolve(output, '..', 'electron-profile'))
const checks: string[] = []
const deadline = setTimeout(() => { writeFileSync(output, JSON.stringify({ error: 'timeout', checks })); app.exit(1) }, 25_000)

app.whenReady().then(async () => {
  registerPageDocumentHandler()
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  observePageDocumentOwner(win.webContents, false)
  try {
    const built = readFileSync(resolve('apps/electron/dist/renderer/index.html'), 'utf8')
    const csp = built.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval';/)
    assert.match(csp, /frame-src 'self' craft-page:/)
    const hostPath = resolve(output, '..', 'host.html')
    writeFileSync(hostPath, `<meta http-equiv="Content-Security-Policy" content="${csp}"><body><script>window.inlineRan = true</script></body>`)
    await win.loadFile(hostPath)
    assert.equal(await win.webContents.executeJavaScript('window.inlineRan === true'), false)
    checks.push('production host inline scripts remain blocked')

    const content = `<p id="value">waiting</p><script>
      let isolated = false; try { parent.document.body } catch { isolated = true }
      window.addEventListener('message', e => {
        if(e.data.type === 'navigate') { location.href = 'craft-page://other/index.html'; return }
        if(e.data.type === 'init' || e.data.type === 'data') {
          document.getElementById('value').textContent = String(e.data.payload.snapshot.kv.total);
          parent.postMessage({painted: document.getElementById('value').textContent, isolated, api: typeof window.electronAPI}, '*');
        }
      });
      parent.postMessage({protocol:'craft-pages/v1', type:'ready'}, '*');
    </script>`
    function register(kind: 'live' | 'static') {
      return pageDocuments.register(win.webContents.id, { content, kind, lease: {
        leaseId: 'test', nonce: 'test', pageSlug: 'test', issuedAt: Date.now(), expiresAt: Date.now() + 60_000,
        contentDigest: createHash('sha256').update(content).digest('hex'),
      } })
    }
    const url = register('live')
    const first = await win.webContents.executeJavaScript(`new Promise(resolve => {
      window.events = [];
      window.addEventListener('message', e => {
        window.events.push({origin:e.origin, data:e.data});
        if(e.data.type === 'ready') e.source.postMessage({type:'init',payload:{snapshot:{kv:{total:42}}}}, '*');
        if(e.data.painted) resolve({origin:e.origin,...e.data});
      });
      const frame = document.createElement('iframe'); frame.id='page';
      frame.sandbox='allow-scripts allow-forms'; frame.src=${JSON.stringify(url)}; document.body.append(frame);
    })`)
    assert.deepEqual(first, { origin: 'null', painted: '42', isolated: true, api: 'undefined' })
    checks.push('independent document runs, consumes init, remains opaque and has no electronAPI')
    await win.webContents.executeJavaScript(`document.getElementById('page').contentWindow.postMessage({type:'data',payload:{snapshot:{kv:{total:99}}}}, '*')`)
    await new Promise(r => setTimeout(r, 100))
    assert.equal(await win.webContents.executeJavaScript('window.events.at(-1).data.painted'), '99')
    checks.push('replacement snapshot paints')
    await win.webContents.executeJavaScript(`document.getElementById('page').contentWindow.postMessage({type:'navigate'}, '*')`)
    await new Promise(r => setTimeout(r, 100))
    assert.equal(win.webContents.mainFrame.frames[0]?.url, url)
    checks.push('page navigation is blocked before snapshot recipient can change')
    const staticUrl = register('static')
    await win.webContents.executeJavaScript(`window.events=[]; document.getElementById('page').remove();
      const frame=document.createElement('iframe'); frame.id='page'; frame.sandbox='allow-scripts allow-forms';
      frame.src=${JSON.stringify(staticUrl)}; document.body.append(frame);`)
    await new Promise(r => setTimeout(r, 200))
    assert.equal(await win.webContents.executeJavaScript('window.events.length'), 0)
    assert.equal(win.webContents.mainFrame.frames[0]?.url, staticUrl)
    checks.push('static response CSP blocks scripts even with allow-scripts on iframe')

    const html = buildThumbnailHostHtml({ documentUrl: url, slug: 'test', kind: 'live', snapshot: { version: 1, generatedAt: 1, kv: { total: 123 }, series: {} } })
    await win.loadURL('data:text/html,' + encodeURIComponent(html))
    await new Promise(r => setTimeout(r, 200))
    assert.equal(await win.webContents.mainFrame.frames[0]!.executeJavaScript('document.getElementById("value").textContent'), '123')
    checks.push('thumbnail wrapper renders snapshot through same document protocol')
    pageDocuments.release(win.webContents.id, url)
    assert.equal(pageDocuments.respond(new Request(url)).status, 404)
    checks.push('released address is unavailable')
    writeFileSync(output, JSON.stringify({ ok: true, checks }, null, 2))
  } finally { win.destroy() }
}).then(() => { clearTimeout(deadline); app.exit(0) }).catch(error => {
  writeFileSync(output, JSON.stringify({ error: String(error.stack ?? error), checks }, null, 2))
  app.exit(1)
})
