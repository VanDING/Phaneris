/** Native startup feedback failures are declared in the M0 matrix. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('startup-feedback', async evidence => {
  const entry = join(evidence.directory, 'entry.ts'), output = join(evidence.directory, 'entry.cjs')
  const source = resolve('apps/electron/src/main/startup-window.ts').replaceAll('\\', '/')
  writeFileSync(entry, `import { app } from 'electron'; import { createStartupWindow } from ${JSON.stringify(source)};
    app.setPath('userData', process.env.PHANERIS_CONFIG_DIR);
    app.whenReady().then(() => createStartupWindow('Phaneris', process.argv.includes('--dark') ? 'Loading…' : '正在加载…', process.argv.includes('--dark')));
    app.on('window-all-closed', () => app.quit());`)
  await build({ entryPoints: [entry], outfile: output, bundle: true, minify: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const probe = join(evidence.directory, 'probe.cjs')
  writeFileSync(probe, `
    const { _electron } = require('playwright'); const assert = require('node:assert/strict');
    const { mkdirSync, writeFileSync } = require('node:fs'); const { join } = require('node:path');
    (async () => {
      const results = [];
      for (const dark of [false, true]) {
        const profile = join(__dirname, dark ? 'dark' : 'light'); mkdirSync(profile);
        const env = { ...process.env, PHANERIS_CONFIG_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
        const application = await _electron.launch({ args: [${JSON.stringify(output)}, ...(dark ? ['--dark'] : [])], env });
        try {
          const page = await application.firstWindow(); await page.getByRole('status').waitFor();
          await page.waitForTimeout(400);
          assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
          assert.equal(await page.evaluate(() => typeof window.electronAPI), 'undefined');
          assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
          const colors = await page.evaluate(() => ({ background: getComputedStyle(document.body).backgroundColor,
            text: getComputedStyle(document.querySelector('p')).color, overflow: document.body.scrollWidth > innerWidth }));
          assert(!colors.overflow); assert.equal(colors.background, dark ? 'rgb(23, 26, 33)' : 'rgb(255, 255, 255)');
          await page.screenshot({ path: join(__dirname, dark ? 'dark.png' : 'light.png') });
          results.push({ dark, colors, text: await page.getByRole('status').innerText() });
        } finally { await application.close(); }
      }
      writeFileSync(join(__dirname, 'feedback.json'), JSON.stringify(results, null, 2));
    })().catch(error => { console.error(error); process.exitCode = 1; });`)
  const child = Bun.spawn(['node', probe], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  evidence.json('process.json', { stdout, stderr, code })
  assert.equal(code, 0, stderr)
  evidence.complete(['light-chinese-loading-without-rpc-or-node', 'dark-english-loading-without-rpc-or-node'], ['macOS/Linux native windows'])
  console.log(JSON.stringify({ passed: 2, output: evidence.directory }))
})
