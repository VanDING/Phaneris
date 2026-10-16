# 第二轮存量治理实施与验证

Status: implemented — 四项局部修复及本机回归完成；两项有界调查未形成可归因的代码优化，保留原问题边界。

用户于 2026-10-16 整体确认[第二轮计划](../process/project-governance-round2-plan-2026-10-16.md)。本次基于 `02ecdea220195d0af4a1f2882fee7f20286b6260` 的未提交工作区实施；没有提交、推送、发布或生产数据操作。[失败矩阵](project-governance-round2-failure-matrix-2026-10-16.md)先于产品修改建立；[修改前审计](results/project-governance-round2-audit-2026-10-16/baseline.json)保持冻结。[本轮结论](results/project-governance-round2-implementation-2026-10-16/summary.json)及[源代码/产物清单](results/project-governance-round2-implementation-2026-10-16/evidence-manifest.json)记录实际命令、结果和哈希，不以通过结果覆盖旧失败。

## 项目与实际问题

Phaneris 0.3.2 由 Electron、共享 React/Jotai 渲染器的 WebUI、Viewer、CLI 及 Bun/TypeScript 服务工作区组成。WS/RPC、SessionManager、Durable Runtime/SQLite、Pi 子进程与 MCP 共同完成会话执行。本轮集中处理已复现的异步状态所有权和资源退出问题，未新增业务能力、依赖、安全门禁或治理平台。

## 已实施治理

| 模块 / 优先级 | 原始问题 | 根因 | 实施修改 | 实际验证 |
| --- | --- | --- | --- | --- |
| R2-01 / P0、P1、P2 / [MCP pool](../../packages/shared/src/mcp/mcp-pool.ts)、[client](../../packages/shared/src/mcp/client.ts) | 同来源并发连接创建多个进程，断开仍有孤儿；晚到初始化回填；首次目录重复拉取 | 只有已连接 Map，没有进行中所有权；退出只关已连接对象；健康检查丢弃目录结果 | 按来源共享相同配置的连接 Promise，配置替换先撤销旧所有权；退出等待进行中连接与关闭完成，旧连接不能发布工具；复用首次健康检查目录，显式刷新仍读服务器 | 真实 stdio/HTTP/API in-memory 场景：同来源八次并发只启一个子进程；单个/全部断开、晚到配置、失败重试、来源独立、池复用、初次目录与后续刷新通过 |
| R2-02 / P0 / [Pages RPC](../../packages/server-core/src/handlers/rpc/pages.ts) | 八个首次请求建八个 broker，七个有效 lease 随即丢失 | Map 检查和赋值间多次 await，后一个实例覆盖前一个 | 每个工作区缓存初始化 Promise，失败时清理拒绝项；保留工作区隔离和原 broker 校验 | 双 WS 客户端八个 lease 全部执行已授权本地 API；工作区隔离、释放、nonce/replay 拒绝和初始化失败后重试通过 |
| R2-03 / P0 / [usePages](../../apps/electron/src/renderer/hooks/usePages.ts)、[useProjects](../../apps/electron/src/renderer/hooks/useProjects.ts)、[useAutomations](../../apps/electron/src/renderer/hooks/useAutomations.ts) | 旧工作区响应覆盖/清空新列表；旧读取覆盖推送；工作区清空后自动化残留 | 异步成功/错误出口缺少请求代次；卸载与推送不使旧读取失效；空工作区直接 return | 在原 hooks 中维护局部请求代次，切换/卸载和新推送使旧请求失效；成功和失败均检查有效性；清空自动化列表 | 八个真实 React 浏览器场景通过，包括旧成功/错误、同工作区逆序、推送、null、卸载、id/slug 重读及真实 WS/RPC 读取和推送；本地状态与 atom 一致 |
| R2-04 / P4 / [bundle smoke driver](../../packages/pi-agent-server/src/bundle-smoke.test.ts) | 全量测试清理 cwd 报 EBUSY | kill 发出即结算，没有等待进程和管道关闭；多个出口可重复 finish | 只结算一次；在 close 后 resolve/reject，保留原失败原因；超时终止配合有界强制退出 | 实际 bundle 连续三次通过；从既有测试文件原样提取 driver，用真实进程验证成功、提前退出、超时、spawn 失败四出口，结算时无存活夹具子进程且 cwd 可删除 |

MCP 主动断开时，尚未完成的连接现在拒绝并回收；此前可能误报成功并重新发布工具。Pages 的合法 lease 现在保留在同一个工作区实例中。前端修复使过期响应失效；没有改变正常请求的数据内容或有效错误处理。

