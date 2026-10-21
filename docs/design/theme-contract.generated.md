# 当前主题契约（自动生成）

状态：accepted。由 `bun run theme:generate` 生成，`check:themes` 检查漂移。编辑 manifest、resolver 或 role 定义后同时重新生成。

兼容：旧 `fontSize` 仍改变根字号和 rem 几何；UI scale、阅读 scale 为独立内部角色，不新增必填用户字段。原始用户文件不改写。

## 内置主题

| ID | 名称 | 支持模式 |
| --- | --- | --- |
| default | Default | light, dark |
| geek | Geek | dark |
| cyberpunk-2077 | Cyberpunk 2077 | dark |
| ink | Ink | light, dark |

## 作者字段

每个视觉字段均为可选；preset 文件仍须有名称及至少一个基础颜色。省略的字段按现有继承链取 Default。模式、背景图片和 Shiki 配置另由结构 schema 约束。

| 字段 | CSS 变量 | 浏览器目标 / 约束 |
| --- | --- | --- |
| background | `--background` | color |
| foreground | `--foreground` | color |
| accent | `--accent` | color |
| info | `--info` | color |
| success | `--success` | color |
| destructive | `--destructive` | color |
| backgroundElevated | `--background-elevated` | color |
| foregroundDimmed | `--foreground-dimmed` | color |
| secondary | `--secondary` | color |
| secondaryForeground | `--secondary-foreground` | color |
| muted | `--muted` | color |
| mutedForeground | `--muted-foreground` | color |
| card | `--card` | color |
| cardForeground | `--card-foreground` | color |
| popoverForeground | `--popover-foreground` | color |
| border | `--border` | color |
| ring | `--ring` | color |
| userMessageBubble | `--user-message-bubble` | color |
| paper | `--paper` | color |
| navigator | `--navigator` | color |
| input | `--input` | color |
| popover | `--popover` | color |
| popoverSolid | `--popover-solid` | color；完全不透明 |
| depth | `--theme-depth` | 枚举 / 结构 |
| shadowColor | `--theme-shadow-color` | color |
| shadowStrength | `--theme-shadow-strength` | 枚举 / 结构 |
| glassBlur | `--theme-backdrop-blur` | margin-left；非负 |
| radius | `--theme-radius` | border-radius；非负 |
| borderWidth | `--theme-border-width` | border-width；非负 |
| borderStyle | `--theme-border-style` | border-style |
| fontSans | `--font-sans` | font-family |
| fontSerif | `--font-serif` | font-family |
| fontMono | `--font-mono` | font-family |
| fontSize | `--font-size-base` | font-size；正值 |
| lineHeight | `--line-height-base` | line-height；正值 |
| letterSpacing | `--tracking-normal` | letter-spacing |
| iconStrokeWidth | `--icon-stroke-width` | stroke-width；正值 |
| iconStrokeLinecap | `--icon-stroke-linecap` | stroke-linecap |
| density | `--theme-density` | 枚举 / 结构 |

## 校验与发布

结构使用 [schemas.ts](../../packages/shared/src/config/schemas.ts)，文件、路径和图片限制使用 [appearance.ts](../../packages/shared/src/config/appearance.ts)。浏览器 [compiler](../../packages/ui/src/lib/theme-compiler.ts) 验语法、引用依赖、计算值、opaque 和图片解码；错误不能标记 ready，回退 Default 并保留 requested/applied 与 diagnostics。合法现代 CSS、var fallback、calc 和相对单位仍可使用。

对比度由作者负责，编译器只提示：`--*-text` 由 accent/info/success/destructive 向 foreground 混合，直到 4.5:1；`foreground` / `mutedForeground` / `foregroundDimmed` 与承载面的组合低于 4.5:1 时产出 `code: contrast` 的 warning，不阻断发布。内置主题另由 `bun run check:contrast-floor` 按 WCAG 计算并断言。scenic 背景图无法静态计算，作者须自行为文字列提供保护层。

Shiki 可用名称来自安装版本的 [生成注册表](../../packages/shared/src/config/shiki-themes.generated.json)，当前 65 个。scenic 必须有图片，缺图或解码失败会回退；本地图片不能逃出主题目录，支持的单图上限仍为 20 MiB。

派生和 Default 由 [theme.ts](../../packages/shared/src/config/theme.ts) 发布；[角色定义](../../packages/ui/src/lib/visual-roles.ts) 和 [生成 manifest](theme-contract.generated.json) 同步检查。动作时长、曲线、距离和 scale 由 TS/CSS parity 检查，不属于颜色主题。
