# Pi SDK 1.1.0 升级与 Craft 0.14.1 吸收计划

状态：**用户已批准；B0–B5 实施与 Windows 验收完成**（2026-10-09）。最新结果见[实施记录](./pi-sdk-1.1.0-upstream-0.14.1-implementation.md)，包含初次性能失败与最终同盘 smoke 通过的限定。评估日期：2026-10-08（Asia/Shanghai）；原评估段落保留其当时口径，下文的“当前”指评估基线。

## 1. 建议与范围

**建议把 Pi SDK 从 1.0.2 固定升级至 1.1.0，按功能吸收 Craft 0.14.0 → 0.14.1 的有效增量。先解决升级兼容与既有启动前置问题，再补决策可观测性，最后接入自适应思考和大结果摘取。**

本轮最有价值的组合是：SDK 的 OAuth、重试、codemode 稳定性修复，加上宿主的调用意图贯通、按相关性摘取大结果、认证重试决策去重和按功能统计。新增 classifier 能力值得后续试点，尚不足以支持全面替换现有决策层。

采用以下边界：

- Pi 继续作为唯一 agent 后端；Runtime Host / Durable Runtime 继续拥有输入、执行事实、T1/T2 与用量账本。
- 保留 Phaneris 身份、0.3.0 产品版本线、现有 AI 设置布局、Files 面板和权限策略；产品发版另行处理。
- 按功能移植；不整版 merge/cherry-pick，不用 Craft 的依赖清单覆盖本仓。Craft 0.14.1 自身仍使用 Pi 0.87.1。
- 保留已有用户开关及配置。默认关闭的决策功能不会因依赖升级自动开启。
- 默认串行推进；本计划不顺带启动大文件拆分、依赖全面清理、原生 MCP 全面迁移或发布。

评估阶段已核对本仓源码、Craft 两版的完整文件增量、Pi 发布记录及十个 npm 发布包的声明与包清单；十个下载包均通过 SHA-512 integrity 校验。**2026-10-08 评估时尚未安装新依赖、修改产品源码或执行 1.1.0 运行时/E2E/打包验证。** 当时的机器证据见[评估快照](../verification/results/pi-1.1.0-upstream-0.14.1-assessment.json)，后续实施与独立验收见[实施记录](./pi-sdk-1.1.0-upstream-0.14.1-implementation.md)。

## 2. 冻结基线与前置依赖

| 对象 | 本轮核实结果 |
| --- | --- |
| 本仓 | `main` / `351f592c3f0614bb9ad9e6244210d58b63f5db67`；本地 `origin/main` 同 SHA；产品 0.3.0 |
| 当前 Pi | 四个 manifest、11 处直接版本引用为 `1.0.2`；涉及 ai、agent-core、coding-agent、codemode、server 五个直接依赖 |
| Pi 目标 | 稳定版 `v1.1.0` / `abe508e1b89912adde45528136c3221eb69acdd7`；北京时间 2026-10-08 06:26 发布；npm 目标版本已可下载 |
| 已吸收 Craft | `v0.14.0` / `73bd9c2a3573158bea880984eb8d5fdb41e0cac2`；B1–B5 已在主线，另有本仓后续加强 |
| Craft 目标 | `v0.14.1` / `332533f3096d12500012fe089c3f155e32af1c44`；GitHub API 的 `main` 与本地已有对象一致 |
| Craft 增量 | 67 个文件，新增 1,521 行、删除 351 行；包含 manifests、锁文件、测试、翻译和发行说明，不能等同产品修改量 |
| 发布包核查 | 当前九个 `pi-*` 包及 `chord` 均有 1.1.0 发布包；十包 exports 映射未变，声明中存在需要适配的变化；Node 引擎要求未提升 |

