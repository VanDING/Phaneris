# Phaneris 本地文档（T2 管道 + T3 内容）

> 状态：进行中。T1（关闭入口）已被否决，改为 T2+T3。
> 本文只记录**决策与实现骨架**；内容本身写在 `apps/electron/src/renderer/docs/guide/`。

## 1. 为什么做

`packages/shared/src/docs/doc-links.ts` 里的 `DOC_BASE_URL` 指向 `https://thecraftagents.com/docs`，
应用内 **24 处**用户可见入口全部经过 `getDocUrl()` 走到这个域名。此外还有一层不是 UI 的出口：

| 位置 | 内容 |
|---|---|
| `packages/shared/src/prompts/system.ts:643` | 系统提示词让 agent 去上游文档站查产品说明 |
| `apps/electron/src/renderer/components/ui/EditPopover.tsx:370` | 指示 agent 去该 URL 查 filesystem source 指南 |
| `apps/electron/resources/docs/sources.md:16,208` | **打包给 agent 的指南自己**让 agent 去抓上游文档站 |
| `apps/electron/resources/docs/sources.md:834` | 给出上游 OAuth 回调地址，要求用户去 provider 侧配置 |

也就是说：**只关 UI 不够，agent 仍会把用户送往上游。** 本地文档是唯一能把这条链路收干净的形态。

## 2. 已确认的决策

| 决策 | 选择 | 依据 |
|---|---|---|
| 范围 | T2（管道）+ T3（内容） | 用户 2026-09-15 决定，否决"先关掉"的兜底 |
| 内容语言 | **英文优先**，结构预留多语言 | 与代码/注释/上游术语一致，便于对照源码写 |
| 渲染方式 | **应用内原生渲染 Markdown** | 复用现有 markdown 渲染器与浮层，跟随主题/暗色，WebUI 同样可用 |
| 呈现形态 | **全屏浮层（overlay）**，不做路由 | 见 §5 的取舍 |
| 会话分享 | 关闭 | 已实施（`69386a31`） |
| Pages 分享 | 关闭 | 已实施（默认值改为 opt-in） |

## 3. 上游那边没有可抄的东西

必须写清楚，否则会低估工作量：上游文档站是 Astro Starlight，**14 个分区、49 页**。
用 GitHub API 查过上游仓库（`craft-ai-agents/craft-agents-oss`），`docs/` 目录里**只有 `cli.md` 一个文件**
——文档站的正文不在这个仓库里。所以"参考 craft 的文档"只能参考**结构与选题**，正文必须对着我们自己的代码写。

另外 `git show 56599313`（上游 v0.12.0 同步）显示：上游原本有个 `craft-agents-docs` MCP
（挂在 `https://agents.craft.do/docs/mcp`），在那次同步中被删除。**上游自己从来没有本地文档。**

## 4. 实现骨架

### 4.1 内容位置与加载

```
apps/electron/src/renderer/docs/
  guide/en/<section>/<slug>.md     ← 正文（英文）
  manifest.ts                       ← 分区/顺序/标题，导航的唯一真源
```

用 Vite 的 `import.meta.glob` 一次拿到全部正文：

```ts
const modules = import.meta.glob('./guide/*/**/*.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
```

- **不是**运行时读盘、**不是**自定义协议、**不是** iframe —— 正文被编译进渲染进程包。
- 因此 `file:` 被 `url-safety.ts:29-32` 封死这件事不影响我们；也不需要改
  `index.html` / `vite.config.ts:39` 的 CSP（注意 CSP 在这两处**各写了一份**）。
- `apps/webui/vite.config.ts:42` 把 `@` 指向 Electron 渲染进程目录，所以 WebUI 自动获得同一份文档。
- 估算体积：约 45 页 × 8 KB ≈ 360 KB 裸文本，进包可接受。加 locale 只是多一个目录。

### 4.2 打开方式：浮层 + 全局状态，**不经过 URL**

`getDocUrl()` 改变语义 → 归还**文档 slug**；入口调用从
`window.electronAPI.openUrl(getDocUrl(f))` 改为 `openDoc(slug)`（写一个全局 atom）。
浮层在 `App.tsx` 挂载一次，读 atom 决定开合与当前页。浮层复用
`DocumentFormattedMarkdownOverlay` 的骨架（`FullscreenOverlayBase` + `<Markdown mode="minimal">`），
在其上加左侧导航与搜索。

**为什么不能沿用"`getDocUrl` 返回一个内部深链"这条更省事的路**：`apps/webui/src/adapter/web-api.ts:89-101`
的 `openUrl` 对 `phaneris://` 只打一行 `console.warn('requires the desktop app')` 就丢弃。
走深链会让文档在 WebUI 模式下静默失效。走 atom 则两端行为一致，不需要任何 IPC。

