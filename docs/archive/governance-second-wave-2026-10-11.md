# 架构与代码治理第二轮实施台账

> 归档说明（2026-10-13）：本文是当时的实施／评估记录，已移入 `docs/archive/`，不再更新；正文与结论保留原样，其中的「当前」「下一步」等表述以文首日期为准。

后续裁定：[完整实施台账](../process/governance-completion-2026-10-11.md)。以下正文保留本轮当时的快照与未覆盖项；当前治理状态不再由其中的后续队列判断。

日期：2026-10-11。范围：总计划 G2b/G2c；第一轮改动和证据保留。状态：**verified（本地，平台限度见 §3）**。HEAD 仍为 `8e5bf13b`，工作树未提交或推送。

实施前写定[故障矩阵](../verification/governance-auth-lifecycle-failure-matrix.md)与[认证/lifecycle ADR](../architecture/authentication-process-lifecycle.md)，先运行进程 E2E，证据独立归入[第二轮验收目录](../verification/results/governance-second-wave-2026-10-11/README.md)。

## 1. 已实施的边界

| 工作包 | 所有者 | 实现与判据 | 状态 / 回退 |
| --- | --- | --- | --- |
| G2b cookie 撤销 | server-core/webui handler | SQLite FULL 提交；secret 作用域、规范化 token 摘要、过期时间；HTTP/WS 同一入口；多 handler 共享、目录隔离、无 jti/旧 cookie 名兼容 | 本地 14 个真实进程场景已通过；回退必须保留撤销库读兼容或停服轮换 secret |
| G2b Origin/代理 | handler + transport upgrade request | cookie 必须同源/显式 origin；无 Origin bearer 兼容；代理的 proto/host/IP 同一 socket 信任判定；已登录 WS 消息复核撤销 | 本地验证通过；不增加 wildcard/localhost 宽泛白名单 |
| G2b 存储故障 | handler | 写锁/损坏真实 SQLite：503 不清 cookie、不发 cookie；打开失败不监听，不清空 DB；运行中失败锁定 cookie auth 直到重启 | 不把失败登出当成功；操作方修复后须重试登出 |
| G2c process 收口 | server / Electron adapters | 首故障诊断、10 秒 deadline、同步 quiesce、既有清理、有界非零退出；Pi 既有 JSONL error/exit 保留 | server/Pi/共享 lifecycle port 已验收；原生 Electron、Windows/Linux 待验收 |
| G2c Runtime admission | 既有 Kernel/Host | quiesce 复用 draining/closing；关闭 foreground/auxiliary/new command/steer admission，保留结论提交与 recovery reads | 不新增运行状态/执行重试；复用既有 Runtime 故障 E2E |

底层 SQLite runtime adapter 从 Runtime 私有目录移到 `server-core/runtime/sqlite.ts`，旧私有入口保留 re-export。认证只复用基础设施，不跨入 Runtime Kernel/Store；Runtime 解析图门禁仍执行。

## 2. 修复前证据及伴随修复

真实进程证明：logout→SIGKILL→restart 的 cookie 为 200；未处理 rejection 后服务仍响应；等价 JWT 签名拼写绕过首次摘要实现；已握手 cookie WS 在登出后仍接受 RPC；quiesce 后 steer 仍可送往 driver；重复 stop 在首个清理尚未完成时提前返回。这些失败均先于相应修复留存，未削弱成功/失败断言。bootstrap 与 Electron quit cleanup 现在均复用唯一进行中的 promise。

同一 E2E 暴露的既有缺陷也已修复：端口 0 的 `/api/config` 返回 0；chunked body 超限先 destroy socket，客户端看到 ECONNRESET 而非 413。现在使用实际绑定端口、在响应刷出后关闭 socket，并在声明长度超限时不开始缓冲。

密码哈希移到 handler 作用域，消除模块全局共享。两个既有 WebUI 回归 fixture 改为临时撤销库路径；代理测试增加明确的受信对端，原有断言保持。全部新增场景为 E2E/独立进程验证，没有新增单元测试。

## 3. 门禁与验收

`bun run test:auth-lifecycle` 单独复跑认证和生命周期；`test:critical` registry 纳入 14 个认证场景、12 个 lifecycle/Runtime quiesce/cleanup ownership 场景和既有 15 项 HTTP isolated 回归。workflow manifest 要求实际 SQLite 产物、非零场景数和 SHA-256；CI 复用既有关键验收和 artifact upload 接线。

最终命令全部 exit 0：`validate:full`（workspace 6285 pass、14 既有 skip、0 fail；CI 子集 87 次 pass；文档工具 24 项）；`test:critical`（243 项既有 Bun 回归、7 workflow + 6 package group、13 个聚合项；认证 14、lifecycle 12）；独立 Pi 6 个场景；output canary 7、governance canary 4；生产五类 bundle 加真实 server assembly/import 共 6 项。

lint 覆盖 2155 文件，120 条既有 warning 基线不变。main 为 21,444,207 B，距 21,500,000 B 上限仍有 55,793 B；renderer 初始 JS 为 4,279,927 B / 71 chunks，Pi 为 14,004,547 B。未放宽预算、警告基线、身份检查或 IPC 清单（仍为 425 项）。原始扫描 16 项和首轮归档 113 项校验和保持不变。

真实浏览器 SameSite/Cookie 行为、原生 Electron app.exit、远程 TLS 代理、Windows/Linux 和线上 provider 没有由端口测试推断通过。G3–G8 继续按总计划串行推进，下一项为 G3 config/storage 责任表和迁移失败矩阵。
