import {
  putArtifactTextPreview,
  listArtifacts,
  resolveFileFormat,
  type ArtifactStorageScope,
  type ResolvedArtifact,
} from '@phaneris/shared/artifacts'
import { existsSync } from 'node:fs'

/** Current product projection; the store remains the sole artifact owner. */
export function sessionArtifactContext(workspaceRootPath: string, sessionId: string) {
  return listArtifacts({ workspaceRootPath }, { sessionId }).map(current => {
    const artifact = current.artifact
    return { id: artifact.id, title: artifact.title, status: artifact.status,
      revision: artifact.draftRevision ?? artifact.currentRevision, path: current.editablePath ?? current.activePath ?? undefined }
  })
}

/**
 * Create a distributable, dependency-local human preview for standard Office
 * artifacts. MarkItDown is already shipped with PiAgent and does not require
 * LibreOffice/ONLYOFFICE or a network service.
 */
export async function renderOfficeArtifactPreview(
  scope: ArtifactStorageScope,
  resolved: ResolvedArtifact,
): Promise<ResolvedArtifact> {
  const isOfficeBinary = resolveFileFormat(resolved.artifact.sourcePath, resolved.artifact.mimeType).preview === 'office-markdown'
  if (!isOfficeBinary) return resolved
  const revision = resolved.artifact.draftRevision ?? resolved.artifact.currentRevision
  if (!revision || !resolved.activePath) {
    throw new Error(`Office artifact ${resolved.artifact.id} has no renderable revision`)
  }
  if (resolved.artifact.previews.some(preview => preview.revision === revision && preview.kind === 'markdown' && preview.path && existsSync(preview.path))) return resolved
  // markitdown-js and its parser stack are heavy; load them only when an
  // Office artifact is actually previewed.
  const { MarkItDown } = await import('markitdown-js')
  const converter = new MarkItDown()
  const result = await converter.convert(resolved.activePath)
  const markdown = result?.textContent?.trim() || '_No previewable text content._'
  return putArtifactTextPreview(scope, resolved.artifact.id, {
    revision,
    text: `${markdown}\n`,
    kind: 'markdown',
  })
}
