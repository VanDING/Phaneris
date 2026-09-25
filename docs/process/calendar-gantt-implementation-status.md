# 日历 / 甘特图实施状态

> 配套文档：`calendar-gantt-library-replacement-assessment.md`（选型与决策）、`calendar-gantt-optimization-plan.md`（缺陷诊断）
>
> 本轮完成：**阶段 0（正确性止血）全部 + 日历替换 spike**。全部结论带可复现证据。

---

## 1. 阶段 0：已完成并验证

| 项 | 状态 | 关键文件 |
| --- | --- | --- |
| 0.1 统一时间轴区间语义 | ✅ | `packages/shared/src/work-items/timeline.ts` |
| 0.2 周序号改 ISO-8601 | ✅ | `plan-date.ts:isoWeekNumber` + `GanttView` 刻度注入 |
| 0.4 保存失败可感知 | ✅ | `useCalendarEntries.ts`（改为抛错）、`SchedulePage.tsx` |
| 0.5 未排期可见 | ✅ | `GanttView.tsx`（头部计数 + 抽屉），删除死代码与死 i18n |
| 0.6 日期归一 | ✅ | `plan-date.ts`，服务端 `calendar.ts` 与 `query.ts` 共用 |
| 0.7 文档纠偏 | ✅ | `dto.ts`、`univer-native-workbench-integration-plan.md`、`useCalendarEntries.ts` 头注释 |
| 0.8 Playground 修复 | ✅ | `mock-utils.ts`、`schedule-views.tsx` |
| ~~0.3 日历时窗自适应~~ | ⏭️ **跳过** | 该视图将被 FullCalendar 替换，修补会被丢弃 |

### 1.1 新增的共享基础层

**`plan-date.ts`** —— "这个规划值指的是哪一天/哪个时刻" 的唯一实现：

- 日期值（`YYYY-MM-DD`）**原样返回，绝不构造 Date**（构造会让 UTC 以西的用户整体少一天）。
- 本地时刻（`T` 或**空格**分隔）→ 日历日即字面日期。
- 带偏移量（`Z` / `±HH:MM`）→ 按宿主时区读回本地日与本地时刻。
- 非法值**拒绝**（`2026-9-2`、`2026-02-30`、`T25:00`、`14:60` …），不再退化为 `NaN-NaN-NaN`。
- `isoWeekNumber` 委托 `date-fns`。

**`timeline.ts`** —— 唯一处理"应用侧含末日 ↔ 渲染器排他端"的转换；所有算术走 `addDays`/`differenceInCalendarDays`（毫秒算术在 23/25 小时的日子上会得到 0 或 2 天）。

### 1.2 修复的实际缺陷

| 缺陷 | 修复前（实测） | 修复后（实测） |
| --- | --- | --- |
| C1 甘特条少一天 | 5 天任务 = **4.000 天**（224px/56px） | 5 天任务 = **280px/56px = 5.000 天** |
| C1（长任务） | 161 天 → 160 格 | 161 天 = **9016px/56px = 161.000 天** |
| C2 ISO 周号 | 2025–2027 的 156 个周一里 **53 个错误** | 与独立周四规则实现逐日一致 |
| C5 未排期静默消失 | 6 条只渲染 4 行、**无任何提示** | 头部显示 "4 scheduled items · 2 unscheduled items"，抽屉可点击跳转 |
| C5 计数不实 | 头部"2 scheduled"却画 3 条 bar | 头部计数与 bar 数一致（4 = 4） |
| C6 日期解析三套 | 服务端裸 `slice`、客户端无校验、第三套无人用 | 三处归一到 `plan-date.ts` |
| 0.4 保存静默失败 | 写入被拒 → 页面不关也不报错 | 就地字段校验 + `toast.error`（含服务端原因）+ 页面保持打开 |

**额外发现并修复（本轮引入后自查发现）**：把排他端喂给任务列的日期标签会显示 `due+1`。已新增 `displayDue`（含末日）与几何用的 `endExclusive` 分离。E2E 已锁定该行为。

### 1.3 验证证据

```bash
# 单元测试：46 项，跨 5 个时区（含 DST 与非 DST）
cd packages/shared
for tz in Asia/Shanghai America/New_York Europe/Warsaw Pacific/Auckland America/Santiago; do TZ=$tz bun test src/work-items/; done
# 结果：43 pass / 0 fail（每个时区）
```

**变异测试（证明测试有效，而非空跑）**——把实现逐条改回错误版本，确认测试会失败：

| 变异 | 失败的测试 |
| --- | --- |
| `toTimelineRange` 用 `+86_400_000` | 2 项（`endExclusive` 非本地午夜） |
| `timelineDayCount` 用毫秒整除 | 3 项（跨春令时 3 天得 2 天） |
| `fromTimelineRange` 用 `-86_400_000` | 1 项（DST 往返漂移） |
| `planDateKey` 用 `slice(0,10)` | 6 项（偏移量/非法值） |
| `isoWeekNumber` 用旧公式 | 2 项 |

DST 用例经独立验证确实"咬得住"：在 `America/New_York` 下，`+86_400_000` 于 2026-03-08 得 **01:00**（29 小时日的 23:00 落到**前一天**），毫秒整除得 **0 天**。

**E2E（Playwright，真实浏览器 + 生产组件）**：

```bash
bun run vite dev --config apps/electron/vite.config.ts --port 5199 --strictPort
node plans/calendar-gantt-verification.mjs http://localhost:5199
# 结果：10/10 通过；产物 plans/calendar-gantt-verification.json
```

10 项断言：Playground 可启动；甘特渲染 bar/行/ISO 周刻度；**条宽 = 含末日天数**；行元数据显示**含末日**；ISO 周号连续且合法；未排期计数/抽屉/bar 数三者一致；日历月视图有条目；窗外定时条目不越出网格；编辑器阻止"结束早于开始"；**保存被拒时给出提示且页面不关闭**。

同一套 E2E 也做了变异验证：把 C1 修复回退后，断言输出 **"expected 5 days, measured 4.000 (224px / 56px)"** —— 正是计划文档记录的回归现象。

### 1.4 门禁结果

