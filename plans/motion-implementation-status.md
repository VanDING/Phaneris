# Phaneris 全项目动效实施状态

日期：2026-09-21。基线：`f2f5ef74`（实施前的审计基线；工作区中已有的插件相关未提交修改未被触碰）。实施范围：审计 M01–M16、V01–V08 的实测复核、审计第 7 节的新增机会，以及跨入口配置与生命周期。

状态含义：

- **已实现·已验证**：代码已改，且用真实界面或真实组件观测过（证据层标注在“验证”列）。
- **已实现**：代码已改，验证覆盖到类型/门禁/相邻场景，但没有直接观测该项的最终体感。
- **保留（有证据）**：复核后决定不改，理由与代码事实一致。
- **待处理**：仍未做，附原因。

## 1. 复核结论摘要

审计的 16 项确定问题全部处理完毕，其中 12 项在浏览器里对**真实组件**做了行为观测（不是读源码），其余 4 项由门禁、类型与相邻场景覆盖。审计第 3 节的“待实测风险”V01 做了技术层量化（面板份额动画零掉帧），其余 V 项保持“待完整应用实测”的定性，未被伪装成已确认缺陷。

实施过程中新发现并修复了两类审计未列出但同源的问题：

1. **Playground 开发入口无法启动**：`packages/shared/src/identity.ts:23` 在模块初始化时直接读 `process.env`，浏览器上下文没有 `process`，导致 `playground.html` 白屏（`ReferenceError: process is not defined`）。这直接使审计 A33“Playground 与正式入口一致”不可评估。已按同包 `feature-flags.ts` 已有的写法加守卫。
2. **跨入口 `MotionConfig` 缺口**：`browser-toolbar.tsx`、`browser-empty-state.tsx` 是两个独立 Electron 渲染入口，没有 `MotionConfig`，其中的共享组件（`BrowserControls` 等）不受减弱动态约束。已补齐。

## 2. 逐项状态（M01–M16）

