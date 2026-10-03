# Unreal Agent 项目设计分析

项目地址：<https://github.com/unreallabsai/unreal-agent>

## 一、项目定位

`unreal-agent` 最值得关注的地方，不是它支持 Bash、图片、Skill 或 OpenAI API，而是它对 **Agent 如何在异步、崩溃、重试、长耗时工具调用下保持一致性** 的处理。

一句话概括：

> **Unreal Agent 把 Agent 从“LLM + while loop + tools”，提升成了一个 event-sourced、可恢复的异步状态机。**

它将 Session 设计为 append-only persisted history，把 Tool 与 Operation 明确拆开，并要求 Operation 可序列化、版本化。

---

## 二、整体架构

```text
External Input
      │
      ▼
    Inbox
  去重 / 控制消息
      │
      ▼
 Coordinator
  单线程事件循环
      │
      ├── persist Input
      ├── persist Turn
      ▼
     LLM
      │
      ▼
 persist ModelResponse
      │
      ▼
 Tool Translator
 (同步、无 I/O)
      │
      ▼
  Operation[]
 可序列化 / 可恢复
      │
      ├── atomic persist:
      │   ToolCallStatus + Operations
      │
      ▼
Operation Manager
   actor runtime
      │
      ▼
 Primitives
 process / file / compute / remote...
      │
      ▼
operation checkpoints
      │
      ▼
 Tool Result
      │
      ▼
 next LLM turn
```

从抽象上看，它并不是传统意义上的 Agent 应用框架，而更接近一个轻量级的 **Agent workflow runtime**。

---

## 三、最有价值的设计

### 1. Tool 和副作用之间加入 Durable Operation 层

这是整个项目最值得借鉴的设计。

多数 Agent 框架的执行路径类似：

```text
LLM
 → tool_call
 → execute tool()
 → result
 → LLM
```

问题在于，`execute tool()` 往往同时承担：

- 参数验证
- 业务逻辑
- 网络 I/O
- 文件操作
- subprocess
- retry
- cancellation
- crash recovery

一旦进程在 Tool 执行一半时崩溃，系统很难回答：

> 这个工具到底执行了没有？

Unreal Agent 将其改造成：

```text
LLM ToolCall
     ↓
Translator
     ↓
Operation Spec
     ↓
Persist
     ↓
Operation Runtime
     ↓
Side Effects
```

Tool Translator 的职责非常克制：

- 验证 ToolCall
- 将 ToolCall 翻译成一个或多个 Operation
- 不允许执行 I/O
- 不允许阻塞 Coordinator event loop

然后系统先把 ToolCallStatus 和 Operation 持久化，再把 Operation 交给 Operation Manager 执行。

这实际上形成了一个明确的副作用边界：

```text
       deterministic-ish
       coordinator side

LLM → Translate → Persist
                    │
──────── durability boundary ────────
                    │
                    ▼
               side effects
```

这种设计与以下模式有明显相似之处：

- Write-Ahead Log
- Transactional Outbox
- Workflow Engine
- Actor Runtime
- Durable Execution

#### 价值

这一层解耦后，以下能力会自然变得更容易实现：

- Tool crash recovery
- Remote sandbox execution
- Operation migration
- Long-running jobs
- Tool cancellation
- Replay
- Audit
- Distributed execution
- Fault injection testing

最重要的是，Coordinator 不再关心 Operation 到底在哪里运行。

未来完全可以扩展为：

```text
Agent Coordinator
       │
       ▼
Operation Queue
       │
 ┌─────┼────────┐
 ▼     ▼        ▼
local sandbox remote worker
```

这比单纯扩展更多 Tool 类型更有架构价值。

---

### 2. Session 使用 Event Log，而不是可变 Conversation State

Unreal Agent 将 Session 设计为：

```text
Session = append-only history
```

而不是传统的：

```python
session.messages.append(...)
session.current_state = ...
```

其核心历史元素包括：

```text
ItemFork
ItemInput
ItemTurn
ItemModelResponse
ItemToolCallStatus
```

因此运行时状态本质上是：

```text
state = replay(history)
```

