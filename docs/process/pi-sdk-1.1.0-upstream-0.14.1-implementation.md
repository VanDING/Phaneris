# Pi SDK 1.1.0 / Craft 0.14.1 实施记录

状态：**B0–B5 实施与 Windows 验收完成**；性能结论限于本次同盘 smoke，初测失败与波动记录保留。记录日期：2026-10-09（Asia/Shanghai）。范围沿用[批准的计划](./pi-sdk-1.1.0-upstream-0.14.1-plan.md)与[实施前失败矩阵](./pi-110-implementation-failure-matrix.md)。

## 交付范围

Pi 的九个 `pi-*` 包与 `chord` 统一固定为 **1.1.0**，选择性吸收 Craft **0.14.0 → 0.14.1**。产品版本仍为 **0.3.0**，Bun 1.4.2、Electron 44.5.1 和 Python 3.12.15 的固定版本保持不变。

实施分支为 `codex/pi-110-upstream-0141`，工作树为 `C:\Users\dotty\.codex\worktrees\pi-110-upstream-0141\Phaneris`；基线是 `351f592c3f0614bb9ad9e6244210d58b63f5db67`。原仓库 `E:\Phaneris` 的主线和用户未提交源码未被整合或覆盖；为测量真实升级前基线，仅重建了原仓库中被忽略的 Web UI 与 Pi bundle。

[最终机器记录](../verification/results/pi-110-final-verification.json)保存验收源码提交 `84639944916012b20c1ca69eb445abca24fa0e4f`、改动源码 SHA-256、18 个整合工作流、实际 SDK 版本、命令退出码与日志哈希、性能原始结果和最终包资源哈希。后续文档提交不改变这份已测试的产品代码。

本地未签名安装包为 `C:\Users\dotty\.codex\worktrees\pi-110-upstream-0141\Phaneris\apps\electron\release\Phaneris-0.3.0-win-x64.exe`，大小 186,267,924 B，SHA-256：`371c59be4d7cb042018263dbad54d956131b3fc2b1455c138b6b59254adf5145`。解包客户端位于同级 `win-unpacked`；包结构与 UI 均基于这份最终构建。

| 批次 | 已交付行为 | 主要证据 |
| --- | --- | --- |
| B0 | 首轮请求等待完整子进程初始化与工具同步；并发启动共用 promise；退出、销毁和超时结束等待 | [随包启动竞态 4/4](../verification/results/pi-110-startup-packaged.json) |
| B1 | 全家族精确版本；Azure provider 边界兼容；取消状态和 SDK 时长；OAuth 刷新在宿主 Vault 确认后提交；受管工具与 codemode 资源 | [兼容 3/3](../verification/results/pi-110-compatibility-final.json)、[Azure 1/1](../verification/results/pi-110-azure-final.json)、[仓库外随包运行时 8/8](../verification/results/pi-110-native-capabilities-packaged.json) |
| B2 | 认证重试复用决策和 hint；按连接、endpoint、model 隔离冷启动；认证统计 RPC；设置页显示每功能统计 | [决策整合 8/8](../verification/results/pi-110-decisions-final.json)、[既有决策 46/46](../verification/results/pi-110-decision-features.json) |
| B3 | 自适应思考参考上一条最终回复尾部和附件元信息；纠正请求不降档；重大动作设降档下限；取消及用户档位优先 | 同一[决策整合报告](../verification/results/pi-110-decisions-final.json)，包含上下文预算、缺 guard 与迟到结果验证 |
| B4 | 工具意图贯通；全结果分块摘取；完整原文先保存；全链路取消和降级；准确记录原文访问尝试 | [宿主 pool 8/8](../verification/results/upstream-0141-large-results-b4.json)、[真实子进程桥接 8/8](../verification/results/upstream-0141-large-results-b4-child.json) |
| B5 | 全仓门禁、历史恢复、Windows 最终包、包外资源、UI、同盘性能与可复核产物 | 下文验收表、性能对照与复现入口 |

Runtime Host / Durable Runtime 继续拥有输入、权限、T1/T2、Source 和用量事实。开关与用户已保存的选择保持有效，未默认开启决策辅助，也未用 SDK session 累计统计重复计费。

## Craft 采用结果

