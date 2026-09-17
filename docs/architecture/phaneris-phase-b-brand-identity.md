# Phaneris 分叉 B 阶段记录：品牌与代码身份

日期：2026-09-14。分支 `phaneris/fork-plan`。对应[实施方案](phaneris-fork-plan.md)第 8 节的 B 阶段（品牌与代码身份）。A 阶段的身份冻结记录见 [Phaneris 分叉 A 阶段记录](phaneris-phase-a-identity-freeze.md)。

状态：B 阶段的代码身份、应用身份、数据路径与本地品牌表面已完成并验证可构建。**服务与发布渠道仍指向上游**（方案 D 阶段），因此本阶段不构成"可以对外发布"的结论。

## 1. 本次落地的身份

| 项目 | 落地值 | 实现位置 |
|---|---|---|
| 产品名 / 完整名 | `Phaneris` / `Phaneris Agent` | `phaneris.identity.json` → `identity.generated.ts` |
| app ID / AUMID | `io.github.vanding.phaneris` | `apps/electron/identity.generated.yml`（electron-builder `extends`） |
| 深链接协议 | `phaneris://` | `packages/shared/src/identity.ts` 单点解析 |
| Electron userData | `%APPDATA%\Phaneris`（显式 `app.setPath`） | `apps/electron/src/main/index.ts` |
| 数据根目录 | `~/.phaneris`（`PHANERIS_CONFIG_DIR` 可覆盖） | `packages/shared/src/config/paths.ts` |
| 环境变量前缀 | `PHANERIS_` | `identity.generated.ts` 的 `ENV_PREFIX` |
| 内部包命名空间 | `@phaneris/*`（13 个 workspace 包） | 各 `package.json` |
| CLI / 代理命令 | `phaneris`（`bin/phaneris`、`bin/phaneris.cmd`、`apps/cli` bin） | `apps/electron/resources/bin/`、`apps/cli/package.json` |
| 安装产物 | `Phaneris-<version>-<os>-<arch>.<ext>` | `identity.generated.yml`，构建脚本按模板推导 |
| 版权行 | `Copyright © 2026 VanDING. Based on Craft Agents, Copyright © 2026 Craft Docs Ltd.` | `identity.generated.yml` |

## 2. 完成的工作

### 2.1 内部包机械改名

`@craft-agent/*` → `@phaneris/*`，563 个文件，1845 行增 / 1845 行删，纯 token 替换。根包 `craft-agent` → `phaneris`。`bun.lock` 由 `bun install` 重生成。凭据格式常量（`CRAFT01` 魔数、`craft-agent-v2` 派生标签）属于**磁盘格式参数而非标识**，有意不动：它们是磁盘格式参数，改了会读不出既有凭据（迁移已利用这一点，见第 2.7 节）。

验收：`bun run typecheck:all` 退出码 0，覆盖 13 个 workspace 包外加 webui、viewer、build、scripts 四个工程。

### 2.2 环境变量前缀

`CRAFT_*` → `PHANERIS_*`，159 个文件，覆盖运行时代码、构建脚本、安装脚本、Dockerfile、工作流、文档与测试。改名按**环境访问上下文**锚定（`process.env.X`、`$X`、`%X%`、`env["X"]`、`X=`、`X:`），因此仅以 `CRAFT_` 开头的普通标识符（局部常量 `CRAFT_DISPLAY_NAME_KEY`、导出的 `CRAFT_LOGO`、私有窗口标记 `__CRAFT_THEME_OBSERVER_CLEANUP__`）不被误改。

旧名继承遵循方案的边界：

- **Automations 是唯一用户自撰的契约**。`buildWebhookEnv` 仍读取 shell profile 里的 `CRAFT_WH_*`，并输出一次性弃用提示指出要改成的名字；两者同时存在时新名优先。注入给脚本的变量只使用新前缀。
- **工作流**优先读新的 Actions secret，旧 secret 作为回落，使 CI 在仓库 secret 改名（外部操作）之前不中断。
- **凭据、数据目录、更新源不继承任何旧值**：`CRAFT_CONFIG_DIR` 被显式忽略（见 2.4）。

### 2.3 图标与品牌资源

以 `apps/electron/resources/icon.svg` 为唯一图稿来源，新增跨平台生成器 `scripts/generate-icons.ts`（`sharp` + 手写 ICO/ICNS 容器，无新增依赖、无需联网），产出全部平台资产；旧的 `craft-logos/` 删除，`phaneris-logos/` 接替。

