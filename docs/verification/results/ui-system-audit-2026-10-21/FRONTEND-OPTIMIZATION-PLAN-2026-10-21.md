# Phaneris 前端系统 · 最终优化计划

> 日期：2026-10-21 · 编制方式：**先独立审查，后对照既有审计**，最终合并为一份可执行计划。
> 证据链 A：本代理的独立工程审查（架构、性能、包体、门禁、代码健康；全部为本次现场复测）。
> 证据链 B：`FRONTEND-SYSTEM-AUDIT.md`（2026-10-21，设计系统/渲染结果的静态+计算样式审计）。
> 性质：**只读审查 + 计划**。本文件不修改任何产品代码；执行从 W0 开始。

---

## 0. 先给结论

1. **Phaneris 的前端"宪法"是健康的，执行"法院"是失灵的。** 令牌、字号档位、控件高度、对比度、i18n、主题、字体六套门禁全部在线且当前全绿；但门禁只检查**字面量**，不检查**渲染结果**，因此 `cn()` 合并层、控件高度继承层、组合层（chrome 堆叠、看板配色、工作台宽度）三处同时失守而无人报警。
2. **最刺眼的问题是一个 6 行的 bug**：裸 `twMerge` 把 `text-meta/text-body/text-micro` 当成颜色类吞掉。默认按钮因此 15px（应 13）、Badge 15px（应 11）、填充型小按钮的文字色被吃掉（浅色主题下文字近乎不可见）。我用仓库实际安装的 `tailwind-merge` 现场复现，确认属实且仍在生效。
3. **最大的工程风险不在视觉，而在长会话渲染路径**：append 一turn 的 p50 已到 133ms、p95 300ms（目标 40ms），`long-session-budget` 的 README 明确写着"修复已排期：按 message id 记忆化 turn 分组"，但**尚未落地**；整个 renderer **没有任何虚拟化**，只靠 20-turn 反向分页兜底。
4. **维护性债集中在 6 个巨档**：`AppShell.tsx` 4239 行 / 37 个 useEffect / 32 个 useState；`TurnCard.tsx` 3475 行 / 32 个函数；`FreeFormInput.tsx` 2528 行；`App.tsx` 2408 行；`AiSettingsPage.tsx` 1500 行却塞了 **44 个 useState**；`NavigationContext.tsx` 1332 行 / 20 个 useEffect。
5. **施工顺序必须是：先修原语正确性 → 再修渲染/包体 → 再收组合语言 → 再重组表面 → 再拆架构 → 门禁同步升级。** 反过来做（先美化、先重排布局）会把错误继承进新代码，这是既有审计已经点明的教训，我完全同意。

---

## 1. 系统现状（本次复测的数字）

### 1.1 拓扑

```
apps/webui (web 薄壳, 9 文件)  ──lazy──▶  apps/electron/src/renderer  ◀──  apps/electron (Electron 主机)
apps/viewer (7 文件, 独立只读视图)              │  705 文件 / 5.25 MB
                                              ▼
                                   packages/ui (共享原语/聊天/轨迹/markdown)  245 文件
                                              │
                                   packages/shared (主题引擎 DEFAULT_THEME、i18n 7 语言)
```

三主机复用同一 renderer 是**正确决策**（一次实现、三处生效），代价是 renderer 同时背了桌面与 Web 的复杂度。

### 1.2 资产（值得保护的部分）

| 资产 | 现场证据 |
| --- | --- |
| 设计令牌与档位单一来源 | `bun run check:scale-contract` → 字号 7 档、圆角 5 档、控件高 6 档，DESIGN.md/tokens/allowlist/代码树四方一致 |
| 对比度门禁 | `check:contrast-floor` 覆盖 Default/Geek/Cyberpunk 2077/Ink × light/dark，全部过线 |
| 漂移棘轮 | `check:design-drift`：`defaultFontSize 0`、`strokeWidthLiteral 0`、`paletteHue 0`、`translucentText 23`、`interactiveTitle 91`、`focusRingSuppressed 2`，与基线逐项一致（未增长） |
| 动效词汇 | motion.css 声明 2、消费 2、孤儿 0 |
| i18n | 7 语言（en/de/es/hu/ja/pl/zh-Hans），懒加载非英文语言包；parity/sorted/coverage/dead-keys 四道门 |
| 原语收口 | 全仓 `Tooltip/Button/Dialog/DropdownMenu` 各只有一个实现（playground 示例除外），无重复制造 |
| 危险 HTML | 生产仅 9 处 `dangerouslySetInnerHTML`，全部位于 shiki/mermaid/katex/实体图标，属预期面 |
| 包体纪律（局部） | shiki、beautiful-mermaid、pdfjs、office 预览、设置页、info 页均 `lazy()`；playground 已从安装包剔除（曾占 752KB chunk + 1.8MB map） |

### 1.3 系统规模（解释为什么必须分波次）

| 区域 | 文件 | 体积 | 备注 |
| --- | ---: | ---: | --- |
| `apps/electron/src/renderer` | 705 | 5,250 KB | 含 playground 997 KB（不打包） |
| 　其中 components | 406 | 2,809 KB | 22 个子域 |
| 　其中 hooks / atoms / event-processor | 51 / 26 / 15 | 233 / 126 / 115 KB | 状态面 |
| `packages/ui/src` | 245 | — | 原语 + 聊天 + 轨迹 + markdown |
| i18n 资源 | 7 locale | 1.26 MB | en 167 KB；非英文按需加载 |

---

## 2. 问题总账（两源合并，去重后 26 条）

标记说明：`[A]` = 既有审计发现（我已复核为真）；`[B]` = 我的独立发现（既有审计未覆盖）；`[A∩B]` = 两源一致。

### P0 · 正确性缺陷（2 条，必须先修）

