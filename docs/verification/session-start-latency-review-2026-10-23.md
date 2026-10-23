# 会话等待与停摆：六个现场及外部分析复核

日期：2026-10-23，时间均为 Asia/Shanghai。调查分支：`codex/model-harness-implementation`；调查时源码 HEAD：`674c9de02`。这是该时点的诊断结论；后续修复与验收见[实现记录](conversation-start-fix-2026-10-23.md)，下文现场与旧行为仍按调查时点描述。

输入：用户指定的六个会话，以及[用户提供的分析](session-start-latency-investigation-2026-10.md)。只读检查真实会话日志、Runtime SQLite 和客户端配置；另用真实 Pi 子进程、Runtime Host、SQLite 与本地 SSE 服务验证当前传输行为。没有修改用户连接、思考级别、会话或 Runtime 数据，没有向线上 provider 发起试验请求。

## 1. 结论

**这是多种问题叠加，不能归结为 TTFT，也不能统一解释为排队或网络。**

1. **分钟级无正文已证实。** `young-orbit` 的主请求约 1.85 秒就进入 SDK payload 回调，约 6.07 秒收到首个输出，之后直到请求运行约 212.87 秒被中断都没有正文。落盘保留 107,033 字符思考。`ready-silver` 也有两次约 182 秒、150 秒后才出现正文的请求。
2. **思考活动在传输层丢失已证实。** 当前子进程只转发正文增量。模型已经输出的思考不能形成宿主的流式活动反馈；TTFT 却把思考计作首个输出。因而看似健康的 2.8 秒 TTFT，可以对应实际约 182 秒的无正文等待。
3. **另有真实工具悬挂及会话阻塞。** `ready-silver` 的浏览器批次约 191.55 秒未结算，停止后留下 `effect_pending`，run 进入 `recovery_parked`。其间一条用户消息确实标记为 `queued`。这已经超出显示问题，属于执行与恢复问题。
4. **为何 Phaneris 更容易产生超长思考，尚无完成因果验证的答案。** prompt、工具集合、供应商路由、API 协议与输出预算均是待控制的变量。不能把“换成 Anthropic API 就会解决”或“关闭 max 就会解决”写成已确认结论。

**对所提供分析的总体评价：时间线和源码发现有重要价值；将 API 差异定为决定性根因、全面排除网络/排队，以及若干缓存与恢复结论，超出了证据。应保留现场，修正归因。**

## 2. 最新两例

这里的“请求开始”是 SDK `onPayload` 回调，不是 socket 写出的硬件时间；“首输出”可能是思考、正文或工具调用，不等于用户看到文字。历史记录没有 renderer 首次绘制时间。

### 2.1 young-orbit：已开始推理，213 秒没有正文

| 事件 | 本地时间 / 耗时 |
| --- | --- |
| 用户消息 | 00:54:42.229，接收状态 `started` |
| 主请求 T1 | 00:54:44.068，距消息约 1.839 秒 |
| SDK payload 回调 | 00:54:44.074，距消息约 1.845 秒 |
| HTTP 200 响应头 | payload 后约 5.960 秒 |
| 首输出 | 00:54:50.146，SDK 延迟约 6.072 秒 |
| 中断完成 | 00:58:16.939，距消息约 214.710 秒；请求约 212.865 秒 |
| 正文 / 工具 | 正文 0；工具派发 0 |
| 思考 | 107,033 字符，来自 SDK journal 的 thinking block 计数，不公开其内容 |
| 当前 run | `checkpoint`；未发现该会话的待结算工具 |

不能将这 213 秒解释为本地一直没有派发，也没有证据说它被 ready-silver 的浏览器占住了全局队列。已经收到的思考与 HTTP 200 是强反证。但历史日志未保存逐 chunk 到达时间，不能据此排除流中夹杂的网络停顿。

### 2.2 ready-silver：先长篇思考，后浏览器不结算

