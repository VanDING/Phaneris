# Phaneris 架构总览

Status: accepted — 当前实现基线
最后核对：2026-10-06
适用范围：仓库结构、运行时拓扑、协议边界、持久化、构建发布
不在范围内：版本升级建议（见 [dependency-graph-2026-10-06.md](../dependencies/dependency-graph-2026-10-06.md)）、durable runtime 的设计论证（见 [durable-agent-runtime.md](./durable-agent-runtime.md)）

---

## 0. 一张图

读法：**从上到下是调用方向，从左到右是部署形态。** 每个箭头标注的是真实协议，不是"调用"这种含糊说法。

```
┌─────────────────────────────── 客户端（4 种形态）───────────────────────────────┐
│                                                                                │
│   Electron 桌面            Web UI              Viewer           CLI             │
│   ┌────────────────┐   ┌──────────────┐   ┌────────────┐   ┌────────────┐      │
│   │ main (宿主)    │   │ 浏览器       │   │ 只读分享页 │   │ 终端       │      │
│   │ preload (桥)   │   │ (复用桌面    │   │            │   │            │      │
│   │ renderer (React)│  │  renderer)   │   │            │   │            │      │
│   └───────┬────────┘   └──────┬───────┘   └─────┬──────┘   └─────┬──────┘      │
└───────────┼───────────────────┼─────────────────┼────────────────┼─────────────┘
            │ WS JSON-RPC       │ WS JSON-RPC     │ HTTP fetch     │ WS JSON-RPC
            │ (127.0.0.1:port)  │ (+ session      │ /s/api/{id}    │
            │ 或 remote wss://  │    cookie)      │ 或本地 .json   │
            ▼                   ▼                 ▼                ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                        server-core  ·  Runtime Host                            │
│                                                                                │
│  transport/    WsRpcServer · WsRpcClient · codec · push · 16 MiB 上限          │
│  handlers/rpc/ 26 个 channel 模块（sessions·tasks·sources·artifacts·…）        │
│  sessions/     SessionManager（11,385 行，编排中枢）                            │
│  tasks/        TaskRunner（Conductor DAG）                                      │
│  durable-runtime/   T1/T2 事务 · 恢复判定 · 投影                               │
│  services/ domain/ model-fetchers/ webui/                                       │
└───────────────┬────────────────────────────────────┬───────────────────────────┘
                │                                    │
      JSONL over stdio pipes              SQLite / WAL（同进程）
                │                                    │
                ▼                                    ▼
┌───────────────────────────────┐   ┌────────────────────────────────────────────┐
│  pi-agent-server（独立子进程）│   │  <workspace>/runtime/runtime.db   ← 权威     │
│  @earendil-works/pi-* 1.0.2   │   │  runtime_events · operations ·              │
│  provider API · 内置工具      │   │  tool_operations · usage_ledger · 投影游标   │
└───────────────────────────────┘   └────────────────────────────────────────────┘
                                                             ▲
                                          兼容缓存（非权威） │
                                  session.jsonl · .pi-sessions
```

三条**不可越过**的边界，构成了这个项目的架构骨架：

| 边界 | 位置 | 为什么存在 |
| --- | --- | --- |
| **进程边界** | main ↔ `pi-agent-server`（JSONL/stdio） | Pi SDK 及其 ESM/重依赖不进 Electron 主包；provider 或 agent 崩溃不会变成第二条桌面执行路径 |
| **权威边界** | Runtime Host ↔ 所有缓存 | 只有 `runtime.db` 能判定"外部副作用是否真的发生了" |
| **契约边界** | `packages/shared/src/protocol/` | 客户端与服务器之间唯一的类型来源 |

---

## 1. 仓库拓扑

Bun workspace，14 个 `package.json`（根 + 13 个成员）。**依赖方向严格单向，无环。**

