# 旧契约退役清单（路径 A 已实施，2026-11-19）

状态：**路径 A 已按用户确认实施**。依据 [最终重构方案](../architecture/assistant-refactor-final-2026-11-18.md) §7 阶段 5「按实际调用点移除旧 Assistant 的模型侧准备、逐字目标引用、手填版本和原话重放契约」。

用户于 2026-11-19 明确确认路径 A：`assistant_context` 只保留材料选择，删掉准备代次。删除前已逐契约给出摘要（见 §7）。

**本轮只退役第 1 项契约（`assistant_context` 的准备代次）。** `goalQuote` 与 `runtime_continuation` 原话重放**仍未退役**，调用点保留，不得宣称已退役。

## 1. 三项待退役契约

| 契约 | 现状 | 替代路径 | 是否已验收 |
|---|---|---|---|
| `assistant_context.prepare` / `.preparation` / `.recover` / `.receipt` / `.reconcile` | **已于 2026-11-19 退役（路径 A）**：从 `AssistantContextSchema` 移除，并在工具边界强制拒绝 | 材料选择留在 `branches`/`create`/`select`/`associate`/`hibernate`/`checkpoint`/`get`；工作要求由 `task_create`/`task_amend` 记录；派工由 `assistant_delegate` 直接发出 | **已验收**：确定性 70/70 + 65/65；真实模型回放中旧契约拒绝 0 次 |
| `assistant_delegate.goalQuote`（逐字目标引用） | **仍保留**，未退役 | `task_create` 记录的原始输入与要求版本，由 Host 绑定 `inputMessageId` | 阶段 2 已验收派工与回执，但**未覆盖**「去掉 goalQuote 后授权边界仍成立」 |
| `runtime_continuation` 原话重放 | **仍保留**，未退役 | 来源激活续接（`inputSource.kind === 'runtime_continuation'` 的既有分流）与内部事件各有身份 | 阶段 3 覆盖部分续接，**未覆盖**「重放移除后长任务语义不退化」 |

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
2. **授权边界等价性证明**：去掉 `goalQuote` 后，`task_create` 的 `inputMessageId` 绑定必须能阻止「用旧授权派新范围」。这是一条安全性质，需要专门的对抗性场景。

   **实测状态（2026-11-19，`bun run verify:assistant-delegation-authority`，5/5）**：

   | 性质 | 现状 | 结论 |
   |---|---|---|
   | 只有直连用户输入能定义工作 | ✅ `task_authority: only a direct user instruction can define new work` | 成立 |
   | 要求记录来源输入 | ✅ `RequirementView.inputMessageId` | 成立 |
   | 一个输入只定义一次工作 | ✅ 幂等键 | 成立 |
   | **引文必须真的出自该输入** | ✅ 已补：`task_authority: A requirement quote must be an excerpt of the user input` | 成立 |

   **缺口与关闭过程**：场景 `AU03` 起初测到用户从未写过的引文 `"words the user never wrote"` 被原样存入（`storedQuote` 存下、`quoteVerified: false`）——`writeRequirements` 只做 `quote: input.quote` 的透传，从不比对 `inputMessageId` 指向的原文。拦住这条的当时只有 `assistant_context.prepare`。

   **退役前已补上**：`task_create`/`task_amend` 现在比对引文与绑定输入，不匹配即拒绝；比较时只归一化空白，所以逐字摘录才算数。已用反向验证确认断言有效——关掉校验即报 `Missing expected exception: an invented quote must be refused`。这也意味着退役 `prepare` 不再削弱授权边界。
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
- **第 1 项契约（`assistant_context` 准备代次）已退役并验收**（见 §7）。
- **`goalQuote` 与原话重放仍在调用点，因此不宣称这两项已退役。**

## 7. 路径 A 实施记录（2026-11-19）

### 7.1 删除前给出的契约摘要

用户已授权路径 A。按规矩，删除前先给出该契约的摘要：

