# Phaneris 前端系统性审查

> 日期：2026-10-21 · 范围：Electron Renderer、WebUI（复用同一 App）、Viewer、`packages/ui` 共享原语
> Method: dual-agent（A：独立设计评审 · B：确定性证据核验），父代理只做综合。
> 性质：**只读审查**。本次没有改动任何界面代码，只新增了审计脚本、证据和本报告。
> 结论先行：当前的问题不是“审美退步”，而是**设计合同在合并层、控件层、组合层三处同时失守**，再叠加门禁只检查字面量、不检查渲染结果。截图里看到的错位、过大/过小的字、发虚的层级，都是这三处失守的下游症状。

---

## 1. 审查方法与证据

| 维度 | 做法 | 证据 |
| --- | --- | --- |
| 设计规范 | 逐条对照 `DESIGN.md`、`.impeccable/design.json`、`packages/shared/src/colors/defaults.ts` | 规范条款与实现逐项比对 |
| 静态扫描 | 新增 `scan.ts`：用仓库实际安装的 `tailwind-merge` 复现 `cn()`，扫描全部生产 TS/TSX 的类名、控件高度、圆角、阴影、原生 `title`、tab 语义 | `evidence.json`、`scan.ts` 输出（`%TEMP%/ui-audit/scan.json`） |
| 计算样式 | 复用上一轮 Playwright 采集的 `control-measurements.json`、`files-measurements.json`（root 15px，uiScale 1） | 按钮/标签页的真实 `font-size`、`height`、`min-height` |
| 视觉证据 | 三张 1920×1048 生产截图 + 上一轮 playground 截图；用像素扫描确认三栏边界与比例 | 面板宽度 298 / 606 / 961px |
| 历史定位 | `git blame` + `git show 23850cade`、`4d3f014e7`，确认问题引入时间与变更面 | 两次 UI 大迁移，535 / 460 个文件 |
| 独立评审 | Assessment A（设计评审）与 Assessment B（技术核验）两个隔离子代理，父代理只做综合 | A 的 23/40 启发式评分；B 的核验结论 |

**限制说明**：本沙箱内 Vite dev server 因原生绑定与子进程权限（`EPERM`）无法启动，因此这次没有重新截取全站页面；计算样式来自仓库内上一轮真实浏览器采集的产物，静态与代码证据来自当前工作树。结论不依赖“我觉得”，每一条都能落到文件、行号或数值。未验证项：暗色看板列头、hover/focus 全链路、`--ui-scale` 110/125% 的实际渲染。

**五条核心论断的核验结果**

| 论断 | 核验 | 修正 |
| --- | --- | --- |
| `cn()` 会丢 tier/颜色 | **确认，且最坏情况是颜色被丢** | 填充型小按钮丢的是 `text-background`，表现为文字不可见 |
| min-height 只映射 sm/lg | **部分成立**：xs/compact 被钉在 34px；default=34 本来正确；sm/lg 正确 | **当前生产 0 个 xs/compact 调用**，属于契约级缺陷，不是截图的直接原因 |
| Files 三条 37.5px 横条 | **确认** | 总高 112.5px；三套对齐/四种字号 |
| 看板原始 hex + 白字不达标 | **确认** | 列头 2.15–4.76；计数章仅 1.21–1.38 |
| 工作台吃剩余宽度 | **确认** | 1920 下聊天 31.25%、工作台 50.05%；隐藏导航时工作台可达 68.1% |

---

## 2. 结论与评分

### 2.1 技术审计（5 维）

| # | 维度 | 分数 | 关键发现 |
| --- | --- | --- | --- |
| 1 | 可访问性 | 2/4 | 看板列标题白字对比度 2.15–4.47:1；卡片是 `role=button` 套真实按钮；看板只能指针拖拽 |
| 2 | 性能 | 2/4 | 134 张 Done 卡片全量渲染；多处 width/padding 布局动画；213 处 `shadow-minimal` |
| 3 | 响应式 | 2/4 | 768–1512px 且右侧工作台打开时横向溢出；WebUI 用 `zoom: 1.2` 兜底 |
| 4 | 主题化 | 2/4 | token 体系完整，但项目色/看板色是原始 Tailwind hex，且被当作文本色使用 |
| 5 | 实现完整性 | 1/4 | 82 个 `cn()` 丢层点、3 个 cva 定义、控件高度两套词汇、507 条冻结债务 |
| **合计** |  | **9/20** | **Poor（需要系统性整改，不是打磨）** |

### 2.2 设计健康度（Nielsen 10 项，独立评审）

| # | 启发式 | 分数 | 关键问题 |
| --- | --- | --- | --- |
| 1 | 系统状态可见性 | 3 | 处理中/差异统计做得不错；主表面选中态只有一档色差 |
| 2 | 贴合真实世界 | 2 | “Deliverables / Drafts / Opened files” 与 “Artifacts” 并存；“Todo / Execute” 没有名词 |
| 3 | 用户控制与自由 | 3 | 工作台可关/可恢复；状态与列移动没有撤销 |
| 4 | 一致性与标准 | 1 | 一个面板三种 tab 语法；看板另起一套色板；面板标题 13px |
| 5 | 错误预防 | 2 | 输入框旁一键改权限模式；列移动只能拖、无撤销 |
| 6 | 识别而非回忆 | 2 | 9 个无文字 22px 启动器 + 12 图标侧栏 |
| 7 | 灵活与高效 | 3 | 快捷键、roving tabindex、筛选都有；没有键盘拖拽/列折叠 |
| 8 | 美学与极简 | 2 | 聊天区安静，看板很吵；空文件面板上方 112.5px 横条 |
| 9 | 错误恢复 | 3 | StateSurface / ErrorBanner / toast / retry 成体系 |
| 10 | 帮助与文档 | 2 | 有文档菜单；禁用控件的原因被截断成 160px 提示 |
| **合计** |  | **23/40** | **Acceptable（可用，但视觉系统明显不稳）** |

### 2.3 认知负荷

独立评审的 8 项清单中 **7 项失败**：单一焦点、分组、冗余、词汇、可供性、状态可区分性、密度/渐进披露。唯一通过的是“主操作明确”（发送与 New Task）。这不是“信息多”，而是**同一层级用了不同语法、不同层级用了同一语法**。

### 2.4 设计特异性判断

外壳与聊天区是**有作者性**的：6px 浮动纸面缝隙、内外圆角、阅读宽度、会话→轮次→活动→产物的对象模型，都能看出这是 Phaneris。**看板是断裂点**：饱和的 slate/indigo/amber/emerald 列头、整列 tint、卡片+状态章+页脚+圆点，是一块 Trello/Linear 风格的板子套了 Phaneris 的标签页。外壳和看板既不共享色彩语法，也不共享字号体系。

### 2.5 发现数量

