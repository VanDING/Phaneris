# 应用设置

应用级设置保存在 `~/.phaneris/config.json`，或 `PHANERIS_CONFIG_DIR` 指定的配置目录。优先使用设置界面和受支持的配置入口，避免手工写出无法通过校验的数据。

## 常用字段

| 键 | 用途 |
| --- | --- |
| `notificationsEnabled` | 会话通知 |
| `sendMessageKey` | Enter 或组合键发送 |
| `autoCapitalisation` | 输入自动大写 |
| `spellCheck` | 拼写检查 |
| `keepAwakeWhileRunning` | 执行期间保持唤醒 |
| `richToolDescriptions` | 工具说明详略，影响上下文 |
| `promptCacheWarming` | 可选的缓存刷新，默认关闭；会增加请求和费用 |
| `extendedPromptCache` | 在 provider 支持时选择更长缓存保留策略 |
| `browserToolEnabled` | 是否提供内置浏览器工具 |
| `allowRemoteEvaluate` | 远程代理是否可执行受控的页面脚本入口 |
| `themeMode`、`colorTheme`、`themeFont` | 外观选择 |
| `networkProxy` | 应用网络代理配置 |

配置还包含工作区列表、模型连接与应用默认值。连接定义和凭据分开保存，但代理 URL 等用户填写字段仍可能包含敏感信息，不能把整个文件当作可公开资料。

## 写入与默认配置

正常写入使用原子替换并保留受支持的备份。POSIX 权限与 Windows ACL 不是同一机制，具体保护以部署环境为准。

`config-defaults.json` 承载应用内置默认值，启动时由打包资源更新，不是用户持久覆盖入口。工作区默认权限和思考等级、可切换模式应以当前工作区界面为准；Task 的缺省权限另受显式声明规则约束。

## 手动编辑

需要脚本化配置或调整没有 UI 的选项时，先保留原文件，通过校验后再写入。运行中的监听器可以刷新部分设置；无法解析的内容会报告或保留上一份有效状态，不能据此假定所有配置变更都已即时生效。

## 下一步

- [偏好设置](phaneris://docs/reference/preferences)
- [工作区](phaneris://docs/go-further/workspaces)
- [主题](phaneris://docs/customisation/themes)
