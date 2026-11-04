# 常驻助手 0.6.x 实施记录

Status: accepted — 2026-11-03 用户明确要求新建分支并开始实施。

分支：`codex/resident-assistant-0.6`。起点：`0d2db85f6f5156db6a530c91bbdc9cb6de95d22c`，包版本仍为 0.5.6；未准备或发布 0.6.0。

依据：[架构与版本路线](../architecture/resident-assistant-0.6-roadmap-2026-11-03.md)、[先行失败矩阵](../verification/resident-assistant-failure-matrix-2026-11-03.md)。用户已授权按路线实施，后续工作不需要重复取得整体实施许可。

## 当前进度

| 工作包 | 状态 | 范围 |
| --- | --- | --- |
| P1：workspace 记忆 Host 底座 | 已实现，本机验证通过 | 持久条目/修订、来源定位、状态退出、抑制重新提取、RPC/客户端契约 |
| P2a：助手身份、角色与记忆工具 | 已实现，本机验证通过 | 特殊 Session 单例、独立 prompt、工具边界、真实 Pi 记忆读取 |
| P2b：执行配置 | 基础与版本追踪已实现，最终回归见末节 | 配置目录版本、登记 preset、请求/解析/接受权限与能力版本、排队及在途变更屏障 |
| P3a / P3c：普通 Session 委派、回执与执行尝试 | 已实现，最终回归见末节 | 新建/续用普通 Session；内容归 Session，回执只留投递引用；原 Runtime 尝试的只读精确投影 |
| P3b：事件交付与恢复闭环 | 基础闭环已实现，本机验证通过 | 引用事件日志、轮次 ACK、原 Runtime 自动唤醒、原请求指针、已知交付核对；未知副作用保持恢复屏障 |
| P4：历史、记忆治理与主上下文 | P4a–P4i 已按包实现，最终回归见末节 | 增量目录/提取、有效时间、显式争议与替代、退出标记合并、多议题工作集、实际模型清单与退出、有界导航与当前项目召回；自动语义治理和长期规模质量仍需后续验收 |
| P5：独立品牌入口与共享对话页 | 按用户新确认收敛，本机验证通过 | 原 Logo/菜单保留；顶部居中独立助手品牌；复用原 ChatPage 与导航；管理对话框，无助手侧栏 |

这些是 0.6.0 内部实施顺序。当前基础链路已贯通，但版本仍为 0.5.6，未提交或发布；本机回环和隔离 Electron 验证不等于真实模型长期质量、发行包或远端托管验收。下文按时间记录旧工作包边界，当前状态以此表及末节为准。

## P1 实现

- 在 workspace 的 `memory/memory.db` 保存条目、历史修订、请求回执、来源抑制标记与单调版本；使用现有 Bun/Node SQLite 驱动，WAL 与完整同步。
- 来源指向当前 workspace 的真实 Session/message，并带内容哈希。明确用户陈述与推断分开；助手回答、hidden 消息及旧投递前缀不能直接作为用户陈述，推断默认进入 candidate。
- 支持显式记住、修订、active/dormant/expired/invalidated/forgotten；修订使用 expectedRevision 防止覆盖，重复请求按规范化 payload 指纹去重。
- 默认查询只返回有效且未被抑制的 active 内容。支持中文短词字面匹配、项目过滤、有界分页；写入或跨有效期后旧游标失效。
- 遗忘同时抑制当前与旧修订的来源；再次使用同一来源提取会被拒绝，正常来源回看也被拦截。查询/重放只返回当前视图，遗忘内容、语义 key 与来源被隐藏。
- 三个方法 `assistantMemory:query / mutate / readSource` 和一个不含正文的变更事件走现有远程路由。握手/窗口所接受的 workspace 必须匹配目标，来源和库都不接受客户端指定磁盘路径。
- 接通核心 Host 注册、Electron/WebUI 共用 channel map 和类型接口，更新 IPC 兼容 fixture 与 RPC 清单。未新增原生依赖或改动普通 Session 写入。

## 验证与证据

先写失败矩阵和 E2E，再写实现。[实现前红灯](../verification/results/resident-assistant-memory-red-2026-11-03/manifest.json)证明目标模块当时不存在。[复核红灯](../verification/results/resident-assistant-memory-review-red-2026-11-03/manifest.json)记录跨有效期分页未拒绝的问题，已修复。

[最终 E2E manifest](../verification/results/resident-assistant-memory-reviewed-2026-11-03/manifest.json)与[结果证据](../verification/results/resident-assistant-memory-reviewed-2026-11-03/memory-evidence.json)记录 16 个场景通过。链路使用真实 WebSocket、两个隔离工作区、真实 JSONL、SQLite 及 Host 重启；结果保留输入、数据库、源代码身份与文件哈希。未使用用户真实历史或付费模型。

可重复运行，输出目录必须不存在：

```sh
bun run verify:assistant-memory --output-dir=.cache/verification/assistant-memory-new-run
bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/assistant-memory-new-run
```

已运行 `typecheck:all`、完整 `lint`；文档检查和协议兼容检查纳入本包收尾。未运行签名打包、付费模型质量对照或完整发行验证。

## P1 边界与后续接入要求

- P1 只有显式记忆操作和精确来源回看；P2a 已接通助手的模型记忆查询工具。自动历史摄取、语义召回和按议题注入仍未实现，不能把当前底座宣传为完整长期助手已可用。
- 遗忘抑制目前以整条来源消息为粒度；同消息派生的其他条目也会被隐藏。细分断言/范围的 lineage 需在自动提取接入前完善，避免把保守抑制误称为精确语义遗忘。
- 遗忘不删除原始 Session、数据库历史修订或既有外部副本；本包不提供自动恢复 forgotten 的入口。显式恢复、修订审阅 UI、备份合并退出标记和存储容量策略后续实现。
- 本包的记忆版本与事件提供后续上下文失效信号，尚未接入主助手/Worker 的 provider 上下文。实际请求移除与在途结果处理属于 P4 验收，不能仅靠数据库测试宣称已经做到。
- 来源角色和旧消息前缀是当前保守判定，并非完整的作者鉴定；P3/P4 接入投递事实后再补来源适配。内容哈希提供核对身份，不宣称已经保留每个来源的不可变全文副本。
- 当前为单一 Host 所有的 workspace 数据库。真实远程 TLS、跨 Host 迁移、服务托管和多租户授权没有在本包验收。

原有两个打包结果 JSON 的未提交修改属于既存工作，本包未改动。用户提供的 HTML/PNG 原型保留为布局依据。

## P2a：助手身份、独立角色与只读记忆工具

### 已实现

- 增加持久 `sessionKind=resident_assistant`。`residentAssistant:get` 由 Host 按当前连接的 workspace 取得/创建特殊 Session，并发创建共用同一 Promise；初始会话文件就带角色，重启从现有 Session 存储恢复身份。
- 特殊 Session 保持 hidden，不作为普通任务参与列表/看板；Host 拒绝普通删除、归档和任务状态变更。名字不是角色依据。普通创建忽略伪造 kind，reserved preset 只能由内部入口使用。
- 普通导入保留会话历史，清除助手角色、特殊隐藏状态和源 SDK 身份，不会复制第二位助手。完整 workspace 迁移是后续独立流程。
- 编译独立角色 prompt，不追加整份普通执行者契约。只复用通用恢复/事实契约及现有偏好/项目指令来源，不另造人格。
- 角色工具权限与 permission mode 独立。Host 在前置检查、代理执行、durable prepare 三处强制执行角色边界；Pi 初始目录、动态同步和恢复激活也采用同一纯策略。
- 主助手只暴露问题、Session 元数据、记忆查询/来源读取及必要目录/进度能力。shell、原生文件读写、全局偏好、外发、原文本跨会话投递和通用 codemode 均不可用。普通会话的实际工具目录保持，新记忆工具不自动进入普通会话。
- `assistant_memory_search` 与 `assistant_memory_read` 通过现有 Session 工具回调绑定 workspace；来源读取有范围与继续位置。查询只取有效记忆，遗忘后新检索和旧来源读取都会拒绝；未开放模型写记忆或自动提取。
- 不给主助手开放未经记忆抑制过滤的历史正文入口。P4 接入按来源、议题和有效性管理的历史读取后再完善；当前不能以直接文件读取绕开退出标记。
- 当前主助手采用 compact；在逻辑上下文段尚未实现前，拒绝直接切到会生成其他产品 Session 的 handoff。

纯角色策略作为 Host 与 Pi 共享的显式值接口登记，并加入传递纯度检查。未放宽通用模块边界，也未引入第二个模型循环或独立聊天存储。

### 验证

