# Pi SDK 1.5.0 升级与验证

日期：2026-11-02（Asia/Shanghai）。升级前：Phaneris 0.5.6 / Pi SDK 1.3.0。范围：Pi 内核依赖、必要兼容修改、构建与回归验证。

官方依据：[v1.5.0](https://github.com/earendil-works/pi/releases/tag/v1.5.0)、[pi-ai changelog](https://github.com/earendil-works/pi/blob/v1.5.0/packages/ai/CHANGELOG.md)、[agent-core changelog](https://github.com/earendil-works/pi/blob/v1.5.0/packages/agent/CHANGELOG.md)、[coding-agent changelog](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/CHANGELOG.md)。同时核对跨过的 1.4.0 兼容变化。

## 实施前失败矩阵

此矩阵先于依赖和产品源码修改记录。验证使用隔离配置、真实 SDK / 子进程及本机回环推理服务。

| 编号 | 失败条件 | 验收方法 |
| --- | --- | --- |
| P150-01 | 直接依赖、锁图、实际安装包混用版本；新 pi-schema 未随 SDK 正确进入构建 | 精确固定 Pi 家族版本，核对完整依赖图、冻结安装及 bundle / worker / WASM 哈希 |
| P150-02 | pi-ai 移除 TypeBox 重导出，导致 web_search / web_fetch 或工具注册启动失败 | 全仓类型检查、内核构建、真实启动和工具请求 |
| P150-03 | pi-schema 改变工具参数强制转换、错误格式或类型推导，导致代理工具无效输入误执行、有效输入丢失 | 先写 SDK 端到端工作流，覆盖普通 JSON Schema 的字符串转整数、标量转数组、缺必填参数、流式大参数及工具后续回答 |
| P150-04 | 增量解析的私有状态进入消息或旧历史在升级后丢失；分支越过 cutoff 或压缩后不能恢复 | 冻结升级前 1.3.0 bundle 身份，旧 journal → 新 SDK 恢复、分支、父会话完整性及压缩重启 |
| P150-05 | 1.4.0 telemetry / identity / transcript API 变化破坏宿主请求；重试、取消、模型切换退化 | 调用点核对、全仓类型检查、既有真实 Host + Pi 控制与 runtime 回环工作流 |
| P150-06 | codemode 嵌套工具绕过宿主权限 / durable 边界，worker 无法从包外启动 | 既有 capability 集成工作流及 durable runtime E2E |
| P150-07 | 构建、lint、身份、版本、文档或既有兼容测试回归；新证据覆盖用户原有结果 | 仓库门禁；所有新运行写唯一 .cache/verification 目录，记录命令、退出码与 SHA-256 |
| P150-08 | 1.4.0 起摘要不再使用 reserve 的 80% / 50% 预算，旧阈值扩展仍接管摘要并重传 OAuth token，绕过 1.5.0 原生修复 | 在移除扩展前更新既有 runtime E2E 的版本契约：阈值仅影响触发；自定义 Chat Completions 仍由服务端选择默认输出预算；手动 / 自动 / overflow / 失败 / 取消 / 重启均走原生压缩路径 |

## 实施结果

- 四个 workspace manifest 中的 Pi 直接依赖全部精确固定为 1.5.0。实际安装与锁图共八个 Pi 包：`pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-codemode`、`pi-mcp`、`pi-tui`、`pi-telemetry`、新增的 `pi-schema`。八包 integrity 均与官方 npm registry 相符，冻结安装通过。
- `web_search` / `web_fetch` 改从项目已有的 `@sinclair/typebox` 导入构建器，schema 形状不变；参数交给 SDK 的 pi-schema 统一校验。既有 observability 工作流改用普通 JSON Schema，移除 `sdk.Type` 依赖。
- 去掉 `pi-coding-agent>undici: 8.12.2` 旧覆盖，使用新版 SDK 自身精确固定的 8.12.3；项目其他父依赖的 undici 版本不变。
- 采用 [Pi 1.4.0 原生摘要契约](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/CHANGELOG.md#140---2026-10-21)：摘要不再使用 reserve 的 80% / 50% 作为输出上限。压缩阈值仍通过公开 SettingsManager 更新，移除旧扩展对摘要生成和错误的接管，原生 SDK 负责路由、认证、重试与结果。这样自定义阈值也能沿用 1.5.0 的 OAuth 摘要认证修复。
- 对任意自定义 Chat Completions 端点，沿用宿主现有的隐式输出上限策略：普通请求与没有显式上限的摘要都由服务端选择默认预算；`call_llm`、handoff 和 cache warming 的显式上限继续生效。原生 provider 使用 SDK 的模型输出上限。不能继续用旧的 13,107 / 8,192 数值验收新摘要。
- 新增两份端到端工作流，更新内核指南和验证索引。产品版本仍为 0.5.6，未修改 Bun / Electron / Python 版本。

## Windows 验证

升级前生产基线为 `e27b750515f55d294c5f0655cb740d5f509f1d41`，先构建并冻结 Pi 1.3.0 bundle / launcher / worker / WASM。以下新内核场景均使用本机回环服务，不调用付费模型。

| 验证 | 结果 | 完整运行目录（相对仓库） |
| --- | --- | --- |
| 版本图、真实 1.3.0 journal 升级、分支 cutoff、父会话完整性、压缩重启、宿主模型 T1/T2 | 6/6 | `.cache/verification/pi-150-upgrade-OKBKrQ/` |
| 普通 JSON Schema 强制转换、372,000 字节 Unicode / 转义大参数分片、必填错误不执行、web 工具注册、解析私有状态隔离 | 5/5 | `.cache/verification/pi-150-tool-schema-uDGfOD/` |
| 模型切换、无效参数、重试 / 耗尽、流取消及子进程回收、手动 / 自动 / overflow 压缩、阈值恢复、错误与取消 | 13/13 | `.cache/verification/upgrade-0153-pi-runtime-Kw3RGJ/` |
| JSONL 初始化、并发 ready、真实流取消与 pipe 关闭 | 9/9 | `.cache/verification/pi-control-5LQWXK/` |
| 独立 Host + Pi + SQLite 的模型 / 工具 durable 边界 | 6/6 | `.cache/verification/durable-runtime-pi-IVnxYA/` |
| 仓库外启动 codemode、worker / WASM、工具权限、撤销、取消、结构化结果 | 10/10 | `.cache/verification/pi-150-validation-e153321a3ea34beeba27eab17e13b9db/capabilities-verified.json` |
| 流式观测、用量 / 金额与真实 SQLite / RPC | 15/15 | `.cache/run-observability/evidence/`，本次日志另存于汇总目录 |
| 连接建立、模型目录、百分比阈值、原生图片与默认 / 显式输出预算（含生产 WebUI 构建和浏览器） | 14/14 | `.cache/verification/api-connection-setup-n0M0LW/` |
| Pi 内核、SDK 重试和模型目录既有测试 | 213 pass / 0 fail，33 文件 | 汇总目录 `pi-tests-final.log` |
| 全仓类型检查、lint、四项 i18n、文档、身份、版本、runtime 与 Electron 固定值 | 通过 | 汇总目录对应日志 |
| Pi bundle / worker / WASM 与 Electron main / interceptor 构建 | 通过 | 汇总目录 `build-final.log` / `electron-main-final.log` |

汇总目录：`.cache/verification/pi-150-validation-e153321a3ea34beeba27eab17e13b9db/`。原生 VerificationRun 目录包含 manifest、源码 / lock 身份、命令及产物 SHA-256；汇总记录包含日志、registry 核对及桌面暂存内核与 E2E bundle 的哈希对应关系。新产物不提交到历史 `docs/verification/results/`。

最终可校验汇总：`.cache/verification/pi-150-acceptance-Pv6cCv/`，已用 VerificationRun 验证器逐项复核原生工作流产物与汇总产物。包含 **78 项端到端检查、213 项既有测试**、全部门禁日志、八包官方 registry integrity 和三处内核构建 / 暂存身份；复核命令为 `bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/pi-150-acceptance-Pv6cCv`。

最终锁文件 SHA-256：`60fa028460aa78f27a6a6f3bda4dd236c9be6d7f004fdd5b58e1c5a0609ba0fe`。最终内核 bundle SHA-256：`fc0000e90328c7e9a3241616cdd664862c496f87c4cf195892ff17430df2109a`，源码构建、Electron resources、dist/resources 和仓库外 codemode 实测 bundle 一致。

### 初次失败与复核

- 实施前的大参数场景在 1.3.0 的 35 秒期限内未完成；这只是本机工作流超时记录，不构成通用性能结论。1.5.0 最终分片与完整参数一致性断言通过。
- 新工作流初次把 web 工具名断言为裸名；生产协议使用 `mcp__session__` 前缀。修正为真实协议名称后通过，没有修改产品工具命名。
- 首次全仓类型检查发现历史 observability 脚本仍使用 `sdk.Type`，已改用普通 schema，完整类型检查复跑通过。
- 原 runtime 场景按 1.3.0 的 80% 摘要公式断言，在 1.5.0 下失败。核对官方 1.4.0 变更后更新明确的版本契约、移除旧摘要扩展，13 项真实 runtime 回归通过；仍检查确定性失败只发一次摘要、取消、重启、元数据与 durable 结果，没有忽略错误。
- 首次文档检查因新记录尚未加入索引而失败，补齐两级索引后通过。上述失败日志与新运行均保留。
- 产物复核发现既有 `bundle-smoke.test.ts` 会以 `NODE_ENV=test` 重建内核，导致较早的仓库外 codemode bundle 与桌面构建哈希不同（Babel 环境常量为 `test` / `development`）。待既有测试和桌面构建结束后，固定产物并重跑所有直接使用内核 bundle 的工作流；最终验收逐个核对 launcher / bundle / worker / WASM，同哈希运行才计入最终记录。

## 复现

```powershell
bun install --frozen-lockfile
bun run server:build:subprocess
bun run scripts/verification/pi-150-tool-schema-workflow.ts
bun run scripts/verification/pi-150-upgrade-workflow.ts --baseline-dir=E:/Phaneris/.cache/verification/pi-130-baseline-cfc9003c44be4b1faa0031c74e1a7e9d
bun run scripts/verification/upgrade-0153-pi-runtime-workflow.ts
bun run scripts/verification/pi-control-workflow.ts
bun run scripts/verification/durable-runtime-pi-workflow.ts
bun run scripts/verification/api-connection-setup-workflow.ts
bun run typecheck:all
bun run lint
bun run electron:build:main
```

若 1.3.0 baseline 缓存不存在，应从上述升级前 HEAD 和冻结依赖重建，并生成对应 `identity.json`；不能跳过基线哈希核对。用 `bun run scripts/verification/verification-artifacts.ts --verify=<完整运行目录>` 检查 VerificationRun 产物。

未执行真实供应商 API / OAuth 网络刷新、Linux / macOS、完整全仓测试套件、签名安装包、安装更新或发布。OAuth 摘要修复的本次结论限定为恢复到官方 SDK 原生认证路径；没有真实账号的网络验收。工作区原有两份 packaged-client 结果改动保持原状。本次没有提交、推送或修改真实用户会话。
