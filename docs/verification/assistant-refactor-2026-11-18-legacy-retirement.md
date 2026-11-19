# 旧契约退役清单（待用户确认，尚未删除任何代码）

状态：提案，2026-11-18。依据 [最终重构方案](../architecture/assistant-refactor-final-2026-11-18.md) §7 阶段 5「按实际调用点移除旧 Assistant 的模型侧准备、逐字目标引用、手填版本和原话重放契约」。

**本文件不构成授权。** 按 AGENTS.md，这些删除必须先展示变更摘要并取得用户确认；当前仅登记调用点、替代路径与风险，代码一行未改。

## 1. 三项待退役契约

| 契约 | 现状 | 替代路径 | 是否已验收 |
|---|---|---|---|
| `assistant_context.prepare` / `.select` | 仍是模型侧「准备代次」入口，用于选择分支与装配材料 | `task_create` / `task_amend` 记录定义；`task_query(checkReady)` 给出就绪与缺项；执行走 Host 的派工路径 | 阶段 1–3 已验收，但**未覆盖**「删除后所有准备场景仍有替代」 |
| `assistant_delegate.goalQuote`（逐字目标引用） | 要求模型把用户原话逐字写进派工，Host 校验包含关系 | `task_create` 记录的原始输入与要求版本，由 Host 绑定 `inputMessageId` | 阶段 2 已验收派工与回执，但**未覆盖**「去掉 goalQuote 后授权边界仍成立」 |
| `runtime_continuation` 原话重放 | 运行续接把原始输入原文重放进上下文 | 来源激活续接（`inputSource.kind === 'runtime_continuation'` 的既有分流）与内部事件各有身份 | 阶段 3 覆盖部分续接，**未覆盖**「重放移除后长任务语义不退化」 |

## 2. 调用点（生产代码，不含测试）

以 `packages/` 与 `apps/` 下非测试文件统计：

### 2.1 `goalQuote` —— 20 处，9 个文件

| 文件 | 处数 | 性质 |
|---|---:|---|
| `packages/server-core/src/resident-assistant/memory-derived.ts` | 5 | 从用户原话提取派生事实时携带引用 |
| `packages/server-core/src/sessions/SessionManager.ts` | 5 | 派工校验与授权边界 |
| `packages/server-core/src/resident-assistant/service.ts` | 3 | `dispatch()` 的引用一致性校验 |
| `packages/shared/src/agent/resident-role.ts` | 3 | 角色提示词中的使用说明 |
| `packages/server-core/src/context/metadata-store.ts` | 1 | 上下文元数据 |
| `packages/session-tools-core/src/delegation-contracts.ts` | 1 | 契约定义 |
| `packages/session-tools-core/src/memory-derived-contracts.ts` | 1 | 契约定义 |
| `packages/session-tools-core/src/task-delegation-contracts.ts` | 1 | `DelegationTaskDispatch.goalQuote`（可选字段） |
| `packages/session-tools-core/src/tool-defs.ts` | 1 | 工具描述文本 |

### 2.2 `runtime_continuation` —— 26 处，6 个文件

| 文件 | 处数 | 性质 |
|---|---:|---|
| `packages/server-core/src/sessions/SessionManager.ts` | 21 | 续接输入构造、排队、去重与结算 |
| `packages/server-core/src/resident-assistant/service.ts` | 2 | 完成路径判断 |
| `packages/server-core/src/runtime-adapters/input-lineage.ts` | 2 | 输入血缘 |
| `packages/core/src/types/message.ts` | 1 | 消息来源类型 |
| `packages/server-core/src/resident-assistant/delegation-refresh.ts` | 1 | 刷新输入 |
| `packages/server-core/src/resident-assistant/work-projection.ts` | 1 | 投影 |

### 2.3 `assistant_context` 的 `prepare` / `select` —— 契约定义与调用

| 位置 | 性质 |
|---|---|
| `packages/session-tools-core/src/resident-context-contracts.ts:13,25` | `select` 与 `prepare` 的 schema |
| `packages/session-tools-core/src/tool-defs.ts:949,966` | 工具定义与描述（注释已写明「older context/prepare tools」） |
| `packages/server-core/src/resident-assistant/service.ts:287` | 该会话允许的工具清单 |
| `packages/shared/src/agent/resident-role.ts:17,27` | 角色提示词 |

## 3. 删除前的必要条件（当前均未满足）

1. **替代路径逐场景验收**：`task_*` 五个工具需覆盖 `prepare`/`select` 现有的全部准备场景。**已逐项核对，结论见 §3.1：覆盖了来源与要求，未覆盖分支选择与临时保前台。**
2. **授权边界等价性证明**：去掉 `goalQuote` 后，`task_create` 的 `inputMessageId` 绑定必须能阻止「用旧授权派新范围」。这是一条安全性质，需要专门的对抗性场景，当前没有。可复用的基础：本轮已把幂等键绑定到 `(inputMessageId, 语义动作)`，说明"输入 ↔ 记录"的链接是可靠的，但"输入 ↔ 授权范围"仍需单独证明。
3. **长任务语义不退化**：移除原话重放后，跨天/跨压缩的任务续接仍需保留原始要求。需要一条真实的长任务回放。
4. **用户明确确认**：本清单本身不构成授权。

### 3.1 `prepare`/`select` 能力对照（条件 1 的核对结果）

按 `resident-context-contracts.ts` 的 schema 逐项对照 `task-delegation-contracts.ts`：

