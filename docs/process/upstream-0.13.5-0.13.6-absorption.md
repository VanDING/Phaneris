# 上游 v0.13.5 / v0.13.6 吸纳评估与合并计划

- 日期：2026-09-28。本仓基线：`484e46f7`（`main`，版本 0.2.3）；上游基线：`53393340`（`v0.13.5`）、`3eac37be`（`v0.13.6`）。
- 与上游的 merge-base 仍是 `v0.13.3`（`e8963854`）：上游在其上只有 3 个压平提交（`v0.13.4`、`v0.13.5`、`v0.13.6`），**三版都没有合并进本仓**；本仓在其上领先 388 个提交。
- 每个上游发布压成单个提交，因此"某一版的完整差异"就是那一个提交：
  - `v0.13.4` → `v0.13.3`：96 文件，+3366/−1002（本仓已于 `docs/process/upstream-0.13.4-absorption.md` 单独评估并落地 5/6 项）
  - `v0.13.5` → `v0.13.4`：43 文件，+931/−377
  - `v0.13.6` → `v0.13.5`：146 文件，+7614/−589
- 判定词：`采纳`（原样移植）、`适配后采纳`（机制成立，需按本仓结构改写）、`已等价`（本仓已独立具备或更优）、`不需要`、`不适用（Claude 专属）`、`不适用（文件已删除）`。
- 复现方法：
  ```bash
  git fetch upstream --tags
  git diff --stat v0.13.5 v0.13.6            # 0.13.6 全量差异
  git diff v0.13.5 v0.13.6 -- <path>          # 单文件上游改法
  git diff HEAD v0.13.5 -- <path>             # 本仓相对上游基线的偏离量
  git show v0.13.6:<path>                     # 上游成品
  ```

## 0. 结论摘要

### 0.1 三条硬约束（先读）

任何移植都必须先过这三条，违反任一条都会被仓库门禁或产品约定挡住：

1. **`identity:check` 是硬门禁。** `scripts/check-identity.ts` 逐行扫描并禁止 `/craftagents/gi`、`/\bCRAFT_[A-Z0-9_]+/g`、`/@craft-agent\//g`、`/craft-agent/g`、`/Craft Agents/g`、`\.craft-agent`、`lukilabs|Craft Docs Ltd\.|craft\.do`。因此：
   - 上游 `CRAFT_DEBUG_FULL_BODIES`（#1033）必须改名为 `PHANERIS_DEBUG_FULL_BODIES`；
   - 上游 Slack 托管 relay 常量 `https://thecraftagents.com/...`（#1068）**不得引入**——它会同时撞 `craftagents` 与"永不回退上游托管 relay"的产品约定；
   - 任何 `CRAFT_CONFIG_DIR` 字样不得引入。
   - 例外：`PROVENANCE` 正则允许 `craft-agents-oss#NNN` 与 `craft-ai-agents/<repo>`，即**出处注释可以保留上游引用**（本仓既有代码大量如此）。
2. **Claude Agent SDK 后端已从本仓删除。** `packages/shared/src/agent/claude-agent.ts`、`agent/backend/claude/*`、`agent/claude-sdk-error-mapper.ts` 均不存在，PiAgent（`packages/shared/src/agent/pi-agent.ts` + `packages/pi-agent-server`）是唯一后端。0.13.6 差异中所有只改 Claude 文件的改动一律不适用。
3. **`CRAFT_CONFIG_DIR` 在本仓被刻意忽略。** 本仓变量是 `PHANERIS_CONFIG_DIR`（`packages/shared/src/config/paths.ts:31` 的 `CONFIG_DIR_ENV_VAR`）。详见 §3.7。

### 0.2 判定总表

12 条 0.13.6 release note 无一遗漏，另有 0.13.5 的 4 项与 1 块未列入说明的新功能。**"独立缺陷"= 本仓确实存在、且已定位到具体行的缺陷**（共 8 项）。

| # | 上游改动 | 独立缺陷? | 判定 | 工作量 | 批次 |
|---|---|---|---|---|---|
| 0.13.5-a | Pi 系统提示注入改为 `before_agent_start` 扩展（Pi 0.87 只读 `state.systemPrompt`） | 否 | 已等价（本仓 `phaneris-resource-loader.ts` + SDK 已 0.87.1） | — | — |
| 0.13.5-b | 模型目录补录：Opus 5.5 / Bedrock 映射 / 默认模型 | 是（模型不可选） | 适配后采纳 | S | B3 |
| 0.13.5-c | `deepseek-v4-flash` → `deepseek-flash` 存量迁移 | 是（缺 2 条迁移表项） | 适配后采纳 | S | B3 |
| 0.13.5-d | Claude Agent SDK 0.3.258→0.3.280、Claude 侧全部 | — | 不适用（Claude 专属） | — | — |
| 3.1 | #1056 transcript 路径多出 `.` / `/Volumes.` | **是**（`files.ts:888/909/914` + 两个调用点不传 cwd） | 采纳 | S | B1-3 |
| 3.2 | #1067 header 凭证被 JSON 序列化后上线 | **是**（已实测复现） | 适配后采纳 | M | B1-2 |
| 3.3 | #1065 `allowedWritePaths` 未在 Ask to Edit 生效 | **是**（`pre-tool-use.ts:1027-1039` 无允许清单判断） | 适配后采纳 | S | B1-1 |
| 3.4 | #1058/#1060 手动 `/compact` 期间的消息丢失 | **是**（`redirect()` 返回 true、不入队、无重放） | 适配后采纳（**4 项同批**） | M | B2 |
| 3.5 | #1059 关闭弹窗后内置浏览器不可用 | **是**（3 处缺口：`cdp.detach` 无保护、弹窗 `webContents` 读取、实时读 `pageView.webContents.id`） | 适配后采纳 | M | B1-6 |
| 3.6 | #1048 编辑已保存连接时测试连接失败 | **是**（掩码被当作密钥测试） | 适配后采纳 | S–M | B1-5 |
| 3.7 | #1062 `CRAFT_CONFIG_DIR` 未覆盖全部路径 | 否 | 已等价（22 处 offender 中 21 处本仓已合规，部分更严） | S（补契约测试） | B0 |
| 3.8 | #1033 拦截器调试日志无界 + 记录完整请求体 | **是**（无大小上限、无单条上限、请求体全量落盘） | 适配后采纳 | M | B1-7 |
| 3.9 | #1054 MCP OAuth 资源指示器（RFC 8707/9728） | **是**（`resource` 解析后被丢弃） | 适配后采纳 | S–M | B4 |
| 3.10 | #1068 Slack 桌面登录 | 是（本仓为**另一种**缺陷：无 relay 时交 `http://localhost:<port>`） | 适配后采纳（上游 relay 常量必须替换） | M | B4 |
| 3.11 | #1071 MCP 源连接失败静默丢弃 | **是**（两层都缺，`sync()` 返回值被丢弃） | 适配后采纳 | S | B1-4 |
| 3.12 | #1072 Pi/DeepSeek 推理占满输出预算无告警 | **是**（无告警；且上游守卫在本仓不可达） | 适配后采纳 | S | B2 |
| 3.13 | 决策层（`decisions/*`，**未列入 release notes 的整块新功能**） | 否（本仓无此功能） | 适配后采纳（**分阶段，需产品决定**） | M–L | B5 |
| 3.14 | 其余未归类（`base-agent`/`backend types`/`pi session-tool-defs`/`prompts`/`source_activated`/文档/版本位/`CLAUDE.md`） | 部分（`source_activated` 兜底缺失） | 逐条：采纳 / 不需要 / 不适用 | S | 见 §3.14 |

汇总：§3 中判为"本仓确实存在缺陷"的有 **10 条**（3.1、3.2、3.3、3.4、3.5、3.6、3.8、3.9、3.11、3.12），其中 **3.2、3.3、3.8、3.11 是纯本仓内的缺陷、与上游的新功能毫无关系**，可以立刻做且互不依赖。另有 3 条属于"缺口/本仓特有形态"而非上游所修的那条缺陷：**3.10**（Slack 桌面登录，本仓是"无 relay 时交出 `http://localhost:<port>`"这另一种坏法）、**0.13.5-b / 0.13.5-c**（模型目录未补录、DeepSeek 存量迁移缺 2 条）、以及 3.14 里 `source_activated` 兜底缺失。**3.7 本仓已合规**；**3.13 是新功能而非修复**。

### 0.3 一句话结论

**0.13.5 在 bug fix 维度确实为空**（上游该版本一条 Bug Fixes 都没有），但**模型目录维度有真实缺口**（Opus 5.5 未补录、DeepSeek 存量迁移缺 2 条）；**0.13.6 的价值集中在 12 条修复里的 10 条本仓确实存在的缺陷**，另有 1 块上游未在 release notes 披露的新功能（决策层）需要单独的产品决定。**不要尝试合并或 cherry-pick 上游提交**——本仓已删除 Claude 后端、刻意不受理 `CRAFT_CONFIG_DIR`、并永不回退上游托管服务，正确做法是按本文件的批次逐项手写移植。

## 1. 本仓与上游的关系

### 1.1 全量文件分类（`v0.13.5..v0.13.6` 的 146 个文件 vs 本仓 `HEAD`）

用 blob 哈希逐文件比对本仓 `HEAD` 与上游 `v0.13.5` / `v0.13.6`：

```powershell
# 逐文件：本仓版本与上游两个版本是否为同一个 blob
git rev-parse "HEAD:<path>"; git rev-parse "v0.13.5:<path>"; git rev-parse "v0.13.6:<path>"
```

逐文件结果（146 行）见 [`upstream-0.13.6-file-classification.csv`](upstream-0.13.6-file-classification.csv)，列为：`upstream_status`（上游 M/A）、`path`、`our_relation_to_v0_13_5`（下面的三类之一）、`upstream_changed_lines`、`our_diverged_lines`。

| 类别 | 文件数 | 含义 |
|---|---|---|
| `SAME_AS_0.13.5` | 5 | 本仓与 0.13.5 逐字节相同 → 上游新版本可直接覆盖 |
| `DIVERGED` | 97 | 本仓已改写 → 需三方合并 |
| `HEAD_MISSING` | 44 | 本仓无此文件：33 个是 0.13.6 新增，11 个是本仓主动删除/改名 |

`SAME_AS_0.13.5` 的 5 个文件正好都属 #1054（MCP OAuth）：

- `packages/shared/src/auth/generic-oauth.ts`、`oauth-flow-store.ts`、`oauth-flow-types.ts`、`packages/shared/src/sources/index.ts`、`packages/server-core/src/sessions/source-activated-auto-retry.test.ts`

`HEAD_MISSING` 中被本仓删除/改名的 11 个（上游同名文件在本仓不存在）：

| 上游文件 | 本仓对应物 |
|---|---|
| `packages/shared/src/agent/claude-agent.ts` | 已删除（无 Claude 后端） |
| `packages/shared/src/agent/backend/claude/event-adapter.ts` | 已删除 |
| `packages/shared/src/agent/claude-sdk-error-mapper.ts` | 已删除 |
| `packages/shared/src/agent/__tests__/claude-event-adapter.test.ts` | 已删除 |
| `packages/shared/src/agent/__tests__/claude-sdk-error-mapper.test.ts` | 已删除 |
| `packages/shared/src/auth/__tests__/oauth.test.ts` | 改名为 `auth/__tests__/oauth.isolated.ts`（+ `oauth.e2e.test.ts`） |
| `packages/session-tools-core/src/handlers/source-test.test.ts` | 改名为 `handlers/source-test.isolated.ts` |
| `apps/electron/src/main/__tests__/browser-pane-manager.test.ts` | 改名为 `__tests__/browser-pane-manager.isolated.ts` |
| `apps/electron/src/main/handlers/__tests__/registration.test.ts` | 改名为 `registration.isolated.ts` |
| `apps/electron/src/main/handlers/__tests__/registration-profiles.test.ts` | 改名为 `registration-profiles.isolated.ts` |
| `packages/session-mcp-server/package.json` | 本仓无此 workspace |

### 1.2 两条跨领域移植规则

1. **测试文件名要换。** 本仓约定：需要 `mock.module` 的测试必须命名 `*.isolated.ts`，由 `scripts/run-workspace-tests.ts` 在独立进程里跑。已核验 0.13.6 新增的 16 个测试文件中**没有任何一个使用 `mock.module`**，因此都可以按上游原名落地；但仍需逐个确认（尤其 `header-credential-shape.test.ts` 用了 `spyOn`，安全）。
2. **出处注释照抄，产品字符串一律不改。** 上游 diff 里的 `craft-agents-oss#NNN` / `craft-ai-agents/...` 注释可原样保留（`identity:check` 的 `PROVENANCE` 例外），其余品牌串、环境变量、路径一律换成本仓形态（来源：`packages/shared/src/identity.generated.ts`，由 `phaneris.identity.json` 生成）。

## 2. v0.13.5 评估（复核"没有值得吸收的内容"）

上游 0.13.5 的 release notes 只有 Features / Improvements 两节，没有任何 Bug Fixes——用户的判断方向正确。但逐文件核对后，**有 2 件事对本仓仍然有效**，其中 1 件是真实缺口。

### 2.1 Pi 系统提示注入机制重写 —— 已等价（且本仓已提前完成 SDK 升级）

- **上游改法**：`packages/pi-agent-server/src/system-prompt-override.ts` 从"直接写 `session.agent.state.systemPrompt` + `_baseSystemPrompt` + `_rebuildSystemPrompt` 三个内部字段"改为注册一个隐藏的内联扩展（`before_agent_start` 返回 `{ systemPrompt }`），并通过 `createCraftResourceLoader()` 把该扩展挂到会话的 `DefaultResourceLoader` 上。原因是 Pi 0.87 把 `agent.state.systemPrompt` 变成只读、并移除了 `_baseSystemPrompt` 字符串内部字段（上游 issue #648）。上游为此把 Pi SDK 从 0.85.1 升到 0.87.1。
- **我们的现状**：**已等价，且是独立实现的。** 本仓 `packages/pi-agent-server/src/` 没有 `system-prompt-override.ts`，而是 `phaneris-resource-loader.ts` + `system-prompt-delivery.test.ts`；`packages/pi-agent-server/package.json` 的 Pi 依赖已经是 `0.87.1`（与上游 0.13.6 同版本）。
- **判定**：`已等价`。**合并动作：无。**
- **对本计划的意义**：0.13.5 里最"重"的一项对本仓是空的，这也解释了为什么 0.13.5 的 43 个文件里有 12 个是 Claude 侧、其余多为版本位与 lockfile。

### 2.2 模型目录补录（Opus 5.5 / Bedrock 映射） —— 适配后采纳（真实缺口）

- **上游改法**（`packages/shared/src/config/llm-connections.ts` + `config/models.ts` + `config/storage.ts`）：
  - `PI_PREFERRED_DEFAULTS.anthropic` 与 `.amazon-bedrock` 首位插入 `claude-opus-5-5`，使**新连接**默认到 Opus 5.5；
  - `BEDROCK_MODEL_MAP` / `BEDROCK_REVERSE_MAP` 为 `claude-opus-5-5` / `claude-opus-5` 补齐 `us.` / `eu.` / `global.` / 无前缀四种形态；
  - `MODEL_REGISTRY` 中新增 `claude-opus-5-5`（1M 上下文 / 128k 输出），并把"自适应思考常开"从正则判断改为 `MODEL_REGISTRY` 上的 `thinkingAlwaysOn` 标志 + 覆盖 `claude-opus-5-5*` 的正则兜底；
  - `config/storage.ts` 把 `OPUS_DEFAULT_ID`/`OPUS_FALLBACK_ID` 重命名为 `OPUS_48_ID`/`OPUS_47_ID`，明确"存量连接继续钉在 4.8，只有新连接才用 5.5"，避免迁移把用户已有连接悄悄换模型。
- **我们的现状**（已核验）：
  - `packages/shared/src/config/llm-connections.ts:599` 的 `anthropic` 首位仍是 `claude-opus-4-8`，`:619` 的 `amazon-bedrock` 同样是 `claude-opus-4-8`；全仓 grep `claude-opus-5-5` **零命中**；
  - `BEDROCK_MODEL_MAP`（`:757`）无 `claude-opus-5-5` 条目；
  - `packages/shared/src/config/storage.ts:1965-1966` 仍是 `OPUS_DEFAULT_ID`/`OPUS_FALLBACK_ID` 旧命名（语义等价，无需跟改）；
  - **`packages/shared/src/config/models.ts:371` 的 `isAdaptiveThinkingAlwaysOnModel()` 在本仓已是死代码**——全仓只有定义、没有调用者（Claude 后端删除后 `resolveClaudeThinkingOptions` 一并消失），且 `ModelDefinition`（`:118` 附近）没有 `thinkingAlwaysOn` 字段。其正则目前只匹配 `claude-(fable|mythos)`，不含 `opus-5-5`。
- **判定**：`适配后采纳`（模型目录部分）+ 死代码清理（本仓自有问题）。
- **移植要点**：
  1. `PI_PREFERRED_DEFAULTS` 与 `BEDROCK_MODEL_MAP`/`BEDROCK_REVERSE_MAP` 补 `claude-opus-5-5`、`claude-opus-5`（四形态齐全）。本仓 Pi SDK 已是 0.87.1，`claude-opus-5-5` 确实在目录中，可选项能直接生效。
  2. **是否把 Opus 5.5 设为新连接默认，是本仓的产品决定**，不是上游的必然结论。若采纳，必须同时保留 `config/storage.ts` 的"存量连接不迁移"语义（本仓当前已是该语义）。
  3. `isAdaptiveThinkingAlwaysOnModel()` 要么删除，要么按本仓 Pi 路径的真实需要接线；**不要**照搬上游的 `thinkingAlwaysOn` 注册表字段，除非同时找到本仓的消费方（思考档位选择器 / pi-ai 参数映射）。落地前需确认本仓 Pi 路径在"关闭思考"档位下是否会向 Anthropic 发出 `thinking: { type: 'disabled' }`——若是，Opus 5.5 / Fable 这类常开思考模型需要与上游等价的降级处理。
- **验证**：新增模型目录断言（新连接默认模型、Bedrock 四种 id 形态可解析）；连接设置页实际选中 Opus 5.5 跑一轮对话。

### 2.3 DeepSeek 模型 id 存量迁移 —— 适配后采纳（缺口很小但确定）

- **上游改法**：`PI_PREFERRED_DEFAULTS.deepseek` 用 `deepseek-flash` 取代已下线的 `deepseek-v4-flash`，并在 `packages/shared/src/config/models.ts` 的 `DEPRECATED_MODEL_REPLACEMENTS` 里补两条存量映射：
  ```ts
  // DeepSeek retired the v4 Flash aliases; pi 0.86+ catalogs only list `deepseek-flash`.
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  ```
- **我们的现状**：
  - `PI_PREFERRED_DEFAULTS.deepseek`（`llm-connections.ts:613`）**已经**是 `['deepseek-v4-pro', 'deepseek-flash']`，注释也说明了原因——这一半已等价；
  - 但 `packages/shared/src/config/models.ts:66-75` 的 `DEPRECATED_MODEL_REPLACEMENTS` **缺少这两条**（只有 7 条 Opus 相关映射）→ 存量连接里钉着 `deepseek-v4-flash` 的默认模型不会被归一化；
  - 另外 `llm-connections.ts:620-621` 的 `opencode` / `opencode-go` 首选列表里**仍在引用**已下线的 `deepseek-v4-flash`，属于同一问题的残留。
