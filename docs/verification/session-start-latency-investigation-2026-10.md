# Phaneris 会话"卡住/迟迟不开始"调查结论

- 日期：2026-10-23
- 对象：Phaneris 0.4.0（构建 2026-10-23 00:29:12）Windows 桌面端
- 范围：只读调查。未修改仓库代码、未修改任何会话数据。
- 对照物：DeepSeek Harness（DSH）desktop 0.2.1-rc.2，同机、同账号、同模型名 `deepseek-flash`、同样 `reasoningEffort: max`

---

## 0. 一句话结论

Phaneris 和 DSH 用的是**同一个模型名、同一个供应商域名，但不是同一个 API**：DSH 走 DeepSeek 的 **Anthropic Messages 兼容端点**（`https://api.deepseek.com/anthropic`，`thinking.enabled` + `output_config.effort`），Phaneris 走 **OpenAI Chat Completions 兼容端点**（`https://api.deepseek.com`，`thinking.enabled` + `reasoning_effort`）。

结果：同样的 `max`，Phaneris 上模型单步实际思考量是 DSH 的 **9 倍**（最长 110,675 字符 vs 12,137 字符），叠加 **3.1 倍**的固定提示词开销（27.6K vs 8.8K token），再叠加 **思考流在传输层被丢弃**（用户看不到任何进展），三件事合起来造成了"发出去几分钟没有反应"的体验。

"卡住"不是排队、不是网络、不是供应商慢——**请求早就发出去了，是模型在想，而应用把"正在想"这件事藏起来了。**

---

## 1. 现象分解：一次"发送"其实有四段

| 段 | 内容 | 实测耗时 | 用户能否感知 |
|---|---|---|---|
| ① 会话冷启动 | 每个会话新起一个 Bun 子进程（10.2 MiB bundle）+ SDK 会话 + 60 个工具注册 | **0.6–6.3 s**（58 会话实测"发送→请求发出"，中位 ≈2.4 s；其中子进程+SDK 初始化约 0.7–3.1 s） | 完全无反馈 |
| ② 首请求 prefill | 首个请求 28,943 token，`cacheRead≈0`，全量现算 | **1–10 s**（中位 ≈3.5 s） | 只有转圈 |
| ③ reasoning 阶段 | 模型在思考；`thinking_delta` 在 `transport-delta.ts` 被丢弃 | **0–213 s** | **完全看不到，等同死机** |
| ④ UI 缓冲 | 正文也要攒够 40 词或 2.5 s 才上屏 | 0.5–2.5 s | 字是"突然出现"的 |

四个被点名的实例，分别卡在不同段上。

---

## 2. 逐实例时间线（全部来自落盘证据）

### 2.1 `261022-young-jasmine`（用户报 TTFT 5217 ms）

```
21:54:19.666  用户发送
21:54:22.016  pi SDK 会话建立（+2.35 s，段①）
21:54:22.061  请求发出
21:54:27.278  首个 delta（5,217 ms = 轨迹里显示的 TTFT）→ 是 reasoning
21:54:28.200  首个正文 delta（+0.92 s）
21:54:28.313  完成
```
首请求 `input=28,943 / cacheRead=0`。用户实际等了 **8.6 s** 才看到第一个字，界面只承认 5.2 s。

### 2.2 `261022-silent-cloud`（十几秒无反应，手动停止）

```
21:26:34.428 发送 → 21:26:36.264 请求发出（+1.84 s）
21:26:40.125 首个 delta（3,861 ms）→ reasoning
21:26:56.448 用户中断（发送后 +22.0 s）
```
这 22 秒里模型产出 **9,444 字符 reasoning，0 字符正文**（`firstTextLatencyMs = null`）。

### 2.3 `261022-misty-horse`（几十秒无反应，手动停止）

