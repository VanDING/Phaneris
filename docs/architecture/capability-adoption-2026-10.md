# 升级能力采用与运行约定

适用基线：Craft 上游 0.14.0 的既有吸收结果、Pi SDK 1.0.2、Phaneris 0.2.4。机制实施见 [批次记录](../process/capability-integration-2026-10-03.md)，原计划完整性、真实模型与补齐验收见 [闭合记录](../process/capability-completion-2026-10-04.md)，最新升级及全面替换条件见 [1.0.2 评估](../pi-sdk-1.0.2-upgrade-and-convergence-assessment.md)。这里区分产品实现、实测收益与条件式采用。

## 能力采用表

| 来源 / 能力 | 当前采用方式 | 入口与边界 |
|---|---|---|
| 上游 Session / Artifact / Workbench | 延续项目已有宿主、RPC、审阅与恢复机制 | Markdown 编辑继续使用 revision、lease、CAS；图像生成仍先提交 Artifact，再由用户接受 |
| Pi 输入接收确认 | 使用 SDK 的 started / queued / handled / rejected 结果 | JSONL 关联 inputId；原始输入先写 Durable，再请求 steer；等待有界 |
| Pi 模型元数据 | 内置 chat 目录使用明确的 builtin getter；保留图像限制、缓存、价格分层 | 内置、手动和自定义 endpoint 模型分别解析；同名模型按连接 provider 定位 |
| Pi 模型目录刷新 | 保留宿主现有刷新服务、Copilot 与自定义 endpoint 发现 | 离线 builtin 目录可用；手动模型保留。SDK 动态 provider 目前仅 Radius，随路由迁移一起暂缓；不会因初始化而读取另一套凭据或发起目录网络请求 |
| MCP 工具契约 | inputSchema、outputSchema、annotations、namespace、结构化内容贯穿代理链路 | annotations 不授予权限；大结果的模型预览与结构化值分别保留 |
| Pi tool_search / codemode | 主会话默认注册；MCP 工具按需发现 | 每个嵌套调用经过原生 hook、宿主权限、T1/T2；脚本的 `models` 全局关闭；辅助查询不注册编排工具 |
| Pi tool_call hook | 执行前检查确定性规则和失效来源 | 仅增加阻断，不能代替已有批准、参数变换和模式约束 |
| 决策辅助请求 | 已知会话所属请求独立记账；报告关联 outcome / follow-up | 功能仍 opt-in；失败、取消、未知价格单列；不替换活动会话 checkpoint |
| Pi classifier | 增加显式对照路径，保留默认 System One 适配器 | 本地 bool / choice 对照通过；score 分布、文本状态与结构化指令未等价，不自动替换 |
| Task 治理 | 辅助用量计入预算；预算观察写入运行日志；可选无进展上限 | 重启后沿用预算；不把编排会话运行前历史计入新运行 |
| Tiptap 3 Markdown | Artifact 无损往返后启用可视化编辑；按需加载 | 无法无损解析或加载失败时保留源码；表格、注释等复杂内容不会先被改写再回退 |
| Pi 图像限制 | 发送时按当前模型生成请求副本 | 原始文件与历史事实不改写；超过限制显式失败；完整历史请求仍由 SDK 检查 |
| Pi 图像生成 | OpenRouter 原生 `generateImages`；保留 OpenAI Images API | chat / image 目录分离；显式凭据；生成结果校验；生产调用不隐藏重试；停用会话取消在途请求 |
| Vite / Electron / Bun | 采用 ESM 配置路径、编辑器独立入口、独立 worker 与 WASM | 首屏预算未上调；打包资源独立验证，子进程在仓库外复核 |
| Sonner / i18n | 复用现有通知宿主与七种语言文案 | 图像恢复失败、Artifact 保存与冲突反馈可见，不增加第二套通知容器 |

## 输入接收与恢复

