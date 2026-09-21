# 上游 v0.13.4 吸纳评估

- 日期：2026-09-21。本仓基线：`c89614a5`；上游基线：`b2d6c8aa`（`v0.13.4`）。
- 上游每次发布压成单个提交，因此 `b2d6c8aa` 的父提交即 `v0.13.3`（`e8963854`），也就是本仓 `main` 与上游的 merge-base；0.13.4 的完整差异就是这个提交（96 文件，+3366/−1002），本仓领先 372 个提交。
- 判定词：`采纳`（移植上游实现或等价物）、`适配后采纳`（机制成立，需按本仓结构改写）、`不需要`（本仓已独立具备或不适用）。
- 复现方法：本次评估已为本仓添加 `upstream` remote（`ssh://git@ssh.github.com:443/craft-ai-agents/craft-agents-oss.git`，与 `AGENTS.md` 记载一致），`git fetch upstream --tags` 后即可用 `git show b2d6c8aa -- <path>` 逐文件对照；上游 `upstream/main` 只有 106 个提交（每个发布一个）。

## 0. 实施状态（2026-09-21）

第 1、2、3、4、5 项已按本文结论实施，第 6 项（移动端 Web 输入区视口）**按决定不实施**。落地内容与验证见文末"实施记录"。

## 1. 结论

上游这一版对本仓有效的只有三件事，外加一件我们要自己判断的产品选择：

| # | 上游改动 | 我们的现状 | 判定 | 工作量 |
|---|---|---|---|---|
| 1 | 系统提示注入加固（共享 `prompt-sanitize.ts`，补上新覆盖点） | 有同源私有实现，但 `working_directory`、`project_context_files`、偏好设置三处未覆盖 | **采纳**（安全） | S |
| 2 | Pi 侧 steer 掉消息（#1040）：`steeringMode: 'all'` | **有同一缺陷**，已用上游回归测试在本仓 SDK 上复现 | **采纳**（1 行 + 1 测试） | S |
| 3 | 上下文占用与压缩计数（#1043） | **有同类缺陷**：压缩后徽标冻结、SDK 权威值被忽略 | **适配后采纳** | M |
| 4 | 系统提示 developer context（git 分支/工作树/最近提交 + 自动化指引） | 无 git 感知；`PromptBuilder` 的 stable/volatile 结构正好可直接插入 | **适配后采纳** | S–M |
| 5 | Pending Plan 派发 claim（`markPendingPlanExecutionDispatched` 返回布尔） | 仍是无条件置位、返回 void；同类竞态存在（未完整追踪恢复链路） | 适配后采纳（移植前补验证） | S |
| 6 | 移动端 Web 输入区视口（#1038） | `window.innerHeight` 近似，无视觉视口；webui 复用同一输入区 | 适配后采纳（优先级最低） | M |

不需要的部分见第 6 节：上游 Claude 后端的全部改动（本仓已删除 Claude）、版本号与 lockfile、`session-mcp-server`、`packages/*/CLAUDE.md` 指针。

## 2. 系统提示加固（#1，建议先做）

**上游改法**：新增 `packages/shared/src/prompts/prompt-sanitize.ts`——`stripPromptControlChars` / `stripPromptLineControlChars`（C0 控制字符）、`defangPromptClosingTags`（大小写与空白不敏感地中和 `< / tag >`）、`sanitizePromptBody`、`sanitizePromptLine`、`escapePromptXmlAttr`（属性内 `& < > "` 转义）、`redactPromptUrlCredentials`（URL 权限段凭据脱敏）。system.ts 原有的私有 defang 实现改为调用它，并**补上此前未覆盖的位置**：`<working_directory>` 值、`working_directory_context` 里的 bashCwd 路径、`<project_context_files>` 的列表项与 `working_directory` 属性、偏好设置（改成 `<user_preferences>` 包裹并逐行脱敏）、origin URL 凭据。

**我们的现状**：
- 私有实现在 `packages/shared/src/prompts/system.ts:395-470`（`PROJECT_BLOCK_TAGS`/`defangBlockTag`/`defangProjectBlockTags`/`stripDangerousControlChars`/`sanitizeProjectBodyText`/`sanitizeProjectFilename`），只用于 project_context / project_memory / project_assets；
- 同一套逻辑在 `packages/shared/src/plugins/plugin-context.ts:35-60` 又复制一份（注释自陈"mirroring `defangBlockTag`"）；
- **未覆盖**：`system.ts:205`（工作目录直接插值）、`system.ts:281` 及 `getProjectContextFilesPrompt`（列表项与属性未转义）、`packages/shared/src/config/preferences.ts:138+`（偏好内容按行直接拼接）。