```
apps/                          packages/
├── electron/   桌面主程序      ├── core/                    类型 + 纯工具（叶子，16 文件）
├── webui/      浏览器薄壳      ├── shared/                  业务逻辑 + 磁盘存储（最重，526 文件）
├── viewer/     只读分享页      ├── server-core/             无头服务器基础设施（189 文件）
└── cli/        终端客户端      ├── ui/                      共享 React 组件（212 文件）
                               ├── session-tools-core/      会话工具定义与处理器（67 文件）
                               ├── pi-agent-server/         Agent 子进程宿主（70 文件）
                               ├── server/                  无头服务器入口（2 文件）
                               ├── messaging-gateway/       IM 网关（81 文件）
                               └── messaging-whatsapp-worker/ WhatsApp 子进程（8 文件）
```

### 内部依赖图（25 条 `workspace:*` 边）

```
                    core  ← 7 个消费者
                      │
        ┌─────────────┼──────────────┬─────────────┐
        ▼             ▼              ▼             ▼
     shared      server-core        ui          (viewer)
        │             │              │
        │             │              └──► electron, viewer, webui
        │             └──► server, cli, electron, messaging-gateway
        └──► messaging-gateway, server, server-core, ui, cli, electron, webui
                      │
              messaging-gateway ──► messaging-whatsapp-worker
              
   session-tools-core ← shared（唯一消费者）
   pi-agent-server    ← 无人依赖（被 spawn，不被 import）
```

| 包 | 角色 | 关键子目录 |
| --- | --- | --- |
| `@phaneris/core` | **只有类型与纯工具**，不是存储层也不是 agent 层 | `types/`, `utils/` |
| `@phaneris/shared` | 业务逻辑 + 磁盘存储 | `agent/`, `config/`, `credentials/`, `mcp/`, `sessions/`, `sources/`, `protocol/`, `automations/`, `skills/`, `plugins/`, `i18n/` |
| `@phaneris/server-core` | 无头服务器基础设施；Electron 与 standalone 共用 | `transport/`, `handlers/rpc/`, `sessions/`, `durable-runtime/`, `tasks/`, `bootstrap/`, `runtime/`, `webui/` |
| `@phaneris/session-tools-core` | 会话工具 schema + handler 的**单一来源** | `tool-defs.ts`, `handlers/`, `runtime/`（沙箱与路径安全） |
| `@phaneris/pi-agent-server` | Agent 子进程宿主；Pi SDK 唯一加载点 | `index.ts`（JSONL 分发）, `durable-*`, `tools/` |
| `@phaneris/ui` | 共享 React 组件；**无构建步骤**，直接消费 TS 源码 | `chat/`, `markdown/`, `overlays/`, `trajectory/`, `styles/` |
| `@phaneris/messaging-gateway` | IM 接入 | `adapters/{lark,telegram,wechat,wecom,whatsapp}/`, `gateway.ts`, `router.ts`, `pairing.ts` |

> 注意：`packages/session-mcp-server/` 只有 `dist/` 与构建信息，**没有 `package.json`**——它是构建产物，不是第 14 个 workspace。

---

## 2. 分层模型

```
┌──────────────────────────────────────────────────────────────────────────┐
│ L5  客户端      electron renderer · webui · viewer · cli                 │
├──────────────────────────────────────────────────────────────────────────┤
│ L4  共享 UI     packages/ui（React 组件、Markdown、代码/终端/PDF 覆盖层）│
├──────────────────────────────────────────────────────────────────────────┤
│ L3  契约        shared/protocol（envelope · channels · dto · events ·    │
│                 routing · limits）—— 全链路唯一类型来源                  │
├──────────────────────────────────────────────────────────────────────────┤
│ L2  传输        server-core/transport（WsRpcServer/Client · codec · push）│
├──────────────────────────────────────────────────────────────────────────┤
│ L1  接口        server-core/handlers/rpc/（26 个模块，纯 DI，可测试）     │
├──────────────────────────────────────────────────────────────────────────┤
│ L0  编排        SessionManager · TaskRunner · services/ · domain/        │
├──────────────────────────────────────────────────────────────────────────┤
│ L-1 运行时      durable-runtime（T1/T2 权威）· agent backend 驱动         │
├──────────────────────────────────────────────────────────────────────────┤
│ L-2 Agent 进程  pi-agent-server  ←→  @earendil-works/pi-* 1.0.2          │
├──────────────────────────────────────────────────────────────────────────┤
│ L-3 持久化      runtime.db（权威）· session.jsonl · .pi-sessions · 凭据   │
└──────────────────────────────────────────────────────────────────────────┘
```

