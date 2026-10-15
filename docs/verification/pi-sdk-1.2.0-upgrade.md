# Pi SDK 1.2.0 升级与验证

日期：2026-10-14（Asia/Shanghai）。升级前基线：`323fa0296d0e8b11cd004e60bb80977e46d544dd`，Phaneris 0.3.2 / Pi 1.1.0。范围：内核 SDK、必要兼容适配、构建和回归验证。

官方依据：[Pi v1.2.0 发布说明](https://github.com/earendil-works/pi/releases/tag/v1.2.0)。

## 实施前失败矩阵

以下故障条件先于依赖升级和生产代码改动记录；新验证使用真实 SDK、真实子进程、隔离配置和回环推理服务。

| 编号 | 失败条件 | 验收方法 |
| --- | --- | --- |
| P120-01 | workspace 声明、锁文件或已安装的 Pi 包混用版本；已移除的 `chord` / experimental 包仍进入版本图 | 完整包图核对、冻结安装、生产 bundle 构建 |
| P120-02 | `before_agent_start` 新的 user/custom 联合类型导致提示丢失；工具后请求重置 forced prompt | 全仓类型检查、既有真实 SDK system-prompt 回归、真实 codemode 回环工作流 |
| P120-03 | 启动阶段忙碌状态变化造成重复 session、输入丢失或取消无法收敛 | 既有 startup / pi-control JSONL 工作流 |
| P120-04 | SDK 工具 reachability 元数据在包装时丢失；codemode worker / WASM 不可解析；嵌套调用绕过宿主权限或 T1/T2 | 源码兼容核对、包外真实 codemode 工作流、拒绝和取消场景 |
| P120-05 | 真实 Pi 1.1.0 journal 在 1.2.0 恢复时丢失历史、换 session；分支越过 cutoff 或改写父会话；压缩后重启丢失摘要 | 升级前构建与哈希绑定，真实旧 journal → 新 SDK 的恢复 / 分支 / 压缩 E2E |
| P120-06 | Azure 旧 provider 身份变更；OAuth 刷新取消导致 Vault 丢失凭据；模型 / usage / context 契约退化 | 既有 provider / credential / accounting 回归、独立 Host + Pi + SQLite 工作流 |
| P120-07 | 类型、lint、i18n、文档、身份、版本、runtime 固定值或既有测试发生回归；报告没有源码和产物身份 | 仓库校验、验证 manifest、日志退出码与 SHA-256 |
| P120-08 | 已移除的 MCP schema helper 仍被引用；结果声明丢失 `content` / `isError` 或局部 `$ref` 指向错误根；数组、`null`、`false`、`0`、空字符串被桥接丢弃 | 先扩展真实 JSONL/codemode E2E，再修改桥接；检查完整结果与声明类型 |

## 兼容边界

- Phaneris 的 `before_agent_start` handler 不读取 `event.prompt`，会为 user/custom 两类启动都返回当前宿主提示；不增加只处理 user 的条件。
- Source/MCP 连接由宿主持有，SDK 不自动发现 extensions、themes 或 context files。此次发布的 theme schema 路径和原生 MCP CLI resource 显示变化不改变现有宿主协议。
- 原生 orchestration tool 的包装保留 SDK 工具定义。升级需验证新增的 `reachesTools` 元数据和 codemode 嵌套调用。
- SDK 移除的 experimental server/client/plugin 与 `chord` 不属于 Phaneris 的运行入口；以实际发布的七个 `pi-*` 包验证版本图。
- Pi 1.2.0 移除了 `pi-codemode/declarations` 的 `mcpStructuredContentSchema` 导出。宿主工具改用本地完整 MCP envelope schema，嵌套原始 output schema 时重定位局部 `$ref`，声明直接包含 `content` / `structuredContent` / `isError`。无 output schema 的结构化值声明为 unknown。
- 结构化值从 JSONL 到 codemode 的桥接使用 `!== undefined` 判定，保留数组、`null`、`false`、`0` 和空字符串。此验收覆盖宿主结果桥接；外部 MCP 连接继续使用现有 MCP SDK，本轮未迁移协议栈。

## 执行结果

SDK 升级、兼容适配与 Windows 本地验证完成。Phaneris 产品版本保持 0.3.2，Bun / Electron / Python 固定值不变。七个 Pi 包均为 1.2.0；锁文件的完整性摘要与官方 npm registry 一致，已移除上游不再需要的 `chord`。

| 验证范围 | 结果 |
| --- | --- |
| 版本图、真实 1.1.0 journal 恢复、cutoff 分支、父会话完整性、压缩后重启、宿主提示和模型 T1/T2 | 6/6；[可复现脚本](../../scripts/verification/pi-120-upgrade-workflow.ts) |
| 包外 codemode、局部 schema 引用、六种 JSON 值、嵌套权限、撤销、取消、未知副作用恢复 | 10/10；[回环工作流](../../scripts/verification/capability-integration-workflows.ts) |
| JSONL 初始化、并发 ready、模型切换、steer、真实流取消、父 pipe 关闭 | 9/9；[控制工作流](../../scripts/verification/pi-control-workflow.ts) |
| 独立 Host + Pi + SQLite、真实 read 工具、两轮结算、usage、上下文和关闭 | 6/6；[独立运行工作流](../../scripts/verification/durable-runtime-pi-workflow.ts) |
| 启动竞态 / 打开的问题停止 | 4/4 + 1/1；既有工作流，实际运行版本为 1.2.0 |
| 全仓类型、lint、i18n、文档、字体、身份、版本、Python/Bun/Electron pins | 通过；lint 零 error、72 条已登记 warning |
| Electron main / preload / renderer、Web UI、Viewer 生产构建；桌面资源验证 | 五项构建通过；13 个桌面资源产物通过验证 |
| 文档工具 / table | 24/24 + 4/4；uv 使用仓库已有固定版本，仅补入本次进程 PATH |
| 全 workspace + isolated 回归 | 首轮 6,299 pass、2 fail、7 skip，另有 HTTP 超时后的 1 个 error；失败复核见下文 |

实际命令、源码 / lock / runtime 身份、验证场景、日志 SHA-256、初次失败与复核结果保存在[机器记录](results/pi-sdk-1.2.0-upgrade.json)。最终 kernel bundle、launcher、codemode worker 和 WASM 与执行上述 SDK E2E 的资源逐一同哈希。

### 全量验证中保留的问题

- `packages/shared/src/decisions/client.test.ts:89` 的精确 usage 断言未包含当前 `readCost()` 返回的 `costSource: unknown` 和 `costUnavailableReason: not_reported`。单文件复核仍为 16 pass / 1 fail；client、test、types、providers 和 identity 源码与升级前 HEAD 逐文件同哈希。本次没有改写无关决策代码或此单元测试。
- HTTP 的「重复成功登录不消耗失败预算」用例超过 Bun 默认 5 秒限制，首轮及独立 5 秒复核均失败。保留全部断言、仅将本次验证命令的时限改为 15 秒后，15/15 通过；该场景实测耗时约 5.99 秒。没有修改测试源码或生产认证行为。
- 通用 `build:smoke` 完成上述五项生产构建后，服务端分发装配明确报 `Unsupported platform: win32`。它只支持 darwin/linux，本次没有改写分发平台范围；Windows 使用桌面资源验证与包外真实 Pi 子进程验证。因此**不宣称 `bun run test` 或 `build:smoke` 整体通过**。

### 本地复现

升级前 1.1.0 bundle、SDK 版本、源码 HEAD、锁文件与资源哈希保存在 `.cache/pi-120-upgrade/baseline/`。它由升级前源码现场构建，不使用当前 bundle 冒充旧版本。

```powershell
bun install --frozen-lockfile
bun run server:build:subprocess
bun run scripts/verification/pi-120-upgrade-workflow.ts --baseline-dir=.cache/pi-120-upgrade/baseline
$env:PHANERIS_VERIFY_PI_ENTRY = Join-Path (Get-Location) 'packages/pi-agent-server/dist/index.js'
bun run scripts/verification/capability-integration-workflows.ts .cache/pi-120-upgrade/recheck-capabilities.json
bun run scripts/verification/pi-control-workflow.ts
bun run scripts/verification/durable-runtime-pi-workflow.ts
bun test --timeout 15000 ./packages/server-core/src/webui/__tests__/http-server.isolated.ts
```

若旧 bundle 缓存不可用，应从上述升级前 HEAD 与 1.1.0 冻结依赖重建，再提供对应 `identity.json`；不能略过 baseline 哈希核对。验证工具为每次运行建立独立输出目录，不覆盖已有 manifest。

真实 provider API、真实 OAuth 网络刷新、Linux/macOS、签名安装包与发布未验证。本次验证快照生成时尚未提交、推送、安装或发布；随后用户授权将本升级与上游 0.15 非 UI 吸收一并提交并推送至 `origin/main`。
