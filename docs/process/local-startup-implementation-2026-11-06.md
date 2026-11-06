# 本地启动与历史会话收缩

状态：本机 Windows 范围实施与验收完成。日期：2026-11-06。授权：用户在本轮分析后要求执行完整实施方案。

## 范围

1. 正常打开 SQLite 不再进行完整 integrity_check；保留数据库打开、schema 迁移、未结算记录恢复，以及明确调用的完整诊断和错误恢复。
2. 移除启动/每六小时的自动备份与物理维护调度，停止配置目录初始化中的日期备份。已有用户备份不删除，不引入备份设置或新调度服务。现有离线手动工具不扩展。
3. 历史目录保留一次轻量读取，正文、运行时观察者/执行槽、权限和账本投影按打开、执行或未结算恢复激活。不引入第二套持久索引、数据库或摘要缓存服务。
4. 会话归属按 ID 直接查询现有内存注册表；列表序列化不再重复读取助手位置文件。取消启动/重连对所有历史会话的逐条权限 RPC。
5. 图标缺失与瞬时读取错误分开处理，利用现有连接事件和有界重试恢复首屏；不加固定启动等待、不加长 RPC 超时。
6. 自动化调度器依据启用的 cron/页面刷新启动、停止；仍支持无 UI 的显式后台自动化。消息网关退出业务窗口的等待链。

## 验收

实施前场景见 [失败矩阵](../verification/local-startup-failure-matrix-2026-11-06.md)。增加针对真实冷会话、RPC、数据库生命周期与图标的 E2E 工作流；复用会话基础、权限、恢复和原生客户端工作流。生产修改完成后执行类型、lint、相关现有回归和实际 Electron 首屏验证，记录精确命令、源代码身份、证据目录及未验证范围。

本轮不自动提交、推送、发布或替换个人安装版；不清理用户已有备份。诊断副本仅用于隔离验证。

## 原因与处理边界

原客户端启动时，对全部历史会话逐条请求权限状态。每条 RPC 的归属校验又调用 `getSessions()` 转换、排序整个目录，转换时逐条同步读取助手位置文件，形成平方级工作量。初始图标读请求与这些请求共享服务；读取错误又被吞成「文件不存在」，挂载期间没有恢复路径。用户切换界面后重新挂载、重新读取，才显示真实图标。原安装版 CPU profile 已确认归属检查及同步位置读取占据启动主线程；图标故障具有时序敏感性，不能把每一次空心圆都断言为同一个已捕获的图片超时。

本轮同时去掉请求风暴、列表中的文件读取，以及图标错误被永久当作缺失的处理。超时只重试一次；断线利用现有连接事件恢复；持续失败显示独立占位，不伪装成默认会话状态。真正缺失的图标仍使用原有 fallback。没有增加轮询、数据库索引服务、全局启动延迟或 RPC 超时。

历史会话保留目录条目是展示列表所需；启动不再给所有历史会话注册执行槽、订阅和权限运行状态，也不逐条重放用量账本。恢复依据 Runtime 的未结算报告，而非 `done` 标签。打开一个历史会话时只激活该会话；运行时槽的首次创建也会触发同一个激活边界，覆盖执行与投递路径。

## 可复跑入口

- `bun run verify:local-startup`：真实 SQLite、SessionManager、WebSocket RPC 与生产图标组件的 35 个场景。
- `bun run verify:local-startup:native`：已构建 Electron 的 640 条完成会话首屏；设置 `PHANERIS_VERIFY_ELECTRON_EXECUTABLE` 可对指定打包产物执行相同验收，逐文件核对构建散列。
- `bun run verify:session-foundation`：分支、导入导出、元数据、草稿、附件与恢复。
- `bun run test:runtime-boundary`、`bun run test:native-client`：崩溃、副作用、真实 Pi 子进程和客户端聊天/权限/重连。

启动、备份保留、冷历史和图标工作流已接入 `test:critical`；本轮未运行包含大量无关主题/文档场景的整个 critical 集合。每个新工作流保存 manifest、源码身份和可校验产物；浏览器/原生工作流另存 trace 与截图。所有用户目录均通过独立配置隔离。

