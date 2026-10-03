import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSetAtom } from 'jotai'
import { initReactI18next } from 'react-i18next'
import { setupI18n, changeAppLanguage } from '../../packages/shared/src/i18n'
import { DEFAULT_DECISION_LAYER_SETTINGS } from '../../packages/shared/src/decisions/settings'
import { DECISION_PROVIDER_PRESETS } from '../../packages/shared/src/decisions/providers'
import AiSettingsPage from '../../apps/electron/src/renderer/pages/settings/AiSettingsPage'
import { CompactPermissionModeSelector } from '../../apps/electron/src/renderer/components/app-shell/input/CompactPermissionModeSelector'
import { PermissionRequest } from '../../apps/electron/src/renderer/components/app-shell/input/structured/PermissionRequest'
import { FreeFormInput } from '../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput'
import { EscapeInterruptProvider } from '../../apps/electron/src/renderer/context/EscapeInterruptContext'
import { guardedModeAvailableAtom } from '../../apps/electron/src/renderer/atoms/permission-modes'
import { AppShellProvider } from '../../apps/electron/src/renderer/context/AppShellContext'
import { ModalProvider } from '../../apps/electron/src/renderer/context/ModalContext'
import { TooltipProvider } from '@phaneris/ui'
import '../../apps/electron/src/renderer/index.css'
setupI18n([initReactI18next])
const calls: any[] = []
let settings = { ...DEFAULT_DECISION_LAYER_SETTINGS, enabled: true, provider: 'custom' as const, features: { ...DEFAULT_DECISION_LAYER_SETTINGS.features } }
const status = () => ({ settings, presets: Object.values(DECISION_PROVIDER_PRESETS), providersWithKey: [], reusableConnections: [], hasKey: false })
Object.assign(window, { verificationCalls: calls })
window.electronAPI = new Proxy({
  checkGitBash: async () => ({ platform: 'win32', found: true, path: 'fixture/git-bash' }),
  getDecisionLayerStatus: async () => status(),
  setDecisionLayerSettings: async (patch: any) => { calls.push({ action: 'settings', patch }); settings = { ...settings, ...patch, features: { ...settings.features, ...patch.features } }; return settings },
  getDefaults: async () => ({ appDefaults: {}, workspaceDefaults: {} }),
  getWorkspaces: async () => [], getDefaultThinkingLevel: async () => 'max', getContextPolicy: async () => 'compact',
  getExtendedPromptCache: async () => false, getPromptCacheWarming: async () => false,
  getAppDefaults: async () => ({}), getWorkspaceSettings: async () => ({}),
  getCredentialHealth: async () => ({ healthy: true, issues: [] }),
  getRtkStatus: async () => ({ installed: false }), getRtkEnabled: async () => false,
  getNetworkProxySettings: async () => ({ mode: 'system' }), getPiAuthProviders: async () => [],
}, { get: (target, key) => key in target ? target[key as keyof typeof target] : async () => undefined }) as any
function Fixture() {
  const [mode, setMode] = React.useState<'ask' | 'guarded' | 'safe' | 'allow-all'>('ask')
  const available = useSetAtom(guardedModeAvailableAtom)
  return <div>
    <div className="p-4 flex gap-6">
      <button onClick={() => void changeAppLanguage('en')}>English</button>
      <button onClick={() => void changeAppLanguage('zh-Hans')}>中文</button>
      <button onClick={() => available(true)}>Enable Guarded availability</button>
      <button onClick={() => window.dispatchEvent(new CustomEvent('craft:approve-plan', { detail: { sessionId: 'plan-fixture', planPath: '/fixture/plan.md', includeDraftInput: false } }))}>Approve fixture plan</button>
      <button onClick={() => window.dispatchEvent(new CustomEvent('craft:approve-plan-with-compact', { detail: { sessionId: 'plan-fixture', planPath: '/fixture/plan.md', includeDraftInput: false } }))}>Approve fixture plan with compact</button>
      <div data-testid="modes"><CompactPermissionModeSelector permissionMode={mode} onPermissionModeChange={value => { setMode(value); calls.push({ action: 'mode', value }) }} /></div>
    </div>
    <div className="mx-4 h-60" data-testid="risks"><PermissionRequest request={{ requestId: 'guarded', toolName: 'Bash', type: 'bash', command: 'git push origin HEAD', description: 'Guarded approval', risks: ['publishes', 'sends'], canRemember: false }} onResponse={response => calls.push({ action: 'approval', response })} /></div>
    <div className="mx-4" data-testid="plan-input"><EscapeInterruptProvider><FreeFormInput sessionId="plan-fixture" currentModel="pi/gpt-5-mini" permissionMode="safe" previousPermissionMode="guarded"
      onPermissionModeChange={value => calls.push({ action: 'plan-mode', value })} onSubmit={text => calls.push({ action: 'plan-submit', text })} /></EscapeInterruptProvider></div>
    <div className="h-[900px]" data-testid="settings"><AiSettingsPage /></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<Provider><TooltipProvider><ModalProvider><AppShellProvider value={{ workspaces: [], llmConnections: [], activeWorkspaceId: null, refreshLlmConnections: async () => {} } as any}><Fixture /></AppShellProvider></ModalProvider></TooltipProvider></Provider>)
