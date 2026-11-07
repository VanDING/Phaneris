# Phaneris 全量依赖与升级价值评估

评估日期：2026-11-07，Asia/Shanghai。源码 HEAD：`ecba907a8d9d2c38a05687d07c93c5a77226ed5e`，项目版本 0.6.2。

本次以当前未提交工作区的 manifest 和锁文件为准。只新增评估文档与证据；未修改依赖、锁文件、补丁、安全基线或已有产品代码。下面的目标是升级建议，不代表兼容性验收已经通过。

## 1. 结论与优先级

**值得升级，但第一批应围绕安全和运行时稳定性，不建议全仓追 latest。** 最大缺口在 Python 图像/PDF 工具，以及新披露的重定向问题。Pi 内核已经在最新稳定版，无需再做一次内核升级。

| 批次 | 依赖 | 当前 → 建议目标 | 价值与条件 |
| --- | --- | --- | --- |
| P0，优先处理 | Pillow | 12.3.0 → **13.0.0** | 本次 OSV 命中 41 个不同 GHSA，包括 5 CRITICAL、23 HIGH、13 MODERATE；13.0.0 无本次查询命中。虽跨主版本，安全收益足以支持独立迁移 |
| P0，优先处理 | pypdf | 6.21.1 → **6.21.4** | 当前命中 10 个 HIGH GHSA；同系列修复目标已发布，不必先跨到刚发布的 7.0.0 |
| P0，优先处理 | follow-redirects | 1.16.1 → **1.16.2** | 新 HIGH 命中且已使仓库安全门禁失败；修改精确 override，验证自定义敏感头与跨来源重定向 |
| P1 | Electron | 44.9.1 → **44.10.2** | 在现有主版本内吸收 Chromium、Node 和崩溃修复；同步 builder pin，执行原生与打包验收 |
| P1 | Bun / 类型 | 1.4.3 → **1.4.4** | WebSocket、SQLite、Windows、hoisted 安装和 patch 应用修复与本项目直接相关；统一 CI、Docker、捆绑运行时及类型 |
| P1 | uv / 产品 Python | 0.13.1 / 3.12.15 → **0.13.7 / 3.12.16** | Windows 句柄修复与 Python 安全更新；先更新 uv，再验证解释器可发现、安装和实际启动 |
| P1 | Node 开发环境 | 本机 24.15.0 → **24.22.2** | 与当前 Electron/WhatsApp worker 的 Node 24 系列对齐；容器必须另行重建采样 |
| P1 | undici | 8.12.2，另有 8.12.3 → **8.12.4** | 官方列出六项安全修复，本次 npm audit 尚未列出；优先维护代理链路，不推定项目已启用有问题的缓存组合 |
| P1 | @smithy/core，传递项 | 3.33.3 → **3.39.0** | 旧版因自定义 logger 脱敏缺陷被发布者弃用；当前父范围允许定向解锁，不需要升级 Pi 四包 |
| P1 | MCP SDK / jose | 1.32.1 → **1.32.2**；6.2.12 → **6.2.15** | 动态注册、Transport 类型及认证处理维护；在实际连接与认证流程中验收 |
| P1，单独迁移 | glob | 13.0.6 → **14.0.4** | 当前 AbortSignal 公告修复线为 14.0.2；13.0.7 仍落在公告范围，且保留 minimatch 10；只升级自己控制的链路 |
| P2 | 编辑器、UI、构建与消息 SDK | 按族维护，见第 4 节 | 存在维护收益，但多数没有足以进入首批的已证实产品问题 |
| 保留 / P3 | 精确兼容例外与大版本迁移 | 见第 5 节 | 保留 PDF worker、FullCalendar、Sentry core 等边界；不通过全局 override 强迫所有父包接受新主版本 |

P0/P1 是实施顺序判断，不是对漏洞实际利用程度的断言。安全数据库的严重性不等同于项目的可达性；本次未进行攻击利用验证。

## 2. 覆盖口径与完整清单

