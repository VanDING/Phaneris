# Phaneris 依赖关联关系梳理

分析日期：2026-10-06（Asia/Shanghai）
仓库基准：工作区 `main` 当前 checkout
分析范围：**结构关系**（谁依赖谁、归属、重复、幽灵依赖、可削减项），不含版本升级与安全公告判断
上游文档：[dependency-audit-2026-10-03.md](./dependency-audit-2026-10-03.md)（版本与安全）、[dependency-upgrade-2026-10-03.md](./dependency-upgrade-2026-10-03.md)（升级实施）

## 0. 结论

**依赖数量本身不算失控，但结构上有三处明确的浪费，而且都集中在"声明位置"而不是"包本身"。**

| 维度 | 数值 | 判断 |
| --- | --- | --- |
| 工作区清单 | 14 个（根 + 13 workspace） | 正常 |
| 声明条目 | 320 条（211 deps / 73 dev / 28 peer / 8 optional） | 偏多，重复声明占 61 个包 |
| 唯一外部包 | 182 个 | 对一个 Electron + 服务端 + 多 IM 网关的产品属合理区间 |
| 锁文件条目 | 2,063 条 / 1,532 个唯一包名 | 正常 |
| 可达闭包 | 1,632 条 | 正常 |
| 同名多版本实例 | 169 个包名 → 531 条冗余副本 | 值得清理，但多数来自 Babel 7/8 与 AWS SDK |
| `node_modules` 体积 | 2.0 GB / 1,071 个顶层目录 | 偏大，但主要由 electron-builder 与编辑器栈决定 |
| 未声明的外部 import | 77 个唯一包 | **偏高**，靠 hoisting 兜底 |
| 声明了但从未 import | 26 条（非根） | **明确可删** |

真正的三个问题：

1. **根清单被当成共享依赖仓库。** 根 `package.json` 声明了 130 个包，其中 **86 个被下游 workspace 直接 import**。它不是"根"，它是"全局库"。
2. **77 个包被 import 但没在自己的清单里声明**，靠 Bun 的 hoisted linker 才解析得到。这使 `package.json` 无法描述真实运行图。
3. **18 条声明可以立即删除，连带消除 101 个锁条目**（占可达闭包 6.2%），其中一个包单独拖进 141 个节点。

---

## 1. 内部依赖图

13 个 workspace，共 **25 条** `@phaneris/*` 声明边，全部是 `workspace:*` 且全部写在 `dependencies`。

```
                        ┌──────────────┐
                        │  core (0出)  │  ← 7 个消费者（最大扇入）
                        └──────┬───────┘
                               │
        ┌──────────────────────┼───────────────────────┐
        │                      │                       │
   ┌────▼─────┐          ┌─────▼──────┐          ┌─────▼────┐
   │  shared  │          │ server-core│          │    ui    │
   │ (8入/2出)│          │ (4入/2出)  │          │ (3入/2出)│
   └────┬─────┘          └─────┬──────┘          └─────┬────┘
        │                      │                       │
        │        ┌─────────────┼──────────┐            │
        │        │             │          │            │
        │   ┌────▼────┐   ┌────▼───┐  ┌───▼─────┐  ┌───▼──────┐
        │   │  server │   │  cli   │  │electron │  │ viewer / │
        │   │         │   │        │  │         │  │  webui   │
        │   └─────────┘   └────────┘  └─────────┘  └──────────┘
        │                                  │
        │                          ┌───────▼──────────┐
        │                          │ messaging-gateway│
        │                          └───────┬──────────┘
        │                                  │
        │                     ┌────────────▼─────────────┐
        └─────────────────────┤ messaging-whatsapp-worker│
                              └──────────────────────────┘

   session-tools-core ← shared 唯一消费者
   pi-agent-server    ← 无消费者（独立子进程）
```

### 声明边与反向扇入

