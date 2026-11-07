# 常驻助手记忆与读取修复实施记录

本轮承接真实 Work 测试发现的历史索引 UNIQUE 冲突、学习策略异常暂停及 RPC 超过 16 MiB。保留实施前已存在的 0.6.2 改动；不重做四层记忆，不引入新记忆平台、人格文件或身份数据库。

## 实现

| 问题 | 修复与边界 |
| --- | --- |
| v2 将会话标为 pending，却保留旧消息投影 | 历史 schema 升至 v3；旧库与已卡死的 v2 均进入有界重建。每个 pending 会话在同一事务中完整替换消息投影，不用忽略冲突掩盖残留。原会话、记忆、修订、遗忘记录、抽取断点均保留 |
| 登记 ID 与旧工作区本地 ID 不一致 | 仅接受 Host 已登记身份且规范物理根目录相同的旧别名。新登记复用本地工作区 ID；缺失工作区的恢复使用已登记 ID。不改名旧库 owner、会话、项目或迁移清单 |
| 缺省自动学习未初始化；错误提示含糊 | 缺省策略在已核实工作区上初始化；false、paused、explicit、use=false 均原样保留。各记忆写入所有者共用策略检查，区分无效配置、身份不符、暂停及显式请求 |
| 旧条目缺少 assessment | 保留可检索性，L3 报告未评估条目数及有效策略。不得伪造分类；已有原文核对与 revise 可补充评估，不新增模型循环 |
| 主助手打开、调整执行上限返回整个时间线 | RPC 只返回元数据；客户端复用 Session 分块读取和快照字典，继续向现有界面交付完整 Session。16 MiB 帧限制不变，原文及诊断快照完整保留 |
| 管理 RPC 来源回读仍可能超过帧上限 | 模型和管理读取复用同一来源分页方法，默认 5000 字符、单次最多 12000 字符，以内容哈希固定版本。可达的原文界面沿用现有 SessionOriginals 分页，不修改未接入路由的旧详情组件 |
| 旧工作区无项目目录时模型进程无法启动 | `none` 是配置标记，不展开成 cwd/none。工作区配置、完整会话、启动元数据和执行目录解析保持各自语义；实际执行落在 Session 所有目录，原 SDK 会话 ID/存储 cwd 不改写 |

L0 原文直读仍由 Session 所有者提供，不依赖历史索引完成或记忆已入库。关闭自动召回时仍可显式阅读授权原文；遗忘与 Source 撤权边界保留。L2 保持可选、L3 保持派生，项目事实仍归各项目 MEMORY.md。

## 先失败、再修复的证据

所有证据目录位于仓库忽略的 `.cache/verification/`，未覆写既有验收。新增工作流均在生产修复之前实际运行；不是事后添加单元测试。

| 阶段 | 命令 / 证据 | 观察 |
| --- | --- | --- |
| 历史索引失败 | `bun run scripts/verification/resident-assistant-history-repair-workflow.ts --output-dir=.cache/verification/memory-repair-history-red-20261107` | 真实 Host/RPC 复现 UNIQUE 冲突；已知原文读取先于索引查询成功 |
| 身份与大响应失败 | `resident-assistant-memory-repair-workflow.ts`，`memory-repair-system-red2-20261107` | 新建双 ID、旧身份暂停、旧记忆不可见和约 21 MB 主助手整包响应共 9 个失败场景 |
| 设置入口漏点 | 同工作流，`memory-repair-mode-red-20261107` | 修改执行模式同样返回约 21 MB，复现超限 |
| 来源回读漏点 | 同工作流，`memory-repair-source-red-20261107` | 单条约 18 MB 来源在 `assistantMemory:readSource` 复现超限 |
| 无项目目录漏点 | `memory-repair-cwd-red-20261107`，以及实际包组合验证 | 复现 none 被展开为不存在目录和子进程 ENOENT；补齐已有路径解析边界，保留失败证据 |
| 历史修复 | `memory-repair-history-green-20261107` | 7 个场景通过：v1/v2 升级、重复读取、重启、损坏来源隔离、原文和权威表保留 |
| 系统修复 | `memory-repair-source-green-20261107` | 13 个场景通过：真实登记、旧别名、伪造拒绝、全部策略选择、旧条目重评、来源分页、大会话代理/设置/重启/工作区隔离 |
| 真实库副本 | 一致性 SQLite backup、副本生产查询与校验报告 | 原基线 616 个 pending；78 个有界批次处理当前实际目录 617 个会话，最终 pending=0、unreadable=0、indexedMessages=79785。memories/revisions/suppression/history_extraction 校验值完全一致 |

真实库先在离线副本验证，随后经用户明确批准应用到本机。基线库目录表登记 616 个会话，读取源文件目录时发现 617 个，两个口径分别记录，没有冻结全部真实原文。副本与报告留在本机恢复目录，不将真实原文作为仓库测试夹具。

