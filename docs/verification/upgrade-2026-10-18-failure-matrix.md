# 上游 0.15.3 与依赖升级失败矩阵（2026-10-18）

执行者：DSH。规划者：Codex。分支：`codex/upstream-0153-dependencies-20261018`。

- 本文在**任何实现之前**写成，用途有两个：先把每块范围「怎么算失败」定死，再让后续实现与验收只对照本文，而不是事后迁就实现编判定。
- 本文只登记失败路径、触发入口、观测点和判定方式；实现结果、退出码与哈希写在 [upgrade-2026-10-18-implementation.md](upgrade-2026-10-18-implementation.md)，机器结果写在 [results/upgrade-2026-10-18.json](results/upgrade-2026-10-18.json)。
- 遵循 `AGENTS.md`：先写失败方式，再写代码；复杂行为以真实流程/E2E 与可重复产物验收，**实现后不新增单元测试**。已有单测照常运行。
- 不修改 warning / security / bundle 等既有基线来制造通过；本次引入的回归必须修，不能靠放宽门禁掩盖。

## 1. 冻结输入与基线

| 项目 | 值 | 来源 |
| --- | --- | --- |
| 基线提交 | `82714e2ae3b76643ae16ef1d3a6abfe66e8bf574` | `git rev-parse HEAD`，与 targets.json `baseCommit` 一致 |
| 计划文档 | `docs/dependencies/upgrade-plan-2026-10-18.md` | Codex 规划，本文的直接上游 |
| 目标清单 | `docs/dependencies/upgrade-2026-10-18/targets.json` | 37 个现有 npm 控制项 + 2 个新增 npm + 2 个 Python 升级 + 1 个新增 Python |
| 逐包判断 | `catalog.csv`（1469 行，37 条 `execute`）、`python.csv`（12 个直接包，2 条 `execute`） | 版本快照 |
| 官方元数据 | `selected-metadata.json` | 批准版本的 registry 元数据、依赖约束、tarball integrity |
| 原始查询 | `.cache/upgrade-20261018/`（npm-metadata.json、pypi-metadata.json、runtime-metadata.json、inventory-before.json、collect/assemble 脚本） | 不重跑覆盖，只读使用 |

### 1.1 B0 实测基线（2026-10-18，Asia/Shanghai）

| 项目 | 实测值 |
| --- | --- |
| 分支 | `codex/upstream-0153-dependencies-20261018`（自 `82714e2a` 创建） |
| 工作区起点 | 仅 Codex 的规划文件未提交：`docs/README.md`（改）、`docs/dependencies/upgrade-2026-10-18/`（新增）、`docs/dependencies/upgrade-plan-2026-10-18.md`（新增）；全部保留 |
| 本机 Bun / Node | 1.4.2 / v24.15.0（全局，不替换） |
| 本机 Git | 2.54.0.windows.1 |
| 本机 Python | 3.14（系统级，仅供脚本；产品工具链固定 3.12.15） |
| `bun audit` 基线 | 5 条：1 critical（node-tesseract-ocr，已有 patch）、1 high（http-cache-semantics，本地 patch）、2 moderate（postcss-selector-parser 父约束、sprintf-js 无修复版本）、1 low（KaTeX 旧副本）。重新抓取结果与冻结的 `npm-audit-before.txt` 逐行一致 |
| 目标满足度 | 39 个 npm 目标项全部未满足（0/39），快照见 `.cache/upgrade-20261018/baseline/before.json` |
| 锁文件 | `bun.lock`，SHA-256 记入基线快照 |

### 1.2 执行环境事实（影响验收真实性）

本会话在 DSH `workspace-write` 下启动时，子进程运行于低完整性级别，而仓库已有子目录没有可写完整性标签，导致 `git`、`bun` 等子进程对 `.git`、`docs`、`apps` 等的写入被 Windows 直接拒绝（实测 `New-Item`、`git update-ref` 均 `Permission denied`）。已由用户将本会话切换为完全权限（`danger-full-access`）解决，切换后实测 `docs`/`.cache`/`git ref` 写入均通过。

记录该事实的原因：**B0 的失败矩阵与基线是在受限状态下做只读诊断，所有写入与构建都在完全权限下进行**；若后续复核在受限沙箱内复跑，需预期同类写入拒绝，那不是本次改动引入的回归。

## 2. 通用判定规则

| 规则 | 含义 |
| --- | --- |
| 版本判定 | 以「实际解析版本」为准（`node_modules/<pkg>/package.json`、`bun.lock` 解析结果），不以 manifest 里的范围字符串为准 |
| 门禁判定 | 现有门禁（typecheck / lint / i18n / identity / version / runtime / electron-pin / governance / distribution / audit）在本次改动后必须仍然通过；**不允许通过修改 allowlist、baseline、threshold 来通过** |
| 回归判定 | 若某门禁在基线即失败，必须先用同一环境与原始提交证明它是既有失败，再单列；只修本次引入的失败 |
| 真实请求判定 | 涉及请求形状、预算、协议的行为，必须由真实子进程/回环服务产出的实际序列化 payload 或实际请求日志证明；不得以「类型检查通过」代替 |
| 未验收判定 | 真实供应商付费调用、macOS/Linux 本机、新容器、代码签名与安装器一律记为「未验证」，不得写成通过 |
| 产物判定 | 每轮验证写 `.cache/verification/<run-id>/`，`manifest.json` 记录命令、退出码、源码/锁文件 SHA、运行时版本、场景 ID、未测范围；哈希可由 `verification-artifacts.ts --verify=<dir>` 复验 |

## 3. 失败矩阵

每条 = 一个必须覆盖的失败路径 + 正向对照。全部要求在实现前确定，实现后按此复核。

### 3.1 安全与 PDF（B1）

| 编号 | 失败路径（必须不成立） | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| SEC-01 | `private` 响应被共享缓存命中，跨用户泄露 | `scripts/verification/verify-dependency-upgrade-security.cjs` 的 11 个场景 × `max-stale=999999` / `max-stale` 两种指令 | 回环 proxy 返回的 `x-cache` 与 body 归属 | 11 场景 × 2 指令全部 `passed`；`private`/`no-store`/`no-cache`/`Set-Cookie`/`Authorization`/`proxy-revalidate`/`vary:*`/`must-revalidate` 不得命中 |
| SEC-02 | 公开可缓存响应被误判为不可缓存（过度修复） | 同上，`public-fresh-control`、`public-stale-control` | 同上 | 两个 public 场景必须仍为 `hit`，证明不是「一律不缓存」的假通过 |
| SEC-03 | 升级到 4.3.0 后旧 patch 仍被套用，导致重复修补/构建失败 | `package.json` `patchedDependencies`、`bun install` | 安装退出码、`node_modules/http-cache-semantics/index.js` 内容 | 正式修复生效后移除 `http-cache-semantics@4.2.0` 注册；`patches/http-cache-semantics@4.2.0.patch` 文件**保留为历史**，不删除 |
| SEC-04 | OCR 参数被 shell 解释执行（命令注入） | `verify-dependency-upgrade-security.cjs` 的 `ocr-execFile-literal-arguments` | 子进程 argv 实际内容 | 含 `&& echo SECURITY_SENTINEL` 的 lang/psm 必须以**单个字面量参数**出现，不得产生注入效果；`node-tesseract-ocr@2.2.1` patch 保留 |
| SEC-05 | `bun audit` 出现新的 high/critical | `bun run audit:dependencies`、`bun audit --registry https://registry.npmjs.org` | `scripts/dependency-audit-baseline.json` 对比 | 高危项只减不增；`http-cache-semantics` 的 GHSA-ch52-4w7c-c8xp 应从结果中消失；仍显示的 KaTeX 旧副本、postcss-selector-parser 父约束、sprintf-js 保持如实显示，不隐藏 |
| PDF-01 | 正常 PDF 处理失败或输出损坏 | `apps/electron/resources/scripts/pdf_tool.py`（uv run，固定 3.12.15） | 实际启动、代表任务输出、产物字节 | 正常 PDF 的 info/extract/merge 成功，输出可再次解析 |
| PDF-02 | 加密/表单/损坏/循环树 PDF 让工具崩溃、挂死或无限循环 | 同上，加密样本、损坏样本、循环引用样本 | 退出码、耗时上限、错误消息 | 有界失败：非零退出码 + 可读错误；不得挂死；不得静默产出空文件当作成功 |
| PDF-03 | 渲染路径不释放资源，句柄泄漏 | `pypdfium2` 渲染（`to-image`） | 重复渲染后的句柄/进程存活、bitmap 释放 | 连续多次渲染后进程正常退出，无资源耗尽 |
| PDF-04 | 升级声明与实际运行版本不一致 | 8 个 PEP 723 脚本的 `dependencies`、`scripts/check-python-runtime-pin.ts` | uv 解析出的实际版本 | `pypdf==6.21.1`、`pypdfium2==5.14.0` 写入所有受影响脚本；实际运行环境自报版本一致 |

### 3.2 Pi / MCP（B1）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| PI-01 | 四个 Pi 直接包版本不一致或内部精确包被覆盖 | 5 个 manifest 的 `@earendil-works/*`；`bun.lock` 解析 | `node_modules/@earendil-works/*/package.json` 实际版本、lock 中 Pi 内部依赖 | 四包同为 1.3.0；**不覆盖** Pi 自己精确固定的内部包（如 openai / undici 副本），不做跨父约束去重 |
| PI-02 | 恢复会话后工具丢失 | `scripts/verification/pi-120-upgrade-workflow.ts`、`upstream-015-*-workflow.ts` | 真实 Pi 子进程会话中的工具清单 | resume 后工具集与首次一致 |
| PI-03 | 切换模型泄漏上一模型的思考内容 | 同上，切换模型的会话流程 | 会话事件里的 thinking/reasoning 归属 | 切模型后不携带上一模型的思考内容 |
| PI-04 | 畸形 tool JSON 被执行 | 回环 provider 注入畸形工具参数 | 工具是否实际执行 | 畸形参数被拒绝，不执行副作用 |
| PI-05 | 取消/超时留下孤儿 worker | 取消正在进行的调用 | 取消后的进程清单 | 无孤儿子进程残留，有进程级证据 |
| PI-06 | 重试、报错、压缩后会话不可恢复 | 失败重试与恢复流程 | 会话恢复后的继续能力 | 重试/错误/压缩后仍能继续，不丢会话 |
| PI-07 | MCP stdio/HTTP/OAuth 取消、来源禁用、prompts/resources 回归 | `@modelcontextprotocol/sdk` 1.32.1 相关流程 | MCP 连接日志、取消行为、资源与提示列表 | stdio 与 HTTP 均可用；取消可生效；来源禁用后不调用；prompts/resources 可枚举并读取 |
| PI-08 | 真实供应商账户被冒充验收 | — | 记录 | 只做回环/录制验证；文档明确「未验真实供应商账户」 |

### 3.3 端点与协议（B1）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| EP-01 | Kimi 原生 provider 的协议与 `/v1` 不一致 | 预设与 provider 适配代码；脱敏回环请求 | 实际 base URL 与请求形状 | 原生 Kimi Coding provider 走 Chat Completions 且 base URL 含 `/v1`；不改用户自定义连接 |
| EP-02 | 用户明确配置的 Anthropic 兼容连接被自动改成别的协议 | 自定义连接的 provider/URL/模型字段 | 运行时解析出的协议与地址 | 严格匹配「原生 provider + 已知默认值」才规范化；用户自定义域名、代理路径、模型 ID、请求头一律保持 |
| EP-03 | 新预设与旧默认不兼容，或新增重复预设 | 预设目录与 OpenCode / OpenCode Go 条目 | 预设数量与选择结果 | **不新增重复的 OpenCode Go 预设**；旧默认值按严格匹配做运行时兼容；模型 ID 仍可编辑 |
| EP-04 | Anthropic 工具请求 schema 不符合要求 | Anthropic Messages 路径的工具序列化 | 实际序列化 payload | `additionalProperties: false` 语义按上游修复处理：注入的 `_intent` / `_displayName` 必须先在 `properties` 中声明；只改 Anthropic Messages 路径，OpenAI 等协议各自语义保持不变 |
| EP-05 | 使用真实付费 API 或真实凭据验证 | — | 记录 | 全部使用脱敏回环；不出现真实 token/key |

