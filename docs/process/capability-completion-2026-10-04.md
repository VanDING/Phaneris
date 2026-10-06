# 能力整合完整性复核与补齐

依据：本线程最初批准的七个工作包及 A–E 批次。2026-10-04 用户要求核实完整性并继续完整实施。上一轮完成了主要机制，但不能把机制验收等同于原计划的全部产品与收益验收。

随后用户指定升级 Pi SDK 至 1.0.2。升级与 MCP / classifier / 路由的最新条件评估见 [1.0.2 升级记录](./pi-sdk-1.0.2-upgrade-and-convergence-assessment.md)。本记录中的真实 DeepSeek 对照使用 Pi 1.0.0；升级后只复核本地回环流程，未重放付费请求。

| 项目 | 复核时状态 | 本轮闭合要求 |
|---|---|---|
| A 输入确认 | SDK / 宿主回执已实现，renderer 更新丢字段且缺少状态入口 | 持久保存与 SDK 接收分开显示；相同文本按身份关联；迟到回执不重启运行、不退回队列 |
| A 模型 / 目录 / 体积 | 已实现，离线目录及预算通过 | 保持既有默认配置；核对实际模型与推理观测 |
| B 工具与编排 | 机制通过，缺少代表性收益对照 | 多 Source 同任务，记录 schema 字节、实际模型轮次、首工具与总耗时、观察用量；交付带引用文件 |
| C 决策 | 记账通过，缺少分组业务评测 | 全部功能的成功、低置信度和故障路径；报告误判 / 人工纠正的样本来源及未测范围；不将模拟响应当成模型质量 |
| C classifier | bool / choice 契约对照，尚未证明完整替换 | 覆盖真实产品请求形状、失败与预算；符合契约才允许选择，未等价保留旧适配 |
| D 工作台 | 编辑与冲突通过，复杂语法覆盖不足 | 公式、Mermaid、任务列表、链接、图片、注释混合文档保存 / 提交 / 接受逐字保留 |
| D 长会话与规划 | 性能样本已有，交互和共同事实验收不足 | 搜索 / 引用 / 复制 / 实时增量以及任务日历 / 表格事实一致性 |
| E 原生 MCP | 配置契约审计，未做 Source 运行对照 | 使用同一回环 MCP Source 比较宿主与 Pi 原生连接、工具结果、撤销与资源归属；实测后明确迁移结论 |
| E 路由 / 更多节点 | 原计划为条件采用 | 不用名称替换代替行为等价；记录条件和证据，未满足不默认启用 |
| 发布目标 | Windows 解包验证，外部运行条件缺失 | 本机可重复产物检查；真实 provider / OAuth、签名、其他平台与容器独立列出，不标为完成 |

## 产品改动前记录的失败路径

