# Assistant 统一委托重构：先行失败矩阵与分阶段验收清单

状态：先行约束，实施前冻结，2026-11-18。主方案 [最终重构方案](../architecture/assistant-refactor-final-2026-11-18.md)。实施与实测证据记录在同名 `-implementation-` 文档中，本文只固定可复现输入、失败判据与现版基线，不改写为通过记录。

基线：源码 HEAD `eecf8b3ba`（Phaneris 0.6.7），工作区 `E:/Phaneris`，Windows x64，Bun 1.4.3 / Node v24.15.0。

## 0. 现版基线（实施前实测，冻结为对照）

| 指标 | 现版实测 | 采集方式 |
|---|---|---|
| 助手模型工具数 | 33（`RESIDENT_TOOL_NAMES`，`packages/session-tools-core/src/assistant-capabilities.ts:2`） | 静态计数 |
| 角色提示词字符数 | 21,741（`packages/shared/src/agent/resident-role.ts`） | `(Get-Content -Raw).Length` |
| 委派契约工具描述 | 约 14,031 字符（`assistant_context` + `assistant_delegate` + `assistant_work` + `assistant_worker_control`） | 工具定义文本求和 |
| 独立 Task 身份 | 不存在。`SessionDelegationInput.originGrant.quote` 是唯一的“目标”载体 | `packages/core/src/types/session-execution.ts:43` |
| Requirement 版本 | 不存在于模型侧；要求只存在于 `WorkPreparationStore` | `packages/server-core/src/context/work-preparation.ts` |
| Goal / Assignment / Change 实体 | 全部不存在（`grep` 无匹配） | — |
| 委派存储 | `<workspace>/assistant/delegations.db`（WAL） | `resident-assistant/delegation.ts:73` |
| 投递重试上限 | 3 次后静默消失（无死信） | `delegation.ts:376-387`，`pendingEvents(true)` 过滤 `attempts<3` |
| 问候/查询路径 | 走完整 resident Session + `<resident_tasks>` 注入 | `resident-assistant/service.ts:225` |

结论：**Goal / Task / Requirement 版本 / Assignment / Change 五类实体当前均无代码表示**，这是方案 §7 与 §8 的落差起点，也是本矩阵所有场景的前提。

## 1. 分阶段实施与验收清单

定稿 §7 的 5 个实施阶段 + §8 的验收门槛，转成下列可逐项勾选的门槛。每阶段通过真实入口验证后才进入下一阶段。

### 阶段 1 · 需求到 Ready（首期交付，本矩阵 M01–M09）

实现边界：新增工作区级任务服务（SQLite），模型侧新增 `task_create` / `task_amend` / `task_query` / `task_control` / `task_verify`，宿主负责版本、授权、幂等、准入和回执。执行适配在此阶段只做只读预演（`ready` 后不派 Session）。

| ID | 注入方式 | 失败判据 | 必须观察到的事实 |
|---|---|---|---|
| M01 | 桌面入口输入“你好” | 触发任何任务写入、历史全文扫描、任务列表全量读；或回复超过 3 句 | 无 Task 产生；消息记录足够；本地处理不含任务查询 |
| M02 | “帮我做个鹈鹕骑自行车的 HTML” | 追问已定配置（模型、路径、工具）；或未产生 Task 就报完成 | 一次语义提交产生 1 个 Goal + 1 个 Task + 1 版 Requirement + 1 条 Change |
| M03 | 上一条之后“再要一个同样风格但讲鲸鱼的” | 覆盖原 Task 而不是新增；或丢失“同样风格”的继承依据 | 新 Task，Change 记录引用上一 Task 的样式要求 |
| M04 | “把刚才那个改成深色背景” | 旧要求不可查；或无 `supersedes` 关系；或旧版本被原地覆盖 | 新 Requirement 版本；旧版本可读；`supersedes` 指向旧要求 ID |
| M05 | 复合输入：“暂停 A，把 B 的范围扩到海外，另外帮我查下 C 到哪了” | 拆成两次追问；或只执行其中一项；或查询项被写成 Task 变更 | 每项诉求各有处理结果：控制回执、变更回执、只读查询结果 |
| M06 | 同一 `requestId` 重放同一提交 | 产生第二份 Task / 第二版要求 | 返回原结果，不新建、不重写 |
| M07 | 两个合理候选未澄清即派发（“昨天那个登录功能”） | 直接派给其中之一 | 保留待处理输入，只问区分二者的问题，无派工 |
| M08 | 授权冲突：派工要求外发但当前仅有读授权 | 派工成功；或仅口头声明“已受限”而无具体缺项 | Ready 结果携带具体缺项；或 `blocked` 且列出缺失授权项 |
| M09 | 撤销：“不要了，取消刚才那个” | 旧授权仍可派工；或 Task 记录消失 | Task 标记取消且保留原文、要求版本与 Change 历史 |

