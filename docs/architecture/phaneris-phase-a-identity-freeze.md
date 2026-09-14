# Phaneris 分叉 A 阶段记录：身份冻结

日期：2026-09-14。分支 `phaneris/fork-plan`，基线 `b607b6ba`。对应[实施方案](phaneris-fork-plan.md)第 8 节的 A 阶段（身份冻结）放行条件。

状态：A 阶段技术身份已冻结并落入可执行配置；命名空间可用性**只验证了其中一部分**，未验证项在本文件中逐条标注，不得据此对外声明命名空间已归属本项目。

## 1. 本阶段交付物

| 交付物 | 路径 | 说明 |
|---|---|---|
| 身份配置（唯一来源） | `phaneris.identity.json` | 产品名、app ID、协议、目录名、环境变量前缀、包命名空间、CLI 名、服务地址、遗留标识 |
| 身份配置规范 | `scripts/identity.schema.json` | JSON Schema，供编辑器与评审使用；同一契约在加载器里手写强制 |
| 加载与校验 | `scripts/identity-core.ts` | 读取并严格校验；带跨字段不变量（新身份不得与上游标识重合） |
| 生成器 | `scripts/generate-identity.ts` | 渲染运行时常量与打包身份；`bun run identity:generate` |
| 漂移与残留校验 | `scripts/check-identity.ts` | 漂移检查（始终致命）+ 残留扫描（`--strict` 致命）；`bun run identity:check` |
| 残留允许列表 | `scripts/identity-allowlist.json` | 每条都带理由；不再命中的规则会被报告以删除 |
| 生成产物 | `packages/shared/src/identity.generated.ts`、`apps/electron/identity.generated.yml` | 已提交；由 CI 校验与配置保持同步 |

`apps/electron/electron-builder.yml` 不再声明 `appId` / `productName` / `copyright` / `artifactName`，改为 `extends: ./identity.generated.yml`。`check-identity.ts` 会在这四个键于该文件重新出现时直接失败，因此打包配置、构建脚本与运行时代码不可能各自维护不同常量。

## 2. 冻结的身份

以下取值来自 `phaneris.identity.json`，属于"首次打包或注册前冻结"的项。首次发行后再改动，代价从改字符串变成迁移工程。

| 项目 | 冻结值 | 备注 |
|---|---|---|
| 正式产品名 | `Phaneris` | 完整名 `Phaneris Agent` 仅用于散文（关于页、README、安装说明），不用于文件或 bundle 名 |
| app ID / Windows AUMID | `io.github.vanding.phaneris` | 冻结 |
| 深链接协议 | `phaneris://` | 冻结；不接管 `craftagents://` |
| 产品数据根目录 | `~/.phaneris` | 冻结；与 Electron userData 分开管理 |
| Electron userData | `Phaneris` | 冻结；避免与并列安装的上游应用共用缓存与单实例锁 |
| 环境变量前缀 | `PHANERIS_` | 凭据、数据目录、更新源等敏感边界不自动继承 `CRAFT_` 旧值 |
| 内部包命名空间 | `@phaneris/*` | 私有 workspace，不等于占有公开 npm scope |
| 根包 / CLI | `phaneris` | `phan` 仅为文档简写，不安装第二个二进制 |
| 安装产物 | `Phaneris-${version}-${os}-${arch}.${ext}` | 由 `packaging.artifactName` 单点声明 |
| 版权行 | `Copyright © 2026 VanDING. Based on Craft Agents, Copyright © 2026 Craft Docs Ltd.` | 同时标注分叉维护者与上游版权，不覆盖原作者署名 |
| 预览版 | 后缀 `preview` | 若提供预览渠道，必须同时落到 app ID、协议、数据目录与更新缓存 |

上游标识不写进代码，只作为**只读兼容输入**记录在 `identity.json` 的 `legacy` 块：`.craft-agent`、`Craft Agents`、`craftagents`、`CRAFT_`、`com.lukilabs.craft-agent`、`@craft-agent`。加载器会拒绝任何与这些值重合的新身份。

服务地址（`services`）当前全部为 `null`，含义是"服务未就绪"：对应产品面必须显示明确的不可用状态，且**禁止回退到上游端点**。填充时只允许填维护者控制的地址。

## 3. 命名空间与名称可用性验证记录