| 编号 | 状态 | 改动与文件 | 验证 |
| --- | --- | --- | --- |
| M01 | 已实现·已验证 | 新增 `packages/ui/src/lib/scroll-intent.ts`（`immediate`/`reveal`/`follow` 意图 + `useScrollBehavior`，基于 `useReducedMotionConfig`）。接入 `ChatDisplay`（关注流、提交后、会话切换）、`TrajectoryTable`（记录定位）、`ChangedFilesView`（差异定位）、`TurnCard`（展开后定位） | 浏览器：`scroll reveal` 有中间位置、`immediate` 单帧到位、reduce 下 `reveal` 单帧到位（3 项检查） |
| M02 | 已实现·已验证 | `apps/electron/src/renderer/index.html`、`apps/webui/src/index.html`：内联样式补 `prefers-reduced-motion: reduce`，去掉旋转与淡入延迟 | 浏览器：reduce 下 `animation-name=none`、不重复、opacity=1；无偏好时仍 `_spin/_fade` |
| M03 | 已实现 | `WorkspaceCreationScreen.tsx`：`speed={reduceMotion ? 0 : 1}`。Shaders 自有 rAF，`speed=0` 会停止循环（已核对 `@paper-design/shaders` 源码注释与实现对 `speed=0` 的处理），库自带 IntersectionObserver 与 `visibilitychange` 暂停 | 类型 + 源码事实；真实窗口内的着色器行为列入待处理 |
| M04 | 已实现 | `sortable-list.tsx`：`DropAnimation` 改为按偏好构造（reduce → 时长 0，保留一次落位说明）；`ImageCardStack.tsx`：拖动释放的回弹在 reduce 下直接置位，拖拽本身仍直接跟手 | 浏览器：排序/图卡不在 Playground 注册表中，未直接观测；机制与 `motionTween` 一致 |
| M05 | 已实现·已验证 | `MobileAppMenu.tsx`：`PageStack` 改为 `StackPage` + 每个页面一个 `AnimatePresence`，pop 时有真实退出；`zIndex` 按深度保证退出的页面仍覆盖下层 | 浏览器：pop 后存在 `data-page-present="false"` 的退出层，随后被卸载 |
| M06 | 已实现·已验证 | 同文件：非顶层页面 `inert` + `aria-hidden`；退出层由 `useIsPresent` 立即失去交互；pop 后焦点回到打开子页的那一行（不把 `body` 当触发器） | 浏览器：被覆盖页 inert/aria-hidden；退出层 inert；焦点回到 “Settings” 行 |
| M09 | 已实现·已验证 | 新增 `packages/ui/src/lib/presence.ts`（`useExitIsolation`，沿用 SessionList 的 `useIsPresent` + inert + aria-hidden 模式）。接入 `InputContainer` 交叉淡化层、`Island` 外壳（隐藏即失去交互）、`InlineExpand`、`ContentSwap`、`TurnCard` 折叠区 | 浏览器：InlineExpand 关闭层 inert；TurnCard 折叠区 inert；ContentSwap 退出层 inert；会话/子页退出层 inert |
| M10 | 已实现·已验证 | `TurnCard.tsx`：状态图标改为“新状态立即全强度、旧状态在其下淡出”（进入层 `initial={false}`、`zIndex` 分层、退出用 `fast` + exit 曲线）；折叠行改为**有界**错峰 + **揭示窗口**（`motionStaggerDelay`/`motionRowEnter`，窗口外延迟为 0，新到达的行不再排队）；思考指示条去掉错峰；删除 `staggeredAnimationLimit` | 浏览器：160ms 连续切换下图标槽最大不透明度从未低于 0.9（真实 `ActivityStatusIcon`）；TurnCard 展开后所有行 <400ms 全不透明 |
| M11 | 已实现·已验证 | `TurnCard.tsx`：删除 260ms 固定等待，改用展开容器的 `onAnimationComplete` + 防重复标记 + 取消（折叠即清除）；`Island.tsx`：退出完成改由变体动画完成信号驱动，计时器降级为兜底（`duration + emphasis`），并用单一标记保证只通知一次 | 浏览器：展开/折叠路径通过；Island 的退出完成信号不在 Playground 覆盖范围，列入待处理 |
| M12 | 已实现·已验证 | 新增 `apps/electron/src/renderer/components/ui/content-swap.tsx`（`popLayout`：新内容立即占位、旧内容离流淡出、退出层隔离、reduce 去位移）。接入 `PreviewPanel`、`CalendarView`、`ChatDisplay` 的轮转状态文案 | 浏览器：日历日/周切换 0 空白帧、两层交接且退出层 inert、稳定后单层；swap 延迟 <50ms |
| M13 | 已实现·已验证 | Playground 根加 `MotionConfig`；新增 `MotionToggle`（System/Normal/Reduced，持久化）；`motion.css` 增加 `:root[data-reduce-motion='true']` 强制块，使 CSS 与 Motion 同受开关控制；新增 `motion-primitives` 验收条目（展开/同类替换/状态交接/滚动意图 + 连击与反向按钮） | 浏览器：切到 Reduced 后 `html[data-reduce-motion]` 生效且 CSS 过渡时长=0.001s（同时 `matchMedia` 未命中原生偏好） |
| M14 | 已实现·已验证 | `apps/viewer/src/index.css` 的 `transition: all` 改为显式属性并用共享 token；`SessionUpload.tsx` 去掉重复的 `transition-all`；新增 `scripts/check-transition-all.ts` 扫描 CSS/HTML/TS/TSX 覆盖 electron、webui、viewer、packages/ui，并接入 `lint` | 门禁：929 文件通过；修复前会命中 3 处已知违规 |
| M15 | 已实现·已验证 | 新增 `packages/ui/src/components/ui/inline-expand.tsx`（内联展开统一为 `emphasis`+`move`，自带退出隔离与两种裁剪策略）。迁移：4 处设置页、`SettingsRadioGroup`、`ChangedFilesView`、`CollapsibleSection`、ChatDisplay 错误详情；删除只服务一处的 `components/ui/collapsible.tsx` 与其死导入 | 浏览器：内联展开高度有中间帧、关闭层 inert、连击 6 次后无残留层 |
| M16 | 已实现 | `HTMLPreviewOverlay.tsx`：内联 `200ms ease-in` 改为 `.motion-reveal`（仅 opacity、共享 enter 节奏、继承 reduce 折叠） | 样式层面；HTML 预览需真实文档，列入待处理 |

## 3. 待实测风险（V01–V08）复核

