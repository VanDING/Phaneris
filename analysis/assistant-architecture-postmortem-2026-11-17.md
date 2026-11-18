# Phaneris 助手架构复盘：从最新一次会话看错误成因与系统性缺陷

分析日期：2026-11-17
分析对象：Phaneris 桌面应用内助手（本仓库 packages/* 与 apps/* 实现的 agent 运行时）
数据来源：`~/.phaneris/workspaces/Work/sessions/*/session.jsonl`、同目录 `.pi-sessions/*.jsonl`（Pi SDK 原始事件流）、近 150 个会话的聚合统计，以及本仓库运行时、工具层、提示词层代码与 Pi SDK 1.5.0 文档。
范围说明：本文只分析、不修改代码，也不给实施步骤；末尾只做"结构性 / 可缓解"的性质判断。

---

## 0. 结论先行

最新一次交互会话（`261117-open-lion`，13:31–14:07，手动触发每日双联知识推送）在 UI 上是一次"成功"：最终两条消息发出、卡片上传、归档完成，89 次工具调用里 `isError` 为 **0**。

但它同时是当前助手架构问题的一次完整显影：

- 为了完成一个 26 个字的指令，付出了 **81 次模型请求、1654 万输入 token、33 万 token 上下文峰值**，输出只有 3.6 万 token。
- 工具结果里（模型可见文本）实际出现 **2 次 UnicodeEncodeError、1 次 PowerShell ParserError、2 次 Traceback、3 次非零退出**，另有 3 处工具输出出现真实乱码（U+FFFD 替换字符，单次最多 230 个），但产品侧 89 次调用全部记为 `completed`、`isError=false`。
- 出现 **4 次 source_activation 续跑**，每次把原指令以 hidden 用户消息重发、整个中断重来，并把工具表变化带来的缓存失效也算进成本；`tool_search` 引入 decide 工具导致工具表变化后，紧随的请求出现 **31.5 万 token 全量未命中缓存**。
- 一条 612 KB 的截图以 1.57 MB 的工具结果记录落盘，模型侧收到 1210×2000 的 JPEG 图像块（base64 约 787 KB）；有显示尺寸缩放，但没有 token 预算与计量。

结论：这些不是若干独立 bug，而是**五层契约同时失效**——操作系统/编码契约、工具契约、上下文预算契约、错误语义契约、控制流契约。其中前三层造成了本会话的"各类错误"，后两层让这些错误既不可见、也不可被统计。

---

## 1. 会话事实基线

| 指标 | 数值 |
|---|---|
| 会话 | 261117-open-lion（Manual Knowledge Push） |
| 模型 / 思考级别 | deepseek/deepseek-v4.1-flash / max |
| 权限模式 | allow-all（上一模式 ask） |
| 用户输入 | 5 条：1 条真实指令（26 字）+ 4 条 hidden runtime_continuation |
| assistant 消息 / 工具调用 / 模型请求 | 68 / 89 / 81 |
| 输入 token | 16,541,998（其中 cacheRead 15,637,376，未缓存约 90 万） |
| 输出 token / 推理 token | 36,232 / 18,694 |
| 上下文峰值 | 330,198 token（压缩阈值 983,616，全 35 分钟未触发压缩） |
| 记录成本 | $0（knownCostRequests 73，unknownCostRequests 8） |
| 工具结果持久化体积 | 3,242,261 字符（其中 structuredContent 约 241 万字符，模型不消费） |
| 模型实际可见的工具文本 | 591,505 字符（单条最大 197,712 字符） |
| 用户消息包装体积 | 48,858 字符（真实指令共 130 字符） |
| 系统提示词 | 16,690 字符（不含工具 schema），每轮重建 |

关键请求的缓存行为（输入 / 缓存命中）：

| 请求 | 触发点 | 输入 | cacheRead |
|---|---|---|---|
| #14 | 第 1 次 source_activation 后 | 117,491 | 12,288 |
| #23 | 第 3 次 source_activation 后 | 158,387 | 14,976 |
| #24 | 第 4 次 source_activation 后 | 106,079 | 173,312 |
| #49 | `tool_search` 引入 decide 工具后 | 315,442 | 2,048 |

这四次跳变合计约 70 万未缓存 token，占全部未缓存输入的绝大部分。机制在代码里是显式的：代理工具定义一变化就 `toolsChanged = true`，下一轮提示词**销毁并重建 Pi 会话**（`packages/pi-agent-server/src/index.ts:1777-1787`、`:1898-1911`）。工具表属于请求前缀，前缀一变，历史缓存整体失效。

---

## 2. 这次会话里出现了哪"各类错误"

### 2.1 编码与平台契约（最直接、最频繁）

现象：

- Python 向 stdout 打印中文/emoji 时报 `UnicodeEncodeError: 'gbk' codec can't encode character`，本会话模型可见 2 次（同批还有 2 次 Traceback、3 次 `Command exited with code 1`）。
- `wecom-cli ... sessions list` 返回的中文全为乱码（该工具结果含 78 个 U+FFFD 替换字符，另有两处输出分别含 230 和 32 个）；文件/目录列表中文名乱码；模型只能靠 chat_id 硬匹配绕开。
- PowerShell 内联 `python -c "..."` 触发 `ParserError`，模型被迫先 Write 脚本文件再执行。
- 工具输出携带 ANSI 转义与 `\r\n`，直接进上下文，占用 token 且干扰阅读。

直接原因（已核对实现）：

- Pi SDK 的 shell 工具在 Windows 上以 `-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command` 启动 PowerShell，并把整条命令作为**单个 argv** 尾附（`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js:63-69`、`dist/utils/shell.js:121-145`）。Windows 命令行转义与 PowerShell 二次解析叠加，内联引号必然丢失。
- 子进程 stdout/stderr 用默认 UTF-8 `TextDecoder` 解码（`dist/core/tools/output-accumulator.js`），而 Windows 控制台代码页仍是 936；Python 因 stdout 是管道且没有 `PYTHONIOENCODING`/`PYTHONUTF8`，按 locale 编码输出。于是**乱码与 EncodeError 是同一根因的两个症状**：链路两端编码契约不一致，且没有协商层。
- 仓库内唯一的结构化脚本通道 `script_sandbox` 在 Windows 不可用（`packages/session-tools-core/src/tool-defs.ts` 明确"Windows currently has none"），所以只能退回字符串 shell。

架构含义：Windows 是这套产品的一等平台，但"命令执行"这一层没有平台适配层，只有一条假设 POSIX/UTF-8 的通用路径。

### 2.2 工具契约不一致

- `browser_tool screenshot <path>` 静默丢弃路径参数（`packages/shared/src/agent/browser-tool-runtime.ts:1222-1254` 只解析 `--png/--annotated`），固定写入 `downloads/browser-screenshot.*`；模型只能再 `Copy-Item` 一次。
- `browser_tool` 把 JS `evaluate` 放在字符串子命令协议后面，引号规则由宿主自研；跨会话统计里该类解析失败近 30 天 17 次（`Parse error: unclosed quote`、`Unknown browser_tool command "["evaluate"...`、参数 JSON 解析失败）。
- 工具名在"运行时名 / 显示名 / 历史记录名"三套之间漂移：`powershell` 被映射为 `Bash`、`read` 为 `Read`（`packages/shared/src/agent/backend/pi/constants.ts:35-54`，`event-adapter.ts:1229`）。近 30 天出现 **44 次 "Tool X not found"**，其中 `Bash` 8 次、`Read` 8 次，另有 MCP 名连字符/下划线漂移（`mcp__vanbrain_local__search` 6 次 vs `mcp__vanbrain-local__search` 4 次）。
- `Edit` 要求逐字节精确匹配，失败信息直接抛给模型（近 30 天 15 次 `Could not find edits` / `Could not find the exact text`）。
- WebFetch / session web_fetch 的失败率是全部工具里最高的（25.1% / 30.0%，近 30 天 110 次），主要来自源站 404、ECONNRESET、"fetch failed"——来源层没有新鲜度与重试策略，退化工作由模型手工完成。

### 2.3 上下文与成本

- 单条工具结果进入模型的上限由 `ResultBudget` 决定：`min(256_000, 1000 + 剩余配额 × 权重占比)` 字符（`packages/pi-agent-server/src/request-capacity.ts:43-50`），缺省 48,000（`index.ts:1291`）。**注意单位**：这里的"可用配额"直接来自 `capacity.availableInputTokens`，是 token 数（`index.ts:308-315`）。token 当字符用，等于把每条读/查类结果的上限放宽到约 5–6 万 token。本会话单条最大 19.8 万字符（新华社 RSS 全文）就这么进来的。
- 设计里本来有"超预算→头尾预览+落盘 long_responses"（`packages/pi-agent-server/src/tool-result-view.ts:109-139`），但本会话 `long_responses` 为空：预算高达 25.6 万字符，19.8 万字符的结果根本触发不了截断。防线在，但阈值设在几乎不会生效的位置。
- 图片链路没有 token 预算：附件缩放只在模型声明 `inputLimits` 时生效（`packages/server-core/src/sessions/model-image-input.ts:21-40`、`packages/shared/src/config/models.ts:151-154`），本会话模型能力里没有 `inputLimits`，该分支未生效；工具结果图片走另一条路径（`packages/pi-agent-server/src/index.ts:1415-1428` 原样透传），只有显示尺寸缩放——本会话 Read 返回的图片以 1210×2000、787 KB base64 的图像块进入请求，工具结果记录 1.57 MB 落盘。`structuredContent`、`details` 不受预算约束、原样持久化，本会话约 241 万字符，模型不消费但占磁盘与审计口径。
- 压缩阈值 = 上下文窗口 − reserve（1M 窗口 → 约 98.3 万 token 才触发）。本会话峰值 33 万，永远到不了阈值；成本随轮次线性增长，压缩这一层等于不存在。

### 2.4 控制流寄生在"用户消息"上

- `mcp__session__source_activate` 的语义是"下一轮生效"，实现方式是：宿主中止整个 turn（force abort），然后把**原始用户消息原文**加上 `[slug activated]` 作为一条 `hidden=true` 的新用户输入重发（`packages/server-core/src/sessions/SessionManager.ts:11712-11755`）。
- `hidden` 只影响 UI 分组，不影响模型（`packages/core/src/types/message.ts:360-365`）。所以每次激活 = 一条重复用户消息 + 一个新 turn + 一次重新规划。本会话 4 次激活 = 4 条隐藏消息（共约 4 万字符包装）+ 4 次 turn 重启。
- 去重只有"同批首个激活生效"和 2 秒旧客户端防重放（`SessionManager.ts:11720-11749`）；没有跨激活合并、没有次数上限、没有注入预算（对比 skills 32k、sources 8k 都有预算）。
- 更严重的一环是中止后的一致性收敛：`convergeCanonicalContext` 在投影与"canonical facts"分叉时会走 `replaced` 分支——把全部贡献条目用 `context_edit(null)` 掩掉，再把 canonical 记录整段重放（`packages/pi-agent-server/src/canonical-model-context.ts:219-299`）。而 canonical 重放用记录里的 `item.toolName`（`:65-83`），也就是已经被规范化成 `Bash`/`Read` 的名字。11-15 的会话 `261115-mild-heron` 完整呈现了这条链：source_activate → 中止 → 26 条 context_edit → 重放带 `Read/Bash` 名字的整段历史 → 10 秒后模型学着调用 `Bash` → `Tool Bash not found`。

### 2.5 错误语义在边界处丢失

- Pi SDK 对失败的工具结果是置 `isError: true` 的，但产品在 T2 持久化时硬编码传 `false`（`packages/pi-agent-server/src/index.ts:1294-1300` 调 `requestDurableToolOutcome(..., false)`）。
- 旧事件路径补了一个英文正则兜底：`/^\s*(\[ERROR\]|Error:|error:)/`（`packages/server-core/src/sessions/SessionManager.ts:11212-11219`）。中文 `Traceback`、`ParserError`、`Command exited with code 1` 全部不匹配。
- 于是出现三重失真：SDK 知道错 → T2 记成成功 → canonical 重放也按 `item.isError=false`（`canonical-model-context.ts:96`）→ UI/统计显示 `completed`。本会话 2 次 EncodeError、1 次 ParserError、2 次 Traceback、3 次非零退出、3 处真实乱码，最终 `isError=0`。
- 成本同理：本会话 `costUsd=0`、`unknownCostRequests=8`；自定义端点没有定价时成本无法归集，1654 万 token 在账面上是零。

### 2.6 规范漂移与"现场读文档"

- 系统提示词默认不包含能力文档路由（`packages/shared/src/prompts/assistant-prompt.ts:34-37` 只保留 questions/communication 两段），SDK 技能发现被显式关闭（`packages/pi-agent-server/src/phaneris-resource-loader.ts:69` `noSkills: true`）。没有 `[skill:x]` 显式选择时，SKILL.md 不会被注入——本会话助手是自己 `Read` 了 1.4 万字符的 SKILL.md、3.6 万字符的微盘参考、2.7 万字符的 browser-tools 文档、7 万字符的 automations.md。
- 自动化任务定义本身写在 `automations.json` 的 prompt 里（本任务约 2.3 万字符），而 prompt 在 schema 里只有 `min(1)` 约束（`packages/shared/src/automations/schemas.ts:24-26`）：没有长度上限、没有检查点、没有幂等键。手动测试路径还跳过 loop guard 与语义条件（`packages/server-core/src/handlers/rpc/automations.ts:189-205`），与定时触发语义不一致。
- 行为规范散落在至少五处：系统提示 5 段、工具 namespace instructions、产品 docs 手册、2.3 万字符 automation prompt、workspace 里的 `SEND_RULES.md`。没有任何一处是机器可校验的。于是本会话出现了典型的"规范 vs 实践"权衡：SEND_RULES 要求 JSON 内容避免裸双引号，但 day73/74 一直用裸双引号且发送成功，助手在两条规则之间反复推理后才决定替换为「」。

### 2.7 重复劳动：同一工作流第 75 天仍在"现做"

- `daily-duo` 工作流已经连续跑 73 次会话（`build_day2.py` … `build_day75.py` 共 50 个构建脚本、53 份 msg1 JSON、10 个校验脚本，全部为逐日现场生成）。
- 73 次会话累计输入 **8.85 亿 token**，平均每次 1210 万 token、209 条消息。
- 每次都要重新：读 SEND_RULES、读 last-day 产物、读模板、写 build 脚本、写校验脚本、起本地 server、开浏览器截图、发消息、上传、归档。本会话与 11-13、11-15、11-16 的会话在编码/引号/截图路径上遭遇的是同一批问题。
- 这说明产品里"自动化"目前只到"定时发一段自然语言"，没有到"把工作流固化为工具/脚本/校验器"。助手实际上被当作人工流水线在反复驱动。

---

## 3. 五条根因链

把上面的现象串起来，是五条可以独立复现的链路：

**链 A｜编码链**
UTF-8 假设的宿主 ⇄ 代码页 936 的 Windows 子进程 → 乱码 / EncodeError → 模型读不懂输出 → 换写法重试（写脚本、`sys.stdout.reconfigure`、复制到 UTF-8 文件）→ 每轮多 1–3 次工具调用与数千 token。

**链 B｜命名链**
运行时小写工具名 → 事件适配器规范化为 PascalCase → 产品记录用 PascalCase → canonical 收敛时用记录名重放给模型 → 模型模仿历史里的名字 → 调用不存在的 `Bash`/`Read` → `Tool not found` → 再重试。MCP 名（连字符/下划线）是同一问题的第二个变体。

**链 C｜预算链**
`availableInputTokens` 当字符配额 → 单结果上限 25.6 万字符 → 19.8 万字符 RSS、20 万字符目录列表、30 万字符他会话 tail 全部直达上下文 → 上下文以每轮数万 token 增长 → 33 万峰值、1650 万累计输入 → 每次工具表变化都要把这 30 万 token 重算一遍。

**链 D｜重建链**
source_activate / tool_search 增加工具 → 代理工具定义变化 → 销毁重建 Pi 会话 → 请求前缀（工具表+系统提示）变化 → 缓存全失效（117k / 158k / 315k）→ 若此时投影与 canonical facts 分叉，再走 `replaced`：掩掉全部条目 + 重放 canonical 历史（并带上链 B 的名字）→ 4 条 hidden 用户消息 + 4 次重新规划。

**链 E｜语义链**
SDK `isError` → T2 硬编码 false → 英文正则兜底 → canonical 重放沿用 false → UI/统计/成本全部显示"成功" → 失败不可见、不可审计、不可回归 → 同类错误在 73 次会话里反复出现而无人在数据层发现。

---

## 4. 架构级问题（按影响排序）

1. **上下文没有 token 级硬预算。** 预算单位是字符、来源是 token，实际生效阈值（25.6 万字符/条）几乎等于不设防；`structuredContent`、图片、details 还不受预算约束。33 万 token 的上下文峰值与 1650 万累计输入是这条的直接结果。
2. **provider view 不稳定，前缀缓存的设计假设被自己破坏。** 系统提示词每轮重建、工具表变化触发会话重建、canonical 收敛会整段掩码重写、resident 段整段替换。结果是"稳定前缀+易变尾部"的拆分（这是产品明确设计过的，#862）只在没有能力变化时成立；一旦有激活/发现，整段上下文重算。
3. **控制流没有独立通道。** 激活、续跑、重试都用"把原文再发一遍用户消息"表达；hidden 只是 UI 概念。turn 语义因此被控制事件污染，成本随激活次数线性增长，且没有合并/上限/预算。
4. **错误语义没有单一真源。** SDK、T2 持久化、canonical 重放、旧事件路径、UI 投影各自维护一份 isError/toolStatus 判断；T2 硬编码 false，兜底只认英文。最终 2 次 EncodeError、1 次 ParserError、2 次 Traceback、3 次非零退出、3 处真实乱码可以汇总为 0 错误。
5. **工具命名空间不统一。** 运行时名（powershell/read）、显示名（Bash/Read）、MCP 代理名（连字符/下划线）三套并存，且记录名会被重放给模型；近 30 天 44 次 `Tool not found` 是它的直接代价。
6. **平台适配缺一层。** Windows 上命令执行沿用 POSIX/UTF-8 假设：无编码协商、无 `-Command` 之外的传参通道、无可用 sandbox。产品声明支持 Windows，但最常用的工具路径没有平台适配层。
7. **规范只有自然语言，没有执行点。** 行为规范分散在系统提示、docs、automation prompt、workspace 规则四处以上，无解析器、无校验器、无回归；文档路由默认不进系统提示，于是"每次现场读几万字符"成为常态。
8. **技能/自动化没有固化层。** 73 天、8.85 亿 token 的同一工作流仍在逐日生成脚本、逐日重写校验；自动化只做到"cron + 一段 prompt"，没有做到"工具 + schema + 校验 + 幂等"。
9. **图像与多模态链路无 token 预算与计量。** 附件缩放依赖模型声明 `inputLimits`（本会话未声明）；工具结果图片只按显示尺寸缩放（1210×2000、787 KB base64），1.57 MB 记录落盘；图像 token 不进入任何预算判断与成本归集。
10. **可观测性记录的是体积，不是因果。** contextSnapshot 的 `chars` 把 structuredContent/base64 算进去，与真实 token 不一致；cost 为 0；本会话 5 处请求序号跳号（重试或内部请求）不落任何可区分的事件；source 结果 `coverage` 普遍是 `unknown`。复盘时能看到的只有"很大"，看不到"为什么大"。

---

## 5. 影响面量化

| 维度 | 数值 |
|---|---|
| 全部会话 | 648 个，50,785 次工具调用，4,518 次工具失败（8.9%） |
| 近 30 天 | 150 个会话，11,608 次工具调用，593 次失败（5.1%） |
| 失败率最高的工具（近 30 天） | session web_fetch 30.0%、WebFetch 25.1%、decide 19.8%、browser_tool 9.7%、Bash 5.1% |
| 失败类型（近 30 天） | 其他 321、网络 123、tool not found 44、超时 21、browser 解析 17、路径 16、edit 精确匹配 15、exit code 12、编码 10 |
| 权限模式（近 30 天） | allow-all 148 / ask 3 |
| 近 30 天输入 token | 14.5 亿 |
| 近 7 天 | 20 个会话、1.61 亿输入 token，其中 16 个是自动化（A 股 10、双联 6） |
| 双联工作流 | 73 个会话、8.85 亿输入 token、平均 1210 万/次 |
| 单会话最高 | 1.897 亿输入 token（933 条消息，44 万上下文峰值） |

统计口径：上表"近 30 天"指 2026-10-16 起至统计时点；"近 7 天"指 2026-11-10 起；"全部会话"为工作区内存在 session.jsonl 的 648 个会话目录。

---

## 6. 判断：哪些是结构性的，哪些是可缓解的

- **结构性**（不改变数据模型或控制流就无法消失）：问题 1（预算单位与作用域）、2（provider view 稳定性）、3（控制流寄生于用户消息）、4（错误语义双源）、5（命名空间）、8（技能/工作流固化）。
- **可缓解**（不改变架构也能显著收敛）：问题 6（Windows 编码/传参/沙箱适配）、7（规范进提示或进校验器）、9（图像缩放与计量）、10（观测口径统一）。
- **已经存在但未生效的防线**：`long_responses` 溢出、`ResultBudget`、`context_edit` 压缩、`compact` 阈值、`large-result` 摘要钩子——它们都在代码里，但阈值/单位/触发条件让它们在本会话里一次都没生效。这是"设计过但没有接线"的典型状态。

---

## 附录：证据索引

- 会话数据：`~/.phaneris/workspaces/Work/sessions/261117-open-lion/session.jsonl`、`.../.pi-sessions/2026-11-17T05-32-00-412Z_01a1e7fd-*.jsonl`
- 对照会话：`261115-mild-heron`（工具名重放链）、`261116-crisp-silver`（browser_tool 解析失败）、`261117-clear-titanium`（路径失效）
- 预算/单位：`packages/pi-agent-server/src/index.ts:308-315`、`packages/pi-agent-server/src/request-capacity.ts:43-50`、`packages/pi-agent-server/src/tool-result-view.ts:109-139`
- 错误语义：`packages/pi-agent-server/src/index.ts:1294-1300`、`packages/server-core/src/sessions/SessionManager.ts:11212-11219`、`packages/pi-agent-server/src/canonical-model-context.ts:96`
- 控制流：`packages/server-core/src/sessions/SessionManager.ts:11712-11755`、`packages/pi-agent-server/src/index.ts:1777-1787,1898-1911`、`packages/pi-agent-server/src/canonical-model-context.ts:219-299`
- 命名：`packages/shared/src/agent/backend/pi/constants.ts:35-54`、`packages/shared/src/agent/backend/pi/event-adapter.ts:1229`
- 提示词/技能：`packages/shared/src/agent/pi-agent.ts:2756-2766`、`packages/pi-agent-server/src/phaneris-resource-loader.ts:69`、`packages/shared/src/automations/schemas.ts:24-26`、`packages/shared/src/prompts/assistant-prompt.ts:34-37`
- 平台层：`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js:63-69`、`dist/utils/shell.js:121-145`、`dist/core/tools/output-accumulator.js`
- 图像：`packages/server-core/src/sessions/model-image-input.ts:21-40`、`packages/shared/src/config/models.ts:151-154`、`packages/pi-agent-server/src/index.ts:1415-1428`
- 压缩语义：`node_modules/@earendil-works/pi-coding-agent/docs/compaction.md`、`docs/session-format.md`（context_edit）