用户消息显示“已保存”或 SDK 的“已开始处理 / 已加入当前运行 / 已由扩展处理 / 未被接收 / 接收状态未确认”。`saved` 只证明宿主已保存；SDK `handled` 不证明模型读取。stdin 写入成功不能作为接收证据。steer 超时或传输退出返回 `unknown`，不自动重放；`rejected` 可沿正常消息队列处理。renderer 用 canonical ID 与 optimistic 别名关联，同文消息保持各自身份；迟到回执只更新状态，不重启已结束的运行。

原生诊断每次 provider 请求最多保留一个流包类型观察，并记录 SDK 选用的 provider / API / model。结束时额外保留可选 `responseModel` 与 `providerThinkingLevel`；缺失表示未知，不把请求档位冒充实际档位。原始流数据、文本、参数和错误正文不入此日志，身份字段限制为 256 字符的标识符。

历史图像过大时，界面的恢复动作创建一个关联原会话的纯文本会话，保留有界的文字上下文和文件引用。它不复制旧 SDK session、内联图像或自动发起付费请求。原会话仍是原始证据；文本摘要不能替代已省略的图片内容。

## 受管工具编排

MCP 来源通过原有 Source / MCPPool 连接。`tool_search` 提供按需发现，`codemode` 可组合调用、筛选完整结构化结果；工具输出契约包含 MCP content blocks 和 structuredContent。脚本没有宿主文件系统、网络或 Node 访问，外部效果只能经受管工具发起。

每个嵌套调用记录父调用 ID 和 ordinal，先提交 T1，观察到结果后提交 T2。取消时，仍在宿主或服务端执行的调用结果可能未知：保持待核对状态，不伪造 T2 失败，也不把整段脚本视为安全重放。成功的 `store()` 写入由 SDK session 分支持有，已验证切换分支后只读取该分支路径上的值；store 不代替外部效果日志。

工作空间可添加 `tool-call-rules.json`：

```json
{
  "version": 1,
  "rules": [
    {
      "id": "block-production-publication",
      "tool": "mcp__deployment__publish",
      "reason": "生产发布由用户单独执行",
      "when": { "field": "environment", "equals": "production" }
    }
  ]
}
```

工具名精确匹配 SDK 调用名称，`*` 匹配全部工具；`when` 只读取顶层字段，支持标量 `equals` 或字符串 `startsWith`。无匹配规则时继续已有权限流程。文件大小上限 64 KiB，最多 100 条规则；不合法的文件阻断工具，用户应直接修复配置。原有 AgentEvent 自动化动作尚无执行器，匹配会写入 `unsupported` 历史，并在界面标明未执行。

## 用量与任务预算

会话所属决策、生图请求使用独立隐藏 utility run，记录请求摘要哈希与用量；不污染聊天上下文。返回了 token 或费用后，即使图片验证失败，也保留已观察的用量。缺少价格时为 unknown，目录推算为 estimated；`costUsd` 是已知费用小计。Run 概览对未知费用显示“小计 + Unknown”，含估算时使用约等号。失败请求没有返回用量时，不能据此认定实际收费为零。

没有会话归属的设置测试等请求保留在决策报告，不人为归到某个工作空间会话。复核报告：

```sh
bun run decisions:report
```

Task 可在 `task.yaml` 顶层设置 `max_no_progress: 2` 至 `10`。连续失败验证的理由、失败节点和输出完全相同时，达到上限终止循环；未设置时维持既有行为。它不根据工具调用频率判断停滞。`token_budget` 包含子会话、验证及其辅助请求；运行日志保存累计观察与已用预算，恢复不会清零。已有会话复用前的用量作为运行基线排除。旧日志没有新增用量观察时，不具有同样的跨重启预算证据。

## 图像与 Markdown 约束

OpenRouter 生图仅接受 SDK image 目录里的模型，默认 `google/gemini-2.5-flash-image`。当前原生适配器不支持显式 size、quality、background 或 WebP 转换，遇到这些参数在网络调用前拒绝；需要这些控制时选择支持相应参数的 OpenAI API-key 连接。ChatGPT OAuth 不能充当 Images API key。每次 Artifact 操作只接受一张内联图片，校验编码、类型与大小，提交审阅后才可落到最终路径。

