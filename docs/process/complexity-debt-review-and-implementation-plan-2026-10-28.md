# 复杂度债务审计复核与全面实施方案

日期：2026-10-28（Asia/Shanghai）  
状态：评估与规划完成；用户已授权实施，进度与验证限制见[实施记录](complexity-debt-implementation-2026-10-28.md)。  
复核基线：`1910533062d8c33e1f57b7b58b2eba967bc9914f`，v0.5.2，`codex/session-foundation`。  
原始报告：[历史过度工程化与复杂度债务审计](overengineering-complexity-debt-audit-2026-10-28.md)。保留原文作为历史快照，当前实施以本方案的修正为准。

## 1. 总体裁定

**原审计方向基本准确，足以确认一批局部复杂度债务，但不能直接作为删除清单。** S1、S2 的无消费者派生写入，S5 的双份清单，S6 的单后端分发，以及 S7 的重复恢复都有源码证据。需要修正的是“无调用”的范围、必要机制与冗余表示的边界，以及部分建议所遗漏的状态语义。

不建议给出“准确率百分比”：S4 包含多个独立子项，其他条目也同时混有事实、风险判断与设计建议，统一计分会掩盖差别。对 durable runtime、T1/T2、原子持久化和权限边界的保留判断成立；这表示本次复核没有找到整体删除它们的依据，不表示已证明整个系统没有其他设计问题。

### 复核范围与事实基线

| 项目 | 本次确认 | 对实施的影响 |
| --- | --- | --- |
| 源码版本 | 原审计为 `bcfbabf6b`；当前为 `191053306`，两者间 84 个文件变化 | 原 HEAD 行号和“正在修改”状态不能直接沿用 |
| 工作树 | 开始复核时仅 `AGENTS.md`、`docs/README.md` 已修改，原审计文件未跟踪 | 本次保留这些既有改动；只新增本方案和索引入口 |
| 已完成清理 | 三个 session atom 已在 v0.5.2 删除 | S4 这部分标记完成，不再安排一次删除 |
| 验证清单 | 65 个 critical workflow、6 个 package group、2 个 native workflow；TS 与 JSON 的 workflow 内容相同 | 重复真实存在；65 个中有 21 个 `upgrade-0153-*`，命名不能作为退役依据 |
| 已跟踪证据 | 1,733 文件，80,544,382 字节，约 76.81 MiB | 原数量和规模基本正确；这不等于可删规模或 Git 历史可回收体积 |
| 验证工具链 | 仓库与 CI 固定 Bun 1.4.3；本机当前为 1.4.2 | 本次轻量检查可作为接线观察；实施前需对齐版本再建立验收基线 |
| 运行成本 | 未做生产 profiling，也未取得可比较的远端 CI 时长序列 | 不承诺延迟、数据库大小或 CI 分钟数的收益 |

本次核对了相关源码、调用点、现有验证脚本、CI、索引与归档政策；没有复做原报告的全部历史提交审计，没有调查仓库外 SQL 报表、外部包消费者或线上客户端分布。

## 2. S1–S8 逐项裁定