| 门禁 | 结果 |
| --- | --- |
| `typecheck:all`（13 个 workspace） | ✅ 0 错误 |
| `lint:electron` / `lint:shared` | ✅ 0 error（仅既有 warning） |
| `lint:i18n:parity` / `:sorted` / `:coverage` | ✅ 2414 key × 7 locale |
| `identity:check` / `version:check` | ✅ |
| 全量 `bun run test` | ⚠️ 有失败，但**全部为改动前既有失败**（见 §3） |

**i18n 净变化**：新增 15 个 key，删除 9 个死 key（`gantt.unscheduledParents_*`、`gantt.range.*`、`gantt.zoomFit/In/Out` —— 均经 grep 确认为 0 引用），7 个语言文件同步。

---

## 2. 阶段 2：日历已迁移到 FullCalendar（MIT）—— 已完成

依赖：`@fullcalendar/react@7.1.0` + `temporal-polyfill@1.0.5`（声明在 `apps/electron`，与引用位置一致，不靠 hoisting）。
spike 完成后已删除，其结论全部并入下方。

### 2.1 迁移了什么、保留了什么

`CalendarView.tsx` 从 **853 行自研网格** 重写为 **约 380 行适配器**。删除的自研引擎（连同其缺陷）：

| 删除 | 原缺陷 |
| --- | --- |
| `HOUR_START=8 / HOUR_END=20`、`hourTop()` | 07:00 画在网格上方、22:00 画在网格下方 168px |
| `MAX_TASKS_PER_CELL = 3`、溢出 `<span>` | 容量不看空间、三条被压成 6px、`+N more` 不可聚焦 |
| `overlapPosition()` O(n²) `index/count` | 链式重叠被压平到同一列宽 |
| `startResize` 手写 pointer 逻辑 | 无实时反馈、监听器不清理 |
| `7 * 86_400_000` 周导航 | DST 边界可能偏一天 |
| `ContentSwap` 视图切换 | 迁移后由库内部切换，不再需要 |

保留（未改动语义）：
- `useCalendarEntries` 数据层（仍是 Session 规划字段的投影）与 `SchedulePage` 全页编辑器；
- 自有头部：项目筛选、搜索、分段控件、新建按钮、红绿灯补偿、surface 关闭/全屏；
- 设计 token —— 通过 `--fc-classic-*` 映射（`calendar-overrides.css`）。

**顺带修掉的既有缺陷**：打开日历不再清空列表视图的 status/scheduled 筛选（计划 I5）；分段控件改用共享的 `SettingsSegmentedControl` 原语，获得 `role=radiogroup` + roving tabindex + 方向键/Home/End（计划 I8），**甘特图同步替换**，消除两处重复实现（计划 V3）。

### 2.2 关键实现约束（实测，决定后续能否继续"修补"）

FullCalendar v7 **只有哈希 class 名**（`fc-0Bj`、`fc-classic-1sP`），`fc-event` / `fc-daygrid-day` / `fc-scrollgrid` / `fc-toolbar` / `fc-day-today` 在其 CSS 中出现次数均为 **0**，容器上也没有 `.fc` 根类。可用稳定钩子只有：

1. `--fc-classic-*` CSS 变量（27 个）；
2. `data-date` 属性；
3. 规范 ARIA role（`grid` / `rowgroup` / `row` / `columnheader` / `gridcell`）。

→ 甘特那种"按 class 覆盖"的 `gantt-overrides.css` 模式在此**行不通，也刻意不做**。日历的样式代码因此只有 ~70 行 token 映射，远少于甘特的 540 行。

### 2.3 写入路径的日期转换：抽成可测模块

拖动/resize 的换算抽到 `apps/electron/src/renderer/lib/calendar-events.ts`，因为库的两个方向定义**不对称**：全天事件 `end` 是**排他**的，定时事件 `end` 是**真实结束时刻**。混用任一方向都会静默吃掉或多出一天。

17 项单测覆盖（**测试先写**）：全日跨天、单日、无 end、定时同日、定时无 endTime、23:30 派生、跨天定时、午夜结束归属前一天、按天平移保持时长、四类往返一致。

**变异验证**（确认测试有效）：

| 变异 | 失败项 |
| --- | --- |
| 读取时不把全日 `end` 加一天 | 3 |
| 写入时不把全日 `end` 减一天 | 4 |
| 定时 `end` 也当排他处理 | 5 |

### 2.4 E2E 验收（12 项，全部通过）

```bash
bun run vite dev --config apps/electron/vite.config.ts --port 5199 --strictPort
node plans/calendar-gantt-verification.mjs http://localhost:5199
# 12/12；产物 plans/calendar-gantt-verification.json
```

新增的日历断言：
- 渲染成功、**库自带工具栏按钮数为 0**（自有头部完全接管）、token 桥接非空、`role=radiogroup` 带组标签；
- **5 条日程的那一天可经 "+N more" 触达**并列出全部条目（旧视图是死 `<span>`）；
- 07:00 与 22:00 条目**滚动到可见后均落在时间网格内**（旧视图画在网格外）；
- 每个条目 `tabindex >= 0` 且 `cursor: pointer`（旧月视图条目是无 tabIndex 的 `div`）。

**关于拖动**：拖动本身的 E2E 断言**刻意不做** —— headless Chromium 下库的指针拖拽不启动其交互处理器（已用事件探针确认 `pointerdown` 能到达节点但拖拽不触发），断言它等于测测试框架而非产品。真正有风险的是日期换算，已由上述 17 项单测（含变异验证）确定性地覆盖。

### 2.5 视觉回归与重做（用户反馈后）

**问题（用户实测反馈）**：迁移后的日历"简陋了很多"。**属实，且原因明确** —— 第一版 `calendar-overrides.css` **只映射了 `--fc-classic-*` 颜色变量，完全没有处理结构**，库的默认外壳全部保留。实测证据：

| 元素 | 迁移后（实测） | 应有的样子 | 结果 |
| --- | --- | --- | --- |
| 事件条背景 | **实心 `rgb(124,58,237)`** | 半透明 accent 16% | ❌ |
| 事件条字号 / 圆角 | **16px** / 4px | 12.5px / 6px | ❌ |
| 网格圆角 | **0px** | 12px + 1px 边框 | ❌ |
| 列头 | 16px/400、无内边距、无下边框 | 11px/600、大写、灰 | ❌ |
| "+N more" | 库默认无样式文本 | 有 hover 的按钮感 | ❌ |
| 周序号 | 与上一行重叠 | 独立左侧栏 | ❌ |

