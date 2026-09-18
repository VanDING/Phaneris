# Plugin bundles：决策登记册（实施前须全部关闭）

- 性质：**decision register**，设计文档的配套件。设计本身见 [`plugin-bundles-design.md`](plugin-bundles-design.md)
- 日期：2026-09-18
- 规则：**本册任一条未关闭，不得进入实施。** 关闭一条 = 选定一个选项并回写设计文档

## 状态图例

| 标记 | 含义 |
|---|---|
| `OPEN` | 未决定，必须在实施前关闭 |
| `REC` | 有推荐项，仍需你确认（推荐 ≠ 已定） |
| `FACT` | 已核实的事实或已确认的决策，登记在此仅为完整性，不需要再决定 |

---

## 零之一、决策依据留档（原 6 项 OPEN 的利弊展开）

> 原有 6 项 OPEN **已全部关闭**，另有 1 项新识别（P1-8）仍开放。
> 本节保留关闭时所依据的利弊展开，供日后回溯"为什么这样定"；
> 各小节标题已标注结论。**状态以 §P1–P9 的表格为准。**

### P1-1 只支持手写，还是也支持导入（zip / URL）？ ✅ **已关闭：(b) 支持导入，无前台 UI 入口**

| | (a) 只支持"放一个目录进去" | (b) 支持从 zip/URL 导入 |
|---|---|---|
| **实义** | 用户自己写 `plugin.json` + `skills/` + `mcp.json`；或从别处拷一个目录进来 | 提供一个安装动作，从本地 zip 或远程 URL 拉包并解开 |
| **利** | 零新代码：只要 `plugins/<name>/` 存在就是装好了；**无新安全面**；P5-8 直接关闭（不需要 flag） | 真正兑现 Agent Plugins 的"可移植分发"；用户能一键拿别人的包 |
| **弊** | 用户要自己处理解压、目录名、放对位置；"分享 plugin"只能靠手动传目录 | 引入**下载外部内容**的能力面：需要 flag（默认关）、来源校验、zip slip 防护、大小上限、可能的签名 |
| **与 P5-8 的耦合** | 选 (a) → **P5-8 关闭**，不需要 flag | 选 (b) → **P5-8 = 需要 flag 且默认关**，本地放置不受限 |
| **建议（当时的分析）** | 曾倾向 (a) 只支持本地放置，理由是"零新依赖、无新安全面"。**用户最终选 (b) 支持导入，但无前台 UI 入口**——执行者是 AI，导入由对话驱动；因此 P5-8 相应定为"需要 flag 且默认关"。此行的分析保留以供回溯 |

### P1-6 多个 plugin 同时驻留的数目上限？ ✅ **已关闭：1 个，静默替换（D12）**

| | (a) 不限 | (b) 设上限（如 3） |
|---|---|---|
| **实义** | 用户想 `/` 几个就几个 | 超过 N 个时拒绝或提示先取消一个 |
| **利** | 无摩擦；用户自己判断（他看得见 badge 列表） | 防止 prompt 片段无限累积——每个 plugin 都贡献一个 volatile 块 |
| **弊** | 违背"少 prompt"取向：5 个 plugin = 5 个片段 + 5 份名单，每轮重发 | 硬限制会在合法场景下挡路（比如一个 plugin 只带 1 个 source、片段很短） |
| **建议** | **(a) 不限，但用可见性代替硬限制**。给出 badge 列表让累积量可见即可。若日后实测到干扰，再加软提示（"你已激活 4 个 plugin，考虑取消不用的"）。硬上限是最难回退的那种设计 | |

### P2-1 扩展命名空间用哪个名字？ ✅ **已关闭：`phaneris`（设计文档 §3.4）**

| | 选项 |
|---|---|
| **实义** | spec §8 要求用**客户端控制的反域名**作为 `extensions` 的 key 与顶层目录名，用来放非 MCP source 声明（api / local） |
| **候选** | `org.phaneris` / `com.phaneris` / `io.phaneris` / 项目实际持有的域名反写 |
| **要求** | 必须是**本项目控制或有正当理由使用**的域名——spec 明确"SHOULD base its namespace on a domain name it controls" |
| **建议** | 取决于 `phaneris.identity.json` 里的品牌域名。**这条只能你提供事实**：项目持有哪个域名？若暂时没有，可用 `dev.phaneris` 占位但需在实施前替换（一旦发布就被包作者依赖，改名代价高） |
| **风险** | 命名空间是**对外契约**，改一次要动所有已发布的包。**建议一次定准** |

### P3-7 prompt 片段在轨迹快照里是否单独标注？ ✅ **已关闭：不单独标注**

| | (a) 与其它 volatile 块一致，不特殊处理 | (b) 单独标注 |
|---|---|---|
| **实义** | 片段混在 user 消息尾部，轨迹里看不出"这段来自 plugin" | 轨迹视图里把 `<plugin_context>` 这段高亮/折叠/标注来源 |
| **利** | 零成本 | 可调试：prompt 出问题时能一眼看出是哪个 plugin 注入的 |
| **弊** | 排查"为什么模型这样回答"时要自己翻 | 需要动 `packages/ui` 的轨迹渲染（`trajectory-snapshot.ts` / `trajectory-layout.ts`），是一个独立的小工程 |
| **建议** | **(a)**。理由：片段的块标签已经带 `name="..."`（P3-5），在原始 prompt 里可读可搜；专门的 UI 标注属于第二阶段的可观测性优化，不阻塞实施 |

### P5-4 是否需要插件级审计日志？ ✅ **已关闭：要，极简，复用现有日志设施**

| | (a) 不需要 | (b) 记一条"从 X 装了 Y" |
|---|---|---|
| **实义** | 装完即装完 | 落一条日志（时间、plugin 名、来源路径、安装的资源 slug、stdio command） |
| **利** | 零成本 | 出事可追（谁在什么时候引入了这个 stdio server）；与 §5.2 的"静默覆盖"配套，用户事后能查"我的 skill 是什么时候被换掉的" |
| **弊** | **静默覆盖发生后无法追溯** | 多一个日志文件与轮转策略 |
| **建议** | **(b)，但极简**：复用现有日志设施，只记一行，不新建文件格式。理由：这是成本最低的可追溯性，而"覆盖"是我们明知会让用户困惑的行为 | |

### P7-4 多 workspace 时是否提示"该 plugin 未安装到当前 workspace"？ ✅ **已关闭：静默不显示**

| | (a) 提示 | (b) 不提示 |
|---|---|---|
| **实义** | 用户切到另一个 workspace，`/` 菜单里看不到那个 plugin，给一句说明 | 静默不显示 |
| **利** | 解决真实困惑："我明明装了，怎么没了"——因为 D1 是 workspace 所有，必须逐 workspace 安装 | 零成本、UI 干净 |
| **弊** | 需要跨 workspace 查 plugin 清单（读其他 workspace 的 `plugins/` 目录），略微扩大读取面 | 用户会重复困惑，尤其在他刚在 A workspace 装完就切到 B |
| **建议** | **(a)**，但只在**空态**提示（"本 workspace 还没有 plugin；你在其他 workspace 装有 N 个"），不在每次切换时弹提示。空态是用户最需要解释的时刻 | |

### P1-8 导入支持哪种归档格式？（P1-1 选 (b) 后新增） ✅ **已关闭：仅 tar(.gz)**

