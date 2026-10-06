# AI 设置、Default 与脚本运行时验证

2026-10-05，工作分支 `codex/ai-settings-runtime-refinement`，基于 `3fcad35e`。
源代码及本地验证包完成；应用版本保持 0.3.0。

## 实际结果

- **前端一致性**：AI 设置沿用其他设置页的单页滚动、分组卡片和右侧控件。上下文管理复用 `SettingsMenuSelectRow`，提供压缩、交接、手动三种互斥策略；左侧说明随当前选择更新，菜单保留每种策略的解释。没有新增页内标签视图。
- **AI 设置逻辑**：当前工作区优先展示，其他工作区按需展开；摘要显示实际继承的连接、模型与思考级别。切换连接时一次保存清除不兼容的模型，失败恢复整份前端状态。连接验证结果保留到下一次验证。
- **模型配置**：会话模型与图像生成模型分别配置，图像输入能力仍由会话模型提供。可选决策模型及其配置按需展开；标题和摘要继续共用现有 utility model，没有新增逐功能模型配置。
- **图像路由**：独立默认连接和模型持久化，经真实 RPC 保存、重新读取并用于 Images API 请求。自动选择优先使用应用默认会话连接；明确指定账户后，缺少密钥或连接失效会报告错误。RPC 拒绝不存在的连接和不兼容的模型。
- **Guarded**：会话权限菜单、权限设置和 AI 设置都有配置入口。可用性检查包含开关、实际凭据和端点配置，连通性仍通过现有测试操作验证。风险判断失败、缺失、超时或格式错误时要求确认；无人值守的受检查操作阻断。取消与模式切换优先，项目内普通文件编辑及只读规则保留。
- **Default**：内置显示名称统一为 Default，稳定 ID `default` 与历史 `twilight` 别名保留。浅色和深色卡片、辅助文字、警告颜色、菜单与弹窗层次经过调整；资源 JSON、TS 快照和静态 CSS 同步。用户主题文件不被重写。
- **脚本运行时**：Python 3.12.15 在应用管理目录中由固定 uv 操作提前准备，进入沙箱后直接执行解释器；首次准备失败不会执行脚本，准备后可离线复用，并发首次请求共用准备过程。打包版 Node 使用 Electron 内嵌 Node，Bun 继续使用打包运行时。两个脚本工具共用环境与隔离流程，兼容 Node CommonJS/ESM，修复 macOS `/tmp` 别名导致合法路径被拒绝的问题。

## 验证证据

| 流程 | 结果 | 保存的证据 |
| --- | --- | --- |
| 实际打包解释器与 macOS 沙箱 | 14/14 | [runtime.json](./results/ai-settings-refinement/runtime.json) |
| Guarded 实际权限与 HTTP 决策路径 | 6/6 | [guarded.json](./results/ai-settings-refinement/guarded.json) |
| 图像模型、持久化、认证 RPC 与原子工作区保存 | 7/7 | [images.json](./results/ai-settings-refinement/images.json) |
| 真实 AI 页面、键盘、回滚、继承与截图 | 9/9 | [settings.json](./results/ai-settings-refinement/settings.json) |
| 完整打包应用启动、设置页面及实际 IPC | 3/3 | [packaged.json](./results/ai-settings-refinement/packaged.json) |
| 已有主机、权限取消、模式切换和任务流程回归 | 20/20 | [upstream.json](./results/ai-settings-refinement/upstream.json) |

合计 **59/59 项流程通过**，另外运行的 **61 项现有回归检查全部通过**。
`typecheck:all`、`lint`、四项 i18n 门禁、身份与版本检查、Python/Electron 运行时版本检查、完整 Electron 构建和 macOS x64 目录打包通过。
Lint 与身份检查仍报告仓库已有警告。完整结果索引：[checks.json](./results/ai-settings-refinement/checks.json)。

基础文字 token（正文、辅助文字、警告文字）对页面及卡片底色的抽查，明暗模式最低对比度为 **5.55:1**；记录在 `settings.json`。截图覆盖英文、中文 480px 窄窗口、菜单、弹窗及完整应用。

![真实打包应用中的上下文管理](./results/ai-settings-refinement/packaged-context-card.png)

- [完整应用 AI 页面](./results/ai-settings-refinement/packaged-ai-context.png)
- [真实 Guarded 配置入口](./results/ai-settings-refinement/packaged-guarded-setup.png)
- [Default 浅色](./results/ai-settings-refinement/settings-light-en-1040-top.png) / [深色](./results/ai-settings-refinement/settings-dark-en-1040-top.png)
- [中文窄窗口与上下文菜单](./results/ai-settings-refinement/settings-light-zh-Hans-480-context-menu.png)
- [连接菜单](./results/ai-settings-refinement/settings-connection-menu.png) / [弹窗](./results/ai-settings-refinement/settings-rename-dialog.png)

## 复现

从仓库根目录运行。流程自行建立独立配置和测试数据，不使用个人凭据。

```sh
bun run scripts/verification/ai-settings-refinement-workflow.ts
bun run scripts/verification/guarded-refinement-workflow.ts
bun run scripts/verification/image-settings-refinement-workflow.ts
bun run scripts/verification/upstream-0140-b4b5-workflows.ts --report=.cache/ai-settings-refinement/upstream-latest.json
bun run scripts/verification/runtime-refinement-workflow.ts --app=/absolute/path/Phaneris.app
bun run scripts/verification/packaged-refinement-workflow.ts --app=/absolute/path/Phaneris.app
```

输出保存在 `.cache/ai-settings-refinement/`，包括 JSON、截图、运行日志和实际生成的 JSON 数据文件。失败场景先行记录在 [验收矩阵](./ai-settings-runtime-failure-matrix.md)。

## 验证范围

本次实际打包运行的平台为 **macOS x64**，验证包位于 `.cache/ai-settings-refinement/package/mac/Phaneris.app`，未签名，供本地复查。Linux 与 Windows 未在本机实际运行；没有隔离后端的平台会明确阻断脚本执行。

首次准备 Python 需要下载固定版本，之后离线复用。图像与决策服务使用本地 HTTP 测试服务，没有调用付费生成或决策接口。Node 成功结果中可能包含 macOS 任务查询诊断或 ESM 自动识别提示，原始记录保留；这些记录的退出码与实际输出均验证成功。
