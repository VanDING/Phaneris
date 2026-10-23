# Harness 对模型能力的影响：第二轮审查

Status: proposed — analysis and local probes completed; behavioral improvements and implementation remain unapproved and unverified.

日期：2026-10-23，Asia/Shanghai。源码基线：`main`，`df397f880`。本轮仅分析，没有修改产品实现、模型连接、用户设置或会话数据。

## 结论与证据边界

**当前 harness 存在值得优先消除的结构性负担：常驻产品工作流和工具过多、自动改写模型证据、辅助模型参与关键路径，以及粗粒度串行化。这些机制的收益尚未通过真实任务对照证明。**

这支持用户继续质疑 harness 的方向，但不能把“存在限制机制”直接推导成“已经证明它是鹈鹕插画、文字失真或超长思考的唯一原因”。需要区分：

| 证据层级 | 本轮得到的结果 |
| --- | --- |
| 源码事实 | 无条件组装产品工作流；内部工具缺少 deferred exposure；大结果替换路径；辅助决策的输入范围与调用位置 |
| 实际会话记录 | `261023-ready-silver` 首个快照有 61 个工具；`261020-swift-zinc` 保存了用户对插画和文字任务的反馈 |
| 本地函数探针 | 中文查询英文工具失败、独立 shell 读取串行、摘要被读取确认逻辑接受、百万窗口模型仍触发单结果摘要 |
| 尚未获得 | 同一真实 provider、请求参数、任务和环境下的重复质量消融；探针缺口在真实用户会话中的发生频率 |

没有发送线上模型请求。本地探针使用当前导出函数、内存工具目录、调度任务和合成摘要，不是完整客户端 E2E，也不证明模型质量变化。

本轮承接[上一轮基线](model-facing-harness.md)和[启动修复记录](../verification/conversation-start-fix-2026-10-23.md)。上一轮优先修复能力真实性、结果结算、计划批准和任务连续性，具有独立价值；但契约通过与任务质量提高是两种验收。

## 1. 模块化尚未成为按需上下文

[assistant-prompt.ts](../../packages/shared/src/prompts/assistant-prompt.ts) 第 30–31 行仍直接拼接 contract 和全部 capability guidance。后者只有浏览器、CLI、反馈和 decide 等局部开关；不存在按当前任务展开产品工作流的机制。

执行 `bun run print:system-prompt --json` 得到：

| 示例 system prefix 的组成 | 字符数 |
| --- | ---: |
| product-contract | 5,943 |
| product-workflows | 19,667 |
| 其中 session-management | 4,619 |
| 含当前偏好和环境标记的全部示例 | 27,351 |

这是现有诊断命令生成的示例 prefix，使用示例 workspace 路径；不是某次真实请求，不包括完整工具 schema、对话历史、附件及所有动态上下文，也不是 provider token 计数。偏好和开关变化会改变结果。

源码已拆分，模型仍要同时处理自动化、Pages、任务状态、标签格式、辅助模型、Artifact 工作流和预览格式等说明。例如一个只需改写短通知的任务，也会携带这些产品操作知识。

**判断：**维护模块化已经实现，推理时的按需加载尚未实现。应优先减少无关指令，而不是单纯追求某个 KB 数字。缓存命中降低重复计算成本，并不会让这些指令退出模型的上下文。

**建议：**常驻保留目标连续性、事实准确性、授权原则、完成标准和简短能力入口。各产品家族的详细格式、案例、安装说明和特殊流程跟随能力展开；权限边界始终由宿主执行。不要另加一个模型作为“是否允许展开”的必经入口，也不要强制每次换领域先做复杂路由。

## 2. 工具发现只解决了一部分暴露问题

### 2.1 内部工具仍全部常驻

[session-tool-defs.ts](../../packages/shared/src/agent/backend/pi/session-tool-defs.ts) 从 canonical definitions 取内部工具；[tool-composition.ts](../../packages/pi-agent-server/src/tool-composition.ts) 第 16 行将未设置 exposure 的工具默认列为 active。

当前设置下，本地读取定义得到 49 个内部工具，0 个显式 exposure。加上 7 个本地工具、2 个 web 工具、1 个进度工具及 tool_search/codemode，组成 61 个工具；这与已有真实快照一致。

`261023-ready-silver/session.jsonl` 首个 contextSnapshot：

| 项目 | 记录值 |
| --- | ---: |
| system prompt 字符 | 28,252 |
| 工具数 | 61 |
| 工具 description 字符合计 | 34,375 |
| schema 字符合计 | 45,338 |