| ID | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P0-1 `[A∩B]` | **`cn()` 吞掉字号档位**。`packages/ui/src/lib/utils.ts:11`、`apps/electron/src/renderer/lib/utils.ts:4` 都是裸 `twMerge(clsx(...))`；`text-meta/text-label/text-body/text-micro/...` 是自定义**字号**类，被 tailwind-merge 归入 text-color 组。复现（本次现场执行）：`twMerge('text-meta text-foreground')` → `text-foreground`；`twMerge('text-body text-background')` → `text-background`；`twMerge('text-micro text-info-text')` → `text-info-text`。按钮基类 `button.tsx:7` 带 `text-body`，尺寸变体 `:24-26` 带 `text-meta/text-label`，`:54` 交给 `cn()`。 | 默认按钮 15px（应 13）；Badge/MetadataBadge/Artifact 章 15px（应 10/11）；`size="sm"` 填充变体的 `text-background` 被覆盖 → **浅色主题下按钮文字不可见**。静态扫描 82 处丢层点（renderer 69 / ui 13）。 |
| P0-2 `[A∩B]` | **`xs/compact` 控件高度不可达**。`packages/ui/src/styles/roles.css:79-82` 只给 `sm/lg` 映射 `--craft-control-height`，`xs/compact/default/icon` 全部落回 `--control-height-lg`（34px）的 `min-height`，反杀 `h-control-xs`(22) / `h-control-sm`(26)。`button.tsx:24-26` 确实声明了这两个档。 | 两个契约档位名义存在、实际失效（当前生产调用 0 次，属契约级缺陷）；同时只有 `<Button>` 有 `data-slot="button"`，手写 `craft-control` 按钮不受约束 → 形成"34px Button"与"22–30px 自定义按钮"两个家族。 |

### P1 · 结构性问题（10 条，发布前应修）

| ID | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1-1 `[A]` | **右侧 Files 工作台叠 3 条 37.5px 横条、4 种选择语法** | `ContextWorkbenchTabs.tsx:93`（填充 pill+关闭 X）、`FilesPanel.tsx:90-103`（下划线 tab）、`ArtifactsPanel.tsx:195-214`（胶囊 `aria-pressed`）、`ChangedFilesView.tsx:216-233`（分段控件） | chrome 112.5px 压在内容上（720px 面板占 15.6%）；同一面板内"切内容源/筛状态/切 diff 方式"三种层级共用同一视觉语法，且下属筛选（15px）比上级视图（12px）更大 |
| P1-2 `[A]` | **空工作台吃掉 50%，聊天被钉死 600px** | `SurfaceSlot.tsx:86-92` 固定 `flexBasis:600px`；`atoms/workbench.ts:21-24` `DEFAULT_COMPANION_PRIMARY_WIDTH=600/MAX=600`；`App.tsx:2342` 传入的 `defaultLayout={[20,32,48]}` 在 `AppShell.tsx`（199/534）接收后**从未使用**（dead prop + DESIGN.md:287-290 过期） | 1920px 实测 298/606/961 = 15.5%/31.25%/50.05%；隐藏导航时工作台可达 68.1%；聊天低于 840px 阅读宽度；1280–1512px 带工作台横向溢出 |
| P1-3 `[A]` | **看板颜色权威冲突**：列色是原始 hex `#64748b/#6366f1/#f59e0b/#10b981`（`kanban-colors.ts:11-16`），`onAccent` 固定 `#ffffff`（`useKanbanColumnColors.ts:31-36`），整列 6% tint（`KanbanColumn.tsx:114-118`），而状态色是另一套（`shared/colors/defaults.ts:21-28`） | 列头白字实测 2.15–4.76:1（In Progress 2.15、Done 2.54 不过 AA）；计数章 1.21–1.38:1；项目色当 11px 文本 7/8 不过；DONE 列绿、卡片 Done 章紫，用户无法建立状态↔列映射 |
| P1-4 `[A]` | **表面语言爆炸** | 生产代码：`bg-foreground/[0.0x]` **12 种**、`border-border/xx` **9 种**、圆角 **15 种**、阴影 **19 种**、`border`+`shadow-minimal` 同用 **22 处**、二级文本两个名字并存（`text-muted-foreground` 537 处 / `text-text-secondary` 670 处） | 每处只差 1–2%，叠加即"说不出哪不对但就是不精致"；DESIGN 的 micro-contrast 退化为 micro-noise |
| P1-5 `[A]` | **会话列表一行四种颜色通道**（项目色 3px 竖条 + 状态圆点 + 未读/plan/pending 图标 + 匹配数章 + 平台 pill），匹配数章因 P0-1 变 15px 压过标题；分组头只在折叠时显示计数 | `SessionItem.tsx:245-269,314-324`、`SessionProjectColorWrapper.tsx:36-40`、`entity-list.tsx:123-125` | 红条=项目？红点=失败？用户无法在 200ms 内完成语义解析；项目色板含 `#ef4444/#10b981/#f59e0b` 与语义色同色 |
| P1-6 `[A]` | **看板卡片过度暴露 + 134 张 Done 全量渲染 + 只能指针拖拽** | `TaskTile.tsx:239/306` 两条分隔线、最多 7 行元数据、Add subtask 永久显示；`KanbanBoard.tsx:157` 全量 map、`KanbanBoard.tsx:125` 只注册 `SmartPointerSensor`（无 `KeyboardSensor`）；`TaskTile.tsx:134-143` `role=button` 套 4–5 个真实按钮 | 单卡扫视成本高；134 张 ≈ 500 个 tab stop；键盘/读屏用户无法完成"移动任务"这一核心操作 |
| P1-7 `[A]` | **标题层级塌陷** | `PanelHeader.tsx:168-171` 面板标题用 `text-body`(13px)；`KanbanBoardContainer.tsx:551-596` 看板无 h1/项目名/面包屑，11px 大写列头成最大字号；每个 `PanelHeader` 都渲染 `h1`（左右两栏两个 h1，右栏没有） | 用户第一眼不知"我在哪"；标题与正文同大；三栏 header 高度 36/37.5/42 不齐 |
| P1-8 `[B]` | **长会话 append 路径未闭环，且全仓无虚拟化**。`docs/.../long-session-budget-2026-10-20/README.md`：append p50 **133ms** / p95 **300ms**（预算中位数 350 ✅，目标 40 ❌），结论写明"每次 append 重渲染整条 transcript，修复=按 message id 记忆化 turn 分组"——**该修复未落地**。全仓 `virtuoso|virtualiz|useVirtual` 零命中；transcript 仅靠 `ChatDisplay.tsx:545` `TURNS_PER_PAGE=20` 反向分页兜底 | 200-turn 会话流式输出呈"一阵一阵"而非逐字；会话越长越糟；这是产品最坏用例的性能红线，且已有可测预算却无人执行 |
| P1-9 `[B]` | **包体无手动切分，重依赖静态入主 chunk**。`apps/electron/vite.config.ts` 无 `manualChunks`/`rolldownOptions.output` 配置；`packages/ui/src/components/markdown/Markdown.tsx:12` **静态** import `MarkdownJsonBlock`，后者静态 import `@uiw/react-json-view`（**alpha 依赖** 2.0.0-alpha.43）+ vscode/githubLight 两套主题 | json-view 及其主题随主聊天 chunk 首屏加载，长会话渲染路径与该 alpha 库耦合；renderer 主 CSS 已 352KB（未压缩口径），首屏 JS 无分块策略 |
| P1-10 `[B]` | **门禁的四个盲区**：①ESLint 用 `@babel/eslint-parser`（`eslint.config.mjs:12` 无 typescript-eslint），无 type-aware 规则；②`react-hooks/exhaustive-deps` 仅 `warn`，且 `lint` = `eslint src/` 无 `--max-warnings 0` → **警告永不失败**；③`jsx-a11y` recommended 只作用于 kanban + 2 个 projects 文件（`apps/electron/eslint.config.mjs` 末段），**其余 99% 界面无 a11y lint**；④`check:contrast-floor` 只查主题调色板对，不查 JS/inline 色（看板 hex 因此全绿通过） | 517 条债务（507 ledger + 91 title + 23 alpha text + 2 ring）被"合法化"；新代码可静默引入丢层、无名称按钮、低对比色；`react-hooks` disable 16 处、`as any` 51 处、TODO/FIXME 191 处在此盲区下无约束 |

