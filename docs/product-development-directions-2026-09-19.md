# Phaneris 产品方向规划：从「可恢复」到「可信完成」

> **状态**：讨论稿（proposed）——方向取舍、优先级与规模估算等待决策
> **日期**：2026-09-19
> **定位**：能力方向规划（与 2026-08-31 收敛路线图互补）
> **依据**：
> - 当前源码快照（v0.2.0 / Bun 1.4.2 / Pi SDK 0.85.1）
> - [项目综合评估与发展路线图](project-assessment-and-roadmap-2026-08-31.md)
> - [Pi SDK 原生能力接入缺口分析](pi-sdk-native-capabilities-gap-analysis.md)（2026-09-19）
> - [Durable Agent Runtime ADR](architecture/durable-agent-runtime.md) 与[目标架构文档](architecture/durable-agent-runtime-target-architecture.md)
> - 五个标杆产品源码拆解（2026-09-19 对比研究：MiniMax Code、OpenAI Codex、PI-Desktop、Apache Maka、MonoCode）
> **证据边界**：源码结论来自对上述文档与关键模块的阅读及关键词扫描（worktree / sandbox / runaway / verifier / eval 等），未执行构建、测试与运行时验证。方向排序是建议，不是范围承诺。
> **与 8-31 路线图的关系**：那份文档解决「收敛与质量」（身份、CI、发布、拆分、数据治理）；本文档解决「能力方向」——在不违反其约束的前提下，回答"接下来值得开发什么、按什么顺序、第一刀怎么切"。

---

## 1. 一分钟结论

Phaneris 已经建成许多同类产品还在追赶的那一层：**持久执行 + 可检查运行 + 产物闭环**。下一步的价值不在于把功能面铺得更宽，而在于把一个闭环补完——今天的优势是"出了事能恢复"，明天的主张是"**不失控、可度量、可委托**"：

```mermaid
graph LR
    A["持久执行（已建成）"] --> B["不失控：护栏与预算"]
    B --> C["可度量：指标与评测"]
    C --> D["可委托：编排与外部控制面"]
    D --> A
```

- **首批建议（不新增一级产品域、直接服务既有 P1 风险与北极星指标）**：
  1. **A｜无人值守护栏与预算**：循环检测 + 任务预算 + 进度账本。
  2. **B｜命令级权限规则与显式能力包**：把 `allow-all` fallback 消灭掉，让批准变成可审计的资产。
  3. **E1｜完成率指标管线落地**：让"可验证完成率"从定义变成可读数字。
- **随后（与既有阶段 3/4 协同）**：C 上下文与工具面预算工程；D 编排 2.0（执行已定义的 verify/approval 节点、worktree 隔离、审批路由）。
- **契约稳定后再做**：F 生命周期钩子与受管扩展；G 外部 Agent 控制面。

> **补充（2026-09-20）**：F 的**内部那一半**已提前定案为独立设计——[`agentic-interception-design.md`](agentic-interception-design.md) 采用「治理与介入」定位，用 Pi 原生 extension 钩子（`tool_call` 的 `block`、`session_before_compact` 的 `cancel`、`input` 的 `transform`）实现拦截。它**不依赖 F 的"契约稳定"前置条件**，因为它是内联 extension + 工作区用户规则，不打开第三方 extension 加载。F 的**外部那一半**（插件分发行为）仍按原计划延后。
- **明确不做**：自研引擎、自建 TUI、Peer Mesh、通用工作流平台、多 CLI 适配器集合（§7 给出理由）。

---

## 2. 现状盘点（源码视角）

### 2.1 应保护的护城河