| | (a) 仅 zip | (b) 仅 tar(.gz) | (c) 两者 |
|---|---|---|---|
| **实义** | 只认 `.zip` | 只认 `.tar` / `.tar.gz` | 都认 |
| **利** | zip 是普通用户最熟悉的格式（右键压缩）；无新依赖？**否**——Node 内置无 zip 解压，需引入依赖（`yauzl`/`adm-zip`/`unzipper` 等） | 仓库根**已有 `tar`**（`package.json` devDependencies，electron-builder 在用），**零新依赖** | 体验最好 |
| **弊** | 需评估并引入一个新依赖 | 普通用户不熟悉 tar；Windows 原生「压缩为 zip」不含 tar | 两条代码路径 + 两套 zip-slip 校验 |
| **建议** | **(b) 仅 tar** 起步：零新依赖、且 `tar` 库自带路径安全检查能力（`preservePaths` 默认关闭）。**无论选哪个，路径逃逸校验都必须自己再做一遍**，不依赖库的默认行为 |

> **决策依据（用户）**：本次设计**关闭了用户的操作路径——实际执行者是 AI**，
> 因此不需要照顾普通用户对 zip 的熟悉度；且电脑普遍自带 zip 工具，更无必要为此增加依赖。
> 仓库根**已有 `tar`**（`package.json` devDependencies，electron-builder 在用），**零新依赖**。
> 附带收益：tar 库自带路径安全检查能力（`preservePaths` 默认关闭）。
>
> **不变的要求**：无论用哪个库，**路径逃逸（zip slip 等价物）校验必须自己做一遍**，不依赖库默认行为。

---

## 零之二、R1 与 R2 的利弊展开

> 供批量确认用。R1（8 项）逐条展开——其中 R1-2 一条覆盖 P2-2 与 P2-3 两个编号，
> 故共 7 个小节、覆盖全部 8 项；R2（18 项）按主题分组展开。
> **结论以 §P1–P9 表格为准**，本节是判断依据。

### R1-1 P1-2 是否需要"列已装 plugin"的接口？ ✅ **已关闭：不需要接口**

| | (a) 只靠侧边栏目录（推荐） | (b) 提供清单接口（CLI / 工具） |
|---|---|---|
| **实义** | plugin 清单 = `ls <ws>/plugins/`；侧边栏已有一栏 | 增加一个可编程的枚举入口 |
| **利** | 零新契约；AI 本来就能 `ls`（`Read`/`Glob`/Bash 都在） | 结构化输出、可被脚本消费 |
| **弊** | 无 | **一旦发布就是对外契约**：字段增减要向后兼容；且与 D12 单槽位叠加后价值有限（最多 1 个激活，但有 N 个已装） |
| **建议** | **(a)**。理由：AI 是执行者，"列出来"用 `ls` 即可完成；把它做成接口只增加维护面 | |

### R1-2 P2-2 / P2-3 元数据不一致时拒绝还是容忍？（一条覆盖 2 个 R1 项） ✅ **已关闭：拒绝**

| | (c) 拒绝（推荐） | 容忍（以某一方为准） |
|---|---|---|
| **实义** | 目录名 ≠ `plugin.json` 的 `name`，或 `skills/<slug>/` 的 slug ≠ 目录名 → **整个安装失败并报错** | 选一个真相源，静默接受不一致 |
| **利** | 归属性无歧义——`_index.json`（D10）与 provenance badge 都依赖"名字就是身份"；错误早暴露，AI 可自行改正后重试 | 更宽容，手写 plugin 时不易踩坑 |
| **弊** | 手写 plugin 时容易因为一个笔误被拒；AI 需要一轮往返修正 | **一旦不一致，事后无法判断某个 skill 属于哪个 plugin**，D10 的引用计数会算错、卸载会删错 |
| **建议** | **(c) 拒绝**。理由：D10 的引用计数正确性建立在"slug 是身份"之上；容忍不一致会让卸载逻辑出现静默错误，而静默错误在这个系统里代价最高 | |
| **补充** | 因为是 AI 执行，拒绝的成本很低——报错信息里直接给出期望值，AI 下一轮就能改对。**这一点改变了我原本对"拒绝会烦人"的估计** | |

### R1-3 P3-2 `PROMPT.md` 的大小上限？ ✅ **已关闭：不设上限（协议无约定）**

> **决策规则（用户）**：协议有约定就遵循协议，**没有约定就不自行发明**。
> **核实结果（2026-09-18，已查两份规范原文）**：
>
> | 规范 | 与 `PROMPT.md` 大小相关的约定 |
> |---|---|
> | **Agent Plugins 1.0.0** | **无**。§7 明确 v1 只有两种组件类型：skills 与 MCP servers。`PROMPT.md` 不在协议内，协议无从约定 |
> | **Agent Skills**（被 Agent Plugins §7.1 引用为 skill 格式的真相源） | 对 `SKILL.md` **正文**明确写 **"There are no format restrictions"**；只有**推荐**值：正文 <5000 tokens、<500 行；frontmatter 字段有硬限制（`name` ≤64、`description` ≤1024、`compatibility` ≤500） |
>
> **故：不设上限。** 且不设是安全的——**替代约束是既有的、非新增的**：
> ① `description` ≤1024 字符（规范硬限制）⇒ 名单条目天然有界；
> ② Agent Skills 自身的建议就是"长内容拆分到 `references/`"⇒ 知识型内容本就该走 skill 按需加载，
> 而不是常驻 `<plugin_context>`。本设计的块里只有名单 + 插件级指令，没有放大文本的位置。
>
> **附带的一致性收获**：Agent Skills 规定的三级加载（① 元数据 ~100 tokens 启动加载 →
> ② `SKILL.md` 正文激活时加载 → ③ 资源按需）**正好就是本设计的形态**——
> `/plugin` 注入名单 = ①，模型主动 `Read` = ②。见设计文档 §4.3.2。

| | (b) 设上限（建议 ≤8KB），超限要求拆分进 skill（推荐） | (a) 不设上限 |
|---|---|---|
| **实义** | 超过阈值时安装即报错，提示"把长内容移到 `skills/` 里" | 片段多长都注入 |
| **利** | 每个片段的**单体**成本有确定上界（≤上限），且这是**唯一**的成本闸门——因为 P1-6 定为单槽位后可激活片段恒为 1 个，数量侧已无风险，成本控制完全落在单体上限上 | 无摩擦 |
| **弊** | **对包作者的对外契约**：改上限要通知已发布的包作者；8KB 的数值是拍的 | 长片段每轮重发，且违背"少 prompt"取向 |
| **建议** | **(b)**，但把数值的**依据**写清：`system-prompt-per-turn-analysis.md` 已确立"文档型内容应按需加载、指令型内容才常驻"。8KB ≈ 2K token 量级的"指令型"上限；知识型内容本就该进 `skills/` 走按需读 | |

### R1-4 P3-4 片段内容是否做 XML 转义？ ✅ **已关闭：(a) 转义**

> **先说清机制**（已核实）：`defangBlockTag`（`system.ts:403-406`）**不是整体转义**，
> 而是**外科式**——只把 `</tagName>` 序列替换为 `&lt;/tagName&gt;`，大小写与空白不敏感，
> **markdown 与代码原样保留**。这才是正确的做法，整体转义会毁掉片段里的代码块。

