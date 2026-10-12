# Phaneris 主题引擎与前端视觉：独立审计及治理方案

- 日期：2026-10-12（Asia/Shanghai）。
- 状态：**W1–W5 工程实现及本机验收完成：481/481 场景通过（§13），含 Windows 原生 Electron、真实 WebUI/WS/watcher 和四个 CSS 入口。W5 发布验收仍 open：macOS/Linux、三平台正式包、实机软键盘和长会话性能尚缺本轮证据。原始审计及历史档案保持冻结。**
- 独立审计基线：`e39f60cb2bfafe30476ca35774aec87ffa9629aa`，修复前工作树源码；逐文件摘要见 [audit-data.json](../verification/results/frontend-theme-visual-audit-2026-10-12/audit-data.json)。追加修复使用独立的前后manifest，不改写本次审计基线。
- 输入之一：[2026-10-11 视觉审计](frontend-visual-audit-2026-10-11.html)。本方案重新审查实现与浏览器行为；原文数值和路线不直接作为验收要求。
- 证据：[结果与复现说明](../verification/results/frontend-theme-visual-audit-2026-10-12/README.md) · [事先失败矩阵](../verification/frontend-theme-visual-audit-failure-matrix-2026-10-12.md)。

## 1. 判断与治理顺序

**现有主题内核值得保留。治理的重心是补齐宿主启动契约、统一 token 的发布与消费、建立组件语义和实际渲染门禁。** 单纯调整灰度、圆角和字号不能处理 WebUI 的偏好读取、共享 CSS 的差异和失效的阴影别名；大规模重写主题框架则会丢掉已经可用的存储、回退与模式解析。

本轮确认了原文没有覆盖的两类风险：**运行时接入顺序**和**不同入口的派生规则**。WebUI 在 ThemeProvider 已挂载后才安装 API，当前 provider 不会重新读取偏好或订阅事件。Electron 与共享 UI 虽然 Default 的主色值相同，但前景色阶的插值空间、圆角映射、Lucide 线宽不同，已经产生可重复的渲染差异。

实际Viewer转录也复现了代码高亮的订阅缺口：切到dark后，既有代码仍为github-light，部分token在暗底上接近不可见。这证明统一根变量还不够，所有视觉消费者需要同一份reactive主题状态。

建议按以下依赖顺序实施：

1. **修可用性与正确性**：WebUI 初始化、默认焦点反馈、阴影别名、主题值诊断和已确认的对比度缺口。
2. **建立统一契约**：主题定义与 CSS 单一来源、ResolvedTheme 快照、各宿主 adapter、角色尺度与兼容策略。
3. **以真实组件迁移视觉**：先基础控件，再外壳与对话，再列表/设置，最后看板、决策、轨迹和外围入口。
4. **让门禁阻止复发**：新增代码约束立即启用，存量债务逐域退出；主题与交互 E2E 进入现有验证体系。

这里的 P0/P1/P2 表示本次治理队列的先后，不表示所有 P0 都是线上服务中断。布局和审美参数另列为设计决策，不混入正确性修复。

## 2. 范围、方法与完成边界

### 2.1 已完成的审查

| 层次 | 检查范围 | 方法与证据 |
| --- | --- | --- |
| 主题定义 | 39 个可主题化字段、四套内置主题、模式/字体/密度/depth | 阅读 `theme.ts`、`schemas.ts`、实际生成 CSS；产品 schema 输入探针 |
| 存储与加载 | 用户主题目录、builtin 优先级、旧主题迁移、图片限制、config 偏好 | 阅读 `appearance.ts`、watcher 与 RPC；现有 theme/storage 检查 22/22 通过 |
| renderer 状态 | requested/applied、loading/error、preview/workspace/app、请求竞态、保存回滚 | 真 ThemeProvider + 合成 bridge，在 Chromium 中运行 11 个生命周期场景 |
| 样式发布 | Electron、共享 UI、Viewer、WebUI 四个实际 CSS 入口 | 14 个主题/模式/宿主样本，computed style、sRGB、几何数据、截图 |
| 控件与可达性 | 真 Button/Input/Select、原生按钮、portal、reduce/forced-colors/coarse pointer | 键盘 Tab、打开菜单后切主题、媒体模拟、控件尺寸实测 |
| 代码订阅 | 真 CodeBlock 的独立消费者与实际 Viewer 接入 | standalone模式切换探针；Viewer App/SessionViewer/TurnCard以合成HTTP session接续验证 |
| 产品视觉 | 真实 AI 设置页、公共控件组合、实际用户消息组件 | 六组中文 light/dark 页面截图，账号与会话数据隔离 |
| 组件消费 | renderer、packages/ui、webui、viewer | 927 个 `.ts/.tsx/.css` 文件；AST 字符串与原生 JSX 元素盘点，分生产/演示/测试 |
| 门禁 | 两个专用 ESLint 配置、通用配置、关键验证 registry、字体 gate | 11 个文件的有效配置、9 个真实文件 lint、现有 CI/脚本审查 |
| 外围边界 | 浏览器工具栏/空态/native overlay、登录页、Pages、代码/Mermaid、终端、PDF、轨迹、日历/Gantt | 源码接入审查和后续宿主验收清单 |

复现环境：Bun 1.4.2、Chromium 153.0.8010.12、macOS x64；普通样本 1280×820、DPR 1，产品页和移动样本分别记录 viewport。本轮扫描前先用 `rg` 定位文件，再用 AST 排除 TS/TSX 注释；CSS 排除注释。源码摘要在浏览器运行前后保持一致。

### 2.2 尚未验证的内容

本节至 §9 记录独立审计时的基线与要求；实施后的证据和剩余边界见 §13。

本轮浏览器样本由当前源码和真实控件组成，但 bridge 为合成数据，不能代替真实 WebSocket、文件 watcher、多窗口或正式包。**没有重新测量原文那张 macOS Retina 截图，也没有完成 Windows/Linux 原生材质、移动 Safari 软键盘、Pages 用户内容、PDF 全链路和大型会话性能验收。** 这些范围已有源码审查，执行要求见失败矩阵 H01–H11。

