# 工作区

工作区管理一组会话、来源、技能、标签、状态、项目、页面和自动化。它有自己的磁盘目录，适合区分工作与个人上下文。

工作区提供应用层的资源和配置边界，不是操作系统沙箱。全局模型连接、凭据设施或显式授权的外部文件仍可能属于更大范围，不能据此承诺两个工作区永远看不到同一文件。

```text
<工作区>/
  config.json        工作区设置
  sessions/          消息、附件和会话资源
  sources/ skills/   原生来源和技能
  plugins/           插件包
  statuses/ labels/  工作流配置
  automations.json   自动化规则
  projects/ pages/   项目与页面
  artifacts/         Artifact 清单、修订和 checkout
  runtime/           持久执行事实与数据库
  tasks/             Task 定义和兼容导出记录
```

## 切换与转移

工作区切换器改变当前窗口的会话和资源上下文；多个窗口可以分别绑定工作区。未读状态按工作区汇总。

使用应用的会话转移入口移动工作。目标环境重新核对来源、凭据、权限和路径，不应通过直接复制一段目录来假定授权已经正确迁移。远程转移可在目标会话首轮使用一次性摘要，不能把摘要当作完整历史重放。

## 备份、验证与恢复

仓库提供以下离线命令；将示例目录替换为实际绝对路径：

```text
bun run workspace:backup create --workspace <工作区> --output <新备份目录>
bun run workspace:verify verify --backup <备份目录>
bun run workspace:restore restore --backup <备份目录> --workspace <新目标目录>
```

备份为目录树，并为文件记录 SHA-256；Runtime 数据库通过 SQLite 一致性快照处理，不直接拼接活动 WAL。

恢复前停止会写入目标的应用/服务，先验证备份，再恢复到独立空目录。已有非空目标默认拒绝；明确使用 force 替换时会保留原目标的安全副本。损坏清单、校验不符、路径逃逸和不支持的链接会拒绝。

恢复到新目录时，会话实时路径、Artifact 交付路径、工作区默认目录及工作区内部本地来源路径会在暂存阶段调整。历史消息、不可变修订和 Runtime 事实不改写。外部仓库、外部内容目录、全局配置与密钥不在工作区备份范围内；它们需要另外安排。

恢复后重新核对会话、附件、Artifact 修订/checkout、来源配置和 Runtime 状态。已派发但没有持久结果的效果会停放，不能自动重放。通过校验只证明备份字节符合清单，不代表所有外部服务已连通或全部工作已被用户接受。

## 远程工作区

远程工作区运行在其服务端机器上，桌面、Web UI 和 CLI 可以连接同一服务。目录、工具和执行权限属于远端宿主，详情见[远程服务端](phaneris://docs/server/remote-server)。

## 下一步

- [来源](phaneris://docs/sources/overview)
- [技能](phaneris://docs/skills/overview)
- [应用设置](phaneris://docs/reference/config-file)
