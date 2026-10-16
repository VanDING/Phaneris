# 存量项目治理实施结果

Status: implemented — G01–G08 已实施并完成本机回归；首导航超预算及 Windows server 分发限制保留。六份过期图标设计说明已按用户后续授权删除，文档检查现已通过。

授权：用户于 2026-10-16 确认[整体计划](../process/project-governance-audit-plan-2026-10-16.md)。[失败矩阵](project-governance-failure-matrix-2026-10-16.md)先于产品修改；验收绑定 `e08b0413d9d737d2b4914cb46e244ebfcc3d753c` 的未提交治理工作区。之后独立的数据源修复 `5c5c78fa1` 已进入 HEAD，本轮治理按用户授权在其上提交；验证 JSON 保留实际运行时的源码身份，不改写为当前 HEAD 全量复测。

机器可读结果：[汇总与源码摘要](results/project-governance-implementation-2026-10-16/summary.json)、[证据索引与 SHA-256](results/project-governance-implementation-2026-10-16/evidence-manifest.json)。原始审计结果冻结在[审计目录](results/project-governance-audit-2026-10-16/baseline.json)，未用修改后的数据覆盖。

后续清理：用户于 2026-10-16 明确表示图标设计文档已不需要，授权删除六份 Markdown 说明；演示页面、素材和许可文件保留。[清理结果](results/project-governance-implementation-2026-10-16/icon-design-doc-cleanup.json)单独记录。上面的治理汇总保留清理前文档检查失败这一历史事实，不覆盖原始证据。

## 项目与范围

Phaneris 0.3.2 是 13 成员的 TypeScript/Bun 工作区，Electron/WebUI 经 RPC、SessionManager、Durable Runtime/SQLite 与 Pi 子进程运行，JSONL 保留会话兼容存储，另有 MCP 与消息网关。治理集中在已经复现的持久化、检索、连接及页面生命周期故障；没有新增业务能力、依赖、校验门禁或数据迁移。

## 已实施项目

| 模块/位置与优先级 | 原始问题 | 根因 | 实施修改 | 验证结果 |
| --- | --- | --- | --- | --- |
| P0 / G01 / [JSONL](../../packages/shared/src/sessions/jsonl.ts) | 长描述或转移摘要使合法会话从列表遗漏 | 头读取固定为前 8 KiB，截断合法 JSON | 按块读到首个换行/EOF，合并后解码 UTF-8；同步句柄也在 finally 关闭 | H01–H03：长头、边界、跨块中文、无换行、无效/缺失文件通过；格式和内容保留 |
| P0 / G02 / [SessionManager](../../packages/server-core/src/sessions/SessionManager.ts)、product repository | 磁盘删除失败却通知成功，删除与写入竞跑 | 忽略删除 false；未等待已经开始的原子写入 | 取消待写并等待进行中写入；磁盘成功后再移除索引、证据、广播和远端分享 | D01–D03：真实 Windows 锁下拒绝且保留索引、不误发事件；解锁重试、进行中/待写快照与顺序重复删除通过 |
| P0 / G04 / [search service](../../packages/server-core/src/services/search.ts)、sessions RPC | 客户端互相取消搜索；普通文本或混合附件消息漏检 | 全局共用单一进程槽；含 base64 单词就丢弃整行 | 以客户端/工作区归属取消，完成/错误/断线清理；编码候选消息只匹配可见文本 | S01–S03：真实双 RPC 客户端并发、空查询取消、断线 hook、普通文本/混合附件/片段及隐藏会话通过 |
| P0 / G05 / [MCP pool](../../packages/shared/src/mcp/mcp-pool.ts) | 修改头、参数、env 或 cwd 后仍使用旧连接 | 仅比较 URL/Authorization，保存可变对象引用，未比较 stdio 配置 | 对实际连接配置生成稳定签名，HTTP 头按语义比较；复制头/参数/env，按变化重连 | M01–M03：真实 HTTP 与 stdio 的变更/无变化/原地修改，以及参数/env/cwd 分别变化通过 |
| P0 / G06 / [Viewer](../../apps/viewer/src/App.tsx) | 旧请求覆盖新会话、错误或 loading | effect 无取消与过期出口判断 | 清理时中止请求；每个异步出口确认有效；回上传页清除 loading | V01/V02：旧成功、旧 404、清空三场景通过，旧响应不覆盖新内容 |
| P1 / G03 / [DurableRuntimeStore](../../packages/server-core/src/durable-runtime/store.ts) | 新增用量提交耗时随历史账本增长 | appendUsage 使用 listUsage().find，全表读出并解析 | 使用既有 usage_id 主键查询，复用相同行解码及 canonical 比较 | U01/U02：文件 WAL、相同重放、冲突拒绝、事实/用量事务回滚、不全量枚举通过 |
| P2 / G07 / [WebUI](../../apps/webui/src/main.tsx) | chunk/渲染异常后白屏，无法展示已有恢复入口 | 名为 ErrorBoundary 的组件实际只有 Suspense | 接入真正 React 错误边界及已有 CrashFallback；加载与错误状态分开 | W01：生产 chunk 503、渲染异常均显示回退；恢复网络后按钮重载恢复正常 |
| P4 / G08 / 既有测试、[文档 runner](../../scripts/test-doc-tools.ts) | 旧测试失败；文档测试无法找到已有运行时 | mock/断言过期、30 次真实登录预算不足、硬编码 PATH uv | 对齐当前契约；独立登录场景设 20 s 预算；复用现有 Python 运行时解析 | CDP 19、窗口 88、共享契约 109 项针对性测试通过；文档 24/24；全量 6,301 pass / 0 fail / 7 skip |

