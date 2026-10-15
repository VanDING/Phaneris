import React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Provider } from 'jotai'
import { Inbox, Tag, DatabaseZap, Zap, Shapes, FolderKanban, PanelTop, ListTodo } from 'lucide-react'
import { ThinkingIndicator, TooltipProvider } from '@phaneris/ui'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import { SessionMenu } from '@/components/app-shell/SessionMenu'
import { CircleEye } from '@/components/icons/TodoStateIcons'
import { McpIcon } from '@/components/icons/McpIcon'
import { FileTreeNode, type SessionFile } from '@/lib/session-file-tree'
import { FileTypeIcon } from '@/components/icons/FileTypeIcon'
import { ProfileActivityHeatmap } from '@/pages/settings/ProfileActivityHeatmap'
import { computeProfileActivity } from '@/pages/settings/profile-activity'
import { NavigationContext } from '@/contexts/NavigationContext'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatus } from '@/config/session-status-config'
import en from '../../../packages/shared/src/i18n/locales/en.json'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
const noop = () => {}
const allFileIconAssets = import.meta.glob<string>('../../../apps/electron/src/renderer/assets/file-icons/*.svg', { eager: true, query: '?url', import: 'default' })
const navigation: NonNullable<React.ContextType<typeof NavigationContext>> = {
  navigate: noop, navigateToSession: noop, navigateToSource: noop, goBack: noop, goForward: noop,
  isReady: true, canGoBack: false, canGoForward: false,
  navigationState: { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null },
}
const statuses: SessionStatus[] = [{ id: 'needs-review', label: 'Needs review', resolvedColor: 'var(--warning)',
  icon: <ReviewIcon />, iconColorable: true, category: 'open' }]
function ReviewIcon(_props: { bare?: boolean }) { return <CircleEye /> }
const item: SessionMeta = { id: 'ui-fixture', workspaceId: 'fixture', name: '投资组合交易复盘', sessionStatus: 'needs-review',
  createdAt: 1, lastMessageRole: 'assistant', lastFinalMessageId: 'reply', preview: 'Portfolio review' }
const files = ['apply-renshou-sale.py', 'config_diff.py', 'probe1.txt', 'app.ts', 'app.d.ts', 'App.tsx', 'script.js',
  'package.json', 'session.jsonl', '.env.local', 'README.md', 'report.pdf', 'report.docx', 'ledger.xlsx', 'slides.pptx',
  'holdings.csv', 'archive.tar.gz', 'chart.svg', 'photo.png', 'unknown.custom']
const tree: SessionFile = { name: 'This session', type: 'directory', path: '/fixture', children: [
  { name: 'data', type: 'directory', path: '/fixture/data', children: files.map(name => ({ name, type: 'file', path: `/fixture/data/${name}`, size: 1024 })) },
] }
const now = new Date(2026, 9, 15)
const activity = computeProfileActivity(Array.from({ length: 200 }, (_, i) => ({ createdAt: +now - ((i * 17) % 78) * 86400000 })), now)

function Fixture() {
  const [collapsed, setCollapsed] = React.useState(false)
  const [expanded, setExpanded] = React.useState(new Set(['/fixture', '/fixture/data']))
  const [selected, setSelected] = React.useState<string>()
  const [action, setAction] = React.useState('')
  return <main style={{ padding: 24, minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)' }}>
    <div data-all-file-icons style={{ display: 'none' }}>{Object.entries(allFileIconAssets).map(([name, src]) => <img key={name} data-name={name} src={src} alt="" />)}</div>
    <div data-native-icon aria-hidden="true" style={{ display: 'none' }}><span className="navigation-icon"><McpIcon /></span></div>
    <section data-testid="activity" style={{ maxWidth: 760, marginBottom: 32 }}>
      <h1 className="mb-4 text-sm font-medium">Activity</h1>
      <ProfileActivityHeatmap calendar={activity.calendar} locale="en" />
    </section>
    <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(200px, 360px) minmax(180px, 1fr)', gap: 24 }}>
      <section>
        <button className="mb-4 text-sm" onClick={() => setCollapsed(value => !value)}>Toggle sidebar</button>
        <div className="sidebar-navigation" data-collapsed={collapsed || undefined} style={{ width: collapsed ? 48 : 200 }}>
          <LeftSidebar isCollapsed={collapsed} links={[
            ['Sessions', Inbox], ['Labels', Tag], ['Sources', DatabaseZap], ['Automations', Zap],
            ['Skills', Shapes], ['Projects', FolderKanban], ['Pages', PanelTop], ['Tasks', ListTodo],
          ].map(([title, icon]) => ({ id: String(title), title: String(title), icon, variant: 'ghost', onClick: () => setAction(`${title} selected`) }))} />
        </div>
        <div className="mt-8 flex items-center gap-2 text-sm"><ThinkingIndicator className="text-[14px]" />Thinking…</div>
        <div className="mt-4 flex gap-4">
          {[10, 12, 16, 24].map(size => <span data-thinking-size={size} key={size} style={{ fontSize: size }}><ThinkingIndicator /></span>)}
        </div>
        <output>{action}</output>
      </section>
      <section data-testid="files">
        <h2 className="mb-4 text-sm font-medium">Files · Browse</h2>
        <FileTreeNode file={tree} depth={0} isRoot expandedPaths={expanded} selectedPath={selected}
          onToggleExpand={path => setExpanded(previous => { const next = new Set(previous); if (!next.delete(path)) next.add(path); return next })}
          onFileClick={file => setSelected(file.path)} onFileDoubleClick={noop} />
      </section>
      <section>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-control border border-border px-3 py-2 text-sm">Session options</DropdownMenuTrigger>
          <StyledDropdownMenuContent align="start" side="bottom">
            <DropdownMenuProvider><SessionMenu item={item} sessionStatuses={statuses} labels={[{ id: 'work', name: 'Work', color: 'accent' }]}
              projects={[{ id: 'project', slug: 'project', name: 'Project' }]} onSetProjectId={noop}
              onRename={() => setAction('Rename selected')} onFlag={noop} onUnflag={noop} onArchive={noop} onUnarchive={noop}
              onMarkUnread={noop} onSessionStatusChange={noop} onOpenInNewWindow={noop} onOpenSideBySide={noop} onDelete={noop} />
            </DropdownMenuProvider>
          </StyledDropdownMenuContent>
        </DropdownMenu>
        <div className="mt-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 16px)', gap: 16 }} data-testid="catalog">
          {['code.rs', 'main.go', 'view.vue', 'app.svelte', 'main.c', 'main.cpp', 'Main.java', 'App.cs', 'app.swift', 'app.kt',
            'app.rb', 'app.php', 'data.sql', 'model.db', 'notebook.ipynb', 'script.ps1', 'script.sh', 'font.woff2', 'video.mp4',
            'song.mp3', 'bun.lock', 'config.toml', 'config.yml', 'layout.xml'].map(name => <FileTypeIcon key={name} name={name} />)}
        </div>
      </section>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><Provider><NavigationContext.Provider value={navigation}>
  <TooltipProvider><Fixture /></TooltipProvider>
</NavigationContext.Provider></Provider></I18nextProvider>)
