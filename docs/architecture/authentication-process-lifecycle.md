# 认证撤销与进程生命周期

Status: accepted — 2026-10-11，实施与验收见[第二轮故障矩阵](../verification/governance-auth-lifecycle-failure-matrix.md)。

## 认证作用域和持久化

WebUI handler 是 cookie 认证所有者。HTTP 与 WS 调用它的同一校验入口；纯 JWT 验签不承担会话授权。密码哈希按 handler 隔离，避免同进程多个实例共享密码。

撤销数据库默认位于 `PHANERIS_CONFIG_DIR/security/webui-auth.sqlite`（未设置时用项目既有配置目录）。撤销键为 secret 的 SHA-256 作用域和规范化完整 token 的 SHA-256；规范化 base64url 段防止等价签名拼写绕过。仅保存哈希及 JWT 过期时间，不保存 secret、cookie 或密码。按 token 摘要撤销也覆盖无 jti 的历史 JWT。SQLite 使用 FULL 同步提交，成功提交后才返回登出 204。过期撤销可删除；未登出 cookie 和历史 cookie 名继续可读。独立认证 handler 可共享数据库；完整 headless 应用仍遵守配置目录单实例锁。不同目录互相隔离。测试可显式提供数据库路径，产品不提供自动清空开关。

打不开/损坏数据库使启动失败。运行中读取或写入失败使该 handler 的 cookie 认证不可用：返回 503、不发新 cookie、不清登出 cookie；进程内不自动恢复。bearer 凭据独立。写入失败的登出没有完成：修复存储并重启后须再次登出，或由部署方轮换 secret 使全部旧 cookie 失效。故障日志记录底层存储错误，不记录 token。

已有未撤销 cookie 升级后继续有效。升级前仅驻留内存的撤销无法追溯；部署若需要消除该窗口，应显式轮换 secret。回退版本必须继续读撤销库，否则先停服并轮换 secret；不得无条件回退到只读 JWT 的版本。此轮不自动轮换 secret、不改 cookie 前缀。

## 浏览器 Origin 和代理

cookie WS 在认证握手处检查升级请求的 Origin：必须是合法的 HTTP(S) origin（禁止 null、路径、用户信息、片段）且等于实际 HTTP 请求的 origin，或精确列入 `PHANERIS_WEBUI_ALLOWED_ORIGINS`（逗号分隔）。缺失 Origin 的 cookie 不授权；携带合法 bearer 的非浏览器/CLI 连接不要求 Origin。拒绝发生在认证握手，连接未加入可执行 RPC 客户端集合。

已经用 cookie 握手的连接在后续消息入场时复核会话；登出/过期/存储不可用后下一次消息拒绝并关闭连接。已开始的 effect 继续由 Runtime 所有者收敛，登出不会触发重试。bearer 握手的连接不继承 cookie 依赖。

`PHANERIS_TRUSTED_PROXIES` 是逗号分隔的精确 socket IP 列表，暂不接受 CIDR；支持 IPv4-mapped IPv6 的等价地址。仅直连对端在此列表中时采信 Forwarded / X-Forwarded-Proto / X-Forwarded-Host / X-Forwarded-For。HTTP cookie Secure、返回的 WS URL、WS Origin 和限流键复用这一信任判定。直接 TLS 根据 socket 协议判定；远程 HTTPS 代理无需 blanket localhost 允许名单。显式 WS URL 仅指定连接地址，不隐式增加允许的页面 Origin。

## 异常归属与退出

已处理取消、SDK 运行错误、展示 observer 错误由既有 Runtime/产品所有者负责；不在全局 handler 用消息字符串猜测可恢复错误。RuntimeCommitFailure 保持 blocked 与 recovery evidence，禁止未知 effect 自动重试；本轮不创建另一套运行状态。

真正逸出的 rejection/exception 意味着进程状态未经证明。Server/Electron 全局 handler 只记录原始 stack/cause、立即关闭外部 RPC 接入、调用既有资源所有者清理，并在 10 秒期限内非零退出。清理失败/超时/重复 fatal 均不重置期限或重启执行。Electron 保留 Sentry 捕获，使用 app.exit(1)。Pi 保留既有 JSONL error 和立即退出策略。正常信号退出也复用有界收口，清理失败不能退出 0。

收口第一步调用现有 Runtime 的 `quiesce()`：同步设置已有的 draining/Host closing 标志，阻止内部任务与外部 RPC 新 admission；清理期间保留查询、recovery evidence 和已开始 effect 的结论提交能力，再由既有 close 结束资源。不新增另一份执行状态或自动恢复逻辑。

验收限度：本地 macOS 的 Bun server/CLI/Pi 真实进程和 Runtime E2E；Electron lifecycle port 与生产 bundle 的检查不等同于原生 Electron UI/退出验收。Windows/Linux、真实远程 TLS 代理、签名安装包与在线 provider 另行验收。
