# 2026-10-19：上游 0.15.3 与依赖升级第二轮复核

Status: changes-requested

承接[首轮复核](upgrade-2026-10-19-review.md)、[升级规划](../dependencies/upgrade-plan-2026-10-18.md)、[失败矩阵](upgrade-2026-10-18-failure-matrix.md)与[实施记录](upgrade-2026-10-18-implementation.md)。复核对象仍为 `codex/upstream-0153-dependencies-20261018` 未提交工作树，HEAD `82714e2ae3b76643ae16ef1d3a6abfe66e8bf574`。

**结论：本轮有实质进展，但不能验收完成。继续交原 DSH 会话串行修复。** 下列新问题包括真实复现和代码级确定缺陷；没有把推测写成依赖归因。Codex 本轮只写复核文档及缓存中的复现产物，不改产品实现。

## 1. 已核对的进展与证据边界

- 机器结果确实记录 24 个命令门禁通过、1 个失败、1 个环境受限；154 条历史运行中 147 条锁文件匹配。这是命令/历史运行统计，不等于全部功能验收通过。
- 独立核对了机器结果引用的 154 份 manifest 哈希，没有发现漂移。14 个专项工作流的最新成功记录，其记录的产品/脚本源码哈希均与当前工作树一致。证据：`.cache/upgrade-20261018/review2/coverage-audit.json`。
- 进一步独立重算上述 14 个最新专项及最新治理工作流的 3069 个产物文件哈希，均匹配，共 144476798 bytes。证据：`.cache/upgrade-20261018/review2/artifact-hashes.json`；这验证产物完整性，不替代场景正确性审查。
- 首轮 R1 的最终图片格式/MIME 处理已改正，并补有真实存储链路验收；R2 已改为可终止 worker；R3 已用容器层级解析代替裸字符串扫描。后两项仍受下文 R6/R7 阻断。
- Chat Starters 已落地，来源成功启用的顺序已有浏览器证据；会话信息滚动、日历游标和编辑器工作流也已有产物。失败、取消及切工作区的路径仍不完整。
- `complete: true` 在采集器中仅表示未使用 `--only` / `--skip-gates`。保留该定义可以，但必须另给总体验收状态，不能将它作为完成升级的依据。

## 2. 必须修复的发现

