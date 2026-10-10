# 系统清理与优化计划

计划日期：2026-10-10（Asia/Shanghai）
源码基线：`61970997`；工作树另有 2 个未提交文件（`docs/verification/results/packaged-client-smoke.json`、`packaged-client-verification.json`）
状态：**A、B、C、D、E、F、H 已实施（2026-10-11）**；G 待批且另立一波。本文其余部分保留规划时的核实结果；A、B 的实施产出见[故障矩阵](../verification/theme-and-architecture-gate-failure-matrix.md)与[验收说明](../verification/results/theme-architecture-gate/README.md)，C 见[故障矩阵](../verification/dependency-declaration-cleanup-failure-matrix.md)与[验收说明](../verification/results/dependency-declaration-cleanup/README.md)。实施中修正了本文多处判断，见 §7。

关系：[Durable Runtime 边界实施设计](../architecture/durable-runtime-boundary.md) 已按 B0–B5 完成执行所有权迁移；本文承接它，处理它留下的**证据层**问题。本文修正并部分取代[四条工作流的排序规划](./workstream-sequencing-2026-10-06.md)（第 1 步已落地、第 5 步已由边界工程完成、第 2/3 步的 4 项仍 open，见 §2.6）。

---

## 0. 结论先行

Durable Runtime 独立改变的是**所有权层**，并留下仓库里复用价值最高的一个门禁资产：`scripts/check-runtime-boundary.ts`（118 行，Babel 解析，覆盖 type import / dynamic import / barrel / `@/` 别名，已接入 `lint` → `validate:ci` 与 `test:critical`）。

剩下的问题集中在**证据层**：门禁有的红了、有的缺了，而计划文档在两个方向上同时与代码脱节。因此本轮的方向不是再做一次大搬家，而是**让地图重新等于地形，再用已建成的门禁锁住它**。

| # | 批次 | 性质 | 证据强度 | 量级 | 状态 |
|---|---|---|---|---|---|
| **A** | 把红掉的基线弄绿（主题三源合一 + 接门禁） | 正确性 / 归因前提 | 本地已复现 | 0.5–1 天 | **已实施** |
| **B** | 把 boundary checker 升级为 architecture gate | 防回归（杠杆最高） | 静态核实 | 1–2 天 | **已实施** |
| **C** | 落地已审计的依赖清理 | 确定性收益 | 逐条 grep 核实 | 1–2 天 | **已实施**（声明层面） |
| **D** | 打包卫生（playground / 预加载图 / main.cjs 预算） | 可量化 | 已实测 | 1 天 | **已实施** |
| **E** | 关闭死配置面（AutomationEvent 无 emitter） | 产品诚实性 | 静态核实 | 0.5–1 天 | **已实施**（门禁 + 精确警示） |
| **F** | 安全三项 + 缺失回归 | 风险最高 | 静态核实 | 2–3 天 | **已实施** |
| **G** | 下一个结构切口（`storage.ts` / `pi-agent-server`） | 长期可维护性 | 需先立所有权表 | 1–2 周 | 待批（另立一波） |
| **H** | 文档基线刷新（可与其他并行） | 让文档重新可当索引 | 已定位 | 0.5 天 | **已实施** |

**建议先做 A+B 一波**：A 让"当前是否正常"重新可判定，B 让已经修好的东西不会再漂回去；两者互相加强，且都不改变产品行为。

---

## 1. 核实方法

本文不接受任何计划文档的自述状态。对所有"仍然 open"的结论，均回到源码逐条核实（`grep` + `read` + `git log`/`git show`），并使用以下口径：

- **已复现**：在本机运行了对应命令并观察到失败。
- **静态核实**：读代码 + 提交历史；未运行时验证。这类结论标注为"代码级"。
- **未证实**：明确标注，不代替证据。

`docs/README.md` 的状态列本身是自述状态，不作为证据。

---

## 2. 核实结果

### 2.1 【红】`test:critical` 挂在 3 个主题断言上

**已在 macOS 复现**（`bun test ./src/config/__tests__/theme.test.ts`，`13 pass / 3 fail`）：

```text
(fail) theme resolution > bundles exactly the four canonical, valid themes
(fail) theme resolution > keeps the bundled default resource synchronized with the canonical snapshot
(fail) theme resolution > keeps static CSS palettes, typography and material tokens synchronized with Default
```

根因链已追到提交级：

