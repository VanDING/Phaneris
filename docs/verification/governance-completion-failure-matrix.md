# 剩余治理实施的先行失败矩阵

Status: accepted

本矩阵在 G3–G8 的生产改动之前建立。验证优先调用生产入口、独立进程、真实文件与生产 bundle；现有测试继续保留。每项通过必须有运行 manifest，未执行的平台或外部服务不得写成通过。

| 编号 | 失败方式 | 验证入口 / 判定 |
| --- | --- | --- |
| C01 | 兼容入口与领域入口有不同 writer/cache | 新旧入口交替更新同一临时配置，函数 identity 相同、结果一致 |
| C02 | 旧配置第二次升级重置用户选择或重复标记 | 真实文件升级两次，比较 JSON 与凭据 |
| C03 | 损坏 JSON 被加载成有效配置或误写覆盖 | 独立目录，load 返回 null、原始字节保留 |
| C04 | 同进程并发设置覆盖其他字段 | Promise 并发安排同步 setter，各字段全部保留；跨进程事务另行登记 |
| C05 | credential 失败抹掉旧 secret 或写入明文 | encrypted store 故障夹具、配置不含 secret |
| C06 | config dir / assets 路径串用宿主目录 | 两个子进程、独立 PHANERIS_CONFIG_DIR、缺 bundled assets |
| C07 | Windows draft / portable path 被拆分破坏 | Windows 绝对路径草稿持久化、Linux/macOS 本地路径往返 |
| C08 | 运行中连接更新不被真实消费者看到 | 旧新连接入口交替更新、现有 refresh-connection-runtime 场景 |
| C09 | schema/type import 读盘、加载 agent 或绕过 package export | 浏览器 bundle、解析闭包和故意违规 canary |
| R01 | 错误 RPC args/owner 在验证前产生副作用 | 实际 WebSocket server + handler fixture，错误输入/跨 workspace |
| R02 | 超时重试 mutating RPC、binary/旧字段破坏 | 实际 client/server timeout 与 codec 往返、effect 计数 |
| R03 | relative/barrel 跨层绕过 allowed-import | 解析图 fixture，违规必须失败；空扫描必须失败 |
| R04 | 根依赖借用再次增长 | 每对责任裁定、clean frozen install 与生产 build |
| P01 | pending response 重复/迟到，shutdown 悬挂 | 生产 Pi JSONL 子进程、真实 loopback provider；pending settle 恰好一次 |
| P02 | 注册副作用或首轮工具在生产 bundle 丢失 | 独立 Pi bundle，first prompt / subsequent / abort / MCP 更新 |
| P03 | durable T1/T2 与断管后重放未知 effect | 现有独立 Pi、crash、boundary 进程工作流 |
| S01 | builder 捕获整个 manager、写 Host 执行槽 | 独立配置装配入口 + 解析图禁反向访问 |
| S02 | lazy load/flush/刷新/取消/Task/utility 语义改变 | 现有 SessionManager/Runtime/Task 的真实集成夹具及 critical |
| S03 | 既有 mock 入口迁移遗漏后，回归测试读写开发者配置 | workspace/isolated 测试进程使用独立临时配置根，退出后清理；同步迁移既有 mock 到领域入口 |
| S04 | 异步加载后的 Error.stack 首行不含原始 message/cause，首故障诊断丢失 | 真实进程 hang/throw cleanup 注入保持原断言；诊断明确保留 name/message 和堆栈，继续经过既有 secret redaction |
| S05 | 原生 Electron 未处理 rejection 后继续接受调用，或清理没有有界退出 | 真实主进程完成交互后注入带 cause 的 rejection；核对原始诊断、13 秒内非零退出和退出后的 SQLite checkpoint |
| P04 | init 与 prompt 在同一 stdin 批次到达，提示词抢先创建 SDK | 保留离线生产 bundle 的真实连续 JSONL 验证；初始化完成后接收后续命令，活动回合中的 abort/回复仍并行处理 |
| P05 | Plan/Auth 交接先结束 driver queue，T2 到达时 Host 已停放 run | 真实 SubmitPlan 交互：结果提交后 SDK 停止后续推理，Host 才发布结束；接受后只继续一次。普通取消/崩溃仍保留未知 effect 停放策略 |
| U01 | adapter 尚未 ready 就挂载业务、浏览器执行 Node stub | 真实 browser boot，延迟初始化、console/error/调用轨迹 |
| U02 | workspace/语言切换留下订阅、timer 或旧草稿 | 同场景宿主 adapter 与交互夹具；420px/1280px 截图 |
| U03 | port 缺失却返回伪成功、存储偏好丢失 | 明确 capability error；实际持久偏好往返 |
| U04 | permission/SubmitPlan/取消/预览在两个宿主走不同领域路径，批准后重复 effect | 同一 loopback SSE 模型 + 真实 Pi/SessionManager；批准前文件不存在、批准后一次写入、真实计划卡与继续消息、取消后空闲、重连后历史无重复、实际文件预览 |
| U05 | 草稿 debounce 遇断线丢失、旧保存确认覆盖新草稿、工作区切换早于失败草稿落盘 | 待保存快照有单一 owner，成功确认只移除同一版本；真实网络离线期间编辑，恢复后核对持久草稿，切换必须先 flush |
| U06 | Web 设置挂载调用原生通知/电源/代理端口 | 真实设置页切换语言，Web 不渲染原生控制项、不发原生 RPC，两个宿主均检查 console/pageerror |
| P06 | 未打包 Electron 把 Bun 目标 Pi bundle 当作 Electron 应用启动 | 同一原生主进程明确选择开发用 Bun，实际批准 Write/SubmitPlan；打包继续使用随包 Bun |
| D01 | install 缺 patch、Bun pin/lock 与构建不一致 | 干净 checkout frozen install、移除必要输入 canary |
| D02 | Pi/worker 资源漏装或只在源码树内可启动 | 生产目录移出源码树，离线 boot/RPC，删除资源明确失败 |
| D03 | 严格身份检查用无理由兼容清单掩盖新增标识 | 每项来源/契约/读兼容/用户可见分类，新增残余必须失败 |
| D04 | 拆分导致 bundle/perf 退化 | 既有预算不变、同机多次 perf，资源 SHA manifest |

