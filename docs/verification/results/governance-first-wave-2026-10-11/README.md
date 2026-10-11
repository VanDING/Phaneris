# 架构与代码治理首轮验收证据

日期：2026-10-11，macOS x64；起始 HEAD `8e5bf13b3f393dc776f6c17057eb5d0fb05f2dda`，工作树有本轮未提交修改。
对应[实施台账](../../../process/governance-first-wave-2026-10-11.md)、[失败矩阵](../../governance-first-wave-failure-matrix.md)及[实施前扫描](../architecture-code-governance-2026-10-11/README.md)。

此目录是维护者显式选择的本轮归档；日常验证默认写独占 `.cache/verification/`，不会更新此处或既有证据。验收状态与计数见 `summary.json`；运行的命令、环境、源状态和产物身份见各 `manifest.json`。

## 本地结果

- `validate:full`：退出 0；全成员/工具类型检查、lint、i18n、文档/身份/版本/运行时检查通过。workspace 6,285 通过、14 个既有 skip；CI 子集另执行 87 次（合计 6,372 次通过执行，含重复条目）；文档工具 24 通过。最终日志为 `logs/validate-full.log`；无测试的 WebUI/Viewer 成员明确保留。
- `critical`：5 个工作流 + 6 个包组，228 个既有 Bun 测试；Runtime gate 拒绝 25 条违例（10 个规则/断言 ID），boundary 15、真实进程 crash 8、插件事务 12、分支生命周期 4 场景。
- `runtime-pi`：真实 Pi 子进程与 SQLite，loopback inference 六项行为断言及 close 等待子进程退出。
- `verification-output`：V01–V07，顺序/并行复跑和失败产物校验；tracked 内容保持。`corrupt` 和 `failed` 子目录是预期拒绝的负例，不能单独作为通过的运行。
- `governance-gates`：uv/always-upload/成员覆盖/warning 精确额度四个变异；日志中的非零退出是被测门禁的预期结果。
- `build-smoke`：五类生产 bundler 与组装后的 server entry import/token-format 检查；未保留 token 值。`bundle:report --check` 使用原硬预算。

## 复跑与校验

先使用当前实现工作树（仅 checkout 起始 HEAD 不包含本轮改动）。`implementation.patch` 保存 tracked 修改及新增源码/台账/矩阵，便于审查或还原；`results` 证据以本目录与实施前扫描目录为准，未重复塞入补丁。然后运行：

```sh
bun run validate:full
bun run test:critical
bun run scripts/verification/verification-output-workflow.ts
bun run scripts/verification/governance-gates-workflow.ts
bun run server:build:subprocess
bun run scripts/verification/durable-runtime-pi-workflow.ts
bun run build:smoke
bun run electron:build:assets
bun run bundle:report --check
```

在本目录执行 `shasum -a 256 -c SHA256SUMS`。正例 manifest 可单独检查，例如在仓库根运行：

```sh
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/governance-first-wave-2026-10-11/evidence/critical
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/governance-first-wave-2026-10-11/evidence/critical/plugin-transaction
```

归档复制保留各运行内的相对产物路径和哈希。JSON 里的临时工作区/child pid/原输出绝对路径是当次诊断上下文，复跑不应沿用；DB、报告和日志已经在此归档。每次 manifest 的 dirty 文件哈希是**运行开始时**的快照，后续文档登记不回写旧 manifest。

manifest 的 uv 版本记录 PATH 上的 `0.11.28`。文档工具 harness 优先使用仓库带的 uv，本轮实际为 `0.12.22`，与 build/CI pin 一致；具体二进制和哈希登记在 `runtime-environment.json`。

## 修复前与覆盖边界

`before/` 保存插件、Runtime 分支、正常删除及旧夹具的失败记录；初始完整回归压缩日志保留原始断言，不作为当前验收状态。所有插件场景在一次性目录使用真实文件系统/加密 store，新进程复读；报告只保留凭据是否存在和哈希。分支 E2E 使用真实 SessionManager/Host/磁盘，provider 与 pool 端点为受控 port。

未验证：远端 GitHub Actions、原生 Windows/Linux、首次 runtime 下载、签名/公证/安装器/发布、真实 provider/IM、同名插件并发安装、插件跨目录进程崩溃恢复。新 API/local 源空默认值校验、严格 identity 残留、G2b/G2c 和 G3–G8 仍开放。