| 环节 | 事实 |
|---|---|
| 引入漂移的提交 | `ad8d8915`（`chore(release): prepare Phaneris 0.3.1`） |
| 该提交改了什么 | `packages/shared/src/config/theme.ts:524`（`fontSans`）与 `:526`（`fontMono`）换成含 `"Inter Variable"` / `"Noto Sans SC Variable"` / `"HarmonyOS Sans SC"` / `"MiSans"` 的长栈 |
| 该提交**没**改什么 | `apps/electron/resources/themes/default.json`（仍为旧短栈；它是 `apps/electron/scripts/validate-assets.ts:27` 声明的必需打包资源）；`apps/electron/src/renderer/index.css` 是第三种写法 |
| 同一提交的说明 | "The font stacks collapse from seven hand-copied definitions to `packages/ui/src/styles/typography.css`, **with DEFAULT_THEME kept in step by the new gate**" |
| 现实 | 那个 gate 就是现在红着的这个 |

**三处声明当前互不一致**（已实测）：

| 位置 | 内容 |
|---|---|
| `packages/shared/src/config/theme.ts:524` | 展开成字面量：`-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Inter Variable", … "Source Han Sans SC", …` |
| `apps/electron/resources/themes/default.json` | 旧短栈：`"Inter"`（非 Variable），缺全部 CJK Variable 回退 |
| `packages/ui/src/styles/typography.css:53,55,59` | 用 `var(--font-cjk)` 间接引用——**这就是注释说"byte-identical"却不成立的原因** |
| `apps/electron/src/renderer/index.css:424` / `:435` | 另两种写法（`html[data-font="inter"]` / `html[data-font="system"]`；属刻意覆盖，但从未在测试里说明） |

另有一处自相矛盾：`theme.ts:517-522` 的注释写"keep byte-identical to the `:root` block in `packages/ui/src/styles/typography.css`"，而 `typography.css:55` 用的是 `var(--font-cjk)`。**注释本身也是错的。**

**加重情节：** 同一个断言已存在于 [`scripts/verification/default-theme-preview-workflow.ts:40`](../../scripts/verification/default-theme-preview-workflow.ts)（`assert.deepEqual(JSON.parse(readFileSync('apps/electron/resources/themes/default.json')), DEFAULT_THEME_FILE)`），但**没有接入任何门禁**（`grep default-theme-preview package.json .github/workflows/*.yml` 无命中）。所以只有 `test:critical` 抓到了它——而上一个提交的说明把它记成了"same three baseline theme-consistency failures"。

> 门禁一旦被这样正常化，后续所有改动都失去归因能力。这是本批次排在第一位的原因。

**顺带纠正**：[overview.md §10](../architecture/overview.md) 第 2 行"两套主题源头……**没有检查比对两者**"已不准确——检查在 `packages/shared/src/config/__tests__/theme.test.ts` 中已存在并已接门禁（`.github/workflows/validate.yml:110`、`scripts/test-critical.ts`），只是当前是红的。该行需要改写而不是删除。

### 2.2 依赖清理：§8 全部未应用，18 条声明一条不少

依据 [dependency-graph-2026-10-06.md](../dependencies/dependency-graph-2026-10-06.md) §7/§8，逐条 grep 核实（排除 `node_modules`/`dist`/`.build`/`.cache`/`.verify`/`release`/`apps/electron/packages`/`apps/electron/release`）：

| 结论 | 事实 |
|---|---|
| 总量 | **18 条死声明全部仍在**，且全部仍被安装；文档估算的 **101 个锁节点（−6.2%）** 依然完整有效 |
| `incr-regex-package`（独占 47 节点） | **不是删声明**：仍被 `packages/shared/src/agent/mode-manager.ts:64` 导入，`analyzePatternMismatch` 实现于 `:893`，调用点 `:1268`/`:1398`。需先写本地前缀匹配替换，再删（文档 §8 P0 已给出方向） |
| 4 条其实是 peer/optional | `@tiptap/extension-bubble-menu`（`@tiptap/react` 的 optionalDependency）、`@tiptap/extension-text-style`（`extension-file-handler` 的 peer）、`postcss`（vite 传递依赖）、`temporal-polyfill`（FullCalendar 的 peer）→ **实际节省低于文档的边际数字** |
| 归属修正未做 | `packages/server-core/package.json` 缺 `@phaneris/session-tools-core`（源内 3 处 import）；`apps/viewer/package.json` 缺 `@phaneris/shared`（`src/main.tsx:5`）；`apps/webui/package.json:23` 的 `vite` 仍在 `dependencies` |
| 版本范围 | 文档所列 5 组分歧全部仍在（`ws`、`@tailwindcss/typography`、`class-variance-authority`、`react-markdown`、`tailwind-merge`） |
| 不可运行的测试 | `packages/ui` 下 3 个 `import 'vitest'` 的测试仍在，而 vitest 在全仓任何 `package.json` 与 `node_modules` 中都不存在 |

