# 四条工作流的排序规划

规划日期：2026-10-06
范围：① 大文件拆分 ② 会话工具竞态 ③ 架构分析发现 ④ decide 模式优化
状态：**规划已定案**（§3 三项决策于 2026-10-06 确认）；尚无任何代码改动
依据：[Phaneris_Project_Deep_Analysis.md](./Phaneris_Project_Deep_Analysis.md)（§10 拆分方案、§11 shared 膨胀、§12 优先级）、[architecture/overview.md](../architecture/overview.md)、[dependency-graph-2026-10-06.md](../dependencies/dependency-graph-2026-10-06.md)，以及 2026-10-06 会话中对竞态与 Guarded 的源码级核查

---

## 0. 推荐顺序（一眼表）

| # | 步骤 | 对应事项 | 为什么在这个位置 | 前置 |
|---|---|---|---|---|
| **1** | 修会话工具竞态 | ② | 唯一"每条新会话首轮必错"的问题；修复面小；**产出的回归门禁保护后面所有改动** | 无 |
| **2** | Guarded 低争议修正 + risks 徽章 | ④c 前段 / ③ 行为类 | 同样是活的用户可见错误；小而确定；必须在拆分前落地 | 无 |
| **3** | 决策层可观测 + Guarded 判定夹具 | ④b / ④c 前置资产 | **先度量再改行为**；后面的阈值调优与 feature 灰度都要靠它 | 无 |
| **4** | 依赖与死代码清理 | ③ 低风险层 | 稳定 lockfile 与产物基线，为拆分让路；与文件移动完全正交 | 无 |
| **5** | 拆分大文件（**仅 2 个后端文件**） | ① | 需要第 1 步的门禁保护；需要第 4 步稳定依赖图 | **1, 4** |
| **6** | 结构性改造 + 决策层 feature 补全 + Guarded 调优 | ③ 结构层 / ④a 补全 / ④c 后段 | 会改变运行时与构建布局的改动，必须在新布局上做 | **3, 5** |

**并行度**：第 1、2 步可并行（不同文件）。第 3、4 步可并行（决策层 vs 依赖清单）。第 5 步必须串行独占——它是纯移动，混入任何行为变更都会让回归无法归因。

---

## 1. 关键耦合：为什么不能按"重要性"直接排

规划前我核了四条跨事项的耦合，它们直接决定了顺序，不是偏好问题。

### 1.1 ④a 与 ② 共用同一个触发点 —— feature 治理会动到竞态的扳机

竞态的第二个调用者是 `SessionManager.generateTitle`：它 fire-and-forget 派发后**轮询等待**主路径创建 agent（`SessionManager.ts:9426-9433`），拿到同一个 PiAgent 实例后调用 `ensureSubprocess()`，从而**夺走 `spawnSubprocess()` 的所有权**，把主对话从"完整 spawn"提前释放到"子进程 ready"。

而 `generateTitle` 的分支由决策层 feature 决定（`SessionManager.ts:7400-7401`：`smartTitles` 走 `generateTitleUnlessSmallTalk`，否则直接 `generateTitle`）。

**结论**：先做 ④a 的标题相关治理，会改变竞态的触发特征，把已经定位清楚的问题重新变成"偶发"。所以 ② 必须在 ④a 之前，而且**必须修在 `ensureSubprocess` 的语义层，不能补丁化调用方**——否则 ④a 一改标题路径，竞态就回来了。这是本规划里最强的一条约束。

### 1.2 ① 与 ②④ 争夺同一批文件

拆分目标与修复目标高度重叠：

| 文件 | 行数 | 被谁碰 |
|---|---:|---|
| `packages/server-core/src/sessions/SessionManager.ts` | 11,385 | ② 的调用方、④a 的 feature 判定、① 的主要目标 |
| `packages/shared/src/agent/pi-agent.ts` | 3,414 | ② 的修复点、④c 的判定入口、① 的目标 |
| `packages/shared/src/agent/core/guarded-mode.ts` | 239 | ④c、② 的相邻代码 |

先拆再修 = 在移动后的新布局里重新定位一次；先修再拆 = 修复与测试随文件一起移动，且**第 1 步的门禁可以证明拆分没改变行为**。后者明显更省。

### 1.3 ④b 是 ④a/④c 的度量前提