### 3.4 账本与输出上限（B1 验证，不改架构）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| LG-01 | 一轮多工具调用漏记或双记 | 现有 durable usage ledger 流程 | 请求级 ledger 明细与 UI 汇总 | 明细与汇总一致；不引入上游累计费用实现（避免重复计费） |
| LG-02 | 失败调用/重试被重复计费 | 失败后重试的会话 | 同上 | 失败与重试不产生额外记账 |
| LG-03 | 恢复或分支后父会话被重复计算 | 分支会话流程 | 分支与父的归属 | 不复制父账本、不引入 runningTotals；分支归属正确 |
| LG-04 | cache warming 被计入用户账单 | 缓存预热流程 | ledger 中 warming 条目 | warming 独立，不混入用户用量 |
| LG-05 | 逐模型输出上限退化为 8192 或丢失配置 | 模型配置与压缩调用 | 实际请求中的 `max_tokens` | 默认 16384 不变；逐模型 `maxTokens`、价格、thinking map、inputLimits、promptCache 全部保留；非默认上限能到达实际请求 |
| LG-06 | 用账单 token 冒充上下文占用 | 上下文占用显示 | 上下文条读数 | 上下文占用来自模型上下文窗口计算，不拿账单 token 代替 |

### 3.5 压缩阈值（B4）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| CP-01 | 默认（未设置）时行为被改变 | 设置在 null 状态的会话 | 压缩触发点 | 与 SDK 原行为一致，提前触发默认关闭 |
| CP-02 | reserve 映射把摘要输出预算一起放大 | 自动压缩时的摘要请求 | 摘要请求的 `max_tokens` | **摘要预算保持原边界**（基于原 SDK reserve 与模型 maxTokens），提前触发与生成预算分离 |
| CP-03 | 非法/越界阈值被接受或伪装保存成功 | 设置 UI 与持久化 | 保存结果与错误提示 | 仅接受 100,000–1,000,000 整数；null 恢复默认；非法值明确报错且不写入 |
| CP-04 | 阈值超过模型有效窗口时越界触发 | 小上下文模型、100K/1M 边界 | 实际触发点 | 超过当前模型有效窗口时沿用该模型的安全触发点 |
| CP-05 | 模型切换或会话重启后阈值不重算 | 切换模型、重启会话 | 重新计算的触发点 | 新建/重启会话生效，模型切换重新计算 |
| CP-06 | 触发提前后出现重复压缩循环或破坏手动 compact/cancel | 连续压缩场景 | 压缩触发计数、手动压缩与取消 | 不循环；手动 compact 与 cancel 仍正确 |
| CP-07 | 无可信接入点时强行实现（改 node_modules、无界预算） | 实现审查 | 代码与产物 | 若确无可靠接入点：记录具体技术阻断、保留默认行为、继续独立项；**不得**修改 node_modules、不得无界预算、不得靠重复压缩凑功能 |

### 3.6 HEIC / HEIF（B4）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| HE-01 | AVIF（或其它 ISO-BMFF 容器）被误判为 HEIC 并转换 | 附件选择/拖拽/粘贴；fixture 含真实 AVIF | 是否进入转换分支、输出 MIME | 仅凭 `mif1` 等通用 brand **不得**判定；需结合 major brand / compatible brands + MIME + 格式验证；AVIF 明确排除、原样保留 |
| HE-02 | 损坏文件或超大像素文件阻塞主线程 | 损坏 HEIC、超大像素 HEIC | 主进程响应性、耗时上限 | 解码有资源边界，不长期阻塞主进程；失败可读 |
| HE-03 | 超过原有体积/图像限制的文件被放行 | 16 MiB 边界文件 | 拒绝行为 | 保持原有 16 MiB 传输与图像限制 |
| HE-04 | 转换失败后草稿丢失 | 失败转换 | 草稿内容 | 失败保留草稿并给出可读错误 |
| HE-05 | 转换后 MIME / bytes / 路径不一致 | 转换成功路径 | 服务端收到的 mime、base64、size、path | 四者一致；模型实际上传字节为 JPEG |
| HE-06 | 原始用户磁盘文件被改写 | 全流程 | 源文件哈希 | 源文件字节不变 |
| HE-07 | decoder 只在源码开发模式可用，打包后缺失 | Windows 打包产物 | 打包目录中 decoder 是否存在、打包应用能否转换 | decoder 真正进入 Electron 与 server 构建产物 |
| HE-08 | Python 图片工具无法读取 HEIC | `apps/electron/resources/scripts/img_tool.py` | 实际运行 | `pillow-heif==1.8.1` 精确固定并且实际可读 HEIC |

### 3.7 工作区 Chat Starters 与来源/技能 mentions（B4）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| CS-01 | 超过 3 条或空白/畸形输入被保存 | 工作区设置中的 starters 编辑 | 保存结果 | 上限 3 条；空白/畸形被拒绝且不写入 |
| CS-02 | 长文本无限制 | 超长输入 | 保存与显示 | 有明确长度限制，超限可读报错 |
| CS-03 | 非法 slug 被接受 | 编辑与保存 | 持久化结果 | 非法 slug 被拒绝 |
| CS-04 | 保存后不立即显示 | 保存动作 | UI 更新 | 保存立即更新 |
| CS-05 | 重启后丢失、切工作区串数据 | 重启、切换工作区 | 持久化存储 | 重启持久；不同工作区互不串 |
| CS-06 | 点击后来源/技能未正确启用或未等待就绪 | 点击 starter | 来源就绪事件与发送顺序 | 解析并启用正确来源与技能；等待来源就绪后再发送 |
| CS-07 | 权限与 safe 模式被绕过 | safe 模式、取消 | 权限判定与取消行为 | 沿用现有权限与来源就绪机制；safe 模式与取消仍正确 |
| CS-08 | 新控件缺中文或英文、缺国际化门禁 | `lint:i18n:parity` / `:sorted` / `:coverage` / `:dead-keys` | 门禁退出码 | 中英双语齐全，四项 i18n 门禁通过；不修改 allowlist |
| CS-09 | 视觉尺度/主题被改版 | `check:visual-contracts`、`check:scale-contract`、`check:themes`、`audit:scale` | 门禁退出码 | 沿用现有尺度与主题机制；新增控件使用既有样式，不做视觉改版 |

### 3.8 编辑与日历（B3）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| ED-01 | 中文 IME 输入/撤销重做异常 | 富文本编辑器真实流程 | 内容与撤销栈 | IME 输入正常，撤销重做正确 |
| ED-02 | 列表类型转换、`!`+链接、表格/数学/代码与 Markdown 往返丢内容 | Markdown 往返流程（`markdown-*-workflow.ts`） | 保存前后内容比较 | 往返后语义一致，无丢内容 |
| ED-03 | ProseMirror 各包混装导致运行时崩溃 | Tiptap 整族升级 | 构建与运行时 | 13 个直接控制包同为 3.32.0，ProseMirror 不混装 |
| ED-04 | 粘贴/上传图片回归 | 编辑器粘贴/上传 | 结果 | 与升级前一致 |
| CAL-01 | 时区、跨日全天事件错误 | 日历流程（`gantt-reschedule-workflow.ts`、planning 工作流） | 事件时间与渲染 | 时区与跨日全天正确 |
| CAL-02 | 拖拽或受控范围导致重复更新/循环渲染 | 拖拽与受控范围 | 渲染次数与最终状态 | 无重复更新循环；最终状态与用户操作一致 |
| CAL-03 | 动态切换语言后日历/编辑器文本不更新 | 动态切语言 | 界面文本 | 语言切换立即生效 |
| I18N-01 | i18next 维护线升级导致 locale、插值、富文本翻译回归 | 四项 i18n 门禁 + 动态切换 | 门禁退出码、界面文本 | 全部通过；不修改 allowlist |

### 3.9 桌面、运行时与构建（B2）

| 编号 | 失败路径 | 触发入口 | 观测点 | 判定 |
| --- | --- | --- | --- | --- |
| RT-01 | 用全局 Bun/Node 冒充新版本 | 本机全局运行时 | 全局 `bun --version` / `node --version` | **不替换** DSH/Codex 正在使用的全局程序；升级后的验证使用任务缓存中的 portable 副本，并以子进程 PATH 注入 |
| RT-02 | Electron 声明版本与打包实际版本不一致 | `package.json`、`apps/electron/package.json`、`packages/shared/package.json`、`electron-builder.yml` | `bun run electron-pin:check`、打包产物自报版本 | 四处同步 44.9.0；`electron-pin:check` 通过；打包后可执行文件自报 44.9.0 |
| RT-03 | Bun / uv / Node 版本在不同位置漂移 | `packageManager`、CI workflow、`Dockerfile.server`、`scripts/build/common.ts`、随包二进制 | `check:governance`、随包二进制自报版本 | 全部同步到 Bun 1.4.3 / uv 0.13.1；随包二进制版本戳与常量一致；**不启用 uv preview 功能** |
| RT-04 | 干净 frozen 安装在无缓存环境失败 | `bun install --frozen-lockfile` | 退出码 | 通过；锁文件与 manifest 一致 |
| RT-05 | 原生模块（node-pty / koffi / sharp / 图像路径）失效 | 打包与运行时 | 原生模块加载与功能 | 实际可用，不能只看安装成功 |
| RT-06 | 三个前端与 server/worker 构建回归 | `electron:build`、`webui:build`、`viewer:build`、`server:build`、`build:runtime` | 各命令退出码与产物 | 全部通过 |
| RT-07 | bundle 体积基线被改 | `bundle:report --check` | 报告与既有基线 | 通过；**不修改** bundle 基线阈值 |
| RT-08 | 打包/验证产物覆盖现有 release 产物 | `apps/electron/release` | 目录内容 | 打包输出放独立 `.cache` 目录，不覆盖现有 release 产物 |
| RT-09 | 桌面行为回归（窗口重开、深链接、缩放主题、隐藏输入/截图） | `windows-reopen-workflow.ts`、`theme-native-workflow.ts`、`shell-visual-workflow.ts` | 截图与日志 | Windows 本机实测；macOS/Linux 保持未验证 |
| RT-10 | Playwright/CDP 真实工作流失效 | `playwright` 1.64.1 + 浏览器二进制 | 工作流退出码 | 真实 Electron/CDP 工作流通过 |

### 3.10 批次与流程自身

| 编号 | 失败路径 | 判定 |
| --- | --- | --- |
| PR-01 | 执行全仓 `bun update` / `--latest` / `audit fix --latest`，产生目标外 churn | 锁文件对比：传递变化只能来自本次批准父包、必要同族对齐、已明确的安全修复；意外 churn 必须逐条解释 |
| PR-02 | 通过修改 peer 约束、禁用校验或增加全局 override 强行安装 | 禁止；发现即判失败 |
| PR-03 | 破坏暂缓项 | PDF.js 保持 6.3.289（react-pdf 精确依赖）、Pillow 保持 12.3.0、Sentry 主版本不动、文件预览器 1.0 不动、Radix/Motion 不动 |
| PR-04 | 为让门禁通过而更新 allowlist/baseline/threshold | 禁止；只修本次回归 |
| PR-05 | 删除文件、重置用户改动、改版本号、提交/推送 | 禁止；保留可审查 diff，交 Codex 复核 |
| PR-06 | 声称未验证项已通过（macOS/Linux、容器、真实供应商、签名安装器） | 必须在实现记录与机器结果中显式列为未验证 |