删除错误路径由“静默成功并移除前端会话”改为“通过现有 RPC 错误通道报告失败，保留索引供重试”。其余修复恢复对应现有功能的正确行为。API 字段、通道、文件格式、正常业务规则及已有安全机制保留。

RPC 索引更新仅反映行号：去掉源码 `line` 后，426 个通道的参数、路由、校验、返回契约与 HEAD 完全一致。没有修改索引检查规则。

## 性能数据

Windows x64 / Intel i5-1340P / Bun 1.4.2。生产 `commitFactsAndUsage`，历史种子插入在计时外，每规模预热 3 次、记录 9 次中位数，沿用审计配方。

| 原有用量行数 | 修改前：内存 SQLite | 修改后：内存 SQLite | 修改后：文件 WAL |
| --- | --- | --- | --- |
| 0 | 0.062 ms | 0.028 ms | 0.809 ms |
| 1,000 | 2.853 ms | 0.043 ms | 0.619 ms |
| 10,000 | 15.378 ms | 0.025 ms | 1.246 ms |
| 50,000 | 114.036 ms | 0.019 ms | 1.170 ms |

修改前新增提交枚举 N 条历史，修改后走现有主键索引，不再调用全量读取器。上述是局部提交耗时，不是端到端模型速度；微秒级样本有噪声，不推算系统整体提升比例。文件 WAL 模式修改前未测量，不作该模式的前后比较。

### 完整 WebUI 性能复测

使用刚完成的生产 WebUI/Runtime 构建，真实 WS/RPC/SessionManager 与离线合成数据：24 会话，100/1,000/5,000 条消息，5 次热切换，200 个流式增量，60 s 实时 idle；复测时没有同时运行本轮其他构建/验收作业。命令退出 1，唯一失败预算为首导航；浏览器错误为 0。[完整预算结论](results/project-governance-implementation-2026-10-16/performance-summary.json)。

