# Pi 内核架构与维护基线

本文描述当前实现，不记录迁移过程。历史发布行为以 `apps/electron/resources/release-notes/` 为准。

## 当前基线

- 内核：`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent` **0.86.0**。
- 包管理器与打包运行时：Bun **1.4.2**；版本由 `package.json`、CI 和打包脚本共同固定。
- 后台：只有 `PiAgent`。仓库不直接依赖 Claude Agent SDK，也不打包 Claude 原生二进制。
- Anthropic/Claude 模型、OAuth 连接名以及 `CLAUDE.md` 项目上下文属于提供商或文件格式兼容，不代表存在第二套 agent 后台。

## 运行链路

```text
Electron / Web UI / CLI
          │ RPC + session events
packages/server-core (SessionManager)
          │ AgentBackend + JSONL
packages/shared (PiAgent + event adapter + permissions)
          │ stdio
packages/pi-agent-server (Pi 0.86.0)
          │ provider API / local tools / proxied session tools
```

Pi SDK 被隔离在子进程中。主进程负责会话持久化、权限、sources、浏览器与 UI 事件；子进程负责 Pi 会话、模型运行时、内置工具和 provider 请求。

## 生命周期约束

`agent_end` 只表示一次 agent loop 结束，之后仍可能发生自动重试、上下文压缩或排队续跑，因此不是 Craft 会话的终点。只有 Pi 的 `agent_settled`（0.85.1 起）会关闭本轮事件队列。

长任务需要向用户报告中间进度时调用本地 `report_progress` 工具。它把进度映射为 `isIntermediate` 文本，同时保持 Pi 原生 agent loop 继续运行。纯文本回复因此保留清晰语义：工作已经完成，或确实需要用户输入/批准。

会话重试策略显式声明 `maxAgentDelayMs`（Pi 0.86.0 引入的 agent 级退避上限），不依赖 SDK 默认值。主会话与 ephemeral 会话仍是各自的 in-memory settings，互不泄漏。

`agent_settled` 还会携带 `getContextUsage()` 的结果。UI 的上下文占用以该值为准，避免在压缩后用最后一次 provider usage 误估。

## 工具与 sources

- 会话工具的 schema 和 handler 单一来源位于 `packages/session-tools-core`。
- `PiAgent` 将会话工具与 source 工具合并为完整集合，通过 `sync_tools` 同步。
- 相同定义不会重复同步；新增、删除或 schema 变化才会让 Pi 会话在下一轮重建。
- source runtime 在 `SessionManager` 中缓存，并只对同一个 agent 实例应用一次。
- 浏览器工具开关会推送给所有存活的 Pi 子进程；忙碌会话在下一轮安全刷新，不中断当前工作。
- Windows 使用 Pi 0.85.0 的原生 PowerShell 工具，仍经过 Craft 的终端权限与审计管线。

## 模型发现与思考等级

- 连接分类只看协议，不看有没有 URL：`pi_compat` 的判据是 `customEndpoint.api` 存在，即 Pi SDK 会在 `baseUrl` 注册这个协议。原生 provider（DeepSeek、Minimax、Groq 等）自带端点，预设会把它预填进 `baseUrl` —— 这不足以构成自定义端点。把它误判为 `pi_compat` 会让 Pi 既无法按 provider 路由，也无法注册端点，同时 renderer 会按端点规则判定能力（丢弃图像、禁用思考等级），模型刷新也会因缺少协议而失败。启动迁移会把 `customEndpoint` 与 `pi_compat` 的对应关系收敛回一致状态。
- 标准 Pi provider 的模型与能力来自 Pi SDK catalog；`ModelDefinition` 保留 `reasoning`、`thinkingLevelMap`、图像输入和 `getSupportedThinkingLevels()` 的结果。
- 自定义 endpoint 保存前会依次尝试标准模型列表地址：`/models`、`/v1/models`，并兼容 Ollama 的 `/api/tags`。发现的 ID 会用 Pi catalog 补全上下文窗口和能力；端点返回的显式元数据优先。
- 模型列表不是所有兼容协议的强制接口。发现失败时 UI 允许用户填写逗号分隔的模型 ID，持久化的手动模型不会因后台刷新失败而丢失。
- 思考等级不是全局固定能力。界面按当前模型展示 Pi 报告的 `off / minimal / low / medium / high / xhigh / max` 子集。
- Pi 在初始化、切换模型和修改等级后会回报实际生效等级。若请求等级不被模型支持，Pi 的 clamp 结果会回写会话和 UI，避免显示值与真实请求参数不一致。

## 原生观测与审计

