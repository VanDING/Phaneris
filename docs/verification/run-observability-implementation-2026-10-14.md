# Run 观测首轮实施记录

用户已批准实施。源码范围为 Overview 的补充汇总、计时和 Decision 费用修复，以及原有详情中的诊断字段。Trajectory、Decisions、Context、Map 保留现有布局、样式和交互，不增加 Run 标签页。

## 已实施

| 内容 | 行为与口径 |
|---|---|
| 两处显示问题 | 英文 token 缩写使用 K/M，中文使用万；会话决策说明独立一行靠左。 |
| 请求计时 | 在原生 provider payload 回调之后观测发出时刻，采集首个非空文字、思考或工具输出及终止事件；同一进程单调时钟计时，持久化与 IPC 排除在外。 |
| 输出速率 | 每个点代表一次已结束请求的客户端观测平均值：输出 tokens ÷ 首输出至流结束秒数。汇总采用 Σ有效输出 tokens / Σ有效生成秒数；标明来源，保留缺口。 |
| TTFT 汇总 | 首输出延迟 P50/P95，分别显示 TTFT 与速率有效样本数；不再只读取第一条计时对象。首文字延迟在原有 Timing 详情单独显示。 |
| Overview 排列 | 原上下文增长柱图完整保留，小幅速率折线紧接其下。超过 200 条请求分桶，保留缺口和最小/最大范围；可以选择原始请求并定位原版轨迹或上下文。 |
| Run shape | 原形态条覆盖完整记录范围，分组摘要显示覆盖粒度并保留后段失败。 |
| Decision 费用 | OpenRouter 读取实际 `usage.cost`；其他网关保留原有 `usage.cost_usd`。显式 0 是已知零费用；缺失、负数、非数字和失败仍为未知。 |
| Decision 诊断 | 成功延迟包含完整响应解析与校验，失败延迟统计至失败/中断；保存实际 deadline、响应 ID、费用字段/来源和缺失原因，经原有账本和报告传到现有详情。 |
| 历史覆盖 | 旧调用与现代行为事项分别说明；缺少行为事实时实际改变和回退显示「—」。旧计时不混入新 TTFT 或速率。 |

Pi SDK 1.1.0 原生提供 `AssistantMessage.durationMs` 与输出 token 用量，没有统一的 TTFT 或 tokens/s 结果字段。原生 durationMs 从 SDK 流创建计至结束，包含首输出等待和发送前准备；输出阶段的速率还需要首输出事件。当前指标受网络和 SDK 流式交付影响，不等同于供应商服务器的解码速度。

覆盖率以现有 Run 请求头投影中的已记录请求为分母，不代表所有底层网络尝试。无法区分的多次回调、失败或中断不进入比较统计；不足 1 ms 的终端集中交付窗口也不换算速率。

首轮没有实施实际活跃时长、按轮次筛选、重试摘要、缓存占比、费用分项、其他分布图或一秒瞬时速率。HTML 中相关控件仍属规划演示。

## 验证与证据

实施前已写 [失败路径矩阵](run-observability-failure-matrix.md)。没有新增单元测试。验证工作流使用临时配置、会话和本地受控接口，通过实际安装 SDK、provider 包装、事件传输、SessionManager、持久化重载、durable usage 账本、认证 RPC 及真实 Run 组件；不使用用户凭据和收费请求。

```powershell
$env:PHANERIS_TEST_BROWSER_CHANNEL = 'msedge'
bun run scripts/verification/run-observability-workflow.ts
```

- 工作流 28/28 通过，包含 thinking-only、tool-only、缺失用量、空输出、多次回调、错误/中断、慢提交、OpenRouter 零费用、延迟响应体、超时、历史与混合记录、1,001 条请求、中英文、深浅色、窄面板及原有页面交互。
- `typecheck:all` 通过；`lint:workspace` 通过（2,251 文件，72 项既有登记警告）。
- i18n parity、sorted、coverage、dead-keys 全部通过；runtime boundary 与 architecture 检查通过。
- `check:visual-contracts` 未全局通过：唯一剩余失败为工作区已有 `CompactModelSelector.tsx` 的过期豁免。Run 的旧字体豁免已经随语义字号修复移除，没有新增视觉豁免；未修改输入框组件。

复核产物在仓库 `.cache/run-observability/evidence/`：

| 产物 | 内容 |
|---|---|
| `verification.json` | 28 项断言、生成时间和临时数据位置 |
| `request-statistics.json` | 请求样本、TTFT 分布及可复算加权速率 |
| `decision-rpc.json` / `historical-decision-rpc.json` | 认证 RPC 返回的金额、来源、失败和历史覆盖证据 |
| `overview-en-960.png` / `overview-zh-960.png` | 实际 Overview 组件，原柱图与下方速率图 |
| `original-timing-detail.png` / `original-decisions-zh.png` | 原详情布局中的新增解释信息 |
| `original-context.png` / `original-map.png` | 原有页面回归截图 |
| `overview-narrow-530.png` / `overview-dark-390.png` | 窄面板与深色界面 |
| `long-history-1001.png` | 长历史分桶、缺口与慢请求 |

这些截图使用本地受控请求，证明实际组件与数据链路，不代表用户历史会话的新计时。旧数据未采集的时刻或费用不能恢复；完整新口径由更新后的 provider 子进程在后续请求中采集。当前交付为源码修改，未发布、推送或重启用户应用。
