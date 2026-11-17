# 常驻协作 Agent（resident assistant）架构复盘

状态：**已按原始记录复核及用户确认的架构原则修订；本文只提供故障证据，不作为实施清单。** 唯一实施入口为[工作连续性与执行准备闭环主方案](resident-assistant-work-continuity-redesign-2026-11-17.md)，从其第 11.1 节开始。本文原有过强或错误归因已在正文修正，修订说明见文末。

实施进展与当前现场见[实施与验证记录](../docs/verification/resident-work-continuity-implementation-2026-11-17.md)。下文原始记录计数及哈希属于调查时快照，后续原会话已变化。

## 会话 261105-copper-cloud · 重点：2026-11-17 13:07–14:16 最新对话

分析日期：2026-11-17
分析对象：工作区常驻协作 Agent（`sessionKind=resident_assistant`，会话 `261105-copper-cloud`，2026-11-05 01:33 创建）
数据来源：
- `~/.phaneris/workspaces/Work/assistant/sessions/261105-copper-cloud/session.jsonl`（2,122 条记录 / 23.5 MB）
- 同目录 `.pi-sessions/*.jsonl`（Pi 原始事件流，8,813 + 4,022 条）
- `~/.phaneris/workspaces/Work/runtime/runtime.db`（tool_operations / operations / runtime_events，只读查询）
- `~/.phaneris/workspaces/Work/context.db`（pointers / views / branches / checkpoints）
- 设计文档：`docs/architecture/resident-assistant-{0.6,0.6.2,0.6.3,0.6.4}-*.md`、`docs/verification/resident-context-063-stability-report-2026-11-13.md`
- 代码：`packages/server-core/src/{resident-assistant,context,durable-runtime}`、`packages/pi-agent-server/src`、`packages/shared/src/agent/resident-role.ts`、`packages/session-tools-core/src/resident-context-contracts.ts`

范围：只分析、不修改代码，不给实施步骤。

---

## 0. 结论

最新一次对话（11-17 13:07–14:16）**以错误收尾**：用户问了 3 个问题（为什么意图混乱、为什么反复报错、到底在干什么），助手一次也没有完整回答；会话最后一条消息是 `Runtime receipt unavailable or execution cancelled`（14:16:48），`lastMessageRole=error`。

核心问题是：**系统没有可靠完成从理解输入、确认工作范围、记录新要求到准备执行的闭环；恢复失败后，仍允许助手把旧工作当成当前工作继续推进。** 已确认的故障事实及因果边界如下：

1. **本地准备与回执存在严重迟滞。** 三次工具快照记录扫描 59–99 MB、解码 4,160–6,668 条、重建 9–20 次。最后一次模型请求快照到 Host T1 提交相隔 256,332 ms，Pi 约 15 秒已超时。同步读取和宽依赖验证是有证据的放大因素，但没有 CPU / 分阶段 span 将全部时长归因到一个函数。默认 15 秒同时用于 prepare 和 outcome，不能全部写成工具 T2 超时。
2. **T1 没有 T2，效果仍未知。** 11-13 的 `select` 处于 `effect_pending`，run 已停放为 `recovery_parked`。停放不等于收敛；T1 也不证明实际状态变更已经完成，不能补造成功或未执行结论。
3. **跨输入的相同参数保护造成持续阻塞。** 守卫按 Session、工具名和参数哈希查未结算操作。11-17 的 22 次相同 `select` 均被旧操作拦截，直到核对前都会继续命中；模型侧没有足够的工具操作核对与恢复入口。增加随机 requestId 不能替代正确恢复。
4. **上下文动作缺少足够细分的恢复语义和降级闭环。** `assistant_context` 包含只读查询及状态修改，不能整工具设为 readOnly；本地选择应按命令身份、输入与世代安全恢复。`branches/get` 同轮可用，不能称所有恢复路径都不存在；但它们没有使这次选择及当前准备恢复就绪。
5. **旧指向被当作当前工作已确认，而不是可靠完成确认和准备。** pointer 仍指向 Day 72，本轮 branch materials 为空。暂未归属本身正常，保留类似 HEAD 的指向也合理；问题是选择失败后助手仍声称“sel 已生效”，没有确认当前工作范围、保存本次要求并取得有效准备。当天编号未独立确认，本文不再把 11-17 强行标成 Day 75；是否沿用原分支应由工作范围决定。

