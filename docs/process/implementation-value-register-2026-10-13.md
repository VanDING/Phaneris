# 规划价值裁定与实施台账

状态：accepted — 2026-10-14 R01–R07 已实施；C02 的生产 WebUI 与浏览器专项已通过本机 Windows 验收。其余条件项与发行门槛按下表保留。

价值裁定基线：2026-10-13 本地 `main`，`22ebef6ef`，Phaneris 0.3.1 / Pi SDK 1.1.0。2026-10-14 按用户授权完成 R01–R07，并补修回答中的本地文件链接。实施基线为 `19e730ffe` 的未提交工作区；[验收记录与源码/构建摘要](../verification/results/implementation-r01-r07-2026-10-14/README.md)绑定实际运行内容。本轮执行相关 E2E、生产构建和静态门禁；`test:critical` / `validate:full` 全量组合未运行。

**本文件是实施裁定、收口状态与后续条件事项的唯一当前入口。** 已接受的架构、制作指南、所有权清单和验收规范继续有效；历史规划中的“下一步”、工期、OPEN 和旧版本缺口不再自动生成待办。

## 1. 裁定依据

| 依据 | 采用方式 |
| --- | --- |
| 明确收益 | 优先减少未经明确授权的执行、资源不一致、数据丢失和日常操作障碍；收益必须能由同一真实流程的前后结果验证 |
| 现有能力 | 先复用权限管线、Runtime 事实、TaskRunner、Artifact 和既有验证框架；已落地能力只补缺口 |
| 实施成本 | 保留边界清晰的工作包；没有真实消费者、性能归因或稳定契约的扩展退出当前队列 |
| 证据强度 | 源码缺口与历史验收欠账分别标明；未知的质量、成本和性能收益留空，不用推测数字排序 |
| 关闭语义 | 关闭的是当前规划承诺与投入。已实现能力、用户数据、已有保护和发布前置条件继续保留 |

下列顺序保留原批准的实施安排，七项已按各自边界收口。责任列表示实现职责，未虚构个人负责人。

## 2. R01–R07 实施结果

