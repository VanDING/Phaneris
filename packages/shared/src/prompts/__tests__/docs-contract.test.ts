import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createLLMTool } from '../../agent/llm-tool.ts'
import { PermissionsConfigSchema } from '../../agent/mode-types.ts'
import { ScriptActionSchema } from '../../automations/schemas.ts'
import { DOC_REFS } from '../../docs/index.ts'
import { ArtifactCreateSchema, SESSION_TOOL_NAMES } from '../../../../session-tools-core/src/tool-defs.ts'

const docsRoot = resolve(import.meta.dir, '../../../../../apps/electron/resources/docs')
const readDoc = (name: string) => readFileSync(join(docsRoot, name), 'utf8')
const jsonExamples = (markdown: string): unknown[] =>
  [...markdown.matchAll(/^```json\r?\n([\s\S]*?)^```/gm)].map(match => JSON.parse(match[1]!))

describe('bundled documentation contracts', () => {
  it('resolves every registered guide and relative Markdown guide link', () => {
    for (const ref of Object.values(DOC_REFS)) {
      if (!ref.endsWith('.md')) continue
      expect(existsSync(join(docsRoot, ref.split('/').at(-1)!))).toBe(true)
    }
    for (const file of readdirSync(docsRoot).filter(name => name.endsWith('.md'))) {
      for (const link of readDoc(file).matchAll(/\]\(\.\/([^\s)#]+\.md)(?:#[^)]*)?\)/g)) {
        expect(existsSync(join(docsRoot, link[1]!))).toBe(true)
      }
    }
  })

  it('keeps the call_llm parameter table aligned with the actual tool schema', () => {
    const tool = createLLMTool({ sessionId: 'docs-contract', getQueryFn: () => undefined })
    const section = readDoc('llm-tool.md').split('## Parameters')[1]!.split('## Attachments')[0]!
    const names = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]!)
    expect(names.sort()).toEqual(Object.keys(tool.inputSchema).sort())
  })

  it('validates every permissions JSON example against the live schema', () => {
    const examples = jsonExamples(readDoc('permissions.md'))
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      expect(PermissionsConfigSchema.strict().safeParse(example).success).toBe(true)
      // Compatibility acceptance is not enforcement; never teach a no-op deny rule.
      expect(Object.hasOwn(example as object, 'blockedTools')).toBe(false)
    }
  })

  it('validates the Artifact creation example and referenced Artifact tools', () => {
    const doc = readDoc('artifacts.md')
    const examples = jsonExamples(doc)
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      expect(ArtifactCreateSchema.strict().safeParse(example).success).toBe(true)
    }
    for (const match of doc.matchAll(/`(artifact_\w+)`/g)) {
      expect(SESSION_TOOL_NAMES.has(match[1]!)).toBe(true)
    }
  })

  it('validates the documented script action against the runtime action schema', () => {
    const section = readDoc('automations.md').split('### Script Actions')[1]!.split('### Webhook Actions')[0]!
    const examples = jsonExamples(section)
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      expect(ScriptActionSchema.strict().safeParse(example).success).toBe(true)
    }
  })
})
