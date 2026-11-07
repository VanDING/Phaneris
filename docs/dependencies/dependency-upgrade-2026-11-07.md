# 2026-11-07 依赖升级实施与验收

状态：计划内升级已完成，Windows 本机验收通过。日期：2026-11-07，Asia/Shanghai。

用户要求先提交全部现有改动，不推送，再完整实施评估中的升级计划。2026-11-07 验收结束时的状态如下：快照提交为 `8537566591090b8154b41d16b1aea4b8870ddc32`，原工作区 `E:\Phaneris` 保持该提交且 tracked 文件干净；升级改动位于 `E:\Phaneris-dependency-upgrade-20261107`、分支 `codex/dependency-upgrade-20261107`，当时尚未提交。2026-11-08 用户追加提交、合入本地 main 和清理其他本地分支的指令；本报告及产物中的原工作区、分支名保留为验收溯源标识。没有推送或发布。

## 范围与目标

- 采用 [全量评估](dependency-audit-2026-11-07.md) 的 P0/P1/P2，共 75 个 npm 直接控制项、5 个 Python 包，以及相关运行时和 Actions；用户后续将 Electron 45.2.3 加入最后一个独立批次。
- [最终目标](upgrade-2026-11-07/targets.json)记录 Electron 目标变更及原目标；[首批官方包元数据](upgrade-2026-11-07/selected-metadata.json)、[Electron 45 元数据](upgrade-2026-11-07/electron-45-metadata.json)保留约束及 tarball integrity。
- 保留 Pi 1.5.0 四包、react-pdf/PDF.js、FullCalendar、Sentry core 配对及有效补丁；其余 P3 迁移继续按原兼容边界处理。
- [实施前失败矩阵](../verification/dependency-upgrade-2026-11-07-failure-matrix.md)先于升级改动编写；新增回环 Images API 验证先复现失败，再修复输入边界。

| 类别 | 已实施目标 |
| --- | --- |
| 安全 | follow-redirects 1.16.2、Pillow 13.0.0、pypdf 6.21.4、Undici 8.12.4；自己控制的 glob 14.0.4 链 |
| 桌面与开发运行时 | Electron 45.2.3（44.10.2 保留为前一阶段基线）、Bun 1.4.4、uv 0.13.7、CPython 3.12.16、项目 Node 24.22.2 |
| 网络与 SDK | MCP 1.32.2、jose 6.2.15、OpenAI 7.53.0、Smithy core 3.39.0；消息 SDK 按冻结清单维护 |
| 编辑器与显示 | Tiptap 3.33.0、Shiki 4.6.0、React/DOM 19.3.1、Motion 14.10.1；Radix 与面板库配套更新 |
| 规划与本地化 | Gantt 2.8.2 / Grid 2.7.6、i18next 26.7.2 / react-i18next 17.1.13 |
| 构建与分发 | Vite 8.3.6、React 插件 6.2.1、Tailwind 4.3.5、ESLint 10.14.0、builder 26.18.1；Actions 保留完整 SHA |
| 其余 Python | pypdfium2 5.15.0、markitdown 0.1.9、click 8.5.1，保留全部原 extras |

逐声明与实际锁版本见[解析图记录](upgrade-2026-11-07/resolved-graph.json)：75 个控制项中 74 项已经解析到目标；`@shikijs/transformers` 的 override 已改为 4.6.0，但当前没有消费者，Bun 清除了旧孤立条目，没有为凑数添加新依赖。

外部 npm 锁图从 1,477 名 / 1,830 实例变为 1,476 名 / 1,815 实例；包含 13 个 workspace 时分别为 1,843 和 1,828 个键。相同锁键有 198 项版本变化，新增 34 键、移除 49 键，另有 1,583 项仅来源变化。同版本同锁键的 integrity 没有变化。传递主版本变化来自新父包自己的声明范围，未增加跨主版本的全局强制覆盖。

## 已落实的兼容与安装处理

