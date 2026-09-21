# Phaneris 全项目动效审计

日期：2026-09-21。基线：`f2f5ef74` 与当前工作区。

## 1. 核心判断

项目已经有可延续的动效基础：共享 token、两类弹簧、CSS 减弱动态兜底、三个正式 React 主入口的 `MotionConfig`、布局与焦点处理、面板与标注的专用逻辑。问题集中在这些能力之间的接缝：独立渲染入口、第三方动画机制、进出场生命周期、内容切换与容器布局、连续状态变化。

下一步应补齐统一行为契约，并在现有组件中落实。不能通过替换全套组件或统一所有时长来获得连贯性，也不能把每个缺少动画的位置都视为缺陷。

本次完成全仓候选扫描、各产品领域源码审视、已列发现逐项复核，以及两类隔离浏览器验证。**未完成运行中的完整产品逐屏操作、性能录制、真实触屏设备验证**；这些明确列入验收矩阵，不能把本报告当作实机视觉验收证书。

## 2. 范围与方法

扫描采用 `rg --files apps packages docs hero-demo` 可见文件集，覆盖 TSX/CSS/HTML，并补充 TS 中的滚动、帧调度和内嵌页面。排除依赖目录、生成产物和资源包；资源目录另行检查，没有发现独立 TSX/CSS/HTML 界面文件。模板脚本产生的用户交付物不属于应用自身动效语言。

| 界面文件分组 | 文件数 | 说明 |
| --- | ---: | --- |
| Electron（Playground 目录之外） | 328 | 主窗口、独立浏览器窗口、组件、页面、入口等 |
| Playground 目录 | 54 | 调试与演示，单列治理 |
| 共享 UI | 102 | 会话、Markdown、预览、标注、轨迹及样式 |
| WebUI | 5 | 复用桌面 renderer，含独立登录/启动页 |
| Viewer | 6 | 共享会话阅读与上传入口 |
| 设计演示文件 | 3 | docs/hero-demo 的静态设计产物 |
| 合计 | 498 | 文件清单与行号见 inventory JSON |

另扫描 1,393 个补充源码文件；这不是“人工逐行审读 1,393 个文件”的声明。扫描候选经过调用场景复核，后端业务状态的 transition、几何测量用 rAF、静态渐变蒙版均不误记为视觉动画。

证据等级：

- **S：源码确认**，代码路径和机制明确；不等于已经肉眼观察。
- **B：隔离浏览器复现**，使用仓库原始 HTML/CSS，运行于本机 Edge 内核；不等于完整产品 E2E。
- **D：设计一致性判断**，结构差异确定，是否调整及幅度需按产品规则确定。
- **V：待运行验证**，仅保留风险和验收项，不以确定缺陷计入。

## 3. 全项目覆盖地图

