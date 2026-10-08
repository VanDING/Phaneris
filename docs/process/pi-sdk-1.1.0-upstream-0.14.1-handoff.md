# Phaneris：Pi SDK 1.1.0 / Craft 0.14.1 交接文档

更新时间：2026-10-08（Asia/Shanghai）  
交接目标：让下一位 AI 从当前工作树继续完成升级，而不是从评估阶段重新开始。

## 先看结论

Pi SDK 1.1.0 已经完成安装、桥接适配和 B0–B3 的实现。当前 B4“大结果按意图筛选”已经接入一版，独立 E2E 工作流目前 **7/8 通过**；剩下 1 项是真实 Pi 子进程 + MCP/API + Durable T1/T2 的整合断言失败，必须修好后才能提交 B4。

B5（全仓门禁、Electron/WebUI/Viewer 构建、Windows 最终包、包外运行时、截图和最终文档）尚未完成。当前工作树存在未提交的 B4 代码和用户原有的 3 个验证脚本改动，不能直接把整个工作树全部 git add。

## 当前工作树

使用这个隔离工作树继续：

    Set-Location 'C:\Users\dotty\.codex\worktrees\pi-110-upstream-0141\Phaneris'
    git branch --show-current
    git log --oneline --decorate -8
    git status --short

当前 HEAD：ac4c4f57（B3 提交）。原始仓库 E:\Phaneris 的 main / origin/main 仍是 351f592c，没有合并、推送或发布。

已提交的边界：

| 提交 | 内容 | 结果 |
| --- | --- | --- |
| 722a2c0f | B0：完整等待 Pi 子进程启动与工具同步，修复首轮竞态和内部重入 | 启动基线 4/4 失败可复现；修复后 4/4 通过 |
| 199dc84d | B1：Pi 家族 1.1.0、Azure 边界兼容、aborted、duration、OAuth/Vault、工具/codemode 适配 | 全量类型检查、Pi bundle、兼容性、Azure、原生能力工作流通过 |
| 719942ba | B2：认证重试决策复用、冷启动 deadline、日志轮转统计、远程 GET_USAGE、设置页统计、侧栏 tooltip | B2 决策工作流 5/5 通过 |
| ac4c4f57 | B3：上一条最终回复尾部、附件元信息、纠正/重大操作保护、取消和后续反馈 | B3 决策工作流通过；既有决策工作流 46/46、宿主工作流 20/20 |

当前未提交的 B4 文件：

    packages/pi-agent-server/src/index.ts
    packages/pi-agent-server/src/large-result-filter.ts
    packages/server-core/src/decisions/large-result-filter.ts
    packages/server-core/src/decisions/relevance.ts
    packages/server-core/src/sessions/SessionManager.ts
    packages/shared/src/agent/backend/pi/protocol.ts
    packages/shared/src/agent/pi-agent.ts
    packages/shared/src/mcp/api-source-pool-client.ts
    packages/shared/src/mcp/client.ts
    packages/shared/src/mcp/mcp-pool.ts
    packages/shared/src/sources/api-tools.ts
    packages/shared/src/utils/large-response.ts
    scripts/verification/upstream-0141-large-results-workflow.ts

以下 3 个文件是用户在原工作区已有的 WIP，交接时应保留但不要混入 B4 提交：

    scripts/verification/files-panel-packaged-workflow.ts
    scripts/verification/packaged-client-verification.mjs
    scripts/verification/ui-refinement-workflow.mjs

## 目标和边界

- 四个直接 Pi 依赖和 lockfile 已固定到 1.1.0；传递家族也已解析到 1.1.0。
- 目标 Craft 上游是 v0.14.1，对象 SHA 332533f3096d12500012fe089c3f155e32af1c44；只吸收适用于 Phaneris 的功能，不整版 merge。
- 产品版本仍为 0.3.0，本轮不改版本号、不发布、不推送。
- Pi 继续是唯一 agent 后端；Runtime Host / Durable Runtime 继续掌握权限、输入、T1/T2 和账本。
- largeResults、adaptiveThinking 等已有开关保持原有默认值，不因升级自动打开。
- 真实 provider、真实 OAuth 账户、Linux/macOS 最终包质量和模型判断质量都没有被本地回环夹具证明。

计划正文仍写着“状态：Proposed”，那是旧文档状态，不代表当前实现状态。完成 B5 时应更新它，并新增最终实施记录：

