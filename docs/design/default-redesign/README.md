# Default 主题

状态：2026-10-05，用户授权直接替换内置 Default，已同步内置 JSON、canonical TypeScript、Electron/shared UI 静态样式与窗口启动背景。稳定选择 ID 保持 `default`。

内置文件：[`default.json`](../../../apps/electron/resources/themes/default.json)。[`default-preview.json`](./default-preview.json) 保留为独立设计参考，在用户主题列表里显示 **Default Preview**；正式内置主题名称为 **Default**。

预览：[对照与明暗效果](./preview.html)、[浅色对话](../../verification/results/default-purple-sidebar/chat-light.png)、[深色对话](../../verification/results/default-purple-sidebar/chat-dark.png)、[浅色设置页](../../verification/results/default-purple-sidebar/ai-light.png)、[深色设置页](../../verification/results/default-purple-sidebar/ai-dark.png)。使用真实组件与示例数据；对照页保留修改前的 Default 截图。

## 设计方向

以白色纸面、墨色文字和原有 Default 品牌紫构成浅色版。强调色与聚焦环已按用户后续反馈恢复为 `oklch(0.488 0.275 280.3)`。设置卡片、输入框、菜单统一使用纯白，利用细边线、轻微投影和留白建立层次。用户消息气泡使用克制的灰白 `#F3F3F3`，不带紫色；选中态和次级小控件保留少量底色。New Session 与设置卡片使用相同表面色，悬停保持白底并增加轻微阴影。

深色版使用石墨色背景与稍亮表面，用户消息气泡为中性深灰 `#2B2B2B`，文字采用柔白，强调色与聚焦环恢复原有 `oklch(0.626 0.221 291.7)`。New Session 同样跟随深色卡片表面。警告、成功和危险各有独立语义色。字体优先使用本机系统字体，中英文均保留完整回退；控件圆角基数为 6px，设置卡片为 9px。保留 comfortable 间距。

主题使用现有 JSON 格式与主题引擎，不附加 CSS、不引入图片或新字体。原生导航区继续使用平台材质。页面信息结构、标题和说明长度不属于主题文件能力范围；AI 页重排见 [单独的规划稿](../ai-settings-replan.md)。

## 在客户端使用

安装本轮构建的客户端，在 设置 → 外观 → 颜色主题 中选择 **Default** 即可使用新版，无需复制主题文件。如果已经选择 Default，更新客户端后会自动采用新配色。工作区的独立主题仍然优先于应用选择。

独立参考文件仍可按以下方式加载：

1. 将 `default-preview.json` 手动复制到 `~/.phaneris/themes/default-preview.json`。
2. 在 设置 → 外观 → 颜色主题 中选择 **Default Preview**，切换浅色／深色分别查看。目录变动会触发主题列表更新；没有出现时重新进入外观页。
3. 如果工作区设置了独立主题，在外观页把工作区主题设为继承应用，或为测试工作区选择同一候选主题。
4. 测试结束选择原来的主题即可。内置 Default 与此文件使用相同视觉 token。

不要把文件改名成 `default.json`：`default` 是内置主题保留 ID，用户目录里的同名文件不会覆盖内置 Default。

## 先列出的检查与失败条件

- 用户消息必须是中性灰，真实消息组件的 RGB 通道差不得超过 1；浅色为灰白，深色为低刺激深灰，文字对比度至少 4.5:1。不能只改示意图或留下深色的紫色气泡。
- JSON 必须通过产品现有主题校验器，ID 必须能被用户主题加载器识别；在隔离配置目录实测列表、加载、选择与恢复。
- 真实 ThemeProvider 必须加载候选文件，不得把静态示意图当实际主题效果；记录浅色、深色和中文窄窗口截图。
- 在当前 AI 页保留相同数据和布局，验证灰色卡片已经变成纯白；主题调整不借助页面重排改善效果。
- 正文、辅助文字、菜单文字以及语义提示在各自实际背景上的对比度至少 4.5:1；聚焦环对背景至少 3:1。
- 检查菜单、切换开关、禁用控件、输入框聚焦与对话框；中文无横向溢出，文本不出现未翻译键。
- 输入、菜单和卡片表面须明确给值，避免继承旧 Default 的灰底。图标、圆角、字体与阴影通过公共引擎处理。
- 验证过程不得改动内置 JSON、canonical TypeScript、全局 CSS或个人配置／主题文件；内置 Default 的校验值在前后保持一致。

独立文件复验：`bun run scripts/verification/default-theme-preview-workflow.ts`，生成 `previews/` 和 `validation.json`。内置主题复验：`bun run scripts/verification/default-theme-preview-workflow.ts --builtin`，生成 [`实际 Default 验收结果`](../../verification/results/default-theme-application/validation.json)。应用阶段的失败条件见 [验收矩阵](../../verification/default-theme-application-failure-matrix.md)。

## 初版设计阶段验证结果

13 项流程全部通过，无页面运行错误。抽查语义文字、辅助文字、菜单文字、消息文字和按钮标签，对比度最低为 **5.32:1**；浅色聚焦环对背景为 **5.86:1**，深色为 **8.22:1**。完整测量见 [`validation.json`](./validation.json)。这组数字针对主题 token 的实色组合，不把禁用控件的透明文字算作常规正文。

用户消息实测：浅色背景 rgb(243, 243, 243)，文字对比度 14.14:1；深色背景 rgb(43, 43, 43)，文字对比度 12.43:1。明暗两种气泡均为中性灰。

设计阶段发现的单色供应商 Logo 问题已在应用阶段修复：连接图标、看板模型标签及模型菜单只为已识别的单色资产提供深色反色，Claude、Manifest 与自定义图标保留颜色。使用应用当前明暗模式，不依赖系统明暗设置。JSON 本身不修改图片资产。

应用阶段独立验收保留明暗消息、设置、菜单、对话框、控件、Logo 及中文窄窗口截图；打包应用验收另外覆盖真实设置路由、IPC 与包内主题。个人配置和用户主题文件均未改动。后续恢复原有紫色与白色 New Session 的验收独立保存在 [default-purple-sidebar](../../verification/results/default-purple-sidebar)，以上初版数值与截图保留为阶段记录。
