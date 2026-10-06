# 上游 0.14.0 吸纳评估与实施建议

评估日期：2026-10-03（Asia/Shanghai）。本仓基线：Phaneris **0.2.4 / `4613e04b`**；上游目标：**v0.14.0 / `73bd9c2a`**。

本报告保存批准实施前的评估快照；批准后的实际改动与验收结果见[首批吸纳记录](./upstream-0.14.0-absorption.md)。

随后结合 Pi 1.0.0 与依赖升级的整体能力采用及复核见[采用指南](../architecture/capability-adoption-2026-10.md)与[闭合记录](./capability-completion-2026-10-04.md)；本文建议保留其原始评估时点。

## 1. 结论

**建议吸收 0.14.0 的有效内容，继续按功能适配移植。首批做权限边界与会话可靠性修复；决策层扩展随后接线，Guarded、自适应思考、中流语义分流后置。**

这次升级对我们有实质价值：Explore 的只读判定、Pi 激活 source 后的权限处理、“始终允许”、会话写盘和任务完成订阅都存在可定位的缺口。另一方面，我们已经有决策客户端、设置卡片、`decide` 工具及 Pi 大结果前置处理，不能把这些作为全新能力重复移植。

直接合并预演得到 **184 个冲突文件**；只重放 `0.13.6→0.14.0` 增量的预演也有 **66 个**。因此，`git merge upstream/main` 和整版 cherry-pick 都不是合适的实施路径。

本次已完成源码评估、合并预演、隔离探针和文件分类；**产品源码未改动，未创建合并提交，未提交或推送**。新增交付物只有本报告、[206 文件分类表](./upstream-0.14.0-file-classification.csv)和[机器可复核证据](../verification/results/upstream-0.14.0-assessment.json)。

## 2. 基线与改动规模

### 2.1 基线

| 项目 | 核实结果 |
| --- | --- |
| 本地 `main` | `4613e04b2ab5e79477000ce0a457ab54a369325b`，Phaneris 0.2.4 |
| `origin/main` | `15dafd3373f01393c6f5b2e4294e8755bed8042f`；本地领先 1 个提交 |
| 本地最新提交 | `chore(pi): upgrade SDK to 1.0.0`；本轮评估包含该提交 |
| 上次吸纳目标 | `v0.13.6 / 3eac37be5eeee00d312239f21ce3b7c7db92502b`，已按功能移植 |
| 本次上游目标 | `v0.14.0 / 73bd9c2a3573158bea880984eb8d5fdb41e0cac2`；fetch 时与 `upstream/main` 一致 |
| Git 共同祖先 | `v0.13.3 / e8963854c3679edcceb105a42537a06749e6cb64` |
| Git 分叉数量 | 本仓 393 个独有提交，上游 4 个独有提交；不是“本仓尚未吸收四版” |
| 工作区原有未跟踪文件 | `docs/Phaneris_Project_Deep_Analysis.md`、`docs/unreal-agent-design-analysis.md`；均未触碰 |

上游每版发布压成一个提交；本仓对 0.13.4/0.13.5/0.13.6 的吸纳没有改变共同祖先。这也是“此前已经移植过”与“Git 仍然尝试合并旧改动”同时成立的原因。历史依据见[上次吸纳记录](./upstream-0.13.5-0.13.6-absorption.md)。

### 2.2 本次增量

| 指标 | 数值与口径 |
| --- | --- |
| `0.13.6→0.14.0` | 206 文件，新增 10,176 行、删除 19,438 行 |
| 文件状态 | 61 新增、144 修改、1 删除 |
| 删除的编译产物 | `bridge-mcp-server/index.js` 单文件占 18,276 删行 |
| 排除该编译产物后 | 205 文件，新增 10,176 行、删除 1,162 行；仍包括测试、文档和 manifests |
| 本仓与 0.13.6 同 blob | 27 文件；这表示字节一致，不代表可不经适配覆盖 |
| 本仓已分化 | 108 文件 |
| 本仓无同名文件 | 71 文件：61 个上游新文件，10 个本仓已删或改名的旧文件 |
| 本仓与 0.14.0 同 blob | 0 个；语义等价仍需逐项核对 |