[身份与角色结果](../verification/results/resident-assistant-identity-final-v2-2026-11-03/identity-evidence.json)、[manifest](../verification/results/resident-assistant-identity-final-v2-2026-11-03/manifest.json)：12 个场景通过。使用生产 bootstrap、SessionManager、真实 RPC、磁盘持久化和 Host 重启；角色执行桥使用受控调用验证拒绝边界，不能单凭该部分声称已经验证实际模型行为。

[真实 Pi 链路结果](../verification/results/resident-assistant-native-first-2026-11-03/native-evidence.json)、[manifest](../verification/results/resident-assistant-native-first-2026-11-03/manifest.json)：另外 7 个场景通过。实际构建并启动 Pi 子进程，通过本机回环推理服务检查模型请求中的目录/prompt、执行记忆查询并提交 Runtime 结果、遗忘后的新查询、动态重建和强行调用 write 的拒绝。模型响应为确定性 fixture，没有付费模型质量结论。

已有 P1 的 [16 个记忆场景回归](../verification/results/resident-assistant-memory-p2-regression-2026-11-03/manifest.json)通过；36 个既有工具绑定/过滤、RPC 字符串和路由测试通过。运行产物由 `server:build:subprocess` 构建，协议现有 433 个通道；类型检查、lint、文档门禁的收尾以本工作树最终检查为准。

新增命令：

```sh
bun run verify:assistant-identity --output-dir=.cache/verification/assistant-identity-new-run
bun run server:build:subprocess
bun run verify:assistant-native --output-dir=.cache/verification/assistant-native-new-run
```

测试 Host 的完整配置/内置帮助文档放在独立缓存目录，审阅目录只收录日志、机器结果、会话快照和 manifest，避免把生成的帮助文档混进项目文档入口。早期红灯与调试运行保留在 `.cache/verification/`，未删除证据。

### 当前仍未完成

- P2b/P3a 已在下节接通；P3b 的事件交付、自动唤醒、原请求决策和完整恢复仍待实施。
- P4：本节验收时普通历史入口尚未实现；后续 P4a 已补按需增量来源目录和检索，见下节最新记录。自动提取、语义与范围治理、实际 provider 历史中的过时材料退出、工作集切换和上下文分段仍待实施。真实 Pi 证据明确记录：遗忘阻止新的查询，不代表旧 tool 内容已从 provider 历史消失。
- P5：品牌入口、默认展开助手前台及对应记忆/上下文/配置视图。当前未将不完整闭环设为默认 UI。
- 单例保证范围为一个权威 Host 的多客户端；不支持两个 Host 同时权威运行同一 workspace。发现多条助手角色记录会报告冲突，不按标题静默选一条。

本包提供真实可调用的助手 Session 与角色/记忆链路，完整 0.6.0 发布门槛仍未完成。

## P2b/P3a：执行配置与持久委派（2026-11-04）

本节记录第一版实现及其验收。随后用户确认普通 Session 收敛方向，当前对象与存储边界以下节为准；第一版的完整 AssistantWork 存储已迁移为投递回执。

### 已实现

- 新增可移植的严格 Worker 配置契约，统一供模型工具和 RPC 使用。支持连接/模型、thinking、权限、Sources、Skills、单一 activePlugin、项目、Host 工作目录、context policy 和标签；不接受未知字段后默默忽略。
- 助手可用 `assistant_worker_options` 分页查询连接、模型能力、资源、Skill、插件和项目。返回明确投影的元数据，排除连接凭据。模型列表没有可验证的 thinking 档位时，显式非 off 请求会拒绝；默认降为 off 会记录原因，不声称已经测量了提供商的真实推理行为。
- 委派前及启动前校验资源、目录、模型与依赖；项目目录、Skill requiredSources、插件 Sources 合并为显式 Worker 配置。接受时固定解析配置和权限上限，启动时验证这些选择；默认值变化不漂移配置，后续权限上调不提升旧任务，权限收紧继续生效。资源依赖变化则明确失败，插件警告和权限调整可查。Worker 仍经过原有执行权限机制；工作目录只是执行位置，不是新增文件系统沙箱。
- 在当前 workspace 的 `assistant/delegations.db` 保存请求、来源消息引用、解析配置、Worker/输入身份、状态、结果摘要与单调变更序号。受 SQLite 事务保护的请求回执用规范化 payload 指纹去重；相同 requestId 改内容冲突。
- Host 创建普通 Worker，在所有配置持久化并核对后通过现有 durable input admission 启动。Skills 随首次输入保存；初始投递有稳定身份。Worker 的 `residentDelegationId` 从初始会话文件持久化，创建与回执关联之间中断时可回找原 Worker。普通导入清除此关系。
- 首期默认串行。排队任务在启动时重新检查资源和权限；一项失败不会永久堵住后续任务。取消和输入接收共用执行串行边界，运行任务等待原执行停止后才放行下一项；准备期间取消不会投递任务，迟到成果不复活已取消任务。
- 成果进入类型化工作记录，`result_ready` 表示等待审阅，不等于用户验收。摘要上限 16000 字符，保留是否截断及实际来源 Session/message；handoff 的逻辑 Worker 与实际成果生产 Session 分开引用。Worker 的历史、文件和证据继续保留，运行资源沿用现有回收机制。
- 助手新增 `assistant_delegate / assistant_work / assistant_cancel_work`；普通会话不暴露这些工具。旧 Session 投递入口禁止向主助手注入消息。Worker 初始输入使用结构化非真人来源，记忆系统不能据此登记 user_stated，避免重复消息变成用户授权或事实。
- 新增三个可远程路由的方法 `residentAssistant:dispatch / work / cancelWork`，复用连接已接受的 workspace 检查，接通共用客户端接口。当前 436 个协议通道、59 个集中输入契约。

### 验证与证据

失败矩阵和 E2E 先于本包生产代码。最终[委派证据](../verification/results/resident-assistant-delegation-final-17-2026-11-04/delegation-evidence.json)及 [manifest](../verification/results/resident-assistant-delegation-final-17-2026-11-04/manifest.json)记录 17 个场景：生产 Host/SessionManager、真实 WebSocket、SQLite/JSONL、编译后的 Pi 子进程和回环模型服务。保留实际请求、Worker 会话、关闭后的委派数据库与 Host 日志。

验证覆盖：助手实际发现配置并调用委派工具、Worker 实际执行并回报；Sources/Skills/插件进入模型请求；权限上限及排队后不自动提权；非法配置；重放/冲突；串行与取消；资源漂移后的失败及队列继续；准备中取消；Host 在执行中退出后的恢复屏障；重启重放不创建第二个 Worker。复核用新增场景先复现了排队任务随助手权限上调的问题，再修正为固定接受时上限。模型响应是确定性 fixture，不作为真实模型质量结论。

既有[记忆 16 场景](../verification/results/resident-assistant-memory-p3-regression-2026-11-04/manifest.json)、[身份/角色 12 场景](../verification/results/resident-assistant-identity-p3-regression-2026-11-04/manifest.json)、[真实 Pi 记忆 7 场景](../verification/results/resident-assistant-native-p3-regression-2026-11-04/manifest.json)回归通过。既有工具目录/回调绑定/IPC 的 28 个测试通过。`typecheck:all`、完整 `lint`、文档门禁和 `git diff --check` 通过；复核修改后补跑 Host/脚本类型、workspace lint 与协议清单，验证产物 manifest 可重验。

```sh
bun run server:build:subprocess
bun run verify:assistant-delegation --output-dir=.cache/verification/assistant-delegation-new-run
bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/assistant-delegation-new-run
```

### 明确边界与接续

- 当前收件入口是带变更序号的最新工作快照，可按 ID 或游标分页查询；不是已经实现了有消费确认的事件日志。成果不会自动作为用户消息送进助手。自动唤醒、轮次消费确认和防止重复对用户交付，需要随 P3b/P4 的主上下文入口接入。
- Host 在 preparing/running/cancel_requested 时退出，重开收件入口后转 needs_attention 并关联原 Worker；不自动重新派发。原 Runtime 保留执行与副作用证据，细化核对、可安全自动续跑、完整执行尝试模型仍待实现。待确认工作会挡住队列，需先检查或取消。
- Worker 的原有权限/ask_user 请求继续属于原 Session；尚未把请求指针转呈到助手前台。当前源用户引用提供可追踪归属，不等于另建了能证明语义授权成立的账本。
- 配置值已解析并与创建结果核对；网络 Source 实际连通、提供商是否遵循推理设置、真实大上下文 handoff 和付费模型质量没有由本次 fixture 全面证明。
- 每个工作意图使用稳定 requestId；Host 处理身份重试，不通过文本相似度推断两个不同 ID 是同一任务。跨 Host 双写同一 workspace 仍不受支持。
- 接下来重点是 P4 的历史增量摄取、记忆范围与退出进入实际 provider 请求、工作集及逻辑上下文换段，并将 P3b 的交付消费接在同一个入口。品牌前台按用户原型在 P5 接入；包版本仍为 0.5.6，尚未达到 0.6.0 发布门槛。

