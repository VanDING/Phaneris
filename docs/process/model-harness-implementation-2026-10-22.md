# Model harness implementation

Branch: `codex/model-harness-implementation`

Baseline: `8531313baa5088df83c7dcf0332bbf1801be80dc`

目标：使模型所见能力、权限、执行结果与任务状态一致，减少错误拒绝和不必要的等待。

## 已确认的设计约束

- 2026-10-22 用户确认：skill 保持当前默认不被发现、不主动启用的状态。这是产品设计，不作为缺陷或待补能力。
- Skill 相关改动限于现有显式调用后的加载确认、缓存一致性、资源解析与任务连续性；不新增默认技能目录注入、自动发现或主动启用。
- 本轮工具检索改进针对已连接 source 的工具，不扩展到 skills。

## 实施顺序

- [x] 首批能力真实性：联网名称与权限、effective mode、无效参数、Windows 平台说明。
- [x] 结果生命周期：计划提交等待宿主确认；认证结果决定继续或等待。
- [x] 工具发现：中文、重复查询、目录入口；继续使用 SDK 的 canonical active set。
- [x] 首批技能与来源连续性：成功/完整读取确认、缓存失效、原始 mention 重放、source 交付确认。
- [x] 计划接受版本：桌面、远程接受及压缩后接受保留内容快照；恢复保留目标和批准范围。
- [x] 提示词事实修正、插件来源与作用域、后台状态说明。
- [x] 类型检查、相关回归、真实 Pi 子进程集成。
- [x] 第二批：资源冲突调度、交接屏障、浏览器明确效果门禁、Guarded 自动化副作用判断。
- [x] 第三批：主 prompt 模块与组装清单、既有任务字段的实时投影、空快照与提问语义修正。

## 审查结论与保留边界

- 全面职责审查、问题处理及策略决策标准见[模型交互系统基线](../architecture/model-facing-harness.md)。
- 普通 skill mention 保持既有作用域优先级；已选插件按确切原生路径取资源，不引入新的包限定调用语法或默认发现能力。
- 已将现有任务字段实时投影给模型，不创建第二套任务状态库。完整逐步骤执行计划状态机不是现有能力，也没有以批准快照或进度字段冒充它。
- 模块化与组装诊断已落地；工具家族默认卸载、供应商 overlay 和辅助模型策略需要真实行为对照，不为形式上的完整性直接切换默认值。
- 浏览器点击/提交的业务语义、实际下游自动化、真实 provider、原生浏览器、交互式 OAuth 与 Linux 隔离仍需对应环境的证据。当前 fixture 验证不替代这些证据。

## 首批验证

重复执行入口：`bun run verify:model-harness`。

- 21 个契约集成场景：真实权限函数、工具处理器、资源生命周期；模拟宿主与目录，不调用线上模型。
- 6 个真实 Pi 子进程场景：实际 SQLite/T1/T2、失败读取恢复、宿主确认、计划暂停和下一轮继续；推理由 loopback fixture 驱动。
- 566 项相关既有回归通过；session-tools-core 的 131 项通过；pre-tool-use 73 项通过；prerequisite 33 项通过；prompt 19 项通过、1 项平台跳过；桌面批准、pending dispatch/persistence、plugin 合计 19 项通过。这些集合有重叠，不汇总为独立用例总数。
- `typecheck:all`、全仓 `lint`、`check:docs`、i18n coverage/parity/sorted/dead-keys、`identity:check` 和 `version:check` 均通过。文件行数预算保持原值。

每个 workflow 在 `.cache/verification/` 下生成独立目录，包含场景结果、调用轨迹、数据库证据及带源码哈希的 manifest。未把 fixture 推理结果当作真实模型质量收益。

## 第二批：执行顺序与效果边界（实现前失败矩阵）

1. 同一文件的写/读或写/写并行进入 T1，无法保证模型给出的调用顺序；独立文件读取应继续并行。
2. 相对路径、绝对路径、目录 junction 指向同一文件时，必须识别为同一资源；目录扫描与子文件写入冲突。
3. 等待中的写入不能被后来的同资源读取持续越过；取消等待不能留下死锁或执行已取消的操作。
4. 任意 shell/script 与未分类操作具有不透明效果，应与其他效果建立屏障；codemode 外壳不能持锁阻塞自己的嵌套工具。
5. SubmitPlan/认证交接与同批写操作并发。交接前的操作应结算，进入等待后不能再启动后续操作；静默 OAuth 成功仍可继续。
6. 外部 server 的 annotations 不能成为内部并发/权限元数据；会话工具的 readOnly 由 canonical 定义传递。
7. Guarded 的标签/状态豁免跳过自动化副作用评估，应恢复正常判断；不将所有点击或输入一概视为写入。
8. 外部调用取消后的真实效果未知，继续由 durable T1/T2 与 recovery_parked 对账，不用本地队列将其宣布为失败或成功。
9. Pi 复用的共享分类端口必须是显式公开且传递纯净的模块；不能为并发调度引入宿主 I/O 或绕过现有架构门禁。

验证先建立调度契约场景，再使用真实 Pi 子进程与 SQLite 检查同文件 T1/T2 顺序、交接后的后续工具抑制；浏览器原生 UI 和线上服务仍另行验证。

### 第二批落地与验证

