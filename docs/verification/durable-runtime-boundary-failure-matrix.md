# Durable Runtime 边界迁移：实施前故障矩阵

状态：故障方式于实施前写定（2026-10-10）；B0–B5 已实施。下表是要求，第 5 节另列实际覆盖，不能把要求本身当作通过证据。

源码基线：`dbd32f60b5d90e20b1bc2b231035baf6b171ddc2`。

设计依据：[让 Durable Runtime 拥有自己的边界](../architecture/durable-runtime-boundary.md)、[已接受的 Durable Runtime ADR](../architecture/durable-agent-runtime.md)。

## 1. 验证边界

需要同时证明两件事：持久化保证没有退化；完整执行已不需要 SessionManager。已有 Coordinator 测试只覆盖其中一部分。

新增验证优先使用真实 Runtime/SQLite、真实 Pi JSONL 子进程和 loopback provider；外部副作用用受控文件/HTTP 计数器替代。故障点以可观测事务/协议屏障触发，不靠任意 sleep 猜时序。Runtime 独立入口不得导入或构造 SessionManager，且不得伪造 T1/T2 的成功回执。

先实现对应故障场景与断言，再改生产路径。下表“要求”是目标验收标准，不表示现有代码已经满足。

## 2. 失败方式与可观察要求

| ID | 触发/故障方式 | 要求 | 证据与阶段 |
| --- | --- | --- | --- |
| F01 | 新 Runtime 模块通过 type import、barrel、动态 import 或 getter 重新取得 SessionManager/ManagedSession | 静态边界门禁拒绝；移除该具体实现后独立入口仍可加载 | 依赖报告、独立入口模块闭包；B1/B2/B5 |
| F02 | T1 因只读、忙、写失败或身份冲突未提交 | 外部模型/工具调用次数为零；不发出已执行的工具开始状态 | DB 与外部计数器；B1/B2 |
| F03 | 在 T1 后、effect 前或 effect 后、T2 前强杀 | 两者均按未知处理；重启两次仍不自动重放 | effect marker、recovery verdict、重复恢复快照；B1/B2 |
| F04 | T2 提交后、通知前强杀；或通知消费者抛错 | canonical outcome/usage 可补读，重复订阅不重复记账；不因 observer 失败重跑 effect | cursor、journal、ledger、调用计数；B2/B3 |
| F05 | 同一批工具逆序完成，一项仍未 settle；工具身份或参数哈希被替换 | 未全部 settle 不推进父 checkpoint；模型结果仍按来源顺序；错身份拒绝 | 子 operation 列表、父状态、下次模型请求；B2/B3 |
| F06 | `completeRun` 因未完成 tool/model 返回 parked，但驱动报告 complete | Host 区分停止与成功；TaskRunner 不推进成功依赖；UI 可停止动画但保留恢复提示 | Host/Task 事件轨迹与 DB；B0 先复现，B3 收口 |
| F07 | 结束事务失败且队列里还有输入，同时浏览器清理或完成 listener 抛错 | 保留运行身份与可恢复状态；不伪造成功或自动继续依赖该结论的执行；产品清理异常不吞掉 durable 结果 | 状态轨迹、下一轮调用计数、错误诊断；B0/B3 |
| F08 | 快速重复发送、steer ACK 迟到/丢失、合并消息、附件输入、hidden source 重试 | 每个原始输入 ID/原文保留；unknown 不自动重发；不能丢附件或把 hidden 变可见；有效 prompt 与原始输入可区分 | admission、SDK receipt、兼容 JSONL、provider 请求；B3/B4 |
| F09 | 原始输入已保存但尚未 acceptRun；或已尝试 steer，在 queue/receipt 持久化窗口崩溃 | adapter 标明恢复证据；Host 不以缓存缺席证明未交付；旧数据证据不足明确停放；行为调整单独记录 | 崩溃点、兼容候选、canonical 事实、调用计数；B0/B3 |
| F10 | 上一 generation 的事件、异步 decision 或取消完成到达新 run；同时新输入/stop 竞争 | 不改变新 run 的状态或消息，不让新 run 意外中止；取消通道不被整轮执行锁堵住 | 按 run/generation 的轨迹；B3 |
| F11 | 模型 `length`、权限拒绝、用户取消、异常退出分别结束 | 保留不同结束原因；不把截断当成功；本次不新增自动 length 续跑 | terminal/parked、最终文本与调用数；B2/B3 |
| F12 | 主 run 已停，cache warm、decision、image、title 或 compact 的 outcome 才返回 | 独立记账且不改变主 checkpoint；SDK/model 与展示层不重复记账；删除 Session 也不误归属 | operation ID、purpose、usageId、ledger；B4 |
| F13 | task dispatch 后崩溃；对账时 registry 部分加载、读取失败、child 缺失/已删除或出现多个候选 | 有证据才下结论；不把未知缺席当 definitely_not_executed；重启不盲目重派节点 | 对账覆盖范围、证据、task facts、child 输入和调用数；B0/B4 |
| F14 | handoff 在生成、文档落盘、child 创建、child admission 前后崩溃，并穿插 stop/晚到输入 | 旧 run 不继续消费转交队列；不重复启动 successor；原始晚到输入、附件和取消语义保留 | handoff 元数据、两侧输入与 run 身份；B4 |
| F15 | 主对话、标题、凭证读取同时触发首次初始化；source/tool sync 迟到或重启 | 单一初始化所有者；首次 prompt 前完成所需策略/工具同步；首轮工具集符合后续轮次 | 真实 Pi 协议和 provider tools；B2/B4 |
| F16 | canonical/UI parity 不一致、历史会话无 runtime facts、模型上下文分支含旧数据 | 原有 rollout/legacy 规则可解释；不伪造 T1 证据；上下文没有重复用户消息/工具结果 | parity、选用来源、下次 provider 请求；B1/B4 |
| F17 | 并发运行中修改连接/模型、收紧权限、切换 source，随后 idle eviction | 旧配置结果不覆盖新配置；权限收紧仍生效；活动 driver 和未收敛 effect 不被误回收 | 配置版本、权限结果、driver 生命周期；B3/B4 |
| F18 | workspace A 请求 workspace B 的 recovery/effect/usage；adapter 使用错误 scope | 公共接口拒绝或返回无权数据的空结果；不执行、不泄漏跨 scope 事实 | 访问结果、两侧 DB 与调用计数；B1/B2 |
| F19 | headless 启动无客户端；shutdown/工作区关闭时还有工具、预热、utility 回调或维护任务 | 本地恢复不依赖 UI；停止新输入；收敛/留下恢复证据后关库；迟到回调不写已关闭 DB | 启停日志、句柄关闭、重启恢复；B1/B4 |
| F20 | Electron/headless 分别装配；兼容 RPC ACK 前强杀；TaskRunner 等待 sendMessage；Task completion listener 重入 | 同一 Runtime 实现及顺序契约；ACK 前失败不伪装成功；ACK 后输入可找回；sendMessage 不因新 admission 接口提前返回；当前通知不被新订阅重复消费 | 启动入口身份、RPC/调用完成轨迹、重载与监听计数；B4/B5 |
| F21 | 路由回滚时还有 parked run 或迟到辅助 effect；旧 reader 读新格式 | 无第二个执行所有者，不删库、不从缓存恢复写权威；不兼容的旧 reader 拒绝启动 | 回退版本、DB 哈希、恢复报告；B5及每次格式变更 |