| 能力 | 源码证据 | 相对标杆位置 |
| --- | --- | --- |
| **Durable Runtime（T1/T2 副作用边界）** | [`architecture/durable-agent-runtime.md`](architecture/durable-agent-runtime.md)：Phase 0–5 基线、T1 事务（dispatch_committed）先于执行、T2 事务提交结果；四种恢复模式（`safe_replay`/`idempotent_keyed`/`reconcilable`/`never_auto_retry`）；五级恢复裁决；8 条不变量（"T1 无 T2 绝不解释为未执行"等） | 深度接近 Apache Maka 的"log is the runtime"体系，且已完成大部分落地；领先于其余三家的持久化语义 |
| **可检查运行（Run 工作区）** | README：Overview / Trajectory / Context / Map 四视图；轨迹含轮次、请求、工具调用、错误、压缩、时间关系 | 五个标杆中只有 Maka 有同等叙事（但其偏工程文档，不是产品视图）；这是我们最强的用户可见差异点 |
| **Artifact 闭环** | revision / checkout / preview / review；路径、符号链接、hash、lease、CAS 保护（8-31 路线图 §3.3） | 比 PI-Desktop 的"计划工件"、Codex 的 rollout 更完整地覆盖"交付物"而非"过程" |
| **多入口同一运行时** | Desktop / WebUI / CLI / Headless Server / Messaging / Automation 全部走 SessionManager | 形态接近 Codex 的 app-server 多客户端架构，但入口面更宽 |
| **Provider 中立 + Pi 子进程隔离** | [`pi-kernel.md`](pi-kernel.md)：Pi 0.85.1 被隔离在 `packages/pi-agent-server` 子进程；主进程拥有会话、权限、sources | 与 MonoCode 的"适配器外壳"相比更可控；与 Codex 自研引擎相比成本更低 |
| **无人值守与治理面已经存在** | automations（prompt/webhook/script 严格联合类型、并发锁）、tasks DAG（Conductor）、labels/statuses、kanban/calendar 投影 | 五个标杆里没有一家有同等"任务治理面"（Maka 有 scheduling 但无产品层） |

### 2.2 关键空缺（本次分析新发现或已列于路线图）

| 空缺 | 证据 | 影响 |
| --- | --- | --- |
| **并行任务无文件系统隔离** | 全仓 `worktree` 关键词 0 命中；TaskRunner 的节点是共享 cwd 的子会话 | 并行节点互相覆写；`max_parallel` 形同虚设；这是四个标杆（Codex/PI-Desktop/MonoCode/Maka）都做了隔离而我们没做的一项 |
| **无循环/空转检测** | `runaway`/`loop-detection` 0 命中；任务 schema 只有 repair loop 的 `max_iterations` 上限（3/10） | 长任务可能空转烧钱；无人值守场景最危险的失败模式没有护栏 |
| **无人值守权限靠 `allow-all` fallback** | 8-31 路线图 §4.7（TaskRunner 显式列为 P1 风险） | 最小权限被可用性静默替代；与"可信"叙事直接冲突 |
| **命令级权限规则缺位** | 权限 = 三模式（safe/ask/allow-all）+ 静态命令 allowlist（`isReadOnlyBashCommandWithConfig`）+ cli-domains；无用户可编辑的持久规则 | 用户每次都要重复批准同类命令；批准无法沉淀为资产（对比 Codex execpolicy） |
| **上下文与工具面预算无治理** | 会话工具 43 个（`session-tools-core/tool-defs.ts` 枚举）+ 动态注入的 source 工具；Pi 压缩参数未暴露（gap 文档 P3）；工具 schema 全部常驻 | 系统提示 token 与缓存前缀成本失控风险；压缩对用户是黑盒 |
| **任务 schema 只执行了 1/13 种节点** | [`shared/src/tasks/schema.ts`](../packages/shared/src/tasks/schema.ts)：13 种 `kind` 中 v1 仅执行 `session`，其余"parsed but deferred"（含 `verify`/`judge`/`approval`/`loop`） | 编排能力被自己的 schema 承认、但未兑现；多智能体只是"多会话并行" |
| **无评测/基准工具** | `eval`/`benchmark(Agent)` 无实现；只有 `scripts/performance/*`（性能） | 北极星指标（可验证完成率）没有度量机器；prompt/模型变更无回归防线 |
| **Pi 扩展钩子基本未用** | gap 文档：13 个事件仅注册 `before_agent_start`；interceptor 仍是全局替换式 | 上下文/工具/压缩的原生控制点空置；钩子化演进是后续 F 方向的地基 |
| **生命周期钩子缺失于插件体系** | plugin bundles（已实施）为 skills + MCP 物化；无 tool/permission/session 事件扩展点 | 扩展生态只能加"静态能力"，无法加"行为" |

---

## 3. 五个标杆的可迁移清单