- 模型流通过 Pi 原生 `onPayload` / `onResponse` 组合回调观测。保留 SDK 原有回调行为，在 payload 回调完成后计算 JSON SHA-256 与字节数；只保存允许的响应头，不保存请求正文、凭证或任意 metadata。
- `canonicalRequestHash` 表示标准化上下文；`requestObservation` 表示 SDK provider 回调证据。两者不是同一种哈希，也不宣称等同最终网络字节。回调次数不是网络尝试次数；未触发回调不表示未发送请求。requestedOptions 仅表示边界处显式选项，不代表 SDK/provider 后续补全的最终配置。
- 请求观测随 `model_outcome_committed` 和 usage 在同一 T2 提交。每次最多保留 32 个 payload、32 个响应观测，并记录截断及观测错误数。流直接抛异常或 T2 失败仍保留既有未决操作，不能伪造零用量完成。
- 内联 extension 只读观察工具提议/结果、压缩前/成功/失败、模型/思考等级切换；session 订阅补充重试和 `agent_settled`。活动执行内的记录经主进程同步写入 `sdk_observation`，关联 run/turn/Pi session；执行外事件不强行归属到上一回合。保存失败会报告审计记录可能不完整。
- 工具提议摘要发生在 Phaneris preflight 前，不是执行参数凭证。权限与参数变换仍在主进程，T1/T2 与 canonical context 仍由 Phaneris 持有。没有启用 `tool_result` / `message_end` 内容改写。
- settled 记录包含 `getSessionStats()` 的全部 SDK entries 快照，可能包含继承历史、压缩及工具 usage；它不新增计费行。另由主进程核对当前 run 的模型结果与 usage ledger，区分遗漏、不一致、重复、孤立行和未决结果；这不是提供商账单对账，也不拿 SDK 全量快照直接比较产品任务总账。SDK cost 标记为估算。

## 请求上下文与系统提示

- provider 请求上下文是 Pi 归一化后的 transcript：系统提示与工具声明位于 system 消息内，指令与工具变化以 section 增量补丁下发。Phaneris 覆盖整个 prompt：loader 的 `systemPromptOverride` 提供基础 prompt，内联 extension 的 `before_agent_start` 把它作为 forced prompt 返回，SDK 将其投影为请求头部的 system 消息。不再改写 SDK 私有字段（`state.systemPrompt` / `_baseSystemPrompt` / `_rebuildSystemPrompt`），因为 `agent.state.systemPrompt` 自 0.86.0 起只读，且替换 `_rebuildSystemPrompt` 会让 prompt/tool section 增量与实际请求脱节。
- 请求诊断从 transcript 回放当前 prompt 与工具声明（`getCurrentSystemPrompt` / `getCurrentTools`），因此 `canonicalRequestHash` 与 manifest 不依赖 SDK 的传输形式；conversation 消息只统计 system 消息之外的条目，避免提示与工具被重复计数。请求期 prompt 快照读取 provider 实际收到的 Phaneris prompt，不读取 SDK 结构化 base prompt 的渲染结果（其中含 SDK 自带的 `<cwd>` section）。
- canonical context 恢复（`canonicalContextToPiMessages`）写回的 transcript 不含 system 消息；forced prompt 投影保证恢复后的请求仍带完整 system prompt。工具调用参数按 JSON 值建模（`DurableJsonObject`），与 SDK 的 `ToolCall.arguments` 约束一致。

## 提示缓存与预热

- Pi 0.86.0 默认开启提示缓存预热（`cacheWarming: "streaming"`）：长时间工具执行期间重发上一次请求，输出上限 1 token，按整段上下文的 cache read 计费；需要模型有该保留档位的缓存寿命（内置 catalog 仅直接 Anthropic 提供，并可经 `models.json` 的 `promptCache` 声明）。
- 预热刷新走 SDK 自己的 model runtime（`ModelRuntime.streamSimple`），不经过 `agent.streamFunction`，因此既不产生 T1/T2 durable 记录，也不进入 SDK 观测审计；其 usage 只写入 SDK session 的 `cache_warm` 条目。
- Phaneris 会话显式设置 `cacheWarming: 'off'`，在预热刷新能被提交与归因之前不允许 ledger 之外的 provider 花费。`extendedPromptCache` 只控制缓存保留档位（short/long），与预热无关。

## 性能基线

当前可观测指标包括：冷/热 agent 状态、首事件、首响应、首工具、工具往返耗时、主进程事件处理、renderer 事件处理和 stream-to-paint。renderer 保存有界采样并提供 p50/p95。

已明确避免的热路径成本：

- 每轮重复重建相同 source runtime；
- 每轮重复注册相同工具并重建 Pi 会话；
- 有序实时消息每次执行 `O(n log n)` 排序；
- 同一渲染周期多次构建 turn 分组。

## 残留判定规则

下列内容应保留：Anthropic provider 适配、Claude 模型名称、Claude OAuth 产品文案、读取外部项目 `CLAUDE.md` 与 `.claude-plugin/plugin.json` 的兼容逻辑、历史 release notes。

下列内容不应重新引入：Claude Agent SDK 依赖或 hook 形状、第二套 session tool factory、`session-mcp-server` 后台、只服务旧后台的缓存/构建脚本、将 `agent_end` 当作终态的逻辑。

> **注意**：这条禁令针对的是 **Claude 的 hook 形状与依赖**，不是"钩子"本身。基于 **Pi 原生 extension 钩子**（`tool_call` / `session_before_compact` / `input` 等，见 [`agentic-interception-design.md`](agentic-interception-design.md)）的介入能力是允许方向；判定标准是事件名与类型来自 `@earendil-works/pi-coding-agent` 还是 Claude SDK。同理，`automations` 里那套 `PreToolUse`/`SubagentStop` 词表属于**遗留**，新设计不得复用（见该设计 §3.2 与开放决策 D1）。

## 维护检查

升级 Pi 时至少执行：

```bash
bun install
bun run typecheck:all
bun run test
bun run server:build:subprocess
bun run electron:build
```

同时复核 `AgentSessionEvent`、provider 请求上下文（`TranscriptContext`）、工具工厂、OAuth 注册、context usage、提示缓存预热与计费边界，以及 Windows shell API 的变更，并在 `apps/electron/resources/release-notes/next.md` 记录用户可感知变化。