### P2 · 一致性与精致度（8 条）

| ID | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| P2-1 `[A]` | 设置页第二套字号体系 `craft-text-label/caption`（13/12），主应用 `text-*`（11/12/13） | `SettingsUIConstants.ts:9-15`，16 处调用 | 迁到合同档位后删除 |
| P2-2 `[A]` | Composer 把权限模式与状态做成同一对胶囊 | `ActiveOptionBadges.tsx:179`、`FreeFormInput.tsx:1830` | 权限入设置/菜单，状态入会话头；同一行只放同一领域 |
| P2-3 `[A]` | 空状态无出口（No artifacts yet 只有说明） | `PanelEmptyState.tsx:24-35`、`StateSurface.tsx:57-63` | 空态给 1–2 个动作 |
| P2-4 `[A]` | Artifact 行标题与 basename 重复 + 右侧 3 个图标按钮 | `ArtifactsPanel.tsx:84-129` | 仅在不同时显示 basename；动作收进 `…`/hover |
| P2-5 `[A]` | **WebUI 移动端 `zoom: 1.2` hack**（现场确认 `apps/webui/src/index.css:47-51`） | 固定 600/300 宽 + workbench 360 在 768–1512px 溢出，用 zoom 兜底 | 删 zoom；用根字号/密度/容器查询；配合 P1-2 的 overlay 策略 |
| P2-6 `[A]` | Board/List/Calendar/Gantt 四套 42px 工具条 | `KanbanBoardContainer.tsx:552`、`WorkItemListView.tsx:77`、`CalendarView.tsx:525`、`GanttView.tsx:980` | 抽 `ProjectToolbar`，视图只注入右侧动作 |
| P2-7 `[A]` | 颜色/格式细节：进度只靠颜色（`SubtaskProgress.tsx:44-52` 硬写 `#ef4444`）、`-0` 删除数、相对时间无绝对日期 | 同左 | 加文字计数/图例；抑制 0；tooltip 绝对时间 |
| P2-8 `[B]` | **sticky 表头滥用 `backdrop-blur`**：`ChangedFilesView.tsx:216`、`GanttView.tsx:980`、`CalendarView.tsx:525`、`ContextWorkbenchTabs.tsx:93`、三个 DataTable 工具栏、`DecisionBoard.tsx:251` | DESIGN.md 规定 backdrop-filter 只属浮层面板、且"滚动是硬底线" | 滚动中的 sticky 条改用不透明 surface；仅浮层保留 blur |

### P3 · 打磨（4 条）

| ID | 问题 | 建议 |
| --- | --- | --- |
| P3-1 `[A]` | 动效微漂移：bounce easing、width/padding 布局动画、`strokeWidth={2/2.25}` | 标准 ease；只动 transform/opacity |
| P3-2 `[A]` | DESIGN.md 拓扑过期（`[20,32,48]`）+ dead prop | 删 `defaultLayout`；改写为实际像素/内容驱动模型 |
| P3-3 `[A]` | `text-wrap: pretty/balance` 几乎未用（0/1 处）；`tabular-nums` 107 处但时间/计数未全覆盖 | 正文/标题/计数补齐 |
| P3-4 `[A]` | 术语与 i18n 长度：`Deliverables/Drafts/Opened files` 与 Artifact 并存；中文长标签塞 22.5px chip | 统一 Artifact 词汇；窄控件长度预算（parity 门禁加长度检查） |

### 补充：维护性债（`[B]`，不单列 P 级，进入 W4）

| 文件 | 行数 | 函数 | useEffect | useState | useMemo |
| --- | ---: | ---: | ---: | ---: | ---: |
| `components/app-shell/AppShell.tsx` | 4,239 | 7 | 37 | 32 | 21 |
| `packages/ui/src/components/chat/TurnCard.tsx` | 3,475 | 32 | 11 | 11 | 14 |
| `components/app-shell/input/FreeFormInput.tsx` | 2,528 | 5 | 18 | 17 | 19 |
| `components/app-shell/ChatDisplay.tsx` | 2,515 | 8 | 20 | 13 | 6 |
| `App.tsx` | 2,408 | 9 | 13 | 20 | 5 |
| `pages/settings/AiSettingsPage.tsx` | 1,500 | 6 | 7 | **44** | 5 |
| `contexts/NavigationContext.tsx` | 1,332 | 4 | 20 | 3 | 2 |