| 范围 | 覆盖结果 |
| --- | --- |
| JS manifest | 根 + 13 个 workspace，共 **14 份** |
| 外部直接声明 | **175 个唯一包名**，含 dependencies、dev、optional 和 peer |
| 直接控制项 | 加入仅 override / patch 控制项后共 **184 项**；其中 **87 项有更高非弃用稳定版** |
| JS 锁依赖 | **1,477 个外部包名、1,830 条实例**；其中 1,475 个 npm 包名、1 个 Git、1 个 CDN 来源 |
| 内部包 | 13 个 @phaneris workspace，按项目版本与发布策略管理，不查询公共 registry 来决定版本 |
| Python | **8 个 PEP 723 工具脚本、13 个唯一直接包**；包含 markitdown 的 pdf/pptx/docx/xlsx extras |
| Python 传递依赖 | 当前 pins 在 Windows x64 / CPython 3.12.15 下重新解析的 **49 包并集**，逐包查 PyPI 并查询 OSV |
| 环境与分发 | Bun、uv、Python、Node、Docker 基础镜像、4 个 Actions、9 个 APT 项及可选/原生构建工具，逐项保留采样边界 |

“有新版本”按直接控制项当前顶层锁版本比较，**不会因为 date-fns 3、Babel 7 等旧传递副本仍存在，就误判顶层直接依赖未升级**。latestStable 排除预发行和发布者已弃用版本；dist-tag、声明内最高版本、同主版本最高版本另列。0.x 的同主版本数字不代表兼容，仍以声明范围和实际 API 为准。

完整数据均在同名目录：

- [184 项直接控制清单](dependency-audit-2026-11-07/direct-controls.csv)：当前版本、所有声明位置、官方稳定版本、建议目标、优先级、理由与风险。
- [全部外部锁包](dependency-audit-2026-11-07/locked-packages.csv)与[1,830 条锁实例](dependency-audit-2026-11-07/lock-instances.csv)：保留旧副本、父依赖约束、弃用信息及来源。
- [逐声明记录](dependency-audit-2026-11-07/declarations.csv)、[Python 直接包](dependency-audit-2026-11-07/python-direct.csv)、[Python 解析并集](dependency-audit-2026-11-07/python-resolved.csv)、[环境项](dependency-audit-2026-11-07/environment.csv)。
- [汇总](dependency-audit-2026-11-07/summary.json)、[源码与 manifest 指纹](dependency-audit-2026-11-07/baseline.json)、[证据文件校验](dependency-audit-2026-11-07/evidence.json)。

所有 npm 锁包均查询官方 registry；重点候选另看官方发行说明。**没有逐篇阅读所有传递包的 changelog，也没有证明所有旧副本都可删除。**

## 3. 安全结果与升级价值

### 3.1 npm 安全门禁目前失败

本次真实运行 `bun audit --registry https://registry.npmjs.org`，再由仓库已有脚本读取原始输出。结果为 **6 条公告：1 CRITICAL、1 HIGH、3 MODERATE、1 LOW**。仓库门禁明确因新增 `GHSA-mrwp-f3q8-3g9p` 失败。未扩大 allowlist。

| 包 / 公告 | 观察与判断 | 建议 |
| --- | --- | --- |
| follow-redirects / GHSA-mrwp-f3q8-3g9p，HIGH | 1.16.0–1.16.1 处理来自另一 JS realm 的 sensitiveHeaders 数组有问题，可能把自定义凭据带往跨来源重定向目标；本项目全局 override 精确固定 1.16.1 | 改为 1.16.2，并验收鉴权头/代理/重定向 |
| node-tesseract-ocr / GHSA-8j44-735h-w4w2，CRITICAL | 官方仍只有 2.2.1；仓库 patch 改为 execFile，本机安装源码也包含 execFile。版本扫描仍命中不代表修补失效 | 保留补丁；本次只核对静态存在，未重跑 OCR E2E |
| glob / GHSA-3g3m-2fjr-6pw4，MODERATE | 受影响范围 >=9.0.0 <=14.0.1。当前生产调用为固定模式 globSync，未传 AbortSignal；并非已证实触发公告中的异步取消路径 | 自有 glob 升 14.0.4，验目录、排除和 Windows 路径；旧 7.x 构建分支随父包治理 |
| minimatch / GHSA-g3hv-75wg-m249，MODERATE | 修复线 11.0.1；旧 10.2.6、10.2.5、9.0.9 在范围内。Pi 1.5.0 精确使用 11.0.3，已过修复线 | 不需要为此换 Pi；优先更新 glob / ESLint / builder 相应父链，不全局强推 11 |
| postcss-selector-parser / GHSA-rj75-hqrm-r3gf，MODERATE | typography 0.5.20 精确依赖 6.0.10。现在已有 **6.1.5 回补**，不再必须跨到 7.x；当前为可信源码构建路径 | 定向处理精确父约束，保留 CSS 构建回归；优先级低于运行时文件解析 |
| KaTeX / GHSA-238p-pmpm-9mq7，LOW | 直接 0.18.10 不在范围；Mermaid/remark/rehype 链的 0.16.47 在范围 | 由对应父包迁移；把直接 KaTeX 升 0.19.1 不会自动去掉旧副本 |

