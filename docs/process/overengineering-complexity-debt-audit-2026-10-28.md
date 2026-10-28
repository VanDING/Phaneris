# Phaneris 历史过度工程化与复杂度债务审计（只读）

日期：2026-10-28（Asia/Shanghai）
状态：只读审计完成。审计阶段未修改源码、测试、CI、配置或文档；本文件及 `docs/README.md` 索引为审计后单独生成的报告载体，后续清理需单独授权。
源码基线：`bcfbabf6b`（HEAD，v0.5.1，`codex/session-foundation`）。工作树在审计期间持续变化（审计阶段结束时 69 modified / 15 untracked）；涉及工作树文件的引用以 HEAD 行号为准，并标注 `HEAD:`。

## 结论摘要

- 没有证据表明“整个 durable runtime / T1–T2 / 投影 / 恢复机制”是过度工程。它们有 ADR、失败矩阵和真实故障驱动，属于**必要复杂度**。
- 确认 **8 项**复杂度债务，集中在四类：生产代码中的验证专用写路径（2）、验证与门禁自造的双份状态（2）、单后端抽象残留（1）、迁移与状态恢复的补丁叠加（3）。
- 其中 **4 项**可以独立、安全地删除或简化；**2 项**可独立处理但需评审；**2 项**只建议冻结/收敛，不建议直接删。
- 另有 **4 项**证据不足，仅标记，不建议现在动。
- 审计阶段未修改任何文件；本报告及 `docs/README.md` 索引为审计后新增。

## 一、审计范围与口径

| 项 | 内容 |
|---|---|
| 仓库快照 | `E:\Phaneris`，HEAD `bcfbabf6b`（v0.5.1，`codex/session-foundation`） |
| 历史范围 | 723 commits，2026-01-19 至 2026-10-27；相对 `upstream/main` 领先 618、落后 12 |
| 重点路径 | `packages/pi-agent-server`、`server-core` durable runtime / SessionManager / runtime-adapters、`shared` sessions/config/agent backend、`ui` trajectory、`scripts/verification`、CI/hooks、`docs/verification` |
| 提交审查 | 全量 723 条元数据；259 条涉及 12 个高风险路径的提交做主题/足迹筛查；18 条关键提交逐条核对，其中 12 条查看 diff 统计或补丁 |
| 代码阅读 | 约 45 个文件全文或关键段落；覆盖调用关系、测试、CI、配置、文档 |
| 未覆盖 | upstream 分叉前历史；messaging-gateway、i18n、主题视觉系统的完整实现；安全审计；真实 provider 行为；运行时性能采样；2,251 个文档仅按索引/主题抽样 |
| 工作树状态 | 审计期间工作树持续变化：开始时 55 modified / 14 untracked，审计阶段结束时 69 / 15。涉及修改文件的行号以 HEAD 为准 |

> 行数、文件数、MB 只用于估算清理面，不作为“应该删除”的理由。下面每一条都先追溯设计目的和当前用途。

## 二、统计

| 指标 | 数值 |
|---|---|
| 提交总数 | 723 |
| 高风险路径相关提交 | 259 |
| 重点核对提交 | 18（其中 12 条看 diff） |
| 确认问题 | 8 |
| 待确认问题 | 4 |
| 可独立安全删除/简化 | 4 |
| 可独立但需评审 | 2 |
| 只建议冻结/收敛 | 2 |
| 验证工作流 | 186 个文件 / 29,951 行 |
| 锁定进 critical CI 的工作流 | 65 |
| 已跟踪验证证据 | 1,733 文件 / 76.8 MB（磁盘含未跟踪共 1,805 / 78.8 MB） |
| 文档 | 2,251 文件 / 129.8 MB |
| Git pack | 627.4 MB |

前次 [defensive-code-test-cleanup-2026-10-17.md](defensive-code-test-cleanup-2026-10-17.md) 已处理 A01–A09 的明显冗余，并保留 C01–C05 为待确认；本次不重复报告这些已关闭项，只报告仍未闭环或新出现的债务。

### 裁定分类

