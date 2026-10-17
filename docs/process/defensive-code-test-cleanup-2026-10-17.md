# 防御逻辑与测试精简治理

状态：治理实施、全仓测试与 CI 完成；核心聚合和 server 装配的验证限制已记录。日期：2026-10-17（Asia/Shanghai）。

## 范围与基线

- 起点：`062bd1f25`，Bun 1.4.2、TypeScript 7.0.2、React/Electron，13 个 workspace。
- 生产路径：客户端 → RPC 输入契约 → server-core 编排/Runtime → Pi JSONL 子进程；磁盘配置、历史会话与第三方响应均是运行时边界。
- 初始工作区已有两份 packaged-client 验证 JSON 修改及七个未跟踪设计目录；本任务不修改这些内容。
- 对全部受版本控制的代码做文件盘点；对 JS/TS 做 AST catch、相同分支及测试扫描。扫描信号只用于定位，不作为自动删除依据。
- 初始统计：生产源码 1,528 文件 / 340,852 行；测试及夹具 612 文件 / 100,232 行；工具代码 274 文件 / 39,631 行。生产口径为 apps/packages 的 src，排除测试、夹具、声明；测试口径含 tests、__tests__、fixtures 及 test/spec/isolated 后缀，含开发 Playground 的生产口径不等于发布包。
- 基线全 workspace 测试、类型检查、lint 均通过；生产 build smoke 的五个 bundler 通过，后续 server 装配在 win32 上不支持。结果见本任务最终报告及证据，不把期间日志里的预期错误当作测试失败。

## 清理清单

| 编号/类别 | 位置与现状 | 证据、方案与风险 | 验证 / 状态 |
| --- | --- | --- | --- |
| A01 明确冗余 | messaging-gateway/registry.ts，saveWeComCredentials 的 catch 原样重抛 | catch 不恢复、不清理、不转换；删除 try/catch，保留连接顺序及持久凭据。低风险 | 原有 WeCom registry 测试；已实施并通过分批验证 |
| A02 明确冗余 | useOnboarding.ts，isPiApiKeyFlow 两支逐字相同 | 合并 API key 检查，删除失去用途的局部变量及回调依赖；保留 loopback 无 key、编辑保留凭据、Bedrock 提前返回。低风险 | AST 相同分支证据、全类型检查/构建；已实施并通过分批验证 |
| A03 明确冗余 | session-tools-core/tool-defs.ts，固定注册表转换可选方法与空对象兜底 | 每个 inputSchema 均由本模块 Zod 构造，锁定 Zod v4 原生转换；直接转换，不把内部 schema 损坏伪装成空契约。保留 schema 元字段移除。低风险 | 全注册表、过滤/前缀组合前后输出一致；既有 tool-defs 测试/Pi 工作流；已实施并通过分批验证 |
| A04 明确冗余 | tasks/validate.ts，私有 DAG 遍历中的空边/level 兜底 | materializeDeps 为每个节点建集合，且只添加已存在节点；metrics 只在无环时执行且先逐节点填 level。删除三个不可能缺失的默认值；可选业务字段默认值不动。低风险 | 既有 schema/graph/TaskRunner 测试与前后结果比对；已实施并通过分批验证 |
| B01 可以简化 | automations/validation.ts，相同 JSON 反复解析、重复类型检查 | 解析成功后复用原始对象，私有语义校验只接收已过 schema 的数据；保留原始事件名以维持 alias 警告路径；外部 JSON/schema/regex/cron/时区保护不动。中低风险 | 实施前记录失败场景与行为快照；既有 validation/security/conditions 测试及 config-domains 工作流；已实施并通过分批验证 |
| B02 可以简化 | domain/connection-setup-logic.ts，已提取 modelIds 后重新判断首元素类型 | 复用 modelIds[0]，不改变空列表与 defaultModel 行为，不移除参数入口防护。低风险 | 移动前保留所有不同契约测试；已实施并通过分批验证 |
| A05 重复测试 | Electron 与 server-core 的 connection-setup-logic 测试 | Electron 测试直接导入同一 server-core 函数，无 Electron 行为；将独有 model/error/template 测试归到 owner 文件，去掉完全重复的 setup/mask/key resolution 及重复对象模型案例。保留 #1048、ModelDefinition 比较的真实回归。低风险 | 迁移前后用例对照、owner 测试；已实施并通过分批验证 |
| A06 重复测试 | 两份 no-hardcoded-z-index.test.ts | 两个 CJS 文件均直接 re-export 同一 scripts 规则；保留一套共享规则测试，删除另一套重复 Linter 配置/断言。低风险 | 保留套件及全 lint；已实施并通过分批验证 |
| A07 无效测试/辅助入口 | watcher-duplicate-guard.test.ts / _getActiveWatchers | 测试仅断言 Map 和 size 类型，空 beforeEach，根本没 start/stop 或触发 duplicate；删除两项及唯一消费者的测试专用 getter。重复 watcher 检测注册表和生命周期保护不动。低风险 | 全仓消费者检索、全测试/类型检查；此项不宣称已有行为级 duplicate 回归覆盖；已实施并通过分批验证 |
| A08 过度 Mock/历史测试 | apps/cli/src/run.isolated.ts | 不调用 cmdRun，手工复刻 RPC 调用并断言自设响应/调用顺序；spawnServer 完全 mock，parseArgs 与 commands 重复。删除该文件及仅其使用的 mock server/module mock。不是有效 cmdRun E2E，不能把它当作失去的 E2E 覆盖。低风险 | commands、真实 socket client、server smoke、剩余 CLI 回归；真实 cmdRun bootstrap 的专门 E2E 缺口记录为遗留；已实施并通过分批验证 |
| A09 重复测试 | renderer/lib/mentions.test.ts 的 skill/source describe | renderer 入口直接重导出 shared mentions，同样输入输出由 shared 更完整测试覆盖；删除这两组，保留 renderer 的 extractBadges/资格解析测试。低风险 | shared mentions 与 renderer 剩余测试；已实施并通过分批验证 |
| C01 需要确认 | automations workspace 校验的广泛 catch；多处磁盘读取空结果 | 含 labels/config 等 I/O，可能约定为尽力提供诊断；尚无证据能改变失败契约。保留并列遗留，不因注释说“不该发生”就删除 | 不实施 |
| C02 需要确认 | config/migrations.ts 的旧模型恢复分支、provider/API 响应兼容和备用发现路径 | 持久旧数据与外部模型目录不是仅凭类型即可确认的不变量；需部署与历史数据证据 | 不实施 |
| C03 需要确认 | 文本匹配源码的 Pi toggle/cache 等测试 | 依赖内部实现，确有脆弱性；暂未证明既有真实进程工作流覆盖每个 live setting 行为，不整体删除 | 不实施 |
| C04 需要确认 | agent/backend/factory.ts 的单 Pi driver registry 及可选 driver 方法 | registry 虽只有一项，但 testBackendConnection/createBackendFromResolvedContext 等导出入口携带 provider，未知 provider 的明确失败和 driver fallback 仍属当前行为；移除需先厘清外部调用契约，不能只依据 AgentProvider 的单值类型 | 不实施 |
| C05 需要确认，尝试已撤回 | markdown-popout-workflow.ts 的全应用预打包入口及浏览器启动 | 原始扫描 298 秒，随后 Playwright 本机 WebSocket ECONNRESET，场景断言未执行；尝试限定 fixture/隔离缓存仍未完成启动（370 秒后停止自建进程）。虽存在初始化成本，但未得到行为验收证据，已撤回两行配置，原脚本和断言保持原样 | 失败和中断原始证据保留；需进一步调查本机 Vite/Bun/Playwright 启动；不宣布通过 |
| D01 必要保障 | protocol/contract 校验、权限/Origin/token、路径隔离、Runtime T1/T2、清理/生命周期、mock 隔离 | 分别承担不可信输入、权限、数据一致性、资源及进程级状态职责；重复外观不能证明重复职责 | 保留，整体回归验证 |

