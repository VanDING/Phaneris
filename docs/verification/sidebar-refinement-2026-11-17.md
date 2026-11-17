# 侧边栏精修验收

2026-11-17。按已确认的第二版设计实施，范围为侧边栏功能图标、间距与控件表面。顶栏品牌 Logo 的形状、颜色、尺寸定义保持现状。

| 项目 | 实测与实现 |
| --- | --- |
| 主导航图标 | 展开、收起均为 20 × 20px |
| 默认行高 / 中心距 | 34px / 36px，两态图标中心坐标一致 |
| 收起栏宽 / 横向中心 | 48px / 距栏左侧 24px |
| 子项 | 14px 图标、默认 28px 紧凑行，保留语义色与原展开状态 |
| 标签下方分组 | 1px 浅色线、5px 分隔槽；标签与数据源中心距 43px |
| 菜单图标 | 独立 16px 角色，不随主导航放大 |
| 底部 | 22px 头像、20px 设置图标 |
| 新建会话 | 透明常驻背景、无常驻阴影，沿用统一悬停与键盘聚焦反馈 |
| 图形与颜色 | 继续使用共享笔画 token；默认中性色，选中项加深；数据库、文件夹入口减少复合细节 |
| 字号 / 密度 | 根字号 18px、密度 1.125 时，两态主图标尺寸及横纵中心仍一致 |
| 触屏 | 沿用 60px 触屏栏，点击区域至少 44px，图标保持 20px |

13 项浏览器 E2E 全部通过。使用生产 `LeftSidebar`、`SidebarProfile`、共享 Button、真实品牌标识及 Electron 样式，覆盖尺寸与中心线、分隔线、菜单隔离、新建表面、按钮与焦点连续性、提示消退、子项恢复、语义色、深浅色、减弱动态、键盘操作、大字号及触屏。完整原生客户端、安装包和物理触屏不在本次浏览器验收范围内。

本次同时通过：`typecheck:electron`、`typecheck:scripts`、`lint:workspace`、`check:themes`、`check:scale-contract`、`check:design-drift`、`check:contrast-floor`、`check:visual-contracts`、`check:file-size`、`audit:ui-merge`、生产 renderer 构建及 `git diff --check`。

## 证据

完整运行保存在本机 `.cache/verification/sidebar-refinement-2026-11-17-accepted/`，按仓库证据政策不提交截图与运行日志。目录内包括 manifest、几何数据、13 项场景结果，以及 `light-expanded.png`、`light-collapsed.png`、`dark-expanded.png`、`dark-collapsed.png`、`touch-rail.png` 五张截图。

运行来源为 `43ee16f7b476c0403d93825c3dfd15bd35f74aca` 上的未提交工作树；锁文件 SHA-256 为 `3c4270beb91eb14a5a5496c73b1c5de281d03750037e2add2f7d6c83d5338c54`。manifest 登记了当时的工作树变化、场景、产物及其 SHA-256；移动证据目录后内容与哈希保持一致。

| 文件 | SHA-256 |
| --- | --- |
| `manifest.json` | `a7728b1779e5ee9511793d0538a5ca660ad94e90d981adba6124ed347c585220` |
| `geometry.json` | `b82b912f50a9ad039d8c8769afe67fdf4e75d3e665267b6949b9abf118b4d30a` |
| `browser-result.json` | `39dbfd360a74863c4e02688277d64fd55d3d9f9cbc4c5f5bc987bf3c37eb3e82` |

[实施前失败矩阵](./sidebar-refinement-2026-11-17-failure-matrix.md)与本页保留可提交的验收结论；完整运行可由下列命令重新生成。

## 重复验证

在仓库根目录执行，默认生成新的独立证据目录：

```sh
bun run scripts/verification/sidebar-refinement-workflow.ts
```

核验本次证据文件的哈希与场景结果：

```sh
bun run scripts/verification/verification-artifacts.ts --verify=.cache/verification/sidebar-refinement-2026-11-17-accepted
```

角色定义由 `packages/ui/src/lib/visual-roles.ts` 维护，生成 CSS 与主题契约同步更新。顶栏、应用菜单功能及现有导航事件保持原有实现；工作区内其他未提交改动未纳入本轮修改范围。
