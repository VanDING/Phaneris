# 存量项目治理：审计结果与实施计划

Status: implemented — 用户于 2026-10-16 确认整体计划，B0–B4 已执行；G01–G08 本机验证完成，保留首导航与分发平台限制。文档索引问题已按后续授权删除过期图标说明后解决。

审计日期：2026-10-16。基线：`main` / `e08b0413d9d737d2b4914cb46e244ebfcc3d753c` / Phaneris 0.3.2。

本文件记录本次已确认并执行的治理范围，不重新开启历史提案。“已复现”不代表“已修复”；各任务的最终状态见[实施报告](../verification/project-governance-implementation-2026-10-16.md)，修复前场景见[失败矩阵](../verification/project-governance-failure-matrix-2026-10-16.md)。

实施状态与验证结果持续更新于[实施报告](../verification/project-governance-implementation-2026-10-16.md)；以下第 1–6 节保留修改前审计快照。

## 1. 项目情况与审计范围

- TypeScript / Bun 工作区，13 个成员；Electron 桌面端、复用桌面 React/Jotai 渲染器的 WebUI、独立 Viewer 和 CLI。
- 请求经 WebSocket RPC 到 `server-core` / `SessionManager`；Durable Runtime Host 与 SQLite/WAL 管理执行事实及用量，Pi 子进程执行模型和工具，JSONL 保留会话兼容存储。MCP 连接池、消息网关及 WhatsApp worker 是外围执行链路。
- 本机：Windows x64、Intel i5-1340P、约 16 GB 内存；Bun 1.4.2、Node 24.15.0、Electron 44.5.1、Pi SDK 1.2.0。
- 已检查工作区结构、构建/测试入口、配置与模块边界；深读持久化、删除、检索、Runtime 用量事务、MCP 同步、前端加载及异常链路，并以真实生产入口和隔离数据复现问题。自动边界检查覆盖 1,535 个模块。没有声称逐行审查所有文件或验证全部平台。
- 审计开始时已跟踪文件无差异；存在 7 个用户未跟踪的图标设计目录。全部保留，未移动、删除或改写。构建、浏览器、数据库与文件锁探针均使用缓存目录或合成数据，无生产数据操作。

## 2. 修改前基线

机器可读结果与原始证据索引：[baseline.json](../verification/results/project-governance-audit-2026-10-16/baseline.json)、[evidence-manifest.json](../verification/results/project-governance-audit-2026-10-16/evidence-manifest.json)。完整日志、可执行探针、浏览器截图/trace 留在 manifest 指定的本机 `.cache` 目录，结论 JSON 在本目录持久保存。

| 检查 | 结果 | 解释 |
| --- | --- | --- |
| `bun run typecheck:all` | 通过，130.57 s | 现有全工作区类型检查。 |
| `bun run lint` | 通过，237.28 s | 72 条已登记警告；含架构、循环依赖、RPC、发行输入等现有检查。不是零警告。 |
| `bun run test` | 失败，514.45 s | 按 65 个测试进程的汇总相加：6,275 pass / 26 fail / 7 skip；重复打印的失败名称未重复计数。 |
| `bun run test:upstream-015` | 通过，33 个场景 | core 11、orchestration 5、真实 Electron/CDP browser 11、生产 React renderer 6；各工作流 manifest 的退出码均为 0。 |
| `bun run build:smoke` | 部分构建通过，整体失败 | Electron main/preload/renderer、WebUI、Viewer 五项构建通过；随后 server 分发构建明确拒绝 win32。不能记为完整打包通过。 |
| `bun run build:runtime` | 通过 | 当前源码的 Pi 与 WhatsApp worker 均已重新构建。 |
| i18n parity/sorted/coverage/dead-keys | 全部通过 | 使用现有脚本。 |
| fonts / identity / version / runtime / electron-pin | 全部通过 | 使用现有脚本；不新增门禁。 |
| `bun run check:docs` | 失败，6 项 | 均为审计前用户设计目录中的 Markdown 未被索引收录；不擅自整理这些未完成文档。 |
| `bun run test:doc-tools` | 默认环境启动失败；使用既有 uv 后 24/24 通过 | PATH 无 `uv`，但仓库已存在打包用 uv；仅给测试进程 PATH 添加该目录并设 `UV_OFFLINE=1`，24 项在 137.876 s 内通过。测试脚本本身尚未修复。 |
| 现有完整性能基线 | 失败，首个导航超预算 | 3,447 ms / 3,000 ms；同次第二窗口 2,498 ms，其他既有预算通过。详见第 5 节。 |

