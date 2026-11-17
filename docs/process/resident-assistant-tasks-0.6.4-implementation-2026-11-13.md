# 0.6.4 助手任务管理实施记录

状态：P0–P4 已实施并验收。本地 8 组工作流 / 170 个场景、3 个真实主助手与真实 Worker 样本 / 7 项检查通过；9 项工程门禁通过。用户于 2026-11-13 要求完整实施，随后明确授权改用已配置的 Command Goat，完成此前被官方 DeepSeek HTTP 402 阻断的真实模型验收。原规划中的调查和历史证据保持原义。

基线：`f79e18f28`。分支：`codex/resident-tasks-0.6.4`。

依据：[规划](../architecture/resident-assistant-tasks-0.6.4-plan-2026-11-08.md)、[实施前失败矩阵](../verification/resident-assistant-tasks-0.6.4-failure-matrix-2026-11-13.md)。

| 切片 | 状态 | 范围 |
| --- | --- | --- |
| P0 | 完成 | 已固定全计划失败矩阵；P1 的旧版失败已复现，建立真实 Host / RPC / Pi / Runtime 与实际 Board 容器的隔离 E2E |
| P1 | 已实现并验证 | Board 的助手直接子工作投影、规划字段、结果/复核/已结算取消的 Session 状态；历史状态保守边界见下文 |
| P2 | 已实现并验证 | 默认容量 4（workspace 可配置 1–16）、共用 Tasks 文件范围、前置依赖、统一配置变更和具体失效归因 |
| P3 | 已实现并验证 | 原分支与输入归属、20 项有界现场、Runtime 活动、Host 时间/容量/等待/省略数量 |
| P4 | 已实现并验收 | 非中断排队修订、实际读取回执、原授权续办、复核收口及重启/暂停/取消；Command Goat 上的真实并行、修订及分阶段续办样本通过 |

实施取舍：并发初始上限采用 4；简单前置依赖使用已有 Session 关联，复杂 DAG 仍走 Tasks；普通补充优先使用已有通信边界，明确区分投递受理与实际应用。普通 message 默认 queued；delivery=interrupt 才中断。等待、已受理、已投递和模型实际读取分别返回事实。

本轮不调整版本号，不执行发布，不操作用户现有 Work 任务。

## 已落地行为

| 范围 | 实际行为 |
| --- | --- |
| Board 投影 | 当前 workspace 隐藏助手的直接工作成为主卡，返回 managedBySessionId，Session 真实 parentSessionId 不变。普通子项、被归档父项的子项仍保留父项；handoff 不增卡 |
| 规划材料 | 新工作将委派说明与验收要求写入 Session 规划字段；接续既有 Session 保留原规划字段 |
| 子项执行提示 | 不再以 messageCount>0 推断完成；已保存而未执行的委派输入仍显示 pending，实际运行与最终响应分别取证 |
| 状态收口 | 有结果或失败进入 needs-review；显式 reviews.accepted 进入 done，rework 回到 todo，needs_user_review 保持待复核。单纯 ACK 和成果文件选择均不关闭工作 |
| 亲自验收 | 委派可固定 completionPolicy=user_review；Host 拒绝助手将该结果设为 accepted |
| 旧结果保护 | 校验当前 receipt seq、精确结果引用、原始要求及来源哈希、最新直接输入、人工状态变更和未结算效果。复核结论固定在原 Session 输入并可查询；同一结果/结论的重试保留首次理由，不因新措辞或 JSON 字段顺序失败；返工后的同一旧结果不能换成通过 |
| 状态归属 | Worker 对自己的开放状态更新和 Host 的自动结果分类保留管理归属；人工状态编辑、其他会话对它的编辑撤回自动收口权限；后续用户输入不会被旧任务接管 |
| 取消与恢复 | 仅对已停止且没有未结算工具效果的工作更新 cancelled；重启按原回执同步状态，不猜测不确定效果。状态写入失败不会擦除 Runtime 终态或冻结后续队列；取消请求在无活动执行/未知效果后继续结算，准备完成不会复活取消，持久化等待之后在输入准入前再次核对取消与资源 lease |
| 材料撤回 | 新接入的任务说明也受材料有效性约束：派生来源被撤回后，任务元数据不会从请求包装或 handoff 接续重新注入模型。原 Board / 历史记录保留 |

