#!/usr/bin/env bun
/**
 * Generate the Windows installer's brand assets from the vector artwork.
 *
 * Source of truth is `apps/electron/resources/icon.svg` — the mark, and per that
 * folder's AGENTS.md the artwork everything else is derived from. Rendering the
 * mark from vector rather than compositing the 512px app-icon raster is the
 * whole point: the installer draws the lockup at up to 300 device pixels tall on
 * a 200% display, where a raster source is visibly soft.
 *
 * Outputs into `apps/electron/installer/assets/`, which is committed: the strips
 * are `File` sources for the NSIS script and the bitmaps are read by
 * electron-builder while it resolves its config, so neither can be produced by a
 * late build hook the way `installer-ui/windowframe.dll` is.
 *
 *   brand.png / brand@2x.png            light lockup, transparent background
 *   brand-dark.png / brand-dark@2x.png  dark lockup, transparent background
 *   brand.bmp / brand-2x.bmp            600x176 and 1200x352, opaque white
 *   brand-dark.bmp / brand-dark-2x.bmp  the same two sizes on the dark page
 *   uninstaller-sidebar.bmp             164x314, NSIS MUI welcome/finish bitmap
 *   installerHeader.bmp                 150x57,  NSIS MUI header bitmap
 *
 * Two details worth not "simplifying":
 *
 *  * The PNG strips have a TRANSPARENT background, not white. The plugin paints
 *    the page background and then blits the strip on top, so an opaque strip
 *    would show a seam wherever the two whites differed by one level.
 *    Transparency removes the possibility instead of matching two colour
 *    constants by hand.
 *
 *  * The BMP strips cannot use that trick. NSIS's welcome and finish pages are
 *    nsDialogs pages now and their brand lockup is a bitmap static, which draws
 *    an opaque 24-bit bitmap with no alpha at all; dropping the alpha channel
 *    from a transparent render would leave the transparent pixels black. So the
 *    BMPs are flattened onto the page colour they will sit on -- white for the
 *    light pair, #151517 (progress.h's kBackgroundDark) for the dark pair.
 *
 *  * NSIS's MUI bitmaps must be BMP, and `sharp` cannot write BMP. Rather than
 *    take a second image dependency, this writes the 24-bit BMP headers by hand
 *    — the format is a 54-byte header plus bottom-up BGR rows padded to 4 bytes.
 *
 * Run: bun run installer:brand
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const ROOT = resolve(import.meta.dir, '..')
const RES = join(ROOT, 'apps/electron/resources')
const OUT = join(ROOT, 'apps/electron/installer/assets')

const STRIP_W = 600
const STRIP_H = 176
const MARK_TOP = 16
const MARK_H = 88
const WORDMARK_PX = 28
const WORDMARK_BASELINE = 144

// Palette. Must match progress.h's constants; that file is authoritative for
// what the plugin paints behind these images.
const LIGHT_INK = '#0F1115'
const DARK_INK = '#FFFFFF'
const LIGHT_PAGE = '#FFFFFF'
const DARK_PAGE = '#151517'

/** The mark's own bounds inside icon.svg's 1000x1000 canvas, so the tile can be
 *  filled rather than the artwork's generous margins being reproduced. */
const MARK_VIEWBOX = '180 90 580 785'
const MARK_ASPECT = 580 / 785

const svg = readFileSync(join(RES, 'icon.svg'), 'utf8')
const markInner = svg
  .replace(/^[\s\S]*?<defs>/, '<defs>')
  .replace(/<\/svg>\s*$/, '')
  .trim()

const log = (message: string) => console.log(`  • installer brand: ${message}`)

/** The lockup: mark above, wordmark below, no background. */
function stripSvg(ink: string): string {
  const markW = (MARK_H * MARK_ASPECT).toFixed(2)
  const markX = ((STRIP_W - MARK_H * MARK_ASPECT) / 2).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIP_W}" height="${STRIP_H}" viewBox="0 0 ${STRIP_W} ${STRIP_H}">
