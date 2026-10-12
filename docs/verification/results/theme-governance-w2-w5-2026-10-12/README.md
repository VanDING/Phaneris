# 主题治理 W2–W5：本机验收与公开证据

状态：accepted（工程实现与本机验收）；三平台正式包、实机和长会话性能仍 open。日期：2026-10-12，Asia/Shanghai。

规划来源：commit `7891559`，分支 `codex/theme-governance-w1`，W1 commit `8d53a7200`。当前裁定在[规划 §13](../../../process/theme-engine-frontend-governance-plan-2026-10-12.md)，实施前要求见[TC01–TC18](../../theme-contract-failure-matrix-2026-10-12.md)。[原始审计](../frontend-theme-visual-audit-2026-10-12/README.md)与[首批 W1](../theme-foundation-w1-2026-10-12/README.md)保留原字节（其截图与 gz 媒体同样已于 2026-10-13 裁剪）。

## 实测范围

| 工作流 | 场景通过 | 原始 manifest | 报告 |
| --- | ---: | --- | --- |
| theme-foundation | 115 | [manifest](foundation/manifest.json) | [真实 WebUI/WS/watcher](foundation/theme-foundation.json) |
| theme-contract | 90 | [manifest](contract/manifest.json) | [四入口/compiler/Viewer](contract/theme-contract.json) |
| theme-roles | 76 | [manifest](roles/manifest.json) | [控件/外壳/嵌套 portal](roles/theme-roles.json) |
| theme-domains | 56 | [manifest](domains/manifest.json) | [列表/设置/看板/决策/轨迹/专用内容](domains/theme-domains.json) |
| theme-browser-host | 23 | [manifest](browser-host/manifest.json) | [工具栏/空态与有序投递](browser-host/theme-browser-host.json) |
| theme-login | 5 | [manifest](login/manifest.json) | [真实登录页明暗/焦点/缩放/reflow](login/theme-login.json) |
| theme-design | 36 | [manifest](design/manifest.json) | [参数对照](design/theme-design.json) |
| theme-governance | 49 | [manifest](governance/manifest.json) | [真实门禁 mutation](governance/theme-governance.json) |
| theme-native（Windows） | 13 | [manifest](native-win/manifest.json) | [生产 bundles/真实 Electron](native-win/theme-native.json) |
| markdown-popout 回归 | 18 | [manifest](popout/manifest.json) | [卡片/源码模式](popout/markdown-popout.json) |
| **合计** | **481/481** | [汇总](summary.json) | 已裁剪（2026-10-13） |

环境：Windows x64 10.0.26300、Bun 1.4.2、Node 24.15.0、Edge 155.0.4283.45、Electron 44.5.1。源码/构建摘要、执行时 HEAD 与 dirty paths、场景 ID、环境及 `untested` 保留于各份原 manifest；配套 `source-hashes.json`、`build-hashes.json` 按实际存在归档。场景数包含设计样本与门禁失败注入，不解释为全项目功能测试数。

真实 WebUI 使用生产构建、服务、WebSocket、两个认证客户端、独立用户主题目录、文件和图片编辑/损坏/恢复。功能域使用真实生产组件与合成业务数据；Viewer 使用实际 App/转录组件和合成 session。开发 fixture 的依赖准备使用单独页面，验收页面保留未过滤的错误门禁；真实 cold start 另由生产 WebUI 和原生流程承担。

原生流程使用临时配置和生产 main/preload/renderer，实际 BrowserViews 同步四套主题的八个请求模式组合；Geek/Cyberpunk 的 light 请求验证为强制 dark。200% 缩放使用真实 Chromium zoom，`webContents.capturePage` 保存完整 1280×900 原生帧，DOM viewport 为 640px。外部网页不接收私有主题定义或图片。此结果不等于签名安装器/正式包验收。

## 设计选择与回归