---

## 1. 会话事实

| 指标 | 数值 |
|---|---|
| 会话 | 261105-copper-cloud（name=Assistant，hidden，systemPromptPreset=resident_assistant） |
| 时间跨度 | 2026-11-05 01:33 – 2026-11-17 14:17（12 天） |
| 模型 / 思考 / 上下文策略 | deepseek/deepseek-v4.1-flash / off / compact |
| 消息 | 2,122 条：assistant 883、tool 1,005、user 96、info 116、error 20、warning 2 |
| 模型请求 | 908 次（known 855 + unknown 53） |
| Token | 输入 26,635,022（cacheRead 22,539,008）、输出 537,307（推理 294,661） |
| 记录成本 | 存储值为 $0；自定义端点无定价，实际成本未知，不能解释为免费 |
| 工具失败 | 145 / 1,005 = 14.4% |
| 失败尝试 | 无输出 assistant 消息 49 条、零 usage 54 条、「Response interrupted」12 次 |
| 上下文读取 | 三次工具快照为 59–99 MB、解码 4.1k–6.7k 条、重建索引 9–20 次；分支 materials 计数为 0，其他材料并非为 0 |
| Pi 原始日志 | 当前 Pi 会话 8,813 事件（4,338 message + 4,321 context_edit + 149 custom），其中 user 消息事件 2,811 条，而真实用户输入只有 96 条；另一个旧 Pi 会话 4,022 事件 |
| 未结算工具操作 | 本会话 2 条；全工作区 234 条 `effect_pending` |

### 1.1 最新对话时间线（11-17）

| 时间 | 事件 |
|---|---|
| 13:07:26 | 用户「你好，你是谁」→ 正常回答（身份、职责、4 条待处理委派） |
| 13:08:09 | 用户「取消所有待处理任务」→ 4 次 cancel_work 成功，给出取消表与副作用说明 |
| 13:12 / 13:13 | 「我是谁」「我们的协作方式是什么」→ 记忆/场景检索正常回答 |
| **13:24:41** | 用户「手动触发今日的双联知识推送任务，注意招呼语改成下午好」 |
| 13:24:50 | 助手「我先确认…因为当前分支没有检查点，需要从前面的会话历史里找回它的完整定义」→ 调 `assistant_context select` |
| 13:24:51–13:25:21 | `select` 连续 5 次被「An earlier invocation…unconfirmed outcome」拒绝；中间插一次 get_session_info |
| 13:27:30 | `Connection Error: Could not reach the AI service` |
| 13:30:36 | 用户「我问的是什么？你在搞笑吗？」 |
| 13:32:37–13:33:56 | 助手道歉后再次进入同一 `select` 死循环（17 次），夹杂 branches/get/memory_search/work/ls/read |
| 13:33:27 | 助手「先看清 **Day 72** 这天原本要做什么：当前 sel 已生效…」；用户要的是今日触发，没有成功选择回执支持这句宣告 |
| 13:33:57 | `Response interrupted` |
| 13:34:12 | 用户贴出错误原文问原因 |
| 13:34:36 | 助手解释涉及幂等保护、未确认回执和 rebuilds，但错误归因为本次 requestId / 委派重复；实际被拦的是没有 requestId 的旧 `select` |
| 13:36:25 | 用户「…为什么会出现意图混乱…你却给了索引的结论，这个是以前的上下文，上下文管理混乱了？」 |
| 13:37:22 | `get_session_info(history offset=2074)` 有 T1、缺少 T2；13:40:26 另有顶层回执错误，其对应模型准备快照到 T1 相隔 54,663 ms，不能把两者合成一个工具 T2 超时 |
| 13:41–13:56 | 「继续」→ 继续读历史，再次回执不可用（13:56:38） |
| 14:07:31 | 用户「怎么一直在出错误」→ context get / get_session_info 均成功 |
| **14:16:48** | 最后一次模型请求失败：`Runtime receipt unavailable or execution cancelled`；会话到此结束 |

---

## 2. 错误清单

### 2.1 会话级错误（20 条）