- **判定**：`适配后采纳`，工作量 S。
- **验证**：`normalizeDeprecatedModelId('deepseek-v4-flash') === 'deepseek-flash'`（含 `pi/` 前缀形态）的断言；打开一个默认模型为 `deepseek-v4-flash` 的存量连接，确认被归一化。

### 2.4 Pi 重试策略 `maxAgentDelayMs` —— 已等价

- 上游 0.13.5 在 `packages/pi-agent-server/src/session-settings.ts` 给两套重试策略补 `maxAgentDelayMs: 60_000`（pi 0.86.0 起新增的 agent 级退避上限）。
- **我们的现状**：已在 `packages/pi-agent-server/src/session-settings.ts:49` 与 `:69` 显式声明，注释也说明了"钉住而非继承"的理由。**判定：`已等价`，合并动作无。**

### 2.5 Claude 侧全部改动 —— 不适用

版本位、`@anthropic-ai/claude-agent-sdk` 0.3.258→0.3.280、`claude-agent.ts` / `claude-sdk-error-mapper.ts` / `backend/internal/drivers/anthropic.ts` 的上下文窗口与 `thinkingAlwaysOn` 上报、`apps/electron/.../ApiKeyInput.tsx` 的 compat 默认串、`systemPrompt.snapshot` 约定等，均属已删除的 Claude 后端。**判定：`不适用（Claude 专属）`。**

### 2.6 本节结论

> 用户"0.13.5 没有值得吸收的内容"的判断在 **Bug Fixes 维度成立**（上游该版本确实一条 bug fix 都没有），但**模型目录维度不成立**：Opus 5.5 未补录、DeepSeek 存量迁移表缺 2 条。两者都是 S 级改动，建议随本计划 B3 批次一起做。

## 3. v0.13.6 逐项评估

### 3.1 #1056 transcript 路径多出 `.` / `/Volumes.` —— 采纳（缺陷存在，两半都要改）

- **上游改法**：两半，缺一不可。
  1. `packages/shared/src/utils/files.ts` 新增 `normalizeRelativizeBase(cwd)`：`cwd` 为空、只有分隔符、或是文件系统根（`/`、`C:\`，即 `/^[A-Za-z]:$/`）时返回 `undefined`。`formatSinglePathToRelative()` 首行改为 `const basePath = normalizeRelativizeBase(cwd); if (!basePath) return absolutePath;`——**彻底删掉 `cwd || process.cwd()` 兜底**；包含判断加上段边界（`absolutePath === basePath || startsWith(basePath + '/') || startsWith(basePath + sep)`），避免 `/Users/gy` 被当成 `/Users/gyula` 之内。`formatPathsToRelative()` 同样在 base 为 `undefined` 时原样返回文本，并把旧正则换成双侧锚定的 `ABSOLUTE_PATH_REGEX = /(?<![\w.\/~])\/(?:Users|home|var|tmp|opt|etc)(?![^\/\s:,\]\})"'`])[^\s:,\]\})"'`]*/g`——前锚避免把 `/Volumes/home/x`、`/private/tmp/x`、`//host/home`、`~/tmp` 里的根名误认成独立路径，后锚要求根名是完整段（`/Usersfoo` 不算）。
  2. `packages/server-core/src/sessions/SessionManager.ts` 两个调用点补上会话工作目录：`formatToolInputPaths(event.input, managed.workingDirectory)`（上游 `:7840`）与 `formatPathsToRelative(event.result, managed.workingDirectory)`（上游 `:7973`）。上游 0.13.5 这两处都不传 cwd。
