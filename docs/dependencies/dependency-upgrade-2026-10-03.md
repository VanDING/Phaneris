# 依赖升级执行记录

基准：`029b3b9cc46a40b5094214e4fa54a2e810bee2d9`。工作分支：`codex/dependency-upgrade-20261003`。
审计依据：[依赖版本与升级评估](./dependency-audit-2026-10-03.md)。

升级后的产品能力接入、MCP 1.32 无状态 transport 兼容修复与完整验收见 [能力采用指南](../architecture/capability-adoption-2026-10.md)及[闭合记录](../process/capability-completion-2026-10-04.md)。本页保持依赖升级批次的当时结果。

按报告分批执行了全部建议升级，采用报告推荐的**兼容版本**而非一律追 `latest`；报告标记暂缓的主版本（Sentry 8/11、KaTeX 0.19、uuid 14、Node Current 26）保持不动。JS 依赖清单的 54 个升级目标已逐项核对，全部落在报告指定版本（见下方“逐项目标核对”）。

## 1. 批次结果

| 批次 | 范围 | 状态 |
| --- | --- | --- |
| A | Baileys、brace-expansion、pypdf、cache 补丁、Docker/worker Node 24 | 已实施并验证 |
| B | MCP/网络传递树、uv/Python/MarkItDown、CI SHA | 已实施并验证 |
| C | Electron、builder/updater、sharp 全平台包 | 已实施并验证 |
| D | Tiptap/ProseMirror/Shiki/Motion/Joi、面板、i18n、日期与图标、KaTeX | 已实施并验证 |
| E | ESLint、`@types/node` 运行时对齐、Sentry 兼容组合、构建工具 | 已实施并验证 |
| F | 完整门禁、生产构建、端到端验证、逐项核对 | 已完成 |

## 2. 安全项（P0/P1）

| 项 | 处理 | 结果 |
| --- | --- | --- |
| Baileys 消息伪造 | `@whiskeysockets/baileys` 由 `^6.17.16` **精确固定为 `6.7.24`**；`^6.7.24` 会解析回被弃用的 6.17.x，故不用范围 | 传递树同步刷新：`music-metadata` 7.14.0 → **11.16.1**、`file-type` 16.5.4 → **21.3.4**，两条历史公告从审计中消失 |
| pypdf 6 条 HIGH | `pdf_tool.py` 的 PEP 723 固定版本 → **6.19.0** | 实测工具环境解析到 `pypdf 6.19.0`（见 §5） |
| brace-expansion | 三条分支各自到位：**1.1.21 / 2.1.7 / 5.0.12**，未跨 major 强制统一 | 3 条 HIGH/MODERATE 公告从审计中消失 |
| http-cache-semantics（无上游修复） | 保留并扩充本地补丁 `patches/http-cache-semantics@4.2.0.patch`：`maxAge() <= 0` 的策略不得被 `max-stale` / `stale-while-revalidate` 复活 | 23 项缓存与 OCR 端到端断言全通过；公告按“已本地修复”记入基线 |
| fast-uri / ip-address / DOMPurify | **3.1.8 / 10.7.3 / 3.4.16** | 三条公告从审计中消失 |
| node-tesseract-ocr（无上游修复） | 保留 `execFile` 补丁；扫描器仍按版本报 CRITICAL | 以真实子进程断言参数未被 shell 解释 |
| Docker Node | `Dockerfile.server` 的 `NODE_MAJOR` 20 → **24**；`--target=node20` → **node24**（worker 与 electron 主进程构建各一处） | Node 20 已于 2026-04-30 EOL，且低于 Pi 1.0.0 的 `>=22.19.0` |

**审计门禁结果**：`bun audit` 由 **11 条去重公告（1 CRITICAL / 4 HIGH / 5 MODERATE / 1 LOW）降到 2 条**，且这 2 条均已本地修补。`bun run audit:dependencies` 通过，基线按实际情况更新（移除已消失项，新增经修补的 cache 公告）。

## 3. Python 工具运行时

