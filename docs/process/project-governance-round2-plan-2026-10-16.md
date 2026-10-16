# 第二轮存量项目治理：审计与实施计划

Status: implemented — 2026-10-16 用户确认整体计划后，R2-01–R2-04 与 B0–B5 本机验证完成；两项条件调查未形成可归因的代码优化，保留问题边界。

日期：2026-10-16。源码基线：`main` / `02ecdea220195d0af4a1f2882fee7f20286b6260` / Phaneris 0.3.2。承接[上一轮结果](../verification/project-governance-implementation-2026-10-16.md)，本轮重新执行的检查不沿用上一轮通过状态。第 1–4 节保留修复前审计及原计划，实际修改、最终状态和未解决问题见[本轮实施报告](../verification/project-governance-round2-implementation-2026-10-16.md)。

## 1. 范围与项目现状

项目仍为 13 个 TypeScript/Bun 工作区：Electron、复用 React/Jotai 渲染器的 WebUI、Viewer、CLI；WS/RPC 进入 SessionManager，Runtime Host/SQLite WAL 保存执行事实，Pi 子进程执行，JSONL 保存兼容快照，MCP 与消息网关提供外围连接。

本轮以真实故障与运行效率为目标，重点检查异步状态归属、连接初始化/退出、首屏请求与现有验证可靠性。静态阅读覆盖会话持久化、Runtime 查询/恢复、配置读取、定时/重试队列、RPC、MCP、页面存储与前端列表加载；既有全量测试覆盖其他工作区。没有声称逐行审查全仓或验证真实外部服务。

审计开始时跟踪文件干净，七个未跟踪图标演示/素材目录保留。审计过程中另外观察到 `packaged-client-smoke-win.json` 和 `packaged-client-verification-win.json` 被更新，非本轮命令的输出，不纳入本轮修改、证据或回退范围。所有故障探针使用缓存目录、合成工作区、本地服务器和自建子进程。

治理边界：不新增业务功能、依赖、权限门禁或治理平台，不修改正确的 API/文件格式/业务规则，不做整仓格式化、架构重写或无收益的警告清零。不操作生产数据、发布、推送或不可逆迁移。

## 2. 当前基线

机器：Windows x64 / Intel i5-1340P / Bun 1.4.2 / Node 24.15.0 / Edge 155.0.4283.60。机器可读结论与本机证据索引见 [baseline.json](../verification/results/project-governance-round2-audit-2026-10-16/baseline.json) 和 [evidence-manifest.json](../verification/results/project-governance-round2-audit-2026-10-16/evidence-manifest.json)。

| 检查 | 本轮实际结果 | 判定 |
| --- | --- | --- |
| `bun run test` | 6,299 pass / 3 fail / 7 skip，383.28 s，退出 1 | Pages 编译 30 s 超时；Pi bundle 清理 EBUSY；HTTP FF10 超过 5 s。汇总按各进程结果相加，没有重复计算失败名称 |
| Pages 编译单文件重跑 | 2 pass / 1 fail / 1 error，36.19 s | 同一编译用例仍在 30 s 截止；附带 error 是超时后断言错误，不另计产品 Bug |
| Pi bundle 单文件重跑 | 1 pass / 0 fail，33.27 s | 原 EBUSY 不稳定复现，但终止信号后立即清理目录的竞态有源码和首次失败证据 |
| HTTP 单文件重跑 | 15 pass / 0 fail，29.54 s | FF10 本次通过，不能据一次超时认定认证功能有 Bug |
| `typecheck:all` | 通过，71.44 s | 全工作区及脚本类型检查 |
| `lint` | 通过，315.50 s | 2,306 文件、72 条既有登记警告；现有架构、主题、循环依赖、RPC 与分发输入检查通过 |
| `check:docs`、`git diff --check` | 通过 | 155 份文档、1,195 个相对链接；计划及证据索引可访问 |
| `build:smoke` | 整体退出 1，191.31 s | Electron main/preload/renderer、WebUI、Viewer 五项通过；server 分发仍明确拒绝 win32，属于既有限制 |
| 新故障探针 | 页面并发、真实 MCP 子进程、生产 React hooks 竞态均已复现 | 探针正常结束只表示完成观测，不代表产品场景通过 |
| 首屏诊断 | 同一浏览器三次采样完成 | 启用 CPU profiler，属于诊断，不是完整性能预算通过或优化前后对比 |

全量测试与类型检查开始时并行运行，后续还执行了短时审计探针；这些耗时不作为性能对比。首屏三次诊断串行执行，期间没有本轮其他构建/测试作业；其他桌面活动、系统缓存和 GC 不受控。

## 3. 已有证据的实施任务

这里的 P0/P1/P2/P4 沿用用户的治理类别；实际实施顺序由故障后果、依赖及回归风险决定。下列四项均为待实施，不把分析记为修复。

