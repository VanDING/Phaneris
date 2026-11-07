# 2026-11-07 依赖升级：实施前失败矩阵

基线：853756659。用户已授权完整实施 P0/P1/P2 建议、必要兼容修复和验证；保留评估中的 keep/P3 边界。不推送、不发布、不覆盖现有 release，不修改真实账户或安全 allowlist。

| 编号 | 实施前确定的失败模式 | 验证与产物 |
| --- | --- | --- |
| SEC-01 | 跨 realm 自定义敏感头随跨来源重定向泄露；同源正常请求误删头 | 两个回环 HTTP 服务、vm 数组，对照响应与 JSON |
| SEC-02 | OCR 重新走 shell，私有/无缓存/鉴权缓存被 max-stale 复活 | 既有安全 E2E 与执行参数产物；补丁不得移除 |
| PY-01 | Pillow 主版本使图像模式/透明度/EXIF/HEIC 或文档内嵌图退化 | 八个真实 CLI 工具、代表图像/PDF/Office 输出与 hash |
| PY-02 | 损坏/循环/加密 PDF 无界运行或错误被伪装成功 | 既有 document-tools 流程、子进程期限、stdout/stderr |
| PY-03 | uv 使用旧 Python、extras 被遗漏、运行时 pin 不一致 | 解释器实际版本、49 包及新解析树、8 包装器、runtime gate |
| RT-01 | Bun hoisted 改变 peer/patch/源码解析，SQLite 写入或子进程退出回归 | frozen install、patch 源码检查、session foundation 和 critical 流程 |
| NET-01 | Node/Undici 代理、NO_PROXY、取消、重连或动态 MCP 注册失效 | 回环 Undici/MCP 生产流程、Node 版本、JSON 记录 |
| NET-02（45 回归中发现） | 客户端用例在后台 session_created 的 readMessages RPC 尚未结束时主动重连，功能检查完成但产生被取消读取的错误日志 | 从真实 WebSocket request/response id 观测后台读取，在主动故障前等待其完成；记录等待及未结束请求；保持原有断网/重连、数据持久化和零意外错误断言，不增加日志豁免 |
| NET-03（45 回归中发现） | 设置用例只等待磁盘值变化即重启服务，保存请求尚未完成应答便被 Client destroyed 取消；另有一次未捕获具体异常的落盘超时 | 记录真实 RPC 成功/失败、落盘值与 UI 状态，选择操作等待应答完成后才进入下一步；保持原有落盘与重启断言；首次超时原因不确定，不冒称已定位或修复产品缺陷 |
| SDK-01 | Smithy 更新引入不兼容，Pi 四包、OpenAI 两条链混装 | 锁图目标、父范围、Pi/runtime 检查；不全局 override SDK |
| SDK-02 | 新 OpenAI SDK 的 GIF/SVG 响应格式越过内部 PNG/JPEG/WebP 边界；拒绝后丢失付费用量 | 实际 SDK + 回环 Images API；有效 PNG/缺省格式对照、GIF/SVG 拒绝、签名不符拒绝且保留 usage |
| UI-01 | Tiptap/PM/Shiki 混版；IME、撤销、Markdown 往返失真 | Markdown 生产流程、保存前后内容、截图 |
| UI-02 | Radix/Motion/panels/dnd 焦点/尺寸/拖拽/reduced motion 回归 | critical UI/primitive/布局与交互工作流、截图 |
| UI-03 | Gantt/Grid store 混装、虚拟化丢失、受控拖拽循环 | Gantt reschedule/width/planning 流程 |
| UI-04 | i18n 切语言/namespace/locale 失效，PDF API/worker 与日历已知边界被改变 | i18n gates、PDF worker 版本、Calendar 已有兼容测试 |
| UI-05（验收中发现） | 第二窗口在初始路由恢复完成前切换日历，随后回到默认会话，导致事件仍挂载但不可见 | 旧依赖快照复现同一失败；补齐与首窗口相同的 splash/Projects 就绪等待后 20 场景通过，保留原选择器、广播/读取次数、内容和全部性能预算，归档新旧 trace |
| UI-06（验收中发现） | 客户端 E2E 查找旧 Files 按钮；当前快照的 Info 只列会话目录，工作目录文件已属 Files > Browse；初始路由恢复还可能覆盖过早的会话选择 | 使用既有 Open Files Panel 快捷键访问实际工作目录，补齐 splash / Projects 就绪等待；不改文件预览、权限、取消、重连或原生能力边界断言；旧依赖整场复跑另有启动 deadline，不能声称它已复现到同一断言 |
| GATE-01（验收中发现） | 治理模拟仓库缺少当前门禁已要求的 resident-role 纯入口 | 旧依赖复现完全相同的门禁错误；只为夹具创建该入口，保留所有负向边界检查 |
| SDK-03（验收中发现） | 旧 B1 检查仍要求 Pi 1.3.0，且把 TypeBox 归属在旧父包；当前快照已为 Pi 1.5.0 | 旧依赖复现相同错误；精确断言 Pi 1.5.0 及其发布 pin，TypeBox 按当前父包验证；仅 Undici 8.12.3 允许审阅过的 8.12.4 定向覆盖，并检查实际父包解析与无全局覆盖 |
| SDK-04（验收中发现） | 旧计量工作流要求摘要发送 4096 输出 cap，与当前 Pi 1.5 自定义端点策略及 PC-05 的“端点保留默认预算”断言冲突 | 旧依赖在同一行复现；精确断言两个 cap 字段均不出现，保持所有费用、用量、上下文占用、恢复和不重复记账检查 |
| GATE-02（验收中发现） | 旧隔离检查将整个 workspaces 模块 mock 为单个导出，新增消费方导入 assertAssistantMemoryLearning 时链接失败 | 旧依赖复现相同链接错误；遵循现有 partial-mock 模式保留真实导出，只覆盖原有配置读取，3 项原断言通过，无新增单元测试或豁免 |
| GATE-03（验收中发现） | 两份旧 RPC 注册覆盖清单没有纳入当前快照已注册的 assistant-memory / resident-assistant 模块 | 旧依赖复现相同 unexpected channels；补齐显式的模块清单，继续精确检查通道覆盖、GUI/core 分层和只注册一次；两个隔离文件原有检查通过 |
| BUILD-01 | Vite/Babel/Tailwind/ESLint 插件规则、源码映射、资产或三路前端产物退化 | validate:ci；renderer/webui/viewer 与两个 worker 构建 |
| DESKTOP-01 | Electron pin/ABI/native 库或打包资源不匹配 | Windows 独立 unpacked、smoke、打包版本与文件 hash；其他平台单列未验证 |
| D45-01（用户追加 Electron 45 前） | 45 移除沙箱 preload 的 Node shims / Buffer / immediate 全局，桥接可能启动失败 | 逐 preload 核对源码、构建产物和实际 sandbox 配置；实际 Electron 45 主窗口、工具栏与 RPC；不通过放宽 sandbox / contextIsolation 修复 |
| D45-02（用户追加 Electron 45 前） | 窗口 opener / 屏幕权限 / 原生 EventEmitter 语义变化，原生模块 ABI 或窗口重开退化 | Electron 45 浏览器宿主、附件/PTY 和独立 unpacked 生命周期；保留现有权限拒绝策略，核对实际运行时版本 |
| D45-03（用户追加 Electron 45 前） | ASAR 文件描述符和 tracing 格式变化影响应用或传递库 | 核对 ASAR 配置及直接/传递调用；类型与构建、原生运行证据；未触达的配置标明范围 |
| DESKTOP-02（44 基线打包中发现） | 新助手展开界面会隐藏已挂载的 sidebar，旧重开工作流用 sidebar 可见性判断启动完成而超时 | 改用始终可见的现有 topbar、splash 结束及实际 RPC 连接就绪；保留原生窗口可见、第二实例、退出/重开/锁释放和 Gantt 全部断言；先在同一 44 unpacked 上复跑，再验 45 |
| CI-01 | Actions 升级与 runner/参数不兼容；镜像运行时遗漏 | 官方迁移说明、完整 SHA、工作流校验；本机无容器时不伪称 Linux 已验 |

结果逐项记录 passed/failed/environment-limited/not-run；解析成功不等于运行成功，失败不能用增加基线或弱化断言解决。复用已有测试；新增隔离验证须先按上表写明失败模式再实现，不在产品实现后补单元测试。
