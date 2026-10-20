Pi 中断与消息投递修复（2026-10-19）

已实现消息回执、迟到结果结算、仅模型中断恢复和意外退出诊断。项目标签、项目记忆和上下文压缩策略不在本次变更范围。

| 问题 | 实现后的行为 |
|---|---|
| 跨会话发送一直等到接收方整轮结束，触发 codemode 超时 | 独立 `deliverMessage()` 在 Runtime 接收事实和兼容 JSONL flush 成功后返回；通用 `sendMessage()` 保留等待整轮完成的契约。 |
| 发送方重复投递 | 使用发送工具的 durable operation ID 形成稳定输入身份。相同身份复用原消息；内容冲突拒绝；持久化失败且尚未交付的输入复用原记录恢复。 |
| 调用取消、旧子进程退出后，主进程仍得到成功结果 | 按原 run/tool 身份补交 T2；已取消的错误不伪装成确定失败；新子进程不会收到旧调用的响应。 |
| 主进程重启造成发送工具返回值丢失 | 可以查询目标 Runtime 中精确关联 `agent-message:<toolOperationId>` 的接收事实并提交已验证核对；不以正文相同或时间接近推断送达。 |
| 仅模型请求中断造成后续输入被永久拒绝 | 下一次输入前提交 `interrupted_response_unavailable`，将旧轮次终结为 interrupted。旧请求不重放、不伪造回答或 usage，未知计费保留。 |
| 仍有未知外部工具效果 | 继续阻止自动重放；模型恢复不能豁免未知工具操作。 |
| Pi 子进程意外退出只显示退出码 | 在 stdio 排空后的 close 边界写入会话 `diagnostics/pi-exit-*.json`，包含 PID、退出码/信号、运行时、最后模型请求标识、主进程内存和经过凭据脱敏的限长 stderr。正常退出不生成崩溃报告。 |

主要实现：[SessionManager](../../packages/server-core/src/sessions/SessionManager.ts)、[模型中断恢复](../../packages/server-core/src/durable-runtime/coordinator.ts)、[消息回执核对](../../packages/server-core/src/runtime-adapters/message-delivery-reconciliation.ts)、[迟到结果](../../packages/shared/src/agent/pi-agent.ts)、[退出诊断](../../packages/shared/src/agent/backend/pi/exit-diagnostics.ts)。

验证结果：

| 检查 | 结果 |
|---|---|
| 新增验收：真实 SessionManager 接收与持久化、真实 Runtime/SQLite、真实 Pi 子进程和本地流式接口 | 21 项通过；含替换子进程后的迟到 T2、缺少精确回执仍阻塞、模型恢复、未知计费、脱敏和正常退出。目标模型执行在接收边界场景中使用可控替身；不涉及付费服务。 |
| 既有 Runtime 协调、usage、消息持久化和发送处理器测试 | 30 项通过。 |
| 既有 stderr、子进程错误、ask_user、休眠、消息队列及 source activation 测试 | 38 项通过。 |
| 崩溃工作流 / Runtime 边界工作流 / 独立 Pi 工作流 | 分别 8 / 15 / 6 项通过；可靠性报告工作流通过。 |
| `bun run typecheck:all` | 全量通过。 |
| `bun run lint` | 全量通过；新增 adapter 与最终验收脚本另行 lint 通过，最终 Runtime/架构边界重新检查通过。 |
| Pi 服务构建、Electron 主进程构建 | 通过并验证输出。 |
| 证据完整性校验 | manifest 的文件哈希、场景数量、退出码均验证通过。 |

可重复运行：

```powershell
bun run scripts/verification/pi-interruption-recovery-workflow.ts
bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/pi-interruption-recovery-L2tIkB
```

本次本地证据目录为 `.cache/verification/pi-interruption-recovery-L2tIkB/`，其中 `manifest.json` 记录场景和产物哈希，`recovery-evidence.json` 保存完整验收证据。运行时产物保留在被 Git 忽略的 `.cache/`，可用上面的命令重新生成。[失败矩阵](pi-interruption-recovery-failure-matrix.md)及初版验收脚本在业务实现之前编写；未新增事后单元测试。

应用状态：工作区源码、Pi 服务和 Electron 主进程开发构建已完成。已安装的 Phaneris 0.3.2 未被替换，需更新应用构建后生效；真实会话和运行数据库没有被此轮测试或修复脚本改写。

历史限制：旧版发送操作没有新的操作关联回执，不能仅凭相同正文自动消除未知效果。因此已有的 `open-mountain` 停放操作仍需依据原始证据做一次核对；新机制不会假装历史账本已修复。`clever-tulip` 这类仅模型中断、且没有未知工具的停放运行，可在使用新构建后由下一次输入触发恢复。

原始 `4294967295` 退出的底层触发因素仍未确定；本次修复已确认的持续阻塞链路，并为后续意外退出保留现场。尚未验证真实远端服务、签名安装包或安装部署。