| 错误 | 次数 | 时间 | 机制 |
|---|---:|---|---|
| `Invalid Request: The API rejected this request` | 8 | 11-07 10:58（8 秒内） | Pi 原始日志保留 HTTP 400：拒绝 `reasoning_effort` 参数；请求参数与端点不兼容，重试策略无效（11-13 报告已完成归因） |
| `Resident context changed while the provider was running; its stale response was withheld` | 3 | 11-05、11-09×2 | 在飞响应提交时 `modelContext.valid()` 为假 → `contextDisposition='stale'` → 响应丢弃、`modelVisible=false` |
| `Resident context changed or is unavailable; start a fresh turn` | 2 | 11-09 | 下一次请求准备时依赖失效（记忆/分支 revision 变化） |
| `Runtime receipt unavailable or execution cancelled` | 6 | 11-12×2、11-13、11-17×3 | 混合了本地 prepare / outcome 超时及取消；最新一次明确涉及模型 T1 准备迟到，不能全部归为 T2 缺失 |
| `Connection Error: Could not reach the AI service` | 1 | 11-17 13:27 | 端点不可达 |

### 2.2 工具级错误（145 条，按工具）

| 工具 | 失败 | 关键错误文案与机制 |
|---|---:|---|
| `assistant_context` | 24 | 全部为 `An earlier invocation…unconfirmed outcome`（11-14 2 次、11-17 22 次），全部是 `select`，参数为同一 `branchIds` |
| `get_session_info` | 21 | 17+2 次 `Use assistant_memory_read for source recall; unrestricted history access is unavailable for this role`（11-05 读其他会话历史）；1 次回执不可用；1 次会话不存在 |
| `assistant_memory_update` | 20 | 7 次 `Project facts belong to their Project memory owner`、5 次 `One-time instructions belong in the current task or context`、3 次 `learning policy requires an explicit request or is paused`、3 次 `Memory key already exists`、2 次 `Maintenance cannot change project ownership` |
| `assistant_delegate` | 20 | 5 次 `Internal delivery events cannot authorize or repeat delegated work`、5 次 worker 模型不在目录（`deepseek-flash`/`deepseek-v4-pro`）、3 次 `Worker catalog revision changed`、2 次 `thinking capability is unverified`、2 次 `A newer user instruction is pending`、2 次 `Task goal quote must match`、1 次未知字段 |
| `assistant_worker_options` | 7 | 4 次 `limit: expected <= 20`（模型传 30/40/100）、3 次 catalog revision 变化 |
| `Ls` / `Find` | 28 | 11 次 `Assistant private state is protected`（无 input）、fd 把文件当搜索目录、路径不存在 |
| 其它 | 25 | memory_maintenance 5、memory_search 3、history_search 2、worker_control 2、ask_user 2、UNIQUE constraint 3、Read/Grep/List 等 |

### 2.3 状态级：未知效果池

- 本会话 `tool_operations` 有 2 条 `effect_pending`：
  - `toolop_37330ca9…`：`assistant_context select [f3d5568d…]`，11-13 14:11:00 提交 dispatch，无 outcome；run `recovery_parked`（11-13 15:40:18，verdict `reconcile_required`）。
  - `toolop_adb45083…`：`get_session_info history offset=2074`，11-17 13:37:22 提交 dispatch，无 outcome（safe_replay，不触发幂等拦截，但会反复报回执错误）。
- 调查快照中全工作区共 **234 条 `effect_pending`**，其中 `safe_replay` 107 条、`never_auto_retry` 127 条，显示系统性恢复积压；不代表 234 次业务副作用均已发生或重复发生。这是调查时快照，不是实施时实时状态。

---

## 3. 五条根因链

### 链 A｜上下文重扫链（最上游）

```
依赖图跨 13 个会话（含 23.5 MB 的本会话）
  → SourceReader 索引缓存只保留 8 个会话（source-reader.ts:28,62）
  → writer 原子重写 JSONL 并发布同进程内存索引；文件世代变化和缓存淘汰可能触发重建
  → 三次工具快照扫描 59–99 MB、解码 4–6.7k 条记录、重建 9–20 次
  → branch materials 为空，但当前输入、近期主线及协作记忆仍可进入模型
  → 同步读取和宽依赖验证占用主进程的风险已由既有报告与隔离样本证实
  → 本地 prepare / 回执出现超过 15 s 的迟滞；具体函数贡献仍需分阶段测量
```