```
21:22:51.921 发送 → 21:22:55.078 请求发出（+3.16 s）
21:22:56.119 首个 delta（1,039 ms）→ reasoning
21:24:30.977 用户中断（发送后 +99.1 s）
```
**95.9 秒，70,696 字符 reasoning，0 字符正文。** 注意这个会话的 TTFT 只有 1,039 ms——只看 TTFT 它"很健康"。

### 2.4 `261022-frosty-creek`（用户报 TTFT 12965 ms）

207 次模型调用，TTFT 中位 **13,051 ms**，p90 **20,695 ms**，最差 **52,692 ms**；上下文停在 **292,368 token**。按上下文分桶（中位数）：

| 上下文 | 次数 | TTFT 中位 |
|---|---|---|
| 50–100K | 30 | 3.8 s |
| 100–150K | 42 | 7.2 s |
| 150–200K | 17 | 14.1 s |
| 250–300K | 70 | **18.3 s** |

上下文与 TTFT 相关系数 **r = 0.70**。这一例是"上下文放大"，不是主因（见 §3.1）。

### 2.5 `261023-young-orbit`（0.4.0，等数分钟）

```
00:54:42.229 发送
00:54:44.042 SDK 会话建立（+1.81 s）
00:54:44.074 请求发出
00:54:50.145 首个 delta（6.07 s）→ reasoning
00:58:16.9   用户中断（+214.7 s，durationMs=212,866）
```
**107,033 字符 reasoning，0 字符正文。** 内容经核查不是死循环（18,869 词 / 5,165 唯一词，904 行 / 573 唯一行），是模型在逐条规划 SVG 坐标、渲染方案、Edge headless 参数。

### 2.6 `261023-ready-silver`（0.4.0，等数分钟）

首轮正常（7.3 s），损坏在后面：

| 时刻 | 请求耗时 | 首 delta | 首个正文 | reasoning 字符 |
|---|---|---|---|---|
| 00:32:29 | 7.3 s | 4.2 s | 6.9 s | 1,878 |
| 00:33:38 | 4.2 s | 3.3 s | 3.7 s | 227 |
| 00:34:13 | 21.1 s | 21.0 s | 21.1 s | 218 |
| 00:35:05 | **185.6 s** | 2.8 s | **181.9 s** | **110,675** |
| 00:43:33 | **151.4 s** | 9.1 s | **150.1 s** | **81,470** |
| 00:54:58 | 浏览器工具卡 **191.6 s** 后被中断 | — | — | — |
| 00:58:25 | `stop=error`：`Durable run … still has 1 unsettled tool operation(s)` | — | — | — |

到 00:54 上下文已涨到 **217K token**，单步 TTFT 从 3–4 s 升到 6–12 s。

**发送到请求发出仍然只有 1.6–2.9 s：**

| 轮次 | 用户消息落盘 | 请求发出 | 间隔 |
|---|---|---|---|
| 1 | 00:32:27.262 | 00:32:29.770 | 2.51 s |
| 2 | 00:33:36.571 | 00:33:38.545 | 1.97 s |
| 3 | 00:34:10.412 | 00:34:13.317 | 2.91 s |
| 4 | 00:35:04.058 | 00:35:05.668 | 1.61 s |
| 5 | 00:43:31.894 | 00:43:33.720 | 1.83 s |

---

## 3. 根因（按因果强度排序）

### 3.1 R1（决定性）：同模型名，两条不同的 DeepSeek API

**DSH 侧**（`app.asar` → `dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js`）：

```js
const PUBLIC_BASE_URL = "https://api.deepseek.com/anthropic";
const DEFAULT_MAX_TOKENS = 256e3;
headers.set("anthropic-version", "2023-06-01");

body = {
  max_tokens: options.maxTokens ?? model?.maxTokens ?? connection.maxTokens,
  thinking: { type: effort === "off" ? "disabled" : "enabled" },
  ...effort === "off" ? {} : { output_config: { effort } },   // effort = "max"
}
```

**Phaneris 侧**：