根因是 `--fc-classic-event` 直接给了 `var(--accent)`：事件条画的是 `var(--fc-event-color)`，也就是**实心** accent，而不是应用惯用的半透明块。

**重做方式（只用稳定钩子，不碰哈希类名）**：

1. 把 `--fc-classic-event` 改为 `color-mix(in srgb, var(--accent) 16%, transparent)`，从源头修正填充（无需 `!important`、无优先级之争）。
2. 用 **ARIA role + `aria-current="date"` + `data-date`** 做结构样式：网格圆角与边框、列头排版、今日 accent 洗色 + 圆形 accent 日期徽章、非本月日期弱化、周序号独立栏、事件条半透明 + accent 细边框 + hover。
3. 用 **`moreLinkContent`** 渲染我们自己的 "+N more"（类名归我们所有）；用 **`dayCellDidMount`** 标注 `data-other-month` / `data-past`（因为 v7 **已移除** `dayCellContent` / `dayCellClassName` / `eventClassNames`）。

**验证**：浅色 / 深色 / 周视图三张实拍截图逐一核对（深色下 token 变为 `rgb(8,10,16)`，事件条用深色 accent `rgb(167,139,250)` 16%）；E2E **12/12**、motion **18/18** 仍全绿。

**唯一无法改的部分（已实测确认并写入 CSS 注释）**：`skeleton.css` 用 **`padding: … !important`（126 处）** 锁定内边距/行高。实测：同一条规则里 `font-size` 生效、`padding` 被丢弃。可见的内边距来自库的内层元素，密度已经跟随库的间距；若要改就必须对哈希类名写 `!important` —— 那正是这次迁移想消灭的补丁层，故未采用。

### 2.6 门禁同步

`plans/motion-verification.mjs` 的日历检查已重写：原实现查找 `[role="tablist"]`（自绘控件从未有过该 role），作用域静默退化为 `document.body`，**断言通过但观察的是整个 Playground**。新实现作用域锁定 `.phaneris-calendar`，逐帧确认网格不消失，并断言恰好一个日历分段处于 `aria-checked`。**18/18 通过**。

## 3. 既有测试失败：已全部修复（`bun run test` exit 0）

本轮开始时全量测试有 **6 个失败目标**（13 项断言）。逐项定位后发现它们**不是同一类问题** —— 其中 2 项是真实产品缺陷，4 项是测试自身已失效：

| # | 失败 | 根因 | 性质 |
| --- | --- | --- | --- |
| 1 | `buildOAuthDeeplinkUrl` × 4 | fixture 传 `deeplinkScheme: 'craftagents'`（上游品牌）却断言 `phaneris://` —— 改名时只更新了期望值，没更新输入 | **测试失效** |
| 2 | `Linear MCP … should be reachable` | 守卫从未生效：`reachable` 标志在 `it()` 里赋值，而 `fn()` 无条件注册全部用例；且探测超时 5000ms **恰好等于** runner 的每例上限，abort 永远赢不了竞态 | **测试失效** |
| 3 | `git developer context … defangs a crafted file name` | fixture 把 `evil</developer_context>.txt` 当**单个**文件名写入 —— 其中的 `/` 是路径分隔符，`writeFileSync` 必然 ENOENT。断言从未真正执行过 | **测试失效** |
| 4 | `main-process i18n bootstrap … hydrates` | 用例直接调 `i18n.changeLanguage()`，绕过了 `ensureLocaleResources`；生产代码（`main/index.ts:79`）用的是 `changeAppLanguage()`，本来就正确 | **测试失效** |
| 5 | `transform_data path containment` × 2 | **产品缺陷**：Darwin 沙箱 profile 用 `path.resolve()`（纯词法，不解析符号链接）写允许路径，而内核按解析后的真实路径匹配。macOS 上 `/var`→`/private/var`，于是 session 内**任何写入都被 EPERM 拒绝** | **产品缺陷** |
| 6 | `registration` / `registration-profiles`（`plugins:*`）× 2 | 两个用例的"已声明通道"清单漏了 `plugins` 模块（该模块确实导出 `HANDLED_CHANNELS` 且确实被注册）—— 这正是该断言的用途 | **测试漏声明** |
| 7 | `prepareMcpOAuth … falls back to default client ID` | **产品缺陷**：3 处 fallback 硬编码 `clientId = 'craft-agent'`（上游品牌），违反 `identity.generated.ts` 的"产品永不冒用上游标识" | **产品缺陷** |

### 3.1 两个真实产品缺陷（值得单独看）

**（a）`transform_data` 在 macOS 上写不出任何输出。**
`filesystem-isolation.ts` 用 `resolve()` 生成 `(allow file-write* (subpath "…"))`，`resolve` 是纯词法的、保留符号链接；`sandbox-exec` 按内核解析后的路径匹配。macOS 的 `/var` 与 `/tmp` 都指向 `/private/...`，而 `os.tmpdir()` 返回 `/var/...` 拼写 —— 于是允许路径永远匹配不上，脚本被拒。实测错误：`EPERM: operation not permitted, open '…/session/data/out.json'`。

修复：新增 `canonicalSandboxPath()`，用 `realpathSync.native` 规范化；叶子不存在时向上找到最深的已存在祖先再拼回剩余部分（保证函数总是返回可用路径，不抛）。**安全边界未放宽** —— 全部"拒绝"用例（兄弟目录前缀、符号链接逃逸、skills 逃逸）仍然通过。

> 附带发现：macOS 的 `realpath(3)` 对**结尾含反斜杠**的名字会返回 ENOENT（即使 `mkdir` 刚成功创建它），因此该场景的测试断言只能覆盖引号转义，已在用例里注明。

**（b）OAuth 默认 client ID 冒用上游品牌。**
`auth/oauth.ts` 三处 fallback 与 `mcp/client.ts` 的 MCP `clientInfo.name` 都硬编码 `'craft-agent'`。改为 `PRODUCT_SLUG`（来自生成的身份契约）。`identity:check` 的"worst files"里 `auth/oauth.ts` 与 `mcp/client.ts` 均已消失（仍 exit 0）。

### 3.2 验证

