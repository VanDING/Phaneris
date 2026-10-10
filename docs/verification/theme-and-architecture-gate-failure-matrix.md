# 主题声明一致性与架构门禁：实施前故障矩阵

状态：故障方式于实施前写定（2026-10-10）。批次 A、B 尚未实施；第 4 节在实施后回填实际覆盖。表中所列是**要求**，不是通过证据。

源码基线：`61970997`（工作树另有 2 个未提交的 `docs/verification/results/packaged-client-*.json`）。

范围依据：[系统清理与优化计划](../process/system-cleanup-optimization-plan-2026-10-10.md) 批次 A、B。

关联：[Durable Runtime 边界故障矩阵](./durable-runtime-boundary-failure-matrix.md)（批次 B 复用其门禁机制与 mutation 证据格式）。

## 1. 实施前已核实的事实

这些是设计本矩阵时实测得到的，不是推断：

| 事实 | 证据 |
| --- | --- |
| CI 在 `main` 上是红的 | `.github/workflows/validate.yml:58`（ubuntu，`test:critical` 含 `theme.test.ts`）与 `:118`（windows，直接跑 `theme.test.ts`）都会失败 |
| 漂移只有 9 处，全部集中在字体 | `default.json` 的 `fontSans`/`fontMono`；`apps/electron/src/renderer/index.css` 与 `packages/ui/src/styles/index.css` 的 `:root`/`.dark` 各缺 `--font-sans`/`--font-serif`/`--font-mono`。颜色、密度、阴影、尺寸等全部已一致 |
| 字体栈的单一来源是 `typography.css`，且两个 CSS 文件都已 import 它 | `packages/ui/src/styles/typography.css:48-61`；`apps/electron/src/renderer/index.css:2`；`packages/ui/src/styles/index.css:27` |
| 两个 CSS 文件的 `:root` **故意**不含字体 token，并已各自写明 | `packages/ui/src/styles/index.css:119-120`、`apps/electron/src/renderer/index.css:188-189` |
| 断言"字体 token 必须出现在这两个 `:root` 里"与上述设计矛盾 | `packages/shared/src/config/__tests__/theme.test.ts:186-197` |
| `DEFAULT_THEME` 的字体栈与 `typography.css` 展开 `var(--font-cjk)` 后**逐字相等** | 实测：sans / serif / mono 三项全部相等 |
| `default.json` 被两个打包验证流程当作不变量断言 | `scripts/verification/packaged-refinement-workflow.ts:61`、`scripts/verification/local-client-package-workflow.ts:33`（均为 `assert.deepEqual(..., DEFAULT_THEME_FILE)`） |
| `resources/themes/` 没有运行时读者 | `loadPresetTheme`（`packages/shared/src/config/storage.ts:1644-1650`）对内建 ID 直接返回 `BUILTIN_THEMES[id]`；`getBundledAssetsDir('themes')` 在当前源码中零调用 |
| 该目录是上游 `ensurePresetThemes()` 的遗留物 | 旧逻辑仍留在被 gitignore 的构建产物 `packages/pi-agent-server/dist/index.js.fork:458850-458877` |
| 四个内建主题都各自声明字体 token，互不继承 | `geek.json:42-44`、`cyberpunk-2077.json:42-44`、`ink.json:44-46` |
| 现有资源哈希已被记录两次且互不相同 | `results/default-purple-sidebar/validation.json:376` = `2cba0310…`（与当前文件一致）；`results/default-theme-application/validation.json:372` = `b14cf0a3…`（更早） |
| 行尾策略为全仓 LF | `.gitattributes:11` `* text=auto eol=lf` |

**结论性判断**：这批红不是"产品字体错了"——用户看到的 Default 字体来自 `theme.ts` 的 `BUILTIN_THEMES`，本来就是对的。真正的缺陷是三条：(1) 一个被打包且被验证流程断言为不变量、又被测试守护的**重复来源**漂移了；(2) 守护它的断言写成了与既有设计矛盾的形式；(3) CI 因此长期为红。因此本批次的方向是**让不变量为真、并把断言改写成真正的不变量**，不是改产品字体。

## 2. 批次 A：主题声明一致性

要成立的不变量：

- **I-A1**：`BUILTIN_THEMES` 的每个成员与 `apps/electron/resources/themes/<id>.json` 深度相等。
- **I-A2**：`DEFAULT_THEME` 的 `fontSans`/`fontSerif`/`fontMono` 与 `typography.css` 中同名 token 展开 `var(--font-cjk)` 后语义相等。
- **I-A3**：`themeToCSS(DEFAULT_THEME_FILE, mode)` 输出的**除三个字体 token 之外**的每个 token，在两个 CSS 文件的 `:root` / `:root`+`.dark` 中取值相同。
- **I-A4**：字体 token 在这两个 CSS 文件中**只**来自被 import 的 `typography.css`，不在文件自身的 `:root` 里重复声明。

