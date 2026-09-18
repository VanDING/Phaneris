# Plugin bundles：在 Agent Plugins 1.0.0 上聚合 skills、source 与 prompt

- 性质：**proposed**（设计提案，未实施。实施前需按本文末尾的决策清单拍板）
- 日期：2026-09-17
- 关联：[`cross-ecosystem-plugin-porting-assessment.md`](cross-ecosystem-plugin-porting-assessment.md)（探索性研究）、
  [`system-prompt-per-turn-analysis.md`](system-prompt-per-turn-analysis.md)（缓存前缀约束的唯一依据）

---

## 1. 摘要

Phaneris 的 skill、source 各自都是会话驻留的显性调用对象，但**没有"一组能力"这个可调用单位**：
用户想用"投资分析师"能力，必须逐个 `@` 若干 skill 与 source，且这些 skill 的
`requiredSources` 要靠手工维护、容易漂移（缺 source 时静默跳过，见 `skills.md`）。

本提案引入 **plugin bundle**：一个遵循 Agent Plugins 1.0.0 的可移植目录，安装后
**把 skills 与 MCP servers 物化进 workspace 的原生 tier**，并保有自己的身份文件与 prompt 片段。
调用入口是 **`/plugin-name`**（不是 `@`），**会话级驻留**，对齐 skill 与 source 的既有语义。

**定位一句话**：plugin 不是新的运行时能力类型，是**一个能力包 + 它自己的那部分**。

---

## 2. 核心决策（已定）

| # | 决策 | 依据 |
|---|---|---|
| D1 | **workspace 所有**，存于 `<workspaceRoot>/plugins/<name>/` | 与 source 的凭据作用域一致；跨 workspace 需各自安装 |
| D2 | **来源只能外部**，但**包括用户自己写的** | plugin 的价值是可移植格式，不是分发渠道 |
| D3 | **最小实体**：≥1 skill 或 ≥1 MCP server | 只有 `plugin.json` 的包在功能上等于不存在 |
| D4 | **物化**：skills → `<ws>/skills/`，MCP servers → `<ws>/sources/` | 物化即普通资源，零加载路径改动 |
| D5 | **编辑只通过对话**（文档式），与 skills/sources 完全一致 | `phaneris-cli.md:3`、`skills.md:5-8` 既有模型 |
| D6 | **不做生命周期**：后安装覆盖现有 | 与"文件即真相 + 覆盖"的既有模型一致。**唯一例外是 D10 的反向索引** |
| D7 | **用 `/` 不用 `@`** | `/` 已是配置/控制通道；天然正确且无需区分"组 vs 个体" |
| D8 | **`/plugin` 会话驻留** | skill 的 `readFiles` 与 source 的 `enabledSourceSlugs` 本已会话级 |
| D9 | **安装前列出覆盖清单确认一次** | skill slug 冲突今天是静默覆盖，需给用户一次知情机会。**清单必须展示 stdio server 的 command 全文**（D11） |
| D10 | **反向引用计数 + 派生索引** `<ws>/plugins/_index.json` | 同一资源可被多个 plugin 引用；卸载只删计数归零者，否则留孤儿或误删共享项 |
| D11 | **安装器拒绝包内符号链接** | workspace 备份遇 symlink 直接 `throw`（`workspace-backup.ts:67-75,93-105`），含 symlink 的 plugin 会让**整个 workspace 备份失败** |
| D12 | **会话内同时只有 1 个激活的 plugin**；`/B` **静默替换** `/A` | plugin 已经是"合集"，不需要"合集的合集"。单槽位让 prompt 组装退化为一个字符串变量，用户侧表现为随时可切换 |

> **注（D6 与 D10 的关系）**：D10 是 D6 的唯一例外，且**不是**最初被否决的 `_registry.json`。
> 区别：索引**只记录"每个已物化资源被哪些 plugin 引用"**，**不含**版本、安装时间、
> 内容 hash、drift 状态；它是**派生**的（§3.2），因此不构成第二个真相来源，也不构成生命周期管理。

### 2.1 明确不做的事

| 不做 | 原因 |
|---|---|
| 引入 GROUP / bundle 一等资源类型 | 用户要编辑时对话改文件即可，无需第二个概念 |
| `_registry.json`、安装态、hash 追踪 | 无消费者。系统从未对 skill/source 承诺"你的修改会被尊重"。**注意与 D10 的派生索引区分**：那是引用计数，不是安装态 |
| 确定性改名 / renameMap / 包内自引用重写 | D6 之下无必要 |
| 用 Task 类比定位 plugin | Task 是"要做的一件事"，plugin 是"一组能力"，两码事 |
| 新增 `SourceType` 变体 | 见 §6，CLI 能力走 skill，不碰枚举 |
| `phaneris plugin` CLI 命令域（P0） | AI 直接写 `plugin.json` / `PROMPT.md` 不与现有守卫冲突（守卫拦的是 `labels/` 读、source config、skill instructions、automations）。编辑走 ① `EditPopover` 条目 + ③ `docs/plugins.md`。文件需要守卫时再加 |

---

## 3. 包结构

```
<workspaceRoot>/plugins/<name>/
├── plugin.json              # Agent Plugins 1.0.0 manifest（必需，$schema + name）
├── skills/<slug>/SKILL.md   # ──安装时物化──▶ <ws>/skills/<slug>/      成为普通 skill
├── mcp.json                 # ──安装时物化──▶ <ws>/sources/<slug>/     成为普通 source
├── PROMPT.md                # 留在原地；/name 激活后每轮注入 volatile 尾部
└── phaneris/                # 扩展命名空间（见 §3.4），承载 api / local source 声明
```

### 3.1 什么物化，什么留下