外部来的深链（`phaneris://docs/...`，例如从浏览器或终端唤起）在 `NavigationContext.tsx:1111`
的深链监听里**前置拦截**并转为打开浮层，不进入 `parseRouteToNavigationState` ——
否则会被判为非法路由并弹 toast。

### 4.3 入口清单（24 处，本次要改的）

| 入口 | 位置 | 改法 |
|---|---|---|
| 右上角帮助下拉（7 项） | `TopBar.tsx:276-318` | 改打开浮层 |
| 原生帮助菜单 | `main/menu.ts:237` | 经 `handleDeepLink` 走内部路由 |
| 桌面/移动端帮助菜单 | `shared/menu-schema.ts:297-305` `HELP_LINKS` | 同上 |
| 7 个设置页"了解更多" | `HeaderMenu.tsx` 的 `helpFeature` 调用点 | 改打开浮层 |
| 3 处空状态 | `entity-list-empty.tsx` 的 `docKey` 调用点 | 同上 |
| 2 处右键"了解更多" | `SidebarMenu.tsx:205,248` | 同上 |
| 2 处设置页内联 | `PermissionsSettingsPage.tsx:231`、`LabelsSettingsPage.tsx:86` | 同上 |
| agent 侧 4 处 | `prompts/system.ts`、`EditPopover.tsx`、`resources/docs/sources.md` | 改指本地文档或删除 |

## 5. 被否决的方案与原因

| 方案 | 否决原因 |
|---|---|
| 打包静态 HTML 站点 + `docs:` 自定义协议 + iframe | 需要新 scheme（照抄 `thumbnail-protocol.ts:126-143` 可行）、要改**两处** CSP、样式与主题引擎脱节；**且 WebUI 拿不到自定义协议，会直接失效** |
| 把文档做成正式路由（`routes.view.docs`），像 `pages`/`kanban` 那样的独立 surface | `route-parser.ts` 是 1000+ 行的状态机，新增 navigator 要动 `NavigatorType`、已知前缀表、parse/serialize、多个 switch，以及导航状态机与 surface 渲染；收益只是历史前进后退 |
| 用 `file://` 打开本地 HTML | `url-safety.ts:29-32` 显式封死（Windows 上 `shell.openExternal` 是 RCE 路径），且 `classifyExternalUrl` 会把 `docs:` 误判为 `safe-external` 交给操作系统 |

## 6. 内容规划（T3）

按上游的 14 个分区、49 页做对齐，但**只写我们真实有的东西**。slug 尽量沿用上游路径形状，
这样 `doc-links.ts` 里既有的 `path` 值（`/sources/overview`、`/go-further/workspaces` …）可以原样映射。

| 分区 | 页数 | 备注 |
|---|---|---|
| Getting Started | 2 | introduction、installation |
| Core Concepts | 5 | conversations、projects、working-directory、permissions、interactions |
| Sources | 7 | overview、MCP×3、APIs×2、local-folders |
| Skills | 1 | |
| Statuses | 2 | overview、customizing |
| Labels | 2 | overview、auto-rules |
| Automations | 1 | |
| Messaging | 4 | overview、telegram、whatsapp、lark |
| Browser | 3 | overview、examples、api-discovery |
| Customisation | 3 | themes、colors、icons |
| Go Further | 8 | workspaces、pages、kanban、tasks、rich-output、document-tools、deep-links、performance |
| Server | 2 | remote-server、cli |
| Reference | 8 | config-file、llm-connections、preferences、credentials、custom-endpoint、network-proxy、environment-variables、cli-reference |

**不写**：上游的 "Sharing Conversations"（分享已关闭）。

已有的素材：`apps/electron/resources/docs/` 里 20 个 markdown、约 260 KB，已经是 Phaneris 品牌
（路径写作 `~/.phaneris/...`），覆盖 16 个主题，是写作用的主要事实来源。但它们是**写给 agent 的**
（"Read this before..."、大量 schema 表格），改写成用户向读物需要一遍编辑。

## 7. 待办与已知问题

- [ ] 会话分享历史指针：`~/.phaneris/workspaces/Work/sessions/260814-lucid-tiger/session.jsonl`
      仍带 `sharedUrl`/`sharedId`（`agents.craft.do`）。`scripts/clear-session-shares.ts` 已就绪、
      干跑验证通过，但**需要先关闭应用**（脚本检测到 `.server.lock` 会拒绝写入）。
- [ ] T2 管道：manifest、浮层、搜索、24 处入口改向。
- [ ] T3 内容：45 页。
- [ ] `VIEWER_URL` 与 `apps/viewer` 在关闭分享后成为未使用代码，尚未清理。
