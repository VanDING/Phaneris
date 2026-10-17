# Phaneris 全量依赖版本与升级评估

版本查询日期：2026-10-16（Asia/Shanghai）；整理、复验延续至 2026-10-17 凌晨。
源码基准：本地 main，231a7942be2640a04dd0ea6199c85558e75873a5。它比 origin/main 多 6 个已有提交。
范围：全量盘点与升级价值评估；仅落实解除当前 CI 安全阻断的两个锁版本更新，未执行其余升级建议。

## 结论

值得升级，但应按功能和风险分批推进。优先处理 **Pi 1.3.0、Electron 44.8.0、pypdf 6.21.0、http-cache-semantics 4.3.0 和 Node 24.22.0 LTS**。CI 新增阻断的 proxy-addr 2.0.8、source-map-js 1.2.2 已定向更新。

版本数量与价值是两个判断：179 个直接控制项中，74 项存在更高稳定版本；其中 React 的本次补丁对客户端应用收益有限，Sentry 和文件预览器的跨主版本升级需要单独迁移。不能把 586 个存在旧副本的 npm 包名等同于 586 项可独立升级任务。

| 优先级 | 依赖 | 当前 → 建议目标 | 价值与执行条件 |
| --- | --- | --- | --- |
| P0，已实施 | proxy-addr | 2.0.7 → 2.0.8 | 修复新增 CRITICAL；当前父范围允许，安全门禁已通过 |
| P0，已实施 | source-map-js | 1.2.1 → 1.2.2 | 修复新增 HIGH；当前父范围允许，安全门禁已通过 |
| P1 | Pi 四个直接包 | 1.2.0 → 1.3.0 | 会话恢复工具、模型切换思考隔离、畸形工具参数、Bun codemode 取消都有实际价值；整组统一精确固定 |
| P1 | Electron | 44.5.1 → 44.8.0 | 同一主版本内更新 Chromium 与 Node；同步 electronVersion 并执行三平台原生验收 |
| P1 | pypdf | 6.19.0 → 6.21.0 | 6.20/6.21 包含循环树、stream、字段解析工作量限制；适用于外部 PDF 输入 |
| P1 | http-cache-semantics | 本地修补的 4.2.0 → 正式 4.3.0 | 已有父范围内的正式修复目标；验证后可退役旧补丁，减少长期补丁维护 |
| P1 | Node | 本机 24.15.0 → 24.22.0 LTS | 与桌面/服务端系列对齐；Docker 的实际补丁仍须镜像采样 |
| P1 | MCP SDK | 1.32.0 → 1.32.1 | 兼容维护更新；回归 stdio/HTTP、OAuth、连接池、重连 |
| P2 | 编辑器、日历、表格、Gantt、PDF worker | 逐组更新，详见下文 | 在相应真实功能验收中升级，保持组件族一致 |
| P2 | Bun / uv / 构建工具 | Bun 1.4.3、uv 0.13.1 等 | 单独工具链批次；统一 CI、Docker、打包与类型版本 |
| P3 | Sentry / 文件预览器 / uuid / KaTeX 新系列 | 暂缓跨兼容边界 | 迁移成本与行为风险高于目前已证明的收益 |

所有“建议”都是评估结论，除两条 P0 外均未在本次升级实施。

## 1. “所有”的覆盖口径

| 类别 | 实际覆盖 |
| --- | --- |
| JavaScript manifest | 14 份：根 + 13 个 workspace |
| 直接声明外部包 | 172 个唯一包名 |
| 加上仅 override / patch 控制项 | 179 项；另 7 项同样纳入 |
| JS 外部锁包 | 1,468 个唯一包名：1,466 个 npm、1 个 Git、1 个 CDN |
| 锁实例 | 1,833 条，保留同名包所有版本和解析位置 |
| Python | 8 个 PEP 723 脚本，12 个直接固定包 |
| Python 传递树 | 48 个包的 Windows x64 / Python 3.12.15 工具并集解析 |
| 运行环境 | 28 项：运行时、4 个 Actions、镜像、8 个 apt 包、可选工具与本机构建工具 |
| 内部包 | 13 个，按 workspace 发布策略处理 |
| 全部逐项结果 | **1,558 行**，各行包含版本、目标、判断、理由、风险、来源、查询时间 |

**边界明确保留：** 10-16 原始快照在无 Docker/可用 WSL 的本机生成，CSV 的 8 个 apt 包标为未实测。10-17 已通过真实 Linux CI 构建产物补齐这 8 项及容器 Node 补丁版本，见第 7 节；原始快照按日期保留。Python 解析不代表 macOS/Linux 各自的最终依赖树。

