# 依赖与声明清理：实施前故障矩阵

状态：故障方式于实施前写定（2026-10-10）。批次 C 未实施；第 4 节在实施后回填。表中是**要求**，不是通过证据。

源码基线：`61970997`（工作树另有批次 A、B 的改动未提交）。

范围依据：[系统清理与优化计划](../process/system-cleanup-optimization-plan-2026-10-10.md) 批次 C；清理清单来自 [dependency-graph-2026-10-06.md](../dependencies/dependency-graph-2026-10-06.md) §7/§8。

## 1. 实施前核实的事实

| 事实 | 证据 |
| --- | --- |
| 基线锁条目 **2066** 条 | `bun.lock` 的 `packages` 键数 |
| 基线 bundle：renderer 4.12 MB / main.cjs 20.27 MB / pi 13.36 MB | `bun run bundle:report` |
| 18 条零引用声明全部仍被声明且已安装 | 逐条定位见 §2 |
| `incr-regex-package` **不是**纯死声明：`mode-manager.ts:64` 导入 `IREGEX`（`DONE`/`MORE`/`FAILED` 导入但从未使用），`analyzePatternMismatch` 实现于 `:893`，调用点 `:1268`/`:1398` | 被移除前必须先有本地替换 |
| `analyzePatternMismatch` 的行为由测试钉住 | `packages/shared/tests/mode-manager.test.ts:1273-1340` |
| `temporal-polyfill` 是**必需 peer**，不是死依赖 | `@fullcalendar/core` 与 `@fullcalendar/react` 的 `peerDependencies` 均要求 `^1.0.1`；真正实现 `@full-ui/headless-calendar/index.js` 引用了它，且该包已安装；`apps/electron` 声明了 `@fullcalendar/react` |
| `@tiptap/extension-text-style` 是**必需 peer** | `@tiptap/extension-file-handler` 的 `peerDependencies` 要求 `3.31.4`，而 `packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx:9` 导入了 file-handler |
| `@tiptap/extension-bubble-menu` 是 `@tiptap/react` 的 **optionalDependency**（同版本） | `node_modules/@tiptap/react/package.json`；根声明冗余，且无人直接导入（`TiptapBubbleMenus.tsx:3` 从 `@tiptap/react/menus` 取） |
| `postcss` 是 vite 的依赖；仓库内无 `postcss.config.*`，源码无 import | `node_modules/vite/package.json` 的 `dependencies.postcss` |
| `concurrently` 不在任何 npm script 中 | `Object.entries(pkg.scripts)` 过滤结果为空；命中项均为注释或第三方 bundle 内容 |
| 26 条未声明的跨包子路径导入全部指向 `@phaneris/shared` | `scripts/architecture-baseline.json` |
| `packages/shared` 现有 74 条 `exports`，风格是逐路径显式声明 | `packages/shared/package.json` |

**因此 18 条中只有 16 条可删**，`temporal-polyfill` 与 `@tiptap/extension-text-style` 是 peer 提供者，删掉会破坏 peer 契约。audit 文档把这两条当作纯零引用，属分类错误，本文以证据为准。

## 2. 要成立的判据

- **I-C1**：`analyzePatternMismatch` 的对外契约（`matchedPrefix` / `failedAtPosition` / `failedToken` / `suggestion`）在移除 `incr-regex-package` 后仍然成立，且识别不了的 pattern 被跳过而不是抛错。
- **I-C2**：每条被删的声明，其包在删除后仍不被任何源码、脚本或构建配置引用（或由其它声明/穿透依赖提供）。
- **I-C3**：`bun install --frozen-lockfile` 成功，锁文件与清单一致。
- **I-C4**：跨包导入要么走声明的 `exports`，要么在基线中；`packages/shared` 新增的 `exports` 每条都指向真实存在的文件。
- **I-C5**：行为与体积不退化：`bundle:report` 不增长，`typecheck:all`、`test:shared:all`、renderer 构建通过。

## 3. 失败方式与要求