完整实施台账与验收结果由后续治理收口文档记录。本矩阵本身不是通过证据。

## 独立审计后的收口失败矩阵

以下场景于 2026-10-11 的收口代码修改前登记。先保存当前失败，再修改生产实现；不新增事后单元测试。

| 编号 | 失败方式 | 验证入口 / 判定 |
| --- | --- | --- |
| F01 | 新归档携带历史标识，最终严格身份检查红；陈旧规则仍通过 | 真实严格扫描、精确证据分类及未使用规则 canary；最终工作树零未分类残余 |
| F02 | RPC AST 抽取返回空 sites 仍绿；高风险方法没有实际 handler | 实际源码 census，非零 handler，51 个中央契约逐一有入口；新增方法必须分类 |
| F03 | CI job/step 被禁用、忽略错误、移除 PR 触发仍绿 | 真实 YAML 副本变异；检查有效触发、条件、错误策略、严格产物上传 |
| F04 | registry 删除工作流或测试组仍绿；canary 没进关键回归 | 独立必需场景策略与完整 registry 比对；output/gates/closeout 纳入 critical |
| F05 | commonRules 放进插件实现区，实际源文件不受检查；临时基线自动放行 | 真实 ESLint 配置与 debugger/unsafe-finally 探针；日常入口禁止初始化基线 |
| F06 | CredentialManager 吞掉底层 vault 写入失败，cache/config 删除却成功 | 临时配置子进程注入实际 backend 写入失败；cache、重开 vault、workspace config 保持；缺失凭据删除仍幂等 |
| F07 | logout 绕过 config owner；直接调用 clearAllConfig 误删工作区 | 真实 RPC handler 与配置文件/工作区哨兵；删除入口归 repository，I/O 错误传播，工作区哨兵保留 |
| F08 | 目录外 unlink、路径别名、barrel/helper 反向访问绕过边界门禁 | 独立图 fixture 的删除/别名和三个 session owner 传递闭包变异均失败 |
| F09 | 干净检出缺 bundled uv stamp；外层文档测试 Python 未固定 | 独立空资源目录供给 pinned uv 后通过；CI 在 validation 前执行供给，文档测试使用同一 Python 常量 |
| F10 | 离线切 workspace、原生文件能力按钮产生未处理 rejection | 真实 Web 浏览器离线编辑并点击切换；绑定/草稿保留、提示可见、重连后恢复；原生操作无能力时不可调用 |
| F11 | Docker 未开启资源检查、standalone Dockerfile pin 漂移、desktop worker 命令分叉 | 真实构建输入 canary；统一 worker 构建与固定 Bun；必要资源删除在监听前失败 |
| F12 | Pi accounting Map 在入口和事件适配器双写；init/prompt 同批次缺证据 | 独立 accounting owner 私有状态；真实生产 Pi 连续 stdin init/prompt + loopback 工具/abort，T1/T2 原语保持 |
| F13 | Session 装配仍捕获整个 manager，新增 helper 反向访问 facade | 提取纯配置 snapshot 与受限产品回调 port；无 Manager 的真实 Pi 两轮、source lease、lazy persistence 与传递边界 canary |
| F14 | curated manifest 缺文件被误认为完整 run；归档不能独立校验 | 明确保留/剔除清单、原 manifest SHA、源快照、全归档 SHA256SUMS 与独立 verifier；冻结后必经门禁复验 |
| F15 | 手动 reconnect 已关闭旧 socket，但状态仍显示 connected；立即读取误判为已恢复 | 真实 Web 订阅 transport 状态，reconnect 同步发布 reconnecting，再等待新连接；后续 workspace/session RPC 成功，零未处理异常 |