- **我们的现状**：**缺陷两半都在。**
  - `packages/shared/src/utils/files.ts:888` 与 `:909` 仍是 `const basePath = cwd || process.cwd();`；`:914` 仍是旧的 `/(\/(?:Users|home|var|tmp|opt|etc)[^\s\n:,\]\})"'`]*)/g`；`:884`/`:905`/`:926` 的文档注释仍写着 "defaults to process.cwd()"。
  - 两个调用点在 `packages/server-core/src/sessions/SessionManager.ts:9380`（`formatToolInputPaths(event.input)`）与 `:9526`（`formatPathsToRelative(event.result)`），**都不传 cwd** → 落到 `process.cwd()`。全仓只有这两个调用点（`grep` 覆盖 `packages/**` + `apps/**`）。两者都在 `private async processEvent(managed, event)`（`:9238` 声明）内，`managed.workingDirectory` 已在作用域内且该文件已用 9 次（如 `:5099`、`:6517`、`:10370`）。
  - 触发条件与本仓一致：从 Finder/资源管理器启动时进程工作目录是 `/`（Windows 上是盘根），于是 `/Users/x` 被写成 `./Users/x`，根名被吞进更长路径时产生 `/Volumes./home/…`。
- **判定**：`采纳`（本仓 `files.ts` 的相对化区域与 v0.13.5 逐字节相同，可直接套用；`SessionManager.ts` 偏移约 1.5k 行，需手工定位）。
- **移植要点**：
  1. `files.ts`：`import { ... , sep } from 'path'`（本仓当前那行还带 `dirname`，别删）；插入 `normalizeRelativizeBase` 与 `ABSOLUTE_PATH_REGEX`；替换 `formatSinglePathToRelative`（`:887`）与 `formatPathsToRelative`（`:908`）函数体；`formatToolInputPaths`（`:929`）只更新注释。
  2. `SessionManager.ts:9380`、`:9526` 补第二参。
  3. 新增 `packages/shared/src/utils/__tests__/path-relativize.test.ts`（上游 135 行，逐字节可移植；本仓 `files.test.ts` 对这三个函数**零引用**，无冲突）。
- **验证**：`bun test packages/shared/src/utils/__tests__/path-relativize.test.ts`；`bun run test` 里的 `apps/electron/src/main/__tests__/session-message-parity.test.ts`、`session-event-message-parity.test.ts`、`session-persistence.test.ts`（它们直接构造事件、不走 `processEvent` 的格式化，预期保持绿）。
- **风险**：
  - 行为变化是**有意**的：`workingDirectory` 为 `undefined` 的会话（本仓 `'none'` 解析路径，`SessionManager.ts:3080-3085`）此后在 transcript 中**保留绝对路径**。这正是上游 release note 的意图（"paths outside it stay absolute"），但会让这类会话的 transcript 可读性下降——需知情。
  - Windows 的 `sep` 分支对本仓才是真正起作用的那一支（本仓开发/CI 都在 Windows）。
  - 本仓 `files.ts` 与 0.13.5 的差异只在 import 头与一处加固过的 `atomicWriteFileSync`（durability/fsync），相对化区域未被改动，所以三方合并干净。

### 3.2 #1067 header 凭证以 JSON 对象上线 —— 适配后采纳（已在临时脚本中复现）

- **上游改法**：把"凭证解析 + 请求头拼装"从三处重复实现抽成一个**纯叶子模块** `packages/session-tools-core/src/api-auth.ts`（约 223 行，零 I/O、零 workspace 依赖），并让两侧都走它：
  - 运行时侧：`packages/shared/src/sources/api-tools.ts` 的 `buildHeaders()` 退化为 `buildApiAuthHeaders()` 的薄包装，查询参数拼装退化为 `appendQueryAuth()`；`credential-manager.ts` 的 `getApiCredential()` 退化为 `parseStoredApiCredential()`。
  - 校验侧：`session-tools-core/src/handlers/source-test.ts` 的 `switch (authType)` 手工拼装整段删除，改用同一组函数，并在 400/401/403 上打印 API 的响应体摘录（`readResponseExcerpt`，≤200 字符）。
  - 模块放在 `session-tools-core` 而不是 `shared` 的原因写在模块头注释里：`shared` 依赖 `session-tools-core`，反向不成立，这是两侧都能到达的最低层。为此 `session-tools-core/package.json` 新增子路径导出 `"./api-auth"`。
  - 核心修复在 `parseStoredApiCredential()`：当源只配了单数 `headerName`、而存储值是恰好以该名字为唯一键的 JSON 对象时，返回**裸值**；键名不匹配则返回整个 map（按用户输入的键名发送）。
  - 第二道防线在 `buildApiAuthHeaders()`：即使传入的是 JSON 字符串，也会就地解包，不再把对象塞进单个请求头。
- **我们的现状**：**缺陷存在且已实测复现。**
  - `packages/shared/src/sources/credential-manager.ts:255` `const headerNames = source.config.api?.headerNames || source.config.mcp?.headerNames;` → 单 header 源为 `undefined`；`:261` `if (headerNames?.length)` 因此整段 JSON 解析被跳过，`:290` `return cred.value` 把原始 JSON 串返回。
  - `packages/shared/src/sources/api-tools.ts:126` `headers[auth.headerName || 'x-api-key'] = credential;` → 线上请求头值实测为 `"{\"x-goog-api-key\":\"AIza…\"}"`。
  - 触发路径在本仓是真实可达的：`packages/session-tools-core/src/handlers/credential-prompt.ts:48-49` → `getEffectiveHeaderNames()`（`source-helpers.ts:228-231`，**调用方传入的 `headerNames` 优先于源配置**）→ `packages/server-core/src/sessions/SessionManager.ts:2390-2393` 以 `JSON.stringify(response.headers)` 落盘。
  - `packages/session-tools-core/src/handlers/source-test.ts:520-584` 是第三份独立实现，`:550-551` 直接 `headers[source.api!.headerName] = token;`；401/403（`:619-622`）只报状态码，400（`:629-631`）落进裸 `else`——**不会展示 API 的错误体**，所以测试"看起来通过"。
  - 唯一好消息：`packages/shared/src/sources/api-tools.ts` 的 `executeApiRequest`（`:237-306`）与上游 0.13.6 形状一致，CLAUDE.md 的"单一 fetch 路径"约定未被破坏（`fetch(` 全文件仅 `:288` 一处）。
- **判定**：`适配后采纳`。这是本轮**最值得做、也最有独立价值**的一项：它是可复现的真实数据面故障，且顺带消除三份重复实现。
- **移植要点**（建议按此顺序提交）：
  1. 新增 `packages/session-tools-core/src/api-auth.ts`（除模块头注释外可原样复制；该文件不含品牌串、不含 `CRAFT_*`、不含 `~/.craft-agent`、不依赖 Claude）+ `packages/session-tools-core/package.json` 的 `"./api-auth": "./src/api-auth.ts"` 子路径导出。⚠️ 这将是本仓**第一处** `@phaneris/session-tools-core/<subpath>` 消费者（现有跨包引用都走相对路径），落地前需确认打包链（源码 Bun 运行 vs `apps/electron` 打包）确实遵循 `exports`；若不遵循，退化为相对导入。
  2. 新增 `packages/session-tools-core/src/api-auth.test.ts`（上游 42 条断言，逐字节可移植）——它是 C1–C3 最便宜的回归闸门，必须与模块同批落地。
  3. 改造 `credential-manager.ts`（`:74-101` 的类型/守卫改为从 `api-auth.ts` 再导出**并保持原名**，`:252-291` 改为 `parseStoredApiCredential` 委托）。⚠️ 再导出名 `ApiCredential` / `BasicAuthCredential` / `MultiHeaderCredential` / `isMultiHeaderCredential` 被 `sources/index.ts:69-78`、`server-core/src/handlers/rpc/pages.ts:90`、`server-core/src/sources/build-servers.ts:45,88` 及多个测试引用，不能改。
  4. 改造 `api-tools.ts`（删 `:37-42`、`:71-73`，`:90-143` 改委托，`:161-166` 改 `appendQueryAuth`）。**不要动** `executeApiRequest` / `createApiTool` / `createApiServer` / 现有 MCP-server 导入。
  5. 新增 `packages/shared/src/sources/__tests__/header-credential-shape.test.ts`（上游 5 条端到端断言）——这正是本仓缺失、导致缺陷长期存活的测试空档。
  6. 改造 `source-test.ts`（仅替换 `:520-584` 的拼装段 + 补 `readResponseExcerpt`），**必须保留本仓三处自有改动**：`:67-71` 的 `validateSlug` 穿越防护、`:748-757` 的 `pluginRoot` 转发、`:15-20` 的导入清单。
  7. 写侧收口：`packages/shared/src/sources/index.ts:69-78` 增加 `serializeHeaderCredential` 等导出，并把 `packages/server-core/src/sessions/SessionManager.ts:2393` 的 `JSON.stringify(response.headers)` 换成 `serializeHeaderCredential(response.headers ?? {}, request.headerName)`，让"单 header 源存裸值"成为默认。**读侧修复已足以治愈存量与新凭证**，写侧是卫生改进。
- **验证**：`bun test packages/session-tools-core/src/api-auth.test.ts`；`bun test packages/shared/src/sources/__tests__/header-credential-shape.test.ts`；`packages/session-tools-core/src/handlers/source-test.isolated.ts`（本仓自有 24 条，含 basic-auth 3 条——已核对 `buildApiAuthHeaders` 的 basic 分支能复现同样的 `Basic …` 语义，应保持绿）；`cd packages/shared && bun run tsc --noEmit`。
- **风险**：
  - `multi-header-auth.test.ts` 有 20+ 处直接调用 `buildHeaders` / `buildAuthorizationHeader`（`:97,110,121,139,165,183,201,214,226,235,249,260,275,294,311,317,329,345,361`）。已逐条核对，`buildApiAuthHeaders` 保留了 `authScheme: ''` → 裸 token、`header` + string → `headers[headerName]`、defaults 合并且 auth 优先等全部语义；**唯一刻意变化**是"给 `buildHeaders` 传 JSON 串"这一缺陷行为不再复现。本仓无任何测试钉住该缺陷行为。
  - `packages/shared/src/sources/__tests__/basic-auth.test.ts` 是解析逻辑的**独立副本**（`getApiCredential` 自实现，非 import），改造后它会变成"过期的镜像"，建议顺带删除或改为 import 真实实现。
  - C8（`config-validate.ts`）：上游那一行改的是 `CRAFT_CONFIG_DIR`，与本仓规则冲突 → `不需要`，详见 §3.7。

### 3.3 #1065 `allowedWritePaths` 在 Ask to Edit 模式生效 —— 适配后采纳

- **上游改法**：三处改动，其中两处属本项：
  1. `mode-manager.ts` 把 `matchesAllowedWritePath()` 从模块私有提升为 `export`（附文档注释指向 `pre-tool-use.ts:shouldPromptInAskMode`），使 Ask 模式复用与 Explore 模式**同一个**匹配器；上游 CLAUDE.md 为此补了一条不变量："两种模式都必须走这一个匹配器（OSS #1065）"。
  2. `mode-manager.ts` 的 `globToRegex()` 增加 win32 归一化（`\\` → `/` + `toLowerCase()`），与路径侧已有的 `normalizeForComparison()` 对齐。
  3. `pre-tool-use.ts` 的 `FILE_WRITE_TOOLS` 分支在白名单检查之后插入 10 行允许清单判断：命中则返回 `null`（不弹窗），未命中仍弹窗，`file_path` 缺失（`'unknown'`）仍弹窗。
- **我们的现状**：**两种模式命名 1:1 对应，缺陷存在。**
  - `packages/shared/src/agent/mode-types.ts:24` `'safe' | 'ask' | 'allow-all'`；`:39-43` 映射到规范名 `{ safe: 'explore', ask: 'ask', 'allow-all': 'execute' }`；`:305-340` 显示名 `safe`→"Explore"、`ask`→"Ask to Edit"、`allow-all`→"Execute"。上游 v0.13.6 的 `mode-types.ts` 未被本版修改，命名与之一致。
  - 目前**只有 `safe` 模式**遵守允许清单：`mode-manager.ts:1848-1855` 对 `ask` / `allow-all` 提前返回 `{allowed:true}`，使 `:1978-1984` 的允许清单分支在 ask 模式下永不可达。
  - `packages/shared/src/agent/core/pre-tool-use.ts:1027-1039` 的写文件分支**没有任何允许清单判断**（`permissionsConfigCache.getMergedConfig` 只在 Bash 分支 `:1053` 被查询）→ ask 模式下写允许清单内的路径仍会弹窗。
  - 这个组合在本仓尤其危险：`packages/shared/src/automations/validation.ts:65-72` 只对 `allow-all` 告警并**建议改用 `"ask"`**，而 `ask` + `allowedWritePaths` 恰恰是仍然弹窗、会让无人值守自动化卡死的组合。
  - `packages/shared/src/agent/mode-manager.ts:145-179` 与上游 v0.13.5 **逐字节相同**，两个 hunk 都能干净套用。
- **判定**：`适配后采纳`，工作量 S。
- **移植要点**：
  1. `mode-manager.ts:163` 改 `export function matchesAllowedWritePath(...)` 并带上上游文档注释；`:146-147` 换成 win32 归一化 4 行。
  2. `pre-tool-use.ts` 在 `../mode-manager.ts` 导入块（`:37-43`）加 `matchesAllowedWritePath`，在 `:1033` 与 `:1034` 之间插入 10 行守卫。**放在 `pre-tool-use.ts` 而不是 `source-policy.ts`**——后者是端点/MCP 工具策略，没有路径语义。
  3. 新增 `packages/shared/src/agent/__tests__/mode-manager-allowed-write-paths.test.ts`（上游 4 条断言），把 `~` 用例改成本仓根：`matchesAllowedWritePath(join(homedir(), '.phaneris', 'x.json'), ['~/.phaneris/**'])`。
  4. **强制配套**：`packages/shared/src/agent/core/__tests__/pre-tool-use-checks.isolated.ts` 的 mock 必须同步——`:29-39` 的 `../../mode-manager.ts` mock 要导出 `matchesAllowedWritePath`，`:44-50` 的 `getMergedConfig()` mock 要返回 `allowedWritePaths`，并在 `:168`、`:921` 两个 `beforeEach` 里重置。**只改源码不改 mock 会让该 `.isolated.ts` 整个进程以 `TypeError: undefined.length` 失败。**
  5. 文档：`apps/electron/resources/docs/permissions.md:136` 的 `allowedWritePaths` 说明改写为"在 Explore 与 Ask to Edit 均生效"；`packages/shared/CLAUDE.md` 追加同一不变量一句话。**不要**新建 `release-notes/0.13.6.md`，如需记用户可见变更则追加到 `apps/electron/resources/release-notes/next.md`。
- **验证**：`bun test packages/shared/src/agent/__tests__/mode-manager-allowed-write-paths.test.ts`；`bun test packages/shared/src/agent/core/__tests__/pre-tool-use-checks.isolated.ts`；`cd packages/shared && bun run tsc --noEmit`。建议再补一条 E2E：`permissionMode: 'ask'` 的自动化写 `allowedWritePaths` 内路径不弹窗。
- **风险**：
  - 行为面扩大：`allowedWritePaths` 从"Explore 专属旋钮"变成"交互模式也静默放行"。`matchesAllowedWritePath` 是**纯词法**匹配（`normalizeForComparison` → `resolve()` + 小写，`mode-manager.ts:187-190`），**不做 realpath 校验**（不同于 plans/data 例外走的 `isPathWithinDirectory`），因此允许目录内的符号链接可让写入落到目录之外。上游 v0.13.6 未处理这一点——建议**先按上游对齐**，把 realpath 加固作为本仓独立议题另开。
  - `mode-manager-path-boundary.test.ts` 与 `mode-manager-bash-hints.test.ts` 均不受影响（前者走 `isWithin`/`isPathWithinDirectory`，后者只测 Bash 提示；`globToRegex` 全仓只有一个调用点 `:169`）。
  - 上游同一提交里 `mode-manager.ts` 还有第三处 `includeDecide: true`，属决策层，本仓无此功能 → `不需要`（加进去连类型都过不了）。

### 3.4 #1058 / #1060 手动 `/compact` 期间发送的消息会丢失 —— 适配后采纳（**缺陷已定位到具体行，确认会丢**）

- **上游改法**：四块，必须一起落地。
  1. 新增 `packages/pi-agent-server/src/compaction-wait.ts`：把内联的等待抽成可注入的 `waitForCompaction(session, {timeoutMs, pollMs=200, sleep?, now?, log?})`，返回 `{waitedMs, timedOut}`（**不再返回 void**，调用方可以决定超时后怎么办），并给出两个预算常量：`MANUAL_COMPACT_WAIT_MS = 120_000`（手动 compact 前的等待，**低于**宿主 300 s 的 compact RPC 截止，给真正的压缩留出 60–120 s）与 `PROMPT_COMPACT_WAIT_MS = 300_000`（提示词前的等待，与宿主截止一致）。关键洞察：等待超时后**可以继续**，因为 SDK 的 `session.compact()` 会先中止当前操作（"Manual compaction never retries or continues the interrupted agent turn"），从而取消那个卡住的旧压缩。
  2. `packages/shared/src/agent/pi-agent.ts`：`compactTimeoutMs` 提为字段（默认 300_000）；超时处理不再只是删表 + reject，而是**递增 `compactionEpoch` 并向子进程发 `abort`**，错误文案为 `Compaction timed out after Xs and was cancelled`——这样卡死的压缩不再在子进程里继续跑，下一次 `/compact` 不必再等满一个 300 s。
  3. 新增"压缩是否占用当前回合"的契约：`AgentBackend.isCompactionInFlight?(): boolean`（可选，`base-agent.ts` 给一个返回 `false` 的具体默认实现），`PiAgent` 覆写为 `this.pendingCompactions.size > 0`，并在 `redirect()` 开头拒绝 steer 并返回 `false`（**不中止压缩**）。
  4. `SessionManager.ts`：新增 `shouldAttemptMidStreamSteer(behavior, textOnly, agent)`，`redirect()` 改由 `attemptedSteer` 把关，并把投递结果解析改成 `resolveMidStreamDeliveryOutcome(attemptedSteer ? 'steer' : 'queue', steered)`，让"因压缩而排队"**不被计为中断**。
- **我们的现状**：**缺陷存在，链路已逐行确认。** 我们的 `packages/pi-agent-server/src/index.ts:2098` 有内联的 `waitForCompaction(session, timeoutMs = 300_000): Promise<void>`，两处调用（`:2168` 提示词前、`:2409` 手动 compact 前）都用**同一个 300 s**默认值且拿不到返回值。宿主侧：
  1. `/compact` 就是一条普通消息（`FreeFormInput.tsx:754`），`SessionManager.sendMessage` 在 `SessionManager.ts:7182` 置 `isProcessing = true`，`PiAgent.chatImpl` 在 `pi-agent.ts:2357` 置 `_isProcessing = true`，然后才进入 compact 分支（`:2408-2411`）。
  2. 这个窗口里用户再发消息 → `SessionManager.ts:6996` 的中流分支，`behavior` 恒为 `'steer'`（本仓 `defaultMidStreamBehavior()` 只返回 `'steer'`，`llm-connections.ts:469-471`）。
  3. `:7007-7009` 无条件调 `agent.redirect(message)` → `pi-agent.ts:2870-2878`：`!_isProcessing` 为假，于是发 `{type:'steer'}` 并**返回 true**。
  4. `:7035` `resolveMidStreamDeliveryOutcome('steer', true)` → `{shouldQueue:false}` → 消息以 `status:'accepted'` 发出（`:7043`），**从不进入** `managed.messageQueue`（`:7052`），因此**没有重放**。
  5. 子进程 `index.ts:2718-2725` 照旧 `piSession.steer(...)`。而 SDK 的 steer 语义是"agent 正在运行时排队、在当前 assistant 回合的工具调用之后投递"，`compact()` 又"先中止当前 agent 操作"——**没有任何 agent loop 会消费这条 steer**；本仓自己的注释也记录了遗留在队列里的 steer 会被 `clearQueue()` 丢弃（`session-settings.ts:100-104`）。
  - 我们还缺 `isCompactionInFlight`（全仓 0 命中）、`canSteerTextPayload`/`acceptedSteers`/`takePendingSteers`（0 命中），`pendingCompactions` 是 `private`（`pi-agent.ts:391`）。
- **判定**：`适配后采纳`。四项**必须同一批次**落地。
- **移植要点**：
  1. 新增 `compaction-wait.ts` + 其测试（两文件内无品牌串，可原样）；删除 `index.ts:2098` 的内联实现，改从 `./compaction-wait.ts` 导入，把 `:2168` 换成 `PROMPT_COMPACT_WAIT_MS`、`:2409` 换成 `MANUAL_COMPACT_WAIT_MS`，并补上上游那几行日志。**保留**本仓在 `:2411` 附近的 `runWithDurableUtilityContext` 包装与额外 epoch 检查。
  2. `pi-agent.ts`：加 `compactTimeoutMs` 字段（`:391` 附近），替换 `:2209` 的硬编码 `const timeoutMs = 300_000;`，把 `:2212-2215` 的定时器改成"删表 → `compactionEpoch++` → `send({type:'abort'})` → reject"。
  3. `backend/types.ts`（`:447` 之后）加可选 `isCompactionInFlight?()`，`base-agent.ts`（`:1093` 附近）加返回 `false` 的具体默认（**具体而非抽象**，否则 `TestAgent extends BaseAgent` 与 `test-utils.ts:105` 会编译不过），`pi-agent.ts` 覆写 + `redirect()` 开头守卫。
  4. `SessionManager.ts`：加 `shouldAttemptMidStreamSteer(behavior, agent)`（**去掉上游的 `textOnly`**——本仓该分支没有 payload 判据），用 `attemptedSteer` 把关 `redirect`，并把 `:7035` 改成 `resolveMidStreamDeliveryOutcome(attemptedSteer ? 'steer' : 'queue', steered)`，日志里补 `compactionInFlight`。
- **⚠️ 最关键的一致性约束**：第 4 步的"解析入参改写"是**强制的**。若只做第 3 步（`redirect()` 在压缩期间返回 `false`）而不改第 4 步，`resolveMidStreamDeliveryOutcome('steer', false)` 会给出 `wasInterrupted: true`，于是重放回回合会注入那句"上一条回复被中断、可能不完整"的提示——正好违反 `packages/shared/CLAUDE.md` 记录的不变量 (1)，而该不变量由 `midstream-queue.test.ts:40-53` 钉住。**第 3 步单独上线会让中流行为变差。**
- **验证**：`bun test packages/pi-agent-server/src/compaction-wait.test.ts`；`packages/shared/src/agent/__tests__/pi-compaction.test.ts`（146 行；本仓目前没有测试调用 `.redirect(`，这会是第一个）；`packages/server-core/src/sessions/midstream-queue.test.ts`（移植上游用例时**删掉其 ClaudeAgent 段**——本仓没有那个类）。手工验证：跑一次 `/compact`，期间发一条消息，确认它被排队并在压缩结束后送达。
- **风险**：
  - 错误文案必须保留 "timed out … and was cancelled"：本仓 `pi-agent.ts:2568` 用 `error.message.includes('abort')` 分流，而该分支对 compact 回合只产出 `{type:'complete'}`——若改成 "…was aborted" 会被吞成一次"成功"的回合。另 `:2243` 的 durable 记账用 `includes('timed out')` 分类，保持不变即可。
  - 本仓事件词表**没有 `compaction_failed`**（0 命中），失败时产出的是 `typed_error|error` 再 `complete`（`pi-agent.ts:2583-2589`）——移植测试不能用上游那个位置数组断言。
  - 新测试要把 `agent.compactTimeoutMs = 20` 强转：`packages/shared/tsconfig.json` 的 `include` 覆盖 `src/**/*`，`typecheck:shared`（在 `typecheck:all`/`validate:ci`/pre-push 里）会类型检查测试文件。
- **附带发现（非 0.13.6 修复，建议顺手处理）**：本仓没有 `canSteerTextPayload`，所以**带附件的**中流发送会走 steer 路径，而只有文本被 steer、附件被静默丢弃且不入队。需先确认渲染层在 busy 时是否允许发送附件。

### 3.5 #1059 关闭弹窗后内置浏览器不可用 —— 适配后采纳（本仓已自研一半，仍有三处缺口）

- **上游改法**：
  1. `BrowserInstance` 增加 `pageWebContentsId: number`，在实例创建时抓取一次；此后所有查询/拆除都用这个副本，**不再读 `instance.pageView.webContents.id`**（对已销毁窗口读 `webContents` 会抛 "Object has been destroyed"）。删掉重复的 `getInstanceByWebContentsId`，三个调用点改用 `findInstanceByPageWebContentsId`。
  2. 新增 `popupWebContentsIdByWindow = new WeakMap<BrowserWindow, number>()`，在 `registerPopupWindow` 最开头写入；`unregisterPopupWindow` 从 WeakMap 查 id、查不到就**提前返回**、且只在 `reason !== 'reparented'` 时删除条目；`closePopupsForParent` 的日志行也改从 WeakMap 取。
  3. 抽出私有 `runCleanupStep(id, label, action)`，被 `destroyInstance` 与 `finalizeDestroyedInstance` **共用**；把 `cdp.detach()` 也纳入受保护步骤，保证 `instances.delete(id)` 与 `removedCallback` **一定会执行**（这正是"死实例留在表里、之后每个 `browser_tool` 都报 Object has been destroyed 直到重启"的成因）。
- **我们的现状**：**本仓已独立实现了第 3 步的一半，但第 1、2 步完全缺失。**
  - 已具备：`finalizeDestroyedInstance`（`browser-pane-manager.ts:2137-2161`）用 `steps: Array<[string, () => void]>` 循环保护了前三步，注释写着"a throwing cleanup must never abort finalization"——这是本仓早于上游的加固，并且已有测试 `browser-pane-manager.isolated.ts:688`（"still destroys instance when cleanup throws"）。因此上游那个**确切症状**（实例永不删除）在本仓已基本被挡住。
  - **缺口 1**：`:2157` 的 `instance.cdp.detach()` 在 steps 循环**之外**、无保护。目前侥幸无害（`browser-cdp.ts:144-155` 内部 try/catch 吞掉了 detach 异常），但一旦 `BrowserCDP.detach` 抛错就会跳过 `instances.delete`。
  - **缺口 2**：`:3111` `unregisterPopupWindow` 里的 `popupWindow.webContents.id`——它在弹窗自己的 `closed` 监听器（`:3105-3107`）里执行，此时窗口通常已销毁 → 抛错 → 该弹窗**永久留在** `popupParentByWebContentsId` / `popupWindowsByParentInstanceId` 里。`:3133` `closePopupsForParent` 里同样的一行会在 `unregisterPopupWindow`（`:3134`）与 `popupWindow.destroy()`（`:3137`）**之前**抛错 → 陈旧弹窗永远不会被清理或关闭（泄漏活着的弹窗窗口）。
  - **缺口 3**：`:637 findInstanceByPageWebContentsId`、`:3061 getInstanceByWebContentsId`、`:556`（`destroyInstance` 顶部、任何守卫之前、try/catch 之外）都在**实时读** `instance.pageView.webContents.id`。只要有一个死实例，`findInstanceByPageWebContentsId` 就会抛错，**毒化所有调用方**（`:614` 的空态启动，以及 `:3207`/`:3228`/`:3244` 的网络与下载观察者）；`:556` 抛错会让 `destroyInstance` 逃逸，从而**中断 `destroyAll()`（`:2131-2135`）的循环**。
  - 本仓无 `pageWebContentsId` 字段（`interface BrowserInstance` 在 `:151-155`），无弹窗 WeakMap（字段在 `:349-350`）。
- **判定**：`适配后采纳`（部分移植本身就有价值：弹窗泄漏与跨实例查询抛错都是真实缺陷）。
- **移植要点**：
  1. `BrowserInstance` 加 `pageWebContentsId`，在实例字面量（`:493` 附近，紧邻 `lastLaunchToken`）赋值；替换 `:556`、`:637`、`:1583` 的读取；删除 `getInstanceByWebContentsId`（`:3059-3062`），把 `:3207`/`:3228`/`:3244` 改指向 `findInstanceByPageWebContentsId`。
  2. 在 `:349-350` 旁加 `popupWebContentsIdByWindow`；`registerPopupWindow`（`:3066`）开头写入；`unregisterPopupWindow`（`:3110`）改为 WeakMap 查询 + 未知即返回 + 非 `reparented` 才删；`closePopupsForParent`（`:3133`）从 WeakMap 取。
  3. 保护 `cdp.detach`：最小改法是把 `['cdp.detach', () => instance.cdp.detach()]` 追加进现有 `steps` 数组；上游的 `runCleanupStep` 统一方案更干净但改动更大。
  4. **测试写进 `apps/electron/src/main/__tests__/browser-pane-manager.isolated.ts`，不要新建上游那个 `browser-pane-manager.test.ts` 文件名**——那个名字会在 `apps/electron` 的共享 bun 进程里跑，破坏 `mock.module('electron')` 所需的隔离（`.isolated.ts` 后缀就是为此存在）。
- **验证**：`bun test apps/electron/src/main/__tests__/browser-pane-manager.isolated.ts`（1367 行既有测试必须保持绿）。
- **风险**：
  - 本仓的 `createMockWebContents()`（`browser-pane-manager.isolated.ts:15-75`）**没有 `id` 属性**，移植后 `pageWebContentsId` 在每个既有测试里都会是 `undefined`——必须补上上游那个计数器（`let nextMockWebContentsId = 1; id: nextMockWebContentsId++`）。这个改动是安全的，因为既有断言只通过管理器自身的 map 比较 id。
  - 本仓窗口 mock 的 `webContents` 是普通属性、`isDestroyed: mock(() => false)`（`:94-111`），所以上游测试的 `markDestroyed()`（把 `isDestroyed` 换成返回 true、并用 `Object.defineProperty` 让 `webContents` getter 抛错）可以照用。
  - 上游的 `emitDidCreateWindow` 辅助不需要：本仓 `createMockWindow._emit`（`:108-110`）不前置事件，且既有弹窗测试已直接调用监听器（`:310-311`）。
  - 上游测试没有引用 `loadError`、`refreshThemeVisuals`、`getResolvedAccentColor(instance)`，而本仓这三处已重写——所以 5 条新测试可以照搬。
  - 本文件与 0.13.5 差异 34 增 / 109 删（deeplink/主题/loadError/权限集重写），必须手工套用。

### 3.6 #1048 编辑已保存连接时测试连接失败 —— 适配后采纳（同一缺陷已在端到端链路确认）

- **上游改法**：`TestLlmConnectionParams` 增加 `connectionSlug?`；`connection-setup-logic.ts` 新增 `API_KEY_MASK` / `maskApiKey` / `isMaskedApiKey` / `resolveSetupTestApiKey`；`TEST_LLM_CONNECTION_SETUP` 在测试前按 slug 把掩码解析回已存储的密钥；`GET_API_KEY` 改用 `maskApiKey`；渲染层传 `connectionSlug`。要点是"密钥字段可能仍持有掩码占位符，由服务端按 slug 解析出真实凭证"。
- **我们的现状**：**同一缺陷，链路逐环确认。**
  - `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx:828` `handleEditConnection` 调 `getLlmConnectionApiKey(slug)`，掩码进入 `editInitialValues.apiKey`（`:845-846`）→ **掩码落进表单输入框**。
  - `packages/server-core/src/handlers/rpc/llm-connections.ts:504-513`（`GET_API_KEY`）内联拼掩码（`key.slice(0,7) + '••••••••' + key.slice(-4)`）。
  - `packages/shared/src/protocol/dto.ts:709-717` 的 `TestLlmConnectionParams` **没有 `connectionSlug`**。
  - `apps/electron/src/renderer/hooks/useOnboarding.ts:487-494` 只发 `apiKey: data.apiKey`，**不发 `connectionSlug`**。
  - `llm-connections.ts:389-396` 解构里没有 `connectionSlug`，把 `trimmedKey` 直接交给 `testBackendConnection`（`:410-419`）⇒ **把一串圆点当密钥去测**，必然鉴权失败。
  - `connection-setup-logic.ts` 没有掩码辅助函数（导出仅 `:26/57/77/94/109/162/205/291/309/359`）。
  - **保存**路径早已有防护（`llm-connections.ts:244`、`:328` 用 `setup.credential?.includes('••')`），按 slug 的卡片测试 `llmConnections.TEST`（`:591`）读的是已存储凭证——**所以只有"设置页编辑后测试"这一条链是坏的**。
- **判定**：`适配后采纳`，工作量 S–M。
- **移植要点**：
  1. `packages/shared/src/protocol/dto.ts:709` 加 `connectionSlug?: string`。
  2. `packages/server-core/src/domain/connection-setup-logic.ts` 在 `:94` 之后加四个辅助（本仓 `domain/index.ts:6` 是 `export *`，barrel 无需改）。
  3. `llm-connections.ts`：`:8` 导入、`:244`/`:328` 改用 `maskApiKey`、`:389-396` 解构加 `connectionSlug`、`:508-512` 改用 `maskApiKey`，并**删掉 `:394` 那个旧的 `!trimmedKey` 提前返回**（新辅助负责这个判断）。
  4. `useOnboarding.ts:487` 加 `connectionSlug: editingSlug ?? undefined`。
     - **⚠️ 勘误（实施时发现，2026-09-28）**：本节早先的版本要求写成 `connectionSlugOverride ?? editingSlug`，那是**错的**。该 `testLlmConnectionSetup` 调用并不在 `handleSaveConfig` 里，而在 `handleSubmitCredential`（`useOnboarding.ts:412-533`）里；`connectionSlugOverride` 只是 `handleSaveConfig`（`:286`）与 `handleStartOAuth`（`:573`）的形参，在 `:487` 处**不在作用域内**，照抄会直接 TS "Cannot find name" 编译失败。`handleSubmitCredential` 编辑的正是 `editingSlug` 本身（`:441` 用它判断"编辑中"），且 `AiSettingsPage:733` / `:856` 在进入 credentials 步之前就把它设好，所以上游的裸 `editingSlug ?? undefined` 就是正确形态。实施时已按此落地并加注释。
  5. `AiSettingsPage.tsx` **不需要改**（上游本版对它 0 行改动；那 309 行是决策层的卡片，见 §3.13）。
  6. 两份测试都要镜像：`packages/server-core/src/domain/connection-setup-logic.test.ts` 与 `apps/electron/src/main/__tests__/connection-setup-logic.test.ts`（本仓两份都存在）。
- **验证**：`bun test packages/server-core/src/domain/connection-setup-logic.test.ts`；`bun test apps/electron/src/main/__tests__/connection-setup-logic.test.ts`；渲染层 `apps/electron/src/renderer/hooks/__tests__/useOnboarding.test.ts`。
- **风险**：低。`connectionSlug` 是可选字段，不影响按 slug 的既有测试路径。注意别把这条修复与 §3.13 的决策层改动混在同一提交里——上游把两者放在同一个文件（`AiSettingsPage.tsx` / `llm-connections.ts` / `credentials/*`）里，容易误取。

### 3.7 #1062 `CRAFT_CONFIG_DIR` 未覆盖全部路径 —— 已等价（本仓 21/22 已合规，真正缺口只有"缺契约测试"）

- **上游改法**：把 20 余处仍以 `homedir() + '.craft-agent'` 硬拼的路径全部改为从 `CONFIG_DIR` 派生；并把 `paths.ts` 的解析逻辑提成**纯函数** `resolveConfigDir(env, home)`，新增 `DEFAULT_CONFIG_DIR_NAME`，再补一个只测契约的 `config/__tests__/paths.test.ts`。另外为 `CRAFT_CONFIG_DIR` 实例补了两个一次性迁移（凭证、workspace 目录）。
- **我们的现状**：**这一项本仓其实已经做完了，而且部分位置比上游更严。** 逐点核对（22 处非测试 offender）：

  | 位置 | 本仓状态 |
  |---|---|
  | `packages/shared/src/config/paths.ts` | 已有 `resolveConfigDir()` + `CONFIG_DIR_ENV_VAR`；根默认 `~/.phaneris`，且**刻意不读 `CRAFT_CONFIG_DIR`**（文件头注释记录了理由） |
  | `apps/electron/src/main/logger.ts:84,213,284` | 三个日志路径（含本仓多出的 lifecycle log）均 `join(LOGS_DIR, …)` |
  | `apps/electron/src/main/window-state.ts:3,33` | `join(CONFIG_DIR, 'window-state.json')` |
  | `apps/electron/src/main/index.ts:923` | `join(workspaceDir(wsId), 'messaging')`（用命名 helper，优于上游） |
  | `packages/server/src/index.ts:32,224-225` | `join(workspaceDir(wsId), 'messaging')` |
  | `packages/server-core/src/services/privileged-execution-broker.ts:4,25` | `join(LOGS_DIR, 'privileged-actions.jsonl')` |
  | `packages/server-core/src/handlers/rpc/workspace.ts:68` | `WORKSPACES_DIR` |
  | `packages/server-core/src/handlers/rpc/auth.ts:3,91` | `CONFIG_FILE` |
  | `packages/shared/src/interceptor-common.ts:34-37,54,65,69,203` | 本地 `resolveConfigDir()` **按调用解析**，能在 import 之后再改环境变量——**强于上游的模块常量** |
  | `packages/shared/src/credentials/backends/secure-storage.ts:47,148` | `CREDENTIALS_FILE` 来自 paths，且构造器可注入（更可测） |
  | `packages/shared/src/workspaces/storage.ts:20,36` | `WORKSPACES_DIR` |
  | `packages/shared/src/agent/permissions-config.ts:49` | `join(resolveConfigDir(), 'permissions')` |
  | `packages/shared/src/agent/core/prerequisite-manager.ts:53` | `resolve(join(DOCS_DIR, 'browser-tools.md'))` |
  | `packages/shared/src/docs/index.ts:11`、`release-notes/index.ts:12`、`utils/logo.ts:11,15`、`pages/action-bridge.ts:164`、`plugins/audit.ts:19`、`messaging-gateway/.../state-dir.ts:30` | 均从 `CONFIG_DIR`/`LOGS_DIR`/`DOCS_DIR` 派生 |
  | `packages/session-tools-core/src/handlers/config-validate.ts:41` | `ctx.appConfigDir ?? (PHANERIS_CONFIG_DIR \|\| ~/.phaneris)`，且宿主总是注入 `ctx.appConfigDir = CONFIG_DIR`（`packages/shared/src/agent/session-context.ts:252`） |

- **两个必须 `不需要` 的上游改动**（照抄会坏事）：
  1. **`migrateCredentialsIfNeeded()`（`secure-storage.ts`）** —— 上游从 `~/.craft-agent/credentials.enc` 复制。本仓**刻意排除**该文件：`scripts/migrate-legacy-profile.ts:182` 明确不迁移 `credentials.key` / `credentials.enc`，因为密钥是受 OS 应用绑定加密保护的（Windows `v10`），复制过去新应用**永远无法解包、也无法再生成**。照抄会毁掉凭证库。workspace 目录的同名 helper 同理（本仓由 `migrate-legacy-profile.ts` 显式迁移，且会重写存量路径的两种分隔符形态）。
  2. **`config-validate.ts` 的 `CRAFT_CONFIG_DIR` 那一行** —— 会同时撞 `identity:check` 的 `/\bCRAFT_[A-Z0-9_]+/g` 与"不受理上游环境变量"的规则，且会与本仓的 `ctx.appConfigDir` 注入打架。详见 §3.2 C8。
  - 另注：上游 `config/storage.ts` 在本版有 34 行改动，但**与路径无关**（是决策层的设置 API），不要误当作 #1062 的一部分而整段移植。
- **判定**：`已等价`。合并动作只剩两件小事：
  1. **补契约测试**（S）：新增 `packages/shared/src/config/__tests__/paths.test.ts`。⚠️ 不能逐字节照搬：本仓 `resolveConfigDir()` 不接参数、直读 `process.env`，且带 `noticeLegacyRoot()` 的一次性 `console.warn` 副作用。建议先做约 10 行的纯度重构——`resolveConfigDir(env = process.env, home = homedir())`，把告警搬到 `CONFIG_DIR` 求值处单独调用——再写上游那三条用例（空串/纯空白回落；override 去空格；`CONFIG_DIR === resolveConfigDir(process.env, homedir())`）。最后一条是真正能防"又有人硬拼根目录"的断言。
  2. **`packages/shared/src/config/index.ts` 补 `paths.ts` 再导出**（1 行，可选；`CONFIG_DIR` 目前已通过 `storage.ts:29` 可达）。本仓没有 `DEFAULT_CONFIG_DIR_NAME`，对应物是 `DATA_DIR_NAME`。
- **顺带发现（建议同批清理）**：
  - `packages/shared/src/agent/core/__tests__/prerequisite-manager.isolated.ts:29-31` 仍用 `homedir() + '.phaneris'` 硬拼，不读环境变量——设了 `PHANERIS_CONFIG_DIR` 的测试环境下会与实际根不一致（测试自身的潜在假绿）。
  - **`apps/electron/resources/docs/browser-tools.md:220` 是唯一"用户可见"的陈旧路径**：它让 agent 去读 `~/.craft-agent/docs/browser-tools.md`，在 `PHANERIS_CONFIG_DIR` 实例里该字面路径是错的 → 建议在本轮修掉。
  - 全仓约 25 个文件的注释/文档字符串仍写着 `~/.craft-agent`（`config/storage.ts:181,269,1358,1375,1419,3240`、`config/watcher.ts:8-10,152,1121,1170`、`config/validators.ts:1692,2157,2161`、`agent/mode-types.ts:260,264`、`pages/action-bridge.ts:27`、`messaging-gateway/registry.ts:910` 等）。纯注释，但已与事实不符，值得一次 sweep。
  - Electron 的 `userData` **不随** `PHANERIS_CONFIG_DIR`（`apps/electron/src/main/index.ts:247-256` 钉在 `USER_DATA_DIR_NAME`）——这是**与上游一致**的现状（PR #1061 也没动 userData），不属于本次缺口；若要做真正的多实例隔离（Chromium profile + 单实例锁 `:375`），那是新需求、需与 `PHANERIS_APP_NAME` 一起设计，不放在本轮。

### 3.8 #1033 拦截器调试日志无界增长 —— 适配后采纳（两个半边都缺）

- **上游改法**（`packages/shared/src/interceptor-common.ts` 175 行 + `unified-network-interceptor.ts` 23 行）：
  - 常量：`MAX_LOG_FILE_BYTES = 32 MiB`、`MAX_LOG_AGE_MS = 24 h`、`MAX_LOG_ENTRY_CHARS = 4 MiB`、`MAX_LOGGED_BODY_CHARS = 2 MiB`、`DEBUG_FULL_BODIES = process.env.CRAFT_DEBUG_FULL_BODIES === '1'`。
  - 轮转：`rotateLogFile(p)`（先 `unlinkSync(p + '.prev')`，因为 Windows 上 `renameSync` 不肯覆盖已存在目标）→ `renameSync(p, p.prev)`；`rotateLogIfNeeded(p)` 用"间隔或累计字符数"节流（`checkIntervalMs: 1000`、`checkChars: 1 MiB`），然后 `statSync` 判断 `size >= maxBytes || now - mtimeMs > maxAgeMs`；`initLogFile(p)` 在建目录后，若文件已 ≥ 上限则**直接截断**，否则按年龄轮转。
  - 单条上限：`appendLogEntry(msg)` 先把条目裁到 `MAX_LOG_ENTRY_CHARS` 并追加 `... [ENTRY TRUNCATED at N chars]`，**再**盖 ISO 时间戳。
  - 请求体：`toCurl(url, init, fullBodies = DEBUG_FULL_BODIES)` 改为**导出**并接受开关；默认路径输出 `-d '[REQUEST BODY OMITTED: <n> chars]'`，仅在显式开启时才写正文（且裁到 `MAX_LOGGED_BODY_CHARS`，附 `... [BODY TRUNCATED: <n> chars total]`）。响应体本来就有 5000 字符上限，未改。
  - 并提供 `_setLogFileForTesting` / `_setLogLimitsForTesting` / `_resetLogStateForTesting` 三个测试钩子。
- **我们的现状**：**两个半边都缺。**
  - **无大小上限**：`packages/shared/src/interceptor-common.ts:72-102` 的 `ensureLogFile()` 只在**首次写入**时检查一次 `mtimeMs > MAX_LOG_AGE_MS`（24 h）并按年龄轮转，`DEBUG` 打开后长时间连续写入的开发会话**永远不会轮转**——正是 #1033 的"grew without limit"。
  - **单条无上限**：`:104-124` 的 `debugLog()` 直接 `appendFileSync(getLogFile(), message + '\n')`，没有条目裁剪。
  - **请求体全量落盘**：`packages/shared/src/unified-network-interceptor.ts:1947-1962` 的 `toCurl()`（未导出）在 `:1955-1958` 把 `init.body` 内联进 `-d '…'`，调用点 `:2161 debugLog(toCurl(url, init))` 在 `if (DEBUG)`（`:2158`）下执行——用户提示词、工具参数、base64 图片都会被完整写进日志。
  - 已经正确的部分：日志路径已经是 `<config>/logs/interceptor.log`，由 `:34-37` 的本地 `resolveConfigDir()` 读 `${ENV_PREFIX}CONFIG_DIR`（即 `PHANERIS_CONFIG_DIR`），`:44-47` 的 `IS_PACKAGED`/`INTERCEPTOR_LOGGING_ENABLED` 保证打包版根本不写这个日志。**这也是本仓与上游共同的选择**：`:21-33` 的注释说明了本模块是 Bun `--preload`，**不能 import `config/paths.ts`**（否则会在 preload 期钉死根目录，破坏 `*.isolated.ts` 模式）。上游 0.13.6 出于同样理由做了同样的事。
- **判定**：`适配后采纳`，工作量 M。
- **移植要点**：
  1. `interceptor-common.ts`：加入四个常量 + `DEBUG_FULL_BODIES`（**环境变量名必须是 `PHANERIS_DEBUG_FULL_BODIES`**，或用 `` `${ENV_PREFIX}DEBUG_FULL_BODIES` `` 模板形式与 `:35` 一致——`identity:check` 的 `/\bCRAFT_[A-Z0-9_]+/g` 会拦下上游原名）、`_limits`/轮转状态、`rotateLogFile`、`rotateLogIfNeeded`、`initLogFile`、`formatLogEntry`、`appendLogEntry` 与三个测试钩子，重写 `debugLog`。
  2. **保留本仓的惰性 `getLogDir()`/`getLogFile()`/`resolveConfigDir()` 结构**，不要把上游的 import 期 `const CONFIG_DIR`/`LOG_FILE` 与 `if (DEBUG) initLogFile(LOG_FILE)` 照搬进来；把新的"截断/轮转"准备动作放进现有 `ensureLogFile()`（`:83-102`）里，同时把 `initLogFile(path)` 导出供测试使用。
  3. `unified-network-interceptor.ts`：导出 `toCurl(url, init, fullBodies = DEBUG_FULL_BODIES)` 并实现"省略/截断"两分支，从 `./interceptor-common.ts`（`:21-31` 的导入块）引入 `MAX_LOGGED_BODY_CHARS` / `DEBUG_FULL_BODIES`。
  4. 追加两个上游测试（91 + 63 行），并把 curl 测试里的 `CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL` 换成 `PHANERIS_INTERCEPTOR_DISABLE_AUTO_INSTALL`（本仓实际变量，`unified-network-interceptor.ts:2281`）。
- **验证**：两个新测试都是 `.test.ts`（无 `mock.module`，不需要 `.isolated.ts` 后缀），由 `bun run test` 按工作区发现。⚠️ **`validate:ci` 不会跑它们**（它只跑 `test:shared:all` 的三个窄脚本），只有 `validate:full` / CI 的 full-validation job 会。另需回归 `packages/shared/src/__tests__/interceptor-common.test.ts`（本仓 77 行，上游新增内容叠加上去）、`unified-network-interceptor.*.test.ts`、`interceptor-packaging-contract.test.ts`。
- **风险**：
  - `packages/shared/src/__tests__/interceptor-packaging-contract.test.ts` 钉住"每个打包清单都列出了拦截器源文件"——本项**不新增文件**，所以 electron-builder / ps1 / dmg / linux 四份清单都不用动（若新增模块就必须四份同步）。
  - 模块级状态与 preload 实例共享：在 `afterEach` 里调 `_resetLogStateForTesting()`，与上游一致。
  - 本仓该文件与 0.13.5 差异约 222 行，不要 `git apply` 补丁。

### 3.9 #1054 MCP OAuth 资源指示器（RFC 8707 + RFC 9728） —— 适配后采纳

- **上游改法**（集中于 `packages/shared/src/auth/oauth.ts`，另四处顺带）：
  1. RFC 9728 发现结果不再把 `resource` 丢掉。`ProtectedResourceMetadata.resource` 本来就被校验为必填（本仓 `oauth.ts:754-755` 已有），但上游把它**带出来**：`fetchProtectedResourceMetadata()` 返回类型由 `Promise<string | null>` 改为 `Promise<{ authorizationServer, resource } | null>`，`discoverViaProtectedResource()` 返回 `{ ...metadata, resource }`，公开类型 `OAuthMetadata` 新增 `resource?: string`（注释明确"只有走 PRM 发现时才有值，纯 RFC 8414 发现时没有"）。
  2. `prepareMcpOAuth()` 把 `resource` 写到授权 URL 查询参数并回传，`exchangeMcpOAuth()` → `exchangeMcpCodeForTokens(..., resource?)` 把它写进 token 请求体。
  3. `CraftOAuth.authenticate()` / `exchangeCodeForTokens()` / `refreshAccessToken()` 同样带上；**刻意不做派生兜底**（不拿 MCP URL 反推），因为 Azure v1 之类会对未预期的 `resource` 直接 `invalid_request`，而授权步骤没有重试机会。
  4. 新增 `postTokenRequest()`：当响应非 2xx、请求带 `resource`、且响应体 `error === 'invalid_target'` 时，**去掉 `resource` 重试一次**（`response.clone().json()` 读取，不消耗原响应体）。这是让"PRM 声明了就总是发送"变安全的关键兜底。
  5. RFC 9728 well-known 发现增加多候选回落：`buildProtectedResourceMetadataUrls()` 依次给出 `${origin}/.well-known/oauth-protected-resource${pathname}` 与 `${origin}/.well-known/oauth-protected-resource`，配合 401 头里的 hint 组成有序候选逐个尝试，失败 `continue` 而非直接 `return null`；401 前置门槛保留（非 401 服务器不会多发请求）。
  6. 手工配置的 API 源新增 `oauth.resource`：`ApiOAuthConfig.resource?: string`，贯穿 `prepareGenericOAuth()` / `exchangeGenericOAuth()` / `refreshGenericOAuthToken(..., clientSecret?, resource?)`，并由 `credential-manager.refreshGeneric` 传第 5 个参数。
- **我们的现状**：**缺陷存在**，但文件偏离极小——`oauth.ts` 相对 v0.13.5 只有 3 行品牌差异（`DEFAULT_PUBLIC_CLIENT_ID`、`CLIENT_NAME = PRODUCT_NAME`、两处 clientId 兜底），因此上游 diff **几乎可原样套用**。
  - `oauth.ts:656-660` 的 `OAuthMetadata` 无 `resource`；`:813-816` `fetchProtectedResourceMetadata(...): Promise<string | null>`；`:846` `const authServer = data.authorization_servers[0]!`；`:856` `return authServer` —— 值被解析后丢弃。
  - `oauth.ts:560-613` `prepareMcpOAuth` 从不碰 `resource`；`:510-516` `exchangeMcpCodeForTokens` 无 `resource` 参数；`:110-116`/`:127-131`/`:171-175`/`:283-292` 三处 token POST 都是裸 `fetch` + `if (!response.ok) throw`。
  - `oauth.ts:918-924` 在 401 无 `resource_metadata` hint 时直接放弃；`:926-944` 单候选、每个失败都硬 `return null`。
  - 文件流侧：`oauth-flow-types.ts:17-26` / `:32-39`、`oauth-flow-store.ts:15-24`、`server-core/src/handlers/rpc/oauth.ts:49-56` / `:110-125` 均无 `resource`。
  - `sources/types.ts:333-348` 的 `ApiOAuthConfig` 有 `audience`（`:345`）无 `resource`；`generic-oauth.ts:65-67`/`:75-84`/`:97-106`/`:156-161` 同缺口；调用方 `credential-manager.ts:1191-1196` 是 4 参调用。
  - **其中 5 个文件与 v0.13.5 逐字节相同**（`generic-oauth.ts`、`oauth-flow-store.ts`、`oauth-flow-types.ts`、`sources/index.ts`），可直接覆盖。
- **判定**：`适配后采纳`（`TAKE-VERBATIM` 的只有 `postTokenRequest` 那一块）。整体 S–M。
- **移植要点**：
  1. 一批做完 `oauth.ts`：A（发现结果带 `resource`）+ B（flow store / RPC 透传）+ C（`CraftOAuth` 交互与 refresh）+ D（`invalid_target` 重试）+ F（well-known 多候选）。保留本仓的 clientId / `CLIENT_NAME` 行。
  2. `sources/types.ts` + `generic-oauth.ts` ×3 + `credential-manager.ts:1196` 第 5 参，一起提交（字段与消费方必须同批，否则是空改动）。
  3. 建议同时带上用户可见文档：`apps/electron/resources/docs/sources.md` 补 `resource` 字段说明与 RFC 8707 提示（该文件会同步进 `~/.phaneris/docs` 并被 agent 读取，是真实产品面）。
  4. `canonicalResourceIdentifier()` **不要**（上游 v0.13.6 在生产代码里从未调用，只有自己的单测引用它——设计者最终选了"不做派生兜底"）。
- **验证**：
  - `packages/shared/src/auth/__tests__/oauth.isolated.ts` 是上游 `oauth.test.ts` 在本仓的改名版（仅 4 行品牌差异）。**⚠️ 上游对它有 10 行删除：恰好 9 个 `expect(result).toEqual(authServerMetadata)` 要改成 `{ ...authServerMetadata, resource: '<该用例的 PRM resource>' }`。** 本仓这 9 处一模一样（行 100、217、259、406、440、728、783、1037、1070），**不改就红**。
  - `oauth.isolated.ts:125-150`（"无 hint 时回落到 RFC 8414"）在新增两个候选后仍应通过——已核对其 mock 对两个新候选返回 404；`:571-695` 的 11 条 SSRF 用例只让 `https://example.com/.well-known/oauth-authorization-server` 成功，其余 404，不会误命中回落候选。
  - ⚠️ 注意：`validate:ci` 只跑三个窄口径 `test:shared:*` 脚本，**抓不到**这 9 处断言失败；要靠 `bun run test`（pre-push 会跑）。
- **风险**：
  - `refreshAccessToken()` 会重新做一次完整发现，因此 refresh 现在依赖 PRM 每次重新声明 `resource`——这是上游刻意的非对称设计（授权/换 token 只要 PRM 声明过就带，refresh 只在 PRM 再次声明时才带），照抄即可，但要知道它改变了 refresh 的请求面。
  - 新增的 well-known 回落会在"401 且无 hint"的服务器上多发 2 个 GET。本仓无任何测试断言请求 URL 序列，所以不会红，但需知情。

### 3.10 #1068 Slack 桌面登录 —— 适配后采纳，但**上游常量必须替换**

- **上游改法**：v0.13.5 时 `OAUTH_RELAY_CALLBACK_URL` 是硬编码的 `https://thecraftagents.com/auth/callback`，于是桌面流程也被包上通用 relay 信封，Slack 拿到的是它**没注册过**的 redirect_uri，在授权前就被拒。v0.13.6 新增 `SLACK_LEGACY_RELAY_CALLBACK_URL = 'https://thecraftagents.com/auth/slack/callback'`、`slackLegacyRelayRedirectUri(port)`，以及判定函数 `slackLegacyRelayPortForReturnTo(returnTo)`（只接受 `http:` + 环回主机 + `/callback` + 显式端口 ∈ [1024, 65535]）；`credential-manager.prepareOAuth` 的 slack 分支据此**提前返回** `prepareSlackOAuth({ ..., callbackPort })`，不走通用 `state` 信封（该 relay 路由原样转发 Slack 的 `state`）。
- **我们的现状**：**不能照抄上游常量，而且本仓是另一种缺陷。**
  - 本仓 `packages/shared/src/identity.generated.ts:66-73` 的 `SERVICE_URLS` 全为 `null`，其头部规则（`:61-65`）写明"`null` 表示服务未就绪：对应产品面必须显式不可用，**永不回退上游端点**"；`phaneris.identity.json:40` `"oauthRelayUrl": null`。
  - `packages/shared/src/auth/oauth-relay.ts:4-13`：`OAUTH_RELAY_CALLBACK_URL` 在无 relay 时为 `null`；`getSlackRelayCallbackUrl(port)` 在无 relay 时**直接抛错**（"Slack desktop OAuth requires a Phaneris HTTPS relay…"）。注意本仓**已经**实现了上游 `slackLegacyRelayRedirectUri` 的"自有 relay"形态：`<relay>/auth/slack/callback?port=N`。
  - `packages/shared/CLAUDE.md:45` 明确"**永不回退上游托管 relay**；未配置 relay 时向各 provider 注册直连回调 URL"。
  - **缺陷一（等价于上游 #1068）**：一旦配置了自有 relay，`credential-manager.ts:419-425`/`:529-531` 会把**通用** relay URL 交给 Slack（`:474`），Slack 同样拒绝 → 本仓在"已配 relay"的安装上正好复现上游 #1068。
  - **缺陷二（本仓特有）**：无 relay 时，electron 传 `callbackUrl = http://localhost:<6477..6576>/callback`（`apps/electron/src/preload/bootstrap.ts:322-331` + `packages/shared/src/auth/callback-server.ts:177`，端口是 100 个端口的扫描结果），而同一函数里的注释自陈"Slack requires HTTPS"。即交给 Slack 的是一个 `http:` 环回地址，且端口不固定——**静默失败，没有可操作的报错**。
- **判定**：`适配后采纳`，其中上游那个 `/auth/slack/callback` 常量 `不需要`（撞 `identity:check` 的 `/craftagents/gi`，也违反产品约定）；环回判定谓词与"提前返回"结构值得采纳；无 relay 情形需要本仓自己的补救。工作量 M。
- **移植要点**：
  1. `packages/shared/src/auth/slack-oauth.ts`：**不要**引入 `SLACK_LEGACY_RELAY_CALLBACK_URL`。可选地把上游谓词改名（如 `loopbackCallbackPort(returnTo)`）后引入，保留其全部接受规则。
  2. `packages/shared/src/sources/credential-manager.ts` 的 slack 分支（`:461-476`）：当 `relayReturnTo !== undefined` **且** `loopbackCallbackPort(relayReturnTo) !== undefined` 时，在 `:529-531` 包装**之前**提前 `return prepareSlackOAuth({ service, userScopes, callbackPort: port })`，使自有 relay 安装不再套通用 `state` 信封。这一步就修掉了本仓的"缺陷一"。
  3. 无 relay 时的补救（二选一，需产品决定）：
     - **推荐：fail closed**。在 slack 分支里，无自有 relay 且目标是 `http:` 环回回调时，直接抛出可操作的错误，同时给出两条出路（在 `phaneris.identity.json` 配 `services.oauthRelayUrl` 并在 Slack 应用注册 `<relay>/auth/slack/callback`；或在 Slack 应用注册确切的桌面回调 URL 并**固定**回调端口）。这与 `getSlackRelayCallbackUrl()` 既有的 fail-closed 纪律和 `SERVICE_URLS` 的"显式不可用"规则一致。
     - 备选：给运维一个"固定回调 URL/端口"的配置项（`createCallbackServer({ port })` 已有钉端口能力），把"向 provider 注册直连回调"变成真的可用。
  4. `apps/electron/src/main/index.ts`（上游本版 3 行）与本项无关，是 #1062 的 `getMessagingDir` → `workspaceDir()`，本仓已等价。
- **验证**：新增 `packages/shared/src/sources/__tests__/slack-oauth-relay.isolated.ts`（上游同名文件在 `sources/__tests__/` 而非 `auth/__tests__/`），但断言要换成本仓契约：自有 relay 下 `redirectUri` 为 `<relay>/auth/slack/callback?port=N` 且 `isOAuthRelayState(result.state) === false`、WebUI HTTPS 目标仍带信封、`redirectUri` **绝不包含** `thecraftagents.com`。⚠️ `oauth-relay.ts:4` 在**模块加载时**读取 `SERVICE_URLS.oauthRelay`，因此要断言"已配 relay"分支必须 `mock.module` 掉 `identity.generated.ts`/`oauth-relay.ts`（也就必须是 `.isolated.ts`），否则只能断言 fail-closed 分支。既有 `packages/shared/src/sources/__tests__/oauth-relay.isolated.ts:78,98,118` 已经在断言 `redirectUri` 不含 `thecraftagents.com`，可作为风格参考。
- **风险**：
  - 与 `packages/shared/CLAUDE.md:45` 和 `SERVICE_URLS.oauthRelay = null` 正面冲突；谓词**只能在"已配自有 relay"或"明确 fail closed"的前提下使用**，否则等于把上游主机请回来。
  - **UNVERIFIED**：Slack 是否接受 `http://localhost:<port>` 形态的 redirect URL（本沙箱无法访问 Slack 文档）。这决定了本仓当前无 relay 路径是"只是没注册"还是"根本注册不了"；前者可由第 3 条的备选方案解决，后者只能 fail closed。
  - **UNVERIFIED**：本仓没有任何 Cloudflare Worker 源码实现 `getSlackRelayCallbackUrl()` 指向的 `/auth/slack/callback?port=` 路由（`workers/pages/` 与此无关），所以"自有 relay"分支缺少端到端验证手段。

### 3.11 #1071 MCP 源连接失败被静默丢弃 —— 适配后采纳（两层都缺）

- **上游改法**：`McpClientPool.sync()` 重写（移除改并行、连接统一收集后 `Promise.allSettled`），并在 `allSettled` 的 reducer 里对每个 rejected 项打 `console.warn('[McpClientPool] Failed to connect source "<slug>": <msg>')` + `this.debug(...)` + `failures.push(slug)`；第二层在 `BaseAgent`：**接住** `sync()` 的返回值，`failures.length > 0` 时打 `` console.warn(`[${backendName}] N source(s) failed to connect and will be unavailable this session: …`) ``。并行的意义是"一个慢的 stdio spawn 不再拖住其余的"。
- **我们的现状**：**两层都缺，且 `sync()` 的返回值早就存在却被丢弃。**
  - `packages/shared/src/mcp/mcp-pool.ts:266` 的 `async sync(...)` 本就是 `Promise<string[]>`（返回失败 slug 列表），但连接是**串行**的，失败只打 `this.debug(...)`：`:301-302`（MCP 首次连接）、`:313`（重连）、`:325-326`（API 源）。整个方法里没有 `console.warn`——该文件唯一的 `console.warn` 在 `:164`（代理工具名冲突）。
  - `packages/shared/src/agent/base-agent.ts:614` `await this.config.mcpPool.sync(mcpServers, apiServers);`——**返回值被丢弃**。这是本仓的实际路径：`PiAgent` 覆写 `setSourceServers`（`pi-agent.ts:2776`）并在 `:2784` 委托 `super.setSourceServers(...)`；后端层没有第二个调用方。
  - 另一处丢弃在 `packages/server-core/src/sessions/SessionManager.ts:4138`（`await managed.mcpPool.sync(mcpServers) // Ensure pool has tools before SDK connects`）——**上游 0.13.6 也没改它**（`:3420` 未变）。建议：本批只做上游那两层，把这一处记为有意的后续项，避免无声偏离。
- **判定**：`适配后采纳`，工作量 S。
- **移植要点**：
  1. 重写 `McpClientPool.sync` 方法体：保留现有 `filteredMcp` / `apiSlugs` 前导，按上游改成"并行移除 + 收集 `toConnect` + 一次 `allSettled` + reducer 里 warn/debug/push"。
  2. **必须适配本仓的形状**：本仓用的是 `AgentMcpServerConfig`（`agent/backend/types.ts:350`；上游早已改名 `SdkMcpServerConfig`）与 `apiServers: Record<string, McpServer>`（`apiSlugs = new Map(Object.entries(apiServers))`，`:281`），而不是上游那个 `ApiServerConfig {type:'sdk', instance}` 包装。所以要 push 的是 `() => this.connectInProcess(slug, server)`，`server` 是 map 里的 `McpServer` 值。照抄上游补丁**编译不过**。
  3. `base-agent.ts:614` 改为接住 `failures` 并按上游格式 warn + `this.debug`。
- **验证**：`bun test packages/shared/tests/mcp-pool.test.ts`（211 行；已核对 `:134-144` 断言 `disconnectCalls` 等于单元素数组 `['linear']`、`:146-166` 用 `toContain`/`find`、`:168-186` 断言 `failures` 含该 slug、`:188-210` 直接传 `{ 'my-api': apiServer }` ——最后一条正是"必须保留本仓 `Record<string, McpServer>` 签名"的证据）。
- **风险**：低–中。
  - 并行化后**断开顺序与日志顺序不再确定**；将来任何断言多元素 `disconnectCalls` 精确顺序的测试都要避免。
  - `connect()` 本身按 slug 幂等（开头 `if (this.clients.has(slug)) return`），且配置变更的源仍先同步 `disconnect` 再入队，所以 token 刷新语义保持不变。
  - 命名一致性上没问题：本仓既有的 `[McpClientPool]` warn 前缀（`:164`）与上游一致，新 warn 落在既有约定上而非另立一套。

### 3.12 #1072 Pi/DeepSeek 推理占满输出预算时无告警 —— 适配后采纳（上游写法在本仓不可达，需改写守卫）

- **上游改法**：`packages/shared/src/agent/backend/pi/event-adapter.ts` 10 行，**不引入任何新状态**——在 `adaptEvent` 的 `message_end` 分支里，作为 `text_complete` 块的 `else if` 打一条 `console.warn`：`[PiEventAdapter] Turn produced N output token(s) but zero text. Reasoning likely consumed the full output budget (seen with DeepSeek + thinkingLevel≥medium at large contexts). Lower the thinking level or start a fresh session to recover.` 纯日志，**不依赖任何 fallback 链**，所以本仓"移除模型 fallback"与此无关。
- **我们的现状**：无告警（grep `output budget|zero text` 0 命中），而且**上游那个守卫在本仓不可达**：`event-adapter.ts:648` 的 `isIntermediate = stopReason==='toolUse' || isLengthLimited || !textContent` 在"零文本 + 有 usage"的情况会强制为 `true`，而 `:650` 的 `if ((textContent || msg.usage) && (isIntermediate || !this.hasEmittedFinalText))` **会**命中（于是发出 `text_complete`，`text:''`、`isIntermediate:true`），所以 `else if` 永不触发。
- **判定**：`适配后采纳`，工作量 S。
- **移植要点**：把告警放进 `:650` 那个块**内部**，守卫写成 `!textContent && !isLengthLimited && msg.stopReason !== 'toolUse' && !msg.errorMessage && !this.hasEmittedFinalText && (msg.usage?.output ?? 0) > 0`。这样错误/溢出/重试路径（在 `:644` 之前已 `break`）保持安静，长度续写路径（`:637-638` 已设 `pendingLengthError`）也保持安静。
- **验证**：既有 `packages/shared/src/agent/__tests__/pi-event-adapter.test.ts` 兼容（`:130` 的空回合用例有文本且无 usage；`:153` 的失败重试用例 `stopReason:'error'`）。本仓无 `no-console` lint 规则，且 `base-agent.ts:625` 已在用 `console.warn`，不违反约定。上游未加测试。
- **风险**：低。

### 3.13 决策层（`decisions/*`）—— 未列入 release notes 的整块新功能，建议**分阶段采纳**

> 这是 0.13.6 里最大也最意外的一项：**146 个文件里有 33 个是新增文件，其中 19 个属于一个 release notes 完全没提的新子系统**。它不是 bug fix，需要产品判断。

- **它是什么**：一个**可选的第二模型面**，与聊天模型并列。新增 `decide` 会话工具，把文本/JSON 连同最多 20 个**带类型的问题**（`choice` / `score` / `noul`）发给 Jev（TypeSafe 的 "System One"），拿回**概率而不是散文**——约 0.1–0.5 s、成本极低。
  - 一次调用 = 一条记录，追加到 `<CONFIG_DIR>/logs/decisions.jsonl`（本仓即 `~/.phaneris/logs/decisions.jsonl`），10 MB 轮转到 `.prev.jsonl`。记录**只存 state 的 sha256 + 字节数，绝不存 state 文本**；`meta` 走密钥脱敏；失败记录用 `includeDetail:false`（因为校验型网关可能回显 state）。
  - 一次调用 = 一个 HTTP `POST {baseUrl}/v1/systemone`。"provider" 是 5 个预置之一：typesafe / openrouter / vercel-ai-gateway / laya（本地无密钥 `laya-serve`）/ custom。
  - 工具体契约：`decide({ state | items, questions, deadlineMs? })`；批模式最多 200 项、并发 8、120 s 墙钟预算、结果按输入顺序返回。
  - 子模块职责：`providers`（预置）、`settings`（浏览器安全的设置形状 + 归一化/合并）、`client`（唯一 HTTP 路径：zod 校验、96 KB state 上限 + sha256、`AbortSignal.timeout`、HTTP→失败类型映射、密钥 `scrub()`）、`records`（JSONL 审计）、`resolve`（**闸门链**：总开关 → 功能开关 → 密钥 → 端点；`getDecisionClient()` 任一失败返回 `null`，fail-closed）、`status`（设置页快照 + 一条罐装往返测试，可在启用**之前**验证密钥）、`health`（无密钥 `GET /health`，2 s，用于本地服务器探测）。
- **开关**：`StoredConfig.decisionLayer.enabled`，**默认关闭**；没有环境变量、没有 feature-flags 条目。因此用户可见面只有：设置页 AI 下的"Decision model (Jev)"卡片、新会话工具列表里的 `decide`、系统提示里一行文档引用 + 一节 `## Decision Model`、以及 `apps/electron/resources/docs/decisions.md`。
- **我们的现状**：**完全没有。** `packages/shared/src/decisions/`、`packages/server-core/src/decisions/`、`apps/electron/resources/docs/decisions.md` 都不存在；`grep decision` 在 `packages/session-tools-core/src` 只命中无关散文。所需依赖本仓全部具备（`config/paths.ts` 的 `CONFIG_DIR`/`resolveConfigDir`、`utils/redaction.ts:105` 的 `redactSensitiveValues`、`utils/debug.ts:157` 的 `createLogger`、`credentials/index.ts:25` 的 `getCredentialManager`、zod v4 已是 shared 的 peerDep）。
- **判定**：`适配后采纳`，**分阶段**。工作量：子系统内核 M，端到端 M–L（19 个新文件约 3,109 行，其中 919 行是上游测试；28 个改动文件约 1,250 行）。
- **为什么值得采纳**（移植性出乎意料地好）：
  - 它是这次 upstream drop 里**最自包含**的一块：一个 barrel + 3 个子路径导出、一个回调对象、一行工具注册、一组 RPC。
  - **逐条核对过的所有文本锚点在本仓都逐字存在**（`tool-defs.ts:879-880`、`context.ts:408`/`:767`、`mode-manager.ts:2032`、`pi/session-tool-defs.ts:19`、`channel-map.ts:383`、`SessionManager.ts:5411-5424`、`TurnCard.tsx:588`、`tool-parsers.ts:465`、`credentials/manager.ts:186`、`en.json:1250`）——那些文件的偏离都在别处，是纯追加，所以"'绝不假设文本可套用'的警告在这里不咬人"。
  - 它尊重本仓每一条已记录契约：`safeMode` 派生的 Explore 分类自洽；RPC 路径与工具路径**共用** `resolveDecisionClient` → `SystemOneClient` → `DecisionRecorder`（校验/state 限界/错误映射只写一遍，不存在 `create_task` 那种重复实现风险）；不碰 MCP；不改 `update_runtime_config` 字段表；**密钥只进凭证库**。
  - fail-closed 设计（默认关、`null` 客户端、回调常驻且每次调用重查设置 + 1 s TTL）让它即使 UI 滞后也能安全落地。
- **移植要点（分层）**：
  1. **自包含层（S–M，可原样复制 + 机械改品牌）**：9 个 `packages/shared/src/decisions/*.ts`；`packages/shared/package.json` 加 `./decisions`、`./decisions/types`、`./decisions/settings` 三个子路径导出；`credentials/{manager,types}.ts` 的 `decision_api_key` 类型（锚点 `manager.ts:186-188` 逐字存在）；`config/storage.ts`（锚点 `:88-90`，照抄 `:580-591` 的 rtk getter/setter 惯例）；`protocol/channels.ts`（`:402-408`，插在 `rtk` 与 `badge` 之间）与 `routing.ts`（`:174-180`，7 个 channel 全进 `LOCAL_ONLY_CHANNELS`）；`server-core/src/decisions/tool-callbacks.ts` + `rpc/decisions.ts`（与 `server-core/src/pages/tool-callbacks.ts` 同形）；`session-tools-core/src/handlers/decide.ts` + `handlers/index.ts`；`channel-map.ts`（`:383-387`）与 `apps/electron/src/shared/types.ts`（`:763-766`）；`apps/electron/resources/docs/decisions.md` + `docs/index.ts` 的 `DOC_REFS.decisions`；`packages/ui` 两个文件（141 行，纯插入）。
  2. **需重新锚定（S，锚点都已核验）**：`tool-defs.ts` 5 处追加（`:879-880`、`:149`、`:916-919`、`:927-936`、`:974-981`、`:1042-1047`）；`context.ts`（`:408` 加 `decide?`，`:767-776` 插镜像类型块）；`session-scoped-tool-callback-registry.ts`（`:22`）；**`session-self-management-bindings.ts`（`:193-199`，照抄 `pages` 的 `defineProperty` getter——这是本仓真正的 ctx 绑定缝，容易漏）**；**`agent/backend/pi/session-tool-defs.ts`（`:19-24`，本仓唯一的生产侧工具广告者，由 `pi-agent.ts:697` 调用）**；`mode-manager.ts:2032-2035` 加 `includeDecide: true`；`SessionManager.ts`（`:102` 导入 + `:5424` 之前的 `decide:` 字段）。
  3. **需重写而非打补丁（M）**：`packages/shared/src/prompts/system.ts` —— 本仓提示词已重写（`getPhanerisAssistantPrompt` `:583`，行以变量形式 `:604 browserDocRow` / `:605 cliDocRow` 在 `:667-668` 插值，call_llm 节 `:683-691`），上游的锚点（`getCraftAssistantPrompt`、`FEATURE_FLAGS.craftAgentsCli`、`DOC_REFS.craftCli`）在本仓不存在。要**自己写** `decideDocRow` 与 `## Decision Model` 一节。
  4. **可延后（M）**：`apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` 的约 305 行设置卡片。**关键**：因为密钥可以经 `connectionSlug` 从既有 OpenRouter / Vercel 连接借用，所以手工编辑 `config.json`（`decisionLayer: {enabled:true, connectionSlug:"…"}`）就能无 UI、无凭证库写入地启用——因此"后端 + 工具 + 文档 + 提示词，UI 稍后"是一个**真正可发布**的阶段。
  5. **i18n（S，但三道门禁都在 pre-push 上）**：7 个 locale 各 36 个 `settings.ai.decisions.*` 键，插在 `en.json:1250/1251` 之间（恰好是字母序正确位置）。⚠️ `privacyNote` 在**每个** locale 的译文句子里硬编码了 `~/.craft-agent/logs/decisions.jsonl`，7 处都要改成 `~/.phaneris/…`。
- **⚠️ 不能照抄的部分**：
  - `prompts/system.ts` 的 hunk（要重写）。
  - `packages/shared/CLAUDE.md` 里那条 **config-dir 规则句**——它要求"`CRAFT_CONFIG_DIR` must switch every path at once"，与本仓 `config/paths.ts:11-20` 的刻意决定**正面冲突**。（决策层那条 bullet 可以改品牌后采纳。）
  - `agent/session-scoped-tools.ts` 的 hunk：本仓该文件只有 77 行 plan 辅助函数，上游的锚点（Claude 侧 `getSessionScopedTools()`）不存在。
  - `protocol/dto.ts` 的 +5（那是 `TestLlmConnectionParams.connectionSlug`，属 §3.6 #1048，不是决策层）；`session-tools-core/src/types.ts` 与 `src/index.ts` 的一部分（属 §3.2 api-auth）。
  - `ipc-channels.test.ts` hunk 里的 `pages:getShareDataScan` 一行——本仓 `:223` 已经有了，只取那 7 行 `decisions:*`。
  - `SessionManager.ts` 差异里紧邻的 `model: managed.model` hunk——那是 §3.12/模型面的事，与决策层无关。
- **必读风险**：
  1. **上游未披露的子系统**：release notes 零提及；且它的设置模型已持久化 `features.taskVerdicts` / `features.semanticLabels`，注释标 "(PR B)"——即"存了但没实现的旋钮"。**不要为它们做 UI**，只当作上游后续工作的记录，以免本仓 config schema 漂移。
  2. **品牌替换只被"半强制"**：`scripts/check-identity.ts:48-93` 的 token 扫描会覆盖新文件，但 `.husky/pre-push` → `validate:ci` 跑的是**非 strict** 的 `identity:check`，残留命中时**退出码仍是 0**；只有 `identity:check:strict` 会失败。所以 OpenRouter 的 `X-Title: 'Craft Agents'` 或截断标记里的上游品牌会**悄悄通过 CI**。`@craft-agent/*` 说明符则是硬编译失败（本仓包名是 `@phaneris/*`）。
  3. **在限制最严的模式里新增了数据出境路径**：`safeMode: 'allow'` + `readOnly: true` 让 `decide` 在 Explore/Safe 模式下可用——这是上游有意的（"只读"），但意味着 agent 选定的文本可以在 Explore 模式离开本机。文档与隐私说明覆盖了这点，但仍建议产品负责人签字确认。
  4. **测试策略冲突（需你决定）**：`AGENTS.md` 规定"绝不在写完代码后写单元测试；优先把 E2E 作为唯一测试手段"。上游这 919 行 bun 单元测试钉的是线格式、记录脱敏、闸门顺序与批行为。建议：**采纳** `shared/src/decisions/*.test.ts`（它们包含安全相关不变量：绝不记录 state、排除 provider 文本、fail-closed 闸门），**另加**一条 `decide` 工具经 stub provider 的 E2E；`tool-defs-filtering.test.ts` 可选（E2E 已覆盖可见性）。
  5. **文档测试耦合**：`packages/shared/src/prompts/__tests__/docs-contract.test.ts:16-20` 断言每个 `.md` 结尾的 `DOC_REFS` 值都能在 `apps/electron/resources/docs/` 找到文件——所以 `DOC_REFS.decisions` 与 `docs/decisions.md` **必须同一提交落地**，否则 `bun test` 红。

### 3.14 其余未归类改动

| 上游文件 | 内容 | 本仓状态与动作 |
|---|---|---|
| `packages/shared/src/agent/backend/types.ts` (+9) | `AgentBackend` 加可选 `isCompactionInFlight?()` | **适配后采纳**，属 §3.4；插在 `:447` 之后 |
| `packages/shared/src/agent/base-agent.ts` (+16) | ① `isCompactionInFlight()` 返回 `false` 的具体默认（属 §3.4）② MCP pool 失败 `console.warn`（属 §3.11） | 两个 hunk 分属两个批次；默认实现必须是**具体**而非抽象，否则 `TestAgent extends BaseAgent`（`test-utils.ts:105`）编译不过 |
| `packages/shared/src/agent/backend/pi/session-tool-defs.ts` (+4) | `includeDecide: isDecisionFeatureActive('decideTool')` | `不需要`（属 §3.13 决策层） |
| `packages/shared/src/prompts/system.ts` (+16) | 决策层的文档行 + `## Decision Model` 一节 | `不需要`（属 §3.13，且需重写参考 §3.13 要点 3） |
| `packages/server-core/src/sessions/SessionManager.ts`（82 行中的非上述 hunk） | `source_activated` 分支：新增 `lastUserMessageContent(messages)`（反向扫最后一条非空 user 文本），`resendMessage = captured.trim() ? captured : lastUserMessageContent(managed.messages)`，仅在确实无内容时跳过 | **采纳**：本仓 `:10009-10013` 仍是"originalMessage 为空就 warn + break"的旧形态，`lastUserMessageContent` 0 命中，测试 `source-activated-auto-retry.test.ts:147` 也是旧期望。移植：辅助函数插在 `claimAutoRetryPending`（止于 `:945`）与 `createManagedSession`（`:947`）之间，`Message` 已在 `:110` 导入；替换 `:10009-10015`；更新 `:147` 并补新用例。风险低（空历史仍返回 `''` → 仍跳过，既有测试保持绿） |
| `packages/server-core/src/sessions/source-activated-auto-retry.test.ts` (+27) | 上述的测试 | 与上一条同批 |
| `apps/electron/resources/docs/permissions.md` (+2) | `allowedWritePaths` 说明改为"Explore 与 Ask to Edit 均生效" | **适配后采纳**，属 §3.3 |
| `apps/electron/resources/docs/sources.md` (+5) | `headerName` 单数说明 + RFC 8707 `resource` 字段 | **适配后采纳**，分别属 §3.2 与 §3.9（该文件会同步到 `~/.phaneris/docs` 并被 agent 读取，是真实产品面） |
| `packages/shared/src/docs/index.ts`（decisions 部分 +1） | `DOC_REFS.decisions` | 属 §3.13；**必须与 `docs/decisions.md` 同批** |
| `packages/shared/package.json`（decisions/api-auth 子路径） | `./decisions*`、`./api-auth` | 分属 §3.13 与 §3.2；本仓已有 `./config/paths` |
| 各 `package.json` 版本位（14 处）与 `bun.lock`（28 行） | 纯 `0.13.5 → 0.13.6` 版本位，**没有任何依赖版本变动**（28 行全是 workspace 的 `version` 字段） | `不需要`。本仓走自有 0.2.x 版本线并由 `version:check` 把关；误取会打乱该门禁 |
| `packages/session-mcp-server/package.json` | 上游该 workspace | `不需要`（本仓无此 workspace） |
| `apps/electron/resources/release-notes/0.13.6.md` | 上游发布说明 | `不需要`（本仓有自己的 0.1.0–0.2.3 + `next.md` 序列，由 `apps/electron/resources/AGENTS.md` 规定） |
| `packages/shared/CLAUDE.md` (+7) | 5 条约定：config-dir 规则、api-auth 凭证规则、`allowedWritePaths` 单匹配器、手动压缩占用回合、拦截器日志有界；+1 条 `src/decisions/` 目录说明；1 条 `midStreamBehavior` 改写 | **逐条取舍**：`allowedWritePaths`（§3.3）、压缩占用（§3.4）、拦截器日志（§3.8）、api-auth（§3.2）、模型 fallback 位置（§3.12）**改品牌后采纳**；decisions 目录 bullet 视 §3.13 决定；**config-dir 那条必须不采纳**（或其措辞必须按本仓 `PHANERIS_CONFIG_DIR` 政策重写，否则照抄会同时撞 `identity:check` 与本仓政策） |

## 4. 不适用清单

| 类别 | 文件 | 原因 |
|---|---|---|
| **Claude 后端全部** | `packages/shared/src/agent/claude-agent.ts`、`agent/backend/claude/{event-adapter,event-adapter}.ts`、`agent/claude-sdk-error-mapper.ts`、`agent/__tests__/claude-*.test.ts`、`agent/backend/internal/drivers/anthropic.ts`（0.13.5） | 本仓已删除 Claude Agent SDK 后端，PiAgent 是唯一后端 |
| **Claude SDK 依赖与版本位** | `@anthropic-ai/claude-agent-sdk` 0.3.258→0.3.280、各 `package.json` 的 `0.13.x` 版本位、`bun.lock` | 本仓自有 0.2.x 版本线与依赖策略（`version:check`） |
| **上游托管服务常量** | `thecraftagents.com/auth/{callback,slack/callback}`、`SLACK_LEGACY_RELAY_CALLBACK_URL` | 违反 `SERVICE_URLS` 全 `null` 的"永不回退上游端点"规则，并撞 `identity:check` 的 `/craftagents/gi` |
| **上游环境变量名** | `CRAFT_CONFIG_DIR`、`CRAFT_DEBUG_FULL_BODIES`、`CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL` | 撞 `identity:check` 的 `/\bCRAFT_[A-Z0-9_]+/g`；本仓对应名 `PHANERIS_*` |
| **上游一次性迁移助手** | `secure-storage.ts` 的 `migrateCredentialsIfNeeded()`、`workspaces/storage.ts` 的 `migrateWorkspacesIfNeeded()` | 本仓 `scripts/migrate-legacy-profile.ts:182` **刻意排除** `credentials.key`/`credentials.enc`（OS 应用绑定加密，复制过去永远解包不了也会毁掉重新生成的机会）；workspace 迁移由该显式脚本承担并会重写存量路径。照抄会毁凭证库 |
| **不存在的 workspace** | `packages/session-mcp-server/*` | 本仓无此 workspace |
| **上游发布说明** | `apps/electron/resources/release-notes/0.13.6.md` | 本仓自有发布说明序列；按 `apps/electron/resources/AGENTS.md`，用户可见变更追加到 `next.md`，版本文件由发布流程生成 |
| **开发期工具硬编码** | `apps/electron/src/renderer/playground/registry/generate-icons.ts:13,16`（`$HOME/.craft-agent/tool-icons`）、`packages/messaging-gateway/.../ilink/util/logger.ts:48`（`os.tmpdir()/craft-wechat-logs`） | 非运行期路径（手工 playground 脚本 / 临时目录），可另行顺手清理 |
| **Electron `userData`** | `apps/electron/src/main/index.ts:247-256`（钉在 `USER_DATA_DIR_NAME`） | 与上游一致（PR #1061 也没动 userData），**不属于本次缺口**；若要真正的多实例隔离（Chromium profile + 单实例锁 `:375`）是新需求 |

## 5. 合并计划（批次与提交顺序）

原则：**按"能否独立验证"分批，而不是按上游文件分批**；每批一次提交、独立可回滚；把"必须同时落地否则更糟"的改动绑在一批里。

### B0 基础设施与卫生（无行为风险）

| 项 | 文件 | 依据 |
|---|---|---|
| `resolveConfigDir` 纯度重构 + 契约测试 | `packages/shared/src/config/paths.ts`、新增 `config/__tests__/paths.test.ts` | §3.7 |
| `config/index.ts` 补 `paths` 再导出（可选） | `packages/shared/src/config/index.ts` | §3.7 |
| `~/.craft-agent` 注释 sweep + `browser-tools.md:220` 陈旧字面路径修正 | 约 25 个文件的注释 + `apps/electron/resources/docs/browser-tools.md` | §3.7 |
| `prerequisite-manager.isolated.ts:29-31` 改读 `PHANERIS_CONFIG_DIR` | 1 个测试文件 | §3.7 |
| 死代码：`isAdaptiveThinkingAlwaysOnModel()` 删除或接线 | `packages/shared/src/config/models.ts:371` | §2.2 |

> B0 可以随时做，与其余批次无依赖。

### B1 独立缺陷修复（互不依赖，可并行提交）

| 顺序 | 项 | 文件 | 依据 |
|---|---|---|---|
| B1-1 | `allowedWritePaths` 在 ask 模式生效（含 win32 glob 归一化 + **配套 mock 改动**） | `agent/mode-manager.ts`、`agent/core/pre-tool-use.ts`、`agent/__tests__/mode-manager-allowed-write-paths.test.ts`（新）、`agent/core/__tests__/pre-tool-use-checks.isolated.ts`、`docs/permissions.md` | §3.3 |
| B1-2 | header 凭证形状修复（先模块 + 单测，再运行时 + 端到端） | `session-tools-core/src/api-auth.ts`（新）+ `.test.ts`（新）、`session-tools-core/package.json`、`sources/credential-manager.ts`、`sources/api-tools.ts`、`sources/__tests__/header-credential-shape.test.ts`（新）、`handlers/source-test.ts`、`sources/index.ts`、`SessionManager.ts:2393` | §3.2 |
| B1-3 | transcript 路径相对化（两半） | `shared/src/utils/files.ts`、`server-core/src/sessions/SessionManager.ts:9380,9526`、`shared/src/utils/__tests__/path-relativize.test.ts`（新） | §3.1 |
| B1-4 | MCP 连接失败可见 + 并行连接 | `shared/src/mcp/mcp-pool.ts`、`shared/src/agent/base-agent.ts:614` | §3.11 |
| B1-5 | 连接测试掩码修复 | `shared/src/protocol/dto.ts`、`server-core/src/domain/connection-setup-logic.ts`、`server-core/src/handlers/rpc/llm-connections.ts`、`apps/electron/src/renderer/hooks/useOnboarding.ts`、两份 `connection-setup-logic.test.ts` | §3.6 |
| B1-6 | 浏览器弹窗拆除（弹窗 WeakMap + `pageWebContentsId` + `cdp.detach` 保护） | `apps/electron/src/main/browser-pane-manager.ts`、`__tests__/browser-pane-manager.isolated.ts` | §3.5 |
| B1-7 | 拦截器日志有界 + 请求体默认省略 | `shared/src/interceptor-common.ts`、`shared/src/unified-network-interceptor.ts`、`shared/src/__tests__/interceptor-common.test.ts`、`shared/src/__tests__/unified-network-interceptor.curl.test.ts`（新） | §3.8 |

> B1-2 是**唯一需要先确认打包解析**的一项（本仓第一处 `@phaneris/session-tools-core/<subpath>` 消费者）。建议 B1-2 的第一小步就单独跑一次 `bun run build:smoke`，确认 `exports` 被子路径解析尊重；若不尊重，退化为相对导入。

### B2 压缩与中流投递（**四项必须同批**）

| 项 | 文件 | 依据 |
|---|---|---|
| 压缩等待模块 + 双预算 | `pi-agent-server/src/compaction-wait.ts`（新）+ `.test.ts`（新）、`pi-agent-server/src/index.ts:2098,2168,2409` | §3.4 |
| 宿主超时取消子进程 | `shared/src/agent/pi-agent.ts`（`compactTimeoutMs` + epoch + `abort`）、`agent/__tests__/pi-compaction.test.ts` | §3.4 |
| `isCompactionInFlight` 契约 + steer 拒绝 | `agent/backend/types.ts`、`agent/base-agent.ts`、`agent/pi-agent.ts` | §3.4 |
| 中流排队而非 steer（含解析入参改写） | `server-core/src/sessions/SessionManager.ts:6996-7059`、`sessions/midstream-queue.test.ts` | §3.4 |
| `source_activated` 兜底 | `SessionManager.ts:10009-10015`、`source-activated-auto-retry.test.ts` | §3.14 |
| DeepSeek 零文本告警 | `agent/backend/pi/event-adapter.ts:650` | §3.12 |

> ⚠️ B2 的前三项与第四项之间存在**强耦合**：`redirect()` 在压缩期间返回 `false` 而不改解析入参，会伪造 `wasInterrupted: true`。**不要拆成两次提交。**

### B3 模型面（0.13.5 补录 + 标题恢复）

| 项 | 文件 | 依据 |
|---|---|---|
| Opus 5.5 补录 + Bedrock 映射 + 默认模型决定 | `shared/src/config/llm-connections.ts`、`config/models.ts`、（可选）`config/storage.ts` | §2.2 |
| DeepSeek 存量迁移两条 | `shared/src/config/models.ts:66-75`、（顺带）`llm-connections.ts:620-621` 的 `opencode*` 残留 | §2.3 |
| 小模型查询抽取 + 标题回落 | `pi-agent-server/src/mini-model-query.ts`（新）+ `.test.ts`（新）、`pi-agent-server/src/index.ts:126,1723-1771`、`server-core/src/sessions/SessionManager.ts:6428,9161`、`server-core/src/sessions/title-generation.isolated.ts`（新） | §3.6/§3.12 |
| `CLAUDE.md`：标题临时 agent 必须带 `model`、fallback 链位置 | `packages/shared/CLAUDE.md` | §3.6 |

> 后两项**同一提交**：抽取的 `queryMiniModel` 单独上线是惰性的（宿主不传 `sessionModel` 时链仍不完整）。

### B4 MCP OAuth / Slack（需一次产品决定）

| 项 | 文件 | 依据 |
|---|---|---|
| RFC 8707/9728：`resource` 贯通 + `invalid_target` 重试 + well-known 多候选 | `shared/src/auth/oauth.ts`、`auth/oauth-flow-types.ts`、`auth/oauth-flow-store.ts`、`server-core/src/handlers/rpc/oauth.ts`、**`auth/__tests__/oauth.isolated.ts` 的 9 处断言改写** | §3.9 |
| 手工 API 源的 `oauth.resource` | `shared/src/sources/types.ts`、`auth/generic-oauth.ts`、`sources/credential-manager.ts:1196`、`docs/sources.md` | §3.9 |
| Slack 桌面登录（**决策点**：自有 relay 提前返回 / 无 relay fail-closed / 固定回调端口） | `auth/slack-oauth.ts`、`sources/credential-manager.ts:461-531`、`sources/__tests__/slack-oauth-relay.isolated.ts`（新） | §3.10 |

> §3.9 的 `oauth.ts` 部分建议一批做完（5 个子项互相咬合），并把 `oauth.isolated.ts` 的 9 处 `toEqual(authServerMetadata)` 断言**同批**改为带 `resource`。

### B5 决策层（**产品决定后再排期**，建议按 §3.13 的两阶段）

- B5a：后端 + `decide` 工具 + 文档 + 提示词 + i18n（M）
- B5b：设置卡片（M，可延后；B5a 后可经 `config.json` 手工启用）

### 不建议做的事

1. **不要尝试 `git merge upstream/main` 或 `git cherry-pick v0.13.6`。** merge-base 停在 `v0.13.3`，上游每个发布是单个压平提交（146 文件 +7614/−589），而本仓 388 个提交把其中 97 个文件改过、删除了 11 个、并重命名了 5 个测试文件。合并冲突会是全局性的，且会把 Claude 后端、`CRAFT_*` 环境变量与上游托管 URL 一起带回来（`identity:check` 会红）。
2. **不要按上游 hunk 逐条 `git apply`。** `SessionManager.ts` 偏移约 1.5k–2.8k 行、`pi-agent-server/src/index.ts` 约 1.4k 行、`ai-tools`/`tool-parsers`/`AiSettingsPage` 都是重写。所有移植都按"函数级定位"手写。
3. **不要照抄 `packages/shared/CLAUDE.md` 的 config-dir 规则句**，也不要引入任何 `CRAFT_*` 名字。

## 6. 验证基线

### 6.1 门禁的真实覆盖范围（先认清这个，否则会误判"绿"）

| 环节 | 实际执行 |
|---|---|
| pre-commit (`.husky/pre-commit`) | `lint:i18n:parity` + `lint:i18n:sorted` |
| pre-push (`.husky/pre-push`) | `bun run validate:ci` = `typecheck:all` + `lint` + `test:shared:all`（**仅 3 个窄脚本**：llm-connections / models-pi / 3 个 config 测试）+ `test:doc-tools` + `test:ui:table` + 4 个 i18n 门禁 + `identity:check`（**非 strict**）+ `version:check` |
| CI `validate` job（PR + push） | 上述 + `test:critical` + remote-token-vault 回归 + `run-recovery-tests.ts` |
| CI `quality-windows` job（PR + push） | `typecheck:all` + `lint` + 3 个 i18n 检查 + 8 个 Windows 平台回归测试 + recovery |
| CI `full-validation` job（**仅 push 到 main / schedule**） | `validate:full` = `validate:ci` + **`bun run test`（全工作区）** + `build:smoke` + `bundle:report --check` + `server:build:subprocess` |

**结论：`bun run test`（全量测试）不在 pre-push 里**，只有 push 到 `main` 之后 CI 的 `full-validation` 才跑。因此本计划里那些"必须同步改断言"的项（§3.9 的 9 处 oauth 断言、§3.2 的 source-test 副本、§3.3 的 mock、§3.5 的 webContents mock `id`）**都不会被 pre-push 拦住**。落地时必须在本地显式跑相关 `bun test`，或接受"推完才知道红"。

### 6.2 每批必须跑的

1. **类型**：`bun run typecheck:all`。（注意 `packages/shared/tsconfig.json` 的 `include` 覆盖 `src/**/*`，所以 `src/` 下的**测试文件也会被类型检查**，新增测试里的 `as unknown as` 强转是必需的。）
2. **聚焦测试**：各 §3.x 小节"验证"里列出的文件；至少 `bun test <该文件>`。
3. **全量测试**：`bun run test`（`scripts/run-workspace-tests.ts` 按包逐个跑；`*.isolated.ts` 各占一进程）。**不要跳过**——见 6.1。
4. **lint**：`bun run lint`（含 `lint:transition-all`）。
5. **i18n**（仅当引入新键）：`lint:i18n:parity`、`lint:i18n:sorted`、`lint:i18n:coverage`、`lint:i18n:dead-keys`。
6. **品牌**：`bun run identity:check`（建议在涉及新文件时用 `identity:check:strict`，因为非 strict 会放过残留）。
7. **版本**：`bun run version:check`（只要不动 `package.json` 版本位就不会红；**不要**取上游的版本位或 `bun.lock` hunk）。
8. **打包解析**（仅 B1-2 的子路径导出需要）：`bun run build:smoke`，并确认 `server:build:subprocess` 对 Pi 子进程仍成功。
9. **推前**：`bun run validate:ci`（pre-push 会自动跑，耗时数分钟，不要 `--no-verify`）。
10. **推后**：盯 CI `full-validation` job（它是唯一跑 `bun run test` 的地方）。

### 6.3 建议补充的 E2E（本仓政策偏好 E2E）

按 `AGENTS.md`"优先把 E2E 作为唯一测试手段，并在末尾产出可复现的验证产物"，建议为本轮最重的几项各加一条端到端：

| 项 | E2E 内容 | 产物 |
|---|---|---|
| §3.2 header 凭证 | 建一个单 `headerName` 的 API 源 → 经多 header 提示写入 `{"x-goog-api-key":"…"}` → 调 `source_test` 与真实 `api_<source>` 工具，断言两者发出的头部值都是裸密钥 | 抓到的请求头 JSON |
| §3.3 allowedWritePaths | `permissionMode: 'ask'` 的自动化写允许清单内路径不弹窗、写清单外路径弹窗 | 两次运行的权限事件日志 |
| §3.4 compact 期间发消息 | 在 `/compact` 进行中发一条消息，断言它在压缩结束后被送达（而非丢失） | 会话 transcript + 投递事件序列 |
| §3.8 拦截器日志 | 长会话下日志文件不超过 32 MiB + 单条不超过 4 MiB + 默认不含请求体 | `interceptor.log` 大小与代表性命中 |
| §3.13 决策层 | 经 stub provider 跑一次 `decide` 单条 + 一条批量 | `decisions.jsonl` 记录（确认无 state 文本） |

## 7. 风险与开放问题

### 7.1 需要你决定的（阻塞项）

1. **§3.13 决策层到底要不要**。这是本轮唯一"不是修 bug"的大块（19 个新文件 / 约 3,109 行 + 28 个改动文件），也是唯一引入**新的数据出境面**（Explore 模式下把 agent 选定的文本发往第三方）与**新的审计日志**的项。三个选项：(a) 全量采纳（B5a+B5b）；(b) 只采纳后端 + 工具 + 文档（B5a，可经 `config.json` 手工启用，UI 延后）；(c) 本轮不采纳，只在本文件记录以备将来。**我的建议是 (b)**——它自包含、锚点齐全、fail-closed，且不阻塞其余批次。
2. **§3.10 Slack 桌面登录的走向**。三条路各有代价：自有 relay 提前返回（只修好"已配 relay"的安装，且需要一个本仓并不存在的 Worker 路由）、无 relay 时 fail closed（最诚实，但会让当前能"看起来走到授权页"的流程直接报错）、固定回调端口 + 让运维注册确切 URL（可用但要求配置）。**需要产品/运维决定**，且有一个未解的外部事实：Slack 是否接受 `http://localhost:<port>` 形式的 redirect URL（本沙箱无法核实）。
3. **§2.2 Opus 5.5 是否成为新连接默认**。上游让它成为默认；本仓的 `PI_PREFERRED_DEFAULTS` 首位仍是 `claude-opus-4-8`。补录模型与改默认是**两个**决定——建议先只补录（让用户能选），默认变更另行评估。
4. **§3.13 的测试策略**：是否采纳上游 919 行单元测试（与 `AGENTS.md` 的"E2E 优先、不在写完后补单测"存在张力）。