| 主请求 | 首输出 | 首正文 | 请求总耗时 | 思考字符 |
| --- | ---: | ---: | ---: | ---: |
| 00:32:29.857 | 4.211 秒 | 6.870 秒 | 7.263 秒 | 1,878 |
| 00:34:13.332 | 20.960 秒 | 21.077 秒 | 21.081 秒 | 218 |
| 00:35:05.683 | 2.797 秒 | **181.896 秒** | 185.587 秒 | **110,675** |
| 00:43:33.740 | 9.115 秒 | **150.145 秒** | 151.393 秒 | **81,470** |

第一轮用户消息为 00:32:27.262，所以 7.263 秒是请求耗时；消息到第一段正文约 **9.465 秒**，不能把二者混用。

182 秒正文等待的请求，HTTP 响应头约 2.757 秒到达，输入为 **666 + 32,256 cacheRead = 32,922 token**。该请求输出 28,498 token，其中 reasoning 27,556。说明长上下文和缓存未命中都不是分钟级思考的必要条件。150 秒正文等待的请求输入为 **120,101 token**，也不是到达模型 1M 窗口才发生。

后段存在独立故障：

| 事件 | 证据 |
| --- | --- |
| 00:54:58.035 | 浏览器工具 T1 已提交 |
| 对应批次 | `screenshot-region --selector #result --padding 8; screenshot-region --ref @e2 --padding 6; window-resize 1280 720` |
| 00:55:04.529 | 新用户消息进入 `queued` |
| 00:58:09.589 | 停止后记录 `Run stopped with an unsettled tool effect`，进入 `recovery_parked` |
| 00:58:09.617 | SDK journal 落下 `Durable run … still has 1 unsettled tool operation(s)` 错误 |
| 当前工具状态 | `toolop_be44b22ff19c9cf33b59ad2cebab2cd5`，`effect_pending`，`settled_at=null`，`never_auto_retry` |

该批次的 T1 已在取得调度资源、通过 preflight 后提交，故不能把这 191 秒直接归因于新调度器等待获取锁。没有子命令级 trace，尚不能确定卡在两个区域截图中的哪一步、CDP、Electron capturePage，还是浏览器 RPC。当前代码直接 await 原生 `capturePage`；浏览器工具到宿主的终止、迟到结果与 Runtime 对账需要一起验证。

源码会阻挡未完成 reconciliation 的会话继续接收新轮次；现场确认有一条排队消息及一个停摆 run，**没有把“此后每一次发送都被拒”当作已观测事实**。同样不能把 `young-orbit` 的 checkpoint 与此例的 recovery_parked 混为一谈。

## 3. 对提供分析的逐项裁定