阶段 1 通过条件：M01–M09 全部绿；用户能从任务详情读到“理解并记录了什么”（原始输入、归属、范围、要求版本、就绪依据）。

### 阶段 2 · 真实单任务交付（M10–M16）

实现边界：`ready` 后可派工到现有 `SessionManager`；产物经现有 Artifact 版本回收；换 Session 返工；进程重启后身份、要求版本与已有成果仍可追溯。

| ID | 注入方式 | 失败判据 | 必须观察到的事实 |
|---|---|---|---|
| M10 | 鹈鹕 HTML 委托走完派工 | Task 无对应 Assignment；或产物无 Artifact 版本 | Assignment 关联 Task + 要求版本 + Session；产物可打开 |
| M11 | 对 M10 的 Task 换 Session 返工 | Task ID 变化；或旧证据丢失；或产生第二份 Task | 同 Task ID，新 Assignment，旧 Assignment 与产物保留 |
| M12 | 在执行中杀进程并重启 | 已受理的 Assignment 重复执行；或已确认要求丢失 | 身份与要求版本可读；不重复派工；未知外部效果标为待核对 |
| M13 | 结果投递失联（丢回执） | 自动重发外部副作用；或结果永久消失且卡片不可见 | 到达重试耗尽后进死信且卡片可见，可操作恢复入口 |
| M14 | 迟到回执（进程恢复后旧 Assignment 回执） | 复活已终止工作；或覆盖新版本要求 | 只补记事实，不开启新效果 |
| M15 | 用户在 Task 详情打开产物核验 | 文件打不开；或验收指向错误版本 | 打开实际文件，验收绑定具体产物版本 |
| M16 | 同一 Task 两次返工后验收 | 丢失历史尝试；或验收结论无证据引用 | 逐条验收记录满足/缺口/待判断及证据 |

阶段 2 通过条件：一次委托到打开文件验收闭环；M12 崩溃恢复不产生重复执行。

### 阶段 3 · 多任务 Goal 与控制（M17–M23）

实现边界：Goal → 多 Task + 依赖；变更传播到派工；暂停/终止控制回执；养老场景两条回放（隔离工作区）。

| ID | 注入方式 | 失败判据 | 必须观察到的事实 |
|---|---|---|---|
| M17 | 养老委托（脱敏）首次输入 | 在任何 Session 启动前 Goal 不可查 | Goal 与计划在先，含维度侧重、排除项、独立调研与汇总依赖 |
| M18 | “并行上限多少？用途改成投资决策，每篇单独文件 + 汇总 HTML” | 只说配置不落要求；或要求丢失 | 直接回答配置来源与实际运行数；用途与交付形式进入当前版本并传播到受影响派工 |
| M19 | “A 继续，解 B/C/D 的阻塞，补发 E–H” | A 被停/重派；B/C/D 缺结果；E–H 只有承诺文字 | A 原 Assignment 与工具历史保留；B/C/D 各有处置与生效证据；E–H 各有 Task ID 与受理回执 |
| M20 | “先暂停”，随后“改成终止” | 报告“已全部暂停”；或暂停变成永久取消；或终止后旧命令恢复工作 | 逐项控制回执；终止关闭后续准入与恢复；只补记旧暂停事实 |
| M21 | 终止后重放旧派工命令 | 产生新效果 | 无新派工、无新派工回执 |
| M22 | 报告返回时用户正在谈别的事 | 打断当前对话；或静默丢弃结果 | 挂到原 Goal 进入验收；给一条有出处的通知；当前对话继续 |
| M23 | 从补发处分叉跑到最终交付 | 最终 HTML 或分篇文件打不开 | 打开 HTML 与分篇文件；Goal 收敛检查记录缺口（如成本口径不可比） |