## 4. 最终门禁命令（计划 §6）

以下命令使用本轮选定运行时执行，退出码逐条记入机器结果：

```text
bun install --frozen-lockfile
bun run validate:ci
bun run audit:dependencies
bun run test:critical
bun run test:upstream-015
bun run build:runtime
bun run electron:build
bun run webui:build
bun run viewer:build
bun run server:build
bun run bundle:report --check
```

补充门禁与证据入口（实现前已确认存在）：

- 安全与缓存：`node scripts/verification/verify-dependency-upgrade-security.cjs`（产物 `security-e2e.json`）
- Pi：`scripts/verification/pi-120-upgrade-workflow.ts`、`upstream-015-core/orchestration/browser/renderer-workflow.ts`
- 持久运行：`scripts/verification/durable-runtime-{boundary,crash,pi}-workflow.ts`
- 设置与图像：`ai-settings-refinement-workflow.ts`、`ai-settings-structure-workflow.ts`、`image-capability-workflows.ts`
- 编辑与日历：`markdown-*-workflow.ts`、`planning-*-workflow.ts`、`gantt-reschedule-workflow.ts`
- 原生与主题：`native-client-workflow.ts`、`windows-reopen-workflow.ts`、`theme-native-workflow.ts`、`shell-visual-workflow.ts`
- 治理：`check:governance`、`check:distribution`、`audit:scale`、`check:scale-contract`、`check:visual-contracts`
- Python 工具：`apps/electron/resources/scripts/tests/*`（现有 smoke）与 8 个工具的真实启动

## 5. 未验证范围（实现前即声明）

| 范围 | 原因 |
| --- | --- |
| macOS / Linux 本机运行与打包 | 本机为 Windows x64，无对应主机 |
| 新容器镜像构建与系统包扫描 | 需要 Docker 环境与远端 CI；本机不作为证据 |
| 代码签名与真实安装器执行 | 用户长期约定禁止执行安装器 |
| 真实供应商付费请求 | 禁止使用真实凭据与付费 API；改用回环与脱敏录制 |
| GitHub 匿名 release API | 规划阶段已确认返回 403，沿用官方网页与源码交叉确认 |

## 6. 记录规则

1. 本矩阵在任何实现之前写成；实现过程中若发现新的失败路径，**追加**条目并标注发现时间，不删除已写条目、不修改既有判定。
2. 编码实现后不新增单元测试；复杂行为用真实流程/E2E 与可重复产物验收。
3. 每条结论必须绑定可复跑命令、退出码、实际解析版本与产物路径/哈希。
4. 已有失败先用同一环境与原始基线证明，再单列。

## 7. 实施期间追加的条目

以下条目在实施过程中发现并按第 6 节规则**追加**；上文已写内容与判定未作修改。

### 7.1 SEC-01a：公告 GHSA-ch52-4w7c-c8xp 本身未被原场景覆盖（发现于 2026-10-18 B1）

原 `vary-star` 场景使用精确的 `Vary: *`，4.2.0 也已拒绝该形式，因此**原流程并未覆盖公告本身**。对照 4.2.0 与 4.3.0 `index.js` 的实际差异，4.3.0 的唯一行为变化是 `_requestMatches` 把 `vary === '*'` 的整串相等判断改为逐字段判断，即修复 `Vary: *, other` 这类多字段写法下 `*` 被跳过的情形。

- **失败路径**：多字段 `Vary` 含 `*` 时条目被当作可复用，跨用户命中。
- **触发入口**：`scripts/verification/verify-dependency-upgrade-security.cjs`（新增 `vary-multi-star` 场景，**追加**而非替换，原 11 个场景不变）。
- **判定**：4.2.0 命中、4.3.0 不命中；公开正缓存场景仍命中。
- **产物**：`.cache/upgrade-20261018/evidence/http-cache-semantics-advisory-differential.json`、`.cache/upgrade-20261018/security/*/security-e2e.json`。

### 7.2 SEC-03a：官方 4.3.0 不含本地加固，patch 不能停用（发现于 2026-10-18 B1）

计划的前提是「正式修复通过后可移除旧 patch 注册」。实测：移除注册后，未打补丁的 4.2.0 在原有 23 项检查中失败 14 项；换到**正式 4.3.0**（未打补丁）后仍失败同样的 14 项——零寿命（`maxAge() === 0`）持久化条目被 `max-stale` / `stale-while-revalidate` 复活的路径在 4.3.0 中并未改动。

- **判定**：该失败路径仍然成立 → patch **保留**，并重新定位到 4.3.0（`patches/http-cache-semantics@4.3.0.patch`，与官方 Vary 修复叠加，不是替代）；`patches/http-cache-semantics@4.2.0.patch` 作为历史保留，不删除。
- **产物**：`security/pre-fix-420`（未打补丁 4.2.0，9/23）、`security/after-430`（未打补丁 4.3.0，9/23）、`security/after-430-patched`（4.3.0 + 加固，25/25）。

### 7.3 CP-08：Pi 1.3.0 没有区分「触发 reserve」与「摘要预算」的公开接入点（发现于 2026-10-18 B4）

计划要求「保留当前正常摘要预算上限，将提前触发与生成预算区分开」。对已安装的 SDK 1.3.0 逐点核实后确认该接入点不存在：

- 触发判定与摘要预算读取**同一个** `settings.reserveTokens`：`shouldCompact`（`dist/core/compaction/compaction.js`：`contextTokens > contextWindow - settings.reserveTokens`）与 `generateSummaryWithUsage`（同文件：`min(floor(0.8 * reserveTokens), model.maxTokens)`）、`generateTurnPrefixSummary`（`min(floor(0.5 * reserveTokens), ...)`）都由 `AgentSession` 经 `this.settingsManager.getCompactionSettings(model)` 取得。
- 因此唯一可用的包装点（覆盖 `getCompactionSettings`，即上游做法）会**同时**改动触发点与摘要预算，无法只移动触发点。
- `SettingsManager` 没有其他与摘要上限相关的设置项（`settings-defaults.js` 的 `compaction` 只有 `enabled` / `reserveTokens` / `keepRecentTokens`），也没有仅覆盖摘要预算的公开 API。
- 唯一可能的分离路径是扩展事件 `session_before_compact` 自行产出摘要：需要新建扩展并自行调用 SDK 摘要生成，属于新增架构，且计划明确禁止以「凑功能」方式实现。

- **判定**：按计划 §3.5 的兜底分支处理——**记录技术阻断、保留默认行为、继续独立项**。不交付会静默放大摘要预算的设置项，也不交付「能保存但无效果」的假设置。
- **量化后果**（供复核判断是否值得后续做扩展）：SDK 默认 reserve 16,384 → 摘要预算 13,107；若按上游公式在 1M 窗口模型上设 400K 窗口，reserve 变为 600,000 → 摘要预算升到 `model.maxTokens`（本工作流 fixture 为 64,000，约 4.9 倍）。数字见 B1 工作流产物 `pi-session.json:summarizationBudget`。

### 7.4 HE-01a：HEIC 识别必须排除 AVIF，且需要可验证的真实样本（发现于 2026-10-18 B4）

真实 AVIF 的 `ftyp` 兼容品牌里**同时**含 `avif` 与 `mif1`，因此「major/compatible brand 命中 `mif1` 即视为 HEIC」的写法会把 AVIF 转成 JPEG。已按失败路径先行的规则固定判定：品牌集合中只要出现 AVIF 品牌即判非 HEIC；通用 HEIF 品牌单独出现时不转换；并要求存在 HEIC 专属品牌。

- **产物**：`.cache/verification/upgrade-0153-heic-*/detection.json`（含 AVIF 品牌窗口的原始字节）、`transcode.json`、`python-tool.json`。

### 7.5 CS-10：Chat Starters 的服务端校验缺口（上游行为，实施前记录）

上游把「最多 3 条」实现为**展示期截断**：`SETTINGS_UPDATE` 的白名单里有 `chatStarters`，但既不校验数组形状也不限制条数，空白标签同样可写入。按计划 §3.7 的要求（超量、空白/畸形输入必须被拒绝且不写入），本项目实现时必须在服务端加校验，不能照搬展示期截断。该条在实施前记录，用于判定后续实现是否达标。

### 7.6 CAL-04：FullCalendar 7.1.3 改变了拖拽落点所依赖的网格契约（发现于 2026-10-18 B3）

计划把 `@fullcalendar/react` 从 7.1.0 升到 7.1.3（「修复受控范围导致的重复更新及拖拽问题」）。实测该版本破坏了本项目日历拖拽所依赖的 DOM 契约：

- 产品代码 `apps/electron/src/renderer/components/app-shell/kanban/CalendarView.tsx:244` 通过 `[role='gridcell'][data-date]` 计算拖拽目标列；同一文件 639 行注明「month grid: every day cell carries `data-date`」。
- 既有验证 `scripts/verification/planning-performance-workflow.ts:137` 使用同一选择器定位日期单元格。

**对照实验（单一变量）**：其余改动不变，仅切换 `@fullcalendar/react`：7.1.0 → 工作流通过（exit 0）；7.1.3 → 同一行 `boundingBox()` 等待 30 秒超时（事件本身已渲染，只有日期网格单元格定位不到）。

- **判定**：该升级命中本项目的既有失败路径（拖拽落点 + 日历验证），属**本次引入的回归**。在未把 `CalendarView` 迁移到 7.1.3 的网格 DOM 之前，不采纳 7.1.3；`@fullcalendar/react` 改为**精确 `7.1.0`**（`^7` 会在下次安装时重新解析到 7.1.3）。
- **后续工作**：迁移 `CalendarView` 的落点查找（以及依赖同一选择器的验证脚本）到 7.1.3 的实际 DOM，再整体采用该版本；届时应同时跑日历拖拽与 planning 流程。
- **产物**：`.cache/upgrade-20261018/gates/planning-perf`（7.1.3，失败）、`planning-perf-fc710`、`planning-perf-final`（7.1.0，通过）。

## 8. 首轮复核后追加的失败场景（2026-10-19，实现前固定）

首轮复核为 changes-requested（见 [2026-10-19 复核记录](upgrade-2026-10-19-review.md)）。以下场景在本轮实现**之前**追加，用于判定修复是否达标；判定依据是复核记录给出的实测事实。

### 8.1 HE-09：转码之后再次编码会重新引入格式/MIME 不一致（R1）

首轮实现只在 HEIC→JPEG 那一步设置 `finalMimeType`，随后的缩放分支仍用**原始** `attachment.mimeType` 判断 `isPhoto`，于是「HEIC → JPEG → 需要缩放」的真实路径把最终 bytes 编成 PNG，却仍返回 `image/jpeg` 与 `.jpg` 路径。

- **触发入口**：真实 `file:storeAttachment` RPC（`registerFilesHandlers`）+ headless processor；输入为真实 2048×1536 HEIC（超过 1568px 上限，必然进入缩放）。
- **判定**：最终 bytes 的格式签名、返回的 `mimeType`、落盘文件扩展名、`size`、`resizedBase64` 必须互相同源一致（同一次编码的产物）；renderer 使用的必须是服务端返回的最终元数据。
- **必须覆盖**：正常手机尺寸、JPEG fallback（超 5MB 二次压缩）、空 MIME、错误 MIME、重复发送、失败保留草稿、原始磁盘文件不变。
- **不得**：只直调转换模块或以 320×240 fixture 代替生产链路。

### 8.2 HE-10：同线程 `Promise.race`/`setTimeout` 不能终止同步解码（R2）

`heic-decode` 使用同步 libheif 解码、`heic-convert` 使用同步 `jpeg-js` 编码。同线程的超时只在同步工作结束后才有机会执行，既不终止工作也不释放事件循环。

