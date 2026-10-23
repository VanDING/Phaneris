# 会话等待修复与 thinking 活动验证

2026-10-23；分支 `codex/model-harness-implementation`。本记录承接[现场复核](session-start-latency-review-2026-10-23.md)与[实现前失败矩阵](conversation-start-fix-failure-matrix-2026-10-23.md)。

## 实现范围

| 问题 | 已实现的行为 |
| --- | --- |
| 模型输出思考，客户端仍无内容 | Pi 只传 thinking 增量与块编号，宿主按 50ms 批量转发；更换请求、输出通道或块时先刷新，保留顺序，不传累计 partial。 |
| 思考显示与工具不一致 | 普通活动行，仅图标与一行文字，没有专用背景、边框或标签。点击或键盘激活进入现有全屏详情，列表内不展开；整轮导出包含思考。 |
| 多轮思考的位置 | 每次模型请求产生自己的思考活动，与工具交错：思考一 → 工具 → 思考二。完成与重载沿用原块身份，不汇总到整轮顶部，也不混入最终正文。 |
| turn 收起时仍看不见思考 | 收起摘要识别最新 thinking，与 commentary 使用同一摘要机制。保留原有 turn 展开状态管理。 |
| 停止时丢失已经收到的思考 | 结算时先刷新宿主增量，保留该请求的已接收思考与部分正文，保存到会话显示记录；不凭空提交模型成功结果。 |
| 短中文正文在暂停期间一直不显示 | 2.5 秒期限有真实定时刷新，不再要求超时后仍满足五个空白分词。完成态立即显示。 |
| 浏览器截图等待没有上限 | 整页与区域截图等待最多 20 秒，支持取消；批次失败或取消后不继续下一项，保留前面已经完成的结果。仅限制读取等待，不将外部写操作超时伪装成无副作用。 |
| 停止后迟到的工具错误无法结算 | 已观测错误与成功均进入已知结果记录，提交实际错误 T2；没有结果的未知效果继续保留 recovery，禁止清库或盲目重放。 |
| DeepSeek 自定义端点兼容信息遗漏 | 仅对 DeepSeek 模型及已识别的官方 / OpenCode 主机保留 native thinking 格式、`max_tokens` 和 reasoning_content；off 显式 disabled，max 保留。未知自定义端点不猜测添加私有参数。 |
| 辅助模型按认证名称误选 | 自定义兼容连接在没有显式 utility 模型时使用所选主模型，不因认证叫 OpenAI 就优先探测未配置的 OpenAI 小模型。显式配置仍优先。 |

skill 保持默认不发现、不主动启用。没有修改用户连接、max、会话、历史未知工具效果或生产 Runtime 数据。

## 可重复验证

```powershell
bun run verify:conversation-start
bun run test:native-client
bun run scripts/verification/client-platform-workflow.ts
bun run test:long-session-budget
```

每个 workflow 在 `.cache/verification/` 生成独立 manifest、产物哈希及未测范围。验证产物完整性：`bun run scripts/verification/verification-artifacts.ts --verify=<目录>`。

| 验证链路 | 当前证据 |
| --- | --- |
| 真实 Pi → Runtime Host → SessionManager → 会话存储 | `conversation-startup-diagnostic-8JnO3r`，8 项通过。max/off 的真实 wire 与稳定会话头已捕获；thinking 在正文前到达客户端事件，取消后的该请求思考可从存储重载。 |
| 真实浏览器批次运行器与永不返回的 capture 端口 | `conversation-browser-settlement-1VFlFm`，3 项通过：期限、取消、保留前项结果。 |
| 实际事件处理器、活动投影及组件 | `conversation-thinking-client-50hNPp`，7 项通过：流式先到、单行、全屏与键盘、十万字符、完成与快照恢复、思考和工具交错、短中文超时刷新。包含浅色与深色截图。 |
| 真实 Pi / SQLite 的中断与恢复 | `pi-interruption-recovery-9XjE8l`，23 项通过；新增验证停止后工具迟到错误仍提交 T2 并解除 pending。 |
| 已有 harness 回归 | `bun run verify:model-harness`，61 项通过，覆盖契约、权限、效果排序、prompt 组装与任务连续性。 |
| 完整 Electron 应用、真实 Pi 和持久化 | `native-client-ivOpUo`，29 项通过。思考先于正文，进入实际共享全屏查看器；停止后的思考保留在服务端会话快照，既有权限、计划、恢复、重连与原生退出场景保持通过。 |
| 生产 WebUI、真实服务端与 Pi | `client-platform-cE2M6C`，27 项通过，包含实际思考显示、全屏查看和中断保存；既有权限、计划、重连与布局检查保持通过。 |

独立组件通过不替代原生客户端通过：首次 Electron 验证发现 turn 默认收起而摘要未包含 thinking；随后补齐摘要并在实际客户端流程中先展开 turn，再点击思考详情，复验通过。

上述前四项已通过最终统一入口 `bun run verify:conversation-start` 连续复验，共 41 项；已知的过期 settlement 在处理增量前检查当前 run 身份。成功产物均通过独立 SHA 校验。

`typecheck:all`、`lint`、i18n 的 parity/sorted/coverage/dead-keys、文档、identity 与 version 检查通过；新增入口另通过 `typecheck:scripts`。既有相关测试 141 项及活动生命周期 / 增量投影 21 项通过。视觉检测仅报告已有 TurnCard/ChatDisplay 的 radius 与颜色 advisory，新增思考行没有特殊样式命中。

既有 wire 测试原来断言丢弃 thinking，这与本次修复目标冲突；只同步了该测试的既有断言，没有新增事后单元测试。新增覆盖以先行失败矩阵与 E2E workflow 为主。

## 长会话预算限制

没有修改或放宽预算。首次与构建并行运行时初始化和追加均失败（`long-session-budget-8rGFG3`）；随后独立运行的 `long-session-budget-SQGWbL`，200 轮首屏 7,468ms、滚动 P95 16.7ms，追加 P50 **66.7ms** / P95 **100ms**。五项中的四项通过，追加中位数超过既有 60ms 门槛。

使用不改工作区文件的 Vite 源码替换，将四个本次修改的 UI 模块加载为 `674c9de02` 版本，保留同一 fixture、CSS、浏览器和门槛，得到 `long-session-budget-baseline-nvJuqF`：追加 P50 **66.7ms** / P95 **116.6ms**，同样在中位数门槛失败。基线源码 SHA 已落盘，实际服务的 TurnCard 也确认不含新增组件。该对照未显示本次改动使此项恶化；但不能把一次对照当作全面性能等价证明，也不能宣称长会话预算全绿。这里记录为既有性能门槛的未通过项，不扩大成无关的渲染重构。

## 结论边界

- 修复了已经确认的反馈断层、正文缓冲以及截图等待和已知错误结算问题；并不保证真实模型从此立即输出正文。
- 分钟级 thinking-only 输出是实际模型行为。为何本项目更容易触发，需要同路由、同历史、同工具与预算的重复控制实验；本次未对线上 provider 做 A/B，不能声称改用另一 API 已验证有效。
- 截图验证注入永不返回的端口，尚未复现用户现场的原生 CDP / capturePage 悬挂。20 秒后原生只读调用可能稍后完成，但不会恢复已经停止的批次。
- thinking 只展示 provider 实际返回的可见内容。隐藏、签名或不返回思考的模型不会生成伪造的思考行。已打开的详情遵循其他活动的点击时快照机制。
- 旧的 `recovery_parked` 和未知效果没有批量清理；仍需逐项核对，不能把修复新请求与清除历史恢复依据混为一谈。