| 原分析判断 | 复核结果 |
| --- | --- |
| R1：Phaneris 和 DSH 是同供应商域名、不同 API，因此 API 是决定性根因 | **归因不成立。** 最新两例的会话 connection 都是 `pi-api-key`，SDK provider 为 `custom-endpoint`；本机该连接配置是 `https://opencode.ai/zen/go/v1`。报告列举的 `pi-api-key-2 / https://api.deepseek.com` 属于另一条连接。旧例 misty-horse 确实走 DeepSeek 原生 provider，因此两条路都出现过长篇思考。历史未保存每次请求 URL，不能将当前配置冒充历史抓包，但更不能忽略会话连接与 SDK provider 的明确区别。 |
| “思考量最大值差 9 倍”，因此由 API 导致 | **最大值之比不是因果效应。** 任务、prompt、工具、历史、缓存、输出预算、路由均不等条件，135 步与多个会话的极值也不是同一抽样口径。两协议的参数表达不同值得试验，不能据此断定后端思考预算不同。 |
| `max` 导致长篇思考“不成立” | **应改为：max 不能单独解释客户端差异。** OMP 的真实记录和 DSH 配置都能确认 max，排除了“对照一定关闭思考”的假设；但这不能排除 max 与上下文/工具的交互效应。 |
| R2：固定 prompt/工具负担大 | **方向成立，精确倍率和耗时归因需收紧。** young-jasmine 首次输入实测 28,943 token；ready-silver 首次 30,672 token、61 个工具。回环捕获当前 60 个工具的实际 wire JSON 约 82,544 字节。按字符估算的“7K + 20.6K token”不是 provider 分项 token 实测，不能将倍率当精确测量。 |
| “响应头前 1–10 秒 = prefill” | **只能称响应头前等待。** 包含本地 SDK、连接、网络、网关调度和模型准备，现有日志不能拆分成纯 prefill。ready-silver 的第三个短输入请求还出现约 21 秒首输出，不能全面排除 provider/网络影响。 |
| “工作目录在 system 尾部不同，所以首轮跨会话缓存跨不过去” | **未证明。** 尾部变化不等于前面共同前缀全失效；tools 顺序变化、缓存路由和失效策略需要实际对照。一次 cacheRead=0 不能推出所有跨会话缓存必失效，也不能由 JSON 字段顺序推定 provider 内部 token 排列。 |
| R3：thinking_delta 被过滤，TTFT 却计入思考 | **已确认。** 源码与真实 Pi/Host 回环一致。界面可能有通用忙碌提示，但没有来自这些思考增量的阶段反馈。 |
| “用户在 young-jasmine 第 8.6 秒看到首字” | **应称约 8.534 秒到达首正文回调。** 缺少 renderer 绘制时间，不能据服务端时刻声称用户已经看到。 |
| “UI 正文最多缓冲 2.5 秒” | **不是硬保证。** 超时分支仍要求至少 5 词；当前按空白分词，中文短句可能只有 1 词。`TurnCard` 的 memo 依赖文本/流状态/开始时刻，没有单靠时间到达触发它的定时器。流无新文本时，2.5 秒不保证自动刷新。完成态立即放行。 |
| R4：stream idle timeout 缺失、静默重试造成这些分钟级等待 | **是待补的健壮性问题，未证实为本批长请求原因。** 这些请求有首输出、大量思考、一次 payload/response 回调与 HTTP 200；没有观测到将它们解释成 provider retry 的证据。回调次数本身也不是物理网络尝试次数。仍在输出的长思考不会由“无 delta 超时”解决。 |
| R5：1M 窗口使自动压缩触发过晚 | **默认口径基本成立，但不是唯一机制。** 应用已支持独立 `compactionThresholdTokens`；本机全局/工作区未配置，null 回退 SDK reserve，再由窗口减 reserve 触发。不是不可配置，也不是单凭 contextPolicy 名称就有低阈值。压缩会改变上下文，应按任务质量和有效历史成本选阈值。 |
| R6：ready-silver 被未结算工具阻塞 | **已确认，需列入最高修复优先级。** 快照时全库 65 个 recovery_parked、218 条 effect_pending 是积压事实；“永远不结算/全部废掉”并未逐一验证。保护未知副作用的 parked 状态有其必要性，缺陷在可终止性、证据获取和恢复闭环。 |
| 1.73GB 数据库使 T1 越来越慢，因此造成数分钟不开始 | **没有对应耗时证据。** T1 等待确实在关键路径；最新两例已在约两秒完成首次派发。文件大小不能直接替代提交/锁等待测量。freelist 为 0 时 VACUUM 不会凭空清除有效数据。不可直接按年龄删除 T1/T2、usage 与恢复依据。 |
| R7：冷启动成本 | **存在，但解释的是秒级。** 实际 Pi 回环有冷/暖差异；真实会话的本地前置还包括决策、配置、资源与持久化，不能把“发送到 payload”全记为子进程启动。ready-silver 首轮有一笔 awaited decision，以及标题 gpt-6-luna 失败后回退的辅助流量。影响分钟级思考的因果关系仍未量化。 |
| 全面排除排队、网络、缓存预热 | **范围过宽。** 新会话跨会话全局阻塞不是这两例的分钟级解释；ready-silver 却明确存在会话内排队。全局 promptCacheWarming 实际开启，不能仅凭代码默认 off 宣称关闭；它也不能解释新会话第一次输出前全部等待。 |
| 只换一次端点，若变快即证明 API 根因 | **实验判据不充分。** 单次生成有随机性；切换协议也会改变参数序列化和兼容层。需重复、交错顺序，并控制工具/prompt/历史/缓存/预算。用户当前出问题的 Go 路由还应独立于 DeepSeek 直连试验。 |