渲染器侧：`CraftAgentsLogo` / `CraftAgentsSymbol` 两个组件删除，由 `PhanerisSymbol`（以 `currentColor` 渲染 Phaneris 标记，沿用主题 accent 的用法）与 `PhanerisAppIcon` 接替；旧 SVG 资源替换为 Phaneris 标记。

验收：连续生成两次，9 个产物字节完全一致；`icon.ico` 解析为 7 个 PNG 条目（16/24/32/48/64/128/256），`icon.icns` 为 8 个 PNG 元素且声明长度与文件大小一致。

### 2.4 应用身份与路径

- **userData 显式固定**为 `Phaneris`，不跟随 `PHANERIS_APP_NAME`（多实例开发覆盖名）与产品名。理由写在代码注释里：跟随显示名会让缓存、锁与单实例锁随标签漂移；与上游并列安装时共用 userData 会争抢 Chromium profile 锁与更新缓存。
- **深链接协议单点解析**：`RESOLVED_DEEPLINK_SCHEME` / `DEEPLINK_PROTOCOL` / `DEEPLINK_SCHEME_PREFIX` 在 `packages/shared/src/identity.ts` 由冻结值加开发期覆盖导出，注册方（主进程）、解析方（`deep-link.ts`）、转发方（`browser-pane-manager.ts`、server-core `system.ts`）全部读取它，不再各自拼字符串。
- **路径收拢**：所有应用自有路径由 `packages/shared/src/config/paths.ts` 单点推导（`CONFIG_DIR`、`CREDENTIALS_FILE`、`WORKSPACES_DIR`、`DOCS_DIR`、`RELEASE_NOTES_DIR`、`PERMISSIONS_DIR`、`THEMES_DIR`、`TOOL_ICONS_DIR`、`LOGS_DIR`、`workspaceDir()`）。此前散落在 17 个模块里的 `join(homedir(), '.craft-agent', …)` 全部改为引用它——方案第 6.1 节"先收拢散落路径，再启用新默认目录"正是为此。
- **`@phaneris/session-tools-core` 保持不依赖 `@phaneris/shared`**（该包有显式的无依赖约定，且反向依赖会形成 workspace 里唯一的包图环）。它需要的应用配置根通过 `SessionToolContext` 注入，由 `packages/shared/src/agent/session-context.ts` 从 resolver 取值填充。
- **`CRAFT_CONFIG_DIR` 不继承**。数据目录属于方案列出的敏感边界，静默继承会让新产品直接读写旧应用的活数据；两个应用同时写一个状态库正是方案禁止的结果。显式把 `PHANERIS_CONFIG_DIR` 指向旧目录仍然允许（作为过渡桥接），但会打印一次醒目警告，说明不会导入或复制任何内容、旧应用不得同时运行、受支持的路径是导入流程。加载器另外拒绝任何与上游标识重合的新身份。

验收：进程内探针以设置/未设置 `PHANERIS_CONFIG_DIR` 两种情形导入 resolver，确认全部派生路径随之改变；interceptor 仍可独立打包。

### 2.5 打包、安装与 CLI 身份

- `electron-builder.yml` 不再声明 `appId` / `productName` / `copyright` / `artifactName`，改为 `extends: ./identity.generated.yml`；`identity:check` 会在这些键重新出现时失败。已用 app-builder-lib 自身的配置加载器验证合并结果：身份键来自生成文件，而 `electronVersion`、`directories`、`files`（14 条归一化后仍完整）、`extraResources`（11 条）保持原样。
- `afterPack.cjs` 不再硬编码 `Craft Agents.app`，改用 `context.packager.appInfo.productFilename`，并在取不到时明确跳过 Liquid Glass 图标而不是静默继续。
- `build-dmg.sh` / `build-linux.sh` 的产物校验不再硬编码产物名，改为从 `identity.generated.yml` 读出 `artifactName` 模板并代入版本/平台/架构；`scripts/build/common.ts` 的 `getArtifactName()` 同样从模板推导（此前是无人调用的死代码，且与模板不一致）。
- `install-app.sh` / `install-app.ps1` 不再下载上游产物：feed 基址改为必填的 `PHANERIS_RELEASE_BASE_URL`，未设置时**拒绝运行**并说明原因。当前没有 Phaneris 自有发布渠道（D 阶段），因此这两个脚本现在会明确失败而不是装出别家的东西。
- CLI 身份统一：`apps/cli` 的 bin 由 `craft-cli` 改为 `phaneris`，帮助文本、文档（`docs/cli.md`、`resources/docs/phaneris-cli.md` 及其 5 处交叉引用）与系统提示中的 CLI 段落同步；代理侧包装脚本改名为 `bin/phaneris` / `bin/phaneris.cmd`。

