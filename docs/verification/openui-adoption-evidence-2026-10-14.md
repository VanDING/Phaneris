# OpenUI 接入：实测证据记录（2026-10-14）

Status: historical — 已记录的实测事实，作为 [2026-10-13 接入评估提案](../design/openui-reply-presentation-plan-2026-10-13.md) 的补充证据。**不代表实施授权，不改变提案的 proposed 状态，也未创建任何产品验收产物。**

日期：2026-10-14（Asia/Shanghai）。基线：`main`，工作区存在其它未提交变更（与本记录无关）。

## 0. 本文的定位

[2026-10-13 提案](../design/openui-reply-presentation-plan-2026-10-13.md) §4.1、§7、§9.1 中有若干项被显式标注为"未知/未验证/不预设"。本文只做一件事：**把这些未知量实测出来**，并补齐提案中与技术路线直接相关的两处缺口（围栏格式的确切契约、工具执行面的具体约束机制）。提案已决定的事项（自定义组件库、不用 Gateway/Autofix、首轮关闭 UI 侧工具工作流、Markdown 混排）本文不再重述或推翻。

本文不建立第二套提案、不建立实施队列，也不改变既有 R01–R07、条件触发项或发布门槛。

### 0.1 必须披露的偏差

提案声明"用户仅授权评估与文档落盘，未授权原型、依赖安装或功能实施"。本次调查**在仓库外部的忽略目录（`.verify/`，已由 `.gitignore` 排除）中做了一次依赖安装与提示词生成实验**，用于取得下文的实测数字。边界如下，供评审判断：

- 未改动根 `package.json`、`bun.lock` 或任何工作区包的依赖声明（`git status` 与内容检索均为空）。
- 未改动任何产品源码、构建配置、CI 或环境变量。
- 未运行产品构建、模型生成实验或产品 E2E。
- 实验目录属仓库忽略范围，可整体删除。

若评审认为该偏差超出授权范围，删除 `.verify/` 下相关目录即可完全回退。

---

## 1. 关键发现：提案的技术路线得到官方机制支持，且围栏契约已确定

提案 §5.2 判断"官方提示词源码包含围栏混排模式……应借鉴其语法并定制回复规则"。实测确认了这一模式，并给出了确切契约。

`@openuidev/lang-core@1.0.0` 在 `inlineMode` 下生成的提示词原文（节选）：

```text
## Inline Mode
You are in inline mode. You can respond in two ways:

### 1. Code response (when the user wants to CREATE or CHANGE the UI)
Wrap openui-lang code in triple-backtick fences. You can include explanatory text before/after:
...
### 2. Text-only response (when the user asks a QUESTION)
If the user asks "what is this?", "explain the chart" — respond with plain text.
Do NOT output any openui-lang code. The existing dashboard stays unchanged.

### Rules
- When the user asks a question, respond with text only — NO code.
- The parser extracts code from fences automatically. Text outside fences is shown as chat.
```

由此确定三项事实：

1. **围栏语言标签固定为 `openui-lang`**（不是 `openui`）。
2. **围栏抽取在解析器内部完成**（`lang-core` 的 `stripFences()`，字符串感知——会跳过双引号内的三反引号，支持同一条消息中的多个围栏并在抽取后拼接）。因此 `<Renderer response={整条消息文本}>` 可直接消化"散文 + 围栏 + 散文"，宿主不需要自己写分段器。
3. **官方机制本身就是"双模"**：需要界面时出围栏，回答问题出纯文本。这与提案 §5.2 第 5 条、§5.4"同一次模型调用选择 Markdown 或适当 UI 区块"完全一致，不需要自造规则。

提案 §5.2 第 1/2 条的额外约束（区块必须自包含、工具结果与外部文本中的同名围栏不得自动取得能力）**仍然必须由宿主施加**：官方提示词不保证这两点。

### 1.1 流式可用性

未闭合围栏在 CommonMark 中就是一个延续到文末的代码块，因此：

```text
text_delta 增长 → 既有 Markdown 重解析 → code 属性变长 → Renderer 重新解析并渐进渲染
```

**不需要新增流式管道**。仓库既有事件词汇表已覆盖所需语义：`text_delta`、`text_discard`、`text_complete`（[event-adapter.ts](../../packages/shared/src/agent/backend/pi/event-adapter.ts)）。`text_discard` 在此天然正确：被丢弃的文本一并移除围栏块。

**但提案 §3 指出的问题成立且必须处理**：`MarkdownProps` 目前不含 `isStreaming`，而"围栏是否闭合"**不等于**"整条消息是否结束"（一条消息可以有多个区块，后面的区块尚未到达）。`isStreaming` 必须从消息链路贯通到区块组件，不能由围栏闭合推断。

---

