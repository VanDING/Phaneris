# 常驻助手委派启动、成果回执与 Source 激活：现场诊断

日期：2026-11-05，Asia/Shanghai。状态：只读调查完成，修复与修复后验收尚未执行。

本文补充[权限与记忆最终计划](../architecture/resident-assistant-permissions-memory-final-plan-2026-11-05.md)。调查对象是用户指出的 `261105-mild-river`，并追溯同一助手的前序委派。仅保存身份、状态、事件时间和代码依据，不保存任务正文、工具参数、私人资料或凭据。

## 1. 结论与证据边界

| 问题 | 现场观察 / 代码事实 | 判断 |
| --- | --- | --- |
| 委派后不开始 | `mild-river` 保持 accepted，只有派发输入，无 Runtime 事件；唯一队列阻塞项为前序 light-canyon 的 needs_attention | 队列将待处理任务当作工作区全局阻塞项；不是这个任务已经开始但模型响应慢 |
| 完成后没有成果回执 | light-canyon 后续用户输入已有最终回复，委派仍 needs_attention；rapid-sand 后续用户输入已有最终回复，委派仍 accepted | 原委派与后续输入/执行的关联不闭合；不能把同会话后来完成直接归为原委派成功 |
| 前序任务未正常收口 | 原执行出现上下文失效错误、SDK stopReason=error，却生成 Runtime reason=complete，且无最终回复 | 错误、执行结束、成果完成三者的语义不一致，缺少安全的重新准备与续作闭环 |
| 主助手无法主动激活 Source | 角色白名单同时在注册和 Host 入口限制 Source 工具；已有自动激活回调位于这些检查之后 | 属于角色能力过紧，需要接通已有 Host 连接机制；修改 permissionMode 无法单独解决 |

这些是现场数据与当前工作树代码相互对应的结论，尚未在隔离环境复现并验证修复，也未证明运行中的桌面进程加载的 bundle 与工作树逐字相同。上下文失效时具体哪项材料或能力发生变化，仍需补可观察原因，不能仅凭这条通用错误认定是权限拒绝。

## 2. 现场状态与时间线

取证根为本机 `Work` workspace；主助手 ID 为 `261105-copper-cloud`。下表是 2026-11-05 13:50:50–13:50:51 的元数据快照，时间均为 Asia/Shanghai。

| Session | 委派 ID | 委派状态 | 独立执行证据 |
| --- | --- | --- | --- |
| `261105-mild-river` | `c8a9a495-61f2-42b2-928d-69b9d3378f1e` | accepted，12:31:13 接收，result 为空 | Session 只有一条派发输入，Runtime 事件数为 0；配置为 allow-all，不能归因为本任务运行中等待权限 |
| `261105-light-canyon` | `aa62f4cb-94a7-4401-8c58-d479078d8bcd` | needs_attention，11:04:07 更新，result 为空 | 原执行无最终回复；11:04:13 用户直接继续，11:06:38 已提交最终回复并结束 |
| `261105-rapid-sand` | `ab308ad6-9526-428b-a9e7-a2a324a2f171` | accepted，11:13:12 更新，result 为空 | 原委派未被队列提交；11:15:11 的直接用户输入启动执行，11:22:00 已提交最终回复 |

light-canyon 的原始执行身份为 `run_assistant-work:aa62f4cb-94a7-4401-8c58-d479078d8bcd_1`，存在 permission decision 事件。最后一条工具结果已提交后：

1. 11:04:07.844，Session 保存错误 `Model context changed; prepare a fresh input before continuing`。
2. Runtime seq `256529` 保存 `assistant_response_observation`，stopReason 为 error。
3. 11:04:07.847，seq `256531` 将原执行记为 terminal / complete，但没有该次执行的最终回复。
4. 委派变为 needs_attention，错误说明为 `Session complete; inspect its original execution.`。
5. 后续直接用户输入使用新的 run 身份；seq `256735` 在 11:06:38.344 提交最终回复，seq `256739` 结束该次执行。原委派没有获得这份结果引用。