决策层 13 个 feature 中 10 个默认关闭（`packages/shared/src/decisions/settings.ts:122`），而 Guarded 的判定质量调优需要知道：每个 feature 的调用次数、失败率、成本、被判 risk 的比例、以及 unavailable 分支的占比。

`purpose: 'decision'` **已经接进 durable 账本**（`packages/server-core/src/decisions/accounting.ts:14,28`），所以 ④b 是"补查询与分析"，不是从零建管道。**先有它，④c 的阈值与措辞调整才不是拍脑袋。**

### 1.4 ④c 的误报是"模型质量"问题，现有夹具测不到

现有 E2E 工作流的自我说明写得很诚实（`scripts/verification/decision-feature-workflow.ts` 头注释）：

> Offline responses verify **policy, never model quality**. `--live` adds a bounded chat reference.

而上一轮定位的 `$(...)` 误报（只读命令因命令替换被拒 → 交给模型 → 模型答"越出项目" ≥0.8 → 弹窗）**正是模型质量问题，不是策略问题**。现有夹具用固定应答（`.01` / `.99`）驱动，永远复现不出这个误报。

**所以 ④c 需要一个新资产：一批"命令 → 期望风险等级"的标注夹具**，外加一个可离线重放的判定回归。这是 ④c 的硬前置，且成本很低。

---

## 2. 各步骤详情

### 第 1 步 — 修会话工具竞态（②）

**问题的精确定义**：`ensureSubprocess()` 承诺的是"子进程就绪"（`pi-agent.ts:524-531` 只 `await this.subprocessReady`），但 `chatImpl` 需要的是"子进程已具备完整工具集"。`ready` 在 init 末尾就 resolve（`pi-agent.ts:1066`），而 `sync_tools` 在那之后一个完整 RPC 往返（`await requestSetAutoCompaction`，`:702`）才发出（`:723`）。任何在窗口内进入的并发调用者都会被提前释放。

**改动方向**（详见本轮分析，此处只记排序相关约束）：

| 方向 | 说明 | 排序含义 |
|---|---|---|
| **A. `ensureSubprocess` 等完整 spawn** | 增加 `subprocessFullyReady`，在 `spawnSubprocess()` 末尾 resolve | **推荐**。调用方无关，④a 改标题路径不会让它失效 |
| B. 工具定义并入 `init` | 子进程在能建会话前就拿到完整工具集 | 次优，但彻底消除窗口 |
| C. 子进程侧首轮等 sync | 引入延迟与超时 | 不推荐 |
| D. 标题不再复用主 agent | 只治表象 | **禁止**——④a 会重新引入 |

⚠️ 方向 A 的重入陷阱：`spawnSubprocess` 内部 `:702` 会经 `requestSetAutoCompaction` → `ensureSubprocess` 回调自身。必须区分内外部调用，否则自锁。

**退出标准**：一条 E2E，断言新会话**首轮**的工具集与第二轮一致（当前是 10 vs 44）；且该 E2E 在第 5 步拆分后仍然通过——这正是它作为拆分安全网的价值。

---

### 第 2 步 — Guarded 低争议修正（④c 前段 + ③ 行为类）

上一轮发现的、不需要度量就能定的四条：

| 项 | 事实 | 处理 |
|---|---|---|
| `resolveEffectivePermissionMode` 注释与实现矛盾 | 注释称"缺少答案仍会执行"，代码是弹窗（`guarded-mode.ts:217-228`） | **已定：改注释对齐实现**（决策 2），保持 fail-closed 不变 |
| `risks` 徽章是死代码 | UI 用 `PermissionRisk`（deletes/sends/…），Guarded 产出 `GuardedModeRisk`（irreversible/outside_workspace/external），且从不填 `risks` 字段 | 二选一：统一枚举并回填，或删掉徽章通道 |
| `Execute:` 命名撞车 | `Execute:` 前缀 = `allow-all` 的 `displayName`（`mode-types.ts`） | 改前缀（如 `Command:`）或改模式显示名 |
| 两段判定倒挂的**最小**修正 | AST 因 `$(...)` 放弃后，模型看不到"其余子命令已全部命中只读白名单" | 只在 state 里补一个提示字段，属低风险 |

**本步性质（据决策 2）**：纯文档对齐 + 命名/徽章修正，**不含任何权限语义变更**——这是整个规划里风险最低的一步。

**退出标准**：Guarded 弹窗文案能被用户正确解读；`guarded-refinement-workflow.ts` 通过并补充徽章断言。

