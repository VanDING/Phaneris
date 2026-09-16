# 新对话页 hero — 设计说明与实施记录

对象：Phaneris 桌面端「新对话」空白页 —— 会话已创建、0 条消息时，消息区上方约 480px 的空白。
状态：**已实施**（2026-09-16）。设计演示：`docs/new-session-hero-demo.html`（可交互，含主题 / 状态 / 语言 / 宽度 / 动效五个开关）。

---

## 1. 问题

非 compact 模式下 `session.messages.length === 0` 时，`ChatDisplay` 不渲染任何内容：消息区原本是
一个占满剩余高度的空 `div`，输入框贴在底部，窗口中央约 480px 的区域完全空白。

参照产品（Codex / DeepSeek）的新对话页同样是空的，可借鉴的是**构图逻辑**（只剩一个焦点、输入框是
唯一主操作），不是它们的空白。

## 2. 定稿方案

两样东西，没有第三个元素：

```
        ▮            品牌符号 PhanerisSymbol，宽 118px（渲染高 160px）
  山间何事，松花酿酒，    slogan，17px，与符号间距 22px
    春水煎茶。
```

| 元素 | 内容 | 来源 |
| --- | --- | --- |
| 品牌符号 | `PhanerisSymbol tone="accent"`：五个面各一条渐变，两端由主题 accent **真正混入黑/白**（`color-mix`），因此有实体感且跟随主题 | 仓库既有品牌资产 |
| slogan | 中文 `山间何事，松花酿酒，春水煎茶。`　英文 `Let it exist, let it go.` | 新键 `newSession.slogan` |

**符号的三种渲染（同一个组件，靠 `tone` 切换）：**

| tone | 画法 | 用在哪 |
| --- | --- | --- |
| `flat`（默认） | 单色剪影，`currentColor` | 侧栏、菜单、按钮等 chrome 场景 |
| `accent` | 五个面的渐变，明暗来自主题 accent 与黑/白的 `color-mix`（暗面 −62%…−25%，亮面 +20%…+58%）；渐变轴照抄正稿 | 启动页 + 空会话 hero |
| `brand` | 固定全彩，渐变逐字取自 `resources/icon-app.svg`（= `phaneris-logo-primary.svg`） | 需要品牌正稿的场合（营销 / 打包 / 应用图标），**不跟随主题** |

**关键教训（走了三次才到位）：**

1. 先用**统一 fill-opacity** 做明暗 → 把标记的 identity 改掉了（用户拿 `phaneris-logo-primary.svg` 指出）。
2. 改用**固定全彩渐变** → 忠实于正稿，但在 graphite / Ink 下永远是一块紫色，同样不对。
3. 改用 **currentColor + 分层 opacity** → 颜色跟随主题了，但**透明度只能把颜色往背景里冲淡，不能把它压深**。深色面（0.33 / 0.5）看起来是"洗掉的颜色"，整体发虚、没有重量——用户描述为"很虚、很淡，各个主题下都是"。

最终做法是让明暗来自**真正的颜色混合**（`color-mix(in srgb, currentColor N%, #000 / #fff)`）而不是透明度，渐变轴与正稿一致；正面（第 5 块）刻意给最深的混合，因为它正是正稿里提供重量的那一面。这样既保住了主题跟随，又拿到了正稿的实体感。

**没有字标**：产品名已出现在侧栏、启动屏、窗口标题与「关于」里，空会话页再写一遍是重复。
去掉字标后 slogan 成为唯一文字，因此字号提到 17px、间距收到 22px，整块重心不散。

颜色只用 `--foreground` 与 `--muted-foreground`，无描边、无背景、无图形、无装饰。
字号 17px 与 `tracking-[0.02em]` 是刻意的：应用基础字距是 −0.006em（为拉丁文 UI 调的），
而中文标语需要的是呼吸而不是收紧。

## 3. 动效（三段式，只在进入空会话时跑一次）