- 连接 `pi-api-key-2`：`providerType: pi`、`authType: api_key`、`baseUrl: https://api.deepseek.com`、模型 `pi/deepseek-flash`、`thinkingLevelMap.max = "max"`。
- 请求体构造在 `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:670-680`：
  `thinking = {type:"enabled"}` + `reasoning_effort = "max"`（OpenAI 兼容字段）。
- `max_tokens = model.maxTokens = 384,000`（`simple-options.js:23`）。

**实测后果**（同一台机器、同一账号、同一模型名、同样 `max`）：

| 指标 | DSH 主会话（本次对话，135 步） | Phaneris |
|---|---|---|
| 单步耗时 p50 | **5,547 ms** | 3–12 s（随上下文升） |
| 单步耗时 p90 | **14,679 ms** | 20–50 s |
| 单步最长 | **26,360 ms** | **212,866 ms** |
| 单步 >60 s | **0 / 135** | 多例（95 / 151 / 185 / 213 s） |
| reasoning p50 | **1,331 字符** | 1,528–4,415 字符（按天） |
| reasoning 最大 | **12,137 字符** | **110,675 字符** |

DSH 侧另有一个 48 步的子代理会话，p50 6,035 ms / p90 14,186 ms / max 21,680 ms，reasoning 最大 10,756 字符。

**反证（很重要）**：DSH 那个 135 步会话的上下文是 **242,977 token**，比 Phaneris 的 frosty-creek（292K）只差一点，但**没有任何一步超过 27 秒**。所以"上下文长"不能解释 3 分钟。

### 3.2 R2：固定提示词贵 3.1 倍（解释 3–10 s 的 TTFT）

| | DSH | Phaneris |
|---|---|---|
| system prompt | **1,448 token**（DSH 自报 `contextBreakdown.systemTokens`） | 约 7,000 token（`compileSystemPrompt` 25,177 字符） |
| 工具定义 | **7,364 token**（32 个） | 约 20,600 token（60 个，77,748 字符 JSON schema） |
| 合计 | **8,812 token** | **约 27,600 token** |

Phaneris 首请求实测 28,943 token、`cacheRead=0`；同会话第二轮立刻变成 `cacheRead=29,696`、TTFT 降到 0.6–1.8 s。**首轮缓存在新会话上跨不过去**：两个会话的宿主 prompt 实测 98.5% 字节相同，第一个不同的字节在偏移 25,363（末尾 396 字符的 `<working_directory>`，`PromptBuilder.getSelectedWorkingDirectory` → `prompts/system.ts:215`），且工具数组会随 flag/MCP 源在 60 与 61 之间抖动——工具在前，一个差异就让后面全部失效。

### 3.3 R3（感知放大器）：reasoning 根本不进 UI

- 子进程只转发正文：`packages/pi-agent-server/src/transport-delta.ts:1-9`
  ```ts
  if (update.type !== 'text_delta' || !update.delta) return undefined;
  ```
  `session-event-adapter.ts:48-52` 直接 return。
- 后端 TTFT 却把 reasoning 算进去了（`packages/pi-agent-server/src/assistant-timing.ts:19-22` 把 `thinking_delta` 计入 output），所以界面上那个 "TTFT 5217ms" 已经是乐观值；用户真实等待的是 `firstTextLatencyMs`。
- UI 侧：流式期间 thinking 活动只渲染成字面的 `"Thinking..."`（`packages/ui/src/components/chat/TurnCard.tsx:520-522, 601`），正文还要过一层缓冲：最短 500 ms、最长 2,500 ms、不到 40 词不显示（`packages/ui/src/components/chat/response-buffering.ts:15-26, 125-182`），未达标时显示 `"Preparing response..."`（`TurnCard.tsx:2082, 2873`）。

**DSH 恰好相反**：它的适配器把 `thinking_delta` 转成 `{type:"reasoning", text}` 块写进 `assistant/message.content`（`ds.js:1560-1561, 1889`），思考过程是一等内容，所以它"看起来"从不卡。

