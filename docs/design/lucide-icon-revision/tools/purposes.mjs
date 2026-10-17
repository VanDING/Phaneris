/**
 * 语义用途表：应用当前用到的 Lucide 组件按用途归组。
 * 由三套选型演示的映射表转换而来，只保留用途、现状组件与说明；
 * 建议图形与变更判定见 plan.mjs。
 */

export const groups = [
  {
    "id": "nav",
    "title": "一级导航与顶栏入口"
  },
  {
    "id": "panel",
    "title": "工作台与面板"
  },
  {
    "id": "action",
    "title": "通用操作"
  },
  {
    "id": "status",
    "title": "状态与反馈"
  },
  {
    "id": "files",
    "title": "文件与版本"
  },
  {
    "id": "chat",
    "title": "对话与运行"
  },
  {
    "id": "settings",
    "title": "设置与账户"
  },
  {
    "id": "editor",
    "title": "编辑与视图"
  }
]

export const purposes = [
  {
    "id": "sessions",
    "group": "nav",
    "label": "对话",
    "current": "MessageSquare",
    "lucide": [
      "MessageSquare",
      "MessagesSquare",
      "MessageCircleDashed",
      "MessageCircleMore",
      "MessageCircleQuestion",
      "MessageSquareMore"
    ],
    "note": "三套都是对话气泡；Line MD 圆点气泡、Coolicons 方形气泡、Mono 实心轮廓气泡。"
  },
  {
    "id": "kanban",
    "group": "nav",
    "label": "看板",
    "current": "Columns3",
    "lucide": [
      "Columns3"
    ],
    "note": "Coolicons 有原生三列，Mono 有原生板面；Line MD 缺看板图形，用三格近似。"
  },
  {
    "id": "calendar",
    "group": "nav",
    "label": "日历",
    "current": "CalendarDays",
    "lucide": [
      "CalendarDays",
      "Calendar",
      "CalendarOff"
    ],
    "note": "Mono 只有素日历，没有“带日程”变体；隐藏状态三套都用同一图形加禁用色。"
  },
  {
    "id": "gantt",
    "group": "nav",
    "label": "甘特图",
    "current": "GanttChartSquare",
    "lucide": [
      "GanttChartSquare"
    ],
    "note": "三套都没有专用甘特图：Line MD 三条横线、Coolicons 水平条形图、Mono 三行视图。"
  },
  {
    "id": "filesPanel",
    "group": "nav",
    "label": "文件",
    "current": "FolderTree",
    "lucide": [
      "FolderTree",
      "FolderSearch",
      "FolderSymlinkIcon",
      "Files"
    ],
    "note": "Line MD“网络文件夹”与 Coolicons 多文件夹最能表达文件树；Mono 只有单文件夹。"
  },
  {
    "id": "trajectory",
    "group": "nav",
    "label": "运行轨迹",
    "current": "Activity",
    "lucide": [
      "Activity"
    ],
    "note": "轨迹是时间序列：Coolicons 折线、Mono 柱状直接可用；Line MD 无图表，用报告文档近似。"
  },
  {
    "id": "terminal",
    "group": "nav",
    "label": "终端",
    "current": "SquareTerminal",
    "lucide": [
      "SquareTerminal",
      "Terminal",
      "TerminalSquare"
    ],
    "note": "Coolicons 有原生终端窗口；Line MD 用代码文档、Mono 用普通窗口代替。"
  },
  {
    "id": "browser",
    "group": "nav",
    "label": "浏览器",
    "current": "Globe",
    "lucide": [
      "Globe",
      "Globe2"
    ],
    "note": "只有 Coolicons 有地球；Line MD、Mono 用指南针表达“浏览”。"
  },
  {
    "id": "help",
    "group": "nav",
    "label": "帮助",
    "current": "HelpCircle",
    "lucide": [
      "HelpCircle"
    ],
    "note": "三套都有原生问号圆圈，语义完全一致。"
  },
  {
    "id": "newSession",
    "group": "nav",
    "label": "新对话",
    "current": "SquarePen",
    "lucide": [
      "SquarePen"
    ],
    "note": "应用目前用自绘圆角方框笔（非 Lucide）。Coolicons 的 note-edit 最接近，另两套是普通铅笔。"
  },
  {
    "id": "projects",
    "group": "nav",
    "label": "项目",
    "current": "FolderKanban",
    "lucide": [
      "FolderKanban"
    ],
    "note": "项目是工作集合：Line MD 公文包、Coolicons 旅行箱、Mono 无公文包用格子代替。"
  },
  {
    "id": "pages",
    "group": "nav",
    "label": "页面",
    "current": "AppWindow",
    "lucide": [
      "AppWindow",
      "PanelsTopLeft",
      "PanelTop"
    ],
    "note": "Line MD 没有窗口轮廓，用文本框；另两套窗口图形能表达独立页面。"
  },
  {
    "id": "sources",
    "group": "nav",
    "label": "来源",
    "current": "DatabaseZap",
    "lucide": [
      "DatabaseZap",
      "Database",
      "HardDrive"
    ],
    "note": "Coolicons 圆柱与 Mono 数据库最贴切；Line MD 无数据库，用带标签的云端来源近似。"
  },
  {
    "id": "skills",
    "group": "nav",
    "label": "技能与 AI",
    "current": "Sparkles",
    "lucide": [
      "Sparkles",
      "BookOpen",
      "Bot"
    ],
    "note": "技能=可复用能力：前两套用灯泡，Mono 无灯泡，用书本表达“知识”；智能体标识并入此用途。"
  },
  {
    "id": "plugins",
    "group": "nav",
    "label": "插件",
    "current": "Plug",
    "lucide": [
      "Plug",
      "Package",
      "PackageOpen",
      "Layers"
    ],
    "note": "只有 Coolicons 有拼图；Line MD 用链接、Mono 用图层表达“扩展能力”。"
  },
  {
    "id": "automations",
    "group": "nav",
    "label": "自动化",
    "current": "Zap",
    "lucide": [
      "Zap",
      "Webhook",
      "Workflow"
    ],
    "note": "循环最能表达“自动重复”；Line MD 无循环图形，用恢复弧线近似。"
  },
  {
    "id": "labels",
    "group": "nav",
    "label": "标签",
    "current": "Tag",
    "lucide": [
      "Tag",
      "Tags",
      "Hash"
    ],
    "note": "Line MD 无标签轮廓，用井号；另两套是原生标签。"
  },
  {
    "id": "settings",
    "group": "nav",
    "label": "设置",
    "current": "Settings",
    "lucide": [
      "Settings",
      "Settings2"
    ],
    "note": "三套都有原生齿轮/设置轮廓；Settings2 是同一语义的简版。"
  },
  {
    "id": "workbenchTab",
    "group": "panel",
    "label": "工作台标签",
    "current": "PanelRight",
    "lucide": [
      "PanelRight",
      "PanelRightOpen",
      "PanelLeft"
    ],
    "note": "侧栏开合：Line MD 折叠菜单、Coolicons 侧栏窗口都很直白；Mono 用布局轮廓近似。"
  },
  {
    "id": "splitView",
    "group": "panel",
    "label": "分栏",
    "current": "Columns2",
    "lucide": [
      "Columns2"
    ],
    "note": "Line MD/Coolicons 复用看板图形，靠位置与激活态区分；Mono 有原生两栏。"
  },
  {
    "id": "expand",
    "group": "panel",
    "label": "放大/展开",
    "current": "Maximize2",
    "lucide": [
      "Maximize2",
      "ChevronsUp"
    ],
    "note": "三套都是对角箭头/展开，语义一致。"
  },
  {
    "id": "collapse",
    "group": "panel",
    "label": "还原/收起",
    "current": "Minimize2",
    "lucide": [
      "Minimize2",
      "Minus"
    ],
    "note": "与放大成对，方向必须完全相反；三套都成立。"
  },
  {
    "id": "pin",
    "group": "panel",
    "label": "固定",
    "current": "Pin",
    "lucide": [
      "Pin",
      "MapPin"
    ],
    "note": "Line MD、Coolicons 没有图钉，用位置标记；Mono 是原生图钉。"
  },
  {
    "id": "unpin",
    "group": "panel",
    "label": "取消固定",
    "current": "PinOff",
    "lucide": [
      "PinOff"
    ],
    "note": "三套都缺“取消固定”专用图形，复用固定图标，靠激活底色与按钮名区分。"
  },
  {
    "id": "closePanel",
    "group": "panel",
    "label": "关闭面板",
    "current": "X",
    "lucide": [
      "X",
      "XIcon",
      "SquareSlash"
    ],
    "note": "关闭是最基础图形，三套都原生。"
  },
  {
    "id": "search",
    "group": "action",
    "label": "搜索与缩放",
    "current": "Search",
    "lucide": [
      "Search",
      "ZoomIn",
      "ZoomOut"
    ],
    "note": "缩放并入搜索语义；Coolicons 另有放大镜加减号，可用于查看器独立图标。"
  },
  {
    "id": "filter",
    "group": "action",
    "label": "筛选",
    "current": "ListFilter",
    "lucide": [
      "ListFilter",
      "Filter"
    ],
    "note": "三套都是漏斗，语义完全一致。"
  },
  {
    "id": "more",
    "group": "action",
    "label": "更多",
    "current": "MoreHorizontal",
    "lucide": [
      "MoreHorizontal"
    ],
    "note": "Line MD 没有横向省略号，用菜单线近似；另两套是原生三点。"
  },
  {
    "id": "add",
    "group": "action",
    "label": "新增",
    "current": "Plus",
    "lucide": [
      "Plus",
      "FilePlus",
      "FolderPlus"
    ],
    "note": "三套都是加号；文件/文件夹新增复用同图形加重音色。"
  },
  {
    "id": "check",
    "group": "action",
    "label": "确认",
    "current": "Check",
    "lucide": [
      "Check",
      "CheckIcon",
      "CheckCheck",
      "CheckSquare",
      "CheckCircle"
    ],
    "note": "勾选是全项目最高频图形（59 次导入），三套都原生。"
  },
  {
    "id": "chevronDown",
    "group": "action",
    "label": "展开箭头",
    "current": "ChevronDown",
    "lucide": [
      "ChevronDown",
      "ChevronDownIcon",
      "ChevronsUpDown",
      "ArrowUpDown"
    ],
    "note": "同时承担排序方向指示；三套原生。"
  },
  {
    "id": "chevronRight",
    "group": "action",
    "label": "前进箭头",
    "current": "ChevronRight",
    "lucide": [
      "ChevronRight",
      "ChevronRightIcon",
      "ArrowRight",
      "ArrowUpRight",
      "CornerDownRight"
    ],
    "note": "面包屑与工具行共用；右向箭头变体也归入此用途。"
  },
  {
    "id": "chevronLeft",
    "group": "action",
    "label": "后退箭头",
    "current": "ChevronLeft",
    "lucide": [
      "ChevronLeft",
      "ChevronLeftIcon",
      "ArrowLeft"
    ],
    "note": "与前进箭头成对，三套原生。"
  },
  {
    "id": "chevronUp",
    "group": "action",
    "label": "收起箭头",
    "current": "ChevronUp",
    "lucide": [
      "ChevronUp",
      "ArrowUp"
    ],
    "note": "发送按钮在上箭头与收起箭头之间需要明确分工，见“发送”。"
  },
  {
    "id": "copy",
    "group": "action",
    "label": "复制",
    "current": "Copy",
    "lucide": [
      "Copy",
      "ClipboardPaste"
    ],
    "note": "Line MD 用多文档表达复制；另两套是原生双框。"
  },
  {
    "id": "edit",
    "group": "action",
    "label": "编辑",
    "current": "Pencil",
    "lucide": [
      "Pencil",
      "PencilLine",
      "FilePenLine",
      "PenLine"
    ],
    "note": "三套都是笔；Coolicons 另有 edit-pencil-line 变体可表达行内编辑。"
  },
  {
    "id": "delete",
    "group": "action",
    "label": "删除",
    "current": "Trash2",
    "lucide": [
      "Trash2"
    ],
    "note": "28 次导入的高频图形，三套原生。"
  },
  {
    "id": "external",
    "group": "action",
    "label": "外部打开",
    "current": "ExternalLink",
    "lucide": [
      "ExternalLink"
    ],
    "note": "三套原生；Line MD 的圆角版本更柔和。"
  },
  {
    "id": "download",
    "group": "action",
    "label": "下载",
    "current": "Download",
    "lucide": [
      "Download"
    ],
    "note": "三套原生。"
  },
  {
    "id": "upload",
    "group": "action",
    "label": "上传",
    "current": "Upload",
    "lucide": [
      "Upload"
    ],
    "note": "上传语义三套表达不同：纯箭头、文件箭头、云端箭头，都成立。"
  },
  {
    "id": "refresh",
    "group": "action",
    "label": "刷新/重试",
    "current": "RefreshCw",
    "lucide": [
      "RefreshCw",
      "RefreshCcw",
      "RotateCcw",
      "RotateCw",
      "Redo2",
      "Undo2"
    ],
    "note": "重试、重跑、撤销归入此用途；Line MD 用循环弧线近似。"
  },
  {
    "id": "stop",
    "group": "action",
    "label": "停止",
    "current": "Square",
    "lucide": [
      "Square",
      "PauseCircle"
    ],
    "note": "运行中必须有明确的停止入口；Line MD 用空心方块，另两套用实心停止块。"
  },
  {
    "id": "send",
    "group": "action",
    "label": "发送",
    "current": "Send",
    "lucide": [
      "Send"
    ],
    "note": "Line MD 用上箭头，另两套用纸飞机/发送三角；需与“收起箭头”区分位置。"
  },
  {
    "id": "archive",
    "group": "action",
    "label": "归档",
    "current": "Archive",
    "lucide": [
      "Archive",
      "ArchiveRestore",
      "Inbox"
    ],
    "note": "Line MD 用“文件夹下载”近似归档动作。"
  },
  {
    "id": "attach",
    "group": "action",
    "label": "附件",
    "current": "Paperclip",
    "lucide": [
      "Paperclip",
      "Link",
      "Link2",
      "Link2Off"
    ],
    "note": "Line MD 缺回形针，用链接；另两套是原生回形针/附件。"
  },
  {
    "id": "deleteFile",
    "group": "action",
    "label": "移除文件",
    "current": "FileQuestion",
    "lucide": [
      "FileQuestion"
    ],
    "note": "文件级删除与整体删除分开，避免误用垃圾桶。"
  },
  {
    "id": "lock",
    "group": "action",
    "label": "锁定与凭证",
    "current": "Lock",
    "lucide": [
      "Lock",
      "LockKeyhole",
      "LockOpen",
      "Key",
      "KeyRound"
    ],
    "note": "凭证与解锁归入此用途；Line MD 无锁与钥匙，用盾牌近似；Mono 无钥匙图形。"
  },
  {
    "id": "visibility",
    "group": "action",
    "label": "显示/隐藏",
    "current": "Eye",
    "lucide": [
      "Eye",
      "EyeOff"
    ],
    "note": "密钥与密码可见性切换。Line MD 的图形名叫 watch，实际就是眼睛，带斜线为隐藏态。"
  },
  {
    "id": "success",
    "group": "status",
    "label": "成功",
    "current": "CheckCircle2",
    "lucide": [
      "CheckCircle2",
      "CircleCheck"
    ],
    "note": "三套原生；Mono 用实心轮廓勾选圆。"
  },
  {
    "id": "warning",
    "group": "status",
    "label": "警告",
    "current": "AlertTriangle",
    "lucide": [
      "AlertTriangle",
      "TriangleAlert",
      "CloudAlert",
      "ShieldAlert"
    ],
    "note": "Line MD 无三角警告，用感叹号圆；另两套分别是三角与圆形警告。"
  },
  {
    "id": "error",
    "group": "status",
    "label": "错误",
    "current": "XCircle",
    "lucide": [
      "XCircle",
      "CircleAlert",
      "AlertCircle"
    ],
    "note": "与“成功”同构，颜色承担语义，三套都能配对。"
  },
  {
    "id": "info",
    "group": "status",
    "label": "信息",
    "current": "Info",
    "lucide": [
      "Info"
    ],
    "note": "Line MD 无独立 i 圆，与帮助共用问号圆，需要靠文案区分。"
  },
  {
    "id": "blocked",
    "group": "status",
    "label": "禁用/阻止",
    "current": "Ban",
    "lucide": [
      "Ban",
      "CircleSlash",
      "Shield"
    ],
    "note": "三套都有禁止类图形。"
  },
  {
    "id": "loading",
    "group": "status",
    "label": "加载中",
    "current": "Loader2",
    "lucide": [
      "Loader2"
    ],
    "note": "Line MD 有原生描线动画 loading-loop，Coolicons 有 loading 圆环，Mono 只有刷新轮廓。"
  },
  {
    "id": "thinking",
    "group": "status",
    "label": "思考中",
    "current": "Spinner",
    "lucide": [],
    "spinner": "svg-spinners:blocks-wave",
    "note": "本次指定替换：统一使用 svg-spinners 的 blocks-wave，四格方块错峰起跳，替代自绘旋转弧线。"
  },
  {
    "id": "clock",
    "group": "status",
    "label": "时间",
    "current": "Clock3",
    "lucide": [
      "Clock",
      "Clock3"
    ],
    "note": "运行时长与计划时间共用；Line MD 无钟表轮廓，用仪表盘近似。"
  },
  {
    "id": "folder",
    "group": "files",
    "label": "文件夹",
    "current": "Folder",
    "lucide": [
      "Folder",
      "FolderIcon"
    ],
    "note": "三套原生；展开态见下一条。"
  },
  {
    "id": "folderOpen",
    "group": "files",
    "label": "展开文件夹",
    "current": "FolderOpen",
    "lucide": [
      "FolderOpen"
    ],
    "note": "Coolicons 有原生打开文件夹；Line MD 用文件夹箭头，Mono 复用同形靠底色区分。"
  },
  {
    "id": "file",
    "group": "files",
    "label": "普通文件",
    "current": "File",
    "lucide": [
      "File"
    ],
    "note": "未知类型的兜底图形；彩色文件主题接管后，此图形只用于未识别类型。"
  },
  {
    "id": "document",
    "group": "files",
    "label": "文档",
    "current": "FileText",
    "lucide": [
      "FileText"
    ],
    "note": "与彩色文件主题里的 Markdown 图形并存，注意不要重复表达。"
  },
  {
    "id": "code",
    "group": "files",
    "label": "代码与数据",
    "current": "FileCode",
    "lucide": [
      "FileCode",
      "Code",
      "Braces",
      "Variable",
      "Sigma"
    ],
    "note": "高亮与公式并入此用途；Mono 无代码图形，复用普通文档。"
  },
  {
    "id": "json",
    "group": "files",
    "label": "JSON 文件",
    "current": "FileJson",
    "lucide": [
      "FileJson"
    ],
    "note": "三套都没有花括号；正式实施建议交给彩色文件主题，不单独造图形。"
  },
  {
    "id": "image",
    "group": "files",
    "label": "图片",
    "current": "Image",
    "lucide": [
      "Image",
      "FileImage",
      "Camera"
    ],
    "note": "三套原生；截图与相机并入此用途。"
  },
  {
    "id": "table",
    "group": "files",
    "label": "表格",
    "current": "Table2",
    "lucide": [
      "Table2"
    ],
    "note": "Coolicons 的 table 与看板 columns 同构，同屏出现时需靠位置区分。"
  },
  {
    "id": "archiveFile",
    "group": "files",
    "label": "压缩包",
    "current": "FileArchive",
    "lucide": [
      "FileArchive"
    ],
    "note": "压缩包与归档动作容易撞图形，建议压缩包交给彩色文件主题。"
  },
  {
    "id": "media",
    "group": "files",
    "label": "音视频",
    "current": "FileAudio",
    "lucide": [
      "FileAudio",
      "FileVideo",
      "Play"
    ],
    "note": "三套都没有媒体文件图形，用播放符号表达；正式实施交给彩色文件主题。"
  },
  {
    "id": "diff",
    "group": "files",
    "label": "变更",
    "current": "FileDiff",
    "lucide": [
      "FileDiff",
      "GitCompareArrows"
    ],
    "note": "三套都没有差异对比图形，用新增/编辑/删减文档近似，是三套共同短板。"
  },
  {
    "id": "branch",
    "group": "files",
    "label": "版本分支",
    "current": "GitBranch",
    "lucide": [
      "GitBranch",
      "GitGraph",
      "Group"
    ],
    "note": "Line MD 的道路分叉最接近分支概念；另两套用分享节点近似。"
  },
  {
    "id": "save",
    "group": "files",
    "label": "保存",
    "current": "Save",
    "lucide": [
      "Save"
    ],
    "note": "Line MD 无软盘图形，复用下载箭头；另两套原生。"
  },
  {
    "id": "history",
    "group": "files",
    "label": "历史记录",
    "current": "History",
    "lucide": [
      "History"
    ],
    "note": "与刷新语义相邻，需靠位置与文案区分；Mono 复用刷新轮廓。"
  },
  {
    "id": "cloudState",
    "group": "files",
    "label": "同步状态",
    "current": "CloudCheck",
    "lucide": [
      "CloudCheck",
      "CloudOff",
      "Cloud",
      "CloudUpload"
    ],
    "note": "同步/离线两态：前两套有勾选与关闭变体，Mono 只有单一云形，需靠颜色区分。"
  },
  {
    "id": "tools",
    "group": "chat",
    "label": "工具调用",
    "current": "Wrench",
    "lucide": [
      "Wrench",
      "Bug"
    ],
    "note": "三套都缺扳手/螺丝刀，Line MD 施工牌、Coolicons 直尺、Mono 指针近似。"
  },
  {
    "id": "plan",
    "group": "chat",
    "label": "计划与待办",
    "current": "ListTodo",
    "lucide": [
      "ListTodo",
      "ListChecks"
    ],
    "note": "三套都有“勾选清单”，语义一致。"
  },
  {
    "id": "decisions",
    "group": "chat",
    "label": "决策记录",
    "current": "GitCompareArrows",
    "lucide": [],
    "note": "决策视图缺专用图形，用清单类图形近似。"
  },
  {
    "id": "permissionMode",
    "group": "chat",
    "label": "权限模式",
    "current": "ShieldCheck",
    "lucide": [
      "ShieldCheck"
    ],
    "note": "权限徽标：前两套盾牌语义准确，Mono 用锁代替。"
  },
  {
    "id": "mail",
    "group": "chat",
    "label": "邮件",
    "current": "Mail",
    "lucide": [
      "Mail",
      "MailOpen"
    ],
    "note": "三套都有信封，原生一致。"
  },
  {
    "id": "network",
    "group": "chat",
    "label": "网络请求",
    "current": "Network",
    "lucide": [
      "Network",
      "Radio"
    ],
    "note": "网络与实时事件：Coolicons 有信号阶梯，另两套用云端箭头/多云近似。"
  },
  {
    "id": "power",
    "group": "chat",
    "label": "开关与启停",
    "current": "PowerOff",
    "lucide": [
      "Power",
      "PowerOff",
      "ToggleRight"
    ],
    "note": "开关状态三套都用拨动开关（Coolicons 的图标名拼写为 swicht）；电源类图形并入此用途。"
  },
  {
    "id": "dragHandle",
    "group": "chat",
    "label": "拖拽手柄",
    "current": "GripVertical",
    "lucide": [
      "GripVertical",
      "GripHorizontal",
      "MousePointerClick",
      "Focus",
      "LocateFixed"
    ],
    "note": "Line MD 无抓手图形，复用菜单三条横线；定位与点击类图形也归入此用途。"
  },
  {
    "id": "sort",
    "group": "chat",
    "label": "排序",
    "current": "ChevronDown（兼任）",
    "lucide": [],
    "note": "当前排序方向由展开箭头兼任；Coolicons、Mono 有专门排序图形，建议单列。"
  },
  {
    "id": "workspace",
    "group": "settings",
    "label": "工作区",
    "current": "Building2",
    "lucide": [
      "Building2"
    ],
    "note": "多工作区切换；Line MD 首页、Coolicons 建筑、Mono 无建筑图形用首页代替。"
  },
  {
    "id": "appearance",
    "group": "settings",
    "label": "外观",
    "current": "Palette",
    "lucide": [
      "Palette"
    ],
    "note": "Coolicons 调色板最完整；Line MD 用色滴，Mono 只有单滴。"
  },
  {
    "id": "themeLight",
    "group": "settings",
    "label": "浅色主题",
    "current": "Sun",
    "lucide": [
      "Sun"
    ],
    "note": "主题三态之一，三套原生。"
  },
  {
    "id": "themeDark",
    "group": "settings",
    "label": "深色主题",
    "current": "Moon",
    "lucide": [
      "Moon"
    ],
    "note": "主题三态之二，三套原生。"
  },
  {
    "id": "themeSystem",
    "group": "settings",
    "label": "跟随系统",
    "current": "Monitor",
    "lucide": [
      "Monitor",
      "Laptop",
      "Cpu",
      "Atom"
    ],
    "note": "主题三态之三；模型与算力类图形也归入此用途。Mono 无显示器轮廓，用笔电代替。"
  },
  {
    "id": "account",
    "group": "settings",
    "label": "账户",
    "current": "UserCircle",
    "lucide": [
      "UserCircle",
      "UserRound",
      "User",
      "Users",
      "LogOut",
      "Accessibility"
    ],
    "note": "账户、成员、退出登录共用一套人形；登录/退出在三套里都有进出箭头变体。"
  },
  {
    "id": "server",
    "group": "settings",
    "label": "服务与主机",
    "current": "Server",
    "lucide": [
      "Server"
    ],
    "note": "远程与本地主机；Coolicons 主机塔最准确，另两套用通用电脑。"
  },
  {
    "id": "keyboard",
    "group": "settings",
    "label": "快捷键",
    "current": "Keyboard",
    "lucide": [
      "Keyboard",
      "Type"
    ],
    "note": "只有 Coolicons 有键盘；Line MD 用文本对齐线、Mono 用文字代替。"
  },
  {
    "id": "viewSwitch",
    "group": "settings",
    "label": "视图切换",
    "current": "LayoutGrid",
    "lucide": [
      "LayoutGrid",
      "List",
      "Shapes",
      "Diamond",
      "Circle",
      "CircleIcon"
    ],
    "note": "列表/网格切换；占位圆形与菱形也归入此用途，避免无意义图形单独成行。"
  },
  {
    "id": "usage",
    "group": "settings",
    "label": "用量与额度",
    "current": "Coins",
    "lucide": [
      "Coins",
      "CreditCard"
    ],
    "note": "额度与计费：Line MD 仪表盘最贴近“用量”，另两套用卡片/百分比近似。"
  },
  {
    "id": "formatText",
    "group": "editor",
    "label": "文本格式",
    "current": "Bold",
    "lucide": [
      "Bold",
      "Italic",
      "Strikethrough",
      "TextSelect",
      "Scissors"
    ],
    "note": "Markdown 编辑工具条；Coolicons、Mono 有原生粗体/斜体/删除线，Line MD 完全缺失。"
  },
  {
    "id": "flag",
    "group": "editor",
    "label": "标记",
    "current": "Flag",
    "lucide": [
      "Flag",
      "FlagOff",
      "Star"
    ],
    "note": "标记会话与收藏；Line MD 无旗子，用记号笔。"
  }
]
