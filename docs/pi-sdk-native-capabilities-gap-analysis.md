# Pi SDK 原生能力接入缺口分析

状态：时点分析（point-in-time），不是当前接口契约。实施前请按仓库中的 Pi SDK 版本与最新代码重新核对。
日期：2026-09-20
Pi SDK：`@earendil-works/pi-ai` / `pi-agent-core` / `pi-coding-agent` **0.86.0**
范围：Phaneris 单 Pi 后端（`packages/pi-agent-server` + `packages/shared/src/agent`）

---

## 0. 结论摘要

Pi 的核心链路已经接入：模型流、工具执行、会话 JSONL、恢复/分支、压缩、重试、OAuth、上下文用量、提示缓存。

当前缺口集中在五类：

1. **Extension 事件钩子**：已补充只读工具、压缩、模型/思考等级事件观测；治理阻断与结果改写尚未接入。
2. **请求与模型高级能力**：已接入原生 `onPayload`/`onResponse` 观测；constrained sampling、必要的 provider-specific options 仍待按具体需求接入。
3. **Session Runtime / Tree / 导出 / 统计**：已使用原生统计作为核对参考；runtime 替换、树导航、标签、导出仍按产品收益评估。
4. **Pi 原生扩展生态**：skills、prompt templates、themes、context files、Pi packages 被主动关闭，由 Phaneris 自研体系替代。
5. **图像生成与平台协议**：Pi 原生 image generation、`pi-server`/`pi-protocol`、`pi-telemetry`、stream proxy 等未接入；其中部分为实验性或已被自研方案覆盖。

此外，`extendedPromptCache` 已按本仓库的决定迁移为 Pi 原生 `cacheRetention`，不再属于缺口。

### 2026-09-20 实施边界与进展

采用三个原则：原生能力应增强功能与治理；应提升溯源、统计和审计准确性；Phaneris 更适合负责的职责不因原生化而退化。不新增用户设置。

本次已实施请求观测、生命周期审计和用量核对基础：

- 原生回调记录扩展处理后的 provider payload 摘要、允许的响应头及请求关联；随模型结果与 usage 在同一 T2 落库。原有 interceptor 尚未删除或迁移请求改写职责。
- 内联 extension 只读采集工具提议/结果、压缩三态、模型/思考切换；主会话和辅助会话补充重试、settled 统计快照。活动 run 内保存为非模型可见 `sdk_observation`。
- 主进程核对当前 run 的模型 outcome 与 usage ledger，保留缓存和 reasoning 用量细分，区分未决结果与已完成结果。原生 session 全量统计仅作为独立参考，SDK cost 标记为估算，不重复计费。
- 不变更权限审批、T1/T2、canonical context，不启用提交后的结果改写，不开放另一套资源自动发现。

限制：provider 回调证据不是网络尝试计数或原始网络报文；未返回原生结果的请求仍可能未决。生命周期采集属于可报告失败的观测，不是新增的强制授权/事务闸门；执行外切换不记到无关回合。完整基线见 [pi-kernel.md](pi-kernel.md)。

### 2026-09-21 Pi 0.86.1 缓存预热接入

