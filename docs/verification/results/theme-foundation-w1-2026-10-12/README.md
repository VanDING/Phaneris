# 主题治理 W1：实施与浏览器验收

- 日期：2026-10-12（Asia/Shanghai）。
- 范围：[治理方案 W1](../../../process/theme-engine-frontend-governance-plan-2026-10-12.md) 的 F01/F02/F03，及偏好重连补读。
- 状态：**本机浏览器门通过；全面主题治理、正式包与跨平台发布验收仍 open。**
- 分支：`codex/theme-governance-w1`，从包含 `7891559` 的 `main`（`cc5401c83`）开始。
- [事先失败矩阵](../../theme-foundation-failure-matrix-2026-10-12.md)与工作流先于产品修复建立。

## 实施

| 问题 | 实际改动 | 验收 |
| --- | --- | --- |
| F01 / API ready | WebUI 将 ThemeProvider、Toaster 和 workspace atom 读取移入 ConnectedApp；initializeClient 成功后才挂载 | 真实认证 HTTP/WebSocket、生产 WebUI、临时 config；无缓存冷启动、过期 v3 缓存、跨客户端 mode/color/font、离线丢失事件、重连、刷新、初始化失败重试 |
| 重连偏好 | ThemeContext 在断线恢复为 connected 时补读；共用 preferenceGeneration；沿用 startup-only 旧缓存迁移 | 浏览器受控迟到读取：事件/本地保存胜过旧响应；重连不再次迁移；StrictMode 的订阅和 unmount 清理 |
| F02 / 默认焦点 | controls.css 的 base 层提供默认 2px outline；删除两个入口的全局 outline:none；保留组件包装层、inset 与显式 ring 策略 | 四入口 × light/dark 的按钮、链接、Button/Input、包装输入、列表、Select 键盘与 Esc 恢复；forced-colors；390px、root18px |
| F03 / 阴影别名 | 两入口导入同一个 shadow-aliases.css，单向映射到现有语义高程；语义配方与强度保持 | 四入口 × light/dark × static/五种 depth；八个 legacy 名称、hover xs→md；原始与归一化 computed shadow 均归档 |

映射：`2xs→minimal-flat`、`xs/sm→minimal`、`shadow/md→middle`、`lg→strong`、`xl/2xl→modal-small`。Tailwind 自带的透明零尺寸 ring/inset 占位层不参与绘制比较；原始字符串保留。先等待有限 CSS 动画/过渡完成再采样。WebUI 的 120% CSS zoom 会使 computed outline 宽度量化，验收记录 zoom 与实际绘制宽度，未改变产品 CSS 的 2px 规则。

## 结果与证据边界

| 结果 | 数量与口径 |
| --- | --- |
| 当前专项工作流 | **101/101 场景通过，0 pageerror**；Windows x64、Bun 1.4.2、Node 24.15.0、Edge 155.0.4283.45；完整 VerificationRun 已校验 SHA |
| 修复前记录 | 23 pass / 78 fail；包含目标问题，也包含夹具早期几何容差与 route 清理问题；不把失败数当产品缺陷数 |
| 既有主题/存储检查 | 22/22，通过；未新增实现后的单元测试 |
| 既有预览卡片回归 | 18/18，0 pageerror / 0 console error；空 favicon 声明修复 Edge 的夹具 404；首轮依赖优化/404 失败记录保留在本地，未放宽门禁 |
| 全仓类型检查 | `typecheck:all` 通过；最终修改后的 tooling 类型检查通过 |
| ESLint 与架构检查 | workspace 2218 文件、72 条既有登记 warning；修改文件 0 errors / 0 新 warnings；runtime/architecture/events/governance/IPC/boundaries/cycles/contracts 均通过 |
| 注册与字体 | critical preflight：23 工作流、6 package groups；锁定 policy 同步；字体 gate 通过 |
| 完整 lint | 未全绿：未修改的 check-distribution.ts 把 Bun.Glob 的 Windows 反斜杠路径与 Docker POSIX COPY 字符串直接比较，产生 13 条既有失败 |
| 文档 gate | 未全绿：HEAD 已存在的归档 README 指向未入库的 `logs/second-validate-full-final.log`；本批文档未新增断链 |
| 机械设计扫描 | 一条既有 sidebar height transition warning；未扩展本批范围 |

前后夹具经历了修正：补齐 Tailwind 编译前的 fixture source 注册、正确处理透明占位层与 OKLab 字符串、等待过渡终态、独立清理媒体/viewport/菜单状态；末轮还等待真实业务外壳加载后截图。原始记录未改写，因此场景总数不能作为同口径改善 KPI。

公开归档保留选取的原始 manifest、JSON 与构建/源码摘要；截图和 `.log.gz` 已于 2026-10-13 裁剪，[archive-selection.json](archive-selection.json) 与 [SHA256SUMS](SHA256SUMS) 仍记录其路径与 SHA-256，可核对“当时存在过什么”（见[档案裁剪](../../README.md#档案裁剪)）。完整本机输出及 trace 在 `.cache/verification/theme-foundation-w1-ready/`，每次重跑使用独占目录。浏览器 trace、临时 config、认证数据库、workspace 和较早环境/夹具调试轮留在本地，避免把临时认证信息与缓存加入仓库。这里的原始 manifest 含排除项，不能把公开摘录当成完整 VerificationRun 目录。

原始构建日志包含构建器自己的尾空格与空行，当时以无损 `.log.gz` 归档；该 gz 已于 2026-10-13 裁剪，选取清单与 SHA256SUMS 仍记录压缩文件 SHA 和解压后原始字节 SHA，未清洗或改写原日志。

## 截图

本节截图已于 2026-10-13 裁剪；[SHA256SUMS](SHA256SUMS) 仍记录其路径与 SHA-256（见[档案裁剪](../../README.md#档案裁剪)）。

| 场景 | 入口 |
| --- | --- |
| 真实 WebUI Geek cold start / Ink reload | 已裁剪（2026-10-13） |
| Electron 样式 light/dark | 已裁剪（2026-10-13） |
| 共享 UI / Viewer / WebUI | 已裁剪（2026-10-13） |
| 窄屏 inset 焦点 | 已裁剪（2026-10-13） |

## 重跑

```powershell
$env:PHANERIS_TEST_BROWSER_CHANNEL = 'msedge'
bun run test:theme-foundation
bun run scripts/verification/verification-artifacts.ts --verify=<本次唯一输出目录>
```

CI 使用 Playwright Chromium；本机使用 Edge。完整 gate 同时核对 registry 的 minimum=101 与必要产物。不要写回冻结归档目录。当前验收没有替代正式 Electron 包、原生材质/标题栏/BrowserView、macOS/Linux、物理触摸设备、移动 Safari/软键盘、workspace/file watcher 丢失事件、Viewer Shiki 或对比度/token parity；这些仍属 W2–W5 和 H01–H11。