> **契约**：`assistant_context` 的 `prepare` / `preparation` / `recover` / `receipt` / `reconcile`（准备代次）。
> **删除范围**：仅模型侧 `AssistantContextSchema`。Host 自用的、用户发起派工的准备路径保留（`SessionManager.dispatchAssistantWork` 内部调用），因为它不是模型契约。
> **删除后由什么承担**：材料选择留在 `branches`/`create`/`select`/`associate`/`hibernate`/`checkpoint`/`get`；工作要求由 `task_create`/`task_amend` 记录（且引文必须出自绑定输入，见 §3 条件 2）；派工由 `assistant_delegate` 直接发出。
> **配套改动**：`tool-defs` 描述、`resident-role` 提示词、`assistantContextFn` 中随之失效的分支，以及 3 个仍驱动模型侧 `prepare` 的 fixture。

### 7.2 实际改动

| 文件 | 改动 |
|---|---|
| `packages/session-tools-core/src/resident-context-contracts.ts` | `AssistantContextSchema` 由 12 个动作收敛为 7 个；删除 `modelPreparation` 派生 |
| `packages/session-tools-core/src/tool-defs.ts` | `assistant_context` 描述改写为材料选择；**在 `handler` 内加 `AssistantContextSchema.parse`**——原先 `inputSchema` 只是给模型的建议，运行时并不校验，退役必须落在边界上（见 §7.3） |
| `packages/shared/src/agent/resident-role.ts` | 移除 `prepare` 仪式与 `receipt`/`reconcile`/`preparation`/`recover` 指引；要求记录改由 `task_create`/`task_amend` 承担；保留 `create`/`select`/`associate` 语义 |
| `packages/server-core/src/resident-assistant/service.ts` | `assistantContextFn` 删除 `receipt`/`reconcile` 分支与 `prepare` 专属的 warm/continuation/queued 检查 |
| `packages/server-core/src/context/session-context.ts` | 门禁放行：无 preparation 绑定即授予 admission，不创建任何 preparation 记录；新增 `admittedScope` 统一解析分支/输入/准备身份，`admittedPreparation` 允许 `work` 缺失 |
| `packages/server-core/src/sessions/SessionManager.ts` | 派工材料路径改用 `admittedScope`；`preparationId` 变为可选（无准备时写入不带该字段的 `contextBinding`） |
| `scripts/verification/...` | 3 个 fixture 改用保留的 `select`；新增 `D09`（无准备派工）与 `RW13`（退役动作在真实边界被拒绝）两条断言 |

### 7.3 一个必须记下的实现事实

`SessionToolDef.inputSchema` **只用于向模型声明参数**（`toJSONSchema()`），`pi-agent.ts` 调用 `def.handler(ctx, args)` 时**不做校验**。因此只从 `AssistantContextSchema` 删除动作，模型看不到它，但伪造调用仍会被接受。退役只有落到 `handler` 的 `parse` 上才成立。已用探针逐个动作验证：`branches`/`select`/`create`/`associate` 通过，`prepare`/`preparation`/`recover`/`receipt`/`reconcile` 均抛 `invalid_union`。

### 7.4 验收结果（实测）

| 项 | 命令 | 结果 |
|---|---|---|
| 全量套件 | `bun run verify:assistant-delegation:all` | **70/70，exit 0**（原 69 + D09） |
| 委派工具路径 | `bun run verify:assistant-delegation` | **65/65**（原 64 + RW13） |
| 控制 / 上下文 / 授权 | `verify:assistant-control` / `verify:assistant-context` / `verify:assistant-delegation-authority` | 23/23 · exit 0 · 5/5 |
| 管理（原为红） | `verify:assistant-tasks:management` | **14 场景通过**（修掉了陈旧的 `capacity === 4` 断言） |
| typecheck / lint / electron:build:main | — | 全 exit 0 |

**反向验证**：撤掉门禁放行改动，`D09` 立即失败（`The delegation must be accepted without a preparation pass`）；撤掉边界 `parse`，`RW13` 立即失败。

### 7.5 未完成与未宣称的部分

- `goalQuote` 与 `runtime_continuation` 原话重放**仍在调用点**，本次未动。
- LM03 在退役后仍不稳定（5 轮中 1 轮通过）。旧契约拒绝已实测降为 **0 次**，失败原因转移到 Worker 执行受阻与事件优先级，见 [失败矩阵](./assistant-refactor-2026-11-18-failure-matrix.md) 的"退役后 LM03 仍失败的实测归因"。**不宣称 LM03 已稳定。**
