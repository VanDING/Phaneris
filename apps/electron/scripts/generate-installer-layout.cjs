/** Generate the two native layout includes from one 96-DPI design definition. */
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const installer = path.join(__dirname, '..', 'installer')

function writeIfChanged(name, content) {
  const destination = path.join(installer, name)
  let previous
  try { previous = readFileSync(destination, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous !== content) writeFileSync(destination, content)
}

function generateInstallerLayout() {
  const layout = JSON.parse(readFileSync(path.join(installer, 'layout.json'), 'utf8'))
  const defines = { WINDOW_WIDTH: layout.window.width, WINDOW_HEIGHT: layout.window.height,
    FRAME_MARGIN: layout.window.frameMargin, BUTTON_DIAMETER: layout.primary.diameter,
    PATH_INSET: layout.welcome.pathInset, LAUNCH_Y: layout.finish.launchY,
    LAUNCH_HEIGHT: layout.finish.launchHeight, LAUNCH_EXTRA_WIDTH: layout.finish.launchExtraWidth }
  const boxes = { BRAND: layout.brand.image, BRAND_TITLE: layout.brand.title,
    DRAG: layout.caption.drag, MINIMIZE: layout.caption.minimize, CLOSE: layout.caption.close,
    PRIMARY: layout.primary.box, CHOOSE: layout.welcome.choose, PATH: layout.welcome.path,
    BROWSE: layout.welcome.browse, ERROR: layout.welcome.error,
    FINISH_TITLE: layout.finish.title, FINISH_BODY: layout.finish.description }
  const cppBoxes = { kBrandBox: layout.brand.image, kBrandTitleBox: layout.brand.title,
    kTrackBox: layout.progress.track, kStatusBox: layout.progress.status, kPercentBox: layout.progress.percent,
    kMinimizeBox: layout.caption.minimize, kCloseBox: layout.caption.close }
  for (const [name, box] of Object.entries({ ...boxes, ...cppBoxes })) {
    if (!Array.isArray(box) || box.length !== 4 || box.some(value => !Number.isInteger(value))) throw new Error(`Invalid installer box: ${name}`)
    if (box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0
      || box[0] + box[2] > layout.window.width || box[1] + box[3] > layout.window.height) throw new Error(`Installer box escapes the window: ${name}`)
  }
  for (const [name, box] of Object.entries(boxes)) for (const [index, axis] of ['X', 'Y', 'WIDTH', 'HEIGHT'].entries()) defines[`${name}_${axis}`] = box[index]
  for (const role of ['brand', 'title', 'body', 'button']) {
    if (layout.fonts[role].size <= 0 || layout.fonts[role].weight > 1000) throw new Error(`Invalid installer font: ${role}`)
    defines[`${role.toUpperCase()}_FONT_SIZE`] = layout.fonts[role].size
    defines[`${role.toUpperCase()}_FONT_WEIGHT`] = layout.fonts[role].weight
  }
  for (const [name, value] of Object.entries(defines)) if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid installer value: ${name}`)
  const constants = { kDesignWidth: layout.window.width, kDesignHeight: layout.window.height,
    kFrameMargin: layout.window.frameMargin, kBrandTitlePixels: layout.fonts.brand.size,
    kBrandTitleWeight: layout.fonts.brand.weight, kStatusPixels: layout.fonts.body.size,
    kGlyphPixels: layout.caption.glyphSize, kCaptionBandHeight: layout.caption.drag[3], kTrackCorner: layout.progress.trackCorner }
  for (const [name, value] of Object.entries(constants)) if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid installer constant: ${name}`)
  for (const name of ['latin', 'cjk']) if (typeof layout.fonts[name] !== 'string' || !layout.fonts[name] || layout.fonts[name].length > 31) throw new Error(`Invalid installer face: ${name}`)
  if (!Number.isInteger(layout.brand.markTop) || !Number.isInteger(layout.brand.markHeight)
    || layout.brand.markTop < 0 || layout.brand.markHeight <= 0
    || layout.brand.markTop + layout.brand.markHeight > layout.brand.image[3]) throw new Error('Brand mark escapes its image strip')
  const banner = 'Generated from installer/layout.json by generate-installer-layout.cjs. Do not edit.'
  writeIfChanged('layout.generated.nsh', `; ${banner}\n` + Object.entries(defines).map(([name, value]) => `!define INSTALLER_${name} ${value}`).join('\n') + '\n')
  const cpp = [`// ${banner}`, '#ifndef PHANERIS_INSTALLER_LAYOUT_GENERATED_H', '#define PHANERIS_INSTALLER_LAYOUT_GENERATED_H',
    '// Included inside namespace phaneris after the Box definition.',
    ...Object.entries(constants).map(([name, value]) => `constexpr int ${name} = ${value};`),
    ...Object.entries(cppBoxes).map(([name, box]) => `constexpr Box ${name} = {${box.map(value => `${value}.0f`).join(', ')}};`),
    `constexpr wchar_t kUiFace[] = L${JSON.stringify(layout.fonts.latin)};`,
    `constexpr wchar_t kCaptionFace[] = L${JSON.stringify(layout.fonts.cjk)};`, '#endif', ''].join('\n')
  writeIfChanged('layout.generated.h', cpp)
  return layout
}

module.exports = { generateInstallerLayout }
if (require.main === module) generateInstallerLayout()