这些是快照中的字段长度，不是 wire 字节或计费 token。不能仅凭工具数断言准确率下降；但可以确认：外部 source 的 deferred search 没有减少内部认证、任务管理、Pages、Artifact 等能力的默认暴露。

**建议：**对内部工具也支持家族展开。保留文件、shell、检索和必要交互等基础能力；配置/认证、Pages、任务管理、特定交付物等按需提供完整定义。工具始终可发现，不使用不可见的分类器阻止主模型访问。先做消融，再确定默认集合，不预设必须压到多少个工具。

### 2.2 中文分词不等于跨语言检索

[tool-discovery.ts](../../packages/pi-agent-server/src/tool-discovery.ts) 使用词项重合、精确名称和子串匹配。它没有跨语言语义匹配或同义词扩展。

本地目录只放入一个 deferred 工具：`mcp__crm__get_customer_balance`，描述为 `Get customer account balance and outstanding invoices.`。

| query | 当前函数结果 |
| --- | --- |
| `查询客户余额` | No matching connected tools |
| `customer balance` | 加载该工具 |
| `crm` | 报告 already_available |

这是确定性复现，不能泛化成所有中文查询都失败。上一轮修好了中文查询被丢弃的问题，尚未解决中文意图与英文描述之间的语义距离。

**建议：**先提供可枚举的 source/namespace 能力入口、双语关键词和同义词；搜索失败时给出可继续探索的目录。必要时再比较语义检索的增益与开销，避免把一个不透明检索模型变成新瓶颈。

## 3. 主模型收到的证据被自动加工

### 3.1 单结果大小被当成需要摘要的依据

[large-response.ts](../../packages/shared/src/utils/large-response.ts) 的 `tokenLimitFor()` 使用窗口比例并设置 12,000 estimated tokens 上限。它不接收当前剩余上下文、当前任务是否要求逐字核对、数据是否需要精确计算等信息。

本地结果：

| 声明的窗口 | 单结果阈值 |
| --- | ---: |
| 64,000 | 6,400 |
| 131,072 | 12,000 |
| 1,000,000 | 12,000 |

调用真实 `handleLargeResponse()`，传入 63,000 字符合成文本、1,000,000 窗口、未安装过滤/摘要判断 hook，并提供合成摘要 callback：callback 被调用一次，返回 `wasSummarized: true`，完整原文成功保存。

这证明单结果会在远小于声明窗口的情况下被自动改写，不证明将原文全部送入模型必然更优。当前函数也无法知道整个上下文是否还有余量。

当前主链路是：工具完成 → 保存原文 → 可选相关性摘录 → 可选摘要选择 → 摘要或预览 → 主模型继续。关闭 decision layer 的 `largeResults` 只会移除可选决策，**不会关闭原有自动摘要**。

**风险：**核对报告、找反例、分析代码依赖或处理数字时，主模型可能需要摘要认为不相关的细节。取回原文的路径存在，因此不是不可恢复的数据丢失，但需要额外调用，而且模型必须先意识到缺少什么。

**建议：**默认采用可追溯分页、范围读取、结构化查询和明确的原文入口。摘要作为辅助视图；涉及精确核对、完整阅读和计算时不自动替换关键证据。预算应考虑当前占用、后续输出及任务需求，并允许主模型主动获取完整材料。

### 3.2 “仅显示”元数据实际影响证据选择

[phaneris-metadata-schema.ts](../../packages/pi-agent-server/src/phaneris-metadata-schema.ts) 第 11 行将 `_intent` 描述为 `for display only`；[index.ts](../../packages/pi-agent-server/src/index.ts) 第 1071 行取出它，第 1156 行开始把它传入大结果处理。

[large-result-filter.ts](../../packages/server-core/src/decisions/large-result-filter.ts) 根据该 intent 对文本片段打分；摘要 prompt 也优先使用 intent，截取 500 字符，没有 intent 时才取 userRequest 的前 300 字符。这个输入没有主会话的完整目标、修正和证据关系。

此外，本地比较 7 个本地工具与 49 个内部工具的 schema：加入 `_displayName` / `_intent` 共增加 12,600 个 JSON 字符，基础 schema 为 30,227 字符。它们是可选参数；此处不包含其他工具，也不是 token 统计。

**判断：**问题不只是字数。一个声明为展示用途的字段参与了主模型证据选择，接口语义与实际作用不一致。

**建议：**UI 文案尽量由工具名称、参数和事件生成；若模型提供 task intent，应明确其语义用途。即使语义明确，也不应仅凭短 intent 自动剔除可能影响结论的材料。

### 3.3 结果改写与完整阅读确认存在缺口

