# 常驻助手完整实施记录

日期：2026-11-05；更新：2026-11-06。状态：P0–P5 代码实施及本机 Windows 隔离验收已完成。真实 Work 数据未迁移，已安装客户端未替换；付费模型质量与发行验证不在本次通过范围。

实施依据：[最终计划](../architecture/resident-assistant-permissions-memory-final-plan-2026-11-05.md)、[侧栏改版](../design/resident-assistant-overview-redesign-2026-11-05.md)。失败契约以最终计划第 16 节为准，先补真实 Host/RPC fixture，再修改实现，不补镜像单元测试。

| 阶段 | 状态 | 验证要求 |
| --- | --- | --- |
| P0 契约与失败场景 | 完成，本机验收通过 | 21 个隔离工作流共 351 组场景；保留先行失败、实际 Host/RPC、数据库与界面证据 |
| P1a 委派与交付 | 完成，本机验收通过 | 64 个委派场景；未送达模型的原输入、精确完成事实与暂存材料包分别恢复；未知效果继续保留资源范围，展示等待原因 |
| P1b 基础读取 / Source | 完成，本机验收通过 | 原生读取、已认证 Source 自主接通、Host 原始操作只读边界；项目文件写入归属和凭证文件保护 |
| P1c 总览与交付物 | 完成，本机验收通过 | 桌面 32 场景；分页搜索、明确成果与支持/过程角色、不可变预览；已审阅文件可移出/恢复，后端 7 场景 |
| P2 目录迁移 | 完成，本机验收通过 | 15 个布局场景；主助手/Worker、SDK、Artifact、来源 hash、备份与单一写入租约保持同一位置语义 |
| P3 自动记忆 | 完成，本机验收通过 | 自动准入 10 场景、后台 7 组回路；独立学习/使用开关、持久预算、前台消息/工作集抢先、检查点与重启材料续接 |
| P4 Project / 回忆 | 完成，本机验收通过 | Project 单文件权威、受控追加/完整回查、请求幂等、中文 FTS、L2/L3；上下文 48 场景覆盖推理中项目更新与排队轮次归属 |
| P5 知识与综合验收 | 完成，本机验收通过 | 12 个 Source 场景；资源 URI、读取时间/结果版本、主助手和 Worker 撤权依赖；完整构建及 21 工作流通过 |

## 数据与基线

现有 49 个未提交文件已保存于本机忽略目录 `.cache/implementation/assistant-native-rollout-2026-11-05/`，含 baseline.patch、各文件副本与 SHA256 manifest。此目录只用于区分本轮改动，不替代 Git 提交或产品备份。

所有自动验证使用隔离配置根与合成数据。真实 Work workspace 的只读取证保留为历史；未恢复其中任务、改写数据库、移动运行数据或替换客户端。发布与现场迁移需在对应恢复机制通过验收后依据正常 Host 生命周期执行。

## P1a 先行失败场景

在原有委派/上下文工作流基础上，先增加或收紧以下断言：

- 重启留下 needs_attention 后，新的无关任务仍能启动，原未知效果不重放；活动执行与相同资源冲突仍串行。
- capability/material fence 在新模型 prepare 前失败时，SDK error 贯通 Runtime terminal=error，不以 complete 掩盖；失效结果不交付。
- 原输入取消后的直接用户续作保持独立归属；排队输入遇到新的用户工作不会迟到执行。
- inbox 在 admission、进入、ack、最终回复持久化间中断后可有界恢复；重复通知不重复执行任务或宣称用户接受。

后续阶段先增加对应 fixture 场景，再实现；每项保留 manifest、日志与准确的未验证范围。完成情况与产物路径在实际通过后追加，不预填成功。

## 已取得的阶段证据

- `.cache/verification/resident-native-delegation-red-2026-11-05/`：先行回归复现 capability fence 被记为 needs_attention，随后收紧 Runtime 的 SDK 终止观察识别。
- `.cache/verification/resident-native-delegation-pass2-2026-11-05/`：55 场景通过，包括重启后的无关任务自动启动、共享资源继续受限、原取消与后续活动归属。
- `.cache/verification/resident-native-inbox-red2-2026-11-05/`：复现中断通知停在 attention、无法自动再次交付。
- `.cache/verification/resident-native-inbox-pass1-2026-11-05/`：38 场景通过，含实际 Host 重启后的通知恢复，不增加 Worker；投递有持久尝试次数与有界退避。
- `.cache/verification/resident-native-read-pass1-2026-11-05/`：9 场景通过，主助手实际调用 read 取得文件证据，读取/搜索/列目录工具在原生目录内可见，伪造 write 未生效。
- server-core、shared 目标包类型检查通过；Pi 子进程已构建。以上尚不是最终整体验收，也不替代真实模型质量或打包客户端验证。

