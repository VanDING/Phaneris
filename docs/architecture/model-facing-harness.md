# Model-facing harness：职责、实现与审查结论

Status: accepted — implementation baseline on the working branch; merge and release are separate.

日期：2026-10-22。状态：已在 `codex/model-harness-implementation` 实施并进行本地验证，未合并或发布。逐批证据与未验证范围见[实施记录](../process/model-harness-implementation-2026-10-22.md)。

2026-10-23 的能力契约与条件指导增量见[后续实施记录](../process/harness-capability-implementation-2026-10-23.md)；下文保留本基线的历史范围与验证事实。

本次范围包括 system prompt 的设计与组装、工具定义/检索/权限/执行、计划与任务连续性，以及 skills、sources、plugins。评判原则是：**harness 应提供模型无法可靠推断的事实、能力接口和执行保障，使模型更好地完成用户目标。** 不把每个任务变成固定流程，不以辅助模型回答代替授权，也不因增加规则而宣布质量提高。

## 材料与证据边界

- 阅读了用户提供的 `C:\Users\dotty\Documents\deepseek-harness\default-workspace\report\AI工具系统提示词设计研究报告.md`，重点采用其中的职责分层、工具即契约、稳定前缀、渐进披露和运行时承担确定性约束的分析框架。其社区提示词语料不能作为官方线上行为或模型质量收益的证明。
- 用户引用的 `docs/research/2026-10-22-model-facing-harness-review.md` 在当前工作区不可见。本文件是基于可见源码与复现结果的新审查记录，没有复述或补写该文件。
- 静态审查、真实函数集成、真实 Pi/SQLite 子进程和线上模型质量是不同证据层级。loopback 推理用于验证传输与执行链，不用于声称模型更聪明、拒绝率降低或任务成功率提升。

## 1. 职责边界

| 层 | 应负责 | 不应代替 |
| --- | --- | --- |
| 主 prompt | 目标连续性、指令关系、工具选择原则、完成标准、能力限制 | 重复 schema、虚构工具、逐步指挥所有工作 |
| 工具 schema/描述 | 精确参数、用途、输入限制、输出及失败语义 | 授权、实际连接状态、已完成的业务结果 |
| 宿主权限 | 当前 mode、批准归属、运行时拒绝、保留给用户的产品操作 | 辅助模型自评、工具名的宽泛后缀匹配 |
| 工具调度与 durable runtime | 冲突排序、T1/T2、交接暂停、未知效果恢复 | 模型自述的成功、跨进程的假定文件锁 |
| 持久化产品状态 | 任务描述、验收标准、进度、时间、层级与依赖 | 执行账本、逐步骤成功证明、用户批准 |
| source/skill/plugin 内容 | 明确来源的领域知识、操作语义、用户选用的工作方式 | 覆盖当前用户指令、修改权限、引入额外授权 |

实际调用路径为：模型选择已暴露工具 → Pi 资源调度 → 宿主 preflight/权限与输入变换 → durable T1 → 工具实现或宿主代理 → durable T2 → canonical 工具结果 → 后续推理。确认需要 UI 交接时，在结果结算后暂停。

对应实现：[Pi 工具边界](../../packages/pi-agent-server/src/index.ts)、[资源调度](../../packages/pi-agent-server/src/tool-execution-scheduler.ts)、[durable runtime 基线](durable-agent-runtime.md)。

## 2. 主要发现与处理

| 问题 | 对模型/用户的影响 | 本轮处理 |
| --- | --- | --- |
| namespaced web 工具与权限分类不一致 | 可读操作被误拒绝或要求 mutation 批准 | 统一 canonical 名称与权限路径；外部 source 不能靠内部工具后缀获得权限 |
| 声明未实现的参数或环境能力 | 模型按错误说明反复尝试 | 移除 call_llm 无效 thinking 参数；修正 Windows shell/隔离说明及调试示例 |
| SubmitPlan 返回早于宿主确认 | 模型可能在展示失败或仍需批准时继续 | 等待宿主完成展示；失败返回工具错误；确认等待后暂停 |
| OAuth 一律按名称暂停 | 静默刷新也中断工作 | 根据真实结果区分继续与 `await_user` |
| 工具检索对中文、重复查询及空查询处理不足 | 已连接能力难以使用，重复检索误报 | 多语言匹配、目录入口、已加载工具说明；active set 仍由 SDK 管理 |
| source 信息在模型收到前就标记已交付 | 初始化失败后缺少必要能力说明 | 准备与确认交付分离；最新 source 快照覆盖旧状态 |
| skill 失败/部分读取或缓存变化被误判 | 模型以为已有领域说明 | 只以成功且完整的读取确认；修正缓存与 mention 重放 |
| 批次中同资源操作并发 | 后续读取看到旧内容，重复写顺序不确定 | 文件/父目录/junction 冲突排序，公平等待与取消；独立读取保留并行 |
| 写操作与计划/认证交接并发 | 暂停之后仍可能启动后续调用 | 潜在交接批次顺序执行，确认等待后抑制后续 T1 |
| 标签/状态被当作无副作用记账 | 绕过可能触发自动化的风险判断 | 进入普通 Guarded mutation 判断，明确事件副作用 |
| 浏览器能力可用性被等同于动作授权 | 上传、剪贴板写入或 JS 外部效果缺少相应判断 | 与执行器共享解析；对明确效果执行 mode 门禁，不把所有 click/fill 一概封禁 |
| 批准仅关联可变计划路径 | 接受后文件变化、压缩或重载改变执行范围 | 保留批准内容版本及消息快照，恢复保留原目标和批准范围 |
| 主 prompt 与运行时条件混在单体模板 | 审查困难，难以定位预算和来源 | 纯内容模块 + 一次性宿主事实快照 + 可检查的有序组装 |
| 产品已有任务字段未进入 agent | 看板修改与模型理解脱节 | 初始快照和按轮读取端口共用有限 DTO；任务数据放在 volatile tail |
| 空任务状态和未答问题语义含糊 | 旧元数据继续生效，或把未回答当成许可 | 显式空快照；区分可选偏好与尚未解决的必要事实/批准 |