## 已完成的验证

| 验证 | 结果 | 本机证据 |
| --- | --- | --- |
| 正常启动与显式诊断 | 7 场景通过；未引用表损坏不会导致启动全页检查，显式检查仍能发现 | `.cache/verification/runtime-startup-XlAdyi` |
| 既有备份保留 | 7 场景通过；启动、空闲、关闭后文件散列不变 | `.cache/verification/runtime-backup-retention-DA5GIJ` |
| 640 条历史、权限隔离、按需激活、恢复及 headless 自动化 | 11 场景通过；启动执行槽/用量查询均为 0；打开一条后槽数为 1 | `.cache/verification/local-startup-Ervm84` |
| 状态读取异常与生命周期 | 10 场景通过；超时、重连、持续错误、真实缺失、工作区切换和卸载 | `.cache/verification/status-startup-q1QWbX` |
| 会话存储基础 | 7 工作流、53 场景通过 | `.cache/verification/session-foundation-suite-DCK1DQ` |
| Runtime 边界、崩溃及 Pi | 规则变异检查与 15/8/6 场景通过 | `.cache/local-startup-runtime-boundary.log` |
| 权限归属、冷元数据、空闲释放、用量及重连既有测试 | 20 测试通过 | `.cache/local-startup-existing-tests.log` |
| 数据库恢复、投影及进程崩溃既有测试 | 31 测试通过 | `.cache/local-startup-database-existing.log` |
| 源码构建首屏 | 5 场景通过；首次采样的 50 个可见完成图标均正确，全历史权限请求为 0 | `.cache/verification/local-startup-native-rD5QJ7` |
| 源码构建完整客户端 | 31 场景通过；本地提供方经真实 Pi 进程执行，含权限、计划、取消和重连 | `.cache/verification/native-client-qeJOsE` |
| Windows 打包客户端首屏 | 最终构建 5 场景通过；640 条完成会话无需切页，逐文件核对 main/preload/renderer 散列 | `.cache/verification/local-startup-native-kvVkb5` |
| Windows 打包完整客户端 | 32 场景通过，包含打包诊断模式的有界退出 | `.cache/verification/native-client-Q18iKT` |
| 委派与投递 | 64 场景通过；验证按需激活没有破坏后台任务和跨会话投递 | `.cache/verification/resident-assistant-delegation-G1xPgc` |
| 决策记录 Host/RPC | 15 场景通过，含跨工作区拒绝、重启与用量；本次使用 `--host-only`，未重跑该脚本的完整 UI 组 | `.cache/local-startup-decisions-host.log`、`.cache/session-decisions/results.json` |
| 全项目类型与完整 lint | 通过；RPC 清单仅更新受影响源码行号 | `.cache/local-startup-typecheck-final.log`、`.cache/local-startup-scripts-closeout.log`、`.cache/local-startup-lint-closeout.log` |
| 文档、身份和版本 | 文档链接检查通过；身份校验通过；0.6.1 的 27 处声明一致 | `.cache/local-startup-docs.log`；`identity:check`、`version:check` |

验证夹具的两处维护：原生客户端在第二工作区自动生成专属助手后，仍应只有一条普通会话，并且所有记录归属该工作区；旧决策测试要求已在本轮之前移除的前置自动思考判断，现改为验证显式思考级别直接传递、没有前置辅助请求，并在失败时复原提供方状态。没有恢复已移除的产品行为。初次并行构建竞争同一 WASM 输出产生 `EBUSY`，后续串行构建通过；没有绕过构建或 lint 检查。

最终便携验证目录为 `.cache/verification/local-startup-package-final-20261106/win-unpacked`，不是个人安装目录。打包首屏在删除无人调用的维护 worker 包装后再次执行；完整客户端 32 场景的产物为此前同轮构建，两者运行逻辑一致，最终首屏验收另行核对当前构建散列。

单次合成数据时间仅用于验收记录，不代表个人 2.56 GB 数据库或整机启动速度，也不与旧版本不同测试条件直接计算加速比。个人安装版未被替换；其他操作系统、付费远端模型与签名安装流程不在本轮验证范围。