- **触发入口**：受控故障注入（人为放大解码工作量 / 挂起注入），观测主线程心跳与任务终止。
- **判定**：转换必须运行在**可终止**的 worker 或子进程；具备并发上限、截止时间终止、异常与崩溃清理；超时后事件循环仍然响应；打包后仍可加载解码器。
- **不得**：把「异步超时获胜」当作取消成功；不得为了通过而缩小断言。

### 8.3 HE-11：字符串扫描不是尺寸预检（R3）

`buffer.indexOf('ispe')` 会命中任意 box（含 `free`）里的伪标记，取到 1×1 之类的假尺寸；尺寸缺失时仍然继续解码。

- **触发入口**：在合法 `ftyp` 之后放入含伪 `ispe` 的 `free` box；以及缺少可用尺寸属性的样本。
- **判定**：必须按 ISO-BMFF box 边界与层级解析，读取**主图项**关联的 `ispe`（经 `pitm` / `iprp.ipma` / `ipco` 关联），并在像素分配前按真实宽高限额；无法可靠确定尺寸时**失败关闭**，不得继续解码。

### 8.4 EP-06：旧端点归一化不得丢弃用户模型与协议（R4）

`legacy-endpoints.ts` 只要 URL 匹配就去掉 `customEndpoint`，把显式自定义连接改走原生目录；而 `pi-agent-server` 只在 custom endpoint 分支注册用户模型，于是目录外模型 ID 变为不可用，逐模型能力/上限也不再注册。UI 又只接受目录模型并在保存时覆盖旧列表，`resolveDefaultCatalogModel` 会把目录外默认值替换为目录首项。

- **触发入口**：真实连接读取（`getLlmConnections`）、UI 保存路径、真实 Pi 子进程、脱敏回环请求。
- **判定**：显式自定义协议/URL/目录外模型 ID/逐模型上限必须原样保留；默认模型 ID 不得被替换为目录首项；原生 provider 的协议分流仍须正确；不得写回真实用户配置。
- **不得**：以「URL 命中旧默认」为唯一条件丢弃 `customEndpoint`。

### 8.5 VF-01：浏览器桥接失败不能被当作编辑器回归（Markdown）

`.cache/verification/critical-gx7Efn/markdown-popout/failure.json` 显示失败发生在 `workflow-browser.ts:37` 的 `chromium.connect`（`ws://[::1]:…write ECONNRESET`），页面尚未建立、零场景执行；该证据不支持任何 Tiptap 归因。

- **判定**：先有界定位浏览器桥接（Bun/Node/Playwright、IPv4/IPv6、进程生命周期与失败清理），保留日志；只有在出现真实编辑器/Markdown 行为回归后，才做同环境同构建的单变量版本对照。
- **不得**：先回滚 Tiptap；不得把「未完成的重跑」记为通过。

**定位结果（2026-10-19）**：根因在桥接，共三层，逐层被实验证实。

1. Playwright `launchServer` 默认 `host: "localhost"`，Windows 上解析为 `::1`，浏览器服务器**只监听 IPv6**；Bun 的 WebSocket 客户端对 `ws://[::1]:…` 报 `ECONNRESET`，重试到 `127.0.0.1` 则是 `ECONNREFUSED`。
2. 显式 `host: '127.0.0.1'` 后端点变为 IPv4 且不再被拒，但 `chromium.connect` 仍然**握手超时**：Bun 进程无法与该 WebSocket 端点建立会话。同时原实现拿到 endpoint 后**停止读取**子进程 stdout，Playwright 后续写入会填满管道并阻塞子进程。
3. 决定性实验：在 Bun 1.4.3 下直接 `chromium.launch()`（不经浏览器服务器）可以正常开页、取文本、取版本（Chromium 156.0.8078.4）。也就是说 `launchServer + connect` 这套为旧版 Bun 写的规避路径本身已经过时，并在当前环境下失效。

**修复**：`launchWorkflowBrowser` 改为**直接 `chromium.launch()`**；仅在直接启动失败时回退到「Node 启动浏览器服务器 + 有界连接重试（IPv4）+ 持续排空 stdout + 失败即 kill」。断言、预算与页面逻辑均未修改。

**验证**：`markdown-popout-workflow` 修复后 **18/18 场景通过**（`.cache/upgrade-20261018/review/markdown-popout-direct`），此前该流程从未创建页面。Tiptap 3.32.0 与本失败无关，不做版本回滚。

### 8.6 VF-02：结果采集必须区分声明、实测与未运行

`upgrade-0153-results.ts` 的 Python 字段是硬编码声明，`--only` / `--skip-gates` 会用空或部分 gates 覆盖同一总结果。

- **判定**：总结果显式表达每项 pass / fail / blocked / not-run；未被本轮执行的门禁不得因采集参数而消失或呈现为通过；Python 必须给出实测运行证据而非硬编码版本。
- **不得**：以部分采集覆盖完整验收结果；不得报告 39/39（FullCalendar 为批准例外，实际 38/39）。
- **产物**：`.cache/upgrade-20261018/gates/planning-perf`（7.1.3，失败）、`planning-perf-fc710`、`planning-perf-final`（7.1.0，通过）。

## 9. 第二轮补充验收（2026-10-19，场景判定先于工作流编写）

首轮复核（`upgrade-2026-10-19-review.md` 第 5.4 条）要求补足「有价值但此前无覆盖」的依赖验收场景。以下每一项的**失败判定先于工作流代码固定**，再按该判定编写工作流并采集证据；未通过项不得报完成。

### 9.1 VF-03：浏览器验收夹具在 Bun + Playwright 下不可用（验证基础设施缺陷）

- **判定**：浏览器验收必须有可重复的夹具入口；夹具加载失败不得被记为产品回归，也不得用「已通过别的流程」代替。
- **实测（本机 Windows / Bun 1.4.3 / Playwright chromium 156.0.8078.4）**：
  1. 同进程内先启动 Vite dev server 再 `chromium.launch()`：启动耗时从 88 ms 退化到 50-200 s（多次测量：`browser-only 88/198/458 ms` vs `vite-first 50 062/66 299 ms`），并触发 Playwright 180 s 启动超时；未超时的情况下，页面模块请求停在 Vite「scanning dependencies」阶段不再返回。
  2. 把 Vite dev server 放到 Node 子进程托管：能打印 URL，但任意请求（含 `index.html`）永不返回。改为 Bun 子进程托管同样不返回；最小 `Bun.serve` 对照服务器 370 ms 正常返回，说明不是 Bun HTTP 本身的问题。
  3. 结论：**Playwright 驱动与 Vite dev server 不能在同一进程共存**，dev server 托管到子进程也不可靠。
- **修复**：`scripts/verification/fixture-bundle.ts` + `fixture-bundle-host.mjs` —— 用应用自身的 Vite 配置在 Node 子进程里**一次性构建**夹具页（Tailwind/CSS/别名全部走真实管线），再由工作流进程用 `Bun.serve` 静态托管产物；浏览器先于任何构建启动。`h0WXOE`/`CvnMWh`/`ToN1Dd` 三次运行的对照记录在实现记录第 10.1 节。
- **不得**：把夹具加载失败计入产品失败；为绕过该问题关闭断言、降低预算或改用 `networkidle`（`networkidle` 可被单个停滞请求满足，正是首轮误判的来源）。

### 9.2 Pi 运行时：PC-01…PC-05

| 编号 | 失败判定 | 结果 | 证据 |
| --- | --- | --- | --- |
| PC-01 | 会话中途切换模型后，provider 收到的仍是旧模型 | 通过（第 2 次请求 `fixture-b`，ack 报 131072 窗口；`set_model` 另测） | `upgrade-0153-pi-runtime-cjQxh4/pi-model-switch.json` |
| PC-02 | 畸形工具参数导致子进程崩溃或回合挂死 | 通过（有界错误回给模型，pid 不变，下一回合正常） | `pi-malformed-tools.json` |
| PC-03 | 取消后无终止态或留下孤儿进程 | 通过（`agent_settled{aborted:true}`，1.5 s 内 0 新请求，7 个 pid 全部退出） | `pi-abort.json` |
| PC-04 | 瞬时错误不被重试，或重试耗尽后报多个错误 | 通过（1 次 `auto_retry_start`、`text_discard` 带同一 turnId；耗尽时 15 次请求、恰好 1 个 `service_error`） | `pi-retry.json`、`pi-retry-midstream.json`、`pi-retry-exhausted.json` |
| PC-05 | 逐模型输出上限不随模型变化，或压缩调用不带上限 | 通过（A 16384 / B 4096；压缩请求 13107=`min(floor(0.8×16384),16384)`，B 下 4096） | `pi-output-caps.json` |

**实现发现 P-01（已记录，未修改产品）**：`packages/shared/src/agent/pi-agent.ts:1132-1135` 把每次 `tool_execution_start` 缓存进 `bufferedDurableToolStarts`，只有 durable-prepare 路径会冲刷（`:1791-1799`）。参数校验失败的调用不会进入 `execute()`，因此该缓存项被丢弃，宿主把有界错误以回退名 `tool` 发布（`event-adapter.ts:863`），`PostToolUseFailure` 钩子拿到的 `tool_name` 也是 `tool` 而不是 `read`。证据：`pi-malformed-tools.json` 的 `sdkAnnouncedOnWire: 1 / publishedAsHostToolStart: 0 / hostToolResultName: "tool"`。影响仅限钩子载荷与事件名，不影响回合结果。

### 9.3 MCP：MCP-01…MCP-03

| 编号 | 失败判定 | 结果 | 证据 |
| --- | --- | --- | --- |
| MCP-01 | stdio 服务器工具未经 `proxyToolName` 注册，或代理调用不通 | 通过（`mcp__fixture__echo`；含点号工具名归一为 `mcp__dotted__foo_bar` 并按原名派发；碰撞保留首个并告警；断连后所有子进程退出） | `upgrade-0153-mcp-497vVb/mcp-stdio.json` |
| MCP-02 | HTTP 服务器只能列工具、调用不通 | 通过（独立 `Bun.serve` JSON-RPC 服务器，`initialize`/`tools/list`/`tools/call` 全链路回声） | `mcp-http.json` |
| MCP-03 | 需要 OAuth 的服务器挂起、失败不闭合或残留待授权请求 | 通过（401 在 3 ms 内闭合、重试 1 ms，`error.code=401`，不发送凭据，`OAuthFlowStore` 前后均为 0，连接与子进程全部清理） | `mcp-oauth.json` |

**实现发现 M-01（已记录，未修改产品）**：`packages/shared/src/mcp/validation.ts:130-141` 的 `classifyConnectionError` 只匹配**消息文本**（`/\b401\b|\b403\b|unauthorized|forbidden|authentication/i`），而 `@modelcontextprotocol/sdk` 1.32.1 把 401 格式化成 `Streamable HTTP error: Error POSTing to endpoint: <body>`，HTTP 状态只存在于 `StreamableHTTPError.code`。实测：RFC 6750 体（`{"error":"invalid_token"}`）与空体都判为 `failed`，只有正文里带 `Unauthorized` 字样才判为 `needs-auth`。后果：`packages/session-tools-core/src/handlers/source-test.ts:869-879` 走硬错误分支，`source_test` 不会提示「需要认证」，`session-context.ts:230` 的 `needsAuth` 同样受影响。建议修法（未应用）：分类时同时读取传输层 `code`（401/403 即 `needs-auth`），或用 401 响应的 `WWW-Authenticate` 挑战。

### 9.4 用量账本：UL-01…UL-04