> 每行只保留"值得带走的具体机制"。本表来自 2026-09-19 的五个产品源码拆解（对比研究记录）。

| 产品 | 它最深的一层 | 值得拿走的机制 | 我们的状态 |
| --- | --- | --- | --- |
| **MiniMax Code** | 治理模块（可靠性工程） | ① runaway-guard：6 类循环信号（动作重复/结果重复/同错误族/ABAB 循环/轮询/无进展）、HMAC 指纹、只信任宿主捕获的 provenance、每回合最多一次 steer、观察/干预双模式 **fail-open**；② goal 熔断（`noProgressStreak`/`noToolStreak` 两条独立计数）；③ 预算（tokensUsed/turnsUsed/timeUsed + `budget_limited` 自动迁移）；④ 计费感知的独立验证策略（托管路由用验证器，BYOK 不翻倍账单） | 全部为无；A、D 方向直接采用 |
| **OpenAI Codex** | 沙箱与审批纵深 | ① execpolicy：用户可编辑规则文件（前缀 + 域名）、`Allow<Prompt<Forbidden` 取最严、示例自校验、"always allow"→规则追加落盘、防呆清单；② shell-escalation：命令级"Run/Escalate/Deny"，批准后以升级权限重跑；③ 分层沙箱（Seatbelt/Landlock/Windows）；④ Guardian LLM 审批者（只读沙箱、trunk 复用保 prompt cache）；⑤ tool_search 延迟披露（按需装 schema，每题重置） | ④ 不需要（我们无云端成本结构）；①②⑤ 采用（B、C 方向） |
| **PI-Desktop** | 编辑协议 + 规格驱动开发 | ① 行锚定编辑（4-hex tag 索引非身份、seen_lines 出处证明、PUT/CUT/MOV 语言、"模糊即失败"）；② 计划契约：不可变工件 + 结构化审批 + 绝对过期 + 启动栅栏无重放；③ worktree 生命周期预留锁（spawn 与删除互斥）；④ 子代理契约：父上下文只收最终报告 + 心跳；⑤ R1–R7 规则（规格同步、E2E 场景库、验证台账） | ①②部分已有（SubmitPlan/权限栅栏），可对齐强化；③④采用（D 方向）；⑤采用（E 方向） |
| **Apache Maka** | 系统语义 + 可审计评估 | ① "Log is the runtime"：状态=日志的投影，终止不变量"只有 Run 自己的 terminal event 能宣布结束"（我们已等价建成）；② resume≠retry：repair/reconcile/continuation 三权分离 + "不能证明安全就 park"（我们已有裁决体系，可吸收"park 显式化"叙事）；③ 评测纪律：冻结 manifest + 指纹、"最早有效 attempt 为准"、全部重试与裁定披露、成本-通过双口径；④ SECURITY 诚实原则："唯一的强制边界是操作系统" | ①几乎等价（验证后可公开叙事）；②部分；③④采用（E、B 方向） |
| **MonoCode** | 聚合外壳 + 编排控制面 | ① 控制 CLI：loopback + token，"delegate（含 write scope `files` 与 `dependsOn`）/ wait / respond / review"，**worker 审批上报主控、agents never prompt the user**；② worktree 生命周期；③ 子进程工程（PTY 合帧、epoch 防重入、终止升级）；④ CHANGELOG 纪律与"暂不接新 provider"的克制治理 | ①采用（D、G 方向）；②采用（D）；④部分采用（流程） |

**共性收敛点**：五家在互不参照的情况下全部走向"**上下文压缩、分层权限、Plan/Goal 契约、子代理、事件日志**"这五组原语。我们已建成其中三组半（事件日志、契约、部分子代理），最大的相对缺口正是 **权限纵深** 与 **可靠性护栏**。

---

## 4. 筛选原则

1. **对齐既有约束**（8-31 路线图）：收敛期不新增一级产品域；延迟项保持延迟；先廉价后昂贵。
2. **只做强化"可信完成"叙事的**：每个方向必须能回答"它如何减少未解决副作用 / 提升可验证完成率 / 降低人工纠正"。
3. **优先复用已有结构**：durable usage ledger、Run 四视图、任务 DAG schema（含未执行 kinds）、pre-tool-use 管线、automations/tasks 治理面——都是现成的挂载点。
4. **先观察后干预**：任何自动动作（steer/park/拒绝）都先以只读模式跑一个版本，用真实数据校准再放权（MiniMax 的观察/干预双模式是标准做法）。
5. **诚实标注边界**：做不到的事（如跨平台 OS 沙箱）写进文档，不用 in-process 检查充当安全边界（Maka/MonoCode 的 SECURITY 原则）。

