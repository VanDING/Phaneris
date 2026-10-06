# Default 紫色与白色 New Session 验收

2026-10-05。已恢复原有 Default 的精确明暗紫色：浅色 `oklch(0.488 0.275 280.3)`、深色 `oklch(0.626 0.221 291.7)`，并同步聚焦环、canonical、内置 JSON、默认 CSS 与预览参考文件。主题资源其余字段与上一版完全一致，检查记录见 [修改范围](./results/default-purple-sidebar/theme-change-scope.json)。

New Session 使用设置卡片的 `card/cardForeground`，浅色为纯白、深色为对应卡片色。悬停保持表面色，以主题阴影反馈；键盘聚焦显示原有紫色环，Space 可打开新会话。全局 secondary、其他控件选中态、灰白用户消息与个人主题文件保持原样。

| 检查 | 结果 |
| --- | --- |
| 真实主题页面/存储 | 17/17，明暗主题、消息、菜单、控件、Logo 与中文窄窗口 |
| 现有主题一致性与存储检查 | 22/22 |
| 实际打包客户端 | 6/6，精确紫色、白色按钮与悬停、键盘聚焦/新会话、深色切换、图片设置及 Guarded |
| 打包解释器与 OS 沙箱 | 14/14，Python/Node/Bun、临时文件、转换输出、隔离与超时 |
| 安装包 | 4/4，版本身份、构建文件一致性、ZIP 完整性、DMG 校验与只读挂载；主题、main、页面入口与 CSS 匹配实际验收应用 |
| 静态与构建 | typecheck:all、lint、版本/身份/runtime pin/Electron pin、完整构建与最终 renderer 构建/资源校验、git diff --check 通过 |

常规正文及辅助/语义文字 token 最低 5.32:1，消息正文浅色 14.14:1、深色 12.43:1。原有品牌紫色单独测量：浅色对白底 7.30:1，深色对背景 4.52:1、对卡片 4.24:1；不将品牌色算入常规正文 ≥4.5:1 的结论。失败条件在修改前记录于 [矩阵](./default-purple-sidebar-failure-matrix.md)。

版本 **0.3.0**，**macOS Intel/x64**，本地未签名构建。使用独立临时配置和示例账户，无付费模型调用。当前运行时验收使用本轮应用包内的 Electron/uv/Bun；随后仅修正 renderer 悬停样式，运行时及 main bundle 未修改。上一版安装文件保留。

安装目录：`apps/electron/release/local-20261005-default-polish/`。包括 DMG、ZIP、`SHA256SUMS.txt`、`verification.json` 与完整 `verification/` 日志/截图/JSON 输出。

DMG SHA-256：`67aef4f8c2e1780e4a9030a40f2e0e2f62547c750ed7795632c333a193857673`。

ZIP SHA-256：`9dce28099faa496c32569e990b870d818a9054cb1b4cb5ad9c2cf0fffb5d4691`。

重复验证（仓库根目录）：

`bun run scripts/verification/default-theme-preview-workflow.ts --builtin --output=docs/verification/results/default-purple-sidebar`

`bun run scripts/verification/packaged-refinement-workflow.ts --app="$PWD/apps/electron/release/local-20261005-default-polish/mac/Phaneris.app" --output="$PWD/.cache/local-package-20261005-default-polish/ui"`

`bun run scripts/verification/local-client-package-workflow.ts --release="$PWD/apps/electron/release/local-20261005-default-polish"`
