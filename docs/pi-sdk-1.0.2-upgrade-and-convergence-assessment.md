# Pi SDK 1.0.2 升级与 MCP、classifier、路由收敛评估

日期：2026-10-04。依据用户要求，升级到指定的 1.0.2，并重新评估全面替换的条件。此处全面替换指运行职责与产品契约迁移，不以更换包名或提供同名 API 为完成标准。

## 升级前记录的失败路径

- Pi 家族直接依赖或传递依赖混用 1.0.0 / 1.0.2；锁文件未更新或不可冻结安装；发布包版本与 Git 标签不一致。
- MCP / classifier / virtual model 的公开声明移除或语义改变；只读发布摘要便误判等价；移除上游 shrinkwrap 后传递依赖悄悄漂移。
- 子进程、worker、WASM、打包资源仍为旧版本；源码类型检查通过，但仓库外启动无法找到资源。
- 把 MCP 项目覆盖和原生 OAuth 当成现有加密凭据、工作空间权限、Source 单一所有权已经迁移；忽略续期、撤销、重连、崩溃及多会话场景。
- 把新增 classifier 模型当作置信度、结构化输出、概率分布和辅助用量已等价；使用自报置信度或本地模拟结果证明真实质量。
- 把 virtual model 路由当成账户 / 凭据 / 连接选择；当前指定模型、费用归属、权限、会话恢复和失败回退发生隐性变化。
- 将 1.0.0 的真实 DeepSeek 对照归于 1.0.2，或无新测试授权重复付费。已有实测保留版本与样本范围，本轮升级验证使用本地回环流程。
- 补丁工作流：配置的默认 / 档位采样参数合并顺序错误；请求覆盖失效；虚拟模型被直接发给 provider；路由异常后仍调用 provider；不可信项目覆盖全局 MCP；可信项目覆盖丢失全局 URL / 认证字段。先以隔离配置和真实回环 HTTP 记录这些场景，报告不包含凭据或完整请求内容。

## 升级范围与上游变化

四个 manifest 的 11 处直接引用固定为 `1.0.2`，同步 `bun.lock`。安装的九个 Pi 包（ai、agent-core、coding-agent、codemode、server、mcp、protocol、telemetry、tui）均为 1.0.2，无旧版本混装。npm 官方版本记录的 Git 提交为 `cd32f7725fdbddbaecdff5b1e68491563394e0ca`，与 GitHub 标签一致；冻结安装通过。Phaneris 产品版本保持 0.2.4。

| 上游增量 | 对本项目的意义 | 本轮状态 |
|---|---|---|
| 1.0.1 MCP 项目覆盖 | 项目可单独覆盖 enabled / exposure / toolExposure，并保留全局连接身份 | 原生加载器已本地验证可信 / 不可信项目；当前产品仍由 Source 配置管理，未读入第二套 `.pi/mcp.json` |
| 1.0.1 MCP CIMD OAuth | 新增授权服务的客户端注册选择 | SDK 参数与配置保留已验证；真实授权、续期、撤销和 Vault 迁移未验证 |
| 1.0.1 Clef / Clef Flash | 增加 Cloudflare classifier 候选 | 已确认属于 classifier 目录；没有真实准确率或费用结论 |
| 1.0.1 codemode 输出限制、Anthropic 动态工具与 provider 修复 | 升级获得上游执行稳定性和兼容修复 | 现有受管 codemode / 工具工作流复核；终端工具 renderer 与 Nix 安装不作为 Electron 产品功能 |
| 1.0.2 按思考等级采样 | `samplingParamsByThinkingLevel`：模型默认 → 有效档位 → 请求级覆盖 | 经真实回环 HTTP 验证三种合并结果；产品连接配置尚未提供这些字段，不宣称已经自动应用 |