| 指标 | 审计观测 | 修改后观测 | 既有预算 / 结果 |
| --- | --- | --- | --- |
| 首导航 / 第二窗口 | 3,447 / 2,498 ms | 4,992 / 1,959 ms | 每次 ≤3,000 ms；首导航仍失败 |
| 首次加载 100 / 1,000 / 5,000 条 | 228 / 496 / 935 ms | 277 / 554 / 1,488 ms | ≤3,000 ms，通过 |
| 热会话切换 | 184–366 ms | 233–350 ms | ≤2,000 ms，通过 |
| 输入后两帧代理指标 | 32–71 ms | 41–75 ms | ≤250 ms，通过 |
| 首个流式内容后两帧 | 229 ms | 325 ms | ≤1,500 ms，通过 |
| renderer heap / backend RSS | 62.3 / 201.9 MB | 92.0 / 181.6 MB | 256 MiB / 1 GiB，通过；均为瞬时采样 |

这些前端数字仅是两次观测，不能解释为修复带来的提升或退化。Edge 自动从 `155.0.4283.45` 更新为 `155.0.4283.60`，浏览器/文件缓存与 GC 状态未受控；heap/RSS 也不是峰值或 retained heap。两帧指标不是硬件呈现延迟。

首屏[现有采样对照](results/project-governance-implementation-2026-10-16/startup-comparison.json)显示：首窗口均请求 97 个资源，编码体积由 4,900,772 变为 4,900,909 字节；DOMContentLoaded 约 627 / 622 ms。复测中 pages/automations/projects 等并行 RPC 壁钟耗时约 1.84–1.91 s，审计约 0.57–0.58 s。它们可能包含相互重叠的等待，不能直接相加或当作 CPU 耗时；现有证据不足以定位代码根因。因此没有调整预算、盲目拆包或声称首屏已优化，该问题明确未解决。

## 整体测试与兼容性

| 检查 | 当前结果 |
| --- | --- |
| 新增真实存储/SQLite、RPC/MCP、生产浏览器场景 | 8 + 6 + 5 = 19 个场景通过，保留 JSON、trace 与截图 |
| typecheck:all | 通过；最后的验收脚本增强另经 typecheck:scripts 重跑通过 |
| 完整 `bun run test` | 6,301 pass / 0 fail / 7 skip，462.93 s；原有 26 个失败归零，没有新增跳过 |
| test:doc-tools | 24/24 通过；使用既有 bundled uv，UV_OFFLINE=1，无 PATH 补丁 |
| 完整 `bun run lint` | 通过，491.19 s；2,305 文件，72 条既有登记警告；架构、循环依赖、RPC 与分发输入检查全部通过 |
| `build:runtime` | 通过，104.59 s；Pi 子进程和 WhatsApp worker 重新构建 |
| `build:smoke` | 整体退出 1，359.92 s；Electron main/preload/renderer、WebUI、Viewer 五项通过，之后 server 分发拒绝 win32，与基线相同 |
| i18n 四项、fonts、identity、version、runtime、electron-pin | 全部通过；没有改变既有检查规则 |
| `check:docs` | 治理回归时退出 1；后续经用户授权删除六份过期说明后通过，原六项索引问题已消除 |
| 差异与用户文件 | `git diff --check` 通过；治理回归时 246 个设计文件均未改，后续仅授权删除六份说明，其余 240 个文件 SHA-256 一致；bun.lock 未改 |
| `test:upstream-015` | 33/33 通过，205.91 s；core 11、orchestration 5、真实 Electron/CDP 11、生产 React renderer 6；四组 manifest 均退出 0 并通过产物 SHA-256 校验 |
| 完整 WebUI 性能复测 | 退出 1，114.50 s；7 项预算中 6 项通过，首导航失败；完整工作负载已执行，浏览器错误 0 |

最初类型检查捕获 MCP 联合类型收窄与新增验收脚本声明问题，已修正并重跑通过。首次 Lint 在 RPC 索引过期处失败；刷新索引后，语义兼容和完整 Lint 均重跑通过。中间失败日志保留。基线的 Pages 构建超时用例本次在完整测试中通过，未修改其测试代码；旧测试的 26 个失败不等同于 26 个产品缺陷。

