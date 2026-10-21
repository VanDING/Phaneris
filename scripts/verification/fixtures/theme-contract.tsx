/** W2 fixture: actual ThemeProvider, controls and Viewer; isolated preferences. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Circle } from 'lucide-react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '../../../packages/ui/src/components/markdown/CodeBlock'
import { CodePreviewOverlay } from '../../../packages/ui/src/components/overlay/CodePreviewOverlay'
import { ShikiThemeProvider } from '../../../packages/ui/src/context/ShikiThemeContext'
import { TooltipProvider } from '../../../packages/ui/src/components/tooltip'
import { BUILTIN_THEMES, type ThemeFile, type ThemePreferences } from '@config/theme'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'
import { App as ViewerApp } from '../../../apps/viewer/src/App'
import { FrontendP2Surface } from './frontend-p2'

const params = new URLSearchParams(location.search)
const host = params.get('css')?.split('/').at(-1)?.replace('.css', '') ?? 'electron'
const sheets = {
  electron: () => import('./theme-contract-css/electron.css?inline'),
  ui: () => import('./theme-contract-css/ui.css?inline'),
  viewer: () => import('./theme-contract-css/viewer.css?inline'),
  webui: () => import('./theme-contract-css/webui.css?inline'),
}
const sheet = await (sheets[host as keyof typeof sheets] ?? sheets.electron)()
const style = document.createElement('style'); style.textContent = sheet.default; document.head.append(style)
const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, fallbackLng: false, interpolation: { escapeValue: false } })
const listeners = new Set<(value: ThemePreferences) => void>()
let preferences: ThemePreferences = { mode: 'light', colorTheme: 'default', font: 'theme' }
const definitions: Record<string, ThemeFile> = { ...BUILTIN_THEMES }
const harness = {
  choose(id: string, mode: 'light' | 'dark', theme?: ThemeFile) {
    if (theme) definitions[id] = theme
    preferences = { ...preferences, mode, colorTheme: id }; listeners.forEach(callback => callback(preferences))
  },
  toggleDOM() { document.documentElement.classList.toggle('dark') },
}
declare global { interface Window { themeContract: typeof harness } }
window.themeContract = harness
window.electronAPI = {
  getThemePreferences: async () => preferences,
  setThemePreferences: async next => { preferences = next; return next },
  onThemePreferencesChange: callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
  loadPresetTheme: async id => definitions[id] ? { id, path: `fixture:${id}`, theme: definitions[id] } : null,
} as ElectronAPI
function Surface() {
  const theme = useTheme()
  const [overlay, setOverlay] = React.useState(false)
  return <TooltipProvider><ShikiThemeProvider shikiTheme={theme.shikiTheme} revision={theme.snapshot.revision}>
    <main data-contract-ready className="h-full overflow-auto bg-background p-8 text-foreground">
    <h1 className="text-xl font-medium">主题契约 · {theme.appliedColorTheme} · {theme.isDark ? '深色' : '浅色'}</h1>
    <output className="sr-only" data-testid="state">{JSON.stringify({ requested: theme.effectiveColorTheme, applied: theme.appliedColorTheme,
      status: theme.themeLoadStatus, mode: theme.isDark ? 'dark' : 'light', error: theme.themeLoadError,
      snapshot: 'snapshot' in theme ? theme.snapshot : null })}</output>
    <div className="mt-4 flex items-center gap-4"><Button data-testid="control" className="rounded-md">主题按钮</Button>
      <Button data-testid="icon" size="icon" aria-label="图标"><Circle data-testid="circle" /></Button></div>
    <div data-testid="step" className="mt-4 rounded-md bg-foreground-50 p-4">派生色阶</div>
    {Object.entries({ body: ['text-foreground bg-background', '--foreground', '--background'],
      muted: ['text-muted-foreground bg-muted', '--muted-foreground', '--muted'],
      'muted-paper': ['text-muted-foreground bg-paper', '--muted-foreground', '--paper'],
      popover: ['text-popover-foreground bg-popover-solid', '--popover-foreground', '--popover-solid'],
      accent: ['text-accent-text bg-background', '--accent-text', '--background'],
      info: ['text-info-text bg-background', '--info-text', '--background'],
      success: ['text-success-text bg-background', '--success-text', '--background'],
      destructive: ['text-destructive-text bg-background', '--destructive-text', '--background'],
      emphasized: ['text-on-accent bg-accent', '--on-accent', '--accent'],
    }).map(([id, [classes, fg, bg]]) => <p key={id} data-contrast={id} data-fg={fg} data-bg={bg} className={`${classes} mt-3 p-2`}>中文主题可读性 · {id}</p>)}
    <CodeBlock code={'const answer = 42;\nconsole.log(answer)'} language="typescript" />
    <Button data-testid="open-code" onClick={() => setOverlay(true)}>打开代码预览</Button>
    <CodePreviewOverlay isOpen={overlay} onClose={() => setOverlay(false)} content="const answer = 42" filePath="theme.ts" theme={theme.isDark ? 'dark' : 'light'} />
    </main>
  </ShikiThemeProvider></TooltipProvider>
}
let content = params.get('standalone') === 'true' ? <CodeBlock code="const answer = 42" language="typescript" />
  : <ThemeProvider><Surface /></ThemeProvider>
if (params.get('frontend-p2') === 'true') content = <ThemeProvider><FrontendP2Surface /></ThemeProvider>
if (params.get('viewer') === 'true') {
  window.history.replaceState({}, '', '/s/theme-contract')
  content = <ViewerApp />
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><I18nextProvider i18n={i18n}>{content}</I18nextProvider></React.StrictMode>)