出处：[1.0.1 发布](https://github.com/earendil-works/pi/releases/tag/v1.0.1)、[1.0.2 发布](https://github.com/earendil-works/pi/releases/tag/v1.0.2)、[模型配置](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/models.md)。1.0.1 移除了上游发布包的 npm shrinkwrap；本项目继续使用自己的锁文件和冻结安装控制传递依赖。

声明快照对照覆盖六个主包的 517 个声明 / 文档文件：包 exports 不变。移除的三个声明属于终端动画内部组件，不命中项目；classifier 问题 / 答案、virtual model、ModelRuntime 与 agent-core 声明保持不变。此为文本声明核对，语义兼容由下列运行工作流补充。

原生 MCP 回归首次暴露夹具与新版 ExtensionAPI 不一致：1.0.1 的 MCP 扩展新增调用 `registerToolRenderer`，旧夹具未实现该入口。补齐注册捕获及断言；生产 SDK 提供此 API。初始化失败现在明确写入失败记录，避免空 records。保留 `native-mcp-pi102-initial-failure.log` / JSON，未因此改变产品 MCP 执行路径。

## 全面替换的结论

| 对象 | 当前判断 | 首要欠缺 | 何时可移除旧实现 |
|---|---|---|---|
| MCP client / transport / 工具注册 | 可分段迁移，全面替换条件尚未满足 | legacy SSE、宿主权限与 T1/T2 接入、Vault / OAuth、共享连接生命周期及故障验收 | 全部受支持 Source 在原生路径保持契约，且迁移 / 回退不丢连接、审批与执行事实 |
| classifier 适配器 | 可先迁移等价子集，完整替换仍有接口差异 | score 概率分布、自由文本 state、结构化 instructions / criteria、治理与真实质量 | 13 个功能的所有请求形状、阈值、失败和费用行为通过；差异已有明确的产品或协议处理 |
| 模型自动路由 | SDK 原语足够启动接入，生产默认切换条件尚未满足 | 多连接凭据映射、路由请求记账、分支恢复、成本 / 质量 / 延迟门槛 | user / continuation / retry / direct 与全部账户、历史和预算场景通过；自动模式可解释且可回退 |

1.0.2 没有消除这些工程条件。MCP 协议仍然保留；替换对象是现有客户端、transport 和注册实现。路由指 Radius / virtual model 的模型选择，连接协议解析及工作空间 RPC 路由继续承担各自的产品职责。

## MCP：已经具备与具体缺口

SDK 提供 `createMcpExtension({ loadConfig, credentials, createTransport, updateConfig, openUrl })`，因此不必默认写入上游 `mcp.json` / `mcp-auth.json`。上一轮“原生 MCP 必然造成第二个 Source 所有者”的假设已被实际 HTTP 对照推翻。现有原生 Source 工作流验证 descriptor、annotations、structuredContent、资源引用、8 个并发、撤销与关闭；它使用 ExtensionAPI 夹具和实际 transport，没有证明完整 AgentSession 权限链路。

| 缺口 | 性质 / 当前证据 | 可验收的完成条件 |
|---|---|---|
| legacy SSE | **上游能力差异**：Pi 1.0.2 明确不支持；宿主 MCP pool 仍接收 `sse` | 盘点并迁移所有 SSE Source 至 streamable HTTP，或保留显式兼容桥。仍保留桥时，不能宣称完全移除旧 transport |
| Source 配置和生命周期 | **接入工作**：目前宿主 pool 负责连接，SDK 通过代理获得工具；回环单 Source 所有权可保持 | 选定唯一连接所有者；多 Session 复用、Source 更新 / 关闭、权限切换、SDK 重启、进程崩溃都无残留或重复连接；嵌入 API Source 不丢能力 |
| Vault 与 OAuth | **接入及验证**：SDK 可注入存储；默认按 server name + URL 存储，支持刷新锁 | 映射工作空间、Source、账户身份；Vault 加密读写、跨进程刷新与轮换 token、撤销 / 增量 scope、桌面 / 远程 Server、DCR / CIMD 成功和失败均验证。禁止让项目配置选择泄露凭据的目的地 |
| 权限 / 持久执行 | **接入工作**：SDK tool_call hook 能阻断；它不提供 Phaneris 的 T1/T2 | 原生 direct、deferred、codemode 嵌套调用都经现有批准、参数变换、父 ID / ordinal、T1/T2、取消与未知效果恢复；无副作用重放。annotations 只作提示，不能等同授权 |
| 工具与资源兼容 | **验收欠缺**：完整 descriptor / content 已局部通过；资源与命名边界尚未全覆盖 | 工具名归一化 / 碰撞映射、动态增删、资源列表 / cursor / 二进制 / 全文截断、图片、错误、超时与长任务进度逐项对照；保留原可见工具身份和历史引用 |
| 恢复与收益 | **生产证据欠缺**：上游支持按需重连，但本项目未做完整故障矩阵 | 网络断开、401、429 / 5xx、stdio 退出、宿主及子进程崩溃，验证读请求重试 / 写请求不重放；同 Source 与任务跨多轮测量质量、连接数、资源、首工具和总耗时 / 费用 |

上游支持 stdio / streamable HTTP 的 transport 边界、配置、权限与资源规则见 [1.0.2 MCP 文档](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/mcp.md)。宿主实现见 [mcp-pool.ts](../packages/shared/src/mcp/mcp-pool.ts)、[pool-server.ts](../packages/shared/src/mcp/pool-server.ts)、[resource loader](../packages/pi-agent-server/src/phaneris-resource-loader.ts)。

**迁移入口**：先对一个 streamable HTTP Source 接入完整 AgentSession，配置和凭据由宿主注入，原生注册工具经过现有执行包装。未完成生命周期与共享连接设计前，不同时让宿主和每个 Pi 会话启动同一个 stdio 服务。真正的连接所有者迁移是后一步；通过宿主 bridge 的原生工具注册只是一阶段接入。

## Classifier：不是增加一个模型就能全部替换

1.0.2 的 `ClassifierContext.state` 仍为 JSON object；instructions / choice criteria 仍要求 string；score 答案只包含 score + confidence，**没有现有 `ScoreAnswer.probabilities`**。bool 与 choice 已有原生对照，产品 15 个检查点中 12 个可表示，另三个涉及 taskVerdicts 结构化指令、adaptiveThinking score 分布、自由文本 decideTool state。

| 缺口 | 处理路径 | 完成条件 |
|---|---|---|
| score 完整分布 | 上游扩展 score 结果；或将有序分数显式改成 choice 并由分布计算期望分数；或保留该适配 | 对现有语义和阈值作成对验收，不能伪造概率或在请求后猜补字段 |
| 文本 state / 结构化描述 | 明确设计无损编码协议；保留原始数据 / 摘要边界；评测编码后的模型行为 | 全部现有请求形状得到业务验证；不能把简单 JSON stringify 当成已经语义等价 |
| 请求治理 | 在 `models.classify` 外组合现有 DecisionClient 的验证、截止时间、取消、失败分类、状态脱敏与独立辅助记账 | 请求前 T1、成功 / 失败 / 超时 T2、未知费用及 follow-up 关联保持一致；缺价不记免费；原有 Guarded / 人工覆写不变 |
| provider / 连接 | 映射已有 TypeSafe / OpenRouter / Vercel / Laya / custom 配置与 Vault；Clef 需要账户 ID 与 API key | 现有连接无需重建即可使用；本机和远程凭据归属正确；明确未原生支持 provider 的兼容方式 |
| 真实模型质量 | 用人工标注的中文业务样本比较 Jev / Clef / 现有适配的误判、弃权、校准和纠正 | 用户事先确定不同功能的接受门槛与调用预算；高影响权限 / verdict 保持保守失败策略，覆盖各功能延迟和总费用 |

现有 DeepSeek Flash 是聊天语义参考，不是 Jev / Clef 原生 classifier 的质量证明。Pi 1.0.0 下完整决策协议仅 3/15 合格，简化语义 14/15；这些为 agent 整理的合成标签，不能当作人工生产准确率。该付费记录本轮未重跑。

声明证据：安装包 `pi-ai/dist/types.d.ts` 的 ClassifierContext / ClassifierScoreAnswer；项目 [types.ts](../packages/shared/src/decisions/types.ts)、[client.ts](../packages/shared/src/decisions/client.ts)、[comparison](../packages/shared/src/decisions/pi-classifier-comparison.ts)、[accounting](../packages/server-core/src/decisions/accounting.ts)。上游入口见 [classifier 文档](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/models.md#use-classifier-models)。

**迁移入口**：先把等价 bool / choice 的底层请求切到 Pi Models，保持宿主 DecisionClient 契约、记账和失败策略；不同协议的 provider 仍保留适配。待三类差异解决且质量通过后再讨论默认与完整移除。成本 UI、Task 预算和用户开关继续由宿主管理；不开放 codemode 的 `models` global 绕过受管请求。

## 路由：原生原语已具备，账户与事实链路需要接通

本轮回环工作流已证明原生 virtual model 可以发送物理模型、返回物理 provider / model；route 抛错时不调用 provider。第一次夹具跳过 `refreshOnCreate`，导致原生 auth 可用性快照为空而拒绝路由；修正为默认的离线初始化后通过，保留失败证据。它不证明宿主生产路由已经完成。

| 缺口 | 现状与完成条件 |
|---|---|
| 路由对象与账户隔离 | 宿主选择的是 connection slug、provider、模型和凭据；Pi 原生按 provider / model 路由。当前子进程只注入所选连接。需把允许候选连接映射为明确账户身份，验证同 provider 多账户、custom endpoint、OAuth 续期、远程 Server 与连接撤销；不能按同名模型选错账户 |
| 模型配置与缓存来源 | 当前 `createAuthenticatedRuntime` 注入 credentials 与 `allowModelNetwork: false`，没有显式传入 modelsPath / modelsStore；SDK 默认从其 agent directory 解析模型文件及缓存。resource loader 的会话 agentDir 不能据此被当成 runtime 配置隔离证明。迁移前需确定由宿主注入还是保留现有兼容、提供唯一配置与缓存来源，并验证无环境配置覆盖或错误模型价格 / endpoint |
| 路由选择与实际执行记账 | native classifier / router 内辅助调用尚未接入宿主 ledger。必须在任何 provider 请求前记录路由选择 / 分类 T1，分别关联辅助费用与物理模型请求 T1/T2；实际模型 / thinking 与选择值分开，错误 / 未知费用也归属 Task 预算 |
| 四类请求与缓存 | 指定 `user` / `continuation` / `retry` / `direct` 的策略；工具续接与签名 / cache 保持稳定，失败回退只选可授权连接，摘要 / compaction 单独治理；不把原生 route 抛错视为已经自动安全回退 |
| 分支、恢复与 canonical 事实 | Pi 保存 branch route state，但宿主 durable context / Session 是另一套产品事实。验证恢复、fork、compaction、SDK 重启、虚拟模型取消注册和路由失败，保持同一个选择与执行事实，不在仅有准备记录时重放已发生请求 |
| 模型能力与数据边界 | 切换前检查图像、工具、上下文、schema、thinking 和费用预算；验证文本降级、上下文过小压缩、地域 / 允许 provider、手动模型锁定。不能只比较价格或上下文大小 |
| 产品收益与回退 | 定义明确的自动模式与候选集；展示选择、物理模型及原因；用同任务多轮比较完成质量、人工纠正、首 token / 总耗时、路由及下游总费用。先满足用户确定的业务门槛，再切默认；保留手动模式和可重复回退 |
| Radius 与虚拟模型的关系 | Radius provider 连接 / OAuth 已有目录与凭据入口；它是另一种路由服务，不能等同宿主跨连接路由已接入。单独验证实际响应身份、计费、数据发送边界及不可用时策略，再决定是否作为自动模式候选 |

原生 contract 见 [virtual models](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/virtual-models.md)。项目责任位置：[connection transport](../packages/server-core/src/domain/connection-setup-logic.ts)、[模型解析](../packages/pi-agent-server/src/model-resolution.ts)、[运行时与凭据注入](../packages/pi-agent-server/src/index.ts)、[durable model 包装](../packages/pi-agent-server/src/durable-model-stream.ts)。

**迁移入口**：先做同一连接内的确定性 virtual model 路由，将选择与物理执行分别落账；通过四类请求和恢复验证后，再加入受管 classifier 及多连接候选。Radius 与自定义 router 分别评测，不能通过换默认模型同时完成两种迁移。

## 后续实施顺序与退出门槛

1. **共同基础**：确定 Source / connection / 账户的唯一身份与生命周期，给原生 classify / route 接入受管辅助请求及审计；先写故障矩阵和 E2E 产物要求。
2. **可等价子集**：完整 AgentSession 的 HTTP MCP；bool / choice classifier；单连接确定性路由。逐项可配置回退，避免一次替换三条链路。
3. **解除硬差异**：处理 SSE 存量；定义 score / 结构化输入协议；完成多连接 Vault / OAuth 与路由 branch 事实。旧实现只有在对应职责被完整覆盖后移除。
4. **模型与连接实测**：使用用户授权的服务和预算，覆盖人工标注质量、阈值、故障、每项延迟、辅助及下游总费用；设定接受标准后再跑，当前数据不填补未知项。
5. **默认切换与移除**：全部契约、故障、分发验收及收益门槛通过，再迁移默认和配置；保留历史与未知执行状态，验证回退不会重发已完成副作用。

这是一份替换条件评估；本轮只实施 SDK 升级、验证和文档更新，没有切换这三条默认执行路径。

## 验证与证据

| 检查 | 结果 / 产物 |
|---|---|
| npm 版本、Git 提交与锁文件 | 通过；`.cache/capability-integration/pi-1.0.2-registry.json`、`pi-1.0.2-contract-audit.json`、安装与冻结安装日志 |
| 补丁与原生原语工作流 | **5/5**；`pi-1.0.2-upgrade.json`，4 次真实回环请求、0 付费；采样 / MCP 配置 / Clef / 直接 virtual runtime，未覆盖完整宿主路由 |
| 全仓库 CI | 通过；`validate-pi-1.0.2.log`，typecheck、lint、i18n、identity、version、运行时 pin 与现有专项测试 |
| 全仓库 tests | 串行执行通过；`workspace-tests-pi-1.0.2.log`，保持原测试时限 |
| Electron / WebUI / Viewer 构建 | 通过；对应 `*-pi-1.0.2.log`；首屏初始 JS 4,267,991 B，4,800,000 B gate 未提高 |
| SDK / 原生 MCP / 决策 / 编辑器 | SDK 8/8、HTTP MCP 5/5、决策 46/46、Markdown 5/5、图像 5/5；13-stage 总计 **12/13**，未通过项为首屏导航预算 |
| Windows 当前产物 | 解包 8/8、隔离启动 5/5、随包 Bun 的仓库外 SDK 工作流 8/8；三个位置的 bundle / worker / WASM SHA-256 一致 |
| 前轮整合的未闭合项 | 完整基线首次导航 3,119.07 ms，后一次 2,527.57 ms；smoke 首次 3,570.14 ms，均保留 3,000 ms 门限并记失败。其余六类性能预算与交互通过；不据此宣称原整合计划已全部验收 |

复核命令：`bun install --frozen-lockfile`、`bun run scripts/verification/pi-1.0.2-upgrade-workflow.ts`、`bun run verify:capabilities`、`bun run validate:ci`、`bun run test`。完整整合与外部发布边界见 [2026-10-04 完整性复核](process/capability-completion-2026-10-04.md)。

可版本控制的升级证据：[pi-sdk-1.0.2-upgrade.json](verification/results/pi-sdk-1.0.2-upgrade.json)。SDK 升级的类型、业务工作流、构建及本机分发验证已通过；此前扩展性能门限仍为单独未闭合项，没有把汇总失败改成通过。未提交、推送、签名或发布。

## 回退

需要回退 SDK 时，四个 manifest 的 Pi 引用整体回到先前 1.0.0，同步对应锁文件变更，并重新构建全部消费 SDK 的主进程、子进程及资源；再次验证冻结安装、工作流与资源哈希。保持当前 Source / Decision / 手动连接入口，保留用户历史、revision、lease、T1/T2 与未知执行事实。不能只换一个包，或把旧 bundle 与新 worker / WASM 混装。
