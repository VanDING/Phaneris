# Phaneris 项目深度分析报告

> 审查对象：<https://github.com/VanDING/Phaneris>  
> 审查基线：`15dafd3373f01393c6f5b2e4294e8755bed8042f`  
> 审查范围：项目架构、核心 Runtime、Server/WebUI、安全边界、Electron Renderer、CI、Monorepo 组织、测试与未来演进方向。

---

## 1. 执行摘要

Phaneris 已经不只是一个“AI 聊天客户端”，而是在向一个完整的 **Local-first Durable Agent Runtime + Workspace + 多入口 Agent 执行平台** 演进。

从当前代码与架构设计看，项目最有价值的技术资产不是 UI，也不是“支持多少模型”，而是以下几项：

- Durable Runtime
- 可审计 Agent 执行
- 明确的 T1/T2 副作用边界
- Crash Recovery / Unknown Effect 处理
- Artifact 生命周期与 provenance
- 多入口统一 Runtime
- Headless Server / CLI / WebUI / Electron 的统一执行模型

建议未来产品定位继续强化：

> **可靠、可审计、可恢复、Local-first 的 Agent Execution Workspace。**

而不是与普通 AI Desktop Client 比较聊天 UI、模型数量或 Prompt 模板数量。

---

# 2. 整体项目架构与设计

## 2.1 Monorepo 结构

当前项目是一个基于 Bun 的 Monorepo。

主要应用入口：

```text
apps/
├── electron
├── webui
├── viewer
└── cli
```

主要核心包：

```text
packages/
├── core
├── shared
├── server-core
├── server
├── pi-agent-server
├── session-tools-core
├── messaging-gateway
├── messaging-whatsapp-worker
└── ui
```

整体架构可以抽象为：

```text
┌───────────────────────────────────────────────┐
│                  Product Layer                │
│                                               │
│ Electron       Web UI       CLI       Viewer │
└───────────────────────┬───────────────────────┘
                        │
                   RPC / Events
                        │
┌───────────────────────▼───────────────────────┐
│                 server-core                   │
│                                               │
│ SessionManager                               │
│ RPC handlers                                 │
│ permissions / sources / artifacts            │
│ automations / tasks / messaging              │
│ runtime coordination                         │
└───────────────────────┬───────────────────────┘
                        │
          Durable Runtime / JSONL protocol
                        │
         ┌──────────────┴─────────────┐
         │                            │
┌────────▼────────┐          ┌────────▼────────┐
│ Durable Runtime │          │ pi-agent-server │
│ SQLite / WAL    │          │ isolated proc   │
│ T1/T2           │          │ Pi SDK          │
│ event log       │          │ providers/tools │
│ operation state│          └─────────────────┘
│ usage ledger   │
│ projections    │
└────────────────┘

          ┌────────────────────────┐
          │ Shared infrastructure  │
          │ config / credentials   │
          │ MCP / skills / sources │
          │ sessions / artifacts   │
          │ protocol / automation  │
          └────────────────────────┘
```

从架构思想上看，这个方向是合理的，并且具有继续扩展到 Headless、远程执行、多 Agent 和分布式 Runtime 的基础。

---

# 3. 当前设计中最值得保留和强化的部分

## 3.1 Durable Runtime 是整个项目最重要的技术核心

Phaneris 的执行模型已经明显超出普通 Agent 框架的：

```text
send prompt
→ await agent
→ save messages
```

当前架构更接近一个真正的 Durable Execution Runtime：

```text
Input
  ↓
Immutable Events
  ↓
Operation State
  ↓
T1 / Effect / T2
  ↓
Projection
  ↓
UI / Model Context / Audit
```

核心原则包括：

1. Runtime Host 是 durable execution 的唯一权威。
2. Immutable semantic events 保存发生过的事实。
3. Mutable operation state 保存当前 durable program counter。
4. Usage Ledger 独立、可追踪。
5. Projection 可以从 canonical facts 重建。
6. 工具执行采用 T1/T2 边界。
7. T1 成功前副作用不能开始。
8. T2 成功前结果不能进入下一轮 Model Context。
9. Crash 发生在 T1/T2 之间时属于 uncertainty，而不是 failure。
10. Unknown effect 默认不能自动重试。

这是非常正确的 Agent Runtime 设计方向。

### 典型场景

例如：

```text
Agent
  ↓
send_email()
  ↓
邮件服务器发送成功
  ↓
进程 crash
  ↓
本地没收到 result
```

错误的实现会：