F06/F07/F09/F13 必须先记录基线结果。若现有行为违背要求，应形成独立的语义修正及回归证据，不能通过降低断言把抽取报告做绿，也不能仅凭本表宣称已确认缺陷。

## 3. 可复用的现有验证

以下为源码已有的覆盖基础；本轮实际复跑与永久产物见第 5 节，不能用内核单测代替独立宿主 E2E。

| 现有入口 | 可复用部分 | 仍缺少的证明 |
| --- | --- | --- |
| [process-crash.test.ts](../../packages/server-core/src/durable-runtime/process-crash.test.ts) | 真实进程在 model/tool 的 T1/T2 前后退出与恢复 | 完整 Host/Pi/Session adapter 链路、永久验收产物；该测试清理临时目录 |
| [coordinator.test.ts](../../packages/server-core/src/durable-runtime/coordinator.test.ts)、[store.test.ts](../../packages/server-core/src/durable-runtime/store.test.ts) | 事务、身份、usage、恢复等内核回归 | 上层终结/排队契约以及无 SessionManager 的完整运行 |
| [projection-runner.test.ts](../../packages/server-core/src/durable-runtime/projection-runner.test.ts)、[projection.test.ts](../../packages/server-core/src/durable-runtime/projection.test.ts) | reducer 与 cursor/snapshot 恢复 | observer 故障时的端到端补读与客户端投影 |
| [Pi startup workflow](../../scripts/verification/pi-110-startup-workflow.ts) | 真实子进程初始化及首轮工具集 | 此入口的 durable boundary 是桩；不能据此证明 T1/T2 持久化 |
| [context-handoff-e2e.isolated.ts](../../packages/server-core/src/sessions/context-handoff-e2e.isolated.ts) | 当前产品交接流程 | Host 接管输入/停止后的相同交接与故障点 |
| [Pi compatibility workflow](../../scripts/verification/pi-110-compatibility-workflow.ts)、[Pi history workflow](../../scripts/verification/pi-110-history-workflow.ts) | 当前 SDK/历史数据兼容回归 | 新模块边界下的实际接线和故障恢复 |
| [decision chat semantic workflow](../../scripts/verification/decision-chat-semantic-workflow.ts)、[session decisions workflow](../../scripts/verification/session-decisions-workflow.ts) | 输入语义、决策事实和记账路径 | 改用 Runtime API 后仍无重记、迟到跨 run 污染 |
| [test-critical.ts](../../scripts/test-critical.ts) | 现有关键回归组、孤立进程执行约定 | 本次边界门禁和独立宿主验证需明确接入，不能默认已被该脚本涵盖 |

