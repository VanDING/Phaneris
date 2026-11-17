# 上游 v0.15.4–v0.15.10 修复吸收实施记录

状态：**F01–F08 已实施并验收，保留未测范围**。日期：2026-11-17（Asia/Shanghai）。

用户在[评估报告](../dependencies/upstream-bugfix-assessment-2026-11-17.md)后批准实施。按[实施前失败矩阵](upstream-bugfix-2026-11-17-failure-matrix.md)串行修改产品源码，复杂行为用真实事件、HTTP、子进程和SDK journal验收。初始基线为 Phaneris 0.6.5／`43ee16f7b476c0403d93825c3dfd15bd35f74aca`，分支为 `codex/upstream-bugfix-20261117`。实施期间另一项侧栏工作提交为 `0fde4fd7654c9d2c53108d06ba2771f576db386e`；最终验收基于该HEAD及本轮未提交的修复。侧栏提交不属于本轮上游吸收。

## 已实施的修复

| 编号 | 实施结果 |
| --- | --- |
| F01 | OpenAI Chat Completions和Responses在注入工具元数据时保留 `additionalProperties: false`。Rich关闭时保留原有内建工具／MCP工具各自的元数据策略 |
| F02 | 自动化prompt、labels和Telegram topic仅使用事件上下文，按原文本传递；不再继承进程环境或作shell转义。脚本与Webhook继续使用各自环境边界和既有前缀兼容规则 |
| F03 | 两种变量语法在一次替换中处理，插入文本不再次展开；Webhook对象／数组按JSON值展开后编码，直接请求、即时重试和供延迟重试保存的动作副本走同一逻辑，特殊对象键保持为普通自有属性 |
| F04 | 指令发现先读取root到cwd的祖先，再仅扫描cwd子树；BFS限制为6层、4,000目录和150ms软预算。忽略隐藏／依赖／构建目录，不跟随目录链接。缓存以root+cwd区分，保留Windows路径和XML消毒 |
| F05 | Pi分支只在首次初始化时fork，之后使用自己的journal；用自定义非模型上下文条目持久化cutoff。无效anchor在fork写文件前拒绝，避免留下可误认的子journal；已初始化分支可在父文件不可用时继续 |
| F06 | 工具集变化先在旧session等待压缩；仅在空闲且未重试时重建，其他情况延后。复用已有等待结果，避免两次等待吃掉RPC期限；Stop通过epoch使等待中的prompt失效。旧SDK代理工具在宿主预检前、调度后和实际执行前核对当前集合，撤销后不能借自动来源启用路径重新生效；Durable上下文收敛和回执所有权保持原机制 |
| F07 | 当前实际注册的共享Git分支RPC改用异步argv调用，5秒超时、有限输出和隐藏子进程窗口。detached HEAD、非仓库和失败返回null；保留旧Electron死副本，不扩展为无关清理 |
| F08 | 运行时逐matcher复用现有严格schema和语义校验，隔离无效项；好项可独立加载和重载。保留本地接口约定：存在坏项时 `success:false` 并返回具体错误，但有效子集已应用；未知事件仍仅警告。非法JSON／根结构在热重载时保留旧配置，scheduler随有效集合启停 |

自动化代理文档补明agent events不运行动作，以及prompt变量的隔离／原文／单次展开规则。没有新增agent-event动作能力。RPC契约快照仅同步共享system handler中7处行号变化；445个channel、69个输入契约及wire字符串未改变。

## 验收

| 范围 | 结果与边界 |
| --- | --- |
| 新核心流程 | 14/14，`upstream-bugfix-core-3vDQVI`：实际拦截器子进程→HTTP、自动化事件、JSON与重试、坏项隔离／重载、指令文件树与链接、实际RPC和可控慢Git |
| 新Pi流程 | 7/7，`upstream-bugfix-pi-cBKQFf`：实际Pi subprocess、原生SDK journal与延迟回环模型；首条消息前重开、子历史与父文件隔离、错误anchor、压缩中同步工具、Stop、SDK重试和来源撤销 |
| 既有来源结算 | 12/12，`source-activation-settlement-w48Xsz` |
| 既有Durable Pi | 6/6，`durable-runtime-pi-JSh9Jb`；真实Host／Pi／SQLite边界 |
| 既有分支存储 | 6/6，`session-branch-ovvIwh`；宿主存储／资源归属，后端预检使用该工作流原有受控端口 |
| 既有压缩权威 | 12/12，`harness-compaction-authority-Gtj0V3`；压缩后不重新灌入旧原文及journal重开 |
| 既有Pi运行时 | 13/13，`upgrade-0153-pi-runtime-HAlWHn`；使用本轮重建的生产bundle，覆盖模型切换、畸形参数、取消、重试、压缩及输出策略 |
| 相关旧测试 | 253通过／2跳过／0失败；18个文件、540项expect。跳过为现有script symlink containment和Windows不支持的恶意文件名场景；没有新增／修改单元测试 |
| 全仓类型 | `typecheck:all`通过，包含工具脚本项目 |
| 全仓lint | 通过：2,700文件、24项已登记warning；其余架构、RPC、分发和视觉契约门禁通过 |
| 文档 | `check:docs`通过：239份文档、1,833个相对链接 |
| 身份／版本／i18n | identity、version及4项i18n门禁通过；版本0.6.5、27处声明、13个workspace保持一致 |
| 生产构建 | `electron:build:main`通过，包含Pi bundle／launcher、拦截器、WhatsApp worker和Electron主进程；资源中的Pi bundle与dist哈希一致 |

