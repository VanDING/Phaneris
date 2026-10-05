/** Preview current product components with a candidate theme and synthetic, isolated account data. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import candidate from '../../../docs/design/default-redesign/default-preview.json'
import { UserMessageBubble } from '@phaneris/ui'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { ModalProvider } from '../../../apps/electron/src/renderer/context/ModalContext'
import { ThemeProvider, useTheme } from '../../../apps/electron/src/renderer/context/ThemeContext'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import AiSettingsPage from '../../../apps/electron/src/renderer/pages/settings/AiSettingsPage'
import { SettingsCard, SettingsRow, SettingsSection, SettingsToggle, SettingsMenuSelectRow } from '../../../apps/electron/src/renderer/components/settings'
import { Button } from '../../../apps/electron/src/renderer/components/ui/button'
import { Input } from '../../../apps/electron/src/renderer/components/ui/input'
import { ConnectionIcon } from '../../../apps/electron/src/renderer/components/icons/ConnectionIcon'
import '../../../apps/electron/src/renderer/index.css'

const params = new URLSearchParams(location.search)
const language = params.get('lang') ?? 'en'
const mode = params.get('mode') === 'dark' ? 'dark' : 'light'
const themeId = params.get('theme') === 'default' ? 'default' : 'default-preview'
await i18next.init({ lng: language, keySeparator: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })
const connections = [
  { slug: 'minimax', name: 'Minimax', providerType: 'pi', piAuthProvider: 'minimax-cn', authType: 'api_key',
    isDefault: true, isAuthenticated: true, defaultModel: 'MiniMax-M3', models: [{ id: 'MiniMax-M3', name: 'MiniMax-M3', supportsImages: true }] },
  { slug: 'chatgpt', name: 'ChatGPT Plus', providerType: 'pi', piAuthProvider: 'openai-codex', authType: 'oauth',
    isDefault: false, isAuthenticated: true, defaultModel: 'gpt-5.5', models: ['gpt-5.5'] },
  { slug: 'deepseek', name: 'deepseek', providerType: 'pi', piAuthProvider: 'deepseek', authType: 'api_key',
    isDefault: false, isAuthenticated: true, defaultModel: 'deepseek-chat', models: ['deepseek-chat'] },
]
const workspaces = [{ id: 'my-workspace', name: 'My Workspace', rootPath: '/fixture/my-workspace' }]
const state = { ready: false, calls: [] as { method: string; args: unknown[] }[], contextPolicy: 'compact' }
const decision = { settings: { enabled: false, provider: 'typesafe', model: 'jev', features: { guardedMode: true } },
  providersWithKey: [], reusableConnections: [], guardedMode: { available: false, reason: 'disabled' },
  presets: [{ id: 'typesafe', label: 'TypeSafe', requiresKey: true, baseUrl: 'https://api.typesafe.ai', defaultModel: 'jev', keyPlaceholder: 'API key' }] }
const handlers: Record<string, (...args: any[]) => any> = {
  checkGitBash: () => ({ platform: 'darwin', found: true }), getWorkspaces: () => workspaces,
  getWorkspaceSettings: () => ({}), getDefaultThinkingLevel: () => 'max', setDefaultThinkingLevel: () => ({ success: true }),
  getExtendedPromptCache: () => false, getPromptCacheWarming: () => false,
  getContextPolicy: () => state.contextPolicy, setContextPolicy: value => { state.contextPolicy = value },
  getRtkEnabled: () => false, getRtkStatus: () => ({ available: false }), getCredentialHealth: () => ({ issues: [], healthy: true }),
  getDecisionLayerStatus: () => decision,
  getImageGenerationSettings: () => ({ settings: {}, connections: [],
    error: 'No image-capable API-key connection is configured. Add an OpenAI or OpenRouter API connection in AI Settings.' }),
  getThemePreferences: () => ({ mode, colorTheme: themeId, font: 'theme' }), getWorkspaceColorTheme: () => null,
  loadPresetTheme: id => ({ id, path: `fixture:${id}`, theme: id === 'default-preview' ? candidate : DEFAULT_THEME_FILE }),
  getSystemTheme: () => mode === 'dark', getWorkspaceIcon: () => null,
  getLogoUrl: () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ee5533"/><circle cx="16" cy="16" r="8" fill="#3366bb"/></svg>'),
  getPiProviderBaseUrl: provider => provider === 'minimax-cn' ? 'https://api.minimaxi.com' : provider === 'deepseek' ? 'https://api.deepseek.com' : null,
}
Object.assign(window, { defaultThemePreviewState: state,
  electronAPI: new Proxy({}, { get: (_target, key: string) => key.startsWith('on') ? () => () => {} : async (...args: unknown[]) => {
    state.calls.push({ method: key, args }); return handlers[key]?.(...args)
  } }) })
const shell = { workspaces, activeWorkspaceId: workspaces[0]!.id, llmConnections: connections, refreshLlmConnections: async () => {},
  isCompactMode: false, sessions: [], sources: [], skills: [], labels: [], statuses: [] } as unknown as AppShellContextType

function Controls() {
  const [enabled, setEnabled] = React.useState(true), [selection, setSelection] = React.useState('compact')
  return <div className="max-w-3xl mx-auto px-5 py-7 space-y-8">
    <SettingsSection title="Default Preview" description="Actual shared controls · 真实公共控件">
      <SettingsCard>
        <SettingsMenuSelectRow id="preview-menu" label="Context strategy" description="One consistent settings row, with the selector on the right."
          value={selection} onValueChange={setSelection} options={[{ value: 'compact', label: 'Auto compact' }, { value: 'handoff', label: 'Auto handoff' }, { value: 'manual', label: 'Manual' }]} />
        <SettingsToggle label="Enabled setting" description="Keep a readable label and a clear switch state." checked={enabled} onCheckedChange={setEnabled} />
        <SettingsToggle label="Disabled setting" description="An unavailable control retains its place and explanation." checked={false} onCheckedChange={() => {}} disabled />
        <SettingsRow label="Input field"><Input aria-label="Preview input" placeholder="A clear, focused input" style={{ maxWidth: 340 }} /></SettingsRow>
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title="Actions" description="Ink for primary actions; color for meaning.">
      <SettingsCard><div className="p-4 flex flex-wrap gap-3">
        <Button>Save changes</Button><Button variant="outline">Configure</Button><Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Delete</Button><Button disabled>Unavailable</Button>
      </div></SettingsCard>
    </SettingsSection>
    <SettingsSection title="Semantic colors" description="警告、成功、错误和重点都有明确区别。">
      <SettingsCard><div className="p-4 space-y-3">
        <p style={{ color: 'var(--accent)' }}>Selected model · 当前模型</p>
        <p style={{ color: 'var(--success)' }}>Connection ready · 连接可用</p>
        <p style={{ color: 'var(--info)' }}>Account needs attention · 账号需要处理</p>
        <p style={{ color: 'var(--destructive)' }}>Connection failed · 连接失败</p>
        <p className="text-muted-foreground">Secondary information remains readable · 辅助文字依然清晰</p>
      </div></SettingsCard>
    </SettingsSection>
    <SettingsSection title="Message surfaces" description="Quiet surfaces for reading, with a restrained user bubble.">
      <UserMessageBubble content="Help me organize these settings. · 帮我梳理这些设置。" />
      <div className="p-4 rounded-xl shadow-minimal" style={{ background: 'var(--paper)' }}>
        <p>Conversation preferences stay together. Optional services disclose their setup when needed.</p>
        <p className="text-muted-foreground mt-2">模型与连接关系清楚，重要操作有一致的位置。</p>
        <code className="block mt-3" style={{ fontFamily: 'var(--font-mono)' }}>theme: default-preview</code>
      </div>
    </SettingsSection>
  </div>
}
function ChatPreview() {
  return <div data-user-message-preview className="w-full max-w-3xl mx-auto px-8 py-12 space-y-8">
    <div><h1 className="text-lg font-semibold">Default Preview · 对话</h1>
      <p className="text-sm text-muted-foreground mt-2">实际用户消息组件 · 中性灰色气泡</p>
    </div>
    <UserMessageBubble content="帮我梳理一下 AI 设置，让界面更清晰。" />
    <div className="text-sm leading-relaxed space-y-2">
      <p>连接、会话和高级功能按使用顺序排列。需要时再展开高级设置。</p>
      <p className="text-muted-foreground">用留白和细边线建立层次，让阅读保持轻松。</p>
    </div>
    <UserMessageBubble content="用户消息用克制的灰白色，保持自然、清楚的层次。" />
    <p className="text-xs text-muted-foreground">浅色为灰白，深色为中性深灰；示例内容使用隔离测试数据。</p>
  </div>
}
function LogoPreview() {
  const logos = [
    { name: 'ChatGPT', providerType: 'pi', piAuthProvider: 'openai-codex' },
    { name: 'Minimax', providerType: 'pi', piAuthProvider: 'minimax-cn' },
    { name: 'DeepSeek', providerType: 'pi', piAuthProvider: 'deepseek' },
    { name: 'Claude', providerType: 'anthropic' },
    { name: 'Manifest', providerType: 'pi_compat', baseUrl: 'https://app.manifest.build/v1' },
    { name: 'Custom', providerType: 'pi_compat', baseUrl: 'https://fixture.invalid/v1' },
  ] as const
  return <div className="p-8 space-y-6">{logos.map(connection => <div key={connection.name} data-logo-preview={connection.name} className="flex items-center gap-4">
    <ConnectionIcon connection={connection} size={32} /><span>{connection.name}</span>
  </div>)}</div>
}
function Preview() {
  const theme = useTheme()
  React.useEffect(() => { state.ready = theme.themeLoadStatus === 'ready' && theme.appliedColorTheme === themeId }, [theme.themeLoadStatus, theme.appliedColorTheme])
  return <div className="h-screen flex flex-col bg-background">{params.get('view') === 'logos' ? <LogoPreview /> : params.get('view') === 'chat' ? <ChatPreview /> : params.get('view') === 'controls' ? <Controls /> : <AiSettingsPage />}</div>
}
createRoot(document.getElementById('root')!).render(<Provider><I18nextProvider i18n={i18next}>
  <ModalProvider><ThemeProvider defaultMode={mode} defaultColorTheme={themeId}><AppShellProvider value={shell}>
    <Preview />
  </AppShellProvider></ThemeProvider></ModalProvider>
</I18nextProvider></Provider>)
