# 架构与代码治理完整实施台账

2026-10-13 维护说明：本文继续作为 G0–G8 的当前职责/实施参考；下文日期、源码基线与平台限度保留原验收口径。未实施事项只在[价值裁定与执行队列](implementation-value-register-2026-10-13.md)维护，旧轮次的“下一阶段”不另开队列。

日期：2026-10-11（Asia/Shanghai）。源码基线：`8e5bf13b3f393dc776f6c17057eb5d0fb05f2dda`，实施在当前工作树，未提交或推送。范围：既有功能的架构、所有权、契约、构建与验证治理；没有启动新功能或版本升级。

状态：仓库内实施及列明的本地验收完成；独立审计收口证据已归档。本文接续 [首轮](../archive/governance-first-wave-2026-10-11.md)、[第二轮](../archive/governance-second-wave-2026-10-11.md)，不改写其历史证据。依据：[总计划](../archive/architecture-code-governance-implementation-plan-2026-10-11.md)、[先行失败矩阵](../verification/governance-completion-failure-matrix.md)、[逐项职责清单](governance-ownership-inventory-2026-10-11.md)、[领域裁定](../architecture/governance-domain-ownership.md)。

## 1. 已实施的工作包

| 工作包 | 当前 owner 与实际变化 | 保留的兼容与验收边界 |
| --- | --- | --- |
| G0/G1/G2a | 历史文档裁定；验证独立目录、失败 manifest、全成员检查与 CI 保存；插件事务/凭据提交修复 | 首轮原始证据保持；本轮 critical 复跑其故障场景 |
| G2b/G2c | SQLite 撤销、统一 Origin/代理信任判定、握手后复核；唯一故障退出 owner、quiesce 和有界 cleanup | 第二轮原始证据保持；本轮增加真实 Electron 主进程退出验收和错误消息保留修复 |
| G3 | `config/repository.ts` 唯一 config.json writer；纯 persisted-types/schema/normalize 与 I/O 分离；defaults/assets/appearance/connections/workspace/drafts/migrations 各有入口 | `storage.ts` 为 34 行兼容 facade；原数据格式、迁移顺序/标记、Windows 路径和 vault 规则保持 |
| G4 | 425 项 RPC 清单；51 个高风险输入在 dispatch 前校验，41 个结果使用既有 DTO；transport/preload/CLI 的目标 any 边界清除；实际 AST 解析 365 个 handler channel / 387 个注册位置、48 个事件、12 个明确保留 surface | wire 名、`__craftRpcType`、旧 minor、未知字段和可选 null 兼容；timeout 不代表 effect 取消，不自动重试 mutating RPC |
| G4 依赖/循环 | 39 个根借用候选加 8 个补充消费对逐一裁定；解析相对路径/barrel/public exports；六个纯入口、单 writer、禁止装配服务反向访问 facade/Host 内部 | 当前借用候选 0；三组值循环按成员和每条边冻结，新增、扩张与陈旧 allowance 均失败 |
| G5 | Pi 独立 `messages`、`jsonl-transport`、`pending-replies`、`session-lifecycle`、`tool-composition`、`model-runtime-owner`、`session-event-adapter`、`sdk-registration` | 创建 promise/generation 和 registry 终结唯一；`durable-tool-accounting.ts` 私有持有 batch/commit Map，事件适配器不再双写；Bedrock → Bun OAuth → default stream 注册顺序保持；stdout 只有协议 |
| G6 | `sessions/agent-product-context.ts` 与 `agent-product-callbacks.ts` 负责分支/SDK/thinking/转移产品状态；`agent-assembly.ts` 构造有限快照/回调/resource port；`source-resources.ts` 持有 HTTP/MCP lease；`product-repository.ts` 持有唯一产品 snapshot/JSONL 队列 | Manager 保留产品 API、产品事件时钟与 Host 调用适配；未移交 Host 的 run/generation/T1/T2/恢复/取消权威 |
| G7 平台 | Electron/Web 分别装配有限 ports，连接 ready 后 `initializeClient` 才挂载；browser 3 条历史例外消除，46 个 alias/shim 收缩至 4 个 | 兼容 `electronAPI` 保留；原生能力缺失明确失败，Web 设置不展示原生专用控制项 |
| G7 交互 | 输入草稿与导航订阅有独立 owner；工作区切换先同步捕获所有 composer 草稿并 flush，成功后销毁旧订阅，再改 ACK 接受的绑定；重连使用新绑定；行键盘目标正确 | 两个宿主同一真实 SSE/Pi/Host 场景；Web 另有真实离线编辑；语言切换不重载产品启动状态 |
| G8 | Docker 固定 Bun 1.4.2、install 前携带 patches；共同 `build:runtime` 构建 Pi/worker；独立空缓存 frozen install；分发目录移出源码树后的生产 boot/RPC/真实 Pi | 必要入口/worker/WASM 缺失在监听前失败；包、lock、runtime、资源作为一个分发单元；签名/安装器与本地 smoke 分开 |
| G8 身份 | 默认严格检查；逐文件/精确行分类保留 provider、wire、读兼容、署名与历史证据；其余用户可见/内部标识归项目身份 | 不替换已有协议和用户数据标签；新增残余不能搭乘上游链接或宽泛文件 allowance |

