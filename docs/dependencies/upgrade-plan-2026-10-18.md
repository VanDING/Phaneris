# 上游 0.15.3 与依赖升级执行规划

日期：2026-10-18，Asia/Shanghai。规划者：Codex；执行者：DSH。

状态：**规划完成，实施结果另行记录**。此文及版本快照不构成升级已经通过验收的证明。

## 1. 决策与基线

选择吸收上游的兼容修复、可配置压缩阈值、HEIC/HEIF 附件和自定义开场提示；保留 Phaneris 已有的用量账本、逐模型输出上限、Pi 单后端架构和视觉体系。依赖更新围绕安全、运行时稳定性、编辑与日历功能，不全仓追 latest。

| 项目 | 本次核实结果 |
| --- | --- |
| Phaneris 基线 | `82714e2ae3b76643ae16ef1d3a6abfe66e8bf574`，版本 0.3.2，开始评估时 main 工作区干净 |
| 上次吸收 | 已完成 0.15.0 / 0.15.1，见[实施记录](../verification/upstream-0.15-non-ui-implementation-2026-10-15.md) |
| 本次上游范围 | `refs/upstream-tags/v0.15.1..refs/upstream-tags/v0.15.3`；0.15.2 为 `b879152d2`，0.15.3 为 `22c9f0414`；102 个变更文件 |
| JS 盘点 | 14 份 manifest；179 个直接/override/patch 控制项；1,833 条外部锁实例、1,468 个外部包名；74 个控制项有更高稳定版 |
| Python 盘点 | 8 个 PEP 723 脚本、12 个直接固定包；逐包复核 PyPI |
| 批准更新 | 37 个现有 npm 控制项、2 个 Python 包；Bun / uv；验证环境使用 Node 24.22.0 |
| 功能新增依赖 | HEIC 功能引入 `heic-convert 2.1.0`、开发类型 `@types/heic-convert 2.1.1`、Python `pillow-heif 1.8.1` |
| 当前安全审计 | 5 条已知公告：1 CRITICAL、1 HIGH、2 MODERATE、1 LOW；没有新增 HIGH/CRITICAL。两条本地补丁不能因版本扫描仍命中就认为失效 |

所有目标在 [targets.json](upgrade-2026-10-18/targets.json) 中冻结。完整逐包判断见 [catalog.csv](upgrade-2026-10-18/catalog.csv)，Python 见 [python.csv](upgrade-2026-10-18/python.csv)，批准版本的 registry 元数据、依赖约束与 tarball integrity 见 [selected-metadata.json](upgrade-2026-10-18/selected-metadata.json)。

相较 10-16 审计，Electron 目标从 44.8.0 修订到 **44.9.0**，pypdf 从 6.21.0 修订到 **6.21.1**。今天的新 i18next 26.5.2 / react-i18next 17.1.0 留待观察，本次选已经核实的维护线 26.4.7 / 17.0.20。

## 2. 上游逐项取舍

依据 [0.15.2 发行说明](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.2)、[0.15.3 发行说明](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.3)及本地 Git 对应源码差异。

