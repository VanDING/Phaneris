# 日历 / 甘特图 —— 第三方库替换可行性评估

> 回答的问题：**当前自研的日历与基于 SVAR 的甘特图，是否存在更成熟的库可以整体替换，从而不必在现有视图上继续修补？**
>
> 配套文档：`docs/process/calendar-gantt-optimization-plan.md`（缺陷诊断与优化方案）
>
> 方法：npm registry 元数据核验（`dist-tags` / `license` / `peerDependencies` / `time`）＋ **解包读取真实 `LICENSE` 文件与源码** ＋ 厂商官方许可页/文档交叉验证 ＋ 本项目源码通读。本文所有版本号、日期、许可结论均为实测，未验证项明确标注。

---

## 0. 结论先行

**不对称结论：日历建议替换，甘特图建议暂不替换。**

| 视图 | 结论 | 理由（一句话） |
| --- | --- | --- |
| **日历** | ✅ **替换** —— 推荐 **FullCalendar**（MIT） | 日历的 P0/P1 缺陷**大量属于"网格引擎"级**（时窗、月格容量、溢出、重叠布局、跨天、键盘/语义），这些正是成熟库的职责；现在由我们自研的 843 行承担，替换后这类缺陷面直接消失。 |
| **甘特图** | ⛔ **暂不替换**，先修适配器 | 甘特图**全部 4 个 P0 缺陷都在我们自己的适配器里**（少一天、ISO 周号、未排期丢失、日期解析），SVAR 本身没有这些 bug。换库**不会消除**它们，只会换一套 API 重写一遍，并**丢掉**我们用 React 自定义单元格做出来的任务导航列（540 行 CSS 中的约 440 行是产品设计，不是库补丁）。 |

**一句话**：换库能消除的是"**引擎级**"缺陷；而甘特图目前的痛点是"**适配器级**"的。这两类必须分开算账，否则换库等于把一个可修的 bug 换成一次大面积重写。

---

## 1. 先纠正一个前提：待修缺陷分三类，只有一类能靠换库消除

把 `calendar-gantt-optimization-plan.md` 中的问题按"责任层"重新归档：

| 类别 | 含义 | 换库的效果 |
| --- | --- | --- |
| **A 引擎级** | 网格数学、时窗、溢出、重叠布局、跨天、虚拟化、滚动架构、键盘/a11y | ✅ **直接消除**（库的职责） |
| **B 适配器级** | 日期区间语义、投影计数、格式解析、筛选透传 | ⚠️ **不消除**，只是换地方重写；写错会原样重现 |
| **C 产品/设计级** | 保存失败提示、只读与否、视觉规范、i18n 文案、空状态 | ❌ **无关**，与库选择正交 |

### 1.1 日历的问题归档

| 编号 | 问题 | 类别 |
| --- | --- | --- |
| C3 | 08:00–20:00 硬编码，窗外条目画到网格外 | **A** |
| §6.1 | 月格容量硬编码 3、三条被压成 6px、"+N more" 是死标签、溢出无任何入口 | **A** |
| I2 | resize 无实时反馈、监听器不清理 | **A** |
| I3 | 跨天/跨夜语义缺失（多日定时条目第 2 天起被当全天） | **A** |
| I4 | 重叠列布局是 `index/count` 简单分组，链式重叠被压平，且 O(n²) | **A** |
| I7 | 无键盘路径；月视图条目是 `div`；`+N more` 不可聚焦 | **A** |
| I9 | 周导航用毫秒运算（DST 偏一天）、跨月周标题错月份 | **A** |
| I8 | 分段控件无 `role=radiogroup`、无 roving tabindex | **A/C**（库自带工具栏是 A；我们自绘控件是 C） |
| C6 | 日期解析三套实现、不做时区归一 | **B** |
| I1 | 拖拽无乐观更新/失败回滚 | **B** |
| I5 | 打开日历清空列表视图的 status+scheduled 筛选 | **B** |
| C4 | 保存静默失败 | **C** |
| V1–V6 | 对比度/动效/原语/i18n/空状态 | **C** |

**统计：日历的 A 类缺陷 7 条，占其 P0/P1 主体。** 这正是"成熟库 vs 自研"差距最大、也最不该自研的部分。

### 1.2 甘特图的问题归档

| 编号 | 问题 | 类别 |
| --- | --- | --- |
| **C1** | 多日任务条**短一天**（`GanttView.tsx:463-476` / `:487-509` 只对 `start===end` 补一天） | **B**（我们的 `bounds()` / `displayRangeOf()`） |
| **C2** | 周序号 `W##` 错（`GanttView.tsx:107-110` 的私有 `isoWeek()`） | **B**（我们的算法） |
| **C5** | 未排期事项静默消失 + `unscheduledParents` 死代码 | **B**（我们的投影） |
| **C6** | 日期解析三套实现 | **B** |
| §6.2 | **三个滚动容器**，横向滚动只认指针所在栏 | **A** ★ 已源码核实 |
| §6.2 | Year 档任务条被压成 9–13px | **A/B**（缩放策略） |
| V4 | 无周末底纹、无今日线 | **A**，但**换库也拿不到**（见 §3.2） |
| I11 | "Today" 依赖 `getState()._start` 私有状态 | **A**（库 API 缺口） |
| I10 | 甘特图完全只读 | **C** |
| I12 | 无搜索/状态/排序筛选 | **B** |
| V1–V3、V6 | 对比度/动效/原语/空状态 | **C** |

**统计：甘特图的 4 个 P0 全部是 B 类。** 换库不但不消除它们，还会在新适配器里重新引入同类风险。

### 1.3 B 类缺陷的证据：C1 的根因（已核实是适配器问题）

