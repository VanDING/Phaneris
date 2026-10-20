# 2026-10-19：上游 0.15.3 与依赖升级首轮复核

Status: changes-requested

本记录复核 `codex/upstream-0153-dependencies-20261018` 的未提交 diff；HEAD 为 `82714e2ae3b76643ae16ef1d3a6abfe66e8bf574`。承接[执行规划](../dependencies/upgrade-plan-2026-10-18.md)、[失败矩阵](upgrade-2026-10-18-failure-matrix.md)和 [DSH 实施记录](upgrade-2026-10-18-implementation.md)。

**结论：尚未验收通过，交回 DSH 修正并完成原定交付。** 本记录是代码复核和定向复现，不替代完整的最终门禁。Codex 未改产品实现、依赖版本或用户配置。

## 1. 已确认的阻断项

| 编号 | 优先级 | 位置 | 事实、影响与修复要求 |
| --- | --- | --- | --- |
| R1 | P1 | `packages/server-core/src/handlers/rpc/files.ts:334–402`；`apps/electron/src/renderer/App.tsx:1505` | HEIC 先被转成 JPEG 并设置 JPEG MIME/path，但缩放分支仍用原始 `attachment.mimeType` 决定 `isPhoto`。正常 HEIC 超过 1568px 时走 PNG 编码，返回和上传的 MIME 却仍为 JPEG。必须让每次编码后的 bytes/MIME/扩展名/size 一致，并让 renderer 使用服务端实际返回的元数据；不要仅修改首轮转码。 |
| R2 | P1 | `packages/server-core/src/services/heic.ts:173–193` | `Promise.race` 与 `setTimeout` 同处调用线程，不能终止同步解码/编码。实际安装的 `heic-decode/lib.js` 使用同步 libheif 解码，`heic-convert/formats-node.js` 使用同步 `jpeg-js.encode`。Electron 主线程/服务端事件循环仍会阻塞；即使异步超时获胜，也不会取消进行中的工作。须移入可终止、资源受控的 worker 或子进程，具备并发上限、超时终止、异常清理，打包后可执行。 |
| R3 | P1 | `packages/server-core/src/services/heic.ts:133–165` | 像素预检在任意字节中查找首个 `ispe`，没有验证 box 边界、层级或 primary image 的关联；缺失/不接受的尺寸返回 null 后仍解码。Codex 在合法 `ftyp` 后加入含伪 `ispe` 的 `free` box，预检即返回 1×1。真实多 item/平铺容器也不能以第一个属性替代最终尺寸。须可靠检查待解码图像的真实尺寸，并在像素分配前限制；不能将这个字符串扫描称为资源边界。 |
| R4 | P2 | `packages/shared/src/config/legacy-endpoints.ts:66`；`apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx:274–288,362–373` | 已知旧 URL 一旦匹配就去掉 customEndpoint，旧的自定义模型被强制改走原生目录；`packages/pi-agent-server/src/index.ts:579–587` 仅在 custom endpoint 分支注册用户模型，因此目录外 ID 会变成 unavailable，逐模型自定义能力/上限也不再由该路径注册。UI 又仅接受目录模型，保存时用目录覆盖旧列表；`resolveDefaultCatalogModel` 会将目录外默认值替换为首项。这不满足原计划“模型 ID 继续可编辑/保留自定义协议与模型”的约束。必须保留显式自定义的路径，原生目录仅用于真正的原生配置；旧 URL 的处理不能以丢失模型/能力为代价。 |
| R5 | P1 验收阻断 | `scripts/verification/upgrade-0153-heic-workflow.ts`；`scripts/verification/upgrade-0153-results.ts`；实施记录 | HEIC 仅用 320×240 fixture 直调模块和 headless processor，没有经过真实存储 RPC、renderer 发送和打包运行，所以漏掉 R1。新工作流还依赖未入库的 `.cache/upgrade-20261018/make-image-fixtures.ts`，清理缓存后不能按仓库入口复跑。必须补足生产链路、可重建 fixture 及结果绑定。Chat Starters、原定 Pi/MCP/账本/输出上限/PDF 和 Windows 打包验收仍未完成，不能以 B0–B5 全部完成结案。 |