| 上游变化 | 决策 | 本项目适配要求 |
| --- | --- | --- |
| Anthropic 工具 schema 的 `additionalProperties` 修复 | **实施，B1** | 本地 interceptor 仍会删除 `false`；Pi 子进程同样加载它。只修 Anthropic Messages 路径，注入的 `_intent` / `_displayName` 必须先进入 properties；保留 OpenAI 等协议各自语义 |
| Pi 上下文信息按当前模型读取 reserve | **实施，B1** | `packages/pi-agent-server/src/context-usage.ts` 当前未传 `session.model`；按当前模型读取 SDK 设置，切模型后上下文条应立即正确 |
| Pi 只统计最后一次调用的修复 | **保留现有架构，补流程验收** | Phaneris 的 `SessionManager` 从 durable usage ledger 投影累计量，complete 不再累加。因此不搬上游 `turnOutputTokens` / `addTurnUsage`；验证多次工具调用、失败重试、恢复、分支和 cache warming 无漏记/重复 |
| 分支重复计算父会话费用 | **同上** | 不引入 Claude 的 runningTotals 或复制父账本；以本项目请求级事实与分支归属验收 |
| 自定义端点统一 maxTokens | **不照搬，验证已有能力** | 本地已支持每模型 maxTokens，默认 16,384，优于上游原来的 8,192；保留逐模型能力、价格、thinking map、inputLimits、promptCache。不得改回 8,192 或增加一套竞争优先级；验证非默认上限能到实际请求及压缩调用 |
| OpenCode Go 预设 | **已有；仅做 Pi 1.3 兼容，B1** | 已有 OpenCode / OpenCode Go，不能再增加重复预设。新 SDK 更改端点/协议，按下述端点约束适配；模型 ID 继续可编辑 |
| Pi 自动压缩阈值 | **实施，B4** | 作为可选设置，默认保持 SDK 行为；完整打通设置、持久化、RPC、会话初始化、Pi settings 与上下文显示。按当前模型限制；不能依赖 Claude CLI |
| HEIC/HEIF 图片 | **实施，B4** | 附件存储、预览、缩略图、模型上传、headless 图像处理和 Python 图片工具完整支持；服务端转换后 mime/base64/size/path 保持一致 |
| 自定义 Chat Starters 及来源/技能 mentions | **实施，B4** | 工作区级最多 3 条；使用现有富文本编辑器和样式；保存立即更新；点击时解析并启用正确的来源和技能，保留现有权限及来源就绪机制 |
| 会话信息面板滚动 | **不直接套用，B4 验证后定点修复** | 本地 SessionFilesSection 已自带纵向滚动，而且同时支持 popover/drawer；先验证长列表与小窗口，再决定是否需要改容器，避免双滚动条 |
| 低置信度时自动从 max 降至 high | **暂缓** | 上游依据其自有样本做成本优化，不能证明对本项目质量有效；保留本地更严格的输入校验、低置信度保留会话级别及用户质量偏好 |
| Claude 子代理模型控制、Claude 成本累计与专属提示词 | **不吸收** | 本项目以 Pi 为运行后端，不重新引入 Claude SDK / Claude 专属模型别名和工具语义 |
| 上游版本、品牌、README、旧依赖及布局改动 | **不吸收** | 不合并整个上游提交、不覆盖本项目 identity、版本和近期 UI 治理结果 |

### B1 的端点约束

