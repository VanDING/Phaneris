# 服务端安全加固：实施前故障矩阵

状态：故障方式于实施前写定（2026-10-11）。批次 F 未实施；第 4 节在实施后回填。

源码基线：`61970997`（工作树另有批次 A–C 的改动未提交）。

范围依据：[系统清理与优化计划](../process/system-cleanup-optimization-plan-2026-10-10.md) 批次 F；问题清单来自 [项目深度分析 §6](../process/Phaneris_Project_Deep_Analysis.md) 与 §12.2。

## 1. 实施前核实的事实

四项均为**代码级**核实，未构造真实网络暴露场景验证可利用性。

| 事实 | 证据 |
| --- | --- |
| `RateLimiter.check(ip)` 在**每次**调用时递增全局计数并据此拒绝，且成功登录也调用它 | `packages/server-core/src/webui/auth.ts:161`（`maxGlobalAttempts = 20`）、`:178-179`；`packages/server-core/src/webui/http-server.ts:198`（`new RateLimiter(5, 60_000)`）、`:257`（`check(ip)` 在 `:276` 的 `verifyPassword` 之前） |
| 未认证的 21 次 `POST /api/auth` / 分钟即让**所有人**收到 429 | 同上。这是可用性问题，不只是限流 |
| server token 每次启动原样打到 stdout，且无开关 | `packages/server/src/index.ts:332`；`apps/electron/src/main/index.ts:1397-1400` |
| CLI 本来就持有该 token，所以这个打印是多余的 | `apps/cli/src/server-spawner.ts:68`，注释 `:109-111` 明示"we already have it" |
| 未认证 HTTP 路由无请求体上限 | `packages/server-core/src/webui/node-adapter.ts:52-66`（把每个非 GET body 缓冲进内存，无上限）；`http-server.ts:267` 的 `req.json()` 无大小检查；全仓无 `maxRequestBodySize` |
| WS 侧有上限，HTTP 侧没有 | `packages/server-core/src/transport/server.ts:284,300,318,410` |
| session cookie 名仍是上游的 `craft_session` | `packages/server-core/src/webui/auth.ts:85` |
| trusted-proxy 是潜伏缺陷：只要配置了非空 `trustedProxies` 就无条件信任 XFF，不校验直连对端 | `http-server.ts:207-215`；今天无调用方设置该选项，故不可达 |

## 2. 要成立的判据

- **I-F1**：限流只由**失败**的认证消耗。成功登录不消耗预算，也不因预算耗尽被拒。
- **I-F2**：达到上限时被拒的是**尝试者**，且拒绝发生在密码校验之前（不做无谓的哈希计算）。
- **I-F3**：token 默认不出现在 stdout；需要时必须显式开启。
- **I-F4**：未认证路由拒绝超过上限的请求体，且拒绝发生在缓冲之前（不先吃进内存再判断）。
- **I-F5**：cookie 名使用本项目命名空间，且旧名 cookie 不导致登录态失效（改名即登出是**不可接受**的副作用）。
- **I-F6**：`trustedProxies` 只有在直连对端本身受信时才采信转发头。

## 3. 失败方式与要求

