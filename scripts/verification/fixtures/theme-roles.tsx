/** Actual controls, navigation, transcript and composer; isolated Chinese data. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { Circle, MessageSquare, Folder, Settings } from 'lucide-react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ModalProvider } from '@/context/ModalContext'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import { ChatInputZone } from '@/components/app-shell/input/ChatInputZone'
import { SettingsCard, SettingsRow, SettingsToggle } from '@/components/settings'
import { SessionViewer, TooltipProvider, FullscreenOverlayBase, CHAT_LAYOUT } from '@phaneris/ui'
import { CodeBlock } from '../../../packages/ui/src/components/markdown/CodeBlock'
import { BUILTIN_THEMES, type ThemePreferences, type ThemeFile } from '@config/theme'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'
import type { StoredSession } from '@phaneris/core'
import { ThemeDomainsContent } from './theme-domains-content'

const params = new URLSearchParams(location.search)
const host = params.get('css')?.split('/').at(-1)?.replace('.css', '') ?? 'electron'
const sheets = {
  electron: () => import('./theme-roles-css/electron.css?inline'),
  viewer: () => import('./theme-roles-css/viewer.css?inline'),
  webui: () => import('./theme-roles-css/webui.css?inline'),
}
const sheet = await (sheets[host as keyof typeof sheets] ?? sheets.electron)()
const style = document.createElement('style'); style.textContent = sheet.default; document.head.append(style)
const i18n = createInstance(); await i18n.init({ lng: 'zh-Hans', keySeparator: false, resources: { 'zh-Hans': { translation: zh } } })
let preferences: ThemePreferences = { mode: 'light', colorTheme: 'default', font: 'inter' }
const listeners = new Set<(value: ThemePreferences) => void>(), definitions: Record<string, ThemeFile> = { ...BUILTIN_THEMES }
const bridge = {
  getThemePreferences: async () => preferences,
  onThemePreferencesChange: (callback: (value: ThemePreferences) => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
  loadPresetTheme: async (id: string) => ({ id, path: `fixture:${id}`, theme: definitions[id]! }),
  getAutoCapitalisation: async () => false, getSendMessageKey: async () => 'enter', getSpellCheck: async () => false,
  getPendingPlanExecution: async () => null, getTransportConnectionState: async () => ({ status: 'connected' }),
  onTransportConnectionStateChanged: () => () => {}, sessionCommand: async () => {},
}
window.electronAPI = bridge as unknown as ElectronAPI
const session: StoredSession = { id: 'roles', name: '中文长文本与主题治理', workspaceId: 'fixture', createdAt: 1, lastUsedAt: 1,
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  messages: [{ id: 'user', type: 'user', timestamp: 1, content: '请检查主题在浅色、深色和窄屏上的表现。长路径：E:/项目资料/主题系统/审计与优化/长文件名说明.md。' },
    { id: 'reply', type: 'assistant', timestamp: 2, isIntermediate: false, content: '正文应清楚可读，界面控件和阅读内容分别使用明确的尺度。\n\n| 项目 | 状态 |\n| --- | --- |\n| 键盘焦点 | 可见 |\n| 长文本 | 自动换行 |' }] }
const harness = {
  choose(id: string, mode: 'light' | 'dark', fields?: Partial<ThemeFile>) { if (fields) definitions[id] = { name: 'Scale fixture', accent: '#5438bb', ...fields }; preferences = { ...preferences, mode, colorTheme: id }; listeners.forEach(callback => callback(preferences)) },
  submissions: [] as string[],
}
const shell = { workspaces: [{ id: 'fixture', name: '主题工作区', rootPath: 'E:/fixture/workspace' }], activeWorkspaceId: 'fixture',
  llmConnections: [], sessionStatuses: [], isFocusedPanel: true } as unknown as AppShellContextType
declare global { interface Window { themeRoles: typeof harness } }
window.themeRoles = harness
function Roles() {
  const theme = useTheme(), [draft, setDraft] = React.useState('请继续实施主题系统规划。'), [enabled, setEnabled] = React.useState(true), [fullscreen, setFullscreen] = React.useState(false)
  const menu = (id: string) => <DropdownMenu><DropdownMenuTrigger asChild><Button data-testid={`${id}-menu`}>操作菜单</Button></DropdownMenuTrigger>
    <StyledDropdownMenuContent><StyledDropdownMenuItem data-testid={`${id}-action`}>查看详情</StyledDropdownMenuItem></StyledDropdownMenuContent></DropdownMenu>
  return <main data-roles-ready data-status={theme.themeLoadStatus} className="h-full overflow-auto bg-background text-foreground">
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <h1 className="craft-text-title">主题系统 · 真实控件与内容</h1>
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="button">保存</Button><Button data-testid="icon" size="icon" aria-label="打开详情"><Circle /></Button>
        <Button data-testid="disabled" disabled>不可用</Button><Button data-testid="loading" loading>正在保存</Button>
        <Input data-testid="invalid" aria-label="无效输入" aria-invalid="true" placeholder="请输入有效值" className="w-44" />
        <Dialog><DialogTrigger asChild><Button data-testid="dialog">打开对话框</Button></DialogTrigger>
          <DialogContent><DialogTitle>主题对话框</DialogTitle>
            <Select defaultValue="first"><SelectTrigger data-testid="nested-select" aria-label="嵌套选项"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="first">第一项</SelectItem><SelectItem value="second">第二项</SelectItem>
            </SelectContent></Select>
            <Popover><PopoverTrigger asChild><Button data-testid="nested-popover">打开浮层</Button></PopoverTrigger><PopoverContent>
              <Button data-testid="popover-action">浮层操作</Button></PopoverContent></Popover>
            {menu('nested')}
          </DialogContent></Dialog>
        <Button data-testid="fullscreen" onClick={() => setFullscreen(true)}>打开全屏</Button>
        <FullscreenOverlayBase isOpen={fullscreen} onClose={() => setFullscreen(false)} accessibleTitle="层级验收" title="主题预览" headerActions={menu('fullscreen')}>
          <p className="text-reading text-center">全屏内容与浮层</p>
        </FullscreenOverlayBase>
      </div>
      <div className="sidebar-navigation max-w-xs" data-testid="review-sidebar"><LeftSidebar isCollapsed={params.get('collapsed') === 'true'} links={[
        { id: 'chat', title: '全部会话与中文项目', variant: 'default', icon: MessageSquare, onClick: () => {} },
        { id: 'project', title: '知识库资料整理与主题审计', variant: 'ghost', icon: Folder, onClick: () => {} },
        { id: 'settings', title: '设置', variant: 'ghost', icon: Settings, onClick: () => {} },
      ]} /></div>
      <SettingsCard><SettingsRow label="长说明与长路径" description="缩放或窄屏时保留完整的内容与可操作控件。">
        <Input aria-label="项目名称" defaultValue="主题审计与优化" /></SettingsRow>
        <SettingsToggle label="启用功能" checked={enabled} onCheckedChange={setEnabled} description="状态不只依赖颜色" />
      </SettingsCard>
      <p data-testid="ui-text" className="craft-text-label">界面标签与控件尺寸独立于阅读尺度。</p>
      <p data-testid="reading-text" className="text-reading">中文阅读内容：陕西煤业、闸门、远程连接和长文件名都应保留笔画与自然行距。</p>
      <div data-testid="transcript" className="h-80"><SessionViewer session={session} mode="readonly" defaultExpanded /></div>
      <div data-testid="transcript-column" className={`${CHAT_LAYOUT.maxWidth} ${CHAT_LAYOUT.containerPaddingX} mx-auto`}><p>转录内容边</p></div>
      <div data-testid="composer"><ChatInputZone sessionId="roles" showOptionBadges={false} compactMode={params.get('compact') === 'true'}
        inputProps={{ inputValue: draft, onInputChange: setDraft, onSubmit: value => { harness.submissions.push(value) }, currentModel: 'gpt-4.1', onModelChange: () => {} }} /></div>
      <div data-testid="code"><CodeBlock code="const answer = 42" language="typescript" /></div>
      {params.get('domains') === 'true' && <ThemeDomainsContent />}
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Provider><I18nextProvider i18n={i18n}><TooltipProvider>
  <ModalProvider><EscapeInterruptProvider><ThemeProvider><AppShellProvider value={shell}><Roles /></AppShellProvider></ThemeProvider></EscapeInterruptProvider></ModalProvider>
</TooltipProvider></I18nextProvider></Provider></React.StrictMode>)
