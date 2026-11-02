/** Actual Electron IPC/clipboard/filesystem, isolated workspace. Failure matrix predates implementation. */
import { app, BrowserWindow, clipboard, ClipboardItem, nativeImage } from 'electron'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerShareImageIpc } from '../../../apps/electron/src/main/share-image'

async function main() {
const directory = process.env.SHARE_VERIFY_DIRECTORY!
app.setPath('userData', join(directory, 'profile'))
await app.whenReady()
const workspace = join(directory, 'workspace'), outside = join(directory, 'outside')
const session = join(workspace, 'sessions', 'fixture-session')
await mkdir(session, { recursive: true }); await mkdir(outside)
await writeFile(join(session, 'session.jsonl'), '{"id":"fixture-session"}\n')
await writeFile(join(outside, 'session.jsonl'), '{"id":"outside"}\n')
const assets = join(app.getAppPath(), 'dist', 'renderer', 'assets')
await mkdir(assets, { recursive: true }); await writeFile(join(assets, 'fixture.woff2'), 'font-fixture')
let remote = false, trusted = true
const window = new BrowserWindow({ show: false, webPreferences: { preload: join(app.getAppPath(), 'preload.cjs'), contextIsolation: true, sandbox: true } })
registerShareImageIpc({
  trusted: event => trusted && event.sender.id === window.webContents.id && event.senderFrame === event.sender.mainFrame,
  workspace: id => id === window.webContents.id ? { rootPath: workspace, remoteServer: remote ? {} : undefined } : null,
})
await window.loadURL('data:text/html,<title>Native image sharing verification</title>')
const png = nativeImage.createFromBitmap(Buffer.alloc(1440 * 32 * 4, 255), { width: 1440, height: 32 }).toPNG().toString('base64')
const checks: { id: string; passed: boolean; error?: string }[] = []
const call = (method: string, input: unknown) => window.webContents.executeJavaScript('window.nativeShare.' + method + '(' + JSON.stringify(input) + ')')
async function check(id: string, work: () => Promise<void>) {
  try { await work(); checks.push({ id, passed: true }) }
  catch (error) { checks.push({ id, passed: false, error: String(error) }) }
}
const backup = await Promise.all((await clipboard.read()).map(async item => {
  const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)] as const))
  return new ClipboardItem(Object.fromEntries(entries))
}))
try {
  await check('N01-copy-no-files', async () => {
    assert.deepEqual(await readdir(session), ['session.jsonl'])
    await call('copy', png)
    const items = await clipboard.read()
    assert(items.some(item => item.types.includes('image/png')))
    assert.deepEqual(await readdir(session), ['session.jsonl'])
  })
  await check('N02-save-deduplicate', async () => {
    const request = { sessionId: 'fixture-session', images: [png, png] }
    const first = await call('save', request), second = await call('save', request)
    assert.deepEqual(first, second)
    assert.equal(first.paths.length, 2)
    assert(first.directory.startsWith(join(session, 'exports', 'shares')))
    assert.deepEqual(await readdir(first.directory), ['01.png', '02.png'])
    assert.equal((await readFile(first.paths[0])).toString('base64'), png)
    assert.equal(await readFile(join(session, 'session.jsonl'), 'utf8'), '{"id":"fixture-session"}\n')
  })
  await check('N03-malformed-and-traversal', async () => {
    for (const value of ['not-a-png', png.slice(0, 40), png + '$']) await assert.rejects(call('copy', value))
    for (const sessionId of ['../outside', 'unknown', 'other-workspace']) await assert.rejects(call('save', { sessionId, images: [png] }))
    const wrong = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4), { width: 16, height: 16 }).toPNG().toString('base64')
    await assert.rejects(call('save', { sessionId: 'fixture-session', images: [wrong] }))
  })
  await check('N04-native-ownership', async () => {
    remote = true
    await assert.rejects(call('save', { sessionId: 'fixture-session', images: [png] }))
    remote = false; trusted = false
    await assert.rejects(call('copy', png))
    await assert.rejects(call('save', { sessionId: 'fixture-session', images: [png] }))
    trusted = true
  })
  await check('N05-session-symlink-escape', async () => {
    await symlink(outside, join(workspace, 'sessions', 'linked-session'), 'junction')
    await assert.rejects(call('save', { sessionId: 'linked-session', images: [png] }))
    assert.deepEqual(await readdir(outside), ['session.jsonl'])
  })
  await check('N06-export-symlink-and-write-failure', async () => {
    const linked = join(workspace, 'sessions', 'linked-export')
    await mkdir(linked); await writeFile(join(linked, 'session.jsonl'), '{}')
    await symlink(outside, join(linked, 'exports'), 'junction')
    await assert.rejects(call('save', { sessionId: 'linked-export', images: [png] }))
    const blocked = join(workspace, 'sessions', 'blocked-export')
    await mkdir(blocked); await writeFile(join(blocked, 'session.jsonl'), '{}')
    await writeFile(join(blocked, 'exports'), 'occupied')
    await assert.rejects(call('save', { sessionId: 'blocked-export', images: [png] }))
    assert.deepEqual(await readdir(outside), ['session.jsonl'])
  })
  await check('N07-bundled-font-only', async () => {
    assert.equal(await call('font', pathToFileURL(join(assets, 'fixture.woff2')).href), 'data:font/woff2;base64,' + Buffer.from('font-fixture').toString('base64'))
    await assert.rejects(call('font', pathToFileURL(join(session, 'session.jsonl')).href))
    await assert.rejects(call('font', 'https://example.test/font.woff2'))
  })
} finally {
  await clipboard.write(backup)
  await writeFile(join(directory, 'native-results.json'), JSON.stringify({ checks, electron: process.versions.electron, platform: process.platform, clipboardRestored: true }, null, 2))
  window.destroy()
  app.exit(checks.every(check => check.passed) ? 0 : 1)
}
}
void main().catch(error => { console.error(error); app.exit(1) })
