# 上游 0.14.0 B4–B5 实施记录

授权：用户在首批提交 `f4846428` 后要求“完整实施完，B4-B5”。继续使用 `codex/upstream-0.14.0-absorption`，固定上游 `73bd9c2a3573158bea880984eb8d5fdb41e0cac2`。保留 Phaneris 0.2.4、Pi SDK 1.0.0 和 Durable Runtime 权威。

## 实施前失败矩阵

以下场景在本批产品代码修改前确定。新增验证优先采用真实宿主流程、loopback 决策服务、真实浏览器和最终客户端，输出可复核报告。危险命令只判定，不执行；不向真实 provider 发送测试消息。

| 功能 | 失败方式与验收边界 |
| --- | --- |
| 开关 / 设置 / 远程 RPC | 13 个开关缺失、默认值改变、旧配置丢字段、切换 provider 泄露旧 endpoint/key、远程设置误写本机、鉴权绕过；主开关与新增十项默认关闭，远程调用使用目标服务器 vault 并受既有认证保护 |
| 任务裁决 | 覆盖显式 VERDICT、低置信度误判 PASS、取消后完成、遗漏 inference 来源；仅无显式裁决时辅助判断，失败按原 re-ask，保留日志和预算 |
| 任务返工 | 接受不存在节点、错误依赖闭包、重复返工、预算失效、局部修复后遗漏失败；显式 nodes 优先，建议只缩小首轮，后续可回退全 DAG |
| 语义标签 | regex 退化、semantic/value/threshold 未保存、同标签重复询问、异步结果跨会话/被删会话写回；保留 regex/模板，仅可靠语义匹配追加合法值并持久化 |
| 轮次结果 | 待输入/受阻被算完成、子任务误终结、手动状态被异步覆盖、取消/新轮旧结果写回；区分完成/待输入/受阻，Needs Review 更新可追溯，任务完成消费者保留真实结果 |
| 自动化条件 | 无条件也调用模型、循环成本放大、失败跳过任务、编辑丢条件/Telegram topic、异步重复触发；先防循环再条件，明确 false 才跳过并记历史，不可用继续原路径 |
| 标题 | 闲聊消耗标题、旧标题不更新、覆盖手工标题、异步新消息竞争、语言/持久化丢失；智能 gate 可选，保护手动修改并核对轮次 |
| 风险标记 | 模型批准替代确定性审批、取消后幽灵卡片、敏感参数原样入日志、旧客户端不兼容；只补影响说明，deadline 有界，保留 canRemember/admin broker |
| 大结果 gate | 未设置 callback、Pi 协议未应答/悬挂、超时不摘要、请求身份错配、持久化正文丢失、pre-tool 结果变化；无答案仍摘要，原始结果先落盘，宿主↔Pi 有界往返与取消 |
| 能力建议 | 空候选、已启用 source/skill 重复提示、越权启用、hidden/任务会话发建议、原始配置泄露、follow-up 不关联；只提示当前候选，不启用或读取，记录实际使用与未采用 |
| Guarded | 无功能仍静默执行、模型低风险覆盖 admin、外部写入、模式切换/取消后放行、无人应答挂起、子会话提权；主开关或 Guarded 开关关闭时回 Ask，已开启时单次失败可继续执行（用户明确选择上游策略），模型只能增加审批，保持四模式权限上限 |
| 自适应思考 | 升高用户档位、覆盖持久化偏好、停止/重试/异常不恢复、任务/hidden/无人值守误启用；只降低本轮，重试保持，结束恢复用户当前设置 |
| 中流消息 | steer/queue 分流丢消息、附件被文本合并、Durable 接收遗漏、压缩/handoff 期间乱发、异步分类跨轮、合并丢 ACK/消息身份；先持久化接收，每条输入均确认，合并只改变模型输入，保护附件/选项/压缩/handoff |
| 全仓回归与产物 | 新模式枚举不完整、UI/快捷键/RPC 校验不一致、i18n 漂移、Pi SDK/独立身份退化；完整类型门禁、相关既有回归、宿主/浏览器验收、最终 Windows 包结构与启动验证 |

## 产品策略

