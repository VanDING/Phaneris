# 日历视图 / 甘特图视图 —— 全面诊断与优化方案

> 基线：`4e9f827b`（feat(gantt): refine project planning view）
> 方法：源码通读 + 三个并行只读审计 + **真实浏览器实测**（Playground + Playwright，含对抗性数据）
> 本文所有结论都带 `文件:行号` 或实测数值；无法确认的部分明确标注"未验证"。

---

## 0. 结论先行

**一句话**：日历和甘特图是同一份数据（Session 的规划字段投影）的两套独立实现——日历只拿到日期字段，甘特图拿到完整工作项——因此它们在"同一条数据"上互相矛盾，而且各自都缺一层共享的"项目时间基础层"（日期归一、范围查询、筛选、头部、原语）。

必须优先修的三类问题：

| 类别 | 问题 | 实测/证据 | 严重度 |
| --- | --- | --- | --- |
| 语义错误 | 甘特图**每个多日任务条都短一天** | 5 天任务渲染 4 格；161 天渲染 160 格（`GanttView.tsx:463-476`） | P0 |
| 语义错误 | 甘特图**周序号 W## 大量错误** | 2025–2027 的 156 个周一里 53 个与 ISO 周号不符；2027 全年偏移 1（`GanttView.tsx:107-110`） | P0 |
| 语义错误 | 日历 **08:00–20:00 之外的日程跑到网格外** | 07:00 条目绘制在全天条上方 56px；22:00 条目绘制在网格下方 168px（`CalendarView.tsx:51-63`） | P0 |
| 信任度 | 编辑保存**静默失败**（无任何提示） | `endTime<=time` → 服务端抛错 → hook 吞掉 → 页面不关闭也不报错（`useCalendarEntries.ts:81-84`, `SchedulePage.tsx:90`） | P0 |
| 信任度 | 甘特图**未排期事项静默消失**，且"未排期父项"提示是死代码 | 6 条数据只渲染 3 行、无任何提示；`gantt.unscheduledParents` 不可达 | P0 |
| 一致性 | 打开日历会**清空列表视图的状态/排期筛选** | `CalendarView.tsx:136-139` 写全局 atom，而日历自己完全不读这两个筛选（看板有同样行为，但那是看板的既定设计；日历只是照抄并连带清掉了列表页的筛选） | P1 |
| 一致性 | 切视图 remount，**所有视图内状态丢失** | `ProjectManagementSurface.tsx:72` `key={state.view}`；甘特缩放回 quarter、日历回本月 | P1 |
| 可用性 | 甘特图**完全只读**，日历**无键盘路径** | `GanttView.tsx:759` `readonly`；周视图条目不渲染任何按钮（`CalendarView.tsx:521-603`） | P1 |

**工程量级**：阶段 0（正确性止血）约 1–2 人日、风险低、不动架构；阶段 1（交互补齐）约 3–5 人日；阶段 2（架构收敛）约 5–8 人日；阶段 3（视觉/规范）约 2–3 人日。

---

## 1. 事实基线

### 1.1 数据流：Session 是唯一真源

```
Session（packages/shared/src/protocol/dto.ts:52 + sessions/types.ts:93-105）
   │  规划字段：startAt / dueAt / description / projectId / progress / isMilestone / parentSessionId / dependencySessionIds / sessionStatus
   ├── calendar:LIST   → sessionToEntry()   → CalendarEntry   （只有 date/endDate/time/endTime/allDay/note/projectId）
   │      packages/server-core/src/handlers/rpc/calendar.ts:20-38, :58-66
   │      ★ 注释明确写着「There is no legacy CalendarEntry store」(:52)
   └── workItems:LIST → sessionToWorkItem() → WorkItem        （含 statusId/columnId/progress/parentId/isMilestone/dependencyIds…）
          packages/server-core/src/handlers/rpc/work-items.ts:35-56, :107-110
          ★ 同一份 session 列表的第二次全量投影

渲染端：
  CalendarView.tsx:117  useCalendarEntries()  → calendar:list   （渲染用）
  CalendarView.tsx:118  useWorkItems()        → workItems:list  （★ 不渲染任何一项，只为喂 useWorkItemViewState）
  GanttView.tsx:363     useWorkItems()        → workItems:list  （渲染用）
```

由此产生的结构性事实：

1. **`CalendarEntry` 是 `WorkItem` 的严格子集**——缺 `statusId / progress / isMilestone / parentId / columnId`。所以日历**在数据层就无法**显示状态、进度、里程碑（这也是"日历里所有条目同色"的根因，`CalendarView.tsx:70-72`）。
2. **日历每次挂载发起两次全量拉取**（`CalendarView.tsx:117-118`），其中 workItems 一次纯属浪费（只用于 `useWorkItemViewState` 的选中态收敛）。
3. **文档与实现相反**（会误导后续开发）：
   - `packages/shared/src/protocol/dto.ts:938-942`：写着 "standalone schedule items … Lives in the workspace's `calendar/entries.json` and is independent of any session — clicking 'create conversation' spawns a session from it on demand"。实际：条目**就是** Session，`create` 立刻建 Session（`calendar.ts:70`），`delete` 只是清空日期（`calendar.ts:97-101`）。
   - `apps/electron/src/renderer/hooks/useCalendarEntries.ts:4-5`：同样写着 "independent of sessions"。
4. **每次编辑触发多次全量刷新**：`calendar.ts:44-47` 与 `work-items.ts:30-33` 立即广播两个通道；同一写入又会经 `SessionManager.broadcastPlanningChanged()`（250ms 合并，`SessionManager.ts:1813-1830`）再广播一次两个通道。结果：一次拖拽 = 最多 4 次全量 `:list`（日历侧 2 次 + workItems 侧 2 次），且是"全工作区"而非当前可见范围。`SessionManager.ts:1805-1812` 的注释自己承认这个模式曾是 quadratic 问题。

### 1.2 视图挂载与状态

| 维度 | 现状 | 证据 |
| --- | --- | --- |
| 切换入口 | 仅顶栏启动器；**投影内部没有切换器** | `surface-launchers.ts:35,69`；`PROJECT_MANAGEMENT_VIEWS`（`types.ts:1116`）无 UI 消费者 |
| 挂载 | `switch (state.view)` → 4 个零 props 组件，各自读 context/atom | `ProjectManagementSurface.tsx:36-48` |
| remount | `<div key={state.view} className="motion-view-enter">` → 每次切换重建子树 | `ProjectManagementSurface.tsx:72` |
| 丢失的状态 | 日历 `view/cursor/selectedDay`、甘特 `scale/hoveredId/横向滚动位置` | `CalendarView.tsx:140-142`；`GanttView.tsx:366,384` |
| 保留的状态 | 甘特折叠集合（localStorage，按 ws+projects 作用域）；共享 atom（筛选项/搜索/选中） | `GanttView.tsx:367-399`；`atoms/kanban.ts:19-34` |
| 头部 | 两种高度（42px vs 48px）、两套边距；**甘特图未做红绿灯补偿** | `KanbanBoardContainer.tsx:581-585` / `WorkItemListView.tsx:74-78` vs `CalendarView.tsx:746-750` vs `GanttView.tsx:702` |
| 筛选一致性 | 看板/日历清空 status+scheduled；甘特只共享 project 过滤，忽略 search/sort/status/scheduled | `KanbanBoardContainer.tsx:93-96`、`CalendarView.tsx:136-139`、`GanttView.tsx:415-428` |

### 1.3 测试与门禁现状

- 日历/甘特**没有任何渲染级或行为级测试**。相关单测只有：`lib/__tests__/calendar-date.test.ts`（53 行，只测标题/星期格式化）、`shared/__tests__/route-parser-project-management.test.ts`、几个把 calendar/gantt 当路由 fixture 的 atom/launcher 测试。
- 仓库**没有 E2E 框架**（无 `playwright.config`、无 `e2e/`、CI 无 playwright）；`plans/motion-verification.mjs:329-379` 是唯一一个真实浏览器检查（日历 day→week 切换），但它假设 `[role="tablist"]`（`:343`），而日历分段控件**没有任何 role**，导致作用域静默退化为 `document.body`。
- **Playground 在本机实测白屏**：`window.electronAPI.onSessionEvent is not a function`（`App.tsx:995`、`NavigationContext.tsx:1269` 会调用；`playground/mock-utils.ts` 中该 API **0 次出现**），DOM 只有 31 个节点。Playground 也没有注册甘特图条目（`playground/registry/schedule-views.tsx:73-110`）。→ 两个视图目前**无法被设计系统 Playground 验证**。
- 无 a11y 门禁：`eslint-plugin-jsx-a11y` 未安装、未启用。
- i18n 门禁只能查"引用的 key 是否存在"（`scripts/check-i18n-coverage.ts:5-11`）与"locale 键集合是否一致"，**查不出**"值没翻译"和"key 已死"。