| workspace | 依赖 | 被谁依赖 |
| --- | --- | --- |
| `@phaneris/core` | — | messaging-gateway, server, server-core, shared, ui, electron, viewer |
| `@phaneris/shared` | core, session-tools-core | messaging-gateway, server, server-core, ui, cli, electron, webui |
| `@phaneris/server-core` | core, shared | messaging-gateway, server, cli, electron |
| `@phaneris/ui` | core, shared | electron, viewer, webui |
| `@phaneris/messaging-gateway` | core, whatsapp-worker, server-core, shared | server, electron |
| `@phaneris/electron` | core, messaging-gateway, server-core, shared, ui | — |
| `@phaneris/webui` | shared, ui | — |
| `@phaneris/viewer` | core, ui | — |
| `@phaneris/server` | core, messaging-gateway, server-core, shared | — |
| `@phaneris/cli` | shared, server-core | — |
| `@phaneris/messaging-whatsapp-worker` | — | messaging-gateway |
| `@phaneris/session-tools-core` | — | shared |
| `@phaneris/pi-agent-server` | — | —（独立子进程，经 stdio 通信） |

**结构评价**：分层清晰，无环，`core` 与 `shared` 双中心是合理的。`pi-agent-server` 与 `messaging-whatsapp-worker` 作为叶子是对的（跨进程边界）。`packages/session-mcp-server/` 只有 `dist/` 与 `tsbuildinfo`，没有 `package.json`，是构建产物而非 workspace——不要按第 14 个包计数。

### 声明边与实际 import 不一致的 2 处

| 位置 | 问题 | 影响 |
| --- | --- | --- |
| `packages/server-core` | import `@phaneris/session-tools-core`（3 个文件）但未声明 | 靠 hoisting 解析。`session-tools-core` 目前只有 `shared` 声明，一旦调整 `shared` 的依赖就会断 |
| `apps/viewer` | import `@phaneris/shared`（`src/main.tsx`）但未声明 | 同上，靠根级 hoisting |

另有 4 处**自引用**（`server-core` 37 处、`shared` 8 处、`ui` 2 处、`messaging-gateway` 1 处）通过自身 `exports` map 解析——这是合法模式，不是问题。

---

## 2. 外部依赖归属：根清单即共享仓库

根 `package.json` 的 130 条声明中，**86 个被至少一个子 workspace import**：

| 下游 | 从根清单借用的外部包数 |
| --- | --- |
| `apps/electron` | 34 |
| `packages/ui` | 24 |
| `packages/shared` | 8 |
| `apps/webui` | 5 |
| `packages/server-core` | 1 |

典型例子：`packages/ui` 只声明 10 个 `dependencies`，却 import 了 24 个根级包（全部 `@tiptap/*`、`@radix-ui/react-tooltip`、`linkify-it`、`pdfjs-dist`、`rehype-sanitize`、`tiptap-markdown`、`tiptap-extension-code-block-shiki`）。

**这本身是一种刻意的设计**——`packages/ui` 用 25 个 `peerDependencies` 声明契约，由消费方（根或 electron）提供实现，可以避免 React/Tiptap 多实例。问题在于**契约没有被完整遵守**：`@tiptap/*` 等 13 个包被 import 但连 peer 都没写。

### 各 workspace 各自的传递闭包

| workspace | 直接声明 | 解析到的传递节点 |
| --- | ---: | ---: |
| `(root)` | 130 | 1,317 |
| `apps/electron` | 52 | 534 |
| `packages/shared` | 17 | 294 |
| `apps/viewer` | 21 | 253 |
| `packages/server-core` | 11 | 239 |
| `packages/pi-agent-server` | 11 | 181 |
| `packages/messaging-whatsapp-worker` | 3 | 103 |
| `packages/messaging-gateway` | 9 | 82 |
| `apps/webui` | 11 | 52 |
| `packages/session-tools-core` | 5 | 36 |
| `apps/cli` | 5 | 25 |
| `packages/server` | 7 | 24 |
| `packages/ui` | 10 | 23 |
| `packages/core` | 0 | 0 |

根清单单独就能达到 1,317 个节点，占全部可达闭包（1,632）的 **81%**。

---

## 3. 重量集中在哪些包

按"删掉这一条声明能从锁里带走多少节点"排序（margin = 边际消除量）：