这些修改优先消除能力与事实不一致，避免要求模型靠猜测修补运行时。

## 3. Prompt 设计与组装

[system.ts](../../packages/shared/src/prompts/system.ts) 负责宿主事实读取及外层组装。内容分为：

| 模块 | 内容 | 来源 |
| --- | --- | --- |
| [assistant-contract](../../packages/shared/src/prompts/assistant-contract.ts) | 身份、执行契约、权限解释、失败与完成标准 | 产品行为契约 |
| [capability-guidance](../../packages/shared/src/prompts/capability-guidance.ts) | 文档路由、资源、辅助模型、交付物、自动化、Pages、提问及会话管理 | 产品能力工作流 |
| [assistant-prompt](../../packages/shared/src/prompts/assistant-prompt.ts) | 有序模块及 `id/source/content` 契约 | 纯组装，无磁盘或权限决策 |
| preferences/project/debug/context-file manifest | 用户偏好、项目内容、调试及指令文件入口 | 各自明确来源 |
| environment marker | 应用版本、平台和架构 | 运行时事实，位于末尾 |

`compileSystemPrompt()` 返回实际文本及组成它的同一组 sections；`getSystemPrompt()` 返回前者的 `text`。诊断不再通过解析输出中的标题猜测边界，项目内容里出现标题不会伪造模块。

提取前建立了 Windows/Linux/macOS × browser/CLI/feedback/decide 的 48 组内容哈希。模块提取保持字节一致；随后单独修正了未回答问题的授权语义，验证中只对这一条已登记的文本变更做基线归一化。没有借结构调整删去既有指令，也没有在缺少行为评测时切换默认 prompt 策略。

重复检查入口：

```sh
bun run print:system-prompt --json
bun run print:system-prompt --json --include-content
```

默认 JSON 输出模块来源、字符数、UTF-8 字节数和哈希；显式 `--include-content` 才输出内容。它是示例 system prefix，不是线上模型请求，计数也不是 provider token 计费。实际 Pi 请求、tool schema 和会话上下文由 E2E fixture 另行捕获。

### 缓存与动态内容

稳定产品契约、工作目录和稳定仓库身份留在 system prefix；日期、mode/source 快照、任务元数据、仓库变化及已选插件内容放在 user tail。含一次性 mode-change 信号的构建函数每轮只调用一次，诊断必须检查已产出的值。

本轮没有默认启用新的工具家族卸载、模型供应商专属 overlay 或辅助模型路由阈值。缩短文本本身不是完成标准，固定模型名称也不能证明某种指导对它有效。

## 4. 工具设计、检索与执行

[canonical definitions](../../packages/session-tools-core/src/tool-defs.ts) 是 session 工具的 schema、描述和宿主元数据来源。内部 `readOnly` 元数据可以影响调度，但不会授予执行权限，也不作为模型参数暴露。外部 server 的 annotations 不能取得同样的可信度。

工具检索只针对当前连接的 source 工具，遵循 SDK 的加载与 active-set 协议。空查询可列出能力，重复查询说明工具已加载；检索不会把 skill 目录加入模型上下文。

资源调度的原则是：可靠识别冲突时排序；独立工作仍并行；无法分类的效果建立进程内屏障。读取名称分类只控制并发，仍要经过宿主权限。文件资源包括现存祖先的物理路径，避免相对路径、目录 junction 和父目录扫描绕过冲突判断。队列覆盖 preflight 至 T2，运行中的操作不会因取消信号被本地宣布为已撤销。

`codemode` 外壳不持有会阻塞自身的资源锁，嵌套工具逐次进入普通执行边界。UI 交接批次使用 SDK 支持的顺序执行，宿主未确认等待时不凭工具名称强制结束会话。

### 效果与权限