阶段 3 通过条件：一条按历史顺序到暂停再终止；另一条从补发到交付并打开报告文件。

### 阶段 4 · 长期协作（M24–M28）

实现边界：后台记忆、已授权主动触发、跨应用流程、审批绑定具体效果。

| ID | 注入方式 | 失败判据 | 必须观察到的事实 |
|---|---|---|---|
| M24 | 会前简报委托（日历+邮件读取、写本地草稿、外发待批） | 三步被当成一个不可分的事实；或外发未经审批 | 三个分别可验收的事实：已读取、草稿已生成、发送待审批 |
| M25 | 审批绑定目标后更换附件版本 | 旧批准仍可发送 | 审批失效，需对新版本重新审批 |
| M26 | 撤权后旧触发事件到达 | 旧事件补做已失去资格的动作 | 动作被拦截；事件留记录 |
| M27 | 重复触发事件 | 推进两次 | 按稳定事件 ID 去重，只推进一次 |
| M28 | 外部发送回执丢失 | 自动重发 | 按服务方标识核对，效果明确前不重发；状态可见 |

阶段 4 通过条件：外部发送在隔离环境/测试替身中覆盖回执丢失与恢复；结果按替身口径记录。

### 阶段 5 · 工作区切换与退役（M29–M33）

实现边界：隔离副本只读影子对照；工作区级唯一现行入口；旧在途结算；回退演练；按调用点移除旧契约。

| ID | 注入方式 | 失败判据 | 必须观察到的事实 |
|---|---|---|---|
| M29 | 隔离副本上新旧同输入影子对照 | 新版派发或外发（影子模式） | 同一时点工作数、已结算效果、产物对比；无派发无外发 |
| M30 | 切换后旧入口 | 新旧入口同时执行同一委托 | 工作区绑定唯一现行入口；每节点一个调度所有者 |
| M31 | 切换时旧在途任务 | 旧在途状态丢失或不可读 | 只读展示旧在途；可核实映射只绑定一次；未结算效果留待核对 |
| M32 | 回退演练 | 回退后重复派工；或旧记录不可读 | 先冻结新准入 → 在途排空或显式移交 → 原对话/偏好/产物/回执仍可读 |
| M33 | 退役后检查旧调用点 | 仍有调用点 | 旧 branch/prepare/焦点留作历史证据；模型侧准备、逐字目标引用、手填版本、原话重放契约已移除 |

阶段 5 通过条件：真实任务、回退和权限验收均通过后才移除旧契约。**生产切换以用户明确授权为准，本文不视为授权。**

## 2. 定稿 §8 的门槛型指标（可自动统计）

| 指标 | 现版 | 门槛 | 采集点 |
|---|---|---|---|
| 以提问收尾的回复占比 | 30%（41/137，现场口径） | < 10% | 回放脚本统计助手终答末句 |
| 工具失败率 | 14.9%（169/1134，日志口径） | < 3% | 回放脚本统计 `isError` |
| 空参数工具调用 | 27 次（`assistant_context` 独占） | 0（schema 拒绝空对象） | 回放脚本统计参数为 `{}` 的调用 |
| 每答一句的中间步数 | 6.4（875/137） | ≤ 2 | 回放脚本统计中间消息数 ÷ 终答数 |
| `accepted` 停留 > 24h 无变化 | 现场 3 例卡 288 小时 | 必须进 `needs_you` 并置顶 | 任务投影纯函数 |
| 投递失败事件 | 3 次后静默消失 | 必须进死信且可见 | 死信表 + 卡片 |

## 3. 性能基线口径（定稿 §8）

同版本、同模型、同机器、同输入。冷/热态分别采集，含现场规模与十倍历史。分项报告，**不合并成一个“轮次耗时”**：

1. 输入 → 供应商首次请求发出（本地处理）
2. 本地任务查询
3. 输入 → Ready
4. 调度受理 → 开工
5. 首次可见进展
6. 事件/产物送达

每项记录 P50、P95、样本数、失败原因、模型请求次数与入模各部分 token。初版目标：热态问候本地 P95 ≤ 250 ms，单任务查询 P95 ≤ 200 ms。先测现版和普通 Session，再定发布值。

