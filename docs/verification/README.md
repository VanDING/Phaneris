# 验证脚本与结果

本页汇总日历/Gantt、动效和打包客户端的验证入口。脚本从任意工作目录启动时都会定位仓库根目录；JSON 结果保存在 `results/`，运行日志保存在被忽略的 `.cache/verification/`。

| 范围 | 入口 | 用途 |
| --- | --- | --- |
| 日历 / Gantt | [实现验证脚本](../../scripts/verification/calendar-gantt-verification.mjs) · [诊断探针](../../scripts/verification/calendar-gantt-probe.mjs) | 在开发服务器中检查生产视图，诊断缺少的 mock API；结果位于 [`results/`](results/)。 |
| 动效 | [动效实施验证](../../scripts/verification/motion-verification.mjs) · [审计探针](../../scripts/verification/motion-audit-probes.mjs) · [扫描清单生成器](../../scripts/verification/motion-audit-inventory.mjs) | 覆盖真实 Playground 组件、启动页和滚动行为。 |
| 打包客户端 | [结构验证](../../scripts/verification/packaged-client-verification.mjs) · [启动 smoke](../../scripts/verification/packaged-client-smoke.mjs) | 验证平台包内容与启动行为；macOS 和 Windows 各自保存结果。 |
| 日历原型 | [交互检查](../../scripts/verification/calendar-placement-demo-check.mjs) · [原型页面](../prototypes/calendar-untimed-placement-demo.html) | 检查独立的侧栏原型行为。 |

## 全项目动效审视

日期：2026-09-21。源码基线：`f2f5ef74`，同时审视当时工作区；这是一份已归档的实施记录。

| 交付物 | 用途 | 状态 |
| --- | --- | --- |
| [完整审计](motion-audit.md) | 覆盖地图、确定问题、设计差异、待实测风险、保留项 | 完成源码审视与指定隔离验证 |
| [统一动效规则建议](motion-specification.md) | 全项目共享语义、参数、状态与生命周期契约 | 已作为实施基线落地 |
| [验收矩阵](motion-validation.md) | 每条主要操作链路的正常、逆向、打断、无障碍与性能验收 | 部分关闭；P 项见实施状态第 9 节 |
| [实施状态](motion-implementation-status.md) | M01–M16、V01–V08、新增机会的逐项状态、文件与验证结果 | 实施完成；遗留项已列出 |
| [实施验证脚本](../../scripts/verification/motion-verification.mjs) | 真实组件（Playground）在真实浏览器中的 18 项行为检查 | 18/18 通过，结果见 [验证结果](results/motion-verification-results.json) |
| [扫描清单](results/motion-audit-inventory.json) | 每个界面文件及动效候选行号，可追溯覆盖范围 | 已生成；命中不等于缺陷 |
| [隔离验证结果](results/motion-audit-probes.json) | 启动 HTML 与平滑滚动的浏览器观测 | 已运行（M02 已修复，结论由实施验证脚本继续覆盖） |

范围是整个项目，不限定首批组件。实施阶段的源码改动见[实施状态](motion-implementation-status.md)第 1 节摘要；仓库内已有的插件相关未提交修改未被触碰。

建议依赖顺序：验收环境对齐 → 减弱动态与交互生命周期 → 主布局和导航 → 会话/输入/状态 → 预览/标注/拖拽 → 参数收敛及全链路回归。该顺序已在实施中遵循。

复现扫描（PowerShell，在仓库根目录）：

```powershell
$auditCommit = git rev-parse --short HEAD
rg --files apps packages docs | node scripts/verification/motion-audit-inventory.mjs $auditCommit
```

复现隔离浏览器验证（使用已安装的 Edge，不下载浏览器）：

```powershell
$env:MOTION_AUDIT_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node scripts/verification/motion-audit-probes.mjs
```

复现实施验证（需要渲染层开发服务器）：

```powershell
bun run electron:dev
node scripts/verification/motion-verification.mjs http://localhost:5173
```

现有单元测试基线（含本轮新增契约）：

```powershell
bun test ./packages/ui/src/lib/__tests__/motion.test.ts ./packages/ui/src/components/annotations/__tests__/island-motion.test.ts
```

结果为 8 个测试通过、0 失败。它们验证参数与计算函数，不代表动效体验或全部应用验收通过。

## 打包客户端校验

打包产物由两个只读脚本校验，各自写出独立结果文件：macOS 沿用历史文件名，Windows 加 `-win` 后缀，互不覆盖。两者都接受 `--arch=x64|arm64`、`--grace=毫秒`。

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File apps\electron\scripts\build-win.ps1
node scripts/verification/packaged-client-verification.mjs --arch=x64
node scripts/verification/packaged-client-smoke.mjs
```

```bash
# macOS
bash apps/electron/scripts/build-dmg.sh x64
node scripts/verification/packaged-client-verification.mjs --arch=x64
node scripts/verification/packaged-client-smoke.mjs --arch=x64
```

`packaged-client-verification.mjs` 只读取打包产物：版本与 `phaneris.identity.json` 一致（macOS 读 bundle 的 Info.plist，Windows 读 exe 的 VERSIONINFO 与包内 `package.json`）、asar 保持关闭且 bun/ripgrep/文档工具/WhatsApp worker/node-pty 等资源位于包外、主程序架构正确、renderer 已打包且不带 sourcemap。深链 scheme 只在 macOS 断言——Windows 的注册表项由安装器写入，属于安装后检查，不在只读校验范围内。

`packaged-client-smoke.mjs` 用一次性空数据根目录（`PHANERIS_CONFIG_DIR`，见 `packages/shared/src/config/paths.ts`）直接启动打包产物并观察 25 秒：断言进程不崩、Chromium 拉起了 renderer/helper、无致命输出、首次运行初始化写出了 app 级 `config.json`（只有这一项能区分“跑起来了”和“弹了错误窗口”：入口缺失时 Electron 依然存活、照样拉起 helper、照样创建 userData 目录），结束时清掉全部残留进程与临时目录，机器上的真实数据目录不受影响。之所以不用真实数据目录里的 `config.json` 作判据：本仓库所有 `config.json` 写入都以“配置缺失或数据变更”为条件（`config/storage.ts` 的 `saveConfig` 调用点），遇到健康配置就不写，判据会随机器数据状态时灵时不灵，也无法重复运行。结果分别写入 `results/packaged-client-verification.json` / `-win.json` 与 `results/packaged-client-smoke.json` / `-win.json`。运行日志保存在被忽略的 `.cache/verification/`。