## 2. 提案 §7「提示词与会话成本……实际增量未知」——已实测

安装 `@openuidev/react-lang@1.0.0`、`@openuidev/lang-core@1.0.0`、`@openuidev/react-ui@0.18.0` 后测得（token 数为 `字符数 / 4` 的粗估，仅用于量级对比；官方基准使用 tiktoken，绝对数会不同）：

**A. 官方内置库 `openuiLibrary`（root = `Stack`，82 个组件）**

| 提示词配置 | 字符数 | ≈ tokens |
| --- | ---: | ---: |
| `library.prompt()` | 36,113 | 9,029 |
| `+ inlineMode` | 37,073 | 9,269 |
| `+ inlineMode + editMode` | 38,211 | 9,553 |
| `+ inlineMode + toolCalls + bindings` | **46,828** | **11,707** |

**B. 等价形状的自建精选库（23 组件，root = `Stack`）**

| 提示词配置 | 字符数 | ≈ tokens |
| --- | ---: | ---: |
| `library.prompt()` | 5,499 | 1,375 |
| `+ inlineMode` | 6,459 | 1,615 |
| `+ inlineMode + toolCalls + bindings` | **15,515** | **3,879** |

**三点结论：**

1. **库规模对提示词成本是超线性的。** 82 → 23 个组件，基础提示词从 36.1k 降到 5.5k 字符（6.6×），不是 3.6×。原因是每个容器组件的 `children` 联合类型会把可容纳的子组件名逐个列出，例如官方 `Card` 一行就枚举了 36 个类型。**收缩组件集 = 收缩联合类型 = 双重收益。** 这为提案 §5.3"有限组件"提供了直接的量化依据。
2. **`toolCalls + bindings` 有一块与库大小无关的固定开销** ≈ 9.1k 字符（≈2.3k tokens）：数据工作流规则、`$variable` 响应式规则、内置函数表。
3. **由此产生一个提案未列出的分档决策**：只做静态/响应式界面约 **1.6k tokens**；接上运行时数据查询约 **3.9k tokens**。提案 §5.4"首轮关闭 UI 侧工具工作流"因此同时也是成本决策，不只是安全决策。

**方法学限制**：B 组为等价形状的替身（同名同参数、渲染函数为空）——提示词生成只读取 schema 与 description、不渲染组件，因此字节数量级结论成立；真实库因 description 更详细会略有增长。绝对阈值需在 P0 基线中用真实库复测。

---

## 3. 提案 §7「包体与构建开销……不预设体积收益」——已实测

| 包 | 发布体积 | 说明 |
| --- | ---: | --- |
| `@openuidev/react-lang` | 94 KiB | 客户端唯一必需项（解析器 + Renderer + `createLibrary`） |
| `@openuidev/lang-core` | 355 KiB | 服务端专用，无 React 依赖 |
| `@openuidev/react-ui` | 2,902 KiB | 推荐路线不需要 |

- 若采用自建组件库（提案 §4.2 的推荐路线）：客户端只增 `react-lang`，实测安装拉入 10 个包。
- 若采用 `react-ui`：实测拉入 **230 个包**（Radix、d3、TanStack Table、react-day-picker、react-syntax-highlighter 等）并自带 CSS 设计系统。这与提案 §5.3"组件使用现有语义 token、字体、密度、明暗主题"的要求直接冲突，构成不采用它的第二条独立理由（第一条是第 2 节的 3.0× 提示词成本）。

**peer 依赖兼容性已实测确认**（提案 §4.1 标注"尚未做真实安装验证"）：

| peer | 声明 | 仓库现值 | 结果 |
| --- | --- | --- | --- |
| `zod` | `^3.25.0 \|\| ^4.0.0` | 4.6.5 | 兼容 |
| `react` / `react-dom` | `*` / `^18.3.1 \|\| ^19.0.0` | 19.3.0 | 兼容 |
| `@modelcontextprotocol/sdk` | `>=1.0.0` | 1.32.0 | 兼容 |

注意 `react-lang` 内部使用 `zod/v4` 子路径与 `zod/v4/core` 的 `$ZodObject` 类型；组件定义必须用 `zod/v4`，Zod 3 风格的 schema 会被拒绝。

---

## 4. 提案 §4.3「遥测与第三方默认行为」——已核到源码行为

| 项 | 实测结论 | 处理 |
| --- | --- | --- |
| `lang-core` postinstall | 确实存在，向 PostHog 上报安装事件（安装 ID、加盐哈希的项目 ID、Node/OS/包管理器版本；读取 `INIT_CWD`） | **bun 的 `trustedDependencies` 白名单默认即拦截**（安装输出 `Blocked 1 postinstall`）。维持不加入白名单，并在 CI 显式设 `OPENUI_TELEMETRY_DISABLED=1` 作为双保险 |
| `@openuidev/observability` | 包内**无任何网络端点**，是纯本地 pub/sub 事件总线，sink 由使用者挂载 | `<Renderer publishObservability>` 保持不传 |
| DevTools | 提案 §4.3 提到的开发版自动挂载与 CDN 加载行为在本次未复核 | 维持提案的"需验证与 CSP 关系"结论，不放松 CSP |

