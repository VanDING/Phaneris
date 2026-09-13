# 内置规范与 System Prompt 调整

## 目标与范围

先让内置文档准确描述当前实现，再让 system prompt 依赖这些文档。范围是产品内置规范、工具说明和 prompt；不修改个人偏好，不新增任务分类器，不扩展 `call_llm` 图片能力，也不改变运行时权限或审批实现。

## 规范归属

| 内容 | 归属 |
|------|------|
| 接受的参数、工具是否存在 | 工具 schema / 注册表 |
| 实际权限、路径、并发与状态限制 | 运行时实现 |
| 用法、格式、示例、恢复流程 | `apps/electron/resources/docs/` |
| 用户目标、授权连续性、失败分类、完成证据、能力选择 | 内置 system prompt |
| 项目约定、项目知识、用户偏好 | 保留现有上下文注入路径 |

文档与 schema 不一致时，不能通过文档创造能力；schema 接受某字段也不证明运行时执行它。`blockedTools` 就是需要明确注明的兼容字段。

## 文档校准

- `llm-tool.md`：保留工具用途，改为当前 Pi 调用路径；明确文本附件、主会话视觉与子调用图片的区别，删除旧 API-key/OAuth 功能矩阵；不再承诺 thinking 参数、固定模型或强制 JSON 输出。
- `permissions.md`：说明 `blockedTools` 不生效、实际合并层级、plans/data/custom-path 例外，以及 Explore 到执行的审批边界。
- `skills.md`：统一 project > workspace > global；明确 `globs`/`alwaysAllow` 只有兼容元数据意义，修正创建、覆盖与排错说明。
- `html-preview.md`：与用户点击导航和外部资源加载行为对齐，撤回完整进程隔离保证。
- `artifacts.md`：新增交付选择、路径、revision、inspect/submit/accept、冲突与租约恢复指南；各 Preview 和表格指南链接至此。
- 配置指南：写明启用 CLI 时的强制路径，不再只称“推荐”。
- `data-tables.md`：明确 transform 输入根、已知环境变量过滤、平台隔离差异和失败后的处理。
- `automations.md`：补齐实际已支持的 script action、参数、运行环境、超时与并发跳过行为。
- `statuses.md`：移除属性表残留的旧颜色格式。

## Prompt 结构

按以下顺序组织：

1. 环境识别与身份。
2. 执行契约：当前请求、规则范围、不可信内容、跨轮状态、工具事实。
3. 权限与审批：模式、SubmitPlan、已有授权、外部操作、用户保留动作。
4. 失败恢复与完成定义。
5. 文档索引与加载规则。
6. 能力选择和必要边界：sources/skills、call_llm、browser、Artifacts/Preview、Pages、session 管理。
7. 沟通与有条件功能。

删除长浏览器命令列表、重复 Preview 示例、内联转换脚本、表格列 schema 和 Pages 桥接细节，保留使用时机、文档入口和高代价错误的边界。小表格也必须读表格指南，避免只删除 schema 而保留“20 行才读文档”的断层。

保留现有静态/动态上下文拆分与用户偏好注入；不在每轮根据推断场景重排 system 前缀。快编辑 mini prompt 同样遵守配置文档和模式边界。打印 prompt 的调试脚本改为描述当前 Pi 组装方式，不再声称使用 Claude Code preset 或每会话仅构建一次。

## 验证

自动检查覆盖文档入口与相对链接、`call_llm` 参数表和真实 schema 的一致性、权限/Artifact/script-action JSON 示例、核心 prompt 的模式措辞、用户接受边界、连续构建稳定性、项目上下文转义及已有动态块拆分。共享包类型检查用于捕获模板与索引接线错误。

2026-09-13 的基线测量（同一工作区占位路径、同一功能配置、显式空个人偏好，比较双方均不包含共同作者块）：内置 prompt 从 38,146 字符降至 20,371 字符，约减少 47%。这是字符数，不是 tokenizer 实测，也不代表成本或遵循率同比改善。

行为验收还应观察：只分析不实施、已授权执行不重复 SubmitPlan、主会话图片/子调用图片区分、写入结果不明时先查状态、Artifact 提交不冒充最终文件、压缩后按需重读文档。本次静态/schema 回归不等同于真实模型会话 A/B 评估。

## 仍然存在的运行时边界

- `call_llm` 图片附件尚未接通；修正文档不等于补齐该能力。
- 浏览器工具在 Explore 整体可用，读写边界目前依赖任务规则而非逐命令强制判定。
- prerequisite 的“已读”登记不等于文档成功完整进入上下文；prompt 要求成功读取，但本次没有改门禁状态机。
- `blockedTools`、skill `globs`/`alwaysAllow` 的兼容字段未获得新的执行语义。
- `transform_data` 的 OS 隔离仍存在平台差异。

这些边界需要独立的运行时设计和验证，不能在文档里宣称已经解决。

## 2026-09-14：移除共同作者设计

删除内置 Git co-author 指令、prompt 参数和运行时偏好读取；偏好工具不再提供共同作者开关。旧配置字段仅保留读取兼容，不再影响 prompt。提交署名由用户当前要求和项目规则决定。