- 打包 uv：**0.12.10 → 0.12.22**（`scripts/build/common.ts`），并用发布构建同一条校验下载路径刷新了 `apps/electron/resources/bin/win32-x64/uv.exe`，校验和与自报版本均已验证。
- **解释器固定到精确补丁 3.12.15**，不再写 `--python 3.12`。这是本次唯一一处超越报告字面建议的改动，原因是实测证明了报告指出的风险：

  ```
  uv 0.12.22 + 已缓存 cpython-3.12.12：
    uv python find 3.12     -> cpython-3.12.12   # 旧补丁继续被复用
    uv python find 3.12.15  -> 下载并安装 3.12.15
  ```

  uv 优先复用“已装好的托管解释器”，所以 `--python 3.12` 会让用户永久停在首次缓存的补丁上。精确补丁要么命中要么下载，机制上不可能落后于安全基线。已同步修改 8 个工具的 16 个包装脚本与 `resolve-script-runtime.ts`。
- MarkItDown：**0.1.7 → 0.1.8**（`doc_diff.py`、`markitdown_cli.py`）。
- 新增 `bun run runtime:check`（`scripts/check-python-runtime-pin.ts`）：校验解释器补丁为精确版本、16 个包装脚本与解析器一致、打包 uv 与 `UV_VERSION` 一致。已并入 `validate:ci`。

## 4. 版本漂移防护（新增）

升级过程中发现两类“改了依赖却不会生效”的固定点，均已加门禁：

| 门禁 | 防止的问题 |
| --- | --- |
| `bun run electron-pin:check` | `apps/electron/electron-builder.yml` 的 `electronVersion` 是字面量，electron-builder 不解析 `package.json` 的范围。原本固定 `44.4.3`，只升级依赖会让安装包继续携带旧运行时。已改为 `44.5.1` 并加校验。 |
| `bun run runtime:check` | Python 补丁与打包 uv 的静默漂移（见 §3）。 |

两个门禁同时并入 `validate:ci`（ubuntu 的 `validate` 作业）与 `validate.yml` 的 `quality-windows` 作业：后者原先只单独调用 typecheck/lint/i18n，不经过 `validate:ci`，而 `.cmd` 包装脚本恰恰由它覆盖。

## 4.1 Shiki 内部包去重

`@pierre/diffs@1.5.1` 声明 `@shikijs/transformers: "^3.0.0 || ^4.0.0"`，但解析停在 `4.4.3`，于是树里同时存在 `@shikijs/core` / `@shikijs/types` 的 **4.4.3 与 4.5.0 两份**——正是报告要求“统一到 4.5.0、避免内部包不匹配”要防止的状态。已在 `package.json` 增加 override `"@shikijs/transformers": "4.5.0"`，现在 10 个 `@shikijs/*` 包全部为 4.5.0，无重复实例。

## 5. 验证与产物

所有日志与机器可读产物在 `.cache/dependency-upgrade-20261003/after/`（CSV/JSON 报告同时在仓库根 `.cache/dependency-upgrade-20261003/`）。