完整配置表包含 121 个基线 AST export 声明对应的 **129 个公开名称**；不是删除了八个 API。Manager 的 206 个方法、40 个字段均有裁定；当前为 207/41，不能用方法数量证明职责收缩。Pi 原“30 个引用”是声明数，补上 3 个 TS import type 后是 33 个 AST 位置；当前 37 个位置均走公开 subpath，其中运行值限于九个具名 port。

## 2. 原问题台账的最终裁定

| ID | 实施结果 | 最后所有者/证据 |
| --- | --- | --- |
| GOV-01 | verified：插件提交、备份清理与源凭据残余关闭 | 首轮 plugin-transaction；本轮 13 场景复跑（含备份丢失） |
| GOV-02 | verified：日常验证不再覆盖历史结果，参数先验证，失败也留证据 | `verification-artifacts.ts`；output canary |
| GOV-03 | verified：CI pin、上传、PR/完整回归、native/container/clean install 接线与故意违规门禁 | CI + governance-gates；远端执行限度见 §7 |
| GOV-04 | verified：配置纯/I/O 边界及唯一 writer 成立 | config-domains、governance-boundaries、职责清单 |
| GOV-05 | verified：目标 RPC 输入/结果/所有权/路由有分类，副作用前拒绝非法 args | contract-inventory、rpc-contracts；原 handler 的 owner/path 检查保留 |
| GOV-06 | verified：初始化顺序显式，浏览器闭包例外消除，真实延迟挂载/能力错误验收 | client-platform 与 native-client |
| GOV-07 | verified：有限 agent 装配、source lease 和产品 repository 入口独立 | session-owners、独立 Pi/Host；Manager 仍保留大量产品编排 |
| GOV-08 | verified：Pi 生命周期、pending、模型/工具/注册/事件有唯一 owner | pi-control、durable-runtime-pi、生产分发真实 Pi |
| GOV-09 | verified：优先交互文件的 Hook 警告清除，实际切换/重连/输入/计划/取消验证 | 两个宿主的截图、事件、持久化事实与 perf；其他已分类警告仍受 ratchet |
| GOV-10 | verified：本地认证/lifecycle 残余关闭，Electron 退出按真实主进程复验 | auth-lifecycle、process-lifecycle、native-fatal |
| GOV-11 | verified：13 成员与四类 tooling 项目检查，真实全库回归，测试配置隔离 | validate:full、lint.json、quality-coverage |
| GOV-12 | verified：每个借用消费对与 Pi shared 引用已裁定，public export/值循环受门禁 | ownership-inventory、graph-final、cycle-ownership |
| GOV-13 | verified：Docker 输入/共同命令/分发资源；deferred：本机不能执行容器虚拟机 | distribution-inputs、clean-install、build-smoke；原因见 §7 |
| GOV-14 | verified：总计划、overview、索引及历史文档裁定链接闭环 | 本文和 docs gate；历史正文与 SHA 不改写 |

## 3. 实测发现与随行修复

1. 配置拆分后远程 token 删除若先清 cache、vault 再失败，会留下内存/持久状态分歧。现在只在 vault 成功后删除 cache。
2. 打包 Pi 的连续 `init`/`prompt` 真实 stdin 批次暴露 SDK 创建竞态。入口等待当前 initialization barrier；活动 prompt 中的 abort、permission 与工具回复仍可并行处理。
3. 实际 SubmitPlan 卡片暴露交接过早结束 driver queue：Host 先停放 run，后到 T2 无法合并，接受计划要求 reconciliation。Pi 在工具结果成功提交 **之后** 停止 SDK 后续推理；driver 保留事件队列至 agent_end。两个宿主的 SQLite 均验证计划 T2 先于终态、只提交一次且不需恢复停放。普通取消/崩溃仍保留 unknown effect 策略。
4. 原生开发环境曾把 Bun 目标 bundle 用 Electron executable 启动。开发装配现在明确选择 Bun；打包仍选择随包 Bun。
5. 实际语言设置页暴露 Web 发出 native notification RPC。现在通过已初始化 platform 的宿主种类加载/渲染原生设置，不给不存在的能力返回成功状态。
6. 真实断线时 debounce 草稿写入曾丢弃 pending，并产生 `Not connected (channel: drafts:set)` 未处理 rejection。独立草稿 owner 串行保存绝对快照，仅同一版本成功才移除；断线保留并在连接后保存最新值，切换 workspace 先 flush。它不接收或重放工具、消息与其他 mutating RPC。
7. 真实分发先后发现绝对 output 被错误拼入根、遗漏 QuickJS WASM 仍开始监听、仅复制顶层 hoisted 依赖遗漏嵌套 `fast-uri`。输出解析、启动前资源检查和完整安装依赖树复制已修复；保留每次失败和修复后的离线产物。
8. 异步加载后的堆栈首行偶尔只有 `Error`，遗漏首故障 message/cause。lifecycle 明确保留 name/message 和堆栈，再走原有脱敏。进程夹具改为等待 `close` 排空诊断，不靠读取 `exit` 后的未排空 pipe 判断成功。
9. 验证夹具原 `waitForFunction(async …)` 不能证明异步条件成立。活动脚本现由驱动循环 await `page.evaluate` 的实际结果；旧冻结证据保留，本轮真实重跑作为当前结论。现有 unit/isolated mock 同步迁到具体配置 owner；workspace 子进程使用临时配置根，避免失败夹具触及开发者配置。