## 最终验收

| 验收 | 结果与证据 |
| --- | --- |
| 综合回归 | `.cache/verification/memory-repair-final-acceptance-20261107/`：25 工作流、413 场景通过；含新增历史修复 7 场景、系统修复 14 场景 |
| 真实打包客户端 | `.cache/verification/memory-repair-packaged-final-20261107/`：37 场景通过，页面错误为空；旧双 ID、20,933,443 字节展开消息、18,000,000 字符原文、执行模式变更、真实模型/Worker 管理、亮暗与窄窗口共同验证 |
| 构建和包结构 | 最终目录 `.cache/candidates/phaneris-0.6.2-memory-repair-final-2026-11-07/win-unpacked/`；9 项结构检查通过；909 项构建文件哈希一致，见 `.cache/implementation/resident-memory-repair-2026-11-07/build-package-final-hashes.json` |
| 类型、lint、发行门禁 | 全仓 typecheck:all、lint、identity、version、i18n parity/coverage/sorted、文档链接及 diff 检查通过。RPC 输入/结果清单已按实际分页契约更新 |
| 失败记录保留 | 初版打包组合夹具把合成巨型原文选为前台，修正为隐藏归档来源；其后真实复现 none 目录标记被展开导致 ENOENT，补齐路径边界后最终 37 场景通过。前三个阶段不算成功 |
| 现场应用与真实库 | 用户明确批准后，覆盖 6 个程序资源、新增 56 个文件，全部 62 项安装哈希一致；客户端已打开并显示 Work 原有会话。真实库 schema=3，617 个会话、79785 条消息，pending=0、unreadable=0。离线迁移前后 12 条记忆、12 条修订、2 条抽取断点及原文校验一致；10 条 active 记忆可检索 |
| 完整备份 | `.cache/implementation/resident-memory-repair-2026-11-07/backup-20261107-104527/`：6 个旧程序资源、3 个一致性 SQLite 快照及配置；安装不删除旧资产。现场工具首次遇到一个已不存在的历史目录时在数据库写入前停止，按生产读取口径跳过不存在的原文文件后完成 |
| 实际模型连接 | 启动后发现 8 次自动维护均被网关以 `reasoning_effort` 枚举错误拒绝。当前连接缓存将 `off` 映射为 `none`；仅将此模型的连接覆盖值改为 `off`，全配置对比确认其他字段不变。真实网关合成请求 HTTP 200，8 个总 token，无真实会话内容，证据 `live-off-verification.json` |
| 真实提炼与落库 | 通过已安装客户端的常驻助手，前台明确请求完成 8 次真实记忆工具调用，0 错误。真实历史片段回读并 acknowledge：processedMessages 从 2 到 3；`thinkingLevel=max` 原始规则与现有委派策略去重后，同一记忆 revision 从 1 到 2，补齐 collaboration/supported/durable 评估、保留原依据并新增精确原文来源，再由 inspect 回读确认。数据库独立核查仍为 12 条记忆、13 条修订、3 条断点；其余 11 条记忆及全部旧修订/断点不变，见 `live-memory-acceptance.json` |

新增两个工作流已纳入常驻助手 rollout，后续验收不得只跑全新数据库的小样本。完整诊断数据通过既有 Session 分块协议保留，没有另建诊断存储。旧详情组件未接入当前路由，本轮撤回其中额外界面改动；实际可达原文界面沿用既有分页。

现场证据在 `.cache/implementation/resident-memory-repair-2026-11-07/`。`live-workspace-repair.json` 是客户端启动前的迁移保全快照；`client-startup-check.json` 如实记录刚启动时仍然只有 2 条旧抽取断点及模型连接失败，不能据此宣称模型提炼已通过。用户随后明确要求直接测试，使用前台显式请求验证真实片段及已有规则，不清空后台额度审计、不更改历史失败记录。

最终的真实模型验收已验证读取、提炼判断、断点回写、去重修订、评估落库和回读。79783 条待提炼消息是当前抽取覆盖数据，不代表整库已经完成学习。后台默认日运行预算依旧存在；本次前台测试不受该队列预算阻塞。

## 数据迁移与回滚

- 启动时在原所有者和 writer lease 下升级可重建的历史 schema；按现有八会话预算增量重建，没有全库模型扫描。
- 旧注册身份通过规范目录核实后读取本地策略；不改写旧身份引用。只对尚未配置的学习策略补默认值，不覆盖显式选择。
- 原文、长期记忆、Project 文件和遗忘记录不作为修复对象删除。旧无评估记忆仍需有来源的逐条复核。
- 安装客户端替换及真实运行库的升级属于现场生效步骤，须先保留可恢复程序与数据库备份，并确认不会中断正在执行的用户任务。
