# Run 视图重设计实施与验证

截图、trace、构建 bundle 和其他验证产物不入库；保留本记录与验证脚本，执行脚本可重新生成。

日期：2026-10-23
依据：[`docs/prototypes/run-redesign-2026-10-23/`](../prototypes/run-redesign-2026-10-23/README.md)（评审稿第三版）
证据：`docs/verification/results/run-redesign-2026-10-23/`（运行时生成，不入库）

> 初始实施记录。后续发现的滚动、Context 层级和证据完整性问题及当前验证结果，见 [实施质量复核](run-view-review-2026-10-23.md)。下方 27 项结果对应初始证据目录。

## 实施范围

Run 面板（工作台中的 "Run"）沿用原有的五个入口，本次重做其中三个：

| 视图 | 实现 | 说明 |
| --- | --- | --- |
| Overview | `packages/ui/src/components/trajectory/RunOverview.tsx` | 运行指标 → 上下文演变与占用 → 输出表现与决策影响 → 常驻诊断、环境卡片 |
| Context | `packages/ui/src/components/trajectory/RunContextView.tsx` | 请求历史（含累计/净变化）→ 分类折叠列表 → 就地展开条目、阅读/原文/变化 |
| Decision | `packages/ui/src/components/trajectory/RunDecisionView.tsx` | 处理结果、功能分布两张只读卡片 → 事项列表 → 就地展开处理证据 |
| Trajectory | 未改动 | 保留原有工具栏、时间轴、账本与检查器 |
| Map | 未改动 | 原型中该入口禁用；产品中 Map 已实现，因此保持可用 |

外壳 `TrajectoryView.tsx` 现在承担 Run 顶栏（Run / 会话名、工作区面包屑、运行状态）、标签栏（含轮次与请求范围）以及空、加载失败、运行中三种状态。Decision 的筛选仍通过既有的服务端查询完成；统计卡片描述完整范围，事项列表描述当前筛选。

相关样式集中在 `run-view.module.css`：卡片、栅格、图表、折叠列表与账本共用一套视觉；容器查询在 1100 / 870 / 640 / 400px 切换，宽屏与窄面板使用同一阅读路径。

## 数据口径（与原型示例数据的差异）

原型使用固定示例。实现只使用会话中可核实的数据，缺口保留为未知：

- **上下文分类**（7 类）：`system`、`schemas`、`user`、`assistant` 使用请求时上下文清单（manifest）的字符数；`inject`、`skill`、`tool` 由持久化消息重建。`skill` 仅在工具调用读取 `SKILL.md` 时归入该类别，不按名称推断。清单只记录工具结果的合计字符数，因此 `skill` 与 `tool` 按条目规模比例拆分这一合计，不虚构独立总量。
- **分类 token 为估算**：请求总量优先使用供应商 input；占用条以供应商计量决定填充比例，分类份额决定分段，两者不承诺精确相加。模型窗口未知时不显示百分比。
- **请求差异**：条目来自消息身份，因此“变化”只声明引入时间或未变化；保留文本可能只是快照节选，条目 token 按所属分类合计做比例展示。
- **上下文事件**：只列真实存在的压缩（`compaction` 贡献）与系统提示版本变更，并链接到变更首次出现的请求。
- **输出表现**：首输出延迟与输出速率来自 v2 计时；缺失样本留空，旧口径记录明确说明无法恢复，不当作零。
- **决策结果**：新增共享映射 `decisionOutcome()`（`packages/shared/src/decisions/session.ts`）作为唯一实现：`application.status` 优先，`applied` 但 `changed=false` 与 `unchanged` 同为“保持原状”；没有处理记录时为“未确认”；决策点不可用视为回退。`SessionDecisionTotals` 增加 `unchanged`、`discarded`，查询状态增加这两个值，服务端汇总与筛选使用同一函数。历史调用不计入行为结果统计，也不响应行为结果筛选（仍可通过请求失败/取消筛选找到），不再被并入“未确认”。
- **可靠性事实**：Overview 的诊断卡片读取决策报告中保留的运行时可靠性事实（已结算/未结算、任务预算、重复信号）；不可用时显示“未记录”，不推断为零。

## 与原型的有意差异

- 不实现原型自身的评审外壳：顶部原型栏、宽度选择器、场景切换、设计说明对话框与页脚（“仅用于设计评审”）。
- 标签不显示原型中的中英双行副标题，按产品语言显示单一标签；Decision 标签使用单数。
- 模板字符串与统计均按产品多语言（7 个 locale）实现；计数文案采用“标签：数量”形式或 i18next 复数，避免 “1 records” 一类英语语病。
- 原型把导出列为后续任务，本轮同样不提供导出。
- Map 保持现有实现与入口，而不是原型中的禁用占位。
- 历史会话的 Overview 决策卡只显示历史调用数并声明“行为结果未记录”，不再显示全为零的结果分布。

## 可重复验证

```powershell
bun run scripts/verification/run-redesign-workflow.ts `
  --output-dir=docs/verification/results/run-redesign-2026-10-23 --replace
```

工作流把真实的 `TrajectoryPanel`（Run 顶栏、三个视图、既有 Trajectory/Map 外壳）挂到 Vite + Chromium 上，数据来自手写但形状真实的会话与决策记录，不连接服务器、模型或凭据。**27 / 27 检查通过**，覆盖：

1. 顶栏与标签（状态、范围、五个入口、漫游焦点）；
2. Overview 五项指标、上下文演变（压缩标记）、选中请求跳转 Context、占用比例与七段分类（图例打开分类并定位到该请求）、输出速率与缺口、决策影响与失败高亮、诊断与环境、运行中统计边界；
3. Context 七个分类、分类与条目就地展开、阅读/原文/变化、切换请求保留展开、净变化与压缩下降、上下文事件；
4. Decision 处理结果与功能分布只读、按功能/结果筛选、就地展开三条证据与请求诊断、查看相关上下文；
5. 600px 面板单列堆叠、深色 390px（中文）、300 请求长历史、空会话、加载失败与重载；
6. 无页面执行错误。

截图：`wide-overview-light.png`、`wide-overview-selection.png`、`wide-context-light.png`、`wide-context-expanded.png`、`wide-decision-light.png`、`wide-decision-evidence.png`、`wide-decision-fallback.png`、`long-history-light.png`、`panel-{overview,context,decision}-light.png`、`dark-{overview,context,decision}-390.png`、`empty-session.png`、`failed-session.png`、`running-state.png`。

未覆盖：真实供应商流、真实会话数据、Electron IPC 与工作台外壳、Trajectory 与 Map 的界面本身、剪贴板权限（复制失败时保留可选中原文）。

## 回归与门禁

- `bun run typecheck:all`
- `bun run lint`（含 i18n 排序/一致性/覆盖、规模契约、视觉契约、设计漂移、对比度、文件规模、主题与 RPC 契约）
- `bun run lint:i18n:dead-keys` 仍有 160 个既有未引用键，本轮新增的 Run 键未被列入其中。

`scripts/verification/run-observability-workflow.ts` 移除了针对旧 Overview/Context/Decision 选择器的浏览器断言（这些界面已被本次重设计取代），保留计时与计量数据层检查；界面行为由上述 Run 重设计工作流验证。