合并模拟只生成 Git 对象，不修改工作树、索引或分支。66 个冲突使用 `0.13.6` 作为**虚拟合并基线**，用于估算重放该版本增量的冲突；它不表示真实共同祖先已更新，也不表示可以忽略其余语义风险。

冲突数还包含版本声明、翻译、被删的 Claude 文件等，不应直接换算成人工代码修改量。逐文件冲突名单保存在 JSON 的 `simulation.full/delta.conflict_files`。

## 3. 必须保留的本仓边界

| 边界 | 对本次吸纳的影响 |
| --- | --- |
| **Pi 是唯一 agent 后端** | 不恢复 Claude 后端；共同协议可以移植，Claude SDK 事件处理不可直接套到 Pi |
| **Pi SDK 已是 1.0.0** | 上游 0.14.0 仍依赖 0.87.1；保留本仓 manifests、lockfile 和兼容接入 |
| **Runtime Host / Durable Runtime 是持久化权威** | 保留持久化工具身份、输入接收、恢复、usage ledger、上下文 handoff；禁止整文件替换 `SessionManager.ts`/`pi-agent.ts` |
| **Phaneris 身份与配置根** | 保留 `@phaneris/*`、`PHANERIS_CONFIG_DIR`、生成的 identity、独立应用目录和自有服务配置 |
| **独立版本线和发布流程** | 保留 0.2.x；上游 0.14.0 发布说明用于出处，本产品变更写入自己的 `next.md` |
| **本仓 UI、任务和权限定制** | 保留既有布局、TaskRunner 默认权限、预算和管理员权限 broker；新增字段与消费者同批接入 |
| **既有测试隔离方式** | 使用 `mock.module` 的测试保持 `.isolated.ts` 和独立进程；同名改动映射到现有文件 |

例如，上游 `source-test.test.ts` 对应本仓 `source-test.isolated.ts`；上游 `prompts/__tests__/system.test.ts` 对应本仓 `system.isolated.ts`；`craft-cli.md` 对应本仓 `phaneris-cli.md`。三者都不是“缺失待新增”。

## 4. 权限与可靠性：建议优先吸纳

“探针”表示本次实际运行现有代码路径；“源码确认”表示分支或调用链已定位，尚未执行完整应用场景。

