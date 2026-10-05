# 内置 Default 与本地客户端验收

2026-10-05。用户明确授权直接替换内置 `default`，并要求打包本地客户端。已完成应用与打包，版本保持 **0.3.0**，平台为 **macOS Intel/x64**，本地构建未签名。

浅色设置卡片、输入框和菜单为纯白，墨色文字配细边线与轻投影。用户消息为灰白 `#F3F3F3`；深色使用石墨背景与中性深灰 `#2B2B2B` 消息。紫色仅作强调。同步 canonical、内置 JSON、Electron/shared UI 静态样式与窗口启动背景；现有 `default` 选择直接采用新主题，`twilight` 兼容入口保留。个人主题与配置文件未改动。

单色供应商图标按应用明暗模式适配，包括连接图标、看板模型标签及模型菜单；Claude、Manifest 和自定义图标保留原色。AI 页维持「连接 → 会话 → 高级」，图像、决策、缓存与运行优化独立折叠。

| 验证 | 结果 |
| --- | --- |
| 真实内置 Default 页面与主题存储 | 16/16 通过；明暗设置、消息、菜单、输入聚焦、开关、对话框、Logo、中文窄窗口及用户文件保留 |
| 现有主题一致性与存储检查 | 22/22 通过 |
| 实际打包客户端 | 5/5 通过；页面顺序与折叠、内置主题、外观明暗切换、图像设置 IPC、Guarded 精确跳转 |
| 打包 Electron 与实际解释器/OS 沙箱 | 14/14 通过；Python 冷准备/离线复用、Node、Bun、transform_data、临时文件、超时、网络及越界写入拒绝 |
| 安装文件验收 | 4/4 通过；版本身份、x64 架构、632 个构建文件匹配、ZIP 完整性、DMG 校验与只读挂载 |
| 构建与静态检查 | 完整 Electron 构建、typecheck:all、lint、git diff --check 通过；版本、身份、Python/Electron pin 检查通过 |

消息文字对比度：浅色 **14.14:1**，深色 **12.43:1**。正文及辅助/语义文字实色组合最低 **5.32:1**；聚焦环浅色 **5.86:1**、深色 **8.22:1**。这些测量不把禁用控件的透明文字视作常规正文。

使用临时配置目录、示例账户和回环服务验证，没有调用付费图像生成接口。运行时探针使用包内 Electron、uv 和 Bun；Python 为固定的 CPython 3.12.15。安装包校验包含从 DMG/ZIP 读取真实主题与 main bundle，并与已启动验收的应用比较。

安装文件位于 `apps/electron/release/local-20261005-ai-settings/`：

- `Phaneris-0.3.0-mac-x64.dmg`
- `Phaneris-0.3.0-mac-x64.zip`
- `SHA256SUMS.txt`
- `verification/`：机器可读报告、截图、运行时 JSON 输出和构建日志

DMG SHA-256：`16b54673abe6255cc4f8f1115d45e32f387d61f116a32d04a1d799b1c0e866fc`。

ZIP SHA-256：`51108ea610651d0170f6916f66689310efc20a9eb1e85f995ad801f7990ecb9b`。

页面结果及截图见 [内置主题验收](results/default-theme-application/validation.json)；实际客户端和沙箱报告同步保存在同一目录的 `packaged-ui.json` 与 `packaged-runtime.json`。失败条件见 [事先列出的矩阵](default-theme-application-failure-matrix.md)。

复验命令（在仓库根目录运行）：

```sh
bun run scripts/verification/default-theme-preview-workflow.ts --builtin
bun run scripts/verification/packaged-refinement-workflow.ts --app="$PWD/apps/electron/release/local-20261005-ai-settings/mac/Phaneris.app"
bun run scripts/verification/runtime-refinement-workflow.ts --app="$PWD/apps/electron/release/local-20261005-ai-settings/mac/Phaneris.app"
bun run scripts/verification/local-client-package-workflow.ts --release="$PWD/apps/electron/release/local-20261005-ai-settings"
```