| | (a) 转义（照 `defangBlockTag`，推荐） | (b) 不转义 |
|---|---|---|
| **实义** | 对 `<plugin_context>` 的闭合标签做外科式转义，并可叠加 `stripDangerousControlChars`（`system.ts:417-420`，已存在） | 原样注入 |
| **利** | 防注入：否则片段里写一个 `</plugin_context>` 就能**提前闭合块**，其后内容被模型当作块外指令；还能顺带伪造 `<sources>` 等其他块 | 片段里的代码/示例零改动 |
| **弊** | 若片段确实要展示 `</plugin_context>` 字面量，会被显示为转义形式（极罕见） | **安全缺口**：`plugin.json` / `PROMPT.md` 可来自外部导入（P1-1=(b)），此时是不可信输入 |
| **建议** | **(a)**。理由：P1-1 选了支持外部导入，**片段就是不可信输入**，这与 `sanitizeProjectBodyText`（`system.ts:422-425`）已有先例完全同构——那套防御就是为"外部内容进入 prompt"准备的 | |

### R1-5 P5-1 覆盖用目录级替换还是逐文件覆盖？ ✅ **已关闭：目录级替换**

| | (a) 目录级替换（先删后建，推荐） | (b) 逐文件覆盖 |
|---|---|---|
| **实义** | 安装新版本时先整体删除目标目录再重建 | 逐文件写入，旧文件若新版本没有则保留 |
| **利** | **能清掉旧版本删除过的文件** —— 否则旧 skill 的 `scripts/`、旧 source 的 `guide.md` 会作为残留继续参与加载，产生"幽灵文件" | 不破坏"用户改过但新版本没有"的文件 |
| **弊** | 用户对旧版本的**对话式修改会被整体丢弃**（与 D5/D6 一致，但需接受） | **残留是静默的**：用户以为升级干净了，实际旧文件还在被 `loadAllSkills` 读到 |
| **建议** | **(a)**。理由：D6 已经确立"后安装覆盖现有"，(b) 只覆盖了写过的文件、留下了没写的——那是"半覆盖"，比全删更难预测。若要保留用户修改，正确做法是重装前提示，而不是靠半覆盖 | |

### R1-6 P5-3 安装是否原子化？ ✅ **已关闭：(a) 原子化**

| | (a) 原子化（临时目录 + 失败清理，推荐） | (b) 尽力而为 |
|---|---|---|
| **实义** | 复用 `resource-bundle.ts:726-737` 已有的"临时目录暂存 → 校验 → 挪入，失败则 `rmSync` 清理"模式 | 直接写目标目录，失败就停在半路 |
| **利** | 失败后 workspace 保持原样，用户可重试；**且是 D9"先确认后安装"的必要配套**（用户确认的是一个可回滚的动作） | 实现更少 |
| **弊** | 需要一个临时目录位置与清理逻辑（已有先例，成本低） | **半安装状态**：部分 skill 已物化、部分没有，`_index.json` 与实际不一致，后续卸载会算错引用计数 |
| **建议** | **(a)**。理由：D10 的引用计数是"文件与索引必须一致"的假设；(b) 直接破坏这个假设 | |

### R1-7 P5-6 安装是否沿用 `safeMode` 管线？ ✅ **已关闭：(a) 沿用**

> **先说清机制**（已核实）：`safeMode: 'allow' | 'block'` 是**工具可见性**——blocked 工具
> 在 Explore/Safe 模式下**根本不出现在模型的工具表里**（`tool-defs.ts:945-967`），而不是调用后拒绝。
> 现有惯例非常一致：**只读 = `allow`，任何状态变更 = `block`**（`artifact_create`、`create_task`、
> `create_page`、`source_test` 全部 `block`）。
> 另外已核实：`shouldPromptInAskMode`（`pre-tool-use.ts:1018`）是**逐调用的确认管线**，
> 覆盖 Write / Edit / Bash / MCP / API 工具——**所以 D9 的确认清单有现成落点，不需要新机制**。

| | (a) 沿用 `safeMode`（推荐） | (b) 单独门禁 |
|---|---|---|
| **实义** | 安装/卸载写 `safeMode: 'block'`（Explore 下模型不可见）；校验类写 `'allow'` | 为 plugin 另设一套许可判断 |
| **利** | 与 40 个现有工具的定义惯例一致；Explore 模式天然装不了可执行内容 | 可按 plugin 类型细分（如"纯 prompt 允许、带 stdio 阻断"） |
| **弊** | 粒度是"整个工具"，无法对纯 prompt 的 plugin 放宽 | 第二套许可逻辑，需与 `safeMode` 及 Ask 模式管线保持同步，是长期维护负担 |
| **建议** | **(a)**。理由：D9 的用户确认已经由 `shouldPromptInAskMode` 承担，`safeMode` 只需负责"Explore 下不可见"。两者叠加即达成完整门禁，**不需要第三套机制** | |

### R2 中风险（18 项）—— 按主题分组的利弊

#### 主题 A：命名与版本（P1-4 / P1-5）

| | 推荐 | 利 | 弊 |
|---|---|---|---|
| **P1-4** 名约束照 spec §5.5 | 1–64 字符、`a-z0-9-.`、首尾字母数字、禁 `--`/`..` | 与 Agent Plugins 一致，外部包直接可用；目录名安全性天然成立（无路径分隔符） | 大写名会被拒——但 AI 执行时可自动 `slugify` 修正 |
| **P1-5** 只保留会话驻留 | 只有 `/` 会话驻留，不给一次性语法 | 作用域模型唯一，`activePlugin` 是单值，实现与心智都最简 | 想要"这一次用一下"的用户只能切过去再切回来——但 D12 的切换本就是静默的，成本≈0 |

#### 主题 B：加载路径隔离（P2-4 / P2-5 / P2-6）

| | 推荐 | 利 | 弊 |
|---|---|---|---|
| **P2-4** 加回归测试 | 两条测试锁死"`plugins/` 不被 skill / source 加载路径扫到" | 防止包内 `skills/` 被当成 tier 加载（一旦发生，包内 skill 会**莫名出现在 Skills 列表**且来源不明） | 两条测试的维护成本 |
| **P2-5** 安装后主动失效缓存 | 调 `invalidateSkillsCache()`（`skills/storage.ts:201` 已存在） | 装完立即可见；否则要等 5 分钟 TTL | 一行代码 |
| **P2-6** `plugins/` 纳入 watcher | 与 sources/skills 一致（`watcher.ts:233-234`） | 外部改动（用户手动放目录 / 删除）也能触发 UI 刷新 | 需注意别让 watcher 递归进 `plugins/*/skills/` 而误触发 skill 变更事件——**这是个真实小坑** |

#### 主题 C：prompt 片段细节（P3-1 / P3-5）

| | 推荐 | 利 | 弊 |
|---|---|---|---|
| **P3-1** `PROMPT.md` 可选 | 不强制存在 | 纯资源型的 plugin（只带 skill / source）无需写空文件 | 无 |
| **P3-5** 标签名 `<plugin_context name="...">` | 带 `name` 属性 | 轨迹与日志里可定位来源（P3-7 定为不特殊标注后，**这是唯一的来源线索**） | 与现有块风格（`<sources>`、`<session_state>`）一致，无风险 |

#### 主题 D：调用与状态（P4-4 / P4-5 / P4-6 / P4-7 / P4-8）