- **`bun run test` → exit 0，"All workspace tests passed"**（本轮开始时 6 个失败目标）
- **变异测试 4 组**，确认修复后的断言真的会失败：
  | 变异 | 失败项 |
  | --- | --- |
  | 关掉 closing-tag defanging | 1（安全断言） |
  | `changeAppLanguage` 不再加载 bundle | 1 |
  | 沙箱路径退回词法 `resolve()` | **7**（含 2 项 transform_data） |
  | 网络用例默认开启 | ——（改为 opt-in 后无需变异） |
- E2E 复跑：`plans/calendar-gantt-verification.mjs` **12/12**、`plans/motion-verification.mjs` **18/18**
- 门禁：`typecheck:all` 0 错误；lint 0 error；`i18n` × 3 OK；`identity:check` / `version:check` OK

### 3.3 网络用例改为 opt-in（设计决定）

`oauth.e2e.test.ts` 原来既不可靠也不诚实（守卫不生效）。实测各厂商发现延迟差异极大：`api.githubcopilot.com` 走完 4 个 `.well-known` 需 **~37s** 且最终无 metadata（该端点需要鉴权），而 `mcp.linear.app` / `api.ahrefs.com` 约 2.4s / 3.0s。任何单一超时都无法既覆盖 GitHub 又不拖慢套件；而探测预算压到 2.5s 时又正好卡在 Linear/Ahrefs 的正常响应时间上，同一 commit 会时而运行时而跳过 —— 那是披着 skip 外衣的 flaky。

现在：
- **纯函数断言**（origin 提取，即该文件当初要防的 Ahrefs 正则 bug）**始终运行**，无网络；
- **live 发现调用**需要显式开启：
  ```bash
  PHANERIS_NETWORK_E2E=1 bun test src/auth/__tests__/oauth.e2e.test.ts
  ```
- 默认套件零网络 I/O，连续 3 次运行结果完全一致（2 pass / 3 skip / 0 fail）。

## 4. 尚未开始

**P3 门禁增强**（计划 3.5，非阻塞）：

1. `eslint-plugin-jsx-a11y`（先在两个视图 + kanban 目录开启 `recommended`）；
2. i18n 增加"死键"检查（当前 `check-i18n-coverage.ts` 只查"引用的 key 是否存在"，查不出"key 已死"）；
3. Playground 注册表与 `PROJECT_MANAGEMENT_VIEWS` 的一致性断言（本轮已手工发现甘特条目曾被还原而无人察觉）。

**计划中明确不做**（评估已论证）：不引入第二个甘特库；不在阶段 0/1 引入 recurrence。

**可选增强**（产品决定）：日历议程视图；甘特依赖编辑与关键路径（PRO）；`apps/webui` 的 `temporal-polyfill` 体积实测（当前未测）。

## 5. 本轮新增 / 修改文件索引

**新增**

| 文件 | 作用 |
| --- | --- |
| `packages/shared/src/work-items/plan-date.ts` | 日期归一（唯一实现） |
| `packages/shared/src/work-items/timeline.ts` | 含末日 ↔ 排他端转换 |
| `packages/shared/src/work-items/__tests__/plan-date.test.ts` | 43 项日期/区间失败用例之一（含 ISO 周、偏移量、非法值） |
| `packages/shared/src/work-items/__tests__/timeline.test.ts` | 区间失败用例（含 DST、跨年、闰年） |
| `apps/electron/src/renderer/lib/calendar-events.ts` | 规划日期 ↔ FullCalendar 事件换算 |
| `apps/electron/src/renderer/lib/__tests__/calendar-events.test.ts` | 17 项换算失败用例（已变异验证） |
| `apps/electron/src/renderer/components/app-shell/kanban/calendar-overrides.css` | FullCalendar token 映射（~70 行） |
| `plans/calendar-gantt-verification.mjs` + `.json` | **E2E 验收产物**（12 项断言） |
| `plans/calendar-gantt-probe.mjs` + `.json` | Playground 诊断探针（定位缺失 API） |

**修改**

| 文件 | 改动 |
| --- | --- |
| `apps/electron/src/renderer/components/app-shell/kanban/CalendarView.tsx` | 853 → ~380 行：迁移到 FullCalendar，保留自有头部/筛选/编辑器 |
| `apps/electron/src/renderer/components/app-shell/kanban/GanttView.tsx` | C1/C2/C5/C6 修复 + 未排期抽屉 + 共享 radiogroup |
| `apps/electron/src/renderer/components/projects/SchedulePage.tsx` | 字段级校验 + 保存失败提示 + 加载错误态 |
| `apps/electron/src/renderer/hooks/useCalendarEntries.ts` | 变更失败改为抛错（不再静默返回 null）+ 头注释纠偏 |
| `apps/electron/src/renderer/playground/mock-utils.ts` | 补 5 个缺失 API；fixture 改为相对今天并覆盖边界情形 |
| `apps/electron/src/renderer/playground/registry/schedule-views.tsx` | 注册甘特 + 编辑器条目；抽出共享 provider 栈 |
| `packages/server-core/src/handlers/rpc/calendar.ts` | 改用 plan-date；写入拒绝非法值 |
| `packages/shared/src/work-items/{query,browser,index}.ts` | 委托单一实现；导出新助手 |
| `packages/shared/src/protocol/dto.ts` | `CalendarEntry` 文档纠偏（不是独立存储） |
| `packages/shared/src/i18n/locales/*.json`（7 个） | +17 key、-9 死 key（2416 key/语言） |
| `plans/motion-verification.mjs` | 日历检查重写（原 `[role="tablist"]` 假设失效） |
| `docs/process/univer-native-workbench-integration-plan.md` | 更正"gantt 不注册路由"的过期描述 |
| `apps/electron/package.json` | 声明 `@fullcalendar/react` + `temporal-polyfill` |

**已删除**：`FullCalendarSpike.tsx`、`fullcalendar-spike.css`（spike 完成使命，结论并入 §2）。

### 5.1 修复既有失败一轮的改动（§3）