```text
restart
→ 没看到 result
→ retry
→ 用户收到两封邮件
```

而 Phaneris 当前设计更倾向于：

```text
T1 committed
→ effect outcome unknown
→ reconciliation_required
→ parked
```

这对于真正有副作用的 Agent 系统非常关键。

---

## 3.2 Parallel Tool Batch 的执行语义设计合理

Phaneris 已经没有继续假设：

```text
一个 model response = 一个 tool call
```

而是使用：

```text
model
 ├── tool A
 ├── tool B
 └── tool C
```

允许实际完成顺序为：

```text
B → A → C
```

但模型上下文仍按：

```text
A → B → C
```

恢复逻辑。

也就是说：

> **物理完成顺序 ≠ 逻辑 source order**

这是并行 Agent 工具调用中非常重要的约束。

当前 Durable Runtime 相关测试已经覆盖：

- Parallel prepare
- Out-of-order T2 commit
- Parent 在所有 child settle 前保持 `tool_effect_pending`
- 最后一个 child 完成后进入 checkpoint
- 未完成工具副作用存在时禁止开始下一次 Model attempt

这部分设计属于项目当前质量最高的模块之一。

---

## 3.3 Pi Agent 独立进程隔离是正确决策

`pi-agent-server` 被设计为：

```text
Out-of-process Pi Agent Server
JSONL over stdio
```

因此架构是：

```text
Product Host
    │
    │ controlled protocol
    ▼
Agent Runtime Process
```

而不是：

```text
Electron
   ↓
Pi SDK directly
```

这样做有明显优势：

- Agent SDK 崩溃不会直接把 UI Runtime 一起带死
- Provider 生命周期可隔离
- Headless Server 能复用同一 Agent Runtime
- JSONL Protocol 可以独立版本化
- 更容易与 Durable Runtime 结合
- 将来可以替换 Pi Runtime 或增加其他 Agent Runtime

建议继续保持这个边界。

---

# 4. 当前项目中确认存在的问题

## 4.1 问题优先级总览

| 优先级 | 问题 | 类型 |
|---|---|---|
| P1 | `full-validation` CI 缺少 `uv` | 已确认 |
| P1 | Trusted Proxy 实际没有验证请求来源 | 已确认 / Security |
| P1 | WebUI Global Rate Limiter 可造成登录 DoS | 已确认 / Security |
| P1/P2 | Server Bearer Token 默认输出到 stdout | 已确认 / Security |
| P2 | JWT Logout Revocation 重启后失效 | 已确认 / Security |
| P2 | 全局吞掉所有 `unhandledRejection` | Reliability Risk |
| P2 | React Hook Stale Closure 风险 | 已确认代码模式 |
| P2 | `SessionManager` 已成为严重 God Object | Architecture Debt |
| P3 | README 版本仍显示 0.2.3，而项目已经 0.2.4 | 已确认 |
| P3 | `craft_session` 等历史 namespace 未完全清理 | 已确认 |

---

# 5. Bug / 问题详细分析

## 5.1 P1：当前 `full-validation` CI 缺少 `uv`

当前 `validate` Job 会执行：

```yaml
- name: Install uv
  uses: astral-sh/setup-uv@...
```

但 `full-validation` Job 没有安装 `uv`，直接执行：

```yaml
bun run validate:full
```

而文档工具测试 harness 明确依赖：

```python
bundled = BIN_DIR / platform_key / uv_name

if bundled.exists():
    return bundled

fallback = shutil.which("uv")

if fallback:
    return Path(fallback)

raise FileNotFoundError(...)
```

因此：

```text
PDF
XLSX
DOCX
PPTX
IMG
ICAL
...
```

这类 smoke test 会在 CI 环境初始化阶段直接失败。

### 修复建议

将运行环境初始化统一抽象成：

```text
setup-runtime
├── Bun
├── Node
├── Python
├── uv
└── platform dependencies
```

最好做成 GitHub Composite Action 或 Reusable Workflow。

这样可以避免不同 CI Job 的依赖环境发生 drift。

---

# 6. Security 问题

## 6.1 P1：Trusted Proxy 配置存在逻辑漏洞

当前接口语义上表示：

```text
只有 trustedProxies 中的来源
才应该信任 X-Forwarded-For
```

但实现逻辑实际上接近：

```ts
if (trustedProxySet.size > 0) {
  return req.headers.get('x-forwarded-for')
}
```

也就是说，只要配置了任何 trusted proxy：

```text
trustedProxies.length > 0
```