共 **2 个 P0、8 个 P1、8 个 P2、4 个 P3**。其中 P0-2 是契约级缺陷（当前生产 0 个 xs/compact 调用），但它是用户直接指出的、且会阻塞任何新紧凑控件，因此仍列为 P0 并放进 R0。

### 2.6 决策记录（2026-10-21）

| 决策 | 选择 | 对方案的影响 |
| --- | --- | --- |
| 整改范围 | **R0–R2**（约 8–10 人日） | R3 的**最小集**（计算样式契约 + 对比度扩展）并入 R0；完整债务 burn-down 放到 R2 之后 |
| 看板颜色 | **中性列 + 2px 色条 + 状态章** | 去掉整列 tint 与实心大色块；列身份靠色条/圆点，状态靠 `*-text` 章；按亮度选黑/白字 |
| 工作台 | **封顶 50% + 空态自动折叠** | 主聊天保底 600px；1920 下工作台 ≤50%；隐藏导航时也不超过 50%；保留手动拖宽与全宽展开 |

这三项已经收敛进下面的 R0–R2 任务；本轮仍然**不改界面**，等确认后再从 R0 开始。

---

## 3. 根因分析

### 根因 1：token 层是对的，**合并层是瞎的**

`cn()` 直接使用未配置的 `tailwind-merge`：

```ts
// apps/electron/src/renderer/lib/utils.ts:4-6
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

`text-meta / text-label / text-body …` 是项目自定义的**字号**类，但 tailwind-merge 不认识它们，把它们归入 **text-color** 组。于是：

```text
cn("text-meta text-foreground")        → "text-foreground"          // 字号被吃掉
cn("text-body text-background")        → "text-background"          // 字号被吃掉
cn("text-meta text-info-text")         → "text-info-text"           // 字号被吃掉
cn("text-label text-muted-foreground") → "text-muted-foreground"    // 字号被吃掉
```

这不是一两个组件，而是所有走 `cva` + `cn` 的渲染层原语。生产代码中静态扫描到 **82 个 `cn()` 丢层点**（renderer 69、`packages/ui` 13；含 playground 的全量扫描为 84），另有 **3 个 cva 定义、12 个变体输出**会丢层。`Button`、`Badge`、`MetadataBadge`、`TaskTile` 标题、`SessionItem` 匹配数、工作台 tab、Artifacts 筛选、Unified/Split、New Task、composer 工具栏徽章，全部中招。

### 根因 2：控件高度有**两套词汇**，且 min-height 反杀 height

`Button` 写的是 `data-control-size={size ?? "default"}`，取值是 `xs / compact / sm / lg / icon / default`；CSS 只映射了 `sm` 和 `lg`：

```css
/* packages/ui/src/styles/roles.css:79-82 */
.craft-control[data-slot="button"] { min-height: calc(var(--craft-control-height, var(--control-height-lg)) * var(--ui-scale)); }
.craft-control[data-control-size="sm"] { --craft-control-height: var(--control-height-md); }
.craft-control[data-control-size="lg"] { --craft-control-height: var(--control-height-xl); }
```

`xs`、`compact`、`default`、`icon` 都落回 **34px**。`h-control-xs` 的 22px、`h-control-sm` 的 26px 被 `min-height: 34px` 覆盖。实测：xs = 34px、compact = 34px、sm = 30px、default = 34px、lg = 38px。更糟的是，这条“全局按钮规则”只作用于 `data-slot="button"`，也就是只有 `<Button>`；手写的 `craft-control` 按钮（列头、Board 的 New Task、Changed 的分段控件）完全不受它约束，形成“34px 的 Button”和“22–30px 的自定义按钮”两个家族。

### 根因 3：组合层是**加法**，没有共享的 chrome 原语

每个功能到来时都自带一条横条、一个筛选行、一个工具条：

- 工作台 tab 条（`ContextWorkbenchTabs`，h-10）
- Files 视图 tab（`FilesPanel`，h-10，下划线）
- Artifacts 筛选（`ArtifactsPanel`，h-10，胶囊）
- Changed 工具条（`ChangedFilesView`，h-10，分段控件）

同一个右侧面板里出现 **3 条 37.5px 横条**、**4 种选择语法**。每个组件单独看都“合理”，叠在一起就是 112.5px 的 chrome 压在空白内容上。同类问题还有 Board/List/Calendar/Gantt 各自实现 42px 工具条，以及设置页自带的 `craft-text-*` 字号体系。

### 根因 4：外壳宽度是**固定宽度 + 剩余空间**，不是内容驱动

主聊天区在伴随模式下固定 600px；工作台拿 `flex-grow: 1` 的剩余空间。1920px 窗口、导航栏可见时，实测三栏为 **298 / 606 / 961px（15.5% / 31.25% / 50.05%）**；隐藏导航栏时工作台可达 **68.1%**。也就是说，一个没有内容的 Artifacts 面板可以占掉一半屏幕，而聊天被压在 600px（低于 840px 阅读宽度）。`DESIGN.md` 写的 `[20, 32, 48]` 布局从未被使用：`App.tsx:2342` 传了 `defaultLayout={[20, 32, 48]}`，`AppShell.tsx:199/534` 接收后没有任何引用。这是一个 dead prop + 过期文档。

### 根因 5：颜色承担了太多含义，且**对比度没有进入门禁**

- 看板列色是原始 Tailwind hex：`#64748b / #6366f1 / #f59e0b / #10b981`，并固定 `onAccent: '#ffffff'`。
- 状态默认色是另一套：`in-progress = success（绿）`、`needs-review = info（琥珀）`、`done = accent（紫）`。
- 项目色板又是第三套，且被当作 11px 文本色使用（`SessionItem` hover 项目名）。

结果：**列色、状态色、项目色三套语义互相打架**。截图里 DONE 列是绿色，卡片里的 “Done” 章却是紫色；“In Progress” 列是琥珀色，卡片里的 “Needs Review” 也是琥珀色。用户无法用颜色建立“状态↔列”的映射。而 `check:contrast-floor` 只检查主题调色板对，不检查这些 JS/内联颜色，所以门禁全绿。

### 根因 6：治理在**冻结债务**，而不是阻止新债

- `scripts/visual-debt-ledger.json`：**507 条**记录、177 个文件，其中 **446 条**是 `theme-contracts/roles`。
- `scripts/design-drift-baseline.json`：冻结了 **91 个** interactive title、23 处半透明文本、2 处被取消的 focus ring。
- 门禁只检查字面量（`text-[13px]`、`raw palette class`、`strokeWidth` 字面量），不检查计算后的字号、颜色、层级，也不检查“3 条 tab 叠在一起”。

所以每次大迁移都能“全绿通过”，然后靠人眼发现界面变糙。**这是治理模型的问题，不是某个组件的问题。**

---

## 4. 发现清单

### P0（必须先修，否则后续改动都会继续继承错误）

#### P0-1 字号层级在 `cn()` 中被吞掉，填充型小按钮文字直接消失

