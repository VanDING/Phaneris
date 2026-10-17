/**
 * 复核结论：逐条核对每个"非建议图形"在代码里的真实身份。
 *
 * 判定类型：
 *   redundant 同一语义的重复取用（同一角色、同一场景，只是图形不同）→ 可收敛
 *   new       语义确实不同，应独立成一个用途（第二个元素是用途名）
 *   move      应归入另一个已有用途（第二个元素是用途 id）
 *   paired    同一控件的两种状态，天然成对，必须一起保留
 *   demo      生产代码没有渲染，只出现在 playground / 图标表 / 验证脚本里
 *   uncertain 证据不足以判定，需要产品确认
 *
 * 每条的第三个元素是证据（涉及的文件或场景）。
 */

export const verdicts = {
  // ------------------------------------------------------------ 一级导航
  sessions: {
    'messages-square': ['new', '消息集成', 'MainContentPanel 空状态、MessagingSettingsPage 消息集成设置、TrajectoryContextView 助手标识'],
    'message-circle-dashed': ['new', '回合进行中', 'TurnCard.tsx:973 回合卡片的进行中状态'],
    'message-circle-more': ['demo', '仅 playground/registry'],
    'message-circle-question-mark': ['new', '提问', 'QuestionPanel.tsx 提问面板'],
    'message-square-more': ['new', 'AI 会话设置', 'AiSettingsPage.tsx 的会话相关入口'],
  },
  calendar: {
    calendar: ['redundant', 'calendar-days', 'AppShell、CompactSessionListFilter 与入口同为"日历/日期"，图形只差日期点'],
    'calendar-off': ['paired', 'CalendarView、GanttView 的"无日程/已关闭"状态'],
  },
  gantt: {
    diamond: ['new', '里程碑', 'GanttView 视图内的里程碑标记，与入口图标不是一回事'],
  },
  filesPanel: {
    files: ['new', '变更文件', 'ChangedFilesView 变更文件列表'],
    'folder-search': ['new', '在文件中搜索', 'TerminalPreviewOverlay'],
    'folder-symlink': ['new', '远程目录', 'ServerDirectoryBrowser 服务端目录浏览'],
  },
  terminal: {
    terminal: ['new', '终端输出', 'TerminalOutput、TerminalPreviewOverlay：入口用方框终端，内容用提示符'],
  },
  browser: {
    earth: ['new', '公开分享', 'SharePageDialog（pages.share.noPassword）、PageTile、PageView：公开可访问的链接'],
  },
  pages: {
    'panel-top': ['new', '顶部面板', 'AppShell'],
    'panels-top-left': ['new', '页面首页', 'PagesHome'],
  },
  sources: {
    'hard-drive': ['new', '本地来源', 'source-avatar 的本地文件来源头像'],
    database: ['demo', '仅 playground/demos'],
  },
  skills: {
    'book-open': ['new', '文档与代码预览', 'DocsOverlay、CodePreviewOverlay：属于文档/代码预览，不是技能'],
    bot: ['new', '智能体标识', 'AppShell'],
  },
  plugins: {
    shapes: ['new', '插件头像', 'plugin-avatar 兜底头像、PluginsListPanel'],
    layers: ['new', '上下文策略与分组', 'sidebar.group、sessionMenu.contextStrategy、ActivityCardsOverlay：与插件无关'],
    'package-open': ['new', '工作台面板', 'ContextWorkbenchTabs'],
    package: ['demo', '生产 0 处'],
  },
  automations: {
    webhook: ['new', '事件触发', 'ActionTypeIcon、AutomationAvatar、AutomationsListPanel 的触发类型'],
    workflow: ['new', '工作流', 'TaskChatPreview'],
  },
  labels: {
    hash: ['new', '编号标签', 'label-icon 的数字类型、AutomationInfoPage'],
    tags: ['demo', '仅 playground'],
  },
  settings: {
    'settings-2': ['redundant', 'settings', 'SidebarMenu、AiSettingsPage、MessagingSettingsPage 与 settings 同为设置入口'],
  },
  kanban: {
    'columns-3': ['replace', 'square-kanban', 'columns-3 是通用三列，Lucide 有专用 square-kanban，与甘特图的 square-chart-gantt 成对'],
  },
  table: {
    'table-2': ['replace', 'table', 'table-2 是历史命名，直接用 table 更清晰'],
  },
  send: {
    'arrow-up': ['paired', 'FreeFormInput 的发送按钮：上箭头与纸飞机同义，保留其一'],
  },
  permissionMode: {
    shield: ['paired', 'AutomationAvatar 的权限盾'],
  },

  // ------------------------------------------------------------ 工作台
  workbenchTab: {
    'panel-left': ['demo', '仅 playground'],
    'panel-right-open': ['new', '打开侧栏', 'BrowserTabStrip'],
  },
  expand: {
    'chevrons-up': ['new', '展开全部', 'ChangedFilesView'],
  },
  collapse: {
    minus: ['new', '缩放', 'ZoomControls 的缩小按钮、TrajectoryMapView 的 zoomOut：属于缩放，不是收起'],
  },
  pin: {
    'map-pin': ['new', '位置', 'SidebarProfile'],
  },
  closePanel: {
    'square-slash': ['demo', '生产 0 处'],
  },

  // ------------------------------------------------------------ 通用操作
  search: {
    'zoom-in': ['demo', '生产 0 处'],
    'zoom-out': ['demo', '生产 0 处'],
  },
  filter: {
    funnel: ['redundant', 'list-filter', 'WorkItemFilterControls 与 AppShell/CompactSessionListFilter 同为筛选控件（funnel 是 Filter 的规范名）'],
  },
  add: {
    'folder-plus': ['new', '新建文件夹', 'WorkspaceSwitcher 打开/新建工作区目录'],
    'file-plus': ['new', '新建文件', 'ChangedFilesView、MultiDiffPreviewOverlay'],
  },
  check: {
    'check-check': ['new', '全部标记', 'SidebarMenu'],
    'circle-check-big': ['new', '连接成功', 'AddWorkspaceStep_ConnectRemote 的完成态'],
    'square-check-big': ['new', '任务完成', 'WorkItemListView 的完成勾选'],
  },
  chevronDown: {
    'arrow-up-down': ['move', 'sort', 'MarkdownDatatableBlock 表格排序'],
    'chevrons-up-down': ['new', '折叠切换', 'TrajectoryContextView'],
  },
  chevronRight: {
    'corner-down-right': ['new', '树形子项', 'SessionItem、SessionMenu、decision-view：层级缩进'],
    'arrow-up-right': ['new', '外链跳转', 'TurnCardActionsMenu、SidebarProfile、MessagingSettingsPage'],
    'arrow-right': ['new', '决策流向', 'decision-view、DecisionSummary'],
  },
  chevronLeft: {
    'arrow-left': ['new', '返回上一步', 'PageView（pages.backToPages）、AddWorkspaceStep_* 向导上一步'],
  },
  chevronUp: {
    'arrow-up': ['move', 'send', 'FreeFormInput 的发送按钮，属于发送语义'],
  },
  copy: {
    'clipboard-paste': ['demo', '生产 0 处'],
  },
  edit: {
    'file-pen-line': ['new', '编辑产物文件', 'ArtifactWorkbench（artifact.edit）、ArtifactsPanel'],
    'pencil-line': ['new', '行内编辑', 'ChangedFilesView、MultiDiffPreviewOverlay'],
    'pen-line': ['new', '编辑代码', 'CodePreviewOverlay'],
  },
  refresh: {
    'refresh-ccw': ['redundant', 'refresh-cw', 'AiSettingsPage、MessagingSettingsPage 与 refresh-cw 同为"刷新连接"'],
    'rotate-cw': ['redundant', 'refresh-cw', 'BrowserControls 浏览器刷新、ServerSettingsPage：与刷新同义，只是方向相反'],
    'rotate-ccw': ['new', '重新生成', 'artifact.revise（ArtifactCard、ArtifactWorkbench）、FilePreviewContent 重试加载'],
    'redo-2': ['demo', '只出现在 app-menu 图标表'],
    'undo-2': ['demo', '只出现在 app-menu 图标表'],
  },
  stop: {
    'circle-pause': ['new', '暂停', 'AutomationInfoPage 暂停自动化：与"停止生成"不是一件事'],
  },
  archive: {
    'archive-restore': ['paired', 'sessionMenu.unarchive 取消归档，与 archive 成对'],
    inbox: ['new', '收件箱', 'AppShell、SessionList、CompactSessionListFilter'],
  },
  attach: {
    'link-2': ['new', '关联对象', 'ContextWorkbenchTabs、WorkItemListView'],
    'link-2-off': ['new', '停止共享', 'sessionMenu.stopSharing、ChatPage'],
    link: ['new', '链接标签', 'label-icon 的链接类型'],
  },
  lock: {
    key: ['new', '密钥凭证', 'CredentialRequest、AuthRequestCard、APISetupStep：API Key 输入'],
    'key-round': ['new', '权限授予', 'PageGrantRequestDialog、PageSourceAuthBanner、PageView'],
    'lock-keyhole': ['redundant', 'lock', 'PreferencesPage：与 lock 同为"锁定"，只是锁孔造型'],
    'lock-open': ['paired', 'MessagingSettingsPage 的解锁态'],
  },
  visibility: {
    'eye-off': ['paired', 'ApiKeyInput、CredentialRequest、SettingsInput：同一控件的隐藏态'],
  },

  // ------------------------------------------------------------ 状态
  warning: {
    'shield-alert': ['new', '安全告警', 'AdminApprovalRequest、PermissionRequest、AccessModeBanner'],
    'cloud-alert': ['demo', '生产 0 处'],
  },
  error: {
    'circle-alert': ['uncertain', '与 circle-x 同为错误提示，二者在 ChatDisplay、TurnCard 等同一批文件里并存，数量相当，需产品确认是"严重级别"还是重复取用'],
  },
  blocked: {
    'circle-slash': ['new', '停用状态', 'TaskEditor、AutomationEventTimeline'],
    shield: ['move', 'permissionMode', 'AutomationAvatar 的权限盾，不属于"禁用"'],
  },
  clock: {
    'clock-3': ['redundant', 'clock', 'SidebarProfile、decision-view、TrajectoryOverview：与 clock 只是表盘刻度差异'],
  },

  // ------------------------------------------------------------ 文件与版本
  code: {
    braces: ['new', 'JSON 预览', 'JSONPreviewOverlay、TrajectoryOverview'],
    code: ['paired', 'TiptapBubbleMenus 富文本工具条里的行内代码按钮'],
    sigma: ['paired', 'TiptapBubbleMenus 公式按钮'],
    variable: ['new', '变量', 'APISetupStep'],
  },
  image: {
    camera: ['new', '相机', 'PreferencesPage'],
    'file-image': ['new', '图片产物', 'ArtifactCard'],
  },
  media: {
    'file-headphone': ['new', '音频产物', 'ArtifactCard'],
    'file-play': ['new', '视频产物', 'ArtifactCard'],
  },
  viewSwitch: {
    'layout-grid': ['new', '网格视图', '生产 0 处：当前只有列表视图，属于新增'],
  },
  diff: {
    'git-compare-arrows': ['new', '版本对比', 'ChangedFilesView、RecordInspector'],
  },
  branch: {
    'git-graph': ['new', '图谱预览', 'MermaidPreviewOverlay'],
    group: ['new', '分组', 'MarkdownDatatableBlock'],
  },
  cloudState: {
    cloud: ['paired', 'WorkspaceSwitcher、SendToWorkspaceDialog：云端工作区'],
    'cloud-off': ['paired', '同批文件：离线/本地工作区'],
    'cloud-upload': ['new', '上传到云端', 'CompactSessionMenu、SessionMenu'],
  },

  // ------------------------------------------------------------ 对话与运行
  tools: {
    bug: ['demo', '生产 0 处'],
  },
  plan: {
    'list-checks': ['new', '自动化检查项', 'AutomationAvatar'],
  },
  mail: {
    mail: ['uncertain', 'mail-open 生产 4 处用于"标记未读"（sessionMenu.markAsUnread），mail 只用于来源头像；两者语义分配与图形直觉相反，需确认'],
  },
  network: {
    radio: ['new', '实时推送', 'AppShell'],
  },
  power: {
    power: ['paired', 'AutomationMenu、BatchAutomationMenu：启用/停用成对出现'],
    'toggle-right': ['demo', '生产 0 处'],
  },
  dragHandle: {
    'grip-horizontal': ['redundant', 'grip-vertical', 'EditPopover 的横向手柄与 resizable 的纵向手柄是同一角色，方向不必分两套'],
    'locate-fixed': ['new', '定位', 'TrajectoryMapView（trajectory.execution.locate）'],
    'mouse-pointer-click': ['new', '点击热区', 'page-visuals'],
    focus: ['demo', '生产 0 处'],
  },

  // ------------------------------------------------------------ 设置
  themeSystem: {
    atom: ['new', '模型', 'APISetupStep'],
    cpu: ['new', '算力', 'APISetupStep'],
    laptop: ['new', '设备', 'SendToWorkspaceDialog'],
  },
  account: {
    'circle-user': ['new', '偏好设置', '只出现在 app-menu 与 SettingsIcons 图标表，生产未直接渲染（PreferencesIcon 用它）'],
    'log-out': ['new', '退出登录', 'DesktopAppMenu'],
    'user-round': ['new', '头像兜底', 'SidebarProfile、TrajectoryContextView'],
    users: ['new', '成员列表', 'TelegramAccessSection'],
    accessibility: ['demo', '仅 playground/MotionToggle'],
  },
  keyboard: {
    type: ['new', '文本标签', 'label-icon 的文本类型'],
  },
  usage: {
    coins: ['new', 'token 用量', 'TrajectoryOverview（trajectory.overview.tokens）'],
    'credit-card': ['new', '计费', 'APISetupStep'],
  },

  // ------------------------------------------------------------ 编辑
  formatText: {
    italic: ['paired', 'TiptapBubbleMenus 同一工具条'],
    strikethrough: ['paired', 'TiptapBubbleMenus 同一工具条'],
    scissors: ['demo', '生产 0 处'],
    'square-dashed-text': ['demo', '生产 0 处'],
  },
  flag: {
    'flag-off': ['paired', 'sessionMenu.unflag 取消标记，与 flag 成对'],
    star: ['new', '收藏', 'AiSettingsPage'],
  },
}