因此，927 文件盘点表示搜索范围；14 个样本和六组页面表示已渲染范围；两者均不等于“全项目视觉验收通过”。本轮交付是审计结论、证据和可执行治理规划。

## 3. 现有能力应当保留

| 能力 | 当前实现与证据 | 治理原则 |
| --- | --- | --- |
| 稳定默认主题与内置注册表 | `theme.ts:487` 的 Default、`:629` 的四套 BUILTIN_THEMES | 保留稳定 ID；更新文档对 builtin 数量的说明 |
| 用户目录与限制 | `appearance.ts:469` 的 JSON 256 KiB 上限；`:540` 的 realpath、类型与图片 20 MiB 限制 | 保留用户文件所有权和路径边界；丰富加载诊断 |
| 四层 dark 继承 | `theme.ts:227`，Default→Default.dark→用户顶层→用户.dark | 保留现有兼容语义；新 token 必须加入相同解析链 |
| 模式解析 | `theme.ts:646`，scenic/dark-only 强制模式 | 使用 actualMode 驱动宿主，保留 requestedMode 表达用户偏好 |
| loading 时保留 last-good，失败应用 Default | `ThemeContext.tsx:366`；本轮 loading/迟到响应/缺失/拒绝场景 | 保留请求 generation；补齐宿主初始化和状态发布边界 |
| preview > workspace > app | provider 与本轮三个优先级场景 | 保留选择语义和退出预览后的恢复 |
| 偏好持久化、保存失败回滚 | `appearance.ts:677` 原子更新；provider generation 与本轮回滚场景 | 让所有宿主等 API ready 后接入；后续验证真实多客户端顺序 |
| 字体统一与本地资源 | `typography.css`、`check:fonts` 本轮通过 | 保留 CJK、Inter、Mono 的打包与离线能力 |
| 减少动效 | Electron/WebUI 的 MotionConfig user、motion.css 媒体规则；实测 1ms | 保留 OS 契约；产品开关作为可选能力，独立于颜色主题 |
| 控件角色与部分触摸支持 | controls.css；Button/Input/Select/设置行；部分 44px 目标 | 扩展现有角色层；先修缺口，不重复造一套控件体系 |
| Mermaid 与终端适配 | Mermaid 使用 CSS 变量；终端已有主题颜色与明暗 ANSI 策略 | 保留专用 adapter；检查订阅和终态，不能把全部字面量判为债务 |

可追溯入口：[主题定义](../../packages/shared/src/config/theme.ts)、[schema](../../packages/shared/src/config/schemas.ts)、[存储](../../packages/shared/src/config/appearance.ts)、[provider](../../apps/electron/src/renderer/context/ThemeContext.tsx)、[控件角色](../../packages/ui/src/styles/controls.css)。

## 4. 独立发现与修复要求

### 4.1 已确认的正确性与接入问题

