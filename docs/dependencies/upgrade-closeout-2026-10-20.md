# 上游 0.15.3 升级收口：2026-10-20

**当前交付位置已按用户选择隔离**：`C:\Users\dotty\.codex\worktrees\upstream-0153-closeout\Phaneris`，分支 `codex/upstream-0153-closeout-isolated-20261020`。最终源码、独立门禁和机器结果在该工作树；本共享工作树中的记录保留为前期历史，不代表并行设计/字体迁移已验收。本轮未回滚或覆盖并行任务的修改。

状态：产品修复与定向验收已实施，最终门禁由本文末尾的自动采集段与机器结果给出。执行者为 Codex；用户明确要求本轮不交 DSH。新增改动保持未提交。

原始[冻结规划](upgrade-plan-2026-10-18.md)与[第二轮复核](../verification/upgrade-2026-10-19-review-2.md)保持历史。当前执行基线是 `ac85d33b0ed08cd36e274ac3dcbbf5d18189438b`（升级主体 `d0fb6be7b`，另含已提交的 Pi 中断恢复）；开始时工作树干净。保留两笔提交，新增改动保持未提交。

## 执行与验收

先将失败路径写入[失败矩阵 §12](../verification/upgrade-2026-10-18-failure-matrix.md)，再串行实施。复杂行为以生产组件、真实 RPC/子进程和可复跑产物验收；不在实现后新增单元测试。

| 顺序 | 修改与验收 |
| --- | --- |
| 1 | HEIC：真实空/错误 MIME 的 renderer 入口、服务端 bytes 识别、最终 type/name/MIME/size/bytes 统一；转码失败保留草稿且不悄悄丢图发送；worker 超时只产生一次确定结果；ipma 四种组合进入正式工作流。 |
| 2 | Chat Starters：复用 RichTextInput 与现有 mentions；首次读取/失败期间不覆盖已有设置；StrictMode、取消、工作区同步归属及迟到响应隔离；修 CSW-01 空转。 |
| 3 | 模型表单：目录请求与 provider 绑定，加载/失败时不能提交旧目录；乱序响应丢弃；真正目录外模型夹具，按字段意图保存，保留自定义协议和模型。 |
| 4 | 主题/验证基础设施：按已在基线存在的 ring 契约修复过期 outline 断言，保留 115 场景、native/forced-colors outline 检查；production build 有界并清理子进程；server 环境限制仅匹配确切的平台拒绝。 |
| 5 | 补足账本同一轮多调用、恢复/分支归属、warming 独立及汇总；Pi resume 工具、切模型思考隔离；Go 旧默认/自定义 headers 与直接 undici 的流/代理/取消；复用已有生产工作流，缺断言才补。 |
| 6 | 编辑/日历撤销重做、列表/粘贴上传、时区/DST；PDF 实际渲染与释放、Python 代表任务；Windows 真实 renderer/main/preload 附件 RPC、nativeImage、窗口重开/深链接。真实 unpacked 从仓库外运行，不以 ELECTRON_RUN_AS_NODE 模块烟测替代。 |
| 7 | 最终源码冻结后运行原规划适用门禁与完整 critical；自动生成结果并修正文档矛盾、Git 元数据、传递 churn 说明，记录准确的通过/延期/失败/环境限制。 |

共享控件当前焦点是 1.5px accent ring 加 surface spacer，native/forced-colors 使用 2px outline。断言检验实际绘制的非透明焦点层及缩放，不能接受任意 box-shadow，也不为了通过测试改产品视觉。批准这项测试契约修正，无需另行等待用户确认。

## 范围

FullCalendar 7.1.0、http-cache-semantics 加固补丁、压缩阈值延期及 P-01/U-01/D-01 延期继续有效。不会仅凭空内容和零 token 改账本计费语义。macOS/Linux、容器和签名缺少可用环境时如实列未验证；不安装新的全局工具或虚拟化环境。冻结依赖目标不追新版本。