## 普通 Session 收敛与续用（2026-11-04）

用户明确确认：执行复用普通 Session，委派层收敛为关联和交付记录，同时支持继续已有会话。本包按该范围实施，没有新建 Worker 会话类型或替代运行引擎。

### 当前所有权

| 内容 | 权威位置 |
| --- | --- |
| 工作指令、验收条件、来源 | 普通 Session 的 attributed user input；输入正文保留原工作内容 |
| 请求与生效配置、调整原因 | 该输入的 delegationInput 快照；普通创建与委派共用 SessionExecutionConfig 核心字段 |
| 当前配置、项目、任务关系、任务状态 | 原 Session；续用时保留，不静默重写 |
| 输入接收、模型/工具执行、恢复证据 | 原有 Runtime 与 admission |
| 成果正文 | 实际生产 Session/message 或 Artifact |
| 请求去重、排队、取消、结果待交付引用 | workspace 的投递回执；没有工作正文、独立目标或成果副本 |

`delegations.db` 继续作为小型持久投递/收件索引。其活跃行只有请求指纹、身份和引用、投递阶段、时间/序号及必要错误，不保存 request、instructions、acceptanceCriteria、effectiveConfig 或 result.text。API 的配置展示从原 Session 输入快照即时投影，不写回回执库。任务状态不跟随回执自动变成 done。

### 新建与续用

- `assistant_delegate` / `residentAssistant:dispatch` 支持可选 targetSessionId。不指定时创建普通 Session；指定时接续同 workspace 的可见、未归档、空闲普通 Session。特殊助手、隐藏会话、忙碌/恢复中会话、handoff 根会话及 Tasks 调度运行所持会话拒绝接管。
- 已有会话以自身配置为基准。显式不兼容的配置、需额外启用的 Skill/插件依赖，或超出助手权限上限的会话均明确拒绝；不替换其模型、目录、来源、任务说明、父级或名称。需要这些变化时可使用新普通 Session，或由用户在原会话调整后重新委派。
- 一个普通 Session 可先后承担多次委派，每次都有独立输入与成果引用。delegationIds 只是关联索引，既不标识新 Session 类型，也不取代原 parentSessionId。普通导入清除跨存储关联。
- 接受阶段将待执行输入与配置快照落入普通 Session，排队和取消也保留原始输入。尚未提交的输入不加入 SDK 恢复历史，也不进入 Runtime 自动恢复队列；取消/拒绝会更新输入接收标记。
- 启动前在原 admission 串行边界核对历史锚点、配置、资源和权限。用户在排队期间继续会话时，普通输入照常工作，旧委派因上下文变化拒绝启动。每个目标同时只接受一笔未结束委派。
- preparing/accepted/submitting/submitted 等是投递阶段。submitted 只在原 Runtime 接收输入后提交，不能据此判断任务已完成。完成事实必须匹配原 inputMessageId；无关用户轮次不充当委派成果。
- 成果回执只含实际来源 Session/message。源会话先持久化，再发布结果引用；助手通过 assistant_memory_read 有界读取原结果并沿用来源抑制检查。源会话删除后返回来源缺失，不回退到旧摘要副本。

### 兼容、恢复与验证

第一版记录升级为 formatVersion=2。能够定位的旧指令/配置归入原 Session 输入；完整旧行保存在只读迁移归档表 legacy_work_archive，用于回滚和排查，不作为活跃任务或助手检索来源。原会话/输入缺失时转为需要处理，不自动复活已删除会话。迁移可重放，旧回执 ID 和请求指纹保持。

新回执在创建或保存输入边界中断时，从普通 Session 的关联与输入来源找回原身份，再报告 needs_attention；不重新创建或投递。Host 仍只有一个权威实例；未知副作用的自动续跑继续属于 P3b。

先补 RS01–RS11 失败矩阵与 E2E，再改实现。[最终证据](../verification/results/resident-session-reuse-final-2026-11-04/delegation-evidence.json)和 [manifest](../verification/results/resident-session-reuse-final-2026-11-04/manifest.json)记录 31 个场景，包含旧 17 项委派场景的适配回归、真实助手模型工具续用会话、已有历史/配置保留、多次委派成果不串用、拒绝不兼容/争用目标、冷启动排除未提交输入、人工继续使旧委派失效、源删除不回读副本、旧记录迁移及绑定中断恢复。产物包括关闭后的 SQLite、原 Session、模型请求和日志；父验证进程另外检查活跃回执确实不含正文/配置副本，迁移归档保留两条原记录。

验证使用生产 Host/SessionManager、真实 RPC/JSONL/SQLite 和编译后的 Pi，模型是回环确定性服务。实际模型请求中保留了原会话历史标记；冷启动人工输入的请求不含未提交委派正文。实际付费模型质量、远端托管/多租户、完整 handoff、大规模性能，以及 P3b/P4/P5 尚未由本包证明。

原有交互仍沿用普通 Session 路径，35 个既有队列/工具/IPC 测试通过；[记忆 16 项](../verification/results/resident-session-reuse-memory-2026-11-04/manifest.json)、[身份 12 项](../verification/results/resident-session-reuse-identity-2026-11-04/manifest.json)、[原生 Pi 记忆 7 项](../verification/results/resident-session-reuse-native-2026-11-04/manifest.json)回归通过。`typecheck:all`、完整 `lint`、文档门禁、协议清单和 `git diff --check` 通过。最终 manifest 的文件哈希可独立重验。

## P4a：全部普通历史的来源目录（2026-11-04）

### 承接核对与范围

承接时分支为 `codex/resident-assistant-0.6`，HEAD 仍为 `0d2db85f6f5156db6a530c91bbdc9cb6de95d22c`，版本 0.5.6；既有未提交工作、用户的两个打包结果 JSON 及 HTML/PNG 原型均保留。本包没有提交、推送或准备发行。

核对现有机制后确认：普通历史由 Session JSONL 保存，Runtime 提供 canonical model context；Pi 0.87 以后由 SessionManager 的日志投影决定实际 provider 历史，`convergeCanonicalContext` 使用原生 context edits/compaction coverage。普通 handoff 会新建产品 Session，不能直接冒充助手换段。本包先补齐重建上下文需要的来源发现与版本核对，不改写运行循环或另建聊天存储。

### 已实现

- `memory/memory.db` 新增可重建的 `history_sessions / history_messages / history_clock` 来源搜索投影。所有普通 Session 默认进入目录，包括归档、隐藏和旧会话；仅特殊助手不作为普通历史来源。原始内容和任务事实继续归 Session/Runtime，索引不产生事实记忆或授权。
- 查询时枚举文件身份，按文件修改身份增量推进，每次最多解码 8 个变化的 Session；没有变化不重新解析正文，不在启动时全量读历史或调用模型。JSONL 为原子重写格式，因此增量边界是 Session 文件，变化的文件仍需整份重读，并非伪造的追加消息游标。
- 每次返回全 workspace 的 discovered/indexed/pending/unreadable/excludedAssistant 数量、已索引消息数和本次刷新数。坏行、损坏的共享快照引用、非法消息和缺失来源不会继续提供旧索引；一个坏来源不阻断其他来源检索。普通 Session 的原有容错读取行为保持。
- 新增 `assistantMemory:history` 远程 RPC、共用客户端接口和角色限定 `assistant_history_search`。中文短词与 SQL 特殊符号走参数化字面查询，可按项目或 Session 限定范围；结果仅给有界片段、UTF-16 范围、来源角色、inputSource、内容哈希与附件计数。附件只登记引用，不声称已经解析。
- 普通工具消息的实际输入/结果可能不在正文。索引与精确回读共用确定性的工具来源视图，保留工具身份、输入、结果和状态；其变化会使旧哈希失效。助手回答、内部委派、旧转发与真人陈述继续区分，未把被检索内容升级为当前事实。
- `assistant_memory_read` / 原来源 RPC 支持可选 `expectedContentHash`；搜索到的材料发生变化时明确拒绝旧版本，不把另一版原文冒充所选证据。现有未带哈希调用保持兼容。
- 分页游标绑定搜索条件、页大小、来源索引版本和 suppression 所属记忆版本。变化后要求重查；忘记会同步清除受抑制的搜索副本，后续搜索与重建都先检查持久 suppression。

### 验证

先补 RH01–RH15 失败矩阵和 E2E，初始红灯、边界红灯及工具来源红灯保留在 `.cache/verification/resident-history-*-red-2026-11-04`。边界复核先复现了合法 plan/auth-request 被排除和工具字段漏检，再修正实现。

