# 0.6.2 助手权限与 Worker 管理实施记录

状态：implemented / validated — 2026-11-07 已完成[0.6.2 计划](../architecture/resident-assistant-0.6.2-plan-2026-11-06.md) V0–V5 的源码、隔离综合验收及 Windows 未安装候选验收。23 个工作流 / 392 组场景、打包客户端 33 组场景均通过；真实主助手模型样本 3 组通过。未提交、推送、发布或替换安装版，未操作真实 Work 数据。

实际实施基线：`ecba907a8d9d2c38a05687d07c93c5a77226ed5e`，分支 `codex/resident-assistant-0.6`，包版本 0.6.1，开始时工作树干净。规划时的 0.6.0 基线保留为历史，不覆盖新近的启动延后加载与取消自动备份改动。基线记录位于本机 `.cache/implementation/resident-0.6.2-2026-11-06/manifest.json`。

| 阶段 | 当前状态 | 出口 |
| --- | --- | --- |
| V0 先行失败与事实归属 | 完成 | 原 history 拒绝、缺少控制入口、失效补充材料、后续效果越过暂停及无效配置停机均先复现，再修正；失败产物保留 |
| V1 权限与能力同源 | 完成 | 共享工具契约、Host 能力快照、独立 Worker 执行上限及保守旧设置恢复；精确只读 POST 操作不扩大为通用写入 |
| V2 L0 原文读取 | 完成 | 模型与桌面共用原文所有者；分页、工具/错误、变更冲突、遗忘及 Source 撤权共用边界；L0 工作流 15 组通过 |
| V3 Worker 全过程管理 | 完成 | 管理工作流 23 组通过；暂停/恢复、补充、调参、安排/优先级、重试、取消、稳定命令与 CAS；移交后仍使用原回执；补充材料也记录可撤销来源 |
| V4 界面与共享指导 | 完成 | 任务控制、命令回执、最近原文、执行上限说明、七语言；亮暗、390px 窄窗、键盘和导航均通过实际桌面流程 |
| V5 综合与候选包验收 | 完成 | 固定源码的 23 工作流 / 392 场景、真实主助手 3 个样本、实际打包客户端 33 场景、9 项结构检查及构建哈希核对通过 |

本轮不通过修改真实 Work 数据来代替验证。先使用隔离配置和可重复 Host/Pi/RPC 流程，保留失败产物和实际模型请求；付费模型、打包客户端及未覆盖平台只在实际运行后记为通过。

## 阶段证据

- `.cache/verification/resident-062-l0-red3/`：实际模型调用公开 `get_session_info(history)`，复现原角色固定拒绝；不是只测试文字提示。
- `.cache/verification/resident-062-l0-pass3/`：13 组场景通过，包含未提炼/归档/隐藏普通会话、工具结果/错误/内部来源、关闭自动记忆使用时的显式查询、稳定快照分页及编辑冲突、冷却后原文可读和遗忘后的共同抑制。
- `.cache/verification/resident-062-control-red1/`：真实已启动 Worker 的控制入口缺失得到复现。
- `.cache/verification/resident-062-control-pass4/`：8 组场景通过，真实 Runtime 暂停、Host 重启仍暂停、稳定命令 ID/CAS、暂停时调参/补充、原 Session 与原输入归属的恢复，以及禁止重跑已完成结果。新尝试实际向 `fixture-b` 发出模型请求。
- server-core、shared 类型检查及脚本类型检查阶段通过；新增桌面状态仍需配套与完整验收。以上不等同于 V0–V5 全部完成。

