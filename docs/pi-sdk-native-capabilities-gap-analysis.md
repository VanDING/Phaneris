# Pi SDK 原生能力接入缺口分析

状态：时点分析（point-in-time），不是当前接口契约。实施前请按仓库中的 Pi SDK 版本与最新代码重新核对。
日期：2026-09-19
Pi SDK：`@earendil-works/pi-ai` / `pi-agent-core` / `pi-coding-agent` **0.85.1**
范围：Phaneris 单 Pi 后端（`packages/pi-agent-server` + `packages/shared/src/agent`）

---

## 0. 结论摘要

Pi 的核心链路已经接入：模型流、工具执行、会话 JSONL、恢复/分支、压缩、重试、OAuth、上下文用量、提示缓存。

当前缺口集中在五类：

1. **Extension 事件钩子**：只用了 `before_agent_start`，其余 provider/context/tool/session 事件均未注册。
2. **请求与模型高级能力**：constrained sampling、provider-specific options、`onPayload`/`onResponse`、transport、thinking budgets 等未接入或未暴露。
3. **Session Runtime / Tree / 导出 / 统计**：只用了基础 SessionManager 能力，未使用原生 runtime 替换、树导航、标签、导出和统计。
4. **Pi 原生扩展生态**：skills、prompt templates、themes、context files、Pi packages 被主动关闭，由 Phaneris 自研体系替代。
5. **图像生成与平台协议**：Pi 原生 image generation、`pi-server`/`pi-protocol`、`pi-telemetry`、stream proxy 等未接入；其中部分为实验性或已被自研方案覆盖。

此外，`extendedPromptCache` 已按本仓库的决定迁移为 Pi 原生 `cacheRetention`，不再属于缺口。

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
| Fallback / handoff / 消息转换 | Pi SDK 在 `pi-ai` 内部自动完成跨 provider 的 thinking/tool 消息转换 | SDK 默认行为，无需显式接入 |

---

## 2. 未接入能力

### 2.1 Extension 事件钩子

当前只注册了一个 hook：`pi.on('before_agent_start', ...)`。

证据：`packages/pi-agent-server/src/phaneris-resource-loader.ts:54`。

Pi 0.85.1 还提供以下事件（`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:907-941`）：

| 事件 | 可替代或增强的现有逻辑 |
| --- | --- |
| `context` | 每轮 LLM 前裁剪/注入上下文，替代部分 durable context 逻辑 |
| `before_provider_request` | 直接修改请求 payload，替代 fetch interceptor 的请求改写 |
| `before_provider_headers` | 请求头改写，替代 interceptor / 环境变量拼装 |
| `after_provider_response` | 响应状态与 headers 采集，用于诊断/遥测 |
| `tool_call` / `tool_result` | 工具权限、阻断、审计、结果改写 |
| `message_end` | 消息落库前的语义改写 |
| `session_before_compact` / `session_compact` / `session_compact_failed` | 自定义压缩与失败处理 |
| `input` | slash command、prompt template、输入预处理 |
| `model_select` / `thinking_level_select` | 切换审计与联动 |
| `session_before_fork/switch/tree`、`session_tree`、`session_start` | 会话生命周期与树导航钩子 |
| `resources_discover` | 动态提供 skills / prompts / themes 路径 |
| `project_trust` | 项目信任决策 |

判断：这些 hook 适合以内联 extension 的形式逐步接管 interceptor 和工具包装逻辑。第三方 extension/package 的加载需要单独的安全与信任设计，不应直接打开。

### 2.2 请求与模型层高级能力

StreamOptions / SimpleStreamOptions（node_modules/@earendil-works/pi-ai/dist/types.d.ts）已经定义但未使用的能力：

| 能力 | 现状 | 价值 |
| --- | --- | --- |
| constrainedSampling（JSON Schema / grammar） | 未使用；call_llm 的 outputSchema 仍是 prompt 约束 | 结构化输出从尽力而为变成 provider 强制校验 |
| toolChoice | 未暴露；Agent 默认 auto | 强制调用指定工具，配合结构化输出/API 工具 |
| onPayload / onResponse | SDK coding agent 已接入 extension runner，但没有 handler，因此实际 no-op | 原生请求/响应观测与改写 |
| samplingParams | 未暴露 | top_p / top_k / min_p 等自定义采样参数 |
| metadata | 未暴露 | Anthropic user_id 等请求元数据 |
| transport / websocketConnectTimeoutMs | 默认 auto 已生效；不可配置、不可观测 | Codex/ChatGPT WebSocket 连接复用与故障回退 |
| thinkingBudgets | 默认值生效；不可配置 | 控制 token 型 thinking 的推理预算 |
| maxRetries / maxRetryDelayMs | 已由 Phaneris 固定策略；不可按会话调整 | 目前够用 |

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
- getSessionStats：会话级 token / cost / message 统计
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

| 设置 | SDK 默认值（0.85.1） | 说明 |
| --- | --- | --- |
| transport | auto | Codex/ChatGPT 自动 WebSocket + SSE fallback |
| thinkingBudgets | 1024 / 2048 / 8192 / 16384 | minimal / low / medium / high |
| steeringMode / followUpMode | one-at-a-time | Phaneris 有自己的 mid-stream 行为入口 |
| compaction reserveTokens / keepRecentTokens | 16384 / 20000 | Phaneris 仅显式设置 compaction.enabled = true |
| branchSummary reserveTokens / skipPrompt | 16384 / false | 分支摘要当前不可调 |
| httpIdleTimeoutMs | 300000 | 不可配置 |
| provider WebSocket connect timeout | 15000（Codex responses） | 不可配置 |

---

## 4. 建议接入优先级

| 优先级 | 能力 | 理由 |
| --- | --- | --- |
| P0 | constrained sampling / structured output | 直接提升 call_llm、API 工具、分类器的输出可靠性 |
| P1 | 内联 extension 的 provider/context hooks + provider-specific options | 替代全局 fetch interceptor，补齐原生请求控制 |
| P2 | Session Runtime / Tree / export / stats | 用户可见的 branch、导出、统计和精确上下文能力 |
| P3 | 设置暴露：transport、thinkingBudgets、steering mode、compaction/branch 参数 | 成本低、可观测性提升明显 |
| P4 | Pi 原生图像生成 | 补 OpenRouter/Gemini 图像模型能力 |
| P5 | Pi Packages / Extensions / skills 生态 | 安全与信任设计成本高，需单独评估 |
| P6 | pi-server / pi-protocol / telemetry / streamProxy | 已有自研替代或仍属实验性 |

---

## 5. 维护说明

- 本文是能力 gap 的时点记录，不代表已批准的实现计划。
- 实施任何一项前，先核对当前 Pi SDK 版本、对应 .d.ts 与现有 Phaneris 抽象，避免与 durable runtime / session 持久化 / 权限模型冲突。
- 新增原生能力接入后，应同步更新 docs/pi-kernel.md 的当前基线和本文状态。
