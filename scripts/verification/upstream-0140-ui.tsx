// Real production UI; the IPC replay does not install binaries or execute tools.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import { setupI18n, changeAppLanguage } from '../../packages/shared/src/i18n'
import { PermissionRequest } from '../../apps/electron/src/renderer/components/app-shell/input/structured/PermissionRequest'
import { RtkUpdateDialog, RtkUpdatePrompt, type RtkStatusInfo } from '../../apps/electron/src/renderer/components/RtkUpdateDialog'
import { ModalProvider } from '../../apps/electron/src/renderer/context/ModalContext'
import { Toaster } from 'sonner'
import '../../apps/electron/src/renderer/index.css'

setupI18n([initReactI18next])
const calls: unknown[] = []
const oldStatus: RtkStatusInfo = { installed: true, path: null, version: '0.43.0', outdated: true, minSafeVersion: '0.44.0', foundPath: 'C:/fixture/rtk.exe', updateCommand: 'winget install --id rtk-ai.rtk --exact' }
let mode = 'old'
let preferences: Record<string, unknown> = { name: 'Fixture user', diffViewer: { diffStyle: 'split' } }
Object.assign(window, { verificationCalls: calls, setFixtureRtk: (value: string) => { mode = value } })
window.electronAPI = {
  getRtkEnabled: async () => true,
  readPreferences: async () => {
    calls.push({ action: 'preferences-read' })
    return { content: JSON.stringify(preferences), exists: true, path: 'fixture/preferences.json' }
  },
  writePreferences: async (content: string) => {
    preferences = JSON.parse(content)
    Object.assign(window, { verificationPreferences: preferences })
    calls.push({ action: 'preferences-write', preferences })
    return { success: true }
  },
  getRtkStatus: async (opts: unknown) => {
    calls.push({ action: 'rtk-recheck', opts, mode })
    if (mode === 'error') throw new Error('fixture disconnected')
    if (mode === 'missing') return { ...oldStatus, installed: false, version: null, foundPath: null, outdated: false }
    if (mode === 'updated') return { ...oldStatus, version: '0.44.0', path: oldStatus.foundPath, outdated: false }
    return oldStatus
  },
} as unknown as typeof window.electronAPI

function Fixture() {
  const [canRemember, setCanRemember] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState(oldStatus)
  const [automatic, setAutomatic] = React.useState(false)
  return <div className="p-8 space-y-6 max-w-3xl mx-auto">
    <div className="flex gap-4">
      <button onClick={() => { void changeAppLanguage('en') }}>English</button>
      <button onClick={() => { void changeAppLanguage('zh-Hans') }}>中文</button>
      <button onClick={() => setCanRemember(value => !value)}>Switch scope</button>
      <button onClick={() => { setStatus(oldStatus); setOpen(true) }}>Update RTK</button>
      <button onClick={() => setAutomatic(value => !value)}>Toggle automatic prompt</button>
    </div>
    <div className="h-64" data-testid="permission">
      <PermissionRequest request={{ requestId: 'fixture-permission', toolName: 'Bash', command: canRemember ? 'python Safe.py' : 'git push --force', description: 'Approval scope verification', type: 'bash', canRemember }} onResponse={response => calls.push({ action: 'permission', response })} />
    </div>
    <RtkUpdateDialog open={open} onOpenChange={setOpen} status={status} onStatusChange={setStatus} />
    {automatic && <RtkUpdatePrompt workspaceId="fixture" />}
    <Toaster />
  </div>
}
createRoot(document.getElementById('root')!).render(<ModalProvider><Fixture /></ModalProvider>)