[prerequisite-manager.ts](../../packages/shared/src/agent/core/prerequisite-manager.ts) 第 218 行的 `trackReadTool()` 排除了 limit/offset 和部分截断标记，但不识别 `[Large response ... summarized]` 或 `[Relevant excerpt: ...]`。

函数探针：注册一个现有文档路径作为 pending skill prerequisite，以无范围 Read 参数和合成大结果摘要调用 `trackReadTool()`，得到 `hasRead: true`，后续 Write prerequisite check 放行。

这只验证读取确认函数的边界；尚未构造真实客户端中“长 SKILL.md → 实际摘要 → 完整阅读误确认”的 E2E。因此它是需要补证的契约缺口，不能宣称已经解释用户的输出质量。

另一个静态缺口：[index.ts](../../packages/pi-agent-server/src/index.ts) 第 1170–1175 行用单个文本摘要替换整个 `result.content`。若原结果同时含长文本与图片等内容块，这条分支没有保留非文本块。本轮没有构造完整多模态重放，发生范围待测。

**建议：**把原始结果、模型可见视图、是否完整、变换类型和引用关系作为明确元数据传递。完整阅读应根据实际交付的覆盖范围确认，不用摘要里的自然语言推断；处理文本时保留其他内容块。不要通过更长的提醒补救错误的交付状态。

## 4. 辅助决策没有审批权，仍然能影响主模型能力

本轮只读取了用户配置中的开关，没有更改。当前 enabled 为 true，且 suggestions、midTurnMessages、largeResults、turnOutcome、guardedMode、riskBadges、taskRepairs 已开启；adaptiveThinking 明确关闭。未显式存储的其他字段按系统默认值补齐。

这只表示相关分支可用，不能证明它们在某个历史请求都发生过。

| 机制 | 当前输入/位置 | 对能力的影响路径 |
| --- | --- | --- |
| suggestions | 用户消息前 2,000 字符，候选简介每项至多 200 字符；主请求前等待 | 增加启动等待，注入一个能力推荐；前台 deadline 上限 3 秒，不是每次固定等待 3 秒 |
| midTurnMessages | 当前请求与新消息各至多 1,500 字符 | 决定 steer 或 queue，影响用户纠正何时到达主模型；还可合并排队消息 |
| largeResults | 短 intent、结果片段或开头 | 影响主模型直接收到哪些证据，过滤分支有 6 秒期限，fallback 仍可能继续摘要 |
| turnOutcome | 请求开头至多 800 字符、最终回复末尾至多 3,000 字符 | 影响产品注意状态和无人值守任务节点处理；它不等于对真实交付物验收 |
| guardedMode | 当前工具和截取后的参数 | 仅在 Guarded 等适用条件下增加批准提示；不能据其开关解释 Execute 会话的一切等待 |

源码入口分别在 [suggestions](../../packages/server-core/src/decisions/suggestions.ts)、[mid-turn-messages](../../packages/server-core/src/decisions/mid-turn-messages.ts)、[turn-outcome](../../packages/server-core/src/decisions/turn-outcome.ts)、[guarded-mode](../../packages/server-core/src/decisions/guarded-mode.ts)。[SessionManager](../../packages/server-core/src/sessions/SessionManager.ts) 第 10956 行附近组织 pre-turn decisions，第 11239 行附近处理决定后的消息投递。

**判断：**“不授予权限”是授权属性，不能证明“不会降低能力”。尤其是知道更少上下文的辅助模型，不能天然比主模型更适合判断证据相关性、消息关系和任务是否完成。当前的置信度阈值和使用率记录，不等于已经测过真实质量净收益。

**建议：**先用逐项旁路对照确定价值。显式用户选择的消息投递方式优先；明确纠正不应先等待模糊分类。能力推荐尽量不阻塞主请求，结果到达后只能提供建议。完成/阻塞判断结合明确运行状态和交付事实，不能只读结尾文字。保留 Guarded 的产品选择，实际权限仍由宿主负责。

这些建议不等于删除 decision layer，也不等于把默认关闭写成不可配置。应清楚区分用户主动调用 `decide` 和系统自动介入主循环。

## 5. 保守排序扩大成全会话屏障

[tool-execution-scheduler.ts](../../packages/pi-agent-server/src/tool-execution-scheduler.ts) 第 35 行开始分类资源。read/grep/文件写入有路径资源；shell 命令不分析实际效果，落到 `domain: '*', access: 'write'`。大部分 session mutations 和未知外部效果也使用全局屏障。

本地探针分别传入：

```powershell
Get-Content E:/Phaneris/README.md
Get-Content E:/Phaneris/package.json
```