**文档自身两处错误**（实施时须修正文档而非照抄）：`packages/ui` 的 `@tiptap/*` 幻影依赖是 **12** 个（文档写 13）；`temporal-polyfill` 被当作纯死依赖，实际是 peer 提供者。

### 2.3 打包卫生（已实测）

`bun run bundle:report` 在本机的结果：

| 产物 | 实测 |
|---|---|
| renderer 初始图 | **4.12 MB raw / 1.23 MB gzip，89 个 chunk** |
| `main.cjs` | **20.27 MB raw / 5.38 MB gzip**（文档目标 15 MB） |
| `pi bundle` | 13.36 MB raw |

具体项：

| 项 | 事实 |
|---|---|
| 生产产物携带 dev-only 工装 | `apps/electron/dist/renderer/assets/playground-*.js` **≈752 KiB** + `playground-*.css` 4 KiB；`index.html` 零引用。源头是 `apps/electron/vite.config.ts:71` 把 `playground.html` 列为构建入口 |
| 研究文档已过期一半 | [docs/README.md](../README.md) 的 GPUIX 行称其"两项零风险工作未做"，其中"约 683 KB 死 ProseMirror"**已经修好**：编辑器现为懒加载的 `TiptapMarkdownEditor-*.js`（686 KiB），`main`/`src` chunk 内 `prosemirror` 命中为 **0**，其 CSS 也已隔离。只剩 playground 这一半（该行已在本次评估中同步修正） |
| 启动图碎片化 | 89 个预加载 chunk 中 **47 个小于 5 KiB**，合计仅 65.6 KiB——请求/解析开销换不到载荷收益 |
| 条件依赖进入预加载图 | `katex`（≈256 KiB）在初始 modulepreload 列表中，而数学渲染是条件性的 |
| 预算形同虚设 | `scripts/bundle-report.ts` 的 `--check` 预算为 renderer 4.8 MB / `main.cjs` 25 MB，因此 20.27 MB 静默通过；文档里的 15 MB 目标无人执行 |

### 2.4 安全：按默认配置即成立的三项（静态核实）

| 问题 | 证据 | 影响 |
|---|---|---|
| **认证 limiter 全局锁死** | `packages/server-core/src/webui/auth.ts:161`（`maxGlobalAttempts = 20`）、`:178-179`（先递增再全局判定）；`packages/server-core/src/webui/http-server.ts:198`（`new RateLimiter(5, 60_000)`）、`:257`（`check(ip)` 在 `:276` 的 `verifyPassword` 之前） | 约 21 次未认证 `POST /api/auth` / 分钟 → 对**所有人**返回 429；成功登录也消耗同一计数器。这是 DoS，不是限流 |
| **server token 每次启动原样打 stdout** | `packages/server/src/index.ts:332`；`apps/electron/src/main/index.ts:1397-1400` | 把 RPC 凭据泄进容器 / journald / CI 日志。CLI 本来就持有 token（`apps/cli/src/server-spawner.ts:68`，注释 `:109-111` 明示），所以这个打印纯属多余 |
| **未认证路由无请求体上限** | `packages/server-core/src/webui/node-adapter.ts:52-66`；`http-server.ts:267` | 未认证的 `/api/auth`、`/api/oauth/callback` 无限缓冲 → 内存耗尽。WS 侧有 `transport/server.ts:284,300,318,410` 的上限，HTTP 侧没有 |

其余（同为静态核实）：

- cookie 名仍是上游的 `craft_session`（`auth.ts:85`），无 `__Host-` 前缀、`Path=/`；
- trusted-proxy 是**潜伏**缺陷：`http-server.ts:207-215` 直接信任 `x-forwarded-for`，但全仓无调用方设置该选项（`:150`、`:195`、`:202`），因此今天不可达；一旦有人开启，会同时污染 per-IP 键并放大上面的全局锁死；
- Origin 校验完全不存在，唯一缓解是 `SameSite=Strict`（`auth.ts:91`）——对 bearer 客户端无保护意义，但也不是独立可利用点；
- JWT 注销撤销是进程内的（`auth.ts:32`、`:44-47`、`:64`），重启后 24h 内旧 cookie 复活；
- 缺的回归测试正好是这 5 项（现有 `http-server.isolated.ts` 的 limiter 用例只打 6 次，低于 20 的全局阈值，所以锁死路径**从未被测**）。

### 2.5 死配置面：`AutomationEvent` 宣传了不会触发的事件