- 回执：optimistic ID 与 canonical ID 不同；相同文本被内容匹配误合并；回执更新丢弃；queued 回执与宿主排队混淆；SDK handled 被误称模型已读取；迟到回执改变已完成运行；旧历史无回执；状态文案泄露底层术语或未翻译。
- 对照：采用不同输入、Source、延迟或文件口径；使用上游比例替代本机值；模拟 provider 费用冒充真实费用；工具 schema 字节冒充 provider token；未实际发现工具便声称按需检索通过。
- 决策：只验证 happy path；阈值边界、低置信度或失败改变既定 Guarded 策略；通过率分母漏掉失败；未记录人工复核或无数据时编造误判率；成本缺价被当成免费。
- 文档：复杂语法被初始归一化重写；源码保存时注释、URL、图像或公式丢字；撤销后受控草稿不同步；提交版本与最终接受版本不一致。
- 原生 MCP：测试绕过真实 transport；原生路径读取 ambient mcp.json / 凭据；断开 source 后旧工具仍可调用；连接残留；annotations 被当成批准；将单 Source 局部结果推广到 OAuth / 远程场景。
- HTTP MCP：升级后的无状态 transport 不能跨请求复用；并发客户端的 request ID 冲突；响应结束或客户端退出后 transport 未清理；停止服务时仍有连接。每个请求使用独立协议实例，Source 连接池仍由宿主拥有。
- 原生观测：请求模型和最终响应模型混淆；请求推理档位被冒充实际推理档位；provider 流日志泄露文本 / 工具参数 / 凭据；每个流片段写一条诊断造成无界增长。只记录一次请求中首个事件的类型和模型身份，结束时记录 SDK 实际返回的模型与可选推理档位；缺失时明确未知。
- 长会话：平均耗时掩盖单次超限；搜索跳转到错误消息；引用和复制缺字；实时增量重复或覆盖已有历史；任务状态在日历 / 表格之间分叉。验收预算限于本机合成工作负载，所有单次样本都保留。
- 启动测量：拦截所有本地资源导致测试驱动往返被算入产品启动；缺少资源和 RPC 阶段数据时误判原因；只选快的一次掩盖慢样本。只拦截外部网络，保留各次资源 / RPC 元数据与原失败，不记录请求或响应内容。
- 图标读取：同一工作空间 / 文件的多个可见组件并发读取；不同工作空间同名文件误共享；清理缓存后误复用旧的在途读取；失败结果被长期缓存；主题化结果被作为另一主题的原始文件复用。生产 E2E 先记录逐导航的文件身份、结果类型与重复读取，使用现有图标失效入口清除在途索引，只共享原始读取，不新增持久成功或失败缓存。
- Skill 预取：宿主已经发现 `iconPath`，renderer 又为明确没有文件或配置图标的 Skill 探测多个不存在文件；增加启动 RPC，但仍缺图。生产 E2E 用实际 `getSkills` 的已解析元数据筛出无图标项，断言不对这些项重新探测；emoji、URL、已发现文件继续预取，图标变更沿 Skills 元数据更新。
- 权限状态渲染：启动对每个 Session 分别写入整个 options Map，使 AppShell 重复渲染；相同版本 / 模式 / previous mode 仍产生新 Map；批量到齐期间的较新事件被旧版本覆盖。保持原版本检查和故障处理，将初始 / 列表刷新结果收齐后集中应用；单会话实时对账仍即时应用。新增前的 startup CPU 诊断（不算验收通过）定位到 AppShellContent。

验证优先 E2E，每项保留 JSON、截图或文件。失败方式先于新增产品代码记录；不追加镜像单测。原始首次失败保留，不用复跑掩盖。

## 七个工作包的实施结论

| 原工作包 | 实施与补齐 | 验收依据 |
|---|---|---|
| 1. 输入、模型与诊断 | 宿主保存 / SDK 接收分开；canonical ID 与 optimistic 别名；迟到回执只更新消息状态；内置模型采用 SDK 元数据；去掉旧 DeepSeek 注入；记录实际 provider / model 与可选推理信息 | SDK JSONL、回执 UI、离线目录工作流；未知接收不自动重放，未知实际推理档位不冒充请求档位 |
| 2. 工具契约与受管编排 | 全部 schema、annotations、structuredContent / blocks；按需发现、codemode；嵌套 T1/T2、父 ID / ordinal、权限与取消；修复 MCP 1.32 无状态 transport 跨请求复用 | 单 Source 真实 HTTP 5/5，含 8 并发；三个 Source 的真实 DeepSeek 成对任务与 codemode 报告 |
| 3. 13 项决策能力 | 独立辅助请求记账、outcome / follow-up、未知费用；15 个检查点正常 / 不确定 / 故障；原生 classifier 12 支持 / 3 不等价；保持功能 opt-in 和 System One 默认 | 本地 46 项策略与关联检查；DeepSeek 语义参考 14/15，完整协议 3/15，不伪造置信度 |
| 4. 确定性治理与任务预算 | tool_call 规则只增加阻断；不授予权限；未知 AgentEvent 显式显示；可选无进展上限；辅助用量、跨重启预算及历史基线 | SDK、Task 和决策治理工作流；更多 Task 节点保持执行前拒绝，按条件独立采用 |
| 5. Artifact 与图像 | 真正的可视化 / 源码编辑；初次序列化有损时不写回草稿；revision / lease / CAS；生成结果校验、取消及用量；按模型生成图像请求副本、历史文本恢复 | Markdown 5/5，混合中文、公式、Mermaid、任务列表、URL、图像、HTML 注释、表格逐字保存 / 提交 / 接受；图像 5/5 离线验收 |
| 6. 性能、规划与分发 | 保留首屏 4.8 MB gate；本机长会话硬预算；搜索、引用备注、复制、实时合并；日历 / 表格共享 Session；独立 worker / WASM 资源 | 生产 WebUI 基线与 smoke；全仓库 gates / tests；Windows 解包、隔离启动、仓库外 Pi 子进程 |
| 7. 文档与兼容层 | 能力采用表、实测收益、版本、入口、证据、回退；历史上游 / SDK / 依赖文档标为快照并链接本次结果；双语 README 同步 | [采用与回退指南](../architecture/capability-adoption-2026-10.md)、原始批次记录及本记录 |