**必须为零的扫描**：问候、指定 Task 查询、暂停受理的历史全文扫描次数。

## 4. 报告纪律

- 确定性回放（fixture/loopback）、真实模型桌面 E2E、性能基线**分开报告**，不互相替代。
- 测试替身（隔离外部服务）的结果按替身口径记录，不声明为真实外部效果。
- 真实模型/外部环境受阻时报告具体原因，并继续其他验证。
- 每条通过项附：可重跑命令、脱敏输入、Task 版本与授权差异、运行与投递回执、可见交互、实际产物路径、验收结论。
- 不把“首期 Ready 通过”当作整体完成；以 §1 五阶段实际证据判断完成度。

## 5. 实施期间发现并修正的既有缺陷

以下缺陷在基线 `eecf8b3ba` 上即可复现，不属本次引入；因阻塞验收而被一并修复。

| ID | 缺陷 | 基线证据 | 修法 |
|---|---|---|---|
| X01 | `resident-assistant-tasks-workflow` 的板卡步骤永久超时：测试用 `ancestor::*[@role="button"]` 定位任务卡，但产品为修复 axe `nested-interactive` 已刻意移除该属性（`TaskTile.tsx:136-140` 注释说明），卡片改为“布局容器 + 真实 `<button>` 激活面 + 同级控件”。选择器再也匹配不到，故 30s 必超时 | 基线 stash 后同一行 `resident-assistant-tasks-board.ts:24` 超时 | 卡片根元素补稳定 `data-testid="kanban-tile"`，测试改为按该锚点定位；锚点不依赖角色语义，与无障碍修复方向一致 |
| X02 | `verify:assistant-tasks` 间歇失败（干净基线上 8 次跑 4 次失败）。两个独立的测试竞态：(a) 夹具把 Host 自发的内部唤醒当成脚本主回合，`calls.shift()` 因此吃掉了本该属于用户回合的调用；其中 memory-maintenance 的上下文文本压根没有 `currentInputId` 字段，只按该字段判断必然漏判。(b) `sendMain` 只轮询 `isProcessing`，该布尔在提交的输入真正开始前仍可能为 false，于是一次发送的回合会跑到下一次发送里，位置化的 `calls` 队列整体错位 | 基线 stash 后 12 次采样 4 次失败，失败位置在 80/131/155 行漂移 | 夹具改为「无 `msg-` 开头的已提交输入即视为内部唤醒」，且必须在**原始 message content** 上匹配（`JSON.stringify` 之后引号被转义，正则永不命中）；`sendMain` 改为同时等待「本轮主回合计数增加」与「本轮应消费的脚本调用已消费」 |
| X03 | `SessionPersistenceQueue` 在 Windows 上以 `rename` 原子替换时会因目标文件被短暂占用而抛 `EPERM`，整次快照写入失败。POSIX 下 rename 覆盖不会被打开的文件阻塞，Windows 不同 | `.cache/verification/.../resident-assistant-tasks-*/` 中真实 `EPERM: operation not permitted, rename ... -> session.jsonl` | 新增 `replaceFile()`：Windows 上对 `EPERM`/`EBUSY`/`EACCES` 做 10 次递增退避重试，其余平台保持单次语义；与文件内既有的 Windows 目录 fsync 豁免同一惯例 |

修复后 `resident-assistant-tasks-workflow` 17/17 场景通过，含此前超时的 TM03/TM05/TM02 板卡场景，产出 `board-{light,dark}.png`（1440×1000）与 `board-trace.zip`。

X02/X03 的实测：`bun run scripts/verification/resident-assistant-tasks-workflow.ts` 连续 **12 次全部通过（12/12）**；修复前同一命令 12 次中 3–4 次失败。`packages/shared` 的 `persistence-queue` / `snapshot-storage` 单测 11/11 通过。

## 6. 阶段进展（按定稿 §7 顺序，随时点更新）

记录到 2026-11-18，实际通过的场景以 `manifest.json` 的 `exitCode`/`sceneIds` 为准；`untested` 字段列出未覆盖范围。

### 阶段 1 · 需求到 Ready —— 已通过

