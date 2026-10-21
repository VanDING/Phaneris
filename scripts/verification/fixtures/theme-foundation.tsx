/** W1 controls: production components/CSS and resolver, synthetic theme inputs. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DEFAULT_THEME_FILE, themeToCSS, type ThemeDepth } from '@config/theme'

const params = new URLSearchParams(location.search)
const host = params.get('host') ?? 'electron'
const sheets = {
  ui: () => import('./theme-foundation-css/ui.css?inline'),
  viewer: () => import('./theme-foundation-css/viewer.css?inline'),
  webui: () => import('./theme-foundation-css/webui.css?inline'),
  electron: () => import('./theme-foundation-css/electron.css?inline'),
}
const sheet = await (sheets[host as keyof typeof sheets] ?? sheets.electron)()
const hostStyle = document.createElement('style')
hostStyle.textContent = sheet.default
document.head.appendChild(hostStyle)

const themeStyle = document.createElement('style')
document.head.appendChild(themeStyle)
function apply(mode: 'light' | 'dark', depth: ThemeDepth | 'static' = 'static') {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.classList.toggle('light', mode === 'light')
  if (depth === 'static') {
    themeStyle.textContent = ''
    delete document.documentElement.dataset.themeDepth
  } else {
    themeStyle.textContent = `:root { ${themeToCSS({ ...DEFAULT_THEME_FILE, depth, dark: { ...DEFAULT_THEME_FILE.dark, depth } }, mode === 'dark')} }`
    document.documentElement.dataset.themeDepth = depth
  }
}
declare global {
  interface Window { themeFoundation: { apply: typeof apply } }
}
window.themeFoundation = { apply }
apply(params.get('mode') === 'dark' ? 'dark' : 'light')

const shadows = {
  '2xs': 'shadow-2xs', xs: 'shadow-xs', sm: 'shadow-sm', default: 'shadow', md: 'shadow-md',
  lg: 'shadow-lg', xl: 'shadow-xl', '2xl': 'shadow-2xl',
}
function Surface() {
  const [clicks, setClicks] = React.useState(0)
  return <main data-foundation-ready className="h-full overflow-auto bg-background p-8 text-foreground">
    <h1 className="mb-6 text-xl font-medium">主题治理 · 基础交互</h1>
    <div className="flex flex-wrap items-center gap-4">
      <button data-testid="native" className="rounded-md bg-secondary px-3 py-2" onClick={() => setClicks(value => value + 1)}>原生按钮 {clicks}</button>
      <a data-testid="link" href="#content">跳转正文</a>
      <Button data-testid="button">共享按钮</Button>
      <Input data-testid="input" aria-label="独立输入" placeholder="独立输入" className="w-48" />
      <div data-testid="field" className="craft-field-surface">
        <Input data-testid="wrapped" aria-label="包装输入" placeholder="包装输入" className="w-48" />
      </div>
      <Select defaultValue="one">
        <SelectTrigger data-testid="select" aria-label="选项" className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="one">第一项</SelectItem><SelectItem value="two">第二项</SelectItem></SelectContent>
      </Select>
    </div>
    <div data-testid="clip" className="mt-6 overflow-hidden rounded-md">
      <button data-testid="row" className="craft-focus craft-row-focus w-full bg-secondary p-3 text-left">列表行：环留在容器内</button>
    </div>
    <div id="content" className="mt-8 flex flex-wrap gap-4">
      {Object.entries(shadows).map(([name, className]) => <div key={name} data-shadow={name} className={`${className} rounded-md bg-paper p-4`}>shadow-{name}</div>)}
      <div data-testid="hover-shadow" className="shadow-xs hover:shadow-md rounded-md bg-paper p-4">hover:shadow-md</div>
    </div>
    <div className="mt-8 flex flex-wrap gap-4">
      {['minimal-flat', 'minimal', 'middle', 'strong', 'modal-small'].map(name =>
        <div key={name} data-semantic={name} style={{ boxShadow: `var(--shadow-${name})` }} className="rounded-md bg-paper p-4">{name}</div>)}
    </div>
  </main>
}
if (params.get('lifecycle') === 'true') await import('./theme-preferences-lifecycle')
else createRoot(document.getElementById('root')!).render(<React.StrictMode><Surface /></React.StrictMode>)
