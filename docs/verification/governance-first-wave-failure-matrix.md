# 架构与代码治理首轮失败矩阵

编写日期：2026-10-11；在本轮脚本、CI 和插件生产代码修改之前建立。
范围：[实施计划](../archive/architecture-code-governance-implementation-plan-2026-10-11.md) 的 G0、G1、G2a。验收入口复用 `test:critical`，新增工作流提供进程隔离、临时工作区及 JSON/哈希证据，不新增单元测试。

## G1：验证与门禁

| ID | 注入/复现方式 | 必须成立的结果 |
| --- | --- | --- |
| V01 | 顺序运行现有三条 Runtime 工作流两次 | 输出目录各自唯一；历史证据及其他 tracked 文件内容不变 |
| V02 | 同时运行同一工作流两次 | DB、JSON、manifest 不串写；两个目录都可独立校验 |
| V03 | 指定已存在的 `--output-dir` | 明确拒绝，原目录内容保持原样 |
| V04 | manifest 的 passed/sceneIds 被改成零 | 完整性检查失败，不能把零场景当成成功 |
| V05 | 删除或修改已登记产物 | 完整性检查失败，定位缺失文件或 SHA-256 不符 |
| V06 | 临时仓库里删除 critical 注册入口 | preflight 明确失败，不能由 Bun 的过滤器缩小测试集合 |
| V07 | 工作流执行失败/未知 CLI 参数 | 非零退出；已建立运行目录时保留 failure 和 manifest |
| V08 | CI 的 full-validation 缺 uv，失败步骤没有上传 | 静态门禁拒绝；所有运行 Python 工具的 job 使用同一 uv pin；上传采用 `always()` |
| V09 | 注册 workspace/tooling 不完整，新增 lint warning | 覆盖清单门禁拒绝；warning 按路径/规则/消息/数量登记，不能跨文件抵销 |
| V10 | 只有 `type X = import('private/runtime').X` 的消费者 | 实际 Babel AST 的 TSImportType 同样进入依赖门禁，不因 AST 字段变化遗漏类型依赖 |
| V11 | 全量回归中的旧 IPC 快照、旧 agent mock、可选提示断言 | 先独立复现并确认相关生产文件等于起始 HEAD；校准已有夹具，保留分支回滚/销毁断言；IPC 快照只手动更新，CI 只检查 |
| V12 | 真正的分支 createSession：成功/预检失败/父 SDK context 缺失 | 临时工作区实际写入/加载/删除；预检前已有 Host 只读视图；失败时 child、Host driver、MCP pool 全释放，parent 哈希不变；Domain 通过 cleanup port 使用 Host，不写第二份 agent 状态 |
| V13 | 独立 Host + 真 Pi 子进程 + SQLite + loopback inference | 沿用已有六项行为断言；复跑写独立目录、数据库和 manifest；Host close 后真实子进程退出；失败也留下请求/事件摘要 |

元数据至少含实际 argv、HEAD、开始时 dirty 路径、lock 哈希、OS/架构、Bun/Node/uv、场景 ID、退出码、产物哈希、未覆盖范围。注册场景必须有最低成功数，不能仅依赖退出码。显式归档是维护者选定的新目录；日常复跑默认只写 `.cache/verification/`。

## G2a：插件事务

| ID | 故障位置 | 必须成立的结果 |
| --- | --- | --- |
| P01 | 新 skill 的 staging copy | 老 skill/source/package/guide/凭据哈希不变；新增资源不残留 |
| P02 | 老 skill 移到备份后，staging rename 失败 | 从完整备份恢复；不删除唯一存活副本 |
| P03 | source 备份 copy 失败（包括部分备份） | 老 source 保持原状；已换入 skill 回滚；部分备份不作为恢复依据 |
| P04 | package 备份 copy 失败 | 老 package 保持原状；之前的 skill/source 全部回滚 |
| P05 | package staging rename 失败 | 老 package、可变 data、所有资源恢复；旧凭据保留 |
| P06 | 一份备份已清理，后一份备份清理失败 | 安装保持成功，新资源可读取；结果带 cleanup warning，不进入回滚 |
| P07 | API source 已写 authType:none，后续 package 提交失败 | source config、guide 和加密凭据文件完整恢复；旧凭据仍可在新进程读取 |
| P08 | index 或 audit 写失败，包括旧 index 删除也失败 | 保持现有 best-effort 契约；安装成功但返回 warning；读取在新进程中重新从 package 派生，不能信任旧 index，不误报新安装已完整审计 |
| P09 | 已提交安装的 credential cleanup 失败 | 安装成功并返回 warning；旧凭据可重试清理；不损坏配置或其他资源 |
| P10 | 成功替换和成功重装 | 已配置 API 的合法 baseUrl 保留；旧 API 凭据在完整提交后删除；可变 data、source guide、slug 校验和 shared-provider 卸载保护保持 |

每个场景在独立子进程执行实际 analyze/install、文件复制/重命名/存储和加密凭据读写。故障只在文件系统边界注入；用新的读取进程确认持久化状态，避免凭据缓存假阳性。报告只保存哈希与布尔值，不保存密钥或凭据值。

提交点定义：资源和 package 替换完成；index/audit 为已有 best-effort 派生/记录操作，写失败必须可观察。提交后的备份与凭据清理独立处理，失败不得反向撤销已提交安装。提交前只使用确认完成的备份恢复；若备份意外丢失，保留当前可读副本并报告恢复失败。

边界：本轮不承诺断电/进程崩溃下的跨目录原子性、不支持同时安装同名插件、不改变权限政策、不增加插件市场。真实 SIGKILL 恢复协议属于后续独立工作。

## 验收记录

实施与证据见 [首轮实施台账](../archive/governance-first-wave-2026-10-11.md)。CI 远端运行、Windows/Linux 实机和签名验收必须单列，不能由本地检查推断完成。
