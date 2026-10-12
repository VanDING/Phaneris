# 架构与代码治理首轮实施台账

> 归档说明（2026-10-13）：本文是当时的实施／评估记录，已移入 `docs/archive/`，不再更新；正文与结论保留原样，其中的「当前」「下一步」等表述以文首日期为准。

后续裁定：[完整实施台账](../process/governance-completion-2026-10-11.md)。以下正文保留本轮当时的快照与未覆盖项；当前治理状态不再由其中的后续队列判断。

日期：2026-10-11；起始 HEAD：`8e5bf13b3f393dc776f6c17057eb5d0fb05f2dda`。
状态：**verified（本地）**。范围为 [总计划](../process/architecture-code-governance-implementation-plan-2026-10-11.md) 的 G0、G1、G2a，另关闭完整回归发现的 Runtime 分支/删除资源释放遗漏，沿用 [失败矩阵](../verification/governance-first-wave-failure-matrix.md)。[本轮验收证据](../verification/results/governance-first-wave-2026-10-11/README.md)独立归档；原始扫描和历史验收结果保持原样。实现仍在工作树中，未提交或推送；每次 manifest 保存开始时 HEAD、dirty 路径和修改文件哈希。

## 1. 唯一执行队列

这里的 owner 是维护职责，不是假定已经分配给某个人。开工/关闭时记录实现文件、验证命令和限制，后续工作先更新本表，再更新历史记录的裁定说明。

| 项 | owner | 前置 | 当前状态 | 完成证据 / 回滚 |
| --- | --- | --- | --- | --- |
| G0 文档与历史裁定 | 文档/架构维护 | 10-11 扫描 | verified（本地） | GOV-14：现行入口校准、历史裁定；仅撤销本轮文档修改 |
| G1a 运行目录、manifest、scene registry | 验证工具维护 | V01–V07、V10、V13 | verified（本地） | GOV-02：顺序/并行及损坏 canary；四条 Runtime 工作流复跑不回写历史；撤销接线，保留证据 |
| G1b CI、覆盖、lint ratchet | CI/各包维护 | V08–V09、V11 | verified（本地）；远端待验收 | GOV-03/GOV-11：13 成员、4 tooling project、120 warning 精确基线；仅回退本轮配置与入口 |
| G2a 插件提交与清理 | shared/plugins + sources/credentials 维护 | P01–P10、12 个独立进程场景 | verified（本地） | GOV-01：临时工作区真实文件/凭据读写；回退代码，不回写用户工作区 |
| G6-R1 Runtime 迁移回归修复 | server-core/sessions 维护 | V12 先失败复现 | verified（本地） | 四个分支 E2E、父会话哈希、Host driver 与两类 pool 清理；没有提前拆分 SessionManager |
| G2b 认证持久化/Origin | server-core/webui 维护 | 认证作用域 ADR、失败矩阵 | verified（本地）；远程/浏览器限度保留 | [第二轮台账](./governance-second-wave-2026-10-11.md)；回退须读兼容撤销库或停服轮换 secret |
| G2c 异常归属 | server/Electron/Pi 启动维护 | 逐个 failure owner | verified（本地）；原生 Electron/平台待验收 | [第二轮台账](./governance-second-wave-2026-10-11.md)；停止接入与执行 admission，保留 recovery evidence |
| G3–G8 内部职责与分发 | 相应模块维护 | 首轮门禁、各阶段 ADR/失败矩阵 | proposed | 按总计划顺序逐包推进；G6-R1 不等于 G6 完成 |

## 2. 历史来源逐项裁定

裁定基线为起始 HEAD；“已实现”仅指已核对源码与本地验证，平台/服务端部署不由此推断。每个文档开头增加本次裁定指针，原始日期、旧数字和研究正文继续保留。