### 全量测试失败的拆分

| 位置 | 基线失败数 | 当前证据与处理方式 |
| --- | --- | --- |
| `pages-react-build.test.js` | 1 | 构建超过 30 s。并行验收时再次超时；其他验收结束后的最终串行复测 3/3 通过，4.17 s，日志完整保留。尚不能归为确定的产品错误或单纯超时阈值错误。 |
| `system-one-client`、`browser-tools`、`project-memory` | 各 1 | 分别涉及用量新增字段、浏览器输入脱敏输出、记忆由单端截取改为首尾保留。逐项核对当前契约，不能为了旧断言回退已实现行为。 |
| `browser-cdp.isolated.ts` | 3 | 旧 CDP mock 与当前输入/节点解析路径不符；真实 CDP 工作流通过。 |
| `browser-pane-manager.isolated.ts` | 18 | 截图、窗口及 overlay mock 缺少当前调用链能力；真实隐藏窗口/截图/输入工作流通过。逐条恢复有意义的断言，不跳过测试。 |
| `http-server.isolated.ts` | 1 | 成功登录循环超过 5 s。单独复跑曾 15/15 通过；并行复测出现 3 个超时及后续清理错误，最终串行复测 14 pass / 1 timeout。30 次登录逐次做 Argon2 验证；测试超时后清理停止服务，未结束请求又出现 503。单独筛选该用例、临时诊断预算 20 s 时，30 次断言通过，实际 3.64 s。先核对预算与清理，不修改认证或限流规则，也不把诊断通过记为原套件通过。 |

第一次单独复跑的 Pages 成功退出码保留在结果 JSON 中，但原始日志因审计日志路径错误被下一项覆盖；不把该次视为完整可复核验收。其他失败日志保留。这些复跑不代替一次新的全量通过记录。

## 3. 候选治理任务

审计冻结时，下列任务均尚未实施；当前实施结果见文件开头的报告链接。P0/P1/P2/P4 沿用本次请求的治理类别；实际影响和回归风险另列，不代表线上事故定级。

