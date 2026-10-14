# 网络代理

在设置的网络页面配置应用代理，避免只在系统浏览器中设置后就假定模型和来源请求也能访问网络。

| 字段 | 含义 |
| --- | --- |
| Enabled | 是否应用代理配置 |
| HTTP proxy | HTTP 请求使用的代理 |
| HTTPS proxy | HTTPS 请求使用的代理 |
| No proxy | 应直接连接的主机，使用当前配置支持的列表格式 |

设置保存在 `config.json` 的 `networkProxy` 中，字段为 `enabled`、`httpProxy`、`httpsProxy`、`noProxy`。宿主管理的网络请求按相应接线路径使用；独立脚本、来源子进程或外部浏览器是否继承代理，仍需按实际运行时核查。

## 本地地址

把 localhost、本机回环地址和需要直连的内网服务放入 noProxy。常见地址包括 `localhost`、`127.0.0.1`、`::1`。否则本地模型或内网 API 可能被发往无法访问它们的代理。

## 企业代理

代理 URL 的协议表示连接代理本身的方式。代理 HTTPS 流量时，代理地址仍可能是 `http://proxy.example.com:8080`，不能只凭目标 URL 改成 HTTPS。

把用户名密码写进 `http://user:pass@proxy...` 会使秘密出现在普通配置中，不等于加密凭据存储。采用符合部署环境的认证方式，导出诊断前去除秘密。

TLS 检查代理会重新签发证书，需要让实际请求运行时信任组织 CA。系统信任、Node/Bun 与具体客户端的 CA 配置不一定相同；远程 RPC 可使用受支持的自定义 CA 入口。不要通过关闭证书验证绕过配置问题。

## 排查问题

全部请求失败时检查代理地址、协议、端口、认证与 CA；只有本地服务失败时检查 noProxy；系统浏览器可访问但应用失败时，分别检查应用配置和实际子进程环境。

## 下一步

- [应用设置](phaneris://docs/reference/config-file)
- [环境变量](phaneris://docs/reference/environment-variables)