<svg x="${markX}" y="${MARK_TOP}" width="${markW}" height="${MARK_H}" viewBox="${MARK_VIEWBOX}">${markInner}</svg>
<text x="${STRIP_W / 2}" y="${WORDMARK_BASELINE}" font-family="Segoe UI" font-size="${WORDMARK_PX}" font-weight="600" text-anchor="middle" fill="${ink}">Phaneris</text>
</svg>`
}

/**
 * Minimal 24-bit BMP writer.
 *
 * NSIS's MUI bitmaps must be BMP and sharp has no BMP encoder, so this emits the
 * format directly: 14-byte file header, 40-byte BITMAPINFOHEADER, then rows of
 * BGR triples bottom-up, each row padded to a 4-byte boundary. 24-bit needs no
 * palette, which is why it is the format the MUI art uses.
 */
function toBmp24(rgb: Buffer, width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixels = rowSize * height
  const out = Buffer.alloc(54 + pixels)

  out.write('BM', 0, 'ascii')
  out.writeUInt32LE(54 + pixels, 2)
  out.writeUInt32LE(54, 10) // pixel data offset
  out.writeUInt32LE(40, 14) // BITMAPINFOHEADER size
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22) // positive height = rows stored bottom-up
  out.writeUInt16LE(1, 26) // planes
  out.writeUInt16LE(24, 28) // bits per pixel
  out.writeUInt32LE(pixels, 34)
  out.writeInt32LE(2835, 38) // ~72 DPI, in pixels per metre
  out.writeInt32LE(2835, 42)

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 3
    const dstRow = 54 + y * rowSize
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 3
      const d = dstRow + x * 3
      out[d] = rgb[s + 2] // BMP stores BGR, sharp hands us RGB
      out[d + 1] = rgb[s + 1]
      out[d + 2] = rgb[s]
    }
  }
  return out
}

/**
 * Rasterise an SVG to a 24-bit BMP flattened onto `background`.
 *
 * The flatten is not cosmetic: the brand lockups are drawn with a transparent
 * background so the PNG pair can sit on either page colour, and a straight
 * removeAlpha() would turn every transparent pixel black -- which is what the
 * transparent area would then look like inside the installer's bitmap static.
 */
async function writeBmp(
  name: string,
  markup: string,
  width: number,
  height: number,
  background: string,
) {
  const { data } = await sharp(Buffer.from(markup))
    .resize(width, height, { fit: 'fill' })
    .flatten({ background })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const path = join(OUT, name)
  writeFileSync(path, toBmp24(data, width, height))
  log(`${name}  ${width}x${height} BMP`)
}

log('brand strips (vector mark from resources/icon.svg)')
for (const [suffix, ink] of [['', LIGHT_INK], ['-dark', DARK_INK]] as const) {
  for (const scale of [1, 2]) {
    const name = `brand${suffix}${scale === 2 ? '@2x' : ''}.png`
    const path = join(OUT, name)
    await sharp(Buffer.from(stripSvg(ink)))
      .resize(STRIP_W * scale, STRIP_H * scale)
      .png()
      .toFile(path)
    log(`${name}  ${STRIP_W * scale}x${STRIP_H * scale}`)
  }
}

// The same four renders again as BMP, because NSIS's bitmap statics cannot read
// PNG. apps/electron/installer/installer-pages.nsh picks the 2x file above
// 96 dpi.
log('brand strips for the nsDialogs pages')
for (const [suffix, ink, page] of [
  ['', LIGHT_INK, LIGHT_PAGE],
  ['-dark', DARK_INK, DARK_PAGE],
] as const) {
  for (const scale of [1, 2]) {
    const name = `brand${suffix}${scale === 2 ? '-2x' : ''}.bmp`
    await writeBmp(name, stripSvg(ink), STRIP_W * scale, STRIP_H * scale, page)
  }
}

log('nsis bitmaps')
const markW = 96
const markH = (markW / MARK_ASPECT).toFixed(2)
// The uninstaller keeps a stock MUI page, so this is the one bitmap a user
// actually sees. Accent wash, white mark centred.
await writeBmp(
  'uninstaller-sidebar.bmp',
  `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
<defs><linearGradient id="wash" x1="0" y1="1" x2="0.4" y2="0">
<stop offset="0%" stop-color="#2A0E92"/><stop offset="55%" stop-color="#5420F3"/><stop offset="100%" stop-color="#8F63FF"/>
</linearGradient></defs>
<rect width="164" height="314" fill="url(#wash)"/>
<svg x="${((164 - markW) / 2).toFixed(2)}" y="${((314 - Number(markH)) / 2).toFixed(2)}" width="${markW}" height="${markH}" viewBox="${MARK_VIEWBOX}">
<g fill="#FFFFFF">${markInner.replace(/fill="url\(#[^)]*\)"/g, 'fill="#FFFFFF"')}</g>
</svg>
</svg>`,
  164,
  314,
  LIGHT_PAGE,
)

await writeBmp(
  'installerHeader.bmp',
  `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
<rect width="150" height="57" fill="#FFFFFF"/>
<svg x="10" y="9" width="29" height="39" viewBox="${MARK_VIEWBOX}">${markInner}</svg>
<text x="46" y="35" font-family="Segoe UI" font-size="17" font-weight="600" fill="${LIGHT_INK}">Phaneris</text>
</svg>`,
  150,
  57,
  LIGHT_PAGE,
)

log('done')