| 文件 | 改动 | 性质 |
| --- | --- | --- |
| `packages/shared/src/auth/oauth.ts` | 3 处 fallback client ID：`'craft-agent'` → `PRODUCT_SLUG`（新增 `DEFAULT_PUBLIC_CLIENT_ID`） | **产品缺陷** |
| `packages/shared/src/mcp/client.ts` | MCP `clientInfo.name` 同上 | **产品缺陷**（附带发现） |
| `packages/session-tools-core/src/runtime/filesystem-isolation.ts` | 新增 `canonicalSandboxPath()`，Darwin profile 路径改用真实路径 | **产品缺陷** |
| `packages/shared/src/auth/__tests__/types.test.ts` | 陈旧品牌 fixture → `DEEPLINK_SCHEME`（单一来源） | 测试失效 |
| `packages/shared/src/auth/__tests__/exports-and-session-context.test.ts` | 同上 | 测试失效 |
| `packages/shared/src/auth/__tests__/oauth.e2e.test.ts` | live 发现调用改为 `PHANERIS_NETWORK_E2E=1` opt-in；origin 提取断言始终运行 | 测试失效（flaky） |
| `packages/shared/src/prompts/__tests__/developer-context.test.ts` | 用 目录 `evil<` + 文件 `developer_context>.txt` 组装出真正的危险路径（原先的写法必然 ENOENT，断言从未执行） | 测试失效 |
| `apps/electron/src/main/__tests__/i18n-bootstrap.test.ts` | 改走 `changeAppLanguage()`（与 `main/index.ts:79` 一致），并加断言 `bundleLoaded` | 测试走错 API |
| `apps/electron/src/main/handlers/__tests__/registration*.isolated.ts` | 声明清单补上 `plugins` 模块 | 测试漏声明 |
| `packages/session-tools-core/src/runtime/filesystem-isolation.test.ts` | 重写：新增符号链接规范化、未存在叶子、转义等 4 个用例 | 新增覆盖 |

---

## 6. 用户三点反馈的处理（时间轴 / 圆角 / 甘特空状态）

### （1）时间轴密度：改为「08:00–18:00 主视窗 + 24 小时制」

实测原状：**全 24 小时**渲染、**50px/小时**、视口 716px 只能看到约 **14.3 小时**，且初始滚动位置由**最早那条日程**决定（`scrollTop 301` ≈ 06:00），不是固定工作时段 —— 旧实现的 `HOUR_START=8 / HOUR_END=20 / HOUR_PX_MIN=56` 这个「工作时段」概念在迁移中丢掉了。

改法（B 方案）：保留 24 小时渲染（其余时段仍可滚动），把行高抬到 **72px/小时**（`slotDuration="00:30"` + `slotMinHeight={36}`），并用 `scrollTime="08:00"` 固定初始位置。24 小时制用 v7 的 **`slotHeaderContent`** 自己渲染 `HH:00`（v7 已无 `slotLabelFormat`），并用 `eventTimeFormat` 让事件条时间也走 24 小时。

实测结果：标签 `00:00`–`23:00` 共 24 个且全部匹配 `/^\d{2}:00$/`；`72px/小时`；视口 **9.9 小时**；初始 `topVisibleHour = 8`。

### （2）圆角：主要是**运行的是旧构建**，另修两处真实问题

排查结论（有证据）：打包产物 renderer 构建于 `23:28:57`、源码 `dist/renderer` 构建于 `23:23:56`，**都早于**日历重做；两者都不含重做标记（`data-other-month` / `pg-calendar-more` MISSING）。当时我只重跑了 `electron-builder` 而**没有重建 `dist`**，所以打包进去的是重做前的日历 —— 截图里的直角来自那个版本。

当前版本放大 4× 实测：`[role=grid]` 有 `border-radius: 11.25px` + `overflow: hidden` + 1px `--border`，圆角正常。同时放大暴露两个真实问题，已记录待修：

- **周序号格子在左缘切出一个方角缺口**（自带背景 + 右边框顶到圆角容器）。
- **日历读不出「卡片」**：甘特用 `rounded-xl border border-border bg-background`，日历外层是 `bg-foreground/[0.012]`，而浅色下 `--card: #FAFBFC` 与 `--background: #F6F7F8` 只差 **4/255**，卡片面与面板面几乎同色 —— 这才是「风格不一致」的根因，值得把两个投影的容器处理统一。

### （3）甘特空状态：保留框架 + 规范空状态

原实现 `tasks.length === 0` 时把**整个图表替换掉**，只剩一行灰字（日历保留月网格、看板保留列，所以对比明显）。现改为**始终渲染图表框架**（实测 SVAR 在 `tasks={[]}` 下会正常渲染任务列表头 + 双时间刻度），空状态作为覆盖层落在**时间轴窗格**（`left: GRID_WIDTH`），因此任务列与刻度仍然可见。

空状态用项目已有的 `EntityListEmptyScreen` 原语（icon + 标题 + 说明 + CTA），CTA 跳到看板排期。新增 i18n：`gantt.emptyTitle` / `gantt.emptyAction`（7 语言）。

### 验收

E2E 从 12 项扩到 **15 项**，新增 3 项均已**变异验证**：

| 新增断言 | 变异后 |
| --- | --- |
| 24 小时制 + 72px/小时 + 视口 8–13 小时 + 初始 08:00 | 去掉 `slotMinHeight` → `expected ~72px per hour, measured 50.0` ✅ 失败 |
| 空计划仍渲染框架 + 空状态三要素 | 退回单行文案 → `the chart frame was not rendered for an empty plan` ✅ 失败 |
| 有数据时不显示空状态 | — |

`15/15` 通过；motion `18/18`；`typecheck:all` 0 错误；lint 0 error；i18n ×3 OK（2418 key）；`bun run test` exit 0。

## 7. 本地客户端打包（干净构建）

```bash
bun run electron:clean                                   # 清掉 dist/ + release/
bash apps/electron/scripts/build-dmg.sh x64              # 本机为 x86_64（AMD Ryzen + macOS 26.7）
```

**产物**：`apps/electron/release/Phaneris-0.2.2-mac-x64.dmg`（197.9 MiB，含 §2.5/§5.2 全部 UI 改动）、同名 `.zip`、解包后的 `release/mac/Phaneris.app`（547 MB）。未签名（keychain 中 0 个有效签名身份，仅一个不受信任的 `CabinetDev`），未公证，未上传。

**打包过程中发现并修复的真实缺陷**：`electron-builder.yml` 与生成的 `identity.generated.yml` 都没有 `protocols` 声明，因此打包后的 macOS 应用 **Info.plist 里没有 `CFBundleURLTypes`** —— LaunchServices 只允许「在 bundle 中声明过某 scheme」的应用成为其默认处理程序，所以 `app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)` 在 macOS 上无法生效，**`phaneris://` 深链会被系统丢弃**，包括 OAuth 回跳会话的链接。

