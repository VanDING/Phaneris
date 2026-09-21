# Plugin 体系评估与优化方案

- 日期：2026-09-21
- 代码基线：`f2f5ef74`
- 状态：分析与实施建议；本轮未修改运行时代码。
- 证据范围：本仓库源码、既有决策、定向测试、隔离临时工作区复现。未做外部插件生态兼容性认证，也未实测 Electron 完整交互。
- 历史依据：[设计稿](plugin-bundles-design.md)、[决策登记册](plugin-bundles-decisions.md)。下文明确区分既定设计的缺陷修复与需要重新确认的设计变更。

## 1. 结论

**保留“插件是能力包、安装后复用原生 skill/source”的总体架构；优先修复安装与卸载的完整性，再打通对话式管理闭环。**

目前已经有包解析、安装、卸载、RPC、列表与详情、slash 激活、会话持久化和 prompt 注入，属于已有主链路的早期实现。但“安装成功”“资源仍被引用”“插件已激活”尚不能可靠地推出“能力可用”。短板主要在这些状态之间的转换，而非缺少更多插件类型。

优先级建议：

1. **P0：阻断误删、越界和破坏已有资源的路径。**
2. **P1：统一包声明、物化结果与实际运行行为，打通安装入口与诊断。**
3. **P2：在真实插件验收后完善作者体验、迁移和分发。**

当前不建议优先建设插件市场、自动更新、多插件同时驻留或独立权限运行时。

## 2. 当前架构与应保留的部分

```text
包目录 / 归档 / URL
  ├─ import.ts：下载与解压工具函数
  └─ storage.ts + validation.ts：解析与校验
          ↓
  install.ts：分析 → 物化 → 包目录 → 派生索引与审计
          ├─ workspace/skills/<slug>
          ├─ workspace/sources/<slug>
          └─ workspace/plugins/<name>
                  ↓
  RPC + watcher + DTO → 列表 / 详情 / slash 菜单
                  ↓
  SessionManager.activePlugin（单槽位）
          ├─ source 预启用 → 原生 MCP/API 工具链
          └─ PiAgent → volatile context：PROMPT + skill 名单
```

上图表示模块关系；归档/URL 工具函数尚未形成贯通的产品入口。

| 现有选择 | 评价 | 后续原则 |
|---|---|---|
| workspace 所有 | 与 source 凭据作用域一致 | 保留，先不增加全局安装层 |
| skill/source 物化为原生资源 | 避免另造工具加载、权限与认证体系 | 保留，但明确唯一执行位置 |
| 单一激活插件 | 用户理解和上下文组装简单 | 保留；明确取消激活的实际作用 |
| skill 渐进加载 | 不要求一次读取全部技能 | 保留，名单须指向真实运行资源 |
| prompt 放 volatile 尾部 | 已有测试验证不进入稳定 system 前缀 | 保留；转义只是格式防护，不是执行隔离 |
| 文件编辑、对话式管理 | 符合产品现有工作方式 | 保留，补一个可靠的机器操作入口 |
| 派生索引 | 易重建，不承担权威状态 | 保留，但不能把引用者误当成实际提供者 |

主要入口：[shared/plugins](../packages/shared/src/plugins/index.ts)、[RPC](../packages/server-core/src/handlers/rpc/plugins.ts)、[会话管理](../packages/server-core/src/sessions/SessionManager.ts)、[详情页](../apps/electron/src/renderer/pages/PluginInfoPage.tsx)。

## 3. 已确认问题

### F01 · P0：安装回滚会破坏已有资源

**已复现。** 先安装包含 `good` source 的插件，重装时先覆盖 `good`，再让另一个 source 因非法 `args` 校验失败：安装抛错后，原 `good/config.json` 已被删除，同时本次新增的 skill 仍留在工作区。

原因在 [install.ts](../packages/shared/src/plugins/install.ts)：

- source 直接写入正式目录，没有保存旧目录；catch 把本次已写入的 source 一律删除，包括被覆盖的旧 source。
- skill 回滚只处理存在 `backupDir` 的项，新建且已提交的 skill 没有被撤回。
- `placePackage` 先删除旧包再 rename，新旧包之间没有完整的可恢复切换。
- source 保存还可能触发凭据清理，文件回滚无法撤销该副作用，见 [sources/storage.ts](../packages/shared/src/sources/storage.ts)。

