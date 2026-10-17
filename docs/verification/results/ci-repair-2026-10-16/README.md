# CI 修复本地证据

源码基准：231a7942b（已有六个未推送提交）；本轮修复为工作区改动。

[修复记录](../../ci-repair-2026-10-16.md)；[失败矩阵](../../ci-repair-failure-matrix-2026-10-16.md)；[依赖评估](../../../dependencies/dependency-audit-2026-10-16.md)。

[机器可读证据与校验清单](evidence.json)记录源码、锁文件 SHA-256、命令结果、原始工作流产物摘要与未验证范围。所有原始运行日志位于仓库 .cache/ci-dependency-audit-20261016；完整工作流 manifest 位于 .cache/verification。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| validate:ci | 完整命令退出 0 | evidence.json；原始 validate-ci-final.log 哈希 |
| 全量 workspace 测试 | 6,301 pass，0 fail | evidence.json 中保留日志哈希 |
| 独立空缓存安装与 main 构建 | 5/5 | [结果](clean-install.json) |
| 原生 Windows 主题 | 13/13 | [结果](theme-native.json) |
| 治理门禁负向场景 | 9/9 | [结果](governance-gates.json) |
| 容器/构建输入负向场景 | 11/11 | [结果](distribution-inputs.json) |
| OCR / 共享缓存端到端 | 23/23 | [结果](security-e2e.json) |
| 安全门禁 | 通过；未增加允许项 | [日志](security-gate.log) |
| 生产 main 构建 | 通过 | [日志](main-build.log) |
| 包体积预算 | 通过 | [报告](bundle-report.log) |
| 沙箱原有回归用例 | 15 pass，0 fail（Windows） | [日志](sandbox-regression.log) |
| Recovery 回归 | 通过 | [日志](recovery.log) |
| 进程生命周期工作流 | 修正夹具后 12/12 | [结果](process-lifecycle.json) |

关键路径初次运行完成 23 个工作流、313 个场景后，在 Windows 正常停机夹具中失败。修正 Windows 停机语义与 Pi 故障注入时序后，生命周期工作流单独复验 12/12；后续 20 个工作流未在本轮接续执行。完整关键路径未记录为通过。

远端三平台 Actions、真实 Linux 容器及服务器 distribution 验收尚未由本机结果确认，需要发布修复提交后执行。

本轮全量构建已经跑过 main、preload、renderer、Web UI、viewer；build:smoke 随后按设计拒绝 Windows standalone assembly。该命令在本机的整体退出码为 1，未记录为完整 smoke 通过。
