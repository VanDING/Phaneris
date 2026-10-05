/** Actual settings renderer with an isolated in-memory transport, never personal settings. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { ModalProvider } from '../../../apps/electron/src/renderer/context/ModalContext'
import { ThemeProvider } from '../../../apps/electron/src/renderer/context/ThemeContext'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import AiSettingsPage from '../../../apps/electron/src/renderer/pages/settings/AiSettingsPage'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import '../../../apps/electron/src/renderer/index.css'

const params = new URLSearchParams(location.search)
const language = params.get('lang') ?? 'en', mode = params.get('mode') === 'dark' ? 'dark' : 'light'
await i18next.init({ lng: language, keySeparator: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })
const connections = [
  { slug: 'openai', name: 'OpenAI', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key', isDefault: true, isAuthenticated: true, defaultModel: 'gpt-5.4', models: ['gpt-5.4'] },
  { slug: 'router', name: 'OpenRouter', providerType: 'pi', piAuthProvider: 'openrouter', authType: 'api_key', isDefault: false, isAuthenticated: true, defaultModel: 'anthropic/claude-sonnet-4.6', models: ['anthropic/claude-sonnet-4.6'] },
]
const workspaces = ['Research', 'Writing', 'Design'].map((name, index) => ({ id: `workspace-${index}`, name, rootPath: `/fixture/${name}` }))
const state = { contextPolicy: 'compact', failContext: false, image: {} as { connectionSlug?: string; model?: string }, workspace: { defaultLlmConnection: 'router', model: 'anthropic/claude-sonnet-4.6' }, calls: [] as unknown[] }
const decision = { settings: { enabled: false, provider: 'typesafe', model: 'jev', features: { guardedMode: true } }, providersWithKey: [], reusableConnections: [],
  guardedMode: { available: false, reason: 'disabled' }, presets: [{ id: 'typesafe', label: 'TypeSafe', requiresKey: true, baseUrl: 'https://api.typesafe.ai', defaultModel: 'jev', keyPlaceholder: 'API key' }] }
const imageStatus = () => ({ settings: state.image, effective: { connectionSlug: state.image.connectionSlug ?? 'openai', connectionName: state.image.connectionSlug === 'router' ? 'OpenRouter' : 'OpenAI', model: state.image.model ?? (state.image.connectionSlug === 'router' ? 'google/gemini-2.5-flash-image' : 'gpt-image-2') },
  connections: connections.map(c => ({ slug: c.slug, name: c.name, available: true, provider: c.piAuthProvider,
    models: [{ id: c.slug === 'openai' ? 'gpt-image-2' : 'google/gemini-2.5-flash-image', name: c.slug === 'openai' ? 'GPT Image 2' : 'Gemini Flash Image' }] })) })
const handlers: Record<string, (...args: any[]) => any> = {
  checkGitBash: () => ({ platform: 'darwin', found: true }),
  getWorkspaces: () => workspaces,
  getWorkspaceSettings: () => state.workspace,
  updateWorkspaceSetting: (_id, key, value) => { Object.assign(state.workspace, { [key]: value }); if (key === 'defaultLlmConnection') Object.assign(state.workspace, { model: undefined }) },
  getDefaultThinkingLevel: () => 'medium', setDefaultThinkingLevel: () => ({ success: true }),
  getExtendedPromptCache: () => false, getPromptCacheWarming: () => false,
  getContextPolicy: () => state.contextPolicy, setContextPolicy: policy => { if (state.failContext) throw Error('Fixture save failed'); state.contextPolicy = policy },
  getRtkEnabled: () => false, getRtkStatus: () => ({ available: false }),
  getCredentialHealth: () => ({ issues: [], healthy: true }),
  getDecisionLayerStatus: () => decision,
  getImageGenerationSettings: () => imageStatus(), setImageGenerationSettings: settings => { state.image = settings; return imageStatus() },
  getThemePreferences: () => ({ mode, colorTheme: 'default', font: 'theme' }),
  getWorkspaceColorTheme: () => null, loadPresetTheme: () => DEFAULT_THEME_FILE, getSystemTheme: () => mode === 'dark',
  getPiProviderBaseUrl: () => null, getWorkspaceIcon: () => null,
  testLlmConnection: () => ({ success: false, error: 'Fixture authentication failed. Update your API key and retry.' }),
}
Object.assign(window, {
  electronAPI: new Proxy({}, { get: (_target, key: string) => key.startsWith('on') ? () => () => {} : async (...args: unknown[]) => {
    state.calls.push({ method: key, args }); return handlers[key]?.(...args)
  } }),
  aiVerificationState: () => state,
})
const shell = { workspaces, activeWorkspaceId: workspaces[0]!.id, llmConnections: connections, refreshLlmConnections: async () => {},
  isCompactMode: false, sessions: [], sources: [], skills: [], labels: [], statuses: [] } as unknown as AppShellContextType
createRoot(document.getElementById('root')!).render(<Provider><I18nextProvider i18n={i18next}>
  <ModalProvider><ThemeProvider defaultMode={mode}><AppShellProvider value={shell}><div className="h-screen flex flex-col bg-background"><AiSettingsPage /></div></AppShellProvider></ThemeProvider></ModalProvider>
</I18nextProvider></Provider>)