| 计划项 | 最终处理 |
| --- | --- |
| U1 调用意图 | 通过 toolCallId 关联 metadata；嵌入 API 只向声明了 `declared_intent` 的 schema 补参；外部 MCP 参数保持其声明契约 |
| U2 大结果摘取 | 完整结果有界分块、原顺序摘录与缺口提示；原文文件与完整 structuredContent 保留；缺答案、批次失败、几乎全部相关或没有有效裁剪时降级 |
| U3 认证重试 | 同一个 Durable 输入复用思考决定和 suggestion hint，不增加决策请求 |
| U4 冷启动 | 256 项有界 LRU，闲置 30 秒重新判冷；默认冷预算 2,800 ms，显式 deadline 与前台硬上限优先 |
| U5 上下文思考 | 当前消息 4,000 字符、上条最终回复尾部 1,200 字符、最多 16 项附件元信息，每项 256 字符；不发送附件正文 |
| U6 功能统计 | 读取本服务器最近 7 天保留日志及轮转文件；去重 outcome，分列取消、cold、已知费用和费用未知；只展示观察结果，不自动停用功能 |
| U7 Guarded | 保留本仓确认/阻断策略；空答案、异常、超时和缺检查仍不能直接放行 |
| U8 后台排除 | hidden 与无人值守任务仍不进入前台思考评级 |
| U9 侧栏长名称 | 展开态提供完整名称提示；验收另发现嵌套 grid 被长名称撑开，补单列 `minmax(0, 1fr)` 约束以恢复省略号 |
| U10 上游身份/发行 | 未迁入上游品牌、Claude 专属后台、版本号或整版 lock；仅更新本仓待发布说明与所选功能的七种语言 |

大结果最多处理 400,000 字符，长单行分为 12,000 字符片段；每批最多 64 个问题 / 60,000 字符、并发 8、总辅助调用最多 16 次，整个过滤操作从 client 解析前起受 6 秒 deadline 约束。输出预算包括标题、缺口说明和原文路径。实测夹具原文 **102,726 字符**、摘录输出 **412 字符**，保留末尾证据，原文 SHA-256 为 `0d763a083072b4a940b2930286f7edc80ccc096c113935d23d25bd00fa70a75a`。这是合成材料的契约结果，不代表真实模型的压缩率或质量收益。

“原文访问尝试”要求准确文件路径关联；它不是阅读成功或信息完整的证明。辅助 provider 可能收到有界结果分块，七种语言的隐私说明已如实更新。

## 验收与恢复记录

| 范围 | 结果 | 限定 |
| --- | --- | --- |
| 旧会话恢复、指定 cutoff 分支、手动压缩后重启 | [3/3](../verification/results/pi-110-history-final.json) | 真实 Pi 1.0.2 写入的 journal，由 1.1.0 读取；父会话哈希保持，6 个模型 T1 对应 6 个 T2；provider 为回环夹具 |
| 停止打开的问题 | [修复前失败](../verification/results/pi-110-ask-user-stop-before.json)、[修复后 1/1](../verification/results/pi-110-ask-user-stop-after.json)、[随包子进程 1/1](../verification/results/pi-110-ask-user-stop-packaged.json) | B4 取消 guard 曾丢弃已完成的纯问题 dismissal；仅允许本代活跃子进程接收该取消结果，外部副作用取消仍保持未知 |
| 既有宿主生命周期 | [20/20](../verification/results/pi-110-upstream-0140-regression.json) | 继续覆盖先前 Craft 0.14.0 接入契约 |
| 决策治理 | [3/3](../verification/results/pi-110-decision-governance.json) | 用量、任务预算与 guard 边界 |
| 原生 MCP 对照 | [5/5](../verification/results/pi-110-native-mcp-source.json) | 回环 HTTP、结构化结果、8 并发请求和撤销；不等同全面迁移 |
| 图像能力 | [5/5](../verification/results/pi-110-images.json) | 离线请求副本、模型限制、历史图像恢复与取消 |
| 全仓类型、lint、i18n、文档、身份、版本与 runtime pins | 全部通过 | lint 保留 119 条既有 warning，零 error；身份扫描保留已分类的上游兼容项 |
| 全 workspace 与 isolated 回归 | 6,289 pass、0 fail | 使用独立配置，避免真实用户决策 provider 干扰夹具；平台条件跳过项保留原口径 |
| Windows 包结构、启动、设置和 Files | [10/10 结构](../verification/results/pi-110-packaged-client-verification-win.json)、[5/5 启动](../verification/results/pi-110-packaged-client-smoke-win.json)、[7/7 设置](../verification/results/pi-110-packaged-ui-final.json)、[5/5 Files](../verification/results/pi-110-files-packaged.json) | 最终本地未签名 x64 构建；未安装到用户系统 |
| 性能 | 最终同盘两版均 7/7 预算通过；初测失败保留 | 生产 Web UI + RPC + SessionManager，合成负载；不等同真实 provider 推理性能或稳定 3 秒保证 |