| ID | 触发/故障方式 | 要求 | 证据 |
| --- | --- | --- | --- |
| FA01 | 只改 `DEFAULT_THEME` 或只改资源文件（0.3.1 的实际故障） | I-A1 失败，并指出具体文件与具体 key，而不是笼统报错 | 断言输出含 id 与 key |
| FA02 | 某个资源文件缺失、为空或非法 JSON | 失败信息区别于"内容不等"，不得因读取异常被吞掉 | 分别构造三种输入 |
| FA03 | 只改 `typography.css` 或只改 `DEFAULT_THEME` 的字体栈 | I-A2 失败 | mutation：改一处，门禁变红 |
| FA04 | `var(--font-cjk)` 的书写次序/引号/空白被格式化，但字面量含义不变 | 归一化后**不**失败（避免把格式当语义） | 归一化实现 + 一条"仅重排空白仍通过"的用例 |
| FA05 | 颜色/密度/阴影/圆角等任一非字体 token 在静态 CSS 与 `DEFAULT_THEME` 间漂移 | I-A3 仍然失败（不得为让门禁变绿而放宽既有保护） | mutation：改 `--accent` |
| FA06 | 为让测试变绿，把 `--font-sans` 直接抄进两个 CSS 文件的 `:root` | I-A4 失败（这会造出第二个静态来源，正是本批次要消除的） | 门禁对重复声明的检查 |
| FA07 | 删除字体断言以消除红 | 不为绿而删：I-A2 必须有能因 FA03 变红的实现 | FA03 的 mutation 即证明 |
| FA08 | `html[data-font="inter"]` / `[data-font="system"]` 被误判为漂移而删除或改写 | 两个覆盖块保持存在且仍位于 `:root` 之后（优先级不变），两个方向的语义都不被"修正"成对方 | 断言两块的 `--font-sans` 与 `--font-default` 仍在，且 `inter` 必须、`system` 必须不引用 `var(--font-cjk)` |
| FA09 | 改动 `DEFAULT_THEME` 字体意外改变其它内建主题 | 四个内建主题各自保留自己的字体 token；跨主题不继承 | 逐主题字体断言 |
| FA10 | 重写资源文件时改变键序/缩进/结尾换行，制造无意义 diff | 序列化与既有三个文件一致（2 空格缩进 + 结尾换行） | diff 只应包含 `fontSans`/`fontMono` 两行 |
| FA11 | 资源文件在 `docs/verification/results/` 中已有记录哈希，重写后旧记录被就地改写 | 历史记录保持原值（点时刻快照约定），新哈希写入本次结果 | 只新增结果，不改旧 JSON |
| FA12 | 断言依赖相对路径与正则，文件移动或在 CRLF 检出下静默失效 | 路径失效必须报错而非通过；CRLF 下仍能解析 | 记录 `.gitattributes:11` 为 LF；构造 CRLF 输入验证 |

## 3. 批次 B：架构门禁

要成立的不变量：

- **I-B1**：从 `apps/webui` 入口可达的模块闭包中，不含 Electron-only 或 Node-only 依赖（显式允许列表除外）。
- **I-B2**：workspace 包之间只经声明的 `exports` 互相引用，不存在跨包深层导入。
- **I-B3**：I-A2/I-A3 的一致性除了测试之外，还有一条 lint 期静态规则。
- **I-B4**：每条规则都报告自己检查过的文件数；检查数为 0 视为失败（空跑不得算通过）。