## 4. 验证产物约定

B0 确定了 runner 和产物格式；实际入口见[验收说明](./results/durable-runtime-boundary/README.md)。

每次结果至少包含：

1. `schemaVersion`、基线/被测 SHA、工作树 dirty 状态、OS、实际 Bun/Node/Pi 入口与版本。
2. 完整重跑命令、隔离配置目录、故障点和屏障确认；不可引用个人凭证。
3. 每项 F-ID 的 `pass/fail/not_run`、可观察断言、run/session/effect/input 身份及原因。
4. 规范化提交事实、operation 终态、projection cursor、usage 摘要、外部调用次数。
5. 安全的测试 DB 快照或可核验导出及哈希；保留 effect marker 与结果 JSON 后再清理临时执行目录。
6. 真实子进程退出证明和资源关闭记录；不得将超时/跳过当通过。

结果归档到 `docs/verification/results/durable-runtime-boundary/`；必要的临时数据可以留在隔离缓存目录。比较新旧轨迹时可归一化时间/随机 ID，但必须保留身份对应关系、因果顺序和 effect 次数，避免掩盖重复提交或提前执行。

设计文档检查与行为测试分别报告。下列覆盖记录明确区分已运行路径和未穷举的故障组合。

## 5. 实施后的覆盖记录

| ID | 已运行证据 | 覆盖限制 |
| --- | --- | --- |
| F01 | 解析后的新旧依赖图；独立 Pi 入口；违规图谱产生 23 处拒绝 | 不代替所有第三方包的安全审计 |
| F02/F03/F04 | 8 组真实进程故障屏障：model/tool 的 T1 失败、T1 后、effect 后、T2 后；两次独立恢复；effect marker、DB 哈希；Host observer 抛错 | 使用受控文件副作用；未穷举 SQLite busy/磁盘耗尽或每一种 Pi 进程内断点 |
| F05 | 双工具逆序完成、错 session 拒绝；真实 Pi canonical tool context | 更大批次和每种参数变换仍依赖现有 identity 回归 |
| F06/F07 | 基线真实 SessionManager/SQLite 复现；新 Host 停放、SQL terminal/assistant 提交故障与队列保持；独立 Pi 正常终结 | 非所有存储故障注入组合 |
| F08/F09 | 基线 unknown receipt 被重派的复现；新版尝试事实、safe/unknown/legacy 候选恢复；61 项产品工作流含 hidden 重试、附件和合并；相关 Session 现有回归 | 未强杀每个附件落盘窗口 |
| F10 | stale handle 拒绝；完成通知重入 admission；取消/decision/source 回归 | 未穷举所有调度顺序 |
| F11 | length/error/aborted canonical outcome；超过 1,000 条进度事实后的收尾；已有 Pi length/stream 关键回归 | 仍不启用自动 length continuation |
| F12 | 前台结束和会话释放后的独立 paid image；图像、决策及标题工作流；真实 Pi utility/cache warm 产品验证 | 每种辅助调用的每个迟到时序未穷举 |
| F13 | 基线缺席 verdict 复现；新 adapter unknown/review；现有 task-node reconciliation 回归；产品任务工作流 | 没有新增 child dispatch 的全阶段强杀矩阵 |
| F14 | context-handoff 独立产品 E2E 两项；生产 child admission 屏障和 parent stop 检查 | 文档/child 各 phase 的强杀组合未全部验证 |
| F15/F16 | 首轮与后续工具集、真实模型请求 context；并发首次初始化失败/释放/重试；projection/legacy 回归及标题测试 | 历史数据全集未迁移或全量 shadow 评估 |
| F17 | idle memory、配置/连接刷新、权限/插件/source 现有回归 | 未量化性能收益；没有新配置机制 |
| F18 | Host workspace 绑定、effect session 身份及产品 RPC 的 foreign workspace 拒绝 | Runtime API 是内部受信任能力；外部用户授权仍由 RPC/产品层执行 |
| F19/F20 | 有限时限 shutdown、late callback 开库拒绝、重复初始化及通知重入；真实 Pi 进程关闭 | 新旧 owner 热切换未实现；生产没有双执行路由 |
| F21 | 有效 SQLite backup/restore，活动执行时拒绝恢复；保存 DB 哈希 | 没有启动旧二进制；未知/parked 交付不能安全自动回退到基线代码 |

当前覆盖证明所有权迁移和主要失败语义，不表示 F01–F21 的每个描述组合都已完成故障注入。结果与基线门禁问题独立记录，见[验收说明](./results/durable-runtime-boundary/README.md)。
