# 上游 0.14.0 首批吸纳记录

实施基线：Phaneris `4613e04b2ab5e79477000ce0a457ab54a369325b`（0.2.4、Pi SDK 1.0.0）。移植出处：上游 `73bd9c2a3573158bea880984eb8d5fdb41e0cac2`，前版 `3eac37be5eeee00d312239f21ce3b7c7db92502b`。

用户于 2026-10-03 批准[评估方案](upstream-0.14.0-assessment.md)。本文保存 `f4846428` 首批交付的快照：B1（P01–P07）、B2（R01–R08）与必要的 B3 基础；当时 B4、B5 后置，仅保留三个权限模式。用户随后要求完整实施 B4–B5，后续四模式与决策接线状态见 [B4–B5 实施记录](upstream-0.14.0-b4-b5.md)。Pi 后端、Durable Runtime 持久化权威及独立产品身份继续保留。

实施分支：`codex/upstream-0.14.0-absorption`；在隔离工作树中推进，不改原工作区的用户文档或 Pi SDK 升级提交。

## 实施前失败矩阵

主场景在修改产品源码及编写隔离验证程序前确定；Windows 安装器钩子、网络参数边界、RTK 原生偏好和启动验证清理是实施中补充的失败场景，均先复现或明确失败方式再修复。验证输出保存为机器可读 JSON；命令样例只经过权限判断，不执行危险命令。配置、凭据、会话和日志均使用临时目录。

| 范围 | 失败方式 | 验收要求 |
| --- | --- | --- |
| P01 | MCP 读取词命中 source 名、写动作中的子串、camelCase 混合写词；自定义 regex 被破坏 | Explore 拦截写动作、允许完整读取动作；保留明确 regex 规则 |
| P02 | gh api 隐式 POST、DELETE、GraphQL mutation/外部 query；sed 原地写、脚本写/执行、外部脚本；sort 输出/压缩程序；正常读被误拦 | 按 argv 先检查副作用，保留正常读取；存量默认规则仍受保护 |
| P03 | Ask 对 Explore 的 MCP 读取再次提示，workspace/source 读取规则不一致 | 两个模式使用同一上下文和读取策略 |
| P04 | 始终允许无效、拒绝也保存、授权跨命令参数/大小写/目录/域名、复合命令继承授权、危险子命令被记住、API 授权跨 source、网络合并短选项隐藏配置/代理 | 真实 Pi 往返保存限定授权；下一次精确匹配；无法确定网络目标时不复用域名授权；无可保存范围时隐藏按钮；拒绝不保存 |
| P05 | spawn_session 权限超过父会话或未知 mode 绕过比较 | 按 safe < ask < allow-all 钳制，未指定继承父模式 |
| P06/P07 | source 激活后 prompt 被允许、激活失败仍运行、激活后仍不可用；无人应答、取消、权限回调异常导致放行或悬挂 | activation→复检→prompt→应答→响应顺序正确；失败和无人应答拒绝；原工具身份保留 |
| R01 | 无 pending plan 重写、存在 plan 未清除、会话不存在报错 | 无 plan 不写；存在时正常清理；保持持久化队列顺序 |
| R02 | 完成监听者重订阅收到同一事件、坏监听者中断其他监听 | 对本次订阅快照发事件；新订阅仅接收后续事件 |
| R03 | 自动化自身递归、A→B→A、旧记录缺 matcher id、重命名/同名误判、链深缺失或超过上限、跳过不记录、元数据不持久化 | 稳定 matcher id、旧名称回退、链深上限 3、skipped 历史、重启可追溯 |
| R04 | source_test 凭据缺失误报成功、刷新失败误报成功、刷新成功未重取 token、多 header 退化、无认证 source 受影响 | 有认证时刷新并重取；仍缺失返回认证失败；保留多 header、无认证和本地 source 行为 |
| R05 | source 重试重复显示、原消息为空、steer 丢失或重复、附件/思考档位丢失、用户新输入和重试竞争、Durable 输入重复 | 原消息只显示一次；重试保持内容、附件、纠正和设置；持久化接收状态一致 |
| R06 | 别的会话或不明工具的后台完成唤醒本会话、缺开始时间产生错误耗时、本会话任务完成未通知、重复完成 | 只有本会话已启动的 task 可唤醒；未知起点不编造耗时；完成只消费一次 |
| R07 | RTK 0.23–0.43 仍启用、找不到版本/二进制、强制重查缓存无效、command/builtin 被改写、exclude 配置无效、Windows 收到 Unix 安装指令 | 最低 0.44.0、明确 outdated 状态、绕过及排除生效、按服务端平台显示更新方式 |
| R08 | 重音或截断生成非法 label id、已有 id 被重命名、空 slug/重名失效 | NFKD 归一化且截断后 trim；合法唯一 id；仅影响新建 |
| B3 | 取消被记为超时、decision 日志写入用户配置、缺关联 outcome/followup、legacy bridge 打包残留、Pi 产物启动失效 | 可区分取消/超时；临时日志与统计；真实资源/构建验证；删除按批准范围执行 |
| Windows 打包 | 干净工作目录缺少 `windowframe.dll`；`npmRebuild: false` 使 `beforeBuild` 钩子提前跳过 | 安装器插件在实际会执行的 `beforePack` 中构建，保留预编译原生依赖；产出 NSIS 安装包并验证实际启动 |
| RTK 提醒偏好 | 上游 localStorage 引入新增告警；保存已忽略版本覆盖其他偏好；同版本重复提示 | 使用本仓 preferences.json，保留其他字段；同版本重挂载不再提示 |
| 网络授权参数 | curl 的方法/header 值误记为域名；输出文件、重定向、未知选项扩大记忆范围 | 按选项消费值，只记实际 URL 操作数的 host；无法确定的调用仍逐次询问 |
| Windows 启动验证清理 | Chromium 辅助进程/WMI 状态延迟退出导致临时 profile 被占用，验证脚本无法写出结果 | 限时重查和终止本测试包的进程；临时目录清理有重试，不终止其他安装副本 |
| 回归 | SDK/品牌/权限 broker/Durable Runtime 被上游覆盖；i18n 漂移；远程 API 类型不兼容 | 原架构及依赖版本保持，全量门禁与相关既有回归通过 |

