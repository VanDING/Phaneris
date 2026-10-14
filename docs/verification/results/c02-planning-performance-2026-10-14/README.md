# C02 日历与工作项性能验收

状态：accepted — 2026-10-14，本机 Windows 的生产 WebUI、真实 WS 和浏览器专项通过。当前实施裁定见[统一台账](../../../process/implementation-value-register-2026-10-13.md)；[失败矩阵](../../c02-planning-performance-failure-matrix-2026-10-14.md)先于产品改动记录。代码尚未提交或发布。

本轮消除重复读取和通知：同一窗口、同一工作区的消费者共享 WorkItem 投影，日历从这份投影派生；读取串行执行，期间的失效合并为必要的后继读取，成功写入及删除保护覆盖迟到快照。最后一个消费者离开后释放订阅，重挂载和重连重新核验。SessionManager 统一合并广播，兼容的 calendar 通道继续存在；补上原生归档及取消归档的投影通知。

Session 仍是唯一持久事实来源。renderer 缓存按 API 实例与工作区隔离，仅保留最多八个无订阅、无在途操作的工作区；没有新建日期索引、范围 RPC 或持久规划仓。日历清除日程只清日期，保留会话身份；标题采用 WorkItem 的有界 fallback 投影。

## 测量口径

- Windows 本机、生产 WebUI、真实 WebSocket / RPC / SessionManager，独立配置和固定合成样本；1,000 条可见 Session 元数据，另有隐藏、归档、draft 及第二工作区负例。没有调用付费 provider。
- 每次保留三次暖导航和三次单写原始样本，记录实际读取次数、JSON 响应字节、handler / 投影耗时、可见条目、heap 和 host RSS。字节数为序列化业务响应，不含 WebSocket/TLS 帧开销。
- 沿用暖切换 2,000ms、输入至两帧 250ms、renderer heap 256MiB、host RSS 1,024MiB。可见条目与两帧是呈现代理，采样内存不代表峰值。
- 内存沿用现有性能脚本的 CDP `JSHeapUsedSize` 指标。日历日期定位在 2026-10-14：基线使用 `setFixedTime`，后续使用正常推进的 `setSystemTime`；均不快进计时器，时延仅作预算核查，不据此宣称时延收益。
- 基线为 `19e730ffe` 上的既有未提交工作区；新旧运行的生产构建、源文件、固定样本分别绑定 SHA。基线工作流预期因重复读取断言失败，原始样本和失败保留，不改写为 PASS。
- 本目录只归档结论、选定 JSON 和摘要；完整 trace、截图、独立配置和原始 manifest 留在唯一 `.cache/verification/<run-id>/`。原 R01–R07 证据保持历史 SHA。

## 实测结果

数值来自同一主样本 SHA `36f22980e2d8a08d4ce48a284abfb4e2ffc38230721a916d514142322dbe271b`；逐次记录见[汇总](summary.json)、[优化前](before/planning-performance.json)及[优化后](after/planning-performance.json)。读取和字节结果三次一致。

| 指标 | 优化前 | 优化后 | 结论 |
| --- | --- | --- | --- |
| 一次打开日历的投影 RPC | 2 | 1 | calendar / workItems 两份读取合为共享投影 |
| 打开日历的响应字节 | 1,787,016 | 1,216,199 | 减少约 31.9% |
| 一次修改后的投影 RPC | 4 | 1 | 每窗口减少 75% |
| 一次修改后的响应字节 | 3,574,032 | 1,216,199 | 减少约 66.0% |
| 一次修改的兼容广播总数 | 4 | 2 | 每兼容通道由两条降为一条 |
| 一次修改的全量 Session 元数据投影次数 | 6 | 3 | 包括 handler 的前后取值；此项是次数，不是 CPU 百分比 |
| 三次暖切换至可见条目及两帧 | 383.1 / 300.7 / 380.2ms | 436.1 / 395.3 / 206.1ms | 均低于 2,000ms；不宣称稳定时延下降 |
| 输入至两帧 | 未采样 | 36ms | 低于 250ms |
| renderer heap | 未采样 | 37,936,012 B，约 36.2MiB | 低于 256MiB；[原始 CDP 样本](after/memory-sample.json) |
| host RSS | 未采样 | 162,004,992 B，约 154.5MiB | 低于 1,024MiB |

现有预算未被重复违反。用户明确授权后仅收敛有证据的重复开销；范围查询、日期索引及永久缓存没有足够依据，继续关闭。

## 验收与证据

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 生产 WebUI / 真实 WS | 20 场景通过 | [完整断言与样本](after/planning-performance.json)、[来源](after/provenance.json)；原始运行 `planning-performance-gQ5jcK` |
| React hooks 竞态与生命周期 | 17 场景通过 | [共享集合验收](collection/planning-collection.json)、[来源](collection/provenance.json)；原始运行 `planning-collection-lyp8mp` |
| 甘特改期回归 | 14 场景通过 | [结果](gantt/gantt-reschedule.json)、[来源](gantt/provenance.json)；原始运行 `gantt-reschedule-5ZeYga` |
| 既有 handler / 日期 / 查询 / 时间轴 | 8 + 50 项通过 | [handler 日志](regressions/work-item-handlers.log)、[日期与查询日志](regressions/date-query-timeline.log) |
| 静态检查与接线 | 通过 | [检查、日志摘要与当前源码 SHA](static-checks.json)；全量类型 / lint、最终改动定向 lint、i18n、身份、版本、RPC 清单及 critical preflight；聚合 E2E 未运行 |
| 基线失败 | 预期 FAIL，三次原始样本保留 | [失败](before/failure.json)、[来源](before/provenance.json)；原始运行 `planning-performance-rIrAma` |

覆盖双客户端的原生修改、归档/恢复、外部文件变更；跨工作区批量通知；一个在途读取和一个必要后继；迟到读写、删除保护、首次加载并发写入；读取失败重试、重连、退订与重挂载；真实日历拖拽拒绝后的提示及磁盘值不变；现代日历 hooks 和旧 calendar RPC 的创建、修改、清日期及会话删除。短时修改按现有 250ms 窗口合并，逐笔落盘的长批次可以跨多个窗口。

隐藏、归档、draft 和未排期记录由真实投影样本验证；筛选/选择的纯函数与甘特过滤回归保持，CalendarView 的筛选和选择实现未改。本轮未新增每个日历筛选器的逐项生产交互验收。

完整本地运行可用 `bun scripts/verification/verification-artifacts.ts --verify=.cache/verification/<run-id>` 核对。归档只含选定文件，使用本目录 `SHA256SUMS` 核对；`provenance.json` 保存原始 manifest 的 SHA、源码、运行时、已选与排除范围，不冒充完整运行目录。

## 复跑

```powershell
$env:PHANERIS_TEST_BROWSER_CHANNEL='msedge'
bun run test:planning-collection
bun run test:planning-performance
bun run test:gantt-reschedule
```

性能工作流自行构建生产 WebUI。已明确构建并核对摘要时，可用 `PHANERIS_C02_SKIP_BUILD=1` 复用该构建；工作流仍记录全部构建摘要。浏览器竞态工作流使用明确的内存 API，验证真实 React hooks 的生命周期和请求竞争，不用于性能结论。

## 范围

本轮 C02 未执行原生 Electron 安装包、macOS/Linux、实机触摸、外部 provider、完整 `test:critical` 或 `validate:full`。现有 Windows R03 原生证据属于此前源码快照，不扩展解释为 C02 的原生性能验收。