`packages/shared/src/automations/types.ts:40` 起：`AGENT_EVENTS` 声明 13 个生命周期钩子，其中约 7 个（`Notification`、`SessionEnd`、`SubagentStart`、`SubagentStop`、`PreCompact`、`PermissionRequest`、`Setup`）在词汇表与匹配器之外**没有任何 emitter**。

用户据此可以配出永远不会运行的自动化，而文档在宣传这个能力（[agentic-interception-design.md](./agentic-interception-design.md) 已把"8/13 事件无 emitter""文档宣传 no-op"记为 live defect）。

**仓库已有可复制的模式**：`packages/shared/src/protocol/routing.ts` 的穷尽性测试——新增 channel 未分类即 CI 失败。给 `AutomationEvent` 加同样的门禁即可永久关掉这类问题。

### 2.6 文档与代码双向脱节

**A. 描述成 open、实际已修（文档过期）**

| 文档 | 实际 |
|---|---|
| [plugin-system-review-and-roadmap.md](./plugin-system-review-and-roadmap.md)：3 个 P0 记为 open | 已在 `c89614a5` 修好（`install.ts` 的 stage-then-swap、`paths.ts:5-9,34-37` 的 slug 校验、`install.ts:780-789` 的卸载阻断）。**但留了 2 个真 residual**：`install.ts:477-484` 的备份清理在 `try` 内，`rmSync` 失败会回滚一次成功安装，且 `:498-499` 在备份已删的情况下直接删 `targetDir` 而不恢复；凭据清理没有延后（`packages/shared/src/sources/storage.ts:151-152,160-177`）。另外 P0-3 的新抛错无测试覆盖 |
| [workstream-sequencing-2026-10-06.md](./workstream-sequencing-2026-10-06.md) §1.1：`ensureSubprocess` 竞态是"最强约束" | 已由 `722a2c0f` 修好；`packages/shared/src/agent/pi-agent.ts:532-542` 现在 `await` 完整的 `subprocessStartup`（即该文档 §2 第 1 步的"方向 A"），门禁为 `scripts/verification/pi-110-startup-workflow.ts` |
| [overview.md](../architecture/overview.md) §10 第 4 行：Pi SDK 实际 1.0.2 | 全部已是 **1.1.0**（`packages/shared/package.json:93-95`、`packages/pi-agent-server/package.json:17-21`、`packages/server-core/package.json:31`、根 `package.json:171-172`；`docs/guides/pi-kernel.md:7,21` 与 `apps/electron/README.md:26` 均已更新）。只剩 §10 自己这一格还写着 1.0.2 |

**B. 描述成完成、实际仍 open**

| 文档 | 实际 |
|---|---|
| workstream-sequencing 第 2 步（Guarded 低争议修正） | 4 项**全部仍 open**：`mode-manager.ts:471-472` 注释仍与 fail-closed 实现矛盾（实现见 `packages/server-core/src/decisions/guarded-mode.ts:219-227,233,235-243`）；`risks` 徽章通道仍在（UI `PermissionRequest.tsx:34,70-72`）而 Guarded 仍不填 `risks`（`guarded-mode.ts:238-244`），独立填充路径被默认关闭的 `riskBadges` 门住（`SessionManager.ts:4961,4964-4971`、`packages/shared/src/decisions/settings.ts:122`）；`Execute:` 前缀仍与 `allow-all` 的 `displayName` 撞名（`guarded-mode.ts:135`、`packages/shared/src/agent/core/pre-tool-use.ts:1102`、`packages/shared/src/agent/mode-types.ts:400-401`） |
| workstream-sequencing 第 3 步（Guarded 判定夹具） | **不存在**：`guarded-refinement-workflow.ts:11-15` 仍用固定 `.01`/`.99` 应答驱动，`scripts/verification/` 内无 risk-level 夹具、无 `$(` 用例、无 `expectedRisk` 符号。`GUARDED_MODE_RISK_THRESHOLD` 仍为 0.8（`guarded-mode.ts:18`） |
| [product-development-directions-2026-09-19.md](./product-development-directions-2026-09-19.md) 两项遗留 | 均 open：`TaskRunner.ts:203` 的 `AUTONOMOUS_DEFAULT_MODE = 'allow-all'` 兜底仍在（应用于 `:572`，被 `TaskRunner.test.ts:249-260` 钉住；`packages/shared/src/config/storage.ts:161` 也把它列入默认可循环模式）；completion-rate 指标不存在（全仓无 `completionRate`/`verifiedCompletion` 符号） |

**C. overview.md 自身在边界工程后已过期**（该文档标注"最后核对 2026-10-06"）

