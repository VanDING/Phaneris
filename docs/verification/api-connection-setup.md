# API 接入与 AI 设置修订验收

日期：2026-10-28。失败场景定义见 [验收矩阵](api-connection-setup-failure-matrix.md)。

## 1–9 项结果

| 项目 | 处理结果 |
| --- | --- |
| 1. 接入方式切换闪烁 | 接入向导使用单个当前步骤，取消两个不同高度页面的交叠淡入淡出。 |
| 2. 模型可选但空值不能接入 | Custom 在发送测试请求前发现模型；保存实际测试过的默认模型和目录。 |
| 3. 普通 provider 与 Utility Model | 普通接入仅填写 provider 和密钥；实例型服务保留必要地址或身份字段。AI 设置提供按连接配置的辅助模型入口。 |
| 4. Custom 不填写模型 | 地址、协议、适用凭据即可自动发现；无法列出模型的端点提供折叠的手动回退，不预填其他厂商的模型。 |
| 5. 连接图标 | 连接图标不再从默认模型推断；OpenCode 和 Command Code 使用官方资产，未知服务采用端点图标或名称首字。 |
| 6. 决策开关不可用 | 核实为功能退役，与 Jev 能力无关；隐藏三个已退役的开关，保留底层兼容字段。 |
| 7. 自动压缩阈值 | 增加 50%、60%、70%、75%、80%、85%、90%、95% 选项，按当前模型窗口计算；支持旧 token 配置和恢复 SDK 默认。 |
| 8. 图像兼容接口 | 支持显式选择 OpenAI 兼容连接并指定图像模型；调用 Images API 的 `POST /images/generations`，要求返回 `b64_json`。 |
| 9. 自动输出上限 | 自定义 Chat Completions 普通调用默认省略 `max_tokens` 和 `max_completion_tokens`。显式限制、摘要、压缩、交接、缓存预热的预算仍保留。 |
| 追加：未知费用显示为零 | 用量投影提供有效计价请求数，界面区分未知价格、真实零费用与部分已知小计；不修改历史用量事实。 |

辅助模型用于标题、摘要及 `call_llm`；不必在接入时选择。`call_llm` 显式传入模型时优先使用调用参数。

## 核实结论

### 决策功能

`RETIRED_DECISION_FEATURES` 明确列出 `adaptiveThinking`、`midTurnMessages`、`largeResults`，执行入口也会拒绝调用它们。提交 `ab0282111` 与 `bc2f436a0` 记录了退役及相关改动：

- 自适应思考：保留用户选择的推理级别，不再由决策模型自动下调。
- 轮次中消息：由连接的消息投递策略决定，不再自动分类改变投递。
- 大型工具结果：保留可恢复的原始证据，不再自动筛除。

旧字段继续保留兼容；已退役的灰色开关已从界面隐藏，不因更换 Jev 版本而重新开启。验收还覆盖了旧配置中这些字段为 true 的情况。

### 压缩默认值

应用未设置覆盖时跟随当前 Pi SDK，默认预留 **16384 tokens**。触发位置为模型窗口减去预留量，因此不是固定百分比：200000 token 窗口约为 91.8%，1000000 token 窗口约为 98.4%。百分比覆盖仍保留 SDK 的最低安全预留。

### 输出上限与兼容协议

Command Code 的公开模型列表报告上下文长度及 `supported_endpoints`，不能据此推断最大输出。原有缓存可以继承 OpenRouter 同名模型的超大输出上限；修订后，自定义端点的输出元数据以该端点报告为准，缺失时保留保守的内部能力预算，刷新会纠正旧缓存。

OpenAI Chat Completions 的输出上限参数可省略；Anthropic Messages 仍需要输出预算。省略参数后，长度、截断行为、耗时与费用由服务端默认值影响，不会取消服务端硬上限。

参考：[Command Code Provider API](https://commandcode.ai/docs/provider)、[GOAT 计划](https://commandcode.ai/docs/plans/goat)、[OpenAI Chat Completions 参数](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI 图像接口](https://developers.openai.com/api/docs/guides/image-generation)。聊天协议兼容不等于支持图像生成。另已移除关闭服务的 GPT Image 1 选项，并将 GPT Image 2 透明输出交给服务端检查预览权限。

## 验证记录

| 检查 | 结果与证据 |
| --- | --- |
| 接入链路 | 14 项本机检查通过；产物目录 `.cache/verification/api-connection-setup-5Nkh9x/`，内含 `acceptance.json`、`manifest.json`、`trace.zip`。包含浏览器、真实 RPC handler、SDK、本地 HTTP 端点及持久化配置。 |
| 完整 AI 设置页面 | 22 项本机检查通过；结果 `.cache/ai-settings-structure/results.json`。包含中文、深浅主题、窄屏、辅助模型、百分比选项及兼容图像模型编辑。 |
| 百分比、计费与真实 WebSocket RPC | 完整工作流 12 项本机检查通过；产物目录 `.cache/verification/upgrade-0153-followup-browser-SLeLyk/`，内含 `followup-browser.json`、`manifest.json`、`metering-ui.json`。包含非法值拒绝、保存失败恢复、重试、新服务进程读取和计价区分。 |
| 已有相关测试 | 51 项通过；覆盖连接表单参数、图标、图像服务、模型传递、运行时配置签名及用量投影。 |
| 静态与构建 | `typecheck:all`、完整 `lint`、四项 i18n gate、Electron main 与 renderer 构建通过。 |

上述 `.cache` 产物仅保留于生成它们的本机或 CI artifact，不随 Git 仓库分发。可重复运行：

```powershell
bun run scripts/verification/api-connection-setup-workflow.ts
bun run scripts/verification/ai-settings-structure-workflow.ts
bun run scripts/verification/upgrade-0153-followup-browser-workflow.ts
```

验证使用隔离配置、合成密钥及本地模型与图像服务，未使用真实付费账号生成内容；未覆盖安装包发布、物理设备合成器或其他操作系统。

## 追加修复：未知费用

回归发现未知价格参与求和后得到 0，界面无法分辨它和服务端实际报告的零费用。修订将 `knownCostRequests` 从去重后的原始用量投影传到界面；全部费用未知时显示“未知”，真实零费用显示 `$0`，混合记录显示已知小计和未计价请求数。保留旧记录并验证其内容没有被改写。完整 `upgrade-0153-followup-browser` 工作流已通过，不再遗留该失败。
