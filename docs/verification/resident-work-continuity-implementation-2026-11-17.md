# 常驻助手工作连续性：实施与验证

状态：源码实现及本机隔离验收完成，2026-11-17；正式安装、生产修复与发布未执行。源码分支 `codex/resident-work-continuity`；基线提交 `0b5e66eded84a483f4970de82753c9233635dbe0`。

主设计为 [工作连续性重设计](../../analysis/resident-assistant-work-continuity-redesign-2026-11-17.md)，先行约束见 [失败矩阵](resident-work-continuity-failure-matrix-2026-11-17.md)。本文记录实现和实际证据，不另立总体方案。

## 已实现的闭环

- 保留 HEAD 导航；新输入不自动继承执行资格。组合 prepare 按原话、工作与 input/work 作用域记录要求，分别提交 recorded 与 ready。工作分支单独保留原目标引用用于导航；work 修改必须引用原文内支持工作范围的 workScopeQuote，本次覆盖保留 input。
- Pi 实际 provider 请求携带准备世代和材料指纹；模型响应、工具批次、Runtime T1、Worker 材料通过不可变 producer 关联。单独 select、旧推理同批次 prepare/delegate、过期材料和伪造 producer 均不能借最新 pointer 取得资格。
- 本地命令回执与命令事务共同提交，支持进度查询、恢复和 Runtime reconciliation；缺少回执保留未知，不重放外部效果。重复确定性准入失败有三次上限，下一用户输入恢复工具。停止发生在 reconciliation 等待期间也不能开启新 T1，已知旧结果仍允许补记。
- 多工作片段精确归属；后台视图不改前台 HEAD，续接从 Host 验证的原执行继承本次要求。Worker 控制同样检查 producer 和目标工作，保留作用域及实际效果事实。
- 索引按字节预算复用；冷索引在 Worker 线程准备、核对文件世代后发布；失败按文件世代缓存。协作 profile 先排序再校验入选来源，读取依赖在本轮重组时保留。异步准备与同步读取成本分别记录。
- 维护支持 deferred，保留目标不可写的原因和待处理覆盖；普通维护优先直接用户来源与最终回复，机械工具轨迹仍可检索。
- context schema 版本化升级，旧 HEAD/视图保留，旧无证明视图不变成 ready；更高版本 schema 拒绝写入。

## 验证记录

| 验证 | 结果 | 本机产物 |
| --- | --- | --- |
| 专项闭环、故障恢复、作用域、后台续接、性能、维护、迁移、Runtime/Pi | 9 个工作流，子流程合计 63 个场景通过 | `.cache/verification/resident-work-continuity-acceptance-Dy5IVc/` |
| 完整常驻助手回归，含记忆、来源、任务、控制与原生 UI | 25 个工作流，子流程合计 390 个场景通过 | `.cache/verification/resident-assistant-rollout-eszCoD/` |
| 仓库完整门禁 | `bun run validate:ci` 退出码 0 | `.cache/continuity-ci-verified.log` |
| 真实模型语义及实际 Worker | 5 项检查通过；登记有工作级证据，本次三条要求均为 input，任务账本无额外派发 | `.cache/verification/resident-work-continuity-live-Na54oO/` |
| Windows 未签名目录候选包 | 结构 9/9，隔离启动 5/5 | `.cache/verification/resident-work-continuity-win-verified/` |
| 真实 context 一致性副本 | 25 个 Session 元数据打开成功；6 类原权威表行及摘要保持不变；未提升旧 ready | `.cache/verification/resident-work-continuity-production-copy-DlZhwE/` |

表中为各组实际计数，组间存在重复回归，不能相加当作唯一案例数。早期失败产物保留，包括契约缺失基线、索引抖动、作用域误判、队列等待/当前视图计数的 fixture 错误，以及构建与打包重叠造成的 renderer 缺失候选；这些不作为通过证据。

专项验收 manifest SHA-256：`53e5a2740d46e037f2c9d183c804b52b0584f3948a84a9f4071fb5ab38fffcf0`。完整常驻助手回归 manifest SHA-256：`cd92e434b14bdd2b85a0f851f7fb23f326c0f7dda1d07decdc256362ee2f6f4d`。

最终真实模型 manifest SHA-256：`e554bc309fde6972e6f741c44f80bd5d8abafe4f3ed21a87a8321597fc90a7cd`。封存后重新核对专项 215、完整回归 1,050、真实模型 105、生产副本 4 个产物的长度及 SHA-256，全部一致。

