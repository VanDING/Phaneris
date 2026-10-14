# 环境变量

这些变量影响启动、运行时或没有 UI 的配置。修改后通常需要重启对应宿主。不要把秘密写入公开脚本、命令历史或诊断产物。

## 配置与运行时

| 变量 | 作用 |
| --- | --- |
| `PHANERIS_CONFIG_DIR` | 替代默认 `~/.phaneris`，用于隔离配置 |
| `PHANERIS_APP_NAME` | 当前宿主支持的应用名覆盖 |
| `PHANERIS_DEBUG` | 调试开关，具体行为以启动入口为准 |
| `PHANERIS_LOCAL_MCP_ENABLED` | 本地 stdio MCP 可用性 |
| `PHANERIS_RELEASE_BASE_URL` | 安装脚本的自有发行源 |
| `PHANERIS_CREDENTIAL_KEY` | 无桌面宿主时的显式凭据密钥 provider |
| `PHANERIS_TASK_RUN_TIMEOUT_MS` | Task 运行的进程级超时配置 |

本项目不使用上游 `CRAFT_CONFIG_DIR` 作为自己的目录覆盖。需要指定位置时使用 Phaneris 变量，避免误读另一应用的数据。

## 功能开关

按当前配置支持范围，可使用 `PHANERIS_FEATURE_SESSION_SHARING`、`PHANERIS_FEATURE_PAGES_SHARING`、`PHANERIS_FEATURE_AGENTS_CLI`、`PHANERIS_FEATURE_EMBEDDED_SERVER`、`PHANERIS_FEATURE_DEVELOPER_FEEDBACK` 等开关。支持的布尔字符串包括 `1/true/yes/on` 与 `0/false/no/off`。

托管分享默认关闭，且没有自动指向上游服务的替代配置。仅修改一个 feature flag 不代表拥有可用的发布端点、账户或发布验收。`PHANERIS_PAGES_SHARE_API_URL` 等开发覆盖也不应被解释为公开运营服务。

## 遥测

`PHANERIS_TELEMETRY_ENABLED=1` 与有效的 `SENTRY_ELECTRON_INGEST_URL` 必须同时配置，才满足发送崩溃报告的启动条件。接收地址本身不是用户同意。发送前按实现过滤请求头和敏感键；外部模型与来源通信不是这个遥测开关管理的流量。

## 服务端与 CLI

| 变量 | 作用 |
| --- | --- |
| `PHANERIS_SERVER_TOKEN` | 服务端/客户端认证秘密 |
| `PHANERIS_SERVER_URL` | CLI 使用的 WebSocket 地址 |
| `PHANERIS_TLS_CA` | 客户端自定义 CA |
| `PHANERIS_RPC_HOST`、`PHANERIS_RPC_PORT` | RPC 监听地址与端口 |
| `PHANERIS_RPC_TLS_CERT`、`PHANERIS_RPC_TLS_KEY`、`PHANERIS_RPC_TLS_CA` | RPC TLS 证书、密钥与 CA |
| `PHANERIS_HEADLESS` | 当前宿主的无界面启动方式 |
| `PHANERIS_HEALTH_PORT` | 健康检查端口 |

## 消息平台

`PHANERIS_DISABLE_MESSAGING` 可禁用消息网关；`PHANERIS_MESSAGING_WA_WORKER` 与 `PHANERIS_MESSAGING_NODE_BIN` 指定 WhatsApp worker 和 Node 路径。

`PHANERIS_SESSION_ID`、`PHANERIS_WORKSPACE_PATH` 等执行上下文由应用为子进程设置。手工伪造这些变量不会改变实际会话归属或授予权限。

## 下一步

- [应用设置](phaneris://docs/reference/config-file)
- [命令行参考](phaneris://docs/reference/cli-reference)
- [网络代理](phaneris://docs/reference/network-proxy)