另有目录语义分裂：`context/`（9 个 Provider）与 `contexts/`（NavigationContext + 3 个导航辅助）并存；`atoms/sessions.ts` 33KB；`event-processor/handlers/session.ts` 32.6KB。代码健康总体**尚可**：`@ts-ignore/@ts-nocheck` 仅 2 处、无重复原语实现、`as any` 51 处属中等。

---

## 3. 与既有审计的对照（哪些确认、哪些是本次增量）

| 既有审计论断 | 我的核验 | 结论 |
| --- | --- | --- |
| `cn()` 丢层（82 处） | 现场 `twMerge` 复现 3 条全中；`button.tsx:7/24-26/54`、`roles.css:79-82` 逐行确认 | **确认，且仍在生效** |
| xs/compact 34px | `roles.css` 只映射 sm/lg，确认；生产调用 0 次 | **确认（契约级，非当前视觉主因）** |
| 507 条 visual debt | `visual-debt-ledger.json` entries = 507 | **确认** |
| 工作台吃剩余宽度 / dead `defaultLayout` | `App.tsx:2342` 传入、`AppShell.tsx:199/534` 未使用 | **确认** |
| 看板原始 hex + 白字不达标 | `kanban-colors.ts:11-16` 四色、`onAccent:#ffffff`；对比度门禁不查 JS 色 | **确认** |
| `zoom: 1.2` 兜底 | `apps/webui/src/index.css:47-51` | **确认** |
| 门禁只查字面量 | `measure-design-drift.ts` 全文确认只做正则字面量计数；`check-contrast-floor` 只查主题色对 | **确认，并补充了 eslint 盲区** |
| "41 个 `<button title=>`" 与"基线 91" | 91 是门禁口径（含非 button 的交互元素），41 是其中 button 子集 | 口径差异，以门禁 91 为准 |
| 半透明文本"多处" | 原始 grep 194 命中，门禁口径 23（排除 playground/__tests__/注释） | 以门禁 23 为准；**不要按 194 修** |

**本次增量（既有审计未覆盖）**：P1-8 长会话 append 未闭环 + 无虚拟化；P1-9 无 manualChunks + json-view 静态入主包；P1-10 门禁四盲区；P2-8 sticky 表头 blur；以及第 2 节末尾的 6 个巨档量化。

**一致的判断**：方向上"外壳与聊天区是对的、看板是断裂点"，整改原则"先原语、再组合、再表面"——我完全采纳，并把它作为 W0→W3 的顺序依据。

---

## 4. 最终计划：六个波次（W0–W5）

> 原则：**每一波都能独立验收、独立回滚**；先减少词汇，再谈美化；不做一次性大重写。
> 估算为人日（1 人专注投入），含自测；不含 code review 等待。

### W0 · 原语正确性（0.5–1 天）— 阻塞项，必须第一个合并

| # | 动作 | 文件 | 验收 |
| --- | --- | --- | --- |
| W0-1 | 建共享 `extendTailwindMerge`，把 `micro/meta/label/body/reading/title/display/glyph-watermark/glyph-avatar` 注册进 `font-size` 组；`packages/ui/src/lib/utils.ts` 导出，`apps/electron/src/renderer/lib/utils.ts` 改为 **re-export**（两处 `cn()` 必须同一个实例） | `packages/ui/src/lib/utils.ts`、`apps/electron/src/renderer/lib/utils.ts` | 5 条合并用例全部保留 tier（含 `text-body text-background`、`text-micro text-info-text`） |
| W0-2 | 修正 Button/Badge/MetadataBadge 的字号与文字色；逐个复核 cva 变体（重点：`size="sm"` 的填充变体） | `components/ui/button.tsx`、`badge.tsx`、`metadata-badge.tsx` | default 13 / xs 11 / compact 12 / sm 11；Badge 11；Artifact 章 10；sm 填充按钮文字对比度 ≥4.5 |
| W0-3 | 补齐 `data-control-size` 全档映射（`xs→xs`、`compact→sm`、`default/icon→lg`），并让 `height === min-height` | `packages/ui/src/styles/roles.css`、`button.tsx` | xs 22 / compact 26 / sm 30 / default 34 / lg 38；无文字裁切；`pointer:coarse` 仍 44 |
| W0-4 | **计算样式契约**（Playwright）：在 1280/1536/1920 × light/dark 下断言上述字号/高度/文字色 | 新增 `scripts/verification/ui-primitives-workflow.ts` + `package.json` 脚本 | CI 在字号/高度/颜色回归时失败 |
| W0-5 | 把审计的 `scan.ts` 改造成可重复 CI 检查 `audit:ui-merge` | `scripts/audit-ui-merge.ts` | 丢层点 82 → 0 才通过 |

**风险**：修 merge 会让大量 15px 回落到 11/12/13，页面"突然变小变密"。这是**恢复合同**，不是回归。W0 必须单独 PR + 逐页 before/after 截图，只调必要 padding。

### W1 · 渲染与包体性能（2–3 天）— 让最坏用例回到预算内