本轮不提交、推送、改版本或发布；不覆盖现有 release，不触碰真实用户配置、凭据、原始图片或用户主题。原生测试使用独立输出目录、临时配置与回环服务。新增工作流登记到现有 registry，保留全部失败产物和原门禁预算。

## 实施内容与边界

| 范围 | 本轮交付 |
| --- | --- |
| HEIC/草稿 | 服务端按 bytes 提升 unknown 类型并统一最终 type/name/MIME/size/bytes；附件失败不发送；提交确认后只消费原快照，保留后来输入。独立 Uint8Array 修复 Electron 对池化 Buffer transfer 的拒绝；期限回调不被 worker exit 抢先。四种 ipma 格式均用真实解码验证。 |
| Chat Starters | 复用 RichTextInput 与 mentions；读取挂起/失败时不能覆盖设置，失败可重试；整个编辑器以 workspace 为 key，隔离草稿和迟到写；StrictMode、Escape 取消、迟到源启用及工作区切换均有浏览器断言。 |
| 模型表单 | 目录与 provider/request 身份绑定；目录加载、失败和乱序时不提交旧值；目录外 ID 夹具真实，按字段意图保存，不因只改默认模型覆盖原模型列表。 |
| 编辑器/PDF | 文件处理器读取当前 editor.isEditable，修复产物编辑器由只读初始化转可编辑后不能粘贴图片；撤销/重做、列表转换、HTML 与图片粘贴实际操作。PDFium 文档在所有退出路径关闭，bitmap 复制后关闭；连续 9 次 CLI 回调核对全部原生句柄。 |
| 运行时/账本 | 同一轮工具循环、独立 warming、进程重启续接和 SDK fork 逐行核对 SQLite 与汇总；切模型前实际输出 thinking，再检验 B 请求不带旧思考；OpenCode/Go header 和旧地址边界、直接 undici 的流/CONNECT/取消与清理。 |
| 桌面/验证 | 原 115 项主题场景保留，普通 ring 与 forced-colors outline 分别验证；独立 Node 夹具构建解除 Vite 同进程死锁，production build 有期限。真正 Electron 与仓库外 unpacked 执行附件 RPC、nativeImage、ConPTY、窗口重开和第二实例深链接。原生工作流单独登记，不要求无桌面环境的 Linux browser CI 启动 Electron。 |

恢复执行时工作树已有另外一轮前端 W1 样式改动；它们完整保留，不归为本轮升级成果。最终门禁针对当前合并工作树，执行中若源码改变即判该门禁失败。设计检测仅有 ChatDisplay 既有搜索高亮颜色的 advisory，不为消除提示改配色。

合并验收补齐协议/鉴权切换、折叠输入展开及两处图标按钮的交互角色类，以满足现行 lint；未新增债务豁免、未降低既有阈值。

`koffi` 不在冻结锁图且未安装；实际执行发布暂存函数并记录这一事实，不补装无消费点的库。`sharp` 的生产消费方是 headless 平台，桌面 nativeImage 走另外的实际验收；headless 产物在 Windows 上仍属环境受限。签名安装器、其他平台、容器与真实供应商账户继续未验证，不写成绿色。

打包复核将整个 unpacked 目录复制到仓库之外，再以独立配置和仓库外 cwd 启动，以排除从开发仓库祖先 node_modules 补足依赖。首次最终采集在此验收加严前中止，日志保留在 `.cache/upgrade-20261018/closeout-final-gates.log`；不作为完整或绿色验收。

严格打包验收 `upgrade-0153-packaged-zdiZ7P` 已通过 4 项，嵌套原生附件 7 项及窗口重开 6 项，整个应用位于系统临时目录，并核对当前 main/preload/Pi 构建哈希。主题独立运行 `theme-foundation-9L6qgK` 完成 115 项，114 项通过，唯一失败为 TF12 键盘焦点竞争；保留该失败。对同一构建的 24 次浏览器对照中，立即 Enter 的 12 次仅 2 次选中第二项，等待真实焦点后 12 次全部正确。工作流据此等待 Radix 已完成的焦点移动，仍只按一次 ArrowDown，并保留最终选中、模式切换及 Escape 恢复断言。