| 编号 | 失败判定 | 结果 | 证据 |
| --- | --- | --- | --- |
| UL-01 | 成功调用漏记、重记或记账值与 provider 上报不一致 | 通过（1 行 `model:l1-run:1`，1234/57 与 provider 一致，费用按配置费率推导为 0.004557，审计 0 问题） | `upgrade-0153-usage-ledger-a8DJP3/usage-success.json` |
| UL-02 | 失败后重试的调用不按「实际计费的那次」记账 | 通过（503→200：2 次请求、1 个 attempt、1 行携带 4321/89；失败那次不写行） | `usage-retry.json` |
| UL-03 | 重放导致重复行 | 通过（`prepare {created:false,status:'outcome_committed'}`，仍 1 行，0 新事实，无 `duplicate`） | `usage-replay.json` |
| UL-04 | 全部请求都失败的重试被记成「零费用已计量」 | **失败（产品缺陷，已记录未修改）** | `usage-agent-retry-deviation.json` |

**实现发现 U-01（已记录，未修改产品）**：一次所有 provider 请求都被拒（503，从未计费）的尝试仍被写成一行「已计量零费用」：`model:f1-run:1` input 0 / output 0 / costUsd 0 / `costSource:'pi_sdk_estimate'` / `stopReason:'error'`，且没有 `model_recovery_decided` 判定。写入点：`packages/pi-agent-server/src/durable-model-stream.ts:49-54`（把 SDK 的零用量占位提交到 `error` 事件）、`packages/pi-agent-server/src/index.ts:1009-1019`（原样转发）、`packages/server-core/src/durable-runtime/coordinator.ts:849-860`（落行）。内置审计对此不报错（它只比较有 outcome 的行）。这违反复核第 5.4 条「失败重试按实际 usage 记账而非一律零计费」。建议修法（未应用）：`index.ts:1009-1019` 在 `stopReason==='error' && message.usage.totalTokens===0 && message.content.length===0` 时不带 `usage`；`commitModelOutcome` 对缺失 usage 只提交 outcome 事实、不落账本行，dispatch/outcome 对账仍然成立。该场景当前按**已发布行为**断言并显式标注为「已知偏差，非可接受属性」，将来修复后该场景会失败，这是预期信号。

### 9.5 随包 PDF 工具：PDF-01…PDF-05

| 编号 | 失败判定 | 结果 | 证据 |
| --- | --- | --- | --- |
| PDF-01 | 正常 PDF 读不出页数/文本，或页选择越界 | 通过（3 页、612×792pt、`--- Page n ---` 分隔、`--pages 2` 只取第 2 页） | `upgrade-0153-pdf-RF2l48/normal.json` |
| PDF-02 | 加密 PDF 挂起、崩栈或不给出可读错误 | 通过（`info` 退出 0 且 `encrypted:true/pages:null/note`；`extract` 退出 1、单行 `Error: Failed to load document (PDFium: Incorrect password error).`、0.9-1.4 s） | `encrypted.json` |
| PDF-03 | 表单字段读不出或填写损坏文件 | 通过（`info` 列出 `/Tx` 字段；`fill-form` 后回读为填写值，页面仍可 `extract`，输入文件哈希未变） | `forms.json` |
| PDF-04 | 损坏文件导致超时、非 1 退出码或残留临时文件 | 通过（`info`/`extract` 均退出 1 且有界，无信号、无残留） | `damaged.json` |
| PDF-05 | 循环页树无限循环或爆栈 | 通过（`info` 退出 1 `Error: Detected cyclic page references.`；`extract` 退出 0 且恰好 4 页=根 `/Count`，<1.2 s） | `cyclic.json` |

**实现发现 D-01（已记录，未修改产品，影响仅限日志整洁）**：`apps/electron/resources/scripts/pdf_tool.py:500-551` 在损坏输入上会先由 pypdf 的 `logging.lastResort` 打一行非 `Error:` 前缀的日志（`EOF marker not found`），再接文档化的单行 `Error: …`。建议修法（未应用）：在 `pdf_tool.py:29-39` 附近加 `logging.getLogger("pypdf").setLevel(logging.ERROR)`。退出码与错误结尾均符合契约。

### 9.6 Chat Starters 浏览器交互：CSB-01…CSB-09、CSL-01…CSL-06

| 编号 | 失败判定 | 结果 | 证据 |
| --- | --- | --- | --- |
| CSB-01…05 | 指针/键盘不可用、焦点不可见、禁用态仍可触发、长标签撑破行 | 通过（9/9；含 `:focus-visible` 与静息态样式差异、Enter/Space、禁用后 0 选择、标签 `scrollWidth>clientWidth`） | `upgrade-0153-chat-starters-browser-ToN1Dd` |
| CSB-06…09 | 保存不立即生效、上限不生效、删除写错顺序、被拒后丢草稿、缺少双语 | 通过（含上限禁用输入、删除后按序写回、服务端拒绝保留草稿、`zh-Hans` 全量渲染） | 同上 |
| CSL-01…06 | 点击不启用来源、启用未完成就发送、无提及时多做动作、safe 模式被绕过、禁用态仍发送 | 通过（6/6；`setSources` 记录显示 400 ms 延迟被真正 await，发送时间晚于启用完成；safe 模式下仅出现 `onSourcesChange`/`setSources`） | `upgrade-0153-chat-starters-landing-27uNA3` |

**实现收敛 CS-06**：`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` 的 starter 点击此前是「启用来源（fire-and-forget）+ 立即发送」，与失败矩阵 CS-06「等待来源就绪后再发送」不符。现改为 `await onSourcesChange(...)`（`onSourcesChange` 类型放宽为 `void | Promise<void>`，`ChatPage` 的包装本就返回 promise），等待服务端 `setSources` 应用后再调用 `handleSubmit`；`CSL-02` 用 400 ms 人为延迟证明发送确实发生在启用完成之后。

### 9.7 会话信息长列表与日历：两个只有运行时才暴露的缺陷（均已修复）

| 编号 | 失败判定 | 结果 | 证据 |
| --- | --- | --- | --- |
| SIS-01/02 | popover 长列表不滚动、出现第二个滚动条或横向滚动 | 通过（460 px 固定高度、恰好一个纵向滚动容器、滚到底部可见最后一项、popover 本身不动、无横向溢出、零错误） | `upgrade-0153-session-info-scroll-rwi4tc`（含 `popover-long-light.png`、`popover-long-dark.png`） |
| SIS-03 | drawer 呈现下长列表不滚动（仅静态检查会漏） | **修复后通过**。修复前（`…-neqC8y`）：drawer 623.19 px 但文件树滚动容器 4410/4410（零滚动范围），4525 px 内容被 `overflow:hidden` 裁掉，滚轮操作 scrollTop 始终为 0；修复后（`…-rwi4tc`）：滚动容器 clientHeight 441 / scrollHeight 4410，滚轮把 scrollTop 从 0 移到 1200，最后一行恰好上移 1200 px | `drawer-layout.json`、`drawer-wheel.json`、`drawer-long-390-scrolled.png` |
| SIS-04 | 横向滚动或控制台错误 | 通过（内容/滚动容器/行均无横向溢出，长文件名截断，零 page/console 错误） | 同上 |
| CAL-01 | 真实指针拖拽不落库或落库时间错误 | 通过（16 步真实鼠标拖拽 10/19 → 10/20，记录 `startAt 2026-10-20T10:00`、`dueAt 11:00`；`fallbackPaths: []`） | `upgrade-0153-calendar-drag-8fISti/cal-01-drag.json` |
| CAL-02 | 调整时长不落库或改到开始时间 | 通过（真实底边拖拽 +2 槽位，`startAt` 不变，`dueAt` → 12:00） | `cal-02-resize.json` |
| CAL-03 | 依赖的网格契约在升级后消失（7.1.3 回归） | 通过（7 个周列 + 42 个月单元格均带 `role=gridcell[data-date]`；`@fullcalendar/react` 实测 7.1.0） | `cal-03-contract.json` |
| CAL-04 | 挂载期间切换语言破坏日历或标题不更新 | **修复后通过**。修复前（`…-ScrQZo`）：DOM 标题停在 `October 2026` 而 FullCalendar 内部已是 `2026年10月`；点 `›` 后 DOM 仍是 `October 2026` 而库内是 `2026/10 – 2026/11`，持久化游标同样冻结 | `cal-04-language.json`、`calendar-zh.png` |

**修复 1**：`apps/electron/src/renderer/components/app-shell/SessionInfoPopover.tsx:70-74` 的 drawer 分支由 `flex-1 min-h-0 overflow-hidden` 改为 `grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden`。原因：drawer 高度是 `auto`（只被 `max-height` 约束），`flex-1` 子项高度不确定，导致内容根节点 `h-full` 解析不到高度，整条百分比链退化为内容高度。popover 之所以正常，是因为它固定 `h-[460px]`。生产路径：紧凑模式下 `ChatPage.tsx:543` 使用 `presentation="drawer"`。

**修复 2**：`apps/electron/src/renderer/components/app-shell/kanban/CalendarView.tsx` 的标题/游标同步。原 effect 依赖 `[controller, events, title, mode, viewScope]`，而 `controller` 是稳定实例、`events` 记忆化、`title` 只在 effect 内写入，因此 `datesSet` 触发的重渲染不会让 effect 重跑，标题与持久化游标冻结在挂载值。现改为在渲染期读取实时值 `liveTitle = controller.view?.title || title` 与 `liveCursor`，effect 依赖加入这两者，标题直接渲染 `liveTitle`。

**同时被证伪的既有说法**：`scripts/verification/calendar-gantt-verification.mjs:1436-1444` 声称「headless Chromium 中合成指针拖拽无法启动 FullCalendar 的交互处理器」。CAL-01/CAL-02 用真实 `mouse.move/down/up` 驱动成功（`pointerDragStartedLibraryHandler: true`），写入经 `commitDates → update → updateWorkItem` 到达；该工作流记录的 `eventDrop`/`eventResize` 回调回退路径仍保留在夹具中，由 CAL-03 证明可达，但从未被用到。

## 10. 第二轮复核追加的失败场景（2026-10-19，实现前固定）

依据 `upgrade-2026-10-19-review-2.md` 第 5.1 条：先固定判定，再改实现。以下每条都含"必须可复现"的验收方式。

### 10.1 HE-12（R6，P1）：打包后的解码器解析不得依赖启动目录

- **判定**：生产解析函数必须在真实打包产物内、以任意工作目录调用都能定位**包内**解码器；从仓库之外启动不得回落到开发机 `node_modules`，也不得报 unavailable。
- **现状（复核复现）**：`packages/server-core/src/services/heic.ts:323-345` 在 CJS 打包后 `import.meta.url` 不可用，回退到 `globalThis.__filename`（普通 CJS 模块的局部 `__filename` 并不存在该全局），最终落到 `process.cwd()`。实测：cwd=`resources/app` 用包内 decoder；cwd=可执行文件目录解析到 `E:\Phaneris\node_modules\heic-convert\index.js`（开发仓库）；仓库外临时目录 exit 1 `HEIC/HEIF support is unavailable ... (tried 1 base path(s))`。证据 `.cache/upgrade-20261018/review2/packaged-resolver*.json`、`reproduce.cjs`（不得覆盖）。
- **不得**：把 worker body 复制进测试脚本后直接 `require` 解码器充当验收；不得只在 `resources/app` 这一种 cwd 下通过。
- **验收**：从仓库之外启动真实 unpacked 应用（`ELECTRON_RUN_AS_NODE=1` 的生产入口即可），执行真实附件/RPC 转换，证明解码器来自包内且不依赖 cwd；开发/headless 入口同样可用。

### 10.2 HE-13（R7，P2）：`ipma` 关联宽度必须由 `flags & 1` 决定