| # | 动作 | 文件 | 验收 |
| --- | --- | --- | --- |
| W1-1 | **落地 long-session 已排期的修复**：turn 分组按 message id 记忆化，append 只触碰一行；确认 `groupImmutableMessagesByTurn` 对未变化前缀的复用 | `packages/ui/src/components/chat/turn-utils.ts`、`ChatDisplay.tsx:702-705` | `bun run test:long-session-budget` 的 append p50 从 133ms 降到 ≤60ms，p95 ≤150ms，且不劣于现有预算 |
| W1-2 | 流式路径审计：TurnCard 对未变化 turn 的 `React.memo` 边界、markdown 解析按文本 hash 缓存、避免每次 delta 重建回调 | `TurnCard.tsx`、`packages/ui/src/components/markdown/Markdown.tsx`、`StreamingMarkdown` | 同一 transcript 连续 append 10 次，主线程长任务数下降 ≥50%（用 PerformanceObserver 记录） |
| W1-3 | `@uiw/react-json-view` 改为按需 lazy（`MarkdownJsonBlock` 走 `React.lazy` + Suspense 骨架），并把主题导入一并延后 | `Markdown.tsx:12`、`MarkdownJsonBlock.tsx` | 主 chunk 不含 json-view（`bun run bundle:report` 对比）；JSON 代码块首次展开有骨架不跳动 |
| W1-4 | 为 renderer 增加 `manualChunks`（shiki / mermaid / pdfjs / tiptap / json-view / markdown 各一组），验证首屏 chunk 图 | `apps/electron/vite.config.ts` | `bun run bundle:report`：主 chunk 显著下降，重依赖只在用时加载 |
| W1-5 | **虚拟化决策（不做全量重写）**：先以 W1-1 达标为准；若 500+ turn 仍超预算，再对 transcript 引入窗口化（保持 20-turn 分页语义与滚动锚点） | `ChatDisplay.tsx` / 新 `useTranscriptWindow` | 500-turn 会话 append p95 ≤150ms、滚动 p95 ≤40ms；或明确记录"分页已足够"的测量结论 |
| W1-6 | sticky 表头去 blur（P2-8），仅浮层保留 | 见 P2-8 清单 | 滚动期间无 backdrop-filter 命中；视觉不塌（用不透明 surface 替代） |

**顺序约束**：W1-1 必须先于 W1-2；W1-3/W1-4 可并行。

### W2 · 统一 chrome 语言（2–3 天）

| # | 动作 | 验收 |
| --- | --- | --- |
| W2-1 | 新建共享 `Tabs` / `SegmentedControl` / `Toolbar`：三种外观（underline/pill/segment）、**同一键盘语义**（roving tabindex + Home/End/Arrow） | Files/Artifacts/Changed/Workbench/Settings 全部迁移；键盘行为只此一套 |
| W2-2 | Files 面板 chrome 112.5 → ≤75px：只留一行视图 tab + 一行可选工具条；Artifacts 范围改筛选菜单（带计数）；Unified/Split 进工具条 | 一个面板最多 2 条横条、一个 tablist；从顶部到内容 ≤75px |
| W2-3 | 面板标题 16px semibold；每屏一个 h1（子面板 h2）；统一 header 高 40 | 三栏 header 底边对齐；`grep '<h1'` 每屏 1 处 |
| W2-4 | surface/border/radius/shadow 收敛（codemod + lint 白名单）：bg alpha 12→4、border alpha 9→2、圆角 15→6、阴影 19→5、`border+shadow-minimal` 22→0；二级文本收敛为一个名字（另一个做 alias 并禁止新代码） | 每项计数达标；视觉走查无"白得不一样"的卡片 |
| W2-5 | 启动器分组：Primary 与 Workbench 分开，选中态用 `--action-selected` 而非只变文字色 | 选中态可键盘遍历、可辨 |

### W3 · 表面重组（4–5 天）— 决定"看起来是不是一个产品"

| # | 动作 | 验收 |
| --- | --- | --- |
| W3-1 | 工作台宽度封顶 ≤50%（或 ≤720px）+ 主聊天 `flex-grow` & min 600px + 空态自动折叠/记忆折叠 + <1280px 转 overlay 或单栏聚焦；保留手动拖宽与全宽展开 | 1920 与隐藏导航均 ≤50%；聊天 ≥600px；1280 无横向滚动；删除 `defaultLayout` |
| W3-2 | 看板颜色权威：**中性列 + 2px 顶部色条/圆点**，列头用 `text-*-text`，`onAccent` 按亮度计算，状态章仅在"与列预期不同"时出现，项目色只做 2–3px 识别条 | 四列列头 ≥4.5；看板内 0 处组件级 hex；列/状态不再矛盾 |
| W3-3 | 卡片解剖：≤3 行（标题 + 一行元数据 + 条件状态章 + 进度）；Add subtask 收进 `…`/hover；Done 列默认折叠；>50 张虚拟化；空列给 CTA | 单卡 ≤3 行；134 张首屏渲染 ≤50；空列有"拖到这里/新建任务" |
| W3-4 | 会话列表减色：一行一个状态通道、项目细条、匹配数恢复 10px、分组头计数常显 | 一行不再四色；匹配数 10px；分组头有计数 |
| W3-5 | Composer 拆分：权限入设置/菜单、状态入会话头、Info 去重、工具栏徽章 13/11 | 一个 toolbar 只放同一领域 |
| W3-6 | 四套 42px 工具条合并为 `ProjectToolbar` | 切换 Board/List/Calendar/Gantt 时控件不跳动 |
| W3-7 | 可访问性收口：卡片改 `<article>` + 拉伸主链接（不再 `role=button` 套按钮）；看板加 `KeyboardSensor` + "Move to…" 菜单；所有 icon-only 按钮走共享 `Tooltip` + `aria-label`；focus ring 收敛为一套；触控命中区 ≥44（`craft-row-actions` 已做，补齐 Artifact 行 22.5px 与工作台关闭 16px） | 键盘可完成"移动任务"；新增代码 0 个 `title`；tab stop 数量降一个量级 |

### W4 · 架构减债（持续，5–8 天，可与其他波次并行）

拆分顺序按"被依赖广度 × 改动风险"排序，每步独立可回滚：

