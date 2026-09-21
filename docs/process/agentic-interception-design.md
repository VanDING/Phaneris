# Agentic 拦截设计（治理与介入）

- 作者：Phaneris（与用户协作）
- 日期：2026-09-20
- 性质：设计（定位已定，实施未开始）
- 定位决定：采用**方向 B｜治理与介入**。本文是该决定的落地设计。
- 关联：[`product-development-directions-2026-09-19.md`](product-development-directions-2026-09-19.md) 方向 F（生命周期钩子与受管扩展）、[`pi-sdk-native-capabilities-gap-analysis.md`](../pi-sdk-native-capabilities-gap-analysis.md) §2.1、[`pi-kernel.md`](../pi-kernel.md) 残留判定规则、[`automations` 用户指南](../../apps/electron/src/renderer/docs/guide/en/automations/overview.md)

---

## 1. 定位决定

### 1.1 决定

**agentic 能力定位为「治理与介入」，不是「自动化」。**

| | 语义 | 判断方向 |
|---|---|---|
| 自动化（scheduled / app event） | 发生 X → **做** Y | 反应式 |
| **本设计（agentic）** | 发生 X → **决定** 是否放行 / 如何改写 | **介入式** |

### 1.2 为什么必须二选一

当前 `AutomationEvent` 的词表来自 Claude Code 的**拦截式钩子**（`PreToolUse` 等），而执行架构是**反应式**的：`AutomationAction` 只有 `prompt | webhook | script`（`packages/shared/src/automations/types.ts:134`），三者都只会"启动一个新会话 / 发一个请求 / 跑一个脚本"，**没有任何一个能改变当前回合的走向**。

由此产生一个不可能正确的组合：**`PreToolUse` + `prompt` 动作 = agent 每次调用工具就另起一个会话。** 词表表达的是闸门，动作表达的是通知，两者错位。

**证据：类型上就表达不了介入。** `AutomationMatcher`（`types.ts:183-215`）的字段为 `matcher`(regex)、`cron`、`timezone`、`permissionMode`、`labels`、`enabled`、`conditions`、`telegramTopic`、`actions` —— **没有 block / deny / rewrite 任何一个**。

### 1.3 与方向 F 的关系（重要）

方向 F 是**插件体系的事件扩展点**——让第三方 extension 能加"行为"。本设计**不是**它，也不依赖它：

- 本设计是**内联 extension**：随 Phaneris 交付，不由第三方分发。
- 规则来源是**工作区用户配置**，不是插件包。
- 因此**不触碰** gap 文档 §2.1 的判断：「第三方 extension/package 的加载需要单独的安全与信任设计，**不应直接打开**」。

**这消除了方向 F 的"契约稳定后再做"前置条件对本设计的约束**——本设计不新增对外契约。

---

## 2. 能力前提（已核实）

Pi 0.85.1 提供完整的介入原语。**拦截能力是现成的，不需要改 Pi、不需要 patch。**

`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`：

| 钩子 | 返回值 | 能力 |
|---|---|---|
| `tool_call` | `ToolCallEventResult` | **`block?: boolean`**、`reason?: string`、`terminate?: boolean`；改参数则**原地改 `event.input`** |
| `tool_result` | `ToolResultEventResult` | 替换 `content` / `details` / `isError` / `usage` → **结果改写** |
| `session_before_compact` | `SessionBeforeCompactResult` | **`cancel?: boolean`**，或提供自己的 `compaction` |
| `session_compact` / `session_compact_failed` | — | 压缩成功/失败通知（**三态，比 Claude 的单个 `PreCompact` 更细**） |
| `input` | `InputEventResult` | `continue` \| `transform`(改文本/图片) \| `handled` → **输入预处理** |
| `message_end` | `MessageEndEventResult` | 替换最终消息（须保持原 role）→ 落库前改写 |
| `session_start` / `session_shutdown` | — | 真正的会话级生命周期 |
| `session_before_switch` / `session_before_fork` / `session_before_tree` | `{cancel?}` | 会话切换/分支/树导航可取消 |

**结论：B 的技术可行性不需要论证。** `block` / `cancel` / `transform` 三个动词直接对应治理的三个动作。

---

## 3. 三条原则

### 3.1 决策在子进程，授权在主进程

**这是本设计最关键的一条，也是最容易做错的一条。**

Pi 的钩子运行在 `packages/pi-agent-server` 子进程内（Pi 被隔离在那里，见 `pi-kernel.md`）；而**权限权威在主进程**——`runPreToolUseChecks`（`packages/shared/src/agent/core/pre-tool-use.ts:696`）与 `shouldPromptInAskMode`（`:1018`）经 `pre_tool_use_request/response` 与主进程往返。

若不设计好边界，会出现两条危险路径：

| 危险 | 后果 |
|---|---|
| 钩子自行放行 | **绕过主进程权限管线** —— 子进程成了第二套权威 |
| 每次工具调用都往返主进程 | 热路径往返；且与既有管线重复 |

**边界定义：**