| ID | 触发/故障方式 | 要求 | 证据 |
| --- | --- | --- | --- |
| FC01 | 替换 `incr-regex-package` 后，`git -C /path status` 不再产出诊断或产出错误诊断 | 三条既有断言仍通过：`matchedPrefix` 以 `git` 开头、`failedToken === '-C'`、建议含 `flag` | `bun test packages/shared/tests/mode-manager.test.ts` |
| FC02 | 替换实现后，`git push origin` 的 `failedToken` 变成 `origin` 而非 `push`（位置算错） | `matchedPrefix` 含 `git`、`failedToken === 'push'` | 同上 |
| FC03 | 替换实现后，完全未知的命令产生了诊断（原本应为 `undefined`） | `unknowncmd arg` 仍无 `mismatchAnalysis` | 同上 |
| FC04 | 替换实现后，消息格式化回归 | `formatBashRejectionMessage` 输出仍含 `Matched:` 与 `Failed at:` | 同上 |
| FC05 | 移除 peer 提供者（`temporal-polyfill`、`@tiptap/extension-text-style`），peer 契约被破坏 | 两者**保留**并在本文记录理由；不得为凑数字而删 | 见 §1；删除后需有反证才可改判 |
| FC06 | 删除的声明其实被源码/脚本/构建配置引用，只是 grep 口径不对（动态 import、字符串拼接、脚本内联） | 逐条确认零引用；不能只依赖一次性 grep | 每条的命令与结果记入第 4 节 |
| FC07 | 清单改了但锁文件没更新 | `bun install --frozen-lockfile` 成功 | 该命令退出码 0 |
| FC08 | 版本范围对齐改变了实际解析版本，进而改变行为或体积 | 对齐前后记录解析版本与 `bundle:report`；体积不增长 | 锁文件差异 + bundle 报告 |
| FC09 | `webui` 的 `vite` 移入 devDependencies 后，某种安装方式（`--production`）导致 webui 构建缺工具 | 确认构建/CI 路径不依赖 production-only 安装；`bun run webui:build` 仍通过 | 构建退出码 |
| FC10 | 补声明（`server-core` → `session-tools-core`、`viewer` → `shared`）后 workspace 图或锁文件声明不一致 | `identity:check`、`version:check`、`bun install --frozen-lockfile` 通过 | 命令退出码 |
| FC11 | 3 个 `import 'vitest'` 的测试被直接删除，静默丢失覆盖 | 优先改成 `bun:test` 并跑通；只有确无价值才删，且记录判断 | 转换后测试运行结果 |
| FC12 | 为 `packages/shared` 新增的 `exports` 指向不存在的文件，使原本靠穿透解析成功的导入反而失败 | 新增的每条路径都实际存在；`typecheck:all` 通过 | 逐条存在性检查 |
| FC13 | 为让门禁变绿而整体刷新 architecture 基线，把规则 1 的既有条目也一并改写 | 只允许规则 2 的条目减少；规则 1 的 3 条保持不变 | 基线 diff |
| FC14 | 删除依赖后 `lint`/构建才暴露的隐式使用（例如经 `@phaneris/ui` barrel 或 vite 插件配置） | 全套可执行门禁通过 | `lint`、`typecheck:all`、renderer 构建、`test:critical` |
| FC15 | 锁条目降幅被报告成审计文档估算的 101，而实际更低（4 条为 peer/optional，其中 2 条保留） | 报告**实测**降幅，并说明与文档估算的差异 | 前后锁条目计数 |

## 4. 实施后的覆盖记录

全部证据见[验收说明](./results/dependency-declaration-cleanup/README.md)。

| ID | 已运行证据 | 覆盖限制 |
| --- | --- | --- |
| FC01 | `packages/shared/tests/mode-manager.test.ts` 433 pass / 0 fail（替换后） | 未逐一枚举 `readPatternExpectation` 无法归约的 pattern 形态 |
| FC02 | 同上：`git push origin` 的 `failedToken` 仍为 `push` | — |
| FC03 | 同上：`unknowncmd arg` 仍无 `mismatchAnalysis` | — |
| FC04 | 同上：消息仍含 `Matched:` / `Failed at:` | — |
| FC05 | 两者保留并记录理由（`declarations.json`）；证据是 `@fullcalendar/core`/`react` 与 `@tiptap/extension-file-handler` 的 `peerDependencies`，以及 `@full-ui/headless-calendar` 对 temporal-polyfill 的引用 | **未做**"删掉后构建失败"的反证：一次真实安装才能判定 bun 是否会自动补 peer，而安装被 CDN 阻塞 |
| FC06 | 逐条 grep 确认零引用；另把 16 个包从 `node_modules` 移走后重跑 `mode-manager.test.ts` 与 shared `tsc --noEmit`，均通过 | 隐藏实验对传递依赖无效（见验收说明）：`postcss` 被移走会让 renderer 构建失败，但那是因为 vite 自身依赖它，真实安装必然提供 |
| FC07 | `bun install --frozen-lockfile` **0.54 秒**通过 | 只证明 lock 与清单一致；不证明孤儿条目已清理 |
| FC08 | 对齐前后 `bundle:report` 完全一致（4.12 / 20.27 / 13.36 MB）；两个 exact pin 改 caret 后解析版本未变（仍为 10.1.0 / 3.7.0） | `main.cjs` 与 pi bundle 本批次未重建，只重建了 renderer |
| FC09 | `bun run webui:build` 通过；`vite` 在 devDependencies 中保留 `^8.3.2` | 未验证 `--production` 安装下的构建路径 |
| FC10 | `identity:check`、`version:check`、`--frozen-lockfile` 均通过；两条 workspace 边已写入 lock | — |
| FC11 | 三个测试改为 `bun:test` 后 **10 pass / 0 fail**（26 个 expect）——此前从未运行过 | 未判断它们是否覆盖了应覆盖的路径 |
| FC12 | 声明脚本对每个目标做存在性检查（含 `.ts` 与 `/index.ts` 两种形态），4 个目录型子路径因此被正确解析；`typecheck:all` 通过 | — |
| FC13 | 基线 diff 只有规则 2：26 → 0；规则 1 保持 3 条不变 | — |
| FC14 | `validate:ci` 完整通过（沙箱限制解除后复跑，含 `test:doc-tools` 24 tests OK）、`test:critical` exit 0、renderer 构建通过 | 未在 Windows/Linux 上复跑 |
| FC15 | 实测降幅 **0**（2066 → 2066），与审计估算的 101 不同；原因与后续动作见验收说明 | 孤儿条目要等一次真实 resolve 才会被清理 |

## 5. 验证产物约定

- 前后各一次 `bundle:report`（renderer / main / pi）。
- 前后锁条目计数与清单版本解析差异。
- 每条被删声明的零引用证据（命令 + 结果）。
- `mode-manager.test.ts` 的运行日志。
- 更新后的 `scripts/architecture-baseline.json` 及其 diff。

结果归档到 `docs/verification/results/dependency-declaration-cleanup/`。
