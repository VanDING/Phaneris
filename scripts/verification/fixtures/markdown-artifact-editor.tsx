import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { MarkdownArtifactEditor } from '../../../apps/electron/src/renderer/components/content-panels/MarkdownArtifactEditor'
import { ArtifactWorkbench } from '../../../apps/electron/src/renderer/components/content-panels/ArtifactWorkbench'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import { Toaster } from 'sonner'
import '../../../apps/electron/src/renderer/index.css'
await i18next.init({ lng: 'en', resources: { en: { translation: { common: { save: 'Save', cancel: 'Cancel' }, artifact: { visualEditor: 'Visual', sourceEditor: 'Source', sourceRequired: 'Source required to preserve this document', edit: 'Edit', submit: 'Submit', accept: 'Accept', status: { draft: 'draft', ready: 'ready', accepted: 'accepted', conflict: 'conflict' } } } } } })
const rpc = async (method: string, args: unknown[] = []) => {
  const response = await fetch('/__artifact-fixture', { method: 'POST', body: JSON.stringify({ method, args }) })
  const body = await response.json(); if (body.error) throw new Error(body.error); return body.result
}
Object.assign(window, { artifactFixture: rpc, electronAPI: {
  listArtifacts: () => rpc('list'), onArtifactsChanged: () => () => {},
  acquireArtifactLease: (_ws: string, id: string) => rpc('acquire', [id]),
  releaseArtifactLease: (_ws: string, id: string, lease: string) => rpc('release', [id, lease]),
  applyArtifact: (_ws: string, id: string, input: unknown) => rpc('apply', [id, input]),
  submitArtifact: (_ws: string, id: string, revision: string, lease: string) => rpc('submit', [id, revision, lease]),
  acceptArtifact: (_ws: string, id: string) => rpc('accept', [id]), readFile: (path: string) => rpc('read', [path]),
} })
function Fixture() {
  const [text, setText] = React.useState('# Fixture\n\nOriginal **bold** text.\n')
  const [artifactId, setArtifactId] = React.useState<string>()
  const open = async (name: string) => { const { artifact } = await rpc('create', [name]); Object.assign(window, { artifactId: artifact.id }); setArtifactId(artifact.id) }
  return <I18nextProvider i18n={i18next}><button id="complex" onClick={() => setText('<!-- preserve comment -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n')}>Complex fixture</button>
    <button id="workbench" onClick={() => void open('normal')}>Workbench</button><button id="conflict" onClick={() => void open('conflict')}>Conflict</button>
    <button id="mixed" onClick={() => void open('mixed')}>Mixed document</button>
    <Toaster /><div style={{ height: 660 }}>
    {artifactId ? <AppShellProvider value={{ activeWorkspaceId: 'fixture', onOpenFile() {}, onOpenUrl() {}, isCompactMode: false } as unknown as AppShellContextType}><ArtifactWorkbench key={artifactId} artifactId={artifactId} /></AppShellProvider> : <>
    <MarkdownArtifactEditor key={text.startsWith('<!--') ? 'complex' : 'plain'} value={text} onChange={setText} />
    <pre id="output">{text}</pre></>}</div></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
