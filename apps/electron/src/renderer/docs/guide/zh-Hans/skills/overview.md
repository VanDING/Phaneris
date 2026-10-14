# 技能

技能（Skill）是一组可复用指令，用来规定某类工作的交付方式，例如代码审阅、发布说明、研究报告或收件箱整理。

## 使用技能

在消息中输入 `@`，从补全列表选择技能：

```text
@code-review 审阅当前分支的改动
```

补全列表也可能包含来源和文件，选择时注意类型。未匹配的提及可能只作为普通文本传入。技能和切换模式、选目录等 slash 指令属于不同机制。

## 文件结构

```text
<工作区>/skills/<slug>/
  SKILL.md        必需：YAML 元数据和 Markdown 正文
  icon.png        可选图标
  references/     可选参考资料
  scripts/        可选脚本
```

```markdown
---
name: code-review
description: 审阅代码变更并按严重性列出可操作的问题
---
说明预期结果、检查范围和交付格式；需要时引用本目录中的参考文件。
```

`description` 应说明何时使用，具体方法放在正文。一个技能最好只承载一类工作；把模板和长清单放在引用文件中，避免每次加载无关内容。

## 查找优先级

同 slug 的普通技能按最具体定义解析：

1. 项目目录的 `.agents/skills/<slug>/SKILL.md`。
2. 工作区的 `skills/<slug>/SKILL.md`。
3. 全局 `~/.agents/skills/<slug>/SKILL.md`。

插件名单有明确的物化语义：它指向工作区 `skills/` 中的原生副本，名称、描述和实际读取路径都取自该副本。仅修改包内技能而未重装，不会静默改变名单的执行内容。副本缺失或无效时会报告不可用，不回退读取包内文件。

## 兼容与排查

技能可声明 `requiredSources`；使用时核对所需来源的真实状态。导入的 `globs`、`alwaysAllow` 等兼容字段不意味着本应用会照搬其他工具的自动激活或权限授予行为。

技能未按预期工作时，检查 slug、补全选择、解析优先级与正文，而不是只修改列表描述。包含脚本的技能仍受当前权限模式和工具规则约束。

## 下一步

- [插件](phaneris://docs/plugins/overview)
- [来源](phaneris://docs/sources/overview)
- [工作区](phaneris://docs/go-further/workspaces)