> **钩子只做"拒绝"（fail-closed 方向的过滤），从不做"批准"。**
>
> - 显式用户规则命中 → 可以 `block`（明确拒绝，无需往返）
> - 规则未命中 → 返回空，**不表达任何意见**，交回既有权限管线
> - 需要"提问"的语义 → 一律留给主进程（`ask` 模式既有管线），钩子不代劳

这样钩子是**前置过滤器**，不是第二个权威：它只削减能力，从不扩大能力。

### 3.2 词汇必须是 Pi 原生的

`pi-kernel.md:68` 明确禁止重新引入 **Claude Agent SDK 依赖或 hook 形状**。

现有 `AgentEvent` 常量（`types.ts:25-38`）**就是 Claude 的 hook 形状**，因此：

- 新设计的事件名用 **Pi 原生词汇**（`tool_call` / `tool_result` / `session_before_compact` / `input` / `session_start` / `session_shutdown` …），不是 `PreToolUse` / `SubagentStop`。
- 不与现有 `AgentEvent` 合并、不复用它的类型。

**语义陷阱（必须记录）**：Pi 的 `agent_start` / `agent_end` 是**每轮（per-turn）**的，**不是会话级**。把它们映射成 `SessionStart` / `SessionEnd` 会造出错误语义（`agent_end` 每轮都触发）。会话级用 `session_start` / `session_shutdown`。

### 3.3 拦截规则不是 automation，不放 `automations.json`

`automations.json` 的模型是「事件 → 动作」，有 `actions: AutomationAction[]`。拦截没有"动作"，只有"决定"。

把 `block` 塞进 `AutomationAction` 会把两个不同的东西挤进一个联合类型，并且让 UI 出现"既有动作又有决定"的混合编辑面。

**因此：拦截规则使用独立配置与独立 UI 面**（见 §4.2）。

---

## 4. 设计

### 4.1 分层

```
主进程（权限权威）
  ├── runPreToolUseChecks / shouldPromptInAskMode      ← 不变
  ├── 拦截规则（用户配置，工作区级）                     ← 新增
  └── 把规则随每轮 prompt 下发
              │
              ▼  （复用既有 setPhanerisSystemPrompt 同款闭包/消息通路）
pi-agent-server 子进程
  └── inline extension（extensionFactories）             ← 新增
       ├── pi.on('tool_call')               → block / 改参
       ├── pi.on('tool_result')             → 改写结果
       ├── pi.on('session_before_compact')  → cancel
       └── pi.on('input')                   → transform
```

**下发通路已有先例**：`packages/pi-agent-server/src/phaneris-resource-loader.ts:11` 的 `setPhanerisSystemPrompt` 就是"每轮 prompt 消息更新模块级状态，inline extension 读取"的模式。拦截规则用同一模式，**不需要新开通道、不需要新协议**。

**注册点已有先例**：同文件 `:50-61` 的 `extensionFactories: [{ name: 'phaneris-system-prompt', factory }]` 是当前唯一的 inline extension。新增一个 factory 即可，与现有 factory 并列。

### 4.2 首个切片：`tool_call` 阻断

**选它的理由**：直接命中一个已登记的既有风险——`product-development-directions-2026-09-19.md` §2.2「**无人值守权限靠 `allow-all` fallback**」（`TaskRunner` 显式列为 P1）。该空缺的实质是"最小权限被可用性静默替代"，而 `tool_call` 的 `block` 正是最小权限的执行手段。

范围：

| 做 | 不做 |
|---|---|
| 工作区级规则：匹配工具名 + 参数模式 → 拒绝 | 不做"规则命中后自动批准" |
| 拒绝时把 `reason` 回给模型（模型知道为什么被拒，可改道） | 不做跨会话的规则继承 |
| 记录每次拒绝到既有自动化历史/审计面 | 不改权限三模式（safe/ask/allow-all）语义 |
| 规则为空时**完全不介入**（零行为变化） | 不引入新的权限模式 |

**验收**：规则为空时行为与今天逐字节相同（无钩子可观测差异）；规则命中时工具不执行且模型收到 `reason`；`ask` 模式下未命中规则的调用**仍走主进程确认**（证明没有绕过管线）。

### 4.3 第二批（按价值排序，未承诺）

1. **`session_before_compact` 取消 + `session_compact_failed` 通知** —— 压缩目前对用户是黑盒（directions §2.2「Pi 压缩参数未暴露」）。三态原生钩子比 Claude 的单个 `PreCompact` 更好，且"压缩失败"今天没有可见出口。
2. **`tool_result` 改写** —— 密钥打码、大结果截断到既有预算策略。
3. **`input` transform** —— 输入预处理（与 slash command / prompt template 相关）。

---

## 5. 现状问题（驱动本设计的两个缺陷）

### 5.1 agentic 自动化今天不执行任何动作

`packages/shared/src/automations/automation-system.ts:546-549`：

```ts
// Note: Command execution has been removed. Prompt-based execution for
// agent events is not yet implemented. This method currently only
// validates matching (including condition gating) — actual execution is a no-op.
log.debug(`[AutomationSystem] Matched ${event} automation (prompt-based execution pending)`);
```