| ID / 队列 | 发现、证据与影响 | 治理要求与验收 |
| --- | --- | --- |
| **F01 / P0** | **WebUI 主题 provider 早于 API ready。** `webui/main.tsx:44` 先挂载 ThemeProvider；`webui/App.tsx:79–123` 异步连接；`platform/client.ts:74` 此后才装 legacy API。provider 首次 effect 在 API 缺失时返回，依赖不包含 readiness。延迟 bridge 探针中持久值 Geek，DOM 仍 Default，调用 0、订阅 0，后续偏好事件也无效。 | 把 ThemeProvider 放进已 ready 的 client 边界，或由明确 reactive readiness 驱动读取、订阅与清理。真实新浏览器→读取非默认偏好→跨客户端事件→断线恢复均通过；不以旧 localStorage 掩盖缺陷。 |
| **F02 / P0** | **全局关闭焦点环确实影响原生按钮。** Electron `index.css:599` 设 `outline:none`；Tab 后 native 样本 focus-visible=true、outline-style=none、shadow=none。相邻真 Button 有 2px 环。共享角色有效，但未覆盖全部消费方。 | 建立默认可见焦点；Input 包装层、列表、复合控件保留有理由的局部策略。先测 Tab/Shift+Tab/Esc/焦点恢复与裁剪；不得只把 class 搜索命中改为零。 |
| **F03 / P1** | **阴影别名真实失效。** 两份 `@theme inline` 有自引用；Electron `index.css:528`、UI `index.css:304`。四个 CSS 入口实测 shadow-xs/sm/md 均 none，shadow-minimal 有有效阴影。`shadow-xs` 还在 lint 白名单中。 | 给 legacy 别名稳定映射或迁移调用；常见别名、hover、dark、五种 depth 的 computed box-shadow 都合法。修正确性时保留当前语义阴影强度，视觉加深另行评审。 |
| **F04 / P1** | **共享 CSS 已有可见差异。** Electron 前景阶梯用 sRGB，UI 用 OKLCH；浅色 foreground-50 实测 `[143,145,150]` vs `[142,135,136]`。同一 rounded-md 是 4.5 vs 5.625px，Circle stroke 是 1.65 vs 2px。UI 入口缺少对应形状映射和 Lucide 应用。 | 抽出共享 token 与 utility adapter；相同定义、主题、模式下相同控件应输出同一值。宿主确有差异时写成具名 policy，而非两份文件隐式分叉。 |
| **F05 / P1** | **结构校验被误当成 CSS 值校验。** `schemas.ts:351–356` 只阻断分号/花括号，`background:'banana'`、负圆角、无效 fontSize 均可过；实际 bogus background 回到注册初值，radius 变 0，但加载状态仍 ready。 | 分开结构合法与浏览器可用；按 token 的目标 CSS 属性检查维度/范围/可解析性，诊断 var 引用与依赖。支持合法现代 CSS，不用狭窄 hex 正则替代。无效主题不能被宣布为健康应用。 |
| **F06 / P1** | **popoverSolid 的“不透明”承诺未落实。** schema 接受 transparent；真实 CSS 使用这个值，scenic 探针仍 ready。PresetThemeSchema 也接受没有图片的 scenic 和任意 Shiki 名称，而制作指南称为严格约束。 | 建立 opaque surface 的运行时保证/明确回退，补 scenic required 条件和 Shiki registry 校验；加载、图片处理、浏览器应用共用诊断结果。用户原文件保留。 |
| **F07 / P1** | **只验 Default 会漏掉其他内置主题及外围入口。** Ink light 的 muted-foreground 对背景为 3.63:1；Viewer dark 自行改 background 后 accent 文字对背景为 3.99:1。Default 的本轮正文与实际 Button 样本均达标。 | 按文字/图形/控件边界分别验语义组合；内置主题、Viewer 背景 policy 和 tint 上的文字都纳入。accent raw、accent text、on-accent 拆开职责。 |
| **F08 / P1** | **触摸角色没有完整落到 icon Button。** `Button size=icon` 只有 craft-control，未获得 craft-icon-button 的 min-width。coarse pointer 下高度 44 CSS px，宽仍 33.75；WebUI zoom 后矩形为约40.5×52.8。 | icon size 自动得到图标按钮角色，命中区两维均覆盖产品 44px 目标；密度、窄屏和 coarse pointer 分开控制。33.75px 不应直接被称为 WCAG 24px 最小目标违规。 |
| **F09 / P1** | **z-index 门禁覆盖 JS literal，遗漏 class。** 两个真实组件存在 z-[1]/[2]/[3]，实际 lint 仍零样式错误；规则访问 Property/Assignment，不访问 className。标准 z-10 等也不在当前规则范围。 | 先建立全局 portal 层级与组件局部堆叠的边界，再扩展 JSX/cn/cva/template/CSS 检查。不能把局部 z-[1] 一律换成全局 z-local，改变堆叠关系。 |
| **F10 / P1–P2** | **视觉规则的适用面不完整。** a11y recommended 只在 kanban 和部分 project 表面；Electron/UI 有样式规则及明确 off 路径，WebUI/Viewer 的通用配置没有同类规则。11 文件有效配置与 lint-data 可复核。 | 扩展共享规则与适用域；例外登记 owner、理由、退出条件。维持既有 lint-warning 基线，新增视觉债务单独记账，不用放宽旧基线吸收新问题。 |
| **F11 / P1** | **Viewer代码不会跟随DOM模式切换。** `CodeBlock.tsx:59–61` 在无Shiki context时只于render读取根class；Viewer `App.tsx:113–115` 在passive effect更新class，转录未包ShikiThemeProvider。独立CodeBlock与实际Viewer App/SessionViewer/TurnCard两条探针均复现：根已dark，Shiki仍github-light且所有span颜色未变。 | 独立Viewer与overlay等消费者使用reactive主题输入；加载/切换/旧HTML失效与高亮缓存共用revision。主窗口已有Shiki provider应保留；实际Viewer转录与专用overlay分别验收，不用额外操作触发刷新来掩盖缺陷。 |
| **F20 / P1，局部已修** | **单条对话/行为弹出卡片与源码模式退化。** 用户补充图一/图二后定位`4281be993`：新MarkdownPopoutOverlay把正文直接交给PreviewOverlay，同时丢掉源码呈现标记。上游v0.14.1仍保留CodePreviewOverlay的Read/response.md卡片。 | 已恢复共享卡片，新增明确renderMode，源码入口恢复代码卡片与行号，minWidth按窄屏可用空间限制。修复前16/18失败，修复后18/18通过；实际状态到生产组件的浏览器范围，正式包与三平台仍open。见§11。 |

F01 是真实 provider 的控制条件复现，与当前 WebUI 启动源码一致；本轮没有把它冒充真实服务的全链路结果。F04 使用同一 Vite 审计配置编译四个实际 CSS 入口；正式包差异仍由 H05/H06 接续验收。F07 的数值来自浏览器 sRGB 采样，不从截图文字抗锯齿像素反推。F11首先确认独立消费者行为，再用实际Viewer接入检查memoized内容，HTTP数据仍为合成session。

### 4.2 设计约束与持续治理问题

| ID / 队列 | 证据与判断 | 目标 |
| --- | --- | --- |
| **F12 / P2** | 主题有 shape/depth/density 基数，但缺少一致的文本、表面、状态、内容边与组件角色。`--dsw-*` 轨迹桥、shadcn 别名、foreground alpha 和主题变量并行；部分是合理兼容，部分没有归属。 | 以产品语义定义角色，兼容别名成为单向映射；迁移后组件知道该消费哪个角色。 |
| **F13 / P2** | `fontSize` 调根字号。15→18px 探针使真 Button 高33.75→40.5、icon宽33.75→40.5，所有 rem 空间随之变；这是目前契约的一部分。 | 分离主题字体/阅读排版、产品 UI scale 和浏览器缩放；旧主题字段保留迁移语义，不能突然改成局部文字大小。 |
| **F14 / P2** | `CHAT_LAYOUT` 为 max-w840/px5，输入区另用 px3/px4；根字号15时 px5 实际18.75、px4实际15。旧文把这些直接解释为20/16px，口径不准确。 | 为转录、输入、消息内容分别定义共享内容边；对齐测 DOM box，不强行把所有气泡外框做成同宽。 |
| **F15 / P2** | `--theme-panel-radius` 恒为6px，平台 edge/inner fallback 对当前 Default 不生效。它揭示角色与注释不一致，但不能据此认定14/10一定更好。侧栏当前还有明确 min-height40规则。 | panel/inner/card/control/chip/avatar 分工；嵌套关系按间距约束，平台 policy 显式化；32/34/40 行高对照后再决定。 |
| **F16 / P2** | 原生 browser toolbar/empty state 是独立入口，未使用主窗口 ThemeProvider；当前 native visual refresh 主要解析 accent。终端字体/字号与 ANSI、PDF/第三方组件、登录页均有专用策略。 | 为每个宿主和专用组件指定 adapter、初始化和 revision 订阅；保留内容自身配色边界，逐个闭环。 |
| **F17 / P2** | 主题文件错误主要作为 debug/appearance error；watcher 对任意 JSON 变化广播，provider 重新加载当前主题。加载诊断、选中主题 revision 与列表刷新尚未形成统一模型。 | 发布 load diagnostics 与 resolved revision；只重载受影响的已应用定义，列表刷新独立；图片和 CSS 计算缓存以 ID+revision 为键。 |
| **F18 / P2** | 关键 registry 已有 client-platform 浏览器 E2E 和截图，也有 theme 静态测试；本轮字体与22项既有检查全部通过，仍能复现上述问题。主题模式/值有效性/颜色/焦点/别名并未形成完整渲染门禁。 | 接入主题专属 computed-style 与交互 E2E；沿用 VerificationRun 的隔离输出和 artifact 合约，不另造一套日志体系。 |
| **F19 / P2** | 设计文档仍称“只内置 Default”，制作指南仍引用已移动到 schemas/appearance 的旧 validators/storage 行号；指南对 opaque/scenic/Shiki 的承诺强于实际校验。 | 用 manifest 生成字段表、builtin清单和校验说明；历史审计保留日期，当前指南与实现对齐。 |