| ID | 顺序 / 职责 | 已实施的工作 | 明确收益 | 收口状态与边界 |
| --- | --- | --- | --- | --- |
| R01 | 第一批 / Task 与权限 | 无人值守权限必须显式声明，移除缺省 `allow-all` | 手写或旧任务省略配置时不会静默扩大权限 | 已实施；[TaskRunner](../../packages/server-core/src/tasks/TaskRunner.ts) 在新建/恢复派发前检查全部节点；[9 项场景通过](../verification/results/implementation-r01-r07-2026-10-14/task-permission/scenes.json)。显式 `allow-all` 保留 |
| R02 | 第一批 / Plugins、Sources、会话 | 插件执行来源、确认、校验与可用状态一致 | 用户确认的包就是执行的包；减少安装成功后能力不可用、读到不同 skill 的问题 | 已实施；[原生 roster](../../packages/shared/src/plugins/plugin-context.ts)、[一次性确认](../../packages/shared/src/plugins/confirmation.ts)、统一物化校验及 readiness；[17 项一致性场景通过](../verification/results/implementation-r01-r07-2026-10-14/plugin-consistency/plugin-consistency.json)，既有事务 13 项通过。F05/F09 本地关闭 |
| R03 | 第一批 / Workspace、Runtime、客户端验证 | 备份恢复与正式构建中的关键真实流程验收 | 证明已有保护能恢复实际工作材料，避免将 build/smoke 当完整运行验收 | 本地 Windows 已通过；[恢复 10 项](../verification/results/implementation-r01-r07-2026-10-14/workspace-recovery/workspace-recovery.json)、[生产桌面 27 项](../verification/results/implementation-r01-r07-2026-10-14/native-client/native-client.json)、独立 crash 8 项。恢复路径重定位与文件链接已补修；发行平台矩阵仍由 C01 约束 |
| R04 | 第二批 / Runtime 观测、Task、Run | 保守循环观察与最小本地可靠性报表 | 在用户停止任务前提供可核查的重复错误、重复动作、未决效果和预算事实 | 已实施；[报表构建器](../../packages/server-core/src/observability/reliability-report.ts) 由保留事实重建，Run 内解释/导出；[10 项场景通过](../verification/results/implementation-r01-r07-2026-10-14/summary.json)。unknown 费用与用户接受状态保持显式；不自动干预 |
| R05 | 第二批 / Task、工具执行边界 | 并行任务的写入范围声明、冲突检查与保守串行 | 避免共享目录中的并行子会话覆盖同一文件，适用于文档与代码任务 | 已实施；[file_scope](../../packages/server-core/src/tasks/file-scopes.ts) 规范化路径、协调同 Host 的 Runner，并冻结恢复声明；[11 项场景通过](../verification/results/implementation-r01-r07-2026-10-14/task-file-scope/task-file-scope.json)。属于声明式调度契约，不构成 OS 沙箱 |
| R06 | 第二批 / Project Management | 甘特图普通任务拖拽改期与键盘替代 | 在时间轴就地调整排期，减少反复打开任务编辑器 | 已实施；[GanttView](../../apps/electron/src/renderer/components/app-shell/kanban/GanttView.tsx) 允许普通叶任务移动、缩放及键盘改期；[14 项浏览器场景通过](../verification/results/implementation-r01-r07-2026-10-14/gantt-reschedule/gantt-reschedule.json)。汇总/里程碑与高级字段边界保留 |
| R07 | 第三批 / 应用内帮助与 i18n | 中文应用内帮助 | 让中文界面中的权限、任务、恢复和文件操作有一致的说明，减少依赖英文或口头解释 | 已实施；[manifest](../../apps/electron/src/renderer/docs/manifest.ts) 注册 `en` / `zh-Hans`，完整 47 页中文及导航/搜索；[52 项浏览器场景通过](../verification/results/implementation-r01-r07-2026-10-14/docs-locale/docs-locale.json)。英文和原 slug 继续可用 |

以下退出条件为本轮的验收约束；具体运行目录、源码/构建 SHA、断言与未测范围见[统一证据](../verification/results/implementation-r01-r07-2026-10-14/README.md)。相关实现已纳入 v0.3.2；历史验收记录继续保留当时的源码与构建摘要。

### R01：显式无人值守权限

- **范围**：节点与 Task 默认模式按现有优先级解析；缺少声明时阻止启动并给出配置位置。已有显式 `allow-all` 作为用户选择保留；未配置任务不得因迁移被自动赋予它。
- **复用**：[现有权限配置](../../packages/shared/src/agent/permissions-config.ts)、[会话授权记忆](../../packages/shared/src/agent/core/permission-manager.ts)、[限制性工具规则](../../packages/shared/src/agent/core/tool-call-rules.ts)。不恢复第二套批准权威。
- **退出条件**：省略、继承、显式声明、旧任务重启均有 E2E；阻止的任务不派发子会话；规则阻断不能被 codemode 或显式执行模式绕过；已有明确配置的任务行为保持。
- **关闭的扩展**：通用 capability-envelope 平台、跨会话“始终允许”的自动持久化、权限继承系统与 OS 沙箱建设。出现具体需求时重新设计授权边界。

### R02：插件一致性