| 分类 | 项目 |
|---|---|
| 明确冗余 | S1、S2、S4 |
| 政策冲突 / 未完成清理 | S3 |
| 自造门禁复杂度 | S5 |
| 无变化抽象 | S6 |
| 重复实现 | S7 |
| 历史合理但已过时的补丁叠加 | S8 |
| 确有必要、不建议简化 | 第四节 |
| 证据不足 | P1–P4 |

## 三、证据清单（按建议处理顺序）

### S1. 只写不读的 projection parity 观测表

**类型：明确冗余（运行时遥测）**

- **证据**
  - 写入：[SessionManager.ts:2812](../../packages/server-core/src/sessions/SessionManager.ts#L2812) 的 `applyDurableRecoveryStatus`，在每次 session hydrate 时调用 `recordProjectionParity`（HEAD 行号；工作树已改动）。
  - 存储：[store.ts:616](../../packages/server-core/src/durable-runtime/store.ts#L616) 的 `recordProjectionParity`、[:836](../../packages/server-core/src/durable-runtime/store.ts#L836) 的 `projection_parity_observations` 表。
  - 读取：同文件 [:644](../../packages/server-core/src/durable-runtime/store.ts#L644) 的 `listProjectionParity`。全仓唯一读取者是 [store.test.ts:232](../../packages/server-core/src/durable-runtime/store.test.ts#L232)，**没有产品调用者**。
  - 设计说明：[projection-audit.ts:85](../../packages/server-core/src/runtime-adapters/projection-audit.ts#L85) 明确写的是 “for logging and a future parity dashboard”。
  - 相关提交：`ad39313ab`（durable runtime cutover）、`90210d53a`（boundary refactor）。
- **设计目的**：canonical facts 与 legacy JSONL/UI cache 的 rollout parity 观测，为 dashboard/error budget 提供数据。
- **当前用途**：canonical read 已默认启用；没有 dashboard、没有查询 API、没有产品读取者。`reportLegacyProjectionParity` 本身仍被 [pi-driver.ts:80](../../packages/server-core/src/runtime-adapters/pi-driver.ts#L80) 和 SessionManager 用于读切换判断，不能删；可删的是“把结果写进表”和产品侧无调用的 `listProjectionParity`。
- **冗余证据**：每次 session 载入多一次 SQLite upsert；表会随 cursor 增长；读侧从未实现；`listProjectionParity` 只有测试读取。
- **删除风险**：低。若存在外部 SQL 报表直接读该表，需要先确认；否则保留表、停止写入即可，下一次 schema 迁移再 drop。
- **建议**：删除 `recordProjectionParity` 调用与 `listProjectionParity`（连同其单测）；保留 parity 计算函数用于读安全判断；如需历史观测，改为显式诊断命令，不要放在生产 hydrate 路径。
- **置信度**：高。

### S2. 生产路径中的 usage-ledger 审计是测试专用载荷

**类型：明确冗余（测试专用生产代码）**

- **证据**
  - [coordinator.ts:765](../../packages/server-core/src/durable-runtime/coordinator.ts#L765)：`recordSdkObservation` 在 `agent_settled` 时扫描该 run 的全部事件（10k 分页），调用 `auditModelUsage`，把结果塞进 `sdk_observation` 的 payload。
  - [model-usage-audit.ts:1](https://github.com/VanDING/Phaneris/blob/1910533062d8c33e1f57b7b58b2eba967bc9914f/packages/server-core/src/durable-runtime/model-usage-audit.ts#L1)：审计实现，明确注释 “Persistence parity only”。
  - 唯一代码读取者：[upgrade-0153-usage-ledger-workflow.ts:273](../../scripts/verification/upgrade-0153-usage-ledger-workflow.ts#L273)、[coordinator.test.ts:51](../../packages/server-core/src/durable-runtime/coordinator.test.ts#L51)。
  - 该工作流在 [:260](../../scripts/verification/upgrade-0153-usage-ledger-workflow.ts#L260) 和 [:822](../../scripts/verification/upgrade-0153-usage-ledger-workflow.ts#L822) 自述：主会话在该 harness 配置下不产生 `agent_settled` 观测，工作流自行合成该观测。
  - 该工作流被 [critical-scenarios.ts:117](../../scripts/critical-scenarios.ts#L117) 锁定进 CI。
  - 相关提交：`a604dd2b7`（observe native request evidence）、`d0fb6be7b` / `0c0a69d31`（upgrade 验收）。
- **设计目的**：验证 model outcome 与 usage ledger 的持久化一致性，服务计费/对账。
- **当前用途**：没有 UI、RPC、报表或恢复路径读取 `modelUsageAudit`；生产 path 即使收到 `agent_settled`，结果也只是写进不可消费的 payload。
- **冗余证据**：一个仅由 CI 工作流断言的字段，被放在生产 coordinator 的 settle 热路径上；工作流还明确说生产不提供该观测，等于用生产 API 造测试夹具。
- **删除风险**：低。把 `auditModelUsage` 移到验证工作流，或通过 `durable.queries.events/usage` 在测试侧重算即可；不需要 schema 迁移（payload 字段可保留为历史）。
- **建议**：生产不再计算/写入 `modelUsageAudit`；将 `auditModelUsage` 作为测试辅助函数保留；工作流改为读取 runtime 查询结果自行审计。
- **置信度**：高。

### S3. 已声明“不提交”的验证证据仍被跟踪

**类型：政策冲突 / 未完成清理（不是代码正确性问题）**

- **证据**
  - [.gitignore:92](../../.gitignore#L92)：“Verification outputs are generated locally and never committed. `docs/verification/results/`”。
  - 但 `git ls-files docs/verification/results` 仍有 **1,733 个文件 / 76.8 MB**；磁盘上 1,805 / 78.8 MB，56 个目录。
  - 工作树当前仍修改了已跟踪的 `docs/verification/results/packaged-client-smoke-win.json`、`packaged-client-verification-win.json`。
  - `ebc09b7ea`（2026-10-23）加入该 ignore 规则；`189ad152f` 已把九份 chrome run 合并为一份，但同类历史目录仍大量存在：`shell-visual*` 4 个目录 / 9.4 MB、`long-session-budget*` 5 个目录、`durable-runtime-continuity-final` 与 `-final-v2` 并存。
- **设计目的**：字节级保留验收证据，支持发布/审计追溯；后来决定本地生成、不入源码快照。
- **当前用途**：docs 索引主要指向 canonical run；大量历史目录是已被替代的运行副本。ignore 只影响新文件，已跟踪文件继续被修改。
- **冗余证据**：政策文本与实际跟踪状态直接矛盾；6 个结果目录在代码/文档中已无引用（`shell-visual-w2-launchers`、`shell-visual-w2c`、`long-session-budget-w1-before`、`-w1-ci`、`long-session-final`、`ui-primitives-final`，共约 5.5 MB）。
- **删除风险**：代码风险低；主要风险是文档链接和发布证据引用断裂。部分证据确实支撑 release/audit 结论，不能一概删除。
- **建议**：先明确政策。若 ignore 是当前意图：将结果目录改为 CI artifact/release 附件，仓库只保留 `manifest.json`、`README`/索引和必要摘要；逐步 `git rm --cached` 并修链接。若历史证据必须保留：删除 ignore 规则并明确保留期限，避免“声明不提交却继续修改”的灰色状态。
- **置信度**：高（不一致本身）；中（应选哪条政策）。

### S4. 死 atom、废弃 shim 与永久关闭的 feature path

**类型：明确冗余（死代码/兼容壳）**

- **证据**
  - HEAD 的 [sessions.ts:337](../../apps/electron/src/renderer/atoms/sessions.ts#L337)、[:356](../../apps/electron/src/renderer/atoms/sessions.ts#L356)、[:581](../../apps/electron/src/renderer/atoms/sessions.ts#L581)：`appendMessageAtom`、`updateStreamingContentAtom`、`syncSessionsToAtomsAtom`。`git grep HEAD` 显示零调用者；工作树 diff 已删除这三块（约 96 行）。
  - [skill-mention-menu.tsx:2](https://github.com/VanDING/Phaneris/blob/1910533062d8c33e1f57b7b58b2eba967bc9914f/apps/electron/src/renderer/components/ui/skill-mention-menu.tsx#L2)（9.1 KB）与 [skill-mentions.ts:2](https://github.com/VanDING/Phaneris/blob/1910533062d8c33e1f57b7b58b2eba967bc9914f/apps/electron/src/renderer/lib/skill-mentions.ts#L2)（1.7 KB）整文件标记 deprecated，零 import。
  - [source-guides.ts:195](../../packages/shared/src/docs/source-guides.ts#L195)、[:204](../../packages/shared/src/docs/source-guides.ts#L204)、[:218](../../packages/shared/src/docs/source-guides.ts#L218)：三个只 `return null` 的 deprecated 查询函数，仅被 [docs/index.ts:180](../../packages/shared/src/docs/index.ts#L180) 再导出。
  - [unified-network-interceptor.ts:371](../../packages/shared/src/unified-network-interceptor.ts#L371)–[:427](../../packages/shared/src/unified-network-interceptor.ts#L427)：`upgradePromptCacheTtl` 明确“no longer invoked by modifyRequest”，只被单测使用。
  - [feature-flags.ts:99](../../packages/shared/src/feature-flags.ts#L99)：`fastMode: false` 常量；[unified-network-interceptor.ts:434](../../packages/shared/src/unified-network-interceptor.ts#L434) 直接 `if (!FEATURE_FLAGS.fastMode) return false`，整条 fast-mode 路径不可达。
  - [migrations.ts:317](../../packages/shared/src/config/migrations.ts#L317)：`modelEntryForDefault` 恒等包装。
  - [ddg.ts:633](../../packages/pi-agent-server/src/tools/search/providers/ddg.ts#L633)：`DDGSearchProvider` 仅为源码兼容的别名，内部无调用。
- **设计目的**：混合 React state + Jotai atom 的流式隔离方案；上游/旧 API 兼容；未启用的 fast mode；历史迁移辅助。
- **当前用途**：均无运行时消费者。atom 方案已被 event processor 取代；skill mention 已由 `mention-menu.tsx`/`mentions.ts` 取代。
- **冗余证据**：零调用、零 import、不可达分支。行数只说明清理面，真正证据是调用图为空。
- **删除风险**：低。注意 `skill-mention-menu` 被 `scale-drift` 基线计数，删除需要 `scale:generate` 更新；`source-guides` 是 shared 公共子路径，若存在外部插件消费者则不应删，但本仓库为 private monorepo，未发现消费者。
- **建议**：分两批删除：先删 atom 与两个 skill-mention 文件（工作树已开始），再删 null stub / test-only TTL / fastMode 死路径 / 恒等包装；不新增门禁，只做调用图核验。
- **置信度**：高。

### S5. critical scenario 双份清单 + 自指 CI 元门禁

**类型：自造复杂度（测试门禁）**

- **证据**
  - [critical-scenarios.ts:37](../../scripts/critical-scenarios.ts#L37) 定义 65 个 `criticalWorkflows`；[critical-scenario-policy.json](https://github.com/VanDING/Phaneris/blob/1910533062d8c33e1f57b7b58b2eba967bc9914f/scripts/critical-scenario-policy.json) 是同样 65/6/2 条目的 20.5 KB 副本。
  - [check-governance.ts:80](../../scripts/check-governance.ts#L80)–[:85](../../scripts/check-governance.ts#L85) 对两份清单做 `deepEqual`。
  - [markdown-popout-card-failure-matrix-2026-10-12.md:19](../verification/markdown-popout-card-failure-matrix-2026-10-12.md#L19) 的 MP13 把这个失败模式记录为“新 workflow 只登记执行 registry，遗漏锁定 policy，导致 pre-push/CI 拒绝”——根因正是双份清单本身。
  - [check-governance.ts:17](../../scripts/check-governance.ts#L17)–[:73](../../scripts/check-governance.ts#L73) 进一步断言 `.github/workflows/validate.yml` 的 job 名、精确 `if` 字符串、命令、shell、artifact pin；[package.json:107](../../package.json#L107) 的 `lint` 每次 pre-push/CI 都运行它。
  - 仓库没有 CODEOWNERS（`.github` 仅 6 个文件），双份清单由同一作者同一提交维护，没有独立评审 separation。
- **设计目的**：防止 CI 门禁被静默削弱；强制新 critical workflow 被登记。
- **当前用途**：pre-push/CI 每次执行；实际效果是“改一处必须改两处”，而不是独立验证。
- **冗余证据**：两份 20 KB 清单完全同构；meta-gate 是 CI YAML 的第二份表示，改名/重排会误报，命令变成 no-op 时反而可能通过；MP13 是典型的“自己制造失败模式，再加门禁检测”。
- **删除风险**：中。直接删 policy 会失去“必需 workflow 不得被移除”的保护；但可以用单一来源 + 必需条目哈希替代。
- **建议**：把 policy 变成从 `critical-scenarios.ts` 生成的产物，或直接删除 policy，改为锁定“必需 id 的最小哈希/数量”；`check-governance` 只保留语义不变量（`validate:ci`、`test:critical` 存在，无 `continue-on-error`，artifact 必传），不要精确匹配 job 名和命令字符串。若确实需要双人复核，加 CODEOWNERS，而不是双份 JSON。
- **置信度**：高（重复与自指）；中（简化后的净收益）。

### S6. 单后端残留的 provider registry / driver 抽象

**类型：无变化抽象（历史合理，现已过时）**

- **证据**
  - [models.ts:114](../../packages/shared/src/config/models.ts#L114)：`export type ModelProvider = 'pi'`；[types.ts:65](../../packages/shared/src/agent/backend/types.ts#L65)：`AgentProvider = ModelProvider`。
  - [factory.ts:52](../../packages/shared/src/agent/backend/factory.ts#L52)：`DRIVER_REGISTRY: Record<AgentProvider, ProviderDriver> = { pi: piDriver }`。
  - [:54](../../packages/shared/src/agent/backend/factory.ts#L54)–[:60](../../packages/shared/src/agent/backend/factory.ts#L60)：`getProviderDriver` 的“unknown provider”分支在类型上不可达。
  - [:166](../../packages/shared/src/agent/backend/factory.ts#L166)：`getAvailableProviders()` 恒返回 `['pi']`；[:176](../../packages/shared/src/agent/backend/factory.ts#L176) 的 `isProviderAvailable` 全仓无调用者。
  - [:192](../../packages/shared/src/agent/backend/factory.ts#L192)：`providerTypeToAgentProvider(providerType)` 忽略参数，恒返回 `'pi'`。
  - [:488](../../packages/shared/src/agent/backend/factory.ts#L488)：`BACKEND_CAPABILITIES` 只有一个 `pi` 条目；[:504](../../packages/shared/src/agent/backend/factory.ts#L504) 的 `getDefaultAuthType` 只有一个 case。
  - [:531](../../packages/shared/src/agent/backend/factory.ts#L531)–[:543](../../packages/shared/src/agent/backend/factory.ts#L543)：跨 provider 守卫注释称“防止把 Claude 模型发给 Pi”，但 `ModelProvider` 只有 `pi`，`getModelProvider` 对已知模型返回 `'pi'`、未知模型返回 `undefined`，该分支永远不会清除模型。
  - 架构不变量：[overview.md:376](../architecture/overview.md#L376) “只有一个 agent 后端”；CLAUDE.md 同样明确。
  - 相关提交：`bbd38d4bd`（2026-07-27 “migrate: single Pi SDK backend”）、`3af56acfa`（“consolidate constant provider dispatch helpers”）。
- **设计目的**：从 Claude SDK + Pi 双后端迁移时保留 driver seam，便于未来扩展。
- **当前用途**：所有路径最终只创建 `PiAgent`；没有第二个 driver，也没有测试注入 registry 的入口。
- **冗余证据**：类型只有一个成员、registry 只有一个条目、capability 只有一个条目、`isProviderAvailable` 零调用、跨 provider 守卫不可达。23 KB 的 factory 里连接解析是真实职责，不能整文件否定；冗余的是 provider dispatch 这一层。
- **删除风险**：中。调用点和测试夹具较多，属于机械但面广的重构；不是一行删除。
- **建议**：分两步：先删除零调用导出（`isProviderAvailable`）、`getAvailableProviders` 循环、`getDefaultAuthType` switch、`resolveModelForProvider` 的 provider 参数与死守卫；再评估是否把 `DRIVER_REGISTRY` 折叠为直接 `piDriver`。保留 `ProviderDriver` 仅当它确实隔离了 Pi SDK 的构建/运行时细节。
- **置信度**：高（冗余）；中（安全删除的范围）。

### S7. 冷/热两条 Session hydration 路径重复，且 recovery 被重复调用

**类型：重复实现（状态恢复）**

- **证据**
  - HEAD [SessionManager.ts:2291](../../packages/server-core/src/sessions/SessionManager.ts#L2291) `hydrateMessagesForColdPersist` 与 [:2777](../../packages/server-core/src/sessions/SessionManager.ts#L2777) `loadMessagesFromDisk` 都执行同一序列：`stored.messages → applyDurableRecoveryStatus → tokenUsage → applyDurableUsageProjection → recoverSessionQueue`；字段同步列表手工维护且不完全一致。
  - HEAD [:2812](../../packages/server-core/src/sessions/SessionManager.ts#L2812) `applyDurableRecoveryStatus` 先 `refreshRecovery`（[:2813](../../packages/server-core/src/sessions/SessionManager.ts#L2813)），再 `recoverSession`（[:2814](../../packages/server-core/src/sessions/SessionManager.ts#L2814)）；而 [host.ts:345](../../packages/server-core/src/durable-runtime/execution/host.ts#L345)–[:351](../../packages/server-core/src/durable-runtime/execution/host.ts#L351) 的 `recoverSession` 内部又调用 `refreshRecovery`。
  - 相关提交：`b31904c60`（v0.9.1）、`f4e172bf3`（v0.11.0）。
- **设计目的**：冷持久化路径需要同步恢复，避免 `persistSession` 触发异步加载；热路径要同步 metadata 字段。
- **当前用途**：两条都是生产热路径；字段列表已出现漂移风险。
- **冗余证据**：同一恢复/用量/队列序列两份实现；scope 已绑定时 `refreshRecovery` 连续执行两次（一次显式、一次经 `recoverSession`）。这是低层重复，不是恢复语义本身重复。
- **删除风险**：中。不能简单合并成一个 async 函数，否则冷持久化路径的同步语义会变；应提取共享的同步 helper，保留“是否同步 metadata”的参数。
- **建议**：提取 `restoreProductState(managed, stored, { syncMetadata })`；删除 `applyDurableRecoveryStatus` 里多余的 `refreshRecovery`（或让 `recoverSession` 接受“已 refresh”标志）；不要改 T1/T2/recovery 判定。
- **置信度**：高（重复）；中（安全重构）。

### S8. 启动迁移链的补丁叠加：12 个 phase、重复归一化、恢复 4.6

**类型：历史合理但已过时的兼容复杂度（不建议直接删）**

- **证据**
  - [migrations.ts:755](../../packages/shared/src/config/migrations.ts#L755)–[:891](../../packages/shared/src/config/migrations.ts#L891)：`migrateLegacyLlmConnectionsConfig` 的 12 个 phase。
  - 同一 `migrateLegacyOpusToDefaultOpus` 在 [:848](../../packages/shared/src/config/migrations.ts#L848)、[:861](../../packages/shared/src/config/migrations.ts#L861)、[:883](../../packages/shared/src/config/migrations.ts#L883) 被调用三次；顺序依赖 modelDefaults、provider 迁移和 Bedrock fallback。
  - [migrations.ts:394](../../packages/shared/src/config/migrations.ts#L394)–[:461](../../packages/shared/src/config/migrations.ts#L461)：`restoreOpus46ToAnthropicConnections`，marker 为 `opus-4-6-restored-2`；注释 [:388](../../packages/shared/src/config/migrations.ts#L388)–[:390](../../packages/shared/src/config/migrations.ts#L390) 说明旧 marker 已被上一轮 restore 消耗，必须再跑一次；[:392](../../packages/shared/src/config/migrations.ts#L392) 有 `TODO(opus-4.6-sunset)`。
  - 读时归一化已存在：[models.ts:99](../../packages/shared/src/config/models.ts#L99)–[:105](../../packages/shared/src/config/models.ts#L105) 的 `normalizeDeprecatedModelId`。
  - 相关提交：`e39f60cb2`（governance completion，加入 restore）。
- **设计目的**：不让用户在 provider/model 目录变更后丢失已保存的连接和模型选择。
- **当前用途**：每次启动在 `llmConnections` 已存在时执行；restore 只跑一次，但形状修复每次跑。
- **冗余证据**：读时归一化与启动时重写是两套机制；一个 restore 专门补偿此前的强制迁移；同一归一化重复三次，顺序不能随意调整。这不是“迁移不应该存在”，而是“每出现一个模型别名就再加一个 one-shot phase”的补丁模式。
- **删除风险**：高。直接删会改用户持久配置，不能作为清理动作。
- **建议**：冻结现有迁移，不再新增一次性 model-ID 重写；新别名只进 `normalizeDeprecatedModelId` 的读时映射；若要缩减，先加 characterization test 固化当前 12 phase 的输入/输出，再逐 phase 标记 sunset 条件。不要为了“看起来干净”重排顺序。
- **置信度**：高（补丁叠加模式）；中（债务严重度）。

## 四、确有必要、不建议简化的复杂度

这一节是为了避免“看到复杂就判冗余”。以下均有明确失败驱动，不建议作为清理目标：

1. **Durable runtime 的 T1/T2 与 fail-closed recovery**
   - [overview.md:316](../architecture/overview.md#L316)–[:327](../architecture/overview.md#L327) 定义了 operation 状态机和不盲目重放原则；[coordinator.ts:510](../../packages/server-core/src/durable-runtime/coordinator.ts#L510) 的 `recoverWorkspace` 在重启时只 park 不确定尾部。
   - 这是数据一致性和副作用安全的核心，不是“多层恢复”的冗余。

2. **SessionPersistenceQueue 的原子写、串行化、外部 metadata 合并**
   - `serializeWrite` / `performWrite` 中每个 guard 都对应真实故障：并发 `.tmp` 竞争、外部编辑覆盖、Windows 目录 fsync EPERM、崩溃时保留最后一份有效 JSONL。
   - 这类“防御”不能按行数简化。

3. **三个 `context-usage` 文件不是重复实现**
   - [pi-agent-server/context-usage.ts](../../packages/pi-agent-server/src/context-usage.ts)：子进程读取 SDK 原始值；
   - [shared/agent/context-usage.ts](../../packages/shared/src/agent/context-usage.ts)：宿主侧 normalize，统一 window/reserve；
   - [renderer/lib/context-usage.ts](../../apps/electron/src/renderer/lib/context-usage.ts)：badge 投影。
   - 同名但职责不同；合并反而会破坏 transport/host/renderer 边界。

4. **协议、路径、权限校验**
   - 前次审计的 D01 已裁定为必要保障；本次未发现可以安全删除的重复校验。不要因为“看起来有两层”就删掉 handler 侧防护。

## 五、待确认问题（只标记，不建议现在动）

| # | 事项 | 现有证据 | 需要什么才能裁定 |
|---|---|---|---|
| P1 | source activation 的 mixed-version 去重 | HEAD [SessionManager.ts:7135](../../packages/server-core/src/sessions/SessionManager.ts#L7135) 的 2 秒 pending slot；[source-activated-auto-retry.test.ts:14](../../packages/server-core/src/sessions/source-activated-auto-retry.test.ts#L14) 明确写 “v0.9.5 Electron client” | 当前支持的客户端版本政策；是否仍允许新 server + 旧 Electron 混跑。若不再支持，可删 pending slot/重复测试；若支持，应保留并写进兼容政策。 |
| P2 | durable session read 的 canary/rollback 开关 | HEAD [SessionManager.ts:2905](../../packages/server-core/src/sessions/SessionManager.ts#L2905) 的 `PHANERIS_DURABLE_SESSION_READ` / `PHANERIS_DURABLE_SESSION_CANARY`；仅 archived handoff 提及 | 运维是否真的使用该回滚路径；canary 列表是否曾使用。默认 canonical 已数月，canary 很可能是死配置，但 emergency rollback 可能仍需保留。 |
| P3 | 65 个 critical workflow 的覆盖与成本 | 65 个锁定；46 个无静态代码引用（其中 34 个只在文档中出现，12 个代码/文档都无引用；部分 session-* 由动态命名调用）；`upgrade-0153-*` 是 2026-10-18/19 的一次性升级验收 | 需要 coverage-to-workflow 映射和 CI 时长数据，才能判断哪些 `upgrade-0153-*` 可以退役。不要按文件名批量删。 |
| P4 | Run context 归因 / decision layer 的净收益 | `trajectory-context-accounting.ts` 是工作树新增未跟踪文件；[run-context-accounting-failure-matrix-2026-10-26.md:3](../verification/run-context-accounting-failure-matrix-2026-10-26.md#L3) 明确说旧的 proportional allocation 已被取代；decision layer 默认关闭 | 需要真实使用数据和当前 in-flight 重写的最终形态。现在评估会把“正在被替换的旧实现”误判为债务。 |

## 六、建议的下一步（等待选择，不修改文件）

按收益/风险，建议分成四个可独立评审的批次：

1. **批次 A（最低风险）**：S1 + S2。删除 projection parity 写入/死查询，把 usage audit 移到验证侧。两项都不改变读安全或恢复语义。
2. **批次 B（低风险）**：S4 的死代码清理。先删三个 atom 和两个 skill-mention 文件，再处理 null stub / test-only TTL / fastMode 死路径。
3. **批次 C（流程决策）**：S3 的证据政策 + S5 的单一 critical policy。先决定“证据是否入库”，再把双份清单收敛成一份，避免继续制造 MP13 类失败。
4. **批次 D（需评审）**：S6 的单后端 factory 折叠、S7 的 hydration helper。S8 只做“冻结 + 读时别名”政策，不删迁移。

如果只选一个，建议先做 **批次 A**：它不触碰恢复/权限/读切换，能直接去掉两条“生产代码为测试服务”的路径，且可用现有测试与一个 critical workflow 验证。

## 七、审计限制

- 工作树在审计期间持续变化（开始时 55 modified / 14 untracked，结束时 69 / 15）；涉及修改文件的行号以 HEAD 为准，并已标注。
- 未做运行时 profiling、CI 实际耗时统计、客户端版本盘点、外部 SQL/插件消费者调查；因此 S1/S2 的“无读取者”结论限定在**本仓库代码**，不排除外部运维脚本直接读 SQLite。
- 未完整审查 2,251 个文档、1,383 个 `packages` 文件、UI/主题/消息网关的全部实现；这些区域的结论是抽样，不是全量证明。
- 审计阶段没有修改源码、测试、CI、配置或文档；工作树中的改动不是本次审计产生的；本报告文件与 `docs/README.md` 索引为审计后新增。

## 附录：重点核对提交

以下 18 条提交用于追溯设计目的、变更足迹或补丁叠加；其中 12 条查看了 diff 统计/补丁，其余核对提交信息与文件足迹。

`90210d53a`、`ad39313ab`、`e39f60cb2`、`0c60d037e`、`6659a00a2`、`674c9de02`、`ab0282111`、`bc2f436a0`、`36aee5585`、`16c67e07d`、`a837aed8c`、`df9027c92`、`ebc09b7ea`、`189ad152f`、`8a5355a2d`、`bbd38d4bd`、`a604dd2b7`、`5c5c78fa1`。