[最终历史证据](../verification/results/resident-history-final-2026-11-04/history-evidence.json)和 [manifest](../verification/results/resident-history-final-2026-11-04/manifest.json)：21 个场景通过，使用生产 bootstrap/SessionManager、两个隔离 workspace、真实 WebSocket/JSONL/SQLite、Host 重启和编译后的 Pi。回环模型实际调用历史搜索，再携内容哈希精确读取；三个实际 provider 请求保留在证据中。数据库、来源/助手 Session 快照与日志均可重验；完整配置与自动生成的内置帮助文档留在独立缓存目录。

回归：[记忆 16 项](../verification/results/resident-history-memory-final-2026-11-04/manifest.json)、[身份 12 项](../verification/results/resident-history-identity-final-2026-11-04/manifest.json)、[原生 Pi 记忆 7 项](../verification/results/resident-history-native-final-2026-11-04/manifest.json)、[普通 Session 委派 31 项](../verification/results/resident-history-delegation-final-2026-11-04/manifest.json)；另有 40 个既有队列、工具、IPC 和 JSONL/共享快照测试通过。静态验收包括 `typecheck:all`、完整 `lint`、文档检查、协议清单和 `git diff --check`；437 个协议通道，60 个集中输入契约。

```sh
bun run server:build:subprocess
bun run verify:assistant-history --output-dir=.cache/verification/resident-history-new-run
bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/resident-history-new-run
```

### 明确边界与接续

- 本包是按需、确定性的普通历史目录及来源检索；尚未实现提交后的后台摄取调度、语义/模型提取、自动记忆晋升、冲突治理或大规模性能验收。调用方必须观察覆盖状态，不把未匹配等同于全历史不存在。
- 来源片段/哈希是后续工作集、Context Manifest 和 P3b 事件消费所共用的材料入口；现在仅证明所选来源经工具到达了实际模型请求，没有新增可独立宣布任务完成的状态或第二套模型循环。
- **旧工具内容、助手转述和压缩摘要仍可能留在 Pi/provider 历史。** 本包没有实现依赖失效、在途旧请求退出、实际工作集/历史重建或逻辑 Context Segment，不能宣称“已经彻底忘记”。下一包需在现有 Runtime 的请求准备/提交边界固定来源版本、上下文段与消费身份，再验证下一请求实际退出及晚到结果；P3b 的交付确认接同一入口。
- P3b 的持久事件消费/自动唤醒/原请求转呈及 P5 的品牌前台仍未接通。未验证付费模型质量、完整远程托管、多租户或两个 Host 同时权威运行同一 workspace。

## P4b / P3b / P5：主上下文与交付基础闭环（2026-11-04）

### 主上下文及材料退出

- 复用 Runtime canonical history、原 admission、Pi 模型循环和 SDK context edits。新增 workspace `assistant/context.db` 只保存逻辑段、工作集引用、游标、依赖及请求诊断；没有第二套对话或任务状态。每笔主输入建立新逻辑段，产品 Session 身份和完整时间线不变。
- 必需的直接用户原话按当前议题保留，旧工具过程默认退出，近期派生回答有界保留。显式议题切换记录原截止消息；可以固定/移出带哈希的原来源。`assistant_context_history` 可回找主助手过去议题的原用户输入，普通历史仍走 `assistant_history_search`。遗忘、纠正、来源改写/删除、记忆过期会在下次请求重新核对；不靠旧摘要替代原约束。
- Pi 在真实请求准备前替换模型可见历史，并退出旧 compaction/branch summary 的覆盖范围，保留原 SDK 日志作审计。主助手跳过普通 task continuity 的全历史注入，避免从另一入口带回已退出内容。空/缺失/过期上下文拒绝降级回未过滤的 SDK 历史。
- 实际请求使用既有统一容量口径；必需原文放不下时在 provider 前明确阻塞，不能截断要求。用户可显式调整议题或固定材料后继续。工具结果与近期材料在下一段退出，原输入/未决约束不会按 LRU 静默丢弃。
- 每个 provider 请求单独固定材料依赖、来源哈希/读取范围、记忆修订与状态、请求哈希及 SDK 容量快照；后续检索不会回填为先前已发送。`entered` 只表示通过 Host 请求准备，不冒充完成；`committed` 在 Runtime 成功提交后记录。
- 主助手、工具返回及受委派输入/输出登记已知材料依赖。遗忘检查覆盖精确回读、普通历史搜索和派生来源，不能回读旧转述或旧委派输入复活。普通执行仍是原 Session；依赖失效时暂停受影响执行，新的独立直接用户输入可在安全历史上继续。
- 在途响应先核对材料再向 SDK/界面释放；过期响应保留用量和执行证据，不成为交付或继续执行工具。为此，受材料保护的响应按单次模型响应缓冲，界面会晚于普通流式响应显示内容；未受材料保护的普通 Session 保持原流式路径。
- `assistant_memory_update` 与 RPC 共用 schema、版本、来源和 suppression 约束。主循环可把相关历史提取为 inferred candidate；候选不进入默认 active 召回。user_stated 必须引用本轮直接用户原话，显式修订/状态操作要求直接用户轮次；内部唤醒不能制造用户批准。提取结果本身也登记依赖，候选遗忘后旧转述同样退出。普通会话落盘后有界推进历史目录，不增加隐藏语义模型循环。

### 持久事件与交付

- `delegations.db` 同事务追加去重的不可变引用事件，消费记录另存 prepared/entered/handled/attention/delivered。事件和回执都不复制工作指令、配置或成果正文。
- 完成、失败、需要处理或原请求决策到来后，Host 在助手空闲时通过原 admission/Runtime 唤醒同一个助手。忙碌输入串行排队；内部输入以 hidden info + resident_event 来源持久化，SDK 协议块不成为新的真人气泡。
- 结果事件必须在本轮读过实际结果来源后才能调用 `assistant_delivery_ack`。ACK 绑定本段/本轮事件，表示处理，不代表用户已读、验收或授权。只有成功回复先落盘后才记录 delivered；未 ACK、失败和中断不能被算成交付，也不自动无限重试。
- 冷启动按原 Runtime 的完成事实、原 run 及实际持久消息核对已处理但尚未写交付终态的窗口，恢复原交付引用，不再次推理或派发。没有可核对结果的 prepared/entered 消费转 attention。未知执行副作用继续沿用原 Runtime 屏障，不自动重投。
- 权限和 ask_user 事件只保存原 Session/request 指针。用户回到原会话回答；助手工具不能回答或批准原请求。内部交付轮次也不能重复委派原工作。

### 品牌前台

按用户 HTML 原型的结构方向扩展既有 UI：workspace 默认展开自己的助手，品牌入口收起/重开；普通工作区保持挂载，草稿、执行和原导航保留。主时间线与 composer 复用 ChatPage，默认单栏，交付/记忆/历史/上下文详情按需打开；配置表从原输入快照显示请求与生效值，决策跳转原 Session。

使用既有语义主题、图标、Button、Tooltip 与控件角色；未建立新设计系统。此表面采用 960px 的详情覆盖切换点、1100px 对话外层上限、400/420px 详情宽度与 68px 头部，属于局部布局，不是新全局尺度。明暗主题和减少动态效果沿用原系统。展开/隐藏显式参与查看与焦点归属；窄窗详情隔离背后聊天并限制 Tab，Escape 先交给输入法/内层菜单。遗忘变更清除打开的来源预览并拒绝迟到旧读取结果。

使用 Impeccable 技能完成独立 finish review 和只读 documenter 核对：原四项键盘/可访问性问题均判 resolved。其发现的未定义 token 与原生 title 已改用原有 token / Tooltip；原 DESIGN.md 和 sidecar 的既存漂移仅记录，未重写。PRODUCT.md 同步新增助手入口事实。

### 终验与可复跑证据

先补 RC/RE/RU 失败矩阵和生产 E2E。缓存保留各红灯，包括来源回读、派生来源、候选转述、崩溃交付、Manifest 回填、IME/焦点和遗忘后预览。最终证据：

| 验证 | 场景 | 证据 |
| --- | --- | --- |
| 主上下文 / 自动交付 | 25 | [manifest](../verification/results/resident-context-delivery-final-2026-11-04/manifest.json)、[请求与场景](../verification/results/resident-context-delivery-final-2026-11-04/context-evidence.json) |
| 隔离 Electron 前台 | 9 | [manifest](../verification/results/resident-assistant-ui-final3-2026-11-04/manifest.json)、[界面证据](../verification/results/resident-assistant-ui-final3-2026-11-04/ui-evidence.json) |
| 记忆 Host | 16 | [manifest](../verification/results/resident-foundation-memory-final-2026-11-04/manifest.json) |
| 普通历史目录 | 21 | [manifest](../verification/results/resident-foundation-history-final-2026-11-04/manifest.json) |
| 身份与角色 | 12 | [manifest](../verification/results/resident-foundation-identity-final-2026-11-04/manifest.json) |
| 原生 Pi | 7 | [manifest](../verification/results/resident-foundation-native-final-2026-11-04/manifest.json) |
| 普通 Session 委派 | 31 | [manifest](../verification/results/resident-foundation-delegation-final-2026-11-04/manifest.json) |

