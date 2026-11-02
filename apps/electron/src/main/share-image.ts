import { app, clipboard, ClipboardItem, ipcMain, nativeImage, type IpcMainInvokeEvent } from 'electron'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { extname, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { getSessionPath } from '@phaneris/shared/sessions/paths'
import { SHARE_IMAGE, isShareImageSizeAllowed, type ShareImageSaveResult } from '../shared/share-image'

const pngPayload = z.string().min(32).max(Math.ceil(SHARE_IMAGE.maxPngBytes * 4 / 3) + 4)
const saveRequest = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  images: z.array(pngPayload).min(1).max(SHARE_IMAGE.maxPages),
}).strict()

function decodePng(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid PNG encoding')
  const buffer = Buffer.from(value, 'base64')
  if (buffer.length > SHARE_IMAGE.maxPngBytes || buffer.length < 33
    || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
    || !isShareImageSizeAllowed(buffer.readUInt32BE(16), buffer.readUInt32BE(20))) {
    throw new Error('Invalid or oversized share image')
  }
  if (nativeImage.createFromBuffer(buffer).isEmpty()) throw new Error('PNG could not be decoded')
  return buffer
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export function registerShareImageIpc(options: {
  trusted: (event: IpcMainInvokeEvent) => boolean
  /** Resolves the sending window's local workspace, never a renderer-supplied path. */
  workspace: (webContentsId: number) => { rootPath: string; remoteServer?: unknown } | null
}): void {
  const authorize = (event: IpcMainInvokeEvent) => {
    if (!options.trusted(event)) throw new Error('Share images require a trusted application frame')
  }

  ipcMain.handle('__shareImage:copy', async (event, input: unknown) => {
    authorize(event)
    const buffer = decodePng(pngPayload.parse(input))
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(buffer)], { type: 'image/png' }) })])
  })

  ipcMain.handle('__shareImage:save', async (event, input: unknown): Promise<ShareImageSaveResult> => {
    authorize(event)
    const request = saveRequest.parse(input)
    if (request.images.reduce((sum, image) => sum + image.length, 0) > SHARE_IMAGE.maxBatchBytes * 4 / 3 + 128) {
      throw new Error('Share image batch is too large')
    }
    const workspace = options.workspace(event.sender.id)
    if (!workspace || workspace.remoteServer) throw new Error('Saving share images requires a local session')
    const sessionsRoot = await realpath(join(workspace.rootPath, 'sessions'))
    const sessionPath = getSessionPath(workspace.rootPath, request.sessionId)
    if ((await lstat(sessionPath)).isSymbolicLink()) throw new Error('Invalid session directory')
    const sessionDirectory = await realpath(sessionPath)
    if (!inside(sessionsRoot, sessionDirectory)) throw new Error('Invalid session directory')
    const sessionFile = await realpath(join(sessionDirectory, 'session.jsonl'))
    if (!inside(sessionDirectory, sessionFile)) throw new Error('Invalid session directory')
    const images = request.images.map(decodePng)
    if (images.reduce((sum, image) => sum + image.length, 0) > SHARE_IMAGE.maxBatchBytes) {
      throw new Error('Share image batch is too large')
    }
    const hash = createHash('sha256')
    for (const image of images) hash.update(String(image.length)).update(':').update(image)
    const batch = 'share-' + hash.digest('hex').slice(0, 20)
    let directory = sessionDirectory
    for (const name of ['exports', 'shares', batch]) {
      directory = join(directory, name)
      const stat = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error('Invalid share export directory')
      if (!stat) await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      const created = await lstat(directory)
      if (created.isSymbolicLink() || !created.isDirectory()) throw new Error('Invalid share export directory')
      if (!inside(sessionDirectory, await realpath(directory))) throw new Error('Share export is outside the session')
    }
    const paths: string[] = []
    for (const [index, image] of images.entries()) {
      const file = join(directory, String(index + 1).padStart(2, '0') + '.png')
      await writeFile(file, image, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
        const stat = await lstat(file)
        if (stat.isSymbolicLink() || !(await readFile(file)).equals(image)) throw new Error('Existing share image has changed')
      })
      paths.push(file)
    }
    return { directory, paths }
  })

  // The bridge reads only font assets from this application's renderer bundle.
  ipcMain.handle('__shareImage:font', async (event, input: unknown) => {
    authorize(event)
    const url = new URL(z.string().max(4096).parse(input))
    if (url.protocol !== 'file:') throw new Error('Only bundled fonts can be read')
    const root = await realpath(join(app.getAppPath(), 'dist', 'renderer', 'assets'))
    const path = await realpath(fileURLToPath(url))
    if (!inside(root, path) || !['.woff', '.woff2', '.ttf', '.otf'].includes(extname(path))) {
      throw new Error('Font is outside the application bundle')
    }
    const bytes = await readFile(path)
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Font asset is too large')
    return 'data:font/' + extname(path).slice(1) + ';base64,' + bytes.toString('base64')
  })
}
