# 主题引擎与前端视觉：独立审计证据（2026-10-12）

- 状态：**审计完成；记录产品现状与缺陷，治理尚未实施。**
- 方案：[独立审计与治理方案](../../../process/theme-engine-frontend-governance-plan-2026-10-12.md)。
- 先写的条件：[失败矩阵](../../frontend-theme-visual-audit-failure-matrix-2026-10-12.md)。
- 产品基线：`e39f60cb2bfafe30476ca35774aec87ffa9629aa`。JSON 记录执行时间、工作树状态摘要和 935 个唯一源码/配置/输入文件的 SHA-256；927 个前端文件参与盘点。
- 环境：macOS x64、Bun 1.4.2、Chromium 153.0.8010.12；普通样本1280×820、DPR 1。中文产品页1040px宽；移动样本390×844，coarse pointer / touch模拟。

## 如何理解结果

这是直接编译当前源码的浏览器审计，使用真实 ThemeProvider、Button/Input/Select、CodeBlock、Viewer App/SessionViewer/TurnCard 和既有产品页面 fixture。账号、偏好、加载延迟和 Viewer HTTP session 为合成数据；未接触用户账户或真实会话。四个 host 名称表示使用其实际 CSS 入口，不能据此声称已经运行四个完整宿主。

探针退出0表示执行完成，不表示缺陷已经修复。JSON 同时保存正常和有缺陷的现状；本轮没有把已知缺陷写成应长期保持的断言。产品源码摘要前后相同，历史审计与历史验证结果未修改。

| 产物 | 内容与边界 |
| --- | --- |
| [audit-data.json](audit-data.json) | 文件级AST盘点、11个schema输入、14个主题/模式/CSS宿主样本、11个生命周期快照、焦点/媒体/尺寸、portal、六张产品页样本、独立与实际Viewer代码各两个切换快照、运行错误与源码摘要 |
| [reproduce.mjs](reproduce.mjs) / [audit-fixture.tsx](audit-fixture.tsx) | 从源码启动独立Vite与Playwright；默认输出到.cache，结束关闭浏览器与server |
| [lint-data.json](lint-data.json) / [lint-probe.mjs](lint-probe.mjs) | 11个文件的有效ESLint配置；9个真实Electron/UI文件的定向lint结果 |
| [browser-run.log](browser-run.log) / [lint-run.log](lint-run.log) | 执行日志；发现仍需按JSON和源码解释 |
| [theme-existing-tests.log](theme-existing-tests.log) | 既有theme/storage检查：22 pass、0 fail、332 expect；本轮未新增单元测试 |
| [fonts-check.log](fonts-check.log) | 既有check:fonts通过：默认stack与主题一致、本地variable faces、无字体CDN |
| [audit-tooling-lint.json](audit-tooling-lint.json) | 本轮三个探针文件的通用正确性lint |
| [docs-check.log](docs-check.log) | 新增文档完成后的链接、索引和状态门禁 |
| [SHA256SUMS](SHA256SUMS) | 本目录的冻结文件摘要；不含自身 |

## 已记录的结果

| 场景 | 观察结果 |
| --- | --- |
| Default及其他内置主题 | 四套内置schema通过；Default/Ink支持明暗；Geek/Cyberpunk收到light请求仍应用dark。共14个CSS宿主样本 |
| loading / 迟到响应 / 失败回退 | loading保留Ink；最终Cyberpunk没有被迟到Geek覆盖；missing与拒绝加载均回到Default/error |
| 优先级 / 保存失败 | preview > workspace > app；清除preview恢复workspace；保存失败回滚Ink并保留preferenceError |
| WebUI延迟API | bridge安装后持久值Geek，provider仍Default/ready；读取调用0、订阅0，推送偏好事件无效 |
| 焦点 | native按钮Tab后focus-visible=true，但outline none且shadow none；真Button有2px焦点环 |
| 阴影 | 四个CSS入口的shadow-xs/sm/md计算为none；语义shadow-minimal有效 |
| 入口差异 | Default light的foreground-50、rounded-md、Lucide stroke在Electron/UI之间已经不同 |
| 值有效性 | 无效颜色、负长度/错误fontSize、透明popoverSolid、任意Shiki、无图片scenic均可过PresetThemeSchema；分号注入和unknown key被拒绝 |
| 对比度 | Ink light的muted/background约3.63:1；Viewer dark的accent/background约3.99:1；本轮Default正文与真Button样本达标 |
| density / fontSize | 语义行compact/comfortable/cozy约43.25/47/50.75px；根字号15→18会同步放大rem控件尺寸 |
| coarse pointer | icon Button高度获得44 CSS px，宽度仍33.75；WebUI zoom1.2后的命中矩形约40.5×52.8 |
| OS reduce / forced colors | 媒体模拟中motion duration为1ms，现有共享控件焦点和系统颜色替换有效；不表示全项目动画已验收 |
| 打开的Select portal | 保持打开切到Geek后，portal背景和圆角跟随；本轮未对Esc焦点恢复终态作阻挡断言 |
| standalone CodeBlock | 与Viewer相同的state→passive DOM class模式；切到dark后仍github-light、span颜色未变 |
| 实际Viewer App | 通过真实Header按钮切换；SessionViewer/TurnCard中已有代码仍github-light，根为dark、span颜色未变。HTTP session合成，整条前端渲染链使用实际组件 |
| 门禁缺口 | 原生class z-[N]没有触发当前z规则；Viewer/WebUI缺少同等专用样式规则；a11y仅部分域。定向lint0 errors、2个既有TaskEditor hooks相关warnings |