Coordinator 启动时会：

1. 加载 Session 历史
2. 按顺序 replay
3. 重建 Context
4. 重建 current turn
5. 重建 tool calls
6. 重建 pending inputs
7. 加载未完成 Operations
8. 将未完成 Operation 重新交给 Manager

这实际上就是一个轻量级 Event Sourcing 模型。

#### 为什么 Agent 特别适合 Event Sourcing

一个 Agent Session 很可能持续：

```text
几秒
几分钟
几小时
甚至几天
```

过程中可能发生：

```text
user input
LLM turn
reasoning
tool call
network request
shell process
retry
human interruption
cancel
resume
```

如果系统只保存最后一个 State：

```json
{
  "messages": [],
  "pending_tool": "..."
}
```

那么很难回答：

- 为什么到了当前状态？
- Tool 是什么时候提交的？
- LLM 当时看到了什么？
- 崩溃前最后一个 durable point 在哪里？
- 为什么发生了 retry？
- 某个副作用是否已经执行？

Append-only history 则天然提供：

```text
audit
replay
debugging
fork
recovery
trajectory export
```

对于生产级 Agent 系统，这是一个非常合理的数据模型。

---

### 3. ToolCallStatus 与 Operations 原子绑定

这个设计非常细，但很重要。

第一次记录 ToolCallStatus 时，同时初始化其对应的 Operation snapshots。

因此系统避免出现两种不一致：

```text
记录了：
LLM 要执行 Tool X

但没有记录：
Tool X 对应什么 Operation
```

或者：

```text
已经创建了 Operation Y

但不知道：
是谁创建的
```

系统还会校验：

- Operation ID 不重复
- Operation 格式合法
- WaitingFor 引用的 Operation 必须存在
- 成功状态必须初始化 Operation
- Error 状态不能初始化 Operation
- WaitingFor 数量必须与 Operations 数量一致

最终形成一个强不变量：

```text
Tool Call
    │
    └── Status
          │
          └── Operation IDs
                   │
                   └── durable operation snapshots
```

对于 Crash Recovery，这是非常关键的关系完整性设计。

---

### 4. Operation 本身是 Durable State Machine

Operation 并不是简单的：

```go
func Run() error
```

而是具有显式生命周期：

```text
ready
awaiting
canceling
completed
failed
canceled
```

同时 Operation 中包含：

```text
ID
Type
Version
Status
State
Idempotency
```

每一步状态推进返回：

```text
new durable checkpoint
+
next side effects
```

抽象上相当于：

```text
State Machine
     │
event│
     ▼
 transition()
     │
     ├── new checkpoint
     │
     └── effects
```

这和 Temporal、Durable Functions、Actor Systems 的核心思想已经非常接近。

---

### 5. Shell Operation 被显式建模为状态机

Shell 执行是一个很好的示范。

它不是：

```go
exec.Command(...).Run()
```

而是拆成多个 Phase：

```text
create_directory
      ↓
create_out
      ↓
create_err
      ↓
process
      ↓
read_out
      ↓
read_out_tail
      ↓
read_err
      ↓
read_err_tail
      ↓
completed
```

每一步都可以产生 checkpoint。

因此一个复杂 Operation 可以自然表达成：

```text
checkpoint
→ effect
→ event
→ checkpoint
→ effect
→ event
→ ...
```

这种设计比“给一个 Tool function 加 retry decorator”强很多，因为它能够明确知道：

- 当前执行到哪一步
- 哪一步副作用已经发生
- 哪一步可恢复
- 哪一步恢复后必须失败而不是盲目重试

---

### 6. 不伪装成 Exactly Once

这是一个非常成熟的工程选择。

分布式系统中一个常见错误是认为：

> 有 retry = exactly once

实际上，例如：

```text
启动 shell process
   ↓
process 已成功启动
   ↓
进程 crash
   ↓
checkpoint 尚未确认
```

此时恢复系统无法确定：

> command 到底有没有执行。

Unreal Agent 对这种情况采用保守策略。

如果恢复到 Process Phase，但没有记录 ProcessGroupID，会判断：

