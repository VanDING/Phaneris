import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { motionTween } from '@phaneris/ui/motion'
import { Database, Folder, MessagesSquare, PanelLeft, Tags } from 'lucide-react'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import { SidebarProfile } from '@/components/app-shell/SidebarProfile'
import { SIDEBAR_RAIL_WIDTH } from '@/components/app-shell/panel-constants'
import { SessionList, type ChatGroupingMode } from '@/components/app-shell/SessionList'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import type { SessionMeta } from '@/atoms/sessions'
import { ProfileActivityHeatmap } from '@/pages/settings/ProfileActivityHeatmap'
import { computeProfileActivity } from '@/pages/settings/profile-activity'
import { MobilePlaygroundProviders } from './mobile-webui/MobilePlaygroundProviders'
import { MOBILE_WORKSPACE_ID, MOCK_SESSION_STATUSES } from './mobile-webui/mock-mobile-data'

const now = Date.now()
const demoSessions: SessionMeta[] = [
  { id: 'nav-parent', workspaceId: MOBILE_WORKSPACE_ID, name: '优化 Phaneris 界面', sessionStatus: 'todo', createdAt: now - 100000, lastMessageAt: now - 10000 },
  { id: 'nav-activity', workspaceId: MOBILE_WORKSPACE_ID, parentSessionId: 'nav-parent', name: '评估 Activity 热力图', sessionStatus: 'done', createdAt: now - 90000, lastMessageAt: now - 9000 },
  { id: 'nav-sidebar', workspaceId: MOBILE_WORKSPACE_ID, parentSessionId: 'nav-parent', name: '设计侧栏收起过渡', sessionStatus: 'in-progress', isProcessing: true, createdAt: now - 80000, lastMessageAt: now },
  { id: 'nav-sessions', workspaceId: MOBILE_WORKSPACE_ID, parentSessionId: 'nav-parent', name: '实现 Session 分组', sessionStatus: 'todo', hasUnread: true, createdAt: now - 70000, lastMessageAt: now - 7000 },
  { id: 'nav-other', workspaceId: MOBILE_WORKSPACE_ID, name: '梳理项目文档', sessionStatus: 'done', createdAt: now - 100000000, lastMessageAt: now - 100000000 },
]

function PreviewContent() {
  const shell = useAppShellContext()
  const desktop = useMemo(() => ({ ...shell, isCompactMode: false }), [shell])
  const [collapsed, setCollapsed] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [selected, setSelected] = useState('nav-parent')
  const [items, setItems] = useState(demoSessions)
  const [grouping, setGrouping] = useState<ChatGroupingMode>('date')
  const reduceMotion = useReducedMotion()
  const activity = useMemo(() => computeProfileActivity(Array.from({ length: 160 }, (_, i) => ({ createdAt: now - ((i * 17) % 365) * 86400000 }))), [])
  return (
    <AppShellProvider value={desktop}>
      <div className="w-full max-w-[1024px] overflow-hidden rounded-xl border border-border bg-background text-foreground">
        <div className="flex items-center gap-3 border-b border-border p-2">
          <button aria-label="Toggle sidebar" onClick={() => setCollapsed(value => !value)} className="rounded-md p-2 hover:bg-foreground/5"><PanelLeft className="size-4" /></button>
          <span className="text-sm">Navigation refinement</span>
          <select aria-label="Group sessions" value={grouping} onChange={event => setGrouping(event.target.value as ChatGroupingMode)} className="ml-auto rounded bg-background text-sm">
            {['date', 'status', 'unread', 'project'].map(mode => <option key={mode}>{mode}</option>)}
          </select>
        </div>
        <div className="flex h-[440px]">
          <motion.div initial={false} animate={{ width: collapsed ? SIDEBAR_RAIL_WIDTH : 220 }} transition={motionTween(reduceMotion, 'spatial', 'move')} className="sidebar-navigation flex shrink-0 flex-col overflow-hidden" data-collapsed={collapsed || undefined}>
            <LeftSidebar isCollapsed={collapsed} links={[
              { id: 'all', title: '所有对话', icon: MessagesSquare, variant: 'default', onClick: () => {}, expandable: true, expanded: true, items: [{ id: 'done', title: '已完成', icon: MessagesSquare, variant: 'ghost' }] },
              { id: 'labels', title: '标签', icon: Tags, variant: 'ghost' },
              { id: 'sources', title: '数据源', icon: Database, variant: 'ghost' },
              { id: 'projects', title: '项目', icon: Folder, variant: 'ghost' },
            ]} />
            <div className="mt-auto px-2 pb-2"><SidebarProfile isCollapsed={collapsed} open={profileOpen} onOpenChange={setProfileOpen} onOpenProfile={() => {}} onOpenSettings={() => {}} profileButtonProps={{}} settingsButtonProps={{}} /></div>
          </motion.div>
          <div className="flex w-[300px] shrink-0 flex-col border-x border-border bg-paper">
            <SessionList items={items} workspaceId={MOBILE_WORKSPACE_ID} groupingMode={grouping} focusedSessionId={selected}
              onNavigateToSession={setSelected} onDelete={async () => true} onMarkUnread={() => {}} onRename={() => {}}
              onSessionStatusChange={(id, status) => setItems(previous => previous.map(item => item.id === id ? { ...item, sessionStatus: status } : item))}
              sessionStatuses={MOCK_SESSION_STATUSES} />
          </div>
          <div className="min-w-0 flex-1 p-5" aria-live="polite"><p className="text-sm">{items.find(item => item.id === selected)?.name}</p><p className="mt-2 text-xs text-muted-foreground">{selected}</p></div>
        </div>
        <div className="border-t border-border px-5"><ProfileActivityHeatmap calendar={activity.calendar} locale="zh-CN" /></div>
      </div>
    </AppShellProvider>
  )
}

export function NavigationRefinementPreview() {
  return <MobilePlaygroundProviders sessions={demoSessions}><PreviewContent /></MobilePlaygroundProviders>
}