### 7.2 移植过程中的技术风险（已定位，需在实现时留意）

| 风险 | 位置 | 处置 |
|---|---|---|
| 子路径导出解析 | `@phaneris/session-tools-core/api-auth`（§3.2） | 本仓第一处；先跑 `build:smoke`，不通过就退化为相对导入 |
| 压缩期间 steer 导致伪"中断"提示 | §3.4 第 3/4 步 | **必须同批**；`midstream-queue.test.ts:40-53` 是不变量守卫 |
| `redirect()` 错误文案被吞 | §3.4；`pi-agent.ts:2568` 用 `includes('abort')` 分流 | 保留上游 "timed out … and was cancelled" 措辞 |
| 本仓事件词表无 `compaction_failed` | §3.4 | 移植测试不能用上游的位置数组断言 |
| 测试 mock 缺字段 | §3.3（`pre-tool-use-checks.isolated.ts` 的 `getMergedConfig`）、§3.5（webContents mock 无 `id`） | 只改源码不改 mock 会整个进程 `TypeError` |
| 并行化后顺序不确定 | §3.11 | 不要写断言多元素顺序的测试 |
| 拦截器模块级状态与 preload 共享 | §3.8 | 保留本仓惰性结构；`afterEach` 调 `_resetLogStateForTesting()` |
| 9 处 oauth 断言 | §3.9 | 同批改写，否则 `bun run test` 红且 **pre-push 拦不到** |
| `matchesAllowedWritePath` 纯词法、无 realpath | §3.3 | 先按上游对齐；realpath 加固作为本仓独立议题另开 |
| 上游 `AiSettingsPage.tsx` / `llm-connections.ts` / `credentials/*` 混装了 §3.6 与 §3.13 | §3.6、§3.13 | 按函数/锚点切分，别整段取 |
| 上游带附件的中流发送丢附件 | §3.4 附带发现 | 先确认渲染层是否允许；不允许则可只记 TODO |

