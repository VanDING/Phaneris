# 命令行参考

CLI 是运行中 Phaneris 服务端的客户端，通过同一后端读取和执行工作。它不是第二个独立代理实现。完整参数说明见仓库 `docs/guides/cli.md` 和当前命令的 `--help`。

## 适用范围

CLI 适合脚本、远程服务、资源配置和流水线。桌面阅读、文件差异、浏览器及交互批准等能力不一定都有同等 CLI 界面，不能把“共享后端”理解为每个图形操作都能由同一条命令替代。

## 连接参数

| 参数 | 对应环境变量 | 用途 |
| --- | --- | --- |
| `--url <ws[s]://…>` | `PHANERIS_SERVER_URL` | 服务地址 |
| `--token <secret>` | `PHANERIS_SERVER_TOKEN` | 认证 |
| `--tls-ca <path>` | `PHANERIS_TLS_CA` | 自定义 CA |

显式参数优先于对应环境设置。秘密出现在命令行中可能进入命令历史或进程查看器，脚本部署应按环境的秘密管理方式处理。

## 常见操作组

信息与健康查询、能力发现、会话/来源/技能/标签/状态/自动化列表，以及受支持的会话创建、读取、发消息、停止和归档。`run` 适合一次提交提示并输出结果；具体流式和 JSON 格式以命令帮助为准。

来源、技能、标签和自动化的创建与校验应走受支持的资源命令。启用相应 CLI 治理功能后，代理对受保护配置的修改也按这些入口校验，不能用直接重写配置跳过。

`--json` 便于机器读取；脚本应检查退出码及 `AUTH_FAILED` 等稳定错误类型，不依赖解析展示文案。

## 启动服务

```bash
PHANERIS_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
```

这是 Bash 示例。服务需要显式认证，远程部署应配置 TLS。客户端路径参数通常在服务端机器解析；本机存在的文件不代表远端也存在。

## 排查问题

认证失败时核对客户端与服务端 Token。TLS 服务使用 `wss://` 并配置正确 CA。连接失败先检查监听地址、端口和网络。发出停止请求不代表未知外部效果已撤销，仍应检查实际 Runtime 状态。

## 下一步

- [远程服务端](phaneris://docs/server/remote-server)
- [环境变量](phaneris://docs/reference/environment-variables)
- [安装](phaneris://docs/getting-started/installation)