复核通过表示授权范围内的工作达到要求，不表示用户已读、满意或归档。该能力走受约束的结果复核入口；普通 set_session_status 仍禁止 Agent 自行设置 closed 状态。

## 验证与复现

基线旧行为在 `.cache/verification/resident-assistant-tasks-wzNx94/` 留下失败记录：助手直接子项的 parentId 未投影，不能成为主卡。随后固定了 Worker 主动设置开放状态导致管理归属被误撤回的失败，记录在 `.cache/verification/resident-assistant-tasks-sLHNXh/`。完整实施最终本地验收覆盖 170 个场景（包含 34 个原生 Electron 场景），9 项工程门禁通过。此处属于首批 P1 历史验证，见本地首批机器结果 `docs/verification/results/resident-assistant-tasks-p1-2026-11-13.json`；后续完整实施以本记录新增验收与最终机器摘要为准。

| 命令 | 验证范围 |
| --- | --- |
| bun run verify:assistant-tasks | 17 个专项场景；真实 Host、RPC、Pi 工具发现/调用、Runtime、Session 持久化及真实 KanbanBoardContainer。包含新旧工作、handoff、搜索/归档收纳、排队输入、状态收口、亲自验收、错误、人工介入、旧 seq、未读取结果及重启 |
| bun run verify:assistant-delegation | 64 个现有委派回归场景 |
| bun run verify:assistant-control | 23 个现有控制与接续回归场景；包含撤回材料恢复路径 |
| bun run verify:assistant-tasks:scheduling | 9 个调度场景：真实四路重叠、超额容量等待、暂停恢复、共享读/写、Tasks 共用 lease、依赖及优先级 |
| bun run verify:assistant-tasks:configuration | 6 个配置场景：Worker 直接改模式、启动 clamp、运行中变更、响应边界权限归因、合法恢复及无关分支隔离 |
| bun run verify:assistant-tasks:management | 14 个闭环场景：排队修订、成功请求读取证据、原授权/Session 接续、重复后续拒绝、有界概览、混合 A/B 精确来源范围、重启/暂停/取消、已复核原 Session 在新阶段开始前恢复开放状态 |
| bun run scripts/verification/resident-assistant-deliverables-workflow.ts | 3 个成果清单与版本回归场景 |
| bun run verify:assistant-ui | 34 个原生 Electron 场景与浅/深色、390px、容量和任务详情截图/trace |
| bun run typecheck:all / bun run lint | 全工作区类型及工程门禁 |
| i18n 四项、identity:check、version:check、check:docs | 翻译、产品身份、版本及文档一致性 |

专项运行产出 manifest.json、task-evidence.json、board-input.json、board-light.png、board-dark.png 和 board-trace.zip；manifest 记录输入源码与文件哈希、命令、运行时及未覆盖项。浏览器读取本次真实 Host 的 Session 和 Board 投影，未在 fixture 中另写父项投影算法。主题通过生产 ThemeProvider 生效；状态截图冻结动画，不将主题切换中间帧作为结果。

## 后续切片的实际行为

