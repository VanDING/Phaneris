/** AST lint coverage and CSS stacking debt, independent of the 72-warning ledger. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { ESLint } from 'eslint'
import postcss from 'postcss'
import { setVisualInventory, visualFindings } from './eslint-visual.mjs'
const root = resolve(import.meta.dir, '..'), inventory = process.argv.includes('--inventory')
const cssOnly = process.argv.find(value => value.startsWith('--css-file='))?.slice('--css-file='.length)
const ledgerPath = join(root, 'scripts/visual-debt-ledger.json')
interface Finding { file: string; rule: string; fingerprint: string; message: string; snippet: string; count: number; line?: number }
interface Allowance extends Finding { owner: string; reason: string; exit: string }
const ledger: { entries: Allowance[] } = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { entries: [] }
const failures: string[] = [], current: Finding[] = []
function css(file: string) {
  const document = readFileSync(file, 'utf8'), relativePath = relative(root, file).replaceAll('\\', '/')
  const styles = file.endsWith('.html') ? [...document.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]!) : [document]
  for (const text of styles) postcss.parse(text, { from: file }).walkDecls('z-index', node => {
    if (/(?:var\(--z-|^(auto|inherit|initial|unset|revert|revert-layer)$)/.test(node.value)) return
    const snippet = `${node.parent?.type === 'rule' ? node.parent.selector : ''} { z-index: ${node.value} }`, rule = 'css/z-index'
    const fingerprint = createHash('sha256').update(JSON.stringify([relativePath, rule, snippet])).digest('hex')
    const finding = { file: relativePath, rule, message: 'literal z-index', fingerprint, snippet, count: 1, line: node.source?.start?.line }
    current.push(finding)
    if (!ledger.entries.some(value => value.file === relativePath && value.rule === rule && value.fingerprint === fingerprint)) failures.push(`${relativePath}:${finding.line} unregistered z-index: ${node.value}`)
  })
}
if (cssOnly) css(resolve(cssOnly))
else {
  setVisualInventory(inventory)
  for (const member of ['apps/electron', 'packages/ui', 'apps/webui', 'apps/viewer']) {
    const generic = member === 'apps/webui' || member === 'apps/viewer'
    const eslint = new ESLint({ cwd: generic ? root : join(root, member), ...(generic ? { overrideConfigFile: join(root, 'eslint.config.mjs') } : {}) })
    const results = await eslint.lintFiles([generic ? `${member}/src/**/*.{ts,tsx}` : 'src/**/*.{ts,tsx}'])
    for (const result of results) for (const message of result.messages.filter(value => value.severity === 2)) failures.push(`${relative(root, result.filePath)}:${message.line} ${message.ruleId}: ${message.message}`)
    const glob = new Bun.Glob('src/**/*.{css,html}')
    for await (const path of glob.scan({ cwd: join(root, member), absolute: true })) css(path)
  }
  current.push(...visualFindings() as Finding[])
}
const grouped = new Map<string, Finding>()
for (const value of current) {
  const previous = grouped.get(value.fingerprint)
  if (previous) previous.count = value.rule.startsWith('css/') ? previous.count + 1 : Math.max(previous.count, value.count)
  else grouped.set(value.fingerprint, { ...value })
}
if (inventory) {
  writeFileSync(join(root, '.cache/visual-inventory.json'), JSON.stringify({ findings: [...grouped.values()], failures }, null, 2) + '\n')
  const syncLedger = process.argv.includes('--register') || process.argv.includes('--prune')
  if (syncLedger) {
    const live = new Map(grouped)
    const kept = ledger.entries.filter(entry => live.has(entry.fingerprint))
    const known = new Set(kept.map(entry => entry.fingerprint))
    const additions = process.argv.includes('--register')
      ? [...live.values()].filter(finding => !known.has(finding.fingerprint)).map(finding => ({
          file: finding.file,
          rule: finding.rule,
          message: finding.message,
          fingerprint: finding.fingerprint,
          count: finding.count,
          owner: finding.rule.startsWith('theme-contracts/') ? 'Electron / feature owner' : 'Electron / a11y owner',
          reason: finding.rule === 'theme-contracts/roles'
            ? 'Existing component geometry or native target whose role is established by its wrapper; preserve behavior until the owning surface migrates.'
            : 'Existing interaction markup; some controls delegate semantics to Radix, keyboard focus scopes or composite rows. Preserve the exact node until its keyboard/assistive-technology behavior is verified.',
          exit: 'When this node is maintained, replace it with a declared semantic/component role or document its content/third-party ownership; pass its theme, keyboard and reflow acceptance, then retire this fingerprint.',
        }))
      : []
    writeFileSync(ledgerPath, JSON.stringify({ ...ledger, entries: [...kept, ...additions] }, null, 2) + '\n')
    console.log(`Ledger synced: ${ledger.entries.length - kept.length} stale retired, ${additions.length} reviewed additions, ${kept.length + additions.length} entries.`)
  }
  console.log(`Visual inventory: ${grouped.size} findings. Review .cache/visual-inventory.json.`)
} else {
  if (!cssOnly) for (const allowance of ledger.entries) {
    assert(allowance.owner && allowance.reason && allowance.exit && allowance.count > 0, `Incomplete visual allowance: ${allowance.file}`)
    if ((grouped.get(allowance.fingerprint)?.count ?? 0) !== allowance.count) failures.push(`Retire or review stale visual allowance: ${allowance.file} ${allowance.rule}`)
  }
  assert.equal(failures.length, 0, failures.join('\n'))
  console.log(`Visual contracts OK: four domains, ${grouped.size} explicit legacy findings, no new debt.`)
}