| | 推荐 | 利 | 弊 |
|---|---|---|---|
| **P4-4** badge 上取消 | 与 `ActiveOptionBadges` 一致 | 与"取消权限模式"同一交互语言 | 需与 D12 的"`/B` 替换 `/A`"两种取消路径并存，UI 要说清 |
| **P4-5** 状态存 session 字段 | 照 `enabledSourceSlugs`（`sessions/storage.ts:223,550,570`） | 持久化、恢复、跨客户端一致全部免费 | 需在 `loadConfig` 的字段白名单里登记（**该文件有"新持久字段必须加进 allowlist 否则被丢弃"的既有教训**） |
| **P4-6** 引用已卸载的 plugin 静默跳过+提示 | 不报错 | 用户不会因为历史输入里有旧名而卡住 | 提示必须是"软"的，否则每次翻旧会话都弹 |
| **P4-7** 两个菜单不互相提示 | 不做交叉引导 | 零成本 | 用户可能不知道有 `/` 这条路径——靠安装成功页与 `docs/plugins.md` 弥补 |
| **P4-8** 预启用 `requiredSources` | 照既有语义 | 与 `@skill` 行为一致，不产生第二套规则 | 可能激活用户没预期的 source（但 `@skill` 今天也这样） |

#### 主题 E：卸载与凭据（P5-9 / P6-3 / P6-5 / P6-6）

| | 推荐 | 利 | 弊 |
|---|---|---|---|
| **P5-9** 卸载也原子化，先摘索引后删文件 | 顺序固定 | 中途失败留"孤儿资源但可用"，比"索引指向已删文件"安全 | 与 P5-3 共用临时目录机制 |
| **P6-3** 扩展声明复用 `CreateSourceInput` 子集 | 不造第二套 source 描述语言 | 校验、默认值、字段演进全部复用；`phaneris/sources.json` 与 `phaneris source create --json` 同构 | 会继承 `CreateSourceInput` 的历史包袱（但它本就是这个系统的 source 契约） |
| **P6-5** 凭据由用户装后自走 OAuth | 包内不声明凭据 | spec §7.2.1 **明确禁止** headers 内嵌密钥；凭据按 workspace 隔离（`source_oauth::{workspaceId}::{slug}`） | 装完可能需要一次授权往返——但这与手工加 source 完全一致 |
| **P6-6** 包内 api source 要求 `guide.md` | 保持"用前必读" | 与 `source-manager.ts:214-220` 的"未读 guide 则封锁工具"一致；否则 plugin 带来的 api source 会成为唯一无 guide 门禁的例外 | 包作者多写一份 guide——但 AI 执行时可按 `source init-guide` 模板生成 |

#### 主题 F：配置校验（P8-2）

| | 推荐 | 利 | 弊 |
|---|---|---|---|
| **P8-2** `config_validate` 的 `target` 加 `'plugins'` | 纳入既有校验枚举（`tool-defs.ts:105-109`） | AI 写完 plugin 能自查，闭环；与 skills / sources / automations 同级 | 需实现一份 plugin 校验器（但这本就要有，见 §5.3） |

---

## P1 定位与边界

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P1-1 | plugin 只能由用户手写，还是也支持导入他人分发的包？ | **(b) 支持导入（zip / URL），但\*\*不提供前台导入 UI\*\*——走对话，AI 读 `docs/plugins.md` 后操作** | `FACT` 已定 —— 连带：**P5-8 = 需要 flag 且默认关**（外部获取第三方内容），本地目录放置不受限；新增 **P1-8** | — |
| P1-2 | 需要"列已装 plugin"的能力吗（CLI / 工具 / UI 列表）？ | **(a) 不需要接口**，只靠侧边栏目录 | `FACT` 已定 —— AI 是执行者，需枚举时 `ls <ws>/plugins/` 即可；做成接口会变成需向后兼容的对外契约 | — |
| P1-3 | 是否允许"禁用（不卸载）"plugin？ | (a) 只能卸载 (b) 可禁用 | `FACT` 已定 (a)，保持 D6 简单 | source 侧有 `enabled` 先例，禁用会引入"物化了但不生效"的中间态 |
| P1-4 | plugin 名（`<name>`）字符集与长度约束 | 照 Agent Plugins spec §5.5：1–64、`a-z0-9-.`、首尾字母数字、禁 `--`/`..` | `FACT` 已定 照抄 spec | 目录名合法性 |
| P1-5 | 是否保留 `/plugin` 的"一次性（仅本条消息）"用法？ | (a) 只有会话驻留 (b) 另给一次性语法 | `FACT` 已定 (a)，**D8 已定会话驻留** | 若要 (b) 需第二套作用域机制 |
| P1-6 | 多个 plugin 同时驻留时，上限？ | **(1 个)**。session 只存 `activePlugin: string \| null`；`/B` **静默替换** `/A` | `FACT` 已定 —— **D12**，见设计文档 §4.5。理由：plugin 已是"合集"，不需要"合集的合集"；单槽位让 prompt 成本为常数 | — |
| P1-8 | 导入支持哪种归档格式？ | **仅 tar(.gz)** —— 仓库根已有 `tar`（`package.json` devDependencies），**零新依赖**；tar 库自带路径安全检查能力（`preservePaths` 默认关闭） | `FACT` 已定 —— 依据：本设计**关闭了用户操作路径、执行者是 AI**，无需照顾 zip 的熟悉度；且系统普遍自带 zip 工具，更无必要引入依赖。**不变要求**：路径逃逸校验仍须自做一遍 | — |
| P1-7 | 卸载 plugin 时，其物化的 skills/sources 是否一同删除？ | **(a) 全删，但按 D10 的引用计数：只删计数归零者**；`_index.json` 为**派生**（可安全删除，下次重建） | `FACT` 已定 —— 见设计文档 D10 与 §3.2 | — |

---

## P2 包结构与目录

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P2-1 | 扩展命名空间目录名与 `extensions` key 用什么？ | **`phaneris`**（用户确认可） | `FACT` 已定 —— §3.4。已核实项目**不持有任何域名**：`phaneris.identity.json` 的 `services` 段六项全为 `null`，唯一反域名式标识是 `appId: io.github.vanding.phaneris`（基于 GitHub 路径）。`phaneris/` 对自写 plugin 的用户最直观；偏离 spec 的 SHOULD 但互操作损失为零 | — |
| P2-2 | `<name>` 与包内 `plugin.json` 的 `name` 不一致时以谁为准？ | **(c) 拒绝安装并要求一致** | `FACT` 已定 —— D10 的引用计数建立在"slug 即身份"上；容忍不一致会产生**静默错误**（归属错→卸载删错）。AI 执行时拒绝成本低：报错给出期望值即可修正 | — |
| P2-3 | `skills/` 下技能 slug 与目录名不一致时？ | **拒绝**（与 P2-2 同一条规则） | `FACT` 已定 —— Agent Skills spec 本身即要求 `name` **Must match the parent directory name**，拒绝是照协议执行 | — |
| P2-4 | 嵌套 `plugins/` 是否需要显式排除加载路径的回归测试？ | (a) 加测试锁死 (b) 靠代码审查 | `FACT` 已定 (a) —— skill 与 source 两条加载路径各一条测试 | 出现"包内 skill 被当 tier 加载"的隐患 |
| P2-5 | skill 缓存失效是否补 `plugins/` 触发？ | (a) 补（安装后主动失效） (b) 靠 5 分钟 TTL | `FACT` 已定 (a) —— `invalidateSkillsCache()` 已存在（`skills/storage.ts:201`） | 装完插件最多 5 分钟才可见 |
| P2-6 | `plugins/` 目录是否纳入 `config/watcher.ts`？ | (a) 纳入 (b) 不纳入，安装后主动推事件 | `FACT` 已定 (a)，与 sources/skills 一致（`watcher.ts:233-234`） | UI 不刷新 |
| P2-7 | 是否需要全局（跨 workspace）plugin 层？ | (a) 不要（D1 已定 workspace 所有） (b) 要 | `FACT` (a) —— 但见 P4-1 | — |
| P2-8 | plugin 目录是否随 workspace 备份/导出（`workspace-backup`）？ | **(a) 包含，且无需 opt-in** —— `createWorkspaceBackup` 是**全量备份**：`walkFiles()` 递归整个 workspace（`workspace-backup.ts:67-75`），`plugins/` 自动在内 | `FACT` 已定 —— 但因此产生 **D11**：备份遇 symlink 直接 `throw`（`:72`、`:93-105`），安装器必须拒绝包内符号链接 | — |
| P2-9 | 安装器是否必须校验并拒绝包内符号链接？ | **是**（D11） | `FACT` 已定 —— 不拒绝的话，一个含 symlink 的 plugin 会让**整个 workspace 备份失败** | — |
| P2-10 | `ResourceBundle` 导出时是否携带 plugin 来源？ | (a) 不携带（导出的是资源本身） (b) 携带 | `FACT` 已定 (a) —— `exportResources()`（`resource-bundle.ts:118-166`）只处理 sources/skills/automations，本就不认 plugin；需要接受"导出后来源信息丢失" | 用户可能困惑"我导出的 skill 是哪来的" |