这直接违反现有文档“失败后工作区保持原样”的承诺，属于既定设计修复。

**修复：** 先完成全部解析和 source config 校验，暂存所有变更；skills、sources、包目录统一记录提交与备份状态，逆序恢复。凭据清理等副作用推迟到提交成功后。备份清理失败不应把已经成功的提交重新变成破坏性的回滚。

### F02 · P0：MCP key 没有资源路径边界校验

**候选路径越界已复现；破坏性删除未执行。** `mcpServers` 的 key 使用 `../../outside` 时，安装分析生成的资源路径已越出 `sources/`。

[readPluginMcpServers](../packages/shared/src/plugins/storage.ts) 未验证 key 的 slug 规则；[getSourcePath](../packages/shared/src/sources/storage.ts) 直接拼接路径；卸载使用相同声明生成删除路径。即使 source 写入阶段拒绝非法配置，也不能覆盖“直接放入插件目录再卸载”的路径。

**修复：** 在解析入口统一校验资源名；每次写入、覆盖、删除前，另行检查目标为预期资源根目录内的合法子目录，拒绝根目录自身、父级跳转、绝对路径及重解析点逃逸。不能只依赖 manifest 校验或 source 保存校验。

### F03 · P0：引用计数保住 source，却删掉它依赖的包

**已复现。** A、B 都提供同名 stdio source，依次安装 A、B 后，source 的 `pluginRoot` 指向 B。卸载 B 时，因为 A 仍声明同名 source，配置被保留；B 的包目录却已删除。

结果：**“保留了资源”但资源依赖的执行目录不存在。** [引用计数](../packages/shared/src/plugins/install.ts) 只描述谁声明 slug，不能表达当前内容来自谁、执行时依赖哪个包。

另一个静态确认问题：其他插件加载失败时，`collectClaimsExcluding` 直接跳过。损坏插件的引用会从删除决策中消失，不能把“无法读取”当成“没有引用”。

**近期修复：** 卸载时检查保留资源的 `pluginRoot` 和其他包的加载异常。依赖目标包的资源未迁移前阻止该卸载，明确报出阻塞关系；引用不确定时保留资源。不要静默把 provider 切回 A，因为版本、配置和认证目标可能不同。

**后续方案：** 在重新确认所有权策略后，允许显式迁移 provider，或把提供资源与引用既有资源分成不同声明。引用数仍可派生，但实际执行依赖必须单独判断。

### F04 · P1：skill 存在两条执行路径

**已复现名单路径。** [buildPluginRoster](../packages/shared/src/plugins/plugin-context.ts) 使用包内 `skill.path`，产生 `plugins/demo/skills/.../SKILL.md`；原生 skill 则位于 `skills/.../SKILL.md`。

因此修改物化后的 skill，`@skill` 和 `/plugin` 可能读取不同内容；修改包内 skill，插件名单又可能在未重装时提前看到新内容。这与“编辑包后重装才生效”的操作文档冲突。

**修复：** 坚持物化模型，插件名单从原生物化 skill 解析名称、描述与路径；包内内容用于安装输入。缺失时报告未物化，不静默回退到包内副本。PROMPT 的下一轮即时生效保持现有语义，并在文档中单独说明。

### F05 · P1：Windows 参数与环境变量被当作路径改写

**已复现。** [normalizeTemplateSeparators](../packages/shared/src/plugins/resolve.ts) 对整个字符串执行 `/` → `\`，普通参数 `https://example.com/api` 变成 `https:\\example.com\api`。

**修复：** `args`、`env` 默认是不可解释的字符串，只替换明确支持的占位符；command 的路径规范化独立处理。URL、正则表达式、JSON、标志参数必须逐字保留。新增 Windows 与 POSIX 的语义测试，不只测路径拼接。

### F06 · P1：安装确认未与实际安装内容绑定

**源码确认。** [RPC](../packages/server-core/src/handlers/rpc/plugins.ts) 的 `INSTALL` 只接收路径并重新分析；没有要求消费此前 `ANALYZE_INSTALL` 的计划，也未验证包和覆盖目标在确认后是否变化。卸载也重新计算清单。