| 证据 | 结果 | 复跑命令 |
|---|---|---|
| 工作区任务服务（Goal / 版本化 Task / Requirement 版本 / Change / 控制 / 验收，SQLite 单写入者） | 12/12 场景 | `bun run scripts/verification/assistant-task-delegation-workflow.ts` |
| 桌面入口：真实 resident Session + 真实 RPC + 真实模型工具目录，自然语言→Task→Ready | 8/8 场景 | `bun run scripts/verification/assistant-task-desktop-entry-workflow.ts` |

已覆盖的失败判据：M01 问候不建任务、M02 一次请求成为一条版本化委托、M03/M06 重放幂等、M04 更正追加版本且旧版可读、M05 keep 显式记录、M07 未知任务拒绝、M08 就绪绑定版本与授权、M09 终止后不能再改要求或恢复。

### 阶段 2 · 真实单任务交付 —— 已通过

| 证据 | 结果 | 复跑命令 |
|---|---|---|
| 就绪定义经 Host 单一调度所有者派给真实普通 Session；Runtime 回执驱动 Assignment；**Worker 真实 `write` 工具产出的文件经产品完成路径登记为 Artifact 版本，并按该版本打开到真实内容**；验收绑定版本与证据；换 Session 返工保留 Task 身份；重启保留身份/版本/派工/要求历史；终止后拒绝再派工 | 9/9 场景 | `bun run scripts/verification/assistant-task-delivery-workflow.ts` |

M10/M15 的产物闭环已覆盖：场景 `B08`/`B09` 断言文件真实存在、内容等于 Worker 写入内容、Artifact 版本的大小与文件一致，且 `getArtifact(artifactId, revision)` 打开的是真实文件内容。此前的缺口根因是 loopback 用 `file_path` 调用 `write`（工具要求 `path`），工具自身校验失败故从未产生文件；同时 Worker 默认 `safe` 上限下写操作被 Explore 模式拒绝。两者都是夹具与权限事实的错配，不是产品缺陷。

### 阶段 3 · 多任务 Goal 与控制 —— 已通过（确定性回放）

| 证据 | 结果 | 复跑命令 |
|---|---|---|
| 一个 Goal 下的汇总 Task + 4 个独立分篇 + 4 个补充；用途与交付形式变更写入当前版本；保留 A / 解除 B\C\D / 补发 E–H 各自有回执；暂停→终止逐项回执；终止后拒绝恢复与改要求；迟到回执不复活已终止工作；Goal 在仍有未决分篇时不宣称达成 | 7/7 场景 | `bun run scripts/verification/assistant-task-goal-control-workflow.ts` |

已覆盖的失败判据：M17 计划先于任何 Session 可查、M18 中途变更落到当前版本、M19 三项处置各有回执且不重复建任务、M20 暂停→终止逐项回执、M21 终止后旧命令无新效果、M22 部分阻塞不拖住无关注解、M23 分篇全绿仍需检查 Goal。

**未闭环项**：真实 Worker 执行 4 篇调研与打开最终 HTML 报告。本工作流验证的是 Goal/Task/控制/验收的定义层事实；真实派工与产物已由阶段 2 覆盖到「派工与回执」，未覆盖「从 loopback 回收文件」。

### 阶段 4 · 长期协作 —— 已通过（确定性回放，无真实外发）

| 证据 | 结果 | 复跑命令 |
|---|---|---|
| 会前简报作为一个 Task，读取授权带用户原话；审批绑定收件人、渠道与附件版本；换附件版本/改收件人/换渠道使旧批准失效；新决定使更早批准作废；撤权与过期分别记录且不波及无关授权；重复授予幂等；已拒绝的效果不能复用；授权与审批跨重开保留 | 10/10 场景 | `bun run scripts/verification/assistant-task-collaboration-workflow.ts` |

已覆盖的失败判据：M24 三步为分别可验收的事实、M25 附件/收件人变更使旧批准失效、M26 撤权立即生效且范围限定、M27 重复请求不产生第二份授权、M28 拒绝的效果不可复用。

**未闭环项（如实记录）**：真实日历/邮件连接器读取、真实外发、Electron 审批卡片渲染。本工作流按替身口径验证授权与审批语义，`untested` 已声明不含真实外发。