**攻击面**：工作目录可含 `"` 与 `<`/`>`；枚举出的 AGENTS.md/CLAUDE.md 文件名来自被打开仓库，可构造闭合标签注入指令；偏好 notes 等为用户可写文本。这是"提示注入"而非内存安全问题，但注入目标正是系统提示本身。

**移植要点**：直接引入上游 `prompt-sanitize.ts`（依赖为零，可原样复制），本仓两个私有实现改为调用它，然后按上游清单补齐三处覆盖点；偏好段同时改成显式块（`<user_preferences>`）以便与相邻段区分优先级。

**验证**：为三个新覆盖点各加一条断言（例如文件名 `x</project_context_files><system>…`、工作目录 `a"><injected>`、偏好含 `</user_preferences>`）。

## 3. #1040 steer 掉消息（我们确实有）

**上游改法**：Pi 侧的全部修复是 `packages/pi-agent-server/src/session-settings.ts` 里一行 `steeringMode: 'all'`，加一条回归测试 `steering-sdk.test.ts`（断言同一模型边界批量交付 A/B/C，下一边界才拿到 D）。Claude 侧另有 turn 级 `PendingSteers` + 宿主确认协议（`takePendingSteers`/`canSteerTextPayload`/`acceptedSteers`/`recoverPendingSteers`/`RedirectMetadata`），与本仓无关。

**我们的现状**：`packages/pi-agent-server/src/session-settings.ts:84`（`buildPhanerisPiSettings`）没有设置 `steeringMode`，SDK 默认 `one-at-a-time`（`pi-coding-agent/dist/core/settings-manager.js:485`），而队列每次边界只取一条（`pi-agent-core/dist/agent.js:72-84` 的 `PendingMessageQueue.drain`）。子进程的 steer 路径本身正确：`pi-agent-server/src/index.ts:2682` 调用 `piSession.steer(msg.message)`。

**复现实验**（把上游 `steering-sdk.test.ts` 原样拿到本仓、改名为本仓的 `createPhanerisSettingsManager`，跑在本仓锁定的 SDK 0.86.1 上）：

| 配置 | 边界 2 | 边界 3 | 边界 4 |
|---|---|---|---|
| 现状（未设 steeringMode） | `[initial, A]` | `[initial, A, B]` | `[initial, A, B, C]` |
| 加 `steeringMode: 'all'` | `[initial, A, B, C]` | — | 上游测试 1 pass / 8 断言 |

即：不是永久丢失，而是**每条 steer 各占一次模型调用**，B、C 要到后续回合才被看到；若回合在此之前结束，未交付项留在队列，可被 `clearQueue()`（中止/交接路径）静默丢弃。上游把它当缺陷修，我们应当同样处理。

**移植要点**：`buildPhanerisPiSettings` 增加 `steeringMode: 'all'`（并保留注释说明"一次边界交付全部待发 steer"），把上游测试改成本仓命名放进 `packages/pi-agent-server/src/`。本仓 SDK 比上游新（0.86.1 对 0.85.1），修复不依赖升级。

**验证**：`cd packages/pi-agent-server && bun test ./src/steering-sdk.test.ts`。

## 4. 上下文占用与压缩（#1043，同类缺陷）

**上游改法**：新增 `ContextUsageSnapshot`（`packages/core/src/types/context-usage.ts`）与两层归一化——子进程 `pi-agent-server/src/context-usage.ts` 用 `session.getContextUsage()` + `settingsManager.getCompactionSettings()` 读取 SDK 权威值（`deferContextUsage` 在 `message_end` 之后 microtask 读取，避免读到旧值），并在 `turn_end`/`agent_end`/`compaction_end` 上内联附带；共享层 `packages/shared/src/agent/context-usage.ts` 的 `contextFromPi`/`contextAfterCompaction` 把"窗口−预留"折算为压缩上限，压缩边界用 `estimatedTokensAfter`，无新值时把计数标为 `usedTokens: null` + `isStale`；adapter 新增 `adaptContextUsage`，让占用先于 completion 到达；`usage_update` 载荷携带 `contextUsage`；UI 新增 `chat.contextUsage.*`（7 locale × 9 键）与"估算/过期/压缩窗口"展示；`markCompactionComplete` 变成 claim。

