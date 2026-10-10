# Durable Runtime 边界实施验收

基线：`dbd32f60b5d90e20b1bc2b231035baf6b171ddc2`。当前源码在 `codex/durable-runtime-boundary` 工作树，尚未提交。范围是 B0–B5 的所有权和依赖迁移，保留 SQLite schema v4、Pi JSONL 及产品 RPC。

设计：[边界实施记录](../../../architecture/durable-runtime-boundary.md)。失败要求与覆盖限制：[故障矩阵](../../durable-runtime-boundary-failure-matrix.md)。

## 可重复入口

```powershell
bun run test:runtime-boundary
bun run scripts/check-runtime-boundary.ts --output=docs/verification/results/durable-runtime-boundary/dependencies-after.json
bun run scripts/verification/upstream-0140-b4b5-workflows.ts --report=docs/verification/results/durable-runtime-boundary/product-workflows.json
bun run scripts/verification/upstream-0140.ts --output=docs/verification/results/durable-runtime-boundary/upstream-0140.json
bun run scripts/verification/upstream-0141-decisions-workflow.ts docs/verification/results/durable-runtime-boundary/decisions-0141.json
$env:PHANERIS_TEST_BROWSER_CHANNEL = 'msedge'
bun run scripts/verification/session-decisions-workflow.ts
```

每次 runner 使用临时目录和 loopback provider，不读取或调用个人模型凭证。浏览器工作流使用真实 Run 面板和已认证 RPC；Windows 上由 Node 启动 Playwright browser server，避免 Bun 的原生管道问题。其他平台可省略 `PHANERIS_TEST_BROWSER_CHANNEL`，使用已安装的 Playwright Chromium。

## 已归档证据

| 产物 | 可核验内容 |
| --- | --- |
| [baseline-reproduced.json](./baseline-reproduced.json)、[DB](./baseline-reproduced.db) | 在基线源码实际复现 F06/F07/F09/F13；四项 conforms 均为 false，不是新代码通过报告 |
| [dependencies-before.json](./dependencies-before.json)、[dependencies-after.json](./dependencies-after.json) | 用同一解析门禁比较旧、新生产依赖图，包括 type、dynamic、barrel、JS、package exports 和闭包 |
| [gate-mutations.json](./gate-mutations.json) | 故意绕过边界的独立图谱被拒绝；非绿色生产扫描冒充门禁有效性 |
| [workflow.json](./workflow.json)、[DB](./workflow.db) | 15 组真实 Kernel/Host/SQLite 行为；提交失败、输入歧义、逆序工具、reentry、shutdown 和恢复 |
| [independent-pi.json](./independent-pi.json)、[DB](./independent-pi.db) | 无 SessionManager 的真实 Pi 子进程；两轮模型输入、一次真实 Read、T1/T2、usage、首轮工具一致及 canonical context |
| [crash.json](./crash.json) 及 `crash-*.db` | 8 组真实执行/恢复进程；可观测屏障后强杀、effect marker、两次恢复轨迹和各自 DB 哈希；T1 失败零调用，未知状态不重放 |
| [product-workflows.json](./product-workflows.json) | 20 项 Session/Task/Decision/权限/utility 产品工作流 |
| [upstream-0140.json](./upstream-0140.json) | 61 项权限/source/产品兼容验证；夹具通过 Runtime Host 安装及复用 driver |
| [decisions-0141.json](./decisions-0141.json) | 8 项决策/取消/预算/远端认证回归 |
| [session-decisions.json](./session-decisions.json)、[事实证据](./session-decisions-evidence.json) | 20 项真实 RPC/Run 面板验收；重载、范围拒绝、应用通知、分页和迟到结果 |
| [英文宽屏](./session-decisions-en.png)、[中文窄屏](./session-decisions-zh.png) | 浏览器工作流实际截图；宽度与 overflow 断言在结果中 |
| [images.json](./images.json)、[decision-governance.json](./decision-governance.json) | 5 项图像与 3 项决策/自动化治理验证 |
| [validation.json](./validation.json)、[原始日志](./logs/) | 19 个入口/基线结果、日志哈希、源码身份及 11 个数据库的 schema v4 / integrity_check / SHA-256 |

独立验收报告包含 Bun、Pi SDK、平台、实际命令、隔离目录、HEAD/dirty 状态、源码文件哈希清单及 `sourceFingerprint`；三个独立报告的指纹已核对与交付源码一致。基线导出源码逐文件核对了原 Git blob，另有自己的哈希清单。DB 已通过 SQLite backup 导出，不能只把正在写入的主文件复制后当完整快照。历史 `baseline.json` 是 B0 首次探针，完整基线结论以 `baseline-reproduced.json` 为准。

## 仓库门禁结果

| 检查 | 结果 |
| --- | --- |
| `validate:ci` | 通过：全仓库 typecheck、lint、shared 配置回归、文档工具 smoke、表格 UI、i18n、文档、字体、身份、版本及 runtime/Electron pin；lint 保留原有 warnings |
| `test:runtime-boundary` | 通过：门禁 + 23 处故意违规拒绝 + Host 15 组 + 真实进程故障 8 组 + 独立 Pi 6 项；真实子进程退出后才写通过报告 |
| Runtime/Session 既有回归 | 181 pass / 0 fail；handoff、标题、连接刷新分别以独立进程复跑 |
| 静态边界 | 1,462 个当前生产文件、0 处违规；同一门禁检查基线为 68 处。违规数包含所有权写入和导出规则，不能解读为 68 条唯一 import 边 |
| `test:critical` | 未全绿：当前 core 关键组 100 pass / 0 fail，shared 组仍有基线原有 3 项主题一致性失败；失败名称与改动前日志一致 |
| critical 后续组 | 因上述失败未被主脚本继续执行，已分别运行：Pi 16、UI 30、renderer sessions 13、reconnect 2，均通过 |

高负载复跑曾触发 TaskRunner 的 40ms 超时断言；已在冻结的原始源码上复现同样失败。最终 core 关键组通过，未通过放宽断言或修改任务超时逻辑消除该问题。基线和复跑日志一并保留。

## 覆盖和限制

独立执行、真实进程恢复、生产路由所有权和静态禁止依赖都分别验证。已有单元/isolated 用例只用于回归；它们没有代替新的真实 SQLite/Pi 入口。完整 F01–F21 每个时序组合没有被穷举，尤其 handoff 多阶段强杀、child dispatch 多阶段强杀和旧二进制回退；具体见故障矩阵。

没有重新打包或安装 Electron。Electron/headless 使用同一装配，异步退出清理已接通并经过类型检查；现有 packaged-client 结果未被用作本轮新证据。

回退要求排空前台及辅助任务、备份和检查 unknown/parked 证据。不能删库、把 parked 重置为 pending，或让旧版本依据兼容队列重新交付未知输入。