修复方式是让 scheme 从身份契约渲染（而不是写进禁止复述身份的 `electron-builder.yml`）：`scripts/identity-core.ts` 的 `renderBuilderIdentity()` 增加 `protocols` 块。修复后 Info.plist 出现 `CFBundleURLSchemes: ["phaneris"]`。

**验收产物**：

| 脚本 | 结果 |
| --- | --- |
| `plans/packaged-client-verification.mjs --arch=x64` | **9/9** —— 版本/身份、深链 scheme（且不含上游 scheme）、x86_64、未签名、asar 关闭、bun/ripgrep/文档工具/WhatsApp worker/node-pty 等资源就位、renderer 已打包 |
| `plans/packaged-client-smoke.mjs --arch=x64` | **5/5** —— 真实启动 25s 不崩、Chromium 拉起 helper、无致命输出、主进程改写了自己的 config、测试后无残留进程 |

**烟雾测试自身的修正**：第一版是**空跑**的 —— 把 `dist/main.cjs` 删掉后它仍然 5/5 通过（Electron 会停在错误窗口里，进程照样存活、照样拉起 renderer、userData 照样存在）。现改为断言 **`~/.phaneris/config.json` 的 mtime 在启动期间前进**（主进程读取→迁移→写回的证据）。已双向验证：健康启动会前进，删除入口后不前进；变异后脚本从 5/5 变为 **3/5**，两条断言如实失败。

---

## 8. 第二轮反馈（4 项）的处理

### （1）甘特空状态：去掉覆盖层

上一轮加的 `EntityListEmptyScreen`（图标+标题+说明+CTA）已删除，**只保留空框架**（任务列表头 + 双时间刻度）。连带删除 3 个因此变成死键的 i18n：`gantt.empty` / `gantt.emptyTitle` / `gantt.emptyAction`（grep 确认仅被该覆盖层引用）。

### （2）日历 week/day「一整块」：**重新校验，结论已更正**

上一轮我把 week 和 day 都归因于 today 染色，**这是不准确的**。重新实测：

| # | 事实 |
| --- | --- |
| A | **时间网格主体完全没有小时横线** —— 1728px 高的 week 主体里只有 **3 条**横线：2 条全宽（全天条/表头下边框）+ 1 条 113px 红（now 线）。而左侧 gutter 有整点+半点线。**把我的 CSS 整个清空后依然如此 → 不是我的样式压掉的，是库就没画** |
| B | **day 视图**：库把 today 列底色（`accent 10%`）铺满整个主体，染色面积 **1,407,672 px² vs 卡片 692,334 px²** —— 真的是一整块 |
| C | **week 视图**：只有今日一列被染色（201,344 / 1,900,000 ≈ 1/7），**不是整块**；它「平」是因为 A |
| D | 我那条 `[aria-current]` 命中的是 **36px 的全天条格子**，不是时间列 —— 染错对象 |

修法：
- `--fc-classic-today: transparent`，并删掉我那条 `[aria-current]` 底色 → today 只由**圆形 accent 日期徽章**标记（你的决定）。实测 week/day 的最大面积色已回到卡片色，淡紫块消失。
- **补回小时线**：因为库不画，改用 `repeating-linear-gradient` 画在日列上（72px 一条整点线、36px 一条半点线，与 gutter 对齐）。不需要 `!important`、不依赖哈希类名。实测两个视图都恢复成真正的网格。

### （3）视图状态按 workspace 持久化

根因：`mode`/`cursor` 是组件本地 state，而打开日程编辑器会用 `<SchedulePage>` **替换** `<CalendarView>`（组件卸载），返回时重新挂载 → 回到 month + 本月。

现按 workspace 作用域持久化（`KEYS.calendarViewState` / `KEYS.ganttScale`）：
- 日历：`{ mode, cursor }`；甘特：`scale`。
- 关键坑：**`initialView` 也必须用存储值**。只恢复 state 会被挂载时的 `controller.view` 同步覆盖 —— 头部显示 Week、网格却还是 month。已修并实测。

实测：日历 Week → 重载后仍为 Week；甘特 Year → 重载后仍为 Year。存储键 `craft-calendar-view-state:ws-playground-schedule` = `{"mode":"week","cursor":"2026-09-25"}`。

### （4）甘特顶栏对齐（含新的 42px 统一）

| | 看板 | 列表 | 日历 | 甘特（改后） |
| --- | --- | --- | --- | --- |
| 高度 | 42px | 42px | **42px**（原 48） | **42px**（原 48） |
| 红绿灯补偿 | ✅ | ✅ | ✅ | ✅ **（原来缺，已补）** |
| 布局 | flex | flex | grid 三列 | **grid 三列**（原 flex，导致中段位置漂移） |
| 左 | 筛选+搜索 | 筛选+搜索 | 筛选+搜索 | **筛选+搜索+计数+未排期抽屉** |
| 中 | — | — | ‹标题›+Today | **Today**（实测偏移 **0px**） |
| 右 | +New Task | 分段 | 分段+New Schedule | **分段 + New Task** |

顺带修的**测试脚手架缺陷**：Playground 用 stub AppShell，`projectsAtom` 从未被填充，因此**三个投影在 Playground 里都没有项目筛选**（不只甘特）。已在 `ScheduleProviders` 内加 `ProjectsLoader` 调用 `useProjects` —— 注意必须放在 `JotaiProvider` **内部**，否则写进的是 ambient store，视图读不到。

### 验收

E2E **16/16**（新增/改写 4 项：空框架无覆盖层、顶栏控件与居中、状态持久化）；motion 18/18；`typecheck:all` 0 错误；lint 0 error；i18n ×3 OK；`bun run test` exit 0；打包产物 9/9 + 启动 5/5。客户端已重新打包。

---

## 9. 第三轮反馈：网格线的范围与强度

### （1）月视图不该有小时线 —— 是我的选择器写宽了，已修

用户提问「月视图也要划线吗」直接命中了我的缺陷。小时线用的选择器是 `[role='grid'] [role='gridcell'][data-date]`，而**月视图的日期格同样带 `data-date`**。实测：月格高 126px，`backgroundImage` **存在**，放大后可看到每个"31"格子里被画了 **3 条横线**（36 / 72 / 108px 处）。

修法：在容器上暴露 `data-calendar-view={mode}`，把小时线规则**限定到 week/day**。修复后实测：