---

## P3 prompt 片段

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P3-1 | `PROMPT.md` 是否必需？ | (a) 可选 (b) 必需 | `FACT` 已定 (a) | — |
| P3-2 | `PROMPT.md` 大小上限？ | **不设上限** —— **协议无约定**，按你的规则不自行发明 | `FACT` 已定 —— 已核实两份协议：Agent Plugins 1.0.0 的组件只有 skills 与 MCP servers（§7），**`PROMPT.md` 不在协议内**，故协议无从约定其大小；Agent Skills spec 对 `SKILL.md` 正文明确写 **"There are no format restrictions"**，只有**推荐**值（正文 <5000 tokens、<500 行）。**替代约束（既有、非新增）**：① Agent Skills 的 description ≤1024 字符 → 名单条目天然有界；② P6-2 的 `<plugin_context>` 块只有名单 + 插件级指令，无大文本位置 | — |
| P3-3 | 多 plugin 片段拼接顺序与冲突（互斥声明）如何处理？ | (a) 按激活顺序拼接 (b) 引入互斥声明 | `FACT` 已定 (a)，冲突不检测 | 两个冲突的 plugin 同时驻留会互相打架 |
| P3-4 | 片段内容是否做 XML 标签转义？ | **(a) 转义**，照 `defangBlockTag`（`system.ts:403-406`，**外科式**：只替换 `</tagName>`，markdown/代码原样保留）+ 可叠加 `stripDangerousControlChars`（`:417-420`） | `FACT` 已定 —— P1-1 支持外部导入 ⇒ 片段是**不可信输入**；与 `sanitizeProjectBodyText`（`:422-425`）同构 | — |
| P3-5 | 片段的块标签名？ | 建议 `<plugin_context name="...">` | `FACT` 已定 | 与现有块风格一致性 |
| P3-6 | 上下文压缩（compaction）后片段是否重新注入？ | (a) 每轮都注入，天然重注 (b) 只在首轮 | `FACT` 已定 (a) —— 形态上就是每轮 volatile，无需特判 | — |
| P3-7 | 片段是否出现在轨迹（trajectory）快照里、是否需要可视化？ | **(a) 不单独标注**，与其它 volatile 块一致 | `FACT` 已定——无特殊性 | — |

---

## P4 调用形态

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P4-1 | `/` 是唯一入口，确认不提供 `@`？ | (a) 只 `/`（D7） (b) 也提供 `@` | `FACT` (a) | — |
| P4-2 | 输入里插入的 token 是**保留可见**还是选完即删？ | (a) 保留为 badge（照 folder 范式，`FreeFormInput.tsx:1510-1515`） (b) 选完即删（照 command 范式） | `FACT` 已定 (a) —— 用户需要看到"本条已激活" | 与 `/compact` 的行为不同，需在 UI 上区分清楚 |
| P4-3 | 激活后 skill 是**全部强制注入**还是**只给名单**？ | **(b) 只给名单，渐进式披露，无门禁** | `FACT` 已定 —— 见设计文档 §4.3.1 | — |
| P4-4 | 取消激活的入口（badge 上点 ×？再打一次 `/` 切换？） | (a) badge 上取消 (b) 重复 `/` 切换 | `FACT` 已定 (a) —— 与 `ActiveOptionBadges` 一致 | 交互一致性 |
| P4-5 | 驻留状态存在哪？ | session 字段（照 `enabledSourceSlugs`） | `FACT` 已定 —— `sessions/storage.ts:223,550,570` 是现成先例 | 持久化与恢复 |
| P4-6 | 输入里引用了已卸载的 plugin 名时？ | (a) 静默跳过 + 提示 (b) 报错 | `FACT` 已定 (a) | — |
| P4-7 | 用 `/` 菜单里的 plugin 段与 `@` 菜单是否需要互相提示？ | (a) 不需要 (b) 需要 | `FACT` 已定 (a) | — |
| P4-8 | plugin 激活是否也预启用 `plugin.json` 未列出、但包内 skill 的 `requiredSources` 指向的 source？ | (a) 是（照现有 `requiredSources` 语义） (b) 否 | `FACT` 已定 (a) | 与既有机制一致性 |

---