**分层规则：**每一层只向下依赖。`handlers/rpc/*` 通过类型化的 `HandlerDeps` 注入依赖，因此**不含任何 Electron 引用**——这是 Electron 与无头服务器能共用同一条后端路径的原因。

---

## 3. 进程拓扑与协议边界

这是整个架构中最容易讲错的部分。以下是实际存在的 OS 进程以及它们之间**真实的**通信方式。

| # | 进程 / 上下文 | 由谁创建 | 创建方式 | 说什么 |
| --- | --- | --- | --- | --- |
| 1 | **Electron main** | 用户启动 | — | 宿主：内嵌 `WsRpcServer`，管理窗口、PTY、浏览器面板 |
| 2 | **Electron renderer** | main | `BrowserWindow` | Chromium 沙箱内 React |
| 3 | **pi-agent-server** | main（经 `shared/agent/pi-agent.ts`） | `spawn(nodePath, [piServerPath], {stdio:['pipe','pipe','pipe']})` | **JSONL over stdio** |
| 4 | **WhatsApp worker** | messaging-gateway | 子进程 | 带帧 JSON（`encodeMessage`/`parseFrames`） |
| 5 | **Terminal PTY** | main（`node-pty`） | 伪终端 | 原始字节流 |
| 6 | **独立 server** | `bun run server:start`，或 **CLI 自行 spawn** | `Bun.spawn(['bun','run',packages/server/src/index.ts])`，从 stdout 解析 `PHANERIS_SERVER_URL=` | WS JSON-RPC |
| 7 | **MCP servers** | MCP 连接池 | 按 source 配置 | MCP SDK 1.32 |

### renderer ↔ main：两条路，不是一个

```
renderer
   │  contextBridge 暴露的 window.electronAPI
   ▼
preload  ──►  RoutedClient
                 │
                 ├── LOCAL_ONLY 频道 ──► WsRpcClient → ws://127.0.0.1:<port>   本地内嵌 server
                 └── 其余频道        ──► WsRpcClient → 工作区所属 server
                                                       （本地时同上；远程时 wss://）
```

- preload 通过 `ipcRenderer.sendSync('__get-ws-port' / '__get-ws-token' / '__get-workspace-id')` 拿到本地端口与令牌。
- `RoutedClient` 依据 `shared/protocol/routing.ts` 的 `LOCAL_ONLY` / `REMOTE_ELIGIBLE` 分类决定去向。`routing.ts` 有**穷尽性测试**：新增 channel 未分类会让 CI 失败。
- 切换工作区时 `workspaceClient` 被替换，`REMOTE_ELIGIBLE` 监听器以 make-before-break 方式重新订阅。
- 远程连接**拒绝明文 `ws://`**，除非目标是 localhost。

### 传输信封

| 项 | 值 |
| --- | --- |
| 编码 | JSON，`serializeEnvelope` / `deserializeEnvelope` 是唯一序列化点 |
| 上限 | **16 MiB**（`shared/protocol/limits.ts`，服务端强制、客户端预检、渲染层报错三处一致） |
| 可靠性 | 序列号 + ack + 重连后事件缓冲重放 |
| 认证 | 本地：令牌；远程：令牌 + 可选 TLS（`tlsRejectUnauthorized` 仅允许显式 opt-in 关闭） |

### main ↔ pi-agent-server