| 任务与优先级 | 模块 / 位置 | 问题与证据 | 根因 | 最小修改方案 | 预期收益 | 影响与风险 | 验证方式 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R2-01 / P0、P1、P2 | [MCP pool](../../packages/shared/src/mcp/mcp-pool.ts) `registerClient/connect/ensureConnected/disconnectAll`；[client](../../packages/shared/src/mcp/client.ts) `connect/listTools` | 两个并发请求启动两个真实 stdio 子进程，断开后一个仍存活；初始化过程中断开，晚到结果重新变为 connected。三次 HTTP 首次连接均发出两次 `tools/list` | 仅以已连接 Map 判断，没有登记进行中的连接；退出只关闭已登记对象；健康检查丢弃目录结果，注册时再次拉取 | 按来源合并相同配置的进行中连接；协调配置变更和退出，晚到/失败连接必须关闭且不能回填；初次健康检查与工具目录注册复用一次结果，后续显式刷新保持原语义 | 相同来源并发只保留一个客户端；断开后无自建子进程残留/复活；首次目录请求目标为 2→1，具体耗时改善未测量 | 中等。影响会话、Pages、HTTP/stdio/API pool；必须保留不同来源并发、原配置变更重连、失败传播及已有本地 MCP 开关 | 真实 HTTP+stdio：同配置并发、不同来源并发、配置交替、连接失败后重试、连接中断开、重复断开；核对 PID 退出、代理工具与目录请求数；回归上一轮 M01–M03 |
| R2-02 / P0 | [pages RPC](../../packages/server-core/src/handlers/rpc/pages.ts) `getBroker`，约 131–170 行 | 真实双 WS 客户端并发首次申请 8 个 lease，创建 8 个 broker，7 个 lease 随即 `lease-not-found`；顺序申请正常 | Map 检查与设置之间有多次 await，首次并发各自创建对象，最后覆盖引用，前面对象的状态丢失 | 为每个工作区保留同一个初始化 Promise；成功共享实例，失败清理可重试；工作区之间独立 | 有效页面操作不再因首次并发而要求重新挂载；避免重复初始化 | 低至中等。仅改变实例所有权，保留原 lease/nonce/grant/撤销/取消判定 | 双客户端并发首次挂载；所有 lease 均可执行已授权本地夹具动作；不同工作区隔离、失败重试、释放后拒绝；原 grant/nonce/replay 测试照常通过 |
| R2-03 / P0 | [usePages](../../apps/electron/src/renderer/hooks/usePages.ts)、[useProjects](../../apps/electron/src/renderer/hooks/useProjects.ts)、[useAutomations](../../apps/electron/src/renderer/hooks/useAutomations.ts) | 真实浏览器中 B 已加载后 A 的旧成功覆盖三个列表及 atom；A 的旧失败清空 B；Pages/Projects 新推送被旧读取覆盖；清空工作区后 Automations 仍保留 A | 异步出口没有工作区/请求代次校验，推送未使旧读取失效；空工作区未清空自动化列表 | 给现有加载/推送路径加局部有效性判断；切换/卸载使旧结果失效；同工作区较新加载/推送优先；统一处理成功与错误出口、清空状态。保留现有 atom 和 API | 当前工作区始终展示对应列表；旧错误不清空新内容；推送不被旧快照倒灌 | 中等。共享 renderer 影响 Electron/WebUI；注意工作区 id/slug 兼容、手动 refresh 和卸载。审计未实际执行错误业务操作，不声称已造成生产数据损坏 | 修复前先固定 A→B 旧成功/旧失败、同工作区响应乱序、推送先到、null、卸载场景；真实 React 浏览器与本地 RPC 完整路径验证列表/atom 一致，保留截图与结果 |
| R2-04 / P4 | [Pi bundle smoke](../../packages/pi-agent-server/src/bundle-smoke.test.ts) `driveBundle/afterAll`，约 53、93–129 行 | 全量测试出现 `EBUSY` 清理失败；单独运行通过 | `finish()` 调用 `child.kill()` 后立即 resolve/reject，未等 `close`；afterAll 随即删除仍可能被进程占用的 cwd，多个出口也可重复触发 finish | 以进程真正退出和管道关闭作为清理完成条件，保证单次结算；超时/异常沿用有界退出，保留原始错误 | 测试结束时不遗留占用工作目录的子进程，消除已知清理竞态 | 低。只改既有验证生命周期；不吞 EBUSY，不加无条件重试，不改离线认证断言 | 连续运行真实 bundle 验证、完成/异常/超时出口，核对进程退出后才删夹具；保存每次结果和退出证据 |

证据：[backend.json](../verification/results/project-governance-round2-audit-2026-10-16/backend.json)、[hooks.json](../verification/results/project-governance-round2-audit-2026-10-16/hooks.json)、[mcp-discovery.json](../verification/results/project-governance-round2-audit-2026-10-16/mcp-discovery.json)。

