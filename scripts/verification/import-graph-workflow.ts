#!/usr/bin/env bun
/** R03/C09: type erasure must not hide real imports or invent a browser execution path. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanImportGraph } from '../lib/import-graph'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('import-graph', async run => {
  const root = join(run.directory, 'fixture'), src = join(root, 'packages/example/src')
  mkdirSync(src, { recursive: true }); mkdirSync(join(root, 'apps'), { recursive: true })
  writeFileSync(join(root, 'packages/example/package.json'), JSON.stringify({ name: 'example', exports: { '.': './src/value.ts' } }))
  writeFileSync(join(src, 'value.ts'), 'export interface T { value: string }; export const value = 1')
  const cases = [
    ['type-import', "import type { T } from './value';", true],
    ['type-specifier', "import { type T } from './value';", true],
    ['type-export', "export type { T } from './value';", true],
    ['type-export-specifier', "export { type T } from './value';", true],
    ['mixed-specifier', "import { type T, value } from './value';", false],
    ['side-effect', "import './value';", false],
    ['dynamic-value', "void import('./value');", false],
  ] as const
  for (const [id, text] of cases) writeFileSync(join(src, `${id}.ts`), text)
  const scan = scanImportGraph(root)
  for (const [id, , typeOnly] of cases) {
    const edge = scan.graph.get(join(src, `${id}.ts`))![0]!
    assert.equal(edge.typeOnly, typeOnly, id)
  }
  run.json('import-graph.json', { cases, edges: [...scan.graph] })
  run.complete(cases.map(([id]) => id), [])
})
