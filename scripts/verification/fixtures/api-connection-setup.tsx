/** Shipped forms and wizard; only the desktop transport is bridged to a local host. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { TooltipProvider } from '@phaneris/ui'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { DEFAULT_THEME_FILE } from '@config/theme'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { ModalProvider } from '@/context/ModalContext'
import { ApiKeyInput, type ApiKeySubmitData } from '@/components/apisetup/ApiKeyInput'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { useOnboarding } from '@/hooks/useOnboarding'
import { UtilityModelSettings } from '@/pages/settings/UtilityModelSettings'
import { CompactionThresholdSetting } from '@/components/settings/CompactionThresholdSetting'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'
import type { ElectronAPI, LlmConnectionWithStatus } from '../../../apps/electron/src/shared/types'
import '@/index.css'

const params = new URLSearchParams(location.search)
const host = params.get('host')!
const view = params.get('view') ?? 'wizard'
const mode = params.get('mode') === 'dark' ? 'dark' : 'light'
const language = params.get('lang') ?? 'en'
const calls: Array<{ method: string; args: unknown[] }> = []
const submissions: ApiKeySubmitData[] = []
const rpc = async (method: string, args: unknown[] = []) => {
  const response = await fetch(`${host}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result
}
const local: Record<string, (...args: unknown[]) => unknown> = {
  checkGitBash: () => ({ platform: 'win32', found: true }),
  getThemePreferences: () => ({ mode, colorTheme: 'default', font: 'theme' }),
  loadPresetTheme: () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: () => mode === 'dark', getWorkspaceColorTheme: () => null,
  clearClaudeOAuthState: () => null, getLogoUrl: () => null,
  getPiProviderModels: () => { throw new Error('The API form must not load a model catalog') },
}
Object.assign(window, { electronAPI: new Proxy({}, { get: (_target, method: string) => {
  if (method.startsWith('on')) return () => () => {}
  return async (...args: unknown[]) => {
    calls.push({ method, args })
    return method in local ? local[method]!(...args) : rpc(method, args)
  }
} }) as ElectronAPI })
const i18n = createInstance()
await i18n.init({ lng: language, keySeparator: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })

function Fixture() {
  const theme = useTheme()
  const [connections, setConnections] = React.useState<LlmConnectionWithStatus[]>([])
  const refresh = async () => setConnections(await rpc('snapshot'))
  const onboarding = useOnboarding({ onComplete: () => onboarding.reset(), onConfigSaved: () => { void refresh() }, existingSlugs: new Set(connections.map(c => c.slug)) })
  React.useEffect(() => { void refresh() }, [])
  const initialValues = React.useMemo(() => params.get('edit') ? {
    apiKey: 'stored-key', activePreset: 'kimi-coding', connectionDefaultModel: 'pi/kimi-main',
    utilityModel: 'pi/kimi-small', models: ['pi/kimi-main', 'pi/kimi-small', 'pi/off-catalog'],
  } : undefined, [])
  React.useEffect(() => {
    Object.assign(window, { apiConnectionFixture: { ready: theme.themeLoadStatus === 'ready', calls, submissions, connections, rpc } })
  })
  if (view === 'form') return <div className="max-w-xl p-8">
    <ApiKeyInput status="idle" providerType="pi_api_key" initialValues={initialValues} onSubmit={data => submissions.push(data)} />
    <button type="submit" form="api-key-form">Submit</button>
  </div>
  if (view === 'settings') return <div className="mx-auto max-w-2xl space-y-8 p-8">
    <UtilityModelSettings connections={connections} onSaved={refresh} />
    <CompactionThresholdSetting />
    {[
      { name: 'DeepSeek', providerType: 'pi', piAuthProvider: 'deepseek', defaultModel: 'deepseek-flash' },
      { name: 'OpenCode Go', providerType: 'pi_compat', baseUrl: 'https://opencode.ai/zen/go/v1', defaultModel: 'deepseek-flash' },
      { name: 'Command Goat', providerType: 'pi_compat', baseUrl: 'https://api.commandcode.ai/provider/v1/', defaultModel: 'deepseek/deepseek-v4.1-flash' },
      { name: 'Private Gateway', providerType: 'pi_compat', baseUrl: 'https://gateway.invalid/v1', defaultModel: 'deepseek-flash' },
    ].map(connection => <div key={connection.name} data-icon-name={connection.name} className="flex items-center gap-3">
      <ConnectionIcon connection={connection as LlmConnectionWithStatus} size={24} />{connection.name}
    </div>)}
  </div>
  return <OnboardingWizard {...onboarding} state={onboarding.state} onContinue={onboarding.handleContinue}
    onBack={onboarding.handleBack} onSelectApiSetupMethod={onboarding.handleSelectApiSetupMethod}
    onSelectProvider={onboarding.handleSelectProvider} onSubmitCredential={onboarding.handleSubmitCredential}
    onFinish={onboarding.handleFinish} onSubmitLocalModel={onboarding.handleSubmitLocalModel} />
}

declare global {
  interface Window { apiConnectionFixture: { ready: boolean; calls: Array<{ method: string; args: unknown[] }>; submissions: ApiKeySubmitData[]; connections: LlmConnectionWithStatus[]; rpc: typeof rpc } }
}
createRoot(document.getElementById('root')!).render(<Provider><I18nextProvider i18n={i18n}>
  <ThemeProvider defaultMode={mode}><ModalProvider><TooltipProvider><div className="min-h-dvh bg-background text-foreground"><Fixture /></div></TooltipProvider></ModalProvider></ThemeProvider>
</I18nextProvider></Provider>)