依据：[follow-redirects 公告](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)、[glob 公告](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)、[minimatch 公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)、[PostCSS 公告](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)。原始扫描见 [bun-audit.txt](dependency-audit-2026-11-07/bun-audit.txt)。

### 3.2 Python 图像与 PDF 是首批重点

49 个解析版本的 OSV 批量查询，仅 Pillow 与 pypdf 有命中。Pillow 返回的 GHSA 与 PYSEC 别名没有重复计算；按不同 GHSA 统计为 **41 + 10**。上述严重性来自数据库字段，部分与发行说明的等级表述不同，完整记录保留在 [python-advisories.json](dependency-audit-2026-11-07/python-advisories.json)。

- **Pillow 13.0.0 值得跨主版本升级。** 官方列出图像原生解码、TIFF 编码、内存和资源消耗问题；本项目图像、文档、PDF、表格工具均会间接或直接使用 Pillow。迁移应覆盖 JPEG/PNG/GIF/TIFF/HEIC、透明度、EXIF、缩放以及文档内嵌图；注意 I 模式 PNG 和 fromarray 参数等兼容变化。[官方说明](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html)
- **pypdf 先到 6.21.4。** 6.21.2–6.21.4 连续限制 xref、页树和错误处理的工作量，并修复循环；这个同系列目标已消除本次 10 个命中。7.0.0 在 11-06 新发布，另有安全加固和弃用清理，后续单独验证，不把它与 6 系列补丁混为零成本维护。[官方 changelog](https://pypdf.readthedocs.io/en/stable/meta/CHANGELOG.html)

Pillow 13.0.0、pypdf 6.21.4 / 7.0.0 的目标 OSV 查询均无命中；这是数据库快照，不是“无漏洞”证明。[目标查询](dependency-audit-2026-11-07/python-target-security.json)

仅替换 Pillow / pypdf 目标后的完整 extras 并集可被现有 uv 解析，**没有安装这些目标，也未运行升级后的工具**。请求 Python 3.12.16 时，旧 uv 0.13.1 明确警告使用 3.12.15 构建依赖，不能将此结果写成 3.12.16 已验证。[解析日志](dependency-audit-2026-11-07/python-target-resolve.log)

### 3.3 audit 之外仍有真实维护价值

| 包 | 事实 | 项目适用性 |
| --- | --- | --- |
| undici 8.12.4 | 官方发行说明列出六项安全修复，包括缓存重定向、敏感头、错误传播与 SRI | 项目以 Agent/ProxyAgent 设置全局 dispatcher；源码未发现 cache/redirect interceptor 组合。建议升级，但不声称六条漏洞均可在当前产品触发；更新 npm 直依赖也不等于更新 Node 内置实现 |
| @smithy/core 3.39.0 | 3.33.3 被弃用；官方说明自定义 logger 对列表/map 内敏感数据脱敏有缺陷，修复线 >=3.38.1 | 当前读到的父范围均允许 3.39.0，可定向解锁。未证实本项目配置了会输出这些事件的自定义 AWS logger，因此不声称发生泄漏 |
| jose 6.2.15 | 修复解压超限取消、负数缓存时长和 clockTolerance | JWT/JWKS/认证维护有价值；未用到的 JWE 路径不算已确认暴露 |

依据：[Undici 8.12.4](https://github.com/nodejs/undici/releases/tag/v8.12.4)、[AWS 官方问题](https://github.com/aws/aws-sdk-js-v3/issues/8393)、[jose 6.2.15](https://github.com/panva/jose/releases/tag/v6.2.15)。本次 `bun audit` 未列出 Undici 的新修复，不能把扫描无命中当作忽略发行说明的理由。

## 4. 后续值得做的维护批次

| 依赖族 | 建议目标 | 判断与必要条件 |
| --- | --- | --- |
| Tiptap | 13 个直接包统一 3.33.0，当前 3.32.0 | core/pm 精确 pin 与扩展同步；IME、撤销重做、Markdown 往返、粘贴和文件处理 |
| ProseMirror | transform 1.12.5、view 1.42.9 | 随编辑器；model 1.25.12、state 1.4.4 当前已最新 |
| Shiki | shiki / @shikijs/transformers 统一 4.6.0 | 同步修改 transformers override，核对大代码块与生产高亮 |
| Radix | 13 组件的稳定目标见逐项表 | 适合 UI 维护批次；不是每个新版本都有本次证明的可见收益，必须回归焦点、portal、菜单、键盘 |
| Gantt / Grid | 2.8.2 / 2.7.6 | Gantt 新版精确使用 Grid 2.7.6；两者和相关 store 配套，检查虚拟化、拖拽、滚动和受控状态 |
| TanStack Table | react-table / table-core 统一 9.3.1 | 当前 9.2.4；两包一起验排序、选择、列宽与虚拟化 |
| Motion / panels / dnd | 14.10.1 / 4.19.1 / @dnd-kit/dom 0.5.3 | 当前 14.0.0 / 4.14.2 / 0.5.0；单独交互批次，不与安全维护绑成大变更 |
| i18n | i18next 26.7.2、react-i18next 17.1.13、检测器 8.3.0 | 当前 26.4.7 / 17.0.20 / 8.2.1 为有意固定；单独验切语言、namespace、持久化及 locale 门禁 |
| Sentry Electron | 7.20.2 | 7 系列回补事件处理与 utility listener 修复，仍用 core 10.75.0；保持 React SDK 10.75.0 配对 |
| React / react-dom | 统一 19.3.1 | 当前 19.3.0；没有证据显示本客户端必须立即采用，可随 UI 批次 |
| Vite / React 插件 | 8.3.6 / 6.2.1 | 三路前端及生产资源解析验收 |
| Tailwind | tailwindcss / @tailwindcss/vite 统一 4.3.5 | 当前 4.3.3；核布局、主题、产物，typography 仍需单独处理传递约束 |
| Babel / ESLint | core 8.1.0 / ESLint 10.14.0 | parser 与 presets 不按 core 版本硬拉；运行规则和插件门禁，不扩 warning 基线 |
| 桌面分发工具 | electron-builder 26.18.1 / updater 6.8.12 | 当前 26.17.0 / 6.8.10；原生重建、文件布局、签名配置和更新通道需验收 |
| Playwright / axe | 1.65.0 / 4.14.0 | 当前 1.64.1 / 4.13.0；同步浏览器产物与 Electron 驱动，检查新规则而非放宽断言 |
| 消息 / HTTP 辅助 | Lark 1.76.0、ws 8.22.1 | 当前 1.74.0 / 8.22.0；消息收发、断线恢复、代理与关闭语义 |
| 其他小型维护 | marked 18.1.3、node-html-parser 9.0.7、turndown 7.2.5、semver 7.8.6 等 | 按具体调用入口机会性维护；完整目标见直接控制清单 |
| Python 维护 | pypdfium2 5.15.0、markitdown 0.1.9、click 8.5.1 | 保留 extras；执行真实文件转换与 CLI 退出行为，不与安全修复合并成 Python 大换代 |

OpenAI 直接 SDK 7.27.0 可在后续入口维护中评估 7.53.0；Pi 的传递 7.19.0 由 Pi 自身控制，不全局 override 两条链。新 API 可用不代表当前业务需要采用。

## 5. 应保持的依赖与迁移边界

| 项目 | 当前判断 | 原因 |
| --- | --- | --- |
| Pi 四包 | **保持 1.5.0 精确同版** | 当前已是稳定最新版；1.5.0 的校验与流式变更已有专项实施记录 |
| TypeScript / esbuild / Sharp / Zod / Jotai | **保持 7.0.2 / 0.28.2 / 0.35.5 / 4.6.7 / 3.0.1** | 当前已是各自稳定最新版；Sharp 平台包和 libvips 继续同族控制 |
| react-pdf / pdfjs-dist | **保持 11.0.0 / 6.3.289** | react-pdf 精确依赖 6.3.289，三个生产入口从顶层导入 worker；单升 PDF.js 6.5.438 会产生版本错配风险 |
| FullCalendar | **保持 7.1.0，7.1.4 另行验收** | 10 月已接受 7.1.3 的 gridcell/拖拽兼容例外；当前源码仍用相同 gridcell DOM。新版本还要求 Temporal >=1.0.7，不能只改 react 包 |
| Sentry React | **保持 10.75.0 配对** | 10.78.0 会带 core 10.78.0，而 Electron 7.20.2 仍精确带 10.75.0；同主版本并不自动保证单 core |
| Sentry 跨主版本 | 暂缓 Electron 8.3.0 / React 11.11.0 / Vite plugin 11.11.0 | 三个 latest 本身也不是同一个 core 版本：Electron 8.3.0 带 11.8.0；需整体设计与验收 |
| MCP v2 | **值得规划，单独迁移** | 先更新 v1 补丁；v2 为 client/server 等新包并支持 2026-07-28 协议。官方承诺 v1 自 2026-07-27 起至少维护六个月，应在该窗口内评估，不把至少期限误写成已确定停止维护日 |
| @open-file-viewer/core | 暂缓 0.1.49 → 1.0.0 | 多格式、CAD、PDF peer、体积和离线行为都需要迁移验收 |
| Baileys | 保持 6.7.24 | latest tag 是 7.0.0-rc14，仍是预发布 |
| SheetJS | 保持官方 CDN 0.20.3 | 官方安装页仍指向此版本，npm 0.18.5 不是更新目标 |
| libsignal | 保持 Git SHA bcea72d | 本次通过 SSH 查询远端 HEAD 为 bcea72df9ec34d9d9140ab30619cf479c7c144c7，与锁一致 |
| KaTeX / uuid / markdown-it / ExifTool / Croner / dateutil | 大版本后续评估 | 分别有 0.19.1 / 14.0.3 / 15.0.3 / 39.2.0 / 11.0.0 / 4.0.0；当前没有足够理由强行跨所有父约束迁移 |
| 三个有效 patch | **保留** | OCR execFile、http-cache-semantics 4.3.0 私有缓存加固、markitdown-js SheetJS buffer 读取各有独立理由，不能因版本已更新就删除 |

依据：[Pi 最新发行](https://github.com/earendil-works/pi/releases/tag/v1.5.0)、[MCP v1 维护声明](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/README.md)、[Sentry v7 回补](https://github.com/getsentry/sentry-electron/releases/tag/7.20.2)、[SheetJS 官方分发](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)。

FullCalendar 与缓存补丁的既有裁定见 [10-19 复核](../verification/upgrade-2026-10-19-review.md)，后续收口见 [10-20 记录](upgrade-followup-2026-10-20.md)。这些是有证据的兼容边界，不是遗漏升级。

## 6. 环境与传递依赖的额外判断

- **Electron 先维护 44。** 44.10.2 带 Chromium 152.0.7977.169、Node 24.22.2；最新 45.2.3 值得后续评估，但现有 44 仍有维护，不需要为了新主版本扩大首批范围。[官方版本](https://releases.electronjs.org/release/v44.10.2)
- **Bun 1.4.4 的价值高于普通补丁号。** 官方说明覆盖本项目使用的 SQLite、WebSocket、Windows 和 hoisted 安装；它也会改变补丁应用与错误报告行为，必须在隔离目录做 frozen install 和关键工作流，不能原地安装打断当前开发。[官方说明](https://bun.com/blog/bun-v1.4.4)
- **Python 保持 3.12，更新补丁。** 3.12.16 是安全发布；独立构建分发已列出 3.12.16 产物，但旧 uv 本次未识别它。先验证新版 uv，再同步 resolver 常量及八个包装入口。[Python 官方](https://www.python.org/downloads/release/python-31216/)、[uv 0.13.7](https://github.com/astral-sh/uv/releases/tag/0.13.7)
- **Node 26 已进入 LTS。** 不能沿用 10 月中旬“26 仍是 Current”的旧判断；本项目当前与 Electron 内嵌 Node 24、worker target24、类型 24 对齐，因此仍先维护 24.22.2。26.13.0 可作为独立迁移选择。[官方状态](https://nodejs.org/en/about/previous-releases)
- **Actions**：checkout 7.0.1、setup-bun 2.2.0 可保持；setup-uv 10.2.0 → 10.3.3 有下载稳定性和缓存修复收益；upload-artifact 6.0.0 → 7.0.2 需检查跨主版本 runner/协议条件。继续固定完整 commit SHA。[setup-uv](https://github.com/astral-sh/setup-uv/releases/tag/v10.3.3)、[upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.2)
- **旧传递分支**：boolean、fluent-ffmpeg、inflight、lodash.isequal、node-domexception、旧 glob/rimraf，以及迁往新包的 OpenTelemetry 分支已有弃用信息。应由父包替换或升级，不凭顶层安装一个新版本就宣称清除旧副本。
- **容器与系统工具**：Dockerfile 显式 APT 依赖已盘点，但本机无 Docker 实测，未重新采样 Debian 候选、镜像 digest 或完整 OS SBOM；不能把 10 月容器快照当成今天结果。Windows C++/SDK servicing、NSIS/signing 工具与可选 RTK/Tesseract 的本机版本也不虚构。

## 7. 建议执行顺序与验收边界

1. **安全批次 A**：follow-redirects 1.16.2；Pillow 13.0.0；pypdf 6.21.4。三个改动分开记录，先列真实失败路径再实施；不扩大安全基线。
2. **运行时批次 B**：uv 0.13.7 + Python 3.12.16；Bun 1.4.4；Electron 44.10.2 与开发 Node 24.22.2。相互有关联但各自留独立验收与回滚点。
3. **网络/协议批次 C**：undici、jose、MCP v1 补丁；Smithy 定向解锁。随后独立处理 glob 14 与剩余中等级父链。
4. **功能维护批次 D**：编辑器、UI、Gantt/Grid、i18n、消息 SDK、构建工具按族串行推进。
5. **迁移批次 E**：MCP v2、Electron 45、Sentry 11、文件预览器 1.0 等有明确产品目标时再实施；PDF worker 与 FullCalendar 必须先解决现有兼容边界。

| 批次 | 主要验收 | 可复用入口 / 产物 |
| --- | --- | --- |
| 文件安全 | 正常/损坏/加密/循环 PDF，有界失败；多图像格式、EXIF、透明度和 HEIC；重定向不泄露自定义凭据 | `verify-dependency-upgrade-security.cjs`、`upgrade-0153-document-tools-workflow.ts`；代表文件、日志、输出 hash |
| Bun/Python | 干净 frozen install、patch 实际生效、49 包 extras 重新解析；SQLite、子进程、8 个工具实际启动；解释器版本精确匹配 | 独立目录与版本清单；现有 runtime 工作流；不把解析成功算作执行成功 |
| 桌面 | Electron 与 builder pin 一致、node-pty/koffi/Sharp、窗口/代理/附件/隐藏窗口及打包运行 | Windows 独立 unpacked 产物；macOS/Linux 另列 CI 证据 |
| 网络/MCP | HTTP/代理/NO_PROXY/取消/重连，MCP stdio/HTTP/OAuth/动态工具；AWS 不输出不应出现的敏感日志 | `upgrade-0153-undici-workflow.ts`、`upgrade-0153-mcp-workflow.ts`；脱敏回环请求与进程证据 |
| 编辑与 UI | IME/Markdown 往返、焦点键盘、生产 worker 版本、日历/Gantt 拖拽、滚动虚拟化与语言切换 | 现有 Markdown、calendar、gantt 工作流；截图及保存前后内容对照 |

本次只运行了只读审计、版本查询和依赖解析，**没有运行升级候选的 E2E、全量 typecheck/build 或三平台打包**。因此当前能确认“值得升级及约束条件”，不能确认“这些目标已在 Phaneris 全部兼容”。manifest 与锁文件在评估结束时再次比对，指纹无漂移。