- **F04**：插件名单消费物化后的原生 skill；修改包内副本未重装时不改变实际执行内容。缺失物化项显式报告，PROMPT 的即时生效语义单独保留。
- **F06**：分析生成 workspace 绑定的一次性确认计划，绑定暂存包内容及目标资源前置状态；安装与卸载拒绝过期、跨工作区、重复消费或内容变化的确认。
- **F07/F10**：解析、可物化贡献、安装计划、执行与 DTO 使用一致的校验结果；区分已激活、未物化、待配置/认证、未连接和缺少执行文件。取消激活的现有 source 驻留语义先写明，不悄悄改变。
- **F05/F09 收口**：Windows 路径占位符与普通 URL/JSON/正则参数分开解析；健康插件元数据及原生资源变化会刷新消费者。已纳入 17 项一致性场景，本地验收关闭；外部账号连接仍不由安装状态推断。
- **退出条件**：同一 skill 从两入口读到相同字节；确认后修改包/目标、并发操作、安装中断和卸载当前 provider 的真实临时工作区场景可复现；配置错误在写正式资源前可见。保留路径、回滚、凭据提交与共享 provider 的既有保护。
- **关闭的扩展**：URL/归档对话式导入、市场、自动更新、兼容性认证平台、永久安装注册表，以及 source 启用来源/手动禁用优先级的行为改造。当前目录安装入口先修正确。

### R03：恢复与真实流程验收

- **范围**：从脱敏的代表性桌面工作区副本验证 backup → verify → restore → 启动；核对 Session、附件、Artifact revision/checkout、配置和 Runtime 引用。损坏与中断恢复不能覆盖原工作区或重放未知效果。
- **运行验收**：复用现有 native-client、Runtime crash、主题及客户端平台工作流；先核对现有覆盖，再补正式构建中的 T1 无 T2 停放与 Run 可见性、断线/重连、草稿、Artifact 保存/接受，以及长会话下主题切换与工作台交互的未覆盖项。
- **补修结果**：恢复到新目录时，仅重定位活跃 Session、Artifact、工作目录与本地 source 的所属路径。回答中的文件链接保留清洗前目标、恢复 CommonMark 吞掉的 Windows 分隔符并避免重复解码；18 项浏览器场景及生产桌面六种路径逐次打开真实文件通过。个人工作区未用于测试。
- **退出条件**：证据绑定源码/构建摘要、环境、断言、必要截图/trace 和 SHA；明确 PASS / FAIL / NOT RUN。已有通过项不为凑数量重复实现；新失败才扩大修复。
- **平台范围**：当前有本地 Windows/macOS 构建和不同范围的原生证据，不能据此宣称三平台完整验收。物理触摸、移动 Safari、签名安装器和发布平台矩阵由 C01 的目标支持范围决定。
- **关闭的扩展**：新增一套备份、全量数据治理仓或通用验证框架；逐条追求历史动效矩阵所有 P 项清零。只补现行关键路径与宣称支持的能力。

### R04：循环观察与事实报表

- **范围**：先记录相同规范化动作重复、相同错误重复等可证明信号；合法轮询、SDK 重试、压缩与恢复单独归类。报告直接来自宿主已提交事实，不由辅助模型判定“没有进展”。
- **最小报表**：运行终态数量、未决 T1 数量与最老等待时长、已有 Token 预算用量；在现有 Run 入口解释或导出。缺失的历史证据列为 unknown。
- **退出条件**：固定重复/正常样本可复跑；观察失败不改变执行结果；重启后的同一范围报表可确定性重算；费用未知不能算作零。
- **统计边界**：`completed` 终态、无未决副作用与用户接受是不同事实。没有统一用户接受记录时，不发布“可验证完成率”；先交付有明确分母/范围的事实统计。
- **关闭的扩展**：自动 nudge/park、通用 Goal 熔断与节点三维预算系统、工作区健康 Dashboard、20–50 场景通用 Agent 评测台。Prompt/模型变更继续使用对应功能的固定验收与既有验证台账。

### R05：并行写入冲突防护

- **范围**：节点声明读/写范围；相交写入在派发前拒绝或串行。无法证明安全的共享可写目录按保守串行处理；读任务保留可解释的并发。
- **退出条件**：相同路径、父子目录、Windows 大小写、符号链接/重解析点别名、缺省范围和重启均有失败场景；不能用改写声明掩盖真实冲突；声明与当前允许的执行路径保持一致。
- **边界**：范围声明首先是调度契约，不能作为 OS 安全隔离宣传。Git worktree 不作为文档、非 Git 工作区或每个子会话的前置条件。
- **关闭的扩展**：worktree 生命周期平台、全部 13 种节点、审批路由、独立 judge/verify 节点与多代理控制平台。现有编排者验收/repair 已覆盖基本闭环；有无法表达的实际流程再立项。

