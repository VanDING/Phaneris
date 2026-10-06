# Phaneris 全量依赖版本与升级评估

审计日期：2026-10-03（Asia/Shanghai）  
仓库基准：`main`，`029b3b9cc46a40b5094214e4fa54a2e810bee2d9`  
报告生成时间：`2026-10-03T07:42:03.817Z`；查询快照的具体 UTC 时间见逐项数据。  
本次范围：分析与只读验证；未升级依赖、未修改锁文件与安全基线。

## 1. 结论与推荐顺序

**值得分批升级，但不宜把所有包一键推到 `latest`。优先修复 Baileys、pypdf、brace-expansion 和 Docker Node 版本，再更新网络 SDK、桌面运行时与编辑器；对 Sentry 新主版本、KaTeX 0.19、uuid 14 保持兼容边界。**

| 优先级 | 事项 | 推荐目标 | 判断 |
| --- | --- | --- | --- |
| P0 | WhatsApp / Baileys | **精确固定 `6.7.24`**，验证后更新其传递树 | 当前 `6.17.16` 被发布者标记消息伪造漏洞；不能以数字较大或 npm audit 没命中判断安全 |
| P0 | Python PDF | **pypdf `6.19.0`** | 当前 `6.18.0` 命中 6 条去重 HIGH 公告，值得立即更新 |
| P0 | brace-expansion | 对应分支 **`1.1.21` / `2.1.7` / `5.0.12`** | 两条新增 HIGH 与一条 MODERATE；可在当前父包版本范围内修复 |
| P0 | Docker Node | **Node 24 LTS，当前补丁 `24.21.0`** | 现配置 Node 20 已结束支持，且低于当前 Pi SDK `>=22.19.0` 的要求 |
| P0 | http-cache-semantics | **无已发布修复版** | 新增 HIGH 位于构建下载依赖链；单纯更新最新版本不能修复，须处理可达性、缓存配置或限定补丁 |
| P1 | MCP / 网络传递树 | SDK `1.32.0`；fast-uri `3.1.8`、ip-address `10.7.3`、DOMPurify `3.4.16` | 有明确的隔离/安全修复价值；MCP 默认重定向行为需要回归 |
| P1 | 桌面与自动更新 | Electron `44.5.1`、builder `26.17.0`、updater `6.8.10` | 同系列更新值得做；验证原生模块、安装与从旧版升级 |
| P1 | Python 工具运行环境 | uv `0.12.22`、Python **3.12.15**；MarkItDown `0.1.8` | uv 新版支持最新解释器安全补丁；产品脚本继续使用 3.12 系列 |
| P2 | 编辑器与 UI | Tiptap `3.31.4`、Shiki `4.5.0`、Motion `14.0.0` 及表中小版本更新 | 按功能组合更新，避免重复实例与平台包不匹配 |
| P2 | Sentry 兼容更新 | Electron SDK `7.20.0` + React SDK `10.75.0` | 先对齐底层 JS SDK；8/11 系列另做隐私与 tracing 迁移 |
| P3 | 暂缓追最新 | KaTeX `0.19.0`、uuid `14.0.2`、Node Current `26.10.0` | 当前兼容收益不足；KaTeX 可先精确升到 `0.18.10` |

优先级用于安排后续实施，并不代表已证明每条公告都能在本产品中利用。新版本的兼容判断以元数据、实际用途与重点发行说明为依据；升级后仍需要对应端到端验证。

### 覆盖规模

| 类别 | 覆盖 |
| --- | --- |
| JavaScript 清单 | 根目录 + 13 个 workspace，共 **14 个 package.json** |
| 直接声明外部包 | **181 个唯一包**，已检查每个 manifest 中的声明 |
| 仅 override / patch 控制 | **5 项**：Azure identity、xmldom、ExifTool、node-tesseract-ocr、uuid |
| 直接控制项合计 | **186 项**，逐项结论见第 6 节 |
| JavaScript 全部外部锁包 | **1,555 个唯一包 / 2,012 条锁实例**：1,552 个 npm、2 个 Git、1 个 SheetJS CDN |
| Python 工具 | **8 个 PEP 723 脚本 / 12 个直接固定包** |
| Python 传递依赖扩展检查 | **48 个包**的 Windows x86_64 / Python 3.12 代表性解析快照，其中 36 个传递包 |
| 其他类别 | Bun、Node、Electron 内嵌运行时、uv、Python、Docker、3 个 GitHub Actions、5 个 apt 包、RTK/Tesseract、MSVC/Windows SDK 与安装/签名工具集，共 24 项环境条目 |

直接控制项的判断分布：

| 判断 | 直接控制项数 |
| --- | --- |
| 建议升级最新 | 49 |
| 保持 | 124 |
| 条件升级 | 2 |
| 建议升级兼容版本 | 3 |
| 建议对齐运行时 | 1 |
| 保持预发行固定 | 1 |
| 修复替换 | 1 |
| 保持并验证 | 2 |
| 保留补丁 | 2 |
| 暂缓最新 | 1 |

### 交付文件

- [全量逐项明细 CSV](./dependency-audit-2026-10-03/all-dependencies.csv)：**1640 行**，包括外部 JavaScript、Python、运行环境和 13 个内部 workspace；每行有当前版本、最新版本、推荐目标、理由和来源。
- [逐声明清单 CSV](./dependency-audit-2026-10-03/declarations.csv)：**353 行**，保留每个 manifest / PEP 723 文件、声明范围、override 和 patch，便于执行时防止遗漏。
- [全部锁实例 CSV](./dependency-audit-2026-10-03/lock-instances.csv)：**2,012 行**，保留同名包各版本、解析位置、来源及父依赖范围。
- [证据快照 JSON](./dependency-audit-2026-10-03/evidence.json)：官方版本元数据、查询时间、推荐版元数据、漏洞路径、源码 SHA-256 与安全门禁结果。
- [npm 审计原始文本](./dependency-audit-2026-10-03/npm-audit.txt)、[Python 解析快照](./dependency-audit-2026-10-03/python-resolution.txt)。

## 2. 安全问题与当前门禁

### 2.1 已执行的检查

1. 使用官方 npm registry 执行 `bun audit --json --registry https://registry.npmjs.org`，并保存文本结果。
2. 将文本输入仓库已有门禁 `bun run audit:dependencies --input=<捕获文件>`。
3. 用 OSV 官方 API 对 48 个 Python 解析版本执行批量查询；对 pypdf `6.19.0` 再查一次。
4. 核对仓库两个补丁，并确认当前 `node_modules` 中已应用；没有改动安全基线。

**npm audit 命中 8 个包、11 条去重 GHSA：1 CRITICAL、4 HIGH、5 MODERATE、1 LOW。** 同一 GHSA 覆盖多个版本分支时只计算一次。

现有基线允许 3 条历史公告；本次出现 **8 条新增公告**，其中 **3 条 HIGH** 导致已有门禁明确失败，退出码 `1`：

- `GHSA-6j4f-fj2g-mc7p`：brace-expansion。
- `GHSA-qhr7-859c-m2p7`：brace-expansion。
- `GHSA-ch52-4w7c-c8xp`：http-cache-semantics。

### 2.2 npm 漏洞逐项处理