| 验证 | 结果 |
| --- | --- |
| `bun run validate:ci`（含 typecheck 14 个 workspace、lint、shared/UI/Python 测试、4 个 i18n 门禁、identity、version、runtime、electron-pin） | **exit 0** |
| `bun run typecheck:all` | 通过，无新增错误 |
| `bun run lint` | 0 error；116 + 3 warning，与升级前基线**逐条一致** |
| Python 文档工具 8 套件 | **24/24 通过**（`after/doc-tools.log`） |
| pdf 工具实际运行环境 | `python 3.12.15` + `pypdf 6.19.0`（`after/report-pdf-env.py`） |
| `verify-dependency-upgrade-security.cjs` | **23/23 通过**：11 类缓存场景 × 2 种 `max-stale` 表达 + OCR 参数注入（`security-e2e.json`） |
| `verify-wa-worker.cjs` | **6/6 通过**：真实 Node 子进程驱动构建产物，Baileys 模块图链接、协议版本 `2.3000.1043857760`、认证目录创建、心跳存活、干净退出（`wa-worker-e2e.json`） |
| `verify-server-e2e.cjs` | **6/6 通过**：登录门禁、错误口令 401、正确口令签发会话、鉴权后 WebUI 资源、错误 token 拒绝、正确 token `handshake_ack`（`server-e2e.json`） |
| 生产构建 | Electron（含 `validate-assets` 10 项）、WebUI、Viewer、WhatsApp worker 全部成功（`electron-build.log`、`webui-build.log`、`viewer-build.log`） |
| sharp 原生链路 | `sharp 0.35.5` / `libvips 8.18.7`，PNG→resize→JPEG 管道实际出图 |
| `bun run audit:dependencies` | 通过，2 条已知公告（均已修补） |
| `bun run test:critical` / vault / recovery / bundle-report 单测 | 通过（`after/test-critical.log`、`after/recovery.log`） |
| 重复实例检查 | `@tiptap/*` 37 个包、`@shikijs/*` 10 个包、`sharp`、`react`、`motion` 均为单一版本；ProseMirror 各子包唯一 |

## 5.1 保留的重复实例（有意为之）

`.cache/dependency-upgrade-20261003/check-duplicates.cjs` 报告 4 处同名多版本，逐项确认均**不应**强制统一，全部与报告结论一致：

| 包 | 版本 | 说明 |
| --- | --- | --- |
| `katex` | 0.16.47（`rehype-katex`、`micromark-extension-math`、`mermaid`）+ 0.18.10（直接声明） | 三个父包声明的都是 `^0.16.0` / `^0.16.47`。报告只把**直接声明**固定为 0.18.10，并明确反对跨范围强制统一；0.18 相对 0.16 有行为变更，强行提升会让这些渲染路径依赖未经其声明的版本 |
| `undici` | 8.11.2（直接）+ 8.10.2 / 7.29.1 / 6.28.1（`pi-coding-agent`、`@electron/get`、`node-gyp`） | 报告原文即“旧 6/7 系列传递副本跟随各自父包”；直接声明已到 8.11.2 |
| `ws` | 8.22.0（直接）+ 7.5.13（`react-devtools-core`） | 报告已把 `react-devtools-core → ^7` 列为既有差异，已接受 |
| `@sentry/core` | 10.75.0（直接）+ 10.73.0（`@sentry/vite-plugin` → `@sentry/bundler-plugins`） | 后者是**构建期**插件依赖，不进 renderer；报告关心的是 renderer 端不混用两套运行时 SDK，该目标已达成 |

## 5.2 未通过的门禁：renderer 体积预算（升级前即失败）

`bun run bundle:report --check` 失败：`renderer initial 4967600 > 4800000`。为判定是否本次升级引入，在 base commit `029b3b9c` 建了独立 worktree、按其锁文件重装并重建：

| | renderer 初始 | 结论 |
| --- | --- | --- |
| base commit `029b3b9c` | **4,956,425 B（4.73 MB）** | 已经超出 4.8 MB 预算 **156,425 B** |
| 本次升级后 | **4,967,600 B（4.74 MB）** | 相对 base 增加 **11,175 B** |
| `main.cjs` | base 19.75 MB → 现在 20.05 MB | 25 MB 预算内，通过 |

即：这是**升级前就存在**的失败（CI 的 `full-validation` 作业在 base commit 上同样会红），本次升级只贡献了约 11 KB。我没有改动预算值——把门禁调绿以掩盖一次真实超标不应顺手做；是否提交体积优化或调整预算，建议单独决定（见 §7）。

## 6. 逐项目标核对

审计 CSV 中标记为升级的 63 行，加上非包环境项，最终：

