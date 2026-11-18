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

1. **替代路径逐场景验收**：`task_*` 五个工具需覆盖 `prepare`/`select` 现有的全部准备场景，包括跨源续接、多分支选择、临时事件保前台。阶段 1–3 覆盖了主体，未覆盖「全部」。
2. **授权边界等价性证明**：去掉 `goalQuote` 后，`task_create` 的 `inputMessageId` 绑定必须能阻止「用旧授权派新范围」。这是一条安全性质，需要专门的对抗性场景，当前没有。
3. **长任务语义不退化**：移除原话重放后，跨天/跨压缩的任务续接仍需保留原始要求。需要一条真实的长任务回放。
4. **用户明确确认**：本清单本身不构成授权。

## 4. 建议的退役顺序

1. 先补三项必要条件对应的验收场景（不删代码，只加断言）。
2. 三个契约**分别**退役，不合并：`goalQuote` 是安全性质，`runtime_continuation` 是执行语义，`assistant_context.prepare/select` 是模型工具面。合并退役会让失败归因困难。
3. 每次退役后跑 `verify:assistant-delegation:all` 与既有执行入口回归。

## 5. 当前可如实声明的事实

- `task_create` / `task_amend` / `task_query` / `task_control` / `task_verify` 五个工具已实现并通过阶段 1–4 验收。
- 工作面板的验收决定与模型 `task_verify` 走同一个 `service.verify`，不存在第二条绑定路径。
- **旧契约仍在调用点，因此不宣称已退役。**