R1 的实测产物位于 `.cache/upgrade-20261018/review/heic-store/reproduction.json`：使用真实 Pillow/libheif 生成 2048×1536 HEIC，调用真实 `registerFilesHandlers` 的 `file:storeAttachment` 和 headless processor，用户配置隔离在该缓存目录。

| 字段 | 实测值 |
| --- | --- |
| 输入 | `photo.heic`；2375 bytes；2048×1536 |
| 返回 MIME | `image/jpeg` |
| 返回 name | `photo.heic` |
| 存储扩展名 | `.jpg` |
| 实际 bytes | **PNG**；签名 `89504e470d0a1a0a` |
| 实际输出尺寸/大小 | 1568×1176；28828 bytes |
| 返回 base64 与落盘 bytes | 一致，均为 PNG |

仅测试 JPEG SOI 的 `decodeHeicToJpeg` 不能证明后续 resize/上传仍正确。修复还应覆盖 JPEG fallback、空或错误 MIME、重复发送/草稿恢复、失败保留草稿及原文件不变。

## 2. 四项偏离的裁定

| 偏离 | Codex 决定 | 边界 |
| --- | --- | --- |
| 保留 `http-cache-semantics@4.3.0` 补丁 | **接受** | 正式修复与既有本地加固并不等价；不得为了停用补丁削弱行为。Codex 独立重跑现有安全/OCR 流程，25/25 通过。保留 4.2.0 历史补丁文件；4.3.0 注册有效。 |
| FullCalendar 保持 7.1.0 | **接受，精确固定** | 已核对 7.1.3 的 gridcell 超时和 7.1.0 的 20 场景通过产物。当前业务拖拽依赖同一选择器；本轮不再强推 7.1.3 或降低断言。保留原冻结目标，在结果中明确记录批准的例外。 |
| 压缩阈值未交付 | **接受本轮延期；状态为 blocked/deferred，非完成** | 已确认 reserve 同时决定触发与摘要预算，默认摘要预算与放大后的预算分别为 13107/64000。维持默认，不增加无效设置、不改 node_modules 或重写压缩架构。SDK 有自定义压缩扩展能力，但没有现成的独立摘要预算设置；文档应使用这个准确表述，不笼统声称不存在任何公开接入点。 |
| Chat Starters 未实施 | **不接受作为完成后的范围缩减** | 原计划明确交付；执行预算不足不构成技术阻断。继续完成工作区 0/1/3 条、服务端校验、即时更新、持久化、来源/技能 mentions、source-ready 顺序、safe/取消以及现有 locale 治理。 |

i18n 改为 `~26.4.7` / 精确 `17.0.20` 符合冻结维护线的原意，接受。

## 3. Markdown 失败的纠正

交付时的实际失败为：

- `.cache/verification/critical-gx7Efn/markdown-popout/failure.json`：`connect: WebSocket error: write ECONNRESET`。
- 调用栈：`workflow-browser.ts:37` 的 `chromium.connect`，从 `markdown-popout-workflow.ts:18` 进入。
- 当时页面尚未建立，零场景执行；**该日志不能支持“最可能是 Tiptap 3.32.0”**。

先定位 Bun/Node/Playwright 的浏览器桥接、生命周期与回环连接；不要先回滚 Tiptap 或放宽渲染断言。只有出现实际编辑器/Markdown 行为回归后，才做同环境、同构建的单变量版本对照。

Codex 另一次定向重跑创建了 `.cache/upgrade-20261018/review/markdown-popout`，仅留下入口 HTML，没有完成 manifest；会话续接时执行句柄已不存在。这次重跑按**未完成**记录，不声称通过，也不将其归因于依赖版本。

## 4. 证据与报告准确性