---

## 5. 方向详情（A–G）

### A｜无人值守护栏与预算（P1｜规模 M｜首批）

**目标**：长时间、无人值守的运行"不失控"——循环被识别、预算被计量、空转被中断、状态始终可解释。

**对标证据**：MiniMax runaway-guard（6 类信号、HMAC 指纹、trusted provenance、每回合至多一次 steer、fail-open）；MiniMax 熔断双计数；`budget_limited` 状态机；我们的任务 schema 已有 repair-loop 上限先例（`DEFAULT_REPAIR_ATTEMPTS=3`／`CAP=10`，[`shared/src/tasks/schema.ts`](../packages/shared/src/tasks/schema.ts)）。

**现状与缺口**：无循环检测（关键词 0 命中）；预算无实现；TaskRunner 只有 repair 上限；Run Trajectory 已经记录轮次/工具/错误——**检测器所需的输入数据已经存在**。

**设计要点**：
1. **检测器独立成模块**（不塞进 SessionManager）：输入 = durable runtime 的已提交语义事件 + 工具结果摘要；输出 = `signal{kind, occurrences, evidence}` 与建议动作。
2. 信号从保守集合起步：`exact_action_repeat`、`same_error_family`、`unchanged_progress`、`abab_action_cycle`；**指纹用哈希**，不改写原文。
3. 动作分级：`observe`（只记录，进 Run/指标）→ `nudge`（一次 steer 提醒，参考 `report_progress` 的中间文本语义）→ `park`（暂停节点，等待编排/人工决策，复用 durable 的"显式恢复决策"入口）。
4. **预算**：任务级与节点级 `tokens / wall-time / turns`，数据取自 usage ledger；触顶产生明确状态（`budget_limited` 语义）与续批操作，绝不静默继续。
5. **fail-open 铁律**：检测/通知/观察者任何失败都不能改变运行结果（MiniMax 的 observer 隔离经验）。
6. UI：Run 概览增加"健康"区（信号、预算余量）；kanban 卡片角标；通知走现有系统。

**✂️ 第一刀**：只读检测器 + Run 侧栏展示（无自动动作）。用一周真实会话数据校准阈值后再开 `nudge`。

**验收**：注入已知循环的样例任务在 ≤N 次重复后被标记；预算耗尽产生明确状态且可续批；对 Pi 原生重试（gap 文档记录的 retry 机制）零误报。

**风险**：误报打断正常重试 → 用观察期校准 + 阈值可配；复杂度 → 只做 4-6 个信号，不做平台。

---

### B｜命令级权限规则与显式能力包（P1｜规模 M｜首批）

**目标**：把"每次批准"变成"可沉淀、可审计、可解释的最小权限"；让无人值守任务拥有**显式声明的能力包**，而不是隐式 `allow-all`。

**对标证据**：Codex execpolicy（规则文件、最严优先、示例自检、批准落盘、防呆清单）；shell-escalation（批准后升级重跑）；PI-Desktop 审批候选作用域（窄默认 + 可放宽）。

**现状与缺口**：三模式 + 六步 pre-tool-use 管线（[`packages/shared/src/agent/core/pre-tool-use.ts`](../packages/shared/src/agent/core/pre-tool-use.ts)）+ 静态 allowlist；8-31 路线图 §4.7 明确 `allow-all` fallback 为 P1 风险；无持久规则文件、无作用域选项、无提权审计事件。