| 来源 | 裁定 | 当前事实、位置及后续队列 |
| --- | --- | --- |
| [Durable Runtime ADR](../architecture/durable-agent-runtime.md) 与 [boundary](../architecture/durable-runtime-boundary.md) | 接受且已实现 | Kernel/Host B0–B5；ADR 的持久化保证不变，删除“边界未实现”矛盾；G6 只治理产品装配 |
| [Runtime target](../architecture/durable-agent-runtime-target-architecture.md) | deferred，保留启动条件 | 分布式/多 workspace/execution admission 的目标设计尚未激活；本轮不把它当作正在实施的 Runtime 规范 |
| [10-10 系统清理](./system-cleanup-optimization-plan-2026-10-10.md) | 已实施批次保留，结构切口转入本队列 | A/B/C/D/E/F/H 已实施；G 的配置/Pi 切口纳入 G3/G5，旧建议不再形成另一条执行队列 |
| [架构总览](../architecture/overview.md) | 当前维护入口，已校准 | 清单 27 workspace 边；WebUI 有 AST 依赖门禁、仍缺显式平台 port；core 仅类型/工具；G3/G4/G7 |
| [B 阶段身份](../architecture/phaneris-phase-b-brand-identity.md)、[fork plan](../process/phaneris-fork-plan.md)、[release gate](../release-readiness.md) | 代码身份已实现；外部发布仍未验收 | identity 中 appId 已独立、services 全 null、telemetry false；自有域名、签名、命名空间归属仍未核实；G8 |
| [四工作流排序](./workstream-sequencing-2026-10-06.md) | 旧执行顺序被本队列接替 | 首轮工具竞态、Runtime 边界、部分 decide 调整已有实现；九服务拆分不再执行；本轮不扩展 decide/Guarded 功能 |
| [8-31 路线图](./project-assessment-and-roadmap-2026-08-31.md) | 历史评估，拆为已实现与残余 | 独立身份、全 workspace typecheck、关键路径验证已有实现；发布链、可重复证据、深层模块归属仍需治理；G1/G8 |
| [深度分析](./Phaneris_Project_Deep_Analysis.md) | 历史分析，问题需按新基线重验 | Runtime 旧拆分已接替；限流/请求体/可信代理已修；JWT 重启失效、Origin、Pi/Session/client 装配仍开放；G2b/G5/G6/G7 |
| [Plugin review](../process/plugin-system-review-and-roadmap.md) F01 | 原主修复保留，本轮事务残余 verified | 只从完整备份恢复；提交后的备份/凭据清理失败仅报告 warning；索引写入和失效都失败时，读取仍从已安装 package 派生；12 场景已通过 |
| Plugin review F02、F03 | 已有保护，保留回归 | `plugins/paths.ts` slug 限界；`analyzePluginUninstall` shared-provider 执行路径保护；本轮不解除 |
| Plugin review F04、F06、F07、F10 | 尚未关闭 | 双执行路径、确认绑定、校验/可用状态属后续插件治理；G2a 只修已配置 API 替换合法 baseUrl 被清空这一具体 F07 缺陷 |
| Plugin review F05、F09 | 待针对性复核 | 路径与 watcher 已有后续修改，不凭旧标题断言全修/全未修；需原场景 E2E |
| Plugin review F08 | 延后功能 | 对话式导入/市场不属治理范围 |
| [10-06 依赖关系](../dependencies/dependency-graph-2026-10-06.md) | 历史图已过期，保留来源 | 新清单 27 边；26 undeclared subpath 已有门禁；dead declaration 已删，peer/根借用/lock orphan 另议；G3/G4/G8 |
| [8-01 审计](../archive/code-audit-2026-08-01.md) | 历史证据 | OPEN 不等于当前缺陷；来源、兼容 wire、上游责任需重验，不能拿历史漏洞数字作本轮结论 |
| [性能实施](./performance-implementation-2026-09-10.md) | 首轮已实现，历史测量保留 | 本地 validate:ci 与 bundle gate 通过；main 当前硬预算 21,500,000 B，10-11 扫描仅余 58,509 B；G5–G8 必须复测，不沿用旧红灯/旧理想预算 |
| [GPUIX 研究](../research/native-frontend-migration-gpuix-assessment.md) | 研究保留，迁移延后 | Playground 打包入口已清理；本轮不迁移前端栈； profiling 和边界治理先行 |
| [Memory 设计](../research/memory-system-design.md) 等功能设计及研究附件 | 领域参考，功能设想延后 | 仅用于核对现有契约；不由此启动新功能、插件市场、memory 或前端迁移 |
| shared/CLAUDE、core/server-core README、CONTRIBUTING | 现行维护约定，已校准 | Guarded 属既有权限模式；单 Pi 路径；server-core 拥有 SessionManager/领域 handlers；SSH443、origin/main、codex 分支、测试先行 |

## 3. 实施与验证记录

### 3.1 验证底座与 CI

`verification-artifacts.ts` 为 Runtime gate/boundary/crash/Pi、critical、build smoke 和新 E2E 提供独占运行目录、成功/失败 manifest、环境/源状态/lock 身份和 SHA-256。默认写 `.cache/verification/`；显式目录已存在即拒绝。`critical-scenarios.ts` 集中登记入口、最低场景数和必需产物；入口缺失、零成功、文件缺失或哈希变化均失败，包测试保持独立进程隔离。

CI 的 full-validation 与 validate 共用 uv `0.12.22`；validate、Windows、full 三个 job 的 artifact 上传固定 commit 且使用 `always()`。PR 已接入生产构建/服务打包入口检查，push/main 与手动执行保留 full-validation。远端 job 尚未运行。`check:governance` 检查这些接线以及 13 个成员和 4 个 tooling project；覆盖清单明确保留 CLI 启动、WhatsApp 独立 build、WebUI/Viewer 用户流程、Python lint 等缺口。