## P5 安装、属性与安全

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P5-1 | "覆盖"粒度：目录级替换还是逐文件覆盖？ | **(a) 目录级替换** | `FACT` 已定 —— 逐文件覆盖是"半覆盖"：旧版删过的文件会作为**静默残留**继续被 `loadAllSkills` 读到 | — |
| P5-2 | 覆盖清单比对依据：slug 相同即列出，还是内容不同才列出？ | (a) slug 相同就列 (b) 内容不同才列 | `FACT` 已定 (a) —— 简单且不漏 | 提示噪音 |
| P5-3 | 安装到一半失败如何回滚？ | **(a) 原子化**：临时目录暂存 + 失败清理（复用 `resource-bundle.ts:726-737` 既有模式） | `FACT` 已定 —— 是 D9"先确认后安装"的必要配套；半安装状态会破坏 D10 引用计数所依赖的"文件与索引一致"假设 | — |
| P5-9 | 卸载是否也做原子化？ | (a) 同样用临时目录/先摘索引后删 (b) 直接删 | `FACT` 已定 (a) —— 卸载中途失败会留下"索引已摘但文件还在"，比反过来安全 | 不一致状态 |
| P5-4 | 需要插件级审计日志吗？ | **(b) 要，但极简**：复用现有日志设施，只记一行，不新建文件格式 | `FACT` 已定 —— 与 §5.2 的"静默覆盖"配套，用户事后能查"我的 skill 何时被换掉" | — |
| P5-10 | stdio server 的 `cwd` / `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` 如何解析？ | **不支持 `cwd`**：非 `${PLUGIN_ROOT}` 起的 `cwd` ⇒ 该 server 条目无效（跳过该条、继续其余）。`command` / `args` / `env` 的 `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` **运行时展开**；`pluginRoot` 记在 source 的 `config.json`（workspace 相对）；`command` 规范化为插件根下绝对路径 | `FACT` 已定 —— 见设计文档 §5.4。**不实现 `cwd` 的理由是方向性的**：不传 `cwd` 时子进程从插件根运行，相对路径视图锚定在插件根内，是更强的 containment；支持 `cwd` 会让视图移出插件根 | — |
| P5-11 | `${PLUGIN_DATA}` 目录的归属与升级时的处置？ | **`<ws>/plugins/<name>/data/`**，不物化；**目录级替换（P5-1）必须显式排除它** | `FACT` 已定 —— 见设计文档 §5.4.7。不排除就是**静默数据丢失** | — |
| P5-12 | 是否顺带修复 stdio source 的 `cwd` 能力缺口？ | **不做**（本次范围外） | `FACT` 已定 —— 背景：`McpSourceConfigSchema`（`validators.ts:389-402`）与 agent 侧类型（`server-builder.ts:37`）均无 `cwd`；SDK 支持但从未接上。这是**独立于 plugin 的既有能力缺口**，需要时另行处理，不借插件工作夹带 | — |
| P5-5 | stdio MCP 插件是否要独立于 `isLocalMcpEnabled()` 的开关？ | **(a) 复用开关，尊重它**（`localMcpServers.enabled` 默认 **true**，见 `workspaces/storage.ts:478-491`）；**但 D9 的安装确认清单必须展示 stdio server 的 `command` 全文与 `args`** | `FACT` 已定 —— 更正：登记册初版说"默认关闭"是错的 | — |
| P5-6 | 安装是否要求提升权限模式（Explore 下可否安装）？ | **(a) 沿用 `safeMode` 管线**：安装/卸载 = `safeMode: 'block'`（Explore 下工具对模型不可见），校验类 = `'allow'` | `FACT` 已定 —— 与 40 个现有工具"只读=allow / 变更=block"惯例一致。**门禁由两层叠加达成，不需要第三套**：`safeMode` 管"Explore 不可见"，`shouldPromptInAskMode`（`pre-tool-use.ts:1018`）管"Ask 模式逐调用确认"（D9 落点） | — |
| P5-7 | 是否需要"恢复原始文件"（把用户改过的包内文件还原）？ | (a) 不做（D6，重装即恢复） (b) 做 | `FACT` 已定 (a) —— 重装已能达成同一效果 | — |
| P5-8 | 是否是 feature flag？ | **需要 flag 且默认关**（P1-1 已定为支持导入）；**本地目录放置不受 flag 限制** | `FACT` 已定 —— 规律：本仓库默认关的 flag 都是"向第三方发送/获取数据"或"未完成"（`feature-flags.ts`） | — |

---

## P6 非 MCP source

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P6-1 | CLI 能力是否确认为 `skill + Bash`，**不新增 `type: 'cli'`**？ | (a) 确认 (b) 加第四类型 | `FACT` 已定 (a) —— 设计文档 §6 | 枚举爆炸（见 §6.1 的 6 处 UI 枚举 + 3 处 route 校验） |
| P6-2 | 扩展声明文件的名称与路径 | **`phaneris/sources.json`**（目录名见设计文档 §3.4） | `FACT` 已定 | — |
| P6-3 | 扩展声明的 schema 形状 | 建议复用 `CreateSourceInput`（`sources/types.ts:527-536`）的子集 | `FACT` 已定 —— 避免第二套 source 描述语言 | 双份 schema |
| P6-4 | `type: 'local'` 是否借机补上 `command`/`args`/`env` 字段（以获得受控 CLI source）？ | **(a) 不补**；`type: 'local'` 保持书签语义（`server-builder.ts:330-358` 不构建它、不产生工具）。后续若有需要，作为独立的 source 功能开发 | `FACT` 已定 | — |
| P6-5 | 扩展声明的 api source 的凭据由谁提供？ | (a) 安装后用户自己走现有 OAuth/凭据流程 (b) 包内声明凭据引用 | `FACT` 已定 (a) —— spec §7.2.1 明确禁止 headers 内嵌密钥，凭据是客户端职责 | 安全 |
| P6-6 | `api` source 的 `guide.md` 是否要求包内提供？ | (a) 要求（保持"用前必读"一致性，`source-manager.ts:214-220`） (b) 可选 | `FACT` 已定 (a) | guide 门禁一致性 |

---

## P7 侧边栏与 UI

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P7-1 | 安装入口放哪（侧边栏 Plugins 段空态按钮 / 设置页 / 两者）？ | (a) 侧边栏空态 (b) 设置页 | `FACT` 已定 (a)，复用 `EntityListEmptyScreen` + `getEditConfig('add-skill')` 范式 | — |
| P7-2 | 是否需要**三级导航**（Plugins → 单个 plugin → 单个资源）？ | (a) 两级，资源点击跳到原生段 (b) 三级 | `FACT` 已定 (a) —— 三级会让 §7.2"条目唯一权威"退化 | 路由复杂度（`route-parser.ts` 需新增两处解析） |
| P7-3 | 原生段（Skills/Sources）的 provenance badge 样式与位置 | 用现成 `projectBadge` 位（`SkillsListPanel.tsx:81-85`） | `FACT` 已定 | — |
| P7-4 | 多 workspace 时是否提示"该 plugin 未安装到当前 workspace"？ | **(b) 静默不显示**，与 skill、source 一致，不需要解释 | `FACT` 已定 | — |
| P7-5 | 激活中的 plugin 以什么形式持续可见？ | badge（`ActiveOptionBadges` 同款） | `FACT` 已定 | — |

---

## P8 跨 workspace 与 CLI 域

| ID | 问题 | 选项 | 推荐 | 未决影响 |
|---|---|---|---|---|
| P8-1 | 是否提供 `phaneris plugin` 命令域？ | **(b) 不加 CLI 域**。编辑走 ① `EditPopover` 新条目 `'add-plugin'`（`{location}/plugins/` + 上下文提示）③ 新文档 `docs/plugins.md`，AI 直接写文件 | `FACT` 已定 —— 依据：守卫拦的是 `labels/` 读、source config、skill instructions、automations；`plugin.json` / `PROMPT.md` **不在其中**，直接写不冲突。文件需要守卫时再加 CLI 域 | — |
| P8-2 | 是否纳入 `config_validate` 的 `target` 枚举？ | (a) 纳入（`tool-defs.ts:105-109` 的 `target` 加 `'plugins'`） (b) 不纳入 | `FACT` 已定 (a) | 校验一致性 |
| P8-3 | 是否需要"装到全部 workspace"？ | (a) 不做 (b) 做 | `FACT` 已定 (a) —— 凭据按 workspace 隔离（`source_oauth::{workspaceId}::{slug}`）使共享无法绕过 | 多 workspace 用户体验；**会成为自然需求** |
| P8-4 | 是否在 `docs/README.md` 之外补 `release-notes/next.md`？ | (a) 实施时补（维护规则 4 要求） (b) 不补 | `FACT` (a) —— `docs/README.md` 维护规则第 4 条 | — |
| P8-5 | agent 文档 `docs/plugins.md` 是否同时给一个可复制的模板？ | **(a) 给**（照 `skills.md` 的示例密度） | `FACT` 已定 —— 文档是功能的实现载体（P1-1 无前台 UI），见设计文档 §11 |
| P8-6 | 文档交付的完整范围？ | **两套文档系统都要动**：① agent 必读 `resources/docs/plugins.md`（+ `DOC_REFS` + 系统 prompt 引用 + `EditPopover('add-plugin')`）② UI 文档 `guide/en/plugins/overview.md`（+ `manifest.ts` + `doc-links.ts`，受两条测试门禁约束） | `FACT` 已定 —— 完整清单与 **10 条必写陷阱**见设计文档 §11.2 / §11.3 |
| P8-7 | 文档的验收标准？ | ① 三条文档门禁通过；② **只给 AI `docs/plugins.md`，它能独立完成一次装配**（写包 → 校验 → 安装 → 确认清单 → `/` 调用）；③ §11.2 的 10 条陷阱全部出现 | `FACT` 已定 —— 见设计文档 §11.5 |

