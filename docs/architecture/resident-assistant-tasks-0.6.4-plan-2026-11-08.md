# Phaneris 0.6.4：助手任务管理实测分析与规划草案

Status: accepted — 用户于 2026-11-13 要求推进本计划实施。已实施并验收，实际证据与验证边界见[实施记录](../process/resident-assistant-tasks-0.6.4-implementation-2026-11-13.md)。

原始状态：proposed — 2026-11-08，调查阶段提出范围和验收建议；本稿保留调查事实及当时尚未实施的语义。

版本调整：本稿最初按 0.6.3 调查与讨论；用户随后将[助手自身上下文管理](resident-assistant-context-0.6.3-plan-2026-11-08.md)独立安排为 0.6.3，任务管理顺延到 **0.6.4**，Board 并排交互顺延到 0.6.5。先前调查的时间线与本地证据目录名称保持不变，不据版本重排修改历史事实。

本轮修订：用户明确否定“默认单任务推进”这一产品前提。助手应在原授权内自行判断顺序或并行，支持频繁交互下多项相关或无关工作持续推进。另将 D/E 新失败、多任务上下文、Session 状态收口与普通 subtask 的兼容纳入同一规划。以下新结论覆盖上一轮相应建议；初次采集保留为历史证据。

日期与时间：Asia/Shanghai。源码基线：`aab3af835`。本机安装版 manifest 声明 `0.6.2`；未据此声称安装包与当前源码完全同构。本次只读检查真实 Work 会话、委派数据库和代码，未启动、暂停、取消、补发或重排真实任务，未修改产品代码。

本稿承接 [0.6.2 计划](resident-assistant-0.6.2-plan-2026-11-06.md)及其[实施记录](../process/resident-assistant-0.6.2-implementation-2026-11-06.md)，并接入重新设计的 0.6.3 共用上下文核心、工作分支、原始输入归属与 Worker 任务材料契约。三类会话共用原文与执行基础，任务管理不另建 Worker 存储或上下文引擎。[0.6.5 助手与 Board 并排交互](resident-assistant-board-0.6.5-plan-2026-11-07.md)继续保持独立范围，本期只处理现有 Board 的任务可见性与状态正确性。

## 1. 核心结论

| 问题 | 本次确认的事实 | 0.6.4 的建议方向 |
| --- | --- | --- |
| A–F 为什么没有并行 | `AssistantDelegation.pump()` 存在 workspace 委派队列的全局串行门；任意一项处于 preparing/submitting/submitted/cancel_requested，就不启动下一项 | 助手依任务依赖、资源、成本与用户要求自行选择顺序或并行，Host 在真实容量内执行；不要求用户另说“并行” |
| 是否是 Runtime 只有一个执行位 | Runtime 用 `Map<sessionId, Slot>` 管理执行，每个 Session 有自己的准入与队列；普通 spawn 也直接独立运行；现有 TaskRunner 支持并行，默认值为 4 | 复用 Runtime，不重建执行引擎。并发限制、等待原因与实际占用由 Host 明确公布 |
| Worker 是不是另一种实体 | Worker 实际由普通 `createSession()` 创建，输入、配置、历史和结果均在普通 Session；委派库额外保存关联、队列状态、控制及投递回执 | 以 Session 为用户可见的工作本体，保留必要的来源和可靠投递记录，不建设第二套任务库 |
| 为什么 Kanban 不见任务 | Worker 的 parentSessionId 指向隐藏助手；Board 查询排除隐藏助手；Kanban 又无条件跳过所有有 parentId 的项，导致这些 Worker 无父卡可挂，也不能成为主卡 | 专门处理以 resident assistant 为直接父项的工作；保留真实父子关系和普通 subtask 收纳，不采用通用“父不见就升根”规则 |
| 助手是否已经能管理任务 | 已有查询、补充、暂停/恢复、重试、配置、优先级、取消、结果回执等接口；本次却出现虚报运行、时间误判、未落实后续指令和反复索要已给授权 | 补齐任务现场、指令落地、接续与复核交付的闭环，以实际模型行为验收，不能只数接口 |
| 为什么已复核仍是 todo | 结果 review 只写 task_results；主助手没有状态工具，普通状态工具统一禁止 Agent 设置 closed，现有成功轮次处理也不自动收口 | 助手管理的工作在结果就绪时进入 needs-review，复核通过后经 Host 更新同一 Session 为 done；保留普通会话与人工修改的边界 |

