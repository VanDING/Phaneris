# 0.6.3 共用上下文实施记录

状态：implemented — 2026-11-09。用户已明确授权开发、验证及记录；不提交、推送、发布或替换安装版。统一四模式 live 的 worker/revision 在当前 DeepSeek 余额下被 402 阻断，其余验收与 `validate:ci` 通过。

唯一实施依据：[0.6.3 计划](../architecture/resident-assistant-context-0.6.3-plan-2026-11-08.md)。先行契约见[失败矩阵](../verification/resident-context-0.6.3-failure-matrix-2026-11-08.md)。

| 阶段 | 状态 | 证据/裁定 |
| --- | --- | --- |
| C0 | 完成 | 失败矩阵 14 项、测量口径、旧实现基线；`resident-context-063-baseline-2026-11-08` |
| C1 | 完成 | `packages/server-core/src/context/` 共用 Reader / Assembler / 元数据 / SessionContext；acceptance-8 的 16 个 context 场景通过 |
| C2 | 完成 | `assistant_context` 的 create/select/associate/checkpoint/hibernate、Worker 任务包与回执；live-3 autonomy+worker、revision-3、checkpoint-8 通过 |
| C3 | 完成 | C10/C11/C13、恢复 9/9、I/O 对比、Pi 原生压缩与换段；checkpoint-8 的真实检查点/休眠/恢复通过 |
| C4 | 完成 | acceptance-9 25/25、UI-8 34/34、checkpoint-8、八组回归、`validate:ci` 全绿；统一四模式 live 的 worker/revision 受 DeepSeek 402 阻断（autonomy 通过，checkpoint-8 单独通过） |

## 2026-11-09 收尾修复

1. **回执真正包含当前轮已提交的管理动作。** `SessionManager` 的 resident canonical 读取不再排除当前 run；`session-context.ts` 从 canonical 提取成功的 `assistant_context` tool call/outcome。分支组装仍丢弃 canonical items，正文不会回灌。回执只包含动作身份、结果与有界检查点语义（`conclusions` 最多 600 字符，`unresolved`/`next` 最多 10 项）。
2. **检查点覆盖使用当前请求快照。** `metadata-store.ts` 由 `findLast(committed)` 改为最近的 `entered`/`committed` 请求，并合并 active segment 已跟踪的完成读取。同轮 select/associate 后不再使用过期快照；`reference` 仍不证明已读，仍在执行中的工具不计入。
3. **检查点回执保留语义结果。** checkpoint 回执携带模型刚刚写入的有界 conclusions，使 hibernate 后已退出材料的分支仍能准确报告“已保存两段要求”，不再被过时分支标签误导。
4. **UI fixture 与可访问名称对齐。** 助手岛使用包含可见文本（Phaneris、状态、待确认数）的 `aria-label`；resident 会话头部动作数更新为 context inspector、details、share、close。
5. **补充 C02 验收。** 断言三类 Session 使用共用 JSONL 仓库、`workspace/context.db` 不拥有 message/transcript/execution 表，associations/views 只保存引用，Worker 任务包保留在普通 Session 历史。
6. **在途工具历史读取。** `readSessionMessagesFn` 在 flush 后按 Session 内存中的 `pending/executing/backgrounded` 状态标记同轮工具结果为不可用，消除 JSONL 状态滞后导致的 C06 偶发失败（acceptance-5/7 的失败样本保留）。
7. **源会话缓存。** `AssistantMemoryStore` 在一次校验快照内按 Session 缓存已解码来源，128 条引用只触发一次会话解码；重复来源命中缓存。`resident-assistant-sources` 的 13 个场景通过。
8. **Identity 门禁清理。** 残差扫描排除生成的 `docs/verification/results` 证据，并删除因此失效的 34 条 allowlist 规则；`identity:check --strict` 通过。

## 运行证据

| 产物 | 结果 |
| --- | --- |
| `docs/verification/results/resident-context-063-acceptance-9-2026-11-09` | 25/25（16 context + 9 recovery），exit 0 |
| `docs/verification/results/resident-context-063-ui-8-2026-11-09` | 34 scenes，exit 0；axe `[]` |
| `docs/verification/results/resident-context-063-live-checkpoint-8-2026-11-09` | 1 scene，exit 0；14 次真实推理；`settledContextActions` 含 checkpoint/hibernate；回复确认两段与已保存检查点 |
| `docs/verification/results/resident-context-063-live-checkpoint-7-2026-11-09` | 失败样本：校验器把 COPPER 分支的独立 checkpoint 误计为重复；已改为按分支去重，保留为失败证据 |
| `docs/verification/results/resident-context-063-live-final-2-2026-11-09` | autonomy 通过；worker 模式在 10 次请求后收到 DeepSeek `402 http_failed`，无法完成统一四模式；不是代码断言失败 |
| `docs/verification/results/resident-context-063-live-checkpoint-2-2026-11-08` | 修复前失败样本：同轮重复 select/checkpoint/hibernate、回执为空、预算耗尽 |
| 回归（2026-11-09） | native 11、history 22、extraction 19、temporal 14、delegation 64、control 23、sources 13、structure 4；全部 exit 0 | `docs/verification/results/resident-context-063-regression-*-2-2026-11-09`、`resident-context-063-regression-sources-4-2026-11-09`、`resident-context-063-regression-structure-2-2026-11-09` |

## 未测与边界

- 真实 Work 数据迁移、签名安装、跨模型泛化仍未测；统一四模式 live 证据见 `live-final-2`：autonomy 通过，worker 被 DeepSeek 402 余额限制阻断；checkpoint 由 checkpoint-8 单独验证。
- 历史 D 的根因仍未复现；本期只交付窄化材料边界与准确失效诊断。
- 0.6.4 的并行调度、完整任务控制、review→done、Board 可见性，以及 0.6.5 并排界面保持范围外。
- 所有改动仍在 `main` 工作区，未提交、未推送、未替换安装版。