| 项目 | 验证方式 | 时间 | 结果 | 结论 |
|---|---|---|---|---|
| npm 包名 `phaneris` | `GET https://registry.npmjs.org/phaneris` | 2026-09-14 | HTTP 404 | **未被占用** |
| npm 全库检索 `phaneris` | `GET https://registry.npmjs.org/-/v1/search?text=phaneris` | 2026-09-14 | `total: 0` | 无同名或近似占用的公开包 |
| npm 用户名 / 组织名 `phaneris` | `GET https://www.npmjs.com/org/phaneris`、`GET https://www.npmjs.com/~phaneris` | 2026-09-14 | HTTP 403（Cloudflare 拦截自动化访问）；`registry.npmjs.org/-/user/org.couchdb.user:phaneris` 返回 401（该端点需要鉴权，任何名称都返回 401） | **未验证**——现有手段无法判定；需登录 npm 后在组织创建页确认 |
| GitHub 用户名 / 组织名 `phaneris` | `GET https://github.com/phaneris` | 2026-09-14 | HTTP 404 | 该名称未被注册 |
| GitHub 仓库 `VanDING/phaneris` | `GET https://github.com/VanDING/phaneris` | 2026-09-14 | HTTP 404 | 目标仓库名在维护者账户下可用（尚未创建） |
| 域名 | 未检查 | — | — | **未验证**；方案默认"域名未就绪时关闭依赖云端的入口"，不阻塞 A 阶段 |
| 商标 | 未检查（未检索任何商标数据库） | — | — | **未验证** |

结论与约束：

- npm 上的"未占用"**不等于"已保留"**。要在对外宣传中使用 `phaneris` 包名或 `@phaneris` scope，必须先在 npm 实际创建组织/发布占位包，并把日期与方式补记到本表。
- 在上表所有"未验证"项有结论之前，第 2 节的技术标识按当前冻结值使用，但不得对外声明命名空间已归属本项目。
- 仓库改名属于外部操作，按方案第 9 节需在结果可审阅时单独确认；`identity.json` 的 `repository.url` 因此仍指向当前真实位置，`plannedUrl`/`renamePerformed` 记录目标与执行状态。

## 4. 引用清点

`bun run identity:check` 扫描工作树（跳过 `node_modules`、`dist`、`release`、`vendor` 等产物目录与二进制文件），按标识类别统计：

| 类别 | 命中行数 | 含义 |
|---|---|---|
| `kebab-slug` | 2355 | `craft-agent`：数据目录、包名、文件名、标识符 |
| `package-scope` | 1575 | `@craft-agent/`：13 个 workspace 包的 import 与声明 |
| `env-prefix` | 798 | `CRAFT_*`：环境变量读写 |
| `display-name` + `display-name-singular` | 344 + 184 | `Craft Agents` / `Craft Agent` 用户可见文案 |
| `scheme-or-domain` | 242 | `craftagents` 协议与上游托管域名 |
| `code-identifier` | 137 | `CraftAgent` / `craftAgent` 代码标识符 |
| `upstream-owner` | 51 | `lukilabs`、`Craft Docs Ltd.`、`craft.do` |
| **合计（未豁免）** | **5686 行 / 874 个文件** | 另有 526 行被允许列表豁免 |

命中密度最高的文件（Phase B 的主要工作面）：`packages/server-core/src/sessions/SessionManager.ts`（180）、`apps/electron/src/shared/types.ts`（147）、`apps/electron/resources/docs/craft-cli.md`（134）、`apps/electron/src/main/index.ts`（130）、`bun.lock`（107）。

清点结论：这是一次真正的机械改名，不是一个替换提交能安全覆盖的。方案第 8 节的提交顺序（身份配置 → 内部包机械改名 → 界面资源 → 应用身份和路径 → 导入引擎 → 服务配置 → 发布流水线 → 文档与验收）按此执行；每一步完成后本表的数字应单调下降。

### 4.1 残留允许列表

`scripts/identity-allowlist.json` 中的每条规则都带 `reason`，只允许四类例外：

1. **上游归属**：`NOTICE`、`LICENSE`。
2. **历史记录**：`apps/electron/resources/release-notes/*.md`、`apps/electron/build-win.log`——记录的是上游名下实际发布过的东西，改写即伪造历史。
3. **迁移输入**：`phaneris.identity.json` 的 `legacy` 块（导入流程与弃用诊断读取）。
4. **身份与扫描机制自身**：`identity.generated.*`、`identity.schema.json`、`check-identity.ts`、允许列表本身，以及本文件与方案文档。

校验器会报告"不再命中任何内容"的规则，避免允许列表随时间腐化——不允许用"源码里完全没有 Craft"作为完成标准，但也不允许用允许列表掩盖未完成的工作。

## 5. 外部依赖清单（D 阶段输入）

A 阶段要求清点产品对外部服务的隐式依赖。以下为代码中实证，均指向上游基础设施：