**版本目标建议：助手可以在用户授权内，把工作规划成普通 Sessions，按依赖顺序或并行启动，准确掌握状态，传达变化，接续未完工作，复核并交付结果；用户在现有 Board 中看到同一批 Sessions。**

## 2. 真实实测的时间线

本次读取的主助手为 `261105-copper-cloud`。委派库使用 SQLite `mode=ro` 并开启读事务；Session 文件只读。数据库与各 Session 文件不是跨存储原子快照，因此以下状态只代表采集时刻。

本地脱敏证据：`.cache/verification/resident-063-preplanning/audit.json`，采集于 **2026-11-08 01:54:48 +08:00**。只保留批次代号、运行引用、时间、状态与工具返回的诊断字段，不复制任务正文、个人资料或记忆候选。它是调查产物，不是功能验收通过记录。

证据 SHA-256：`055966496b5b9cb826bded17eac9d1aee2f3d1aaf4d5693d386ec37ec5453b05`。复核可按表中稳定 Session/输入引用，只读比对 delegations.db 的 work、inbox_events、worker_commands 与对应 session.jsonl；后续状态自然可能变化，应将新快照与本次记录区分。

| 批次 | Session | 创建 | 输入提交执行 | 收到结果 | 采集时的委派状态 |
| --- | --- | --- | --- | --- | --- |
| A | `261108-prime-diamond` | 01:29:53 | 01:29:53 | 01:37:10 | result_ready |
| B | `261108-deep-thistle` | 01:29:54 | 01:37:11 | 01:43:26 | result_ready |
| C | `261108-quick-tide` | 01:29:55 | 01:43:36 | 01:50:35 | result_ready |
| D | `261108-onyx-jade` | 01:29:56 | 01:50:39 | — | submitted |
| E | `261108-wide-zinc` | 01:29:57 | — | — | accepted |
| F | `261108-silver-sapphire` | 01:29:58 | — | — | accepted |
| A2 | `261108-early-cosmos` | 01:40:57 | — | — | accepted |

A → B → C → D 的衔接与源码串行门一致。A 以外的任务并非都派发失败，B、C 后来依次运行完成。A2 已创建并保存输入，采集时尚未提交执行。

七个 Session 均没有 hidden 标记，全部以隐藏助手为父会话，全部已经保存委派输入。不能将没有启动、查询没有展开历史、输入没有保存混为一谈。

### 2.1 原助手诊断中需要纠正的内容

| 原说法或行为 | 实际证据 | 应有解释 |
| --- | --- | --- |
| 01:30 称六批正在并行执行 | 当时只有 A 提交，其余 accepted | 六批已受理，其中一批启动，五批排队 |
| 称 C、E 连委派消息都未写入 | 对 C、E 的 get_session_info 调用没有 history 参数，因此只返回元数据；真实输入均已保存 | 未查询历史不能推导历史为空 |
| 01:39–01:41 称 B 超过一小时无进展 | 01:39:42 的工具返回 acceptedAt=01:37:12，updatedAt=01:39:34；距启动约 150.5 秒，距该更新约 8.7 秒 | B 当时在请求模型；这些证据不能证明卡死，也不支持“超过一小时” |
| 称 A2 已运行、六个执行位在跑 | A2 仍 accepted；其他任务也有明确 not_started | 已派发和已启动必须分别报告 |
| 用 seq 判断 A 是最后派发、调度像随机 | seq 是随回执更新增长的版本序号；A 实际最早创建 | 排序、CAS 版本和真实执行时间分别使用对应字段 |
| 用户要求后续批次放宽上限后，称后续按新要求走 | 七项任务的 worker_commands 均为空；B–F 的原委派输入仍保留原限制 | 新要求必须实际传给已有任务，并检查回执，而不只写在主助手回复中 |
| A2 要求“先补”，实际排在 E、F 后面 | 没有调整优先级或暂停后续待启动任务的控制记录 | 创建任务不等于落实执行安排 |
| 已获整体授权，收到结果又要求决定是否继续 | 原始指令已经包含筛选、并行提取、复核和更新记忆 | 原授权内继续推进；真正的新范围或无法裁定的冲突再询问 |

其中既有模型判断错误，也有产品契约缺口。当前 `get_session_info.isActive` 实际表示 agent 对象是否存在，并非 Runtime 是否在执行；能力快照没有公布并发上限、占用和排队原因。不能将这些问题全部归于模型，也不能因模型误报而推断底层 Runtime 损坏。