- docs/process/pi-sdk-1.1.0-upstream-0.14.1-plan.md
- docs/process/pi-110-implementation-failure-matrix.md
- 建议新增 docs/process/pi-sdk-1.1.0-upstream-0.14.1-implementation.md

## B4 当前实现要点

这批代码的契约是：原文先完整保存到 long_responses，过滤只改变发给模型的视图；没有意图、缺答案、批次失败、取消、超预算或几乎全部相关时回到已有摘要/预览路径。

1. relevance.ts 从 Craft 0.14.1 移植分批相关性评分，并增加整次操作的调用数上限、AbortSignal 和无效/缺失答案回退。
2. large-result-filter.ts 按 JSON 数组、标题、段落和长行分块；保留原顺序、缺口提示、文件引用，并把预算计算到完整包装文本，而不只是正文片段。
3. large-response.ts 新增 filter hook，原文保存发生在 filter 之前；filter 不覆盖 structuredContent，不重放工具。
4. large-result-filter.ts（Pi agent server）增加 JSONL 请求、回复、取消、超时、迟到回复隔离和发送失败兜底。
5. Pi 协议新增 large_result_filter_request/response/cancel；host 侧通过稳定 toolCallId 关联 intent，同时保留 Durable 身份。
6. API in-process MCP 只在工具 schema 明确声明 _intent 时补回意图；外部 MCP 参数不注入该字段。
7. signal 从 Pi 工具执行传到 MCP/API/HTTP；停止或子进程退出会取消待处理请求。
8. 文件后续反馈只记录 file_access_attempted / no_file_access_observed，不把访问尝试说成成功读取，也不把未访问说成过滤错误。

## B4 当前验证

可重复运行：

    bun run scripts/verification/upstream-0141-large-results-workflow.ts .cache/pi-110-implementation/large-results-b4-rerun.json

最新报告：.cache/pi-110-implementation/large-results-b4.json，结果为 **7/8**，原文 SHA-256 为 0d763a083072b4a940b2930286f7edc80ccc096c113935d23d25bd00fa70a75a，决策请求数为 29。通过项包括：

- 末尾证据被保留，原文文件字节级一致；
- 缺答案、失败、无相关片段、几乎全相关时均回退；
- 中文长行、标题、缺口和完整包装受预算约束；
- 总 deadline、取消和“取消后不启动摘要”；
- JSONL 丢回复、发送失败、取消和迟到回复隔离；
- API schema 意图注入边界、Durable metadata 和取消；
- 路径访问反馈不泄漏原文。

失败项原文：

    actual Pi host/child to MCP and API preserves intent, raw structured data and one T1/T2 per execution
    AssertionError [ERR_ASSERTION]: false == true

下一步先在该工作流失败项中输出 wire、models、effects、hostReplies 和每次 target 的值，定位是哪一层没有满足断言；不要为了让报告变绿而删除断言。重点检查：

- Pi 子进程是否真的发出了 MCP/API proxy tool call；
- toolCallId 是否和 pre_tool_use metadata 对上；
- hostReplies 是否保留 structuredContent；
- 每次执行是否各有一个 Durable T1 和 T2；
- API 工具的 _intent 是否只在声明过的 schema 中出现；
- disposeForRestart() 后旧子进程是否仍有迟到消息。

完成修复后，重新运行该工作流并把报告复制到 docs/verification/results/pi-110-upstream-0141-large-results-b4.json。只有 8/8 通过后才提交 B4。

## 已有验证产物

重要报告路径：

    docs/verification/results/pi-110-startup-baseline.json
    docs/verification/results/pi-110-startup-b0.json
    docs/verification/results/pi-110-startup-b1.json
    docs/verification/results/pi-110-compatibility.json
    docs/verification/results/pi-110-azure.json
    docs/verification/results/pi-110-native-capabilities-b1.json
    docs/verification/results/upstream-0141-decisions-b2.json
    docs/verification/results/upstream-0141-decisions-b3.json
    docs/verification/results/pi-110-upstream-0140-host.json
    docs/verification/results/pi-110-upstream-0140-workflows.json

可复跑的关键 E2E：

    bun run scripts/verification/pi-110-startup-workflow.ts
    bun run scripts/verification/pi-110-compatibility-workflow.ts
    bun run scripts/verification/pi-110-azure-workflow.ts
    bun run scripts/verification/capability-integration-workflows.ts
    bun run scripts/verification/decision-feature-workflow.ts
    bun run scripts/verification/upstream-0140-b4b5.ts
    bun run scripts/verification/upstream-0140-b4b5-workflows.ts --report=.cache/pi-110-implementation/upstream-0140-workflows-rerun.json
    bun run scripts/verification/upstream-0141-decisions-workflow.ts --b2 .cache/pi-110-implementation/decisions-b2-rerun.json
    bun run scripts/verification/upstream-0141-decisions-workflow.ts .cache/pi-110-implementation/decisions-b3-rerun.json

