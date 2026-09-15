#!/usr/bin/env bun
/**
 * Phaneris app-icon pipeline — the cross-platform source of truth for icon assets.
 *
 * Run with:
 *
 *     bun run scripts/generate-icons.ts
 *
 * It takes no required arguments, needs no network access and needs no
 * dependency that is not already installed: SVG rasterisation uses `sharp`
 * (already a repo-root devDependency, hoisted into the repo-root
 * `node_modules`, so a plain `import sharp from 'sharp'` resolves from here),
 * and the binary `.ico` / `.icns` containers are written by hand below. The
 * same command therefore produces identical assets on macOS, Linux and Windows.
 *
 * This script supersedes the macOS-only
 * `apps/electron/resources/generate-icons.sh`, which shells out to `sips`,
 * `iconutil` and (optionally) ImageMagick and can only run on macOS. That shell
 * script is intentionally left in the repository for historical reference, but
 * it is no longer authoritative — change this file, not that one, when the
 * artwork or the required icon sizes change.
 *
 * Artwork source of truth: `apps/electron/resources/icon.svg` (the transparent
 * Phaneris mark, 1000x1000 viewBox). Everything below is derived from it.
 *
 * Generated outputs (default output root: `apps/electron/resources/`, override
 * with the optional `--resources-dir <path>` flag):
 *
 *     icon-app.svg                  square, full-bleed app icon: white rounded
 *                                   square (radius 225) + mark at 72%, centred
 *     icon.png                      1024x1024 raster of icon-app.svg
 *     icon.ico                      Windows ICO; PNG payloads at 16, 24, 32,
 *                                   48, 64, 128 and 256 px (width/height byte 0
 *                                   for 256)
 *     icon.icns                     macOS ICNS; PNG elements ic07=128, ic11=32,
 *                                   ic12=64, ic13=256, ic14=512, ic08=256,
 *                                   ic09=512, ic10=1024
 *     icon.icon/Assets/icon.svg     same mark, for the macOS `.icon` bundle
 *                                   (its `icon.json` is validated, never edited)
 *     phaneris-logos/*.png          brand rasters, all 512x512:
 *                                     phaneris_app_icon.png       (light app icon)
 *                                     phaneris_app_icon_dark.png  (dark app icon,
 *                                                                  #0F0B1E bg)
 *                                     phaneris_logo_black.png     (mark only, #000000)
 *                                     phaneris_logo_white.png     (mark only, #FFFFFF)
 *     craft-logos/                  legacy branding rasters; removed if present,
 *                                   superseded by phaneris-logos/
 *
 * The dark app-icon variant and the solid black/white marks are derived in
 * memory from the single committed `icon.svg` — no additional .svg source files
 * are checked in for them.
 *
 * The script is deterministic and idempotent: every file is rewritten only when
 * its bytes would change, so running it twice leaves an identical tree. It also
 * re-opens every PNG it writes with `sharp` and fails loudly if a file has the
 * wrong dimensions or renders as a single flat colour.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Paths and constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const DEFAULT_RESOURCES_DIR = path.join(REPO_ROOT, 'apps', 'electron', 'resources')

/** Canvas size of the source artwork (its viewBox is 0 0 1000 1000). */
const CANVAS = 1000
/** Corner radius of the app icon's rounded square. */
const APP_ICON_CORNER_RADIUS = 225
/**
 * Fraction of the app-icon canvas the mark's longest side fills.
 *
 * The artwork's own canvas has generous margins, so a fixed multiplier on the
 * whole viewBox makes the glyph look undersized inside the tile — the mark only
 * spanned x 180–760 / y 90–875 of its 1000-unit box, so scaling the box by 0.72
 * left it at ~56% of the tile height. Fitting the mark's tight bounding box to
 * this fraction instead measures the drawing, not the canvas it happens to sit
 * on, and re-centres it at the same time.
 */
const APP_ICON_MARK_FILL = 0.8
/** Light / dark backgrounds of the app icon's rounded square. */
const APP_ICON_BACKGROUND = '#FFFFFF'
const APP_ICON_BACKGROUND_DARK = '#0F0B1E'
/** Square size of every brand raster in phaneris-logos/. */
const BRAND_LOGO_SIZE = 512
/** Icon size used by Linux packaging and the running app. */
const APP_ICON_PNG_SIZE = 1024
/**
 * Rasterise at this multiple of the target size and downsample with Lanczos,
 * which gives cleaner edges than rendering tiny icons straight from librsvg.
 */
const SUPERSAMPLE = 2