---

## 2. 问题清单（按严重度，全部带证据）

### P0 — 正确性与信任度

#### C1. 甘特图多日任务条短一天（跨视图数据矛盾）
`GanttView.tsx:463-476`（`bounds`）与 `:487-509`（`displayRangeOf`）只在 `start === end`（零长度）时 `addOneDay(end)`，其余直接使用 `dueAt`。但 SVAR 的 `end` 是**排他**边界。

实测（Playground，月尺度 = 56px/天，量测 `.wx-bar` 宽度）：

| 任务 | 数据（相对今天） | 应占天数（含 due） | 实测宽度 | 实测天数 |
| --- | --- | --- | --- | --- |
| FiveDay | start −12，due −8 | 5 | 224px | **4** ❌ |
| SixDay | start −7，due −2 | 6 | 280px | **5** ❌ |
| HundredSixtyOneDay | start −40，due +120 | 161 | 8960px | **160** ❌ |
| SingleDay | start = due = +1 | 1 | 56px | 1 ✅（靠 `addOneDay` 兜住） |
| Phase A（汇总） | 由子项 roll-up | 11 | 616px | 11 ✅（因里程碑子项被补了一天，正好抵消） |

即：**甘特图上所有 `start < due` 的任务都比日历早一天结束**。这是两个视图对同一字段给出不同答案，属于必须修的数据语义缺陷。

#### C2. 甘特图周序号 `W##` 不是 ISO 周号
`GanttView.tsx:107-110` 的 `isoWeek()` 实为"周日为一周起点 + 1 月 1 日锚点"的近似算法。实测（与 ISO-8601 对比）：

- 2025-12-29（周一）：显示 `W53`，真实 `W1`
- 2027 年**全年**每个周一都偏移 1（如 2027-01-04 显示 `W2`，真实 `W1`）
- 2025–2027 共 156 个周一中 **53 个错误（34%）**
- 另外前缀 `W` 是硬编码字符串，未走 i18n

修复成本极低：根依赖已有 `date-fns@4.4.0`，直接 `import { getISOWeek } from 'date-fns'`（已确认导出）。

#### C3. 日历把 08:00–20:00 之外的日程画到网格外
`CalendarView.tsx:51-63` 硬编码 `HOUR_START=8 / HOUR_END=20`，`hourTop()` 对窗外时间返回负值或 >100%。实测（日视图，网格高 672px）：

- 07:00–07:30 条目：`top = -56px`，**压在全天条上**（全天条 y=315 h=40，该条目 y=307）
- 22:00–23:00 条目：`top = +784px`，即网格底部之下 168px
- 23:00–01:00 跨夜条目：同样落在网格下方；且 `duration = max(30, endMinutes - startMinutes)` 会把负数夹成 30 分钟（`:436-437`）

同时 `SchedulePage` 的时间输入没有 `min/max` 约束（`:157-166`），用户可以合法创建任意时刻的日程 → 一定会出现看不见/压层的条目。

#### C4. 保存失败完全静默
链路：`SchedulePage.tsx:190` 保存按钮 → `useCalendarEntries.create/update` 捕获异常后 `return null`（`:66-69, :81-84`）→ `if (saved) close()`（`:90`）→ 页面不关闭、**没有任何错误提示**。服务端校验确实会抛错（`SessionManager.ts:8606-8607`：`Session start must not be after its end`）。

触发条件很常见：同日 `endTime <= time`。`<input type="time" min={time}>`（`:166`）是**无效约束**——这里没有 `<form>`，保存按钮是 `type="button"`。

两个 hook 都返回 `error`，但**两个消费者都没有解构它**（`CalendarView.tsx:117`、`SchedulePage.tsx:41`）→ 加载失败与"真的没有日程"在 UI 上无法区分。

#### C5. 甘特图静默隐藏未排期事项，且"未排期父项"提示不可达
实测（6 条 fixture：3 条未排期 + 3 条已排期）：只渲染 3 行，页面上**没有任何未排期提示**。

代码层面可证明可提示路径是死代码：`unscheduledParents++` 只在"已进入 `included` 的 summary 且 `rangeOf()` 无范围"时触发（`GanttView.tsx:583-587`），而 `included` 只收录"有日期且与窗口相交的项 + 其祖先"（`:519-532`）；未排期父项要么因有已排期子项而 roll-up 出范围，要么整棵子树都不在 `included` 里。→ `gantt.unscheduledParents*`（7 种语言 × 2 复数形式）永远不会渲染。

附带：头部计数 `scheduledCount` 只数"自身有日期的项"（`:627`），于是出现 **"2 scheduled items" 但画面有 3 条 bar**（实测）。

#### C6. 日期解析三套实现，且不做时区归一
- 服务端 `calendar.ts:12-18`：`day(v)=v.slice(0,10)`、`time(v)=v.includes('T')?v.slice(11,16):undefined`——**裸切片**。
- 客户端 `GanttView.tsx:124-128`：`parsePlanDate()`，10 字符补 `T00:00:00`（本地）。
- 共享层 `work-items/query.ts:8-12`：`workItemDateKey()`，**有正则校验**——但除 work-items 包内部外**无人使用**（已 grep 确认）。

后果（审计已验证 `new Date()` 行为）：
- `startAt='2026-09-22T02:00:00Z'`（允许的 offset ISO 形式，`sessions/types.ts:97`）：日历显示 09-22 02:00，本地（Asia/Shanghai）实际是 09-22 10:00 → **错 8 小时**。
- `startAt='2026-09-22 14:00'`（空格分隔，服务端接受）：`time()` 因不含 `T` 返回 undefined → `allDay=true` → **定时任务变全天**。
- `startAt='2026-9-2'`（V8 可解析、服务端接受）：`day()` 返回 `'2026-9-2'`，破坏日历的字典序范围判断（`CalendarView.tsx:175`）与排序（`:167-169`）；拖拽时 `parseISO` 得到 Invalid Date → `dayKey()` 产出 `'NaN-NaN-NaN'`（`:204`, `:65-67`）。

同时 `WorkItemQuery.dateRange` + `intersectsDateRange` 已实现且已有单测（`packages/shared/src/work-items/query.ts:29-36`、`types.ts:90-91`、`query.test.ts:35-36`），**日历没有任何调用者** → 拉取永远全量（`calendar.ts:58-66` 无 range/limit/page 参数）。

### P1 — 交互与状态

