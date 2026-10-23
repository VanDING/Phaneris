/** Authored before implementation: production theme/compiler/CSS/settings + isolated storage migration. */
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BUILTIN_THEMES, DEFAULT_THEME_FILE } from '../../packages/shared/src/config/theme'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('default-theme-refinement', async run => {
  const root = resolve(import.meta.dir, '../..'), checks: { id: string; passed: boolean; error?: string }[] = [], samples: unknown[] = [], errors: string[] = []
  async function check(id: string, action: () => unknown | Promise<unknown>) {
    try { await action(); checks.push({ id, passed: true }); console.log(`PASS ${id}`) }
    catch (error) { checks.push({ id, passed: false, error: String(error) }); console.log(`FAIL ${id}: ${error}`) }
  }
  await check('D01-default-only-bundled', () => {
    assert.deepEqual(Object.keys(BUILTIN_THEMES), ['default'])
    assert.deepEqual(readdirSync(join(root, 'apps/electron/resources/themes')).filter(name => name.endsWith('.json')), ['default.json'])
  })
  await check('D02-legacy-storage', async () => {
    const configDir = join(run.directory, 'isolated-config'); mkdirSync(join(configDir, 'themes'), { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ credentials: {}, workspaces: [], activeWorkspaceId: '', themeMode: 'light', colorTheme: 'geek', themeFont: 'system' }))
    writeFileSync(join(configDir, 'themes/owned.json'), JSON.stringify({ name: 'Owned', accent: '#3b82f6' }))
    const source = `import assert from 'node:assert/strict';
      import {getThemePreferences,setThemePreferences,loadPresetThemes} from './packages/shared/src/config/appearance.ts';
      import {getWorkspaceColorTheme} from './packages/shared/src/workspaces/storage.ts';
      import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'; import {join} from 'node:path';
      assert.deepEqual(getThemePreferences(),{mode:'light',colorTheme:'default',font:'system'});
      for(const id of ['geek','cyberpunk-2077','ink','owned','default']) {
        assert.deepEqual(setThemePreferences({mode:'dark',colorTheme:id,font:'inter'}),{mode:'dark',colorTheme:'default',font:'inter'});
      }
      assert.deepEqual(loadPresetThemes().map(t=>t.id),['default']);
      const ws=join(process.env.PHANERIS_CONFIG_DIR,'workspace'); mkdirSync(ws,{recursive:true});
      const data={id:'fixture',name:'Legacy',defaults:{colorTheme:'owned'}}; writeFileSync(join(ws,'config.json'),JSON.stringify(data));
      assert.equal(getWorkspaceColorTheme(ws),undefined); assert.equal(JSON.parse(readFileSync(join(ws,'config.json'),'utf8')).defaults.colorTheme,'owned');
      assert.equal(JSON.parse(readFileSync(join(process.env.PHANERIS_CONFIG_DIR,'themes/owned.json'),'utf8')).name,'Owned');
      console.log('Default-only migration, mode/font preservation, workspace inheritance, user ownership verified');`
    const child = Bun.spawn([process.execPath, '-e', source], { cwd: root, env: { ...process.env, PHANERIS_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    samples.push({ storage: stdout, stderr }); assert.equal(code, 0, stderr)
  })
  const server = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/theme-contract.tsx' })
  const launched = await launchWorkflowBrowser()
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 920 }, reducedMotion: 'reduce', colorScheme: 'light' })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.stack ?? error.message)); await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    for (const host of ['electron', 'ui', 'viewer', 'webui']) {
      await page.goto(`${server.url}?css=${host}.css`, { waitUntil: 'networkidle', timeout: 120_000 })
      await page.locator('[data-contract-ready]').waitFor()
      for (const mode of ['light', 'dark'] as const) await check(`D03-${host}-${mode}-static-runtime-parity`, async () => {
        await page.evaluate(mode => window.themeContract.choose('default', mode), mode)
        await page.waitForFunction(mode => {
          const state = JSON.parse(document.querySelector('[data-testid="state"]')!.textContent!); return state.status === 'ready' && state.mode === mode
        }, mode)
        const sample = await page.evaluate(() => {
          const root = document.documentElement, style = document.getElementById('craft-theme-overrides') as HTMLStyleElement
          const keys = ['accent', 'info', 'success', 'destructive'].flatMap(role => [`--${role}`, `--${role}-text`, `--on-${role}`])
          const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
          const color = (value: string) => { const el = document.createElement('i'); el.style.color = value; document.body.append(el); const css = getComputedStyle(el).color; el.remove(); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data) }
          const read = () => Object.fromEntries(keys.map(key => [key, color(getComputedStyle(root).getPropertyValue(key))]))
          const runtime = read(); style.disabled = true; const baseline = read(); style.disabled = false
          return { runtime, baseline }
        })
        samples.push({ host, mode, sample }); assert.deepEqual(sample.runtime, sample.baseline)
        if (host === 'electron') await page.screenshot({ path: join(run.directory, `semantic-${mode}.png`) })
      })
    }
    await check('D04-raw-color-is-retained-when-readable', async () => {
      const result = await page.evaluate(async theme => {
        const compiled = await window.themeContract.compile(theme)
        return compiled.tokens
      }, { ...DEFAULT_THEME_FILE, accent: '#17428A', success: '#1B5939' })
      assert.equal(result.light['--accent-text']?.toLowerCase(), '#17428a')
      assert.equal(result.light['--success-text']?.toLowerCase(), '#1b5939')
    })
    await check('D05-poor-text-adjusted-raw-untouched', async () => {
      const result = await page.evaluate(async theme => (await window.themeContract.compile(theme)).tokens.light,
        { ...DEFAULT_THEME_FILE, accent: '#f5d900', success: '#a0eeaa' })
      assert.equal(result['--accent'], '#f5d900'); assert.equal(result['--success'], '#a0eeaa')
      assert.notEqual(result['--accent-text'], '#f5d900'); assert.notEqual(result['--success-text'], '#a0eeaa')
      assert.equal(result['--on-accent'], '#000000')
    })
    await check('D08-default-status-hover-contrast', async () => {
      const ratios = await page.evaluate(async theme => {
        const compiled = await window.themeContract.compile(theme), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
        const rgb = (value: string) => { ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data) }
        const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, value, index) => {
          const c = value / 255; return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index]!
        }, 0)
        return (['light', 'dark'] as const).flatMap(mode => {
          const tokens = compiled.tokens[mode]
          return ['accent', 'info', 'success', 'destructive'].flatMap(role => {
            const text = rgb(tokens[`--${role}-text`]!), raw = rgb(tokens[`--${role}`]!)
            return ['background', 'paper', 'muted', 'card', 'input', 'popover-solid', 'secondary', 'user-message-bubble'].map(surface => {
              const base = rgb(tokens[`--${surface}`]!), wash = base.slice(0, 3).map((value, i) => raw[i]! * .2 + value * .8)
              const a = luminance(text), b = luminance(wash)
              return { mode, role, surface, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
            })
          })
        })
      }, DEFAULT_THEME_FILE)
      samples.push({ hoverContrasts: ratios }); assert(ratios.every(sample => sample.ratio >= 4.5), JSON.stringify(ratios.filter(sample => sample.ratio < 4.5)))
    })
    await check('D06-appearance-no-theme-switcher', async () => {
      await page.goto(`${server.url}?css=electron.css&appearance=true`, { waitUntil: 'networkidle', timeout: 120_000 })
      await page.getByText('Default', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Default', exact: true }).count(), 0)
      assert.equal(await page.getByText('工作区主题', { exact: true }).count(), 0)
      await page.screenshot({ path: join(run.directory, 'appearance-light.png') })
    })
    await check('D07-no-page-errors', () => assert.deepEqual(errors, []))
    await check('D09-status-actions-keyboard-and-touch', async () => {
      const touch = await launched.browser.newContext({ viewport: { width: 390, height: 920 }, hasTouch: true, reducedMotion: 'reduce' })
      touch.setDefaultTimeout(30_000)
      try {
        const actions = await touch.newPage(); actions.on('pageerror', error => errors.push(error.message))
        await actions.goto(`${server.url}?css=electron.css&inline=true`, { waitUntil: 'networkidle', timeout: 120_000 })
        await actions.locator('[data-contract-ready]').waitFor()
        for (const mode of ['light', 'dark'] as const) {
          await actions.evaluate(mode => window.themeContract.choose('default', mode), mode)
          await actions.waitForFunction(mode => JSON.parse(document.querySelector('[data-testid="state"]')!.textContent!).mode === mode, mode)
          for (const [surface, name] of [['inline-success', 'common.done'], ['inline-error', 'common.retry']]) {
            const button = actions.getByTestId(surface!).getByRole('button', { name, exact: true })
            const rect = await button.boundingBox(); assert(rect && rect.width >= 43.9 && rect.height >= 43.9)
            await button.focus(); await actions.keyboard.press('Enter')
          }
        }
        assert.deepEqual(await actions.evaluate(() => window.themeContract.inlineCalls), ['dismiss', 'retry', 'dismiss', 'retry'])
        await actions.screenshot({ path: join(run.directory, 'status-actions-dark-390.png') })
      } finally { await touch.close() }
    })
    assert.deepEqual(errors, [])
  } finally {
    run.json('checks.json', { checks, samples, errors }); await context.tracing.stop({ path: join(run.directory, 'trace.zip') })
    await context.close(); await server.close(); await launched.close()
  }
  run.complete(checks.filter(check => check.passed).map(check => check.id), ['Packaged/native clients', 'Physical macOS/Linux devices'])
  assert(checks.every(check => check.passed), JSON.stringify(checks.filter(check => !check.passed), null, 2))
})