| 包 | 位置 | 子树 | 边际 | 备注 |
| --- | --- | ---: | ---: | --- |
| `electron-builder` | 根 dev | 254 | 123 | 单条最大。打包工具链 |
| `@modelcontextprotocol/sdk` | 根 dep | 91 | 51 | |
| `@tiptap/starter-kit` | 根 dep | 42 | 37 | 编辑器栈 |
| `@tailwindcss/vite` | 根/viewer dev | 46 | 33 | 在 3 个清单重复声明 |
| `vite` | 根/viewer dev, webui dep | 40 | 31 | **`apps/webui` 把它写在 `dependencies` 里** |
| `markitdown-js` | 根 dep + server-core | 105 | 23 | 带补丁 |
| `eslint` | 根 dev | 77 | 21 | |
| `typescript` | **8 个清单** | 21 | 21 | 重复声明最多的包 |
| `sharp` | 根/server-core/electron | 32 | 20 | 见 §5 边界问题 |
| `react-markdown` | 根/ui peer/viewer dev | 82 | 19 | |
| `@sentry/electron` | 根 dep | 27 | 18 | |
| `remark-gfm` | 根/ui peer/viewer dev | 68 | 17 | |
| `@electron/packager` | 根 dev | 48 | 15 | **与 `electron-builder` 并存，第二套打包链** |
| `concurrently` | 根 dev | 20 | 14 | **全仓库无实际引用** |
| `@vscode/ripgrep` | 根 dep | 13 | 13 | |
| `open` | 根 dep | 13 | 13 | |

非根清单里最重的几条：

| workspace | 包 | 边际 |
| --- | --- | ---: |
| `apps/electron` | `@open-file-viewer/core` | 103 |
| `packages/shared` | `incr-regex-package` | 47 |
| `apps/electron` | `@svar-ui/react-gantt` | 33 |
| `packages/messaging-whatsapp-worker` | `@whiskeysockets/baileys` | 30 |
| `packages/shared` | `bash-parser` | 29 |

---

## 4. 重复与版本分歧

### 同名多版本：169 个包名 / 531 条冗余副本

前几名几乎全是 Babel 与构建链：

| 包 | 副本数 | 版本 |
| --- | ---: | --- |
| `@babel/helper-validator-identifier` | 25 | 8.0.6, 8.0.4, 7.29.7 |
| `minimatch` | 18 | 10.2.6, 10.2.5, 9.0.9, 5.1.9, 3.1.5 |
| `@babel/helper-string-parser` | 14 | 8.0.6, 8.0.0, 7.29.7 |
| `brace-expansion` | 14 | 5.0.12, 2.1.7, 1.1.21 |
| `semver` | 11 | 7.8.5, 7.7.4, 6.3.1, 5.7.2 |
| `commander` | 11 | 15.0.0 … 2.20.3 |

Babel 7/8 并存、`brace-expansion` 三分支是上游父包范围约束的结果（见 [dependency-audit-2026-10-03.md](./dependency-audit-2026-10-03.md) §2.2），**不应强行 override 统一 major**。

### 同一包被多个清单声明：61 个

| 包 | 声明位置 | 范围 |
| --- | --- | --- |
| `@types/node` | 8 个清单 | `^24.19.1` |
| `typescript` | 8 个清单 | `7.0.2` |
| `react` / `react-dom` / `react-i18next` | 根 dep + ui peer + electron/viewer/webui dep | `^19.3.0` / `^17.0.15` |
| `@earendil-works/pi-ai` | 根 + pi-agent-server + server-core + shared | `1.0.2` |
| `ws` | 根 + server dev + server-core + electron | `^8.22.0` / `8.22.0` |
| `sharp` | 根 + server-core + electron | `0.35.5` |
| `pdfjs-dist` | pi-agent-server + electron | `6.3.289` |
| `motion` | 根 + ui peer + electron + viewer dev | `^14.0.0` |

### 范围分歧：5 个（建议对齐）

| 包 | 分歧 |
| --- | --- |
| `ws` | 根/server-core/electron `^8.22.0` vs server devDep `8.22.0` |
| `@tailwindcss/typography` | 根 `^0.5.20` vs ui peer `>=0.5.20` vs viewer dev `^0.5.20` |
| `class-variance-authority` | 根 `^0.7.1` vs ui peer `>=0.7.1` vs viewer dev `^0.7.1` |
| `react-markdown` | 根/ui `^10.1.0` vs viewer dev `10.1.0` |
| `tailwind-merge` | 根/ui `^3.7.0` vs viewer dev `3.7.0` |

`viewer` 使用精确锁定而根使用 `^`，意味着 viewer 的构建会用根解析出的版本——两边可能漂移。

---

## 5. 幽灵依赖与挂起依赖

77 个唯一外部包被 import 却没有在所属清单声明。按 workspace 分布（同一包可能被多处依赖，故合计 90 > 77）：