### 3.4 R4：流上没有空闲超时，重试还是静默的

- OpenAI SDK 的 600 s 超时只管到响应头，头一到就 `clearTimeout`（`node_modules/openai/client.mjs:1065, 1092`），此后没有 body/stream idle timeout。
- 请求级重试被关掉（`maxRetries: 0`，`openai-completions.js:195`）；provider 阶段的重试发生在 `start` 事件之前，`retry-after` 最长 60 s（`provider-retry.js:43,76-96` + `pi-agent-server/src/session-settings.ts:42-54`）。

于是"卡住"和"在重试"在 UI 上完全同形，除了点停止没有别的动作。这类事件可判别：`assistantMetrics.timingUnavailableReason === 'multiple_attempts'`。

### 3.5 R5（放大项）：上下文无节制增长

模型登记 1,000,000 窗口，压缩阈值按窗口比例算，`contextPolicy=compact` 实际要到接近 1M 才触发。于是会话可以长到 217K / 292K，每轮都要为一整份上下文付 TTFT（r=0.70）。ready-silver 26 分钟内从 3 万涨到 21.7 万，单步 TTFT 3–4 s → 6–12 s。

### 3.6 R6（功能坏死）：durable runtime 的停摆会话在累积

直接读 `~/.phaneris/workspaces/Work/runtime/runtime.db`：

| 表 | 现状 |
|---|---|
| `operations` | 69 行：**65 `recovery_parked`** + 3 `checkpoint` + 1 `model_effect_pending`；涉及 40+ 个会话，最早回溯到 **08-27** |
| `tool_operations` | 27,520 行，其中 **218 条 `effect_pending` 永远没有结算** |
| `runtime_events` | 195,961 行 / **789.6 MB** |
| `tool_operations` 体积 | **545.1 MB** |
| `projection_snapshots` | 129 行 / **272.6 MB** |
| 库文件 | **1,734,676,480 B（1.73 GB）**，`auto_vacuum=0`，`freelist=0` |

一个 run 停在 `recovery_parked` 会把该会话标成 `blocked`（`durable-runtime/execution/host.ts:280`），此后 `sendMessage` 在入口直接抛 `This session requires Runtime reconciliation before accepting another turn`（`SessionManager.ts:7120`）。**ready-silver 就是这样废掉的**：被中断的浏览器工具留下 `effect_pending` → run 停摆 → 之后的发送全部被拒。

增长曲线：备份 10-21 = 1.62 GB、10-22 = 1.64 GB、当前 1.73 GB（一天 +90 MB）。代码里只有投影快照有 30 天保留期，`runtime_events`/`tool_operations` 被明确排除在保留之外（`durable-runtime/store.ts:259-261`），`VACUUM` 只在**周日且"新鲜启动"**时跑（`durable-runtime/api/runtime.ts:93`）。每次模型派发前都要往这个库提交一次 T1（子进程等宿主提交完成才发请求），库越大、WAL 检查点越频繁，这个前置往返偶发变慢的概率越高。

### 3.7 R7：会话级冷启动

- 每个会话一个独立 Bun 子进程，首次发送才 spawn：`pi-agent.ts:264, 570-656`，每会话一个 `PiAgent`（`SessionManager.ts:4366` → `factory.ts:89`），driver 按 `sessionId` 存在 slot 里（`host.ts:65,128-143`）。
- 打包版跑 `resources/app/vendor/bun/bun.exe`（96 MB）加载 `bundle.js`（**10,676,376 B**），入口 `index.js` 只有 22 字节（`runtime-resolver.ts:27-33`）。
- 实测（子代理在本机打点）：进程起到模块执行 ≈350 ms，到 `ready` ≈371 ms，到 SDK 会话建好 ≈900 ms。58 个会话的"用户消息落盘 → 请求发出"分布：**0.6–6.3 s，中位 2.4 s**。
- 更糟的是同窗口里还有三件事抢同一个进程：首条消息落盘后立刻 `void generateTitle(...)`（`SessionManager.ts:7324-7325`，同一条子进程上的 `mini_completion`，它自己还要 `createAuthenticatedRuntime()` ≈0.4–0.5 s）；`toolsChanged` 会让子进程在首个 prompt 前 dispose 再重建（`pi-agent-server/src/index.ts:1636-1643`）；durable 提交是一次跨进程往返。