现已提供默认关闭的 `promptCacheWarming` 全局开关，仅主会话可选 `streaming`。刷新有独立 durable dispatch/outcome 与费用记录，不改写主任务检查点，不进入对话；ephemeral 和 idle 保持关闭。以下 0.86.0 升级核对保留当时的决策背景，当前实现见 [提示缓存与预热](pi-kernel.md#提示缓存与预热)。

### 2026-09-20 Pi 0.86.0 升级核对

0.86.0 的两项变化直接影响本仓库，处理结论如下：

- **provider 请求上下文改为归一化 transcript**（`Context` → `TranscriptContext`，提示与工具声明进入 system 消息，`agent.state.systemPrompt` 变为只读）。适配：请求诊断改为经 `getCurrentSystemPrompt()` / `getCurrentTools()` 回放得出当前提示与工具声明；prompt/tool 变更由 SDK 的 section 增量下发，Phaneris 的提示继续通过 loader override 与 `before_agent_start` 的 forced prompt 投影送达；删除改写 SDK 私有字段的 `applySystemPromptOverride`。请求期 prompt 快照改读 Phaneris prompt，避免 SDK 结构化 base prompt 的 `<cwd>` section 污染诊断。
- **提示缓存预热默认开启**（`cacheWarming: "streaming"`）。预热刷新走 SDK 自己的 `ModelRuntime.streamSimple`，不经过 `agent.streamFunction`，因此不进入 durable T1/T2，也不产生 T2 原子提交的用量或 `sdk_observation`，只写 SDK session 的 `cache_warm` 条目。结论：**默认关闭**（Phaneris 会话显式 `cacheWarming: 'off'`）。重新启用的前提是先让预热的刷新可提交、可归因（例如经 durable 边界或独立的可审计 usage 通道），否则就是 ledger 之外的 provider 花费。
- 其他需留意的默认值：内置 `read`/`bash`/`powershell`/`edit`/`write` 工具启用 strict-prefer JSON-schema 约束采样（Phaneris 包装这些内置定义，故同样生效；不支持的 provider 由 SDK 回退）；agent 级退避新增 `maxAgentDelayMs` 上限，已在本仓库的重试策略中显式声明。

---

## 1. 当前已接入基线

| 能力 | 接入方式 | 证据 |
| --- | --- | --- |
| Agent 循环与流式事件 | `AgentSession.prompt/steer/followUp/abort`；事件经 `PiEventAdapter` 转发 | `packages/pi-agent-server/src/index.ts`；`packages/shared/src/agent/backend/pi/event-adapter.ts` |
| 内置 coding tools | `createReadToolDefinition`、`createBashToolDefinition`、`createPowerShellToolDefinition`、`createEditToolDefinition`、`createWriteToolDefinition`、`createGrepToolDefinition`、`createFindToolDefinition`、`createLsToolDefinition` | `packages/pi-agent-server/src/index.ts:912-919` |
| Custom tools / allowlist / denylist | `customTools`、`tools`、`excludeTools` | `packages/pi-agent-server/src/index.ts:934-951` |
| 会话持久化、恢复、fork、branch | `SessionManager.continueRecent/forkFrom/branch/getEntry/inMemory` | `packages/pi-agent-server/src/index.ts:976-992`, `1578` |
| 压缩与 auto-compaction | `session.compact()`、`setAutoCompactionEnabled(true)`；`compaction: { enabled: true }` | `packages/pi-agent-server/src/index.ts:2325-2331`；`packages/pi-agent-server/src/session-settings.ts:94` |
| 重试策略 | `SettingsManager.inMemory` 固定 agent/provider 两级重试 | `packages/pi-agent-server/src/session-settings.ts:79-95` |
| Thinking level | `createAgentSession({ thinkingLevel })`、`setThinkingLevel`、`getAvailableThinkingLevels` | `packages/pi-agent-server/src/index.ts` |
| 上下文用量 | `session.getContextUsage()` 随 `agent_settled` 事件返回 | `packages/pi-agent-server/src/index.ts:1945-1950` |
| OAuth | Anthropic、OpenAI Codex、GitHub Copilot、xAI、OpenRouter、Kimi、Radius | `packages/pi-agent-server/src/index.ts:64-72`；`apps/electron/src/renderer/hooks/useOnboarding.ts` |
| 自定义端点 / 动态 provider | `ModelRegistry.registerProvider`、`ModelRuntime.create({ allowModelNetwork: false })` | `packages/pi-agent-server/src/index.ts` |
| 提示缓存 | `cacheRetention` / `PI_CACHE_RETENTION` 原生映射，显式值优先 | `packages/shared/src/agent/pi-agent.ts`；`packages/pi-agent-server/src/durable-model-stream.ts` |
| provider 请求上下文 | 归一化 transcript（`TranscriptContext`）；提示/工具声明在 system 消息内，请求诊断经 `getCurrentSystemPrompt()` / `getCurrentTools()` 回放 | `packages/pi-agent-server/src/request-diagnostics.ts` |
| 系统提示送达 | loader `systemPromptOverride` + 内联 extension `before_agent_start` 返回 forced prompt，投影为请求头部 system 消息 | `packages/pi-agent-server/src/phaneris-resource-loader.ts`；`packages/pi-agent-server/src/system-prompt-delivery.test.ts` |
| 提示缓存预热 | 显式关闭（`cacheWarming: 'off'`）；刷新不经 durable 边界，暂不允许 ledger 外花费 | `packages/pi-agent-server/src/session-settings.ts` |
| Fallback / handoff / 消息转换 | Pi SDK 在 `pi-ai` 内部自动完成跨 provider 的 thinking/tool 消息转换 | SDK 默认行为，无需显式接入 |

---

## 2. 未接入能力

### 2.1 Extension 事件钩子

最初仅注册 `before_agent_start`；现已通过 `native-lifecycle-observation.ts` 注册只读工具、压缩、模型/思考等级钩子。下表列出 SDK 可用原语，不表示均已接入或均应迁移。

证据：`packages/pi-agent-server/src/phaneris-resource-loader.ts:54`。

Pi 0.86.0 还提供以下事件（`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`）：

| 事件 | 可替代或增强的现有逻辑 |
| --- | --- |
| `context` | 可追踪的模型输入变换；不能替代 durable context 与 canonical 持久化 |
| `before_provider_request` | 直接修改请求 payload，替代 fetch interceptor 的请求改写 |
| `before_provider_headers` | 请求头改写，替代 interceptor / 环境变量拼装 |
| `after_provider_response` | 响应状态与 headers 采集，用于诊断/遥测 |
| `cache_warming_decision` | 逐次覆盖预热决策（warm/stop）；Phaneris 已关闭预热，故未注册 |
| `tool_call` / `tool_result` | 工具权限、阻断、审计、结果改写 |
| `message_end` | SDK 消息落库前可改写，但可能晚于 Phaneris T2，暂不启用内容改写 |
| `session_before_compact` / `session_compact` / `session_compact_failed` | 自定义压缩与失败处理 |
| `input` | slash command、prompt template、输入预处理 |
| `model_select` / `thinking_level_select` | 切换审计与联动 |
| `session_before_fork/switch/tree`、`session_tree`、`session_start` | 会话生命周期与树导航钩子 |
| `resources_discover` | 动态提供 skills / prompts / themes 路径 |
| `project_trust` | 项目信任决策 |

判断：内联 extension 可接管适配与观测职责，但不能直接替换包含权限或 T1/T2 的包装层。provider 请求钩子异常可能被 SDK 捕获后继续执行，不能据此提供强制阻断保证；tool_result/message_end 改写必须先解决提交顺序。第三方 extension/package 不直接打开。

> **更新（2026-09-20）**：本节的**内联 extension**路线已定案为 [`agentic-interception-design.md`](agentic-interception-design.md)（定位：治理与介入；首个切片：`tool_call` 阻断）。该设计**只做内联 extension + 工作区用户规则**，明确不打开第三方 extension/package 加载，因此与本节的判断一致。
>
> 为什么不是"事件 → 动作"：现有 `automations` 的动作面（`prompt | webhook | script`）只能启动新会话/发请求/跑脚本，无法改变当前回合，而 `PreToolUse` 这类词表表达的是闸门——两者错位，这正是它今天空转的原因（见该设计 §1.2 与 §5）。

### 2.2 请求与模型层高级能力

请求与工具层能力（node_modules/@earendil-works/pi-ai/dist/types.d.ts）：

| 能力 | 现状 | 价值 |
| --- | --- | --- |
| constrainedSampling（JSON Schema / grammar） | 内置 read/bash/powershell/edit/write 自 0.86.0 起默认 `strict: "prefer"`（Phaneris 包装的定义同样生效）；Phaneris 自定义工具未启用；call_llm 的 outputSchema 仍是 prompt 约束 | 约束工具参数，不能直接当成文本结构化输出开关；需区分 prefer/require 并保留本地校验 |
| toolChoice | 未暴露；Agent 默认 auto | 强制调用指定工具，配合结构化输出/API 工具 |
| onPayload / onResponse | 已在 durable 流包装中组合原生回调，保留 SDK extension runner | 只读请求/响应观测，随模型结果原子提交 |
| samplingParams | 未暴露 | top_p / top_k / min_p 等自定义采样参数 |
| metadata | 未暴露 | Anthropic user_id 等请求元数据 |
| transport / websocketConnectTimeoutMs | 默认 auto 已生效；不可配置、不可观测 | Codex/ChatGPT WebSocket 连接复用与故障回退 |
| thinkingBudgets | 默认值生效；不可配置 | 控制 token 型 thinking 的推理预算 |
| maxRetries / maxRetryDelayMs | 已由 Phaneris 固定策略；不可按会话调整 | 目前够用 |
| promptCache 寿命 / 预热 | `promptCache` 已被 warm 读取；`cacheWarming` 被 Phaneris 显式关闭 | 重新启用需先让刷新可提交、可归因（见 §0 升级核对） |
| TranscriptContext | 请求输入已归一化；自定义 provider 需用 `getCurrentSystemPrompt()` / `getCurrentTools()` 读取提示与工具 | 影响任何自实现 `streamSimple` 的扩展，Phaneris 目前无自实现 provider |

Provider-specific options 需要按 API 分派，因为 coding agent 默认走 streamSimple()，而这些选项通常只在 models.stream() 的完整类型上暴露：

- Anthropic：thinkingDisplay、interleavedThinking、effort
- OpenAI Responses：reasoningSummary、serviceTier
- Bedrock：requestMetadata（AWS 成本分摊 tag）、thinkingDisplay
- Mistral：promptMode、reasoningEffort
- OpenAI-compatible：compat 系列覆盖不足时会直接影响自定义端点行为

证据：

- packages/shared/src/prompts/system.ts:664 明确说明当前结构化输出是 prompt-based、不保证 schema 强制。
- packages/pi-agent-server/src/index.ts:1589 使用 withDurableAccounting(streamSimple)，说明主链是简单流选项路径。
- SDK README 与 pi-ai/dist/api/*.d.ts 中的 API options 类型定义。

### 2.3 Session Runtime / Tree / 导出 / 统计

已使用的 AgentSession 方法只是子集；未使用的原生能力包括（node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:245-669）：

- AgentSessionRuntime：newSession、switchSession、importFromJsonl、统一 fork/clone 替换流程
- navigateTree：会话内原地树导航与分支摘要
- labels / custom entries / custom messages：书签、扩展状态、注入上下文
- getUserMessagesForForking：fork 候选
- getTree / getEntries / getSessionName / setSessionName
- getSessionStats：已作为 settled 时的只读快照接入；非 Phaneris 总账
- exportToHtml / exportToJsonl
- clearQueue、cycleModel、cycleThinkingLevel、setScopedModels、setActiveToolsByName

当前分支做法是在创建 Pi 会话之前使用 PiSessionManager.forkFrom(branch(anchorId))（packages/pi-agent-server/src/index.ts:976-992），不是 AgentSession 的树导航。

### 2.4 Pi 原生扩展生态（当前有意关闭）

packages/pi-agent-server/src/phaneris-resource-loader.ts:44-56 设置：

- noSkills = true
- noPromptTemplates = true
- noThemes = true
- noContextFiles = true

因此以下能力当前不可用：

- .agents/skills / SKILL.md
- prompt templates
- AGENTS.md / CLAUDE.md / SYSTEM.md / APPEND_SYSTEM.md
- themes
- Pi Packages（npm/git）
- 第三方 Extensions

Phaneris 用自己的 skills、plugins、memory、source 和 system prompt 体系替代。若要开放 Pi 生态，需要同时设计 project_trust、包安装、代码执行边界和供应链安全策略。

### 2.5 图像生成与平台层

| 能力 | 当前状态 | 备注 |
| --- | --- | --- |
| Pi 原生 image generation | 未接入 | Phaneris 自研 OpenAI Images 适配，仅支持 openai + api_key 的 gpt-image-2（packages/server-core/src/services/image-generation.ts:57-60） |
| ImagesModels / generateImages | 未接入 | Pi 原生当前支持 OpenRouter 图像模型，可补充多供应商图像生成 |
| pi-server / pi-protocol / Chord facets | 未接入 | 实验性 CBOR 远程会话协议；Phaneris 使用自研 JSONL + WebSocket 协议 |
| pi-telemetry | 未接入 | SDK 只定义回调契约；Phaneris 使用自己的日志与 Sentry |
| streamProxy | 未接入 | 面向浏览器/瘦客户端的 LLM 调用代理；Phaneris 使用自研 remote session |
| AssistantMessageFrameEncoder | 未接入 | SDK 原生增量帧压缩；Phaneris 只压缩 text delta，thinking/tool partial 被丢弃 |
| SimpleStreamOptions.deferred / fetchDeferred | 未接入 | 类型已定义；当前 built-in provider 基本未实现，仅 faux 测试支持，暂不建议 |
| Pi 原生 MCP | N/A | Pi core README 明确没有 MCP；Phaneris 自研 MCP pool |
| Pi 原生 subagent | N/A | Pi core 明确不做 subagents；Phaneris 自研 spawn_session / TaskRunner |

---

## 3. 已默认生效但未暴露成设置

这些能力已经通过 SDK 默认值生效，不是缺失，只是不可配、不可观测：

| 设置 | SDK 默认值（0.86.0） | 说明 |
| --- | --- | --- |
| transport | auto | Codex/ChatGPT 自动 WebSocket + SSE fallback |
| thinkingBudgets | 1024 / 2048 / 8192 / 16384 | minimal / low / medium / high |
| steeringMode / followUpMode | one-at-a-time | Phaneris 有自己的 mid-stream 行为入口 |
| compaction reserveTokens / keepRecentTokens | 16384 / 20000 | Phaneris 仅显式设置 compaction.enabled = true |
| branchSummary reserveTokens / skipPrompt | 16384 / false | 分支摘要当前不可调 |
| httpIdleTimeoutMs | 300000 | 不可配置 |
| provider WebSocket connect timeout | 15000（Codex responses） | 不可配置 |
| cacheWarming | streaming（0.86.0 新增） | Phaneris 默认 off；0.86.1 接入后可通过 promptCacheWarming 选择主会话 streaming，刷新独立入账 |
| retry.maxAgentDelayMs | 60000（0.86.0 新增） | 已在 Phaneris 重试策略中显式声明，与 SDK 默认一致 |

---

## 4. 建议接入优先级

| 优先级 | 能力 | 理由 |
| --- | --- | --- |
| P0 | provider 原生观测与请求关联 | 本次已接入有界回调证据；网络路径覆盖与 interceptor 职责迁移仍需逐项验证 |
| P1 | 生命周期审计与原生用量核对 | 本次已接入活动 run 的只读观测、SDK 全量快照与模型 outcome/ledger 一致性核对 |
| P2 | durable 边界内的治理介入 | 现有治理设计的 tool_call 阻断另行推进；不直接启用 T2 后改写 |
| P3 | 结构化约束、compat、必要 provider 选项 | 以具体功能可靠性需求驱动，不追求参数覆盖率 |
| 按需 | 分支辅助、导出、图像适配、增量编码 | 有明确产品收益才接入 |
| 不替换 | durable、授权、canonical context、资源体系、通信与产品总账 | 保持 Phaneris 的统一执行权威；不开放设置或第二套生态 |

---

## 5. 维护说明

- 本文是能力 gap 的时点记录，不代表已批准的实现计划。
- 实施任何一项前，先核对当前 Pi SDK 版本、对应 .d.ts 与现有 Phaneris 抽象，避免与 durable runtime / session 持久化 / 权限模型冲突。
- 新增原生能力接入后，应同步更新 docs/pi-kernel.md 的当前基线和本文状态。