```ts
// packages/shared/src/agent/pi-agent.ts:562
const args = [piServerPath];                    // 可选前置 --require <interceptor>
const child = spawn(nodePath, args, { cwd, stdio: ['pipe','pipe','pipe'], env: {...} });
```

- `nodePath`：打包后为内置 Bun（`resources/app/vendor/bun/bun`），开发期为 `process.execPath`。**不能用 Electron 的 `process.execPath` 跑 Pi 包**（`--target=bun` 构建）。
- 入口：打包后 `resources/pi-agent-server/index.js`；开发期 `packages/pi-agent-server/dist/index.js`（`runtime-resolver.ts:23`）。
- 凭证以 provider 感知的 `piAuth` 随 `init` 下发，OAuth 刷新走 `token_update`。**不从环境变量读 `ANTHROPIC_API_KEY`。**

---

## 4. 一次对话的完整链路

```
① 用户在 renderer 输入
      │ window.electronAPI.sendMessage(...)   （RoutedClient → WS）
      ▼
② server-core handlers/rpc/sessions.ts
      │ 解包参数 → deps.sessionManager.sendMessage()
      ▼
③ SessionManager（编排）
      ├─ 权限判定（mode / permissions）
      ├─ 组装系统提示与工具集
      └─ 打开 durable operation，phase = accepted
      ▼
④ Durable Runtime ── T1 事务提交「派发意图」
      │  写 runtime_events + tool_operations + 下一个 operation state
      │  ⚠ T1 未提交 → 实现绝对不执行
      ▼
⑤ agent backend 驱动（shared/agent/backend/internal/drivers/pi.ts）
      │  经 JSONL stdio 下发到 pi-agent-server
      ▼
⑥ pi-agent-server → Pi SDK → provider API / 本地工具
      │  流式回传 text_delta / tool_start / tool_result …
      ▼
⑦ Durable Runtime ── T2 事务提交「结果 + 用量 + 下一个 state」
      │  ⚠ 提交之后事件才推给客户端
      ▼
⑧ server-core push → WS → preload → renderer
      │  App.tsx: onSessionEvent → useEventProcessor().processAgentEvent
      ▼
⑨ event-processor 纯 reducer（processEvent 返回 {state, effects}）
      │  流式增量存在 useRef<Map>，不进 React state
      ▼
⑩ App.tsx 写 Jotai atoms → React 重渲染
```

**关键语义（容易误解，且已被文档明确）：**

| 事件 | 含义 |
| --- | --- |
| `agent_end` | 只是**一轮** agent loop 结束。**不是终点**——之后仍可能有自动重试、上下文压缩、排队续跑 |
| `agent_settled` | 真正的终点，关闭本轮事件队列；并携带 `getContextUsage()` 结果 |
| `tool_call_observed` | 模型**请求**了调用。**不代表实现执行过** |
| `report_progress` | 渲染为中间文本，同时 Pi 原生 loop 继续运行 |

---

## 5. 客户端矩阵

| 客户端 | 本质 | 入口 | 状态层 | 数据来源 |
| --- | --- | --- | --- | --- |
| **electron** | 桌面主程序；**几乎所有客户端代码的源头** | `src/main/index.ts` / `src/preload/bootstrap.ts` / `src/renderer/main.tsx` | **Jotai 3**：`atoms/sessions.ts`（核心）、`atoms/workbench.ts`（面板布局） | `window.electronAPI` → WS JSON-RPC + 服务端推送 |
| **webui** | **薄壳**（16 个文件），渲染 Electron 的 renderer | `src/main.tsx` → `src/App.tsx`（149 行）→ 懒加载 `@/App` | 与 electron 同一批 atoms（共享 `getDefaultStore()`） | `GET /api/config` 拿 wsUrl，再走浏览器原生 WS + 会话 cookie |
| **viewer** | 只读会话分享页，独立部署 | `src/main.tsx` → `src/App.tsx` | 局部 `useState`，无全局状态 | 路由 `/s/{id}` → `GET /s/api/{id}`；或本地 `.json` 上传 |
| **cli** | 终端客户端，14 个命令 | `src/index.ts`（bin `phaneris`） | 无（每命令无状态） | 自己的 `CliRpcClient`，或 **自 spawn 一个 server** |

