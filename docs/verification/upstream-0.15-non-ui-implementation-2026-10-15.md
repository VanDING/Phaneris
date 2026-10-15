# 上游 0.15.0 / 0.15.1 非 UI 吸收实施记录

状态：implemented — 2026-10-15 已完成批准的 B1–B6；新增 33 项流程验收通过。全量旧测试仍有失败，范围与复核结果见下文；不宣称全仓测试通过。实施遵循[事先失败矩阵](upstream-0.15-non-ui-failure-matrix-2026-10-15.md)。

基线：Phaneris 0.3.2 / HEAD `323fa0296d0e8b11cd004e60bb80977e46d544dd`，保留原工作区 Pi 1.2.0 升级。上游来源：[0.15.0](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.0)、[0.15.1](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.1)。

| 批次 | 范围 | 状态 |
| --- | --- | --- |
| B1 | 凭据隔离、HTTP 头、辅助模型、标签、Pi 信任与 endpoint/headless、小型行为修复 | 已实施；核心与实际组件流程通过 |
| B2 | 项目记忆追加、MCP resources/templates/prompts 与现有受管链路 | 已实施；真实文件、HTTP MCP 与取消/撤销流程通过 |
| B3 | OAuth 复用、刷新优先、完成广播和取消 | 已实施；回环与凭据回归通过，真实账户未验证 |
| B4 | 本轮 Task 输出、attempt 隔离、依赖传递、生成时限与思考、指南读取 | 已实施；DAG、生成等待与真实 Shell 流程通过 |
| B5 | 隐藏浏览器输入/截图、挑战判断、密码持久化脱敏、输出与日志 | 已实施；真实 Windows Electron/CDP、SQLite 与 SDK journal 通过 |
| B6 | 既有回归、全仓门禁、生产构建、复核产物与文档收口 | 已完成；静态门禁及构建通过，旧测试差异明确保留 |

不吸收视觉改版、Claude SDK/Artifact 发布、Cloudflare 新连接、Claude 专属后台任务语义和旧 Windows 材质变更。实施完成后，用户追加授权提交并推送至 `origin/main`；安装与发布不在本次范围。

## 已落地的行为

- 项目记忆使用 `project_memory_append`，绑定当前会话的项目、遵守 Safe 禁写，并以单次追加保留并发笔记。长记忆保留开头与最新结尾，不覆写旧文件。
- MCP 新增 `source_list_resources`、`source_read_resource`、`source_list_prompts`、`source_get_prompt`。支持无 tools 的来源、资源模板、分页上限、二进制保存与取消；每次检查当前启用来源和连接。服务说明有界消毒，继续走既有会话工具、权限和 Durable 执行链路。
- 凭据刷新按工作区与来源合并；OAuth 登录可供同工作区等待会话共用，成功后清除刷新冷却并恢复相关请求。客户端取消仍核对拥有者与工作区。
- Task 只接受本次子会话当前轮的最终回复；依赖边传递上游输出，显式引用不重复，长结果提供完整输出文件路径。生成任务定义使用 medium 思考、90 秒无活动超时和每次 300 秒总上限，最多两次；客户端时限同步延长。停止仍采用 Phaneris 的 cancelled/显式恢复规则。
- 浏览器改用可在隐藏窗口生效的 CDP 输入，支持 React 受控输入与原生/自定义下拉；截图验证新帧并恢复窗口状态。挑战检测用页面证据和复核，稀疏 AX、菜单和同意页不单独构成挑战。修复了移植中发现的 CDP 在途请求被空闲计时器断开的问题。
- 浏览器文本输入在会话、Durable 事实与 Pi SDK journal 写入之前隐藏；实际参数和身份哈希保持原值。由于 T1 时未知字段类型，保存副本也隐藏普通浏览器文本输入。不会追溯清除旧日志，也不能掩盖模型自行在普通文本里复述的秘密。
- 辅助模型选择、标签规范化、Pi 项目设置隔离、Azure endpoint 热更新、headless 路径隔离、附件超限保留草稿、凭据 Cancel、时区、工作区深链和来源错误状态均已接入。附件继续使用原有 16 MiB 协议上限，没有扩大传输限额。

## 兼容边界

保留 Pi SDK 1.2.0、主模型默认值、缓存记账和当前视觉体系。上游的视觉/排版/动效改版、新增 UI 入口、Claude SDK、Claude Artifact 发布、Cloudflare 连接模板和 Claude 后台任务等待语义不在本次范围。

没有新增事后单元测试，也没有改写旧单元断言来制造通过结果；新增验收均使用既有 VerificationRun 的流程脚本。协议的自动生成快照按 `oauth:status` 新接口同步。

## 验收结果

[机器可读结果](results/upstream-0.15-non-ui-2026-10-15.json)记录每次运行的命令、场景、manifest 和必要产物 SHA-256，并记录最终变更源码与构建文件摘要。完整日志、截图和临时数据库留在 `.cache/`；本档案不收录媒体或数据库。