| 行 | 现况 |
|---|---|
| `:33` | SessionManager 写 11,385 行，实际 **11,322**；且"编排中枢"低估了新边界——`scripts/check-runtime-boundary.ts:87-93` 已禁止 SessionManager 调用 `chat`/`redirect`/`forceAbort`/`interruptForHandoff`/`disposeForRestart`、改运行状态或触碰 `messageQueue` |
| `:35`、`:129` | 分层图未提 Runtime Host：`packages/server-core/src/durable-runtime/execution/host.ts:63`（`class RuntimeHost`，在 `api/runtime.ts:86` 实例化）；`:29` 的"server-core · Runtime Host"其实已经写对了 |
| `:102` | server-core 子目录表缺 `runtime-adapters/`；注意没有 `server-core/src/execution/`，`execution/` 嵌在 `durable-runtime/` 下 |
| `:214` | §4 第 ⑤ 步指向 `shared/agent/backend/internal/drivers/pi.ts`（该文件仍在，故不为假），但 durable 路径现在是 `runtime-adapters/pi-driver.ts` |
| `:404` | 附:验证方式应补 `execution/host.ts` 与 `runtime-adapters/` |
| `:386-393` | §10 第 2 行见 §2.1；第 4 行见上文 A |

**未过期**：`:286` 的 "schema v4" 正确（`packages/server-core/src/durable-runtime/store.ts:15`）。

**D. §10 中确认仍然成立、且**没有**门禁的漂移**

| 项 | 证据 | 门禁 |
|---|---|---|
| webui 与 electron 无 API 边界 | `apps/webui/tsconfig.json:41-44` include 了 electron renderer 源码；`apps/webui/vite.config.ts:44` 把 `@` 指向该树；`:85` 的 `IS_WEBUI` 唯一读取点 `apps/electron/src/renderer/lib/platform.ts:41`；Node 内建被 shim（`vite.config.ts:66-77`）所以新 Node import 会静默解析 | **无**。`scripts/build-smoke.ts:8-11` 只跑 `webui:build` 不做产物断言；`bundle-report.ts` 不覆盖 webui；无任何测试引用 `apps/webui/src` |
| bootstrap 顺序隐式契约 | 赋值在 `apps/webui/src/App.tsx:19,115-116`（不在 `main.tsx`） | 无 |
| `@phaneris/core` 描述失真 | `packages/core/package.json:5` 声称 storage 与 agent logic；`src` 实为 16 个文件、只有 `types/` 与 `utils/` | 无（`check-docs.ts` 不校验 description） |
| 陈旧 CSS glob | `apps/electron/src/renderer/index.css:14` 与 `apps/webui/src/index.css:11` 指向不存在的 `renderer/tabs/` | 无 |

---

## 3. 批次规划

每个批次实施前须按仓库约定先落对应 failure matrix（`docs/verification/`），再改产品代码。**A、B 不改产品行为**，是后续所有批次的归因前提。

### 批次 A — 把基线弄绿（0.5–1 天）

| 内容 | 出口条件 |
|---|---|
| 让三处字体声明一致：以 `typography.css` 为单一来源，同步 `theme.ts` 与 `apps/electron/resources/themes/default.json`（后者是必需打包资源）；修正 `theme.ts:517-522` 那句不成立的 "byte-identical" 注释；在测试里显式声明 `index.css` 的 `data-font` 变体是刻意覆盖 | `test:critical` 全绿；4 个 theme 断言通过 |
| 把已存在的断言接进门禁：`scripts/verification/default-theme-preview-workflow.ts:40` 目前游离在门禁之外 | 人为改坏 `default.json` 能让门禁失败 |
| 记录一次可重跑证据（命令 + 输出 + 基线 SHA） | 产物落 `docs/verification/results/` |

### 批次 B — 把 boundary checker 升级为 architecture gate（1–2 天）

复用 `scripts/check-runtime-boundary.ts` 的规则引擎，把 §2.6-D 里"确认成立且无门禁"的漂移逐条变成可失败规则：

1. **webui 不得触达 Electron/Node-only 模块**（对应 overview §10 第 1 行，今天的最高价值缺口）；
2. **跨包深层导入归零**——边界工程 B5 已声称 runtime 侧为零，把它升格为全局不变量；
3. **主题声明一致性**——把批次 A 的约束固化成静态检查，而不是只留在测试里；
4. 视情况纳入：`@phaneris/core` 描述与实际内容的一致性、陈旧 `@source` glob 的存在性。

入口与产物沿用上一轮：接入 `lint` → `validate:ci`，并为每条规则留下"故意违规会让门禁失败"的 mutation 证据（`results/durable-runtime-boundary/gate-mutations.json` 已是现成格式）。