---

### 第 3 步 — 决策层可观测 + Guarded 判定夹具（④b + ④c 前置）

**④b 的范围**：
- `purpose: 'decision'` 的 run 在账本中的可查询化（按 feature / 结果 / 成本 / 失败类型聚合）
- 补齐 `payload.kind: 'decision'` 的分析视图；确认与 `cache_warm` / `image_generation` 的口径一致
- 现有资产：`scripts/verification/decision-governance-workflows.ts`（真 host + durable store + loopback 决策服务）

**④c 前置资产（新增）**：
- 标注夹具集：一批真实命令 → 期望风险等级（含"只读但含 `$(...)`/`$VAR`"这一类）
- 离线可重放的判定回归；`--live` 只作为有界参考

**退出标准**：能回答"过去 N 次 Guarded 判定里，有多少是模型判风险、多少是 unavailable、多少是 alwaysAsk"；夹具能稳定复现 `$(...)` 误报。

---

### 第 4 步 — 依赖与死代码清理（③ 低风险层）

来自 [dependency-graph-2026-10-06.md](../dependencies/dependency-graph-2026-10-06.md) 的确定性项：

| 组 | 内容 | 收益 |
|---|---|---|
| 死声明 | 18 条零引用声明（含 `incr-regex-package`） | **-101 个锁条目（-6.2%）**，清掉 ESLint 7 与 `eslint_d`、`@electron/packager` 整链 |
| 归属修正 | `server-core` 补声明 `session-tools-core`；`viewer` 补声明 `shared`；`webui` 的 `vite` 移入 devDeps | 消除隐式内部边 |
| 打包边界 | `sharp` 从 `apps/electron` 移除（属服务端产物） | 修正桌面产物边界 |
| 一致性 | 对齐 5 组版本分歧范围 | 防止 viewer 与根漂移 |
| 文档漂移 | ~~Pi SDK 版本（1.0.0 / 0.86.1 → 1.0.2）~~ **已于 2026-10-06 完成**（`docs/guides/pi-kernel.md` 与 `apps/electron/README.md` 均改为 1.0.2）；`@phaneris/core` 描述失真**仍未改** | 防止误导分层判断 |
| 测试 | `packages/ui` 3 个 `import 'vitest'` 的测试（vitest 未安装） | 消除不可运行测试 |

**退出标准**：`validate:ci` 绿；记录一次 `bundle:report` 作为第 5 步的对比基线。

---

### 第 5 步 — 拆分大文件（①）

**权威文档**：[Phaneris_Project_Deep_Analysis.md](./Phaneris_Project_Deep_Analysis.md) §10「最大架构债：SessionManager」给出九服务拆分方案（SessionRegistry / SessionPersistenceService / AgentRunService / DurableExecutionService / SessionContextService / ToolRuntimeService / SessionArtifactService / SessionAutomationService / SessionProjectionService），目标是让 `SessionManager` 退化为 Facade，**真正目的是让 Durable Runtime 独立于 SessionManager 演进**（§10 结尾）。该文档把它列为 §12.4 第四优先级。

**本步范围（据决策 3）**：只拆 **2 个后端文件**——`SessionManager.ts`（11,385 行，§10 九服务方案）与 `pi-agent.ts`（3,414 行，第 1 步修复点）。另外 7 个大文件**明确不在本规划内**，清单见 §3 决策 3。

| 文件 | 行数 | 备注 |
|---|---:|---|
| `packages/server-core/src/sessions/SessionManager.ts` | 11,385 | 最大目标；§10 已给方案 |
| `packages/shared/src/agent/pi-agent.ts` | 3,414 | 第 1 步刚改过，拆分时以新结构为准 |

**硬约束**：
1. **纯移动，零行为变更**——否则第 1 步的回归门禁失去归因能力。
2. **一次一个 service，每个 PR 后跑全门禁**；不要合并成一个大 PR。
3. 第 1 步的 E2E 必须在此步骤后**仍然通过**——这是拆分的核心安全网。
4. 不做依赖或构建变更（留给第 4 步和第 6 步）。

**不在范围内**（决策 3）：`AppShell.tsx`、`browser-pane-manager.ts`、`TurnCard.tsx`、`storage.ts`、`pi-agent-server/src/index.ts`、`FreeFormInput.tsx`、`ChatDisplay.tsx`。其中 `storage.ts` 与 `pi-agent-server/src/index.ts` 是纯后端、回归成本低，可作为后续独立小批次，但不属本规划的承诺范围。