**证据**

- `apps/electron/src/renderer/lib/utils.ts:4-6`、`packages/ui/src/lib/utils.ts:12`：裸 `twMerge`。
- `button.tsx:7` 的 base 含 `text-body`；`button.tsx:24-26` 的 size 含 `text-meta` / `text-label`；`button.tsx:54` 把 cva 输出交给 `cn()`。
- `badge.tsx:6`、`badge.tsx:33`；`metadata-badge.tsx:56/60`；`TaskTile.tsx:215-218`；`SessionItem.tsx:317-320`；`ContextWorkbenchTabs.tsx:107-110`；`ArtifactsPanel.tsx:203-204`；`ChangedFilesView.tsx:165-169`；`NewTaskComposer.tsx:46-47`；`FreeFormInputContextBadge.tsx:77`。
- 计算样式：default 按钮 **15px**（应为 13），Badge/MetadataBadge/Artifact 章/Workbench tab/Artifacts 筛选 **15px**（应为 10/11），Files 视图 tab **12px**（因为它不是 `cn` 字符串）。
- 视觉：`production-controls-light.png` 中 XS/Compact/SM 三个按钮**文字不可见**；`files-artifacts-light.png` 中 “Ready / Draft / Accepted” 比文件名更抢眼。

**类型存活矩阵**

| 元素 | 合同字号 | 实际字号 | 丢失项 |
| --- | ---: | ---: | --- |
| Button default | 13 | **15** | `text-body` |
| Button xs/compact/sm | 11/12/11 | 11/12/11 | `text-background`（文字色） |
| Badge | 11 | **15** | `text-meta` |
| MetadataBadge（Execute/Todo） | 11 | **15** | `text-meta` |
| Artifact 状态章 | 10 | **15** | `text-micro` |
| Artifacts 筛选 | 11 | **15** | `text-meta` |
| Workbench tab（Files） | 11 | **15** | `text-meta` |
| Task 标题 | 13 | **15** | `text-body` |
| Session 匹配数 | 10 | **15** | `text-micro` |
| Composer 工具栏徽章 | 13 | **15** | `text-body` |
| Files 视图 tab | 12 | 12 | 未走 `cn`，反而正确 |

**影响**：这是“界面显得粗糙”的第一主因。字号层级不是整体放大，而是**随机**：有的 15、有的 12、有的 11；下属元素（筛选、状态章）反而比上级（视图 tab）更大。对 `Button size="sm"` 的填充变体，`text-background` 被 `text-meta` 覆盖，深色背景上的文字继承前景色，浅色主题下直接不可读。生产代码中有 **约 35 个填充型小按钮**（default 31 + destructive 等；含 `ArtifactWorkbench.tsx:206/215` 的 Submit/Accept），不是边缘案例。

**修复方向**

1. 在 `packages/ui` 建一个共享的 `twMerge` 配置，把 `micro/meta/label/body/reading/title/display`（以及 `glyph-watermark/avatar`）注册进 `font-size` 组；renderer 的 `lib/utils.ts` 改为 re-export。已用实际安装版本验证：

```ts
const tw = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['micro','meta','label','body','reading','title','display'] }] } },
})
tw('text-meta text-foreground') // → 'text-meta text-foreground'（两者都保留）
```

2. 修复后重新核对所有 cva 变体的字号/颜色，特别是 `Button` 的小尺寸填充变体；不要只改 `button.tsx` 一处。
3. 加一个**计算样式**的 E2E 契约（见 R0），断言 Button/Badge/MetadataBadge/Tab 的真实字号与文字色，而不是只断言类名。

**验收**：`scan.ts` 的 lost-tier 计数 82 → 0；Button default 13px、xs 11、compact 12、sm 11；Badge/Metadata 11；Artifact 章 10；sm 填充按钮文字对比度 ≥4.5。

---

#### P0-2（契约级）`xs` / `compact` 永远到不了 22 / 26px：min-height 覆盖了变体高度

**证据**

- `roles.css:79-82` 只映射 `sm`/`lg`，`xs`/`compact` 落回 34px。
- `button.tsx:24-26` 声明 `h-control-xs` / `h-control-sm`。
- 计算样式：xs height **34**、min-height **34**；compact height **34**、min-height **34**；sm 30/30；default 34/34；lg 38/38。
- **生产调用点：xs = 0，compact = 0；default / sm / lg 的高度是正确的。** 因此这一条不是当前截图“变糙”的直接原因，而是**契约级缺陷**：两个 tier 名义上存在，实际不可用；任何人下次使用 `size="xs"` 或 `size="compact"` 都会踩到 34px。
- 用户已经直接指出这一条；它证明“控件高度契约”没有被计算测试覆盖。

**影响**：xs/compact 的 22/26px 是死档位；未来一用就会得到“34px 大胶囊 + 11/12px 小字”。由于只有 `<Button>` 有 `data-slot="button"`，手写按钮不受影响，最终形成两种按钮高度体系。它和 P0-1 一起说明：**合同写在了 CSS 里，但没有写在渲染结果里**。

**修复方向**

1. 为所有 `data-control-size` 取值补齐映射（`xs → --control-height-xs`、`compact → --control-height-sm`、`default/icon → --control-height-lg`），或给每个 size 直接设置 `--craft-control-height`。
2. 统一 size 词汇：`xs/compact/sm/default/lg` 与 `2xs/xs/sm/md/lg/xl` 不要混用；`sm` 当前映射到 `md` 档，语义上是错位的，建议在 Button 变体里写清“产品名 → 合同档”。
3. 增加计算高度契约：所有变体的 `height` 与 `min-height` 必须相等，且等于合同档；触摸设备 44px 规则单独覆盖。

**验收**：xs 22、compact 26、sm 30、default 34、lg 38；`height === min-height`；无文字裁切；`@media (pointer: coarse)` 下仍为 44。

---

### P1（影响全局观感与可用性，发布前应修）

#### P1-1 右侧 Files 工作台：三层 37.5px 横条，四种选择语法

**证据**

| 层 | 组件 | 高度 | 语法 |
| --- | --- | ---: | --- |
| 工作台 tab | `ContextWorkbenchTabs.tsx:93` | 37.5 | 填充 pill + 关闭 X，`role=tab` |
| Files 视图 | `FilesPanel.tsx:90-103` | 37.5 | 下划线文本 tab，`role=tab` |
| Artifacts 筛选 | `ArtifactsPanel.tsx:195-214` | 37.5 | 胶囊，`aria-pressed` |
| Changed 工具条 | `ChangedFilesView.tsx:216-233` | 37.5 | 分段控件 + 图标按钮，`aria-pressed` |

- 实测：Files 视图 tab 12px/37.5；Artifacts 筛选 15px/22.5；Unified/Split 15px/26.25。
- 面板总 chrome = 3 × 37.5 = **112.5px**；在 720px 高的面板里占 15.6%，在 600px 高里占 18.8%。
- 截图红框正是前两层；用户标注的 “Deliverables / All / Opened files” 是第三层。