### R06：甘特图就地改期

- **范围**：普通可编辑任务只接受开始/截止变更，复用共享日期转换与现有写入入口；派生汇总范围不作为普通任务拖动。提供同一写路径的键盘替代、保存反馈与失败回滚。
- **退出条件**：含末日、单日/跨月、带时间值与 DST 不漂移；不存在的 DST 本地时刻拒绝保存；保存失败、拖拽取消、广播竞争、过滤隐藏与键盘操作不丢修改；其他投影读到同一 Session 规划值。
- **关闭的扩展**：时间轴内依赖/进度编辑、关键路径/PRO、基线、资源视图、泳道、议程视图、iCal、PNG/PDF/Excel 导出，以及水平边缘自动翻周。已有任务编辑器继续承载高级字段。
- **性能边界**：单一日历投影、范围查询、广播增量化与共享头部整套重构仅保留 C02；不会因旧方案写过阶段 2 就自动启动。

### R07：中文帮助

- **范围**：翻译当前 manifest 注册的完整帮助集合及导航文案，沿用现有 slug、内容编译和 locale 完整性检查。权限、任务、恢复、Artifact/文档工具优先审校；上线一个 locale 前保证注册页面齐全。
- **退出条件**：中文界面进入帮助得到中文导航与正文；所有 slug/深链可用；无过期供应商、上游服务或已退役功能承诺；英文路径继续可用。
- **关闭的扩展**：本轮新增其他语言、重做文档平台、专门的帮助后台和手工维护另一份页面清单。

## 3. 条件触发项（不占当前实施队列）

| ID | 事项 | 唯一重新立项条件 | 触发后允许的最小范围 |
| --- | --- | --- | --- |
| C01 | 对外发行、签名与受支持平台验收 | 明确决定向开发团队以外分发二进制，并确定平台/架构、发布者与所需凭据 | 按第 4 节逐项关闭发布门槛；GitHub Releases 等自有渠道可承载首发，无须为可为空的服务先搭全套云平台 |
| C02 | 日历/工作项投影与广播性能 | 原触发条件为同机样本违反现行预算；2026-10-14 用户明确授权实施 | 已完成共享读取和 SessionManager 单一广播入口；1,000 条样本中挂载读取 2→1、单改读取 4→1。预算内完成最小优化，范围查询继续关闭；[实测与验收](../verification/results/c02-planning-performance-2026-10-14/README.md) |
| C03 | 上下文预算、更多延迟工具与压缩参数 | 代表任务的 prompt/schema 测量证明现有工具面或压缩策略造成可复现的成本/成功率问题 | 只修改被证明有问题的工具集合或参数；比较原缓存/权限/恢复契约，不做 SDK 参数全覆盖 |
| C04 | 通用旧数据导入引擎 | 实际外部用户需要跨机器/冲突导入，或产品明确承诺支持旧应用数据迁移 | staging、恢复状态机、冲突报告、凭据兼容与自动化暂停；本机一次性脚本不冒充通用引擎 |
| C05 | 自动续写或自动 reconciliation | R04 的真实报告证明 length 停止或停放效果持续阻碍任务，并有明确预算/恢复目标 | 分别设计有界续写或具体 effect 的 reconciler；另立 ADR、失败矩阵、迁移与回滚，绝不自动重放未知副作用 |

除已明确授权并收口的 C02，其余条件项没有满足触发条件时保持关闭；重新评估须带具体场景和可核查证据。旧文档中的条件或“远期可做”不能绕过本表。