### 2.6 本地品牌表面

- i18n：6 个 locale 的产品名与 `.craft-agent` 路径文案全部改为 Phaneris。**第三方 Craft 服务（craft.do）作为 source 集成名称一律保留**——`{source:Craft}`、`Connect my Craft space`、`Log In with Craft`、reauth 文案都属于合法集成引用，方案第 7.1 节明确禁止按名字误删。三项 i18n 校验（parity / sorted / coverage）全部通过。
- 应用名、菜单标签、窗口标题、错误文案、eslint 规则说明、主题作者、文档工具默认作者、issue 模板、CONTRIBUTING、两份 README 全部更新。
- README 保留英文与中文两份，并保留"Built on Craft, with gratitude"上游归属段落与 `NOTICE`。

### 2.7 本机数据迁移（替代 C 阶段引擎）

方案第 6 节的导入引擎是为**迁移其他人的机器**设计的：目标侧 staging、可重试状态机、冲突报告、暂停自动化、跨机器凭据重加密。本机只需要迁一次、迁完旧应用即退役，那些机制都成了围绕两个动作的仪式：复制，然后修正指向旧根目录的路径。因此以一次性脚本 `scripts/migrate-legacy-profile.ts` 完成，并明确记录它不做哪些事。

**我在这里判断错了一次，代价是应用起不来。** 初版脚本把 `credentials.key` / `credentials.enc` 一起复制，理由写的是"fork 没改凭据格式与派生参数，所以直接复制即可用"。**这个理由是错的**：vault 的文件格式（`CRAFT01` 魔数、`craft-agent-v2` PBKDF2 标签）确实没变，但 `credentials.key` 不是 vault 格式的一部分——它是被操作系统保护的 blob，保护本身**绑定到写出它的可执行文件**。本机该文件以 `v10` 开头（Chromium app-bound encryption），因此改名为 `Phaneris.exe` 后无法解开。

后果不是"凭据读不出来"这么简单，而是一条完整的故障链：

1. `safeStorage.decryptString` 失败 → `installElectronCredentialKeyProvider()` 抛错；
2. 该调用位于 `app.whenReady().then(async …)` 链的**最前面**，而这条链**没有 `.catch()`**；
3. 抛出把整条启动链中断——包括创建窗口——但 Electron 事件循环继续运行；
4. 结果是**进程活着、后台服务照常（自动化在跑、配置监听在跑）、但永远没有窗口**，且日志里只有一行 `Unhandled rejection at: {} reason: {}`（Error 被序列化成了空对象）。

修正：迁移**排除** `credentials.key` 与 `credentials.enc`。复制它们不但保不住访问权，还保证新应用既解不开旧密钥、也无法生成新密钥。连接与 source 本身照常迁移，只是密钥需要重新授权一次。验证：新应用自建密钥（日志 `using OS-protected credential key`），窗口正常出现，凭据读取错误 0 次。

顺带修掉的三处"让故障更难查"的缺陷（都不是掩盖症状，而是让失败可见）：
- `unhandledRejection` / 启动失败改为打印**堆栈**。原先 electron-log 把 Error 序列化成 `{}`，等于报了个没有内容的错。
- `whenReady` 链加上 `.catch()`：启动失败时写日志并弹错误框，而不是留下一个没有窗口的进程。
- `installElectronCredentialKeyProvider()` 的失败在调用点被捕获并降级到机器 id 派生——该函数的文档契约本就是"返回 null 表示应使用回落"，调用点却既不接返回值也不接异常。
- `window-manager.ts` 增加 8 行纯观测（`did-finish-load` / `render-process-gone`），不改变窗口显示时机。

**一次被我自己否掉的"修复"**：排查中我给 `ready-to-show` 加过 15 秒兜底定时器，窗口确实出来了。但那是**掩盖症状**——它掩盖的是 dev 模式下 Vite 首次优化依赖导致的首次绘制变慢，而不是真实缺陷。回退该兜底后实测：窗口创建 → `Renderer finished loading` 仅隔 1.3 秒 → 窗口正常显示。上游的 `ready-to-show` 机制没有问题，兜底已删除。

执行结果（31,545 文件 / 9.28 GB）：

