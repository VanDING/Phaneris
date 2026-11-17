# 上游 v0.15.4–v0.15.10 修复吸收评估

状态：**评估阶段冻结记录；F01–F08已进入后续实施**。日期：2026-11-17（Asia/Shanghai）。

后续：用户已批准并执行F01–F08，当前进度和验收见[实施记录](../verification/upstream-bugfix-2026-11-17-implementation.md)。本文和机器证据保留评估时的源码基线。

本次按用户要求，只评估既有能力的缺陷修复；不引入上游新功能、前端组件、布局或交互。纯前端 bug fix 也单列排除，不夹带到后端修复中。产品源码、依赖、版本和用户配置均未改动。

## 1. 结论

建议吸收 **8 项后端／运行时修复**：F01–F04、F07 可以做小范围移植；F05、F06、F08 必须适配本地生命周期和校验边界。另有两项有价值但应另批处理的平台／启动修复 C01、C02。

其中最先处理的是 **OpenAI strict schema、自动化提示词环境隔离、Webhook 单次展开与 JSON 编码、项目指令发现**。离线探针已经观察到这些问题；不是仅凭发行说明推测本地也有。

不建议 merge 或 cherry-pick 上游整个版本提交：上游每个版本是一个聚合提交，修复与 Coding mode、PR 管理、会话树及 Claude SDK 改动混在一起。

## 2. 核实范围与证据口径

| 项目 | 冻结值／范围 |
| --- | --- |
| Phaneris | 0.6.5，`main`，HEAD `43ee16f7b476c0403d93825c3dfd15bd35f74aca` |
| 已完成的上游吸收基线 | v0.15.3，`22c9f0414ab63e0a22814c9a2ada740206e09091`；依据[原规划](upgrade-plan-2026-10-18.md)、[收口记录](upgrade-closeout-2026-10-20.md)、[后续实施](upgrade-followup-2026-10-20.md)和本地提交历史交叉核实 |
| 最新正式发布 | v0.15.10，`4932ebb68db87e81e81ad3837ecb68c1563ed9bd`；本次抓取时 `upstream/main` 与此标签相同 |
| 实际对比 | `refs/upstream-tags/v0.15.3..refs/upstream-tags/v0.15.10`，6 个版本提交、310 个变更文件；先检查全部变更路径，再定点阅读非 UI 候选源码及本地对应实现 |
| Git 操作 | 仅通过 SSH 执行 `git fetch upstream --prune`；沿用 `--no-tags` 与 `refs/upstream-tags/*` 映射；未合并、提交、推送或修改发布标签 |
| 离线核查环境 | 本机 Bun 1.4.3、已安装 Pi coding-agent 1.5.0；这只是探针执行环境，不是更改项目固定版本的建议 |
| 可核查结果 | [机器证据](upstream-bugfix-assessment-2026-11-17-evidence.json)：基线 SHA、15 个源码文件 SHA-256、探针脚本 SHA-256及9项观察 |