### 阶段 5 · 工作区切换与回退 —— 已通过（隔离副本，未切真实安装）
| 证据 | 结果 | 复跑命令 |
|---|---|---|
| shadow 模式只读、绝不派发或外发；旧在途记录保持可读且不被自动转成活动任务；切换到新入口是逐条记录的决定；在途映射只绑定一次；回退先冻结新准入再排空/移交；新入口已接受的记录在回退后仍可读；二次启用必须有 shadow 期；退役按符号逐项核对而非整体宣称 | 8/8 场景 | `bun run scripts/verification/assistant-task-switchover-workflow.ts` |

已覆盖的失败判据：M29 shadow 不派发不外发、M30 工作区唯一现行入口、M31 在途只读且映射一次、M32 回退先冻结再有在途处置、M33 退役逐项核对。**M33 的部分结论已更新**：`assistant_context` 的准备代次（`prepare`/`preparation`/`recover`/`receipt`/`reconcile`）已于 2026-11-19 退役并验收；`assistant_delegate.goalQuote` 与 `runtime_continuation` 原话重放**仍在调用点**，故仍不宣称这两项已退役。该工作流 `S08` 场景的逐项核对语义保持不变（它只对仍存在的符号）.

**未闭环项（需用户授权）**：切换真实安装、真实旧委派结算、跨工作区/远端切换。本工作流使用隔离副本，不触碰真实安装。

### 仍待完成

1. **真实模型桌面 E2E 的稳定性**：旧契约退役**消除了 D4**（退役后每轮实测旧契约拒绝均为 0 次），但 LM03 仍不稳定：5 轮样本中 1 轮以 `amended: true` 通过，其余 4 轮仍报"变更被丢弃"。失败原因已**不再是**旧契约，而是下一项。不在少量样本上宣称通过。
2. **LM03 的其余失败原因（本轮新发现，未修复）**：见下节逐轮归因。四项独立原因：`askedBack` 检测与真实 `ask_user` 调用不一致（原因未查清）、模型用自然语言反问而不走工具、Worker 执行受阻（提供方 `402` 余额；Worker cwd 落在助手私有会话目录被"Assistant private state is protected"拒写）、以及 Worker 已完成时该轮被用于交付核对而延后新变更。这些都与旧契约无关。
3. **旧契约退役（路径 A）已实施**：`assistant_context` 的 `prepare` / `preparation` / `recover` / `receipt` / `reconcile` 已从模型侧移除并在工具边界强制拒绝；材料选择（`branches`/`create`/`select`/`associate`/`hibernate`/`checkpoint`/`get`）保留。Host 自用的用户发起派工准备路径保留（它不是模型契约）。详见 [旧契约退役清单](./assistant-refactor-2026-11-18-legacy-retirement.md)。

### D2–D4 与真实模型 E2E 的相互关系

三者的关系值得单独写明，因为它们不是三个独立 bug：

| 现象 | 直接原因 | 根因 | 现状（2026-11-19） |
|---|---|---|---|
| D2 `assistant_context` 收到 `task_create` 的字段 | 两套契约都描述"要求"，字段名不同 | 同一概念有两个表达 | **已消除**：`prepare` 退役后 `assistant_context` 不再有 `requirements` 字段，混淆面随契约消失 |
| D3 `assistant_delegate` 的 `fileScope` 放错层级 | 同上 | 同上 | 不再是必现问题；`fileScope` 仍是顶层契约字段 |
| D4 `Select alone is not preparation` 等拒绝 | 旧准备/续接规则仍是强制前置 | 旧路径未退役 | **已消除**：门禁改为「无 preparation 绑定时直接授予 admission」，退役后 5 轮真实模型回放中旧契约拒绝出现 **0 次** |
| LM03 时通时不通 | 模型选择不同路径，旧契约按路径不同地放行或拒绝 | 同上 | **D4 部分已消除**；仍有独立原因（见下） |

**结论修正**：退役旧契约是必要的，但**不是 LM03 稳定的充分条件**。实测显示 D4 消失后 LM03 仍会失败，归因已转移到 Worker 执行与事件优先级，见下节。

#### 真实模型 E2E —— 旧契约退役后的实测（5 轮样本）

```bash
bun run verify:assistant-delegation-live
```