| 验收 | 结果 | 覆盖及边界 |
| --- | --- | --- |
| 非 UI 核心流程 | 11/11 | 凭据/头字段、辅助模型、标签、Pi 隔离、真实项目记忆、HTTP MCP 模板/分页/二进制/取消/撤销、实际 Git Bash、路径、时区与来源状态 |
| OAuth / Task 编排 | 5/5 | 并发准备只执行一次、工作区隔离、完成广播、本轮输出与旧 attempt 隔离、依赖传递、生成活动/空闲时限 |
| Windows 原生浏览器与持久化 | 11/11 | 实际 Electron BrowserPaneManager/CDP 隐藏输入、React/下拉、挑战、截图及窗口恢复；真实 SQLite Durable 事实与 Pi SDK journal 输入隐藏，实际参数及哈希不变 |
| 实际渲染组件流程 | 6/6 | Vite 编译生产组件后在 Electron/CDP 验证凭据取消、单文件/合计/序列化超限保留草稿、正常发送、无页面异常 |
| 既有 Pi / Durable 工作流 | 9/9、6/6 | Pi 控制与独立 Pi 子进程、SQLite 执行链路；离线回环 provider |
| 既有能力集成 | 10/10 | 使用本轮重建的 Pi SDK 1.2.0 bundle；不等于真实供应商账户验收 |
| 全仓类型与治理 | 通过 | `typecheck:all`、完整 `lint`、四项 i18n、identity、version、docs；lint 保留 72 项现行 warning |
| 生产构建 | 通过 | Electron、WebUI、Viewer；不是签名安装器验收 |

四组新增工作流合计 **33/33**，已登记 critical registry 与必要产物策略。最后一轮渲染组件运行与最终源码一致；结果文件保留具体运行目录，不能用初次失败或过时的缓存目录替代。

## 旧测试与复核

首次 `bun run test` 汇总为 **6,179 pass / 35 fail / 7 skip**。这是当时的完整执行记录，不是最终剩余失败数；修复及定向复核后没有重跑整条全量链。

| 分类 | 复核结果 |
| --- | --- |
| Task、标签与流式重试 | 原有 7 个实际测试文件共 112 项通过；原命令中不存在的 credential-manager 路径未计入覆盖 |
| OAuth / 凭据 / HTTP | 凭据及 callback 28 项、HTTP 隔离 15 项通过；OAuth 消息顺序、落盘与重试分进程复核均通过 |
| 协议、会话与其他首轮失败 | wire/mini 13 项、交接/空闲/队列 20 项、z-index/Pages/帮助 manifest 15 项、分块传输 9 项通过；WhatsApp 附件翻译在兼容复核中通过 |
| 预期行为变更与旧 mock | 旧测试仍要求回显浏览器输入、只保留记忆开头，或模拟旧浏览器输入/截图 API。新流程分别验证输入隐藏、首尾记忆和实际 Electron/CDP。BrowserPaneManager 旧 mock 单独复核为 70 pass / 18 fail，未修改断言来强行通过 |
| 未改动模块的测试差异 | 兼容复核为 37 pass / 5 fail：SystemOne 使用量断言未包含现有 `costSource` / `costUnavailableReason`，四项 PowerShell 测试未注册 validator root。相关产品文件与 HEAD 相同；这不构成本次新增功能已通过所有旧测试的证明 |

首次完整失败名单、后续复核日志摘要及 SHA 均保留在机器结果中。全仓测试未全绿是明确的验收限制，不将所有失败笼统归为环境问题或未经证明的既有问题。

## 复现与保留项

在仓库根目录，使用当前锁文件与已安装的 Windows Electron：

```powershell
bun run test:upstream-015
bun run typecheck:all
bun run lint
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run lint:i18n:coverage
bun run lint:i18n:dead-keys
bun run identity:check
bun run version:check
bun run check:docs
bun run electron:build
bun run webui:build
bun run viewer:build
```

工作流会生成新的唯一 `.cache/verification/<run-id>/`，含 manifest、场景与必要产物哈希；已有缓存清理后需重跑再生。具体单独复核命令见机器结果，不将多次执行的重叠测试数累加成唯一测试总数。

实施前 19 个未提交文件已先备份；其中 13 个保持逐字节不变，6 个重叠文件保留原 Pi 1.2.0 改动并追加本次内容，没有文件丢失。`bun.lock` 保持实施前 SHA-256 `8f07f50020f6497aa3e38708415435e21102934ea2d193dbc85709e6d26ea020`。

真实供应商 API、外部 OAuth/CAPTCHA 账户、其他平台、签名安装器、安装和发布均未执行。验证快照绑定实施前 HEAD 与当时的未提交源码；后续提交及推送以 Git 历史为准。