连接池两处原有测试桩改为只替换客户端构造，生命周期仍执行生产实现；两组 13 项旧测试通过。没有新增实现后单元测试。原本基于 override connect 的桩无法覆盖新的配置替换路径，针对性和首次全量验证分别暴露了两处，修正后不再访问假域名。

首次完整 Lint 提示三条数值 ref 的清理写法警告：插件把 `current++` 当作 DOM 引用读取，没有识别其赋值。对照本地插件规则后改为等价的 `current += 1`，完整 Lint 重跑通过，仍为 72 条原有登记警告，没有加入抑制或扩大额度。

## 运行效率收益

以下是实际请求/资源计数，不是端到端模型速度或系统整体提升比例。

| 条件 | 修改前 | 修改后 | 说明 |
| --- | --- | --- | --- |
| 同来源、同配置八次并发 stdio 连接 | 八个子进程 | 一个子进程 | 真实协议夹具；不同来源仍可并发，不使用全局串行队列 |
| 同一初次 HTTP MCP 连接的 tools/list | 两次；审计三次均如此 | 一次；后续显式刷新再发一次并取得新目录 | 保留健康检查错误，复用它已经获取的目录；外部网络延迟与整体耗时改善未测量 |
| 同一工作区八次首次申请页面 lease | 八个 broker，七个 lease 丢失 | 一个 broker，八个获准动作成功 | 计数来自生产 RPC；具体初始化耗时改善未测量 |

完整生产 WebUI 性能流程退出 0，155.87 s，7/7 现有预算通过，浏览器错误 0。Windows x64 / i5-1340P / Bun 1.4.2 / Edge 155.0.4283.60；真实 WS/RPC/SessionManager，离线 24 会话、100/1,000/5,000 条消息，5 次热切换、200 个流式增量、60 s 实时 idle。见[性能结果](results/project-governance-round2-implementation-2026-10-16/performance.json)。

| 指标 | 本轮观测 | 原有预算 |
| --- | --- | --- |
| 首导航 / 第二窗口 | 2,713 / 1,681 ms | ≤3,000 ms |
| 首次加载 100 / 1,000 / 5,000 条 | 338 / 1,095 / 1,100 ms | ≤3,000 ms |
| 热切换 | 193–637 ms | ≤2,000 ms |
| 输入后两帧代理值 | 46–89 ms | ≤250 ms |
| 首个流式内容后两帧 | 385 ms | ≤1,500 ms |
| renderer heap / backend RSS | 57,366,656 / 184,565,760 字节 | 256 MiB / 1 GiB；瞬时采样，不是峰值或 retained heap |

这些是当前合成工作负载的观测，不是修复带来的前后提升；两帧指标不是硬件呈现延迟。没有可比较的、受控的修改前端到端基线，不能推算系统整体提升比例。

## 基线失败与有界调查

审计全量测试为 6,299 pass / 3 fail / 7 skip：Pages 编译 30 s 超时、Pi 目录清理 EBUSY、HTTP FF10 超过 5 s。Pi 清理按 R2-04 修复。HTTP 单文件 15 项重跑通过，本轮没有改认证流程、成本或超时预算。

Pages 编译在审计全量与单文件中各超时一次。本轮同样源码的合成 scaffold 独立编译成功，1,755.83 ms；其后原测试 3/3 通过，编译主体约 847 ms，最终串行全量也通过。未形成可重复根因，未改 scaffold、编译规则或测试截止，也未将重跑通过记为已修复超时。

首屏按计划完成三组诊断，WebUI 全部构建文件哈希在运行间一致。两组无 profiler 首导航为 1,697 / 1,989 ms，第二窗口 1,577 / 1,885 ms；第三组带 CPU profiler 为 1,916 / 1,651 ms。均不是冷磁盘测量：核对构建哈希会预读资源，OS 文件缓存、GC 和其他桌面活动也未受控。保留了 renderer CPU profile、host CPU/RSS 自采样；Windows 终止路径没有写出 host CPU profile，没有取得可归因的磁盘 I/O 栈。见[启动诊断](results/project-governance-round2-implementation-2026-10-16/startup.json)。

当前条件没有稳定复现超预算，无法认定某个 loader、worker 或 RPC 造成原始慢启动，因此没有修改启动架构、加载策略或预算。该调查按上限退出；首屏改善没有作为本轮代码优化成果，原始慢启动仍未定位。

既有原生浏览器回归首次在密码输入框粘贴断言失败，缺少 `-pasted` 后缀；该次 core/orchestration 已通过，后续 renderer 因命令链中止未执行。一次串行完整复测 33/33 通过，185.70 s。浏览器操作实现未改，保留间歇失败，不将其记作本轮已修复问题。