| # | 目标 | 拆分方案 | 验收 |
| --- | --- | --- | --- |
| W4-1 | `AppShell.tsx` 4,239 行 | 先抽 37 个 effect 中的**副作用域**（窗口尺寸/键盘/拖拽/持久化）为 hooks；再抽三段面板 slot（左/中/右）为容器组件；AppShell 只保留布局与编排 | ≤800 行；37 effect → ≤8；无行为变化（现有 E2E 全绿） |
| W4-2 | `TurnCard.tsx` 3,475 行 | 按"头部 / 活动列表 / 正文 / 页脚动作 / 注释锚点"五个区块拆文件；`turn-utils` 的纯函数保持不变 | ≤900 行；纯渲染组件 + 容器分离 |
| W4-3 | `AiSettingsPage.tsx` **44 useState** | 收敛为 `useAiSettingsForm` reducer（分组：connections / models / defaults / advanced），页面只做布局 | useState ≤8；页面 ≤600 行 |
| W4-4 | `FreeFormInput.tsx` / `ChatDisplay.tsx` / `App.tsx` | 输入域抽 composer controller；ChatDisplay 抽搜索/高亮、滚动锚点、follow-up 三个 hooks；App.tsx 抽 bootstrap/平台适配 | 每个 ≤900 行；副作用集中在 hooks 并有测试 |
| W4-5 | `context/` 与 `contexts/` 合并为 `context/`；`NavigationContext.tsx` 1,332 行按"路由/历史/对账/URL"拆 | 目录语义单一；单文件 ≤400 行 |
| W4-6 | 债务清理常态：`as any` 51 → ≤20；TODO 191 → 分类归档（保留有 issue 号的）；16 处 react-hooks disable 逐条评估 | 数字只降不升，纳入 W5 门禁 |

### W5 · 门禁升级与文档对齐（1–2 天 + 常态）

| # | 动作 | 验收 |
| --- | --- | --- |
| W5-1 | `check:contrast-floor` 扩展到 JS/inline 色（看板列色、项目色、状态章按计算色检查），并设**余量策略**：新调色对须 ≥floor + 0.15；当前 `ink/dark text-secondary 4.53`、`default/dark focus ring 4.52` 上调或冻结并禁止下调 | 列头/项目名/状态章 ≥4.5；无 <floor+0.15 的新增 |
| W5-2 | `check:design-drift` 增加"计算字号/高度"计数（读计算样式而非字面量）；`audit:ui-merge` 并入 `lint` | 丢层/高度越界即失败 |
| W5-3 | ESLint 升级：renderer 把 `exhaustive-deps` 设 `error`（存量 16 处先清）；`lint` 加 `--max-warnings 0`（或对指定规则）；评估引入 typescript-eslint type-aware（先只开 `no-floating-promises`/`no-misused-promises` 于 hooks/atoms 目录）；`jsx-a11y` recommended 扩到全 renderer，用现有 ledger 冻结存量 | 警告数 = 0；新文件无 a11y 违规 |
| W5-4 | visual debt 只减不增，季度目标 -20%；`title` 新代码零新增 | 507 不增长 |
| W5-5 | 文档对齐：DESIGN.md 改写布局模型（实际像素/内容驱动）、唯一颜色权威、tab 层级、surface 角色、blur 预算；删除 `defaultLayout` 说明 | 文档与实现一致，无 dead prop 描述 |
| W5-6 | PR 门槛：primitive/布局改动必须附 3 尺寸 × 2 主题截图，W0 的 before/after 可并排 | 评审可验证 |

---

## 5. 量化目标（一张表验收）

| 指标 | 当前 | 目标 | 归属 |
| --- | ---: | ---: | --- |
| `cn()` 丢层点 | 82 | 0 | W0 |
| xs / compact 控件高 | 34 / 34 | 22 / 26 | W0 |
| default 按钮字号 | 15 | 13 | W0 |
| Badge / Metadata 字号 | 15 | 11 | W0 |
| Artifact 状态章字号 | 15 | 10 | W0 |
| Files 面板 chrome | 112.5px / 3 条 | ≤75px / 2 条 | W2 |
| 工作台宽度（1920 / 隐藏导航） | 50% / 68.1% | ≤50% / ≤50%（空态折叠） | W3 |
| 列头对比度 | 2.15–4.76 | 全部 ≥4.5 | W3 |
| `border`+`shadow` 叠用 | 22 | 0 | W2 |
| bg alpha / border alpha / 圆角 / 阴影种类 | 12 / 9 / 15 / 19 | 4 / 2 / 6 / 5 | W2 |
| 二级文本名字 | 2（537 / 670 处） | 1（+alias 禁新用） | W2 |
| append 一 turn（p50 / p95） | 133 / 300 ms | ≤60 / ≤150 ms | W1 |
| 虚拟化 | 无 | 分页够用则记录结论；否则 500+ turn 窗口化 | W1 |
| 主 chunk 是否含 json-view | 是 | 否 | W1 |
| `AppShell.tsx` | 4,239 行 / 37 effect | ≤800 行 / ≤8 effect | W4 |
| `AiSettingsPage.tsx` | 44 useState | ≤8 | W4 |
| visual debt | 507 | 不增长，季度 -20% | W5 |
| `title` on interactive | 91 | 新代码 0 | W5 |

---

## 6. 验证命令与人工验收

**每波必跑**

```bash
bun run typecheck:all
bun run lint                       # 含 scale/design-drift/contrast/visual-contracts/cycles/rpc
bun run check:scale-contract && bun run check:design-drift && bun run check:contrast-floor
bun run test:long-session-budget   # W1 起每次必跑
```

**W0 起新增**

```bash
bun run test:ui:primitives         # 计算字号/高度/文字色（新增）
bun run audit:ui-merge             # 丢层点必须为 0（新增）
bun run bundle:report              # W1 前后对比
```

**人工验收矩阵**：1280 / 1536 / 1920 × light / dark × Shell / Files(3 视图) / Board / Composer / Settings；W0 与 W3 每格至少一张截图，关键格 before/after 并排。
**本次未验证项**（沿用既有审计的限制并补充）：沙箱内无法启动 Vite dev server，我**没有**重新截取生产页面；W1 的性能数字来自既有 `long-session-budget` 产物（source-hashes 可校验），W0/W2/W3 的视觉验收必须在真实浏览器补做；`--ui-scale` 110%/125% 与暗色看板列头仍未实测。

---

## 7. 执行顺序与里程碑

