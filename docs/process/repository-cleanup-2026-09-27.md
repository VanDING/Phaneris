# 项目目录整理清单（2026-09-27）

状态：已执行（2026-09-27）。53 个文件已归位；4 处确认的临时残留及 2 个空目录已清理。

## 已完成的局部更新

- README 中英文版与 Pi 内核文档的当前版本改为 0.87.1，与 package.json、workspace manifests 及 bun.lock 一致。保留历史章节的旧版本。
- README 中英文版克隆指令统一使用已约定的 SSH 443，显式指定 Phaneris 目录，修正大小写敏感系统上的 cd 路径。

## 整理范围与目录职责

- apps/、packages/：产品源码和包内资源，保持既有 workspace 布局。
- scripts/verification/：从 plans/ 迁入可复用的浏览器探针与打包校验脚本。
- docs/verification/：验收规则、动效审计与实施状态；results/ 保存已有 JSON 证据。
- docs/prototypes/：自包含 HTML 原型。
- docs/assets/hero-demo/：完整保留现有设计截图与配套色板 HTML。
- docs/archive/：已明确标记为历史快照的根目录审计报告。
- docs/process/、docs/research/、docs/architecture/：保留现行决策、研究、架构分类；不把历史计划改写成当前事实。
- .cache/verification/：本地产生的验证日志，不入库。

## 逐文件迁移

迁移保留现有工作区内容，包括未提交修改和 Windows 验证结果；不从 HEAD 覆盖文件。

| 原路径 | 目标路径 |
| --- | --- |
| `AUDIT_REPORT.md` | `docs/archive/code-audit-2026-08-01.md` |
| `hero-demo/app-dark-zh.png` | `docs/assets/hero-demo/app-dark-zh.png` |
| `hero-demo/app-light-en.png` | `docs/assets/hero-demo/app-light-en.png` |
| `hero-demo/app-light-zh.png` | `docs/assets/hero-demo/app-light-zh.png` |
| `hero-demo/app-reduced-motion.png` | `docs/assets/hero-demo/app-reduced-motion.png` |
| `hero-demo/dark-zh-new.png` | `docs/assets/hero-demo/dark-zh-new.png` |
| `hero-demo/light-en-active.png` | `docs/assets/hero-demo/light-en-active.png` |
| `hero-demo/light-split.png` | `docs/assets/hero-demo/light-split.png` |
| `hero-demo/light-zh-new.png` | `docs/assets/hero-demo/light-zh-new.png` |
| `hero-demo/live-empty-session.png` | `docs/assets/hero-demo/live-empty-session.png` |
| `hero-demo/mark-default.png` | `docs/assets/hero-demo/mark-default.png` |
| `hero-demo/mark-graphite.png` | `docs/assets/hero-demo/mark-graphite.png` |
| `hero-demo/mark-ink.png` | `docs/assets/hero-demo/mark-ink.png` |
| `hero-demo/mobile-430.png` | `docs/assets/hero-demo/mobile-430.png` |
| `hero-demo/reduced-motion.png` | `docs/assets/hero-demo/reduced-motion.png` |
| `hero-demo/splash-drawing.png` | `docs/assets/hero-demo/splash-drawing.png` |
| `hero-demo/splash-settled.png` | `docs/assets/hero-demo/splash-settled.png` |
| `hero-demo/theme-default-hero.png` | `docs/assets/hero-demo/theme-default-hero.png` |
| `hero-demo/theme-graphite-hero.png` | `docs/assets/hero-demo/theme-graphite-hero.png` |
| `hero-demo/theme-ink-hero.png` | `docs/assets/hero-demo/theme-ink-hero.png` |
| `hero-demo/theme-sheet.html` | `docs/assets/hero-demo/theme-sheet.html` |
| `hero-demo/theme-sheet.png` | `docs/assets/hero-demo/theme-sheet.png` |
| `plans/calendar-allday-analysis.mjs` | `scripts/verification/calendar-allday-analysis.mjs` |
| `plans/calendar-drag-exploration.mjs` | `scripts/verification/calendar-drag-exploration.mjs` |
| `plans/calendar-gantt-probe.json` | `docs/verification/results/calendar-gantt-probe.json` |
| `plans/calendar-gantt-probe.mjs` | `scripts/verification/calendar-gantt-probe.mjs` |
| `plans/calendar-gantt-verification.json` | `docs/verification/results/calendar-gantt-verification.json` |
| `plans/calendar-gantt-verification.mjs` | `scripts/verification/calendar-gantt-verification.mjs` |
| `plans/calendar-placement-demo-check.mjs` | `scripts/verification/calendar-placement-demo-check.mjs` |
| `plans/calendar-select-probe.mjs` | `scripts/verification/calendar-select-probe.mjs` |
| `plans/calendar-untimed-placement-demo.html` | `docs/prototypes/calendar-untimed-placement-demo.html` |
| `plans/gantt-width-analysis.mjs` | `scripts/verification/gantt-width-analysis.mjs` |
| `plans/motion-audit-inventory.json` | `docs/verification/results/motion-audit-inventory.json` |
| `plans/motion-audit-inventory.mjs` | `scripts/verification/motion-audit-inventory.mjs` |
| `plans/motion-audit-probes.json` | `docs/verification/results/motion-audit-probes.json` |
| `plans/motion-audit-probes.mjs` | `scripts/verification/motion-audit-probes.mjs` |
| `plans/motion-audit.md` | `docs/verification/motion-audit.md` |
| `plans/motion-implementation-status.md` | `docs/verification/motion-implementation-status.md` |
| `plans/motion-specification.md` | `docs/verification/motion-specification.md` |
| `plans/motion-validation.md` | `docs/verification/motion-validation.md` |
| `plans/motion-verification-results.json` | `docs/verification/results/motion-verification-results.json` |
| `plans/motion-verification.mjs` | `scripts/verification/motion-verification.mjs` |
| `plans/packaged-client-smoke-win.json` | `docs/verification/results/packaged-client-smoke-win.json` |
| `plans/packaged-client-smoke-win.log` | `.cache/verification/packaged-client-smoke-win.log` |
| `plans/packaged-client-smoke.json` | `docs/verification/results/packaged-client-smoke.json` |
| `plans/packaged-client-smoke.mjs` | `scripts/verification/packaged-client-smoke.mjs` |
| `plans/packaged-client-verification-win.json` | `docs/verification/results/packaged-client-verification-win.json` |
| `plans/packaged-client-verification.json` | `docs/verification/results/packaged-client-verification.json` |
| `plans/packaged-client-verification.mjs` | `scripts/verification/packaged-client-verification.mjs` |
| `plans/README.md` | `docs/verification/README.md` |
| `docs/new-session-hero-demo.html` | `docs/prototypes/new-session-hero-demo.html` |
| `docs/theme-engine-demo-5-themes.html` | `docs/prototypes/theme-engine-demo-5-themes.html` |
| `docs/process/gantt-view-design-proposals.html` | `docs/prototypes/gantt-view-design-proposals.html` |

