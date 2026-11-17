import { randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { isPathWithin } from '@phaneris/shared/utils'
import type { ImageProcessor, Logger } from '../runtime/platform'

const IMAGE_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.gif': 'image/gif',
}

/** Resolve once at the resource boundary, including dangling links in ancestors. */
function resolveImage(rootPath: string, relativePath: string, write = false) {
  const extension = extname(relativePath).toLowerCase()
  if (!IMAGE_TYPES[extension] || (write && extension === '.ico')) throw new Error(`Invalid file type: ${extension}`)
  if (relativePath.includes('..') || isAbsolute(relativePath) || win32.isAbsolute(relativePath)
    || relativePath.includes(':') || relativePath.includes('\0')) {
    throw new Error('Invalid path: directory traversal not allowed')
  }
  const candidate = resolve(rootPath, relativePath)
  if (!isPathWithin(rootPath, candidate)) throw new Error('Invalid path: outside workspace directory')
  const root = realpathSync.native(rootPath)
  let path = root
  for (const part of relative(resolve(rootPath), candidate).split(sep)) {
    path = join(path, part)
    const entry = lstatSync(path, { throwIfNoEntry: false })
    // realpath deliberately throws for dangling links instead of treating them
    // as ordinary missing optional images.
    if (entry?.isSymbolicLink()) path = realpathSync.native(path)
    if (!isPathWithin(root, path)) throw new Error('Invalid path: outside workspace directory')
  }
  return { root, path, extension }
}

export function readWorkspaceImage(rootPath: string, relativePath: string): string | null {
  const image = resolveImage(rootPath, relativePath)
  if (!existsSync(image.path)) return null
  const fd = openSync(image.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fstatSync(fd)
    const current = resolveImage(rootPath, relativePath)
    const entry = statSync(current.path)
    if (current.path !== image.path || !opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new Error('Workspace image changed while reading')
    }
    const buffer = readFileSync(fd)
    return image.extension === '.svg' ? buffer.toString('utf8') : `data:${IMAGE_TYPES[image.extension]};base64,${buffer.toString('base64')}`
  } finally { closeSync(fd) }
}

/** Validation/conversion finishes before any published file or old icon changes. */
export async function writeWorkspaceImage(
  rootPath: string, relativePath: string, base64: string, mimeType: string,
  imageProcessor: ImageProcessor, logger: Logger,
): Promise<void> {
  const image = resolveImage(rootPath, relativePath, true)
  const parent = statSync(dirname(image.path))
  let buffer: Buffer = Buffer.from(base64, 'base64')
  if (image.extension === '.svg' || mimeType.toLowerCase() === 'image/svg+xml') {
    const text = buffer.toString('utf8')
    if ([/<\s*script/i, /\son[a-z]+\s*=/i, /javascript\s*:/i, /foreignobject/i].some(pattern => pattern.test(text))) {
      throw new Error('Invalid SVG: workspace icons may not contain script tags, event handler attributes, javascript: URLs, or foreignObject')
    }
  } else {
    const metadata = await imageProcessor.getMetadata(buffer)
    if (!metadata) throw new Error('Invalid workspace image')
    if (metadata.width > 256 || metadata.height > 256) {
      buffer = await imageProcessor.process(buffer, { resize: { width: 256, height: 256 }, format: 'png' })
    }
  }

  // Conversion can yield to other requests or filesystem editors. Re-resolve
  // both target and directory identity before entering synchronous publication.
  const current = resolveImage(rootPath, relativePath, true)
  const currentParent = statSync(dirname(current.path))
  if (current.root !== image.root || current.path !== image.path || currentParent.dev !== parent.dev || currentParent.ino !== parent.ino) {
    throw new Error('Workspace image destination changed while processing')
  }
  const temporary = join(dirname(image.path), `.workspace-image-${randomUUID()}.tmp`)
  const fd = openSync(temporary, 'wx', 0o600)
  let published = false
  try {
    try { writeFileSync(fd, buffer); fsyncSync(fd) } finally { closeSync(fd) }
    const destination = resolveImage(rootPath, relativePath, true)
    const directory = statSync(dirname(destination.path))
    if (destination.path !== image.path || directory.dev !== parent.dev || directory.ino !== parent.ino) {
      throw new Error('Workspace image destination changed before publication')
    }
    renameSync(temporary, image.path)
    published = true
  } finally {
    if (!published) unlinkSync(temporary)
  }

  // Only the workspace root icon owns replacement of other known formats.
  // Generic nested thumbnails never trigger workspace icon cleanup.
  if (dirname(image.path) === image.root && basename(image.path).toLowerCase() === `icon${image.extension}`) {
    for (const extension of Object.keys(IMAGE_TYPES)) {
      if (extension === image.extension) continue
      const oldPath = join(image.root, `icon${extension}`)
      if (!lstatSync(oldPath, { throwIfNoEntry: false })?.isFile()) continue
      try { unlinkSync(oldPath) }
      catch (error) { logger.warn('Workspace image saved; could not remove old icon', oldPath, error) }
    }
  }
}
