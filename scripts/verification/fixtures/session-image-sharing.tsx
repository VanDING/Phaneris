/** Production controls and export surface; synthetic conversation, native bridge recorded. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MoreHorizontal, Send, X } from 'lucide-react'
import { Toaster } from '../../../apps/electron/src/renderer/components/ui/sonner'
import { ShikiThemeProvider, TooltipProvider, PreviewHeaderIconButton, PlatformProvider, TurnCard, UserMessageBubble, ShareSelectionContext } from '@phaneris/ui'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import type { Message } from '../../../packages/core/src/types'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { ThemeProvider, useTheme } from '../../../apps/electron/src/renderer/context/ThemeContext'
import { PanelHeader } from '../../../apps/electron/src/renderer/components/app-shell/PanelHeader'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import { InlineSessionTitle } from '../../../apps/electron/src/renderer/components/chat/InlineSessionTitle'
import { blobBase64, renderSharePng } from '../../../apps/electron/src/renderer/lib/share-image-renderer'
import { DEFAULT_SHARE_OPTIONS } from '../../../apps/electron/src/shared/share-image'
import { Button } from '../../../apps/electron/src/renderer/components/ui/button'
import SharePanel from '../../../apps/electron/src/renderer/components/chat/SharePanel'
import { collectShareMessages, type ShareMessage } from '../../../apps/electron/src/renderer/lib/share-messages'
import '../../../apps/electron/src/renderer/index.css'

const sample = document.createElement("canvas")
sample.width = 320; sample.height = 100
const ink = sample.getContext("2d")!
ink.fillStyle = "#f2f3f7"; ink.fillRect(0, 0, 320, 100)
ink.fillStyle = "#222630"; ink.font = "20px sans-serif"; ink.fillText("Image attachment", 32, 56)
const rich = '# 今日记录\n\n中文与 English，保持完整内容。**加粗结论**，以及 [参考链接](https://example.test/reference)。\n\n| 项目 | 数值 | 说明 |\n|---|---:|---|\n| 中文列 | 42 | 表格不截断 |\n| Review | 86 | 保留原始结果 |\n\n## 示例代码\n\n~~~typescript\nconst greeting = "你好，Phaneris";\nconsole.log(greeting);\n~~~\n\n行内公式 $E=mc^2$。\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n~~~mermaid\nflowchart LR\n  A[选择内容] --> B[生成图片]\n  B --> C[复制或保存]\n~~~\n\n![示例图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==)\n\nRICH-END'.replace(/!\[示例图\]\([^\n]+\)/, '~~~image-preview\n{"src":"/fixture/image.png","title":"示例图"}\n~~~')
const long = Array.from({ length: 40 }, (_, i) => '## 记录 ' + (i + 1) + '\n\n段落编号 ' + (i + 1) + '。中文长文验证，保留顺序与全部内容。' + '详细说明和 English content。'.repeat(5)).join('\n\n') + '\n\nLONG-END'
const table = '| 编号 | A | B | C | D | E | F | G | H |\n|---|---|---|---|---|---|---|---|---|\n' + Array.from({ length: 120 }, (_, i) => '| row-' + i + ' | aa | bb | cc | dd | ee | ff | gg | end-' + i + ' |').join('\n')
const giant = '~~~text\n' + Array.from({ length: 600 }, (_, i) => 'CODE-LINE-' + i + ' 中文与长代码').join('\n') + '\n~~~\n\nGIANT-END'
const at = (hour: number, minute: number) => new Date(2026, 10, 2, hour, minute).getTime()
const messages: ShareMessage[] = [
  { id: 'q1', role: 'user', content: '请整理今天的记录。', timestamp: at(15, 12), position: 0 },
  { id: 'a1', role: 'assistant', content: rich, timestamp: at(15, 13), position: 1 },
  { id: 'q2', role: 'user', content: '继续补充历史内容。', timestamp: at(15, 14), position: 2 },
  { id: 'a2', role: 'assistant', content: '第二个回答，可以单独分享。', timestamp: at(15, 15), position: 3 },
]
const history = Array.from({ length: 66 }, (_, i): ShareMessage => ({
  id: 'history-' + i, role: i % 2 ? 'assistant' : 'user', position: i, content: '历史消息 ' + i,
  timestamp: at(8, 0) + i * 60_000,
}))
type Kind = 'rich' | 'long' | 'table' | 'giant' | 'history' | 'broken' | 'oversized' | 'giantLong'
const variants: Record<Kind, ShareMessage[]> = {
  rich: messages, history,
  oversized: [{ id: 'oversized', role: 'assistant', content: long.repeat(5), timestamp: at(16, 0), position: 0 }],
  long: [{ id: 'long', role: 'assistant', content: long, timestamp: at(16, 0), position: 0 }],
  table: [{ id: 'table', role: 'assistant', content: table, timestamp: at(16, 1), position: 0 }],
  giantLong: [{ id: 'giantLong', role: 'assistant', content: giant, timestamp: at(16, 2), position: 0 }],
  giant: [{ id: 'giant', role: 'assistant', content: giant.replace(/CODE-LINE-(?:[45]\d\d)[^\n]*\n/g, ''), timestamp: at(16, 2), position: 0 }],
  broken: [{ id: 'broken', role: 'assistant', content: '![无法读取](http://127.0.0.1:1/missing.png)', timestamp: at(16, 3), position: 0 }],
}
const records = { copies: [] as string[], saves: [] as { sessionId: string; images: string[] }[] }
declare global {
  interface Window {
    shareFixture: { ready: boolean; open: (kind: Kind, id?: string) => void; records: typeof records
      renderPage: (index: number) => Promise<string>; setMode: (mode: 'light' | 'dark') => void; collect: () => ShareMessage[] }
  }
}
Object.assign(window, { electronAPI: new Proxy({
  shareImages: {
    copy: async (png: string) => { records.copies.push(png) },
    save: async (request: { sessionId: string; images: string[] }) => {
      records.saves.push(request); return { directory: '/fixture/exports/shares', paths: ['/fixture/exports/shares/01.png'] }
    },
  },
}, { get: (target, key: string) => key in target ? target[key as keyof typeof target] : key.startsWith('on') ? () => () => {} : async (...args: unknown[]) => {
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
  const [title, setTitle] = React.useState('Market and Portfolio Strategy')
  const [editing, setEditing] = React.useState(false)
  const [kind, setKind] = React.useState<Kind>('rich')
  const [selecting, setSelecting] = React.useState(false)
  const [preview, setPreview] = React.useState(false)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [options, setOptions] = React.useState(DEFAULT_SHARE_OPTIONS)
  const origin = React.useRef<HTMLElement | null>(null)
  const open = (nextKind: Kind, id?: string) => {
    origin.current = document.activeElement as HTMLElement
    setKind(nextKind); setSelecting(true); setPreview(false); setSelected(new Set(id ? [id] : [])); setOptions(DEFAULT_SHARE_OPTIONS)
  }
  const close = () => { setSelecting(false); setPreview(false); requestAnimationFrame(() => origin.current?.focus()) }
  const selection = React.useMemo(() => selecting ? {
    eligible: new Set(variants[kind].map(message => message.id)), selected,
    onToggle: (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next }),
  } : null, [kind, selecting, selected])
  const picked = React.useMemo(() => variants[kind].filter(message => selected.has(message.id)), [kind, selected])
  React.useEffect(() => {
    window.shareFixture = { ready: theme.themeLoadStatus === 'ready', open, records, setMode: theme.setMode,
      renderPage: async index => blobBase64(await renderSharePng(document.querySelectorAll<HTMLElement>('[data-share-preview-index] .share-page')[index], new Map())),
      collect: () => collectShareMessages([
        { id: 'question', role: 'user', content: '真实问题', timestamp: 1 },
        { id: 'thinking', role: 'assistant', content: '内部步骤', timestamp: 2, isIntermediate: true },
        { id: 'tool', role: 'tool', content: '工具输出', timestamp: 3, toolName: 'Read' },
        { id: 'final', role: 'assistant', content: '已完成回答', timestamp: 4 },
        { id: 'next', role: 'user', content: '追问', timestamp: 5 },
        { id: 'streaming', role: 'assistant', content: '生成中', timestamp: 6, isStreaming: true, isPending: true },
      ] as Message[], true) }
  }, [theme])
  return <ShikiThemeProvider shikiTheme={theme.shikiTheme}><TooltipProvider><PlatformProvider actions={{ onReadFileDataUrl: async () => sample.toDataURL() }}>
    <ShareSelectionContext.Provider value={selection}><div className="h-screen relative flex flex-col" onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented && selecting && !preview) close()
    }}>
      <div inert={preview || undefined} className="h-full flex flex-col">
        <PanelHeader title={title} titleAlignment="start" actionCount={2}
          titleContent={<InlineSessionTitle title={title} editing={editing} onEditingChange={setEditing} onRename={setTitle} />}
          actions={<div className="flex gap-1.5"><PreviewHeaderIconButton aria-label="更多选项"><MoreHorizontal className="w-4 h-4" /></PreviewHeaderIconButton><PreviewHeaderIconButton aria-label="分享为图片" onClick={() => open(kind)}><Send className="w-4 h-4" /></PreviewHeaderIconButton></div>}
          trailingAction={<PreviewHeaderIconButton aria-label="关闭"><X className="w-4 h-4" /></PreviewHeaderIconButton>} />
        <div data-testid="transcript" className="overflow-auto flex-1 p-8"><div className="max-w-[850px] mx-auto space-y-6">
          {variants[kind].map(message => message.role === 'user'
            ? <UserMessageBubble key={message.id} messageId={message.id} content={message.content} />
            : <TurnCard key={message.id} turnId={message.id} activities={[]} isStreaming={false} isComplete
                response={{ text: message.content, isStreaming: false, messageId: message.id }} onBranch={() => {}} onShare={id => open(kind, id)} />)}
        </div></div>
        <div className="relative"><textarea style={{ visibility: selecting ? 'hidden' : undefined }} inert={selecting || undefined} data-testid="draft" aria-label="草稿" className="craft-control m-5 p-3" defaultValue="尚未发送的草稿" />
          {selecting && <footer className="share-selection-bar absolute inset-x-0 bottom-0" aria-label="选择分享内容">
            <span>已选 {selected.size} 条内容</span><div className="share-selection-actions">
              <Button variant="ghost" onClick={() => setSelected(new Set(variants[kind].map(message => message.id)))}>全选</Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>清空</Button>
              <Button variant="ghost" onClick={close}>取消</Button>
              <Button disabled={!selected.size} onClick={() => setPreview(true)}>图片预览</Button>
            </div></footer>}
        </div>
      </div>
      {preview && <SharePanel sessionId="fixture-session" title={title} messages={picked} options={options} onOptionsChange={setOptions} onBack={() => setPreview(false)} onClose={close} />}
    </div></ShareSelectionContext.Provider><Toaster />
  </PlatformProvider></TooltipProvider></ShikiThemeProvider>
}
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><ThemeProvider defaultMode="light"><AppShellProvider value={{ isCompactMode: false } as AppShellContextType}><Fixture /></AppShellProvider></ThemeProvider></I18nextProvider>)