| 项目 | 裁定 | 修正与实施边界 |
| --- | --- | --- |
| S1 parity 观测表 | **成立，可优先停写** | 表的查询仅用于测试；移除观测写入、API 和死查询。parity 计算、缺失消息补全、canonical 选择和分歧日志仍有生产作用。旧表与历史内容暂留。 |
| S2 usage 审计载荷 | **成立，但“测试专用生产代码”表述过宽** | `modelUsageAudit` 没有仓库内产品读取者，可移到验证侧；`agent_settled` 本身有生产来源，SDK observation 必须保留。这里核验的是持久化一致性，不是外部账单对账。 |
| S3 证据入库政策 | **矛盾成立，原建议遗漏已有归档政策** | `.gitignore` 的“never committed”与已跟踪文件矛盾；但验证 README 明确保留显式归档的结论层。因此不能把全部 results 当作意外生成物。应统一政策并迁移必要证据。 |
| S4 死代码与兼容壳 | **大部分成立，部分已完成，一项事实错误** | atom 已删。skill mention、null stub、TTL helper 和 fast-mode 生产注入路径可清理。DDG 别名仍被两个测试文件消费，原审计基线就有这些引用；须先迁移测试导入。 |
| S5 critical/CI 门禁 | **双份清单成立，整体“自指无效”的推论不成立** | 删除重复清单可以减少维护成本；错误传播、证据上传、平台覆盖、工具链 pin 有真实价值。不要用数量或哈希替换行为保护，也不要把所有精确匹配都视作多余。 |
| S6 单后端分发 | **成立，限定为 backend dispatch 冗余** | `AgentProvider='pi'` 不等于只有一种 LLM 服务、认证或 transport。删除单元素 registry 与死分支，保留 Pi 构建边界、`pi_compat`、认证、endpoint、模型发现与连接模型约束。 |
| S7 hydration 重复 | **成立，但风险高于普通机械重构** | 两路径的公共序列重复，首次 `refreshRecovery` 在 scope 已绑定且未 processing 时多余。字段同步差异部分是有意设计；必须保持冷路径内存优先、同步执行及队列恢复顺序。 |
| S8 迁移补丁链 | **补丁叠加事实成立，“过时可替代”证据不足** | 12 个 phase 与三次归一化属实；其间处理不同输入形态，读时别名映射不等价。先固定行为与退出条件，不删、不重排，不把所有未来配置兼容都禁止掉。 |

### 2.1 必须纳入实施的证据与更正

