# 0.6.3 共用上下文核心与助手分支管理 — 最终验收报告

状态：verified — 2026-11-09。0.6.3 实施与门禁完成；统一四模式 live 的 worker/revision 因提供方 402 未在当前余额下复验。依据[0.6.3 计划](../architecture/resident-assistant-context-0.6.3-plan-2026-11-08.md)与[失败矩阵](resident-context-0.6.3-failure-matrix-2026-11-08.md)。

源码基线：`aab3af835868bc90b4b50b4ff85ddb14e53ff1a2`，`main` 工作区；本轮改动未提交、未推送、未替换安装版。所有验证使用隔离 workspace 与合成配置。

## 1. 结果

| 验收 | 结果 | 产物 |
| --- | --- | --- |
| 确定性 acceptance | **25/25**（16 context + 9 recovery），exit 0 | `docs/verification/results/resident-context-063-acceptance-9-2026-11-09` |
| UI E2E | **34 scenes**，exit 0；axe `[]` | `docs/verification/results/resident-context-063-ui-8-2026-11-09` |
| 真实模型 checkpoint | **1/1**，exit 0；14 次真实推理 | `docs/verification/results/resident-context-063-live-checkpoint-8-2026-11-09` |
| 统一四模式 live | **blocked**：autonomy 通过；worker 在 10 次请求后收到 DeepSeek `402 http_failed` | `docs/verification/results/resident-context-063-live-final-2-2026-11-09` |
| 回归 | native 11、history 22、extraction 19、temporal 14、delegation 64、control 23、sources 13、structure 4；全部 exit 0 | `docs/verification/results/resident-context-063-regression-*-2-2026-11-09`、`resident-context-063-regression-sources-4-2026-11-09`、`resident-context-063-regression-structure-2-2026-11-09` |
| 门禁 | `validate:ci` 全绿：typecheck:all、lint、i18n、docs、fonts、identity、version、runtime 与 electron pin | 本次运行记录 |

## 2. 收尾修复

1. **当前轮管理动作回执。** resident canonical 读取不再排除当前 run；`settledContextActions` 只提取成功的 `assistant_context` tool call/outcome，带动作身份、结果和有界检查点语义。
2. **检查点覆盖快照。** 使用当前 `entered`/`committed` 请求与 active segment 已完成读取，避免同轮 select/associate 后使用过期快照；仍在执行的工具和 `reference` 材料不计入已读。
3. **检查点语义回执。** checkpoint 回执携带最多 600 字符 conclusions 与有界 unresolved/next，使休眠后仍能准确报告已保存要求。
4. **UI fixture。** 助手岛使用包含可见文本（Phaneris、状态、待确认数）的 `aria-label`；resident 头部动作数为 context inspector、details、share、close。
5. **C02 验收。** 新增三类 Session 共用原文/执行/元数据、无正文副本或第二套执行状态的断言。
6. **在途工具历史读取。** Session 内存中的 `pending/executing/backgrounded` 状态覆盖滞后的 JSONL 快照，使 C06 不再偶发失败。
7. **源会话缓存。** 一次校验快照内按 Session 缓存已解码来源，128 条引用只解码一次。
8. **Identity 门禁。** 生成的 `docs/verification/results` 不再参与残差扫描，失效的 34 条 allowlist 规则已删除。

## 3. 关键证据

- `live-checkpoint-2-2026-11-08`：修复前失败样本；17 次请求（16 次预算内 + 422），回执为空，重复 select/checkpoint/hibernate。
- `live-checkpoint-4-2026-11-08`：checkpoint 已保存但回复称“恢复点没有保存”的失败样本。
- `live-checkpoint-6-2026-11-09`：回执已出现，但回复仍沿用“三段式”标签的语义失败样本。
- `live-checkpoint-7-2026-11-09`：校验器把 COPPER 分支的独立 checkpoint 误计为重复；保留为校验器失败证据。
- `live-checkpoint-8-2026-11-09`：回执包含 checkpoint/hibernate，checkpoint 回执含“两段”结论；回复确认“恢复点已保存、工作已休眠、段落为两段”，DB `revision=2`、`coverage=13`、`dormant`。

## 4. 场景覆盖

- C01 普通线性与原生压缩：`C01-normal-linear-no-assistant-directory`、`C01-real-Pi-native-compact-preserves-original-history`。
- C02 三类 Session 共用存储：`C02-three-session-kinds-share-originals-without-duplicate-state`。
- C03 A→B→A 与 SDK 投影：`C03-same-turn-provider-A-B-A-isolation`、`C03-native-compaction-and-branch-retirement-do-not-repeat-Worker-tool`、真实模型 autonomy。
- C04 多工作与有界目录：`C04-multiple-associations-and-bounded-directory`、真实模型 revision。
- C05 修正与替代：`C05-partial-requirement-replacement-preserves-other-original-ranges`、`C05-overlapping-reference-cannot-resurrect-superseded-clause`、真实模型 revision。
- C06 精确回读与在途读取：`C06-inflight-history-tool-is-not-its-own-committed-source`、`C06-exact-read-one-record-after-index-scan`、`C06-writer-index-survives-atomic-session-rewrite-without-rescan`。
- C07/C12 Worker 与晚到结果：`C07-real-worker-ordinary-session-task-material-isolation`、`C12-late-result-original-branch-preserves-B-focus`、`C12-late-event-applies-original-project-without-changing-foreground-project`、真实模型 worker。
- C08 撤权/遗忘：`C08-related-requirement-revision-fences-actual-inflight-Worker-before-tool`、`C08-forgotten-source-cannot-reenter-through-checkpoint`。
- C09/C10 检查点、休眠、恢复与崩溃：`C09-provider-reference-does-not-prove-checkpoint-source-read`、`C09-C10-checkpoint-sleep-restart-no-inference-replay`、四个 C10 场景、真实模型 checkpoint。
- C11 容量与模型切换：两个 C11 场景。
- C13 迁移与备份：两个 C13 场景。
- UI：RI01–RI18、MRP01–MRP04、`C04-context-inspector-restore-sleep-and-narrow-layout` 等 34 scenes。

## 5. 未测与边界

- 真实 Work 数据迁移、签名安装、跨模型泛化未测；统一四模式 live 被 DeepSeek 402 余额限制阻断：autonomy 通过，worker 未完成，checkpoint 由 checkpoint-8 单独验证。
- 历史 D 根因仍未复现；本期交付窄化材料边界与准确失效诊断，不宣称修复 D 的未知根因。
- 0.6.4 的并行调度、完整任务控制、review→done、Board 可见性，以及 0.6.5 并排界面保持范围外。
- 不提交、不推送、不发布、不替换安装版。