| 包内内容 | 去向 | 理由 |
|---|---|---|
| `skills/` | → `<ws>/skills/` | 原生 tier 能完整表达 |
| `mcp.json` 的 servers | → `<ws>/sources/` | 原生 tier 能完整表达，凭据/策略/构建全复用 |
| `plugin.json` | 留在 plugin 目录 | 身份，无原生归属 |
| `PROMPT.md` | 留在 plugin 目录 | **唯一没有原生归属的运行时产物** |
| `phaneris/` | 留在 plugin 目录 | 扩展声明（api/local source），见 §3.4 |

**关键判断**：plugin 目录不是"资源的容器"，而是**这个能力包剩下的部分**。
skills 与 sources 物化后就不再是"plugin 的"；它们**因 plugin 而被安装**这件事，
由 plugin 目录本身的存在记录，不需要额外 registry。

### 3.2 归属：派生索引，不是清单（D10）

`/name` 展开时**从目录内容与 `plugin.json` 推导**归属，不额外维护清单：

- skills = `skills/` 的直接子目录
- sources = `mcp.json` 的 `mcpServers` key + `phaneris/sources.json` 的条目

理由：显式清单会与目录内容漂移，而目录内容才是物化的真相。

**反向索引**（`<ws>/plugins/_index.json`）同样是**纯派生**的，用于卸载时判断
"这个资源还有没有别的 plugin 在用"：

```jsonc
{
  "version": 1,
  "resources": {
    "skills":  { "financial-modeling": ["investment-analyst", "equity-research"] },
    "sources": { "sec-edgar":          ["investment-analyst"] }
  }
}
```

- **生成时机**：安装 / 卸载 / 启动时重建（扫描全部 `plugins/*/plugin.json` 重算）
- **不存**：版本、安装时间、内容 hash、drift 状态——那些属于被否决的 `_registry.json`
- **可安全删除**：删掉后在下次重建时自动恢复，因此它不是第二个真相来源
- **只服务于一个判断**：卸载时 `count === 1` → 删除该资源；`count > 1` → 只摘掉自己这一票

> **为什么是"引用计数"而不是"自带 vs 引用"的区分**：物化后 slug 在 workspace 内唯一，
> 两个 plugin 不可能各自物化出一个同名 skill。因此跨 plugin 共享**几乎必然**发生在一方
> 引用、另一方自带的场景。计数天然覆盖两种情况，不需要额外判断关系类型。

### 3.3 目录解析注意

`<ws>/plugins/<name>/` 是 workspace 里**第一个嵌套资源目录**（`skills/{slug}/` 是平铺的）。
`loadAllSkills` 与 source 加载**不得扫进 `plugins/` 内部**——它是包，不是 tier。

---

### 3.4 扩展命名空间为什么存在，以及用哪个名字

**为什么需要它**：Agent Plugins 1.0.0 的 portable core **只有两种组件**——skills 与
MCP servers（spec §7）。Phaneris 的 `api` 与 `local` source **在 spec 里没有可移植的声明位置**。
spec §8 给的唯一合法出口是「客户端扩展命名空间」：一个**客户端拥有的反域名**，
既作为 `plugin.json` 的 `extensions` key，也作为顶层目录名。

**没有它就只能支持 skills + MCP**，而 Phaneris 有三类 source。这是它存在的全部理由。

**用哪个名字**：已核实项目**不持有任何域名**——
`phaneris.identity.json` 的 `services` 段（`docsUrl` / `viewerUrl` / `updateFeedUrl` /
`oauthRelayUrl` / `pagesShareApiUrl` / `supportUrl`）**全部为 `null`**；
唯一的反域名式标识是 `appId: io.github.vanding.phaneris`（基于 GitHub 路径而非自有域名）。

| 选项 | 评价 |
|---|---|
| **`phaneris`（已定，P2-1）** | 用户手写自己的 plugin 时一眼看懂；与 `AGENTS_PLUGIN_NAME` 等既有命名风格一致。**偏离 spec 的字面要求**（spec 说 SHOULD 用反域名），但 spec 对客户端扩展内容不赋任何可移植语义，实际互操作损失为零 |
| `io.github.vanding.phaneris` | 严格贴合 spec，且与 `appId` 一致。代价是目录名冗长、对自写 plugin 的用户不直观 |
| `io.phaneris` | 会**声称一个不存在的域名**，不如上两者诚实 |

**结论**：目录名与 `extensions` key 用 **`phaneris`**。这是本项目自有的客户端扩展，
边界清晰，不需要假装持有域名。若日后有对外分发与第二客户端互操作需求，再评估迁移。

## 4. 调用：`/plugin-name`

### 4.1 为什么 `/` 而不是 `@`

1. `/` 已经是"配置/控制"通道（模式切换、文件夹选择），plugin 是同一类概念；`@` 是"引用一个具体资源"
2. 不需要在 `@` 菜单里区分"组 vs 个体"
3. 作用域语义现成

### 4.2 会话驻留的实现形态

**复制权限模式的形态**：会话状态 + 每轮重新落到 volatile 尾部。

`session_state`（含权限模式）今天就是这样（`prompt-builder.ts:121-125`）——它会话稳定，
但**走 volatile 尾部而非 system 前缀**，因为 system 前缀要保住跨会话公共前缀
（`system-prompt-per-turn-analysis.md` §7.1）。

激活后每轮组装：

```
volatileParts = [ dateTime, sessionState, sourceState, pluginPromptFragments ]
userMessage   = [...volatileParts, ...attachmentParts, message].join('\n\n')
```

落点：`packages/shared/src/agent/pi-agent.ts:2409-2414`。**system 前缀零改动。**

### 4.3 与 `@skill` / `@source` 的关系