---

## 5. 提案 §7「宿主能力被旁路」——执行面约束的具体落点

提案要求"白名单组件、最小宿主入口、不提供通用工具执行器"。以下是可落地的现状依据。

`packages/session-tools-core/src/tool-defs.ts` 已为每个会话工具维护 `safeMode: 'allow' | 'block'` 与 `readOnly?: boolean`，并已有派生用法（该文件内 `filter(d => d.safeMode === 'allow')` / `filter(d => d.readOnly === true)` 的既有模式）。这意味着 OpenUI `Renderer` 的 `toolProvider` **允许清单可以从既有元数据派生，不需要新写一份策略**——符合仓库"同一判定只有一处实现"的既有纪律。

需要写进实施阶段的四条约束：

1. **只有当前活跃回合可以执行工具。** 历史消息、已完成回合渲染时 `toolProvider` 必须为空；程序照常渲染但取不到数据、不产生写入。活跃性来自消息链路，**不得由围栏闭合推断**（同 §1.1）。
2. **白名单只取只读工具**，由上述既有元数据派生，不手写清单。
3. **写操作只能由用户手势触发**（OpenUI 的设计本身即如此：`Mutation` 不在加载时执行，只能由 `Action([@Run(...)])` 触发），且必须走既有的工具权限判定路径，与 Agent 自身调用同一条路径。
4. **`@OpenUrl` 走既有链接路由策略**，不得让生成界面自带一套 URL 处理。

另外两条：

- `<Renderer>` 不传 `onError` 时错误只进 `console.warn`，且**默认不显示任何查询错误或重试界面**。必须显式接管，否则查询失败时用户看到的是空白。
- 提案 §5.4 已决定"首轮关闭 UI 侧工具工作流……不向 Renderer 提供通用 toolProvider"。第 2 节显示这一决定同时省下约 2.3k tokens 的固定开销。

**一条提案未覆盖的对抗面**：历史消息是**不可信输入**（共享会话、messaging-gateway 来源、导入会话）。提案 §9 OU08 覆盖了"工具结果与外部文本中的同名围栏不得取得交互权限"，但还需要一条对称的断言——**重放历史时任何 `Mutation` 都不得自动执行**。建议在实施阶段把它登记为 OU08 的补充场景。

---

## 6. 提案 §7「Schema 被当作完整安全边界」——与既有接缝的关系

以下位置是本次核对确认的接入点，供实施阶段直接引用，不构成实施：

| 接缝 | 位置 | 现状 |
| --- | --- | --- |
| 系统提示注入 | [phaneris-resource-loader.ts](../../packages/pi-agent-server/src/phaneris-resource-loader.ts) | `systemPromptOverride` 读 Phaneris 整段提示；同文件的 `before_agent_start` 已演示"尾部追加一段能力说明"的既有写法 |
| 系统提示构造 | [pi-agent.ts](../../packages/shared/src/agent/pi-agent.ts) `getSystemPrompt(...)` 调用点 | OpenUI 段按（库版本 × 档位 × 权限模式）稳定，**必须进稳定前缀**，不能进易变段（仓库既有约束：否则系统前缀缓存失效） |
| 围栏分派 | [Markdown.tsx](../../packages/ui/src/components/markdown/Markdown.tsx) | `code:` 渲染器已按 `language-*` 分派 10 种围栏（mermaid / json / datatable / spreadsheet / html-preview / pdf-preview / image-preview / latex / diff / doc），另有兜底 `CodeBlock`；OpenUI 是第 11 个。**注意该分派在两种 `mode` 下各有一处**，且 Tiptap 编辑器走的是另一套 `extensions/*` 路径 |
| 区块实现范式 | [MarkdownMermaidBlock.tsx](../../packages/ui/src/components/markdown/MarkdownMermaidBlock.tsx) | 懒加载重依赖、失败兜底为 `CodeBlock`、主题走 CSS 变量、与放大面板联动的现成模板 |
| 工具分类元数据 | [tool-defs.ts](../../packages/session-tools-core/src/tool-defs.ts) | 见 §5 |

---

## 7. 建议补充到实施阶段的验证场景

提案 §9 的 OU01–OU18 已覆盖主要失败面。基于本次实测，建议补充以下几项（编号沿用提案，标为补充）：