2026-10-14 C02 已按[实施前失败矩阵](../verification/c02-planning-performance-failure-matrix-2026-10-14.md)完成：日历从共享 WorkItem 投影派生，同工作区消费者合并读取，迟到响应保留成功写入；SessionManager 合并广播并补齐原生归档/取消归档通知。51 项浏览器场景通过，现行预算保持；单改响应字节由 3,574,032 降为 1,216,199（约减少 66%）。三次暖切换均在原 2,000ms 预算内，不宣称普遍延迟下降；没有依据继续投入范围查询或日期索引。Session 仍是唯一持久事实来源。源码、构建、原始样本与未测范围见同一验收记录；相关实现已纳入 v0.3.2；历史验收记录继续保留当时的源码与构建摘要。

## 4. 对外发布的 15 项前置门槛

以下迁自[发布检查历史快照](../archive/release-readiness-2026-10-13.md)，不因归档被取消。L01/L02 的本地 Windows 能力证明已在 R03 收口；其余门槛及其他目标平台由 C01 触发相应发布流程。没有运行的目标平台保留 NOT RUN。

名称、命名空间与商标的外部归属核查沿用身份记录中的未验证状态；取得证据前不宣称归属已确认。代码身份独立与外部发布权属分别核验。

| ID | 门槛 | 放行依据与本轮状态 |
| --- | --- | --- |
| L01 | 真实桌面工作区备份/恢复演练 | 本地 Windows 通过：代表性合成工作区对象/引用/摘要核对、恢复后生产桌面启动与 Artifact 接受；原工作区摘要保持。其他发行目标保留 NOT RUN |
| L02 | T1 后、T2 前真实恢复演练与 Run 可见性 | 本地 Windows 通过：正式构建停放无 T2 的效果，Run 展示/导出与事实一致；配合独立进程 crash 8 场景。其他发行目标保留 NOT RUN |
| L03 | 自有更新 feed 与发布存储 | 归属与可信元数据核验；空配置无上游 fallback |
| L04 | 自有支持、安全与文档入口 | 自有仓库 URL 可满足适用入口；可选云服务为空时明确不可用 |
| L05 | 各发行平台签名/公证身份 | 发布者归属与可用凭据；unsigned 开发包不算完成 |
| L06 | 发布说明与回退政策 | 同版本产物、数据兼容、升级失败与应急修复说明 |
| L07 | 干净机器构建与安装器体积记录 | 无开发机缓存前提的可复现构建与资源检查 |
| L08 | 生成 SHA256SUMS 与 release-manifest | 现有 `release:checksums` 命令对实际最终产物输出完整清单 |
| L09 | 安装器签名验证 | 对所选平台实际产物运行对应验证工具 |
| L10 | 安装器旁发布摘要清单 | 下载源、版本、架构和摘要一致 |
| L11 | release job 的 SBOM/provenance | 实际发行任务接线与可下载产物 |
| L12 | 安装、升级、回退 | 每个宣称支持的平台/架构的真实流程；未测平台不得标正式支持 |
| L13 | 卸载保留数据与重装识别 | 同一 profile 的卸载/重装事实与数据摘要 |
| L14 | 遥测说明与本地诊断导出 | 用户可见说明、默认关闭事实与脱敏导出 |
| L15 | 产物/日志敏感内容核验 | 无 provider token、真实 workspace 内容或未声明诊断材料 |

已实现的备份命令、Vault token 迁移、TLS 默认校验、依赖审计门禁、独立应用身份、打包过滤及默认关闭遥测继续有效。Windows 产物检查/启动 smoke 和 macOS unsigned 包记录是现有证据，不扩展解释为干净构建、签名或升级通过。

## 5. 关闭与撤出当前队列的规划

