# 治理第二轮验收证据

日期：2026-10-11。状态：**verified（本地）**；本目录为独立冻结快照，正常复跑不回写。HEAD 为 `8e5bf13b`，第一、第二轮实现仍在工作树，未提交或推送。

范围和部署/回退：[实施台账](../../../archive/governance-second-wave-2026-10-11.md)；[失败矩阵](../../governance-auth-lifecycle-failure-matrix.md)；[ADR](../../../architecture/authentication-process-lifecycle.md)。第一轮与原始扫描的归档不回写。

复跑：`bun run test:auth-lifecycle`、`bun run test:critical`、`bun run validate:full`、`bun run build:smoke`。新运行默认位于 `.cache/verification/`，不会覆盖本目录。

## 结果

| 验证 | 结果与产物 |
| --- | --- |
| 整体校验 | [完整日志](logs/second-validate-full-final.log)：typecheck/lint/i18n/docs/identity/version/runtime 均通过；workspace 6285 pass、14 既有 skip、0 fail；另执行 CI 子集 87 次 pass、Python 文档工具 24 项 |
| 关键路径 | [聚合结果](critical/critical.json)：7 workflow + 6 package group = 13 项；243 个既有 Bun 回归，0 fail；认证 14 和 lifecycle 12 场景已接入 registry，必需产物缺失会失败 |
| cookie 认证 | [当前脚本独立复跑](auth/webui-auth-lifecycle.json)：14 场景；真实 kill/restart、共享认证进程、隔离配置目录、旧 cookie/无 jti、等价签名重放、Origin、真实代理限流、分块 body、写锁与损坏 DB、CLI、已握手 WS；撤销库（`auth/session-revocations.sqlite`，只含哈希与过期时间）已于 2026-10-13 按仓库瘦身移除，见[档案裁剪](../../README.md#档案裁剪) |
| 生命周期 | [真实进程结果](critical/process-lifecycle/process-lifecycle.json)：12 场景；server fatal/挂起清理/再抛异常/正常 signal、共享 Electron lifecycle ports、Pi fatal、Runtime admission/steer 与 recovery、bootstrap 重复 stop 所有权 |
| 独立 Pi | [结果](runtime-pi/independent-pi.json)：6 场景，真实 Bun 子进程 + SQLite + loopback provider，未使用 SessionManager 或 mock Pi 后端 |
| 构建 | [结果](build-smoke/build-smoke.json)：5 类生产 bundle + 真实 server assembly/import 共 6 项；不重新下载原生 runtime |
| 证据/门禁 | [输出 canary](verification-output/manifest.json) 7；[治理 canary](governance-canary/governance-gates.json) 4；顺序/并行、占用目录、缺席/零场景、篡改/缺失、CI/覆盖/警告变异均按预期被拦截 |

main 为 **21,444,207 B / 21,500,000 B**，保留 55,793 B 余量；renderer 初始 JS 4,279,927 B / 71 chunks，Pi 14,004,547 B。预算没有放宽。lint 为 2155 个文件 / 120 条既有 warning，未改变 warning 基线；IPC 425 条兼容清单保持。

## 来源与失败证据

[summary.json](summary.json)记录计数、命令、环境、预算和未覆盖项；[源码快照](final-source-manifest.json)记录当前修改源码的 SHA-256。[第二轮补丁](second-wave.patch)仅相对[首轮冻结补丁](../governance-first-wave-2026-10-11/implementation.patch)生成，临时 Git index 未修改用户 index；可只读核对 `git apply --reverse --check docs/verification/results/governance-second-wave-2026-10-11/second-wave.patch`。

[修复前清单](before/failures.json)链接对应故障的日志与负向 manifest：旧 cookie 重启复活、rejection 后仍响应、等价签名绕过、WS 登出后继续请求、端口 0、chunked ECONNRESET、quiesce 后 steer、重复 stop 提前返回。负向结果的 exit 1 是预期证据，不能计入成功 workflow。附加故障在对应修复前补入矩阵，未伪称首次就覆盖全部未知情况。

[SHA256SUMS](SHA256SUMS)冻结所有本目录产物（自身除外）；[验收核对](acceptance-checks.json)记录正向 manifests/必需场景/文件哈希和只读补丁核对。每个运行 manifest 原样保留当时命令、runtime、HEAD、dirty 路径及开始时文件哈希；当前源码以源码快照为准。原始扫描 16 项和首轮 113 项归档校验和未变。

## 限度与部署

原生 Electron 的 app.exit/UI、Windows/Linux、真实浏览器 SameSite 策略、远程 TLS 代理、签名安装包/发布、线上 provider/IM 均未验收；端口/编译验证不替代它们。严格身份残留和 G3–G8 没有由本轮关闭。

存储失败的登出返回 503 且不清 cookie；修复存储并重启后需再次登出，不能把未提交撤销当成功。升级前内存撤销无法追溯；需要消除此窗口或回退到旧版本时先停服并轮换 secret，或保证回退版本继续读撤销库。完整作用域、配置和回退语义见 ADR。
