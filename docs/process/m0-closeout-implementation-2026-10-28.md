# M0：0.5.x 收尾实施与验收

状态：accepted — 2026-10-29 完成本机 Windows 范围的 M0 收尾。本文保存验证时的 0.5.4 工作树快照；后续提交与版本变更以 Git 和发布说明为准。  
授权：用户于 2026-10-28 明确要求实施 M0。  
基线：`3cfe8a6bd1516f3fd26c6bdbf94ac186c6670805`；包版本 0.5.4，候选包含其后修复及本次未提交改动。  
依据：[阶段规划](governance-review-and-development-direction-2026-10-28.md)、[事先失败矩阵](../verification/m0-closeout-failure-matrix-2026-10-28.md)。

## 实施结果

| 范围 | 处理 | 保留的边界 |
| --- | --- | --- |
| 启动完整性检查 | Bootstrap 等待工作线程完成完整 `integrity_check`，主线程可以继续响应 | 不改成较弱的 quick_check；RPC/会话目录初始化仍等待健康检查与恢复；未增加磁盘上的健康缓存 |
| 启动反馈 | 主窗口前提供临时加载窗口，沿用 Default 配色与现有本地化 loading 文案；延迟显示避免快速启动闪烁 | 无 preload、Node 或 RPC 能力；主窗口创建后关闭；启动期间退出不把空窗口列表写回原恢复状态 |
| 后台维护 | 初次备份退出启动关键路径；备份和物理维护使用工作线程、每工作区合并同一进行中任务 | 继续原子发布、禁止覆盖、成功后才裁剪；保留事实和用量；关闭时取消并等待 worker 退出 |
| 共享 SQL | 同步管理 API 与 worker 使用同一自包含数据库操作函数 | 不复制第二套备份/维护协议，不添加数据库或依赖；打包无需额外源文件路径 |
| 取消结算 | SDK abort 先排空模型准备及已知结果回执，再清空剩余等待 | host 不可用时仍由既有期限/停止流程收尾；不把已派发请求的未知计量写为零 |
| 连接验证（10-29） | `mkdtemp` 创建独立一次性工作区，显式提供真实 workingDirectory；UUID 隔离凭据；清理前等待 Pi 退出并清除超时定时器 | 保留 OpenAI 兼容端点的真实 Pi 验证；不在用户 home 创建会话，不把运行时错误降为 HTTP 成功 |
| 取消部分文本 | SDK `stopReason=aborted` 的保留文本标为 intermediate | 不当作最终回答；已观察内容保留，终止标志及无后续派发继续验证 |
| 压缩阈值 | 在 JSON IPC 前使用已有校验拒绝非有限值，避免 NaN 与 null 比较相等 | 合法百分比、旧 Token 数值、相同值去重和 SDK 摘要预算保留 |
| 自定义端点预热 | 保护新请求显式预算，避免继承普通请求的 payload callback 后丢掉一 Token 上限 | 普通会话仍省略默认输出上限；显式内部预算与当前端点协议保留 |
| Source 验收 | 通过真实工具发现取得 source_test；按实际准备事件定位中断注入，不硬编码“第二个请求” | 并行激活、T2 排空、附件、纠正、混合客户端去重、停止及可见失败继续验证 |
| 中断验收 | 退出要求整会话阻断的旧断言；验证独立续做及精确动作阻断 | 未验证送达的文字不充当回执；显式 receipt 查询仍可证明并补记实际送达 |
| 验收目录 | usage fixture 按新 Session 工作目录契约创建隔离目录 | 不让初始化失败产生的空运行被当作计量成功 |
| 当前文档 | 对齐 README 的 0.5.4 / Pi 1.3.0；更新当前 Harness 合并状态；历史验收正文保留 | 不改写原 manifest、历史发布说明或宣称当前源码已经部署 |

工作线程执行的是内部封闭的 SQLite 操作，参数不来自任意用户 SQL。恢复仍保留原数据库；新建/校验失败的工作区隔离于健康工作区。损坏后的备份选择保留既有保守恢复路径。

## 主题覆盖裁定

依据已合入的 `faa7174aa` Default 单主题变更及当前实际工作流，而不是依据本次运行是否绿色调节下限：