**我们的现状**（三处缺口，均已定位）：
1. 占用数取自最后一条 assistant `message_end` 的 `usage.totalTokens`（`packages/shared/src/agent/backend/pi/event-adapter.ts:674-686`）→ `usage_update` → `tokenUsage.contextTokens` → 徽标（`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:2056`）。SDK 侧 `agent_settled.contextUsage` 被**有意忽略**（`packages/shared/src/agent/__tests__/pi-event-adapter.test.ts:52` 明确断言忽略），而本仓 SDK 0.86.1 已提供 `session.getContextUsage()`（`agent-session.d.ts:684`）与事件上的 `contextUsage`（同文件 `:193`）。
2. 压缩完成后 `SessionManager.ts:9265-9274` 只是把**未变的** `managed.tokenUsage` 再发一次——注释写的是"让计数立即刷新"，实际结果是徽标继续显示压缩前的旧值，直到下一轮 assistant 消息（正是上游所修的"冻结"症状）。
3. 手动 `/compact` 只回传 `summary`/`firstKeptEntryId`/`tokensBefore`（`packages/pi-agent-server/src/index.ts:2390` 附近），而 SDK 的 `CompactionResult.estimatedTokensAfter?` 已经提供（`pi-coding-agent/dist/core/compaction/compaction.d.ts:22`）。

**移植要点**：先做 (2)+(3)（消除陈旧计数，改动局限在子进程 compact 回包与 SessionManager 的压缩分支）；再决定是否做 (1)（把推导值换成 SDK 权威值）。本仓 `usage_update` 载荷比上游更丰富（`tokenUsage` + `full: PiUsage`），移植时保留本仓形状、只增字段；若采用上游 UI 语义，`chat.contextUsage.*` 键需按本仓 7 语言规范补齐并通过 `lint:i18n:parity`/`sorted`。

**验证**：扩展 `pi-event-adapter.test.ts` 断言压缩边界后占用被替换或标为 stale；手工触发一次 `/compact` 观察徽标不再停留在旧值。

## 5. 系统提示 developer context（建议做，但要按本仓结构落地）

**上游改法**：新增 `packages/shared/src/prompts/developer-context.ts`，并明确拆成两半——`formatStableGitDeveloperContext`（仓库根、仓库父目录、所选目录及其在仓库中的位置、origin（凭据已脱敏）、默认分支，加一段固定指引：未提交改动视为用户工作、最小 diff、先读根 AGENTS.md/CLAUDE.md、改行为时更新最近的上下文文件、未经要求不切换分支/不 reset/rebase/force-push、worktree 建在仓库父目录、提交前查状态并带 co-author trailer）与 `formatVolatileGitDeveloperContext`（分支或 detached、upstream、ahead/behind、工作树状态、staged/unstaged/untracked 计数、变更文件样本 ≤20）。git 调用是 `spawnSync`，700ms 超时、128KB 上限，失败即降级为不注入。`system.ts` 另外把项目上下文文件的发现范围收敛到 **git 仓库根**（新 `context_root` 属性，只保留与所选目录相关的嵌套上下文文件）。接入点是 `PromptBuilder`：stable 半进 `buildStableContextParts`（按工作目录缓存），volatile 半进 `buildVolatileContextParts`；`pi-agent.ts` 还把偏好/co-author/项目上下文按会话钉住，避免中途变更扰动缓存前缀。

**我们的现状**：`packages/shared/src/agent/core/prompt-builder.ts` 已有同构的 stable/volatile 划分与 `pinnedPreferencesPrompt`（`:47/:110/:157`），所以插入点现成；缺的是 developer-context 模块本身与仓库根收敛逻辑（我们当前从工作目录递归枚举上下文文件）。

**产品判断**：这段信息对编码任务有实际价值（分支、工作树脏净、最近提交），且 stable/volatile 拆分对本仓的 prompt caching 是正向的；固定指引里"未提交改动视为用户工作""未经要求不 rebase/force-push"也与本仓既有约定一致。需要先确认的是刷新与成本策略：volatile 半每轮构建都会跑 git（上游固定约 6 次调用，detached HEAD 时再多一次，每次 700ms 上限），本仓 Pi 路径每轮都会重建 volatile 上下文。