### 共享关系

```
packages/ui  ── electron 139 个文件引用 · viewer 2 · webui 1（+ 间接复用整个 electron renderer）
packages/shared ── electron 132 · webui 2 · viewer 1 · cli 2
```

`packages/ui` 是**无构建步骤的 TS 源码**，通过 25 个 `peerDependencies` 声明契约（仅 5 个 optional）。因此**每个消费方都必须自己声明并 dedupe** react / shiki / katex 等——webui 与 viewer 的 vite 配置里有几乎相同的 alias + `dedupe` 块，原因就在这里。少一个或重复一个 → 两份 React（invalid hook call）。

### 桌面 renderer 的内部结构

| 目录 | 职责 |
| --- | --- |
| `App.tsx`（97 KB） | 根组件 + 应用状态机（`loading\|onboarding\|reauth\|workspace-picker\|ready`） |
| `atoms/`（21 个） | Jotai 状态层，单向：由 RPC 水合，只由服务端事件 + 乐观写入修改 |
| `event-processor/`（15 个） | 服务端事件 → 状态的**纯** reducer（约 45 种事件），本身不写 atoms |
| `components/app-shell/`（`AppShell.tsx` 196 KB） | 三栏外壳 `[左 20% \| 导航 32% \| 主区 48%]`：会话列表、`ChatDisplay`（100 KB）、内容面板、Kanban、浏览器面板 |
| `playground/`（68 个） | 组件预览工装（独立 HTML 入口） |

---

## 6. 持久化

配置根：`$PHANERIS_CONFIG_DIR`，默认 `~/.phaneris`。

```
~/.phaneris/
├── config.json            应用配置
├── preferences.json       用户偏好
├── credentials.enc        AES-256-GCM 加密凭据
├── credentials.key
├── workspaces/            顶层组织单元
│   └── <workspaceId>/
│       ├── runtime/
│       │   └── runtime.db         ★ 权威：SQLite/WAL，schema v4
│       ├── sessions/
│       │   └── <sessionId>/
│       │       ├── session.jsonl      兼容缓存：第 1 行 header，其余为消息
│       │       ├── .pi-sessions/      provider 续跑状态（Pi SDK JSONL）
│       │       ├── attachments/  plans/  data/
│       │       ├── long_responses/    因超限被摘要的完整工具结果
│       │       └── downloads/         从 API source 下载的二进制
│       └── ...
├── permissions/  themes/  tool-icons/  docs/  release-notes/  logs/
```

### 权威与缓存的分工

| 存储 | 地位 |
| --- | --- |
| `runtime/runtime.db` | **唯一权威**。`runtime_events`（只追加语义事实）、`operations`（可变，带 durable 程序计数器）、`tool_operations`（子操作）、`usage_ledger`、投影游标/快照 |
| `session.jsonl` | UI / 导出缓存。分歧只记录，**runtime 绝不从缓存修复权威事实** |
| `.pi-sessions` | provider 续跑缓存 |

### durable execution 具体是什么

耐久性的**单位是 operation**——`operations` 表中的一行，类型为 `agent_turn | task_run | task_node | automation | system`，携带程序计数器 `phase`：

```
accepted → model_effect_pending → tool_planned → tool_effect_pending
        → checkpoint | recovery_parked → terminal
```

每次工具调用被两个事务夹住：**T1** 在实现执行**之前**提交派发意图（T1 失败则实现绝不执行），**T2** 提交结果、可归因用量与下一个状态。**T1 与 T2 之间的区间本质上是不确定的**——此间崩溃既不能证明副作用发生过，也不能证明没发生。

