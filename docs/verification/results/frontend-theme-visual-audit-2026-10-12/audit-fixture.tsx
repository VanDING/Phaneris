/** Audit harness: real ThemeProvider and controls, synthetic bridge, no account access. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { Circle } from 'lucide-react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { CodeBlock } from '../../../../packages/ui/src/components/markdown/CodeBlock'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { BUILTIN_THEMES } from '@config/theme'

const params = new URLSearchParams(location.search)
const host = params.get('host') ?? 'electron'
if (host === 'ui') await import('../../../../packages/ui/src/styles/index.css')
else if (host === 'viewer') await import('../../../../apps/viewer/src/index.css')
else if (host === 'webui') await import('../../../../apps/webui/src/index.css')
else await import('../../../../apps/electron/src/renderer/index.css')

const listeners: Record<string, Function[]> = {}
const themes: Record<string, any> = {
  ...BUILTIN_THEMES,
  'audit-size': { name: 'Audit size', accent: '#5438bb', fontSize: '18px' },
  'audit-compact': { name: 'Audit compact', accent: '#5438bb', density: 'compact' },
  'audit-cozy': { name: 'Audit cozy', accent: '#5438bb', density: 'cozy' },
  'audit-invalid': { name: 'Audit invalid', background: 'banana', foreground: '#111111', radius: '-8px', popoverSolid: 'transparent' },
  'audit-glass': { name: 'Audit glass', accent: '#5438bb', mode: 'scenic', backgroundImage: 'https://audit.invalid/missing.png', depth: 'glass', popoverSolid: 'transparent' },
}
const harness: any = {
  calls: [], delays: {}, failures: [], preferenceFailure: false,
  preferences: { mode: params.get('mode') === 'dark' ? 'dark' : 'light', colorTheme: params.get('persistedTheme') ?? 'default', font: 'theme' },
  workspaceTheme: null,
  emit: (event: string, value: unknown) => (listeners[event] ?? []).forEach(callback => callback(value)),
}
const handlers: Record<string, Function> = {
  getThemePreferences: () => harness.preferences,
  setThemePreferences: (preferences: any) => {
    if (harness.preferenceFailure) throw new Error('Synthetic save failure')
    harness.preferences = preferences
    return preferences
  },
  getWorkspaceColorTheme: () => harness.workspaceTheme,
  setWorkspaceColorTheme: (_id: string, theme: string | null) => { harness.workspaceTheme = theme },
  getSystemTheme: () => harness.preferences.mode === 'dark',
  loadPresetTheme: async (id: string) => {
    if (harness.delays[id]) await new Promise(resolve => setTimeout(resolve, harness.delays[id]))
    if (harness.failures.includes(id)) throw new Error('Synthetic loader failure')
    return themes[id] ? { id, path: `fixture:${id}`, theme: themes[id] } : null
  },
  setTitleBarOverlay: () => undefined,
}
const bridge = new Proxy({}, { get: (_target, key: string) => key.startsWith('on')
    ? (callback: Function) => {
        (listeners[key] ??= []).push(callback)
        return () => { listeners[key] = listeners[key].filter(value => value !== callback) }
      }
    : async (...args: any[]) => { harness.calls.push({ method: key }); return handlers[key]?.(...args) }
  })
Object.assign(window, { auditHarness: harness })
harness.subscriptionCounts = () => Object.fromEntries(Object.entries(listeners).map(([key, value]) => [key, value.length]))
if (params.get('bridgeDelay')) setTimeout(() => { Object.assign(window, { electronAPI: bridge }) }, Number(params.get('bridgeDelay')))
else Object.assign(window, { electronAPI: bridge })

function AuditSurface() {
  const theme = useTheme()
  React.useEffect(() => {
    Object.assign(window, {
      auditActions: { setColorTheme: theme.setColorTheme, setMode: theme.setMode, setFont: theme.setFont,
        setPreviewColorTheme: theme.setPreviewColorTheme, setWorkspaceColorTheme: theme.setWorkspaceColorTheme },
      auditSnapshot: { requested: theme.effectiveColorTheme, applied: theme.appliedColorTheme,
        status: theme.themeLoadStatus, source: theme.effectiveColorThemeSource,
        actualMode: theme.isDark ? 'dark' : 'light', resolvedMode: theme.resolvedMode,
        error: theme.themeLoadError, preferenceError: theme.themePreferenceError,
        isScenic: theme.isScenic, shikiTheme: theme.shikiTheme, resolved: theme.resolvedTheme },
    })
  }, [theme])
  return <main data-audit-root style={{ padding: 28, background: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh', overflow: 'auto' }}>
    <h1 style={{ marginBottom: 16 }}>Phaneris · 真实主题与控件样本</h1>
    <p style={{ marginBottom: 20 }}>主题 / Theme: {theme.appliedColorTheme} · {theme.isDark ? 'dark' : 'light'} · CSS: {host}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      <button data-audit="native" style={{ padding: 8 }}>原生按钮（无角色类）</button>
      <Button data-audit="button">保存 / Save</Button>
      <Button data-audit="danger" variant="destructive">删除 / Delete</Button>
      <Button data-audit="icon" size="icon" aria-label="图标按钮"><Circle size={16} /></Button>
      <Input data-audit="input" aria-label="审计输入" placeholder="陕西煤业 · long path" style={{ width: 260 }} />
      <Select defaultValue="one"><SelectTrigger data-audit="select" aria-label="审计菜单" style={{ width: 180 }}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="one">普通菜单项</SelectItem><SelectItem value="two">长菜单 / Another choice</SelectItem></SelectContent>
      </Select>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 28 }}>
      {['xs', 'sm', 'md', 'minimal'].map(shadow => <div key={shadow} data-shadow={shadow} className={`shadow-${shadow}`} style={{ padding: 16, background: 'var(--paper)' }}>shadow-{shadow}</div>)}
    </div>
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 28 }}>
      <span className="rounded-md" data-audit="radius" style={{ background: 'var(--secondary)', padding: 12 }}>rounded-md</span>
      <span data-audit="density" style={{ padding: 'var(--theme-row-padding-y) 12px', border: '1px solid var(--border)' }}>语义密度行 / Density</span>
      <span className="motion-content" data-audit="motion" style={{ opacity: 0.9, transitionProperty: 'opacity' }}>动效节奏 / Motion</span>
    </div>
    <div style={{ marginTop: 24, padding: 16, background: 'var(--card)', border: '1px solid var(--border)' }}>
      <p>正文 / Reading：中文与 English，同一主题下保持可读。</p>
      <p style={{ color: 'var(--muted-foreground)' }}>辅助信息 / Secondary text</p>
      <p style={{ color: 'var(--accent)' }}>强调文字 / Accent text</p>
      <p style={{ color: 'var(--info-text)' }}>提示 / Info</p>
      <p style={{ color: 'var(--success-text)' }}>成功 / Success</p>
      <p style={{ color: 'var(--destructive-text)' }}>错误 / Error</p>
    </div>
  </main>
}

/** Same state→passive DOM-class update pattern as the standalone Viewer; no Shiki provider. */
function ViewerCodeProbe() {
  const [isDark, setIsDark] = React.useState(false)
  React.useEffect(() => { document.documentElement.classList.toggle('dark', isDark) }, [isDark])
  React.useEffect(() => { Object.assign(window, { auditCodeActions: { toggle: () => setIsDark(value => !value) } }) }, [])
  return <main style={{ padding: 32, background: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh' }}>
    <Button onClick={() => setIsDark(value => !value)}>Viewer mode: {isDark ? 'dark' : 'light'}</Button>
    <div style={{ marginTop: 24 }}><CodeBlock code={'const audit = 1\nconsole.log(audit)'} language="typescript" /></div>
  </main>
}
const codeI18n = createInstance()
await codeI18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: { 'common.copyCode': 'Copy code' } } } })
let surface = params.get('codeProbe') === 'true' ? <I18nextProvider i18n={codeI18n}><ViewerCodeProbe /></I18nextProvider> : <ThemeProvider defaultMode={harness.preferences.mode} activeWorkspaceId="audit-workspace"><AuditSurface /></ThemeProvider>
if (params.get('viewerApp') === 'true') {
  window.history.replaceState({}, '', '/s/audit-theme')
  const { App } = await import('../../../../apps/viewer/src/App')
  surface = <I18nextProvider i18n={codeI18n}><App /></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionConfig reducedMotion="user">
  {surface}
</MotionConfig></React.StrictMode>)
