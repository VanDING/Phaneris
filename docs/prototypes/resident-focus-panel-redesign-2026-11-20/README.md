# 助手 Focus 面板优化

Status: implemented — 2026-11-20 完成代码与本机隔离验收；真实组件与真实 CSS 在浏览器中
测量通过（`bun run verify:assistant-focus-board`，5 场景）。真实 Host 投影与权限/验收
流程未迁移。

**已实施**：本目录保留为设计记录与回归依据，界面截图代表评审稿。落地代码见
[FocusBoard.tsx](../../../apps/electron/src/renderer/components/resident-assistant/FocusBoard.tsx)、
[focus-board.css](../../../apps/electron/src/renderer/components/resident-assistant/focus-board.css)、
[focus-board.ts](../../../apps/electron/src/renderer/components/resident-assistant/focus-board.ts)。

**评审页**：双击 `index.html`（纯静态，无构建、无网络依赖），或
`node docs/prototypes/resident-focus-panel-redesign-2026-11-20/serve.mjs` 后访问
<http://127.0.0.1:49731>。它演示的是方向而非产品当前状态。

布局不换。两栏、容量信息、阶段→动作的派生规则、面板尺寸全部保留。
页面顶栏左上角平铺三组控制（承载面 / 对照 / 档位），右侧不放任何入口；
「对照」可以在同一组数据上切「现状 / 优化后」，逐条看差别。

落地对象：`apps/electron/src/renderer/components/resident-assistant/FocusBoard.tsx` +
`focus-board.css`。

## 五处改动

### 1 · 档位条 = 切换器（不再有标题切换条）

现状有两套东西在说「任务」：容量条（18 个固定方块）与任务标题条
（`.focus-segments`）。而容量条常把标题条挤没：389px 面板上 18 个座位
**303px**，标题条可见宽度 **0px**；620px 面板上也只有 188px。

现在合成一条，且**不再有标题切换条**：档位条里每一根条就是一个任务，
点它即切换聚焦。**所有条等高**（10px），整区只占 **20px** 纵向空间 ——
不靠高度差表达状态（那要吃 22px 高度且看起来很碎）。选中项的名字与状态
显示在条下方那一行 —— 条只有填充，名字必须能读。

### 2 · 条数跟着任务走

容量是 18 个槽，但只有 5 个任务在跑时，18 个方块里有 13 个永远不表达任何东西。
现在**只画在跑的任务**：1 个任务 1 根条，5 个 5 根，19 个 19 根。容量作为
文字留在副标题（`运行 1 / 18 · 排队 1`），不再用几何画空闲槽。

### 3 · 条本身读得出状态

现状只有「满 / 空」两态，且只靠颜色区分。现在**等高条，用填充与纹理区分状态**：

| 状态 | 填充 | 颜色 |
| --- | --- | --- |
| 需要你决定 | 实心 | 琥珀 |
| 执行中 | 实心（略透） | 品牌紫 |
| 排队 / 暂停 / 未就绪 | 实心（更透） | 中性灰 |
| 失败 | 斜纹 | 红 |
| 已验收 / 已终止 | 极淡 | 灰 |

选中项是一道描边环（它是「我正在读哪一个」，与状态无关）。每根条都有
`aria-label="任务名 · 状态"`，不依赖颜色传意。

### 4 · 卡片字号收一档

现状是 **16px 标题 + 一片 10px**：大的太大（DESIGN.md 写明面板标题是 13px
semibold，16px 已试过并回退），小的太小（中文低于 12–14px 糊成灰块，
而要求原文正是 10px）。

现在记录卡片内最大 **14px**：标题 14、要求原文 13、正文 13、标签 11–12、
徽标 10。整块面板不再有 16px 的文字。

### 5 · 两个承载面，两种排布

同一个组件渲染在两处，但尺寸差一倍，排布不该一样：

- **标题栏 peek**（外部窗口悬停 / 点击）：居中浮层，**保持当前两栏** ——
  左记录、右产物。
- **助手侧边栏**（进入助手界面点「更多」）：一块**靠右的悬浮面板** ——
  四周留 20px 边、圆角与阴影同 peek 一档，不是铺满；内容
  **自上而下纵向单栏** —— 头部 → 档位条 → 记录 → 产物 → 动作。
  窗口窄而高，横着分栏只会把每个字挤成两半。

两者共用同一份记录内容与同一套档位条，只是排布不同 —— 是同一个组件换布局，
不是两套实现（`verify.mjs` 里有一条断言专门核对这点）。

## 实测数字

先量数字再下判断，同一浏览器、同一数据：

```
档位条根数            现状            优化后
  peek / 1 个任务      18 个方块       1 根条
  peek / 5 个任务      18 个方块       5 根条
  peek / 19 个任务     18 个方块       19 根条

档位区高度            26px（18 个固定方块）  20px（一行等高条）
条高                  所有条统一 10px（等高）
记录字号              10–16px          13–14px
标题切换条            1 套（与容量条打架）  0 套（已合并）
侧边栏形态            铺满右侧          靠右悬浮，四周留边
```

