# 远程服务端

服务端在自己的机器上管理工作区、模型执行和持久事实。桌面、Web UI、CLI 可以作为客户端连接；文件路径与可执行程序属于服务端宿主，而不是连接它的客户端机器。

## 运行

```bash
PHANERIS_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
```

这是 Bash 示例。源码部署可使用仓库服务安装脚本或 `Dockerfile.server`，但仍需为实际环境配置运行时、认证、持久目录和凭据密钥。

服务不是多租户账户平台。一个共享认证秘密不能提供多个用户之间的数据隔离；应只向受信任客户端开放。不能为了排查连接问题把监听器当作无需认证的公共服务运行。

## TLS 与凭据

网络部署使用受信任证书，或为客户端提供受支持的自定义 CA。TLS 启用后客户端应使用 `wss://`。RPC 证书、密钥和 CA 分别由 `PHANERIS_RPC_TLS_CERT`、`PHANERIS_RPC_TLS_KEY`、`PHANERIS_RPC_TLS_CA` 管理；CLI 可使用 `--tls-ca`/`PHANERIS_TLS_CA`。

不要关闭证书验证。服务端的凭据解密 provider 与桌面系统密钥链可能不同，应按[凭据](phaneris://docs/reference/credentials)配置并保护密钥。

## 客户端与转移

在桌面中配置服务地址和 Token 后，选择其远程工作区。浏览器客户端是单独构建的界面，CLI 也连接同一后端。多个客户端连接一个 Host，与多个独立 Host 同时写同一工作区不是一回事；后者不属于 Task 范围锁提供的跨进程隔离保证。

本地/远程转移会按支持的交接流程将摘要作为目标首轮上下文，避免自动重放完整会话。来源、凭据和内容路径仍需在目标环境核对。

## 运维

使用健康端口和日志检查状态，按当前服务命令管理 Token 生命周期。轮换后客户端需要更新，现有连接何时失效应以该部署的实际撤销/重连行为为准。

备份与恢复前应停止目标工作区的写入。恢复后的未知 T1 会停放，不会因为客户端重新连接就自动重放。桌面原生浏览器、系统对话框和其他本机能力仍有宿主范围限制。

## 下一步

- [命令行参考](phaneris://docs/reference/cli-reference)
- [环境变量](phaneris://docs/reference/environment-variables)
- [工作区](phaneris://docs/go-further/workspaces)