- Explore 不是页面动作的授权。明确 upload、剪贴板写入/paste、任意 evaluate JS 走相应效果门禁；少量明确只读表达式与普通导航/交互保持可用。
- click/fill 的页面业务含义无法仅凭命令名确定。本轮没有声称已识别所有发送/购买/提交操作，也没有把所有交互当作 mutation。
- Guarded 的判断层可以收紧为批准，不能提升权限。Execute 仍按用户已授权范围执行，不暗中改成“每一步先问辅助模型”。
- 标签/状态可触发自动化，因此不能一概豁免；但辅助判断不会自动执行下游动作或替代其权限边界。
- 跨进程的未知外部效果继续由 durable T1/T2 与恢复对账处理。本轮队列不是跨会话分布式锁，也不会把超时当成“效果未发生”。

## 5. 任务与计划：四种事实分开

| 事实 | 当前载体 | 语义 |
| --- | --- | --- |
| 用户目标与后续纠正 | 当前请求、会话历史、恢复上下文 | 要完成什么，哪些决定仍有效 |
| 被接受的计划范围 | 宿主捕获的内容版本及批准消息快照 | 用户接受了哪个版本，不是任意同路径文件 |
| 产品任务状态 | Session 的描述、验收标准、进度、时间、依赖、父任务 | 可编辑的工作元数据，不是验收证明 |
| 已执行效果 | durable operation/tool/model 账本 | 实际进入、结算、失败或仍待对账的效果 |

[有限产品数据端口](../../packages/server-core/src/sessions/agent-product-context.ts)复制任务字段和依赖数组，既用于初始 session snapshot，也用于每轮 callback。不会把 SessionManager 或 runtime 内部对象交给 agent。[task-context](../../packages/shared/src/prompts/task-context.ts) 明确标记“非批准、非已验证完成”。已清空的字段产生空快照，避免早期上下文继续冒充当前任务信息。

已有 `update_session_planning` 仍负责写入同一份产品数据；没有增加第二套持久化任务库、强制每步建任务，或把进度 100 解释成可自动关闭卡片。依赖 ID 也不代表依赖已完成，需要查询实际状态。

完整的逐步骤执行计划状态机仍不是现有产品事实。本轮不以已有 `PlanStep` 类型或批准快照冒充该能力；是否引入应以真实长任务遗漏、重复执行和恢复失败证据决定。

## 6. Skills：保持显式选用

用户已明确确认：**默认不被模型发现、不主动启用，是设计。** 本次没有默认 skill roster、自动扫描触发、按文件 glob 启用或全局 skill search。

显式调用后的契约是：同名普通 skill 按 project > workspace > global 解析；模型读取确切 `SKILL.md`；失败或部分读取不算加载成功。缓存失效、资源读取与 source 激活重放必须保留用户原始选择。`globs`、`alwaysAllow` 是兼容元数据，不能成为自动启用或授权依据。

用户明确选用已有 plugin 后，该插件原有的 resident fragment 和原生 skill 路径按既有设计进入动态上下文；这不是向默认会话公开全部技能。插件 roster 指向 workspace materialization 的实际路径，不用同名 project skill 偷换其内容。普通 `[skill:slug]` 仍保留既有作用域优先级，没有新增包限定调用语法。

## 7. Sources 与 plugins

Source 的“用户选择”“成功建立连接”“需要认证”“当前有工具/资源/提示”是不同状态。最新快照须如实说明；资源和 prompts 可独立于工具存在，列表的分页/截断不能误报为完整目录。认证刷新成功不需要假造用户交接，真正交互式认证则等待 UI。

Plugin 是 workspace-owned 包，安装后的 skill/source 是普通原生资源。上下文说明版本、作用域和确切路径；包内容、source instructions/resources/prompts 都不能扩大授权。安装替换的确认、stdio 命令展示和重新安装语义保留既有产品契约。

来源标记和 prompt 转义有助于模型辨认数据，但不等同于强制信息流隔离。对 source、网页和插件注入的抵抗，不能仅凭 wrapper 或一条“不信任数据”指令宣布通过；也不应为加 wrapper 破坏工具原有 JSON 结果与 codemode 的结构化消费。

## 8. 验证与后续决策标准

重复入口为 `bun run verify:model-harness`。场景覆盖真实权限/处理器、中文检索、完整读取和资源生命周期；真实 Pi/Host/SQLite 验证失败读取恢复、计划确认与暂停、同资源 T1/T2、后续调用抑制、工具结果配对、任务修改及重建。每次运行输出 JSON、轨迹及带源码/产物哈希的 manifest。

新增纯分类端口同时进入公开端口与传递纯度检查；直接或间接引入文件系统的变体被拒绝。原有 durable crash、runtime/governance 边界和相关 prompt/source/plugin 回归用于检查已有能力未被破坏。

尚未取得的证据包括：真实 provider 的行为质量与 token/缓存收益、原生页面点击/提交的业务效果、交互式 OAuth、Linux 原生隔离及发布包验证。这些不能用 fixture 成功代替。

后续策略变化必须回答三个问题：是否减少了实际任务失败或不必要中断；是否保留能力与授权边界；是否有可复现对照。适合优先评估的变量是工具家族暴露预算、辅助模型是否带来净收益、长任务恢复遗漏及真实页面语义。skill 默认发现不在候选变量内，除非用户改变设计要求。