| 入口 | 解决的问题 | 状态 |
|---|---|---|
| `/投资分析师` | "我知道该用哪个领域，不知道里面有哪个 skill" | 会话驻留 |
| `@financial-modeling` | "我确切知道要这一个" | 消息级指令 + 会话级读取状态 |

两者不冗余，**并存**。`/name` 展开后**复用现有机制**，不新增运行时路径：

- 列出（或全部）sources → 走 `enabledSourceSlugs` 预启用路径（`SessionManager.ts:6814-6870`，
  **在构建 agent 之前**，因此无 `forceAbort` 重启代价；对比 `source_test` 的运行时激活
  会触发 `SourceActivated` 中止整轮，`pi-agent.ts:2443-2454`）
- 列出 skills → **只注入名单，不强制读**（§4.3.1）
- `PROMPT.md` → 上述 volatile 块

#### 4.3.1 渐进式披露：只给名单，skill 由模型主动调用（P4-3）

`/plugin` 激活注入的是**名单**（name + description + 绝对路径），**不是 SKILL.md 全文**：

```
<plugin_context name="投资分析师">
可用技能（按需读取，不要预先全部读取）：
- financial-modeling: 三表建模与估值 — 读 <ws>/skills/financial-modeling/SKILL.md
- equity-research: 个股研究框架 — 读 <ws>/skills/equity-research/SKILL.md
</plugin_context>
```

**与 `@skill` 的关键语义差别**：

| | `@skill`（现有） | `/plugin`（本设计） |
|---|---|---|
| 注入内容 | 不注入内容，只注入 SKILL.md **路径** | name + description + **路径** |
| 读取门禁 | `registerSkillPrerequisites()` —— **不读就封锁工具** | **无门禁**，模型自行决定 |

**"能主动调用 plugin 内的 skill"的落点**：`Read` 是 SDK 内置工具
（`pre-tool-use.ts:95-114` 的 `BUILT_IN_TOOLS`），在会话中始终可用。
模型"调用 skill"= `Read` 该 SKILL.md 并遵循其内容，**无需新工具、无需新机制**。

因此该能力的成立条件是**路径必须出现在名单里**（用绝对路径，避免模型猜）。
名单里的 description 取自 `SKILL.md` frontmatter 的 `description` 字段，
与 `@` 菜单展示的是同一份数据。

> **刻意不做**：不注册 `PrerequisiteManager` 门禁。理由：激活一个含 N 个 skill 的组时
> 强制先读 N 份 SKILL.md 过重，与"减少 prompt 干扰"的取向冲突。渐进式披露的本意
> 就是让模型在需要细节时才加载。

#### 4.3.2 与 Agent Skills 渐进式披露的一致性

Agent Skills 规范自己就规定了三级加载，**本设计的注入内容与它逐级对应**：

| Agent Skills 规范 | 何时加载 | 本设计对应 |
|---|---|---|
| ① 元数据（`name` + `description`，~100 tokens） | **启动时，全部 skill** | ← **正是 `/plugin` 注入的名单** |
| ② 指令（`SKILL.md` 正文，建议 <5000 tokens） | **skill 被激活时** | ← 模型主动 `Read` 时 |
| ③ 资源（`scripts/` / `references/` / `assets/`） | 按需 | ← 照旧按需 |

**结论：`/plugin` 的名单注入不是新发明，它就是规范里"① 元数据"那一层。**
规范推荐正文 <5000 tokens / <500 行，并把"拆分长内容到 `references/`"作为最佳实践——
所以 P3-2 不设 `PROMPT.md` 上限是安全的：**长内容应进 skill 正文，而 skill 正文有规范自己的引导**。

### 4.4 UI 落点

`packages/ui` 的 slash 菜单已具备所需基础：`SlashItemType` 支持
`'command' | 'folder'`（`slash-command-menu.tsx:16`），`SlashSection` 支持分组（`:38`）。

plugin 是**第三类 item**：插入一个作用域 token，与 `folder` 同类
（`FreeFormInput.tsx:1510-1515` 的 `handleInlineSlashFolderSelect` 是参考实现）。

同时需要一个**驻留 badge**（`ActiveOptionBadges` 同款）以体现"正在生效"，并允许取消。
因 D12，**badge 恒为至多一个**，不需要多选 UI。

### 4.5 单槽位与静默替换（D12）

**prompt 组装侧：确实是单槽位，很简单。**

session 只存一个 `activePlugin: string | null`（不是数组）。`/B` 针对 `/A` 的替换
就是把该字段覆写——没有列表、没有累积、没有"取消其中一个"的交互。
每轮的 volatile 块恒为至多一个 `<plugin_context>`。

这就是单槽位的核心价值：**prompt 侧的成本模型是常数，不随使用历史增长。**

**资源侧的尖锐约束（必须在实施时处理）**：

> **不能在会话进行中删除被替换 plugin 的资源。**

原因链：
1. `readFiles` 是会话级的（`prerequisite-manager.ts:122`），模型**已经读过** A 的 SKILL.md
2. 但那部分内容仍在上下文里，后续轮次可能引用
3. 若切到 B 时立即删除 A 的 `<ws>/skills/`，后续轮次一旦需要重读就是**文件不存在**

**建议的处理顺序**：

| 时机 | 动作 |
|---|---|
| 收到 `/B` | 只覆写 `activePlugin` = B；A 的资源**原地不动** |
| 会话结束 / `clearHistory()` | 对 A 执行既有的卸载流程（D10 引用计数） |
| 或者：下次安装同名/同 slug 资源时 | 由 D6 的覆盖自然接管 |

**实现限制**：若 A、B 携带同名 skill slug，B 的安装（覆盖）会立刻替换该目录，
这属于 D6 的已知后果（`loadAllSkills` 本就是静默覆盖），不需要额外处理。