所有颜色数值取自computed style并转换为8-bit sRGB；仅对不透明组合报告上述比率。本轮scenic透明表面只记录透明状态，未将其直接计算成不适用的对比度。接近阈值的后续验收需更高精度复核。

最终浏览器运行无runError、无pageerror；有一条故障注入时被主动拦截的`audit.invalid`资源请求console error。工具lint为0 errors/0 warnings。完整宿主和产品验收仍按下方未覆盖清单执行。

## 截图入口

共28张PNG，具体文件及摘要见SHA256SUMS。关键对照：

| 用途 | 截图 |
| --- | --- |
| 原生与共享控件焦点 | [native](keyboard-native.png) / [Button](keyboard-role-button.png) |
| Electron与共享UI | [Electron light](electron-default-light.png) / [UI light](ui-default-light.png) |
| 内置Ink辅助文字 | [Ink light](electron-ink-light.png) / [Ink dark](electron-ink-dark.png) |
| 实际中文AI设置 | [light](product-ai-light.png) / [dark](product-ai-dark.png) |
| 实际消息组件 | [light](product-chat-light.png) / [dark](product-chat-dark.png) |
| 公共控件与菜单 | [light](product-controls-light.png) / [dark](product-controls-dark.png) / [打开期间切主题](open-menu-theme-change.png) |
| WebUI窄屏与媒体 | [390px touch](webui-touch-390.png) / [reduce + forced colors](reduce-forced.png) |
| 代码切换 | [standalone dark](viewer-code-dark-toggle.png) / [Viewer App light](viewer-app-code-light.png) / [Viewer App dark](viewer-app-code-dark.png) |

## 复现

在已安装仓库依赖和Playwright Chromium的仓库根运行：

```sh
bun docs/verification/results/frontend-theme-visual-audit-2026-10-12/reproduce.mjs
bun docs/verification/results/frontend-theme-visual-audit-2026-10-12/lint-probe.mjs
bun test packages/shared/src/config/__tests__/theme.test.ts packages/shared/src/config/__tests__/theme-storage.test.ts
bun run check:fonts
bun run check:docs
bunx eslint --config eslint.config.mjs docs/verification/results/frontend-theme-visual-audit-2026-10-12/reproduce.mjs docs/verification/results/frontend-theme-visual-audit-2026-10-12/lint-probe.mjs docs/verification/results/frontend-theme-visual-audit-2026-10-12/audit-fixture.tsx
```

默认新结果写入`.cache/frontend-theme-visual-audit-rerun/`。显式`--output=<新目录>`可指定另一个归档位置；不要把未来运行写回本次冻结目录。复现时默认端口0，不占用已有dev server。若当前机器只有特定Playwright channel，可设置`PHANERIS_TEST_BROWSER_CHANNEL`；比较时须记录实际浏览器和字体环境。

校验本次归档：

```sh
cd docs/verification/results/frontend-theme-visual-audit-2026-10-12
shasum -a 256 -c SHA256SUMS
```

源码已变化时应产生新基线，不要求本次候选数量永远相同。盘点是排除注释后的字符串候选和AST元素数量，不能当成lint违规总数；brand/ANSI/图形/基础控件仍须分类。

## 未覆盖的验收

真实WebSocket与多窗口、用户文件watcher、正式Electron包、macOS/Windows/Linux材质、真实移动Safari软键盘、PDF/Pages深度流程、大会话性能和原报告Retina截图没有在本轮闭环。H01–H11记录后续要求。截图目测不能证明点击命中、遮挡、键盘完整流程或性能预算通过。