两者都得到全局 write 资源。用两个合成调度任务验证，A 未释放时 B 不启动；释放后才出现 B_started。没有实际执行这两个命令，也没有制造文件变更。

[index.ts](../../packages/pi-agent-server/src/index.ts) 第 1067 行的资源队列覆盖后续 preflight、权限等待、执行、大结果处理和 T2。因此一个普通 shell 命令或摘要等待可能推迟本来独立的操作。此处没有测得用户现场的延迟占比。

**建议：**保留同资源顺序和未知副作用保护。只对可可靠识别的读取与资源操作细化分类，未知 shell 继续保守处理。将不需要占有效果锁的结果呈现/摘要工作与实际效果区分开，但要先设计结果结算及后续模型消费顺序，避免为并发破坏 T1/T2、取消和 UI 交接。

这不是放开所有 shell 并发的依据，也不是 T1/T2 本身有问题。

## 6. 能力暴露与运行条件仍有错位

Windows 下，prompt 已如实声明 script_sandbox 和 transform_data 的隔离后端不可用，修正了上一轮错误说明。但它们仍在内部工具定义中公开。

[isolated-script.ts](../../packages/session-tools-core/src/runtime/isolated-script.ts) 第 29 行附近要求 filesystem/network isolation；没有支持的 backend 时在所有 mode 拒绝。关闭权限提示不会改变这个执行条件。

**建议：**把工具可用性作为 capability registry 的事实：可用、待认证、需依赖、当前平台不可用，并在展开时直接给出可执行替代路径。无需让模型先读到“可以调用”，再记住另一处“现在不能执行”。不能通过取消隔离来修复能力暴露问题。codemode 和 script_sandbox 是不同执行系统，本轮不把两者混同。

另需保留一项实验控制变量：[custom-endpoint-models.ts](../../packages/pi-agent-server/src/custom-endpoint-models.ts) 的未配置默认值是 131,072 contextWindow 与 16,384 maxTokens。它会影响压缩、摘要和长度续写判断。用户可以显式覆盖；本轮没有证据表明具体会话使用了错误上限，不能据此重新怀疑用户已确认的同一模型。

## 7. 为什么上一轮修复后仍可能感觉能力受限

上一轮侧重：能力名与权限一致、成功/等待语义一致、工具结果可结算、计划批准范围可恢复。这些解决的是模型能否可靠行动。

本轮侧重：模型行动前被放入什么上下文，真正拿到什么证据，有多少额外判断和等待，能否选择自己的解题路径。这些决定的是任务完成质量与效率。

已有 E2E 用 loopback 产生预定工具调用，能够检验运行链路；它不会检验真实模型是否被无关上下文误导、是否主动找反例、是否在通知改写中发明日期，或插画是否有构图质量。

`261020-swift-zinc` 中用户已经反馈：移除个人档案没有明显改善；插画提示词加强后元素变多但主体质量仍不理想；文字样例也出现质量差异。这些值得保留为回归题。该会话没有提供所有比较客户端的完整请求与原始输入，不能把转述结果直接作为严格因果对照。

此外，本轮检查的该会话及若干关联快照中，没有在产品 tool 文本里发现大结果摘要/摘录标记；因此不能宣称自动摘要已解释此前的鹈鹕结果。

## 8. 建议的目标边界

| 层 | 常驻职责 | 应当移出的内容 |
| --- | --- | --- |
| 主模型契约 | 当前目标、连续性、真实性、授权原则、完成标准 | 所有产品功能的完整手册、固定解题步骤 |
| 能力入口 | 可用能力、准确 schema、错误恢复、可追溯结果 | 不可用功能假装可执行、UI 文案占据语义字段 |
| 按需领域上下文 | 当前选用能力的说明和必要约束 | 与本任务无关的领域规则 |
| 执行保障 | 权限、隔离、冲突顺序、durable 结算与恢复 | 替模型选择论据、强制所有任务走同一路线 |
| 可选辅助决策 | 用户选用的判断与有验证收益的建议 | 未验证的、阻塞主循环的自动接管 |

这是一条职责边界，而不是另造一套复杂编排系统。

已经确认的设计继续保留：skill 默认不向主模型公开目录、不主动启用；显式调用后正确读取。已开启的 suggestions 是单独可选通道，其影响应该独立测量，不借本轮审查改变默认 skill 设计。插件显式选择、Artifact 接受、任务关闭和 Page 发布等产品决定也不在本轮擅自更改。

## 9. 后续用消融回答，而非继续加规则

### 两条不同的对照线

