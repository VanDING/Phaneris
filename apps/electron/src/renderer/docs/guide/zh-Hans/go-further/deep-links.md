# 深层链接

桌面应用注册 `phaneris://` URL scheme，可从链接、脚本或其他应用打开指定界面。注册是否可用取决于当前安装和系统关联。

| 链接形式 | 目标 |
| --- | --- |
| `phaneris://allSessions` | 会话列表 |
| `phaneris://allSessions/session/{id}` | 指定会话 |
| `phaneris://flagged` | 已标记会话 |
| `phaneris://state/{statusId}` | 指定状态列表 |
| `phaneris://sources` | 来源列表 |
| `phaneris://sources/source/{slug}` | 指定来源 |
| `phaneris://skills` | 技能 |
| `phaneris://automations` | 自动化 |
| `phaneris://projects` | 项目 |
| `phaneris://projects/board` | 看板 |
| `phaneris://projects/calendar` | 日历 |
| `phaneris://settings/{subpage}` | 设置页 |
| `phaneris://docs/{slug}` | 帮助页，正文按界面语言显示 |

## 窗口和工作区

支持的桌面路由可追加 `?window=focused` 或 `?window=full` 请求独立窗口。明确工作区时可使用：

```text
phaneris://workspace/{workspaceId}/allSessions/session/{sessionId}
```

## 动作链接

部分动作路由可新建或标记会话，例如：

```text
phaneris://action/new-chat?input=Review%20this%20repository&send=true
phaneris://action/flag-session/{sessionId}
phaneris://action/unflag-session/{sessionId}
```

只有当前宿主明确允许的参数会被转发。不能依赖任意 query 参数成为代理指令；带立即发送语义的链接可能开始工作，应核对目标工作区和输入。

这些是应用导航契约，不是完整公共自动化 API。升级可能调整路由。Web UI 不应依赖操作系统解析 `phaneris://`，其帮助入口使用应用内状态打开；帮助正文中的内部链接也由阅读器截获，保留当前语言。

## 下一步

- [安装](phaneris://docs/getting-started/installation)
- [会话](phaneris://docs/core-concepts/conversations)
