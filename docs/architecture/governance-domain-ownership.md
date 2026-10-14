# 配置、协议与装配职责

Status: accepted

本裁定配合 [实施计划](../archive/architecture-code-governance-implementation-plan-2026-10-11.md) 和 [先行失败矩阵](../verification/governance-completion-failure-matrix.md)。旧入口保留兼容；新领域模块引用具体 owner。

| 配置职责 | 唯一 owner | 兼容策略 |
| --- | --- | --- |
| config.json 的读写、初始化、备份和删除 | repository.ts | storage.ts re-export 同一函数；无新 cache |
| 纯持久类型、schema、JSON 与连接归一化 | persisted-types / schemas / source-validation / connection-normalize | 浏览器闭包禁止文件系统、agent 和宿主 authority |
| 默认配置、bundled assets | defaults / bundled-assets | 同一同步标记和原资源回退语义 |
| 主题、输入及宿主偏好 | appearance | 主题文件独立持久化，config 字段统一委托 repository |
| LLM 连接访问 | connections | 迁移在 startup 显式调用，读取不触发升级 |
| workspace 选择、远程 token 缓存 | workspace-selection | 唯一缓存；vault 成功后删除缓存 |
| session 草稿 | drafts | 旧 JSON 与 Windows 路径兼容 |
| 一次性升级 | migrations | 原顺序和标记不变；纯 helper 在 connection-normalize |

协议入口只引用纯契约。网络输入为 unknown，51 个高风险输入契约在 dispatch 前校验，原 handler 的 workspace/path/transfer owner 检查继续执行。未知字段与可选参数的 JSON null 保留兼容。动态第三方 channel 的结果保持 unknown；已定义的 response port 复用既有 DTO。timeout 放弃响应，不能据此自动重试 mutating RPC。

Pi 按下列 owner 表实施；不将所有状态集中到一个可变 context。

| Pi 状态 | 有限 owner / 接口 | 禁止事项 |
| --- | --- | --- |
| JSONL/stdout/stderr/断管 | transport 的 send、debug、listen | stdout 诊断输出；自动重启执行 |
| SDK session 与创建 promise | session lifecycle 的 getOrCreate、reset、current | 并发创建第二 session；发布已失效的创建结果 |
| pending permission/tool/T1/T2/credential 回应 | 每种回应独立 registry 的 register、settle、cancelAll | 迟到/重复响应二次 settle；把未知 effect 当可重试失败 |
| tool catalog / allowlist | tool composition 的不可变集合产物 | 首轮工具与后续工具来源不同 |
| model/auth | model-runtime-owner 持有子进程 HostCredentialStore/ModelRuntime；入口接收宿主传入的 auth/model 快照 | 读取宿主 vault 或引入第二 credential authority |
| durable accounting | 原 AsyncLocalStorage 与模型边界；durable-tool-accounting 私有 batch/commit，通过有限方法记录和读取 | 新 store / coordinator / execution slot |
| SDK event → wire | 既有事件适配和 finite emit port | adapter 持有可变 SessionManager |
| shutdown | 入口调用各 owner 收口 | orphan timer、Promise 或 SDK session |

注册副作用按 Bedrock → Bun OAuth → default stream 的现有顺序保留。构建验收必须使用独立 Pi bundle；source smoke 与真实 provider、签名、其他平台验收分开记录。

连续 JSONL 初始化使用唯一 barrier；prompt 等待完成，活动回合中的 abort/回复不被整回合串行锁阻塞。SubmitPlan/Auth 成功结果先完成 T2，子进程才暂停 SDK 推理；driver 保留队列直到 agent_end，Host 才收敛终态。普通取消与未知 effect 的恢复政策不变。

客户端草稿由 use-draft-persistence 持有待保存绝对快照、timer 与单一写入 promise。同一版本确认成功才移除，断线保留最新值、连接后保存，workspace binding 变更前必须 flush。队列只接受草稿快照，不承担消息或工具 effect 重试。平台新增有限 drafts port，与已有 session、connection、file、navigation、preferences、notification/clipboard port 一起在业务挂载前初始化。

Session 产品字段由 agent-product-context 的 snapshot 和 agent-product-callbacks 的有限 read/patch/persist/flush/event ports 装配；不传递 ManagedSession 或 Manager。agent-assembly、产品 callback/context、source-resources 和 product-repository 的完整解析闭包禁止反向到 Manager 或 Host/store/coordinator 内部。Manager 继续适配产品 API 和既有 Runtime Host，不用文件数量或总 LOC 代替行为验证。

workspace 切换先通过 input-draft-flush 的 mounted composer lease 捕获同步快照，再等待 draft owner 持久化。失败保留原界面与绑定；成功后才卸载旧订阅和使用新 ACK binding。logout 的 deleteConfigFile 只由 repository 执行，不调用会递归删除工作区的 clearAllConfig。