### 7.3 已知的既有问题（非本轮引入，供参考）

- `packages/shared/CLAUDE.md` 与约 25 个文件的注释仍写 `~/.craft-agent`（B0 顺手清理）。
- `apps/electron/resources/docs/browser-tools.md:220` 让 agent 去读 `~/.craft-agent/docs/browser-tools.md`——在 `PHANERIS_CONFIG_DIR` 实例里是错的实际路径（B0 修）。
- 全仓两个"手工再推导配置根"的位置（`interceptor-common.ts`、`config-validate.ts`）是**有意**的（preload 不能 import；session-tools-core 不依赖 shared），且都已在注释里写明与 `resolveConfigDir()` 保持一致——不要试图"统一"它们。
- `packages/shared/src/sources/__tests__/basic-auth.test.ts` 是解析逻辑的独立副本，§3.2 落地后会变成过期镜像（建议改为 import 真实实现）。
- `source-activated-auto-retry.test.ts:147` 现为旧期望（B2 会更新）。
- Electron `userData` 不随配置根移动，多实例共用 Chromium profile 与单实例锁（与上游一致，非本轮缺口）。

## 8. 实施记录（2026-09-28）

前文的判定**已全部落地**。下表是批次 → 落地位置 → 验证。所有"验证"列的测试都是实际运行过的；每条后面标注了**与上游的偏离**。