| 领域 | 已审视机制与路径 | 结论 |
| --- | --- | --- |
| 启动与入口 | Electron/WebUI HTML loader；main.tsx；Viewer；playground.tsx；browser-toolbar.tsx | 正式 React 主入口有全局配置；启动 HTML 与 Playground 存在空隙 |
| 登录、授权、引导 | WebUI login.html；OnboardingWizard；WorkspaceCreationScreen；shared/auth/callback-page.ts | 登录页已有减弱动态；工作区 Shader 需补齐；步骤转换可改善 |
| 主布局 | SurfaceContainer、SurfaceSlot、CompactPanelTransition、WorkbenchResizeSash、PanelHeader | 面板布局与内容过渡未完整协同；直接拖拽已避免额外缓动 |
| 导航与菜单 | MobileAppMenu、工作区切换器、ContextWorkbenchTabs、SessionList、实体列表键盘导航 | 移动子页退出与非当前层交互缺口；高频键盘路径多处已即时化 |
| 会话输入 | InputContainer、FreeFormInput、StructuredInput、ToolbarStatusSlot、EditPopover | 高度中断处理较好；交叠状态需统一交互归属 |
| 会话输出 | ChatDisplay、TurnCard、StreamingMarkdown、工具活动、完成提示 | 状态交接和展开延迟值得收敛；程序化滚动需统一策略 |
| 任务与日程 | KanbanBoard、TaskTile、CalendarView、通用 SortableList | 拖拽收尾风格不同；部分非 Motion 动画绕过偏好 |
| 工作台内容 | FilesPanel、ChangedFilesView、PreviewPanel、PanelEmptyState、ArtifactWorkbench | 已有局部入场；同级切换串行等待与容器变化需审视 |
| 预览与编辑 | FullscreenOverlayBase、HTML/Image/Mermaid/PDF/MultiDiff 预览、Tiptap | HTML 显现曲线孤立；缩放拖拽不应机械改写 |
| 标注与 Island | Island、AnnotationIslandMenu、AnnotatableMarkdownDocument、island-motion | 有完整来源几何；退出交互与定时收尾需整理；表现幅度单独实测 |
| 运行轨迹 | TrajectoryView、Table、MapView、ContextView、RecordInspector | 虚拟化、稳定视图值得保留；定位滚动仍需偏好分支 |
| 设置与资源管理 | SettingsRadioGroup；AI/Messaging/Workspace 设置；Plugins/Sources/Skills/Projects 列表与详情 | 同类展开参数存在分叉；资源列表不宜普遍加 stagger |
| 自动化、消息接入、Pages | 自动化列表/测试/时间线；消息连接与权限；PageView/PageFrame/PagesHome | 以局部颜色和忙碌状态为主，无证据支持普遍增加动画；状态切换进入验收 |
| 控件与反馈 | Button、Switch、Tooltip、Dialog、Popover、Drawer、Sonner、状态图标 | 共享角色成熟；原生/第三方机制和 CSS 覆盖需要可追踪契约 |
| Viewer | main、App、SessionUpload、index.css | 正式 MotionConfig 已接入；transition-all 遗留未纳入统一门禁 |
| CLI、服务端、主进程 | CLI spinner；OAuth 回调；浏览器管理与缩略图宿主内嵌 HTML | CLI 与业务状态不是 DOM 动效；不套用浏览器 spring；几何/标记循环不直接判错 |
| 设计演示 | Playground registry/demos、三个静态 HTML 演示 | 不直接作为生产缺陷；与正式运行规则差异必须注明 |

## 4. 已复核发现

严重度：HIGH 为直接破坏重要交互连续性；MEDIUM 为功能体验/无障碍或明显一致性问题；LOW 为局部收敛。表格按修复收益与依赖顺序排列，不按数量凑项。