新增两条流程已加入[critical registry](../../scripts/critical-scenarios.ts)，并提供 `bun run verify:upstream-bugfix`。所有新运行使用唯一目录；manifest包含源码身份、运行时、场景、退出码和产物SHA-256。最终机器汇总位于 `.cache/verification/upstream-bugfix-summary-xqDdXC/summary.json`，已逐一核验7条流程的815个产物；8个产品源码文件均与最终运行快照一致。未将同一场景的重复执行计为新增覆盖，没有执行全仓单元测试或完整critical suite。

以下为本轮最终运行的manifest SHA-256。完整目录前缀为 `.cache/verification/`；缓存原物不作长期归档，新运行不写入历史 `results/`。

| 运行 | manifest SHA-256 |
| --- | --- |
| `upstream-bugfix-core-3vDQVI` | `6d06c68a57ff830f6fa53c21673d8b47be9db0b3f7db593eceeb0ddc32de29a2` |
| `upstream-bugfix-pi-cBKQFf` | `24688bcab79ae21bf06c6db8a87e5079f2a903791ee9ed99313f6b357911bd1b` |
| `source-activation-settlement-w48Xsz` | `753ae3e1c7b88bb96826c096110e1abe749379b0f9c243a8689de6ae4d5ca627` |
| `durable-runtime-pi-JSh9Jb` | `8e703539b5bbad63469a00b00018bd9a394f9c229c107f1276f6957e551c0e9f` |
| `session-branch-ovvIwh` | `1d71c2340635d9fcf40d434dd96988d95f62f947cbbbfb2f8a32d032b68102ac` |
| `harness-compaction-authority-Gtj0V3` | `51fc1038249896662acb15471bd8d1f2180b2246734b9b4b48a32ee239d5afce` |
| `upgrade-0153-pi-runtime-HAlWHn` | `98486d967d28a86ab1023308d2c9334a5d7c473cf1296c9c722bbbc55e94ec7e` |

## 基线反证与过程中的失败

- 核心基线先观察到严格schema字段丢失、假秘密展开、二次替换、Webhook JSON失败、配置全拒绝、指令遗漏和同步Git阻塞。后续修正了夹具中“位于本仓库内的目录被误当作非仓库”的假设；保留失败产物。
- Pi夹具最初使用了上游旧的 `register_tools` 名称，不能证明本地工具同步行为。修正为本地强类型 `sync_tools` 后重新执行，没有把早先结果算作F06通过。
- Pi夹具另对初始HEAD的Pi源码副本运行。前6项全部失败，运行目录为 `upstream-bugfix-pi-IngPf1`，包括压缩未结束就发送下一请求、分支cutoff重开和无效anchor残留。修复版对应6项全部通过，证明实际经过了工具重建分支；后续增加的来源撤销场景另作反证。
- 扫描目录链接的场景本身通过，但初次产物收集在Windows递归遍历junction时出现ELOOP；夹具在验证后解除自己创建的链接，仍保留目标目录和扫描证据。没有修改产物验证器或降低门禁。
- 两项旧自动化断言暴露了 `reloadConfig.success` 的兼容差异。通过保留本地返回约定修复产品代码，未改断言。未知事件继续按原约定警告并忽略。
- 收口时沿工具预检继续复核，发现延后重建期间旧代理工具可能到达宿主自动来源启用路径。新增BF11真实调用后，在阻断补丁前观察到6项通过／该项失败；仅在工具包装器检查仍会被SDK原生 `tool_call` 钩子抢先发送宿主预检。最终在该钩子、包装器预检、调度后和执行前检查当前工具集合，7项全部通过，撤销调用没有进入宿主预检或执行。此项属于F06已批准的撤销边界，没有新增功能入口。
- 并行构建造成CPU负载时，150ms软扫描预算可正常截断后代目录。因此默认prompt断言保留root／cwd与作用域要求，后代发现单独使用足够预算验证；未改变产品预算。慢Git场景用“子进程完成前事件循环定时器已执行”证明异步行为，移除受机器负载影响的200ms调用耗时门槛，仍验证5秒超时。
- 首次全仓lint在RPC库存的行号快照处失败；重新生成并检查仅7个行号变化后重跑。未增加白名单、提高预算或绕过hook。
- 最终文档门禁发现同期侧栏提交的两份文档未从 `docs/README.md` 可达；仅补齐两个目录链接后重跑，不涉及侧栏产品代码。

完整缓存位于 `.cache/verification/`，命令日志和起始文件哈希位于 `.cache/upstream-bugfix-implementation-20261117/`。缓存路径不是可跨机器保证存在的仓库交付物；清理后需重新运行生成。

## 复现与范围

```powershell
bun run server:build:subprocess
bun run verify:upstream-bugfix
bun run scripts/verification/source-activation-settlement-workflow.ts
bun run scripts/verification/durable-runtime-pi-workflow.ts
bun run scripts/verification/session-branch-workflow.ts
bun run scripts/verification/harness-compaction-authority-workflow.ts
bun run scripts/verification/upgrade-0153-pi-runtime-workflow.ts
bun run typecheck:all
bun run lint
bun run check:docs
```

源码、依赖和版本范围保持评估时约定：不吸收新增功能和前端组件／交互；C01云盘启动、C02 macOS HEIC和Claude认证修复另议。`package.json`只增加验证脚本，版本仍为0.6.5，`bun.lock`未改。用户随后授权本地提交；未推送、发布或安装。

原有 `docs/verification/results/packaged-client-smoke-win.json` 更新保持原样。侧栏提交及未跟踪的 `analysis/` 属于其他工作，未编辑且不归为本轮成果。真实供应商账户、macOS／Linux运行、签名安装器和真实已安装客户端均未验收。