### B0 基础设施与卫生（§3.7 / §2.2）

| 项 | 落地位置 | 验证 |
|---|---|---|
| `resolveConfigDir` 纯度重构 + 契约测试 | `packages/shared/src/config/paths.ts`（`resolveConfigDir(env, home)` 纯函数；`warnIfLegacyRoot()` 承接待删的遗留根告警）、新增 `config/__tests__/paths.test.ts`（6 例，含子进程验证告警仍会触发）、`config/index.ts` 补再导出、`DATA_DIR_NAME` 新导出 | `bun test src/config/__tests__/paths.test.ts` 6 pass；`bun run tsc --noEmit` exit 0 |
| `prerequisite-manager.isolated.ts` 改读 `PHANERIS_CONFIG_DIR` | 1 个测试文件 | 回退探针在 override 下 3 fail → 修复后 33 pass |
| 死代码 `isAdaptiveThinkingAlwaysOnModel()` 删除 | `packages/shared/src/config/models.ts` | 全仓 grep 仅剩文档提及；`tsc` exit 0 |
| `~/.craft-agent` 注释 sweep | 25 个源文件、47 处（脚本按字节保 BOM/EOL 改写，`git diff` 无全文件行尾变动） | 无混合行尾；残留仅剩**有意**的 5 处（`LEGACY_IDENTITY`、`check-identity` 忽略表、迁移脚本、两处设计记录注释） |
| `generate-icons.ts` 去掉写死的上游路径与工作区 UUID | `apps/electron/src/renderer/playground/registry/generate-icons.ts`（改读 `PHANERIS_CONFIG_DIR/PHANERIS_SAMPLE_WORKSPACE_ID`） | 类型检查 |
| Electron `userData` 随配置根（§7.3 的既有缺口） | `apps/electron/src/main/index.ts`：无 `PHANERIS_CONFIG_DIR` 时与之前**逐字节一致**；有则落 `<CONFIG_DIR>/user-data`，使 Chromium profile / 更新缓存 / 单实例锁一并隔离 | `bun run typecheck:electron` exit 0 |

