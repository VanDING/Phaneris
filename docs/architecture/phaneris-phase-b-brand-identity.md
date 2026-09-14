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

`@craft-agent/*` → `@phaneris/*`，563 个文件，1845 行增 / 1845 行删，纯 token 替换。根包 `craft-agent` → `phaneris`。`bun.lock` 由 `bun install` 重生成。凭据格式常量（`CRAFT01` 魔数、`craft-agent-v2` 派生标签）属于**磁盘格式参数而非标识**，有意不动，留待 C 阶段连同凭据路径一起处理。

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

## 3. 本阶段引入的破坏性变更

1. **数据目录默认值改变**。`~/.craft-agent`（本机 8,644 MB 活数据）不再是默认根。新安装写入 `~/.phaneris`。在 C 阶段（导入引擎）完成之前，继续使用旧数据的唯一方式是显式设置 `PHANERIS_CONFIG_DIR=~/.craft-agent`——那是一条过渡桥接，不是受支持的迁移路径，且会打印警告。
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
| i18n key 名 | `menu.aboutCraftAgents`、`menu.hideCraftAgents`、`menu.quitCraftAgents`、`onboarding.apiSetup.craftAgentsBackend` 等键名仍含旧品牌 | 可延后：仅内部标识，用户不可见；改动需同步 6 个 locale 与排序校验 |
| 代码标识符 | `CraftAgent` 类名与其兼容别名、若干 `craftAgent` 局部名 | 可延后：属于内部 API；方案未要求公开 API 改名 |
| 版本号 | 根包仍为 `0.13.3` | F 阶段：首个独立版本（暂拟 `0.14.0`），禁止版本倒退 |
| 上游归属核对 | `NOTICE` 未改动；`LICENSE` 为 Apache-2.0 原文 | 发布前核对 NOTICE 与 TRADEMARK 的适用范围 |

## 5. 残留标识的可度量状态

`bun run identity:check` 的计数在三个阶段之间单调下降：

| 阶段 | 未豁免命中 | 文件数 |
|---|---|---|
| A 阶段结束（清点基线） | 5686 | 874 |
| 环境变量改名后 | 1729 | 358 |
| 本阶段结束（应用身份与本地品牌表面） | 920 | 212 |

剩余命中集中在：`.craft-agent` 路径字面量（主要在测试夹具与 `permissions/default.json` 之类的**上游默认配置样本**）、上游域名（D 阶段）、`CraftAgent` 代码标识符、以及 `Craft Docs Ltd.` 版权/归属（有意保留）。允许列表里每条规则都带理由，且不再命中的规则会被报告要求删除。

## 6. B 阶段放行判定

已满足：技术身份贯穿桌面、Web UI、CLI、服务端与打包配置；图标为真实平台资产而非网页图片；内部包、环境变量、路径与协议各自单一来源；`typecheck:all` 与三项 i18n 校验通过；安装脚本不会再装出上游产物。

未满足（因此**不可对外发布**）：服务端点与更新链路仍指向上游（D 阶段）；仅 Windows 可验证；导入引擎不存在，旧数据只能靠过渡桥接访问（C 阶段）；TRADEMARK 未补自有条款。