本轮首次 `validate:full` 在文档工具阶段因工作树缺少固定的 uv 失败。网络下载 checksum 端点出现 TLS 故障后，从原仓库复制**同版本、同 SHA-256** 的 Bun/uv，未改 pin 或跳过资源准备；[复制来源与哈希](../verification/results/pi-110-runtime-copy-provenance.json)保留。随后文档工具 **24/24** 与 table **4/4** 通过。

全仓复核也修正了四类既有测试夹具：RPC 快照纳入 `decisions:getUsage`；branch rollback 的部分 mock 保留真实 config exports；路径安全检查使用实际 `CONFIG_DIR`；Windows 的两个 transform-data 用例断言没有隔离后端时拒绝执行。后三项已用升级前源码复核或隔离执行，未放宽生产权限，也未补一个不受隔离的 Windows 执行路径。新的故障场景沿用实施前失败矩阵，新增验证以 E2E 为主。

启动竞态的故障注入包含销毁正在写入的子进程，因此日志保留故意触发的 `EPIPE`；4 项断言均通过。最终客户端 smoke 的 fatal-output 检查独立执行，不将注入日志当成客户端启动结果。

最终包的 Pi bundle、入口、worker、WASM 和运行时 package metadata 均与仓库外已执行 8/8 的那份资源逐文件同哈希，见[运行时身份对照](../verification/results/pi-110-tested-runtime-identity.json)。设置页截图来自该最终包：[英文宽窗口/浅色](../verification/results/pi-110-ui/decisions-en-light-wide.png)、[中文窄窗口/深色](../verification/results/pi-110-ui/decisions-zh-dark-narrow.png)。

## 性能对照

重新构建了升级前、后各自的生产 Web UI 与 Pi bundle，随后串行执行同一个 smoke 负载：6 个会话，消息规模 20 / 100 / 500，2 次 warm 重复、30 个流式增量、3 秒 soak。此负载不提供 5,000 消息或长期运行保证。

| 对照 | 首次导航 ms | 第二次导航 ms | 运行结果 |
| --- | ---: | ---: | --- |
| [升级前 0.3.0 / Pi 1.0.2，E 盘](../verification/results/pi-110-performance-baseline-fresh.json) | 4,137.53 | 2,760.75 | exit 1：navigation 超 3,000 ms，其余六项预算通过 |
| [升级后 0.3.0 / Pi 1.1.0，C 盘](../verification/results/pi-110-performance-upgraded.json) | 5,045.39 | 3,543.03 | exit 1：navigation 超 3,000 ms，其余六项预算通过 |
| [升级前启动诊断复测](../verification/results/pi-110-performance-baseline-startup-repeat.json) | 3,314.44 | 3,087.93 | 只采集启动诊断，含 profiler；不算性能验收通过 |
| [升级后启动诊断复测](../verification/results/pi-110-performance-upgraded-startup-repeat.json) | 5,401.53 | 2,865.19 | 同一诊断口径；不算性能验收通过 |
| [同盘新建的升级前基线](../verification/results/pi-110-performance-baseline-matched.json) | 2,137.89 | 1,116.63 | exit 0：全部七项预算通过 |
| [同盘升级版最终复测](../verification/results/pi-110-performance-upgraded-matched.json) | 1,661.65 | 1,033.10 | exit 0：全部七项预算通过 |

最终同盘对照使用 `C:\Users\dotty\.codex\worktrees\pi-110-perf-baseline\Phaneris` 的干净 `351f592c` 基线，[十个包均核实为 1.0.2](../verification/results/pi-110-matched-baseline-sdk-versions.json)，以及已提交的升级版；两者分别冻结安装并重建，串行执行同一负载。本轮末次首次导航达到 3,000 ms 预算，但早期结果仍显示明显波动，**不能把它推广成稳定 3 秒保证、收益比例或因果改善结论**。跨盘、缓存、时序与后台负载的影响没有逐项量化。

末次采样升级版 renderer heap 为 85,591,948 B、backend RSS 为 146,939,904 B，分别低于 256 MiB / 1 GiB 的局部门槛；它们是采样值，不是 peak 或 retained heap。第二个工作树仅用于验证，源码保持基线；复现对照时使用这两个 C 盘工作树的 `--smoke --skip-build` 入口。