---

## P9 验收测试（不是决策，也不是先行阶段）

> **更正**：本册初版把 P9 写成"实施前需先补的事实验证"，这是错的——
> 这四条**离开代码就无法验证**。它们不是前置阶段，而是**各切片的验收测试（definition of done）**：
> 代码写完、测试通过，该切片才算完成。
>
> 其中 **P9-2 已有部分保护**：`packages/shared/src/agent/__tests__/prompt-builder-context-split.test.ts`
> 已锁死 volatile/stable 路由（issue #862，三条不变量）。plugin 片段只需补"它被路由到 volatile、
> 未混入 system 前缀"这一条增量断言。

| ID | 验收测试 | 归属切片（测试随代码一起写） | 通过标准 |
|---|---|---|---|
| **P9-1** | `plugins/` 嵌套内容不被 skill / source 加载路径扫到 | **切片 1（装载与目录约定）** | 两条回归测试通过：① `loadAllSkills(ws)` 不返回 `plugins/<name>/skills/<slug>`；② source 加载不把 `plugins/*/mcp.json` 当 source。**这条测试同时就是实现的约束** |
| **P9-3** | 预启用 source + 只给名单 **不触发 `SourceActivated` 重启** | **切片 3（`/plugin` 激活链路）** | 激活一个带 source 的 plugin 后，首轮事件流中**不出现** `source_activated` / `forceAbort(AbortReason.SourceActivated)`。对照基线：`SessionManager.ts:6814-6870` 的预启用发生在 agent 构建之前；反例是 `pi-agent.ts:2443-2454` 的运行时激活 |
| **P9-2** | 每轮注入片段后 **system 前缀字节稳定** | **切片 4（prompt 片段）** | 同一会话连续两轮、无配置变化时 `fullSystemPrompt` **全等**（哈希一致）。扩展 `prompt-builder-context-split.test.ts`，断言片段只出现在 volatile 输出、不出现在 `buildStableContextParts()` |
| **P9-4** | 卸载后 `<ws>/skills/` 与 `<ws>/sources/` **无孤儿** | **切片 5（卸载与引用计数）** | ① 单 plugin 卸载 → 其独占资源被删除；② 两 plugin 共享的资源在任一卸载后**仍存在**；③ `_index.json` 可删除并在重建后自洽 |

**注**：P9-1 ~ P9-4 全部无法在实现前完成，也不需要提前做。真正的顺序约束在切片之间（P9-1 的测试必须在切片 1 交付，否则后续切片会建在未验证的目录假设上）。

### P9 落地位置与状态

| ID | 测试落点 | 状态 |
|---|---|---|
| **P9-1** | `packages/shared/src/plugins/__tests__/plugin-storage.isolated.ts`（24 通过） | ✅ 已通过 |
| **P9-2** | `packages/shared/src/agent/__tests__/prompt-builder-context-split.test.ts`（含 2 条 plugin 断言） | ✅ 已通过 |
| **P9-3** | `packages/server-core/src/sessions/plugin-activation.test.ts`（9 通过） | ✅ 已通过 |
| **P9-4** | `packages/shared/src/plugins/__tests__/plugin-install.isolated.ts`（27 通过） | ✅ 已通过 |

**P9-3 的实现要点**：断言不是"没有崩溃"，而是**否定性断言** —— 直接检查 agent 的 `forceAbort` 从未被调用、事件流中不存在 `source_activated`，并以同一次激活必定产生的 `sources_changed` 作为阳性对照。这样"把激活简化成走运行时路径"这类改动会在此处失败，而不是悄悄让每次激活都丢掉一轮。

**P9-3 附带发现**：`SessionManager` 的 `sendEvent` 与 `broadcast*Changed` 是两种不同的 eventSink 调用形状（前者 3 参、后者 4 参），payload 位置不同。测试若按后者的形状读取前者，会把"事件确实发出"误读成"事件缺失"。

---

## 附一、REC 风险分层（**全部已关闭**）

> 32 项 REC 已按用户决定**全部沿用推荐**，登记册因此达到 **0 OPEN / 0 REC**。
> 本节保留分层依据，供日后回溯"哪些当初被判定为高风险"。
> 分层依据：**改主意的代价** × **影响面** × **是否对包作者构成对外契约**。





### R1 高风险（8 项，已全部关闭）

| ID | 推荐 | 为什么高 |
|---|---|---|
| P1-2 | (a) 只靠侧边栏目录，不做清单接口 | 一旦有了清单接口（CLI/工具），它就变成对外契约，后续加字段要兼容 |
| P2-2 | (c) 目录名与 `plugin.json` 的 `name` 不一致 → **拒绝** | 决定归属性真相；宽松处理会让"这个资源属于哪个 plugin"变成推断 |
| P2-3 | `skills/` 下 slug 与目录名不一致 → **拒绝** | 决定物化目标目录名；唯一性前提 |
| P3-2 | (b) `PROMPT.md` 设大小上限（建议 ≤8KB），超限要求拆分进 skill | 影响每轮上下文成本；上限是**对包作者的对外契约** |
| P3-4 | (a) 片段内容做 XML 标签转义（照 `system.ts:403` `defangBlockTag`） | **安全**：不转义则片段可注入伪造的 `<sources>` 等块，影响模型行为 |
| P5-1 | (a) 覆盖用**目录级替换**（先删后建） | 决定旧版本删除的文件是否被清理；逐文件覆盖会留残留 |
| P5-3 | (a) 安装原子化，复用 `resource-bundle.ts:726-737` 的临时目录 + 失败清理 | **数据安全**：中途失败会留半个插件 |
| P5-6 | (a) 安装沿用现有 `safeMode` 管线（Explore 下不可安装） | **安全面**：决定低权限模式能否引入可执行内容 |

### R2 中风险（18 项，已全部关闭）