**权衡记录**：这意味着"切换 plugin 后磁盘上可能短暂同时存在两套资源"。
接受它的理由——**正确性优先于整洁**，且窗口有界（到会话结束）。
这与 §5.2「不做生命周期」一致：我们本来就不承诺资源与 plugin 的同步存在。

---

## 5. 安装

### 5.1 流程

1. 读 `plugin.json`，校验（§5.3）
2. 计算覆盖清单：将与现有 skill/source 同 slug 的项列出
3. **用户确认一次**（D9）
4. 物化 `skills/` → `<ws>/skills/<slug>/`（逐项替换）
5. 物化 `mcp.json` servers → `<ws>/sources/<slug>/`（复用 `createSource` / `saveSourceConfig`）
6. 物化 `phaneris/sources.json` 声明的 api/local source
7. 写入（或刷新）`<ws>/plugins/<name>/`

**优先复用**：`shared/src/resources/resource-bundle.ts` 的
`importResources()`（`:747-780`，含临时目录暂存与冲突模式）已实现"把 bundle 文件落到原生目录"，
不必新造安装器。

### 5.1.1 导入：AI 驱动，无 UI 入口（P1-1）

来源可以是**本地目录**（用户自己写或拷贝进来）或**外部包**（zip / URL）。
**不提供前台导入 UI**——与系统其它配置一致，由对话驱动：

```
用户：「从这个 zip / 这个 URL 装一下」
AI  ：读 docs/plugins.md → 取包 → 校验 → 算覆盖清单 → 向用户确认 → 物化
```

**这是纯文档工作**：`docs/plugins.md` 必须准确描述取包、校验、确认、物化四个步骤
（与 `sources.md` 的"对话式 setup 流程"同款写法）。

**新增的失败面（仅外部来源）**：

| 风险 | 处理 |
|---|---|
| zip slip（`../` 逃逸） | 解压时逐条校验目标路径落在包根内（spec §4.1 的 containment 要求） |
| 包体过大 | 解压前检查 Content-Length / 解压后检查总字节数并设上限 |
| 远程来源不可信 | `plugin.json` 校验失败即拒绝；stdio command 必须在确认清单里全文展示（D9） |
| 归档格式 | **仅 tar / tar.gz**（P1-8 已定）。仓库根已有 `tar`（`package.json` devDependencies），**零新依赖**；`preservePaths` 默认关闭即拒绝绝对路径与 `..`。**但仍须自行做一遍路径逃逸校验** |

**feature flag**：外部导入会获取第三方内容，按本仓库惯例（`pagesSharing`、`sessionSharing`
默认关）需要 flag 且默认关；**本地目录放置不受 flag 限制**（P5-8）。

### 5.2 冲突处理（D6）

**不解决冲突：后安装覆盖现有。** 覆盖清单 = `plugin.json` + skills 目录 + sources 目录。

> **已知后果（需接受）**：skill slug 冲突**今天就是静默覆盖**
> （`loadAllSkills` 后写盖先写，`skills/storage.ts:224-242`）。
> 若 plugin 携带与用户自有 skill 同 slug 的资源，用户版本会被替换。
> D9 的确认清单是唯一保护，不做更多。

### 5.3 `plugin.json` 校验（照 spec 的失败边界）

| 情况 | 处理 |
|---|---|
| 缺 `plugin.json` / 缺 `$schema` / 缺 `name` | 拒绝安装 |
| 未知顶层字段 | **报告并忽略**，继续（spec §5.2 强制） |
| 路径逃出 plugin root | 拒绝该项（spec §4.1 分级失败边界） |
| 单个 MCP server entry 非法 | 跳过该条，继续其余（spec §7.2.2） |
| `skills/` 下某项非法 | 跳过该 skill，继续其余（spec §7.1） |

### 5.4 stdio server 的 `cwd` 与占位符解析

#### 5.4.1 `cwd`：显式拒绝，不实现

**决定：不支持 `cwd`。** `mcp.json` 中任何非 `${PLUGIN_ROOT}` 起的 `cwd` ⇒ 该 server 条目无效（照 spec §7.2.2 **跳过该条、继续其余**，并报告）。

必须写清这个决定的**背景**，否则实施时会误以为要顺手修：

| 事实 | 位置 |
|---|---|
| `McpSourceConfigSchema` 没有 `cwd` 字段 | `config/validators.ts:389-402` |
| Agent 侧 stdio 类型也没有 | `sources/server-builder.ts:37` |
| Phaneris 构造 transport 时也不传 | `mcp/client.ts:109-113` |
| **SDK 支持 `cwd`** | `StdioServerParameters.cwd?: string` |
| **spec 要求 `cwd` 的默认值是插件根** | Agent Plugins §7.2.1 |

也就是说：**"让任意 stdio source 都能设 `cwd`"是一个与本设计无关的既有能力缺口，本次不做。**
（它是独立缺陷，需要时另行处理。）

**为什么不做的理由不是"scope"，而是方向性的**：

> 不传 `cwd` 时，子进程从**插件根**运行（我们会在启动时如此设定），
> server 的相对路径视图被锚定在插件根内——**这恰好是最强的 containment 姿态**。
> 而支持 `cwd` 允许 server 以 `data/` 或包内任意目录为工作目录运行，
> **相对路径视图会移出插件根，containment 反而更松。**

**为什么是"拒绝"而不是"静默忽略"**：静默忽略会让包作者以为生效了，跑起来却在意外目录——正是要避免的静默失败。

**残留限制（写入 `docs/plugins.md`）**：server 自身使用的相对路径，均相对**插件根**解析。

#### 5.4.2 占位符与展开范围