**影响**：内容被推低；同一视觉语法承担“切内容源”“筛状态”“切 diff 显示方式”三种不同层级的决策；下属筛选比上级视图更大，层级倒置。用户需要先学会四套控件，才能完成“看一个文件”的动作。

**修复方向**：一个面板只保留**一行**视图 tab + 一行（可选的）工具条。Artifacts 的三种范围改成筛选菜单/下拉（带计数），不占整行；Unified/Split 作为工具条右侧的分段控件；只有一个工作台 item 时，隐藏工作台 tab 条，把标题、关闭、展开并入面板头。目标：112.5 → ≤75px。

**验收**：右侧面板从顶部到内容 ≤2 条横条；视图 tab 与筛选的字号/高度有明确上下级；键盘 tab 顺序不再经过两层 tablist。

---

#### P1-2 空的工作台占掉 50%，聊天被固定 600px 挤在 31%

**证据**

- `SurfaceSlot.tsx:86-92`：workbench companion 固定 `flexBasis: 600px`；workbench 自己 `flexGrow: 1`，拿剩余全部空间。
- `atoms/workbench.ts:21-24`：`DEFAULT_COMPANION_PRIMARY_WIDTH = 600`、`MAX = 600`、`MIN_WORKBENCH_WIDTH = 360`。
- 截图实测：298 / 606 / 961px = **15.5% / 31.25% / 50.05%**；隐藏导航栏时工作台可达 **68.1%**。
- `DESIGN.md:287-290` 声称 `[20, 32, 48]`，但 `App.tsx:2342` 传入的 `defaultLayout` 在 `AppShell` 中从未被使用（仅 199/534 两处声明/解构）。

**影响**：在 1920px 屏幕上，最有价值的聊天只有 606px，而空的 Artifacts 面板有 961px；聊天低于 840px 阅读宽度，长路径/代码/表格更早截断。窗口在 1280–1512px 且工作台打开时会横向溢出（600 + 300 + 360 + 边距 > 宽度），用户要横向滚动才能看全三栏。

**修复方向**：工作台宽度封顶（如 ≤50% 或 ≤720px），主聊天设置 `flex-grow` 和最小 600px；空工作台自动折叠/记忆折叠；在 1280px 以下把工作台转为 overlay 或单栏聚焦；删除 `defaultLayout` 并更新 DESIGN。

**验收**：1920px 下工作台 ≤50%、聊天 ≥600px；1280px 下无横向滚动；空工作台默认不占宽。

---

#### P1-3 看板颜色模型：四套色相、状态色互相打架、对比度不达标

**证据**

- `kanban-colors.ts:11-16`：`#64748b / #6366f1 / #f59e0b / #10b981` 原始 Tailwind 500 色。
- `useKanbanColumnColors.ts:31-36`：所有列 `onAccent: '#ffffff'`。
- `KanbanColumn.tsx:114-118`：整列 `backgroundColor: color.tint`（6%）。
- `colors/defaults.ts:21-28`：`in-progress = success（绿）`、`needs-review = info（琥珀）`、`done = accent（紫）`。
- 对比度：Backlog 4.76（过）、Todo 4.47（不过）、In Progress **2.15**、Done **2.54**（远低于 4.5）。
- 计数章：25% 白叠在列色上，白字仅 **1.38 / 1.38 / 1.21 / 1.26**，连 3:1 都不到；用户自定义列色时 `onAccent` 仍固定白，对比度没有上界。
- 项目色当 11px 文本：8 个里 **7 个不过**（2.15–4.47；只有 slate 4.76）。

**列色 vs 状态色的三方冲突**

| 列 | 列色 | 该列默认状态色 | 结果 |
| --- | --- | --- | --- |
| In Progress | 琥珀 `#f59e0b` | `success` 绿 | 列与章不同色 |
| Needs Review（停在 In Progress） | 琥珀列 | `info` 琥珀 | 章与列同色，无法区分 |
| Done | 翠绿 `#10b981` | `accent` 紫 | 列绿、章紫，截图直接可见 |
| To Do | 靛蓝 `#6366f1` | `foreground/50` 灰 | 列与章不同色 |

**影响**：颜色不能帮助用户建立“状态↔列”的映射，反而制造矛盾；白字在琥珀/翠绿上不可读（WCAG AA 失败）；项目色作为 hover 文本色时 7/8 不可读；整列 tint 让看板呈现四块不同颜色的“补丁”，与 DESIGN 的“唯一饱和色是 accent”直接冲突。

**修复方向**：建立**唯一颜色权威**。列身份用中性 surface + 2px 顶部色条/圆点；列头文字用 `text-*-text` 或深色 ink；`onAccent` 按亮度计算，不要固定白；状态章只在“与列预期不同”时显示（例如 Needs Review 停在 In Progress 时显示）；项目色只用于 2–3px 识别条，不作为 11px 文本色。所有颜色从主题 role 派生，组件不写 hex。

**验收**：四列列头文字对比度 ≥4.5；看板内不出现组件级 hex；同一任务的列色与状态色不再互相矛盾；项目名 hover 文本对比度 ≥4.5。

---

#### P1-4 表面语言爆炸：12 种背景透明度、9 种边框透明度、15 种圆角、19 种阴影

**证据（生产代码，排除 playground）**

| 维度 | 实测 | 典型值 |
| --- | ---: | --- |
| `bg-foreground/[0.0x]` | **12 种** | 0.012 / 0.015 / 0.018 / 0.02 / 0.025 / 0.03 / 0.035 / 0.04 / 0.05 / 0.06 / 0.07 |
| `border-border/xx` | **9 种** | 30 / 35 / 40 / 45 / 50 / 55 / 60 / 70 / 80 |
| 圆角类 | **15 种** | `rounded-lg` 209、`rounded-md` 173、`rounded-full` 136、`rounded-xl` 56、`rounded-2xl` 9 … |
| 阴影类 | **19 种** | `shadow-minimal` 213、`shadow-sm` 9、`shadow-md` 3、`shadow-xs` 3 … |
| `border` + `shadow-minimal` 同用 | **22 处** | `shadow-minimal` 自带 1px ring，再叠 border = 双层边 |
| 二级文本两套名字 | **537 处（177 文件） vs 670 处（169 文件）** | `text-muted-foreground` vs `text-text-secondary` |

**影响**：每一处都“只差 1–2%”，叠在一起就是“说不出哪里不对，但就是不精致”。卡片、面板、行、输入框的白各不相同；边框有的 50% 有的 60%；圆角在 8/12/16 之间跳；阴影到处都是。DESIGN 的 “micro-contrast over borders” 变成了“micro-noise”。