| # | 问题 | 证据 | 实测补充 |
| --- | --- | --- | --- |
| I1 | 拖拽改期无乐观更新、无失败回滚、无提示；一次拖拽等一次 RPC + 全量刷新 | `CalendarView.tsx:195-226`、`useCalendarEntries.ts:74-87` | — |
| I2 | **resize 拖动无任何实时反馈**（松手才变化）；监听器不清理；点手柄还会顺带打开编辑器 | `CalendarView.tsx:228-251, 457, 602` | 实测 `livePreview: false` ✅ |
| I3 | 跨天/跨夜语义缺失：多日**定时**条目在第 2 天起被当"全天"渲染（判定条件是 `entry.date !== key`，与是否有时间无关）；跨夜被夹成 30 分钟 | `CalendarView.tsx:360, 509, 575, 436-437` | 实测（周视图）：`Multi-day TIMED range` 在第 2/3/4 天出现在全天行内 |
| I4 | 重叠列布局是简单分组（`index/count`）：链式重叠（A∩B、B∩C，A∩C=∅）会被统一压到同一列宽；`overlapPosition` 对每个条目都全表扫一遍（O(n²)） | `CalendarView.tsx:85-94, 438, 582` | 月视图 11 条目 / 622 DOM 节点，当前量级未见性能问题；风险随条目量级上升 |
| I5 | 打开日历清空列表视图的 status+scheduled 筛选（写全局 atom），而日历自己完全不读这两个筛选 | `CalendarView.tsx:136-139` vs `atoms/kanban.ts:22-29`；`WorkItemListView.tsx:105-111` 才是消费者 | — |
| I6 | 切视图 remount：`switchView` 还会强制把 cursor 拉回今天；横向滚动位置不保留 | `CalendarView.tsx:297-301`、`ProjectManagementSurface.tsx:72` | — |
| I7 | 无键盘路径：周视图条目不渲染任何按钮（日视图靠 `entryActions` 兜底）；月网格无 grid 语义；`+N more` 不可点；拖拽仅 HTML5 DnD | `CalendarView.tsx:521-603, 623-628, 724-728, 342-349` | 实测 `+7 more` 是 `span`、`tabIndex=-1` ✅ |
| I8 | 分段控件无 `role=radiogroup`、无 roving tabindex（三个按钮 tabIndex 都是 0）、无组标签 | `CalendarView.tsx:794-818`、`GanttView.tsx:715-731` | 实测：group role=null，按钮 `aria-pressed` ✅ |
| I9 | 周导航用 `7*86_400_000` 毫秒运算（DST 边界可能偏一天）；周标题只显示"月 年"（跨月周显示错月份）；prev/next 的 `aria-label` 固定为 "Previous/Next month" | `CalendarView.tsx:280, 288, 303-306, 771, 780`；`calendar-date.ts:15-20` | — |
| I10 | 甘特图只读：不能拖拽改期、不能改依赖/进度；设计提案里的"依赖聚焦高亮"未实现 | `GanttView.tsx:759`；`docs/process/gantt-view-design-proposals.html:541-543` | — |
| I11 | 甘特"Today"依赖私有内部状态（`getState()._start/_scales`）与 DOM 选择器，版本升级即静默失效 | `GanttView.tsx:680-698` | 横向滚动本身可用（实测 `.wx-chart` overflow-x:auto） |
| I12 | 过滤能力不对等：甘特图无搜索/状态/排序（搜索只作用于看板/列表/日历） | `GanttView.tsx:415-428` | — |

### P2 — 视觉与工程规范

| # | 问题 | 证据 | 备注 |
| --- | --- | --- | --- |
| V1 | 依赖箭头对比度不足：`--wx-gantt-link-color` = fg 35% → 浅色 **2.03:1**、深色 **2.67:1**（WCAG 1.4.11 要求 ≥3:1）；日历 muted 文本 `text-foreground/45` = 浅色 **2.61:1**，`/55` = **3.39:1**，`/30`（非本月日期）= **1.82:1** | `gantt-overrides.css:53-54`；`CalendarView.tsx:371,625,726,662` | 数值由 token 实测计算得出 |
| V2 | 动效未走 token：Tailwind 默认 150ms / `cubic-bezier(.4,0,.2,1)`；甘特 CSS 硬编码 `120ms ease`；`active:scale-[0.998]`（≈不可感知）而非 `--motion-scale-pressed`(0.98) | `CalendarView.tsx:380,442,714`；`gantt-overrides.css:182,199,377`；`GanttView.tsx:227` | 与 `plans/motion-specification.md:15` 冲突；reduce 模式下 120ms 不随之收敛 |
| V3 | 原语重复实现：分段控件 ×2、`title=` 代替 Tooltip、raw `<input>` 代替 `Input`、raw `<button>` 代替 `Button`/`HeaderIconButton` | `CalendarView.tsx:756-791`；`GanttView.tsx:732-738` | 已有 `SettingsSegmentedControl`、`radio-group-navigation.ts`、`HeaderIconButton`、`Input` |
| V4 | 甘特图主题块里 29 个 `--wx-gantt-*` 赋值中，与**任务条/汇总条/里程碑上色**相关的那部分对最终外观没有影响——它们确实被 vendor CSS 消费（库把变量声明在 `.wx-material-theme` / `.wx-willow-theme` 自身，我们的覆盖块也落在同一个元素上，声明层没问题），但随后被 `.wx-bar`/`.wx-content` 的清空规则与自定义 `.pg-bar` 覆盖（属"赋值被中和"，不是"变量不存在"）。清理前需逐个在 DevTools 里核对生效元素；另外 `highlightTime` 未配置 → `--wx-gantt-holiday-*` 实际不生效、**没有周末底纹、没有今日线** | `gantt-overrides.css:45-88, 339-366`；`gantt-store/dist/types/types.d.ts:297` 默认 `highlightTime: null` | 周末底纹与只读/拖拽同属 **MIT 免费能力**（见 §7.2）；"Vertical markers"（今日线）确为 PRO，但用 `highlightTime`+CSS 自绘约 30 行即可 |
| V5 | i18n：`schedule.*` 在 ja/de/es/hu/pl **全是英文值**（仅 zh-Hans 翻译完整）；7 个 key（`gantt.range.*`、`gantt.zoomFit/In/Out`）为死键（7 语言 × 7 = 49 条）；服务端硬编码 `'Untitled schedule'` / `'Untitled task'`；`ui/calendar.tsx` 未传 `locale`（用宿主 locale 而非 UI 语言） | `packages/shared/src/i18n/locales/*.json`；`calendar.ts:27`；`work-items.ts:38`；`ui/calendar.tsx:26-34` | 现有 3 个 i18n 门禁都查不出这些 |
| V6 | 空状态只有一行文案（无 CTA）；无图例；无"未排期"入口；`GRID_WIDTH=370` 固定不响应窄面板 | `GanttView.tsx:791-793, 118` | 设计提案 8 未实现 |
| V7 | 文档过期：`docs/process/univer-native-workbench-integration-plan.md:56` 仍称 gantt "明确无效、不注册路由"；`dto.ts:938-942`、`useCalendarEntries.ts:4-5` 与实现相反 | 见 1.1 | 会持续误导后续开发 |
| V8 | 工程缺口：Playground 白屏（mock 缺 `onSessionEvent`）、Playground 未注册甘特、无 jsx-a11y、`motion-verification.mjs` 的 `[role="tablist"]` 假设失效、`@svar-ui/react-grid` 是未声明的直接依赖（靠 hoisting） | 实测 + `mock-utils.ts`；`GanttView.tsx:3` | — |

---

## 3. 优化方案

### 阶段 0 — 正确性止血（1–2 人日，低风险，先做）

| 项 | 改动 | 验收 |
| --- | --- | --- |
| **0.1 统一时间轴区间语义** | 新增 `packages/shared/src/work-items/timeline.ts`：`toTimelineRange(item) → { start, endExclusive }`（**所有**有 `dueAt` 的行都 `+1 天`）、`fromTimelineRange(start, endExclusive) → { startAt, dueAt: −1 天 }`。`GanttView.tsx:463-476/487-509` 改用它，删除 `start===end` 特判。 | 单测：DST 日、跨月、跨年、单日、零长度；E2E：`barWidth / cellWidth === dueAt − startAt + 1` |
| **0.2 周序号** | `GanttView.tsx:107-110` 换成 `getISOWeek`（date-fns 已在依赖中）；`W` 前缀走 i18n。 | 单测遍历 2025–2028 全部周一 == ISO 周号（当前 53/156 错） |
| **0.3 日历时窗自适应 + 跨夜** | `CalendarView.tsx:51-63`：由"当日可见条目"推导 `hourStart=min(8, floor(最早开始))`、`hourEnd=max(20, ceil(最晚结束))`（上限 24）；`endTime <= time` 视为次日；越界条目夹到网格内并加"早/晚"分组标签；`SchedulePage` 时间输入补校验。 | E2E：07:00 / 22:00 / 23:00–01:00 条目的 `boundingBox` 全部落在 `[data-time-grid]` 内且不与全天条相交 |
| **0.4 保存失败可感知** | `SchedulePage` 在 `saved === null` 时 `toast.error`（sonner 已有）；字段级前置校验（空标题、`endDate < date`、同日 `endTime <= time`）；hook 返回的 `error`/`isLoading` 至少在视图内渲染为骨架/错误条。 | E2E：构造 `endTime < time` → 断言出现错误提示且页面不关闭 |
| **0.5 未排期可见** | 甘特图头部计数改为"已排期 N · 未排期 M"；新增"未排期"抽屉（复用 `entity-list`/`empty` 原语，列出 `!startAt && !dueAt` 的可见项并可跳转排期）；删除死代码 `unscheduledParents` + 死 i18n；或反之——若产品决定不做抽屉，则**删除**该提示以消除死代码。 | E2E：6 条 fixture（3 未排期）→ 抽屉中 3 条可见、计数一致、画面 bar 数与计数一致 |
| **0.6 日期归一** | 新增 `packages/shared/src/work-items/plan-date.ts`：`planDateKey()`（正则校验，复用 `workItemDateKey` 语义）、`planTimeOfDay()`（同时支持 `T` 与空格分隔、offset 按本地时区换算）、`isValidPlanValue()`。服务端 `calendar.ts:12-18` 与客户端 `parsePlanDate` 全部改为调用它；写入时拒绝非法格式。 | 单测：`2026-09-22T02:00:00Z`（Asia/Shanghai → 09-22 10:00）、`2026-09-22 14:00`（→ 14:00 定时）、`2026-9-2`（拒绝） |
| **0.7 文档纠偏** | 修正 `dto.ts:938-942`、`useCalendarEntries.ts:4-5` 注释（"条目即 Session 的规划投影"）；更新 `univer-native-workbench-integration-plan.md:56`。 | 评审即可 |
| **0.8 Playground 修复** | `mock-utils.ts` 补 `onSessionEvent`（及同类缺失 API）；`schedule-views.tsx` 注册 gantt 条目；修 `motion-verification.mjs:343` 的 tablist 假设。 | `bun run playground:dev` 打开后页面正常渲染且日历/甘特可选 |