| 里程碑 | 时间 | 内容 | 出口标准 |
| --- | --- | --- | --- |
| M0 | 第 1 天 | W0 全部 | 丢层 0；按钮字号/高度/颜色全对；计算样式 E2E 绿 |
| M1 | 第 2–4 天 | W1 全部（可与 W2 并行启动） | append p50 ≤60ms；主 chunk 去 json-view；sticky 无 blur |
| M2 | 第 4–6 天 | W2 全部 | Files chrome ≤75px；一套 tab 原语；标题 16px；surface 收敛 |
| M3 | 第 7–11 天 | W3 全部 | 工作台 ≤50%；看板中性列；卡片 ≤3 行；1280 无横向滚动；键盘可移任务 |
| M4 | 持续 | W4 按 W4-1→W4-6 顺序 | 巨档逐个下降，行为不变 |
| M5 | 第 11–12 天 + 常态 | W5 全部 | 计算样式/对比度扩展/ESLint 升级/文档对齐落地 |

**总估算**：W0+W1+W2+W3+W5 ≈ **10–14 人日**；W4 ≈ 5–8 人日（可分摊到多个迭代）。既有审计对 R0–R2 的 8–10 人日估算在我补充了 W1 性能与 W4 架构后需要上调，这一点我必须明确指出，而不是照抄。

---

## 8. 风险与取舍

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 修 merge 引发全局 reflow | 大量 15px → 11/12/13，行高/内边距变化 | W0 单独 PR；逐页截图；只调必要 padding |
| 性能修复引入缓存不一致 | 记忆化分组与流式文本的 `text_discard`/重试语义耦合 | 以 message id 为 key；用现有 `retry-lifecycle`/`text-message-id-sync` 测试兜底；budget 门禁把关 |
| manualChunks 造成重复打包 | shiki/mermaid 内部共享依赖被拆散 | 用 `bundle:report` 检查 chunk 图；只切"整包"依赖 |
| 工作台封顶影响 diff 审阅 | 宽 diff 需要空间 | 保留"展开为全宽"；封顶只作用伴随模式 |
| 看板去色后列身份变弱 | 中性列 + 色条可能不够醒目 | 2px 色条 + 列头圆点 + 状态章三层冗余，不只靠色 |
| 合并 tab 破坏键盘语义 | 现有工作台 roving tabindex 做得不错 | 新原语继承 Home/End/Arrow，加键盘 E2E |
| 债务 burn-down 拖慢交付 | 507 条不可能一次清 | 先"只减不增"，按文件分批，新代码零新增 |
| ESLint 收紧产生噪声 | `--max-warnings 0` + a11y 全量会暴露存量 | 先用 ledger 冻结存量，再逐目录清零 |

---

## 8.5 实施状态（2026-10-21 起，随波次更新）

| 波次 | 状态 | 交付物 | 验证 |
| --- | --- | --- | --- |
| W0 原语正确性 | **完成** `c893dca7e` | 共享 `extendTailwindMerge`（9 个 tier，两处 `cn()` 同一实例）、`roles.css` 全档映射、`audit:ui-merge`、`test:ui:primitives` | 丢层 82→**0**（752 文件）；按钮 13/11/22、12/26、11/30、13/38 实测全对；Badge/Metadata 11；填充小按钮对比度 15.69/15.43；`lint` 全绿 |
| W1 渲染与包体 | **完成** `perf(chat)` 提交 | `storedToMessage` 恒等缓存、`reuseStableTurns`、`SessionViewer` 记忆化行、`MemoizedMarkdown`、json-view 懒加载、sticky 去 blur、bundle 棘轮 | append p50 **83→16.7ms**、p95 **200→33.4ms**（门槛 60/120 冻结）；初始 JS 0.80MB raw；`test:long-session-budget` 5 项全过 |
| W2 chrome 语言 | **部分** | 面板标题 `text-body`→`text-title`(16px)，`PanelHeader headingLevel`，navigator/workbench/artifact/侧栏列表改 h2（每屏一个 h1） | typecheck + lint；三横条合并与 surface 收敛未做 |
| W3 表面重组 | **部分** | 工作台 `max-width:50%` + 主表面 `min(600px,55%)` + 删除 dead `defaultLayout`，DESIGN.md 布局段改写 | typecheck + lint；看板中性列、卡片解剖、会话列表减色、Composer 拆分、ProjectToolbar 未做 |
| W4 架构减债 | 未开始 | — | 巨档拆分（AppShell 4239 行等） |
| W5 门禁升级 | **部分** | `bundle:report` 棘轮 4.8MB→1.2MB、`audit:ui-merge` 进 lint、计算样式契约进 CI | 对比度扩展、ESLint type-aware、PR 截图门槛未做 |

下一步建议顺序：W2-1/2（共享 Tabs + Files 面板 ≤75px）→ W3-2（看板中性列）→ W3-3/4 → W4-3（AiSettingsPage 44 useState 收敛，风险最低的巨档首刀）→ W5-1/3。

---

## 9. 明确不做的事

- **不重做视觉方向**：白纸墨字、紫罗兰 accent、中性 user bubble、6px 基础圆角、840px 阅读宽度——这些是产品身份，W0–W3 只修复执行，不改身份。
- **不一刀切"统一字号"**：层级需要 10/11/12/13/16 五档，不是全部 13。
- **不为看板"有颜色"而保留四套色相**：中性列 + 一条色条 + 状态章就够。
- **不在 W0 之前动布局**：会继承错误。
- **不在本波次引入新的 token 家族**：现在的问题是词汇太多，不是太少。
- **不做全量虚拟化重写**：先修 append 记忆化，用预算数字决定是否需要窗口化。

---

## 10. 证据索引

**本次现场复测（可直接重跑）**

```bash
bun -e "import {twMerge} from 'tailwind-merge'; console.log(twMerge('text-meta text-foreground'))"   # → text-foreground
bun run scripts/measure-design-drift.ts        # 23 / 91 / 2 / 0 / 0 / 0，与基线一致
bun run scripts/check-scale-contract.ts        # 7 字号 / 5 圆角 / 6 控件高，四方一致
bun run scripts/check-contrast-floor.ts        # 全过；最紧 4.52 / 4.53
(Get-Content scripts/visual-debt-ledger.json | ConvertFrom-Json).entries.Count   # 507
```