该助手已有的 5 条 result_ready 收件箱事件均记录为 delivered。light-canyon 的 decision_requested 和 needs_attention 通知也已经 delivered。因此本样本主要证明的是**成果未归入原委派，因而未产生相应 result_ready**，不能据此声称所有成果通知都丢失，也不能将“已交付待处理通知”解释为“已交付任务成果”。delivered 本身仍不代表用户已读或接受成果。

## 3. 代码落点

### 3.1 队列发生全局阻塞

[AssistantDelegation.pump](../../packages/server-core/src/resident-assistant/delegation.ts) 在取下一条 accepted 前查询整个 work 表，只要任意记录处于 preparing、submitting、submitted、needs_attention 或 cancel_requested 就返回。

现场唯一命中项是 light-canyon 的 needs_attention。这解释了 mild-river 已落盘却没有执行事件的状态。默认串行是合理产品选择，但一个已经停止、等待处理的任务不应无限占用整个 workspace 的执行槽；真实运行、共享资源冲突和待决事项必须分开表达。

不能简单删除 SQL 中的 needs_attention：需要先检查 Runtime 所有权、原执行是否结束、效果是否未知，以及后续任务是否使用同一资源。未知效果不自动重放，有冲突的资源继续受限，无关工作可以在默认串行规则下继续。

### 3.2 上下文保护有拦截，缺恢复与正确终态

[Pi Runtime 绑定](../../packages/server-core/src/runtime-adapters/pi-driver.ts) 会在 model/tool prepare 时检查上下文有效性；[SessionManager](../../packages/server-core/src/sessions/SessionManager.ts) 的 delegatedExecutionValid 检查材料依赖、资源存在性及 capabilityRevision。这类检查应保留。

当前错误没有说明具体失效依赖，也没有自动重建材料并恢复原任务的完整流程。[Runtime Host](../../packages/server-core/src/durable-runtime/execution/host.ts) 在收到 complete 时参考最近一条已提交 model outcome 纠正终态；本次失败发生在新的模型请求 prepare 边界，SDK 的 error 观察没有对应的新 model outcome，原 run 最近已提交的 outcome 仍为 toolUse。仅看最后 outcome 不足以覆盖这类错误。

修复应保存结构化失效原因，贯通 prepare 错误、SDK 观察、Runtime settlement、委派状态和界面。材料更新可以在原授权内重新准备；授权撤销、真实能力缺失或未知副作用需要明确停下。重建上下文不能重放已完成的写入。

### 3.3 后续输入与委派身份缺少闭环

[AssistantDelegation.complete](../../packages/server-core/src/resident-assistant/delegation.ts) 当前已包含 needs_attention 的完成匹配，但仍要求 event.inputMessageIds 包含原委派 inputMessageId；accepted 不在接收集合中。[SessionManager.notifyRuntimeCompletion](../../packages/server-core/src/sessions/SessionManager.ts) 使用当前执行的 lastSentMessageIds 生成完成事件。

因此，用户在同一 Session 发出后续输入后，完成事件属于新的输入，不能匹配原委派。仅增加 needs_attention 状态，或将 accepted 也加入状态查询，都不能解决身份归属问题。

工作树已有[原执行与后续活动投影](../../packages/server-core/src/resident-assistant/work-projection.ts)、[派生交付物登记](../../packages/server-core/src/resident-assistant/deliverables.ts)，应扩展这些机制，不另建第二套成果库。需要显式保留 delegation → input → run/attempt → continuation → result 关系：

- 能确定是继续原任务时，在同一授权下关联新的执行身份，幂等生成成果与通知。
- 无法确定归属时，展示“后续输入已产出结果”与来源，不静默宣布原委派成功。
- 用户直接启动了原队列中的 Session 后，必须核对并隔离旧派发输入，避免队列解锁时再执行一次。
- 已取消委派保持取消，后续直接用户输入及成果独立归属；不能取同会话最后一条 assistant 回填全部旧委派。

### 3.4 收件箱恢复还存在待验证风险