### 2.2 为什么旧验收没有发现

旧[助手失败矩阵](../verification/resident-assistant-failure-matrix-2026-11-03.md) RW07 明确要求“默认串行”，对应 fixture 仍将该行为记为 `RW07-serial-and-cancel-queue`。因此，现有测试通过可以证明符合旧串行契约，不能证明满足这次明确授权的并行任务。

0.6.2 的真实模型验证主要检验主助手选择原文和控制工具，Worker 推理由受控回路承载。其通过记录没有覆盖本次多 Worker 真实并行及多轮任务管理质量。应修订目标和失败场景，保留旧记录的实际适用范围。

### 2.3 D、E 后续执行失败

第二次只读证据：`.cache/verification/resident-063-followup/audit.json`，采集于 **2026-11-08 02:19:50 +08:00**，SHA-256：`3fa0f1424c44b27b206bfdea63373a29cd183b8f8fdfdf3a7ca0fdc6f85ac9aa`。同目录 `source-audit.ts` 可重复核查当前来源哈希与部分依赖状态，输出保留于 `source-audit.json`；它不重放历史内存状态，也不冒充完整 Host 有效性重演。

| 项目 | D：`261108-onyx-jade` | E：`261108-wide-zinc` |
| --- | --- | --- |
| 真正启动 | 01:50:39 | 01:55:56 左右 |
| 终止 | 01:55:50，error | 02:05:09，error |
| 表面报错 | Resident context changed while the provider was running | Model context changed; prepare a fresh input before continuing |
| Runtime 所处边界 | 模型响应提交时，被 Host 标记 contextDisposition=stale 并丢弃 | 已完成获准的 Bash 调用后，下一次模型请求准备被拒 |
| 已确认事实 | 编号 12 的请求对应的模型响应已返回；没有第二条人工/控制输入进入 D，没有本时段主助手记忆写入记录 | 委派当前有效权限已降为 ask，但 Session 持久权限为 allow-all，previousPermissionMode=ask；两处实际配置不一致 |
| 根因精度 | 确定是 Host 有效性检查失败；哪一项失败没有持久记录，不能唯一归因 | 此配置不一致会触发 assertDelegationConfig，足以阻止下一次模型请求；完整时序仍需实施时复现 |

两条错误都经过模型上下文有效性机制，只是在“响应返回”和“下一次请求准备”两个边界报出。D 文案里的 Resident 并不证明是主助手刷新或消息注入；该文案也用于普通 Worker。原助手“我处理回执干扰了 D”的归因没有证据，不能据此要求主助手在 Worker 运行时停止处理用户和其他任务。

E 的 acceptedPermissionMode / acceptedConfigRevision 保留最初受理值，而启动时的权限 clamp 会更新当前 effectiveConfig/configRevision。这两组值不同本身是允许的演进，不是失败条件。实际问题是用户可见 Session 配置与当前委派有效配置失配。应让现有配置入口与委派接续共享一次变更，不能让普通界面改完模式、旧快照继续固定校验。

D 刚失败后，E 启动即被执行上限降为 ask，提示该时段权限上限可能相关；由于没有精确的失效原因与变更来源记录，这只是一条待复现线索。当前检查未发现两者 64 个直接来源的哈希/抑制异常或所引记忆 revision 变化，不能据此排除历史瞬态、其他能力或内存权限变化。

此外，D 早期一次 codemode 因 options 注释不在首行报错，随后继续执行，不是最终终止原因；E 的建议/风险标签辅助模型超时也有记录，应与主任务模型的终态错误区分。

## 3. 继续以 Session 为本体

| 现有对象 | 应负责的事实 | 不应承担的职责 |
| --- | --- | --- |
| 原始用户消息与已有会话计划 | 目标、授权范围、用户修订和待解决事项 | 模型自写执行成功或新授权 |
| 普通 Session | 工作身份、说明、验收要求、项目、排期、业务状态、历史与成果入口 | 仅因轮次结束就宣布任务已验收 |
| Runtime run / attempt | 是否实际启动、请求、工具效果、停止、错误、未结算效果与恢复 | 用户对成果的接受程度 |
| 委派关联与回执 | 谁把哪项工作交给哪个 Session/输入，稳定请求身份，控制命令与结果投递 | 第二份可独立修改的任务正文、业务状态和 Worker 会话库 |
| Board | 同一 Session 的看板、日历或甘特投影 | 自己维护另一套执行状态 |