| 视图 | 日期格 | 带渐变 | 格高 |
| --- | --- | --- | --- |
| month | 42 | **0** | 126 |
| week | 14 | 14 | 36（全天条）/ 1728（主体） |
| day | 2 | 2 | 36 / 1728 |

全天条的 36px 格子也会命中，但它的线正好落在格子下边框上（重合，肉眼不可见）——已放大确认。

新增 E2E 断言守住这条：月视图日期格渐变数必须为 **0**，week 主体列必须**全部**带上规则。

### （2）分隔线过实 —— 统一压成两级半透明

原来小时线用 `--border` 的 **85%**（`--border` = `#DEDFE2`），叠加格子边框、表头下边框后确实显得拥挤。改为在 `.phaneris-calendar` 上定义一条**两级分隔线刻度**，所有线都走它：

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--pg-rule` | `--border` 55% | 整点线、日格边框、表头下边框 |
| `--pg-rule-faint` | `--border` 28% | 半点线、周序号栏右边框 |

关键一点：**库自己画的日格边框走 `--fc-classic-border`**，所以把该 token 也接到 `--pg-rule` —— 否则只改我自己的线，格子边框依然是实色。实测 `columnHeader` 与月格边框的可见线都来自库，这一处不改就等于没改。

浅色与深色各出一张 week/month 实拍核对：结构仍清晰可读，但不再抢内容。

### 验收

E2E **17/17**（新增范围守卫）；motion 18/18；`typecheck:all` 0 错误；lint 0 error；i18n ×3 OK；`bun run test` exit 0；打包 9/9 + 启动 5/5。客户端已重新打包。

---

## 10. 第四轮：侧边栏方案与三视图统一（已实施并验收）

本轮把用户四轮反馈里剩下的排期做完，每一条都以可复现实测验收。E2E 从 17 项增长到 **27 项**。

### P1 甘特任务列宽：从常量变成"宿主宽度的一份 + 记住拖动"

原状是硬编码 `GRID_WIDTH = 370`：换窗口不动，拖过的宽度下次挂载又回 370。实测（Playground，卡片宽 1256px）：

| 步骤 | host | 任务列宽 |
| --- | --- | --- |
| 预览 1280 | 1256 | 376（= 0.30×1256） |
| 预览 1000 | 976 | 292 |
| 拖 +150px | 976 | 442 |
| 硬刷新 | 976 | 442（记住） |
| 清掉存储再刷新 | 976 | 292（回到自适应） |

实现：`GRID_WIDTH_RATIO 0.30` / `clamp 280–560`，用户没拖过时跟随 `ResizeObserver` 的宿主宽度；一旦拖动，经 `api.on('resize-grid')` 防抖 250ms 写入按工作区作用域的 `gantt-task-column-width`。按用户要求**不加可见把手**。

### P2 日历：全天行换成右侧栏（300px）

- `allDaySlot={false}`：实测只影响 timeGrid，月视图 11 条照常渲染；不放侧栏的话日期型条目会从日/周视图整体消失，所以侧栏不是可选装饰。
- 侧栏列出**全部**未设时间条目（跨周、含已过期），这与"当前看的是哪一周"无关——断言里专门验证翻页时侧栏不变。
- 侧栏内极简 `+`：只填标题 + 日期，写入 `{allDay: true}`，对应现有 `calendar:create` 的纯日期分支。
- 两个拖拽手势：侧栏 → 网格（填日期时间）、网格 → 侧栏（清掉时间）。实测载荷分别为 `{date, time, allDay:false}` 与 `{date, allDay:true}`。
- **月视图不渲染侧栏**（断言）。

### P2b 表头：两行 52px，三视图等高

改造前实测：三个视图的表头都是 24px 单行（`MON 21`），**今天在任何地方都没有强调**。现在日/周是两行（周X / 9-21，今天蓝色），月视图只有一行星期，但三者共用 `--pg-head-h: 52px`——断言逐视图测量并比较，切换视图不会让网格上下跳。

### P3 日/周视图：单击一格 / 拖动选区间

探针实测：单击会**同时**触发 `select` 和 `dateClick`（都接就会开两次编辑器），所以删掉 `dateClick`，只留 `select`——它本来就会为单击报出一格（10:00 → 10:00–10:30）。选中范围经 `fromEventDates` 转成日期+时间，直接预填进编辑器。

> **与原计划的一处替换（有意为之）**：原计划写的是"路由携带结束时间"（`calendar/schedule/new:<date>@<start>-<end>`）。P4 把新建搬进覆盖层后，创建目标变成组件状态而非路由，于是区间由 `kanbanEditorTargetAtom.initialPlan` 携带，而不是 URL；为路由写的那套编解码（`schedule-draft.ts`）随之删除，避免留下只有测试在用的死代码。**验收标准没有降低**：断言直接检查编辑器预填的 `09:00`/`11:30` 与提交载荷里的 `planning.startAt/dueAt`，比检查一个 URL 字符串更贴近用户真正拿到的东西。

### P4 新建与编辑统一到 Task Definition

- **服务端**：`TaskCreateRequest` 增加 `planning`（`startAt`/`dueAt`/`statusId`/`progress`/`isMilestone`/`parentId`/`dependencyIds`），在**三条创建路径**（新建 / 采纳草稿 / 绑定既有卡片）上统一应用，避免"从哪扇门进来"决定计划是否落库。
- **编辑器**：新增"计划"面板，承载两个被退役页面原本独占的字段（状态、进度、里程碑、父任务、依赖、开始/截止＋时间）。开始/截止各带一个可选的**时间**输入——留空即纯日期，这正是日历侧栏读回的"未设时间"。
- **覆盖层上移**到底层 surface（`TaskEditorOverlay`），三个视图与列表都能就地打开，不再把人弹到看板。
- **退役**：`TaskPage`、`SchedulePage`、`WorkItemEditor` 删除；surface 的两个 `details` 分支删除；**两条详情路由连同其词汇一并移除**——`projectWorkItem` / `projectSchedule` 两个构建器、`route-parser` 的 9 处解析/构建分支、`ProjectsNavigationState.details` 的 `workItem` / `calendarEntry` 两个变体、以及 `parseNavigationStateKey` 的 4 处分支全部删除。解析测试改为断言这些路由**不再解析**（重新引入一套没人能导航到的词汇比删掉更糟）。
- 顺带发现并补上的**真实缺口**：`updateSessionPlanning` 从不校验截止早于开始——旧检查只在 `calendar:update` 和两个被删页面里，`workItems:update` 与新的计划字段都能写进反向区间。守卫改为共享纯函数 `planRangeError`（先写失败用例再实现），并挂在 `updateSessionPlanning` 这个唯一咽喉点。

实测端到端：在日历上从 09:00 拖 5 格 → 编辑器预填 `09:00`/`11:30` → 提交载荷 `"planning":{"startAt":"…T09:00","dueAt":"…T11:30"}`。

### P5 三项门禁增强

1. **`eslint-plugin-jsx-a11y`**：对 kanban 目录与两个新 surface 文件开启 `recommended`。首次运行只有 2 个 error（`KanbanColumn` 的 `autoFocus`、`TaskTile` 的事件屏蔽 div），都按规则意图处理并写明理由；现在 **0 error**。
2. **i18n 死键检查**（`scripts/check-i18n-dead-keys.ts`，已接入 `validate:ci`）：覆盖脚本只查"引用的 key 是否存在"，查不出"key 已死"。实现过程中修掉两类真实误判——以字符串形式存的 `labelKey`、以及不在 `t()` 内构造的模板前缀（`return \`contentPanel.button.${kind}\``）。校准后报出 **165 个真正无人引用的键**（约占 7%），已从 7 个语言文件删除；四项 i18n 门禁全绿。
3. **Playground 注册表一致性断言**：为五个 Project Management 视图各选一次预览并断言真的挂载（不是只匹配名字）。这正是当初甘特条目被悄悄还原而无人察觉的缺口。