lint 从三个成员扩展到全部 workspace 源码及根维护/构建脚本；共用正确性规则，Electron/UI 原有平台/React 规则保留。现有 120 条 warning（95 Hooks、17 localStorage、8 未用 suppression）按文件/规则/消息/数量登记：新增不能抵销，减少须删除旧额度。三个过时实验脚本以理由和 SHA 冻结，改动前须恢复类型覆盖；performance server 使用独立 tsconfig。其余历史脚本只校准当前接口与类型，未声称重跑真实 provider 或原生 UI。

依赖扫描已校准 Babel 8 `TSImportType.source`，类型形式的依赖也受门禁约束；当前 WebUI 闭包为 1,015，仍保留已登记的 3 条 Node 例外。IPC inventory 恢复为显式手动更新、CI 只检查的入口，当前 425 条 wire 字符串；本轮仅补录两个已经存在的 decisions channel。

### 3.2 插件事务与凭据

复制备份前登记恢复状态，完整复制后才允许替换；失败逐项恢复，缺失备份时保留当前可读副本并报告恢复不完整。安装提交后，备份清理、凭据清理、索引/audit 写失败返回可观察 warning，不重新进入安装回滚。source API 凭据清理延迟至资源/package 全部提交；加密 store 原子写失败时恢复内存缓存，保证可重试。已配置 API 的合法 baseUrl 保留，派生索引每次从 package 读取。

12 场景使用真实临时工作区、复制/重命名和加密存储，文件系统边界注入故障，并由新进程复读持久化状态。保留 source guide、ID、可变 data、slug 约束与 shared-provider 卸载保护。**新 API/local 扩展源空默认值仍会被配置校验拒绝**，属于 F07 剩余工作；本轮只修已配置 API 的替换路径。

### 3.3 完整回归发现的迁移遗漏

首先独立复现起始源码的旧 IPC 快照、旧 `managed.agent` mock/源码断言及可选提示预期，校准已有夹具，没有新增单元案例。临时工作区 E2E 随后复现真实缺陷：分支在产品注册前进行 SDK preflight，却仍使用 disconnected Runtime 视图；失败回滚走旧 agent 状态；正常删除也未断开产品 MCP pool。

新建会话在 preflight 前绑定 Host 的只读视图；Domain 接收 `disposeRuntime` port；失败与正常删除先由 Host 释放整个 session，再在 `finally` 关闭产品 pool server/MCP pool。复用的产品清理入口与 agent 重建时的 driver 清理分开，避免释放 session 后再次创建 Host 空槽位。四个 E2E 场景覆盖父 SDK context 缺失、失败回滚、成功创建、成功删除，验证磁盘 child、父会话哈希、Host generation 及资源生命周期；报告记录 pool 清理状态。provider/pool 端点为受控 port；实际 SessionManager、Host 与存储没有替换。

### 3.4 本地验收

完整记录和 manifest 校验方法见[验收说明](../verification/results/governance-first-wave-2026-10-11/README.md)。各运行的源哈希按开始时快照保存；后续文档登记不会回写已完成运行。

| 检查 | 结果与口径 |
| --- | --- |
| `bun run validate:full` | 退出 0；全成员/工具 typecheck、lint、i18n、身份/版本/运行时均通过；workspace 6,285 通过、既有 14 skip，CI 子集另执行 87 次；文档工具 24 通过；完整日志已归档 |
| `bun run test:critical` | 5 条 E2E/门禁工作流 + 6 包组；228 个既有 Bun 测试；Runtime gate 检出 25 条禁止依赖，boundary 15、crash 8、plugin 12、branch 4 个场景 |
| `verification-output-workflow.ts` | V01–V07 全通过：默认复跑 tracked 内容不变、并发不串写、占用/零场景/损坏/缺文件/未知参数均拒绝 |
| `governance-gates-workflow.ts` | 缺 uv、失败时不上传、漏成员、新 warning 额度缺失四个配置变异均被拒绝 |
| `durable-runtime-pi-workflow.ts` | 真 Pi 子进程、SQLite、loopback inference；六项既有断言通过，Host close 等待 child 退出 |
| `bun run build:smoke` | main/preload/renderer/WebUI/viewer 五类生产 bundle + 组装后 server entry import/token-format 检查；缓存 runtime，未测试首次下载 |
| `bun run bundle:report --check` | 未抬高预算；main 21,442,474 B，距离 21,500,000 B 仅 57,526 B；renderer 初始图仍 71 chunks |
| docs / `git diff --check` / SHA-256 | 文档连通性、补丁空白及归档完整性单独验证 |

## 4. 尚未验证的环境

本轮工作区为 macOS x64。本地检查不代表 Windows/Linux 原生执行、GitHub Actions 远端 job、签名安装、公开发布、真实 provider、插件进程崩溃恢复或并发同名安装已通过。

下一阶段为 G2b/G2c：先写认证持久化/Origin 作用域 ADR 与生命周期失败矩阵，随后进入 G3 配置职责与循环分类。G3–G8 的结构拆分、RPC 参数契约、包归属和分发检查仍未启动；严格 identity 的历史残留也没有以放宽 gate 的方式关闭。