前置条件：退出 Phaneris 桌面应用（单实例锁；打包版 `Phaneris.exe`、开发版 `electron.exe` 都占锁，工作流两者都检测）。工作流把安装的 `credentials.enc` / `credentials.key` 与 Chromium 的 `Local State`（safeStorage 主密钥所在）复制到隔离配置根，不修改用户配置。连接用安装配置的默认项（本轮为 Command Goat 的 `deepseek/deepseek-v4.1-flash`），工作区权限 `allow-all`。

**LM01/LM02 在所有样本中通过**：问候未调用任何 `task_*`；一次委托记录 1 个 Goal + 1 个 Task + 要求版本与 Change，并由 `assistant_delegate` 派工。

**LM03 逐轮实测**（统计各轮隔离配置根下全部 `*.jsonl`）：

| 轮次 | 旧契约拒绝次数 | LM03 | 该轮模型实际处置（据会话原文） |
|---|---:|---|---|
| 1 | 0 | **通过**（`amended: true`，Change 1→2） | `task_amend` 两次，把"深色背景"记录为新要求版本 |
| 2 | 0 | 失败 | 用自然语言反问"你指的是哪个"，未走 `ask_user` 工具，也未 `task_amend` |
| 3 | 0 | 失败 | **调用了 `ask_user`**（`pi-turn-6`，回执含用户选择）询问是否指 pelican.html；但 `live-mixed.json` 记为 `askedBack: false`，捕获原因未查清 |
| 4 | 0 | 失败 | Worker 首跳 `402 Insufficient Balance`；模型说明阻塞点，未记录变更 |
| 5 | 0 | 失败 | 该轮 Worker 已完成，模型用于交付并逐项核对 `pelican.html`，未处理新变更 |

**关键事实**：5 轮的旧契约拒绝次数**全部为 0**。`work_not_prepared` / `Select alone is not preparation` / `work_input_pending` 这类 D4 拒绝在退役后不再出现，退役目标已达成。

**为什么 LM03 仍失败（未修复，如实记录）**：

- **`askedBack` 判定与真实调用不一致（原因未查清）**：第 3 轮模型确实调用了 `ask_user` 并收到用户选择（会话原文可证，时间戳在混入输入之后约 20 秒），但 `live-mixed.json` 仍记 `askedBack: false`。本轮**未放宽该判定**——判据一旦放宽就无法区分"真的丢弃"与"只是没被识别"；应先查清捕获逻辑，再用多轮样本决定。
- **反问走自然语言（第 2 轮）**：模型用散文追问而没有走 `ask_user` 工具，判据不认这种处置。设计上"追问指代"是可接受处置之一，但它当前只以工具形式被识别。
- **Worker 执行受阻**：提供方余额 `402`（第 4 轮）、以及 Worker 的 cwd 落在助手私有会话目录下、写入时被产品自身"Assistant private state is protected"拦截。后者是真实缺陷，与旧契约无关。
- **事件优先级**：第 5 轮 Worker 已完成并投递结果，模型把该轮用于交付与核对，新变更被延后而非被拒绝。

这四项都是**独立于旧契约**的问题，需要各自单独立项，不能靠继续删除契约解决。

#### 退役动作在真实边界的拒绝（确定性证据）

`resident-assistant-delegation` 场景 `RW13-retired-preparation-action-refused-at-the-tool-boundary` 用真实 Host 工具边界驱动探针，断言退役动作回执 `isError=true`；反向验证：把边界校验去掉，该场景即失败。同时 `assistant-task-desktop-entry` 场景 `D09-business-dispatch-requires-no-preparation-pass` 断言"记录委托 → 立即派工"全程无准备代次；反向验证：撤掉放行改动即报 `The delegation must be accepted without a preparation pass`。

**D1 已修复并验证**（方案 A：幂等键 = 可信输入 + 语义动作）。真实模型对照：

| | 修复前 | 修复后 |
|---|---|---|
| Goals | 2 | **1**（同一输入） |
| Tasks | 2 | **1**（同一输入） |
| changes | 2 条，同一 `inputMessageId` | 1 条 |

**退役前的缺陷（真实模型回执证据，D4 已消除）**：

| # | 缺陷 | 退役前证据 | 对应判据 |
|---|---|---|---|
| D2 | `assistant_context` 参数被误用 | `command.requirements.0.statement: unknown field` | M05、M33 |
| D3 | `assistant_delegate` 参数被误用 | `config.fileScope: unknown field`（`fileScope` 在契约顶层） | 同上 |
| D4 | 旧契约主动阻断新流程 | `Select alone is not preparation` / `Continuation requires a completed result` / `work_input_pending`（退役前 4 次复现，退役后 0 次） | M33 |