**既有证据（`docs/verification/results/ui-system-audit-2026-10-21/`）**：`FRONTEND-SYSTEM-AUDIT.md`、`evidence.json`、`control-measurements.json`、`files-measurements.json`、`scan.ts`、`detector-*.json`、`*.png`；性能基准 `docs/verification/results/long-session-budget-2026-10-20/`（含 README、`long-session-budget.json`、`source-hashes.json`）。

**关键文件定位**

| 主题 | 文件:行 |
| --- | --- |
| 裸 twMerge | `packages/ui/src/lib/utils.ts:11`、`apps/electron/src/renderer/lib/utils.ts:4-6` |
| Button 字号/变体 | `apps/electron/src/renderer/components/ui/button.tsx:7,24-28,54` |
| min-height 映射 | `packages/ui/src/styles/roles.css:79-82` |
| 工作台固定宽 | `apps/electron/src/renderer/components/app-shell/SurfaceSlot.tsx:86-92`、`atoms/workbench.ts:21-24` |
| dead defaultLayout | `apps/electron/src/renderer/App.tsx:2342`、`AppShell.tsx:199,534` |
| 看板颜色 | `kanban-colors.ts:11-16`、`useKanbanColumnColors.ts:31-36`、`KanbanColumn.tsx:114-118` |
| 三/四条横条 | `ContextWorkbenchTabs.tsx:93`、`FilesPanel.tsx:90-103`、`ArtifactsPanel.tsx:195-214`、`ChangedFilesView.tsx:216-233` |
| 长会话分页 | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:545` |
| json-view 静态入包 | `packages/ui/src/components/markdown/Markdown.tsx:12`、`MarkdownJsonBlock.tsx:17-19` |
| 无 manualChunks | `apps/electron/vite.config.ts:64-80` |
| ESLint 盲区 | `eslint.config.mjs:12`、`apps/electron/eslint.config.mjs`（react-hooks / jsx-a11y 段） |
| 移动端 zoom | `apps/webui/src/index.css:47-51` |
| 巨档 | `AppShell.tsx`、`TurnCard.tsx`、`FreeFormInput.tsx`、`ChatDisplay.tsx`、`App.tsx`、`AiSettingsPage.tsx`、`contexts/NavigationContext.tsx` |

---

## 11. 追加决策（2026-10-21）：默认主题品牌色改为 `#7851A9`

用户要求把默认主题的主题色改为 `#7851A9`，包含 `accent` 与 `ring`。已按主题引擎的单一来源落地，不是手工改 CSS。

| 模式 | `accent` / `ring` | 关键对比度 | 说明 |
| --- | --- | --- | --- |
| Light（默认） | `#7851A9`（品牌值，原样） | 白字 5.92:1；聚焦环对画布 5.92:1、对 sunken 5.57:1；`accent-text` 10.00:1 | 全部远高于 WCAG 底线（文字 4.5 / 图形 3） |
| Dark | `oklch(0.660 0.160 302.3)`（`#A577E2`，同色相提亮） | 黑字 6.33:1；聚焦环对画布 5.30:1、对 muted 4.70:1 | 字面值在深色画布上实测聚焦环 **2.97:1**、黑字 **3.55:1**，均不过线，因此不能原样使用 |

**为什么深色不能照抄 `#7851A9`**：`--on-accent` 在深色模式是黑色，`bg-accent` + `text-on-accent` 的实心控件会变成 3.55:1；聚焦环对石墨画布只有 2.97:1，低于 1.4.11 的 3:1。这是 `check:contrast-floor` 会直接拦下的组合，不是偏好问题。深色值保持同一色相（302.3°）与接近的彩度，只提高明度，视觉上仍是同一个品牌紫。

**影响面（全部已同步）**：`packages/shared/src/config/theme.ts`（唯一来源）→ `bun run theme:generate` 重新生成 `packages/ui/src/styles/theme-tokens.css`、`apps/electron/resources/themes/default.json`、契约文档；`DESIGN.md`（frontmatter + 角色表 + 新规则"一个色相两个模式值"）；`apps/electron/resources/docs/themes.md`；`release-notes/next.md`；`.impeccable/design.json`（canonical + 色调阶梯）；`docs/design/default-redesign/default-preview.json` 与 README 的追加说明；3 个验收断言（`theme.test.ts`、`default-theme-preview-workflow.ts`、`packaged-refinement-workflow.ts`）。顺带对齐了 OAuth 回调页的独立品牌紫（`#8b5fb3` → `#7851A9`，深色 `#a882c9` → `#A577E2`）。

**门禁结果**：`check:themes` ok；`check:contrast-floor` 84 对全过（default dark 聚焦环最紧值从 4.00 提升到 4.70）；`check:design-drift` 6 项不超基线；`check:scale-contract` ok；`test:shared:config` 51 pass / 0 fail；`typecheck:shared` ok。impeccable detector 对品牌色的 advisory 已清零，仅剩回调页 hover 派生色 1 条（该页本就使用独立静态调色板）。

**顺带修复**：`scripts/verification/theme-architecture-gate-mutations.ts` 的 FA05 变异原本指向 `apps/electron/src/renderer/index.css`，而该文件早已不含 `--accent` 字面量（调色板迁到生成文件后就成了死引用）；已改为指向 `packages/ui/src/styles/theme-tokens.css`。

**未验证**：原生窗口/打包产物与 `--ui-scale` 110/125% 下的实际渲染未截图；W0 修完丢层后，所有以 `bg-accent` + `text-on-accent` 为底的小按钮需要按新色复核一次（当前 light 5.92 / dark 6.33 都有余量，预期无需再调）。

---

**最终判断**：Phaneris 的前端不是"审美需要重做"，而是**三处执行层失守 + 一处性能欠账 + 六个巨档**。W0 用半天就能消掉截图中最刺眼的"字大了/字没了/按钮高了"；W1 把最坏用例拉回预算；W2/W3 让三栏与看板回到同一套语言；W4 让后续改动不再撞进 4000 行文件；W5 让门禁从"查字面量"升级到"查渲染结果"，否则一年后同一份审计会再写一遍。