**修复：** 生成短期、workspace 绑定、一次性 `planId`，绑定暂存包摘要与受影响资源状态；执行时校验前置条件，发生变化则返回新计划。分析不写正式资源目录，但可以建立临时快照。该机制服务于已有 D9 确认承诺，不等于增加永久安装注册表。

### F07 · P1：校验分散，实际可安装性与展示不一致

**源码确认。** `storage.ts`、`install.ts`、`resolve.ts`、原生 source validator 分别校验部分字段：

- loader 接受非空 stdio command，裸命令等问题到运行解析时才拒绝。
- `cwd` 在不同路径的接受规则不同；安装可能把某个条目跳过，但 loader/索引仍把它计为贡献资源。
- 最小内容判断发生在过滤全部不可安装项之前，不能保证最后至少有一个有效贡献。
- 同一个 source slug 可同时出现在 MCP 与 extension 声明中，没有统一冲突检查。
- HTTP 有任意 headers 就推导为 bearer 认证；普通非认证 header 并不能支持这一结论。
- source 写入只覆盖 `config.json`，旧 `guide.md` 等仍在，和文档声称的目录级替换不一致。

**修复：** 增加统一的编译结果，包含可物化资源、跳过项及稳定错误码。安装计划、执行、DTO 与归属判断消费同一结果；运行阶段再验证外部条件，如可执行文件和凭据是否就绪。静态声明与用户认证状态分离，不能由“存在 headers”猜认证。

### F08 · P1：导入尚未形成对话式管理闭环

**仓库调用点核对。** 下载、解压函数存在且已导出，但未发现生产调用链将它们接到 RPC 或 agent 管理工具；当前安装 RPC 只接收目录。操作文档说明了流程，却未提供对应的稳定工具调用方法。本次也未找到已落地的外部导入 feature flag。

这不意味着 AI 完全不能通过 shell 操作，而是产品没有保证这些操作必经统一的分析、事务和审计路径。

[import.ts](../packages/shared/src/plugins/import.ts) 还有这些静态问题：

- 解压总量在完成落盘后才检查，不能保证写盘过程受上限约束。
- 符号链接在解压后检查；应提前拒绝链接与非普通文件条目，并对解压库行为做专项测试。
- 根目录直接包含 manifest 时返回名为 `extracted` 的目录，后续安装又要求目录名等于 manifest name，两个模块不一致。
- 下载没有明确超时、取消与完整的流错误处理约定。
- 本地 loader 跳过 `data/` 子树的符号链接检查，与“任何位置均禁止链接”的文档不同。

**修复：** 增加内部 agent 管理工具，提供 `prepare / apply / inspect / remove`，复用同一服务。继续采用对话交互，不需要新建导入页面或 CLI 域。外部导入开关按已有决策默认关闭；根目录包按验证后的 manifest name 暂存；流式实施大小限制、取消、超时与文件类型检查。

### F09 · P1：健康状态没有变化时，UI 可能不刷新

**源码确认。** [watcher.ts](../packages/shared/src/config/watcher.ts) 的插件分支只监听包根、manifest 和 PROMPT；未覆盖 MCP 与扩展声明。处理函数又在目录集合、成功/失败状态都不变时直接返回，所以正常的版本或描述更新可能不会广播。

`PluginLoadError.path` 实际可以是 `plugin.json` 等包内路径，watcher 却用 basename 当插件名，错误归属也不稳定。

**修复：** 插件错误增加明确的 `pluginName` 与资源路径；监听声明内容变更并发送 `plugins_changed`，仍然不把包内 skill 变化冒充为原生 `skills_changed`。安装事务结束统一失效缓存，避免界面读到半提交状态。

### F10 · P1：激活状态与可用状态混在一起

**源码确认。** [SessionManager](../packages/server-core/src/sessions/SessionManager.ts) 在切换或取消插件时保留既有 enabled sources；当前插件的 sources 每轮还会自动预启用。卸载后会话槽位仍可保留，但 prompt 静默跳过。