- 调度覆盖 preflight 至 T2；同文件、目录/子路径、相对路径与 junction 别名冲突按顺序执行。独立读取、常规 source 只读请求和独立文件工作保留并行；未知效果使用屏障。对外部工具名称的读取分类只影响调度，权限仍由宿主管线判断，不采信 server annotations 作为授权。
- SDK 中含潜在 UI 交接的批次按顺序执行；确认进入等待后不再启动后续调用。codemode 不持有外壳锁，嵌套调用各走原有权限、调度和 durable 边界。
- 浏览器命令解析抽为共享纯模块，执行与门禁使用同一分词/批次规则。Explore 阻挡上传、剪贴板写入/paste 与任意 JS；Ask/Guarded 确认这些操作。明确只读表达式和普通导航/交互保持可用；这不代表能仅凭 click/fill 命令证明页面操作无副作用。
- Guarded 标签/状态更新回到普通判断，并向判断层说明可能触发的自动化事件；未改变 Execute 的授权执行语义。
- 新增 17 个效果/调度契约场景、6 个真实 Pi/SQLite 顺序场景；后者检查相对路径与 junction 写入的 T1/T2 间隔、最终文件内容、交接前结算、交接后无 T1、下一轮工具调用/结果配对。
- 共享分类端口纳入公开端口与传递纯度检查，直接及间接引入文件系统的变体均被拒绝；原有 governance 边界工作流继续通过。
- 原有 21 个契约场景和 6 个真实 Pi 场景继续通过；相关既有回归 114 项通过。runtime-boundary gate 拒绝 25 个违规变体，durable crash 的 8 个场景通过。
- 本次队列只负责单个 Pi 进程内排序，不是跨会话/跨进程文件锁；未知外部效果仍依赖持久化记录与对账。真实模型质量、原生浏览器和线上 OAuth 未以模拟推理代替验证。

## 第三批：prompt 组装与任务投影

实现前工作流首先复现了：缺少有来源的组装清单、任务描述/验收标准未进入 session snapshot、产品修改未进入每轮上下文。补充失败场景覆盖清空任务后旧字段回流、未回答的问题被误当作许可，以及 Windows 调试上下文仍指导使用 Bash。

- 主 prompt 拆为 13 个有序内容 section，由行为契约和产品工作流两个纯内容模块构建；宿主只捕获一次功能状态，外层再组装偏好、项目、debug、指令文件索引和环境事实。mini 保持独立既有行为。
- 提取前固定了三平台、四个二值开关的 48 组内容基线；模块提取字节一致。随后只单独修正未回答问题的语义，矩阵显式登记这条变更并对其做基线归一化，其余内容仍逐字校验。
- `compileSystemPrompt()` 返回实际文本与同源 sections；`print:system-prompt --json` 输出模块来源、字符/字节数和哈希，内容须显式 `--include-content`。不将字符数称为 provider token。
- 复用 Session 的描述、验收标准、进度、时间、父任务和依赖字段。有限数据端口复制数组，在初始快照及每轮读取，模型上下文明确它不是批准或完成证明。空快照覆盖历史任务元数据；静态 system prefix 不随看板修改变化。
- 7 个组装/任务契约场景通过，其中包含 48 组内容基线；4 个真实 Pi/Host/SQLite 场景验证首次投影、同 agent 下一轮更新、重建后当前状态及缓存前缀不变。
- 任务投影不新增计划工具或自动关闭规则；`update_session_planning` 继续写入既有产品状态。默认 skill 不发现、不主动启用保持不变。
- 第三批相关既有回归 60 项通过、1 项平台跳过；session owner 工作流继续通过。全仓 `typecheck:all`、`lint`、`check:docs`、`identity:check`、`version:check` 通过。

### 本地复核入口

```sh
bun run verify:model-harness
bun run scripts/verification/session-owners-workflow.ts
bun run scripts/verification/governance-boundaries-workflow.ts
bun run typecheck:all
bun run lint
bun run check:docs
```

最新主 workflow 包含 21 个首批契约、17 个效果/调度契约、7 个 prompt/任务契约、6 个基础 Pi、6 个顺序 Pi、4 个任务投影 Pi 场景。48 组内容组合包含在 prompt 契约场景内，不作为独立 E2E 数重复相加。所有结果仍以各次运行的 manifest 和明确未验证范围为准。

## 实现前登记的失败场景

1. Explore 将 namespaced web 工具拒为配置变更，Ask 对其弹 mutation 审批。
2. 不可信 source 使用内部工具后缀获得 allowlist 权限；未知操作静默放行。
3. Guarded 未启用时状态仍仅报告 Guarded，而实际执行 Ask。
4. `call_llm` 宣告不生效的 thinking 参数；平台说明引用不存在的 shell。
5. SubmitPlan 在宿主读取/展示完成前返回成功；宿主异常没有传回工具。
6. OAuth 静默刷新无需用户交互，仍因为工具名中断会话。
7. 中文检索零召回；重复查询误报没有匹配；空查询没有目录。
8. 读取失败、部分读取被当成技能完整读取；技能修改后目录不更新。
9. source 激活重放丢失原 skill 选择；旧 source 状态压过新状态。
10. 接受的计划路径不核验、内容版本未绑定，压缩后丢失批准范围。
11. plugin 上下文没有来源/版本/作用域；后台工具被描述成所有子任务的唯一状态来源。
12. 同资源并发、未知外部结果重试、真实模型质量收益，需要单独 E2E，不能用局部测试冒充。

首批验证先覆盖 1–7 的真实函数与宿主/工具边界，输出 JSON。真实子进程测试沿用现有 durable-runtime-pi workflow。后续场景在对应实现前扩展失败用例。

本轮不覆盖用户已有的 packaged-client 验证结果、`.analysis-tmp/` 和 `x.ts`。