Markdown 可视化编辑只有在初次序列化保持源码时才解锁。源码编辑始终保留受控草稿；CAS 保存失败不会清空草稿。新编辑 lease 会快照先前的外部 checkout 改动，避免用户退出再编辑仍拿到过期 revision。中文文本插入与撤销已验证；真实操作系统 IME、触摸设备和全部复杂语法组合没有据此宣称通过。

## 条件式迁移结论

| 方案 | 结论 | 再评估所需证据 |
|---|---|---|
| Pi 原生 MCP 取代 MCPPool | 完成单 Source 对照，全面替换暂缓 | 真实 HTTP + Pi 原生扩展已证明可通过注入配置与凭据，保留宿主 Source 单一所有权；结构化结果、撤销和 8 个并发请求通过。远程 OAuth、重连恢复和稳定性能收益尚无证据，不能由一个回环样本推出全面替换 |
| Radius / 虚拟路由默认启用 | 暂缓 | SDK 存在独立动态目录与路由选择。需要逐项记录候选、实际 provider/model、路由分类费用、回退和预算，明确凭据与批准边界；尚无迁移性能或真实成本对照 |
| Pi classifier 默认替换 | 暂缓 | 保留既有 noul / bool / choice / score 契约、完整概率分布、文本及结构化状态；用代表性业务样本比较结果、失败策略和总费用 |
| 更多 Task 节点与控制结构 | 暂缓 | 当前仅实现 session 节点语义。条件、循环、聚合、缓存、审批、复制等仍在执行前显式拒绝；需独立的恢复、幂等与预算验证后增加 |

这些结论完成了规划要求的条件评估，不表示所有 SDK API 都应该进入默认产品流程。

## 实测收益与代价

2026-10-04 在 Pi 1.0.0 下使用用户指定的 `deepseek-flash`、关闭 thinking，对同一个中文任务、三个合成 Source、72 个工具进行一次成对对照。两条路径都实际读取六组证据并生成带 `source://` 引用的 Markdown 文件。这里的 schema 为发送的 JSON 字节数，不是 token；费用使用实际返回的 token 与目录峰时价格估算，不是账户账单。升级 1.0.2 后未重放付费请求，这些数据保留其原版本范围。

| 指标 | 全部工具直接暴露 | 按需发现 |
|---|---:|---:|
| 首轮工具 schema | 72,493 B | 11,851 B（减少 83.65%） |
| 各轮 schema 合计 | 144,986 B | 133,993 B |
| 实际模型请求 | 2 | 4 |
| 首次业务工具 | 2,781.88 ms | 6,208.54 ms |
| 完成耗时 | 5,077.35 ms | 9,208.46 ms |
| token 对应费用估算 | 0.006970008 USD | 0.006084264 USD（减少 12.71%） |
| 六组来源与报告 | 通过 | 通过 |

这是一个样本，含不同缓存命中状态与本地转发开销，不能推广为所有任务的稳定比例。按需发现降低首轮上下文占用，但本样本多了两次模型往返，延迟增加。单独的 codemode 样本加入显式批量指令，完成 `tool_search → tool_search → codemode → 六个嵌套调用 → 报告`；它与成对样本输入不完全一致，且有一次流失败未返回用量，只证明受管组合执行可工作，不用来宣称成本优势。