逐项表的 latestStable 指非预发行、未被发布者弃用的最高稳定版本；latestTag 单独保留。boolean、fluent-ffmpeg、inflight、lodash.isequal、node-domexception 的稳定版本已全部弃用，应随父包替换；glob 和 rimraf 仍有旧弃用副本。共 7 个包名的弃用信息保留在 deprecatedLockedVersions 列。postject 仅有预发行版本，继续由父包固定。

交付数据：

- [全量逐项评估](dependency-audit-2026-10-16/all-dependencies.csv)：直接项、传递项、环境项和内部包。
- [逐声明清单](dependency-audit-2026-10-16/declarations.csv)：每个 manifest / PEP 723 声明、字段和版本范围。
- [全部锁实例](dependency-audit-2026-10-16/lock-instances.csv)：每个实例的前后版本、来源与父约束。
- [汇总数据](dependency-audit-2026-10-16/summary.json)与[证据校验清单](dependency-audit-2026-10-16/evidence.json)。
- [npm 官方元数据](dependency-audit-2026-10-16/npm-metadata.json)、[Python 直接包元数据](dependency-audit-2026-10-16/pypi-metadata.json)、[Python 传递树与 OSV](dependency-audit-2026-10-16/python-transitive-metadata.json)、[运行时元数据](dependency-audit-2026-10-16/runtime-metadata.json)。

## 2. 安全结果

使用官方 registry 执行真实 bun audit；审计前后原始结果均已保存。为解决本机 Bun 证书链验证问题，临时提供系统信任证书，没有关闭 TLS 校验，也没有修改产品配置。

| 阶段 | 去重公告 | 分布 | 门禁 |
| --- | --- | --- | --- |
| 修复前 | 7 条 | 2 CRITICAL、2 HIGH、2 MODERATE、1 LOW | 两条新增高严重性公告阻断 |
| 修复后 | 5 条 | 1 CRITICAL、1 HIGH、2 MODERATE、1 LOW | 通过；无新增 HIGH / CRITICAL |

[修复前原始文本](dependency-audit-2026-10-16/npm-audit-before.txt) / [修复后原始文本](dependency-audit-2026-10-16/npm-audit-after.txt)。安全基线文件未扩大。

| 包 | 状态及下一步 |
| --- | --- |
| proxy-addr | [官方公告](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)修复线为 2.0.8，已更新 |
| source-map-js | [官方公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)修复线为 1.2.2，已更新 |
| http-cache-semantics | [公告](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)仍按 4.2.0 报 HIGH；当前有本地补丁。官方 registry 的 4.3.0 发布于 10-04，建议替代本地修补后重新运行共享缓存端到端验证 |
| node-tesseract-ocr | 仍只有 2.2.1；本地 execFile 修补继续保留。版本扫描的历史 CRITICAL 不等于补丁失效 |
| KaTeX 旧副本 | 直接 0.18.10 不在本次 LOW 范围；嵌套 0.16.47 仍受 Mermaid 等父范围限制，须随父包治理 |
| postcss-selector-parser | 6.0.10 被 @tailwindcss/typography 精确固定，修复版 7.1.6 跨主版本；不能用一次普通解锁替换 |
| sprintf-js | 最新稳定仍是 1.1.3，暂无已发布修复版；保留 MODERATE 可见，限制不可信格式化输入并跟进 argparse/roarr 等父包 |

48 个 Python 解析版本及 pypdf 6.21.0 的 OSV 批量查询均无匹配公告。这是查询结果，**不能替代发行说明中的安全修复判断**；pypdf 官方已明确列出新的安全加固。

## 3. 有明确产品价值的升级

### Pi 1.3.0

