/**
 * 重选方案：在 Lucide 内部为每个语义用途定一个主图形。
 *
 * - recommend  显式指定的主图形（不写则取该用途当前导入次数最多的图形）
 * - also       允许保留的第二图形（有明确且不同的使用场景时才写）
 * - why        取舍说明（一个用途当前存在多个图形时必须写）
 * - regroup    把归错用途的组件挪到正确用途
 * - extraPurposes / extraGroups  方案新增的用途与分区
 *
 * 变更类型由构建时计算：
 *   keep    现状只有一个图形，且就是建议图形
 *   rename  图形不变，但导入名是 lucide v1 的旧名（视觉零变化）
 *   merge   建议图形正在使用，同用途的其他图形收敛掉
 *   replace 建议图形当前没在用，属于换图形
 *   new     该用途当前没有图形
 */

export const extraGroups = [{ id: 'misc', title: '指示与占位' }]

export const extraPurposes = [
  {
    id: 'dot', group: 'misc', label: '状态圆点', current: 'Circle',
    note: '状态点、单选指示与骨架占位用的是几何图形，不是语义图标。建议保留 Circle 一族，但不参与语义图标表。',
  },
]

/** 归错用途的组件：Shapes 是插件兜底头像，Diamond 是甘特图里程碑，Circle 一族是指示点。 */
export const regroup = {
  Shapes: 'plugins',
  Diamond: 'gantt',
  Circle: 'dot',
  CircleIcon: 'dot',
}

/** 主图形：只写需要偏离"当前用得最多的那个"的用途。 */
export const recommend = {
  kanban: 'square-kanban',
  table: 'table',
  plugins: 'plug',
  usage: 'gauge',
  decisions: 'clipboard-list',
  error: 'circle-x',
  cloudState: 'cloud-check',
  dragHandle: 'grip-vertical',
  diff: 'file-diff',
  collapse: 'minimize-2',
  browser: 'globe',
  workspace: 'building-complex',
  formatText: 'bold',
  code: 'file-code',
  image: 'image',
}