- **54/54** JS 升级目标落在报告指定版本（`.cache/dependency-upgrade-20261003/verify-targets.cjs`）。其中 9 个 `@img/*` 与 `@rollup/rollup-win32-arm64-msvc` 受 npm `os`/`cpu` 门控，在本机 win32-x64 不安装，已按锁文件解析版本核对。
- 传递依赖刷新：`music-metadata 11.16.1`、`file-type 21.3.4`、`fast-uri 3.1.8`、`ip-address 10.7.3`、`dompurify 3.4.16`、`brace-expansion 1.1.21 / 2.1.7 / 5.0.12`。
- 报告要求“保持”的项目未改动（Sentry 主版本、KaTeX 0.19、uuid 14、React 19.3.0、Pi SDK 1.0.0、pdfjs-dist 6.3.289、xlsx CDN 0.20.3 等）。

## 7. 未执行项与限制

诚实记录本次无法在本机完成、或按报告判断不该做的部分：

| 项 | 原因 |
| --- | --- |
| Docker 镜像固定 digest、apt 版本盘点 | 本机未安装 Docker，且 `hub.docker.com` / `registry-1.docker.io` 在本网络不可达；`Dockerfile.server` 已改用 Node 24，但镜像重建与 SBOM 需在有 Docker 的环境执行 |
| 容器内构建与两种子进程验证 | 同上 |
| VS 2022 17.14.41 / Windows SDK 26100 维护更新 | 需要管理员权限的独立安装器；当前工具链已实测可用，报告本身也只要求先取维护修复 |
| macOS / Linux 原生加载验证 | 本机为 win32-x64；`@img/*` 与 `@rollup/*` 平台包已按锁版本核对，运行时验证需对应平台 |
| WhatsApp 真实握手完成 | `web.whatsapp.com:443` 在本网络被阻断（HTTP 与 WebSocket 均超时）。worker 已走到协议协商并被 WhatsApp 边缘返回 408，模块图与加密栈正常；扫码登录与消息收发需在可访问该域名的环境复核 |
| 安装器签名与自动更新链 | 本机无代码签名证书（安装包与 `windowframe.dll` 均为 `NotSigned`），因此只验证了安装包能构建、解包客户端能启动，没有验证签名链、SmartScreen 表现，以及从旧版差分更新到本版 |
| Windows 安装/卸载实操 | 未在真实用户环境执行安装与卸载；本次验证到“解包目录的客户端能启动并开出主窗口”为止 |
| RTK 0.51.0、Tesseract 5.5.3 | 报告标记为“仅对已启用的环境”的条件升级；本机未安装，属用户侧可选集成 |
| `scripts/fix-lockfile.cjs` | 一次性 lockfile 修补脚本，目标版本（prosemirror 1.25.4→1.25.11）已不存在于当前锁文件。未删除以免超出本次范围，但该脚本已无作用 |
| renderer 体积预算 | 门禁当前为红，且升级前即红（详见 §5.2）。未调整预算值，需要单独决策 |
| `@rollup/rollup-win32-arm64-msvc` | 已按报告升到 4.64.0，但整棵树里**没有任何 `rollup`**（Vite 8 用 Rolldown），该根依赖是孤立未使用的原生包，会为 win32-arm64 用户多带一份二进制。报告已要求“先确认此根依赖用途”；本次只如实记录，未删除 |

## 8. 复现入口

```bash
bun install                                   # 依赖树
bun run validate:ci                           # 完整门禁（含新增 runtime:check / electron-pin:check）
bun run audit:dependencies                    # 安全基线门禁
bun run build:wa-worker                       # 重建 WhatsApp worker
node scripts/verification/verify-dependency-upgrade-security.cjs
node scripts/verification/verify-wa-worker.cjs
bun run .cache/dependency-upgrade-20261003/refresh-bundled-uv.ts   # 刷新打包 uv 并校验
node .cache/dependency-upgrade-20261003/verify-targets.cjs         # 逐项目标核对
```

服务端端到端验证需要先启动服务：

```bash
PHANERIS_RPC_PORT=9311 PHANERIS_RPC_HOST=127.0.0.1 \
PHANERIS_SERVER_TOKEN=<32+ 字符> PHANERIS_WEBUI_DIR=apps/webui/dist \
PHANERIS_BUNDLED_ASSETS_ROOT=$PWD/apps/electron bun run packages/server/src/index.ts

PHANERIS_RPC_PORT=9311 PHANERIS_SERVER_TOKEN=<同一个 token> \
node scripts/verification/verify-server-e2e.cjs
```

