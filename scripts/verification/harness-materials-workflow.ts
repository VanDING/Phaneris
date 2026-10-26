/** HE03/HE06/HE09–HE12: scenarios fixed before result/capacity changes. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('harness-materials', async evidence => {
  const root = join(evidence.directory, 'workspace'); mkdirSync(root)
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'config')
  const { prepareToolResultView, readCapture, readFileWithEvidence } = await import('../../packages/pi-agent-server/src/tool-result-view')
  const { createReadToolDefinition, detectSupportedImageMimeTypeFromFile } = await import('@earendil-works/pi-coding-agent')
  const reader = createReadToolDefinition(root, { operations: { access, readFile: readFileWithEvidence, detectImageMimeType: detectSupportedImageMimeTypeFromFile } })
  const file = join(root, 'evidence.txt'); writeFileSync(file, 'first\nsecond\nthird\n')
  const checks: string[] = []
  const read = async (input: { path: string; offset?: number; limit?: number }) => {
    const capture = {}
    const result = await readCapture.run(capture, () => reader.execute('read', input, undefined, undefined, {} as never))
    return prepareToolResultView({ result, toolName: 'Read', input, capture, sessionPath: root, budgetChars: 4000 })
  }
  const full = await read({ path: file })
  assert.equal(full.details.phanerisResult.coverage.kind, 'full')
  assert.equal(full.details.phanerisResult.recovery.status, 'inline')
  assert(!existsSync(join(root, 'long_responses')))
  checks.push('HE09 complete small source is inline without a full-file duplicate')
  const first = await read({ path: file, offset: 1, limit: 1 })
  const saved = first.details.phanerisResult.recovery.path!
  writeFileSync(file, 'new source version')
  assert.equal(readFileSync(saved, 'utf8'), 'first\nsecond\nthird\n')
  const remainder = await read({ path: saved, offset: 2, limit: 2 })
  assert.equal(remainder.details.phanerisResult.source.sha256, first.details.phanerisResult.source.sha256)
  checks.push('HE09 ranged source keeps the bytes captured before mutation')
  const rows = Array.from({ length: 2000 }, (_, index) => ({ id: index, amount: index * 7, reference: `row-${index}` }))
  const structuredContent = { rows, nextCursor: 'next-original-page', hasMore: true }
  const image = { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }
  const result = { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }, image], structuredContent }
  const projected = await prepareToolResultView({ result, toolName: 'mcp__fixture__rows', input: {}, sessionPath: root, budgetChars: 4000 })
  const text = projected.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  assert.match(text, /Structured tool-return overview/)
  assert.match(text, /2000/); assert.match(text, /next-original-page/)
  assert.deepEqual(projected.structuredContent, structuredContent)
  assert.deepEqual(projected.content.filter(block => block.type !== 'text'), [image])
  assert.deepEqual(JSON.parse(readFileSync(projected.details.phanerisResult.recovery.canonicalPath!, 'utf8')).structuredContent, structuredContent)
  checks.push('HE10 structural overview retains original paging, canonical rows and media')
  const { prepareInstructions } = await import('../../packages/shared/src/agent/core/task-preparation')
  const instructions = prepareInstructions([{ kind: 'source', path: 'guide.md', text: 'one\ntwo\n' + 'x'.repeat(2000) }], 850)
  assert.equal(instructions[0]!.coverage, 'partial'); assert.equal(instructions[0]!.content, 'one\ntwo\n')
  assert.equal(instructions[0]!.endLine, 2)
  checks.push('HE03 oversized preparation preserves exact whole lines and range identity')
  const { ResultBudget } = await import('../../packages/pi-agent-server/src/request-capacity')
  const calls = [{ id: 'small', weight: 1 }, { id: 'large', weight: 16 }, { id: 'blocked', weight: 1 }]
  const budget = new ResultBudget(calls, 16_000)
  const order: string[] = []
  let originalAllowance = 0
  const large = budget.project('large', async allowance => {
    order.push('large'); assert(allowance > 12_000); originalAllowance = allowance
    return { content: [{ type: 'text', text: 'x'.repeat(10_000) }] }
  })
  await budget.project('small', async () => { order.push('small'); return { content: [{ type: 'text', text: 'ok' }] } })
  await large
  budget.finish('blocked')
  assert.deepEqual(order, ['large', 'small'])
  await new ResultBudget(calls, 16_000).project('large', async allowance => {
    assert.equal(allowance, originalAllowance); return { content: [] }
  })
  checks.push('HE11 deterministic reservations prioritize content without completion-order waits')
  evidence.json('materials.json', { checks, full, first, remainder, projected, instructions })
  evidence.complete(checks, ['Live model quality', 'Visual Office layout', 'Cross-platform packaging'])
  console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
})