| 范围 | 实际行为 |
| --- | --- |
| 真并发 | 每个普通 Session 沿用原 Runtime slot；达到容量后显示 capacity 等待；一个资源等待不阻塞无关工作。startPaused 在重启后保持暂停 |
| 资源协调 | 与现有 Tasks 共用 canonical file-scope leases；共享只读可并行，重叠写入等待。未声明范围的可写任务保守占用工作目录；中断/恢复待检查的未声明范围继续保留排他等待，返回持有者引用；这只是调度声明，不是沙箱 |
| 前置关系 | dependencySessionIds 使用原 Session 规划字段；仅 done 放行，结果就绪不等同 done；失败、取消、缺失有具体等待原因，循环在规划边界拒绝 |
| 配置归属 | Worker 自身改模式进入同一持久 configure 命令；启动 clamp、Session 和任务有效配置一致。助手前台的执行模式控件调用独立 Worker 上限 RPC |
| 失效原因 | 材料撤回、任务分支要求、附件、权限上限、配置、能力变更分别定位；记录 prepare/tool/response 边界及真实请求/尝试引用。无关分支切换或休眠不撤销本任务 |
| 任务现场 | 原模型请求附带最多 20 项 resident_tasks，提供原目标、Session 状态、真实 Runtime 活动、Host 时间、等待、占用和 omitted；详情仍按原入口读取，不另建工作状态库 |
| 修订通信 | 普通补充通过现有 Session 准入与 FIFO 队列，不停止原轮次或重建 driver；显式 interrupt 沿用安全中断。新快照只绑定本任务材料及相关补充，不继承整个前台上下文；源自原用户同条混合输入的材料在 Host 与固定 goalQuote 范围求交，不能靠选中一个混合分支把 B 带给 A |
| 控制证据 | delivery 区分 staged/queued/delivered；processedAt 来自成功且未过期的 model_outcome_committed.consumedInputIds，不以命令 ACK 推断读取 |
| 空成果选择与复核重试 | 无清单的纯文字/旧结果可显式选择零文件，不隐式发布任何文件；先校验已知清单/版本错误，再写 Session 复核。重复复核只比较真实结果 ID 和结论，保留首条理由；更换结论仍被拒绝 |
| 最终结果 | 尚有已接受修订时，前轮输出不封为最终任务结果；最新授权轮次完成后再封存。report_task_result 使用实际活动配置的工作目录，可从 get_session_info.taskResultRevision 获取修订版本 |
| 原授权续办 | goalQuote 固定整项已授权目标，包含后续阶段；instructions/acceptanceCriteria 限定当前阶段，不能靠说明正文扩大授权。assistant_work.goal 返回完整固定引用。continuationOf 要求精确结果已复核、原用户源/hash/quote 未撤回、范围和项目不扩大；返工沿用原 Session。每个结果最多一个后续委派，重试复用原 requestId；已复核 done 的原 Session 在新阶段准入时恢复 todo，与新输入及状态 guard 同写，最终复核再收口；人工改状态会拒绝旧续办。内部通知不能创造授权 |
| 恢复边界 | 暂停和取消会移除实际 Runtime 队列中的相应管理输入；人工直接介入保留独立归属。重启按原输入接续，既不重复记录准入事件，也不把保存的 queued 标记冒充真实 Runtime 队列 |

容量保存在 workspace config.json 的 `assistantTasks: { concurrency: 4 }`，允许 1–16；未配置为 4。配置在调度边界读取；修改后重启可立即按新值重建队列，不新增前台容量设置界面。

新增独立脚本：`verify:assistant-tasks:scheduling`、`verify:assistant-tasks:configuration`、`verify:assistant-tasks:management`。`verify:assistant-tasks:all` 重建 Pi 子进程后执行确定性专项与现有控制/委派/成果回归；付费样本单独通过 `verify:assistant-tasks:live` 启动，避免普通回归隐式调用外部模型。

本地 Electron 已重新构建并通过 34 个 UI 场景；浅/深色、390px、真实任务详情与容量提示截图及 trace 留在对应 manifest。构建器的依赖外部化与动态导入告警保留在日志，未据构建通过声称这些既有告警消失。

## 真实模型验收

用户于官方 DeepSeek 返回 HTTP 402 后明确选择已配置的 Command Goat。使用其目录中的 `deepseek/deepseek-v4.1-flash`，主助手和每个 Worker 都调用真实模型；只传合成输入，不操作现有 Work 或真实个人材料。