主链使用生产 Host/SessionManager、真实 WebSocket/JSONL/SQLite、编译 Pi 和回环 provider；保留实际请求、原助手时间线、关闭后的 memory/context/delegations 数据库及日志。Electron 产物含明暗/紧凑截图与 Playwright trace。完整配置和生成的内置帮助文档仍在 `.cache/verification`。另有 49 个既有队列/工具/协议/SDK 测试通过；`typecheck:all`、完整 `lint`、文档门禁、四项 i18n 门禁、身份/版本、协议清单与 `git diff --check` 均通过；439 个协议通道、62 个集中输入契约。七组终验 manifest 已独立重验文件哈希。

```sh
bun run server:build:subprocess
bun run verify:assistant-context --output-dir=.cache/verification/context-new-run
bun run electron:build:main
bun run electron:build:preload
bun run electron:build:renderer
bun run verify:assistant-ui --output-dir=.cache/verification/ui-new-run
bun run scripts/verification/verification-artifacts.ts --verify=<产物目录>
```

### 仍然明确保留的边界

- 这里完成 0.6.0 方向的基础纵向实现，不声称整个 0.6.x 深化路线已完成或已经发行。自动语义维护、冲突/双时间、备份合并 suppression、长期真实任务和更成熟的工作台继续按 0.6.1–0.6.3 验证；服务器托管/多租户与受控主动性仍属后续。
- 当前提取发生在主循环选取相关来源时，并非对全部旧历史自动逐条调用模型。普通历史默认均可发现，目录按文件增量推进；没有新增默认排除列表。附件依然只登记来源，不宣称已理解所有多模态原件。
- 来源抑制仍为整条消息粒度，依赖退出针对 Host 已知的来源/修订关系，不能证明未知语义转述或外部副本已消失。旧 Runtime/SDK/provider 请求和原档案可能仍保留审计内容；已送出的 provider 数据无法撤回。只能按证据声明后续请求与回读退出，不能宣称彻底抹除。
- 必需原文增长过大时会明确要求调整工作集；尚未证明自动跨多议题语义整理的长期质量。主助手复用同一产品身份的 SDK 逻辑段，普通 handoff 仍是普通功能，未冒充助手换段。
- 只支持一个权威 Host 运行同一 workspace。没有实际付费模型、签名发行包、完整远端托管或物理触控硬件结论；版本仍为 0.5.6，未自行提交、推送、清理或发布。用户既存的两个打包验收 JSON、HTML/PNG 原型保留。

## 居中独立入口与共享对话页（用户修正，2026-11-04）

### 最新决定与实现

用户指出此前把左上原 Logo 改成省略号、在该处加入助手入口的理解有误。常驻助手应位于**应用中间顶部独立的品牌处**；原 Logo 的位置和应用菜单功能必须保留。用户同时要求不再为助手增加侧边栏，可以直接复用当前对话窗口。

本包按此覆盖前节 UI 的具体实现：

- 恢复 Desktop/Mobile 原 Phaneris Logo、尺寸及菜单行为。顶部中央新增独立 Phaneris 入口，用视口中心定位，并为原左右控件保留空间。窄窗以原动作注册表生成工具菜单，原全部入口继续可达，品牌不会与它们重叠。
- 移除独立助手聊天外壳、portal、全屏开关、详情侧栏及其前后台 atom。品牌仅取得 Host 单例身份并导航到原 `allSessions/session/<id>`；助手和普通 Session 共用一个 ChatPage/composer/草稿/焦点流程，不再挂载第二个聊天。
- 默认 workspace 入口等待单例元数据注册后选择助手；显式 Session URL、重载、前后导航沿用原解析。Host 不可用时结束等待，原普通导航仍可用；品牌可重试并显示具体错误。切换 workspace 时不应用迟到的另一 workspace 响应。
- 助手页只增加一个管理菜单，记忆、历史、交付和上下文使用已有 Dialog；关闭回到原聊天，聊天宽度不变。原来源回读、固定材料、遗忘、请求/生效配置和原决策跳转都保留。
- 已加载 Session 不因再次点击品牌而被旧读取快照覆盖。助手身份、用户草稿和普通会话分别沿用原状态所有权。UI 收敛没有改动记忆、委派或 Runtime/模型循环。
- 为遵守 NavigationContext 的文件规模门禁，把原有 Source/Skill 默认选择整体移入 `useNavigationResourceDefaults`；选择语义保持，未放宽预算或挤掉注释/空行规避门禁。

### 先行失败与验收

先补 RI01–RI07 失败矩阵与真实 Electron E2E，再改生产实现。新验证先复现旧助手外壳与窄窗工具遮挡；红灯保存在 `.cache/verification/resident-shared-chat-entry-red-2026-11-04` 和 `.cache/verification/resident-entry-overlap-red-2026-11-04`。

[最终 manifest](../verification/results/resident-centered-entry-shared-chat-final3-2026-11-04/manifest.json)和[界面证据](../verification/results/resident-centered-entry-shared-chat-final3-2026-11-04/ui-evidence.json)记录 9 个场景：原 Logo 菜单及中央品牌独立、复用会话页/路由、普通/助手草稿、管理对话框不改变聊天宽度、记忆原文/遗忘/工作集、窄窗所有原操作可达且无重叠、键盘焦点，以及显式普通 Session 重载不被默认助手覆盖。产物保留浅/深色及窄窗截图、trace；配置在 `.cache/verification`。

本次只调整客户端呈现及启动导航。前节 Host/记忆/交付证据继续对应其实际实现；旧 UI manifest 是旧界面的历史证据，当前界面以本节为准。版本仍为 0.5.6，分支/HEAD 不变，未提交、推送或发布；用户既存打包结果与 HTML/PNG 原型保留。

本包最终核对：`typecheck:all`、完整 `lint`、四项 i18n 门禁、文档门禁与 `git diff --check` 通过；12 个既有导航回归通过。9 场景 UI 产物的 manifest 已独立重验。桌面和窄窗最终截图确认原 Logo 与居中入口分离、无控件重叠；本包未改动后端执行或记忆机制。

## P4c：普通历史增量提取检查点（2026-11-04）

### 已实现

- 在同一 `memory.db` 保存提取检查点与 Runtime 读取绑定。检查点只保留来源身份、内容哈希、项目、UTF-16 范围、处理结论和候选引用；不把来源正文另存成提取任务，也不新增 Worker 类型、任务状态机或模型循环。
- 新工具 `assistant_memory_maintenance` 只开放给常驻助手。`next` 从全部普通历史范围内按项目/Session 取待处理片段；每笔原 Runtime 主轮次最多一个 6000 字符片段。这个数是工具传输上限，不是长期记忆容量或质量结论。普通历史提交后的目录维护、主轮次来源准备和既有检索共用同一增量目录。
- 主上下文只注入提取覆盖计数，不自动塞入无关历史正文。助手在当前议题相关时通过原模型循环审阅一段；有价值的观察经已有 `assistant_memory_update` 保存为 inferred candidate，再引用实际候选确认。没有可提取内容可以明确确认 `no_candidate`，不为提高覆盖率制造记忆。
- 已确认的来源版本/项目不重复提取。中断后未确认片段保留，Host 重启及下一主轮次重新读取同一检查点；稳定 `requestIdPrefix` 让候选写入重试沿用原去重机制。同轮重复相同确认幂等，更改结论明确冲突。
- 确认必须绑定本轮实际读取；候选必须是检查点建立之后、当前来源哈希与项目下的未隐藏推断候选。来源改写、项目迁移、删除、遗忘或已知派生依赖失效时拒绝旧确认。读取范围登记到现有 Context Manifest 依赖；失效材料沿用主上下文退出与在途结果屏障。
- 覆盖状态区分已审阅文字、部分处理、待处理和不可用来源，保留目录待索引/不可读量与未解析附件消息数。历史详情显示审阅进度，并明确附件尚未解析；继续复用共享管理 Dialog，没有新增侧栏或聊天外壳。

### 先行失败与验证

先补 RX01–RX10 失败矩阵及生产 Host/Pi E2E。`.cache/verification/resident-extraction-red-2026-11-04` 复现入口缺失，`.cache/verification/resident-extraction-ui-red-2026-11-04` 复现 UI 尚无提取覆盖说明。

增量提取验证覆盖真实 Runtime 取片段、候选、确认、同轮限额、重启续接、稳定请求去重、未读取/无效候选拒绝、项目隔离与迁移、来源删除/遗忘、实际 provider 材料退出及 UTF-16 进度；输出来源时间线、实际请求、检查点 SQLite 和可重验 manifest。配置和生成的内置帮助文档继续留在 `.cache/verification`。