附录删除分析也应保留为假设：源码确实吞掉文件删除异常，浏览器销毁晚于磁盘删除；但删除前已有 `disposeManagedAgentResources()`。因此不能只凭子进程初始 cwd 就确认删除时它仍存活并持锁。本次未复现、未删除该目录，也没有将其认作分钟级请求等待的原因。

## 4. 可以确认的系统机制

- `packages/pi-agent-server/src/transport-delta.ts`：只转发 `text_delta`；`session-event-adapter.ts` 对 message_update 过滤后直接返回。此前以降低流量为目的的压缩丢掉了活动语义；其提交为 `b767229da`，早于本轮 harness 分支。不能据此断言本轮更新完全无回归，但不能把旧行为误记为这次新增。
- `packages/pi-agent-server/src/assistant-timing.ts` 与 `packages/core/src/utils/assistant-timing.ts`：v2 指标首输出含思考/工具，正文单独记录。`trajectory-performance.ts` 展示会话 P50。frosty-creek 的 207 条有效记录按产品口径 P50 为 **12,965.041ms**，首次请求为 **4,705.436ms**；提供分析中的 13,051ms 不是这组产品样本的 P50。
- `packages/ui/src/components/chat/response-buffering.ts`：存在最短缓冲、词数条件和中文分词问题；这只能放大已有正文的等待，不能解释正文为零的前三分钟。
- `packages/server-core/src/sessions/SessionManager.ts`：发送前检查 blocked，主轮次前可等待 preTurnDecisions；标题启动与主请求重叠。`durable-runtime/execution/host.ts` 在 parked 后阻止队列继续，不会自动把未知浏览器效果宣告失败。
- 当前自定义 OpenAI 兼容模型只保留有限 compat 信息。回环中 max 发出 `reasoning_effort=max`、`max_completion_tokens=384000`；off 没有 `thinking` 或显式 disable。原生 OpenCode DeepSeek 控制路径则发 `thinking.enabled` 和 `max_tokens`。这是兼容语义差异；**不等于已证明 Go 忽略 off，也不等于已证明 384000 导致长思考**。
- 当前实际自定义 Go 请求带稳定 `x-opencode-session`，两轮相同，故“缺会话头”已由请求捕获推翻。Pi coding-agent 的 `provider-attribution.js` 按 URL 主机也添加该头，而非只看 provider 名称。

本轮此前的 harness 验收覆盖了调用契约、工具排序、prompt 组装与任务连续性，未覆盖线上模型分钟级 thinking-only 流的客户端反馈，以及原生截图悬挂后的恢复。此次现场说明这两条验收链需要补上，不能用既有检查通过来声称启动体验已解决。