| 字段 | 是否展开 `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` |
|---|---|
| `command` | **是** |
| `args` | **是**（spec §7.2.1 明确要求） |
| `env` | **是**（同上） |
| `cwd` | 不适用（§5.4.1 已拒绝） |

`command` 是**单个 token**（spec：MUST contain a single executable token, not a shell command string），因此不存在参数切分问题。

`${PLUGIN_DATA}` 定义为 **`<ws>/plugins/<name>/data`** —— 纯字符串展开，**不需要 `cwd` 即可工作**。
用法是显式传参：`args: ["--data", "${PLUGIN_DATA}"]`。

#### 5.4.3 展开时机：运行时

| | (a) 安装时展开为绝对路径写死 | **(b) 保留占位符，运行时展开** ✅ |
|---|---|---|
| 可移植性 | ❌ **移动 workspace 即全失效**（Phaneris 是用户可下载的桌面应用，放外置盘/换机器是现实场景） | ✅ 包与 workspace 都可移动 |
| 一致性 | 低 | **高**：`sources/storage.ts:77,136` 已在加载时展开 `~`，同一先例 |

#### 5.4.4 `pluginRoot` 记在 source 的 `config.json` 上

```jsonc
{
  "slug": "deploy-api", "type": "mcp", "provider": "my-plugin",
  "mcp": {
    "transport": "stdio",
    "command": "${PLUGIN_ROOT}/bin/server",   // 存储保留占位符，不写死绝对路径
    "args": ["--data", "${PLUGIN_DATA}"],
    "env": { "CONFIG": "${PLUGIN_ROOT}/config.json" }
  },
  "pluginRoot": "plugins/my-plugin"           // ← 新增：workspace 相对路径
}
```

三点：

1. **`pluginRoot` 是 workspace 相对路径** ⇒ 整个 workspace 可整体搬移
2. **完全向后兼容** ⇒ 没有 `pluginRoot` 的普通 source 行为不变（占位符不出现则解析为 no-op），是纯增量可选字段
3. **附带收益** ⇒ source 自描述 provenance，UI 可直接显示"来自 my-plugin"。
   （D10 的 `_index.json` 仍需要——它服务**跨 plugin 引用计数**，与单条 source 的来源标注是两件事）

#### 5.4.5 解析规则：单点实现

在 `buildMcpServer()`（`sources/server-builder.ts:86`）内、构造 stdio config 之前展开一次。
**只有这一处需要知道占位符存在**；`client.ts` / `mcp-pool.ts` / transport 都拿到已解析的值。

| 占位符 | 解析为 | source 无 `pluginRoot` 时 |
|---|---|---|
| `${PLUGIN_ROOT}` | 插件根绝对路径 | **不解析**，原样保留并记 debug |
| `${PLUGIN_DATA}` | 插件根绝对路径 + `/data` | 同上 |

**展开后必须做 containment 校验**：结果必须落在插件根内，否则该 source 无效（spec §4.1 分级失败边界：**只废这一条，不废整个插件**）。

#### 5.4.6 `command` 的规范化

| 输入形式 | 处理 |
|---|---|
| `./bin/server`（插件相对） | **规范化**为插件根下绝对路径 |
| `${PLUGIN_ROOT}/bin/server` | 展开后即绝对路径 |
| 绝对路径（落在插件根内） | 接受 |
| 裸名（`node` / `npx`） | **拒绝** —— spec 明确"声明合规的插件不得依赖 PATH 行为"；且 `isCommandAvailable`（`mcp/validation.ts:317-318`）对含分隔符的路径用 `existsSync`，相对路径会相对飘忽的 `process.cwd()` 判断 |
| `../bin/server` | **拒绝**（逃出插件根） |

#### 5.4.7 `${PLUGIN_DATA}` 的归属

= **`<ws>/plugins/<name>/data/`**，由 server 首次运行时按需创建。

- **属于包目录，不物化** —— D4 的"物化 skills 与 MCP servers"不含它
- ⚠️ **是 P5-1「目录级替换」的唯一例外**：插件升级**必须显式排除 `data/`**，否则是静默数据丢失
- 随 workspace 备份（P2-8 全量备份自动包含）
- ⚠️ **D11 的 symlink 检查覆盖它**：server 若在 `data/` 里造 symlink，会让**下次 workspace 备份失败** —— 这是插件作者须知，要写进 `docs/plugins.md`

#### 5.4.8 已知限制与残留风险

| 项 | 说明 | 处置 |
|---|---|---|
| server 相对路径以插件根为基准 | §5.4.1 的直接后果 | 写入 `docs/plugins.md` |
| 升级后 `pluginRoot` 变化（如改包名） | 旧 source 指向不存在的目录 | 安装时按 slug 覆盖 source config，`pluginRoot` 随之刷新；残留旧 source 由卸载流程清理 |
| 用户手工移动 `plugins/<name>/` | 占位符仍可解析（按 `pluginRoot`），但 `plugin.json` 的 `name` 与目录名不一致 → 下次校验拒绝 | 属预期（P2-2） |
| `data/` 无增长上限 | 与 source `guide.md` 缓存同类 | 不限制；后续统一治理 |

---

## 6. 非 MCP source：API / Local / CLI

Agent Plugins 1.0.0 的 portable core **只有 skills 与 MCP servers**（spec §7）。
api / local 走 `phaneris/sources.json` 扩展命名空间（spec §8，见 §3.4）。

### 6.1 CLI 能力不进 SourceType

**Phaneris 的 source 定位保持三种**：`'mcp' | 'api' | 'local'`
（`shared/src/sources/types.ts:16`；`packages/shared/CLAUDE.md` 亦列为固定规则）。
CLI 能力走 `skill + Bash`（§6.2），**不新增第四种类型**（P6-1 已定）。