| ID | 触发/故障方式 | 要求 | 证据 |
| --- | --- | --- | --- |
| FB01 | webui 侧新增 `electron` / `node:*` / Electron renderer 专属模块的 import（今天会被 vite shim 静默解析） | 门禁失败并给出 specifier 与引入链 | mutation：在 webui 加入一个 Node import |
| FB02 | 违规通过 barrel 再导出、`import type` 或动态 `import()` 绕过字符串匹配 | 门禁基于**解析后的**模块图判定，规则对 type-only / 动态 / barrel 同样生效 | 各构造一种绕过 |
| FB03 | 规则过宽，把合法 webui 代码（如 `import.meta.env.IS_WEBUI`、React、shared 的浏览器安全子路径）判为违规 | 允许列表显式且最小；允许列表本身有断言，不得静默增长 | 允许列表文件 + 反例用例 |
| FB04 | 只扫描 `apps/webui/src/**` 而漏掉它实际拉入的 electron renderer 源码 | 规则作用于从入口出发的可达闭包，而不是目录前缀 | 用 `apps/webui/src/App.tsx:19` 的 `@/App` 作为可达性反例 |
| FB05 | 跨包深层导入规则误伤包内相对路径或 `@/` 别名 | 规则只约束跨包 specifier | 反例：包内相对导入不得失败 |
| FB06 | 目标包没有 `exports` 映射（`viewer`/`webui`/`electron` 等） | 不得崩溃。实现选择**按未声明处理**而非跳过：没有 `exports` 的包没有对外声明面，其任何子路径导入都是隐式边，应当暴露；今天这类导入数为 0，因此不产生噪音 | 无 `exports` 的包跑通并产出 finding |
| FB07 | 规则写了但没接进门禁，等于没有 | 每条规则都接入 `lint`，并有"故意违规 → 门禁失败"的记录 | mutation 记录（沿用 `results/durable-runtime-boundary/gate-mutations.json` 格式） |
| FB08 | 规则因 glob 拼写或新目录未被遍历而**一个文件都没检查**，却报通过 | I-B4：检查数为 0 即失败；闭包退化为入口自身也算失败 | 构造空入口用例 |
| FB09 | 生产 mutation 证据时把仓库留在被改状态 | mutation 可回滚且逐条记录；结束时工作树与开始时一致 | mutation 前后 `git status` 对比 |
| FB10 | 新规则破坏既有 durable-runtime 规则或 `--baseline` 模式 | 既有规则集与 baseline 输出不变 | 新旧依赖报告对比 |
| FB11 | 主题静态规则与批次 A 的测试重复实现，二者判定不一致 | **不重复实现**：主题不变量只存在于 `theme.test.ts` 一处，architecture gate 不携带主题规则；批次 B 改为把该测试接入 `validate:ci`（`test:shared:config`），让不变量在 pre-push 就会被执行 | `scripts/check-architecture.ts` 内无任何字体 token 引用 |

## 4. 实施后的覆盖记录

全部证据见[验收说明](./results/theme-architecture-gate/README.md)；19 条 mutation 的逐条结果在 `results/theme-architecture-gate/gate-mutations.json`。