| 编号 | 上游改动 | 本仓证据 / 差异 | 建议 |
| --- | --- | --- | --- |
| P01 | Explore MCP 名称按独立动作词判断，拒绝写动词 | `mode-manager.ts:1751` 对完整工具名做 regex；探针把 `delete_account`、`send_thread_reply`、`update_spreadsheet` 及 source 名含 `get` 的写工具全放行 | **B1 优先适配** `mcp-tool-names`、默认权限词与模式判断；保留显式自定义规则语义 |
| P02 | Explore 补 `gh api`、sed、sort 参数检查 | `bash-validator.ts` 与 0.13.6 同 blob；5 个带写参数的探针均被放行 | **B1 优先移植** argv 检查。必须在代码中拦截，单改默认 regex 无法收紧存量安装的追加式规则 |
| P03 | Ask 读取 MCP 不再提示 | `pre-tool-use.ts` 调 `evaluateMcpToolPolicy` 未传 `permissionsContext`；`list_items` 在 safe 放行、ask 提示 | **B1 移植**同一套读取规则和上下文传递；与 P01 同批 |
| P04 | “始终允许”保存限定范围的授权 | Pi `respondToPermission(..., _alwaysAllow)` 忽略该值；探针证实本次允许、下次仍问。旧白名单首词判断还有条件性越界 | **B1 整链移植** key→prompt→pending→remember→UI `canRemember`；同时修正上游大小写问题，见 §6.1 |
| P05 | `spawn_session` 不得提升子会话权限 | `SessionManager.ts:5095` 直接使用 `request.permissionMode ?? managed.permissionMode`；源码确认缺少上限 | **B1 移植父模式钳制**，先适配现有三模式，独立于 Guarded |
| P06 | source 激活后重新检查仍须处理 prompt | Pi 的 post-check 只分 `modify/block/else`；真实方法探针将 `prompt` 发成 `allow`，未触发批准回调 | **B1 优先重排状态机**，激活后进入统一结果分支；保留持久化代理工具身份 |
| P07 | 没有权限应答回调时拒绝操作 | Pi 的 `!onPermissionRequest` 分支直接允许；真实方法探针得到 `allow` | **B1 改为拒绝**。这验证无回调契约，不等于所有 CLI/自动化当前都静默放行；还需验收实际无人值守上下文 |
| R01 | 快速连续发送不重复重写 session | `storage.ts:792` 仅检查 session 存在；无 pending plan 的调用仍重写文件，mtime 探针确认 | **B2 小范围修复**为无 pending plan 即返回；不绕过本仓持久化队列 |
| R02 | 完成监听者重订阅不会吃同一次事件 | `SessionManager.ts:7851` 迭代 live Set；探针中新 listener 当次被调用 | **B2 移植订阅快照**。这是 release notes 未单列的任务裁决重入修复，可独立于决策模型 |
| R03 | 自动化不能触发自身，链条有上限 | 本仓 `triggeredBy` 不存 matcher id/depth；`onPromptsReady` 未做来源防循环 | **B2 移植**来源 id、旧记录按名称回退、3 层链上限及 skipped 历史；不依赖模型 |
| R04 | `source_test` 不把丢失凭据的 source 标为连接成功 | 本仓 token 缺失即回退无认证探测；源码确认未尝试 refresh | **B2 移植**先刷新、仍无凭据则报认证失败；保留我们已修正的多 header 装配 |
| R05 | source 激活重试不重复显示，保留中途纠正 | 本仓已具备空捕获回退及重试去重；仍按普通用户消息重发，未保存本轮 steers | **B2 适配新补充**：hidden 重试、纠正重放、思考档位保持；不重做已有空消息修复 |
| R06 | 后台任务只唤醒确由本会话启动的任务 | 本仓 completion nudge 路径仍接受较宽的事件；Pi 原始事件与 Claude SDK 不同 | **B2 适配宿主归属判断**和未知开始时间；无需恢复 Claude 事件适配 |
| R07 | RTK 安全版本、绕过命令和排除表 | detector/rewrite 与上游旧版同 blob；仍以 0.23.0 为门槛，Pi 构造 `exclude: []` | **B2 移植**0.44.0 下限、outdated 状态、`command`/`builtin` 绕过和配置排除表；按服务器平台提供更新命令 |
| R08 | label id 生成不会截断出末尾连字符 | 本仓 `labels/crud.ts` 与旧版同 blob；先 trim 后 substring 可生成非法 id | **B2 移植**重音归一化与截断后 trim；不重命名已有标签 |
| C01 | 删除无用 MCP bundles 与 bridge 契约 | 本仓已无 session-mcp-server，但仍跟踪 18,276 行 bridge bundle，并在 Electron/server 打包中引用；有残留 no-op 契约 | **B3 适配清理**；删除按协作约定执行。保留现有 Pi ESM bundle + thin launcher |

本仓入口：[权限类](../../packages/shared/src/agent/core/permission-manager.ts)、[pre-tool-use](../../packages/shared/src/agent/core/pre-tool-use.ts)、[Pi 宿主](../../packages/shared/src/agent/pi-agent.ts)、[会话管理](../../packages/server-core/src/sessions/SessionManager.ts)、[会话存储](../../packages/shared/src/sessions/storage.ts)、[source 测试](../../packages/session-tools-core/src/handlers/source-test.ts)。行号基于本次冻结基线。

## 5. 决策层：已有基础，缺的是产品接线

当前本仓已实现客户端/鉴权、服务探测、日志、设置 RPC、设置卡片和 `decide`。已有三个 feature 开关：`decideTool`、`taskVerdicts`、`semanticLabels`；但当前 `server-core/decisions` 只有 `tool-callbacks`，后两个开关尚未完整接入 TaskRunner/语义标签消费方。

上游此次扩展到 **13 个 feature 开关**。主开关仍默认关闭；原有三个开关默认 true，新十个默认 false。吸纳时应保留这些显式开关，不把依赖升级当作启用授权。