### 阶段 1 — 交互补齐（3–5 人日）

1. **甘特图可写（I10）**：`readonly` 改为可写，但**只**接受 `start/end` 变更（`columns[].editor: false`、不注册 `onaddtask`/`ondelete`/右键菜单），变更经 `fromTimelineRange()` → `updateWorkItem(id, { startAt, dueAt })`；乐观更新 + 失败回滚 + toast；拖拽期间抑制 broadcast 触发的全量刷新（否则条会跳回）。
2. **日历 resize 重做（I2）**：`setPointerCapture` + 拖动即改本地状态（实时预览）+ `pointerup` 提交 + `pointercancel`/卸载回滚与监听清理；手柄改成可聚焦元素，支持 ↑/↓ 以 15 分钟为步长调整，并 `stopPropagation` 避免误开编辑器。
3. **拖拽质量（I1）**：`dragstart` 设置自定义拖影与 `dropEffect`；目标列 `dragover` 高亮；失败回滚来源位置并提示；键盘替代（条目菜单里的"改期到…"）。
4. **跨天呈现（I3）**：月视图用连续条（跨列绝对定位）+ 首尾圆角，周/日视图后续天用"续"样式而非"全天"。
5. **重叠布局（I4）**：按重叠连通分量做区间图着色（sweep line 求最大并发），替代 `index/count`；`entriesFor` 预分桶成 `Map<dayKey, Item[]>`（月视图从 42 次全表扫描降为 1 次）。
6. **状态与筛选（I5/I6）**：删除日历里写全局 atom 的 effect（改为本地派生查询）；把 `view/cursor/scale/横向滚动` 提升为按 surface 作用域的状态（atom/localStorage），`ProjectManagementSurface` 去掉 `key={state.view}` 改用状态恢复；`switchView` 不再强制回到今天（或仅在"今天不在可视范围"时回）。
7. **键盘与语义（I7/I8）**：条目改为 `<button>`（或 `role="button"` + `tabIndex` + Enter/Space）；周视图补操作入口；月网格补 `role="grid"/"gridcell"` 与 `aria-label={完整日期}`；`+N more` 改为打开当日弹层的按钮；分段控件换成共享 radiogroup 原语。

### 阶段 2 — 架构收敛（5–8 人日）

**目标：让两个投影共用一套数据、筛选与日期基础层。**

- **2.1 单一投影（方案 A，推荐）**：日历改为从 `useWorkItems()` 渲染（用 `planDateKey` + `queryWorkItems({ scheduled:'scheduled', dateRange })` 派生日历项），写操作仍走 `calendar:*`（保留其 `createSession`/`setSessionProjectId` 语义）。收益：日历立刻获得状态色/进度/里程碑；少一次全量拉取；筛选语义与看板/列表一致；删掉 `useCalendarEntries` 与 `CalendarEntry` 的重复模型。
  - 方案 B（后续）：统一写路径到 `workItems.UPDATE`，废弃 `calendar:*` 通道（需同步更新 `shared/__tests__/ipc-channels.test.ts:82` 的通道白名单）。
- **2.2 范围查询**：`calendar:list` / `workItems:list` 增加 `WorkItemQuery`（`dateRange` + `scheduled`）参数；渲染端按可视范围（月视图 ±1 月、甘特窗口）请求；`SessionManager` 侧按日期索引过滤，替换"全量 + 客户端过滤"。
- **2.3 广播收敛**：写操作只广播一次（去掉 handler 里的立即广播，统一交给 `broadcastPlanningChanged` 合并），并让 payload 携带受影响 id 以支持增量更新（当前 `SessionManager.ts:1810` 注释已把信号设计为"无 payload = 投影过期"）。
- **2.4 共享头部与切换器**：抽出 `SurfaceHeader`（统一高度/内边距/红绿灯补偿/筛选槽位/trailingAction/expandButton）与 `ProjectionSwitcher`（日历·列表·看板·甘特，radiogroup 原语），替换现在两套自绘头部与两个自绘分段控件；顺带修掉甘特图缺失的 `useCompensateForStoplight`（`GanttView.tsx:702`）。
- **2.5 甘特窗口策略**：保留"拟合到数据"作为默认，但增加"用户平移/缩放后不重置"（当前 `windowStart/windowEnd` 完全由 `dataRange` 派生，筛选一变即跳，`GanttView.tsx:431-455`），并补 `ctrl/⌘+滚轮` 缩放（库核心功能，免费）与"适应宽度"。

### 阶段 3 — 视觉与规范收敛（2–3 人日）

- **3.1 对比度**：依赖箭头 35% → 55%（实测可达 3.86:1 / 5.81:1）；日历 muted 文本 `/45` → `/60`、非本月日期 `/30` → `/45`；新增 token 对比度单测（对 `--foreground`/`--background` 组合断言 ≥3:1（图形）与 ≥4.5:1（正文））。
- **3.2 动效 token 化**：`150ms/120ms/ease` → `motion-interactive`/`--motion-duration-fast`/`--motion-ease-enter`；`active:scale-[0.998]` → `active:scale-[var(--motion-scale-pressed)]`；扩展已有 `scripts/check-transition-all.ts` 为"裸时长/裸曲线"扫描门禁。
- **3.3 甘特视觉补齐**：用 `highlightTime`（核心免费能力）实现周末底纹 + 今日线（避免依赖 PRO 的 vertical markers）；删除已被中和的 `--wx-gantt-*` 死变量；补图例（状态色/进度/汇总/里程碑/依赖）；空状态给 CTA（"去看板排期"/"新建任务"）。
- **3.4 i18n**：补齐 ja/de/es/hu/pl 的 `schedule.*`（或明确标记待翻译并加入翻译流程）；删除 49 条死键；服务端硬编码标题改为渲染层 `t()` 兜底；`ui/calendar.tsx` 传 `locale={getDateLocale()}`；为 `schedule.taskCount` 补 pl 的 `_few/_many`。
- **3.5 门禁**：引入 `eslint-plugin-jsx-a11y`（先在两个视图 + kanban 目录开启 `recommended`）；i18n 增加"死键"检查（exists→referenced）；Playground 注册表与 `PROJECT_MANAGEMENT_VIEWS` 做一致性断言。

### 阶段 4 — 能力增强（按产品优先级另议）

- 日历：议程/列表视图（第 4 种投影）、周数显示、拖拽框选创建、多日连续条、项目色（`projectId` 已在数据里，`utils/project-colors.ts` 已有调色板）、iCal 订阅/导出。
- 甘特：依赖编辑与关键路径（**关键路径属 SVAR PRO**，需评估采购或自研）、基线、资源视图、导出 PNG/PDF/Excel（库已提供导出配置，当前完全未接线）、里程碑泳道。
- 明确**不做**的建议：不引入第二个甘特库（现有库核心能力已覆盖大部分缺口）；不在阶段 0/1 引入 recurrence（日历重复规则涉及数据模型变更，收益/风险比不划算）。

---

## 4. 验收与门禁

### 4.1 E2E 清单（建议新增 `plans/calendar-gantt-verification.mjs`，沿用现有 Playwright 模式）

真源脚本已在本轮实测中跑通（Playground + Playwright + 对抗性 fixture），建议固化为仓库脚本，断言：