没有新增事后单元测试。新增验证是生产子进程、真实浏览器/Electron、SQLite、HTTP/MCP 和真实门禁故意违规场景；既有单元/isolated 测试作为回归继续运行。

## 4. 指标与验收口径

| 指标 | 原始/第二轮基线 | 当前 |
| --- | ---: | ---: |
| config/storage.ts 入口行数 | 3,395 | 34（兼容 re-export；不代表总配置代码减少） |
| Pi index.ts 行数 | 2,844 | 2,268 |
| SessionManager 行数 | 11,322 | 11,226（产品 facade 保留，不用 LOC 作解耦验收） |
| 根借用消费候选 | 39 | 0；47 对依赖消费有逐项裁定 |
| 循环候选 | 16 组未区分类型的原始 SCC | 17 组全引用 SCC / 3 组值 SCC；逐边冻结 |
| Web 历史例外 / alias-shim | 3 / 46 | 0 / 4 |
| lint 警告 | 120 | 72：49 Hooks、6 未使用 suppression、17 已分类设备/Playground 存储 |
| IPC/RPC channel | 425 | 425；51 输入契约 / 41 结果 port |
| lock placement / distinct package@version | 2,066 / 1,756 | 1,847 / 1,645；新增版本身份 0 |

Bun 根据新清单重新解析并裁剪/rehoist lock，未手写删平台/optional/peer 节点。移除 111 个不再需要的 package@version 身份；同一个包在不同安装路径的 placement 改变不等于升级/降级。版本/range 与补丁保持，frozen clean install 后 lock SHA 不变。

[最终收口证据](../verification/results/governance-closeout-2026-10-11/README.md) 记录完整命令、235 个工作流场景、243 项关键既有回归、6,285 项 workspace 回归、bundle 的**精确字节和 SHA**以及三次最终性能原始采样。renderer 初始 HTML 引用图缩小源于初始化后延迟加载 App；启动仍会加载业务图，不能据此宣称总 JavaScript 或冷启动降低同样百分比。

本轮对 App、AppShell、FreeFormInput、ChatDisplay、AppSettings、SessionList 以及新抽取 Hook 的目标依赖/订阅警告整改，其他现有 warning 逐文件/规则/消息/数量保留。新增和陈旧 allowance 都失败，不自动重建基线。17 个 localStorage 警告是 5 个设备展示偏好和 12 个开发 Playground 状态；均不拥有 credential 或 canonical Runtime 事实。

## 5. 维护与回退

- 日常 `validate:full`、`test:critical`、`build:smoke` 输出唯一 `.cache/verification/<run-id>`。CI 保存 manifest、日志和数据库；历史目录只由明确归档操作写入。
- 边界违规、相对路径/barrel 绕行、第二 config writer、新根借用、新/变化/陈旧循环、RPC 清单漂移、必要分发输入缺失、未经分类身份均是硬失败。
- Runtime Host/Kernel 保持唯一执行权与 T1/T2/恢复事实；JSONL、UI、Task 和草稿快照没有执行权。timeout/断线不能推断 effect 未发生；有 T1 无 T2 不自动重放。
- 配置 facade/公开 wire/旧读标签保留；可按 owner 接线回退。code、lock、Pi/worker bundle、WASM 和宿主 runtime 同一单元回退，先排空运行并核对 durable 恢复记录。
- SessionManager 仍大、renderer 仍由两个 app 共用源码、三组循环仍是已核实的组合边界。只有真实消费者和独立收益成立才再拆 workspace 或产品 facade；不把文件数量当收益。

## 6. 独立审计后的补充收口