保留 sources 是目前有意选择，不应直接视为 bug。不过“取消插件”不能被解释成关闭其所有工具，手动关闭的 source 也可能被后续预启用恢复。

**近期改善：** 在 badge/详情中区分激活、部分可用、待配置、缺失；把不可用原因细化为未物化、待认证、未连接、缺少执行文件等，并明确取消只移除后续插件上下文。

**待决策改善：** 用 `manual / skill / plugin` 记录 source 启用原因，增加会话内手动禁用覆盖规则。它不改变单槽位，但会改变现有 source 驻留行为，不能当普通重构悄悄实施。

## 4. 目标设计

### 4.1 三种状态必须分开

| 层 | 回答的问题 | 数据来源 |
|---|---|---|
| 包声明 | 作者希望提供什么？ | plugin.json、skills、mcp.json、扩展声明 |
| 物化结果 | 工作区实际有什么、来自哪里？ | 原生资源及最小来源信息；如引入安装记录须另行决策 |
| 会话可用性 | 这一轮哪些能力能使用？ | 启用状态、凭据、连接和执行检查 |

最小代码形态可采用：

```text
parsePackage → compileContributions → preparePlan
                                        ↓
                               verifyPlan → commitTransaction
                                        ↓
                           native resources + plugin package
                                        ↓
                            inspectHealth → activateSession
```

重点是让多个入口共享这些步骤，而不是再做一个插件运行时。

### 4.2 事务设计的必要边界

1. workspace 内串行化安装/卸载，避免并发覆盖同一资源。
2. 所有文件先暂存并验证；不要在校验未结束时修改正式 source。
3. skills、sources、包目录都用可逆的目录切换；记录 created/replaced/committed 状态。
4. 同一 workspace 内的多目录变更不是真正的单次文件系统原子操作。需要事务日志与恢复规则，才能涵盖进程中断，而不仅是 catch 回滚。
5. watcher 对受影响资源的通知在提交后合并；失败恢复后通知实际结果。
6. 凭据删除、旧备份清理在提交完成后执行；失败记录为待清理，不倒退已提交状态。
7. `data/` 按运行数据处理，不与新包携带的同名数据无条件合并。安装和重装的数据处理规则须明确。

### 4.3 所有权策略：近期保守，长期再决策

现有 D6 明确拒绝生命周期注册表，不能把增加永久安装账本伪装成内部修复。

**近期不改变 D6：** 路径守卫、完整回滚、provider 依赖检查、无法判定时禁止删除、计划绑定均可先做。引用索引继续可重建。

**建议重新讨论的边界：** 如果需要可靠清理升级删掉的资源、识别用户手改、恢复 provider，就需要知道“上一次真正安装了什么”。只读取当前包目录无法恢复这些历史事实。可选择最小安装记录，包含已物化资源清单、来源与内容摘要，而不引入自动更新、版本求解或插件市场。

这是明确的产品权衡：保留完全无安装历史的简化模型，就要接受保守保留旧资源并要求显式清理；引入最小记录，则承担记录迁移与恢复成本。

## 5. 分阶段实施计划

| 阶段 | 工作包 | 主要改动范围 | 验收门槛 |
|---|---|---|---|
| A · P0 | 资源路径守卫、安装回滚、共享 provider 卸载保护、损坏引用保护 | storage / install / sources storage | 失败不丢旧资源；任何删除局限合法资源目录；保留的 stdio source 不指向被删包 |
| B · P1 | 统一编译校验、Windows 字符串修复、原生 skill 名单、source 替换语义 | validation / resolve / plugin-context / install | 分析与执行一致；两种 skill 入口读同一物化内容；URL 原样保留 |
| C · P1 | planId 与事务恢复、对话式管理工具、归档导入链路 | shared service / agent tools / RPC / import | 变更后的包不能消费旧确认；目录和归档都能从对话完成安装；导入失败可清理和重试 |
| D · P1 | 内容刷新、稳定诊断、会话与资源可用性展示、文档校准 | watcher / DTO / renderer / docs | 编辑健康包也刷新；失败归属明确；能区分已安装和可用 |
| E · P2 | 作者校验样例、兼容性矩阵、可选最小安装记录及迁移 | fixtures / docs / optional metadata | 至少验证 skill-only、stdio、HTTP、API/local 待配置等真实场景后再扩展分发 |

