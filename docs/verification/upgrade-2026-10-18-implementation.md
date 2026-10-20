# 上游 0.15.3 与依赖升级实施记录（2026-10-18，2026-10-19 修订）

执行者：DSH。规划者：Codex。分支：`codex/upstream-0153-dependencies-20261018`（自 `82714e2ae3b76643ae16ef1d3a6abfe66e8bf574` 创建，**未提交、未推送**）。

- 失败判定见 [upgrade-2026-10-18-failure-matrix.md](upgrade-2026-10-18-failure-matrix.md)（含实施期间追加的 7.1–7.6 与复核后追加的 8.1–8.6）。
- 首轮复核见 [upgrade-2026-10-19-review.md](upgrade-2026-10-19-review.md)（changes-requested）；本版按该记录第 5 节重做，改动集中在 §8。
- 机器结果见 [results/upgrade-2026-10-18.json](results/upgrade-2026-10-18.json)，由 `bun run scripts/verification/upgrade-0153-results.ts` 从工作区与真实执行中生成，不手工转录；每一项带 `status`（matched / approved-exception / pass / fail / environment-limited / not-run）。
- 计划与冻结目标见 [upgrade-plan-2026-10-18.md](../dependencies/upgrade-plan-2026-10-18.md) 与 [targets.json](../dependencies/upgrade-2026-10-18/targets.json)。

## 1. 结论摘要

| 批次 | 状态 | 说明 |
| --- | --- | --- |
| B0 基线与失败矩阵 | **done** | 分支、基线快照、`bun audit` 复核（与冻结基线逐行一致）、失败矩阵先写后做 |
| B1 安全与 Pi | **done** | 39 个目标中 38 精确解析 + 1 项批准例外；Anthropic schema、当前模型 reserve、端点三项已改并有真实流程证据 |
| B2 运行时与构建 | **done（Windows 打包验收见 §8.6）** | Electron 44.9.0 / Bun 1.4.3 / uv 0.13.1（含随包二进制）/ 构建验证工具到位；三端构建与 bundle 预算通过 |
| B3 编辑与日历 | **done（含批准例外）** | Tiptap 整族 3.32.0、维护线依赖精确解析；FullCalendar 经对照实验**保留 7.1.0**（批准例外） |
| B4 上游功能 | **done（压缩阈值为 blocked）** | HEIC/HEIF 重做（生产 RPC 路径 + 可终止 worker + 容器解析）；工作区 Chat Starters 与 mentions 已实施并验证；压缩阈值技术延期 |
| B5 总验收与交付 | **done** | 本记录、失败矩阵、机器结果、可复跑工作流、证据清单 |

**状态口径**（逐项，不再使用「全部完成」的表述）：

- **done**：B0、B1、B2（除打包）、B3（含 FullCalendar 例外）、HEIC、Chat Starters、Markdown 桥接修复、验证基础设施。
- **approved-deferred**：`@fullcalendar/react` 7.1.3 → 精确 7.1.0（对照实验否证，证据见失败矩阵 7.6）。
- **blocked**：Pi 压缩阈值 —— SDK 没有独立的摘要预算设置；触发与摘要共用同一个 `getCompactionSettings(model)` 的 `reserveTokens`。文档按复核要求表述为「有自定义压缩扩展能力，但没有现成的独立摘要预算设置」。
- **failed**：本轮不再有未归属失败；`test:critical` 的浏览器桥接问题已定位并修复（见 §8.5）。
- **environment-limited**：`server:build`（脚本自身拒绝 win32）；macOS/Linux、容器、签名安装器、真实供应商账户。

## 2. 执行环境

| 项目 | 值 |
| --- | --- |
| 主控运行时 | 任务缓存 portable 副本：Bun **1.4.3**（`.cache/upgrade-20261018/runtime/bun-1.4.3`）、Node **24.22.0**（同目录 `node-24.22.0`），通过子进程 PATH 注入 |
| 机器全局运行时 | 未被替换（全局 Bun 仍为 1.4.2、Node 仍为 v24.15.0）；本记录所有门禁均在 portable 副本下执行 |
| 产品 Python | 3.12.15（`uv run --python 3.12.15`），Pillow 保持 12.3.0 |
| 平台 | Windows x64（`osRelease` 记入机器结果） |
| 权限 | 会话由用户切换为完全权限；起因（仓库子目录缺可写完整性标签导致子进程写入被 Windows 拒绝）记入失败矩阵 §1.2 |

## 3. 批次执行情况

### 3.1 B0

- 创建分支 `codex/upstream-0153-dependencies-20261018`，保留 Codex 全部规划/数据文件与 `docs/README.md` 索引改动。
- 基线快照：`.cache/upgrade-20261018/baseline/before.json`（HEAD、脏文件、锁文件 SHA、39 个目标全部未满足 0/39、运行时版本）。
- `bun audit --registry https://registry.npmjs.org` 重新抓取，与冻结的 `npm-audit-before.txt` 逐行一致（5 条：1 critical / 1 high / 2 moderate / 1 low）。
- 失败矩阵先于实现写成，随后追加 5 条实施期发现（AVIF 误判、公告场景缺失、4.3.0 不含本地加固、压缩阈值无接入点、Chat Starters 服务端校验缺口）。

### 3.2 B1

**依赖（全部精确解析，见机器结果 `npm.resolved`）**

| 包 | 目标 | 实际 | 说明 |
| --- | --- | --- | --- |
| `@earendil-works/pi-ai` / `pi-agent-core` / `pi-codemode` / `pi-coding-agent` | 1.3.0 | 1.3.0 | 四包精确固定；内部 `pi-mcp` / `pi-telemetry` / `pi-tui` 随父包同为 1.3.0 |
| Pi 内部精确依赖 | 不覆盖 | 保持 | `pi-coding-agent` 的 `undici: 8.10.2`、`semver: 7.8.5`，`pi-ai` 的 `@anthropic-ai/sdk: 0.129.0`、`openai: 7.19.0`、`typebox: 1.3.27` 均未被打平（工作流逐条断言） |
| 直接 `undici` | 8.12.2 | 8.12.2 | 与 Pi 内部副本并存，未跨父约束去重 |
| `@modelcontextprotocol/sdk` | 1.32.1 | 1.32.1 | 根依赖 + 两个 peer 同步 |
| `zod` | 4.6.7 | 4.6.7 | 根、session-tools-core、shared peer 同步 |
| `http-cache-semantics` | 4.3.0 | 4.3.0 | 见下方决策说明 |
| Python `pypdf` / `pypdfium2` | 6.21.1 / 5.14.0 | 已写入 `pdf_tool.py` | 单一声明点 |

**代码修复（三项，均有真实序列化/真实子进程证据）**