| ID / 优先级 | 模块与位置（基线行号） | 问题、证据与根因 | 预期收益与最小方案 | 影响 / 风险 |
| --- | --- | --- | --- | --- |
| G01 / P0 | [jsonl.ts](../../packages/shared/src/sessions/jsonl.ts) L83、L247；[storage.ts](../../packages/shared/src/sessions/storage.ts) 的 `listSessions` | 头部读取固定 8 KiB。现有 description、转移 summary 各写入 3,000 个中文字符后，合法头分别为 9,359 / 9,373 字节；完整加载成功，同步/异步头读取失败，列表只剩短会话。 | 分块读到首个换行或 EOF，保留短头快速路径；正确处理 UTF-8 边界及关闭句柄。不截短字段，不改 JSONL 格式，不加载整段历史。恢复长元数据会话的可见性。 | 影响会话发现和重载，影响高；局部存储修改，风险低至中。 |
| G02 / P0 | [SessionManager.ts](../../packages/server-core/src/sessions/SessionManager.ts) L6883–6965；[storage.ts](../../packages/shared/src/sessions/storage.ts) L389 | 删除函数捕获磁盘错误返回 false，调用端忽略结果并先移除内存状态。真实 Windows 文件锁下，文件仍存在，却发出 `session_deleted`，调用成功返回。 | 检查删除结果，成功后才提交移除状态及成功事件；失败沿用已有 RPC 错误通道并保留可重试的会话索引。梳理已有 writer 的取消/完成顺序，不用重试掩盖失败。 | 影响高；涉及执行取消、证据、写队列及工作项解绑，风险中。递归删除可能部分完成，不承诺磁盘事务回滚；不引入回收站或新删除产品能力。 |
| G03 / P1 | [store.ts](../../packages/server-core/src/durable-runtime/store.ts) L990 `appendUsage`、L562 `listUsage` | 每次新增用量调用 `listUsage().find(...)`，把账本全表读出并解析。50,000 条历史时新增提交中位数 114.04 ms；主键索引已存在。 | 用 `usage_id` 主键查询替代全表枚举，保留内容一致性比较、重放幂等、冲突拒绝及事务回滚。降低提交随历史规模增长的同步工作量；不加缓存、索引或迁移。 | 影响 Runtime 提交延迟；改动小，风险低至中，必须验证重复计费语义。 |
| G04 / P0 | [search.ts](../../packages/server-core/src/services/search.ts) L25、L247、L316；[sessions RPC](../../packages/server-core/src/handlers/rpc/sessions.ts) L571 | 全局单一 `currentSearchProcess` 让不同搜索相互杀进程：两工作区串行均 200 条，并发连续 3 次为 0 / 200。另 `rawLine.includes('base64')` 丢弃含该普通单词的整条消息，正例结果从 1 变 0。 | 通过现有客户端上下文与工作区确定取消归属，只取消同一发起方的旧请求；区分可搜索文本与实际编码附件内容，保留排除噪声的用途。返回结构不变。 | 影响多窗口/多客户端和特定文本，风险中；附件片段、计数及同客户端快速输入需要兼容验证。 |
| G05 / P0 | [mcp-pool.ts](../../packages/shared/src/mcp/mcp-pool.ts) L77、L212、L275 | 连接变更比较只看 URL 与精确拼写的 `Authorization`。真实本地 HTTP MCP 服务中改 `X-Api-Key` 后，`sync` 和 `ensureConnected` 均继续发送旧值。 | 比较实际参与连接的 HTTP 头配置并保存稳定快照，处理头名称大小写及无变化情况；只重建发生相关变化的连接。不改鉴权流程。 | 影响现有自定义头配置更新，风险中；重连中的工具调用和资源清理需验证。stdio 参数同样被忽略是源码待验证项，复现后才扩大该任务范围。 |
| G06 / P0 | [Viewer App.tsx](../../apps/viewer/src/App.tsx) L74–103 | effect 请求无取消/过期结果判断。新生产构建中先加载 B 再放行 A 的慢响应，地址 `/s/B` 显示 `AUDIT_SESSION_A`。 | 取消旧请求并在成功、失败、finally 都防止过期写状态；处理回到上传页、清空和卸载。保持路由、数据格式及正常加载行为。 | 影响 Viewer 导航正确性，风险低。 |
| G07 / P2 | [WebUI main.tsx](../../apps/webui/src/main.tsx) L31–35 | 名为 `ErrorBoundary` 的组件只有 Suspense，不能接住异常。真实生产入口的 lazy App chunk 返回 503 后，根节点为空，现有 CrashFallback 未出现。 | 用真正的 React 错误边界接入现有 CrashFallback，加载状态与异常状态分开，保留现有重新加载按钮。不加监控平台或自动重试循环。 | 影响加载/渲染异常恢复，风险低；正常首屏样式不调整。 |
| G08 / P4 | 上述失败测试；[test-doc-tools.ts](../../scripts/test-doc-tools.ts) L6；现有验证脚本 | 全量测试 26 个失败，含已变更契约与负载相关超时；文档工具 runner 直接执行 PATH 上的 uv，未使用仓库已准备的运行时。 | 先列失败场景，再按已验证契约修正测试桩/断言及必要的清理；文档 runner 复用现有运行时解析机制。最终重跑原有完整检查。不跳过失败、放宽业务校验或新增门禁。 | 只治理已确认的验证失真；风险低至中。若超时原因无法确认，继续记录而非强行调大阈值。 |

具体原始观测：[会话头](../verification/results/project-governance-audit-2026-10-16/header-probe.json)、[删除](../verification/results/project-governance-audit-2026-10-16/delete-probe.json)、[用量](../verification/results/project-governance-audit-2026-10-16/usage-probe.json)、[搜索](../verification/results/project-governance-audit-2026-10-16/search-probe.json)、[MCP](../verification/results/project-governance-audit-2026-10-16/mcp-config-probe.json)、[浏览器](../verification/results/project-governance-audit-2026-10-16/browser-probe.json)。删除中的进行中写入竞态尚未复现，不与已确认的“错误报告成功”混记。