## 验证记录

产品源码修改前，主机基线检查为 **12/53 通过、41 项失败**。[基线 JSON](../verification/results/upstream-0.14.0-before.json)保留了当时输出。实施期间新增边界检查与真实会话持久化场景；最终检查数增加，因此不能将前后总数直接相减作为修复数量。

实现及验证对应表：

| 范围 | 本次落地 | 本仓适配 |
| --- | --- | --- |
| P01–P03 | MCP 完整动作词判断；Bash argv 副作用检查；Ask/Explore 共享 workspace/source 读取策略 | 保留显式 regex 白名单；不因 source 名含 get/read 放行；旧安装的宽 regex 仍受 argv 检查限制 |
| P04 | Pi 应答真正保存“始终允许”；授权按精确命令、子命令、写入目录、网络域名或 API source/方法/路径限定 | 保留 argv 大小写；危险命令、复合 shell、隐藏配置/代理不给记忆按钮；网络仅记明确 HTTP(S) URL 的 host，按已知选项消费参数，输出文件/重定向/未知选项逐次询问；Windows 写入路径单独折叠大小写 |
| P05–P07 | spawn 权限上限；source 激活后重新走完整权限判断；无人应答或回调异常拒绝；取消后不再提示/放行 | 只保留 safe/ask/allow-all；按实时父会话模式钳制；原 toolCallId 和 Durable Runtime 协议保持 |
| R01–R02 | 无 pending plan 时不重写会话；完成监听者按本次订阅快照分发 | 沿用持久化队列；重订阅仅接收后续事件 |
| R03–R04 | 自动化稳定 matcher id、旧名称回退、3 层链上限、skipped 历史；缺凭据先刷新再重取 | 触发信息写入 session header；保留本仓多 header 认证支持 |
| R05–R06 | source 重试隐藏、保持 steer/附件/选项；传统 renderer 竞争也接收同一载荷；后台完成按本会话归属唤醒 | 用真实 SessionManager → Durable 输入接收 → JSONL → 重载验证；保持会话思考档位，不引入单轮覆盖；未知 task 不编造开始时间 |
| R07–R08 | RTK 最低 0.44.0、outdated/强制重查/排除命令/绕过；更新对话框及 7 种语言；label id 重音归一化、截断后 trim | Windows 提供 winget 命令、其他平台沿用 RTK 官方安装入口；复制命令由用户在终端执行；缺二进制不误报更新成功；忽略版本使用原生 preferences.json 并保留其他字段；不改已有 label id |
| B3 决策基础 | cancelled/timeout 区分、关联 outcome/followup、串行日志、测试临时日志、统计命令、公共 decision point | 沿用现有 3 个 feature gate；决策只提供建议，失败回原行为；未接入 B4/B5 消费方 |
| Windows 打包 | NSIS 插件构建移入 beforePack | 干净工作树确认原 beforeBuild 被 npmRebuild=false 跳过；保留预编译原生模块，打包流程自动生成 DLL |
| C01 清理 | 删除废弃 bridge bundle、Electron/server 打包引用、allowlist 项和无消费方 no-op 契约 | 已展示[8 文件清理摘要](upstream-0.14.0-bridge-cleanup.md)，用户回复“继续”后按原范围应用；保留 source runtime、权限 broker 与 Pi subprocess |

