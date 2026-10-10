# Run → 决策 视图改版 · 演示稿

**打开方式**：双击 `index.html`（纯静态，无构建、无网络依赖）。

这是一份**评审用**的对比稿，不是最终实现。目标是先定方向，再动代码。

> **状态（第 3 版 · 已实施）**：方向 **C · 决策板** 已按本稿落地到
> `apps/electron/src/renderer/components/content-panels/session-decisions/`，
> 实施记录与截图证据见 [会话决策专项验收](../../verification/session-decisions.md#视图改版2026-10-10)。
> 本目录保留为设计决策与组件映射的依据，不再随实现同步更新。
>
> 实施时对演示稿做了三处修正，都是演示阶段看不到的真实约束：
> ① `turnId` 是不透明的关联 ID（不是轮次序号），所以「第 N 轮」改为原样显示并截断；
> ② 契约里没有 `baseline` 字段，「当时基线」一行取消；
> ③ 服务端查询契约没有文本检索，工具栏的搜索框取消 —— 在分页列表上做客户端搜索会静默漏掉记录。

---

## 这份稿子在说什么

当前实现是 `apps/electron/src/renderer/components/content-panels/SessionDecisions.tsx`
（148 行单文件，`df404fdf` 引入）。它已经把全部事实取回来了，问题在于**把所有事实平铺成了一条灰色长列**：
统一 11–12px、统一 `border-y` 分隔、统一右对齐灰字。信息没有层次，也就没有可读性。

所以这份稿子只做两件事：**重建信息架构**、**把视觉系统换成 Run 已有的那一套**。数据契约不动。

## 三个方向

| | 定位 | 窄面板（420–560） | 宽面板（≥ 820） |
|---|---|---|---|
| **A · 台账** | 列表即索引，详情在旁；选择而非展开 | 列表↔详情整屏切换 | 真正的左右主从 |
| **B · 时间流** | 按轮次分组的活动流，就地展开 | 天然适配 | 单列会显得空 |
| **C · 决策板** ← **已选** | 状态行 → 四块瓷砖 → 功能对比 → 决策记录 | 矩阵收起 + 卡片列表 + 底部抽屉 | 矩阵展开 + 表格 + 右侧抽屉 |

三个方向**共用同一份 fixture 数据**（规模取自现有验收截图：59 事项 / 4 改变 / 4 回退 /
$0.06 + 4 次未知 / 8 项功能 / 59 次请求）。切换方向只换信息架构，不换数据。

## 与 Run 的对齐（第 2 版的主要工作）

组件、字号、间距、圆角、色调全部从 Run 已有标签页里取，来源与做法逐条列在
`index.html` 的「与 Run 其余四个标签页的对齐」一节。要点：

| 来源 | 取什么 |
|---|---|
| `TrajectoryOverview.tsx` | 外壳与 `max-w-5xl`、状态行、指标瓷砖、分区标题、KV 列表、列表容器、卡片 |
| `TrajectoryToolbar.module.css` | 24px 筛选按钮 / 分隔线 / 26px 搜索框 / 11px 计数 —— 替换掉原来的裸 `<select>` |
| `TrajectoryTable.module.css` | 30px 行高、3px 选中色轨、等宽时间列、9px 轮次标记、`focus-visible` 内描边 |
| `trajectory-theme.css` | 整套 `--dsw-alias-*` 别名层；状态标签沿用表格的 `kindTag` 规格 |
| `index.css` · `motion.css` | `--foreground-N` 阶梯、theme radius、motion 时长与缓动 |

**两处刻意偏离**（需要确认）：① 「已应用」不用绿色（会被读成「已批准」，违反设计文档 §3.3），
改用中性底 + 品牌色文字；② 不再内嵌第二层标签条，改用与概览一致的分区。

## 顺手修掉的 4 个真实缺陷（都已在当前实现里核对过）

1. **`trajectory.decisions.status.applied` 这个键不存在。**
   `status()` 在「已应用但未改变基线」时返回 `'applied'` —— 这是最常见的形态
   （例如风险标记附加成功但没改动任何东西），于是界面上直接漏出这串键名。
   i18n 覆盖率门禁跳过动态键，所以三个门禁都抓不到。
2. **`failed` 与 `cancelled` 在行内状态里不可达。**
   `status()` 只从 `application.status` 取这两个值，而该字段的联合类型是
   `applied | unchanged | fallback | discarded | unknown` —— 根本没有它们。
   请求层的 `failed` / `timeout` / `cancelled` 从未被读过。
   后果：按「失败」筛选出来的记录，徽标上写着「未确认」。
3. **三个计数串没有复数形式。** 英文下会出现 `1 model attempts`、`1 points · 0 changes`
   —— 现有验收截图 `docs/verification/results/session-decisions/light-en-1040-detail.png`
   里就是 `1 points · 0 changes`。
4. **详情把原始 JSON 倾倒进 `<pre>`。** 「触发来源」直接 `JSON.stringify`，可读信息被噪声淹没。

顶部**「状态逻辑：修正后 / 现状」**开关可以现场对比第 1、2 条：
切到「现状」，`已应用` 的记录会漏出键名，失败/取消的记录一律显示成「未确认」。

## 交互

全部可点：切换方向 / 面板宽度 / 数据状态 / 主题 / 语言、筛选 chip、搜索、轮次下拉、
记录选中、就地展开、抽屉、排序、↑↓ 键盘导航。

链接可分享：

```
index.html?dir=A|B|C
         &width=420|560|820|1040
         &theme=light|dark
         &lang=zh-Hans|en
         &state=ready|empty|loading|error|unsupported|disabled|nomatch|nosession
         &legacyStatus=1        # 用当前实现的状态推导
         &selected=none|<itemId>
         &matrix=open|closed    # 仅方向 C：功能对比矩阵
         &drawer=1              # 仅方向 C
         &featureOpen=1         # 功能分布展开全部
         &view=panel            # 只渲染面板本身，用于截图
```

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 评审页：现状诊断、三个方向、对比表、与 Run 的对齐映射、共用视觉系统、当前实现对照 |
| `styles.css` | Token 取自 `apps/electron/resources/themes/default.json`（Twilight「Default」）+ Run 的 `--dsw-alias-*` 别名层 |
| `app.js` | fixture + 三个方向的渲染器 + 交互；i18n 字典里 `(NEW)` 标注的是需要补进 7 个 locale 的键 |
| `verify.mjs` | 交互自检（Playwright）：点一遍三个方向的主要交互，输出 `verify-report.json` |
| `shots/` | 截图矩阵：3 方向 × 窄/宽 × 浅/深 × 中/英，以及各数据状态 |

## 自检

```bash
PHANERIS_CHROMIUM=<chromium 可执行文件> bun run verify.mjs
```

当前结果：**40 / 40 通过，0 个页面错误**。覆盖窄面板整屏切换与返回、宽面板主从并置、
筛选与计数、搜索不吞焦点、↑↓ 键盘导航、分页到 60 条、B 的展开/收起与英文单复数、
C 的四块瓷砖同权重（费用在最后）、状态行与 36px 工具栏、30px 行高与等宽时间列、
矩阵点击筛选、表格↔卡片降级、矩阵默认收起/展开、底部抽屉贴边、
6 种数据状态、以及「现状 / 修正后」状态推导的差异。

---

本目录是**审批前**的评审产物，位于 `docs/design/decisions-view-redesign/`。
方向定了以后：实施落点见页内每个方向的「实施落点」一栏。
不需要留档的话，实施完成后直接删掉本目录即可（`check:docs` 只扫描 `*.md`，不会拦 HTML 与截图）。