## 4. 分批实施与预先验收场景

依赖顺序：B0 → B1 → B2 → B3 → B4。批内逐项验证，异常局限在当前任务，不扩大为全项目改造。

| 批次 | 任务 | 修改前先完成的失败场景 / 修改后的验收 |
| --- | --- | --- |
| B0：锁定验证依据 | G08 的场景梳理与必要测试修正 | 固定 HEAD、环境、原始失败与合成夹具；先写场景再写修复。逐条核对旧 mock，复用已通过的原生验收；确保新回归能在旧代码上失败。 |
| B1：持久化正确性 | G01、G02 | 真实文件覆盖短头、8 KiB 两侧、跨块中文、无末尾换行、合法大元数据、损坏首行、读失败句柄回收；经会话列表与重载确认。删除覆盖真实 Windows 锁、解锁后重试、存在/进行中的写入、重复删除、资源释放、事件和错误返回；不操作用户会话。 |
| B2：用量提交性能 | G03 | 同内容 usageId 重放不新增记录，不同内容拒绝，失败事务不残留事实/用量；真实文件 SQLite/WAL 与现有 Runtime 工作流验证；相同设备、规模、预热和采样方法重测。 |
| B3：搜索与连接、前端生命周期 | G04–G07 | 两个真实 WS 客户端跨工作区/同工作区并发；同客户端连续输入、关闭连接、子进程清理；普通 base64 文本、真实附件、隐藏消息、计数/片段。真实 HTTP MCP 验证改头/不改头/URL 变化/连接释放；stdio 先复现。浏览器验证 A/B 逆序响应、旧 404、新成功、清空/上传/卸载；生产 chunk 失败及渲染异常应显示现有回退，重载后能恢复。 |
| B4：整体回归与复盘 | G08 收尾、全部任务 | 全量 test、typecheck:all、lint、i18n、现有 33 场景、相关构建和完整性能基线；文档工具在无全局 uv、现有打包 uv 可用的子进程环境验证。最后审查 API/数据格式/错误变化、Git 差异与用户文件状态。 |

验证以真实入口、文件、数据库、HTTP/WS、浏览器/原生流程为主，保留 JSON、必要截图/trace、运行命令、源码身份和退出码。只有需要独立隔离验证的场景才增加小测试，且必须先写失败条件；不在修复之后补写迎合实现的单元测试。

每项交付必须同时给出：修复前触发条件、修复后可观察差异、通过/失败/未覆盖范围。G02 的错误行为会从“静默成功”改为显式失败；G01/G04/G05/G06/G07 修复错误路径，正确路径及接口格式保持原样。

## 5. 性能观测与预期收益

### 已测：用量账本

生产 `commitFactsAndUsage`，内存 SQLite；每个规模预热 3 次、测量 9 次，中位数如下。历史种子在计时外插入；计时内包含生产读取、解析、一致性比较与写事务；计数探针用于证明全表读取。该结果不是磁盘 SQLite 的最终吞吐量。

| 原有历史行数 | 当前新增提交中位数 | 第一个计时样本解析行数 | 优化后 |
| --- | --- | --- | --- |
| 0 | 0.062 ms | 3 | 未测量，未实施 |
| 1,000 | 2.853 ms | 1,003 | 未测量，未实施 |
| 10,000 | 15.378 ms | 10,003 | 未测量，未实施 |
| 50,000 | 114.036 ms | 50,003 | 未测量，未实施 |

根因明确：应用层每次提交对 N 条历史做 O(N) 枚举及 JSON 解析。SQLite 查询计划确认 `usage_id` 已有主键索引；计划只取目标行，避免无关历史解析。预期收益来自读取范围改变，不预报百分比。

### 已测：现有完整性能流程

归档指标：[performance-summary.json](../verification/results/project-governance-audit-2026-10-16/performance-summary.json)。