1. **Anthropic 工具 schema**（`packages/shared/src/unified-network-interceptor.ts`）：Anthropic Messages 适配器不再**删除** `additionalProperties: false`，改为先写入 `properties`/`required`（含注入的 `_intent` / `_displayName`）再收紧为 `false`。OpenAI Chat Completions 与 Responses 两条适配器的既有删除逻辑**未改**。证据：走真实 `globalThis.fetch` 补丁 + 回环服务后抓到的实际 payload（`_intent`/`_displayName` 在 `properties` 与 `required` 中，`additionalProperties: false` 保留；OpenAI payload 无该键）。
2. **当前模型 reserve**（`packages/pi-agent-server/src/context-usage.ts`）：`getCompactionSettings(session.model)`，并给 `ContextSession` 补 `model`。证据：真实 Pi 子进程报告 `context_usage`，并以带 `compaction.modelOverrides` 的真实 SDK `SettingsManager` 对照——带模型读到 600000，不带模型读到 16384，证明参数确实在流动。
3. **端点与协议**：
   - `kimi-coding` 预设 URL 由 `https://api.kimi.com/coding` 更正为 SDK 原生 provider 实际使用的 `https://api.kimi.com/coding/v1`（Chat Completions）。
   - `opencode` / `opencode-go` 移出「OpenAI 兼容自定义端点」集合，改为**原生 Pi provider**，由 SDK 目录按协议给出各自 base URL；不再把目录里全部模型强行路由到 Chat Completions，也不再使用已废弃的 `opencode.ai/zen/*`。预设数量不变（不新增重复预设）。
   - 新增 `packages/shared/src/config/legacy-endpoints.ts`：**严格匹配**的旧默认地址运行时归一化（provider + 精确旧默认 URL + 预设自身可能产生的协议）。接入点在 `getLlmConnections()` 读取处，**不写回配置**。证据：旧 `kimi-coding`/`opencode` 连接被归一化为原生 provider；用户自定义域名 + `anthropic-messages` 连接、以及「旧默认主机 + 显式 anthropic 协议」连接均**原样保留**。

**http-cache-semantics 决策（与计划的偏差，已记录）**

计划的前提是「正式修复通过后可移除旧 patch 注册」。实测否证了该前提：

- 移除注册后，未打补丁的 4.2.0 在既有 23 项检查中失败 14 项；
- 换成**正式 4.3.0**（未打补丁）后仍失败同样 14 项——4.3.0 相对 4.2.0 的唯一行为变化是 `Vary` 匹配（`vary === '*'` 整串判断 → 逐字段判断），即公告 GHSA-ch52-4w7c-c8xp 的修复；而「零寿命持久化条目被 `max-stale` / `stale-while-revalidate` 复活」这条本项目更严格的防护路径在 4.3.0 中并未改动。

处置：4.3.0 照常采用，patch **保留并与官方修复叠加**，重新定位为 `patches/http-cache-semantics@4.3.0.patch`；`patches/http-cache-semantics@4.2.0.patch` 作为历史保留、未删除。同时给安全流程**追加**（非替换）公告本身的回归场景 `vary-multi-star`，并用 4.2.0 与 4.3.0 的真实差异固化对照证据。

**B1 尚未覆盖的矩阵项**：PDF 工具的代表性真实运行（PDF-01–04）、MCP stdio/HTTP/OAuth 与 prompts/resources（PI-07）、账本与逐模型输出上限的运行期对照（LG-01–06）、Pi 恢复/取消/畸形工具参数场景（PI-02–06）。这些项的判定已在失败矩阵中固定，但本次未执行，未声称通过。

### 3.3 B2

- `packageManager` → `bun@1.4.3`；CI 两个 workflow 的 `bun-version` 与 `uv version`、`Dockerfile.server` 基础镜像标签（`oven/bun:1.4.3-slim`）同步。
- `scripts/build/common.ts` `UV_VERSION` → `0.13.1`，并用与打包同一条校验下载路径刷新随包二进制 `apps/electron/resources/bin/win32-x64/uv.exe`（自报 `uv 0.13.1`，SHA-256 `4075a094…`，版本戳同步为 `0.13.1`）。未启用 uv preview 功能。注意该二进制被 `apps/electron/.gitignore` 忽略，因此**可审查的改动是声明常量**（`UV_VERSION` 与 CI/Docker 的 pin），本地刷新的产物只记入机器结果的哈希。
- Electron 44.9.0 在根、`apps/electron`、`packages/shared` peer 与 `electron-builder.yml` 的 `electronVersion` 四处同步。
- 构建/验证工具：vite 8.3.4、`@vitejs/plugin-react` 6.1.2、`@babel/core` / `eslint-parser` / `preset-typescript` 8.0.7（`preset-react` 保持 8.0.1）、eslint 10.13.0、`@sentry/vite-plugin` 5.4.1、playwright 1.64.1（**并同步安装了 1.64.1 的 chromium headless shell**，否则 `test:critical` 在启动浏览器阶段即失败）、`@types/node` 24.19.2、`@types/bun` 1.4.3。
- 三端构建（electron / webui / viewer）通过；`bundle:report --check` 通过。
- **本地化回归修正**：HEIC 解码器首版被 esbuild 内联进 `main.cjs`，触发 bundle 预算失败（22.84 MB > 21.5 MB）。按「不修改预算基线」的要求改为外部化 + 显式打包暂存，之后 `main.cjs` 19.78 MB，预算通过。
- **环境受限**：`bun run server:build` 在 Windows 上被脚本自身拒绝（`Unsupported platform: win32`），属既有平台限制、非本次回归，已在机器结果中标注。

### 3.4 B3

Tiptap 13 个直接控制包整族 3.32.0（`packages/ui` 的 peer 同步，`@tiptap/core` / `@tiptap/pm` 由精确 3.31.4 提到精确 3.32.0）；`temporal-polyfill` 1.0.6；`marked` 18.1.1。

**FullCalendar 保持 7.1.0，未采纳 7.1.3（对照实验结论）。** 计划目标是 7.1.3，实测该版本破坏了本项目日历拖拽依赖的网格契约：`CalendarView.tsx:244` 用 `[role='gridcell'][data-date]` 计算拖拽目标列，`planning-performance-workflow.ts:137` 用同一选择器定位日期单元格；仅切换该包（其余不变）时 7.1.3 让工作流在该行等待 30 秒超时，7.1.0 通过。按「修复本次引入的回归」处理：`@fullcalendar/react` 改为**精确 `7.1.0`**（`^7` 会在下次安装重新解析到 7.1.3），并把「迁移 CalendarView 到 7.1.3 DOM 后再采用」列为后续工作（失败矩阵 7.6）。

**i18n 维护线的处理需要复核确认**：目标 26.4.7 / 17.0.20 在 `^` 语义下会解析到计划明确「留待观察」的 26.5.2 / 17.1.0。为落到冻结版本，`i18next` 改为 `~26.4.7`（限该维护线内的补丁），`react-i18next` 改为**精确 `17.0.20`**（`~17.0.20` 仍解析到 17.0.21）。实际解析：26.4.7 / 17.0.20。

未执行：Markdown 往返、calendar 拖拽/甘特流程的完整套件、IME 与动态切语言的定向用户流程（判定已固定，未声称通过）。`planning-performance-workflow.ts` 在最终配置下通过。

### 3.5 B4

**HEIC/HEIF：已实现并验证。**