- `.cache/verification/resident-062-control-handoff-recovery-pass1/`：20 组控制场景通过，扩展到未知外部写入等待、无关任务继续、真实队列优先级、人工续作保护、被遗忘材料重建、真实 Host 移交子会话及原回执/命令 ACK 恢复。
- `.cache/verification/resident-062-source-post-pass1/`：13 组 Source 流程通过，包含明确 Host 只读 POST 契约与普通 POST 写入拒绝；追加 L0 撤权回归纳入综合重跑。
- `.cache/verification/resident-062-ui-controls-pass1/`：真实桌面完成暂停、原文回查、补充要求、应用配置、恢复同任务，并完成既有面板与主题/导航回归。追加控制表单窄窗口与键盘截图纳入综合重跑。
- `.cache/verification/resident-062-live1/`：已配置官方 DeepSeek Flash 的 3 个实际模型样本通过。会话与任务资料来自隔离的合成工作区，常规系统/工具提示和工程运行元数据照常保留，不发送真实 Work 对话或工作文件。模型实际选择原文读取和 Worker 管理工具；Worker 推理由受控回路承载，不作为 Worker 模型输出质量结论。请求、失败/中断状态、token 用量及保守费用估算均保留；结束时的后台通知中断不隐去。
- 完整 `typecheck:all` 第一轮通过；`lint` 第三轮通过，445 个 RPC 通道和 68 个集中输入契约已同步；新增 37 个文案键的七语言文件及 i18n parity/coverage 通过。后续代码调整仍须最终重跑。
- 根包、13 个 workspace 包及锁文件共 27 处版本标识已同步为 0.6.2；发布说明只追加 `release-notes/next.md`，不生成或改写已发行版本说明。

## 综合验收修正记录

- 首轮 `.cache/verification/resident-062-rollout1/` 实际运行 23 个工作流，21 个通过，共 328 组场景；Source 与上下文 fixture 失败保留。前者撞上无关自动记忆维护切换工作集，已明确隔离为手动学习策略；后者把新增 Host 能力块误当成最后一个人类输入，已按输入归属修正。独立重跑 Source 14 组、上下文 48 组均通过。
- `.cache/verification/resident-062-control-preemption-pass2/`：21 组控制场景通过，包含遗忘后不再重放助手生成的历史补充要求，以及新直接用户输入及时拒绝旧待应用命令。
- `.cache/verification/resident-062-control-effect-boundary-red1/` 进一步复现：外部效果结算后仍能准入后续动作，实际写入次数从 1 变为 2。Host 现已在模型请求和工具调度的准入边界检查待应用控制命令，保留原 T2 效果，阻止后续新效果；`.cache/verification/resident-062-control-effect-boundary-pass1/` 的 21 组场景通过，写入保持 1 次。
- `.cache/verification/resident-062-live2/` 在 0.6.2 标识下再次完成 3 个真实主助手选择样本；14 次实际请求包含 4 次流中断/失败记录，未把中断计作单次请求成功。场景结论来自最终 Host 原文与管理回执，不把所有请求或模型泛化能力写为成功。
- 首个 Windows 未安装候选目录 `.cache/candidates/phaneris-0.6.2-2026-11-06/` 已构建并通过 9 项包结构检查；后续准入栅栏变更仍需重新构建候选并做实际客户端验证，此目录暂不作为最终源码对应产物。

- `.cache/verification/resident-062-control-last-boundaries-red1/` 复现无效模型配置先停止现有推理；现已改为停止前完成配置预检。另以真实 Host 效果结算和受控 ACK 延迟验证“效果先结算、等待回执后保存”的竞态；结算会补送同一命令，不留下无人推进的等待状态。配置应用后段失败保留实际已停止事实；安排变更不覆盖 Runtime 已完成状态。
- `.cache/verification/resident-062-control-last-boundaries-pass2/`：新增边界后 23 组管理场景通过。以下最终综合结果已包含这些场景，不叠加重复计数。

## 最终验收与产物

