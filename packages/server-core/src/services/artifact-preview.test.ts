import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import {
  getArtifact,
  registerCurrentArtifact,
  type ArtifactStorageScope,
} from '@phaneris/shared/artifacts'
import { renderOfficeArtifactPreview } from './artifact-preview'

const roots: string[] = []

// Load the real, heavy parser stack within a bounded fixture setup. Cold module
// resolution can exceed the default test budget on Windows; conversion assertions
// below keep their default budget and still use the production preview path.
beforeAll(async () => {
  await import('markitdown-js')
}, 60_000)

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Office Artifact previews', () => {
  it('converts a real XLSX revision into an immutable local Markdown preview', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'craft-office-preview-'))
    roots.push(workspaceRootPath)
    const contentRootPath = join(workspaceRootPath, 'content')
    mkdirSync(contentRootPath)
    const sourcePath = join(contentRootPath, 'scores.xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'],
      ['Ada', 98],
    ]), 'Scores')
    writeFileSync(sourcePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))

    const scope: ArtifactStorageScope = {
      workspaceRootPath,
      workspaceId: 'ws-office-preview',
      contentRootPath,
      allowedRoots: [workspaceRootPath],
    }
    const registered = registerCurrentArtifact(scope, {
      sessionId: 'session-office-preview',
      sourcePath,
    })
    const rendered = await renderOfficeArtifactPreview(scope, registered)
    const preview = rendered.artifact.previews.find((candidate) => candidate.kind === 'markdown')

    expect(preview?.revision).toBe(registered.artifact.currentRevision!)
    expect(preview?.path).toEndWith('.md')
    const markdown = readFileSync(preview!.path!, 'utf8')
    expect(markdown).toContain('Name')
    expect(markdown).toContain('Ada')
    expect(getArtifact(scope, registered.artifact.id).artifact.previews).toContainEqual(preview!)
  })
})
