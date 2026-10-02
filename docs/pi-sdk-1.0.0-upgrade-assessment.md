# Pi SDK 1.0.0 升级与优化评估

日期：2026-10-03。项目基线：Phaneris 0.2.4；升级范围：Pi **0.87.1 → 1.0.0**。

本次范围包括同步依赖、验证现有接入和评估优化方向。下文提议的新功能尚未实施。评估覆盖 0.99.0、0.99.1、0.99.2 和 1.0.0，不能只看最后一个版本的发布说明。

## 结论

这次升级最有价值的后续方向是：**在现有权限与 Durable Runtime 边界内接入 codemode 和按需工具发现**。其次是输入接收状态、模型目录维护与请求诊断。原生 MCP、图像生成和自动模型路由提供了新的接入选择，但不能靠替换依赖自动完成迁移。

Phaneris 的持久化权威仍是 Runtime Host。Pi 1.0.0 删除 agent-core 的实验性 harness，并不要求我们迁移到 pi-durable；本项目没有导入被删除的 harness API。Pi 的 TUI 改动也不会直接改变 Electron/Web UI 的交互和内存占用。

依据：[1.0.0 发布说明](https://github.com/earendil-works/pi/releases/tag/v1.0.0)、[coding-agent 变更记录](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/CHANGELOG.md)、[agent-core 变更记录](https://github.com/earendil-works/pi/blob/v1.0.0/packages/agent/CHANGELOG.md)。

## 本次已实施的升级

| 内容 | 结果 |
| --- | --- |
| 根目录、shared、server-core、pi-agent-server manifests | 10 处 Pi 直接依赖固定为 `1.0.0` |
| Pi 配套包 | lockfile 中 chord、telemetry、tui、protocol、mcp、codemode 同步为 `1.0.0` |
| 新依赖 | SDK 引入 QuickJS WASI；pi-ai 内部 OpenAI SDK 更新，项目直接依赖版本保持原值 |
| 安装来源 | 当前镜像未提供 pi-server 1.0.0；使用 npm 官方源，新增及升级包的 lockfile URL 固定到官方 tarball，并核对 registry integrity |
| 当前文档 | README 中英文版、内核基线与待发布说明同步；历史评估保留原版本 |
| 产品接入 | 继续使用现有 session、工具代理、权限、缓存预热记账和 canonical context 恢复路径 |

### 兼容边界

| 上游变化 | 本项目现状与结论 |
| --- | --- |
| agent-core 移除 `AgentHarness`、harness tools、实验性 durable runtime 及相关子路径 | 当前代码使用 `Agent` 事件/类型和 `setDefaultStreamFn`；这些 API 仍存在。持久化实现位于自己的 shared/server-core |
| pi-server 不再依赖 agent-core，`SessionMetadata` 只要求 `id` | 当前保留该依赖，但生产源码未导入 pi-server API；不受其 metadata 类型变化影响 |
| 图像与分类模型并入 `Provider`/`Models` | 当前模型选择器继续使用 chat-only 目录；没有使用被移除的旧复数图像 API |
| `prompt`、`steer`、`followUp` 返回 disposition | 现有调用等待执行但忽略返回值，类型仍兼容；接收确认见下文 P1 |
| 内置 MCP/codemode/tool-search | SDK 会话须主动注册扩展。本项目的 resource loader 只注册自己的扩展，升级不会自动启用这些功能 |
| OAuth 与 provider 变化 | 保留当前 openai-codex 连接语义；没有把已有凭据自动改成新的 openai OAuth |

依据：[SDK MCP 接入说明](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/mcp.md#use-mcp-from-the-sdk)、[pi-server 变更记录](https://github.com/earendil-works/pi/blob/v1.0.0/packages/server/CHANGELOG.md)。本地边界见 [`index.ts`](../packages/pi-agent-server/src/index.ts)、[`phaneris-resource-loader.ts`](../packages/pi-agent-server/src/phaneris-resource-loader.ts)、[`canonical-model-context.ts`](../packages/pi-agent-server/src/canonical-model-context.ts)。

## 升级后直接继承的改善

以下是已经进入当前 SDK 请求路径的上游修复，不等于本机对每一种真实 provider 完成了在线验收。

| 改善 | 对 Phaneris 的作用 | 限制 |
| --- | --- | --- |
| provider 工具调用兼容 | Anthropic strict-prefer schema 遇到不支持的关键词可回退；Responses 不完整工具调用会报错，避免执行拼接错误的调用 | 由 SDK 决定 schema 与流式解析；自定义代理端点仍需实际验收 |
| 重试与上下文溢出识别 | 无法解析的 Retry-After 日期走指数退避；补充 Z.AI CN 的溢出错误识别 | 保留项目已声明的重试预算与上下文策略 |
| usage/cost 修正 | 修正部分网关的 Anthropic 长缓存写入价格及 OpenAI Fast 模式价格 | 是 SDK 估算账本；实际账单仍由 provider 确定 |
| 推理与跨 provider 重放 | 修正 Mistral/OpenCode 的推理处理及 Responses grammar tool-call 重放；assistant 消息新增实际请求的 `thinkingLevel` | 我们的 UI/ledger 尚未完整展示新增 thinkingLevel |
| 模型与会话性能 | SDK 优化长会话的模型选择解析及刷新目录合并；目录包含新增模型 | 部分收益依赖是否走对应 SDK 路径，没有本项目性能实测百分比 |

依据：[pi-ai 变更记录](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/CHANGELOG.md)。

## 后续优化优先级

| 优先级 | 建议 | 预期作用 | 实施规模 |
| --- | --- | --- | --- |
| P1 | codemode + 按需工具发现，先复用现有工具代理 | 减少工具 schema 常驻上下文；在一次脚本中编排独立调用、筛选和汇总结果 | 较大，须覆盖权限、嵌套调用、取消与恢复 |
| P1 | 将 SDK 输入 disposition 传回主进程 | 让用户知道输入已排队或已由扩展处理，避免发送成功与接收成功混淆 | 中等，涉及 JSONL、backend 与会话事件 |
| P1 | 收敛模型目录兼容代码与 compat imports | 降低旧 API 维护负担，避免手工模型字段覆盖 SDK 新元数据 | 小到中等，可独立实施 |
| P2 | provider_stream_event + 实际 thinkingLevel 诊断 | 更早定位网关流式异常，区分选定推理等级与实际请求等级 | 中等，需要有界、脱敏的观察结构 |
| P2 | 扩展原生图像生成到 Pi 多类型模型 API | 为 Artifact 工作流接入 OpenRouter 等图像 provider，复用认证和目录 | 中到较大，需要保留产物管理与计费边界 |
| P2 | 评估原生 MCP 客户端，先做接入对照 | 复用 MCP OAuth、后台连接与工具注册机制，减少接入维护 | 较大，须保留 source、凭据与执行边界 |
| P3 | virtual models + classifier 智能路由 | 按任务选择模型/推理等级，并记录实际分派模型 | 较大、实验性，应以质量与成本基线决定是否启用 |

### 1. codemode 与工具发现：优先复用代理，不先迁移连接池

当前 [`SessionManager.ts`](../packages/server-core/src/sessions/SessionManager.ts) 为每个会话创建 [`McpClientPool`](../packages/shared/src/mcp/mcp-pool.ts)，由宿主统一管理该会话的 source 连接，并非全局跨会话共享；[`index.ts`](../packages/pi-agent-server/src/index.ts) 将工具注册进 Pi，并在执行前后走权限与 durable T1/T2。可以先让 codemode 调用这些已注册的工具，保留现有凭据管理和 source 开关。

1. 为代理工具传递 `namespace`、`exposure`、`annotations`、`outputSchema` 和 `structuredContent`。池的 `McpToolResult` 当前主要是文本，脚本需要可验证的结构化结果。
2. 选取工具较多的 source 做按需发现，让稳定的工具名空间摘要驻留 prompt，详细 schema 在调用前加载。常用直接工具继续保留直接声明。
3. 加入 codemode 扩展，确认 nested calls 每次仍进入原有 preflight、T1 和 T2；记录 `parentToolCallId`。现有批次身份来自助手顶层 toolCall，不能假设自动覆盖脚本里的嵌套调用。
4. 验收独立调用的并发、脚本超时、用户取消、工具更新、partial failure 与进程恢复。不可因重跑脚本重复产生已完成的外部副作用。

**验收指标**：相同 source 集合下的请求 prompt token、完成任务的模型轮次、首工具延迟与总费用；同时检查每个嵌套效果的权限和 durable 记录。不要直接采用上游默认 CLI 的 token 节省比例作为 Phaneris 的收益。

依据：[Codemode](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/codemode.md)、[工具编排与 exposure](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/extensions.md#tool-exposure)。

### 2. 输入接收状态：把发送成功升级为 SDK 确认

当前 `PiAgent.redirect()` 发出 `{ type: 'steer', message }` 后立即返回 `true`；子进程等待 `piSession.steer()`，却没有把返回值传回宿主。SDK 新返回值是 `queued` 或 `handled`；`prompt()` 另有 `started`。`handled` 表示输入已由扩展处理，不表示 provider 已读取这条文本。

建议为输入增加 request ID 和确认事件，把 SDK disposition 与出错/无 active session 状态传回。保留原有“压缩期间排队”的规则，确认到达前不要让 UI 把输入视为已经被模型接收。端到端覆盖处理中 steering、压缩边界、会话结束竞态和扩展处理输入。

依据：[AgentSession 源码](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/agent-session.ts)。本地接入见 [`pi-agent.ts`](../packages/shared/src/agent/pi-agent.ts) 和子进程的 `steer` 分支。

### 3. 模型目录：先清理已被上游覆盖的补丁，再考虑动态刷新

[`models-pi.ts`](../packages/shared/src/config/models-pi.ts) 仍保留 DeepSeek Flash 的注入与覆盖代码。已读取 1.0.0 安装目录并确认：SDK 的 `deepseek-flash` 已具备补丁声明的名称、上下文、输出上限、图像输入和 low/high/max 推理映射。该补丁现在可以在独立清理中退出，避免以后覆盖上游的新字段。

该文件和 backend driver 仍读取 `pi-ai/compat` 的静态目录。新代码应评估改用 `providers/all` 的目录读取或共享 `Models` 实例；`pi-ai/models` 提供轻量的集合与 provider 构造入口，适合自定义 provider 路径，但**不会自己提供完整内置目录**。不能简单把所有 import 路径替换成 `/models`。

[`model-fetchers/pi.ts`](../packages/server-core/src/model-fetchers/pi.ts) 当前明确不做周期刷新。后续可让宿主目录与实际 ModelRuntime 刷新结果一致，减少应用升级之间的目录滞后。chat/image/classifier 必须分类型，图像和分类模型不能混入普通聊天选择器。

验收：既有连接默认模型保持原语义，目录过滤和推理档位正确；验证 provider 元数据与 chat-only 选择器；对主进程冷启动和构建体积做前后实测。

依据：[Models 轻量入口](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/models.ts)、[兼容层与替代 API](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/compat.ts)。

### 4. 请求诊断：接入解析后的 provider 事件，不复制完整流

[`native-request-observation.ts`](../packages/pi-agent-server/src/native-request-observation.ts) 当前记录 payload 摘要、响应状态和允许的 headers。新 `provider_stream_event` 可以补足 SDK 归一化前的协议诊断。它是解析后的结构化事件，不是原始 HTTP/SSE 字节，也不会由 SDK 自动持久化。

建议先采样事件种类、provider/api/model、序号与异常标记，再扩展必要字段；不要默认存储内容、凭据或完整 provider payload。将 `AssistantMessage.thinkingLevel` 与实际 physical model 一并映射到诊断视图，继续保持 ledger 对已提交 usage 的唯一记账来源。

依据：[provider_stream_event 契约](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/extensions.md#provider_stream_event)。

### 5. 图像与 OAuth：扩展 provider 支持，保留 Artifact 契约

当前 [`image-generation.ts`](../packages/server-core/src/services/image-generation.ts) 直接调用 OpenAI Images API，并只接受 OpenAI API-key 连接。Pi 新的 `ModelRuntime.generateImages()` 提供 provider-resolved auth 和多类型目录，当前内置 OpenRouter provider 具备 image 实现。

建议增加 provider-neutral 图像适配层，先接入 OpenRouter 路径。不要直接用 codemode 的 base64 返回替代 Artifact 文件、格式验证、大小限制、审核与保存流程；也不能假设 Pi 的 OpenAI chat provider 已支持项目当前的 GPT Image API。独立图像请求要纳入 durable prepare/outcome 和 usage 记账，避免和工具聚合 usage 重复计算。

新的 openai ChatGPT 登录支持需要独立评估连接类型、device ID、凭据刷新、实际模型可用性和原生搜索能力；不能将既有 openai-codex token 直接改名后当作完成迁移。Anthropic copy-code 登录也只有在宿主登录交互接入新选择时才会成为桌面功能。

依据：[多类型模型与图像生成](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/models.md#use-image-models)、[OpenAI provider 实现](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/providers/openai.ts)、[OpenRouter provider 实现](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/providers/openrouter.ts)。

### 6. 原生 MCP 与 virtual models：保持宿主权威，先做对照

Pi 原生 MCP 具备按 server name + URL 隔离 OAuth 凭据、issuer 检查、授权服务器 metadata override 和保留已有 scope 的升级授权。我们当前使用官方 MCP SDK 上的宿主封装，因此 Pi 的 OAuth 实现与修复不会自动进入当前 source OAuth。

原生 `createMcpExtension()` 支持注入 `loadConfig`、`createTransport`、`credentials`、`openUrl` 和 `updateConfig`，可以继续使用宿主的 source 配置与加密凭据，不要求另建配置或凭据库。建议先复用原生工具发现与编排，再对照评估连接层迁移；保留 source 开关、权限、durable 记录与 Artifact 契约。是否改善连接稳定性与性能须实测，不能以“原生”或“共享连接”直接推定。

Virtual models 能分别保存用户选择与每次实际分派，router state 随 session tree 分支并跨压缩保留。但这仍是上游实验性功能。接入前要验证 canonical 恢复、分支锚点、provider 认证、压缩使用的实际上下文窗口及费用归属。分类请求自身有费用和首 token 延迟；频繁切模型还可能失去 prompt cache，不能先承诺节省。

依据：[MCP OAuth](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/mcp.md#authenticate-with-oauth)、[原生 MCP 扩展接口](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/extensions/mcp/index.ts#L65-L84)、[Virtual Models](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/virtual-models.md)。

## 验证与复现

升级前 Pi 子进程基线：202 项测试通过、0 失败。升级后验证结果如下：

| 检查 | 结果 |
| --- | --- |
| 冻结 lockfile 安装、全部 Pi 安装版本 | 通过；10 处直接依赖与 10 个配套安装包均核对为 1.0.0 |
| `typecheck:all` | 通过 |
| 全仓测试及失败工作区完整复测 | 合并最新覆盖：6286 通过、7 跳过、0 失败、0 未处理错误 |
| Pi 子进程测试 | 202 通过、0 失败；真实 SDK 与 bundle smoke 均包含在全仓覆盖内 |
| lint、四项 i18n、identity、version 门禁 | 全部通过；lint 有警告，0 error，未修改无关源码 |
| `server:build:subprocess` | 通过 |
| `electron:build` | 通过，产物校验 10/10 |

首次 `bun run test` 退出码为 1：Pages React 构建触发 30 秒超时，XLSX Artifact 预览触发默认 5 秒超时。两个用例不改代码单独复跑都通过，随后完整复跑 `apps/electron`（包括 isolated suites）和 `packages/server-core`（包括 isolated suites），均通过。合并覆盖使用各测试作用域的最新结果，不把首次全仓运行描述为一次全绿；首次失败与复测的命令、时间、退出码均保留在证据文件中。

本次用真实 SDK、模拟 provider 和禁止外网的 bundle smoke 验证接入，没有发起真实付费模型请求。离线测试不代表所有 OAuth 账户、云端模型或代理端点已在线验收。

复现升级核心检查：

```powershell
bun install --frozen-lockfile --ignore-scripts
bun run typecheck:all
bun run test
bun run server:build:subprocess
bun run electron:build
```

项目其余静态门禁使用 `bun run lint`、四项 `lint:i18n:*`、`identity:check` 和 `version:check`。超时工作区完整复测命令：

```powershell
bun run scripts/run-workspace-tests.ts --filter=apps/electron
bun run scripts/run-workspace-tests.ts --filter=packages/server-core
```

可复核结果与具体复现命令保存在 [验证证据](verification/results/pi-sdk-1.0.0-upgrade.json)，包含安装版本、首次失败与复测、各检查的退出码和时间、lockfile/构建产物 SHA-256，以及本地日志摘要。完整日志位于被忽略的 `.cache/pi-sdk-v1.0.0/`。
