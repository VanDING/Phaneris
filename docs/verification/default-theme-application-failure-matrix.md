# 内置 Default 应用验收

2026-10-05，用户明确授权「直接替换内置 default 主题」。以下失败条件先于本轮产品修改列出。

| 失败条件 | 验证方式 |
| --- | --- |
| 只替换预览文件，实际 Default 仍使用旧灰紫卡片 | 使用真实 ThemeProvider、AI 页面和 `theme=default`，检查浅色卡片为纯白、明暗配色及消息气泡 |
| JSON、canonical、Electron/shared UI CSS、启动背景发生漂移 | 读取四份实际资源，对照主题引擎全部输出 token；启动 hex 与明暗背景相等 |
| Default ID 改变、旧选择失效、覆盖个人主题 | 临时配置目录走真实主题存储；检查 `default`、`twilight`，保留用户自定义文件的内容 |
| 主体或失焦消息仍带紫色 | 真实 UserMessageBubble 的 RGB 通道差不超过 1，明暗模式正文对比度 ≥4.5:1；失焦 token 为中性灰 |
| 单色 Logo 在深色中消失、彩色或自定义 Logo 被错误反色 | 真实 ConnectionIcon：单色资产仅在深色反色，Claude/Manifest/自定义图标无滤镜 |
| 设置、菜单、输入聚焦、开关、对话框或中文窄窗口不可读 | 复用真实页面预览流程，在内置 Default 下测量对比度、操作控件、保存截图 |
| AI 页结构或独立折叠退化 | 启动实际打包应用，检查连接→会话→高级顺序、三项初始折叠及独立展开 |
| 打包遗漏新主题或脚本运行时回归 | 包内 JSON 与 canonical 相等；实际包启动、图片设置 RPC、Guarded 跳转与沙箱运行时流程 |
| 安装文件损坏或架构不匹配 | x64 可执行文件检查、DMG 校验及只读挂载、ZIP 完整性、SHA-256 清单 |

真实页面复验：`bun run scripts/verification/default-theme-preview-workflow.ts --builtin`。打包复验：`bun run scripts/verification/packaged-refinement-workflow.ts --app=/absolute/path/Phaneris.app` 与 `bun run scripts/verification/runtime-refinement-workflow.ts --app=/absolute/path/Phaneris.app`。所有账户数据均为隔离测试数据，不调用付费生成接口。