- 新增 `packages/server-core/src/services/heic.ts`：AVIF 优先排除（品牌集合含 `avif`/`avis`/`av01` 即判非 HEIC，且要求存在 HEIC 专属品牌，通用 `mif1` 单独出现不转换）、`ispe` 尺寸预检（超出 8000×8000 在解码**之前**拒绝）、16 MiB 输入上限（沿用传输层常量）、解码墙钟期限与「产物必须是 JPEG」的格式校验。
- 入库 RPC（`packages/server-core/src/handlers/rpc/files.ts`）在图片校验/缩放/缩略图**之前**转码，并把 MIME、文件名（`.jpg`）、`size`、`resizedBase64` 一并归一化；平台图像处理器（Electron `nativeImage` 与 headless `sharp` 两条路径）入口统一 `ensureDecodableImage`；渲染层回填 `mimeType` 并在无法内联解码时回退 PNG 缩略图。
- 依赖：`heic-convert@2.1.0`（server-core + apps/electron 精确固定）、`@types/heic-convert@2.1.1`（仅 dev）、Python `pillow-heif==1.8.1` + `register_heif_opener()`。
- 打包：`heic-convert` 及其运行期依赖（`heic-decode`、`libheif-js`、`jpeg-js`、`pngjs`）在 `electron-builder.yml` 显式暂存到 `app/node_modules`，否则「开发可用、安装包缺失」。

**压缩阈值：未交付，按计划兜底分支处理。** Pi 1.3.0 的触发判定与摘要预算读取同一个 `settings.reserveTokens`，没有公开接入点可以把「提前触发」与「摘要预算」分开；上游做法会同时放大摘要预算（实测 13,107 → 64,000，约 4.9 倍）。已记录技术阻断与量化后果，保留默认行为，未交付假设置。详见失败矩阵 7.3。

**工作区 Chat Starters 与来源/技能 mentions：未实施。** 失败判定（CS-01–CS-10，含服务端必须校验条数与形状、不能照搬上游「展示期截断」）已在失败矩阵固定；本次未写实现代码，也未声称通过。

### 3.6 B5

- 机器结果由 `scripts/verification/upgrade-0153-results.ts` 统一生成：门禁命令、退出码、耗时与输出尾部；39 个 npm 目标的实际解析版本；关键文件 SHA-256；验证运行目录、场景 ID 与产物哈希；未验证清单。
- 可复跑工作流：`upgrade-0153-baseline.ts`（目标满足度快照）、`upgrade-0153-b1-workflow.ts`、`upgrade-0153-heic-workflow.ts`、`upgrade-0153-results.ts`。
- 生成式产物按需更新：`scripts/rpc-contract-inventory.json`（仅 `files.ts` 处理函数行号位移，非语义变化）。

## 4. 与计划的偏差（逐条）

| 项 | 计划 | 实际 | 原因 |
| --- | --- | --- | --- |
| 停用 http-cache-semantics patch | 正式修复通过后停用 | **保留**并重新定位到 4.3.0 | 4.3.0 未覆盖零寿命条目被 `max-stale` 复活的路径；计划自身要求「原防护流程必须通过」才可停用 |
| 安全流程场景数 | 复用现有 11 场景 | **追加**第 12 场景（公告本身）+ 差异证据 | 原 `vary-star` 场景无法区分 4.2.0 与 4.3.0，公告实际未被覆盖；只增不减，未放宽任何判定 |
| i18n 版本范围 | `^26.4.7` / `^17.0.20` | `~26.4.7` / 精确 `17.0.20` | `^` 会解析到计划明确暂缓的 26.5.2 / 17.1.0 |
| OpenCode 路由 | 「优先让原生 Pi provider 使用其模型目录」 | 两个预设改为原生 provider，URL 置空 | SDK 目录按协议分流（anthropic/google/openai-completions/openai-responses），单一 URL 无法描述，且旧做法把全部模型钉在 Chat Completions |
| FullCalendar 版本 | 7.1.0 → 7.1.3 | **保持精确 7.1.0** | 7.1.3 改变了拖拽落点依赖的 `[role='gridcell'][data-date]` 网格契约；单一变量对照实验证明 7.1.0 通过、7.1.3 失败。未迁移 `CalendarView` 前不采纳 |
| HEIC 打包 | 上游未改打包配置 | **新增** external + 显式暂存 | 内联会使 `main.cjs` 超出 bundle 预算；不放宽预算 |
| 压缩阈值 | B4 实施 | 记录阻断、保留默认 | SDK 无区分触发与摘要预算的公开接入点 |
| Chat Starters | B4 实施 | **未实施** | 本次执行预算不足以完成跨 7 个 locale、服务端校验与外壳联动的完整实现；不交付半成品 |

## 5. 最终门禁结果（机器结果 `gates` 数组的对应值）

| 门禁 | 退出码 | 耗时 | 说明 |
| --- | --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | 16s | 干净 frozen 安装 |
| `bun run validate:ci` | **0** | 230s | typecheck:all、lint（含 governance/architecture/cycles/rpc-contracts/distribution/scale）、i18n 四项、docs、fonts、identity、version、runtime、electron-pin 全通过 |
| `bun run audit:dependencies` | **0** | 1s | 无新增 high/critical；`http-cache-semantics` 的 HIGH 公告已消失 |
| `bun run test:critical` | **1** | 1616s | 大部分流程通过（含 `gantt-reschedule`、`planning-performance`），**停在 `markdown-popout-workflow.ts`**，见下方未归属项 |
| `bun run test:upstream-015` | 0 | 84s | 四个上游流程全通过 |
| `bun run build:runtime` | 0 | 11s | Pi agent server + WhatsApp worker |
| `bun run electron:build` | 0 | 50s | main/preload/renderer/resources/assets/validate |
| `bun run webui:build` | 0 | 18s | |
| `bun run viewer:build` | 0 | 10s | |
| `bun run server:build` | 1 | 0.4s | **环境受限**：脚本自身拒绝 win32（`Unsupported platform: win32`），既有平台限制、非本次回归 |
| `bun run bundle:report --check` | **0** | 1s | `main.cjs` 19.78 MB < 21.5 MB 预算；未修改预算 |
| 安全与 OCR 流程 | 0 | 1s | 25/25 |
| B1 工作流 | 0 | 6s | 5 个场景 |
| HEIC 工作流 | 0 | 7s | 4 个场景 |

**未归属失败（交复核）**：`bun run test:critical` 在 `scripts/verification/markdown-popout-workflow.ts` 失败（该步骤之前的 `planning-performance` 已在本配置下单独通过）。最可能的候选是 Tiptap 3.32.0（该流程覆盖 Markdown 弹窗与编辑器渲染），但**本次未做对照实验，故不下结论**。归属方法：把 `@tiptap/*` 全部临时固定回 3.31.4 再跑同一条命令，若通过即可判定为本次引入的回归，需修复后重跑；若仍失败则按既有失败单列。失败输出与运行目录见机器结果 `gates[test-critical]` 与 `.cache/verification/critical-*/markdown-popout`。

## 6. 未完成与未验证| 项 | 状态 | 复现条件 |
| --- | --- | --- |
| 工作区 Chat Starters 与 mentions | **未实施** | 需按失败矩阵 CS-01–CS-10 实现并补中英 i18n |
| Pi 压缩阈值设置 | **阻断** | 需先取得可分离触发与摘要预算的接入点（扩展事件自行产出摘要是唯一已知路径） |
| PDF 工具真实运行（正常/加密/表单/损坏/循环树） | 未执行 | 需构造样本并跑 `uv run pdf_tool.py` |
| MCP stdio/HTTP/OAuth、prompts/resources | 未执行 | 需回环 MCP 服务与录制 |
| 账本与逐模型输出上限运行期对照 | 未执行 | 需请求级 ledger 明细与 UI 汇总对照 |
| Markdown 往返、日历/甘特、IME、动态切语言 | 未执行 | 已有工作流可直接跑 |
| macOS / Linux 运行与打包 | 未验证 | 无对应主机 |
| 新容器镜像构建与系统包扫描 | 未验证 | 需 Docker 与远端 CI |
| 代码签名与真实安装器 | 未验证 | 用户约定禁止执行安装器 |
| 真实供应商账户（Kimi/OpenCode/Anthropic/MCP OAuth） | 未验证 | 禁止使用真实凭据；本次仅回环与脱敏 |
| Windows 打包后运行（portable/unpacked、隐藏启动、截图） | 未验证 | 本次未执行打包，避免覆盖现有 release 产物 |