[提取终验 manifest](../verification/results/resident-memory-extraction-final-2026-11-04/manifest.json)记录 19 个场景、21 笔主轮次、60 次实际 provider 请求；8 条来源文字审阅完成，1 条含附件消息仍明确未解析。首请求只含覆盖计数，不含尚未选择的历史正文。候选保存后、确认前重启，重试沿用原候选 ID。

回归：[记忆 16 项](../verification/results/resident-extraction-memory-final-2026-11-04/manifest.json)、[历史 21 项](../verification/results/resident-extraction-history-final-2026-11-04/manifest.json)、[上下文/交付 25 项](../verification/results/resident-extraction-context-final-2026-11-04/manifest.json)、[身份 12 项](../verification/results/resident-extraction-identity-final-2026-11-04/manifest.json)、[原生记忆 7 项](../verification/results/resident-extraction-native-final-2026-11-04/manifest.json)、[普通 Session 委派 31 项](../verification/results/resident-extraction-delegation-final-2026-11-04/manifest.json)、[共享界面 10 项](../verification/results/resident-extraction-ui-final-2026-11-04/manifest.json)。合计 141 个 E2E 场景；另有 30 个既有工具绑定、SDK 上下文/流和 IPC 测试通过。`typecheck:all`、完整 `lint`、四项 i18n、身份/版本与 `git diff --check` 通过；协议仍为 439 通道、62 个集中输入契约。

```sh
bun run server:build:subprocess
bun run verify:assistant-extraction --output-dir=<尚不存在的目录>
bun run scripts/verification/verification-artifacts.ts --verify=<产物目录>
```

### 接续边界

- 本包是可恢复、有预算、按相关范围推进的增量提取入口；没有启动额外空闲模型、承诺所有历史已经语义理解，或自动晋升推断候选。当前覆盖是文字处理事实，不代表事实仍然有效、所有附件已理解或模型提取质量已验收。
- 语义冲突/双时间/替代关系、维护策略校准、备份合并 suppression、更成熟的长期议题管理和工作台仍按 0.6.1–0.6.3 继续。源消息粒度抑制、已知 lineage、单一权威 Host 和已送出 provider 数据不可撤回的边界保持。
- 顶部居中独立入口、原 Logo 菜单和共享对话页保持。分支/HEAD/0.5.6 版本保持，未提交、推送、发布或清理工作树，用户既存打包结果与原型保持。

## P4d / P4e / P4f：有效时间、关系和退出标记（2026-11-04，后端继续实施）

用户追加要求继续完成计划内全部后端功能；后续以服务端、协议和原 Runtime 为重心，不扩展新的界面结构。

- `validFrom/validUntil` 与记录的 `createdAt/updatedAt` 分离；未来生效记录只投影为 scheduled，默认不召回。修订时未传保留，null 明确清空；合并后的空/倒置区间拒绝。分页绑定规范化过滤条件、页大小及最近生效/到期边界。
- `condition` 作为同项目/key 下的成立条件；不同条件可并存，相同条件重复明确拒绝。没有条件的旧记录保留原 scope_key 格式，不重写或覆盖旧库。条件与正文一起遵守遗忘隐藏。
- 显式 `dispute/resolve` 在同一事务核对全部关联 revision、范围及争议闭包。争议是附加标记，不自动选赢家；不同项目、条件或不重叠事实时间不机械合并。resolve 不指定赢家表示并存，不晋升候选；指定赢家才记录核对时间、supersedes/supersededBy，并使旧条目退出当前召回。
- 普通 activate 不能清除争议，superseded 不能靠 activate/revise 自动恢复。遗忘最新替代记录遍历当前和历史修订里的替代祖先，保留整消息 suppression；当前和旧回执视图不返回已抑制正文或关系原因。
- 有目的的历史审阅可用 `includeRetired/ids` 读取明确状态的候选、冷却、争议或过时材料；默认工具检索仍只取当前有效事实。Context Manifest 固定观察到的生命周期/争议状态，之后发生修订、状态或争议变化会退出相应派生材料，历史审阅不能冒充晋升或批准。
- 新增 reference-only 的 `assistantMemory:suppressionExport/suppressionMerge`，分页、版本/页大小校验、请求指纹去重、workspace 绑定和并集合并。较新 suppression 合入旧库时，连同当地当前修订和已知替代祖先一并退出；没有新增标记或状态变化不增加记忆可用性版本。标记不存在正文，API 不接受磁盘路径，也未把备份导入能力开放给模型工具。
- 两个退出标记方法接入现有 Host/RPC、远程路由、集中输入契约、typed result 与客户端 transport。协议现为 441 通道、64 个集中输入契约；清单和 IPC fixture 通过维护脚本生成，没有删除旧通道。

先补 RT01–RT09、RL01–RL09、RB01–RB05 失败矩阵和 E2E，再写对应代码。阶段结果在 `.cache/verification/resident-temporal-check2-2026-11-04`（有效时间 10 项）、`resident-relations-check1-2026-11-04`（关系 11 项）、`resident-temporal-relations-check2-2026-11-04`（包含真实 Pi 关系处理的 13 项）和 `resident-suppression-merge-check1-2026-11-04`（关系及旧库恢复/标记合并 16 项）。后续补充历史争议审阅已接入，仍需本包终验及完整门禁，不能把这些阶段产物当作最终收尾。

这里的备份保障是 API 合并仍持有的较新退出标记。若直接物理覆盖所有库及标记，且只剩旧备份，系统不能恢复丢失的遗忘事实。未实现未知语义转述的全局删除，也没有宣称 provider 已收数据可撤回。自动语义冲突识别、存储/工作集预算治理、多议题成熟换段、执行尝试深化及托管仍继续按后端路线逐项实施。

## P4g / P4h：多议题工作集与来源快照（2026-11-04，后端继续实施）

- 同一 context.db 增加议题引用记录；保存稳定 topicId、项目、原始输入 ID 和固定来源，不保存另一份聊天正文或任务状态。原 `residentAssistant:context` 接入 topics 有界元数据清单及 resume；focus 开新议题，anchors 修改当前议题，原始 Session 身份和时间线保持。
- 恢复议题只选回该议题的原始直接用户输入，其他议题的原文和过程退出。遗忘的原始输入退出，剩余要求继续保留；缺失或失去作者证明的原要求阻塞 provider，显式开新范围仍可恢复工作，不凭旧摘要补齐。
- 固定来源恢复时必须通过原哈希/抑制校验；过时来源明确拒绝，只有调用者显式覆盖 anchors 才移出。跨项目恢复沿用既有项目选择约束，不能只改上下文的项目显示值。
- 先行实际请求测试复现了一个旧缺口：项目选择仅更新 Session 元数据，已创建助手仍读旧 config.session.projectId。新增后端安全入口 `updateProjectContext`，仅在常驻助手每轮开始前同步；实际 provider 请求验证 A/B 项目规则退出和恢复。没有改普通 Session 的运行语义、工作目录或权限。
- 原 request Manifest/segment 增加 topicId。每轮逻辑段、原 Runtime admission、事件消费和稳定产品 Session 继续使用；没有用普通 handoff 创建替代产品会话。
- 来源服务在单次同步校验/查询/修改边界内复用同一 Session 的解码快照，递归派生检查共用；离开边界或抛错必定清除。下一请求重新读取，suppression 在当前事务内仍即时检查。128 个同 Session 引用一次只解码一份真实 JSONL，跨边界改写/删除仍失效，工作区间不共用缓存。

阶段验证：`.cache/verification/resident-topic-project-context-check1-2026-11-04` 30 项；增加缺失原要求恢复后，`resident-topics-missing-source-check1-2026-11-04` 31 项。`.cache/verification/resident-sources-check1-2026-11-04` 为真实 JSONL/SQLite 的来源服务验证 8 项。实际项目规则红灯为 `resident-topic-project-context-red-2026-11-04`，来源快照红灯为 `resident-sources-red-2026-11-04`。这些仍是本轮后端阶段证据，终验、回归和产物重验继续在收尾统一执行。


## P4i / P3c / P3d：有界导航、执行事实与配置版本（2026-11-04）

### 有界记忆与范围