```text
shell execution outcome is unknown
```

如果 Process 启动过，但没有记录 Exit Status，同样会将其视作不可确定状态。

也就是说：

```text
unknown != retry blindly
```

Operation 中虽然预留了 `Idempotency` 字段，但项目没有试图提供一个虚假的 generic exactly-once guarantee。

这一点对于未来接入：

- 支付
- 邮件发送
- 云资源创建
- 数据修改
- 外部 SaaS 调用

尤其重要。

---

### 7. Coordinator 使用单写者事件循环

Coordinator 的核心模型是典型 Reactor/Event Loop：

```text
select:
  Inbox Input
  Operation Update
  LLM Response
  Heartbeat
  Grace Timeout
  Cancellation
```

系统虽然存在很多异步边界：

- LLM 请求异步
- Tool 执行异步
- subprocess 异步
- remote job 异步

但 Coordinator 状态只有一个 Owner。

可以概括为：

```text
Concurrency at edges
Serialization at coordination core
```

这能显著减少：

- race condition
- mutex dependency graph
- double scheduling
- duplicate model turn
- lost wakeup
- tool state corruption

对于 Agent Runtime，这往往比“多个 goroutine 共享 Session State”更容易做正确。

---

### 8. Context Builder 使用 staged / committed 模型

Context Builder 并没有简单维护：

```text
messages[]
```

而是维护：

```text
committedPrefix
stagedSuffix
```

新的：

- external input
- heartbeat
- reasoning
- tool result

先进入 stagedSuffix。

当创建一个新的 Turn 时：

```text
Commit()
```

才进入 committed history。

因此可以近似理解为：

```text
LLM request boundary
≈
durable Turn boundary
```

这对：

- Replay
- Debugging
- Request Reconstruction
- Turn Consistency

都很重要。

---

### 9. 长耗时 Tool 不会强制阻塞 Agent

如果 Tool 仍在运行，Context Builder 可以向模型暴露一个临时 ToolResult，大意是：

```text
Tool call is still running.
Its result arrives in a later turn.
Continue with independent work or wait.
```

因此执行模型可以是：

```text
Tool A ──────────────────────►
       仍在运行

LLM → 做其他工作
    → Tool B
    → Reasoning
    → 等待 A
```

而不是传统同步 Agent：

```text
LLM
 ↓
Tool A
 ↓
BLOCK
 ↓
LLM
```

Coordinator 还支持 Heartbeat：

- Tool 执行过久
- Coordinator 向 Inbox 注入 Heartbeat
- 模型知道哪些 ToolCall 仍然 Running

这才是真正的 **async-first Agent**，而不只是 API 层使用了 `async/await`。

---

### 10. Crash Consistency 做到了文件系统层

Local Session Store 使用版本化 JSONL。

关键策略包括：

#### 追加日志恢复

启动时：

```text
找到最后一个换行符
↓
只读取完整 record
↓
忽略 crash 留下的 partial tail
```

#### 每次追加

```text
truncate 到最后 committed size
↓
append record
↓
fsync(file)
```

#### 创建新 Session 文件

```text
temp file
↓
write
↓
fsync
↓
rename
↓
fsync directory
```

这意味着项目认真考虑了：

- process crash
- partial write
- power failure
- rename durability
- log recovery
- format migration

很多 Agent Persistence 只是简单保存一个 JSON 文件，而这个项目已经接近传统存储系统的 Crash Consistency 思路。

---

### 11. Fault Fuzz Testing 很值得学习

这个项目的测试策略本身就是设计亮点。

Coordinator 的 Fault Fuzz Test 会在多个位置主动注入错误，例如：

```text
history
input persistence
turn persistence
model response persistence
tool status
operation save
operation add
cancel
transport
HTTP
response body
```

然后验证关键不变量没有被破坏，例如：

```text
Turn chain 没断
ModelResponse 没重复
Tool status 对应正确 Call
Operation 已先 Commit
Dependency failure 后 Coordinator 不继续执行
```

这类测试很适合 Agent Infrastructure。

因为 Agent Runtime 的严重 Bug 往往不是：