[Pi 1.3.0](https://github.com/earendil-works/pi/releases/tag/v1.3.0)改进恢复工具、模型切换时的思考隔离、畸形工具参数拒绝、Bun codemode 取消与 worker 回收，并将内部 Pi 包改为精确版本。这些都命中本项目的会话路径，值得整组更新。

- Kimi Coding 的原生提供方切换到 Chat Completions，SDK 的 base URL 是 `https://api.kimi.com/coding/v1`。当前 UI 仍展示 `/coding`，需联动检查预设选择、provider 类型、实际请求适配器。**不要把用户明确配置的 Anthropic 兼容连接自动变成另一协议**；旧默认地址只可在匹配原生 provider 与已知默认值时规范化。
- OpenCode 的[官方模型接口](https://opencode.ai/v2/docs/console/models/)与 [Go 接口](https://opencode.ai/v2/docs/console/go/)已按协议分流。Chat Completions 的 base URL 分别是 `https://opencode.ai/inference/openai/v1`、`https://opencode.ai/inference/go/openai/v1`；它们不是 Anthropic / Google / Responses 模型的通用地址。
- 更新新建预设时保留协议选择与模型编辑；旧配置采用严格匹配的运行时兼容处理，不批量改写用户配置，不碰用户自定义域名、代理路径或模型 ID。优先让原生 Pi provider 使用其模型目录；不要将目录里所有模型强行路由到 Chat Completions。验证稳定会话标识与现有请求头不丢失，不记录真实凭据。

### B4 的两个关键适配风险

**压缩阈值：** 上游以 `max(SDK reserve, model.contextWindow - chosenWindow)` 调整 reserve。Pi 同时用 reserve 计算摘要输出预算，直接搬运可能把摘要预算一起放大。DSH 必须检查 1.3.0 的公开 API / hook，保留当前正常摘要预算上限（基于原 SDK reserve 和模型 maxTokens），将提前触发与生成预算区分开。验证实际压缩请求的 maxTokens。不得用修改 node_modules、无界预算或重复压缩循环来凑功能。若没有可靠接入点，记录具体技术阻断，保留默认行为并继续其他独立项。

设置维持上游可理解的 100,000–1,000,000 整数范围与 null 恢复默认，超过当前模型有效窗口时沿用该模型安全触发点；应用时机明确为新建/重启会话，模型切换重新计算。不得启用用户未选择的 400K 默认，也不引用上游成本降幅作为 Phaneris 收益。

**HEIC：** 上游仅凭 `mif1` 等通用 ISO-BMFF major brand 认定 HEIC，存在误判 AVIF 的风险。实现需结合实际品牌/兼容品牌、MIME 与格式验证，明确排除 AVIF。只转换 HEIC/HEIF；遵守原有 16 MiB 传输及图像限制。大像素/损坏文件的解码必须有资源边界，不能长期阻塞主进程；解码失败保留草稿、给出可读错误。原始用户磁盘文件不改写。新增 decoder 必须真正进入 Electron 与 server 构建，不能只在源码开发模式可用。

## 3. 依赖执行清单

同一个包出现在多个 manifest 时同步修改全部受控声明；既有精确固定继续精确固定。具体版本以 targets.json 为准，不在执行时追逐新的 latest。

| 批次 | 包 / 组件族 | 当前 → 目标 | 价值及约束 |
| --- | --- | --- | --- |
| B1 | Pi 四个直接包 | 1.2.0 → 1.3.0 | 统一精确固定；内部 telemetry/mcp/tui 等由 1.3.0 自己决定；不强制覆盖 Pi 的 openai 7.19.0 / undici 8.10.2 |
| B1 | http-cache-semantics | 本地修补 4.2.0 → 4.3.0 | [已知 HIGH 公告](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)的正式修复；原共享缓存防护流程必须通过，再停用 patch 注册。旧 patch 文件保留为历史，不删除 |
| B1 | pypdf | 6.19.0 → 6.21.1 | [官方 changelog](https://pypdf.readthedocs.io/en/stable/meta/CHANGELOG.html)有循环树、解析工作量与 JPEG 解码路径加固；更新所有 PEP 723 固定声明 |
| B1 | pypdfium2 | 5.13.0 → 5.14.0 | [官方版本](https://github.com/pypdfium2-team/pypdfium2/releases/tag/5.14.0)改善短读取错误处理、bitmap 释放与 GC，并更新 PDFium；不能将作者称为理论加固的部分夸大为已证实漏洞 |
| B1 | MCP SDK / Zod | 1.32.0 → 1.32.1；4.6.5 → 4.6.7 | 当前兼容系列维护；重点验证 stdio、HTTP、OAuth、resources/prompts 与 schema |
| B1 | 直接 undici | 8.11.2 → 8.12.2 | 当前系列维护；流式、代理、取消；不跨父约束强行去重 |
| B2 | Electron | 44.5.1 → 44.9.0 | [官方说明](https://releases.electronjs.org/release/v44.9.0)列出新窗口 session/webPreferences 继承及证书校验并发修复；内嵌 Chromium 152.0.7977.167 / Node 24.22.0。同步根、workspace、electronVersion |
| B2 | Bun / @types/bun | 1.4.2 → 1.4.3 | [官方说明](https://bun.sh/blog/bun-v1.4.3)包含 Windows 安装挂起、流取消、SQLite 等修复；统一 packageManager、CI、Docker、打包运行时及类型。**保留 tsc 门禁，不顺便改用新 bun check** |
| B2 | uv | 0.12.22 → 0.13.1 | [官方说明](https://github.com/astral-sh/uv/releases/tag/0.13.1)修复卸载边界及并发写入/安装问题；统一 CI 与随包二进制；不启用 preview 功能 |
| B2 | Node 验证环境 / 类型 | 本机 24.15.0 → 独立 24.22.0；types 24.19.1 → 24.19.2 | [官方版本索引](https://nodejs.org/dist/index.json)确认 24.22.0 LTS；使用仓库缓存中的 portable 验证环境，不替换系统全局 Node。容器此前已为 24.22.0，需按新 Bun 镜像重新验证 |
| B2 | Vite / React 插件 | 8.3.2 → 8.3.4；6.1.1 → 6.1.2 | 同系列构建维护；Electron renderer / WebUI / Viewer 三路产物都验证 |
| B2 | Babel core / eslint-parser / preset-typescript | 8.0.6 / 8.0.6 / 8.0.1 → 8.0.7 | 保留 Babel 7 的独立传递分支；preset-react 8.0.1 保持 |
| B2 | ESLint / Sentry Vite 插件 | 10.12.0 → 10.13.0；5.4.0 → 5.4.1 | 同系列维护；不扩大 warning allowlist、不上传 sourcemap 或改遥测配置 |
| B2 | Playwright | 1.63.0 → 1.64.1 | 同步浏览器二进制；真实 Electron/CDP 工作流验收 |
| B3 | Tiptap 13 个直接控制包 | 3.31.4 → 3.32.0 | [官方说明](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0)修复 Markdown 链接转图片、列表类型转换和 React 选择器循环引用；整族更新、ProseMirror 各包不混装 |
| B3 | FullCalendar | 7.1.0 → 7.1.3 | [官方说明](https://github.com/fullcalendar/fullcalendar/releases/tag/v7.1.3)修复受控范围重复渲染、拖拽等问题；react/core/headless 统一 7.1.3 |
| B3 | Temporal / Marked | 1.0.5 → 1.0.6；18.0.14 → 18.1.1 | 随日历、编辑器做当前系列维护；具体收益为维护性，不宣称未经证实的特定 bug 修复 |
| B3 | i18next / react-i18next | 26.4.2 → 26.4.7；17.0.15 → 17.0.20 | 采用维护线；locale、动态切换、插值、富文本翻译回归 |
| B4 | HEIC decoder / 类型 / Pillow 插件 | 新增 2.1.0 / 2.1.1 / 1.8.1 | server-core 声明真实运行依赖，类型仅 dev；PEP 723 精确固定插件；Python 仍用 3.12.15，Pillow 仍用 12.3.0 |

## 4. 暂缓与保持

| 类别 | 本次决定与重新评估条件 |
| --- | --- |
| PDF.js 6.4.299 | **修订旧审计建议，暂缓。** react-pdf 11.0.0 的 registry 依赖精确为 pdfjs-dist 6.3.289；单独升级会产生两版本，容易与公共 worker 打包错配。等 react-pdf 配套版本，或有必要收益时专门做分离 worker 迁移 |
| Pillow 13.0.0 | 10-17 新发布的主版本；本次保持 12.3.0，避免 HEIC 功能与 Pillow 主迁移叠加 |
| Sentry Electron 8 / React 11 / Vite 插件 11 | 跨主版本及遥测行为变化；本次仅 Vite 插件 5.4.1 |
| @open-file-viewer/core 1.0.0、KaTeX 0.19、uuid 14、ExifTool 39 | 各有独立兼容边界、嵌套副本或二进制约束，不能直接覆盖 |
| Radix 13 组件、Motion、Lucide、字体、DnD、resizable-panels、diffs | 近期 UI 已完成尺度、交互与主题治理；尚无命中本项目的充分修复证据，不为新图标或版本数字扰动布局/焦点/动效。逐包候选版本仍在 catalog |
| Gantt/Grid、TanStack Table | 公开版本元数据已确认新版本，但不足以证明当前排期/宽度/受控表格收益；等待具体问题或新功能需求，整族迁移 |
| React 19.3.1 | [该版本](https://github.com/facebook/react/releases/tag/v19.3.1)主要面向 RSC transport，本项目客户端收益有限；react/react-dom 同留 19.3.0 |
| OpenAI 7.38、Lark 1.76、Azure identity 4.14、js-yaml 5.5 | 版本更新存在，但尚无既有实际调用路径需要它们的证据；尤其不要覆盖 Pi 内部 SDK 的精确依赖 |
| Baileys 7 RC、可选 RTK/Tesseract、VS/Windows SDK | 不引入预发行、不安装用户未启用工具、不运行全局或管理员安装器；有需要时独立维护 |
| TypeScript 7.0.2、esbuild 0.28.2、builder 26.17.0、sharp 0.35.5、Shiki 4.5.0 | 此轮无必要更新，保持；sharp 与 @img、Shiki 与 transformer 的现有一致性不得被解析破坏 |
| SheetJS / libsignal | 保持官方 CDN 0.20.3 和 Baileys 控制的 Git SHA；npm 同名元数据不用于这两个来源 |
| Actions / OS 包 / Docker | 保留当前 Actions 主线与已有治理；仅同步本轮运行时 pin。此前 Linux CI 已采样 apt 候选，不凭 Windows 主机推测新系统包状态；新容器的构建/系统扫描是待具备环境的验收项 |

安全剩余项：OCR 的 execFile 补丁继续保留并验证；KaTeX 旧副本、postcss-selector-parser 的父约束与 sprintf-js 无修复版本仍需如实显示。[本次审计原文](upgrade-2026-10-18/npm-audit-before.txt)是实施前基线，不能作为实施后结果。

## 5. DSH 执行顺序与权限边界

用户已要求完成规划后交 DSH 执行，不需要再次询问是否启动。单执行者串行处理：

1. **B0 基线与失败矩阵。** 读取 AGENTS.md 和本计划，检查当前 HEAD/dirty 文件；创建 `codex/upstream-0153-dependencies-20261018` 分支，保留本规划文件。先写 `docs/verification/upgrade-2026-10-18-failure-matrix.md`，保存当前版本、关键功能与安全基线。若有新出现的非本任务更改，不覆盖。
2. **B1 安全和 Pi。** 先升级批准包，再做 Anthropic schema / model reserve 元数据 / Kimi与OpenCode 兼容；复用现有 Pi、MCP、usage ledger 工作流。每完成一组记录真实结果。
3. **B2 运行时和构建。** 使用隔离 portable Bun/Node 与随包 uv，更新仓库 pin；完成安装、构建、原生模块、隐藏浏览器/截图验收。不能替换 DSH/Codex 自己运行所需的全局程序。
4. **B3 编辑与日历。** 整组更新 Tiptap 和 FullCalendar，加维护线内容/国际化更新；保留视觉 contract。每组有针对性的用户流程检查。
5. **B4 上游功能。** 完成压缩阈值、HEIC、工作区 Chat Starters；验证会话信息滚动，只有复现实际缺陷才定点改。上述功能有依赖顺序，不并行写同一工作区。
6. **B5 总验收与交付。** 输出实现记录、机器结果、变更清单、明确的完成/未完成/环境受限项；结果绑定最终源码与锁文件哈希。交回 Codex 复核。

实施可以调整组内顺序以减少重复安装，但最终每一项必须可追溯到 targets.json。不可执行全仓 `bun update` / `--latest` / `audit fix --latest`；锁文件中的传递变化只允许来自本次批准父包、必要同族对齐和已明确的安全修复。检查并说明意外 churn。不要修改 peer 约束、禁用校验或增加全局 override 来强行安装。

**实施边界：** 只允许相关源码、依赖声明、锁、运行时 pin、必要文档和流程验收。不得整体合并 upstream、删除文件/用户数据、重写历史或现有架构、修改真实账户配置、安装/卸载已安装客户端、发布 release、创建/推送标签或推送远端；不改 Phaneris 0.3.2 版本号。没有提交/发布要求时保留可审查工作区 diff。若以后用户授权 push，只能 SSH 到 origin，并完整执行 hook，绝不能 `--no-verify` 或 push upstream。

DSH 工作期间 Codex 对工作区保持只读。若 DSH 权限配置触发真实工具审批，留在 DSH 界面交用户处理，不能通过 MCP 代替批准。

## 6. 验收矩阵

以下是实施前确定的失败场景；DSH 先补齐具体入口/产物，再实施。**不在实现后补单元测试**；复杂功能优先 E2E / 现有 VerificationRun，现有单测可照常运行，低影响声明改动不额外制造单测。

| 范围 | 必须覆盖的失败路径及正向对照 | 产物 |
| --- | --- | --- |
| 安全与 PDF | private/no-store/no-cache/Set-Cookie/Authorization/max-stale 不跨用户命中；公开缓存仍命中；OCR 参数不执行 shell；正常/加密/表单/损坏/循环 PDF 可成功处理或有界失败；PDF 渲染关闭资源 | 现有安全脚本 JSON、原始审计；八个 Python 工具实际启动/代表任务日志；PDF 示例及渲染产物 |
| Pi / MCP | 四包和内部 Pi 包无错配；resume 后工具仍在；切模型不泄漏思考；畸形 tool JSON 不执行；取消/超时无孤儿 worker；重试/错误/压缩仍可恢复；stdio/HTTP OAuth 取消、来源禁用和 prompts/resources 可用 | 真实 Pi 子进程＋回环 provider/MCP 录制，取消后的进程证据；不声称已验真实供应商账户 |
| 端点 | Kimi 原生协议与 /v1 一致；明确 Anthropic 自定义连接不被重解释；Go/Zen 的新预设与老默认兼容；用户自定义 URL/模型/headers 保留；Anthropic 工具请求 schema 符合要求 | 脱敏回环请求和实际序列化 payload；不得使用真实付费 API 或真实 token |
| 账本与输出上限 | 一轮多调用、失败调用、重试、恢复/分支不漏记或双记；warming 独立；output cap 16384 默认和用户逐模型值不退化；上下文占用不拿账单 token 代替 | 请求级 ledger 明细与 UI 汇总对照；源/分支隔离证据 |
| 压缩阈值 | null 默认、合法/非法值、100K/1M 边界、小上下文模型、模型切换、会话重启；提前触发不改变摘要预算、不循环、不破坏手动 compact/cancel；设置失败不伪装保存成功 | 请求预算、触发计数、上下文事件、设置 UI 截图和机器断言 |
| HEIC | 文件选择/拖拽/粘贴；空或错误 MIME；损坏/超限/大像素；AVIF/JPEG/PNG 不误转；转换后预览/缩略图/模型 bytes 与 MIME 对齐；失败保留草稿；Python 图片工具可读 HEIC | 合法来源的最小 fixture 及来源；输出 JPEG/hash；Windows 实际 renderer 与 headless 流程；打包后 decoder 存在 |
| Chat Starters | 0/1/3 条、超量、空白/畸形输入、长文本限制；非法 slug；保存立即显示；重启持久；切工作区不串；来源/技能同时启用、等待就绪；safe 模式及取消行为仍正确 | 使用生产组件的 UI 流程；source-ready 与 send 顺序；中文/英文、键盘与焦点截图 |
| 编辑/日历 | IME 中文、撤销重做、列表切换、`!`+链接、表格/数学/代码与 Markdown 往返；粘贴/上传；时区、跨日全天、拖拽、受控范围不循环；动态切语言 | 既有 Markdown、planning、calendar 工作流，保存前后内容比较与截图 |
| 桌面与构建 | 干净 frozen install；Electron 实际版本；node-pty/koffi/图像路径；窗口重开、深链接、缩放主题、隐藏输入/截图；三个 frontend 及 server/worker 构建；bundle 体积 | Windows portable/unpacked 单独目录验证，不能覆盖现有 release 产物；版本清单、截图、日志与 bundle report |

复用入口包括 `scripts/verification/verify-dependency-upgrade-security.cjs`、`pi-120-upgrade-workflow.ts`、`upstream-015-*-workflow.ts`、`ai-settings-*-workflow.ts`、`gantt-reschedule-workflow.ts` 及既有 durable/runtime/Markdown 工作流。实际路径先用 rg 确认，不把不存在的命令写成已通过。

最终至少运行：

```text
bun install --frozen-lockfile
bun run validate:ci
bun run audit:dependencies
bun run test:critical
bun run test:upstream-015
bun run build:runtime
bun run electron:build
bun run webui:build
bun run viewer:build
bun run server:build
bun run bundle:report --check
```

这些命令须使用本轮选定运行时。适用的主题/视觉/协议治理门禁已经由 lint / validate 覆盖，不能更新 allowlist 来掩盖回归。新工作流登记到现有验证体系，输出 `.cache/verification/<run-id>/manifest.json` 等可复验产物，并在 `docs/verification/results/upgrade-2026-10-18.json` 保存命令、退出码、源码/产物 SHA 和路径。

已有失败先用同一环境和原始基线证明，再单独记录；不能只引用 10-15 的旧失败名单就宣布它们是本次既有问题。修复由本次引入的失败；无法在 Windows 实测的 macOS/Linux/新容器、真实外部账户与签名安装器保持“未验证”，不冒充全部通过。

## 7. 证据范围与交付

- [summary.json](upgrade-2026-10-18/summary.json) 与 [evidence.json](upgrade-2026-10-18/evidence.json)给出数量、时间和输入哈希；全量原始 npm/PyPI 查询在 `.cache/upgrade-20261018/`，零查询错误。两个非 npm 实际来源已在 catalog 排除 npm latest 推断。
- [collect-versions.cjs](upgrade-2026-10-18/collect-versions.cjs)可从仓库根复跑版本收集；先创建 `.cache/upgrade-20261018/`。重复运行只更新该缓存快照，不能将重新查询后的版本偷偷替代本计划冻结的 targets。
- GitHub 匿名 release API 返回 403；关键条目已使用官方网页和实际 Git/tag 源码交叉确认。未核实的库只称“兼容系列维护”或“暂缓”，不编造 release notes。
- Python 本轮复核直接依赖；传递树与跨平台 wheels 由实施验收重新解析。10-17 的 Linux CI 容器采样只作历史背景，不代表升级后容器已验证。
- 最终由 DSH 新建 `docs/verification/upgrade-2026-10-18-implementation.md` 和机器结果，明确每个 targets 项及每项上游功能的状态。Codex 复核 diff、目标解析、关键行为和证据后再给用户实施结论。
