# 打包卫生与死配置面：实施前故障矩阵

状态：故障方式于实施前写定（2026-10-11）。批次 D、E 已实施；第 4 节为覆盖记录。

源码基线：`61970997`（工作树另有批次 A–C 的改动未提交）。

范围依据：[系统清理与优化计划](../process/system-cleanup-optimization-plan-2026-10-10.md) 批次 D、E。

## 1. 实施前核实的事实

| 事实 | 证据 |
| --- | --- |
| `playground.html` 是**打包**输入，产物无人引用 | `apps/electron/vite.config.ts:71`；`index.html` 中出现 `playground` 0 次 |
| 它白占产物：752 KB JS + 1.8 MB source map | `apps/electron/dist/renderer/assets/playground-*` |
| 所有验证脚本都从 **dev server** 取 playground，而不是 dist | 默认 `http://localhost:5173`；`scripts/verification/dialog-footer-spacing.mjs:237` 明确报 "dev server never served" |
| `main.cjs` 已达 20.27 MiB（21,253,281 字节），而预算是 25 MB | `scripts/bundle-report.ts:52`；实测 |
| katex 的唯一**急切**路径是 `Markdown.tsx:3` 的静态 `rehype-katex` | 直接 `import katex` 的 `MarkdownLatexBlock` 已是 `React.lazy`（`Markdown.tsx:18`） |
| `AGENT_EVENTS` 13 个成员中只有 5 个有 emitter | `emitAutomationEvent` 调用点：`pi-agent.ts:1439`（PostToolUse/PostToolUseFailure）、`:1508`（PreToolUse）、`:2502`（UserPromptSubmit）、`:2950`/`:2973`（Stop） |
| 现有校验对所有 agent 事件都只警告"match conditions only"，暗含 matcher 会触发 | `packages/shared/src/automations/validation.ts:62` |
| 语义警告被 `validateAutomationsConfig` **丢弃** | 同文件 `:41` 传入 `[]`；只有 `validateAutomationsContent`（`:267`）传出 warnings |

## 2. 要成立的判据

- **I-D1**：生产渲染产物不包含 playground，且 dev server 仍能提供它。
- **I-D2**：`main.cjs` 预算高于今天的体积、但任何真实增长都会失败。
- **I-D3**：katex 的处置有明确结论与触发条件，不留"以后再说"。
- **I-E1**：`UNEMITTED_AGENT_EVENTS` 与代码里实际存在的 emitter 集合一致，由门禁而非人工维护保证。
- **I-E2**：用户为一个无 emitter 的事件配置自动化时，得到的是"它永远不会运行"，而不是"match conditions only"。

## 3. 失败方式与要求

| ID | 触发/故障方式 | 要求 | 证据 |
| --- | --- | --- | --- |
| FD01 | 移除 playground 打包入口后，某个验证脚本或开发者工作流失效 | dev server 路径不受影响；`vite dev` 仍提供 `/playground.html` | 构建后 dist 无 playground；脚本仍指向 dev server |
| FD02 | 移除入口后**初始图**意外变化（共享 chunk 重新分配） | 变化必须被测量并记录，不得默默发生 | 前后 `bundle:report` |
| FD03 | 棘轮设得低于当前体积，门禁立刻变红 | 棘轮必须高于今天；构造一次"增长"证明它会咬合 | `--check` 通过 + 人为调低上限时失败 |
| FD04 | 棘轮说明只写在代码里，文档仍宣称 15 MB 目标已达成 | 性能文档必须写清"目标未达成、现为棘轮" | 文档更新 |
| FD05 | 把 katex 移出初始图需要改渲染路径，却被当成"清理"顺手做掉 | 本轮只评估；结论与触发条件入档 | 本文件 §4 |
| FE01 | 新增一个词表成员却没有 emitter，又一个"可配置但永不触发" | 门禁失败并指名该成员 | mutation：注入 `NeverEmitted` |
| FE02 | 有人实现了某个 emitter，但 `UNEMITTED_AGENT_EVENTS` 未同步 | 门禁失败，要求删掉对应警告项 | 反方向 mutation |
| FE03 | 警告文案只对无 emitter 的事件生效，已实现的事件仍用旧文案 | 两个方向都有测试，且先证明旧行为下测试为红 | `validation.test.ts` 的 red→green 记录 |
| FE04 | 门禁靠扫描字符串，漏掉动态 emitter（`hookEvent` 三元表达式） | 解析标识符的赋值来源，把两个字面量都计入 | `pi-agent.ts:1439` 的两个事件被正确识别为已实现 |

## 4. 实施后的覆盖记录

| ID | 已运行证据 | 覆盖限制 |
| --- | --- | --- |
| FD01 | 移除入口后 `electron:build:renderer` exit 0；dist 中 `playground.html` 与 `playground-*` 资源均消失；dist 由 104 MB 降至 101 MB | 未在真实 `vite dev` 会话中打开 playground 页面（脚本默认指向 :5173，本环境未起 dev server） |
| FD02 | **初始图由 89 个 chunk / 4.12 MB 变为 71 个 / 4.08 MB**：playground 作为入口时会把共享依赖拆成主入口也要预加载的 chunk | 未测启动耗时变化 |
| FD03 | `bun run bundle:report --check` 通过（21,253,281 < 21,500,000）；`PHANERIS_MAX_MAIN_BYTES=1000000` 时失败 | 未验证 CI 中该环境变量的覆盖行为 |
| FD04 | 性能文档已加入 2026-10-10 更新段，明确"目标未达成，现为棘轮"与 katex 结论 | — |
| FD05 | katex 结论入档：唯一急切路径是静态 `rehype-katex`；移出需要把 markdown 插件改为异步加载，属渲染路径改动，需单独的前后启动测量 | 未实测移出后的收益，因此也没有承诺收益 |
| FE01 | mutation 注入 `NeverEmitted` → 门禁报两条失败并非零退出；已回滚 | 只覆盖 agent 事件；app 事件（LabelAdd 等）走 scheduler/label 路径，未纳入本门禁 |
| FE02 | 门禁在 `UNEMITTED_AGENT_EVENTS` 缺项、多项、或与基线数量不符时都会失败 | — |
| FE03 | 两个测试在旧行为下均为红（已记录），改后为绿；`validation.test.ts` 33 pass / 0 fail | 只断言 message 文案，不断言 UI 呈现 |
| FE04 | `pi-agent.ts:1439` 的 `hookEvent` 三元表达式被解析，`PostToolUse` 与 `PostToolUseFailure` 均计为已实现 | 只支持"标识符 ← 字面量赋值"这一种间接形态 |

## 5. 验证产物约定

前后 `bundle:report`、dist 文件集合差异、门禁的两个方向 mutation、`validation.test.ts` 的 red→green 记录。结果归档到 `docs/verification/results/bundle-hygiene/`；产物清单与重跑命令见[验收说明](./results/bundle-hygiene/README.md)。