一次 Session 可以接收后续任务；一次任务也可能因上下文接续涉及已有 handoff 链。因此，用户层面一项工作有一个稳定会话入口，并不要求删掉原输入、尝试和投递身份。这些引用解决去重、归属和恢复问题，应继续保留。

委派库虽以“回执”命名，当前实际上还拥有调度与若干执行阶段状态。这部分需要收敛为 Runtime 的准入和结果协调，不再继续发展成与 Session/Tasks 并列的任务引擎。助手与被派发 Session 的 subtask 关系继续存在，不能为让看板显示而删除关系或另造一种任务实体。

### 3.1 Board 的最小修正

1. 保留 `parentSessionId`、assistantSessionId 和委派身份。仅在 Board 展示投影中，将“直接父项是当前 workspace 的 resident assistant”的普通工作作为可见主卡，助手仍作为来源/管理归属可追溯。
2. 普通父会话的子会话继续作为原父卡下的 subtask；助手派出的工作再派出的子会话，也收在该工作下面。handoff 仍是同一工作接续，不单独增卡。
3. 撤回上一稿通用“父项在当前视图不可见，子项就升根”的建议。它可能把搜索、项目筛选、归档等情况下的普通子会话释放出来。只按真实父项角色做窄范围投影，不按父卡是否碰巧在当前列表里猜测。
4. 补上委派目标、验收要求与 Session 规划字段之间的接入。当前验收要求在委派输入中，看板读 Session 级字段，不能假定已经一致。
5. 运行提示读取 Runtime。现有子项 `messageCount > 0 → done` 会把仅存一条委派消息的排队 Session 当作完成，必须纳入修正。

WorkItem RPC 已是 Session 投影，没有独立 WorkItem 存储；类型和组件仍有“独立任务 / 可选 Session”的旧注释，本期随涉及代码纠正，不据旧注释扩展实体。

| 真实关系 | Board 展示 |
| --- | --- |
| 隐藏助手 → 工作 A / 工作 B | A、B 是可见工作卡，关系仍保存在 Session |
| 普通主会话 P → 子会话 Q | P 卡下的 Q subtask，Q 不独立成主卡 |
| 助手 → 工作 A → 子会话 A1 | A 为工作卡，A1 收在 A 下 |
| 工作 A → handoff 接续 A' | 一个稳定工作入口，沿用原接续显示 |

这个规则应由现有 Board 投影统一应用于相关视图。无需为助手生成一张假的业务父任务，也无需持久改写已有父子关系。

## 4. 任务管理应形成的最小闭环

### 4.1 频繁交互下的多任务上下文

本节的上下文机制已拆入 [0.6.3 共用上下文核心与助手分支管理](resident-assistant-context-0.6.3-plan-2026-11-08.md)，此处保留实测依据与任务侧契约。0.6.4 只接入任务现场、指令传达、回执与合法后续执行，不重复实现工作分支选择、主线换段和检查点，也不要求新核心继续使用旧 topic / segment 表结构。

当前助手上下文保留本议题的用户原话、少量近期助手回复、记忆和未处理 inbox 事件，但历史过程及工具结果默认不保留。它可以查询 assistant_work，并不等于每轮都有当前在办工作图景。第二次采集确认：真实助手只有一个 Current conversation topic，包含 62 条原始用户输入；D、E 各继承 64 个来源引用和 10 个记忆依赖，其中 58 个来源来自主助手。`prepareDelegatedInput()` 直接拿整段 activeSegment.dependencies，未按任务裁剪。

已有 topics、focus、anchors 和原文读取提供现状依据，但它们当前主要支持界面上的显式议题切换。主助手公开的 assistant_context_history 是历史查询，并不是自动管理多个工作上下文的入口。0.6.3 会按共用契约替换相关职责，不能因存在 topics 表就宣称多任务路由已经完成。

任务侧使用三个取用层次，接入 0.6.3 的工作分支、共用 Reader / ContextView 和现有 Session / 委派记录：

| 层次 | 每轮保留什么 | 按需恢复什么 |
| --- | --- | --- |
| 主助手工作总览 | 在办工作入口、简短目标、状态、待处理事件和当前用户指向 | 对应任务的具体原文、结果与诊断 |
| 当前涉及工作的材料 | 原始要求、后续修订、已定结论、待办、关联 Session/结果引用 | 大段讨论、工具输出、文档正文 |
| Worker 任务快照 | 该任务的范围、必要材料、验收要求与有效配置 | 本任务需要访问的业务证据，不继承主助手整个工作现场 |