| `assistant_context` 的能力 | `task_*` 是否覆盖 | 依据 |
|---|---|---|
| 要求带**逐字来源**（`ResidentSourceSchema.quote`） | ✅ 覆盖 | `RequirementInputSchema.quote`（≤6000 字符） |
| 要求绑定**可信输入** | ✅ 覆盖 | `RequirementView.inputMessageId`，Host 在 `store.create` 写入 |
| 要求带**范围**（精确到片段） | ⚠️ 部分 | `quote` 可精确定位；但 `range: {offset,end}` 的显式字符区间没有对应字段 |
| 要求**部分更正**（`supersedes`） | ✅ 覆盖 | `RequirementInputSchema.supersedes` |
| 要求按**作用域**区分本次/长期（`scope: input/work`） | ✅ 覆盖且更细 | `REQUIREMENT_SCOPES = invocation \| task \| goal \| standing`（4 档，旧契约 2 档） |
| **分支选择**（`select` / `target.kind`） | ❌ **未覆盖** | `task_*` 无 `branchId` 字段 |
| **临时事件保前台**（`temporary`） | ❌ **未覆盖** | 无对应字段 |
| 续接既有执行（`continuationOf`） | ✅ 覆盖 | `DelegationTaskDispatch.continuationOf` |
| 准备进度/恢复（`preparation`/`recover`） | ⚠️ 不同模型 | `task_query.checkReady` 给就绪与缺项，不是代次 |

**结论**：`assistant_context.prepare` 不能被 `task_*` 完整替代，卡在两处——**分支选择**与**临时保前台**。这两项属于"选哪份材料"而非"做什么工作"，是任务定义之外的一层。

因此退役路径有两种，需用户选择：

- **路径一（推荐）**：把 `assistant_context` 缩减为只保留 `branches` / `select` / `associate`（材料选择），删掉 `prepare`/`preparation`/`recover`/`receipt`/`reconcile`（准备代次）。这样 D4 的强制门禁消失，D2 的字段混淆面随之消失，而分支能力保留。
- **路径二**：把 `branchId` 并入 `task_create.requirements`，然后整个 `assistant_context` 退役。改动更大，等同于把材料选择也并入任务定义。

我倾向**路径一**：它解决 D2/D4，风险面小，且保留"材料选择"与"工作要求"这两个本就不同的概念。


## 4. 真实模型给出的退役依据（2026-11-19 实测）

这一节把上面的推断变成证据。用真实 DeepSeek 回放（`assistant-task-live-model`），
旧契约在**未被要求**的情况下自行出现在调用链里，并造成三类失败：

| 现象 | 工具回执原文 | 说明 |
|---|---|---|
| 参数被套用 | `command.requirements.0.statement: unknown field` | 模型把 `task_create` 的 `statement` 用在 `assistant_context` 上。两套契约都在描述"要求"，字段名却不同 |
| 参数位置错误 | `config.fileScope: unknown field` | `assistant_delegate` 的 `fileScope` 在契约顶层，模型放进了 `config` |
| 强制门禁 | `work_not_prepared: Select alone is not preparation; use assistant_context prepare` | 派工必须先过 `assistant_context prepare`，新工具无法替代 |

这三条共同说明一件事：**只要 `assistant_context.prepare` 仍是派工的强制前置，模型就必须在两套语义之间切换，误用是必然的，不是提示词能治好的。** 因此本清单的结论从「应当退役」升级为「退役是派工路径的阻塞项」：

- 不退役 → D2/D3 的误用会持续发生；
- 退役 → 必须先证明 `task_*` 五个工具能覆盖 `prepare`/`select` 的全部场景，即第 3 节的条件 1。

同时，真实模型也给出了一条**支持退役**的正面证据：一次清晰的委托在 `task_create` 上被正确记录（Goal、要求版本、交付形式都对），随后 `assistant_delegate` 派工成功。也就是说新工具单独用是work的，问题出在两套并存。

### 4.1 本轮顺带修复的相邻缺陷

真实模型还暴露了一个与旧契约无关、但同属"重复提交"的问题：同一 `inputMessageId` 的不同 `requestId` 会创建两个 Task。已按幂等键 = (可信输入, 语义动作) 修复，实测 Goals 2→1、Tasks 2→1。这条不在退役范围内，记录在此是因为它同样由真实模型发现。

## 5. 建议的退役顺序

1. 先补三项必要条件对应的验收场景（不删代码，只加断言）。
2. 三个契约**分别**退役，不合并：`goalQuote` 是安全性质，`runtime_continuation` 是执行语义，`assistant_context.prepare/select` 是模型工具面。合并退役会让失败归因困难。
3. 每次退役后跑 `verify:assistant-delegation:all` 与既有执行入口回归。
4. **优先退役 `assistant_context.prepare`**：第 4 节表明它是 D2/D3/D4 的共同根源，先解开它，其余两项的误用面会显著缩小。

## 6. 当前可如实声明的事实

- `task_create` / `task_amend` / `task_query` / `task_control` / `task_verify` 五个工具已实现并通过阶段 1–4 验收。
- 工作面板的验收决定与模型 `task_verify` 走同一个 `service.verify`，不存在第二条绑定路径。
- 真实模型下，新工具的单独使用路径可用（委托被正确记录并派工）。
- 真实模型下，旧契约与新工具并存会产生参数误用（D2/D3）和强制门禁冲突（D4）。
- **旧契约仍在调用点，因此不宣称已退役。**