1. **甘特条宽**：`barWidth/cellWidth === dueAt − startAt + 1`（多日/单日/跨月三例）。
2. **周序号**：渲染出的 `W##` 与 `getISOWeek` 一致（含 2025-12-29、2027 年样例）。
3. **日历窗外**：07:00 / 22:00 / 跨夜条目的 bbox 均在 `[data-time-grid]` 内且不与 `[data-calendar-entry]`（全天区）相交。
4. **失败可感知**：`endTime<time` 保存 → 出现错误提示、页面不关闭、数据未变。
5. **未排期可见**：3 未排期 + 3 已排期 → 抽屉计数、头部计数、bar 数三者一致。
6. **状态保真**：看板设 status 筛选 → 进日历 → 回看板，筛选仍在；日历 day→week→board→week 后 cursor/scale 不丢。
7. **键盘**：仅用键盘可完成"打开周视图某条目 → 改期"。
8. **对比度**：对 `--wx-gantt-link-color` 等组合断言 ≥3:1。

### 4.2 需要同步更新的既有门禁

- `apps/electron/src/shared/__tests__/ipc-channels.test.ts:82`（若采纳阶段 2.1 方案 B）
- `plans/motion-verification.mjs:343`（tablist 假设）
- `scripts/check-i18n-coverage.ts`（增加死键检查）
- `playground/mock-utils.ts`（补 `onSessionEvent`，否则整个 Playground 白屏）

---

## 5. 附录

### 5.1 本轮实测的复现方式

```bash
# 1) 启动 Playground（本轮用 5199 端口，避免与开发端口冲突）
bun run vite dev --config apps/electron/vite.config.ts --port 5199 --strictPort
# 2) 因 mock 缺 onSessionEvent，需在注入脚本里补一个空实现，并预设选中组件：
#    localStorage['playground-selected-component'] = 'calendar-view'
# 3) 用 Playwright 覆盖 window.electronAPI.listCalendarEntries / listWorkItems 注入对抗性 fixture
# 4) 甘特图需要临时在 playground/registry/schedule-views.tsx 增加一个 entry（本轮已还原，仓库干净）
```

探针脚本与本轮产物（临时目录，未提交）：`/tmp/probe-views.mjs`、`/tmp/probe2.mjs`、`/tmp/probe3.mjs`、`/tmp/probe4.mjs`、`/tmp/view-probe-results.json`、`/tmp/view-probe2.json`、截图 `/tmp/view-shots/*.png`。

### 5.2 关键证据索引

| 主题 | 位置 |
| --- | --- |
| Session 唯一真源 / 两个投影 | `packages/server-core/src/handlers/rpc/calendar.ts:20-38,52,58-66`；`work-items.ts:35-56,100-110` |
| 甘特条区间语义 | `GanttView.tsx:124-146,463-509,569-612` |
| 周序号 | `GanttView.tsx:107-110` |
| 日历时窗 / 跨夜 | `CalendarView.tsx:51-63,355-471,477-614` |
| 日历写路径与静默失败 | `useCalendarEntries.ts:59-100`；`SchedulePage.tsx:75-91,157-166,182-196`；`SessionManager.ts:8598-8608` |
| 未排期死代码 | `GanttView.tsx:519-532,583-587,627,795-799` |
| 日期解析三套实现 | `calendar.ts:12-18`；`GanttView.tsx:124-128`；`work-items/query.ts:8-12` |
| 共享 atom 与筛选冲突 | `atoms/kanban.ts:19-34`；`useWorkItemViewState.ts:15-76`；`CalendarView.tsx:136-139`；`KanbanBoardContainer.tsx:93-96` |
| remount 与状态丢失 | `ProjectManagementSurface.tsx:66-78`；`CalendarView.tsx:140-142,297-301`；`GanttView.tsx:366,384` |
| 动效 token / 违规 | `packages/ui/src/styles/motion.css:7-19,80-124`；`plans/motion-specification.md:15,38-57`；`gantt-overrides.css:182,199,377` |
| a11y 缺口 | `CalendarView.tsx:342-349,521-603,623-628,724-728,794-818`；`GanttView.tsx:323-347,715-731` |
| 对比度 | `gantt-overrides.css:45-88`；`apps/electron/src/renderer/index.css:88-162,260-308` |
| i18n | `packages/shared/src/i18n/locales/{en,zh-Hans,ja,de,es,hu,pl}.json`；`scripts/check-i18n-coverage.ts:5-11` |
| Playground 白屏 | `playground/mock-utils.ts`（无 `onSessionEvent`）；`App.tsx:995`；`NavigationContext.tsx:1269`；`playground/registry/schedule-views.tsx:73-110` |

### 5.3 未验证 / 需产品决策

- SVAR 组件内部的键盘与读屏行为（库 bundle 内 0 个 `aria-*`、0 个键盘处理器，`react-grid` 组合层有部分 ARIA）——需人工或专门测试确认。
- `gantt-overrides.css:26-28` 的 400 行性能实测数字仅为注释，无可复现基准。
- ~~`@svar-ui/react-gantt` 包内 `productTrial: true` 的意图~~ → **已核实（见 `docs/process/gantt-library-research-2026-09-24.md` §4.3）**：该字段只是 SVAR 发布工具的标记（与 `productTag` 同级），**在运行时无任何消费者**；shipped bundle 中 `trial/license/watermark/expired` 命中数均为 0，且**没有任何 `fetch`/`XHR`/`axios` 调用**——既不能降级功能也无法联网回传。对我们的"完全离线"约束是个正面结论。
- 是否采购 SVAR PRO（关键路径/基线/资源视图/垂直标记）——影响阶段 4 的能力边界；另注意 PRO 不在公共 npm 上（见 §7.4 S4）。
- 日历是否要支持重复日程（recurrence）与外部日历订阅——数据模型层面的产品决策，同时也是 S1"修 vs 换"的判定条件之一。

---

## 6. 补充问题实测（用户二次反馈的三点）

> 全部为真实浏览器量测（Playground + Playwright），脚本 `/tmp/probe5.mjs`–`/tmp/probe12.mjs`，数据 `/tmp/probe5.json`–`/tmp/probe11.json`。

### 6.1 月视图：格子容量硬编码 3，且被压缩到不可读；"+N more" 完全不可交互

| 现象 | 实测数据 |
| --- | --- |
| 容量与空间无关 | 一天 9 条 → 只渲染 3 条 + `+6 more`，格子 84px 高，**仍余 10px 空白**；`MAX_TASKS_PER_CELL = 3`（`CalendarView.tsx:49,634`）是**常量**，代码里没有任何"按可用高度算容量"的逻辑。⚠️ 局限：Playground 的预览容器是固定高度（900 与 1500 视口下网格均为 538px），因此"更高的应用面板是否会显示更多"无法在 Playground 中实测；但从代码可证明**不会**（容量与空间无关），面板变高只会让那 3 条不再被压缩 |
| 三条被挤成 6px 细条 | 同日 9 条时 3 个 chip 各高 **6px**（正常 21px），文字 `textClipped: true`；同日 2 条时 chip 高 **21px**、不裁切。原因：`overflow-hidden` + flex 收缩（`:640`），背景色块被压成细线，标题完全不可读 |
| 网格行数固定 | `grid-rows-[auto_repeat(6,minmax(0,1fr))]` + 固定 42 格（`:623,629`）：格子高度只随面板高度分配，**不会因为"这天内容多"而变高**，也没有"议程视图"作为溢出出口 |
| "+N more" 是死标签 | 实测 `tag: span`、`tabIndex: -1`、`role: null`、`cursor: auto`、不在任何 `button` 内；`click()` 前后 dialog/popper 数量不变（0 → 0）。代码里它只是 `<span>`（`:724-728`），弹层只挂在日期数字按钮上 |
| 键盘不可达 | 月视图条目是 `div`（无 role/tabIndex），"+N more" 不可聚焦 → 溢出的条目**没有任何键盘或点击路径**可以查看 |

**结论**：这不是"只显示三条"的小限制，而是三重缺陷——容量不看空间（常量 3）、显示出来的三条会被压成色线、剩余条目无任何入口。

### 6.2 甘特图滚动：横向"不跟手"、日期表头与任务列各自为政

实测（Playground，60 行任务 + 一个远期任务）：