| 包 | 公告与严重性 | 当前入口 | 推荐处理 |
| --- | --- | --- | --- |
| brace-expansion | [递归耗尽 HIGH](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)、[嵌套 brace HIGH](https://github.com/advisories/GHSA-qhr7-859c-m2p7)、[二次复杂度 MODERATE](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | Pi coding-agent → minimatch，以及 ESLint、打包工具等多个分支 | 按父包范围分别到 **1.1.21 / 2.1.7 / 5.0.12**，不能全局强制一个 major |
| DOMPurify | [LOW](https://github.com/advisories/GHSA-p98j-92pf-mc4p) | 文件预览、Mermaid 等渲染路径 | 到 **3.4.16**；公告针对特定 IN_PLACE + hook 行为，实际是否可达需结合调用 |
| fast-uri | [MODERATE](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) | MCP → AJV → fast-uri | 当前父范围 `^3.0.1`，升 **3.1.8**；不强制 latest 4.2.1 |
| ip-address | [子网判断 MODERATE](https://github.com/advisories/GHSA-j6r3-76f7-8jcv)、[超长输入 MODERATE](https://github.com/advisories/GHSA-h3mg-xc3c-68pw) | MCP → express-rate-limit | 到 **10.7.3**，保留 10.x 父范围 |
| music-metadata | [HIGH](https://github.com/advisories/GHSA-v6c2-xwv6-8xf7)，历史基线项 | Baileys `6.17.16` → `7.14.0` | 修复 Baileys 到 `6.7.24` 后，按新的 `^11.7.0` 到 **11.16.1** |
| file-type | [MODERATE](https://github.com/advisories/GHSA-5v7r-6r5c-r473)，历史基线项 | Baileys → music-metadata → `16.5.4` | 通过上述父包更新到 **21.3.4**；latest 22.1.1 无需强制 |
| node-tesseract-ocr | [CRITICAL](https://github.com/advisories/GHSA-8j44-735h-w4w2)，历史基线项 | markitdown-js → OCR | 上游仍只有 2.2.1；本地 `execFile` 补丁已应用，保留并验证恶意参数，扫描器按版本仍会报 |
| http-cache-semantics | [HIGH，无 patched version](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) | electron-builder → app-builder-lib → @electron/get → got → cacheable-request → 4.2.0 | 最新仍 4.2.0。核对共享敏感缓存是否存在；必要时限定补丁或父包替换。仅升 builder 不保证消除公告 |

这些路径按锁文件的具体解析位置构建，完整入口与范围保存在证据 JSON。devDependencies 不一定只在开发环境出现，运行时依赖也不一定能触发公告描述的路径，因此优先级同时考虑入口和可利用前提。

### 2.3 Baileys：npm audit 之外的关键异常

当前 `@whiskeysockets/baileys` 是 **6.17.16**。官方 npm 元数据对该发行明确标记 deprecated，说明其受消息伪造漏洞影响，并指向[发布者安全公告](https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg)。

公告版本范围使用 `<6.7.22` 与旧 7.0 RC 范围，异常的 `6.17.16` 数字没有被常规范围匹配捕获。此次 `bun audit` 因而没有报告它。**应优先遵循发布者对当前具体发行的弃用说明**，不能把审计未命中当成安全结论。

官方 `legacy` 稳定线是 [6.7.24](https://github.com/WhiskeySockets/Baileys/releases/tag/v6.7.24)，`latest` 是 `7.0.0-rc14`。推荐精确写 `6.7.24`，因为 `^6.7.24` 仍可能允许解析回数字更高的 6.17.x。从当前异常发行切换需验证：二维码登录、会话恢复、重连、消息收发、附件、退出，以及 Node/CJS 构建兼容。

目标 6.7.24 使用新的 music-metadata 依赖范围，并放宽 sharp peer，有机会同时消除旧音频解析依赖树和现有 sharp peer 差异。实施时必须检查实际重解的锁树，不能仅改 manifest 后宣布已修复。

### 2.4 Python：pypdf 6 条 HIGH

48 个 Python 解析包中，OSV 仅对当前 pypdf `6.18.0` 返回记录。返回的 12 个 ID 包含 GHSA/PYSEC 别名，**去重后是 6 条 HIGH**：

| 公告 | 问题 | 首个修复版本 |
| --- | --- | --- |
| [GHSA-fp3h-c4fm-7vvf](https://github.com/advisories/GHSA-fp3h-c4fm-7vvf) | ToUnicode 处理过量内存占用 | 6.18.1 |
| [GHSA-g9cg-prrw-2r8q](https://github.com/advisories/GHSA-g9cg-prrw-2r8q) | 字体解析过量内存占用 | 6.18.1 |
| [GHSA-jw7q-gvrg-4vj3](https://github.com/advisories/GHSA-jw7q-gvrg-4vj3) | 异常 Flate 输入导致长时间运行 | 6.18.1 |
| [GHSA-php9-fj8v-98fj](https://github.com/advisories/GHSA-php9-fj8v-98fj) | 表单外观流生成导致长时间运行 | 6.19.0 |
| [GHSA-v247-6f48-mgcj](https://github.com/advisories/GHSA-v247-6f48-mgcj) | 内嵌文件处理导致长时间运行 | 6.19.0 |
| [GHSA-w23x-9jrw-r45c](https://github.com/advisories/GHSA-w23x-9jrw-r45c) | 字母页码标签处理过量内存占用 | 6.19.0 |

推荐直接到 **6.19.0**；只升 6.18.1 仍未覆盖后三条。OSV 查询 6.19.0 没有返回公告，表示本次数据库快照没有命中，仍需保留恶意/异常 PDF 的运行时间与内存限制。[官方变更记录](https://pypdf.readthedocs.io/en/latest/meta/CHANGELOG.html)

## 3. 运行环境、容器与 CI

| 依赖 / 环境 | 当前 | 官方最新 / 推荐系列 | 建议 | 理由与限制 |
| --- | --- | --- | --- | --- |
| [Visual Studio Build Tools / MSVC](https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history) | VS 2022 17.14.33（17.14.37314.3）；MSVC 14.44.35207 | VS 2026 18.10.3；VS 2022 维护版 17.14.41 | 先升 VS 2022 17.14.41 配套工具集 / P2 | 安装器插件必须使用 x86 MSVC、静态 CRT；17.14 仍受支持，先取维护修复。无需为当前 Win32 插件强迁 VS 2026，升级后重新编译与验证安装器。 |
| [Windows SDK（本机编译）](https://learn.microsoft.com/en-us/windows/apps/windows-sdk/downloads) | 头文件目录 10.0.26100.0；servicing 修订未实测 | 10.0.28000.2957；26100 维护版 10.0.26100.9457 | 优先 10.0.26100.9457 维护更新 / P2 | 实际目录不能证明 servicing 修订。当前仅用 Win32/DWM/GDI，不需要 28000 新 API；保留 x86 库、最低 Windows 支持与静态 CRT 约束。 |
| [NSIS（builder 专用二进制）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder%4026.17.0/packages/app-builder-lib/src/toolsets/windows.ts) | 默认 legacy nsis-3.0.4.1；项目未设置 toolsets.nsis | builder 支持 nsis@1.2.1 / NSIS 3.12 统一包 | 先保持默认，随 builder 更新；新版工具集单独验证 / P2 | 26.17.0 仍保留 legacy 默认；升 builder 不自动切到 NSIS 3.12。显式启用新工具集需验证自定义 NSH 与 32 位 windowframe.dll；不独立替换为通用 NSIS 下载。 |
| [NSIS resources（builder 专用）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder%4026.17.0/packages/app-builder-lib/src/toolsets/windows.ts) | 默认 legacy nsis-resources-3.4.1 | 新资源随 nsis@1.2.1 统一包 | 与 NSIS 工具集保持同组 / P3 | 项目未配置自定义 resources；不单独替换插件/资源版本，切统一包时一起验证现有 installer script。 |
| [Windows 签名/资源工具（builder 专用）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder%4026.17.0/packages/app-builder-lib/src/toolsets/windows.ts) | 默认 legacy winCodeSign-2.6.0 | builder 支持 winCodeSign@1.1.0 新工具集 | 保持当前默认，按签名需求单独迁移 / P2 | 包含 signtool/rcedit/跨平台签名工具；与本机编译 SDK 是不同下载链。切新工具集前验证证书、签名、图标资源与各架构产物。 |
| [Bun（包管理器及打包二进制）](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2) | 1.4.2 | 1.4.2 | 保持 1.4.2 / P3 | 根 packageManager、构建下载与 CI 配套，当前无需升级。 |
| [Node.js（Docker）](https://nodejs.org/dist/index.json) | 20（仅固定 major，实际补丁未知） | 26.10.0 Current / 24.21.0 LTS | 24.21.0 LTS / major 24 / P0 | 20 已 EOL，当前 Pi SDK 要求 >=22.19.0；同步 worker 编译 target 并验证容器的构建和两个子进程。 |
| [Node.js（本机开发）](https://nodejs.org/dist/index.json) | 24.15.0 | 26.10.0 Current / 24.21.0 LTS | 24.21.0 LTS / P2 | 跟随生产 LTS 系列，暂不为了版本数字追 Current 26。不是仓库固定依赖。 |
| [Electron 内嵌 Node.js](https://releases.electronjs.org/release/v44.5.1) | 随 Electron 44.4.3 | 24.21.0 | 随 Electron 44.5.1 / P1 | 不单独替换 Electron 内嵌 Node；用 Electron 官方组合。 |
| [Electron 内嵌 Chromium](https://releases.electronjs.org/release/v44.5.1) | 随 Electron 44.4.3 | 152.0.7977.130 | 随 Electron 44.5.1 / P1 | 不单独替换 Chromium；浏览器运行时随 Electron 稳定补丁更新。 |
| [uv（产品打包）](https://github.com/astral-sh/uv/releases/tag/0.12.22) | 0.12.10 | 0.12.22 | 0.12.22 / P1 | 新版本支持最新 Python 安全补丁，含解析/hash 修复；打包各平台二进制并确认版本标记缓存失效。 |
| [Python（产品工具）](https://www.python.org/downloads/release/python-31215/) | 3.12（按 major.minor 选择，实际补丁未知） | 3.14.8；3.12 维护补丁 3.12.15 | 3.12.15 / P1 | 8 个包装脚本使用 --python 3.12；先更新 uv 并确保旧缓存解释器被升级，不全量迁移 3.14。 |
| [Python（本机）](https://www.python.org/downloads/) | 3.14.4 | 3.14.8 | 3.14.8 / P2 | 本机解释器不等于产品 uv 脚本运行版本，可在现有 3.14 系列更新。 |
| [Docker 基础镜像](https://hub.docker.com/v2/repositories/oven/bun/tags/1.4-slim/) | oven/bun:1.4-slim（浮动标签） | 1.4.2 对应的 1.4-slim | 固定 1.4.2-slim + 已核验 digest / P1 | 当前系列已最新；浮动标签不能证明现有部署镜像最新，重建并保存多架构 manifest digest。 |
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | v7.0.1 / 3d3c42e5aac5ba805825da76410c181273ba90b1 | v7.0.1 | 保持 SHA / P3 | 已经是当前正式发行，继续固定 commit。 |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0) | v2.2.0 / 0c5077e51419868618aeaa5fe8019c62421857d6 | v2.2.0 | 保持 SHA / P3 | 已经是当前正式发行，Bun 版本从根 packageManager 配套。 |
| [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv/releases/tag/v10.2.0) | v10.0.1 / 20cfd1bf945f4377ade1205e4dbc17946fc9a30d | v10.2.0 | c18668ad3cf93ea998bef934396af7bb5c839dc7（v10.2.0） / P2 | 同 major 更新；固定新的 SHA，并显式设置 uv 0.12.22，与产品打包版本一致。 |
| [RTK（可选集成）](https://github.com/rtk-ai/rtk/releases) | 未盘点用户安装；最低安全要求 0.44.0 | 0.51.0 | 已启用的环境可升 0.51.0 / P2 | 最低版本不是已安装版本。仅对使用此可选功能的环境升级，回归命令压缩输出和 Guarded 模式。 |
| [Tesseract OCR 二进制](https://github.com/tesseract-ocr/tesseract/releases/tag/5.5.3) | 本机未发现；不由仓库打包固定 | 5.5.3 | 使用 OCR 的环境选受支持 5.5.3 / P2 | 新版有 traineddata 反序列化与溢出修复；用户机器安装状况未知，需同时验证语言数据与 OCR 输出。升级二进制不能替代 Node 包命令注入补丁。 |
| [ca-certificates](../../Dockerfile.server) | 源码未锁定；已构建镜像版本未知 | 由该 Debian 镜像的软件源决定 | 重建受支持镜像取得发行补丁 / P2 | TLS 根证书；未构建/盘点实际镜像，不能从源码给出已安装版本或跨发行版的唯一最新版。 |
| [git](../../Dockerfile.server) | 源码未锁定；已构建镜像版本未知 | 由该 Debian 镜像的软件源决定 | 重建受支持镜像取得发行补丁 / P2 | 仓库操作；未构建/盘点实际镜像，不能从源码给出已安装版本或跨发行版的唯一最新版。 |
| [ripgrep](../../Dockerfile.server) | 源码未锁定；已构建镜像版本未知 | 由该 Debian 镜像的软件源决定 | 重建受支持镜像取得发行补丁 / P2 | 内容检索；未构建/盘点实际镜像，不能从源码给出已安装版本或跨发行版的唯一最新版。 |
| [curl](../../Dockerfile.server) | 源码未锁定；已构建镜像版本未知 | 由该 Debian 镜像的软件源决定 | 重建受支持镜像取得发行补丁 / P2 | 安装下载；未构建/盘点实际镜像，不能从源码给出已安装版本或跨发行版的唯一最新版。 |
| [gnupg](../../Dockerfile.server) | 源码未锁定；已构建镜像版本未知 | 由该 Debian 镜像的软件源决定 | 重建受支持镜像取得发行补丁 / P2 | 密钥/包来源校验；未构建/盘点实际镜像，不能从源码给出已安装版本或跨发行版的唯一最新版。 |

### Node 版本需要优先对齐

[Dockerfile.server](../../Dockerfile.server) 仍是 `NODE_MAJOR=20`，[WhatsApp worker 构建脚本](../../scripts/build-wa-worker.ts) 目标为 `node20`。Node 20 已于 **2026-04-30** 结束官方支持；当前直接使用的 Pi 1.0.0 要求 `>=22.19.0`，Babel 8 和多个依赖也已要求 Node 22 或更高。建议运行环境统一到 **Node 24 LTS**，当前补丁 **24.21.0**。[Node 官方 EOL](https://nodejs.org/en/about/eol)、[发行版本数据](https://nodejs.org/dist/index.json)

编译目标为 node20 本身并不证明产物不能运行于 Node 24；这里需要同时维护 Docker、worker 构建配置和实际部署文档，避免约定继续指向已失去支持的系列。容器验证应覆盖 **安装与生产构建、Pi 子进程、WhatsApp 子进程、WebUI、鉴权、重启和退出**。

`@types/node` 当前 26.6.2，最新版 26.6.4。产品运行环境建议 24 时，优先采用最新 24 系列 **24.19.1** 并通过完整 typecheck；类型能编译不代表 Node 24 一定具备 Node 26 API。

### uv / Python 需兼顾已存在的缓存

产品打包 uv 当前 **0.12.10**，最新 **0.12.22** 已加入 CPython 3.12.15 / 3.14.8 的下载支持。8 个 Python 工具包装脚本都指定 `--python 3.12`，建议维持 3.12 系列并更新到 **3.12.15**，先保证工具依赖与平台 wheel 的稳定性。[uv 发行说明](https://github.com/astral-sh/uv/releases/tag/0.12.22)、[Python 3.12.15](https://www.python.org/downloads/release/python-31215/)

**仅更新 uv 或继续写 `--python 3.12`，不能保证用户已经下载的旧补丁解释器自动被替换。** 后续实施需验证现有缓存、新环境和离线环境的选版行为，建立可重复的版本检查；不应把本机 Python 3.14.4 当成产品工具当前实际运行版本。

### 镜像和 apt 的已知限制

源码使用 `oven/bun:1.4-slim`，官方当前标签对应 Bun 1.4.2；标签可以浮动。证据保存的是查询时 digest，**没有检查已经部署或本机已构建镜像的实际 SBOM**。推荐固定已核验的补丁标签与 digest，并在构建时记录 apt 安装版本。5 个系统包已逐项列出，但当前实际版本与可升级版本必须结合镜像发行版、架构及 apt 仓库确定，报告不填写无法证实的数字。

### Windows 构建工具：维护更新优先

安装器自定义插件依赖本机 C++ 工具链，已用 `vswhere` 实测 **VS Build Tools 2022 17.14.33 / MSVC 14.44.35207**。微软当前 2022 维护版是 **17.14.41**，2026 稳定版是 **18.10.3**。推荐先更新 17.14 维护系列；该系列仍受支持，现有 Win32 插件没有必须跨到 2026 的功能需求。保持 **x86、静态 CRT `/MT`**，并重编译验证安装器。[2022 官方发行表](https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history)、[2026 官方发行表](https://learn.microsoft.com/en-us/visualstudio/releases/2026/release-history)

本机 Windows SDK 头文件目录是 **10.0.26100.0**，目录名称不能确定实际 servicing 修订。官方 26100 维护更新为 **10.0.26100.9457**，新系列为 **10.0.28000.2957**。当前使用 Win32/DWM/GDI，优先核对并取得 26100 维护更新；不需要为此采用 28000 新 API。[官方 SDK 发行表](https://learn.microsoft.com/en-us/windows/apps/windows-sdk/downloads)

builder 默认下载的 NSIS、资源、签名工具另有自己的发布渠道。当前未配置 `toolsets`，使用 legacy NSIS **3.0.4.1**、resources **3.4.1**、winCodeSign **2.6.0**。26.17.0 仍保留此默认，同时支持 `nsis@1.2.1`（统一 NSIS 3.12 包）和 `winCodeSign@1.1.0`。**升级 builder 不会自动启用这些新工具集**；它们值得在安装/签名需求出现时单独验证，而不是随 npm 批量更新直接切换。[builder 26.17.0 官方工具集定义](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder%4026.17.0/packages/app-builder-lib/src/toolsets/windows.ts)

## 4. 需要成组处理的升级与兼容边界

| 组合 | 推荐 | 关键约束 / 回归 |
| --- | --- | --- |
| Pi SDK 四包 | 保持 **1.0.0** | 已是最新版。其专用 provider SDK 有精确版本，不通过 override 把所有 OpenAI/Anthropic 等同名传递包推到最新 |
| Tiptap 12 项直接包 | 统一 **3.31.4** | core、pm、extensions 的精确 peer 要求一起满足；ProseMirror model/transform/view 同批更新并检查重复实例 |
| Shiki / CLI | 统一 **4.5.0** | 内部 @shikijs 包、语言与主题配套；Tiptap 代码块适配器当前无新版 |
| sharp + 8 项直接平台包 | sharp **0.35.5**，libvips **1.3.4** | 9 项直接控制声明一起更新；Windows 等自动传递的原生包也由 sharp 对应版本解析。做各平台原生加载验证 |
| Electron / 打包 / updater | **44.5.1 / 26.17.0 / 6.8.10** | 不能只依赖 typecheck；需安装器、原生模块、签名、自动更新的产物验证 |
| React / React DOM / 类型 | 保持 **19.3.0** | 全部已到最新稳定发行；无必要为了依赖审计改变框架组合 |
| PDF viewer | 保持 **react-pdf 11.0.0 + pdfjs-dist 6.3.289** | 两项均最新；worker 与主模块同版 |
| ws / 类型 | **8.22.0 + @types/ws 8.18.2** | root 的范围与 server 的精确声明都需要更新 |
| i18n | react-i18next **17.0.15**；i18next 保持 **26.4.2** | Viewer 有精确声明，需要与 root / WebUI / UI peer 同步 |
| 日期 / 图标 | day-picker **10.0.2**、lucide **1.51.0** | 不能只改 root 而遗漏 Electron / Viewer 的精确固定 |

### Sentry：先升兼容组合，最新主版本另做迁移

最新是 `@sentry/electron 8.0.0` 与 `@sentry/react 11.4.0`，但推荐先升 **7.20.0 / 10.75.0**，两者内部 core/browser 都是 10.75.0。当前 renderer 同时使用 Electron 与 React SDK，这种对齐有实际价值。

8 系列迁移涉及 `sendDefaultPii → dataCollection`、日志启用方式、默认 span streaming、OpenTelemetry 配置，以及旧 transaction 过滤回调的变化；自建 Sentry 服务还有最低版本条件。当前 opt-in 与脱敏逻辑需要按新默认行为逐项验证，不能只替换版本号。[官方迁移文档](https://github.com/getsentry/sentry-electron/blob/master/MIGRATION.md)

### KaTeX：最新版本有真实兼容阻碍

当前 **0.18.7**，官方最新 **0.19.0**；Tiptap mathematics **3.31.4** 的 peer 仅允许 `^0.16.4 || ^0.17.0 || ^0.18.0`。此外，npm 将 **0.18.11** 标记为误发破坏性变更。推荐先精确固定未弃用的 **0.18.10**；等数学扩展支持 0.19，再处理 `strict` / `symbolNotInFont` 相关行为。[KaTeX 0.19 官方发行说明](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0)、[Tiptap 数学扩展官方版本元数据](https://registry.npmjs.org/@tiptap/extension-mathematics/3.31.4)

### Motion：大版本号不等于必须重写 React 动画

当前 **13.4.0**，最新 **14.0.0**。官方 React 升级指南明确说明 14 没有 React API 破坏性变更；此版本固定内部依赖版本，也包含最近 AnimatePresence、布局与拖拽修复。推荐在 UI 升级批次采用 **14.0.0**；若希望先保持当前声明主版本，可以先到 **13.5.1**。两种方案均需要交互和视觉回归。[官方 React 升级指南](https://motion.dev/docs/react-upgrade-guide)

### 已存在的 peer 声明差异

| 当前组合 | 元数据差异 | 判断 |
| --- | --- | --- |
| Baileys 6.17.16 / sharp 0.35.4 | optional peer 要求 sharp `^0.32.6` | 修复父包 6.7.24 后目标 peer 是 `*`；结合当前 worker 外置 sharp 的路径验证 |
| eslint-plugin-react 7.37.5 / ESLint 10.11 | peer 支持到 ESLint 9 | 插件当前已最新，不能以更新插件解决；ESLint 10.12 单独门禁验证 |
| eslint-plugin-jsx-a11y 6.10.2 / ESLint 10.11 | peer 未包含 ESLint 10 | 同上；声明不满足本身不证明当前规则运行失败 |
| markitdown-js 0.0.14 / TypeScript 7.0.2 | peer 是 TypeScript `^5.7.3` | runtime 未必受影响，依靠现有类型与文档转换验证；保留本地补丁 |
| prosemirror-highlight 0.16 / highlight.js 10.7.3 | optional peer 要求 `^11.9.0` | 当前采用 Shiki adapter，不能据此强拉可选 highlight.js backend |

## 5. 版本来源例外：避免机械更新误判

| 依赖 | 观察 | 应采用的判断 |
| --- | --- | --- |
| Baileys | highest stable 数字为 6.17.16，但该具体发行已弃用；latest 是 7 RC | 精确修复到 legacy 6.7.24，不使用数字最大策略 |
| @babel/eslint-parser | latest 标签为 7.29.9，但 8.0.6 已正式发布且当前采用 | 保持 8.0.6，不降级到 latest 标签 |
| electron-builder / updater | latest 标签仍为 26.15.3 / 6.8.9，`v26` 标签为 26.17.0 / 6.8.10 | 新版是正式稳定发行，结合官方 release 更新 |
| SheetJS xlsx | 仓库使用官方 CDN 0.20.3；npm 同名包为旧发布渠道 | 按[官方安装文档](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)核对，不降级为 npm 同名包 |
| @uiw/react-json-view | 当前与 latest 都为 2.0.0-alpha.43，稳定线为 1.12.2 | 保持已有 alpha 固定，不把更旧稳定 API 当成升级 |
| postject（传递包） | 只有 1.0.0-alpha.6，无稳定发行 | 当前签名工具父包已固定该 alpha；没有可升级的稳定版，继续由父包管理 |
| libsignal / WhiskeySockets ESLint config | 锁定的是 Git 提交，不是 npm 同名包 | SSH 查询官方 HEAD，均与锁提交一致；随 Baileys 更新 |
| uuid | root override 11.1.1，最新 14.0.2 | 12 起取消 CommonJS，先审查父包的模块方式，不跨 major 强制全局替换 |
| @xmldom/xmldom | root 别名 override 已为 0.9.12，但仍有父约束 0.8.15 副本 | 这是不同解析范围；父包升级后再消除旧副本 |

两项 Git HEAD 核对结果：

- libsignal：`bcea72df9ec34d9d9140ab30619cf479c7c144c7`，与锁文件短提交 `bcea72d` 一致。
- WhiskeySockets ESLint config：`299e8389baf62f9aa3034de18ff0d62cc0a5e838`，与锁文件短提交 `299e838` 一致。

## 6. JavaScript 直接控制依赖逐项评估（186 项）

以下每一行均查询官方来源。当前版本以该包在直接声明位置解析的锁版本为准；同名传递副本的完整版本见 CSV。“稳定发行”列不自动等于推荐目标；latest 标签例外、弃用和预发行已单独处理。每项精确文件、范围、用途位置及 peer/engine 数据见逐声明 CSV 与证据 JSON。

### Agent、网络与消息（30 项）

| 依赖 | 直接控制的当前版本 | 稳定发行 / 标签例外 | 推荐目标与优先级 | 评估（风险） |
| --- | --- | --- | --- | --- |
| [@earendil-works/pi-agent-core](https://registry.npmjs.org/%40earendil-works%2Fpi-agent-core) | 1.0.0 | 1.0.0 | 保持 1.0.0 / P3 | 四项 Pi SDK 已统一为最新 1.0.0；维持其精确锁定与专用 provider 依赖，不越过 SDK 的内部版本约束。（低） |
| [@earendil-works/pi-ai](https://registry.npmjs.org/%40earendil-works%2Fpi-ai) | 1.0.0 | 1.0.0 | 保持 1.0.0 / P3 | 四项 Pi SDK 已统一为最新 1.0.0；维持其精确锁定与专用 provider 依赖，不越过 SDK 的内部版本约束。（低） |
| [@earendil-works/pi-coding-agent](https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent) | 1.0.0 | 1.0.0 | 保持 1.0.0 / P3 | 四项 Pi SDK 已统一为最新 1.0.0；维持其精确锁定与专用 provider 依赖，不越过 SDK 的内部版本约束。（低） |
| [@earendil-works/pi-server](https://registry.npmjs.org/%40earendil-works%2Fpi-server) | 1.0.0 | 1.0.0 | 保持 1.0.0 / P3 | 四项 Pi SDK 已统一为最新 1.0.0；维持其精确锁定与专用 provider 依赖，不越过 SDK 的内部版本约束。（低） |
| [@isaacs/ttlcache](https://registry.npmjs.org/%40isaacs%2Fttlcache) | 2.1.5 | 2.1.5 | 保持 2.1.5 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@larksuiteoapi/node-sdk](https://registry.npmjs.org/%40larksuiteoapi%2Fnode-sdk) | 1.74.0 | 1.74.0 | 保持 1.74.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@modelcontextprotocol/sdk](https://registry.npmjs.org/%40modelcontextprotocol%2Fsdk) | 1.30.0 | 1.32.0 | 1.32.0 / P1 | 任务会话隔离与 HTTP 重定向策略修复；默认跨源重定向行为改变，验证 HTTP/stdio、鉴权、代理和任务流。v2 拆包需另行迁移。（中） |
| [@sinclair/typebox](https://registry.npmjs.org/%40sinclair%2Ftypebox) | 0.34.52 | 0.34.52 | 保持 0.34.52 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@types/ws](https://registry.npmjs.org/%40types%2Fws) | 8.18.1 | 8.18.2 | 8.18.2 / P2 | 类型补丁，与 ws 8.22.0 同批更新，避免新增类型与现有运行版本错位。（低） |
| [@wecom/aibot-node-sdk](https://registry.npmjs.org/%40wecom%2Faibot-node-sdk) | 1.0.7 | 1.0.7 | 保持 1.0.7 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@whiskeysockets/baileys](https://registry.npmjs.org/%40whiskeysockets%2Fbaileys) | 6.17.16 | 6.17.16；latest=7.0.0-rc14 | 6.7.24（精确固定） / P0 | 当前 6.17.16 已被发布者弃用并标记消息伪造漏洞。选 legacy 修复线 6.7.24，不能用 ^6.7.24 再选回异常 6.17.x；7.0.0-rc14 属预发行。（中高） |
| [bash-parser](https://registry.npmjs.org/bash-parser) | 0.5.0 | 0.5.0 | 保持 0.5.0 / P3 | 无新发行；已有较长维护间隔，应靠现有 Bash/命令权限验证覆盖实际语法，不因无新版视为已无风险。（低） |
| [croner](https://registry.npmjs.org/croner) | 10.0.1 | 10.0.1 | 保持 10.0.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [duck-duck-scrape](https://registry.npmjs.org/duck-duck-scrape) | 2.2.7 | 2.2.7 | 保持 2.2.7 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [filtrex](https://registry.npmjs.org/filtrex) | 3.1.0 | 3.1.0 | 保持 3.1.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [glob](https://registry.npmjs.org/glob) | 13.0.6 | 13.0.6 | 保持 13.0.6 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [grammy](https://registry.npmjs.org/grammy) | 1.46.0 | 1.46.0 | 保持 1.46.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [incr-regex-package](https://registry.npmjs.org/incr-regex-package) | 1.0.4 | 1.0.4 | 保持 1.0.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [jose](https://registry.npmjs.org/jose) | 6.2.12 | 6.2.12 | 保持 6.2.12 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [js-yaml](https://registry.npmjs.org/js-yaml) | 5.4.2 | 5.4.2 | 保持 5.4.2 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [node-html-parser](https://registry.npmjs.org/node-html-parser) | 9.0.4 | 9.0.4 | 保持 9.0.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [open](https://registry.npmjs.org/open) | 11.0.4 | 11.0.4 | 保持 11.0.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [openai](https://registry.npmjs.org/openai) | 7.20.0 | 7.27.0 | 7.27.0 / P2 | Node 要求 >=22；更新项目直接客户端并回归请求、流式输出、取消与代理。Pi 1.0.0 自己固定 OpenAI 7.19.0，不用全局 override 强行替换。（中） |
| [semver](https://registry.npmjs.org/semver) | 7.8.5 | 7.8.5 | 保持 7.8.5 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [shell-quote](https://registry.npmjs.org/shell-quote) | 1.10.0 | 1.12.0 | 1.12.0 / P2 | 官方更新包含解析与转义修复；当前直接用于 CLI 图标命令解析，回归空格、引号、Windows 路径，收益以健壮性为主。（低中） |
| [undici](https://registry.npmjs.org/undici) | 8.10.2 | 8.11.2 | 8.11.2 / P1 | Node 要求 >=22.19；在运行时对齐后更新，验证代理、TLS、流式连接和取消。旧 6/7 系列传递副本跟随各自父包。（中） |
| [ws](https://registry.npmjs.org/ws) | 8.21.3 | 8.22.0 | 8.22.0 / P2 | 同主版本更新；同步 server 的精确声明及 @types/ws，验证握手、心跳、重连和消息流。（中） |
| [yaml](https://registry.npmjs.org/yaml) | 2.9.1 | 2.9.1 | 保持 2.9.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [zod](https://registry.npmjs.org/zod) | 4.6.5 | 4.6.5 | 保持 4.6.5 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [zod-to-json-schema](https://registry.npmjs.org/zod-to-json-schema) | 3.25.2 | 3.25.2 | 保持 3.25.2 / P3 | 已是最新版；项目已有 Zod 4 原生 toJSONSchema 用法，此包后续可检查是否仍需要直接声明，当前不做删除。（低） |

### 桌面、打包与原生组件（21 项）

| 依赖 | 直接控制的当前版本 | 稳定发行 / 标签例外 | 推荐目标与优先级 | 评估（风险） |
| --- | --- | --- | --- | --- |
| [@electron/packager](https://registry.npmjs.org/%40electron%2Fpackager) | 20.3.0 | 20.3.0 | 保持 20.3.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@img/sharp-darwin-arm64](https://registry.npmjs.org/%40img%2Fsharp-darwin-arm64) | 0.35.4 | 0.35.5 | 0.35.5 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@img/sharp-darwin-x64](https://registry.npmjs.org/%40img%2Fsharp-darwin-x64) | 0.35.4 | 0.35.5 | 0.35.5 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@img/sharp-libvips-darwin-arm64](https://registry.npmjs.org/%40img%2Fsharp-libvips-darwin-arm64) | 1.3.3 | 1.3.4 | 1.3.4 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@img/sharp-libvips-darwin-x64](https://registry.npmjs.org/%40img%2Fsharp-libvips-darwin-x64) | 1.3.3 | 1.3.4 | 1.3.4 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@img/sharp-libvips-linux-arm64](https://registry.npmjs.org/%40img%2Fsharp-libvips-linux-arm64) | 1.3.3 | 1.3.4 | 1.3.4 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@img/sharp-libvips-linux-x64](https://registry.npmjs.org/%40img%2Fsharp-libvips-linux-x64) | 1.3.3 | 1.3.4 | 1.3.4 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@img/sharp-linux-arm64](https://registry.npmjs.org/%40img%2Fsharp-linux-arm64) | 0.35.4 | 0.35.5 | 0.35.5 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@img/sharp-linux-x64](https://registry.npmjs.org/%40img%2Fsharp-linux-x64) | 0.35.4 | 0.35.5 | 0.35.5 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |
| [@vscode/ripgrep](https://registry.npmjs.org/%40vscode%2Fripgrep) | 1.18.0 | 1.18.0 | 保持 1.18.0 / P3 | 已是最新版；平台二进制由 npm 包管理，维持当前打包路径。（低） |
| [@xterm/addon-fit](https://registry.npmjs.org/%40xterm%2Faddon-fit) | 0.11.0 | 0.11.0 | 保持 0.11.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@xterm/xterm](https://registry.npmjs.org/%40xterm%2Fxterm) | 6.0.0 | 6.0.0 | 保持 6.0.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [electron](https://registry.npmjs.org/electron) | 44.4.3 | 44.5.1 | 44.5.1 / P1 | 保持 44 系列，更新浏览器与 Node 运行时；必须重新打包并验证 node-pty、sharp、安装与退出。（中） |
| [electron-builder](https://registry.npmjs.org/electron-builder) | 26.15.3 | 26.17.0；latest=26.15.3 | 26.17.0 / P1 | 正式稳定发行在 v26 标签，latest 标签仍为 26.15.3；与 updater 配套更新并验证自定义 NSIS、DMG/AppImage 与签名。（中） |
| [electron-log](https://registry.npmjs.org/electron-log) | 5.4.4 | 5.4.4 | 保持 5.4.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [electron-updater](https://registry.npmjs.org/electron-updater) | 6.8.9 | 6.8.10；latest=6.8.9 | 6.8.10 / P1 | 正式稳定版在 v26 标签，latest 标签落后；修复差分下载、多段请求和 blockmap 缓存问题，验证旧版到新版更新。（中） |
| [exiftool-vendored](https://registry.npmjs.org/exiftool-vendored) | 38.1.0 | 38.3.0 | 38.3.0 / P2 | 作为 override 控制的传递依赖，Node 要求 >=22；运行时升级后回归文档转换、图片元数据和子进程路径。（中） |
| [node-pty](https://registry.npmjs.org/node-pty) | 1.1.0 | 1.1.0 | 保持 1.1.0 / P3 | 已是最新版；Electron 更新时需验证原生 ABI、平台 prebuild、终端输入与进程退出。（低） |
| [node-tesseract-ocr](https://registry.npmjs.org/node-tesseract-ocr) | 2.2.1 | 2.2.1 | 保持 2.2.1 + patch / P1 | 无上游修复发行；命令注入公告由本地 execFile 补丁缓解，已确认安装目录应用。打包时必须保留补丁并验证恶意参数。（中） |
| [playwright](https://registry.npmjs.org/playwright) | 1.63.0 | 1.63.0 | 保持 1.63.0 / P3 | 已是最新版；浏览器修订由此包管理，当前无必要单独换浏览器版本。（低） |
| [sharp](https://registry.npmjs.org/sharp) | 0.35.4 | 0.35.5 | 0.35.5 / P2 | 与 sharp 0.35.5 / libvips 1.3.4 成套更新全部平台包；验证 Windows/macOS/Linux 的原生加载、缩放和缩略图，不能只升其中一个。（中） |

### 编辑器、文档与渲染（43 项）

| 依赖 | 直接控制的当前版本 | 稳定发行 / 标签例外 | 推荐目标与优先级 | 评估（风险） |
| --- | --- | --- | --- | --- |
| [@open-file-viewer/core](https://registry.npmjs.org/%40open-file-viewer%2Fcore) | 0.1.47 | 0.1.49 | 0.1.49 / P1 | 文件预览入口；同时刷新 DOMPurify 到修复版并保留 SheetJS override，回归 PDF、Office、图片和 HTML 预览。（中） |
| [@shikijs/cli](https://registry.npmjs.org/%40shikijs%2Fcli) | 4.4.3 | 4.5.0 | 4.5.0 / P2 | Shiki、CLI 与 @shikijs 内部包统一更新；验证代码块、语言加载与主题，保留现有 Tiptap 适配器。（低中） |
| [@tiptap/extension-bubble-menu](https://registry.npmjs.org/%40tiptap%2Fextension-bubble-menu) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/extension-file-handler](https://registry.npmjs.org/%40tiptap%2Fextension-file-handler) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/extension-image](https://registry.npmjs.org/%40tiptap%2Fextension-image) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/extension-mathematics](https://registry.npmjs.org/%40tiptap%2Fextension-mathematics) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/extension-placeholder](https://registry.npmjs.org/%40tiptap%2Fextension-placeholder) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/extension-task-item](https://registry.npmjs.org/%40tiptap%2Fextension-task-item) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/extension-task-list](https://registry.npmjs.org/%40tiptap%2Fextension-task-list) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/extension-text-style](https://registry.npmjs.org/%40tiptap%2Fextension-text-style) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/markdown](https://registry.npmjs.org/%40tiptap%2Fmarkdown) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/react](https://registry.npmjs.org/%40tiptap%2Freact) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/starter-kit](https://registry.npmjs.org/%40tiptap%2Fstarter-kit) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [@tiptap/suggestion](https://registry.npmjs.org/%40tiptap%2Fsuggestion) | 3.31.3 | 3.31.4 | 3.31.4 / P2 | 12 项 Tiptap 直接包统一到 3.31.4，并同步 core/pm/extensions；同批更新 ProseMirror，验证富文本、Markdown、选区、撤销、数学与粘贴。（中） |
| [beautiful-mermaid](https://registry.npmjs.org/beautiful-mermaid) | 1.1.3 | 1.1.3 | 保持 1.1.3 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [fflate](https://registry.npmjs.org/fflate) | 0.8.3 | 0.8.3 | 保持 0.8.3 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [gray-matter](https://registry.npmjs.org/gray-matter) | 4.0.3 | 4.0.3 | 保持 4.0.3 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [katex](https://registry.npmjs.org/katex) | 0.18.7 | 0.19.0 | 0.18.10（精确固定） / P2 | 最新版 0.19.0 超出 Tiptap mathematics 3.31.4 的 peer 范围；0.18.11 被标记误发破坏性变更。先升未弃用 0.18.10，暂缓 0.19。（中） |
| [linkify-it](https://registry.npmjs.org/linkify-it) | 6.1.0 | 6.1.0 | 保持 6.1.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [marked](https://registry.npmjs.org/marked) | 18.0.13 | 18.0.14 | 18.0.14 / P2 | 同系列解析补丁；保持现有 HTML sanitization，回归列表、代码围栏、表格和链接。（低中） |
| [markitdown-js](https://registry.npmjs.org/markitdown-js) | 0.0.14 | 0.0.14 | 保持 0.0.14 + patch / P1 | 无新版本；现有补丁改用 SheetJS buffer，已确认安装目录应用。其 TypeScript peer 仍声明 ^5.7.3，与当前 7.0.2 有声明差异。（中） |
| [pdfjs-dist](https://registry.npmjs.org/pdfjs-dist) | 6.3.289 | 6.3.289 | 保持 6.3.289 / P3 | 已是最新版 6.3.289；与 react-pdf 11 的解析器配套，worker 与主模块保持同版本。（低） |
| [prosemirror-highlight](https://registry.npmjs.org/prosemirror-highlight) | 0.16.0 | 0.16.0 | 保持 0.16.0 / P3 | 已是最新版。highlight.js ^11.9 的 optional peer 与树中 10.7.3 不同；项目使用 Shiki adapter，不能据此强行升级可选 backend。（低） |
| [prosemirror-model](https://registry.npmjs.org/prosemirror-model) | 1.25.11 | 1.25.12 | 1.25.12 / P2 | 与 Tiptap / ProseMirror 编辑器同批更新，检查重复实例与版本一致性，回归选区、事务、粘贴和撤销。（中） |
| [prosemirror-state](https://registry.npmjs.org/prosemirror-state) | 1.4.4 | 1.4.4 | 保持 1.4.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [prosemirror-transform](https://registry.npmjs.org/prosemirror-transform) | 1.12.1 | 1.12.2 | 1.12.2 / P2 | 与 Tiptap / ProseMirror 编辑器同批更新，检查重复实例与版本一致性，回归选区、事务、粘贴和撤销。（中） |
| [prosemirror-view](https://registry.npmjs.org/prosemirror-view) | 1.42.4 | 1.42.6 | 1.42.6 / P2 | 与 Tiptap / ProseMirror 编辑器同批更新，检查重复实例与版本一致性，回归选区、事务、粘贴和撤销。（中） |
| [react-markdown](https://registry.npmjs.org/react-markdown) | 10.1.0 | 10.1.0 | 保持 10.1.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [react-pdf](https://registry.npmjs.org/react-pdf) | 11.0.0 | 11.0.0 | 保持 11.0.0 / P3 | 已是最新版 11.0.0；与 pdfjs-dist 6.3.289 保持配套，验证 worker 与主模块同版本。（低） |
| [rehype-katex](https://registry.npmjs.org/rehype-katex) | 7.0.1 | 7.0.1 | 保持 7.0.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [rehype-raw](https://registry.npmjs.org/rehype-raw) | 7.0.0 | 7.0.0 | 保持 7.0.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [rehype-sanitize](https://registry.npmjs.org/rehype-sanitize) | 6.0.0 | 6.0.0 | 保持 6.0.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [remark](https://registry.npmjs.org/remark) | 15.0.1 | 15.0.1 | 保持 15.0.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [remark-gfm](https://registry.npmjs.org/remark-gfm) | 4.0.1 | 4.0.1 | 保持 4.0.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [remark-math](https://registry.npmjs.org/remark-math) | 6.0.0 | 6.0.0 | 保持 6.0.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [shiki](https://registry.npmjs.org/shiki) | 4.4.3 | 4.5.0 | 4.5.0 / P2 | Shiki、CLI 与 @shikijs 内部包统一更新；验证代码块、语言加载与主题，保留现有 Tiptap 适配器。（低中） |
| [strip-markdown](https://registry.npmjs.org/strip-markdown) | 6.0.0 | 6.0.0 | 保持 6.0.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [tiptap-extension-code-block-shiki](https://registry.npmjs.org/tiptap-extension-code-block-shiki) | 1.2.0 | 1.2.0 | 保持 1.2.0 / P3 | 已是最新版；与 Shiki / Tiptap 的更新一起回归，不需要为了配套而虚构新版。（低） |
| [tiptap-markdown](https://registry.npmjs.org/tiptap-markdown) | 0.9.0 | 0.9.0 | 保持 0.9.0 / P3 | 已是当前发布线最新版；与官方 @tiptap/markdown 并存，升级编辑器时需回归两种转换路径。（低） |
| [turndown](https://registry.npmjs.org/turndown) | 7.2.4 | 7.2.4 | 保持 7.2.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [unified](https://registry.npmjs.org/unified) | 11.0.5 | 11.0.5 | 保持 11.0.5 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [unist-util-visit](https://registry.npmjs.org/unist-util-visit) | 5.1.0 | 5.1.0 | 保持 5.1.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [xlsx](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) | 0.20.3 | 0.20.3 | 保持 0.20.3 CDN / P3 | 已是官方 CDN 当前版本；不要改回 npm 仓库较旧的同名发行。保持直接依赖与 override 使用同一 tarball。（低） |

### UI、状态与交互（52 项）

| 依赖 | 直接控制的当前版本 | 稳定发行 / 标签例外 | 推荐目标与优先级 | 评估（风险） |
| --- | --- | --- | --- | --- |
| [@dnd-kit/core](https://registry.npmjs.org/%40dnd-kit%2Fcore) | 6.3.1 | 6.3.1 | 保持 6.3.1 / P3 | 已是各自发布线最新版；新 DOM/helpers 与旧 core/sortable API 分属不同组件，不能按版本数字强行统一。（低） |
| [@dnd-kit/dom](https://registry.npmjs.org/%40dnd-kit%2Fdom) | 0.5.0 | 0.5.0 | 保持 0.5.0 / P3 | 已是各自发布线最新版；新 DOM/helpers 与旧 core/sortable API 分属不同组件，不能按版本数字强行统一。（低） |
| [@dnd-kit/helpers](https://registry.npmjs.org/%40dnd-kit%2Fhelpers) | 0.5.0 | 0.5.0 | 保持 0.5.0 / P3 | 已是各自发布线最新版；新 DOM/helpers 与旧 core/sortable API 分属不同组件，不能按版本数字强行统一。（低） |
| [@dnd-kit/sortable](https://registry.npmjs.org/%40dnd-kit%2Fsortable) | 10.0.0 | 10.0.0 | 保持 10.0.0 / P3 | 已是各自发布线最新版；新 DOM/helpers 与旧 core/sortable API 分属不同组件，不能按版本数字强行统一。（低） |
| [@dnd-kit/utilities](https://registry.npmjs.org/%40dnd-kit%2Futilities) | 3.2.2 | 3.2.2 | 保持 3.2.2 / P3 | 已是各自发布线最新版；新 DOM/helpers 与旧 core/sortable API 分属不同组件，不能按版本数字强行统一。（低） |
| [@fullcalendar/react](https://registry.npmjs.org/%40fullcalendar%2Freact) | 7.1.0 | 7.1.0 | 保持 7.1.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@leeoniya/ufuzzy](https://registry.npmjs.org/%40leeoniya%2Fufuzzy) | 1.0.19 | 1.0.19 | 保持 1.0.19 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@paper-design/shaders-react](https://registry.npmjs.org/%40paper-design%2Fshaders-react) | 0.0.81 | 0.0.81 | 保持 0.0.81 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@radix-ui/react-avatar](https://registry.npmjs.org/%40radix-ui%2Freact-avatar) | 1.2.6 | 1.2.6 | 保持 1.2.6 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-collapsible](https://registry.npmjs.org/%40radix-ui%2Freact-collapsible) | 1.1.20 | 1.1.20 | 保持 1.1.20 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-context-menu](https://registry.npmjs.org/%40radix-ui%2Freact-context-menu) | 2.3.7 | 2.3.7 | 保持 2.3.7 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-dialog](https://registry.npmjs.org/%40radix-ui%2Freact-dialog) | 1.1.23 | 1.1.23 | 保持 1.1.23 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-dropdown-menu](https://registry.npmjs.org/%40radix-ui%2Freact-dropdown-menu) | 2.1.24 | 2.1.24 | 保持 2.1.24 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-label](https://registry.npmjs.org/%40radix-ui%2Freact-label) | 2.1.15 | 2.1.15 | 保持 2.1.15 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-popover](https://registry.npmjs.org/%40radix-ui%2Freact-popover) | 1.1.23 | 1.1.23 | 保持 1.1.23 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-scroll-area](https://registry.npmjs.org/%40radix-ui%2Freact-scroll-area) | 1.2.18 | 1.2.18 | 保持 1.2.18 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-select](https://registry.npmjs.org/%40radix-ui%2Freact-select) | 2.3.7 | 2.3.7 | 保持 2.3.7 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-separator](https://registry.npmjs.org/%40radix-ui%2Freact-separator) | 1.1.15 | 1.1.15 | 保持 1.1.15 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-slot](https://registry.npmjs.org/%40radix-ui%2Freact-slot) | 1.3.3 | 1.3.3 | 保持 1.3.3 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-switch](https://registry.npmjs.org/%40radix-ui%2Freact-switch) | 1.3.7 | 1.3.7 | 保持 1.3.7 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-tabs](https://registry.npmjs.org/%40radix-ui%2Freact-tabs) | 1.1.21 | 1.1.21 | 保持 1.1.21 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@radix-ui/react-tooltip](https://registry.npmjs.org/%40radix-ui%2Freact-tooltip) | 1.2.16 | 1.2.16 | 保持 1.2.16 / P3 | 已是最新版；与当前 React 19 保持现有组合。（低） |
| [@svar-ui/react-gantt](https://registry.npmjs.org/%40svar-ui%2Freact-gantt) | 2.7.3 | 2.7.3 | 保持 2.7.3 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@tanstack/react-table](https://registry.npmjs.org/%40tanstack%2Freact-table) | 9.2.4 | 9.2.4 | 保持 9.2.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@tanstack/table-core](https://registry.npmjs.org/%40tanstack%2Ftable-core) | 9.2.4 | 9.2.4 | 保持 9.2.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@uiw/react-json-view](https://registry.npmjs.org/%40uiw%2Freact-json-view) | 2.0.0-alpha.43 | 1.12.2；latest=2.0.0-alpha.43 | 保持 2.0.0-alpha.43 / P3 | latest 标签仍为当前 alpha.43；稳定线 1.12.2 更旧且 API 不同。未发现新的 alpha，维持已采用的精确版本。（中） |
| [chrono-node](https://registry.npmjs.org/chrono-node) | 2.10.1 | 2.10.2 | 2.10.2 / P2 | 同系列补丁，回归中文/英文日期、相对日期和时区边界。（低） |
| [class-variance-authority](https://registry.npmjs.org/class-variance-authority) | 0.7.1 | 0.7.1 | 保持 0.7.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [clsx](https://registry.npmjs.org/clsx) | 2.1.1 | 2.1.1 | 保持 2.1.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [cmdk](https://registry.npmjs.org/cmdk) | 1.1.1 | 1.1.1 | 保持 1.1.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [date-fns](https://registry.npmjs.org/date-fns) | 4.4.0 | 4.4.0 | 保持 4.4.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [i18next](https://registry.npmjs.org/i18next) | 26.4.2 | 26.4.2 | 保持 26.4.2 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [i18next-browser-languagedetector](https://registry.npmjs.org/i18next-browser-languagedetector) | 8.2.1 | 8.2.1 | 保持 8.2.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [jotai](https://registry.npmjs.org/jotai) | 3.0.0 | 3.0.1 | 3.0.1 / P2 | 同主版本补丁；回归窗口间状态、atom family 和持久化，并同步 UI peer 声明。（低中） |
| [jotai-babel](https://registry.npmjs.org/jotai-babel) | 0.3.0 | 0.3.0 | 保持 0.3.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [jotai-family](https://registry.npmjs.org/jotai-family) | 1.1.0 | 1.1.0 | 保持 1.1.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [lucide-react](https://registry.npmjs.org/lucide-react) | 1.47.0 | 1.51.0 | 1.51.0 / P3 | 图标库同主版本更新，可随 UI 批次更新；若不需要新图标，收益较小。同步 Viewer 精确版本。（低） |
| [motion](https://registry.npmjs.org/motion) | 13.4.0 | 14.0.0 | 14.0.0 / P2 | 官方确认 React API 无破坏性变更；14 固定内部包版本，并包含 13.x 动画修复。验证退出、布局、拖拽和 reduced-motion；保守目标 13.5.1。（中） |
| [nice-ticks](https://registry.npmjs.org/nice-ticks) | 1.0.2 | 1.0.2 | 保持 1.0.2 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [qrcode.react](https://registry.npmjs.org/qrcode.react) | 4.2.0 | 4.2.0 | 保持 4.2.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [react](https://registry.npmjs.org/react) | 19.3.0 | 19.3.0 | 保持 19.3.0 / P3 | 已是最新稳定 19.3.0；与 react-dom / 类型包保持一致。（低） |
| [react-colorful](https://registry.npmjs.org/react-colorful) | 5.8.1 | 5.8.1 | 保持 5.8.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [react-day-picker](https://registry.npmjs.org/react-day-picker) | 10.0.1 | 10.0.2 | 10.0.2 / P2 | 同主版本补丁；同步 Electron 精确声明，验证日期范围、locale 和键盘选择。（低） |
| [react-devtools-core](https://registry.npmjs.org/react-devtools-core) | 8.0.0 | 8.0.0 | 保持 8.0.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [react-dom](https://registry.npmjs.org/react-dom) | 19.3.0 | 19.3.0 | 保持 19.3.0 / P3 | 已是最新稳定 19.3.0；与 React / 类型包保持一致。（低） |
| [react-i18next](https://registry.npmjs.org/react-i18next) | 17.0.14 | 17.0.15 | 17.0.15 / P2 | 与当前 i18next 26.4.2 配套的补丁；同步 Viewer 的精确声明，运行现有 i18n 门禁与切换语言回归。（低） |
| [react-resizable-panels](https://registry.npmjs.org/react-resizable-panels) | 4.12.4 | 4.14.2 | 4.14.2 / P2 | 同主版本更新；验证布局尺寸保存、面板显隐、折叠、键盘调整和缩放，不单看构建是否通过。（中） |
| [react-simple-code-editor](https://registry.npmjs.org/react-simple-code-editor) | 0.14.1 | 0.14.1 | 保持 0.14.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [sonner](https://registry.npmjs.org/sonner) | 2.0.8 | 2.0.8 | 保持 2.0.8 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [tailwind-merge](https://registry.npmjs.org/tailwind-merge) | 3.7.0 | 3.7.0 | 保持 3.7.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [temporal-polyfill](https://registry.npmjs.org/temporal-polyfill) | 1.0.5 | 1.0.5 | 保持 1.0.5 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [vaul](https://registry.npmjs.org/vaul) | 1.1.2 | 1.1.2 | 保持 1.1.2 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |

### 构建、类型与工具（40 项）

| 依赖 | 直接控制的当前版本 | 稳定发行 / 标签例外 | 推荐目标与优先级 | 评估（风险） |
| --- | --- | --- | --- | --- |
| [@aws-sdk/client-s3](https://registry.npmjs.org/%40aws-sdk%2Fclient-s3) | 3.1136.0 | 3.1146.0 | 3.1146.0 / P2 | 用于构建发布侧的 S3 接口；同系列更新值得合入，回归签名与上传，并让 Smithy/AWS 传递包随客户端解析。（低中） |
| [@azure/identity](https://registry.npmjs.org/%40azure%2Fidentity) | 4.13.3 | 4.13.3 | 保持 4.13.3 / P3 | override 已解析到最新 4.13.3；Node 要求 >=22，保持 Azure 认证行为与父包配套。（低） |
| [@babel/core](https://registry.npmjs.org/%40babel%2Fcore) | 8.0.6 | 8.0.6 | 保持 8.0.6 / P3 | 已是 Babel 8 发布线最新版；与当前 parser / presets 保持配套。（低） |
| [@babel/eslint-parser](https://registry.npmjs.org/%40babel%2Feslint-parser) | 8.0.6 | 8.0.6；latest=7.29.9 | 保持 8.0.6 / P3 | latest 标签为较旧的 7.29.9；最高稳定 8.0.6 已与 Babel 8 / ESLint 10 配套，不能依据 latest 标签降级。（低） |
| [@babel/preset-react](https://registry.npmjs.org/%40babel%2Fpreset-react) | 8.0.1 | 8.0.1 | 保持 8.0.1 / P3 | 已是 Babel 8 发布线最新版；与当前 parser / presets 保持配套。（低） |
| [@babel/preset-typescript](https://registry.npmjs.org/%40babel%2Fpreset-typescript) | 8.0.1 | 8.0.1 | 保持 8.0.1 / P3 | 已是 Babel 8 发布线最新版；与当前 parser / presets 保持配套。（低） |
| [@pierre/diffs](https://registry.npmjs.org/%40pierre%2Fdiffs) | 1.4.3 | 1.5.1 | 1.5.1 / P2 | 差异展示与选择交互库；回归 diff overlay、长文件、选区和复制，UI peer 声明同步。（中） |
| [@rolldown/plugin-babel](https://registry.npmjs.org/%40rolldown%2Fplugin-babel) | 0.2.4 | 0.2.4 | 保持 0.2.4 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@rollup/rollup-win32-arm64-msvc](https://registry.npmjs.org/%40rollup%2Frollup-win32-arm64-msvc) | 4.63.4 | 4.64.0 | 4.64.0（随 Rollup） / P3 | Rollup 平台原生包必须与消费它的 Rollup 同版本。Vite 8 使用 Rolldown，先确认此根依赖用途，避免孤立更新平台二进制。（中） |
| [@sentry/electron](https://registry.npmjs.org/%40sentry%2Felectron) | 7.19.0 | 8.0.0 | 7.20.0 / P2 | 先保持 7 系列，并与 @sentry/react 10.75.0 对齐内部 SDK；8.0.0 改变隐私、日志和 tracing 配置，需要专门迁移。（中） |
| [@sentry/react](https://registry.npmjs.org/%40sentry%2Freact) | 10.74.0 | 11.4.0 | 10.75.0 / P2 | 与 Electron SDK 7.20.0 使用的 core/browser 10.75.0 配套；11.4.0 属迁移范围，避免 renderer 多套 SDK 混用。（中） |
| [@sentry/vite-plugin](https://registry.npmjs.org/%40sentry%2Fvite-plugin) | 5.4.0 | 5.4.0 | 保持 5.4.0 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@tailwindcss/typography](https://registry.npmjs.org/%40tailwindcss%2Ftypography) | 0.5.20 | 0.5.20 | 保持 0.5.20 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@tailwindcss/vite](https://registry.npmjs.org/%40tailwindcss%2Fvite) | 4.3.3 | 4.3.3 | 保持 4.3.3 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@types/bun](https://registry.npmjs.org/%40types%2Fbun) | 1.4.1 / 1.4.2 | 1.4.2 | 1.4.2 / P2 | 根目录已解析 1.4.2，CLI 仍精确固定 1.4.1；同步 CLI 声明，与 Bun 1.4.2 保持一致。（低） |
| [@types/js-yaml](https://registry.npmjs.org/%40types%2Fjs-yaml) | 4.0.9 | 4.0.9 | 保持 4.0.9 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@types/katex](https://registry.npmjs.org/%40types%2Fkatex) | 0.16.8 | 0.16.8 | 保持 0.16.8 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@types/linkify-it](https://registry.npmjs.org/%40types%2Flinkify-it) | 5.0.0 | 5.0.0 | 保持 5.0.0 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@types/mdast](https://registry.npmjs.org/%40types%2Fmdast) | 4.0.4 | 4.0.4 | 保持 4.0.4 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@types/node](https://registry.npmjs.org/%40types%2Fnode) | 26.6.2 | 26.6.4 | 24.19.1（运行时对齐） / P2 | 最新版是 26.6.4，但推荐生产运行时为 Node 24；类型先对齐最新 24 系列，避免类型允许产品环境没有的 API。若暂留 26，可仅补丁到 26.6.4。（中） |
| [@types/react](https://registry.npmjs.org/%40types%2Freact) | 19.3.0 | 19.3.0 | 保持 19.3.0 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@types/react-dom](https://registry.npmjs.org/%40types%2Freact-dom) | 19.3.0 | 19.3.0 | 保持 19.3.0 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@types/semver](https://registry.npmjs.org/%40types%2Fsemver) | 7.8.0 | 7.8.0 | 保持 7.8.0 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@types/shell-quote](https://registry.npmjs.org/%40types%2Fshell-quote) | 1.7.5 | 1.7.5 | 保持 1.7.5 / P3 | 已是最新类型发行；保持与相应运行库配套。（低） |
| [@vitejs/plugin-react](https://registry.npmjs.org/%40vitejs%2Fplugin-react) | 6.1.1 | 6.1.1 | 保持 6.1.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [@xmldom/xmldom](https://registry.npmjs.org/%40xmldom%2Fxmldom) | 0.8.15 / 0.9.12 | 0.9.12 | 保持 0.9.12 override / P3 | 旧 xmldom 别名已替换为 0.9.12；仍有父包锁定 0.8.15 的副本，属于其他版本约束，随父包迁移，不跨 0.x 强制统一。（中） |
| [autoprefixer](https://registry.npmjs.org/autoprefixer) | 10.6.1 | 10.6.1 | 保持 10.6.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [concurrently](https://registry.npmjs.org/concurrently) | 10.0.5 | 10.0.5 | 保持 10.0.5 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [esbuild](https://registry.npmjs.org/esbuild) | 0.28.2 | 0.28.2 | 保持 0.28.2 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [eslint](https://registry.npmjs.org/eslint) | 10.11.0 | 10.12.0 | 10.12.0（门禁通过后） / P2 | 同主版本更新，但 react 与 jsx-a11y 插件最新版仍未声明支持 ESLint 10；单独更新并以现有完整 lint 验证，不能宣称 peer 已兼容。（中） |
| [eslint-plugin-jsx-a11y](https://registry.npmjs.org/eslint-plugin-jsx-a11y) | 6.10.2 | 6.10.2 | 保持 6.10.2 / P2 | 已经是最新版，但 peer 未包含 ESLint 10；暂无可通过升级插件消除声明差异的版本。（中） |
| [eslint-plugin-react](https://registry.npmjs.org/eslint-plugin-react) | 7.37.5 | 7.37.5 | 保持 7.37.5 / P2 | 已经是最新版，但 peer 只声明支持 ESLint 至 9；现用 10.11.0 的兼容性应由现有 lint 门禁验证。（中） |
| [eslint-plugin-react-hooks](https://registry.npmjs.org/eslint-plugin-react-hooks) | 7.1.1 | 7.1.1 | 保持 7.1.1 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [husky](https://registry.npmjs.org/husky) | 9.1.7 | 9.1.7 | 保持 9.1.7 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [postcss](https://registry.npmjs.org/postcss) | 8.5.28 | 8.5.28 | 保持 8.5.28 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [tailwindcss](https://registry.npmjs.org/tailwindcss) | 4.3.3 | 4.3.3 | 保持 4.3.3 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [tar](https://registry.npmjs.org/tar) | 7.5.22 | 7.5.22 | 保持 7.5.22 / P3 | 已是查询到的最新稳定发行，当前无需升级。（低） |
| [typescript](https://registry.npmjs.org/typescript) | 7.0.2 | 7.0.2 | 保持 7.0.2 / P3 | 已是最新版 7.0.2；无需继续升级，保留现有工具链验证。（低） |
| [uuid](https://registry.npmjs.org/uuid) | 11.1.1 | 14.0.2 | 保持 11.1.1 / P3 | 全局 override；12 起取消 CommonJS 支持，强制 14.0.2 可能影响仍使用 require 的父包。先审查各父包和 CJS 打包，再决定迁移。（中高） |
| [vite](https://registry.npmjs.org/vite) | 8.3.0 | 8.3.2 | 8.3.2 / P2 | 8 系列补丁，现有 React/Babel 插件保持配套；回归 Electron renderer、Viewer 和 WebUI 的实际生产构建。（中） |

## 7. Python 直接依赖逐项评估（12 项）

工具声明位于 `apps/electron/resources/scripts` 中的 8 个 PEP 723 脚本。它们使用固定版本；普通 `uv run` 不会因为 PyPI 有新版本就自动更新这些固定声明。

| 依赖 | 当前固定 | PyPI 最新 | 推荐 | 依据 |
| --- | --- | --- | --- | --- |
| [click](https://pypi.org/pypi/click/json) | 8.5.0 | 8.5.0 | 保持 8.5.0 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [diff-match-patch](https://pypi.org/pypi/diff-match-patch/json) | 20241021 | 20241021 | 保持 20241021 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [icalendar](https://pypi.org/pypi/icalendar/json) | 7.3.0 | 7.3.0 | 保持 7.3.0 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [img2pdf](https://pypi.org/pypi/img2pdf/json) | 0.6.3 | 0.6.3 | 保持 0.6.3 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [markitdown](https://pypi.org/pypi/markitdown/json) | 0.1.7 | 0.1.8 | 0.1.8 / P1 | 修复 Windows file URI、CSV 转义/BOM 与 OMML 数学转换；同步 doc_diff 和 markitdown_cli 的声明及 extras。JS markitdown-js 是另一个项目。 |
| [openpyxl](https://pypi.org/pypi/openpyxl/json) | 3.1.5 | 3.1.5 | 保持 3.1.5 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pillow](https://pypi.org/pypi/pillow/json) | 12.3.0 | 12.3.0 | 保持 12.3.0 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pypdf](https://pypi.org/pypi/pypdf/json) | 6.18.0 | 6.19.0 | 6.19.0 / P0 | 6.18.0 命中 6 条去重 HIGH 公告；6.19.0 修复全部本次命中，OSV 查询该目标无返回记录。回归 PDF 读取、合并、表单和资源限制。 |
| [pypdfium2](https://pypi.org/pypi/pypdfium2/json) | 5.13.0 | 5.13.0 | 保持 5.13.0 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [python-dateutil](https://pypi.org/pypi/python-dateutil/json) | 2.9.0.post0 | 2.9.0.post0 | 保持 2.9.0.post0 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [python-docx](https://pypi.org/pypi/python-docx/json) | 1.2.0 | 1.2.0 | 保持 1.2.0 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [python-pptx](https://pypi.org/pypi/python-pptx/json) | 1.0.2 | 1.0.2 | 保持 1.0.2 / P3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |

### Python 传递依赖逐项版本核查（36 项）

仓库没有 Python 传递锁文件。本次将当前 8 个工具的固定声明与 MarkItDown extras 合并，使用 uv 对 **Windows x86_64 / Python 3.12** 只做解析，得到 48 个包。以下是这一代表性快照的 36 个传递包，**不是已安装用户环境的实测清单，也不是 macOS/Linux 的完整树**。各脚本独立环境及平台 markers 可能选出不同集合。

| 解析快照传递依赖 | 解析版本 | PyPI 最新 | 判断 |
| --- | --- | --- | --- |
| [beautifulsoup4](https://pypi.org/pypi/beautifulsoup4/json) | 4.15.0 | 4.15.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [certifi](https://pypi.org/pypi/certifi/json) | 2026.7.22 | 2026.7.22 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [cffi](https://pypi.org/pypi/cffi/json) | 2.1.1 | 2.1.1 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [charset-normalizer](https://pypi.org/pypi/charset-normalizer/json) | 3.5.2 | 3.5.2 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [cobble](https://pypi.org/pypi/cobble/json) | 0.1.4 | 0.1.4 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [coloredlogs](https://pypi.org/pypi/coloredlogs/json) | 15.0.1 | 15.0.1 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [cryptography](https://pypi.org/pypi/cryptography/json) | 50.0.2 | 50.0.2 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [defusedxml](https://pypi.org/pypi/defusedxml/json) | 0.7.1 | 0.7.1 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [et-xmlfile](https://pypi.org/pypi/et-xmlfile/json) | 2.0.0 | 2.0.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [flatbuffers](https://pypi.org/pypi/flatbuffers/json) | 25.12.19 | 25.12.19 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [humanfriendly](https://pypi.org/pypi/humanfriendly/json) | 10.0 | 10.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [idna](https://pypi.org/pypi/idna/json) | 3.20 | 3.20 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [lxml](https://pypi.org/pypi/lxml/json) | 6.1.3 | 6.1.3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [magika](https://pypi.org/pypi/magika/json) | 0.6.3 | 1.0.3 | MarkItDown 0.1.7 / 0.1.8 均要求 ~=0.6.1，不允许最新版 1.0.3；随父包迁移。 |
| [mammoth](https://pypi.org/pypi/mammoth/json) | 1.11.0 | 1.13.0 | MarkItDown docx extra 要求 ~=1.11.0，不允许最新版 1.13.0；不能单独强制升级。 |
| [markdownify](https://pypi.org/pypi/markdownify/json) | 1.2.3 | 1.2.3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [mpmath](https://pypi.org/pypi/mpmath/json) | 1.3.0 | 1.4.1 | 存在 1.4.1；当前 SymPy 解析选择 1.3.0，升级父包/重解依赖前保留兼容组合。 |
| [numpy](https://pypi.org/pypi/numpy/json) | 2.5.3 | 2.5.3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [onnxruntime](https://pypi.org/pypi/onnxruntime/json) | 1.20.1 | 1.30.0 | 最新版 1.30.0 超出当前 Magika 的选版范围，且涉及平台原生运行库；随 Magika 父包迁移。 |
| [packaging](https://pypi.org/pypi/packaging/json) | 26.3 | 26.3 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pandas](https://pypi.org/pypi/pandas/json) | 3.0.6 | 3.0.6 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pdfminer-six](https://pypi.org/pypi/pdfminer-six/json) | 20260107 | 20260107 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pdfplumber](https://pypi.org/pypi/pdfplumber/json) | 0.11.10 | 0.11.10 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pikepdf](https://pypi.org/pypi/pikepdf/json) | 10.16.0 | 10.16.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [protobuf](https://pypi.org/pypi/protobuf/json) | 7.36.2 | 7.36.2 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pycparser](https://pypi.org/pypi/pycparser/json) | 3.0 | 3.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [pyreadline3](https://pypi.org/pypi/pyreadline3/json) | 3.5.6 | 3.5.6 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [python-dotenv](https://pypi.org/pypi/python-dotenv/json) | 1.2.4 | 1.2.4 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [requests](https://pypi.org/pypi/requests/json) | 2.34.2 | 2.34.2 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [six](https://pypi.org/pypi/six/json) | 1.17.0 | 1.17.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [soupsieve](https://pypi.org/pypi/soupsieve/json) | 2.10 | 2.10 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [sympy](https://pypi.org/pypi/sympy/json) | 1.14.0 | 1.14.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [typing-extensions](https://pypi.org/pypi/typing-extensions/json) | 4.16.0 | 4.16.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [tzdata](https://pypi.org/pypi/tzdata/json) | 2026.4 | 2026.4 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [urllib3](https://pypi.org/pypi/urllib3/json) | 2.8.0 | 2.8.0 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |
| [xlsxwriter](https://pypi.org/pypi/xlsxwriter/json) | 3.2.9 | 3.2.9 | 已是本次 PyPI 查询的最新稳定发行，当前无需升级。 |

四项解析版本落后于 PyPI 最新，但有明确父约束：Magika、Mammoth、ONNX Runtime、mpmath。MarkItDown 0.1.8 仍沿用 Magika `~=0.6.1` 与 Mammoth `~=1.11.0`，因此升级 MarkItDown 不会自动让这两项到最新主线。评估追新版应先解决父包兼容，不能在工具启动时强行注入不满足约束的版本。

## 8. JavaScript 传递依赖：逐项结论如何使用

全部 **1,555 个外部包**已核查版本；**1,369 个仅传递包**的版本和推荐均在全量 CSV 中。另有 2,012 个逐锁实例条目可追踪具体重复版本与父范围。

传递依赖的评估深度是：**官方稳定标签/版本元数据 + 当前锁版本 + 实际父约束 + npm 全树安全公告**。重点安全项和升级组合另读了发行说明与相关调用代码。没有对全部 1,369 个传递库做独立源码审计或逐版本 changelog 人工审阅，也不据此宣称每个最新版本都已通过兼容测试。

| CSV 判断 | 含义 | 后续操作 |
| --- | --- | --- |
| 保持 | 已达到查询的稳定标签版本 | 由父包继续管理 |
| 部分父约束内可更新 | latest 满足至少一条现有父范围 | 刷新允许的副本，其他分支分别处理 |
| 随父依赖迁移 | 最新版本不满足当前父范围，或兼容性未证明 | 更新父包后重解，避免全局 override |
| 保持较新/并行分支 | 锁版本比某个 latest 标签更高 | 不降级，检查发布渠道与父包要求 |
| 安全修复 | 本次命中公告且有兼容修复路径 | 优先按指定分支修复，并再扫实际新锁树 |
| 无修复版待处理 | 最新版本仍在受影响范围 | 处理入口、缓存、补丁或明确风险决定 |
| 保持 Git 固定 | 当前固定提交与官方 HEAD 一致 | 跟随父项目，不比较 npm 同名包 |

特别注意：Bun 使用 hoisted linker，源码会消费部分顶层可见的传递包。Tiptap、i18next、PDF worker 等相关更新需要实际构建验证；只看 package.json 表面声明无法完整判断运行路径。[bunfig.toml](../../bunfig.toml)

## 9. 建议实施批次与验证产物

本节是后续升级的实施建议；本次没有执行这些变更。

| 批次 | 变更 | 必要验证 | 可重复产物 |
| --- | --- | --- | --- |
| A：安全与运行环境 | Baileys 精确修复、音频解析树、brace-expansion、pypdf、Docker Node 24；处理无修复 cache 公告 | 重跑现有安全门禁；WhatsApp 登录/重连/附件；异常 PDF；容器两种子进程与 WebUI | 新锁文件差异、审计 JSON、容器版本/SBOM、E2E 日志与样例输出 |
| B：网络与 Python 工具 | MCP、fast-uri、ip-address、DOMPurify、undici；uv/3.12.15、MarkItDown | HTTP 重定向/鉴权/代理/stdio；已有 Python 缓存、新装与离线；Office/PDF/CSV 转换 | MCP 连接日志、解释器实际版本、固定文档样例输出 |
| C：桌面发布 | Electron、builder、updater、sharp/全部平台包 | 各支持平台原生模块加载、终端、安装/卸载、启动/退出、旧版自动更新到新版 | 安装包、签名/校验结果、更新链日志和截图 |
| D：编辑器与 UI | Tiptap/ProseMirror/Shiki、Motion、Jotai、面板、i18n、日期/图标；KaTeX 兼容补丁 | 编辑/撤销/粘贴/数学/代码块；布局/退出动画；窗口状态；现有 i18n 门禁 | E2E 截图/视频、长文档与数学样例、门禁输出 |
| E：独立工具链/迁移 | ESLint 10.12、类型对齐、Sentry 兼容组合；未来再评估 Sentry 新主版本与 uuid | 全部现有 typecheck/lint；遥测 opt-in/脱敏；CJS 加载兼容 | 门禁日志、遥测请求样例、迁移差异与决定 |

门禁失败应先修复或作具体、可复核的风险决定，再更新基线。扩大允许列表不会修复漏洞；本次没有调整基线。遵循仓库约定，后续复杂功能以已有门禁和 E2E 为主，不补写只映射实现的单元测试。

## 10. 范围完整性与证据边界

### 逐清单覆盖

| 范围文件 | 直接外部声明次数 | 内部声明次数 |
| --- | --- | --- |
| [package.json](../../package.json) | 130 | 0 |
| [apps/cli/package.json](../../apps/cli/package.json) | 3 | 2 |
| [apps/electron/package.json](../../apps/electron/package.json) | 47 | 5 |
| [apps/viewer/package.json](../../apps/viewer/package.json) | 19 | 2 |
| [apps/webui/package.json](../../apps/webui/package.json) | 9 | 2 |
| [packages/core/package.json](../../packages/core/package.json) | 1 | 0 |
| [packages/messaging-gateway/package.json](../../packages/messaging-gateway/package.json) | 5 | 4 |
| [packages/messaging-whatsapp-worker/package.json](../../packages/messaging-whatsapp-worker/package.json) | 3 | 0 |
| [packages/pi-agent-server/package.json](../../packages/pi-agent-server/package.json) | 10 | 0 |
| [packages/server-core/package.json](../../packages/server-core/package.json) | 9 | 2 |
| [packages/server/package.json](../../packages/server/package.json) | 3 | 4 |
| [packages/session-tools-core/package.json](../../packages/session-tools-core/package.json) | 5 | 0 |
| [packages/shared/package.json](../../packages/shared/package.json) | 17 | 2 |
| [packages/ui/package.json](../../packages/ui/package.json) | 33 | 2 |

13 个内部 workspace 当前均为项目版本 **0.2.4**；25 条内部依赖声明是 `workspace:*`，不对应外部仓库新版本。它们已纳入逐声明清单，属于项目发布版本同步工作。

### 本次验证与未验证内容

- 已验证 186 个直接控制项、1,555 个唯一外部锁包、2,012 个锁实例的清单完整性与官方版本来源；Git/CDN 用各自来源核对。
- 已运行现有依赖审计门禁，确认当前失败；已做 Python OSV 查询及目标 pypdf 查询。
- 已核对两个本地补丁在当前安装树的应用情况；扫描器仍按包版本报出的结果单独说明。
- 已解析 Python 代表性传递树，**没有安装、更新解释器或运行用户业务文档**。
- **没有实际升级、运行完整构建/E2E、创建安装包或盘点线上容器**。本报告提供升级收益与兼容风险判断，测试结果不延伸到尚未执行的目标版本。
- apt 已安装版本、用户 RTK/Tesseract 安装版本、其他平台 Python 传递集合仍未知；未知项没有填写推测数字。

查询版本会随官方发布变化。复核时以证据快照中的查询时间、源码 SHA-256 和当前对应官方接口为准。版本无更新只说明没有新的可选发行，并不代表项目维护活跃或没有风险。