| ID | 触发/故障方式 | 要求 | 证据 |
| --- | --- | --- | --- |
| FF01 | 攻击者连发 21 次错误密码 | 攻击者被拒；**持正确密码的用户仍能登录** | 回归：21 次失败后正确密码返回 200 |
| FF02 | 正常用户连续多次成功登录（例如刷新/重连） | 不被限流；成功不清空他人的失败记录也要有明确语义 | 回归：连续 N 次成功登录均 200 |
| FF03 | 失败达到上限后，正确密码到达 | 被拒是限流的正确后果，不得出现"错误密码被拒但正确密码被接受"的顺序漏洞 | 回归：上限后一律 429 |
| FF04 | 每次拒绝前都做一次昂贵的密码哈希 | 拒绝发生在 `verifyPassword` **之前** | 代码路径断言 |
| FF05 | 删除 stdout 打印后 CLI 无法取得 token | CLI 路径不依赖它：token 由环境变量下发，CLI 自己已持有 | `bun run server:start` 冒烟 + CLI spawn 路径 |
| FF06 | 显式开启打印时行为未变（可观测性不能被无声移除） | opt-in 后仍能打印 | 回归：带开关启动可见 token |
| FF07 | 超大请求体打到未认证路由 | 在**读取/缓冲之前**按 `Content-Length` 拒绝；无 `Content-Length` 的分块请求也必须有上限 | 回归：超大 body 返回 413 且进程内存不增长 |
| FF08 | 合法的中等大小 body（登录、OAuth 回调）被误拒 | 上限足够宽松，正常流程不受影响 | 回归：正常登录仍 200 |
| FF09 | cookie 改名使所有已登录用户被登出 | 读取时同时接受旧名与新名；写入只用新名 | 回归：带旧 cookie 的请求仍认证成功 |
| FF10 | 配置了 `trustedProxies` 但直连对端不在名单内 | 不采信转发头，回退到 socket IP | 回归：伪造 XFF 不改变限流键 |
| FF11 | 直连对端在名单内时，转发头被正确采信 | 采信 X-Forwarded-For 的最左侧地址 | 回归：受信代理下 IP 取自 XFF |
| FF12 | 加固改动破坏既有登录/会话/OAuth 流程 | 现有 webui 与 transport 回归全绿 | `http-server.isolated.ts`、`server-lifecycle.test.ts` |
| FF13 | 为让测试变绿而放宽断言 | 不得删除既有安全断言（唯一 jti、登出撤销、per-IP 限流） | 既有测试文件保持不变 |

## 4. 实施后的覆盖记录

全部证据见[验收说明](./results/server-security-hardening/README.md)；`http-server.isolated.ts` 15 pass / 0 fail（9 项既有 + 6 项新增）。

| ID | 已运行证据 | 覆盖限制 |
| --- | --- | --- |
| FF01 | 回归：前 5 次错误密码为 401，其后为 429；此时**正确密码也是 429**（绝不冒充 401） | 未验证跨 IP 的相互影响 |
| FF02 | 回归：连续 30 次正确登录全部 200 | — |
| FF03 | 同 FF01：预算耗尽后一律 429，正确密码不会绕过 | — |
| FF04 | 代码路径：`canAttempt` 在 `verifyPassword` 之前，且不消耗预算 | 未做耗时对比测量 |
| FF05 | CLI 的 token 回读分支经核实为**空操作**（`server-spawner.ts` 注释"we already have it"）、已删除；token 经子进程环境注入 | 未在真实 `server:start` 会话中跑 CLI 端到端 |
| FF06 | 显式开启路径已实现（`PHANERIS_PRINT_SERVER_TOKEN=1`） | 未写自动化回归（需要启动真实 server 并抓 stdout） |
| FF07 | 回归：300 KB body → 413；另在 `node-adapter.ts` 中边读边限以防分块请求声明长度为 0 | 未做内存占用测量，只断言响应码 |
| FF08 | 既有登录与 `/api/config` 用例全部通过，256 KB 上限未误伤正常流程 | 未测接近上限的合法 body |
| FF09 | 回归：`craft_session=<jwt>` 仍能认证（读兼容），写入只用新名 | 未验证旧 cookie 在 24h 过期后的清理 |
| FF10 | 回归：未配置受信代理时，伪造 `X-Forwarded-For` 不获得新预算 | — |
| FF11 | 回归：受信直连对端下带 XFF 仍正常认证 | 只断言不误伤，未断言限流键确实取自 XFF 最左值 |
| FF12 | `http-server.isolated.ts` 15 pass / 0 fail；`test:critical` 通过 | — |
| FF13 | 既有 9 项断言全部保留，只把 cookie 名断言从 `craft_session=` 改为 `phaneris_session=`（跟随改名，非放宽） | — |

## 5. 验证产物约定

- 每项回归的运行日志。
- 现有 `http-server.isolated.ts` 与 `server-lifecycle.test.ts` 的前后对比。
- 超大请求体的 413 响应与内存观测。
- 结果归档到 `docs/verification/results/server-security-hardening/`；产物清单与重跑命令见[验收说明](./results/server-security-hardening/README.md)。