`type: 'cli'` 的代价远超收益：

- `SourceType` 联合类型**重复定义两次**（`shared/sources/types.ts:16`、
  `session-tools-core/src/types.ts:291`）+ zod `z.enum`（`shared/src/config/validators.ts:384`）
- UI 层另有 **6 处硬编码枚举**：`shared/types.ts:963`、`routes.ts:128,135`、
  `route-parser.ts:199,201`、`LeftSidebar.tsx:45`、`SidebarMenu.tsx:60`、
  `source-avatar.tsx:25`、`AppShell.tsx:1578`
- **三个独立 route 校验**都只认 `['api','mcp','local']`（`route-parser.ts:199`）
- 工具定义位于缓存前缀最顶层（`agent-session.js:763` 的 `selectedTools`），
  一个 server 的工具面膨胀会波及全量缓存

### 6.2 CLI 的正确形态：skill + Bash

CLI 工具**本来就是一个可执行文件**，agent 用 Bash 调用它即可。这与本会话里
`agently-mail`、`wecom-unified`、`aihot` 等现有 skill 的形态完全一致——它们都是
"CLI 操作指南"型 skill，**零工具面膨胀、零缓存代价**。

因此：plugin 内的 CLI 能力 = 一个 `skills/cli-xxx/SKILL.md`（含命令清单与用法），
**不需要新 source 类型**。仅当 CLI 需要托管凭据时才作为 api/local source 处理。

> 若未来确有需要，可行路径是把 CLI 的 `command`/`args`/`env` 纳入 `LocalSourceConfig`
> 的扩展，而非新增枚举变体。**本提案不做。**

### 6.3 `local` 与 `api` 的既有状态（供实施参考）

- `type: 'local'` 目前是**书签语义**：`SourceServerBuilder.buildServers()`
  （`sources/server-builder.ts:330-358`）只构建 `mcp` 与 `api`，**不构建 local**，
  即 local source 不产生任何工具
- `type: 'api'` 已能产生工具：`createApiTool()` → `createApiServer()`
  （`sources/api-tools.ts:349,433`）

---

## 7. 侧边栏

与 skills、sources **同级**（`route-parser.ts:41` 的 `NavigatorType` 已含
`sessions | sources | skills | automations | projects | pages | settings`）。

### 7.1 需要同步的四份枚举（易漏）

1. `apps/electron/src/shared/route-parser.ts:41` `NavigatorType` 加 `'plugins'`
2. 同文件 `:71` 「非详情段」白名单加 `'plugins'`
3. `apps/electron/src/renderer/lib/navigation-registry.ts:77` `NavigatorType`
   （**这是独立枚举，与 route-parser 那份不一致**）加 `'plugins'`
4. `apps/electron/src/renderer/components/app-shell/SidebarMenu.tsx:32` `SidebarMenuType` 加 `'plugins'`
5. `AppShell.tsx:3617-3639` 加 `isPluginsNavigation` 分支

外加 i18n 三件套（`lint:i18n:sorted` / `parity` / `coverage` 是 pre-commit 门禁，新 key 须全 locale 补齐）。

### 7.2 条目唯一权威（避免重复列出）

物化后 plugin 的 skill 是**真实存在的 workspace skill**，会同时出现在 Skills 段。

**规则**：条目唯一权威在原生段；plugin 段是聚合与跳转。

- Skills / Sources 列表项加 provenance badge，位置用现成的 `projectBadge` 位
  （`SkillsListPanel.tsx:81-85`）
- Plugin 详情页按组列出其 skills/sources，**每项是跳转链接**，不是可操作副本

### 7.3 共用基础设施（无需新建）

- 图标：`SkillAvatar` / `SourceAvatar` + `getSkillIconSync` / `getSourceIconSync` 已有 icon 缓存
- provenance 数据：`skillsRPC.GET`（`server-core/src/handlers/rpc/skills.ts:18-34`）
  已返回含 `source` 与 `path` 的 `LoadedSkill[]`
- 文件监听：`config/watcher.ts:233-234` 监听 sources/skills 目录；
  `plugins/` 目录需在同一处加 watch，否则装完插件 UI 不刷新

---

## 8. 需要新增的东西（清点）

| 新增 | 位置 | 规模 |
|---|---|---|
| `plugin.json` 读取 + 校验 | `packages/shared/src/plugins/`（新增） | 小 |
| 安装器物化 | 复用 `resource-bundle.ts` 落盘 + `createSource` | 小 |
| `/` 菜单第三类 item + section | `slash-command-menu.tsx` + `FreeFormInput.tsx` | 小-中 |
| 会话级激活状态 + 驻留 badge | `SessionManager` + `ActiveOptionBadges` 同款 | 中 |
| `PROMPT.md` 注入 volatile 尾部 | `pi-agent.ts:2409` 一处 | 小 |
| 侧边栏 Plugins 段 | §7.1 的五处 + 新 Panel | 中 |
| agent 文档 `docs/plugins.md` | `apps/electron/resources/docs/`（自动同步 `~/.phaneris/docs/`） | 小 |
| `phaneris/sources.json` 声明格式 | 新增 | 中（非 MCP source 的唯一入口；目录名见 §3.4） |
| `plugins/` 目录监听 | `config/watcher.ts` | 小 |
| 占位符展开 + `command` 规范化 | `sources/server-builder.ts:86`（单点） | 小 |
| **agent 文档 `docs/plugins.md`** | `apps/electron/resources/docs/`（自动同步 `~/.phaneris/docs/`） | **中——是功能的实现载体，见 §11.2** |
| **`DOC_REFS.plugins` 常量** | `shared/src/docs/index.ts:101-125` | 小 |
| **系统 prompt 的 plugin 引用** | `shared/src/prompts/system.ts`（文档表 + Sources/Skills 段） | 小 |
| **UI 文档页 + 两处注册** | `guide/en/plugins/overview.md`；`manifest.ts`；`doc-links.ts` | 小-中（三处须一致，两条测试门禁） |
| **`EditPopover('add-plugin')` 条目** | `EditPopover.tsx` | 小 |
| **`release-notes/next.md` 条目** | `resources/release-notes/` | 小 |