### B1 独立缺陷修复（§3.1–§3.3、§3.5、§3.6、§3.8、§3.11）

| 项 | 落地位置 | 验证（实测） |
|---|---|---|
| #1065 `allowedWritePaths` 在 Ask to Edit 生效 | `agent/mode-manager.ts`（`matchesAllowedWritePath` 导出 + `globToRegex` win32 归一化）、`agent/core/pre-tool-use.ts`（10 行守卫）、新增 `agent/__tests__/mode-manager-allowed-write-paths.test.ts`、**配套** `agent/core/__tests__/pre-tool-use-checks.isolated.ts` mock、`docs/permissions.md` | 4 pass；`pre-tool-use-checks.isolated.ts` 73 pass；`src/agent` 全目录 719 pass；`tsc` exit 0 |
| #1067 header 凭证 | 新增 `session-tools-core/src/api-auth.ts` + `api-auth.test.ts` + `package.json` 子路径导出 + barrel；`sources/api-tools.ts`（`buildHeaders`/`buildUrl` 薄包装）、`sources/credential-manager.ts`（委托 `parseStoredApiCredential`）、`sources/index.ts`、`handlers/source-test.ts`（共享装配 + `readResponseExcerpt`）、新增 `sources/__tests__/header-credential-shape.test.ts`、`basic-auth.test.ts` 改为 import 真实实现、`SessionManager.ts:2393` 写侧 `serializeHeaderCredential`、`docs/sources.md` | `api-auth.test.ts` 23 pass；`source-test.isolated.ts` 21 pass；`header-credential-shape.test.ts` 5 pass；`sources/__tests__/` 全量 127 pass；**子路径导出已用 esbuild 实测解析**（与 `electron:build:main` 同一 bundler） |
| #1056 transcript 路径 | `shared/src/utils/files.ts`（`normalizeRelativizeBase` + 段边界 + 双侧锚定正则 + **win32 分隔符归一化**）、新增 `utils/__tests__/path-relativize.test.ts`、`SessionManager.ts:9380/:9526` 补 `managed.workingDirectory` | 63 pass（首轮 4 例在 Windows 因 `path.relative` 返回反斜杠而失败 → 加 win32 归一化后全绿） |
| #1071 MCP 连接失败可见 + 并行 | `shared/src/mcp/mcp-pool.ts`（并行移除、`toConnect` 收集、`Promise.allSettled`、`console.warn` 点名）、`agent/base-agent.ts:614` 接住 `failures` | `tests/mcp-pool.test.ts` 8 pass（新 warn 路径被真实触发）；`tsc` exit 0 |
| #1048 编辑连接时测试 | `protocol/dto.ts`（`connectionSlug?`）、`server-core/src/domain/connection-setup-logic.ts`（`maskApiKey`/`isMaskedApiKey`/`resolveSetupTestApiKey`）、`handlers/rpc/llm-connections.ts`、`useOnboarding.ts:487`、两份镜像测试 | server-core 36 pass、electron 镜像 39 pass、`useOnboarding` 16 pass；另用 `bun -e` + `mock.module` 驱动**真实 handler** 实证"掩码 + slug → 后端收到真实密钥"与 `GET_API_KEY` 回灌成功 |
| #1059 浏览器弹窗拆除 | `browser-pane-manager.ts`（`pageWebContentsId` 快照、`popupWebContentsIdByWindow` WeakMap、`cdp.detach` 纳入守卫步骤）、`__tests__/browser-pane-manager.isolated.ts` +5 例 | 88 pass；`typecheck` exit 0；**逐缺口负向对照**：回退任一改动都会让对应测试变红 |
| #1033 拦截器日志有界 | `interceptor-common.ts`（32 MiB 轮转 + 4 MiB 单条 + `PHANERIS_DEBUG_FULL_BODIES` 开关 + `initLogFile`/`rotateLogIfNeeded`/`appendLogEntry`/三个测试钩子，**保留本仓惰性根解析**）、`unified-network-interceptor.ts`（`toCurl` 导出 + 默认省略正文）、两个测试 | 8 + 6 pass，10 文件同进程 80 pass；另做**真实路径 E2E**（`PHANERIS_DEBUG=1` + 临时配置根，两种模式各 14/14）：正文变占位符、SENTINEL 提示词与 base64 不落盘、authorization 仍 REDACTED、单条与文件上限生效、import 期不建目录 |
| 既有：`escapeSandboxPath` 导出 + 平台可移植测试 | `session-tools-core/src/runtime/filesystem-isolation.ts`（导出并补文档）、其测试（期望改用同一函数；含引号的 fixture 改为"叶子不存在"以便 Windows 可构造；新增反斜杠纯函数断言） | 修复前 Windows 5 fail → 修复后 **7 pass** |

### B2 压缩与中流投递（§3.4 / §3.12 / §3.14）