设计对照页（原 `design/index.html`）包含 36 张截图，可并排比较 40/34/32px 导航、840/768px 阅读列、现有/增强高程、窄屏与文字放大；该画廊及其截图已于 2026-10-13 随归档裁剪删除，[design/theme-design.json](design/theme-design.json) 仍保留参数对照结论，[selection.json](selection.json) 与 [SHA256SUMS](SHA256SUMS) 仍记录其路径与 SHA-256（见[档案裁剪](../../README.md#档案裁剪)）。当前保留 40px、840px 和现有材质；候选方案未自动成为产品默认。Default/Ink/Geek/Cyberpunk 的身份、旧根字号与 density 语义保持；Ink 次要文字修正对比度，语义 text/on-accent 与作者原色分工。

修复前失败保存在 [before/](before/)：compiler、watcher、控件角色、portal、browser host、Viewer 手动模式、登录和门禁分别使用独立运行目录。报告可能包含因前置失败未达到的后续场景，应按各自 manifest 判断；不使用修复前数量拼凑通过率。先前调试失败仍留存于本机缓存，不改写为成功。

全仓类型、完整 lint、字体/i18n、严格身份、版本、生成物、分发与文档门禁通过。既有主题/存储/堆叠规则检查 30/30；既有 lint 72 条 warning 基线未放宽。当前相关专项按 registry 场景数、必要文件、manifest 和 SHA 合约验证，本轮未重跑整个 `test:critical` 聚合或所有既有测试。最终静态检查的原日志 gz 已于 2026-10-13 裁剪，[checks/](checks/) 保留 JSON 结果，其路径与 SHA-256 仍记录在 [selection.json](selection.json) 与 [SHA256SUMS](SHA256SUMS)（见[档案裁剪](../../README.md#档案裁剪)）。

## 归档合约

这是完整 VerificationRun 的**公开选取副本**。原始运行目录为 `.cache/verification/<run-id>/`，映射见 [selection.json](selection.json)。公开的 JSON 与 manifest 保留原字节；日志当时用 gzip 保存，映射中的 SHA 指向解压后的原字节。截图与 gz 日志已于 2026-10-13 裁剪，[SHA256SUMS](SHA256SUMS) 与 selection.json 仍记录其路径与 SHA-256，不把它冒充完整运行目录的 artifact 集合（见[档案裁剪](../../README.md#档案裁剪)）。

原 manifest 仍列出未公开的完整 trace、临时 profile/认证配置和执行文件，这是刻意保留的原始事实。完整原目录已经通过必要产物合约，身份/用户数据目录未公开。公开截图曾包含必要窄屏、宿主和 native 样本，设计对照保存全部 36 张，这些媒体已于 2026-10-13 裁剪。新 README/summary 为归档说明，另列入公开 SHA，不伪装成当时运行输出。

复跑（Windows PowerShell，仓库根目录）使用已安装 Edge：

```powershell
$env:PHANERIS_TEST_BROWSER_CHANNEL = 'msedge'
bun run test:theme-foundation
bun run test:theme-contract
bun run test:theme-roles
bun run test:theme-domains
bun run test:theme-browser-host
bun run test:theme-login
bun run test:theme-design
bun run test:theme-governance
bun run test:markdown-popout
bun run test:theme-native
```

每次生成唯一目录。浏览器 fixture 工作流按顺序运行，避免共用 Vite 优化缓存产生干扰；原生命令包含生产构建。macOS/Linux CI 另用对应平台环境，Linux 使用 Xvfb。

## 未关闭的边界

- macOS/Linux CI 已接线，本轮尚无运行证据；三平台正式包重启首帧、OS 材质/caption 和签名安装器仍 open。
- 物理移动设备、Safari 横屏/软键盘/safe-area、真实触摸和所有原生遮挡组合仍 open；媒体模拟不能代替实机。
- 长会话主题切换 trace/滚动和最大图片解码成本未在本轮建立前后性能证据；PDF/Pages/ANSI 的所有权检查不代表任意用户内容全覆盖。
- [视觉债务账本](../../../../scripts/visual-debt-ledger.json)登记 1,213 个存量例外，具备 owner/reason/exit/指纹与数量；新增长被阻挡，存量没有被宣称清零。
- 2026-10-11 second-wave 的一份历史日志缺失，保留[精确例外](../../../../scripts/doc-artifact-exceptions.json)和原 SHA，文档门禁明示 warning；没有补造该日志或改写冻结证据。