| 阶段 | 时间 | 动作 |
| --- | --- | --- |
| 画 | 0 → 900ms | 符号轮廓画满（2px 描边，`stroke-dasharray/offset: 2600`；五块多边形周长约 2260 单位） |
| 上墨 | 420 → 1120ms | 描边与填色重叠约 400ms，读作「上墨」而不是淡入 |
| 题词 | 620 → 1320ms | slogan 上浮 6px 淡入（先有形，后有话） |
| 呼吸 | 1.6s 起，14s 一轮 | 符号缩放 ±1.2%、slogan 透明度 1 → 0.8 → 1，同频同相 |

- **全部纯 CSS**（`index.css` 的 `.logo-mark` + `.craft-hero-*`），无 JS 驱动、无 rAF、无 motion 库 ——
  不占主线程，`ChatDisplay` 的流式重渲不会重新触发它。
- 时长**刻意长于** `--motion-duration-*` 刻度（最长 280ms）：这不是状态切换，而是一次性的品牌时刻，
  画的本身就是重点。演示页里的时长比实现更长（2.1s），实施时按应用的响应感压到 900ms。
- **同一套入场动画复用于启动页**（`components/SplashScreen.tsx`）：`.logo-mark` 提供画 + 上墨，
  时长通过 `--logo-draw-duration` / `--logo-ink-delay` / `--logo-ink-duration` 三个自定义属性按场景注入，
  所以两处不共享时间也不需要两份关键帧。启动页用 1600ms / 900ms / 1100ms（首屏印象可以慢），
  空会话页用默认 900ms / 420ms / 700ms（响应会话切换要快）。`App.tsx` 的 `SPLASH_MIN_VISIBLE_MS = 2200`
  保证冷启动再快也不会把动画截断。
- **`prefers-reduced-motion` 无需额外规则**：`motion.css` 把所有动画压到 1ms、迭代次数压到 1，
  自然落在最终状态（实心符号 + 完整标语）。已在模拟 reduced-motion 的上下文里实测确认。

## 4. 实施位置与改动清单

**新增** `apps/electron/src/renderer/components/chat/NewSessionLanding.tsx`
—— 纯展示、`React.memo`、无 props、无脚本。

**改** `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`（+30 / −1）：

1. 新增 `showNewSessionLanding` 判定：`!!session && !compactMode && !messagesLoading && !messagesLoadError && session.messages.length === 0`。
2. 消息区外面包一层 `grid min-h-0 flex-1 grid-cols-1`，消息区与 hero 各自 `col-start-1 row-start-1` **共用同一个网格单元**。
3. 在消息区之后渲染 `<NewSessionLanding />`，与消息区同格叠加。

**为什么用 grid 同格叠加而不是绝对定位铺满整个面板**（这是踩过的第二个坑）：hero 若 `absolute inset-0` 铺满整个内容层，它的居中基准就包含了输入框占掉的那 187px，标记会落在视觉中心**偏下约 95px**。放进与消息区同一个网格单元后，hero 的高度天然等于"输入框以上的净空"，居中即正确，且不需要测量或写死任何输入框高度。

**另一个踩过的坑（第一个）**：曾把消息区在空会话时切成 `hidden`，以为要给它让位。结果 `hidden` 把撑开高度的 `flex-1` 也一起拿掉了，输入框被顶到面板顶部——截图里一眼可见。空消息区本来就该留在流里：它那 480px 的空白正是 hero 要覆盖的地方。

**改** `apps/electron/src/renderer/index.css`（+62）：`.craft-hero-mark` / `.craft-hero-copy` 与四个关键帧。

**改** 7 个语言文件（各 +1）：`newSession.slogan`，按字母序落在 `multiSelect.setLabels` 之后。

## 5. 为什么门槛要三个条件

- `messagesLoading`：切换会话时本组件带着上一个会话的消息渲染，且历史是懒加载的。只判断
  `messages.length === 0` 会在已有对话上闪一下 hero。`deriveSessionMessagesLoadState` 给
  "已知空会话" 直接返回 `messagesReady: true`，所以真正的新会话不会被这条门槛挡住。