原始用户消息是要求与授权的依据；工作分支的检查点只帮助恢复，不拥有执行事实或创造授权。Session/Runtime 的事实更新后，总览应重新生成，而不是依赖摘要“记住进度”。同一目标下的多个 Worker 通过工作分支、原始消息和委派引用关联，不新增独立 Goal/Task 数据库。上下文分支没有独立业务完成状态，也不对应一张额外 Board 卡片。

新消息由当前助手在正常轮次中判断是新工作、补充、查询还是取消，并关联到对应工作；一条消息可同时涉及多项工作，同一工作也可承接多条后续消息，不建立消息与任务的一对一限制。工作 ID、消息引用及原始指令由 Host 固定。回复“这个也改一下”时若上下文只有一个合理指向可直接处理；存在两个会导致不同操作的指向时，仅澄清目标。无需额外路由模型，也不要求用户手动先切议题或先选择“串行/并行”。

切换讨论重点不暂停、取消或改写其他工作的要求。后台结果按其原始工作归属进入收件箱，处理时恢复该工作所需材料，随后继续当前对话；不能把结果挂到“最后一条用户消息”上。主助手一次模型生成仍沿用现有 Session 队列/steer，多个 Worker 独立运行，不为每个工作再创建一个主助手。

建议在现有 Host 上下文中增加**有界的在办任务投影**：

- 当前相关 Sessions 的稳定 ID、所属原始目标、实际阶段和可用管理动作。
- 排队原因、并发容量及占用；依赖等待与容量等待分开。
- 原始时间、Host 当前时间及计算后的等待/运行时长，减少模型手算和时区误读。
- 待处理的结果、决定及用户修订，和可继续查询的游标；超出容量时披露省略数量。

直接由 Session、Runtime、既有委派/事件所有者生成，不新增可由模型维护的任务账本，不把全部历史和工具输出常驻注入，也不让第二个模型循环持续监督。

由 0.6.3 将原始要求取用限定到对应工作，避免一个 Current conversation 随日期持续累加所有无关输入。结束的工作退出在办摘要，历史保留可恢复；退出当前上下文不等于暂停 Worker、遗忘、归档或撤销授权。

### 4.2 规划、创建与启动可以分开

简单任务仍可一次派发后启动；需要先安排的一组工作，应能创建但暂不启动，再按依赖、优先级或用户要求启动。优先复用现有 paused/resume 及 Session 规划字段，仅补创建时的必要选项，不新造另一套生命周期。

现有 dependencySessionIds 不能直接当作已实现的执行依赖：委派 pump 没有读取它。若本期支持该语义，应明确依赖何时满足、失败/取消如何处理，并在 Host 启动前校验；否则只能称为规划信息，不能承诺自动顺序执行。

复杂、固定 DAG 继续走现有 Tasks / Conductor；助手侧只完成轻量会话协调，不把全部任务转换成 task.yaml，不要求日常委派先经过编排器。

### 4.3 有界并行

- 助手自主判断：独立任务可并行，有前置依赖则顺序执行，明确冲突则排队或隔离，并遵守用户指定的顺序、预算和范围。新工作到来不默认替换旧工作，也不需要用户先说“并行”。Host 应允许多个 Session 的执行区间实际重叠。
- 建议沿用项目已有并发习惯，初始上限参考 TaskRunner 的 4；这是待确认的产品默认值，不是已选定实现。Host 应公开真实上限，必要时可调低或调高。
- 同一 Session 保留单前台执行；独立 Session 使用各自 Runtime slot。
- 共享工作目录不自动等于冲突。多项只读工作可并行；明确重叠的写入与不能并用的应用资源需要排队或隔离。复用现有资源/文件范围机制，不靠 prompt 保证，也不新建通用锁平台。
- 现有 sharesWaitingResources 对 needs_attention / 未结算效果的保留仍需保全，但它不能代替正常并行任务的资源判断。仅删除串行门不足以完成实现。
- 任务在 preparing、等待批准、取消结算或出现不确定效果时，只阻塞必要范围；每个等待都能说明原因。
- 供应商限流和失败按实际错误报告与恢复，不据单一状态猜测连接只有一个槽位。

顺序或并行属于助手在授权内的安排，不增加独立的日常批准步骤。全局容量限制用于控制真实资源，不是把对话变成只能讨论或推进一个目标。

#### 4.3.1 任务间隔离与配置一致