解包 `@svar-ui/gantt-store` 后确认其刻度生成逻辑：

```js
// gantt-store 内部：刻度单元生成
let k = C(h.unit, e, a)          // 从 start 所在单元起
for (; k < t;) { ... }           // 迭代到 end 所在单元之前（严格小于）
```

`end` 是**排他**边界。因此 `start=1/1, end=1/5` 只渲染 `1/1…1/4` = 4 格。要让"含 due 当天"的 5 天任务渲染 5 格，适配器必须传 `end = dueAt + 1 天`。

→ **C1 是我们的适配器漏了这一步，不是 SVAR 的 bug**（计划的 0.1 修复方向正确）。

---

## 2. 候选库全景（全部实测核验）

核验方式：`https://registry.npmjs.org/<pkg>` 读取 `dist-tags.latest` / `license` / `peerDependencies` / `time`，并对关键候选**下载 tarball 解包读 `LICENSE` 与源码**。

### 2.1 日历

| 库 | 最新版 | 发布 | 许可（实测） | React 19 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **`@fullcalendar/react`** | **7.1.0** | 2026-09-05 | **MIT**（标准插件全部 MIT） | ✅ `^17 \|\| ^18 \|\| ^19` | **STRONG** |
| `@fullcalendar/react`（6.x 线） | 6.1.21 | 2026-06-18 | MIT | ✅ | STRONG（保守选项） |
| `@svar-ui/react-calendar` | 2.7.1 | 2026-09-15 | **MIT** | ✅ `>=18` | VIABLE |
| `react-big-calendar` | 1.20.0 | 2026-06-01 | MIT | ✅ | VIABLE（无内置 DnD） |
| `@schedule-x/react` | 4.1.0 | 2026-01-21 | MIT | ✅ | VIABLE（重 peer 依赖） |
| `@aldabil/react-scheduler` | 3.1.2 | — | MIT | ✅ | **WEAK**（强制 MUI v7 + X date-pickers） |
| Toast UI Calendar | — | 停更 | MIT | ❌ | REJECT |
| DayPilot (`daypilot-pro-react`) | 0.0.0 | 2020-11-24 | 商业 | ❌ | **REJECT**（npm 空壳，废弃） |
| Mobiscroll（`@mobiscroll/react`） | 不在公共 npm | — | 商业 | — | **REJECT**（私有 registry） |
| Bryntum Calendar | 商业 | — | 商业 | — | **REJECT**（成本） |

**FullCalendar 许可的精确边界**（来自官方 <https://fullcalendar.io/license>）：

- **Standard（MIT，免费商用）**：非 Premium 插件 + `fullcalendar` bundle。即 `daygrid` / `timegrid` / `list` / `multimonth` / `interaction` / 各 theme / `locales`。
- **Premium（付费）**：仅资源类视图（`resourceTimeline` / `resourceTimeGrid` / `resourceDayGrid`）。非营利可免费（CC BY-NC-ND），AGPLv3 项目可免费（**v7 起由 GPLv3 改为 AGPLv3**）；**其他开源许可（含我们 Apache-2.0）不得内置，只能走"不硬编码 key + 由使用者自填"的路径**。
- → **我们不需要 Premium**：日/周/月、all-day、重叠、拖拽改期、resize、多日跨条、键盘、i18n 全在 MIT 范围内。

### 2.2 甘特图

| 库 | 最新版 | 发布 | 许可（实测） | React 19 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `@svar-ui/react-gantt`（**现用**） | 2.7.3 | 2026-09-09 | **MIT**（已解包 `license.txt` 确认） | ✅ `>=18` | 保留 |
| **`dhtmlx-gantt`（Community）** | **10.0.3** | 2026-09-03 | **MIT**（v10 起，已解包 `LICENSE.md` 确认） | 原生 JS | **VIABLE**（重大变化，见 §3.2） |
| `wx-react-gantt` | 1.3.1 | 2025-02-03 | **GPLv3** | ❌ `^18.3.1` | REJECT（已停更，SVAR 的 GPL 前身） |
| `gantt-task-react` | 0.3.9 | — | MIT | ❌ `^18.0.0` | **REJECT**（React 19 不兼容且停更） |
| `@bryntum/gantt` | 7.3.7 | 2026-09-24 | npm 标 MIT，**实为占位包** | — | **REJECT** |
| Frappe Gantt | — | — | MIT | — | REJECT（`src/` 中 subtask/parent/children/tree/collapse **0 命中**，无左侧网格、无 `.d.ts`） |
| `@syncfusion/ej2-react-gantt` | EJ2 v29 | — | 商业 + **有条件**社区许可 | ✅ 官方明确支持 | **WEAK** |
| `gantt-task-react` 各 fork（`@wamra`、`@rsagiev/…-19`） | — | — | MIT | 部分 | WEAK |

**体积（已实测，esbuild + react external）**：`@svar-ui/react-gantt` = **81 KB gzip JS + 5.2 KB gzip CSS**；DHTMLX Community = **176 KB gzip JS + 50 KB gzip CSS**。即换到 DHTMLX 约**增加 2.2× JS + 9.6× CSS**。

**两个重要纠正：**

1. **`@bryntum/gantt` 在公共 npm 上是"placeholder package"** —— 已解包确认 `description: "Bryntum Gantt placeholder package"`，且带 `postinstall: node postinstall.js`（用于凭据下载真实商业包）。npm 元数据里的 `"license": "MIT"` **没有意义**，不可据此判断可免费使用。
2. **`wx-react-gantt` 是 SVAR 的前身，GPLv3 且已停更** —— 说明当前选用 SVAR 的 MIT 分支是**正确的现代化选择**，不是技术债。

**另外两个商业选项的核实结论（补充，供完整性）：**