- `messagesLoadError`：加载失败时有专门的错误卡与重试按钮，不该再叠一层 hero。
- `compactMode`：`EditPopover` 的迷你会话同样会走到 `turns.length === 0`，而 hero 不属于 400px 的浮层。
  同时 compact 分支已有自己的空态文案（`ChatDisplay.tsx` 的 `editPopover.whatToChange`）。

## 6. 实施风险清单（逐条有出处）

| # | 风险 | 处理结果 |
| --- | --- | --- |
| R1 | Radix ScrollArea 的内容层是 `display:table`，`h-full` / `flex-1` 撑不开 | 已避开：hero 落在 ScrollArea 之外 |
| R2 | 消息区遮罩会把上下 32px 淡掉 | 已避开：hero 不在遮罩层内 |
| R3 | 在输入框任意祖先上加 `transform` / `filter` / `contain:paint` 会破坏 `mention-menu.tsx` 的 `position:fixed` | 未给任何公共祖先加变换，hero 与输入框平级 |
| R4 | 不能在输入框外面加 `overflow-hidden` | 未改输入区结构 |
| R5 | 门槛漏掉 loading / error 会闪 hero | 已用三条件 |
| R6 | `turns.length === 0` 在迷你会话里也成立 | 已保留 `!compactMode` |
| R7 | 绝对定位的兄弟节点吞滚轮事件 | 根节点 `pointer-events-none`；本方案无点击元素，全部穿透 |
| R8 | ChatDisplay 未 memo，流式输出每个 token 都重渲 | hero 是 `React.memo` 且无 props，不参与重渲 |
| R9 | 项目未声明 `@custom-variant dark`，`dark:` 跟随系统而非应用主题 | 只用语义 token，未用任何 `dark:` |
| R10 | ESLint 禁硬编码 z-index / 非标准阴影 / `transition-all` | 用 `z-10` 语义层级、`shadow-none`（未使用阴影）、未用 `transition-all` |
| R11 | WebUI 直接复用 electron renderer | hero 会同时出现在 WebUI，本次接受 |

## 7. 验证记录

| 项目 | 结果 |
| --- | --- |
| `apps/electron` typecheck | 通过 |
| `apps/electron` lint | 0 error（113 warning 全部为既有问题，新增/改动文件无新增 warning） |
| i18n parity | 通过（6 个非英文语言各 2314 键） |
| i18n sorted | 通过（无漂移） |
| i18n coverage | 通过（2386 处引用、2314 个英文键） |
| 组件渲染（真实渲染器 CSS） | 深色 / 浅色 + 中 / 英四种组合截图确认；`craft-hero-draw/ink/breathe` 与 `craft-hero-rise/pulse` 计算样式实测挂载 |
| 符号尺寸 | 实测 118×160 px |
| `prefers-reduced-motion` | 动画名保留但被全局压到 1ms/1 次；`fill-opacity: 1.00`、`stroke-dashoffset: 0`、标语 `opacity: 1.00`，即最终状态 |

渲染验证方式：用应用自己的 Vite 配置临时挂一个入口（`__hero-check.html/.tsx`，验证后已删除），
加载真实的 `index.css` 与真实组件，再做截图与计算样式断言。playground 在本机因既有的
`process is not defined` 无法启动，与本改动无关。

## 8. 仍需人工确认的部分

**没有在真实窗口里跑过完整应用流程。** 已验证的是组件本身在真实 CSS 管线下的渲染，尚未验证的是
`ChatDisplay` 集成后的实际观感：hero 与输入框的垂直关系、在真实面板宽度下的留白、以及
左侧栏 / 右侧面板同时打开时的表现。建议 `bun run electron:dev` 后新建一个会话亲眼确认。

## 9. 若日后要调整

- **改时长**：`index.css` 的 `.craft-hero-mark` / `.craft-hero-copy` 两个 `animation` 声明。
- **改文案**：7 个语言文件的 `newSession.slogan` 一处键。
- **想关掉动效**：删掉这两条 `animation` 声明即可，静态状态本身就是最终状态。
- **想加回字标**：`PhanerisSymbol` 下方加一行文本即可，无需改结构。