主助手继续聊天、处理另一个工作结果或正常切换工作分支，不应使无关 Worker 快照失效。沿用 0.6.3 任务材料契约，Worker 只绑定本任务实际使用的材料和配置；真正的来源撤权、目标变更和权限收紧仍需影响相应工作，不能用“冻结快照”绕过用户撤权。

区分当前对话的操作模式与对后台任务的执行授权。已有独立 workerPermissionMode 的方向继续复用；界面、启动 clamp、运行中配置更新和恢复必须共享有效配置。用户在 Worker 会话里改变权限，也应进入同一配置变更路径，避免出现 E 的“Session 已 allow-all，快照仍 ask”。

权限放宽、配置调整、材料变化分别按真实原因处理：在现有安全边界应用配置，或为受影响任务准备接续；已完成工具效果继续归原尝试。Host 应返回具体失效项及可用后续动作，替换只有布尔 false 和含混的 Resident context changed 文案，无需增加诊断平台。

### 4.4 中途介入与用户修订落地

消息通信应复用现有 Session 准入、队列、steer 与内部来源标记。旧 send_agent_message 已经证明“投递后独立处理”可用，但它还不能直接替代所有管理操作：普通消息当前不能投递给 resident assistant，且一条正文不能可靠表示暂停、取消和配置修改。

管理动作继续用少量明确命令；需求补充通过同一 Session 通信基础投递。当前 assistant_worker_control 的 message 路径在运行时会停止现有尝试、重建 driver、再排队接续，应明确它的真实效果，并评估普通补充能否走已有 steer/queued 路径，避免每条沟通都变成停机恢复。

验收以这次原话为例：用户要求放宽后续批次上限时，助手应向受影响的已有任务传达修订，保留已完成工作，确认哪些尚未读取新要求；“先补 A2”应改变尚未启动任务的安排，不能只创建一个队尾任务。投递受理、命令应用及 Worker 实际处理分别按现有事实报告。

### 4.5 接续、复核与结束

完成通知应让助手回到原目标，处理后续的复核、合并或已经授权的下一步。当前 inbox 文本一律要求 `do not approve, re-delegate or poll`，assistantDelegateFn 还直接拒绝内部事件发起的委派；因此，仅修改提示词并不能支持收到结果后的合法下一步。应允许 Host 核验的原目标内接续，同时继续拒绝重复派发和内部消息创造新授权。

当前 dispatch 总是选择最新直接用户输入作为 origin，后续已切话题时，不足以可靠表达旧目标下的接续。应优先复用已有原始消息、委派和 Session 关联，明确指定要接续的授权来源并由 Host 核验；内部 Worker 报告仍不能创造新授权。

Worker 一轮结束只说明该次执行产出了结果。助手需读取真实结果，与原验收要求比对：通过后交付，需要修改则在原会话继续，无法决定则提出具体问题。结果就绪、复核结论、用户接受与归档分别沿用现有所有者，不新增第二套“完成状态”。

### 4.6 复核必须落到 Session 状态

当前 A、B、C 的 reviewed_at 分别是 01:37:32、01:43:56、01:51:00，但三个 Session 都没有持久 sessionStatus。get_session_info 将其回退为 todo。原因有三处：结果 review 只保存清单选择；主助手角色工具集中没有 set_session_status，worker_control 的 plan 也没有状态字段；通用 set_session_status 又统一禁止 Agent 设置 closed。普通轮次 classifyTurnOutcome 对 finished 保持原状态，并不自动设置 done。

本轮要把“任务会话的业务状态”真正接起来。复核的交付物选择与事件 ACK 并不自动证明验收通过，因此不能简单把所有 ACK 转成 done；应在现有结果复核动作里明确是否通过原要求，由 Host 关联原结果并更新同一 Session。

| 事实/动作 | 助手管理的 Session 状态 | Runtime 提示 |
| --- | --- | --- |
| 已创建、排队 | todo，或 workspace 已配置的相应 open 状态 | 排队及原因 |
| 真实启动 | 沿用 workspace 已有进行中约定；没有专门状态时仍可保持 open | 实际运行阶段 |
| 有最终结果，等待助手复核 | needs-review | 结果已就绪 |
| 助手按原要求复核通过，且其授权包含完成该工作 | done | 保留原运行与复核引用 |
| 复核不通过，需要继续修改 | todo 或已有 open 状态，仍使用原 Session | 补充/接续的实际阶段 |
| 执行失败或恢复被阻断 | needs-review | 明确错误或阻塞原因 |
| 原授权内取消，且运行已停止并结算 | cancelled | 取消已结算 |