| 手势 | 结果 | 判定 |
| --- | --- | --- |
| 横向滚轮在**时间轴**上 | `chart.scrollLeft: 0 → 200` | ✅ 正常 |
| 横向滚轮在**左侧任务列**上 | `chart.scrollLeft: 0 → 0`（任务列自身也不动） | ❌ **手势被吞掉**：`.wx-table-container` 自带 `overflow-x: auto` 但没有可滚内容，事件不冒泡到时间轴 |
| 纵向滚轮在时间轴 / 任务列上 | 两者都 `gantt.scrollTop: 0 → 300` | ✅ 纵向一致 |
| 行对齐（左列标题 vs 右侧任务条，按 id 配对） | 14/14 行偏差恒为 −3px（条在行内的固有偏移） | ✅ 无错位（此前的"错位"猜想被证伪） |
| 纵向滚动时日期表头 | `scale.y` 始终不变（sticky） | ✅ 表头不会被滚走 |
| 横向滚到底 | 各档位 `blankRightOfLabelsInViewport = 0`（表头跟随滚动，无"滚出日期范围"） | ✅ 之前的"可滚出表头范围"未复现（是虚拟化造成的测量假象） |

**真正的结构问题**：一个甘特图里有**三个滚动容器**——`.wx-gantt`（纵向，覆盖两栏）、`.wx-table-container`（任务列，横向）、`.wx-chart`（时间轴，横向）。因此横向滚动**只认指针所在的那一栏**，在左栏操作完全无效；两个横向滚动条彼此独立，用户感知就是"左右滚动不跟随/不一致"。

**另一个实测到的可用性缺陷**：缩放到 `Year`（月格）档时，画布宽 402px ≈ 视口 399px（**无法横向滚动**），任务条被压成 **9–13px** 的细条（`Short A 13px`、`Mid B 9px`），标签不可读；`Month` 档时同一任务宽 168px、`Long C` 宽 4480px。即**缩放档位与"可读性/可操作性"没有联动**。

**顺带复现的确定性 bug**：季度档的周序号渲染为 `… W52, W53, W2, W3 …`——2026-12-28 是 W53，2027-01-04 应为 **W1**，实际显示 **W2**（与第 2 节 C2 的算法错误一致，此处是现场复现）。

### 6.3 视觉一致性：同一实体在三个投影里是三套语言

| 维度 | 看板 / 列表 | 甘特图 | 日历 | 证据 |
| --- | --- | --- | --- | --- |
| 头部高度 | `h-[42px]`，含红绿灯补偿 | `h-12`（实测 45px），**无红绿灯补偿** | `h-12`（实测 45px），有补偿 | `KanbanBoardContainer.tsx:581-585`；`GanttView.tsx:702`；`CalendarView.tsx:746-750` |
| 控件 | `Button`/`HeaderIconButton`/`SettingsSegmentedControl` 原语 | 自绘 `craft-control` 按钮 + 自绘分段控件（无滑动指示） | 自绘按钮 + 自绘分段控件（有 spring 指示器）；翻页用文本字形 `‹ ›` 而非 lucide 图标 | `CalendarView.tsx:768-791,794-818`；`GanttView.tsx:715-738` |
| 同一"任务/会话"的颜色语义 | 项目色（`TaskTile.tsx:199`）+ 状态徽章 | 状态色但**极淡**：条背景为 7% 混色（实测 `oklab(0.956 …)`≈近白）+ 3px 左侧色标 | **完全忽略项目色与状态**：所有条目同一个 `--accent` 22% 混色块，无状态徽章（实测 `usesProjectColor:false, hasStatusBadge:false`） | `CalendarView.tsx:70-72`；`gantt-overrides.css:369-393` |
| 行/卡密度 | 看板卡片自带内边距与元信息行 | 行高 48px（`CELL_HEIGHT`），条高 25px，字体 10–12px、字重 500/550/600/650 | 日视图条目 56px 高，内部混排 11px/12.5px/15px | `GanttView.tsx:113`；`gantt-overrides.css:247-328,414-427`；实测 chip |
| 空/加载状态 | `empty.tsx` / `entity-list-empty.tsx` 原语 | 一行居中文字 | 一行浅色文字 | `GanttView.tsx:784-794`；`CalendarView.tsx:375,463,676` |
| 提示 | `Tooltip` 原语 | 原生 `title=` | 原生 `title=` | `GanttView.tsx:241,324,334,343`；`CalendarView.tsx:526,595,716` |

**结论**：视觉不一致不是"配色差一点"，而是三件事——(1) 兄弟投影的**头部/控件体系不同源**（42 vs 45px、原语 vs 自绘、图标 vs 字形）；(2) 同一实体在日历里**丢失了项目色与状态**这两个全站通用的视觉语义；(3) 甘特条的颜色被压到 7% 混色，和看板卡片的色彩表达强度差一个量级。这三条都能在"替换库"或"继续自研"两条路径里被系统性解决——关键是**先定统一的时间视图设计规范，再决定用什么渲染它**。

---

## 7. 能否用更成熟的库直接替换？

> 事实核查方法：npm registry（本机可访问）+ 厂商官方定价/许可页 + 官方文档，全部标注来源；未核实的项目明确写"未验证"。
> 本轮 npm 版本核对时间：2026-09-24。

### 7.1 许可与"能否零成本随 Apache-2.0 应用分发"

