# R01–R07 实施与本地验收

状态：accepted — 2026-10-14，本地 Windows x64 验收通过。当前范围与关闭裁定只在[统一实施台账](../../../process/implementation-value-register-2026-10-13.md)维护；[失败矩阵](../../implementation-r01-r07-failure-matrix-2026-10-14.md)先于对应实现记录。

基线为本地 `main` / `19e730ffe29ab9c99c6b2705a3fedef147240777`，Phaneris 0.3.1 / Pi SDK 1.1.0。改动尚未提交。每个工作流保留实际源码 SHA、lockfile、环境、断言和完整产物清单；生产桌面另记录 main、preload、interceptor、Pi 与所有 renderer JS/CSS/WASM 的构建摘要。

## 实施结果

| 工作包 | 已实现行为 | 验收 |
| --- | --- | --- |
| R01 | Task 所有节点在新建/恢复派发前解析显式权限；节点覆盖默认，遗漏时零派发拒绝；保留显式 allow-all | [task-permission：9/9](task-permission/scenes.json) |
| R02 | roster 读取原生 Skill；一次性短时确认绑定工作区、包快照和目标状态；物化校验与 readiness 一致；Windows 透明参数及 watcher 修复 | [plugin-consistency：17/17](plugin-consistency/plugin-consistency.json)；[既有事务：13/13](plugin-transaction/plugin-transaction.json) |
| R03 | 恢复到新目录重定位所属活跃路径；恢复后桌面工作流、原数据摘要、未知效果停放、真实 Pi 交互与文件预览 | [workspace-recovery：10/10](workspace-recovery/workspace-recovery.json)；[native-client：27/27](native-client/native-client.json)；[独立 crash：8/8](durable-runtime-crash/crash.json) |
| R04 | Run 展示/导出重复动作、错误、轮询/SDK 分类、终态、未决年龄、预算、已知/未知费用；由保留事实确定性重建 | runtime-reliability：10/10；[重启前](runtime-reliability/reliability-before-restart.json) / [重启后](runtime-reliability/reliability-after-restart.json) |
| R05 | 读/写 file_scope、路径别名规范化、同 Host 跨 Runner 协调、缺省可写目录保守串行、恢复声明冻结 | [task-file-scope：11/11](task-file-scope/task-file-scope.json) |
| R06 | 普通叶任务拖动、缩放和键盘改期；沿用规划写入，保留末日、时间和 DST，取消/失败回滚及在途修改保护 | [gantt-reschedule：14/14](gantt-reschedule/gantt-reschedule.json) |
| R07 | 完整 47 页 zh-Hans、中文导航/搜索、稳定 slug/内部跳转、英文切换及窄屏阅读；同步修正过期帮助承诺 | [docs-locale：52/52](docs-locale/docs-locale.json) |
| 文件链接补修 | 保留清洗前文件目标，修正编码盘符及 CommonMark 分隔符，避免重复解码与破坏引用定义；保留危险 HTML/协议拦截 | [markdown-file-links：18/18](markdown-file-links/markdown-file-links.json)；生产桌面逐次验证六种路径 |

所有列出的完整运行目录均已通过 VerificationRun 的产物存在、唯一场景及 SHA 校验，相关产品源码摘要与当前文件一致。逐项场景 ID、环境、运行目录、manifest SHA 和未测范围见 [summary.json](summary.json)。另复跑既有受管工具/codemode 能力工作流 8 项及 Task 治理工作流 3 项。

## 桌面真实流程与补修