- `assistant_memory_search` 改为导航视图，序列化结果最多 12000 字符；正文预览 600、成立条件预览 200，来源只给前两项及完整数量。游标只推进实际返回的记录；单次最多扫描 100 项，不用无界结果塞入上下文。`assistant_memory_inspect` 按 id/expectedRevision 精确展开，正文范围、来源、证明与替代祖先分别有界分页。
- 预览和精读分别登记实际观察到的 revision、状态、争议和来源，不把有目的的历史审阅当作当前权威；遗忘后的视图继续隐藏正文和关系。默认查询取安全边界已应用的当前项目加 workspace 通用记忆；普通历史/维护也默认当前范围，显式 `scope=workspace` 才跨项目发现，返回解析后范围。全部普通 Session 的历史来源资格不变。
- 来源服务同步边界内共用 JSONL 解码快照，边界外不缓存正文；128 个同 Session 引用只需解码一次，下一边界改写/删除和当前事务内 suppression 仍即时失效。

### 执行尝试与版本

- `assistant_work.execution` 从原 Runtime 的 `operation_accepted` 精确匹配本笔 `inputMessageId`，给出有界尝试、接受序号、原阶段、终结事件和未结工具数。排队未启动、来源不可用、旧记录缺事实和 handoff 后继分别明确表示；普通 Session 的过去人工轮次或其他委派不串用。
- 只读尝试视图和配置显示都从原所有者即时投影，`delegations.db` 不存副本，也不新增任务状态或恢复引擎。Runtime complete 表示执行事实，不表示用户验收。
- Worker 配置复用已登记 `default/mini` preset。任意 system 文本、未知 preset 或 resident_assistant 均在创建前拒绝；续用必须匹配原 preset。实际请求测试发现并修复了既有 preset 仅驻内存的缺口，现已纳入 Session 持久字段；普通导入清除保留助手 preset，防止导入历史变成特殊角色。
- 原输入保存 requested/effective 配置、`configRevision/capabilityRevision`、接受时配置版本和权限上限。配置 revision 为公开解析值的稳定哈希；能力 revision 固定所选模型/连接能力、项目规则、Skill 正文/元数据、插件 manifest/资源/常驻 prompt 和来源 transport/guide。来源可能带内联凭据，因此使用 workspace 私有 32 字节 HMAC key，仅输出不透明版本，不读取或导出凭据库。版本不承诺递归固定插件脚本依赖、外部服务内容或凭据值本身。
- 排队启动前重新解析，资源名称相同而内容变化也明确拒绝。原权限上限只能收紧，接受时版本保留；旧未绑定版本的待执行输入要求明确新请求，不能事后假装已固定。
- 原模型准备、响应提交和工具准备边界继续核对当前执行配置/能力。所有有版本的委派沿用原 canonical history 的 fenced 响应缓冲；在途资源变化后迟到输出保留 Runtime/用量证据，却不进入模型可见历史或成果回执。未知结果进入原恢复屏障，不自动重新执行。
- 配置目录按公开身份稳定排序并带 `catalogRevision`；后页携 `expectedRevision`，目录变化要求重新发现。没有复制一套可写模型/插件目录。

先行矩阵 RK01–RK05、RA01–RA05、RV01–RV07 均在对应生产代码前补齐。阶段红灯包括 `.cache/verification/resident-config-versions-red-2026-11-04`、`resident-capability-late-red-2026-11-04` 和 `resident-preset-import-red-2026-11-04`；分别记录能力目录缺 preset、在途变更仍交付旧结果、导入携带助手保留 preset 的缺口。修复后统一终验与边界记录见下节。


## P3e：按原成果版本返工（2026-11-04）

- `assistant_delegate.artifacts` 接受最多 16 个不重复的 Artifact/revision 引用，必须同时指定原 owner 普通 Session 为 targetSessionId。缺失 owner、外会话成果、旧版本和重复引用在创建输入前拒绝，不新造 owner 或任务模型。
- 返工引用、指令和实际执行配置仍只保存在原 Session 输入；引用随本轮输入进入实际 provider 请求，`assistant_work.artifactBaselines` 为即时投影，投递库不存副本。
- 排队启动前重新核对 Artifact 当前 draft/current revision；变化后拒绝未提交输入，新请求才可绑定新基线。执行中的修改、租约、expectedRevision、提交、验证与用户接受继续沿用原 Artifact 存储和工具原子边界，基线核对本身不表示成果已验证、已接受或已发布。
- RF01–RF04 矩阵和 E2E 先行；有效基线在旧严格 schema 下的红灯保留于 `.cache/verification/resident-artifact-baseline-red-2026-11-04`。跨 owner/旧版本/重复拒绝、真实 provider 基线和排队 drift 进入委派终验；既有 Artifact 存储/导入导出工作流单独回归。


## 本轮后端统一终验（2026-11-04）

以下为本轮实际通过的验证场景；完整配置和自动生成的内置帮助继续只留在 `.cache/verification`，验收目录只保留必要证据。统一入口为 [backend evidence](../verification/results/resident-backend-reviewed-final-2026-11-04/backend-evidence.json) 和 [manifest](../verification/results/resident-backend-reviewed-final-2026-11-04/manifest.json)。

| 方向 | 通过 | 可复验 manifest |
| --- | ---: | --- |
| 基础记忆 | 16 | [memory](../verification/results/resident-backend-memory-final-2026-11-04/manifest.json) |
| 普通历史 | 21 | [history](../verification/results/resident-backend-history-final-2026-11-04/manifest.json) |
| 有效时间、关系与实际模型退出 | 14 | [temporal](../verification/results/resident-backend-temporal-final-2026-11-04/manifest.json) |
| 争议、替代、旧库与退出标记 | 16 | [relations](../verification/results/resident-backend-relations-final-2026-11-04/manifest.json) |
| 来源快照、有界导航、范围 | 13 | [sources](../verification/results/resident-backend-sources-final-2026-11-04/manifest.json) |
| 角色、身份与导入 | 12 | [identity](../verification/results/resident-backend-identity-final-2026-11-04/manifest.json) |
| 原生 Pi 记忆 | 7 | [native](../verification/results/resident-backend-native-final-2026-11-04/manifest.json) |
| 提取检查点 | 19 | [extraction](../verification/results/resident-backend-extraction-final-2026-11-04/manifest.json) |
| 主上下文、多议题和交付恢复 | 32 | [context](../verification/results/resident-backend-context-reviewed-final-2026-11-04/manifest.json) |
| 普通委派、执行尝试、能力版本与成果基线 | 47 | [delegation](../verification/results/resident-backend-delegation-v4-final-2026-11-04/manifest.json) |
| 既有 Electron 界面兼容 | 11 | [ui](../verification/results/resident-backend-ui-final-2026-11-04/manifest.json) |
| 原 Artifact 所有权、存储与移交 | 9 | [artifacts](../verification/results/resident-backend-artifacts-final-2026-11-04/manifest.json) |

共 217 个验证场景。来源服务 13 项是先行失败清单约束下的真实文件/SQLite 隔离验证，其余各工作流的链路与未验证范围以各 manifest 为准，不把场景总数统称为真实模型质量 E2E。另有 23 个工具/SDK/IPC 和 36 个既有 Session 存储、快照、导入及队列回归通过。Pi 子进程在工具契约修改后重建；Electron main/preload/renderer 完成构建。完整 typecheck、lint、四项 i18n、文档、identity/version、协议清单及 diff 检查的日志汇入统一证据。

失败与恢复均保留：首轮 context-final 因扩充套件在并发负载下超过 90 秒总时限被终止，调整为 180 秒后 reviewed-final 全部通过；早期 delegation-final 暴露验证脚本只查第一页，reviewed-final 又证实 needs_attention 会阻塞后队列，修正脚本显式结束该测试委派后 v3/v4 通过。没有为通过测试放宽生产恢复屏障。

### 当前明确边界

- 本轮实现的是可靠交互、执行、记忆和上下文的后端底座及上述治理包，版本仍为 0.5.6；未提交、推送、打包发布，也未把这些测试说成整个 0.6.x 路线已全部验收。
- 自动语义冲突识别、真实模型提取/召回质量、长期多项目场景和大规模容量校准仍需验证。现有冲突/并存/替代是显式关系操作，候选不会自动晋升；维护复用主 Runtime，每轮有界推进，没有独立后台模型循环。
- 当前已限制检索包、材料工作集及实际请求容量，但没有完成全库磁盘保留/归档/回收策略。原会话历史、审计修订、退出标记继续保留，不靠冷却状态声称磁盘有界，也不自动删除用户资料。
- 已知来源、记忆修订和派生依赖可以退出实际下一请求及在途结果；未知语义转述不具备全局可证明的 lineage。遗忘当前仍为整条来源消息粒度，已发给 provider 的数据、原始资料和审计历史不能撤回，不能宣称彻底抹除。
- 成果返工基线核对不产生新的成果验证或用户验收事实；真实成果正文与 Artifact/Runtime 回执仍归原所有者。后继会话/外部服务的未知状态不由助手总结补成成功。
- 服务化产品、远端部署、跨 Host 迁移/能力桥、多租户及两个 Host 同时权威运行同一 workspace 仍未验收。主动发现新工作、自定目标和巡视属于后续规划；任务完成后的内部交付已使用原可靠入口。