| 事项 | 裁定 | 理由 / 重新考虑边界 |
| --- | --- | --- |
| 完整编排 2.0、全部控制节点、多代理审批路由 | 关闭；保留 R05 | 现有 session DAG 与编排者验收已可工作；一次扩展多种恢复/权限语义缺少实际流程需求 |
| 完整无人值守预算/Goal/自动干预平台 | 关闭；保留 R01/R04 | 已有任务预算、超时和失败验收上限；先提供事实与观察，尚无自动干预质量证据 |
| 通用 Agent 评测台与用户接受完成率 Dashboard | 关闭；保留 R04 | 通用语料维护和额外模型费用没有明确回归对象；接受事实尚未统一，不能制造完成率 |
| 独立 Agentic 管理界面、结果改写、input transform、压缩 veto | 关闭 | 工具阻断与 unsupported 历史已实现；新增介入面增加事实/授权边界，暂无具体失败驱动 |
| 跨会话授权资产平台与 OS 沙箱 | 关闭 | 当前配置与会话范围授权已存在；先补确切的默认授权缺口，不扩展安全叙事 |
| 插件外部导入、市场、自动更新、最小安装注册表、作者生态平台 | 关闭；保留 R02 | 当前目录安装正确性仍需补齐；新入口和永久状态会放大未闭环问题 |
| Pi 原生 MCP 全面替换、Radius 默认路由、classifier 默认替换 | 关闭当前迁移计划 | 现有受管接入有效；对照尚未证明 OAuth/恢复/质量/成本等价或收益。后续升级需求另做评估 |
| 外部 Agent 控制面与第三方插件行为钩子 | 关闭 | 现有 CLI/RPC/消息入口已覆盖当前场景；新增危险控制面尚无真实消费者与信任设计 |
| 原生前端 GPUIX/gpui-kit 迁移及相关 spikes | 关闭 | 大范围重建既有交互与平台能力，缺少可验证净收益；既有 frontend/包体治理继续有效 |
| Native Design Layer、Office 商业引擎、Univer 后续路线 | 关闭 | 通用文件 Artifact/原生图片生成已实现；Univer 已退役，不恢复依赖或迁移器 |
| 新记忆系统 | 关闭占位 | 未形成批准的方案与现有能力映射，不能把参考项目清单当实施计划 |
| Profile 复制/分享/图片与 Markdown 导出、独立统计仓与能力榜单 | 关闭 | 本机个人中心已满足当前范围；缺乏日常流程收益与明确隐私/保留策略需求 |
| 甘特依赖编辑、关键路径、基线、资源视图、导出；日历议程/iCal | 关闭；保留 R06 | 先修直接排期操作；高级字段已有任务编辑器，无采购或复杂投影需求证据 |
| 全仓统一头部、所有视觉债务与所有 warning 清零 | 关闭目标 | 已有具名 owner、例外、ratchet 和关键交互验收；数量清零本身不证明收益 |
| main.cjs 必须到 15 MB、继续拆 renderer/katex | 关闭固定体积目标 | 当前有实际构建预算和回归门禁；未证明新增构建架构或异步渲染风险值得。性能回归按归因修复 |
| System prompt 全量重排、哈希快照/IPC 去重 | 关闭历史建议 | 历史估算不是当前收益实测；已有稳定/volatile 与完整轨迹契约。仅 C03 的真实问题可重新立项 |
| Runtime batch 表、通用资源 DAG、workspace 事务、分布式 leases/fencing | 关闭当前目标态投入 | 单 Host 与 child effect 事实已满足当前边界；没有实际多 owner 或恢复/吞吐问题时不增加基础设施 |
| Runtime 兼容转录全面退役、Run Compare/Replay 与完整产物血缘图 | 关闭当前扩展 | 现有 Runtime 权威、投影、Run Inspector/Map 与 Artifact provenance 已可检查；退役必须先有一致性与独立收益证据 |

关闭不修改已接受 ADR 的不变量，不放宽任何现行安全/依赖/身份/视觉门禁。发现实际正确性缺陷时直接记录事实，不等待远期架构计划激活。

## 6. 已完成与文档滞后项