- 使用 Electron 44.5.1 的生产 main/preload/renderer、真实 Pi SDK 和确定性的本机模型服务，独立 profile 与合成工作区；未使用个人工作材料或付费 provider。
- 备份/恢复样本包含 160 条历史转录、附件、Artifact revisions/checkout、配置及 Runtime。恢复后未知 T1 不重放，Run 的实际导出 JSON 与 child effect ID 一致；Artifact 编辑、保存、提交、接受只写入恢复目录，原目录摘要保持。
- 桌面执行实际 Write 权限批准、SubmitPlan 接受与继续、取消、重连/草稿/历史合并、长会话主题切换、1280/420px 和 reduced-motion；最终注入主进程 fatal rejection，保留原始原因并验证按期限非零退出。
- 文件链接逐次关闭旧 Artifact/Preview，再点击回答中的 Windows 反斜杠、正斜杠、file URL、编码路径、相对路径及源码行号链接；每次都要求新的 Workbench 展示实际写入内容且没有打开失败提示。文件名含中文和空格。
- 最初失败未删除：清洗配置丢失文件目标、CommonMark 将 `\\.cache` 变成 `.cache`、以及 SQLite URI 未显式启用 URI flag 均有失败记录。旧预览导致的假通过条件已移除；最终通过目录为 `.cache/verification/native-client-JDiMTy/`，浏览器为 `.cache/verification/markdown-file-links-yF0hhD/`。

关键修复还包括：可靠性报表使用 child operation ID，分页读取超过 1000 条保留事实，显式统计结算后仍未知的费用；Gantt 使用拖动前日期与日历位移，拒绝不存在的 DST 本地时刻；帮助内部链接在本地路由中处理并在换页时回到标题。

## 门禁与回归

| 检查 | 结果 |
| --- | --- |
| `typecheck:all` | PASS，含全部应用、共享包、构建与脚本项目 |
| `lint` | PASS；Runtime 边界、主题、视觉、治理、IPC、依赖边界、循环、RPC 和发行输入全部通过 |
| i18n parity / sorted / coverage / dead-keys | PASS，2651 个英文键，2870 个引用；其余 6 个 locale 对齐 |
| `identity:check` / `version:check` | PASS；0.3.1 在 27 处声明一致 |
| 关键工作流注册 preflight | PASS，38 个工作流、6 个包组；本轮未运行全量 `test:critical` / `validate:full` 组合 |
| 既有针对性测试 | TaskRunner 52、插件安装 32、插件上下文 11、备份 5、帮助 manifest 8、Markdown/linkify 78，均通过 |
| 生产 renderer 构建 | PASS；保留既有 bundler externalization / chunk size 提示，未调整预算阈值 |

上述门禁与回归的退出码、日志摘要见 [static-checks.json](static-checks.json)，本目录文件摘要见 `SHA256SUMS`。首次繁忙环境中的既有极短超时 TaskRunner 用例失败，原阈值保持；最终隔离复跑 52/52 通过。视觉门禁只移除已由实际控件修复淘汰的旧指纹，未新增豁免；历史冻结记录和版本发布说明保持原字节。

## 范围与复跑

file_scope 是同 Host 的声明式调度契约；可靠性观察不改变执行、不自动 nudge/park，用户接受仍为 unknown。原生“已配置”不代表外部连接健康。其他 OS、真实外部 provider/OAuth、物理触摸和签名安装器为 NOT RUN；L01/L02 仅关闭本地 Windows 范围，C01 继续约束发行验收。

在仓库根目录使用 PowerShell 复跑。每次自动创建新的 `.cache/verification/<id>-<随机后缀>/`，显式 `--output-dir` 也拒绝覆盖既有目录。

```powershell
$env:PHANERIS_TEST_BROWSER_CHANNEL = 'msedge'
bun run test:task-permission
bun run test:plugin-consistency
bun run test:workspace-recovery
bun run test:runtime-reliability
bun run test:task-file-scope
bun run test:gantt-reschedule
bun run test:docs-locale
bun run test:markdown-file-links
bun run test:native-client
```

`test:native-client` 会先构建 Runtime 和生产 Electron。完整运行的校验命令为 `bun run scripts/verification/verification-artifacts.ts --verify=<实际运行目录>`。

本目录按仓库媒体保留政策仅保存结论与选定 JSON，**不是完整 VerificationRun 归档**。截图、trace、数据库和日志留在 [summary.json](summary.json) 指定的本机缓存目录；不能对本目录执行完整产物校验。构建身份见 [build-hashes.json](native-client/build-hashes.json)，真实导出见 [native-reliability-export.json](native-client/native-reliability-export.json)，持久效果顺序见 [electron-conversation-runtime.json](native-client/electron-conversation-runtime.json)。桌面记录中的唯一 console error 来自预期的 fatal rejection 注入。