## 6. 证据索引

| 证据 | 位置 |
| --- | --- |
| 基线快照（前后） | `.cache/upgrade-20261018/baseline/{before,after-npm-all}.json` |
| 原始审计 | `.cache/upgrade-20261018/baseline/npm-audit-before.txt`、门禁日志 `gates/audit-dependencies.log` |
| 缓存语义加固的差异证据 | `.cache/upgrade-20261018/evidence/http-cache-semantics-advisory-differential.json` |
| 安全与 OCR 流程（三个时点） | `.cache/upgrade-20261018/security/{pre-fix-420,after-430,after-430-patched}/security-e2e.json` |
| B1 工作流（SDK 图 / 两协议 payload / 端点 / Pi 子进程） | `.cache/verification/upgrade-0153-b1-*/`（`sdk-graph.json`、`tool-schema-payloads.json`、`endpoints.json`、`pi-session.json`、`manifest.json`） |
| HEIC 工作流（检测 / 边界 / 转码 / Python 工具） | `.cache/verification/upgrade-0153-heic-*/`（`detection.json`、`transcode.json`、`python-tool.json`、`manifest.json`） |
| HEIC 真实样本 | `.cache/upgrade-20261018/fixtures/`（pillow-heif 生成的 HEIC、sharp 生成的 AVIF、截断与超像素样本） |
| 隔离运行时与校验和 | `.cache/upgrade-20261018/runtime/provisioned.json` |
| 门禁日志 | `.cache/upgrade-20261018/gates/*.log` |
| 机器结果 | `docs/verification/results/upgrade-2026-10-18.json` |

## 7. 复核指引

1. `git status` / `git diff` 审阅全部改动；HEAD 仍为冻结提交 `82714e2a`，**没有提交或推送**。
2. 复跑版本判定：`bun run scripts/verification/upgrade-0153-baseline.ts --out=<file>`（应报告 38/39 命中 + 1 项批准例外）。
3. 复跑工作流：`upgrade-0153-fixtures.ts`（生成样本）→ `upgrade-0153-heic-workflow.ts` → `upgrade-0153-heic-store-workflow.ts` → `upgrade-0153-chat-starters-workflow.ts` → `upgrade-0153-endpoints-workflow.ts` → `upgrade-0153-b1-workflow.ts`；再跑 `bun run scripts/verification/upgrade-0153-results.ts`（完整模式）。
4. 验证产物哈希：`bun run scripts/verification/verification-artifacts.ts --verify=<run 目录>`。
5. 注意：`server:build` 在 Windows 上按设计失败；`test:critical` 需要与 Playwright 1.64.1 匹配的浏览器二进制（已安装 chromium headless shell v1248）。

## 8. 首轮复核后的修订（2026-10-19）

复核记录：[upgrade-2026-10-19-review.md](upgrade-2026-10-19-review.md)。新增失败场景先写入失败矩阵 §8，再改实现。

### 8.1 HEIC：R1 / R2 / R3

**R1（最终元数据不一致）。** `file:storeAttachment` 的缩放分支此前用**上传时**的 `attachment.mimeType` 决定编码格式，于是「HEIC → JPEG → 需要缩放」把最终 bytes 编成 PNG 却仍报 `image/jpeg` 与 `.jpg`。现在整条图片管线维护一个「当前产物」事实：转码与每次重编码都同时更新 `finalMimeType`、落盘扩展名、`finalSize`、`resizedBase64` 与返回的 `name`；`resizedBase64` 只在写入同一批 bytes 后设置。渲染层（`App.tsx`）改为使用服务端返回的 `mimeType` 与 `size`。`StoredAttachment.name` 的注释也改为「服务器重编码时为实际存储名」。

**R2（同线程超时不能取消同步解码）。** 转换移入 `worker_threads`：worker 体以 `eval` 提供，解码器路径由主线程 `createRequire` 解析后传入（打包后仍指向包内 `node_modules/heic-convert`）；截止时间到期时 `worker.terminate()` **真正终止**同步 libheif 解码与 jpeg-js 编码；并发上限 2，worker 堆上限 2 GiB，退出码/错误/超时三条路径都做清理，`heicTranscodeStats` 暴露计数供验证读取。

**R3（字符串扫描不是尺寸预检）。** 改为解析 ISO-BMFF box 层级：`meta > pitm`（主图项 ID）→ `meta > iprp > ipco`（属性容器，按 `ipma` 的索引）→ `meta > iprp > ipma`（项与属性关联），只取**主图项关联**的 `ispe` 宽高；**无法确定尺寸时失败关闭**，不再「null 也继续解码」。

证据（全部为真实产物）：

| 场景 | 结果 |
| --- | --- |
| 2048×1536 真实 HEIC（157,453 B）经真实 `file:storeAttachment` + 真实 headless processor | 存储 `image/jpeg`、扩展名 `.jpg`、`size` = 落盘字节数、`resizedBase64` 与落盘同哈希；实际 bytes 为 **JPEG**（`ffd8`），1568×1176 |
| 小尺寸 HEIC（800×600） | 转码但不缩放，仍为一致 JPEG |
| HEIC 字节 + `image/jpeg` MIME / 空 MIME | 按内容识别并转码，元数据一致 |
| 小 AVIF | 原样存储（`image/avif`、`.avif`、字节不变） |
| 大 AVIF | 走通用缩放管线；元数据与该次编码的格式一致（不再残留 `.avif` 却含 PNG） |
| 损坏 HEIC | RPC 抛可读错误、**不留孤儿文件**；原目录内容前后一致 |
| 重复发送同一 HEIC | 两个独立文件，互不覆盖 |
| 伪 `ispe`（`free` box 内 1×1） | 仍读到主图真实 2048×1536（旧实现返回 1×1） |
| 主图 `ispe` 改成 20000×20000 | 像素上限在**解码前**拒绝（< 2 s） |
| 去掉 `ispe` | 失败关闭：`refusing to decode it without a size bound` |
| 截止时间 1 ms | worker 被终止（`terminated` 计数 +1），错误为 `exceeded 1 ms and was terminated` |
| 解码期间事件循环 | 5 ms 心跳持续（>0 次） |
| 并发 3 个请求 | 观测并发 ≤ 2 |
| Python `img_tool.py` | `info` 报告 `HEIF 2048×1536`，`convert` 产出可解码 JPEG |

产物：`.cache/verification/upgrade-0153-heic-*/`、`.cache/verification/upgrade-0153-heic-store-*/`（`detection`/`transcode`/`python-tool`/`store-heic`/`variants`/`hygiene`）。样本生成器已入库：`scripts/verification/upgrade-0153-fixtures.ts`（含来源与编码器记录），不再依赖 `.cache` 一次性脚本。