| 旧描述 | 本轮源码/记录裁定 | 当前处理 |
| --- | --- | --- |
| Agentic“实施未开始”、silent no-op | [工具规则](../../packages/shared/src/agent/core/tool-call-rules.ts)、[原生 hook](../../packages/pi-agent-server/src/phaneris-resource-loader.ts)、[unsupported 历史](../../packages/shared/src/automations/automation-system.ts) 已存在 | 关闭已实施首片；扩展按第 5 节关闭 |
| Task 无预算、只做静态工具 | Token 预算、超时、`max_no_progress`、tool_search/codemode 已采用 | 不重新实现，缺口只进入 R01/R04/R05 或 C03 |
| 日历“只完成阶段 0” | [多轮实施记录](../archive/calendar-gantt-implementation-status.md) 含 FullCalendar、状态持久化、编辑器与门禁 | 已完成阶段关闭，剩余缩小为 R06/C02 |
| 主题“仅 W1”、W2–W5 待做 | [W2–W5 本机记录](../verification/results/theme-governance-w2-w5-2026-10-12/README.md) 已完成实现与本地验收 | 工程计划关闭；证据边界由 R03/C01 承接 |
| 依赖 §8 未采用、架构治理尚未开始 | [治理台账](governance-completion-2026-10-11.md) 已关闭 G0–G8 的仓库实施范围 | 当前参考保留，不生成重复重构工作 |
| TTFT/解码指标缺失 | [event adapter](../../packages/shared/src/agent/backend/pi/event-adapter.ts) 按首个文本增量记时，[Inspector](../../packages/ui/src/components/trajectory/RecordInspector.tsx) 已显示 Timing | 关闭旧缺口；历史比较保留其日期口径 |
| 服务仍默认指向上游 | 当前身份配置的可选 services 为 null、telemetry 关闭 | 关闭代码解除上游默认项；外部归属与部署进入 C01 |

## 7. 原文归档与保留的当前参考

旧规划、占位与时点评估整体移入 `docs/archive/`，保留正文和原决策；归档说明及可迁移链接更新不改写当时的验收事实。

| 归档原文 | 本轮去向 |
| --- | --- |
| [产品方向 A–G](../archive/product-development-directions-2026-09-19.md) | R01/R04/R05/C03；其余关闭 |
| [插件评估](../archive/plugin-system-review-and-roadmap.md) | R02；其余关闭 |
| [Agentic 设计](../archive/agentic-interception-design.md) | 首片已实施，独立扩展关闭 |
| [日历/甘特优化](../archive/calendar-gantt-optimization-plan.md) | R06/C02；其余已完成或关闭 |
| [独立分叉方案](../archive/phaneris-fork-plan.md) | A/B 已完成；C01/C04 承接实际需求 |
| [主题治理方案](../archive/theme-engine-frontend-governance-plan-2026-10-12.md) | 工程已完成；R03/C01 承接验收 |
| [个人中心方案](../archive/profile-preferences-plan.md) | 本机基线保留；分享/独立统计关闭 |
| [本地帮助实施记录](../archive/phaneris-local-docs.md) | 管线已完成；R07 承接中文帮助 |
| [Pi 能力缺口旧快照](../archive/pi-sdk-native-capabilities-gap-analysis.md) | 已采用项关闭；必要问题按 C03/升级评估处理 |
| [Pi 1.0.2 全面替换评估](../archive/pi-sdk-1.0.2-upgrade-and-convergence-assessment.md) | 默认全面迁移关闭 |
| [System prompt 分析](../archive/system-prompt-per-turn-analysis.md) | 历史优化建议关闭 |
| [G0–G8 实施计划](../archive/architecture-code-governance-implementation-plan-2026-10-11.md) | 仓库实施完成；当前结果见治理台账 |
| [通用文件/图片生成基线](../archive/artifact-files-native-image-generation-plan.md) | 能力已实施；不重新开放 Univer/Design Layer |
| [Runtime 目标架构](../archive/durable-agent-runtime-target-architecture.md) | 基础设施扩展关闭；C05 保留具体问题触发 |
| [发布检查快照](../archive/release-readiness-2026-10-13.md) | 15 项门槛完整迁入第 4 节；L01/L02 本地 Windows 已验证，其他发行范围继续保留 |
| [记忆占位](../archive/memory-system-design.md) | 关闭占位 |
| [原生前端评估](../archive/native-frontend-migration-gpuix-assessment.md)、[GPUIX](../archive/gpuix-profile.md)、[gpui-kit](../archive/gpui-kit-profile.md)、[生态缺口](../archive/gpui-ecosystem-and-gaps.md)、[renderer 清单](../archive/craft-renderer-inventory.md) | 关闭迁移与 spikes；作为历史研究保留 |
| [跨生态插件研究](../archive/cross-ecosystem-plugin-porting-assessment.md)、[Unreal Agent 研究](../archive/unreal-agent-design-analysis.md) | 参考资料，无当前实施任务 |

