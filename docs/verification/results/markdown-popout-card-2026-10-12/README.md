# 对话与行为预览卡片回归（2026-10-12）

状态：**源码已恢复，浏览器18/18场景通过；正式Electron包与三平台原生验收未执行。**

用户图一的Message Preview / Response Preview来自`MarkdownPopoutOverlay`。`4281be993`的Files面板收敛把内容改为直接渲染在PreviewOverlay中，省略了卡片，并把源码查看统一成格式化Markdown。上游`refs/upstream-tags/v0.14.1`的`ChatDisplay`仍区分`forceCodeView`，使用CodePreviewOverlay的Read/response.md/代码卡片。

本次增加明确`renderMode`：普通消息、回合和行为详情用共享ContentFrame承载格式化阅读；“查看Markdown”入口恢复现有CodePreviewOverlay、源码符号、行号与代码卡片。ContentFrame的preferred minWidth按可用空间限制，避免850px的源码卡片在390px窄屏溢出。Files面板职责和既有popout状态路径保持。

先写的[失败矩阵](../../markdown-popout-card-failure-matrix-2026-10-12.md)；整体[主题与视觉治理方案](../../../process/theme-engine-frontend-governance-plan-2026-10-12.md)。冻结的独立审计证据属于修复前的基线，本目录记录追加的具体修复。

## 前后结果

| 阶段 | 场景与结果 | 证据 |
| --- | --- | --- |
| 修复前 | 18场景：2 pass、16 fail；16项均为缺少独立卡片。无pageerror/console error | [JSON](before/markdown-popout.json) / [失败manifest](before/manifest.json) / [日志](markdown-popout-before.log) |
| 修复后 | 18场景全部通过；无pageerror/console error | [JSON](after/markdown-popout.json) / [manifest](after/manifest.json) / [日志](markdown-popout-after.log) / [trace](after/trace.zip) |
| 类型与lint | Electron/UI/scripts类型检查通过；修改文件的专用/通用lint为0 errors、0 warnings | 本目录`markdown-popout-*-typecheck.log`与`markdown-popout-*-lint.json` |
| 验证接入 | `test:markdown-popout`独立入口；critical registry要求18个非零场景及JSON、截图、trace | [工作流](../../../../scripts/verification/markdown-popout-workflow.ts) / [fixture](../../../../scripts/verification/fixtures/markdown-popout.tsx) / [registry](../../../../scripts/critical-scenarios.ts) |

环境：Bun1.4.2、macOS x64、Chromium153.0.8010.12；DPR1、1440/1100/390px宽、高900px，实际ThemeProvider与Shiki provider、Jotai状态、生产overlay。账号、偏好bridge与内容为合成数据。当前modalBreakpoint=99999，所有样本实际为fullscreen，未宣称modal分支通过。

补充[检查记录](checks.json)、[修改源码摘要](source-hashes.json)、[文档门禁](docs-check.log)和[critical入口检查](critical-preflight.log)记录本次收口。

短消息卡片960×320px、源码卡片850×320px；390px屏幕中的源码卡片345×320px，左右保留约22.5px。实测圆角12px，使用当前主题的surface/shadow；恢复的是图二的卡片结构与源码路径，未调整全局主题色或阴影强度。

| 对照 | 截图 |
| --- | --- |
| 单个消息 | [修复前](before/message-light.png) / [修复后](after/message-light.png) / [dark](after/message-dark.png) |
| Markdown源码 | [修复前](before/source-light.png) / [修复后](after/source-light.png) / [dark](after/source-dark.png) |
| 回合与行为 | [turn](after/turn-light.png) / [activity](after/activity-light.png) |
| 窄屏 | [message](after/message-390.png) / [source](after/source-390.png) |
| 长文/长代码尾部 | [document](after/long-end.png) / [source](after/long-source-end.png) |

长内容保留单层外部paper scrolling；点击链接/文件仍调用原回调；Escape/close关闭，焦点恢复；替换popout不残留前文。源码入口在真实ChatDisplay传递`renderMode:'source'`，已源码审查及类型检查；浏览器范围是fixture→实际状态→生产overlay，未冒充完整ChatDisplay/真实会话或正式包验收。

## 复现与完整性

仓库依赖与Playwright Chromium就绪后，在仓库根运行：

```sh
bun run test:markdown-popout
bun run scripts/test-critical.ts --preflight
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/markdown-popout-card-2026-10-12/after
```

工作流默认生成唯一`.cache/verification/markdown-popout-*/`，错误运行同样保留manifest、JSON、截图和trace。`--output-dir=<尚不存在的目录>`可指定新位置，拒绝覆盖历史目录。完整`test:critical`本轮未重跑；该registry已接入现有CI的关键工作流链。

`before/manifest.json`的exitCode=1是预期回归失败；`after/manifest.json`的exitCode=0。归档保留原manifest与产物SHA；本目录另外提供[SHA256SUMS](SHA256SUMS)，可在此目录执行`shasum -a 256 -c SHA256SUMS`。真实正式包、原生材质、三平台和自定义主题矩阵继续按整体治理的H场景闭环。