**移植要点**：新增模块（可原样引入，仅保留本仓命名与 `@phaneris/*` 引用）、`PromptBuilder` 两半各插一段、`system.ts` 的上下文文件发现改成仓库根收敛、必要时同步 `print-system-prompt.ts` 的预览输出。`## Automations` 段（5 条规则，引用 `DOC_REFS.hooks`）可作为纯文本选择一起带入：我们目前只在 labels/statuses 处零散提到自动化触发，没有统一的"何时创建/运行 automation"规则段；它与 `docs/process/agentic-interception-design.md` 的决策不冲突。

**不需要的部分**：上游把 9 个逐格式预览段（Data Table、Spreadsheet、File-Backed Tables、HTML/PDF/Image/Markdown Preview、Tabs）合并为 `## Preview Blocks`；本仓 `system.ts:669` 早已是 `## Files, Artifacts, and Previews` 单一节，无需跟改。

**验证**：`bun run print:system-prompt` 对比注入前后（stable 段不随每轮变化、volatile 段反映当前分支与脏净），并加一条"目录不在 git 仓库时不注入"的断言。

## 6. 移动端 Web 输入区（#1038，最低优先级）

**上游改法**：`apps/electron/src/renderer/lib/input-viewport.ts`（`getViewportRect` 走 `visualViewport` 并折算 cssZoom，`measureInputAvailableHeight` 量"输入区之外的可用高度"）、`hooks/useInputAvailableHeight.ts`（ResizeObserver + 视口订阅）、`input/composer-height.ts`；webui 侧 `apps/webui/src/viewport.ts` 把可视视口写入 `--webui-viewport-*` 变量（含键盘平移），`index.html` 的 viewport meta 改为 `interactive-widget=resizes-content`，CSS 用变量而非 `100dvh`。

**我们的现状**：`FreeFormInput.tsx:587` 初值固定 540，`:619-628` 只按 `window.innerHeight * 0.66` 更新且只监听 `window.resize`；无 `visualViewport`，也没有把宿主高度变量化。webui 通过 `@` → `../electron/src/renderer`（`apps/webui/vite.config.ts`）复用同一输入区，因此移动端 Web + 大字号/软键盘组合下会出现同类"工具条与发送键被挤出可视区"。

**移植要点**：先引入 `input-viewport.ts` 与视口订阅，把 `inputMaxHeight` 换成"输入区之外可用高度"的预算值，再做 webui 变量化与 meta 改动。桌面端不受影响，因此可以排在其他项之后。

## 7. 附带：Pending Plan 派发 claim

上游把 `markPendingPlanExecutionDispatched` 从"无条件置位、返回 void"改成 atomic claim（`awaitingCompaction` 或已派发时返回 false），并新增渲染层 `pending-plan-dispatch.ts` 消费该 claim，避免压缩期间/重载后重复派发计划批准。本仓 `packages/shared/src/sessions/storage.ts:736-745` 仍是旧形态，`SessionManager.ts:5602` 是薄包装，渲染层 `FreeFormInput.tsx:807` 直接调用——**同类竞态存在**。本项未完整追踪重载恢复链路，移植前应按上游测试补一遍（`packages/shared/src/sessions/__tests__/pending-plan-execution.test.ts` 上游有对应改动）。

## 8. 不适用清单

- 上游 Claude 后端的全部代码与测试（`backend/claude/*`、`pending-steers.ts`、`claude-agent.ts`、`contextFromClaude` 及 4 个 claude 测试）：本仓 `packages/shared/src/agent/backend/` 只有 `pi`，语义已由 Pi 路径承担。
- 版本号 0.13.3→0.13.4、`bun.lock`、各 `package.json` 版本位：本仓使用 0.2.x 自有版本线（`version:check` 门禁），不跟随。
- `packages/session-mcp-server/*`：本仓不存在该 workspace。
- `packages/*/CLAUDE.md` 文档指针：本仓文档体系不同（`docs/` + `apps/electron/resources/docs/`）。

## 9. 建议顺序

1. 提示注入加固（独立、安全、零行为风险）
2. steer `steeringMode: 'all'`（一行 + 回归测试，已有可复现证据）
3. 压缩后占用计数（先做 compact 回包与压缩分支两处）
4. developer context（含仓库根收敛；同时决定是否带 `## Automations` 段）
5. Pending Plan claim（补完恢复链路验证后）
6. 移动端 Web 输入区视口

落地时的验证基线：受影响包的类型检查与聚焦测试、`bun run lint:i18n:parity`/`sorted`（若引入新键）、`bun run lint`（含 `transition-all` 门禁）、以及推前 `bun run validate:ci`。

