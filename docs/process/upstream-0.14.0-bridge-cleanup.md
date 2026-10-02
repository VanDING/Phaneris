# Legacy bridge 清理确认摘要

当前唯一后端为 Pi；清理前 `applyBridgeUpdates` 继承 BaseAgent 空实现，没有 runtime 消费方。以下精确变更已在展示摘要并收到用户 2026-10-03 回复“继续”后应用，范围保持为此前列明的 8 个文件。

| 文件 | 拟变更 |
| --- | --- |
| `apps/electron/resources/bridge-mcp-server/index.js` | 删除旧 Codex/Copilot bundle；18276 行、645687 字节、SHA-256 `5fd97a3dd191dfc2b1f3b7a36efe5fc50525d9dbf3e125ad1adb2efd302c9c4b` |
| `apps/electron/electron-builder.yml` | 移除旧 bundle 的 files / extraResources 打包引用 |
| `scripts/build-server.ts` | 移除仅复制旧 bridge 的循环 |
| `scripts/identity-allowlist.json` | 移除对应旧 bundle 的豁免条目 |
| `apps/electron/resources/AGENTS.md` | 移除资产表中旧 bridge 行 |
| `packages/shared/src/agent/backend/types.ts` | 移除无消费方的 BridgeUpdateContext / applyBridgeUpdates 接口 |
| `packages/shared/src/agent/base-agent.ts` | 移除空实现及其 import |
| `packages/server-core/src/sessions/SessionManager.ts` | 移除空代理 helper、5 个调用和只用于空调用的局部变量 / source auth 块；保留 setSourceServers、refresh 和 source runtime 路径 |

实施时先用 `git apply --check` 核对补丁，再验证旧 bundle 的绝对路径和 SHA-256，使用文件补丁工具删除。Pi bundle、ESM 构建、thin launcher、用户数据、原工作区保持现有行为。删除后重跑全量门禁与 Windows 打包检查；headless server distribution 的 Windows 平台限制单独记录，Git 可恢复旧 bundle。原补丁在本地忽略目录 `.cache/upstream-0140-bridge-cleanup.diff` 留档，实际变更以当前 Git diff 为准。

确认依据是用户提供的协作约定：“涉及删除、重写、不可逆操作前，展示变更摘要并等待确认。”评估方案 B3 也保留了这一步。