共有 13 个独立开关。主开关及新增十项默认关闭，原有 `decideTool`、`taskVerdicts`、`semanticLabels` 的默认值继续为 true；不重置现有用户配置。用户明确选择“上游策略：单次决策失败可继续执行”。主开关或 Guarded 开关关闭时，Guarded 的有效模式为 Ask；功能已开启时，单次决策超时、缺答案或失败保持原 Execute 路径。界面只在目标服务配置就绪时提供新增 Guarded 选项；服务故障仍属于单次失败。活动 Guarded 检查对工作目录外的直接文件写入确定性要求批准，包括 junction 和尚未创建的子目录；现有管理员审批和 Explore 拦截保持权威。Guarded 风险检查不用于任务、自动化、hidden、mini、CLI run 等无人值守会话，与上游一致；这些入口仍保留本仓的权限应答与拒绝机制。

## 实现对应

| 批次 / 功能 | 落地行为与本仓适配 |
| --- | --- |
| B4 任务裁决与返工 | 显式 VERDICT 优先；缺失时按高置信度推断，否则沿用原 re-ask。裁决来源与置信度经 run log、RPC 到结果界面；任务事实先进入 Durable Runtime，再写兼容投影。只在首轮无显式 nodes 的返工中缩小范围，连同依赖闭包执行；后续恢复全 DAG，保留返工预算 |
| B4 标签与轮次结果 | regex 与 semantic 规则共同保存、验证、执行；语义匹配去重并保护手工标签修改。轮次识别 finished/needs_input/blocked，保护手工状态与新轮次；无人值守任务需要输入时失败，不误报完成 |
| B4 自动化条件 | 配置、RPC、界面序列化保留 semanticCondition；先执行循环防护，再判断条件。明确 false 才跳过并写历史，不可用沿用原执行路径；同一事件批次去重 |
| B4 标题与风险标记 | 闲聊不立即生成标题，主题变化可刷新，保护手工名称与新消息。审批卡片立即展示，再异步补充风险标记；不代替批准、不重复通知，保留 canRemember 和管理员 broker |
| B4 大结果与能力建议 | 原始工具结果先保存，再经宿主↔Pi 的有界 JSONL gate 决定是否摘要；失败回原摘要路径。建议只使用当前可用且未激活的候选，加入本轮临时上下文，不自动启用；记录实际采用与关联 follow-up，不污染原始用户消息 |
| B4 设置与远程 RPC | 13 项开关、七种语言、分组设置、使用说明与发行说明；七个决策 RPC 受原认证保护，使用目标服务器配置和加密 vault，本机配置不被远程操作改写 |
| B5 Guarded | Explore/Ask/Guarded/Execute 四模式、子会话权限上限、动态选项与快捷菜单、工作区默认值；普通批准和压缩后批准计划都恢复此前的 Guarded。取消、切换模式及关闭功能后的迟到决策重新按当前权限判断 |
| B5 自适应思考 | 只降低本轮，不改持久化偏好；暂停、错误、重试后恢复用户当前档位。用户在等待决策时降低档位，旧建议不能将其升高；排除任务、隐藏及无人值守入口 |
| B5 中流消息 | 区分纠正 steer 与排队请求，只合并可靠的纯文本续句。附件、特殊选项、压缩、handoff 保持原路径；防止旧结果跨轮 steering。每条输入先写 Durable 接收记录，再 ACK；模型输入可合并，原文、气泡、ID 和提交边界分别保留 |

新增验收使用真实 SessionManager、Durable journal、TaskRunner、认证 WebSocket RPC、loopback HTTP 决策服务、Pi JSONL 子进程与生产 React 组件。沿用并修正了既有回归夹具的资源清理和默认值断言，未新增实现镜像式单测。

## 实施与验收

2026-10-03：**B4、B5 完成；连同首批 `f4846428`，B0–B5 的批准实施范围已落实。** 交付位于 `codex/upstream-0.14.0-absorption` 的隔离工作树，以本地提交保存；未推送或合入 `main`，未全量覆盖上游目录或依赖。产品版本仍为 0.2.4，Pi SDK 仍为 1.0.0。

产品代码修改前的初始检查为 **0/15 通过**；实施期间增加了真实宿主和浏览器流程，所以前后检查总数不能直接作为修复数量相减。最终证据与源文件、日志、安装包哈希见 [验收汇总 JSON](../verification/results/upstream-0.14.0-b4-b5-validation.json)。首批历史报告保持原快照，本批重新验证的结果另存。

