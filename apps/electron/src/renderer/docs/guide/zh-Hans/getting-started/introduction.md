# 简介

Phaneris 是一款桌面 AI 协作应用。你在会话中描述目标，代理在所选权限模式下读取文件、运行命令、修改材料，或通过来源访问外部系统。会话保留工具调用与结果，便于检查实际发生的工作。

本项目由 [Craft Agents 开源代码](https://github.com/craft-ai-agents/craft-agents-oss)发展而来，独立命名和构建。帮助内容随应用打包，离线可读。

## 本构建的服务边界

- 对话分享至托管查看器、Page 发布至云端的功能未配置为可用服务；不会回退到上游服务。已有本地[页面](phaneris://docs/go-further/pages)仍可使用。
- 界面的帮助入口打开本应用内文档。
- 崩溃报告默认关闭。发送需要同时配置接收地址和 `PHANERIS_TELEMETRY_ENABLED=1`；仅配置 DSN 不等于开启。诊断会过滤请求头和敏感键。你主动使用的模型、来源和消息平台仍按各自配置与外部系统通信。

## 基本概念

| 概念 | 用途 |
| --- | --- |
| 会话（Session） | 一段可命名、归档、继续工作的对话，附带状态和记录 |
| 来源（Source） | MCP 服务器、REST API 或本地文件夹等能力接入 |
| 技能（Skill） | 可复用的操作指令，通过提及选用 |
| 插件（Plugin） | 将相关技能、来源声明和常驻指令组织成一个包 |
| 状态、标签 | 分别表示工作进度和主题分类 |
| 自动化 | 按时间或事件触发工作 |
| 工作区 | 管理各自的会话、来源、技能和工作流配置 |
| 项目 | 在工作区内组织服务于同一目标的会话 |
| 页面（Page） | 保存在工作区中的持久小应用 |
| 权限模式 | 控制代理执行前是否需要询问，及哪些动作会被阻止 |

## 数据位置

默认配置目录是 macOS/Linux 的 `~/.phaneris/`、Windows 的 `%USERPROFILE%\.phaneris\`。可用 `PHANERIS_CONFIG_DIR` 指定独立配置目录。

```text
~/.phaneris/
  config.json          应用设置、模型连接和工作区列表
  preferences.json     用户偏好
  credentials.enc      加密凭据
  workspaces/          默认工作区位置
  docs/                供代理读取的帮助资料
  themes/              用户主题
  logs/                本地日志
```

工作区可以放在其他位置；会话的工作目录也可能指向外部仓库或文档目录。这些外部材料不因备份配置目录而自动纳入。凭据解密还依赖当前部署的密钥机制，不能只复制加密文件便假定可以在另一台机器恢复。

## 查看代理的工作

聊天记录用于阅读每轮输出和工具结果，Run 工作台用于检查执行、用量与恢复事实。计划提交、权限请求和 Artifact 接受是不同操作；运行完成也不等于你已经接受交付物。

先用探索模式了解材料，再根据需要选择询问、守护或执行模式。执行模式仍受明确的限制性工具规则约束。未知的外部效果在恢复后会停放等待核查，不会自动重放。

## 下一步

- [安装](phaneris://docs/getting-started/installation)
- [权限](phaneris://docs/core-concepts/permissions)
- [来源](phaneris://docs/sources/overview)
- [工作区](phaneris://docs/go-further/workspaces)
