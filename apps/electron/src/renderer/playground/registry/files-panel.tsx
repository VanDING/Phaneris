/**
 * Playground entry: the session Files panel.
 *
 * Renders the real `FilesPanel` against fixtures instead of a live session so
 * the three views can be inspected (and driven by an E2E script) outside
 * Electron:
 * - Browse: two collapsible roots — working directory + this session (with the
 *   message attachments pinned and de-duplicated against the scanned tree)
 * - Artifacts: one artifact per review state, plus a preview registration
 * - Changed: real Edit/Write tool activities, so the diff style toggle has
 *   actual content to switch
 *
 * The fixture session + artifacts are seeded into the same jotai atoms the app
 * uses, and the `window.electronAPI` calls the panel makes are patched here
 * (the shared playground mock returns empty file lists).
 */

import * as React from 'react'
import type { ComponentEntry } from './types'
import type { ResolvedArtifact, ArtifactStatus, ArtifactDescriptor } from '@phaneris/shared/artifacts/browser'
import type { SessionFile, StoredAttachment } from '../../../shared/types'
import { useSetAtom } from 'jotai'
import { FilesPanel } from '@/components/content-panels/FilesPanel'
import { ConfirmDialogHost } from '@/components/ConfirmDialogHost'
import { ModalProvider } from '@/context/ModalContext'
import { lastActiveSessionIdAtom } from '@/atoms/active-session'
import { loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { filesPanelViewAtom } from '@/atoms/content-panel-ui'
import { ensureMockElectronAPI } from '../mock-utils'

const SESSION_ID = 'files-panel-demo'
const WORKSPACE_ID = 'playground-workspace'
const WORK_DIR = '/mock/projects/Phaneris'
const SESSION_DIR = '/mock/workspaces/playground-workspace/sessions/files-panel-demo'

// ============================================================================
// File fixtures
// ============================================================================

function dir(name: string, path: string, children: SessionFile[]): SessionFile {
  return { name, path, type: 'directory', children }
}

function file(name: string, path: string, size = 2048): SessionFile {
  return { name, path, type: 'file', size }
}

const README = file('README.md', `${WORK_DIR}/README.md`, 12_400)
const PACKAGE_JSON = file('package.json', `${WORK_DIR}/package.json`, 3_100)
const INDEX_TS = file('index.ts', `${WORK_DIR}/packages/ui/src/index.ts`, 8_800)
const BUTTON_TSX = file('Button.tsx', `${WORK_DIR}/packages/ui/src/Button.tsx`, 5_600)
const APP_TSX = file('App.tsx', `${WORK_DIR}/apps/electron/src/renderer/App.tsx`, 61_000)

const WORKING_TREE: SessionFile[] = [
  dir('apps', `${WORK_DIR}/apps`, [
    dir('electron', `${WORK_DIR}/apps/electron`, [
      dir('src', `${WORK_DIR}/apps/electron/src`, [APP_TSX]),
    ]),
  ]),
  dir('packages', `${WORK_DIR}/packages`, [
    dir('ui', `${WORK_DIR}/packages/ui`, [
      dir('src', `${WORK_DIR}/packages/ui/src`, [BUTTON_TSX, INDEX_TS]),
    ]),
  ]),
  PACKAGE_JSON,
  README,
]

const ATTACHMENT_PDF: StoredAttachment = {
  id: 'att-pdf',
  type: 'pdf',
  name: '需求说明.pdf',
  mimeType: 'application/pdf',
  size: 240_000,
  storedPath: `${SESSION_DIR}/attachments/9f1c_需求说明.pdf`,
}
const ATTACHMENT_IMAGE: StoredAttachment = {
  id: 'att-image',
  type: 'image',
  name: '界面草图.png',
  mimeType: 'image/png',
  size: 88_000,
  storedPath: `${SESSION_DIR}/attachments/4b02_界面草图.png`,
}

const SESSION_TREE: SessionFile[] = [
  dir('attachments', `${SESSION_DIR}/attachments`, [
    file('9f1c_需求说明.pdf', ATTACHMENT_PDF.storedPath, ATTACHMENT_PDF.size),
    file('4b02_界面草图.png', ATTACHMENT_IMAGE.storedPath, ATTACHMENT_IMAGE.size),
    // Thumbnail/derivative files live beside their source and must NOT be
    // listed as pinned attachments, only inside this folder.
    file('9f1c_thumb.png', `${SESSION_DIR}/attachments/9f1c_thumb.png`, 18_000),
    file('9f1c_需求说明.md', `${SESSION_DIR}/attachments/9f1c_需求说明.md`, 6_400),
  ]),
  dir('data', `${SESSION_DIR}/data`, [file('snapshot.json', `${SESSION_DIR}/data/snapshot.json`, 9_200)]),
  dir('downloads', `${SESSION_DIR}/downloads`, [file('quarterly.xlsx', `${SESSION_DIR}/downloads/quarterly.xlsx`, 40_000)]),
  dir('plans', `${SESSION_DIR}/plans`, [file('plan.md', `${SESSION_DIR}/plans/plan.md`, 3_400)]),
]

// ============================================================================
// Artifact fixtures — one per review state
// ============================================================================

function artifact(
  id: string,
  title: string,
  status: ArtifactStatus,
  sourcePath: string,
  updatedAt: number,
  options: { kind?: ArtifactDescriptor['kind']; mimeType?: string; model?: string } = {},
): ResolvedArtifact {
  const kind = options.kind ?? 'document'
  const mimeType = options.mimeType ?? 'text/markdown'
  const descriptor: ArtifactDescriptor = {
    id,
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID,
    title,
    kind,
    engineId: 'native-file',
    sourcePath,
    mimeType,
    baseRevision: status === 'draft' ? null : 'a'.repeat(64),
    currentRevision: status === 'draft' ? null : 'a'.repeat(64),
    draftRevision: status === 'draft' ? 'b'.repeat(64) : null,
    status,
    capabilities: { preview: true, inspect: true, edit: status === 'draft', materialize: false },
    previews: [{ id: 'source', revision: 'a'.repeat(64), kind: 'markdown', mimeType }],
    deliverables: [{ id: 'source', revision: 'a'.repeat(64), path: sourcePath, mimeType }],
    revisions: [{
      id: 'a'.repeat(64),
      contentHash: 'a'.repeat(64),
      size: 4_200,
      createdAt: updatedAt - 60_000,
      origin: 'create',
    }],
    provenance: { origin: 'generated', provider: 'Anthropic', model: options.model ?? 'claude-sonnet-5', createdAt: updatedAt - 60_000 },
    createdAt: updatedAt - 60_000,
    updatedAt,
  }
  return {
    artifact: descriptor,
    activePath: `${WORK_DIR}/reports/${title}`,
    editablePath: status === 'draft' ? `${WORK_DIR}/.artifacts/${id}/draft.md` : null,
  }
}

const NOW = Date.now()

let artifactFixtures: ResolvedArtifact[] = [
  artifact('art-ready', 'release-notes.md', 'ready', `${WORK_DIR}/reports/release-notes.md`, NOW),
  artifact('art-draft', 'migration-guide.md', 'draft', `${WORK_DIR}/reports/migration-guide.md`, NOW - 60_000),
  artifact('art-conflict', 'changelog.md', 'conflict', `${WORK_DIR}/reports/changelog.md`, NOW - 120_000),
  artifact('art-accepted', 'quarterly-summary.pdf', 'accepted', `${WORK_DIR}/reports/quarterly-summary.pdf`, NOW - 180_000, { kind: 'pdf', mimeType: 'application/pdf' }),
  artifact('art-current', 'README.md', 'current', README.path, NOW - 240_000, { kind: 'text', mimeType: 'text/markdown' }),
]

// ============================================================================
// electronAPI patches
// ============================================================================

const listeners = new Set<(sessionId: string, scope?: string) => void>()

function patchElectronApi(): void {
  ensureMockElectronAPI()
  const api = window.electronAPI as unknown as Record<string, unknown>

  api.getSessionFiles = async (_sessionId: string, scope = 'session') => (
    scope === 'working' ? structuredClone(WORKING_TREE) : structuredClone(SESSION_TREE)
  )
  api.watchSessionFiles = async () => {}
  api.unwatchSessionFiles = async () => {}
  api.onSessionFilesChanged = (callback: (sessionId: string, scope?: string) => void) => {
    listeners.add(callback)
    return () => { listeners.delete(callback) }
  }
  api.onReconnected = (callback: () => void) => {
    // Reconnect is irrelevant to this demo; keep the subscription API intact.
    void callback
    return () => {}
  }
  api.showInFolder = () => {}
  api.openFile = () => {}

  api.listArtifacts = async () => structuredClone(artifactFixtures)
  api.acceptArtifact = async (_workspaceId: string, artifactId: string) => {
    const target = artifactFixtures.find((entry) => entry.artifact.id === artifactId)
    if (target) {
      target.artifact.status = 'accepted'
      target.artifact.updatedAt = Date.now()
    }
    return { artifact: structuredClone(target!), accepted: true }
  }
  api.discardArtifact = async (_workspaceId: string, artifactId: string) => {
    const target = artifactFixtures.find((entry) => entry.artifact.id === artifactId)
    if (target) {
      target.artifact.status = 'discarded'
      target.artifact.updatedAt = Date.now()
    }
    return structuredClone(target!)
  }
  api.reviseArtifact = async (_workspaceId: string, artifactId: string) => {
    const target = artifactFixtures.find((entry) => entry.artifact.id === artifactId)
    if (target) {
      target.artifact.status = 'draft'
      target.artifact.updatedAt = Date.now()
    }
    return structuredClone(target!)
  }
  api.onArtifactsChanged = () => () => {}

  // Diff viewer preferences round-trip through a local record so the style
  // toggle survives a reload in the E2E run. localStorage stands in for
  // ~/.phaneris/preferences.json, which only exists under Electron.
  api.readPreferences = async () => ({
    content: JSON.stringify({
      // eslint-disable-next-line craft-agent/no-localstorage -- playground stands in for the Electron preferences file
      diffViewer: JSON.parse(window.localStorage.getItem('playground-diff-viewer') ?? '{"diffStyle":"unified","disableBackground":false}'),
    }),
  })
  api.writePreferences = async (content: string) => {
    try {
      const parsed = JSON.parse(content)
      if (parsed.diffViewer) {
        // eslint-disable-next-line craft-agent/no-localstorage -- playground stands in for the Electron preferences file
        window.localStorage.setItem('playground-diff-viewer', JSON.stringify(parsed.diffViewer))
      }
    } catch {
      // Ignore malformed payloads; the demo only needs the diffViewer scope.
    }
  }
}

/** Re-emit a files-changed event so a test can prove the watcher path works. */
export function emitPlaygroundFilesChanged(scope: 'session' | 'working' = 'session'): void {
  for (const listener of listeners) listener(SESSION_ID, scope)
}

// ============================================================================
// Seeding
// ============================================================================

/**
 * Seed everything FilesPanel reads: the active session, its metadata (working
 * directory), the loaded-session flag, and a transcript carrying the two
 * attachment fixtures.
 */
function useSeededSession(): string {
  const setActiveSessionId = useSetAtom(lastActiveSessionIdAtom)
  const setSessionMetaMap = useSetAtom(sessionMetaMapAtom)
  const setLoadedSessions = useSetAtom(loadedSessionsAtom)
  const seedSession = useSetAtom(sessionAtomFamily(SESSION_ID))
  const seeded = React.useRef(false)

  if (!seeded.current) {
    seeded.current = true
    setActiveSessionId(SESSION_ID)
    setSessionMetaMap(previous => {
      const next = new Map(previous)
      next.set(SESSION_ID, {
        id: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Files panel demo',
        workingDirectory: WORK_DIR,
        createdAt: NOW - 3_600_000,
        lastMessageAt: NOW,
        messageCount: 2,
      })
      return next
    })
    setLoadedSessions(previous => new Set([...previous, SESSION_ID]))
    seedSession({
      id: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Files panel demo',
      createdAt: NOW - 3_600_000,
      lastUsedAt: NOW,
      messages: [
        { id: 'msg-1', role: 'user', content: '请看一下这两份材料', timestamp: NOW - 120_000, attachments: [ATTACHMENT_PDF, ATTACHMENT_IMAGE] },
        // Tool messages are what the Changed view derives its diffs from. The
        // three shapes cover the cases the style toggle has to handle:
        // an existing-file edit (both sides), a unified-diff edit, and a new
        // file whose diff has no deletions.
        {
          id: 'tool-edit-1',
          role: 'tool',
          content: 'Edited App.tsx',
          timestamp: NOW - 110_000,
          toolName: 'Edit',
          toolUseId: 'toolu_edit_1',
          toolStatus: 'completed',
          toolResult: 'ok',
          toolInput: {
            file_path: APP_TSX.path,
            old_string: 'const greeting = "hello"',
            new_string: 'const greeting = "hello, Phaneris"',
          },
        },
        {
          id: 'tool-edit-2',
          role: 'tool',
          content: 'Edited Button.tsx',
          timestamp: NOW - 100_000,
          toolName: 'Edit',
          toolUseId: 'toolu_edit_2',
          toolStatus: 'completed',
          toolResult: 'ok',
          toolInput: {
            changes: [{
              path: BUTTON_TSX.path,
              kind: 'update',
              diff: [
                `--- a/${BUTTON_TSX.path}`,
                `+++ b/${BUTTON_TSX.path}`,
                '@@ -1,3 +1,3 @@',
                ' export function Button() {',
                '-  return <button className="btn">',
                '+  return <button className="btn btn-primary">',
                ' }',
              ].join('\n'),
            }],
          },
        },
        {
          id: 'tool-write-1',
          role: 'tool',
          content: 'Wrote release-notes.md',
          timestamp: NOW - 90_000,
          toolName: 'Write',
          toolUseId: 'toolu_write_1',
          toolStatus: 'completed',
          toolResult: 'ok',
          toolInput: {
            file_path: `${WORK_DIR}/reports/release-notes.md`,
            content: '# Release notes\n\n- New Files panel\n',
          },
        },
      ],
    } as never)
  }

  return SESSION_ID
}

function FilesPanelPreview() {
  const sessionId = useSeededSession()
  const setView = useSetAtom(filesPanelViewAtom)
  const [view, setLocalView] = React.useState<'browse' | 'artifacts' | 'changed'>('browse')

  // Keep the shared atom in sync so a test can assert the restored view.
  React.useEffect(() => { setView(view) }, [setView, view])

  return (
    <ModalProvider>
      <div className="h-[760px] w-full overflow-hidden rounded-xl border border-border/60 bg-background">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          {(['browse', 'artifacts', 'changed'] as const).map(next => (
            <button
              key={next}
              type="button"
              data-testid={`seed-view-${next}`}
              onClick={() => setLocalView(next)}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.05]"
            >
              {next}
            </button>
          ))}
        </div>
        <div className="h-[calc(100%-41px)]">
          <FilesPanel sessionId={sessionId} />
          {/* The app mounts this once at the root inside ModalProvider; the
              playground page does not, so discard confirmations need it. */}
          <ConfirmDialogHost />
        </div>
      </div>
    </ModalProvider>
  )
}

patchElectronApi()

export const filesPanelComponents: ComponentEntry[] = [
  {
    id: 'files-panel',
    name: 'Files Panel',
    category: 'Panels',
    description: 'Session file workbench: Browse / Artifacts / Changed, with pinned attachments and the diff style toggle.',
    component: FilesPanelPreview,
    props: [],
    layout: 'top',
  },
]