**设计要点**：
1. **workspace 级规则文件**（人类可读，随 workspace 备份）：起步仅两类——`命令前缀` 与 `域名`；决策取最严（deny 优先）。
2. **批准即沉淀**：审批卡片提供作用域选项（本次 / 本会话 / 始终），"始终"写入规则文件并生成审计事件；提供"查看/撤销规则"入口。
3. **命中解释**：每次允许/询问/拒绝都带 reason 链（可复用 DecisionReason 式结构），在 Run Trajectory 可见。
4. **无人值守能力包**：Automation / Task 声明 `capability envelope`（允许的工具类别、命令前缀、网络域、写路径），缺声明 = 阻断并给出修复指引；**删除 `allow-all` fallback**，旧任务进入显式迁移。
5. （配套、可后置）OS 级命令沙箱作为"能力包"的执行后端：先 Linux/macOS 可选，Windows 后置；无论是否有沙箱，文档按 Maka 原则如实声明边界。

**✂️ 第一刀**：规则文件读写 + "始终允许"落盘 + Run 里显示命中来源；`allow-all` fallback 改为显式声明缺失即阻断（可先用告警模式迁移）。

**验收**：重复批准同类命令的用户动作可归零；无人值守任务全部带显式声明；每次提权都有可检索的审计事件。

**风险**：规则复杂度失控 → 两类规则起步；跨平台沙箱成本高 → 遵守"诚实标注 + 可选后端"。

---

### C｜上下文与工具面预算工程（P2｜规模 M｜与阶段 3 协同）

**目标**：把"模型每轮看到什么"从黑盒变成有预算、有记录、可配置的工程对象。

**对标证据**：Codex tool_search 延迟披露（按需装 schema、每新提示重置、只恢复成功证据）；Maka auto-compact window（用服务端观测的 prefill 校正本地估算）；MiniMax context-manager（双通道 token 计数 + 安全切点 + 策略版本）。

**现状与缺口**：43 个会话工具 + 动态源工具全量常驻；Pi 压缩参数未暴露（gap 文档 P3）；[`system-prompt-per-turn-analysis.md`](system-prompt-per-turn-analysis.md) 已确立缓存前缀约束；Run Context 视图已能展示装配，但策略层是隐式的。

**设计要点**：
1. **延迟工具目录**：把低频工具（部分 session tools、按需源工具）移入"按需目录"，模型先搜索再装载；遵守缓存前缀约束（隐藏目录本身必须稳定）。
2. **压缩可观测**：压缩前后事件写入 Run Context（一次压缩=一条记录），参数按连接暴露（reserve/keepRecent 等，gap 文档 P3 清单）。
3. **预算守门**：每模型上下文窗口 → 预检 → 超限行为矩阵（压缩/拒绝/续写），服务端 usage 优先校正。
4. **长会话 UX**：checkpoint 行（PI-Desktop 模式）与 `new_context` 等价操作可供用户/模型主动触发。

**✂️ 第一刀**：测量基线（系统提示各段 token 占比）+ 压缩事件落 Run Context（纯观测）。

**验收**：常驻工具 schema token 占比下降且行为不回归；缓存命中率不下降；压缩从"黑盒"变为"有记录的决策"。

---

### D｜编排 2.0：隔离、验证、审批路由（P2｜规模 L｜依赖 A/B）

**目标**：让任务 DAG 从"多会话并行"升级为"隔离执行 + 独立验证 + 无人值守自治"的编排。

**对标证据**：PI-Desktop（verifier 角色、父上下文只收最终报告、Session Orchestrator 配额 4/16、worktree 预留锁）；MonoCode（`files` 写作用域、`dependsOn`、审批上报主控）；Codex（多代理生命周期；角色只减不增）；MiniMax（独立验证、计费感知）。

**现状与缺口**：`task.yaml` 已定义 13 种节点（`verify`/`judge`/`approval`/`loop` 等在列但仅 `session` 可执行）；`repair` 上限已定义未接线；节点共享 cwd（worktree 0 命中）；子会话上下文无契约；并行写无冲突检测。

**设计要点**：
1. **写作用域 + 隔离**：节点声明 `files`（写路径集合）；调度前做冲突检测（重叠即串行化或拒绝）；可选 git worktree 物理隔离（参照 MonoCode 的 spawn/removal 预留锁与"worktree 被删的会话恢复"）。
2. **执行已定义的 kinds**：先接 `verify`（结构化裁决 → 触发 repair 循环，受 `max_iterations` 约束）与 `approval`（无人值守编排中的显式门）；保持 DAG 边界，不做通用工作流平台。
3. **审批路由**：worker 的审批/提问上报编排会话（或指定审阅者），运行时**不阻塞在人类点击上**；等价实现 MonoCode 的 `needsInput` + `respond`。
4. **子代理上下文契约**：父上下文只收最终报告 + 心跳；子轨迹仍可检查（我们已有 Run 视图的天然优势）。
5. **配额与治理**：任务级最大并行/总量（参照 4/16 上限思路），超限可观测。

