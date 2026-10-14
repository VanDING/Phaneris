# 自定义状态

在工作区的状态设置中编辑名称、颜色和允许修改的字段，或让代理通过受支持的配置工具准备变更。磁盘位置为 `<工作区>/statuses/config.json`。

## 稳定标识与显示名称

会话和规则引用 `id`，用户看到的是 `label`。改变显示名称通常不会破坏引用；直接重命名 id 会让已有会话、筛选和自动化失去目标。不要假定系统会替任意手工重命名执行迁移。

| 状态 | 约束 |
| --- | --- |
| `todo`、`done` | 固定标识及类别保留，允许调整的显示字段以界面为准 |
| `backlog`、`needs-review`、`cancelled` 等默认项 | 可以按工作区需要调整；删除前检查现有引用 |
| 自定义状态 | 使用独立稳定 id，选择合适的 open/closed 类别 |

## 颜色与图标

语义颜色如 `accent`、`info`、`success`、`destructive`、`foreground` 会跟随明暗主题，也可使用支持的透明度后缀，如 `info/80`。明确颜色需在明暗背景下都可读。

图标遵循当前状态配置和[图标规则](phaneris://docs/customisation/icons)。支持的本地 `statuses/icons/` 自动发现方式与配置值是不同入口；不要把任意相对路径或内联 SVG 当成通用图标值。

## 示例：客服处理流程

| id | 显示名称 | 类别 |
| --- | --- | --- |
| `todo` | 待处理 | open |
| `waiting` | 等待客户 | open |
| `needs-review` | 准备发送 | open |
| `done` | 已解决 | closed |
| `cancelled` | 不处理 | closed |

这里保留固定 id，新增一个等待阶段，并调整显示名称。看板列若配置了落卡状态，拖卡会写入相应状态；修改此表后应同步检查[看板](phaneris://docs/go-further/kanban)和[自动化](phaneris://docs/automations/overview)。
