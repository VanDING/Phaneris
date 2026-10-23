# 六个 Harness 的设计取舍与 Phaneris 改进方向

Status: proposed — source comparison and local adapter probe completed; recommendations are not implementation approval or measured model-quality gains.

日期：2026-10-23，Asia/Shanghai。Phaneris 基线：`main`，`df397f88025231d8494f56d6555a271bab0b71e4`，Pi SDK 为 `1.3.0`。本轮仅分析与生成研究材料，未修改产品实现、用户设置、连接或历史会话。

## 1. 核心判断

**Phaneris 应当让主模型获得清楚的目标、真实的能力、可追溯的证据和可靠的行动反馈。执行保障可以很强，产品能力可以很多；模型解题过程中的额外干预，应有明确任务依据和可验证收益。**

六个项目并没有证明“短 prompt、少工具、没有辅助模型”是一条通用答案：

- Pi 选择较小的默认内核，把较多工作方式留给扩展。
- OMP 选择强工具、强指导和丰富扩展，还提供 advisor 与流式纠偏。
- DSH 选择完整的插件化组合，连 loop、工具系统和 prompt 服务也可替换。
- OpenCode 选择 provider/model 适配、显式 agent 角色和插件钩子。
- Claude Code 可见资料体现动态能力、上下文整理和模型主导的执行循环。
- Codex 把模型能力、工具暴露、上下文状态、执行监管和产品接入分层处理，内部并不简单。

**它们最值得学习的是职责与接口的取舍，不能把各自的功能、提示词和监管机制累加成我们的新默认。**

对 Phaneris 最直接的启发是：在已经稳定的 Pi 执行机制和 durable runtime 上，减少重复加工、悬空能力和无关常驻说明；把研发投入转向工具可用性、错误反馈、原文恢复和真实任务质量。

## 2. 材料、版本与结论边界

### 2.1 固定源码快照