1. **机制归因：**在 Phaneris 内逐项旁路 prompt 工作流、内部工具暴露、结果自动摘要和可选辅助决策；保持其余实现和真实请求参数一致。
2. **整体体验：**在相同任务、provider 路由、模型和工作环境下比较 Phaneris、DSH、OMP。各自 prompt 和工具不同本来就是被测对象，因此不能要求整个 payload 相同，再称为客户端整体对照。

同一路由和用户已确认的同一模型作为前提。记录实际 reasoning/max output、图像输入、隐藏附加上下文、缓存冷热及重试；不要通过换模型或降低思考偷换实验。保留同一项配置的多次独立试次，交错运行，避免把时间段或单次随机性当成架构收益。

### 第一轮变量

| 组 | 只改变的变量 | 所回答的问题 |
| --- | --- | --- |
| A | 当前完整 harness | 基线 |
| B | 产品详细工作流改为短入口，工具不变 | 无关常驻说明是否影响质量与首个有效行动 |
| C | 内部工具家族按需暴露，prompt 保持 A | 工具声明负担是否影响结果与调用选择 |
| D | 可选辅助决策旁路，其余保持 A | 自动推荐、消息分流等是否有净收益；若出现差异再分功能归因 |
| E | 原有摘要改为可追溯原文分页/范围读取，使用固定工具结果材料 | 结果加工是否损害证据完整性；不是取消上下文预算 |
| F | B/C/D/E 经单项验证后的组合 | 是否有叠加收益或相互依赖；不能替代单项归因 |

不要把 mini agent preset 直接当作 B：它有独立角色和工具约定，不能保证只改变无关工作流。

### 任务应覆盖真实工作

| 类型 | 材料与验收重点 |
| --- | --- |
| 纯文本约束改写 | 原文明确日期、数字和禁止补充项；统计事实遗漏与无据新增，不只看文风 |
| 研究/报告 | 关键反证分别放在长资料中段和末段；检查能否找到并处理、引文是否支持结论 |
| 数据处理 | 使用可核算的本地数据；独立校验总数、筛选条件和导出文件 |
| SVG 插画 | 保存相同原始题目、实际请求和 SVG；在同一渲染条件下盲评主体结构、构图与完成度 |
| 多步文件任务 | 独立任务和相互依赖任务混合；检查最终文件、工具错误与重试、无意义串行等待 |
| 中途纠正与长任务 | 执行中追加限制、再做 compaction/handoff；检查纠正是否及时生效、目标是否遗失或重复执行 |

优先选少量有区分力的真实任务反复做，再扩大。每次保留输入、实际请求配置摘要、工具轨迹、原始结果及模型可见结果、交付物、评分依据。主要指标是任务质量、无据新增、遗漏、用户介入和首个有效行动/完成耗时；token 和工具轮数是解释变量，不能单独充当成功标准。

允许多种正确解法，避免将固定工具顺序或较少调用次数写成质量要求。产品链路回归与模型行为评测并行存在；不用新的模拟工具成功数替代质量结论。

## 10. 建议的实施优先次序

1. **先补当前结构的质量基线和逐项实验开关。** 开关服务于诊断，先在隔离评测入口使用，不直接变更用户生产默认。
2. **优先试验常驻工作流和内部工具减负。** 这是最普遍、能影响纯文本和工具任务的变量；保留全部权限保障和能力可达性。
3. **整理结果完整性与读取确认。** 先列失败方式，再建立完整链路失败场景，包括长指令、摘要、摘录、多模态块、原文恢复和精确数字核对，然后修改实现。
4. **逐项评估辅助决策。** 特别检查启动推荐、消息投递和证据筛选；有收益才留在关键路径，使用率不是收益。
5. **细化实际瓶颈的资源分类。** 根据真实轨迹处理误串行和不可用能力暴露，不从静态猜测直接放开未知效果。

T1/T2、权限边界、原文持久化、批准版本和恢复机制应继续保留。它们能让模型长期可靠工作；需要削减的是没有任务依据的常驻信息、自动替代主模型判断和不必要等待。

## 外部依据与适用范围

- Anthropic，[Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)，2025-09-29：讨论最小充分上下文、按需检索和长期状态管理。它支持实验方向，不证明 Phaneris 某个模块已经造成质量下降。
- Anthropic，[Writing effective tools for agents — with agents](https://www.anthropic.com/research/writing-tools-for-agents)，2025-09-11：工具集合、描述、返回内容应与真实任务评测一同迭代。它不支持机械限制到固定工具数。
- Anthropic，[Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)，2026-01-09：区分轨迹与实际环境结果，重复试次并接受多种正确策略。该方法不替代本项目自己的模型行为证据。