**S1 的最小完整清理面。** 当前 [SessionManager.ts](../../packages/server-core/src/sessions/SessionManager.ts#L2832) 同时做 parity 判定、消息补全和观测写入。只移除 `recordProjectionParity` 调用还会留下 [runtime.ts](../../packages/server-core/src/durable-runtime/api/runtime.ts#L114) 的 evidence 方法、[store.ts](../../packages/server-core/src/durable-runtime/store.ts#L616) 的读写方法，以及类型和 barrel 导出。清理应覆盖这条完整引用链，不能误删 canonical projection 或 `reportLegacyProjectionParity`。

**S2 必须区分事件与附加审计。** [coordinator.ts](../../packages/server-core/src/durable-runtime/coordinator.ts#L765) 在 `agent_settled` 上额外分页扫描事件、读取 ledger，再写派生审计。与此同时，[native-lifecycle-observation.ts](../../packages/pi-agent-server/src/native-lifecycle-observation.ts#L94) 确实会生成该生命周期观测。工作流自造 observation 只说明特定 harness 的限制，不能推导生产永远不产生它。[model-usage-audit.ts](https://github.com/VanDING/Phaneris/blob/1910533062d8c33e1f57b7b58b2eba967bc9914f/packages/server-core/src/durable-runtime/model-usage-audit.ts#L4) 已明确限定为 persistence parity。

**S3 当前有三种口径冲突。** [验证 README](../verification/README.md#L7) 规定日常结果进 `.cache`、历史 results 经显式归档写入；其“档案裁剪”段又规定只保留结论层；[.gitignore](../../.gitignore#L92) 却说全部不提交。不能仅凭 ignore 推断用户已经否定归档政策。另一个现实约束是 [CI artifact 只保留 14 天](../../.github/workflows/validate.yml#L117)，它不能独自替代长期发布证据。历史 manifest 中已经有被裁剪的媒体，不能把“记录了 SHA”说成“完整原始产物仍可下载验证”。

**S4 DDG 引用遗漏不是版本漂移。** [resolve-provider.test.ts](../../packages/pi-agent-server/src/tools/search/resolve-provider.test.ts#L6) 与 [ddg.isolated.ts](../../packages/pi-agent-server/src/tools/search/providers/ddg.isolated.ts#L2) 导入旧别名；原 `bcfbabf6b` 也已有前者。这不会阻止清理，但需保留行为断言，改用 `PublicWebSearchProvider` 后再删别名。公共子路径导出是否有仓库外消费者仍不确定，根包 `private` 不能独自证明不存在外部使用。

**S5 哈希与数量不是改进后的保护。** 计数不变仍可替换关键场景；哈希仍是另一份同步基准，且同提交可以一起改。生成一份 JSON 可以减少手写，却不能增加独立保证。现有 [governance-gates](../../scripts/verification/governance-gates-workflow.ts) 和 [governance-closeout](../../scripts/verification/governance-closeout-workflow.ts) 已实际注入禁用 job、吞错误、缺 artifact 等故障，不能统称为自造问题。另一方面，`check-governance` 部分检查使用命令子串，不能据此证明 shell 真执行了命令；本次未做绕过实测，不把它表述为已复现漏洞。

**S7 不引入第二个 recovery 状态开关。** [host.ts](../../packages/server-core/src/durable-runtime/execution/host.ts#L345) 的 `recoverSession` 先绑定 scope，非 processing 时调用 `refreshRecovery`；后者也检查 scope/processing。因此优先删调用方多余 refresh，让 host 继续拥有完整操作，不增加 `alreadyRefreshed` 标志。第一次尚未绑定 scope 时原显式调用是空操作；已绑定时才产生重复工作，不能说所有 hydrate 都做两次有效恢复。

**S8 不混同别名与配置迁移。** [normalizeConnectionModelId](../../packages/shared/src/config/migrations.ts#L252) 还有 Bedrock ID、Pi 前缀和目录可用性 fallback；迁移链还写连接列表、默认值、workspace 配置和一次性 marker。单参数 [normalizeDeprecatedModelId](../../packages/shared/src/config/models.ts#L99) 不具备这些上下文。已有 [startup migration integration](../../packages/shared/src/config/__tests__/storage-startup-migration.test.ts) 覆盖多类行为，应先盘点缺口，再补配置快照，不能从零再造一套迁移框架。

## 3. P1–P4 的当前处置

| 项目 | 新证据与当前决定 | 何时允许继续收敛 |
| --- | --- | --- |
| P1 mixed-version 去重 | **保留，不能只等版本政策。** [server 握手](../../packages/server-core/src/transport/server.ts#L451) 只比较协议 major；未证明旧客户端被排除。更关键的是 pending slot 还恢复隐藏重试的内容/附件/options（[7163](../../packages/server-core/src/sessions/SessionManager.ts#L7163)），并参与 suggestion/excerpt 清理时机（[8164](../../packages/server-core/src/sessions/SessionManager.ts#L8164)）。 | 明确支持矩阵，并将“重复 RPC 兼容”与“当前重试生命周期”逐用途核对。即使退役旧客户端，也只删可证明独立的兼容分支；保留服务端重试、附件、用户纠正内容及清理语义。 |
| P2 canary/rollback | **保留 emergency rollback；暂不删 canary。** canonical 默认可追溯至 2026-08-27，但开关年龄不是失效证据。v0.5.2 刚修改 canonical 缺失消息恢复，更需要演练。 | 在同一数据副本上验证 canonical、legacy、shadow、匹配/不匹配 canary；记录差异及环境变量实际使用。当前 legacy/shadow 都走非 canonical 选择，文档需如实描述。canary 退役需另有明确“不再支持分批切换”的决定。 |
| P3 critical 成本 | **维持当前覆盖，先映射后退役。** 65 个中有 21 个升级命名工作流，但 usage-ledger、MCP、PDF 等保护的是持续行为。session-foundation 等也通过 package 聚合动态运行。 | 从 registry、package scripts、CI、动态 suite 建完整执行图；使用现有 manifest 的起止时间统计可比运行成本。只有替代工作流覆盖全部独有失败场景后才删除旧入口。 |
| P4 context / decision | **拆成两项。** context accounting 已进入 v0.5.2，`trajectory-context.ts` 正在调用；它保护“总量实测、分类估算、未知余量”的可见语义，当前不列入删除清单。decision layer 默认关闭但可配置启用，缺少净收益证据，暂保留。 | context 只在出现重复事实源或观测误导时重审。decision 用本地可复现样本比较关闭/开启的正确性、额外请求、延迟、费用与失败 fallback；不为此次审计新增遥测平台或上传用户数据。 |

P1、P2、decision layer 的“保留并记录边界”也是有效闭环，不要求为了清理完成率强行删掉。没有生产样本时标记证据不足，不宣布净收益为零。

## 4. 目标约束与实施顺序

采用顺序执行，每批可独立评审和回滚。全面实施的含义是每一项都有明确处置与验收，不是同时推进所有重构，也不是所有项目都必须删除。

必须保持的约束：

- T1 提交前不执行副作用；T1 无 T2 不等于未执行；未知结果不自动重放。
- canonical facts、usage ledger 的权威性，以及 legacy 产品快照中的未迁移历史保全。
- 冷持久化从读取到 enqueue 保持同步；内存刚修改的 metadata 不被磁盘旧值覆盖。
- Pi backend 下各服务商、`pi_compat`、凭据与 endpoint 行为不变。
- 失败退出码继续传播；非零场景、必要产物、SHA 和未测范围继续核验。
- 保留历史证据的来源与裁剪事实；不把重跑结果冒充原历史结果。

| 批次 | 范围 | 依赖 / 风险 | 完成定义 |
| --- | --- | --- | --- |
| R0 基线 | 工具链、当前失败、覆盖图、先行失败矩阵 | 起点；低 | 基线可复现；既有失败单列；未把本规划当作执行授权 |
| R1 生产派生写入 | S1、S2，建议各一提交 | R0；低至中 | 去掉无消费者写入，读安全及 ledger 持久化保持 |
| R2 死路径 | S4 剩余项 | R0；低，导出边界需检查 | 死导出与测试引用一并收敛，必要行为测试保留 |
| R3 恢复收敛 | S7 | R1 后更易审阅；中 | 共享同步 hydration 序列，host 负责唯一恢复入口 |
| R4 backend 分发 | S6 | R0；中，调用面较广 | 单 backend 不再走 registry/循环，连接能力不退化 |
| R5 治理与证据 | S3、S5、P3 | R0 的政策与覆盖盘点；中 | 一份执行定义，必要门禁有效，证据策略一致，退役均有替代证据 |
| R6 兼容与保留项闭环 | S8、P1、P2、P4 | R3/R4 后核对；迁移删除高风险 | 行为快照、兼容政策、回滚演练与保留理由完成；未批准的删除不执行 |
| R7 组合验收 | 全部已实施项 | 各批通过后 | 当前树、构建和平台范围有对应证据；无陈旧文档口径 |

优先 R1/R2 可以快速得到小范围净收益；R3 比 factory 折叠更靠前，是因为它涉及实际恢复重复与字段漂移。R5 不在同一次改动里同时移走全部证据、改 CI 拓扑和删工作流。

## 5. 各批实施规格

### R0：建立可比较基线

1. 锁定实施 commit、现有差异与工具版本，保留用户现有改动；对齐仓库固定 Bun 后执行基线。无需为复核去改依赖锁文件。
2. 本文第 6 节作为先行失败矩阵。复杂行为确有覆盖缺口时，先扩展现有 E2E/集成工作流，再改源码；不在实现后补镜像式单元测试。
3. 既有失败记录命令、错误和证据路径，不能通过降低 minimum、删除断言或批量刷新基线让它消失。确有环境阻断时明确 NOT RUN。
4. 建立一次性的“失败模式 → 当前 workflow → artifact → 调用入口”映射。它是人工审查材料，不新造一份运行时策略清单。

### R1：删除生产派生写入

**S1：** 从 SessionManager 删除 parity 持久化块；删除 runtime evidence API、store 读写方法、无消费者类型和导出、对应表读写测试块。保留旧表 DDL 与已有数据，不在本批做 drop、VACUUM 或数据库版本升级。parity 计算、warn 日志、缺消息修复及 canonical/legacy routing 保持。

验收不是“少了某个函数名”而是：相同事件与快照产生相同消息/恢复状态；不一致仍阻止不安全切换；多次加载不增加 parity 行；旧库能打开，新库能初始化。

**S2：** `recordSdkObservation` 只保存原观测，保留 owning-run/session 校验、去重语义和 redaction。将纯审计逻辑迁至验证侧已有脚本区域，供 usage 工作流复用；生产模块不反向依赖 scripts。工作流在运行结算后通过 `queries.events/usage` 直接计算，现有 `directAudit` 可复用。

同步移除“为了取得审计字段而合成 agent_settled”的测试路径，改写 artifact 中的 attachment/source 描述。SDK 生命周期观测仍单独验证；不要删除整个 coordinator 测试文件。原 helper 的缺失、重复、不匹配、未知计量等有效断言按需要保留/迁移，不能只验证正常情况。

事件查询无显式 limit 时当前 API 调用 `listAllEvents`，实施保持完整读取；覆盖跨 10,000 条分页边界，不把审计搬到测试后悄悄缩成首页。

### R2：完成死代码清理

- 已删三个 atom 只核验无残余导出/引用，不重复改动。
- 删除两个废弃 skill-mention 文件；用 `scale:generate` 更新受影响产物，逐项复核 diff，不接受借机重置全部设计基线。
- 删除三个 null stub 及 barrel 导出，保留 `parseSourceGuide`、domain 提取等仍有效函数。
- 删除 test-only TTL 升级 helper 及仅测试该死功能的用例；保留 SDK-owned prompt cache 行为断言与网络 sanitization。
- 删除 fast-mode 注入分支、仅供它使用的 helper、常量与 flag 引用。其余 feature flags、beta header 清理、缓存空文本清理保持。
- `modelEntryForDefault` 直接内联恒等值，不更改迁移顺序。
- 将两个 DDG 测试文件改用真实类名，运行原 resolver/isolated 验证后再删兼容 alias。

清理前核对动态导入、package exports、构建入口及脚本引用；零静态 import 是证据之一，不作为所有导出安全删除的充分条件。

### R3：收敛 hydration 与 recovery

1. 先独立删除 `applyDurableRecoveryStatus` 开头多余 `refreshRecovery`，保留 `recoverSession(scope)` 的 scope 检查和 processing guard；用恢复工作流证明无副作用重放。
2. 再抽取被两个调用者复用的同步恢复方法，显式区分 `cold-persist` 与 `lazy-read`。方法内部保留消息转换、pending plan、durable 恢复、usage、metadata、queue 的现有相对顺序。
3. 冷模式的延迟字段仅在内存为 `undefined` 时填补；热模式保持现有字段同步条件。`false`、空字符串、空列表与 `undefined` 不能混同。
4. `messagesLoaded`、promise 去重、无 stored session 的处理均保持原契约；不引入 async 冷加载、可组合 pipeline、策略 registry 或 `alreadyRefreshed` 参数。

字段差异先写成一张所有权对照，再迁移代码。若发现现有行为缺陷，单独记录和修复，不能悄悄夹带在“等价重构”中。

### R4：折叠单后端分发

先移除无消费的 availability 导出、单元素循环与无效 provider guard；再让 factory 直接调用 `piDriver`，更新受影响参数与导出。统一 backend 常量放在现有模块，不新建 provider 管理层。

`ProviderDriver` 是否保留由其隔离构建/路径/模型发现职责决定，不以实现个数决定；不为删接口而把 Pi 内部实现搬进 SessionManager。`AgentProvider='pi'` 在协议/存储中的标识无需同时删除或迁移。

必须保留连接模型列表约束、默认模型 fallback、兼容 endpoint 协议、API key/OAuth/environment 语义、Bedrock 等服务商配置、自定义模型 capability 以及打包 runtime 路径。未知外部配置继续在真正边界处理，不能因 TypeScript 联合类型只有一个成员就假定磁盘/RPC 输入永远合法。

### R5：单一清单与统一证据政策

**R5a：单一执行定义。** 以现有 `critical-scenarios.ts` 为唯一手写执行清单，继续维护 workflow id、入口、场景下限、必需产物、测试 group 与 native 分类；删除同构 policy JSON 及 deepEqual。先保持 65/6/2 的覆盖和现有 CI job id 不变。

保留 registry 的入口存在、id 唯一、非零场景、产物与 SHA 等实际约束；保留 CI 的错误传播、触发范围、所需平台、运行时供应与证据上传。可将重复 shell 操作收敛到明确的入口脚本，避免新增通用 shell 解析器。展示名称/排版无需逐字锁定；安全相关 action pin 和确有意义的条件继续验证。job id 可能被远端 required checks 引用，未核对远端设置前不重命名。

删除双份清单意味着不再自动检测“开发者同时删掉定义与预期”的所有情况，这一点须明确接受；同提交双清单本来也不能提供独立审批。确需独立复核时再配置真实 reviewer/branch rules，不能只加 CODEOWNERS 文件就声称已受保护。本方案不更改远端规则。

现有治理负例同步迁移：无效入口、重复 id、空场景、缺产物、禁用执行、吞退出码、失败无证据仍应失败。增加正常重排/展示名称变化的正例。移除只证明双清单不一致的负例，但保留它原本保护的独有行为覆盖。

**R5b：证据政策建议。** 延续已有显式归档意图，划清日常运行与历史结论：

| 证据类别 | 建议归属 | 保全规则 |
| --- | --- | --- |
| 日常完整运行 | `.cache/verification/<unique-run>`；CI artifact | manifest、命令、HEAD/dirty 源哈希、运行时、场景、结果、未测项及 artifact SHA |
| 发布/审计结论 | Git 中的简洁结论、来源和索引；完整包存显式长期归档位置 | 需要长期可下载时先确认存储落点与访问，不依赖 14 天 artifact |
| 现有裁剪历史 | 冻结原 manifest/SHA/结论，显式标记缺失原始产物 | 不回填伪造文件、不更改原 SHA、不把新跑结果替换成旧证据 |
| 临时或被替代运行 | 按引用与唯一性核验后退出跟踪 | 先有保全清单和可检索落点，再取消跟踪；保留本地文件 |

先统一 `.gitignore` 注释、验证 README 和脚本默认输出；把保留的结论放到可明确跟踪的位置，或用清晰、窄范围的 ignore 例外，避免长期靠 `git add -f`。

对 1,733 个文件建立旧路径、用途、引用、是否唯一、实际存在、SHA、目标位置、保留决定的迁移清单。归档后核对文件数/字节/SHA、下载或本地恢复能力，再修文档链接和 `doc-artifact-exceptions.json` 中受影响项。部分历史条目已经缺原始媒体，列为“结论保留/原物缺失”，不要求不可能完成的完整归档验证。

取消跟踪前提交具体保全摘要；不执行历史重写或把 `git rm --cached` 说成缩小已有 pack。当前用户只要求规划，本次未取消任何文件跟踪。

**R5c：覆盖与成本收敛。** 先从已有 manifest 的 `startedAt/finishedAt` 提取同环境耗时，再核对执行图。升级命名可在确有持续职责时改成行为名；迁移与删除必须保全场景、artifact 消费者和文档引用。跨场景的独立失败不能因共享 fixture 就合成一个虚假的计数。没有可比样本时只报告未知，不按“65 太多”设删减目标。

### R6：迁移与保留项闭环

**S8：** 先复用启动迁移集成测试，在临时配置目录保存输入、第一次启动输出、第二次启动输出及 workspace 配置差异；固定当前目录/依赖版本。列出每个 phase 的输入形态、写入字段、幂等性和依赖。

新增纯模型别名优先走读边界，但仅限确认语义等价、provider/endpoint 适用的映射；不要把模型换代自动视为别名。结构变更、凭据/transport 修复和数据保全仍可需要迁移，必须单独说明目的。现有 phase 只有在最老受支持配置仍能正确升级、补偿行为不再需要且差分验证通过后才能退役。不能仅凭模型停止供应就删除其历史配置修复。

**P1/P2：** 补充当前客户端兼容与 session read 运行说明，演练重试/回滚场景。保留默认行为，不在此批取消旧客户端兼容或移除环境变量。

**P4：** context accounting 标记为“当前有明确产品职责，保留”；验证现有 integrity 场景即可，不重做归因算法。decision layer 的收益分析单列结果与未测项；如没有真实代表样本，本轮以证据不足关闭删除提案，保留后续重新评估条件。

## 6. 先行失败矩阵与验收产物

下面是实施前必须落实的覆盖清单；优先复用现有 workflow，缺项先写失败场景再改生产代码。不是要求给每个删除动作新增单测。

| 范围 | 必须失败或保持的边界 | 验收产物 |
| --- | --- | --- |
| S1 | parity 一致；缺失 legacy 消息；product-only 历史；超前 cursor；projection 失败 fallback；重复 hydrate 不写观测 | 前后消息/路由对照，SQLite parity 行数/内容对照，分歧输出 |
| S2 | 成功、retry、重放不重复计量、零/未知、abort、compaction、恢复、缺行/重复/不匹配；跨分页边界 | ledger 与 outcome 对照、验证侧 audit JSON、正常 SDK observation |
| S4 | mention 新入口正常；旧导出无真实消费者；SDK 缓存与 sanitizer 不变；search resolver fallback 不变 | 现有行为结果、typecheck/build 结果、受控生成基线 diff |
| S7 | 首次未绑定/已绑定/正在 processing；冷会话改名/标签/来源后 persist；外部 metadata；false/空值；并发 lazy load；恢复队列；T1 无 T2；迟到 T2 | 前后 session JSONL、runtime DB、消息/usage/queue 对照；副作用执行次数 |
| S6 | 默认连接、显式连接、失效 managed model、pi_compat、自定义模型/endpoint、凭据缺失/不同认证、打包路径 | loopback 请求与解析结果、模型选择对照、runtime 构建/启动产物 |
| S5 | 关键命令停用、吞错误、缺工具链、缺 browser/native、空场景、缺 artifact、缺 SHA；合法显示名称/顺序变化可通过 | 负例退出码与日志、正例结果；无变化 registry 覆盖对照 |
| S3 | Git 结论链接完整；归档 SHA 对应实际文件；完整包可恢复；裁剪历史真实标注；普通运行不修改已跟踪结果 | 迁移清单、恢复核验、文档门禁、运行前后 Git 状态 |
| S8 | legacy provider、无/已有 llmConnections、modelDefaults、Bedrock fallback、pi 前缀、custom endpoint 不误改、用户模型子集、marker 有/无、用户主动移除模型、第二次启动幂等 | 配置输入/输出快照、字段差分、第二次运行稳定性记录 |
| P1 | server timer/legacy RPC 两种顺序只续接一次；附件与纠正内容保留；用户新消息抢先；失败清理可见 | source activation E2E、消息与执行事实 |
| P2 | canonical/legacy/shadow；canary 匹配与不匹配；坏投影/有分歧；回滚不清掉历史 | 各路由输出与同一原始数据副本对照 |
| P4 | 实测总量与未知余量不被伪精确分摊；decision 关闭不发附加请求；启用失败有 fallback | 现有 integrity 产物；有样本才提供 decision 成本/收益对照 |

验证入口使用当前已有能力：

| 批次 | 主验证入口 |
| --- | --- |
| R1 | `verify:session-foundation`；`scripts/verification/upgrade-0153-usage-ledger-workflow.ts`；现有 durable store/coordinator/parity 相关测试 |
| R2 | 相关既有 search/interceptor/mention 验证；`typecheck:all` 与相应 lint/scale；受影响生产构建 |
| R3 | `verify:session-foundation`；durable-runtime boundary/crash/pi；`pi-interruption-recovery-workflow.ts`；已有 cold-session metadata 回归 |
| R4 | `model-harness-pi-workflow.ts`；`upgrade-0153-endpoints-workflow.ts`、`upgrade-0153-b1-workflow.ts`；已有连接与模型测试；`build:smoke` |
| R5 | `check:governance`、`test:critical --preflight`、治理 gates/closeout、`check:docs`；变更后的完整 critical 和对应 CI 平台执行 |
| R6 | 现有 startup migration integration；`config-domains-workflow.ts`；`source-activation-settlement-workflow.ts`；`run-context-integrity-workflow.ts`；按矩阵补充的 rollback 演练 |
| R7 | `validate:ci`、`test:critical`、`validate:full`、`build:smoke`，结合 CI 执行受影响平台原生项；同一最终 HEAD 已完成的检查不重复跑 |

所有 workflow 位于 `scripts/verification/`。Pi E2E 使用与源码匹配的已构建 runtime；测试产物写新的唯一目录，禁止覆盖旧验收。独立 mock/isolated 测试保持原进程隔离。全量验证依赖和平台不可用时如实标注，不把静态检查或 loopback 结果说成真实 provider/签名安装器通过。

## 7. 回滚与完成标准

| 变更 | 回滚边界 |
| --- | --- |
| S1/S2 | 每项独立提交；旧表、旧事件 payload 保留。回滚代码可恢复未来写入，不能补回停写期间没有产生的观测。 |
| S4/S6 | 源码与导出机械变更一并恢复；不涉及用户配置重写。 |
| S7 | 恢复调用精简和 helper 提取分开提交；出现消息/队列/metadata 差异立即回到上一行为，不靠新兜底分支遮盖。 |
| S5 | 单一清单迁移与 CI 门禁调整分开；先保留原覆盖数和 job id，便于定位。 |
| S3 | 先验证归档，再取消跟踪；保留迁移映射和原提交引用。不强推、不清理 Git 历史。 |
| S8 | 本轮不删迁移；未来迁移变更需用户配置与 workspace 备份，单纯回滚二进制不能保证撤销已写配置。 |

完成标准：

1. S1/S2 的派生生产写入及无用 API 已退出，必要 parity/ledger/observation 行为保留。
2. S4 剩余死路径清理完成，无失效测试导入、barrel 或生成清单；三个 atom 不重复记功。
3. S7 公共恢复序列只有一份；S6 单后端 dispatch 收敛，所有连接语义保持。
4. S5 一份手写 registry，真实保护仍能拒绝故障；S3 政策、跟踪状态、归档与链接一致。
5. S8、P1、P2、P4 均有明确保留/退出条件；P3 每个退役条目都有可核对的覆盖替代。证据不足的项目不包装为完成删除。
6. 受影响行为及最终组合验证有当前 HEAD、命令、来源哈希、产物与未测项。不得通过少跑关键场景来达到“减少复杂度”。

## 8. 本次复核实际执行结果

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| `bun run scripts/check-governance.ts` | 通过：13 workspace、4 tooling project | 当前治理接线满足已有静态约束 |
| `bun run scripts/test-critical.ts --preflight` | 通过：65 workflows、6 groups | 注册入口存在；不代表场景执行通过 |
| registry/policy 只读比较 | workflows 内容相同；另有 2 native，21 个 critical 为升级命名 | 确认重复表示与当前规模 |
| `bun run check:docs`（写方案前） | 通过：218 份受门禁管理文档、1,603 个相对链接 | 当前文档门禁基线；该口径不等于整个 docs 目录文件总数 |
| `bun run check:docs`（加入方案与索引后） | 通过：219 份文档、1,625 个相对链接 | 新交付物链接与索引可达性通过 |
| `git diff --check` | 通过 | 已跟踪文件差异无空白格式错误 |

以上轻量检查运行于本机 Bun 1.4.2。未执行完整产品测试、真实 provider、远端 CI、性能采样、证据迁移或数据库变更。本次交付为该评估方案与文档索引，不代表源码治理已经实施。