这些数字来自工具自身返回的 `activeSegment.reading`（11-17 13:33:40 / 13:34:21 / 14:07:42 三次快照）：`bytesRead=98,653,805 / 65,831,181 / 59,265,512`，`indexScanBytes≈bytesRead`，`decodedRecords=6,668 / 4,757 / 4,160`，`rebuilds=20 / 12 / 9`，`selectedCharacters=0`。**该 selectedCharacters 只累计分支 materials，不统计当前输入、近期主线、检查点文字或 collaboration profile。** 它支持读取放大和计量不完整的判断，不能证明上下文总注入量为零。

还需核查 `DerivedMemory.profile()` 先验证最多 128 条候选、再排序选取最多 8 条的放大路径；没有业务分支材料时，也可能因少量协作记忆而读取宽依赖图。

### 链 B｜回执 / 未知效果链

```
本地准备 / 回执链路迟滞，或主动取消
  → Pi 在默认 15 s 的 prepare / outcome 等待期限结束
  → Host 的 T1 可能在 Pi 结束后才落库，或者实际结果没有完成 T2 收敛
  → 出现孤立模型派发记录或 effect_pending 工具操作，具体状态分别核对
  → 本地上下文命令缺少足够的核对 adapter 和模型侧安全恢复入口
```

11-13 报告记录的三次延迟为 **179,441 / 275,117 / 1,086,399 ms**，但报告也明确没有完整 CPU profile，不能把每次延迟全归给一个函数。11-17 的三次模型快照到 T1 间隔为 **54,663 / 20,072 / 256,332 ms**；最后一次 Pi 已在 14:12:47.667 报错，而 Host 到 14:16:48.813 才提交 T1。这证明本地准备迟到，不证明供应商请求已经发出。

### 链 C｜幂等毒丸链（本次对话的直接死因）

```
11-13 14:11 的 select 已 dispatch、无 T2（可能由链 B 造成）
  → 11-13 15:40 进程重启恢复，run 被 park 为 reconcile_required，但 tool_operations 行仍是 effect_pending（store.ts:508-517 把 parked 也当 unsettled）
  → 11-14 23:53 模型首次重试同参数 select → 守卫命中（coordinator.ts:1000-1007）→ 拒绝
  → 11-17 13:24 再次重试 22 次 → 每次都被同一毒丸拦截
  → select 的 schema 无 requestId，参数相同 → 哈希相同 → 旧未知操作收敛前持续命中；单加随机 ID 不能作为修复
  → 错误只返回一句不可执行的文案；模型侧没有查看/收敛工具回执的工具；唯一的人工 reconcile 需要 actor+evidence（coordinator.ts:378-394），但没有任何界面/提示要求用户处理
  → 上下文无法恢复 → 模型继续重试 → 直到 Response interrupted / 会话级错误
```

关键反证：同一轮里 `assistant_context branches` 与 `get` 可以成功——因为它们参数不同；`select` 失败不是"工具坏了"，而是**同一哈希的旧操作没有收敛**。

### 链 D｜焦点 / 意图链

`context.db` 的 pointer 是权威事实：

```
focus.label = "手动触发双联知识推送（Day 72）"
selectedBranchIds = [f3d5568d…]
selectedForInput = msg-1794537397801…（11-13 的输入）
temporary = { inputId: "resident-event:d82ed1bb…:needs_attention::retry:3", branchIds: [同一分支] }
activeSegment.branchIds = []
activeSegment.branchRevisions = {}
activeSegment.materials = []
activeSegment.reading.selectedCharacters = 0
```

解读：这里同时保存了旧工作指向和本轮空的分支工作集。**保留旧指向、输入暂未归属都可以是合法状态；缺少的是明确的定位、当前要求关联、准备结果和后续执行资格。** 助手在选择被拒绝后仍宣称选择生效，并转向旧实例，是已观察到的失败；不能据此规定“今日任务必须 create”。持续工作可以沿用分支，新实例与旧实例仍须区分。

`temporary` 确有旧事件残留，但 `prepare()` 按 `temporary.inputId` 限定其适用范围，temporary select 也专门保留前台指向。残留本身不足以证明前台已被覆盖；后台竞态需要单独验证。修复须保留稳定前台指向，并检查产生业务调用的实际请求视图，不能用清空 focus 代替闭环。

