# 治理第二轮：认证与进程生命周期故障矩阵

状态：2026-10-11，故障方式在对应修复前写定；验证发现的附加场景随后补入，再修复。代码基线为 `8e5bf13b` 加第一轮未提交改动；不覆盖第一轮归档。已完成本地验收，逐项结果见[第二轮证据](./results/governance-second-wave-2026-10-11/README.md)。

本轮限于实施计划 G2b/G2c。先执行下面的真实进程验证，再修改生产代码；结果另存独立目录和带 SHA-256 的 manifest。

| ID | 失败方式 | 必须成立的行为 |
| --- | --- | --- |
| A01 | 登录、登出、SIGKILL、同配置目录同 secret 重启，重放旧 cookie | HTTP 和 WS 都拒绝；另一未登出的 cookie 仍有效 |
| A02 | 两个服务进程共用目录与 secret，其中一个登出 | 另一个进程立即拒绝重放；无丢失更新 |
| A03 | 相同 secret、不同配置目录 | 撤销记录隔离；不访问用户真实目录 |
| A04 | 旧名 cookie、无 jti 的有效历史 JWT | 继续可读；登出撤销精确 token，重启不复活 |
| A05 | SQLite 被另一个真实连接持有写锁 | 登出 503、不清 cookie、不假报成功；该进程暂停 cookie 登录/验证，bearer 独立；重启后未提交的登出必须重试 |
| A06 | 撤销数据库损坏/不能打开 | 启动失败，不监听；不得删除/重建损坏文件来恢复登录 |
| A07 | 同源、非法、缺失、null、畸形、带路径的 Origin | cookie WS 仅同源或精确配置允许；其他拒绝；bearer/CLI 无 Origin 仍正常 |
| A08 | 显式远程 Origin、受信与不受信直连代理伪造转发头 | 允许精确远程配置；仅受信 socket 对端采信代理的 proto/host/IP；不把所有 localhost 或通配符放行 |
| A09 | 多 IP 错误密码、成功密码、伪造 XFF、20 次全局失败 | per-IP 和全局仅计失败；正确密码不绕过已耗尽预算；实际 socket/受信代理决定键 |
| A10 | 无 Content-Length 的分块超大请求 | 实际 node HTTP adapter 返回 413；下一次合法请求仍可登录 |
| A11 | 实际 server/CLI spawner 启动 | token 默认不进 stdout/stderr；CLI 仍能用其持有的 bearer 完成握手 |
| A12 | JWT 签名的等价 base64url 编码变体重放 | 按规范化的 token 摘要撤销；不能通过不改变签名字节的拼写变体绕过 |
| A13 | 使用端口 0 启动，浏览器读取 /api/config | 返回实际绑定的 WS 端口，不能返回 0 |
| A14 | 已通过 cookie 握手的 WS 在登出后继续发 RPC | 下一次 RPC 重新校验撤销、拒绝并关闭连接；已开始的 effect 仍由 Runtime 收敛，不因登出自动重试 |
| L01 | server 未处理 rejection、uncaught exception | 原始 stack/cause 有诊断；立即关闭 RPC 接入；复用已有 stop/Runtime close；有界非零退出 |
| L02 | 清理永久挂起、清理再抛异常、重复 fatal | 第一故障负责收口；退出期限不会重置；非零退出、没有第二次清理或重启 |
| L03 | Electron 进程生命周期 adapter | 同一有界收口机制，Sentry 诊断保留；关闭本地 RPC、既有 quit cleanup、app.exit(1)；原生 Electron 验证单独记限度 |
| L04 | Pi 子进程未处理 rejection、uncaught exception | 保持既有 error JSONL + 非零退出，原始原因可定位；父 Runtime 不自动重试未知 effect |
| L05 | Runtime commit 写入失败、observer 异常、子进程退出、迟到回调 | 复用现有真实 Runtime 边界/崩溃/Pi E2E：commit_failed 持有恢复证据，observer 不能篡改结论，generation 拒绝迟到输入，无第二条执行路径 |
| L06 | fatal 后清理尚未完成时内部任务继续申请执行 | 同步关闭现有 Runtime 的 Host 与 command admission；仍可读取恢复证据和提交已开始 effect 的结论 |
| L07 | 正常退出与 fatal 同时调用已有资源清理入口 | 返回同一个进行中的清理 promise，不因“已开始”标记提前宣称完成；资源只清理一次 |

判据和部署/回退语义见[认证与进程生命周期决策](../architecture/authentication-process-lifecycle.md)。验证脚本的控制口仅存在于测试 preload/fixture，不向产品加入故障注入路由。