| workspace | 未声明外部包 | 代表 |
| --- | ---: | --- |
| `apps/electron` | 34 | `@radix-ui/react-avatar/scroll-area/select/separator/slot/tabs`、`@sentry/electron`、`@sentry/react`、`@svar-ui/react-grid`、`class-variance-authority`、`clsx`、`croner`、`date-fns`、`i18next`、`jotai`、`lucide-react`、`react-resizable-panels`、`shiki`、`tailwind-merge`、`vite` |
| `packages/ui` | 24 | 全部 `@tiptap/*`（13 个）、`@radix-ui/react-tooltip`、`linkify-it`、`pdfjs-dist`、`rehype-sanitize`、`tiptap-markdown`、`tiptap-extension-code-block-shiki` |
| `(root scripts/)` | 19 | `@modelcontextprotocol/sdk`、`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`、`@whiskeysockets/baileys`、`electron`、`esbuild`、`i18next`、`jotai`、`node-tesseract-ocr`、`pkg`、`playwright`、`react`、`react-dom`、`react-i18next`、`semver`、`sharp`、`sonner`、`vite`、`zod` |
| `packages/shared` | 8 | `electron`、`electron-log`、`gray-matter`、`marked`、`open`、`tar` |
| `apps/webui` | 5 | `motion`、`@tailwindcss/vite`、`@vitejs/plugin-react`、`@rolldown/plugin-babel` |
| `packages/server-core` | 0 外部 | 缺的是内部包 `@phaneris/session-tools-core` |
| `apps/viewer` | 0 外部 | 缺的是内部包 `@phaneris/shared` |

其中 **`apps/electron` 与 `packages/ui` 是主要来源**。注意 `apps/electron/tsconfig.json` 有 `"@phaneris/shared": ["../../packages/shared/src/index.ts"]` 这类别名，`apps/webui` 更是把 `@/` 指到 `../electron/src/renderer/*`——**webui 直接复用 electron 的 renderer 源码**，这是比 package.json 更强的耦合。

### 测试文件引用了未安装的 vitest

`packages/ui` 有 3 个测试文件 `import { describe, expect, it } from 'vitest'`，但 **vitest 不在任何清单里，也没有安装**。这些测试无法运行。其余测试用 `bun:test`。

---

## 6. 声明了但从未 import（26 条，明确可删）

| 清单 | 包 | 说明 |
| --- | --- | --- |
| 根 | `@rollup/rollup-win32-arm64-msvc` | 树里根本没有 rollup（Vite 8 用 Rolldown），包也没安装 |
| 根 | `@aws-sdk/client-s3` | 全仓库零引用 |
| 根 | `@electron/packager` | 零引用，且与 `electron-builder` 功能重叠 |
| 根 | `@shikijs/cli` | 零引用 |
| 根 | `@radix-ui/react-collapsible` | 零引用 |
| 根 | `@tiptap/extension-bubble-menu` | 零引用 |
| 根 | `@tiptap/extension-text-style` | 零引用 |
| 根 | `@dnd-kit/helpers` | 零引用 |
| 根 | `concurrently` | 仅出现在注释文本里 |
| 根 | `autoprefixer` | Tailwind 4 经 `@tailwindcss/vite` 处理，不需要 |
| 根 | `postcss` | 同上，且无 `postcss.config.*` |
| 根 | `react-devtools-core` | 零引用，且拖入 `ws@7.5.13` |
| `packages/shared` | `incr-regex-package` | **见下方专项** |
| `packages/shared` | `@isaacs/ttlcache` | 零引用 |
| `packages/pi-agent-server` | `@earendil-works/pi-server` | 零引用（连带 `@earendil-works/pi-protocol`） |
| `packages/pi-agent-server` | `duck-duck-scrape` | 零引用，搜索能力已内联实现 |
| `packages/session-tools-core` | `zod-to-json-schema` | 源码注释明写"Zod v4 有原生 `.toJSONSchema()`，`zod-to-json-schema` 与 v4 不兼容"——已被取代 |
| `apps/electron` | `temporal-polyfill` | 零引用 |
| `apps/electron` | `unist-util-visit` | 已由 `packages/ui` 声明 |
| `apps/electron` | `sharp` | 见下方边界问题 |

### 专项：`incr-regex-package` 拖进 141 个节点