### 链 E｜记忆与委派链（持续制造噪声与阻塞）

- **记忆路由与作用域衔接**：全局入口拒绝 `project_fact`，但项目入口已支持同项目历史直接用户来源和 Host 验证的非记忆执行观察。当前直属用户限制主要用于显式授权及跨项目写入。应定位 project scope、source grant 和拒绝后的处理，不能判定后台项目事实完全无路可写，也不能放宽学习政策。
- **维护预算与积压失配**：后台每日 8 个 run，每个 Runtime run 选一个最多 6,000 字符的片段。原回执先后显示 83,651、83,661 条 pending messages，与现有后台吞吐严重失配；到达率与服务率仍需测量，不能无条件断言永久追不上。82 次维护注入是实际记录，不等于已经证明持续抢占前台。
- **相关依赖 revision 耦合**：引用过的记忆改变可能使检查点或在飞响应失效；不能扩大为任何 collaboration 记忆变化都会使所有分支失效。应测量有效材料依赖范围及定向失效。
- **委派发现和契约**：授权检查分散，应统一共享契约而保留各边界校验。`worker_options(kind=connections)` 返回计数，`kind=models` 已返回具体 ID 和 thinking 能力；问题应修在发现流程和配置解析。目录浏览版本与实际能力版本需分别核对；`needs_attention` 长期占文件范围的现场已存在，锁释放仍须以实际执行及未知效果为据。

---

## 4. 架构级问题（按影响排序）

1. **工作准备到执行的证据链不完整。** 没有将实际 producer 请求、有效要求、准备世代与后续业务准入统一关联；恢复失败后旧工作仍被当成当前工作推进。
2. **本地准备与回执存活性耦合。** 已观察到超过 15 秒的本地准备迟滞；耗时分布仍待完整测量，过期请求不应迟到取得新资格。
3. **本地上下文未知操作缺少足够收敛路径。** 保护保留未知是必要的，但必须有可用核对、恢复和独立工作入口。
4. **动作级恢复语义不足。** 查询、本地状态设置和外部副作用不能共用粗粒度的不可重试处理；命令重试与有意再次选择须区分。
5. **前台指向、本轮归属及请求视图关系不清。** 三者均有用途，不能简单删除旧指向；应明确有效要求和使用它们的具体请求。
6. **后台归属与前台连续性需验证。** 维护和事件注入实际存在；应按 run / event 查询视图并检验竞态，不以 temporary 残留直接判定污染。
7. **读取和验证放大。** 跨缓存容量、原子重写世代变化和先验证大量候选再截断，可能使成本远大于实际工作集；指标还遗漏了部分入模材料。
8. **记忆与委派能力已有、契约衔接不足。** 项目历史写入、具体模型目录都存在；修复应针对作用域、发现、版本及失败反馈，不重复建设或无条件放行。
9. **提示与实际边界需要对齐。** 历史拒绝同时包含模型误用和合法权限保护；应减少试错，同时保留当前权限及来源边界，不能把全部历史拒绝视为现版本缺能力。
10. **观测缺少因果关联。** 拒绝调用缺少参数、准备 / 结果 / 取消共用错误、未知定价被记为零成本，均影响诊断。日志量和数据库体积本身不能证明根因。

---

## 5. 量化影响

| 维度 | 数值 |
|---|---|
| 会话总输入 token | 26.6 M（其中 cacheRead 22.5 M） |
| 三次工具快照扫描 | 59–99 MB、4.1k–6.7k 条解码、9–20 次索引重建；分支 materials 为 0，不代表总入模量 |
| 本会话未结算效果 | 2 条（1 条直接造成 24 次封锁） |
| 全工作区未结算效果 | 234 条 `effect_pending` |
| 工具失败率 | 14.4%（145/1,005） |
| 失败尝试 | 49 条无输出 + 54 条零 usage + 12 次 interrupted |
| 记忆维护积压 | 原工具回执先后为 83,651、83,661 条 pending messages；后台每天 8 run，每 run 一个最多 6,000 字符片段 |
| Pi 日志记录量 | 4,338 message 事件（含 2,811 条 user）+ 4,321 context_edit，包含重投影和注入；不直接等于错误重复输入 |
| 数据体积 | session.jsonl 23.5 MB、runtime.db 3.0 GB、context.db（workspace）97 MB、assistant/context.db 30 MB（迁移遗留） |