| 开关 / 能力 | 本仓现状 | 适配价值与建议批次 |
| --- | --- | --- |
| `decideTool` | 已实现 | 保留；同步日志和取消类型，B3 |
| `taskVerdicts` | 有开关，缺完整裁决接线 | 无 `VERDICT:` 时辅助解析，不覆盖显式 PASS/FAIL；记录推断来源和置信度，B4 |
| `semanticLabels` | 有开关，当前自动标签仍走 regex | 接通 semantic 问题/阈值/固定值，保留 regex 和值模板，B4 |
| `turnOutcome` | 未实现 | 区分完成、待输入、受阻；会话移 Needs Review，子任务不能误记完成，B4 |
| `taskRepairs` | 未实现 | FAIL 未点名时缩小返工范围，保留依赖闭包、预算和后续全 DAG 回退，B4 |
| `automationConditions` | 未实现 | 条件不满足时跳过并记历史；不可用时仍运行，适合优化，不宜承担强制门禁，B4 |
| `smartTitles` | 普通标题生成已实现 | 闲聊延后命名、话题漂移后刷新、保护手动标题；B4 |
| `riskBadges` | 未实现 | 只解释权限影响；不得代替管理员批准或实际权限检查，B4 |
| `largeResults` | 已有 Pi 前置落盘/摘要，缺可选 gate | 按结果开头决定是否省摘要；增加主进程↔Pi 子进程协议，失败回原摘要路径，B4 |
| `suggestions` | 未实现 | 提示合适 skill/source，最多提示候选，不擅自读取或启用；结合本仓插件/能力发现适配，B4 |
| `guardedMode` | 现有三模式 | 行为和失效策略需产品决定；不能与 B1 的确定性权限修复捆绑，B5 |
| `adaptiveThinking` | 固定会话思考档位 | 只降低单轮档位、结束恢复；质量优先的默认下暂不启用，B5 |
| `midTurnMessages` | 已有 steer/queue、压缩保护和 handoff 排队 | 新增语义分类及消息合并；需适配附件、输入确认、SDK disposition 和 handoff，B5 |

B3 还应吸收公共 `decision-point`、`outcome/followup` 记录、`decisions:report` 使用统计、`cancelled` 与 `timeout` 的区分，以及测试默认日志落临时目录。这些让后续开关效果可观察，不能只靠功能存在来判断价值。

此次另有 **七个决策 RPC 从 local-only 改为 remote-eligible**：设置、状态、密钥、test、probe 应作用于会话所在服务器。本仓仍把这些 channel 放在 local-only；B4 接入远程功能时须核验服务器鉴权、密钥归属和状态刷新，不能仅改列表。

日志只保存输入 hash 不等于输入不离开本机。标题、任务判断、权限风险、建议等会发送所需的消息/命令/结果片段给已选决策 provider；设置说明应表达实际发送范围，保留本地 Laya 路径。

源码依据：[上游开关与默认值](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/shared/src/decisions/settings.ts)、[公共 decision point](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/server-core/src/decisions/decision-point.ts)、[远程路由](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/shared/src/protocol/routing.ts)。

### 5.1 发布说明中不能直接算作本仓收益的项目

| 发布项 | 源码核对结果 |
| --- | --- |
| Claude Stop 不再重发原消息 | 修复位于已删除的 Claude keep-alive 路径；不适用 |
| Claude 思考档位在会话中即时生效 | 修复是 Claude live query 更新；本仓 Pi已有自己的 `set_thinking_level`，新增单轮 override 另行接入 |
| 长工具 heartbeat 不反复生成 Running 行 | 主要改 Claude `tool_progress`/keep-alive；Pi 走 `tool_execution_update`，不移植 Claude 事件 |
| plan/sign-in 不被记录为 declined | 关键 handoff drain 改在 Claude；Pi 的 plan/auth callback 结构并未在此版获得同等重写。不能仅凭发布说明宣布本仓已修复，须覆盖真实 Pi 工具结果/中断顺序 |
| MCP/session 大结果在模型读取前摘要 | Claude hook 修复；本仓 Pi 子进程和 MCP pool 已做前置处理，本次有价值的是可选摘要 gate |
| 无幽灵后台完成提示 | Claude 结构化归属修复不适用；通用宿主归属/唤醒判断仍值得按 Pi 适配 |
| CLI automation 编辑保留 condition/Telegram topic | OSS 本次没有提供对应命令模块的修改，`apps/cli` 只新增无人值守标识；不能据发布说明杜撰可移植 patch。相关本仓 RPC 字段随 semanticCondition 一并检查 |