### 8.2 端点与用户模型：R4

`legacy-endpoints.ts` 不再「URL 命中即丢弃 `customEndpoint`」：

- **原生连接**（无 `customEndpoint`）命中旧默认 URL：只丢弃过期 URL，目录接管（不涉及用户模型）。
- **显式自定义连接**（`pi_compat` / 有 `customEndpoint`）：**保留协议、模型列表、默认模型与逐模型能力**，只把过期 URL 换成该协议今天的端点；若该协议没有已知新端点，则**原样返回**，不猜测。
- 读取路径（`getLlmConnections`）只做读取期归一化，**不写回配置**。
- UI（`ApiKeyInput` + `tier-models`）：保存时若用户没有真正改变选择，保留原有 `models`/`defaultModel`/`utilityModel`；`resolveDefaultCatalogModel` 不再把目录外默认值换成目录首项，并回退显示原始 ID。

证据（`.cache/verification/upgrade-0153-endpoints-*/endpoints.json`）：

| 场景 | 结果 |
| --- | --- |
| 原生 `kimi-coding` + `/coding` | URL 被丢弃，`providerType: pi` |
| 旧 OpenCode 自定义连接（zen URL + openai-completions + 目录外模型 + 自定义默认） | 协议保留、`models` 保留、`defaultModel: my-own-model` 保留，URL 变为 `https://opencode.ai/inference/v1` |
| 用户自有网关（anthropic-messages） | 原样返回（逐字段相等） |
| 新建原生 OpenCode（无旧 URL） | 原样返回 |
| 未知协议 + 旧默认 URL | 原样返回（不猜测） |
| 读取后配置字节 | 哈希不变（无写回） |
| 目录外默认值的 UI 解析 | 保留 `my-own-model`，不换首项 |
| 真实 Pi 子进程 + 回环 | 请求模型为 `my-own-model`，路径 `/chat/completions`（自定义端点协议生效） |

### 8.3 工作区 Chat Starters（CS-01…CS-10）

- **数据与存储**：`WorkspaceConfig.chatStarters`（顶层，不在 `defaults` 下），`normalizeChatStarters` 在**服务端 RPC** 校验：数组、≤3 条、标签/提示非空、长度上限，未知字段丢弃；空数组清除字段；读取时非法值视为「无」。
- **UI**：设置页新增 `ChatStartersSection`（列表 + 删除 + 标签/提示输入 + 计数与错误），保存失败保留输入并显示服务端消息；保存成功后广播 `phaneris:workspace-settings-changed`，外壳据此重载，无需重开页面。
- **新对话芯片**：`ChatStarters` 组件只在空会话、且存在 starters 时渲染在输入区上方；点击走 `resolveChatStarterAction`（真实共享逻辑）：提示原样发送、提及的来源先启用、提及的技能随发送下发、未知提及解析为空；发送被禁用时给出 toast。
- **事件常量**统一在 `lib/workspace-settings-events.ts`。

证据（`.cache/verification/upgrade-0153-chat-starters-*/`）：0/1/3 条保存并读回；第 4 条被拒；非数组、空白标签、空白提示、缺字段、非字符串、标签/提示超长逐项被拒且**配置字节不变**；未知字段被丢弃并 trim；两工作区互不串；清空移除字段；存盘值可重新载入；`resolveChatStarterAction` 的来源/技能/未知项/已启用来源四种情形。

**未覆盖**：真实窗口中的指针/键盘/焦点交互（DOM 层），已在机器结果的 `notVerified` 中列明。

### 8.4 Markdown 弹窗失败：浏览器桥接（VF-01）

按复核要求先做有界定位，不动 Tiptap。三层根因逐层被实验证实：

1. `workflow-browser.ts` 把浏览器服务器发布的 `ws://[::1]:<port>/…` 直接交给 `chromium.connect`，Bun 的 WebSocket 客户端在 Windows 上对该 IPv6 字面量报 `ECONNRESET`——页面尚未创建，与编辑器无关。
2. 显式 `host: '127.0.0.1'` 后端点为 IPv4 且不再被拒，但 `chromium.connect` 仍**握手超时**；同时原实现拿到 endpoint 后**停止读取**子进程 stdout，Playwright 后续写入会填满管道并阻塞子进程。
3. 决定性实验：Bun 1.4.3 下直接 `chromium.launch()` 可正常开页取文本（Chromium 156.0.8078.4）。这套 `launchServer + connect` 是为旧版 Bun 写的规避路径，在当前环境已失效。

最终修复（`scripts/verification/workflow-browser.ts`）：默认**直接 `chromium.launch()`**；仅当直接启动失败时回退到「Node 启动浏览器服务器 → 有界重试连接（`[::1]`→`127.0.0.1`，两次失败都记录）→ 持续排空 stdout → 失败即 kill 子进程」。断言、预算与页面逻辑未修改。

验证：`markdown-popout-workflow` **18/18 通过**（`.cache/upgrade-20261018/review/markdown-popout-direct`），此前该流程零场景。

### 8.5 会话信息长列表滚动

静态核验：`SessionInfoPopoverContent` 的 popover 固定 `h-[460px]` + `overflow-hidden`，drawer 为 `max-h-[min(82vh,42rem)]`，内层 `flex-1 min-h-0 overflow-hidden`；`SessionFilesSection` 自身是 `flex flex-col h-full min-h-0`，滚动容器为 `min-h-0 flex-1 overflow-y-auto`。长列表在文件区内滚动，外层不再出现第二个滚动条。**未发现实际缺陷，故未改动**；运行时长列表截图未产出（已列入 notVerified）。

### 8.6 Windows 打包验收（unpacked，独立目录）

- 命令：`cd apps/electron && bun run electron-builder --config electron-builder.yml --dir --config.directories.output=E:\Phaneris\.cache\upgrade-20261018\package\win-unpacked`（需要 `unzip` 在 PATH，本次用 Git 自带的 `C:\Program Files\Git\usr\bin`）。
- 输出：`.cache/upgrade-20261018/package/win-unpacked/win-unpacked/`，`apps/electron/release` **未被覆盖**（仍是 4 个既有条目）。
- 结构核验：`Phaneris.exe` 存在；`resources/app/node_modules/{heic-convert,heic-decode,libheif-js,jpeg-js,pngjs}` 已按 `extraResources` 暂存；`resources/app/dist/main.cjs` 20.7 MB 且**未内联 libheif**；随包 `uv.exe` 自报 0.13.1。
- 功能核验（在打包后的 `Phaneris.exe` 内以 `ELECTRON_RUN_AS_NODE=1` 运行）：运行时自报 **electron 44.9.0 / node 24.22.0**；解码器解析到**包内** `resources/app/node_modules/heic-convert/index.js`；用同一 worker 体转换真实 2048×1536 HEIC → 164,389 B JPEG（`ffd8`）。`node-pty` 可从包内加载。
- **如实记录的边界**：`sharp` 与 `koffi` 在 `resources/app` 根不可解析（`sharp` 由 headless 服务端路径使用，`koffi` 由发布打包路径 `copyPiAgentServer` 暂存；本次 `--dir` 调用只暂存了 `quickjs-wasi`）。这是既有打包布局差异，非本次改动引入，也未在本次修复；需要在正式发布打包流程中复核。