---

## 4. 明确排除的原因

| 假设 | 判定 | 证据 |
|---|---|---|
| **排队/被别的会话挡住** | **排除** | 58 会话的"发送→请求发出"与并发与否无相关性；`261023-young-orbit` 的请求在 ready-silver 有 191 s 工具在飞时仍然只用 1.81 s 发出。全局只有静态 `PiAgent.globalRefreshMutex`（按连接 slug，仅 OAuth 刷新）和工作区 SQLite 两处跨会话共享点。 |
| **供应商/网络慢** | **排除为主因** | 同一账号、同一模型名，DSH 135 步里 0 步超 60 s；差异出现在协议层而不是网络层。 |
| **prompt cache warming 抢请求** | **排除** | 默认关闭（`config/defaults.ts:56`、`session-settings.ts:108`），`CacheWarmer.start()` 只在一次真实请求之后启动，不会在会话创建时fire。 |
| **标题辅助请求阻塞主请求** | **部分排除，影响未量化** | 它确实在首条消息后立刻发射并复用同一子进程，但两者是同一进程内**独立的 AgentSession**，SDK 层不会互相 block；只能通过 CPU 争用、provider 同账号并发、共享 SQLite 提交三条路径影响主请求。未能量化，因为每个会话首轮都有一次，缺少对照组。 |
| **会话头缺失导致缓存拿不到** | **已由真实请求抓包排除**（用户方结论） | — |

---

## 5. 前几轮结论的修正

| 早先判断 | 修正 |
|---|---|
| "TTFT 高主要因为 29K token 冷 prefill" | 仍是首字延迟的主因（3–10 s），但解释不了 3 分钟 |
| "长上下文导致 13–50 s TTFT" | 是放大项不是根源：DSH 24 万 token 上下文仍 5.5 s/步 |
| "thinkingLevel=max 导致长篇思考" | **不成立**：DSH 同样是 max，思考量只有 1/9 |
| "reasoning 不显示" | 成立，且是感知上最大的一条 |
| "不是排队" | 成立，且已有更强对照 |
| 上轮口头提到的"3,010 步里 86 步超过 6 万字符思考" | **更正：是 23 步**（0.8%）；超过 2 万字符的是 148 步（4.9%） |

---

## 6. 一个未闭合的问题

R1（端点）与 R2（提示词/工具设计）都会推高思考量，现有数据无法把两者拆开：

- 支持"端点"的证据：DSH 与 Phaneris 的请求参数落在两条不同的 DeepSeek 服务路径上，且思考量差 9 倍；DSH 的 reasoning 带 `signature`（Anthropic 风格），Phaneris 的是明文 reasoning。
- 支持"提示词"的证据：Phaneris 的 system prompt 有 execution-contract / session-management（4,619 字符）/ deliverables 等强规程段，60 个工具里还有 `codemode`，其描述直接教模型"batch independent tool calls with Promise.allSettled"——ready-silver 那 110K 字符的思考正是"把整批工具调用在脑子里排演一遍"。DSH 只有 1.4K system + 32 个朴素工具。
- 干扰项：两边的任务形状不同（用户从没让 DSH 画 SVG），不能完全排除任务差异。

**拆开只需要一个实验**：把 Phaneris 那个 deepseek 连接的 baseUrl 从 `https://api.deepseek.com` 改成 `https://api.deepseek.com/anthropic`、协议切到 Anthropic Messages（pi-ai 已有该 API 分支），其余不变，跑同一个 pelican 任务。若思考量掉到 1 万字符量级 → 端点；若掉不下来 → 提示词与工具。