- **判定**：`ipma` 的 item ID 宽度由 FullBox `version` 决定，property association 宽度由 `flags & 1` 决定；两者独立（依据 libheif `Box_ipma::parse`/`derive_box_version`）。
- **现状（复核复现）**：`heic.ts:226-258` 用 `version` 决定 association 宽度，四种合法组合中 v0/f1 与 v1/f0 返回 null，合法图片被错误拒绝。证据 `review2/heic-ipma.json`。
- **验收**：四种组合都解析出 2048×1536；同时保留截断、box 边界、缺失 `ispe`、伪 `ispe` 的拒绝场景；并用完整可解码样本走真实链路。

### 10.3 CS-11（R8，P1）：来源启用失败或等待期间失效时不得发送

- **判定**：starter 点击必须把 `setSources` 失败传播给用户并**停止发送**；等待期间若会话被禁用、取消或切换，原点击失效；重复点击不得并发发送；不清空草稿，不放宽 safe 模式。
- **现状（复核用真实 ChatDisplay 复现）**：`setSources` 拒绝后仍发出 1 条消息；等待期间 `setDisabled(true)` 后仍发出 1 条。且 `AppShell.tsx:1174-1182` 的真实 callback 吞掉 RPC 异常，上层无法判断失败。证据 `review2/chat-starter-errors.json`、`chat-starter-errors.cjs`（不得覆盖）。
- **验收**：真实 UI 场景覆盖 拒绝/延迟中禁用/延迟中取消/延迟中切会话/重复点击，断言发送数为 0；错误可见；草稿与 safe 权限行为不变。

### 10.4 CS-12（R9，P2）：工作区设置读取必须隔离过期响应

- **判定**：`chatStarters` 必须随工作区重置；异步读取要有请求序号/取消；A→B 时 A 的迟到响应不得覆盖 B，B 加载或失败期间不得展示 A 的提示；点击不得把别的 workspace 的提示用于当前会话。
- **现状**：`AppShell.tsx:1047-1075` 无过期请求保护。
- **验收**：真实 UI 覆盖 延迟乱序（A 慢/B 快）、B 读取失败、同工作区连续保存乱序、无活动工作区、等待发送期间切会话。

### 10.5 AI-01（R10，P2）：模型表单必须按 provider 与字段分别追踪编辑意图

- **判定**：保存保护必须分别追踪"当前 provider"与"每个字段是否被用户编辑"，不能用一个"默认模型未变"布尔值同时决定 `utilityModel` 与 `models` 是否恢复初值。
- **现状**：`ApiKeyInput.tsx:373-389` 中 `selectionUnchanged` 只比较默认模型却恢复 utilityModel 与 models：只改辅助模型会被静默回退；切 provider 后又可能提交旧 provider 的 default/list。
- **验收**：真实表单场景分别只改辅助模型、清空辅助模型、只改默认模型、只改 key、切 provider；断言提交值符合用户意图，且自定义模型/协议/能力保留。

### 10.6 VF-04（R11，P1 验收阻断）：状态必须传播，环境受限与已知问题不得计入通过

- **判定**：`environmentLimited` 记录不得计入 `passed`，不得通过降低 `minimum` 掩盖；父级汇总必须传播受限状态；已知缺陷记录可以保留为可复跑证据但不得计入通过。
- **现状**：`governance-closeout-workflow.ts:72-95` 的 3 条 `passed:false, environmentLimited:true` 被 `run.complete(records.map(...))` 计入 22/22；`upgrade-0153-usage-ledger-workflow.ts` 的 UL-04/F1 已声明未接受却仍计入 4/4 并退出 0。`complete: true` 目前只表示全量采集，不能作为完成依据。
- **不得**：为制造绿色而降低 minimum、删除正确性场景、或声称下载障碍已证明全机无外网。
- **验收**：治理工作流恢复严格口径（受限记录单列、原始错误保留、优先在相同冷供给路径重跑）；账本把已知问题标 approved-deferred 并计入独立清单而非通过数；采集器新增明确的总体验收状态，区分"命令成功"与"功能通过"。

### 10.7 VF-05：`test-critical` 的 `theme-foundation` 挂起定位必须有界且留阶段证据

- **判定**：production build / spawn / ready / context / auth / navigation / page-ready / cleanup 各阶段要有可落盘的阶段信息与有界期限；挂起先独立定位再跑套件，不得以一小时盲等作为定位方法；保留原 115 个场景。
- **现状**：`theme-foundation-workflow.ts` 到 `{"phase":"production-web-built","executed":92}` 后无进展（独立与套件内两次复现，套件因此 3600 s 超时）。`GET /` 与 `POST /api/auth` 返回 200 只说明服务可达，**不足以**排除生产页面初始化、浏览器交互或升级组合回归；没有旧依赖组合对照，不得断言"已排除产品原因"。
- **验收**：加入阶段证据与期限后独立复现并定位；只有确认是验证宿主/生命周期问题才修对应基础设施，且不得减少场景数。

### 10.8 VF-06（R11.5）：夹具构建的失败清理必须有界

- **判定**：`fixture-bundle.ts` 的 handshake 超时后必须终止 child；handshake 之后的 `await child.exited` 必须有期限；失败不得遗留子进程或反向拖住套件。
- **现状**：handshake 超时只清 timer、不杀 child；`await child.exited` 无期限。

### 10.9 PK-01（R11.6）：正式暂存路径必须在仓库外运行验收

- **判定**：通过真正的 Windows 构建暂存函数产出 unpacked/portable，从仓库之外启动，验证实际消费位置的 `koffi`、`node-pty` 与 HEIC；`sharp` 先确认是否属于该桌面产物的可达运行路径，不能只用 app 根 `require.resolve` 判缺陷，也不能借此免验真正依赖。
- **不得**：安装、签名、发布、覆盖 `apps/electron/release`；必须独立输出目录与隔离配置。

### 10.10 四项 found-not-fixed 的本轮处置（判定先固定）

| 项目 | 判定 | 要求 |
| --- | --- | --- |
| P-01 工具名回退 | approved-deferred | 影响失败钩子的 `tool_name`，不是纯日志问题；保留"畸形工具不被执行"的安全验收，不扩大到事件架构重写 |
| M-01 MCP 401 分类 | **本轮窄修复** | 结合可信 transport HTTP 状态 + 现有文本兜底识别 needs-auth；覆盖空正文/JSON 正文 401、403、正常认证、500/网络故障、取消；不得把所有传输错误都变成需要登录 |
| U-01 失败尝试零费用行 | approved-deferred（不得计通过） | 不采用仅凭 `stopReason=error && totalTokens=0 && content=[]` 省略 usage 的修法；保留 outcome/恢复事实与已知问题；后续以"用量来源/计量是否已知"为依据设计。补原规划的账本多调用、恢复/分支、warming 与汇总对照 |
| D-01 pypdf 噪声日志 | approved-deferred | 当前失败退出与有界行为已验证；不为日志整洁更改 PDF 错误语义；保留原始 stderr |

**共同口径**：上述延期不等于已证明它们在旧依赖下表现相同；无旧版本对照时只能写"当前已知限制/尚未归属"。

## 11. 第二轮修订的实测结果（2026-10-19）

### 11.1 HE-12（R6）：打包解析改为按运行时位置解析，并在包内验证

- **实现**：`heic.ts` 的解析改为「先按应用自身位置直查 `<appRoot>/node_modules/heic-convert/index.js`，再按模块自身位置解析」；候选来源全部与 cwd 无关：`PHANERIS_RESOURCES_BASE`（Electron 主进程启动时写入）、`process.resourcesPath + /app`、`PHANERIS_APP_ROOT`（仅在 `PHANERIS_IS_PACKAGED=1` 时信任）、可执行文件旁的 `resources/app`；`process.cwd()` 不再参与；`globalThis.__filename` 改为 CJS 局部 `__filename`（`declare const` + `typeof` 判定）。
- **验证 A（复核自带复现）**：用 `review2/reproduce.cjs` 的副本（输出改写到我方目录，未覆盖复核产物）重新从当前生产源打包并执行：四种 `ipma` 组合全部得到 2048×1536；从仓库外临时目录用 unpacked `Phaneris.exe`（`ELECTRON_RUN_AS_NODE=1`）调用生产 `resolveHeicDecoderModule()` → `...\win-unpacked\resources\app\node_modules\heic-convert\index.js`，exit 0。
- **验证 B（真实暂存路径 + 仓库外生产入口）**：`cd apps/electron && bun run build:win && bun run electron-builder --dir --config.directories.output=<隔离目录>`（无签名、无安装、未覆盖 `apps/electron/release`）。随后在仓库外临时 cwd 中用打包后的 `Phaneris.exe` 执行当前生产 `heic.ts` 的 CJS 打包（与主 bundle 同样的 external 设置）：`resolveHeicDecoderModule → 包内路径`、`readHeicDimensions → 2048×1536`、`isHeic=true / isAvif=false / needsTranscode=true`、`decodeHeicToJpeg`（真实 worker 转码）→ 101,528 字节 JPEG（`ffd8`，375 ms）。证据 `.cache/upgrade-20261018/dsh-review2-verify/packaged-heic-entry.json`。

### 11.2 HE-13（R7）：`ipma` 关联宽度改由 `flags & 1` 决定

- **实现**：`readPropertyAssociations` 分别读取 FullBox `version`（item ID 宽度）与 `flags & 1`（association 宽度），与 libheif `Box_ipma::parse` 一致。
- **验证**：复核的四种组合全部返回 2048×1536（`dsh-review2-verify/heic-ipma.json`）；拒绝场景（截断、伪 `ispe`、缺失 `ispe`、超大像素）仍由 `upgrade-0153-heic` 与 `upgrade-0153-heic-store` 覆盖。

### 11.3 CS-11（R8）：来源失败/失效一律不发送

- **实现**：`ChatDisplay` 的 starter 点击改为一次「启用-再发送」事务——失败时弹出错误（含宿主消息）并**不发送**；等待结束后按**当前** session/workspace/可发送状态复核，任一项变化即放弃；`starterRunRef` 串行化点击，防连点并发；`AppShell.handleSessionSourcesChange` 不再吞异常（改由调用方决定）；composer 的 fire-and-forget 切换改为上报错误而不是未处理拒绝。不清空草稿、不改 safe 权限。
- **验证**：`upgrade-0153-chat-starters-landing-workflow` 11/11，全部操作真实 `ChatDisplay`：CSP-02 顺序、CSL-07 拒绝（0 发送 + 可见错误 + 宿主消息）、CSL-08 等待中禁用（0）、CSL-09 等待中切会话（0）、CSL-10 等待中切工作区（0）、CSL-11 三连点（恰好 1）。运行目录 `upgrade-0153-chat-starters-landing-*`。

### 11.4 CS-12（R9）：工作区隔离

- **实现**：把 AppShell 内的加载逻辑提取为生产 hook `apps/electron/src/renderer/hooks/useWorkspaceChatStarters.ts`（AppShell 使用同一实例），保留「切换即清空 + 请求序号 + 作废标记 + 失败即空」四条规则。
- **验证**：`upgrade-0153-workspace-isolation-workflow` 5/5，挂载真实 hook、逐条手动决定哪个工作区先回答：CSW-01 A 迟到响应被丢弃、CSW-02 B 读取失败显示空、CSW-03 同工作区乱序以最新为准、CSW-04 无活动工作区为空、CSW-05 切换后新读取返回前已清空。

### 11.5 AI-01（R10）：模型表单按 provider 与字段分别判定

- **实现**：`ApiKeyInput` 用 `defaultEditedRef` / `utilityEditedRef` 分别记录字段编辑意图；「保留存储值」只在当前 preset 等于 **`initialValues.activePreset`**（存储值所属 provider）时成立。
- **验证**：`upgrade-0153-model-form-workflow` 5/5，驱动真实表单（key 输入、两个 tier 下拉、provider 选择器）：只改辅助模型、清空辅助模型、只改默认模型、只改 key、切 provider。**该验证当场发现我第一版修复仍存在的缺陷**：切换 provider 后 `hydratedRef` 会指向新 provider，于是仍会回落到旧 provider 的 default/list（MF05 实测提交了 `kimi-k2` + `['kimi-k2','kimi-k2-mini','kimi-legacy']`）；改为与 `initialValues.activePreset` 比较后通过。