**恢复不盲目重放。** 启动时把无副作用的被中断操作终结，把有 T1 无 T2 的操作**停放**（`recovery_parked`）。纯函数 `resolveToolRecovery()` 把证据映射为 `completed | definitely_not_dispatched | reconcile_required | indeterminate | corruption`；未知副作用投影为 `unknown`，绝不因"没有结果"就自动重试。未声明的工具默认 `never_auto_retry`。

**读模型是投影。** `projectDurableSession()` 从已提交、非部分、模型可见的事件重建模型上下文与 UI 消息，并记录已应用的最大序号。流式 token 增量**不是事实**，只是可被最终事件替换的有界快照。

---

## 7. 扩展点

| 扩展点 | 位置 | 机制 |
| --- | --- | --- |
| **Sources** | `shared/sources/` | MCP / API / 本地三类；每 source 独立凭据；`SessionManager` 缓存 source runtime |
| **MCP** | `shared/mcp/` | 连接池（`mcp-pool`），代理工具命名，schema 注入 |
| **Skills** | `shared/skills/` | workspace + 全局 `SKILL.md` 发现与解析 |
| **Plugins** | `shared/plugins/` | Agent Plugins 1.0.0：bundle 内的 skills/MCP 物化进原生层级 |
| **Tools** | `session-tools-core/tool-defs.ts` | Zod schema + handler 单一来源，经 `sync_tools` 同步给 Pi；相同定义不重复同步 |
| **Automations** | `shared/automations/` | 触发器 + 脚本动作 |
| **Tasks** | `shared/tasks/`（规格）+ `server-core/tasks/`（运行器） | `task.yaml` DAG，Conductor 执行 |
| **Themes** | `shared/config/theme.ts` | 语义主题引擎，39 个 token，应用级默认 + 工作区级覆盖 |
| **IM 平台** | `messaging-gateway/adapters/` | Lark / Telegram / WeChat / WeCom / WhatsApp |
| **Pages** | `shared/pages/` + `server-core/pages/` | 工作区内置仪表盘，`data-store.ts` 走 `bun:sqlite` |

---

## 8. 构建与发布

```
bun run electron:build
    ├── electron:build:main        esbuild → dist/main.cjs
    ├── electron:build:preload     esbuild → bootstrap-preload.cjs, browser-toolbar-preload.cjs
    ├── electron:build:renderer    vite    → dist/renderer/
    ├── electron:build:resources   → dist/resources/（含 pi-agent-server bundle）
    ├── electron:build:assets      ← resources/ 下的文档、主题、权限、图标
    └── electron:build:validate    断言产物完整

bun run server:build:subprocess    bun build --target=bun → packages/pi-agent-server/dist/
bun run webui:build                vite → apps/webui/dist/
bun run build:wa-worker            WhatsApp worker（--target=node）
```

打包要点（`apps/electron/electron-builder.yml`）：

- **`asar: false`** — 有意关闭。CLI 包装脚本、PEP 723 Python 脚本、内置 Bun 必须位于 asar **之外**，因为子进程（`cmd`/`bash`/`uv`）无法执行 asar 内的文件。*历史上曾因误开 asar 导致打包版文档工具不可执行。*
- `extraResources` 显式携带：`node-pty`、`@vscode/ripgrep` 及其平台包、`quickjs-wasi` 的 wasm、内置 Bun、`pi-agent-server` bundle。
- 内置 Bun 与 `pi-agent-server` bundle **必须同时存在**，否则打包版会话会停在 "thinking"。

---

## 9. 架构不变量

这些是**约束**，不是描述。改动时违反任何一条都会破坏既有保证。

