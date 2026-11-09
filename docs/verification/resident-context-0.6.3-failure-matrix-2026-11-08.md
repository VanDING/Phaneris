# 0.6.3 先行失败矩阵与测量契约

固定时间：2026-11-08，实施前。唯一实施依据：[版本计划](../architecture/resident-assistant-context-0.6.3-plan-2026-11-08.md)。

基线：`aab3af835`（实际 HEAD 以运行 manifest 为准），main；保留既有规划、台账及 packaged-client 验证改动。真实 Work 数据、安装版、提交、推送与发布不在操作范围。

| ID | 先行失败方式 | 验收证据 |
| --- | --- | --- |
| C01 | 普通线性会话丢失指代、工具配对或压缩覆盖；handoff 改写父子关系 | 普通 Session / Runtime / Pi 回归与实际请求 |
| C02 | 三类 Session 各存正文、执行或状态副本 | 共用 JSONL、Runtime、workspace/context.db；数据库结构 |
| C03 | A→B→A 只改数据库，SDK 仍带 B 正文 | 路由工具后的同轮 provider 请求 |
| C04 | 新工作全量展开候选；目录无限增长；同项目工作混合 | 有界目录、未展开数、分页/搜索与多工作输入 |
| C05 | 纠正与原要求同时有效；混合回复全量进入每个分支 | 原文范围、替代引用、分支关联与后续请求 |
| C06 | 精确回读每次重新加载整文件；游标掩盖内容变化 | 首扫/热读字节、解码记录数、范围、版本、游标 |
| C07 | 主线焦点/压缩/休眠使无关 Worker 失效 | 真实普通 Worker 的任务包、实际依赖及晚到回执 |
| C08 | 撤权、遗忘、相关修订被快照或检查点绕过 | 原文/派生依赖链有效性；具体错误 |
| C09 | 检查点伪造覆盖、工具成功或 done | 引用与逐来源游标；Runtime 当前事实；无任务状态列 |
| C10 | 换段丢输入/取消，重启重复执行，准备失败提前移动指针 | 原子提交指针、Runtime 顺序、效果计数与重启证据 |
| C11 | 长结果/工具回执绕过预算，换模型仍用旧窗口，静默截关键要求 | 实际请求 capacity、原生 compact、明确容量失败 |
| C12 | 晚到 A 结果绑到最新 B 输入，处理后丢失 B 指向 | 委派/输入/分支身份与前台指向 |
| C13 | 转换旧 segment 冒充检查点、双写新旧库、丢 suppression | 隔离副本升级、重试与恢复；旧库只读 |
| C14 | 受控工具 fixture 被报告为真实自主行为 | 确定性回路与真实模型结果分别登记 |

四个核心概念：SourceRef 只引用原所有者的版本与 UTF-16 范围；Branch 保存工作身份/目标/关联，只有活动/休眠，无 todo/done；Checkpoint 保存有界语义与各来源覆盖；ContextView 绑定本次请求、选中分支、材料版本/省略与预算。JSONL 唯一保存产品原文，Runtime 唯一保存执行事实，SQLite 唯一保存上下文元数据。

管理 schema：沿用 CONTEXT RPC 的只读 get；新增 branches（分页/搜索）、create（幂等 requestId）、select（多分支）、associate（范围/requirement/替代）、checkpoint（原文引用和覆盖）、hibernate。模型使用同一 schema 的 assistant_context 工具。旧 focus/resume/anchors/topics 仅作已有界面的输入适配，不保留旧累计组装路径。

容量口径沿用现有 requestCapacity：有效模型窗口扣除系统/工具、输出预留及增长余量；实际请求仍由 Pi 的容量门执行硬边界。选择先于压缩；关键输入和有效要求不截断。正文目录默认 12 项、精确读取默认 5000 字符、历史页默认 12000 字符；这些是单次读取上限，不是模型容量百分比。性能只比较同一文件同一精确读取的首扫与重复热读；不得把索引重建计为热读。

产物：每次独占目录、源码/配置哈希、输入与 Session 身份、provider 请求、材料清单、覆盖与读取量、错误/效果计数和机器 manifest。真实模型未运行时明确未测；历史 D 根因仍未知。

收尾回归追加（先有失败证据，再修复）：C06 的同轮历史读取不能将正在执行的读取工具当成已提交来源；C08 的已过期可选主线回复必须退出材料，不能阻止新的有效输入。证据分别为 live-final/checkpoint 的 stale outcome 与 temporal 回归失败，均保留原产物。