真实调用累计 14 次，其中 13 次返回用量：已知费用估算 0.017655468 USD；一次费用未知，保留 0.0171699 USD 预留额，合计占用 0.034825368 USD。账本跨重跑累计，未超过 16 次 / 0.10 USD 约束，未知请求未被算作免费。价格口径见 [DeepSeek 官方价格说明](https://api-docs.deepseek.com/quick_start/pricing/)，测试显式禁用默认推理，见 [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)。

全部 13 个决策功能覆盖 15 个实际产品检查点，分别走正常、低置信度和 HTTP 故障路径，共 45 个用例，另验证报告关联、follow-up、状态摘要与未知费用，共 46 项。原生 classifier 对请求形状的适配结果为 12 个支持、3 个不等价；score 概率分布、自由文本状态和结构化指令仍使用原有适配器。

真实 DeepSeek 的 15 个合成业务样本中，简化语义标签对照为 14/15；差异来自 Guarded 的 `outside_workspace` 标签，原有权限路径仍提示用户。直接要求完整 System One 响应时，仅 3/15 满足全部概率、置信度和结构契约，强化提示的另一次请求返回无效 JSON。因此没有添加伪造置信度的适配器，也没有默认切换 classifier。这些参考标签由 agent 为固定验收语料整理，不是人工标注的生产样本；人工纠正率、原生模型质量与每项实际延迟没有足够数据，留空。

复核文件位于 `.cache/capability-integration/`：`multi-source-comparison.json`、三个 `multi-source-*.md`、`live-deepseek-budget.json`、`decision-features.json`、`decision-chat-reference-first.json`、`decision-semantic-reference.json`。付费样本单独保留，本地验证不重放付费请求。

## 版本、证据与回退

以下版本来自当前安装和锁文件；回退保持用户历史与持久执行事实，不通过重放未确认的外部效果恢复。

| 能力 / 版本 | 状态与产品入口 | 证据与收益 | 回退方式 |
|---|---|---|---|
| Craft 0.14.0 / Phaneris 0.2.4 宿主 | 已整合会话、Artifact、日历与表格 | production workflow 检查同一 Session 的 ID、标题、日期、状态和进度；保持单一事实来源 | 回退视图映射；保留 Session、revision、lease 与 CAS |
| Pi 1.0.2 输入与原生观测 | 消息接收状态、JSONL inputId、SDK 诊断 | SDK workflow 与回执 UI；同文消息、迟到回执、实际模型与未知推理档位有明确语义 | 关闭新增显示或诊断；保留已写入的宿主输入与回执事实 |
| Pi 1.0.2 模型元数据 | builtin 目录、连接目录、图像请求副本 | 离线目录与 SDK 模型断言；移除旧 DeepSeek 目录注入补丁 | 保留手动 / endpoint 模型入口；版本整体回退时同步 SDK 与打包资源 |
| MCP SDK 1.32.0 / Pi 1.0.2 | 完整工具契约、按需发现、受管 codemode | 单 Source 原生 HTTP 对照 5/5、8 个并发请求、成对真实任务；修复无状态 transport 跨请求复用 | Source 可选 direct 暴露；暂停编排需回退资源加载与桥接整体，保留 T1/T2 和未知效果 |
| Pi 1.0.2 决策与 Task | 各项 opt-in、Run 用量、Task 可选 `max_no_progress` | 13 功能 / 46 项、classifier 形状对照、重启预算；原有批准路径未迁移 | 关闭对应功能开关；移除可选无进展参数；保留用量及运行日志 |
| Tiptap / Markdown 3.31.4 | Artifact 可视化与源码编辑 | 5/5 E2E；混合中文、公式、Mermaid、注释等保存 / 提交 / 接受逐字保留，修复初次归一化丢字 | 使用源码入口；保持草稿、revision、lease、CAS 与审阅流程 |
| Pi 1.0.2 图像能力 | 原生 OpenRouter 生图、现有 Images API、历史图像恢复 | 5/5 离线工作流；请求副本、用量、取消、输出校验 | 选择现有 OpenAI Images API 或停止生成；不改写原图与历史 |
| FullCalendar 7.1.0 | 日历使用 Session 规划事实 | 与表格 / Task RPC 同事实 E2E，稳定 `data-calendar-entry` 验证入口 | 回退展示层；不新增独立任务数据副本 |
| Vite 8.3.2 / Electron 44.5.1 / Bun 1.4.2 | 三个入口原生 ESM 配置、生产构建、子进程 worker 与 WASM | 首屏初始 JS 4,267,991 B，原 4.8 MB gate 未提高；本机长会话预算与 Windows 解包验证 | 同步回退锁文件、运行时与全部子进程资源，避免版本混装 |
| Renderer 图标加载 | 按工作空间 / 文件共享在途读取与目录发现；采用宿主 Skill 发现结果 | 生产启动 E2E：同文件成功读取 8 → 1 次，两次导航图像 RPC 296 → 40，无效 Skill 探测 200 → 0；Source / Skill / Status 清理同步失效 | 可回退共享索引与预取条件；保留原成功缓存、失效入口与图标优先级 |
| Sonner 2.0.8 / 七种语言 | 复用通知宿主与恢复 / 冲突反馈 | 现有 Toaster、i18n gates 与实际 UI 工作流 | 回退新增反馈文案 / 入口；保留原通知宿主 |

首屏基线 4,967,600 B，本轮为 4,267,991 B，减少 14.08%。长会话预算是本机合成工作负载的回归门限：导航与冷打开 3,000 ms、暖切换 2,000 ms、输入至两个动画帧 250 ms、首个实时增量 1,500 ms、renderer heap 256 MiB、backend RSS 1,024 MiB。原始单次数据、搜索 / 引用 / 复制 / 实时合并与日历 / 表格截图保留在 performance 报告；这些不等同于所有硬件的承诺或 Electron 原生启动测量。

## 保留兼容层与退出条件

| 兼容 / 策略 | 当前负责位置 | 退出条件 |
|---|---|---|
| 退役模型与别名过滤 | shared/config/models-pi | 上游目录与用户目录策略不再需要隐藏；不注入模型替代物 |
| OpenAI / OAuth / custom endpoint 连接解析 | shared backend driver 与宿主 Vault | 原生 Models 凭据接口满足连接隔离、远程服务端归属及现有迁移语义 |
| utility 的 compat streamSimple | Pi 子进程及 Durable 请求包装 | 原生 Models 调用证明全部辅助请求 T1/T2、取消、provider 兼容和用量等价后移除 |
| 宿主系统提示与原生 tool hook 桥接 | Phaneris resource loader | SDK 公开 API 可保持宿主提示、权限与工具可见性边界；不恢复私有字段覆盖 |
| Markdown 源码回退 | Artifact editor | 代表性复杂文档能无损往返，再扩展可视化支持；不批量改写旧文件 |

## 复核

```sh
bun run verify:capabilities
bun run validate:ci
bun run test
bun run electron:build
bun run bundle:report --check
```

`verify:capabilities` 顺序运行本地 SDK、回执 UI、实际原生 MCP transport、全部决策检查点、任务、图像、Artifact、分支和生产 WebUI smoke，输出 `.cache/capability-integration/summary.json`、分项 JSON、日志和截图。summary 记录工作树与 Pi bundle 哈希；13 个 stage 使用回环 provider 和隔离目录，不发起真实付费请求。

真实模型脚本为 `multi-source-comparison-workflow.ts --live`、`decision-feature-workflow.ts --live` 和 `decision-chat-semantic-workflow.ts --live`；先获得该模型的调用授权。共享 ledger 跨重跑累计，最多 16 次请求、0.10 USD 估算上限，未知费用保留预留额。未经新的预算授权，不清空 ledger 重新测试。真实样本记录不代替发布签名、安装更新、OAuth 与其他操作系统验收。

生产 WebUI 性能复核使用 `scripts/performance/run.ts`。Windows 若没有 Playwright 自带 Chromium，可将 `PHANERIS_TEST_BROWSER_CHANNEL` 设为 `msedge`。打包结构脚本的 `--unpacked-only` 只检查解包资源，不证明安装、升级或签名。

独立 Server 分发脚本同步构建并复制 Pi launcher、worker 和 WASM；其目标平台仍为 macOS/Linux。这次 Windows 本地验证不替代目标平台的分发运行验证。