1. **只有一个 agent 后端。** Anthropic / Claude 模型、OAuth 连接名、`CLAUDE.md` 属于 provider 兼容，**不代表存在第二套后端**。不要在 Electron 里引入第二条 provider 专用事件路径。
2. **T1 失败 → 零实现调用。** 任何情况下不得放宽。
3. **有 T1 无 T2 ≠ "未执行"。** 只能走恢复判定。
4. **事件在事务提交后才推送给客户端。**
5. **operation ID 不得以不同工具身份或参数哈希复用。**
6. **恢复必须 fail closed。** `indeterminate` / `reconcile_required` / `corruption` 绝不因缺少结果而变成自动重试。
7. **`runtime.db` 不能被当作可删除的回滚手段。**
8. **每个 channel 必须被 `routing.ts` 分类**，否则 CI 失败。
9. **provider 凭证不读环境变量**（`ANTHROPIC_API_KEY` 等），只走凭据管理器。

---

## 10. 已知漂移与技术债

按"是否影响正确性"排序。

| 项 | 事实 | 影响 |
| --- | --- | --- |
| **webui 与 electron 无 API 边界** | webui 的 tsconfig `include` 了 `../electron/src/renderer/**`，vite 把 `@` 别名指向该源码树 | electron renderer 成了**未版本化、未发布**的库。renderer 里任何新增的 Electron/Node 专用 import 都会静默打断浏览器构建，直到有人补一个 shim。`import.meta.env.IS_WEBUI` 是唯一缝隙，且**没有测试门禁**断言 webui 产物不含 Electron/Node 代码 |
| **两套主题源头** | `packages/ui/src/styles/index.css`（仅 viewer 用）与 electron 自维护的 1717 行 `index.css`（electron 用，webui 靠 `@import` 继承） | 桌面与 viewer 的主题 token 可能静默漂移，**没有检查比对两者** |
| **bootstrap 顺序是隐式契约** | renderer 模块假定 `window.electronAPI` 已存在，webui 必须**先赋值再** `import('@/App')` | 未来任何模块级调用会让浏览器端白屏，且**无编译错误** |
| **Pi SDK 版本已对齐（2026-10-06）** | 原先三处不一致：`docs/pi-kernel.md` 写 1.0.0、`apps/electron/README.md` 写 0.86.1、实际 **1.0.2** | 前两处已改为 1.0.2；本行保留作为"文档版本会漂移"的证据 |
| **`@phaneris/core` 描述失真** | `package.json` 写 "Core types, storage, and agent logic"，实际**只有类型与纯工具**（存储/agent 仍在 shared） | 误导分层判断 |
| **`@earendil-works/pi-server` 声明未使用** | 全仓库零 import（唯一的 `[pi-server]` 是日志前缀） | 死声明，见依赖梳理 §7 |
| **viewer 后端未配置** | `SERVICE_URLS.viewer = null`（`identity.generated.ts`） | 本 fork 不提供 viewer 服务端；`/s/{id}` 路由依赖外部部署 |
| **陈旧 CSS glob** | electron 与 webui 的 `@source "../renderer/tabs/**"` 指向不存在的目录 | 无害但误导 |

---

## 附：验证方式

| 结论 | 证据 |
| --- | --- |
| 进程拓扑与 spawn | `packages/shared/src/agent/pi-agent.ts:532-610`、`packages/shared/src/agent/backend/internal/runtime-resolver.ts:23` |
| 本地/远程路由 | `apps/electron/src/preload/bootstrap.ts:95-140`、`apps/electron/src/transport/routed-client.ts:1-12` |
| 分层与 DI | `packages/server-core/src/handlers/`（类型化 seams）、`packages/server-core/src/transport/server.ts` |
| durable runtime | `packages/server-core/src/durable-runtime/{store,coordinator,projection}.ts`、`docs/architecture/durable-agent-runtime.md` |
| 存储布局 | `packages/shared/src/config/paths.ts`、`packages/shared/src/sessions/storage.ts:1-15` |
| 客户端矩阵 | 各 app 的 `vite.config.ts` / `tsconfig.json` / `package.json` |
| 打包 | `apps/electron/electron-builder.yml` |
| 事件契约 | `packages/core/src/types/message.ts`（`AgentEvent`，30 个成员） |
| 外部依赖关系 | [dependency-graph-2026-10-06.md](../dependencies/dependency-graph-2026-10-06.md) |