### 11.6 VF-04（R11）：状态传播与总体验收状态

- **治理恢复严格**：复核指出的「3 条受限记录被计入 22/22」不成立后无需放宽——先前的下载失败是**瞬时**的（复核也提醒不得据此断言整机无外网）。移除我上一轮加入的离线特例后重跑：`cold-runtime-provision` 真实下载 uv 0.13.1、校验 sha256、安装并自报版本，22 条记录全部 `passed: true`（`governance-closeout-tOEdfI`）。未降低 `minimum`、未移除任何场景。
- **账本**：F1 从通过集移出，改写为 `known-issues.json`（`status: approved-deferred`）并进入 `untested` 说明；新增真实场景 `L4-multi-call-session-rows-and-summary-reconcile`（同一 session 三次计费调用：每操作恰一行、身份唯一、汇总等于请求级之和、与生产 `projectDurableUsage` 投影一致）。因此 `upgrade-0153-usage-ledger` 仍为 4/4，但 4 个都是正确性场景；F1 不计通过。
- **采集口径**：`upgrade-0153-results.ts` 新增 `acceptance` 块，明确 `complete:true` 仅表示「未使用 `--only/--skip-gates`」，并给出 `commandSuccess` / `functionalStatus` / 失败门禁 / 环境受限门禁 / 批准例外与已知问题清单。

### 11.7 VF-05：`theme-foundation` 的有界定位

- **实现**：production build / spawn / ready / context / auth / navigation / page-ready / cleanup 各阶段写入 `production-web-stages.json`（每次覆盖，落盘可查）；`spawn` 30 s、`contexts` 60 s、`auth` 30 s、`pages` 60 s、`page-ready` 各 60 s、cleanup 15 s 期限；`settle()` 加 5 s 期限（原本会因动画永不结束而无限等待——上一轮正是此处挂起，实测 12 次触发期限）。
- **实现**：controls 阶段改用 `domcontentloaded` + fixture 的 `[data-foundation-ready]` 就绪标记，不再使用会被 dev server 依赖优化拖住的 `networkidle`。
- 结果见 11.10。

### 11.8 VF-06：夹具构建的有界清理

- **实现**：`fixture-bundle.ts` 在 handshake 超时时 `killAndReap`（杀掉并 10 s 内有界回收），handshake 后等待 child 退出也改为 15 s 上限，超限即杀并报错。

### 11.9 PK-01：真实 Windows 暂存与仓库外运行

- **构建**：`bun run build:win`（真实暂存函数：main/preload/interceptor/renderer/copy-assets）+ `electron-builder --dir`，输出隔离目录 `.cache/upgrade-20261018/package3/`；未签名、未安装、未覆盖 `apps/electron/release`。**本仓库没有 `portable` 目标**（`electron-builder.yml` 仅 nsis + 平台默认），因此「portable 运行」以「从仓库外目录运行 unpacked 产物」实现，不新增打包目标。
- **仓库外运行验证**（临时 cwd，`ELECTRON_RUN_AS_NODE=1`，真实 `Phaneris.exe`）：生产 HEIC 入口 → 包内解码器 + 101,528 字节 JPEG；`node-pty` → 从包内解析（`resources/app/node_modules/node-pty/lib/index.js`）并真实创建 ConPTY 执行 `cmd.exe /c echo PTY_OK`（输出含 `PTY_OK`）。
- **`koffi`**：不在 `bun.lock`、未安装、全仓无 `require/import`，仅列在根 `package.json` 的 `trustedDependencies` —— 不是桌面产物的运行时依赖，无可验收的消费点（measured，非豁免）。
- **`sharp`**：桌面产物内不存在，且其唯一生产导入方是**无头服务端**平台（`packages/server-core/src/runtime/platform-headless.ts:68,74` 动态 `import('sharp')`，入口 `bootstrap/headless-start.ts`），Electron 主进程走 `nativeImage`；因此它不属于桌面 unpacked 产物的可达运行路径。本机 `server:build` 不受支持（仅 darwin/linux），无头产物无法在此构建 → 该验收位置记为 environment-limited。

### 11.10 HE-14（本轮新发现，已修）：转码统计把清理误计为失败

- **现象**：打包内生产入口成功转码后 `heicTranscodeStats` 为 `started 1 / completed 1 / failed 1`；原因是 `worker.on('exit')` 对非零退出码无条件 `failed++`，而成功路径的 `finally` 会 `terminate()` 该 worker。
- **修复**：`error`/`exit` 处理器在 `settled` 后不再计数。修复后同一调用为 `started 1 / completed 1 / terminated 0 / failed 0`（`dsh-review2-verify/packaged-heic-entry.json`）。

### 11.11 VF-05 实测结果：`theme-foundation` 不再挂起，但仍有 28/115 断言失败（未计通过）

- **挂起已定位并修复**：上一轮的两处挂起来自「测试宿主」而非产品——(1) `settle()` 无期限等待 `animation.finished`，本机动画不会全部结束，实测期限触发 12 次（旧代码在此永久等待）；(2) controls 阶段用 `networkidle` 导航，dev server 的依赖优化会保持连接，`networkidle` 永不结算。改为有界 `settle`（5 s）+ `domcontentloaded` + `[data-foundation-ready]` 后，工作流在 683 s 内跑完并自行清理（`production-web-stages.json` 记录全部阶段，最后 `cleanup:done checks:115`）。
- **剩余失败（28/115）**：`upgrade-2026-10-19` 轮次中该工作流从未跑完，因此这些断言此前从未被观察到通过（115/115 的记录来自 2026-10-12、升级前的环境）。失败全部属于同一族：`TF10/TF11/TF12/TF16-<host>-<mode>` 的 `Keyboard outline must be visible`，即 fixture 的 `[data-testid=link|button|input|wrapped]` 在 `:focus-visible` 命中（`visible: true`）时 `outline-style` 仍为 `none`；同一场景里 `[data-testid=native]`（TF09）的 outline 正常（`solid 2px`、颜色解析为 oklch）。
- **已知的相关事实**：这些元素是共享 `Button`/`Input` 组件（依赖 ring 阴影而非 outline），而 outline 断言来自 `packages/ui/src/styles/controls.css` 的 `:focus-visible { outline: 2px solid … }`；`TF09` 的原生 `<button>` 通过，说明样式表本身已加载。**尚未归属**：是 fixture 断言与 ring-based 焦点样式的既有分歧，还是本轮依赖组合下的真实 outline 回归——没有旧依赖组合对照不得断言其一。
- **状态**：`test-critical` 仍为 failed，但原因从「一小时超时」变为「28 条具名断言失败 + 完整阶段证据」，且不计入任何通过数。

## 12. Codex 直接收口的先行失败路径（2026-10-20）

用户已要求由 Codex 实施。当前基线 `ac85d33b0`，不再沿用旧 HEAD/未提交升级的描述；[执行清单](../dependencies/upgrade-closeout-2026-10-20.md)。以下在本轮产品修改前记录。

| 编号 | 触发与失败判定 | 必须保留的对照/产物 |
| --- | --- | --- |
| CO-01 | 真 HEIC 经 File API 返回空/错误 MIME，前端变 unknown，服务端跳过图片分支；或提升服务端类型后 renderer 仍发送旧 type/name | 选择/拖拽/粘贴真实入口 + 生产存储 RPC，最终 type/name/MIME/bytes/size 一致；AVIF 不转换，普通二进制不误升级为图片；原始文件哈希不变 |
| CO-02 | 损坏 HEIC/存储拒绝后输入已清空，过滤掉失败图片仍发送；异步成功又清掉用户新输入 | 失败发送数为零，文本/所有附件草稿保留；多附件部分失败不静默丢失；成功清理只对应提交快照，不清后来编辑；正常排队/中断/发送不退化 |
| CO-03 | worker 超时 terminate 与 exit/message 竞争，结果/计数不确定；ipma 合法组合未进入正式回归 | deadline 只结算一次且回收 worker，循环仍响应；ipma v0/v1 × flags0/1 正向、损坏/伪 ispe 负向，真实 decoder 对照 |
| CO-04 | 设置读取未完成或失败仍允许整组保存，覆盖已存 starters；只有 Textarea 无富文本 mentions | 挂起读取时禁止写；失败可重试并保留编辑；RichTextInput + 生产 mentions，标签/长度/0/1/3/服务器拒绝/中英文/键盘及焦点场景 |
| CO-05 | StrictMode cleanup 后 ref 永久 false；取消等待后迟到启用仍发送；工作区首次 render 返回旧提示 | setup/cleanup/setup 后正常一次发送；等待期间 Escape/Stop 失效且不发送，下一次仍可发送；同步按 workspace 过滤，真实未决 A→B→B先返回→A后返回，断言确已释放 A 请求 |
| CO-06 | 切 provider 后目录挂起、失败、乱序时提交旧 provider 的 default/models；假目录外夹具令保留断言空转 | 当前目录/provider/request 身份一致才可保存；A/B 乱序；真实目录外 ID；分别只改 key/utility/default/清空utility/切provider及 legacy provider 推断 |
| CO-07 | 焦点断言只接受 outline，误拒现有 ring；以透明或任意阴影放宽则假通过；production build 无期限 | 保留 115 个原场景，检查共享控件实际 accent ring（现行 1.5px + spacer）及 zoom；native/forced-colors 2px outline；build 超时有界杀掉并回收本任务子进程 |
| CO-08 | 仅用多轮 operation 代替一轮多次 provider 调用，分支继承父账单、warming 混入主调用或重复入账 | 真实 Pi/SessionManager/SQLite，一轮工具循环多请求逐行对账、恢复/分支/独立warming与投影；保留 U-01 明确延期，不伪装计费真相 |
| CO-09 | resume 丢工具、切模型带入思考、Go 旧默认未规范化、headers 丢失、undici 取消/代理遗留连接 | 真实子进程与回环请求记录；精确旧URL/自定义URL正反对照；稳定session header；有界取消与资源清理，无真实账户 |
| CO-10 | 编辑器撤销/列表/上传退化，日历时区/DST错日，PDF渲染资源未释放或仅 smoke 无代表任务 | 生产编辑器/日历和随包 Python 实际任务，语义/落盘/渲染产物和资源关闭证据，版本保持冻结 |
| CO-11 | 仅单独 CJS 模块烟测就称真实 packaged main/RPC 通过；真实 Electron nativeImage/窗口生命周期未覆盖 | 真 main/preload/renderer，仓库外 unpacked、隔离配置，HEIC 选择/拖放/粘贴/失败草稿、窗口重开及深链接；node-pty/decoder 实际消费路径 |
| CO-12 | 任何 server 构建失败均标环境受限；手工改机器结果、快照只匹配少量文件却称整个 tip 通过 | 平台拒绝按实际输出分类，其他失败保持红；完整/部分采集分离，当前 HEAD/dirty/锁及最终源码哈希，原门禁与 registry 不放宽，文档唯一当前结论 |

### 12.1 CO-10 实施中追加：编辑器文件粘贴闭包

新增 ED-04 在生产 MarkdownArtifactEditor 中完成撤销、重做、无序→有序列表和 HTML 粘贴后，文件粘贴没有插入任何图片（`upgrade-0153-editor-mHSM4R` 等失败产物）。文件处理器在 extensions 的首次 memo 中捕获 `editable=false`，而产物编辑器必须等 lossless gate 通过后才切换为可编辑；memo 不以 editable 为依赖，故文件处理器永久拒绝。修复前先记录此失败路径：使用当前 editor.isEditable 判断，不因 editable 改变重建 extensions/清空历史；只读时仍必须拒绝文件粘贴/拖放。ED-04 检查真实 File→FileReader→图片节点→Markdown，并保留前面的历史与列表断言。