本地客户端打包（GitHub 不可达时需先预置缓存）：

```bash
node scripts/verification/seed-electron-artifacts.cjs   # 预置 Electron / ffmpeg 产物并校验
bun run electron:dist:win                               # 构建 + 打包
node scripts/verification/verify-packaged-client.cjs    # 核对打包内容
node scripts/verification/verify-packaged-launch.cjs    # 启动解包客户端并确认主窗口
```

## 9. 修改实现前确认的失败模式

这些是实施前先写下、再用上述验证逐一覆盖的失败路径：

- 缓存：`private`、`no-store`、响应 `no-cache`、带 Set-Cookie 的共享响应、无明确授权缓存许可的 Authorization 请求，以及共享 `proxy-revalidate` 响应，被客户端的大值/无值 `max-stale` 或 stale-while-revalidate 复用；同时确认修补不破坏正常公开响应的 fresh/stale 命中（两项正向对照断言）。
- OCR：补丁丢失后语言/配置参数中的 shell 元字符被解释；升级安装树未应用注册的补丁。
- WhatsApp：稳定修复版本重新解析为已弃用 6.17.x；导出形状改变；CJS bundle 启动失败；协议 stdout 污染；关闭后子进程残留。
- Python：解释器缓存让旧补丁继续使用（**已实证并修复**）；直接固定版本更新遗漏另一个脚本（两个 markitdown 脚本一起更新）；工具环境实际解析版本与声明不一致（已实测核对）。
- 原生/发布：sharp 与平台包不一致；安装器 `electronVersion` 与依赖漂移（**已实证并修复**）。
- 编辑器/UI：Tiptap/ProseMirror 版本不一致导致重复实例；生产构建失败。
- 工具链：Node 类型允许实际运行时不存在的 API（`@types/node` 对齐 24.19.1 后完整 typecheck 通过）。

## 10. 本地客户端打包（批次 C 的产物级验证）

在本机（Windows x64）用升级后的 Electron 44.5.1 / electron-builder 26.17.0 完整打包了一次客户端。

```bash
bun run electron:dist:win          # 构建 + 打包
```

产物：`apps/electron/release/Phaneris-0.2.4-win-x64.exe`，**180.31 MB**（升级前的 0.2.4 安装包为 165.45 MB，+14.9 MB；主要来自 Electron 44.5.1 与新增依赖），另有 `.blockmap`（保留差分更新能力，配置项 `differentialPackage: true` 未被破坏）。

| 打包阶段 | 结果 |
| --- | --- |
| electron:build（main / preload / renderer / resources / assets / **validate-assets**） | 全部通过 |
| 安装器皮肤 `windowframe.dll`（x86 + 静态 CRT，MSVC 实测编译） | 编译成功 |
| 运行时准备（Bun 1.4.2 复用缓存、uv 0.12.22 已在位） | 通过 |
| Electron 44.5.1 运行时注入 + ffmpeg 注入 | 通过（见下方网络问题） |
| NSIS 构建 installer + uninstaller + blockmap | 成功，退出码 0 |
| 签名 | 未配置证书，按预期跳过（`NotSigned`） |

### 打包内容的独立核对

`node scripts/verification/verify-packaged-client.cjs` — **15/15 通过**：

- 打包运行时版本 = `electron-builder.yml` 的 `electronVersion`；可执行文件以 Node 模式自报 **Electron 44.5.1 / Node 24.21.0 / Chrome 152**（正是报告要求的“Electron 内嵌 Node 随 44.5.1”）
- 随包 Bun 自报 1.4.2、随包 uv 自报 0.12.22，与仓库声明一致
- 8 个 CLI 包装脚本 + 8 个 PEP 723 脚本在 app.asar **之外**的磁盘路径上（子进程无法从 asar 内执行）
- 打包后的 `pdf-tool.cmd` 仍请求 `--python 3.12.15`，与 `TOOL_PYTHON_VERSION` 一致（§3 的固定在打包链路里没有被冲掉）
- WhatsApp worker、Pi agent server、ripgrep 二进制、node-pty 原生模块均已就位