| 工作流 | 已退役范围 | 当前适用范围与门槛 |
| --- | --- | --- |
| foundation | 14 个自定义主题/场景图 watcher 场景被 2 个用户文件保全/回退场景替代 | 其他 101 个场景保持；115 → 103 |
| contract | 3 个退役 palette × 4 宿主 × 2 模式 × parity/contrast，共 48 个组合 | 保留 Default、非法值、代码高亮和 P2；119 → 71，必需截图更名为实际 Default 输出 |
| domains | 3 个退役 palette × 2 模式 × 6 状态，共 36 个组合退出 | Default 状态、键盘、触摸、reflow/error 保留；56 → 20；loading skeleton 验证可访问 status |
| browser-host | 3 个退役 palette × 2 模式 × 2 宿主，共 12 个组合退出 | 保留非法值、场景失效和修复；23 → 11 |
| design | Ink light 的 14 个排版候选退出 | Default light/dark 各 14 个候选，共 28；门槛由旧 36 调整为当前完整 28，截图指向 Default |

其他主题专项的独立职责保持。旧模型表单入口已经转发到 `api-connection-setup`，critical 改用该真实入口、14 个场景及当前必需产物。日历跨月中文标题允许 SDK 的数字格式；按语言切换前后、恢复和导航逐次校验与实时库标题一致，替代固定要求“年”字的断言。旧 Pi 验收对普通自定义请求默认预算的断言已按当前策略更新；显式压缩预算仍严格校验。自动压缩在没有新历史时由 SDK 复用上次摘要、只发起 turn-prefix 请求，因此按实际摘要种类逐请求校验 50%/80% 原始预算，不要求每轮都重做历史摘要。

## 验证状态

固定使用仓库已有 `apps/electron/vendor/bun/bun.exe`，Bun 1.4.3；未替换全局 Bun。所有配置、provider、数据库及文件操作均使用隔离 fixture。

| 验证 | 最终结论 | 原始证据（`.cache/verification/` 下） |
| --- | --- | --- |
| `validate:ci` | 完整通过；包含全部类型检查、lint、i18n、文档、身份、版本和运行时 pin | `.cache/m0-validate-ci-final-2.log`；Session Foundation 为 `session-foundation-suite-e5E3GZ`，7 组 53 场景 |
| `test:critical` | 从头完整通过，67 个工作流、998 个场景及 6 个包级测试组 | `critical-PPB7jc` |
| Harness | 17 个工作流、173 个场景通过，包含连续性及任务恢复 | `.cache/m0-final-harness.log`；逐项目录保存在汇总文件 |
| 工作目录 / 备份 / 成果归属 | 7 + 6 + 9，共 22 场景通过 | `session-working-directory-pi-ZnNSQV`、`runtime-backup-retention-H7fhZS`、`session-artifacts-9QYJWg` |
| 中断与送达 | 23 场景通过 | `pi-interruption-recovery-PORMl8` |
| Source 激活 | 12 场景通过 | `source-activation-settlement-xyQ5nB` |
| 启动与维护 | 5 个真实 SQLite/worker 场景通过；结果及测量见下文 | `runtime-startup-jMp8aj` |
| 启动反馈 | 真实 Electron 中英文/深浅模式 2 场景通过，检查两张截图 | `startup-feedback-peAP1z` |
| Windows 构建及资源 | Electron 构建与目录打包通过，9 项静态检查通过 | `.cache/m0-final-electron-build.log`、`.cache/m0-package-static.json` |
| 实际 Windows 应用 | 32 场景通过：真实连接探测、权限与写文件、未知效果、成果接受、重连、草稿、停止、布局和异常退出 | `native-client-Ulx7DO` |
| 候选 Pi 工作目录 | 使用实际打包资源，7 场景通过 | `session-working-directory-pi-LpDnsq` |
| 候选连接验证 | 使用实际打包资源，成功、并发、鉴权失败、超时、缺失运行时 5 场景通过 | `connection-probe-TAGZRz` |
| 候选 API 接入 | 浏览器 → 真实 RPC handler → 打包 Pi/SDK → 配置保存，14 场景通过 | `api-connection-setup-NFJcTG` |
| 最后脚本门禁 | 脚本类型检查、工作区 lint 通过；`git diff --check` 无空白错误 | `.cache/m0-typecheck-scripts-accepted.log`、`.cache/m0-lint-workspace-accepted.log` |