| 库 | 最新版本（发布日期） | 真实许可 | 零成本分发？ | 关键限制 |
| --- | --- | --- | --- | --- |
| **@svar-ui/react-gantt**（现用） | 2.7.3（2026-09-09） | MIT（核心）/ PRO 商业 | ✅ | PRO $749/开发者（永久，1 开发者 1 项目）→[定价](https://svar.dev/react/gantt/pricing/) |
| **dhtmlx-gantt** | 10.0.3（2026-09-03） | **v10 起 MIT**（v9 及更早是 GPL v2） | ✅ | 见 7.2；PRO 才有关键路径/基线/资源/撤销 →[版本对比](https://docs.dhtmlx.com/gantt/guides/editions-comparison/) |
| **dhtmlx-scheduler**（日历） | 7.2.15（2026-08-17） | **GPL-2.0** | ❌ | 与自家 MIT 甘特图不成对，闭源分发需商业授权 |
| **@fullcalendar/react** | **7.1.0**（2026-09-05） | MIT（tarball 内 `LICENSE.md` 已核） | ✅ | ⚠️ v7 **重构**：`/daygrid`、`/timegrid`、`/interaction`、`/list`、`/multimonth`、`/locales/*`、`/themes/*` 都是 `@fullcalendar/react` 的**子路径导出**（本机已核 exports 表）；老的 `@fullcalendar/daygrid` 等独立包**冻结在 6.1.21**，**不要混装**。Premium（Timeline/资源视图）v7 起开源许可是 **AGPLv3** → 与 Apache-2.0 不兼容，$480 起也基本出局 |
| **@schedule-x/*** | react 4.1.0 / calendar 4.8.0 | MIT（但 `@schedule-x/calendar` 的 tarball **不含 LICENSE 文件**） | ⚠️ | **v4 把 drag-and-drop 与 resize 移入 Premium**（公开的 `@schedule-x/drag-and-drop`/`resize` 停在 3.7.3）→ 免费档恰好缺我们最需要的"拖拽改期"；Premium €479/年 或 €999 买断。且依赖 preact + signals + `temporal-polyfill` **精确锁 0.3.0**（与 FullCalendar 的 `^1.0.1` 互斥） |
| **@event-calendar/core**（vkurko） | 5.14.1（2026-09-22） | **MIT** | ✅ | 黑马：MIT 档**含 resource/timeline 视图**（无 Premium 分层）、35kb、CSS Grid 轻量 DOM、有 `dragConstraint` 回调（正好可做失败回滚）；代价是**没有官方 React 绑定**（需自写约 100 行封装）、`@event-calendar/core` **运行时依赖 Svelte 5**；键盘/虚拟化/变量换肤未验证 |
| **react-big-calendar** | 1.20.0（2026-06-01） | MIT（tarball 内 `LICENSE` 已核） | ⚠️ | 硬依赖里同时有 **moment、moment-timezone、luxon、dayjs、globalize、lodash**（等于塞进 4 个日期库），且其 date-fns localizer 写的是 **v2 的导入路径**；**没有自带时区方案**；必须全局引入样式表，与 Tailwind v4 preflight 和我们的变量换肤冲突 |
| **@bryntum/calendar · @bryntum/gantt** | 7.3.7（2026-09-24） | **商业**（⚠️ 公开 npm 上的包只是 **2.6KB 的 placeholder**，`postinstall` 打印"licensed version is hosted on the private Bryntum registry"，`license` 字段写的 MIT **无意义**；trial 包才是 Commercial） | ❌ | Calendar 从 **$680/开发者** 起（1–2 人档疑似约 $1000，未验证）；私有 registry 意味着 CI 需鉴权安装、无公开 tarball 可审计、运行时需要授权 key —— 与"完全离线 + Apache-2.0 分发"直接冲突 |
| **@progress/kendo-react-gantt** | 16.1.0（2026-09-23） | 商业（KendoReact Free 不含 Gantt） | ❌ | Gantt 属 premium（$649/开发者/年）；且**没有任务条拖拽/缩放、没有行虚拟化、没有基线/关键路径/资源视图、没有导出** → 直接出局 |
| **dhtmlx-scheduler**（日历） | 7.2.15（2026-08-17） | **GPL-2.0** | ❌ | README 明示非 GPL 项目需商业授权；Apache-2.0 与 GPLv2 不兼容 → $0 档出局（PRO 约 $999/开发者 起）；公开 npm 上没有官方 React 封装 |
| **vis-timeline** | 8.5.4（2026-08-12） | **(Apache-2.0 OR MIT)** | ⚠️ | **强制 peer 依赖 `moment ^2.24.0`**（`peerDependenciesMeta` 为空）→ 与"只用 date-fns 4"冲突；且无依赖箭头/汇总上卷/任务树，不是甘特图 |
| **frappe-gantt / gantt-task-react** | 1.2.2（2026-02-25）/ **0.3.9（2022-07-10，仓库已归档）** | MIT | ✅ | frappe：**无层级、无汇总、无里程碑**，依赖箭头不可编辑；gantt-task-react：4 年未发布、仓库归档 → 双双出局 |
| **wx-react-gantt** | 1.3.1 | **GPLv3** | ❌ | 与 Apache-2.0 分发不兼容 |

**第一个结论：没有任何一款库能"一个许可同时覆盖日历和甘特"且零成本。** DHTMLX 甘特图（v10 起 MIT）免费，但同厂日历 Scheduler 是 GPL-2.0（与 Apache-2.0 不兼容）；FullCalendar 有日历没甘特图，且其 Premium 的开源许可在 v7 从 GPLv3 改为 **AGPLv3**（与 Apache-2.0 不兼容，要免费用只能走 MIT 档）；Bryntum/Syncfusion/Kendo 两者都有但都要钱或私有 registry；vis-timeline 强制 moment 且不是甘特语义。

### 7.1b 日历侧候选裁决（与甘特侧同一套核查方法）

| 候选 | 裁决 | 关键事实 |
| --- | --- | --- |
| **FullCalendar v7 MIT 档** | ✅ **首选**（替换路线） | 免费档覆盖我们全部缺口，含 v7 **原生 IANA 时区**（不再需要 moment-timezone/luxon 插件，改为 `temporal-polyfill` peer）；Axe 可访问性 + 键盘可达的溢出弹层；158 个 locale；`firstDay` 控制周起始 |
| **@event-calendar/core（vkurko）5.14.1** | ✅ 次选（MIT） | **resource/timeline 在 MIT 档内**（无 Premium 分层）、35kb、`dragConstraint` 回调正好做失败回滚；代价是**无官方 React 绑定**（自写约 100 行封装）+ **运行时依赖 Svelte 5**；键盘/虚拟化/变量换肤未验证 |
| **react-big-calendar 1.20.0** | ⚠️ 仅作兜底 | MIT 且支持 React 19，但硬依赖 moment + moment-timezone + luxon + dayjs + globalize + lodash（4 个日期库），date-fns localizer 写的是 v2 导入路径，**无自带时区**，且必须全局引样式表（与 Tailwind v4 preflight 冲突） |
| **Schedule-X v4** | ❌ 免费档出局 | v4 把 **drag-and-drop 与 resize 移入 Premium**（公开包停在 3.7.3）——恰好缺我们最需要的"拖拽改期"；Premium €479/年 或 €999 买断 |
| **dhtmlx-scheduler 7.2.15** | ❌ 许可出局 | **GPL-2.0**：README 明示非 GPL 项目需商业授权，Apache-2.0 不兼容；PRO 约 $999/开发者 起 |
| **@bryntum/calendar 7.3.7** | ❌ 许可 + 分发出局 | 公开 npm 只是 **2.6KB placeholder**（`postinstall` 打印"licensed version is hosted on the private Bryntum registry"）；私有 registry = CI 鉴权安装、无可审计 tarball、运行时授权 key，与离线保证冲突 |


### 7.2 SVAR 的"只读"和"缺功能"大半是我们自己设的，不是许可限制

核对 SVAR 官方对比表（[svar.dev/react/gantt/pricing](https://svar.dev/react/gantt/pricing/)）后确认，**MIT 免费版已经包含**：

- 汇总任务与里程碑、任务依赖（4 种链接类型）、子任务层级
- **在图上拖拽移动 / 拖拽改期 / 拖拽改大小**
- **在图上编辑依赖与进度**、表格内联编辑、独立编辑表单
- 右键菜单与工具栏、排序、筛选、任务与依赖 tooltip
- 缩放（默认+自定义档位）、快捷键、图表/表格分区resize、紧凑模式
- **周末与节假日高亮**（`highlightTime`）、自定义条模板、只读模式、明暗主题、**CSS 变量换肤**、本地化

PRO（$749/开发者，永久）才有的：关键路径、基线、松弛、自动排期、工作日历、汇总自动上卷、撤销/重做、垂直标记（今日线）、资源视图与负载、分组、拆分任务、WBS、导出 PDF/PNG/Excel、MS Project 互操作。

→ 我们现在的 `readonly`（`GanttView.tsx:759`）、没有周末底纹（`highlightTime` 未配置）、没有今日线（PRO 能力，用 `highlightTime`+CSS 自绘即可，不必买）**都是自选动作**。第 6.2 节里唯一真正的 vendor 行为问题是"任务列自己带一个横向滚动容器、吞掉横向手势"——可以用约 10 行的 wheel 转发补丁解决（把左栏的 `deltaX` 转给 `.wx-chart`）。

### 7.3 DHTMLX Gantt 10 Community（MIT）值得单独评估

免费版即包含（[官方对比表](https://docs.dhtmlx.com/gantt/guides/editions-comparison/)）：树形视图、4 种依赖、丰富的拖拽、拖拽平移时间轴、**smart rendering（虚拟化）**、**键盘导航**、**无障碍支持**、**50+ 完整本地化（含 cn/jp/de/es/hu/pl，v10 全部补齐）**（[本地化文档](https://docs.dhtmlx.com/gantt/guides/localization/)）、7 套皮肤、CSP 合规、导出 PDF/PNG/Excel、MS Project 导入导出、时间区间高亮、只读模式、空状态页。**零运行时依赖**（vanilla JS）。

对我们的意义：**它把我们在 SVAR 上最缺的两块（键盘/ARIA、离线可视化导出）放在免费档里**，且全 6 个目标语言都有完整 locale。代价：
- 纯 vanilla JS，React 集成是自己写容器 + 生命周期（官方 React 集成文档是这种模式），换取的是不再有 React 类型谎言（对比现有 `Material` 的类型 cast，`GanttView.tsx:39-48`）。
- 体积与 CSS 体系是另一套（7 套皮肤），需要像现在一样写一层 token 映射；皮肤是 CSS 文件，可与 Tailwind v4 共存，但没有像 SVAR 那样成体系的 `--wx-*` 变量 API。
- 导出 PDF/PNG 的默认实现走**在线导出服务**，离线 Electron 必须改用本地导出模块（官方提供本地方案）——**这是替换前必须先验证的落地项**。
- 缺失（PRO $799–$5,999 才有）：关键路径、基线、自动排期、撤销/重做、资源、分组、动态加载、不支持"未排期任务"。

### 7.3b 另一条路：自研瘦时间轴（Path B / 方案 C）

我们已有的可复用资产：`GanttView.tsx` 里的层级展平、窗口过滤、依赖映射、缩放档位（`createZoomLevels` + `Intl`）、自定义两行任务单元格、条模板、today 滚动；依赖里已有 `@tanstack/react-table 9.2.4`、`@dnd-kit/core 6.3.1`、lucide-react、Tailwind v4 变量换肤、react-i18next、date-fns 4.4.0（**需补 `@tanstack/react-virtual`**）。

| 工作项 | 人日 |
| --- | --- |
| 双栏外壳：纵向滚动同步、表头分档吸顶、**单一横向滚动器**（从结构上消灭"左栏手势被吞"） | 2–3 |
| 行虚拟化（2k 行 @48px）、折叠展开、缩进、选中、键盘导航 + ARIA treegrid | 3–5 |
| 时间刻度：日/周/月/季/年档位、ISO 周号、Intl 本地化标签、缩放预设（逻辑可复用） | 2–3 |
| 条层：绝对定位、汇总条、里程碑、进度、状态色标、周末底纹、今日线 | 3–4 |
| 拖拽移动 + 拖拽改期（pointer capture + 吸附） | 4–6 |
| SVG 依赖箭头：锚点、正交路由、箭头、命中测试 | 4–6 |
| 依赖**编辑**（从条端点拖到目标 + FS 环检测） | 3–5 |
| 应用层撤销/重做 | 2–3 |
| 主题/一致性打磨、7 语言文案、E2E 与返工（约 30%） | 4–6 |
| **合计（达到现有功能 + 修复上述缺陷）** | **27–41（约 6–8 周/1 人）** |

不含 PNG/PDF/Excel/MS Project 导出（另计 1–2 / 2–3 / 2–3 / 3–5 人日）。**会失去**：久经考验的箭头路由与拖拽命中测试、内联编辑器/右键菜单/筛选排序 UI、已调好的万行级虚拟化、以及现有 1,343 行集成成果的一半左右。**会得到**：两行任务行、今日线、周末底纹、滚动手感与换肤的完全控制权，且不再与第三方 CSS 搏斗。

### 7.4 推荐路径（分阶段，先修我们自己的错，再换渲染层）

| 步骤 | 内容 | 工期 | 理由 |
| --- | --- | --- | --- |
| **S0（必做）** | 执行 §3 阶段 0 的全部正确性修复（区间语义、周序号、时窗、保存失败、未排期可见、日期归一） | 1–2 人日 | 这些是**我们的**bug：换任何库，`startAt/dueAt` 到"排他 end / 半开区间"的映射都要重写一遍；不先修，迁移会把 bug 一起搬过去 |
| **S1（日历：两条路，先花 1–2 天做判定性 spike）** | **先做 spike（1–2 人日）**：只验证两个真正有风险的点——(a) 跨天连续条（周列 lane 打包）；(b) 具名时区格式化（date-fns 4 + `Intl`，存 UTC 瞬时值）。**若 spike 通过 → 原地修**（把 6.1 的三类缺陷 + 键盘/时区补齐，约 4–6 人日）；**若不通过或产品还想要 year/agenda/multimonth、resource/timeline、重复日程、iCal → 换 FullCalendar v7 MIT 档** | spike 1–2；原地修 4–6；替换 5–8 | FullCalendar v7 免费档确实覆盖我们全部 9 个缺口（`eventSlicing` 跨天条 + 可用的 `+N more` 弹层、MIT 的 drag/resize、`slotMinTime/slotMaxTime` 修掉 08:00–20:00、v7 原生 IANA 时区（无需插件）、Axe 可访问性、**158 个 locale 含我们全部 6 种非英语语言**、`firstDay`）。但代价是：必须装 `temporal-polyfill`、**v7 不再自带 CSS 且 CSS 变量改名**、ESM-only、v6→v7 是 57 项 breaking 变更——对一个已经自己拥有 locale/明暗变量/离线保证的仓库，这些"集成面成本"很可能超过"原地修 6 个缺口"的成本。**判定规则就一条：日历要不要长成"日程产品"（year/agenda/资源/重复/iCal）——要，就换；不要，就修** |
| **S2（甘特：先自修，保留替换期权）** | 方案 A（**推荐**，3–8 人日）：保留 SVAR 核心，具体清单——(1) 适配层统一 `end = dueAt + 1 天`（或改用 `duration`）；(2) 自写 ISO 周号格式化（`getISOWeek`）；(3) 接上 `onChange` → `updateWorkItem`（乐观更新+回滚）——**现在"感觉只读"的真正原因是没有任何写回路径**，不只是 `readonly` 属性；(4) 任务列 wheel/drag 转发给时间轴滚动器；(5) 用库已经在设的 `--wx-gantt-holiday-*` 变量做周末底纹（`highlightTime`）；(6) 约 30 行绝对定位的今日线浮层。方案 B（备选，**15–30 人日**）：迁移 DHTMLX Gantt 10 Community。方案 C（自研，**27–41 人日**，见 7.3b） | A 3–8 / B 15–30 / C 27–41 人日 | 甘特的 8 个问题里 **7 个是我们自己造成的**（只读、周序号、少一天、窗口拟合、图例/空状态、样式失效、未排期不可见），换库只能解决 1 个（横向手势）+ 顺带拿到键盘/ARIA。先用最小代价把 7 个修掉 |
| **S3（统一视觉层）** | 抽出共享 `SurfaceHeader`（统一 42/48px、红绿灯补偿、筛选槽位）+ `ProjectionSwitcher`（radiogroup 原语，四投影共用）+ 时间视图 token 层（把库的 `--fc-*` / `--wx-gantt-*` / 皮肤变量映射到我们的 token） | 3–5 人日 | 这是第 6.3 节"三套语言"的根治手段，与选哪个库无关；无论 S1/S2 走哪条路都要做 |
| **S4（按需付费）** | 只有当产品确实要关键路径/基线/资源负载（SVAR PRO $749/开发者）或资源时间轴/打印（FullCalendar Premium $480 起）时才付费 | — | ⚠️ **SVAR PRO 不在公共 npm 上**（`@svar-ui/react-gantt-pro` 404）：一旦采购，离线可复现构建里就多了一个私有 registry / vendored tarball 依赖，这笔运维成本要一并计入 |

**明确不建议**：
- 不要为了"一个厂商"而买 Bryntum/Syncfusion/Kendo 全套——Bryntum 的日历/甘特公开 npm 包只是 placeholder（真实包在私有 registry），EUL 只覆盖"终端用户不付费"的应用，我们的产品形态很可能要求 OEM 报价；Syncfusion 虽在 <$1M 营收且 <5 开发者时可 $0，但一旦不满足就是 $4,795/年 起，而我们的需求（树+依赖+进度+拖拽）在 SVAR 免费档内已能满足。
- 不要用 GPL/AGPL 组件（wx-react-gantt GPLv3、dhtmlx-scheduler GPL-2.0、FullCalendar Premium 的开源档 AGPLv3）——它们与 Apache-2.0 不兼容，分发组合作品会改变整个应用的许可义务。
- 不要选 vis-timeline（强制 moment，且不是甘特语义）、已归档的 gantt-task-react（最后发布 2022-07-10）、或免费档已阉割拖拽/缩放的 Schedule-X v4。
- 不要在 S0 之前启动任何替换工作。
- 任何采纳都要补 `NOTICE` / 第三方清单条目（仓库已有 `NOTICE`，治理要求见 `docs/process/native-design-layer-architecture-plan.md` 的许可策略章节）。

### 7.5 待补（仍需一次 15 分钟级核实）

- **日历 spike 的两个判定项**（跨天 lane 打包、具名时区格式化）——这是 S1 走"修"还是"换"的唯一依据，优先级最高。
- DHTMLX 的 PDF/PNG 导出能否**完全离线**（本地模块）还是必须走在线服务——决定"方案 B 是否真的换来离线导出"。
- SVAR 的 ARIA/键盘保证（MIT 核心的键盘热键有，但读屏语义未验证）。
- Bryntum 的基线/关键路径/撤销/导出是否含在各档授权内（其功能页当时不可达）。
- KendoReact Gantt "无任务条拖拽/无虚拟化"的结论来自 API 面检查，未经厂商文档明示。
- Syncfusion 的里程碑/汇总上卷/表头吸顶同步/PNG 与 MS Project 导出未逐一核对。
- `@event-calendar/core` 的键盘可达性、虚拟化与 CSS 变量换肤（若把"日历要资源/时间轴视图"列为需求，它可能比 FullCalendar 更划算：MIT 档即含 resource/timeline，但要接受 Svelte 运行时而无 React 绑定）。
- KendoReact Gantt "无任务条拖拽/无虚拟化"的结论来自 API 面检查，未经厂商文档明示。
- Syncfusion 的里程碑/汇总上卷/表头吸顶同步/PNG 与 MS Project 导出未逐一核对。
- FullCalendar v7 是否会把 `daygrid/timegrid/interaction` 迁移到 7.x（若迁移，S1 的目标版本可随之升级）。