[ResidentAssistantService.deliverInbox / reconcileDeliveries](../../packages/server-core/src/resident-assistant/service.ts) 与 delegation 的 pendingEvents / finishEvents 区分 prepared、entered、handled、delivered、attention。自动消费只选择尚无消费记录的事件；部分中断恢复会转为 attention，之后不再自动选取。

这是代码审查发现的恢复边界，**未在本样本证明发生了通知丢失**。后续验收需要覆盖 admission 前后、ack 前后、最终回复持久化前后、主助手忙碌或进程重启等中断点。目标是事件允许重投，消费与交付幂等，不能依赖用户再发一句话，也不能重投时重新执行 Worker 任务。

### 3.5 Source 激活链被角色检查截断

[resident-role](../../packages/shared/src/agent/resident-role.ts) 的有限工具集合不包含普通 Source MCP 工具或 source_test。[Pi 工具注册](../../packages/pi-agent-server/src/index.ts) 据此过滤初始及动态工具；[Pi Host](../../packages/shared/src/agent/pi-agent.ts) 在 pre-tool-use 开头再次拒绝，因此后面的 source_activation_needed 分支无法被主助手正常使用。

已有[统一工具检查](../../packages/shared/src/agent/core/pre-tool-use.ts)能识别 Source 未连接，[SessionManager.onSourceActivationRequest](../../packages/server-core/src/sessions/SessionManager.ts) 会检查 source 存在、isSourceUsable、构建服务、更新会话 Source 并持久化。激活后 Pi 会重新执行权限检查。应接通这条机制，并补齐未注册工具的发现与会话激活入口。

不能通过直接放行 [source_test](../../packages/session-tools-core/src/handlers/source-test.ts) 代替：它的 autoEnable 默认为 true，可能修改全局 config.enabled，再激活会话。应区分会话连接与全局启用，避免重新打开用户已关闭的 Source。

## 4. 对最终计划的调整

先完成 P0 失败矩阵，然后按顺序实施：

1. P1a：任务阻塞隔离、上下文失效恢复、原输入与续作关联、成果与收件箱交付恢复。
2. P1b：主助手基础文件读取、Source 发现/会话激活/只读调用；保持原效果权限检查。
3. P2–P5：再进入目录迁移、自动记忆、Project 和知识体验。

Source 默认自主范围：用户已配置并允许启用、凭据可用、当前任务授权覆盖的来源，可以由助手按需在本会话连接、发现并调用被允许的只读能力。不自动创建来源、更换端点、扩大凭据范围、重新启用全局关闭来源或授予外部写入能力。连接中发生取消、撤权、配置变化时，后续调用以最新权限再次判定。

具体失败场景与可观察结果统一写入最终计划第 16 节。正式修复前先将现场模式改写为隔离数据 fixture；运行真实 Host/Runtime/Session/Source 和 UI 流程，保留可重复产物，不以生产数据执行回归。

## 5. 本机证据与复核

本次元数据产物位于忽略目录 `.cache/verification/resident-assistant-live-triage-2026-11-05/snapshot-02/`：delegation-metadata.json、runtime-metadata.json、session-metadata.json、manifest.json。manifest 保存取证时间、相关源码 hash 与产物 hash；它是只读观察记录，不是 E2E 通过证明。

采集脚本位于同级 collect.py，只使用 SQLite mode=ro / query_only 查询，输出字段采用白名单。复查时指定新的输出目录；已有快照不覆盖：

```powershell
python -X utf8 .cache/verification/resident-assistant-live-triage-2026-11-05/collect.py --workspace C:\Users\dotty\.phaneris\workspaces\Work --output-dir .cache/verification/resident-assistant-live-triage-2026-11-05/snapshot-03
```

各数据库与 Session 文件分开取证，不构成跨库原子快照；复查应比较状态是否变化。当前没有修改运行数据库、恢复或重新派发上述任务，也没有修改产品代码。后续现场恢复需要先核对任务仍有效、用户是否已自行完成、实际副作用和输入归属，再通过正常 Host 流程处理，不能靠批量改状态来解锁。
