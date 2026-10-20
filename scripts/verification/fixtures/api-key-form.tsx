/**
 * The real `ApiKeyInput` form (Pi API-key flow) with a synthetic model catalog.
 *
 * The form is production code; only the host is stubbed. `getPiProviderModels`
 * answers with a per-provider catalog the driver controls, so a scene can prove
 * which provider's models were submitted — including an off-catalog id that must
 * survive every edit except the one that legitimately replaces the list.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@phaneris/ui'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { DEFAULT_THEME_FILE } from '@config/theme'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { ModalProvider } from '@/context/ModalContext'
import { ApiKeyInput } from '@/components/apisetup/ApiKeyInput'
import '@/index.css'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'

interface Submission { apiKey: string; connectionDefaultModel?: string; utilityModel?: string | null; models?: string[]; brandId?: string; baseUrl?: string }

const submissions: Submission[] = []
const renderCount = { value: 0 }

// Catalogs are declared per preset; the driver reads them back through the
// fixture API so the assertions can name the provider a model belongs to.
const CATALOGS: Record<string, { id: string; name: string }[]> = {
  'kimi-coding': [
    { id: 'kimi-k2', name: 'Kimi K2' },
    { id: 'kimi-k2-mini', name: 'Kimi K2 Mini' },
    { id: 'kimi-legacy', name: 'Kimi Legacy' },
  ],
  opencode: [
    { id: 'opencode-sonnet', name: 'OpenCode Sonnet' },
    { id: 'opencode-haiku', name: 'OpenCode Haiku' },
  ],
}
const catalogCalls: { provider: string; at: number }[] = []

const explicit: Record<string, unknown> = {
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
  getPiProviderModels: async (provider: string) => {
    catalogCalls.push({ provider, at: Date.now() })
    return { models: CATALOGS[provider] ?? [] }
  },
}

const electronApi = new Proxy(explicit, {
  get(target, key) {
    if (typeof key !== 'string') return undefined
    if (key in target) return target[key]
    if (key === 'then') return undefined
    if (key.startsWith('on')) return () => () => {}
    return async () => null
  },
}) as unknown as ElectronAPI
Object.assign(window, { electronAPI: electronApi })

const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: en } } })

function Fixture() {
  const theme = useTheme()
  renderCount.value += 1
  // The first provider is hydrated from stored settings, so the form starts on a
  // saved catalog with one off-catalog model — the state the bug used to lose.
  const initialValues = React.useMemo(() => ({
    apiKey: 'stored-key',
    activePreset: 'kimi-coding',
    connectionDefaultModel: 'kimi-k2',
    utilityModel: 'kimi-k2-mini',
    models: ['kimi-k2', 'kimi-k2-mini', 'kimi-legacy'],
  }), [])

  React.useEffect(() => {
    window.apiKeyFixture = {
      ready: theme.themeLoadStatus === 'ready',
      submissions,
      catalogCalls: () => catalogCalls.map(call => ({ ...call })),
      clear: () => { submissions.length = 0 },
      last: () => submissions[submissions.length - 1] ?? null,
      renders: () => renderCount.value,
    }
  })

  return (
    <div className="p-6 max-w-xl">
      <ApiKeyInput
        status="idle"
        providerType="pi_api_key"
        initialValues={initialValues}
        onSubmit={data => { submissions.push(data as Submission) }}
      />
      <Toaster />
    </div>
  )
}

declare global {
  interface Window {
    apiKeyFixture: {
      ready: boolean
      submissions: Submission[]
      catalogCalls: () => { provider: string; at: number }[]
      clear: () => void
      last: () => Submission | null
      renders: () => number
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider defaultMode="light">
        <ModalProvider>
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </ModalProvider>
      </ThemeProvider>
    </I18nextProvider>
  </Provider>,
)