官方发布说明用于覆盖核对，实际适用性以源码及本仓调用链为准：[v0.14.0 发布](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.14.0)。

## 6. 上游本身需要修正或明确的行为

### 6.1 精确授权键仍被存储层转小写

上游 `getBashRememberKey()` 用 JSON argv 生成精确键，但 `PermissionManager.whitelistCommand/isCommandWhitelisted` 统一调用 `toLowerCase()`。实测：

| 调用 | 生成键 |
| --- | --- |
| `python Safe.py` | `exact:["python","Safe.py"]` |
| `python safe.py` | `exact:["python","safe.py"]` |

生成键不同，放入真实白名单后仍互相匹配。POSIX 文件名区分大小写；即使在 Windows，命令参数及代码字符串也可能区分大小写。

**P04 采纳时必须同时修正**：精确 argv 保留原字节；文件目录按实际平台处理；域名单独做大小写归一化。不得把新键接入旧的无差别 lower-case 存储。该结果保存在 JSON 的 `upstream_probes`。

源码：[上游键生成](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/shared/src/agent/core/permission-remember.ts)、[上游白名单存储](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/shared/src/agent/core/permission-manager.ts)。

### 6.2 Guarded 的故障策略要按代码理解

| 情形 | 上游行为 |
| --- | --- |
| 决策主开关/Guarded 开关关闭，resolver 不可用 | permission pipeline 将 Guarded 解释为 Ask |
| 功能开启，但单次调用超时、无答案或 check 抛错 | `applyGuardedModeCheck` 返回原 allow/modify，继续执行 |
| Guarded 下直接写工作目录及 plans/data 之外 | 确定性要求批准，不经过模型 |
| 自动化、任务、hidden/mini、unattended 会话 | 风险 check 不活跃；全局 feature 开启时，不会因此自动获得 Ask 级逐项批准 |

所以不能把 Guarded 描述成“模型不可达就始终退回 Ask”。它是在 Execute 行为上增加风险提示，单次缺失答案可继续执行。若希望满足“不可逆动作必须先批准”的强约束，应先建立确定性分类和失败时的批准策略，再决定如何接入概率提示。