### 批次 C — 依赖清理（1–2 天）

按 §2.2 执行，顺序为：先替换 `incr-regex-package` 的使用（本地前缀匹配）再删声明；其余 17 条逐条删除并核实；补齐 3 处缺失归属声明；对齐 5 组版本范围；处理 3 个不可运行的 vitest 测试。

**出口条件**：`validate:ci` 绿 + 前后各一次 `bundle:report` 对比 + 记录实际锁节点降幅（并接受低于 101 的真实数字，因为 4 条是 peer/optional）。

### 批次 D — 打包卫生（1 天）

playground 从生产构建入口移除（`apps/electron/vite.config.ts:71`）；评估把 `katex` 移出初始预加载图；合并过小 chunk；把 `main.cjs` 预算从 25 MB 收到文档目标或正式退休该目标并更新文档。

**出口条件**：`bundle:report` 前后对比；`dist/renderer` 中不再存在无引用入口。

### 批次 E — 关闭死配置面（0.5–1 天）

给 `AutomationEvent` 加 emitter 穷尽性门禁（照抄 `routing.ts` 的模式）。每个无 emitter 的成员二选一：补实现，或从词汇表、UI 与文档中删除。不允许保留"可配置但永不触发"的状态。

### 批次 F — 安全三项 + 缺失回归（2–3 天）

按 §2.4 的优先级：全局 limiter 拆成 `canAttempt` / `recordFailure` / `recordSuccess`；token 打印改为显式 opt-in（CLI 已持有 token，删除不影响它）；给未认证 HTTP 路由加请求体上限。附带处理 cookie 命名与潜伏的 trusted-proxy 缺陷。

**出口条件**：先写 failure matrix（含"21 次未认证请求后正常用户仍能登录""token 不出现在 stdout""超限请求体被拒"等场景），再改代码，再补这 5 项回归测试。

### 批次 G — 下一个结构切口（1–2 周）

对象：`packages/shared/src/config/storage.ts`（3,395 行 / 121 个 export，混装 config 读写、偏好访问器、workspace CRUD、remote token、凭据迁移、主题与会话存储）与 `packages/pi-agent-server/src/index.ts`（2,844 行）。两者都是 workstream-sequencing 决策 3 自己划出的"纯后端、回归成本低、可作后续独立小批次"。

做法照抄 2026-10-10 的边界工程：**先所有权表 → 先 failure matrix → 先后禁 → 再移动 → 独立运行证据**。不是把 SessionManager 再拆一遍。

### 批次 H — 文档基线刷新（0.5 天，可并行）

修正 §2.6 列出的全部过期结论。

**本次评估已顺手完成的部分**（只动索引文字，不动产品代码）：`docs/README.md` 的 GPUIX 行（已改为"死代码那半已修，只剩 language-neutral schema"）、plugin roadmap 行（已改为"三个 P0 实际已在 `c89614a5` 修好，文档过期"并指回本文 §2.6）、workstream-sequencing 行（已改为"第 1 步已落地、第 5 步由边界工程取代"），以及新增本文的索引行。

**仍待做**：overview.md 的 `:33`/`:35`/`:102`/`:129`/`:214`/`:389`/`:404` 与 §10 第 2、4 行；plugin roadmap 正文（两个 residual 与已修 P0 的状态）；workstream-sequencing 正文第 1 步与第 2/3 步的状态；[dependency-graph-2026-10-06.md](../dependencies/dependency-graph-2026-10-06.md) §7 的两处计数错误（`@tiptap/*` 是 12 不是 13；`temporal-polyfill` 是 peer 提供者）。

**更根本的一条**：本次评估必须回到源码才能判断"到底还剩什么"，说明计划文档已不能当索引用。建议给结论性表格加"核实于 `<commit>`"标注；`check:docs` 只能保证链接有效，保证不了结论为真。

---

## 4. 每批次的验证方式

| 批次 | 可重复产物 |
|---|---|
| A | `test:critical` 的运行日志 + 基线 SHA；人为改坏资源文件后门禁失败的记录 |
| B | 每条规则各一份"故意违规 → 门禁失败"的 mutation 记录 |
| C | `validate:ci` 通过日志 + 前后 `bundle:report` + 实际锁节点降幅 |
| D | 前后 `bundle:report`；`index.html` 引用集合与 `dist` 实际文件集合的差集为空 |
| E | 穷尽性门禁的运行记录；无 emitter 成员的处理决定逐条留档 |
| F | failure matrix（先写）+ 5 项新增回归测试通过记录 |
| G | 所有权表、failure matrix、门禁记录、独立运行/恢复证据（与 B0–B5 同格式） |
| H | `check:docs` 通过 + 修正后的结论与源码一致 |