来自任意地址的直接客户端都可以伪造：

```http
X-Forwarded-For: 8.8.8.8
```

然后不断切换：

```text
8.8.8.8
8.8.4.4
1.1.1.1
...
```

绕过 per-IP Rate Limit。

### 正确逻辑

应该变成：

```text
actual socket IP
        │
        ▼
is actual IP trusted?
        │
     ┌──┴──┐
    no    yes
    │       │
socket IP  parse XFF
```

同时真正支持：

```text
IPv4
IPv6
CIDR
trusted hop chain
```

而不是简单的 `Set<string>`。

---

## 6.2 P1：Global Auth Rate Limiter 可以制造登录 DoS

当前 Rate Limiter 中存在 Global Counter：

```text
global max attempts = 20 / minute
```

而计数发生在验证密码之前。

因此攻击者只需要：

```text
POST /api/auth × 21
```

就可能让其他正常用户在这一时间窗口中全部得到：

```text
429 Too Many Requests
```

而且成功的登录尝试也会增加 Global Counter。

### 建议改造

不要让：

```ts
check()
```

同时做：

```text
判断是否允许
+
增加失败次数
```

更合理的接口是：

```ts
canAttempt(ip)
recordFailure(ip)
recordSuccess(ip)
```

Global Counter 应该主要针对失败尝试，而不是所有请求。

---

## 6.3 P2：JWT Logout Revocation 重启后失效

当前 Revocation Store 是：

```ts
const revokedJtis = new Map<string, number>()
```

即：

```text
In-memory only
```

而 JWT 有效期约 24 小时。

所以：

```text
logout
→ jti 被加入 revoked map
→ server restart
→ map 清空
→ 原 JWT signature 仍合法
→ stolen/replayed cookie 再次可用
```

### 简单解决方案

对于 Local-first / Personal Server 模式，可以：

```text
server boot
→ 生成 ephemeral WebUI signing key
```

Server Restart 时所有 WebUI Session 自动失效。

### 企业化方案

以后如果需要 Session Persistence：

```text
web_sessions
├── jti
├── issued_at
├── expires_at
├── revoked_at
└── metadata
```

使用 Durable Session Store。

---

## 6.4 P1/P2：Server Token 默认输出到 stdout

当前 Server 启动时会输出类似：

```text
PHANERIS_SERVER_TOKEN=<secret>
```

这在以下环境中有泄漏风险：

- Docker
- systemd
- CI
- Kubernetes
- supervisor
- NAS
- 日志采集系统

因为 Bearer Token 本身就是 RPC Credential。

### 建议

默认仅输出：

```text
PHANERIS_SERVER_URL=...
```

Token 只在：

```bash
phaneris server --print-token
```

或首次生成时显示。

进一步可以：

```text
Token
→ 0600 file
→ Secret Manager
→ OS Keychain
```

日志最多输出：

```text
token fingerprint: sha256:abcd1234
```

---

# 7. Reliability 问题

## 7.1 P2：全局吞掉所有 `unhandledRejection`

当前 Server 设置：

```ts
process.on('unhandledRejection', ...)
```

然后：

```text
log
→ keep running
```

这种策略对于普通 UI 应用尚可讨论，但对于强调：

```text
Durability
Auditability
Consistency
```

的 Agent Runtime 是危险的。

因为：

```text
Unhandled Promise Rejection
```

实际上意味着：

```text
Promise ownership / error handling invariant 已经被破坏
```

问题是当前代码把：

```text
已知 SDK abort rejection
```

和：

```text
DB transition error
Runtime invariant violation
State corruption
Programming error
```

全部统一处理为：

```text
继续运行
```

### 更合理的策略

```text
Known Abort / Cancellation
→ 在源头 catch

Unexpected Unhandled Rejection
→ Capture diagnostics
→ Stop accepting new work
→ Flush
→ Close runtime
→ Exit non-zero
→ Supervisor restart
```

这和 Durable Runtime 的哲学更一致。

---

# 8. Electron Renderer 风险

## 8.1 P2：React Hook Stale Closure

例如 `handleSendMessage` 内部使用：

```text
windowWorkspaceSlug
```

但 Hook Dependencies 中没有它。

这种模式可能导致：

```text
workspace change
→ callback 没重建
→ send message
→ badge qualification 使用旧 workspace slug
```

这类问题的特点是：

- TypeScript 无法发现
- 正常流程很难稳定复现
- 在 workspace 切换、异步 callback、快速操作中出现
- UI 表现通常像随机 bug