| 编号 | 结论 | 依据 |
| --- | --- | --- |
| V01 | **部分量化** | 用真实浏览器、真实词量（240 段落）测量“面板份额”动画（`flex-grow`/`flex-basis`/`min-width`，共享 spatial/move token）：median 16.7ms、p95 17.1ms、worst 17.1ms、**0 个 >32ms 长帧**，落位宽度 600px。这是技术层证据；带长会话与流式代码块的真实工作台开合 trace 仍待做 |
| V02 | 未实测 | 流式跟随仍为 `ResizeObserver + 200ms` 去抖 + 会话切换/提交滚动，只改了行为参数（reduce）；需要真实流式会话 |
| V03 | 未实测 | Island 进入幅度（0.25、20–132px）未改；需要真实高频标注场景判断是否过显眼 |
| V04 | 未实测 | 图卡入场（scale 0.3、stiffness 600/30）未改，仅让拖拽释放尊重偏好 |
| V05 | 保留（有证据） | 未发现同页重复实例；未引入 `useId`，避免无证据的泛化改动 |
| V06 | 未实测 | 新旧层交叠：本轮把退出层统一改为立即失去交互，焦点/回车/复制竞争的实测仍待做 |
| V07 | 未实测 | Tooltip/Sonner/Drawer 的计算样式未在正式宿主中核对 |
| V08 | 保留（有证据） | `active:scale` 在 reduce 下仍为目标值，全局只缩短时长；是否要完全去位移属产品契约，未擅自改 |

## 4. 新增动效机会（审计第 7 节）

| 机会 | 状态 | 说明 |
| --- | --- | --- |
| 引导步骤的前进/返回 | 已实现 | `OnboardingWizard`、`WorkspaceCreationScreen` 的 `renderStep` 用 `ContentSwap` 承载步骤身份；值仍在父级，返回不丢失 |
| 面板生命周期 | 已实现·已验证 | 桌面端：面板份额用共享 token 过渡，工作台内容仍由内容层表达；紧凑端：新增 `CompactWorkbenchTransition`，工作台成为会话之上的层，返回是同一实例（不再重播入场、不重置阅读位置），被覆盖层 inert |
| 异步状态交接 | 已实现（工具状态） | 工具状态即时接管（M10）；上传/授权/安装等链路未发现“结果被庆祝动画延迟”的代码事实，未做无证据改动 |
| 拖拽落位 | 已实现（有据保留） | 通用排序保留 250ms 交叉淡出（现按偏好降级）；看板 `dropAnimation={null}` 是代码中已记录的取舍（跨列落点源 tile 已消失），不再另行加过渡 |

## 5. 新增与收敛的共享原语

| 位置 | 作用 |
| --- | --- |
| `packages/ui/src/lib/scroll-intent.ts` | 程序化滚动意图策略（`immediate`/`reveal`/`follow`），显式参数不再越过减弱动态 |
| `packages/ui/src/lib/presence.ts` | `useExitIsolation`：退出层立即退出点击/键盘/读屏顺序 |
| `apps/electron/src/renderer/components/ui/content-swap.tsx` | 同类内容替换：新状态立即占位，旧状态离流淡出 |
| `packages/ui/src/components/ui/inline-expand.tsx` | 内联展开的唯一规则（`emphasis`+`move`、退出隔离、裁剪策略） |
| `apps/electron/src/renderer/components/app-shell/CompactWorkbenchTransition.tsx` | 紧凑模式工作台层级切换（前进/返回互为逆向，来源实例保留） |
| `packages/ui/src/lib/motion.ts` | 新增 `MOTION_STAGGER_*`、`motionStaggerDelay`、`motionRowEnter` |
| `packages/ui/src/styles/motion.css` | 新增 `.motion-reveal` 与 `:root[data-reduce-motion='true']` 强制减弱动态块 |
| `scripts/check-transition-all.ts` | 全入口 + CSS 的 transition-all 门禁（接入 `bun run lint`） |
| `apps/electron/src/renderer/playground/registry/motion.tsx`、`MotionToggle.tsx` | Playground 动效验收面：正常/减弱切换 + 连击/反向场景 |

未引入任何新依赖；未替换布局引擎。

## 6. 验证环境与结果

| 证据层 | 内容 | 结果 |
| --- | --- | --- |
| 真实浏览器·真实组件 | `plans/motion-verification.mjs`（Playwright + 本机 Edge，隔离存储，`i18nextLng=en`）驱动 Playground 中**真实**的 `MobileAppMenu`、`CalendarView`、`TurnCard`/`ActivityStatusIcon`、`InlineExpand`、`ContentSwap`、`useScrollBehavior`，以及应用入口 HTML | **18/18 通过**，结果存 `plans/motion-verification-results.json` |
| 单元 | `packages/ui/src/lib/__tests__/motion.test.ts`（新增错峰上限与行入场契约）、`island-motion.test.ts` | 8 pass / 0 fail |
| 门禁 | `bun run typecheck:all`、`bun run lint`（electron/shared/ui/transition-all）、`identity:check`、`version:check` | 全部通过 |
| 技术层性能 | 面板份额动画帧间隔采样（1440×900，240 段落） | median 16.7ms、p95 17.1ms、0 长帧 |