E 的全面迁移是原计划中的条件项。本次单 Source 对照推翻了“原生 MCP 必然引入第二个 Source 所有者”的假设：注入配置与凭据后可以保留宿主所有权。实际 HTTP、结构化结果、撤销和并发已证明；远程 OAuth、重连恢复和稳定收益尚未证明，全面替换继续暂缓。Radius 默认路由、classifier 全面替换、更多 Task 节点也按原计划条件保留，不能仅因 SDK 有接口便切换默认行为。

## 真实模型对照

模型为用户指定的 `deepseek-flash`，Pi 1.0.0，thinking 显式 disabled。只使用固定合成数据和现有连接的凭据读取，不发用户文档、不改用户配置。凭据不进入报告；14 次真实请求共用累计预算，未清空账本重跑。

| 项目 | direct | deferred |
|---|---:|---:|
| 首轮 schema 字节 | 72,493 | 11,851 |
| 各轮 schema 字节合计 | 144,986 | 133,993 |
| 模型轮次 | 2 | 4 |
| 首业务工具 ms | 2,781.88 | 6,208.54 |
| 总耗时 ms | 5,077.35 | 9,208.46 |
| 费用估算 USD | 0.006970008 | 0.006084264 |
| 六组证据 / 引用报告 | 通过 | 通过 |

首轮占用减少 83.65%、估算费用减少 12.71%，但本样本延迟增加；这是一个带缓存差异的成对样本，不是普遍收益承诺。codemode 另一个带批量指令的样本完成六个受管读取，但一次流失败费用未知，不与上述两条路径作费用优劣比较。

13 次已知用量费用估算合计 0.017655468 USD，一次未知请求保留 0.0171699 USD 预留额，总预算占用 0.034825368 USD。数字依据 provider usage 和峰时目录价格推算，未核对账户账单。上限为 16 请求 / 0.10 USD，后续本地验收不再发起付费请求。

决策参考使用实际产品请求抽取的 15 个固定案例，标签由 agent 整理。简化语义标签 14/15；Guarded 的一个分类差异仍沿原策略提示用户。完整 System One 协议仅 3/15 合格，另一次强化提示无效 JSON。故保持默认适配，不把模型自报 confidence 当成经校准概率。人工纠正率、生产误判率、原生 classifier 模型质量、每个功能的真实延迟无足够样本，留空，不以本地回环响应替代。

## 可重复验收

本地汇总入口：`bun run verify:capabilities`，13 个顺序 stage；所有阶段使用隔离目录 / 回环 provider，无真实付费调用。`.cache/capability-integration/summary.json` 记录各 stage、源码工作树快照和 Pi bundle SHA-256；JSON、日志、截图与最终文件保留在同目录。