| 验收项 | 最终结果 | 命令 / 可复核产物 |
| --- | --- | --- |
| 全仓门禁与既有回归 | `validate:full` exit 0；6,286 次测试执行、65 个进程、0 失败；lint 119 个警告、0 错误 | `bun run validate:full`，包括全仓类型、lint、文档工具、i18n、身份、版本和完整工作区回归；计数为执行次数，不是去重用例数 |
| 决策消费者与接口 | 23/23 通过 | `bun scripts/verification/upstream-0140-b4b5.ts`；[报告](../verification/results/upstream-0.14.0-b4-b5-host.json) |
| 实际宿主与持久化流程 | 20/20 通过；28 个 loopback HTTP 请求 | `bun scripts/verification/upstream-0140-b4b5-workflows.ts`；[报告](../verification/results/upstream-0.14.0-b4-b5-workflows.json)，包括认证远程 RPC、任务裁决来源、无人值守排除、输入 ACK/原文/Durable 接收与提交、取消和迟到决策 |
| 生产界面组件 | 6/6 通过、0 浏览器异常、2 张完整截图 | `bun scripts/verification/verify-upstream-0140-b4b5-ui.ts`；[报告](../verification/results/upstream-0.14.0-b4-b5-ui/report.json)、[英文](../verification/results/upstream-0.14.0-b4-b5-ui/settings-en.png)、[中文](../verification/results/upstream-0.14.0-b4-b5-ui/settings-zh-Hans.png) |
| 首批权限与可靠性回归 | 61/61 通过 | `bun scripts/verification/upstream-0140.ts`；[本批重跑报告](../verification/results/upstream-0.14.0-b4-b5-first-batch-regression.json) |
| 最终 Electron 构建与 Windows x64 包 | 成功；NSIS 安装包生成，10 项构建产物检查通过 | 最终 main、renderer、assets、build:validate 及 `electron-builder --win --x64 --publish never`；保留本仓 beforePack 原生资源准备 |
| 包结构、架构、身份与资源 | 9/9 通过；main/preload/interceptor/Pi bundle/renderer 等 627 个实际发布文件与暂存副本 SHA-256 一致 | `node scripts/verification/packaged-client-verification.mjs --arch=x64`；[报告](../verification/results/upstream-0.14.0-b4-b5-packaged-client-verification-win.json)，源映射按既有打包规则排除 |
| 最终包实际启动 | 5/5 通过；运行 25 秒、renderer/helper 加载、临时配置初始化、无 fatal 输出、限定范围清理成功 | `node scripts/verification/packaged-client-smoke.mjs --arch=x64 --grace=25000`；[报告](../verification/results/upstream-0.14.0-b4-b5-packaged-client-smoke-win.json) |

原始日志保存在工作树 `.cache/verification/`，汇总记录其长度与 SHA-256；安装包位于 `apps/electron/release/Phaneris-0.2.4-win-x64.exe`，不提交构建缓存和二进制。

## 验证边界与恢复记录

- 决策服务为 loopback 替身；宿主、存储、任务调度和认证 WebSocket 使用生产代码，模型 transport 为惰性替身。Pi 验收使用实际 JSONL 子进程，验证单轮档位、上下文注入及恢复用户最新偏好；未向真实 provider/OAuth 发送对话。
- 浏览器使用生产 React 组件和模拟 IPC，验证模式可用性、13 项开关、风险卡片、两条批准计划路径及中英文。它不等价于完整认证客户端对话。
- Windows x64 包为 unsigned，直接启动 `win-unpacked` 验证；未安装到系统、发布或推送。Linux/macOS distribution 未在本批构建或启动。
- 初次并行构建/打包期间出现 Pages 构建和 XLSX 预览超时；串行重跑仍复现既有 XLSX 默认 5 秒预算问题，原工作区未改的同一用例在诊断预算下也超时。修正的是既有 E2E 夹具：真实 MarkItDown 解析器在有 60 秒上限的 `beforeAll` 中加载，转换断言继续使用原 5 秒预算。Office 产品代码未修改；最终标准全仓命令通过，不靠放宽全仓超时或删减断言。
- 既有 SessionManager 夹具在删除临时目录前关闭新增的 Durable 存储句柄；Pi JSONL 夹具等待其受控 shutdown 退出，避免 Windows 管道竞争。浏览器 watcher 排除 release/dist/cache，浏览器退出后再打包，避免资源锁与重载。