**修复方向**：把 surface 收敛为 4 个 role（canvas / sunken / raised / floating），border 收敛为 2 档（hairline / strong），圆角收敛为 4 档，阴影只保留 4 步；禁止 `border` + `shadow-minimal` 叠用；用 codemod 批量替换，再加 lint 白名单。

**验收**：alpha 背景 12 → 4；border alpha 9 → 2；圆角 15 → 6；阴影 19 → 5；`border+shadow` 22 → 0；二级文本只保留一个名字（或明确 alias 并禁止新代码使用另一个）。

---

#### P1-5 会话列表：一行里四种颜色通道，匹配数比标题还大

**证据**

- 项目色 3px 竖条（`SessionProjectColorWrapper.tsx:36-40`）+ 状态圆点（`SessionItem.tsx:245-247`）+ 未读/plan/pending 图标（248-269）+ 匹配数章（314-324）+ 平台 pill（297-310）。
- 项目色板含 `#ef4444`（红）、`#10b981`（绿）、`#f59e0b`（琥珀），与 destructive/success/info 同色；红竖条在截图里看起来像错误状态。
- 匹配数章：`cn("... text-micro ...", isSelected ? "... text-info-text" : "... text-info-text")`，`text-micro` 被颜色覆盖 → **15px**。
- 分组头只在折叠时显示计数（`entity-list.tsx:123-125`）；展开时没有计数。
- hover 项目名用 `style={{ color: projectColor }}` + `text-meta`（11px），7/8 项目色不过 AA。

**影响**：用户无法快速判断“红条是项目、红点是失败、蓝章是匹配、紫点是未读？”；匹配数章过大，压过标题；分组头没有计数，用户不知道组里有多少条。

**修复方向**：一行只保留一个“状态”通道；项目身份改为中性底 + 2px 细条或仅在项目视图显示；匹配数恢复 10px；分组头始终显示计数；项目名不要用原始色当文本色。

**验收**：一行内不再同时出现红/绿/琥珀/蓝四种语义色；匹配数 10px；分组头有计数；项目名对比度 ≥4.5。

---

#### P1-6 看板卡片：两条分隔线、三层元数据、永久 CTA、空列无出口

**证据**

- `TaskTile.tsx:239` 与 `306`：两条 `border-t` 分隔线；标题 + 状态章 + 进度 + 模型 + 时间 + 消息数 + Add subtask，最多 7 行。
- `TaskTile.tsx:294-300`：Add subtask 永久显示；`TaskTile.tsx:174-189`：编辑铅笔 hover 才出现。
- `KanbanBoard.tsx:157` + `TaskTile`：134 张 Done 卡片全量 `map`，无虚拟化/隐藏 Done。
- `KanbanBoard.tsx:179`：New Task 只在第一列；空 TODO 列没有空状态。
- `SubtaskProgress.tsx:44-52`：进度段仅靠颜色表达 failed/pending/done；`#ef4444` 直接写死。

**影响**：卡片像“所有元数据都摊开的小面板”，扫视成本高；Done 列 134 张卡片既占空间又拖性能；空列是纯色块，没有“在这里新建”的出口；进度条没有图例，失败/待办只能靠颜色猜。

**修复方向**：卡片固定为“标题 + 一行元数据 + （仅当与列不同）状态章 + 进度”；Add subtask 收进 `…` 菜单或 hover；Done 列默认折叠/归档；>50 张虚拟化；空列显示“拖到这里 / 新建任务”；进度加文字计数与图例。

**验收**：单卡 ≤3 行信息；134 张时首屏渲染 ≤50；空列有 CTA；进度不只靠颜色。

---

#### P1-7 可访问性与交互债：看板只能拖，卡片是“按钮套按钮”

**证据**

- `KanbanBoard.tsx:125` 只注册 `SmartPointerSensor`；没有 `KeyboardSensor`，没有 “Move to column” 命令。
- `TaskTile.tsx:134-143`：`role="button"` + `tabIndex=0`，内部还有编辑、状态、子任务、运行、Add subtask 等 4–5 个真实按钮；134 张卡片约 500 个 tab stop。
- `TaskTile.tsx:185`：编辑按钮 `opacity-0 group-hover:opacity-100`；触屏由 `craft-row-actions` 兜底，但键盘用户仍要 tab 进去才看得到。
- 41 个 `<button title=...>`；design-drift baseline 仍冻结 91 个 interactive title。
- 507 条 visual debt（446 条 role）；focus ring 有 ring-1/ring-2/三层 box-shadow 三种写法。
- 9 个 22px 顶栏启动器只有 tooltip，没有可见文字；primary 与 workbench 仅靠 1px 分隔线区分。
- 命中区不足：工作台关闭按钮约 **16px**（12px 图标 + p-0.5）；Artifact 行操作按钮 **22.5×22.5**，低于 WCAG 2.5.8 的 24px 最小目标。
- Files 视图 tab 只有 `role="tab"`，没有 roving tabindex/方向键（`FilesPanel.tsx:90-103`）；工作台 tab 有完整的 roving 逻辑，两套键盘行为不一致。

**影响**：键盘/读屏用户无法完成看板的核心操作（移动任务）；嵌套交互让语义树混乱；hover-only 操作在键盘上不可发现；`title` 在触屏和读屏上不可靠；债务被“合法化”后不会再被修。

**修复方向**：卡片改 `<article>` + 拉伸主链接，真实按钮放在独立 action bar；加 “Move to…” 菜单与 `KeyboardSensor`；所有 icon-only 按钮用共享 `Tooltip` + `aria-label`；focus ring 收敛为一套；启动器分组并给可见文本或分段。

**验收**：键盘可完成“移动任务到另一列”；卡片不再 `role=button` 套按钮；新增代码 0 个 `title`；tab stop 数量下降一个量级。

---

#### P1-8 标题层级塌陷：面板标题 13px、看板没有标题、右栏 tab 反而 15px

**证据**

- `PanelHeader.tsx:168-171`：`text-body`（13px）作为面板标题；DESIGN 的 `text-title`（16px）明确用于面板标题。
- 右栏 workbench tab 因 P0-1 实际是 15px；于是“右栏 tab > 面板标题 > 正文 13 > 视图 tab 12”。
- `KanbanBoardContainer.tsx:551-596`：Board 顶部只有筛选、搜索、New Task，没有 h1/项目名/面包屑；11px 大写列头成了最大字号。
- 每个 `PanelHeader` 都渲染 `h1`（`PanelHeader.tsx:168`），左右两栏会出现两个 h1；右栏又没有 h1。

**影响**：用户第一眼不知道“我在哪、这一页是什么”；标题和正文一样大，层级只能靠位置猜；看板的列头比标题还显眼。

**修复方向**：面板标题用 `text-title`（16）/semibold；每屏一个 h1，子面板用 h2；看板加“项目名 + Board”标题与面包屑；统一面板头高度（36/37.5/42 → 一个值，建议 40）。