| 证据 | 路径 / 复核方式 |
|---|---|
| 输入与 SDK | `workflows.json`、`input-reception.json` / PNG |
| 原生 HTTP Source | `native-mcp-source.json`；真实 transport、撤销、关闭及并发 |
| 决策 | `decision-features.json`、`decision-governance.json`、`classifier-comparison.json` |
| 真实模型与总预算 | `multi-source-comparison.json`、`multi-source-direct.md`、`multi-source-deferred.md`、`multi-source-codemode.md`、`live-deepseek-budget.json` |
| 决策参考失败与语义 | `decision-chat-reference-first.json`、`decision-semantic-reference.json`、保留的 malformed JSON 运行日志 |
| Artifact 与图像 | `markdown-editor.json` / PNG、`mixed-markdown-accepted.md`、`images.json` |
| 生产交互、性能与共同事实 | `performance-completion-final.json`、`.table.png`、`.calendar.png`，以及汇总 stage 的 `performance-capabilities.json` |
| 三个 Vite 配置 | `vite-config-native-final.log`，Node 原生 / bundle 加载的路径和构建选项一致；Viewer 原生加载生产构建 `viewer-native-completion-final.log` |
| CI / 全仓库测试 | `validate-completion-final.log`、`workspace-tests-completion-final.log` |
| Windows 当前产物 | [解包结构](../verification/results/packaged-client-verification-win.json)、[隔离启动](../verification/results/packaged-client-smoke-win.json)、`packaged-sdk-workflows.json` |

性能测量使用实际生产 WebUI、WebSocket RPC、SessionManager、合成离线数据与本机 Edge。100 / 1,000 / 5,000 条消息、24 个后端历史、50 deltas/s、60 秒真实 idle；加速时钟只用于驱逐检查。输入测量为 DOM 更新后两个动画帧的代理，内存为采样值，不是硬件呈现或峰值。固定预算：冷打开 / 导航 3,000 ms、暖切换 2,000 ms、输入 250 ms、首增量 1,500 ms、renderer heap 256 MiB、backend RSS 1,024 MiB；单次值均保留，不能只用均值掩盖超限。

首屏初始 JS 由 4,967,600 B 降至 4,267,991 B（14.08%），原 4,800,000 B gate 未上调。混合 Markdown 原始失败、MCP transport 原始失败、真实协议失败均保留。性能脚本发现 FullCalendar 7 的 class 不再稳定后，改用产品已有的 `data-calendar-entry` 标识验收，未改变日历产品逻辑。首次导航门限失败记录为 `performance-navigation-budget-failure.json` / log；最终由浏览器策略阻断外网，避免每个本地资源经测试驱动转发，并保留资源和 RPC 元数据，门限未提高。

最终复核初次运行还出现两个现有 workspace 用例超时（ESLint 初次加载 5 s、Pages Vite 构建 30 s），记录在 `workspace-tests-completion-concurrent-failure.log`；串行复核保持原测试时限。回执夹具的 Vite 冷优化超过默认 30 s 导航准备时间，记录在 `input-reception-vite-bootstrap-failure.log`；该开发准备等待改为 90 s，并修正 `waitForFunction` 的 options 位置，生产性能门限保持不变。失败后的 JSON 现在显式记录 bootstrap 失败，不会出现空记录被误认成功。

继续定位发现实际产品问题：两次导航 296 次图像 RPC，其中同一个状态 SVG 在单次启动被读 8 次；`icon-startup-before.json` 的生产 E2E 在产品改动前明确失败。新增共享在途文件读取与目录发现，按工作空间、路径隔离；既有 Source / Skill / Status 清理入口同步失效索引，不新增持久失败缓存，仍使用原 SVG 主题处理与扩展名优先级。两个 timeout 用例单独执行 7/7，ESLint 108.22 ms、Pages 构建 2,472.12 ms；最终全仓库串行执行结果另记。