| 服务 | 位置 | 现状 | 未就绪时的目标行为 |
|---|---|---|---|
| 更新源 | `apps/electron/src/main/auto-update.ts:5`（注释）、整个 `auto-update.ts` 依赖 `electron-updater` | 注释写明来自 `https://thecraftagents.com/electron/latest`，但 `electron-builder.yml` **没有 `publish` 块**，`apps/electron/release/` 下也不存在 `app-update.yml`；即打包配置目前并未产出任何更新 feed | 自有 Release 与元数据；显示明确不可用状态，禁止回退上游 |
| 安装脚本 | `scripts/install-app.sh:5,354`、`scripts/install-app.ps1:2,7` | `VERSIONS_URL = https://thecraftagents.com/electron`，下载并安装上游产物 | 重建归属，只下载自己发布的产物 |
| 版本清单 | `packages/shared/src/version/manifest.ts:3` | `VERSIONS_URL = https://thecraftagents.com/electron` | 指向自有 Release |
| 文档与反馈 | `packages/shared/src/docs/doc-links.ts:6`、`docs/source-guides.ts:5,192,201,215`、`prompts/system.ts:643`、`sources/storage.ts:563`、`apps/electron/src/shared/menu-schema.ts:302`、`main/menu.ts:237`、`renderer/.../TopBar.tsx:314`、`ChatPage.tsx:537,551`、`ui/EditPopover.tsx:370` | 全部指向 `https://thecraftagents.com/docs` | 指向自己的仓库/文档；至少不能继续把用户送到上游 |
| OAuth relay | `packages/shared/src/auth/oauth-relay.ts:3` | `OAUTH_RELAY_CALLBACK_URL = https://thecraftagents.com/auth/callback` | 自有部署或各 provider 可用的本地回调；未就绪则只禁用受影响授权方式并解释 |
| Slack OAuth | `packages/shared/src/auth/slack-oauth.ts:269,360` | 回调同样指向上游 relay | 同上；需同步调整 provider 注册信息 |
| 分享 Viewer | `packages/shared/src/branding.ts:18`、`apps/viewer/src/components/Header.tsx:43`、`apps/viewer/vite.config.ts:41` | `VIEWER_URL = https://thecraftagents.com` | 自有上传/访问/删除与存储规则；未就绪则禁用新建云端分享，保留本地导出 |
| Pages 分享 API | `packages/shared/src/pages/publisher.ts:35` | `DEFAULT_PAGES_SHARE_API_BASE_URL = https://thecraftagents.com/p/api` | 同上；`PHANERIS_PAGES_SHARE_API_URL` 为本地覆盖入口 |
| 遥测 | `apps/electron/src/main/index.ts:28-34`、`scripts/electron-build-main.ts:53` | Sentry，DSN 由构建期 `SENTRY_ELECTRON_INGEST_URL` 注入，`CRAFT_TELEMETRY_ENABLED=1` 才启用；仓库内**没有**硬编码 DSN | 默认关闭；启用时只用自有项目与显式配置；不注入上游 DSN |
| 包主页 | `apps/electron/package.json:11`、`packages/server/package.json:21` | `homepage = https://thecraftagents.com` | 指向自己的仓库/站点 |

需要独立审计、不能只靠字符串替换的项：`credentials/backends/secure-storage.ts` 的凭据路径与 `CRAFT01` 魔数/`craft-agent-v2` 派生参数属于格式兼容常量；`packages/shared/src/branding.ts` 的 Viewer 链路连带分享上传、查看与删除；各 provider 的 OAuth client ID 来源需逐个核对，不得批量替换。

## 6. 本机标识冲突复核

2026-09-14 在本机复核，与方案第 2.2 节一致：

| 标识 | 现状 | 影响 |
|---|---|---|
| `~/.craft-agent` | 存在，8,644 MB | 新默认根 `~/.phaneris`（不存在）不冲突；旧数据只能通过显式导入进入新根 |
| `%APPDATA%\Craft Agents` | 存在 | 新 userData `Phaneris`（不存在）不冲突 |
| `HKCU\Software\Classes\craftagents` | 已注册 | 新旧构建会争抢该协议；`phaneris` 键不存在，未占用 |
| `~/.phaneris`、`phaneris://` | 未占用 | 迁移窗口仍然开放 |

## 7. A 阶段放行判定与下一步

已满足：技术身份冻结并集中到单一来源；引用完成清点并有分类数字；残留允许列表带理由且可失效检测；本机标识冲突复核；外部依赖清单带代码位置。

未满足（不阻塞 B 阶段，但阻塞对外声明）：npm 组织名可用性未验证；域名与商标未检查。

B 阶段的工作顺序与验收见方案第 8 节：图标与文案 → 内部包机械改名 → 应用身份与路径 → 品牌表面。每完成一步重跑 `bun run identity:check`，`--strict` 的残余命中数应逐级下降，最终接入 CI 成为放行门槛。