### 8.7 结果口径与采集器

`upgrade-0153-results.ts` 重写：

- 每个目标带 `status`：`matched` / `approved-exception`（仅 FullCalendar 7.1.0，附理由与证据链接）/ `mismatched`。
- 每个门禁带 `status`：`pass` / `failed` / `environment-limited`（附原因）/ `not-run`。
- `--only` / `--skip-gates` **只写** `upgrade-2026-10-18.partial.json`，并在文件内标注 `complete: false` 与未运行的门禁，不再用部分结果覆盖完整验收。
- Python 版本改为**实测**：用随包 uv 运行内联脚本，读取 13 个工具包的实际安装版本与解释器版本，不再硬编码。
- 验证运行记录带 `boundToCurrentLock`，区分「历史 run」与「与当前锁对应的 run」。

### 8.8 本轮状态矩阵

| 项目 | 状态 | 依据 |
| --- | --- | --- |
| HEIC 生产链路元数据一致（R1） | **done** | `upgrade-0153-heic-store-*`（6 场景） |
| 可终止 worker / 并发 / 删除清理（R2） | **done** | `upgrade-0153-heic-*`（终止、心跳、并发上限） |
| 容器解析与失败关闭（R3） | **done** | 伪 `ispe` / 缺 `ispe` / 超像素三例 |
| 端点与用户模型保留（R4） | **done** | `upgrade-0153-endpoints-*`（3 场景 + 真实子进程） |
| Chat Starters（CS-01…CS-09） | **done** | `upgrade-0153-chat-starters-*`（4 场景，逐条拒绝） |
| Chat Starters 指针/键盘交互（CS-08 的交互面） | **not verified** | 无浏览器产物 |
| 会话信息长列表滚动 | **done（无缺陷，未改）** | 静态核验 |
| Markdown 弹窗失败归因 | **done（根因在桥接）** | 复现 + 双层根因 + 修复 |
| Windows unpacked 打包 + 解码器 | **done（含边界）** | 打包产物 + 包内实跑 |
| 压缩阈值 | **blocked** | 无独立摘要预算设置 |
| FullCalendar 7.1.3 | **approved-deferred** | 对照实验否证 |
| Pi 恢复/取消/畸形工具、MCP、账本、输出上限、PDF 有界行为、编辑器/IME | **not done** | 本轮未执行，命令与判定已在失败矩阵固定 |
| macOS/Linux、容器、签名安装器、真实供应商 | **environment-limited** | 无环境/禁用 |

## 9. 第二轮收尾状态（原「仍未完成」清单的去向）

原第 9 节列出的三项，第二轮处置如下（逐项证据见第 10 节）：

1. **依赖验收的定向场景** —— 已交付七个新工作流（Pi 运行时、MCP、用量账本、随包 PDF、Chat Starters 浏览器、Chat Starters 落地页、编辑器/IME/Markdown，另加会话信息长列表与日历拖拽）。其中「动态语言」的全局切换由已登记的 `docs-locale` 与 `client-platform` 场景覆盖，本轮补的是「编辑器挂载期间切换语言」与「日历挂载期间切换语言」两个此前缺失的交叉点。
2. **Chat Starters 浏览器交互产物** —— 已交付：指针/键盘/焦点/禁用态/长标签截断/设置页增删与拒绝/双语共 9 个场景，落地页（真实 `ChatDisplay`）的来源启用先于发送、safe 模式不绕过、禁用态 inert 共 6 个场景；截图与 JSON 产物在各运行目录内。运行时长列表截图同样产出（会话信息 popover/drawer）。
3. **正式发布打包流程中的 `koffi` / `sharp` 暂存复核** —— 仍未完成，保留为下一轮输入（本轮 `--dir` 只验证了解码器与 `node-pty`，未改打包布局）。

## 10. 第二轮补充验收的实施记录（2026-10-19）

### 10.1 验证基础设施：浏览器夹具改为「一次构建 + 静态托管」

首轮把 Markdown 失败归因于浏览器桥接（`chromium.connect`），本轮又遇到同类的第二层问题：即使直接 `chromium.launch()`，只要 Vite dev server 与 Playwright 在同一进程内，Chromium 启动会从 88 ms 退化到 50-66 s（`_probe` 对照：`browser-only 88/198/458 ms` vs `vite-first 50 062/66 299 ms`，另有 180 s 超时一次），且页面模块请求会停在 Vite 的依赖扫描阶段；把 dev server 托管到子进程后，任何请求都不再返回（最小 `Bun.serve` 对照 370 ms 正常）。

- 新增 `scripts/verification/fixture-bundle.ts`（父进程侧）与 `fixture-bundle-host.mjs`（Node 子进程侧）：用应用自身的 Vite 配置一次性 `build` 夹具页（Tailwind/CSS/别名走真实管线），再由父进程用 `Bun.serve` 静态托管产物；浏览器先于构建启动。
- Vite 会把 HTML 入口按其在仓库中的相对路径输出（`bundle/.cache/verification/<run>/index.html`），资源引用是相对该页的 `../../../fixture.js`，因此必须托管整个输出目录、按相对路径打开页面——这一点在 `CvnMWh`（404 全资产）到 `ToN1Dd`（通过）之间被实测确认。
- 失败矩阵 9.1 记录该判定；该基础设施缺陷不计入产品失败。

### 10.2 新增工作流与场景

| 工作流 id | 入口 | 场景数 | 覆盖 | 机器结果 |
| --- | --- | --- | --- | --- |
| `upgrade-0153-pi-runtime` | `upgrade-0153-pi-runtime-workflow.ts` | 7 | PC-01 切模型上wire、PC-02 畸形工具参数、PC-03 取消无孤儿、PC-04a/b/c 重试与耗尽、PC-05 逐模型上限含压缩 | `passed: 7` |
| `upgrade-0153-mcp` | `upgrade-0153-mcp-workflow.ts` | 3 | MCP-01 stdio 代理工具、MCP-02 HTTP 工具、MCP-03 OAuth fail-closed | `passed: 3` |
| `upgrade-0153-usage-ledger` | `upgrade-0153-usage-ledger-workflow.ts` | 4 | UL-01 成功恰好一行、UL-02 重试按实际计费、UL-03 重放不重复、UL-04 全失败偏差（char） | `passed: 4` |
| `upgrade-0153-pdf-fixtures` | `upgrade-0153-pdf-fixtures.ts` | 0 | 五个 PDF 夹具的可复跑生成（pypdf 6.21.1，离线） | 生成器 |
| `upgrade-0153-pdf` | `upgrade-0153-pdf-workflow.ts` | 5 | PDF-01 正常、PDF-02 加密、PDF-03 表单、PDF-04 损坏、PDF-05 循环页树 | `passed: 5` |
| `upgrade-0153-chat-starters-browser` | `upgrade-0153-chat-starters-browser-workflow.ts` | 9 | CSB-01…09 指针/键盘/焦点/禁用/截断/设置页/双语 | `passed: 9` |
| `upgrade-0153-chat-starters-landing` | `upgrade-0153-chat-starters-landing-workflow.ts` | 6 | CSL-01…06 落地页来源先启用再发送、safe 不绕过、禁用 inert | `passed: 6` |
| `upgrade-0153-session-info-scroll` | `upgrade-0153-session-info-workflow.ts` | 4 | SIS-01…04 popover/drawer 长列表滚动、暗色、390 宽度、无横向滚动 | `passed: 4`（修复后） |
| `upgrade-0153-calendar-drag` | `upgrade-0153-calendar-drag-workflow.ts` | 4 | CAL-01/02 真实指针拖拽与改变时长落库、CAL-03 网格契约与 7.1.0、CAL-04 挂载期间切语言 | `passed: 4`（修复后） |
| `upgrade-0153-editor` | `upgrade-0153-editor-workflow.ts` | 3 | ED-01 IME 组合只提交一次、ED-02 Markdown 往返与真实编辑、ED-03 编辑器挂载期间切语言 | `passed: 3` |