- **Bryntum Gantt**：公开 npm 上的 `@bryntum/gantt` 是**占位 stub**（约 13.8 KB、无库代码、带 `postinstall` 从私有 registry 拉取真实包）。其 React 包装 `@bryntum/gantt-react` 公开可见且**声明无 `peerDependencies`**（因此不阻塞 React 19），但真实组件需付费凭据。**价格未能核实**（官网为客户端渲染 SPA，无可提取文本）。→ 成本与许可双重不确定，REJECT。
- **Syncfusion EJ2 React Gantt**：**官方明确支持 React 19 与 Electron**（"Runs inside Electron's renderer process as a standard React component"），且**许可校验完全离线**（无需 phone-home，对本地优先产品友好）。这是它在技术上的真实优势。但**社区许可门槛严格**（已核实原文）：年营收 < 100 万美元 **且** 开发者 ≤ 5 人 **且** 员工 ≤ 10 人，**外加**历史外部融资累计不得超过 300 万美元；超出后为 **$959/开发者/年、最少 5 人 = $4,795/年**（仅 Gantt SDK）。
  → 对本项目（**Apache-2.0 开源、以二进制分发、下游使用者各自情况不同**）而言，社区许可的授予**无法传递给下游**，且"编译后的桌面二进制能否在社区许可下分发"官方仅为强暗示、**未经书面确认**。因此尽管技术上最贴合，**许可模型不适合作为开源项目的基础依赖**。判定 WEAK。

### 2.3 已解决的计划文档遗留问题：`productTrial: true`

计划文档 §5.3 把 `@svar-ui/react-gantt` 的 `productTrial: true` 列为"未验证 / 需产品决策"。**本次已解决：**

- 包内 `license.txt` = 标准 **MIT** 全文（Copyright (c) 2025 XB Software Sp. z o.o）。
- 官方许可页 <https://svar.dev/licenses/> 明确：

  > "Most SVAR components are free and open-source under MIT. … **Components with a PRO Edition** … Open-Source Edition **$0 (MIT)** … Gantt: Basic timeline / Dependencies / Drag & drop。Calendar: Day, Week, Month views / Drag-and-drop editing / Mobile support。"
  >
  > 对照表："Use in commercial projects：Open-Source ✅（MIT）"

- 全 bundle 检索 **0 处** trial/watermark/license-key/expiry 相关字符串，无功能或时间限制。

→ **`productTrial` 是过期的打包元数据残留，不构成试用或法律限制。** 此项可从风险清单移除。（`@svar-ui/react-calendar` 同样带该字段，同理。）

**门控机制已核实 —— SVAR 靠"打包隔离"而非运行时校验：**

- PRO 是**独立包**：`@svar-ui/trial-react-gantt@2.7.3`（实测许可字段 `SEE LICENSE IN license.txt`，专有许可 + 30 天期限 + 内建水印）；`@svar-ui/react-gantt-pro` → **HTTP 404**。
- 免费包 bundle 内 **0 处** 门控字符串、**0 次** `fetch`/XHR。
- 因此"我们是否在用试用版"这个问题，答案是**否**：免费包与试用包是两个不同的包，我们用的是前者。

### 2.4 已核实：SVAR 的本地化包覆盖不足 —— 但**当前不影响我们**

SVAR 的 locale 包实际覆盖面（已列出 `node_modules/@svar-ui/*` 内容）：

| 包 | 实际随包语言 |
| --- | --- |
| `gantt-locales@2.7.2` | **仅 `en` + `cn`** |
| `grid-locales` | **仅 `en` + `cn`** |
| `editor-locales` / `tasklist-locales` / `comments-locales` / `filter-locales` | 仅 `en` + `cn` + `de` |
| `core-locales` | 9 种（cn, de, en, es, fr, it, ja, pt, ru） |

对照我们需要的 en / zh-Hans / ja / de / es / hu / pl：**`hu` 与 `pl` 在 SVAR 生态内不存在**；`gantt-locales` 连 `ja`/`de`/`es` 都没有。

**但这在当前代码里不是缺陷，也不是我们欠的债**，原因已逐条核实：

1. `gantt-locales/locales/en.js` 的全部 **62 个键只覆盖编辑器 / 侧边表单 / 右键菜单 / 工具栏**（`Save`、`Delete`、`Predecessors`、`Cut/Copy/Paste`、`Indent/Outdent`、`Undo/Redo`、`New task`，以及 `Week`/`Q` 两个刻度词）。
2. 我们的 `Gantt` 传的是 `readonly`，**没有** editor / lightbox / 右键菜单 / toolbar / `columns[].editor`。
3. 所有会渲染的文本都由我们提供：`header.text={t('kanban.workItemTitle')}`、全部刻度 `format` 用 `Intl.DateTimeFormat(locale)`、单元格用自有 React 组件。
4. 全仓库**没有任何一处 import** `@svar-ui/*locales`（已 grep 确认为空）。

→ **结论：这 62 个键在当前配置下不会出现在 UI 上。** 它会在**计划阶段 1「让甘特图可写」（I10）启用 SVAR 内建编辑器/右键菜单时**才变成真实缺口 —— 届时 `ja/de/es` 需从 `core-locales` 补齐、**`hu/pl` 必须自行翻译**。这应作为阶段 1 的**前置成本**登记，而不是当前的 P0。

---

## 3. 日历：建议替换为 FullCalendar

### 3.1 为什么替换是划算的

**现状成本**：`CalendarView.tsx` 共 **843 行**，全部是自研网格实现——月格布局、时窗换算、重叠列、拖拽、resize、分段控件、分页、Popover、键盘，全部由我们维护。计划文档实测出的缺陷（C3、§6.1、I2、I3、I4、I7、I9）**全部落在这 843 行里**。