- `.cache/verification/resident-source-lineage-pass1-2026-11-05/`：8 场景通过，Source 连接后保留工具池状态；取消不残留选择；Host 续作保留原派发 input 归属，直接用户续作保持独立。
- `.cache/verification/resident-overview-query-pass1-2026-11-05/`：58 场景通过，当前/历史分别分页与搜索，列表不加载 Runtime attempts，明确详情查询仍保留执行证据。
- `.cache/verification/resident-results-revision-pass1-2026-11-05/`：4 场景通过，真实 Worker 声明报告、脚本或纯文字结果，助手读取原结果后选取交付物；过程配置和旧 Artifact 不自动提升。原文件后续改动不改变已审阅的快照，不存在的 revision 被拒绝。
- `.cache/verification/resident-overview-ui-pass4-2026-11-05/`：30 场景通过。真实桌面 Host 创建 24 个排队后取消的历史任务，首屏 20 条并通过稳定游标加载后续；当前事项不混入这些历史。保留亮暗、窄窗口、搜索、详情/预览返回、调宽、焦点、截图与 trace。
- `.cache/verification/resident-layout-conflict-pass1-2026-11-05/`：11 场景通过，包含旧助手/普通会话区分、真实 WAL 提交、三个迁移中断点、重启不克隆、服务写入租约、运行中 SQLite 快照备份和冲突 workspace 隔离。专用 RPC 管理接口现复用服务内的记忆所有者与隔离状态。
- `.cache/verification/resident-native-artifact-pass2-2026-11-05/`：扩展为 13 场景，原生目录的 Artifact 登记、版本读取和全 workspace 产物列表可用。另已将 Pi 适配器/子进程会话目录与配置监听改走同一 Session 路径；桌面集成回归继续验证。
- `.cache/verification/resident-private-runtime-pass1-2026-11-05/`：11 场景，原生 read/grep/find/ls 对助手状态、旧记忆目录、Runtime、跨 workspace 与目录联接执行保护；搜索父目录仍可取到公开项目内容。`.cache/verification/resident-results-private-pass1-2026-11-05/` 扩展成果验证至 5 场景，私有 Host 文件不能借成果声明导出。
- `.cache/verification/resident-own-download-pass1-2026-11-05/`：11 场景，主助手仍可读取自己的 Source 下载和工作数据，不能原生读取 Host 控制文件；普通 Worker 不取得此例外。此边界不宣称覆盖任意 shell 或外部进程。
- `.cache/verification/resident-automatic-policy-pass2-2026-11-05/`：8 场景，结构化评估与确切直接用户来源共同支撑自动准入，tentative 或模型猜测保留候选；自动冷却/恢复有版本；学习模式、使用开关、配置损坏与永久遗忘边界分别校验。
- `.cache/verification/resident-auto-context-regression3-2026-11-05/`：38 场景回归通过；`.cache/verification/resident-layout-identity-regression1-2026-11-05/` 12 场景、`.cache/verification/resident-layout-memory-regression1-2026-11-05/` 16 场景通过。后两者早于本轮准入评估改动，不作为新策略的最终回归。

上述及以下逐次运行条目为阶段记录，保留当时的结论与缺口。11 月 6 日已补上 Worker 暂存材料的重启续接、Project 受控写入/原文回查、知识来源引用与交付物纠正；阶段条目中的“尚未”不代表当前状态，最终范围以本页表格及“最终验收”一节为准。

2026-11-06 新增证据：