/** Windows ICO entries, in the order they are written to the directory. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const

/** macOS ICNS elements, in the order they are written to the file. */
const ICNS_ELEMENTS = [
  { type: 'ic07', size: 128 },
  { type: 'ic11', size: 32 },
  { type: 'ic12', size: 64 },
  { type: 'ic13', size: 256 },
  { type: 'ic14', size: 512 },
  { type: 'ic08', size: 256 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 },
] as const

/** Gradient ids that must survive in the source mark. */
const GRADIENT_IDS = ['gTopL', 'gStem', 'gTopR', 'gRight', 'gInner'] as const

const USAGE = `Phaneris icon pipeline

  bun run scripts/generate-icons.ts [--resources-dir <path>]

Options:
  --resources-dir <path>   output root (default: apps/electron/resources)
  -h, --help               show this help
`

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

/** Replace (or add) the root width/height so librsvg rasterises at an exact size. */
function svgWithSize(svg: string, size: number): string {
  return svg.replace(/<svg\b([^>]*)>/, (_match, attributes: string) => {
    const withoutDimensions = attributes.replace(/\s(?:width|height)="[^"]*"/g, '')
    return `<svg${withoutDimensions} width="${size}" height="${size}">`
  })
}

/** Everything between the root <svg> tags: the <defs> gradients and the polygons. */
function svgInner(svg: string): string {
  return svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim()
}

/** The mark with every gradient fill swapped for one flat colour. */
function recolorMark(svg: string, color: string): string {
  const recolored = svg.replace(/fill="url\(#[^)]+\)"/g, `fill="${color}"`)
  if (recolored === svg) {
    throw new Error(`Could not recolour the mark: no gradient fills found in icon.svg`)
  }
  return recolored
}

/**
 * Tight bounding box of the mark, measured from the artwork's own geometry.
 *
 * Read from the polygons rather than hardcoded so a redrawn mark re-fits itself
 * — a stale constant here is exactly what made the glyph shrink in the first
 * place, and the failure is invisible until someone looks at a 16 px icon.
 */
function markBoundingBox(mark: string): { x: number; y: number; width: number; height: number } {
  const points = [...mark.matchAll(/<polygon\b[^>]*\bpoints="([^"]+)"/g)].flatMap((match) =>
    match[1]!
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number)
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error(`Could not parse polygon point "${pair}" in the mark SVG`)
        }
        return { x: x!, y: y! }
      }),
  )
  if (points.length === 0) throw new Error('No <polygon> geometry found in the mark SVG')

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

const round = (value: number, decimals = 3): number => Number(value.toFixed(decimals))

/**
 * The mark with its canvas cropped to the drawing's bounding box.
 *
 * Used for the macOS 26 `.icon` layer, where the compositor positions the asset
 * inside the tile: leaving the artwork's own margins in place would make the
 * layer's declared scale mean something different from what it says, which is
 * how the current `icon.json` scale ended up describing a glyph about a third
 * of the size it appears to.
 */
function tightenMark(mark: string): string {
  const box = markBoundingBox(mark)
  const viewBox = `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`
  return mark.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`)
}

/**
 * The square, full-bleed app-icon variant: a rounded square covering the whole
 * canvas with the mark fitted to {@link APP_ICON_MARK_FILL} and centred on it.
 */
function buildAppIconSvg(mark: string, background: string): string {
  const box = markBoundingBox(mark)
  const scale = (CANVAS * APP_ICON_MARK_FILL) / Math.max(box.width, box.height)
  const offsetX = (CANVAS - box.width * scale) / 2 - box.x * scale
  const offsetY = (CANVAS - box.height * scale) / 2 - box.y * scale

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">
<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${APP_ICON_CORNER_RADIUS}" ry="${APP_ICON_CORNER_RADIUS}" fill="${background}"/>
<g transform="translate(${round(offsetX)},${round(offsetY)}) scale(${round(scale, 4)})">
${svgInner(mark)}
</g>
</svg>
`
}

// ---------------------------------------------------------------------------
// Rasterisation
// ---------------------------------------------------------------------------

/** Cache so a size shared by the .ico and .icns containers is only rendered once. */
const rasterCache = new Map<string, Promise<Buffer>>()

async function renderPng(svg: string, size: number): Promise<Buffer> {
  const cacheKey = `${size}\u0000${svg}`
  const cached = rasterCache.get(cacheKey)
  if (cached) return cached

  const rendered = (async (): Promise<Buffer> => {
    const hiRes = await sharp(Buffer.from(svgWithSize(svg, size * SUPERSAMPLE)), { density: 72 })
      .png()
      .toBuffer()
    const png = await sharp(hiRes)
      .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer()

    const { width, height } = await sharp(png).metadata()
    if (width !== size || height !== size) {
      throw new Error(`Rasterising a ${size}x${size} icon produced ${width}x${height}`)
    }
    return png
  })()

  rasterCache.set(cacheKey, rendered)
  return rendered
}