| 项 | 落地位置 | 验证 |
|---|---|---|
| 压缩等待双预算 | 新增 `pi-agent-server/src/compaction-wait.ts` + `.test.ts`（**逐字节同上游**，SHA256 核验）、`pi-agent-server/src/index.ts`（删内联实现，提示词前 300 s、手动 compact 前 120 s + 上游日志） | 4 pass；`pi-agent-server` typecheck exit 0 |
| 宿主超时取消子进程 | `shared/src/agent/pi-agent.ts`（`compactTimeoutMs` 字段、超时递增 epoch + `send({type:'abort'})`、文案 `Compaction timed out after Xs and was cancelled`）、`agent/__tests__/pi-compaction.test.ts` +2 例 | 8 pass；探针确认事件流为 `[error('…was cancelled'), complete]`，**未被 `includes('abort')` 吞成静默成功** |
| `isCompactionInFlight` 契约 | `agent/backend/types.ts`（可选方法）、`agent/base-agent.ts`（返回 `false` 的具体默认）、`pi-agent.ts`（覆写 + `redirect()` 守卫） | 同上；`tsc` exit 0 |
| 中流排队而非 steer | `server-core/src/sessions/SessionManager.ts`（`shouldAttemptMidStreamSteer`、`attemptedSteer` 把关、**解析入参改为 `attemptedSteer ? 'steer' : 'queue'`**、日志补 `compactionInFlight`）、`midstream-queue.test.ts`（上游用例去掉 Claude 段 + 4 个跑真实 `sendMessage` 分支的测试）、`source-activated-auto-retry.test.ts` | 7 + 13 pass，两文件同跑 20 pass；`src/sessions/` 21 文件 119 pass |
| `source_activated` 兜底 | `SessionManager.ts`（`lastUserMessageContent`）、`source-activated-auto-retry.test.ts` | 同上 |
| #1072 DeepSeek 零文本告警 | `agent/backend/pi/event-adapter.ts`（**告警移入 `:650` 的 `if` 块内**并改写守卫——上游的 `else if` 在本仓不可达） | `pi-event-adapter.test.ts` 86 pass |

### B3 模型面（§2.2 / §2.3 / §3.6 标题回落）

| 项 | 落地位置 | 验证 |
|---|---|---|
| Opus 5.5 / Opus 5 补录（**不改默认**） | `config/models.ts`（两条 `MODEL_REGISTRY` 记录，1M 窗口，**排在 4.8 之后**；`BEDROCK_TO_BARE` 补 us./eu./global./base 四形态）、`config/llm-connections.ts`（`PI_PREFERRED_DEFAULTS.anthropic`/`.amazon-bedrock` 把 5.5、5 插在 4.8 **之后**；`BEDROCK_MODEL_MAP` 补四形态） | `models.test.ts` + `models-pi.test.ts` 33 pass，含"`findModelIdByShortName('Opus')` 仍是 4.8"与"Bedrock 四形态回映不串味" |
| DeepSeek 存量迁移 | `config/models.ts` 的 `DEPRECATED_MODEL_REPLACEMENTS` 加两条；`llm-connections.ts` 的 `opencode*` 首选列表去掉已下线的 `deepseek-v4-flash` | 同上（含 `pi/` 前缀形态与"当前 id 原样通过"） |
| `queryMiniModel` 抽取 | 新增 `pi-agent-server/src/mini-model-query.ts` + `.test.ts`（**逐字节同上游**，SHA256 核验） | 13 pass；`pi-agent-server` typecheck exit 0 |
| 接线 + 标题带会话模型 | `pi-agent-server/src/index.ts`（`queryLlm` 尾部改 `queryMiniModel`，移除已无用的 `isModelNotFoundError` 导入；保留 `runQueryWithModel` 与单一 deadline）、`SessionManager.ts` 两处标题临时 agent 加 `model: managed.model`、新增 `sessions/title-generation.isolated.ts` | 13 + 2 pass；`src/sessions/` 119 pass；**反向验证**：抽掉那两行 `model:` 后该测试 2/2 失败，确认非空转 |

### B4 MCP OAuth 与 Slack（§3.9 / §3.10）

| 项 | 落地位置 | 验证 |
|---|---|---|
| RFC 8707 `resource` 贯通 | `auth/oauth.ts`（发现结果带出 `resource`、授权/换 token/刷新全链路、`postTokenRequest` + `isInvalidTargetResponse` 的 `invalid_target` 单次重试、`buildProtectedResourceMetadataUrls` 多候选回落且保留 401 门槛）、`auth/oauth-flow-types.ts`、`auth/oauth-flow-store.ts`、`auth/generic-oauth.ts`（含 refresh 第 5 参）、`sources/types.ts`（`ApiOAuthConfig.resource`）、`server-core/src/handlers/rpc/oauth.ts`、`sources/credential-manager.ts:1182`（refresh 传 `oauthConfig.resource`）、`docs/sources.md`、`auth/__tests__/oauth.isolated.ts`（**9 处 `toEqual(authServerMetadata)` 同批改写** + 3 个上游 describe，`clientId` 改 `'phaneris'`） | `oauth.isolated.ts` **75 pass**；`oauth-relay.isolated.ts` 3 pass；RFC 8414 回落与 12 条 SSRF 用例单独确认仍绿；shared/server-core tsc 均 exit 0 |
| Slack 桌面 fail closed（用户决定） | `auth/slack-oauth.ts`（新增 `loopbackCallbackPort()`，复用 `getSlackRelayCallbackUrl()` 推导 `<relay>/auth/slack/callback?port=N`，无自有 relay 时抛**可操作错误**给出两条出路；**未引入上游 relay 常量**）、`sources/credential-manager.ts` slack 分支（信封之前提前返回）、新增 `sources/__tests__/slack-oauth-relay.isolated.ts`（10 例） | 10 pass（`-t` 分别过滤两个 describe 也通过）；`tsc` exit 0 |

### B5 决策层全量（§3.13，用户决定全量采纳）

| 层 | 落地位置 | 验证 |
|---|---|---|
| shared 核心 + 测试 + 子路径导出 | 新增 `src/decisions/{types,providers,settings,client,records,resolve,status,health,index}.ts`（1688 行）+ 4 个测试（629 行）；`package.json` 加 `./decisions`、`./decisions/types`、`./decisions/settings` | `bun test ./src/decisions/` **43 pass / 0 fail**（含解锁后的 `decision_api_key` 那 4 条）；`tsc` exit 0；`bun build --target=browser` 只带 settings/types → 6 KB 且**零 node builtin**（渲染层契约） |
| 凭证 + 协议 | `credentials/types.ts`（`decision_api_key` + `isDecisionCredential` + 双向编解码分支）、`credentials/manager.ts`（get/set/delete）、`protocol/channels.ts`（7 个 channel）、`protocol/routing.ts`（全入 `LOCAL_ONLY_CHANNELS`） | `src/credentials/` 4 pass；`src/protocol/` 8 pass（**含路由穷尽性：每个 channel 恰好分类一次**） |
| 会话工具 + ctx 绑定 + 广告 + Explore 分类 | `session-tools-core/src/context.ts`（镜像类型 + `decide?`）、新增 `handlers/decide.ts` + `.test.ts`（**逐字节同上游**，SHA256 核验）、`handlers/index.ts`、`tool-defs.ts`（schema/描述/注册行 `safeMode:'allow'`+`readOnly`/`includeDecide` 默认 false 并贯通两处）、`tool-defs-filtering.test.ts`、`src/index.ts` barrel、`shared/src/agent/session-scoped-tool-callback-registry.ts`、`session-self-management-bindings.ts`（**ctx 绑定缝**）、`backend/pi/session-tool-defs.ts`（`isDecisionFeatureActive('decideTool')`）、`mode-manager.ts`（`includeDecide: true`）、新增 `agent/__tests__/session-self-management-bindings.test.ts` 集成例 | `decide.test.ts` 8 pass；`tool-defs-filtering.test.ts` 8 pass；绑定集成 13 pass；两包 tsc exit 0 |
| 文档 + 提示词 + UI + IPC + i18n | 新增 `apps/electron/resources/docs/decisions.md`（105 行，仅 1 行品牌）、`shared/src/docs/index.ts`（`DOC_REFS.decisions`）、`packages/ui/src/lib/tool-parsers.ts`（+138，`decide` 文档块）、`ui/src/components/chat/TurnCard.tsx`、`apps/electron/src/shared/types.ts`、`transport/channel-map.ts`、`shared/__tests__/ipc-channels.test.ts`、7 locale × 36 键、`AiSettingsPage.tsx`（+307，设置卡片） | `docs-contract.test.ts` 5 pass；`ui` tsc exit 0 且 `src/lib/__tests__/` 15 pass；`ipc-channels.test.ts` **7 pass（420 channels）**+ `channel-map-parity` 2 pass；**i18n 四门禁全 0**（parity/sorted/coverage/dead-keys，2307 键全被引用）；`apps/electron` typecheck exit 0 |
| 服务端集成（本批收口） | `config/storage.ts`、新增 `server-core/src/decisions/tool-callbacks.ts` + 测试、新增 `handlers/rpc/decisions.ts` + `rpc/index.ts`、`SessionManager.ts` 注册 `decide:`、`prompts/system.ts` 重写、`release-notes/next.md` | 见本节末"服务端集成"行 |

### 与上游的**有意偏离**总表（供未来合并参考）

1. **`api-auth.ts` 删掉上游一行死守卫**（`if (configuredNames.length === 0) return raw;` 恒真，令其后的 `return headerMap` 不可达）。上游自带的 `api-auth.test.ts` 对其**自己的** v0.13.6 源码跑会红 2/23；本仓采纳测试为契约、让 JSDoc 承诺的 fallback 可达。**本仓线上请求头不因此改变**（`buildApiAuthHeaders` 的第二道防线本来就会解包 JSON 串），但 MCP 侧 `server-builder.ts` 依赖 `isMultiHeaderCredential` 才把凭证并入 headers，返回 map 才不会静默丢掉密钥 header。**建议向上游报 issue。**
2. **`path-relativize.test.ts` 的 Windows 分隔符**：`path.relative` 在 Windows 返回 `\`，会写出 `./src\a.ts` 这种混用分隔符的 transcript。加 `process.platform === 'win32'` 门控的归一化（与上游 `globToRegex` 的 win32 门控同理；POSIX 上文件名里的反斜杠必须原样保留）。
3. **`interceptor-common.ts` 保持惰性根解析**，不采用上游 import 期的 `CONFIG_DIR`/`LOG_FILE`/`if (DEBUG) initLogFile(...)`——本模块是 Bun `--preload`，import 期求值会钉死根并破坏 `*.isolated.ts` 模式。准备动作放进既有 `ensureLogFile()`。
4. **`shouldAttemptMidStreamSteer(behavior, agent)` 去掉了上游的 `textOnly`**：本仓该分支没有 payload 判据（`canSteerTextPayload`/`acceptedSteers` 0 命中），自造一个会顺带改变非压缩路径（带附件的中流发送目前 steer 并静默丢附件，属既有缺口）。
5. **`prompts/system.ts` 重写而非打补丁**：本仓提示词架构不同（`getPhanerisAssistantPrompt` + 行变量插值），上游锚点不存在。
6. **`slack-oauth.ts` 不引入上游 relay 常量**：改用自有 relay 派生 + 无 relay 时 fail closed（用户决定）。环回派生与 fail-closed 放在 `prepareSlackOAuth` 内部，因此直调该函数也受保护，不只依赖 credential-manager 的提前返回。
7. **未移植 `canonicalResourceIdentifier()`**：上游 v0.13.6 生产代码从未调用它（设计者最终选了"不做派生兜底"）。
8. **`SourceCredentialManager.getApiCredential` 的 `sources/types.ts` 未加 `defaultHeaders?`**：上游 v0.13.6 才引入该字段，本仓 `ApiSourceConfig` 没有，故 `source-test.ts` 的 `buildApiAuthHeaders` 未传第三个实参——行为与移植前一致。
9. **`decisions/resolve.ts` 自带 `readDecisionLayerSettings()`**：B5-1 为可独立 typecheck 而引入；B5-4a 收口时决定是否收敛到 `config/storage.ts` 的 getter（避免双读路径）。
10. **未采纳 `packages/shared/CLAUDE.md` 的 config-dir 规则句**（要求 `CRAFT_CONFIG_DIR` 一把切换所有路径），与本仓刻意不受理该变量的政策冲突；其余约定 bullet 已改品牌后采纳。

### 顺带修复的既有问题（§7.3 及本轮发现）

| 问题 | 处置 |
|---|---|
| `~/.craft-agent` 注释残留（25 文件 47 处） | 已 sweep（保留 5 处有意引用） |
| `generate-icons.ts` 写死的上游路径 + 烘焙工作区 UUID | 改为读 `PHANERIS_CONFIG_DIR` / `PHANERIS_SAMPLE_WORKSPACE_ID` |
| `basic-auth.test.ts` 是解析逻辑的独立副本 | 改为 import 真实实现（13 pass；1 条断言按新契约改写并注明） |
| Electron `userData` 不随配置根 | 有 `PHANERIS_CONFIG_DIR` 时落 `<CONFIG_DIR>/user-data`；无则与之前逐字节一致 |
| `filesystem-isolation.test.ts` 在 Windows 5 例红（`"` 无法建目录 + 反斜杠未转义期望） | 导出 `escapeSandboxPath` 并让期望共用它；含引号的 fixture 改为叶子不存在；新增反斜杠纯函数断言 → 7 pass |
| `mode-manager.test.ts` 在满载时超时 1 例（每次 `parseCommand` 同步 spawn 真实 PowerShell，实测冷启 ~4.3 s；3 次调用 ~4.7 s 对 bun 默认 5 s 预算） | 该文件 `setDefaultTimeout(30_000)` 并写明理由——不放松任何断言，真挂起仍会失败 |
| `~/.craft-agent` 的 `browser-tools.md` 字面路径 | 已确认早前已被移除（无需处理） |
| 两处"手工再推导配置根"（`interceptor-common.ts`、`config-validate.ts`） | **有意保留**并在注释中写明与 `resolveConfigDir()` 保持一致的理由 |
| `packages/pi-agent-server/src/bundle-smoke.test.ts` 的 `beforeAll` 冷启构建超时（该 hook 要构建整个 12.9 MB 压缩包，bun 默认 hook 预算 5 s，实测冷启 ~3 s、满载 >5 s，超时后会报"bundle build failed"——一次**并未失败**的构建） | 给该 hook 加上它自己 `spawnSync` 早已声明的 120 s 预算（`beforeAll(fn, 120_000)`），并写明理由 |
| `packages/messaging-gateway/src/__tests__/wechat-state-isolation.test.ts` 3 例在 Windows 红（断言目录 `0700`——`mkdirSync({mode})` 在 Windows 被接受但 `statSync().mode` 报告的是 ACL 语义，POSIX 权限位断言在 Windows 永不可能成立） | 只把 mode 断言按 `process.platform !== 'win32'` 门控；目录创建/工作区隔离/账号作用域断言在**所有**平台继续跑，macOS/Linux CI 上的覆盖不变 |
| `packages/server/src/__tests__/smoke.test.ts` "shuts down cleanly on SIGTERM" 在 Windows 恒红（退出码 143。Windows 无法向另一进程投递信号：libuv 把 `proc.kill('SIGTERM')` 映射为 `TerminateProcess`，子进程的 `process.on('SIGTERM')` 处理器根本不执行，"优雅退出返回 0"这一契约在 Windows 上不可观测） | 该用例按 `process.platform === 'win32'` 提前返回；smoke test 的其余用例在 Windows 照常运行 |
| `apps/electron/src/renderer/docs/__tests__/manifest.test.ts` "starts every page with a level-1 heading matching its title" 在本机红（标题读成 `# Introduction\r`。`.gitattributes` 规定 `* text=auto eol=lf`，但本工作副本是旧 checkout，约 1.8k 文件仍是 CRLF，而 CI 是 LF） | 该断言改为按 `/\r?\n/` 切分——它比较的是标题而不是行尾；两种 checkout 状态下都正确 |

## 9. 最终验证（2026-09-28）

全部实际运行，退出码为准：

| 门禁 | 结果 |
|---|---|
| `bun run typecheck:all` | **exit 0**（覆盖 core / shared / server-core / server / session-tools-core / pi-agent-server / electron / ui / messaging-gateway / messaging-whatsapp-worker / cli / webui / viewer / build / scripts 共 15 个目标） |
| `bun run lint` | **exit 0**（0 error；115 + 3 条 warning 为既有） |
| `bun run test`（全工作区，`scripts/run-workspace-tests.ts`，含每个 `*.isolated.ts` 独立进程） | **exit 0，无失败** |
| `bun run validate:ci`（= pre-push 那一道） | **exit 0**：`typecheck:all` + `lint` + `test:shared:all` + `test:doc-tools`(python OK) + `test:ui:table` + i18n parity/sorted/coverage/dead-keys + `identity:check` + `version:check` |
| `bun run version:check` | **OK — 0.2.4 across 27 declarations (13 workspace packages)** |
| 各包单独回归 | shared **3055 pass / 6 skip / 0 fail**（185 文件）· server-core **427 / 0** · session-tools-core **131 / 0** · pi-agent-server **202 / 0**（含冷启构建）· apps/electron **994 / 0**（111 文件）· ui **400 / 0** · messaging-gateway **272 / 0** · apps/cli **68 / 0** · messaging-whatsapp-worker **41 / 0** · server **4 / 0** · core **3 / 0** |
| 决策层专项 | `shared/src/decisions/` **43 / 0**、`server-core/src/decisions/` **6 / 0**、`server-core/src/sessions/` **119 / 0**、`session-tools-core/src/handlers/decide.test.ts` **8 / 0**、`tool-defs-filtering.test.ts` **8 / 0**、`auth/oauth.isolated.ts` **75 / 0**、`sources/__tests__/slack-oauth-relay.isolated.ts` **10 / 0** |

**版本**：本仓已从 0.2.3 升到 **0.2.4**（14 个 `package.json` + `bun.lock` 的 13 处 workspace 版本位；`version:check` 通过 27 处声明一致）。

**未验证（据实记录）**：
1. 决策层的**设置卡片未在真实 Electron 窗口里点过**。它的 RPC 后端已被 headless 端到端证明（7 个 channel 注册、设置落盘回读一致、哨兵密钥不出现在 `GET_SETTINGS`/`GET_STATUS`、`probeServer`/`test` 对不可达端点只返回失败），工具链也已被端到端证明（`ctx.decide` → `handleDecide` → stub provider，单条 + 批量，`decisions.jsonl` 只含 sha256），但 GUI 冒烟未做。
2. **Slack 桌面登录的"已配 relay"分支只有单测覆盖**——本仓没有实现 `/auth/slack/callback?port=` 的 Worker 源码，也没有真机 Slack 应用可验；另有一个外部事实仍未核实：Slack 是否接受 `http://localhost:<port>` 形态的 redirect URL。
3. **`bun run build:smoke` / `bun run server:build:subprocess` 未跑**。子路径导出 `@phaneris/session-tools-core/api-auth` 与 `@phaneris/shared/decisions*` 的解析已用 esbuild（与 `electron:build:main` 同一 bundler）与 `bun build --target=browser` 分别验证过，但完整打包冒烟留给 CI 的 `full-validation`。
4. `identity:check:strict` 仍 exit 1（145 处 / 63 文件，全是**本轮之前就存在**的债；本轮新增文件中只有一处有意命中——Slack 测试里那条"绝不回退上游 relay"的断言常量）。pre-push 跑的是非 strict 版，exit 0。
5. 两个环境性 flake 已修（见第 8 节末尾最后四行），但本轮还观察到 `server-core/src/sessions/context-handoff-e2e.isolated.ts` 在**机器满载**时偶发失败（安静时连跑 6 次全绿）；未改动其实现，若 CI 复现需另行排查。