| 项目 | 结果 |
|---|---|
| 源目录 | 只读，未修改一个字节；迁移可逆（删目标即可） |
| 复制完整性 | 源侧 31,539 个应迁文件**全部**存在于目标（无缺失） |
| 凭据 | **有意不迁移**（OS 绑定到旧可执行文件）；新应用自建密钥，需重新授权一次 |
| 结构化路径改写 | 413 处（`config.json` 2、artifact 索引 88、MCP source `server.py` 1、session/pi-session 首行 322） |
| 会话首行校验 | 803 个 JSONL 全部解析成功，**0** 个仍指向旧根 |
| `runtime.db` | `PRAGMA integrity_check` = ok，字节数与源一致 |
| 配置文件解析 | 1755/1762 通过；7 个失败项是 agent 在会话/skill 目录里产出的、恰好以 `.json` 结尾的非 JSON 内容文件，与源逐字节相同 |

**刻意不改写**（各有理由，均在脚本头部说明）：`runtime.db` 里约 5.8 万处引用是工具调用的**历史留痕**；work-item 的 `events[]` 记录字段"当时的值"；`preferences.json` 的 `notes`、work-item 标题、以及 4 个定时任务 prompt 正文里的路径——那些是用户写的文字。前两类保持原样，第 4 类经用户确认后作为**独立的一次显式编辑**完成（`C:\Users\dotty\.craft-agent` → `.phaneris`，共 16 处），未混入迁移脚本。

**过程中修掉的两个自身缺陷**（都由"先看结果再下结论"发现，值得记录为同类模式）：

1. **JSON 转义导致静默漏改**。最初对 JSONL 首行做**文本**替换，但 JSON 里的 Windows 路径是转义的（`~\\.craft-agent\\workspaces`），单反斜杠的搜索串永远匹配不到原文——结果只修好了正斜杠的 `~/.craft-agent`，而 `workspaceRootPath` 与 `cwd`（会话恢复依赖的正是它们）全部漏掉。改为解析首行、按值改写后重新拼接原字节。这类缺陷不会报错，只会让会话在旧目录里恢复。
2. **体积上限静默跳过最大的会话**。原本为避免整文件读入而设了 32 MB 上限，恰好跳过了两个最大的会话。改为只读文件头部（JSONL 的结构化部分只有首行），上限随之取消。

另有一个操作教训：第一次复制时旧应用被重新启动，源在复制后发生偏移（`runtime.db` +3.2 MB）。恢复方式不是打补丁而是**重新取快照**——脚本"拒绝并入已存在的目标"这一条正是为此。修复改写规则时则不需要重拷 9 GB，为此增加了幂等的 `--repair`（只重跑改写阶段）。

## 3. 本阶段引入的破坏性变更

1. **数据目录默认值改变**。`~/.craft-agent`（本机 8,644 MB 活数据）不再是默认根。新安装写入 `~/.phaneris`。本机已完成一次性迁移，见第 2.7 节。
2. **环境变量前缀改变**。除 webhook secrets 的旧别名回落外，`CRAFT_*` 不再被读取。
3. **注入给页面/自动化脚本的变量改名**。脚本中引用 `$CRAFT_WORKSPACE_PATH`、`$CRAFT_PAGE_*`、`$CRAFT_EVENT` 等的地方需要改为 `PHANERIS_*`；旧名**不会**同时注入（双份会让脚本无法判断哪个是权威契约）。这一点必须在 F 阶段的迁移指南里写清楚。
4. **Windows 之外的平台未验证**。图标、打包身份与安装脚本的改动在 Windows 上可验证；macOS 的 `.icns` / Liquid Glass 与 Linux AppImage 只有在相应平台实际构建后才能确认（方案 E 阶段）。

## 4. 尚未完成（不阻塞本阶段结论，但阻塞对外发布）