不为本期新增一套状态枚举，也不把所有普通会话的一次回复结束自动当成 done。普通 Worker 仍不能随意关闭别人的任务；助手对自己管理工作的复核收口是受约束的管理能力，应通过原状态所有者执行。用户明确要求亲自验收的，继续保持 needs-review，直至满足要求。

任务 done 表示约定工作已完成，不等于用户已读、满意或主动归档。若用户在复核期间追加要求或直接继续该 Session，旧结果不能覆盖新任务状态；复用现有原输入、结果版本与并发检查。后台失败、取消、人工手动改状态也遵守同一归属。

## 5. 建议实施切片

| 顺序 | 范围 | 收口要求 |
| --- | --- | --- |
| P0 | 先固定本次失败场景 | 保存排队、误报、隐藏父项及未传达修订的可重复失败；先写失败矩阵，再改代码 |
| P1 | Session、Board 与业务状态一致 | 隐藏助手的直接子工作可见，普通 subtask 不释放；结果/复核/取消正确更新同一 Session；规划字段一致 |
| P2 | 自主安排与真实并行 | 现有队列与 Runtime 支持容量、资源范围和等待原因；任务配置变更与快照一致，D/E 失败有精确归因与接续路径 |
| P3 | 接入 0.6.3 上下文与任务现场 | 复用已建立的工作分支/输入归属，补充任务状态、可用动作、回执与控制投影；不重建上下文引擎 |
| P4 | 多轮管理闭环 | 创建/启动、传达修订、调整安排、接续、复核及交付在原授权内完成；真实模型与真实 Worker 验收 |

P1–P4 共同构成本轮目标。只修并发和看板，不能宣布助手任务管理完成；也不以“全过程”名义扩展成通用工作流平台。

本轮不建设独立 Worker 数据库、第二套任务卡或状态体系，不新增监督 Agent/常驻模型循环、跨 workspace 调度、团队系统、分布式队列或事件平台。0.6.5 的并排布局和版本未定的服务器托管继续各按原规划处理。

## 6. 验收重点

| 场景 | 必须看到的证据 |
| --- | --- |
| 独立 A–F 并行 | 至少两项真实模型/工具执行区间重叠；达到配置容量，多余项明确显示容量等待，不只展示多个 accepted |
| 隐藏父助手与普通 subtask | 新旧助手直接子工作能在既有 Kanban 找到；普通 P→Q 仍收在 P 下，助手→A→A1 只显示 A 主卡，handoff 不增卡；过滤/搜索/归档不使普通子项无故升根 |
| 多个无关目标 | 用户先安排报告 A，再安排邮件 B，并询问 A；A/B 自主并行且要求不混用，查询正确指向 A；不用用户切议题或另批并行 |
| 回执穿插 | 讨论 B 时 A 完成，回执仍属于 A；助手复核 A 后可继续 B，不中断其他 Worker，不把 A 结果绑定到最后用户消息 |
| 容量与资源冲突 | 独立只读任务并行；重叠写入正确等待或隔离；一个任务等待不能冻结所有无关工作 |
| 需求变化 | 排队和运行中的任务都能收到对应修订；已完成项不重跑，Worker 后续行为使用新要求 |
| A2 先补 | 后续待启动顺序按明确安排改变；对已运行任务是否打断遵循用户意图与现有控制，不偷偷重启 |
| 状态语言 | 助手准确报告受理、排队、执行、待决定、暂停、失败和结果就绪；不因 agent 对象存在、消息条数或静默推断状态 |
| 状态收口 | 结果就绪→needs-review，复核通过→done，返工→open，取消结算→cancelled；Session 列表与 Board 一致，不要求用户再手工收口 |
| D/E 失败复现 | 分别复现响应返回时权限收紧、Worker 会话直接改模式、无关 topic/回执切换；精确记录失败项，合法配置变更可接续，无关切换不令任务失败 |
| 授权内接续 | 收到结果后复核并推进已授权后续工作；不反复询问是否继续，不因旧目标被新话题挤走而重派或扩大授权 |
| 真实中途控制 | 补充、暂停/恢复、重试、取消与人工直接介入的归属正确；重复命令、旧 seq 和未知效果不能触发重复外部操作 |
| 重启和上下文轮换 | 原 Session、目标、结果和未完成动作恢复；完成的不重跑，显式暂停的不自行恢复 |
| 成果闭环 | 结果通知包含真实归属；助手查验原文/产物并交付，不能将 Worker 停止等同业务完成或用户接受 |