| 项目 | 本轮默认分支 | 固定 commit |
| --- | --- | --- |
| Pi | main | [42cb822f1c5d](https://github.com/earendil-works/pi/tree/42cb822f1c5d3153069dd0661bfd297424666cf1) |
| OMP | main | [0b5c27ab2471](https://github.com/can1357/oh-my-pi/tree/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0) |
| DSH | master | [687f282e8625](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317) |
| OpenCode | dev | [4d30794bcf4d](https://github.com/anomalyco/opencode/tree/4d30794bcf4dccdcadbcb1f62bb35b4943a96426) |
| Claude Code 恢复仓库 | main | [3b0498a6c684](https://github.com/oboard/claude-code-rev/tree/3b0498a6c684683161077f3c6c5097c6d37cc882) |
| Codex | main | [d6817454d768](https://github.com/openai/codex/tree/d6817454d76885e9d0e118bbf82e507aed6f715a) |

这些是本次研究快照，不代表用户安装版、稳定发布版或某次过去会话的实现。Pi 上游快照与 Phaneris 安装的 SDK 也不能无条件等同；涉及我们的实际路径，另核对了本地 `node_modules` 的公开类型和当前适配器。

本轮对 prompt、loop、工具暴露、结果处理、上下文和介入边界做定点源码审查，不是逐文件审计六个仓库。34 个核心源码/配置/说明文件另存于被 Git 忽略的 `.cache/harness-research-2026-10-23/sources/`；三个 `source-manifest-*.json` 记录固定 ref、路径和 Git blob SHA，`cache-integrity.json` 记录缓存 SHA-256。34 个缓存文件均通过对应 Git blob SHA 校验。其他在线读取材料作为补充参照。

Claude 恢复仓库的 README 明确说明存在 source-map 缺口、兼容 shim 和降级实现。因此本文把它用于观察可见结构，不把其中每个分支当成官方当前线上行为；主循环的一般职责和 MCP 发现机制另用官方资料交叉核对。[恢复说明](https://github.com/oboard/claude-code-rev/blob/3b0498a6c684683161077f3c6c5097c6d37cc882/README.md#L8-L31)、[Claude Code 官方工作原理](https://code.claude.com/docs/en/how-claude-code-works)、[官方 MCP 说明](https://code.claude.com/docs/en/mcp)。

本轮没有运行六个产品的同题线上对照，没有调用付费模型，没有验证各项目 README 中的 benchmark 数字。用户已确认的相同模型作为比较前提，不重新用模型名称解释已观察到的差异。

## 3. Pi：一个可组合的执行内核

### 设计与取舍

Pi 的基础价值在于闭环：接收输入 → 组装上下文 → 模型输出 → 工具执行 → 结果返回 → 后续推理。`agent-loop.ts` 在工具批次后检查 steering，在自然停止边界检查 follow-up；提供 `transformContext`、`beforeToolCall`、`afterToolCall` 等扩展点。[主循环](https://github.com/earendil-works/pi/blob/42cb822f1c5d3153069dd0661bfd297424666cf1/packages/agent/src/agent-loop.ts#L185-L319)。

Prompt 根据 selected tools 生成对应指导，并把项目上下文、skills、工作目录、额外 sections 分开组装。工具指导会去重；没有当前工具时，不必保留对应操作说明。默认 coding tools 的工厂是 read/bash/edit/write，同时另有 grep/find/ls 等定义和只读工具组合。这是默认组合，不是整套 Pi 永远只有四个工具。[Prompt 组装](https://github.com/earendil-works/pi/blob/42cb822f1c5d3153069dd0661bfd297424666cf1/packages/coding-agent/src/core/system-prompt.ts#L88-L192)、[工具工厂](https://github.com/earendil-works/pi/blob/42cb822f1c5d3153069dd0661bfd297424666cf1/packages/coding-agent/src/core/tools/index.ts#L195-L210)。

大文件读取采用范围读取与确定性截断，明确提供下一次 offset。工具错误和结果覆盖范围成为下一步行动的信息，而不需要先让一个摘要模型判断哪些内容有意义。[Read 的继续读取提示](https://github.com/earendil-works/pi/blob/42cb822f1c5d3153069dd0661bfd297424666cf1/packages/coding-agent/src/core/tools/read.ts#L154-L204)。

### 对 Phaneris 的意义

我们已经接入 Pi 的执行循环、工具活跃集合、codemode、压缩和消息输入机制。问题不能笼统归为“没有使用原生 SDK”。但[资源加载器](../../packages/pi-agent-server/src/phaneris-resource-loader.ts) 禁用 SDK 自动发现并强制替换完整 prompt，意味着模型面对的行为环境主要由 Phaneris 决定。

禁用重复发现是合理的：host 必须拥有自己的 source、skill 和项目作用域。应该进一步明确哪些语义由 SDK 提供、哪些由 host 覆盖，防止覆盖 prompt 后仍默认以为保留了原生工具指导，也防止在 native tool 外再叠一层相同用途的处理。

**吸收方向：**保留 Pi 的循环与公开扩展协议；以当前能力生成对应指导；保留已明确修复的中文检索、已加载状态和资源生命周期，不为“原生”二字回退这些改进。Phaneris 主要服务写作、文档和知识工作，也不应直接继承 Pi 的 coding 身份和所有默认写作风格。

## 4. OMP：通过工具工程和强指导提高可执行性

### 设计与取舍

OMP 并不回避强干预。默认模板包含专用工具优先、探索、分解、验证和持续完成等明确要求，并使用 Handlebars 条件，根据工具、skills、角色和设置渲染不同内容。单看模板源码长度，无法知道某次请求实际加载多少内容。[系统模板](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/coding-agent/src/prompts/system/system-prompt.md)、[组装器](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/coding-agent/src/system-prompt.ts)。

它也没有简单把所有能力压成小目录：读取、编辑、LSP、运行代码、调试、浏览器、子任务等形成丰富工具环境。值得学习的是工具契约。例如 hashline 的快照不一致错误，会给出当前文件变化、hash 不匹配和如何重新取得锚点的操作反馈，而非只抛出泛化失败。本文没有独立验证其宣传中的成功率提升。[快照错误反馈](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/crates/pi-edit/src/modes/hashline/mismatch.rs#L74-L110)。

本次快照默认启用 `tools.xdev`，并将 `tools.xdevDocs` 设为 catalog。可发现能力挂到 `xd://`：用 read 查看目录和 schema，用 write 分派调用，直接调用与设备调用共用 canonical tool map。**这是减少协议重复，不是增加一个分类器决定模型可不可以访问能力。** 是否内联全部描述仍可配置；挂载本身并不保证上下文一定变小。[xdev 契约](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/coding-agent/src/tools/xdev.ts#L1-L25)、[默认设置](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/coding-agent/src/tools/settings.ts#L961-L994)。

OMP 对纠正的处理也细分效果：纯等待可以被 steering 中断；有副作用的工具收到协作信号，但不会仅因一条新纠正就被硬杀。它兼顾模型及时获得用户输入与已发生效果的完整性。[批次中的 steering](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/agent/src/agent-loop.ts#L3290-L3312)。README 还描述了独立 advisor 角色，说明第二模型不是天然有害；它的上下文、职责和输出怎样进入主循环才是评估重点。[Advisor 说明](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/README.md#L175-L181)。

### 对 Phaneris 的意义

值得优先借鉴的是：让已有读取、编辑、文档处理和浏览器工具提供更完整、可操作的反馈；将内部能力接入统一发现与分派；让可用性取决于实际后端；把等待与副作用区分处理。

不宜直接搬入完整 OMP prompt、全部工具、Rust 编辑器、advisor 或流式纠偏系统。尤其某些“工具结果就是验证”之类指导与我们的文档视觉验收要求不等价。应该借接口与反馈思路，再用本项目任务检验。

## 5. DSH：按作用域组合能力，并区分执行值与模型视图

### 设计与取舍

DSH 的 plugin 组合不是单纯给工具加扩展目录。system prompt、工具注册、权限、session、loop 都是可替换服务。Prompt 有具名 sections、dynamic contexts、variables、显式排序及 scope shadowing；同名局部 section 可以覆盖全局 section。运行时事实与稳定指导分开，`complete` prompt 替换也有明确的冲突与组合语义。[Prompt 服务](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/system-prompt/src/index.ts#L52-L89)。

工具默认 native 模式公开可见 schema，也支持 PTC：模型通过 run_code 调用生成 SDK。它明确承认：PTC 将 schema 成本换为 SDK 文本和 transport schema，不能承诺一定更省上下文。执行使用 canonical value，模型和日志拿到的是 rendered content；内容替换不自动改变程序拿到的完整值。[工具与 PTC 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/tools/README.md#L30-L81)。

Spill 策略使用共享预算，保存全文与图片可读路径，向模型提供保留顺序的头尾视图和明确恢复说明；数据或路径保存失败时保留原结果。本次 base 配置的预算为 12,500 estimated tokens。**其 post-execute 策略明确豁免 read，防止原文恢复入口再次被同一策略处理。** 文本 PTC 子调用还区分程序值与日志副本。[Spill 设计](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/spill/spill-policy/README.md#L47-L69)、[Read 豁免](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/spill/spill-policy/src/index.ts#L133-L154)。

DSH 同样有强 mode 约束。默认 plan-mode 说明明确要求：为了缓存稳定，切换 mode 时保持工具目录不变，权限与当轮 mode 指导负责限制实际动作。这是与“根据每轮意图大幅增删工具”不同的合理取舍。[默认 plan mode](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/base/cordis.patch.yml#L332-L346)。

工具并发也并非全放开：它使用有界 rolling pool，调用启动前重新分类，效果执行可以重叠，但结果按模型顺序提交，并保留取消后的配对与结算。[调度器](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/tool-calls.ts)。

### 对 Phaneris 的意义

最值得立即吸收的是结果契约与恢复入口，其次是能力所有者负责贡献指导、作用域明确、覆盖与追加语义明确。

我们已有 canonical session tool definitions、prompt sections、structuredContent 和独立 durable runtime，具备接近这些职责划分的基础。不需要迁移 Cordis 或重新拆一遍 runtime。也不必为了缩小目录，在每次提问或 mode 改变时卸载重载工具；可以在会话内稳定保留已展开家族，兼顾发现与缓存。

## 6. OpenCode：模型适配、Agent 角色与输出处理各有边界

### 设计与取舍

本次 dev 快照把模型请求、工具快照、plugin hooks 和传输分开。默认 prompt 根据当前工具名补充相应指导；优化插件按模型选择模板，也明确尊重自定义 agent prompt。不能因此假定我们的具体模型一定匹配某个专属模板，更不能把所有模型指导叠加。[请求组装](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/session/model-request.ts#L213-L294)、[模型指导插件](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/plugin/optimize.ts#L16-L90)。

Build、Explore 等角色拥有不同职责与权限；Plan 是单独可见的运行方式。角色有稳定边界，不能用隐藏意图分类器每轮替用户切换。本文观察的是这种实现划分，不主张照搬它的角色列表。

ToolOutput 采用可配置的行数/字节上限，保存完整文本，给出实际展示范围和恢复路径，并设置 `truncated`、`outputPath` 元数据。遍历结果时保留 file 内容块，避免文字截断顺手抹掉其他输出类型。[输出处理](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/tool-output.ts#L69-L119)。

对话压缩与单个工具输出裁剪分开。当前压缩配置默认保留 15,000 tokens 的近期内容；后台预计算是另一个可选能力，默认关闭。这说明长期摘要与近期原文是不同资源，不能把所有内容都交给一份总摘要。[压缩配置与近期原文](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/session/compaction.ts#L40-L47)。

### 对 Phaneris 的意义

应该区分产品行为契约、模型适配和请求配置。模型适配优先处理协议、参数、图像能力和工具格式；行为 overlay 只有在明确失败模式和对照收益下才增加。

文档分析、创作与代码修改的质量要求不同，不能全部套 coding workflow。任务质量要求可以由用户请求或显式选用的领域上下文给出；不需要再造一个重型自动分类系统来控制每轮回答。

## 7. Claude Code：模型主导行动，宿主提供动态能力与上下文管理

官方资料把工作描述为获取上下文、行动、验证三个会相互穿插的阶段，强调模型根据新信息决定后续动作，用户可以中途纠正。这是一条反馈循环，并非所有任务固定依次经过三个表单。[官方工作原理](https://code.claude.com/docs/en/how-claude-code-works#the-agentic-loop)。

恢复仓库可见的 prompt 将静态内容和 registry-managed 动态 sections 分开，工具指导依赖 enabledTools，连接状态影响 MCP 说明，模式和构建条件影响其他 sections。`buildEffectiveSystemPrompt` 还区分默认、定制 agent、custom 与 override 的优先级。这些是可观察的组合边界，不能推广为官方全部行为。[Prompt sections](https://github.com/oboard/claude-code-rev/blob/3b0498a6c684683161077f3c6c5097c6d37cc882/src/constants/prompts.ts#L557-L576)、[覆盖关系](https://github.com/oboard/claude-code-rev/blob/3b0498a6c684683161077f3c6c5097c6d37cc882/src/utils/systemPrompt.ts#L28-L40)。

工具发现也保留确定的入口。恢复版 ToolSearch 支持 keyword、namespace 和 `select:<tool_name>`，并容忍再次选择已加载工具；不是只能依赖一次模糊语义搜索。官方 MCP 资料确认延迟加载与工具搜索属于能力扩展设计。[恢复版搜索](https://github.com/oboard/claude-code-rev/blob/3b0498a6c684683161077f3c6c5097c6d37cc882/src/tools/ToolSearchTool/ToolSearchTool.ts#L178-L210)、[官方 MCP 工具搜索](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)。

恢复代码还存在旧工具结果清理、自动压缩、权限分类器和 hooks。因此不能把 Claude Code 描述为“完全不改写上下文、完全不介入”。应研究具体触发、模式、原文保留和用户控制，不能复制内部实验开关或把 shim 当产品能力。

**吸收方向：**保留模型对下一步行动的决定权；动态上下文有所有者、作用域和有效期；工具发现支持精确调用；权限确认、工具错误、用户纠正和普通数据应有不同事件语义。

## 8. Codex：模型、上下文、工具策略与产品界面的分层

Codex 的当前 core 循环明确处理：准备请求历史、模型 sampling、工具后续、pending user input、上下文预算、压缩以及 stop hooks。主循环可以很复杂，但大部分复杂度用来维持状态、反馈和执行边界，不意味着必须把对应实现细节全部写给模型。[Turn 循环](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/core/src/session/turn.rs#L570-L765)。

Tool exposure 区分 direct、deferred、code-mode-only、hidden 等组合，结合模型是否支持 search、配置和已注册能力确定，而不是只凭“工具多了就隐藏”。Tool search 还可以带有限预算的 source 目录，让模型知道有哪些来源可找。[暴露策略](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/core/src/tools/spec_plan.rs#L198-L288)、[Source 目录](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/core/src/tools/handlers/tool_search_spec.rs#L70-L105)。

模型指导本身作为有类型的 context fragment：独立表达 model 变化、instructions 替换、明确清空，避免“没有新值”和“移除旧要求”混为一谈。历史也区分 retained facts、权限相关上下文和模型可见的输出视图。[模型指导片段](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/core/src/context/model_instructions.rs)、[历史管理](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/core/src/context_manager/history.rs)。

它同样会截断函数结果，也使用并发读锁/独占写锁分隔支持和不支持并发的调用。因此串行屏障、预算和辅助监管都不应仅因存在就被判为过度介入。[执行 gate](https://github.com/openai/codex/blob/d6817454d76885e9d0e118bbf82e507aed6f715a/codex-rs/core/src/tools/parallel.rs#L203-L237)。

OpenAI 官方平台说明进一步把产品上下文、业务规则、工具与 agent loop/沙箱执行的职责分开。这支持我们保留产品和执行层的独立边界，不构成改用 Codex 或更换当前 SDK 的建议。[官方平台说明](https://developers.openai.com/blog/codex-as-a-platform)。

**吸收方向：**使用能力驱动的工具暴露；给动态事实与指令变更明确语义；产品通过稳定接口提供目标与展示事件；对执行队列中的等待、授权、工具本体和结算分别观测。不要照搬 Codex 的模型专属 prompt、完整监管体系或实验功能。

## 9. 六个项目带来的共同设计问题

| 维度 | 可吸收的原则 | Phaneris 的具体选择 |
| --- | --- | --- |
| 主循环 | 持续获得环境反馈，模型决定后续工作；异常在清楚边界处理 | 保留 Pi loop 和 durable runtime；减少额外语义中间人 |
| Prompt | 稳定契约、当前能力、领域说明、动态事实各有所有者 | 利用现有 sections，按工具家族和显式选择展开详细指导 |
| 工具 | 可执行集合、模型可见集合和发现入口明确一致 | 在 canonical definitions 中表达内部工具 exposure；不维护第二套隐藏能力表 |
| 结果 | 执行值、模型视图和 UI 视图分开，变换可追溯 | 原始值与 coverage 元数据稳定；摘要与原文入口并存 |
| 上下文 | 单结果预算、历史清理、对话压缩和长期状态分层 | 优先去除重复处理，保留近期原文、用户纠正和批准范围 |
| 权限与并发 | 根据效果与工具契约约束行动，尊重未知效果 | 保留权限/T1/T2；只对可靠分类细化并发 |
| 用户介入 | 明确计划、纠正、排队和停止的语义 | 用户显式投递方式优先；纯等待与副作用取消分开 |
| 扩展 | 能力可以增加，常驻上下文不应无限累加 | skill 维持用户既定默认；source/plugin 指导按已选资源进入 |
| 模型适配 | 协议适配与行为补丁分开 | 先修参数和能力事实；有证据才增加专属 overlay |
| 评测 | 实际任务质量与运行可靠性分别验收 | SDK/客户端回归保留，再加质量对照，不以测试数量替代收益 |

这里不是六个项目完全相同的“共识规范”，而是根据不同实现提出的本项目设计选择。

## 10. 本轮新增复现：Read 被两次处理

对本地已安装 Pi SDK 与 Phaneris 的真实导出函数做顺序探针，不使用模型，不驱动生产 runtime：

1. 创建 232,892 字符的合成参考文件。
2. 调用 `createReadToolDefinition().execute()`，拿到 51,271 字符结果；`details.truncation.truncated` 为 true，原生结果带有继续读取说明。
3. 将这份结果传入 `handleLargeResponse()`，使用 131,072 contextWindow 和合成 summarize callback。
4. 摘要 callback 被调用。第二层保存的文件与 SDK 结果完全相同，与原始文件不相同。

| 观察 | 结论 |
| --- | --- |
| Pi Read 已裁剪并给出 offset | SDK 已承担一层结果预算与恢复指导 |
| host 继续摘要该视图 | 通用包装器没有尊重已有读取结果的覆盖范围 |
| host 的“完整数据”文件只有 SDK 视图 | 它能恢复第二层之前的结果，不能直接恢复原始文件全部内容 |
| 原始文件仍在，仍能按 offset 读取 | 这不是永久数据丢失，也不能据此声称模型完全无法恢复 |

复现记录位于 `.cache/harness-research-2026-10-23/probe/double-processing.json`；合成输入和第二层结果保存在同一 probe 目录。缓存材料没有进入源码提交。

这验证了适配层组合行为，不是完整 SessionManager/SQLite/客户端 E2E，也没有证明某次真实报告已经因此失真。它比“prompt 太长”更接近应优先修正的工程边界：[包装器](../../packages/pi-agent-server/src/index.ts) 第 1149–1175 行不区分 Read 和已经截断的其他结果；[large-response](../../packages/shared/src/utils/large-response.ts) 落盘的是传入的文本。

对比 DSH 的 read 豁免与 OpenCode 的 `metadata.truncated`，可以得到明确方向：**让结果变换知道前一层已经做过什么，并保持一个能取得真实原文的入口。**

## 11. 对前一轮判断的修订

承接[第二轮审查](harness-capability-review-2026-10-23.md)，进一步收紧四点：

1. **27,351 字符和 61 个工具是负担观测，不是能力受损证明。** OMP 的强指导和 DSH 的完整能力目录都可能有效。必须观察内容相关性、接口质量和真实请求，而非制定统一数字上限。
2. **串行屏障是合法设计工具。** Codex 和 DSH 也保留独占执行。我们应该测未知 shell 的分类与锁覆盖范围，不应直接全面放开或另造复杂锁系统。
3. **摘要和辅助模型各有合理场景。** 历史压缩、advisor、权限审查与结果相关性筛选承担不同职责，不能统一归成“第二模型拖累”。应逐项比较输入、触发、后果、可撤销性和收益。
4. **“原文已保存”需要说明是哪一层原文。** Phaneris 已保留 structuredContent 的部分程序通道，不能说完全没有 canonical value 基础；但 SDK 已截断的视图再保存，并不等于保存完整文件。

前一轮关于 `_intent` 被标记为 display-only 却参与结果筛选、摘要被完整阅读确认接受等事实仍成立。新的重点是修复语义与组合边界，而不是简单删字段或把所有结果无限量送入模型。

## 12. 建议的 Phaneris 目标设计

### 12.1 一个主循环，明确的产品输入

Pi 继续拥有推理/工具循环、SDK 工具状态和原生消息机制；Phaneris 继续拥有用户目标、项目、source、显式 skills、产品授权、任务与 Artifact 状态、展示及 durable 保障。两者通过已有端口协作。

让模型知道当前目标、约束、可用能力和完成标准。任务拆解、探索路径、证据权衡和中途修正，原则上由拥有完整上下文的主模型推进。对用户明确要求的计划、审核和专业工作流，按其范围执行。

### 12.2 能力和指导使用同一份事实

为内部 canonical definitions 逐步补齐：是否可用、不可用原因、direct/deferred 暴露、所属家族、必要短指导、效果分类和输出契约。复用已有 registry 与 SDK active-set 协议。

首先考虑配置/认证、Pages、任务管理等低频家族的按需展开；文件、搜索、shell、必要用户交互等基础能力保持容易取得。已经展开的家族可稳定保留，避免每轮分类、反复卸载和缓存抖动。

主 prompt 保留短产品契约。详细流程跟随能力出现；来源和生效状态可追踪。保留 skill 默认不被发现、不主动启用的既定设计，不能借“学习其他项目”改变用户已决定的行为。

### 12.3 结果处理采用明确的覆盖契约

建议概念上区分下列事实，具体字段形式在实现设计时与现有类型合并：

| 事实 | 目的 |
| --- | --- |
| canonical value / 原始内容引用 | 程序处理与精确核对使用真实数据 |
| model view | 标明是完整、分页、头尾、摘录还是摘要 |
| coverage | 路径、行/字节范围、缺失范围、必要的版本标识 |
| recovery | 下一 offset、可搜索文件或重新读取真实来源的方法 |
| transform provenance | 哪一层、因何处理了结果；前一层是否已裁剪 |
| presentation metadata | 只影响界面，避免隐式改变取证与授权 |

不要求所有工具返回同一大对象，也不要求把实现元数据全部塞入模型上下文。执行层保留完整结构，模型拿到足够准确的覆盖与恢复说明即可。

Read/范围读取和原文恢复通道应避免通用语义摘要；其他工具优先由自身提供筛选、分页和结构化输出。可选摘要为辅助视图，有明确任务需要时再启用相关性筛选。文本处理不得无意抹掉图片或其他内容块。

### 12.4 辅助决策按职责评估

| 用途 | 建议定位 |
| --- | --- |
| 标题、非关键标签、目录推荐 | 尽量不阻塞主请求；过时结果丢弃；失败不改变任务目标 |
| 用户主动调用 decide/call_llm | 作为能力保留，输入与输出边界明确 |
| Guarded 风险审查 | 保留用户选择的监管模式，不以减负为由取消权限保障 |
| 中途消息分流 | 用户显式选择优先；自动判断不能默默推迟明确纠正 |
| 大结果过滤 | 优先检验有无信息损失及取回成本；不拿采用率当准确率 |
| 任务完成判定 | 结合实际交付与运行状态；文字分类只作辅助 |
| advisor/专门 reviewer | 仅在明确需要和收益下引入，不因其他项目存在就叠加为默认 |

### 12.5 先改善已有工具反馈

优先让失败返回可执行下一步：schema 错误给出当前支持参数，读取告诉覆盖范围，编辑告诉冲突位置与版本，文档工具区分文件生成与视觉验收，浏览器区分等待、取消和效果未知。

这些改进直接扩大模型能够可靠完成任务的范围。相比再增加“必须认真检查”之类通用指令，它们更容易验证，也更少依赖模型猜测运行时。

## 13. 建议实施顺序与验收

本节是后续方案，没有据此修改生产默认或开始重构。

| 批次 | 内容 | 验收重点 |
| --- | --- | --- |
| A：结果边界 | 先列失败方式，再覆盖 Read 二次处理、部分读取确认、非文本块保留、原文恢复；然后修复 | 完整 Pi→host→持久化→后续模型链路，保留可复跑产物；原文能真正取回 |
| B：能力与指导 | 从 canonical definitions 试验低频内部家族按需暴露，指导随能力出现 | 发现与精确加载成功、重复加载无害、权限一致、缓存变化可解释 |
| C：消息与辅助决策 | 明确纠正/排队/停止语义，分别旁路当前自动介入点做对照 | 用户纠正及时进入适当边界，副作用不被误杀，观察启动/完成耗时和质量 |
| D：工具与模型适配 | 改善已有错误反馈与平台可用性；针对真实失败试验少量 overlay | 参数支持真实、工具修复成本降低、跨任务无明显退化 |

保留 T1/T2、未知效果恢复、批准版本、权限模式、隔离和用户专有产品动作。这些已有基础与学习其他 harness 并不冲突。

### 质量评测必须面向 Phaneris 的真实工作

| 任务 | 主要验收 |
| --- | --- |
| 通知/材料改写 | 不新增无据日期、数字、承诺；不漏关键条件；符合指定语气 |
| 长资料报告 | 找到中后段反证与限制；引文支持结论；不因摘要漏掉关键事实 |
| 表格与数据 | 正确筛选、计算与导出，独立检查数据与文件 |
| SVG/视觉交付 | 同题保存源文件，统一渲染并盲评主体、构图和完成度 |
| 多步项目工作 | 最终成果正确、能恢复、纠正不丢、重复外部效果受控 |

先做 Phaneris 内部单变量对照，再做与 DSH/OMP 等的整体体验对照。前者保持其余 harness 条件不变，后者允许各产品发挥自己的设计；不能混成同一个实验。固定用户确认的模型和 provider 路由，记录实际请求参数、工具和隐藏附加上下文，交错重复试次。

主要结果是交付质量、事实错误、遗漏、用户介入和有效行动/完成耗时。prompt 大小、工具数量、token 与调用轮数帮助解释结果，不能独立充当胜负指标。题目允许多种正确策略，避免以固定工具顺序或“必须短于某数”限制模型。

## 14. 本轮可交付结论

**建议保留 Pi SDK 和现有执行保障，以结果契约修复为第一步，以能力/指导一致为第二步，再用真实任务筛选辅助干预。**

Pi 提供组合内核，OMP 提供工具工程经验，DSH 提供结果与作用域契约，OpenCode 提供模型/角色适配，Claude 的可见资料提供动态能力与反馈循环参照，Codex 提供上下文和工具策略分层。吸收这些设计，应当让模型更容易取得事实并完成目标，同时减少它为了适应产品机制而承担的额外工作。