1. OpenAI SDK 7.53.0 的响应类型新增 GIF/SVG。适配器在唯一输入边界明确只接受 PNG/JPEG/WebP，保留验证失败后的已报告 usage；没有扩大产品支持格式。
2. PostCSS 用 `postcss-selector-parser@6.0.10` 版本限定覆盖到 6.1.5，保留同一主版本；Smithy 仅按所有父范围允许的 3.39.0 定向解锁，没有增加直接依赖。
3. Pi coding-agent 精确固定 Undici 8.12.3。按原评估中的 8.12.3 更新目标，增加只替换该版本的 8.12.4 覆盖；没有影响 Undici 6/7 或改变 Pi 包版本。
4. npm tarball 来源从旧镜像规范到官方 registry；Bun 1.4.4 重写锁格式后官方来源可表示为空串。来源规范与实际版本变动须分别统计，不把锁文件行数当作额外升级项。
5. 本机 CLI 不自动继承 Windows 系统代理；下载验证使用本次进程的显式代理配置。没有修改用户全局代理，未关闭 TLS 校验。
6. 验证用 Bun 1.4.4、uv 0.13.7、Node 24.22.2 来自官方分发并核对 SHA-256；产品 Python 3.12.16 已实际启动。`.node-version` 记录项目 Node 维护线，未替换系统级 Node 安装。
7. Actions 除带版本注释的调用外，也核对了未注释的调用；全部 6 处 upload-artifact 均固定在 v7.0.2 的完整 SHA，2 处 setup-uv 固定在 v10.3.3 并使用 uv 0.13.7。逐 job 参数保留在[工作流 pin 清单](upgrade-2026-11-07/workflow-pins.json)。
8. Electron 45.2.3 的实际二进制已启动，确认 Chromium 156.0.8078.80 / Node 24.22.2；[运行时记录](upgrade-2026-11-07/electron-45-runtime.json)。主窗口和工具栏已有 Node preload 使用原先的非沙箱配置，沙箱网页视图不加载这些 preload；没有放宽任何 sandbox、contextIsolation 或权限策略。ASAR 原本为 false，项目及当前 Sentry 包未发现 contentTracing 调用。按 [45 官方变更](https://www.electronjs.org/docs/latest/breaking-changes#breaking-api-changes-450)安排专项和完整复验，而非据此推定已兼容。

## 验证记录与边界

最终验收使用 Electron 45.2.3 及同一份锁图，`bun.lock` SHA-256 为 `f5bb8111a4a7e07a9221916fed1b62136f3c7116a08de7704ce8eecd7297f196`。完整命令、时间、日志哈希、源文件哈希及保留的失败历史见[验收记录](upgrade-2026-11-07/results/acceptance.json)。

| 最终验证 | 结果 |
| --- | --- |
| 官方 registry frozen install | 通过，锁身份未变 |
| `bun run validate:ci` | 通过，包含类型、lint、i18n、治理、身份、版本及文档门禁 |
| `bun run test` | 通过，11 个工作区与 54 份隔离文件；[工作区汇总](upgrade-2026-11-07/workspace-summary-45.json) |
| critical 分段验收 | 71 个 E2E 工作流、1,033 个场景和 6 个包检查组，77 项通过；完成时重新核验全部必需产物、文件哈希和锁身份；[45 汇总](upgrade-2026-11-07/critical-summary-45.json) |
| Electron 生产构建 | main / preload / renderer / resources / assets 全部通过，13 个必需产物齐全 |
| Electron 45 原生宿主 | 13 项通过：真实 main / preload / BrowserViews、主题交付、200% 缩放、外部网页隔离、无未处理异常 |
| Windows 未签名 unpacked | 4 项父流程通过；仓库外实际程序完成 7 项原生附件 / ConPTY 和 6 项重开 / 多实例 / 深链 / Gantt 检查；实际版本为 Electron 45.2.3、Chromium 156.0.8078.80、Node 24.22.2；[原生验收哈希汇总](upgrade-2026-11-07/native-summary-45.json) |

前一阶段还完成了两个跨 realm 敏感请求头重定向验证、25 项缓存/OCR、8 个文档工具共 20 次 CLI、6 个 PDF、5 个 Images 格式边界以及 WebUI/viewer 生产构建。最终 critical 已在 45 锁图重新覆盖文档、PDF、Images、MCP、Undici 和主要 UI 流程。完整 trace、截图、生成文档和未签名二进制保留在验收记录所指的本地产物路径；Git 中保存可审阅的精简记录，未把全部本地二进制作为源码提交。

首次 CI 运行发现两个文档环境问题：新增评估未挂索引（已修正）；独立 worktree 缺少原工作区已有但被忽略的历史验证产物。78 个历史链接对应的 61 个目录均可在原工作区找到，已按原内容复制用于本地文档验收，没有编造替代证据、改历史文档或放宽门禁。这不能证明一个不携带历史产物的全新 checkout 已通过文档门禁。

最终安全门禁无新增 HIGH/CRITICAL；原始 npm 审计仍有 4 条命中：旧父链的 glob/minimatch、KaTeX，以及已本地修补但版本号仍命中的 OCR。没有扩大安全 allowlist，剩余命中不记为已消除。保留全部 extras 的 Python 新解析树共 43 包，逐包 OSV 查询无匹配；这只代表本次查询结果。

规划性能工作流在旧依赖快照同样失败：第二窗口在初始路由恢复完成前切入日历，随后日历被默认会话隐藏。补齐与首窗口一致的 splash / Projects 就绪等待后，20 项场景通过；没有改变产品导航、DOM 选择器、广播次数或性能预算。编辑器原有 `contentMatchAt` schema 错误在旧依赖也可复现，既有工作流已显式列为已知限制，没有新增豁免。

完整 critical 验收另发现两处过时夹具：治理模拟仓库缺少门禁要求的 `resident-role` 纯入口（旧依赖复现同一错误）；客户端仍使用旧 `Files` 按钮，而当前快照的 `Info` 只列会话目录，工作目录文件应从 `Files > Browse` 进入，故改用既有 Open Files Panel 快捷键，并补齐初始路由就绪等待。均只同步测试夹具与现有产品状态，没有降低门禁或删减断言。旧依赖客户端整场复跑停在服务器启动 deadline，未到达文件定位断言；该限制另行保留。每个场景首次纳入分段清单时，均检查必需产物及全部产物 SHA-256；后续复用检查原始 manifest SHA-256 与相同锁文件身份，保留先前完整验证记录。依赖与产品代码在分段间没有变化。

身份门禁只增加一条审计来源例外：允许 11 月官方 npm 元数据中 beautiful-mermaid 原发布者的精确仓库 URL，与 10 月已有规则采用相同范围；没有扩大产品身份例外。原评估中四份文本证据经首次 Git 提交转换为 LF 后，已重算 SHA-256，并保留转换前哈希、字节数与原因；数据内容没有变化。

旧 B1 SDK 检查仍固定在 Pi 1.3.0，旧依赖基线也立即失败；同步为当前快照已有的 Pi 1.5.0，并按其发布元数据检查 TypeBox 的实际所属父包。保留 Anthropic/OpenAI/semver 的精确 pin；新增断言确认只有 Undici 8.12.3 通过限定覆盖实际解析成 8.12.4，没有全局覆盖 Undici 6/7。

计量工作流另有摘要 cap 的旧断言，与当前 Pi 1.5 自定义端点策略及 PC-05 断言冲突；旧依赖在同一行复现。同步为精确检查两个 cap 字段均不存在，完整保留账本、费用、用量、恢复和上下文断言，16 项通过且 known-issues 为空。最后一个隔离检查的整模块 mock 缺少新增导出，旧依赖同样无法链接；按现有 partial-mock 模式保留真实 workspaces 导出后，原 3 项检查通过，没有新增单元测试或改动断言。

45 验收中另发现两处就绪时序问题。客户端主动重连时，后台 `session_created` 的 `readMessages` 仍未返回，产生取消读取的错误日志；夹具现在从真实 WebSocket 请求/响应观测读取完成后再主动断开，保留全部断网、重连、持久化和零意外错误断言，连续两轮 27 项通过，没有日志豁免。此工作流使用独立 Playwright Chromium，不能把该现象归因为 Electron 45；重连恰好打断后台读取时的错误日志仍是一项已观察到的行为。

设置夹具的诊断复测捕获到：磁盘值已写入，但 UI 保存 RPC 尚未应答即被测试重启服务取消。选择操作现在等待请求发出、应答完成及输入恢复可用，保留落盘、重启、失败重试、账本与计量断言；连续两轮完整 12 项通过，待处理写入均为零。另一次最初的落盘超时没有捕获具体异常，原因仍不确定；没有据此改动产品存储代码或声称修复了已定位的产品缺陷。成功与预期失败 RPC 的实际结果一并保留。

Electron 44 基础阶段的 critical [汇总](upgrade-2026-11-07/critical-summary.json)及对应的[目标](upgrade-2026-11-07/stage-44-targets.json)、[锁图](upgrade-2026-11-07/stage-44-resolved-graph.json)单独保留。44 的第一次打包父流程因旧 sidebar 就绪条件失败；修正后在同一 44 unpacked 上完成 6 项重开检查。最终 45 打包父流程独立通过，未把这次旧失败改写成成功。

macOS/Linux、容器实际镜像/系统包、签名安装器和真实供应商账户不属于本机已验证结果。不推送、不发布，不覆盖旧 release。