**另见 §11**：`@phaneris/shared` 的收缩（`@phaneris/protocol` / `config` / `credentials` / `session-domain` / …）是**独立于文件拆分**的包边界议题，§11 明确说"不一定马上拆 NPM Package"。建议**不在本规划内**，单独立项。

---

### 第 6 步 — 结构性改造 + 决策层补全 + Guarded 调优

三件事放在同一波次，因为它们都**改变运行时或构建布局**，需要前面所有步骤稳定后才有归因能力。

**③ 结构层**（来自 [architecture/overview.md](../architecture/overview.md) §10）：

| 项 | 风险 | 说明 |
|---|---|---|
| webui 与 electron renderer 的边界 | **高** | webui 的 tsconfig `include` 了 `../electron/src/renderer/**`，vite 把 `@` 指向该源码树；electron renderer 成了未版本化的库。需先补"webui 产物不含 Electron/Node 代码"的门禁，再谈边界 |
| 两套主题源头 | 中 | `packages/ui/src/styles/index.css`（仅 viewer）vs electron 自维护的 1,717 行 `index.css`；需先加比对检查 |
| bootstrap 顺序契约 | 中 | renderer 模块假定 `window.electronAPI` 已存在；webui 必须先赋值再 `import('@/App')` |
| `SERVICE_URLS.viewer = null` | 低 | 本 fork 不提供 viewer 服务端 |
| 陈旧 CSS `@source` glob | 低 | 指向不存在的 `tabs/` |

**④a feature 补全**（在拆分后的新布局上做）：
- 10 个默认关闭的 feature 逐个定级：**已完成未开启** / **半成品** / **待设计**
- 只有 ④b 的度量到位后才灰度开启
- `smartTitles` 与 `suggestions` 与第 1 步的竞态路径相邻，改完必须重跑第 1 步的门禁

**④c 后段（调优）**：
- 阈值（当前 `GUARDED_MODE_RISK_THRESHOLD = 0.8`，注释称"偏高以免滥用弹窗"）
- 提问措辞——"reaches outside the project" 对 `/dev/null`、绝对路径 `cd` 这类写法过于敏感
- 两段判定的粒度倒挂：让第一段（精确 AST）的结论传递到第二段
- 全部以第 3 步的度量与夹具为依据

---

## 3. 已决策事项（2026-10-06 确认）

规划中原本的三个分歧点已由项目所有者定案，下面是结论与其对规划的实际影响。**本节是决策记录，不是待议项。**

### 决策 1：④a 的 feature 补全排在第 6 步 ✅ 同意

维持原规划：决策层 10 个默认关闭的 feature 的**补全**（区别于治理）在新布局上做，且要有 ④b 的度量支撑。

- 影响：第 3 步只做**治理**（开关默认值、UI 暴露、标注哪些是半成品），不做功能补全。
- 约束不变：任何 feature 若涉及标题路径，**不能提前到第 1 步之前**，否则竞态复现（§1.1）。

### 决策 2：第 2 步以「改注释」为准 ✅ 改注释

`resolveEffectivePermissionMode`（`mode-manager.ts:469-473`）的注释改为与实现一致，**保持 fail-closed 行为不变**：

- 实现维持现状：拿不到有效判定 → `unavailable = true` → 弹窗（`guarded-mode.ts:217-228`）。
- 该注释改为与模块头注释（`guarded-mode.ts:14-15` "Missing or failed risk checks require confirmation"）及 `decisions/guarded-mode.ts:9`（"Missing or failed answers require confirmation"）口径统一。

**第 2 步因此明确为纯文档对齐 + 命名/徽章修正，不含任何权限语义变更**——这让它成为整个规划里风险最低的一步。

### 决策 3：第 5 步**不**拆 `SessionManager` 之外的 8 个文件 ✅ 不拆

第 5 步范围收窄为**两个后端文件**：

| 文件 | 行数 | 为什么在范围内 |
|---|---:|---|
| `packages/server-core/src/sessions/SessionManager.ts` | 11,385 | §10 已有九服务方案；有第 1 步门禁保护 |
| `packages/shared/src/agent/pi-agent.ts` | 3,414 | 第 1 步的修复点，随门禁一起收敛 |

**明确移出本规划**的 7 个文件（前端为主，渲染回归难自动化）：