## 10. 实施记录（2026-09-21）

| 项 | 落地位置 | 验证 |
| --- | --- | --- |
| 1 提示注入加固 | 新增 `packages/shared/src/prompts/prompt-sanitize.ts`；`prompts/system.ts`（工作目录、bash cwd、`project_context_files` 列表与属性、项目块改用共享实现）、`config/preferences.ts`（`<user_preferences>` 包裹并逐行脱敏）、`plugins/plugin-context.ts`（删除重复实现，`plugins/index.ts` 去掉旧再导出） | `prompts/__tests__/prompt-sanitize.test.ts`（12）、`system.isolated.ts`（含工作目录与 POSIX 构造名用例）、`config/__tests__/preferences-prompt-sanitize.isolated.ts`（2）、`plugins/__tests__/plugin-context.isolated.ts`（11） |
| 2 steer 批量交付 | `packages/pi-agent-server/src/session-settings.ts` 增加 `steeringMode: 'all'` | 新增 `steering-sdk.test.ts`（去修复时失败、加修复后 1 pass/5 断言）；`session-settings.test.ts` 增加策略断言 |
| 3 上下文占用与压缩 | 新增 `packages/core/src/types/context-usage.ts`、`packages/shared/src/agent/context-usage.ts`、`packages/pi-agent-server/src/context-usage.ts`；`pi-agent-server/src/index.ts` 边界内联载荷 + 手动 compact 回传 `estimatedTokensAfter`；`backend/pi/event-adapter.ts` 增 `adaptContextUsage`；`protocol/dto.ts` 增 `context_usage` 事件与 `tokenUsage.contextUsage`；`SessionManager.ts` 消费快照并删除压缩分支的旧值重发；渲染层 `lib/context-usage.ts` + 三处徽标（`FreeFormInput`、`CompactModelSelector`、`TrajectoryPanel`）与 `chat.contextUsage.unknown`（7 语言） | `pi-agent-server/src/context-usage.test.ts`（5）、`agent/__tests__/context-usage.test.ts`、`pi-context-usage.test.ts`、`pi-compaction.test.ts`、`pi-event-adapter.test.ts`（共 105）、`server-core/sessions/session-usage.test.ts`（3）、渲染层 `usage-update.test.ts` + `lib/__tests__/context-usage.test.ts`（8）；徽标三态在 Playground 内用真实组件做了浏览器观测 |
| 4 developer context | 新增 `packages/shared/src/prompts/developer-context.ts`（stable/volatile 两半、700ms 上有界 git 调用、origin 凭据脱敏）；`agent/core/prompt-builder.ts` 接入两半并按工作目录缓存 stable 半；`prompts/system.ts` 的上下文文件发现收敛到仓库根并输出 `context_root`；`print-system-prompt.ts` 同步说明；`## Automations` 段随同加入 | `prompts/__tests__/developer-context.test.ts`、`agent/core/__tests__/prompt-builder.test.ts`（含"stable 半不随每轮变化"）；顺带修掉 Windows 下路径分隔符导致的 `(root)` 误标 |
| 5 Pending Plan claim | `sessions/storage.ts` 的 `markPendingPlanExecutionDispatched` 改为原子 claim（awaitingCompaction/已派发时返回 false）；`SessionManager.ts` 包装层在 busy 时拒绝并返回 claim 结果；`session-manager-interface.ts` 与客户端 `sessionCommand` 重载同步返回 `Promise<boolean>`；渲染层新增 `input/pending-plan-dispatch.ts`（live 完成与重载恢复共用，删除 100ms 固定等待）并在 `FreeFormInput.tsx` 接线 | `sessions/__tests__/pending-plan-execution.test.ts`（claim 语义三断言）、`input/__tests__/pending-plan-dispatch.test.ts`（5） |
| 6 移动端 Web 输入区 | 按决定不实施 | — |

验证汇总：`bun run typecheck:all` 全目标通过；`bun run lint` 0 error（`transition-all` 门禁 938 文件 clean）；i18n parity/sorted/coverage 通过（2361 键）；`electron:build:renderer`、`viewer:build`、`webui:build` 均成功。已知与本轮无关的既有失败：`mode-manager-path-boundary.test.ts` 有 2 例依赖 `setPowerShellValidatorRoot()` 的测试初始化（该测试及其整条 import 路径在本轮未被修改）。