| ID | 已运行证据 | 覆盖限制 |
| --- | --- | --- |
| FA01 | mutation：把资源文件 `fontSans` 改回旧栈 → `keeps the bundled default resource synchronized` 断言失败 | 只验证 Default；其它三个由 FA09 覆盖 |
| FA02 | mutation：把资源文件写成非法 JSON → 测试以解析错误失败 | "缺失文件"未单独构造（读取异常路径相同） |
| FA03 | mutation：`typography.css` 的 `--font-sans` 去掉 `Inter Variable` → 失败 | 反方向（只改 `DEFAULT_THEME`）未单独构造，同一断言双向生效 |
| FA04 | mutation：只重排空白 → **保持通过**（归一化按 `\s+` 折叠后比较） | 未构造"引号风格不同但语义相同"的用例 |
| FA05 | mutation：改 electron `--accent` → 失败 | 只验证一个非字体 token；其余同走一条断言 |
| FA06 | mutation：向 electron `:root` 插入 `--font-sans` → 失败 | — |
| FA07 | 由 FA03 的 mutation 证明断言仍可失败；实现中未删除任何断言，只替换为真实不变量 | — |
| FA08 | mutation 两个方向：`inter` 去掉 `var(--font-cjk)` → 失败；`system` 加入 `var(--font-cjk)` → 失败 | 未验证两个覆盖块之间的相对顺序（只断言在 `:root` 之后） |
| FA09 | mutation：改 `geek.json` 的字体族 → `bundles exactly the four canonical` 失败 | 未逐个构造四个主题的用例；一条断言遍历全部 |
| FA10 | 实测 diff：`1 file changed, 2 insertions(+), 2 deletions(-)`，只含 `fontSans`/`fontMono` | 非 mutation，是本次改动的直接观测 |
| FA11 | `git status --porcelain docs/verification/results/default-{theme-application,purple-sidebar}` 为空；新哈希 `80ed5893…` 只写入本次结果 | 新资源哈希会使这两个历史记录中的旧值不等于当前文件，这是点时刻约定，不视为缺陷 |
| FA12 | mutation：把 electron CSS 整体转为 CRLF → **保持通过**；`.` `gitattributes:11` 为全仓 LF | 未构造"文件被移动"的用例 |
| FB01 | mutation：入口新增 `import 'node:readline'` → `webui-unshimmed-node` 失败 | — |
| FB02 | mutation 三种形式：动态 `import()`、`export * from`、`import type` → 全部失败（规则走解析图而非字符串匹配） | 未构造"经 barrel 二次转出"的用例；`export *` 已覆盖同一条解析路径 |
| FB03 | mutation：入口新增已 shim 的 `node:path` → **保持通过**；允许列表由 vite 配置解析而来，46 项，含 canary 校验 | 允许列表的"最小性"是人工判断，非自动证明 |
| FB04 | 规则作用于从 `apps/webui/src/main.tsx` 出发的 1011 模块闭包：`playground/registry/generate-icons.ts` 在 webui 的 tsconfig `include` 内但不在闭包内，因此未被报告——这正是可达闭包与目录前缀的差别 | 闭包包含动态与 type-only 边，比 Vite 的急切图更严格；未量化生产包实际 ship 的模块数 |
| FB05 | mutation：入口新增包内相对导入 `./responsive` → **保持通过** | — |
| FB06 | mutation：入口新增 `@phaneris/viewer/__probe__`（该包无 `exports`）→ 失败且无崩溃；实现选择按未声明处理而非跳过 | 今天仓库内此类导入为 0，因此该选择尚未在真实代码上产生过 finding |
| FB07 | 两个入口都已接线：`lint`（→ `validate:ci` 与 pre-push）与 `test:critical`；`test:critical` 完整跑通 exit 0 | — |
| FB08 | mutation：把入口清空 → 闭包退化为 1 个模块，`inspected 1 module(s)` 失败 | 只覆盖规则 1 的守卫；规则 2 的守卫（检查数为 0）未单独构造 |
| FB09 | mutation 套件自报 `workingTreeUnchanged: true`，逐条 `restoredByteForByte` 全为真 | — |
| FB10 | `scripts/check-runtime-boundary.ts --baseline` 输出的 sha256（去掉 `generatedAt`）在抽取前后均为 `4d0d2b9b…`；抽取后又经两次 lib 修改，最终复核仍相同 | 只比较 `--baseline` 输出；acceptance 模式另行跑通（exit 0，0 violation） |
| FB11 | 未重复实现：`scripts/check-architecture.ts` 内零处字体 token 引用；主题不变量只存在于 `theme.test.ts`，并已通过 `test:shared:config` 进入 `validate:ci` | — |

**未覆盖**：批次 A、B 的整体门禁在 CI 上的实际运行（本地无法执行 `test:doc-tools`，见下）；`validate:ci` 在本沙箱只能逐项运行。

### 验证边界（2026-10-11 更新）

`bun run validate:ci` 起初无法在本沙箱整体通过，因为 `test:doc-tools` 需要 `uv` 写入 `~/.cache/uv`，而该路径当时在工作区之外被文件沙箱拒绝（与本次改动无关，可用 `uv run --no-project python -c "print('ok')"` 复现）。

沙箱限制解除后已完整复跑：**`validate:ci` 与 `test:critical` 均退出 0**，包括 `test:doc-tools`（24 tests OK）。因此本文档不再保留"某项只能逐条运行"的说法。

批次 A、B 的门禁在 CI 上的运行仍需一次真实推送确认（本地已按同一组命令复跑）。

### 本次发现的一个附带问题

`test:critical` 会**就地重写** `docs/verification/results/durable-runtime-boundary/` 下已归档的证据（`crash.json`、`workflow.json`、DB 快照、`gate-mutations.json`）。本地运行一次就会把这些 Windows 上产生的记录（`win32`、`C:\Users\dotty\…`、当时的 `headSha`）替换成本机的 macOS 产物。本次已将这些文件还原为 HEAD 版本，未纳入改动。建议后续把该目录改为运行产物落到忽略目录、只在明确归档时提升为记录。

## 5. 验证产物约定

批次 A 的产物：`test:critical` 在 macOS 与 CI 两个入口的运行记录、资源文件新旧哈希、`git diff` 只含预期两行的证明。

批次 B 的产物：每条规则的 mutation 记录（违规片段、门禁输出、回滚确认）、规则检查文件数、既有规则集的前后对比。

结果归档到 `docs/verification/results/theme-architecture-gate/`；产物清单、重跑命令与覆盖限制见[验收说明](./results/theme-architecture-gate/README.md)。历史记录（`results/default-purple-sidebar/`、`results/default-theme-application/`）保持原值，不就地改写。