匹配与条件求值正常（`matcherMatchesAgentInput`，`utils.ts:224`），然后**丢弃**。且完全静默：不写 history、不写 event log（agent 事件从不进 `eventBus`）、不报错。

**不是 Pi 单后端造成的**：上游 `craft-agents-oss` 的同一函数同样是 no-op，其注释为 *"Prompt-based execution for **non-Claude backends** is not yet implemented"*，同处写明 *"Command execution has been removed"*。我们只是删掉了 `non-Claude` 这个已无意义的限定词。**AgentEvent 的执行端从来没有建成过。**

### 5.2 文档在广告一个空转的功能

两份文档都把 13 个 agent 事件列为可用触发器：

- [`automations/overview.md`](../apps/electron/src/renderer/docs/guide/en/automations/overview.md)：表格列出全部 13 个 `Agent events`
- [`apps/electron/resources/docs/automations.md`](../apps/electron/resources/docs/automations.md):78-92：逐条给出描述（`| PreToolUse | Before a tool executes | Tool name |`、`| SessionStart | Session starts | - |`）

**都没有说明这些事件不会执行任何动作。** 用户照文档配置会得到一条永久静默的规则。

### 5.3 13 个事件里 8 个无人 emit

| 有 emit（`pi-agent.ts` 合成） | 无 emit |
|---|---|
| `PreToolUse`(:1378)、`PostToolUse`(:1325)、`PostToolUseFailure`(:1324)、`UserPromptSubmit`(:2323)、`Stop`(:2714,:2733) | `Notification`、`SessionStart`、`SessionEnd`、`SubagentStart`、`SubagentStop`、`PreCompact`、`PermissionRequest`、`Setup` |

**这 5 个"有 emit"的也是在我们代码里合成的**（`adapter.adaptEvent` → `tool_result` 三元判断），不是 Pi 的钩子。真正的 Pi 钩子面（§2）基本空置。

---

## 6. 开放决策

| # | 问题 | 为什么现在不做 |
|---|---|---|
| D1 | 现有 `AgentEvent` 词表与 no-op 执行端**保留还是撤下** | 影响 UI（automations 列表的 `agentic` 过滤）与向后兼容；需与本文的独立拦截面一起决定 |
| D2 | 拦截规则与三模式权限的**组合语义**（`safe` 模式下规则是否仍生效） | 涉及安全叙事，需单独定 |
| D3 | 拒绝的**用户可见性**（静默 vs 徽章 vs 通知） | 与 D1 耦合 |
| D4 | 拦截事件的**审计落点**（既有 automation 历史 vs 新的 policy 审计） | 既有 `pages/action-bridge.ts` 的审计模式可参考 |
| D5 | 何时/是否把拦截规则**开放给插件分发**（即方向 F） | 必须先有第三方信任设计；本文明确不打开 |

---

## 7. 明确不做

| 不做 | 原因 |
|---|---|
| 打开第三方 extension/package 加载 | gap 文档 §2.1 已判断需单独的安全与信任设计 |
| 在子进程内复制权限管线 | 会造成第二套权威（§3.1） |
| 让钩子"自动批准" | 钩子只削减能力，从不扩大 |
| 使用 Claude hook 形状的事件名 | `pi-kernel.md:68` 禁止 |
| 把 `block` 塞进 `AutomationAction` | 决定≠动作（§3.3） |
| 复用 `AutomationEvent` / `automation-system.ts` | 其模型是"事件→动作"，与介入语义冲突 |
| 为拦截新开子进程↔主进程通道 | `setPhanerisSystemPrompt` 模式已够用 |

---

## 8. 证据索引

| 结论 | 证据 |
|---|---|
| 动作面只有三种、都不介入 | `packages/shared/src/automations/types.ts:134`（`AutomationAction`） |
| matcher 无阻断语义 | `packages/shared/src/automations/types.ts:183-215` |
| agent 事件执行端为 no-op | `packages/shared/src/automations/automation-system.ts:546-549` |
| agent 事件不进 eventBus | 三个 handler 头部注释「Processes … for **App** events」；订阅在 `automation-system.ts:290/302/314` |
| `PreToolUse` 被 await 但返回值丢弃 | `packages/shared/src/agent/base-agent.ts:392-398`；`pi-agent.ts:1378` 注释称 "so automations run before tool executes" |
| Pi 钩子能力与签名 | `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`（`ExtensionAPI.on` 907-941） |
| inline extension 注册点 | `packages/pi-agent-server/src/phaneris-resource-loader.ts:50-61` |
| 子进程状态下发先例 | 同文件 `:11`（`setPhanerisSystemPrompt`） |
| 权限权威在主进程 | `packages/shared/src/agent/core/pre-tool-use.ts:696`、`:1018` |
| 上游同款 no-op | `craft-agents-oss` `automations/automation-system.ts`（`executeAgentEvent`） |
| 相关既有方向 | `product-development-directions-2026-09-19.md`:34（方向 F gated）、`:63`（Pi 钩子未用）、`:64`（插件体系缺生命周期钩子） |