### 重复验证

以下命令均从仓库根目录执行，使用独立合成数据；输出目录须尚不存在。浏览器验收先运行 `bun run viewer:build` 和 `bun run webui:build`，生产构建不在场景里替换为开发页面。Windows 使用现有 Edge，其他平台本轮未验证。

```sh
bun run scripts/verification/project-governance-storage-workflow.ts --output-dir=.cache/verification/governance-storage-repeat
bun run scripts/verification/project-governance-services-workflow.ts --output-dir=.cache/verification/governance-services-repeat
bun run scripts/verification/project-governance-browser-workflow.ts --output-dir=.cache/verification/governance-browser-repeat
bun run scripts/verification/project-governance-usage-benchmark.ts --output-dir=.cache/verification/governance-usage-repeat
bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/governance-storage-repeat
```

另外三个输出目录可用同一 `--verify` 命令检查。专项 manifest 记录命令、退出码、HEAD、未提交文件摘要、场景和产物 SHA-256；本轮四组产物完整性检查均通过。完整日志、合成夹具、SQLite 文件、浏览器 trace 与截图保留在本机忽略目录，不将它们当作生产数据或正式发行验收。

## 保留的问题与验证限制

- Windows 上现有 headless server 分发脚本仍只支持 macOS/Linux；不新增平台能力，也不跳过失败伪造完整 build:smoke 通过。
- 首导航仍超预算，具体根因尚未确认；资源/RPC 采样已保留，但没有足够依据实施安全的局部启动优化。完整 WebUI 性能流程不能记作通过。
- 删除不是文件系统与 Runtime 数据库之间的事务。底层递归删除若部分完成，不提供磁盘回滚；本次修复保证失败不会误报成功，不新增回收站或数据迁移。
- 未验证 macOS/Linux 原生、正式签名安装包、完整 test:critical/全新安装/容器矩阵，以及真实供应商、OAuth 和外部消息服务。局部 Windows 结果不扩展为这些范围通过。

## 计划核对与结论

| 计划批次 | 最终状态 |
| --- | --- |
| B0 / G08：场景与验证依据 | 完成；先记录失败条件并复现，修正已过期的测试桩/断言，保留原始失败日志 |
| B1 / G01、G02：存储与删除 | 已实施并验证；删除进行中 writer 的竞态先复现后修复；验证仅覆盖已列场景，不承诺文件系统事务回滚 |
| B2 / G03：用量提交 | 已实施并验证；主键路径、幂等/冲突/事务语义和同配方基准通过 |
| B3 / G04–G07：搜索、连接、页面生命周期 | 已实施并验证；stdio 配置问题经真实子进程复现后纳入原 G05 范围 |
| B4 / G08：整体回归与复盘 | 已执行；完整测试、类型、Lint、文档工具、既有 33 场景及应用/Runtime 构建通过；当时三个整体命令失败保留历史原因，其中文档索引问题已在后续授权清理中解决 |
| 条件项：首屏性能改造 | 未实施；测量仍超预算，但归因不足，避免凭单次波动修改加载架构 |

本轮消除了已复现的会话遗漏、删除误报及写入竞态、跨客户端搜索取消/文本漏检、连接配置不生效、Viewer 旧响应覆盖和 WebUI 白屏故障；用量提交不再枚举完整历史。没有用新增功能、依赖或门禁换取这些结果。

后续优先对首屏的 RPC/文件系统/主线程等待做固定浏览器版本的重复采样与 CPU/磁盘归因，再决定最小修改。其余大文件拆分、批量清警告和依赖升级未实施，当前没有可验证收益。正式发行及其他平台继续沿用原验收边界。本轮未提交、推送、发布，也未操作生产数据或基础设施。
