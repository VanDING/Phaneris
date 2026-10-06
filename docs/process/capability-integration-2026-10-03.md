# 升级能力整合实施记录

日期：2026-10-03。授权：用户批准完整实施前一轮规划。基线：`69938ce0`；Pi SDK 1.0.0，Phaneris 0.2.4。默认单任务推进。

本记录描述第一轮机制批次，不能作为原计划全部完成的证明。完整性复核发现 renderer 回执、复杂 Markdown、MCP HTTP transport 及收益 / 业务验收缺口；修正与最终检查见 [2026-10-04 闭合记录](./capability-completion-2026-10-04.md)。下表与性能样本保持当时口径，最新结论以闭合记录为准。

## 范围和执行顺序

| 批次 | 范围 | 状态 |
|---|---|---|
| A | 输入接收确认、模型元数据与目录、过期补丁、性能基线 | 已实现并验证 |
| B | 完整工具契约、按需发现、受管 codemode、嵌套执行与恢复 | 已实现并验证 |
| C | 决策辅助请求记账、效果报告、Pi classifier 对照、运行中规则与自动化状态 | 已实现并验证；默认适配器保留 |
| D | Markdown Artifact 编辑、模型图像限制与恢复、生图 provider、工作台性能 | 已实现并验证；真实 provider 与发布环境有明确未验证范围 |
| E | 原生 MCP / 路由 / 更多任务节点的对照与是否迁移结论 | 已评估；保留现有所有权及执行语义，按条件暂缓迁移 |

## 修改产品代码前确定的失败路径

| 领域 | 失败路径与验收 |
|---|---|
| 输入 | stdout 写入成功误报 SDK 接收；无 session / 异常 / 取消不确认；等待 prompt 完成才 ACK；迟到 ACK 跨轮；合并丢原文或身份；压缩/handoff 期间重放重复。接收先入 Durable，SDK 状态显式区分 started/queued/handled/rejected，确认有界且可关联。 |
| 模型 | 旧补丁覆盖 SDK 新字段；chat/image/classifier 混用；手动目录因刷新失败丢失；不同连接覆盖同名模型；图像限制/缓存寿命被丢弃。离线目录可用，刷新受宿主控制。 |
| 工具 | outputSchema / structuredContent / content blocks 丢失；不可信 annotations 提权；撤销 source 后 deferred 工具仍可执行；schema 改动失配；大结果先被摘要导致脚本失去完整数据。保留结构化值与可定位的原始产物，每次调用重新检查授权。 |
| 编排 | 嵌套调用缺 T1/T2、parent 或 ordinal；预取绕过权限；部分成功后重放整脚本；取消留下运行调用；store 跨分支污染；工具声明或指导没有进入实际 provider prompt。首批关闭 codemode models，每个外部效果独立归属。 |
| 决策 | noul/bool 概率映射错误；缺价格被当成免费；辅助 token 重复或漏账；取消/失败被记零费用；新适配不支持 Laya/custom；既定 Guarded 失败策略被改变。保持 opt-in 和显式用户偏好，效果报告纳入 outcome/follow-up。 |
| 治理 | 旧 AgentEvent 匹配被显示为执行；新规则是第二套授权；拦截发生在副作用后；无进展误伤正常轮询；预算遗漏辅助请求。确定性阻断先于执行，明确 unsupported 状态。 |
| 文档 | 富文本往返丢失表格/公式/Mermaid/图片/注释；中文 IME/撤销失效；外部修改被覆盖；保存失败丢草稿。不能无损编辑的内容保留源码入口，继续使用 Artifact revision / CAS。 |
| 图像 | 新编码覆写原图；切换 provider 后旧限制继续使用；历史图像自动改写原始证据；生成数据未验证就接受；费用重复入账。保留原始文件和历史事实，恢复显式且可审计。 |
| 性能/发布 | 调高体积预算掩盖超标；首屏拆包后打开功能失败；lazy 只分文件却仍 preload；历史加载与实时消息重复；产物版本与声明漂移。使用真实生产产物、既有门禁与可重复 E2E。 |

## 验证契约

- 修改前先建立端到端验收及记录失败方式；不在实现之后补写镜像单测。
- 每批输出可复核 JSON/截图/文件产物，注明源码版本与被测构建。
- 完成率按预定验收通过任务 / 全部纳入评测任务计算；取消单列。
- 成本包含失败、重试、决策、摘要、缓存与图像；缺失价格为 unknown。
- 真实 provider、签名、安装更新和目标平台未实际运行时，不标为通过。
- 默认开关和凭据不因升级被修改；条件式迁移以对照结果决定。

## 实施结果

实施延续至 2026-10-04。分支：`codex/capability-integration-20261003`。源码仍在工作树，未发布。实现与配置详见 [能力采用指南](../architecture/capability-adoption-2026-10.md)。