Pages 审计故意不提供 grant，以区分“lease 已存在，正确进入 grant 校验”和“刚签发的 lease 丢失”；不实际调用外部工具。前端审计使用真实生产 hooks/React/Jotai 与受控 API 延迟，不是完整 AppShell E2E；实施验收补上本地 RPC 路径。MCP 孤儿进程已由探针清理，不留给用户手动处理。

## 4. 有界调查项

| 项目 | 现有事实 | 确认后允许的一批调查 | 实施/退出条件 |
| --- | --- | --- | --- |
| C2-01 / P1：首屏耗时 | 上一轮未满足 3 s 预算；本轮同 Edge 三次 profiler 诊断首导航 12,948 / 5,207 / 4,922 ms，第二次导航 4,626 / 4,344 / 4,246 ms。RPC 耗时与资源完成时刻波动，不能认定某个 loader 是瓶颈 | 固定构建哈希，以无 profiler 的生产运行建立配对基线，再对一组较慢样本记录 host CPU/I/O 与 renderer trace；优先检查首屏加载、语法高亮 worker 与重复初始化 | 一批调查最多三组配对运行；只有可重复归因、局部改动、原外部行为不变且复测有效才修改。否则记录未解决，不无限追加采样，不放宽预算，不盲拆包 |
| C2-02 / P4：Pages 编译超时 | 全量和单文件两次均在 transforming 阶段达到 30 s，测试源码同时给 child 和 test 30 s 截止 | 将合成项目单独运行并记录编译阶段/进程退出，用较宽但有限的诊断截止区分编译慢、卡住与测试预算；核对尾随子进程 | 只在定位到实际编译重复工作或确定的测试生命周期/预算错误后局部修复；不能只增大超时把问题隐藏。保留成功产物内容检查与失败产物清理断言 |

首屏[三次原始采样摘要](../verification/results/project-governance-round2-audit-2026-10-16/startup.json)包含资源与 handler 时序。首次两组观测到 97 个完成资源、4,901,245 编码字节，第三组包含约 10 MB 的语法高亮 worker，合计 98 个完成资源、14,984,952 字节。这是采样终点内资源完成情况，不能据此断言代码包在运行间变大或 worker 必须删除。所有诊断都启用了 renderer CPU profiler；这些数字不与上一轮无 profiler 结果直接比较。

HTTP FF10 单独重跑通过，当前不修改认证逻辑或扩大它的超时；如果最终串行全量回归再次失败，先定点分析。Runtime 查询、项目全量读取、历史压缩、事件队列等虽有可进一步研究之处，本次没有足够的收益/故障证据，暂不立项。Windows server 分发平台限制、真实供应商/OAuth/消息服务及其他操作系统继续保留验证边界。

## 5. 批次、依赖与验收

1. **B0：固化失败矩阵。** 把本轮探针转为现有 verification 工作流，先写成功/失败/取消/重试场景和产物约定，再改产品代码；不另建平台或强制门禁。
2. **B1：R2-01。** 先完成 MCP 生命周期，再合并首次目录读取；即时跑真实 HTTP/stdio、旧 M01–M03、相关类型及既有测试。工具目录和错误语义必须兼容。
3. **B2：R2-02。** 修复工作区 broker 初始化，结合 B1 验证并发页面动作、释放和取消。此项技术上可独立，但按单任务顺序实施，避免同链路修改交叉。
4. **B3：R2-03。** 修复三类列表的请求归属和推送顺序，验证 Electron/WebUI 共用 hooks、当前列表与 atom 的一致性。没有证据的其他组件不顺带重构。
5. **B4：R2-04 与 C2-02。** 修复已确认的子进程清理问题；有界定位 Pages 编译失败，满足条件才实施。
6. **B5：C2-01 与最终回归。** 性能测量与构建/全量测试错开；按有界调查条件决定是否进行局部首屏优化。运行完整测试、typecheck、lint、文档检查，重建 Runtime 与五项应用；相关既有 19 场景和 33 场景按改动范围回归。完整性能流程单独运行，结果与旧平台限制分别报告。

每一批保留源码标识、命令、退出码、实际场景、原始日志、截图/trace（适用时）及产物哈希。全量测试若仍失败，逐项说明原有失败与新增回归，不以局部通过冒充全量通过。RPC 索引如因行号变化而更新，应确认通道、参数、校验和返回语义没有变化。

退出标准是上述并发故障复现变为通过、无残留自建进程、正确外部行为保持、目录读取次数减少且关键回归可核验。对尚未修复的项目不报告性能提升；没有测量的耗时收益一律标注“未测量”。

## 6. 确认范围

本计划请求一次性确认四项已证实治理任务、两个有界调查项及上述验证批次。确认后按批次直接实施；高风险、不可逆或业务意图不明的候选停止该项并记录，不阻塞其余已确认工作。

用户于 2026-10-16 整体确认。修复前已建立[失败矩阵](../verification/project-governance-round2-failure-matrix-2026-10-16.md)，审计结论 JSON 保留原时点，不覆盖为实施结果。四项修复及回归已完成，条件项按有界调查结果退出；当前未提交或推送。