---

## 6. 判断：结构性 / 可缓解

**结构性**（不改状态模型或执行边界不会消失）：
- 工作准备与准入关联、命令恢复、请求期限、来源工作集和前后台作用域，需要在现有 ContextView / Runtime 边界上闭环；不据此推导必须整体重写系统。

**可缓解**（不改架构也能显著收敛）：
- 提示与工具发现、结构化错误、拒绝事件、指标名称及成本未知表达，可以在保留原有权限边界的前提下改善；它们不能替代执行准备闭环。

**已经存在但没有接通的能力**：
- `reconcile_required` verdict + `reconcileTool`（只有 RPC 与 2 个 adapter，没有模型侧入口、没有用户提示）；
- `context_commands` 命令幂等表，需要扩展可核验结果和恢复进度；仅给 select 加 requestId 不够；
- writer / SourceReader 共享的同进程内存索引，受 8 槽容量与文件世代影响；不是磁盘持久索引；
- `worker_options(kind=models)` 的具体模型目录，以及同项目历史项目记忆写入能力；
- `resident_segment.requests[].disposition` 已记录 `entered/committed/stale`，但会话级错误没有把它聚合为可读的失败分类。

---

## 附录：证据索引

- 会话事实：`assistant/sessions/261105-copper-cloud/session.jsonl`（header、assistant/tool/error 记录）；`.pi-sessions/2026-11-06T07-27-18-427Z_01a1afc1-*.jsonl`
- 阻塞操作：`runtime/runtime.db` → `tool_operations(operation_id=toolop_37330ca9e29d637a2c2030e42998d118, status=effect_pending, canonical_args_hash=dedc86da…)`；`runtime_events(284332, tool_recovery_decided, restart-recovery, verify reconcile_required)`；`operations(run_msg-1794550216090-516984122518_10, phase=recovery_parked)`
- 幂等守卫：`packages/server-core/src/durable-runtime/coordinator.ts:1000-1007`；`store.ts:508-517`（parked 计入 unsettled）；`coordinator.ts:378-394`（人工 reconcile）；`SessionManager.ts:1439,1454`（仅两类 adapter）
- 回执：`packages/pi-agent-server/src/pending-replies.ts:10-25`、`index.ts:290,964,1008,1979-1996`；`packages/server-core/src/runtime-adapters/pi-driver.ts:91-97`
- 上下文指标：`packages/server-core/src/context/source-reader.ts:16,24-32,38-46,61,90`；`context/session-context.ts:61,95-141`
- 焦点/分段：`context.db` → `pointers(261105-copper-cloud)`；`packages/session-tools-core/src/resident-context-contracts.ts:11-21,51-70`
- 角色提示词：`packages/shared/src/agent/resident-role.ts`（19,668 字符）；`packages/shared/src/prompts/system.ts:466`
- 记忆：`packages/server-core/src/resident-assistant/memory-store.ts:520-600`、`memory-maintenance-queue.ts:45-52`、`history-extraction.ts:85-118`、`project-memory.ts:113-127`；`packages/shared/src/workspaces/assistant-memory-policy.ts:48-52`
- 委派：`packages/server-core/src/resident-assistant/delegation.ts:74,211-255,300-335,389-433,486-570`、`worker-options.ts:18-51`、`worker-config.ts:24-52`、`delegation-scheduling.ts:10-42`
- 既有调查：`docs/verification/resident-context-063-stability-report-2026-11-13.md`（回执延迟 179/275/1,086 秒、主进程同步阻塞、42.6 MB / 3,669 解码）；`docs/architecture/resident-assistant-context-0.6.3-plan-2026-11-08.md`（§9.2 未结算效果不得绕过阻塞；§13 失败须返回可恢复动作）

## 修订记录

2026-11-17：依据原始记录复核及用户反馈，直接修正零字符入模、原子重写与内存索引、T1/T2 阶段、未知效果、模型目录、项目记忆、temporary 残留、依赖失效范围及分支归属判断；不再把暂未绑定、保留 HEAD 或沿用分支判为错误。所有实施统一指向主方案第 11 节，本文保留为已修订的证据文档。