## 共同遵守的约束

- 字号、控制高度、圆角取自契约档位，不新增数值。
- accent 只用于意图（选中、需要你、正在跑），不填充大面积。
- 长文本在容器内换行（`overflow-wrap: anywhere` + 完整 `min-width: 0` 链）；
  只有工作栏那种一行索引才 ellipsis，全文在记录里读。
- 面板固定尺寸（`min(560px, 100% - 24px)`，超出内部滚动），不随内容变化。
- 每档都有 hover / active / focus-visible / selected / disabled / empty /
  loading / error / offline；`prefers-reduced-motion` 与 `pointer: coarse` 都照顾到。
  触摸下只扩大条的命中区域，**不改条的形状** —— 形状是状态编码。

## 交互

面板内全部可点：点档位条或工作栏条目切换任务、执行动作（暂停/恢复/终止/验收/返工）、
预览产物。键盘 ←→↑↓ 在档位条与列表之间移动，动作后焦点不掉回 body。链接可分享：

```
index.html?surface=peek|dock
         &version=current|optimized
         &theme=light|dark
         &lang=zh|en
         &state=ready|one|long|overflow|many|empty|loading|error|offline
         &select=<taskId>
```

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 评审页外壳、左上角控制栏、设计说明弹窗 |
| `styles.css` | 令牌取自 `packages/ui/src/styles/theme-tokens.css`（Default 亮/暗）与 DESIGN.md 契约档位；两块承载面 + 两版渲染器样式 |
| `app.js` | fixture（形状对齐 `TaskProjectionView`）、两版渲染器、两块承载面、交互与键盘 |
| `serve.mjs` | 本机静态服务（默认 49731，仅监听 127.0.0.1） |
| `verify.mjs` | 两块承载面 × 五个档位 × 两版：先测量再断言，输出 `verification/report.json` 与截图矩阵 |
| `verify-review-page.mjs` | 评审页外壳本身（承载面切换、档位、主题、语言、说明弹窗） |
| `verification/` | 截图与报告；已被 `.gitignore` 的 `docs/prototypes/**/verification/` 排除，不入库 |

## 自检

```powershell
node docs/prototypes/resident-focus-panel-redesign-2026-11-20/verify.mjs
node docs/prototypes/resident-focus-panel-redesign-2026-11-20/verify-review-page.mjs
# 指定浏览器：$env:PHANERIS_CHROMIUM = "<chromium 可执行文件>"
```

`verify.mjs`：**48 / 48 通过，0 个页面错误**。覆盖：

- 条数 = 任务数（1 / 5 / 19 三种规模），且现状仍是固定 18 个
- 没有第二套标题切换条；点第 N 根条聚焦第 N 个任务
- 条高度按状态严格分级；每根条都有可读标签
- 记录卡片最大 14px、最小 ≥ 12px；现状仍停在 10px
- peek 是浮层（左右留边）、dock 是**靠右悬浮**（四周留边、高度小于舞台）、纵向单栏
- 档位条等高等宽、档位区不超过 24px 纵向空间、状态由填充与纹理区分
- 两块承载面用的是同一份记录内容
- 所有档位无横向滚动、无越界；键盘焦点；动作跟随状态；四种状态面；亮暗 × 中英

`verify-review-page.mjs`：**24 / 24 通过**。验证评审页本身。

## 实施边界

本目录只新增演示稿，未修改产品组件、主题引擎或全局 `DESIGN.md`。所有内容为设计
fixture，未读取真实会话、模型服务或 RPC。落地时：

1. `FocusBoard.tsx` 结构按本稿调整：删掉 `.focus-segments` 标题条，容量方块换成
   一根一任务的档位条；`focus-board.ts` 的纯派生逻辑（`focusGroupOf` /
   `initialFocus` / `actionsFor` / `segmentsFor`）继续复用，`segmentsFor` 的
   过滤规则直接成为「哪根条要画」的规则。
2. `focus-board.css` 的 `.focus-*` 选择器按本稿重写，不要与旧样式并存。
3. **类名不要用 `.stage` 同时表示容器与状态词** —— 本稿实测踩到：状态词继承了
   容器上的 `flex: column`，被撑成椭圆药丸。容器现名 `.frame`。
4. 承载面由调用方（`ResidentAssistantIsland` / `ResidentAssistantControls`）选：
   peek 传 `surface="peek"`，助手侧边栏传 `surface="dock"`。
5. 需要补齐 i18n：`residentAssistant.board.asked` 等新文案需进 7 个 locale；
   现有的 `board.capacity` / `tasks.stage.*` 等键继续使用。
