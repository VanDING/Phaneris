# 升级延期项实施：2026-10-20

用户已批准 Codex 完整推进本轮，继续使用隔离工作树与分支 `codex/upstream-0153-closeout-isolated-20261020`。不交 DSH，不混入 E:\Phaneris 的字体/设计迁移，不提交、推送、发布或改版本。

上一轮[收口记录](upgrade-closeout-2026-10-20.md)的 31 pass / 1 environment-limited 是上一轮源码证据。本轮扩展后重新运行全部适用门禁；最终状态由本文末尾自动采集段和[机器结果](../verification/results/upgrade-2026-10-18.json)给出。先行失败路径见[失败矩阵 §13](../verification/upgrade-2026-10-18-failure-matrix.md)。

| 项目 | 实施结果 | 定向证据与边界 |
| --- | --- | --- |
| P-01 | 参数校验失败仍保留 SDK 的规范工具名；清除未执行的缓冲 start；准确发送一次 PostToolUseFailure | Pi 真实子进程 PC-02；不制造执行事实、不绕过校验；修复前红项日志保留 |
| U-01 | 显式区分 reported、sdk、partial、unavailable、not_dispatched；缺失字段保持空值，保留请求/outcome；已知金额标识 SDK 估算，未知项显示 Unknown | 真实 Pi → 供应商回环 SSE → SQLite 16 项通过：成功、两层重试、幂等、工具、warming、恢复/fork、明确零、无用量成功、计量后失败、部分用量、取消、摘要计费与恢复裁决；历史记录不改写，不把估算当真实账单 |
| 压缩阈值 | AI 设置支持可选绝对 tokens 阈值，空值保留 SDK 默认；完整持久化/RPC/会话/上下文显示链路，按当前模型安全上限约束；manual/handoff 保留原策略 | 公开 session_before_compact + compact 复用原摘要器；普通历史摘要 80%、拆分回合前缀 50% 继续使用原 reserve，并受模型输出上限约束；不修改 SDK、不放大摘要预算 |
| D-01 | 产品 PDF CLI 将 pypdf 预期修复警告限制到 ERROR；保留真实错误与退出码，不过滤验证产物 | 真实 PDF 工具 6 项通过，损坏输入修复前/后日志保留 |
| 界面/RPC | 等待读取期间禁止误写；加载失败可重试；失败保存保留输入；切语言保留草稿；清空和服务重启恢复正确 | 生产控件 + 真实认证 WebSocket RPC + 配置文件共 12 项；轨迹界面区别未知、零、已知估算小计，附截图/trace |

### 实施中发现并修复

- SDK applyOverrides 会被普通 setter 重建设置时清掉。改为公开 SettingsManager.fromStorage，内存存储归当前会话独占，模型/思考/策略切换不丢阈值；不读写全局或项目 Pi 设置。
- resolveModel 仅路由虚拟模型。实体模型直接使用当前模型，虚拟模型才经公开路由解析；认证、headers、env、重试和 durable stream 继续沿用当前会话。
- 扩展异常会被 SDK 吞掉并回落默认摘要。失败返回显式 cancel，并将具体失败交回宿主，避免意外使用放大的触发 reserve；取消、重启保持既有边界。
- 手动 /compact 已有前台 durable run 时，摘要使用当前 run/turn；独立调用仍沿用原 utility run。真实账本已验证摘要只记一次。摘要明确标为 compaction 辅助请求，不生成普通 assistant 事实、不成为对话占用来源；压缩后的下一次真实请求继续使用 SDK 摘要，先前对话事实保持不变。
- 自动结果只从本次采集新建的运行目录提取当前 known issues；历史运行继续保留，但旧 F1 不会覆盖本轮已修复的事实。critical 已登记新增浏览器流程，Pi/账本最低场景数提高；RPC 清单为新增的两个通道更新到 428，原有断言不放宽。新增共享模块只包含无依赖校验与 token 算术，按现有 Pi 端口机制精确登记；IPC 兼容清单仅增加两个新通道，语言文件按现有脚本排序并验证 JSON 内容不变。

### 验收口径

定向成功不替代完整验收。冻结源码后执行全部 33 项门禁，包含 65 个关键工作流与 6 组包测试，并检查每项执行前后源码指纹、日志、产物哈希和当前锁文件。此前失败记录保留在 `.cache/upgrade-20261018/followup-*.log` 和对应 manifest，未覆盖。

FullCalendar 7.1.0 与 http-cache-semantics 加固补丁继续作为批准例外。其他平台、容器、签名安装器和真实供应商账单没有执行证据时不计通过；本机 Windows 的 server-build 仅可记为环境受限。未安装全局虚拟化环境、未触碰真实凭据。

### 验收期记录

首次完整 critical 在 workspace-recovery 的暂存目录 rename 报 Windows EPERM；相同源码独立复跑 10 项通过，根因未确认，不据此宣称产品或环境归因。原始 critical-t9f7IL 与 gate-logs-1792502984626 等历史目录保留。本轮继续以最终源码重新执行完整 critical 和整轮门禁；单独绿色复跑不替代完整验收。

<!-- upgrade-closeout-results:start -->
## 自动采集的最终门禁

采集时间：2026-10-20T14:44:25.741Z。通过 32，失败 0，环境受限 1。适用门禁已通过；环境限制与批准延期不计为通过。

每个门禁记录执行前后源码指纹、完整日志及哈希。当前 Git、锁文件全图 churn、改动文件哈希和各次历史失败都由脚本读取；以[机器结果](../verification/results/upgrade-2026-10-18.json)为当前验收结论。
<!-- upgrade-closeout-results:end -->