主张保持纯白纸面、缩小侧栏、把正文列改为768、边框去蓝、加强卡片高程、调整状态彩度，均属于可评审设计方案。它们不是由源码证明的错误；须使用真实内容与多主题对照决定。

## 5. 债务基线：记录候选，不制造虚假精度

| 指标 | 全范围927文件 | 生产740文件（排除 playground/测试） | 含义 |
| --- | ---: | ---: | --- |
| 任意圆角 px/rem 候选 | 332 | **284** | 需分角色、图形和第三方适配，不全部一刀替换 |
| 任意字号 px/rem 候选 | 593 | **513** | 包含标签、代码、图表等不同用途 |
| 任意空间/尺寸 px/rem 候选 | 439 | **354** | 不含 var/calc；不是全部布局债务 |
| bg-foreground 任意 alpha 候选 | 203 | **181** | 应按 hover/selected/pressed/装饰用途分类 |
| 数字 z 类候选 | 80 | **66** | 生产含21任意值类、45标准数字类；尚未判定哪些局部层级合理 |
| transition-all | 4 | **0** | 四处均非生产；当前专用规则已经是 error |
| duration-N 候选 | 27 | **25** | 需区别交互节奏、状态等待和有意的 hero 动效 |
| hex 字符串候选 | 343 | **242** | 品牌logo、ANSI、图形内容、主题定义均可能合理，不是242条违规 |
| AST 原生 button 元素 | 432 | **370** | 生产分布167文件；部分属于基础组件实现 |

生产 `components/**/*.tsx` 中，本轮统计398文件，148文件含原生 button，48文件含 craft 角色字符串。**这不是12%的组件覆盖率，也不是148个文件都没有键盘支持。** 其余源码中的使用方式、import 复用、样式组合都必须另外分析。工程 KPI 应当是“被检查的交互控件有多少通过状态与可达性契约”，而不是 craft 字符串出现了多少次。

圆角+字号候选最集中的生产文件：TaskEditor 61、TurnCard 35、DecisionBoard 34、TrajectoryContextView 25、UserMessageBubble 24、TrajectoryOverview 24。适合作为后续迁移的工作量线索，不能仅凭榜单证明“最近新功能导致债务增长”；增长需要同口径跨 commit 记录。

全部计数、文件摘要、分域明细都在 JSON 中。原文2244的总数与本轮口径不同，且部分尺度互相重叠，不能直接用差值宣布治理改善。

## 6. 对原审计的复核

| 原结论/建议 | 本轮判断 |
| --- | --- |
| 焦点关闭、阴影自引用 | **确认**，新增键盘与 compiled CSS 实测；二者应优先处理 |
| 两份 Default palette 当前一致，所以只是未来漂移风险 | **不充分**：关键色值一致，但色阶、形状、图标规则已经不同 |
| 两套 motion 时长数值不同 | **本基线不成立**：CSS与TS均为60/100/160/220/280ms；仍有双份定义的维护风险，可生成或做 parity gate |
| no-transition-all 仍是 warn | **已过时**：Electron/UI当前为error，playground显式off；生产候选0 |
| 没有统一触摸放大机制 | **不成立**：coarse controls、panel header和settings已存在44px支持；缺口是角色覆盖和宽高两维 |
| Dark主按钮白字必然不足 | **不能泛化**：默认 Button 当前用 foreground/background；WorkspacePicker/FAB还有dark:text-background。按具体强调控件与主题测试 |
| 所有 border/background <3:1 都是失败 | **口径需纠正**：装饰分割线不自动套3:1；用于辨认控件/状态的边界和图形才按适用条件验收 |
| 高文字对比度代表“过度”或违反视觉要求 | **不是无障碍缺陷**：状态彩度是设计问题；保持可读之后再调整品牌和色相识别 |
| 把根字号15px视为正文15px，text-sm视为14px | **不准确**：此基线text-sm=13.125px；reading角色约14px。必须测实际字形/行高/空间 |
| 14/10 fallback 应当先恢复；侧栏必须改32px；画布锁#E9E9EA | **设计备选**：平台材质、panel角色、中文密度分别验证，不列为无条件P0 |
| useDynamicStack只有一个调用，因此可以移除 | **证据不足**：ActiveOptionBadges真实使用它；先验证实时堆叠与ResizeObserver行为 |
| 所有硬编码归零，手写button全部换craft | **目标需细化**：基础组件、图形、第三方和内容有合理例外；以契约覆盖和存量退出为准 |
| P0风险接近零、所有动作都是微优化 | **低估影响**：环可能被裁剪；别名恢复会改变多个表面；圆角/密度影响几何；native画布锁色改变材质。必须独立回归 |