[官方发行说明](https://github.com/earendil-works/pi/releases/tag/v1.3.0)中的几项变化正好落在本项目的会话与工具链路：

- 恢复会话时保留已激活工具；内部 Pi 包改用精确版本，减少混装。
- 模型切换时隔离旧模型思考块，减少其进入可见回答的风险。
- 改善畸形工具参数处理，避免部分解析结果被静默执行。
- 改善 Bun 中 codemode 的取消、超时与残留 worker 控制。
- 改善兼容接口的重试和流式思考顺序。

建议同时更新 pi-ai、pi-agent-core、pi-codemode、pi-coding-agent。Kimi Code 改为 Chat Completions，覆盖的 base URL 需要含 /v1；先验证 custom provider、工具同步、取消、历史恢复和精确调用参数。该版本按上海时间在 10-16 凌晨发布，仍需完整回归。

### Electron 与 Node

[官方版本表](https://releases.electronjs.org/release)列出 Electron 44.8.0 内嵌 Chromium 152.0.7977.167、Node 24.22.0。当前 electron-builder 26.17.0 没有稳定目标差距，无需为了更新 Electron 同时改 builder。

升级应同步根 / Electron workspace 声明及 electron-builder.yml 的 electronVersion，并验证 node-pty、koffi、CDP、隐藏窗口截图、主题缩放、安装和重开。开发 Node 建议保持 [24 LTS](https://nodejs.org/dist/index.json)，不切到 Current 26。

### PDF 与缓存库

[pypdf 官方 changelog](https://pypdf.readthedocs.io/en/stable/meta/CHANGELOG.html)在 6.20.0、6.20.1 和 6.21.0 连续增加解析工作量及循环结构限制。这对接收外部 PDF 的工具比普通“版本更高”更有价值，建议升到 6.21.0。

http-cache-semantics 的正式 4.3.0 在父范围内；须先执行现有 [安全端到端脚本](../../scripts/verification/verify-dependency-upgrade-security.cjs)，比较 private/no-store/Authorization/max-stale 等场景，再移除旧版本补丁和对应历史基线项。

## 4. UI、内容与工具链批次

| 组合 | 建议目标 | 判断与必要验收 |
| --- | --- | --- |
| Tiptap 13 个直接控制包 | 3.31.4 → 3.32.0 | 整体对齐；Markdown 往返、表格、数学、代码、粘贴、文件处理 |
| Radix 13 个组件 | 各包官方 latest，见逐项表 | 同族批次；焦点、portal、嵌套菜单、键盘、缩放。元数据未证明每个组件都有立即可见收益 |
| FullCalendar | react / core 等相关包 7.1.3 | 与内部 headless-calendar 对齐；日期、时区、拖拽和 Temporal |
| Gantt / Grid | 2.8.1 / 2.7.6 | 结合已有排期与宽度验证，检查受控状态与布局 |
| TanStack Table | react-table 与 table-core 9.3.1 | 两包一起升，验证排序、过滤、选择和虚拟化 |
| Motion | 14.3.0 | 同主版本可评估；仍需动效与 reduced motion 验收 |
| pdfjs-dist | 6.4.299 | PDF worker 与宿主版本必须一致，回归预览、字体和生产构建 |
| i18next / react-i18next | 26.4.7 / 17.0.20 | 可合并国际化维护批次，回归 locale 与动态语言切换 |
| React / react-dom | 19.3.1 | [发行说明](https://github.com/facebook/react/releases/tag/v19.3.1)主要涉及 RSC transport；本项目 renderer 的直接收益较低，可随后续 UI 批次更新 |
| Playwright | 1.64.1 | 需要同步浏览器产物；回归 Electron 驱动和生产浏览器工作流 |
| Vite / React 插件 | 8.3.4 / 6.1.2 | 同维护批次，验证主渲染器、Web UI、viewer 构建 |
| Babel 三项更新 | 8.0.7 | 当前主版本内维护；保留旧 Babel 7 传递分支的父约束 |
| ESLint | 10.13.0 | 验证插件兼容、规则行为与 warning 基线，不自动重写基线 |
| Bun / @types/bun | 1.4.3 | 与 CI、Docker、打包二进制统一；验证 SQLite、子进程和 frozen install |
| uv | 0.13.1 | 有卸载边界及解析修复；先验证八个 PEP 723 工具和解释器下载 |
| Node 类型 | 24.19.2 | 对齐实际 Node 24，避免 latest 26.6.5 放进不可用 API |
| OpenAI JS SDK | 7.34.0 | 属当前声明范围的维护更新，验证实际调用入口；Pi 自带的 SDK 版本仍由 Pi 控制 |
| Azure identity / Lark SDK | 4.14.0 / 1.76.0 | 凭据与消息功能回归后更新，不与纯 UI 批次混用 |

没有变化的直接包也已逐项记录，包括 TypeScript 7.0.2、esbuild 0.28.2、electron-builder 26.17.0、sharp 0.35.5、Shiki 4.5.0 等；“保持”不是漏查。

## 5. 暂缓、保留与外部分发

| 项目 | 判断 |
| --- | --- |
| Sentry Electron 8.2.0 / React 11.8.0 | 跨主版本；明确隐私、tracing 和底层 SDK 对齐后单独迁移 |
| @sentry/vite-plugin latest 11.8.0 | 当前 5.4.0 可先到兼容的 5.4.1；不直接跨到 11 |
| @open-file-viewer/core 1.0.0 | 当前精确固定 0.1.49；[正式 1.0](https://github.com/xushanpei/open-file-viewer/releases/tag/v1.0.0)需逐格式预览、CAD/PDF peer 与体积评估 |
| KaTeX 0.19.0 | 先治理有公告的旧传递副本；当前直接 0.18.10 可保留 |
| uuid 14.0.3 / ExifTool 39.0.1 | 目前为覆盖项；先核对父包 API 与附带二进制，不全局强升 |
| Baileys | 保留稳定 6.7.24；latest 7.0.0-rc14 仍为预发行 |
| SheetJS | [官方当前安装页](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)仍指向 CDN 0.20.3；npm 的 0.18.5 不是更新目标 |
| libsignal | SSH 查询上游 HEAD 为 bcea72df9ec34d9d9140ab30619cf479c7c144c7，与锁定短 SHA 一致 |
| Python 产品解释器 | 保持 3.12.15，已是该系列最新补丁；3.15.0 需另做 wheels/工具兼容迁移 |
| RTK / Tesseract | 最新正式 1.0.1 / 5.5.3；属于可选用户环境，未替用户安装或更新 |
| VS Build Tools | 本机 17.14.33，官方维护版 17.14.42；建议维护更新，非仓库依赖改动 |
| Windows SDK | 本机目录 26100 系列，servicing 未实测；官方 26100.9457 / 28000.2957，优先现系列维护，不因数字更大切目标 SDK |
| builder 专用 NSIS / signing 工具 | 随 builder 控制；不把独立安装包替入构建链 |
| 8 个 apt 包 | 原始 CSV 标为未实测；10-17 已补齐真实 Linux 构建选中的发行版候选版本，见第 7 节 |

## 6. 执行顺序与验证边界

1. **本轮 CI 修复**：两条安全锁版本、可选 S3 构建路径、容器工具链、Linux 沙箱与 Xvfb、失败传播、测试环境语义和证据日志。
2. **安全和运行时批次**：pypdf、http-cache-semantics、Electron、Node；先列失败场景，再升级和验收。
3. **Pi 1.3.0 独立批次**：四包统一、Kimi 兼容、工具/历史/取消/流式完整回归。
4. **编辑器、日历、表格批次**：按组件族升级，复用已有真实功能工作流。
5. **工具链维护**：Bun、uv、构建/lint/测试工具及 Actions。
6. **跨主版本迁移**：Sentry、文件预览器等留到有明确验收目标时推进。

本次的两个 P0 更新只改变两条锁实例，没有增加依赖或放宽安全允许基线。所有其余目标均是未来实施建议，不代表已验证兼容。

[CI 修复与本地证据](../verification/ci-repair-2026-10-16.md)单独记录了通过项、环境限制及远端验证状态。原始查询时间、来源链接、约束与 SHA-256 保留在逐项文件中。部分 GitHub 发行说明 API 遇到匿名限流，重点项目使用官方网页核对；npm 版本元数据全量查询无缺失。

## 7. 2026-10-17 容器系统依赖补证

真实生产容器在 [运行 38986448218](https://github.com/VanDING/Phaneris/actions/runs/38986448218) 成功完成无缓存构建、认证 RPC、WebUI、Pi 与正常停机。基础镜像实际为 Debian 13 trixie；`oven/bun:1.4.2-slim` digest 为 `sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61`。

以下为同次 `apt-get update` 后安装选中的候选版本，不等同于各项目上游最高版本：

| 显式系统依赖 | 镜像安装版本 / 构建时发行版候选 |
| --- | --- |
| ca-certificates | 20250419；APT 明确报告已是最新候选 |
| git | 1:2.47.3-0+deb13u1 |
| ripgrep | 14.1.1-1+b4 |
| curl | 8.14.1-2+deb13u7 |
| gnupg | 2.4.7-21+deb13u1 |
| python3 | 3.13.5-1；构建工具，不是产品固定的 Python 3.12.15 |
| make | 4.4.1-2 |
| g++ | 4:14.2.0-1 |
| nodejs | 24.22.0-1nodesource1；容器已达到建议的 Node 24 LTS 补丁，本机开发版本仍待更新 |

这 8 项显式 apt 依赖在构建时已选用配置仓库的候选版本，当前无需在源码内跨发行版替换；后续价值主要在定期重建以吸收发行版安全维护。APT 另报告 13 个基础镜像包未升级，本次未生成全量 OS SBOM 或执行镜像漏洞扫描，因此不声称整个操作系统包树均为最新。

[安装原始日志](dependency-audit-2026-10-16/container-image-build-2026-10-17.log)与[逐项补充证据](dependency-audit-2026-10-16/container-observed-2026-10-17.json)保留版本行、来源、构建时间、源码及产物身份，并加入 SHA-256 清单。RPC 的 `system:versions.node` 是 Bun 进程的兼容元数据，不能替代系统 Node 安装版本。