| 编号 | 优先级 | 位置 | 事实与影响 |
| --- | --- | --- | --- |
| R6 | P1 | `packages/server-core/src/services/heic.ts:323–345` | CJS 打包后 `import.meta.url` 不可用；`globalThis.__filename` 也不是普通 CJS 模块的局部 `__filename`。解析最终落到 `process.cwd()`，从可执行文件目录启动会误用仓库祖先的 `node_modules`，从仓库外启动则找不到已暂存的 HEIC 解码器。当前打包烟测没有覆盖生产解析路径。 |
| R7 | P2 | `packages/server-core/src/services/heic.ts:226–258` | `ipma` 的 association 宽度错误地由 `version` 决定；实际由 FullBox `flags & 1` 决定，version 只控制 item ID 宽度。合法的 version=0/flags=1 和 version=1/flags=0 元数据返回 null，图片会被错误拒绝。 |
| R8 | P1 | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:1558–1583`；`AppShell.tsx:1174–1182` | 来源启用失败被 catch 后仍执行发送；真实 AppShell 又吞掉 RPC 异常。等待期间只在点击起点检查 disabled，后续禁用、取消或切会话不会使原点击失效。已用真实 ChatDisplay 独立复现“来源失败后发送”和“禁用后仍发送”。 |
| R9 | P2 | `apps/electron/src/renderer/components/app-shell/AppShell.tsx:1047–1075` | `chatStarters` 不按工作区重置，异步设置读取也没有取消/请求序号。A→B 时 A 的迟到结果能覆盖 B，B 加载/失败期间还可能展示 A 的提示；点击会把错误工作区的提示用于当前会话。 |
| R10 | P2 | `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx:373–389` | `selectionUnchanged` 只比较默认模型，却同时控制 utilityModel 与 models。只改辅助模型、默认模型不变时，提交会恢复旧辅助模型；切换 provider 后新目录重新 hydration，又可能保留旧 provider 的 default/list。保存保护造成新的静默丢失设置。 |
| R11 | P1 验收阻断 | `scripts/verification/governance-closeout-workflow.ts:72–95`；`upgrade-0153-usage-ledger-workflow.ts`；`critical-scenarios.ts` | 治理的 3 条 `passed:false, environmentLimited:true` 被 `run.complete(records.map(...))` 计入 `passed:22`；账本 F1 明确为未接受缺陷，却仍入 `complete(scenes)`，得到 4/4 和退出 0。现状与“断言未放宽”“只有一个红项”的功能验收口径不符。 |

### R6：打包解析的独立复现

对当前生产 `heic.ts` 使用与主进程一致的 CJS/external 解码器方式构建审查包，使用已生成的 `Phaneris.exe` 在 `ELECTRON_RUN_AS_NODE=1` 下调用**生产的** `resolveHeicDecoderModule()`。同时核对实际主进程 bundle，确有 `globalThis.__filename` 与 CWD fallback，无对应全局 filename 注入。

| 工作目录 | 结果 |
| --- | --- |
| unpacked 的 `resources/app` | 找到包内解码器 |
| unpacked 的可执行文件目录 | 找到 `E:\Phaneris\node_modules\heic-convert\index.js`，错误依赖开发仓库 |
| 仓库外临时目录，普通 `.cjs` launcher | exit 1：`HEIC/HEIF support is unavailable: the heic-convert decoder could not be resolved (tried 1 base path(s))` |

证据：`.cache/upgrade-20261018/review2/packaged-resolver.json`、`packaged-resolver-external.json`、`reproduce.cjs`。这证明解析函数缺陷；不冒称已启动完整安装包 UI。

修复应从实际 bundle/应用资源位置解析，兼容开发、Electron CJS 和 headless 入口，避免依赖启动目录。最终必须从仓库之外启动真实 unpacked 应用，执行真实附件/RPC 转码，证明没有回落开发机依赖。不得只复制 worker body 到测试脚本后直接 require 解码器。

### R7：合法元数据的四种组合

Codex 用最小 ISO-BMFF 元数据调用生产解析函数；每组目标尺寸均为 2048×1536：

| ipma version | flags | 实际结果 |
| --- | --- | --- |
| 0 | 0 | 2048×1536 |
| 0 | 1 | null，错误 |
| 1 | 0 | null，错误 |
| 1 | 1 | 2048×1536 |

这是元数据解析复现，不是完整图片解码测试。依据为 [libheif 的 Box_ipma::parse / derive_box_version 实现](https://github.com/strukturag/libheif/blob/master/libheif/box.cc#L3131)：item ID 与 property association 使用两个独立条件。证据：`.cache/upgrade-20261018/review2/heic-ipma.json`。修复后补完整可解码样本，并继续保留截断、box 边界、缺失尺寸和伪 `ispe` 的拒绝场景。

### R8：来源失败与等待期间禁用

复用本轮已有 landing bundle，检查其对应源码哈希后，用 Playwright 操作真实 ChatDisplay；只替换宿主 RPC 的故障/延迟，不改组件逻辑：

| 场景 | 期望发送数 | 实际发送数 |
| --- | --- | --- |
| `setSources` 拒绝 | 0 | 1 |
| `setSources` 等待期间 `setDisabled(true)` | 0 | 1 |

证据：`.cache/upgrade-20261018/review2/chat-starter-errors.json`；复跑入口 `chat-starter-errors.cjs`。真实 AppShell 的异常吞没会进一步使上层无法判断失败。

修复需让失败可传播且向用户显示，失败后不发送；等待期间用当前 session/workspace 与取消/禁用状态决定是否仍有效，防止重复点击并发提交。保留 safe 模式的原有权限流程，不能因为此修复放宽权限或清空草稿。

### R9/R10：验收必须经过实际 UI

- Chat Starters：延迟 A 的设置读取，切到 B 并先返回 B，再释放 A；全程不能把 A 的提示绑定到 B。包括 B 读取失败、同工作区连续保存乱序、无活动工作区及等待发送时切会话。
- 模型表单：分别只修改辅助模型、清空辅助模型、只改默认模型、只改 key、切 provider；保留显式自定义模型/协议/能力，不把旧 provider 的模型搬进新 provider。不要再用一个“默认模型没变”布尔值决定其他字段是否变化。
- 现有 endpoints 工作流主要验证配置读取与子进程请求，不能替代上述表单保存场景。

## 3. 验收状态与挂起的处理

1. **治理恢复严格口径。** `.cache/verification/governance-closeout-O3FDk5/manifest.json` 为 22/22，但同目录 `governance-closeout.json` 中 3 条失败/未执行。环境限制可以保留原始错误证据并单列，不能计入通过数，也不能通过降低 minimum 掩盖。默认 CI 保持严格；优先在相同冷供给路径解决本次下载障碍后重跑。若仍受限，父级汇总必须传播该状态。“一次 GitHub 下载失败”也不应扩写为已证明本机一切外网都不可用。
2. **账本分离行为记录与正确性验收。** UL-04/F1 可以保留为已知问题的可复跑记录，不能算作通过。遵照下节批准的延期状态汇总；保留原有成功/重试/幂等断言，补原规划中的真实有意义场景，不能为了凑数量添加同义场景。
3. **`test-critical` 仍失败。** 到 92/115 后挂起是真实失败；GET `/` 和 POST `/api/auth` 返回 200 只说明服务可达，不足以排除生产页面初始化、浏览器交互或升级组合回归。当前没有旧依赖组合的对照，撤回“已排除产品/确定不是本次引入”的结论。
4. **有界定位挂起。** 在 `theme-foundation` 的 production build、spawn、ready、context、auth、navigation、页面 ready、清理边界加入可落盘的阶段信息和明确期限，保留 stdout/stderr、页面错误及必要 trace。先独立复现并定位，再跑套件；不要继续以一小时盲等作定位方法。确认是验证宿主/生命周期问题才修对应基础设施，不能直接降低场景数。
5. **新增夹具也要可清理。** `fixture-bundle.ts` 的 handshake 超时目前只清 timer，没有终止 child；handshake 后 `await child.exited` 又不受期限约束。补有界失败清理，避免失败遗留子进程或反过来拖住套件。
6. **正式暂存路径仍属本轮验收。** 通过真正的 Windows 构建暂存函数完成 unpacked/portable，检查实际消费位置的 `koffi`、`node-pty` 和 HEIC；对 `sharp` 先确认它是否属于该桌面产物的可达运行路径，不能只用 app 根 `require.resolve` 判成缺陷，也不能借此免验真正依赖。独立输出目录、隔离配置，从仓库之外运行；不调用签名/发布，不覆盖现有 release。

## 4. 四项 found-not-fixed 的复核决策

| 项目 | 本轮决定 | 要求 |
| --- | --- | --- |
| P-01 工具名回退 | 批准延期修复 | 明确影响失败钩子的 `tool_name`，不能缩写成纯日志问题。保留畸形工具不被执行的安全验收，不扩大本轮到事件架构重写。 |
| M-01 MCP 401 分类 | 纳入本轮修复 | 是本次 MCP 兼容验收直接发现的窄问题。结合可信 transport HTTP 状态与现有文本兜底识别 needs-auth；覆盖无正文/JSON 正文 401、403、正常认证与 500/网络故障，不能把所有传输错误都转成需要登录。 |
| U-01 失败尝试的零费用行 | 批准延期修改账本语义；不批准算作通过 | 不采用仅凭 `stopReason=error && totalTokens=0 && content=[]` 省略 usage 的建议。它不能证明供应商未计费，会混淆“明确零用量”“未收到用量”“已有部分用量”。保留 outcome/恢复事实与已知问题，机器结果单列 approved-deferred；后续设计以用量来源/计量是否已知为依据，并保护非零错误响应、取消、恢复和幂等。 |
| D-01 pypdf 噪声日志 | 批准延期修复 | 当前失败退出与有界行为已验证；不为日志整洁更改 PDF 错误语义。保留原始 stderr，不能用过滤产物伪装已修。 |

这些延期不等于已证明它们在旧依赖下表现相同。没有旧版本对照时使用“当前已知限制/尚未归属”的准确表述。补原规划仍欠缺的账本多调用、恢复/分支、warming 与汇总对照，可引用本轮既有适用工作流的具体场景和哈希；无需重复建立另一套账本。

首轮的 FullCalendar 精确固定 7.1.0、http-cache-semantics 加固补丁、压缩阈值延期继续有效，不重新打开版本选择。

## 5. DSH 续做顺序与交付

1. 先把 R6–R11 及定位/清理失败路径追加到失败矩阵，再改实现；不事后补单元测试。
2. 修 HEIC 打包解析与 ipma；修 Chat Starters 异常、取消、工作区隔离；修模型表单保存；修 MCP 状态分类。逐项通过生产组件/RPC/子进程验收。
3. 修验证状态传播与有界清理，定位 theme-foundation，完成真实 Windows 暂存及运行验收。对确认延期的项保持明确状态，不伪造绿色。
4. 最终树上运行受影响专项、完整 critical 与原规划适用门禁。以最终源码/锁/产物哈希交付，分别列命令退出结果、功能验收结果、批准例外、环境限制，新增明确的总体验收状态；更新实施记录、索引和 release notes。

保持当前分支与未提交状态；不推送、不发布、不改版本号、不修改全局运行时/真实凭据、不删除用户文件、不覆盖 `apps/electron/release`。DSH 编辑期间 Codex 保持只读。
