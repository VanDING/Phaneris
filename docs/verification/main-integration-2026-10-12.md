# main 集成前：历史证据门禁收口

状态：已验收。日期：2026-10-12。

本轮 [UI 验收档案](results/frontend-shell-polish-2026-10-12/README.md)记录了当时被两份历史日志阻挡的 docs / identity 门禁。提交和合并前确认本机保留着原日志，且 SHA256 与各自冻结档案的校验表完全一致；现将这两个原文件纳入 Git，避免本机与干净 checkout 的结果不同。

| 恢复文件 | 原始 SHA256 |
| --- | --- |
| [第一轮日志](results/governance-first-wave-2026-10-11/logs/validate-full.log) | `09e33f211e5b22bf83f899242564ba6063e563b74408333eeb0f11bee16043e5` |
| [第二轮日志](results/governance-second-wave-2026-10-11/logs/second-validate-full-final.log) | `72e24105c1d511aca5286d06e9c9173db81d6657f8cd3e2be9d0384bf536d89d` |

原日志、原 README 与原 SHA256SUMS 均未重写。`doc-artifact-exceptions.json` 中的缺失日志例外已按其退出条件撤销。identity 规则只登记两个精确文件中各两行历史兼容测试输出，保留原时长和字节；新行或变化后的标识仍会被严格扫描拦截。

`identity:check` 与 `check:docs` 已通过。既有 `identity-gate-workflow.ts` 的 6 个场景也通过，覆盖精确兼容行、新增标识、修改原行、新维护文档、陈旧规则和生成物漂移。原 UI 132 项证据继续保持原 SHA，不将集成后的门禁状态改写到原截图验收时点。

复现：

```sh
bun run identity:check
bun run check:docs
bun run scripts/verification/identity-gate-workflow.ts
```

本页记录集成前的已知门禁修复。实际推送继续由原 `pre-push` hook 执行完整 `validate:ci`，没有使用 `--no-verify` 或修改门禁程序。