| 编号 | 严重度 | 类别 / 证据 | 位置 | 发现与修复方向 |
| --- | --- | --- | --- | --- |
| M01 | MEDIUM | 无障碍 / S+B | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:1190`；`packages/ui/src/components/chat/TurnCard.tsx:2900`；`packages/ui/src/components/trajectory/TrajectoryTable.tsx:117`；`apps/electron/src/renderer/components/content-panels/ChangedFilesView.tsx:121` | 多处显式 `behavior: 'smooth'` 无偏好判断；CSS 的 `scroll-behavior: auto !important` 不会覆盖显式 JS 参数。建立统一滚动意图策略，减弱动态/高频导航即时定位。 |
| M02 | MEDIUM | 无障碍 / S+B | `apps/electron/src/renderer/index.html:18`；`apps/webui/src/index.html:19` | React/CSS 尚未加载时，HTML loader 在 reduce 下仍以 1s 无限旋转。内联自足的偏好处理，保留静态加载表达。 |
| M03 | MEDIUM | 无障碍 / S | `apps/electron/src/renderer/components/workspace/WorkspaceCreationScreen.tsx:180` | Dithering 固定 `speed={1}`，没有连接减弱动态；Canvas 不受全局 CSS 或 MotionConfig 控制。reduce 下 `speed=0` 或静态替代，并验证不可见时的资源释放。 |
| M04 | MEDIUM | 无障碍 / S | `apps/electron/src/renderer/components/ui/sortable-list.tsx:72`；`packages/ui/src/components/markdown/ImageCardStack.tsx:149` | 排序使用独立 DropAnimation 和 `Element.animate()`；图卡回弹直接 `animate(x, 0)`。它们没有自动继承 React MotionConfig。显式传递偏好，保留直接拖动、取消自主回弹/落位位移。 |
| M05 | HIGH | 可逆导航 / S | `apps/electron/src/renderer/components/app-menu/MobileAppMenu.tsx:265` | PageStack 的 `stack.map` 没有独立 AnimatePresence，子页虽写 `exit`，pop 时仍直接从树移除；外层 Presence 只追踪 sheet。补齐按页面 key 管理的退出生命周期。 |
| M06 | MEDIUM | 层级与交互 / S | `apps/electron/src/renderer/components/app-menu/MobileAppMenu.tsx:268` | 下层菜单页面保留在 DOM，但未按活动深度设 inert/aria-hidden；覆盖不等于退出键盘/读屏顺序。当前页唯一可交互，返回后恢复合适焦点。 |
| M07 | MEDIUM | 空间连续性 / S+D | `apps/electron/src/renderer/components/app-shell/SurfaceContainer.tsx:265`；`SurfaceSlot.tsx:146`、`:174` | 工作台直接条件挂载，主区域 width/flexBasis 与 display 直接切换；已有动画主要作用于内容。为开合、最大化、恢复定义统一布局过程，保留编辑器实例与阅读锚点。 |
| M08 | MEDIUM | 导航语义 / S+D | `apps/electron/src/renderer/components/app-shell/SurfaceContainer.tsx:124`、`:158` | 紧凑模式主会话与工作台更换 visibleEntry 时，详情外层始终 active；已有列表→详情过渡不涵盖详情→工作台。增加明确的导航层级转换，返回采用对应逆向，不能重复播放初始列表入场。 |
| M09 | MEDIUM | 生命周期 / S | `apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx:277`；`packages/ui/src/components/ui/Island.tsx:775` | InputContainer 的退出表单与进入表单同时挂载，退出层无 useIsPresent/inert；Island 隐藏时仅改变视觉姿态，宿主等回调才卸载。统一退出即失去交互的规则。具体误点/焦点抢占需完整 UI 验证，不能声称已经发生错误提交。 |
| M10 | MEDIUM | 频率与反馈 / S+D | `packages/ui/src/components/chat/TurnCard.tsx:873`、`:1292`、`:3166` | 工具状态图标使用 wait，出/入各 220ms；展开列表的 delay 上限为 300ms，部分入场未指定 duration/ease。快速状态变化会经过串行视觉阶段。状态反馈改为短暂或即时交接，展开内容不按行数积累等待。 |
| M11 | MEDIUM | 生命周期 / S+D | `packages/ui/src/components/chat/TurnCard.tsx:2895`；`packages/ui/src/components/ui/Island.tsx:608` | 展开后滚动固定等待 260ms；Island 用 duration+40ms 的计时器通知退出。动画完成与生命周期是两套时钟。用实际完成/布局就绪信号，保留取消和防重复机制；兜底计时器只作保险。 |
| M12 | MEDIUM | 高频切换 / S+D | `apps/electron/src/renderer/components/content-panels/PreviewPanel.tsx:135`；`apps/electron/src/renderer/components/app-shell/kanban/CalendarView.tsx:893` | 同级内容使用 wait，出/入各 standard=160ms，切换表现串行约 320ms。新标签状态与旧内容会有交接窗口。优先让新状态即时可见，统一内容身份与交互切换时机；实际体感需实测。 |
| M13 | MEDIUM | 验收一致性 / S | `apps/electron/src/renderer/playground.tsx:24` | Playground 根没有正式入口的 MotionConfig reducedMotion=user；CSS 能兜底 CSS 动画，但不能等价覆盖 Motion。对齐宿主，并提供显式 normal/reduce 与连击/反向测试场景。 |
| M14 | LOW | 参数与覆盖 / S | `apps/viewer/src/index.css:33`；`apps/viewer/src/components/SessionUpload.tsx:112`；`scripts/eslint-rules/no-transition-all.cjs` | Viewer 仍有 CSS/类名两种 transition-all，现有规则只覆盖 Electron/UI 的 JS 字符串。改为属性白名单，并将所有界面入口/CSS 纳入对应检查。没有据此宣称实际掉帧。 |
| M15 | LOW | 同类一致性 / S+D | `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx:560`；`MessagingSettingsPage.tsx:746`；`WorkspaceSettingsPage.tsx:479`；`components/messaging/access/TelegramAccessSection.tsx:261` | 多处设置展开使用独立 0.2s/[0.4,0,0.2,1]，与共享展开规则并存。按“内联展开”统一，不为一处控件再增加另一套 token。 |
| M16 | LOW | 显现曲线 / S+D | `packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx:199` | 等待 iframe 测量后又以 opacity 200ms ease-in 显现，开始阶段响应较弱，与其他内容显现曲线不一致。测量完即可展示，使用共享 enter 节奏；保留防错误尺寸闪现。 |

### M01 / M02 的实际验证

`motion-audit-probes.json` 记录浏览器版本、偏好、computed style 和观测值：

- 两个启动 HTML 在 `prefers-reduced-motion: reduce` 下均返回 `_spin / 1s / infinite`。
- 读取项目 motion.css 后，滚动容器 computed `scrollBehavior` 为 `auto`；显式 smooth 调用仍从 0 经 2、10、24……1499 到 1500，确认发生连续移动。
- 这些是隔离的机制复现；没有假称测量了完整应用的帧率或启动耗时。

### M04 的机制边界

CSS transition 与 CSS animation 可以被全局媒体查询处理；Web Animations API、Canvas 和独立 MotionValue 控制器要显式接入偏好。用户直接拖动与自主动画要区分，reduce 不等于禁用拖拽功能。

### M09 的既有正确范例

`apps/electron/src/renderer/components/app-shell/SessionList.tsx:38` 的退出包装器已使用 useIsPresent、inert、aria-hidden。可以沿用该模式，避免发明新的交互隔离机制。仅加 pointer-events:none 不足以阻止键盘聚焦。

## 5. 必须纠正或保留的判断

### 撤回此前的折叠高度缺陷判断

本地 Motion 13 的 `node_modules/motion-dom/dist/es/render/utils/keys-position.mjs` 将 width、height、top、left、right、bottom 与 transforms 都纳入 positionalKeys；`animation/interfaces/visual-element-target.mjs:85` 在 shouldReduceMotion 下将这些属性的动画设为 type:false。

因此，正式入口已有 MotionConfig 时，不能仅因 Collapsible 未调用 useReducedMotion 就认定高度仍会动画。当前缺口是 Playground 配置、独立动画 API 和需要更强产品降级规则的局部行为。此判断以已安装源码为依据，比只读概括性文档准确。

### 保留项

- `packages/ui/src/lib/motion.ts` / `styles/motion.css`：已有 60/100/160/220/280ms 及两组弹簧；延续语义，先不更换曲线。
- `docs/new-session-hero-design.md:54`：品牌入场的长时长和启动页等待是明确设计取舍，不当作普通操作超时缺陷。
- `index.css:917`：高频菜单即时、Dialog/Popover 显式 opt-in 是既有策略，不机械恢复所有 zoom/slide 类。
- `BackgroundFinishedChip.tsx:14`：等待退出后导航是明确记录的取舍；本报告不把它伪装成新发现。
- `MobileAppMenu.tsx`：不接管 history、使用内置返回控制是明确边界，不在本轮擅自改变路由语义。
- `InputContainer.tsx:206`：高度 animate 返回控制器并在 effect cleanup 停止，已具备中断基础；不能一概将所有高度动画换成 transform。
- `TurnCard.tsx:3286`：正式回复默认不播放演示用响应入场；不把 playground 的演示参数误报为生产逐字动画。
- `TrajectoryTable`：保持虚拟化；不对每个可见行增加布局动画。
- 图像/Mermaid 缩放：拖动时无 transition、按钮缩放才短暂过渡，交互逻辑合理。
- `ImageCardStack` 的 `easeIn(depthProgress)` 是静态深度映射，不是时间缓动，不能按“ease-in UI 动画”误报。
- WebUI 登录页已有 reduce 媒体查询，OAuth 回调只有颜色过渡；无证据支持增加大幅品牌运动。
- FadingText 的 mask 是静态溢出表达，浏览器几何测量的 rAF 是同步工具，均不是无意义动画。

## 6. 待实测风险，不列为确定缺陷

| 编号 | 场景 | 已知代码事实 | 需要的证据 / 判断 |
| --- | --- | --- | --- |
| V01 | 桌面面板开合与长会话 | width/margin/padding 动画会影响布局，浏览器内容与编辑器同时参与 | Performance trace 中的布局/绘制与长帧；不能凭属性名直接宣称卡顿，也不能机械改为全体 scale |
| V02 | 流式输出跟随 | ChatDisplay 使用 ResizeObserver + 200ms debounce，另有发送/消息追加滚动 | 连续较快输出、用户上翻、输入高度变化同时发生时是否滞后或抢回滚动；如复现再调整调度 |
| V03 | Island 选区进入 | entryStartScale=0.25、距离 20–132px，来源几何与手势速度有关 | 高频标注是否过于显眼、是否跨越阅读内容；保留因果感，按真实频率决定收敛幅度 |
| V04 | 图卡首次展示 | scale=0.3、stiffness=600/damping=30；不同回弹 300/600 | 多图加载/Markdown 挂载时是否像演示组件；直接手势、自动回弹与入场分别验收 |
| V05 | 并存实例的 layoutId | 多个 LayoutGroup 使用固定 id；TrajectoryView 已使用实例 id | 确认同页是否存在两个相同组件；复现跨实例共享布局后再引入 useId，不泛化认定串扰 |
| V06 | 新旧输入/预览交叠 | 输入 sync、预览 wait，内容可能包含 focus 或异步读取 | 实测焦点、Tab、回车提交、复制与快速切换；视觉重影不是仅靠源码就能判定 |
| V07 | Tooltip/Sonner/Drawer | 有第三方内部状态机与 CSS 覆盖；tooltip 默认300ms，App为0ms，局部Provider又覆盖 | 正式宿主中确认计算后的动画、连续悬停、手势取消、reduce；不假定选择器一定命中库生成节点 |
| V08 | 按下缩放与 reduce | 全局缩短 CSS 时间但不清除 active:scale 目标值 | 若产品契约要求完全去位移，需另设 motion-reduce 样式；不把1ms瞬变等同于长距离运动 |

## 7. 有价值的新增动效机会

以下为补全体验建议，不与缺陷数量混算，只保留四类：

1. **引导步骤的前进/返回**：OnboardingWizard 的 renderStep 直接替换；用统一步骤身份与轻量转换解释进度，返回保留已填值。无需逐字段飞入。
2. **面板生命周期**：开合工作台、文件→预览、来源→详情，使用一致容器与来源关系；优先保持文本清晰和阅读位置。
3. **异步状态交接**：上传、授权、插件安装、连接重试、工具完成，统一“反馈已接收—进行中—结果”视觉语义；动作立即生效，结果不得因庆祝动画延迟。
4. **拖拽落位**：通用排序与看板的收尾规则不同；在真实移动结果确定后短暂解释落点，失败/取消回到原位置。先验证是否有误认，再决定是否增加过渡。

## 8. 参考库的适用边界

| 来源 | 已核实内容 | 可借鉴 | 不直接采纳 |
| --- | --- | --- | --- |
| [Spectrum 文档](https://ui.spectrumhq.in/docs) / [Expandable Action Bar](https://ui.spectrumhq.in/docs/expandable-action-bar) | 文档描述 hover/focus 展开与 shared layout；源码入口需要登录 | 状态与操作之间的连续性、反馈结构 | 尚未读取的源码不能声称已审过；不把触屏“两次点击”直接带入当前高频操作 |
| [Rare UI 仓库](https://github.com/swamimalode07/rare-ui) | shadcn registry，Motion，README 声明尊重偏好 | 个别交互模式与可本地维护的组件实现 | README 声明不代表每个组件经过本项目适配验证；不整库接入 |
| [Motion Panels](https://motion-panels.letstri.dev/#install) | 本次官网与 llms.txt 无法读取，npm 页面403 | 保留为面板系统候选，后续核实源码和约束 | 不以搜索摘要决定替换布局引擎；没有完成技术选型 |
| [Animata](https://animata.design/) | 官网提供多类可复制 React 动画组件 | 低频品牌/空状态的形式参考 | 不把展示型特效扩散到会话、编辑器和菜单 |

项目已经使用 Motion，无证据需要增加第二个通用动画引擎。是否引入面板库要用同一套试验验证：持久挂载、resize约束、紧凑布局、嵌入浏览器、焦点、reduce、快速开关、性能。允许结果是“只借鉴实现思路”。

补充技术依据：[Motion 无障碍指南](https://motion.dev/docs/react-accessibility)、[MDN scrollIntoView](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView)、[Paper Dithering](https://shaders.paper.design/dithering)。Paper 官方说明 speed=0 停止动画循环。Motion具体属性覆盖仍以本地安装版本为准。

## 9. 验证与限制

- 已运行现有 motion 与 annotation motion 单测：6 pass，0 fail。
- 已使用独立 Edge 实例复现 M01/M02 的机制；没有接触用户浏览器会话。
- 初始探针环境没有 Playwright 配套浏览器，改用已有 Edge；未安装任何新依赖。
- 没有运行完整产品 E2E、打包或全套测试，因为没有修改产品源码。性能/主观体感留在明确的验收矩阵中。
- 现有未提交插件工作保持原样。行号以本次工作区为准，实施前应再次检查漂移。