### 本轮验收

E2E **31/31**（新增 11 项）；`typecheck:all` 0 错误；lint 0 error；i18n ×4 OK；`bun run test` exit 0；打包 9/9 + 启动 5/5。

### 10.1 第五轮：三处修正（甘特行宽 / 边缘自动滚动 / 窄面板收起）

**（1）甘特任务行不跟着列宽走 —— 真缺陷，已修**

用户报告"任务列表本身好像是固定宽度"。实测 DOM 链定位到根因：库把 body 单元格的渲染器包进一个 **按内容收缩** 的 `.wx-text`（`flex: 0 1 auto` + `min-width: auto`）：

| 元素 | 宽度 |
| --- | --- |
| 库的 `.wx-cell`（列） | 370 |
| 库的 `.wx-content` | 354 |
| **库的 `.wx-text`** | **197.72** |
| 我的 `.pg-task-cell`（写着 `width: 100%`） | 197.72 |

所以 `width: 100%` 相对的是一个"按内容定宽"的盒子，任务行永远停在内容宽度；拖动分隔条只会移动分隔条，行留在原地（右侧那片空白不是内边距，是单元格的剩余部分）。表头没有这层包装，所以只有行漂移。

修法：`.phaneris-gantt .wx-grid .wx-content > .wx-text { flex: 1 1 auto; min-width: 0 }`。实测：370 列 → 354 行；拖到 560 → 544 行。**并在打包客户端里复核**：host 2280.5 → 列 560 → 行 544。

**（2）侧栏拖拽的边缘自动滚动 —— 已实现**

原来只能拖到"当前屏幕上已经有的时段"：网格从 08:00 开始、显示约十小时，要把条目放到 19:00 得先滚动再拖。现在指针进入上/下 48px 边缘即启动定时滚动（10px/帧），**指针按住不动也继续滚**，每帧重算落点预览，并在到达滚动范围尽头时自动停止。

实测：按住不动时 `scrollTop` 577 → 687 → 777 → 817 → 907 → **957 停住**（957 = 1728 − 771，正好是尽头），滚动过程中落点预览始终可见。

**（3）窄面板下侧栏自动收起 —— 已实现，且不丢信息**

面板窄于 900px 时侧栏隐藏（300px 侧栏 + 七列周视图会把网格挤到不可读）。但"收起"不能等于"看不见"——那正是本项目一直在修的那类静默丢数据。因此头部同时出现一个"N 项"芯片，点开是**同一份清单**（两侧共用 `UntimedEntryList`，不可能出现"收起时显示的是另一套"）。

实测：面板 1017px → 侧栏在、芯片隐藏、周格 137px；面板 788px → 侧栏隐藏、芯片出现、周格 105px，点开列出全部未设时间条目。

**（4）甘特日期表头被任务条穿透 —— 真缺陷，已修（第六轮）**

用户报告"上滑时日期边界标题里出现任务内容"。从截图量出红框是 **y 40–109**、表头三条横线在 **39 / 65 / 91**，即红框整块就是表头带。随后定位到库自己的一句规则：

```css
.wx-scale { position: sticky; top: 0; background-color: var(--wx-background); z-index: 5; … }
```

`.wx-scale` 是 sticky + 不透明 + z-index 5 的日期表头，**但 `--wx-background` 这个 token 在库的样式表里只被引用、从未被定义**，我们也没定义——实测 `.wx-theme`、根节点、`.wx-scale` 上该值全为空，于是"不透明的固定表头"退化成"透明的固定表头"，行滚上来直接透出来。

它需要**计划行数超过一屏**才会显现，所以只有 6 行的 fixture 一直没暴露；用真实数据量的截图才看得出来。修法是定义 token（而不是补 `.wx-scale`），顺带恢复同样用它绘制的 `.wx-layout`、周末覆盖、rollup 边框与表格头背景；两个值都映射到宿主本来就画的颜色，所以在库没坏的地方视觉零变化。

**变异验证**：去掉 token 后，日期表头带里会渲染出任务条 "Quarterly rollout #5" 横跨 Aug–Dec 月份标签，带内 **20,352 个像素不同**；恢复后只有日期与周号。E2E 断言（滚动前后表头带像素必须完全一致 + 背景必须不透明）在变异下 **FAIL**、恢复后 **PASS**。

前期两次误判也记录在此，避免重复：先怀疑 `.wx-header`（那是左侧"Title"列头，不是日期表头），以及用 `elementsFromPoint` 判断可见性——它返回最上层**可命中**元素，表头即使全透明也会赢，所以那个判据根本不成立。

### 仍未做（明确记录）

- 侧栏拖拽的**水平**边缘滚动未做（只做了上/下）：横向拖出可视周需要先翻页。