| 样本 | 通过检查 | 最终证据 |
| --- | --- | --- |
| 独立并行 | 两个真实 Worker 请求区间重叠；A/B 请求材料无对方代号；无关聊天不停止它们；主助手读源复核，两项 Session 为 done | `.cache/verification/resident-assistant-tasks-live-LndZzi/parallel/`，3 项检查，19 次真实请求 |
| 运行中修订 | 主助手向原 Worker 发送 queued 补充、不停止原尝试；模型实际读取修订，上限由 5 改为 11；主助手复核最新结果并收口 | `.cache/verification/resident-assistant-tasks-live-LndZzi/revision/`，2 项检查，19 次真实请求 |
| 原授权分阶段续办 | 切换到无关用户输入后，通知驱动主助手核验 143，再在同一 Session 和原用户授权下计算减 17，结果 126；两次真实结果都有明确复核引用 | `.cache/verification/resident-assistant-tasks-live-iktOGR/continuation/`，2 项检查，19 次真实请求 |

并行/修订样本所在组合运行的后续旧版续办样本失败，因此该父 manifest 的 exitCode=1；两个子样本已先通过所有断言并退出 0，父流程随后才进入续办。最终报告按子样本事实与哈希记录通过，不将该父运行伪称全绿。修正结果身份比较后，最新续办样本单独复跑通过，其父 manifest 为通过。

真实样本暴露并已修正的问题：初次 goalQuote 只固定第一阶段，Host 正确拒绝第二阶段；现已在 schema、角色和工具说明中明确整项目标与当次执行范围的区别，保留严格原授权检查。另补齐已完成原 Session 新阶段开始前恢复 todo 的状态写入，并通过新增确定性场景及真实续办复验。对同一结果的比较现按 Session ID / 消息 ID 逐字段进行，不以 JSON 序列化字段顺序判定身份；相同结论的重试保留首次理由。无清单的文字结果允许空文件选择，空选择不会隐式发布旧文件。原用户的混合来源材料按固定授权范围收窄，指令也不得复制其他任务代号。

验收代理也做了实际修正：请求体含完整工具 schema，原 512000 字节预算不足；普通样本现限制 20 次请求 / 2 MiB 输入，两阶段样本限制 28 次 / 3 MiB，均限制累计输出 25600 token（使用真实 usage，缺失时按请求上限预留）。沿用配置目录的 thinking-off 映射；按 SSE [DONE] 结束流，避免终止标记之后的传输关闭被报成推理失败。早期并行样本保留原代理的 stream_failed 告警；最终选择的三个样本共 57 次请求，均为 HTTP 200 / completed。验收等待每项通知进入 delivered 且主助手轮次结束，核对 delivery 指向的实际最终回复包含相应结果；不在复核 ACK 时提前停止测试。

按本机已验证连接完整重跑（仅设置当前验收进程，不更改应用默认连接）：

```powershell
$env:PHANERIS_064_LIVE_CONNECTION='pi-api-key-3'
$env:PHANERIS_064_LIVE_MODEL='deepseek/deepseek-v4.1-flash'
$env:PHANERIS_064_LIVE_MODES='parallel,revision,continuation'
bun run verify:assistant-tasks:live
```

Command Goat 计费口径仍未知，账本只记录请求、字节、token 用量及硬上限，不推算实际扣费或声称金额上限。官方 HTTP 402、预算不足和旧授权引用失败均保留原失败产物，没有覆写。

## 保守边界与未覆盖范围