[DeepSeek 官方说明](https://api-docs.deepseek.com/guides/thinking_mode/)将 OpenAI 与 Anthropic 格式的开关/effort 作为两种参数表达，并说明 OpenAI 格式默认启用思考；这支持显式保留 off 语义的要求，不支持“相同 max 在两个 API 必然是不同预算”的结论。[OpenCode Go 文档](https://opencode.ai/v2/docs/console/go/)要求稳定会话头以优化路由和缓存；本项目当前捕获已经满足这条要求，不能用文档中其他客户端的缺陷替代本项目的证据。

## 5. 修复与验证顺序

实现依据：[2026-10-23 先行失败矩阵](conversation-start-fix-failure-matrix-2026-10-23.md)。

| 顺序 | 要解决的行为 | 验收证据 |
| --- | --- | --- |
| P0 | 模型活动到 UI 的反馈断层 | 请求已发、等待服务端、正在推理、工具执行、排队与恢复阻塞分开；通过内容无关且节流的活动事件传递思考状态，不为此重新传送整个累计 partial 或强制展示全部思考。真实客户端 thinking-only 流、取消和终态均可见。 |
| P0 | 浏览器悬挂与停止后的恢复 | 按子命令记录开始/完成；为 RPC/CDP/capture 的执行、取消、迟到结果建立闭环。复现该截图批次，验证停止后已知结果可结算，未知效果保留并提供可执行的核对入口；队列明确告知为何不能继续。禁止简单清掉 pending 或盲目重放。 |
| P1 | 无从区分本地耗时、provider 等待与无正文思考 | 记录 admission→agent ready→T1→payload→headers→首输出→首正文→客户端显示；取消保留已观测指标。兼容旧 TTFT，界面明确统计范围，不把 P50 当首次请求。 |
| P1 | 超长思考的因果定位 | 在隔离诊断配置中做两组控制：同一路由比较 Phaneris/精简 harness；同一 harness 比较 OpenAI/Anthropic。固定输入、历史、工具、max、输出预算、实际模型与认证，交错重复，分别记录缓存冷热、reasoning token、首正文和完成时间。Go 路由独立记录。不是更改用户生产连接试一次。 |
| P1 | 固定开销与中文正文缓冲 | 量化每类工具/prompt 的成本后做最小充分曝光，保持可发现性；去掉无助于任务的重复规程。正文按时间和中文字符也可放行，超时刷新有真实定时驱动。skill 继续默认不发现、不主动启用。 |
| P2 | 冷启动、辅助请求、上下文与数据库 | 先减少首轮重复初始化和不必要辅助请求，再评估预热/常驻成本；独立配置有效压缩阈值并验证任务连续性。先测 T1/提交/锁等待和索引，再设计不破坏恢复语义的归档、备份轮转；不以 VACUUM 代替逻辑治理。 |

不能承诺只显示思考就会变快；也不能承诺只切 API 就会消除分钟级等待。当前可以直接修复的，是活动反馈缺失、正文缓冲条件，以及工具停止与恢复闭环。超长思考的产生机制需要上表的对照证据。

## 6. 复核产物及限制

新增只读导出入口：`scripts/verification/conversation-session-audit.ts`。通过环境变量指定工作区、日期前缀和会话列表；索引查询 `runtime_events`，只输出时间、状态、计数、模型参数与 usage，不导出用户文本、系统 prompt、思考正文或凭据。会话文件有 SHA-256；不对 1.73GB 活跃数据库做全量 hash。

```powershell
$env:PHANERIS_AUDIT_WORKSPACE='C:\Users\dotty\.phaneris\workspaces\Work'
$env:PHANERIS_AUDIT_PREFIX='261023-'
$env:PHANERIS_AUDIT_SESSIONS='261023-ready-silver,261023-young-orbit'
bun run scripts/verification/conversation-session-audit.ts
bun run scripts/verification/conversation-startup-diagnostic-workflow.ts
```

本次新样本证据：`.cache/verification/conversation-session-audit-AeMFXu/`；旧四例与 21 会话首请求样本：`.cache/verification/conversation-session-audit-WIX7s6/`；真实 Pi/Host 回环：`.cache/verification/conversation-startup-diagnostic-OYksYs/`。各有 manifest、产物哈希和未测范围，可由 `verification-artifacts.ts --verify=<目录>` 检查。

回环强制发送约 0.8 秒的思考片段再发正文，只用于证明当前事件过滤与请求参数，不估计真实 provider 延迟。两个级别都收到 fixture 思考是 fixture 的规定行为，不能用来证明真实 provider 忽略 off。冷轮约 1.108 秒到请求、暖轮约 0.288 秒，未经过完整 SessionManager，因此不替代生产启动分解。

历史 provider 观测是 SDK callback，不是抓取 socket、原始 HTTP 请求头或每个 chunk 的网络 trace。旧日 4 条 native DeepSeek 与 17 条 custom endpoint 首请求中，首输出 P50 分别约 1.039 秒、5.455 秒；不同任务/时段/连接，只有观察价值，不能当随机对照。是否“更新后更频繁”也不能由这两个新样本计算：缺少相同任务、模型和时段下的前后发生率。

调查阶段未做线上 API A/B、未复现原生截图悬挂、未修改产品代码或用户数据。后续源码修复另见实现记录。**已经确认故障形态与修复边界；API 是否构成超长思考的主要诱因仍未定案。**