- `.cache/verification/resident-observed-memory-pass5-2026-11-06/`：6 个真实 Runtime 成果/附件场景通过，增加已完成工具观察的自动准入、工具结果不能确认用户偏好、跨 Session 复制消息不能伪造执行来源。观察从保留的 T1/T2 与事件归属核验，不依赖已清理的运行状态。
- `.cache/verification/resident-maintenance-quiet-pass1-2026-11-06/`：3 组真实 Host/Pi 回路场景通过。暂停保留引用而不推理；重启保持助手身份并自动提炼；使用关闭与学习独立；用户输入抢先。后台原生文件读取在效果准备前被拒绝，提炼输出隐藏。每片最多 6000 字符，每次最多 6 模型准备、16 工具准备、30 秒；每日最多 8 次维护运行、48 模型准备和 128 工具准备，计数持久保存，失败最多 3 次。记录的是准入次数，不声称等于付费计费次数。
- `.cache/verification/resident-source-layout-pass2-2026-11-06/`：目录迁移扩展为 15 场景，含旧展开路径 hash 的兼容验证、逻辑来源身份稳定及真实正文变更后失效。新来源 hash 代表 Session 可移植身份，不表示展开后的传输字节完全相同。
- `.cache/verification/resident-session-controls-pass2-2026-11-06/`：原生文件边界扩展至 13 场景，普通任务会话的 transcript、SDK 缓存和元数据不再绕开专用来源接口；搜索父目录仍能取得公开项目文件。
- `.cache/verification/resident-material-refresh-pass2-2026-11-06/`：39 场景通过，增加撤回记忆后的主助手自动重建。恢复意图与尝试次数在 context.db 保存，新的用户输入取消旧恢复；已知完成的恢复输入可由 Runtime 归属核对。自动恢复输入不能重新派发任务，已存在任务通过其原回执处理。
- `.cache/verification/resident-worker-refresh-pass1-2026-11-06/`：40 场景通过。Worker 的原输入与回执保持身份，新的材料包从经 Host 验证的原用户任务引文及当前有效记忆重建，旧模型指令和旧 SDK 上下文退出；尝试记录按 Host 续接关系展示。本轮自动续接限于无非只读派发、无未知效果、配置未变且原任务范围可验证的活动任务；其他情况保留原证据，不自动重放。暂未完成材料包暂存/恢复中的全部崩溃点验证。
- `.cache/verification/resident-sdk-maintenance-pass1-2026-11-06/`：维护验证扩展为 4 组场景，使用真实已写入的 SDK 日志模拟旧布局后冷启动迁移，保留同一助手及 SDK 身份并继续维护；不再仅验证空 SDK 标识占位。

- `.cache/verification/resident-missing-resource-pass1-2026-11-06/`：60 个委派场景通过。精确原输入的 Runtime 完成事实可恢复漏记回执，不误取同一会话后续用户工作的结果；等待事项的目录消失后仍保留冲突范围，同时不阻塞无关工作。
- `.cache/verification/resident-project-scope-pass1-2026-11-06/`：41 场景，主助手跨 Project 的历史按每条消息的 Host 轮次归属保留；旧消息无此字段时继续采用兼容规则。搜索投影增量重建，不重写旧原文。`.cache/verification/resident-maintenance-turn-scope-pass1-2026-11-06/` 的 4 组后台场景验证了后来切入的项目不会污染旧来源的维护上下文。
- `.cache/verification/resident-recall-pass3-2026-11-06/`：5 组领域集成场景，中文分词/双字召回、措辞别名、项目过滤、L3 条件协作摘要、L2 精确目标引文与原子引用、更正后派生更新、重启与遗忘通过。SQLite FTS5 投影在查询时按允许范围每次推进至多 32 条，披露覆盖；不对历史对话或项目文档全量调用模型。
- `.cache/verification/resident-native-derived-pass1-2026-11-06/`：44 个真实 Runtime 场景通过，包含助手原生情节保存/召回、情节定义修订的请求栅栏、无需新用户输入的重建，以及按项目注入有效协作摘要。L3 为已有协作原子的有界视图，不复制 preferences.json 或另设人格真相源；L2 不保存新的任务状态机。
- `.cache/verification/resident-derived-memory-regression1-2026-11-06/`：原记忆工作流 16 场景回归通过。脚本类型检查、源码循环依赖与 workspace lint 已在本轮阶段通过；仍需最终综合门禁。

后台自动提炼目前验证了确定性本地模型回路，尚不代表真实付费模型的提炼质量；真实 Work 数据、安装客户端和旧应用进程未被操作。以上通过记录各自限定在其 manifest 范围内，不代表整个计划完成。

迁移只在兼容本协议的 Host 写入租约下进行；不宣称能隔离仍在运行且不遵守此协议的旧应用进程。迁移存档保留于 workspace 的 `assistant/migrations/layout-v1/`，旧数据库不再作为可写别名。真实用户目录尚未执行迁移。

## 2026-11-06 本轮新增