/** 允许保留的第二图形：语义确实不同，且现状已在用。 */
export const also = {
  sessions: [{ icon: 'messages-square', when: '多会话 / 批量会话视图' }],
  refresh: [{ icon: 'rotate-ccw', when: '失败重试（与刷新区分）' }, { icon: 'undo-2', when: '编辑器撤销 / 重做' }],
  account: [{ icon: 'users', when: '成员列表' }, { icon: 'log-out', when: '退出登录' }],
  lock: [{ icon: 'key-round', when: '密钥与凭证' }, { icon: 'lock-open', when: '解锁态' }],
  code: [{ icon: 'braces', when: 'JSON / 配置文件' }, { icon: 'code', when: '行内代码' }],
  dragHandle: [{ icon: 'grip-horizontal', when: '横向拖拽手柄' }],
  viewSwitch: [{ icon: 'list', when: '列表视图' }],
  formatText: [{ icon: 'italic', when: '同一工具条' }, { icon: 'strikethrough', when: '同一工具条' }],
  filesPanel: [{ icon: 'folder-search', when: '在文件中搜索' }],
  plugins: [{ icon: 'shapes', when: '插件兜底头像 / 面板' }, { icon: 'package', when: '依赖包' }],
  gantt: [{ icon: 'diamond', when: '里程碑', iconNote: '原归入视图切换' }],
  automations: [{ icon: 'webhook', when: '事件触发' }],
  labels: [{ icon: 'hash', when: '编号 / 井号语义' }],
  calendar: [{ icon: 'calendar-off', when: '已关闭 / 无日程' }],
  chevronRight: [{ icon: 'corner-down-right', when: '工具行缩进' }, { icon: 'arrow-up-right', when: '外链跳转' }],
  chevronLeft: [{ icon: 'arrow-left', when: '返回导航' }],
  archive: [{ icon: 'archive-restore', when: '恢复归档' }, { icon: 'inbox', when: '收件箱' }],
  attach: [{ icon: 'link-2', when: '链接' }, { icon: 'link-2-off', when: '断链' }],
  cloudState: [{ icon: 'cloud-off', when: '离线' }, { icon: 'cloud-upload', when: '上传中' }],
  themeSystem: [{ icon: 'cpu', when: '模型 / 算力' }, { icon: 'laptop', when: '设备' }],
  warning: [{ icon: 'shield-alert', when: '安全告警' }, { icon: 'cloud-alert', when: '云端异常' }],
  add: [{ icon: 'file-plus', when: '新建文件' }, { icon: 'folder-plus', when: '新建文件夹' }],
  image: [{ icon: 'file-image', when: '图片文件' }, { icon: 'camera', when: '截图 / 拍照' }],
  flag: [{ icon: 'flag-off', when: '取消标记' }, { icon: 'star', when: '收藏' }],
  power: [{ icon: 'toggle-right', when: '设置项开关' }],
  error: [{ icon: 'circle-alert', when: '需要留意的错误提示' }],
  blocked: [{ icon: 'circle-slash', when: '不可用' }],
  diff: [{ icon: 'git-compare-arrows', when: '版本对比' }],
  branch: [{ icon: 'git-graph', when: '提交图谱' }],
  media: [{ icon: 'file-play', when: '视频文件（或交给彩色文件主题）' }],
  network: [{ icon: 'radio', when: '实时推送' }],
  keyboard: [{ icon: 'type', when: '文字 / 字体' }],
  usage: [{ icon: 'credit-card', when: '计费' }],
  tools: [{ icon: 'bug', when: '调试 / 缺陷' }],
  plan: [{ icon: 'list-checks', when: '检查清单' }],
  clock: [{ icon: 'clock-3', when: '表盘刻度变体（可并入 clock）' }],
  terminal: [{ icon: 'terminal', when: '行内终端提示符' }],
  mail: [{ icon: 'mail-open', when: '已读' }],
  pages: [{ icon: 'panels-top-left', when: '分栏页面' }],
}
/** 取舍说明：一个用途当前有多个图形时必须写清楚收敛理由。 */
export const why = {
  sessions: '方形气泡 18 次导入已经定调；圆形气泡与 -more/-dashed/-question 变体各只用 1 次，属于顺手取用，建议收敛。',
  refresh: '刷新、失败重试、撤销重做是三件事，却用了 6 个图形。主图形定为 refresh-cw，重试与撤销各留一个受控图形。',
  account: '账户、成员、退出登录混在一起。账户头像用 circle-user，成员与退出各自单列。',
  lock: '锁、钥匙、解锁三种语义共 5 个图形。锁是主图形，密钥与解锁态保留为受控第二图形。',
  code: '文件类型、JSON 花括号、行内代码、公式符号挤在一个用途里。主图形用 file-code，花括号与行内代码保留。',
  dragHandle: '拖拽手柄只需一个方向；Focus / LocateFixed / MousePointerClick 是一次性的交互提示，不属于拖拽语义。',
  viewSwitch: 'Circle 12 次导入其实是指示点，Shapes 是插件头像，Diamond 是甘特图里程碑，都归错了用途；视图切换只留 layout-grid 与 list。',
  formatText: 'Markdown 工具条天然是一组按钮，主图标用 bold，斜体与删除线同组保留。',
  filesPanel: '文件树是主图形；文件夹搜索与符号链接各自单列，不再混用。',
  plugins: '插件语义应该用插头；layers 更像图层，Shapes 实际是插件兜底头像，都归位。',
  kanban: 'columns-3 是通用三列，Lucide 有专用 square-kanban，而且与甘特图的 square-chart-gantt 成对。',
  check: 'check 61 次导入已经统一；check-check 表示"全部确认"保留，圆形与方形勾选属于状态图标。',
  chevronRight: '右向箭头有四种语义：展开、工具行缩进、外链跳转、普通前进。主图形 chevron-right，另两个受控保留。',
  edit: '编辑按对象分层：通用用 pencil，文件内编辑用 file-pen-line，行内编辑用 pencil-line。',
  attach: '附件与链接是两件事，链接与断链各自保留。',
  cloudState: '同步状态必须成套：已同步 cloud-check、离线 cloud-off、上传中 cloud-upload。',
  themeSystem: '跟随系统只看显示器；算力与设备是另外两种语义，混在一起会让用户以为在切设备。',
  warning: '警告按场景分三种：通用三角、安全盾牌、云端异常。主图形统一三角。',
  error: '失败用 circle-x，需要留意用 circle-alert，两者颜色与语气不同，不能互相顶替。',
  add: '通用新增用加号；带类型的新增（文件、文件夹）保留在各自菜单里。',
  image: '图片、图片文件、截图三种语义分开：UI 里用 image，文件类型交给彩色文件主题。',
  media: '播放控制用 play；音频与视频文件图形交给彩色文件主题，UI 不再自造。',
  power: '开关与电源是两种交互：设置项开关用 toggle-right，启停用 power / power-off。',
  usage: '用量看仪表盘更直观，计费看卡片，两者分开。',
  archive: '归档、恢复、收件箱三种语义保留，主图形用 archive。',
  copy: '复制用 copy，粘贴用 clipboard-paste，是不同动作。',
  stop: '停止生成用实心方块；暂停圆属于媒体控制。',
  plan: '待办用 list-todo，检查清单用 list-checks，同屏出现时不会混淆。',
  flag: '标记、取消标记、收藏三态成套保留。',
  tools: '工具调用用扳手，缺陷调试用虫子，都保留。',
  clock: 'clock-3 只是表盘刻度变体，建议统一为 clock。',
  terminal: '工作台入口用方形终端（与顶栏其他方形入口一致），行内提示符用 terminal。',
  browser: 'Globe2 是 earth 的旧名，视觉几乎一样，统一用 globe。',
  sources: '来源类型不止数据库：database-zap 主图形，database 作为通用数据源保留。',
  skills: '技能用 sparkles；book-open 属于文档入口，bot 属于智能体标识，各自单列。',
  labels: '标签统一 tag；hash 是编号语义。',
  mail: '未读用 mail，已读用 mail-open，两态成套。',
  network: '网络请求用 network，实时推送用 radio，语义不同。',
  schedule: '日历入口用 calendar-days，关闭态用 calendar-off。',
  calendar: '入口统一用带日程的 calendar-days；calendar 与 calendar-off 只在"无日程 / 已关闭"时出现。',
  gantt: '主图形用 square-chart-gantt，与看板的 square-kanban 成对；Diamond 是里程碑，属于同一视图的第二图形。',
  pages: 'app-window 9 次导入已经定调，panel-top / panels-top-left 只在真正的分栏场景保留。',
  automations: '自动化入口用闪电，事件触发保留 webhook，二者不能互相顶替。',
  settings: 'settings 是入口主图形；settings-2 是简化版，同屏出现会让人以为是两个功能，建议收敛。',
  workbenchTab: '左栏开合与右栏工作台是两件事，左右各留一个图形，不再混用 panel-right-open。',
  expand: '16 次导入已经统一为 maximize-2；chevrons-up 属于收起箭头语义。',
  collapse: '与放大成对，统一 minimize-2；minus 只在列表项折叠时使用。',
  pin: '图钉与地理位置是两种语义：固定用 pin，地图定位用 map-pin。',
  closePanel: '关闭统一 x；square-slash 表示"不可用"，不是关闭。',
  search: '搜索与缩放是两件事，主图形用 search，查看器里允许 zoom-in / zoom-out。',
  filter: 'list-filter 用于"筛选列表"，funnel（旧名 Filter）用于纯筛选入口，两者分工固定。',
  chevronDown: '展开与收起统一 chevron；排序方向改用 arrow-up-down，不再借展开箭头兼任。',
  chevronLeft: '面包屑用 chevron-left，页面级返回用 arrow-left，两者不混。',
  chevronUp: '收起用 chevron-up；arrow-up 专职发送与上移。',
  visibility: '同一个控件的两态，eye / eye-off 天然成对，必须一起用。',
  blocked: '禁用统一 ban；circle-slash 表示"不可用"，shield 属于权限。',
  diff: '文件变更用 file-diff，版本对比用 git-compare-arrows，两个场景不要互换。',
  branch: '版本分支用 git-branch，提交图谱用 git-graph；group 是成员组，移出分支语义。',
  keyboard: '快捷键用 keyboard；type 是文字与字体语义，不应混入。',
  workspace: 'Building2 是 building-complex 的旧名，改名即可，视觉不变。',
  decisions: '决策视图当前没有专用图形，建议用 clipboard-list 承载；scale（天平）可作备选。',
  sort: '排序方向现在由展开箭头兼任，建议单列 arrow-up-down。',
  server: '服务与主机保持 server，与"来源"的 database-zap 区分开。',
  key: '钥匙并入"锁定与凭证"用途，不再单列。',
  table: 'table-2 是历史命名，直接用 table 更清晰。',
  dot: 'Circle 一族是指示点与占位，不是语义图标；单独成组，避免继续污染视图切换。',
}
