# M0：0.5.x 收尾失败矩阵

状态：本机 Windows 范围已验证，结果见[最终实施记录](../process/m0-closeout-implementation-2026-10-28.md)。用户于 2026-10-28 授权 M0；基线 `3cfe8a6bd`。以下失败在对应修复前记录，仅使用隔离配置、数据库与 loopback provider。

| 范围 | 失败方式与保持条件 | 验证入口及产物 |
| --- | --- | --- |
| 启动 | 大库完整性检查阻塞主线程；维护挡住窗口；损坏库不经检查执行副作用；关闭时后台任务访问已关闭库 | 新增启动流程：同一隔离数据库的主线程/后台耗时、心跳、损坏与重启结果 |
| 启动反馈 | 检查期间完全没有窗口；临时窗口提前暴露 RPC 或 Node；快速启动闪屏；主窗口出现后残留；失败或退出不收尾 | Windows 候选实际启动窗口与业务窗口交接、权限及页面截图 |
| 取消计量 | T1 已提交但 ACK 尚未到子进程时取消，不能把未调用 provider 的请求留成未知；已调用 provider 则不能凭取消伪造零费用 | usage-ledger XA/XB、provider 请求数、SQLite ledger/outcome、RPC 事件 |
| Source 激活 | 延迟发现后找不到 source_test；新增发现调用改变 requestId 导致 race 注入失效；重复续接；丢附件/纠正；停止后重试；失败不可见 | source-activation-settlement，实际请求与执行事实、输入与输出 |
| 未知效果 | 不得恢复整会话锁；相同未知非幂等动作仍不能重放；消息结果仅凭文字不能当作送达回执 | pi-interruption-recovery，receipt/unknown 事实及无重复效果 |
| 主题 | 退役主题后 registry 下限过期；不能靠降低下限掩盖仍适用的独立场景 | theme-foundation/contract，场景映射与当前 Default 两种模式/宿主结果 |
| 日用候选 | 普通/项目/重启会话目录漂移；分支或恢复丢成果；停止与重启重复执行 | working-directory、backup-retention、session-foundation、native-client、harness |
| 连接测试（10-29 补充） | 一次性上下文缺少真实 cwd 导致 ENOENT；不能用 HTTP 成功掩盖运行时损坏；并发测试不能串凭据；成功/失败/超时都清理临时目录、进程和凭据 | 真正 testBackendConnection/Pi/loopback；再验 onboarding 与 Windows 候选资源 |
| 组合 | 并发构建覆盖共同输出；不同源码结果冒充同一候选；文档状态滞后 | 串行构建；validate:ci、critical、适用原生流程；源码/构建 SHA 与未测范围 |

发行范围：本机 Windows 桌面候选；不将 Windows 不支持的 standalone server 分发构建计作通过。版本发布、安装目录替换与远端推送不在本次实施中自动执行。

## 组合验收补充：取消后的部分文本

真实 Pi 流式输出被用户停止后，SDK 保留的部分文本不得被标记为最终回答；应保留为中间内容。既有 PC-03 复现了当前适配层将 `stopReason=aborted` 误判为最终文本，继续要求终止标志、无后续派发、无孤儿子进程。

PC-06 同时发现压缩阈值的 `NaN` 经 JSON 比较等同于 null，静默跳过拒绝。应在宿主跨进程序列化边界使用现有阈值校验；保留合法百分比与旧 Token 数值、相同值去重以及子进程重启行为。