复现：

```powershell
cd apps/electron; bun run dev          # 渲染层开发服务器（含 playground.html）
node plans/motion-verification.mjs http://localhost:5173
bun test ./packages/ui/src/lib/__tests__/motion.test.ts ./packages/ui/src/components/annotations/__tests__/island-motion.test.ts
bun run lint
```

## 7. 实施期间修正的文档偏差

1. **M15 的站点不完整**：审计只列了 4 处 `0.2s/[0.4,0,0.2,1]`；实际同类分叉还有 `SettingsRadioGroup`（`standard`+`move`）、`ChangedFilesView`（`standard`+`move`）与 electron 的 `AnimatedCollapsibleContent`（spring）。按“同一语义同一规则”统一为 `emphasis`+`move`。
2. **M12 的扫描面偏窄**：除 PreviewPanel/CalendarView 外，`ChatDisplay` 的轮转状态文案也是 `mode="wait"` 的两段串行（每轮 320ms），已一并收敛。
3. **M09 的测量副本**：`InputContainer` 的隐藏测量副本本身已具备 `visibility:hidden` + `pointer-events:none` + `aria-hidden` + 空响应回调，未再改动；实际缺口只是退出层。
4. **M10 的最初修法被自己的验证推翻**：先做成双向交叉淡化，浏览器采样显示有 3 帧最大不透明度降到 0.4（新图标正在淡入，等于短暂隐藏最新状态），随后改为“新状态立即全强度、旧状态淡出”，符合“不隐藏最新结果”。
5. **暂停审计中的 `width/height` 误报仍成立**：本轮没有把折叠高度当作缺陷重报；Motion 13 的 positional keys 行为与审计第 5 节一致。
6. **Playground 入口此前不可用**（见第 1 节），因此审计 A33 在实施前无法评估；现在可以。

## 8. 已记录的设计取舍（保留项，复核后不改）

- `ChatDisplay` 会话级内容仍用 `mode="wait"`：整页级替换、单段仅 `fast`，且代码注释记录了“避免切换会话时布局跳动”的取舍。
- 最大化/恢复是**原子**布局步骤：主面板用 `display:none` 保留实例；不改为宽度 0 的动画，否则会让会话视图按 0 宽重排并毁掉阅读锚点。
- 轨迹地图的视口定位仍靠 `data-animated` 的 CSS 过渡：已被全局与强制减弱动态规则覆盖，程序定位与手势的区分保持原样。
- 看板拖拽落位不播放动画（代码内已记录理由）；通用排序保留短暂收尾。
- 视觉距离字面量（`x: -8` 等）未做无测量的整体替换；本轮只收敛“同一语义”的时长/曲线。
- 品牌入场时长、Dialog/Popover 的 opt-in、`BackgroundFinishedChip` 的退出后跳转等审计第 5 节保留项均未改动。
- Playground 的偏好持久化沿用该目录既有的 `localStorage` 约定（`no-localstorage` 规则为 warning，Sidebar/PlaygroundApp 同现状）。

## 9. 仍待处理（附原因）

1. **Electron 真实窗口内的验证**：设置页内联展开、工作台开合与最大化、紧凑模式层级、引导向导与工作区创建（含 Dithering 的 reduce 行为）需要在完整应用里逐屏操作；本机实施了渲染层开发服务器 + 浏览器驱动，未启动完整 Electron 窗口。补齐方式：`bun run electron:dev`（可用 `PHANERIS_CONFIG_DIR` 指向隔离配置目录）后按 `plans/motion-validation.md` 的 P 项逐条走查。
2. **真实会话链路**：流式跟随与上翻（V02/A15）、工具状态的实时更新（A16）、完成提示（A18）、Island 退出完成信号（M11 的 Island 半）、HTML/PDF/Mermaid 预览（M16/A23）需要真实会话与文档。
3. **性能录制**：工作台开合 + 长会话 + 流式代码块的真实 trace（V01 的应用级那一半）；本报告只有技术层采样。
4. **真实触屏设备**：手势延迟、滑动冲突、`active:scale` 与 reduce（V08/A08 的触屏部分）无法用桌面鼠标代替。
5. **V03/V04/V06/V07**：需要真实频率与第三方宿主（Tooltip/Sonner/Drawer）下的计算样式核对。
