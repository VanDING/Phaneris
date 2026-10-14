# 自动应用规则

规则从你发送的消息中匹配模式，为会话应用标签和提取到的值。例如提及 `CRA-123` 后自动添加 `linear-issue::CRA-123`。

规则保存在对应标签的 `autoRules` 中：

```json
{
  "id": "linear-issue",
  "name": "Linear 工单",
  "valueType": "string",
  "autoRules": [
    {
      "pattern": "linear\\.app/[\\w-]+/issue/([A-Z]+-\\d+)",
      "valueTemplate": "$1",
      "description": "提取 Linear 工单链接中的编号"
    },
    {
      "pattern": "\\b([A-Z]{2,5}-\\d+)\\b",
      "valueTemplate": "$1",
      "description": "匹配 CRA-123 形式的独立编号"
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `pattern` | 必填，JavaScript 正则表达式，可使用捕获组 |
| `flags` | 默认 `gi`；始终按全局匹配处理 |
| `valueTemplate` | 用 `$1`、`$2` 等构造标签值，省略时使用首个捕获组 |
| `description` | 解释匹配意图，便于以后维护 |

同标签的多个规则均会参与匹配，结果按标签与值去重。消息匹配有上限，避免一段日志生成大量标签。无效或存在明显灾难性回溯风险的表达式会在保存校验时被拒绝。

## 触发时机

匹配用户发送的消息，包括新消息和排队消息；不把代理输出或工具结果当作用户标签依据。代码围栏和行内代码会先被剥离，减少示例片段引起的误匹配。

## 值的规范化

| 类型 | 捕获示例 | 规范化结果 |
| --- | --- | --- |
| string | `CRA-123` | `CRA-123` |
| number | `$45,000` | `45000` |
| number | `1.5M` | `1500000` |
| number | `50k` | `50000` |
| date | `2026-01-30` | `2026-01-30` |

用独特前缀、完整 URL 或明确编号结构限定范围，避免 `\d+` 之类会匹配所有数字的规则。可以分别提供链接和裸编号规则；启用后检查实际标签，及时调整噪声匹配。

## 下一步

- [标签](phaneris://docs/labels/overview)
- [自动化](phaneris://docs/automations/overview)