源码：[effective mode](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/shared/src/agent/mode-manager.ts)、[shared Guarded check](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/shared/src/agent/core/guarded-mode.ts)、[host Guarded check](https://github.com/craft-ai-agents/craft-agents-oss/blob/v0.14.0/packages/server-core/src/decisions/guarded-mode.ts)。这是源码确认，未在本仓启用或运行 Guarded。

### 6.3 打包与 Windows

- 上游 RTK 更新命令是 `curl ... | sh`，不适合直接在 Windows 提示；应按 **RTK 实际运行服务器** 的平台提供操作方式。
- 上游 Docker build 示例仍采用单文件 CJS，Pi package 自身则用 Bun ESM。保留本仓已经验证的 ESM bundle + thin launcher，不能被清理 bridge 时顺手替换。
- 新增 `craft:rtk-update-dismissed` localStorage 键、`craft-decisions-test-*` 临时文件前缀、`@craft-agent/*` 导入都需适配为本仓身份。
- 新增功能开关的文案、可用模式、快捷键和远程状态是一组依赖；部分接入时不得显示尚无消费方的开关。

## 7. 实施方式与批次

| 方式 | 评估 |
| --- | --- |
| 直接 merge 上游 main/tag | 184 个冲突，叠加已吸收旧改动及主动删除的代码；不推荐 |
| 整版 cherry-pick / 应用完整 0.14.0 patch | 仅增量也有 66 个冲突，新增 Claude 测试/模式/依赖声明仍需筛选；不推荐 |
| 固定两个上游 SHA，按功能移植并记录判定 | **推荐**；与我们此前吸纳方式一致，能保留本地架构和有意差异 |

建议后续实施从本地 `4613e04b` 创建 `codex/upstream-0.14.0-absorption`，在隔离工作树中单任务推进。先保留现有 Pi 升级提交和用户文档，不 reset、stash 或重写它们。

| 批次 | 内容 | 独立交付 / 依赖 | 规模判断 |
| --- | --- | --- | --- |
| **B0 基线** | 固定版本、引用、依赖和旧移植清单；列出当前残留基线 | 本次已完成评估；实施时建隔离分支 | 小 |
| **B1 权限** | P01–P07，连同 canRemember 跨层字段；修正精确键大小写 | 可不接入任何决策模型；暂保留三模式 | 中等，影响面集中但契约要求高 |
| **B2 可靠性** | R01–R08：写盘、订阅快照、防循环、凭据、重试、后台归属、RTK、label id | 与 B1 同一首批 release 可行；逐功能验收 | 中等，多个小修复加会话状态适配 |
| **B3 基础与清理** | 决策取消/日志/可观测性；删除 legacy bundle/bridge 引用 | 支撑后续决策特性；删除前按协作约定展示摘要并确认 | 小到中等 |
| **B4 决策接线** | task/label/automation、标题、风险标记、摘要 gate、建议、远程 RPC | 依赖 B1/B2/B3 的稳定边界；每个功能可独立启用 | 较大 |
| **B5 行为模式** | Guarded、自适应思考、中流语义分类/消息合并 | 明确产品策略后实施，增加取消/附件/handoff/无人值守验收 | 较大，不列入首批 |

规模是按涉及状态机和跨层契约作出的工程判断，未给出未经验证的工时。`SessionManager.ts` 上游本次 +828/−177 行，承载多个批次；应拆功能修改而非整文件覆盖。

首批范围建议为 **B1+B2，附必要的 B3 基础与打包清理**。不要为了“版本同步”提前启用 B5。后续继续在吸纳记录中保存上游 SHA，下一版按该 SHA 生成增量清单。

## 8. 本次实测与证据限制

### 8.1 探针失败矩阵与结果

以下失败方式在探针执行前已列出。检查只向现有权限函数传入字符串，或驱动真实类方法与隔离回调，不执行示例中的命令、不调用模型、不使用用户配置目录。

| 失败方式 | 实际结果 | 证据范围 |
| --- | --- | --- |
| Explore 把带写入参数的命令放行 | 5/5 写参数样例被放行；4 个正常控制样例符合预期 | 真实 mode/AST pipeline，使用本仓 bundled 默认权限 |
| MCP 名称子串被误认成读取 | 4/4 写工具被放行；`list_items` 正常放行 | 真实配置合并和 mode 判断 |
| Ask 对 Explore 已允许的 MCP 读取仍提示 | `list_items` 被识别为 mcp_mutation | 真实 `shouldPromptInAskMode` |
| Pi 忽略“始终允许” | 本次允许，下次仍需提示 | 真实 `respondToPermission`；pending callback 隔离 |
| 激活 source 后 prompt 变 allow | 输出 `allow`，批准回调 0 次 | 真实 `handlePreToolUseRequest`；source 和协议发送回调隔离 |
| 无权限应答回调时默认 allow | 输出 `allow` | 同一真实方法，无 onPermissionRequest |
| 完成监听者重订阅收到同一次事件 | 新 listener 当次调用 1 次，期望 0 次 | 真实 `emitSessionComplete`，隔离 listener Set |
| 无 pending plan 仍重写会话 | 临时 session 文件 mtime 改变 | 真实 session create/clear/保存路径 |
| 旧首词白名单允许其他变更/复合命令 | 手动预置 `git` 后，3 个样例均不提示 | **条件性探针**；当前 Pi 不会自动填充此白名单，不能称为现行 Always Allow 可利用路径 |
| 上游精确 argv 被大小写折叠 | 两个不同键在 store 中互相匹配 | 上游真实键生成源码，redirect import 到隔离 fixture；本仓和上游存储的归一化逻辑一致 |

本仓探针共 **23 个案例**：5 个符合期望，15 个实际路径不符，3 个为预置旧白名单后的条件性不符；不是“18 个独立安全漏洞”。另有 1 个上游精确键探针。逐条输入、期望、结果和脚本来源保存在 JSON。

本次没有执行 GUI E2E、真实 provider、OAuth/模型迁移或完整 source 激活网络链；因此未宣称所有线上场景已复现，也未宣称拟议移植已通过验收。

### 8.2 仓库检查

| 检查 | 本次结果 |
| --- | --- |
| SSH fetch origin/upstream、发布 tag 校验 | 成功；目标与 tag 一致 |
| 两种 `git merge-tree` | 均 exit 1，原因是冲突；184/66 文件名单已保存 |
| 隔离探针 | 脚本 exit 0，记录上述不符行为；exit 0 表示评估完成，**不表示产品行为正确** |
| `bun run version:check` | exit 0，0.2.4、27 处声明、13 workspace packages |
| `bun run identity:check --json` | exit 0，生成身份漂移 0；仍报告 **145 个未豁免残留** |
| 全量 validate / build / 打包客户端 E2E | 本轮未重跑，因为未修改产品源码；不能据此宣布移植验证通过 |

`identity:check` 默认模式不是 strict，成功退出不能解释成品牌残留为零。实施时以现有残留为基线，避免引入新的 upstream scope、配置变量或服务地址；本次不扩大为品牌清理项目。

### 8.3 后续实施验收

| 验收场景 | 必须留下的可复核产物 |
| --- | --- |
| 权限模式：读操作允许，写参数阻止；Always Allow 不跨 argv/目录/host 扩张；子会话不升权 | RPC/工具响应记录及 UI 结果；危险命令只作输入或在隔离沙盒替身中验证 |
| source 激活 + 写操作批准；无人应答不能当成同意 | 按序记录 activation、prompt、answer、tool result；含否定路径 |
| 快速连续发送、手动 compact、source 重试、附件、中途纠正、handoff | 会话 JSONL 与 Durable Runtime 输入记录：不重复、不丢消息、接收状态与持久化一致 |
| 自动化自身和 A→B→A 循环、凭据缺失/刷新失败 | automation history、skipped 原因、链深；source_test 结果与运行请求一致 |
| 决策开/关、超时/低置信、Stop、远程 workspace、手动标题保护 | decisions hash/outcome/followup、run log、界面状态；关闭时走既有路径 |
| Win 打包与 bridge 清理、Pi 1.0.0 启动 | 复用打包客户端 verification/smoke 脚本产物，核实资源和真实对话 |

各批次完成后运行适用 E2E 和既有回归；合并前运行 `bun run validate:ci`、相关 build/smoke 与打包客户端校验。保留 pre-push 全套门禁，不使用 `--no-verify`。不在产品代码写完后补写镜像实现的单测。

## 9. 复现与文件清单

```powershell
# 两个远端均使用工作区已配置的 SSH 443；目标 tag 独立命名，避免混入本产品版本线。
git fetch --no-tags upstream 'refs/tags/v0.14.0:refs/tags/upstream-v0.14.0'
git diff --shortstat 3eac37be 73bd9c2a
git diff 3eac37be 73bd9c2a -- packages/shared/src/agent/core/pre-tool-use.ts

# 固定本次基线；不会修改工作树或索引，存在冲突时 exit 1 是预期。
git merge-tree --write-tree --name-only --no-messages 4613e04b 73bd9c2a
git merge-tree --write-tree --name-only --no-messages --merge-base=3eac37be 4613e04b 73bd9c2a
```

- [文件分类 CSV](./upstream-0.14.0-file-classification.csv)：206 行，含状态、blob 关系、增删行、增量冲突、功能归类、建议批次和本仓对应路径。
- [证据 JSON](../verification/results/upstream-0.14.0-assessment.json)：冻结 SHA、两个合并预演的完整名单、23+1 探针结果、验证结果和复现脚本。
- 本地探针为 `.git/upstream-0140-audit/probes.ts` 与 `upstream-key-probe.ts`；复现所需源码及上游 import 重定向说明均嵌入 JSON 的 `reproduction`，不依赖忽略目录长期存在。

CSV 中状态、blob、行数、冲突是自动计算事实；功能建议是文件级评估。混合文件的每个 hunk 仍须依照本报告拆批，不能把一个 batch 标签理解为可整文件覆盖。