**验收**：每屏一个 h1；面板标题 16px；看板有可见标题；三栏 header 底边对齐。

---

### P2（下一轮修，影响精致度与一致性）

| ID | 问题 | 证据 | 影响 | 修复 |
| --- | --- | --- | --- | --- |
| P2-1 | **第二套字号体系**：设置页用 `craft-text-label/caption`（13/12），主应用用 `text-*`（11/12/13） | `SettingsUIConstants.ts:9-15`；16 处 `craft-text-*` | 设置页看起来像另一个产品 | 迁移到合同 tier；删除 `craft-text-*` |
| P2-2 | **Composer 的 Execute/Todo 是两种领域的东西，却长成同一对胶囊** | `ActiveOptionBadges.tsx:179`（权限+状态+Info）；`FreeFormInput.tsx:1830`（附件/来源/模型在下方） | 用户以为它们是同一组模式；权限模式一键可改，风险高 | 权限放设置/菜单；状态放会话头或统一 toolbar；同一行只放同一领域 |
| P2-3 | **空状态没有出口**：No artifacts yet 只有说明，没有 “Browse files / Show changed” | `PanelEmptyState.tsx:24-35`；`StateSurface.tsx:57-63` | 右栏 50% 空白且无法行动 | 空状态加 1–2 个动作；按上下文给 “Browse / Open folder / Show changes” |
| P2-4 | **Artifact 行重复文件名**：标题与 basename 常相同，右侧三个图标按钮 | `ArtifactsPanel.tsx:84-91`、`92-129`；playground 截图 “changelog.md” 出现两次 | 浪费一行宽度，扫描噪声 | 标题只在不同时显示 basename；动作收进 `…` 或 hover |
| P2-5 | **响应式溢出 + WebUI zoom hack** | 固定 600/300/200 + workbench 360；`apps/webui/src/index.css:47-52` `zoom:1.2` | 768–1512px 横向滚动；zoom 让媒体查询/容器查询错位 | 工作台 overlay/单栏；删除 zoom，用根字号/密度 |
| P2-6 | **Board / List / Calendar / Gantt 四套 42px 工具条** | `KanbanBoardContainer.tsx:552`、`WorkItemListView.tsx:77`、`CalendarView.tsx`、`GanttView.tsx` | 同一 surface 切换视图时控件跳动 | 抽一个 `ProjectToolbar`，视图只注入右侧动作 |
| P2-7 | **颜色/格式细节**：进度只靠颜色；`-0` 删除数；“2 +235 -0”；相对时间无绝对日期 | `SubtaskProgress.tsx:44-52`；`ChangedFilesView.tsx:225-230`；`SessionItem.tsx:344-346` | 可读性/专业感 | 加文字；抑制 0；tooltip 绝对时间 |
| P2-8 | **顶栏 9 个 22px 启动器**：primary 与 workbench 仅 1px 分隔；与窗口控制相邻 | `SurfaceLauncherButtons.tsx:47-53,183-210`；`TopBar.tsx:262-321` | 误点；无法记忆 | 分组、加分隔/标签；窗口控制隔离 |

### P3（打磨项，时间允许再做）

| ID | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| P3-1 | 动效/图标微漂移：bounce easing、width/padding 布局动画、`strokeWidth={2/2.25}` | `packages/ui/src/styles/motion.css:20-21`；`TrajectoryTable.module.css:264-286`；`SurfaceLauncherButtons.tsx:201` | 改用标准 ease；只动 transform/opacity；stroke 由 `--icon-stroke-width` 统一 |
| P3-2 | DESIGN 拓扑过期 + dead prop | `DESIGN.md:287-290`；`App.tsx:2342`；`AppShell.tsx:199/534` | 删除 `defaultLayout`；改写为实际像素/内容驱动模型 |
| P3-3 | 排版细节规则基本未用 | `text-wrap: pretty/balance` 0/1 处；`tabular-nums` 107 处但时间/计数未全覆盖 | 在正文/标题/计数上补；统一数字字体特性 |
| P3-4 | 术语与 i18n 长度 | `en.json` “Deliverables / Drafts / Opened files”；中文长标签在 22.5px chip 里 | 统一为 Artifact 词汇；给窄控件设长度预算 |

---

## 5. 专题：为什么“看起来粗糙”

### 5.1 一个 merge 层如何摧毁设计系统

设计系统的工作方式应该是：组件声明 `text-meta`，渲染出来就是 11px。现在实际链路是：

```
cva(... text-meta ...) → cn(...) → twMerge 把 text-meta 当颜色 → 丢掉
→ 继承 root 15px
```

于是同一个 `Badge`，在 `Badge` 组件里是 15px，在 `StatusBadge`（普通字符串）里是 11px；同一个“状态”，在卡片里 11px，在 Artifacts 行里 15px；同一个“按钮”，default 15px，sm 11px 且文字不可见。**不是设计没有层级，而是层级在运行时被随机删掉。** 这也解释了为什么单看某个页面“还行”，并排看三栏就“很糙”。

### 5.2 三栏的宽度与 chrome 税

```
┌ 48 rail ┬ 298 navigator ┬ 606 chat ┬ 961 workbench ┐
│         │ 36 header     │ 36 header│ 37.5 tab     │
│         │               │          │ 37.5 view    │
│         │               │          │ 37.5 filter  │
│         │   list        │  chat    │  empty 800px │
└─────────┴───────────────┴──────────┴──────────────┘
```

- 右栏 50% 宽、18.8% 高是 chrome，内容是空的。
- 中栏 31.25% 宽，聊天 600px 固定；840px 的阅读宽度用不上。
- 左栏 15.5% 宽，行内却塞了 4 种颜色通道。

这不是“留白”，是**空间分配与内容重要性相反**。

### 5.3 看板的颜色语法

同一张卡上，用户同时看到：

- 列头色（琥珀/翠绿/靛蓝/石板）
- 列体 tint（同色 6%）
- 状态章色（绿/琥珀/紫/灰）
- 项目竖条色（红/绿/琥珀/粉…）
- 进度段色（accent/成功/失败）
- 模型品牌色

六套颜色，没有一套有图例。**颜色在这里不是信息，是装饰。** 这就是 DESIGN 里“Accent-Is-For-Intent”被违反后的直接观感。

### 5.4 门禁为什么全绿

| 门禁 | 检查 | 没检查 |
| --- | --- | --- |
| `check:scale-contract` | 合同 token 的值与 DESIGN 一致 | 组件实际用了哪个 token、min-height 是否覆盖 |
| `check:design-drift` | 字面量类名/hex/标题 | `cn()` 合并后的结果、计算字号、内联颜色 |
| `check:contrast-floor` | 4 套主题的预定义色对 | 看板/项目/内联色、半透明叠色 |
| `check:visual-contracts` | 507 条债务不增长 | 新布局/新层级/新组合 |
| `validate:ci` | 类型、lint、单测 | 真实渲染的视觉结果 |