用量账本的 16 个场景包含在完整 critical 内，成功、重试、预热、取消、压缩及未知/已知零费用均通过。不能将这些受控结果解读为真实模型任务质量或外部供应商可用性证明。

原生日用流程在默认日志模式运行；默认模式异常退出有实际非零退出码及原预算内退出证据。首个错误及 cause 的保留另以同一个候选的诊断模式复测；Electron 参数使用 `-- --debug`，避免被当成已停用的 Node `--debug` 开关。32 项包含两种模式，并没有修改应用的默认日志策略。

旧原生 fixture 还按全局 `drafts.json` 读取，并在切换工作区后访问原会话；现按 `sessions/<id>/draft.json` 验证落盘、跨工作区拒绝和切回后的 RPC/界面恢复。旧 Run 的可靠性折叠区与 Export facts 已退役，改验当前 Overview 诊断卡及原始 `getSessionDecisions().reliability` 的 tool/model 分类、未知操作 ID 和 `userAcceptance=unknown`。不恢复旧 UI，也不把记录事实当作成果接受。

所有中途失败的唯一运行目录仍保留。最终汇总是 `.cache/m0-final-evidence.json`，包含成功步骤、失败尝试、源码 SHA 与构建 SHA。期间最后修改仅涉及原生 fixture 对现行契约和日志模式的适配；这 16 个生产改动文件在完整 critical、最终构建及原生验收之间 SHA 一致。未将不同生产版本的绿色结果相加。

## 候选身份

验证时的候选目录：`apps/electron/release/win-unpacked/`，Windows x64，版本声明为 0.5.4。该目录可被后续打包更新；本表保留当次文件身份。完整 renderer/resource 哈希清单见原生运行中的 `build-hashes.json`；以下为本次实际运行文件的 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `Phaneris.exe` | `af22fcc52f0b7f4e5d648e226574a8632a99ebc18eae23ae3290c817f72b8ab1` |
| `resources/app/dist/main.cjs` | `c24653e99f8f4324b9fc852834afdbfa7da261e1fcb452ac85c836c47e30a3e1` |
| `resources/pi-agent-server/bundle.js` | `b7f248f545cd2a583423cbfdfb69539a4a70cad18e2e9c9aa8153996b191d9cd` |
| `resources/app/vendor/bun/bun.exe` | `095db4abae203d42f29fdec26da4a882fcde6333cdd84e40c0c7828c0cf543f6` |

## 性能口径与发行边界

本次解决完整扫描与备份占住主线程，以及同步维护阻挡工作区初始化的问题。完整扫描仍消耗 I/O 和时间；没有声称消除大库检查成本或已解决历史白屏的全部触发原因。

`runtime-startup` 使用同一隔离数据库（64 MiB fixture payload，实际文件 68,276,224 字节），对比旧同步检查/维护与异步重开。同步完整检查 39.97 ms、同步维护 221.63 ms，合计 261.60 ms；首次进程重开就绪 88.86 ms（11 次主线程心跳），暖重开 87.26 ms（14 次心跳），后台备份期间 61 次心跳。数字来自 `runtime-startup-jMp8aj/startup.json` 的单次同机样本，不给出总体提升百分比。first-reopen/warm-reopen 不代表操作系统缓存被清空；并发验收时的数字不用于宣称性能提升。没有扫描、迁移或改写个人生产数据库。

范围为本机 Windows 桌面候选。真实外部 provider/OAuth、签名安装器、其他操作系统和 Windows 不支持的 standalone server 分发不在此次放行结论内。候选验证不替换已安装应用，不创建 tag、不推送远端。

## 非阻断发现与收口

Run Overview 现有 “Settled / unsettled model requests” 文案不精确：当前显示的是 Runtime terminal 计数及工具/模型未结算总数，原始 RPC 的 `toolCount` / `modelCount` 分类正确。依据为 `RunOverview.tsx` 与 `observability/reliability-report.ts`；后续可针对实际字段更名或拆分。本轮未扩展 Run 界面改造，此问题不影响连接、文件归属、原始事实保全或重复副作用保护。

M0 的本地候选退出条件已满足；不继续扩大治理范围。M1–M3 仍为提案，尚未开始。日常证据留在忽略的 `.cache/`，不覆盖已跟踪的历史归档。