// ---------------------------------------------------------------------------
// Container formats
// ---------------------------------------------------------------------------

/**
 * ICONDIR (6 bytes) + one 16-byte ICONDIRENTRY per image + the PNG payloads.
 * A width/height byte of 0 means 256 px.
 */
function buildIco(entries: ReadonlyArray<{ size: number; png: Buffer }>): Buffer {
  const HEADER_SIZE = 6
  const ENTRY_SIZE = 16
  const directory = Buffer.alloc(HEADER_SIZE + ENTRY_SIZE * entries.length)

  directory.writeUInt16LE(0, 0) // reserved
  directory.writeUInt16LE(1, 2) // 1 = icon
  directory.writeUInt16LE(entries.length, 4)

  let offset = directory.length
  entries.forEach((entry, index) => {
    const base = HEADER_SIZE + ENTRY_SIZE * index
    const dimension = entry.size >= 256 ? 0 : entry.size
    directory.writeUInt8(dimension, base + 0) // width (0 = 256)
    directory.writeUInt8(dimension, base + 1) // height (0 = 256)
    directory.writeUInt8(0, base + 2) // palette colour count
    directory.writeUInt8(0, base + 3) // reserved
    directory.writeUInt16LE(1, base + 4) // colour planes
    directory.writeUInt16LE(32, base + 6) // bits per pixel
    directory.writeUInt32LE(entry.png.length, base + 8) // payload size
    directory.writeUInt32LE(offset, base + 12) // payload offset
    offset += entry.png.length
  })

  return Buffer.concat([directory, ...entries.map((entry) => entry.png)])
}

/**
 * ICNS: an 8-byte header ("icns" + total big-endian length) followed by
 * elements of 4-byte ASCII type + 4-byte big-endian length (header included)
 * + PNG bytes.
 */
function buildIcns(entries: ReadonlyArray<{ type: string; png: Buffer }>): Buffer {
  const body = Buffer.concat(
    entries.map(({ type, png }) => {
      const header = Buffer.alloc(8)
      header.write(type, 0, 4, 'ascii')
      header.writeUInt32BE(png.length + 8, 4)
      return Buffer.concat([header, png])
    }),
  )

  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

type WriteResult = 'written' | 'unchanged'

/** Write only when the bytes differ, so re-runs leave the tree (and mtimes) alone. */
async function writeFileIfChanged(file: string, data: Buffer | string): Promise<WriteResult> {
  const next = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  const current = await readFile(file).catch(() => null)
  if (current?.equals(next)) return 'unchanged'
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, next)
  return 'written'
}