结论：**静态门禁无法约束组合**。这不是加一条 lint 能解决的，需要计算样式 + 截图基线 + 结构规则（例如“一个面板最多两条横条”）。

---

## 6. 整改方案

> 原则：先修 primitive，再修组合；先减少词汇，再谈美化；每一波都能独立验收，不搞一次性大重写。

### R0 · 稳定原语（1–1.5 人日）

| # | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 1 | 扩展 twMerge，注册字号 tier（含 glyph） | `packages/ui/src/lib/utils.ts`、`apps/electron/src/renderer/lib/utils.ts` | 6 条 merge 用例全部保留 tier |
| 2 | 修复 Button/Badge/MetadataBadge 的字号与文字色 | `button.tsx`、`badge.tsx`、`metadata-badge.tsx` | default 13、xs 11、compact 12、sm 11；填充 sm 文字对比度 ≥4.5 |
| 3 | 补齐 `data-control-size` 映射 | `roles.css`、`button.tsx` | xs 22、compact 26、sm 30、default 34、lg 38；height=min-height |
| 4 | 新增计算样式契约（Playwright，light/dark，1280/1536/1920） | `scripts/verification/ui-primitives-workflow.ts` + `package.json` | CI 在字号/高度/颜色回归时失败 |
| 5 | 把 `scan.ts` 变成可重复 CI 检查 | `scripts/audit-ui-merge.ts`（由 scan 改造） | lost-tier 0 才通过 |

**R0 的风险**：修 merge 会让大量 15px 变回 11/12/13px，页面会“突然变小/变密”。这是恢复合同，不是回归；必须在 R0 单独提 PR，附 before/after 截图，逐页确认 padding 是否需要跟着调。

### R1 · 统一 chrome 语言（2–3 人日）

| # | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 1 | 新建共享 `Tabs` / `SegmentedControl` / `Toolbar`，支持 underline / pill / segment 三种外观但同一键盘语义 | `packages/ui/src/components/ui/` | Files、Artifacts、Changed、Workbench、Settings 全部迁移 |
| 2 | Files 面板只留一条视图 tab + 一条工具条；Artifacts 范围改为筛选菜单；Unified/Split 进工具条 | `FilesPanel.tsx`、`ArtifactsPanel.tsx`、`ChangedFilesView.tsx` | chrome 112.5 → ≤75px；一个面板一个 tablist |
| 3 | 面板标题 16px、每屏一个 h1；统一 header 高度 40 | `PanelHeader.tsx`、`ContextWorkbenchTabs.tsx`、`FilesPanel` | 三栏 header 对齐；每屏一个 h1 |
| 4 | surface/border/radius/shadow 收敛 | `role-tokens.css`、`theme-tokens.css` + codemod | 12→4、9→2、15→6、19→5；无 border+shadow |
| 5 | 启动器分组：Primary 与 Workbench 分开，选中用 `--action-selected` | `SurfaceLauncherButtons.tsx`、`TopBar.tsx` | 选中态不只靠文字色；可键盘遍历 |

### R2 · 重组表面（4–5 人日）

| # | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| 1 | 工作台宽度封顶 50% + 空态自动折叠 + 1280 以下 overlay；保留手动拖宽/全宽展开 | `SurfaceSlot.tsx`、`atoms/workbench.ts`、`AppShell.tsx` | 1920/隐藏导航均 ≤50%；主聊天 ≥600px；1280 无横向滚动 |
| 2 | 看板颜色权威：**中性列 + 2px 色条/圆点**，状态章仅在差异时显示，`onAccent` 按亮度 | `kanban-colors.ts`、`useKanbanColumnColors.ts`、`KanbanColumn.tsx`、`TaskTile.tsx` | 四列对比度 ≥4.5；无组件 hex；列/状态不矛盾 |
| 3 | 卡片解剖：≤3 行、Add subtask 收进菜单、Done 折叠、>50 虚拟化、空列 CTA | `TaskTile.tsx`、`KanbanBoard.tsx`、`KanbanColumn.tsx` | 单卡 ≤3 行；134 张首屏 ≤50；空列有 CTA |
| 4 | 会话列表减色：一个状态通道、项目细条、匹配数 10px、分组计数常显 | `SessionItem.tsx`、`SessionProjectColorWrapper.tsx`、`entity-list.tsx` | 一行不再四色；匹配数 10px |
| 5 | Composer：权限/状态拆分，Info 去重，工具栏徽章 13/11 | `ActiveOptionBadges.tsx`、`FreeFormInput.tsx`、`ChatInputZone.tsx` | 一个 toolbar 只放同一领域；无重复 Info |
| 6 | 四套 42px 工具条合并为 `ProjectToolbar` | `KanbanBoardContainer.tsx`、`WorkItemListView.tsx`、`CalendarView.tsx`、`GanttView.tsx` | 切换视图控件不跳动 |

### R3 · 防回归（最小集 1 人日，随 R0 落地；完整 burn-down 可后置）

| # | 任务 | 验收 |
| --- | --- | --- |
| 1 | `check:contrast-floor` 扩展到看板/项目/内联色，按计算色检查 | 列头、项目名、状态章全部 ≥4.5 |
| 2 | `check:design-drift` 增加“计算字号/高度”计数，而不只字面量 | 新增 tier 丢失/高度越界即失败 |
| 3 | visual debt 只减不增；每季度定一个 burn-down 目标（如 -20%） | 507 不增长；新代码 0 新增 |
| 4 | 更新 DESIGN.md：实际布局模型、唯一颜色权威、tab 层级、surface 角色 | 文档与实现一致；删除 dead prop |
| 5 | PR 模板加 UI 变更门槛：primitive 改动必须附 3 尺寸 × 2 主题截图 | 评审可验证 |

**按已确认范围（R0–R2）的执行顺序**：R0 与 R3 的 1/2 项在同一个 PR 落地（否则修完没有防回归）；R1 紧随其后；R2 最后做布局与看板。R3 的 3/4/5 项作为收尾，不单独占一个迭代。

| 里程碑 | 内容 | 出口 |
| --- | --- | --- |
| M1（第 1–2 天） | R0 + R3 最小集 | 82→0；按钮字号/高度/颜色全对；计算样式 E2E 绿 |
| M2（第 3–5 天） | R1 | Files chrome ≤75px；一个 tab 原语；标题 16px；surface 收敛 |
| M3（第 6–9 天） | R2 | 工作台 ≤50%；看板中性列；卡片 ≤3 行；1280 无横向滚动 |
| M4（第 10 天） | 全量视觉 QA + 文档 | 3 尺寸 × 2 主题截图通过；DESIGN.md 更新 |

### 6.1 量化目标

