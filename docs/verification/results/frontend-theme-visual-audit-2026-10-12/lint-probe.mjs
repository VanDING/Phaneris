/** Inspect effective rule coverage and selected real files, without changing code. */
import { ESLint } from 'eslint'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
const root = resolve(import.meta.dirname, '../../../..')
const output = resolve(root, process.argv.find(value => value.startsWith('--output='))?.slice(9) ?? '.cache/frontend-theme-visual-audit-rerun')
mkdirSync(output, { recursive: true })
const targets = {
  'apps/electron': ['src/renderer/components/app-shell/PanelHeader.tsx', 'src/renderer/components/app-shell/SurfaceSlot.tsx',
    'src/renderer/browser-toolbar.tsx', 'src/renderer/components/ui/button.tsx', 'src/renderer/components/ui/sortable-list.tsx',
    'src/renderer/components/app-shell/kanban/TaskEditor.tsx'],
  'packages/ui': ['src/components/chat/TurnCard.tsx', 'src/components/ui/BrowserControls.tsx', 'src/components/trajectory/TrajectoryContextView.tsx'],
}
const data = { ruleCoverage: [], results: [] }
for (const [member, paths] of Object.entries(targets)) {
  const lint = new ESLint({ cwd: resolve(root, member) })
  for (const path of paths) {
    const config = await lint.calculateConfigForFile(resolve(root, member, path))
    data.ruleCoverage.push({ file: `${member}/${path}`, rules: Object.fromEntries(Object.entries(config.rules)
      .filter(([key]) => /craft-styles|jsx-a11y/.test(key))) })
  }
  data.results.push(...(await lint.lintFiles(paths)).map(value => ({ file: value.filePath.slice(root.length + 1),
    errors: value.errorCount, warnings: value.warningCount, messages: value.messages })))
}
const generic = new ESLint({ cwd: root, overrideConfigFile: resolve(root, 'eslint.config.mjs') })
for (const file of ['apps/webui/src/App.tsx', 'apps/viewer/src/App.tsx']) {
  const config = await generic.calculateConfigForFile(resolve(root, file))
  data.ruleCoverage.push({ file, rules: Object.fromEntries(Object.entries(config.rules).filter(([key]) => /craft-styles|jsx-a11y/.test(key))) })
}
writeFileSync(resolve(output, 'lint-data.json'), JSON.stringify(data, null, 2) + '\n')
console.log(JSON.stringify({ inspected: data.ruleCoverage.length, linted: data.results.length,
  errors: data.results.reduce((sum, value) => sum + value.errors, 0), warnings: data.results.reduce((sum, value) => sum + value.warnings, 0),
  styleFindings: data.results.flatMap(value => value.messages.filter(message => message.ruleId?.startsWith('craft-styles/'))).length }, null, 2))