## 删除清单

以下四个路径在删除前均重新核对了工作区绝对路径与目录内容；其中临时测试目录的会话文件确认均位于临时目录。

| 路径 | 当前内容 | 删除依据 |
| --- | --- | --- |
| `.probe-contrast/` | 空目录 | 无文件、无受版本控制内容 |
| `packages/session-mcp-server/` | 仅 dist/index.js，4,804,111 字节 | 已移除后台的旧构建残留；不是现行 workspace 源码 |
| `packages/shared/src/agent/__tests__/__tmp_build_call_llm__/` | empty.ts、image.png、test.ts，共 30 字节 | 测试临时夹具残留 |
| `packages/shared/~/` | 11 个测试会话文件，共 4,882 字节 | 字面量 ~ 目录，全部位于 AppData/Local/Temp/pending-plan-test-* 下 |

已删除空的 `hero-demo/`、`plans/`。所有截图、历史审计和 JSON 验收证据已保留。

## 同步修复与验收

以下事项已完成：

1. 修复迁入 scripts/verification/ 的脚本根目录计算、结果输出位置、目录创建逻辑、演示文件 URL 和注释中的运行命令。使用 file URL 的脚本须兼容 Windows 路径。
2. 修复 Markdown 相对链接和本仓库路径引用；保留外部研究仓库的 plans/ 引用、历史扫描 JSON 中的原始路径和测量数据。必要处增加旧路径到新路径的说明。
3. 更新 scripts/identity-allowlist.json 中 AUDIT_REPORT.md 的精确路径规则，更新 .gitignore 的日志位置。
4. 更新 docs/README.md，补充原型、验收入口和目录维护规则；将迁移后的验收 README 改为覆盖动效、日历和打包客户端的总入口，保留原有复现命令和说明。
5. 检查迁移后的本地文档链接、旧路径引用和脚本语法；执行 identity:check 与 version:check。未运行 E2E、打包产物结构验证或客户端 smoke。
6. 核对迁移文件与原文件的对应关系，确认未丢失既有未提交工作。12 个迁移后的验证脚本均通过 `node --check`；154 个文档内本地 Markdown 链接均指向现存路径；`git diff --check` 通过。`identity:check` 的生成身份漂移检查通过；非严格残留扫描报告 228 个未允许命中（109 个文件），该扫描本次只作报告且没有作为失败处理。`version:check` 通过：0.2.3 与 27 处声明一致（13 个 workspace 包）。未运行 E2E 或完整验证套件。未提交、未推送。

## 本次保留

- .craft-agent/：本地应用数据，不能当缓存删除。
- node_modules/、当前 dist/、release/、vendor/、打包资源：开发与运行所需。
- .codegraph/：本地索引及配置，不能仅按体积判断无用。
- analysis/ai-elements/：本地研究源码，尚无证据证明可删除。
- .cache/ 下已有辅助脚本、提交说明和打包日志：未逐项确认已无用途，保留。
- 所有现有功能修改，包括确认弹窗、打包启动、日历状态文档、国际化文件及 .gitattributes。

## 边界

本次是文件组织与可核实的文档维护，不是全仓库死代码删除或历史审计重新验证。没有把“没有引用”直接当成“可以删除”；未对历史安全结论、截图或验收数字作当前有效性的背书。