- 已逐项比对机器结果所列关键文件的 SHA-256，未发现漂移；9 个历史 run 的产物哈希均匹配。
- 9 个 run 并非 9 次成功：3 个失败；只有 B1 的 `PBmT7f` 和 HEIC 的 `6XaHoj` 两个成功 run 对应当前锁文件。保留历史，最终验收应选择当前源码/锁对应的有效 run。
- 机器结果实际为 **38/39** 目标命中，未命中项是已批准保持 7.1.0 的 FullCalendar。“39/39”及实施记录中旧的 B3 总结必须纠正，不要篡改冻结 targets 来制造全匹配。
- `upgrade-0153-results.ts` 的 Python 字段是硬编码声明，`--skip-gates` / `--only` 会用空/部分 gates 覆盖同一总结果；收尾时应区分声明、实测和未运行，防止部分采集覆盖完整验收。总结果要显式表达 pass/fail/blocked/not-run，不能只列退出码而称全部完成。
- 当前 HEIC 工作流没有 Electron renderer、真实存储 RPC 或打包后执行证据；Python 真运行仅覆盖 HEIC 图片工具，不能替代 PDF 验收。
- `server:build` 的 win32 拒绝属于平台限制；macOS/Linux、容器、签名和真实供应商账户可继续列“未验证”。**Windows 的独立 unpacked/portable 验收在原授权范围内**，应输出到新的缓存目录，避免覆盖 release；不能以“怕覆盖现有产物”为理由省略。

## 5. 交回 DSH 的执行顺序与退出标准

继续原分支、原 DSH 会话，串行执行。先将本轮失败场景追加到已有失败矩阵，再修实现；不在实现后补单元测试。优先真实生产组件、RPC 和子进程流程。

1. **修复 R1–R3（HEIC）。** 统一最终格式/元数据，隔离可终止的转换进程，可靠限制真实像素和并发。覆盖正常手机尺寸、损坏、未知/多 ispe、缺失尺寸、deadline/取消、AVIF 不误转和任务清理。可用受控故障注入验证期限与孤儿清理，不生成会危及本机的解压炸弹。将 fixture 生成和来源固定在仓库可复跑入口中。
2. **修复 R4（端点与用户模型）。** 以真实连接读取、UI 保存、实际 Pi 子进程和脱敏回环请求验证：原生 Kimi/Zen/Go 协议分流；显式自定义协议/URL/目录外模型/逐模型上限保留；默认 ID 不被换成目录首项；稳定会话 header 保留，不写回真实用户配置。
3. **完成 Chat Starters。** 按原 CS-01–CS-10 与原规划实施，不引入新的 UI 风格或 competing state。对保存、切工作区、重启、异常输入、mentions/source-ready、safe、取消和键盘交互留真实产物。核验会话信息长列表的 popover/drawer 滚动；仅发现实际缺陷才改。
4. **补足有价值的依赖验收。** 复用现有工作流覆盖 Pi resume/model switch/畸形工具/取消/错误恢复，MCP stdio/HTTP/OAuth 取消/prompts/resources，usage ledger（真实计费调用不漏记、不双记，失败重试按实际 usage 记账而非一律零计费），逐模型输出上限含压缩调用；PDF 正常/加密/表单/损坏/循环树的有界行为；编辑器/IME/Markdown 往返/动态语言与日历。不要用“已通过别的流程”代替要求的具体场景。
5. **修复验证基础设施并完成 Windows 打包。** 先有界定位浏览器桥接失败，补必要的失败清理，保持断言与预算。运行新独立目录的 unpacked/portable，证明 decoder/worker 实际可载入、HEIC 转换以及 Electron/原生模块可运行；不启动安装器、签名或发布。
6. **重新验收与准确交付。** 新工作流登记到 `scripts/critical-scenarios.ts` 等现有体系；更新当前实现记录、机器结果、索引和用户可见变更的 `release-notes/next.md`，保留冻结规划及历史证据。在最终代码/锁上跑原规划所有适用门禁与定向流程，失败不得报完成。报告每项的 done/approved-deferred/failed/environment-limited 状态，并附实际源码、锁、产物哈希。

保持 Phaneris 0.3.2，不提交、不推送、不发布、不全仓更新、不修改全局工具或真实供应商凭据，不删除用户文件、不覆盖已有 release。DSH 编辑期间 Codex 保持只读。

