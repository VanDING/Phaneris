# Model harness implementation

Branch: `codex/model-harness-implementation`

Baseline: `8531313baa5088df83c7dcf0332bbf1801be80dc`

目标：使模型所见能力、权限、执行结果与任务状态一致，减少错误拒绝和不必要的等待。

## 已确认的设计约束

- 2026-10-22 用户确认：skill 保持当前默认不被发现、不主动启用的状态。这是产品设计，不作为缺陷或待补能力。
- Skill 相关改动限于现有显式调用后的加载确认、缓存一致性、资源解析与任务连续性；不新增默认技能目录注入、自动发现或主动启用。
- 本轮工具检索改进针对已连接 source 的工具，不扩展到 skills。

## 实施顺序

- [x] 首批能力真实性：联网名称与权限、effective mode、无效参数、Windows 平台说明。
- [x] 结果生命周期：计划提交等待宿主确认；认证结果决定继续或等待。
- [x] 工具发现：中文、重复查询、目录入口；继续使用 SDK 的 canonical active set。
- [x] 首批技能与来源连续性：成功/完整读取确认、缓存失效、原始 mention 重放、source 交付确认。
- [x] 计划接受版本：桌面、远程接受及压缩后接受保留内容快照；恢复保留目标和批准范围。
- [x] 提示词事实修正、插件来源与作用域、后台状态说明。
- [x] 类型检查、相关回归、真实 Pi 子进程集成。

## 仍待后续实施的范围

- 显式选用后的包限定资源身份一致性；遵循上述 skill 设计约束。
- 参数效果级 browser/自动化审批、同资源并发与未知副作用恢复的联合 E2E。
- 最小执行计划状态与看板/任务编排的投影，不能以批准快照冒充完整工作状态。
- 主 prompt 的职责拆分、工具家族渐进披露、实际 token 与辅助模型消融评测；按行为收益决定默认策略。
- 真实 provider、实际浏览器 UI、交互式 OAuth 与 Linux 隔离验证。

## 首批验证

重复执行入口：`bun run verify:model-harness`。

- 21 个契约集成场景：真实权限函数、工具处理器、资源生命周期；模拟宿主与目录，不调用线上模型。
- 6 个真实 Pi 子进程场景：实际 SQLite/T1/T2、失败读取恢复、宿主确认、计划暂停和下一轮继续；推理由 loopback fixture 驱动。
- 566 项相关既有回归通过；session-tools-core 的 131 项通过；pre-tool-use 73 项通过；prerequisite 33 项通过；prompt 19 项通过、1 项平台跳过；桌面批准、pending dispatch/persistence、plugin 合计 19 项通过。这些集合有重叠，不汇总为独立用例总数。
- `typecheck:all`、全仓 `lint`、`check:docs`、i18n coverage/parity/sorted/dead-keys、`identity:check` 和 `version:check` 均通过。文件行数预算保持原值。

每个 workflow 在 `.cache/verification/` 下生成独立目录，包含场景结果、调用轨迹、数据库证据及带源码哈希的 manifest。未把 fixture 推理结果当作真实模型质量收益。

## 实现前登记的失败场景

1. Explore 将 namespaced web 工具拒为配置变更，Ask 对其弹 mutation 审批。
2. 不可信 source 使用内部工具后缀获得 allowlist 权限；未知操作静默放行。
3. Guarded 未启用时状态仍仅报告 Guarded，而实际执行 Ask。
4. `call_llm` 宣告不生效的 thinking 参数；平台说明引用不存在的 shell。
5. SubmitPlan 在宿主读取/展示完成前返回成功；宿主异常没有传回工具。
6. OAuth 静默刷新无需用户交互，仍因为工具名中断会话。
7. 中文检索零召回；重复查询误报没有匹配；空查询没有目录。
8. 读取失败、部分读取被当成技能完整读取；技能修改后目录不更新。
9. source 激活重放丢失原 skill 选择；旧 source 状态压过新状态。
10. 接受的计划路径不核验、内容版本未绑定，压缩后丢失批准范围。
11. plugin 上下文没有来源/版本/作用域；后台工具被描述成所有子任务的唯一状态来源。
12. 同资源并发、未知外部结果重试、真实模型质量收益，需要单独 E2E，不能用局部测试冒充。

首批验证先覆盖 1–7 的真实函数与宿主/工具边界，输出 JSON。真实子进程测试沿用现有 durable-runtime-pi workflow。后续场景在对应实现前扩展失败用例。

本轮不覆盖用户已有的 packaged-client 验证结果、`.analysis-tmp/` 和 `x.ts`。