| 项目 | 现状 | 归属 |
|---|---|---|
| 服务端点 | `thecraftagents.com` 仍硬编码在 docs 链接、viewer URL、OAuth relay、Slack 回调、Pages 分享 API、版本清单、包 homepage 中 | D 阶段：改读 `SERVICE_URLS`，`null` 即明确不可用，禁止上游兜底 |
| 更新链路 | `electron-builder.yml` 仍无 `publish` 块，打包产物不含 `app-update.yml`；`auto-update.ts` 的注释仍指向上游域名 | D 阶段：自有 Release 与更新元数据 |
| 分享 Viewer | 指向上游托管 | D 阶段 |
| TRADEMARK.md | 仍是上游商标政策 | 发布前需要补 Phaneris 自有名称/商标段落，同时保留上游 mark 的说明 |
| i18n key 名 | 已完成：`menu.aboutPhaneris` / `menu.hidePhaneris` / `menu.quitPhaneris` / `menu.appMenu` / `onboarding.apiSetup.phanerisBackend` / `onboarding.reauth.loginWithPhaneris` 全部改名，7 个 locale 同步 | — |
| 代码标识符 | `CraftAgent` 类名与其兼容别名、若干 `craftAgent` 局部名 | 可延后：属于内部 API；方案未要求公开 API 改名 |
| 版本号 | 已完成：根包为 `0.1.0`，独立版本行自 `0.1.0` 起（`0988ff03`） | — |
| 上游归属核对 | `NOTICE` 未改动；`LICENSE` 为 Apache-2.0 原文 | 发布前核对 NOTICE 与 TRADEMARK 的适用范围 |

## 5. 残留标识的可度量状态

`bun run identity:check` 的计数在三个阶段之间单调下降：

| 阶段 | 未豁免命中 | 文件数 |
|---|---|---|
| A 阶段结束（清点基线） | 5686 | 874 |
| 环境变量改名后 | 1729 | 358 |
| 应用身份与数据路径落地后 | 920 | 212 |
| 品牌表面收尾后（当前） | 379 | 142 |

剩余 379 条的构成：上游域名 125（D 阶段）、`CraftAgent` 代码标识符 78（内部 API，延后）、`Craft Docs Ltd.` 版权与上游归属 34（有意保留）、其余为测试夹具中的合成路径与 `.craft-agent` 字面量。允许列表中每条规则都带理由，且 `unusedRules` 必须为空——不再命中的规则会被报告要求删除。

## 6. 改名暴露出的三处"只在改名时才失败"的缺陷

这三处都不是文案问题，而是硬编码字符串与身份解耦后**静默失效**的逻辑。已修复，记录在此以便复核同类模式：

1. **interceptor 预载钉死了配置根目录**。`interceptor-common.ts` 改为引用 `CONFIG_DIR` 后，`bunfig.toml` 的 `--preload` 会在任何脚本运行前求值 `config/paths.ts`，于是 `PHANERIS_CONFIG_DIR` 再怎么设置都无效——`*.isolated.ts` 这一"让测试远离开发者真实 profile"的既有模式被静默破坏。现改为按需解析，日志目录创建与轮转也移到首次写日志时。
2. **`url-safety.ts` 用字面量识别自家深链接**。分类器写死 `craftagents:`，于是 `phaneris://` 链接会被判为外部 URL 并交给 `shell.openExternal`。现从身份解析器取值。
3. **`lock-identity.ts` 用 "craft" 子串判断锁持有者**。0.11.3 之前的锁没有记录可执行文件名，只能扫命令行；写死的品牌子串在改名后不再匹配，会把自己的旧锁当成别人的，从而拒绝启动。现从产品名构造（并保留上游名，使旧锁仍被认出）。

同时发现一个**既有**问题：`refresh-connection-runtime` 测试从开发者本机真实配置里解析连接，因此只有在恰好存在 `slug-A` 连接的机器上才通过。已改为 `*.isolated.ts` 并自备符合 schema 的配置夹具（8/8 通过），不再依赖机器状态。

已知的既有失败（与本阶段无关，未修）：`packages/session-tools-core/src/runtime/filesystem-isolation.test.ts` 的 `includes session subpath write allow` 在 Windows 上失败——它把 POSIX 路径 `/tmp/craft-session` 交给 `path.resolve`，在 Windows 上得到 `E:\tmp\craft-session`。该断言在任何 Windows 检出上都会失败。

## 7. B 阶段放行判定

已满足：技术身份贯穿桌面、Web UI、CLI、服务端与打包配置；图标为真实平台资产而非网页图片；内部包、环境变量、路径与协议各自单一来源；`typecheck:all` 与三项 i18n 校验通过；安装脚本不会再装出上游产物。

未满足（因此**不可对外发布**）：服务端点与更新链路仍指向上游（D 阶段）；仅 Windows 可验证；TRADEMARK 未补自有条款。本机数据迁移已完成（第 2.7 节），但它是**一次性、同机**的脚本，跨机器迁移的导入引擎仍未建设——那属于 C 阶段，且只有在真的要迁移第二台机器时才需要。
