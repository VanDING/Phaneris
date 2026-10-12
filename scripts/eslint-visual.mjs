/** Four renderer domains share rules; legacy findings have exact, counted allowances. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import zIndex from './eslint-rules/no-hardcoded-z-index.cjs'
import shadows from '../packages/ui/eslint-rules/no-nonstandard-shadows.cjs'
import transition from './eslint-rules/no-transition-all.cjs'
import roles from './eslint-rules/visual-roles.cjs'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ledgerPath = join(root, 'scripts/visual-debt-ledger.json')
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')).entries : []
let inventory = false
const findings = []
export const setVisualInventory = value => { inventory = value; findings.length = 0 }
export const visualFindings = () => findings
function counted(ruleId, rule) {
  return { ...rule, create(context) {
    const seen = new Map()
    const report = descriptor => {
      const file = relative(root, context.filename ?? context.getFilename()).replaceAll('\\', '/')
      const source = context.sourceCode ?? context.getSourceCode(), node = descriptor.node
      const snippet = node ? source.getText(node).replace(/\s+/g, ' ').trim() : JSON.stringify(descriptor.loc)
      const message = descriptor.messageId ?? descriptor.message
      const fingerprint = createHash('sha256').update(JSON.stringify([file, ruleId, message, snippet])).digest('hex')
      const count = (seen.get(fingerprint) ?? 0) + 1; seen.set(fingerprint, count)
      const allowance = ledger.find(value => value.file === file && value.rule === ruleId && value.fingerprint === fingerprint)
      findings.push({ file, rule: ruleId, message, fingerprint, snippet, count, line: node?.loc?.start.line, registered: !!allowance })
      // Existing exact ESLint line waivers remain owned by ESLint. Suppressing
      // the same report here would make their directive incorrectly "unused".
      const lineWaiver = node?.loc && source.getAllComments().some(comment => comment.value.includes(ruleId)
        && (/eslint-disable-next-line/.test(comment.value) && comment.loc.end.line + 1 === node.loc.start.line
          || /eslint-disable-line/.test(comment.value) && comment.loc.start.line === node.loc.start.line))
      if (inventory || lineWaiver || !allowance || count > allowance.count) context.report(descriptor)
    }
    return rule.create(Object.create(context, { report: { value: report } }))
  } }
}
export const visualA11yPlugin = { ...jsxA11y, rules: Object.fromEntries(Object.entries(jsxA11y.rules).map(([name, rule]) => [name, counted(`jsx-a11y/${name}`, rule)])) }
const plugin = { rules: { 'z-index': counted('theme-contracts/z-index', zIndex), shadows: counted('theme-contracts/shadows', shadows), motion: counted('theme-contracts/motion', transition), roles: counted('theme-contracts/roles', roles) } }
export function visualConfig(files) {
  return { files, plugins: { 'jsx-a11y': visualA11yPlugin, 'theme-contracts': plugin }, rules: { ...jsxA11y.flatConfigs.recommended.rules,
    'theme-contracts/z-index': 'error', 'theme-contracts/motion': 'error', 'theme-contracts/roles': 'error', 'theme-contracts/shadows': ['error', {
      allowedClasses: ['shadow-none', 'shadow-xs', 'shadow-minimal', 'shadow-tinted', 'shadow-thin', 'shadow-middle', 'shadow-strong', 'shadow-panel-focused', 'shadow-modal-small', 'shadow-bottom-border', 'shadow-bottom-border-thin'], allowInlineNone: true,
    }] } }
}