**替换后的职责转移**：

| 现在由我们实现 | 替换后 |
| --- | --- |
| `HOUR_START=8 / HOUR_END=20` 固定时窗、`hourTop()` 百分比定位 | 库的 timeGrid：按数据自适应、跨夜原生支持 |
| `MAX_TASKS_PER_CELL = 3` + 溢出 `span` | 库的 dayGrid：按可用高度计算容量 + 真实"+N more"弹层 |
| `overlapPosition()` O(n²) `index/count` | 库的 lane packing / 重叠分层 |
| `startResize` 手写 pointer 逻辑（无实时反馈、不清理） | `interaction` 插件内置 resize |
| 无键盘路径 / 无 grid 语义 | 库内置 a11y（我们保留自有原语的 a11y 责任） |
| `7*86_400_000` 周导航、周标题月份 | 库的日期导航与 `weekNumbers` |

**集成面已被核实为可行**（`https://fullcalendar.io/docs/react`）：

- ✅ **`eventContent` 可以直接返回 React JSX**（官方文档原文："When you're using the React implementation, it's possible to return React JSX nodes."）→ 现有条目的视觉与操作按钮可以完整保留。
- ✅ **`useCalendarController()` + `CalendarController` 支持完全自定义工具栏** → 我们可以**保留自有的头部/分段控件/项目筛选**，不被迫采用 FullCalendar 的 toolbar，从而不与 `SurfaceHeader` 统一计划冲突。
- ✅ **主题基于 CSS 自定义属性**（`--fc-classic-background` / `-foreground` / `-primary` / `-border` / `-muted` …，或 monarch 等主题 + `palettes/*.css`），官方提供 [color-palettes#dark-mode](https://fullcalendar.io/docs/color-palettes) → 与我们的 Tailwind v4 token 体系是同一种技术路线，映射成本低。
- ✅ `views={{ custom: CustomView }}` 支持自定义 React 视图组件（必要时可自建第 4 种投影）。

**改造成本低**：`ProjectManagementSurface.tsx:44` 是**唯一挂载点**，`useCalendarEntries` 数据层同时被 `SchedulePage`（编辑器）使用 —— **替换只动 `CalendarView.tsx` 一个文件，数据层与编辑器不动。**

### 3.2 版本选择：v7 优先，v6.1.21 为保守退路

| | v7.1.0 | v6.1.21 |
| --- | --- | --- |
| 发布 | 2026-09-05（v7.0.0 = 2026-06-19） | 2026-06-18 |
| 架构 | **Preact 重写**（`deps: preact`），基于 `@full-ui/headless-calendar` | 传统 Preact 渲染 |
| 包结构 | 单包多子路径导出（`@fullcalendar/react/daygrid` …） | 独立插件包（`@fullcalendar/daygrid` …） |
| peer 依赖 | 需额外安装 **`temporal-polyfill@^1.0.1`** | 不需要 |
| 主题 | CSS 变量 + 多套 theme/palette | 较弱的 CSS 变量 |
| 成熟度 | 约 3 个月，2 个 minor | 6.x 线多年，装机量最大 |

**建议 v7**：主题模型（CSS 变量 + palette + 官方暗色方案）与我们的 token 体系最契合，且是持续开发线。同时 `temporal-polyfill` 是小型可摇树包，成本可接受。若团队更保守，v6.1.21 API 面重合度高，切换代价小。

**选型前置 spike（1 人日以内，必须先做）**：
1. JSX `eventContent` 在暗色/亮色 token 下的渲染与 `overflow` 行为；
2. `useCalendarController` 驱动自有工具栏（保留项目筛选/搜索/分段控件）；
3. `temporal-polyfill` 与现有 `date-fns@4.4.0` 共存、以及 `YYYY-MM-DD` 纯日期不跨时区漂移；
4. 在 `apps/webui` 浏览器构建下正常工作（见 §5.1）。

### 3.3 备选：`@svar-ui/react-calendar`（同生态，但成熟度风险更大）

**优点**：与现用甘特图**同一厂商、同一 `--wx-*` CSS 变量约定、同一 locale 机制、同一 MIT 许可**，设计语言天然一致，学习成本最低。免费版即含 **Day/Week/Month 视图 + 拖拽编辑 + resize + 拖拽创建 + 多日历分组 + 自定义编辑表单 + 筛选**。

**必须知道的风险**：
- **Day/Week/Month 视图是 v2.6（2026-05-13）才发布的** —— 距今约 4 个月，作为"更成熟的库"证据不足。
- PRO 门槛：Agenda/Year 视图、Timeline、Resources、**重复日程、时区、导出、动态加载**（$599 起）。
- 与 FullCalendar 相比，社区规模、locale 覆盖、a11y 沉淀都明显更小。

**建议**：仅当"必须统一到 SVAR 一个厂商"是硬约束时才选它；否则选 FullCalendar。

### 3.4 明确不推荐

- **`@aldabil/react-scheduler`**：强制 `@mui/material@>=7` + `@mui/icons-material` + `@mui/x-date-pickers` —— 会把整套 MUI 引入一个 Tailwind v4 + Radix 的代码库，主题体系直接冲突。
- **DayPilot / Mobiscroll / Bryntum Calendar**：商业许可，与 Apache-2.0 开源项目定位冲突。
- **Toast UI Calendar**：已停更。

---

## 4. 甘特图：建议暂不替换

### 4.1 现有 SVAR 的真实缺陷（只有 2 条是引擎级）

**已源码核实的引擎级缺陷 —— 三滚动容器**（`@svar-ui/react-gantt/dist/index.css`）：

```css
.wx-gantt            { overflow-y: auto; overflow-x: hidden; }  /* 纵向，跨两栏 */
.wx-table-container  { overflow-x: auto; overflow-y: hidden; }  /* 任务列：横向滚动容器 ① */
.wx-chart            { overflow-x: auto; overflow-y: hidden; }  /* 时间轴：横向滚动容器 ② */
```

→ 计划文档 §6.2 的实测结论（"在左侧任务列横向滚动完全无效、两个横向滚动条彼此独立"）**是库的架构问题，适配器无法修复**。这条确实构成换库的理由。

**第二条**：`goToToday` 必须读 `getState()._start` / `_scales` 私有状态并 `querySelector('.wx-area')`（`GanttView.tsx:680-698`）—— 库没有公开滚动 API，升级即静默失效。

**同时核实（重要）**：`gantt-store` 的 `init()` 把下列能力默认置为关闭，即**免费版被 PRO 门控**：
`markers`（今日线）、`baselines`、`unscheduledTasks`、`criticalPath`、`splitTasks`、`resources`、`groupBy`、`wbs`、`undo`。

### 4.2 DHTMLX Gantt Community（v10 起 MIT）—— 真实机会与真实代价

**这是一个值得记录的重大变化**：DHTMLX Gantt 在 **v10（`10.0.0` 发布于 2026-06-11）由 GPLv2 改为 MIT**（已解包 `LICENSE.md` 确认，Copyright (c) 2026 XB Software；官方文档亦确认 "Starting from DHTMLX Gantt v10, the free edition is the Community edition distributed under the MIT license"）。**DHTMLX 与 SVAR 同属 XB Software**（两家包的版权行分别为 `XB Software` 与 `XB Software Sp. z o.o`，SVAR 许可页落款为华沙）。

> 注：v9.0.0（2024-10-17）及更早仍是 GPLv2 —— 所以这条变化**很新**，网上多数"DHTMLX Gantt 是 GPL，不能用于闭源/商业项目"的说法已过期。

**Community（MIT）已含**：任务网格/列/树/行内编辑、缩放时间轴、**项目汇总任务与里程碑**、**四种依赖类型 + lag**、**拖拽改期 + 条 resize**、进度、lightbox 编辑器、模板、智能渲染（虚拟化）、**32 个 locale**、**WAI-ARIA 无障碍**、键盘导航、tooltip、全屏、拖拽创建依赖、筛选/排序、**导出 PDF/PNG/Excel/iCal/MS Project**、皮肤体系。

**但必须同时看到代价 —— 这些让"换库 = 少修补"不成立**：

| 代价 | 说明 |
| --- | --- |
| **没有官方 React 组件** | README 明确："The PRO edition provides ready-made components (ReactGantt…)；the Community Edition integrates via the standard wrapper patterns"。`@dhx/react-gantt` **在 npm 上不存在**（已实测 NOT FOUND）→ 需自写命令式包装（ref/生命周期/destroy，约 200–400 行）。 |
| **自定义单元格退化为 HTML 字符串** | DHTMLX 用 `templates` 返回 HTML 字符串；我们现在用 **React 组件**实现任务导航列（`GanttTaskTitleCell`、`TimelineBar`）。`gantt-overrides.css` 540 行中约 **440 行是这套产品的设计**（状态徽章、日期、子项计数、hover、菜单），换库后要改写成字符串模板或 portal —— 这是**设计资产的降级**。 |
| **今日线仍是 PRO** | "Timeline markers / today line" 在 DHTMLX 的 Community/PRO 对照表里是 ❌/✓ —— **换库也拿不到 V4 想要的今日线**（SVAR 的 `markers` 同样 PRO）。 |
| **未排期任务仍是 PRO** | "Unscheduled tasks & new-task placeholder" = PRO。计划 0.5 的"未排期抽屉"仍需自建（这点两个库一样）。 |
| **关键路径 / 基线 / 自动排程 / 资源 / 分组 / 撤销 / 多选拖拽 全是 PRO** | 与 SVAR 的 PRO 清单**同构**。所以"功能更全"并不成立。 |
| **导出走 DHTMLX 在线服务** | "Export … via the DHTMLX online export service" —— 对**本地优先 + 离线 + 无云依赖**的产品是硬伤，且 `apps/webui` 也一样受影响。这条实际上**抵消了 DHTMLX 的主要加分项**。 |
| **主题需重做** | DHTMLX 有 ~180 个 CSS 变量（多于 SVAR 的 85 个）与 dark/contrast 皮肤，但默认观感是 DHTMLX 风格，540 行覆盖 CSS 需按新选择器重写。 |
| **类型定义含 PRO 方法** | 官方 README 自述："`codebase/dhtmlxgantt.d.ts` describes the full product API, so it lists some PRO-only methods that are not present in this edition" → **类型能过、运行时报错**，是真实的工程陷阱。 |
| **字体外链** | 随包 CSS 含指向 `fonts.gstatic.com` 的 Inter `@font-face` —— 离线/内网环境下产生无效请求（软性离线问题，需显式覆盖）。 |

**净评估**：DHTMLX Community 相对 SVAR 的**真实增益**只有三项 ——
① **单一滚动轴**（解决 §6.2），② **内置 a11y/键盘导航**，③ **32 locale + 拖拽创建依赖**。
**真实损失** —— React 单元格模型、已设计的任务导航列、**体积增至 2.2× JS / 9.6× CSS**、以及一次全量重写（803 行适配器 + 540 行 CSS）。

**收益/代价比不足以支撑当前替换。**

### 4.3 关键发现：这些缺口是**全行业**的，不是 SVAR 的问题

把所有免费候选横向摆开后，一个决定性事实浮现：**没有任何免费甘特库提供今日线、关键路径、基线与导出。**

| 能力 | SVAR 免费 | DHTMLX 免费 | frappe | gantt-task-react | jaeungkim | bimetal |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| 层级 + 汇总 roll-up | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| 左侧列表网格 | ✅ | ✅ | ❌ | ✅ | ✅ | 自建 |
| 类型化依赖 | ✅ | ✅（4 种） | ⚠️ 1 种 | ✅ | ✅ | ✅ |
| 里程碑 / 进度 | ✅ | ✅ | ❌ / ✅ | ✅ | ✅ | ✅ |
| 缩放 day→year | ✅（自定义） | ✅ | ⚠️ 无季度 | ⚠️ 无季度 | ✅ | ✅ |
| 虚拟化 | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| 拖拽移动 / resize | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **今日线 / 垂直标记** | ❌ PRO | ❌ PRO | ⚠️ 仅按钮 | ❌ | ✅ | ✅ |
| **关键路径** | ❌ PRO | ❌ PRO | ❌ | ❌ | ❌ | ❌ |
| **基线** | ❌ PRO | ❌ PRO | ❌ | ❌ | ❌ | ❌ |
| **导出** | ❌ PRO | ❌ 云服务 | ❌ | ❌ | ❌ | ❌ |
| TypeScript | ✅ | ✅（有陷阱） | ❌ | ✅ | ✅ | ✅ |
| CSS 变量主题 + 暗色 | ✅ | ✅ | ✅ | ⚠️ props | ✅ | ✅ |
| React 19 | ✅ **实机验证** | ➖ | ➖ | ❌ | ✅ | ✅ |
| 许可 | ✅ MIT | ✅ MIT | ✅ MIT | ✅ MIT | ✅ MIT | ✅ **Apache-2.0** |

→ **SVAR 免费版的能力边界与同类免费库完全一致。** 因此计划 §3.4 提出的"关键路径/基线/今日线"缺口，**换库解决不了，只能采购 PRO 或自研**。这条把"甘特图换库"的收益进一步压到只剩"单一滚动轴 + a11y"。

**同时排除"自研 headless"路线**（TanStack Table + Virtual + 自绘 SVG）：那意味着自行承担 5 件公认困难的工作 —— ① 层级化左侧表格（"不是普通表格"：层级行、resize/reorder、校验、键盘导航）；② 工作日/假日感知的时间轴数学；③ 在拖拽/缩放/虚拟滚动/折叠下都不崩的依赖连线几何；④ 编辑事务模型（改了什么、是否允许、依赖项是否联动、汇总是否 roll-up、历史是否记录）；⑤ 虚拟化与滚动同步。**这正是 843 行日历已经证明过的代价 —— 不要在甘特图上重演。**

### 4.4 生态内其他新入场者（一并核实，均不改变结论）

- `@jaeungkim/gantt-chart` 1.5.1 —— MIT、显式 React 19 peer、含层级 + 虚拟化 + ARIA treegrid + CSS 变量，依赖仅 dayjs。但**约 52 周下载 / 17 stars / bus factor = 1**，不可作为基础依赖。
- `@bimetal/gantt-react-components` + `gantt-headless` 0.37.0 —— **Apache-2.0（许可最匹配）**，但 0.x、约 200 周下载、headless（UI 全部自建 → 等于回到自研）。
- **不存在 TanStack Gantt**（已核对 tanstack.com 全量产品列表）。
- `gantt-schedule-timeline-calendar` 非宽松许可；`gantt-elastic` 已归档且为 Vue 2。

### 4.5 建议动作

1. **先修 4 个 P0（全是适配器级，成本极低）**：
   - C1：引入共享 `timeline.ts`，**所有**有 `dueAt` 的行 `end = dueAt + 1 天`（删除 `start===end` 特判）；
   - C2：`isoWeek()` → `date-fns` 的 `getISOWeek`（已是依赖，`date-fns@4.4.0`）；
   - C5：头部计数改为"已排期 N · 未排期 M" + 未排期抽屉，或删除死代码；
   - C6：统一 `plan-date.ts`，服务端 `calendar.ts:12-18` 与客户端 `parsePlanDate` 共用。
2. **顺手拿两个免费能力**：SVAR 的 `calendar` 配置会启用 `highlightTime` → **周末底纹免费可得**（计划 V4 的一部分），成本几乎为零。
2.1. **两条不得回退的既有约束**（修适配器时极易误删，均须保留）：
   - `gantt-overrides.css` 的**虚拟化高度链**规则 `.phaneris-gantt .wx-material-theme { height: 100%; min-height: 0; overflow: hidden; }` —— 仓库注释已记录实测：缺失时 400 行模型产生 ~3.7k DOM 节点，存在时 ~340 个。删掉它不会报错，只会静默失去虚拟化。
   - `GanttView.tsx` 中 `Material` 的**类型别名**（`ThemeProvider`）—— 已发布 `.d.ts` 错误地把 `children` 声明为 `ReactNode`，而运行时是 `children()` 调用；别名是为了让类型检查如实反映契约。
3. **今日线做产品决策**：SVAR 与 DHTMLX 都把它放在 PRO。若不采购，就用"Today 按钮 + 自绘 overlay 竖线"实现（自绘即可绕过门控），并把 `goToToday` 的私有状态依赖替换为 `scroll` 事件 + 公开 API 的降级路径。
4. **明确复审触发条件**（见 §6）：只有当"§6.2 的双横向滚动条在适配器修完后仍被判定为不可接受"**且**"团队接受用 HTML 模板重写任务导航列"时，才启动 DHTMLX 迁移。

---

## 5. 不论选哪个库都要付的集成税

### 5.1 必须浏览器可用（不是 Electron 专属）

`apps/webui/vite.config.ts:43` 把 `@` 别名指向 **Electron renderer**：

```ts
// Reuse the Electron renderer's components, hooks, pages, etc.
'@': resolve(__dirname, '../electron/src/renderer'),
```

→ `CalendarView` / `GanttView` **同时进入浏览器构建**（`apps/webui/dist`）。因此：

- 库必须**纯前端、可离线**，不得依赖 Electron/Node API；
- **不得依赖云端服务**（这一条直接否定了 DHTMLX 导出的主要卖点）；
- 体积影响的是**网页端首屏**。实测 `apps/webui/dist/assets/main-*.js` 已达 **2.62 MB**（未压缩）、`dist` 71 MB —— 相对这个量级，一个 100–300 KB 的日历库**不是约束**；且两个视图按路由切分，不计入 `scripts/bundle-report.ts` 监控的 initial renderer graph。

### 5.2 其余共同项

| 项 | 要求 |
| --- | --- |
| i18n | 7 语言（en / zh-Hans / ja / de / es / hu / pl）。FullCalendar `locales-all` 覆盖。**甘特侧见 §2.4**：SVAR 的 locale 包缺 `hu`/`pl`，但当前配置不渲染库内文案，因此**不是当前缺口**，而是"阶段 1 启用内建编辑器"的前置成本。另注意 `ja/de/es/hu/pl` 的 `schedule.*` 目前**值为英文**（计划 V5），换库不会自动修好。 |
| 主题 | Tailwind v4 token + `.dark` 类切换。FullCalendar 的 CSS 变量模型可直接映射；DHTMLX 需重写覆盖层。 |
| 动效 | 须走 `--motion-*` token 与 reduce-motion（计划 V2）。库自带动效不受我们 token 控制 → 需要显式覆盖或在 spike 中验证。 |
| 测试门禁 | `plans/motion-verification.mjs:343` 现有的 `[role="tablist"]` 假设**已经失效**；换库后日历分段控件与工具栏结构会变，**该脚本必须同步修正**，否则继续静默退化为 `document.body` 作用域。 |
| 日期语义 | 无论用哪个库，都要先有 §4.3-1 的共享 `plan-date.ts`。**这是换库的前置条件，不是替代品** —— 否则 `2026-9-2` 这类值在新库上同样出问题。 |

---

## 6. 决策建议与工作量

### 6.1 建议路线

| 阶段 | 动作 | 工程量 | 风险 |
| --- | --- | --- | --- |
| **P0（立刻）** | 修甘特图 4 个适配器 P0（C1/C2/C5/C6）+ 统一 `plan-date.ts` / `timeline.ts` | 1–2 人日 | 低 |
| **P1** | 日历替换 **spike**（§3.2 的 4 项验证，产出可运行 PoC） | ≤1 人日 | 低 |
| **P2** | 日历迁移到 FullCalendar：`CalendarView.tsx` 重写为 ~250–400 行适配器 + token 映射；保留自有头部/筛选/编辑器；删除月格/重叠/resize/时窗自研代码 | 3–5 人日 | 中（可控） |
| **P3** | 同步修正 `motion-verification.mjs`、Playground 注册表、i18n 键清理 | 1 人日 | 低 |
| **P4（条件触发）** | 甘特图迁移 DHTMLX —— **仅当 §6.2 复审触发** | 8–12 人日 | **高** |

### 6.2 甘特图换库的复审触发条件（建议写入决策记录）

**同时满足以下全部条件时**，才启动 DHTMLX Community 迁移：

1. C1/C2/C5/C6 修复上线并验证通过（确认剩余痛点确实只剩引擎级）；
2. §6.2 的双横向滚动条在真实用户路径上仍被判定为**不可接受**（需实测反馈，而非代码推断）；
3. 团队接受**用 HTML 字符串模板重写任务导航列**（放弃 React 自定义单元格）；
4. 明确**不需要**导出（或接受导出走在线服务）、不需要关键路径/基线/资源视图（均为 PRO）；
5. 结论写入本文档的后续修订，并同步 `docs/process/gantt-view-design-proposals.html`。

### 6.3 与现有计划文档的差异

| 计划文档原文 | 本文结论 |
| --- | --- |
| §3.4「不引入第二个甘特库（现有库核心能力已覆盖大部分缺口）」 | **维持结论**，但理由更新：DHTMLX Community 自 v10 起为 MIT，**不再是许可陷阱**；不换的理由是**功能清单与 SVAR 同构 + React 单元格模型损失 + 需全量重写**，而非"库不够成熟"。 |
| §5.3「`productTrial: true` 的意图……未验证」 | **已解决**：过期打包元数据。厂商许可页 + 包内 MIT 全文 + bundle 内 0 处门控代码，三者一致。可从风险清单移除。 |
| §5.3「是否采购 SVAR PRO（关键路径/基线/资源视图/垂直标记）」 | **补充事实**：DHTMLX Community 同样把这些放在 PRO，且**今日线/未排期任务也是 PRO**。即"换库"不能替代"采购 PRO"来解决这些。若不需要这些能力，两个库的免费版**能力等价**。 |
| 未提及日历候选库 | 新增：**FullCalendar MIT 范围核实**（Standard 全含所需能力，无需 Premium）、v7/v6 双选项、`eventContent` 支持 React JSX、`useCalendarController` 支持保留自有工具栏。 |

---

## 7. 需要产品决策的点

1. **日历是否接受"不再完全自绘网格"** —— 采用 FullCalendar 后，月格/时窗的精确像素观感由库决定（可通过 CSS 变量与 `eventContent` 收敛到接近现状，但不会逐像素一致）。这是替换的主要可见代价。
2. **甘特图是否要"今日线"与"未排期任务常驻显示"** —— 两者在 SVAR 与 DHTMLX 都是 PRO。若不采购，需接受"自绘 overlay"或不做。
3. **是否统一到单一厂商（SVAR）** —— 若"设计语言一致性 + 单一许可来源"权重极高，日历可选 `@svar-ui/react-calendar`，但需接受其 Day/Week/Month 仅 4 个月成熟度。
4. **是否保留甘特图只读**（计划 I10）—— 决定是否值得为"可写甘特"投入，以及是否会影响库选择（DHTMLX Community 的拖拽/resize 免费可用）。
5. **`apps/webui` 是否长期作为一等交付物** —— 若是，则应把"离线可用、无云服务依赖"写成库选型的硬性准入条件（本评估已据此排除 DHTMLX 导出的加分项）。

---

## 附录 A：核验命令与证据索引

```bash
# 许可 / 版本 / peer 依赖（实测）
curl -s https://registry.npmjs.org/<url-encoded-pkg> | python3 -c "
import json,sys; d=json.load(sys.stdin); l=d['dist-tags']['latest']
print(l, d.get('license'), d['time'][l], d['versions'][l].get('peerDependencies'))"

# 解包读真实 LICENSE（本轮实际执行）
curl -s <dist.tarball> -o p.tgz && tar xzf p.tgz -C p && cat p/package/LICENSE.md
```

| 主题 | 证据 |
| --- | --- |
| SVAR Gantt 许可为 MIT 全文 | `node_modules/@svar-ui/react-gantt/license.txt` |
| `productTrial` 仅存在于 `react-gantt` | `grep -r productTrial node_modules/@svar-ui/*/package.json` |
| SVAR 免费/PRO 能力边界 | <https://svar.dev/licenses/> |
| SVAR 三滚动容器 | `node_modules/@svar-ui/react-gantt/dist/index.css`（`.wx-gantt` / `.wx-table-container` / `.wx-chart`） |
| SVAR `end` 排他语义 | `node_modules/@svar-ui/gantt-store/dist/index.js` 刻度生成 `for(;k<t;)` |
| SVAR PRO 门控默认值 | 同上 `init()`：`t.unscheduledTasks=!1, t.baselines=!1, t.markers=[], t.criticalPath=null, t.splitTasks=!1, t.resources=null, t.groupBy=null, t.wbs=null, t.undo=!1` |
| DHTMLX Gantt v10 = MIT | 包内 `LICENSE.md`；<https://docs.dhtmlx.com/gantt/guides/editions-comparison/>；<https://dhtmlx.com/blog/dhtmlx-gantt-licensing-options-explained-gpl-mit-community-pro-editions/> |
| DHTMLX Community vs PRO 清单 | <https://docs.dhtmlx.com/gantt/guides/editions-comparison/> |
| DHTMLX 无官方 React 组件（Community） | 包内 `README.md`；`@dhx/react-gantt` 实测 NOT FOUND |
| FullCalendar 许可边界 | <https://fullcalendar.io/license> |
| FullCalendar React 支持 JSX 内容 / 自定义工具栏 | <https://fullcalendar.io/docs/react> |
| FullCalendar v7 包结构与 peer 依赖 | `fullcalendar@7.1.0` / `@fullcalendar/react@7.1.0` tarball 解包 |
| Bryntum 为占位包 | `@bryntum/gantt@7.3.7` 包内 `package.json`（`description: "…placeholder package"`、`postinstall`） |
| `wx-react-gantt` GPLv3 停更 | npm registry：`1.3.1`、`GPLv3`、2025-02-03、`peer react ^18.3.1` |
| webui 复用 renderer | `apps/webui/vite.config.ts:43` |
| 唯一挂载点 | `apps/electron/src/renderer/components/projects/ProjectManagementSurface.tsx:44,47` |

## 附录 B：未验证项

**方法学限制（影响所有候选库结论的强度，务必知悉）：**

- **除 SVAR 外，所有"React 19 ✅"都只是 `peerDependencies` 的语义化版本读取，不是实际安装验证。** SVAR 是唯一在本仓库**真实运行于 React 19.3.0** 的候选。FullCalendar / DHTMLX / Syncfusion 的 React 19 兼容性均未实机验证 —— 这正是 §3.2 要求先做 spike 的原因。
- **价格均无法核实**：Bryntum 与 DHTMLX 商城为客户端渲染 SPA，无可提取文本（约 12 个 URL 变体、Wayback、文本代理均失败）。本评估因此**未引用任何第三方聚合报价**，只使用厂商文档中可提取的条款（如 Syncfusion 的 $959/人/年、5 人起）。

**技术性未验证项：**

- FullCalendar v7 在 Electron + Tailwind v4 token 体系下的**逐项视觉收敛程度**（需 §3.2 的 spike 实测）。
- FullCalendar v7 与 `apps/webui` 浏览器构建的兼容性（`temporal-polyfill` 在目标 Chromium/WebView 下的行为）。
- SVAR React Calendar 免费版的**拖拽/resize 实际交互质量**（官方页面与许可页陈述一致，但未做浏览器实测）。
- DHTMLX Community 的 `templates` 是否能通过 portal 承载 React 组件（若能，§4.2 的"自定义单元格降级"代价可大幅降低 —— **这会实质性改变甘特图的结论，建议在 P4 触发前先做 30 分钟可行性验证**）。
- DHTMLX 的**二进制再分发权**与各档位的开发者/项目数限制（官方页面未明确，涉及法务确认）。
- Syncfusion 社区许可是否允许**分发编译后的 Electron 二进制**（官方文档仅为强暗示，需书面确认）。
- Bryntum 试用期长度；Bryntum / Syncfusion 的**随包 locale 数量**与文档化体积。
- SVAR 试用版水印的**实际观感**（未渲染试用包验证；我们用的是免费包，不受影响）。