| 指标 | 当前 | 目标 |
| --- | ---: | ---: |
| `cn()` 丢层点 | 82 | 0 |
| xs/compact 高度 | 34 / 34 | 22 / 26 |
| default 按钮字号 | 15 | 13 |
| Badge/Metadata 字号 | 15 | 11 |
| Artifact 状态章 | 15 | 10 |
| Files 面板 chrome | 112.5px / 3 条 | ≤75px / 2 条 |
| 工作台宽度（1920） | 50% | ≤50%，空态折叠 |
| 列头对比度 | 2.15–4.76 | 全部 ≥4.5 |
| border+shadow 叠用 | 22 | 0 |
| 背景 alpha 种类 | 12 | 4 |
| 圆角类 | 15 | 6 |
| 阴影类 | 19 | 5 |
| visual debt | 507 | 不增长，季度 -20% |
| `title` on button | 41 | 0（新代码） |

### 6.2 验证命令

```bash
bun run check:scale-contract
bun run check:design-drift
bun run check:contrast-floor
bun run check:visual-contracts
bun run webui:typecheck
bun run lint
bun run test:ui:primitives        # 新增：计算字号/高度/颜色
bun run audit:ui-merge            # 新增：由 scan.ts 改造
```

**人工验收矩阵**：1280 / 1536 / 1920 × light / dark × Shell / Files(3 views) / Board / Composer / Settings。每格至少一张截图；R0 的 before/after 必须能并排看出字号/高度变化。

### 6.3 不建议做的事

- **不要只给 xs/compact 补 min-height**：字号和文字色仍然是错的。
- **不要继续加 token**：现在的问题是词汇太多，不是太少。
- **不要重做整个视觉**：外壳和聊天区的方向是对的，先修 primitive 和组合。
- **不要用“统一字号”一刀切**：层级需要 10/11/12/13/16，不是全部 13。
- **不要为了看板“有颜色”而保留四套色相**：用中性列 + 一条色条 + 状态章就够。

---

## 7. 风险与取舍

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 修 merge 导致全局 reflow | 大量 15px 回到 11/12/13，行高/按钮内边距会变 | R0 单独 PR；逐页截图；只调必要的 padding |
| 工作台封顶影响 diff 审阅 | 宽 diff 需要空间 | 保留“展开为全宽”；封顶只作用于伴随模式 |
| 合并 tab 破坏键盘语义 | 现有 roving tabindex 做得不错 | 新 primitive 继承 Home/End/Arrow；加 E2E |
| 看板去色后失去识别 | 列身份变弱 | 中性 surface + 2px 色条 + 列头点；状态章承担语义 |
| 债务 burn-down 拖慢交付 | 507 条不可能一次清 | 先“只减不增”，按文件分批；新代码零新增 |

---

## 8. 附录

### 8.1 证据文件

| 文件 | 内容 |
| --- | --- |
| `docs/verification/results/ui-system-audit-2026-10-21/FRONTEND-REMEDIATION-PLAN.html` | 可视化整改演示：自审、失效链、前后对比、路线与指标 |
| `docs/verification/results/ui-system-audit-2026-10-21/scan.ts` | 可重复的静态扫描（twMerge 复现 + 类名 census） |
| `docs/verification/results/ui-system-audit-2026-10-21/evidence.json` | 机器可读的测量、对比度、计数、发现清单 |
| `docs/verification/results/ui-system-audit-2026-10-21/control-measurements.json` | 按钮 computed style（上一轮 Playwright） |
| `docs/verification/results/ui-system-audit-2026-10-21/files-measurements.json` | Files tab / 筛选 computed style |
| `docs/verification/results/ui-system-audit-2026-10-21/detector-ui.json` / `detector-shell.json` | impeccable detector 结果（仅代码级 slop） |
| `docs/verification/results/ui-system-audit-2026-10-21/class-merge-reproduction.json` | 最初的 merge 复现样本 |

### 8.2 关键文件索引

| 问题 | 文件:行 |
| --- | --- |
| 裸 twMerge | `apps/electron/src/renderer/lib/utils.ts:4-6`；`packages/ui/src/lib/utils.ts:12` |
| Button 字号/变体 | `apps/electron/src/renderer/components/ui/button.tsx:7,23-28,54` |
| min-height 映射 | `packages/ui/src/styles/roles.css:79-82` |
| Badge | `apps/electron/src/renderer/components/ui/badge.tsx:6,33` |
| MetadataBadge | `apps/electron/src/renderer/components/ui/metadata-badge.tsx:55-66` |
| 看板列 tint/头 | `KanbanColumn.tsx:94-118,185-227` |
| 看板颜色 | `kanban-colors.ts:11-16`；`useKanbanColumnColors.ts:31-36` |
| 状态默认色 | `packages/shared/src/colors/defaults.ts:21-28` |
| 工作台宽度 | `SurfaceSlot.tsx:70-95`；`atoms/workbench.ts:21-24` |
| 三栏布局 | `AppShell.tsx:580-600`；`App.tsx:2342`；`DESIGN.md:287-290` |
| Files 横条 | `ContextWorkbenchTabs.tsx:93`；`FilesPanel.tsx:90-103`；`ArtifactsPanel.tsx:195-214`；`ChangedFilesView.tsx:216-233` |
| 面板标题 | `PanelHeader.tsx:168-171` |
| 看板卡片 | `TaskTile.tsx:134-189,239-324`；`KanbanBoard.tsx:157` |
| 会话列表 | `SessionItem.tsx:245-269,314-324`；`SessionProjectColorWrapper.tsx:36-40` |
| 表面 alpha | `bg-foreground/[0.0x]` 12 种；`border-border/xx` 9 种（scan 统计） |
| 债务 | `scripts/visual-debt-ledger.json`（507 条）；`scripts/design-drift-baseline.json`（91 title） |

### 8.3 复现命令

```bash
# 合并层复现
bun -e "import {twMerge} from 'tailwind-merge'; console.log(twMerge('text-meta text-foreground'))"

# 全量静态扫描（写 %TEMP%/ui-audit/scan.json）
bun run docs/verification/results/ui-system-audit-2026-10-21/scan.ts

# 现有门禁
bun run check:scale-contract
bun run check:design-drift
bun run check:contrast-floor
bun run check:visual-contracts
```

### 8.4 本次未做的事

- 没有修改任何产品源码、样式或配置。
- 没有提交 git commit；新增文件仅在 `docs/verification/results/ui-system-audit-2026-10-21/` 下，便于后续跟踪。
- 没有重新启动 dev server/截图（沙箱限制），视觉结论基于已有生产截图 + 计算样式 + 源码；R0 落地时必须补一轮真实截图。

---

**最终判断**：Phaneris 的设计方向是成立的，问题集中在“实现层把合同拆掉了”。先做 R0 的两件事（merge 配置 + 控件高度映射），就能消掉截图中大部分“过大/过小/发虚”的观感；再做 R1/R2 的组合收敛，界面才会从“像被不同人拼起来”回到“同一个产品”。这不是一次 polish，而是一次**系统修复**。