交付总清单为 `.cache/verification/resident-work-continuity-delivery-2026-11-17/delivery-evidence.json`，包含 48 个改动源码/验证文件的最终哈希、各组产物摘要、CI 日志摘要、候选包与当前构建的一致性检查。总清单 SHA-256：`9367a40706ce4cad30ed46d584b7fd2a40b641ca2b0858eb6557dba4cfc9ea7b`。最后的验证代理收口修改通过独立 `typecheck:scripts`；文档收口通过 `check:docs`。

候选包主进程 SHA-256：`e727a3051382590057977ff9991abaf9494f77907e0b8538880fade573c39c6a`；Pi bundle SHA-256：`244c62a7425a79132eab8d07cd20a54853838078d3195fba073cb6f70139a1b6`。两者均与当前构建目录逐字节相同。候选包使用独立输出目录；现有 `docs/verification/results/packaged-client-*-win.json` 改动保留，未用本轮结果覆盖。

性能对照为可重复的合成工作集：13 个来源 Session 的第二次读取，修改前仍扫描 3,930,449 字节，修改后为 0；冷态扫描仍计入成本并由 Worker 线程完成，事件循环能继续运行。协作 profile 的 24 个有效候选中只验证入选的 8 个。16 MiB 为进程内共享定位索引的估算字节预算，不是实际堆内存测量，也不据此宣称生产延迟降低了某个比例。

真实模型 `deepseek/deepseek-v4.1-flash` 经隔离代理验证：持续工作登记、同分支新实例、本次招呼语到 Worker、停止后诊断、独立单日交付的分支判断。早期失败包括组装层丢失准备证明、缺少原目标导航而误建分支、将单次招呼语写入 work，以及验收仅检查“存在 input”而遗漏错误持久化。已增加原目标引用、明确要求列表、工作级原话声明及逐条作用域断言。排队输入按实际完成等待；未读来源测试改用真正未展开的外部来源。样本通过不代表自然语言理解获得机械保证；Host 校验引用、版本与 producer，语义仍由同一助手判断。

复验入口：

```powershell
bun run scripts/verification/resident-work-continuity-acceptance-workflow.ts
bun run scripts/verification/resident-assistant-rollout-workflow.ts
bun run scripts/verification/resident-work-continuity-live-workflow.ts
bun run validate:ci
```

真实模型入口使用已配置连接，并有单次请求、输入及输出预算；它会产生实际 provider 调用。流式响应在验证代理内读完并等待所有请求结算后封存证据，此入口验证语义和业务边界，不测流式首字延迟。

## 生产只读观察与上线边界

2026-11-17 22:58（Asia/Shanghai）的只读观察：现场 context schema 已为 2；25 个 pointer、2 个 branch、153 个 view，准备回执、业务 admission、ready preparation 均为 0。这说明旧视图不能用作新执行证明。该现场已不同于最初复盘，schema 变化的来源不能从本次只读快照判定。

Runtime 中 outcome 为空的操作为 236 条：109 条 safe_replay、127 条 never_auto_retry。这些是记录状态计数，不能等同于 236 项未完成业务。原 `toolop_37330ca9e29d637a2c2030e42998d118` 仍为 effect_pending、无 outcome；没有本地原子回执，不能自动补成功或判定未执行。

原会话当前 23,622,186 字节，SHA-256 `33b0c99298494430220abf03adb37807e9bb1da9ed9c6b74da103c3a6849a574`；与最初调查的 `d666782089e4a45d9f9cd54a7c5c75b24d8b725ec5d8019c3010c7292eccadd9` 不同。备份采用 SQLite 一致性 backup，仅将 context 副本写到隔离目录；不宣称多个库具有跨库原子快照。

本轮交付不重发真实推送、不把未知改成成功、不恢复已取消任务。安装、生产状态修订或发布需先审阅具体变更与回退摘要；隔离通过不等于安装版已经部署。

受控上线时的具体操作范围为：先停止真实 writer，分别对 context、Runtime、委派及记忆库做一致性备份并核对清单；使用已验候选，先验证新输入的诊断/准备闭环；原未知操作保持原状态，按实际效果证据逐项核对。用户已自行完成的推送不重跑，已取消委派不复活。回退需要停写及数据库版本相容性核对，不能只替换二进制。上述生产操作尚未执行。

## 交付范围

B0 基线、B1 准备到执行闭环、B2 多工作与续接/控制恢复、B3 本轮性能与维护改动已经实现。B4 已完成隔离迁移/真实副本检查及 Windows 候选验证；正式安装、生产修复、签名分发及 macOS/Linux 原生验收未执行。

源码位于 `codex/resident-work-continuity`，提交以 Git 记录为准；按用户要求不推送。保留用户原有改动；原始私人数据库副本仅在本机 `.cache/verification/`，不作为源码提交。