---

## 7. 修复优先级

### P0（直接决定体验）

1. **把 reasoning 流到 UI**（`transport-delta.ts` 放行 `thinking_delta`，事件契约加 `thinking` 增量）。
   不改任何真实延迟，但把"死机 99 秒"变成"我能看见它在想"。
2. **做 R1 的端点 A/B**（见 §6）。如果确认是端点，这是唯一能真正把 3 分钟降下来的改动。
3. **压固定提示词**：60 个工具 20.6K token 是首字延迟的主因。已有 `exposure: 'deferred'` 与 `tool_search` 机制（`tool-discovery.ts`），把 50 个 `mcp__session__*` 里不常用的改成按需加载，可望从 27.6K 降到 10K 量级；同时把 `<working_directory>` 从 system 前缀挪到用户尾部、固定工具顺序，让跨会话前缀缓存真正生效。

### P1（稳定性）

4. **给流加 idle 超时**（头到之后若 N 秒无 delta 就断开并提示），**把 provider 级重试暴露成状态**。
5. **durable 停摆自愈**：`recovery_parked` 的会话需要一个自动/一键恢复入口；查清 218 条 `effect_pending` 为什么永远不结算。
6. **会话级子进程常驻或预热**，并让标题 `mini_completion` 离开首轮关键路径（延到首个 assistant 回合结束之后）。

### P2（数据卫生与边角）

7. **`runtime.db` 保留策略**：给 `runtime_events`/`tool_operations` 加保留期与定期 `VACUUM`；1.73 GB 的库 + 两份 1.6 GB 备份需要轮转。
8. **删除路径**（见附录 A）。
9. **UI 缓冲**：把 `MAX_BUFFER_MS` 从 2,500 ms 降下来，或对"超时强制显示"的阈值从 5 词放宽。
10. **上下文策略**：1M 窗口下 292K 都不触发压缩，可考虑按"有效上下文"而非"模型窗口"计阈值。

---

## 附录 A：`261023-lucid-elm` 删不掉

**现场**：目录存在、**完全为空**（无 `session.jsonl`、无子项）、创建 00:40:27、mtime 00:47:14、ACL 正常（dotty FullControl）。而 `events.jsonl` 证明它曾是真实会话：00:40:33 `PermissionModeChange ask→allow-all`、00:47:09 `SessionStatusChange name="Pelican Bicycle SVG" → done`。`runtime.db` 里它仍有 `phase=checkpoint` 的 agent_turn（最后更新 00:45:19）。

**机制（最可能路径）**：

```
SessionManager.ts:6898  await this.execution.releaseSession(sessionId)
SessionManager.ts:6914  await this.productRepository.cancelAndWait(sessionId)
SessionManager.ts:6916  if (!deleteStoredSession(...)) throw ...   ← 抛在这里
SessionManager.ts:6923  browserPaneManager.destroyForSession(...)  ← 删除之后才销毁浏览器
SessionManager.ts:6939  this.sessions.delete(sessionId)            ← 永远执行不到
```

```ts
// packages/shared/src/sessions/storage.ts:389-401
rmSync(sessionDir, { recursive: true })   // 没有 force
} catch { return false }                  // 异常被吞掉
```

`rmSync(recursive)` 先删子项、再删目录。Windows 上只要有人持有该目录（该会话的 Pi 子进程是用 `cwd = 会话目录` 启动的，`pi-agent.ts:656`；应用内浏览器又是删完才销毁），最后一步 rmdir 就会失败——**子项删光、目录留下**，`deleteStoredSession` 返回 false，`deleteSession` 抛出，`sessions.delete` 不执行。于是磁盘上是空壳、内存里这条会话还在、列表里还看得见，点删除重复同一条失败路径。