C03/C14 的同轮压缩视图还需保留 Runtime 管理动作回执：live-checkpoint-2 在 checkpoint/hibernate 已成功后反复选择、再次保存，最终触及 16 次真实推理的验收上限。修复必须只带动作身份与结果，不恢复旧工作正文，也不能凭助手文本推断成功。

## 2026-11-09 收尾结果与回归

| 失败方式 | 证据与修复 |
| --- | --- |
| C03/C14 回执为空，模型重复 select/checkpoint/hibernate 并耗尽预算 | live-checkpoint-2（保留）：17 次请求、16 次预算内 + 422；`settledContextActions` 为空。根因是 resident canonical 以当前 `runId` 排除本轮项。修复：`SessionManager` resident canonical 读取包含当前 run；`session-context.ts` 只提取成功的 `assistant_context` tool call/outcome。checkpoint-8 的 14 次请求中回执包含 create/select/associate/checkpoint/hibernate，checkpoint/hibernate 按分支各出现一次。 |
| C06/C09 同轮 select/associate 后的 checkpoint 使用过期 committed 快照，报 `context_checkpoint_unread` 并反复重试 | live-checkpoint-2/3 的失败样本保留。修复：`metadata-store.ts` 使用当前请求的 `entered`/`committed` 快照，并合并 active segment 已完成的 tool reads；仍在执行的工具不进入来源，`reference` 仍不证明已读。acceptance-6 的 C09 负向场景显式声明未读 reference，checkpoint 仍被拒绝。 |
| C09 检查点语义回执：hibernate 后模型看不到检查点内容，误报“恢复点没有保存”或沿用旧标签 | checkpoint-4 的“恢复点没有保存”与 checkpoint-7 的“三段式结构”保留为失败样本。修复：checkpoint 回执携带最多 600 字符的 conclusions 与有界 unresolved/next；checkpoint-8 的回复确认“恢复点已保存、工作已休眠、段落为两段”，并明确旧标签只是导航。 |
| UI E2E：fixture 等待已移除的 `aria-label`，且会话头部动作数已变化 | ui/ui-2 失败样本保留；ui-4 改为读取 `aria-description`、期望 4 个头部动作，34 scenes 通过，axe 结果 `[]`。 |
| C02 缺少三类 Session 共用存储的独立断言 | acceptance-6 新增 `C02-three-session-kinds-share-originals-without-duplicate-state`：共用 JSONL 仓库；`workspace/context.db` 无 message/transcript/execution 表；associations/views 不存原文；Worker 任务包留在普通 Session 历史。 |

收尾运行：acceptance-6 为 25/25（16 context + 9 recovery），UI-4 为 34 scenes，live-checkpoint-8 为 1 scene；统一四模式 live 与最终静态门禁/回归结果另行登记，未通过前不得宣称 0.6.3 完成。

### 2026-11-09 补充

- **C06 偶发失败（acceptance-5/7）**：JSONL 工具状态可能滞后于内存中的 `executing` 状态，导致同轮历史读取偶尔把在途工具当成已提交来源。修复：`readSessionMessagesFn` 在 flush 后按 Session 内存状态标记同轮工具结果为 `source_not_committed`；acceptance-8 起稳定通过。
- **UI 可访问名称**：`aria-description` 不被 `button` role 支持（workspace lint 失败）；改为包含可见文本（Phaneris、状态、待确认数）的 `aria-label`。UI-7 通过 34 scenes，axe `[]`。
- **统一四模式 live**：`live-final-2` 的 autonomy 通过；worker 在 10 次请求后收到 DeepSeek `402 http_failed`，未完成 revision/checkpoint。该阻断来自提供方余额/额度，不是代码断言失败；checkpoint 由 checkpoint-8 单独验证，worker/revision 仍以此前 live-3/revision-3 为参考并标注未在当前余额下复验。
- **源会话缓存（2026-11-09）**：`AssistantMemoryStore` 在一次校验快照内按 Session 缓存已解码来源，128 条引用只解码一次；`resident-assistant-sources` 13/13 通过。派生来源的血缘校验复用已验证的 source checks，不再重复全量解码。
- **Identity 门禁（2026-11-09）**：生成的 `docs/verification/results` 不参与残差扫描；34 条因此失效的 allowlist 规则已删除；`identity:check --strict` 通过。