每阶段拆成可独立验收的 PR；A 完成后才推进涉及新入口的 C。B/D 中互不依赖的工作可在获准并行时安排。本方案不承诺无依据的日程估算。

## 6. 回归矩阵

| 范围 | 必测场景 |
|---|---|
| 安装失败 | 第一个/后续 skill、source、包切换失败；新增与覆盖混合；旧 config、guide 和凭据状态不受破坏 |
| 路径 | MCP key 父级跳转、绝对路径、Windows 路径形式、目标根目录、符号链接/重解析点 |
| 共享 | A/B 同 slug，卸载当前 provider；另一引用包损坏；不同内容冲突；重复声明 |
| 执行内容 | 修改原生 skill 后两入口一致；修改包内 skill 未重装不影响物化版本；缺失物化项显式报错 |
| 参数 | URL、JSON、正则、普通文本、占位符混合值，在 Windows/POSIX 均保留语义 |
| 确认 | 分析后修改包、修改目标资源、重复消费、跨 workspace 使用计划 |
| 导入 | manifest 在根目录/单顶层目录、多包、穿越路径、链接、解压超量、超时、取消、写盘失败 |
| 会话/UI | A→B→取消，待认证、卸载当前插件、同名重装、正常元数据变更和损坏恢复 |
| 恢复 | 在提交各阶段中断后重启，工作区可恢复到明确的一致状态 |

本轮实际验证：

- 插件存储、安装、上下文三个套件分别独立执行：**24 + 30 + 11 = 65 项通过**。
- 会话激活与 prompt 稳定/动态分层：**16 项通过**。
- 合计 **81 项既有测试通过**，未运行全量测试。
- 额外隔离复现：回滚数据丢失与残留、共享 provider 丢失、Windows URL 改写、名单指向包内路径、MCP key 生成越界候选路径。
- 临时复现未启动外部 MCP、未操作真实用户插件；临时目录已清理。通过现有测试不代表上述缺陷不存在。

## 7. 文档与既有决策需要校准的地方

| 当前矛盾 | 建议 |
|---|---|
| 设计稿仍标 proposed/未实施，但实现已存在 | 建立“已实现/未实现/偏离”的状态表，历史决策保留 |
| 文档说安装原子化，代码未覆盖所有资源 | 先修复再写明实际保证，区分异常回滚与崩溃恢复 |
| 文档说校验有问题就停止，又说单项无效可跳过 | 统一 fatal / skipped / warning，并列出边界 |
| “至少一个 skill/MCP”与代码允许 extension-only 不一致 | 按既有决策核定最小实体，再使文档和编译结果一致 |
| “编辑包须重装”与包内名单实时读取冲突 | skill/source 走重装；PROMPT 即时生效单列 |
| 文档使用中文 slash 插件名，校验只允许 ASCII slug | 示例用合法 slug；如需中文展示名，另增显示字段 |
| “所有 symlink 禁止”与 data 子树跳过检查不一致 | 明确导入数据与运行数据的边界，补备份兼容性检查 |
| “卸载未安装插件静默”与显式激活抛错不一致 | 区分主动激活失败和运行中消失的行为 |

本轮仅新增评估文档，未回写或推翻原决策。

## 8. 需要确认的设计调整

以下不是阻止缺陷修复的前置条件，实施前应单独确认：

1. **是否引入最小安装记录？** 建议在确有升级清理、手改识别、provider 迁移需求时引入；否则先保守保留不确定资源。
2. **共享同名资源允许到什么程度？** 建议默认不把同名等同于兼容；存在执行依赖时先阻止危险卸载，迁移必须有明确计划。
3. **source 手动禁用是否优先于插件自动启用？** 建议优先，并记录启用来源；这会改变当前驻留语义。
4. **API/local 插件能否声明非敏感连接配置？** 建议后续允许 baseUrl、说明与参数模式等静态配置，凭据继续交由原生 source 管理；现阶段可保留待配置状态。

推荐首批实施范围是阶段 A，加上 B 中独立的 Windows 参数修复和 skill 执行路径统一。其余按阶段验收推进。
