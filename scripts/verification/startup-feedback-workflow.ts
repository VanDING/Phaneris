/** Native failures are declared before implementation in startup-letter-glitch-failure-matrix-2026-10-30.md. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('startup-feedback', async evidence => {
  const renderer = resolve('apps/electron/dist/renderer')
  const files = ['apps/electron/dist/main.cjs', 'apps/electron/dist/bootstrap-preload.cjs',
    'apps/electron/dist/renderer/startup.html', 'apps/electron/dist/renderer/index.html',
    ...readdirSync(join(renderer, 'assets')).filter(file => /^(?:startup-|SplashScreen-|App-|main-).*\.(?:js|css)$/.test(file))
      .map(file => `apps/electron/dist/renderer/assets/${file}`)]
  evidence.json('build-hashes.json', Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(readFileSync(resolve(file))).digest('hex')])))
  const entry = join(evidence.directory, 'entry.ts'), output = join(evidence.directory, 'entry.cjs')
  const source = resolve('apps/electron/src/main/startup-window.ts').replaceAll('\\', '/')
  writeFileSync(entry, `import { app, BrowserWindow } from 'electron'; import { createStartupWindow } from ${JSON.stringify(source)};
    app.setPath('userData', process.env.PHANERIS_CONFIG_DIR);
    app.whenReady().then(() => {
      const presentation = createStartupWindow('Phaneris'); const targets = [];
      globalThis.startupTest = { presentation, targets, create: async (count = 1) => {
        for (let i = 0; i < count; i++) {
          const window = new BrowserWindow({show:false, ...presentation.window.getBounds(), webPreferences:{sandbox:true}});
          presentation.attach(window, false); targets.push(window);
          await window.loadURL('data:text/html,<body style="background:%23171a21;color:white">Workspace ready</body>');
        }
      }};
    }); app.on('window-all-closed', () => app.quit());`)
  await build({ entryPoints: [entry], outfile: output, bundle: true, minify: true, platform: 'node', format: 'cjs',
    define: { __dirname: JSON.stringify(resolve('apps/electron/dist')) }, external: ['electron'],
    // Only the native capability boundary is varied: render the same production
    // page in an Electron window with WebGL disabled. No product test flags.
    plugins: [{ name: 'startup-webgl-capability', setup(builder) {
      builder.onLoad({ filter: /[\\/]startup-window\.ts$/ }, args => {
        const source = readFileSync(args.path, 'utf8')
        assert(source.includes('backgroundThrottling: false'))
        return { loader: 'ts', resolveDir: dirname(args.path), contents: source.replace('backgroundThrottling: false',
          "backgroundThrottling: false, webgl: !process.argv.includes('--no-webgl')") }
      })
    } }],
  })
  const input = join(evidence.directory, 'input.json')
  writeFileSync(input, JSON.stringify({ root: resolve('.'), output: evidence.directory, entry: output }))
  const child = Bun.spawn(['node', resolve('scripts/verification/fixtures/startup-feedback.cjs'), input], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 150_000)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    evidence.json('process.json', { stdout, stderr, code }); assert.equal(code, 0, stderr + stdout)
    const report = JSON.parse(readFileSync(join(evidence.directory, 'feedback.json'), 'utf8')) as { checks: string[] }
    evidence.complete(report.checks, ['macOS/Linux native execution', 'Signed installer/release'])
    console.log(JSON.stringify({ passed: report.checks.length, output: evidence.directory }))
  } finally { clearTimeout(timer) }
})