## 实施前失败场景与验证方法

| 修改域 | 必须防止的失败 |
| --- | --- |
| Zod 工具 schema | 丢失 required/properties/枚举；prefix 或过滤改变；把 $schema/additionalProperties 重新发给下游；空 schema 掩盖编程错误 |
| 自动化 | 非法 JSON/schema 不再明确报错；alias 警告消失或改用 canonical 路径；未知事件过滤改变；Webhook 变量提示丢失；非法 regex/cron/timezone/条件不再报错；磁盘入口丢失 workspace 校验 |
| DAG | 误删未知依赖/自循环/环检测；空图指标改变；深度/宽度与隐式引用边改变；递归走入不存在节点 |
| 配置连接 | ModelDefinition[] 与 string[] 的默认选择不同；masked key 泄漏到 provider；loopback/远程 key 要求改变；错误映射及 template 行为丢失 |
| 测试清理 | 移除独有回归而非重复用例；丢失 runner 显式引用；删掉仍在用的辅助入口；用模拟流程冒充真实流程覆盖 |

先保存这些真实 API 的正常/异常输出快照，修改后比较。复用已有隔离测试和真实进程工作流，不新增平台或强制门禁。每批验证后更新状态；最终执行全 workspace 测试、类型检查、lint、既有验证及真实生产构建。

## 执行与结果

全部保留的 A/B 项已实施并通过对应分批验证，83 组前后 API 行为输出完全一致；试验中的初始化简化已撤回并列为 C05。全仓 6,262 pass / 7 既有 skip / 0 fail、完整 CI 通过；六组核心测试 243 项及 36 个工作流 500 场景通过。核心聚合实际退出 1，后续 7 个主题浏览器工作流未运行；独立 server 装配仍不支持 win32。详见[交付报告](../verification/defensive-code-test-cleanup-2026-10-17.md)。C/D 项按表保留，不作全平台可靠性承诺。