无障碍依据：普通文字至少4.5:1、大文字3:1，见 [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)；控件与必要图形的3:1及适用例外见 [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。AA目标尺寸基线是24×24 CSS px并有间距等例外，见 [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)。本方案把coarse pointer下44px作为产品目标。键盘焦点必须可见，见 [Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)；2px+offset是建议视觉实现。

## 7. 目标架构与视觉契约

### 7.1 五层职责

| 层 | 应当拥有 | 不应分散到各组件的内容 |
| --- | --- | --- |
| Definition | builtin与用户JSON、39字段及后续schema版本、支持模式、source metadata | 隐藏的另一份builtin、与指南矛盾的字段表 |
| Resolver / compiler | 继承、mode、诊断、tokens、revision、CSS输出、Shiki/native适配输入 | 每个宿主重新拼装一遍Default、另一套颜色推导 |
| Shared presentation | surface/text/action/status/focus、形状/文本尺度、基础控件角色和兼容映射 | 每个按钮自行决定alpha/radius/density |
| Host adapter | Electron材质/标题栏、WebUI不透明画布与ready、Viewer独立模式、native BrowserView、第三方组件 | 用覆盖全局background的方式偶然改变文字对比 |
| Product layout / content | gutter、阅读列、pane/row结构、数据状态、用户内容边界 | 主题颜色文件决定交互模型、文案或页面布局结构 |

ResolvedTheme 建议成为一个有版本的不可变快照，至少含 `requestedId / appliedId / source / requestedMode / actualMode / status / revision / diagnostics / tokens / shiki`。同一快照驱动DOM、portal、Shiki和原生层；故障回退的 applied 与 requested 保持区分。存储使用现有config原子写入，renderer接入现有client platform。

主题单一来源可从现有定义生成 `packages/ui/src/styles/theme-tokens.css`（建议路径）；共享 utility/兼容映射与控件基础样式由 UI 包拥有。Electron index.css保留外壳和平台规则，WebUI与Viewer添加显式host policy。两份静态palette和派生公式不再人工并行维护；字体、动效保留已独立的模块，TS/CSS motion可生成或用parity门禁维持一致。

### 7.2 需要明确的角色

| 领域 | 建议角色 | 验收原则 |
| --- | --- | --- |
| 表面 | canvas/navigator/paper/raised/sunken/floating，内容与宿主材质区分 | 面的差异来自用途；所有主题都有适配，不能只为Default补灰色 |
| 文本 | primary/secondary/tertiary/disabled、caption/label/body/reading/title/code | 同一个角色同时有size、line-height、weight；阅读与UI尺度分开；不强制仅四个字号 |
| 行与密度 | sidebar/menu/list/settings/activity/touch，多行保留min-height扩展 | compact不得压过命中区和文字；高度与内距有明确关系 |
| 形状 | window/edge/inner/panel/card/control/chip/round | 嵌套圆角随间距计算；avatar/圆形控件及第三方几何有例外 |
| 动作 | default/hover/selected/pressed/focus/disabled/loading/invalid | 选中不只靠颜色；disabled与loading保留语义；键盘与触摸都能找到操作 |
| 语义色 | accent raw/text/solid/on-accent，info/success/destructive的text/tint/border | 按使用面求可读性，状态通过标签/图形补充，不用统一alpha硬凑 |
| 高程 | flat/card/floating/modal，与depth材质映射 | blur、border、highlight和shadow职责清楚；neon/glass/raised不会绕过surface角色 |
| 布局 | panel-gutter、row-inset、card-padding、reading-width、composer-edge | 一个pane有明确内容边，长表/代码可独立溢出，窄屏不裁重要操作 |
| 堆叠 | global portal层与local component层，native view单独适配 | 验真正的点击命中、遮挡、Esc顺序和焦点恢复，不只比较整数 |

主题已有 `fontSize/radius/density` 的兼容语义须保留。新增角色应先作为可选字段或内部派生层；发布schema版本与迁移说明后才能改变旧字段含义。常用用户主题必须在迁移前后逐对截图；未知字段/无效值的诊断与回退不应改写用户原文件。

### 7.3 设计参数的评审包

先使用Default light/dark和Ink做三组可交互对照，再推广：

1. **外壳与密度**：当前40px导航、34/32px候选；collapsed/expanded、长中文、滚动条、触摸44px。同时比较原生材质与显式navigator；不默认锁死画布。
2. **内容与阅读**：840与768两组阅读列；转录与输入共享边、窄屏长代码、表格、混合中英、200%文字/浏览器缩放。列宽用实际行长与任务内容判断。
3. **材质与状态**：现有白纸面、下沉输入/代码区域、当前与增强card高程；neutral边框候选、状态文字彩度、selected填充。优先保证可辨认控件与长时间阅读。

每组使用相同内容、窗口、DPR和语言，记录CSS/DOM几何与截图。参数选择形成一条设计决定及理由，不能把“与上游相同”当成产品验收。

## 8. 实施工作包与验收门

以下为单名熟悉项目的工程师的工作日估算区间，包含修复、回归与归档；跨平台设备和设计评审时间另计。不是已承诺的交付日期。

| 工作包 | 内容与主要位置 | 前置 | 退出条件 | 估算 |
| --- | --- | --- | --- | --- |
| **W0 基线与失败条件** | 本文、失败矩阵、JSON/截图、复现脚本；将宿主与surface列齐 | 已完成本轮审计 | 所有确认项可从源码和证据定位，所有未测项有宿主场景 | 本轮完成 |
| **W1 可用性与正确性** | F01/F02/F03；webui main/App、ThemeContext、CSS focus/shadow | W0 | 真实WebUI非默认偏好cold start/sync/reconnect；键盘主流程；别名有合法shadow；新产物归档 | 2–4天 |
| **W2 token与加载契约** | F04/F05/F06/F07/F11；theme/schemas/appearance、shared styles、Viewer policy与Shiki订阅 | W1 | 唯一默认/派生来源；invalid值不ready；opaque与Shiki/scenic契约；内置有效mode组合及宿主sample达标；已加载代码切主题立即更新 | 4–7天 |
| **W3 基础控件与外壳/对话** | F08/F12–F15；Button/Icon/fields/menu/list、panel constants、CHAT_LAYOUT/input | W2 + 参数评审 | 六/扩展状态齐全；touch两维；内容边一致；中文/窄屏/放大；主流程截图和点击回归 | 4–7天 |
| **W4 功能域与外围adapter** | 列表/设置→看板/决策/轨迹→toolbar/empty/login/code/Mermaid/terminal/PDF/Pages | W3 | 每域状态矩阵与主题矩阵关闭；scenic故障、第三方配色与用户内容边界明确 | 5–9天 |
| **W5 门禁、文档、发布收口** | F09/F10/F17–F19；共享rules、debt ledger、critical registry、文档生成 | 从W1增量开始，收口依赖W4 | 新债务零增长、例外可追踪、关键E2E入CI、三平台宿主证据、旧主题兼容与回滚 | 2–4天 |

总体约 **17–31个工程工作日**；应拆成可独立回滚的PR，不把所有视觉变化放入一次发布。门禁与失败条件从W1开始跟随每个包建立，不能等迁移结束才补验收。

建议第一批只包含：WebUI ready边界、默认焦点、修复阴影别名及其真实渲染验证。下一批才处理token单一来源和theme validation。sidebar32、column768、navigator锁色不进入第一批。

### 8.1 每个工作包共同的验收

- **先列失败条件再改实现**，优先E2E。若隔离测试不可避免，先列该模块所有失败方式；不在实现后补同构单元测试。
- 内置主题有效mode组合：Default light/dark、Ink light/dark、Geek dark、Cyberpunk dark；还要测后两者收到light请求的强制行为。
- synthetic fixture补partial/dark-only/scenic、五种depth、三档density、invalid与missing。关键组合全测，其余用pairwise，避免无意义的全维笛卡尔积。
- desktop/web/viewer关键路径覆盖Tab、Shift+Tab、Enter/Space、Esc、焦点恢复、hover/focus/touch reveal；门户菜单在打开期间切主题。
- 文字≥4.5:1、必要图形/状态按3:1；disabled/装饰与用户内容单独归类。透明颜色先合成到底面；接近阈值使用更高精度复核。
- 常规 viewport包括1280/1440、窄pane、375/390、768/769边界；阅读检查320px reflow与200%缩放；root15与旧自定义fontSize都检查。
- 发布前用临时profile跑macOS/Windows/Linux正式包；记录OS主题与app主题交叉、native toolbar/vibrancy/caption、watcher、重启和scenic失败。
- 产物必须包含源码/构建摘要、环境、场景/断言、computed styles/几何、关键截图、必要trace、已知未覆盖项和SHA256SUMS。

### 8.2 防止债务回流

新增规则先约束新/迁移域，替代角色已经存在后再提升全域error。历史例外使用具名ledger，记录file/role/rule、owner、理由、数量或指纹、退出条件；禁止全目录永久off。局部绘图、品牌logo、ANSI与用户内容有独立分类。

建议新增/扩展规则包括：未经登记的视觉字面量、角色缺失的交互控件、hover-only操作缺少focus/coarse策略、全局与局部z混用、主题值schema/manifest漂移，以及四个入口的token parity。规则共用实现，覆盖JSX、cn/cva、静态模板和CSS；不靠单个正则去判断整个组件的可达性。

沿用现有 `validate:ci`、`test:critical`、VerificationRun与pre-push。PR跑主题/控件关键smoke；发布跑宿主完整矩阵。已有client-platform E2E继续承担真实数据/会话流程；主题专项增加样式与偏好验收，避免重复运行不相关长流程。

完成的工程判据为：**确认的正确性项归零、关键交互契约全部通过、新视觉债务零增长、例外都有owner与退出条件、旧主题兼容、跨宿主与跨平台证据齐全。** 任意字号或hex全仓命中零不作为完成条件。

### 8.3 维护责任与发布

实施前每个F项和H场景指定一个责任人，以职责划分为准：

| 责任域 | 应当维护的契约 | 评审依据 |
| --- | --- | --- |
| 主题与配置 | definition/schema、继承与诊断、用户文件兼容、revision | 有效/无效主题矩阵、持久化与迁移证据 |
| 共享UI与视觉 | token发布、控件角色、状态、字体/动效、视觉参数决定 | computed-style parity、交互矩阵、相同内容对照 |
| client platform与宿主 | API ready、事件/重连、Electron/native/WebUI/Viewer adapter | 真实启动、跨客户端与三平台证据 |
| 功能域 | 消费正确角色、长内容与空/载入/错误状态、内容所有权 | 本域主流程与边界场景，不以基础组件通过替代 |
| 验证与文档 | CI registry、例外ledger、artifact与当前指南 | 可复现产物、失败canary、索引和manifest一致性 |

发布按正确性、token契约、视觉参数拆分。token先增加兼容映射，再迁移消费方，最后清理已无使用的别名；每次更改同时更新生成CSS与对应adapter，不容许产物和resolver来自不同版本。schema诊断不改写原始用户主题，builtin ID保持稳定，旧fontSize语义必须有显式迁移步骤。

每个包保留上一个可发布版本的主题样本和构建摘要，记录新增字段、存储变更与回滚步骤。回滚需同时恢复resolver、CSS和宿主adapter，并验证用户配置仍可加载；视觉baseline更新附决定理由和前后产物。跨平台未测项保留open，不能只凭本机截图宣布完整发布验收通过。

## 9. 仍需闭环的高风险场景

| 风险 | 处理要求 |
| --- | --- |
| cold start首屏与cache | 记录第一帧至ready；mode/font/theme加载独立阶段，故障不能把错误外观伪装成applied主题 |
| 多窗口/远程配置乱序 | app/workspace偏好与event带明确revision或顺序契约；真实服务延迟/重连测试决定实现 |
| 用户主题编辑和watcher | partial write→invalid→恢复、rename/delete、图片单独变化、目录watch异常；验证诊断和last-good范围 |
| scenic/network/解码成本 | 图片缺失/损坏/远程失败不影响文字；opaque portal不受图片内容影响；20MiB解码与传输作负载基线 |
| 不同宿主first paint/overlay | 主窗口、toolbar、empty state、native view、Viewer、WebUI各自的ready/actualMode/订阅责任写入清单 |
| 代码高亮与memoized内容 | DOM class不能作为唯一非reactive订阅；CodeBlock/Viewer使用reactive Shiki provider；切换后旧HTML必须更新 |
| 大会话与主题切换性能 | 先测CSS重算、Shiki/图片缓存与长列表滚动，选择相同机器和内容比较；优化不能改变可见状态终态 |
| 内容所有权 | Pages/PDF/用户HTML/图形内容独立；可提供主题桥接或跟随开关，宿主chrome与创作内容分别验收 |

这些场景已有失败条件；缺证据时维持待验证状态，不把静态合理性写成已通过。

## 10. 本轮交付与下一步

独立审计阶段新增本方案、结果目录和失败矩阵，文档索引已登记；原审计与历史验收保留原值，该阶段产品源码未修改，源码hash前后相同。22项既有theme/storage检查、字体gate通过，9文件定向lint为0 errors、2个既有warnings。浏览器的发现用于安排修复，**不代表全面产品验收已经通过**。用户随后追加的明确卡片回归已在§11单独修复与归档。

W1 与 W2–W5 已按事先失败矩阵实施，当前裁定见 §13。[本机验收归档](../verification/results/theme-governance-w2-w5-2026-10-12/README.md)保留各次运行的原 manifest、源码/构建摘要与选取映射；发布宿主与实机范围按证据继续保持 open。

## 11. 用户追加：全屏对话与行为卡片回归

这是独立审计完成后追加的具体回归修复。两张参考图对应源码预览与退化后的格式化预览；本次同时恢复卡片承载与明确的源码/格式化分工。

- `atoms/preview.ts`：加入`renderMode`，默认formatted；不从title或id猜测呈现方式。
- `ChatDisplay.tsx`：真实“查看Markdown”入口传source；单个消息、回合与行为详情继续formatted。
- `MarkdownPopoutOverlay.tsx`：source复用现有CodePreviewOverlay；formatted复用ContentFrame，保持URL/文件回调。
- `ContentFrame.tsx`：preferred minWidth限制为`min(Npx, 100%)`，使源码卡片在390px时宽345px，桌面850px基数保留。
- 浏览器工作流与fixture在改产品代码前编写并执行；修复前18项中16项因卡片缺失失败，修复后18项全部通过。close/Esc、焦点恢复、链接/文件回调、长文单层滚动、源码行号与明暗切换均有实际断言。
- 新增`test:markdown-popout`，接入现有critical registry并同步锁定policy，要求18个场景及JSON/关键截图/trace。Electron/UI/scripts类型检查及修改文件lint通过；本轮未重跑全量critical，也未重新打包客户端。

完整[失败矩阵](../verification/markdown-popout-card-failure-matrix-2026-10-12.md)和[前后证据](../verification/results/markdown-popout-card-2026-10-12/README.md)保留原manifest、SHA与截图。F01–F19和W1–W5仍按前述范围推进；此局部恢复不等于全面主题治理完成。

## 12. W1 首批实施记录：ready、焦点与阴影

分支 `codex/theme-governance-w1` 从包含审计提交的 `main`（`cc5401c83`）开始。先写[专用失败矩阵](../verification/theme-foundation-failure-matrix-2026-10-12.md)和浏览器工作流，再改产品实现。[实施与证据](../verification/results/theme-foundation-w1-2026-10-12/README.md)包含冻结前后记录、源码/构建摘要、归档选取清单与 SHA；旧审计不改写。

| 项目 | 当前状态 |
| --- | --- |
| F01 | Provider/Toaster 移入 WebUI ConnectedApp；initializeClient 安装 API 后挂载。真实生产 bundle + HTTP/WS + 临时磁盘配置的 cold start、stale cache、跨客户端偏好、失败重试通过 |
| 重连 | 断线恢复后补读 authoritative preferences，generation 防迟到覆盖；旧缓存迁移仍只在启动执行；监听清理通过 |
| F02 | 共享 base 默认 outline、forced-colors；原生/共享/包装输入/inset 列表/Select 的键盘、Esc、恢复与窄屏检查通过 |
| F03 | 单份 legacy shadow 别名映射；四入口、明暗、static 与五种 depth、hover 的实际绘制层通过；既有语义强度未改 |
| W5 增量 | `test:theme-foundation` 接入 critical registry 与锁定 policy，minimum=101；现有 CI critical 链会执行并验证必要产物 |
| 验收边界 | 101/101 本机浏览器场景、22/22 既有主题/存储检查、全仓类型与 workspace lint 通过。完整 lint 被既有 Windows 分发路径门禁阻挡；docs 被既有归档日志断链阻挡；完整 critical 与正式包三平台仍未重跑 |

本批没有决定 sidebar32、column768、navigator 锁色等视觉参数，也没有改变旧 fontSize/density/radius 的含义。下一工作包为 W2：F04 的 token/utility 来源、F05/F06 的加载诊断与 opaque/scenic/Shiki 契约、F07 对比度、F11 Viewer 的 reactive 高亮。正式包、物理触摸和其他宿主边界继续按 H01–H11 验收。

## 13. W2–W5 实施与当前裁定

接续规划 commit `7891559`，实施分支为 `codex/theme-governance-w1`。W1 首批 commit 为 `8d53a7200`；后续实现、验证脚本与当前文档同批提交。以下取代 §10–§12 中当时的“下一工作包”状态，历史失败和原始审计不改写。

### 13.1 工程实现

| 工作包 / 发现 | 已落地的行为 | 验收依据 |
| --- | --- | --- |
| W2 / F04 | Default、派生变量、形状与 utility adapter 单一来源；39 字段 manifest 生成 CSS、角色、四套打包主题和当前指南；motion TS/CSS 检查漂移 | 四入口 computed-style parity、生成物 canary |
| W2 / F05–F07 | 浏览器 compiler 验目标 CSS 语法、var 依赖、计算范围及完整 alpha；scenic 的路径/体积/解码/超时诊断；失败回退 Default，保留作者文件。修正 Ink 次要文字，分离 raw/text/on-accent 语义 | 有效与无效主题、背景清理、内置有效/强制模式、可读性场景 |
| W2 / F11、F17 | 不可变 snapshot 和 revision 原子发布 DOM/模式/字体/Shiki；只重载受影响主题 ID；图片变化、非原子编辑、删除/恢复及重连重新读取；Viewer 手动模式不被 OS 覆盖 | 真实 WebUI/WS、两个认证客户端、文件 watcher；实际 Viewer 转录与 overlay |
| W3 / F08、F12–F15 | 表面/文字/动作/形状角色、独立 UI/阅读尺度、共享 gutter/840px 阅读列；icon 自动角色、触摸两维 44px、键盘/coarse row actions；局部堆叠保留原顺序，portal 按父层级接续 | 真实控件六态及扩展状态、窄屏/中文/旧根字号、嵌套点击/Esc/焦点恢复 |
| W4 / F16 | 列表/设置、看板/决策/轨迹迁移；Browser toolbar/empty 的有序 host adapter，严格限制私有投递与回报来源；未认证登录用 Default+OS；Terminal/PDF/Mermaid/Pages 保留内容所有权 | 功能面 56 场景、独立 browser host 23、登录 5、Windows 原生 13；PDF 纸面和 ANSI 内容检查 |
| W5 / F09、F10、F18 | 四域共享 AST/a11y/视觉规则；JSX、cn/cva、模板、style、CSS 堆叠检查；新增指纹/数量增长/失效例外失败；主题工作流接 critical registry，原生三平台 CI 保存产物 | 49 个真实门禁 mutation；静态接线检查；完整 lint |
| W5 / F19 | 当前字段表/内置清单由 manifest 生成；制作指南、产品主题帮助、宿主责任、回滚步骤、文档索引与待发布说明更新 | `check:themes`、`check:docs`、身份/版本/字体/i18n 门禁 |
| F20 回归 | 共享卡片、源码模式、行号与窄屏限制保留，迁移后重跑 | markdown-popout 18/18 |

设计对照包含 36 个场景，可在[交互对照页](../verification/results/theme-governance-w2-w5-2026-10-12/design/index.html)并排评审。当前默认仍为 40px 侧栏、840px 阅读列及现有材质；32/34px、768px 和增强高程保留为候选。没有以正确性修复为名推广未决定的视觉参数。

### 13.2 已执行的验收

| 工作流 | 通过场景 |
| --- | ---: |
| theme-foundation（真实 WebUI/WS/watcher） | 115 |
| theme-contract（四入口/compiler/Viewer） | 90 |
| theme-roles（真实控件/portal/外壳） | 76 |
| theme-domains（真实功能组件、合成业务数据） | 56 |
| theme-browser-host | 23 |
| theme-login | 5 |
| theme-design（参数与阅读对照） | 36 |
| theme-governance（门禁失败注入） | 49 |
| theme-native（Windows 生产 bundles/真实 Electron） | 13 |
| markdown-popout 回归 | 18 |
| **合计** | **481/481** |

运行于 Windows x64（10.0.26300）、Bun 1.4.2、Node 24.15.0、Edge 155.0.4283.45、Electron 44.5.1。原生使用生产 main/preload/renderer/BrowserViews 和临时配置；200% 缩放使用真实 Chromium zoom，并用 `webContents.capturePage` 留存完整原生帧。浏览器窗口/媒体模拟和合成业务数据的范围在每个 manifest 的 `untested` 中公开。

全仓类型检查、完整 lint、字体/i18n、严格身份、版本、生成物、分发和文档门禁通过；既有主题/存储与堆叠规则检查 30/30。既有 lint 的 72 条 warning 基线未放宽。上述受影响工作流逐个执行，并按 registry 的必要产物/场景/SHA 合约校验；本轮没有宣称重新执行整个 `test:critical` 聚合或所有既有测试。

[公开归档](../verification/results/theme-governance-w2-w5-2026-10-12/README.md)为字节保持的选取副本，不代替完整 `.cache/verification/`。原 manifest 保留执行时的 HEAD、dirty paths、场景、环境、源码/构建摘要；公开 `selection.json` 记录原文件 SHA，`SHA256SUMS` 校验公开副本。浏览器 profile、临时认证配置、执行文件和完整 trace 保留在本机缓存，不公开。

### 13.3 剩余验收与例外

| 范围 | 当前裁定 / 退出条件 |
| --- | --- |
| H01、H05 正式包与三平台 | Windows 生产 bundles/原生视图通过；macOS/Linux matrix 已接 CI，本机未执行。签名安装器、正式包重启逐帧、OS 材质与 caption 交叉矩阵仍 open |
| H02–H04 配置与图片 | 真实双 Web 客户端、重连、watcher、离线编辑和故障恢复已通过；不以这些结果代替所有平台多窗口与最大图片负载成本 |
| H06、H08 实机与阅读 | 320/375/390/768/769、媒体模拟、中文/路径/表格、文字放大和 Windows 原生 200% 缩放有证据；物理触摸、移动 Safari 横屏/软键盘/safe-area 仍 open |
| H07、H09 内容与遮挡 | 实际组件的内容所有权和嵌套 portal 操作通过；真实用户 Pages 内容、任意第三方文档与三平台原生遮挡不作全覆盖承诺 |
| H10 性能与兼容 | 旧字段、旧根字号和回退契约有检查，回滚步骤已写；长会话切换 trace、滚动与最大图片解码性能仍 open |
| H11 门禁 | 当前 E2E/失败产物合约与 CI 接线完成；尚未产生的远端 CI 运行不记为已通过 |
| 存量视觉债务 | 1,213 个具名条目登记于 `visual-debt-ledger.json`，具有 owner/reason/exit 与节点指纹；新增债务被阻挡。登记不等于全项目可达性或存量债务已清零 |
| 历史缺失证据 | 2026-10-11 second-wave 的一份冻结日志不可用；精确文档例外保存原 SHA 与退出条件，文档 gate 明示 warning。没有补造日志或改写冻结 README |

工程实现和本机验收已完成；满足上述平台、实机与性能退出条件后，才能宣布规划要求的完整发布验收完成。