检查依据包括 GitHub 官方 Releases API、[发布页](https://github.com/craft-ai-agents/craft-agents-oss/releases)、标签内的 release notes 和对应源码。证据分为：**离线观察**（实际调用本地函数／拦截器／SDK）、**源码确认**（明确实现缺口）、**尚未验证**（真实客户端、账户或其他平台）。不把源码确认写成端到端验收通过。

| 正式版本 | 发布时间（北京时间） | 标签提交 |
| --- | --- | --- |
| [v0.15.4](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.4) | 2026-10-20 15:19:50 | `89e2d6a25` |
| [v0.15.5](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.5) | 2026-10-21 11:18:27 | `cede6ea49` |
| [v0.15.6](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.6) | 2026-10-23 08:26:43 | `8df01c5d0` |
| [v0.15.8](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.8) | 2026-11-04 00:19:52 | `1627c43e9` |
| [v0.15.9](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.9) | 2026-11-11 12:51:30 | `3ce9fc128` |
| [v0.15.10](https://github.com/craft-ai-agents/craft-agents-oss/releases/tag/v0.15.10) | 2026-11-17 01:34:16 | `4932ebb68` |

**发布说明存在重复：** v0.15.8 当前 GitHub 文案包含了四项也写在 v0.15.9 的自动化修复；相关实现已在 v0.15.8 标签中，不能重复计数。v0.15.7 没有单独正式发布，其两项 MCP 配置能力随 v0.15.8 提供，本轮按新增功能排除。

## 3. 建议吸收的 8 项

| 编号 | 优先级 | 修复及来源 | 本地状态 | 吸收方式与影响 |
| --- | --- | --- | --- | --- |
| F01 | 高 | OpenAI strict 工具 schema；v0.15.10 | **离线观察**：Chat Completions、Responses 两种真实拦截路径都会删除 `additionalProperties: false`，同时加入 `_intent`／`_displayName` | 保留原有严格字段；元数据已经声明在 properties／required 中，无须删它。改动小，无需升级 Pi、增加模型或改 UI |
| F02 | 高 | 自动化提示词不能展开进程秘密；实现于 v0.15.8，说明也见 v0.15.9 | **离线观察**：假进程秘密能进入 prompt 环境；会话名还被错误地作 shell 转义 | prompt、labels、topic 只使用事件生成的 `PHANERIS_*` 上下文，保留原始文本；不能改成允许所有 `PHANERIS_*` 进程变量，因为其中也可能有秘密。脚本与 webhook 继续使用各自的环境契约 |
| F03 | 高 | Webhook JSON 正确编码与禁止二次变量展开；v0.15.8／v0.15.9 重复列出 | **离线观察**：`${PHANERIS_SESSION_NAME}` 的替换值会再次展开；含引号／换行的 JSON body 会抛 `SyntaxError` | 展开只做一遍；对象 body 按 JSON 值逐项展开后再序列化。同步覆盖直接请求与延迟重试保存副本，保留现有 webhook 密钥前缀兼容规则 |
| F04 | 高 | 大仓库发送消息卡顿及当前目录指令遗漏；v0.15.10 | **源码确认＋离线观察**：先全仓 glob、截成20项，再筛目录。30个兄弟目录的夹具让 `z-target/AGENTS.md` 消失，并把无关 `a00/AGENTS.md` 当回退结果 | 先收集 root→cwd 祖先，再只扫描 cwd 子树；限制深度／目录数／时间，并按 root+cwd 缓存。保留本地 XML 消毒与大小写／Windows 路径处理 |
| F05 | 高 | Pi 分支恢复反复从父会话 fork、分叉点未落盘；v0.15.8 | **源码确认＋SDK 序列观察**：本地只要存在 `branchFromSessionPath` 就再次 fork；Pi 1.5.0 的 `branch(anchor)` 重开后确实会读到 anchor 之后的父消息 | 只在首次初始化 fork，之后续读自身 journal；分叉点持久化。必须与本地 Durable canonical context、分支恢复及错误策略一起适配，不能替换为上游整段初始化 |
| F06 | 中 | Pi 工具变更重建不能打断压缩／重试；v0.15.8 源码中的伴随修复 | **源码确认**：本地在处理 `toolsChanged` 时先 `SessionLifecycle.reset()`／dispose，随后才等待新 session 的压缩；尚未复现竞态 | 在旧 session 上等压缩／活动收敛后决定是否重建；忙碌时延后应用，同时保持宿主对已撤销工具的即时执行阻断。保留现有去重、取消和 Durable 回执 |
| F07 | 中 | Git 分支查询阻塞进程、detached HEAD 显示为分支；v0.15.4 | **源码确认**：当前实际注册的 server RPC 保留同步 `execSync('git rev-parse --abbrev-ref HEAD')`；Electron 文件另有未被当前主注册路径使用的旧副本 | 活动入口改为有界异步 argv 调用，以 `symbolic-ref --quiet --short HEAD` 在 detached HEAD 返回 null。只修后端返回和阻塞，不导入 PR watcher／worktree 服务，不扩展成旧副本清理 |
| F08 | 中 | 一条无效自动化拖垮其他有效项；v0.15.8／v0.15.9 重复列出 | **离线观察＋源码确认**：好 matcher 单独有效，混入错误正则后整个配置被拒绝；首次加载会置空全部自动化。现有热重载失败则已保留旧配置 | 运行时逐 matcher 加载、隔离无效项并报告原因；写入验证继续严格拒绝错误。保留本地 `syncScheduler()`、脚本路径／权限校验及旧配置保护；不导入上游 Not running 等前端改版 |

### 对应源码与适配边界

**F01**：[本地拦截器](../../packages/shared/src/unified-network-interceptor.ts)约1013与1242行；[上游修复](https://github.com/craft-ai-agents/craft-agents-oss/blob/4932ebb68db87e81e81ad3837ecb68c1563ed9bd/packages/shared/src/unified-network-interceptor.ts)。探针使用假的 fetch transport 捕获真实拦截器出站 body，没有向 OpenAI 发请求，故这里只确认 schema 被破坏，不声称完成真实供应商验收。

**F02／F03**：[utils](../../packages/shared/src/automations/utils.ts)、[prompt handler](../../packages/shared/src/automations/handlers/prompt-handler.ts)、[webhook utils](../../packages/shared/src/automations/webhook-utils.ts)；[上游 utils](https://github.com/craft-ai-agents/craft-agents-oss/blob/1627c43e93bb4f5b1532116b8eb092c0ada4b23f/packages/shared/src/automations/utils.ts)、[上游 webhook](https://github.com/craft-ai-agents/craft-agents-oss/blob/1627c43e93bb4f5b1532116b8eb092c0ada4b23f/packages/shared/src/automations/webhook-utils.ts)。不要顺手删除本地脚本环境构建、旧前缀兼容或 SDK／日志适配文件；这些不是本次安全修复的前提。

**F04**：[本地 system prompt](../../packages/shared/src/prompts/system.ts)的 `findAllProjectContextFiles`／`findRelevantProjectContextFiles`；[上游 scanner](https://github.com/craft-ai-agents/craft-agents-oss/blob/4932ebb68db87e81e81ad3837ecb68c1563ed9bd/packages/shared/src/prompts/system.ts)。上游预算为6层、4,000个目录和150ms；时间在目录间检查，是**软预算**，单次同步文件系统调用仍可能超时，不能承诺扫描总时长必然小于150ms。本地已有相关目录过滤，但发生在全仓扫描与截断之后，因此仍需吸收。

**F05／F06**：[Pi subprocess](../../packages/pi-agent-server/src/index.ts)约803与1751行、[本地生命周期](../../packages/pi-agent-server/src/session-lifecycle.ts)；[上游实现](https://github.com/craft-ai-agents/craft-agents-oss/blob/1627c43e93bb4f5b1532116b8eb092c0ada4b23f/packages/pi-agent-server/src/index.ts)。本地每轮可能用 Durable facts 收敛 SDK 上下文，这会缓解父历史误入；但它不能证明底层反复 fork／cutoff 落盘已经正确。当前探针仅执行已安装 SDK 的同类序列，尚未验证完整 Phaneris 客户端的可见影响，不把“必然丢失所有分支对话”作为结论。

**F07**：[server RPC](../../packages/server-core/src/handlers/rpc/system.ts)、[Electron handler](../../apps/electron/src/main/handlers/system.ts)；[上游后端修复](https://github.com/craft-ai-agents/craft-agents-oss/blob/89e2d6a25fb1c5c46e27ecf8e8f9a744f5abc27b/packages/server-core/src/handlers/rpc/system.ts)。核对[实际注册链](../../apps/electron/src/main/handlers/index.ts)后，Electron 使用共享的 `registerCoreRpcHandlers` 加本地 `registerSystemGuiHandlers`；旧文件里的 core 函数并未覆盖活动 GET_BRANCH。实施应改共享活动入口，不把死副本同步／清理当成本次修复前提。也不必连带引入上游整个 Git／PR 服务。

**F08**：[运行时加载](../../packages/shared/src/automations/automation-system.ts)、[现有验证](../../packages/shared/src/automations/validation.ts)；[上游容错加载](https://github.com/craft-ai-agents/craft-agents-oss/blob/1627c43e93bb4f5b1532116b8eb092c0ada4b23f/packages/shared/src/automations/validation.ts)。读取容错不能变成静默忽略所有错误，也不能让写入绕过严格 schema。保留结构化诊断或现有日志／接口，不要求新增前端页面。

## 4. 有价值但另批处理

| 编号 | 项目 | 判断与限制 |
| --- | --- | --- |
| C01 | 云盘卸载会话文件导致启动无窗口；v0.15.8 | 本地仍同步列举／读头，并在初始化完成前载入。异步、有限并发、跳过 macOS dataless 文件与读超时有价值；但上游改动贯穿启动 gate、RPC 读取和 SessionManager，本地还有 Durable recovery、导入恢复、任务发布恢复，不能整体替换。建议作为第二批运行时修复。**必须保留本地超过8KiB的长头读取**，不能退回上游固定8KiB；超时不等于取消底层读，不能据“未加载”删除／重建会话。Windows 云盘状态也不能照搬 macOS 的 blocks 判据。未在 iCloud／OneDrive 真机场景验证 |
| C02 | macOS HEIC 色彩与方向；v0.15.8 | 上游在 macOS 用系统 `sips`／ImageIO 做色彩转换，有实际价值；当前机器为 Windows，无该平台验收。若以后吸收，只加 macOS 解码分支，保留本地 AVIF 排除、BMFF尺寸解析、像素／文件大小上限、有界并发、worker可终止和原文件不改写。上游整个 HEIC 文件比本地安全边界简单，不能覆盖本地实现。当前不纳入首批 |

来源：[上游 session JSONL](https://github.com/craft-ai-agents/craft-agents-oss/blob/1627c43e93bb4f5b1532116b8eb092c0ada4b23f/packages/shared/src/sessions/jsonl.ts)、[session storage](https://github.com/craft-ai-agents/craft-agents-oss/blob/1627c43e93bb4f5b1532116b8eb092c0ada4b23f/packages/shared/src/sessions/storage.ts)、[HEIC](https://github.com/craft-ai-agents/craft-agents-oss/blob/1627c43e93bb4f5b1532116b8eb092c0ada4b23f/packages/server-core/src/services/heic.ts)。本地对应为[JSONL](../../packages/shared/src/sessions/jsonl.ts)、[SessionManager](../../packages/server-core/src/sessions/SessionManager.ts)、[HEIC](../../packages/server-core/src/services/heic.ts)。

## 5. 不重复吸收：本地已有对应行为

| 上游修复 | 本地证据／决定 |
| --- | --- |
| Pi 关闭来源后移除工具；v0.15.8 | subprocess 的 `register_tools` 已替换完整集合，并由 [proxy-tool-sync](../../packages/pi-agent-server/src/proxy-tool-sync.ts)比较差异；宿主已有每轮同步。保留实现，不搬上游那套重构。F06 是剩下的“重建时机”问题，不是工具集合仍用 merge |
| 使用未启用来源后会话停住；v0.15.8 | [PiAgent](../../packages/shared/src/agent/pi-agent.ts)已有 SourceActivationDrainController、等待停止及 `source_activated` 事件续发路径。这里只确认有对应机制，不宣称复现了全部源服务器场景 |
| Explore 对未知工具默认放行及 MCP 同名绕过；v0.15.8 | [mode-manager](../../packages/shared/src/agent/mode-manager.ts)已默认拒绝未知工具，也没有上游原来的任意 `__Read`／`__WebFetch` 后缀免检；离线探针确认未知写工具被拒绝。不要导入上游新增的 Claude 工具白名单 |
| 任务代理不知道任务目标；v0.15.8 | 本地已有 `sessionModelTaskContext`、`projectTaskContinuity`、`modelTaskContextProvider.read`，按请求读取当前任务信息，还处理撤回材料。保留本地模型上下文体系，不叠加上游 task.yaml 文本指纹注入 |
| Agent-event 自动化实际上不运行动作；v0.15.8／v0.15.9 | 本地 validation 已对 emitted／unemitted 事件警告，且有独立 tool-call-rules。文档仍有把 agent events 与可执行 app events 混列的问题，可同步明确说明，不能因此新实现 agent-event 自动化。上游新增脚本展示 UI 不吸收 |

“已有对应行为”来自当前源码对照及所注明的探针，不替代完整 E2E 回归。

## 6. 明确排除

| 类别 | 上游内容 | 排除理由 |
| --- | --- | --- |
| 新能力 | Coding mode、短系统提示词、worktree 选择／克隆／创建、CLI `--coding` | 不是既有能力修复 |
| 新能力 | PR header、PR工具、多PR、自动修复评论及其 watcher／轮询 | 即使关联 issue，也属于新增工作流 |
| 前端 | 默认缩放、用户消息复制、删除工作区确认、会话树、任务 brief、header布局 | 用户本次明确不吸收新增前端 |
| 前端 bug fix | 安装包原生右键菜单缺失；v0.15.5 | 缺陷在本地也存在：菜单只在 `!app.isPackaged` 注册。但它直接改变桌面交互，按本轮保守边界排除，可单独记录以后处理 |
| 前端 bug fix | 状态／未读／项目分组找不到较旧会话；v0.15.5 | 上游主要改 renderer `useSessionSearch` 分页。本次不改前端查询／分页，不导入该实现 |
| Claude 专属 | v0.15.6 的 Coding／扩展上下文／压缩阈值／大图读取；v0.15.8 的动态MCP、拒答撤回与模型回退、模型热切换、Monitor权限 | 本地采用 Pi 后端；不为吸收这些修复重新引入 Claude SDK／CLI运行路径或新工具 |
| Claude 专属 | v0.15.10 的多账户串号、过期登录清理、缺凭据时回退其他登录、连接测试串网关 | 安全修复有价值，但根因是 Claude 进程环境、全局legacy slot及CLI隐式登录。本地 Pi 已有逐连接认证、配置模型不匹配拒绝等自己的路径，不能据同一个“OAuth”名字照搬整个 auth/state 重写 |
| 兼容配置新增 | v0.15.7 随 v0.15.8 提供的 `mcp.oauthRelay`、`mcp.scopes` | 虽解决真实兼容问题，仍是新增配置能力，本轮排除。本地没有默认使用上游托管relay，故不能把 relay opt-out 当成现有必修缺口 |
| 品牌／发布／依赖 | 上游 Docker镜像／仓库链接、版本、README、模型上新、Claude SDK升级 | 保留 Phaneris identity、分发和当前依赖；不改为上游发布源 |
| 新功能伴随约束 | 禁止子会话再充当 task orchestrator | 上游为一层会话树新增的限制，与本地任务／委派模型不同，不当作通用 bug fix 搬入 |

### v0.15.10 OAuth 保存细节的单独判定

上游还修了“登录已保存 refreshToken，随后 setup 再用相同 accessToken 覆盖整条凭据”的问题，见 [storeSetupOAuthToken](https://github.com/craft-ai-agents/craft-agents-oss/blob/4932ebb68db87e81e81ad3837ecb68c1563ed9bd/packages/server-core/src/domain/connection-setup-logic.ts)。本地 [setup handler](../../packages/server-core/src/handlers/rpc/llm-connections.ts)确有相同泛用写入语句。

但进一步核对 [useOnboarding](../../apps/electron/src/renderer/hooks/useOnboarding.ts)：当前 ChatGPT、Copilot、Pi unified OAuth 成功后传入 setup 的 `credential` 是 `undefined`，完整凭据由服务端OAuth流程保存；回传 `result.token` 的是旧 Claude onboarding 路径。因此本轮把它记为**潜在接口边界问题，未证明当前正常 Pi 登录触发**，不列入8项首批修复，也不连带重写认证系统。将来若证实其他受支持调用者会回传相同 token，可只移植“相同 token 不降格覆盖完整凭据”的局部保护。

## 7. 离线观察及限制

探针先清除自身子进程的非必要环境变量，再设置虚构秘密，使用独立配置目录、临时 Git仓库及假的 fetch transport。没有真实账户凭据、外部请求、生产应用启动或产品源码写入。

| 探针 | 实际观察 | 能证明什么 |
| --- | --- | --- |
| prompt-process-env | 假进程秘密被展开，session name带shell转义 | F02 本地存在 |
| double-expansion | 插入的 `$PHANERIS_WH_REVIEW_SECRET` 被二次解析 | F03 单次展开缺口存在 |
| webhook-json | 含双引号／换行的对象值引发 SyntaxError | F03 JSON 编码缺口存在 |
| automation-config-isolation | 好配置单独有效；混入一个坏正则则 config 为 null | F08 边界缺口存在，加载器据此会首次清空配置 |
| safe-unknown-tool | 未知工具返回 allowed:false | 默认拒绝已有保护 |
| chat-strict-schema | 捕获出站 schema：元数据已加，additionalProperties 被删 | F01 Chat Completions 路径存在 |
| responses-strict-schema | 同上 | F01 Responses 路径存在 |
| context-cap-before-filter | 合法临时仓库里选中z-target，却列出无关a00指令文件 | F04 不仅是性能问题，也会遗漏正确指令 |
| sdk-branch-cutoff-persistence | 内存分叉正确；重开后看到parent-after消息 | 当前Pi 1.5.0确需持久化cutoff；不证明整个宿主的Durable兜底无效 |

共9项观察，8项观察到缺陷、1项确认已有保护；这不是“9项产品验收通过”。未执行真实供应商API、完整客户端分支流程、压缩竞态、macOS云盘／HEIC或完整门禁。

本次最终缓存位于 `.cache/upstream-bugfix-assessment-20261117/run-VNYnjG/`。在缓存脚本仍保留时可复跑：

```powershell
bun --config=.cache/upstream-bugfix-assessment-20261117/bunfig.toml ./.cache/upstream-bugfix-assessment-20261117/probe.ts
```

脚本会新建运行目录，不覆盖既有结果。机器证据记录其SHA-256；缓存被清理后，不能把旧结果冒充新源码验收。

工作区开始时干净，评估期间另出现 `docs/verification/results/packaged-client-smoke-win.json` 的更新；本轮未执行该烟测，未覆盖或回滚这份结果，也不把它列为本次验收。

## 8. 后续实施的最小批次与验收要求

本节是建议，不是本轮已实施结果。实施时先记录失败矩阵，再编写／修改代码；复杂行为用流程与真实子进程验收，不事后补镜像实现的单元测试。

| 批次 | 范围 | 最少应覆盖的失败场景 |
| --- | --- | --- |
| B1 | F01–F03 | 两种OpenAI协议、rich描述开／关、内建及MCP工具；prompt／label／topic均无进程秘密；引号／换行／反斜杠／美元符号、对象／数组、直接请求／重试均保持正确文本；现有脚本和webhook秘密契约不变 |
| B2 | F04、F07 | 祖先／当前目录／子树、超过20个兄弟目录、缓存切cwd、大小写／Windows路径／符号链接／软预算；正常分支、detached HEAD、非仓库、git缺失／超时，Electron与headless通过实际共享注册路径均不阻塞 |
| B3 | F05、F06 | 分支首条消息前重开、已有分支对话后重开、父会话后续新增、工具变更、恢复分叉点；压缩进行中／超时／取消、重试进行中、来源撤销即时阻断；保留Durable事实和账本归属，无重放外部动作 |
| B4 | F08 | 好坏matcher混合、错误正则／cron／脚本、非法JSON热重载保留上次有效配置、有效项更新确实生效、scheduler按有效集合启停、严格写入仍报错，agent-event仍不执行动作 |

F01–F08原则上不需要新增功能入口、依赖升级或改产品版本。验收后再按实际改动运行相应类型、lint、协议／身份／文档门禁；若以后push，仍须完整执行仓库pre-push hook。C01、C02分别需要启动恢复专项和macOS环境，另批评估实施。