移植依据为[上游 v0.14.0](https://github.com/craft-ai-agents/craft-agents-oss/tree/v0.14.0)，核心入口包括 [Bash 检查](../../packages/shared/src/agent/bash-validator.ts)、[Pi 权限往返](../../packages/shared/src/agent/pi-agent.ts)、[主机会话管理](../../packages/server-core/src/sessions/SessionManager.ts)、[公共 decision point](../../packages/server-core/src/decisions/decision-point.ts)。RTK 平台安装指令核对[官方安装说明](https://github.com/rtk-ai/rtk#installation)；网络记忆键按 [curl 官方手册](https://curl.se/docs/manpage.html)区分选项值和 URL 操作数。

最终命令结果以[验证汇总](../verification/results/upstream-0.14.0-validation.json)和各项 JSON/截图为准。原始终端日志留在工作树 `.cache/verification/`，不提交构建缓存和安装包。

| 验收项 | 结果 | 对应阶段 / 证据 |
| --- | --- | --- |
| 完整工作区回归 | 6,286 次执行通过、0 失败；65 个进程 | 首批主体实现后；计数为执行次数，不是去重后的用例数。清理后额外执行 server-core 回归 478 次；最终网络边界修改后执行既有权限回归 86 次，均通过 |
| 最终源码 CI 门禁 | 通过 | `validate:ci`：全仓类型检查、lint、共享/文档工具/UI 表格测试、4 项 i18n 门禁、身份与版本检查；lint 仍有 118 个既有警告、0 错误。身份生成物和打包配置无漂移；检查器另报告 145 个非阻断的残留源码/出处/fixture 标识 |
| 主机与持久化流程 | 61/61 通过 | [主机报告](../verification/results/upstream-0.14.0-first-batch.json)，含真实 SessionManager → Durable 接收 → JSONL → 重载 |
| 浏览器界面流程 | 7/7 通过、3 张截图 | [界面报告](../verification/results/upstream-0.14.0-ui/report.json)；真实组件、模拟 IPC、headless Edge |
| 最终 Windows x64 打包 | 通过 | `beforePack` 自动生成 NSIS 插件；最终 main/preload/renderer 文件与包内副本的 SHA-256 一致 |
| 包资源 / 架构 / 身份 | 9/9 通过 | [包结构报告](../verification/results/packaged-client-verification-win.json)；废弃 bridge bundle 不在包中 |
| 最终包实际启动 | 5/5 通过 | [启动报告](../verification/results/packaged-client-smoke-win.json)；保持运行 25 秒、生成 renderer/helper、无 fatal 输出、配置初始化、限定范围清理成功；既有协议注册恢复后哈希完全一致 |

首批 `f4846428` 的阶段状态：**B0、B1、B2 及 B3 首批范围完成；当时 B4、B5 尚未实施。** 后续实施和验收见 [B4–B5 记录](upstream-0.14.0-b4-b5.md)。交付为隔离分支上的本地提交，未推送，未合入 `main`。

## 实际覆盖与限制

- 主机验证使用真实权限、存储、SessionManager 和 Durable Runtime 代码，隔离 transport/provider 回调并使用 loopback API；权限里的危险 shell 样例只做判定。
- 界面验证使用真实权限卡片与 RTK 对话框、headless Edge 和模拟 IPC，覆盖拒绝/记忆应答、只复制更新命令、旧版/缺失/重查失败、成功关闭、中文资源加载、原生偏好字段保留及同版本提醒去重，产出 3 张截图。
- Windows x64 产出当前 0.2.4 安装包并检查资源/身份/架构，启动验证使用临时配置及 Chromium profile；未安装到系统，也未发布或推送。
- `build:smoke` 的 Electron、Web UI、Viewer 构建成功；最后的 headless server distribution 不支持 win32，不能宣称整条命令通过。Linux/macOS distribution、真实 provider/OAuth 对话尚未验证。
- 实施中的一次持久化检查误用了存储字段 `role`；JSONL 实际字段是 `type`，隐藏标记原已正确保存。验证程序已纠正，并加入重载检查，未修改 Durable Runtime 来修复一个不存在的缺陷。
- B4 决策消费者接线、B5 Guarded/自适应思考/中流语义分类不在首批范围。产品版本仍为 0.2.4、唯一 Pi SDK 仍为 1.0.0；未全量 merge 上游目录或依赖。