最近一次 B4 修改后，以下三个定向类型检查均通过：

    cd packages/shared; bun run tsc --noEmit
    cd ../server-core; bun run tsc --noEmit
    cd ../pi-agent-server; bun run typecheck

Pi 子进程 bundle 也已成功生成（约 13.94 MB）。但 B4 修改后仍需重新跑全量 bun run typecheck:all，不能把定向通过当作全仓通过。

## 接下来按这个顺序做

### 1. 收口 B4

- 调试并修复 7/8 的真实 Pi host/child 整合断言。
- 检查无意中替换掉旧 summary gate 的路径：无意图结果仍必须走原摘要/预览回退。
- 跑 git diff --check、三个定向类型检查、B4 工作流和既有 upstream-0140-b4b5 工作流。
- 复制独立 B4 报告到 docs/verification/results/。
- 只提交 B4 文件，不提交上述用户 WIP。

### 2. 全仓门禁和构建

    bun install --frozen-lockfile
    bun run validate:ci
    bun run validate:full
    bun run server:build:subprocess
    bun run electron:build
    bun run webui:build
    bun run viewer:build

validate:full 可能运行很久；保持每隔一段时间向用户汇报，不要用 --no-verify 绕过检查。

### 3. Windows 最终包和包外运行时

在 apps/electron 按仓库既有流程执行：

    bun run electron-builder --config electron-builder.yml --win --x64 --publish never

然后使用实际 release/win-unpacked 和 installer 运行：

    bun run scripts/verification/packaged-client-smoke.mjs
    bun run scripts/verification/packaged-client-verification.mjs --unpacked-only
    bun run scripts/verification/files-panel-packaged-workflow.ts
    bun run scripts/verification/packaged-refinement-workflow.ts

必须额外把随包 Bun 和 Pi server 复制到仓库外的临时目录，使用 PHANERIS_VERIFY_PI_ENTRY、PHANERIS_VERIFY_PI_BUN 跑启动、能力和 Azure 工作流；仓库内运行成功不能代替包外验证。

### 4. UI、性能和文档

- 按已使用的 impeccable 约束做一次最终 AI 设置页截图检查：加载中、无数据、未知费用、日志保留范围、窄宽度、长标题 tooltip。已使用的技能文件是 C:\Users\dotty\.agents\skills\impeccable\SKILL.md；UI 变更后按技能要求运行一次 detector，不做无限抛光循环。
- 测当前 0.3.0 同口径首屏/启动基线，再测最终包；不要把历史“3,000 ms 目标”写成已修复。
- 记录 Pi server bundle、worker/WASM、Windows 包和报告的 SHA-256。
- 更新计划状态、实施记录和 apps/electron/resources/release-notes/next.md；不要创建猜测版本号的 release-notes/{version}.md。
- 最终文档明确：真实 provider/OAuth、Linux/macOS、模型质量和 Windows ACL 哪些没有验证。

## Git 和远端注意事项

- origin 是唯一推送目标；upstream 只读。
- GitHub 操作使用 SSH 443；文档链接使用 HTTPS。
- 不要执行 git fetch --tags。上游标签必须位于 refs/upstream-tags/*，不能污染 refs/tags/*。
- 提交前确认：

    git status --short
    git diff --stat
    git diff --check
    git diff -- scripts/verification/files-panel-packaged-workflow.ts scripts/verification/packaged-client-verification.mjs scripts/verification/ui-refinement-workflow.mjs

- 这些用户 WIP 脚本应继续保持 unstaged；若确实需要修改，先在最终报告中说明原因。
- 不要在原 E:\Phaneris 工作区执行会覆盖文件的操作；当前隔离工作树已包含本轮提交。

## 完成判据

只有同时满足以下条件，才能告诉用户“实施完成”：B0–B4 的独立 E2E 全部通过；validate:ci 和必要的 validate:full 通过；Pi/Electron/WebUI/Viewer 构建通过；Windows 包和包外运行时通过；最终报告、截图、性能测量和 SHA-256 已保存；未验证范围已明确；未误提交用户 WIP；没有把本地回环结果写成真实 provider 或模型质量结论。