`node scripts/verification/verify-packaged-launch.cjs` — **5/5 通过**：进程常驻、Electron 进程树存在、**GUI 主窗口创建成功**、无模块解析/ABI 致命错误。产物证据写入 `.cache/dependency-upgrade-20261003/packaged-client.json` 与 `packaged-launch.json`。

### 打包过程中遇到并解决的问题

1. **`sharp` 不该出现在桌面客户端里**（自检修正）。`server-core/src/runtime/platform.ts` 在 Electron 下走 `nativeImage`，`sharp` 只在无头 Node 服务器的 `platform-headless.ts` 里 `import('sharp')`。最初把“打包里必须有 sharp”写成断言是错的，已改为断言 node-pty，并加一条注释说明 sharp 属于服务端产物。

2. **生产构建不写日志是设计行为**（自检修正）。`logger.ts` 在非 debug 模式下设 `log.transports.file.level = false`，所以“打包后启动没有新日志”不是故障。已把启动判据改为进程树 + 主窗口标题。

3. **`ELECTRON_RUN_AS_NODE` 环境变量会伪装成崩溃**。它一旦存在于父环境，`Phaneris.exe` 就退化成纯 Node 解释器：启动、什么都不做、`exit 0`，且不产生任何窗口或日志——从外部看与崩溃无法区分。验证脚本现在显式剔除该变量；`--version` 打印 `v24.21.0` 正是这个变量导致的假象。

4. **GitHub Releases 在本网络不可达，打包卡死 10 分钟**。electron-builder 注入 ffmpeg 时通过 `@electron/get` 下载，**不会**转发 `electronDownload` 的 mirror，因此固定走 `github.com/electron/electron/releases/download/v44.5.1/ffmpeg-v44.5.1-win32-x64.zip`，而该域名在此网络超时（与 §7 的 WhatsApp 域名同因）。

   解决办法不是改产品，而是按 electron-builder 官方“离线/气隙”约定预置缓存，脚本为 `scripts/verification/seed-electron-artifacts.cjs`：

   ```bash
   node scripts/verification/seed-electron-artifacts.cjs          # 从 npmmirror 预置并校验
   node scripts/verification/seed-electron-artifacts.cjs --check   # 只校验
   ```

   预置三项：`SHASUMS256.txt-<ver>`（让校验可离线进行）＋ 两个 artifact zip（放在 `@electron/get` 按 **GitHub URL** 推导出的缓存键目录下）。两个 zip 的 SHA-256 均与镜像的 SHASUMS 对照通过。

   两个坑值得记下：`@electron/get` 的缓存键是“解析后目录 URL 的 SHA-256”，所以用镜像 URL 预置会写进一个没人读的目录；而真实 URL 里版本号带 `v` 前缀（`/download/v44.5.1/`），我第一版按 `/download/44.5.1/` 预置，同样无效——是靠 `DEBUG='@electron/get:*'` 打出真实 URL 才定位到的。

## 11. 需要单独决定的事项

本次升级自身已闭合；以下三项超出“依赖升到报告指定版本”的范围，留给维护者决定：

1. **renderer 体积预算**（§5.2）。门禁在 base commit 上即失败，本次升级仅增加 11 KB。两个选项：做一次真实的拆包优化，或把预算调整到当前的 4.97 MB 并注明依据。两者都不应在依赖升级提交里顺手完成。
2. **`@rollup/rollup-win32-arm64-msvc`**（§7）。报告要求确认这个根依赖的用途；结论是整棵树没有 `rollup` 消费者。可以考虑删除。
3. **`scripts/fix-lockfile.cjs`**（§7）。已被 bun 的锁文件解析取代，目标版本不再存在。