第二条"点了没反应"的路径：如果会话已被 idle 淘汰出内存，`deleteSession` 在第一行就**静默 return**（`SessionManager.ts:6886-6890`，只 log warn，不抛错、不删盘）。

**处理办法**：完全退出 Phaneris（三个进程）后手工删掉该目录；或直接重启应用——会话列表按"目录里有没有 `session.jsonl`"枚举（`storage.ts:311-319`），空壳目录不会被列出，行会消失，磁盘上留一个空文件夹而已。`261023-mild-woods` 是同一现象的镜像（durable 里有记录、目录已不在）。**不确定性**：我试图用"重命名往返"探测该目录是否仍被 OS 锁定，被自身沙箱拒绝（对另一个目录做对照实验同样被拒），因此"首次删除时被谁持有"是推断而非直证。

---

## 附录 B：测量方法与数据来源

| 结论 | 数据来源 |
|---|---|
| 各实例时间线 | `<session>/.pi-sessions/*.jsonl` 的 `message.assistantMetrics`（`stepStartTime` / `firstOutputLatencyMs` / `firstTextTime` / `completedTime`）+ `session.jsonl` 的 `timestamp` |
| 58 会话冷启动、3010 步统计 | 遍历 `~/.phaneris/workspaces/Work/sessions/*/.pi-sessions/*.jsonl` |
| 提示词构成 | 同一 jsonl 的 system 记录（`sections` + `toolsAdded` 60 项，序列化 77,748 字符）+ `compileSystemPrompt` 实测 25,177 字符 |
| durable 状态 | 只读打开 `runtime/runtime.db`（bun:sqlite, `readonly:true`）查询 `operations` / `tool_operations` / `runtime_events` / `dbstat` |
| DSH 侧 | `~/.dsh/profiles/desktop/cordis.patch.yml`、`~/.dsh/storages/session_projcache/sessions/*.json`、`~/.dsh/sessions/--E-Phaneris--/*/session.v4.jsonl.zstd`（多帧 zstd，逐帧解压后按 `step/start` / `assistant/message` 时间戳统计）、`resources/app.asar` 内 `dsh-llm-deepseek/lib/index.js` |
| 代码坐标 | 本仓库 `E:\Phaneris`，行号对应 0.4.0 构建时的 `codex/model-harness-implementation` 分支工作树 |

---

## 附录 C：关键代码坐标索引

| 主题 | 位置 |
|---|---|
| 每会话一个 Pi 子进程 | `packages/shared/src/agent/pi-agent.ts:264, 570-656` |
| 打包 bun.exe / 10.2 MiB bundle | `packages/shared/src/agent/backend/internal/runtime-resolver.ts:27-33` |
| reasoning 被丢弃 | `packages/pi-agent-server/src/transport-delta.ts:1-9`、`session-event-adapter.ts:48-52` |
| TTFT 把 reasoning 计入 | `packages/pi-agent-server/src/assistant-timing.ts:19-22` |
| 正文缓冲策略 | `packages/ui/src/components/chat/response-buffering.ts:15-26`、`TurnCard.tsx:2082, 2873` |
| thinking 只显示为 "Thinking..." | `packages/ui/src/components/chat/TurnCard.tsx:520-522, 601` |
| 标题请求抢首轮 | `packages/server-core/src/sessions/SessionManager.ts:7324-7325, 9300-9308` |
| blocked 会话拒收 | `SessionManager.ts:7120`、`durable-runtime/execution/host.ts:280` |
| 删除路径 | `SessionManager.ts:6886-6918, 6939`、`packages/shared/src/sessions/storage.ts:389-401` |
| 保留策略/VACUUM | `packages/server-core/src/durable-runtime/store.ts:259-261`、`api/runtime.ts:93` |
| DeepSeek thinking 参数（Phaneris） | `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:670-680`、`simple-options.js:23` |
| DeepSeek Messages 端点（DSH） | `app.asar → dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js:345, 430, 1719-1721` |