来源：[Pi 1.1.0](https://github.com/earendil-works/pi/releases/tag/v1.1.0)、[Pi 1.0.3 的迁移说明](https://github.com/earendil-works/pi/releases/tag/v1.0.3)、[Craft 0.14.1](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.14.1)、[Craft 增量](https://github.com/craft-ai-agents/craft-agents-oss/compare/v0.14.0...v0.14.1)。

来源限制：本轮 SSH fetch 两次在 upstream 连接阶段被关闭，不能记为同步成功；通过 GitHub API 核对了上述远端 SHA。依照 AGENTS.md 补回缺失的 `+refs/tags/*:refs/upstream-tags/*` fetch 映射，保留 `--no-tags`，未向 `refs/tags/` 导入上游标签。npm 1.1.0 元数据没有 `gitHead`；已验证的是发布标签 SHA、包版本和下载完整性，不宣称建立了源码到 npm 包的可复现构建证明。

工作区现有六项未提交改动：`docs/verification/README.md`、两个通用 Windows packaged-client 结果 JSON，以及 `files-panel-packaged-workflow.ts`、`packaged-client-verification.mjs`、`ui-refinement-workflow.mjs`。本轮不改这些文件。实施宜使用 `codex/pi-1.1.0-upstream-0.14.1` 隔离分支/工作树；最后以实际整合后的脚本和构建重新验收。

**已有前置：首轮工具同步竞态。** [10-06 排序规划](./workstream-sequencing-2026-10-06.md)已确定先修此问题。当前 `ensureSubprocess()` 仍只等待 `subprocessReady`，而完整工具同步在 `requestSetAutoCompaction()` 之后；本次源码复核确认该窗口仍在。先用实际宿主与 Pi 子进程建立首轮/第二轮工具集一致的验收，按既定方案独立修复，处理内部调用重入，之后再评估 SDK 升级。这里没有重新执行竞态复现，不能把历史观测数字当成本次实测。

本计划与原规划的衔接：沿用启动竞态前置；把 Craft 的统计能力纳入原有“决策层可观测”工作；升级和行为移植期间不混入 `SessionManager.ts` / `pi-agent.ts` 的文件拆分。

## 3. Pi 升级：必须做的兼容适配

| 项目 | 已核实的变化 / 本仓落点 | 建议与退出条件 |
| --- | --- | --- |
| 全家族版本 | 四个 manifest 的 11 处引用；传递链还含 mcp、protocol、telemetry、tui、chord | 直接依赖精确固定 `1.1.0`，重解并审核 `bun.lock`；冻结安装后相关十包版本一致、无旧实例混装。未发现非 Pi 家族依赖声明新增变化，不夹带通用升级 |
| **Azure provider 改名** | Pi 1.0.3 将 provider `azure-openai-responses` 改为 `azure`；本仓目录显示、连接名称、鉴权注入、模型解析及 endpoint 分支仍引用旧值 | 统一做 provider 边界别名，覆盖新旧连接、主模型/mini 模型、切换和恢复；保留连接 slug、Vault 归属及历史事实。**API 类型仍叫 `azure-openai-responses`**，不能全局替换同名字符串 |
| **取消事件契约** | `AgentSessionEvent.agent_settled` 新增必填 `aborted: boolean`；本仓 `handlePrompt` 失败分支人工发送的事件缺此字段，原生观测也未记录它 | 补齐人工事件与相关夹具；记录正常/取消/错误的不同结果，保持 Durable 终态唯一、回执和队列收口。`aborted: false` 也不等于执行成功 |
| 工具时长 | 新增 `tool_execution_end.durationMs` 和持久化工具结果时长；本仓 adapter 仍以开始/结束墙钟差计算 | 有有效 SDK 时长时优先保留，旧记录使用兼容路径，缺失不编造。明确这是被包装 `execute()` 的耗时，可能包含宿主往返/审批；不能直接命名为纯命令执行时间 |
| 工具暴露规则 | `tools`/`excludeTools` 新增通配和增减语义；非 MCP allowlist 可保留 MCP 供 codemode/tool_search 使用；`ToolLoadout` 新增 `getPromptGuidelines()` | 核查主会话、临时查询、direct/deferred/codemode、source 禁用和恢复的实际可见/可调用工具；修正旧夹具，不让临时查询获得编排能力或被关闭的工具复活 |
| codemode 输出 | 多段文本/console 分隔变化，`read` 图像可交给 `image()`；图像新增临时落盘，内建对象冻结 | 真实嵌套工具仍经宿主权限与 T1/T2；验证图片展示和后续引用、脚本异常/取消、输出上限及打包 worker/WASM。保留 `models: false`，模型调用仍走受管路径 |
| OAuth 刷新 | 新增锁内刷新并保存的 `refreshStoredOAuthCredential`；调用取消后，已开始的 token 轮换仍须完成保存 | 核对本仓内存 CredentialStore、主进程 Vault 和 `token_update` 的责任边界；验证取消、并发、进程退出后的凭据一致。SDK 内存刷新成功不能直接当作宿主 Vault 已持久化 |
| 重试、定价和模型能力 | 新增 provider 可重试错误、Bedrock thinking 修复、长上下文分档价格、新模型目录及 token 估算调整 | 重跑实际请求边界、usage ledger、任务预算和压缩场景。每个物理请求/辅助请求只落一次账；SDK 会话累计统计仍只作参考，不能再次计费 |

主要本仓文件：[模型目录](../../packages/shared/src/config/models-pi.ts)、[连接设置](../../packages/server-core/src/domain/connection-setup-logic.ts)、[模型解析](../../packages/pi-agent-server/src/model-resolution.ts)、[Pi 子进程](../../packages/pi-agent-server/src/index.ts)、[事件转换](../../packages/shared/src/agent/backend/pi/event-adapter.ts)、[生命周期观测](../../packages/pi-agent-server/src/native-lifecycle-observation.ts)、[资源加载](../../packages/pi-agent-server/src/phaneris-resource-loader.ts)、[Pi 宿主](../../packages/shared/src/agent/pi-agent.ts)。

SDK 源码依据：[provider/API/classifier 类型](https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/src/types.ts)、[OAuth 原子刷新](https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/src/auth/resolve.ts)、[会话事件](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/agent-session.ts)、[工具可见性契约](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts)、[输出文件](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/utils/output-files.ts)。

Azure 本轮优先采用**进入 SDK 时映射的兼容方案**，维持宿主存量配置的可回读性，不批量改写用户配置、Vault 或 canonical journal。SDK 历史中的旧 provider 也须单独验证；若 Pi 直接恢复会回落到别的模型，应在受控恢复入口适配或明确报错，禁止静默换账户/模型。协议 API、`AZURE_OPENAI_*` 环境变量与 provider 标识是三个不同层次。

codemode 的图片路径目前指向 OS 临时目录，不能自动等同 Phaneris Artifact。会话需要长期保留时，应通过已有 Artifact/文件引用机制保存受管副本；临时路径和 Windows 文件权限另作验收，不把 POSIX `0600` 当作 Windows ACL 已验证。

## 4. Craft 0.14.1：采用清单

| 编号 | 变更 | 当前本仓事实 | 处理 |
| --- | --- | --- | --- |
| U1 | MCP/API 调用意图贯通 | pre-tool metadata 中已捕获 `_intent`；宿主 `routeToolCall()` 只向 pool 传 `durableTool`，API pool 没有补回 intent | **优先适配**。以稳定 toolCallId 关联并传递意图，同时保留 Durable 身份、父调用和 ordinal；只对声明接收该字段的嵌入 API 工具补回，不能污染外部 MCP 参数 |
| U2 | 全结果分块、按相关性保留摘录 | 仍是读取开头 3,000 字符决定“摘要/预览”的 gate；Pi→host 只传前 8,000 字符 | **重点采用**。U1 完成后，把 gate 升为有界 filter；全量原始结果先落盘，返回原顺序摘录、缺口标记和完整文件引用；无有效裁剪时走现有摘要/预览 |
| U3 | 认证重试复用本轮决策 | `activationResend` 已复用 thinking；`startPreTurnDecisions()` 尚未接入 authRetry 或保存 suggestion hint | **采用缺失部分**。同一 Durable 输入的认证重试不重问 thinking/suggestions，保留 hint；不能取消宿主输入确认、generation 检查和任务预算 |
| U4 | 决策冷启动 deadline | 目前只有现有 deadline 与前台上限，没有冷启动记录 | **采用机制并适配**。可参考上游闲置 30 秒后的 2,800 ms 默认预算；冷热状态按连接身份/endpoint/model 隔离，不能只按 provider 名；请求硬截止、取消及前台上限优先 |
| U5 | 自适应思考读前文与附件元信息 | 当前只评估当前消息；已有“只降不升”、用户中途降档优先、迟到结果失效与无人值守排除 | **在原开关下采用**。补上一条最终回复尾部、附件名称/类型/大小；纠正前文时不降档，有外部影响的动作提高降档下限，但仍不得超过用户档位 |
| U6 | 各决策功能的使用/改变/失败统计 | Durable 记账与 `decisions:report` 已有；没有 `GET_USAGE` 及设置页每功能统计 | **先于 U2/U5 行为调整接入**。读取现有日志及轮转文件，补按 action 的 follow-up、cold 指标和远程 RPC，在现有 AI 设置中显示统计 |
| U7 | Guarded 风险检查失败时确认 | 当前实现已对空答案、异常、非法 risk 和缺检查采取确认/阻断，并处理无人值守与取消 | **保留本仓实现，回归即可**。不覆盖成较弱的上游分支；旧评估文档中的 fail-open 描述只代表旧阶段。当前源码与 10-06 规划更近 |
| U8 | hidden 后台消息不评级 | 本仓已有 `isAttendedSession(managed) && !options?.hidden`，并排除任务会话 | **已覆盖，回归即可**；移植 U3/U5 时不得退化 |
| U9 | 侧栏长标题单行截断与完整名称提示 | 已有 `sidebar-label truncate` 和折叠态 tooltip；展开态没有完整标题提示 | **仅补展开态提示并验证窄宽度**；不覆盖本仓侧栏样式与折叠交互 |
| U10 | 版本、品牌、Claude 路径与上游文档 | 上游 0.14.1 另含版本/lock/Claude 专属变更 | **不直接移植**。测试只提取适用失败场景；翻译与类型/API 接线按所选功能同步；本仓发行说明记录实际交付 |

源码出处：[意图传递](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.1/packages/shared/src/agent/pi-agent.ts)、[相关性评分](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.1/packages/server-core/src/decisions/relevance.ts)、[大结果摘取](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.1/packages/server-core/src/decisions/large-results.ts)、[决策 deadline](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.1/packages/server-core/src/decisions/decision-point.ts)、[思考策略](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.1/packages/server-core/src/decisions/adaptive-thinking.ts)、[统计](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.1/packages/shared/src/decisions/usage.ts)。67 个文件的处理类别保存在评估快照中。

### 4.1 大结果摘取的适配要求

这是本轮收益潜力最大、也最需要完整接线的一项：

1. **执行事实**：raw result 仍先完整保存。摘取只改变发给模型的视图，不能覆盖原始结果、重放工具或破坏完整 `structuredContent` 的消费契约。
2. **协议成套修改**：shared 类型、Pi gate client、宿主 handler、pool 和 API source 同批修改；保留本仓已有的发送失败兜底、`cancelAll()`、迟到回复隔离，不能用上游文件覆盖掉这些加强。
3. **输入与资源预算**：上游每批最多 64 问题/60,000 字符、并发 8，采用前核对所选 provider 与总调用预算；增加整个过滤操作的总 deadline/取消，避免每批各自超时后仍继续消耗。全文通过 JSONL 的大小、主进程内存和日志脱敏需要验收。
4. **完整性**：任何批次失败、缺答案、格式不符都回退；不能把未被评估的片段当作不相关。预算须计入头部、分隔与缺口说明，不能只计算正文；中文、JSON 大对象和长单行分别覆盖。
5. **数据发送范围**：这会把原先只给 decision provider 的结果前缀扩大为分块正文；在功能说明中如实更新，维持显式开关与现有 provider 选择。日志不保存完整正文或凭据。
6. **指标解释**：上游 `file_read` 通过工具入参是否出现文件 basename 推断，不能当成成功阅读证明；补齐准确路径/成功结果关联，或明确显示为“尝试访问原文”。读了原文也不能直接推断过滤失败，没读也不能证明信息完整。

不把上游发布说明中的半秒耗时或超时比例写成本项目收益；只有本仓同任务、同模型、同材料的对照才能给出性能和质量结论。

### 4.2 统计与思考策略的限制

- “过去 7 天”实际可读范围受当前日志和上一份轮转日志保留量限制。界面应说明保留范围；缺数据不能显示为零。
- 多批 relevance 请求会产生多个调用但通常只有一个业务 outcome，应区分调用数、结果处理数和有 outcome 的样本数，避免错误计算“改变率”。
- 30 次有 outcome 但没有改变只是一项观察，不能自动关闭功能或认定无价值；取消、失败、unknown cost 和用户未开启需分别呈现。
- 新增 `GET_USAGE` 应作用于会话所在服务器，沿用授权与数据范围；检查 Electron 与 WebUI 的 API 映射，不只接桌面页。
- 自适应思考的“至少 High”受用户上限约束：用户选 Low 时仍不能升至 High。附件只传元信息，用户纠正与 follow-up 是推断标签，不是人工评测准确率。

## 5. 串行实施批次

| 批次 | 工作 | 完成门槛 / 可回退单位 |
| --- | --- | --- |
| B0 基线与前置 | 隔离工作树、记录旧 SDK/构建/hash/工作区；按已定规划闭合首轮工具同步竞态；先写失败矩阵和 E2E | 新会话首轮与后续工具集一致；并发标题/mini 查询不提前放行、不重入自锁。旧问题与升级回归分账 |
| B1 Pi 1.1.0 | 版本与 lock、Azure 边界映射、settled/aborted、duration、工具暴露与 codemode/OAuth 兼容 | 冻结安装、相关类型检查和真实子进程工作流通过；Azure/取消/重试/权限/资源无退化。SDK+适配+bundle 作为整体回退 |
| B2 决策基础与观测 | U3 认证重试去重、U4 冷启动、U6 统计；U9 侧栏提示 | 重试不重复决策或记账；不同连接冷热隔离；真实认证 RPC 与设置界面/日志轮转验证通过；小块可分别回退 |
| B3 思考上下文 | U5 前文/附件元信息/纠正保护/后续反馈 | 用户档位是上限，迟到结果不能覆盖新状态；默认与无人值守策略保持。可用现有 `adaptiveThinking` 开关回退 |
| B4 大结果处理 | U1 意图贯通 + U2 filter，全链路与 T1/T2/原始结果保存 | 真正 MCP/API→宿主→Pi→下一次模型请求覆盖；末尾证据保留、失效回退、取消、预算与费用可核对。现有 `largeResults` 开关关闭可回到原摘要流程 |
| B5 整体验收 | 全仓既有门禁、Windows 最终客户端、资源一致性、文档和本仓发行说明 | 以最终源码和最终包生成独立 JSON、截图及 SHA-256；标注平台/真实 provider 未测范围，不发布、不改产品版本冒充已发版 |

每批保留明确提交边界；功能通过后才进入下一批。B2 的统计先于 B3/B4，便于判断后续变化是否有效。不用分支合并数量衡量吸收完成度，按 U1–U10 的产品契约逐项闭合。

## 6. 实施前失败矩阵与验收产物

遵循仓库规则：复杂功能以 E2E 为主，先定义失败方式再改代码；如需隔离验证，也先写完整失败条件，不能实现后补镜像式单测。

| 范围 | 必须覆盖的失败路径 | 可重复证据 |
| --- | --- | --- |
| 首轮与并发初始化 | 子进程 ready 但 tools 未同步；标题/mini 并发；内部重入自锁；重启后缺工具 | 实际宿主+Pi JSONL 子进程，保存两轮工具名/可见性与消息时序 |
| SDK/打包 | 旧版本混装、冻结安装失败、worker/WASM 漏装、仓库内能跑而包外不能跑 | 依赖图版本快照、bundle/worker/WASM 哈希、仓库外随包运行时工作流 |
| Azure | 旧 provider 新 SDK 查不到、API 类型被错误改名、选错同名模型/账户、旧会话静默回落 | 回环 API 记录 provider/API/endpoint/模型身份；配置、恢复和回退断言，报告脱敏 |
| 取消/失败/重试 | 正常结束误标取消、早期失败事件不完整、取消后还续写、重复终结/记账、刷新轮换丢失 | 真实事件流+持久化 journal/ledger；OAuth 使用本地受控轮换服务，真实登录另外验证 |
| 工具/codemode | source 禁用后仍可发现或调用、临时会话拿到编排工具、嵌套工具绕权限/重复副作用、图像丢失 | MCP/API 回环工具计数、批准/拒绝时序、唯一 T1/T2、图片与历史引用、输出边界 |
| 决策基础 | authRetry 重复请求、hidden/任务重评级、冷热跨连接、deadline 无限延长、取消后统计写错轮 | 请求次数、connection/session/turn 关联和 deadline 记录；不得记录凭据/正文 |
| 思考策略 | 短确认+附件被过度降档、纠正仍降档、超过用户上限、停止/降档后的旧结果生效 | 真实宿主轮次、配置持久化、附件仅元信息断言；离线应答只证明策略 |
| 大结果 | 证据只在末尾；无关/几乎全部相关；分块失败/缺答案；标题/缺口超预算；取消/崩溃后迟到回复 | 原文文件哈希、保留片段位置与完整输出长度、降级路径、请求及费用数量；包含中文/JSON/日志 |
| 统计/UI/远程 | 轮转遗漏、重复 outcome、无数据变成零、费用缺失当免费、远端读了本机日志、长标题不可读 | 带认证 RPC、实际设置组件/客户端、中文截图、统计与账本对照 |
| 历史/性能 | SDK/连接回退读不回历史、首屏变慢、资源膨胀、已知失败被记成新增或藏掉 | 同口径升级前后性能报告、历史加载/fork/compaction、最终包启动与结构报告 |

优先复用[既有整合工作流](../../scripts/verification/capability-integration-workflows.ts)、[原生 MCP 对照](../../scripts/verification/native-mcp-source-workflow.ts)、[决策工作流](../../scripts/verification/decision-feature-workflow.ts)、[决策治理](../../scripts/verification/decision-governance-workflows.ts)、[图像工作流](../../scripts/verification/image-capability-workflows.ts)、[Pi 1.0.2 验证结构](../../scripts/verification/pi-1.0.2-upgrade-workflow.ts)。新的 1.1.0/0.14.1 产物使用独立文件名，历史报告不改成新版本结果。

最终检查包括 `bun install --frozen-lockfile`、`bun run validate:ci`、相关现有回归、Pi/Electron/WebUI/Viewer 构建、Windows 包结构与启动、随包 Bun 在仓库外执行；若推送，必须通过原 pre-push，不绕过。验收报告保存命令、退出码、源码 SHA、夹具版本、实际 SDK 版本、产物哈希和已知限制。

历史 1.0.2 首次导航 3,000 ms 目标未闭合，见[完成记录](./capability-completion-2026-10-04.md)。此次应先测当前 0.3.0 的同口径基线，既不把历史失败假定为今日失败，也不未经测量宣布已修复。Linux/macOS、真实 provider/OAuth 和真实模型质量未测时分别标为未验证；本地回环不能代替这些结论。真实模型对照需另行明确样本、服务及调用预算。

## 7. 本轮后置的能力

| 能力 | 新信息 | 为什么不随本轮切换默认 |
| --- | --- | --- |
| 原生 classifier | Pi 1.1.0 增加 GPT-6 Luna/image context，以及 llama.cpp 0.6.0+ 原生 decision 模型发现 | 现有 score 仍需概率分布，Pi `ClassifierScoreAnswer` 仍只有 score/confidence；state 仍要求 JSON object，结构化 instructions/criteria 差异仍在。优先另做受管 bool/choice 与本地 Laya 等价试点 |
| 原生 MCP 全面迁移 | MCP OAuth、取消及连接关闭有改进 | legacy SSE 仍不支持；Source 唯一所有权、Vault/OAuth、共享连接及权限/Durable 故障验收仍须完成，宿主 pool 不因升级自动被替代 |
| virtual model / Radius 默认路由 | 目录和 provider 修复可随 SDK 获得 | 多连接账户映射、辅助请求记账、实际模型事实和恢复还需专门设计；不改变用户当前指定模型 |
| Pi TUI/CLI 特性 | OSC 7501、终端排版、键位、managed install 清理等 | 不把终端能力当作 Electron 产品收益；本仓自有分发与 UI 继续按自身契约工作 |

上述结论复核了[1.0.2 收敛评估](./pi-sdk-1.0.2-upgrade-and-convergence-assessment.md)的硬差异；不是把旧结论原样沿用。原生能力证据见 [1.1.0 classifier 文档](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/models.md#use-classifier-models)、[llama.cpp 分类](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/llama-cpp.md#classification)、[MCP transport 边界](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md)。

## 8. 回退约束

- SDK 回退必须同时回退 manifest/lock、桥接适配与打包资源，禁止仅把一个包降级；保留原始输入、工具结果和账本事实。
- Azure 以 SDK 边界兼容为先。若实施最终必须改持久化 schema，应先补可逆迁移及旧版读取验证，再纳入升级，不能临时批量替换用户目录中的字符串。
- U2/U5 保留独立功能开关；失败按已有摘要/用户指定 thinking 路径继续。关闭统计展示不改变权限或执行事实。
- 测试和迁移使用隔离配置。任何实际用户数据删除/整体重写须另列具体变更摘要；本计划没有安排这类操作。

计划完成的判据是：B0–B5 的功能与验收记录逐项闭合，U7/U8 已有行为保持，后置能力边界明确；版本号变化本身不代表完成。
