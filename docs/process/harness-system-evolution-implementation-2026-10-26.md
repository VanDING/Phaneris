# Harness 系统演进实施记录

Status: accepted — implemented and locally verified on 2026-10-26; not merged or released.

分支：`codex/harness-system-evolution`。基线：`ab0282111`，Pi SDK 1.3.0。依据[系统方案](../architecture/harness-system-evolution-2026-10-25.md)及[实施前失败矩阵](../verification/harness-system-evolution-failure-matrix-2026-10-26.md)。工作区原有打包脚本和两份打包验收结果属于其他工作，本次不修改、不提交。

| 方向 | 当前落点 |
| --- | --- |
| 任务准备 | 显式技能按既有优先级解析并交付原文、hash 和范围；根规则直接准备；小文本附件提供真实视图；缺失指导明确说明并允许独立工作 |
| 能力与指导 | canonical 工具定义显式声明家族；基础产物/历史/资源入口直接可用；已选技能依赖与小型 source 集合预展开；发现返回 schema 和指导；完整手册留作细节参考 |
| 材料与容量 | 小全文 Read 在 canonical 结果内保留，不额外复制完整源文件；范围读取仍保存实际字节；结构概况与原始头尾文本并列，完整程序数据和媒体保留；容量读 SDK 当前占用并计入请求视图估算 |
| 连续性 | 从产品任务、用户输入和当前 Artifact 版本派生同一投影，供普通请求与 handoff 使用；历史可按消息 ID/字符范围读取；显式技能选择随原始输入持久化，空选择可清除，避免把交接引用误当新激活 |
| 压缩所有权 | Pi 原生摘要与保留区持续生效；SDK journal 仅追加与产品作用域绑定的覆盖位置，不存第二份摘要；普通续轮只收敛其后事实，跨边界缺失调用的 T2 使用完整事实恢复分支，原日志保留 |
| 执行 | 授权准备在效果锁外进行；原队列仍维持相关调用先后；T1/T2、取消与未知效果契约保留；结果投影不等待其他工具持有的资源 |
| 辅助模型 | 通用主路径退出自动 thinking 降档，显式当轮选择直接传递；推荐保持异步且过期失效；旧开关保留磁盘兼容、设置中显示停用 |

**实施中的取舍修订。** 为避免结果分配随并发顺序变化，曾尝试按调用顺序等待并复用前序空闲额度。HE11 的嵌套调用复现了等待环：后序写操作持有文件锁并等待前序结果，而前序 codemode 需要读取该文件。因此退出跨调用等待；本轮采用确定性预留，为原生写入回执与读取/查询分配不同权重。未消耗空间在下一请求的实际占用中自然体现，不宣称在同批次按实际大小完成全局最优分配。

结构化元数据不保证包含文本中的全部证据。原有回归样例发现纯结构视图会隐藏文本中的尾部反证，已经修正为结构概况与原始片段并列，保留原始返回和恢复入口。

**压缩与恢复。** 长历史验收复现了存量问题：每轮完整 canonical 收敛会撤销 SDK 的实际压缩。现在覆盖位置仅以已同步事实和实际写入 SDK journal 的同作用域生成结果推进；不能把输入接收回执当作模型已消费的证明。同步位置之后的用户原文保守保留，可能在压缩摘要之外再次出现一次。压缩前缀由 Pi 管理；未覆盖事实在其后收敛；调用已被摘要、迟到 T2 无法配对时，通过 SDK 公共分支 API 恢复完整事实，不重放工具效果。覆盖元数据随日志重开恢复，父任务生成回执不适用于子任务。原短会话压缩样例不足以证明实际缩减，已补入大输出的真实 Pi/Host 续轮和 SDK 日志重开场景。

**验证结果。** `bun run verify:model-harness` 通过 14 个工作流、132 个场景。其中真实 Pi/Host/SQLite 报告任务验证首轮原文交付、直接写入、更新技能、查中段历史、实际缩减后的续轮、失败重试与辅助请求隔离；SDK 日志场景验证压缩前缀、恢复分支、迟到结果、晚到用户与作用域隔离；材料和 Artifact 流程验证实际文件、范围与版本。

| 检查 | 本机结果 |
| --- | --- |
| `bun run verify:model-harness` | 132/132，通过；命令内构建实际 Pi 子进程 |
| `bun run typecheck:all` | 通过，覆盖全部工作区、构建与验证脚本 |
| `bun run lint` | 通过，含既有架构、边界、主题、IPC、治理及分发输入门禁 |
| i18n parity / sorted / coverage / dead-keys、identity、version | 全部通过 |
| `bun run check:docs`、`git diff --check` | 通过 |
| 崩溃恢复、Guarded、既有文档工具 | 分别 8、6、8 个补充场景通过；文档提取不代表 Office 视觉验收 |
| 既有 pi-agent-server 测试套件 | 通过；未新增单元测试，退役要求旧阅读门槛与全文指导常驻的断言，其行为由任务链路验证 |
| 既有 shared 测试套件 | 保留 3 个旧兼容 `PrerequisiteManager.trackBashSkillRead` 断言失败；该生产弃用模块及其失败断言与基线内容相同，未为其恢复阅读门槛；原始日志与文件身份归档 |

可核对证据：[最终索引与源文件身份](../verification/results/harness-system-evolution-2026-10-26-final/index.json)、[可重跑命令及完整日志](../verification/results/harness-system-evolution-2026-10-26-final/gate-final-verification.log.txt)、[fixture 报告](../verification/results/harness-system-evolution-2026-10-26-final/fixture-report.md)、[提交的可编辑 XLSX 草稿](../verification/results/harness-system-evolution-2026-10-26-final/fixture-submitted-draft.xlsx)、[首次提取](../verification/results/harness-system-evolution-2026-10-26-final/fixture-first-extraction.md)、[编辑后提取](../verification/results/harness-system-evolution-2026-10-26-final/fixture-updated-extraction.md)。索引保存每个归档文件的 SHA-256、原始 manifest、失败探针与未验证范围。实际请求/事件较大的原始 JSON 以 gzip 无损归档，解压后的身份与原 manifest 一致；保留的是选定证据，非完整临时数据库树。

**验证边界。** loopback 推理仅验证 harness 行为，未运行真实模型质量或延迟对照，不能据此声称模型完成率提高。未做 Office 视觉排版验收、全量 `validate:ci` / 全工作区单元组合、签名或跨平台发行。实际验证运行时为 Bun 1.4.2，仓库发行固定版本为 1.4.3，后者未执行；没有改动版本固定值。基础执行、权限与效果恢复仍使用现有契约。

首次任务准备、完整源重复保存、嵌套调度和压缩重放均在对应生产改动前或修复前保存失败结果。首次报告写入探针还需要修正 fixture 权限初始化，不能作为受控质量对照。新增工作流均使用既有验证产物机制。