如果当前 Electron Renderer 已经存在大量：

```text
react-hooks/exhaustive-deps
```

Warning，建议做一次专项清理。

### 最终目标

```text
eslint:
0 errors
0 warnings
```

然后 CI：

```bash
eslint --max-warnings=0
```

否则 Warning 很容易从：

```text
100+
→ 300+
→ 没人再看
```

---

# 9. 文档与版本一致性

## 9.1 README 版本漂移

当前根 Package Version 已经是：

```text
0.2.4
```

Electron 也是：

```text
0.2.4
```

但 README 中文 Badge 仍然显示：

```text
0.2.3
```

虽然问题较小，但反映了：

```text
package metadata
README
release notes
branding
```

仍然存在多个 Version Source of Truth。

### 建议

Release Script 自动更新：

```text
package.json
apps/electron/package.json
README.md
README.zh-CN.md
release note
installer metadata
```

---

# 10. 最大架构债：SessionManager

当前：

```text
packages/server-core/src/sessions/SessionManager.ts
≈ 477 KB
```

它同时依赖：

- Context Policy
- Backend
- Credentials
- Sources
- MCP
- Artifacts
- Tasks
- Automation
- Durable Runtime
- Browser
- Labels
- Status
- Image Generation
- Session Persistence
- Permissions
- Title Generation
- Plugins
- Skills
- Workspace
- Transport
- Usage
- Compaction
- Handoff
- ...

这已经不是“大文件”问题，而是典型的：

```text
God Object
```

当前它承担了：

```text
Application Service
+ Domain Service
+ Runtime Coordinator
+ Repository
+ Event Router
+ Integration Manager
+ Session State Machine
```

### 建议拆分

```text
SessionManager
    │
    ├── SessionRegistry
    │     └ lifecycle / cache / lookup
    │
    ├── SessionPersistenceService
    │     └ jsonl / metadata / attachments
    │
    ├── AgentRunService
    │     └ prompt / model lifecycle
    │
    ├── DurableExecutionService
    │     └ T1/T2 / recovery
    │
    ├── SessionContextService
    │     └ compaction / handoff / context
    │
    ├── ToolRuntimeService
    │     └ MCP / source / skills / permissions
    │
    ├── SessionArtifactService
    │
    ├── SessionAutomationService
    │
    └── SessionProjectionService
```

最终：

```ts
class SessionManager {
  constructor(
    lifecycle,
    runService,
    persistence,
    artifacts,
    automation,
  ) {}
}
```

让 `SessionManager` 逐渐退化为 Facade。

真正目标是：

> **让 Durable Runtime 独立于 SessionManager 演进。**

---

# 11. 第二个架构债：`shared` 已经过度膨胀

当前 `@phaneris/shared` 包含：

```text
agent
config
credentials
MCP
prompts
sessions
projects
pages
sources
plugins
skills
labels
artifacts
automations
protocol
durable-runtime
tasks
i18n
resources
search
tools
mentions
...
```

这是典型的 Shared Package 演化：

```text
shared
↓
很好用
↓
所有模块都开始 import shared
↓
shared 变成隐藏 Monolith
```

### 建议未来逐步收缩

可以形成：

```text
@phaneris/protocol
@phaneris/config
@phaneris/credentials
@phaneris/session-domain
@phaneris/artifact-domain
@phaneris/source-runtime
@phaneris/automation
```

不一定马上拆 NPM Package。

可以先在源码内部建立 Bounded Context。

重要的是：

> 不要继续把新功能默认放进 `shared`。

---

# 12. 可显著改善项目质量的方向

## 12.1 第一优先级：让 CI 真正成为 Release Gate

目标：

```text
main = green
```

而不是：

```text
大部分测试 green
但 full-validation red
```

建议最终 Gate：

```text
Required
├── typecheck
├── lint --max-warnings=0
├── unit
├── durable-runtime failure injection
├── integration
├── doc-tool smoke
├── build-smoke
├── dependency audit
├── Linux
└── Windows
```

Release 阶段：

```text
Release
├── macOS package smoke
├── Windows package smoke
└── Linux package smoke
```

---

## 12.2 第二优先级：做一次 WebUI / RPC Security Hardening

建议覆盖：

1. Trusted Proxy
2. Auth Limiter
3. JWT Revocation
4. Bearer Token Logging
5. Request Body Limit
6. Origin Validation
7. WebSocket Upgrade Auth
8. Cookie Namespace
9. Secret Rotation
10. Security Regression Tests