夹具失败清理补齐 await 与二次有界 reap；真实 Node/Vite 构建的 5 秒期限探针观察到子进程 PID 860，在错误返回前子进程已退出（含进程枚举耗时共 7104 ms）。原始对照与清理记录分别在 `.cache/upgrade-20261018/theme-select-probe.json`、`fixture-cleanup-probe.json`。修复后的完整主题断言随最终 critical 重跑，不将上面的 114 项写作最终通过。

另补 `upgrade-0153-document-tools-workflow.ts`，通过随包 uv 和 Python 3.12.15 对八个工具执行创建、转换、读回任务，逐命令保留 argv、stdout、未过滤 stderr、退出码、脚本及文件哈希。产物包括 DOCX/XLSX/PPTX、JPEG/PDF、ICS、文本差异和 Markdown；原有 test:doc-tools 继续运行，新工作流解决其临时文件清理后的证据留存缺口。第二次采集在补足此项前中止，原日志 `closeout-final-gates-attempt2.log` 不作最终验收；最终完整采集共 32 项门禁。

第三次采集的 validate:ci 在 check:docs 因 W1 结果目录两处 README 链接失效而失败；前面的类型、lint、24 项 Python、表格及 i18n 测试均通过。两处链接改指该目录现有 manifest.json，保留 W1 内容与结果。中止此次采集并留存 `closeout-final-gates-attempt3.log`，重新从头执行完整门禁，不将这次失败覆盖成通过。

第四次采集在验证新增文档工作流的 POSIX wrapper 分支前停止（`closeout-final-gates-attempt4.log`）；该分支保留真实 shell wrapper 调用，Windows 保留现有 harness 的 uv 直调方式，均从 wrapper 读取产品 Python 固定值。其他操作系统仍没有本机执行证据。

第五次采集中 install、validate:ci、audit 均通过，critical 前 35 项通过且 theme-foundation 为 115/115；随后 theme-contract 在 Vite dev 预优化卡顿。独立 Node dev 对照也在 120 秒导航期限失败，不能笼统归因于 Bun。日志 `closeout-final-gates-attempt5.log`、`theme-contract-stall.*`、`theme-contract-node-probe.json` 保留，本次未完成采集不算验收通过。theme-contract 迁移到已有独立构建/静态托管，仍编译四个真实 CSS 入口，保留 ThemeProvider、Viewer、P2 和全部原断言。

迁移后 theme-contract 已 119/119；共享 roles 夹具的 roles/domains/design，以及 browser-host/login 五条流程也全部独立通过。保留三个宿主的真实 CSS 和原 @source，login 直接构建生产 HTML/CSS；类型与定向 ESLint 通过。完整 critical 与其余门禁随后在此源码上重新采集，独立通过记录不替代完整套件。

第六次采集中 install、validate:ci、audit 通过；critical 的前 44 项（含全部主题）通过后，遇到两个原登记生成器不输出统一验证 manifest 的问题，失败原文在 `critical-DGRiTk/failure.json`，总日志 `closeout-final-gates-attempt6.log`。补两个薄工作流封装，实际在独占目录重建并校验九个图像/五个 PDF 的集合、格式、大小、哈希及发布缓存的一致性；保留原生成器数据 manifest，registry 的 minimum 从 0 提至 1，不跳过统一产物验证。两项独立执行均已通过。

补封装后，针对此前未到达部分的诊断运行 `critical-closeout-tail-VgBwUY` 已通过全部 20 个尾段工作流及 6 个包级测试组。此诊断明确不替代完整 critical；最终完整采集仍从头运行 64 个工作流与 6 个包级组，原 3600 秒 critical 预算不变。