| ID | 推荐 |
|---|---|
| P1-3 | (a) 只能卸载，不做"禁用"（source 侧 `enabled` 先例会引入"物化但不生效"的中间态） |
| P1-4 | 照 Agent Plugins spec §5.5：1–64 字符、`a-z0-9-.`、首尾字母数字、禁 `--`/`..` |
| P1-5 | (a) 只有会话驻留，不给一次性语法（D8 已定） |
| P2-4 | (a) 加回归测试锁死"`plugins/` 不被 skill / source 加载路径扫到"（两条路径各一条） |
| P2-5 | (a) 安装后主动 `invalidateSkillsCache()`（`skills/storage.ts:201` 已存在），否则最多 5 分钟才可见 |
| P2-6 | (a) `plugins/` 纳入 `config/watcher.ts`，与 sources/skills 一致（`watcher.ts:233-234`） |
| P3-1 | (a) `PROMPT.md` 可选 |
| P3-5 | 块标签用 `<plugin_context name="...">` |
| P4-4 | (a) badge 上取消激活（与 `ActiveOptionBadges` 一致） |
| P4-5 | 驻留状态存 session 字段（照 `enabledSourceSlugs`，`sessions/storage.ts:223,550,570`） |
| P4-6 | (a) 输入引用了已卸载的 plugin 名 → 静默跳过 + 提示 |
| P4-7 | (a) `/` 菜单与 `@` 菜单不需要互相提示 |
| P4-8 | (a) 激活时也预启用包内 skill 的 `requiredSources` 所指向的 source（照既有语义） |
| P5-9 | (a) 卸载也原子化；顺序为**先摘索引后删文件**（失败留孤儿但可用，比反过来安全） |
| P6-3 | 扩展声明复用 `CreateSourceInput`（`sources/types.ts:527-536`）的子集，避免第二套 source 描述语言 |
| P6-5 | (a) api source 的凭据由用户装后自己走现有 OAuth/凭据流程（spec §7.2.1 明确禁止包内嵌密钥） |
| P6-6 | (a) 包内 api source 要求提供 `guide.md`（保持"用前必读"一致性，`source-manager.ts:214-220`） |
| P8-2 | (a) `config_validate` 的 `target` 枚举加 `'plugins'`（`tool-defs.ts:105-109`） |

### R3 低风险（14 项，已全部关闭）

| ID | 推荐 |
|---|---|
| P2-10 | (a) `ResourceBundle` 导出不携带 plugin 来源（`exportResources()` 本就不认 plugin） |
| P3-3 | (a) 多片段按激活顺序拼接，冲突不检测 |
| P3-6 | (a) 压缩后片段天然重注（形态上就是每轮 volatile，无需特判） |
| P4-2 | (a) 插入的 token 保留为 badge（照 folder 范式，`FreeFormInput.tsx:1510-1515`） |
| P5-2 | (a) 覆盖清单按 **slug 相同即列出**（简单且不漏） |
| P5-7 | (a) 不做"恢复原始文件"（重装即达成同一效果） |
| P6-1 | (a) CLI 能力走 `skill + Bash`，**不新增 `type: 'cli'`**（§6） |
| P6-2 | 扩展声明文件为 `phaneris/sources.json`（目录名见 §3.4） |
| P7-1 | (a) 安装入口放侧边栏 Plugins 段空态（复用 `EntityListEmptyScreen` + `getEditConfig` 范式） |
| P7-2 | (a) **两级导航**，资源点击跳到原生段（三级会让 §7.2"条目唯一权威"退化） |
| P7-3 | provenance badge 用现成 `projectBadge` 位（`SkillsListPanel.tsx:81-85`） |
| P7-5 | 激活中的 plugin 以 badge 持续可见（`ActiveOptionBadges` 同款） |
| P8-3 | (a) 不做"装到全部 workspace"（凭据按 workspace 隔离使共享无法绕过） |
| P8-5 | (a) `docs/plugins.md` 附可复制模板（照 `skills.md` 的示例密度） |

> 分层合计 32 行，与登记册关闭前的 32 项 REC 一一对应（已交叉核对，无遗漏、无重复）。

---

## 附二、已确认事项（登记以求完整，无需再决定）

| 项 | 结论 |
|---|---|
| 物化后即普通 skill / source | D4，用户已确认 |
| 编辑只通过对话 | D5，用户已确认；与 `phaneris-cli.md:3`、`skills.md:5-8` 一致 |
| 不做生命周期，后装覆盖 | D6，用户已确认 |
| 用 `/` 不用 `@` | D7，用户已确认 |
| 会话驻留 | D8，用户已确认；依据：`readFiles` 与 `enabledSourceSlugs` 本已会话级 |
| 最小实体 ≥1 skill 或 ≥1 MCP server | D3，用户已确认 |
| 安装前列一次覆盖清单 | D9，用户已确认 |
| 侧边栏与 skills、sources 同级 | 用户已确认 |
| prompt 片段落 volatile 尾部（不进 system 前缀） | 由缓存约束推导，落点 `pi-agent.ts:2409-2414` |
| 不引入 GROUP / registry / 改名 / Task 类比 | 用户已否决，见设计文档 §2.1 |
| `/` 菜单现有三组：`modes` / `commands`(`compact`) / `Recent Working Directories` | 已核实 `slash-command-menu.tsx:567-607`；plugin 段照 folder 的"插入 badge"范式 |
| `isLocalMcpEnabled()` 默认 **true**（不是 false） | 已核实 `workspaces/storage.ts:478-491` + `config-defaults.json:20-22`；登记册初版写"默认关闭"是错的 |
| workspace 备份是**全量**的，`plugins/` 自动在内 | 已核实 `workspace-backup.ts:67-75` |
| 卸载按引用计数删除物化资源；`_index.json` 派生 | D10，用户已确认 |
| `/plugin` 只给名单、无门禁，skill 由模型主动 `Read` 调用 | P4-3，用户已确认；`Read` 是 `BUILT_IN_TOOLS`（`pre-tool-use.ts:95-114`），无需新机制 |
| stdio 开关复用，但清单展示 command 全文 | P5-5，用户已确认 |
| feature flag 依赖 P1-1 | P5-8，用户已确认 |
| 不加 `phaneris plugin` CLI 域 | P8-1，用户已确认；编辑走 EditPopover + `docs/plugins.md` |
| **R2 全部 18 项 + R3 全部 14 项沿用推荐** | 用户 2026-09-18 批量确认；分层依据见附一，逐项理由见「零之二」 |
| `plugins/` 纳入 watcher，但**不得递归触发包内 skill 变更事件** | P2-6，批准确认时附带的技术注意点 |
| 驻留状态存 session 字段时**必须登记进 `loadConfig` 白名单** | P4-5，该文件有"新持久字段不加 allowlist 即被丢弃"的既有教训 |
| `_index.json` 可删除并在重建后自洽 | D10 的派生性要求；验收见 P9-4 |
| `PROMPT.md` 不设大小上限 | P3-2，用户规则"协议无约定则不自行发明"；已核实两份协议均无约定 |
| 扩展命名空间 = `phaneris`（非反域名） | P2-1，用户已确认；已核实项目不持有域名 |
| `local` 不补 `command`/`args`/`env` | P6-4，用户已确认 |
| 安装器拒绝包内 symlink | D11，由备份约束推导 |
| 会话内只有 1 个激活 plugin，`/B` 静默替换 `/A` | D12，用户已确认；prompt 侧为单槽位（设计文档 §4.5） |
| 导入走对话、无前台 UI 入口，需准确的 `docs/plugins.md` | P1-1，用户已确认 |
| 扩展命名空间目录名 = `phaneris` | P2-1，用户已确认；已核实项目不持有域名 |
| prompt 片段不在轨迹里单独标注 | P3-7，用户已确认 |
| 插件级审计日志：要，极简，复用现有日志设施 | P5-4，用户已确认 |
| 外部导入需 feature flag 且默认关；本地放置不受限 | P5-8，由 P1-1=(b) 推出 |
| 多 workspace 时静默不显示，与 skill/source 一致 | P7-4，用户已确认 |
| `local` source 不产生工具；`api` 产生工具 | 已核实 `server-builder.ts:330-358`、`api-tools.ts:349,433` |