```text
函数返回错
```

而是：

```text
A
→ B
→ crash
→ retry
→ C
→ duplicate side effect
```

普通 Unit Test 很难覆盖这种异常时序。

---

## 四、如果只借鉴三个设计

如果要自己设计一个生产级 Agent Runtime，我会优先借鉴以下三个设计。

### 第一优先级：Tool → Operation → Primitive

```text
LLM semantic layer
      ↓
Tool Translator
      ↓
Durable Operation
      ↓
Primitive side effect
```

这是整个项目最有价值的一层。

它将：

- LLM 语义
- Durable State
- Side Effect

彻底分开。

---

### 第二优先级：Session Event Log + Operation Checkpoint

不要只存：

```text
messages[]
```

而要存：

```text
Input
Turn
ModelResponse
ToolCall
Operation checkpoint
Result
```

这样可以同时获得：

- Recovery
- Replay
- Audit
- Fork
- Debugging
- Trajectory Export

---

### 第三优先级：Single Coordinator Owner + Async Edges

```text
many async producers
        ↓
one serialized coordinator
        ↓
deterministic-ish state transition
```

这一模型能显著降低 Agent Runtime 中复杂并发错误的概率。

---

## 五、项目目前的不足

虽然设计方向非常成熟，但一些能力仍明显处于未完成状态。

### 1. Context Builder Report 尚未真正兑现

接口已经定义：

```text
ChangeOmitted
ChangeTruncated
ChangeCompacted
```

并要求 Build 返回 Report。

但当前实现实际上没有真正生成这些 Changes。

因此“可解释 Context Compaction”目前更多是一个优秀的 API 预留，而不是成熟能力。

---

### 2. Fork 仍有技术债

Coordinator 中存在明确的 FIXME：

```text
Forks leave inherited calls without results
and retain pending-input accounting.
```

Session Store 中也有与 Forked ToolCallStatus 有关的 TODO。

因此：

> Fork 的整体思路值得借鉴，但当前实现不能视为已经完全成熟。

---

### 3. 单 Session 多 Writer 尚未解决

Store 接口明确不保证同一个 Session ID 下的并发方法序列化。

这意味着系统实际上依赖一个部署不变量：

```text
一个 Session 同一时刻只有一个 Coordinator Writer
```

如果未来要做多节点 Active-Active，还需要引入：

```text
lease
fencing token
CAS
transaction
distributed lock
```

等机制。

---

## 六、总体评价

`unreal-agent` 更准确的定位是：

> **轻量级 Agent Workflow Runtime，而不是 Agent Application Framework。**

它和 LangChain、CrewAI 一类项目关注的问题并不相同。

传统 Agent Framework 更关注：

```text
prompt
chains
tools
RAG
multi-agent
agent planning
```

Unreal Agent 更关注：

```text
durability
scheduling
state transition
crash recovery
idempotency
async tool execution
operation lifecycle
replayability
```

因此，这个项目真正值得学习的不是 API，而是它背后的系统设计原则：

> **LLM 的输出不应该直接触发不可恢复的副作用；LLM 只产生意图，意图先变成 Durable State，然后系统再执行副作用。**

这是 Agent 从 Demo 走向 Production Runtime 非常关键的一步。

---

## 七、建议抽象出的最小架构

如果从该项目中提炼一套最值得自己实现的核心架构，可以归纳为：

```text
                ┌──────────┐
Input ─────────►│ Event Log│
                └────┬─────┘
                     │
                     ▼
               ┌───────────┐
               │Coordinator│
               └─────┬─────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
      LLM                    Tool Translator
                                  │
                                  ▼
                         Durable Operations
                                  │
                                  ▼
                         Operation Actors
                                  │
                                  ▼
                             Primitives
```

其中最关键的是：

```text
Durable Operations
```

它是整个架构的“腰”。

上层面对的是：

```text
非确定性的 LLM
```

下层面对的是：

```text
不可靠的真实世界副作用
```

中间通过 Durable Operation 将两者隔离。

这就是 `unreal-agent` 最值得学习的设计。