Phaneris 现在已经有 Headless Server，因此不能继续只按：

```text
Electron internal backend
```

的安全假设来设计。

---

## 12.3 第三优先级：消灭 ESLint Hook Warning

重点：

```text
react-hooks/exhaustive-deps
```

这不是单纯 Style 问题。

最终建议：

```text
0 errors
0 warnings
```

---

## 12.4 第四优先级：拆 SessionManager

这是长期 ROI 最大的一项工程改造。

因为未来再增加：

```text
multi-agent
distributed execution
more messaging
agent handoff
worker pool
remote runtime
```

如果继续集中到 `SessionManager`，维护成本会呈指数增长。

---

# 13. Durable Runtime 下一阶段建议

当前 Target Architecture 中已经包含：

1. Durable Batch Entity
2. Resource-aware Admission Controller
3. Effect Registry + Reconcilers
4. Workspace Transaction Boundary
5. Distributed Ownership + Leases
6. Continuation Supervisor
7. Observability + Replay Verifier

总体方向正确。

我建议实际优先级为：

---

## 13.1 第一方向：Effect Registry + Reconcilers

这是下一阶段最值得优先做的功能。

可以抽象：

```ts
interface EffectDefinition {
  identity()
  canonicalize()
  recoveryMode
  idempotencyKey()
  redact()
  reconcile()
}
```

然后：

```text
send_email
create_github_issue
write_file
send_message
calendar.create
HTTP POST
```

都有自己的 Recovery Semantics。

这会让 Phaneris 从：

> Agent 可以调用工具

进化为：

> **Agent 可以可靠地执行有副作用的业务操作。**

这是真正具有技术差异化的能力。

---

# 14. 未来方向：Run Inspector 成为核心产品

当前已经有：

```text
Overview
Trajectory
Context
Map
```

建议继续发展成：

```text
Run
├── Timeline
├── Model Requests
├── Prompt Diff
├── Tool Graph
├── Artifacts
├── Side Effects
├── Permission Decisions
├── Tokens
├── Cost
├── Context Growth
├── Recovery State
├── Replay
└── Compare Runs
```

进一步支持：

```text
Run A vs Run B
```

比较：

- Model
- Prompt
- Token
- Latency
- Tool Sequence
- Success
- Artifact Diff
- Cost

这样可以自然演化成：

> **Agent Observability / Evaluation Platform**

---

# 15. 未来方向：Runtime Replay / Verification

建议增加：

```bash
phaneris runtime verify workspace
```

输出类似：

```text
Runtime integrity

✓ 1,284 events verified
✓ 93 runs reconstructed
✓ operation states match
✓ usage ledger matches
✓ projection cursors match
✓ artifact hashes match
✓ no orphan effects
```

进一步支持：

```bash
phaneris runtime explain RUN_ID
```

展示完整状态机：

```text
accepted
→ model_effect_pending
→ checkpoint
→ tool_effect_pending
→ recovery_parked
→ reconciled
→ checkpoint
→ complete
```

这与 Phaneris 的“可信 Agent”定位高度一致。

---

# 16. 未来方向：Workspace Filesystem Transaction

SQLite 能保证：

```text
Runtime Facts Atomic
```

但不能保证：

```text
Agent 修改 12 个文件
→ 修改到第 7 个时进程 crash
```

因此未来可引入：

```text
Workspace WriteSet
```

例如：

```text
before:
  sha256(A)
  sha256(B)

planned:
  A'
  B'

commit:
  atomic publish
```

或者：

```text
shadow workspace
→ validate
→ publish
```

特别适合：

- Code Refactoring
- Document Generation
- Multi-file Project Changes
- Agent 自动 PR

不必覆盖所有工具。

只针对：

```text
High-value Multi-file Workflow
```

启用即可。

---

# 17. 未来方向：Distributed Runtime

当前不建议过早引入。

只有当真正出现：

```text
Desktop
        \
Server A ─ Workspace
        /
Server B
```

或者：

```text
Run Migration
Worker Pool
Cloud Execution
```

再加入：

```text
Owner
Lease
Fencing Token
Heartbeat
CAS
Handoff Event
```

当前单 Runtime Host + SQLite 的模型已经足够。

不要为了“高级架构”提前引入分布式复杂性。

---

# 18. 未来方向：Multi-Agent

不建议一开始就造：

```text
Agent DAG Scheduler
```

例如：

```text
Agent1 → Agent2 → Agent3
      ↘ Agent4
```

更自然的方式是复用现有 Runtime：