共享读取后又由 `skill-icon-prefetch-before.json` 证明：宿主元数据已解析 25 个无图标 Skill，renderer 仍发起 200 次缺失文件探测。RichTextInput 改为仅预取已发现文件或明确配置图标。最终在途重复成功读取为 1、无效 Skill 探测为 0，图像 RPC 合计 40。初次 URL 函数过滤仍触发 Playwright 的全资源拦截（本地安装源码 `RouteHandler.prepareInterceptionPatterns` 对不可序列化 matcher 返回 `**/*`），原失败记录为 `performance-route-filter-failure.json`。离线保护改为夹具 HTTP CSP，由浏览器阻断外网，本地资产不经过测试驱动暂停；这是测量方法修正，未提高预算或改动产品 CSP。

## 发布与外部环境边界

本轮只对当前 Windows 本机产物做解包资源、版本、隔离启动与仓库外子进程验证；未覆盖签名、安装 / 升级 / deep-link 注册、macOS / Linux、Docker、所有真实 OAuth / 远程 MCP 服务或付费图像生成。操作系统 IME 的完整组合输入也未由 Playwright 文本插入代替。

这些项目属于外部发布或连接环境的验收条件，必须在对应环境独立运行，不能标成已通过。本轮未提交、推送或发布。当前分支为 `codex/capability-integration-20261003`。

## 最终检查状态

当前 SDK 为 1.0.2。`validate-pi-1.0.2.log` 和串行 `workspace-tests-pi-1.0.2.log` 均通过；Electron / WebUI / Viewer 构建与首屏 4.8 MB gate 通过。补丁专用验证 5/5；13-stage 汇总 **12/13**，失败仅为首屏导航 3,000 ms 门限。输入回执 UI、SDK 8/8、原生 MCP 5/5、全部决策 46/46、classifier、Task、图像、Markdown 与采用审计通过。

完整生产基线 `performance-pi-1.0.2-baseline.json`：首次 / 第二次导航 3,119.07 / 2,527.57 ms；100 / 1,000 / 5,000 消息的首次选择 299.26 / 543.00 / 977.53 ms（100 消息此前已由导航打开，后两项为未打开历史）；全部暖切换 216.93–517.13 ms；输入三个样本 70.89 / 32.37 / 34.33 ms；首实时增量至两帧 411.04 ms；采样 heap 43,886,588 B，backend RSS 162,308,096 B。搜索、引用并持久保存、复制、增量合并、日历 / 表格事实一致性通过。60 秒真实 idle 已执行；完整报告因首次导航超过门限仍为失败，不能称全部性能验收通过。

最终 smoke `performance-capabilities.json` 保留七类独立预算结果，避免第一项失败掩盖其余项：导航失败（3,570.14 / 1,681.93 ms），首次选择、暖切换、输入、首增量、heap 和 RSS 六类通过，browserErrors 为空。完整基线与 smoke 都保留，未只选快速样本或提高门限。此前 1.0.0 初次基线的首次导航 3,194.76 ms；本轮新增的 3,000 ms 目标在该历史样本中也未满足，不能把这一目标冒充原先已经通过的发布标准。

当前 Windows 解包结构 8/8，隔离启动 5/5，随包 Bun 在仓库外 SDK 工作流 8/8。SDK bundle SHA-256 为 `f4376e709320d621c5f4397954dc0629ddc3c46c1e51a17b04e808d265fd9632`；源码构建、Electron 暂存及解包的 bundle、worker、WASM 全部相同。完整证据见 [Pi 1.0.2 升级记录](../verification/results/pi-sdk-1.0.2-upgrade.json)。

**结论：SDK 1.0.2 升级与条件评估完成；原整合计划的首屏导航目标仍未闭合。** 条件式原生 MCP / classifier / 路由迁移保持原有默认路径，缺口按最新评估记录。外部发布目标仍按上节分别验收；本轮未提交、推送或发布。