### 12.2 CO-03/11 实施中追加：原生 worker 小图片传输

真正 Electron main 的 `file:storeAttachment` 处理 small.heic 时返回 `Cannot transfer object of unsupported type`，CDP 原始 RPC 已归档于 native-attachments 失败运行。worker 使用 Buffer.from(output) 后传输 bytes.buffer；小输出会落入 Node 标为不可转移的 Buffer 池，Bun 路径未复现。改用独立 Uint8Array，保持零拷贝 transfer 及父端 JPEG 校验；验收必须经真正 main/preload/renderer，并包含小 HEIC，不能用 ELECTRON_RUN_AS_NODE 或 Bun 单独成功代替。

### 12.3 CO-07 实施中追加：菜单异步焦点与构建失败清理

`theme-foundation-9L6qgK` 完整执行 115 项，114 项通过；`TF12-ui-light` 键盘选择仍为第一项，预期第二项。Radix Select 的 ArrowDown 处理通过 setTimeout 执行焦点移动；需在既有构建上记录 ArrowDown 前后焦点，区分产品不响应与 Enter 抢先。若属异步焦点竞争，等待真实第二项获得焦点后再发 Enter，保持“仅一次 ArrowDown、第二项确被选中、Escape 恢复 trigger”断言，不用重复按键或强制选择绕过。

复核 `fixture-bundle.ts` 还发现失败分支调用 killAndReap 未 await；契约要求超时返回前确认子进程退出。补 await 与有界 reap，保留失败退出；用真实 Node/Vite 构建的极短超时记录子进程 PID 与退出状态，不能只验证错误文本。

### 12.4 CO-10/12：八个 Python 工具的留存证据

现有 test:doc-tools 实际含创建/读回/转换任务，但 TemporaryDirectory 在结束时清理，不能留下逐工具产物给审计复验。新增工作流先固定失败判定：八个工具均经过随包 uv 与产品 Python；任一命令非零、输出文件缺失/为空、读回标记/结构不符均失败；仅 --help 或文件存在不算成功。保留每条实际 argv、stdout、原始 stderr、退出码、工具脚本和产物哈希；不更改八个工具实现或依赖，不把 PDF 渲染专项替换成此基础流程。

### 12.5 CO-07：后续主题契约的 dev 宿主卡顿

第五次完整采集中 theme-foundation 已 115/115；critical 的前 35 个工作流通过后，theme-contract 在 Vite optimizer 阶段超过五分钟仍没有 preparation.json，120 秒页面期限也未完成退出。进程 CPU/内存和原始日志在 `.cache/upgrade-20261018/theme-contract-stall.{json,log}`；相同夹具的独立 Node dev 宿主也未在 5 秒内响应 HTML 请求，不能简单断言是 Bun 单一根因。停止本次未完成采集，改用已有独立 Node 一次性构建和静态托管，保留四个真实 CSS 入口、真实 ThemeProvider/Viewer/P2 组件及全部 119 个最低场景和原断言；仅迁移宿主与 CSS 编译入口，不用缩减场景数或忽略页面错误掩盖卡顿。

静态 theme-contract 已 119/119；后续 theme-roles 独立运行也在准备阶段持续超过 120 秒、未生成 preparation.json（`theme-roles-stall.*`）。将共享 roles 夹具的 roles/domains/design 三条流程一起迁移；同批主题 browser-host/login 使用相同独立构建宿主，避免继续混用 dev 预优化。保持最低 76/56/36/23/5 个场景与全部原断言，CSS wrappers 显式包含 roles、domains、layout 的原 @source；login 直接以原 HTML 为构建入口，不复制重写登录页面。

### 12.6 CO-12：夹具生成器登记为工作流却没有验证 manifest

第六次完整采集的 critical 已通过前 44 项（含全部主题），随后因 upgrade-0153-fixtures 没有在 --output-dir 输出统一 manifest 而失败。两个生成器只有自定义数据 manifest，minimum:0 不代表可以跳过产物校验；不能将 testrunner 改成对它们忽略验证或虚报通过。新增薄封装，在独占目录中调用原生成器，核对九个图像/五个 PDF 的精确集合、格式、字节数及 SHA-256，保留原数据 manifest 与命令日志，再发布到既有后续流程的缓存路径；两个登记项均要求至少一项真实生成与产物完整性验收。

### 12.7 CO-12：用户指定的独立验收范围

共享工作树又发生字体迁移，用户明确选择隔离本轮升级。新工作树从 ac85d33b0 创建，只提取升级行为、验证与文档，不带入 W1/W2 生产 CSS/主题、package.json 门禁和债务基线。失败判定：workspace 链接指回 E:\Phaneris、运行时解析借用原仓库、提取遗漏行为或混入字体/颜色变更、在未重跑时沿用共享目录绿色证据。依赖独立冻结安装，所有适用门禁重新从该树执行；原共享 diff 保留，不回滚并行任务。

隔离预检已发现两处旧夹具回调的必要适配在提取时遗漏：Array.push 的隐式 number 返回不能满足新的 void | Promise<boolean | void>。只补显式 void block，不改提交内容、调用次数或任何既有断言；继续用完整类型门禁验证，没有为兼容夹具放宽产品返回类型。

### 12.8 CO-12：隔离验收的后台连接刷新拒绝

隔离完整 critical 与独立复跑均在 client-platform 完成实际对话后捕获 `Connection lost`，堆栈明确标识 `RPC channel: workspaceSettings:get`（`critical-Tn8qmy/client-platform`、`client-platform-bK1FaY`）。App 的工作区/连接事件调用异步 refreshLlmConnections 时没有处理拒绝；重连会拒绝旧 socket 的在途请求。修复前固定判定：不得过滤该 pageerror 或放宽 console error 断言；后台刷新必须处理失败并保留已有数据，重连后重新读取，过期工作区/请求不能覆盖当前值；显式等待刷新结果的操作仍须获得原始失败。复用真实生产 WebUI、实际断线/重连、工作区切换与持久化对话 E2E，保留诊断堆栈及 RPC trace，完整 critical 仍须全部通过。

本次 HEIC/PDF 专项缺夹具是上述 critical 提前退出、尚未运行注册生成器的后果，不能算环境受限；后续完整采集必须先实际生成并验证夹具，再通过专项。当前失败日志保留，不编辑为通过。

修复首次未捕获拒绝后，`client-platform-DZVilj` 继续暴露同一重连窗口内未读数、标签、rtk 状态/偏好读取的已捕获错误；原断言仍使流程失败。追加失败边界：只对确切 `Connection lost` 的幂等读取在连接恢复后重读一次，绝不重放写入；等待最多 30 秒，永久离线、其他业务错误和第二次失败仍交给原错误路径；等待的事件订阅与计时器必须在成功/失败后清理。标签/未读数的迟到读取必须按请求代次隔离，rtk 已卸载时不能更新状态。保留真实断线 E2E 的零 pageerror、零非预期 console error 断言，不把断线错误加入允许清单。

## 13. 批准延期项继续实施：先行失败矩阵（2026-10-20）

用户已批准由 Codex 完整推进 P-01、U-01、D-01 与压缩阈值的可行集成；仍在原隔离树实施，不引入字体迁移、不重开 FullCalendar/cache 补丁例外。上一轮 31 项通过属于此前源码，新增实现须重新验收。[本轮范围](../dependencies/upgrade-followup-2026-10-20.md)。本节先于本轮产品修改写成。

| 编号 | 失败条件 | 必需证据 |
| --- | --- | --- |
| FU-P1 | 畸形参数工具结果/失败钩子仍名为 tool；恢复名称却发布伪造执行开始、执行坏参数、重复失败钩子或串用另一调用身份 | 真实 Pi 子进程→宿主事件及钩子，原 read 名称、零实际执行/副作用、一个失败结果；正常执行/并发调用继续正确 |
| FU-U1 | 未收到计量被当成已计量零；非零错误/部分响应/取消的真实用量丢失；仅按 error/空内容/零 token 猜测未计费 | 实际回环请求→子进程→SQLite，独立记录计量来源与是否已知，明确零/未知/非零分别验收；保留 outcome 与请求观察事实 |
| FU-U2 | 重试、恢复、fork 重复记账或漏掉历史事实；旧行被批量臆测改写；汇总/界面把部分未知显示成完整零费用 | 真实重试/中断续接/fork、幂等对账、旧格式兼容；未知数量与已知汇总分别可见，浏览器检查未知和已知零差异 |
| FU-C1 | 默认未设置时改变 SDK 行为；非法值被持久化；按模型限制失效；设置/RPC/现有会话/恢复/模型切换/上下文显示不同步 | 真实设置持久化与 RPC、重启/切换、模型上下限与默认对照；浏览器设置与实际子进程上下文 payload |
| FU-C2 | 提前触发同时放大摘要预算；改 node_modules 或用深层私有入口；丢失原摘要的文件跟踪/保留边界/前次摘要/分割回合信息 | Pi 1.3.0 公开 session_before_compact + compact，实际触发与真实摘要请求 maxTokens 分别断言；留存摘要/文件/边界 |
| FU-C3 | 摘要绕过真实认证/headers/session 路由与现有计量；取消/失败后仍写摘要或触发无限循环；手动/自动/溢出路径不同步 | 实际供应商回环、原 durable stream、取消/失败/恢复与用量对账；有界次数/退出；失败不能回退到放大预算的默认摘要 |
| FU-D1 | 过滤验收日志伪装修复，屏蔽真实 PDF 异常/损坏诊断，改变失败退出码，成功提取退化 | 产品脚本自身限定第三方日志级别，保留原始 stdout/stderr，正常/损坏/加密/循环样本全部原断言与渲染/资源回归 |
| FU-V1 | 原验收与本轮源码混用；固定阈值/账本修改未进入 critical；旧 known issue 当成当前已修/未修证据 | 新工作流登记、最终源码冻结完整门禁、日志和哈希；当前结果标实际已修项，旧失败/历史产物保留 |

### 13.1 FU-C1：SDK 普通设置写入会丢弃 applyOverrides

真实子进程两次验收中，64000 已在 set_auto_compaction 上线，但 context_usage.reserveTokens 仍为 16384（`pi-compaction-threshold-initial.json`）。SDK SettingsManager.save 会用 global/project 重建 settings，清掉仅 applyOverrides 的内容。改用公开 SettingsManager.fromStorage 与本会话独占的内存存储，flush 后更新模型 reserve 并 reload；不访问 SDK 私有字段、不改 node_modules、不落用户 Pi 文件。必须验证切模式/模型/思考设置后仍有效、清空及重启恢复，不能仅交换两个 setter 的顺序凑通过。

### 13.2 FU-C4：手动压缩的当前运行归属

真实账本场景发现 requestCompact 只尝试创建独立 utility run，没有使用 chat 已获授的 durableRunOperationId/turnId。失败判定：当前运行已有账本归属时摘要不得漏记，也不得再创建第二个 utility run；无当前运行的独立调用保留既有 utility run 生命周期；成功、失败、取消都保持原事务边界。用真实 /compact → Pi 摘要 → SQLite 验证一次摘要只记一次，模型输出上限和原预算仍成立。

### 13.3 FU-C5：摘要入账必须是辅助请求

真实 usage-compaction.json 显示摘要 2000/25 被标为 model_attempt。失败判定：摘要费用必须仍只入账一次，但 purpose/kind 应为 compaction，不生成普通 assistant_message_committed，不成为会话占用来源，不改写先前对话事实；随后真实请求应继续使用 SDK 摘要上下文。缓存 warming 的独立类型、默认/自动/手动摘要路径都须保留。先扩展既有真实 Pi→SQLite 场景并记录红项，再修生产边界。
