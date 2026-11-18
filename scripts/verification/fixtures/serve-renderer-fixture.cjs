const { writeFileSync } = require('node:fs')
const { join, relative } = require('node:path')

async function serveRendererFixture(root, output, fixture) {
  const { build, loadConfigFromFile, preview } = await import('vite')
  const relativeUrl = path => relative(root, path).replaceAll('\\', '/')
  const input = join(output, 'index.html')
  writeFileSync(input, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="./host.css"><div id="root"></div><script type="module" src="/${relativeUrl(fixture)}"></script>`)
  const rendererCss = join(root, 'apps/electron/src/renderer/index.css')
  writeFileSync(join(output, 'host.css'), `@import "${relative(output, rendererCss).replaceAll('\\', '/')}";\n@source "${fixture.replaceAll('\\', '/')}";\n`)
  const outDir = join(output, 'site')
  const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(root, 'apps/electron/vite.config.ts'))
  await build({ ...config, configFile: false, root, logLevel: 'error',
    build: { outDir, sourcemap: false, rolldownOptions: { input } } })
  const server = await preview({ configFile: false, root, build: { outDir },
    preview: { host: '127.0.0.1', port: 0, open: false } })
  return { url: `http://127.0.0.1:${server.httpServer.address().port}/${relativeUrl(input)}`, close: () => server.close() }
}

module.exports = { serveRendererFixture }
