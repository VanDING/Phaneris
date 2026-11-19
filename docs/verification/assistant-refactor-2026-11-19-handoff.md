# Assistant 重构交接

你在 `E:\Phaneris` 的分支 `codex/assistant-refactor` 上，继续完成 Assistant 重构的剩余验收。

**只以这两份文档为权威进度来源，不要依赖任何聊天记录：**

- `docs/architecture/assistant-refactor-final-2026-11-18.md` —— 目标设计
- `docs/verification/assistant-refactor-2026-11-18-failure-matrix.md` —— 失败矩阵与实际进度

先读这两份，再读 `docs/verification/assistant-refactor-2026-11-18-legacy-retirement.md`（旧契约退役清单）。三份都不长，读完再动手。

## 当前真实状态（2026-11-19 实测，非叙述）

工作树干净，HEAD 为 `f76dd41ac`。以下均为实测结果：

| 项 | 命令 | 结果 |
|---|---|---|
| 全量套件 | `bun run verify:assistant-delegation:all` | **69/69，exit 0** |
| 面板像素验收（真实 Electron） | `bun run verify:assistant-delegation-panel` | 5/5 |
| 真实 Worker 产物闭环（M10/M15） | `bun run verify:assistant-delegation-delivery` | 9/9 |
| 授权边界 | `bun run verify:assistant-delegation-authority` | 5/5 |
| 真实模型回放 | `bun run verify:assistant-delegation-live` | LM01/LM02 稳定通过；**LM03 失败，4/4 复现** |
| typecheck / lint / check:docs / identity | — | 全绿 |

## 已经完成的（不要重做）

1. **工作面板**：`FocusBoard` 由标题栏 peek 与助手界面共用。助手界面里是**从视图顶部展开的 sheet**（portal 到 `#resident-assistant-surface`，`top: 8px`，居中，宽 1040），不是悬浮 popover。左列分段+记录+动作，右栏执行中+产物贴底。
2. **D1（重复建任务）**：幂等键 = `(inputMessageId, 语义动作)`。真实模型对照 Goals 2→1、Tasks 2→1。store schema v2。
3. **授权缺口**：`task_create`/`task_amend` 现校验每条要求引文必须是绑定输入的原文摘录，不匹配即 `task_authority` 拒绝。已反向验证断言有效。
4. **并发上限**：默认 **18**（`DEFAULT_ASSISTANT_TASK_CONCURRENCY`，导出在 `packages/session-tools-core/src/delegation-contracts.ts`）。工作区显式 `assistantTasks.concurrency` 仍按原样生效。
5. **旧契约退役清单**：证据、能力对照、路径 A/B 与推荐都已写入文档。**尚未删除任何代码。**

## 剩余工作，只有一项

**旧契约退役（矩阵第 4 项）**。用户已授权路径 A：`assistant_context` 只保留材料选择（`branches`/`create`/`select`/`associate` 等），删掉准备代次（`prepare`/`preparation`/`recover`/`receipt`/`reconcile`）。

这是**当前派工路径的阻塞项**，不是收尾清理。真实模型回放里 D2–D4 全部由此产生：

- D2 `assistant_context` 被套用 `task_create` 的 `statement`
- D3 `assistant_delegate` 的 `fileScope` 被放进 `config`
- D4 `work_not_prepared: Select alone is not preparation; use assistant_context prepare` / `work_input_pending` —— 模型想派工/追加变更时被反复拒绝

**已经验证过的事实，能省你很多时间：**

- 这些拒绝**与并行槽位无关**。历史日志里每次被拒时都是 `capacity=4, occupied=0`，槽位全空。
- 门禁位置：`packages/server-core/src/context/session-context.ts:297`（`assertBusinessTool`）。三条下游（`preparedBranches`/`preparedTaskMaterials`/`assertContinuation`）都依赖 `admittedPreparation`，所以**不能只删门禁**。
- `packages/server-core/src/context/session-context.ts:273` 的 `outcome()` 写着 `!actual?.preparation || ...`，说明**无 preparation 的请求在设计上是允许的**。
- **已试过并失败、不要重复**：在 `assertBusinessTool`（派工时）创建隐式 preparation 会触发 `context_view_missing: Request does not match its committed view`，因为 provider 请求携带的是**构建时**的 preparation，`assertRequest` 会比对已提交视图。失败的实现已回退，套件当时 64/64 全红。
- 存在的绕过路径：`directUserPreparation`（`work-preparation.ts:178`）+ `workAdmissionId`/`directUserPreparationId`（`SessionManager.ts:3522-3550`）。注意 `directUserPreparation` 自身也要求已存在 preparation。

**建议的下一步**：先只改 `assertBusinessTool` 的**放行条件**（无 preparation 时放行、不创建任何记录），让派工走既有 `direct` 隔离路径，然后立刻用 `bun run verify:assistant-delegation`（**不是** `assistant-task-delegation`，后者是纯规则验收、不碰工具路径）验证，最后用真实模型回放看 LM03 是否随之稳定。一次只改一处，每步都跑套件。

## 必须遵守的规矩

- **删除前必须先给出变更摘要并取得用户明确确认。** 用户已授权路径 A，但每删一个契约仍应先给出该契约的摘要。
- 每次改完必须跑：`bun run electron:build:main`（**改了 server-core 就必须重建，否则应用内嵌旧代码、报 schema 版本错误**）、`bun run electron:build:renderer`（改了渲染层）、`bun run verify:assistant-delegation:all`。
- 改协议要同步四处 + 两个硬编码计数：`channels.ts`、`input-contracts.ts`、`method-contracts.ts`、`routing.ts`；`scripts/ipc-inventory.ts --update` 与 `scripts/contract-inventory.ts`。
- 改 i18n key 必须 7 个语言同步，`bun run scripts/sort-locales.ts` 后 `bun run scripts/check-i18n-parity.ts`。
- **不要用 PowerShell 做源码字符串替换**（引号/逗号会出错），用 `edit`/`write` 工具。
- `.cjs` fixture 不能含 TS 语法（`as const`、`!`、顶层 `await`）。
- 报告纪律：确定性回放 / 真实模型 E2E / 性能分项报告，替身结果必须标注。不要把小样本说成结论。

## 真实模型回放的运行条件（踩过坑）

```bash
bun run verify:assistant-delegation-live
```

- **必须先退出 Phaneris 桌面应用**（单实例锁）。打包版是 `Phaneris.exe`，开发版是 `electron.exe`，**两者都占锁**，工作流两者都检测。
- 工作流把安装的 `credentials.enc`/`credentials.key` 与 Chromium 的 **`Local State`**（safeStorage 主密钥所在，位置是 `<config>/user-data/`）复制到隔离配置根，不改用户配置。漏了 `Local State` 就会报 `Error while decrypting the ciphertext` 并回退到 machine-id 派生。
- 连接用安装配置的默认项（当前为 Command Goat 的 `deepseek/deepseek-v4.1-flash`）。
- 该工作流**故意不在 `:all` 里**，因为它需要独占桌面实例。
- 若 Worker 报 `Payment Required`，那是账户余额，不是产品缺陷。

## 最后

矩阵的 §6/§7 与 untested 声明需要随进度更新，这是目标的一部分。完成后逐项核对目标里的四件事都有可重跑命令与实测证据，再宣称完成。
