# 前端外壳视觉微调：验收证据

状态：本机验收通过。源码基于 `971180c62` / `codex/theme-governance-w1`，包含未提交的本轮修改，精确文件哈希见各次 manifest。W1–W5 的历史验收保持冻结。

前后对照页（原 `index.html`）默认对比收起栏的 6px 接缝移除前后，也可查看实施前后展开状态、四个主题、触摸和放大文字。该画廊及其截图已于 2026-10-13 随归档裁剪删除，本节表格与 [review.json](review.json) 仍保留结论与参数（见[档案裁剪](../../README.md#档案裁剪)）。先定义的[失败矩阵](../../frontend-shell-polish-failure-matrix-2026-10-12.md)覆盖几何、操作和启动故障。

## 实际变化

| 项目 | 当前值与行为 |
| --- | --- |
| 展开侧栏 | 默认 200px，普通行 28px，图标 16px；已保存的用户宽度继续优先 |
| 收起侧栏 | 栏宽 48px，24px 正方形控件，两侧各 12px、行间 8px；展开使用文字导航的内距 |
| 接缝 | 侧栏与导航列表额外间距 0px；列表与内容面板仍间隔 6px |
| 首行 | 共用 36px 高度，展开新建按钮与两个面板标题同中心；收起的 24px 按钮在首行居中 |
| Default light | 边框改为中性灰 `#E5E5E6`，阴影色中性；面板软阴影强度提升到 10% |
| 平台圆角 | macOS Default 内角 10px、贴窗口角 8px；Windows Default 保持 6px；用户主题保持自己的 radius |
| 触摸 | coarse pointer 图标栏 60px、操作目标至少 44px；字号放大时导航与首行仍能增长 |
| 调整宽度 | 按鼠标拖拽增量调整，避免接缝产生跳位；带名称的宽度滑块支持方向键与 Home/End，持久化现有限值内的宽度 |
| 启动 | 等待实际偏好、workspace 主题选择、主题快照及字体就绪后揭开启动层；读取失败使用可用回退 |

主题参数与尺寸继续由现有语义角色生成，没有新主题字段或全局样式豁免。移除了 5 项已迁移的视觉债务和 2 项已验证操作行为的旧 sash 静态交互豁免，没有新增 ledger 条目。角色回归中的浮层关闭步骤等待真实卸载和焦点恢复，避免连续 Escape 误投递。

## 验收范围

| 工作流 | 通过 | 证据 |
| --- | --- | --- |
| 真实 macOS Electron | 44/44 | [实测 JSON](native/shell-visual.json) · [manifest](native/manifest.json) · trace 与截图已裁剪（2026-10-13） |
| 启动故障与延迟 | 12/12 | [实测 JSON](startup/theme-startup.json) · [manifest](startup/manifest.json) · trace 与截图已裁剪（2026-10-13） |
| 跨入口角色回归 | 76/76 | [实测 JSON](roles/theme-roles.json) · [manifest](roles/manifest.json) · trace 与截图已裁剪（2026-10-13） |

Electron 使用真实生产 main/preload/renderer、临时配置和两条本地会话。验证首行、可见灰带居中、正方形、滚动、展开/收起拖拽、键盘焦点与宽度限值、已保存宽度、四主题、实际 Chromium 200% zoom 和较大根字号。临时配置清理后，不触及用户会话或用户主题目录。

原生启动故意让 15px Default 缓存与持久的 13px 主题不一致。[逐帧证据](native/startup-frames.json)记录 259 帧，89 帧开始可见，可见帧全部为持久主题的 13px。另用生产 ThemeProvider/compiler/CSS 配合延迟和失败 API 检查 workspace 主题、事件使旧请求失效、偏好失败、主题失败和无 API 预览；此部分不是完整 App 的原生 API 故障注入。

角色回归覆盖 Electron/WebUI/viewer 的生产控件、CSS、字号/密度、窄屏、浮层与键盘操作。该次回归之后，shell 接缝与 sash、启动事件就绪标志、文案及证据脚本继续调整；最终原生和启动工作流分别验证这些变化。共享角色/CSS 行为保持该次回归版本。三个子目录保留原 manifest 与 JSON 结果；trace、截图及录屏已于 2026-10-13 裁剪，顶层 SHA256SUMS 仍记录其路径与 SHA-256，可核对“当时存在过什么”（见[档案裁剪](../../README.md#档案裁剪)）。

Windows 截图是在 macOS renderer 中模拟平台标识，证明圆角规则选择正确；Windows 原生窗口合成器尚未验证。触摸由 Chromium 模拟。签名安装器、原生 Linux 和实物触摸设备未验收。

## 代码门禁

完整 `typecheck:all`、`lint`（含主题生成一致性、四域视觉债务、架构/RPC/循环/分发门禁）、i18n 四项、版本检查通过。既有主题与存储测试 22/22 通过；没有新增单元测试。

`identity:check` 仍被两份未修改的历史日志中的 4 处既有标识残留阻挡。`check:docs` 的当前失败是第二轮历史档案的日志已在本机出现、但仍登记着“日志缺失”的精确例外；该日志属于 Git 忽略的目录。本轮新文档链接与索引均有效。保留原始日志和可移植的历史缺口记录，不以重写历史证据代替治理，也未绕过 pre-push。

## 复现与校验

在仓库根目录顺序运行浏览器工作流，避免共享 Vite 优化缓存的并发竞态：

```sh
bun run test:shell-visual
bun run test:theme-startup
bun run test:theme-roles
```

每次写入唯一 `.cache/verification/`；如需指定输出，使用尚不存在的 `--output-dir=<path>`。该归档已于 2026-10-13 裁剪媒体，`--verify` 不再适用；重跑对应工作流可再生成完整运行（见[档案裁剪](../../README.md#档案裁剪)）。[SHA256SUMS](SHA256SUMS) 仍记录当时全部产物的路径与 SHA-256：已裁剪条目和本轮修订过的 README 会报告不匹配，未改动的文件照常校验。

```sh
cd docs/verification/results/frontend-shell-polish-2026-10-12
shasum -a 256 -c SHA256SUMS
```

`before/` 是视觉对照素材：实施前展开图只记录观察，当时基线脚本在后续切换按钮的语言匹配上停止；收起接缝图来自移除间隙前的本轮迭代；这些 PNG 已于 2026-10-13 裁剪，清单与 SHA-256 见 SHA256SUMS。二者不计入 132 项验收。[汇总数据](review.json)和[校验表](SHA256SUMS)提供出处与参数。