隔离 E2E 为主，记录 Session/输入/尝试身份、重叠时间、模型请求及重复执行检查，产出 trace/截图和机器可读结果。补做真实主助手与真实 Worker 的多轮样本，不能以假 Worker 回路替代。本次调查不发起付费模型验证、不操作现有 Work 任务。

## 7. 本轮尚待讨论的产品取舍

1. 容量上限可参考已有 TaskRunner 的 4，但最终依据模型服务与本机资源确定；这不是“默认单任务”或要求用户手选执行方式。
2. 本期依赖执行的精确范围：先支持简单前置依赖与助手事件接续，复杂 DAG 仍交原 Tasks。
3. 需求补充默认使用安全边界上的 steer/queued，还是用户明确要求立即生效时才中断当前尝试；需结合现有 Pi 能力验证。

这些是实施前的有限取舍。助手自主安排、多目标持续推进、复核更新 Session 状态及普通 subtask 保持收纳，是本轮明确的规划要求。D 的具体失效分支仍不确定，必须在复现时补足证据，不能将原助手的归因写成系统事实。

## 8. 代码依据

- [委派准入、全局串行门与资源等待](../../packages/server-core/src/resident-assistant/delegation.ts)：尤其 pump、sharesWaitingResources、dispatch、complete。
- [Runtime 每 Session slot 与准入](../../packages/server-core/src/durable-runtime/execution/host.ts)：slots、slot、admission、begin。
- [Session 创建、委派输入、管理与旧消息入口](../../packages/server-core/src/sessions/SessionManager.ts)：prepareDelegatedInput、residentWork、applyWorkerControl、onSpawnSession、deliverMessage、getSessionInfoFn。
- [Board 的 Session 投影](../../packages/server-core/src/handlers/rpc/work-items.ts)：sessionToWorkItem、visiblePlanningSessions。
- [Kanban 根卡与子项状态](../../apps/electron/src/renderer/components/app-shell/kanban/KanbanBoardContainer.tsx)：parentId 跳过逻辑、deriveRunState。
- [助手上下文取用](../../packages/server-core/src/resident-assistant/context-store.ts)：prepare；[能力快照](../../packages/session-tools-core/src/assistant-capabilities.ts)。
- [助手派发与 inbox](../../packages/server-core/src/resident-assistant/service.ts)：dispatch、deliverInbox、modelContext；[角色契约](../../packages/shared/src/agent/resident-role.ts)。
- [控制命令现有契约](../../packages/session-tools-core/src/worker-control-contracts.ts)及[控制回执](../../packages/server-core/src/resident-assistant/worker-controls.ts)。
- [现有状态工具的 closed 限制](../../packages/session-tools-core/src/handlers/set-session-status.ts)、[结果 review 的实际写入](../../packages/server-core/src/resident-assistant/task-results.ts)及[默认 Session 状态](../../packages/shared/src/statuses/storage.ts)。
- [模型准备/结果边界的有效性检查](../../packages/server-core/src/runtime-adapters/pi-driver.ts)、[材料依赖检查](../../packages/server-core/src/resident-assistant/memory-store.ts)及[项目材料有效性](../../packages/shared/src/agent/pi-agent.ts)。
- [现有 topic/focus 契约](../../packages/session-tools-core/src/resident-context-contracts.ts)、[历史显式议题界面](https://github.com/VanDING/Phaneris/blob/48c2450ed581203391882e968f9ff0103a086199/apps/electron/src/renderer/components/resident-assistant/ResidentAssistantDetails.tsx)（2026-11-13 已收回前台展示）和[普通会话家族收纳](../../apps/electron/src/renderer/utils/session-families.ts)。
- [原会话消息工具](../../packages/session-tools-core/src/handlers/send-agent-message.ts)及[spawn_session](../../packages/shared/src/agent/spawn-session-tool.ts)。
- [现有 Tasks 并行执行](../../packages/server-core/src/tasks/TaskRunner.ts)及[文件范围规划指导](../../packages/shared/src/tasks/generator-prompt.ts)。
- [旧串行 fixture](../../scripts/verification/fixtures/resident-assistant-delegation.ts)和[旧失败矩阵 RW07](../verification/resident-assistant-failure-matrix-2026-11-03.md)。