审计主要缺口成立；不存在空白修复前的“全项已验证”。[初次 G3–G8 快照](../verification/results/governance-completion-2026-10-11/README.md) 保留当时的成功/失败记录；[本次收口证据](../verification/results/governance-closeout-2026-10-11/README.md) 才对应下列修复。先行 F01–F15 矩阵、真实失败和修复后 E2E 分开保留。

| 审计主题 | 修复与最终验收边界 |
| --- | --- |
| 身份与陈旧 allowance | 原证据逐文件/完整精确行分类，陈旧规则在 strict 模式失败；新归档后重新扫描，不用目录级豁免掩盖残余 |
| RPC census | 修正 member/key AST 抽取，实际 handler 非空，51 个中央契约均有入口；其余 handler 保留现有领域检查，未声称所有 365 个方法都有中央 schema。12 个没有实现的稳定 surface 单独裁定，新/陈旧裁定失败 |
| CI 与 registry | pull_request/push/main/workflow_dispatch、有效 job/step 条件、失败传播、缺失上传产物均检查；21 个必需工作流和 6 个测试组由独立显式策略约束，三个治理 canary 纳入 critical |
| 冷运行时 | validation 入口先供给同一 pinned uv；实际空目录下载、SHA 验证、stamp/binary/checker/可执行版本往返；文档测试外层也使用同一 CPython 3.12.15 常量 |
| 凭据、workspace 与 logout | 从真实 backend 故障层验证，失败不删除 token cache 或 canonical workspace config；缺失 credential 删除仍幂等。logout 通过 repository 只删根 config，保留 workspace；门禁扫描目录外 I/O/别名 |
| Session / Pi | 产品 snapshot 与产品回调移入有限 port；五个 Session owner 的完整解析闭包禁止 Manager/Host 内部反向依赖。Pi accounting 私有化；真实同批 init/prompt 和活动流 abort，独立 Host/T1/T2 继续通过。Manager 的 `buildSessionAgent` 仍为 1,567 行产品编排，未宣称整体消除 |
| ESLint | commonRules 放入实际 flat config rules；真实 Electron/UI 文件 debugger/unsafe-finally 负例；禁止日常 initialize-baseline。修复稀疏依赖数组，清除 SessionList 四条 Hook 和 browser-pane 两条陈旧 suppression |
| Web 故障 | 保留 mounted composer，同步快照后再等待保存；失败不切绑定、不丢草稿，恢复后持久化。文件树没有 native 能力时隐藏 reveal，双击走 Web preview。手动 reconnect 同步公布 reconnecting，避免旧 socket 的 connected 假象；两个宿主零未处理异常 |
| 分发 | Docker 生产模式、完整 Pi staging/资源路径与监听前检查；standalone Docker Bun 由同一 pin 生成；desktop worker 使用共同命令。五项 loose resource 删除逐一在监听前失败；本机真实 Docker 仍未执行 |
| 证据 | curated 选择/排除清单、原 manifest SHA、全目录 SHA256SUMS 和标准库 verifier；完整覆盖原产物表。篡改、额外文件和已重算 SHA 的排除清单缺失均被拒绝 |

兼容 electronAPI 仍广泛存在；这轮建立有限 ports 并迁移指定真实消费者，没有声称 673 个历史调用已经全部替换。devDependencies/peerDependencies 的合法消费保留原逐对裁定，未凭审计意见统一挪动所有依赖。薄装配和 owner 门禁是本阶段收口边界，后续产品 facade 拆分需要独立收益与真实场景。

## 7. 平台与外部验证限度

| 环境/能力 | 本轮结论 |
| --- | --- |
| macOS x64 本地 Bun/Node/Electron/Web | 实际运行；完整回归、两个宿主交互/持久化、生命周期、离树分发、空缓存安装、原有预算性能 |
| Docker 实际镜像 build/boot | 本机 Docker daemon 不可用；Colima VZ 报 `Virtualization not available on this hardware`。已停止并还原原 2 CPU/2 GiB/20 GB 配置及 Stopped 状态；没有声称镜像通过 |
| Linux 容器 CI | 明确 `test:container` 工作流与 Linux job、Bun pin、patch/cache/resource gate 和 artifact upload 已接线，远端本轮未执行 |
| Windows/Linux 原生、签名、公证、安装/升级/更新链路 | 继续按 release-readiness 验收；本地 build、路径 fixture 和 unsigned app 启动不能代替 |
| 外部 provider/OAuth、IM、远程 TLS 代理、线上部署 | 未用真实账户或外部服务推断通过；使用 loopback SSE/HTTP/MCP 验证既有领域路径 |

这轮完成仓库内的治理实施和列明的本地验收；外部平台证据属于公开分发前置条件。现有 null viewer 服务、关闭的 telemetry、权限默认模式和延后的功能设计保持原裁定。