---

## 5. 明确不做

沿用 [durable-runtime-boundary.md](../architecture/durable-runtime-boundary.md) §11 与 [target architecture](../architecture/durable-agent-runtime-target-architecture.md) 的激活条件：

- 九服务重拆、`shared` 包拆分；
- 第二个 agent 后端、分布式执行 / lease / fencing；
- 自动 length 续跑（continuation supervisor）；
- 未测 parity 的读模型切换；
- GPUIX 原生前端迁移（[研究结论](../research/native-frontend-migration-gpuix-assessment.md) 未采用任何路线）；
- 把 SessionManager 的剩余行数当作验收指标。

---

## 6. 未证实事项

- 本文所有安全结论均为**代码级**核实，未构造真实网络暴露场景验证可利用性。
- 依赖清理的实际锁节点降幅未实测；§2.2 已指出 4 条为 peer/optional，真实收益会低于文档估算的 101。
- 打包优化对启动时间的实际影响未测量；`bundle:report` 只反映字节数，不反映加载时间。
- 批次 G 的工作量（1–2 周）是量级估计，未做逐文件依赖分析。

---

## 7. 实施 A、B 时修正的判断

写失败矩阵的过程推翻或收窄了本文原先的两处结论，按仓库约定以证据为准，不改旧结论以外的表述：

**7.1 §2.1 的严重性被高估了：这不是"用户看到的字体错了"。**

实测确认 `apps/electron/resources/themes/*.json` **没有任何运行时读者**——`loadPresetTheme`（`packages/shared/src/config/storage.ts:1644-1650`）对内建 ID 直接返回 `BUILTIN_THEMES[id]`，而 `getBundledAssetsDir('themes')` 在当前源码中零调用（旧的上游 `ensurePresetThemes()` 只留在被 gitignore 的构建产物里）。`apps/electron/resources/AGENTS.md` 也明确写着这些文件是"Four read-only built-ins … never copied into the user-owned themes directory"。

所以用户看到的 Default 字体一直是对的。真正的缺陷收窄为三条：一个被打包、被两个打包验证流程断言为不变量、又被测试守护的**重复来源**漂移了；守护它的断言写成了与既有设计矛盾的形式；CI 因此长期为红。修法相应地从"改产品字体"变成"让重复来源一致 + 把断言改成真正的不变量"。

**7.2 §3 批次 B 的 B4 原方案会造成重复实现，已改为接线。**

原方案要让 architecture gate 静态重做一遍主题一致性检查。但批次 A 已经把该不变量放进 `theme.test.ts`，再写一份就有两个实现可能给出不同结论（故障矩阵 FB11）。改成：主题规则只保留一处，把它接进 `validate:ci`——`test:shared:config` 现在包含 `theme.test.ts`，于是 pre-push 钩子就会执行它。`test:critical`（含该测试）此前**不在** `validate:ci` 里，这正是它能红着进入 main 的原因。

**7.3 实施中新增的三个发现**（均不在原计划内，记录待批）：

| 发现 | 证据 | 建议归属 |
| --- | --- | --- |
| `apps/electron/src/renderer/playground/registry/generate-icons.ts` 在 webui 会 type-check 的树里 import `fs`/`path`/`url`，但它是无人 import 的独立脚本 | 从 webui 入口出发的 1011 模块闭包不含它；全仓无导入者 | 批次 D（与 playground 出生产构建同批处理） |
| architecture gate 首次运行即发现 3 处 webui 闭包内未 shim 的 Node/Electron 导入（`electron`、`node:module`、`node:readline`）与 26 处未声明的跨包子路径导入 | `scripts/architecture-baseline.json`；26 条已在批次 C 还清并归零 | 规则 1 的 3 条随批次 D 评估 shim；规则 2 已完成 |
| `test:critical` 会就地重写 `docs/verification/results/durable-runtime-boundary/` 的已归档证据，本地跑一次即把 Windows 记录替换成 macOS 产物 | 本次已两次还原该批文件为 HEAD | 独立小批次：运行产物落忽略目录，仅明确归档时提升为记录 |

**7.4 批次 C 实施中修正的判断**（详见[批次 C 故障矩阵](../verification/dependency-declaration-cleanup-failure-matrix.md) §1）：