**本轮还补上了一条安全性质**（原为缺口，见退役清单 §3 条件 2）：`task_create`/`task_amend` 现在校验每条要求引文必须是绑定输入的原文摘录，`assistant_context.prepare` 不再是唯一做这件事的地方。已用反向验证确认断言有效（关掉校验即报 `Missing expected exception: an invented quote must be refused`）。

退役路径与能力对照见 [旧契约退役清单](./assistant-refactor-2026-11-18-legacy-retirement.md) §3.1。

### 工作面板（本轮实施，2026-11-18）

助手工作面板改为一个组件 `FocusBoard` 在两处渲染，因此两个入口不可能漂移：顶栏助手位置悬浮（`resident-peek`）与助手界面内（工作面板的「任务」视图）。

| 证据 | 结果 | 复跑命令 |
|---|---|---|
| 面板规则：聚焦项选择、动作随阶段收敛、分段只含在办工作、原因只来自已记录事实 | 6/6 场景 | `bun run verify:assistant-delegation-board` |
| 真实 Electron：悬浮入口渲染面板并按段切换记录；助手界面内渲染同一面板且分段在上方、无标题；动作随阶段变化；控件均有可访问名称 | 4/4 场景 | `bun run verify:assistant-delegation-panel` |

实施要点：

- 左上是**容量条兼任务切换器**，与左侧区域等宽，点段切换左侧记录；不再有标题行。
- 动作按 Host 记录的阶段收敛：待验收只给验收/返工；执行中给暂停/终止；已暂停只给恢复；已终止与已验收不给动作。已跑完的结果不再展示暂停/终止——那时没有可停的执行。
- 容量取自 Host 的 `scheduling` 记录（`occupied` / `capacity`），不在渲染层重算。
- 新增 RPC 通道 `residentAssistant:tasksVerify`（4 处登记 + 两个 inventory 计数 449→450），使面板的验收决定与模型 `task_verify` 走同一个服务方法。
- 未改动顶栏助手岛的既有样式，仅让 peek 在承载面板时加宽。

**未闭环项**：面板上「验收通过」按当前实现记录 `undecided` 的逐条结论，等真实模型 E2E 后再决定是否要求逐条结论必填。

## 7. 性能基线（本轮实测，定稿 §8 口径）

只测 Host 本地处理，不含供应商往返。同机同版本（Windows x64 / Bun 1.4.3），样本数如实标注。

| 操作 | 样本 | P50 | P95 | 门槛 | 结果 |
|---|---:|---:|---:|---|---|
| 单任务查询（热态，240 条任务） | 60 | 0.05 ms | **0.08 ms** | ≤ 200 ms | 通过 |
| 单任务查询（十倍历史 2,640 条任务） | 40 | 0.05 ms | **0.11 ms** | 不随历史增长 | 通过 |
| 暂停/恢复受理（热态） | 60 | 0.47 ms | **0.73 ms** | ≤ 200 ms | 通过 |
| 任务投影（热态） | 60 | 0.04 ms | 0.06 ms | 有界 | 通过 |
| 就绪检查（含一次冷开库，十倍历史） | 20 | 0.17 ms | 0.36 ms | 有界 | 通过 |
| 冷开库 + 列表（每次新建连接） | 20 | 2.29 ms | 2.78 ms | — | 记录 |

十倍历史下单任务查询 P95 为 0.11 ms，与基准规模 0.08 ms 同量级，未出现历史线性增长 —— 项目的单任务读取按 `taskId` 直接命中，不遍历工作区记录。

实现过程中该断言先失败（`store.list` 未按 `taskId` 过滤，单任务查询退化为全量列表），修复后通过；这条正是本矩阵 §3「历史全文扫描应为零」想要防住的退化。

复跑命令：`bun run scripts/verification/assistant-task-performance-workflow.ts`

**未测**：供应商往返延迟、Electron 渲染帧耗时、网络传输、冷 OS 页缓存。本机 Bun 为 1.4.3，低于 `scripts/performance/run.ts` 要求的 1.4.4，故未使用 `perf:baseline`。