**✂️ 第一刀**：把 `files` 写作用域声明与冲突检测做进 TaskRunner（无需 worktree 即可先消除覆写事故），并给 Run Map 展示节点作用域。

**验收**：两个并行节点改同一文件在运行前被拦截或物理隔离；`verify` 失败按上限触发 repair 且全程可见；一个无人值守任务从派发到审阅无人工点击。

---

### E｜可信完成度量：指标、评测台与验证台账（P1/P2｜规模 M）

**目标**：让北极星指标（可验证完成率）变成机器里的数字；让 prompt/模型/压缩等变更可回归；让每次发布带可核查的验证记录。

**对标证据**：Maka 评测纪律（冻结 manifest、指纹、"最早有效 attempt 为准"、全量披露重试与裁定、成本-通过双口径）；PI-Desktop R1–R7 与 E2E 场景库；Codex/MonoCode 的 CHANGELOG 与 AGENTS.md 文化。

**现状与缺口**：指标定义已写进 8-31 路线图 §6，但无实现；无 Agent 质量评测（只有性能脚本）；发布验证方式有（`validate:ci` 等），但无"验证台账"格式与场景追溯。

**设计要点**：
1. **E1 本地指标管线（首批）**：从 durable runtime 事实计算——可验证完成率、unknown effect 计数/时长、恢复成功率、T1→T2 完成率、自动化成功率；**默认全本地存储、可导出**；Run 概览与工作区 Dashboard 展示。
2. **E2 评测台最小版**：20–50 个代表场景（研究/代码/文档/数据各若干）+ 固定任务集 + 多连接/多模型对比；冻结 manifest 与运行指纹；"最早有效 attempt"选择规则；结果落本地目录（可选择性公开）。
3. **E3 验证台账**：`docs/verification.md` 式记录（PASS / FAIL / NOT RUN 分列、绑定 commit）+ E2E 场景 ID ↔ 验收标准 ↔ 规范的追溯表；发布说明引用之。

**✂️ 第一刀**：E1 指标从 `runtime.db` 出第一张真实报表（完成率 + unknown effect 清单）。

**验收**：一次 prompt 或模型变更能在评测台看到回归；任一发布都能回答"在哪个 commit、跑了什么、哪些没跑"。

**风险**：评测台维护成本 → 场景少而精、按失败模式选题；指标被滥用 → 明确定义"完成=用户接受或明确成功且无未决副作用"。

---

### F｜生命周期钩子与受管扩展（P2/P3｜规模 M｜契约稳定后）

**目标**：把"全局 interceptor 替换"演进为原生生命周期钩子；为插件提供**受权限约束的行为扩展点**。

**对标证据**：Codex hooks 引擎（11 类事件）；MiniMax plugin-hooks（CLAUDE/CODEX 互操作格式）；PI-Desktop pi 扩展导入；Pi gap 文档 P1（内联 extension 接管 provider/context hooks）。

**现状与缺口**：Pi 13 个事件仅用 1 个（`before_agent_start`）；拦截器是全局替换且仅 Pi 可用；plugin bundles（已实施）只聚合静态能力（skills/MCP），无行为钩子。

**设计要点**：
1. **内联先行**：按 gap 文档 P1 清单，用原生 extension 逐步接管 interceptor 的逻辑（context 裁剪、请求改写、响应观测、压缩钩子），行为等价替换、可回退。
2. **失败取向显式化**：观察者 fail-open、权限类钩子 fail-closed（MiniMax 经验直接采用）。
3. **插件行为钩子**：在插件契约稳定后预留钩子清单 + 权限声明 + 信任声明（如实说明"插件仍是用户信任的代码"，不夸大沙箱能力）。
4. 结合 C 方向：钩子也是实现"延迟工具目录/压缩观测"的更优挂载点。

**✂️ 第一刀**：注册 `context` 与 `tool_result` 两个原生钩子，以观测模式与现有 interceptor 并行跑，比对一致性。

