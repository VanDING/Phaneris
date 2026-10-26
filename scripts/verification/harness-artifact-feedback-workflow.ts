/** HE12/HE14: real XLSX -> managed draft -> extraction -> user edit -> revision -> submit. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { createArtifactDraft, inspectArtifact, acquireArtifactLease, submitArtifact, type ArtifactStorageScope } from '../../packages/shared/src/artifacts'
import { renderOfficeArtifactPreview, sessionArtifactContext } from '../../packages/server-core/src/services/artifact-preview'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('harness-artifact-feedback', async evidence => {
  const contentRootPath = join(evidence.directory, 'content'); mkdirSync(contentRootPath)
  const sourcePath = join(contentRootPath, 'report.xlsx')
  const workbook = (amount: number) => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Item', 'Amount'], ['Verified input', amount]]), 'Report')
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  }
  writeFileSync(sourcePath, workbook(42))
  const scope: ArtifactStorageScope = { workspaceRootPath: evidence.directory, workspaceId: 'feedback', contentRootPath, allowedRoots: [contentRootPath] }
  const draft = createArtifactDraft(scope, { sessionId: 'report-task', sourcePath, kind: 'spreadsheet' })
  const leased = acquireArtifactLease(scope, draft.artifact.id, 'agent', undefined, 'report-task')
  const leaseId = leased.artifact.lease!.id
  const inspect = () => inspectArtifact(scope, draft.artifact.id, { sessionId: 'report-task', leaseId })
  const first = await renderOfficeArtifactPreview(scope, inspect())
  const firstPreview = first.artifact.previews.find(preview => preview.revision === first.artifact.draftRevision && preview.kind === 'markdown')!
  assert.match(readFileSync(firstPreview.path!, 'utf8'), /42/)
  const repeated = await renderOfficeArtifactPreview(scope, first)
  assert.equal(repeated, first, 'A known same-version extraction needs no second conversion')
  writeFileSync(first.editablePath!, workbook(84))
  const updated = await renderOfficeArtifactPreview(scope, inspect())
  assert.notEqual(updated.artifact.draftRevision, first.artifact.draftRevision)
  const currentPreview = updated.artifact.previews.find(preview => preview.revision === updated.artifact.draftRevision && preview.kind === 'markdown')!
  assert.match(readFileSync(currentPreview.path!, 'utf8'), /84/)
  assert.match(readFileSync(firstPreview.path!, 'utf8'), /42/)
  const facts = sessionArtifactContext(evidence.directory, 'report-task')
  assert.equal(facts[0]?.revision, updated.artifact.draftRevision)
  assert.equal(facts[0]?.path, updated.editablePath)
  assert.notEqual(facts[0]?.path, sourcePath)
  const submitted = submitArtifact(scope, draft.artifact.id, { sessionId: 'report-task', leaseId, expectedRevision: updated.artifact.draftRevision! })
  assert.equal(submitted.artifact.status, 'ready')
  assert.equal(XLSX.read(readFileSync(sourcePath)).Sheets.Report!.B2.v, 42)
  const checks = ['HE12 current XLSX extraction is accessible as an immutable view', 'HE12 same-version extraction is reused',
    'HE14 external draft edit produces a new revision and matching view', 'HE14 task context exposes the editable draft instead of the final destination',
    'HE12 submission leaves destination acceptance to the user']
  evidence.json('artifact-feedback.json', { checks, first: first.artifact, updated: updated.artifact, submitted: submitted.artifact, facts,
    scope: 'Text/structure verification, not Office visual layout' })
  evidence.complete(checks, ['Live model quality', 'Office visual layout and page rendering', 'Signed packaging'])
  console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
})
