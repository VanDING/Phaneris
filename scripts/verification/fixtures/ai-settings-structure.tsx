/** Actual settings pages; synthetic accounts and an in-memory transport only. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { TooltipProvider } from '@phaneris/ui'
import { EscapeInterruptProvider } from '../../../apps/electron/src/renderer/context/EscapeInterruptContext'
import { ModalProvider } from '../../../apps/electron/src/renderer/context/ModalContext'
import { ThemeProvider } from '../../../apps/electron/src/renderer/context/ThemeContext'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import AiSettingsPage from '../../../apps/electron/src/renderer/pages/settings/AiSettingsPage'
import WorkspaceSettingsPage from '../../../apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage'
import PermissionsSettingsPage from '../../../apps/electron/src/renderer/pages/settings/PermissionsSettingsPage'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { navigate, routes, NAVIGATE_EVENT } from '../../../apps/electron/src/renderer/lib/navigate'
import '../../../apps/electron/src/renderer/index.css'

const params = new URLSearchParams(location.search)
const language = params.get('lang') ?? 'en', mode = params.get('mode') === 'dark' ? 'dark' : 'light'
await i18next.init({ lng: language, keySeparator: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })
const scenario = params.get('scenario') ?? 'ready'
const catalog: any[] = [
  { slug: 'openai', name: 'OpenAI', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key', isDefault: true, isAuthenticated: true, defaultModel: 'gpt-5.4', models: [{ id: 'gpt-5.4', name: 'GPT-5.4', description: '', supportsImages: true }] },
  { slug: 'router', name: 'OpenRouter', providerType: 'pi', piAuthProvider: 'openrouter', authType: 'api_key', isAuthenticated: true, defaultModel: 'anthropic/claude-sonnet-4.6', models: ['anthropic/claude-sonnet-4.6'] },
  { slug: 'chatgpt', name: 'ChatGPT Plus', providerType: 'pi', piAuthProvider: 'openai-codex', authType: 'oauth', isAuthenticated: true, defaultModel: 'text-only', models: [{ id: 'text-only', name: 'Text Model', description: '', supportsImages: false }, { id: 'vision', name: 'Vision Model', description: '', supportsImages: true }] },
]
const workspaces = ['Research', 'Writing', 'Design'].map((name, index) => ({ id: `workspace-${index}`, name, rootPath: `/fixture/${name}` }))
const state = {
  connections: scenario === 'subscription' ? [{ ...catalog[2], isDefault: true }] : catalog,
  activeWorkspaceId: 'workspace-0', contextPolicy: 'compact', thinking: 'medium', extendedCache: false, warming: false, rtk: false,
  failContext: false, failImages: false, failWorkspace: false, failWorkspaceLoad: scenario === 'workspace-error', failCache: false,
  failDecisions: scenario === 'decision-error', failImageLoad: scenario === 'image-error', delayWorkspace: false,
  image: (scenario === 'broken' ? { connectionSlug: 'openai', model: 'gpt-image-2' } : scenario === 'deleted' ? { connectionSlug: 'deleted-account', model: 'gpt-image-2' } : {}) as { connectionSlug?: string; model?: string },
  workspaceById: Object.fromEntries(workspaces.map(w => [w.id, { name: w.name, permissionMode: 'ask', ...(w.id === 'workspace-0' ? { defaultLlmConnection: 'router', model: 'anthropic/claude-sonnet-4.6' } : {}) }])) as Record<string, any>,
  calls: [] as Array<{ method: string; args: any[] }>,
  decision: { settings: { enabled: false, provider: 'typesafe', model: 'jev', features: { guardedMode: true, suggestions: true, smartTitles: true } }, providersWithKey: [], reusableConnections: [], guardedMode: { available: false, reason: 'disabled' }, presets: [{ id: 'typesafe', label: 'TypeSafe', requiresKey: true, baseUrl: 'https://api.typesafe.ai', defaultModel: 'jev', keyPlaceholder: 'API key' }] } as any,
}
if (scenario === 'broken') state.connections[0] = { ...state.connections[0], isAuthenticated: false }
const clone = (value: any) => JSON.parse(JSON.stringify(value))
const refresh = () => window.dispatchEvent(new Event('fixture-refresh'))
const imageStatus = () => {
  const connections = state.connections.filter(c => c.authType === 'api_key' && ['openai', 'openrouter'].includes(c.piAuthProvider)).map(c => ({ slug: c.slug, name: c.name, available: c.isAuthenticated, provider: c.piAuthProvider,
    models: [{ id: c.piAuthProvider === 'openai' ? 'gpt-image-2' : 'google/gemini-2.5-flash-image', name: c.piAuthProvider === 'openai' ? 'GPT Image 2' : 'Gemini Flash Image' }] }))
  const selected = state.image.connectionSlug ? connections.find(c => c.slug === state.image.connectionSlug) : connections.find(c => c.available)
  return clone({ settings: state.image, connections, ...(selected?.available ? { effective: { connectionSlug: selected.slug, connectionName: selected.name, model: state.image.model ?? selected.models[0].id } } : state.image.connectionSlug ? { error: 'The selected image account is unavailable. Update its key or choose another connection.' } : { error: 'No image-capable API-key connection is configured. Add an OpenAI or OpenRouter API connection in AI Settings.' }) })
}
const handlers: Record<string, (...args: any[]) => any> = {
  checkGitBash: () => ({ platform: 'darwin', found: true }), getWorkspaces: () => workspaces,
  getWorkspaceSettings: async id => { if (state.failWorkspaceLoad) throw Error('Fixture workspace unavailable'); const snapshot = clone(state.workspaceById[id]); if (state.delayWorkspace && id === 'workspace-0') await new Promise(r => setTimeout(r, 650)); return snapshot },
  updateWorkspaceSetting: (id, key, value) => {
    if (state.failWorkspace) throw Error('Fixture workspace save failed')
    const ws = state.workspaceById[id]; ws[key] = value
    if (key === 'defaultLlmConnection') { const c = state.connections.find(c => c.slug === (value || state.connections.find(c => c.isDefault)?.slug)); if (!c?.models.some((m: any) => (typeof m === 'string' ? m : m.id) === ws.model)) ws.model = undefined }
  },
  getDefaultThinkingLevel: () => state.thinking, setDefaultThinkingLevel: value => { state.thinking = value; return { success: true } },
  getExtendedPromptCache: () => state.extendedCache, setExtendedPromptCache: value => { if (state.failCache) throw Error('Fixture cache save failed'); state.extendedCache = value },
  getPromptCacheWarming: () => state.warming, setPromptCacheWarming: value => { if (state.failCache) throw Error('Fixture cache save failed'); state.warming = value },
  getContextPolicy: () => state.contextPolicy, setContextPolicy: policy => { if (state.failContext) throw Error('Fixture save failed'); state.contextPolicy = policy },
  getRtkEnabled: () => state.rtk, setRtkEnabled: value => { if (state.failCache) throw Error('Fixture RTK save failed'); state.rtk = value },
  getRtkStatus: () => ({ installed: true, path: '/fixture/rtk', version: '0.31.0', outdated: false }), getRtkGain: () => null, getCredentialHealth: () => ({ issues: [], healthy: true }),
  getDecisionLayerStatus: () => { if (state.failDecisions) throw Error('Fixture decision unavailable'); return clone(state.decision) },
  setDecisionLayerSettings: patch => { Object.assign(state.decision.settings, { ...patch, features: { ...state.decision.settings.features, ...patch.features } }); return clone(state.decision.settings) },
  getImageGenerationSettings: () => { if (state.failImageLoad) throw Error('Fixture image status unavailable'); return imageStatus() },
  setImageGenerationSettings: settings => { if (state.failImages) throw Error('Fixture image save failed'); state.image = settings; return imageStatus() },
  getThemePreferences: () => ({ mode, colorTheme: 'default', font: 'theme' }), getWorkspaceColorTheme: () => null, loadPresetTheme: () => DEFAULT_THEME_FILE, getSystemTheme: () => mode === 'dark',
  getPiProviderBaseUrl: () => null, getPiProviderModels: () => ({ models: [] }), getWorkspaceIcon: () => null, readWorkspaceImage: () => null, getSources: () => [],
  getDefaultPermissionsConfig: () => ({ config: null, path: null }), getWorkspacePermissionsConfig: () => null,
  testLlmConnection: () => ({ success: false, error: 'Fixture authentication failed. Update your API key and retry.' }),
  setDefaultLlmConnection: slug => { state.connections = state.connections.map(c => ({ ...c, isDefault: c.slug === slug })); refresh(); return { success: true } },
  saveLlmConnection: c => { state.connections = state.connections.map(old => old.slug === c.slug ? { ...old, ...c } : old); refresh(); return { success: true } },
  renameLlmConnection: (slug, name) => { state.connections = state.connections.map(c => c.slug === slug ? { ...c, name } : c); refresh(); return { success: true } },
  testLlmConnectionSetup: () => ({ success: true }),
  setupLlmConnection: setup => { state.connections = [...state.connections, { ...catalog[0], slug: setup.slug, name: 'Image API', isDefault: false, piAuthProvider: setup.piAuthProvider }]; refresh(); return { success: true } },
  getLlmConnectionApiKey: () => '', deleteLlmConnection: slug => { state.connections = state.connections.filter(c => c.slug !== slug); refresh(); return { success: true } },
}
Object.assign(window, {
  electronAPI: new Proxy({}, { get: (_target, key: string) => key.startsWith('on') ? () => () => {} : async (...args: any[]) => { state.calls.push({ method: key, args }); return handlers[key]?.(...args) } }),
  aiStructureState: () => state, aiStructureRefresh: refresh,
  aiStructureNavigate: (page: 'ai' | 'workspace' | 'permissions') => navigate(routes.view.settings(page)),
})
function App() {
  const [route, setRoute] = React.useState(params.get('page') ?? 'ai')
  const [, render] = React.useReducer(n => n + 1, 0)
  React.useEffect(() => {
    const onNavigate = (event: Event) => { const value = (event as CustomEvent).detail.route as string; setRoute(value.includes('workspace') ? 'workspace' : value.includes('permissions') ? 'permissions' : 'ai') }
    window.addEventListener(NAVIGATE_EVENT, onNavigate); window.addEventListener('fixture-refresh', render)
    return () => { window.removeEventListener(NAVIGATE_EVENT, onNavigate); window.removeEventListener('fixture-refresh', render) }
  }, [])
  const shell = { workspaces, activeWorkspaceId: state.activeWorkspaceId, llmConnections: state.connections, refreshLlmConnections: async () => refresh(), onRefreshWorkspaces: refresh,
    isCompactMode: false, pendingPermissions: new Map(), pendingCredentials: new Map(), pendingQuestions: new Map(), sessionOptions: new Map(), sessions: [], sources: [], skills: [], labels: [], statuses: [] } as unknown as AppShellContextType
  return <AppShellProvider value={shell}><div className="h-screen flex flex-col bg-background">{route === 'workspace' ? <WorkspaceSettingsPage key={state.activeWorkspaceId} /> : route === 'permissions' ? <PermissionsSettingsPage /> : <AiSettingsPage />}</div></AppShellProvider>
}
createRoot(document.getElementById('root')!).render(<Provider><I18nextProvider i18n={i18next}><TooltipProvider><ModalProvider><EscapeInterruptProvider><ThemeProvider defaultMode={mode}><App /></ThemeProvider></EscapeInterruptProvider></ModalProvider></TooltipProvider></I18nextProvider></Provider>)