---

### G｜外部 Agent 控制面（P3｜规模 M｜战略选项）

**目标**：让外部 agent/宿主（Claude Code、Codex CLI、IDE、CI）能把任务**委托进 Phaneris 的运行时**并受同一权限/审计体系约束——把"执行工作空间"变成可被编排的执行底座。

**对标证据**：MonoCode control CLI（loopback + token；delegate/wait/respond/review；写作用域；"agents never prompt the user"）；Codex local MCP control（默认关闭、loopback、bearer、审核目录、`confirm` 语义明确非用户提示）；PI-Desktop RACP（目标规范）。

**现状与缺口**：多入口已存在（server RPC / WebUI / CLI / Messaging）；`spawn_session`/`send_agent_message` 已在会话工具面；`session-mcp-server` 包仅剩 dist；无对外的本地控制 API。

**设计要点**：
1. **最小控制面**：从现有 RPC 派生一组审核过的操作（列会话/委托任务/读状态/回答审批/停止/审阅），**默认关闭**、loopback + 一次性 token、每次调用走既有权限与审计（不新建第二套权限实现）。
2. **语义对齐**：`confirm: true` 一类的字段明确标注为"调用方确认"，不是用户批准；危险操作要求用户已在产品内授权。
3. 与 messaging gateway 互补：网关解决"人触达"，控制面解决"机器触达"。

**✂️ 第一刀**：设计文档 + 危险面清单（无实现），等待真实外部委托需求出现再动工。

---

## 6. 排序、节奏与首批建议

### 6.1 与 8-31 路线图的映射

| 既有阶段 | 可并行推进 | 说明 |
| --- | --- | --- |
| 阶段 0–1（收敛、CI） | **仅准备项**：设计文档、埋点、只读原型 | 不改变行为面，不违反"不扩域"约束 |
| 阶段 2（可信发布） | **A（观察模式）+ E1** | 指标与护栏直接服务发布信任链（完成率、unknown effect 报表） |
| 阶段 3（降复杂度） | **B + C + D1（写作用域）** | 与 SessionManager 拆分协同：ToolEffectBridge/SourceRuntime 拆分时，权限规则与钩子顺势接入；TaskRunner 加冲突检测 |
| 阶段 4（验证与单点扩张） | **D2–D4 + E2/E3**；**F**；**G（按需求）** | 8-31 已定"一次只开一个扩张方向"——建议第一个就是"编排 2.0"，理由是它复用最多既有结构、且对标证据最充分 |

### 6.2 首批四项（建议直接立项）

| # | 项目 | 规模 | 依赖 | 直接收益 |
| --- | --- | --- | --- | --- |
| 1 | A1 循环检测器（只读）+ A 的 Run 健康区 | S–M | 无 | 长任务风险可视化；为 nudge/park 校准 |
| 2 | A2 任务/节点预算（tokens/time/turns） | S | usage ledger（已有） | 无人值守成本可控；`budget_limited` 语义 |
| 3 | B3 能力包声明 + 移除 `allow-all` fallback | S–M | 任务/自动化 schema | 消灭已记录的 P1 风险；审计事件 |
| 4 | E1 完成率指标管线 | S–M | durable runtime（已有） | 北极星从定义变为数字；发布可引用 |

四项共同点：**不新增一级产品域、复用现有数据结构、可独立验收、失败可回退**。

### 6.3 规模与不确定性

- S ≈ 1–2 周（单点、契约清晰）；M ≈ 3–6 周；L ≈ 6 周+（跨模块、需设计评审）。
- 首批四项之外的方向（C/D/F/G）建议在首批验收后、依据指标与用户证据再冻结范围——与 8-31 的"验证后单点扩张"原则一致。

---

## 7. 明确不做（从五个项目中学会但不采纳）