---

## 9. 实现构成与验收测试

**这是一份完整方案，不分版本、不设阶段门。** 下表是实现的**构成清单**（按模块内聚划分），
全部属于同一次交付；它只表达依赖关系，不表达"先做哪个版本"。

**决策侧已全部关闭**：登记册 61 项决策全部定案（`plugin-bundles-decisions.md`）。
下列 4 条 P9 是**验收测试**，不是前置阶段——它们离开代码无法验证，**随对应模块的代码一起写**。

| 模块 | 内容 | 验收测试 |
|---|---|---|
| **A. 装载与目录约定** | `plugin.json` 读取与校验（§5.3）；`plugins/` 目录约定；加载路径隔离；watcher 与缓存失效 | **P9-1**：`plugins/` 内容不被 skill / source 加载路径扫到 |
| **B. 安装与导入** | 物化（目录级替换但**排除 `data/`**）；覆盖清单确认（D9）；tar(.gz) 导入（§5.1.1）；symlink 拒绝（D11）；审计日志一行（P5-4）；占位符展开与 `command` 规范化（§5.4） | 安装原子性（失败回滚）；symlink 包被拒；`data/` 在升级后保留；`cwd` 非 `${PLUGIN_ROOT}` 时该 server 条目被跳过 |
| **C. `/plugin` 激活链路** | `/` 菜单第三类 item；会话单槽位状态（D12）；名单注入；source 预启用；静默替换 | **P9-3**：不触发 `SourceActivated` 重启 |
| **D. prompt 片段** | `PROMPT.md` 解析；外科式转义；注入 volatile 尾部（§4.2） | **P9-2**：`fullSystemPrompt` 字节稳定 + 片段仅在 volatile |
| **E. 卸载与引用计数** | `_index.json` 派生；D10 计数删除；先摘索引后删（P5-9）；原子化 | **P9-4**：无孤儿（独占删 / 共享留 / 索引可重建） |
| **F. 侧边栏与配置** | Plugins 段（四份枚举，§7.1）；provenance badge；`EditPopover('add-plugin')`；`config_validate` 加 `target` | 路由可达；空态入口可用 |
| **G. 文档** | 见 §11（agent 必读文档 + 四处接线 + UI 文档页） | 三个文档门禁通过；AI 能仅凭文档完成一次装配 |

**模块间的唯一硬依赖**：A 的 P9-1 必须先于 B–E 交付（否则后续模块建在"`plugins/` 不会被误扫"这一未验证假设上）。其余模块可并行。

---

## 10. 证据索引

| 事实 | 证据 |
|---|---|
| skill 的读取状态是会话级，压缩后才重置 | `prerequisite-manager.ts:122,265-272`；`base-agent.ts:543,553` |
| source 启用写入 session 并持久化 | `FreeFormInput.tsx:1277-1284`；`sessions/storage.ts:223,550,570` |
| 预启用发生在 agent 构建之前（无重启代价） | `SessionManager.ts:6814-6870`，对比 `pi-agent.ts:2443-2454` |
| 容器把 skills 转成 `[skill:slug]` 的既有实现 | `TaskRunner.ts:943-952` |
| volatile 尾部落点 | `pi-agent.ts:2398-2414`；`prompt-builder.ts:105-159` |
| system 前缀必须稳定（跨会话公共前缀） | `system-prompt-per-turn-analysis.md` §2.2, §7.1 |
| skill slug 冲突是静默覆盖 | `skills/storage.ts:224-242` |
| `local` source 不产生工具 | `sources/server-builder.ts:330-358` |
| `api` source 产生工具 | `sources/api-tools.ts:349,433` |
| slash 菜单已支持多类型与分组 | `slash-command-menu.tsx:16,38,105`；`FreeFormInput.tsx:1501-1515` |
| 配置编辑走对话 + 文档 | `apps/electron/resources/docs/phaneris-cli.md:3`；`skills.md:5-8` |
| 打包/落盘基础设施已存在 | `resources/resource-bundle.ts:118,621,747-780` |
| Agent Plugins 1.0.0 portable core 只有 skills + MCP | <https://agent-plugins.org/specification> §7；扩展见 §8 |

---

## 11. 文档交付物（本次必须一并完成）

因为 P1-1 定为「导入走对话、**无前台 UI 入口**」，**文档就是功能的实现载体**——
没有准确的 `docs/plugins.md`，AI 既装不了也改不了 plugin。所以文档不是附属品，是本设计的一个组成部分。

### 11.1 两套彼此独立的文档系统（都要动）

| | **① agent 必读文档** | **② 应用内 UI 文档** |
|---|---|---|
| 位置 | `apps/electron/resources/docs/plugins.md` | `apps/electron/src/renderer/docs/guide/en/plugins/overview.md` |
| 运行时位置 | `~/.phaneris/docs/plugins.md`（**每次启动覆盖同步**，见 `resources/AGENTS.md`） | 编译进 renderer bundle（`content.ts`），无运行时文件 |
| 读者 | **AI**（配置与修改 plugin 时必读） | **用户**（帮助菜单 / 深链） |
| 索引机制 | `DOC_REFS`（`shared/src/docs/index.ts:101-125`） | `DOCS`（`shared/src/docs/doc-links.ts:45-130`）+ `DOCS_SECTIONS`（`renderer/docs/manifest.ts`） |
| 门禁 | 无自动门禁，靠 §11.3 的引用点保证被读到 | **`doc-links.test.ts` + `manifest.test.ts`**：slug 必须解析到真实页面、每个 slug 在每个 locale 都要有内容文件 |