`packages/shared/src/agent/mode-manager.ts` 用它在 **1 个函数**里做命令模式不匹配的诊断（找出正则匹配在哪个字符停下）。

它自己的 `dependencies` 里写着 `eslint_d: ^9.0.0`——**一个 linter 守护进程被上游作者错放进运行时依赖**。后果：

```
incr-regex-package@1.0.4
  └── eslint_d@9.1.2
        └── eslint@7.32.0   ← 仓库里同时存在 eslint 10.12.0
              ├── @eslint/eslintrc@0.4.3, espree@7.3.1, eslint-scope@5.1.1
              ├── doctrine, regexpp, functional-red-black-tree, v8-compile-cache
              └── table, slice-ansi, astral-regex, lodash.truncate
```

子闭包共 **141 个节点**（边际 47）。`mode-manager.ts` 只用到 `IREGEX`、`DONE`、`MORE`、`FAILED` 四个导出，且先手动剥离了 `^`、`$`、`\b` 才喂给它。这段诊断逻辑用几十行前缀匹配即可替代，或退回现有的基础诊断分支。

---

## 7. 削减方案与量化

删除下列 **18 条零引用声明**：

```
根:                 @rollup/rollup-win32-arm64-msvc, @aws-sdk/client-s3,
                    @electron/packager, @shikijs/cli, @radix-ui/react-collapsible,
                    @tiptap/extension-bubble-menu, @tiptap/extension-text-style,
                    @dnd-kit/helpers, autoprefixer, postcss,
                    react-devtools-core, concurrently
packages/shared:    incr-regex-package, @isaacs/ttlcache
pi-agent-server:    @earendil-works/pi-server, duck-duck-scrape
apps/electron:      temporal-polyfill
session-tools-core: zod-to-json-schema
```

**结果（按锁文件解析计算）：**

| | 删除前 | 删除后 |
| --- | ---: | ---: |
| 可达锁节点 | 1,632 | 1,531 |
| 消除节点 | — | **101（-6.2%）** |

两条 P0 动作的收益是可加的：`incr-regex-package` 单独贡献 47 个节点，其余 17 条声明合计贡献 54 个（已分别实测），47 + 54 = 101。

消除的 101 个节点包括：

- **`@electron/packager` 整条链**：`galactus`、`flora-colossus`、`resedit`、`pe-library`、`@electron/asar`、`@electron/notarize`、`@electron/osx-sign`、`@electron/universal`、`@electron/windows-sign`、`filenamify`、`junk`
- **`eslint_d` + ESLint 7.32.0 整条链**（经 `incr-regex-package`）：`@eslint/eslintrc@0.4.3`、`espree@7.3.1`、`eslint-scope`、`eslint-utils`、`regexpp`、`doctrine`、`table`、`slice-ansi`、`astral-regex`、`lodash.truncate`、`functional-red-black-tree`、`v8-compile-cache`、`file-entry-cache`、`flat-cache`、`rimraf@3` 等
- **`@aws-sdk/client-s3` 链**：`@aws-sdk/checksums`、`@aws-sdk/middleware-sdk-s3`
- **`react-devtools-core` → `ws@7.5.13`**（即上游审计记录的 `ws` 双实例之一）
- **`concurrently` 链**：`rxjs`、`yargs`、`cliui`、`tree-kill`、`yargs-parser`
- **`temporal-polyfill` 链**：`temporal-spec`、`temporal-utils`
- **`autoprefixer` 链**：`fraction.js`、`postcss-value-parser`
- `postject`、`@shikijs/cli` 链：`cac`、`ansis`

### 注意事项

- **`@pierre/diffs` 与 `vaul` 不在删除列表内。** 它们虽然不在 `apps/electron` 里 import，但由 `packages/ui` import，而 `apps/electron` 是其 peer 提供方——这是**合法的 peer 提供声明**。判断"未使用"时必须区分"自己不用"和"替 peer 提供"。
- **`sharp` 需要挪位置而不是删除。** `apps/electron` 声明了 `sharp@0.35.5` 却零引用；而 `server-core/src/runtime/platform.ts` 在 Electron 下走 `nativeImage`，只有 `platform-headless.ts` 才 `import('sharp')`。**`sharp` 属于服务端产物，不应打进桌面客户端**。这是结构性边界，不是清理项。
- **`jotai-babel`、`@babel/core`、`@babel/preset-*`、`@rolldown/plugin-babel`、`@tailwindcss/typography` 都不是死依赖**——它们经 vite/babel 配置字符串或 CSS `@plugin` 指令使用，import 扫描看不到。判断时必须查配置文件。
- `concurrently` 的删除前提是确认 `scripts/` 与 CI 里没有 shell 层调用（本次只在注释文本里命中）。