原有生产浏览器工作流先因未配置已安装 Edge、缺少 Playwright 默认 Chromium 而无法启动，随后一次 WebUI 夹具启动达到原 45 s 截止。使用已有 `PHANERIS_TEST_BROWSER_CHANNEL=msedge` 配置，在其他性能作业结束后独立确认 5/5 通过，16.54 s；没有安装依赖、修改旧工作流或增加超时，原始失败日志保留。

## 测试与兼容性

| 检查 | 当前结果与范围 |
| --- | --- |
| 新服务 / renderer / process 验证 | 12 + 8 + 4 场景通过；JSON、PID/方法日志、截图、trace 与源代码摘要留存 |
| 既有连接池测试 | 两组 13/13 通过；状态机执行生产实现，替换网络客户端构造 |
| `typecheck:all` | 通过，120.08 s；全工作区、构建和脚本 |
| 完整 `lint` | 重跑通过，121.73 s；2,310 文件、72 条既有警告，原 RPC/架构/分发检查通过 |
| RPC 契约 | 426 个通道语义与 HEAD 一致；生成索引只变化 Pages handler 行号 |
| `build:runtime` | Pi 与 WhatsApp worker 构建通过 |
| `build:smoke` | 五项应用构建通过；命令整体退出 1，仍为 win32 server 分发不支持。Runtime+smoke 合计 265.55 s，不声称正式安装或完整分发通过 |
| 既有 19 场景、既有 33 场景 | 最终全部通过；19 = 存储 8 / 服务 6 / 生产浏览器 5；33 = core 11 / orchestration 5 / 原生 Electron 11 / renderer 6。间歇失败已单列 |
| 完整测试 | 6,301 pass / 0 fail / 7 skip，200.50 s；首次实施回归发现另一处测试桩旧注入点，修正后完整重跑，不将其四个失败计作产品 Bug |
| 完整性能流程 | 退出 0，7/7 预算通过，浏览器错误 0；当前观测，不作修改前后因果比较 |
| i18n 四项、fonts、identity、version、runtime、electron-pin | 全部通过；保留既有规则，没有新门禁 |
| 文档与差异检查 | 通过；157 份文档、1,214 个相对链接；`git diff --check` 无错误 |

## 复验方式与证据边界

从仓库根运行下列命令，输出目录必须是新的目录。工作流沿用现有 VerificationRun/产物哈希，不安装依赖或增加强制检查。

```sh
bun run scripts/verification/project-governance-round2-services-workflow.ts --output-dir=.cache/verification/r2-services-repeat
bun run scripts/verification/project-governance-round2-renderer-workflow.ts --output-dir=.cache/verification/r2-renderer-repeat
bun run scripts/verification/project-governance-round2-process-workflow.ts --output-dir=.cache/verification/r2-process-repeat
bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/r2-services-repeat
```

另两个目录同样使用 `--verify` 核对。浏览器验证为生产 React/hooks 的独立宿主，加真实本地 RPC 集成，并非全 AppShell 视觉验收；原生场景另由既有 workflow 验证。没有验证其他操作系统、真实外部 MCP/供应商/OAuth/消息账户、正式签名安装或完整 test:critical/容器矩阵。

七个已有图标素材目录的 240 个文件及两份独立更新的 packaged-client JSON，共 242 个文件，均与本轮实施前哈希一致，不纳入本轮改动、不回退其他工作。计划、专项脚本、业务局部修复、生成索引和结果仍在工作区，尚未提交或推送。

## 计划核对与遗留项

| 任务 / 批次 | 状态与限制 |
| --- | --- |
| B0：失败矩阵与专项入口 | 完成；产品修改前固定场景，使用已有产物机制 |
| B1–B4：R2-01–R2-04 | 已实施并验证；24 个新场景、13 个既有连接池测试与三次真实 bundle 重跑通过 |
| C2-01：首屏调查 | 调查到达本轮上限，未实施启动改造；当前预算通过，原始慢启动仍未归因 |
| C2-02：编译调查 | 未改代码或预算；独立编译、原测试及最终全量通过，原超时未稳定归因 |
| B5：本机回归与复盘 | 完成；全量测试、类型、Lint、应用/Runtime 构建、既有场景和性能预算有实际结果；Windows server 分发整体失败仍保留 |

本轮减少了重复 MCP 连接和目录请求，消除了页面实例覆盖、旧工作区响应倒灌与测试进程清理竞态。后续优先在慢启动或编译超时再次出现时采集当时的 CPU/磁盘/进程证据，而非据当前较快观测继续拆包。其他平台、真实账户和正式分发仍沿用原验证边界。