| 验收 | 结果 / 证据 |
|---|---|
| SDK 与工具 | 8/8：拒绝无 session 输入、SDK 接收前置 ACK、steer 队列、结构化 MCP / nested T1/T2、元数据、权限拒绝、来源撤销、未知效果恢复和取消；workflows.json |
| 决策与规则 | 3/3：成功及失败请求入账、unknown 费用、outcome/follow-up、确定性规则、unsupported AgentEvent；decision-governance.json |
| classifier 对照 | 2/2：支持的契约一致，不支持的契约在请求前拒绝；classifier-comparison.json。保持默认适配器 |
| Task 治理 | 3/3：相同失败循环终止、辅助 token 只计一次、重启延续预算并排除运行前历史；task-governance.json。使用确定性会话驱动和真实运行日志，不冒充真实模型任务 |
| 图像 | 5/5：本地原生 provider、格式与参数检查、模型投影保留原图、显式历史恢复、付费用量与取消、Artifact 接受边界；images.json |
| Artifact 浏览器 | 4/4：可视化与撤销、复杂源码保留、中文草稿保存/提交/接受、checkout 与最终源文件冲突；markdown-editor.json / markdown-editor.png |
| 条件式采用 | 2/2：原生分支 store 恢复、models 关闭、指定 provider 离线刷新、原生 MCP 配置契约核对；adoption-audit.json。迁移性能未测量，不宣称收益 |
| 统一复核 | `bun run verify:capabilities`，8 个 stage 均通过；summary.json 包含工作树与被测 Pi bundle 哈希 |
| 既有门禁 | 全工作区测试通过；CI 验证包括类型、Lint、文档工具、i18n、身份、版本、runtime 与 Electron pin |
| 生产构建 | Electron 主进程 / preload / renderer / assets、WebUI、Viewer；体积预算与资源检查 |
| Windows 打包 | 解包结构、隔离启动及仓库外 Pi 子进程 workflow；结果写入 docs/verification/results 与 packaged-sdk-workflows.json |

分项 JSON、构建与检查日志位于 `.cache/capability-integration/`；缓存不加入版本库。截图和 fixture 留作本机复核。隔离配置目录与回环服务没有使用用户真实连接或凭据。

## 性能证据

首屏按 `bundle-report.ts` 的 index.html 初始 JS 引用口径比较：基线 **4,967,600 B**，拆分 Markdown 编辑器后 **4,266,097 B**，减少约 **14.1%**。预算仍为 4,800,000 B；不是通过放宽门槛消除超标。报告脚本历史上把 MiB 标作 MB，字节数作为这里的权威口径。

生产 WebUI 性能 harness 通过：100 / 1,000 / 5,000 条消息冷加载约 262 / 486 / 1,092 ms；24 个会话、60 秒真实空闲与加速回收、每秒 50 个增量、JSONL 屏障、SQLite 事务与备份、Pi 离线初始化。详见 performance.json，包含机器信息、构建哈希和 dirty 标识。这些是本机样本，不是跨机器承诺；新增成本标签之后的构建哈希与本次性能样本可能不同，不据此声称标签本身的性能收益。

另执行 25,000 条消息的 Session I/O 基准，记录 delta / JSONL / 同步读取时间和原始字节数，详见 session-io.log；不作为工作台响应时间的替代测量。

## 验证发现与修正

- 保留 SDK 上下文的属性描述符，解决 lazy tools / executeTool 丢失，同时维持普通字段兼容。
- 先释放权限等待再等待 SDK abort；取消在途代理调用保留未知效果，避免阻塞和伪造结果。
- 生图验证失败保留 provider 已披露的用量；取消写入 aborted；缺价不当作免费。
- 外部 checkout 修改后，获取新编辑 lease 时快照最新 revision，修复退出再编辑仍冲突的问题。
- 新增五个界面文案补齐全部七种语言，既有 i18n 门禁通过。
- electron-builder 会过滤嵌套 node_modules，WASM 与 package.json 改为显式资源项；仓库内打包运行可能借用祖先依赖，新增仓库外复制验证排除这种假通过。
- 最终复核曾出现既有 `transport.test.ts` 的握手关闭码断言偶发失败：协议错误先发布 `failed`，WebSocket 关闭事件随后补充 `lastClose`，测试只等待前者。单独复跑 42/42 通过，原失败日志保留在 tests-final-source.log；未修改 transport 实现或测试，最终全工作区复跑记录在 tests-verified.log。

## 未验证范围

真实付费 provider、OAuth、签名、安装 / 更新、macOS/Linux 打包运行、WhatsApp Docker/真实消息链路、实际操作系统 IME 均未据本次本地验证标为通过。原生 MCP / Radius / 更多 Task 控制结构没有被启用，也没有迁移性能或真实费用比较。它们按规划的条件门槛暂缓，具体原因和退出条件在采用指南中记录。
