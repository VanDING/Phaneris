import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { CredentialsStep } from '@/components/onboarding/CredentialsStep'
import { EmptyStateHint } from '@/components/chat/EmptyStateHint'
import { CompactModelSelector } from '@/components/app-shell/input/CompactModelSelector'
import { AppShellProvider } from '@/context/AppShellContext'
import { TooltipProvider, TurnCard } from '@phaneris/ui'
import '@/index.css'

declare global { interface Window {
  componentRecords: Array<{ action: string; values?: unknown[] }>
  componentState(patch: { validating?: boolean; error?: boolean; unavailable?: boolean }): void
} }
window.componentRecords = []
const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: {
  ...en, 'hints.summarizeGmail': 'Use {source}, {source:MailProvider}, {file:screenshot}, {folder} and {skill:Review} in order.',
} } } })
const connections = ['alpha', 'beta'].map(slug => ({ slug, name: `${slug} connection`, providerType: 'pi_compat', authType: 'api_key',
  isAuthenticated: true, models: [{ id: `${slug}-one`, name: `${slug} model one` }, { id: `${slug}-two`, name: `${slug} model two` }],
  defaultModel: `${slug}-one`, createdAt: 1, updatedAt: 1 }))
function Fixture() {
  const [waiting, setWaiting] = React.useState(false)
  const [settings, setSettings] = React.useState({ validating: false, error: false, unavailable: false })
  const [selection, setSelection] = React.useState({ model: 'alpha-one', connection: 'alpha' })
  const [expanded, setExpanded] = React.useState(true)
  window.componentState = patch => setSettings(value => ({ ...value, ...patch }))
  return <main className="p-8 space-y-8 bg-background text-foreground">
    <section data-testid="oauth"><CredentialsStep apiSetupMethod="claude_oauth" status={settings.validating ? 'validating' : settings.error ? 'error' : 'idle'}
      errorMessage="Recoverable fixture error" isWaitingForCode={waiting} onSubmit={() => {}} onBack={() => {}}
      onStartOAuth={() => { window.componentRecords.push({ action: 'start' }); setWaiting(true) }}
      onCancelOAuth={() => { window.componentRecords.push({ action: 'cancel' }); setWaiting(false) }}
      onSubmitAuthCode={code => window.componentRecords.push({ action: 'code', values: [code] })} /></section>
    <section data-testid="hint"><EmptyStateHint hintIndex={0} /></section>
    <section data-testid="model"><CompactModelSelector currentModel={selection.model} currentConnection={selection.connection}
      isEmptySession connectionUnavailable={settings.unavailable} onModelChange={(model, connection) => {
        window.componentRecords.push({ action: 'model', values: [model, connection] }); setSelection({ model, connection: connection! })
      }} /></section>
    <section data-testid="tree"><button onClick={() => setExpanded(value => !value)}>Toggle activities</button>
      <TurnCard turnId="fixture" activities={[0, 1, 2, 1].map((depth, index) => ({ id: `tool-${index}`, type: 'tool', status: 'completed',
        toolName: 'Read', toolInput: { file_path: `/fixture/level-${index}.ts` }, intent: `Fixture activity ${index}`, depth, timestamp: index + 1 }))}
        isStreaming={false} isComplete isExpanded={expanded} onExpandedChange={setExpanded} /></section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Provider><I18nextProvider i18n={i18n}><TooltipProvider>
  <AppShellProvider value={{ llmConnections: connections, workspaceDefaultLlmConnection: 'alpha', workspaces: [], sessionStatuses: [] } as never}>
    <Fixture />
  </AppShellProvider></TooltipProvider></I18nextProvider></Provider>)
