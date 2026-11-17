# 常驻助手工作连续性：先行失败矩阵

状态：先行失败矩阵，保留实施前约束，2026-11-17。基线提交 `0b5e66eded84a483f4970de82753c9233635dbe0`；实际实现和验收结果见[实施与验证记录](resident-work-continuity-implementation-2026-11-17.md)。

主方案：`analysis/resident-assistant-work-continuity-redesign-2026-11-17.md`。默认单任务实现；生产数据不写入，不重新触发真实推送。

| ID | 失败方式与注入 | 必须满足的边界 |
| --- | --- | --- |
| WC01 | 新 inputId、普通聊天、A→B→A | HEAD 保留；普通交流不建分支；重复选择与命令重试分开 |
| WC02 | 持续工作上新增一次性招呼语 | 原话引用进入模型及 Worker；scope=input 不改变长期要求 |
| WC03 | 只 select，没有工作准备；伪造 producer | 业务 T1 被拒绝；安全读取与停止仍可用 |
| WC04 | 同批次 prepare 后 delegate；准备更新前的 producer | 新 pointer 不能替旧调用补资格；新推理只执行一次 |
| WC05 | T1 存在、T2 缺失的旧本地命令 | 查询及核对能收敛；不无限重复；外部未知效果不旁路 |
| WC06 | 要求已记录，材料组装前崩溃 / 原文不可用 | 已记录要求保留；恢复不重复应用；禁止旧准备执行 |
| WC07 | ready 已发布，Runtime T2 缺失 / 重复 | 原命令结果可查且不伪造；Runtime 回执幂等补交 |
| WC08 | 新用户输入在准入前到达并撤销 | 原前台调用不获准入；迟到准备不能重新开放执行 |
| WC09 | 停止在效果已经开始后到达 | 保留发生 / 未知事实，不把取消当未执行证明 |
| WC10 | 过期 prepare、旧 run、乱序 / 迟到 ACK | 过期请求无新执行资格；已知结果仍能补交 |
| WC11 | 真实模型判断持续工作 / 单日工作、指代及混合输入 | 使用原目标范围；记录真实决策，不用 scripted 正确参数代替 |
| WC12 | 相关撤权、无关分支变化、旧缓存 | 相关材料失效，无关工作继续；诊断不注入撤权正文 |
| WC13 | 旧 schema / pointer / ContextView | 保留原始引用及 HEAD；旧视图不自动变 ready；普通 Session 保持线性 |
| WC14 | 多分支同输入，后台事件与前台交错 | 按片段及原实例归属；后台不改写前台指针 |
| WC15 | 13 个来源 Session、反复重写、宽共享依赖 | 读取按工作集复用；候选先排序；冷 / 热与阶段耗时分别记录 |
| WC16 | 项目维护目标不可写、模型目录变更、文件锁未知 | 不把不可写当无候选；能力发现复用现有入口；未知锁不盲释 |

先运行 `resident-work-continuity-workflow.ts`，预期旧 schema 拒绝 prepare，保存真实 before 结果。随后逐项贯通 SessionContext、Host 模型 / 工具边界、Runtime SQLite 与隔离副作用，产物包括版本、实际视图、事件时间线和效果计数。真实模型及安装 / 生产迁移分别声明验证范围，不能以结构测试替代。

实现前冻结的入口：`assistant_context prepare`（target=keep/select/create；有来源的 requirements，scope=input/work）、`preparation`（按 requestId 查进度）、`recover`（预期 generation 下恢复）；原工具继续保留。执行准备归 ContextView / context_commands；执行事实归 Runtime。