---

## 8. 建议顺序

| 优先级 | 动作 | 收益 | 风险 |
| --- | --- | --- | --- |
| P0 | 删除 `incr-regex-package`，用本地前缀匹配替换 `analyzePatternMismatch` | **-47 节点**，清掉 ESLint 7 与 `eslint_d` | 低。仅影响诊断文案质量，需覆盖 `mode-manager` 的不匹配提示用例 |
| P0 | 删除 §7 的 17 条零引用声明 | **-54 节点**，去掉两套打包链之一 | 低。逐条 grep 已验证零引用 |
| P1 | `apps/webui` 的 `vite` 从 `dependencies` 移到 `devDependencies` | 语义修正 | 低 |
| P1 | `packages/server-core` 补声明 `@phaneris/session-tools-core`；`apps/viewer` 补声明 `@phaneris/shared` | 消除 2 条隐式内部边 | 低 |
| P1 | `packages/ui` 把实际 import 的 13 个 `@tiptap/*` 等补进 `peerDependencies` | 让契约与代码一致 | 中。需确认 electron 侧仍提供实现 |
| P2 | 对齐 5 组版本分歧范围 | 防止 viewer 与根漂移 | 低 |
| P2 | 删除或修复 `packages/ui` 里 3 个 `import 'vitest'` 的测试 | 消除不可运行的测试 | 低 |
| P3 | 评估把根清单的 UI/编辑器栈下沉到 `packages/ui` 的 `dependencies` | 让根回归"根"的角色 | **高**。会改变 hoisting 布局，可能引入 React/Tiptap 多实例，需完整 E2E |

### 关于"依赖是不是太多了"

按 182 个唯一外部包 / 2,063 条锁记录 / 2.0 GB 安装体积衡量，对一个同时包含 Electron 桌面端、无头服务端、CLI、WebUI、Viewer、4 个 IM 网关适配器（Telegram/Lark/WeCom/WhatsApp）和完整 Markdown 编辑器（Tiptap + ProseMirror + Shiki + KaTeX + Mermaid + PDF）的产品，**这个规模是合理的**——编辑器栈、Electron 打包链、Pi SDK 三块就占了绝大部分。

真正偏多的是**声明层**：320 条声明里有 61 个包被重复声明、5 组范围分歧、81 个包靠 hoisting 隐式解析、26 条完全不用的声明。这些不增加包的数量，但让依赖图**不可从清单推导**，也让上游升级时的爆炸半径无法评估。清理 §7 的 18 条是最低风险、最高确定性的一步。

---

## 附：方法说明

- 清单解析：根 + `packages/*` + `apps/*`，共 14 个 `package.json`。
- import 扫描：2,161 个源文件（`.ts/.tsx/.js/.jsx/.mjs/.cjs/.css`），识别静态 import/export、`require()`、动态 `import()`、CSS `@import`；过滤 Node 内建模块、TS 路径别名（`@/`、`@config/`、`@webui/`）与模板字符串噪声。
- 传递闭包：解析 `bun.lock`（v2 JSONC，2,063 条），按 semver 范围匹配选版本；同名多版本时按范围择一。闭包数字是**近似值**——不同解析策略会有 ±10% 差异，但相对排序稳定。
- 已知方法学限制：Bun 使用 **hoisted linker**，源码会消费顶层可见的传递包，因此**只读 `package.json` 无法完整判断运行路径**。`tsconfig.json` 的 `paths` 别名（尤其 `apps/webui` 的 `@/` → `apps/electron/src/renderer/*`）会进一步绕过包边界。本报告中的"未声明"结论因此标注为结构风险，而非立即的运行时错误。
- 排除目录：`node_modules`、`dist`、`.build`、`.cache`、`.verify`、`release`、`Users`、`docs`。`apps/electron/packages/`（gitignored 的 esbuild 产物）与 `apps/electron/vendor/bun/bun` 不计入源码统计。