| 原计划 | 实际 |
| --- | --- |
| §3 批次 C 列了 18 条可删声明 | **只有 16 条可删**。`temporal-polyfill` 与 `@tiptap/extension-text-style` 是必需 peer 提供者（`@fullcalendar/*` 与 `@tiptap/extension-file-handler` 的 `peerDependencies`），删掉会破坏 peer 契约。audit 文档把这两条当纯零引用，属分类错误 |
| §2.2 记"20 条其实是 peer/optional → 实际节省低于文档的边际数字" | 更准确：其中 2 条**根本不应删**；`postcss` 由 vite 传递提供（`vite@8.3.2` 声明 `postcss: ^8.5.28`）所以可删；`@tiptap/extension-bubble-menu` 与 `@dnd-kit/helpers` 等确为死声明 |
| §3 批次 C 出口条件"记录实际锁节点降幅" | 实测降幅为 **0**（2066 → 2066）。删声明只改清单与 lock 的 `workspaces` 段；孤儿 `packages` 条目要等一次真实 resolve 才会被清理，而本环境的 resolve 被 `overrides.xlsx` 指向的 `cdn.sheetjs.com` 阻塞（实测 6–17 KB/s）。用 `bun install --frozen-lockfile`（0.54 秒）验证了 lock 与清单一致 |
| §3 批次 C"对齐 5 组版本范围分歧" | 只对齐了 exact-pin 漂移（`packages/server` 的 `ws`、`apps/viewer` 的 `react-markdown` 与 `tailwind-merge`）。`packages/ui` 的 `>=` peer 范围**未收窄**：该包可发布，peer 范围是外部契约而非风格选择 |
| §3 批次 C 未提"26 条未声明子路径" | 在本批一并还清：`packages/shared` 的 `exports` 从 74 条增至 100 条，architecture gate 规则 2 基线归零 |

---

## 8. 批次 D、E、F、H 的实施结果（2026-10-11）

故障矩阵与证据：[打包卫生与死配置面](../verification/bundle-hygiene-and-event-surface-failure-matrix.md) · [服务端安全加固](../verification/server-security-hardening-failure-matrix.md)；产物见 [bundle-hygiene](../verification/results/bundle-hygiene/README.md) 与 [server-security-hardening](../verification/results/server-security-hardening/README.md)。

| 批次 | 结果 | 与计划的差异 |
| --- | --- | --- |
| **D** | playground 移出打包输入：dist 104 MB → **101 MB**，并**顺带把初始图从 89 个 chunk / 4.12 MB 降到 71 个 / 4.08 MB**（playground 作为入口时会把共享依赖拆成主入口也要预加载的 chunk）。`main.cjs` 预算 25 MB → **21.5 MB 棘轮**，并已用人为调低上限验证它会咬合 | 计划里的"katex 出初始预加载图"**评估后不做**：唯一急切路径是 `Markdown.tsx:3` 的静态 `rehype-katex`（直接 `import katex` 的组件已是 `React.lazy`），移出需要把 markdown 插件改为异步加载，属渲染路径改动 |
| **E** | `AGENT_EVENTS` 13 个成员中只有 5 个有 emitter；新增门禁让"词表 ↔ emitter"双向一致，并让用户配到无 emitter 的事件时被告知**它永远不会运行**（原文案只说 "match conditions only"，暗含 matcher 会触发） | 计划要求"补实现或删除"。两者都不是清理：补实现是 Pi 生命周期钩子的功能工作，删除会破坏既有用户配置。因此改为**让缺口不再沉默**：门禁 + 精确警示 + 基线台账，8 个成员保留 |
| **F** | 三项默认问题全部修复：限流只由失败消耗（成功登录不再消耗预算、拒绝发生在 argon2 之前）、token 打印改为 `PHANERIS_PRINT_SERVER_TOKEN=1` 显式开启、未认证路由 256 KB 上限（声明长度前置拒绝 + 边读边限以防分块绕过）；附带 cookie 改名 `phaneris_session`（**读时兼容旧名**，改名不会登出）与 trusted-proxy 直连对端校验；新增 6 项回归 | 计划附带的 cookie 命名与 trusted-proxy 已一并处理。**未做**：Origin 校验、JWT 撤销持久化、密钥轮换、`__Host-` 前缀——均已记入证据文档的覆盖限制 |
| **H** | overview.md 的 §0/§1/§2/§4 过期行、§10 第 2/4 行与"最后核对"日期已刷新；dependency-graph §7 的两处计数与分类错误已更正 | — |

**仍待批：批次 G。** 它是 `storage.ts`（3,395 行 / 121 个 export）与 `pi-agent-server/src/index.ts`（2,844 行）的结构切口，量级 1–2 周，需要和 runtime boundary 同样的方法（所有权表 → 失败矩阵 → 门禁 → 迁移 → 独立证据）。把它和 D–F 混在一轮里做会同时失去两者的归因能力，因此另立一波。