| 文件 | 行数 |
|---|---:|
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | 4,189 |
| `apps/electron/src/main/browser-pane-manager.ts` | 3,698 |
| `packages/ui/src/components/chat/TurnCard.tsx` | 3,450 |
| `packages/shared/src/config/storage.ts` | 3,395 |
| `packages/pi-agent-server/src/index.ts` | 2,823 |
| `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` | 2,525 |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | 2,376 |

前端大文件若要拆，**另立一波并配视觉回归门禁**；`storage.ts` 与 `pi-agent-server/src/index.ts` 是纯后端、回归成本低，可作为后续独立小批次，但不在本规划的承诺范围内。

---

## 4. 现有资产盘点（决定各步骤的成本）

| 资产 | 位置 | 对本规划的作用 |
|---|---|---|
| SessionManager 拆分方案 | [Deep Analysis §10](./Phaneris_Project_Deep_Analysis.md) | 第 5 步可直接执行 |
| 既有优先级基线 | Deep Analysis §12（12.1 main 变绿 → 12.2 WebUI/RPC 安全加固 → 12.3 ESLint hook 警告 → 12.4 拆 SessionManager） | 与本规划的差异见下 |
| Guarded 判定 E2E | `scripts/verification/guarded-refinement-workflow.ts`（真权限管道 + loopback 决策服务 + 隔离配置，带 `failure` 开关） | 第 2 步与 ④c 的现成夹具 |
| 决策治理 E2E | `scripts/verification/decision-governance-workflows.ts`（真 host + durable store） | 第 3 步 ④b 的起点 |
| 决策 feature E2E | `scripts/verification/decision-feature-workflow.ts`（覆盖 smart-titles / suggestions / permission-risks / turn-outcome / semantic-labels / usage） | ④a 的回归基础；**但不验证模型质量**（见 §1.4） |
| 分类器对比 | `scripts/verification/classifier-comparison-workflow.ts` | ④c 调优的对照工具 |
| 打包与体积 | `bun run bundle:report` / `build:smoke` / `perf:smoke` | 第 4 步基线、第 5 步不退化证明 |

### 与既有 §12 优先级的差异

Deep Analysis 的排序是：**§12.1 让 CI 真正成为 Release Gate → §12.2 WebUI / RPC Security Hardening → §12.3 消灭 ESLint Hook Warning → §12.4 拆 SessionManager**。

本规划**没有覆盖它的 12.1/12.2/12.3**，因为用户这次给的四项不含安全加固与 lint 清理。两点提示：

1. **§12.2（WebUI/RPC 安全加固）不应被无限期推后**——它包含 Trusted Proxy 与 Auth Limiter 两处 P1 逻辑漏洞（同文档 §6）。如果要把它并入本规划，我建议插在**第 3 步与第 4 步之间**：此时正确性已止血、度量已就位，而拆分会大幅移动 `server-core` 的 RPC handler，安全改动宜在拆分前落地。
2. **§12.3（ESLint hook 警告）** 可以在第 4 步顺带做——第 4 步本来就要动 `packages/ui` 的测试与依赖。

---

## 附：每一步的验证方式

| 步骤 | 可重复的验证产物 |
|---|---|
| 1 | 新会话首轮工具集 == 次轮的 E2E；修复后 `PHANERIS_DEBUG=1` 日志中 `Synced N session + M source tools` 出现在 `Building proxy tools` **之前** |
| 2 | `guarded-refinement-workflow.ts` + 徽章断言；弹窗文案快照 |
| 3 | `decision-governance-workflows.ts` + 新增标注夹具的离线重放报告 |
| 4 | `validate:ci` 绿 + `bundle:report` 基线对比 |
| 5 | 第 1 步 E2E 仍绿 + `validate:ci` 绿 + bundle 体积不退化 |
| 6 | 各改造项的专项门禁（webui 无 Electron 依赖检查、主题 token 比对）+ 第 1 步 E2E 回归 |

**仓库既有约定**（[AGENTS.md](../../AGENTS.md) Testing 一节 + `docs/verification/`）：**先写"所有可能失败的方式"，再写代码**。既有 `*-failure-matrix.md` 就是这一约定的产物。第 1、2、3 步都应先落一份 failure matrix 再动手——尤其第 1 步，它的失败面（并发调用者、子进程重启、模式切换、工具集热更新）恰好是竞态类问题最容易漏测的部分。