```text
Parent Run
│
├── Child Run: Research
├── Child Run: Code
└── Child Run: Verify
```

每个 Child Run：

- Durable
- Auditable
- Independently resumable
- 独立 Usage
- 独立 Artifact
- 有 Parent / Child Provenance

最终自然形成：

```text
Run Graph
```

这样不会引入第二套执行模型。

---

# 19. Messaging 的未来方向

当前 Adapter 已包含：

```text
Lark
Telegram
WeChat
WeCom
WhatsApp
```

下一阶段不建议单纯追求：

```text
支持更多 IM
```

更值得做的是抽象统一的：

```text
Agent Ingress / Egress Protocol
```

例如：

```text
InboundMessage
OutboundMessage
Interaction
Approval
Artifact
Command
Thread
Identity
```

以后：

```text
Slack
Discord
Email
Teams
Webhook
```

都只是 Adapter。

而不是继续往核心塞 Channel-specific Logic。

---

# 20. Artifact 方向

Artifact 很可能成为 Phaneris 的第二条核心技术主线。

当前理念已经正确：

```text
文件不是普通 Attachment
文件是有 Revision / Validation / Provenance 的 Artifact
```

建议继续发展：

```text
Artifact
├── revision
├── producer run
├── producer tool
├── inputs
├── validation
├── approval
├── lineage
├── acceptedAt
└── publishedAt
```

最终可以形成：

```text
research.xlsx
      ↓
analysis.md
      ↓
presentation.pptx
      ↓
final.pdf
```

每一步都知道：

```text
哪个 Run
哪个 Tool
哪个 Model
哪些 Inputs
产生了什么 Revision
```

这会形成：

> **Agent-generated Work Provenance Graph**

---

# 21. 建议的开发路线图

## 0.2.5 — Stability / Security

```text
修 full-validation
修 Trusted Proxy
修 Rate Limiter
改进 JWT Session / Revocation
禁止默认打印 Bearer Token
修 React Hook Warning
README / Release Metadata 自动同步
CI 强制 0 Warning
```

---

## 0.3 — Architecture Cleanup

```text
拆 SessionManager
收缩 shared
统一 Runtime / Application Service 边界
统一 CI Environment
统一 Error Classification
Structured Logging
Runtime Diagnostics
```

---

## 0.4 — Durable Execution v2

```text
Effect Registry
Reconcilers
Recovery UI
Operator Decisions
Runtime Verifier
Failure Injection Matrix
Side-effect Metrics
```

---

## 0.5 — Agent Workbench

```text
Run Compare
Run Replay
Artifact Lineage
Run → Artifact Graph
Cost / Latency / Context Diagnostics
Eval Baseline
```

---

## 0.6 — Multi-Agent

```text
Parent / Child Run
Task Delegation
Budget Propagation
Permission Propagation
Child Artifacts
Run Graph
```

---

## 1.0 前再决定是否需要

```text
Distributed Workers
Leases / Fencing
Workspace Transaction
Generic DAG
Cloud Orchestration
```

只有出现真实 Activation Signal 后再实现。

---

# 22. 最终结论

当前没有看到 Durable Runtime 的 T1/T2 核心设计存在明显的根本性错误。

相反，这部分是整个项目目前技术质量最高、最值得长期坚持的模块之一。

当前项目最大的风险主要有三个：

## 22.1 系统规模增长快于模块边界增长

最明显表现：

```text
SessionManager
shared
```

正在变成高耦合中心。

---

## 22.2 产品已经进入 Networked Server 的安全等级

但部分实现仍然保留：

```text
Local Desktop Backend
```

时期的假设。

重点包括：

```text
Trusted Proxy
Auth Limiter
Token Logging
JWT Revocation
```

---

## 22.3 工程 Gate 尚未完全跟上项目复杂度

典型表现：

```text
full-validation 因 uv 环境问题失败
React Hook Warning 数量较多
```

---

# 23. 推荐长期技术主线

未来 Phaneris 最值得投入的方向不是继续堆普通 Agent 功能，而是围绕：

```text
Durable Runtime
       +
Effect Reconciliation
       +
Run Observability
       +
Artifact Provenance
```

形成一个完整的平台。

最终可以把 Phaneris 定义为：

> **A local-first, durable, auditable workspace for reliable AI agent execution.**

中文版可以概括为：

> **本地优先、执行持久、过程可审计、结果可追溯的 Agent 工作空间。**

这条路线的技术辨识度和长期价值，明显高于继续做一个通用 AI Desktop Client。