| ID | 失败场景 | 必须验证的结果 |
| --- | --- | --- |
| OU19 | 同一条消息含多个 `openui-lang` 围栏，或围栏内字符串含三反引号 | 分段正确，`stripFences` 的字符串感知生效；区块身份稳定不重挂载 |
| OU20 | 围栏未闭合时 `isStreaming` 已结束，或围栏已闭合但消息仍在流式 | 以消息链路为准，不以围栏闭合推断回合状态 |
| OU21 | 重放历史回合（含来自共享/gateway 来源的消息） | 任何 `Mutation` 均不自动执行；只读 `Query` 需用户显式手势才可执行 |
| OU22 | 深色/浅色主题切换 | 生成区块随主题变化（这是自建组件库相对官方库的主要收益，必须证明） |
| OU23 | 组件库 schema 键序变更而规格未重新生成 | 构建门检出；不出现"能渲染但参数错位"的静默失败 |
| OU24 | 提示词增量回归 | 自建库在 `inlineMode`（L1）与 `+toolCalls+bindings`（L2）两档分别不超过 P0 基线测得的阈值 |

### 7.1 复现方式

第 2、3 节的数字来自两个一次性脚本，均在仓库忽略目录中运行，未进入依赖图：

1. 在仓库忽略目录下建一个独立 `package.json`，装 `@openuidev/react-lang@1.0.0`、`@openuidev/lang-core@1.0.0`、`@openuidev/react-ui@0.18.0`、`react@19.3.0`、`react-dom@19.3.0`、`zod@4.6.5`。
2. 第一个脚本读 `@openuidev/react-ui/genui-lib` 的 `openuiLibrary` 与 `genui-lib/prompt-options` 的 `openuiPromptOptions`，枚举组件、按四种 `promptOptions` 组合调用 `library.prompt(...)` 与 `generateSystemPrompt({ library: library.toSpec(), promptOptions })`，落盘提示词与 `toSpec()` / `toJSONSchema()`。
3. 第二个脚本用 `defineComponent` / `createLibrary` 构造 23 组件替身库（同名同参数、渲染函数为空）并重复同样的测量。

**替身库的有效性依据**：提示词生成只读取组件名、`z.object` 的键序与类型、以及 `description`；不渲染组件。因此字符数量级结论成立，真实库因 description 更详细会略有增长。

**注意**：`lang-core` 的 postinstall 会被 bun 拦截，所以第 1 步不会外联。若要显式安装（trust），必须先设 `OPENUI_TELEMETRY_DISABLED=1`。

可重复产物应沿用既有 verification 机制（[verification-artifacts.ts](../../scripts/verification/verification-artifacts.ts) 的 manifest：git SHA、lockfile sha256、脏文件清单、逐文件 sha256；浏览器侧参照 [markdown-artifact-workflow.ts](../../scripts/verification/markdown-artifact-workflow.ts) 的 Playwright + Vite 起真实产物的做法）。建议产物至少包含 **本次库的 `$defs` JSON 与其 sha256**——这样 OU23 的静默失败在工件层面可被比对捕获。

---

## 8. 本次未验证的范围

- 未做真实安装验证之外的构建/打包验证；发布包体积不等于生产 bundle 增量（提案 §7 的保留结论仍然成立）。
- 未做任何模型生成实验：中文回复质量、生成稳定性、空白率、修复成本均无本项目数据。**官方可靠性数字不能作为本项目结论。**
- 未验证与 Electron CSP、DevTools 引导、WebUI/Viewer 宿主的关系。
- 未验证 Tiptap 编辑器与文件导出路径对新围栏的处理（提案 §9 OU17 仍开放）。
- 未验证流式下大程序的渲染性能（长消息下解析重入频率与消息长度成正比，需实测）。
- 未做任何产品 E2E，未创建验收产物。

---

## 9. 对提案 §10「待评审决定」的影响

本文只提供证据，不改动决定表。两处建议更新，待评审采用：

1. **"生成入口"行的"提示词负担"** 已由第 2 节给出量级（L1 ≈1.6k tokens，L2 ≈3.9k tokens，均基于 23 组件库）。绝对阈值建议在 P0 用真实库基线冻结。
2. **"云服务、UI 侧工具与写操作"行** 目前理由是安全与数据边界。第 2 节显示它同时是成本决策（约 2.3k tokens 固定开销）。两者都应保留为不纳入首轮的理由。

## 10. 变更记录

| 日期 | 变化 |
| --- | --- |
| 2026-10-14 | 记录依赖安装与提示词生成的实测结果，确定 `openui-lang` 围栏契约与解析器内置抽取行为，量化提示词组件的 3.0× 差异，补齐执行面约束的落点与安全断言，新增 OU19–OU24 建议场景。仅文档，未实施。 |