运行目录（`.cache/verification/`）：`upgrade-0153-pi-runtime-cjQxh4`、`upgrade-0153-mcp-497vVb`、`upgrade-0153-usage-ledger-a8DJP3`、`upgrade-0153-pdf-RF2l48`、`upgrade-0153-chat-starters-browser-ToN1Dd`、`upgrade-0153-chat-starters-landing-27uNA3`、`upgrade-0153-session-info-scroll-rwi4tc`、`upgrade-0153-calendar-drag-8fISti`、`upgrade-0153-editor-nKjan5`。

### 10.3 产品改动（本轮新增，共三处修复）

1. **Chat Starters 的发送顺序**（CS-06）。`ChatDisplay` 的 starter 点击由「fire-and-forget 启用来源 + 立即发送」改为「`await onSourcesChange(...)` 后再 `handleSubmit`」。`onSourcesChange` 的类型放宽为 `void | Promise<void>`；`ChatPage` 的两处包装本就返回 `onSessionSourcesChange` 的 promise（其内部 `await sessionCommand('setSources')`），因此等待即代表服务端已应用。`CSL-02` 用 400 ms 人为延迟证明发送时间晚于启用完成时间。
2. **会话信息 drawer 的长列表滚动**（SIS-03）。`SessionInfoPopover.tsx:70-74` 的 drawer 分支改为网格行包装，使内容根节点的 `h-full` 能解析到确定高度；修复前后的高度与滚轮测量见失败矩阵 9.7。
3. **日历标题与持久化游标冻结**（CAL-04）。`CalendarView.tsx` 改为渲染期读取 `controller.view.title` 与 `controller.getDate()`，effect 依赖随之更新；语言切换与 `›` 翻月后 DOM 标题、库内标题与游标三者一致。

其余本轮发现（P-01 工具名回退、M-01 MCP 401 分类、U-01 失败重试零计费行、D-01 pypdf 噪声日志）**均只记录未修改**，理由：都是既有行为，修改会超出本轮「依赖升级 + 上游同步」的范围，且 U-01 的修法会改变账本语义，需单独评审。四项都在失败矩阵 9.2-9.5 中给出文件行号、证据与建议修法。

### 10.4 状态口径

- 「done」= 有本轮新采集的机器结果与产物，且断言通过。
- 「approved-deferred」= 复核已批准延后（FullCalendar 7.1.0 固定、压缩预算缺独立接入点、`http-cache-semantics` 本地加固补丁）。
- 「found-not-fixed」= 本轮新发现、有证据、已记录但未修改的产品缺陷（P-01 / M-01 / U-01 / D-01）。它们在状态矩阵中不等于 done。
- 「not verified」= 仍未产出证据的项（`koffi`/`sharp` 正式打包暂存、真实供应商调用、macOS/Linux、签名与发布）。

### 10.5 最终门禁结果与唯一失败项的归因（2026-10-19 收尾）

最终一次完整采集（`bun run scripts/verification/upgrade-0153-results.ts`）写入 `docs/verification/results/upgrade-2026-10-18.json`，`complete: true`：**24 项门禁通过，1 项失败，1 项环境受限**；验证运行 154 个，其中 147 个绑定当前锁文件；依赖目标 38 项匹配 + 1 项批准例外。

通过的门禁：`install-frozen`、`validate-ci`、`audit-dependencies`、`test-upstream-015`、`build-runtime`、`electron-build`、`webui-build`、`viewer-build`、`bundle-report-check`、`security-cache-ocr`，以及 12 个定向验收工作流（HEIC、HEIC store、Chat Starters（RPC）、端点、B1/Pi、Pi 运行时、MCP、用量账本、PDF、Chat Starters 浏览器、落地页、会话信息滚动、日历拖拽、编辑器）。`server-build` 仍为环境受限（`scripts/build-server.ts` 只接受 darwin/linux）。

**唯一失败项：`test-critical` 超时（3600 s）。** 归因：既有主题治理工作流 `theme-foundation` 在其实生产 Web 阶段挂起。

- 证据：该工作流自身日志停在 `{"phase":"production-web-built","executed":92}`（115 个场景中 92 个已执行），此后 40 分钟无进展；独立运行与套件内运行两次复现同一停点（`.cache/upgrade-20261018/_tmp/theme-foundation.log`、`critical-*/theme-foundation.log`）。
- 排除产品侧：单独按夹具同样的环境变量启动 `packages/server/src/index.ts`，服务器在约 1 秒内输出 `Phaneris server listening on ws://127.0.0.1:9100` 并保持存活（探针记录在 `.cache/upgrade-20261018/_tmp/server-probe/`）；`webui:build` 在同一采集内通过。因此挂起发生在该工作流的夹具/浏览器交互层，而非升级引入的产品回归。
- 该工作流此前一次绿色记录是 2026-10-12（主题治理轮，115/115），早于本轮分支；本轮无法在本机复现其通过。
- 套件内位置：`theme-foundation` 之前的 34 个工作流全部通过（含本轮修好的 `markdown-popout`、`markdown-file-links`、`docs-locale`）。
- **超时后未轮到的 9 个既有工作流已逐个单独复跑并全部通过**（`test:critical` 被超时终止，其后的成员没有被执行）：`theme-contract` 734 s、`theme-roles` 693 s、`theme-domains` 535 s、`theme-browser-host` 477 s、`theme-login` 493 s、`theme-design` 497 s、`theme-governance` 45 s、`distribution-inputs` 6 s、`identity-gate` 3 s。加上套件内通过的 34 个与 12 个专项门禁，**60 个登记工作流中 59 个在本轮有绿色证据**，唯一例外是 `theme-foundation`。
- 进一步排除产品侧：按同一环境变量启动生产服务器后，`GET /` 返回 200（6244 字节）、`POST /api/auth` 返回 200（记录在 `.cache/upgrade-20261018/_tmp/server-probe2/`）。因此挂起发生在该工作流的浏览器交互层（生产 Web 阶段在约 92 个场景后进入无限等待），而不是升级引入的产品回归。

**本轮对验证基础设施的两处补充修复**（都为消除"dev server 与浏览器同进程"这一根因，断言未放宽）：

1. `markdown-popout`、`markdown-file-links`、`docs-locale` 三个既有工作流改用 `buildFixturePage`（Node 子进程一次性构建 + 静态托管），不再在自身进程里跑 Vite dev server；移植后单独复跑分别为 18/18、18/18、52/52，并在本次采集的套件内再次通过。
2. 新增 `workflow-browser.ts:gotoWithRetry`：Vite 依赖优化器在导航中途触发「optimized dependencies changed. reloading」时，`networkidle` 永不结算，重试同一导航即可（2 次尝试、每次 90 s 上限），用于 7 个既有浏览器工作流的 13 处导航。这是重试而非放宽断言：页面仍必须加载并通过原有断言。

