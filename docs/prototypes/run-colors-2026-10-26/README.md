# Run 配色与少请求图表评审

这是独立的方案评审演示，不会改变产品配置。用户已于 2026-10-26 确认 **A · 清透原色** 和 **等距细柱**；对应实现位于生产 Run 组件中。本演示保留其他方案用于对照。

- **A · 清透原色**：接近原版的清晰和活力，拉开相似色相。
- **B · 柔和粉彩**：降低大面积工具结果的颜色压迫感。
- **C · 经典图表**：适中饱和度，偏成熟统计图表。
- **原版**：保留用户截图中的色板作对照。

支持浅色/深色、Overview/Context/Trajectory、3/5/12/113/300 次请求、宽屏/600px 面板，以及等距细柱/紧凑靠左/原版填充三种少请求布局。示例数据不代表真实供应商用量。

直接打开 `index.html`，或运行：

```powershell
bun run docs/prototypes/run-colors-2026-10-26/serve.ts
```

浏览器验证：把上一步的 URL 放入环境变量，然后执行：

```powershell
$env:PHANERIS_DESIGN_REVIEW_URL = 'http://127.0.0.1:端口/'
bun run docs/prototypes/run-colors-2026-10-26/verify.ts
```