命令：`PHANERIS_TEST_BROWSER_CHANNEL=msedge`，运行 `scripts/performance/run.ts --skip-build --output=<本次缓存目录>/performance-baseline.json`。执行前已完成本轮 WebUI 与 Runtime 构建。合成离线工作区：24 个会话，100 / 1,000 / 5,000 条消息，5 次热切换，200 个流式 delta，60 s soak。真实生产 WebUI、WS 与 SessionManager；不包含真实供应商推理或桌面原生冷启动。

| 指标 | 当前观测 | 既有预算 / 解释 |
| --- | --- | --- |
| 首个窗口导航 | 3,447 ms | 超过 3,000 ms；同次第二窗口 2,498 ms。 |
| 首次会话加载，100 / 1,000 / 5,000 条 | 228 / 496 / 935 ms | 均低于 3,000 ms。 |
| 热会话切换 | 184–366 ms | 低于 2,000 ms。 |
| 输入后两帧代理指标 | 32–71 ms | 低于 250 ms；不是硬件呈现延迟。 |
| 首个流式内容 | 229 ms | 低于 1,500 ms。 |
| renderer heap / backend RSS | 约 62.3 MB / 201.9 MB | 瞬时采样，非峰值和 retained heap；不据此证明无泄漏。 |
| 浏览器错误 | 0 | 本轮普通负载流程未观察到错误。 |

启动超过预算需要在无其他重负载时复测、采样定位，才决定是否增加局部优化。单次导航和 bundle 警告不足以授权大规模拆包/重构。所有优化后指标当前均为“未测量”。

## 6. 本轮不实施与验证限制

- 不为文件长度拆分 SessionManager，不清扫全部 72 条登记警告，不做批量格式化、变量改名或依赖大版本升级。
- 不增加 Windows headless server 分发支持。现有脚本只支持 macOS/Linux，当前 build:smoke 失败如实保留；不得用 skip 或修改退出码伪造全通过。
- 不改动七个用户设计目录。六个文档索引失败属于已有工作区状态，本计划仅保证不增加新的文档错误。
- MCP stdio 参数更新、删除与进行中 writer 的竞态，以及冷启动超预算的具体耗时归因：先验证，无法确认则保留原行为并单列，不作为已经修复的项目。
- 未执行完整 `test:critical`、全新安装/容器矩阵、正式签名安装包、macOS/Linux 原生流程、真实 OAuth/供应商/消息渠道端到端。已有 Windows 局部原生工作流不能代替这些验收。
- 没有修改生产基础设施、删除业务数据、执行迁移、发布、提交或推送；这些不是本次实现计划的隐含步骤。

## 7. 实施完成判定

按 G01–G08 逐项标明“已完成并验证 / 已实施但未充分验证 / 未实施及原因”。对照本基线保留既有失败与新回归的区别，报告完整测试和构建真实退出状态；不将分析、代码修改或单次通过等同最终验收。

本次可交付的实际收益目标是：长会话不再从列表遗漏，删除结果与磁盘状态一致，搜索互不干扰且不误丢普通文本，连接配置更新生效，Viewer 不被旧请求覆盖，WebUI 错误路径能够展示已有恢复界面，以及用量提交不再枚举全部历史。

审计阶段收尾（实施前的历史记录）：当时产品源码、依赖和测试脚本无差异，仅新增本计划、结论证据及索引入口。`git diff --check` 通过，归档结论 SHA-256 校验通过；计划加入后文档检查仍为原有六项索引失败，没有新增断链或状态错误。批准实施后的源码改动及验收以[实施报告](../verification/project-governance-implementation-2026-10-16.md)为准。

实施收尾：G01–G08 已完成；新增 19 个真实入口场景和既有 33 个场景通过，全量测试为 6,301 pass / 0 fail / 7 skip。类型、Lint、文档工具、五项应用构建和 Runtime 构建通过。首导航仍超预算，Windows server 分发限制保留；六个用户设计文档索引失败已在用户后续授权删除过期说明后消除。未实施缺乏归因依据的首屏改造，原始审计数值不改写；验收绑定提交前工作区，后续本地提交见 Git 历史。
