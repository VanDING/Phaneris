# Phaneris 全项目动效审视

日期：2026-09-21。源码基线：`f2f5ef74`，同时审视当前工作区；已有插件相关未提交修改未被改动。

| 交付物 | 用途 | 状态 |
| --- | --- | --- |
| [完整审计](motion-audit.md) | 覆盖地图、确定问题、设计差异、待实测风险、保留项 | 完成源码审视与指定隔离验证 |
| [统一动效规则建议](motion-specification.md) | 全项目共享语义、参数、状态与生命周期契约 | 已作为实施基线落地 |
| [验收矩阵](motion-validation.md) | 每条主要操作链路的正常、逆向、打断、无障碍与性能验收 | 部分关闭；P 项见实施状态第 9 节 |
| [实施状态](motion-implementation-status.md) | M01–M16、V01–V08、新增机会的逐项状态、文件与验证结果 | 实施完成；遗留项已列出 |
| [实施验证脚本](motion-verification.mjs) | 真实组件（Playground）在真实浏览器中的 18 项行为检查 | 18/18 通过，结果见 [验证结果](motion-verification-results.json) |
| [扫描清单](motion-audit-inventory.json) | 每个界面文件及动效候选行号，可追溯覆盖范围 | 已生成；命中不等于缺陷 |
| [隔离验证结果](motion-audit-probes.json) | 启动 HTML 与平滑滚动的浏览器观测 | 已运行（M02 已修复，结论由实施验证脚本继续覆盖） |

范围是整个项目，不限定首批组件。实施阶段的源码改动见[实施状态](motion-implementation-status.md)第 1 节摘要；仓库内已有的插件相关未提交修改未被触碰。

建议依赖顺序：验收环境对齐 → 减弱动态与交互生命周期 → 主布局和导航 → 会话/输入/状态 → 预览/标注/拖拽 → 参数收敛及全链路回归。该顺序已在实施中遵循。

复现扫描（PowerShell，在仓库根目录）：

```powershell
$auditCommit = git rev-parse --short HEAD
rg --files apps packages docs hero-demo | node plans/motion-audit-inventory.mjs $auditCommit
```

复现隔离浏览器验证（使用已安装的 Edge，不下载浏览器）：

```powershell
$env:MOTION_AUDIT_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node plans/motion-audit-probes.mjs
```

复现实施验证（需要渲染层开发服务器）：

```powershell
cd apps/electron; bun run dev
node plans/motion-verification.mjs http://localhost:5173
```

现有单元测试基线（含本轮新增契约）：

```powershell
bun test ./packages/ui/src/lib/__tests__/motion.test.ts ./packages/ui/src/components/annotations/__tests__/island-motion.test.ts
```

结果为 8 个测试通过、0 失败。它们验证参数与计算函数，不代表动效体验或全部应用验收通过。