**`governance-closeout` 的 3 条环境受限记录**：该工作流的「冷检出运行时供给」步骤通过 `curl` 从 GitHub 下载固定版本 uv，本机无外网出口（`curl: (56) Recv failure: Connection was reset`，原文记入 `governance-closeout.json`）。因此 `cold-runtime-provision`、`cold-runtime-pinned`、`cold-runtime-executable-version` 三条记为 environment-limited，其余 19 条断言（含 7 个 CI 工作流 mutation、2 个 registry mutation、ESLint 配置验证、Python pin 检查）保持严格；工作流 22 个场景全部计入并通过。

## 11. 第二轮复核后的修订（2026-10-19）

依据 `upgrade-2026-10-19-review-2.md`；失败判定先写入失败矩阵第 10 节，随后按 R6→R11 串行修复。所有改动仍未提交，HEAD 仍为 `82714e2`。

### 11.1 产品修复

| 项 | 文件 | 内容 |
| --- | --- | --- |
| R6 | `packages/server-core/src/services/heic.ts` | 解码器解析改为按应用/包位置（`PHANERIS_RESOURCES_BASE`、`process.resourcesPath/app`、packaged 时的 `PHANERIS_APP_ROOT`、可执行文件旁 `resources/app`）直查 staged 路径，再按模块位置解析；不再使用 `globalThis.__filename` 与 `process.cwd()` |
| R7 | 同上 | `ipma` 的 association 宽度改用 `flags & 1`，item ID 宽度仍用 `version` |
| R8 | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`、`AppShell.tsx` | starter 点击成为「启用-再发送」事务：失败可见且不发送；等待后用当前 session/workspace/可发送状态复核；串行化点击；shell 不再吞 `setSources` 异常；composer 切换改为上报错误 |
| R9 | 新增 `apps/electron/src/renderer/hooks/useWorkspaceChatStarters.ts`，`AppShell.tsx` 改用之 | 切换即清空、请求序号、作废标记、失败即空；供真实组件级验收 |
| R10 | `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx` | 分别追踪 default/utility 字段编辑意图；「保留存储值」只在与 `initialValues.activePreset` 同一 provider 时成立；tier 触发器加 `data-testid` |
| M-01 | `packages/shared/src/mcp/validation.ts`、`mcp/client.ts` | 分类先读传输层 HTTP 状态（401/403 → needs-auth），文本正则保留为兜底；健康检查包装错误时保留 `code` |
| HE-14（本轮新发现） | `packages/server-core/src/services/heic.ts` | worker 结算后的 `error`/`exit` 不再计入 failed（成功转码曾被计为 1 次失败） |

### 11.2 验证基础设施修复

- **VF-04**：`governance-closeout-workflow.ts` 恢复严格口径（撤销上一轮的离线特例）；`upgrade-0153-usage-ledger-workflow.ts` 把 F1 移出通过集（`known-issues.json` + `untested`）并新增 `L4-multi-call-session-rows-and-summary-reconcile`；`upgrade-0153-results.ts` 新增 `acceptance` 块（commandSuccess / functionalStatus / 失败门禁 / 环境受限 / 批准例外与已知问题）。
- **VF-05**：`theme-foundation-workflow.ts` 加入 `production-web-stages.json` 阶段证据与各阶段期限（spawn 30 s、contexts 60 s、auth 30 s、pages 60 s、page-ready 60 s、cleanup 15 s），`settle()` 加 5 s 期限，controls 导航改为 `domcontentloaded` + `[data-foundation-ready]`。
- **VF-06**：`fixture-bundle.ts` handshake 超时 `killAndReap`，handshake 后等待子进程退出有 15 s 上限。

### 11.3 本轮新增/更新的验收工作流

| 工作流 | 场景 | 结果 |
| --- | --- | --- |
| `upgrade-0153-workspace-isolation`（新） | CSW-01…05 工作区隔离 | 5/5 |
| `upgrade-0153-model-form`（新） | MF01…05 真实表单保存矩阵 | 5/5 |
| `upgrade-0153-chat-starters-landing` | CSL-01…11（新增 07…11：失败/禁用/切会话/切工作区/连点） | 11/11 |
| `upgrade-0153-usage-ledger` | L1…L4（新增 L4 多调用与汇总对账）+ F1 记录 | 4/4 |
| `upgrade-0153-mcp` | M3 扩展为分类矩阵（RFC6750/纯文本/空正文 401、403、500、不可达、健康） | 3/3 |

### 11.4 Windows 暂存与仓库外运行

- `cd apps/electron && bun run build:win && bun run electron-builder --config electron-builder.yml --dir --config.directories.output=<隔离目录>`；未签名、未安装、未覆盖 `apps/electron/release`。**仓库无 `portable` 目标**，portable 运行以「仓库外目录运行 unpacked」实现。
- 仓库外临时 cwd 中的真实 `Phaneris.exe`（`ELECTRON_RUN_AS_NODE=1`）：生产 HEIC 入口（当前源码 CJS 打包，`heic-convert` external）→ 包内解码器、2048×1536、101,528 字节 JPEG；`node-pty` 从包内解析并真实创建 ConPTY 执行 `cmd.exe /c echo PTY_OK`。
- `koffi`：不在 lockfile、未安装、无引用（仅 `trustedDependencies` 残留）→ 桌面产物无消费点。`sharp`：唯一生产导入方是无头服务端平台（`platform-headless.ts:68,74` ← `bootstrap/headless-start.ts`），不属于桌面产物可达路径；本机无法构建无头产物（`server:build` 仅 darwin/linux），该验收位置记为 environment-limited。

### 11.5 最终采集与工作树状态（2026-10-19 19:36 +08:00）

- 采集：`bun run scripts/verification/upgrade-0153-results.ts`，`complete: true`（未使用 `--only/--skip-gates`）。
- 门禁：**26 pass / 1 failed / 1 environment-limited**；`test-critical` failed、`server-build` environment-limited。
- 验收判定（`acceptance` 块）：`commandSuccess: false`、`functionalStatus: **not-accepted**`。
- 证据：220 个验证运行、213 个绑定当前 lockfile；冻结目标 38 命中 + 1 批准例外。
- 结果文件两处机械修正（不改门禁状态）：同一 `known-issue` id 的重复条目去重（10 → 7），`notVerified` 改为与实际一致（打包 unpacked 已完成仓库外验证；`sharp` 归为无头产物环境受限；`portable` 目标不存在）。
- **并发写入提醒**：采集期间工作树中存在另一任务的未跟踪/已修改文件（`scripts/verification/pi-interruption-recovery-workflow.ts`、`docs/verification/pi-interruption-recovery-failure-matrix.md`、`packages/server-core/src/runtime-adapters/message-delivery-reconciliation.ts`，以及 `session-tools-core`/`shared`/`durable-runtime` 下的相关改动）。因此本次采集是 19:20 前后的树快照；`tsc -p tsconfig.tooling.json` 在该未跟踪文件上（`pi-interruption-recovery-workflow.ts:170`）当前报错，属并发任务的新增文件，不在本升级的可跟踪改动集内，也未由本任务修改。