function report(file: string, result: WriteResult, detail: string): void {
  const label = path.relative(REPO_ROOT, file).split(path.sep).join('/')
  console.log(`  ${result === 'written' ? 'wrote    ' : 'unchanged'} ${label}${detail ? `  (${detail})` : ''}`)
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function assertMarkSvg(svg: string, file: string): void {
  const label = path.relative(REPO_ROOT, file).split(path.sep).join('/')
  if (!svg.includes(`viewBox="0 0 ${CANVAS} ${CANVAS}"`)) {
    throw new Error(`${label}: expected viewBox="0 0 ${CANVAS} ${CANVAS}"`)
  }
  for (const id of GRADIENT_IDS) {
    if (!svg.includes(`id="${id}"`)) {
      throw new Error(`${label}: missing gradient id "${id}"`)
    }
  }
  const polygons = svg.match(/<polygon\b/g)?.length ?? 0
  if (polygons !== 5) {
    throw new Error(`${label}: expected 5 <polygon> elements, found ${polygons}`)
  }
}

/**
 * The macOS `.icon` bundle keeps its own JSON metadata. We only ever copy the
 * mark into it; this check makes sure the manifest is still parseable and still
 * points at `icon.svg`, so a broken bundle fails the pipeline instead of
 * shipping silently.
 */
async function assertIconBundleManifest(file: string): Promise<void> {
  const label = path.relative(REPO_ROOT, file).split(path.sep).join('/')
  if (!existsSync(file)) return
  const raw = await readFile(file, 'utf8')
  try {
    JSON.parse(raw)
  } catch (error) {
    throw new Error(`${label}: not valid JSON (${(error as Error).message})`)
  }
  if (!raw.includes('"icon.svg"')) {
    throw new Error(`${label}: no layer references icon.svg any more`)
  }
}

// ---------------------------------------------------------------------------
// Output verification
// ---------------------------------------------------------------------------

/** Re-open a generated PNG and prove it has the right size and is not flat. */
async function verifyPng(file: string, expectedSize: number): Promise<string> {
  const metadata = await sharp(file).metadata()
  if (metadata.width !== expectedSize || metadata.height !== expectedSize) {
    throw new Error(
      `${file}: expected ${expectedSize}x${expectedSize}, got ${metadata.width}x${metadata.height}`,
    )
  }
  if (metadata.format !== 'png') {
    throw new Error(`${file}: expected PNG, got ${metadata.format}`)
  }
  const stats = await sharp(file).stats()
  const nonUniform = stats.channels.some((channel) => channel.min !== channel.max)
  if (!nonUniform) {
    throw new Error(`${file}: every channel is a single flat value — the render is blank`)
  }

  const opaque = stats.channels[3]
  if (!opaque || opaque.max === 0) {
    throw new Error(`${file}: alpha channel is fully transparent — nothing was drawn`)
  }

  const label = path.relative(REPO_ROOT, file).split(path.sep).join('/')
  return `${label} ${metadata.width}x${metadata.height} channels=${metadata.channels}`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Options {
  resourcesDir: string
}

function parseArgs(argv: string[]): Options {
  let resourcesDir = DEFAULT_RESOURCES_DIR

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE)
      process.exit(0)
    }
    if (arg === '--resources-dir') {
      const value = argv[index + 1]
      if (!value) throw new Error('--resources-dir requires a path')
      resourcesDir = path.resolve(REPO_ROOT, value)
      index += 1
      continue
    }
    if (arg?.startsWith('--resources-dir=')) {
      resourcesDir = path.resolve(REPO_ROOT, arg.slice('--resources-dir='.length))
      continue
    }
    throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`)
  }

  return { resourcesDir }
}

async function main(): Promise<void> {
  const { resourcesDir } = parseArgs(process.argv.slice(2))

  const markFile = path.join(resourcesDir, 'icon.svg')
  const mark = await readFile(markFile, 'utf8')
  assertMarkSvg(mark, markFile)

  console.log(`Phaneris icons — source: ${path.relative(REPO_ROOT, markFile).split(path.sep).join('/')}`)

  const appIconSvg = buildAppIconSvg(mark, APP_ICON_BACKGROUND)
  const appIconSvgDark = buildAppIconSvg(mark, APP_ICON_BACKGROUND_DARK)

  // 2. Square, full-bleed app-icon SVG.
  const appIconSvgFile = path.join(resourcesDir, 'icon-app.svg')
  report(appIconSvgFile, await writeFileIfChanged(appIconSvgFile, appIconSvg), `${CANVAS}x${CANVAS}`)

  // 3. icon.png — what Linux packaging and the running app use.
  const iconPngFile = path.join(resourcesDir, 'icon.png')
  const iconPng = await renderPng(appIconSvg, APP_ICON_PNG_SIZE)
  report(iconPngFile, await writeFileIfChanged(iconPngFile, iconPng), `${APP_ICON_PNG_SIZE}x${APP_ICON_PNG_SIZE}`)

  // 4. icon.ico — Windows.
  const icoEntries = await Promise.all(
    ICO_SIZES.map(async (size) => ({ size, png: await renderPng(appIconSvg, size) })),
  )
  const icoFile = path.join(resourcesDir, 'icon.ico')
  report(icoFile, await writeFileIfChanged(icoFile, buildIco(icoEntries)), ICO_SIZES.join('/'))

  // 5. icon.icns — macOS.
  const icnsEntries = await Promise.all(
    ICNS_ELEMENTS.map(async ({ type, size }) => ({ type, png: await renderPng(appIconSvg, size) })),
  )
  const icnsFile = path.join(resourcesDir, 'icon.icns')
  report(
    icnsFile,
    await writeFileIfChanged(icnsFile, buildIcns(icnsEntries)),
    ICNS_ELEMENTS.map((element) => `${element.type}=${element.size}`).join(' '),
  )

  // 6. macOS .icon bundle: the mark cropped to its own bounds, so the layer's
  //    declared scale in icon.json is the fraction of the tile it actually
  //    occupies. The manifest itself is owned by hand (actool reads it) and is
  //    only validated here.
  const bundleAsset = path.join(resourcesDir, 'icon.icon', 'Assets', 'icon.svg')
  report(bundleAsset, await writeFileIfChanged(bundleAsset, tightenMark(mark)), 'cropped to mark bounds')
  await assertIconBundleManifest(path.join(resourcesDir, 'icon.icon', 'icon.json'))

  // 7. Brand rasters.
  const logosDir = path.join(resourcesDir, 'phaneris-logos')
  const brandAssets: ReadonlyArray<{ name: string; svg: string }> = [
    { name: 'phaneris_app_icon.png', svg: appIconSvg },
    { name: 'phaneris_app_icon_dark.png', svg: appIconSvgDark },
    { name: 'phaneris_logo_black.png', svg: recolorMark(mark, '#000000') },
    { name: 'phaneris_logo_white.png', svg: recolorMark(mark, '#FFFFFF') },
  ]
  for (const asset of brandAssets) {
    const file = path.join(logosDir, asset.name)
    const png = await renderPng(asset.svg, BRAND_LOGO_SIZE)
    report(file, await writeFileIfChanged(file, png), `${BRAND_LOGO_SIZE}x${BRAND_LOGO_SIZE}`)
  }

  // Legacy branding rasters, replaced by phaneris-logos/.
  const legacyLogosDir = path.join(resourcesDir, 'craft-logos')
  if (existsSync(legacyLogosDir)) {
    await rm(legacyLogosDir, { recursive: true, force: true })
    console.log(`  removed  ${path.relative(REPO_ROOT, legacyLogosDir).split(path.sep).join('/')}/ (superseded by phaneris-logos/)`)
  }

  // 8. Browser-facing assets (Web UI PWA + favicons). These are shipped to the
  // browser rather than packaged by electron-builder, so they are easy to
  // forget — generating them here keeps them tied to the same artwork.
  const browserAssets: ReadonlyArray<{ file: string; svg: string; size: number }> = [
    { file: path.join(REPO_ROOT, 'apps', 'webui', 'src', 'public', 'icon-192.png'), svg: appIconSvg, size: 192 },
    { file: path.join(REPO_ROOT, 'apps', 'webui', 'src', 'public', 'icon-512.png'), svg: appIconSvg, size: 512 },
    { file: path.join(REPO_ROOT, 'apps', 'webui', 'src', 'public', 'apple-touch-icon.png'), svg: appIconSvg, size: 180 },
    { file: path.join(REPO_ROOT, 'apps', 'viewer', 'public', 'icon-192.png'), svg: appIconSvg, size: 192 },
    { file: path.join(REPO_ROOT, 'apps', 'viewer', 'public', 'icon-512.png'), svg: appIconSvg, size: 512 },
    { file: path.join(REPO_ROOT, 'apps', 'viewer', 'public', 'apple-touch-icon.png'), svg: appIconSvg, size: 180 },
  ];
  for (const asset of browserAssets) {
    if (!existsSync(path.dirname(asset.file))) continue;
    const png = await renderPng(asset.svg, asset.size)
    report(asset.file, await writeFileIfChanged(asset.file, png), `${asset.size}x${asset.size}`)
  }

  // favicon.ico is a browser icon, not the Windows app icon: 16/32/48 only.
  const faviconIco = buildIco(
    await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await renderPng(appIconSvg, size) }))),
  )
  for (const dir of [path.join(REPO_ROOT, 'apps', 'webui', 'src', 'public'), path.join(REPO_ROOT, 'apps', 'viewer', 'public')]) {
    if (!existsSync(dir)) continue;
    const file = path.join(dir, 'favicon.ico')
    report(file, await writeFileIfChanged(file, faviconIco), '16/32/48')
  }

  // favicon.svg keeps the app-icon treatment so the tab mark matches the app.
  for (const dir of [path.join(REPO_ROOT, 'apps', 'webui', 'src', 'public'), path.join(REPO_ROOT, 'apps', 'viewer', 'public')]) {
    if (!existsSync(dir)) continue;
    const file = path.join(dir, 'favicon.svg')
    report(file, await writeFileIfChanged(file, appIconSvg), `${CANVAS}x${CANVAS}`)
  }

  // Self-check: every PNG we own, straight from sharp metadata.
  console.log('Verifying generated PNGs:')
  const verified = [
    await verifyPng(iconPngFile, APP_ICON_PNG_SIZE),
    ...(await Promise.all(
      brandAssets.map((asset) => verifyPng(path.join(logosDir, asset.name), BRAND_LOGO_SIZE)),
    )),
  ]
  for (const line of verified) console.log(`  ok  ${line}`)

  console.log(`Done — ${verified.length} PNGs verified, ico=${ICO_SIZES.length} entries, icns=${ICNS_ELEMENTS.length} elements.`)
}

await main()