[治理完整台账](governance-completion-2026-10-11.md)、[所有权清单](governance-ownership-inventory-2026-10-11.md)、[架构总览](../architecture/overview.md)、[Runtime ADR](../architecture/durable-agent-runtime.md)、[能力采用约定](../architecture/capability-adoption-2026-10.md)、[主题宿主契约](../design/theme-hosts-and-rollout.md)、[验证索引](../verification/README.md)作为当前参考继续维护。

历史验收 `results/`、原 manifest/SHA 清单和不可变发布说明不随本轮改写。被冻结 Markdown 引用的旧主题/治理计划路径仅保留历史跳转入口；正文位于 archive，不再承载独立待办。

## 8. 执行与维护

1. 默认单任务推进。R01–R07 已按本轮批准范围完成；C01–C05 只在触发条件成立后重新裁定。C01 触发后按发行目标单独安排，不把外部签名阻塞解释为本地功能未实现。
2. 每次实施先列失败条件，优先真实 E2E；复用现有 VerificationRun/critical registry。若必须隔离验证，先列完失败方式，再改代码，不在实现后补同构单元测试。
3. 保留项关闭时附基线 commit、实际源码/构建 SHA、工作流、产物与未覆盖范围，并明确未提交状态；局部通过不扩展为全平台/真实账户通过。
4. 新增事项必须有具体失败/需求、现有能力为何不能解决、最小边界、收益验证与退出条件。历史文档只提供依据，不自动重开已关闭项。
5. 只在本表更新状态和顺序。旧规划不追加“下一阶段”；规范/源码/用户帮助在行为变更时同步维护。

### 待评审提案（未进入实施队列）

此处仅登记新需求的评估与规划材料，不自动新增工作包、改变 R01–R07 顺序或触发验证/实施。用户授权规划落盘不等于授权原型、安装依赖或功能接入；开始后续工作须另行明确授权并在本表登记范围。

| 提案 | 状态与授权 | 需求、证据与最小范围 | 进入条件与退出条件 |
| --- | --- | --- | --- |
| [OpenUI 回复呈现接入评估与规划](../design/openui-reply-presentation-plan-2026-10-13.md) | proposed — 待评审；2026-10-13 仅授权评估及文档落盘，未实施 | 用户提出改善回复形式；官方运行时与现有 React/Markdown 链路具备规格层面接入基础。候选范围为受控、可降级的只读回复区块；实际质量、性能与成本未验证 | 用户后续授权后才开展真实内容对照；证明收益、完整性和兼容后再裁定采用。增强现有 Markdown 已能取得相同收益，或新增成本、退化超过收益时退出 |

| 日期 | 变更 |
| --- | --- |
| 2026-10-13 | 建立唯一待实施队列；保留 7 个有限工作包、5 个条件触发项和 15 个发布门槛；关闭其余扩展，归档旧规划与时点研究 |
| 2026-10-13 | 登记 OpenUI 回复呈现待评审提案及规划文档；未加入实施队列，未授权原型、依赖安装或功能实施 |
| 2026-10-14 | R01–R07 实施及本地验收完成；补修恢复路径和回答文件链接；统一记录源码/构建摘要与结论产物，L01/L02 仅关闭本地 Windows 范围。OpenUI 与条件项授权边界保持原裁定 |
