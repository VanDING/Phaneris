# 白色 Letter Glitch 启动流程实施记录

## 最终行为

1. 后端与渲染器准备期间，正常尺寸的白色启动窗口仅显示字符背景，无 Logo、无 Loading 文案。
2. 应用最终主题、字体、会话和草稿恢复就绪后，在同一个 canvas 上播放 Logo 描边与填充。
3. Logo 入场结束后用 240 ms 淡出交接工作区；应用自身主题不变。

小型 360 × 160 Loading 窗口与原渲染器 Logo 页的重复展示已移除。动画不再由启动最短等待时间触发。首次引导、重新登录、工作区选择和可重试加载错误共用实际就绪通知。

## 实现边界

- 主进程的启动窗口贯穿后端启动和 UI 准备，业务窗口先在后台加载。启动页面没有 preload、Node、RPC 或工作区数据。
- 初始业务窗口通过只读启动归属标记跳过自己的字符动画，避免同时运行两个 WebGL 背景。
- 多窗口恢复只播放一次 Logo；较慢的窗口继续等待自身就绪。深链与第二次打开请求不会提前展示未就绪窗口；最小化期间不会强制弹出应用。
- 新打开的独立窗口使用同一渲染器启动组件，组件在 App 的加载分支切换时保持挂载。
- 减少动态效果时字符静止、Logo 直接显示；WebGL 不可用或上下文丢失时显示静态字符。启动页面或渲染进程失败时解除遮挡，交回现有应用恢复流程。
- Letter Glitch 保留 David Haz 的 MIT + Commons Clause 许可，随应用资源分发；没有增加包依赖或外部字体请求。

## 验证

实施前场景见[失败矩阵](startup-letter-glitch-failure-matrix-2026-10-30.md)。

| 检查 | 结果 |
| --- | --- |
| Windows 原生 Electron 启动工作流 | 13 项通过 |
| 实际主进程、preload、App：白色启动进入深色工作区 | 通过；最终主题和字体就绪，后台无重复字符 canvas |
| 实际首次引导入口 | 通过；白色主题与引导目的页正确 |
| 慢/快启动、连续 canvas、多窗口延迟、最小化、关闭、渲染进程崩溃 | 通过 |
| 减少动态效果、WebGL 禁用、实际图形上下文丢失 | 通过 |
| Electron 与验证脚本类型检查；修改文件 ESLint | 通过 |
| 主进程、preload、渲染器构建；资源打包校验 | 通过 |
| 主题启动回归、视觉契约、设计与尺寸契约、文件体积、字体、分发边界与 RPC 契约 | 通过 |
| 旧 `theme-native-workflow` | 初次运行因已移除的 `ink` 主题断言失败；后续 CI 修复已改为验证 Default 深浅模式和旧主题 ID 的归一化，13 项本机检查通过 |

macOS/Linux 原生窗口与签名安装包未验证。

## 可复验产物

```sh
bun run electron:build:main
bun run electron:build:preload
bun run electron:build:renderer
bun run electron:build:resources
bun run electron:build:assets
bun run electron:build:validate
bun run scripts/verification/startup-feedback-workflow.ts
```

本机产物目录为 `.cache/verification/startup-feedback-QGRPq0/`，内含 `manifest.json`、`feedback.json`（13 项检查）、`build-hashes.json` 和 `startup-trace.zip`。每次重跑生成独立目录。产物不随 Git 仓库分发；CI 验证通过 Actions artifact 保存对应运行证据。

该目录同时包含 `white-loading.png`、`white-logo-fill.png`、`dark-workspace.png` 和 `light-onboarding.png`，分别记录加载、Logo 入场、深色工作区与白色首次引导。

边界说明：WebGL 不可用场景仅在验证 bundle 的原生 `BrowserWindow` 参数中禁用 WebGL，产品代码无测试开关。截图用例控制 Logo 的 CSS 时间以截取指定帧；快速启动用例使用真实动画时间验证交接。实际应用用例没有模拟 App 就绪信号。

旧主题回归失败的本机记录位于 `.cache/verification/theme-native-zgjOAI/native-process.log`。