可按各工作流独立复跑，输出目录必须尚不存在；随后用 `verification-artifacts.ts --verify=<产物目录>` 重验文件哈希。两个既存 packaged-client JSON 及原型文件未纳入本轮修改。


### Artifact 验证原件索引

以下均为隔离测试样本，供核对源文件、移交后的 checkout 与不可变修订，不是产品帮助文档或真实用户资料：

- [样本 1：relative-report.md](../verification/results/resident-backend-artifacts-final-2026-11-04/source/relative-report.md)
- [样本 2：user-owned.md](../verification/results/resident-backend-artifacts-final-2026-11-04/target/sessions/261104-quiet-laurel/artifacts/checkouts/e16013a8-acfb-465a-8f8f-d8606ef48e25/user-owned.md)
- [样本 3：5db56aa5940dcc94c014d6a5a0f07229ddc969780583516901b9e1973b19fda6.md](../verification/results/resident-backend-artifacts-final-2026-11-04/target/sessions/261104-quiet-laurel/artifacts/revisions/e16013a8-acfb-465a-8f8f-d8606ef48e25/5db56aa5940dcc94c014d6a5a0f07229ddc969780583516901b9e1973b19fda6.md)
- [样本 4：90aeb23de0e4ced48ba60aff1ae8cdefa4eb6b663c5f9aa2d94b4ade121264dd.md](../verification/results/resident-backend-artifacts-final-2026-11-04/target/sessions/261104-quiet-laurel/artifacts/revisions/e16013a8-acfb-465a-8f8f-d8606ef48e25/90aeb23de0e4ced48ba60aff1ae8cdefa4eb6b663c5f9aa2d94b4ade121264dd.md)
- [样本 5：da71fe2468d51ec17c9e8264d282a804b52255a56e9d3566fe1fc98fa559a75a.md](../verification/results/resident-backend-artifacts-final-2026-11-04/target/sessions/261104-quiet-laurel/artifacts/revisions/e16013a8-acfb-465a-8f8f-d8606ef48e25/da71fe2468d51ec17c9e8264d282a804b52255a56e9d3566fe1fc98fa559a75a.md)
- [样本 6：user-owned.md](../verification/results/resident-backend-artifacts-final-2026-11-04/user-owned.md)


## RZ：后端架构收敛（2026-11-04）

用户要求整体实现干净、独立，在保留现有功能的前提下授权实施本轮收敛。本包不增加并行调度、产品功能或第二套执行模型。

### 已收敛的边界

- 新增 workspace 级 `ResidentAssistantService`，统一持有助手热路径的记忆/上下文连接、委派协调器和唤醒计时器；工具回调、上下文策略、内部交付、交付恢复核对及完成后的来源登记收进该模块。SessionManager 提供会话事实和原 admission/持久化接口，不把可变 ManagedSession 对象交给服务。创建/恢复普通 Session、输入写入、配置应用、权限及执行停止仍由原所有者承担。
- 服务停止时先停委派/唤醒，原 Runtime 退出后再释放数据库资源；关闭后的调用明确拒绝，不能偷偷重新开库。原文件正文快照仍只存活于单次同步来源边界，未改成跨轮正文缓存。独立 memory RPC 继续采用请求级短连接，外连接修改/遗忘会被热路径连接立即观察到。
- 活跃段状态只保存 `activeSegmentId`，API 从段表投影完整对象。来源依赖按 Session/message/hash 合并相同引用和范围；逐 provider 请求的独立快照仍保留，不把后续读取回填到先前请求。
- context.db 升级到 user_version=2；旧嵌入段转为引用，段表副本不存在时保留嵌入段原身份/材料再迁移。缺失活跃段阻塞准备，用户显式 focus 可恢复新范围；没有凭旧摘要猜测约束。
- 上下文准备改为只读提取覆盖统计，不再借 `history({limit:1})` 扫目录、刷新索引。显式来源查询/提取和普通 Session 完成后的有界维护继续使用原入口，普通历史来源资格不变。
- Pi 适配器的 resident/materials 两套回调收敛为一套可选 `ModelContextPolicy`；角色策略留在服务，底层负责调用。准备时 identity/validity 校验只执行一次，工具边界及模型提交前后两次跨异步校验继续保留；普通无委派输入保持原路径。现有 `residentContext` 线协议字段保留兼容，没有为了更名扩出另一套协议。
- 执行配置解析函数只读；能力版本 key 的初始化由服务生命周期负责。原配置快照、接受时权限上限、排队/在途变化屏障保持。
- 旧完整委派记录升级隔离进 `delegation-migration.ts`，仅在数据库版本落后时执行；当前格式不再逐次全表扫描旧格式。精确旧行归档、缺源处理、未知执行恢复和原 Session 绑定保留。

### 可复验结果

矩阵 RZ01–RZ07 在对应变更前写入。初始红灯 `.cache/verification/resident-simplify-red-2026-11-04` 复现上下文准备写历史索引；`resident-structure-red-2026-11-04` 复现坏段引用提示显式恢复却无法 focus 的问题，随后修复。没有新增事后单元测试。

结构证据实际观察到：旧上下文验收库 32 个段中有 5 个含重复依赖，最大一段为 37 项/10 个唯一来源；新验收库 32 个段全部无重复，最大为 14 项/14 个唯一来源。旧活跃状态嵌入完整段，新状态只存一个段引用。另有真实 JSONL/SQLite 的 20 轮同来源验证，每轮依赖均保持一项；这些数字描述所验场景，不冒充长期性能基准。

[统一重构证据](../verification/results/resident-refactor-final-2026-11-04/refactor-evidence.json)和 [manifest](../verification/results/resident-refactor-final-2026-11-04/manifest.json)汇总以下产物及静态门禁：

| 方向 | 场景 | Manifest |
| --- | ---: | --- |
| 结构、迁移与资源关闭 | 5 | [structure](../verification/results/resident-refactor-structure-final-2026-11-04/manifest.json) |
| 主上下文、来源退出与交付恢复 | 36 | [context](../verification/results/resident-refactor-context-final-2026-11-04/manifest.json) |
| 委派、配置、权限与成果基线 | 48 | [delegation](../verification/results/resident-refactor-delegation-final-2026-11-04/manifest.json) |
| 身份与角色 | 12 | [identity](../verification/results/resident-refactor-identity-final-2026-11-04/manifest.json) |
| 编译后 Pi 原生记忆工具 | 7 | [native](../verification/results/resident-refactor-native-final-2026-11-04/manifest.json) |
| 增量提取 | 19 | [extraction](../verification/results/resident-refactor-extraction-final-2026-11-04/manifest.json) |
| 基础记忆 | 16 | [memory](../verification/results/resident-refactor-memory-final-2026-11-04/manifest.json) |
| 普通历史 | 21 | [history](../verification/results/resident-refactor-history-final-2026-11-04/manifest.json) |
| 来源快照与有界导航 | 13 | [sources](../verification/results/resident-refactor-sources-final-2026-11-04/manifest.json) |
| 关系、替代与退出标记 | 16 | [relations](../verification/results/resident-refactor-relations-final-2026-11-04/manifest.json) |
| 有效时间与实际材料退出 | 14 | [temporal](../verification/results/resident-refactor-temporal-final-2026-11-04/manifest.json) |
| Electron 接入兼容 | 11 | [ui](../verification/results/resident-refactor-ui-final-2026-11-04/manifest.json) |

合计 218 个场景，其中 structure/sources 为先行失败矩阵约束下的真实文件/SQLite 隔离验证；另有 59 个既有工具、SDK、IPC、Session 存储/快照/导入及队列测试通过。Pi、Electron main/preload/renderer 重建；完整类型、lint、四项 i18n、身份、版本、文档、协议清单及 diff 门禁纳入证据。协议仍为 441 通道、64 个集中输入契约，版本仍为 0.5.6。

复跑新结构验证：`bun run verify:assistant-structure --output-dir=<尚不存在目录>`；上下文/委派等继续使用既有工作流，再调用 `verification-artifacts.ts --verify=<产物目录>` 重验。所有配置、自动生成帮助和试验数据配置根留在 `.cache/verification`。

### 保留的边界

这轮收敛减少的是重复状态、热路径资源开销、隐含副作用及核心中的业务编排，不以文件数或总行数冒充简洁。三个 SQLite 库未强行合并；Session/Runtime 跨所有者的恢复事实仍需核对。没有引入通用插件框架、事件总线、额外任务引擎或模型循环。

前节关于未知语义 lineage、整消息遗忘粒度、provider 已收数据不可撤回、磁盘保留/回收、真实模型长期质量和远端托管的限制继续成立。既存 UI/原型及两个 packaged-client JSON 未覆盖或归入本轮修改，未提交或推送。
