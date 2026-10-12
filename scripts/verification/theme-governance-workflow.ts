/** TC15–17: mutate the real lint configurations, CSS gate and generated contracts. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ESLint } from 'eslint'
import { verificationWorkflow } from './verification-artifacts'
await verificationWorkflow('theme-governance', async run => {
  const root = resolve(import.meta.dir, '../..'), checks: { id: string; passed: boolean; error?: string }[] = [], reports: unknown[] = []
  async function check(id: string, fn: () => Promise<void>) { try { await fn(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) } }
  for (const [member, file] of [['apps/electron', 'src/renderer/components/theme-canary.tsx'], ['packages/ui', 'src/components/theme-canary.tsx'],
    ['apps/webui', 'src/theme-canary.tsx'], ['apps/viewer', 'src/theme-canary.tsx']]) {
    const eslint = new ESLint({ cwd: member === 'apps/webui' || member === 'apps/viewer' ? root : join(root, member!),
      ...(member === 'apps/webui' || member === 'apps/viewer' ? { overrideConfigFile: join(root, 'eslint.config.mjs') } : {}) })
    const path = join(root, member!, file!)
    for (const [kind, source] of Object.entries({ jsx: '<div className="z-10" />', cn: 'cn("relative", "z-[2]")', cva: 'cva("z-[3]")', template: '<div className={`hover:z-20 ${active ? "z-[1]" : "z-0"}`} />',
      a11y: '<img src="test.png" />', shadow: '<div className="shadow-3xl" />', motion: '<div className="transition-all" />',
      literal: '<div className="bg-[#ffffff]" />', role: '<button type="button" className="px-2">Action</button>',
      reveal: '<button type="button" className="craft-icon-button opacity-0 group-hover:opacity-100">Action</button>' })) await check(`TC16-${member}-${kind}`, async () => {
      const [report] = await eslint.lintText(`const active = true; const cn = (...x) => x; const cva = cn; export const Probe = () => ${source};`, { filePath: path })
      reports.push({ member, kind, messages: report!.messages }); assert(report!.messages.some(value => value.severity === 2), `${member} must reject ${kind}`)
    })
    await check(`TC16-${member}-semantic-positive`, async () => {
      const [report] = await eslint.lintText('export const Probe = () => <button type="button" className="craft-control z-component-overlay shadow-minimal transition-colors">Action</button>;', { filePath: path })
      assert.equal(report!.errorCount, 0, JSON.stringify(report!.messages))
    })
  }
  const command = async (entry: string, args: string[]) => {
    const child = Bun.spawn([process.execPath, 'run', entry, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); reports.push({ entry, args, code, output: (out + err).slice(-4000) }); return { code, out: out + err }
  }
  for (const [kind, css, valid] of [['semantic', '.component { z-index: var(--z-component-overlay); }', true],
    ['literal', '.component { z-index: 10; }', false], ['comment', '/* z-index: 10 */ .component { z-index: var(--z-component-overlay); }', true]] as const) await check(`TC15-css-${kind}`, async () => {
      const file = join(run.directory, `${kind}.css`); writeFileSync(file, css)
      const result = await command('scripts/check-visual-contracts.ts', [`--css-file=${file}`])
      assert.equal(result.code === 0, valid, result.out); if (!valid) assert(result.out.includes('z-index'), result.out)
    })
  const motion = readFileSync(join(root, 'packages/ui/src/styles/motion.css'), 'utf8')
  for (const mutation of [false, true]) await check(`TC17-motion-${mutation ? 'drift' : 'parity'}`, async () => {
    const file = join(run.directory, `motion-${mutation}.css`); writeFileSync(file, mutation ? motion.replace('--motion-duration-fast: 100ms', '--motion-duration-fast: 101ms') : motion)
    const result = await command('scripts/generate-theme-contract.ts', ['--check', `--motion-css=${file}`]); assert.equal(result.code === 0, !mutation, result.out)
  })
  run.json('theme-governance.json', { checks, reports, scope: 'Real four-domain ESLint configurations and CLI gates, with isolated mutation inputs.' })
  run.complete(checks.filter(value => value.passed).map(value => value.id), ['Runtime interactions are verified in theme browser workflows'])
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})