> **注意**：两套系统**不共享内容**，各写一份。agent 文档面向"怎么做"，UI 文档面向"这是什么"。

### 11.2 agent 文档 `docs/plugins.md` 的内容要求

必须覆盖（与 `sources.md` / `skills.md` 同款结构：工作流声明 + 完整流程 + 可复制模板）：

| 章节 | 内容 | 为什么必须 |
|---|---|---|
| 工作流头 | "plugin 文件由 AI 直接编辑；本文是唯一规范" | 与 `skills.md:5-8`、`phaneris-cli.md:3` 的既有声明同构（注意：plugin **没有** CLI 域，所以这里是"直接编辑"而非"走 CLI"） |
| 包结构 | `plugin.json` / `skills/` / `mcp.json` / `PROMPT.md` / `phaneris/sources.json` | AI 写包的正确形状 |
| 编写 plugin | 完整可复制模板（照 `skills.md` 的示例密度） | P8-5 |
| 安装 | 取包 → 校验 → **覆盖清单确认** → 物化（§5.1.1） | D9 的确认动作靠文档驱动 |
| 修改 | 对话式编辑规则：改哪个文件、改完如何校验 | P1-1 的核心路径 |
| 卸载 | 引用计数语义（D10）：独占删、共享留 | 否则 AI 会误删共享资源 |
| **约束与陷阱** | 见下表 | 这些是静默失败的来源 |
| 校验 | `config_validate({ target: 'plugins' })`（P8-2） | AI 自查闭环 |

**必须写进"约束与陷阱"的条目**（每条都对应一个设计决定，漏写就是静默失败）：

1. **最小实体** ≥1 skill 或 ≥1 MCP server（D3）
2. **名字一致性**：目录名、`plugin.json` 的 `name`、`skills/<slug>/` 的目录名必须一致，否则拒绝（P2-2/P2-3）
3. **不发符号链接**：会让整个 workspace 备份失败（D11）；`data/` 里也不能由 server 造 symlink（§5.4.7）
4. **server 的相对路径以插件根为基准**（§5.4.1 的直接后果）
5. **`cwd` 不被支持**，非 `${PLUGIN_ROOT}` 起的 `cwd` 会让该 server 条目被跳过（§5.4.1）
6. **`command` 不得用裸名**（`node` / `npx`），必须 `./bin/...` 或 `${PLUGIN_ROOT}/...`（§5.4.6）
7. **`data/` 是持久数据，升级不会清空**；其余包内文件升级会被目录级替换（P5-1）
8. **凭据不入包**：`mcp.json` 的 headers 不得内嵌密钥（spec §7.2.1），api source 的凭据由用户装后自走 OAuth（P6-5）
9. **api source 必须在包内提供 `guide.md`**（P6-6）
10. **单槽位**：会话内同时只有 1 个 plugin 生效，`/B` 静默替换 `/A`（D12）

### 11.3 必须接线的位置（否则文档不会被读到）

| # | 位置 | 动作 |
|---|---|---|
| 1 | `shared/src/docs/index.ts` 的 `DOC_REFS` | 加 `plugins: '${APP_ROOT}/docs/plugins.md'` |
| 2 | `shared/src/prompts/system.ts` 的 "Sources, Skills, and Project Context" 段（`:647-651` 一带）+ 文档表（`:625-627` 一带） | 加 plugin 一行，声明"创建/修改 plugin 前读 `DOC_REFS.plugins`" |
| 3 | `EditPopover.tsx`（`add-skill` 在 `:384-389`） | 加 `'add-plugin'` 条目：`filePath: \`${location}/plugins/\`` + context 提示"读 `~/.phaneris/docs/plugins.md` 并按其规范创建" |
| 4 | `resources/AGENTS.md` 的资产表 | 无需改动（`docs/` 是整目录同步），但需**确认**新文件随 `docs/` 同步 |
| 5 | `renderer/docs/manifest.ts` 的 `DOCS_SECTIONS` | 新增 `plugins` section 或并入既有 section，加 `{ slug: 'plugins/overview', title: 'Plugins' }` |
| 6 | `doc-links.ts` 的 `DocFeature` 联合类型 + `DOCS` 表 | 加 `'plugins'` 项（`slug: 'plugins/overview'` + title + summary） |
| 7 | 侧边栏 Plugins 段空态 | 帮助入口指向 `getDocSlug('plugins')`（照其它段的既有做法） |

### 11.4 其它必须一并产出的文档

| 文档 | 动作 |
|---|---|
| `docs/README.md`（仓库） | 维护规则第 2 条：架构文档须声明 proposed/accepted/…；实施后把本设计从 `proposed` 更新 |
| `apps/electron/resources/release-notes/next.md` | 追加用户可见变更条目（维护规则第 4 条） |
| `docs/plugins.md`（面向开发者，如需） | 可与 §11.2 的 agent 文档分写，也可只保留 agent 版本；**若不分写，开发者信息应并入本设计文档** |

### 11.5 文档的验收

| 验收项 | 标准 |
|---|---|
| 门禁 | `doc-links.test.ts`、`manifest.test.ts` 通过（slug 解析 + 各 locale 内容存在） |
| 可操作性 | **只给 AI `docs/plugins.md`，它能独立完成一次装配**（写包 → 校验 → 安装 → 确认清单 → `/` 调用）——这是模块 G 的验收标准 |
| 约束覆盖 | §11.2 的 10 条陷阱条目全部在文档中出现 |