| 实施提交 | 内容 |
| --- | --- |
| `722a2c0f` | B0 完整启动与工具同步 |
| `199dc84d` | B1 SDK 1.1.0 与兼容适配 |
| `719942ba` | B2 决策去重、冷启动与统计 |
| `ac4c4f57` | B3 上下文与思考策略 |
| `6f99091b` | B4 意图与完整大结果摘取 |
| `7464cb55` | 停止时纯问题 dismissal 回归修复 |
| `387366f3` | 长侧栏名称的网格约束与真实包 E2E |
| `84639944` | 历史 journal 验证与旧夹具修正 |

## 复现入口

先进入实施工作树。完整门禁使用独立配置：

```powershell
$verificationProfile = Join-Path (Get-Location) '.cache/pi-110-recheck-profile'
New-Item -ItemType Directory -Path $verificationProfile -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path $verificationProfile 'config.json'), '{"decisionLayer":{"enabled":false}}', [System.Text.UTF8Encoding]::new($false))
$env:PHANERIS_CONFIG_DIR = $verificationProfile
bun install --frozen-lockfile
bun run validate:full
```

构建与最终客户端检查：

```powershell
bun run server:build:subprocess
bun run electron:build
bun run webui:build
bun run viewer:build
Set-Location apps/electron
bun run electron-builder --config electron-builder.yml --win --x64 --publish never
Set-Location ../..
node scripts/verification/packaged-client-verification.mjs
node scripts/verification/packaged-client-smoke.mjs --grace=30000
bun run scripts/verification/pi-110-packaged-workflow.ts --output=.cache/pi-110-recheck-ui
```

客户端脚本应串行运行；smoke 会清理其指定包目录内的进程，不能与同一包的 UI E2E 并发。通用结构/smoke 脚本会更新通用结果文件，本轮已把新结果另存为 `pi-110-*` 并保留历史原件。

使用随包 Bun、将子进程资源复制到仓库外：

```powershell
$env:PHANERIS_VERIFY_PI_ENTRY = Join-Path (Get-Location) 'apps/electron/release/win-unpacked/resources/pi-agent-server/index.js'
$env:PHANERIS_VERIFY_PI_BUN = Join-Path (Get-Location) 'apps/electron/release/win-unpacked/resources/app/vendor/bun/bun.exe'
bun run scripts/verification/capability-integration-workflows.ts .cache/pi-110-recheck-native.json
bun run scripts/verification/pi-110-ask-user-workflow.ts .cache/pi-110-recheck-stop.json
bun run scripts/verification/pi-110-startup-workflow.ts .cache/pi-110-recheck-startup.json
```

[历史验证脚本](../../scripts/verification/pi-110-history-workflow.ts)的 `--baseline-entry=` 必须指向由 `351f592c` / Pi 1.0.2 构建并核实版本的旧 bundle，不能把当前 1.1.0 bundle 当成升级前基线。性能入口是 `scripts/performance/run.ts`，升级前、后使用相同 profile；`--skip-build` 只在已分别重建对应源码产物时使用。

## 边界与后续

- 原生 classifier 默认替换、原生 MCP 全面迁移、Radius / virtual-model 默认路由及大文件拆分继续后置，沿用批准计划的等价性和恢复条件。
- Linux/macOS、真实 Azure/OpenRouter/Anthropic 等 provider、真实 OAuth 网络刷新、模型质量/费用收益和 Windows 临时图像 ACL 未验证。回环 credential store + Vault 验证证明本地保存契约，不能替代这些平台与服务结论。
- Windows `transform_data` / 脚本工具在没有受支持的文件与网络隔离后端时仍拒绝执行；这是升级前已有行为。
- 原工作区的三个验证脚本 WIP 被用于整合验收，但保留原样并排除在本轮提交之外：`files-panel-packaged-workflow.ts`、`packaged-client-verification.mjs`、`ui-refinement-workflow.mjs`。
- 本轮没有合并主线、推送、创建 PR、安装或发布。整合时保留原 pre-push 的完整校验，不使用 `--no-verify`；SDK 回退须同步整个版本图、桥接适配与资源，不改写已保存的输入、原文和账本。

此前[交接文档](./pi-sdk-1.1.0-upstream-0.14.1-handoff.md)保留 2026-10-08 的历史检查点，不作为当前状态。
