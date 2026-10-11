/** Actual popout state and production overlay; account and conversation data are synthetic. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSetAtom } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { ShikiThemeProvider } from '@phaneris/ui'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { ThemeProvider, useTheme } from '../../../apps/electron/src/renderer/context/ThemeContext'
import { MarkdownPopoutOverlay } from '../../../apps/electron/src/renderer/components/content-panels/MarkdownPopoutOverlay'
import { openMarkdownPopoutAtom, type MarkdownPopout } from '../../../apps/electron/src/renderer/atoms/preview'
import { Button } from '../../../apps/electron/src/renderer/components/ui/button'
import '../../../apps/electron/src/renderer/index.css'

type Input = MarkdownPopout & { renderMode?: 'formatted' | 'source' }
const source = '# 你好！我是 Phaneris 👋\n\n**保留源码标记** · Keep **Markdown** source.\n\n- 查看文件 / Read\n- 结构化展示 / Preview\n\n`const answer = 42`\n\n请问今天想先做什么？'
const content = {
  message: '你好！有什么我可以帮你的？',
  response: '# Response\n\n正文保持 **格式化**。',
  turn: '# 回合详情\n\n## 行为\n\n阅读文件并完成分析。',
  activity: '# Read\n\n**输入**：`response.md`\n\n**输出**：读取成功。',
  source,
  long: '# START OF DOCUMENT\n\n' + Array.from({ length: 100 }, (_, i) => `## 段落 ${i + 1}\n\n中文与 English 的长文内容，用于验证整张卡片滚动和阅读。`).join('\n\n') + '\n\nEND OF DOCUMENT',
  'long-source': 'START OF SOURCE\n' + Array.from({ length: 150 }, (_, i) => `line ${i + 1}: ${'long code '.repeat(30)}`).join('\n') + '\nEND OF SOURCE',
  links: '[打开网页](https://example.test/audit) 和 [打开文件](/fixture/response.md)',
}
type Kind = keyof typeof content
declare global {
  interface Window {
    popoutFixture: { ready: boolean; callbacks: { type: string; value: string }[]; setMode: (mode: 'light' | 'dark') => void; replace: (kind: Kind) => void }
  }
}
const callbacks: { type: string; value: string }[] = []
Object.assign(window, { electronAPI: new Proxy({}, { get: (_target, key: string) => key.startsWith('on') ? () => () => {} : async (...args: unknown[]) => {
  if (key === 'getThemePreferences') return { mode: 'light', colorTheme: 'default', font: 'theme' }
  if (key === 'setThemePreferences') return args[0]
  if (key === 'loadPresetTheme') return { id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }
  if (key === 'getSystemTheme') return false
  return null
} }) })
const i18n = createInstance()
await i18n.init({ lng: 'zh-Hans', keySeparator: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })

function Fixture() {
  const theme = useTheme()
  const open = useSetAtom(openMarkdownPopoutAtom)
  const show = React.useCallback((kind: Kind) => {
    const input: Input = { id: kind, sessionId: 'fixture', title: kind === 'source' || kind === 'long-source' ? 'Response Preview' : kind,
      content: content[kind], renderMode: kind === 'source' || kind === 'long-source' ? 'source' : 'formatted' }
    open(input)
  }, [open])
  React.useEffect(() => {
    window.popoutFixture = { ready: theme.themeLoadStatus === 'ready', callbacks, setMode: theme.setMode, replace: show }
  }, [theme, show])
  return <ShikiThemeProvider shikiTheme={theme.shikiTheme}>
    <main className="p-8 flex flex-wrap gap-3">
      {Object.keys(content).map(kind => <Button key={kind} data-testid={`open-${kind}`} onClick={() => show(kind as Kind)}>{kind}</Button>)}
    </main>
    <MarkdownPopoutOverlay isDark={theme.isDark} onOpenUrl={value => callbacks.push({ type: 'url', value })} onOpenFile={value => callbacks.push({ type: 'file', value })} />
  </ShikiThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Provider><I18nextProvider i18n={i18n}><ThemeProvider defaultMode="light"><Fixture /></ThemeProvider></I18nextProvider></Provider>)