| 不采纳 | 来源 | 理由 |
| --- | --- | --- |
| 自研 Agent 引擎 | Codex（169 万行 Rust） | Pi 内核 + 子进程隔离已是资产；自研会重演对方成本 |
| 多 CLI 适配器外壳 / meta-harness | MonoCode | 那是"聚合别人的订阅"的模式；我们的护城河在运行时与治理，不在适配数量 |
| Peer Mesh / P2P 网络 | Maka（libp2p/WebRTC） | 多机故事已由 server/headless + messaging 覆盖；无当前需求证据 |
| 自建 TUI | Codex（34 万行） | CLI 已存在；桌面/Web 是主战场 |
| 通用工作流平台 | 既有约束 | D 只执行 schema 已定义的节点，保持 DAG 边界 |
| 全量遥测 | 既有约束 + Maka 纪律 | 本地优先；广告式遥测会侵蚀信任叙事 |
| 云端 LLM 审批者（Guardian 模式） | Codex | 我们没有"自己出钱"的路由结构，不适用；但"审批者角色"思想在 D2 以本地独立验证会话形式吸收 |
| 行锚定编辑协议（立即） | PI-Desktop | 编辑工具归 Pi 内核所有；可在 F 稳定后用钩子做小范围实验，不现在自研 |

---

## 8. 风险与依赖总览

| 风险 | 缓解 |
| --- | --- |
| 护栏误报伤害正常重试 | 先观察后干预；阈值校准期；fail-open |
| 规则引擎复杂度蔓延 | 两类规则起步；最严优先；示例即测试（学 Codex，规则文件附正反例） |
| worktree 跨平台差异（Windows） | D1 先做"声明+冲突检测"（无 worktree 也有收益），物理隔离后置并做平台矩阵测试 |
| 评测台维护成本 | 场景少而精；按失败模式选题；结果本地、可导出 |
| 编排扩张与管理面膨胀 | 遵守 8-31 边界：不成为通用项目管理产品；只服务 Agent 工作 |
| 依赖：SessionManager 拆分节奏 | 首批不依赖拆分；B/C/D1 设计与拆分同步排期 |
| 依赖：Pi 版本与钩子缺口 | F 的清单来自 gap 文档；升级前核对 `.d.ts` 与运行时语义 |

---

## 9. 附录：证据索引

**Phaneris（源码与文档）**
- `packages/server-core/src/sessions/SessionManager.ts`（编排中心，约 8.9k 行）
- `packages/server-core/src/tasks/TaskRunner.ts`（Conductor；durable dispatch 边界）
- `packages/shared/src/tasks/schema.ts`（13 种节点 kind；repair 上限 3/10）
- `packages/shared/src/agent/core/pre-tool-use.ts`（六步权限管线）
- `packages/session-tools-core/src/tool-defs.ts`（43 个会话工具枚举）
- [`architecture/durable-agent-runtime.md`](architecture/durable-agent-runtime.md)（T1/T2、恢复模式与裁决、8 条不变量）
- [`project-assessment-and-roadmap-2026-08-31.md`](project-assessment-and-roadmap-2026-08-31.md)（§4.7 无人值守权限；§6 北极星；§7 阶段）
- [`pi-sdk-native-capabilities-gap-analysis.md`](pi-sdk-native-capabilities-gap-analysis.md)（钩子 1/13；P0–P6 清单）
- [`plugin-bundles-design.md`](plugin-bundles-design.md)

**五个标杆（外部项目；本次对比研究的证据）**
- MiniMax Code（`MiniMax-AI/minimax-code`）：`packages/agent-modules/runaway-guard/`、`goal/`、`context-manager/`
- OpenAI Codex（`openai/codex`）：`codex-rs/execpolicy/`、`shell-escalation/`、`core/src/tools/handlers/tool_search.rs`、`core/src/guardian/`
- PI-Desktop（`vastsa/PI-Desktop`）：`docs/spec/03-runtime/18-line-anchored-edit-contract.md`、`docs/spec/06-delivery/03-ai-development-workflow.md`、`src-tauri/src/worktree_lifecycle.rs`
- Apache Maka（`apache/maka`）：`docs/architecture/runtime-host-architecture.zh-CN.md`、`docs/architecture/runtime-resume-architecture.zh-CN.md`、`docs/eval/terminal-bench-2.1-*.md`
- MonoCode（`hardbeat920/monocode`）：`src-tauri/src/control_cli.rs`、`src-tauri/src/worktree_lifecycle.rs`、`src/lib/harness/registry.ts`

---

*本文档为讨论稿：方向取舍、优先级与规模估算等待确认；确认后可另立实施计划文档（或在本文件追加里程碑与验收清单）。*