- 一次通过的管理工作流记录到 Windows 临时 EPERM（Session 原子替换）；清理后无遗留 .tmp，断言及产物哈希通过。该瞬态文件系统告警保留在验证记录中，未据此声称所有日志无告警。
- 官方 DeepSeek HTTP 402 的首次失败保留在 `.cache/verification/resident-assistant-tasks-live-RtKKvK/`；最终 TM18 使用用户明确选择的 Command Goat 完成，不据此声称官方接口已恢复。
- 本轮以前没有 statusControl 的历史委派不追认自动状态所有权，不根据旧 ACK 或旧 reviewed_at 批量改为 done；其 Board 工作仍可见，可由用户收口或在原 Session 安排新一轮工作。
- 确定性专项使用隔离 loopback 响应，但 Host/RPC/Pi/Runtime/Session 与原生 Electron UI 均为真实链路。真实模型三个样本已通过；没有继续重试官方接口，没有替换安装版或操作现有 Work 数据。真实样本只证明所列场景与当前模型，不推广为所有模型均已验收。
- 运行环境为本机 Windows / Bun 1.4.3；仓库声明固定 Bun 1.4.4。运行时版本记录在 manifest，本记录不等同于固定发布运行时、安装包或其他系统的验收。

完整机器摘要保留在本地 `docs/verification/results/resident-assistant-tasks-0.6.4-2026-11-13.json`。该摘要分别记录通过项、保留的失败尝试、最终真实样本、源码哈希与未覆盖范围。

## 提交保留的证据指纹

按仓库验证政策，本地运行原物和生成的机器摘要不进入 Git；以下记录对应来源与 SHA-256，未将本地文件伪称已归档。完整原物仍在本机，可按上述脚本重跑。

| 证据 | 本地来源 | SHA-256 |
| --- | --- | --- |
| resident-assistant-tasks | `.cache/verification/resident-assistant-tasks-7NxqdU/manifest.json` | `d68aa7b9b7fce447f1ba08a107fe0ca2874edb34b46e7089c2a754188e5b7f69` |
| resident-assistant-scheduling | `.cache/verification/resident-assistant-scheduling-zmBapH/manifest.json` | `b9befc6eef05324050f42862f4b7ffd7a98818e72ed9702f936f1b3993d24fff` |
| resident-assistant-configuration | `.cache/verification/resident-assistant-configuration-5RJIXM/manifest.json` | `0378d56e240b30a391696b757539d102d274c01e15a547c982abdf7833f136b5` |
| resident-assistant-management | `.cache/verification/resident-assistant-management-GAYIcX/manifest.json` | `b71dd76f573f2ed2b2dfd62a4b739cda717e43dec6d328a754fc5e1c989674a6` |
| resident-assistant-control | `.cache/verification/resident-assistant-control-6FSiFU/manifest.json` | `d26f64aeb6ea79e02b4768bed5492e0d14c44957dea64e683fedf9861d51ee31` |
| resident-assistant-delegation | `.cache/verification/resident-assistant-delegation-JfN5z0/manifest.json` | `1eb2f90347021561da985a38686c5a904bae579d2831b632f3bcd4d1337eeb46` |
| resident-assistant-deliverables | `.cache/verification/resident-assistant-deliverables-VwOCEo/manifest.json` | `0b10283ef2c13494fd95eb6b9ee421acb39a3a4bc0859c3d1543ec9c31ab6702` |
| resident-assistant-ui | `.cache/verification/resident-assistant-ui-nFYvGq/manifest.json` | `75a14ca4a0ebc5a85edae6afca7c5914d8ce25b5a82681d34400eb83cf40fec6` |
| real parallel | `.cache/verification/resident-assistant-tasks-live-LndZzi/parallel/live-evidence.json` | `e593c4e07239eef8372b97f75f092558224e2e4d75b0ebca6356bb450417bd8d` |
| real revision | `.cache/verification/resident-assistant-tasks-live-LndZzi/revision/live-evidence.json` | `49162a37e2c0f8639094a246cf13dc725366b2dceecbc1fc29a9153afd19d628` |
| real continuation | `.cache/verification/resident-assistant-tasks-live-iktOGR/continuation/live-evidence.json` | `a05f0c3eda32be10ae508335f4580d4e37888be39ce8853cea80d5528d17e37c` |