- `.cache/verification/resident-project-memory-pass2-2026-11-06/`：3 组 Project 领域集成；唯一文件权威、来源引文/作用域/学习策略、文档 CAS、请求幂等、保留他人追加及中段回查。
- `.cache/verification/resident-project-runtime-pass3-2026-11-06/`：5 组真实后台回路，增加项目决定写入原有文件后，以确切 entryId 和来源版本推进检查点；记忆使用关闭不阻止独立学习。
- `.cache/verification/resident-admission-restart-pass1-2026-11-06/`：61 场景，增加原输入未送达模型时重启自动继续；`.cache/verification/resident-refresh-restart-pass1-2026-11-06/`：45 场景，增加保存材料包后重启，继续原 Worker 与回执。
- `.cache/verification/resident-resource-hold-pass1-2026-11-06/`：63 场景，增加真实 Runtime T1 未核清效果保留冲突范围，无关任务仍可运行；原 T2 核清后释放资源，取消不变成完成。
- `.cache/verification/resident-queued-scope-pass2-2026-11-06/`：48 场景，含主助手 safe 模式下 Project 原生追加/检索、活动项目文件更新栅栏、排队输入保留准入项目、新输入使用后来选择的项目。旧轮次不覆盖 UI 选择。
- `.cache/verification/resident-output-correction-pass2-2026-11-06/`：7 场景，增加交付物移出与恢复，核对清单版本，保留文件与不可变快照，不提升过程材料。此回归还暴露并修复了维护远期定时器阻挡新回执的调度问题。
- `.cache/verification/resident-knowledge-revocation-pass1-2026-11-06/`：9 场景，新增 MCP resource 的原始 URI 和可核对读取引用，Source 权限变化使旧派生结果不可再借历史接口读取。远端文档当前版本仍须重新读取，不把本次结果 hash 当作远端更新通知。
- `.cache/verification/resident-project-idempotency-pass1-2026-11-06/`：3 组 Project 集成，扩展相同事实由不同请求重试后的身份约束。去重别名保留独立请求指纹，复用别名修改正文被拒绝；数据库只保存请求回执，正文仍以项目文件为准。
- `.cache/verification/resident-blocker-pass1-2026-11-06/`：64 个委派场景，当前事项及详情返回实际 Session、Source、目录或配置的等待原因；不为列表查询加载全部 Runtime 尝试。未知效果继续保留资源范围，核清后释放。
- `.cache/verification/resident-worker-knowledge-pass3-2026-11-06/`：12 个 Source 场景，覆盖原始 MCP 工具名的点号与清洗重名、前台激活续作优先于后台维护、读取引用及主助手/Worker 来源撤权。Worker 依赖从实际已提交的 T2 观察核验；同一 Source 的新旧权限版本同时保留，不能以新权限替旧正文背书。
- `.cache/verification/resident-rollout-final5-2026-11-06/`：21 工作流中 20 项通过，Source 用例复现隐藏维护挡住前台工作集切换。另以 `.cache/verification/resident-context-preemption-red1-2026-11-06/` 稳定复现，随后让前台工作集操作等待 Runtime 停止隐藏维护；保留普通用户响应的中止保护，不通过关闭自动学习规避。
- `.cache/verification/resident-context-preemption-pass3-2026-11-06/`：7 组真实 Host/Pi 回路，包含工作集切换抢先维护及不能静默取消用户响应。`.cache/verification/resident-context-source-pass2-2026-11-06/`：12 个 Source 场景全部通过。

综合命令：`bun run verify:assistant-rollout --output-dir=.cache/verification/<新目录>`。先构建实际 Runtime/桌面产物，再串行执行 21 个隔离工作流，保存各自 manifest、日志与汇总。失败场景仍保留证据；不会引用前次通过结果伪装本次通过。指南见[权限、内置记忆、项目事实和个人知识来源](../guides/resident-assistant-memory.md)。

## 最终验收：2026-11-06

最终运行目录为 `.cache/verification/resident-rollout-final6-2026-11-06/`。该次重新构建 Pi 子进程、桌面主进程、preload、renderer 与 assets，再实际串行执行全部 21 个工作流；聚合退出码为 0，子工作流共 351 组场景，739 个产物条目保留 SHA256。`rollout-results.json` 是各工作流计数依据，根 manifest 的 `passed=21` 表示工作流数，两者不混用。

| 验证范围 | 结果 / 证据 |
| --- | --- |
| 完整构建及隔离 Host / 桌面回归 | 21 工作流、351 组场景全部通过；上述最终目录及同名 `.log` |
| 全仓库类型检查 | `bun run typecheck:all` 通过；`.cache/verification/resident-final-types7-2026-11-06.log` |
| lint 及架构门禁 | `bun run lint` 通过，含源码边界、循环依赖、442 个 RPC 通道 / 65 个输入契约及分发输入；`.cache/verification/resident-final-lint6-2026-11-06.log` |
| 翻译、身份、版本、运行时 pin 及文档 | 全部通过；`.cache/verification/resident-final-support-gates5.log`；248 篇文档、1890 个相对链接 |
| 桌面视觉与交互 | UI 子目录保留亮暗/窄窗口、历史分页、交付版本、移出/恢复、记忆开关截图和操作轨迹；32 组场景 |

验证通过的是本机 Windows 开发构建、隔离数据和确定性本地模型服务。未替换已安装客户端，未恢复真实 Work 的历史任务，未在真实目录执行布局迁移；未验证付费模型的长期提炼质量、外部真实账号、签名安装包或 OS 级任意进程文件隔离。本期采用内置记忆及现有 Sources；外部 Memory Provider、团队共享、Wiki/CodeGraph、全量自动技能治理继续按最终计划列为后续项。