| 验收 | 实际证据与结论 |
| --- | --- |
| 综合回归 | `.cache/verification/resident-062-acceptance/`，实际重建 Pi、main、preload、renderer、assets 后执行 23 工作流，共 392 组场景通过；所有子 manifest 和产物哈希再次校验 |
| 真正打包的客户端 | `.cache/verification/resident-062-packaged-ui-validated/`，运行 `app.isPackaged=true`、`app.getVersion()=0.6.2`；33 组场景通过，页面错误为空；包括原文回查、暂停/补充/调参/恢复、亮暗、窄窗、键盘、分页和导航 |
| Windows 包结构 | `.cache/verification/resident-062-package-structure-validated.json`，9 项检查通过；是 unsigned x64 未安装目录，未验证安装器或签名分发 |
| 构建对应关系 | `.cache/implementation/resident-0.6.2-2026-11-06/acceptance-summary.json`，main、preload、拦截器、Pi 子进程和 renderer 共 778 个打包文件与本次构建逐项哈希相同 |
| 真实模型 | `.cache/verification/resident-062-live2/`，3 个真实主助手样本通过；原始请求、角色/工具快照、传输中断及最终 Host 回执保留；不能据此声称所有请求、模型或 Worker 产出均稳定 |
| 类型与 lint | `.cache/verification/resident-062-types-acceptance.log`、`resident-062-lint-acceptance.log`，全仓检查通过；445 个 RPC 通道、68 个集中输入契约及现有边界/循环/发行门禁通过 |
| 其他门禁 | identity、version、i18n parity/coverage/sorted、文档通过；七语言各 3024 键，本期新增 38 键；Electron build validation 的 13 项产物通过，`git diff --check` 通过 |
| 最终源码快照 | `.cache/implementation/resident-0.6.2-2026-11-06/final-source/` 与上述 `acceptance-summary.json`；实施前基线另存，不重置原工作 |

最终候选程序：`.cache/candidates/phaneris-0.6.2-validated-2026-11-07/win-unpacked/Phaneris.exe`。前两个候选目录保留为阶段证据，不作为最终源码对应产物。没有运行覆盖安装、现场数据迁移、Git 提交/推送或发布。

### 计划验收范围与证据归属

| 计划范围 | 主要证据与边界 |
| --- | --- |
| P01–P08：读取、业务执行及资源授权 | native / private-state / source-access / control / delegation；主助手直接查读授权普通文件和本 workspace L0，Worker 执行上限单独保存；主助手无 shell/业务写入工具。Source 已授权不等于授予通用写权限 |
| C01–C08：功能身份与能力声明 | l0 / control / source-access / identity / context，另有真实模型请求快照；角色工具集合、实际 schema 与 Host 门禁同源。历史、记忆及远端注解均不授予权限；可用性仍随当前认证、资源和状态变化 |
| H01–H10：L0 与记忆底座 | l0 的 15 组及 source-access 的撤权原文场景；未提炼、归档、隐藏会话、工具/错误、内部来源、稳定追加/编辑冲突、长文范围、冷却与遗忘均纳入。附件返回引用，不冒充文件已解析；Worker 不能读取主助手私有历史 |
| W01–W13：管理及事实所有权 | control 的 23 组、delegation 的 64 组及 results 的 7 组；覆盖实际暂停、同 Session 续作、未知效果准入栅栏、无关任务、队列优先级、配置预检、命令指纹/CAS、用户抢先、移交、重启与 ACK 时序。Tasks 仍由原调度所有者管理，不通过普通 Worker 控制夺取其 Session |
| R01–R05：综合、桌面、模型与兼容 | 392 组综合场景、33 组实际打包客户端场景、3 个真实主助手样本及版本/包/哈希门禁分别记录。旧字段缺失保守继承原上限；未验证真实 Work 现场升级、其他操作系统、全模型组合或签名安装分发 |

权限、原文、记忆、命令、执行和交付继续使用既有所有者：Session 保存原始输入及配置，memory 只参与来源有效性/抑制，`delegations.db` 保存命令意图与回执，Runtime 保存实际尝试和效果。没有引入第二套可手改的运行状态、复制 L0、团队功能或额外常驻监督模型。
